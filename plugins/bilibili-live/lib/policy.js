'use strict';
// B站弹幕插件 —— 显示策略层(纯函数, 无 IO, 便于离线单测)
//
// 需求(2026-09-20 用户拍板):
//   ① 插件要有"特殊优先级": 可以**中断其它功能数据**(抢占式显示) —— 但这是**可选项**;
//   ② 但手动触发/需要连读的功能(截图翻译、翻译字幕)**不能被忽略** —— 那期间弹幕**排队**;
//   ③ SC / 礼物 / 上舰 这类信息**防丢**: 被其它功能占用时排队而不是被顶掉;
//   ④ 重复弹幕自动压缩: 很多人同时刷 666 → 显示 `666×123`。
//
// 依据的真实机制(src/composer.js): pushTransient(text, priority, ttlMs, force) 压入临时文本,
//   tick() 每秒把"各数据源的 _cached"与"所有 transients"按优先级降序取第一条发送; 同优先级时数据源在前(让路);
//   transient 过期后数据源自然赢回来(所以不需要我们自己"恢复"); composer.current 暴露当前来源与优先级。

const HIGH_VALUE = { SUPER_CHAT: true, GIFT: true, GUARD: true };

// 各事件的默认优先级(都可由配置覆盖)
const DEFAULT_PRIORITY = { DANMAKU: 75, INTERACT: 70, GIFT: 80, SUPER_CHAT: 88, GUARD: 92 };

// 默认"不许打断"的来源: 语音字幕(livetranslate)与截图区域/截图翻译(ocrregion)
const DEFAULT_PROTECTED = ['livetranslate', 'ocrregion'];
const DEFAULT_CFG = {
  preemptBackground: true,   // ① 是否允许中断其它功能数据(关掉=一律排队)
  respectPriority: 85,       // ② 当前显示优先级 >= 这个值时让路(覆盖截图翻译 85 / 插件欢迎 90)
  protectSources: DEFAULT_PROTECTED,
  sourcePriority: {},        // 每类事件的优先级覆盖, 如 { GIFT: 82 }
  danmakuQueueTtlMs: 30000,  // 普通弹幕排队超时(过期丢弃, 弹幕有时效性)
  queueMax: 20,              // 普通队列上限(超出丢最旧)
  highValueQueueMax: 50,     // 高价值队列上限(超了才丢, 且必须记日志)
  aggregateWindowMs: 5000,   // ④ 重复弹幕聚合窗口
  aggregateFormat: '{text}×{n}'
};
function cfgOf(cfg) { return Object.assign({}, DEFAULT_CFG, cfg || {}); }

// CMD → 事件类别(**单一来源**: events.js 也用这张表, 免得两处各写一套)
// 2026-09-20 步 5 补全: 原来"不认识的一律当弹幕"太危险(会把 WATCHED_CHANGE 之类也推到聊天框),
// 现在不认识的归 'UNKNOWN'(step 6 只显示白名单内的类别)。
function kindOf(cmd) {
  const c = String(cmd || '').toUpperCase();
  if (c === 'SUPER_CHAT_MESSAGE' || c === 'SUPER_CHAT_MESSAGE_DELETE' || c === 'SUPER_CHAT_MESSAGE_JPN') return 'SUPER_CHAT';
  if (c === 'SEND_GIFT' || c === 'COMBO_SEND') return 'GIFT';
  if (c === 'GUARD_BUY' || c === 'USER_TOAST_MSG') return 'GUARD';
  if (c === 'INTERACT_WORD' || c === 'INTERACT_WORD_V2') return 'INTERACT';
  if (c === 'DANMU_MSG') return 'DANMAKU';
  if (c === 'WELCOME' || c === 'WELCOME_GUARD') return 'ENTER';
  if (c === 'LIKE_INFO_V3_CLICK' || c === 'LIKE_INFO_V3_UPDATE') return 'LIKE';
  if (c === 'WATCHED_CHANGE') return 'WATCHED';
  if (c === 'ONLINE_RANK_COUNT' || c === 'ONLINE_RANK_V2' || c === 'ONLINE_RANK_TOP3') return 'ONLINE_RANK';
  if (c === 'ROOM_REAL_TIME_MESSAGE_UPDATE') return 'ROOM_STATS';
  if (c === 'LIVE' || c === 'ROOM_CHANGE' || c === 'ANCHOR_LOT_START' || c === 'ANCHOR_LOT_END') return 'LIVE';
  if (c === 'PREPARING') return 'PREPARING';
  if (c === 'ROOM_BLOCK_MSG' || c === 'ROOM_KICKOUT') return 'BLOCKED';
  // ---- 开放平台专用 CMD 名(2026-09-20 查实: 官方开放平台与网页协议**不同名**, 来源 blivedm handlers.py 的 _CMD_CALLBACK_DICT) ----
  if (c === 'LIVE_OPEN_PLATFORM_DM' || c === 'LIVE_OPEN_PLATFORM_DM_MIRROR') return 'DANMAKU';   // 后者=跨房弹幕, 可能缺字段
  if (c === 'LIVE_OPEN_PLATFORM_SEND_GIFT') return 'GIFT';
  if (c === 'LIVE_OPEN_PLATFORM_GUARD') return 'GUARD';
  if (c === 'LIVE_OPEN_PLATFORM_SUPER_CHAT' || c === 'LIVE_OPEN_PLATFORM_SUPER_CHAT_DEL') return 'SUPER_CHAT';
  if (c === 'LIVE_OPEN_PLATFORM_LIKE') return 'LIKE';
  if (c === 'LIVE_OPEN_PLATFORM_LIVE_ROOM_ENTER') return 'ENTER';
  if (c === 'LIVE_OPEN_PLATFORM_LIVE_START' || c === 'LIVE_OPEN_PLATFORM_LIVE_END') return 'LIVE';
  if (c === 'LIVE_OPEN_PLATFORM_INTERACTION_END') return 'SESSION_END';   // 服务器主动停推(通常心跳超时)-> 要重新 start
  return 'UNKNOWN';
}
function isHighValue(kind) { return !!HIGH_VALUE[kind]; }
function priorityOf(kind, cfg) {
  const c = cfgOf(cfg);
  if (c.sourcePriority && c.sourcePriority[kind] !== undefined) return Number(c.sourcePriority[kind]);
  return DEFAULT_PRIORITY[kind] !== undefined ? DEFAULT_PRIORITY[kind] : 75;
}

// ②③ 决定"现在能不能显示": 返回 { action: 'show' | 'queue', reason }
function decideDisplay(opts) {
  const cfg = cfgOf(opts && opts.cfg);
  const cur = (opts && opts.current) || null;
  const priority = Number(opts && opts.priority);
  const now = Number(opts && opts.now) || Date.now();
  if (!cur || !cur.sourceId) return { action: 'show', reason: 'no-current' };              // 空场, 直接显示
  if (cur.sourceId === 'transient') {
    // **过期的临时文本只是残影**: composer 每秒会把过期的 transient 从候选里过滤掉, 但 composer.current 不会清空 ——
    // 于是"上一屏那条早就过期了"仍然显示为占屏者。我们再为它让路就会死锁: 我们等它让位, 而它永远不会让
    // (2026-09-25 用户实机: 一连串 "等不到上屏: lower-priority" 丢弃)。
    if (cur.ttlUntil && Number(cur.ttlUntil) < now) return { action: 'show', reason: 'stale-transient' };
    // 只有"优先级不够"这一种情况需要让路; transient 也可能是我们自己(同优先级 tie 会让我们先到先得, 不抢自己)
    if (Number(cur.priority) >= cfg.respectPriority) return { action: 'queue', reason: 'respect-transient' };
  } else {
    const protectedList = cfg.protectSources || [];
    if (protectedList.indexOf(cur.sourceId) >= 0) return { action: 'queue', reason: 'protect-source:' + cur.sourceId };
  }
  if (!cfg.preemptBackground) return { action: 'queue', reason: 'preempt-disabled' };        // ① 开关关掉 = 一律排队
  if (priority > Number(cur.priority)) return { action: 'show', reason: 'preempt' };         // ① 抢
  return { action: 'queue', reason: 'lower-priority' };
}

// ③ 入队: 高价值不设过期(直到显示), 普通弹幕带时效; 超限丢最旧并记录(丢弃必须可见)
function enqueue(queue, item, cfg, now) {
  const c = cfgOf(cfg);
  const list = (queue || []).slice();
  const rec = Object.assign({}, item);
  rec.at = now;
  rec.kind = rec.kind || 'DANMAKU';
  if (!isHighValue(rec.kind)) rec.expireAt = now + Number(c.danmakuQueueTtlMs);
  list.push(rec);
  const max = isHighValue(rec.kind) ? Number(c.highValueQueueMax) : Number(c.queueMax);
  const dropped = [];
  const sameKind = list.filter(function (x) { return isHighValue(x.kind) === isHighValue(rec.kind); });
  while (sameKind.length > max) {
    const idx = list.findIndex(function (x) { return x === sameKind[0]; });
    dropped.push(list.splice(idx, 1)[0]);
    sameKind.shift();
  }
  return { queue: list, dropped: dropped };
}

// 出队: 返回当前该显示的一条(先高价值后普通, 各自 FIFO), 以及被时效淘汰的条目
function dequeue(queue, cfg, now) {
  const c = cfgOf(cfg);
  const expired = [];
  const alive = [];
  for (const it of (queue || [])) {
    if (it.expireAt && it.expireAt <= now) { expired.push(it); continue; }
    alive.push(it);
  }
  const hv = alive.filter(function (x) { return isHighValue(x.kind); });
  const normal = alive.filter(function (x) { return !isHighValue(x.kind); });
  const next = hv.length ? hv[0] : (normal.length ? normal[0] : null);
  const rest = alive.filter(function (x) { return x !== next; });
  return { item: next, queue: rest, expired: expired };
}

// ④ 重复弹幕聚合: 窗口内同文本只显示一次, 窗口结束时若累计 >1 就补一条 `666×123`
function aggregateAccept(map, text, now, cfg) {
  const c = cfgOf(cfg);
  const key = String(text);
  const m = Object.assign({}, map || {});
  const hit = m[key];
  if (!hit || now - hit.firstAt > Number(c.aggregateWindowMs)) {
    m[key] = { text: key, count: 1, firstAt: now, lastAt: now };
    return { map: m, action: 'show', display: key };                 // 首次出现: 立刻显示, 让观众马上看到
  }
  hit.count += 1;
  hit.lastAt = now;
  return { map: m, action: 'hold', display: formatAgg(hit, c) };     // 窗口内重复: 先不刷屏
}
function formatAgg(hit, cfg) {
  const fmt = cfgOf(cfg).aggregateFormat;
  return String(fmt).split('{text}').join(hit.text).split('{n}').join(String(hit.count));
}
// 窗口结束(或文本切换)时冲刷: 只有 count>1 的才补一条计数消息
function aggregateFlush(map, now, cfg) {
  const c = cfgOf(cfg);
  const out = [];
  const rest = {};
  for (const k of Object.keys(map || {})) {
    const hit = map[k];
    const done = now - hit.lastAt > Number(c.aggregateWindowMs);
    if (!done) { rest[k] = hit; continue; }
    if (hit.count > 1) out.push({ text: hit.text, count: hit.count, display: formatAgg(hit, c) });
  }
  return { map: rest, outputs: out };
}

module.exports = {
  DEFAULT_CFG: DEFAULT_CFG, DEFAULT_PRIORITY: DEFAULT_PRIORITY, DEFAULT_PROTECTED: DEFAULT_PROTECTED,
  cfgOf: cfgOf, kindOf: kindOf, isHighValue: isHighValue, priorityOf: priorityOf,
  decideDisplay: decideDisplay, enqueue: enqueue, dequeue: dequeue,
  aggregateAccept: aggregateAccept, aggregateFlush: aggregateFlush
};

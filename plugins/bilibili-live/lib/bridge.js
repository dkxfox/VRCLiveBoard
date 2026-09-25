'use strict';
// B站直播 —— 事件 → 聊天框的桥(纯逻辑 + 端口注入, 无 IO, 便于离线单测)
//
// 它做的事: 把 events.js 归一化后的事件, 按 policy.js 的策略(抢占 / 让路 / 排队 / 防丢 / 聚合)
//   变成"什么时候推哪条文本", 再通过注入的两个端口推给现成的聊天框机制:
//     push(text, priority, ttlMs, force)   —— 对应 src/composer.js 的 pushTransient(...)
//     current()                            —— 返回 composer.current(当前正显示什么)
//   (插件的 index.js 负责把这两个端口接到 ctx.chatbox.send / composer.current, 见步 7)
//
// 为什么要自己做队列与节流, 而不是把每条弹幕直接 push 进去:
//   · composer.tick() 每秒只挑**一条**候选文本, 且相同文本会被 _lastText 去重挡掉;
//   · 高价值(SC/礼物/上舰)要"先出、不丢", 普通弹幕要有"时效、不刷屏";
//   · 节流(默认 1.5s)是自我保护: 观众刷屏时不要连续喂 OSC。
//
// 两条**踩过才写下来**的规则:
//   ① composer.current 只在"真的发出去了"时更新, 过期也不自动清空。若把"我们自己刚发的那条"当成别人占屏,
//      后来的弹幕会因为"优先级不高于它"永远排队(饿死) —— 所以 current 是我们的 lastPushedText 时不算挡自己。
//   ② 聚合窗口的键必须是**弹幕原文**(不含昵称): 默认文案是"昵称: 文本", 拿它当键的话
//      "很多人同时刷 666"永远聚不起来(每个人的昵称都不同)。
const P = require('./policy.js');
const E = require('./events.js');

const DEFAULT_CFG = {
  // 文案
  prefix: '',                 // 前缀, 如 '[弹幕] '
  showUname: true,            // 弹幕是否带昵称
  maxLen: 100,                // 截断长度(composer 自己还有 144 的上限)
  unameSep: ': ',
  // 节奏
  throttleMs: 1500,           // 两条消息之间至少间隔(与 09 的 C 段一致)
  stuckEscapeMs: 20000,       // 被同一个"非保护来源"挡住超过这么久就抢一次(0=关); 免得弹幕一条条过期丢掉
  ttlMs: 8000,                // 普通消息显示时长
  highValueTtlMs: 15000,      // SC / 礼物 / 上舰 显示时长
  forceHighValue: true,       // 高价值用 force 推(绕过 composer 自身的发送间隔; 我们已自节流)
  // 内容
  blockedWords: [],           // 屏蔽词(命中替换成 maskWith; 整条都是屏蔽词就丢弃)
  maskWith: '***',
  aggregateKinds: ['DANMAKU'],// 只对弹幕做重复聚合
  kinds: {                    // 哪些类别上聊天框(默认: 弹幕/礼物/SC/上舰)
    DANMAKU: true, GIFT: true, SUPER_CHAT: true, GUARD: true,
    INTERACT: false, ENTER: false, LIKE: false, WATCHED: false, ONLINE_RANK: false, ROOM_STATS: false
  },
  basePriority: 75            // 插件卡片里的"优先级"字段作为基数, 各类型按 policy 默认值相对偏移
};
// 策略层的默认值(抢占开关/让路地板/队列上限/聚合窗口…)也一起用, 但桥自己的键优先
DEFAULT_CFG.preemptBackground = P.DEFAULT_CFG.preemptBackground;
for (const k of Object.keys(P.DEFAULT_CFG)) if (DEFAULT_CFG[k] === undefined) DEFAULT_CFG[k] = P.DEFAULT_CFG[k];
function cfgOf(cfg) { return Object.assign({}, DEFAULT_CFG, cfg || {}); }

// 优先级: 用户设的基数 + 该类型相对弹幕的偏移(弹幕 75 / 互动 70 / 礼物 80 / SC 88 / 上舰 92)
function priorityFor(kind, cfg) {
  const c = cfgOf(cfg);
  if (c.sourcePriority && c.sourcePriority[kind] !== undefined) return Number(c.sourcePriority[kind]);
  const dflt = P.DEFAULT_PRIORITY[kind];
  const base = Number(c.basePriority);
  if (dflt === undefined) return base;
  return base + (dflt - P.DEFAULT_PRIORITY.DANMAKU);
}
function ttlFor(kind, cfg) {
  const c = cfgOf(cfg);
  return P.isHighValue(kind) ? Number(c.highValueTtlMs) : Number(c.ttlMs);
}
// 事件的"内容主体"(弹幕是原文; 其它类型用 events.defaultText 的整句)
function bodyOf(ev) {
  if (!ev) return '';
  return ev.kind === 'DANMAKU' ? String(ev.text || '') : E.defaultText(ev);
}
// 拼成最终文案(弹幕按开关加昵称; 全场统一加前缀)
function compose(ev, body, cfg) {
  const c = cfgOf(cfg);
  let out = String(body === undefined || body === null ? '' : body);
  if (ev && ev.kind === 'DANMAKU' && c.showUname && ev.uname) out = ev.uname + c.unameSep + out;
  return c.prefix ? String(c.prefix) + out : out;
}
function buildText(ev, cfg) { return ev ? compose(ev, maskWords(bodyOf(ev), cfg), cfg) : ''; }
function maskWords(text, cfg) {
  const c = cfgOf(cfg);
  let out = String(text);
  for (const w of (c.blockedWords || [])) {
    const word = String(w || '');
    if (!word) continue;
    out = out.split(word).join(c.maskWith);
  }
  return out;
}
// 屏蔽后只剩掩码/空白/标点 = 整条都是屏蔽词(昵称与前缀不参与这个判断)
function allMasked(body, masked, cfg) {
  const c = cfgOf(cfg);
  if (masked === body) return false;
  return !masked.split(c.maskWith).join('').replace(/[\s\p{P}\p{S}]/gu, '');
}
function truncate(text, cfg) {
  const c = cfgOf(cfg);
  const chars = Array.from(String(text));
  const max = Number(c.maxLen) || 0;
  if (!max || chars.length <= max) return String(text);
  return chars.slice(0, Math.max(1, max - 1)).join('') + '…';
}

function createBridge(opts) {
  const o = opts || {};
  if (typeof o.push !== 'function') throw new Error('createBridge 需要 push(text, priority, ttlMs, force) 端口');
  let cfg = cfgOf(o.cfg);
  const log = function (m) { try { if (o.log) o.log(String(m)); } catch (e) {} };
  const onDrop = function (item, why) { try { if (o.onDrop) o.onDrop(item, why); } catch (e) {} };
  const state = { agg: {}, queue: [], pending: null, lastPushAt: -Infinity, lastPushedText: '', sent: 0, lastBlockLog: 0 };
  const stats = { received: 0, shown: 0, queued: 0, dropped: 0, aggregated: 0, masked: 0, ignored: 0, filteredLen: 0 };
  const current = typeof o.current === 'function' ? o.current : function () { return null; };

  function ownOnScreen() {                     // 屏幕上是"我们自己刚发的那条"吗?
    const cur = current() || null;
    return !!(cur && cur.sourceId === 'transient' && state.lastPushedText && cur.text === state.lastPushedText);
  }
  function decide(item, now) {
    if (ownOnScreen()) return { action: 'show', reason: 'own-transient' };   // 别把自己挡死(规则①)
    const d = P.decideDisplay({ current: current(), priority: item.priority, cfg: cfg, now: now });
    // 卡死保护: 被同一个"非保护来源"挡住太久(默认 20 秒)就抢一次 —— 否则弹幕只会一条条过期丢掉。
    // 来源保护(截图翻译/翻译字幕)永远不抢: 那是用户明确要求"不许打断"的。
    const esc = Number(cfg.stuckEscapeMs) || 0;
    if (d.action === 'queue' && esc > 0 && item.waitedSince && (now - item.waitedSince) >= esc &&
        !/^protect-source/.test(d.reason) && d.reason !== 'preempt-disabled') {
      return { action: 'show', reason: 'stuck-escape:' + d.reason };
    }
    return d;
  }
  // 排队时把"被谁挡着"写进日志(限频 10 秒一次): 用户看到丢弃就能知道原因, 不用再猜
  function logBlocked(item, reason, now) {
    if (now - state.lastBlockLog < 10000) return;
    state.lastBlockLog = now;
    const cur = current() || {};
    log('排队中(等不到上屏: ' + reason + ', ' + item.kind + ') 当前占屏: ' + (cur.sourceId || '?') + '/' +
        (cur.priority === undefined ? '?' : cur.priority) + ' "' + String(cur.text || '').slice(0, 24) + '"' +
        (cur.ttlUntil ? ' (有效期到 ' + new Date(Number(cur.ttlUntil)).toLocaleTimeString() + ')' : ''));
  }
  function doPush(item, why, now) {
    const force = !!cfg.forceHighValue && P.isHighValue(item.kind);
    o.push(item.text, item.priority, item.ttlMs, force);
    state.lastPushAt = now;                     // 用调用方给的逻辑时间(不是墙上时钟) —— 否则节流算不准
    state.lastPushedText = item.text;
    state.sent += 1; stats.shown += 1;
    log('显示[' + item.kind + '/' + item.priority + '] ' + why + ': ' + item.text);
  }
  function enqueue(item, why, now) {
    if (!item.waitedSince) item.waitedSince = now;      // 记下"从什么时候开始等", 卡死保护要用
    const r = P.enqueue(state.queue, item, cfg, now);
    state.queue = r.queue; stats.queued += 1;
    for (const d of r.dropped) { stats.dropped += 1; onDrop(d, 'queue-full'); log('丢弃(队列满, ' + d.kind + '): ' + d.text); }
    return { action: 'queue', reason: why, text: item.text };
  }
  // 单条文本的处置: 能发就发, 否则排队(高价值的"先出"由 policy.dequeue 保证, 不在这里插队)
  // bypassThrottle: 只给"用户手动点预览"这类显式动作(否则第一次点预览会被节流排队, 看起来像坏了)
  function route(item, now, bypassThrottle) {
    const dec = decide(item, now);
    if (dec.action !== 'show') logBlocked(item, dec.reason, now);
    const throttleOk = !!bypassThrottle || now - state.lastPushAt >= Number(cfg.throttleMs);
    if (dec.action === 'show' && !state.pending && throttleOk) { doPush(item, dec.reason, now); return { action: 'show', reason: dec.reason, text: item.text }; }
    const why = dec.action === 'show' ? (state.pending ? 'slot-busy' : 'throttled') : dec.reason;
    item.why = why;
    return enqueue(item, why, now);
  }
  function handleEvent(ev, now, opts) {
    if (!ev) { stats.ignored += 1; return { action: 'ignore', reason: 'no-event' }; }
    stats.received += 1;
    if (!cfg.kinds || cfg.kinds[ev.kind] !== true) { stats.ignored += 1; return { action: 'ignore', reason: 'kind-off:' + ev.kind }; }
    const body = bodyOf(ev);
    if (!body.trim()) { stats.ignored += 1; return { action: 'ignore', reason: 'no-text' }; }
    const masked = maskWords(body, cfg);
    if (masked !== body) stats.masked += 1;
    if (allMasked(body, masked, cfg)) { stats.ignored += 1; return { action: 'ignore', reason: 'all-masked' }; }
    let text = compose(ev, masked, cfg);
    const t2 = truncate(text, cfg);
    if (t2 !== text) { stats.filteredLen += 1; text = t2; }
    const priority = priorityFor(ev.kind, cfg);
    // 重复弹幕聚合(键 = **原文**, 不是带昵称的最终文案): 首次照原样显示, 窗口内压住, 窗口结束补 '原文×N'
    if ((cfg.aggregateKinds || []).indexOf(ev.kind) >= 0) {
      const a = P.aggregateAccept(state.agg, masked, now, cfg);
      state.agg = a.map;
      if (a.action === 'hold') { stats.aggregated += 1; return { action: 'aggregate', reason: 'hold', text: a.display }; }
    }
    return route({ kind: ev.kind, text: text, priority: priority, ttlMs: ttlFor(ev.kind, cfg), cmd: ev.cmd }, now, opts && opts.bypassThrottle);
  }
  return {
    handleRaw: function (raw, now, opts) { return handleEvent(E.normalize(raw), now === undefined ? Date.now() : now, opts); },
    handleEvent: function (ev, now, opts) { return handleEvent(ev, now === undefined ? Date.now() : now, opts); },
    // 每秒调一次(跟 composer.tick 同频): 冲刷聚合窗口 → 补计数 → 试着把待发的发出去
    tick: function (nowArg) {
      const t = nowArg === undefined ? Date.now() : nowArg;
      const fl = P.aggregateFlush(state.agg, t, cfg);
      state.agg = fl.map;
      for (const out of fl.outputs) {
        const text = cfg.prefix ? String(cfg.prefix) + out.display : out.display;
        log('聚合窗口结束: ' + text);
        route({ kind: 'DANMAKU', text: text, priority: priorityFor('DANMAKU', cfg), ttlMs: ttlFor('DANMAKU', cfg), cmd: 'AGGREGATE' }, t);
      }
      if (!state.pending) {
        const d = P.dequeue(state.queue, cfg, t);
        state.queue = d.queue;
        for (const e of d.expired) { stats.dropped += 1; onDrop(e, 'expired', { why: e.why }); log('丢弃(过期, 等不到上屏: ' + (e.why || '未知') + ', ' + e.kind + '): ' + e.text); }
        state.pending = d.item || null;
      }
      if (state.pending) {
        const it = state.pending;
        if (it.expireAt && it.expireAt <= t) { stats.dropped += 1; onDrop(it, 'expired', { why: it.why }); log('丢弃(过期, 等不到上屏: ' + (it.why || '未知') + ', ' + it.kind + '): ' + it.text); state.pending = null; return { action: 'drop', reason: 'expired' }; }
        if (t - state.lastPushAt >= Number(cfg.throttleMs)) {
          const dec = decide(it, t);
          if (dec.action === 'show') { state.pending = null; doPush(it, 'drain:' + dec.reason, t); return { action: 'show', reason: 'drain:' + dec.reason }; }
          it.why = dec.reason;                                  // 记下来: 过期时日志能说清是谁挡着
          logBlocked(it, dec.reason, t);
          return { action: 'wait', reason: dec.reason };
        }
        it.why = 'throttled';
        return { action: 'wait', reason: 'throttled' };
      }
      return { action: 'idle', reason: 'empty' };
    },
    // 配置热更新(设置面板改完直接生效, 不用重建桥)
    setCfg: function (next) { cfg = cfgOf(next); return cfg; },
    cfg: function () { return cfg; },
    queue: function () { return { pending: state.pending, waiting: state.queue.length }; },
    stats: function () { return Object.assign({}, stats, { waiting: state.queue.length, sent: state.sent }); }
  };
}

module.exports = {
  createBridge: createBridge, DEFAULT_CFG: DEFAULT_CFG, cfgOf: cfgOf,
  priorityFor: priorityFor, ttlFor: ttlFor, bodyOf: bodyOf, compose: compose,
  buildText: buildText, maskWords: maskWords, allMasked: allMasked, truncate: truncate
};

'use strict';
// 事件 → 聊天框 的桥单测(纯离线, 不需要凭据): node lib/bridge.test.js
// 用一个假 composer 端口(记录推送内容 + 维护 current), 不碰真的 OSC/聊天框。
const B = require('../lib/bridge.js');
const P = require('../lib/policy.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
let T = 1000000;                                  // 可控时钟
function danmu(text, uname) { return { cmd: 'DANMU_MSG', info: [[], text, [1, uname || '观众', 0, 0, 0, 10000, 1, '']] }; }
function sc(price, msg, uname) { return { cmd: 'SUPER_CHAT_MESSAGE', data: { price: price, message: msg, time: 60, uid: 2, user_info: { uname: uname || '老板' } } }; }
function gift(name, num, uname) { return { cmd: 'SEND_GIFT', data: { giftName: name, num: num, uname: uname || '送礼的', uid: 3, coin_type: 'gold', total_coin: 1000 } }; }
// 假 composer: push 之后 current 就变成"我们这条"(与真 composer 一致: sourceId 固定是 'transient')
function fakeComposer() {
  const c = {
    sent: [], current: null,
    push: function (text, priority, ttlMs, force) {
      c.sent.push({ text: text, priority: priority, ttlMs: ttlMs, force: force });
      c.current = { text: text, sourceId: 'transient', priority: priority, ttlUntil: T + ttlMs, at: T };
    }
  };
  return c;
}
function makeBridge(cfg, extra) {
  const c = fakeComposer();
  const drops = [], logs = [];
  const br = B.createBridge(Object.assign({
    cfg: cfg, now: function () { return T; },
    push: c.push, current: function () { return c.current; },
    log: function (m) { logs.push(m); }, onDrop: function (it, why) { drops.push({ text: it.text, why: why }); }
  }, extra || {}));
  return { c: c, br: br, drops: drops, logs: logs };
}

// ---- 基本文案 / 优先级 / 显示时长 ----
{
  const h = makeBridge({});
  const r = h.br.handleRaw(danmu('你好'), T);
  ok(r.action === 'show' && h.c.sent.length === 1 && h.c.sent[0].text === '观众: 你好', '弹幕首条: 直接显示, 文案 "昵称: 文本"');
  ok(h.c.sent[0].priority === 75 && h.c.sent[0].ttlMs === 8000 && h.c.sent[0].force === false, '弹幕: 优先级 75 / 8 秒 / 不用 force');
  T += 2000;
  const r2 = h.br.handleRaw(sc(30, '这个真好用'), T);
  ok(r2.action === 'show' && h.c.sent[1].text === 'SC ¥30 老板: 这个真好用', 'SC: 文案带金额与昵称');
  ok(h.c.sent[1].priority === 88 && h.c.sent[1].ttlMs === 15000 && h.c.sent[1].force === true, 'SC: 优先级 88 / 15 秒 / force(高价值要立刻出)');
  const hG = makeBridge({});            // 单独一个桥: 默认开了"保持展示", SC 会把紧随其后的礼物挡在队列里(见下面的保持展示用例)
  T += 2000;
  hG.br.handleRaw(gift('辣条', 5), T);
  ok(hG.c.sent[0].priority === 80 && hG.c.sent[0].text === '送礼的 投喂 辣条×5', '礼物: 优先级 80 + 现成文案');
}

// ---- 重复弹幕聚合(666 -> 666×N) ----
{
  T = 2000000;
  const h = makeBridge({});
  h.br.handleRaw(danmu('666', '甲'), T);
  ok(h.c.sent.length === 1 && h.c.sent[0].text === '甲: 666', '聚合: 首次出现照原样显示(观众马上看到)');
  const r2 = h.br.handleRaw(danmu('666', '乙'), T + 300);
  ok(r2.action === 'aggregate' && h.c.sent.length === 1, '聚合: 窗口内重复不再刷屏');
  h.br.handleRaw(danmu('666', '丙'), T + 600);
  ok(h.br.stats().aggregated === 2, '聚合: 计数(三个人各不相同, 靠**原文**聚合 —— 键里不含昵称)');
  h.br.tick(T + 7000);      // tick 的返回值是"待发槽的结果", 聚合补发的看 sent
  ok(h.c.sent.length === 2 && h.c.sent[1].text === '666×3', '聚合: 窗口结束补一条 "666×3"(用原文计数, 与首次的 "甲: 666" 不同, 不会被 composer 去重挡掉)');
  ok(h.c.sent[0].text !== h.c.sent[1].text, '聚合: 补的计数文案必须与首次不同 —— composer 会用 _lastText 去重, 相同就白推了');
  const h2 = makeBridge({ aggregateKinds: [] });
  h2.br.handleRaw(danmu('777', '甲'), T);
  T += 800;
  const rr = h2.br.handleRaw(danmu('777', '乙'), T);
  ok(rr.action !== 'aggregate', '聚合可关(aggregateKinds 空): 重复弹幕走正常排队');
}

// ---- 屏蔽词 / 截断 / 前缀 / 昵称开关 ----
{
  T = 3000000;
  const h = makeBridge({ blockedWords: ['傻', 'fuck'] });
  h.br.handleRaw(danmu('你这个傻子 fuck', '甲'), T);
  ok(h.c.sent[0].text === '甲: 你这个***子 ***' && h.br.stats().masked === 1, '屏蔽词: 命中替换成 ***');
  T += 2000;
  const h2 = makeBridge({ blockedWords: ['傻'] });
  const r = h2.br.handleRaw(danmu('傻傻傻', '甲'), T);
  ok(r.action === 'ignore' && r.reason === 'all-masked' && h2.c.sent.length === 0, '屏蔽词: 整条都是屏蔽词 -> 直接丢弃(别推 *** 上去)');
  T += 2000;
  const long = '这是一条很长的弹幕'.repeat(20);
  const h3 = makeBridge({ maxLen: 20 });
  h3.br.handleRaw(danmu(long, '甲'), T);
  ok(Array.from(h3.c.sent[0].text).length === 20 && h3.c.sent[0].text.slice(-1) === '…' && h3.br.stats().filteredLen === 1, '截断: maxLen=20 时留 19 字 + 省略号');
  T += 2000;
  const h4 = makeBridge({ prefix: '[弹幕] ', showUname: false });
  h4.br.handleRaw(danmu('你好', '甲'), T);
  ok(h4.c.sent[0].text === '[弹幕] 你好', '前缀 + 关掉昵称: "[弹幕] 你好"');
}

// ---- 哪些类别上聊天框 ----
{
  T = 4000000;
  const h = makeBridge({});
  const before = h.c.sent.length;
  const rEnter = h.br.handleRaw({ cmd: 'WELCOME', data: { uid: 1, uname: '路人' } }, T);
  const rInter = h.br.handleRaw({ cmd: 'INTERACT_WORD', data: { uid: 1, uname: '路人', msg_type: 2 } }, T);
  const rLike = h.br.handleRaw({ cmd: 'LIKE_INFO_V3_CLICK', data: { uid: 1, uname: '路人' } }, T);
  ok(rEnter.reason === 'kind-off:ENTER' && rInter.reason === 'kind-off:INTERACT' && rLike.reason === 'kind-off:LIKE', '默认只放弹幕/礼物/SC/上舰: 进房/互动/点赞都忽略');
  const h2 = makeBridge({ kinds: { DANMAKU: true, GIFT: true, SUPER_CHAT: true, GUARD: true, ENTER: true } });
  T += 2000;
  const r2 = h2.br.handleRaw({ cmd: 'WELCOME', data: { uid: 1, uname: '路人' } }, T);
  ok(r2.action === 'show' && h2.c.sent[0].text === '欢迎 路人 进入直播间', '开进房开关后就能上聊天框');
  T += 2000;
  const rW = h2.br.handleRaw({ cmd: 'WATCHED_CHANGE', data: { num: 5 } }, T);
  const rU = h2.br.handleRaw({ cmd: 'BRAND_NEW_CMD', data: {} }, T);
  ok(rW.action === 'ignore' && rU.action === 'ignore', '状态类/未知 CMD: 不放行(没文案)');
  ok(h2.br.handleEvent(null).reason === 'no-event', '空事件: 忽略');
  ok(before === 0, '(本轮之前没有推过任何东西)');
}

// ---- 让路: 保护来源 / 关掉抢占 / 优先级地板 ----
{
  T = 5000000;
  const h = makeBridge({});
  h.c.current = { text: '字幕中…', sourceId: 'livetranslate', priority: 40, ttlUntil: T + 99999 };
  const r = h.br.handleRaw(danmu('你好'), T);
  ok(r.action === 'queue' && r.reason === 'protect-source:livetranslate' && h.c.sent.length === 0, '语音字幕占屏时: 弹幕排队(手动功能不许被打断)');
  ok(h.br.queue().waiting === 1, '排队里有 1 条');
  h.c.current = { text: '公告板', sourceId: 'pages', priority: 5, ttlUntil: T + 99999 };
  const r2 = h.br.tick(T + 6000);
  ok(r2.action === 'show' && h.c.sent[0].text === '观众: 你好', '字幕让位(当前换成低优先级来源)后: 排队的弹幕补发');
  const h2 = makeBridge({ preemptBackground: false });
  h2.c.current = { text: '公告板', sourceId: 'pages', priority: 5, ttlUntil: T + 99999 };
  ok(h2.br.handleRaw(danmu('你好'), T).reason === 'preempt-disabled', '关掉"中断其它功能"后: 连公告板也不抢');
  const h3 = makeBridge({});
  h3.c.current = { text: '别人的高优先级临时文本', sourceId: 'transient', priority: 90, ttlUntil: T + 99999 };
  ok(h3.br.handleRaw(danmu('你好'), T).reason === 'respect-transient', '当前是别人的 90 优先级临时文本: 让路(硬规则 >= 85)');
  const h4 = makeBridge({ sourcePriority: { DANMAKU: 95 } });
  T += 2000;
  ok(h4.br.handleRaw(danmu('你好'), T).action === 'show', '把弹幕优先级调到 95 后: 90 的地板不挡它了(可配置)');
}

// ---- 自己刚发的那条不挡自己(否则后续弹幕会饿死) ----
{
  T = 6000000;
  const h = makeBridge({});
  h.br.handleRaw(danmu('第一条', '甲'), T);
  ok(h.c.current && h.c.current.text === '甲: 第一条', '(前提) composer.current 现在就是我们刚推的那条');
  const r2 = h.br.handleRaw(danmu('第二条', '乙'), T + 2000);
  ok(r2.action === 'show' && r2.reason === 'own-transient' && h.c.sent.length === 2, '屏幕上是自己刚发的 transient 时: 后续弹幕照发(不会永远排队)');
  const r3 = h.br.handleRaw(danmu('第三条', '丙'), T + 2100);
  ok(r3.action === 'queue' && r3.reason === 'throttled', '但节流仍然生效(1.5 秒内不连续推)');
  const r4 = h.br.tick(T + 2200);
  ok(r4.action === 'wait' && r4.reason === 'throttled', '节流没到: 待发槽继续等');
  const r5 = h.br.tick(T + 4000);
  ok(r5.action === 'show' && h.c.sent[2].text === '丙: 第三条', '节流到点: 待发的那条发出去');
}

// ---- 队列上限 / 过期 / 高价值优先 ----
{
  T = 7000000;
  const h = makeBridge({});
  h.br.handleRaw(danmu('占位', '甲'), T);
  for (let i = 0; i < 25; i++) h.br.handleRaw(danmu('弹幕' + i, '甲'), T + 100 + i);
  ok(h.br.queue().waiting === 20, '普通队列上限 20(超出丢最旧)');
  ok(h.br.stats().dropped >= 5 && h.drops.filter(function (d) { return d.why === 'queue-full'; }).length >= 5, '丢弃必须可见: onDrop 收到 queue-full(' + h.br.stats().dropped + ' 条)');
  const r = h.br.tick(T + 40000);
  ok(r.action === 'drop' && r.reason === 'expired' || h.br.stats().dropped > 5, '弹幕有时效(30 秒): 过期就丢, 不补发陈年弹幕');
  const h2 = makeBridge({});
  h2.br.handleRaw(danmu('普通弹幕', '甲'), T);
  for (let i = 0; i < 3; i++) h2.br.handleRaw(danmu('刷屏' + i, '乙'), T + 100 + i);
  h2.br.handleRaw(sc(100, '老板来了'), T + 200);
  const r2 = h2.br.tick(T + 2000);
  ok(r2.action === 'show' && h2.c.sent[1].text === 'SC ¥100 老板: 老板来了', '高价值先出队: 排在弹幕后面进来的 SC, 补发时先发它');
  const h3 = makeBridge({});
  for (let i = 0; i < 60; i++) h3.br.handleRaw(sc(30, 'SC' + i), T + i * 10);
  ok(h3.br.queue().waiting <= 50, '高价值队列上限 50(' + h3.br.queue().waiting + ')');
  const r3 = h3.br.tick(T + 3600 * 1000);
  ok(r3.action === 'show', '高价值不过期: 一小时后再补发也不丢(SC/礼物/上舰防丢)');
}

// ---- 优先级基数与配置热更新 ----
{
  T = 8000000;
  ok(B.priorityFor('DANMAKU', { basePriority: 60 }) === 60 && B.priorityFor('SUPER_CHAT', { basePriority: 60 }) === 73 && B.priorityFor('GUARD', { basePriority: 60 }) === 77, '优先级基数: 卡片里的优先级作为基数, 各类型按默认偏移(60 起: 弹幕 60 / SC 73 / 上舰 77)');
  ok(B.priorityFor('GIFT', { basePriority: 60, sourcePriority: { GIFT: 99 } }) === 99, '逐类覆盖优先于基数');
  ok(B.priorityFor('WATCHED', { basePriority: 60 }) === 60, 'policy 表里没有的类别: 就用基数');
  const h = makeBridge({});
  h.br.handleRaw(danmu('你好', '甲'), T);
  h.br.setCfg({ kinds: { DANMAKU: false } });
  T += 2000;
  ok(h.br.handleRaw(danmu('关掉之后', '甲'), T).reason === 'kind-off:DANMAKU', 'setCfg 热更新立即生效(设置面板改完不用重建桥)');
}

// ---- 纯函数 / 统计 ----
{
  ok(B.buildText(null, {}) === '' && B.buildText({ kind: 'UNKNOWN' }, {}) === '', 'buildText: 空事件/无文案类别 -> 空串');
  ok(B.maskWords('abcXdef', { blockedWords: ['X'], maskWith: '[]' }) === 'abc[]def', 'maskWords: 掩码可配');
  ok(B.truncate('短', { maxLen: 100 }) === '短' && Array.from(B.truncate('一二三四五', { maxLen: 3 })).join('') === '一二…', 'truncate: 够长不动, 超长留省略号');
  const h = makeBridge({ blockedWords: ['傻'] });
  h.br.handleRaw(danmu('你好', '甲'), T);
  T += 2000;
  h.br.handleRaw(danmu('傻', '甲'), T);
  const s = h.br.stats();
  ok(s.received === 2 && s.shown === 1 && s.ignored === 1 && s.masked === 1, 'stats: 收到 2 / 显示 1 / 忽略 1(整条被屏蔽)');
  ok(B.allMasked('傻傻', '******', {}) === true && B.allMasked('你好', '你好', {}) === false && B.allMasked('傻x', '***x', {}) === false, 'allMasked: 只有"整条都是掩码"才算, 混了正常字就不算');
  ok(h.br.cfg().throttleMs === 1500 && h.br.cfg().queueMax === 20 && h.br.cfg().respectPriority === 85, 'cfg(): 桥自己的默认值与策略层默认值合并正确');
  ok(P.isHighValue('SUPER_CHAT') && !P.isHighValue('DANMAKU'), '(与策略层一致)高价值定义');
  // 高价值"保持展示"(持久化): SC/礼物/上舰各自可设时长, 期间弹幕不许顶掉它 —— 2026-09-25 用户要求
  {
    const h = makeBridge({ scHoldMs: 60000, giftHoldMs: 30000, ttlMs: 8000 });
    h.br.handleRaw(sc(30, '感谢叔叔的15抽成', '恰恰doro'), T);
    ok(h.c.sent[0].ttlMs === 60000, 'SC: 保持展示时长按 scHoldMs(60 秒)推上去');
    ok(h.br.queue().holdUntil === T + 60000 && h.br.queue().holdKind === 'SUPER_CHAT', '队列状态里能看到"保持展示到什么时候/哪一类"');
    T += 10000;                                   // SC 还挂着的时候来一条弹幕
    const r = h.br.handleRaw(danmu('发了', '恰恰doro'), T);
    ok(h.c.sent.length === 1 && r.action === 'queue' && r.reason === 'respect-transient', '保持展示期间弹幕**不会**顶掉 SC(排队, 原因 respect-transient)');
    T += 3000;
    h.br.tick(T);
    ok(h.c.sent.length === 1, '保持展示窗口内 tick 也不会把它换掉(tick 没事干)');
    T += 50000;                                   // 越过 60 秒窗口(此时弹幕已超过 30 秒时效)
    h.br.tick(T);
    ok(h.c.sent.length === 1 && h.br.stats().dropped >= 1, '保持展示比弹幕时效还长时: 排队弹幕会过期丢弃(要保持久就得同时调 danmakuQueueTtlMs)');
    // 短保持(3 秒)时: 窗口结束后排队的弹幕还在时效内 -> 正常补发
    const hShort = makeBridge({ scHoldMs: 3000 });
    hShort.br.handleRaw(sc(30, '短保持', '甲'), T);
    T += 1000;
    hShort.br.handleRaw(danmu('等一会儿', '乙'), T);
    T += 2500;
    hShort.br.tick(T);
    ok(hShort.c.sent.length === 2 && hShort.c.sent[1].text === '乙: 等一会儿', '短保持窗口结束后: 排队的弹幕立刻补发(没被丢掉)');
    const h2 = makeBridge({ holdEnabled: false, scHoldMs: 60000 });
    h2.br.handleRaw(sc(30, '开关关掉', '甲'), T);
    ok(h2.c.sent[0].ttlMs === 15000, '保持展示开关关掉: 回到基础时长 highValueTtlMs(15 秒)');
    T += 2000;
    const rOff = h2.br.handleRaw(danmu('开关关掉后的弹幕', '甲'), T);
    ok(h2.c.sent.length === 2 && rOff.action === 'show', '开关关掉后不守屏: 下一条消息过了节流就能显示(老行为)');
    const h3 = makeBridge({ giftHoldMs: 30000 });
    h3.br.handleRaw(gift('辣条', 5, '甲'), T);
    ok(h3.c.sent[0].ttlMs === 30000, '礼物: 也能单独设保持时长(giftHoldMs)');
    const h4 = makeBridge({ scHoldMs: 0 });
    h4.br.handleRaw(sc(30, '零时长', '甲'), T);
    ok(h4.c.sent[0].ttlMs === 15000, 'scHoldMs=0 表示"不特别保持", 用基础时长');
    const h5 = makeBridge({ guardHoldMs: 45000 });          // 单独一个桥(高价值会把后面的挡在队列里)
    h5.br.handleRaw({ cmd: 'GUARD_BUY', data: { username: '甲', guard_level: 3, num: 1, price: 138000 } }, T);
    ok(h5.c.sent[0].ttlMs === 45000, '上舰: guardHoldMs 同样生效');
  }
  // 卡死保护: 被同一个"非保护来源"挡住太久就抢一次(否则弹幕只会一条条过期丢掉) —— 2026-09-25 用户实机
  {
    const h = makeBridge({ stuckEscapeMs: 5000 });
    h.c.current = { sourceId: 'pages', priority: 90, ttlUntil: 0 };   // 90 的公告板长期占屏(比我们高)
    h.br.handleRaw(danmu('被挡住的', '甲'), T);
    ok(h.c.sent.length === 0 && h.br.queue().waiting === 1, '(前提)被 90 优先级来源挡下 -> 排队');
    h.br.tick(T + 1000);
    ok(h.c.sent.length === 0, '才等 1 秒: 还老实排队(不抢)');
    const r = h.br.tick(T + 6000);
    ok(r.action === 'show' && r.reason.indexOf('stuck-escape') >= 0 && h.c.sent[0].text === '甲: 被挡住的', '等超过 stuckEscapeMs(5 秒) -> 抢一次并说明原因(不再默默丢)');
    const h2 = makeBridge({ stuckEscapeMs: 5000 });
    h2.c.current = { sourceId: 'livetranslate', priority: 40, ttlUntil: 0 };   // 来源保护
    h2.br.handleRaw(danmu('字幕期间', '甲'), T);
    h2.br.tick(T + 60000);
    ok(h2.c.sent.length === 0, '来源保护(截图翻译/翻译字幕)**永远不抢**, 卡死保护也不越过它');
    const h3 = makeBridge({ stuckEscapeMs: 0 });
    h3.c.current = { sourceId: 'pages', priority: 90, ttlUntil: 0 };
    h3.br.handleRaw(danmu('关掉保护', '甲'), T);
    h3.br.tick(T + 60000);
    ok(h3.c.sent.length === 0, 'stuckEscapeMs=0 时完全关掉卡死保护');
    const h4 = makeBridge({});
    h4.c.current = { sourceId: 'transient', priority: 99, text: '很久以前的公告', ttlUntil: T - 1000 };
    const r4 = h4.br.handleRaw(danmu('残影之后', '甲'), T);
    ok(r4.action === 'show' && r4.reason === 'stale-transient' && h4.c.sent.length === 1, '上一屏是**已过期**的临时文本时: 直接显示(不再死等)');
  }
  // 返回值要带 text(设置面板的"预览"要显示到底推了什么); bypassThrottle 只给显式预览用
  const hp = makeBridge({});
  const p1 = hp.br.handleRaw(danmu('预览一', '甲'), T);
  const p2 = hp.br.handleRaw(danmu('预览二', '乙'), T + 100);
  ok(p1.text === '甲: 预览一' && p2.text === '乙: 预览二' && p2.action === 'queue' && p2.reason === 'throttled', '返回值带 text; 节流内的第二条标 throttled');
  const p3 = hp.br.handleRaw(danmu('预览三', '丙'), T + 200, { bypassThrottle: true });
  ok(p3.action === 'show' && hp.c.sent.length === 2 && hp.c.sent[1].text === '丙: 预览三', 'bypassThrottle(手动预览): 立刻显示, 不排队');
}

console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exitCode = fail ? 1 : 0;

'use strict';
// 显示策略单测(纯离线, 不需要凭据): node lib/policy.test.js
// 对齐 2026-09-20 用户拍板的四条: ①可选中断 ②手动功能让路 ③高价值防丢 ④重复弹幕聚合
const P = require('./policy.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const T = 1000000;

// ① 中断其它功能数据(抢占), 但要看当前显示是谁
ok(P.decideDisplay({ current: null, priority: 75, cfg: {} }).action === 'show', '空场直接显示');
ok(P.decideDisplay({ current: { sourceId: 'pages', priority: 5 }, priority: 75, cfg: {} }).reason === 'preempt', '弹幕 vs 公告板(5) -> 抢占');
ok(P.decideDisplay({ current: { sourceId: 'hardware', priority: 10 }, priority: 75, cfg: {} }).action === 'show', '弹幕 vs 电脑状态(10) -> 抢占');
ok(P.decideDisplay({ current: { sourceId: 'media', priority: 30 }, priority: 75, cfg: {} }).action === 'show', '弹幕 vs 歌曲(30) -> 抢占');

// ② 手动触发/需连读的功能不许忽略: 语音字幕与截图区域按来源保护
const rSub = P.decideDisplay({ current: { sourceId: 'livetranslate', priority: 40 }, priority: 75, cfg: {} });
ok(rSub.action === 'queue' && rSub.reason === 'protect-source:livetranslate', '弹幕 vs 语音字幕(来源保护) -> 排队, 不抢');
const rOcr = P.decideDisplay({ current: { sourceId: 'ocrregion', priority: 45 }, priority: 75, cfg: {} });
ok(rOcr.action === 'queue' && rOcr.reason === 'protect-source:ocrregion', '弹幕 vs 截图区域(来源保护) -> 排队, 不抢');
ok(P.decideDisplay({ current: { sourceId: 'transient', priority: 90 }, priority: 75, cfg: {} }).reason === 'respect-transient', '弹幕 vs 插件欢迎(transient 90) -> 排队(优先级地板)');
ok(P.decideDisplay({ current: { sourceId: 'transient', priority: 85 }, priority: 95, cfg: {} }).action === 'queue', '硬规则: 当前显示优先级 >= 85 时一律让路(手动结果优先; 想抢就调低 respectPriority)');

// ① 开关: 关掉"中断其它功能"就一律排队
ok(P.decideDisplay({ current: { sourceId: 'pages', priority: 5 }, priority: 75, cfg: { preemptBackground: false } }).reason === 'preempt-disabled', 'preemptBackground=false -> 连公告板也不抢(一律排队)');

// ③ 高价值事件(SC/礼物/上舰)防丢: 排队而不是被顶掉, 且不设过期
ok(P.isHighValue(P.kindOf('SEND_GIFT')) && P.isHighValue(P.kindOf('SUPER_CHAT_MESSAGE')) && P.isHighValue(P.kindOf('GUARD_BUY')), 'kindOf: 礼物/SC/上舰被识别为高价值');
ok(P.kindOf('DANMU_MSG') === 'DANMAKU' && !P.isHighValue('DANMAKU'), 'kindOf: 弹幕是普通类(有时效)');
let q = [];
q = P.enqueue(q, { text: '礼物: 辣条×1', kind: 'GIFT' }, {}, T).queue;
q = P.enqueue(q, { text: '弹幕A', kind: 'DANMAKU' }, {}, T).queue;
const late = P.dequeue(q, {}, T + 60000);   // 60 秒后: 弹幕早该过期, 礼物必须还在
ok(late.expired.length === 1 && late.expired[0].text === '弹幕A', '普通弹幕排队超时被淘汰(30s), 记入 expired');
ok(late.item && late.item.text === '礼物: 辣条×1', '高价值(礼物)排队 60 秒仍不丢, 且优先出队');
let q2 = [];
for (let i = 1; i <= 21; i++) q2 = P.enqueue(q2, { text: 'd' + i, kind: 'DANMAKU' }, {}, T).queue;
ok(q2.length === 20 && q2[0].text === 'd2', '普通队列上限 20: 超出丢最旧(d1 被丢)');

// ④ 重复弹幕聚合: 很多人刷 666 -> 首次显示, 窗口结束补 `666×123`
let m = {}, shown = [], held = 0;
for (let i = 0; i < 123; i++) {
  const r = P.aggregateAccept(m, '666', T + i * 10, {});
  m = r.map;
  if (r.action === 'show') shown.push(r.display); else held++;
}
ok(shown.length === 1 && shown[0] === '666', '首次出现立刻显示原文');
ok(held === 122, '窗口内其余 122 条被压住(不刷屏)');
const fl = P.aggregateFlush(m, T + 123 * 10 + 6000, {});
ok(fl.outputs.length === 1 && fl.outputs[0].display === '666×123', '窗口结束补一条 `666×123`(用户指定格式)');
ok(Object.keys(fl.map).length === 0, '冲刷后聚合表清空');
let m2 = {};
m2 = P.aggregateAccept(m2, '666', T, {}).map;
m2 = P.aggregateAccept(m2, '哈哈哈', T + 100, {}).map;
m2 = P.aggregateAccept(m2, '666', T + 200, {}).map;
m2 = P.aggregateAccept(m2, '哈哈哈', T + 300, {}).map;   // 两条都各自重复一次, 才都有计数行
const fl2 = P.aggregateFlush(m2, T + 300 + 6000, { aggregateFormat: '{text} x{n}' });
const texts = fl2.outputs.map(function (o) { return o.display; }).sort().join('|');
ok(texts === '666 x2|哈哈哈 x2', '不同文本各自聚合, 且格式可配(`{text} x{n}`)');
ok(P.priorityOf('GIFT', {}) === 80 && P.priorityOf('SUPER_CHAT', {}) === 88 && P.priorityOf('DANMAKU', { sourcePriority: { DANMAKU: 82 } }) === 82, '各类事件默认优先级 + 可覆盖');

console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exitCode = fail ? 1 : 0;

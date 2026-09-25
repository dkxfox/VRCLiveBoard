'use strict';
// 事件归一化单测(纯离线, 不需要凭据): node lib/events.test.js
//
// 夹具来源分两类(**诚实标注**):
//   「参考」= 字段形态来自 02-社区协议.md 记录的 CMD 速查与参考实现(blivedm 等)的公开字段名;
//   「合成」= 我按同一套约定"编"的(字段名对得上, 但没在真实流量里见过) —— 接真环境后要用真样例替换。
// 官方开放平台沿用同一批 CMD, 但字段命名可能不同 → 所以断言只锁"宽容读取的结果", 不锁原始字段路径。
const E = require('../lib/events.js');
const P = require('../lib/policy.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

// ---- 弹幕 ----
// 「参考」旧版: info[1]=文本, info[2]=[uid, uname], info[3]=粉丝牌, info[7]=舰长等级
const DANMU_LEGACY = {
  cmd: 'DANMU_MSG',
  info: [
    [0, 1, 25, 16777215, 1700000000000, 0, 0, '', 0, {}, '', 0, 0, null, {}, 0, 0, 0, 0],
    '你好世界',
    [10086, '观众甲', 0, 0, 0, 10000, 1, ''],
    [12, '粉丝牌', 88, 12345, 6067854, '', 0, 16777215],
    [], 0, 0, 3, {}, 0
  ]
};
// 「参考」新版: 用户改到 info[0][15].user.base, 另外整条还有个 dm_v2(protobuf base64)
const DANMU_MODERN = {
  cmd: 'DANMU_MSG',
  info: [[0, 1, 25, 16777215, 1700000000000, 0, 0, '', 0, 0, 0, 0, 0, 0, {}, {
    user: { uid: 20001, base: { name: '观众乙', face: 'https://i0.hdslb.com/bfs/face/x.jpg' }, medal: { level: 7, name: '牌子' } },
    guard_level: 1
  }], '现代版字段', [0, '', 0, 0, 0, 0, 0, '']],
  dm_v2: 'Cg1kYW1udV9leGFtcGxl'
};
const ev1 = E.normalize(DANMU_LEGACY);
ok(ev1 && ev1.kind === 'DANMAKU' && ev1.cmd === 'DANMU_MSG', '弹幕「参考」: 归一化成 DANMAKU');
ok(ev1.text === '你好世界' && ev1.uname === '观众甲' && ev1.uid === 10086, '弹幕「参考」: 文本/用户名/uid 取对');
ok(ev1.guardLevel === 3 && E.guardName(ev1.guardLevel) === '舰长', '弹幕「参考」: info[7] 的舰长等级 3 = 舰长');
ok(ev1.medal && ev1.medal.level === 12 && ev1.medal.name === '粉丝牌', '弹幕「参考」: 粉丝牌等级与名字');
const ev2 = E.normalize(DANMU_MODERN);
ok(ev2.uname === '观众乙' && ev2.uid === 20001 && ev2.face.indexOf('hdslb') > 0, '弹幕「参考」新版: info[0][15].user.base 里的用户名/uid/头像');
ok(ev2.guardLevel === 1 && ev2.medal && ev2.medal.level === 7, '弹幕「参考」新版: 舰长等级与粉丝牌也在新结构里');
ok(ev2.protobuf === true, '弹幕「参考」新版: 带 dm_v2(protobuf) 时只标记 protobuf, 不去硬解');
ok(E.normalize(DANMU_LEGACY).raw === DANMU_LEGACY, '原文挂在 ev.raw 上(排查用, 不复制)');

// ---- 礼物 / 连击 ----
const GIFT = { cmd: 'SEND_GIFT', data: { uname: '观众丙', uid: 30003, giftName: '辣条', num: 5, coin_type: 'silver', price: 100, total_coin: 500, action: '喂食' } };
const g1 = E.normalize(GIFT);
ok(g1.kind === 'GIFT' && g1.gift.name === '辣条' && g1.gift.num === 5, '礼物「参考」: 名称与数量');
ok(g1.gift.coinType === 'silver' && g1.gift.totalCoin === 500 && g1.uname === '观众丙', '礼物「参考」: 瓜子类型/总价值/用户名');
const GIFT_SNAKE = { cmd: 'SEND_GIFT', data: { gift_name: '小心心', num: 2, coin_type: 'gold', total_coin: 20000, user_info: { uname: '观众丁', uid: 40004 } } };
const g2 = E.normalize(GIFT_SNAKE);
ok(g2.gift.name === '小心心' && g2.gift.num === 2 && g2.uname === '观众丁' && g2.uid === 40004, '礼物「合成」: snake_case 与 user_info 嵌套也认');
const COMBO = { cmd: 'COMBO_SEND', data: { gift_name: '牛哇牛哇', combo_num: 20, num: 1, uname: '观众戊', uid: 50005, coin_type: 'gold' } };
const g3 = E.normalize(COMBO);
ok(g3.kind === 'GIFT' && g3.gift.num === 20 && g3.gift.combo === true, '连击「参考」: COMBO_SEND 取 combo_num(不是 num)');

// ---- 醒目留言 ----
const SC = { cmd: 'SUPER_CHAT_MESSAGE', data: { price: 30, message: '这个功能真好用', time: 60, uid: 60006, background_bottom_color: '#2A60B2', user_info: { uname: '观众己' } } };
const sc1 = E.normalize(SC);
ok(sc1.kind === 'SUPER_CHAT' && sc1.superchat.price === 30 && sc1.text === '这个功能真好用', 'SC「参考」: 金额与留言内容');
ok(sc1.superchat.durationSec === 60 && sc1.uname === '观众己' && sc1.superchat.bgColor === '#2A60B2', 'SC「参考」: 展示时长/用户名/背景色');
ok(E.normalize({ cmd: 'SUPER_CHAT_MESSAGE_DELETE', data: { message: 'x' } }).deleted === true, 'SC 撤回: 标 deleted(上层别当成新 SC 播报)');

// ---- 上舰 ----
const GUARD = { cmd: 'GUARD_BUY', data: { uid: 70007, username: '观众庚', guard_level: 3, num: 1, price: 138000, gift_name: '舰长' } };
const gu1 = E.normalize(GUARD);
ok(gu1.kind === 'GUARD' && gu1.guardLevel === 3 && gu1.guard.name === '舰长', '上舰「参考」: GUARD_BUY 等级 3 = 舰长');
ok(gu1.guard.num === 1 && gu1.guard.price === 138000 && gu1.uname === '观众庚', '上舰「参考」: 数量与价格(username 字段也要认)');
const TOAST = { cmd: 'USER_TOAST_MSG', data: { uid: 80008, username: '观众辛', guard_level: 1, role_name: '总督', unit: '月', num: 1, price: 19998000 } };
const gu2 = E.normalize(TOAST);
ok(gu2.kind === 'GUARD' && gu2.guard.name === '总督' && gu2.guard.unit === '月', '上舰「参考」: USER_TOAST_MSG 用 role_name/unit');
ok(E.guardName(1) === '总督' && E.guardName(2) === '提督' && E.guardName(4) === '', '舰长等级映射: 1/2/3 有名, 其余空');

// ---- 互动 ----
const acts = [[1, '进入了直播间'], [2, '关注了主播'], [3, '分享了直播间'], [4, '特别关注了主播'], [5, '互相关注']];
let allAct = true;
for (const [t, name] of acts) {
  const e = E.normalize({ cmd: 'INTERACT_WORD', data: { uid: 9, uname: '观众壬', msg_type: t } });
  if (e.interact.type !== t || e.interact.name !== name) allAct = false;
}
ok(allAct, '互动「参考」: msg_type 1~5 各归各的名字(进房/关注/分享/特别关注/互关)');
const iv2 = E.normalize({ cmd: 'INTERACT_WORD_V2', data: { uid: 9, uname: '观众壬', pb: 'CgtpbnRlcmFjdA==' } });
ok(iv2.kind === 'INTERACT' && iv2.protobuf === true && iv2.interact.name === '', '互动「合成」: V2 是 protobuf 版 -> 只标记, 名字留空(别瞎猜)');

// ---- 进房欢迎 ----
ok(E.normalize({ cmd: 'WELCOME', data: { uid: 10, uname: '路人甲' } }).kind === 'ENTER', '进房「参考」: WELCOME -> ENTER');
const wg = E.normalize({ cmd: 'WELCOME_GUARD', data: { uid: 11, uname: '舰长乙' } });
ok(wg.kind === 'ENTER' && wg.guardLevel === 3, '进房「参考」: WELCOME_GUARD 默认按舰长(3)算');

// ---- 状态类(默认不上聊天框) ----
const wc = E.normalize({ cmd: 'WATCHED_CHANGE', data: { num: 1234, text_small: '1234', text_large: '1234人看过' } });
ok(wc.kind === 'WATCHED' && wc.watched.count === 1234 && wc.watched.text === '1234', '看过人数「参考」: WATCHED_CHANGE');
const orc = E.normalize({ cmd: 'ONLINE_RANK_COUNT', data: { count: 42 } });
ok(orc.kind === 'ONLINE_RANK' && orc.onlineRank.count === 42 && orc.onlineRank.list.length === 0, '高能榜「参考」: ONLINE_RANK_COUNT 只有数字');
const orv2 = E.normalize({ cmd: 'ONLINE_RANK_V2', data: { list: [{ uid: 1, uname: 'A', score: 9 }, { uid: 2, uname: 'B' }] } });
ok(orv2.onlineRank.count === 2 && orv2.onlineRank.list[1].uname === 'B', '高能榜「合成」: ONLINE_RANK_V2 取榜单');
const rst = E.normalize({ cmd: 'ROOM_REAL_TIME_MESSAGE_UPDATE', data: { roomid: 12345, fans: 8888, fans_club: 66 } });
ok(rst.kind === 'ROOM_STATS' && rst.roomStats.fans === 8888 && rst.roomStats.fansClub === 66, '房间数据「参考」: 粉丝数/粉丝团');
ok(E.normalize({ cmd: 'LIKE_INFO_V3_CLICK', data: { uid: 12, uname: '点赞侠' } }).like.clicked === true, '点赞「参考」: LIKE_INFO_V3_CLICK');
ok(E.normalize({ cmd: 'LIKE_INFO_V3_UPDATE', data: { click_count: 777 } }).like.count === 777, '点赞「合成」: LIKE_INFO_V3_UPDATE 的累计数');
ok(E.normalize({ cmd: 'LIVE', data: { live_key: 'x' } }).kind === 'LIVE' && E.normalize({ cmd: 'PREPARING' }).kind === 'PREPARING', '开播/下播「参考」: LIVE / PREPARING');
ok(E.normalize({ cmd: 'ROOM_BLOCK_MSG', data: { uid: 13, uname: '被禁言的' } }).kind === 'BLOCKED', '管理类「参考」: ROOM_BLOCK_MSG -> BLOCKED');

// ---- 兜底: 不认识 / 坏输入 / 纯函数 ----
const unk = E.normalize({ cmd: 'BRAND_NEW_CMD', data: { a: 1 } });
ok(unk.kind === 'UNKNOWN' && unk.raw.cmd === 'BRAND_NEW_CMD', '未知 CMD -> UNKNOWN, 但原文保留(不再"一律当弹幕")');
ok(P.kindOf('BRAND_NEW_CMD') === 'UNKNOWN' && P.kindOf('WATCHED_CHANGE') === 'WATCHED', '策略层与事件层用同一张 CMD 表(单一来源)');
let noThrow = true;
for (const bad of [null, undefined, 'x', 42, [], {}, { cmd: '' }, { cmd: 123 }, { cmd: 'DANMU_MSG', info: 'nonsense', data: 'nonsense' }]) {
  try { E.normalize(bad); } catch (e) { noThrow = false; console.log('    抛出: ' + JSON.stringify(bad) + ' -> ' + e.message); }
}
ok(noThrow, '坏输入一律不抛(null/字符串/数字/数组/空对象/错类型字段)');
ok(E.normalize({ cmd: 'DANMU_MSG', info: 'nonsense', data: 'nonsense' }).kind === 'DANMAKU', 'info/data 类型不对时仍给一个空壳事件(而不是崩)');
const before = JSON.stringify(DANMU_LEGACY);
E.normalize(DANMU_LEGACY);
ok(JSON.stringify(DANMU_LEGACY) === before, 'normalize 不改动传入对象(纯函数)');

// ---- 默认文案 ----
ok(E.defaultText(ev1) === '你好世界', '文案: 弹幕就是弹幕原文(昵称由 step 6 按配置加)');
ok(E.defaultText(g1) === '观众丙 投喂 辣条×5', '文案: 礼物「谁 投喂 什么×几个」');
ok(E.defaultText(sc1).indexOf('SC ¥30') === 0 && E.defaultText(sc1).indexOf('这个功能真好用') > 0, '文案: SC 带金额与内容');
ok(E.defaultText(gu2) === '观众辛 开通总督', '文案: 上舰「谁 开通什么」');
ok(E.defaultText(E.normalize({ cmd: 'INTERACT_WORD', data: { uname: '观众壬', msg_type: 2 } })) === '观众壬关注了主播', '文案: 互动');
ok(E.defaultText(E.normalize({ cmd: 'WELCOME', data: { uname: '路人甲' } })) === '欢迎 路人甲 进入直播间', '文案: 进房欢迎');
ok(E.defaultText(wc) === '' && E.defaultText(unk) === '' && E.defaultText(null) === '', '文案: 状态类/未知/空事件 -> 空(默认不上聊天框)');

// ---- 与策略层的接口对得上 ----
ok(P.isHighValue(E.normalize(SC).kind) && P.isHighValue(E.normalize(GUARD).kind) && P.isHighValue(E.normalize(GIFT).kind), '高价值防丢: SC/上舰/礼物在策略层被认作高价值');
ok(P.priorityOf(E.normalize(GUARD).kind, {}) === 92 && P.priorityOf(E.normalize(SC).kind, {}) === 88 && P.priorityOf(E.normalize(DANMU_LEGACY).kind, {}) === 75, '优先级: 上舰 92 > SC 88 > 弹幕 75(与条目 192 的拍板一致)');

console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exitCode = fail ? 1 : 0;

'use strict';
// B站直播 —— CMD 归一化成统一事件模型(纯函数, 零依赖, 便于离线单测)
//
// 输入: op=5 帧解出来的 JSON(session.js 的 onEvent), 输出: BilibiliEvent 或 null。
// 事件模型(上层只认这个, 不直接摸 B站原始字段):
//   { kind, cmd, uid, uname, face, text, guardLevel, medal, gift, superchat, guard,
//     interact, watched, onlineRank, roomStats, like, deleted, protobuf, ts, raw }
//
// 字段形状的来路(**诚实标注, 别当权威**): 见 02-社区协议.md 的 CMD 速查 —— 那批 CMD 官方开放平台也沿用,
//   但字段命名可能 snake/camel 混用, 新版本还可能整段换成 protobuf(dm_v2 / pb)。所以这里:
//     ① 一律**宽容读取**(两种命名都认 / 缺字段给默认值 / 任何输入都不抛);
//     ② 不认识的 CMD 归 'UNKNOWN', 但把原文挂在 raw 上留着(排查用);
//     ③ 官方通道真连上之后, 用真样例回填 events.test.js 里的夹具(那边标了"参考/合成")。
const P = require('./policy.js');

const GUARD_NAMES = { 1: '总督', 2: '提督', 3: '舰长' };
const INTERACT_NAMES = { 1: '进入了直播间', 2: '关注了主播', 3: '分享了直播间', 4: '特别关注了主播', 5: '互相关注' };

function guardName(level) { return GUARD_NAMES[Number(level)] || ''; }
function interactName(type) { return INTERACT_NAMES[Number(type)] || ''; }

// 宽容读取的第一块砖: 按顺序取第一个"有值"的路径(a.b.c 也可以, 数组下标写 info.1)
function pick(obj, paths) {
  for (var i = 0; i < paths.length; i++) {
    var cur = obj, parts = String(paths[i]).split('.'), found = true;
    for (var j = 0; j < parts.length; j++) {
      if (cur === null || cur === undefined || typeof cur !== 'object') { found = false; break; }
      cur = cur[parts[j]];
    }
    if (found && cur !== null && cur !== undefined && cur !== '') return cur;
  }
  return undefined;
}
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function str(v) { return v === null || v === undefined ? '' : String(v); }

// 用户信息: 新版 DANMU_MSG 把用户塞在 info[0][15].user.base, 旧版在 info[2]; data 里也可能有
function userOf(raw, d) {
  const info = Array.isArray(raw.info) ? raw.info : null;
  const legacy = info && Array.isArray(info[2]) ? info[2] : null;
  const modern = info && Array.isArray(info[0]) && info[0] && info[0][15] ? info[0][15] : null;
  return {
    uid: num(pick(d, ['uid', 'user_info.uid', 'user.uid'])) || num(pick(modern, ['user.uid', 'uid'])) || num(legacy ? legacy[0] : 0),
    uname: str(pick(d, ['uname', 'username', 'user_info.uname', 'user_info.base.name', 'user.base.name', 'user.uname']) ||
               pick(modern, ['user.base.name', 'user.uname']) || (legacy ? legacy[1] : '')),
    face: str(pick(d, ['face', 'user_info.face', 'user.base.face']) || pick(modern, ['user.base.face']) || '')
  };
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cmd = str(pick(raw, ['cmd', 'CMD'])).toUpperCase();
  if (!cmd) return null;
  const d = (raw.data && typeof raw.data === 'object') ? raw.data : {};
  const u = userOf(raw, d);
  const ev = {
    kind: P.kindOf(cmd), cmd: cmd,
    uid: u.uid, uname: u.uname, face: u.face,
    text: '', guardLevel: num(pick(d, ['guard_level', 'guardLevel'])), medal: null,
    gift: null, superchat: null, guard: null, interact: null,
    watched: null, onlineRank: null, roomStats: null, like: null,
    deleted: /_DELETE$/.test(cmd),                 // SC 被撤回
    protobuf: !!(raw.dm_v2 || d.pb || raw.pb),     // 新版把业务字段塞进 protobuf(base64), 这里只标记不解析
    ts: Date.now(), raw: raw
  };

  if (ev.kind === 'DANMAKU') {
    const info = Array.isArray(raw.info) ? raw.info : [];
    ev.text = str(pick(raw, ['info.1']) || pick(d, ['text', 'msg', 'content']));
    if (Array.isArray(info[3])) ev.medal = { level: num(info[3][0]), name: str(info[3][1]) };
    // 舰长等级三个来路: data.guard_level / 新版 info[0][15].guard_level / 旧版 info[7]
    if (!ev.guardLevel && typeof info[7] === 'number') ev.guardLevel = info[7];
    if (!ev.guardLevel && info[0] && info[0][15]) ev.guardLevel = num(pick(info[0][15], ['guard_level', 'guardLevel']));
    if (!ev.medal && info[0] && info[0][15]) {
      const m = pick(info[0][15], ['user.medal', 'medal']);
      if (m && typeof m === 'object') ev.medal = { level: num(pick(m, ['level', 'medal_level'])), name: str(pick(m, ['name', 'medal_name'])) };
    }
  } else if (ev.kind === 'GIFT') {
    const combo = cmd === 'COMBO_SEND';
    ev.gift = {
      name: str(pick(d, ['giftName', 'gift_name'])),
      num: num(pick(d, combo ? ['combo_num', 'num'] : ['num', 'combo_num'])) || 1,
      coinType: str(pick(d, ['coin_type', 'coinType'])),
      price: num(pick(d, ['price'])),
      totalCoin: num(pick(d, ['total_coin', 'totalCoin'])),
      combo: combo
    };
    ev.text = ev.gift.name;
  } else if (ev.kind === 'SUPER_CHAT') {
    ev.superchat = {
      price: num(pick(d, ['price'])),
      durationSec: num(pick(d, ['time', 'duration'])),
      bgColor: str(pick(d, ['background_bottom_color', 'background_color', 'backgroundBottomColor']))
    };
    ev.text = str(pick(d, ['message']));
  } else if (ev.kind === 'GUARD') {
    const level = num(pick(d, ['guard_level', 'guardLevel'])) || ev.guardLevel;
    ev.guardLevel = level;
    ev.guard = {
      level: level,
      name: str(pick(d, ['role_name', 'gift_name'])) || guardName(level),
      num: num(pick(d, ['num'])) || 1,
      unit: str(pick(d, ['unit'])),
      price: num(pick(d, ['price']))
    };
  } else if (ev.kind === 'INTERACT') {
    const t = num(pick(d, ['msg_type', 'msgType', 'type']));
    ev.interact = { type: t, name: interactName(t) };
  } else if (ev.kind === 'ENTER') {
    if (cmd === 'WELCOME_GUARD') ev.guardLevel = num(pick(d, ['guard_level'])) || 3;
  } else if (ev.kind === 'WATCHED') {
    ev.watched = { count: num(pick(d, ['num'])), text: str(pick(d, ['text_small', 'text_large'])) };
  } else if (ev.kind === 'ONLINE_RANK') {
    const list = Array.isArray(d.list) ? d.list : [];
    ev.onlineRank = {
      count: num(pick(d, ['count'])) || list.length,
      list: list.map(function (x) { return { uid: num(pick(x, ['uid'])), uname: str(pick(x, ['uname', 'name'])) }; })
    };
  } else if (ev.kind === 'ROOM_STATS') {
    ev.roomStats = { fans: num(pick(d, ['fans'])), fansClub: num(pick(d, ['fans_club', 'fansClub'])) };
  } else if (ev.kind === 'LIKE') {
    ev.like = { clicked: cmd === 'LIKE_INFO_V3_CLICK', count: num(pick(d, ['click_count', 'clickCount'])) };
  }
  return ev;
}

// 默认聊天框文案(不带任何配置项; step 6 会在这上面套"前缀/昵称/截断"等配置)
// 注意: 空字符串 = "这类事件默认不上聊天框"(状态类事件如 LIVE/WATCHED/ONLINE_RANK/UNKNOWN 都留空)
function defaultText(ev) {
  if (!ev) return '';
  const who = ev.uname || (ev.uid ? 'uid:' + ev.uid : '');
  if (ev.kind === 'DANMAKU') return ev.text;
  if (ev.kind === 'GIFT') return who + ' 投喂 ' + ev.gift.name + '×' + ev.gift.num;
  if (ev.kind === 'SUPER_CHAT') return 'SC ¥' + ev.superchat.price + ' ' + who + ': ' + ev.text;
  if (ev.kind === 'GUARD') return who + ' 开通' + (ev.guard.name || '') + (ev.guard.num > 1 ? '×' + ev.guard.num : '');
  if (ev.kind === 'INTERACT') return who + ev.interact.name;
  if (ev.kind === 'ENTER') return '欢迎 ' + who + ' 进入直播间';
  if (ev.kind === 'LIKE') return who + ' 点赞了直播间';
  return '';
}

module.exports = {
  normalize: normalize, defaultText: defaultText,
  guardName: guardName, interactName: interactName,
  GUARD_NAMES: GUARD_NAMES, INTERACT_NAMES: INTERACT_NAMES
};

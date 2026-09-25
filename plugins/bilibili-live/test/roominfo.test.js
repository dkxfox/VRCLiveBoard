'use strict';
// 直播间信息文案单测(纯离线, 不联网): node test/roominfo.test.js
const R = require('../lib/roominfo.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

ok(R.formatPopularity(0) === '0' && R.formatPopularity(999) === '999', '人数格式化: 小数字原样');
ok(R.formatPopularity(12345) === '1.2万' && R.formatPopularity(12000) === '1.2万' && R.formatPopularity(10000) === '1万', '人数格式化: 万');
ok(R.formatPopularity(345678901) === '3.5亿', '人数格式化: 亿');

const info = { roomId: 12345, title: '来聊天', popularity: 12345 };
ok(R.buildRoomInfoText(info, {}) === '【直播间】来聊天 · 房间 12345', '默认: 标题 + 房间号(热度默认关, 不显示)');
ok(R.buildRoomInfoText(info, { showRoomPopularity: true }) === '【直播间】来聊天 · 房间 12345 · 热度 1.2万', '打开热度开关: 多一段"热度 1.2万"');
ok(R.buildRoomInfoText(info, { showRoomTitle: false }) === '【直播间】房间 12345', '关掉标题: 只剩房间号');
ok(R.buildRoomInfoText(info, { showRoomId: false, showRoomPopularity: true }) === '【直播间】来聊天 · 热度 1.2万', '关掉房间号: 只剩标题与热度');
ok(R.buildRoomInfoText(info, { roomInfoPrefix: '[LIVE] ' }) === '[LIVE] 来聊天 · 房间 12345', '前缀可配');
ok(R.buildRoomInfoText(info, { roomInfoPrefix: '' }) === '来聊天 · 房间 12345', '前缀可以清空');
ok(R.buildRoomInfoText({ roomId: 0, title: '', popularity: 0 }, {}) === '', '什么都没有 -> 空串(上层据此不显示)');
ok(R.buildRoomInfoText({ roomId: 99, title: '' }, {}) === '【直播间】房间 99', '只有房间号也能显示(标题要等开播事件)');
ok(R.buildRoomInfoText(info, { showRoomTitle: false, showRoomId: false, showRoomPopularity: false }) === '', '三个开关全关 -> 空串(等于不展示)');
ok(R.buildRoomInfoText(null, {}) === '', '空对象不崩');
ok(R.buildRoomInfoText({ roomId: 1, title: 'x', popularity: 5 }, { showRoomPopularity: true }) === '【直播间】x · 房间 1 · 热度 5', '热度不足一万按原数显示');

const picked = R.pickRoomInfo({ data: { room_id: 777, title: '标题A', online: 45678, live_status: 1, area_name: '虚拟主播' } });
ok(picked.roomId === 777 && picked.title === '标题A' && picked.popularity === 45678 && picked.liveStatus === 1 && picked.areaName === '虚拟主播', 'pickRoomInfo: 读公开接口的返回');
ok(R.pickRoomInfo(null).roomId === 0 && R.pickRoomInfo({}).title === '', 'pickRoomInfo: 空返回不崩');
ok(R.pickRoomInfo({ data: { roomId: 5, online: '7' } }).popularity === 7, 'pickRoomInfo: 驼峰字段与字符串数字也认');

console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exitCode = fail ? 1 : 0;

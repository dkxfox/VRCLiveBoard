'use strict';
// 连接层单测: 用 test/fake-ws-server.js 起**真**的本地 WebSocket 服务, 走真握手真 TCP, 但仍然不联网、不需要凭据。
// 覆盖: 认证帧原文 / 认证成功 / 双心跳按配置发 / 消息派发 / 半包跨两个 WS 帧 / 认证超时重连 / 掉线重连 / 退避递增 / stop 收尾。
const { createFakeServer, encodeFrame } = require('../test/fake-ws-server.js');
const F = require('../lib/frame.js');
const { createSession } = require('../lib/session.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
const AUTH = JSON.stringify({ roomid: 12345, uid: 0, protover: 3, platform: 'web', key: 'FAKE-AUTH-BODY' });

// ① 正常路径: 认证 → 双心跳 → 收消息(含半包)
(async function () {
  let lastApi = null, projBeats = 0;
  const srv = await createFakeServer({ onAuth: function (body, api) { lastApi = api; } });
  const logs = [];
  const sess = createSession({
    hosts: [srv.url], authBody: AUTH, gameId: 'GAME-1',
    wsHeartbeatMs: 60, projectHeartbeatMs: 50,
    wsFactory: function (u) { return new WebSocket(u); },
    postHeartbeat: function () { projBeats += 1; return Promise.resolve(); },
    postEnd: function () { return Promise.resolve(); },
    onEvent: function (j) { events.push(j.cmd); },
    onLog: function (m) { logs.push(m); }
  });
  const events = [];
  sess.start();
  await sleep(220);
  ok(srv.state.authBodies.length >= 1 && srv.state.authBodies[0] === AUTH, '认证帧原文与 auth_body 完全一致(真 WS 往返)');
  ok(sess.state.authed === true, '收到 op=8 后进入已认证');
  ok(srv.state.heartbeats >= 2, '连接心跳按配置发送(' + srv.state.heartbeats + ' 次, 间隔 60ms)');
  ok(projBeats >= 3, '项目心跳按配置发送(' + projBeats + ' 次, 间隔 50ms)');
  // 整帧 + 半包
  const msg = F.encode(F.OP.MESSAGE, { cmd: 'DANMU_MSG', info: [[], '你好'] });
  lastApi.sendBytes(msg);
  await sleep(60);
  ok(events.length === 1 && events[0] === 'DANMU_MSG', '消息帧派发到 onEvent');
  const msg2 = F.encode(F.OP.MESSAGE, { cmd: 'SEND_GIFT', data: { giftName: '辣条' } });
  const k = Math.floor(msg2.length / 2);
  lastApi.sendBytes(msg2.slice(0, k), true);          // true = 半帧: 期间的自动心跳回应由夹具排队, 不插到半帧中间
  await sleep(40);
  ok(events.length === 1, '半包不发事件(等另一半)');
  lastApi.sendBytes(msg2.slice(k), false);            // false = 补完半帧, 放行排队的帧
  await sleep(60);
  ok(events.length === 2 && events[1] === 'SEND_GIFT', '半个帧拼上后正确派发');
  // 压缩帧(服务端打包多条)也要能过
  const zlib = require('zlib');
  const bundled = Buffer.concat([F.encode(F.OP.MESSAGE, { cmd: 'SUPER_CHAT_MESSAGE' }), F.encode(F.OP.MESSAGE, { cmd: 'GUARD_BUY' })]);
  lastApi.sendBytes(F.encode(F.OP.MESSAGE, zlib.brotliCompressSync(bundled), F.PROTOVER.BROTLI));
  await sleep(80);
  ok(events.length === 4 && events[2] === 'SUPER_CHAT_MESSAGE' && events[3] === 'GUARD_BUY', 'brotli 打包帧在真连接里展开成 2 条');
  await sess.stop();
  ok(srv.state.connections === 1, 'stop() 后不再新建连接');
  srv.close();
})().then(async function () {
  // ② 认证超时 -> 退避重连(抖动设为 0, 让退避可断言)
  const srv2 = await createFakeServer({ autoAuthReply: false });
  const logs2 = [];
  const s2 = createSession({
    hosts: [srv2.url], authBody: AUTH, gameId: 'G2',
    authTimeoutMs: 70, backoffBaseMs: 40, backoffMaxMs: 320, jitterRatio: 0,
    wsHeartbeatMs: 1000, projectHeartbeatMs: 1000,
    wsFactory: function (u) { return new WebSocket(u); },
    onLog: function (m) { logs2.push(m); }
  });
  s2.start();
  await sleep(420);
  ok(srv2.state.connections >= 2, '认证超时会断开并重连(连接数 ' + srv2.state.connections + ')');
  const waits = logs2.filter(function (m) { return m.indexOf('重连#') === 0; }).map(function (m) { return Number((m.match(/(\d+)ms/) || [])[1]); });
  ok(waits.length >= 2 && waits[1] === waits[0] * 2, '退避按 2 倍递增(' + waits.slice(0, 3).join(' -> ') + ' ms)');
  ok(s2.state.authed === false, '一直没认证成功时不会假装成功');
  await s2.stop();
  srv2.close();
}).then(async function () {
  // ③ 掉线重连: 第一次连接收认证帧后立刻断线, 第二次应能认证成功
  let n = 0;
  const srv3 = await createFakeServer({ onAuth: function (body, api) { n += 1; if (n === 1) api.close(); } });
  const s3 = createSession({
    hosts: [srv3.url, srv3.url], authBody: AUTH, gameId: 'G3',
    authTimeoutMs: 500, backoffBaseMs: 40, backoffMaxMs: 200, jitterRatio: 0,
    wsHeartbeatMs: 1000, projectHeartbeatMs: 1000,
    wsFactory: function (u) { return new WebSocket(u); },
    onLog: function () {}
  });
  s3.start();
  await sleep(450);
  ok(srv3.state.connections >= 2, '掉线后自动重连(连接数 ' + srv3.state.connections + ')');
  ok(s3.state.authed === true, '重连后认证成功(退避与重试链路打通)');
  await s3.stop();
  srv3.close();
}).then(async function () {
  // ④ stop(): 要发"结束场次"
  const srv4 = await createFakeServer({});
  let ended = 0;
  const s4 = createSession({
    hosts: [srv4.url], authBody: AUTH, gameId: 'G4',
    wsHeartbeatMs: 1000, projectHeartbeatMs: 1000,
    wsFactory: function (u) { return new WebSocket(u); },
    postEnd: function (g) { ended += 1; ok(g === 'G4', 'postEnd 收到正确的 game_id'); return Promise.resolve(); },
    onLog: function () {}
  });
  s4.start();
  await sleep(180);
  await s4.stop();
  ok(ended === 1, 'stop() 会调用一次"结束场次"');
  srv4.close();
  console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
  process.exitCode = fail ? 1 : 0;
}).catch(function (e) { console.log('  FAIL 连接层单测异常: ' + (e && e.stack || e)); process.exitCode = 1; });

'use strict';
// 插件契约单测(纯离线, 不需要凭据): node test/index.test.js
// 用假 ctx + 假 WebSocket 把**真实的插件对象**整条链路跑一遍:
//   apply → start(官方 start 接口) → wss 认证(op=7 → op=8) → 收到弹幕帧 → events → bridge → ctx.chatbox.send
// 顺带盯住两条安全约定: ① 缺凭据/报错里只出现**字段名**, 不出现值; ② 密钥不进日志、不进请求 URL。
const F = require('../lib/frame.js');
const plugin = require('../index.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
const CREDS = { accessKeyId: 'AKID12345678', accessKeySecret: 'SECRET-VALUE-XYZ', appId: '9999999999', roomOwnerAuthCode: 'AUTH-CODE-ABC' };

function mkCtx(cfg) {
  const calls = { http: [], sent: [], ticks: [], logs: [], warns: [], stopped: 0 };
  const ctx = {
    config: Object.assign({}, cfg),
    logger: { info: function (m) { calls.logs.push(String(m)); }, warn: function (m) { calls.warns.push(String(m)); } },
    chatbox: {
      send: function (text, opts) { calls.sent.push({ text: text, opts: opts || {} }); },
      current: function () { return ctx.chatbox._cur || null; }
    },
    events: { every: function (ms, fn) { calls.ticks.push(fn); return function () { calls.stopped += 1; }; } },
    http: {
      request: function (url, opts) {
        calls.http.push({ url: url, headers: (opts && opts.headers) || {}, body: (opts && opts.body) || '' });
        const isStart = url.indexOf('/start') >= 0;
        const data = isStart
          ? { code: 0, data: { game_id: 'GAME-TEST-1', host_server_url_list: ['wss://fake.chat.bilibili.com/sub'], auth_body: 'FAKE-AUTH-BODY', anchor_info: { uid: 42, open_id: 'anchor-open', room_id: 123, uname: '测试主播' } } }
          : { code: 0, data: {} };
        return Promise.resolve({ status: 200, text: function () { return Promise.resolve(JSON.stringify(data)); } });
      }
    }
  };
  return { ctx: ctx, calls: calls };
}
// 假 WebSocket: 连上就发认证帧 -> 服务器立刻回 op=8 -> 之后可以喂任意帧
function installFakeWS() {
  const socks = [];
  global.WebSocket = function (url) {
    const ws = { url: url, readyState: 0, sent: [], onopen: null, onmessage: null, onerror: null, onclose: null, binaryType: '' };
    socks.push(ws);
    ws.send = function (bytes) {
      ws.sent.push(bytes);
      const frames = F.decodeWithRest(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)).frames;
      for (const f of frames) if (f.op === F.OP.AUTH) {
        setTimeout(function () { ws.onmessage({ data: F.encode(F.OP.AUTH_REPLY, { code: 0 }) }); }, 0);
      }
    };
    ws.close = function () { ws.readyState = 3; if (ws.onclose) ws.onclose(); };
    setTimeout(function () { ws.readyState = 1; if (ws.onopen) ws.onopen(); }, 0);
    return ws;
  };
  return socks;
}
function push(ws, raw) { ws.onmessage({ data: F.encode(F.OP.MESSAGE, raw) }); }

(async function () {
  const socks = installFakeWS();

  // ---- ① 缺凭据: 不联网、报错只说字段名 ----
  {
    const h = mkCtx({});
    const p = plugin(h.ctx);
    ok(typeof p.apply === 'function' && typeof p.dispose === 'function' && p.api && typeof p.api.test === 'function', '插件导出契约: apply / dispose / api.test');
    await p.apply();
    ok(h.calls.http.length === 0 && socks.length === 0, '缺凭据时 apply 不发起任何网络连接');
    const st = p.api.status();
    ok(st.missing.length === 4 && st.missing.join(',').indexOf('access_key_id') >= 0, 'status 列出缺哪四个参数(字段名)');
    ok(h.calls.warns.join(' ').indexOf('SECRET') < 0 && h.calls.logs.join(' ').indexOf('SECRET') < 0, '日志里没有密钥值');
    const t = await p.api.test();
    ok(t.ok === false && t.missing.length === 4 && String(t.error).indexOf('还缺') === 0 && String(t.error).indexOf('access_key_secret') >= 0, 'api.test 缺凭据直接拒绝(只说字段名)');
  }

  // ---- ② 凭据齐全: 整条链路(假 WebSocket) ----
  {
    const h = mkCtx(CREDS);
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    ok(h.calls.http.length >= 1 && h.calls.http[0].url.indexOf('live-open.biliapi.com') >= 0, 'apply 自动连接: 请求打到官方 start 接口');
    const hdr = h.calls.http[0].headers;
    ok(!!hdr.Authorization && hdr['x-bili-accesskeyid'] === CREDS.accessKeyId, '请求头带签名与 access key(凭据只在头里)');
    ok(h.calls.http[0].url.indexOf(CREDS.accessKeySecret) < 0 && JSON.stringify(h.calls.http[0]).indexOf(CREDS.accessKeySecret) < 0, 'secret 不出现在 URL 或请求体里(只在签名里)');
    ok(h.calls.logs.join(' ').indexOf('AKID…(') >= 0 || h.calls.logs.join(' ').indexOf('AKID…') >= 0, '日志里 access_key_id 只留前 4 位');
    ok(h.calls.logs.join(' ').indexOf(CREDS.accessKeySecret) < 0 && h.calls.logs.join(' ').indexOf(CREDS.roomOwnerAuthCode) < 0, '日志里没有 secret 与身份码');
    ok(socks.length === 1 && socks[0].url.indexOf('fake.chat.bilibili.com') >= 0, '按 start 返回的地址建立了弹幕长连接');
    const authFrames = socks[0].sent.filter(function (b) { return F.decode(Buffer.isBuffer(b) ? b : Buffer.from(b)).some(function (f) { return f.op === F.OP.AUTH; }); });
    ok(authFrames.length === 1, '连上后发了一条 op=7 认证帧');
    ok(h.calls.ticks.length === 1, '注册了每秒 tick(桥的补发/聚合窗口)');
    const st = p.api.status();
    ok(st.running === true && st.authed === true && st.gameId === 'GAME-TEST-1', 'status: 运行中 + 已认证 + 场次号');

    // 喂一条弹幕 -> 应该出现在聊天框
    push(socks[0], { cmd: 'DANMU_MSG', info: [[], '你好世界', [10086, '观众甲', 0, 0, 0, 10000, 1, '']] });
    ok(h.calls.sent.length === 1 && h.calls.sent[0].text === '观众甲: 你好世界', '弹幕经 events→bridge 推到聊天框(真实链路)');
    ok(h.calls.sent[0].opts.priority === 75 && h.calls.sent[0].opts.ttlMs === 8000, '弹幕优先级 75 / 8 秒');
    // 紧接着来的 SC 会被节流挡下 -> 进排队(这正是设计行为), 等节流窗口过去由 tick 补发
    push(socks[0], { cmd: 'SUPER_CHAT_MESSAGE', data: { price: 30, message: '好用', time: 60, uid: 2, user_info: { uname: '老板' } } });
    ok(h.calls.sent.length === 1 && p.api.status().queue.waiting === 1, '1.5 秒节流内的 SC 先排队(不刷屏)');
    await sleep(1600);
    h.calls.ticks[0]();
    const scCall = h.calls.sent[h.calls.sent.length - 1];
    ok(h.calls.sent.length === 2 && scCall.text.indexOf('SC ¥30') === 0 && scCall.opts.priority === 88 && scCall.opts.force === true, '节流窗口过后: SC 补发, 优先级 88 + force(高价值)');
    ok(p.api.status().events === 2 && p.api.status().shown === 2, 'status 统计收到/显示条数');

    // 预览接口: 不联网也能看到效果
    const pv = p.api.preview({ kind: 'GIFT', text: '辣条' });
    ok(pv.ok === true && pv.text.indexOf('辣条') >= 0, 'api.preview 用假事件走完整管线(不需要凭据)');

    // dispose: 收尾(停 tick + 发结束场次 + 断连)
    await p.dispose();
    ok(h.calls.stopped === 1 && p.api.status().running === false, 'dispose: 停掉 tick 并且不再运行');
    ok(h.calls.http.some(function (c) { return c.url.indexOf('/end') >= 0; }), 'dispose 发了"结束场次"');
    ok(socks[0].readyState === 3, '长连接已断开');
  }

  // ---- ③ api.test: 走 start→end, 成功即按 autoStart 开始接收 ----
  {
    const h = mkCtx(Object.assign({}, CREDS, { autoStart: true }));
    const p = plugin(h.ctx);
    const t = await p.api.test();
    ok(t.ok === true && t.gameId === 'GAME-TEST-1' && t.ended === true, 'api.test: start→end 成功并返回场次(不含任何凭据)');
    ok(JSON.stringify(t).indexOf(CREDS.accessKeySecret) < 0 && JSON.stringify(t).indexOf(CREDS.roomOwnerAuthCode) < 0, 'api.test 返回值里没有凭据');
    ok(t.started === true && p.api.status().running === true, '测试通过后按 autoStart 自动开始接收');
    await p.dispose();
  }
  {
    const h = mkCtx(Object.assign({}, CREDS, { autoStart: false }));
    const p = plugin(h.ctx);
    const t = await p.api.test();
    ok(t.ok === true && !t.started && p.api.status().running === false, 'autoStart=false 时测试连接不会顺手开始接收');
  }

  // ---- ④ 开放平台链路 + 主播自己的消息(2026-09-20: 官方通道 CMD 名与网页不同, 且会推回主播自己的弹幕) ----
  {
    const h = mkCtx(CREDS);
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    const ws = socks[socks.length - 1];
    push(ws, { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '观众子', open_id: 'open-viewer', msg: '来自开放平台' } });
    ok(h.calls.sent.length === 1 && h.calls.sent[0].text === '观众子: 来自开放平台', '开放平台弹幕(LIVE_OPEN_PLATFORM_DM)能一路推到聊天框');
    push(ws, { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '测试主播', open_id: 'anchor-open', msg: '我自己说的话' } });
    ok(h.calls.sent.length === 1 && p.api.status().selfSkipped === 1, '主播自己发的消息默认被忽略(开放平台靠 open_id 认人, 不是 uid)');
    ok(h.calls.logs.concat(h.calls.warns).join(' ').indexOf('已忽略主播自己发的消息') >= 0, '忽略时给一次性提示(否则用户会以为插件坏了)');
    push(ws, { cmd: 'LIVE_OPEN_PLATFORM_SUPER_CHAT', data: { uname: '老板', message: '支持一下', rmb: 30, start_time: 100, end_time: 160, open_id: 'open-boss' } });
    await sleep(1600); h.calls.ticks[0]();
    const scl = h.calls.sent[h.calls.sent.length - 1];
    ok(scl.text.indexOf('SC ¥30') === 0, '开放平台 SC(金额字段叫 rmb)也认得');
    push(ws, { cmd: 'LIVE_OPEN_PLATFORM_INTERACTION_END', data: { game_id: 'GAME-TEST-1' } });
    ok(p.api.status().running === false && h.calls.warns.join(' ').indexOf('平台主动停止推送') >= 0, '平台停推通知: 结束当前场次并提示会重新开局');
    await p.dispose();
  }
  {
    const h = mkCtx(Object.assign({}, CREDS, { ignoreSelf: false }));
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    push(socks[socks.length - 1], { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '测试主播', open_id: 'anchor-open', msg: '我自己说的话' } });
    ok(h.calls.sent.length === 1 && h.calls.sent[0].text === '测试主播: 我自己说的话', '关掉"忽略主播自己"后, 自己的消息也会上聊天框(可配置)');
    await p.dispose();
  }

  console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) { console.log('  FAIL 插件契约单测异常: ' + (e && e.stack || e)); process.exitCode = 1; });

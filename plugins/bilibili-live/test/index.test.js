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
  const calls = { http: [], sent: [], ticks: [], logs: [], warns: [], stopped: 0, sources: [], unregistered: [] };
  const ctx = {
    id: 'bilibili-live',
    config: Object.assign({}, cfg),
    registerSource: function (src) { calls.sources.push(src); return src; },
    plugins: { composer: { unregisterSource: function (id) { calls.unregistered.push(id); } } },
    logger: { info: function (m) { calls.logs.push(String(m)); }, warn: function (m) { calls.warns.push(String(m)); } },
    chatbox: {
      send: function (text, opts) { calls.sent.push({ text: text, opts: opts || {} }); },
      current: function () { return ctx.chatbox._cur || null; }
    },
    events: { every: function (ms, fn) { calls.ticks.push(fn); return function () { calls.stopped += 1; }; } },
    http: {
      request: function (url, opts) {
        calls.http.push({ url: url, headers: (opts && opts.headers) || {}, body: (opts && opts.body) || '' });
        if (url.indexOf('api.live.bilibili.com') >= 0) {                 // 公开房间信息接口(只有"显示热度"才会请求)
          return Promise.resolve({ status: 200, text: function () { return Promise.resolve(JSON.stringify({ code: 0, data: { room_id: 123, title: '更准的标题', online: 45678, live_status: 1, area_name: '虚拟主播' } })); } });
        }
        const isStart = url.indexOf('/start') >= 0;
        const data = isStart
          // 真实形状(2026-09-25 实机 + blivedm 印证): game_info / websocket_info(wss_link, auth_body) / anchor_info
          ? { code: 0, data: { game_info: { game_id: 'GAME-TEST-1' }, websocket_info: { wss_link: ['wss://fake.chat.bilibili.com/sub'], auth_body: 'FAKE-AUTH-BODY' }, anchor_info: { uid: 42, open_id: 'anchor-open', room_id: 123, uname: '测试主播' } } }
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

  // ---- ⑤ 配置热更新(2026-09-25 用户实机: "弹幕带昵称关了还带昵称" —— 桥快照了旧配置) ----
  {
    const h = mkCtx(CREDS);
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    const ws = socks[socks.length - 1];
    push(ws, { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '观众', open_id: 'o1', msg: '第一条' } });
    ok(h.calls.sent.length === 1 && h.calls.sent[0].text === '观众: 第一条', '(前提)默认带昵称');
    h.ctx.config.showUname = false;                       // 等价于"设置面板保存了"
    const rc = p.api.reloadConfig();
    ok(rc.ok === true && rc.effective.showUname === false, 'api.reloadConfig: 重新读配置, 并回报当前真正生效的值');
    await sleep(1600); h.calls.ticks[0]();                 // 让节流窗口过去
    push(ws, { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '观众', open_id: 'o1', msg: '第二条' } });
    ok(h.calls.sent.length === 2 && h.calls.sent[1].text === '第二条', '关掉"弹幕带昵称"后**不用重启插件**立即生效(第二条没有昵称)');
    // 第二条路径: 前端没调 reloadConfig(比如直接改了 config.json), 每秒 tick 也会同步
    h.ctx.config.showUname = true;
    h.calls.ticks[0]();
    await sleep(1600); h.calls.ticks[0]();
    push(ws, { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '观众', open_id: 'o1', msg: '第三条' } });
    ok(h.calls.sent.length === 3 && h.calls.sent[2].text === '观众: 第三条', '改回去也一样: 每秒 tick 会自动同步配置(不依赖前端调用)');
    ok(p.api.status().effective && p.api.status().effective.showUname === true, 'status.effective 报出真正生效的配置(排查"设置没生效"用)');
    await p.dispose();
  }

  // ---- ⑥ 会话重开 + 丢弃原因(2026-09-25 实机: 一串 "丢弃(expired)") ----
  {
    const h = mkCtx(Object.assign({}, CREDS, { restartDelayMs: 10 }));
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    const ws1 = socks[socks.length - 1];
    push(ws1, { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '观众', open_id: 'o1', msg: '重开前的消息' } });
    ok(h.calls.sent.length === 1 && h.calls.sent[0].text === '观众: 重开前的消息', '(前提)第一条正常上屏');
    // 平台停推 -> 10ms 后自动重开; 重开**不能**换桥
    const socksBefore = socks.length;
    push(ws1, { cmd: 'LIVE_OPEN_PLATFORM_INTERACTION_END', data: { game_id: 'GAME-TEST-1' } });
    await sleep(80);
    ok(socks.length === socksBefore + 1 && p.api.status().running === true, '平台停推后已自动重开(新连接)');
    const tickNow = h.calls.ticks[h.calls.ticks.length - 1];     // 重开后注册的是新 tick
    await sleep(1600); tickNow();                                // 过掉节流窗口
    push(socks[socks.length - 1], { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '观众', open_id: 'o1', msg: '重开后的消息' } });
    ok(h.calls.sent.length === 2 && h.calls.sent[1].text === '观众: 重开后的消息', '重开之后弹幕照常上屏(**没被自己上一条挡住** —— 桥被复用, 记忆没丢)');
    await p.dispose();
  }
  {
    // 过期丢弃必须说明"等不到上屏的原因"(用户日志里只看到"丢弃"是没法排查的)
    const h = mkCtx(Object.assign({}, CREDS, { showUname: false }));
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    h.ctx.config.danmakuQueueTtlMs = 300;                                                        // 把 30 秒时效调短, 测试才跑得快
    p.api.reloadConfig();
    h.ctx.chatbox._cur = { sourceId: 'transient', priority: 99, text: '别人的高优先级公告' };   // 永久占屏
    const ws = socks[socks.length - 1];
    push(ws, { cmd: 'LIVE_OPEN_PLATFORM_DM', data: { uname: '观众', open_id: 'o2', msg: '会被挡住的' } });
    ok(p.api.status().queue.waiting === 1, '(前提)被 99 优先级占屏挡下 -> 进排队');
    for (let i = 0; i < 20; i++) { await sleep(40); h.calls.ticks[h.calls.ticks.length - 1](); }   // 熬过 300ms 时效
    const dropMsg = h.calls.warns.concat(h.calls.logs).join(' | ');
    ok(dropMsg.indexOf('丢弃') >= 0 && dropMsg.indexOf('respect-transient') >= 0, '过期丢弃的日志写明了等待原因(而不是只说"丢弃")');
    await p.dispose();
  }
  {
    // 已在接收时点"测试连接": 不该再开一个场次(平台会掐掉正在跑的, 导致反复重开 + 7010)
    const h = mkCtx(CREDS);
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    const startsBefore = h.calls.http.filter(function (c) { return c.url.indexOf('/start') >= 0; }).length;
    const t = await p.api.test();
    const startsAfter = h.calls.http.filter(function (c) { return c.url.indexOf('/start') >= 0; }).length;
    ok(t.ok === true && t.already === true && startsAfter === startsBefore, '正在接收时「测试连接」直接返回"已在接收", 不再新开场次');
    await p.dispose();
  }

  // ---- ⑦ 高价值"保持展示"(SC 持久化): 端到端 + 可热改(2026-09-25 用户要求) ----
  {
    const h = mkCtx(Object.assign({}, CREDS, { scHoldMs: 60000 }));
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    push(socks[socks.length - 1], { cmd: 'LIVE_OPEN_PLATFORM_SUPER_CHAT', data: { uname: '恰恰doro', message: '感谢叔叔的15抽成', rmb: 30, open_id: 'o9' } });
    ok(h.calls.sent.length === 1 && h.calls.sent[0].opts.ttlMs === 60000, 'SC 按 scHoldMs(60 秒)推上去: 这段时间内保持展示');
    ok(p.api.status().queue.holdKind === 'SUPER_CHAT' && p.api.status().queue.holdUntil > 0, 'status 能看到"正在保持展示哪一类、到什么时候"');
    h.ctx.config.giftHoldMs = 45000; h.ctx.config.holdEnabled = true;
    const eff = p.api.reloadConfig().effective;
    ok(eff.giftHoldMs === 45000 && eff.holdEnabled === true, '保持展示的时长可热改(reloadConfig 立刻生效, 不用重启插件)');
    await p.dispose();
  }

  // ---- ⑧ 直播间信息展示(标题/房间号/热度开关) ----
  {
    const h = mkCtx(CREDS);
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    ok(h.calls.sources.length === 1 && h.calls.sources[0].id === 'roominfo', '开启房间信息: 注册了一个数据源(低优先级, 走现成的 composer 数据源机制)');
    const src = h.calls.sources[0];
    ok(src.priority === 8 && src.intervalMs === 60000, '数据源优先级/刷新间隔按设置(默认 8 / 60 秒)');
    let txt = String(await src.getText());
    ok(txt.indexOf('房间 123') >= 0 && txt.indexOf('【直播间】') === 0, '房间号来自官方 start 的 anchor_info -> 文案 "【直播间】房间 123"');
    push(socks[socks.length - 1], { cmd: 'LIVE_OPEN_PLATFORM_LIVE_START', data: { title: '今晚打游戏', area_name: '虚拟主播' } });
    txt = String(await src.getText());
    ok(txt.indexOf('今晚打游戏') >= 0, '开播事件带来标题 -> 立刻出现在房间信息里');
    ok(p.api.status().room.title === '今晚打游戏' && p.api.status().room.popularity === 0, 'status.room 能看到标题与热度(热度默认不取)');
    h.ctx.config.showRoomTitle = false;
    p.api.reloadConfig();
    txt = String(await src.getText());
    ok(txt.indexOf('今晚打游戏') < 0 && txt.indexOf('房间 123') >= 0, '关掉"显示标题" -> 立刻不再显示标题(热更新)');
    h.ctx.config.showRoomId = false;
    p.api.reloadConfig();
    ok(p.api.status().room.sourceOn === false && h.calls.unregistered.length === 1, '三个开关全关 -> 数据源被摘掉(不占数据源列表)');
    await p.dispose();
  }
  {
    const h = mkCtx(Object.assign({}, CREDS, { showRoomPopularity: true }));
    const p = plugin(h.ctx);
    await p.apply();
    await sleep(30);
    const txt = String(await h.calls.sources[0].getText());
    ok(h.calls.http.some(function (c) { return c.url.indexOf('api.live.bilibili.com') >= 0; }), '打开"显示热度": 请求公开房间信息接口');
    ok(txt.indexOf('热度 4.6万') >= 0 && txt.indexOf('更准的标题') >= 0, '热度按人气值格式化(45678 -> 4.6万), 并顺手用更准的标题');
    ok(txt.indexOf('虚拟主播') < 0, '(分区不在文案里, 只存着备用)');
    await p.dispose();
  }

  console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) { console.log('  FAIL 插件契约单测异常: ' + (e && e.stack || e)); process.exitCode = 1; });

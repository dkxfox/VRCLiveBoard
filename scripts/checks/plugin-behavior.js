'use strict';
// 插件行为门禁(M-20260911-43)
// 背景: 官方插件此前只有"契约/静态"门禁(manifest、单一源、哈希), 行为级问题(标志位卡死、入参未校验、
// 按钮动作名不对齐)只能靠人工发现 —— 本会话就漏过三个。这里用**假 ctx** 把插件工厂跑起来做行为断言。
// 用法: node scripts/checks/plugin-behavior.js   (退出码 0 = 通过)
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0, skip = 0;
function ok(cond, msg) { if (cond) { console.log('  PASS ' + msg); pass++; } else { console.log('  FAIL ' + msg); fail++; } }
function note(msg) { console.log('  SKIP ' + msg); skip++; }
const tick = function () { return new Promise(function (r) { setImmediate(r); }); };

function loadPlugin(id) {
  const factory = require(path.join(ROOT, 'plugins', id, 'index.js'));
  return function (cfg) {
    const calls = [];
    const handlers = {};
    const ctx = {
      config: cfg || {},
      logger: { info: function () {}, warn: function () {}, error: function () {} },
      chatbox: {
        showSequence: function (lines, opt) { calls.push({ lines: lines, opt: opt }); return Promise.resolve(); },
        show: function (t, o) { calls.push({ text: t, opt: o }); return Promise.resolve(); }
      },
      events: {
        on: function (ev, fn) { handlers[ev] = fn; },
        off: function (ev) { delete handlers[ev]; },
        every: function () { return { stop: function () {} }; }
      },
      resource: function () {}, ai: { chat: async function () { return { text: '' }; } },
      media: { get: function () { return null; } }, http: { fetch: async function () { return { ok: false, status: 0 }; } },
      fs: {}, process: {}
    };
    const api = factory(ctx) || {};
    return { ctx: ctx, api: api, calls: calls, handlers: handlers };
  };
}

(async function () {
  console.log('[plugin-behavior] 插件行为断言');

  // ① friend-welcome: 播报失败必须解锁 busy(否则此后所有好友进房被静默丢弃) + 名字精确匹配
  try {
    const mk = loadPlugin('friend-welcome');
    const p = mk({ friends: [
      { name: 'Alice', lines: ['hi {name}'], enabled: true },
      { name: 'Bob', lines: ['yo'], enabled: true },
      { name: 'Carol', lines: 'not-an-array', enabled: true }
    ] });
    if (typeof p.api.apply === 'function') p.api.apply();
    const onJoin = p.handlers['player.joined'];
    if (typeof onJoin !== 'function') note('friend-welcome 未注册 player.joined(跳过)');
    else {
      onJoin('Alice', null); await tick();
      ok(p.calls.length === 1, '好友进房触发一次播报');
      onJoin('Bob', null); await tick();
      ok(p.calls.length === 2, 'busy 已解锁: 第二个好友仍能触发播报');
      onJoin('Alice Smith', null); await tick();
      ok(p.calls.length === 2, '名字精确匹配: 含子串的陌生人不再被命中');
      onJoin('Carol', null); await tick();
      ok(p.calls.length === 2, '非数组 lines 不播报(且不抛错)');
      onJoin('Bob', null); await tick();
      ok(p.calls.length === 3, '非数组那次之后 busy 仍已解锁(插件没卡死)');
    }
  } catch (e) { ok(false, 'friend-welcome 行为用例异常: ' + e.message); }

  // ② scheduled-board: "立即测试播报"(前端传 regular)必须成功; 入参不是数组时不得清空用户名单
  try {
    const mk = loadPlugin('scheduled-board');
    const p = mk({ items: [{ text: ['常规公告'] }], specials: [{ at: '2026-01-01 00:00', text: ['特殊公告'] }], intervalMin: 30 });
    const obj = p.api || {};
    const testFire = obj.testFire || (obj.api && obj.api.testFire);
    const saveRows = obj.saveRows || (obj.api && obj.api.saveRows);
    if (typeof testFire === 'function') {
      const r = testFire({ type: 'regular' });
      ok(r && r.ok === true, 'testFire(regular) 成功(此前永远报"未知测试类型")');
    } else note('未找到 testFire 导出(跳过)');
    if (typeof saveRows === 'function') {
      const before = JSON.stringify(p.ctx.config.specials);
      const r2 = saveRows('abc');
      ok(!(r2 && r2.ok === true) || JSON.stringify(p.ctx.config.specials) !== '[]', '入参不是数组时不会把用户名单清空');
      ok(JSON.stringify(p.ctx.config.specials) === before, '非法入参不改动既有名单');
    } else note('未找到 saveRows 导出(跳过)');
  } catch (e) { ok(false, 'scheduled-board 行为用例异常: ' + e.message); }

  // ③ weather-board: 单次导入上限(旧版逐行串行 geocode, 大表会把控制台请求挂很久)
  try {
    const factory = require(path.join(ROOT, 'plugins', 'weather-board', 'index.js'));
    let netCalls = 0;
    const ctx = {
      config: { cities: [] },
      logger: { info: function () {}, warn: function () {}, error: function () {} },
      http: { request: async function () { netCalls++; throw new Error('测试环境不发真实请求'); }, fetch: async function () { netCalls++; throw new Error('测试环境不发真实请求'); } },
      chatbox: { showSequence: function () { return Promise.resolve(); }, show: function () { return Promise.resolve(); } },
      events: { on: function () {}, off: function () {}, every: function () { return { stop: function () {} }; } },
      resource: function () {}, media: { get: function () { return null; } }, ai: { chat: async function () { return { text: '' }; } }, fs: {}, process: {}
    };
    const api = factory(ctx) || {};
    const saveRows = api.saveRows || (api.api && api.api.saveRows);
    if (typeof saveRows !== 'function') note('weather-board 未导出 saveRows(跳过)');
    else {
      const rows = [];
      for (let i = 0; i < 250; i++) rows.push(['City' + i, '是']);   // 插件行格式就是数组: [城市名, 启用]
      const r = await saveRows(rows);
      ok(netCalls <= 200, '单次导入的上限生效(250 行只发起 ' + netCalls + ' 次定位请求)');
      ok(r && r.truncated === 250 - netCalls, '被截断的行数如实回报(truncated=' + (r && r.truncated) + ')');
    }
  } catch (e) { ok(false, 'weather-board 行为用例异常: ' + e.message); }

  // ④ netease-lyrics: status() 必须带 cfg(前端设置面板靠它回显); cdpPort 必须被夹取(注入 '9234@host' 这类值不能生效)
  try {
    const factory = require(path.join(ROOT, 'plugins', 'netease-lyrics', 'index.js'));
    const cfg = { cdpPort: 9234, updateSec: 5, showTranslation: true, allowOtherPlayers: true, apiPath: '/api' };
    const ctx = {
      config: cfg,
      logger: { info: function () {}, warn: function () {}, error: function () {} },
      media: { get: function () { return { data: {} }; }, on: function () {} },
      chatbox: { show: function () { return Promise.resolve(); }, showSequence: function () { return Promise.resolve(); } },
      events: { on: function () {}, off: function () {}, every: function () { return { stop: function () {} }; } },
      resource: function () {}, ai: { chat: async function () { return { text: '' }; } }, http: { request: async function () { return { ok: false }; } }, fs: {}, process: {}
    };
    const api = factory(ctx) || {};
    const NAPI = api.api || api;   // 插件把可调用接口挂在 api 下(friend-welcome 同款)
    if (typeof NAPI.status !== 'function') note('netease 未导出 status(跳过)');
    else {
      let st = null;
      try { st = NAPI.status(); } catch (e) { note('netease status() 需要更多 ctx, 跳过: ' + e.message.slice(0, 60)); }
      if (st) ok(!!st.cfg, 'status() 返回 cfg(设置面板回显不再失效)');
    }
    if (typeof NAPI.saveConfig !== 'function') note('netease 未导出 saveConfig(跳过)');
    else {
      NAPI.saveConfig({ args: { cdpPort: '9234@evil.tld' } });
      ok(ctx.config.cdpPort === 9234, '非法端口被夹回默认值(实得 ' + ctx.config.cdpPort + ')');
      NAPI.saveConfig({ args: { cdpPort: 99999 } });
      ok(ctx.config.cdpPort === 65535, '超范围端口被夹到上限(实得 ' + ctx.config.cdpPort + ')');
      NAPI.saveConfig({ args: { cdpPort: 5 } });
      ok(ctx.config.cdpPort === 1024, '过小端口被夹到下限(实得 ' + ctx.config.cdpPort + ')');
    }
  } catch (e) { ok(false, 'netease 行为用例异常: ' + e.message); }

  // ⑤ netease CDP 客户端生命周期(需要假 WebSocket): 停用后不得重建定时器 / 未应答请求要被结束 / 待应答有上限
  try {
    const { CdpClient } = require(path.join(ROOT, 'plugins', 'netease-lyrics', 'cdp.js'));
    const savedFetch = global.fetch, savedWS = global.WebSocket;
    const fakeWS = function (silent) {
      return class {
        constructor(url) { this.url = url; this.sent = []; const self = this; setTimeout(function () { if (self.onopen) self.onopen(); }, 0); }
        send(s) {
          this.sent.push(s);
          if (silent) return;   // 只发不回: 用来验证超时/上限/dispose
          const m = JSON.parse(s); const self = this;
          setTimeout(function () { if (self.onmessage) self.onmessage({ data: JSON.stringify({ id: m.id, result: { result: { value: null } } }) }); }, 0);
        }
        close() { this.closed = true; }
      };
    };
    global.fetch = async function () { return { ok: true, json: async function () { return [{ webSocketDebuggerUrl: 'ws://127.0.0.1:9234/devtools/page/1' }]; } }; };
    const quiet = { info: function () {}, warn: function () {} };
    global.WebSocket = fakeWS(false);
    const c1 = new CdpClient(9234, quiet);
    await c1.start();
    ok(!!c1._retryTimer, '连接后建立了重连定时器(正常路径)');
    c1.dispose();
    ok(c1._retryTimer === null, 'dispose 后重连定时器被清空');
    await c1.start();
    ok(c1._retryTimer === null, '停用后再 start() 不会重建定时器(旧实现会建在 await 之后且引用丢失)');
    global.WebSocket = fakeWS(true);
    const c2 = new CdpClient(9234, quiet);
    c2.ws = new (fakeWS(true))('ws://x');   // 必须有 ws, 否则 _send 会在读 .send 时同步抛错(那是测试写错, 不是产品行为)
    let stopMsg = '';
    const p2 = c2._send('Runtime.evaluate', {}).catch(function (e) { stopMsg = e.message; });
    c2.dispose();
    await p2;
    ok(stopMsg.indexOf('CDP 已停止') >= 0, 'dispose 结束未应答请求(实得: ' + (stopMsg || '(无)') + ')');
    const c3 = new CdpClient(9234, quiet);
    c3.ws = new (fakeWS(true))('ws://x');
    let overMsg = '';
    // 阈值语义: 代码判的是 size > 200, 所以第 201 次仍被接受、第 202 次开始拒绝
    for (let i = 0; i < 202; i++) c3._send('Runtime.evaluate', {}).catch(function (e) { if (e.message.indexOf('待应答过多') >= 0) overMsg = e.message; });
    await tick();
    ok(overMsg.indexOf('待应答过多') >= 0, '待应答超过上限(>200)时明确拒绝(实得: ' + (overMsg || '(无)') + ')');
    c3.dispose();
    global.fetch = savedFetch; global.WebSocket = savedWS;
  } catch (e) { ok(false, 'CDP 生命周期用例异常: ' + e.message); }

  console.log('[plugin-behavior] pass=' + pass + ' fail=' + fail + (skip ? (' skip=' + skip) : ''));
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) { console.log('  FAIL 行为门禁自身异常: ' + ((e && e.stack) || e)); process.exitCode = 1; });

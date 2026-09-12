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

  console.log('[plugin-behavior] pass=' + pass + ' fail=' + fail + (skip ? (' skip=' + skip) : ''));
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) { console.log('  FAIL 行为门禁自身异常: ' + ((e && e.stack) || e)); process.exitCode = 1; });

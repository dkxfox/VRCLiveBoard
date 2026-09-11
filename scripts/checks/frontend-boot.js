'use strict';
// G-BOOT 前端启动可执行性: 用 DOM 桩件在 node vm 里把 lang.js + app.js 真正跑一遍
//   坑源: 启动动画是个 async IIFE, 里面 var t 遮蔽了全局取词函数 t → 每次加载都静默抛错、
//         动画从未播放, 而当时的语法/静态门禁全绿(M-20260911-01)。静态检查查不出"能不能跑起来"。
//   三道断言: ①顶层加载无异常 ②加载后无 unhandledRejection(async IIFE 的静默失败都在这里现形)
//             ③启动动画各品牌分支能正确调用 simpleBoot / starryBoot
//   桩件口径: 按 index.html 里真实存在的 id 给元素桩, 不存在的给 null —— 这样"无守卫地取一个不存在的 id"
//             会真的抛错(正是要抓的), 而正常的 if(\$('x')) 守卫写法不受影响。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const PUB = path.join(ROOT, 'src', 'web', 'public');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
const ids = new Set();
for (const mm of html.matchAll(/\bid="([^"]+)"/g)) ids.add(mm[1]);

function el(tag) {
  const e = {
    tagName: String(tag || 'div').toUpperCase(), style: { setProperty() {}, removeProperty() {} },
    dataset: {}, children: [], _text: '', _html: '', _v: '', _c: false,
    options: [], selectedIndex: 0, files: [], naturalWidth: 100, naturalHeight: 100,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { e.children.push(c); return c; }, removeChild() {}, insertBefore() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    // 真实 DOM 里 innerHTML 之后 querySelector 是查得到的; 返回 null 会让 plgCard 之类误报(桩件噪声)
    querySelector(sel) { if (!e._qs) e._qs = {}; if (!e._qs[sel]) e._qs[sel] = el('div'); return e._qs[sel]; },
    querySelectorAll() { return []; },
    focus() {}, blur() {}, click() {}, contains() { return false; },
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  };
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = String(v); } });
  Object.defineProperty(e, 'innerHTML', { get() { return e._html; }, set(v) { e._html = String(v); } });
  Object.defineProperty(e, 'value', { get() { return e._v; }, set(v) { e._v = String(v); } });
  Object.defineProperty(e, 'checked', { get() { return e._c; }, set(v) { e._c = !!v; } });
  return e;
}
const byId = {}; // 同一 id 的桩件实例缓存(要在断言里检查渲染结果, 所以必须模块级)
function makeSandbox() {
  const sb = {
    console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'gate' },
    location: { search: '', href: 'http://127.0.0.1/', hash: '' },
    URLSearchParams, Blob: function () {}, FileReader: function () {}, XMLHttpRequest: function () {},
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    // 打桩数据必须像真的: 初始化里的渲染函数大多在 await 之后才跑, 数据太薄就永远跑不到渲染路径
    // (2026-09-11 教训: 数据源表体为空这类回归, 桩件返回 {} 时完全测不出来)
    fetch: async (u) => {
      const s = String(u);
      const J = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
      if (s.indexOf('/api/status') >= 0) return J({ vrcOn: false, vrc: { running: false, oscEnabled: false }, time: 1, current: { text: 'x' }, sources: [{ id: 'hardware', enabled: true, priority: 10, intervalMs: 2000 }, { id: 'pages', enabled: true, priority: 5, intervalMs: 8000 }, { id: 'media', enabled: false, priority: 30, intervalMs: 2000 }] });
      if (s.indexOf('/api/plugins') >= 0) return J([{ id: 'friend-welcome', name: 'friend-welcome', version: '1.3.0', enabled: true, approved: true, permissions: {}, description: 'd' }]);
      if (s.indexOf('/api/config') >= 0) return J({ pages: [{ text: 'hello' }], rotationMs: 8000, sources: [], lang: 'zh-CN', ocrtl: {}, swearFilter: {}, pluginsSecurity: {}, branding: 'normal' });
      if (s.indexOf('/api/logs') >= 0) return J({ lines: ['[INFO] x'], tail: ['[INFO] x'] });
      if (s.indexOf('/api/env') >= 0) return J({ node: { version: '24' }, systemPython: null, portablePython: null, media: false, livetranslate: false });
      if (s.indexOf('/api/version') >= 0) return J({ version: '1.3.2', newer: false });
      return J({});
    },
    alert() {}, confirm: () => true, prompt: () => null,
    document: {
      // 同一 id 返回同一实例: 这样门禁能在初始化跑完后检查"渲染进去了没有"
      getElementById: (id) => { if (!ids.has(id)) return null; if (!byId[id]) byId[id] = el('div'); return byId[id]; },
      createElement: (t) => el(t),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      body: el('body'), documentElement: el('html'), head: el('head'), title: ''
    }
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  return sb;
}
const problems = [];
const sb = makeSandbox();
const rejections = [];
process.on('unhandledRejection', function (e) { rejections.push(e && e.message ? e.message : String(e)); });
try {
  vm.runInNewContext(fs.readFileSync(path.join(PUB, 'lang.js'), 'utf8'), sb, { filename: 'lang.js' });
  vm.runInNewContext(app, sb, { filename: 'app.js' });
} catch (e) {
  let msg = e.message;
  const mm = /^([A-Za-z_$][\w$]*) is not defined$/.exec(msg);
  if (mm && ids.has(mm[1])) msg += ' —— 裸标识符访问 DOM id(依赖浏览器命名访问), 请改用 $(' + "'" + mm[1] + "'" + ') 并加守卫';
  problems.push('app.js 顶层加载抛错: ' + msg);
}

const tr = sb.tr, tw = sb.window && sb.window.t;
try {
  if (typeof tr !== 'function') problems.push('未定义 i18n 取词函数 tr()');
  else if (tr('bootTagline') === 'bootTagline') problems.push('tr("bootTagline") 取不到文案(lang.js 未生效或键缺失)');
  if (typeof tw !== 'function') problems.push('window.t 兼容别名缺失(index.html 内联块会失去翻译)');
  else if (typeof tr === 'function' && tw('bootTagline') !== tr('bootTagline')) problems.push('window.t 与 tr 取值不一致');
} catch (e) { problems.push('i18n 取词断言抛错(脚本可能未执行到字典初始化): ' + e.message); }

const lines = app.split(/\r?\n/);
const mk = lines.findIndex((l) => l.indexOf('启动动画(品牌感知)') >= 0);
let me = -1;
for (let i = mk + 1; i < lines.length; i++) { if (/^\}\)\(\);$/.test(lines[i].trim())) { me = i; break; } }
const bootSrc = (mk >= 0 && me > mk) ? lines.slice(mk + 1, me + 1).join('\n') : null;
if (!bootSrc) problems.push('未能从 app.js 抽取启动动画 IIFE(标记被改动?)');

async function bootBranch(branding, skin) {
  const calls = [];
  const b = {
    console, t: () => 'T', tr: () => 'T', setTimeout: () => 0, setInterval: () => 0, clearInterval() {},
    simpleBoot: () => calls.push('simpleBoot'), starryBoot: () => calls.push('starryBoot'),
    playSpecialVideo: () => calls.push('special'), syncQuickPlg() {},
    fetch: async () => ({ json: async () => ({ branding: branding, specialEvents: [] }) }),
    window: skin ? { VRCB_SKIN: { resolve: () => skin } } : {},
    document: { getElementById: () => null, createElement: () => el('div'), body: el('body') }
  };
  try { await vm.runInNewContext(bootSrc, b, { filename: 'boot.js' }); }
  catch (e) { return { calls: calls, err: e.message }; }
  return { calls: calls, err: null };
}
const SEA = { c1: '#f59e0b', c2: '#f87171', greet: '秋意渐浓', deco: '🍂' };
(async function () {
  try {
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); // 让 await 链上的渲染跑完
  for (const r of rejections) problems.push('加载期出现未处理的 Promise 拒绝: ' + r);
  // 渲染内容断言: 光"不报错"不够, 关键列表必须真的有子节点
  const rowsEl = byId['srcRows'];
  if (!rowsEl) problems.push('index.html 缺少 #srcRows');
  else if (!rowsEl.children.length) problems.push('数据源表格 #srcRows 渲染后仍为空(渲染函数可能被异常打断)');
  const plgEl = byId['plugCards'];
  if (plgEl && !plgEl.children.length) problems.push('插件卡片 #plugCards 渲染后仍为空');
  if (bootSrc) {
    const cases = [
      ['normal 无皮肤', 'normal', null, 'simpleBoot'],
      ['normal 有皮肤', 'normal', SEA, 'simpleBoot'],
      ['starry', 'starry', null, 'starryBoot']
    ];
    for (const c of cases) {
      const r = await bootBranch(c[1], c[2]);
      if (r.err) problems.push('启动动画 ' + c[0] + ' 抛错: ' + r.err);
      else if (r.calls.indexOf(c[3]) < 0) problems.push('启动动画 ' + c[0] + ' 未走到 ' + c[3] + '(实际: ' + (r.calls.join(',') || '无') + ')');
    }
  }
  } catch (e) {
    // 门禁自身的异常绝不能静默: 之前 byId 作用域写错, 异常被上面的 unhandledRejection 监听吞掉,
    // 结果是"什么都不打印 + 退出码 0", 门禁形同虚设(2026-09-11)
    problems.push('门禁自身执行异常(请修门禁): ' + ((e && e.stack) || e));
  }
  console.log('[G-BOOT frontend-boot] 前端启动: 顶层加载 ' + (problems.length ? '有异常' : '正常') + ' / 控件桩 ' + ids.size + ' 个 id');
  for (const p of problems) console.log('  -> FAIL ' + p);
  process.exitCode = problems.length ? 1 : 0; // 用 exitCode: process.exit 在管道下会丢掉未刷新的输出
})();

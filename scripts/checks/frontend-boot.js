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

// 真实 DOM 会给 style.cssText 做 CSS 解析(内置样式随后可读), 桩件必须照做,
// 否则"初始透明态"这类断言根本读不到(2026-09-11 踩过)
function mkStyle() {
  const st = { setProperty(k, v) { st[k] = v; }, removeProperty(k) { delete st[k]; } };
  Object.defineProperty(st, 'cssText', {
    get() { return st._t || ''; },
    set(v) {
      st._t = String(v);
      String(v).split(';').forEach(function (d) {
        const i = d.indexOf(':');
        if (i > 0) { const k = d.slice(0, i).trim(); const val = d.slice(i + 1).trim(); if (k) st[k] = val; }
      });
    }
  });
  return st;
}
function el(tag) {
  const e = {
    tagName: String(tag || 'div').toUpperCase(), style: mkStyle(),
    dataset: {}, children: [], _text: '', _html: '', _v: '', _c: false,
    options: [], selectedIndex: 0, files: [], naturalWidth: 100, naturalHeight: 100,
    classList: (function () { const set = new Set(); return { add(c) { set.add(c); }, remove(c) { set.delete(c); }, contains(c) { return set.has(c); }, toggle(c, force) { const want = force === undefined ? !set.has(c) : !!force; if (want) set.add(c); else set.delete(c); return want; } }; })(),
    appendChild(c) { e.children.push(c); return c; }, removeChild() {}, insertBefore() {}, remove() {},
    addEventListener(type, fn) { if (!e._ev) e._ev = {}; e._ev[type] = fn; }, removeEventListener() {}, dispatchEvent() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    // 真实 DOM 里 innerHTML 之后 querySelector 是查得到的; 返回 null 会让 plgCard 之类误报(桩件噪声)
    querySelector(sel) { if (!e._qs) e._qs = {}; if (!e._qs[sel]) e._qs[sel] = el('div'); return e._qs[sel]; },
    querySelectorAll() { return []; },
    focus() {}, blur() {}, click() {}, contains() { return false; },
    // canvas 2D 上下文桩: fx.js(星空背景)会同步调用一些 ctx 方法, 返回 null 会误报
    getContext() { return { canvas: e, globalAlpha: 1, globalCompositeOperation: '', fillStyle: '', strokeStyle: '', lineWidth: 1, shadowBlur: 0, shadowColor: '', filter: '',
      clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, ellipse() {},
      save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, drawImage() {},
      createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; },
      getImageData() { return { data: [] }; }, putImageData() {} }; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  };
  Object.defineProperty(e, 'textContent', { get() { return e._text; }, set(v) { e._text = String(v); } });
  Object.defineProperty(e, 'innerHTML', {
    get() { return e._html; },
    set(v) {
      e._html = String(v);
      // 真实 DOM 里给 innerHTML 赋值会替换掉所有子节点 —— 桩件必须照做, 否则"重建后旧节点应消失"这类断言永远失败
      e.children.length = 0;
      if (e._qs) e._qs = {};
      // 极简解析: 只认 class="x" 与 style="..." 的配对, 让门禁能断言 innerHTML 构建出来的内容
      // (本项目的卡片/面板大量用 innerHTML 拼, 不解析就只能断言到"外层存在"这一层)
      if (!e._qs) e._qs = {};
      const re = /<([a-zA-Z][\w-]*)([^>]*)>/g;
      let m;
      while ((m = re.exec(e._html)) !== null) {
        const tag = m[1].toLowerCase(), attrs = m[2];
        const cls = (attrs.match(/class="([^"]*)"/) || [])[1];
        const st = (attrs.match(/style="([^"]*)"/) || [])[1];
        const srcAttr = (attrs.match(/src="([^"]*)"/) || [])[1];
        const child = el(tag);
        if (st) child.style.cssText = st;
        if (srcAttr) child.src = srcAttr;
        if (cls) for (const c of cls.split(/\s+/)) if (c) e._qs['.' + c] = child;
        if (!e._qs[tag]) e._qs[tag] = child;
      }
    }
  });
  Object.defineProperty(e, 'value', { get() { return e._v; }, set(v) { e._v = String(v); } });
  Object.defineProperty(e, 'checked', { get() { return e._c; }, set(v) { e._c = !!v; } });
  return e;
}
const byId = {}; // 同一 id 的桩件实例缓存(要在断言里检查渲染结果, 所以必须模块级)
function makeSandbox() {
  for (const k of Object.keys(byId)) delete byId[k]; // 每个沙箱独立的元素实例
  const sb = {
    console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    localStorage: (function () { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; })(),
    navigator: { clipboard: { writeText: async () => {} }, userAgent: 'gate' },
    location: { search: '', href: 'http://127.0.0.1/', hash: '' },
    innerWidth: 1280, innerHeight: 800, outerWidth: 1280, outerHeight: 800, devicePixelRatio: 1, // fx.js 会读这几个浏览器全局
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
  // 执行顺序 = index.html 里 script src 的真实顺序(app.js 先定义 $/feErr, 主题与动效在其后)
  const { uiJsOrder } = require('./_ui-files.js');
  for (const fp of uiJsOrder(ROOT)) {
    vm.runInNewContext(fs.readFileSync(fp, 'utf8'), sb, { filename: path.basename(fp) });
  }
  // 主题与星空背景(2026-09-11 从 index.html 内联块迁出)必须仍挂在 index.html 的外链里 ——
  // 已经由上面的 uiJsOrder 统一加载, 这里只做"有没有被漏挂"的断言
  const orderNames = uiJsOrder(ROOT).map((f) => path.basename(f));
  for (const f of ['theme.js', 'fx.js']) if (orderNames.indexOf(f) < 0) problems.push('index.html 外链里缺少 ' + f);
} catch (e) {
  let msg = e.message;
  const mm = /^([A-Za-z_$][\w$]*) is not defined$/.exec(msg);
  if (mm && ids.has(mm[1])) msg += ' —— 裸标识符访问 DOM id(依赖浏览器命名访问), 请改用 $(' + "'" + mm[1] + "'" + ') 并加守卫';
  problems.push('app.js 顶层加载抛错: ' + msg);
}

// 跨文件契约: app.js 依赖这两个全局(切语言时重挂主题名 / 重开动效时重启星空)
if (typeof sb.__reThemeLabels !== 'function') problems.push('theme.js 未导出 window.__reThemeLabels(app.js 切语言时要用)');
else { try { sb.__reThemeLabels(); } catch (e) { problems.push('__reThemeLabels() 抛错: ' + e.message); } }
if (typeof sb.__fxRestart !== 'function') problems.push('fx.js 未导出 window.__fxRestart(app.js 重开动效时要用)');
// 主题系统必须**真的应用了**(只断言不抛错是不够的: setTheme 静默失效也会"不报错")
const de = sb.document && sb.document.documentElement;
if (!de || !de.style || !de.style['--bg']) problems.push('theme.js 未应用主题变量(原始 setTheme 可能没跑到)');
const tn = byId['themeName'];
if (tn && !String(tn.textContent || '').trim()) problems.push('#themeName 未被主题系统写入显示名');
else if (tn && /theme[A-Z]/.test(String(tn.textContent))) problems.push('#themeName 显示的是 i18n 键而不是文案: ' + tn.textContent);
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
  // 启动动画(默认/皮肤路径走 simpleBoot): 图标是异步取的, 必须等它就绪再整体淡入,
  // 否则会出现"文字先到、图标后蹦"(M-20260911-10)
  try {
    if (typeof sb.simpleBoot !== 'function') problems.push('未定义 simpleBoot');
    else {
      sb.simpleBoot('#3b82f6', '#7dd3fc', '', '*', 'VRCLiveBoard', 'tag');
      const body = sb.document.body;
      const ov = body.children[body.children.length - 1];
      if (!ov) problems.push('simpleBoot 未向 body 挂载覆盖层');
      else {
        if (ov.style.opacity === '0') problems.push('simpleBoot 整体被隐藏: 会先闪出控制台页面再播动画');
        const wrap = ov.querySelector('.bwrap');
        if (!wrap) problems.push('simpleBoot 缺少内容容器 .bwrap(图标与文字无法整组出现)');
        else if (wrap.style.opacity !== '0') problems.push('simpleBoot 内容初始不是透明态: 图标会比文字晚出现(当前 opacity=' + JSON.stringify(wrap.style.opacity) + ')');
        const img = ov.querySelector('img');
        // 图标必须走 107KB 的小图: 用回 /api/icon(2.4MB 大图)就会重新变滞后(M-20260911-11)
        if (!img) problems.push('simpleBoot 里找不到图标元素');
        else if (img.src === '/api/icon' || (img.src || '').indexOf('/api/icon') === 0) problems.push('启动动画又用回了 /api/icon 大图(2.4MB), 图标会滞后');
        else if (img.src !== '/icon-256.png') problems.push('启动动画图标不是小图 icon-256.png(实际 ' + JSON.stringify(img.src) + ')');
        if (html.indexOf('rel="preload"') < 0 || html.indexOf('/icon-256.png') < 0) problems.push('index.html 缺少 icon-256.png 的 preload(图标会晚到)');
        if (img && img._ev && img._ev.load) {
          img._ev.load();
          if (wrap && wrap.style.opacity !== '1') problems.push('图标就绪后启动动画内容没有淡入');
        } else problems.push('simpleBoot 未给图标注册 load 监听');
      }
    }
  } catch (e) { problems.push('simpleBoot 断言异常: ' + e.message); }
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
    // 数据源表格: 数据没变不得整表重建(否则 pollStatus 每 5 秒会打断正在输入的优先级)(M-20260911-20)
  try {
    const tb = byId['srcRows'];
    if (!tb || typeof sb.renderSrcTable !== 'function') problems.push('#srcRows 或 renderSrcTable 缺失');
    else {
      sb._srcs = [{ id: 'hardware', enabled: true, priority: 10, intervalMs: 2000 }];
      sb.renderSrcTable(true);
      const mark = sb.document.createElement('i');
      tb.appendChild(mark);
      sb.renderSrcTable();                       // 数据没变 -> 必须原样保留(标记还在)
      if (tb.children.indexOf(mark) < 0) problems.push('数据没变时数据源表格仍被整表重建(正在输入的优先级会被打断)');
      sb._srcs = sb._srcs.concat([{ id: 'media', enabled: false, priority: 30, intervalMs: 2000 }]);
      sb.renderSrcTable();                       // 数据变了 -> 必须重建(标记消失)
      if (tb.children.indexOf(mark) >= 0) problems.push('数据变化后数据源表格没有重建');
      else if (tb.children.length !== 2) problems.push('重建后行数不对(期望 2, 实际 ' + tb.children.length + ')');
    }
  } catch (e) { problems.push('数据源表格重建断言异常: ' + e.message); }
// 动效开关(M-20260911-18): 关掉再打开必须重启星空画布; 已保存的设置必须在加载时生效
  try {
    const top = byId['animTop'], body = sb.document.body;
    let fxN = 0;
    if (typeof sb.__fxRestart === 'function') { const o = sb.__fxRestart; sb.__fxRestart = function () { fxN++; return o.apply(this, arguments); }; }
    if (!top || typeof top.onclick !== 'function') problems.push('#animTop 未接线(动效主开关)');
    else if (typeof sb.__fxRestart !== 'function') problems.push('fx.js 未导出 __fxRestart, 无法验证动效重启');
    else {
      top.onclick();
      if (!body.classList.contains('no-anim')) problems.push('动效主开关点击后没有关闭动效');
      top.onclick();
      if (body.classList.contains('no-anim')) problems.push('动效主开关再次点击没有恢复动效');
      if (!fxN) problems.push('动效重新打开时没有重启星空画布(__fxRestart 未被调用)');
    }
    const { uiJsOrder: order2 } = require('./_ui-files.js'); // 上面那个在 try 块作用域里, 这里重新取
    const sb2 = makeSandbox();
    sb2.localStorage.setItem('vrcbAnimMaster', '1');
    for (const fp of order2(ROOT)) vm.runInNewContext(fs.readFileSync(fp, 'utf8'), sb2, { filename: path.basename(fp) });
    if (!sb2.document.body.classList.contains('no-anim')) problems.push('已保存的"关闭动效"在页面加载时没有被应用(主开关只存不读)');
  } catch (e) { problems.push('动效开关断言异常: ' + e.message); }
  // 主题持久化(M-20260911-19): 点选要写盘, 重开要恢复(此前 theme.js 无条件 setTheme('blue'), 重启即回默认)
  try {
    const { uiJsOrder: order3 } = require('./_ui-files.js');
    const loadInto = function (sbx) { for (const fp of order3(ROOT)) vm.runInNewContext(fs.readFileSync(fp, 'utf8'), sbx, { filename: path.basename(fp) }); return sbx; };
    const base = loadInto(makeSandbox());
    if (typeof base.setTheme !== 'function') problems.push('theme.js 未导出 setTheme');
    else {
      base.setTheme('neon');
      if (base.localStorage.getItem('vrcbTheme') !== 'neon') problems.push('点选主题后没有写入 localStorage(vrcbTheme)');
      const again = makeSandbox();
      again.localStorage.setItem('vrcbTheme', 'neon');
      loadInto(again);
      if (again.document.documentElement.style['--bg'] !== base.document.documentElement.style['--bg']) problems.push('重开页面没有恢复上次选的主题(主题不持久化)');
    }
  } catch (e) { problems.push('主题持久化断言异常: ' + e.message); }
  // 截图翻译的提示方式(M-20260911-22): 旧版是按钮旁的内联提示 + 结果块, 新版移植成了 alert() 弹窗
  // (而且弹在整轮跑完之后)。这里用桩件真点一次: 既不许弹窗, 也要看到提示与结果落在页面上。
  try {
    const { uiJsOrder: order4 } = require('./_ui-files.js');
    let alerts = 0;
    const mk = function (payload) {
      const s = makeSandbox();
      const defFetch = s.fetch;
      s.alert = function () { alerts++; };
      s.fetch = async function (u, o) {
        if (String(u).indexOf('/api/ocrtl') >= 0) return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
        return defFetch(u, o);
      };
      for (const fp of order4(ROOT)) vm.runInNewContext(fs.readFileSync(fp, 'utf8'), s, { filename: path.basename(fp) });
      return s;
    };
    const okSb = mk({ ok: true, result: { ocr: 'OCR原文内容', translated: '译文内容', model: 'test-model' } });
    const okBtn = okSb.document.getElementById('btnShot'), okMsg = okSb.document.getElementById('shotMsg'), okOut = okSb.document.getElementById('shotOut');
    if (!okMsg) problems.push('index.html 缺少 #shotMsg(截图翻译的按钮旁提示)');
    else if (!okOut) problems.push('index.html 缺少 #shotOut(截图翻译的结果块)');
    else if (!okBtn || typeof okBtn.onclick !== 'function') problems.push('#btnShot 未接线(截图翻译)');
    else {
      await okBtn.onclick();
      const txt = String(okOut.textContent || '');
      if (txt.indexOf('OCR原文内容') < 0) problems.push('截图翻译结束后没有把 OCR 原文写进 #shotOut');
      if (txt.indexOf('译文内容') < 0) problems.push('截图翻译结束后没有把译文写进 #shotOut');
      if (String(okOut.style.display) !== 'block') problems.push('#shotOut 结果块没有显示出来');
      if (okBtn.disabled) problems.push('截图翻译结束后按钮没有恢复可点');
    }
    const badSb = mk({ ok: false, error: '已有一次截图翻译正在进行' });
    const badBtn = badSb.document.getElementById('btnShot'), badMsg = badSb.document.getElementById('shotMsg');
    if (badBtn && typeof badBtn.onclick === 'function' && badMsg) {
      await badBtn.onclick();
      if (String(badMsg.textContent || '').indexOf('已有一次截图翻译正在进行') < 0) problems.push('截图翻译失败时按钮旁没有提示失败原因');
    }
    if (alerts) problems.push('截图翻译仍然弹对话框(alert ' + alerts + ' 次), 旧版是按钮旁的内联提示');
  } catch (e) { problems.push('截图翻译提示断言异常: ' + e.message); }
  // 识别方式与三个参数必须"改了立刻落盘"(M-20260911-23): 面板上的值读自 config, 只读不写 = 改了等于没改
  try {
    const { uiJsOrder: order5 } = require('./_ui-files.js');
    const s5 = makeSandbox();
    const calls = [];
    const def5 = s5.fetch;
    s5.fetch = async function (u, o) { calls.push({ url: String(u), opt: o || {} }); return def5(u, o); };
    for (const fp of order5(ROOT)) vm.runInNewContext(fs.readFileSync(fp, 'utf8'), s5, { filename: path.basename(fp) });
    const modeSel = s5.document.getElementById('transMode');
    if (!modeSel) problems.push('index.html 缺少 #transMode(识别方式)');
    else if (typeof modeSel.onchange !== 'function') problems.push('#transMode 未接线(改了识别方式不会落盘, 重启回默认)');
    else {
      modeSel.value = 'vision';
      modeSel.onchange();
      await new Promise(function (r) { setTimeout(r, 0); });
      const hit = calls.filter(function (c) { return c.url.indexOf('/api/ocrtl-vision') >= 0 && String(c.opt.body || '').indexOf('vision') >= 0; })[0];
      if (!hit) problems.push('改识别方式没有把 mode 发到 /api/ocrtl-vision(重启不会保存)');
    }
    for (const id5 of ['ocrDelay', 'ocrDisplay', 'ocrLoops']) {
      const el5 = s5.document.getElementById(id5);
      if (el5 && typeof el5.onchange !== 'function') problems.push('#' + id5 + ' 未接线(改了不会落盘)');
    }
  } catch (e) { problems.push('识别方式落盘断言异常: ' + e.message); }
  // 页内提示条(M-20260911-24): alert 全部换成 note(), 得真能显示出来
  try {
    const { uiJsOrder: order6 } = require('./_ui-files.js');
    const s6 = makeSandbox();
    for (const fp of order6(ROOT)) vm.runInNewContext(fs.readFileSync(fp, 'utf8'), s6, { filename: path.basename(fp) });
    const el6 = s6.document.getElementById('note');
    if (!el6) problems.push('index.html 缺少 #note(页内提示条)');
    else if (typeof s6.note !== 'function') problems.push('app.js 未定义 note()(页内提示)');
    else {
      s6.note('测试提示内容', 'warn');
      if (el6.hidden !== false) problems.push('note() 没有把提示条显示出来');
      if (String(el6.textContent || '').indexOf('测试提示内容') < 0) problems.push('note() 没有把文字写进提示条');
    }
  } catch (e) { problems.push('页内提示断言异常: ' + e.message); }
  console.log('[G-BOOT frontend-boot] 前端启动: 顶层加载 ' + (problems.length ? '有异常' : '正常') + ' / 控件桩 ' + ids.size + ' 个 id');
  for (const p of problems) console.log('  -> FAIL ' + p);
  process.exitCode = problems.length ? 1 : 0; // 用 exitCode: process.exit 在管道下会丢掉未刷新的输出
})();

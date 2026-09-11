'use strict';
// G-I18NU i18n 引用完整性: 代码里 tr('key')/data-t="key" 引用的键必须存在于 lang.js
//   取词函数 2026-09-11 由 t 改名 tr(M-20260911-04): 单字母 t 被 var t= 遮蔽过两次; 正则同时认 tr( 与 t(
//   附带检查: app.js 内不允许再出现局部绑定 t(遮蔽隐患的源头)
//   坑源: 键名写错/删了键没删引用 → 界面上冒出英文键名(条目 65/71/81 同类)
//   附带: 键值含 {占位符} 但 app.js 里没有对应 .replace('{占位符}' → 会原样显示 {n}
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const langFile = path.join(ROOT, 'src', 'web', 'public', 'lang.js');
const sandbox = { window: {} };
vm.createContext(sandbox);
try { vm.runInContext(fs.readFileSync(langFile, 'utf8'), sandbox, { timeout: 5000 }); }
catch (e) { console.log('[G-I18NU] FAIL lang.js 执行失败: ' + e.message); process.exit(1); }
const L = sandbox.window.VRCB_LANG;
const langs = Object.keys(L || {});
const baseLang = langs[0] || 'zh-CN';
const keys = new Set(Object.keys(L[baseLang] || {}));
const problems = [];
const warns = [];
// index.html: data-t / data-t-ph / data-tt
const html = fs.readFileSync(path.join(ROOT, 'src', 'web', 'public', 'index.html'), 'utf8');
let htmlRefs = 0;
for (const m of html.matchAll(/data-t(?:-ph|-tt)?="([^"]+)"/g)) { htmlRefs++; if (!keys.has(m[1])) problems.push('index.html 引用不存在的键: ' + m[1]); }
// app.js: tr('key')(兼容旧写法 t('key'))
const app = fs.readFileSync(path.join(ROOT, 'src', 'web', 'public', 'app.js'), 'utf8');
const used = new Set();
for (const m of app.matchAll(/\btr?\('([^']+)'\)/g)) used.add(m[1]);
for (const k of used) if (!keys.has(k)) problems.push('app.js tr() 引用不存在的键: ' + k);
// 禁止局部绑定 t: i18n 取词函数历史上叫 t, 被 var t= 遮蔽过两次(启动动画 M-20260911-01 / 公告板编辑器 M-20260911-04)
const localT = app.match(/\b(?:var|let|const)\s+t\s*=/g) || [];
if (localT.length) problems.push('app.js 出现局部绑定 t(' + localT.length + ' 处): 请改用其他变量名, 它会遮蔽取词链路的历史命名');
// 占位符 WARN: 被 t() 使用的键, 值里有 {x} 但 app.js 里没有任何 .replace('{x}'
for (const k of used) {
  const val = L[baseLang][k];
  if (typeof val !== 'string') continue;
  const phs = [...new Set((val.match(/\{([a-zA-Z0-9]+)\}/g) || []))];
  for (const ph of phs) {
    if (!app.includes(".replace('" + ph + "'")) warns.push('键 ' + k + ' 占位符 ' + ph + ' 在 app.js 无对应 .replace(可能原样显示): ' + val);
  }
}
console.log('[G-I18NU i18n-usage] 引用完整性: tr() 键 ' + used.size + ' / data-t 引用 ' + htmlRefs + ' / 字典 ' + keys.size + ' 键');
for (const p of problems) console.log('  -> FAIL ' + p);
for (const w of warns) console.log('  -> WARN ' + w);
process.exit(problems.length ? 1 : 0);

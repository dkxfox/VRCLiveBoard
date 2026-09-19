'use strict';
// 界面文案盘点(开发工具, 不是门禁): 回答"字典与界面还对得上吗"。
// 为什么需要它(2026-09-12): 旧版控制台 → 新版移植时, 有 13 段说明文字**键还在字典里、界面却没有占位** ——
//   用户完全看不到说明, 而当时所有门禁都是绿的: GI18NU 只做单向检查(页面引用的键必须存在),
//   没有任何检查问过反方向"字典里的键有没有家"。这一批补回 4 段(plgDesc/showConsoleDesc/advGameHint/advBoxHint)
//   并把这 13 段固化成 GHTML 契约; 本工具负责在改动文案后随时复跑全量盘点。
// 用法: node scripts/copy-inventory.js
// 输出: ① 各语言缺失/空值键 ② 引用了但字典没有的键 ③ 字典里有、界面零引用的键(含疑似动态拼接的提示)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const PUB = path.join(ROOT, 'src', 'web', 'public');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(PUB, 'lang.js'), 'utf8'), sandbox, { timeout: 5000 });
const L = sandbox.window.VRCB_LANG || {};
const langs = Object.keys(L);
const base = langs[0];
const keys = Object.keys(L[base] || {});
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const jsFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') && e.name !== 'lang.js') jsFiles.push(p);
  }
})(PUB);
const js = jsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// 引用来源: data-t 家族 + tr('键')/t('键') + 代码里以字符串形式出现的键名(动态表/前缀拼接的参数表)
const refs = new Set();
for (const m of html.matchAll(/data-t(?:-ph|-tt)?="([^"]+)"/g)) refs.add(m[1]);
for (const m of js.matchAll(/\btr?\(\s*'([^']+)'\s*\)/g)) refs.add(m[1]);
const literals = new Set();
for (const m of js.matchAll(/'([A-Za-z][A-Za-z0-9_-]{3,})'/g)) literals.add(m[1]);
const missing = [];
for (const lg of langs) for (const k of keys) {
  const v = L[lg][k];
  if (v === undefined || v === null || v === '') missing.push(lg + '.' + k);
}
const unknown = [...refs].filter((k) => !keys.includes(k));
const noHome = keys.filter((k) => !refs.has(k) && !literals.has(k));
const dynamic = noHome.filter((k) => [...literals].some((lit) => k.startsWith(lit)));
const truly = noHome.filter((k) => dynamic.indexOf(k) < 0);
console.log('[文案盘点] 字典 ' + langs.join('/') + ' 各 ' + keys.length + ' 键 | 页面/JS 引用 ' + refs.size + ' 键');
console.log('  ① 缺失或空值: ' + (missing.length ? missing.join(', ') : '0 (三语对齐)'));
console.log('  ② 引用了但字典没有: ' + (unknown.length ? unknown.join(', ') : '0'));
console.log('  ③ 字典里有、界面零引用: ' + truly.length + ' 键(旧版遗留资产, 允许存在; 若其中某键本该显示说明, 就是"文案位掉了")');
if (truly.length) console.log('     ' + truly.slice(0, 40).join(', ') + (truly.length > 40 ? ' …' : ''));
if (dynamic.length) console.log('  ④ 疑似动态拼接引用(不计入 ③): ' + dynamic.length + ' 键 -> ' + dynamic.slice(0, 12).join(', ') + (dynamic.length > 12 ? ' …' : ''));

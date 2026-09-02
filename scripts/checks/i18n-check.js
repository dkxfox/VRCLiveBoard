'use strict';
// G-I18N 三语键对齐: zh-CN / zh-TW / en 的键集合必须完全一致
//   坑源: 每次加 UI 文案都要动三处, 漏一处就是界面上突然冒出英文键名(条目 65/71/81)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const file = path.join(ROOT, 'src', 'web', 'public', 'lang.js');
const code = fs.readFileSync(file, 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
try { vm.runInContext(code, sandbox, { timeout: 5000 }); }
catch (e) { console.log('[G-I18N] FAIL lang.js 执行失败: ' + e.message); process.exit(1); }

const L = sandbox.window.VRCB_LANG;
if (!L || typeof L !== 'object') { console.log('[G-I18N] FAIL 未找到 window.VRCB_LANG'); process.exit(1); }
const langs = Object.keys(L);
const keysOf = (k) => new Set(Object.keys(L[k] || {}));
const base = langs[0];
const problems = [];
const warns = [];
console.log('[G-I18N i18n-check] 语言: ' + langs.join(', ') + ' | 基准 ' + base + ' 共 ' + keysOf(base).size + ' 键');
for (const lang of langs.slice(1)) {
  const a = keysOf(base), b = keysOf(lang);
  const missing = [...a].filter((k) => !b.has(k));
  const extra = [...b].filter((k) => !a.has(k));
  const empty = [...b].filter((k) => typeof L[lang][k] === 'string' && L[lang][k].trim() === '');
  if (missing.length) problems.push(lang + ' 缺少 ' + missing.length + ' 键: ' + missing.slice(0, 8).join(', '));
  if (extra.length) problems.push(lang + ' 多出 ' + extra.length + ' 键: ' + extra.slice(0, 8).join(', '));
  // 空值只警告不拦: 英文里 pageN2 这类后缀本来就该为空("Page 3" 无后缀)
  if (empty.length) warns.push(lang + ' 有 ' + empty.length + ' 个空值(确认是否有意): ' + empty.slice(0, 8).join(', '));
  console.log('  ' + (missing.length + extra.length ? 'FAIL' : 'OK  ') + ' ' + lang + ': ' + b.size + ' 键 (缺 ' + missing.length + ' / 多 ' + extra.length + ' / 空 ' + empty.length + ')');
}
for (const p of problems) console.log('  -> FAIL ' + p);
for (const w of warns) console.log('  -> WARN ' + w);
process.exit(problems.length ? 1 : 0);

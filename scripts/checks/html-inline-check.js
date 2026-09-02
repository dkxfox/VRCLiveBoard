'use strict';
// G-HTML 控制台页面门禁: 内联脚本语法 + 重复 id + getElementById 目标存在性
//   坑源: 每加一行 HTML 内联脚本边界就漂移(条目 81), 预览框元素从未接线(19)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const file = path.join(ROOT, 'src', 'web', 'public', 'index.html');
const html = fs.readFileSync(file, 'utf8');

// 动态取内联脚本边界(禁止写死行号)
const blocks = [];
const openRe = /<script([^>]*)>/gi;
let m;
while ((m = openRe.exec(html)) !== null) {
  if (/\ssrc\s*=/.test(m[1])) continue;
  const start = m.index + m[0].length;
  const end = html.indexOf('</script>', start);
  if (end < 0) { blocks.push({ start, end: html.length, broken: true }); break; }
  blocks.push({ start, end, code: html.slice(start, end) });
  openRe.lastIndex = end;
}

let fail = 0;
console.log('[G-HTML html-inline-check] 内联脚本块: ' + blocks.length);
for (const [i, b] of blocks.entries()) {
  if (b.broken) { console.log('  FAIL 第 ' + (i + 1) + ' 块缺少 </script> 闭合'); fail++; continue; }
  try { new vm.Script(b.code, { filename: 'index.html#inline' + (i + 1) }); console.log('  OK   第 ' + (i + 1) + ' 块语法通过 (' + b.code.length + ' 字符)'); }
  catch (e) { console.log('  FAIL 第 ' + (i + 1) + ' 块语法错误: ' + e.message); fail++; }
}

// 重复 id
const ids = [...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((x) => x[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) { console.log('  FAIL 重复 id: ' + [...new Set(dup)].join(', ')); fail++; }
else console.log('  OK   id 唯一性: ' + ids.length + ' 个 id 无重复');

// getElementById 目标存在性(动态创建的元素会误报, 故只 WARN)
const idSet = new Set(ids);
const refs = [...html.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((x) => x[1]);
const missing = [...new Set(refs)].filter((r) => !idSet.has(r));
if (missing.length) console.log('  WARN getElementById 目标在 HTML 中不存在(可能是动态创建): ' + missing.slice(0, 10).join(', '));
else console.log('  OK   getElementById 目标全部存在 (' + new Set(refs).size + ' 个)');

process.exit(fail ? 1 : 0);

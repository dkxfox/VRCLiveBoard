'use strict';
// G-HTML 控制台页面门禁: 内联+外链脚本语法 + 重复 id + getElementById 目标存在性
//   坑源: 每加一行 HTML 内联脚本边界就漂移(条目 81), 预览框元素从未接线(19)
//   2026-09-02 index.html 拆分后: 主脚本外链为 app.js, 此门禁改为同时检查外链脚本存在性与语法
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const file = path.join(ROOT, 'src', 'web', 'public', 'index.html');
const html = fs.readFileSync(file, 'utf8');

// 动态取脚本边界(禁止写死行号); src 外链与内联一起处理
const blocks = [];
const openRe = /<script([^>]*)>/gi;
let m;
while ((m = openRe.exec(html)) !== null) {
  const src = (m[1].match(/src\s*=\s*["']([^"']+)["']/) || [])[1] || null;
  if (src && !src.startsWith('/api')) {
    blocks.push({ src: src });
    openRe.lastIndex = m.index + m[0].length;
    continue;
  }
  const start = m.index + m[0].length;
  const end = html.indexOf('</script>', start);
  if (end < 0) { blocks.push({ start, end: html.length, broken: true }); break; }
  blocks.push({ start, end, code: html.slice(start, end) });
  openRe.lastIndex = end;
}

let fail = 0;
console.log('[G-HTML html-inline-check] 脚本块: ' + blocks.length + ' (内联 ' + blocks.filter((b) => b.code !== undefined || b.broken).length + ' / 外链 ' + blocks.filter((b) => b.src).length + ')');
for (const [i, b] of blocks.entries()) {
  if (b.src) {
    const f = path.join(ROOT, 'src', 'web', 'public', b.src.replace(/^\//, '').split('/').join(path.sep));
    if (!fs.existsSync(f)) { console.log('  FAIL 外链脚本不存在: ' + b.src); fail++; continue; }
    try {
      new vm.Script(fs.readFileSync(f, 'utf8'), { filename: b.src });
      console.log('  OK   ' + b.src + ' 存在且语法通过 (' + fs.statSync(f).size + ' 字节)');
    } catch (e) { console.log('  FAIL ' + b.src + ' 语法错误: ' + e.message); fail++; }
    continue;
  }
  if (b.broken) { console.log('  FAIL 第 ' + (i + 1) + ' 块缺少 </script> 闭合'); fail++; continue; }
  try { new vm.Script(b.code, { filename: 'index.html#inline' + (i + 1) }); console.log('  OK   第 ' + (i + 1) + ' 块语法通过 (' + b.code.length + ' 字符)'); }
  catch (e) { console.log('  FAIL 第 ' + (i + 1) + ' 块语法错误: ' + e.message); fail++; }
}

// 重复 id
const ids = [...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((x) => x[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) { console.log('  FAIL 重复 id: ' + [...new Set(dup)].join(', ')); fail++; }
else console.log('  OK   id 唯一性: ' + ids.length + ' 个 id 无重复');

// getElementById 目标存在性: HTML + 全部外链脚本一起收集引用(拆分后引用都在 app.js; 动态创建的元素会误报, 故只 WARN)
const idSet = new Set(ids);
const jsTexts = [html];
for (const b of blocks) if (b.src) {
  const f = path.join(ROOT, 'src', 'web', 'public', b.src.replace(/^\//, '').split('/').join(path.sep));
  if (fs.existsSync(f)) jsTexts.push(fs.readFileSync(f, 'utf8'));
}
const refs = [];
for (const t of jsTexts) refs.push(...[...t.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((x) => x[1]));
const missing = [...new Set(refs)].filter((r) => !idSet.has(r));
if (missing.length) console.log('  WARN getElementById 目标在 HTML 中不存在(可能是动态创建): ' + missing.slice(0, 10).join(', '));
else console.log('  OK   getElementById 目标全部存在 (' + new Set(refs).size + ' 个)');

process.exit(fail ? 1 : 0);

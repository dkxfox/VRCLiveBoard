'use strict';
// DEV-NOTES 保留窗口归档工具(2026-11-23 建立):
//   node scripts/checks/dev-notes-archive.js --before 349          # 预览: 归档编号 < 349 的正式条目
//   node scripts/checks/dev-notes-archive.js --before 349 --write  # 真正移动
// 规则: 主文件只保留最近两个发布版本的开发记录; 更早的编号条目原样移到
// docs/DEV-NOTES-ARCHIVE.md。项目速览 §1-§5 不归档。
// 写完必须跑: node scripts/checks/dev-notes-index.js --update
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(ROOT, 'docs', 'DEV-NOTES.md');
const ARCH = path.join(ROOT, 'docs', 'DEV-NOTES-ARCHIVE.md');
const args = process.argv.slice(2);
const wi = args.indexOf('--write');
const bi = args.indexOf('--before');
const write = wi >= 0;
const before = bi >= 0 ? parseInt(args[bi + 1], 10) : NaN;
if (!Number.isFinite(before) || before < 1) {
  console.error('用法: node scripts/checks/dev-notes-archive.js --before <条目号> [--write]');
  process.exit(2);
}
function blocks(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^## (\d+)\./.exec(lines[i]);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n <= 5) continue; // 项目速览, 永久留在主文件
    out.push({ n: n, start: i });
  }
  for (let i = 0; i < out.length; i++) out[i].end = (i + 1 < out.length) ? out[i + 1].start : lines.length;
  return out;
}
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');
const all = blocks(lines);
const selected = all.filter(function (b) { return b.n < before; });
if (!selected.length) { console.log('没有需要归档的条目(当前最早条目 ' + (all[0] ? all[0].n : '-') + ')'); process.exit(0); }
const nums = selected.map(function (b) { return b.n; });
console.log('待归档 ' + selected.length + ' 条: ' + nums[0] + ' … ' + nums[nums.length - 1]);
const kept = all.filter(function (b) { return b.n >= before; });
console.log('保留 ' + kept.length + ' 条: ' + (kept[0] ? kept[0].n : '-') + ' …');
if (!write) { console.log('预览模式: 未写盘。确认后加 --write。'); process.exit(0); }
const chunks = selected.map(function (b) { return lines.slice(b.start, b.end).join('\n').replace(/\s+$/, ''); });
let arch = '';
try { arch = fs.readFileSync(ARCH, 'utf8'); } catch (e) { arch = ''; }
if (!arch.trim()) {
  arch = '# VRCLiveBoard 开发存档 · 归档\n\n' +
    '> 本文件保存已移出主开发记录的旧条目, **只归档不删除**。\n' +
    '> 主文件 docs/DEV-NOTES.md 只保留最近两个发布版本的记录; 本文件不随发布包分发。\n' +
    '> 查找旧编号: 直接搜索 ## <编号>.。归档由 scripts/checks/dev-notes-archive.js 完成。\n\n';
}
arch = arch.replace(/\s+$/, '') + '\n\n---\n\n' + chunks.join('\n\n---\n\n') + '\n';
const keep = lines.slice();
for (let i = selected.length - 1; i >= 0; i--) keep.splice(selected[i].start, selected[i].end - selected[i].start);
fs.writeFileSync(ARCH, arch, 'utf8');
fs.writeFileSync(FILE, keep.join('\n'), 'utf8');
console.log('已写入归档: ' + path.relative(ROOT, ARCH));
console.log('主文件已移除 ' + selected.length + ' 条; 请运行 node scripts/checks/dev-notes-index.js --update 刷新索引');
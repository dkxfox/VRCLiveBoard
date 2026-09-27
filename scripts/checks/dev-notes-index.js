'use strict';
// GNOTES 记录索引一致性门禁(2026-09-27 建立):
//   DEV-NOTES.md 是本项目的"会话记忆", 已 1100+ 行; 找一条旧记录只能靠翻页 —— 所以给它生成一份条目索引。
//   索引**由脚本生成, 不许手工维护**(手工维护必然漂移):
//     node scripts/checks/dev-notes-index.js --update   # 刷新索引块(写完请顺眼看一眼 diff)
//     node scripts/checks/dev-notes-index.js            # 校验(门禁用): 索引是否与条目一致 + 编号是否严格递增
//   附带检查: 条目编号必须严格递增 —— 这条能抓住"追加条目时锚点取错, 把新条目插进上一条中间"那类事故。
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', '..', 'docs', 'DEV-NOTES.md');
const BASE = path.join(__dirname, '..', '..', 'docs', 'DEV-NOTES-INDEX-BASELINE.json');
const BT = String.fromCharCode(96);
const BEGIN = '<!-- DEV-NOTES-INDEX:BEGIN' ;
const END = '<!-- DEV-NOTES-INDEX:END -->';
const HEAD = '## 附录: 条目索引(自动生成, 勿手工编辑)';

const src = fs.readFileSync(FILE, 'utf8');
const lines = src.replace(/\r\n/g, '\n').split('\n');
const entries = [];
lines.forEach((l, i) => {
  const m = /^## (\d+)\.\s*(.*)$/.exec(l);
  if (m) entries.push({ n: parseInt(m[1], 10), title: m[2].trim(), line: i + 1 });
});

// 已知历史异常白名单(建门禁时已存在, 修不修另议 —— 见 ISSUES M-20260927-05): 白名单内 WARN, 白名单外 FAIL
let base = { orderAnomalies: [], emptyEntries: [] };
try { base = Object.assign(base, JSON.parse(fs.readFileSync(BASE, 'utf8'))); } catch (e) { console.log('  WARN 基线读取失败(按空白名单处理): ' + e.message); }

let fail = 0, warn = 0;
const say = (ok, msg) => { console.log('  ' + (ok === 'FAIL' ? 'FAIL' : ok === 'WARN' ? 'WARN' : 'OK  ') + ' ' + msg); if (ok === 'FAIL') fail++; if (ok === 'WARN') warn++; };

if (!entries.length) { console.log('  FAIL 没有解析到任何条目(文件格式变了?)'); process.exit(1); }
// 1) 编号严格递增(乱序/重复/插错位置都会在这里现形)
const bad = [];
for (let i = 1; i < entries.length; i++) if (entries[i].n <= entries[i - 1].n) bad.push({ key: entries[i - 1].n + '->' + entries[i].n, where: '行 ' + entries[i].line });
const show = (x) => x.key + '(' + x.where + ')';
const newBad = bad.filter((x) => base.orderAnomalies.indexOf(x.key) < 0);
const knownBad = bad.filter((x) => base.orderAnomalies.indexOf(x.key) >= 0);
say(bad.length ? (newBad.length ? 'FAIL' : 'WARN') : true, '条目编号严格递增(' + entries.length + ' 条: ' + entries[0].n + ' … ' + entries[entries.length - 1].n + ')' +
  (bad.length ? ' —— 乱序: ' + bad.map(show).join(', ') + (knownBad.length ? '(白名单历史项 ' + knownBad.length + ' 个, 见 ISSUES M-20260927-05)' : '') + (newBad.length ? ' **新增乱序**: ' + newBad.map(show).join(', ') + ' —— 常见原因: 追加时锚点取错, 新条目被插进上一条中间' : '') : ''));
// 2) 相邻条目之间必须有正文(防"空条目"与"标题连着标题")
const empt = [];
for (let i = 0; i < entries.length; i++) {
  const to = (i + 1 < entries.length) ? entries[i + 1].line - 1 : lines.length;
  const body = lines.slice(entries[i].line, to).filter((x) => x.trim()).length;
  if (body === 0) empt.push(entries[i].n);
}
const newEmpt = empt.filter((x) => base.emptyEntries.indexOf(x) < 0);
const knownEmpt = empt.filter((x) => base.emptyEntries.indexOf(x) >= 0);
say(empt.length ? (newEmpt.length ? 'FAIL' : 'WARN') : true, '每条目都有正文' + (empt.length ? ' —— 空条目: ' + empt.join(', ') + (knownEmpt.length ? '(白名单历史项 ' + knownEmpt.length + ' 个)' : '') + (newEmpt.length ? ' **新增空条目**: ' + newEmpt.join(', ') : '') : ''));

// 3) 生成索引表
const rows = entries.map((e) => {
  const d = /(20\d\d-\d\d-\d\d)/.exec(e.title);
  let t = e.title.replace(/\s*\(20\d\d-\d\d-\d\d[^)]*\)\s*/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  if (t.length > 72) t = t.slice(0, 71) + '…';
  return '| ' + e.n + ' | ' + (d ? d[1] : '—') + ' | ' + t + ' |';
});
const block = [
  BEGIN + ' —— 由 ' + BT + 'node scripts/checks/dev-notes-index.js --update' + BT + ' 生成, 勿手工编辑; GNOTES 门禁会比对 -->',
  '',
  HEAD,
  '',
  '| 条目 | 日期 | 标题 |',
  '| --- | --- | --- |',
].concat(rows).concat(['', END]).join('\n');

const bi = src.indexOf(BEGIN);
const ei = src.indexOf(END);
const hasBlock = bi >= 0 && ei > bi;
const update = process.argv.indexOf('--update') >= 0;

if (update) {
  const next = hasBlock ? (src.slice(0, bi) + block + src.slice(ei + END.length)) : (src.replace(/\s*$/, '') + '\n\n' + block + '\n');
  fs.writeFileSync(FILE, next, 'utf8');
  console.log('  索引已刷新: ' + rows.length + ' 条 -> ' + path.relative(path.join(__dirname, '..', '..'), FILE));
  process.exit(fail ? 1 : 0);
}

if (!hasBlock) {
  say('FAIL', 'DEV-NOTES.md 里没有索引块 —— 跑 ' + BT + 'node scripts/checks/dev-notes-index.js --update' + BT + ' 生成');
} else {
  const cur = src.slice(bi, ei + END.length);
  say(cur === block ? true : 'FAIL', cur === block ? '索引与条目列表一致(' + rows.length + ' 条)' : '索引过期或与条目不一致 —— 跑 ' + BT + 'node scripts/checks/dev-notes-index.js --update' + BT + ' 刷新');
}
console.log('  ---- ' + (fail ? fail + ' FAIL' : '0 FAIL') + ' / ' + warn + ' WARN ----');
process.exit(fail ? 1 : 0);
'use strict';
// G-I18NH 硬编码文案检测: 新 UI 里"没接 data-t 的中文"必须显式进白名单基线
// 覆盖: HTML 文本节点(无 data-t)、placeholder/title 属性(无 data-t-ph/data-tt)、app.js 字符串里的中文
// 基线 docs/I18N-BASELINE.json 记录当前全部豁免项; 新增即 FAIL(强制接 i18n 或人工复核)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(ROOT, 'docs', 'I18N-BASELINE.json');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const cjk = (s) => s.match(/[\u4e00-\u9fff]+/g) || [];
function scanIndex(t) {
  let s = t.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const found = new Set();
  let m;
  // 文本节点 <tag attr>...中文...</tag>
  const re = /<([a-z][a-z0-9]*)([^>]*)>([^<]*[\u4e00-\u9fff][^<]*)<\/\1>/gi;
  while ((m = re.exec(s))) {
    if (/data-t\b|data-t-ph\b|data-tt\b/.test(m[2] || '')) continue;
    const v = norm(m[3]);
    if (v) found.add('HTML|' + v);
  }
  // 属性 placeholder/title="中文"
  const at = /(?:placeholder|title)="([^"]*[\u4e00-\u9fff][^"]*)"/gi;
  while ((m = at.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 220), m.index);
    const tag = before.lastIndexOf('<');
    const tagStr = tag >= 0 ? before.slice(tag) : '';
    if (/data-t-ph\b|data-tt\b/.test(tagStr)) continue;
    const v = norm(m[1]);
    if (v) found.add('HTML|' + v);
  }
  return [...found].sort();
}
function scanApp(t) {
  let s = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const found = new Set();
  const re = /'[^'\n]*[\u4e00-\u9fff][^'\n]*'/g;
  let m;
  while ((m = re.exec(s))) for (const c of cjk(m[0])) found.add('JS|' + c);
  return [...found].sort();
}
function collect() {
  // 扫描范围 = 界面逻辑所在的全部文件: app.js 以及 2026-09-11 从 index.html 内联块迁出的 theme.js / fx.js
  // (lang.js 是词库本身不扫; 不把新文件纳进来 = 那些中文会从门禁视野里消失)
  const { uiJsSources } = require('./_ui-files.js');
  const js = new Set();
  for (const src of uiJsSources(ROOT)) {
    const f = src.file;
    for (const x of scanApp(src.text)) js.add(x);
  }
  return {
    indexHtml: scanIndex(fs.readFileSync(path.join(ROOT, 'src', 'web', 'public', 'index.html'), 'utf8')),
    appJs: [...js].sort()
  };
}
const cur = collect();
if (process.argv.includes('--dump')) {
  console.log('[G-I18NH] 当前非 data-t 中文(HTML ' + cur.indexHtml.length + ' / JS ' + cur.appJs.length + '):');
  for (const x of cur.indexHtml) console.log('  ' + x);
  for (const x of cur.appJs) console.log('  ' + x);
  process.exit(0);
}
if (process.argv.includes('--update-baseline')) {
  const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  base.indexHtml = cur.indexHtml; base.appJs = cur.appJs; base.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(BASELINE, JSON.stringify(base, null, 2) + '\n', 'utf8');
  console.log('[G-I18NH] 基线已更新: docs/I18N-BASELINE.json (' + cur.indexHtml.length + ' HTML / ' + cur.appJs.length + ' JS)');
  process.exit(0);
}
if (!fs.existsSync(BASELINE)) { console.log('[G-I18NH] FAIL 基线不存在, 先跑 --update-baseline 并人工复核'); process.exit(1); }
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
let fail = 0;
function diff(label, now, was) {
  const added = now.filter((x) => !(was || []).includes(x));
  const removed = (was || []).filter((x) => !now.includes(x));
  if (added.length) { console.log('  FAIL ' + label + ' 新增硬编码(接 t()/data-t 或确认后进基线): ' + added.join(' | ')); fail++; }
  if (removed.length) console.log('  INFO ' + label + ' 减少(已接 i18n, 可 --update-baseline 清理): ' + removed.slice(0, 15).join(' | '));
  if (!added.length && !removed.length) console.log('  OK   ' + label + ' 与基线一致 (' + now.length + ' 项)');
}
console.log('[G-I18NH i18n-hardcode] 新 UI 硬编码中文文案');
diff('HTML', cur.indexHtml, base.indexHtml);
diff('JS', cur.appJs, base.appJs);
process.exit(fail ? 1 : 0);

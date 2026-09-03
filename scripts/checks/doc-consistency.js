'use strict';
// G-DOC 说明文件一致性门禁: 说明文件过时错误检查(2026-09-03 文档漂移审计后制度化)
//   基线 docs/DOC-BASELINE.json: must/mustNot = 纯子串; links = 必须存在的仓库内文件。
//   改代码动了文档事实时, 人工复核后更新基线(与 SECURITY-BASELINE 同纪律)。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
let fail = 0;
const say = (lv, msg) => { console.log('  ' + (lv === 'FAIL' ? 'FAIL' : 'OK  ') + ' ' + msg); if (lv === 'FAIL') fail++; };
let base;
try { base = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'DOC-BASELINE.json'), 'utf8').replace(/^\uFEFF/, '')); }
catch (e) { console.log('[G-DOC doc-consistency] 基线读取失败: ' + e.message); process.exit(1); }
console.log('[G-DOC doc-consistency] 基线 ' + base.updatedAt);
for (const [file, rules] of Object.entries(base.files || {})) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) { say('FAIL', file + ' 不存在(基线里的文件被改名/删除?)'); continue; }
  const text = fs.readFileSync(p, 'utf8');
  for (const s of rules.must || []) { if (text.indexOf(s) < 0) say('FAIL', file + ' 缺少描述: ' + s); else say('OK', file + ' 含: ' + s.slice(0, 40)); }
  for (const s of rules.mustNot || []) { if (text.indexOf(s) >= 0) say('FAIL', file + ' 含过时描述: ' + s); }
}
for (const [file, links] of Object.entries(base.links || {})) {
  for (const l of links) {
    if (!fs.existsSync(path.join(ROOT, l))) say('FAIL', file + ' 引用的文件不存在: ' + l);
    else say('OK', file + ' 链接有效: ' + l);
  }
}
console.log('  ---- ' + (fail ? fail + ' FAIL' : '0 FAIL') + ' ----');
process.exit(fail ? 1 : 0);

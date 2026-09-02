'use strict';
// GDEP 依赖与产物完整性: 依赖清单 / vendor 与关键二进制的哈希 必须与基线一致
//   思路: 供应链事故的共同点是"某个文件被换掉了而没人注意"。基线 + 哈希 = 换掉就报。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(ROOT, 'docs', 'SECURITY-BASELINE.json');

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Dir(d) {
  const parts = [];
  (function walk(x, rel) {
    for (const e of fs.readdirSync(x, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(x, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, r); else parts.push(r + ':' + sha256File(p));
    }
  })(d, '');
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}
function collect() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const artifacts = {};
  for (const rel of ['VRCLiveBoard.exe', 'electron/app.ico', 'scripts/launcher/launcher.cs', 'src/helpers/smtc.py', 'src/helpers/screen_capture.ps1']) {
    const p = path.join(ROOT, rel.split('/').join(path.sep));
    if (fs.existsSync(p)) artifacts[rel] = sha256File(p);
  }
  for (const d of fs.readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const v = path.join(ROOT, 'plugins', d.name, 'vendor');
    if (fs.existsSync(v)) artifacts['plugins/' + d.name + '/vendor/'] = sha256Dir(v);
  }
  return { dependencies: pkg.dependencies || {}, artifacts: artifacts };
}

const cur = collect();
if (process.argv.includes('--update-baseline')) {
  const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  base.supplyChain = cur;
  base.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(BASELINE, JSON.stringify(base, null, 2) + '\n', 'utf8');
  console.log('[GDEP] 基线已更新: 依赖 ' + Object.keys(cur.dependencies).length + ' 个, 产物哈希 ' + Object.keys(cur.artifacts).length + ' 项');
  process.exit(0);
}
const base = (JSON.parse(fs.readFileSync(BASELINE, 'utf8')).supplyChain) || { dependencies: {}, artifacts: {} };
let fail = 0;
console.log('[GDEP dep-audit] 依赖 ' + Object.keys(cur.dependencies).length + ' 个 / 受监控产物 ' + Object.keys(cur.artifacts).length + ' 项');

for (const [name, ver] of Object.entries(cur.dependencies)) {
  if (!(name in base.dependencies)) { console.log('  FAIL 新增依赖未进基线: ' + name + '@' + ver + '(需评审来源/体积/许可)'); fail++; }
  else if (base.dependencies[name] !== ver) { console.log('  FAIL 依赖版本变化: ' + name + ' ' + base.dependencies[name] + ' -> ' + ver); fail++; }
}
for (const name of Object.keys(base.dependencies)) if (!(name in cur.dependencies)) console.log('  INFO 依赖已移除: ' + name);
if (!fail) console.log('  OK   依赖清单与基线一致');

for (const [rel, h] of Object.entries(cur.artifacts)) {
  if (!(rel in base.artifacts)) { console.log('  FAIL 新增受监控产物未进基线: ' + rel); fail++; }
  else if (base.artifacts[rel] !== h) { console.log('  FAIL 产物被改动(哈希不符): ' + rel + '\n         基线 ' + base.artifacts[rel].slice(0, 16) + '…  现在 ' + h.slice(0, 16) + '…'); fail++; }
}
for (const rel of Object.keys(base.artifacts)) if (!(rel in cur.artifacts)) { console.log('  FAIL 受监控产物消失: ' + rel); fail++; }
if (Object.keys(cur.artifacts).every((r) => base.artifacts[r] === cur.artifacts[r])) console.log('  OK   受监控产物哈希全部匹配');

// npm audit(best effort; 离线只警告)
if (!process.argv.includes('--no-npm')) {
  try {
    const out = execFileSync('npm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, shell: true });
    const j = JSON.parse(out);
    const v = (j.metadata && j.metadata.vulnerabilities) || {};
    const total = Object.values(v).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    const bad = (v.critical || 0) + (v.high || 0);
    console.log('  ' + (bad ? 'FAIL' : 'OK  ') + ' npm audit: 严重 ' + (v.critical || 0) + ' / 高危 ' + (v.high || 0) + ' / 中 ' + (v.moderate || 0) + ' / 低 ' + (v.low || 0) + '(合计 ' + total + ')');
    if (bad) fail++;
  } catch (e) {
    const msg = String(e.stdout || e.message || '');
    try {
      const j = JSON.parse(msg);
      const v = (j.metadata && j.metadata.vulnerabilities) || {};
      const bad = (v.critical || 0) + (v.high || 0);
      console.log('  ' + (bad ? 'FAIL' : 'OK  ') + ' npm audit: 严重 ' + (v.critical || 0) + ' / 高危 ' + (v.high || 0) + ' / 中 ' + (v.moderate || 0) + ' / 低 ' + (v.low || 0));
      if (bad) fail++;
    } catch (e2) { console.log('  WARN npm audit 未能执行(离线?): ' + msg.split('\n')[0].slice(0, 120)); }
  }
}
process.exit(fail ? 1 : 0);

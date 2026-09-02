'use strict';
// GSURF 攻击面基线: 出厂代码里的"外部域名 / 监听端口 / 危险 API 用法"必须与基线一致
//   思路: 攻击面不是"有没有漏洞", 而是"有没有在我不知道的情况下变大"。
//   新增一个外部域名 / 一个端口 / 一处 child_process, 都必须显式进基线(= 有人看过并接受)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(ROOT, 'docs', 'SECURITY-BASELINE.json');
// 只扫"会随包出厂"的代码; dev-dongle / checks / vendor 第三方库不算出厂攻击面
const SCAN_DIRS = ['src', 'plugins', 'electron'];
const SCAN_ROOT_FILES = ['启动.bat', '启动桌面版.bat', 'config.default.json'];
const SKIP_DIR = new Set(['node_modules', 'vendor', '.git']);
const DANGEROUS = ['child_process', 'spawn(', 'execFile', 'eval(', 'new Function', 'fs.rmSync', 'shell: true'];

function collect() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (SKIP_DIR.has(e.name)) continue; walk(path.join(dir, e.name)); }
        else if (/\.(js|cjs|mjs|ps1|bat|py|html|json)$/i.test(e.name)) files.push(path.join(dir, e.name));
      }
    })(abs);
  }
  for (const f of SCAN_ROOT_FILES) if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f));

  const domains = new Set(), ports = new Set(), dangerous = {};
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g)) { const h = m[1]; if (!/^(127\.0\.0\.1|localhost)$/.test(h)) domains.add(h); }
    // 只在"端口语境"里取数字: port: 1234 / port=1234 / :1234(URL) / listen(1234
    for (const re of [/port["'\s:=]+(\d{4,5})/gi, /:(\d{4,5})(?:\/|\b)/g, /listen\(\s*(\d{4,5})/gi]) {
      for (const m of t.matchAll(re)) { const p = Number(m[1]); if (p >= 1024 && p <= 65535) ports.add(String(p)); }
    }
    for (const pat of DANGEROUS) if (t.includes(pat)) (dangerous[pat] = dangerous[pat] || []).push(rel);
  }
  return {
    domains: [...domains].sort(),
    ports: [...ports].sort((a, b) => a - b),
    dangerous: Object.fromEntries(Object.entries(dangerous).map(([k, v]) => [k, v.sort()]))
  };
}

const cur = collect();
if (process.argv.includes('--update-baseline')) {
  const base = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  base.surface = cur;
  base.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(BASELINE, JSON.stringify(base, null, 2) + '\n', 'utf8');
  console.log('[GSURF] 基线已更新: ' + path.relative(ROOT, BASELINE));
  console.log('  域名 ' + cur.domains.length + ' / 端口 ' + cur.ports.length + ' / 危险 API 类别 ' + Object.keys(cur.dangerous).length);
  process.exit(0);
}
if (!fs.existsSync(BASELINE)) { console.log('[GSURF] FAIL 基线不存在, 先跑 --update-baseline 并人工复核'); process.exit(1); }
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).surface || {};
let fail = 0;
function diff(label, now, was) {
  const added = now.filter((x) => !(was || []).includes(x));
  const removed = (was || []).filter((x) => !now.includes(x));
  if (added.length) { console.log('  FAIL ' + label + ' 新增(需人工复核后进基线): ' + added.join(', ')); fail++; }
  if (removed.length) console.log('  INFO ' + label + ' 减少(攻击面缩小, 记得更新基线): ' + removed.join(', '));
  if (!added.length && !removed.length) console.log('  OK   ' + label + ' 与基线一致 (' + now.length + ' 项)');
}
console.log('[GSURF surface-scan] 出厂代码攻击面');
diff('外部域名', cur.domains, base.domains);
diff('端口', cur.ports, base.ports);
const cats = [...new Set([...Object.keys(cur.dangerous), ...Object.keys(base.dangerous || {})])];
for (const c of cats) diff('危险API ' + c, cur.dangerous[c] || [], (base.dangerous || {})[c] || []);
process.exit(fail ? 1 : 0);

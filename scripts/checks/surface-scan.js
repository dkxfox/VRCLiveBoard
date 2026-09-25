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
// 2026-09-25 审计修正(**扫描器自身的盲区**): 上面写着"只扫会随包出厂的代码", 但实际只跳过了 node_modules/vendor/.git,
// 于是 plugins/<id>/test 这类**永不进包**的开发文件也被算进攻击面 —— 结果是最新的 B站插件一上来就报
// "新增域名 i0.hdslb.com / x"(测试夹具里的假 URL)和"新增 child_process"(测试汇总脚本), 全是噪音。
// 真正进包与否的**唯一来源**是 scripts/pack-exclude.json(打包脚本就用它), 这里改成读它。
const PE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'pack-exclude.json'), 'utf8'));
const EX_DIR = (PE.dirs || []).map((d) => String(d).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase());
const EX_FILE = (PE.files || []).map((f) => String(f).replace(/\\/g, '/').toLowerCase());
function isExcluded(rel) {
  const r = String(rel).replace(/\\/g, '/').toLowerCase();
  for (const d of EX_DIR) if (r === d || r.startsWith(d + '/')) return true;
  for (const f of EX_FILE) {
    const base = r.split('/').pop();
    if (!f.includes('*')) { if (r === f || base === f) return true; continue; }
    const re = new RegExp('^' + f.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
    if (re.test(base)) return true;
  }
  return false;
}
const DANGEROUS = ['child_process', 'spawn(', 'execFile', 'eval(', 'new Function', 'fs.rmSync', 'shell: true'];

function collect() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (isExcluded(path.relative(ROOT, full))) continue;          // 不进包的东西不算出厂攻击面
        if (e.isDirectory()) { if (SKIP_DIR.has(e.name)) continue; walk(full); }
        else if (/\.(js|cjs|mjs|ps1|bat|py|html|json)$/i.test(e.name)) files.push(full);
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
      for (const m of t.matchAll(re)) {
  // 排除 CSS z-index 之类的假端口(M-20260911-37): z-index:9999 被当成"端口 9999"会让安全基线无意义地漂移
  const numAt = m.index + m[0].indexOf(m[1]);
  if (/z-index\s*:\s*$/.test(t.slice(Math.max(0, numAt - 12), numAt))) continue;
  // 排除时间/间隔/超时类数值(M-20260911-53): 20000(毫秒上限) / timeout: 20000 / displayMs : 120000 都不是端口
  const ctx = t.slice(Math.max(0, numAt - 28), numAt);
  if (/(ms|MS|Ms|timeout|Timeout|interval|Interval|delay|Delay|maxMs|displayMs|TimeoutMs)\s*[=:]\s*$/.test(ctx)) continue;
  const p = Number(m[1]); if (p >= 1024 && p <= 65535) ports.add(String(p));
}
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

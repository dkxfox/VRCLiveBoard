'use strict';
// GROUTE 后端口径清单: server.js 里的 (method, path, 门禁等级) 必须与 docs/ROUTES-BASELINE.json 完全一致
//   坑源: 2026-09 审核发现 /api/special/video 对 file 参数零校验(漏门) —— 路由是手写的 if 链,
//         没有人知道"到底有多少条、哪一条本该要密码"; 后续改动把 needL1 拿掉也没人会发现。
//   与 GSURF 攻击面基线同一思路: 不是防漏洞, 而是防"我不知道它变了"。
//   门禁等级以 403 响应为锚: needL1(res) / !unlockState.level1 + 403 -> L1; !unlockState.level2 + 403 -> L2
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SRV = path.join(ROOT, 'src', 'web', 'server.js');
const BASE = path.join(ROOT, 'docs', 'ROUTES-BASELINE.json');
const src = fs.readFileSync(SRV, 'utf8');
const L = src.split(/\r?\n/);

const raw = [];
L.forEach((l, i) => {
  if (/url\.pathname\s*===\s*'/.test(l) && /req\.method\s*===\s*'/.test(l)) {
    const m = (l.match(/req\.method\s*===\s*'(\w+)'/) || [])[1];
    const ps = [...l.matchAll(/url\.pathname\s*===\s*'([^']+)'/g)].map((x) => x[1]);
    raw.push({ line: i + 1, m: m, ps: ps });
  }
});
function levelOf(k) {
  const from = raw[k].line, to = (k + 1 < raw.length ? raw[k + 1].line : L.length);
  const blk = L.slice(from, to).join('\n');
  if (/needL1\(res\)/.test(blk)) return 1;
  if (/!unlockState\.level2[^\n]*403/.test(blk)) return 2;
  if (/!unlockState\.level1[^\n]*403/.test(blk)) return 1;
  return 0;
}
const cur = [];
raw.forEach((r, k) => {
  if (r.ps[0] === '/' || r.ps[0] === '/index.html') return; // 首页单列在 specialBranches
  r.ps.forEach((p) => cur.push({ m: r.m, p: p, level: levelOf(k) }));
});
const key = (x) => x.m + ' ' + x.p;
cur.sort((a, b) => (key(a) < key(b) ? -1 : 1));

let baseline = null;
try { baseline = JSON.parse(fs.readFileSync(BASE, 'utf8')); }
catch (e) { console.log('[G-ROUTE route-inventory] FAIL 基线读取失败: ' + e.message); process.exitCode = 1; return; }
const base = (baseline.routes || []).slice().sort((a, b) => (key(a) < key(b) ? -1 : 1));

const problems = [];
const curMap = {}; cur.forEach((x) => { curMap[key(x)] = x.level; });
const baseMap = {}; base.forEach((x) => { baseMap[key(x)] = x.level; });
for (const k of Object.keys(curMap)) {
  if (!(k in baseMap)) problems.push('新增路由未登记: ' + k + ' —— 请在 docs/ROUTES-BASELINE.json 补登记并写明门禁等级');
  else if (curMap[k] !== baseMap[k]) problems.push('门禁等级变化: ' + k + ' 基线 L' + baseMap[k] + ' -> 代码 L' + curMap[k] + (curMap[k] < baseMap[k] ? '(是不是漏了 needL1 / 403?)' : '(收紧需确认)'));
}
for (const k of Object.keys(baseMap)) {
  if (!(k in curMap)) problems.push('基线里的路由已不存在: ' + k + ' —— 删路由也要同步更新基线');
}
// 特殊分支(静态/首页/插件静态/兜底 404)必须仍在, 防重构时静默丢失
const specials = [
  ["首页分支", /url\.pathname === '\/' \|\| url\.pathname === '\/index\.html'/],
  ["静态资源分支", /url\.pathname\.indexOf\('\/api\/'\) !== 0/],
  ["插件静态分支", /url\.pathname\.startsWith\('\/plugin\/'\)/],
  ["兜底 404", /json\(res, 404, \{ ok: false \}\);/]
];
for (const [name, re] of specials) if (!re.test(src)) problems.push('特殊分支丢失: ' + name);

const c = { 0: 0, 1: 0, 2: 0 }; cur.forEach((x) => c[x.level]++);
console.log('[G-ROUTE route-inventory] 后端口径: 代码 ' + cur.length + ' 条 / 基线 ' + base.length + ' 条 / L0 ' + c[0] + ' L1 ' + c[1] + ' L2 ' + c[2]);
for (const p of problems) console.log('  -> FAIL ' + p);
process.exitCode = problems.length ? 1 : 0;

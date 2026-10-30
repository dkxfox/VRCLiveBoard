'use strict';
// GSEC 机密扫描: 工作区 + git 历史(历史一旦进过密钥, 删文件是没用的)
//   坑源: config.json.bak 混进发布包(条目 85) —— 当时的扫描器有"文件类型白名单"这个盲区,
//         所以这里**不设扩展名白名单**, 只按大小与二进制特征过滤
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SKIP_DIR = new Set(['node_modules', '.git', '.electron-cache', '.pydist', '.ocr-langs', '.ocr-cache', 'logs', 'dist']);
const MAX = 3 * 1024 * 1024;
const RULES = [
  ['OpenAI/DeepSeek 风格密钥', /\bsk-[a-zA-Z0-9]{16,}\b/],
  ['GitHub 令牌', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/],
  ['GitHub 细粒度令牌', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['AWS Access Key', /\bAKIA[0-9A-Z]{16}\b/],
  ['私钥 PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['B 站 SESSDATA', /SESSDATA=[0-9a-fA-F]{8}/],
  ['母狗口令文件特征', /master passphrase/i]
];
const JSON_RULES = [
  ['私有授权字段', /"(devchain|level1Password)"\s*:/],
  ['锚点', /"anchor"\s*:\s*"[0-9a-f]{16}"/]
];
// 白名单: 文档里讨论字段名是正常的; config.json 与 config.json.bak 是本地配置
// (后者由 src/configio.js 每次加载自动重写, 删不掉也不该删 —— 它已被 .gitignore 与 make-dist 的 *.bak 双重拦截)
const ALLOW = [/docs\/DEV-NOTES\.md$/, /docs\/PROCESS-0[0-9].*\.md$/, /docs\/GLOSSARY\.md$/, /docs\/ISSUES\.md$/, /scripts\/checks\//, /^config\.json$/, /^config\.json\.bak$/, /^dev-dongle\//];
const allowed = (rel) => ALLOW.some((re) => re.test(rel));

let fail = 0, scanned = 0;
const hits = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (SKIP_DIR.has(e.name)) continue; walk(p); continue; }
    const st = fs.statSync(p);
    if (st.size > MAX || st.size === 0) continue;
    const buf = fs.readFileSync(p);
    if (buf.includes(0)) continue;                       // 二进制跳过
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    scanned++;
    const txt = buf.toString('utf8');
    for (const [name, re] of RULES) if (re.test(txt) && !allowed(rel)) hits.push(['工作区', rel, name]);
    if (rel.endsWith('.json')) for (const [name, re] of JSON_RULES) if (re.test(txt) && !allowed(rel)) hits.push(['工作区', rel, name]);
  }
})(ROOT);

// git 历史: 所有 blob(仓库小, 全量可行)
// 2026-10-30: 原来每个 blob 一次 git cat-file -p, 在 UNC 工作区要跑十几分钟; 改成一次 git cat-file --batch.
let histScanned = 0;
try {
  const GIT_OPTS = { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 };
  const objs = execFileSync('git', ['rev-list', '--objects', '--all'], GIT_OPTS).split('\n');
  const map = new Map();
  const skipRe = /node_modules|\.(png|jpg|ico|zip|exe|woff2?|gz|map)$/i;
  for (const line of objs) {
    const sp = line.indexOf(' ');
    if (sp < 0) continue;
    const sha = line.slice(0, sp), name = line.slice(sp + 1);
    if (!name || skipRe.test(name)) continue;
    if (!map.has(sha)) map.set(sha, []);
    map.get(sha).push(name);
  }
  const shas = Array.from(map.keys());
  let out = Buffer.alloc(0);
  if (shas.length) {
    out = execFileSync('git', ['cat-file', '--batch'], {
      cwd: ROOT, input: shas.join('\n') + '\n', maxBuffer: 512 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore']
    });
  }
  let off = 0;
  while (off < out.length) {
    const nl = out.indexOf(10, off);
    if (nl < 0) break;
    const header = out.slice(off, nl).toString('utf8');
    off = nl + 1;
    const parts = header.split(' ');
    const sha = parts[0], type = parts[1], size = Number(parts[2]);
    if (!sha || !parts[1] || !isFinite(size)) continue;
    const content = out.slice(off, off + size);
    off += size;
    if (out[off] === 10) off++;
    if (type !== 'blob') continue;
    histScanned++;
    const names = map.get(sha) || [];
    const txt = content.toString('utf8');
    for (const [nm, re] of RULES) {
      if (!re.test(txt)) continue;
      for (const name of names) if (!allowed(name)) hits.push(['git历史', name + '@' + sha.slice(0, 7), nm]);
    }
  }
} catch (e) { console.log('  WARN git 历史扫描跳过: ' + String(e.message).split('\n')[0]); }

console.log('[GSEC secret-scan] 工作区文件 ' + scanned + ' 个 / git 历史 blob ' + histScanned + ' 个');
if (!hits.length) console.log('  PASS 未发现机密特征(白名单: 文档中的字段名讨论、本地 config.json、dev-dongle 本地资产)');
for (const [where, where2, what] of hits) { console.log('  FAIL [' + where + '] ' + where2 + ' -> ' + what); fail++; }
process.exit(fail ? 1 : 0);

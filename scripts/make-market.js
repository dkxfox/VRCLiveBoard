'use strict';
// 市场目录生成器(1.4.0, M-20260911-51): 把 plugins/ 里的插件打成分发 zip + 生成 market/index.json(提交进仓库, 客户端经 jsDelivr/raw 读)。
// 用法:
//   node scripts/make-market.js                 # 全部插件, 分级 official
//   node scripts/make-market.js --tier reviewed --only weather-board,netease-lyrics
//   node scripts/make-market.js --dry           # 只打印将要写入的内容
// 纪律: 只认有 manifest.json 的插件目录; 打包排除 data/ 与 node_modules/(运行时数据与依赖不进包);
//       每个包算 sha256 写进目录 —— 客户端安装前必须校验它(篡改/缓存投毒都在这里被挡下)。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PLUGINS = path.join(ROOT, 'plugins');
const MARKET = path.join(ROOT, 'market');
const PKGS = path.join(MARKET, 'packages');
const REPO = 'dkxfox/VRCLiveBoard';
const RAW_BASE = 'https://cdn.jsdelivr.net/gh/' + REPO + '@main/market/packages/';

const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] || '') : def; }
const TIER = String(arg('tier', 'official'));
const DRY = args.indexOf('--dry') >= 0;
if (['official', 'reviewed', 'experimental'].indexOf(TIER) < 0) { console.log('tier 只能是 official / reviewed / experimental'); process.exit(2); }
const only = String(arg('only', '')).split(',').map(function (s) { return s.trim(); }).filter(Boolean);

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

const ids = fs.readdirSync(PLUGINS).filter(function (n) {
  const d = path.join(PLUGINS, n);
  return fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'manifest.json'));
}).filter(function (id) { return !only.length || only.indexOf(id) >= 0; }).sort();

if (!ids.length) { console.log('plugins/ 下没有可发布的插件'); process.exit(1); }
if (!DRY) { fs.mkdirSync(PKGS, { recursive: true }); }

const items = [];
for (const id of ids) {
  const dir = path.join(PLUGINS, id);
  let mf;
  try { mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { console.log('[SKIP] ' + id + ' manifest 解析失败: ' + e.message); continue; }
  if (String(mf.id || '') !== id) { console.log('[SKIP] ' + id + ' manifest.id(' + mf.id + ') 与目录名不一致'); continue; }
  const version = String(mf.version || '');
  if (!/^\d+\.\d+\.\d+/.test(version)) { console.log('[SKIP] ' + id + ' 版本号非法: ' + version); continue; }
  const zip = path.join(PKGS, id + '-' + version + '.zip');
  if (!DRY) {
    fs.rmSync(zip, { force: true });
    execFileSync('tar', ['-a', '-c', '-f', zip, '--exclude=data', '--exclude=node_modules', '-C', dir, '.'], { windowsHide: true });
  }
  const size = DRY ? 0 : fs.statSync(zip).size;
  const hash = DRY ? '0'.repeat(64) : sha256File(zip);
  items.push({
    id: id, name: String(mf.name || id),
    author: { id: 'vrcliveboard', name: String(mf.author || 'VRCLiveBoard 官方'), contact: 'https://github.com/' + REPO },
    version: version, api: String(mf.api || ''), tier: TIER,
    summary: String(mf.description || ''), tags: Array.isArray(mf.tags) ? mf.tags : [],
    url: RAW_BASE + id + '-' + version + '.zip', sha256: hash, size: size,
    permissions: mf.permissions || {}, changelog: String(mf.changelog || ''), publishedAt: new Date().toISOString().slice(0, 10),
    minApp: String(mf.minApp || '1.4.0')
  });
  console.log((DRY ? '[dry] ' : '  ok  ') + id + ' @' + version + '  ' + Math.round(size / 1024) + 'KB  ' + hash.slice(0, 12) + '…');
}
const index = { schema: 1, updated: new Date().toISOString().slice(0, 10), note: '插件目录: 由 scripts/make-market.js 生成, 请勿手改(改插件的 manifest 后重新生成)。tier: official=官方 / reviewed=已审核第三方 / experimental=实验区(默认最严策略)。', items: items };
if (!DRY) {
  fs.writeFileSync(path.join(MARKET, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  const rv = path.join(MARKET, 'revoke.json');
  if (!fs.existsSync(rv)) fs.writeFileSync(rv, JSON.stringify({ schema: 1, updated: new Date().toISOString().slice(0, 10), note: '吊销列表: 命中即由客户端拒绝安装并提示原因(开放的安全阀)。', revoked: [] }, null, 2) + '\n', 'utf8');
  const total = items.reduce(function (s, x) { return s + x.size; }, 0);
  console.log('market/index.json 写入: ' + items.length + ' 条 / 合计 ' + (total / 1048576).toFixed(2) + ' MB');
} else {
  console.log(JSON.stringify(index, null, 1).slice(0, 600) + '\n…(dry run, 未写入)');
}

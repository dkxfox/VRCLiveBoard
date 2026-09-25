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

// 2026-09-25: 打包排除清单同样读 scripts/pack-exclude.json —— 之前只排了 data/ 与 node_modules/,
// 于是 plugins/bilibili-live/test/(300+ 条断言 + 假服务器, 且用到 child_process)**会被发给用户**。
const PE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'pack-exclude.json'), 'utf8'));
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
    // 排除项 = data/ + node_modules/ + pack-exclude 里针对本插件的条目(形如 plugins/<id>/xxx)
    const prefix = 'plugins/' + id + '/';
    const extra = [];
    for (const d of (PE.dirs || [])) {
      const s = String(d).replace(/\\/g, '/');
      if (s.toLowerCase().indexOf(prefix.toLowerCase()) === 0) extra.push(s.slice(prefix.length).replace(/\/+$/, ''));
    }
    const tarArgs = ['-a', '-c', '-f', zip, '--exclude=data', '--exclude=node_modules']
      .concat(extra.map(function (e) { return '--exclude=./' + e; }))
      .concat(['-C', dir, '.']);
    execFileSync('tar', tarArgs, { windowsHide: true });
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
// 2026-09-25: --only 只处理点名插件, 但**不能**因此把目录里其它插件删掉 —— 原来直接 items: items,
// 等于"新增一个插件会把其余全部下线"。这里与已有 index 合并(点名的覆盖, 其余的按原顺序保留)。
let merged = items;
const indexPath = path.join(MARKET, 'index.json');
if (only.length && fs.existsSync(indexPath)) {
  const old = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const byId = {};
  for (const it of items) byId[it.id] = it;
  merged = (old.items || []).map(function (it) { return byId[it.id] || it; });   // 点名的换成新条目, 其余原样保留
  for (const it of items) if (!(old.items || []).some(function (o) { return o.id === it.id; })) merged.push(it);
}
const index = { schema: 1, updated: new Date().toISOString().slice(0, 10), note: '插件目录: 由 scripts/make-market.js 生成, 请勿手改(改插件的 manifest 后重新生成)。tier: official=官方 / reviewed=已审核第三方 / experimental=实验区(默认最严策略)。', items: merged };
if (!DRY) {
  fs.writeFileSync(path.join(MARKET, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  const rv = path.join(MARKET, 'revoke.json');
  if (!fs.existsSync(rv)) fs.writeFileSync(rv, JSON.stringify({ schema: 1, updated: new Date().toISOString().slice(0, 10), note: '吊销列表: 命中即由客户端拒绝安装并提示原因(开放的安全阀)。', revoked: [] }, null, 2) + '\n', 'utf8');
  const total = items.reduce(function (s, x) { return s + x.size; }, 0);
  console.log('market/index.json 写入: ' + merged.length + ' 条(本次打包 ' + items.length + ' 个)/ 合计 ' + (total / 1048576).toFixed(2) + ' MB');
} else {
  console.log(JSON.stringify(index, null, 1).slice(0, 600) + '\n…(dry run, 未写入)');
}

'use strict';
// 检查更新(L1)的数据层: 纯函数, 不碰网络与文件 —— 便于门禁直接断言, 也便于以后复用到"一键更新"。
// 设计取舍(2026-09-19 与用户定的 L1 范围):
//   ① 更新内容随版本号写进仓库根目录的 version.json(经 jsDelivr 分发, 国内可用), **不需要打包后再提交** ——
//      因此不会有"包已打好、哈希才生成"的先有鸡后有蛋问题; 产物体积/下载地址属可选增强, 走 GitHub API, 拉不到就不显示。
//   ② 一切进入界面的远端字符串都要先过白名单与长度裁剪: 更新说明会被渲染给用户看, 而 version.json 在 CDN 上,
//      任何"原样透传"都等于把远端文本当成可信 UI 内容(与 M-20260911-05 同一类问题)。
const MAX_HISTORY = 8;          // 历史条目上限(界面只展示比当前版本新的)
const MAX_NOTES = 8;            // 单条版本最多几条说明
const MAX_NOTE_LEN = 160;       // 单条说明最长字符数
const MAX_DATE_LEN = 20;
// 官方域名白名单: 只接受官方仓库的 https 链接(锚尾 + 限定字符集), 防止把钓鱼地址渲染成"下载页"
function officialUrl(u) {
  return /^https:\/\/(github\.com\/dkxfox\/VRCLiveBoard|cdn\.jsdelivr\.net\/gh\/dkxfox\/VRCLiveBoard)(\/[A-Za-z0-9._~%\/-]*)?$/.test(String(u == null ? '' : u));
}
function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
// 远端 version.json -> 规范化历史(非法条目直接丢弃, 不抛错: 更新说明坏了也不能影响"检查更新"本身)
function normalizeHistory(j) {
  const out = [];
  const arr = j && Array.isArray(j.history) ? j.history : [];
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const v = cleanText(e.version, 20);
    if (!/^\d+\.\d+\.\d+$/.test(v)) continue;
    const notes = (Array.isArray(e.notes) ? e.notes : [])
      .map(function (n) { return cleanText(n, MAX_NOTE_LEN); })
      .filter(Boolean)
      .slice(0, MAX_NOTES);
    out.push({ version: v, date: cleanText(e.date, MAX_DATE_LEN), notes: notes });
    if (out.length >= MAX_HISTORY) break;
  }
  out.sort(function (a, b) { return compareVersions(b.version, a.version); });
  return out;
}
// "这次更新会带来什么": 只取比当前版本新的条目(新→旧)。没有历史时退化成"只有最新版一条"。
function newerEntries(remote, current, compare) {
  const cmp = compare || compareVersions;
  const list = (remote && Array.isArray(remote.history) && remote.history.length)
    ? remote.history
    : (remote && remote.version ? [{ version: remote.version, date: remote.published || '', notes: remote.note ? [remote.note] : [] }] : []);
  return list.filter(function (e) { return cmp(e.version, current) > 0; });
}
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function compareVersions(a, b) {
  const pa = parseVersion(a); const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1; }
  return 0;
}
// 当前安装是哪种口味: 包内 BUILD-INFO.json 的 kind(自包含/精简) —— 决定给用户看哪个产物的体积与哈希
function flavorOf(buildInfo) {
  const k = String((buildInfo && buildInfo.kind) || '').toLowerCase();
  if (k === 'lite') return 'lite';
  if (k === 'self-contained') return 'self-contained';
  return 'source';   // 源码运行 / 开发机
}
const ASSET_PATTERNS = {
  'self-contained': /Desktop-SelfContained/i,
  'lite': /Lite-RequiresNode/i
};
// 从 GitHub release 的 assets 里挑出与当前口味匹配的那个(挑不到就返回 null, 界面退化成"打开下载页")
function pickAsset(assets, flavor) {
  const list = Array.isArray(assets) ? assets : [];
  const re = ASSET_PATTERNS[flavor];
  if (!re) return null;
  for (const a of list) {
    const name = String((a && a.name) || '');
    if (!re.test(name)) continue;
    if (!officialUrl(a.browser_download_url)) continue;   // 下载地址必须也在白名单内
    return { name: name, bytes: Number(a.size) || 0, url: String(a.browser_download_url), sha256: '' };
  }
  return null;
}
// 从 SHA256SUMS 文本里取某个文件的哈希(发布流程里一直有这份资产)
function hashFromSums(text, fileName) {
  const re = new RegExp('([a-f0-9]{64})\\s+' + String(fileName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'im');
  const m = re.exec(String(text || ''));
  return m ? m[1].toLowerCase() : '';
}
function formatBytes(n) {
  const b = Number(n) || 0;
  if (b <= 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
module.exports = { officialUrl, cleanText, normalizeHistory, newerEntries, flavorOf, pickAsset, hashFromSums, formatBytes, compareVersions, MAX_HISTORY, MAX_NOTES, MAX_NOTE_LEN };

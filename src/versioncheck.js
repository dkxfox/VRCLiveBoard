'use strict';
// 新版本检测: jsDelivr(GitHub CDN, 国内可用)优先 → GitHub raw 回退; 可在 config.update.mirror 自定义第一源。
const UPDATEINFO = require('./updateinfo');
const DEF_SOURCES = [
  'https://cdn.jsdelivr.net/gh/dkxfox/VRCLiveBoard@main/version.json',
  'https://raw.githubusercontent.com/dkxfox/VRCLiveBoard/main/version.json'
];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache = null;

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function compareVersions(a, b) {
  const pa = parseVersion(a); const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1; }
  return 0;
}
function validate(j) {
  if (!j || typeof j !== 'object') return null;
  if (!parseVersion(j.version)) return null;
  const url = String(j.releaseUrl || '');
  // 安全: 只接受官方 GitHub 域名(防第三方镜像注入钓鱼下载链接)
  // 只允许官方域名的 https 链接, 且必须锚尾 + 限定字符集: 原正则只锚前缀, 形如
  // https://github.com/dkxfox/VRCLiveBoard"><img onerror=...> 的载荷能通过校验并进入前端 innerHTML(M-20260911-05)
  if (!UPDATEINFO.officialUrl(url)) return null;
  return {
    version: String(j.version),
    codename: String(j.codename || ''),
    published: String(j.published || ''),
    note: String(j.note || ''),
    releaseUrl: url,
    // 更新内容(检查更新 L1): 规范化后的历史条目, 界面只展示比当前版本新的那些
    history: UPDATEINFO.normalizeHistory(j)
  };
}
async function fetchRemote(sources) {
  // 全部源都查一遍, 取版本号最高的(jsDelivr 对 GitHub 文件有缓存, 单源优先可能拿到旧版本号)
  let best = null;
  for (const s of sources) {
    try {
      const r = await fetch(s + (s.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const j = await r.json();
      const v = validate(j);
      if (v && (!best || compareVersions(v.version, best.remote.version) > 0)) best = { remote: v, source: s };
    } catch (e) {}
  }
  return best || { remote: null, source: null };
}
async function checkUpdate(config, force) {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const extra = (config && config.update && typeof config.update.mirror === 'string' && config.update.mirror) ? [config.update.mirror] : [];
  const r = await fetchRemote(extra.concat(DEF_SOURCES));
  const value = { checkedAt: now, remote: r.remote, source: r.source, ok: !!r.remote };
  cache = { value: value, at: now };
  return value;
}
// ---- 产物信息(检查更新 L1 的可选增强) ----
// 更新内容走 version.json(jsDelivr, 国内可用); 而"哪个包、多大、哈希是多少"只有 GitHub Release 知道。
// 拉不到就返回 null, 界面退化成"打开下载页" —— 国内网络下 API 经常不通, 这是刻意设计的降级, 不是失败。
// 缓存口径与市场一致: 成功长缓存(6h), 失败短缓存(10min), 免得网络抖一下就要等半天。
const ASSET_OK_TTL_MS = 6 * 60 * 60 * 1000;
const ASSET_FAIL_TTL_MS = 10 * 60 * 1000;
const assetCache = Object.create(null);
async function fetchReleaseInfo(version, flavor, cfg) {
  const key = String(version) + '|' + String(flavor);
  const now = Date.now();
  const hit = assetCache[key];
  if (hit && now - hit.at < (hit.value ? ASSET_OK_TTL_MS : ASSET_FAIL_TTL_MS)) return hit.value;
  const timeoutMs = Number((cfg && cfg.timeoutMs) || 0) || 6000;
  const api = 'https://api.github.com/repos/dkxfox/VRCLiveBoard/releases/tags/v' + encodeURIComponent(String(version));
  let value = null;
  try {
    const r = await fetch(api, {
      headers: { 'User-Agent': 'VRCLiveBoard', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (r.ok) {
      const j = await r.json();
      const asset = UPDATEINFO.pickAsset(j && j.assets, flavor);
      if (asset) {
        // 哈希取自同一 release 的 SHA256SUMS 资产(约 200 字节)。注意: 同源校验只防传输损坏/截断,
        // 防不了"发布源被投毒" —— 要防那个得引入内置公钥签名, 属 L3 的决策点(已记录在案)。
        try {
          const sums = (j.assets || []).filter(function (a) { return /SHA256SUMS/i.test(String(a && a.name)); })[0];
          if (sums && UPDATEINFO.officialUrl(sums.browser_download_url)) {
            const rs = await fetch(sums.browser_download_url, { signal: AbortSignal.timeout(timeoutMs) });
            if (rs.ok) asset.sha256 = UPDATEINFO.hashFromSums(await rs.text(), asset.name);
          }
        } catch (e) { /* 哈希拿不到不影响展示体积与下载链接 */ }
        value = { asset: asset, publishedAt: String((j && j.published_at) || ''), source: 'github-api' };
      }
    }
  } catch (e) { value = null; }
  assetCache[key] = { value: value, at: now };
  return value;
}
module.exports = { checkUpdate, compareVersions, fetchReleaseInfo };

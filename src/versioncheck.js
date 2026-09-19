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
// 产物清单的 URL 由 version.json 的源改写而来(同一条 CDN 链路, 不引入新的域名)
function manifestUrls(cfg) {
  const list = [];
  const mirror = (cfg && typeof cfg.mirror === 'string') ? cfg.mirror : '';
  for (const s of [mirror].concat(DEF_SOURCES)) {
    if (!s || !/version\.json/i.test(s)) continue;
    list.push(s.replace(/version\.json/i, 'docs/RELEASE-ASSETS.json'));
  }
  // raw 排在 jsDelivr 前面: 发布后 jsDelivr 有缓存(会拿到上一版哈希), raw 是实时的
  list.sort(function (a, b) { return (a.indexOf('raw.githubusercontent') >= 0 ? 0 : 1) - (b.indexOf('raw.githubusercontent') >= 0 ? 0 : 1); });
  return list;
}
async function manifestLookup(version, flavor, cfg, timeoutMs) {
  for (const u of manifestUrls(cfg)) {
    try {
      const r = await fetch(u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) continue;
      const j = await r.json();
      const hit = UPDATEINFO.assetFromManifest(j, version, flavor);
      if (hit) {
        const v = (j.versions || {})[String(version)] || {};
        return { asset: hit, publishedAt: String(v.date || ''), source: 'repo-manifest' };
      }
    } catch (e) {}
  }
  return null;
}
// GitHub API 一路(体积/下载页 + SHA256SUMS 直链, 后者可能被重置)
async function apiLookup(version, flavor, timeoutMs) {
  const url = 'https://api.github.com/repos/dkxfox/VRCLiveBoard/releases/tags/v' + encodeURIComponent(String(version));
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'VRCLiveBoard', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!r.ok) return null;
    const j = await r.json();
    const asset = UPDATEINFO.pickAsset(j && j.assets, flavor);
    if (!asset) return null;
    // 注意: 同源校验只防传输损坏/截断, 防不了"发布源被投毒" —— 要防那个得引入内置公钥签名(L3 决策点)。
    try {
      const sums = (j.assets || []).filter(function (a) { return /SHA256SUMS/i.test(String(a && a.name)); })[0];
      if (sums && UPDATEINFO.officialUrl(sums.browser_download_url)) {
        for (let i = 0; i < 2 && !asset.sha256; i++) {   // 直链时通时断(实测 ECONNRESET): 重试一次再放弃
          try {
            const rs = await fetch(sums.browser_download_url, { signal: AbortSignal.timeout(timeoutMs) });
            if (rs.ok) asset.sha256 = UPDATEINFO.hashFromSums(await rs.text(), asset.name);
          } catch (e2) { /* 下一轮或放弃 */ }
        }
      }
    } catch (e) { /* 哈希拿不到不影响展示体积与下载页 */ }
    return { asset: asset, publishedAt: String((j && j.published_at) || '') };
  } catch (e) { return null; }
}
async function fetchReleaseInfo(version, flavor, cfg) {
  const key = String(version) + '|' + String(flavor);
  const now = Date.now();
  const hit = assetCache[key];
  if (hit && now - hit.at < (hit.value ? ASSET_OK_TTL_MS : ASSET_FAIL_TTL_MS)) return hit.value;
  const timeoutMs = Number((cfg && cfg.timeoutMs) || 0) || 6000;
  // 两路同时取, 互相校验:
  //   ① 仓库产物清单(docs/RELEASE-ASSETS.json, 经 raw/jsDelivr): 国内可达且自带校验和, 但**可能滞后**
  //      —— jsDelivr 对仓库文件有缓存, 发布后短时间内会拿到"上一版"的哈希(2026-09-19 实测踩到);
  //   ② GitHub API: 官方体积与下载页稳定可得, 但 SHA256SUMS 直链在国内常被重置(实测 ECONNRESET)。
  // 规则: **只有两路体积一致时才采信清单里的校验和** —— 错误的校验和比没有更糟(用户会以为下载物损坏)。
  const both = await Promise.all([
    manifestLookup(version, flavor, cfg, timeoutMs),
    apiLookup(version, flavor, timeoutMs)
  ]);
  const mf = both[0], ap = both[1];
  let value = null;
  if (ap && mf) {
    const a = ap.asset, m = mf.asset;
    const sameSize = !!(a.bytes && m.bytes && a.bytes === m.bytes);
    if (sameSize && m.sha256) a.sha256 = m.sha256;
    value = { asset: a, publishedAt: ap.publishedAt || mf.publishedAt, source: sameSize && m.sha256 ? 'github-api+manifest' : 'github-api' };
  } else if (ap) {
    value = { asset: ap.asset, publishedAt: ap.publishedAt, source: 'github-api' };
  } else if (mf) {
    value = { asset: mf.asset, publishedAt: mf.publishedAt, source: 'repo-manifest' };
  }
  assetCache[key] = { value: value, at: now };
  return value;
}
module.exports = { checkUpdate, compareVersions, fetchReleaseInfo };

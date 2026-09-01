'use strict';
// 新版本检测: jsDelivr(GitHub CDN, 国内可用)优先 → GitHub raw 回退; 可在 config.update.mirror 自定义第一源。
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
  if (!/^https:\/\/(github\.com\/dkxfox\/VRCLiveBoard|cdn\.jsdelivr\.net\/gh\/dkxfox\/VRCLiveBoard)/.test(url)) return null;
  return {
    version: String(j.version),
    codename: String(j.codename || ''),
    published: String(j.published || ''),
    note: String(j.note || ''),
    releaseUrl: url
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
module.exports = { checkUpdate, compareVersions };

'use strict';
// 插件市场客户端(1.4.0 MVP, M-20260911-51): GitHub 目录仓库 + jsDelivr 分发(与 versioncheck 同一套双源/白名单/缓存思路)。
// 信任模型四件套(DEV-NOTES 条目 106 拍板): 分级标记(tier) / 条目内容哈希(sha256) / 吊销列表(revoke) / 作者稳定 ID。
// 边界: 本模块只负责"取目录 + 校验 + 下载 + 校验哈希"; 解包与安装交给 manager.importZip(它已有 50MB/200MB/2000 条与 zip-slip 防线),
//       授权仍然走既有的红窗审批(市场不绕过任何一道门槛)。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { compareVersions } = require('./versioncheck');

const OFFICIAL_REPO = 'dkxfox/VRCLiveBoard';
const DEF_INDEX = [
  'https://cdn.jsdelivr.net/gh/' + OFFICIAL_REPO + '@main/market/index.json',
  'https://raw.githubusercontent.com/' + OFFICIAL_REPO + '/main/market/index.json'
];
const DEF_REVOKE = [
  'https://cdn.jsdelivr.net/gh/' + OFFICIAL_REPO + '@main/market/revoke.json',
  'https://raw.githubusercontent.com/' + OFFICIAL_REPO + '/main/market/revoke.json'
];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;          // 与 manager.importZip 的上限对齐
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA_RE = /^[a-f0-9]{64}$/i;
const TIERS = ['official', 'reviewed', 'experimental'];
// 官方域名的 https 下载地址(与 versioncheck 的 releaseUrl 同一口径: 锚尾 + 限定字符集, 防注入)
// 注意 jsDelivr 的地址形如 .../VRCLiveBoard@main/market/...: 字符集必须含 @ , 否则白名单会把自家默认地址拒掉
const URL_RE = new RegExp('^https://(cdn\\.jsdelivr\\.net/gh/' + OFFICIAL_REPO + '|raw\\.githubusercontent\\.com/' + OFFICIAL_REPO + '|github\\.com/' + OFFICIAL_REPO + ')([/@][A-Za-z0-9._~%/-]*)?$');

let cache = { index: null, revoke: null, at: 0, source: null, problems: [] };
let inflight = null;

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sha256File(p) { return sha256(fs.readFileSync(p)); }
function isLocalUrl(u) { return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(String(u || '')); }

// 取 JSON: 逐个源试, 限制响应体大小(防被投喂一个超大文件), 记录来源
async function fetchJson(urls, timeoutMs) {
  const problems = [];
  for (const u of urls) {
    try {
      const r = await fetch(u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(timeoutMs || 10000) });
      if (!r.ok) { problems.push(u + ' -> HTTP ' + r.status); continue; }
      const text = await r.text();
      if (text.length > MAX_JSON_BYTES) { problems.push(u + ' -> 响应过大'); continue; }
      return { json: JSON.parse(text), source: u, problems: problems };
    } catch (e) { problems.push(u + ' -> ' + e.message); }
  }
  return { json: null, source: null, problems: problems };
}

// 目录校验: 坏条目直接丢(不因为一条坏数据整份目录不可用), 但把原因记下来给界面看
function validateIndex(j, opts) {
  const o = opts || {};
  const allowLocal = !!o.allowLocal;
  const items = []; const problems = [];
  const arr = (j && Array.isArray(j.items)) ? j.items : [];
  if (!j || typeof j !== 'object') return { items: items, problems: ['目录不是 JSON 对象'], schema: 0, updated: '' };
  if (Number(j.schema || 0) !== 1) problems.push('目录 schema 不是 1(可能是更新版程序才能读的目录)');
  for (const it of arr) {
    const id = String((it && it.id) || '');
    const version = String((it && it.version) || '');
    const url = String((it && it.url) || '');
    const hash = String((it && it.sha256) || '').toLowerCase();
    const tier = TIERS.indexOf(String((it && it.tier) || '')) >= 0 ? String(it.tier) : 'experimental';
    if (!ID_RE.test(id)) { problems.push('条目 id 非法: ' + id); continue; }
    if (!/^\d+\.\d+\.\d+/.test(version)) { problems.push(id + ' 版本号非法: ' + version); continue; }
    if (!SHA_RE.test(hash)) { problems.push(id + ' 缺 sha256(市场必须能校验内容)'); continue; }
    const okUrl = allowLocal ? (isLocalUrl(url) || URL_RE.test(url)) : URL_RE.test(url);
    if (!okUrl) { problems.push(id + ' 下载地址不在白名单: ' + url.slice(0, 80)); continue; }
    const size = Number((it && it.size) || 0);
    if (size && size > MAX_ZIP_BYTES) { problems.push(id + ' 包体积超上限: ' + size); continue; }
    items.push({
      id: id, name: String((it && it.name) || id), version: version, tier: tier, summary: String((it && it.summary) || ''),
      url: url, sha256: hash, size: size, api: String((it && it.api) || ''), minApp: String((it && it.minApp) || ''),
      tags: Array.isArray(it && it.tags) ? it.tags.slice(0, 8).map(String) : [],
      permissions: (it && it.permissions && typeof it.permissions === 'object') ? it.permissions : {},
      author: (it && it.author && typeof it.author === 'object') ? { id: String(it.author.id || ''), name: String(it.author.name || ''), contact: String(it.author.contact || '') } : { id: '', name: String((it && it.author) || ''), contact: '' },
      changelog: String((it && it.changelog) || ''), publishedAt: String((it && it.publishedAt) || '')
    });
  }
  return { items: items, problems: problems, schema: Number((j && j.schema) || 0), updated: String((j && j.updated) || '') };
}
function validateRevoke(j) {
  const out = [];
  if (!j || typeof j !== 'object') return out;
  const arr = Array.isArray(j.revoked) ? j.revoked : [];
  for (const r of arr) {
    const id = String((r && r.id) || '');
    if (!ID_RE.test(id)) continue;
    const versions = Array.isArray(r && r.versions) ? r.versions.map(String) : [String((r && r.versions) || '*')];
    out.push({ id: id, versions: versions, reason: String((r && r.reason) || ''), at: String((r && r.at) || '') });
  }
  return out;
}
function isRevoked(revoked, id, version) {
  for (const r of revoked) if (r.id === id && (r.versions.indexOf('*') >= 0 || r.versions.indexOf(version) >= 0)) return r;
  return null;
}
function urlsFor(cfg, kind) {
  const base = (cfg && typeof cfg === 'object') ? cfg : {};
  const custom = String(base[kind === 'revoke' ? 'revokeUrl' : 'indexUrl'] || '');
  const defs = kind === 'revoke' ? DEF_REVOKE : DEF_INDEX;
  return custom ? [custom].concat(defs) : defs;
}
// 取目录(带缓存); force=true 忽略缓存
async function getCatalog(config, force) {
  const cfg = (config && config.market) || {};
  const now = Date.now();
  if (!force && cache.index && (now - cache.at) < CACHE_TTL_MS) return { index: cache.index, revoke: cache.revoke, source: cache.source, cached: true, problems: cache.problems };
  const idxUrls = urlsFor(cfg, 'index');
  const allowLocal = isLocalUrl(idxUrls[0]);
  const ri = await fetchJson(idxUrls, Number(cfg.timeoutMs || 0) || 10000);
  if (!ri.json) {
    cache = { index: null, revoke: null, at: now, source: null, problems: ri.problems };
    return { index: null, revoke: null, source: null, cached: false, problems: ri.problems };
  }
  const v = validateIndex(ri.json, { allowLocal: allowLocal });
  const rr = await fetchJson(urlsFor(cfg, 'revoke'), Number(cfg.timeoutMs || 0) || 10000);
  const revoked = validateRevoke(rr.json);
  const problems = ri.problems.concat(v.problems, rr.problems);
  cache = { index: { items: v.items, schema: v.schema, updated: v.updated, allowLocal: allowLocal }, revoke: revoked, at: now, source: ri.source, problems: problems };
  return { index: cache.index, revoke: revoked, source: ri.source, cached: false, problems: problems };
}
// 目录 ∩ 本地已装: 给界面用的合并视图(更新提示/吊销标记都在这里算)
function mergeWithInstalled(catalog, plugins) {
  const items = (catalog.index && catalog.index.items) || [];
  const revoked = catalog.revoke || [];
  const byId = {};
  for (const p of (plugins || [])) byId[p.id] = p;
  const out = items.map(function (it) {
    const inst = byId[it.id] || null;
    const cmp = inst ? compareVersions(it.version, String(inst.version || '0.0.0')) : 0;
    const rev = isRevoked(revoked, it.id, it.version) || (inst ? isRevoked(revoked, it.id, String(inst.version || '')) : null);
    return {
      id: it.id, name: it.name, version: it.version, tier: it.tier, summary: it.summary, author: it.author,
      permissions: it.permissions, changelog: it.changelog, publishedAt: it.publishedAt, api: it.api, minApp: it.minApp, tags: it.tags,
      installed: !!inst, installedVersion: inst ? String(inst.version || '') : '', installedApproved: inst ? !!inst.approved : false,
      enabled: inst ? !!inst.enabled : false,
      updateAvailable: !!(inst && cmp > 0), upToDate: !!(inst && cmp === 0), downgrade: !!(inst && cmp < 0),
      revoked: !!rev, revokeReason: rev ? rev.reason : ''
    };
  });
  // 本地有、目录没有的(自装/已下架)也列出来, 否则用户会以为插件消失了
  const extra = (plugins || []).filter(function (p) { return !items.some(function (it) { return it.id === p.id; }); }).map(function (p) {
    const rev = isRevoked(revoked, p.id, String(p.version || ''));
    return { id: p.id, name: p.name, version: '', tier: 'local', summary: p.description || '', author: { id: '', name: p.author || '', contact: '' },
      permissions: p.permissions || {}, installed: true, installedVersion: String(p.version || ''), installedApproved: !!p.approved, enabled: !!p.enabled,
      updateAvailable: false, upToDate: false, downgrade: false, local: true, revoked: !!rev, revokeReason: rev ? rev.reason : '' };
  });
  return out.concat(extra);
}
// 下载 + 校验哈希并落盘到临时文件(返回路径给 manager.importZip)
async function downloadVerified(item, timeoutMs) {
  const tmp = path.join(os.tmpdir(), 'vrcb-market-' + item.id + '-' + item.version + '.zip');
  let buf = null;
  try {
    const r = await fetch(item.url + (item.url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { signal: AbortSignal.timeout(timeoutMs || 60000) });
    if (!r.ok) return { ok: false, error: '下载失败: HTTP ' + r.status };
    buf = Buffer.from(await r.arrayBuffer());
  } catch (e) { return { ok: false, error: '下载失败: ' + e.message }; }
  if (buf.length > MAX_ZIP_BYTES) return { ok: false, error: '包超过 50MB 上限' };
  if (item.size && Math.abs(buf.length - item.size) > 1024) return { ok: false, error: '包大小与目录不符(目录 ' + item.size + ' / 实际 ' + buf.length + ')' };
  const got = sha256(buf);
  if (got !== item.sha256) return { ok: false, error: 'sha256 校验失败(目录 ' + item.sha256.slice(0, 12) + '… / 实际 ' + got.slice(0, 12) + '…) —— 已拒绝安装' };
  try { fs.writeFileSync(tmp, buf); } catch (e) { return { ok: false, error: '临时文件写入失败: ' + e.message }; }
  return { ok: true, file: tmp, sha256: got, bytes: buf.length };
}
function cleanup(file) { try { if (file) fs.unlinkSync(file); } catch (e) {} }
// 安装: 市场条目 → 下载 → 校验 → 交给 importZip(它负责解包防线与 id 白名单) → 记录来源分级
async function install(config, pluginManager, id, wantVersion) {
  if (inflight) return { ok: false, error: '另一个安装还在进行中, 请稍候' };
  inflight = true;
  try {
    const cat = await getCatalog(config, false);
    if (!cat.index) return { ok: false, error: '拿不到市场目录(检查网络或镜像设置)', problems: cat.problems };
    const item = cat.index.items.filter(function (x) { return x.id === id; })[0];
    if (!item) return { ok: false, error: '目录里没有这个插件: ' + id };
    if (wantVersion && String(wantVersion) !== item.version) return { ok: false, error: '目录里没有该版本(最新 ' + item.version + ')' };
    const rev = isRevoked(cat.revoke || [], item.id, item.version);
    if (rev) return { ok: false, error: '该插件已被吊销, 拒绝安装: ' + (rev.reason || '') };
    const dl = await downloadVerified(item, Number((config && config.market && config.market.timeoutMs) || 0) || 60000);
    if (!dl.ok) { cleanup(dl.file); return dl; }
    let r;
    try { r = pluginManager.importZip(dl.file); } finally { cleanup(dl.file); }
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || '导入失败' };
    if (!config.marketInstalled || typeof config.marketInstalled !== 'object') config.marketInstalled = {};
    config.marketInstalled[r.id] = { tier: item.tier, version: item.version, sha256: item.sha256, at: new Date().toISOString(), source: cat.source || '' };
    return { ok: true, id: r.id, version: item.version, tier: item.tier, sha256: item.sha256, installed: true };
  } finally { inflight = false; }
}
function tierOf(config, id, fallback) {
  const m = (config && config.marketInstalled) || {};
  return (m[id] && m[id].tier) || fallback || '';
}
module.exports = { getCatalog, mergeWithInstalled, install, downloadVerified, validateIndex, validateRevoke, isRevoked, tierOf, sha256File, DEF_INDEX, DEF_REVOKE, TIERS, MAX_ZIP_BYTES };

'use strict';
// AI 调用的结构性安全边界(2026-10-30, 用户拍板加入 1.4.x EA)
// 目标不是"词库防住", 而是: 模型/本地 AI 服务被攻破时, 也没有额外能力 ——
// 1) 只允许明确的端点(官方 https / 本机回环; 不跟随重定向; 拒绝私网/元数据地址);
// 2) 云端密钥只发给官方域名(不发给第三方/本地端点);
// 3) 响应有硬上限(防恶意端点超长响应打爆内存);
// 4) 输出只当数据(严格 JSON schema + 长度上限), 由调用方决定落点.
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024; // 1MB
const OFFICIAL_AI_HOSTS = ['api.deepseek.com'];

function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}
function isOfficialHost(host) {
  const h = String(host || '').toLowerCase();
  return OFFICIAL_AI_HOSTS.some(function (d) { return h === d || h.endsWith('.' + d); });
}
function isPrivateOrLinkLocal(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'metadata.google.internal') return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  const p = h.split('.').map(Number);
  if (p.some(function (n) { return !Number.isInteger(n) || n < 0 || n > 255; })) return true;
  if (p[0] === 10 || p[0] === 0) return true;
  if (p[0] === 127) return false; // 回环单独判断
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
  if (p[0] >= 224) return true;
  return false;
}
// 纯函数: 校验配置里的 apiBase. 返回 { ok, url, host, official, loopback, reason }
function validateApiBase(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return { ok: false, reason: '接口地址不是合法 URL' }; }
  if (u.username || u.password) return { ok: false, reason: '接口地址不允许包含用户名/密码' };
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: '接口地址只允许 http(s)' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loop = isLoopbackHost(host);
  const official = isOfficialHost(host);
  if (loop) {
    // 本机服务允许 http; 但仍然只允许回环地址, 不把"内网其他机器"当本地
    return { ok: true, url: u, host: host, official: false, loopback: true };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: '非本机 AI 接口必须使用 https(本机回环可用 http)' };
  if (/deepseek/i.test(host) && !official) return { ok: false, reason: '疑似仿冒官方 AI 域名' };
  if (isPrivateOrLinkLocal(host)) return { ok: false, reason: 'AI 接口不允许指向私网/链路本地/元数据地址' };
  return { ok: true, url: u, host: host, official: official, loopback: false };
}
// 密钥作用域: 只把云端密钥发给官方域名; 本地/第三方端点即使配置了密钥也不发送.
function shouldSendApiKey(baseInfo) {
  return !!(baseInfo && baseInfo.ok && baseInfo.official);
}
async function fetchTextLimited(url, options, maxBytes) {
  const limit = Number(maxBytes) || DEFAULT_MAX_RESPONSE_BYTES;
  const opt = Object.assign({}, options || {}, { redirect: 'error' });
  const r = await fetch(url, opt);
  if (!r.body || typeof r.body.getReader !== 'function') {
    const t = await r.text();
    if (Buffer.byteLength(t, 'utf8') > limit) { try { r.body && r.body.cancel && r.body.cancel(); } catch (e) {} throw new Error('AI 响应超过大小上限'); }
    return { ok: r.ok, status: r.status, text: t };
  }
  const reader = r.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      const chunk = step.value;
      total += chunk.byteLength;
      if (total > limit) {
        try { await reader.cancel(); } catch (e) {}
        throw new Error('AI 响应超过大小上限(' + limit + ' 字节)');
      }
      chunks.push(Buffer.from(chunk));
    }
  } finally {
    try { reader.releaseLock && reader.releaseLock(); } catch (e) {}
  }
  return { ok: r.ok, status: r.status, text: Buffer.concat(chunks).toString('utf8') };
}

function authHeaderFor(baseInfo, apiKey) {
  const h = {};
  if (apiKey && shouldSendApiKey(baseInfo)) h.Authorization = 'Bearer ' + apiKey;
  return h;
}
// 严格解析默认结构化输出: 只接受 {"translation": string}; 解析失败/字段缺失都不回退自由文本.
function parseTranslationJson(out) {
  const m = String(out == null ? '' : out).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 返回格式不合规(缺少 JSON)');
  let o;
  try { o = JSON.parse(m[0]); } catch (e) { throw new Error('AI 返回 JSON 解析失败'); }
  if (!o || typeof o.translation !== 'string') throw new Error('AI 返回格式不合规(缺少 translation 字段)');
  return o.translation.trim();
}
module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  OFFICIAL_AI_HOSTS,
  isLoopbackHost,
  isOfficialHost,
  isPrivateOrLinkLocal,
  validateApiBase,
  shouldSendApiKey,
  authHeaderFor,
  parseTranslationJson,
  fetchTextLimited
};

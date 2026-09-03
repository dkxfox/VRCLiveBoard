'use strict';
const fs = require('fs');
const path = require('path');

// 权限门禁 + 审计(契约式: 约束经插件 API 的调用; 不是系统沙箱)
// 2026-09-03 收紧(F-20260903-01): 契约之上叠加安全策略(networkPolicy / processPolicy / fs 沙盒)与硬拒名单;
// 策略默认档 = 宽松但审计可见(whitelist/consent/sandbox/self), 收紧档由一级密码经 /api/security 切换。
const audit = [];
const MAX_AUDIT = 200;
const SEC_DEFAULTS = { networkPolicy: 'whitelist', processPolicy: 'consent', fsWritePolicy: 'sandbox', fsReadPolicy: 'self', aiPolicy: 'allow' };
const ROOT = path.resolve(__dirname, '..', '..');

function auditLog(pluginId, action, target, allowed) {
  audit.unshift({ at: Date.now(), plugin: pluginId, action: action, target: target, allowed: !!allowed });
  if (audit.length > MAX_AUDIT) audit.pop();
  try {
    const dir = path.join(__dirname, '..', '..', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'plugin-audit.log'), JSON.stringify({ at: new Date().toISOString(), plugin: pluginId, action: action, target: target, allowed: !!allowed }) + '\n');
  } catch (e) {}
}
function hostAllowed(host, rules) {
  if (!Array.isArray(rules)) return false;
  for (const r of rules) {
    if (r === '*') return true;
    if (typeof r === 'string' && (host === r || host.endsWith('.' + r))) return true;
  }
  return false;
}
function pathAllowed(p, rules) {
  if (!Array.isArray(rules)) return false;
  const norm = String(p).replace(/\\/g, '/').toLowerCase();
  for (const r of rules) {
    if (r === '*') return true;
    const rn = String(r).replace(/\\/g, '/').toLowerCase();
    if (norm.startsWith(rn)) return true;
  }
  return false;
}
function isLoopback(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === '127.0.0.1' || h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}
function relToRoot(p) {
  try {
    const abs = path.resolve(String(p));
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/').toLowerCase();
    if (rel === '' || rel.startsWith('..')) return null; // 项目根本身或根之外
    return rel;
  } catch (e) { return null; }
}
function inside(p, dir) {
  if (!p || !dir) return false;
  try { const a = path.resolve(String(p)); return a === dir || a.startsWith(dir + path.sep); } catch (e) { return false; }
}
// 硬拒名单(不可被 manifest 声明绕过): 密钥与配置、母狗、源码、日志、产物
const WRITE_DENY = [/^config\.json$/, /\.bak$/i, /^dev-dongle\//, /^src\//, /^scripts\//, /^logs\//, /^dist\//];
const READ_DENY = [/^config\.json$/, /\.bak$/i, /^dev-dongle\//];

function check(manifest, action, target, opts) {
  const p = (manifest && manifest.permissions) || {};
  const pol = Object.assign({}, SEC_DEFAULTS, (opts && opts.policy) || {});
  const id = (manifest && manifest.id) || (opts && opts.id) || '?';
  const dir = (opts && opts.dir) ? path.resolve(opts.dir) : null;
  const dataDir = (opts && opts.dataDir) ? path.resolve(opts.dataDir) : null;
  let ok = false;
  switch (action) {
    case 'network': {
      let host = null;
      try { host = new URL(target).hostname; } catch (e) { host = null; }
      if (pol.networkPolicy === 'off') ok = false;
      else if (pol.networkPolicy === 'localOnly') ok = !!host && isLoopback(host);
      else ok = hostAllowed(host, p.network);
      break;
    }
    case 'fs.read': {
      if (pol.fsReadPolicy === 'deny') break;
      const rel = relToRoot(target);
      if (!rel) break;
      let hit = false;
      for (const re of READ_DENY) { if (re.test(rel)) { hit = true; break; } }
      if (hit) break;
      if (inside(target, dir) || inside(target, dataDir)) { ok = true; break; }
      if (pol.fsReadPolicy === 'declared') ok = pathAllowed(target, p.filesystem && p.filesystem.read);
      break;
    }
    case 'fs.write': {
      if (pol.fsWritePolicy === 'deny') break;
      const rel = relToRoot(target);
      if (!rel) break;
      let hit = false;
      for (const re of WRITE_DENY) { if (re.test(rel)) { hit = true; break; } }
      if (hit) break;
      if (inside(target, dir) || inside(target, dataDir)) { ok = true; break; }
      if (pol.fsWritePolicy === 'declared') ok = pathAllowed(target, p.filesystem && p.filesystem.write);
      break;
    }
    case 'process':
      ok = pol.processPolicy === 'deny' ? false : !!p.process;
      break;
    default: ok = false;
  }
  auditLog(id, action, target, ok);
  return ok;
}
function requireAudit(pluginId, moduleName, allowed) {
  auditLog(pluginId, 'require:' + moduleName, '', !!allowed);
}
function auditEvent(pluginId, action, allowed) {
  auditLog(pluginId, action, '', !!allowed);
}
module.exports = { check, audit: function () { return audit.slice(); }, requireAudit, auditEvent, SEC_DEFAULTS, isLoopback };

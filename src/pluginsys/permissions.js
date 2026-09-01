'use strict';
const fs = require('fs');
const path = require('path');

// 权限门禁 + 审计(契约式: 约束经插件 API 的调用; 不是系统沙箱)
const audit = [];
const MAX_AUDIT = 200;
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
function check(manifest, action, target) {
  const p = (manifest && manifest.permissions) || {};
  let ok = false;
  switch (action) {
    case 'network':
      try { ok = hostAllowed(new URL(target).hostname, p.network); } catch (e) { ok = false; }
      break;
    case 'fs.read': ok = pathAllowed(target, p.filesystem && p.filesystem.read); break;
    case 'fs.write': ok = pathAllowed(target, p.filesystem && p.filesystem.write); break;
    case 'process': ok = !!p.process; break;
    default: ok = false;
  }
  auditLog(manifest && manifest.id, action, target, ok);
  return ok;
}
module.exports = { check, audit: function () { return audit.slice(); } };

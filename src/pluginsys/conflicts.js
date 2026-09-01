'use strict';
// 冲突监测: 声明制(安装/启用时) + 运行时兜底
function analyze(entries) {
  const report = {};
  const ids = entries.map(function (e) { return e.id; });
  for (const e of entries) {
    const issues = [];
    const m = e.manifest || {};
    if (m.api && typeof m.api === 'string' && m.api.split('.')[0] !== '2') {
      issues.push({ with: 'API', reason: '插件要求 API ' + m.api + ',当前运行时为 2.x' });
    }
    for (const dep in (m.dependencies || {})) {
      const need = m.dependencies[dep];
      const other = entries.find(function (x) { return x.id === dep; });
      if (!other) issues.push({ with: dep, reason: '缺少依赖插件 ' + dep + '(要求 ' + need + ')' });
      else if (need && need !== '*' && String(need) !== String(other.manifest.version)) issues.push({ with: dep, reason: '依赖版本不符: 要求 ' + need + ',实际 ' + other.manifest.version });
    }
    for (const c of (m.conflicts || [])) {
      if (ids.indexOf(c) >= 0) issues.push({ with: c, reason: 'manifest 声明与 ' + c + ' 互斥' });
    }
    for (const x of (m.exclusive || [])) {
      for (const o of entries) {
        if (o.id === e.id) continue;
        if ((o.manifest.exclusive || []).indexOf(x) >= 0) {
          issues.push({ with: o.id, reason: '独占资源冲突: ' + x });
        }
      }
    }
    const dup = entries.filter(function (x) { return x.id === e.id; });
    if (dup.length > 1) issues.push({ with: '自身', reason: '存在同 ID 的重复插件' });
    if (e.enabled) {
      const samePrio = [];
      for (const o of entries) {
        if (o.id === e.id || !o.enabled) continue;
        const a = e.runtimeSources || [];
        const b = o.runtimeSources || [];
        for (const sa of a) { for (const sb of b) { if (sa.priority === sb.priority) samePrio.push(o.id + '(' + sb.id + ')'); } }
      }
      if (samePrio.length) issues.push({ with: [...new Set(samePrio)].join(', '), reason: '聊天框显示优先级相同,内容会互相抢占' });
      if (e.runtimeErrors && e.runtimeErrors.length) {
        for (const er of e.runtimeErrors.slice(0, 3)) issues.push({ with: '运行时', reason: er });
      }
    }
    report[e.id] = issues;
  }
  return report;
}
module.exports = { analyze };

'use strict';
function createSource(config) {
  const s = { id: 'pages', enabled: config.enabled !== false, priority: config.priority || 5, intervalMs: 1000, lastError: null, rotationMs: config.rotationMs || 8000, idx: 0, lastRotateAt: 0, pageCount: 0, _rendered: undefined };
  s.getText = function (ctx) {
    const pages = (config.pages && config.pages.length) ? config.pages : [{ text: 'VRCLiveBoard' }];
    const rotMs = config.rotationMs || 8000;
    const now = Date.now();
    if (s._rendered === undefined || now - s.lastRotateAt >= rotMs) {
      s.lastRotateAt = now;
      const d = ctx.now;
      const p = function (n) { return String(n).padStart(2, '0'); };
      ctx.vars.time = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      ctx.vars.date = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      const idx = s.idx % pages.length;
      s._rendered = pages[idx].text;
      s.idx = (idx + 1) % pages.length;
    }
    return s._rendered;
  };
  return s;
}
module.exports = { createSource };

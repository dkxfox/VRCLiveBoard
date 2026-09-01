'use strict';
const fs = require('fs');
const path = require('path');

// 监听 LiveTranslate 转录文件: 取最新 *_translation.txt 的最后几行
function createSource(config, logger) {
  const s = { id: 'livetranslate', enabled: config.enabled !== false, priority: config.priority || 40, intervalMs: config.intervalMs || 1500, lastError: null };
  const dir = config.transcriptsDir || '';
  const maxAgeMs = config.maxAgeMs || 12000;
  const lines = config.lines || 2;
  let lastFile = null;
  let lastText = null;

  function pickNewest() {
    if (!dir) return null;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return null; }
    let best = null;
    for (const n of names) {
      if (!/^livetrans_.*_translation\.txt$/.test(n)) continue;
      const p = path.join(dir, n);
      try { const st = fs.statSync(p); if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs }; } catch (e) {}
    }
    return best;
  }
  function clean(line) {
    return line.replace(/^\[[0-9]{2}:[0-9]{2}:[0-9]{2}\]\s*/, '').trim();
  }
  s.getText = function (ctx) {
    try {
      const f = pickNewest();
      if (!f) return null;
      if (Date.now() - f.mtimeMs > maxAgeMs) return null;
      if (lastFile !== f.path) { lastFile = f.path; lastText = null; }
      const raw = fs.readFileSync(f.path, 'utf8');
      const arr = raw.split(/\r?\n/).filter(function (l) { const t = l.trim(); return t && t.charAt(0) !== '#'; });
      if (arr.length) lastText = arr.slice(-lines).map(clean).join('\n');
      return lastText;
    } catch (e) { s.lastError = String(e.message); return null; }
  };
  return s;
}
module.exports = { id: 'livetranslate', version: '0.1.0', createSource: createSource };

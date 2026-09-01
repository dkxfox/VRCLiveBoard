'use strict';
const { spawn, execFile } = require('child_process');
const path = require('path');
const { resolvePython } = require('../pyhelper');

function createSource(config, logger) {
  const s = { id: 'media', enabled: config.enabled !== false, priority: config.priority || 30, intervalMs: config.intervalMs || 2000, lastError: null, helperRunning: false, lastRaw: null };
  let latest = null;
  let latestAt = 0;
  let child = null;
  function startHelper() {
    const script = path.join(__dirname, '..', 'helpers', 'smtc.py');
    const py = resolvePython(path.join(__dirname, '..', '..'));
    if (!py) { s.lastError = '媒体功能需要 Python(可在控制台"环境检测"一键安装便携版)'; return; }
    try {
      child = spawn(py, ['-u', script], { windowsHide: true, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
      s.helperRunning = true;
      let buf = '';
      child.stdout.on('data', function (d) {
        buf += d.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
          if (!line) continue;
          if (line.startsWith('{')) { s.lastRaw = line; }
          try { const o = JSON.parse(line); latest = (o && o.title) ? o : null; latestAt = Date.now(); s.lastError = null; } catch (e) { /* 非 JSON 行, 忽略 */ }
        }
      });
      child.on('error', function (e) { s.helperRunning = false; s.lastError = 'SMTC 助手启动失败(需要 Python 与 winsdk): ' + e.message; });
      child.on('exit', function () { child = null; s.helperRunning = false; if (s.enabled) setTimeout(startHelper, 5000); });
    } catch (e) { s.lastError = String(e.message); }
  }
  startHelper();
  s.restart = function () { if (child) { try { child.kill(); } catch (e) {} } child = null; s.helperRunning = false; s.lastError = null; startHelper(); };
  s.getText = async function (ctx) {
    if (!latest || Date.now() - latestAt > 6000) return null;
    ctx.vars.song = latest.title; ctx.vars.artist = latest.artist || ''; ctx.vars.album = latest.album || '';
    return config.template;
  };
  s.stop = function () { s.enabled = false; if (child) { try { child.kill(); } catch (e) {} } };
  return s;
}
module.exports = { createSource };

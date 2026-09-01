'use strict';
const si = require('systeminformation');
const { execFile } = require('child_process');

function smi() {
  return new Promise(function (resolve) {
    let done = false;
    const finish = function (v) { if (!done) { done = true; resolve(v); } };
    try {
      execFile('nvidia-smi', ['--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true }, function (err, stdout) {
        if (err || !stdout) return finish(null);
        const line = String(stdout).trim().split(/\r?\n/)[0];
        const p = line.split(',').map(function (s) { return s.trim(); });
        if (p.length < 4) return finish(null);
        finish({ temp: Math.round(Number(p[0])), util: Math.round(Number(p[1])), memUsedMb: Math.round(Number(p[2])), memTotalMb: Math.round(Number(p[3])) });
      });
    } catch (e) { finish(null); }
    setTimeout(function () { finish(null); }, 5000);
  });
}
function fmtK(v) {
  if (!v && v !== 0) return '--';
  const k = Number(v) / 1024;
  return k >= 1024 ? (k / 1024).toFixed(1) + 'M' : k.toFixed(0) + 'K';
}
async function collect() {
  const v = {};
  try { const c = await si.currentLoad(); v.cpu_util = Math.round(c.currentLoad); } catch (e) { v.cpu_util = '--'; }
  try { const t = await si.cpuTemperature(); v.cpu_temp = (t && (t.main || t.max)) ? Math.round(t.main || t.max) : '--'; } catch (e) { v.cpu_temp = '--'; }
  try { const m = await si.mem(); v.mem_used = (m.used / 1073741824).toFixed(1); v.mem_total = (m.total / 1073741824).toFixed(1); } catch (e) { v.mem_used = '--'; v.mem_total = '--'; }
  try { const n = await si.networkStats(); v.net_down = fmtK(n[0] && n[0].rx_sec); v.net_up = fmtK(n[0] && n[0].tx_sec); } catch (e) { v.net_down = '--'; v.net_up = '--'; }
  let g = null;
  try { g = await smi(); } catch (e) { g = null; }
  if (g) { v.gpu_temp = g.temp; v.gpu_util = g.util; v.gpu_mem = (g.memUsedMb / 1024).toFixed(1) + '/' + (g.memTotalMb / 1024).toFixed(0) + 'G'; }
  else { v.gpu_temp = '--'; v.gpu_util = '--'; v.gpu_mem = '--'; }
  return v;
}
function createSource(config) {
  const s = { id: 'hardware', enabled: config.enabled !== false, priority: config.priority || 10, intervalMs: config.intervalMs || 5000, lastError: null };
  s.getText = async function (ctx) {
    const v = await collect();
    Object.assign(ctx.vars, v);
    return config.template;
  };
  return s;
}
module.exports = { createSource, collect };

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
// 采集分档 + 结果共用(M-20260927-07 第五轮): 实测 si.networkStats() 单次 0.8~1.4 秒 PowerShell 工作, 并且在
// **主进程事件循环**上砸出 ~140ms 的阻塞 —— 它原本每 5 秒跑一次, 正好与"彩蛋每 5 秒一卡"同轴。
// 现在: 轻量项(CPU/内存/显卡, 合计约 0.3 秒且不阻塞事件循环)保持 5 秒; 慢档(网络计数/CPU 温度)降到 30 秒,
// 中间沿用上次的值; 且 4 秒内两个调用方(常驻变量刷新 + 硬件源)共用同一次采集, 避免一个周期采两遍。
const TTL_SLOW_MS = 30000;
const cache = { at: 0, slowAt: 0, v: {} };
function mark(name, t0) { try { require('../diagperf').mark({ at: t0, name: name, ms: Date.now() - t0 }); } catch (e) {} }

async function collect(opts) {
  const now = Date.now();
  const shareMs = (opts && typeof opts.maxAgeMs === 'number') ? opts.maxAgeMs : 0;
  if (cache.at && now - cache.at < shareMs) return Object.assign({}, cache.v);
  const v = Object.assign({}, cache.v);
  const slowDue = !cache.slowAt || (now - cache.slowAt) >= TTL_SLOW_MS;
  let t0 = Date.now();
  try { const c = await si.currentLoad(); v.cpu_util = Math.round(c.currentLoad); } catch (e) { v.cpu_util = '--'; }
  try { const m = await si.mem(); v.mem_used = (m.used / 1073741824).toFixed(1); v.mem_total = (m.total / 1073741824).toFixed(1); } catch (e) { v.mem_used = '--'; v.mem_total = '--'; }
  let g = null;
  try { g = await smi(); } catch (e) { g = null; }
  if (g) { v.gpu_temp = g.temp; v.gpu_util = g.util; v.gpu_mem = (g.memUsedMb / 1024).toFixed(1) + '/' + (g.memTotalMb / 1024).toFixed(0) + 'G'; }
  else { v.gpu_temp = '--'; v.gpu_util = '--'; v.gpu_mem = '--'; }
  mark('硬件采集:轻量档(CPU/内存/显卡)', t0);
  if (slowDue) {
    t0 = Date.now();
    try { const t = await si.cpuTemperature(); v.cpu_temp = (t && (t.main || t.max)) ? Math.round(t.main || t.max) : '--'; } catch (e) { v.cpu_temp = '--'; }
    try { const n = await si.networkStats(); v.net_down = fmtK(n[0] && n[0].rx_sec); v.net_up = fmtK(n[0] && n[0].tx_sec); } catch (e) { v.net_down = '--'; v.net_up = '--'; }
    mark('硬件采集:慢档(网络计数/CPU 温度)', t0);
    cache.slowAt = Date.now();
  }
  cache.at = Date.now(); cache.v = v;
  return Object.assign({}, v);
}
function createSource(config) {
  const s = { id: 'hardware', enabled: config.enabled !== false, priority: config.priority || 10, intervalMs: config.intervalMs || 5000, lastError: null };
  s.getText = async function (ctx) {
    const v = await collect({ maxAgeMs: 4000 });   // 与常驻变量刷新共用同一次采集(见 collect 注释)
    Object.assign(ctx.vars, v);
    return config.template;
  };
  return s;
}
module.exports = { createSource, collect };

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// 解析 VRChat 的 output_log 获取真实 OSC 状态(2026 版 OSCQuery 走随机端口,不能再靠 9000 探测)
function vrcDir() {
  return path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat');
}
function newestLog(dir) {
  let best = null;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return null; }
  for (const n of names) {
    if (!/^output_log_.*\.txt$/.test(n)) continue;
    const p = path.join(dir, n);
    try {
      const st = fs.statSync(p);
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
    } catch (e) {}
  }
  return best;
}
// 读盘缓存(M-20260927-07 第五轮): 这个函数被两个 5 秒节拍各调一次(主进程的 vrcOn 轮询 + 页面 /api/status),
// 每次都是 readdirSync + statSync + 整文件 readFileSync + 全文正则。文件没变(mtime 相同)且距上次不到 2 秒时直接回上次结果,
// 把 5 秒周期里的重复读盘去掉(单次不大, 但它在卡顿节拍上白白占着主线程)。
let cache = { key: null, at: 0, value: null };
function getVrcStatus() {
  const dir = vrcDir();
  const log = newestLog(dir);
  if (!log) return { running: false, oscEnabled: null, oscPort: null, oscqueryPort: null, fresh: false };
  const key = log.path + '|' + log.mtimeMs;
  const now = Date.now();
  if (cache.key === key && cache.value && now - cache.at < 2000) return cache.value;
  const fresh = now - log.mtimeMs < 5 * 60 * 1000;
  let oscEnabled = null;
  let oscPort = null;
  let oscqueryPort = null;
  try {
    const text = fs.readFileSync(log.path, 'utf8');
    let m;
    const reOsc = /OSC[:\s]*enabled[:\s=]*(true|false)/gi;
    while ((m = reOsc.exec(text)) !== null) oscEnabled = String(m[1]).toLowerCase() === 'true';
    const reP = /of type OSC on\s+(\d+)/gi;
    while ((m = reP.exec(text)) !== null) oscPort = Number(m[1]);
    const reQ = /of type OSCQuery on\s+(\d+)/gi;
    while ((m = reQ.exec(text)) !== null) oscqueryPort = Number(m[1]);
  } catch (e) {}
  const res = { running: fresh, oscEnabled: oscEnabled, oscPort: oscPort, oscqueryPort: oscqueryPort, fresh: fresh };
  cache = { key: key, at: now, value: res };
  return res;
}
module.exports = { getVrcStatus };

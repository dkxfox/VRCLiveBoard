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
function getVrcStatus() {
  const dir = vrcDir();
  const log = newestLog(dir);
  if (!log) return { running: false, oscEnabled: null, oscPort: null, oscqueryPort: null, fresh: false };
  const fresh = Date.now() - log.mtimeMs < 5 * 60 * 1000;
  let oscEnabled = null;
  let oscPort = null;
  let oscqueryPort = null;
  try {
    const text = fs.readFileSync(log.path, 'utf8');
    let m;
    const reOsc = /OSC enabled:\s*(True|False)/gi;
    while ((m = reOsc.exec(text)) !== null) oscEnabled = m[1] === 'True';
    const reP = /of type OSC on\s+(\d+)/gi;
    while ((m = reP.exec(text)) !== null) oscPort = Number(m[1]);
    const reQ = /of type OSCQuery on\s+(\d+)/gi;
    while ((m = reQ.exec(text)) !== null) oscqueryPort = Number(m[1]);
  } catch (e) {}
  return { running: fresh, oscEnabled: oscEnabled, oscPort: oscPort, oscqueryPort: oscqueryPort, fresh: fresh };
}
module.exports = { getVrcStatus };

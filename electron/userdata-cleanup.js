'use strict';
// Electron 用户数据目录缓存清理(M-20260903-01): 运行时 Chromium 缓存会持续增长, housekeeping 管不到 %APPDATA%
// 策略: GPU/Shader 类缓存(安全重建, 只影响下次启动几百毫秒)启动即清; HTTP/代码缓存只清超过 maxAge 的
const fs = require('fs');
const path = require('path');
const SAFE_DELETE = ['GPUCache', 'ShaderCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'DawnCache'];
const AGE_DELETE = ['Cache', 'Code Cache', 'blob_storage'];
function cleanupUserData(userDataDir, nowMs, maxAgeMs) {
  const now = nowMs || Date.now();
  const maxAge = maxAgeMs || 7 * 86400 * 1000;
  let removed = 0;
  for (const name of SAFE_DELETE) {
    try { if (fs.statSync(path.join(userDataDir, name)).isDirectory()) { fs.rmSync(path.join(userDataDir, name), { recursive: true, force: true }); removed++; } } catch (e) {}
  }
  for (const name of AGE_DELETE) {
    try {
      const p = path.join(userDataDir, name);
      const st = fs.statSync(p);
      if (st.isDirectory() && now - st.mtimeMs > maxAge) { fs.rmSync(p, { recursive: true, force: true }); removed++; }
    } catch (e) {}
  }
  return removed;
}
module.exports = { cleanupUserData };

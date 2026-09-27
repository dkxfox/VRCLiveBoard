'use strict';
const path = require('path');
const fs = require('fs');
const { getCaptureHost } = require('../src/capturehost');

// OCR 区域识别兜底: 截图指定屏幕区域 → tesseract.js(离线中文)
//
// 2026-09-27 修(M-20260927-07 的**根因**): 这里原来**每 3 秒 spawn 一次 powershell.exe** 去截图 ——
//   目标窗口不在(没开游戏)时也照 spawn, 单次 0.3~1.5 秒 CPU; 于是整机每 3 秒一次尖峰, 正在播放的启动彩蛋视频
//   (尤其桌面壳里, 主进程同时还要喂 HTTP 视频流)就表现为"每 3 秒卡一下、声音一起停、恢复后跳帧"。
//   两处改动:
//   ① 改用**常驻截图助手**(src/capturehost.js, 与截图翻译同一条链路): 正常情况下不再每次起 PowerShell;
//   ② 连续找不到窗口/区域时**退避**(3 次失败后实际间隔 ×10, 一旦成功立刻恢复) —— 没人开游戏时几乎零开销。
//   契约字段 intervalMs 仍是配置值(composer 按它轮询), 退避在 getText 内部用"下次允许时间"实现。
function createSource(config, logger) {
  const s = { id: 'ocrregion', enabled: config.enabled === true, priority: config.priority || 45, intervalMs: config.intervalMs || 3000, lastError: null };
  const region = config.region || { x: 394, y: 908, w: 968, h: 107 };
  const maxLines = config.lines || 2;
  const BASE_MS = Math.max(1000, Number(s.intervalMs) || 3000);
  const BACKOFF_AFTER = 3;        // 连续失败几次后开始退避
  const BACKOFF_MULT = 10;        // 退避倍数(3s -> 30s)
  let workerPromise = null;
  let lastText = null;
  let failStreak = 0;
  let nextAllowedAt = 0;

  function findLangPath() {
    const root = path.join(__dirname, '..', 'node_modules', '@tesseract.js-data', 'chi_sim');
    const candidates = [root, path.join(root, '4.0.0_best_int')];
    for (const c of candidates) {
      try { if (fs.statSync(path.join(c, 'chi_sim.traineddata.gz')).isFile()) return c; } catch (e) {}
    }
    return root;
  }
  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async function () {
        const { createWorker } = require('tesseract.js');
        const dataRoot = findLangPath();
        const w = await createWorker('chi_sim', 1, { langPath: dataRoot, cachePath: path.join(__dirname, '..', '.ocr-cache') });
        return w;
      })();
    }
    return workerPromise;
  }
  // 截图: 走常驻助手(内部自带"常驻起不来就回退一次性 PowerShell"的兜底, 见 capturehost.js)
  function capture(pngPath) {
    const opt = { mode: 'window', out: pngPath };
    if (region.title) opt.title = String(region.title);
    else { opt.x = Number(region.x) || 0; opt.y = Number(region.y) || 0; opt.w = Number(region.w) || 0; opt.h = Number(region.h) || 0; }
    return getCaptureHost(logger).capture(opt, 8000).then(function (reply) {
      const t = String(reply || '').trim();
      if (t.indexOf('OK') === 0) { failStreak = 0; nextAllowedAt = 0; return true; }
      failStreak++;
      if (t.indexOf('NO-WINDOW') >= 0) { s.lastError = 'NO-WINDOW'; return false; }
      if (t.indexOf('NO-REGION') >= 0) { s.lastError = 'NO-REGION'; return false; }
      s.lastError = t.slice(0, 120) || 'CAPTURE-FAIL';
      return false;
    }).catch(function (e) {
      failStreak++;
      s.lastError = String(e.message || e).slice(0, 120);
      return false;
    });
  }
  s.getText = async function (ctx) {
    const now = Date.now();
    if (now < nextAllowedAt) return null;                  // 退避窗口内: 什么都不做(不 spawn 进程、不做 OCR)
    const pngPath = path.join(require('os').tmpdir(), 'vrcb-ocrregion-' + process.pid + '-' + Date.now() + '.png');
    try {
      // 独立临时文件(M-20260911-38): 以前和主流程共用 .ocr-tmp.png, 同时跑会互相覆盖(tesseract 是异步读文件的)
      const ok = await capture(pngPath);
      if (!ok) {
        if (failStreak >= BACKOFF_AFTER) nextAllowedAt = now + BASE_MS * (BACKOFF_MULT - 1);
        try { fs.unlinkSync(pngPath); } catch (e) {}
        return null;
      }
      const w = await getWorker();
      const r = await w.recognize(pngPath);
      try { fs.unlinkSync(pngPath); } catch (e) {}
      const text = String(r.data.text || '').trim();
      if (!text) return null;
      const arr = text.split(/\r?\n/).map(function (t) { return t.trim(); }).filter(Boolean);
      if (!arr.length) return null;
      lastText = arr.slice(-maxLines).join('\n');
      s.lastError = null;
      return lastText;
    } catch (e) {
      if (failStreak >= BACKOFF_AFTER) nextAllowedAt = now + BASE_MS * (BACKOFF_MULT - 1);
      s.lastError = String(e.message);
      try { fs.unlinkSync(pngPath); } catch (e2) {}
      return null;
    }
  };
  return s;
}
module.exports = { id: 'ocrregion', version: '0.1.1', createSource: createSource };

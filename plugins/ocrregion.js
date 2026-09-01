'use strict';
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// OCR 区域识别兜底: PowerShell 截图指定屏幕区域 → tesseract.js(离线中文)
function createSource(config, logger) {
  const s = { id: 'ocrregion', enabled: config.enabled === true, priority: config.priority || 45, intervalMs: config.intervalMs || 3000, lastError: null };
  const region = config.region || { x: 394, y: 908, w: 968, h: 107 };
  const maxLines = config.lines || 2;
  let workerPromise = null;
  let lastText = null;

  function findLangPath() {
    const root = path.join(__dirname, '..', '..', 'node_modules', '@tesseract.js-data', 'chi_sim');
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
        const w = await createWorker('chi_sim', 1, { langPath: dataRoot, cachePath: path.join(__dirname, '..', '..', '.ocr-cache') });
        return w;
      })();
    }
    return workerPromise;
  }
  function capture(pngPath) {
    return new Promise(function (resolve, reject) {
      const script = path.join(__dirname, '..', 'src', 'helpers', 'screen_capture.ps1');
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-out', pngPath];
      if (region.title) { args.push('-title', String(region.title)); }
      else { args.push('-x', String(region.x || 0), '-y', String(region.y || 0), '-w', String(region.w || 0), '-h', String(region.h || 0)); }
      execFile('powershell.exe', args, { timeout: 8000, windowsHide: true }, function (err, stdout) {
        if (err) return reject(err);
        if (String(stdout || '').indexOf('NO-WINDOW') >= 0) { s.lastError = 'NO-WINDOW'; return resolve(); }
        resolve();
      });
    });
  }
  s.getText = async function (ctx) {
    try {
      const pngPath = path.join(__dirname, '..', '..', '.ocr-tmp.png');
      await capture(pngPath);
      if (s.lastError === 'NO-WINDOW') return null;
      const w = await getWorker();
      const r = await w.recognize(pngPath);
      const text = String(r.data.text || '').trim();
      if (!text) return null;
      const arr = text.split(/\r?\n/).map(function (t) { return t.trim(); }).filter(Boolean);
      if (!arr.length) return null;
      lastText = arr.slice(-maxLines).join('\n');
      s.lastError = null;
      return lastText;
    } catch (e) { s.lastError = String(e.message); return null; }
  };
  return s;
}
module.exports = { id: 'ocrregion', version: '0.1.0', createSource: createSource };

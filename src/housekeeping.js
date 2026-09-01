'use strict';
const fs = require('fs');
const path = require('path');

// 垃圾数据管理: 启动时执行, 防止长期运行后硬盘被占满
function runHousekeeping(config, logger) {
  const root = path.join(__dirname, '..');
  try {
    // 1) 日志截断: 超过 1MB 只保留尾部 100KB
    const logsDir = path.join(root, 'logs');
    for (const f of ['boot.log', 'app.log', 'autostart.log']) {
      const p = path.join(logsDir, f);
      try {
        const st = fs.statSync(p);
        if (st.size > 1024 * 1024) {
          const fd = fs.openSync(p, 'r');
          const keep = 100 * 1024;
          const buf = Buffer.alloc(keep);
          fs.readSync(fd, buf, 0, keep, st.size - keep);
          fs.closeSync(fd);
          fs.writeFileSync(p, buf);
          logger.info('日志已截断: ' + f);
        }
      } catch (e) {}
    }
    // 2) OCR 缓存: 删除 30 天前的文件
    const cacheDir = path.join(root, '.ocr-cache');
    try {
      const now = Date.now();
      for (const f of fs.readdirSync(cacheDir)) {
        const p = path.join(cacheDir, f);
        try { if (now - fs.statSync(p).mtimeMs > 30 * 86400 * 1000) { fs.unlinkSync(p); logger.info('清理过期 OCR 缓存: ' + f); } } catch (e) {}
      }
    } catch (e) {}
    // 3) Electron 缓存: 只保留当前版本的 zip
    const ec = path.join(root, '.electron-cache');
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      const ver = (pkg.dependencies && pkg.dependencies.electron) || '';
      for (const f of fs.readdirSync(ec)) {
        if (!f.startsWith('electron-v') || !f.endsWith('.zip')) continue;
        if (ver && f.indexOf('electron-v' + ver) !== 0) { try { fs.unlinkSync(path.join(ec, f)); logger.info('清理旧 Electron 缓存: ' + f); } catch (e) {} }
      }
    } catch (e) {}
  } catch (e) { logger.warn('日常清理执行失败: ' + e.message); }
}
module.exports = { runHousekeeping };

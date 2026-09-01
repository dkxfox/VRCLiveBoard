'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function startupDir() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}
function isEnabled() {
  try { return fs.existsSync(path.join(startupDir(), 'VRCLiveBoard.vbs')); } catch (e) { return false; }
}
function setAutostart(on, projectDir, logger) {
  const dir = startupDir();
  try {
    if (!on) {
      try { fs.unlinkSync(path.join(dir, 'VRCLiveBoard.vbs')); } catch (e) {}
      try { fs.unlinkSync(path.join(projectDir, 'autostart.bat')); } catch (e) {}
      logger.info('开机自启已关闭');
      return { ok: true, enabled: false };
    }
    fs.mkdirSync(dir, { recursive: true });
    const batPath = path.join(projectDir, 'autostart.bat');
    const bat = '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\nif not exist logs mkdir logs\r\nset VRCLIVEBOARD_AUTOSTART=1\r\nnode scripts\\ensure-deps.js >> logs\\autostart.log 2>&1\r\nnode src\\main.js >> logs\\app.log 2>&1\r\n';
    fs.writeFileSync(batPath, bat, 'utf8');
    try {
      const vbsPath = path.join(dir, 'VRCLiveBoard.vbs');
      const vbs = 'Set ws = CreateObject("Wscript.Shell")\r\nws.Run """' + batPath + '""", 0, False\r\n';
      fs.writeFileSync(vbsPath, vbs, 'utf8');
      logger.info('开机自启已开启: ' + vbsPath);
      return { ok: true, enabled: true };
    } catch (e2) {
      try { fs.unlinkSync(batPath); } catch (e3) {}
      throw e2;
    }
  } catch (e) {
    logger.error('自启设置失败: ' + e.message);
    return { ok: false, error: e.message };
  }
}
module.exports = { setAutostart, isEnabled };

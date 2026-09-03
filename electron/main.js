'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { setConsoleVisible } = require(path.join(__dirname, '..', 'src', 'consolewin'));
const { cleanupUserData } = require('./userdata-cleanup');

function applyConsoleSetting() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8');
    const cfg = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    if (cfg.desktop && cfg.desktop.showConsole === false) setConsoleVisible(false);
  } catch (e) { /* 配置读取失败保持默认(显示) */ }
}

// 桌面版: 核心服务直接内嵌在本进程运行(单进程 = 退出即完整关闭, 无残留)
// 打包分发时用户不需要安装 Node/npm。

const CONSOLE_URL = 'http://127.0.0.1:19190';
app.setAppUserModelId('com.vrcliveboard.app');
// 测试/多实例场景: 允许用环境变量覆盖 userData 目录(单实例锁随之独立)
if (process.env.VRCB_USER_DATA) { try { app.setPath('userData', process.env.VRCB_USER_DATA); } catch (e) {} }
let win = null;
let tray = null;
let quitting = false;

function loadIcon() {
  try {
    // 任务栏优先认 ICO(Windows 对开发模式 electron.exe 的任务栏图标只认 ico/窗口 setIcon)
    const icoPath = path.join(__dirname, 'app.ico');
    const ico = nativeImage.createFromPath(icoPath);
    if (!ico.isEmpty()) return ico;
  } catch (e) {}
  try {
    const p = path.join(__dirname, '..', '软件图标.png');
    const img = nativeImage.createFromPath(p);
    if (!img.isEmpty()) return img;
  } catch (e) {}
  // 兜底: 生成 16x16 蓝色方块
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      if (border) { buf[i] = 59; buf[i + 1] = 130; buf[i + 2] = 246; }
      else { buf[i] = 16; buf[i + 1] = 20; buf[i + 2] = 26; }
      buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
function createWindow() {
  const icon = loadIcon();
  // show:false + ready-to-show: 首帧即带正确图标再上任务栏, 不给 Windows 缓存默认图标的机会(M-20260903-03)
  win = new BrowserWindow({ width: 940, height: 760, minWidth: 600, minHeight: 460, autoHideMenuBar: true, backgroundColor: '#10141a', title: 'VRCLiveBoard', icon: icon, show: false });
  try { win.setIcon(icon); } catch (e) { /* 旧版本 Electron 无此方法则忽略 */ }
  win.once('ready-to-show', function () { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
  // 兜底: 页面加载异常时也要显示窗口(3 秒后仍未显示则强制)
  setTimeout(function () { try { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); } catch (e) {} }, 3000);
  win.loadURL(CONSOLE_URL);
  win.webContents.setWindowOpenHandler(function (details) { shell.openExternal(details.url); return { action: 'deny' }; });
  // Ctrl+R / Ctrl+Shift+R 刷新界面(桌面版没有地址栏和 F5)
  win.webContents.on('before-input-event', function (event, input) {
    if (input.type === 'keyDown' && input.control && String(input.key).toLowerCase() === 'r') {
      event.preventDefault();
      win.webContents.reloadIgnoringCache();
    }
  });
  win.on('close', function (e) { if (!quitting) { e.preventDefault(); win.hide(); } });
}
function startCore() {
  // 内嵌模式: 核心(网页服务/OSC/数据源)跑在本进程里
  process.env.VRCB_EMBEDDED = '1';
  try {
    require(path.join(__dirname, '..', 'src', 'main.js'));
  } catch (e) {
    console.error('[VRCLiveBoard] 核心启动失败: ' + (e && e.stack || e));
  }
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', function () { if (win) { win.show(); win.focus(); } });
  app.on('before-quit', function () { quitting = true; });
  app.whenReady().then(function () {
    applyConsoleSetting();
    try {
      const n = cleanupUserData(app.getPath('userData')); // M-20260903-01: 清运行时 Chromium 缓存
      if (n > 0) console.log('[清理] 用户数据缓存已清理 ' + n + ' 项');
      require('electron').session.defaultSession.clearCache().catch(function () {});
    } catch (e) { /* 非致命 */ }
    startCore();
    if (process.env.VRCB_HEADLESS_TEST === '1') { console.log('SHELL-OK'); setTimeout(function () { app.quit(); }, 500); return; }
    createWindow();
    try {
      tray = new Tray(loadIcon());
      tray.setToolTip('VRCLiveBoard');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示控制台', click: function () { win.show(); win.focus(); } },
        { label: '在浏览器打开', click: function () { shell.openExternal(CONSOLE_URL); } },
        { type: 'separator' },
        { label: '退出(完全关闭)', click: function () { app.quit(); } }
      ]));
      tray.on('double-click', function () { win.show(); win.focus(); });
    } catch (e) { /* 无托盘环境忽略 */ }
  });
  app.on('window-all-closed', function () { /* 常驻托盘, 右键托盘退出 */ });
}

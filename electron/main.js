'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { setConsoleVisible } = require(path.join(__dirname, '..', 'src', 'consolewin'));
const { cleanupUserData } = require('./userdata-cleanup');
// 允许自动播放(含声音): 特殊彩蛋启动视频需要无手势自动播
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function applyConsoleSetting() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8');
    const cfg = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    if (cfg.desktop && cfg.desktop.showConsole === false) setConsoleVisible(false);
  } catch (e) { /* 配置读取失败保持默认(显示) */ }
}

// 桌面版: 核心服务直接内嵌在本进程运行(单进程 = 退出即完整关闭, 无残留)
// 打包分发时用户不需要安装 Node/npm。

// 控制台地址必须用**实际**端口: 19190 被占时核心会自动回退(src/web/server.js 的 start() 最多 +10),
// 写死 URL 会让窗口指向一个不存在的端口 → 白屏且无任何提示(M-20260911-08)
function consoleUrl() { return 'http://127.0.0.1:' + (process.env.VRCB_CONSOLE_PORT || 19190); }
// 等核心把真实端口报出来(最多 15 秒), 到点还没有就按默认端口试
function whenCoreReady(cb) {
  if (process.env.VRCB_CONSOLE_PORT) return cb();
  let done = false;
  const fire = function () { if (done) return; done = true; cb(); };
  process.once('vrcb:console-ready', fire);
  setTimeout(fire, 15000);
}
function consoleErrorPage(detail) {
  const css = 'background:#10141a;color:#e8edf3;font:14px/1.7 "Microsoft YaHei",sans-serif;padding:40px';
  const html = '<!doctype html><meta charset="utf-8"><body style="' + css + '">'
    + '<h2 style="color:#f0b429;margin:0 0 12px">控制台页面打不开</h2>'
    + '<p>尝试的地址: <b style="color:#7dd3fc">' + consoleUrl() + '</b></p>'
    + '<p>常见原因: 该端口被别的程序占用, 或核心服务启动失败。</p>'
    + '<p style="color:#8b98a8">排查办法: 打开程序目录 logs\\app.log, 搜 "网页控制台", 那一行会写明实际端口;</p>'
    + '<p style="color:#8b98a8">也可以在控制台设置里把 Web 端口改回 19190 后重启。</p>'
    + '<p style="color:#6b7888;font-size:12px">' + String(detail || '') + '</p></body>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}
app.setAppUserModelId('com.vrcliveboard.app');
// 测试/多实例场景: 允许用环境变量覆盖 userData 目录(单实例锁随之独立)
if (process.env.VRCB_USER_DATA) { try { app.setPath('userData', process.env.VRCB_USER_DATA); } catch (e) {} }
let win = null;
let splashPending = false;  // 启动画面播放期间不许主窗口抢显(M-20260911-50)
let tray = null;
let trayOk = false;   // 托盘是否创建成功(M-20260911-36): 失败时不能再"关窗即隐藏", 否则用户既没窗口也没托盘
let quitting = false;
let coreStopped = false; // 桌面壳退出时, 是否已等核心清理完(M-20260911-07)

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
function showMain() { try { if (win && !win.isDestroyed() && !win.isVisible()) { win.show(); win.focus(); } } catch (e) {} }
// 启动画面(M-20260911-50): 特殊彩蛋/启动动画的决策由核心服务给(/api/efx/boot), 壳只负责"播完再亮主窗口"。
// 一切失败路径(加载失败/拿不到决策/超时)都直接放行 —— 启动画面绝不能把用户挡在控制台外面。
// 跳过开关: VRCB_NO_SPLASH=1 或命令行 --no-splash(排查白屏时用)。
function createSplash(onDone) {
  if (process.env.VRCB_HEADLESS_TEST === '1' || process.env.VRCB_NO_SPLASH === '1' || process.argv.indexOf('--no-splash') >= 0) return onDone();
  const maxMs = Number(process.env.VRCB_SPLASH_MAX_MS || 135000);
  let sp = null;
  try {
    sp = new BrowserWindow({ width: 960, height: 540, frame: false, resizable: false, center: true, show: false,
      alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#0b0e13', title: 'VRCLiveBoard', icon: loadIcon(),
      webPreferences: { contextIsolation: true, nodeIntegration: false } });
  } catch (e) { return onDone(); }
  let finished = false, poll = null, bail = null;
  const close = function (why) {
    if (finished) return; finished = true;
    if (poll) clearInterval(poll); if (bail) clearTimeout(bail);
    console.log('[启动画面] 收尾: ' + why);
    try { if (sp && !sp.isDestroyed()) sp.destroy(); } catch (e) {}
    onDone();
  };
  sp.once('ready-to-show', function () { if (sp && !sp.isDestroyed()) sp.show(); });
  sp.webContents.on('did-fail-load', function (e, code, desc, url, isMainFrame) { if (isMainFrame) close('load-fail ' + code); });
  sp.loadURL(consoleUrl() + '/splash.html').catch(function () { close('load-throw'); });
  // 页面播完(或跳过/出错)会置 window.__splashDone —— 用轮询而不是 preload/IPC, 免得为一个启动画面开新的进程间通道
  poll = setInterval(function () {
    if (!sp || sp.isDestroyed()) return close('window-gone');
    sp.webContents.executeJavaScript('!!window.__splashDone').then(function (v) { if (v) close(window.__splashWhy || 'page-done'); }).catch(function () {});
  }, 250);
  bail = setTimeout(function () { close('timeout'); }, maxMs);
}
function createWindow() {
  const icon = loadIcon();
  // show:false + ready-to-show: 首帧即带正确图标再上任务栏, 不给 Windows 缓存默认图标的机会(M-20260903-03)
  win = new BrowserWindow({ width: 940, height: 760, minWidth: 600, minHeight: 460, autoHideMenuBar: true, backgroundColor: '#10141a', title: 'VRCLiveBoard', icon: icon, show: false });
  try { win.setIcon(icon); } catch (e) { /* 旧版本 Electron 无此方法则忽略 */ }
  win.once('ready-to-show', function () { if (!splashPending) showMain(); });
  // 兜底: 页面加载异常时也要显示窗口(3 秒后仍未显示则强制) —— 但启动画面正在播时不抢显
  setTimeout(function () { if (!splashPending) showMain(); }, 3000);
  // 端口要等核心报出来(可能回退); 加载失败自动重试, 三次仍失败就给一页可读的错误提示而不是白屏
  let loadTries = 0;
  const loadConsole = function () { win.loadURL(consoleUrl()).catch(function () {}); };
  win.webContents.on('did-fail-load', function (e, code, desc, url, isMainFrame) {
    if (!isMainFrame || code === -3) return; // -3 = ERR_ABORTED(刷新/跳转导致), 不算故障
    if (loadTries < 3) { loadTries++; setTimeout(loadConsole, 1200); return; }
    win.loadURL(consoleErrorPage(desc + ' (' + code + ')')).catch(function () {});
  });
  whenCoreReady(loadConsole);
  // 只把 https 链接交给系统浏览器(2026-09-11 审计 M3): 任意协议(file:/ms-settings:/search-ms:/smb:)交给 ShellExecute
  // 等于把网页层的链接变成本机执行面; 非 https 一律拒绝。
  win.webContents.setWindowOpenHandler(function (details) {
    try { const u = new URL(String(details.url || '')); if (u.protocol === 'https:') shell.openExternal(u.href); } catch (e) {}
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', function (e, url) {
    try { const u = new URL(String(url)); if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') e.preventDefault(); }
    catch (err) { e.preventDefault(); }
  });
  // Ctrl+R / Ctrl+Shift+R 刷新界面(桌面版没有地址栏和 F5)
  win.webContents.on('before-input-event', function (event, input) {
    if (input.type === 'keyDown' && input.control && String(input.key).toLowerCase() === 'r') {
      event.preventDefault();
      win.webContents.reloadIgnoringCache();
    }
  });
  win.on('close', function (e) {
    if (quitting) return;
    if (trayOk) { e.preventDefault(); win.hide(); return; }   // 有托盘: 关窗=收进托盘
    app.quit();                                              // 没托盘: 关窗就是退出(否则变成无出口的隐藏进程)
  });
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
  // 早期兜底监听(M-20260911-39): 核心要到启动末尾才注册 vrcb:shutdown, 在此之前退出会让 process.emit 拿不到监听者,
// 壳于是直接退出 -> 已拉起的子进程(python 助手/截图常驻助手)残留。这里先占位: 给核心最多 8 秒登记并清理的时间。
process.on('vrcb:shutdown', function (done) {
  setTimeout(function () { try { done(); } catch (e) {} }, 8000);
});
app.on('before-quit', function (e) {
    quitting = true;
    if (coreStopped) return;
    // 先让核心清理(停服务 / 杀 python 助手 / 释放端口)再退, 否则会残留子进程与端口占用(M-20260911-07)
    e.preventDefault();
    const done = function () { if (coreStopped) return; coreStopped = true; app.quit(); };
    let handled = false;
    try { handled = process.emit('vrcb:shutdown', done); } catch (err) { handled = false; }
    if (!handled) { done(); return; }
    setTimeout(done, 3000); // 核心卡住也不要把用户锁在退不掉的窗口里
  });
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
    whenCoreReady(function () { splashPending = true; createSplash(function () { splashPending = false; showMain(); }); });
    try {
      tray = new Tray(loadIcon());
      trayOk = true;
      tray.setToolTip('VRCLiveBoard');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示控制台', click: function () { win.show(); win.focus(); } },
        { label: '在浏览器打开', click: function () { shell.openExternal(consoleUrl()); } },
        { type: 'separator' },
        { label: '退出(完全关闭)', click: function () { app.quit(); } }
      ]));
      tray.on('double-click', function () { win.show(); win.focus(); });
    } catch (e) { /* 无托盘环境忽略 */ }
  });
  app.on('window-all-closed', function () { /* 常驻托盘, 右键托盘退出 */ });
}
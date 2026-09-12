'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { logger } = require('./logger');
const { OscSender } = require('./osc');
const { Composer } = require('./composer');
const { createServer } = require('./web/server');
const { createSource: createHardware, collect: collectHardware } = require('./sources/hardware');
const { createSource: createMedia } = require('./sources/media');
const { createSource: createPages } = require('./sources/pages');
const { setAutostart, isEnabled } = require('./autostart');
const { getVrcStatus } = require('./vrcstatus');
const { runHousekeeping } = require('./housekeeping');
const { PluginManager } = require('./pluginsys/manager');

async function main() {
  // 启动横幅的代号从 version.json 读(M-20260911-52): 原先把「星光」写死在这里, 1.4.0 换代号后日志仍报旧名 —— GVER 现在管这条
  let codename = '';
  try { codename = String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8').replace(/^\uFEFF/, '')).codename || ''); } catch (e) {}
  logger.info('VRCLiveBoard' + (codename ? ('(' + codename + ') ') : ' ') + '启动中...');
  const configPath = path.join(__dirname, '..', 'config.json');
  const configio = require('./configio');
  // 配置损坏不炸: config.json -> .bak -> config.default.json 兜底链(日志警告)
  const config = configio.loadConfig(configPath, path.join(__dirname, '..', 'config.default.json'), logger);
  // 插件安全策略默认档(F-20260903-01): 缺键兜底, 老配置无缝升级; /api/security(一级)可切换收紧档
  config.plugins = config.plugins || {};
  config.plugins.security = Object.assign({ networkPolicy: 'whitelist', processPolicy: 'consent', fsWritePolicy: 'sandbox', fsReadPolicy: 'self', aiPolicy: 'allow' }, config.plugins.security || {});

  const osc = new OscSender(config.osc);
  await osc.open();
  logger.info('OSC 已就绪, 目标 ' + config.osc.host + ':' + config.osc.port);

  runHousekeeping(config, logger);
  const ivHousekeep = setInterval(function () { runHousekeeping(config, logger); }, 6 * 3600 * 1000); // 周期化: 长期挂机也受管(M-20260903-01)

  const projectDir = path.join(__dirname, '..');
  if (config.autostart) {
    try { setAutostart(true, projectDir, logger); } catch (e) { logger.warn('自启自愈失败: ' + e.message); }
  }

  // 预建 swearFilter 对象, 保证 composer 持有的是活引用(运行中开关立即生效)
  config.chatbox = config.chatbox || {};
  config.chatbox.swearFilter = config.chatbox.swearFilter || { enabled: true, words: null };
  const composer = new Composer({ osc: osc, logger: logger, swearFilter: config.chatbox.swearFilter, maxChars: config.chatbox.maxChars, minSendIntervalMs: config.osc.minSendIntervalMs });

  const ivVrc = setInterval(function () {
    const st = getVrcStatus();
    composer.vrcOn = !!(st.running && st.oscEnabled);
    composer.vrcInfo = st;
  }, 5000);

  // 硬件变量常驻刷新: 即使"电脑状态"显示源关闭, 公告板页面里的 {cpu_util} 等变量仍然实时可用
  async function refreshVars() {
    try { Object.assign(composer.vars, await collectHardware()); } catch (e) {}
  }
  refreshVars();
  const ivVars = setInterval(refreshVars, 5000);

  composer.registerSource(createPages(config.sources.pages));
  composer.registerSource(createHardware(config.sources.hardware));
  const mediaSource = createMedia(config.sources.media, logger); // 持有引用: 退出时要杀掉 python 助手(否则 Windows 上会残留)
  composer.registerSource(mediaSource);

  // 插件目录: plugins/*.js, 每个插件导出 { id, version, createSource(config, logger) }
  const pluginsDir = path.join(__dirname, '..', 'plugins');
  let pluginFiles = [];
  try { pluginFiles = fs.readdirSync(pluginsDir).filter(function (f) { return f.endsWith('.js'); }); } catch (e) {}
  for (const f of pluginFiles.sort()) {
    try {
      const mod = require(path.join(pluginsDir, f));
      if (!mod.createSource) { logger.warn('插件 ' + f + ' 缺少 createSource, 跳过'); continue; }
      const cfg = (config.sources && config.sources[mod.id]) || {};
      const src = mod.createSource(cfg, logger);
      composer.registerSource(src);
      logger.info('插件已加载: ' + f + ' (id=' + src.id + ')');
    } catch (e) { logger.error('插件加载失败 ' + f + ': ' + ((e && e.message) || e)); }
  }

  composer.start();

  // 插件系统(乐高扩展)
  const pluginManager = new PluginManager({ root: pluginsDir, composer: composer, logger: logger, approvals: config.pluginApprovals || {}, security: function () { return config.plugins.security; }, aiConfig: function () { return config.ocrtl; } });
  pluginManager.scan();
  for (const e of pluginManager.entries) {
    if (config.plugins && config.plugins[e.id]) e.settings = config.plugins[e.id];
  }
  const enabledIds = config.pluginEnabled || [];
  for (const id of enabledIds) {
    const r = pluginManager.enable(id);
    if (!r.ok) logger.warn('[插件] 自动启用失败 ' + id + ': ' + r.error);
  }

  const web = createServer({ web: config.web, config: config, configPath: configPath, composer: composer, logger: logger, projectDir: projectDir, pluginManager: pluginManager, osc: osc, onQuit: function () { shutdown('控制台退出'); }, onRestart: function (proceed) { shutdown('控制台重启', proceed); } });
  const consolePort = await web.start();
  // 桌面壳必须知道**实际**端口: 19190 被占时上面会回退, 写死 URL 就会白屏(M-20260911-08)
  process.env.VRCB_CONSOLE_PORT = String(consolePort);
  try { process.emit('vrcb:console-ready', consolePort); } catch (e) {}

  if (config.web.openBrowser && process.env.VRCLIVEBOARD_AUTOSTART !== '1' && process.env.VRCB_EMBEDDED !== '1') {
    // 安全: 不拼 shell 字符串(防 config 注入命令), host 白名单
    try {
      const host = String(config.web.host || '127.0.0.1');
      if (/^[a-zA-Z0-9.:-]+$/.test(host)) require('child_process').spawn('cmd', ['/c', 'start', '', 'http://' + host + ':' + consolePort], { shell: false, windowsHide: true });
      else logger.warn('web.host 含非法字符, 已跳过自动开浏览器');
    } catch (e) {}
  }

  // 统一退出(M-20260911-07): 修复前退出路径只调 composer.stop() + osc.close(),
  // web.stop() 与 media.stop() 从未被调用, python 助手在 Windows 上不随父进程退出 → 残留; 端口也不优雅释放
  let shuttingDown = false;
  function exitNow() {
    if (process.env.VRCB_EMBEDDED === '1') { try { require('electron').app.quit(); return; } catch (e) { /* 非 Electron 环境 */ } }
    process.exit(0);
  }
  async function shutdown(reason, proceed) {
    if (shuttingDown) return;
    shuttingDown = true;
    try { logger.info('正在退出(' + reason + ')'); } catch (e) {}
    try { clearInterval(ivHousekeep); } catch (e) {}
    try { clearInterval(ivVrc); } catch (e) {}
    try { clearInterval(ivVars); } catch (e) {}
    try { composer.stop(); } catch (e) {}
    try { if (mediaSource && mediaSource.stop) mediaSource.stop(); } catch (e) {}
    try { require('./capturehost').stopCaptureHost(); } catch (e) {}
    try { if (web && web.stop) await Promise.race([web.stop(), new Promise(function (r) { setTimeout(r, 1500); })]); } catch (e) {}
    try { osc.close(); } catch (e) {}
    if (typeof proceed === 'function') { try { proceed(); } catch (e) { logger.error('退出后续失败: ' + e.message); } return; }
    setTimeout(exitNow, 150);
  }
  process.on('SIGINT', function () { shutdown('SIGINT'); });
  process.on('SIGTERM', function () { shutdown('SIGTERM'); });
  // 桌面壳托盘退出: electron/main.js 在 before-quit 里触发, 等清理完再真正退出
  process.on('vrcb:shutdown', function (done) { shutdown('桌面壳退出', done); });
  // 全局异常兜底: 插件/异步回调的异常不再杀死整个程序(记日志继续跑)
  process.on('uncaughtException', function (e) { try { logger.error('[未捕获异常] ' + ((e && e.stack) || e)); } catch (e2) {} });
  process.on('unhandledRejection', function (r) { try { logger.error('[未处理的 Promise 拒绝] ' + ((r && r.stack) || r)); } catch (e2) {} });
  logger.info('就绪。游戏内 Action Menu → Options → OSC → Enabled 后即可看到聊天框文本。');
}
main().catch(function (e) { logger.error(String((e && e.stack) || e)); process.exit(1); });

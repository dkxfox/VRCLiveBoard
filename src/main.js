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
  // 运行环境自检(M-20260927-01): Node 18/20 没有全局 WebSocket, 插件会以"某个功能莫名不工作"的方式失败(只报后台日志)
  // 只提示、不拦启动: 桌面版内嵌 Electron 43 的 Node 24, 不会命中; 轻量版用系统 Node, 会命中
  const nodeMajor = parseInt(String(process.versions.node).split('.')[0], 10);
  if (nodeMajor < 22) {
    logger.warn('当前 Node.js ' + process.versions.node + ' 低于要求的 22: 部分插件(歌词 / B站直播)可能不可用, 请升级到 Node.js 22 或更高');
  }
  const configPath = path.join(__dirname, '..', 'config.json');
  const configio = require('./configio');
  // 配置损坏不炸: config.json -> .bak -> config.default.json 兜底链(日志警告)
  const config = configio.loadConfig(configPath, path.join(__dirname, '..', 'config.default.json'), logger);
  // 插件安全策略默认档(F-20260903-01): 缺键兜底, 老配置无缝升级; /api/security(一级)可切换收紧档
  config.plugins = config.plugins || {};
  config.plugins.security = Object.assign({ networkPolicy: 'whitelist', processPolicy: 'consent', fsWritePolicy: 'sandbox', fsReadPolicy: 'self', aiPolicy: 'allow' }, config.plugins.security || {});

  // 播放期性能取证(M-20260927-07): 启动即自动记录 120 秒(事件循环延迟 + 各进程 CPU + 视频响应时序),
  // 页面端 <video> 的卡顿/掉帧证据会 POST 回来 —— 重启一次、让彩蛋播一遍, 再开 /api/diag/perf 就能拿到同一时轴的三方证据。
  try { require('./diagperf').arm(300); } catch (e) { logger.warn('性能取证启动失败(不影响运行): ' + e.message); }

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

  // 输入触发器(M-20260928-01, F-20260925-02 切片 1): 把 VRChat 回传的 /avatar/parameters/* 变成「开始说话/发送/取消」。
  // 本切片只做到"状态机 + 可见反馈"(/chatbox/typing); 识别层(系统听写/ASR)在切片 2 接入。
  // 听写(切片 2): 常驻 SAPI 助手, 只在触发器的 start/send 之间开麦克风
  const { Dictation } = require('./dictation');
  const asrCfg = (config.triggers && config.triggers.asr) || {};
  const dictation = new Dictation({ logger: logger, projectDir: projectDir, config: asrCfg, onText: function (t, final) { if (!final) { try { logger.info('[听写] 临时: ' + t); } catch (e) {} } } });
  if (asrCfg.enabled === true) dictation.warmup();
  // 单一事实来源: 直接问听写引擎(别再读 config —— 两份状态会漂移, 2026-09-28 踩过)
  const asrOn = function () { try { return dictation.status().enabled === true; } catch (e) { return false; } };

  let lastTriggerStartAt = 0;
  const { TriggerEngine } = require('./triggers');
  const triggers = new TriggerEngine({
    logger: logger,
    config: config.triggers,
    onEvent: function (ev) {
      if (ev.type === 'start') lastTriggerStartAt = ev.at || Date.now();
      try {
        if (ev.type === 'start') {
          logger.info('[触发器] 开始说话(' + (ev.param || '?') + ')'); osc.sendTyping(true);
          if (!asrOn()) logger.info('[听写] 未启用(控制台高级设置里打开"识别层")');
          if (asrOn()) { const r = dictation.start(); if (!r.ok) logger.warn('[听写] 无法开始: ' + (r.error || '?')); }
        } else if (ev.type === 'send') {
          logger.info('[触发器] 说完/发送'); osc.sendTyping(false);
          if (asrOn()) {
            // 识别引擎要把最后一句收尾, 给一小段宽限时间再取文字(M-20260928-02)
            // 只保留「我在说话」那几秒的转写行(2026-09-28 用户反馈: 开着 LiveTranslate 会把环境里别人的话一起带进来);
            // 判据直接用 VRChat 回传的 Voice/Viseme 活动窗口 —— 静音时它不上报, 那种情况不过滤。
            const asrCfg2 = (config.triggers && config.triggers.asr) || {};
            const mineFilter = function (atMs, text) {
              try {
                if (asrCfg2.mineOnly === false) return true;
                if (triggers.mutedDuring(lastTriggerStartAt)) return true;
                if (!triggers.hasVoiceData()) return true;   // 静音时 VRChat 不上报语音活动, 无从判断 -> 不过滤
                return triggers.speechWindowsWithin(atMs).length > 0;
              } catch (e) { return true; }
            };
            dictation.stop(2600, { filter: mineFilter }).then(function (r) {
              const text = String((r && r.text) || '').trim();
              if (!text) { logger.info('[听写] 这次没识别到内容'); return; }
              composer.pushTransient(text, 80, 8000);
              logger.info('[听写] 已上屏: ' + text);
            }).catch(function (e) { logger.warn('[听写] 取结果失败: ' + e.message); });
          }
        } else if (ev.type === 'cancel') {
          logger.info('[触发器] 取消' + (ev.reason ? ('(' + ev.reason + ')') : '')); osc.sendTyping(false);
          if (asrOn()) { dictation.stop(0).then(function (r) { const t = String((r && r.text) || '').trim(); if (t) logger.info('[听写] 已丢弃: ' + t); }); }
        }
      } catch (e) { logger.warn('[触发器] 反馈失败: ' + e.message); }
    }
  });
  triggers.sync();
  // 动作输出(反向 OSC, F-20260928-01 切片 1): 外部软件/我们自己的功能 -> 驱动本机玩家动作; 与触发器正好相反方向。
  // 默认关闭; 关闭/退出/异常都走 resetAll, 绝不留下"一直往前走"(官方红线)。

  // 内置输入法引擎(F-20260925-02 P2-a): 拼音串 -> 候选词; 词库懒加载(首次调用才读 1.4MB 词表)
  const { PinyinIME } = require('./pinyin');
  const ime = new PinyinIME({ logger: logger, projectDir: projectDir });   // 注意是 projectDir(工程根), 不是 __dirname(src/)
  const { ActionSender } = require('./actions');
  const actions = new ActionSender({ logger: logger, osc: osc, config: config.actions });

  const ivVrc = setInterval(function () {
    const st = getVrcStatus();
    composer.vrcOn = !!(st.running && st.oscEnabled);
    composer.vrcInfo = st;
  }, 5000);

  // 硬件变量常驻刷新: 即使"电脑状态"显示源关闭, 公告板页面里的 {cpu_util} 等变量仍然实时可用
  async function refreshVars() {
    try { Object.assign(composer.vars, await collectHardware({ maxAgeMs: 4000 })); } catch (e) {}   // 与硬件源共用一次采集(见 sources/hardware.js)
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

  const web = createServer({ web: config.web, config: config, configPath: configPath, composer: composer, logger: logger, projectDir: projectDir, pluginManager: pluginManager, osc: osc, triggers: triggers, dictation: dictation, actions: actions, ime: ime, onQuit: function () { shutdown('控制台退出'); }, onRestart: function (proceed) { shutdown('控制台重启', proceed); } });
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
    try { triggers.close(); } catch (e) {}
    try { dictation.close(); } catch (e) {}
    try { actions.close(); } catch (e) {}
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

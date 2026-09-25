'use strict';
// B站直播互动 —— 官方开放平台通道(头顶弹幕)
//
// 流水线: official.js(签名/HTTP) → session.js(wss + 认证 + 双心跳 + 重连)
//        → events.js(CMD 归一化) → bridge.js(抢占/让路/排队/防丢/聚合/限流) → ctx.chatbox
//
// 安全约定(见 插件研发/bilibili-live/07-接入实现要点.md 第六节):
//   · 四个凭据只从 ctx.config 读(本地 config.json 的 plugins['bilibili-live'] 段), 永不进日志/发布包;
//   · 日志里最多出现 access_key_id 的前 4 位与字段名, **绝不出现 secret 与身份码**;
//   · 网络请求一律走 ctx.http.request(受 manifest 域名白名单与审计), 不用裸 fetch。
const { createSession } = require('./lib/session.js');
const OF = require('./lib/official.js');
const B = require('./lib/bridge.js');

const CRED_KEYS = ['accessKeyId', 'accessKeySecret', 'appId', 'roomOwnerAuthCode'];
const CRED_LABELS = { accessKeyId: 'access_key_id', accessKeySecret: 'access_key_secret', appId: 'app_id', roomOwnerAuthCode: '主播身份码' };
const DEFAULTS = {
  autoStart: true,            // 启用插件时自动开始接收(凭据齐全才连)
  ignoreSelf: true,           // 不转发**主播自己发的**消息(开放平台靠 open_id 认人; 想让自己也上聊天框就关掉)
  restartDelayMs: 5000,       // 平台停推后多久重新开局
  priority: null,             // 卡片里的优先级(填了就对整插件统一生效, 见 makeBridge)
  showUname: true,
  prefix: '',
  maxLen: 100,
  throttleMs: 1500,
  ttlMs: 8000,
  blockedWords: [],
  timeoutMs: 10000,
  kinds: { DANMAKU: true, GIFT: true, SUPER_CHAT: true, GUARD: true, INTERACT: false, ENTER: false, LIKE: false }
};

module.exports = function (ctx) {
  let sess = null, bridge = null, stopTick = null, starting = false, restartTimer = null;
  let anchorOpenId = '', anchorUid = 0;
  const status = { running: false, authed: false, gameId: '', events: 0, shown: 0, ignored: 0, selfSkipped: 0, lastError: '', since: 0, stopReason: '' };
  // 是不是"主播自己发的消息": 开放平台用 open_id 标识用户(**没有 uid**), 所以先比 open_id, 再退化比 uid
  function isSelf(raw) {
    const d = (raw && raw.data && typeof raw.data === 'object') ? raw.data : {};
    const oid = String(d.open_id || d.openId || '');
    if (oid && anchorOpenId && oid === anchorOpenId) return true;
    const uid = Number(d.uid || 0);
    if (uid && anchorUid && uid === anchorUid) return true;
    return false;
  }
  // 平台主动停止推送(通常是心跳超时): 结束当前场次, 等一会儿重新 start
  function scheduleRestart(ms) {
    if (restartTimer) return;
    restartTimer = setTimeout(async function () {
      restartTimer = null;
      await stop('interaction-end');
      if (cfg().autoStart) await start();
    }, ms || Number(cfg().restartDelayMs) || 5000);
    if (restartTimer.unref) restartTimer.unref();
  }

  function cfg() {
    const c = Object.assign({}, DEFAULTS, ctx.config || {});
    // kinds 这类对象: 用户给了就整体合到默认之上(免得出现"关不掉的开关")
    if (ctx.config && ctx.config.kinds && typeof ctx.config.kinds === 'object') c.kinds = Object.assign({}, DEFAULTS.kinds, ctx.config.kinds);
    return c;
  }
  function credsOf() {
    const c = cfg();
    const cr = {};
    for (const k of CRED_KEYS) cr[k] = String(c[k] === undefined || c[k] === null ? '' : c[k]).trim();
    return cr;
  }
  function missingCreds(cr) { return CRED_KEYS.filter(function (k) { return !cr[k]; }); }
  function keyHint(k) { const s = String(k || ''); return s ? s.slice(0, 4) + '…(' + s.length + ')' : '-'; }
  function log(m) { try { ctx.logger.info('[B站直播] ' + m); } catch (e) {} }
  function warn(m) { try { ctx.logger.warn('[B站直播] ' + m); } catch (e) {} }

  // 桥: 卡片优先级填了 -> 整插件统一用它(否则各类型用默认偏移 弹幕75/礼物80/SC88/上舰92)
  function bridgeCfg() {
    const c = cfg();
    const bcfg = {
      showUname: c.showUname, prefix: c.prefix, maxLen: c.maxLen, throttleMs: c.throttleMs,
      ttlMs: c.ttlMs, blockedWords: c.blockedWords, kinds: c.kinds,
      basePriority: Number(c.priority) || B.DEFAULT_CFG.basePriority
    };
    // 策略层的可调项也透传(config.json 里设了就得生效: 队列时效/上限/让路地板/聚合窗口…)
    for (const k of ['preemptBackground', 'respectPriority', 'protectSources', 'queueMax', 'highValueQueueMax', 'danmakuQueueTtlMs', 'aggregateWindowMs', 'aggregateFormat', 'aggregateKinds']) {
      if (ctx.config && ctx.config[k] !== undefined) bcfg[k] = ctx.config[k];
    }
    if (c.priority !== null && c.priority !== undefined && Number(c.priority)) {
      bcfg.sourcePriority = {};
      for (const k of ['DANMAKU', 'GIFT', 'SUPER_CHAT', 'GUARD', 'INTERACT', 'ENTER', 'LIKE']) bcfg.sourcePriority[k] = Number(c.priority);
    }
    return bcfg;
  }
  // 配置热更新(2026-09-25 用户实机: "弹幕带昵称关了还带昵称") —— 桥在创建时**快照**了配置,
  // 设置面板保存只改了 ctx.config, 运行中的桥还拿着旧配置。所以每 tick(1 秒)与保存后都同步一次。
  function syncCfg() { if (bridge) bridge.setCfg(bridgeCfg()); }
  function makeBridge() {
    return B.createBridge({
      cfg: bridgeCfg(),
      push: function (text, priority, ttlMs, force) { ctx.chatbox.send(text, { priority: priority, ttlMs: ttlMs, force: force }); },
      current: function () { try { return ctx.chatbox.current(); } catch (e) { return null; } },
      log: function (m) { log(m); },
      onDrop: function (item, why, detail) {
        // 丢弃必须可见, 而且要说明**为什么等不到上屏**(否则用户只看到"丢弃"没法排查)
        warn('丢弃(' + why + (detail && detail.why ? ', 等不到上屏: ' + detail.why : '') + '): ' + item.text);
      }
    });
  }
  function ensureBridge() { if (!bridge) bridge = makeBridge(); return bridge; }
  // 当前**真正生效**的配置(排查"设置好像没生效"就看它)
  function effectiveCfg() {
    const c = bridge ? bridge.cfg() : bridgeCfg();
    return { showUname: !!c.showUname, prefix: String(c.prefix || ''), throttleMs: Number(c.throttleMs), ttlMs: Number(c.ttlMs), basePriority: Number(c.basePriority), kinds: c.kinds };
  }

  function wsFactory(url) {
    if (typeof WebSocket !== 'function') throw new Error('当前运行环境没有全局 WebSocket(需要 Node 21+ / 22)');
    return new WebSocket(url);
  }
  async function start() {
    if (status.running || starting) return { ok: true, already: true, gameId: status.gameId };
    const c = cfg();
    const cr = credsOf();
    const miss = missingCreds(cr);
    if (miss.length) {
      const msg = '还没填全凭据: ' + miss.map(function (k) { return CRED_LABELS[k]; }).join(' / ');
      status.lastError = msg; warn(msg);
      return { ok: false, error: msg, missing: miss };
    }
    starting = true;
    try {
      log('正在连接开放平台(项目 ' + cr.appId + ', key ' + keyHint(cr.accessKeyId) + ')');
      const o = { fetchImpl: function (url, opts) { return ctx.http.request(url, opts); }, timeoutMs: Number(c.timeoutMs) || 10000 };
      const st = await OF.startSession(cr, cr.appId, cr.roomOwnerAuthCode, o);
      if (!st.hosts.length || !st.authBody) throw new Error('开放平台没有返回弹幕服务器地址或 auth_body');
      // 复用同一个桥: 会话重开(平台停推/重连)时**不能**换新桥 —— 换新桥会丢掉"自己刚推的那条文本"记忆,
      // 于是还挂在屏上的自己的消息被当成"别人的同优先级占屏" -> 后面所有弹幕一直排队 -> 30 秒后整批过期丢弃
      // (2026-09-25 用户实机日志: 一串 "丢弃(expired)")。配置变化由 syncCfg() 负责。
      if (!bridge) bridge = makeBridge();
      anchorOpenId = String(st.roomOwnerOpenId || ''); anchorUid = Number(st.roomOwnerUid || 0);
      sess = createSession({
        hosts: st.hosts, authBody: st.authBody, gameId: st.gameId,
        wsFactory: wsFactory,
        postHeartbeat: function (g) { return OF.heartbeatSession(cr, g, o); },
        postEnd: function (g) { return OF.endSession(cr, g, o); },
        onEvent: function (raw) {
          const cmdName = String((raw && raw.cmd) || '').toUpperCase();
          if (cmdName === 'LIVE_OPEN_PLATFORM_INTERACTION_END') {      // 平台停推(常见于心跳超时)
            warn('平台主动停止推送, 5 秒后重新开启场次');
            status.running = false;
            scheduleRestart(Number(cfg().restartDelayMs) || 5000);
            return;
          }
          status.events += 1;
          if (cfg().ignoreSelf && isSelf(raw)) {
            status.selfSkipped += 1;
            if (status.selfSkipped === 1) log('已忽略主播自己发的消息(想让自己也上聊天框, 就把插件设置里的"忽略主播自己发的消息"关掉)');
            return;
          }
          const r = bridge.handleRaw(raw);
          if (r.action === 'show') status.shown += 1;
          else if (r.action === 'ignore') status.ignored += 1;
        },
        onLog: function (m) { log(m); }
      });
      sess.start();
      stopTick = ctx.events.every(1000, function () { try { syncCfg(); bridge.tick(); } catch (e) { warn('tick 异常: ' + e.message); } });
      status.running = true; status.since = Date.now(); status.lastError = ''; status.stopReason = '';
      status.gameId = st.gameId;
      log('已开始接收(场次 ' + st.gameId + ', 弹幕服务器 ' + st.hosts.length + ' 个)');
      return { ok: true, gameId: st.gameId, hosts: st.hosts.length };
    } catch (e) {
      status.lastError = String((e && e.message) || e);
      warn('连接失败: ' + status.lastError);
      await stop('start-failed');
      return { ok: false, error: status.lastError };
    } finally { starting = false; }
  }
  async function stop(why) {
    if (stopTick) { try { stopTick(); } catch (e) {} stopTick = null; }
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    const s = sess; sess = null;
    if (s) { try { await s.stop(); } catch (e) { warn('收尾失败: ' + e.message); } }
    if (status.running) log('已停止接收' + (why ? '(' + why + ')' : ''));
    status.running = false; status.authed = false; status.stopReason = why || 'manual';
  }
  // 本地预览: 用假事件走一遍完整管线(不联网、不需要凭据), 让用户先看到文案与优先级效果
  function sample(kind, text, uname) {
    const who = uname || '测试观众';
    if (kind === 'SUPER_CHAT') return { cmd: 'SUPER_CHAT_MESSAGE', data: { price: Number(text) || 30, message: '这是一条测试醒目留言', time: 60, uid: 1, user_info: { uname: who } } };
    if (kind === 'GIFT') return { cmd: 'SEND_GIFT', data: { giftName: text || '辣条', num: 5, uname: who, uid: 1, coin_type: 'silver', total_coin: 500 } };
    if (kind === 'GUARD') return { cmd: 'GUARD_BUY', data: { uid: 1, username: who, guard_level: 3, num: 1, price: 138000, gift_name: '舰长' } };
    return { cmd: 'DANMU_MSG', info: [[], text || '这是一条测试弹幕', [1, who, 0, 0, 0, 10000, 1, '']] };
  }
  function preview(input) {
    const o = input || {};
    const kind = String(o.kind || 'DANMAKU').toUpperCase();
    const b = ensureBridge();
    const r = b.handleRaw(sample(kind, o.text, o.uname), undefined, { bypassThrottle: true });   // 显式预览: 不受节流限制
    b.tick();
    return { ok: true, kind: kind, action: r.action, reason: r.reason, text: r.text || '', queue: b.queue() };
  }

  return {
    apply: function () {
      const cr = credsOf();
      const miss = missingCreds(cr);
      log('插件已启用' + (miss.length ? '(还缺 ' + miss.map(function (k) { return CRED_LABELS[k]; }).join(' / ') + ')' : ''));
      if (cfg().autoStart && !miss.length) start();
      else if (miss.length) warn('未自动连接: 请在插件设置里填全四个参数');
    },
    dispose: function () { return stop('plugin-disabled'); },
    api: {
      // 「测试连接」: 完整走一遍 start → end(不建长连接), 用来验证四个参数与网络
      test: async function () {
        if (status.running) return { ok: true, already: true, note: '正在接收中, 无需再测(凭据已生效)', gameId: status.gameId };
        const cr = credsOf();
        const miss = missingCreds(cr);
        if (miss.length) return { ok: false, error: '还缺: ' + miss.map(function (k) { return CRED_LABELS[k]; }).join(' / '), missing: miss };
        const t0 = Date.now();
        const o = { fetchImpl: function (url, opts) { return ctx.http.request(url, opts); }, timeoutMs: Number(cfg().timeoutMs) || 10000 };
        try {
          const st = await OF.startSession(cr, cr.appId, cr.roomOwnerAuthCode, o);
          let ended = false;
          try { await OF.endSession(cr, st.gameId, o); ended = true; } catch (e) { warn('结束场次失败: ' + e.message); }
          log('测试连接成功(场次 ' + st.gameId + ', 用时 ' + (Date.now() - t0) + 'ms)');
          // 测试通过 + 开了自动连接 + 还没在跑 -> 顺手开始接收(用户"填完点一下就能看到效果")
          let started = false;
          if (cfg().autoStart && !status.running) { const r = await start(); started = !!(r && r.ok); }
          return { ok: true, gameId: st.gameId, hosts: st.hosts.length, authBody: !!st.authBody, ended: ended, ms: Date.now() - t0, key: keyHint(cr.accessKeyId), started: started };
        } catch (e) {
          const msg = String((e && e.message) || e);
          status.lastError = msg; warn('测试连接失败: ' + msg);
          return { ok: false, error: msg, ms: Date.now() - t0 };
        }
      },
      start: start,
      stop: function () { return stop('manual'); },
      preview: preview,
      reloadConfig: function () { syncCfg(); return { ok: true, effective: effectiveCfg() }; },
      status: function () {
        return {
          running: status.running, authed: !!(sess && sess.state && sess.state.authed), gameId: status.gameId,
          // shown 直接取桥的统计: 桥才知道"真正推上去几条"(排队补发的那些不经过 onEvent, 自己数会漏)
          events: status.events, shown: bridge ? bridge.stats().shown : status.shown, ignored: status.ignored, selfSkipped: status.selfSkipped,
          lastError: status.lastError, since: status.since, stopReason: status.stopReason,
          queue: bridge ? bridge.queue() : { pending: null, waiting: 0 },
          effective: bridge ? effectiveCfg() : null,
          stats: bridge ? bridge.stats() : null,
          key: keyHint(credsOf().accessKeyId),
          missing: missingCreds(credsOf()).map(function (k) { return CRED_LABELS[k]; })
        };
      }
    }
  };
};

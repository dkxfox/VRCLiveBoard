'use strict';
// B站直播 —— 连接层: wss 连接 + 认证帧 + **双心跳** + 重连退避
//
// 官方要求(见 07-接入实现要点.md):
//   · 认证: 连上弹幕服务器后先发 op=7 认证帧(body 就是 start 返回的 auth_body), 等 op=8 回应;
//   · **两个心跳**: 连接心跳 30 秒(WebSocket op=2) + 项目心跳 20 秒(POST /v2/app/heartbeat, 带 game_id);
//   · 漏发会掉线; 掉线要退避重连, 并且**换一个弹幕服务器**再试。
// 依赖注入(便于离线单测): wsFactory / postHeartbeat / postEnd / onEvent / onLog / 各时长。
const F = require('./frame.js');

// 弹幕服务器白名单(2026-09-25 安全审计): 服务器地址是 start 响应给的**外部输入**, 而认证帧里带着 auth_body(令牌)。
// 不校验的话, 被篡改的响应就能让我们把令牌发到任意 wss:// 主机 —— 所以只允许官方弹幕域名(*.chat.bilibili.com)
// 和本机回环(单测用假服务器; 回环不会外泄到本机之外)。
const DEFAULT_ALLOW_HOSTS = ['chat.bilibili.com', '127.0.0.1', 'localhost', '::1'];
function hostAllowed(url, allow) {
  let h = '';
  try { h = new URL(String(url)).hostname.toLowerCase(); } catch (e) { return false; }
  return (allow || DEFAULT_ALLOW_HOSTS).some(function (r) {
    const rr = String(r).toLowerCase();
    return rr === '*' || h === rr || h.endsWith('.' + rr);
  });
}
const DEFAULTS = {
  allowHosts: DEFAULT_ALLOW_HOSTS,
  maxBufBytes: 8 * 1024 * 1024,   // 接收缓冲上限(半包拼不起来时不能无限涨)
  wsHeartbeatMs: 30000,
  projectHeartbeatMs: 20000,
  authTimeoutMs: 10000,
  closeTimeoutMs: 3000,
  backoffBaseMs: 2000,
  backoffMaxMs: 60000,
  jitterRatio: 0.2
};

function createSession(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const state = { attempts: 0, authed: false, stopped: false, hostIndex: 0, connections: 0, events: 0, lastError: '' };
  let ws = null, authTimer = null, hbTimer = null, projTimer = null, reconnectTimer = null, closeWatch = null;
  let buf = Buffer.alloc(0);
  function log(m) { try { if (o.onLog) o.onLog(String(m)); } catch (e) {} }
  function host() { const list = o.hosts || []; return list.length ? list[state.hostIndex % list.length] : ''; }
  function backoffMs() {
    const base = Math.min(Number(o.backoffMaxMs), Number(o.backoffBaseMs) * Math.pow(2, Math.max(0, state.attempts - 1)));
    const j = base * Number(o.jitterRatio) * (Math.random() * 2 - 1);
    return Math.max(0, Math.round(base + j));
  }
  function clearAll() {
    if (authTimer) clearTimeout(authTimer); if (hbTimer) clearTimeout(hbTimer);
    if (projTimer) clearTimeout(projTimer); if (reconnectTimer) clearTimeout(reconnectTimer);
    if (closeWatch) clearTimeout(closeWatch);
    authTimer = hbTimer = projTimer = reconnectTimer = closeWatch = null;
  }
  function unref(t) { try { if (t && t.unref) t.unref(); } catch (e) {} return t; }
  function scheduleReconnect(why) {
    if (state.stopped) return;
    if (reconnectTimer) return;                 // 已经排上就别叠加(看门狗 + onclose 可能前后脚到)
    state.authed = false;
    if (authTimer) { clearTimeout(authTimer); authTimer = null; }
    if (hbTimer) { clearTimeout(hbTimer); hbTimer = null; }
    if (projTimer) { clearTimeout(projTimer); projTimer = null; }
    if (closeWatch) { clearTimeout(closeWatch); closeWatch = null; }
    state.attempts += 1;
    state.hostIndex += 1;                       // 换下一个弹幕服务器
    const wait = backoffMs();
    log('重连#' + state.attempts + ' ' + wait + 'ms 后重试 (' + why + ')');
    reconnectTimer = unref(setTimeout(function () { reconnectTimer = null; connect(); }, wait));   // 触发时必须清掉, 否则"防叠加"会把后续重连全挡死
  }
  // 主动断开: 关连接 + 看门狗。真实里遇到过"TCP 连上了但不回关闭帧"的半死服务端,
  // 那时 onclose 永不触发, 光等 close 会把重连卡死, 所以超时后自己接管(摘掉回调, 直接重连)。
  function requestClose(why) {
    const sock = ws;
    if (closeWatch) { clearTimeout(closeWatch); closeWatch = null; }
    try { if (sock) sock.close(); } catch (e) {}
    if (state.stopped) return;
    closeWatch = unref(setTimeout(function () {
      closeWatch = null;
      if (state.stopped || ws !== sock) return;
      log('关闭超时(' + why + '), 强制重连');
      try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; } catch (e) {}
      ws = null;
      scheduleReconnect('close-timeout:' + why);
    }, Number(o.closeTimeoutMs)));
  }
  function connect() {
    if (state.stopped) return;
    const h = host();
    if (!h) return scheduleReconnect('no-host');
    if (!hostAllowed(h, o.allowHosts)) {            // 白名单外: 绝不把认证帧发出去
      state.lastError = '弹幕服务器不在白名单: ' + h;
      log('拒绝连接(白名单外, 可能是响应被篡改): ' + h);
      return scheduleReconnect('host-not-allowed');
    }
    state.connections += 1;
    try { ws = o.wsFactory(h); } catch (e) { state.lastError = String(e.message); return scheduleReconnect('factory:' + e.message); }
    try { ws.binaryType = 'arraybuffer'; } catch (e) {}   // 关键: 默认收到的是 Blob, 解不了帧
    ws.onopen = function () {
      log('已连接 ' + h);
      try { ws.send(F.encode(F.OP.AUTH, o.authBody)); } catch (e) { return scheduleReconnect('send-auth:' + e.message); }
      authTimer = unref(setTimeout(function () { log('认证超时'); requestClose('auth-timeout'); }, Number(o.authTimeoutMs)));
    };
    ws.onmessage = function (ev) { onData(ev && ev.data); };
    ws.onerror = function () { state.lastError = 'ws-error'; };
    ws.onclose = function () { scheduleReconnect('closed'); };
  }
  async function onData(data) {
    try {
      let chunk = null;
      if (typeof data === 'string') chunk = Buffer.from(data, 'utf8');
      else if (Buffer.isBuffer(data)) chunk = data;
      // 必须**复制**: Buffer.from(ArrayBuffer) 是视图不复制, 而 undici 的接收缓冲会被下一帧覆盖,
      // 半包状态(buf)里存视图就会被写坏 —— 表现为"拼不上第二半".
      else if (data instanceof ArrayBuffer) chunk = Buffer.from(new Uint8Array(data));
      else if (data && typeof data.arrayBuffer === 'function') chunk = Buffer.from(await data.arrayBuffer());
      if (!chunk) return;
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > Number(o.maxBufBytes)) {        // 半包拼不起来(或对方灌数据)时不能无限涨
        log('接收缓冲超限(' + buf.length + ' 字节), 断开重连');
        buf = Buffer.alloc(0);
        try { if (ws) ws.close(); } catch (e) {}
        return;
      }
      const dec = F.decodeWithRest(buf);
      buf = dec.rest;
      for (const f of dec.frames) {
        if (f.error) log('帧异常(' + f.error + ', op=' + f.op + ')');   // 超长帧/解压失败/压缩炸弹都从这里可见
        if (f.op === F.OP.AUTH_REPLY) {
          if (authTimer) { clearTimeout(authTimer); authTimer = null; }
          state.authed = true; state.attempts = 0;
          log('认证成功');
          startHeartbeats();
        } else if (f.op === F.OP.MESSAGE && f.json) {
          state.events += 1;
          try { if (o.onEvent) o.onEvent(f.json); } catch (e) { log('事件回调异常: ' + e.message); }
        }
      }
    } catch (e) { log('解帧异常: ' + e.message); }
  }
  function startHeartbeats() {
    if (hbTimer) clearTimeout(hbTimer);
    if (projTimer) clearTimeout(projTimer);
    const tick = function () {
      if (state.stopped) return;
      try { if (ws && ws.readyState === 1) ws.send(F.encode(F.OP.HEARTBEAT)); } catch (e) { log('连接心跳失败: ' + e.message); }
      hbTimer = unref(setTimeout(tick, Number(o.wsHeartbeatMs)));
    };
    hbTimer = unref(setTimeout(tick, Number(o.wsHeartbeatMs)));
    const proj = function () {
      if (state.stopped) return;
      Promise.resolve()
        .then(function () { return o.postHeartbeat ? o.postHeartbeat(o.gameId) : null; })
        .catch(function (e) { log('项目心跳失败: ' + e.message); })
        .then(function () { if (!state.stopped) projTimer = unref(setTimeout(proj, Number(o.projectHeartbeatMs))); });
    };
    projTimer = unref(setTimeout(proj, Number(o.projectHeartbeatMs)));
  }
  return {
    start: connect,
    stop: async function () {
      state.stopped = true;
      clearAll();
      try { if (o.postEnd) await o.postEnd(o.gameId); } catch (e) { log('结束场次失败: ' + e.message); }
      try { if (ws) ws.close(); } catch (e) {}
      ws = null;
    },
    state: state,
    _feed: onData
  };
}

module.exports = { createSession: createSession, DEFAULTS: DEFAULTS, hostAllowed: hostAllowed, DEFAULT_ALLOW_HOSTS: DEFAULT_ALLOW_HOSTS };

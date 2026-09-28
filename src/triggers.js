'use strict';
// 输入触发器(F-20260925-02 切片 1, 2026-09-28): 把 VRChat 回传到头显端口的 OSC 参数(/avatar/parameters/*)
// 变成「开始说话 / 发送 / 取消」这类动作 —— 零覆盖层、零原生代码、任何头显都能用。
// 依据(实机数据见 docs/FEATURES/F-20260925-02-VR虚拟键盘-技术研究.md §9~§11):
//   · GestureLeft/GestureRight 是 0~7 的整数, **静音时照常上报**, 延迟约一帧(≈10ms);
//   · Voice 是 0~1 的**麦克风电平**(不是按键状态), 静音期间恒为 0 → 只能给不静音的玩家做「说话即听写」;
//   · Upright / AngularY(~90Hz)、Velocity*、头像自带的 GestureTail/Wing/Ahoge 是噪声, 默认忽略;
//   · MuteSelf 是干净 Bool → 用来「静音时暂停听写」。
// 设计原则: 默认关闭; **只监听, 不向 VRChat 发任何 OSC**; 端口冲突如实上报; 绑定靠「学习模式」由用户自己教(不猜设备)。
const { UDPPort } = require('osc');

const BUILTIN = ['Voice', 'GestureLeft', 'GestureRight', 'GestureLeftWeight', 'GestureRightWeight', 'MuteSelf', 'AFK', 'Seated', 'VRMode', 'Grounded', 'Viseme', 'Earmuffs', 'InStation'];
const NOISE = ['Upright', 'AngularY', 'VelocityX', 'VelocityY', 'VelocityZ', 'VelocityMagnitude', 'GestureTail', 'GestureWing', 'GestureAhoge', 'Viseme'];

// 预设只是"省一步"的便利: 学习模式永远能覆盖它们(索引/其它手柄靠学习, 见技术研究 §9.2)
const PRESETS = {
  quest3: { mode: 'gesture', bindings: { start: { param: 'GestureRight', eq: 1 }, cancel: { param: 'GestureLeft', eq: 1 } } },
  index: { mode: 'gesture', bindings: { start: { param: 'GestureRight', eq: 1 }, cancel: { param: 'GestureLeft', eq: 1 } } },   // 参数与 Quest 相同, 差别只在手感; 学习模式可改
  vad: { mode: 'vad', vad: { param: 'Voice', gte: 0.02, silenceMs: 400 } }
};

function num(v, def) { const n = Number(v); return isFinite(n) ? n : def; }
function clampPort(v) { const n = Math.round(num(v, 9001)); return n >= 1024 && n <= 65535 ? n : 9001; }
function normBinding(b) {
  if (!b || typeof b !== 'object') return null;
  const param = String(b.param || '').replace('/avatar/parameters/', '');
  if (!param) return null;
  const out = { param: param };
  if (typeof b.eq === 'boolean') out.eq = b.eq;
  else if (b.eq !== undefined && b.eq !== null && b.eq !== '') out.eq = num(b.eq, null);
  if (b.gte !== undefined) out.gte = num(b.gte, null);
  if (b.lte !== undefined) out.lte = num(b.lte, null);
  if (out.eq === undefined && out.gte === undefined && out.lte === undefined) out.eq = 1;
  return out;
}
function normCfg(raw) {
  const c = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const preset = PRESETS[c.preset] ? c.preset : 'quest3';
  const base = PRESETS[preset];
  const mode = (c.mode === 'vad' || c.mode === 'gesture') ? c.mode : base.mode;
  const cfg = {
    enabled: c.enabled === true,
    port: clampPort(c.port),
    preset: preset,
    mode: mode,
    pauseOnMute: c.pauseOnMute !== false,
    maxMs: Math.min(120000, Math.max(3000, Math.round(num(c.maxMs, 30000)))),
    ignore: Array.isArray(c.ignore) ? c.ignore.map(String) : NOISE.slice(),
    bindings: {
      start: normBinding((c.bindings && c.bindings.start) || (base.bindings && base.bindings.start) || null),
      cancel: normBinding((c.bindings && c.bindings.cancel) || (base.bindings && base.bindings.cancel) || null)
    },
    vad: {
      param: String(((c.vad && c.vad.param) || (base.vad && base.vad.param) || 'Voice')).replace('/avatar/parameters/', ''),
      gte: num((c.vad && c.vad.gte), (base.vad && base.vad.gte != null) ? base.vad.gte : 0.02),
      silenceMs: Math.min(5000, Math.max(150, Math.round(num((c.vad && c.vad.silenceMs), (base.vad && base.vad.silenceMs != null) ? base.vad.silenceMs : 400))))
    }
  };
  return cfg;
}

class TriggerEngine {
  constructor(opts) {
    opts = opts || {};
    this.logger = opts.logger || { info: function () {}, warn: function () {}, error: function () {} };
    this.onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : function () {};
    this.cfg = normCfg(opts.config);
    this.sock = null;
    this.error = null;
    this.values = {};
    this.avatarId = null;
    this.stats = { start: 0, send: 0, cancel: 0, blockedByMute: 0 };
    this.lastEvent = null;
    this.ptt = { active: false, since: 0, lastVoiceAt: 0 };
    this.learn = { on: false, until: 0, items: [] };
    // 语音活动窗口(2026-09-28, 用户反馈「会把环境里别人的话一起带进来」): Voice/Viseme 有活动就记一段,
    // 给「只保留我说话时的转写」做判据 —— 复用 VRChat 回传的信号, 不需要额外设备。
    this.speech = [];
    this.muteLog = [];
    this.timer = null;
  }
  // ---- 配置热更新(POST /api/triggers 用)----
  apply(patch) {
    const merged = Object.assign({}, this.cfg, patch || {});
    if (patch && patch.bindings) merged.bindings = Object.assign({}, this.cfg.bindings, patch.bindings);
    if (patch && patch.vad) merged.vad = Object.assign({}, this.cfg.vad, patch.vad);
    this.cfg = normCfg(merged);
    this.sync();
    return this.status();
  }
  sync() {
    if (this.cfg.enabled) this.openPort(); else this.closePort();
    this.syncTimer();
  }
  openPort() {
    if (this.sock && this.port === this.cfg.port) return;
    this.closePort();
    const self = this;
    this.port = this.cfg.port;
    try {
      const sock = new UDPPort({ localAddress: '127.0.0.1', localPort: this.cfg.port, metadata: true });
      sock.on('message', function (msg) { self.handle(msg); });
      sock.on('error', function (e) { self.error = String((e && e.message) || e); self.logger.warn('[触发器] OSC 监听出错: ' + self.error); });
      sock.open();
      this.sock = sock;
      this.error = null;
      this.logger.info('[触发器] 已监听 127.0.0.1:' + this.cfg.port + '(预设 ' + this.cfg.preset + ', 模式 ' + this.cfg.mode + ')');
    } catch (e) {
      this.error = String((e && e.message) || e);
      this.logger.error('[触发器] 监听 ' + this.cfg.port + ' 失败: ' + this.error);
    }
  }
  closePort() {
    if (this.sock) { try { this.sock.close(); } catch (e) {} }
    this.sock = null;
    this.port = null;
  }
  syncTimer() {
    const need = this.ptt.active;
    if (need && !this.timer) {
      const self = this;
      this.timer = setInterval(function () { self.tick(); }, 100);
    } else if (!need && this.timer) {
      clearInterval(this.timer); this.timer = null;
    }
  }
  // ---- 消息处理 ----
  handle(msg) {
    if (!msg || typeof msg.address !== 'string') return;
    if (msg.address === '/avatar/change') {
      const v = msg.args && msg.args[0] && msg.args[0].value;
      this.avatarId = v ? String(v) : null;
      this.logger.info('[触发器] 当前头像: ' + this.avatarId);
      return;
    }
    const m = /^\/avatar\/parameters\/(.+)$/.exec(msg.address);
    if (!m) return;
    const name = m[1];
    const raw = msg.args && msg.args[0] ? msg.args[0].value : null;
    const value = (typeof raw === 'number') ? Math.round(raw * 10000) / 10000 : raw;
    const prev = this.values[name];
    this.values[name] = value;
    if (prev === value) return;
    this.recordLearn(name, value);
    this.evaluate(name, value, prev);
  }
  ignored(name) { return this.cfg.ignore.indexOf(name) >= 0; }
  recordLearn(name, value) {
    if (!this.learn.on) return;
    if (Date.now() > this.learn.until) { this.learn.on = false; return; }
    if (this.ignored(name)) return;
    const type = typeof value;
    if (type !== 'boolean' && type !== 'number') return;                  // 只收 Bool / 数字(整数手势与权重)
    if (this.learn.items.some(function (x) { return x.param === name; })) return;
    this.learn.items.push({ param: name, value: value, at: Date.now() });
    if (this.learn.items.length > 30) this.learn.items.shift();
  }
  muted() { return this.cfg.pauseOnMute && this.values.MuteSelf === true; }
  match(b, name, value) {
    if (!b || b.param !== name) return false;
    if (b.eq !== undefined) return value === b.eq || (typeof b.eq === 'number' && Number(value) === b.eq);
    if (b.gte !== undefined && Number(value) < b.gte) return false;
    if (b.lte !== undefined && Number(value) > b.lte) return false;
    return true;
  }
  evaluate(name, value, prev) {
    const cfg = this.cfg;
    this.trackVoiceActivity(name, value);
    if (!cfg.enabled) return;
    // 静音保护: 静音时不开始(VAD 更是不可能触发), 已经在听则取消 —— 静音时不该在听
    if (this.muted()) {
      if (this.ptt.active) { this.stats.cancel++; this.fire('cancel', { param: 'MuteSelf', value: true, reason: '静音' }); }
      else if (prev !== value) { this.stats.blockedByMute++; }
      return;
    }
    if (cfg.mode === 'vad') {
      const v = Number(this.values[cfg.vad.param]);
      if (isFinite(v) && v >= cfg.vad.gte) {
        this.ptt.lastVoiceAt = Date.now();
        if (!this.ptt.active) this.fire('start', { param: cfg.vad.param, value: v });
      }
      return;
    }
    if (cfg.bindings.start && this.match(cfg.bindings.start, name, value)) { this.fire('start', { param: name, value: value }); return; }
    if (this.ptt.active && cfg.bindings.cancel && this.match(cfg.bindings.cancel, name, value)) { this.stats.cancel++; this.fire('cancel', { param: name, value: value }); return; }
    // 松开发送: 正在听, 且"开始绑定的那个参数"离开了它的触发值
    if (this.ptt.active && cfg.bindings.start && cfg.bindings.start.param === name) {
      if (!this.match(cfg.bindings.start, name, value)) { this.stats.send++; this.fire('send', { param: name, value: value }); }
    }
  }
  tick() {
    if (!this.ptt.active) return;
    const now = Date.now();
    if (now - this.ptt.since > this.cfg.maxMs) { this.stats.cancel++; this.fire('cancel', { param: null, value: null, reason: '超时' }); return; }
    if (this.cfg.mode === 'vad') {
      const v = Number(this.values[this.cfg.vad.param]);
      const quiet = !isFinite(v) || v < this.cfg.vad.gte;
      if (quiet && now - this.ptt.lastVoiceAt > this.cfg.vad.silenceMs) { this.stats.send++; this.fire('send', { param: this.cfg.vad.param, value: v }); }
    }
  }
  fire(type, extra) {
    const ev = Object.assign({ type: type, at: Date.now() }, extra || {});
    if (type === 'start') { if (!this.ptt.active) this.stats.start++; this.ptt.active = true; this.ptt.since = ev.at; this.ptt.lastVoiceAt = ev.at; this.syncTimer(); }
    else { this.ptt.active = false; this.syncTimer(); }
    this.lastEvent = ev;
    try { this.onEvent(ev); } catch (e) { this.logger.warn('[触发器] 事件处理失败: ' + e.message); }
    return ev;
  }
  // 自测/自检入口: 不走网络直接喂一条参数变化(供门禁断言与控制台"测试"按钮用)
  inject(name, value) {
    const nm = String(name || '').replace('/avatar/parameters/', '');
    this.handle({ address: '/avatar/parameters/' + nm, args: [{ value: value }] });
    return this.status();
  }
  learnStart(seconds) {
    const ms = Math.min(120000, Math.max(5000, Math.round(num(seconds, 20000))));
    this.learn = { on: true, until: Date.now() + ms, items: [] };
    return this.status();
  }
  learnStop() { this.learn.on = false; return this.status(); }
  // 语音活动: Voice 是麦克风电平(0~1), Viseme 是口型(只有自己说话才有) —— 任一有活动就记一段窗口
  trackVoiceActivity(name, value) {
    const now = Date.now();
    if (name === 'MuteSelf') { this.muteLog.push({ at: now, muted: value === true }); if (this.muteLog.length > 200) this.muteLog.shift(); return; }
    const active = (name === this.cfg.vad.param && Number(value) >= this.cfg.vad.gte) || (name === 'Viseme' && Number(value) > 0);
    if (!active) return;
    const last = this.speech[this.speech.length - 1];
    if (last && now - last.to <= 1500) { last.to = now; } else { this.speech.push({ from: now, to: now }); }
    if (this.speech.length > 200) this.speech.shift();
  }
  // 转写行的时间(当天 HH:MM:SS)是否落在「我在说话」的窗口里(留 2 秒宽容度)
  speechWindowsWithin(atMs) {
    return this.speech.filter(function (w) { return atMs >= w.from - 2000 && atMs <= w.to + 2000; });
  }
  // 这次说话期间我是不是静音过(静音时 VRChat 不上报 Voice/Viseme, 判据不可用 -> 不做过滤)
  mutedDuring(fromMs) {
    if (this.values.MuteSelf === true) return true;
    return this.muteLog.some(function (m) { return m.at >= fromMs && m.muted === true; });
  }
  status() {
    const self = this;
    const values = {};
    BUILTIN.concat(this.cfg.ignore).forEach(function (k) { if (self.values[k] !== undefined) values[k] = self.values[k]; });
    [this.cfg.bindings.start, this.cfg.bindings.cancel].forEach(function (b) { if (b && self.values[b.param] !== undefined) values[b.param] = self.values[b.param]; });
    return {
      enabled: this.cfg.enabled, listening: !!this.sock, port: this.port || this.cfg.port, error: this.error,
      preset: this.cfg.preset, mode: this.cfg.mode, bindings: this.cfg.bindings, vad: this.cfg.vad,
      pauseOnMute: this.cfg.pauseOnMute, maxMs: this.cfg.maxMs, ignore: this.cfg.ignore,
      values: values, muted: this.muted(), avatarId: this.avatarId,
      ptt: { active: this.ptt.active, sinceMs: this.ptt.active ? (Date.now() - this.ptt.since) : 0 },
      stats: this.stats, lastEvent: this.lastEvent,
      learn: { on: this.learn.on && Date.now() <= this.learn.until, remainingMs: Math.max(0, this.learn.until - Date.now()), items: this.learn.on ? this.learn.items : [] },
      presets: Object.keys(PRESETS), builtin: BUILTIN, noise: NOISE
    };
  }
  close() { this.closePort(); if (this.timer) { clearInterval(this.timer); this.timer = null; } }
}
module.exports = { TriggerEngine: TriggerEngine, PRESETS: PRESETS, BUILTIN: BUILTIN, NOISE: NOISE, normCfg: normCfg };

'use strict';
// 动作输出(反向 OSC, F-20260928-01 切片 1, 2026-09-28): 用**外部软件或我们自己的功能**驱动本机玩家的动作。
// 方向正好与 src/triggers.js 相反 —— 那个是 VRChat → 我们(读动作), 这个是 我们 → VRChat(写动作)。
// 官方通道: VRChat《OSC as Input Controller》(/input/*), 轴 float -1~1 / 按钮 int 1|0。
// 两条官方红线(必须由代码兜住):
//   ① **用完必须复位** —— 留一个 Vertical=1 会让人一直往前走, Jump 1 连发只跳一次;
//   ② 兼容性不确定(有些只在桌面/VR 某一模式有效) —— 所以"发了"只代表发出去了, 不代表游戏里一定发生。
// 我方边界(与既有红线一致): 只驱动**本机玩家自己**; 只做**人工触发、随时可断**; 不做自动化/挂机/脚本化;
//   默认**关闭**, 且外部软件调用要**再单独开一个开关**(allowLocalApi)。
const AXES = {
  Vertical: 1, Horizontal: 1, LookHorizontal: 1, UseAxisRight: 1, GrabAxisRight: 1,
  MoveHoldFB: 1, SpinHoldCwCcw: 1, SpinHoldUD: 1, SpinHoldLR: 1
};
const BUTTONS = {
  MoveForward: 1, MoveBackward: 1, MoveLeft: 1, MoveRight: 1, LookLeft: 1, LookRight: 1,
  Jump: 1, Run: 1, ComfortLeft: 1, ComfortRight: 1, DropLeft: 1, DropRight: 1,
  UseLeft: 1, UseRight: 1, GrabLeft: 1, GrabRight: 1, PanicButton: 1,
  QuickMenuToggleLeft: 1, QuickMenuToggleRight: 1, Voice: 1
};
const DEFAULTS = {
  enabled: false,          // 整个动作输出(默认关)
  allowLocalApi: false,    // 外部软件能不能通过本机接口调(默认关)
  maxRatePerSec: 5,        // 限速: 每秒最多几次(含复位)
  defaultHoldMs: 150,      // 按钮按下后多久自动松开
  maxHoldMs: 3000,         // 长按(hold:true)的硬上限, 到点强制复位
  axisResetMs: 300         // 轴推出去后多久自动归零(防"一直往前走")
};
function num(v, def) { const n = Number(v); return isFinite(n) ? n : def; }
function normCfg(raw) {
  const c = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  return {
    enabled: c.enabled === true,
    allowLocalApi: c.allowLocalApi === true,
    maxRatePerSec: Math.min(50, Math.max(1, Math.round(num(c.maxRatePerSec, DEFAULTS.maxRatePerSec)))),
    defaultHoldMs: Math.min(10000, Math.max(0, Math.round(num(c.defaultHoldMs, DEFAULTS.defaultHoldMs)))),
    maxHoldMs: Math.min(60000, Math.max(200, Math.round(num(c.maxHoldMs, DEFAULTS.maxHoldMs)))),
    axisResetMs: Math.min(10000, Math.max(50, Math.round(num(c.axisResetMs, DEFAULTS.axisResetMs))))
  };
}
class ActionSender {
  constructor(opts) {
    opts = opts || {};
    this.logger = opts.logger || { info: function () {}, warn: function () {}, error: function () {} };
    this.osc = opts.osc || null;                 // 注入 src/osc.js 的 OscSender(测试里可换成假的)
    this.cfg = normCfg(opts.config);
    this.held = new Map();                       // action -> {kind, value, since, timer, hold}
    this.sent = [];                              // 最近发送时间戳(限速用)
    this.stats = { total: 0, rejected: 0, resets: 0, lastAction: null, lastAt: 0, lastError: null };
  }
  apply(patch) {
    const merged = Object.assign({}, this.cfg, patch || {});
    const wasEnabled = this.cfg.enabled;
    this.cfg = normCfg(merged);
    if (wasEnabled && !this.cfg.enabled) this.resetAll('关闭动作输出');   // 关掉时必须收干净
    return this.status();
  }
  kindOf(name) {
    const n = String(name || '').replace('/input/', '');
    if (AXES[n]) return 'axis';
    if (BUTTONS[n]) return 'button';
    return null;
  }
  rateOk() {
    const now = Date.now();
    this.sent = this.sent.filter(function (t) { return now - t < 1000; });
    return this.sent.length < this.cfg.maxRatePerSec;
  }
  // 唯一的出口: 所有 OSC 都从这里发(便于测试替换 osc 与统计)
  raw(name, value, kind) {
    const n = String(name).replace('/input/', '');
    if (!this.osc) { this.stats.lastError = 'OSC 未注入'; return false; }
    const args = kind === 'axis' ? [{ type: 'f', value: value }] : [{ type: 'i', value: value }];
    const ok = this.osc.send('/input/' + n, args);
    this.sent.push(Date.now());
    this.stats.total++;
    this.stats.lastAction = n + '=' + value;
    this.stats.lastAt = Date.now();
    return ok;
  }
  // 供外部软件/我们自己的功能调用
  send(action, opts) {
    opts = opts || {};
    if (!this.cfg.enabled) return { ok: false, code: 403, error: '动作输出未启用(actions.enabled=false)' };
    if (opts.external && !this.cfg.allowLocalApi) return { ok: false, code: 403, error: '外部软件调用未开启(actions.allowLocalApi=false)' };
    const kind = this.kindOf(action);
    if (!kind) return { ok: false, code: 400, error: '不支持的动作: ' + action };
    const raw = (opts.value === undefined || opts.value === null) ? 1 : num(opts.value, 1);
    const value = kind === 'axis' ? Math.max(-1, Math.min(1, raw)) : (raw ? 1 : 0);
    if (!this.rateOk()) { this.stats.rejected++; return { ok: false, code: 429, error: '超过限速(' + this.cfg.maxRatePerSec + '/秒)' }; }
    const name = String(action).replace('/input/', '');
    this.raw(name, value, kind);
    // 复位安排(官方红线 ①)
    const prev = this.held.get(name);
    if (prev && prev.timer) clearTimeout(prev.timer);
    const holdMs = value === 0 ? 0 : Math.min(this.cfg.maxHoldMs, Math.max(0, Math.round(num(opts.holdMs, kind === 'axis' ? this.cfg.axisResetMs : this.cfg.defaultHoldMs))));
    const self = this;
    const rec = { kind: kind, value: value, since: Date.now(), hold: opts.hold === true, timer: null };
    if (value !== 0) {
      if (rec.hold) {
        // 长按: 到 maxHoldMs 强制复位(硬上限, 免得"忘了松手")
        rec.timer = setTimeout(function () { self.release(name, '到达长按上限'); }, this.cfg.maxHoldMs);
      } else if (holdMs > 0) {
        rec.timer = setTimeout(function () { self.release(name, '自动复位'); }, holdMs);
      }
      this.held.set(name, rec);
    } else {
      this.held.delete(name);
    }
    return { ok: true, action: name, kind: kind, value: value, autoResetMs: value === 0 ? 0 : (rec.hold ? this.cfg.maxHoldMs : holdMs) };
  }
  release(name, why) {
    const n = String(name).replace('/input/', '');
    const rec = this.held.get(n);
    if (!rec) return { ok: true, action: n, note: '本来就没按下' };
    if (rec.timer) clearTimeout(rec.timer);
    this.held.delete(n);
    this.raw(n, 0, rec.kind);
    this.stats.resets++;
    this.logger.info('[动作] 复位 ' + n + '(' + (why || 'release') + ')');
    return { ok: true, action: n, value: 0 };
  }
  // 一键收干净: 关闭/退出/异常时都走这里(绝不留下"一直往前走")
  resetAll(why) {
    const names = Array.from(this.held.keys());
    names.forEach((n) => { try { this.release(n, why || 'resetAll'); } catch (e) {} });
    this.held.clear();
    return { ok: true, released: names.length, why: why || 'resetAll' };
  }
  status() {
    const self = this;
    return {
      enabled: this.cfg.enabled, allowLocalApi: this.cfg.allowLocalApi,
      config: { maxRatePerSec: this.cfg.maxRatePerSec, defaultHoldMs: this.cfg.defaultHoldMs, maxHoldMs: this.cfg.maxHoldMs, axisResetMs: this.cfg.axisResetMs },
      held: Array.from(this.held.entries()).map(function (kv) { return { action: kv[0], kind: kv[1].kind, value: kv[1].value, heldMs: Date.now() - kv[1].since, hold: kv[1].hold }; }),
      stats: this.stats,
      actions: { axes: Object.keys(AXES), buttons: Object.keys(BUTTONS) }
    };
  }
  close() { this.resetAll('程序退出'); }
}
module.exports = { ActionSender: ActionSender, AXES: AXES, BUTTONS: BUTTONS, DEFAULTS: DEFAULTS, normCfg: normCfg };

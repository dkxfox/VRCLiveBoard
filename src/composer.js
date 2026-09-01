'use strict';
const { filterText } = require('./swearfilter');
class Composer {
  constructor(opts) {
    this.osc = opts.osc;
    this.logger = opts.logger;
    this.swearFilter = opts.swearFilter || null;
    this.maxChars = opts.maxChars || 144;
    this.minSendIntervalMs = opts.minSendIntervalMs || 1200;
    this.sources = [];
    this.transients = [];
    this.vars = {};
    this.current = null;
    this.vrcOn = false;
    this.vrcInfo = null;
    this.ocrState = null;
    this.ocrResult = null;
    this._lastText = null;
    this._lastSentAt = 0;
    this._timer = null;
  }
  registerSource(src) { this.sources.push(src); this.logger.info('数据源已注册: ' + src.id); }
  unregisterSource(id) {
    const idx = this.sources.findIndex(function (s) { return s.id === id; });
    if (idx >= 0) { this.sources.splice(idx, 1); this.logger.info('数据源已移除: ' + id); }
  }
  pushTransient(text, priority, ttlMs, force) {
    this.transients.push({ text: text, priority: priority || 80, ttlUntil: Date.now() + (ttlMs || 8000), force: !!force });
    this.logger.info('临时文本(优先级 ' + (priority || 80) + '): ' + text.slice(0, 40));
  }
  getContext() { return { vars: this.vars, now: new Date() }; }
  render(text) {
    if (text === null || text === undefined) return null;
    const self = this;
    return String(text).replace(/\{([a-z0-9_]+)\}/gi, function (m, name) {
      const v = self.vars[name];
      return (v === undefined || v === null) ? '' : String(v);
    });
  }
  truncate(s) {
    const chars = Array.from(s);
    if (chars.length <= this.maxChars) return s;
    return chars.slice(0, this.maxChars).join('');
  }
  start() { const self = this; this._timer = setInterval(function () { self.tick(); }, 1000); this.tick(); }
  stop() { if (this._timer) clearInterval(this._timer); }
  async tick() {
    const now = Date.now();
    for (const src of this.sources) {
      if (!src.enabled) continue;
      const interval = src.intervalMs || 2000;
      if (now - (src._lastPoll || 0) < interval) continue;
      src._lastPoll = now;
      try { src._cached = await src.getText(this.getContext()); src._pollError = null; } catch (e) { src._cached = null; src._pollError = String((e && e.message) || e); }
      if (src._cached !== null && src._cached !== undefined) src.lastText = src._cached;
    }
    this.transients = this.transients.filter(function (t) { return t.ttlUntil > now; });
    const cands = [];
    for (const src of this.sources) { if (src.enabled && src._cached) cands.push({ text: src._cached, priority: src.priority || 0, sourceId: src.id }); }
    for (const t of this.transients) cands.push({ text: t.text, priority: t.priority, sourceId: 'transient' });
    cands.sort(function (a, b) { return b.priority - a.priority; });
    if (!cands.length) return;
    let text = this.truncate(this.render(cands[0].text));
    if (this.swearFilter && this.swearFilter.enabled) text = filterText(text, this.swearFilter.words);
    if (!text) return;
    if (text === this._lastText) return;
    if (!cands[0].force && now - this._lastSentAt < this.minSendIntervalMs) return;
    const ok = this.osc.sendChatbox(text);
    if (ok) {
      this._lastText = text; this._lastSentAt = now;
      this.current = { text: text, sourceId: cands[0].sourceId, priority: cands[0].priority || 0, ttlUntil: cands[0].ttlUntil || 0, at: now };
      this.logger.info('[chatbox] (' + cands[0].sourceId + ') ' + JSON.stringify(text));
    }
  }
  status() {
    const self = this;
    return {
      current: this.current,
      ocrState: this.ocrState,
      ocrResult: this.ocrResult,
      vars: this.vars,
      sources: this.sources.map(function (s) {
        const o = { id: s.id, enabled: s.enabled, priority: s.priority, intervalMs: s.intervalMs, lastText: s.lastText || null, lastError: s._pollError || s.lastError || null };
        if (s.helperRunning !== undefined) o.helperRunning = s.helperRunning;
        if (s.lastRaw !== undefined) o.lastRaw = s.lastRaw;
        return o;
      }),
      transients: this.transients.length
    };
  }
}
module.exports = { Composer };

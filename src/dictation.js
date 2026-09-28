'use strict';
// 语音听写(切片 2, 2026-09-28): 常驻一个 PowerShell 助手(src/helpers/dictation.ps1), 它用 Windows 自带的
// 离线识别(System.Speech / SAPI)把麦克风里的话变成文字, 我们只做三件事: 起进程、发命令、收 JSON 行。
// 为什么常驻 + 文件命令: PowerShell + 识别引擎冷启动 1~3 秒, 而握拳就要立刻开始听 —— 常驻后每次只 Start/Stop(约 100~300ms);
//   命令走一个文件(logs/dictation.cmd), 避开 stdin 异步的坑(助手每 80ms 轮询一次)。
// 隐私: 只有收到 listen 才开麦克风, stop/取消/关闭程序都会立刻停; 助手不在时功能如实报不可用。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

class Dictation {
  constructor(opts) {
    opts = opts || {};
    this.logger = opts.logger || { info: function () {}, warn: function () {}, error: function () {} };
    this.projectDir = opts.projectDir || path.join(__dirname, '..');
    const cfg = (opts.config && typeof opts.config === 'object') ? opts.config : {};
    this.cfg = { enabled: cfg.enabled === true, engine: (cfg.engine === 'stub' ? 'stub' : 'sapi'), culture: String(cfg.culture || '') };
    this.proc = null;
    this.rl = null;
    this.cmdFile = path.join(this.projectDir, 'logs', 'dictation.cmd');
    this.helper = path.join(this.projectDir, 'src', 'helpers', 'dictation.ps1');
    this.available = false;
    this.listening = false;
    this.ready = false;
    this.buffer = '';
    this.partial = '';
    this.lastError = null;
    this.recognizer = null;
    this.onText = typeof opts.onText === 'function' ? opts.onText : function () {};
    this._stubTimer = null;
    this._waiters = [];
  }
  // 配置热更新(切片 2 只需 enabled/engine)
  apply(cfg) {
    const c = (cfg && typeof cfg === 'object') ? cfg : {};
    const wasEnabled = this.cfg.enabled;
    if (c.enabled !== undefined) this.cfg.enabled = c.enabled === true;
    if (c.engine !== undefined) this.cfg.engine = (c.engine === 'stub' ? 'stub' : 'sapi');
    if (c.culture !== undefined) this.cfg.culture = String(c.culture || '');
    if (this.cfg.enabled && !wasEnabled) this.warmup();
    if (!this.cfg.enabled && wasEnabled) this.close();
    return this.status();
  }
  status() {
    return {
      enabled: this.cfg.enabled, engine: this.cfg.engine, available: this.available, ready: this.ready,
      listening: this.listening, recognizer: this.recognizer, error: this.lastError,
      partial: this.partial, text: this.buffer, helper: path.relative(this.projectDir, this.helper)
    };
  }
  // ---- 进程管理 ----
  warmup() {
    if (!this.cfg.enabled) return;
    if (this.cfg.engine === 'stub') { this.available = true; this.ready = true; this.recognizer = 'stub(测试用)'; return; }
    if (this.proc) return;
    if (!fs.existsSync(this.helper)) { this.lastError = '找不到听写助手: ' + this.helper; this.logger.warn('[听写] ' + this.lastError); return; }
    const self = this;
    try { fs.mkdirSync(path.dirname(this.cmdFile), { recursive: true }); fs.writeFileSync(this.cmdFile, 'idle', 'utf8'); } catch (e) {}
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.helper, '-CommandFile', this.cmdFile];
    if (this.cfg.culture) args.push('-Culture', this.cfg.culture);
    try {
      this.proc = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { this.lastError = '启动听写助手失败: ' + e.message; this.logger.warn('[听写] ' + this.lastError); return; }
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', function (line) { self.readLine(line); });
    this.proc.stderr.on('data', function (d) { const s = String(d).trim(); if (s) self.logger.warn('[听写] 助手 stderr: ' + s.slice(0, 200)); });
    this.proc.on('exit', function (code) {
      self.logger.info('[听写] 助手已退出(code=' + code + ')');
      self.proc = null; self.ready = false; self.available = false; self.listening = false;
    });
  }
  readLine(line) {
    const s = String(line || '').trim();
    if (!s || s[0] !== '{') return;
    let j = null;
    try { j = JSON.parse(s); } catch (e) { return; }
    if (j.type === 'status') {
      if (j.state === 'ready') { this.ready = true; this.available = true; this.recognizer = j.recognizer || this.recognizer; this.lastError = null; this.logger.info('[听写] 就绪: ' + (j.recognizer || '?') + ' (' + (j.culture || '?') + ')'); }
      else if (j.state === 'listening') { this.listening = true; }
      else if (j.state === 'stopping') { this.listening = false; }
      else if (j.state === 'idle') { this.listening = false; this.flushWaiters(); }
      else if (j.state === 'error') { this.lastError = j.error || '未知错误'; this.available = false; this.logger.warn('[听写] ' + this.lastError); this.flushWaiters(); }
    } else if (j.type === 'text') {
      if (j.final) { this.buffer += String(j.text || ''); this.partial = ''; try { this.onText(String(j.text || ''), true); } catch (e) {} this.flushWaiters(); }
      else { this.partial = String(j.text || ''); try { this.onText(this.partial, false); } catch (e) {} }
    }
  }
  flushWaiters() { const w = this._waiters; this._waiters = []; w.forEach(function (f) { try { f(); } catch (e) {} }); }
  // ---- 对外动作 ----
  start() {
    if (!this.cfg.enabled) return { ok: false, error: '听写未启用' };
    this.buffer = ''; this.partial = '';
    if (this.cfg.engine === 'stub') {
      const self = this;
      this.listening = true;
      clearTimeout(this._stubTimer);
      this._stubTimer = setTimeout(function () { self.buffer = '听写测试文本'; self.partial = ''; self.listening = false; self.flushWaiters(); }, 300);
      return { ok: true };
    }
    if (!this.proc) this.warmup();
    if (!this.proc) return { ok: false, error: this.lastError || '听写助手未运行' };
    this.writeCmd('listen');
    return { ok: true };
  }
  // 停止并等一小会儿拿最终结果(识别引擎需要时间把最后一句收尾)
  stop(graceMs) {
    const self = this;
    const wait = Math.max(0, Math.min(5000, Number(graceMs) || 0));
    if (this.cfg.engine === 'stub') {
      return new Promise(function (resolve) { setTimeout(function () { self.listening = false; resolve({ text: self.buffer, partial: self.partial }); }, Math.min(400, wait || 400)); });
    }
    if (!this.proc) return Promise.resolve({ text: this.buffer, partial: this.partial });
    this.writeCmd('stop');
    if (!wait) return Promise.resolve({ text: this.buffer, partial: this.partial });
    return new Promise(function (resolve) {
      let done = false;
      const finish = function () { if (done) return; done = true; resolve({ text: self.buffer, partial: self.partial }); };
      self._waiters.push(finish);
      setTimeout(finish, wait);
    });
  }
  writeCmd(cmd) {
    try { fs.writeFileSync(this.cmdFile, String(cmd), 'utf8'); } catch (e) { this.logger.warn('[听写] 写命令失败: ' + e.message); }
  }
  close() {
    clearTimeout(this._stubTimer);
    this.listening = false;
    if (!this.proc) return;
    const p = this.proc;
    this.writeCmd('quit');
    setTimeout(function () { try { if (p && !p.killed) p.kill(); } catch (e) {} }, 700);
  }
}
module.exports = { Dictation: Dictation };

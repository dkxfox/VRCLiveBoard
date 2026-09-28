'use strict';
// 语音听写(切片 2, 2026-09-28): 把"握拳 -> 说话 -> 松手"之间的语音变成文字, 交给聊天框。
// 三个引擎(按精度/依赖从好到差):
//   · livetranslate: **复用已装的 LiveTranslate**(SenseVoice ASR, 精度最好) —— 读它的 _original.txt(原文, 不是译文),
//     只在 start/stop 之间新增的那些行算这次说的话。要求用户在 LiveTranslate 里把输入设备选成**麦克风**。
//   · sapi: Windows 自带离线识别(System.Speech), **零安装**但中文精度一般(用户实机反馈"不好用", 故默认不选它)。
//   · stub: 测试引擎(不出声, 固定文本), 供门禁与自检用。
// 命令通道(2026-09-28 修): 追加式命令日志 + 助手记已处理行数 —— 旧的"反复写同一个文件"会丢命令,
//   表现是"只能识别第一句话"。详见 src/helpers/dictation.ps1 顶部注释。
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const ENGINES = ['livetranslate', 'sapi', 'stub'];

class Dictation {
  constructor(opts) {
    opts = opts || {};
    this.logger = opts.logger || { info: function () {}, warn: function () {}, error: function () {} };
    this.projectDir = opts.projectDir || path.join(__dirname, '..');
    const cfg = (opts.config && typeof opts.config === 'object') ? opts.config : {};
    this.cfg = { enabled: cfg.enabled === true, engine: 'sapi', culture: String(cfg.culture || ''), transcriptsDir: String(cfg.transcriptsDir || '') };
    if (cfg.engine === 'stub' || cfg.engine === 'livetranslate' || cfg.engine === 'sapi') this.cfg.engine = cfg.engine;
    this.proc = null; this.rl = null;
    this.cmdFile = path.join(this.projectDir, 'logs', 'dictation.cmd');
    this.helper = path.join(this.projectDir, 'src', 'helpers', 'dictation.ps1');
    this.available = false; this.ready = false; this.listening = false;
    this.buffer = ''; this.partial = ''; this.lastError = null; this.recognizer = null;
    this.cmds = 0;                    // 助手实际执行过的命令数(用来验证命令通道不丢命令)
    this.onText = typeof opts.onText === 'function' ? opts.onText : function () {};
    this._stubTimer = null; this._waiters = []; this._lt = null;
  }
  apply(cfg) {
    const c = (cfg && typeof cfg === 'object') ? cfg : {};
    const wasEnabled = this.cfg.enabled, wasEngine = this.cfg.engine;
    if (c.enabled !== undefined) this.cfg.enabled = c.enabled === true;
    if (c.engine !== undefined && ENGINES.indexOf(c.engine) >= 0) this.cfg.engine = c.engine;
    if (c.culture !== undefined) this.cfg.culture = String(c.culture || '');
    if (c.transcriptsDir !== undefined) this.cfg.transcriptsDir = String(c.transcriptsDir || '');
    if (this.cfg.enabled && (!wasEnabled || wasEngine !== this.cfg.engine)) { this.closeHelper(); this.warmup(); }
    else if (!this.cfg.enabled && wasEnabled) this.close();
    return this.status();
  }
  status() {
    return {
      enabled: this.cfg.enabled, engine: this.cfg.engine, available: this.available, ready: this.ready,
      listening: this.listening, recognizer: this.recognizer, error: this.lastError, cmds: this.cmds,
      partial: this.partial, text: this.buffer, helper: path.relative(this.projectDir, this.helper),
      transcriptsDir: this.cfg.transcriptsDir || null
    };
  }
  // ---- LiveTranslate 引擎: 找最新转写文件, 记住读到的位置 ----
  ltDir() {
    if (this.cfg.transcriptsDir) return this.cfg.transcriptsDir;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(this.projectDir, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
      const d = c && c.sources && c.sources.livetranslate && c.sources.livetranslate.transcriptsDir;
      if (d) return String(d);
    } catch (e) {}
    return '';
  }
  ltNewest() {
    const dir = this.ltDir();
    if (!dir || !fs.existsSync(dir)) return null;
    let best = null;
    try {
      fs.readdirSync(dir).forEach(function (n) {
        if (!/^livetrans_.*_original\.txt$/.test(n)) return;
        const p = path.join(dir, n);
        const st = fs.statSync(p);
        if (!best || st.mtimeMs > best.mtimeMs) best = { file: p, size: st.size, mtimeMs: st.mtimeMs };
      });
    } catch (e) { return null; }
    return best;
  }
  // ---- 进程管理(SAPI 引擎才需要) ----
  warmup() {
    if (!this.cfg.enabled) return;
    if (this.cfg.engine === 'stub') { this.available = true; this.ready = true; this.recognizer = 'stub(测试用)'; return; }
    if (this.cfg.engine === 'livetranslate') {
      const n = this.ltNewest();
      this.available = !!n;
      this.ready = !!n;
      this.recognizer = n ? ('LiveTranslate (' + path.basename(n.file) + ')') : null;
      this.lastError = n ? null : ('没找到 LiveTranslate 的转写文件: ' + (this.ltDir() || '(未配置目录)'));
      if (!n) this.logger.warn('[听写] ' + this.lastError);
      else this.logger.info('[听写] 复用 LiveTranslate: ' + n.file);
      return;
    }
    if (this.proc) return;
    if (!fs.existsSync(this.helper)) { this.lastError = '找不到听写助手: ' + this.helper; this.logger.warn('[听写] ' + this.lastError); return; }
    const self = this;
    try { fs.mkdirSync(path.dirname(this.cmdFile), { recursive: true }); fs.writeFileSync(this.cmdFile, '', 'utf8'); } catch (e) {}
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.helper, '-CommandFile', this.cmdFile];
    if (this.cfg.culture) args.push('-Culture', this.cfg.culture);
    try { this.proc = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { this.lastError = '启动听写助手失败: ' + e.message; this.logger.warn('[听写] ' + this.lastError); return; }
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
      if (j.cmd) this.cmds++;
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
    if (this.cfg.engine === 'livetranslate') {
      const n = this.ltNewest();
      if (!n) { this.warmup(); return { ok: false, error: this.lastError || '没有可用的转写文件' }; }
      this._lt = { file: n.file, size: n.size, at: Date.now() };
      this.listening = true;
      this.available = true; this.ready = true; this.lastError = null;
      return { ok: true };
    }
    if (!this.proc) this.warmup();
    if (!this.proc) return { ok: false, error: this.lastError || '听写助手未运行' };
    this.writeCmd('listen');
    return { ok: true };
  }
  stop(graceMs) {
    const self = this;
    const wait = Math.max(0, Math.min(5000, Number(graceMs) || 0));
    if (this.cfg.engine === 'stub') {
      return new Promise(function (resolve) { setTimeout(function () { self.listening = false; resolve({ text: self.buffer, partial: self.partial }); }, Math.min(400, wait || 400)); });
    }
    if (this.cfg.engine === 'livetranslate') {
      // 宽限期: ASR 可能在我们松手之后才把那句写进文件(实测 LiveTranslate 有 1~3 秒延迟)
      return new Promise(function (resolve) {
        const grab = function () { const t = self.readLtTail(); self.listening = false; resolve({ text: t, partial: self.partial }); };
        if (wait) setTimeout(grab, Math.min(wait, 2500)); else grab();
      });
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
  // 读 LiveTranslate 转写文件里"这次说话"新增的部分: 形如 "[11:04:07] 文本"
  readLtTail() {
    const lt = this._lt;
    if (!lt) return '';
    let text = '';
    try {
      const st = fs.statSync(lt.file);
      const from = st.size >= lt.size ? lt.size : 0;   // 文件被轮转/截断就整读
      const fd = fs.openSync(lt.file, 'r');
      const len = Math.max(0, st.size - from);
      const buf = Buffer.alloc(len);
      let read = 0;
      while (read < len) read += fs.readSync(fd, buf, read, len - read, from + read);
      fs.closeSync(fd);
      text = buf.toString('utf8');
    } catch (e) { return ''; }
    const out = [];
    String(text).split(/\r?\n/).forEach(function (line) {
      const m = /^\s*\[?\d{0,2}:?\d{2}:?\d{2}\]?\s*(.*)$/.exec(line);
      const t = (m ? m[1] : line).trim();
      if (t) out.push(t);
    });
    return out.join('');
  }
  writeCmd(cmd) {
    try { fs.appendFileSync(this.cmdFile, String(cmd) + '\n', 'utf8'); } catch (e) { this.logger.warn('[听写] 写命令失败: ' + e.message); }
  }
  closeHelper() {
    if (!this.proc) return;
    const p = this.proc;
    this.writeCmd('quit');
    setTimeout(function () { try { if (p && !p.killed) p.kill(); } catch (e) {} }, 700);
    this.proc = null; this.ready = false; this.listening = false;
  }
  close() { clearTimeout(this._stubTimer); this.listening = false; this.closeHelper(); }
}
module.exports = { Dictation: Dictation, ENGINES: ENGINES };

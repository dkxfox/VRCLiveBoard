'use strict';
// Main-app mixer manager: owns the C# mixer engine, config, start/stop, cue and telemetry.
// This is the M2 path; it no longer depends on the virtual-mixer plugin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ENGINE = path.join(__dirname, 'mixer', 'engine', 'VirtualMixerEngine.exe');
const DATA_DIR = path.join(os.tmpdir(), 'vrcliveboard-mixer');

const DEFAULTS = {
  enabled: false,
  masterOutputDevice: '',
  systemCaptureDevice: '__none__',
  micCaptureDevice: '',
  customCaptureDevice: '',
  micGainDb: 4,
  musicGain: 0.72,
  systemGain: 1,
  systemMuted: false,
  micMuted: false,
  customMuted: false,
  systemSolo: false,
  micSolo: false,
  customSolo: false,
  duckEnabled: true,
  duckDepthDb: -15,
  duckThresholdDb: -35,
  duckAttackMs: 45,
  duckReleaseMs: 600,
  duckHoldMs: 650,
  duckLookaheadMs: 8,
  sidechainHpfHz: 120,
  cueDuck: false,
  cueLeadMs: 500
};

function cleanAudioPath(raw) {
  var p = String(raw == null ? '' : raw).trim();
  if (p.length >= 2 && ((p[0] === '"' && p[p.length - 1] === '"') || (p[0] === "'" && p[p.length - 1] === "'"))) p = p.slice(1, -1).trim();
  if (/^file:\/\//i.test(p)) { try { p = decodeURIComponent(p.replace(/^file:\/\/\/?/i, '')); } catch (e) {} }
  return p;
}

function clamp(v, lo, hi) { var n = Number(v); if (!isFinite(n)) return null; return Math.max(lo, Math.min(hi, n)); }

class MixerManager {
  constructor(opts) {
    this.config = opts.config || {};
    this.saveConfig = opts.save || function () {};
    this.logger = opts.logger || console;
    this.liveChild = null;
    this.cueChild = null;
    this.cueInfo = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!this.config.mixer || typeof this.config.mixer !== 'object') this.config.mixer = {};
    this._normalize();
  }

  _normalize() {
    var c = this.config.mixer;
    for (var k in DEFAULTS) if (c[k] === undefined) c[k] = DEFAULTS[k];
    c.enabled = !!c.enabled;
    c.micGainDb = clamp(c.micGainDb, -24, 24) || 4;
    c.musicGain = clamp(c.musicGain, 0, 2); if (c.musicGain === null) c.musicGain = 0.72;
    c.systemGain = clamp(c.systemGain, 0, 2); if (c.systemGain === null) c.systemGain = 1;
    c.duckDepthDb = clamp(c.duckDepthDb, -60, 0); if (c.duckDepthDb === null) c.duckDepthDb = -15;
    c.duckThresholdDb = clamp(c.duckThresholdDb, -80, -5); if (c.duckThresholdDb === null) c.duckThresholdDb = -35;
    c.duckAttackMs = clamp(c.duckAttackMs, 1, 500) || 45;
    c.duckReleaseMs = clamp(c.duckReleaseMs, 10, 5000) || 600;
    c.duckHoldMs = clamp(c.duckHoldMs, 0, 3000); if (c.duckHoldMs === null) c.duckHoldMs = 650;
    c.duckLookaheadMs = clamp(c.duckLookaheadMs, 0, 50); if (c.duckLookaheadMs === null) c.duckLookaheadMs = 8;
    c.sidechainHpfHz = clamp(c.sidechainHpfHz, 20, 400) || 120;
    c.cueDuck = !!c.cueDuck;
    c.cueLeadMs = clamp(c.cueLeadMs, 0, 5000); if (c.cueLeadMs === null) c.cueLeadMs = 500;
    c.systemCaptureDevice = c.systemCaptureDevice || '__none__';
    return c;
  }

  getConfig() { return Object.assign({}, this._normalize()); }

  setConfig(patch) {
    if (!patch || typeof patch !== 'object') return this.getConfig();
    var c = this.config.mixer;
    Object.keys(DEFAULTS).forEach(function (k) { if (patch[k] !== undefined) c[k] = patch[k]; });
    this._normalize();
    this.saveConfig();
    return this.getConfig();
  }

  _runShort(args, timeoutMs) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var child;
      try { child = spawn(ENGINE, args, { windowsHide: true, stdio: 'ignore' }); }
      catch (e) { return reject(e); }
      var timer = setTimeout(function () { try { child.kill(); } catch (e) {} reject(new Error('ENGINE_TIMEOUT')); }, timeoutMs || 15000);
      child.on('error', function (e) { clearTimeout(timer); reject(e); });
      child.on('exit', function (code) { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('ENGINE_EXIT_' + code)); });
    });
  }

  async devices() {
    var out = path.join(DATA_DIR, 'devices-' + Date.now() + '.json');
    await this._runShort(['--list-devices', out], 15000);
    return JSON.parse(await fs.promises.readFile(out, 'utf8'));
  }

  status() {
    return { ok: true, engine: { path: ENGINE, exists: fs.existsSync(ENGINE) }, running: !!(this.liveChild && this.liveChild.exitCode === null), config: this.getConfig(), cue: this.cueInfo ? { running: !!(this.cueChild && this.cueChild.exitCode === null), files: this.cueInfo.files, startedAt: this.cueInfo.startedAt } : null };
  }

  async start() {
    var c = this.getConfig();
    if (!c.masterOutputDevice) throw new Error('NO_OUTPUT_DEVICE');
    if (!c.micCaptureDevice) throw new Error('NO_MIC_DEVICE');
    this.stop();
    var cfg = {
      output: c.masterOutputDevice, capture: c.systemCaptureDevice || '__none__', mic: c.micCaptureDevice, custom: c.customCaptureDevice || '',
      micGainDb: c.micGainDb, musicGain: c.musicGain, systemGain: c.systemGain,
      systemMuted: c.systemMuted, micMuted: c.micMuted, customMuted: c.customMuted,
      systemSolo: c.systemSolo, micSolo: c.micSolo, customSolo: c.customSolo,
      duckEnabled: c.duckEnabled, duckDepthDb: c.duckDepthDb, duckThresholdDb: c.duckThresholdDb,
      duckAttackMs: c.duckAttackMs, duckReleaseMs: c.duckReleaseMs, duckHoldMs: c.duckHoldMs,
      duckLookaheadMs: c.duckLookaheadMs, sidechainHpfHz: c.sidechainHpfHz,
      status: path.join(DATA_DIR, 'live-status.json')
    };
    var cfgPath = path.join(DATA_DIR, 'live-config.json');
    await fs.promises.writeFile(cfgPath, JSON.stringify(cfg), 'utf8');
    var child = spawn(ENGINE, ['--run', cfgPath], { windowsHide: true, stdio: 'ignore' });
    this.liveChild = child;
    var self = this;
    child.on('exit', function () { if (self.liveChild === child) self.liveChild = null; });
    await new Promise(function (r) { setTimeout(r, 500); });
    if (child.exitCode !== null && child.exitCode !== undefined) { this.liveChild = null; throw new Error('LIVE_ENGINE_EXIT_' + child.exitCode); }
    c.enabled = true;
    this.saveConfig();
    return { ok: true, running: true, config: c };
  }

  stop() {
    if (this.liveChild) { try { this.liveChild.kill(); } catch (e) {} this.liveChild = null; }
    var c = this.getConfig(); c.enabled = false; this.saveConfig();
    return { ok: true, running: false };
  }

  async meter() {
    var running = !!(this.liveChild && this.liveChild.exitCode === null);
    try { return { ok: true, running: running, data: JSON.parse(await fs.promises.readFile(path.join(DATA_DIR, 'live-status.json'), 'utf8')) }; }
    catch (e) { return { ok: true, running: running, data: null }; }
  }

  stopCue() { if (this.cueChild) { try { this.cueChild.kill(); } catch (e) {} this.cueChild = null; } }

  async cue(args) {
    args = args || {};
    var files = Array.isArray(args.files) ? args.files : [];
    if (!files.length) throw new Error('NO_CUE_FILES');
    var c = this.getConfig();
    if (!c.masterOutputDevice) throw new Error('NO_OUTPUT_DEVICE');
    this.stopCue();
    var status = path.join(DATA_DIR, 'cue-status.json');
    var cargs = ['--cue', c.masterOutputDevice, String(args.leadMs === undefined ? c.cueLeadMs : args.leadMs), status];
    var infoFiles = [];
    files.forEach(function (f) {
      var p = cleanAudioPath(f && f.path || f || '');
      if (!/\.(wav|mp3|flac|aiff?|wma)$/i.test(p)) throw new Error('UNSUPPORTED_FILE: ' + p);
      if (!fs.existsSync(p)) throw new Error('FILE_NOT_FOUND: ' + p);
      cargs.push(p); cargs.push(String(f && typeof f.gainDb === 'number' ? f.gainDb : 0)); infoFiles.push(p);
    });
    if (args.duck || c.cueDuck) {
      cargs.push('--duck'); cargs.push(c.micCaptureDevice || '');
      cargs.push(String(c.duckDepthDb)); cargs.push(String(c.duckThresholdDb));
      cargs.push(String(c.duckAttackMs)); cargs.push(String(c.duckReleaseMs));
      cargs.push(String(c.duckHoldMs)); cargs.push(String(c.duckLookaheadMs)); cargs.push(String(c.sidechainHpfHz));
    }
    var child = spawn(ENGINE, cargs, { windowsHide: true, stdio: 'ignore' });
    this.cueChild = child; this.cueInfo = { files: infoFiles, startedAt: Date.now() };
    var self = this;
    child.on('exit', function () { if (self.cueChild === child) self.cueChild = null; });
    await new Promise(function (r) { setTimeout(r, 250); });
    if (child.exitCode !== null && child.exitCode !== undefined) { this.cueChild = null; throw new Error('CUE_ENGINE_EXIT_' + child.exitCode); }
    return { ok: true, startedAt: this.cueInfo.startedAt, files: infoFiles, leadMs: Number(args.leadMs === undefined ? c.cueLeadMs : args.leadMs) };
  }

  cueStop() { this.stopCue(); return { ok: true, running: false, files: this.cueInfo ? this.cueInfo.files : [] }; }
  cueClear() { this.stopCue(); this.cueInfo = null; return { ok: true, running: false, files: [] }; }

  async cueStatus() {
    var running = !!(this.cueChild && this.cueChild.exitCode === null);
    var data = null;
    try { data = JSON.parse(await fs.promises.readFile(path.join(DATA_DIR, 'cue-status.json'), 'utf8')); } catch (e) {}
    return { ok: true, running: running, files: this.cueInfo ? this.cueInfo.files : [], startedAt: this.cueInfo ? this.cueInfo.startedAt : null, data: data };
  }

  async latencyTest() {
    var out = path.join(DATA_DIR, 'latency-' + Date.now() + '.json');
    await this._runShort(['--latency-test', '3', out], 15000);
    return JSON.parse(await fs.promises.readFile(out, 'utf8'));
  }

  dispose() { this.stop(); this.stopCue(); }
}

module.exports = { MixerManager: MixerManager };

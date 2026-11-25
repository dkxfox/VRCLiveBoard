'use strict';
// 虚拟混音台插件 S1 骨架。
// 实时引擎、采集、闪避、A/B-VU 页面在后续切片接入；本切片只暴露设备枚举与离线 selftest。
const path = require('path');
const fs = require('fs');

let ctx = null;
let engineChild = null;
let liveChild = null;
let seq = 0;

function enginePath() { return path.join(__dirname, 'engine', 'VirtualMixerEngine.exe'); }

function runEngine(args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const outPath = args[args.length - 1];
    let child;
    try { child = ctx.exec.run(enginePath(), args); } catch (e) { return reject(new Error('ENGINE_START_FAILED: ' + e.message)); }
    engineChild = child;
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      try { child.kill(); } catch (e) {}
      reject(new Error('ENGINE_TIMEOUT'));
    }, timeoutMs || 20000);
    child.on('error', function (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new Error('ENGINE_ERROR: ' + e.message));
    });
    child.on('exit', function (code) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      engineChild = null;
      if (code === 0) resolve(code);
      else reject(new Error('ENGINE_EXIT_' + code));
    });
  });
}

function configPath() { return path.join(__dirname, 'data', 'live-config.json'); }

function num(v, fallback) { const n = Number(v); return isFinite(n) ? n : fallback; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function bool(v, fallback) { return typeof v === 'undefined' ? fallback : !!v; }

function buildLiveConfig() {
  const c = ctx.config || {};
  return {
    output: String(c.masterOutputDevice || ''),
    capture: String(c.systemCaptureDevice || ''),
    mic: String(c.micCaptureDevice || ''),
    custom: String(c.customCaptureDevice || ''),
    micGainDb: clamp(num(c.micGainDb, 4), -24, 24),
    musicGain: clamp(num(c.musicGain, 0.72), 0, 2),
    systemGain: clamp(num(c.systemGain, 1), 0, 2),
    duckEnabled: bool(c.duckEnabled, true),
    duckDepthDb: clamp(num(c.duckDepthDb, -15), -60, 0),
    duckThresholdDb: clamp(num(c.duckThresholdDb, -35), -80, -5),
    duckAttackMs: clamp(num(c.duckAttackMs, 45), 1, 500),
    duckReleaseMs: clamp(num(c.duckReleaseMs, 600), 10, 5000),
    duckHoldMs: clamp(num(c.duckHoldMs, 650), 0, 3000),
    duckLookaheadMs: clamp(num(c.duckLookaheadMs, 8), 0, 50),
    sidechainHpfHz: clamp(num(c.sidechainHpfHz, 120), 20, 400),
    status: path.join(__dirname, 'data', 'live-status.json')
  };
}

function liveStatusPath() { return path.join(__dirname, 'data', 'live-status.json'); }

function stopLive() {
  if (liveChild) { try { liveChild.kill(); } catch (e) {} liveChild = null; }
}

async function startLive() {
  if (!fs.existsSync(enginePath())) throw new Error('NO_ENGINE: build plugins/virtual-mixer/engine/build.bat first');
  const cfg = buildLiveConfig();
  if (!cfg.output) throw new Error('NO_OUTPUT_DEVICE: 先在插件设置里填 masterOutputDevice(如 CABLE Input)');
  if (!cfg.mic) throw new Error('NO_MIC_DEVICE: 先在插件设置里填 micCaptureDevice');
  stopLive();
  await ctx.fs.write(configPath(), JSON.stringify(cfg));
  let child;
  try { child = ctx.exec.run(enginePath(), ['--run', configPath()]); }
  catch (e) { throw new Error('LIVE_START_FAILED: ' + e.message); }
  liveChild = child;
  child.on('exit', function () { if (liveChild === child) liveChild = null; });
  await new Promise(function (r) { setTimeout(r, 500); });
  if (child.exitCode !== null && child.exitCode !== undefined) { liveChild = null; throw new Error('LIVE_ENGINE_EXIT_' + child.exitCode); }
  return { ok: true, running: true, config: cfg };
}

function tempPath(ext) {
  seq += 1;
  const dir = path.join(__dirname, 'data');
  return path.join(dir, 'mixer-' + Date.now() + '-' + seq + ext);
}

function readJson(p) {
  try { return JSON.parse(ctx.fs.read(p)); }
  catch (e) { throw new Error('ENGINE_BAD_OUTPUT: ' + e.message); }
}

module.exports = function (c) {
  ctx = c;
  return {
    apply: function () {
      if (ctx.config && ctx.config.autoStart) {
        startLive().catch(function (e) { if (ctx.logger && ctx.logger.warn) ctx.logger.warn('[虚拟混音台] 自动启动失败: ' + e.message); });
      }
    },
    dispose: function () {
      stopLive();
      if (engineChild) { try { engineChild.kill(); } catch (e) {} engineChild = null; }
    },
    api: {
      status: function () {
        let exists = false;
        try { exists = fs.existsSync(enginePath()); } catch (e) {}
        return {
          ok: true,
          stage: 'S3',
          running: !!(liveChild && liveChild.exitCode === null),
          engine: { path: enginePath(), exists: exists, version: '0.5.0' },
          channels: [
            { id: 'system', name: '系统声音', denoise: 'off', compressor: 'off' },
            { id: 'mic', name: '麦克风', denoise: 'off', compressor: 'off' },
            { id: 'custom-1', name: '自定义 1', denoise: 'off', compressor: 'off' }
          ]
        };
      },
      engineVersion: function () { return { ok: true, version: '0.4.1', naudio: '1.10.0' }; },
      devices: async function () {
        if (!fs.existsSync(enginePath())) throw new Error('NO_ENGINE: build plugins/virtual-mixer/engine/build.bat first');
        const out = tempPath('.json');
        await ctx.fs.write(out, '{}');
        await runEngine(['--list-devices', out], 20000);
        return readJson(out);
      },
      setup: async function () {
        if (!fs.existsSync(enginePath())) throw new Error('NO_ENGINE: build plugins/virtual-mixer/engine/build.bat first');
        const out = tempPath('.json');
        await ctx.fs.write(out, '{}');
        await runEngine(['--list-devices', out], 20000);
        const dev = readJson(out);
        const render = (dev.render || []).find(function (d) { return /cable input|voicemeeter.*input/i.test(d.name || ''); }) || null;
        const capture = (dev.capture || []).find(function (d) { return /cable output|voicemeeter.*output/i.test(d.name || ''); }) || null;
        return {
          ok: true,
          installed: !!(render && capture),
          render: render,
          capture: capture,
          guideUrl: 'https://vb-audio.com/Cable/',
          steps: [
            '安装 VB-CABLE（官方安装程序，需管理员/UAC）并重启 Windows',
            '插件检测到 CABLE Input（播放端）与 CABLE Output（录音端）',
            '本插件输出选 CABLE Input；VRChat 麦克风选 CABLE Output',
            '先在 VRChat 内说话确认麦克风有电平，再开音乐测试讲话闪避'
          ]
        };
      },
      captureTest: async function (args) {
        args = args || {};
        const seconds = Math.max(0.5, Math.min(30, Number(args.seconds) || 2));
        const render = String(args.render || ctx.config.masterOutputDevice || '');
        const mic = String(args.mic || ctx.config.micCaptureDevice || '');
        if (!fs.existsSync(enginePath())) throw new Error('NO_ENGINE: build plugins/virtual-mixer/engine/build.bat first');
        const wav = tempPath('.wav');
        const json = tempPath('.json');
        await ctx.fs.write(wav, '');
        await ctx.fs.write(json, '{}');
        await runEngine(['--capture-test', wav, String(seconds), render, mic, json], Math.round((seconds + 15) * 1000));
        return readJson(json);
      },
      duckSelftest: async function () {
        if (!fs.existsSync(enginePath())) throw new Error('NO_ENGINE: build plugins/virtual-mixer/engine/build.bat first');
        const wav = tempPath('.wav');
        const json = tempPath('.json');
        await ctx.fs.write(wav, '');
        await ctx.fs.write(json, '{}');
        await runEngine(['--duck-selftest', wav, json], 30000);
        return readJson(json);
      },
      selftest: async function () {
        if (!fs.existsSync(enginePath())) throw new Error('NO_ENGINE: build plugins/virtual-mixer/engine/build.bat first');
        const wav = tempPath('.wav');
        const json = tempPath('.json');
        await ctx.fs.write(wav, '');
        await ctx.fs.write(json, '{}');
        await runEngine(['--selftest', wav, json], 30000);
        return readJson(json);
      },
      liveConfig: function () { return { ok: true, config: buildLiveConfig() }; },
      meter: function () {
        try { return { ok: true, running: !!(liveChild && liveChild.exitCode === null), data: readJson(liveStatusPath()) }; }
        catch (e) { return { ok: true, running: !!(liveChild && liveChild.exitCode === null), data: null }; }
      },
      start: async function () { return startLive(); },
      stop: function () { stopLive(); return { ok: true, running: false }; },
      reloadConfig: async function () {
        if (ctx.config && ctx.config.autoStart) { const r = await startLive(); return { ok: true, running: true, restarted: true, config: r.config }; }
        stopLive();
        return { ok: true, running: false, restarted: false };
      }
    }
  };
};
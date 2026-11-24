'use strict';
// 虚拟混音台插件 S1 骨架。
// 实时引擎、采集、闪避、A/B-VU 页面在后续切片接入；本切片只暴露设备枚举与离线 selftest。
const path = require('path');
const fs = require('fs');

let ctx = null;
let engineChild = null;
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
    apply: function () {},
    dispose: function () {
      if (engineChild) { try { engineChild.kill(); } catch (e) {} engineChild = null; }
    },
    api: {
      status: function () {
        let exists = false;
        try { exists = fs.existsSync(enginePath()); } catch (e) {}
        return {
          ok: true,
          stage: 'S2a',
          engine: { path: enginePath(), exists: exists, version: '0.2.0' },
          channels: [
            { id: 'system', name: '系统声音', denoise: 'off', compressor: 'off' },
            { id: 'mic', name: '麦克风', denoise: 'off', compressor: 'off' },
            { id: 'custom-1', name: '自定义 1', denoise: 'off', compressor: 'off' }
          ]
        };
      },
      engineVersion: function () { return { ok: true, version: '0.2.0', naudio: '1.10.0' }; },
      devices: async function () {
        if (!fs.existsSync(enginePath())) throw new Error('NO_ENGINE: build plugins/virtual-mixer/engine/build.bat first');
        const out = tempPath('.json');
        await ctx.fs.write(out, '{}');
        await runEngine(['--list-devices', out], 20000);
        return readJson(out);
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
      start: function () { return { ok: false, error: 'NOT_IMPLEMENTED_S1', message: '实时引擎在 S2 接入' }; },
      stop: function () { if (engineChild) { try { engineChild.kill(); } catch (e) {} engineChild = null; } return { ok: true }; }
    }
  };
};
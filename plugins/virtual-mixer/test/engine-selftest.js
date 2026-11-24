'use strict';
// S1 引擎/插件桥离线自测：不依赖声卡，适合开发机与门禁前置验证。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'engine', 'VirtualMixerEngine.exe');
let pass = 0;
function ok(cond, msg) { if (cond) { console.log('  PASS ' + msg); pass++; } else { console.log('  FAIL ' + msg); process.exitCode = 1; } }
function parseJson(s) { return JSON.parse(String(s || '').trim().split(/\r?\n/).filter(Boolean).pop()); }
function wavInfo(file) {
  const b = fs.readFileSync(file);
  ok(b.slice(0,4).toString() === 'RIFF' && b.slice(8,12).toString() === 'WAVE', 'WAV RIFF/WAVE');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.slice(off, off + 4).toString(); const len = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') data = len;
    off += 8 + len + (len % 2);
  }
  return { fmt, data, bytes: b.length };
}
(async function () {
  try {
    if (!fs.existsSync(ENGINE)) { console.error('  FAIL engine not built: ' + ENGINE); process.exit(1); }
    const v = parseJson(execFileSync(ENGINE, ['--version'], { encoding: 'utf8' }));
    ok(v.ok === true && v.engine === 'VirtualMixerEngine' && v.version === '0.1.0', 'version: ' + JSON.stringify(v));
    const devFile = path.join(os.tmpdir(), 'vrcb-mixer-dev-' + process.pid + '.json');
    execFileSync(ENGINE, ['--list-devices', devFile], { encoding: 'utf8' });
    const dev = JSON.parse(fs.readFileSync(devFile, 'utf8'));
    ok(dev.ok === true && Array.isArray(dev.render) && Array.isArray(dev.capture), 'devices: render/capture arrays');
    ok(dev.render.length > 0, 'devices: at least one render endpoint');
    fs.unlinkSync(devFile);
    const wav = path.join(os.tmpdir(), 'vrcb-mixer-self-' + process.pid + '.wav');
    const jf = path.join(os.tmpdir(), 'vrcb-mixer-self-' + process.pid + '.json');
    execFileSync(ENGINE, ['--selftest', wav, jf], { encoding: 'utf8' });
    const j = JSON.parse(fs.readFileSync(jf, 'utf8'));
    const info = wavInfo(wav);
    ok(j.ok === true && j.sampleRate === 48000 && j.channels === 2, 'selftest JSON: 48k/2ch');
    ok(j.durationMs >= 1900 && j.durationMs <= 2100, 'selftest duration ~2s: ' + j.durationMs);
    ok(info.fmt && info.fmt.rate === 48000 && info.fmt.channels === 2, 'WAV format 48k/2ch: ' + JSON.stringify(info.fmt));
    ok(j.peak > 0.1 && j.peak < 0.99, 'peak in range: ' + j.peak);
    ok(j.rms > 0.01, 'rms > 0: ' + j.rms);
    fs.unlinkSync(wav); fs.unlinkSync(jf);
    const factory = require(path.join(ROOT, 'index.js'));
    const ctx = {
      config: {},
      logger: { info: function () {}, warn: function () {}, error: function () {} },
      exec: { run: function (cmd, args) { return spawn(cmd, args, { windowsHide: true, stdio: 'ignore' }); } },
      fs: {
        read: function (p) { return fs.readFileSync(p, 'utf8'); },
        write: function (p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); }
      }
    };
    const plugin = factory(ctx);
    const st = plugin.api.status();
    ok(st.ok === true && st.engine.exists === true && st.channels.length >= 3, 'plugin status: engine + 3 channels');
    const d = await plugin.api.devices();
    ok(d.ok === true && Array.isArray(d.render) && d.render.length > 0, 'plugin devices() bridge');
    const s = await plugin.api.selftest();
    ok(s.ok === true && s.frames === 96000 && s.peak > 0.1, 'plugin selftest() bridge');
    console.log('  ---- ' + pass + ' PASS ----');
  } catch (e) {
    console.error('  FAIL ' + (e && e.message ? e.message : e));
    process.exitCode = 1;
  }
})();
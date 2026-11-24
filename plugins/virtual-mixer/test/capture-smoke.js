'use strict';
// S2a live capture smoke: short WAV capture, no speaker/output device opened.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'engine', 'VirtualMixerEngine.exe');
let pass = 0;
function ok(cond, msg) { if (cond) { console.log('  PASS ' + msg); pass++; } else { console.log('  FAIL ' + msg); process.exitCode = 1; } }
try {
  if (!fs.existsSync(ENGINE)) { console.error('  FAIL engine not built'); process.exit(1); }
  const wav = path.join(os.tmpdir(), 'vrcb-capture-' + process.pid + '.wav');
  const json = path.join(os.tmpdir(), 'vrcb-capture-' + process.pid + '.json');
  execFileSync(ENGINE, ['--capture-test', wav, '1.5', '', '', json], { encoding: 'utf8', timeout: 20000 });
  const j = JSON.parse(fs.readFileSync(json, 'utf8'));
  ok(j.ok === true && j.mode === 'capture-test', 'capture JSON ok');
  ok(j.frames > 0, 'captured frames > 0: ' + j.frames);
  ok(j.sysBytes > 0, 'system loopback bytes > 0: ' + j.sysBytes);
  ok(j.micBytes > 0, 'microphone bytes > 0: ' + j.micBytes);
  ok(fs.existsSync(wav) && fs.statSync(wav).size > 1000, 'capture WAV exists');
  ok(j.duckMinGain >= 0 && j.duckMinGain <= 1 && j.duckMaxGain >= j.duckMinGain, 'duck gains valid');
  fs.unlinkSync(wav); fs.unlinkSync(json);
  console.log('  ---- ' + pass + ' PASS ----');
} catch (e) { console.error('  FAIL ' + e.message); process.exitCode = 1; }
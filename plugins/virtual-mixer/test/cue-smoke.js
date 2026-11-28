'use strict';
// Cue sync smoke: two generated WAVs start at the same sample; verify 440/880 onsets.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'engine', 'VirtualMixerEngine.exe');
let pass = 0;
function ok(c, m) { if (c) { console.log('  PASS ' + m); pass++; } else { console.log('  FAIL ' + m); process.exitCode = 1; } }
function writeWav(file, freq, startSec, durSec, totalSec) {
  const rate = 48000, ch = 2, n = Math.floor(rate * totalSec);
  const data = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    if (t >= startSec && t < startSec + durSec) v = Math.sin(2 * Math.PI * freq * t) * 0.2;
    const q = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    data.writeInt16LE(q, i * 4); data.writeInt16LE(q, i * 4 + 2);
  }
  const b = Buffer.alloc(44 + data.length);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40); data.copy(b, 44);
  fs.writeFileSync(file, b);
}
function readFloatWav(file) {
  const b = fs.readFileSync(file); let off = 12, fmt = null, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), len = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
    if (id === 'data') data = { off: off + 8, len };
    off += 8 + len + (len % 2);
  }
  if (!fmt || !data || fmt.bits !== 32) throw new Error('expected 32-bit float WAV');
  const n = data.len / (fmt.ch * 4), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) s += b.readFloatLE(data.off + (i * fmt.ch + c) * 4); mono[i] = s / fmt.ch; }
  return { rate: fmt.rate, mono };
}
function goertzel(a, freq, rate, st, en) {
  let re = 0, im = 0;
  for (let i = st; i < en; i++) { const w = 2 * Math.PI * freq * i / rate; re += a[i] * Math.cos(w); im += a[i] * Math.sin(w); }
  return Math.hypot(re, im) / Math.max(1, en - st);
}
try {
  if (!fs.existsSync(ENGINE)) throw new Error('engine not built');
  const dir = path.join(os.tmpdir(), 'vrcb-cue-smoke-' + process.pid); fs.mkdirSync(dir, { recursive: true });
  const a = path.join(dir, 'a.wav'), b = path.join(dir, 'b.wav'), out = path.join(dir, 'mix.wav'), res = path.join(dir, 'res.json');
  writeWav(a, 440, 0.2, 0.5, 1.5); writeWav(b, 880, 0.2, 0.5, 1.5);
  execFileSync(ENGINE, ['--cue-selftest', out, res, a, '0', b, '0'], { encoding: 'utf8', timeout: 10000 });
  const r = JSON.parse(fs.readFileSync(res, 'utf8'));
  ok(r.ok === true && r.durationMs >= 1400 && r.peak > 0.05, 'cue-selftest result duration/peak');
  const wav = readFloatWav(out), win = 480;
  let first440 = -1, first880 = -1;
  for (let st = 0; st + win < wav.mono.length; st += win) {
    if (first440 < 0 && goertzel(wav.mono, 440, wav.rate, st, st + win) > 0.01) first440 = st / wav.rate;
    if (first880 < 0 && goertzel(wav.mono, 880, wav.rate, st, st + win) > 0.01) first880 = st / wav.rate;
    if (first440 >= 0 && first880 >= 0) break;
  }
  ok(first440 >= 0 && first880 >= 0, 'both cue tones found');
  ok(Math.abs(first440 - first880) * 1000 <= 10, 'cue onset delta <=10ms (' + Math.abs(first440 - first880) * 1000 + 'ms)');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('  ---- ' + pass + ' PASS ----');
} catch (e) { console.error('  FAIL ' + e.message); process.exitCode = 1; }

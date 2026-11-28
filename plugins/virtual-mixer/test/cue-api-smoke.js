'use strict';
// Cue API smoke: quoted Windows paths and optional mic-duck args, no audio device.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const ROOT = path.resolve(__dirname, '..');
let pass = 0;
function ok(c, m) { if (c) { console.log('  PASS ' + m); pass++; } else { console.log('  FAIL ' + m); process.exitCode = 1; } }
try {
  const dir = path.join(os.tmpdir(), 'vrcb-cue-api-' + process.pid); fs.mkdirSync(dir, { recursive: true });
  const a = path.join(dir, 'file a.wav'), b = path.join(dir, 'file b.wav');
  fs.writeFileSync(a, 'not-real'); fs.writeFileSync(b, 'not-real');
  const calls = [];
  let child = null;
  const ctx = {
    config: { masterOutputDevice: 'CABLE Input', micCaptureDevice: 'mic', duckDepthDb: -15, duckThresholdDb: -35, duckAttackMs: 45, duckReleaseMs: 600, duckHoldMs: 650, duckLookaheadMs: 8, sidechainHpfHz: 120 },
    logger: { info() {}, warn() {}, error() {} },
    exec: { run: function (cmd, args) { calls.push(args); child = new EventEmitter(); child.exitCode = null; child.kill = function () { this.exitCode = 0; this.emit('exit', 0); }; return child; } },
    fs: { read: function (p) { return fs.readFileSync(p, 'utf8'); }, write: function (p, c) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); } }
  };
  const plugin = require(path.join(ROOT, 'index.js'))(ctx);
  (async function () {
    const r = await plugin.api.cue({ files: [{ path: '"' + a + '"', gainDb: 0 }, { path: '"' + b + '"', gainDb: 0 }], leadMs: 500, duck: true });
    ok(r.ok === true, 'cue accepted quoted paths');
    const args = calls[0] || [];
    ok(args.indexOf(a) >= 0 && args.indexOf(b) >= 0, 'quotes stripped from Windows paths');
    ok(args.indexOf('--duck') >= 0, 'cue duck flag forwarded');
    ok(args.indexOf('mic') >= 0, 'duck mic device forwarded');
    plugin.api.cueClear();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('  ---- ' + pass + ' PASS ----');
  })().catch(function (e) { console.error('  FAIL ' + e.message); process.exitCode = 1; });
} catch (e) { console.error('  FAIL ' + e.message); process.exitCode = 1; }

'use strict';
// S3 cable smoke: play a 440Hz tone into CABLE Input, capture CABLE Output.
// Use only when VB-CABLE is installed; never selects a physical speaker.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'engine', 'VirtualMixerEngine.exe');
let pass = 0;
function ok(c, m) { if (c) { console.log('  PASS ' + m); pass++; } else { console.log('  FAIL ' + m); process.exitCode = 1; } }
(async function () {
  try {
    if (!fs.existsSync(ENGINE)) throw new Error('engine not built');
    const devFile = path.join(os.tmpdir(), 'vrcb-cable-dev-' + process.pid + '.json');
    execFileSync(ENGINE, ['--list-devices', devFile], { encoding: 'utf8' });
    const dev = JSON.parse(fs.readFileSync(devFile, 'utf8'));
    const render = (dev.render || []).find(function (d) { return /^CABLE Input\b/i.test(d.name); });
    const mic = (dev.capture || []).find(function (d) { return /^CABLE Output\b/i.test(d.name); });
    const defaultRender = (dev.render || []).find(function (d) { return d.default; });
    fs.unlinkSync(devFile);
    ok(!!render && !!mic, 'CABLE Input/Output present');
    const tone = spawn(ENGINE, ['--tone-test', '2', render.name], { windowsHide: true, stdio: 'ignore' });
    await new Promise(function (r) { setTimeout(r, 350); });
    const wav = path.join(os.tmpdir(), 'vrcb-cable-' + process.pid + '.wav');
    const jsonFile = path.join(os.tmpdir(), 'vrcb-cable-' + process.pid + '.json');
    execFileSync(ENGINE, ['--capture-test', wav, '1.5', defaultRender.name, mic.name, jsonFile], { encoding: 'utf8', timeout: 20000 });
    const j = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    ok(j.ok === true && j.micDevice === mic.name, 'captured CABLE Output');
    ok(j.mixedPeak > 0.02, 'tone reached CABLE Output (mixedPeak=' + j.mixedPeak + ')');
    try { tone.kill(); } catch (e) {}
    fs.unlinkSync(wav); fs.unlinkSync(jsonFile);
    console.log('  ---- ' + pass + ' PASS ----');
  } catch (e) { console.error('  FAIL ' + e.message); process.exitCode = 1; }
})();
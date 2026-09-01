'use strict';
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { isEnabled } = require('./autostart');
const { resolvePython } = require('./pyhelper');

function udpPortTest(port) {
  return new Promise(function (resolve) {
    const s = dgram.createSocket('udp4');
    let done = false;
    const finish = function (v) { if (!done) { done = true; try { s.close(); } catch (e) {} resolve(v); } };
    s.on('error', function (e) { finish(e.code === 'EADDRINUSE' ? '占用中(若 VRChat 正在运行则属正常;否则有进程冲突,建议重启电脑)' : '错误: ' + e.code); });
    s.on('listening', function () { finish('空闲(可以接收)'); });
    try { s.bind(port, '127.0.0.1'); } catch (e) { finish('异常: ' + e.message); }
    setTimeout(function () { finish('超时'); }, 3000);
  });
}
function smtcOneShot() {
  return new Promise(function (resolve) {
    const script = path.join(__dirname, 'helpers', 'smtc.py');
    const py = resolvePython(path.join(__dirname, '..'));
    if (!py) return resolve('未检测到可用 Python(winsdk), 可在控制台"环境检测"一键安装');
    let called = false;
    const finish = function (v) { if (!called) { called = true; resolve(v); } };
    try {
      execFile(py, ['-u', script, '--once'], { timeout: 15000, windowsHide: true, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) }, function (err, stdout, stderr) {
        if (err) return finish('失败: ' + (err.message || err.code || '') + ' | ' + String(stderr || '').trim());
        finish(String(stdout || '').trim() || '(无输出)');
      });
    } catch (e) { finish('异常: ' + e.message); }
    setTimeout(function () { finish('超时'); }, 18000);
  });
}
async function diagnose(opts) {
  const config = opts.config;
  const composer = opts.composer;
  const srcs = composer.sources.map(function (s) {
    const o = { id: s.id, enabled: s.enabled, lastError: s._pollError || s.lastError || null };
    if (s.helperRunning !== undefined) o.helperRunning = s.helperRunning;
    if (s.lastRaw !== undefined) o.lastRaw = s.lastRaw;
    return o;
  });
  let lt = null;
  const dir = (config.sources.livetranslate || {}).transcriptsDir;
  if (dir) {
    try {
      const names = fs.readdirSync(dir).filter(function (n) { return /^livetrans_.*_translation\.txt$/.test(n); });
      if (names.length) {
        const newest = names.map(function (n) { return { n: n, m: fs.statSync(path.join(dir, n)).mtimeMs }; }).sort(function (a, b) { return b.m - a.m; })[0];
        lt = { dirOk: true, files: names.length, newest: newest.n, ageSec: Math.round((Date.now() - newest.m) / 1000) };
      } else lt = { dirOk: true, files: 0, note: '目录存在但没有转录文件(等 LiveTranslate 开始新会话)' };
    } catch (e) { lt = { dirOk: false, error: String(e.message) }; }
  }
  return {
    time: Date.now(),
    node: process.version,
    platform: os.platform() + ' ' + os.release(),
    vrcOn: composer.vrcOn,
    oscTarget: config.osc.host + ':' + config.osc.port,
    udpPortState: await udpPortTest(config.osc.port),
    smtcOneShot: await smtcOneShot(),
    autostart: isEnabled(),
    livetranslate: lt,
    sources: srcs
  };
}
module.exports = { diagnose };

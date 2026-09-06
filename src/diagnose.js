'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { isEnabled } = require('./autostart');
const { resolvePython } = require('./pyhelper');

function netstatTable() {
  const raw = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  const rows = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const m = /^\s*(TCP|UDP)\s+(\S+)\s+(\S+)\s*(LISTENING|ESTABLISHED|\S*)?\s+(\d+)\s*$/.exec(line);
    if (m) rows.push({ proto: m[1], local: m[2], foreign: m[3], state: m[4] || '', pid: Number(m[5]) });
  }
  return rows;
}
function pidNames() {
  const map = {};
  try {
    const raw = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    for (const line of String(raw).split(/\r?\n/)) {
      const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
      if (m) map[m[2]] = m[1];
    }
  } catch (e) {}
  return map;
}
function udpPortTest(port) {
  // 2026-09-04 修复(M-20260903-02 同源): bind 探测在 Windows 因 SO_REUSEADDR 不可靠, VRChat 持 9000 时 bind 仍成功 → 误报"空闲"。
  // 与 web/server.js 的 udpProbe 保持一致: 查 netstat UDP 端点表, 有进程绑定才算占用。
  return new Promise(function (resolve) {
    try {
      const rows = netstatTable();
      const hit = rows.find(function (r) { return r.proto === 'UDP' && new RegExp(':' + port + '$').test(r.local); });
      if (!hit) return resolve('空闲(可以接收)');
      const names = pidNames();
      const nm = names[hit.pid] || ('PID ' + hit.pid);
      if (/vrchat/i.test(nm)) return resolve('被 VRChat 占用(正常)');
      return resolve('被占用: ' + nm + '(若非 VRChat 建议排查端口占用)');
    } catch (e) { return resolve('无法读取端口表: ' + (e.message || '')); }
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

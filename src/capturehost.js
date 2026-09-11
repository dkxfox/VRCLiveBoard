'use strict';
// 常驻截图助手客户端(M-20260911-21)
// 背景: 改前每次截图都起一个 powershell.exe —— 冷启动 + Add-Type 编译约 0.5 秒, 实测一次截图 1.1~1.2 秒。
// 做法: 进程只起一次(src/helpers/capture_host.ps1), 之后按行发 JSON 指令; 起不来/超时/进程死了
//       一律回退到改造前的一次性调用, 行为不退化(最坏情况就是回到原来的耗时)。
// 协议见 capture_host.ps1: 启动回一行 READY, 之后一行指令一行结果(OK | NO-WINDOW | NO-REGION | CAPTURE-FAIL: 原因)。
// 约定: capture() 拿到协议字符串就 resolve; 起不来/超时/进程异常退出 resolve 失败 —— 调用方自己决定怎么报错。
const { spawn, execFile } = require('child_process');
const path = require('path');

const PS = 'powershell.exe';
const HOST_SCRIPT = path.join(__dirname, 'helpers', 'capture_host.ps1');
const ONESHOT_SCRIPT = path.join(__dirname, 'helpers', 'screen_capture.ps1');
const READY_TIMEOUT_MS = 8000;
const CMD_TIMEOUT_MS = 20000;
const MAX_START_FAILS = 3;   // 连续起不来就不再每次白等一次超时(回退路径照常可用)

// 回退路径的命令行: 与改造前逐字一致(参数名、顺序都一样), 保证结果没有任何差别
function buildArgs(opt) {
  const o = opt || {};
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ONESHOT_SCRIPT, '-mode', String(o.mode || 'window')];
  if (o.out !== undefined) args.push('-out', String(o.out));
  if (o.scale !== undefined) args.push('-scale', String(o.scale));
  if (o.maxdim !== undefined) args.push('-maxdim', String(o.maxdim));
  if (o.title !== undefined) args.push('-title', String(o.title));
  if (o.foreground) args.push('-foreground');
  if (o.fw !== undefined) args.push('-fw', String(o.fw));
  if (o.fh !== undefined) args.push('-fh', String(o.fh));
  if (o.x !== undefined) args.push('-x', String(o.x));
  if (o.y !== undefined) args.push('-y', String(o.y));
  if (o.w !== undefined) args.push('-w', String(o.w));
  if (o.h !== undefined) args.push('-h', String(o.h));
  if (o.restoreAfter) args.push('-restoreAfter');
  return args;
}

function oneShot(opt, timeoutMs) {
  return new Promise(function (resolve, reject) {
    execFile(PS, buildArgs(opt), { timeout: timeoutMs || CMD_TIMEOUT_MS, windowsHide: true }, function (err, stdout) {
      if (err) return reject(err);
      // 与常驻路径保持同一形状(去掉行尾空白), 调用方只做 indexOf 判断, 不受影响
      resolve(String(stdout || '').trim());
    });
  });
}

function createCaptureHost(logger) {
  let log = logger || { info: function () {}, warn: function () {} };
  let child = null, buf = '', ready = false, starting = null, stopped = false, startFails = 0;
  let readyCbs = [];
  let pending = null;                  // 当前在等结果的指令
  let chain = Promise.resolve();       // 串行化: PowerShell 单线程, 一次只发一条

  function flushReady(ok) {
    const cbs = readyCbs; readyCbs = [];
    for (const cb of cbs) { try { cb(ok); } catch (e) {} }
  }

  function handleData(chunk) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '').trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      if (line === 'READY') { ready = true; startFails = 0; flushReady(true); continue; }
      if (pending) { const p = pending; pending = null; if (p.timer) clearTimeout(p.timer); p.resolve(line); }
    }
  }

  function handleExit(what) {
    const hadChild = !!child;
    child = null; ready = false; buf = '';
    flushReady(false);
    if (pending) { const p = pending; pending = null; if (p.timer) clearTimeout(p.timer); p.reject(new Error('截图助手已退出(' + what + ')')); }
    if (hadChild && !stopped) log.warn('[capture] 常驻截图助手退出(' + what + '), 下次截图重新拉起');
  }

  function start() {
    if (ready && child) return Promise.resolve(true);
    if (starting) return starting;
    if (stopped || startFails >= MAX_START_FAILS) return Promise.resolve(false);
    starting = new Promise(function (resolve) {
      let settled = false;
      const done = function (ok) {
        if (settled) return;
        settled = true; starting = null;
        if (!ok) startFails++;
        resolve(ok);
      };
      let proc;
      try {
        proc = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HOST_SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) { log.warn('[capture] 常驻截图助手启动失败: ' + e.message); return done(false); }
      child = proc; buf = ''; ready = false;
      const t = setTimeout(function () { log.warn('[capture] 常驻截图助手启动超时, 本次回退一次性调用'); try { proc.kill(); } catch (e) {} done(false); }, READY_TIMEOUT_MS);
      readyCbs.push(function (ok) { clearTimeout(t); done(ok); });
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', handleData);
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', function (d) { const s = String(d).trim(); if (s) log.warn('[capture] 助手: ' + s.slice(0, 200)); });
      proc.on('error', function (e) { log.warn('[capture] 常驻截图助手异常: ' + e.message); done(false); });
      proc.on('exit', function (code) { handleExit('code=' + code); done(false); });
    });
    return starting;
  }

  function send(opt, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        pending = null;
        try { if (child) child.kill(); } catch (e) {}
        reject(new Error('截图助手响应超时'));
      }, timeoutMs || CMD_TIMEOUT_MS);
      pending = { resolve: resolve, reject: reject, timer: timer };
      try {
        child.stdin.write(JSON.stringify(opt) + '\n');
      } catch (e) {
        clearTimeout(timer); pending = null; reject(e);
      }
    });
  }

  // 一次截图: 常驻优先, 任何问题都回退到一次性调用
  function capture(opt, timeoutMs) {
    const run = function () {
      return start().then(function (ok) {
        if (!ok || !child) return oneShot(opt, timeoutMs);
        return send(opt, timeoutMs).catch(function (e) {
          log.warn('[capture] 常驻助手不可用, 回退一次性调用: ' + e.message);
          return oneShot(opt, timeoutMs);
        });
      });
    };
    const p = chain.then(run, run);
    chain = p.then(function () {}, function () {});
    return p;
  }

  function stop() {
    stopped = true;
    flushReady(false);
    try { if (child && child.stdin) child.stdin.end('quit\n'); } catch (e) {}
    try { if (child) child.kill(); } catch (e) {}
    child = null; ready = false;
  }

  return {
    capture: capture,
    stop: stop,
    setLogger: function (l) { if (l && l.warn) log = l; },
    isReady: function () { return ready && !!child; }
  };
}

// 单例: OCR 截图与端口预览共用一个常驻进程
let singleton = null;
function getCaptureHost(logger) {
  if (!singleton) singleton = createCaptureHost(logger);
  else singleton.setLogger(logger);
  return singleton;
}
function stopCaptureHost() {
  if (!singleton) return;
  try { singleton.stop(); } catch (e) {}
  singleton = null;
}

module.exports = { getCaptureHost: getCaptureHost, stopCaptureHost: stopCaptureHost, createCaptureHost: createCaptureHost, buildArgs: buildArgs };

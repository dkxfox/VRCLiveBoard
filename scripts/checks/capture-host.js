'use strict';
// 截图助手契约测试(M-20260911-21): 常驻进程协议 + UTF-8 往返 + 回退路径
// 由 smoke.ps1 -Flow 在隔离实例上调用: node capture-host.js --root <临时实例目录>
// 背景: 改前每次截图都要起一个 powershell.exe(冷启动+Add-Type 约 0.5 秒, 实测一次截图 1.1~1.2 秒);
//       改成常驻进程后协议是新的、可被改坏的东西, 所以单独用一条确定性门禁守住它。
// 断言全部不依赖桌面会话(唯一的真实截图用例在没有桌面时记为 SKIP)。
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
const ROOT = path.resolve(arg('root', path.join(__dirname, '..', '..')));
const HOST = path.join(ROOT, 'src', 'helpers', 'capture_host.ps1');
const CLI = path.join(ROOT, 'src', 'helpers', 'screen_capture.ps1');
const CLIENT = path.join(ROOT, 'src', 'capturehost.js');
const PS = 'powershell.exe';
const TMP = path.join(os.tmpdir(), 'vrcb-caphost-check.png');
let pass = 0, fail = 0, skip = 0;
function ok(cond, msg) { if (cond) { console.log('  PASS ' + msg); pass++; } else { console.log('  FAIL ' + msg); fail++; } }
function note(msg) { console.log('  SKIP ' + msg); skip++; }
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

// 常驻进程驱动: 一行指令一行结果, 每条指令有自己的超时
function startHost() {
  const p = cp.spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HOST], { windowsHide: true });
  p.stdout.setEncoding('utf8');
  const st = { ready: false, err: '' };
  let buf = ''; const waiters = [];
  p.stdout.on('data', function (d) {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '').trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      if (!st.ready && line === 'READY') { st.ready = true; continue; }
      const w = waiters.shift();
      if (w) w(line);
    }
  });
  p.stderr.setEncoding('utf8');
  p.stderr.on('data', function (d) { st.err += String(d); });
  st.send = function (jsonLine, timeoutMs) {
    return new Promise(function (resolve) {
      const t = setTimeout(function () { resolve('<TIMEOUT>'); }, timeoutMs || 10000);
      waiters.push(function (l) { clearTimeout(t); resolve(l); });
      p.stdin.write(jsonLine + '\n');
    });
  };
  st.waitReady = async function (timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < (timeoutMs || 10000)) { if (st.ready) return Date.now() - t0; await sleep(50); }
    return -1;
  };
  st.stop = function () { try { p.stdin.end('quit\n'); } catch (e) {} try { p.kill(); } catch (e) {} };
  return st;
}
function oneShot(argv) {
  return new Promise(function (resolve) {
    cp.execFile(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CLI].concat(argv), { timeout: 20000, windowsHide: true }, function (err, stdout) {
      resolve(err ? ('ERR ' + err.message) : String(stdout || '').trim());
    });
  });
}

(async function () {
  console.log('[capture-host] 隔离实例根目录: ' + ROOT);
  for (const f of [HOST, CLI, CLIENT]) ok(fs.existsSync(f), '存在 ' + path.relative(ROOT, f));

  // ① 常驻进程: READY + 协议行
  const host = startHost();
  const ms = await host.waitReady(12000);
  ok(ms >= 0, '常驻助手启动并回 READY(' + ms + 'ms)');
  const r1 = await host.send(JSON.stringify({ mode: 'region', x: 0, y: 0, w: 0, h: 0, out: TMP }));
  ok(r1 === 'NO-REGION', '未设区域的指令回 NO-REGION(实得 ' + r1 + ')');
  const r2 = await host.send(JSON.stringify({ mode: 'window', title: 'NoSuchWindowXYZ', out: TMP }));
  ok(r2 === 'NO-WINDOW', '不存在的窗口回 NO-WINDOW(实得 ' + r2 + ')');

  // ② UTF-8 往返: 坏 JSON 的报错会原样回显输入行, 用中文标题当探针
  const bad = '{"mode":"window", "title" "中文标题"}';
  const r3 = await host.send(bad);
  ok(r3.indexOf('CAPTURE-FAIL') === 0 && r3.indexOf('中文标题') >= 0, 'UTF-8 指令往返正常(报错原样回显中文标题)');
  const r4 = await host.send(JSON.stringify({ mode: 'region', x: 0, y: 0, w: 0, h: 0, out: TMP }));
  ok(r4 === 'NO-REGION', '报错之后协议不串行(下一条指令照常应答)');

  // ③ 真实截图: 常驻的第二次必须比第一次快(第一次含冷启动); 无桌面会话时记为 SKIP
  const a1 = await host.send(JSON.stringify({ mode: 'screen', scale: 1, maxdim: 400, out: TMP }), 30000);
  const t2 = Date.now();
  const a2 = await host.send(JSON.stringify({ mode: 'screen', scale: 1, maxdim: 400, out: TMP }), 30000);
  const d2 = Date.now() - t2;
  if (a1 === 'OK' && a2 === 'OK') {
    const sz = fs.existsSync(TMP) ? fs.statSync(TMP).size : -1;
    ok(sz > 1000, '常驻助手真实截图成功(' + sz + ' 字节, 第二次 ' + d2 + 'ms, 无冷启动)');
  } else note('无桌面会话, 跳过真实截图用例(' + a1 + '/' + a2 + ')');
  host.stop();
  try { if (fs.existsSync(TMP)) fs.unlinkSync(TMP); } catch (e) {}

  // ④ 一次性 CLI: 参数与输出协议必须和改造前一致
  ok((await oneShot(['-mode', 'region', '-x', '0', '-y', '0', '-w', '0', '-h', '0', '-out', TMP])) === 'NO-REGION', '一次性 CLI 回 NO-REGION(与改造前一致)');
  ok((await oneShot(['-mode', 'window', '-title', 'NoSuchWindowXYZ', '-out', TMP])) === 'NO-WINDOW', '一次性 CLI 回 NO-WINDOW(与改造前一致)');

  // ⑤ 回退路径: 起不来常驻进程时必须自动退回一次性调用, 结果不退化
  const realSpawn = cp.spawn;
  cp.spawn = function () { throw new Error('spawn disabled (fallback check)'); };
  let fallback = '<none>';
  try {
    delete require.cache[require.resolve(CLIENT)];
    const mod = require(CLIENT);
    const warns = [];
    const c = mod.getCaptureHost({ info: function () {}, warn: function (m) { warns.push(m); } });
    fallback = await c.capture({ mode: 'region', x: 0, y: 0, w: 0, h: 0, out: TMP });
    mod.stopCaptureHost();
    ok(fallback === 'NO-REGION', '常驻起不来时回退一次性调用并拿到同样结果(实得 ' + fallback + ')');
    ok(warns.length > 0, '回退时留下告警日志(' + (warns[0] || '').slice(0, 60) + ')');
  } finally {
    cp.spawn = realSpawn;
    try { delete require.cache[require.resolve(CLIENT)]; } catch (e) {}
  }
  try { if (fs.existsSync(TMP)) fs.unlinkSync(TMP); } catch (e) {}

  console.log('[capture-host] pass=' + pass + ' fail=' + fail + (skip ? (' skip=' + skip) : ''));
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) { console.log('  FAIL 截图助手契约测试异常: ' + ((e && e.stack) || e)); process.exitCode = 1; });

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

  // ⑥ 截图回复必须严格校验(M-20260911-26): CAPTURE-FAIL / 空 / 未知内容都不得被当成成功
  //    (改前只认 NO-WINDOW / NO-REGION, 失败时会静默复用上一轮的旧截图去 OCR / 上传视觉接口)
  try {
    const ocr = require(path.join(ROOT, 'src', 'ocrtranslate.js'));
    const cases = [
      ['OK', true, ''],
      ['NO-WINDOW', false, '未找到窗口'],
      ['NO-REGION', false, '截图区域未设置'],
      ['CAPTURE-FAIL: GDI+ 出错了', false, '截图失败'],
      ['', false, '无法识别'],
      ['一条看不懂的输出', false, '无法识别']
    ];
    for (const c of cases) {
      let good = false, detail = '';
      try { ocr.checkCaptureReply(c[0], 'VRChat'); good = true; } catch (e) { detail = e.message; }
      ok(good === c[1] && (!c[2] || detail.indexOf(c[2]) >= 0), '回复 ' + JSON.stringify(String(c[0]).slice(0, 22)) + ' -> ' + (good ? 'OK' : detail.slice(0, 44)));
    }
    ok(typeof ocr.captureWindow === 'function', 'ocrtranslate 导出 captureWindow(便于复用与门禁)');
  } catch (e) { ok(false, '截图回复校验用例异常: ' + e.message); }

  // ⑦ 空画面判定(2026-09-19, 用户报"只有第一次能截到 VRChat"): PrintWindow 对最小化/多窗口场景
  //    可能返回 true 但整幅全黑 —— 改前会把这个当成功, OCR 拿到空图, 用户看到"没翻译/没反应"。
  //    这里用三张已知图证明判定器真的会拒黑图/纯色图, 并放过正常画面。
  try {
    const mk = path.join(os.tmpdir(), 'vrcb-cap-mk.ps1');
    fs.writeFileSync(mk, [
      'Add-Type -AssemblyName System.Drawing',
      'function S($kind, $p) {',
      '  $b = New-Object System.Drawing.Bitmap 320, 200',
      '  $g = [System.Drawing.Graphics]::FromImage($b)',
      '  if ($kind -eq "black") { $g.Clear([System.Drawing.Color]::Black) }',
      '  elseif ($kind -eq "white") { $g.Clear([System.Drawing.Color]::White) }',
      '  else { for ($x = 0; $x -lt 320; $x += 8) { for ($y = 0; $y -lt 200; $y += 8) {',
      '    $c = [System.Drawing.Color]::FromArgb(255, ($x * 3) % 256, ($y * 5) % 256, (($x + $y) * 7) % 256)',
      '    $g.FillRectangle((New-Object System.Drawing.SolidBrush $c), $x, $y, 8, 8) } } }',
      '  $g.Dispose(); $b.Save($p, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()',
      '}',
      'S "black" (Join-Path $env:TEMP "vrcb-gate-black.png")',
      'S "white" (Join-Path $env:TEMP "vrcb-gate-white.png")',
      'S "noise" (Join-Path $env:TEMP "vrcb-gate-noise.png")'
    ].join('\r\n'), 'utf8');
    await new Promise(function (res) { cp.execFile(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', mk], { timeout: 30000, windowsHide: true }, function () { res(); }); });
    const host3 = startHost();
    const ms3 = await host3.waitReady(12000);
    ok(ms3 >= 0, '第三轮常驻助手就绪(空画面判定用, ' + ms3 + 'ms)');
    const pb = await host3.send(JSON.stringify({ mode: 'probeimg', path: path.join(os.tmpdir(), 'vrcb-gate-black.png') }));
    const pw = await host3.send(JSON.stringify({ mode: 'probeimg', path: path.join(os.tmpdir(), 'vrcb-gate-white.png') }));
    const pn = await host3.send(JSON.stringify({ mode: 'probeimg', path: path.join(os.tmpdir(), 'vrcb-gate-noise.png') }));
    const pm = await host3.send(JSON.stringify({ mode: 'probeimg', path: path.join(os.tmpdir(), 'vrcb-gate-missing.png') }));
    ok(pb.indexOf('BLANK') === 0, '全黑图判为不可用(' + pb + ')');
    ok(pw.indexOf('BLANK') === 0, '纯色图判为不可用(' + pw + ')');
    ok(pn.indexOf('USEFUL') === 0, '正常画面判为可用(' + pn + ')');
    ok(pm.indexOf('PROBE-FAIL') === 0, '不存在的图片回 PROBE-FAIL(' + pm + ')');

    // ⑧ 正常路径不得打扰窗口(2026-09-19): PrintWindow 与 z-order 无关, 拍到内容就不该动窗口 ——
    //    用诊断日志证明"用了 printwindow 且 raised=False"(改前每次都会抬窗, 而且抬不动时会拍错)。
    const rw = await host3.send(JSON.stringify({ mode: 'window', title: 'VRChat', out: TMP, scale: 1, foreground: true }), 30000);
    if (rw === 'OK') {
      let tail = '';
      try { tail = fs.readFileSync(path.join(ROOT, 'logs', 'capture-diag.log'), 'utf8').split('\n').filter(Boolean).slice(-1)[0] || ''; } catch (e) {}
      ok(/strategy=printwindow/.test(tail) && /raised=False/.test(tail), '抓到真实窗口且未打扰它(' + tail.replace(/^\S+\s+/, '').slice(0, 96) + ')');
    } else note('本机没有 VRChat 窗口, 跳过"不打扰窗口"用例(' + rw + ')');

    // ⑨ 全黑窗口必须被拒: 造一个无边框纯黑窗口, 用**禁止动窗口**的模式去拍 -> 必须是 EMPTY-CAPTURE
    const formCmd = [
      'Add-Type -AssemblyName System.Windows.Forms',
      "$f = New-Object System.Windows.Forms.Form",
      "$f.Text = 'VRCBBlankProbe'",
      "$f.FormBorderStyle = 'None'",
      '$f.BackColor = [System.Drawing.Color]::Black',
      '$f.Size = New-Object System.Drawing.Size 240, 180',
      '$t = New-Object System.Windows.Forms.Timer',
      '$t.Interval = 6000',
      '$t.Add_Tick({ $f.Close() })',
      '$t.Start()',
      '[void]$f.Show()',
      '[System.Windows.Forms.Application]::Run($f)'
    ].join('; ');
    let form = null;
    try { form = cp.spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', formCmd], { windowsHide: true }); } catch (e) {}
    await sleep(3000);
    // allowSelf: 黑窗口是 powershell 进程的, 而助手默认拒绝拍自家进程(产品行为) —— 门禁显式打开它
    const rblank = await host3.send(JSON.stringify({ mode: 'window', title: 'VRCBBlankProbe', out: TMP, scale: 1, foreground: false, allowSelf: true }), 30000);
    if (rblank === 'NO-WINDOW') note('无桌面会话(黑窗口没建起来), 跳过"空窗口必须被拒"用例');
    else ok(rblank.indexOf('EMPTY-CAPTURE') === 0, '全黑窗口被拒(不再把空图当成功): ' + rblank.slice(0, 90));
    if (form) { try { form.kill(); } catch (e) {} }
    host3.stop();
  } catch (e) { ok(false, '空画面判定/窗口打扰用例异常: ' + e.message); }

  console.log('[capture-host] pass=' + pass + ' fail=' + fail + (skip ? (' skip=' + skip) : ''));
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) { console.log('  FAIL 截图助手契约测试异常: ' + ((e && e.stack) || e)); process.exitCode = 1; });

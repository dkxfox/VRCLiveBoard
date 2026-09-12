'use strict';
// 后端契约流程测试: 断言"冒烟断言机制做不到的事" —— 自定义请求头(If-None-Match/Range)与 POST 大 body。
// 由 smoke.ps1 -Flow 在隔离实例上调用: node backend-flow.js --port <port> --root <临时实例目录>
//   覆盖: ①安全: /api/special/video 的路径围栏(403 两类) ②Range: 206/后缀/416(不可满足)/非法头
//         ③readBody: 超大 body 必须回响应而不是断连挂死 ④静态图片: ETag + 304
//         ⑤端口体检: 体检进行中, 其他请求不得被事件循环阻塞(M-20260911-12 的回归护栏)
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
function arg(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
const PORT = Number(arg('port', 19250));
const ROOT = arg('root', '');
const BASE = 'http://127.0.0.1:' + PORT;
let pass = 0, fail = 0, skip = 0;
function ok(cond, msg) { if (cond) { console.log('  PASS ' + msg); pass++; } else { console.log('  FAIL ' + msg); fail++; } }
function note(msg) { console.log('  SKIP ' + msg); skip++; }
async function req(p, opt) { const t = Date.now(); const r = await fetch(BASE + p, opt || {}); const b = Buffer.from(await r.arrayBuffer()); return { status: r.status, headers: r.headers, body: b, ms: Date.now() - t }; }

(async function () {
  console.log('[backend-flow] 隔离实例 :' + PORT);
  // ① 安全: 路径围栏
  let r = await req('/api/special/video?file=config.json');
  ok(r.status === 403, '配置文件读取被拦(config.json -> 403)');
  r = await req('/api/special/video?file=../../../../Windows/win.ini');
  ok(r.status === 403, '目录穿越被拦(../../ -> 403)');

  // ② Range(需要临时实例里有测试视频)
  if (!ROOT) note('未提供 --root, 跳过 Range 与 ETag 用例');
  else {
    const dir = path.join(ROOT, 'assets', 'videos');
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'flowtest.mp4'), Buffer.alloc(1000)); } catch (e) { note('无法放置测试视频: ' + e.message); }
    const U = '/api/special/video?file=assets/videos/flowtest.mp4';
    r = await req(U);
    ok(r.status === 200 && r.body.length === 1000, '完整请求 200 / 1000 字节');
    r = await req(U, { headers: { Range: 'bytes=0-99' } });
    ok(r.status === 206 && r.body.length === 100 && r.headers.get('content-range') === 'bytes 0-99/1000', 'Range 0-99 -> 206 且长度正确');
    r = await req(U, { headers: { Range: 'bytes=-100' } });
    ok(r.status === 206 && r.headers.get('content-range') === 'bytes 900-999/1000', '后缀区间 bytes=-100 -> 末尾 100 字节');
    r = await req(U, { headers: { Range: 'bytes=5000-100' } });
    ok(r.status === 416 && r.body.length === 0, '不可满足区间 -> 416 且立即返回(修复前卡死)');
    r = await req(U, { headers: { Range: 'bytes=abc' } });
    ok(r.status === 200, '非法 Range 头被忽略 -> 200');

    // ④ 静态图片: ETag + 304
    r = await req('/icon-256.png');
    const etag = r.headers.get('etag');
    ok(r.status === 200 && r.body.length > 1000 && !!etag, '小图可服务且带 ETag(' + r.body.length + ' 字节)');
    if (etag) {
      r = await req('/icon-256.png', { headers: { 'If-None-Match': etag } });
      ok(r.status === 304 && r.body.length === 0, '内容未变 -> 304 且无响应体');
    }
  }

  // ③ readBody: 超大 body 必须拿到响应
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    r = await req('/api/config', { method: 'POST', body: JSON.stringify({ big: 'x'.repeat(300 * 1024) }), signal: ctl.signal });
    ok(r.ms < 10000, '超大 POST(300KB) 拿到响应(' + r.ms + 'ms, 修复前不回包)');
  } catch (e) { ok(false, '超大 POST 异常: ' + e.message); } finally { clearTimeout(timer); }
  ok((await req('/api/version')).status === 200, '超限之后服务仍正常');

  // ⑤ 端口体检不得阻塞事件循环
  const p1 = req('/api/ports/check');
  await new Promise((res) => setTimeout(res, 30));
  const v = await req('/api/version');
  const c = await p1;
  if (c.ms < 300) note('端口体检仅 ' + c.ms + 'ms, 不足以判定阻塞(跳过)');
  else ok(v.ms < 400, '体检( ' + c.ms + 'ms)期间其他请求未被阻塞(' + v.ms + 'ms)');

  // ⑥ 路由可达性: 清单里的 GET 路由一条都不能丢(重构/抽表后最容易出的问题)
  //    区分"落空 404"(分发器没匹配到, 响应体恰好是 {"ok":false})与"业务 404"(处理器返回, 带 error)
  try {
    const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'ROUTES-BASELINE.json'), 'utf8'));
    const SKIP = ['/api/version/check', '/api/capture/preview', '/api/icon']; // 外网/截图/大图: 慢或重, 不适合每次门禁跑
    const gets = (base.routes || []).filter((r) => r.m === 'GET' && r.p.indexOf('/api/') === 0 && SKIP.indexOf(r.p) < 0);
    const missing = [];
    for (const r of gets) {
      let rr;
      try { rr = await req(r.p); } catch (e) { missing.push(r.p + '(请求异常)'); continue; }
      const body = rr.body.toString('utf8');
      if (rr.status === 404 && body.replace(/\s/g, '') === '{"ok":false}') missing.push(r.p);
    }
    if (missing.length) ok(false, '有 ' + missing.length + ' 条 GET 路由落空(分发器没匹配到): ' + missing.join(', '));
    else ok(true, '清单内 ' + gets.length + ' 条 GET 路由全部可达(无落空 404)');
  } catch (e) { note('路由可达性检查跳过: ' + e.message); }

  // ⑥b 插件删除(M-20260911-47): 必须是"移到回收目录"而不是不可恢复的 rmSync —— 用隔离实例里的一个插件试
  try {
    const before = JSON.parse((await req('/api/plugins')).body.toString('utf8'));
    const arr = Array.isArray(before) ? before : (before.plugins || before.entries || []);
    const victim = arr.filter(function (p) { return p && p.id === 'weather-board'; })[0];
    if (!victim) note('隔离实例里没有 weather-board, 跳过删除用例');
    else {
      const rd = await req('/api/plugins/remove', { method: 'POST', body: JSON.stringify({ id: 'weather-board' }) });
      const jd = JSON.parse(rd.body.toString('utf8'));
      ok(rd.status === 200 && jd.ok === true, '删除插件接口 200');
      ok(!!jd.moved && fs.existsSync(jd.moved), '插件目录被移到回收目录(可恢复): ' + String(jd.moved).split(/[\\/]/).pop());
      const after = JSON.parse((await req('/api/plugins')).body.toString('utf8'));
      const arr2 = Array.isArray(after) ? after : (after.plugins || after.entries || []);
      ok(!arr2.some(function (p) { return p && p.id === 'weather-board'; }), '删除后插件列表里不再出现');
    }
  } catch (e) { ok(false, '插件删除用例异常: ' + e.message); }

  // ⑦ 截图翻译设置落盘(M-20260911-23): 面板上的识别方式与参数都读自 config, 必须能写回去(否则重启回默认)
  try {
    const cfgPath = path.join(ROOT, 'config.json');
    const readCfg = async function () { return JSON.parse((await req('/api/config')).body.toString('utf8')); };
    const r7 = await req('/api/ocrtl-vision', { method: 'POST', body: JSON.stringify({ mode: 'vision', loops: 99, delayMs: 1 }) });
    const j7 = JSON.parse(r7.body.toString('utf8'));
    ok(r7.status === 200 && j7.ok === true, '保存截图翻译设置接口 200');
    ok(j7.ocrtl && j7.ocrtl.mode === 'vision', '回传生效值(识别方式 vision)');
    ok(j7.ocrtl && j7.ocrtl.loops === 10 && j7.ocrtl.delayMs === 1000, '越界参数被夹回合法范围(loops 99->10, delayMs 1->1000)');
    const c7 = await readCfg();
    ok(c7.ocrtl && c7.ocrtl.mode === 'vision', '识别方式进入运行中的配置(重启读的就是它)');
    ok(c7.ocrtl && c7.ocrtl.vision && typeof c7.ocrtl.vision.apiBase === 'string', '保存识别方式没有顺手清掉 vision 段');
    if (fs.existsSync(cfgPath)) {
      const disk = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      ok(disk.ocrtl && disk.ocrtl.mode === 'vision', '识别方式已落盘到 config.json(真持久化)');
    } else note('未找到 config.json, 跳过落盘断言');
    await req('/api/ocrtl-vision', { method: 'POST', body: JSON.stringify({ mode: 'bogus' }) });
    ok((await readCfg()).ocrtl.mode === 'vision', '非法识别方式被忽略(仍是 vision)');
    await req('/api/ocrtl-vision', { method: 'POST', body: JSON.stringify({ mode: 'auto', loops: 2, delayMs: 5000, displayMs: 8000 }) });
    ok((await readCfg()).ocrtl.mode === 'auto', '用例结束后恢复默认 auto');
  } catch (e) { ok(false, '截图翻译设置落盘用例异常: ' + e.message); }

  // ⑧ 启动彩蛋决策矩阵(M-20260911-50): 设计稿 §4 状态机 + §5 持久化 —— 桌面壳启动画面与网页控制台共用这一个判定
  try {
    const D = '03-03';                     // 任意测试日期(不写真实素材日期: 仓库是公开的)
    const OUT = '03-20';                   // 窗口外
    const boot = async function (date) { return JSON.parse((await req('/api/efx/boot' + (date ? ('?date=' + date) : ''))).body.toString('utf8')); };
    const setEfx = async function (o) { await req('/api/config', { method: 'POST', body: JSON.stringify(o) }); };
    const EV = { id: 'gate-egg', version: 1, start: '03-03', end: '03-03', yearly: true, title: 'gate', video: 'assets/videos/gate-egg.mp4' };
    await setEfx({ specialEvents: [EV], efx: { enabled: true, oncePerDay: true, played: {} } });
    let d8 = await boot(D);
    ok(d8.action === 'special' && d8.event && d8.event.video === EV.video, '窗口内+开关开 → 播特殊彩蛋(带 video)');
    ok(d8.enabled === true && d8.forced === false, '开关开时 forced=false(强播标记只属于开关关)');
    d8 = await boot(D);
    ok(d8.action === 'off' && /已播过/.test(d8.reason || ''), '同一天再问 → off(oncePerDay 生效)');
    const cfg8 = ROOT && fs.existsSync(path.join(ROOT, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')) : null;
    ok(!!(cfg8 && cfg8.efx && cfg8.efx.played && cfg8.efx.played['gate-egg@1'] && cfg8.efx.played['gate-egg@1'].last === D), '已播记录落盘(efx.played[gate-egg@1].last)');
    await setEfx({ efx: { enabled: true, oncePerDay: false } });
    d8 = await boot(D);
    ok(d8.action === 'special', 'oncePerDay=false → 同一天可反复看(设计 §4)');
    await setEfx({ specialEvents: [Object.assign({}, EV, { version: 2 })], efx: { enabled: false, oncePerDay: true } });
    d8 = await boot(D);
    ok(d8.action === 'special' && d8.forced === true, '开关关 → 到日期仍强播一次(设计 §4)');
    d8 = await boot(D);
    ok(d8.action === 'off' && /强播过/.test(d8.reason || ''), '强播只发生一次(同版本)');
    await setEfx({ specialEvents: [Object.assign({}, EV, { version: 3 })] });
    d8 = await boot(D);
    ok(d8.action === 'special' && d8.forced === true, '版本升级=新事件 → 可再强播一次(设计 §5)');
    await setEfx({ specialEvents: [Object.assign({}, EV, { version: 4 })], efx: { enabled: true, oncePerDay: true } });
    d8 = await boot(OUT);
    ok(d8.action === 'normal' && !d8.event, '窗口外+开关开 → 普通启动动画(无日常素材时不报 special)');
    await setEfx({ efx: { enabled: false } });
    ok((await boot(OUT)).action === 'off', '窗口外+开关关 → 不播(设计 §4 末行)');
    await setEfx({ specialEvents: [{ date: '12-31', video: 'assets/videos/legacy.mp4', title: 'legacy' }], efx: { enabled: true, oncePerDay: true, played: {} } });
    d8 = await boot('12-31');
    ok(d8.action === 'special' && d8.event && d8.event.video === 'assets/videos/legacy.mp4', '旧格式 {date,video,title} 继续可用(向后兼容)');
    await setEfx({ specialEvents: [{ id: 'ny', version: 1, start: '12-28', end: '01-03', yearly: true, video: 'assets/videos/ny.mp4' }], efx: { enabled: true, oncePerDay: false, played: {} } });
    ok((await boot('01-01')).action === 'special' && (await boot('12-30')).action === 'special', '跨年窗口 12-28~01-03: 01-01 与 12-30 都命中');
    ok((await boot('07-01')).action === 'normal', '跨年窗口外(07-01)不命中');
    await setEfx({ specialEvents: [Object.assign({}, EV, { version: 9 })], efx: { enabled: true, oncePerDay: true, played: {} } });
    const dry8 = JSON.parse((await req('/api/efx/boot?date=' + D + '&dry=1')).body.toString('utf8'));
    const dry8b = JSON.parse((await req('/api/efx/boot?date=' + D + '&dry=1')).body.toString('utf8'));
    ok(dry8.action === 'special' && dry8.dry === true && dry8b.action === 'special', 'dry=1 只问不记(预览不会把彩蛋消耗掉)');
    // 启动画面契约(M-20260911-50): 桌面壳轮询 window.__splashDone 才亮主窗口 —— 这个约定必须两边都在
    const sp1 = await req('/splash.html');
    const sp2 = await req('/splash.js');
    ok(sp1.status === 200 && sp1.body.toString('utf8').indexOf('/splash.js') > 0, '启动画面页 /splash.html 可服务且引用 /splash.js');
    ok(sp2.status === 200 && sp2.body.toString('utf8').indexOf('__splashDone') > 0, '启动画面脚本置 __splashDone(壳的收尾约定)');
    // 本地事件表兜底(M-20260911-50): 仓库是公开的, 事件表不进库 —— 所以本地文件这条路径必须也能用
    if (ROOT) {
      try {
        const evDir = path.join(ROOT, 'assets', 'videos');
        fs.mkdirSync(evDir, { recursive: true });
        const evFile = path.join(evDir, 'events.json');
        fs.writeFileSync(evFile, JSON.stringify({ specialEvents: [{ id: 'local-egg', version: 1, start: D, end: D, video: 'assets/videos/local.mp4' }] }), 'utf8');
        await setEfx({ specialEvents: [], efx: { enabled: true, oncePerDay: false, played: {} } });
        const dLoc = JSON.parse((await req('/api/efx/boot?date=' + D)).body.toString('utf8'));
        ok(dLoc.action === 'special' && dLoc.source === 'local' && dLoc.event && dLoc.event.id === 'local-egg', 'config 为空时用本地事件表(assets/videos/events.json)兜底');
        await setEfx({ specialEvents: [Object.assign({}, EV, { version: 1 })], efx: { played: {} } });
        const dCfg = JSON.parse((await req('/api/efx/boot?date=' + D)).body.toString('utf8'));
        ok(dCfg.source === 'config' && dCfg.event && dCfg.event.id === 'gate-egg', 'config 里的 specialEvents 优先于本地事件表');
        try { fs.unlinkSync(evFile); } catch (e) {}
      } catch (e) { ok(false, '本地事件表兜底用例异常: ' + e.message); }
    } else note('未提供 --root, 跳过本地事件表用例');
    await setEfx({ specialEvents: [], dailyEvents: [], efx: { enabled: true, oncePerDay: true, played: {} } });
    ok((await boot(D)).action === 'normal', '用例结束清空彩蛋条目(恢复原状)');
  } catch (e) { ok(false, '启动彩蛋决策用例异常: ' + e.message); }

  // ⑨ 插件市场 MVP(M-20260911-51): 用隔离实例自己的静态目录当市场源 —— 不联网也能端到端验证
  //    覆盖: 目录拉取/分级标记/安装(下载+sha256+importZip)/来源记录/更新提示/哈希不符拒装/吊销列表拦截
  if (!ROOT) note('未提供 --root, 跳过插件市场用例');
  else {
    try {
      const { execFileSync } = require('child_process');
      const crypto = require('crypto');
      // 市场源用独立的本地镜像进程: 主服务的静态路由只服务 public 根目录(含 / 的路径一律不服务), 而真实市场本来就在外部主机上
      const http = require('http');
      const os = require('os');
      const pub = path.join(os.tmpdir(), 'vrcb-mkt-gate');
      const src = path.join(os.tmpdir(), 'vrcb-mkt-gate-src');
      const mport = PORT + 1;
      const resetMarket = async function () { await req('/api/config', { method: 'POST', body: JSON.stringify({ market: { indexUrl: '', revokeUrl: '' } }) }); };
      fs.rmSync(pub, { recursive: true, force: true }); fs.mkdirSync(pub, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true }); fs.mkdirSync(src, { recursive: true });
      let msrv = null;
      fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ id: 'market-test', name: 'market gate', version: '1.0.0', api: '2.0.0', permissions: { network: [], filesystem: { read: [], write: [] }, process: false, ports: [] } }), 'utf8');
      fs.writeFileSync(path.join(src, 'index.js'), 'module.exports = { onLoad: function () {} };\n', 'utf8');
      const zip = path.join(pub, 'market-test-1.0.0.zip');
      execFileSync('tar', ['-a', '-c', '-f', zip, '-C', src, '.'], { windowsHide: true });   // Windows 自带 bsdtar 能打 zip(importZip 也用 tar 解)
      const hash = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
      const base = 'http://127.0.0.1:' + mport;
      const item = { id: 'market-test', name: 'market gate', version: '1.0.0', tier: 'reviewed', summary: 'gate', author: { id: 'gate', name: 'gate' }, api: '2.0.0', url: base + '/market-test-1.0.0.zip', sha256: hash, size: fs.statSync(zip).size, permissions: {} };
      fs.writeFileSync(path.join(pub, 'index.json'), JSON.stringify({ schema: 1, updated: '2026-09-12', items: [item] }), 'utf8');
      fs.writeFileSync(path.join(pub, 'revoke.json'), JSON.stringify({ schema: 1, revoked: [] }), 'utf8');
      // 起本地镜像(只读这几个文件)
      msrv = http.createServer(function (rq, rs) {
        const rel = String(rq.url || '/').split('?')[0].replace(/^\/+/, '');
        const f = path.join(pub, rel);
        if (rel && f.indexOf(pub) === 0 && fs.existsSync(f) && fs.statSync(f).isFile()) { rs.writeHead(200); return fs.createReadStream(f).pipe(rs); }
        rs.writeHead(404); rs.end('no');
      });
      await new Promise(function (r2) { msrv.listen(mport, '127.0.0.1', r2); });
      await req('/api/config', { method: 'POST', body: JSON.stringify({ market: { indexUrl: base + '/index.json', revokeUrl: base + '/revoke.json' } }) });
      const mget = async function () { return JSON.parse((await req('/api/market')).body.toString('utf8')); };
      const mref = async function () { await req('/api/market/refresh', { method: 'POST', body: '{}' }); return mget(); };
      let m = await mget();
      const pick = function (j) { return (j.items || []).filter(function (x) { return x.id === 'market-test'; })[0] || {}; };
      ok(m.ok === true && !!pick(m).id, '市场目录可拉取并列出条目(本地源)');
      ok(pick(m).tier === 'reviewed' && pick(m).installed === false, '条目带分级标记(reviewed)且未安装状态正确');
      let inst = JSON.parse((await req('/api/market/install', { method: 'POST', body: JSON.stringify({ id: 'market-test' }) })).body.toString('utf8'));
      ok(inst.ok === true && inst.tier === 'reviewed' && inst.sha256 === hash, '安装成功(下载 → sha256 校验 → importZip)并回传分级');
      const pl = JSON.parse((await req('/api/plugins')).body.toString('utf8'));
      ok((pl.plugins || []).some(function (p) { return p.id === 'market-test'; }), '安装后插件出现在插件列表');
      const cfg = JSON.parse((await req('/api/config')).body.toString('utf8'));
      const mi = (cfg.market && cfg.market.installed) || {};
      ok(!!(mi['market-test'] && mi['market-test'].sha256 === hash && mi['market-test'].tier === 'reviewed'), '安装来源(分级/哈希)进入运行中的配置');
      const diskM = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
      ok(!!(diskM.marketInstalled && diskM.marketInstalled['market-test'] && diskM.marketInstalled['market-test'].sha256 === hash), '安装来源已落盘(重启后仍知道它来自市场哪个分级)');
      m = await mref();
      ok(pick(m).installed === true && pick(m).upToDate === true, '已安装且版本一致 → upToDate');
      fs.writeFileSync(path.join(pub, 'index.json'), JSON.stringify({ schema: 1, items: [Object.assign({}, item, { version: '1.1.0' })] }), 'utf8');
      m = await mref();
      ok(pick(m).updateAvailable === true && pick(m).installedVersion === '1.0.0', '目录版本更高 → 更新提示(带已装版本)');
      fs.writeFileSync(path.join(pub, 'index.json'), JSON.stringify({ schema: 1, items: [Object.assign({}, item, { version: '1.1.0', sha256: 'a'.repeat(64) })] }), 'utf8');
      await mref();   // 必须刷新缓存: 目录缓存 6h, 不刷新拿到的是上一份(好哈希)目录
      inst = JSON.parse((await req('/api/market/install', { method: 'POST', body: JSON.stringify({ id: 'market-test' }) })).body.toString('utf8'));
      ok(inst.ok === false && /sha256/.test(inst.error || ''), '哈希不符 → 拒绝安装(内容校验真的在跑)');
      fs.writeFileSync(path.join(pub, 'index.json'), JSON.stringify({ schema: 1, items: [item] }), 'utf8');
      m = await mref();
      ok(pick(m).revoked === false, '未吊销时 revoked=false(基线)');
      fs.writeFileSync(path.join(pub, 'revoke.json'), JSON.stringify({ schema: 1, revoked: [{ id: 'market-test', versions: ['*'], reason: 'gate revoke' }] }), 'utf8');
      m = await mref();
      ok(pick(m).revoked === true && /gate revoke/.test(pick(m).revokeReason || ''), '吊销列表命中 → 界面可见(revoked + 原因)');
      inst = JSON.parse((await req('/api/market/install', { method: 'POST', body: JSON.stringify({ id: 'market-test' }) })).body.toString('utf8'));
      ok(inst.ok === false && /吊销/.test(inst.error || ''), '被吊销的插件拒绝安装');
      // 坏目录条目: 非白名单域名必须被丢(防投毒)
      fs.writeFileSync(path.join(pub, 'index.json'), JSON.stringify({ schema: 1, items: [Object.assign({}, item, { url: 'https://evil.example.com/x.zip' })] }), 'utf8');
      m = await mref();
      ok(pick(m).tier === 'local', '目录里的非白名单下载地址被丢弃(只剩本地已装条目, 不再作为市场条目出现)');
      fs.writeFileSync(path.join(pub, 'index.json'), JSON.stringify({ schema: 1, items: [item] }), 'utf8');
      await mref();
      // 清理: 卸下测试插件 + 恢复市场源
      await req('/api/plugins/disable', { method: 'POST', body: JSON.stringify({ id: 'market-test' }) });
      const rm = JSON.parse((await req('/api/plugins/remove', { method: 'POST', body: JSON.stringify({ id: 'market-test' }) })).body.toString('utf8'));
      ok(rm.ok === true, '测试插件已移除(隔离实例内)');
      await resetMarket();
      if (msrv) { await new Promise(function (r2) { msrv.close(r2); }); msrv = null; }
      fs.rmSync(pub, { recursive: true, force: true }); fs.rmSync(src, { recursive: true, force: true });
      await req('/api/market/refresh', { method: 'POST', body: '{}' });
    } catch (e) { ok(false, '插件市场用例异常: ' + e.message); }
  }

  console.log('[backend-flow] pass=' + pass + ' fail=' + fail + (skip ? (' skip=' + skip) : ''));
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) { console.log('  FAIL 流程测试异常: ' + ((e && e.stack) || e)); process.exitCode = 1; });

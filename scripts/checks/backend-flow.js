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

  console.log('[backend-flow] pass=' + pass + ' fail=' + fail + (skip ? (' skip=' + skip) : ''));
  process.exitCode = fail ? 1 : 0;
})().catch(function (e) { console.log('  FAIL 流程测试异常: ' + ((e && e.stack) || e)); process.exitCode = 1; });

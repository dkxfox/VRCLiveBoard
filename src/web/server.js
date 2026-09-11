'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { setAutostart, isEnabled } = require('../autostart');
const { diagnose } = require('../diagnose');
const { runOnce: runOcrTranslate, getLtStatus } = require('../ocrtranslate');
const { installPortablePython, existsPython, pyExe } = require('../portablepy');
const { resolvePython } = require('../pyhelper');
const { checkUpdate, compareVersions } = require('../versioncheck');
const { execFile, execFileSync, spawn } = require('child_process');
const { setConsoleVisible } = require('../consolewin');
const devgate = require('../devgate');
const swearfilter = require('../swearfilter');
const { DEFAULT_BLOCK_WORDS } = require('../ocrtranslate');

function createServer(opts) {
  const composer = opts.composer;
  const logger = opts.logger;
  const webCfg = opts.web;
  const rootConfig = opts.config;
  const configPath = opts.configPath;
  const publicDir = path.join(__dirname, 'public');
  const projectRoot = path.join(__dirname, '..', '..');
  const envState = { running: false, msg: '', ok: null };
  const unlockState = { level1: false, level2: false }; // 会话级解锁, 重启自动恢复锁定
const PLUGIN_SEC_DEFAULTS = { networkPolicy: 'whitelist', processPolicy: 'consent', fsWritePolicy: 'sandbox', fsReadPolicy: 'self', aiPolicy: 'allow' };
function effPluginSec() {
  return Object.assign({}, PLUGIN_SEC_DEFAULTS, (rootConfig.plugins && rootConfig.plugins.security) || {});
}
  let gateFails = []; // 密码门失败时间戳(防爆破节流)
  const pluginManager = opts.pluginManager || null;
  const oscSender = opts.osc || null;
 // 统一退出/重启钩子: 由 src/main.js 负责停服务、杀 python 助手、释放端口后再退出(M-20260911-07)
 const onQuit = opts.onQuit || null;
 const onRestart = opts.onRestart || null;
  let actualWebPort = webCfg.port;

  // ===== 端口体检 =====
  // 异步执行 netstat: 原实现用 execFileSync, 端口体检期间会**卡住整个事件循环**(composer/OSC 一起停摆),
  // 而 netstat 在 Windows 上要几百毫秒(M-20260911-12)
  function netstatTable() {
    return new Promise(function (resolve, reject) {
      execFile('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 8000 }, function (err, raw) {
        if (err) return reject(err);
        const rows = [];
        for (const line of String(raw).split(/\r?\n/)) {
          const m = /^\s*(TCP|UDP)\s+(\S+)\s+(\S+)\s*(LISTENING|ESTABLISHED|\S*)?\s+(\d+)\s*$/.exec(line);
          if (m) rows.push({ proto: m[1], local: m[2], foreign: m[3], state: m[4] || '', pid: Number(m[5]) });
        }
        resolve(rows);
      });
    });
  }
  function pidNames() {
    return new Promise(function (resolve) {
      const map = {};
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 8000 }, function (err, raw) {
        if (err) noteFail('pidNames', err);
        else {
          for (const line of String(raw).split(/\r?\n/)) {
            const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
            if (m) map[m[2]] = m[1];
          }
        }
        resolve(map);
      });
    });
  }
  async function udpProbe(port) {
    // 2026-09-03 修正(M-20260903-02): bind 探测在 Windows 上不可靠 —— Node UDP 默认 SO_REUSEADDR,
    // VRChat 已持 0.0.0.0:9000 时我们对 127.0.0.1:9000 的 bind 仍会成功 → 永远报"空闲"。
    // 改为查 netstat UDP 端点表: 有进程持续绑定该端口才算占用。
    try {
      const rows = await netstatTable();
      const hit = rows.find(function (r) { return r.proto === 'UDP' && new RegExp(':' + port + '$').test(r.local); });
      return { occupied: !!hit };
    } catch (e) { return { occupied: null, note: String(e.message) }; }
  }
  async function portCheck() {
    const out = { udp9000: null, tcpAround: [], vrc: null };
    out.udp9000 = await udpProbe(9000);
    if (out.udp9000 && out.udp9000.occupied) {
      try {
        const rows = await netstatTable();
        const hit = rows.find(function (r) { return r.proto === 'UDP' && /:9000$/.test(r.local); });
        if (hit) {
          const names = await pidNames();
          out.udp9000.pid = hit.pid;
          out.udp9000.name = names[hit.pid] || ('PID ' + hit.pid);
        }
      } catch(e){noteFail('portCheck',e);}
    }
    try {
      const both = await Promise.all([netstatTable(), pidNames()]); // 并行: 两次进程调用不再串行等待
      const rows = both[0];
      const names = both[1];
      for (const r of rows) {
        if (r.proto === 'TCP' && r.state === 'LISTENING') {
          const m = /:(\d+)$/.exec(r.local);
          if (m) {
            const p = Number(m[1]);
            if (p >= 19180 && p <= 19230) out.tcpAround.push({ port: p, addr: r.local, pid: r.pid, name: names[r.pid] || ('PID ' + r.pid) });
          }
        }
      }
    } catch(e){noteFail('端口体检',e);}
    try {
      const vrc = require('../vrcstatus').getVrcStatus();
      out.vrc = { running: !!vrc.running, oscEnabled: !!vrc.oscEnabled, oscPort: vrc.oscPort || null };
    } catch(e){noteFail('端口体检',e);}
    return out;
  }

  function persist() {
    try { require('../configio').writeConfigAtomic(configPath, rootConfig); return true; } catch (e) { logger.error('config 写入失败: ' + e.message); return false; }
  }
  // 图片类静态资源: 用 ETag + no-cache 代替 no-store —— 每次仍向服务器校验(换图立刻生效),
  // 但内容没变就回 304(几百字节), 不必重下几十 KB~几 MB(M-20260911-11)
  const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.svg'];
  const IMG_CT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
  function serveAsset(req, res, f) {
    const ext = path.extname(f).toLowerCase();
    if (IMG_EXT.indexOf(ext) < 0) return serveFile(res, f);
    fs.stat(f, function (err, st) {
      if (err) return json(res, 404, { ok: false });
      const etag = 'W/"' + st.size.toString(16) + '-' + Math.round(st.mtimeMs).toString(16) + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      fs.readFile(f, function (e2, data) {
        if (e2) return json(res, 404, { ok: false });
        res.writeHead(200, { 'Content-Type': IMG_CT[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag, 'Content-Length': data.length });
        res.end(data);
      });
    });
  }
  function serveFile(res, f) {
    fs.readFile(f, function (err, data) {
      if (err) return json(res, 404, { ok: false });
      const ext = path.extname(f);
      const ct = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'application/octet-stream';
      // no-store: 界面热更新必须每次都拿最新文件, 杜绝缓存旧页面
      res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }
  // 统一的失败上报(与前端 apiFail 对称): 空 catch 会让故障彻底静默, 排查时只剩一句"没反应"。
  // 按位置去重, 同一处只报一次, 避免高频接口刷屏(M-20260911-12)
  const _failSeen = {};
  function noteFail(where, err) {
    try { const k = String(where); if (_failSeen[k]) return; _failSeen[k] = 1; } catch (e) { return; }
    try { logger.warn('[静默失败] ' + where + ': ' + String((err && err.message) || err)); } catch (e) {}
  }
  function json(res, code, o) {
    const b = JSON.stringify(o);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(b);
  }
  function needL1(res) {
    if (!unlockState.level1) { json(res, 403, { ok: false, error: '需要一级密码解锁' }); return true; }
    return false;
  }
  function originAllowed(req) {
    // 浏览器跨站 POST 必须拦截(恶意网页攻击面); 无 Origin 的非浏览器客户端(加密狗/curl/Node)放行
    const o = req.headers.origin || req.headers.referer || '';
    if (!o) return true;
    try {
      const u = new URL(o);
      return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
    } catch (e) { return false; }
  }
  function readBody(req, cb) {
    let b = '', done = false;
    function finish(body) { if (done) return; done = true; cb(body); }
    req.on('data', function (d) {
      if (done) return;
      b += d;
      // 超限: 清空并断开。必须仍然回调一次 —— 否则调用方永远等不到 body, 请求挂死(客户端只看到卡住)(M-20260911-12)
      if (b.length > 262144) { b = ''; try { req.destroy(); } catch(e){noteFail('finish',e);} finish(''); }
    });
    req.on('end', function () { finish(b); });
    req.on('error', function () { finish(''); });
    req.on('aborted', function () { finish(''); });
  }
  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    // 跨站防护: 浏览器发起的写操作必须来自本机页面(恶意网页拦截); 无 Origin 的本地客户端放行
    if (req.method === 'POST' && !originAllowed(req)) return json(res, 403, { ok: false, error: '已拒绝跨站请求' });
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(res, path.join(publicDir, 'index.html'));
    if (req.method === 'GET' && url.pathname.indexOf('/api/') !== 0 && url.pathname !== '/') {
      // 静态资源(如 /lang.js): URL 解码 + 防目录穿越(禁 .. 与 / 与 \), 兼容中文/空格等文件名
      let rel;
      try { rel = decodeURIComponent(url.pathname.slice(1)); } catch (e) { rel = url.pathname.slice(1); }
      if (rel && rel.indexOf('..') < 0 && rel.indexOf('\\') < 0 && rel.indexOf('/') < 0) {
        const f = path.join(publicDir, rel);
        if (fs.existsSync(f)) return serveAsset(req, res, f);
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/version') {
      try { const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')); return json(res, 200, { version: pkg.version || '0.0.0' }); }
      catch (e) { return json(res, 200, { version: 'unknown' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/version/check') {
      const force = url.searchParams.get('force') === '1';
      checkUpdate(rootConfig, force).then(function (r) {
        let cur = '0.0.0';
        try { cur = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version || cur; } catch(e){noteFail('/api/version/check',e);}
        const newer = r.remote ? compareVersions(r.remote.version, cur) > 0 : false;
        return json(res, 200, { ok: r.ok, current: cur, newer: newer, remote: r.remote, source: r.source });
      }).catch(function (e) { return json(res, 200, { ok: false, error: String(e.message) }); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, Object.assign({ vrcOn: composer.vrcOn, vrc: composer.vrcInfo, time: Date.now() }, composer.status()));
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const srcs = composer.sources.map(function (s) { return { id: s.id, enabled: s.enabled, priority: s.priority, intervalMs: s.intervalMs }; });
      let autostart = !!rootConfig.autostart;
      try { autostart = isEnabled(); } catch(e){noteFail('/api/config',e);}
      const v = (rootConfig.ocrtl && rootConfig.ocrtl.vision) || {};
      const cap = (rootConfig.ocrtl && rootConfig.ocrtl.capture) || {};
      const sec = (rootConfig.ocrtl && rootConfig.ocrtl.security) || {};
      const swf = (rootConfig.chatbox && rootConfig.chatbox.swearFilter) || {};
      // 空安全: 配置段缺失时宁可给空值, 也不能让这个高频接口抛未捕获异常(整个服务会因此不回包)
      const pgCfg = (rootConfig.sources && rootConfig.sources.pages) || {};
      return json(res, 200, { pages: pgCfg.pages || [], rotationMs: pgCfg.rotationMs, sources: srcs, autostart: autostart, desktop: { showConsole: !((rootConfig.desktop || {}).showConsole === false) }, lang: (rootConfig.web && rootConfig.web.lang) || 'zh-CN', ocrtl: { delayMs: (rootConfig.ocrtl || {}).delayMs || 5000, displayMs: (rootConfig.ocrtl || {}).displayMs || 8000, loops: (rootConfig.ocrtl || {}).loops || 2, mode: (rootConfig.ocrtl || {}).mode || 'auto', vision: { apiBase: v.apiBase || '', model: v.model || 'deepseek-v4-flash-vision-exp', hasKey: !!v.apiKey, targetLang: v.targetLang || 'zh' }, capture: { mode: cap.mode || 'window', windowTitle: cap.windowTitle || 'VRChat', region: cap.region || { x: 0, y: 0, w: 0, h: 0 } }, security: { promptDefense: sec.promptDefense !== false, jsonMode: sec.jsonMode !== false, outputSanitize: sec.outputSanitize !== false, extraPrompt: sec.extraPrompt || '', blockWords: sec.blockWords && sec.blockWords.length ? sec.blockWords : DEFAULT_BLOCK_WORDS } }, swearFilter: { enabled: swf.enabled !== false, words: swf.words && swf.words.length ? swf.words : swearfilter.DEFAULTS }, pluginsSecurity: effPluginSec(), branding: (rootConfig.branding || 'default'), specialEvents: (rootConfig.specialEvents || []) });
    }
    if (req.method === 'POST' && (url.pathname === '/v1/chatbox' || url.pathname === '/api/chatbox')) {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const text = String(o.text || '').trim();
          if (!text) return json(res, 400, { ok: false, error: 'text 为空' });
          composer.pushTransient(text, Number(o.priority) || 80, Number(o.ttlMs) || 8000);
          return json(res, 200, { ok: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const pg = (rootConfig.sources && rootConfig.sources.pages && typeof rootConfig.sources.pages === 'object') ? rootConfig.sources.pages : null;
          if (Array.isArray(o.pages)) {
            if (!pg) return json(res, 400, { ok: false, error: '配置缺少 sources.pages 段, 请检查 config.json' });
            pg.pages = o.pages.map(function (p) { return { text: String(p && p.text !== undefined ? p.text : p) }; });
          }
          if (o.rotationMs) {
            const rm = Number(o.rotationMs);
            if (rm >= 3000 && rm <= 300000) { if (!pg) return json(res, 400, { ok: false, error: '配置缺少 sources.pages 段' }); pg.rotationMs = rm; }
          }
          if (o.branding) rootConfig.branding = String(o.branding);
          if (o.specialEvents !== undefined) rootConfig.specialEvents = Array.isArray(o.specialEvents) ? o.specialEvents : [];
          persist();
          return json(res, 200, { ok: true, pageCount: (pg && pg.pages ? pg.pages.length : 0) });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/plugins') {
      return json(res, 200, pluginManager ? pluginManager.status() : { plugins: [], audit: [], api: '2' });
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/enable') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const r = pluginManager.enable(o.id);
          if (r.ok) {
            const list = rootConfig.pluginEnabled || [];
            if (list.indexOf(o.id) < 0) list.push(o.id);
            rootConfig.pluginEnabled = list;
            persist();
          }
          return json(res, r.ok ? 200 : 400, r);
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/disable') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const r = pluginManager.disable(o.id);
          rootConfig.pluginEnabled = (rootConfig.pluginEnabled || []).filter(function (x) { return x !== o.id; });
          persist();
          return json(res, 200, r);
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/approve') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const entry = pluginManager.entries.find(function (e) { return e.id === o.id; });
          if (!entry) return json(res, 404, { ok: false, error: '插件不存在(请先把插件文件夹放进 plugins 目录后刷新)' });
          rootConfig.pluginApprovals = rootConfig.pluginApprovals || {};
          rootConfig.pluginApprovals[o.id] = { hash: pluginManager.hash(entry), at: Date.now() };
          entry.approved = true;
          persist();
          return json(res, 200, { ok: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/import') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          if (!o.path) return json(res, 400, { ok: false, error: '请填写 zip 文件完整路径' });
          const r = pluginManager.importZip(String(o.path));
          return json(res, r.ok ? 200 : 400, r);
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/call') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const entry = pluginManager.entries.find(function (e) { return e.id === o.id; });
          if (!entry || !entry.plugin || !entry.plugin.api || typeof entry.plugin.api[o.method] !== 'function') {
            return json(res, 400, { ok: false, error: '该插件不支持此操作' });
          }
          Promise.resolve(entry.plugin.api[o.method](o.args || {})).then(function (r) {
            rootConfig.plugins = rootConfig.plugins || {};
            rootConfig.plugins[o.id] = entry.settings;
            persist();
            json(res, 200, r);
          }).catch(function (e) { json(res, 400, { ok: false, error: String(e.message) }); });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/plugin/')) {
      const id = url.pathname.slice('/plugin/'.length);
      const entry = pluginManager.entries.find(function (e) { return e.id === id; });
      if (!entry || !entry.plugin || !entry.plugin.page) return json(res, 404, { ok: false, error: '插件页面不存在' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(entry.plugin.page.html());
    }
    if (req.method === 'GET' && url.pathname === '/api/plugins/asset') {
      const id = url.searchParams.get('id');
      const file = url.searchParams.get('file');
      const entry = pluginManager.entries.find(function (e) { return e.id === id; });
      if (!entry) return json(res, 404, { ok: false, error: '插件不存在' });
      // 允许子目录(如 vendor/xlsx.full.min.js), 但必须落在插件目录内(防目录穿越)
      const rel = String(file || '').replace(/\\/g, '/');
      const root = path.resolve(entry.dir);
      const p = path.resolve(root, rel);
      if (p !== root && !p.startsWith(root + path.sep)) return json(res, 403, { ok: false, error: '非法路径' });
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return json(res, 404, { ok: false, error: '文件不存在' });
      const ext = path.extname(p).toLowerCase();
      const ct = ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': ct, 'Content-Disposition': 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(path.basename(p)) });
      return res.end(fs.readFileSync(p));
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/import-config') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const entry = pluginManager.entries.find(function (e) { return e.id === o.id; });
          if (!entry || !entry.plugin || !entry.plugin.importRows) return json(res, 400, { ok: false, error: '该插件不支持文件导入' });
          const buf = Buffer.from(String(o.fileBase64 || ''), 'base64');
          const XLSX = require(path.join(entry.dir, 'vendor', 'xlsx.js'));
          const wb = XLSX.read(buf, { type: 'buffer' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
          const r = entry.plugin.importRows(rows);
          rootConfig.plugins = rootConfig.plugins || {};
          rootConfig.plugins[o.id] = entry.settings;
          persist();
          if (entry.enabled) {
            pluginManager.disable(o.id);
            const rr = pluginManager.enable(o.id);
            if (!rr.ok) return json(res, 400, rr);
          }
          return json(res, 200, { ok: true, count: r.count });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/restart') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const entry = pluginManager.entries.find(function (e) { return e.id === o.id; });
          if (!entry) return json(res, 404, { ok: false, error: '插件不存在' });
          if (entry.enabled) {
            pluginManager.disable(o.id);
            const r = pluginManager.enable(o.id);
            if (!r.ok) return json(res, 400, r);
          }
          return json(res, 200, { ok: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/scan') {
      try {
        const n = pluginManager.scan();
        return json(res, 200, { ok: true, count: n });
      } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/remove') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          pluginManager.disable(o.id);
          const entry = pluginManager.entries.find(function (e) { return e.id === o.id; });
          if (entry) { require('fs').rmSync(entry.dir, { recursive: true, force: true }); }
          rootConfig.pluginApprovals = rootConfig.pluginApprovals || {};
          delete rootConfig.pluginApprovals[o.id];
          rootConfig.pluginEnabled = (rootConfig.pluginEnabled || []).filter(function (x) { return x !== o.id; });
          persist();
          pluginManager.scan();
          return json(res, 200, { ok: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/plugins/panel') {
      const id = url.searchParams.get('id');
      return json(res, 200, pluginManager.panelHtml(id) || null);
    }
    if (req.method === 'POST' && url.pathname === '/api/plugins/config') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const entry = pluginManager.entries.find(function (e) { return e.id === o.id; });
          if (entry) { entry.settings = entry.settings || {}; Object.assign(entry.settings, o.cfg || {}); rootConfig.plugins = rootConfig.plugins || {}; rootConfig.plugins[o.id] = entry.settings; persist(); }
          return json(res, 200, { ok: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/market') {
      return json(res, 200, { items: [], note: '插件市场将在后续版本开放,现阶段请通过群文件获取插件后本地导入。' });
    }
    if (req.method === 'POST' && url.pathname === '/api/ocrtl-vision') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const v = rootConfig.ocrtl.vision = rootConfig.ocrtl.vision || {};
          if (o.apiBase !== undefined) v.apiBase = String(o.apiBase || '');
          if (o.apiKey !== undefined) v.apiKey = String(o.apiKey || '');
          if (o.model !== undefined) v.model = String(o.model || '');
          if (o.targetLang !== undefined) v.targetLang = String(o.targetLang || 'zh');
          persist();
          return json(res, 200, { ok: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/lang') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const allowed = ['zh-CN', 'zh-TW', 'en'];
          if (allowed.indexOf(o.lang) < 0) return json(res, 400, { ok: false, error: '不支持的语言' });
          rootConfig.web.lang = o.lang;
          persist();
          return json(res, 200, { ok: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/env') {
      let systemPy = { found: false, version: null };
      try { systemPy = { found: true, version: String(execFileSync('python', ['-V'], { timeout: 15000, windowsHide: true, encoding: 'utf8' })).trim() }; } catch(e){noteFail('/api/env',e);}
      const pyCmd = resolvePython(projectRoot);
      return json(res, 200, {
        node: { ok: true, version: process.version },
        systemPython: systemPy,
        portablePython: existsPython(projectRoot),
        media: { ok: !!pyCmd, pythonCmd: pyCmd },
        livetranslate: getLtStatus(rootConfig.ocrtl || {}),
        install: envState
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/env/install-python') {
      if (envState.running) return json(res, 409, { ok: false, error: '正在安装中' });
      envState.running = true; envState.msg = '准备中...'; envState.ok = null;
      installPortablePython(projectRoot, logger, function (m) { envState.msg = m; }).then(function (r) {
        envState.running = false;
        envState.ok = r.ok;
        envState.msg = r.ok ? '安装完成, 正在重启听歌功能...' : ('安装失败: ' + r.error);
        if (r.ok) {
          const media = composer.sources.find(function (s) { return s.id === 'media'; });
          if (media && media.restart) { try { media.restart(); envState.msg = '安装完成, 听歌功能已启用'; } catch(e){noteFail('端口体检',e);} }
        }
      });
      return json(res, 200, { ok: true, started: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/env/install-winsdk') {
      const root = path.join(__dirname, '..');
      let py = null;
      if (existsPython(root)) py = pyExe(root);
      else {
        try {
          const chk = execFileSync('python', ['-c', 'import sys; print(sys.version.split()[0])'], { timeout: 20000, windowsHide: true, encoding: 'utf8' });
          if (String(chk).trim()) py = 'python';
        } catch(e){noteFail('/api/env/install-winsdk',e);}
      }
      if (!py) return json(res, 500, { ok: false, error: '未找到可用 Python: 请先点环境检测里的 Python 一键安装按钮(便携版), 完成后再装 winsdk' });
      const steps = [
        ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel', '--no-input', '--timeout', '60'],
        ['-m', 'pip', 'install', 'winsdk', '--no-input', '--timeout', '60', '--only-binary', ':all:']
      ];
      let step = 0;
      const runNext = function () {
        if (step >= steps.length) {
          execFile(py, ['-c', 'import winsdk; print("winsdk-ok")'], { timeout: 30000, windowsHide: true }, function (e2, so) {
            if (e2 || String(so).indexOf('winsdk-ok') < 0) return json(res, 500, { ok: false, error: 'winsdk 安装后验证失败, 请重试; 仍失败可先装便携版 Python(自带 winsdk)' });
            const media = composer.sources.find(function (s) { return s.id === 'media'; });
            if (media && media.restart) { try { media.restart(); } catch(e3){noteFail('端口体检',e3);} }
            json(res, 200, { ok: true });
          });
          return;
        }
        const args = steps[step];
        step++;
        execFile(py, args, { timeout: 600000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, function (err, stdout, stderr) {
          if (err) {
            const tail = String(stderr || '').split(/\r?\n/).filter(Boolean).slice(-6).join(' | ');
            return json(res, 500, { ok: false, error: 'winsdk 安装失败(' + (step === 2 ? '安装' : '升级 pip') + '步骤): ' + tail.slice(-280) + '。若为网络错误: 可先点环境检测的 Python 一键安装按钮(便携版自带 winsdk)' });
          }
          runNext();
        });
      };
      runNext();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/special/upload') {
      const name = String(req.headers['x-filename'] || ('video-' + Date.now() + '.mp4')).replace(/[\\/:*?"<>|]/g, '_');
      const dir = path.join(__dirname, '..', '..', 'assets', 'videos');
      try { fs.mkdirSync(dir, { recursive: true }); } catch(e){noteFail('/api/special/upload',e);}
      const chunks = []; let total = 0;
      req.on('data', function (c) { chunks.push(c); total += c.length; if (total > 300 * 1024 * 1024) { json(res, 413, { ok: false, error: '视频超过 300MB 上限' }); req.destroy(); } });
      req.on('end', function () {
        const buf = Buffer.concat(chunks);
        const f = path.join(dir, name);
        try { fs.writeFileSync(f, buf); json(res, 200, { ok: true, file: 'assets/videos/' + name, size: buf.length }); }
        catch (e) { json(res, 400, { ok: false, error: String(e.message) }); }
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/special/video') {
      const rel = (url.searchParams && url.searchParams.get('file')) || ((rootConfig.specialVideo && rootConfig.specialVideo.file) || '');
      if (!rel) return json(res, 404, { ok: false, error: '未配置特殊彩蛋视频' });
      // 安全: 本接口只服务工程内 assets/ 下的彩蛋视频(上传接口写入的也是 assets/videos/)。
      // 防 ../ 与绝对路径导致的本机任意文件读 —— 注意 config.json 就在工程根内, 只挡"根外"挡不住它(M-20260911-02)
      const rootDir = path.resolve(__dirname, '..', '..');
      const assetsDir = path.join(rootDir, 'assets');
      const f = path.resolve(rootDir, rel);
      if (f !== assetsDir && f.indexOf(assetsDir + path.sep) !== 0) return json(res, 403, { ok: false, error: '路径非法' });
      return fs.stat(f, function (err, stat) {
        if (err) return json(res, 404, { ok: false });
        const total = stat.size; const range = req.headers.range; let start = 0, end = total - 1; let ranged = false;
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          if (m) {
            if (m[1] === '' && m[2] !== '') { const n = parseInt(m[2], 10) || 0; start = Math.max(0, total - n); end = total - 1; } // 后缀区间 bytes=-N
            else { if (m[1]) start = parseInt(m[1], 10) || 0; end = m[2] ? (parseInt(m[2], 10) || 0) : total - 1; }
            // 区间不可满足(如 bytes=5000-100)按 HTTP 规范回 416; 原实现会算出负 Content-Length, createReadStream 直接抛错且响应永不结束(M-20260911-12)
            if (start < 0 || start >= total || end < start) { res.writeHead(416, { 'Content-Range': 'bytes */' + total, 'Accept-Ranges': 'bytes' }); return res.end(); }
            if (end >= total) end = total - 1;
            ranged = true; // 只有真正解析出合法区间才回 206; 非法 Range 头按规范忽略
          }
        }
        const ct = path.extname(f).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';
        if (ranged) { res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': ct }); fs.createReadStream(f, { start: start, end: end }).pipe(res); }
        else { res.writeHead(200, { 'Content-Length': total, 'Content-Type': ct, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f).pipe(res); }
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/icon') {
      const iconPath = path.join(__dirname, '..', '..', '软件图标.png');
      return serveFile(res, iconPath);
    }
    if (req.method === 'GET' && url.pathname === '/api/ocrtl-lt') {
      return json(res, 200, getLtStatus(rootConfig.ocrtl || {}));
    }
    if (req.method === 'GET' && url.pathname === '/api/capture/preview') {
      const script = path.join(__dirname, '..', 'helpers', 'screen_capture.ps1');
      const tmp = path.join(projectRoot, '.ocr-preview.png');
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-mode', 'screen', '-scale', '1', '-maxdim', '1600', '-out', tmp], { timeout: 20000, windowsHide: true }, function (err, stdout) {
        if (String(stdout || '').indexOf('CAPTURE-FAIL') >= 0) {
          try { fs.unlinkSync(tmp); } catch(e2){noteFail('/api/capture/preview',e2);}
          return json(res, 500, { ok: false, error: '截图失败(沙箱或权限限制), 可稍后重试' });
        }
        if (err || !fs.existsSync(tmp)) {
          try { fs.unlinkSync(tmp); } catch(e2){noteFail('端口体检',e2);}
          return json(res, 500, { ok: false, error: '截图失败: ' + (err ? err.message : '无输出') });
        }
        fs.readFile(tmp, function (e3, data) {
          try { fs.unlinkSync(tmp); } catch(e4){noteFail('端口体检',e4);}
          if (e3) return json(res, 500, { ok: false, error: '读取截图失败' });
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
          return res.end(data);
        });
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/capture/set') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          rootConfig.ocrtl = rootConfig.ocrtl || {};
          const cap = rootConfig.ocrtl.capture = rootConfig.ocrtl.capture || {};
          if (o.mode && ['window', 'region', 'screen'].indexOf(o.mode) >= 0) cap.mode = o.mode;
          if (!cap.mode) cap.mode = 'window';
          if (o.windowTitle !== undefined) cap.windowTitle = String(o.windowTitle || 'VRChat');
          if (o.region) {
            cap.region = {
              x: Math.max(0, Math.round(Number(o.region.x) || 0)),
              y: Math.max(0, Math.round(Number(o.region.y) || 0)),
              w: Math.max(0, Math.round(Number(o.region.w) || 0)),
              h: Math.max(0, Math.round(Number(o.region.h) || 0))
            };
          }
          persist();
          return json(res, 200, { ok: true, capture: cap });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/ocrtl') {
      return readBody(req, function (body) {
        let overrides = {};
        try { overrides = JSON.parse(body || '{}'); } catch(e){noteFail('/api/ocrtl',e);}
        runOcrTranslate(rootConfig.ocrtl || {}, composer, logger, overrides).then(function (r) { json(res, 200, r); });
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/devgate/status') {
      const dc = rootConfig.devchain;
      const g = rootConfig.gate || {};
      const lockLeft = (g.l1LockUntil && Date.now() < g.l1LockUntil) ? Math.ceil((g.l1LockUntil - Date.now()) / 1000) : 0;
      return json(res, 200, { level1: unlockState.level1, level2: unlockState.level2, l1LockRemainingSec: lockLeft, devRemaining: (dc && dc.remaining !== undefined) ? dc.remaining : null });
    }
    if (req.method === 'POST' && url.pathname === '/api/devgate/verify') {
      return readBody(req, function (body) {
        try {
          const now = Date.now();
          const gate = rootConfig.gate || (rootConfig.gate = { l1Fails: 0, l1LockUntil: 0, l1LockCount: 0 });
          const o = JSON.parse(body || '{}');
          const lv = Number(o.level) === 2 ? 2 : 1;
          // 一级锁死(限时阶梯, 落盘): 锁定期内连正确密码也拒; L2 开发者密码不受影响(备用钥匙)
          if (lv === 1 && gate.l1LockUntil && now < gate.l1LockUntil) {
            return json(res, 423, { ok: false, error: '一级密码已锁定', lockRemainingSec: Math.ceil((gate.l1LockUntil - now) / 1000) });
          }
          // 简单防爆破: 失败次数 10 次/10 秒 节流(本地进程本可读配置文件, 这里防自动化脚本)
          gateFails = (gateFails || []).filter(function (t2) { return now - t2 < 10000; });
          // 锁死期间 L2(开发者备用钥匙)不受普通节流影响; 平时仍按 10次/10秒 节流
          if (gateFails.length >= 10 && !(lv === 2 && gate.l1LockUntil && now < gate.l1LockUntil)) return json(res, 429, { ok: false, error: '尝试过于频繁, 请稍后再试' });
          if (lv === 2) {
            if (!rootConfig.devchain) {
              try {
                const cur = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
                if (cur && cur.devchain) rootConfig.devchain = cur.devchain;
              } catch(e){noteFail('端口体检',e);}
            }
            const r = devgate.verifyDev(o.code, rootConfig.devchain);
            if (!r.ok) { gateFails.push(Date.now()); return json(res, 400, { ok: false, error: r.reason }); }
            rootConfig.devchain = r.newState;
            // L2 是备用钥匙: 成功即清零一级锁死状态
            gate.l1Fails = 0; gate.l1LockUntil = 0; gate.l1LockCount = 0;
            persist();
            unlockState.level1 = true;
            unlockState.level2 = true;
            return json(res, 200, { ok: true, level1: true, level2: true });
          }
          if (!devgate.verifyL1(o.code, rootConfig.level1Password)) {
            gateFails.push(Date.now());
            gate.l1Fails = (gate.l1Fails || 0) + 1;
            if (gate.l1Fails >= 10) {
              // 阶梯锁死: 第 1 次锁 5 分钟, 第 2 次 30 分钟, 之后 24 小时(落盘, 重启不清零)
              gate.l1LockCount = (gate.l1LockCount || 0) + 1;
              const mins = gate.l1LockCount === 1 ? 5 : (gate.l1LockCount === 2 ? 30 : 1440);
              gate.l1LockUntil = Date.now() + mins * 60000;
              gate.l1Fails = 0;
              persist();
              return json(res, 423, { ok: false, error: '一级密码已锁定', lockRemainingSec: mins * 60 });
            }
            persist();
            return json(res, 400, { ok: false, error: '密码不正确或未注册' });
          }
          gate.l1Fails = 0; gate.l1LockUntil = 0; gate.l1LockCount = 0;
          persist();
          unlockState.level1 = true;
          return json(res, 200, { ok: true, level1: unlockState.level1, level2: unlockState.level2 });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/security') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const hasPs = !!(o.pluginsSecurity && typeof o.pluginsSecurity === 'object');
          const hasOther = Object.keys(o).some(function (k) { return k !== 'pluginsSecurity'; });
          // 提示词防线等一级字段仍一级; 插件安全策略 0 级可"单向收紧 + 恢复默认"(条目 98 用户拍板)
          if (hasOther && !unlockState.level1) return json(res, 403, { ok: false, error: '需要一级密码解锁' });
          if (hasPs) {
            rootConfig.plugins = rootConfig.plugins || {};
            const ps = rootConfig.plugins.security = Object.assign({}, PLUGIN_SEC_DEFAULTS, rootConfig.plugins.security || {});
            // 宽松 -> 严格 顺序; 0 级只允许向后收紧或回到默认值(默认 = 安全基线, 公开版无一级密码也不会被自己锁死)
            const ORDER = { networkPolicy: ['whitelist', 'localOnly', 'off'], processPolicy: ['consent', 'deny'], fsWritePolicy: ['declared', 'sandbox', 'deny'], fsReadPolicy: ['declared', 'self', 'deny'], aiPolicy: ['allow', 'localOnly', 'off'] };
            for (const k of Object.keys(ORDER)) {
              if (o.pluginsSecurity[k] === undefined) continue;
              const v = o.pluginsSecurity[k];
              const list = ORDER[k];
              const idx = list.indexOf(v);
              if (idx < 0) return json(res, 400, { ok: false, error: '插件安全策略非法值: ' + k + '=' + v });
              if (!unlockState.level1) {
                const curIdx = list.indexOf(ps[k]);
                if (idx < curIdx && v !== PLUGIN_SEC_DEFAULTS[k]) return json(res, 403, { ok: false, error: '插件安全策略只能单向收紧: ' + k + ' 从 ' + ps[k] + ' 放宽到 ' + v + ' 需要一级密码解锁(恢复默认 ' + PLUGIN_SEC_DEFAULTS[k] + ' 除外)' });
              }
              ps[k] = v;
            }
          }
          let sec = null;
          if (hasOther) {
            rootConfig.ocrtl = rootConfig.ocrtl || {};
            sec = rootConfig.ocrtl.security = rootConfig.ocrtl.security || {};
            if (o.promptDefense !== undefined) sec.promptDefense = o.promptDefense !== false;
            if (o.jsonMode !== undefined) sec.jsonMode = o.jsonMode !== false;
            if (o.outputSanitize !== undefined) sec.outputSanitize = o.outputSanitize !== false;
            if (o.extraPrompt !== undefined) sec.extraPrompt = String(o.extraPrompt || '').slice(0, 2000);
            if (Array.isArray(o.addWords)) {
              sec.blockWords = sec.blockWords && sec.blockWords.length ? sec.blockWords : DEFAULT_BLOCK_WORDS.slice();
              for (const w of o.addWords) { const s = String(w).trim(); if (s && sec.blockWords.indexOf(s) < 0) sec.blockWords.push(s); }
            }
          }
          persist();
          return json(res, 200, { ok: true, security: sec, pluginsSecurity: effPluginSec() });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/security-words') {
      if (!unlockState.level2) return json(res, 403, { ok: false, error: '需要开发者密码解锁' });
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          rootConfig.ocrtl = rootConfig.ocrtl || {};
          const sec = rootConfig.ocrtl.security = rootConfig.ocrtl.security || {};
          if (Array.isArray(o.words)) sec.blockWords = o.words.map(function (s) { return String(s).trim(); }).filter(Boolean);
          if (o.resetDefaults === true) sec.blockWords = DEFAULT_BLOCK_WORDS.slice();
          persist();
          return json(res, 200, { ok: true, blockWords: sec.blockWords || DEFAULT_BLOCK_WORDS });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/swearfilter') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          // 开关 = 零级; 加词 = 一级
          if (Array.isArray(o.addWords) && !unlockState.level1) return json(res, 403, { ok: false, error: '需要一级密码解锁' });
          rootConfig.chatbox = rootConfig.chatbox || {};
          rootConfig.chatbox.swearFilter = rootConfig.chatbox.swearFilter || {};
          if (o.enabled !== undefined) rootConfig.chatbox.swearFilter.enabled = o.enabled === true;
          if (Array.isArray(o.addWords)) {
            const wf = rootConfig.chatbox.swearFilter;
            wf.words = wf.words && wf.words.length ? wf.words : swearfilter.DEFAULTS.slice();
            for (const w of o.addWords) { const s = String(w).trim(); if (s && wf.words.indexOf(s) < 0) wf.words.push(s); }
          }
          persist();
          return json(res, 200, { ok: true, swearFilter: rootConfig.chatbox.swearFilter });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/swearfilter-words') {
      if (!unlockState.level2) return json(res, 403, { ok: false, error: '需要开发者密码解锁' });
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          rootConfig.chatbox = rootConfig.chatbox || {};
          rootConfig.chatbox.swearFilter = rootConfig.chatbox.swearFilter || {};
          if (Array.isArray(o.words)) {
            rootConfig.chatbox.swearFilter.words = o.words.map(function (s) { return String(s).trim(); }).filter(Boolean);
          }
          if (o.resetDefaults === true) rootConfig.chatbox.swearFilter.words = swearfilter.DEFAULTS.slice();
          persist();
          return json(res, 200, { ok: true, swearFilter: rootConfig.chatbox.swearFilter });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/logs') {
      return json(res, 200, { lines: logger.tail(Number(url.searchParams.get('tail')) || 200) });
    }
    if (req.method === 'POST' && url.pathname === '/api/desktop/console') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          rootConfig.desktop = rootConfig.desktop || {};
          rootConfig.desktop.showConsole = o.visible !== false;
          persist();
          setConsoleVisible(rootConfig.desktop.showConsole);
          return json(res, 200, { ok: true, showConsole: rootConfig.desktop.showConsole });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/desktop/quit') {
      json(res, 200, { ok: true });
      if (onQuit) return setTimeout(function () { try { onQuit(); } catch (e) { logger.error('退出失败: ' + e.message); process.exit(0); } }, 300);
      return setTimeout(function () {
        try {
          if (process.env.VRCB_EMBEDDED === '1') require('electron').app.quit();
          else process.exit(0);
        } catch (e) { process.exit(0); }
      }, 300);
    }
    if (req.method === 'POST' && url.pathname === '/api/desktop/restart') {
      json(res, 200, { ok: true });
      // 重启前先走统一退出: 否则新进程可能抢不到端口, 被端口回退推到别的端口,
      // 而桌面壳还指向旧端口 → 白屏(M-20260911-07 与 M-20260911-08 的组合问题)
      const relaunch = function () {
        try {
          if (process.env.VRCB_EMBEDDED === '1') {
            require('electron').app.relaunch();
            require('electron').app.exit(0);
          } else {
            spawn(process.execPath, [path.join(__dirname, '..', 'main.js')], { cwd: projectRoot, stdio: 'inherit', detached: true }).unref();
            process.exit(0);
          }
        } catch (e) { process.exit(0); }
      };
      if (onRestart) return setTimeout(function () { try { onRestart(relaunch); } catch (e) { logger.error('重启失败: ' + e.message); relaunch(); } }, 300);
      return setTimeout(relaunch, 300);
    }
    if (req.method === 'POST' && url.pathname === '/api/devdocs/open') {
      try {
        const dir = path.join(projectRoot, '开发者文档');
        if (process.env.VRCB_EMBEDDED === '1') {
          // 桌面版: 用 Electron 原生 API 打开资源管理器(可靠, 窗口会前置)
          try { require('electron').shell.openPath(dir); } catch(e2){noteFail('/api/devdocs/open',e2);}
        } else {
          // 纯 Node 版: cmd /c start 打开文件夹
          spawn('cmd.exe', ['/c', 'start', '', dir], { windowsHide: true, detached: true }).unref();
        }
        return json(res, 200, { ok: true, dir: dir });
      } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/diagnose') {
      return diagnose({ config: rootConfig, composer: composer }).then(function (r) { return portCheck().then(function (pc) { r.ports = pc; json(res, 200, r); }); }).catch(function (e) { json(res, 500, { ok: false, error: String(e.message) }); });
    }
    if (req.method === 'POST' && url.pathname === '/api/autostart') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const on = !!o.enabled;
          const r = setAutostart(on, opts.projectDir, logger);
          if (r.ok) { rootConfig.autostart = on; persist(); }
          return json(res, r.ok ? 200 : 500, r);
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/sources') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const src = composer.sources.find(function (s) { return s.id === o.id; });
          if (!src) return json(res, 404, { ok: false, error: '未知数据源: ' + o.id });
          if (o.enabled !== undefined) {
            src.enabled = !!o.enabled;
            if (rootConfig.sources[src.id]) rootConfig.sources[src.id].enabled = !!o.enabled;
          }
          if (o.priority !== undefined) {
            const p = Math.min(999, Math.max(-999, Math.round(Number(o.priority) || 0)));
            src.priority = p;
            rootConfig.sources = rootConfig.sources || {};
            if (rootConfig.sources[src.id]) rootConfig.sources[src.id].priority = p;
          }
          persist();
          return json(res, 200, { ok: true, id: src.id, enabled: src.enabled, priority: src.priority });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    // ===== 网络端口(零级, 无需密码; POST 统一走顶部跨站守卫) =====
    if (req.method === 'GET' && url.pathname === '/api/config/export') {
      if (needL1(res)) return;
      return json(res, 200, { ok: true, filename: 'VRCLiveBoard-config-' + new Date().toISOString().slice(0, 10) + '.json', config: rootConfig });
    }
    if (req.method === 'POST' && url.pathname === '/api/config/import') {
      if (needL1(res)) return;
      return readBody(req, function (body) {
        try {
          const o = require('../configio').safeParse(body || '{}');
          // 兼容两种形状: 控制台导出的信封 {ok,filename,config} 与用户直接拖进来的裸 config.json
          const cfg = (o && typeof o === 'object' && o.config && typeof o.config === 'object') ? o.config : o;
          if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return json(res, 400, { ok: false, error: '无效配置' });
          // 必须长得像真配置: 至少一个核心段, 且它必须是**对象**(数组不算)。
          // 控制台 GET /api/config 返回的是扁平视图(sources 是数组), 拿它当导入源会顶掉配置段(M-20260911-06)
          const coreObj = ['web', 'osc', 'chatbox', 'sources'].some(function (k) { return cfg[k] && typeof cfg[k] === 'object' && !Array.isArray(cfg[k]); });
          if (!coreObj) return json(res, 400, { ok: false, error: '无效配置(缺少核心字段)' });
          // 导入前先把当前配置留档 config.json.bak, 防止编码损坏后无回滚
          try { fs.writeFileSync(configPath + '.bak', fs.readFileSync(configPath)); } catch(e){noteFail('网络端口(零级, 无需密码; P',e);}
          // 必须同时更新内存: 只写文件的话, 之后任何一次 persist() 都会用旧内存把导入结果覆盖掉(M-20260911-06)
          require('../configio').applyInPlace(rootConfig, cfg);
          if (!persist()) return json(res, 500, { ok: false, error: '配置写入失败' });
          logger.info('配置已从控制台导入并应用(重启后完全生效)');
          return json(res, 200, { ok: true, needRestart: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    // 前端错误上报(诊断用): 页面 JS 报错写进日志, 便于远程排障
    if (req.method === 'POST' && url.pathname === '/api/fe-err') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          logger.warn('[前端] ' + String(o.msg || '未知错误') + (o.line ? ' @line ' + o.line : '') + (o.ua ? ' | ' + String(o.ua).slice(0, 80) : ''));
        } catch(e){noteFail('/api/fe-err',e);}
        return json(res, 200, { ok: true });
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/ports') {
      const oscCfg = rootConfig.osc || {};
      return json(res, 200, {
        web: { configured: webCfg.port, actual: actualWebPort, host: webCfg.host },
        osc: { host: oscCfg.host || '127.0.0.1', port: oscCfg.port || 9000 },
        oscIn: { port: (rootConfig.oscIn && rootConfig.oscIn.port) || 9001 }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/ports/osc') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const p = Math.round(Number(o.port));
          if (!(p >= 1 && p <= 65535)) return json(res, 400, { ok: false, error: '端口需在 1-65535' });
          rootConfig.osc = rootConfig.osc || {};
          rootConfig.osc.port = p;
          persist();
          if (!oscSender) return json(res, 200, { ok: true, port: p, applied: false, note: '已保存, 重启后生效' });
          return oscSender.setRemote(rootConfig.osc.host, p).then(function (r) {
            if (r && r.ok) { logger.info('OSC 发送端口已热切换为 ' + p + '(无需重启)'); return json(res, 200, { ok: true, port: p, applied: true }); }
            return json(res, 500, { ok: false, error: (r && r.error) || '切换失败' });
          });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/ports/web') {
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          const p = Math.round(Number(o.port));
          if (!(p >= 1 && p <= 65535)) return json(res, 400, { ok: false, error: '端口需在 1-65535' });
          rootConfig.web.port = p;
          persist();
          return json(res, 200, { ok: true, port: p, needRestart: true });
        } catch (e) { return json(res, 400, { ok: false, error: String(e.message) }); }
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/ports/check') {
      return portCheck().then(function (r) { json(res, 200, r); }).catch(function (e) { json(res, 500, { ok: false, error: String(e.message) }); });
    }
    // 健康总览: 一次返回控制台需要的一屏体检数据(零级)
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return portCheck().then(function (pc) {
        let pkgV = 'unknown';
        try { pkgV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version; } catch(e){noteFail('/api/health',e);}
        let ltFound = false; try { const lt = getLtStatus(rootConfig.ocrtl || {}); ltFound = !!(lt && lt.found); } catch(e){noteFail('/api/health',e);}
        let py = null; try { py = resolvePython(projectRoot); } catch(e){noteFail('/api/health',e);}
        const pls = pluginManager ? pluginManager.entries : [];
        return json(res, 200, {
          version: pkgV,
          web: { host: webCfg.host, configured: webCfg.port, actual: actualWebPort },
          osc: { host: (rootConfig.osc || {}).host || '127.0.0.1', port: (rootConfig.osc || {}).port || 9000 },
          udp9000: pc.udp9000,
          vrc: pc.vrc,
          deps: { python: !!py, livetranslate: ltFound },
          plugins: { total: pls.length, enabled: pls.filter(function (e2) { return e2.enabled; }).length, errors: pls.filter(function (e2) { return e2.error; }).length }
        });
      }).catch(function (e) { json(res, 500, { ok: false, error: String(e.message) }); });
    }
    json(res, 404, { ok: false });
  });
  return {
    start: function () {
      return new Promise(function (resolve, reject) {
        let port = webCfg.port;
        let attempts = 0;
        function tryListen() {
          server.once('error', function (e) {
            if (e.code === 'EADDRINUSE' && attempts < 10) { attempts++; port++; logger.warn('端口 ' + (port - 1) + ' 被占用,改用 ' + port); tryListen(); }
            else reject(e);
          });
          server.listen(port, webCfg.host, function () {
            actualWebPort = port;
            if (port !== webCfg.port) logger.warn('网页控制台: http://' + webCfg.host + ':' + port + '(原端口 ' + webCfg.port + ' 被占用)');
            else logger.info('网页控制台: http://' + webCfg.host + ':' + port);
            resolve(port);
          });
        }
        tryListen();
      });
    },
    stop: function () { return new Promise(function (r) { server.close(r); }); }
  };
}
module.exports = { createServer };
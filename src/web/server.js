'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { setAutostart, isEnabled } = require('../autostart');
const { diagnose } = require('../diagnose');
const { runOnce: runOcrTranslate, getLtStatus } = require('../ocrtranslate');
const { installPortablePython, existsPython, pyExe } = require('../portablepy');
const { resolvePython } = require('../pyhelper');
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
  let gateFails = []; // 密码门失败时间戳(防爆破节流)
  const pluginManager = opts.pluginManager || null;
  const oscSender = opts.osc || null;
  let actualWebPort = webCfg.port;

  // ===== 端口体检 =====
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
  function udpProbe(port) {
    return new Promise(function (resolve) {
      const dgram = require('dgram');
      let done = false;
      const s = dgram.createSocket('udp4');
      const timer = setTimeout(function () { if (!done) { done = true; try { s.close(); } catch (e) {} resolve({ occupied: null, note: '探测超时' }); } }, 2000);
      s.once('error', function (e) {
        if (done) return; done = true; clearTimeout(timer);
        try { s.close(); } catch (e2) {}
        if (e && e.code === 'EADDRINUSE') resolve({ occupied: true });
        else resolve({ occupied: null, note: String(e.message) });
      });
      s.bind(port, '127.0.0.1', function () {
        if (done) return; done = true; clearTimeout(timer);
        try { s.close(); } catch (e) {}
        resolve({ occupied: false });
      });
    });
  }
  async function portCheck() {
    const out = { udp9000: null, tcpAround: [], vrc: null };
    out.udp9000 = await udpProbe(9000);
    if (out.udp9000 && out.udp9000.occupied) {
      try {
        const rows = netstatTable();
        const hit = rows.find(function (r) { return r.proto === 'UDP' && /:9000$/.test(r.local); });
        if (hit) {
          const names = pidNames();
          out.udp9000.pid = hit.pid;
          out.udp9000.name = names[hit.pid] || ('PID ' + hit.pid);
        }
      } catch (e) {}
    }
    try {
      const rows = netstatTable();
      const names = pidNames();
      for (const r of rows) {
        if (r.proto === 'TCP' && r.state === 'LISTENING') {
          const m = /:(\d+)$/.exec(r.local);
          if (m) {
            const p = Number(m[1]);
            if (p >= 19180 && p <= 19230) out.tcpAround.push({ port: p, addr: r.local, pid: r.pid, name: names[r.pid] || ('PID ' + r.pid) });
          }
        }
      }
    } catch (e) {}
    try {
      const vrc = require('../vrcstatus').getVrcStatus();
      out.vrc = { running: !!vrc.running, oscEnabled: !!vrc.oscEnabled, oscPort: vrc.oscPort || null };
    } catch (e) {}
    return out;
  }

  function persist() {
    try { require('../configio').writeConfigAtomic(configPath, rootConfig); return true; } catch (e) { logger.error('config 写入失败: ' + e.message); return false; }
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
    let b = '';
    req.on('data', function (d) { b += d; if (b.length > 262144) req.destroy(); });
    req.on('end', function () { cb(b); });
  }
  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    // 跨站防护: 浏览器发起的写操作必须来自本机页面(恶意网页拦截); 无 Origin 的本地客户端放行
    if (req.method === 'POST' && !originAllowed(req)) return json(res, 403, { ok: false, error: '已拒绝跨站请求' });
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return serveFile(res, path.join(publicDir, 'index.html'));
    if (req.method === 'GET' && url.pathname.indexOf('/api/') !== 0 && url.pathname !== '/') {
      // 静态资源(如 /lang.js): 只允许安全字符, 防目录穿越
      const rel = url.pathname.slice(1);
      if (/^[a-zA-Z0-9_.-]+$/.test(rel)) {
        const f = path.join(publicDir, rel);
        if (fs.existsSync(f)) return serveFile(res, f);
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/version') {
      try { const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')); return json(res, 200, { version: pkg.version || '0.0.0' }); }
      catch (e) { return json(res, 200, { version: 'unknown' }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, Object.assign({ vrcOn: composer.vrcOn, vrc: composer.vrcInfo, time: Date.now() }, composer.status()));
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const srcs = composer.sources.map(function (s) { return { id: s.id, enabled: s.enabled, priority: s.priority, intervalMs: s.intervalMs }; });
      let autostart = !!rootConfig.autostart;
      try { autostart = isEnabled(); } catch (e) {}
      const v = (rootConfig.ocrtl && rootConfig.ocrtl.vision) || {};
      const cap = (rootConfig.ocrtl && rootConfig.ocrtl.capture) || {};
      const sec = (rootConfig.ocrtl && rootConfig.ocrtl.security) || {};
      const swf = (rootConfig.chatbox && rootConfig.chatbox.swearFilter) || {};
      return json(res, 200, { pages: rootConfig.sources.pages.pages, rotationMs: rootConfig.sources.pages.rotationMs, sources: srcs, autostart: autostart, desktop: { showConsole: !((rootConfig.desktop || {}).showConsole === false) }, lang: (rootConfig.web && rootConfig.web.lang) || 'zh-CN', ocrtl: { delayMs: (rootConfig.ocrtl || {}).delayMs || 5000, displayMs: (rootConfig.ocrtl || {}).displayMs || 8000, loops: (rootConfig.ocrtl || {}).loops || 2, mode: (rootConfig.ocrtl || {}).mode || 'auto', vision: { apiBase: v.apiBase || '', model: v.model || 'deepseek-v4-flash-vision-exp', hasKey: !!v.apiKey, targetLang: v.targetLang || 'zh' }, capture: { mode: cap.mode || 'window', windowTitle: cap.windowTitle || 'VRChat', region: cap.region || { x: 0, y: 0, w: 0, h: 0 } }, security: { promptDefense: sec.promptDefense !== false, jsonMode: sec.jsonMode !== false, outputSanitize: sec.outputSanitize !== false, extraPrompt: sec.extraPrompt || '', blockWords: sec.blockWords && sec.blockWords.length ? sec.blockWords : DEFAULT_BLOCK_WORDS } }, swearFilter: { enabled: swf.enabled !== false, words: swf.words && swf.words.length ? swf.words : swearfilter.DEFAULTS } });
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
          if (Array.isArray(o.pages)) {
            rootConfig.sources.pages.pages = o.pages.map(function (p) { return { text: String(p && p.text !== undefined ? p.text : p) }; });
          }
          if (o.rotationMs) {
            const rm = Number(o.rotationMs);
            if (rm >= 3000 && rm <= 300000) rootConfig.sources.pages.rotationMs = rm;
          }
          persist();
          return json(res, 200, { ok: true, pageCount: rootConfig.sources.pages.pages.length });
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
          rootConfig.pluginApprovals[o.id] = { hash: pluginManager.hash(entry.manifest), at: Date.now() };
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
      try { systemPy = { found: true, version: String(execFileSync('python', ['-V'], { timeout: 15000, windowsHide: true, encoding: 'utf8' })).trim() }; } catch (e) {}
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
          if (media && media.restart) { try { media.restart(); envState.msg = '安装完成, 听歌功能已启用'; } catch (e) {} }
        }
      });
      return json(res, 200, { ok: true, started: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/env/install-winsdk') {
      execFile('python', ['-m', 'pip', 'install', 'winsdk', '--no-input'], { timeout: 300000, windowsHide: true }, function (err, stdout, stderr) {
        if (err) return json(res, 500, { ok: false, error: 'winsdk 安装失败: ' + String(stderr || err.message || '').slice(0, 200) });
        const media = composer.sources.find(function (s) { return s.id === 'media'; });
        if (media && media.restart) { try { media.restart(); } catch (e) {} }
        json(res, 200, { ok: true });
      });
      return;
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
          try { fs.unlinkSync(tmp); } catch (e2) {}
          return json(res, 500, { ok: false, error: '截图失败(沙箱或权限限制), 可稍后重试' });
        }
        if (err || !fs.existsSync(tmp)) {
          try { fs.unlinkSync(tmp); } catch (e2) {}
          return json(res, 500, { ok: false, error: '截图失败: ' + (err ? err.message : '无输出') });
        }
        fs.readFile(tmp, function (e3, data) {
          try { fs.unlinkSync(tmp); } catch (e4) {}
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
        try { overrides = JSON.parse(body || '{}'); } catch (e) {}
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
              } catch (e) {}
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
      if (!unlockState.level1) return json(res, 403, { ok: false, error: '需要一级密码解锁' });
      return readBody(req, function (body) {
        try {
          const o = JSON.parse(body || '{}');
          rootConfig.ocrtl = rootConfig.ocrtl || {};
          const sec = rootConfig.ocrtl.security = rootConfig.ocrtl.security || {};
          if (o.promptDefense !== undefined) sec.promptDefense = o.promptDefense !== false;
          if (o.jsonMode !== undefined) sec.jsonMode = o.jsonMode !== false;
          if (o.outputSanitize !== undefined) sec.outputSanitize = o.outputSanitize !== false;
          if (o.extraPrompt !== undefined) sec.extraPrompt = String(o.extraPrompt || '').slice(0, 2000);
          if (Array.isArray(o.addWords)) {
            sec.blockWords = sec.blockWords && sec.blockWords.length ? sec.blockWords : DEFAULT_BLOCK_WORDS.slice();
            for (const w of o.addWords) { const s = String(w).trim(); if (s && sec.blockWords.indexOf(s) < 0) sec.blockWords.push(s); }
          }
          persist();
          return json(res, 200, { ok: true, security: sec });
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
      return setTimeout(function () {
        try {
          if (process.env.VRCB_EMBEDDED === '1') require('electron').app.quit();
          else process.exit(0);
        } catch (e) { process.exit(0); }
      }, 300);
    }
    if (req.method === 'POST' && url.pathname === '/api/desktop/restart') {
      json(res, 200, { ok: true });
      return setTimeout(function () {
        try {
          if (process.env.VRCB_EMBEDDED === '1') {
            require('electron').app.relaunch();
            require('electron').app.exit(0);
          } else {
            spawn(process.execPath, [path.join(__dirname, '..', 'main.js')], { cwd: projectRoot, stdio: 'inherit', detached: true }).unref();
            process.exit(0);
          }
        } catch (e) { process.exit(0); }
      }, 300);
    }
    if (req.method === 'POST' && url.pathname === '/api/devdocs/open') {
      try {
        const dir = path.join(projectRoot, '开发者文档');
        if (process.env.VRCB_EMBEDDED === '1') {
          // 桌面版: 用 Electron 原生 API 打开资源管理器(可靠, 窗口会前置)
          try { require('electron').shell.openPath(dir); } catch (e2) {}
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
          const cfg = o.config;
          if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return json(res, 400, { ok: false, error: '无效配置' });
          // 必须长得像真配置(至少含一个核心段), 防误传空对象把配置清空
          if (!cfg.web && !cfg.osc && !cfg.sources && !cfg.chatbox) return json(res, 400, { ok: false, error: '无效配置(缺少核心字段)' });
          // 导入前先把当前配置留档 config.json.bak, 防止编码损坏后无回滚
          try { fs.writeFileSync(configPath + '.bak', fs.readFileSync(configPath)); } catch (e) {}
          fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');
          logger.info('配置已从控制台导入, 重启后生效');
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
        } catch (e) {}
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
        try { pkgV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version; } catch (e) {}
        let ltFound = false; try { const lt = getLtStatus(rootConfig.ocrtl || {}); ltFound = !!(lt && lt.found); } catch (e) {}
        let py = null; try { py = resolvePython(projectRoot); } catch (e) {}
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

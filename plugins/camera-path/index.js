'use strict';
// 相机运镜控制(plugin id: camera-path) v0.3.0 —— 2026-10-30
// v0.3.0 新增: 局域网控制台(手机/平板浏览器直连, 预设列表/播放/仅导入/停止/拍照; 默认关闭, 端口+可选口令)
//
// v0.2.0 核心新增(已实测, 见 DEV-NOTES 383):
//   ① /dolly/Import 接受**绝对文件路径字符串**, 导入成功;
//   ② /dolly/Play true|false 播放/停止; 播放期间 /usercamera/Pose 有事件(可外部监听);
//   ③ ⚠️ VRChat 限制: 单段关键帧 > 6 时经 OSC 导入播放不稳定(7 帧有时崩溃, 8+ 必崩: NullReferenceException "routine is null");
//      本插件自动把长段**拆成 ≤ maxKeyframesPerSegment(默认6)**的多段(sanitized 临时文件), 实测 12 帧拆 6+6、10 帧拆 6+4 均可正常播放.
//   ④ 播放后相机可能被 Lock(锁定), 可选"停止后解锁";
//   ⑤ 多个预设: 扫描 CameraPaths 目录, 一键导入+播放.
//
// 保留 v0.1.0 能力: OSC 编码自检 / 能力探测 / 拍照(可隐藏 UI) / 简单运动原语(开环).
//
// 安全不变量:
//   - 任何脉冲都 try/finally 归零; dispose/stop 时停止播放 + 归零(+ 可选解锁);
//   - 不写用户 FlySpeed/TurnSpeed(运动原语是显式 API, 由调用者决定);
//   - 导入失败/文件非法时如实返回 error, 不静默.

const dgram = require('dgram');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = '0.3.0';
const DOLLY = {
  play: '/dolly/Play',
  playDelayed: '/dolly/PlayDelayed',
  importPath: '/dolly/Import',
  exportPath: '/dolly/Export',
  exportLocal: '/dolly/ExportLocal',
};
// ⚠️ 实测(2026-10-30): 单段 7 帧在"多段拼接"时不稳(有时 routine is null), 8 帧必崩; 取 6 稳定
const MAX_KEYFRAMES_DEFAULT = 6;
const AXES = ['MoveForward', 'MoveBackward', 'MoveLeft', 'MoveRight', 'LookLeft', 'LookRight'];
const FLOAT_AXES = ['Vertical', 'Horizontal', 'LookVertical', 'LookHorizontal'];

// ---------- OSC 编码/自检(与 v0.1.0 相同; 被单测约束) ----------
function oscString(s) {
  const b = Buffer.from(String(s), 'utf8');
  const out = Buffer.alloc(Math.ceil((b.length + 1) / 4) * 4);
  b.copy(out, 0);
  return out;
}
function oscMessage(address, args) {
  const list = Array.isArray(args) ? args : [];
  const tags = ',' + list.map(function (a) {
    if (typeof a === 'string') return 's';
    if (typeof a === 'boolean') return a ? 'T' : 'F';
    if (typeof a === 'number') return Number.isInteger(a) ? 'i' : 'f';
    return 'f';
  }).join('');
  const parts = [oscString(address), oscString(tags)];
  list.forEach(function (a) {
    if (typeof a === 'string') parts.push(oscString(a));
    else if (typeof a === 'boolean') { /* 只有类型标签 */ }
    else if (typeof a === 'number') {
      const b = Buffer.alloc(4);
      if (Number.isInteger(a)) b.writeInt32BE(a); else b.writeFloatBE(a);
      parts.push(b);
    }
  });
  return Buffer.concat(parts);
}
function auditPacket(buf) {
  const problems = [];
  if (!Buffer.isBuffer(buf)) return ['不是 Buffer'];
  if (buf.length === 0) problems.push('空包');
  if (buf.length % 4 !== 0) problems.push('总长度不是 4 的倍数(' + buf.length + ')');
  const first = buf.indexOf(0);
  if (first < 0) problems.push('地址没有 NUL 结尾');
  else if (first === 0) problems.push('地址为空');
  return problems;
}

// ---------- 运镜 JSON 解析/清洗 ----------
function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }
function parseVrcPath(json) {
  const arr = Array.isArray(json) ? json : [];
  if (!arr.length) return { ok: false, error: '不是关键帧数组(空)' };
  const bad = [];
  arr.forEach(function (k, i) {
    const P = k && k.Position, R = k && k.Rotation;
    if (!P || !isFinite(Number(P.X)) || !isFinite(Number(P.Y)) || !isFinite(Number(P.Z))) bad.push(i);
    if (!R || !isFinite(Number(R.X)) || !isFinite(Number(R.Y)) || !isFinite(Number(R.Z))) bad.push(i);
  });
  if (bad.length) return { ok: false, error: '关键帧字段缺失: ' + bad.slice(0, 5).join(',') };
  const segs = {};
  arr.forEach(function (k, i) { const p = Number(k.PathIndex) || 0; (segs[p] = segs[p] || []).push(i); });
  let dist = 0;
  const sortedKeys = Object.keys(segs).map(Number).sort(function (a, b) { return a - b; });
  sortedKeys.forEach(function (p) {
    const idxs = segs[p];
    for (let i = 1; i < idxs.length; i++) {
      const a = arr[idxs[i - 1]].Position, b = arr[idxs[i]].Position;
      dist += Math.hypot(num(b.X) - num(a.X), num(b.Y) - num(a.Y), num(b.Z) - num(a.Z));
    }
  });
  const durs = [];
  sortedKeys.forEach(function (p) {
    const idxs = segs[p];
    for (let i = 1; i < idxs.length; i++) { const d = Number(arr[idxs[i]].Duration); if (isFinite(d) && Math.abs(d - 2) > 0.001) durs.push(d); }
  });
  return {
    ok: true,
    file: null,
    points: arr.length,
    segments: sortedKeys.length,
    segmentSizes: sortedKeys.map(function (p) { return segs[p].length; }),
    maxSegment: sortedKeys.reduce(function (m, p) { return Math.max(m, segs[p].length); }, 0),
    local: !!arr[0].IsLocal,
    distance: Math.round(dist * 100) / 100,
    durationSec: durs.length ? Math.round(durs.reduce(function (a, b) { return a + b; }, 0) * 1000) / 1000 : null,
    mode: durs.length ? 'time' : 'speed',
  };
}

// 把 > limit 的段拆成更小段(保留顺序; 相邻段重叠一帧以减少断裂感)
function sanitizePath(json, limit) {
  const lim = Math.max(2, Math.min(20, Number(limit) || MAX_KEYFRAMES_DEFAULT));
  const arr = Array.isArray(json) ? json : null;
  if (!arr || !arr.length) return { ok: false, error: '不是关键帧数组' };
  const info = parseVrcPath(arr);
  if (!info.ok) return { ok: false, error: info.error };
  if (info.maxSegment <= lim) return { ok: true, changed: false, json: arr, info: info };
  const segs = {};
  arr.forEach(function (k, i) { const p = Number(k.PathIndex) || 0; (segs[p] = segs[p] || []).push(i); });
  const sortedKeys = Object.keys(segs).map(Number).sort(function (a, b) { return a - b; });
  const out = [];
  let newPath = 0;
  sortedKeys.forEach(function (p) {
    const idxs = segs[p];
    if (idxs.length <= lim) {
      idxs.forEach(function (srcIdx, j) { out.push(Object.assign({}, arr[srcIdx], { Index: j, PathIndex: newPath })); });
      newPath++;
      return;
    }
    let start = 0;
    while (start < idxs.length) {
      const end = Math.min(idxs.length, start + lim);
      const chunk = idxs.slice(start, end);
      chunk.forEach(function (srcIdx, j) { out.push(Object.assign({}, arr[srcIdx], { Index: j, PathIndex: newPath })); });
      newPath++;
      start = end;
    }
  });
  return { ok: true, changed: true, json: out, info: parseVrcPath(out) };
}

function scanPresets(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(function (f) { return /\.json$/i.test(f) && !/^_vrcliveboard_tmp_/i.test(f); }); } catch (e) { return { ok: false, error: '无法读取目录: ' + dir, presets: [] }; }
  const presets = [];
  files.forEach(function (f) {
    const full = path.join(dir, f);
    let st = null; try { st = fs.statSync(full); } catch (e) {}
    let info = { ok: false, error: '读取失败' };
    try { info = parseVrcPath(JSON.parse(fs.readFileSync(full, 'utf8'))); } catch (e) { info = { ok: false, error: String(e.message || e).slice(0, 100) }; }
    presets.push({ file: f, fullPath: full, isLocal: !!info.local, ok: !!info.ok, error: info.error || null, points: info.points || 0, segments: info.segments || 0, segmentSizes: info.segmentSizes || [], maxSegment: info.maxSegment || 0, distance: info.distance || 0, durationSec: info.durationSec != null ? info.durationSec : null, mode: info.mode || 'unknown', mtime: st ? st.mtimeMs : 0 });
  });
  presets.sort(function (a, b) { return (b.mtime || 0) - (a.mtime || 0); });
  return { ok: true, presets: presets };
}

// ⚠️ 实测(2026-10-30): 世界运镜的临时文件必须放在 CameraPaths 目录内, 放 %TEMP% 会 routine-is-null;
//    用 `_vrcliveboard_tmp_` 前缀并在扫描列表里忽略, 下一轮播放/停用/启用时清理.
const TMP_PREFIX = '_vrcliveboard_tmp_';
function writeJsonTemp(json, dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const p = path.join(dir, TMP_PREFIX + Date.now() + '-' + Math.random().toString(16).slice(2, 8) + '.json');
  fs.writeFileSync(p, JSON.stringify(json), 'utf8');
  return p;
}
function cleanupTemps(dir, keep) {
  try {
    fs.readdirSync(dir).forEach(function (f) {
      if (!/^_vrcliveboard_tmp_/i.test(f)) return;
      const full = path.join(dir, f);
      if (keep && path.basename(keep) === f) return;
      try { fs.unlinkSync(full); } catch (e) {}
    });
  } catch (e) {}
}

module.exports = function (ctx) {
  const cfg = (ctx && ctx.config) || {};
  const log = function (level, msg) { try { if (ctx && typeof ctx.log === 'function') ctx.log(level, msg); } catch (e) {} };
  const sock = dgram.createSocket('udp4');
  let sent = 0, failed = 0, lastError = '', playing = false, current = null, lastPlayedAt = 0;
  let timer = null;
  const state = { camera: null, note: '', oscQueryPort: 0, checked: false };
  // ---------- 局域网控制台(LAN console): 0.0.0.0 监听, 默认关闭, 可选口令 ----------
  let lanServer = null;
  const lanState = { listening: false, port: 0, ip: '', error: '' };

  function port() { const p = Number(cfg.oscPort); return p > 0 ? p : 9000; }
  function pathsDir() { const d = String(cfg.pathsDir || '').trim(); return d || path.join(os.homedir(), 'Documents', 'VRChat', 'CameraPaths'); }
  function maxKF() { return Math.max(2, Math.min(20, Number(cfg.maxKeyframesPerSegment) || MAX_KEYFRAMES_DEFAULT)); }

  function send(address, args) {
    const packet = oscMessage(address, args);
    const bad = auditPacket(packet);
    if (bad.length) { failed++; lastError = '包体自检失败(' + address + '): ' + bad.join('; '); log('warn', lastError); return Promise.resolve(false); }
    return new Promise(function (resolve) {
      sock.send(packet, port(), '127.0.0.1', function (err) {
        if (err) { failed++; lastError = String(err.message || err); resolve(false); }
        else { sent++; resolve(true); }
      });
    });
  }
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // ---------- OSCQuery(只读) ----------
  function httpGetJson(portNum, p) {
    return new Promise(function (resolve) {
      const req = http.get('http://127.0.0.1:' + portNum + p, { timeout: 1500 }, function (res) {
        let d = ''; res.on('data', function (c) { d += c; });
        res.on('end', function () { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
      });
      req.on('error', function () { resolve(null); });
      req.on('timeout', function () { req.destroy(); resolve(null); });
    });
  }
  function latestOscQueryPortFromLog() {
    try {
      const dir = path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat');
      const files = fs.readdirSync(dir).filter(function (f) { return /^output_log_.*\.txt$/.test(f); })
        .map(function (f) { const full = path.join(dir, f); return { f: full, t: fs.statSync(full).mtimeMs }; })
        .sort(function (a, b) { return b.t - a.t; }).slice(0, 3);
      for (const x of files) {
        const txt = fs.readFileSync(x.f, 'utf8');
        const m = /type OSCQuery on (\d+)/.exec(txt);
        if (m) return Number(m[1]);
        const m2 = /OSCQuery on (\d+)/.exec(txt);
        if (m2) return Number(m2[1]);
      }
    } catch (e) {}
    return 0;
  }
  async function discoverOscQuery() {
    const explicit = Number(cfg.oscQueryPort) || 0;
    const candidates = [];
    if (explicit) candidates.push(explicit);
    const fromLog = latestOscQueryPortFromLog();
    if (fromLog) candidates.push(fromLog);
    [54420, 9001, 55719, 61007, 62483].forEach(function (p) { if (candidates.indexOf(p) < 0) candidates.push(p); });
    for (const p of candidates) {
      const j = await httpGetJson(p, '/usercamera/Capture');
      if (j && j.FULL_PATH) { state.camera = true; state.oscQueryPort = p; state.checked = true; state.note = 'OSCQuery 在 ' + p; return p; }
    }
    state.camera = false; state.checked = true; state.note = '未找到 OSCQuery(相机控制可能不可用)';
    return 0;
  }
  async function readDollyState(portNum) {
    const p = portNum || state.oscQueryPort || await discoverOscQuery();
    if (!p) return null;
    const play = await httpGetJson(p, '/dolly/Play');
    return { play: play && play.VALUE ? !!play.VALUE[0] : null, port: p };
  }

  // ---------- 安全: 全轴归零(含模拟轴) ----------
  async function zeroAll() {
    for (const a of AXES) { await send('/input/' + a, [false]); await sleep(30); }
    for (const a of FLOAT_AXES) { await send('/input/' + a, [0]); await sleep(30); }
  }
  async function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  async function stopPlayback(reason) {
    // 无论本进程是否认为在播放, 都发一次 Play=false(状态可能在上一次进程/重载后已丢失)
    await send(DOLLY.play, [false]);
    const wasPlaying = playing || !!current;
    playing = false; lastPlayedAt = Date.now();
    const c = current; current = null;
    await clearTimer();
    let unlocked = false;
    if (cfg.stopRestoresLock !== false) {
      const j = await httpGetJson(state.oscQueryPort || 0, '/usercamera/Lock');
      if (j && j.VALUE && j.VALUE[0] === true) { await send('/usercamera/Lock', [false]); unlocked = true; }
    }
    log('info', '[camera-path] 停止播放(' + (reason || 'manual') + ')' + (c ? ' file=' + c.file : '') + (unlocked ? ' [已解锁]' : ''));
    return { ok: true, stopped: wasPlaying, playSent: true, unlocked: unlocked, file: c ? c.file : null };
  }

  async function ensurePresetFile(item) {
    if (!item || !item.fullPath) throw new Error('预设不存在');
    const json = JSON.parse(fs.readFileSync(item.fullPath, 'utf8'));
    const san = sanitizePath(json, maxKF());
    if (!san.ok) throw new Error('运镜文件非法: ' + san.error);
    if (!san.changed) return { importPath: item.fullPath, sanitized: false, info: san.info };
    cleanupTemps(pathsDir(), null);
    const tmp = writeJsonTemp(san.json, pathsDir());
    return { importPath: tmp, sanitized: true, info: san.info, sanitizedPath: tmp };
  }

  async function playPreset(args) {
    const a = args || {};
    const list = scanPresets(pathsDir());
    if (!list.ok) return { ok: false, error: list.error };
    const presets = list.presets.filter(function (p) { return p.ok; });
    let item = null;
    if (a.file) item = presets.find(function (p) { return p.file === a.file; }) || null;
    if (!item && a.name) item = presets.find(function (p) { return p.file.toLowerCase().indexOf(String(a.name).toLowerCase()) >= 0; }) || null;
    if (!item && a.index != null) item = presets[Number(a.index)] || null;
    if (!item) return { ok: false, error: '找不到预设(共 ' + presets.length + ' 条可用)', count: presets.length };
    await discoverOscQuery();
    const f = await ensurePresetFile(item);
    const importOk = await send(DOLLY.importPath, [String(f.importPath)]);
    if (!importOk) return { ok: false, error: 'Import 发送失败: ' + lastError };
    // ⚠️ 实测: 大/多段文件 Import 后需要更久才可 Play(300ms 会 routine-is-null, 1s 正常); 默认 800ms
    const importWaitMs = Math.max(0, Math.min(5000, cfg.importWaitMs != null ? Number(cfg.importWaitMs) : 800));
    await sleep(importWaitMs);
    const delaySec = Math.max(0, Math.min(60, a.delaySec != null ? Number(a.delaySec) : (Number(cfg.delaySec) || 1)));
    const startedAt = Date.now();
    if (a.noPlay) {
      playing = false; current = { file: item.file, sanitized: !!f.sanitized, importedPath: f.importPath, startedAt: startedAt, keypoints: f.info.points };
      log('info', '[camera-path] 仅导入 ' + item.file + (f.sanitized ? '(已拆分)' : ''));
      return { ok: true, file: item.file, sanitized: !!f.sanitized, noPlay: true, keyframes: f.info.points, segments: f.info.segments, info: '已 Import(未播放)' };
    }
    let playOk = false;
    if (delaySec > 0) {
      timer = setTimeout(function () {}, Math.min(delaySec * 1000, 5000)); // 仅占位, 实际下面 await
      await sleep(delaySec * 1000);
      await clearTimer();
    }
    playOk = await send(DOLLY.play, [true]);
    if (!playOk) return { ok: false, error: 'Play 发送失败: ' + lastError };
    playing = true; current = { file: item.file, sanitized: !!f.sanitized, importedPath: f.importPath, startedAt: startedAt, keyframes: f.info.points, segments: f.info.segments, isLocal: item.isLocal };
    // 自动停止: autoStopSec>0 时到点停; 否则靠结束自动(false)/手动停止
    await clearTimer();
    const autoStopSec = Number(cfg.autoStopSec) || 0;
    if (autoStopSec > 0) timer = setTimeout(function () { try { stopPlayback('autoStop'); } catch (e) {} }, Math.min(600, autoStopSec) * 1000);
    log('info', '[camera-path] 播放 ' + item.file + (f.sanitized ? '(已拆分 ' + f.info.segments + ' 段)' : '') + ' delay=' + delaySec + 's');
    return { ok: true, file: item.file, sanitized: !!f.sanitized, keyframes: f.info.points, segments: f.info.segments, segmentSizes: f.info.segmentSizes, isLocal: item.isLocal, delaySec: delaySec, autoStopSec: autoStopSec, info: '已发送 Import + Play' };
  }


  // ========== 局域网控制台 ==========
  function lanCfg() {
    const rawPort = Number(cfg.lanConsolePort);
    const port = (rawPort === 0) ? 0 : (rawPort >= 1024 && rawPort <= 65535 ? rawPort : 19191);
    return { enabled: cfg.lanConsoleEnabled === true, port: port, token: String(cfg.lanConsoleToken || '') };
  }
  function lanIps() {
    const out = [];
    try {
      const ifs = os.networkInterfaces();
      Object.keys(ifs).forEach(function (name) {
        (ifs[name] || []).forEach(function (a) {
          if (a && a.family === 'IPv4' && !a.internal && String(a.address).indexOf('169.254.') !== 0) out.push(a.address);
        });
      });
    } catch (e) {}
    return out;
  }
  function lanIp() { const ips = lanIps(); return ips.length ? ips[0] : '127.0.0.1'; }
  function lanStatusInfo() {
    const c = lanCfg();
    let url = '';
    if (lanState.listening) {
      url = 'http://' + (lanState.ip || lanIp()) + ':' + lanState.port + '/';
      if (c.token) url += '?token=' + encodeURIComponent(c.token);
    }
    return { enabled: c.enabled, listening: !!lanState.listening, port: lanState.port || c.port, ip: lanState.ip || lanIp(), ips: lanIps(), tokenRequired: !!c.token, url: url, error: lanState.error || '' };
  }
  function lanStop() {
    if (lanServer) { try { lanServer.close(); } catch (e) {} lanServer = null; }
    lanState.listening = false; lanState.port = 0; lanState.ip = ''; lanState.error = '';
  }
  function lanStopSafe() { try { lanStop(); } catch (e) {} }
  function lanJson(res, code, obj) {
    try {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(obj));
    } catch (e) {}
  }
  function lanPage(res) {
    try {
      const html = fs.readFileSync(path.join(__dirname, 'console.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
    } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('console.html 缺失: ' + String(e.message || e)); }
  }
  function lanCheckToken(req, urlObj) {
    const c = lanCfg();
    if (!c.token) return true;
    const fromQuery = urlObj ? urlObj.searchParams.get('token') : '';
    const fromHeader = req.headers['x-camera-token'] || req.headers['x-token'] || '';
    return String(fromQuery || fromHeader || '') === c.token;
  }
  function lanReadBody(req) {
    return new Promise(function (resolve) {
      let d = '', n = 0;
      req.on('data', function (c) {
        n += c.length;
        if (n > 65536) { try { req.destroy(); } catch (e) {} resolve({}); return; }
        d += c;
      });
      req.on('end', function () { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
      req.on('error', function () { resolve({}); });
    });
  }
  async function lanPresetsPayload() {
    const list = scanPresets(pathsDir());
    if (list.ok) {
      const lim = maxKF();
      list.presets.forEach(function (p) { p.needsSplit = p.ok && p.maxSegment > lim; p.playable = p.ok; });
    }
    return { ok: !!list.ok, error: list.error || '', dir: pathsDir(), maxKeyframesPerSegment: maxKF(), presets: list.presets || [], lan: lanStatusInfo() };
  }
  async function lanStatePayload() {
    const list = scanPresets(pathsDir());
    let dollyPlay = null;
    try { const d = await readDollyState(0); dollyPlay = d ? d.play : null; } catch (e) {}
    return {
      ok: true, version: VERSION, playing: playing, current: current, dollyPlay: dollyPlay,
      camera: state.camera, note: state.note, oscQueryPort: state.oscQueryPort,
      presetsDir: pathsDir(), presetCount: list.ok ? list.presets.length : 0,
      lan: lanStatusInfo(),
      settings: { delaySec: Number(cfg.delaySec) || 1, autoStopSec: Number(cfg.autoStopSec) || 0, maxKeyframesPerSegment: maxKF(), stopRestoresLock: cfg.stopRestoresLock !== false },
    };
  }
  async function lanHandleRequest(req, res) {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const p = u.pathname;
    if (req.method === 'GET' && (p === '/' || p === '/index.html' || p === '/console.html')) return lanPage(res);
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (p.indexOf('/api/') !== 0) return lanJson(res, 404, { ok: false, error: 'not found' });
    if (!lanCheckToken(req, u)) return lanJson(res, 401, { ok: false, error: '口令错误: 请在地址里带 ?token=...' });
    if (p === '/api/state' && req.method === 'GET') return lanJson(res, 200, await lanStatePayload());
    if (p === '/api/presets' && req.method === 'GET') return lanJson(res, 200, await lanPresetsPayload());
    if (p === '/api/play' && req.method === 'POST') {
      const body = await lanReadBody(req);
      const r = await playPreset({ file: body.file, index: body.index, delaySec: body.delaySec, name: body.name });
      return lanJson(res, r && r.ok ? 200 : 400, r);
    }
    if (p === '/api/import' && req.method === 'POST') {
      const body = await lanReadBody(req);
      const r = await playPreset({ file: body.file, index: body.index, name: body.name, noPlay: true });
      return lanJson(res, r && r.ok ? 200 : 400, r);
    }
    if (p === '/api/stop' && req.method === 'POST') return lanJson(res, 200, await stopPlayback('lan'));
    if (p === '/api/capture' && req.method === 'POST') {
      const hideUi = !!cfg.hideUiInPhoto;
      if (hideUi) await send('/usercamera/ShowUIInCamera', [false]);
      const ok = await send('/usercamera/Capture', []);
      if (hideUi) { await sleep(1200); await send('/usercamera/ShowUIInCamera', [true]); }
      return lanJson(res, 200, { ok: ok, hidUi: hideUi });
    }
    return lanJson(res, 404, { ok: false, error: 'unknown api' });
  }
  async function lanEnsure(args) {
    const a = args || {};
    if (a.enable === true) cfg.lanConsoleEnabled = true;
    if (a.enable === false) cfg.lanConsoleEnabled = false;
    const c = lanCfg();
    if (!c.enabled) { lanStop(); return lanStatusInfo(); }
    if (lanServer && lanState.listening && (c.port === 0 || lanState.port === c.port)) return lanStatusInfo();
    lanStop();
    return await new Promise(function (resolve) {
      const srv = http.createServer(function (req, res) {
        lanHandleRequest(req, res).catch(function (e) { lanJson(res, 500, { ok: false, error: String(e.message || e) }); });
      });
      srv.on('error', function (err) {
        lanState.listening = false; lanState.error = String(err.message || err); lanServer = null;
        log('warn', '[camera-path] LAN 控制台启动失败: ' + lanState.error);
        resolve(lanStatusInfo());
      });
      try {
        srv.listen(c.port, '0.0.0.0', function () {
          lanServer = srv;
          lanState.listening = true;
          lanState.port = srv.address().port;
          lanState.ip = lanIp();
          lanState.error = '';
          log('info', '[camera-path] LAN 控制台已启动: ' + lanStatusInfo().url);
          resolve(lanStatusInfo());
        });
      } catch (e) { lanState.error = String(e.message || e); resolve(lanStatusInfo()); }
    });
  }

  return {
    apply: async function () {
      cleanupTemps(pathsDir(), null);
      await discoverOscQuery();
      try { await lanEnsure(); } catch (e) { log('warn', '[camera-path] LAN 控制台启动异常: ' + (e && e.message)); }
      const list = scanPresets(pathsDir());
      log('info', '[camera-path] v' + VERSION + ' 已启用; ' + (list.ok ? list.presets.length : 0) + ' 个预设; ' + state.note + '; LAN=' + (lanState.listening ? lanStatusInfo().url : 'off'));
      return { ok: true, note: state.note, presets: list.ok ? list.presets.length : 0, lan: lanStatusInfo() };
    },
    dispose: async function () {
      try { lanStopSafe(); } catch (e) {}
      try { await stopPlayback('dispose'); } catch (e) {}
      try { cleanupTemps(pathsDir(), null); } catch (e) {}
      try { await zeroAll(); } catch (e) {}
      try { sock.close(); } catch (e) {}
      await clearTimer();
    },

    // ===== 扁平 API(控制台通过 /api/plugins/call 调用; 嵌套对象不可调用) =====
    api: {
      status: async function () {
        const list = scanPresets(pathsDir());
        let dollyPlay = null;
        try { const d = await readDollyState(0); dollyPlay = d ? d.play : null; } catch (e) {}
        return {
          ok: true, version: VERSION,
          camera: state.camera, note: state.note, oscQueryPort: state.oscQueryPort,
          osc: { host: '127.0.0.1', port: port(), sent: sent, failed: failed, lastError: lastError },
          presetsDir: pathsDir(), presetCount: list.ok ? list.presets.length : 0,
          playing: playing, current: current, dollyPlay: dollyPlay,
          lan: lanStatusInfo(),
          settings: { delaySec: Number(cfg.delaySec) || 1, autoStopSec: Number(cfg.autoStopSec) || 0, maxKeyframesPerSegment: maxKF(), stopRestoresLock: cfg.stopRestoresLock !== false },
        };
      },
      listPresets: async function () {
        await discoverOscQuery();
        const list = scanPresets(pathsDir());
        if (!list.ok) return { ok: false, error: list.error };
        const lim = maxKF();
        list.presets.forEach(function (p) { p.needsSplit = p.ok && p.maxSegment > lim; p.playable = p.ok; });
        return { ok: true, dir: pathsDir(), maxKeyframesPerSegment: lim, presets: list.presets, lan: lanStatusInfo() };
      },
      playPreset: async function (args) { try { return await playPreset(args); } catch (e) { return { ok: false, error: String(e.message || e) }; } },
      importPreset: async function (args) {
        try { return await playPreset(Object.assign({}, args || {}, { noPlay: true })); } catch (e) { return { ok: false, error: String(e.message || e) }; }
      },
      stop: async function () { try { return await stopPlayback('manual'); } catch (e) { return { ok: false, error: String(e.message || e) }; } },
      refresh: async function () { return await this.listPresets(); },
      zeroAll: async function () { await zeroAll(); return { ok: true }; },
      test: async function () {
        const p = await discoverOscQuery();
        const dolly = await readDollyState(p);
        return { ok: !!p, oscQueryPort: p, dollyEndpoints: !!(dolly && dolly.play !== null), note: state.note };
      },
      lanStatus: async function () { return lanStatusInfo(); },
      lanEnsure: async function (args) { try { return await lanEnsure(args); } catch (e) { return { ok: false, error: String(e.message || e), ...lanStatusInfo() }; } },
      capture: async function (opts) {
        const hideUi = !opts || opts.hideUi !== false ? !!cfg.hideUiInPhoto : false;
        if (hideUi) await send('/usercamera/ShowUIInCamera', [false]);
        const ok = await send('/usercamera/Capture', []);
        if (hideUi) { await sleep(1200); await send('/usercamera/ShowUIInCamera', [true]); }
        return { ok: ok, hidUi: hideUi };
      },
      send: send,
      _audit: auditPacket,
      _encode: oscMessage,
      _parse: parseVrcPath,
      _sanitize: sanitizePath,
      _scan: scanPresets,
      // 运动原语(开环; 保留 v0.1 兼容)
      motion: {
        moveForward: function (ms) { return pulse('MoveForward', ms); },
        moveBackward: function (ms) { return pulse('MoveBackward', ms); },
        moveLeft: function (ms) { return pulse('MoveLeft', ms); },
        moveRight: function (ms) { return pulse('MoveRight', ms); },
        lookLeft: function (ms) { return pulse('LookLeft', ms); },
        lookRight: function (ms) { return pulse('LookRight', ms); },
        setFlying: function (on) { return send('/usercamera/Flying', [!!on]); },
        stopAll: zeroAll,
      },
    },
  };

  async function pulse(axis, ms) {
    const dur = Math.max(50, Math.min(20000, Number(ms) || 300));
    let ok = false;
    try { ok = await send('/input/' + axis, [true]); await sleep(dur); }
    finally { await send('/input/' + axis, [false]); }
    return ok;
  }
};

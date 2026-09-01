'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

// 监听 VRChat 运行日志中的玩家进出事件(约 1.5s 延迟)
// 日志格式: 2026.08.19 10:00:00 Log - [Behaviour] OnPlayerJoined <显示名>
const bus = new EventEmitter();
let watcher = null;
let seen = new Set();
let lastLog = null;
let roomEntryAt = 0; // 最近一次 Entering Room 的日志时间戳
const SNAPSHOT_MS = 30000; // 进房后 30 秒内的 OnPlayerJoined 视为"进房快照"(房间里已存在的玩家)

function lineTs(line) {
  const m = String(line || '').match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
}

function vrcDir() {
  if (process.env.VRCB_LOG_DIR) return process.env.VRCB_LOG_DIR;
  return path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat');
}
function newestLog() {
  const dir = vrcDir();
  let best = null;
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return null; }
  for (const n of names) {
    if (!/^output_log_.*\.txt$/.test(n)) continue;
    const p = path.join(dir, n);
    try {
      const st = fs.statSync(p);
      if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
    } catch (e) {}
  }
  return best;
}
function parseLine(line) {
  if (/Entering Room:/i.test(line)) return { type: 'room' };
  const m = line.match(/OnPlayerJoined\s+(.+)$/i);
  if (m) return { type: 'joined', name: String(m[1]).trim() };
  const m2 = line.match(/OnPlayerLeft\s+(.+)$/i);
  if (m2) return { type: 'left', name: String(m2[1]).trim() };
  return null;
}
function poll() {
  try {
    const log = newestLog();
    if (!log) return;
    const isNew = !lastLog || log.path !== lastLog.path;
    if (isNew) {
      // 新会话日志: 全部按"已在场"处理, 不逐个触发
      lastLog = log;
      seen = new Set();
      try {
        const st = fs.statSync(log.path);
        lastLog.size = st.size;
        const raw = fs.readFileSync(log.path, 'utf8');
        for (const line of raw.split(/\r?\n/)) {
          const ev = parseLine(line);
          if (ev && ev.type === 'joined') seen.add(ev.name);
          else if (ev && ev.type === 'room') { const t = lineTs(line); if (t) roomEntryAt = t; }
        }
      } catch (e) {}
      return;
    }
    const st = fs.statSync(log.path);
    if (lastLog.size === undefined) lastLog.size = 0;
    if (st.size <= lastLog.size) { lastLog.size = st.size; return; }
    const fd = fs.openSync(log.path, 'r');
    const buf = Buffer.alloc(st.size - lastLog.size);
    fs.readSync(fd, buf, 0, buf.length, lastLog.size);
    fs.closeSync(fd);
    lastLog.size = st.size;
    const chunk = buf.toString('utf8');
    for (const line of chunk.split(/\r?\n/)) {
      const ev = parseLine(line);
      if (!ev) continue;
      if (ev.type === 'room') { const t = lineTs(line); if (t) roomEntryAt = t; continue; }
      if (ev.type === 'joined' && !seen.has(ev.name)) {
        seen.add(ev.name);
        const t = lineTs(line) || Date.now();
        const alreadyInWorld = roomEntryAt > 0 && t >= roomEntryAt && (t - roomEntryAt) < SNAPSHOT_MS;
        bus.emit('player.joined', ev.name, { alreadyInWorld: alreadyInWorld });
      }
      else if (ev.type === 'left' && seen.has(ev.name)) { seen.delete(ev.name); bus.emit('player.left', ev.name); }
    }
  } catch (e) { /* 忽略单轮错误 */ }
}
function start() {
  if (watcher) return;
  watcher = setInterval(poll, 1500);
  poll();
}
function stop() {
  if (watcher) { clearInterval(watcher); watcher = null; }
}
module.exports = { start, stop, on: function (e, fn) { bus.on(e, fn); }, off: function (e, fn) { bus.off(e, fn); } };

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
// 进房快照窗口(2026-09-12 实测修正): VRChat 在 Entering Room 之后约 10~11 秒, 把房间里**已存在**的玩家
// 补写成 OnPlayerJoined。旧值 30 秒会把随后 20 秒内真正进房的好友一起吞掉 ——
// 实测时间线: 15:29:45 进房 → 15:29:56(+11s) 快照 → 15:30:07(+22s) 好友真实进房却被跳过。
// 15 秒 = 覆盖实测的快照批(+10~11s), 又不碰 +22s 那类真实进房。
const SNAPSHOT_MS = 15000;
// 纯函数便于门禁断言(plugin-behavior): 是否算"进房快照"
function isSnapshotJoin(roomEntryAt, joinTs, windowMs) {
  const w = Number(windowMs) || SNAPSHOT_MS;
  if (!roomEntryAt || !joinTs) return false;
  return joinTs >= roomEntryAt && (joinTs - roomEntryAt) < w;
}

// 本地用户 UID: 从 Entering Room 后紧跟的 "Joining wrld_...~hidden(usr_xxx)~region" 行解析。
// 2026-10-30 修(VRChat 更新后回归): 旧逻辑用"进房后 15 秒"判断快照, 但新版本在人数多的世界可能到 +25 秒
// 才把已在场玩家(含自己)补写为 OnPlayerJoined -> 15 秒窗口失效, 已在场好友被重复欢迎。
// 新逻辑: 进房后先缓冲 join, 等"自己"的 OnPlayerJoined 到达; 自己之前的 join 全部算快照, 之后的才是真实进房。
let ownUserId = null;
let pendingJoins = [];
let awaitingSelf = false;
const SELF_BUFFER_FALLBACK_MS = 60000;
function displayKey(raw) {
  return String(raw || '')
    .replace(/\(\s*usr_[a-z0-9-]+\s*\)|\busr_[a-z0-9-]+\b/gi, '')
    .replace(/\(\s*\)/g, '').trim().toLowerCase();
}
function lineUid(line) {
  const m = String(line || '').match(/~hidden\((usr_[a-z0-9-]+)\)/i);
  return m ? m[1].toLowerCase() : null;
}
function joinedUid(name) {
  const m = String(name || '').match(/\((usr_[a-z0-9-]+)\)/i);
  return m ? m[1].toLowerCase() : null;
}
function flushPendingSnapshot() {
  const list = pendingJoins;
  pendingJoins = [];
  for (const p of list) {
    if (!p || !p.name) continue;
    const key = displayKey(p.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    bus.emit('player.joined', p.name, { alreadyInWorld: true, sinceRoomSec: p.sinceRoomSec, snapshot: 'self-buffer' });
  }
  awaitingSelf = false;
}

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
  // 只认 [Behaviour] 自己的行(2026-09-12 实测): VisitorsInformationBoard 等世界/第三方日志里也会出现
  // "OnPlayerJoined" 字样(形如 [VisitorsInformationBoard] 174.37 / OnPlayerJoined / player=某某(local)),
  // 以前被当成进房事件喂给插件 —— 名字还带 "/ player=" 前缀, 只会制造噪音与误匹配。
  if (/VisitorsInformationBoard/i.test(line)) return null;
  if (!/\[Behaviour\]/.test(line)) return null;
  if (/Entering Room:/i.test(line)) return { type: 'room' };
  const m = line.match(/OnPlayerJoined\s+(.+)$/i);
  if (m) return { type: 'joined', name: String(m[1]).trim() };
  const m2 = line.match(/OnPlayerLeft\s+(.+)$/i);
  if (m2) return { type: 'left', name: String(m2[1]).trim() };
  return null;
}
function handleLine(line, emit) {
  const uid = lineUid(line);
  if (uid) { ownUserId = uid; if (emit && roomEntryAt > 0) awaitingSelf = true; }
  const ev = parseLine(line);
  if (!ev) return;
  if (ev.type === 'room') {
    const t = lineTs(line);
    if (t) roomEntryAt = t;
    pendingJoins = [];
    awaitingSelf = !!ownUserId && emit;
    return;
  }
  if (ev.type === 'joined') {
    const key = displayKey(ev.name);
    if (!key) return;
    const juid = joinedUid(ev.name);
    const ts = lineTs(line) || Date.now();
    if (juid && ownUserId && juid === ownUserId) {
      // 自己出现: 说明已在场玩家批次结束; 自己之前缓冲的 join 一律标记为快照
      if (emit) flushPendingSnapshot();
      else { pendingJoins = []; awaitingSelf = false; }
      seen.add(key);
      return;
    }
    if (emit && awaitingSelf) {
      pendingJoins.push({ name: ev.name, ts: ts, sinceRoomSec: roomEntryAt > 0 ? Math.round((ts - roomEntryAt) / 1000) : null });
      return;
    }
    if (!emit) { seen.add(key); return; }
    if (seen.has(key)) return;
    seen.add(key);
    const already = ownUserId ? false : isSnapshotJoin(roomEntryAt, ts, SNAPSHOT_MS);
    bus.emit('player.joined', ev.name, { alreadyInWorld: already, sinceRoomSec: roomEntryAt > 0 ? Math.round((ts - roomEntryAt) / 1000) : null });
    return;
  }
  if (ev.type === 'left') {
    const key = displayKey(ev.name);
    if (!key) return;
    seen.delete(key);
    pendingJoins = pendingJoins.filter(function (p) { return displayKey(p.name) !== key; });
    if (emit) bus.emit('player.left', ev.name);
  }
}

function poll() {
  try {
    if (awaitingSelf && roomEntryAt > 0 && Date.now() - roomEntryAt > SELF_BUFFER_FALLBACK_MS) flushPendingSnapshot();
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
          handleLine(line, false);
        }
        awaitingSelf = false;
        pendingJoins = [];
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
    for (const line of chunk.split(/\r?\n/)) handleLine(line, true);
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
module.exports = {
  start, stop,
  on: function (e, fn) { bus.on(e, fn); },
  off: function (e, fn) { bus.off(e, fn); },
  isSnapshotJoin: isSnapshotJoin, SNAPSHOT_MS: SNAPSHOT_MS,
  __parseLineForTest: parseLine,
  __resetSnapshotForTest: function () { ownUserId = null; pendingJoins = []; awaitingSelf = false; seen = new Set(); roomEntryAt = 0; },
  __feedLineForTest: function (line) { handleLine(line, true); },
  __pendingCountForTest: function () { return pendingJoins.length; }
};

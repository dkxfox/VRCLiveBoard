'use strict';
const fs = require('fs');
const path = require('path');
function ts() {
  const d = new Date();
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
const ring = [];
const MAX_RING = 500;
function emit(level, m) {
  const line = '[' + ts() + ']' + (level ? ' [' + level + ']' : '') + ' ' + m;
  // 管道关闭(无头/后台启动)时 console 会抛 EPIPE, 绝不能因此拖垮主循环
  try { console.log(line); } catch (e) {}
  ring.push(line);
  if (ring.length > MAX_RING) ring.shift();
  try {
    const dir = path.join(__dirname, '..', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'app.log'), line + '\r\n', 'utf8');
  } catch (e) { /* 日志落盘失败不影响运行 */ }
}
const logger = {
  info: function (m) { emit('', m); },
  warn: function (m) { emit('WARN', m); },
  error: function (m) { emit('ERROR', m); },
  tail: function (n) { return ring.slice(-(Number(n) || 200)); }
};
module.exports = { logger };

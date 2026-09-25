'use strict';
// 测试用极简 WebSocket 服务端(**只给单测**): 握手 + 收发二进制帧, 并且**按 B站的两层协议**处理:
//   WebSocket 帧(必须掩码) 里装着 B站帧(16 字节头 + op)。
// 踩过的四个坑写在这里, 免得下次再犯:
//   ① B站的 op(2/3/5/7/8) 是**载荷内的头字段**, 不是 WebSocket 的 opcode —— WS 层必须始终用二进制(2),
//      否则 op=8 会被当作 WS 的 CLOSE 帧, 连接当场断掉;
//   ② 回复必须**套上 B站帧头**再发 —— 直接发裸 JSON 客户端解不出帧(op=8 收不到);
//   ③ 收到 WS CLOSE 帧必须**回一条再断**: 不回的话 undici 的 WebSocket 一直等对端的关闭帧, onclose 永不触发
//      (表现是"认证超时后不重连");
//   ④ 测半包时出站要排队: api.sendBytes(payload, true) 声明"这是半帧", 期间的自动心跳回应排队等补完再发 ——
//      真实服务端两条帧在 TCP 上连续, 插进半帧中间的话任何解码器都救不回来(表现是"拼不上第二半")。
const http = require('http');
const crypto = require('crypto');
const F = require('../lib/frame.js');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) { return crypto.createHash('sha1').update(String(key) + GUID).digest('base64'); }

// 服务端 -> 客户端: 不掩码
function encodeFrame(payload, opcode) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  const code = opcode === undefined ? 2 : opcode;
  let header;
  if (p.length < 126) { header = Buffer.alloc(2); header[1] = p.length; }
  else if (p.length < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(p.length, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(p.length, 6); }
  header[0] = 0x80 | (code & 0x0f);
  return Buffer.concat([header, p]);
}

// 客户端 -> 服务端: 必须掩码; 逐帧解开
function decodeFrames(buf) {
  const frames = []; let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off], b1 = buf[off + 1];
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, hdr = 2;
    if (len === 126) { if (off + 4 > buf.length) break; len = buf.readUInt16BE(off + 2); hdr = 4; }
    else if (len === 127) { if (off + 10 > buf.length) break; len = Number(buf.readBigUInt64BE(off + 2)); hdr = 10; }
    const maskLen = masked ? 4 : 0;
    if (off + hdr + maskLen + len > buf.length) break;
    const mask = masked ? buf.slice(off + hdr, off + hdr + 4) : null;
    const payload = Buffer.from(buf.slice(off + hdr + maskLen, off + hdr + maskLen + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    frames.push({ opcode: b0 & 0x0f, payload: payload });
    off += hdr + maskLen + len;
  }
  return { frames: frames, rest: buf.slice(off) };
}

// opts: autoAuthReply(默认 true) / autoHeartbeatReply(默认 true) / authReplyDelayMs / onAuth(body, api)
//       / closeOnAuth / textFrames(用 WS 文本帧发, 测兼容)
function createFakeServer(opts) {
  const o = opts || {};
  // 排查用: VRCB_WS_TRACE=1 打开夹具内部收发流水(默认关)
  const TR = o.trace !== undefined ? o.trace : process.env.VRCB_WS_TRACE === '1';
  const state = { authBodies: [], authFrames: 0, heartbeats: 0, connections: 0, biliFrames: 0 };
  const server = http.createServer(function (req, res) { res.writeHead(404); res.end('ws only'); });
  const sockets = [];
  server.on('upgrade', function (req, socket) {
    state.connections += 1;
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey(req.headers['sec-websocket-key']) + '\r\n\r\n');
    sockets.push(socket);
    let wsBuf = Buffer.alloc(0), biliBuf = Buffer.alloc(0);
    // ④ 出站要排队: 测半包时会故意只发"半条 B站帧", 这期间自动心跳回应不能插到半帧中间 ——
    //    真实服务端的两条帧在 TCP 上是连续的, 插进去的话任何解码器都救不回来(踩过的坑).
    let outHold = false;
    const outQueue = [];
    function writeFrame(payload) {
      try {
        if (TR) console.log('   [srv send] bytes=' + (payload && payload.length) + ' writable=' + socket.writable + ' destroyed=' + socket.destroyed);
        socket.write(encodeFrame(payload, o.textFrames ? 1 : 2));
      } catch (e) { if (TR) console.log('   [srv send err] ' + e.message); }
    }
    const api = {
      // 直接发原始 WS 二进制帧(测试里用来发"已经拼好的 B站帧")
      // hold: true = 这条是半帧(后续帧先排队), false = 半帧补完(放行排队的帧), 省略 = 普通整帧
      sendBytes: function (payload, hold) {
        if (outHold && hold !== false) { outQueue.push(payload); return; }
        writeFrame(payload);
        if (hold === true) outHold = true;
        else if (hold === false) { outHold = false; while (outQueue.length) writeFrame(outQueue.shift()); }
      },
      // 按 B站协议发: 自动套 16 字节头
      bili: function (op, body) { api.sendBytes(F.encode(op, body === undefined ? null : body)); },
      close: function () { try { socket.destroy(); } catch (e) {} }
    };
    socket.on('data', function (d) {
      wsBuf = Buffer.concat([wsBuf, d]);
      const wsDec = decodeFrames(wsBuf);
      wsBuf = wsDec.rest;
      if (TR) console.log('   [srv recv] chunk=' + d.length + ' wsFrames=' + wsDec.frames.map(function (x) { return x.opcode + '/' + x.payload.length; }).join(',') + ' rest=' + wsDec.rest.length);
      for (const wf of wsDec.frames) {
        // ③ 关闭握手必须回帧再断: 不回的话 undici 的 WebSocket 会一直等 close, onclose 永不触发
        if (wf.opcode === 8) { try { socket.write(encodeFrame(wf.payload, 8)); } catch (e) {} try { socket.end(); } catch (e) {} return; }
        if (wf.opcode === 9) { try { socket.write(encodeFrame(wf.payload, 10)); } catch (e) {} continue; }
        biliBuf = Buffer.concat([biliBuf, wf.payload]);
        const biliDec = F.decodeWithRest(biliBuf);
        biliBuf = biliDec.rest;
        if (TR) console.log('   [srv bili] payload=' + wf.payload.length + ' frames=' + biliDec.frames.length + ' rest=' + biliDec.rest.length);
        for (const bf of biliDec.frames) {
          state.biliFrames += 1;
          if (bf.op === F.OP.AUTH) {
            state.authFrames += 1;
            const body = bf.body ? bf.body.toString('utf8') : '';
            state.authBodies.push(body);
            if (typeof o.onAuth === 'function') o.onAuth(body, api);
            if (o.closeOnAuth) { api.close(); continue; }
            if (o.autoAuthReply !== false) {
              const reply = function () { api.bili(F.OP.AUTH_REPLY, JSON.stringify({ code: 0 })); };
              if (o.authReplyDelayMs) setTimeout(reply, o.authReplyDelayMs); else reply();
            }
          } else if (bf.op === F.OP.HEARTBEAT) {
            state.heartbeats += 1;
            if (o.autoHeartbeatReply !== false) api.bili(F.OP.HEARTBEAT_REPLY, Buffer.from([0, 0, 0, 1]));
          }
        }
      }
    });
    socket.on('error', function () {});
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      state.port = server.address().port;
      state.url = 'ws://127.0.0.1:' + state.port + '/sub';
      state.close = function () { state.closed = true; for (const s of sockets) { try { s.destroy(); } catch (e) {} } try { server.close(); } catch (e) {} };
      resolve(state);
    });
  });
}

module.exports = { createFakeServer: createFakeServer, encodeFrame: encodeFrame, decodeFrames: decodeFrames, acceptKey: acceptKey };

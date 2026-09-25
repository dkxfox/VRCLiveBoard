'use strict';
// B站直播弹幕 —— 帧编解码(纯函数, 零依赖: 只用 Node 内置 zlib, 它已含 zlib 与 brotli)
//
// 帧格式(16 字节头, 全部大端):
//   0..4   整包长度(含头)
//   4..6   头长度(固定 16)
//   6..8   协议版本 protover: 0/1 = JSON 明文, 2 = zlib 压缩, 3 = brotli 压缩
//   8..12  操作码 op: 2 = 心跳, 3 = 心跳回应, 5 = 消息, 7 = 认证, 8 = 认证回应
//   12..16 序号 sequence
// 关键点: **压缩帧的 body 解压后是"一个或多个完整帧"**(服务端把多条消息打包压缩后发一帧),
//         所以要递归解析; 长连接里还会遇到"半包", 所以解析要能返回"没吃掉的尾巴"。
const zlib = require('zlib');

const OP = { HEARTBEAT: 2, HEARTBEAT_REPLY: 3, MESSAGE: 5, AUTH: 7, AUTH_REPLY: 8 };
const PROTOVER = { JSON: 1, ZLIB: 2, BROTLI: 3 };
const HEADER_LEN = 16;

function encode(op, body, protover) {
  var payload;
  if (body === undefined || body === null) payload = Buffer.alloc(0);
  else if (Buffer.isBuffer(body)) payload = body;
  else payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  var buf = Buffer.alloc(HEADER_LEN + payload.length);
  buf.writeUInt32BE(buf.length, 0);
  buf.writeUInt16BE(HEADER_LEN, 4);
  buf.writeUInt16BE(protover === undefined ? PROTOVER.JSON : protover, 6);
  buf.writeUInt32BE(op, 8);
  buf.writeUInt32BE(1, 12);
  payload.copy(buf, HEADER_LEN);
  return buf;
}

function decompress(protover, body) {
  if (protover === PROTOVER.ZLIB) return zlib.inflateSync(body);
  if (protover === PROTOVER.BROTLI) return zlib.brotliDecompressSync(body);
  return body;
}

function tryJson(buf) {
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { return null; }
}

// 解析缓冲区里可能串着的多个帧(压缩帧递归展开)。返回 { frames, rest }:
//   frames: 已完整解析的帧(带 op/protover/seq/body/json)
//   rest:   没吃掉的尾巴(半包) —— 调用方把它与下一段 socket 数据拼起来再解
// 解析不了的头部一律停下并保留(不抛错): 宁可少解, 不能因为一条坏帧把连接搞崩。
function decodeWithRest(buffer) {
  var frames = [];
  var offset = 0;
  while (offset + HEADER_LEN <= buffer.length) {
    var total = buffer.readUInt32BE(offset);
    var headerLen = buffer.readUInt16BE(offset + 4);
    var protover = buffer.readUInt16BE(offset + 6);
    var op = buffer.readUInt32BE(offset + 8);
    var seq = buffer.readUInt32BE(offset + 12);
    if (headerLen < HEADER_LEN || total < headerLen || offset + total > buffer.length) break;
    var body = buffer.slice(offset + headerLen, offset + total);
    var expanded = null;
    try { expanded = decompress(protover, body); } catch (e) { expanded = null; }
    if (expanded === null) {
      // 解压失败: 记一条空帧让上层能看见异常, 但不中断后续解析
      frames.push({ op: op, protover: protover, seq: seq, body: null, json: null, error: 'decompress' });
    } else if (expanded !== body) {
      var inner = decodeWithRest(expanded).frames;   // 压缩帧里是"一个或多个完整帧", 递归展开",
      for (var i = 0; i < inner.length; i++) frames.push(inner[i]);
    } else {
      frames.push({ op: op, protover: protover, seq: seq, body: expanded, json: tryJson(expanded) });
    }
    offset += total;
  }
  return { frames: frames, rest: buffer.slice(offset) };
}

function decode(buffer) { return decodeWithRest(buffer).frames; }

module.exports = { OP: OP, PROTOVER: PROTOVER, HEADER_LEN: HEADER_LEN, encode: encode, decode: decode, decodeWithRest: decodeWithRest };

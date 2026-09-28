'use strict';
// MMD VMD 动作文件解析(F-20260929-01 路线 B 第一刀的第一步, 2026-09-29)
// 只做我们需要的部分: 校验文件头 + 读骨骼关键帧(位置/四元数) + 统计时长。
// 规格已核对(公开规格文档, 见功能卡 §288 记录):
//   · VMD 固定 **30 fps**; 小端; MMD 用左手系;
//   · 文件头: 30 字节 signature("Vocaloid Motion Data 0002", Shift-JIS) + 20 字节模型名;
//   · 之后: uint32 骨骼关键帧数, 然后每个关键帧 **111 字节** =
//       骨骼名 15 + 帧号 uint32 4 + 位置 3×float 12 + 四元数 4×float 16 + 插值曲线 64。
// 为什么不用现成库: 我们只要这 111 字节的结构, 自己解析零依赖、可断言、可读。
const SIGNATURES = ['Vocaloid Motion Data 0002', 'Vocaloid Motion Data file'];
const FRAME_BYTES = 111;
const FPS = 30;

// 真实 VMD 的字符串是 **Shift-JIS**(MMD 是日文软件); 这里优先用 Shift-JIS 解, 出现替换字符时再按 UTF-8 试一次
// (我们自己的合成样本用 ASCII 名字, 两种都能读)
let SJIS = null;
try { SJIS = new TextDecoder("shift_jis"); } catch (e) { SJIS = null; }

function decodeName(buf, off, len) {
  let end = off;
  const max = off + len;
  while (end < max && buf[end] !== 0) end++;
  const raw = buf.slice(off, end);
  if (!raw.length) return "";
  if (SJIS) {
    const s = SJIS.decode(raw);
    if (s.indexOf("\uFFFD") < 0) return s;
  }
  return raw.toString("utf8");
}
function parseVmd(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 50) throw new Error('文件太小, 不像 VMD');
  const sig = buf.slice(0, 30).toString('latin1').replace(/\0+$/, '').trim();
  let sigOk = false;
  for (const s of SIGNATURES) if (sig.indexOf(s) === 0) sigOk = true;
  if (!sigOk) throw new Error('文件头不是 VMD: "' + sig + '"');
  const nameLen = (sig.indexOf('0002') >= 0) ? 20 : 10;         // 多模型版之后是 20 字节
  const modelName = decodeName(buf, 30, nameLen);
  let off = 30 + nameLen;
  const boneCount = buf.readUInt32LE(off); off += 4;
  const need = off + boneCount * FRAME_BYTES;
  if (need > buf.length) throw new Error('骨骼帧数(' + boneCount + ')超过文件长度: 需要 ' + need + ' 字节, 实际 ' + buf.length);
  const frames = [];
  const byBone = new Map();
  let maxFrame = 0;
  for (let i = 0; i < boneCount; i++) {
    const bone = decodeName(buf, off, 15);
    const frame = buf.readUInt32LE(off + 15);
    const pos = [buf.readFloatLE(off + 19), buf.readFloatLE(off + 23), buf.readFloatLE(off + 27)];
    const rot = [buf.readFloatLE(off + 31), buf.readFloatLE(off + 35), buf.readFloatLE(off + 39), buf.readFloatLE(off + 43)];
    off += FRAME_BYTES;
    if (frame > maxFrame) maxFrame = frame;
    frames.push({ bone: bone, frame: frame, pos: pos, rot: rot });
    if (!byBone.has(bone)) byBone.set(bone, []);
    byBone.get(bone).push(frames[frames.length - 1]);
  }
  byBone.forEach(function (arr) { arr.sort(function (a, b) { return a.frame - b.frame; }); });
  return {
    signature: sig,
    modelName: modelName,
    boneFrameCount: boneCount,
    boneCount: byBone.size,
    boneNames: Array.from(byBone.keys()),
    frames: frames,
    byBone: byBone,
    maxFrame: maxFrame,
    durationSec: maxFrame / FPS,
    fps: FPS
  };
}

// 测试用: 按同一规格**合成**一个 VMD(这样解析器与时间轴可以完全离线断言)
function buildVmd(modelName, keyframes) {
  const nameLen = 20;
  const head = Buffer.alloc(30 + nameLen, 0);
  Buffer.from('Vocaloid Motion Data 0002', 'latin1').copy(head, 0);
  Buffer.from(String(modelName || '').slice(0, nameLen - 1), 'utf8').copy(head, 30);
  const body = Buffer.alloc(keyframes.length * FRAME_BYTES, 0);
  keyframes.forEach(function (k, i) {
    const o = i * FRAME_BYTES;
    Buffer.from(String(k.bone).slice(0, 14), 'utf8').copy(body, o);
    body.writeUInt32LE(k.frame | 0, o + 15);
    for (let a = 0; a < 3; a++) body.writeFloatLE(k.pos[a] || 0, o + 19 + a * 4);
    for (let a = 0; a < 4; a++) body.writeFloatLE(k.rot[a] === undefined ? (a === 3 ? 1 : 0) : k.rot[a], o + 31 + a * 4);
  });
  return Buffer.concat([head, (function () { const c = Buffer.alloc(4); c.writeUInt32LE(keyframes.length, 0); return c; })(), body]);
}

module.exports = { parseVmd: parseVmd, buildVmd: buildVmd, FPS: FPS, FRAME_BYTES: FRAME_BYTES };

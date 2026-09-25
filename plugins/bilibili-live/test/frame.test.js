'use strict';
// 帧编解码单测(纯离线夹具, 不联网、不需要任何凭据): node lib/frame.test.js
// 覆盖真实长连接会遇到的三类情况: ①普通帧 ②压缩帧里打包多条消息 ③半包
const assert = require('assert');
const zlib = require('zlib');
const F = require('../lib/frame.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

// ① 心跳帧(客户端每 30s 发一次, 空体)
const hb = F.encode(F.OP.HEARTBEAT);
const hbFrames = F.decode(hb);
ok(hbFrames.length === 1 && hbFrames[0].op === F.OP.HEARTBEAT && hbFrames[0].body.length === 0, '心跳帧 round-trip(op=2, 空体)');

// ② 认证帧: body 是 JSON
const authBody = JSON.stringify({ roomid: 12345, uid: 0, protover: 3, platform: 'web' });
const af = F.decode(F.encode(F.OP.AUTH, authBody));
ok(af.length === 1 && af[0].op === F.OP.AUTH && af[0].json && af[0].json.roomid === 12345, '认证帧解析出 JSON(op=7)');

// ③ 单条消息帧
const msg = F.decode(F.encode(F.OP.MESSAGE, { cmd: 'DANMU_MSG', info: [[], '你好'] }));
ok(msg.length === 1 && msg[0].json && msg[0].json.cmd === 'DANMU_MSG' && msg[0].json.info[1] === '你好', '单条消息帧解析(含中文往返)');

// ④ 关键: 服务端会把多条帧打包压缩成一帧(protover=2 zlib)
const innerZlib = Buffer.concat([
  F.encode(F.OP.MESSAGE, { cmd: 'DANMU_MSG', info: [[], '第一条'] }),
  F.encode(F.OP.MESSAGE, { cmd: 'SEND_GIFT', data: { giftName: '辣条', num: 1 } }),
  F.encode(F.OP.MESSAGE, { cmd: 'SUPER_CHAT_MESSAGE', data: { price: 30 } })
]);
const bundled = F.encode(F.OP.MESSAGE, zlib.deflateSync(innerZlib), F.PROTOVER.ZLIB);
const un = F.decode(bundled);
ok(un.length === 3 && un[0].json.cmd === 'DANMU_MSG' && un[1].json.cmd === 'SEND_GIFT' && un[2].json.cmd === 'SUPER_CHAT_MESSAGE', 'zlib 打包帧展开成 3 条消息(protover=2)');
ok(un[0].json.info[1] === '第一条', '展开后的中文内容正确');

// ⑤ brotli 变体(protover=3)
const bundledB = F.encode(F.OP.MESSAGE, zlib.brotliCompressSync(innerZlib), F.PROTOVER.BROTLI);
const unB = F.decode(bundledB);
ok(unB.length === 3 && unB[1].json.cmd === 'SEND_GIFT', 'brotli 打包帧同样展开(protover=3)');

// ⑥ 半包: 长连接里一条 socket 数据可能就是半个帧
const whole = F.encode(F.OP.MESSAGE, { cmd: 'DANMU_MSG', info: [[], '半包测试'] });
const cut = Math.floor(whole.length / 2);
const first = F.decodeWithRest(whole.slice(0, cut));
ok(first.frames.length === 0 && first.rest.length === cut, '半包: 只到一半时不产出帧, 尾巴保留(' + first.rest.length + ' 字节)');
const second = F.decodeWithRest(Buffer.concat([first.rest, whole.slice(cut)]));
ok(second.frames.length === 1 && second.rest.length === 0 && second.frames[0].json.info[1] === '半包测试', '拼上后半段后正确产出 1 帧');

// ⑦ 多个完整帧串在一起(同一个 socket 数据里)
const two = Buffer.concat([F.encode(F.OP.HEARTBEAT_REPLY, Buffer.from('0'.repeat(4))), F.encode(F.OP.MESSAGE, { cmd: 'INTERACT_WORD' })]);
const twoF = F.decode(two);
ok(twoF.length === 2 && twoF[0].op === F.OP.HEARTBEAT_REPLY && twoF[1].json.cmd === 'INTERACT_WORD', '一次数据里的两个帧都被解出');

// ⑧ 垃圾数据不崩: 宁可少解, 不能因为坏帧把连接搞崩
const junk = Buffer.from([1, 2, 3, 4, 5]);
const junkR = F.decodeWithRest(junk);
ok(junkR.frames.length === 0 && junkR.rest.length === 5, '垃圾数据: 0 帧、尾巴原样保留、不抛错');
const badHeader = Buffer.alloc(16);
badHeader.writeUInt32BE(32, 0); badHeader.writeUInt16BE(8, 4);   // 头长 8 < 16
const badR = F.decodeWithRest(badHeader);
ok(badR.frames.length === 0 && badR.rest.length === 16, '异常头长(8<16)安全停下');

// ④ 安全审计(2026-09-25): 帧头长度是对方说了算的 —— 三道闸必须真的拦得住
// ① 声明长度超上限(8MB): 不按它去等内存, 报错帧并丢掉缓冲
const big = Buffer.alloc(20);
big.writeUInt32BE(64 * 1024 * 1024, 0);        // 声称 64MB
big.writeUInt16BE(16, 4); big.writeUInt16BE(1, 6); big.writeUInt32BE(F.OP.MESSAGE, 8); big.writeUInt32BE(1, 12);
const bigDec = F.decodeWithRest(big);
ok(bigDec.frames.length === 1 && bigDec.frames[0].error === 'too-large', '超长帧(声称 64MB)被拒: 报 too-large, 不去分配内存');
ok(bigDec.rest.length === 0, '超长帧之后不再继续解析(缓冲丢掉, 不会无限涨)');
// ② 压缩炸弹: 8MB 全零 brotli 压成几 KB, 解压上限 4MB -> 抛错被当成坏帧
const bomb = zlib.brotliCompressSync(Buffer.alloc(8 * 1024 * 1024));
ok(bomb.length < 200 * 1024, '(前提)压缩炸弹本身很小: ' + Math.round(bomb.length / 1024) + 'KB');
const bombDec = F.decode(F.encode(F.OP.MESSAGE, bomb, F.PROTOVER.BROTLI));
ok(bombDec.length === 1 && bombDec[0].error === 'decompress', '压缩炸弹(解开超 4MB)被拒: 报 decompress, 不把内存吃光');
// ③ 嵌套层数: 压缩帧里再套压缩帧, 超过 3 层就停
let nested = F.encode(F.OP.MESSAGE, JSON.stringify({ cmd: 'DANMU_MSG' }));
for (let i = 0; i < 5; i++) nested = F.encode(F.OP.MESSAGE, zlib.brotliCompressSync(nested), F.PROTOVER.BROTLI);
const nestedDec = F.decode(nested);
ok(nestedDec.every(function (f) { return !f.json || f.error; }) && nestedDec.some(function (f) { return f.error === 'decompress'; }), '嵌套压缩超过 3 层: 停下并报坏帧(不会无限递归)');
// ① 正常压缩帧仍然照常展开(别把闸门做成一刀切)
const good = F.decode(F.encode(F.OP.MESSAGE, zlib.brotliCompressSync(F.encode(F.OP.MESSAGE, JSON.stringify({ cmd: 'SEND_GIFT' }))), F.PROTOVER.BROTLI));
ok(good.length === 1 && good[0].json && good[0].json.cmd === 'SEND_GIFT', '正常的一层压缩帧仍然正确展开(闸门没有误伤)');

console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exitCode = fail ? 1 : 0;

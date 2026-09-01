'use strict';
// 设置保护:
// 一级密码(手册公开的软门) + 开发者一次性密码(单向哈希链 Lamport 方案)
// 原理: 解锁器持有主密钥生成链 c1 -> H(c1) -> ... -> cN, 应用只保存链尾锚点 cN;
//       解锁器按逆序发放一次性密码, 应用验证 H(code) == 锚点, 通过后锚点前移、次数 -1。
//       应用分发包内不存在任何可生成密码的秘密(只有锚点哈希), 拿文件给 AI/内存工具均无法逆推下一个密码。
const crypto = require('crypto');
const SALT = 'vrcb-dev-chain-v2';

function h16(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 16);
}
function safeEq(a, b) {
  // 恒定时间比较: 防止本地计时侧信道逐位猜密码
  const sa = String(a || ''), sb = String(b || '');
  if (sa.length !== sb.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sa, 'utf8'), Buffer.from(sb, 'utf8'));
}
function verifyL1(code, expected) {
  const e = String(expected || '').trim();
  if (!e) return false; // 未注册副本: 一级锁定
  return safeEq(String(code || '').trim(), e);
}
// state: { anchor, remaining }
function verifyDev(code, state) {
  if (!state || !state.anchor || state.remaining === undefined || state.remaining <= 0) {
    return { ok: false, reason: '开发者锚点未安装或次数已用完' };
  }
  const c = String(code || '').trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(c)) return { ok: false, reason: '密码不正确' };
  if (!safeEq(h16(c + SALT), String(state.anchor).toLowerCase())) return { ok: false, reason: '密码不正确' };
  return { ok: true, newState: { anchor: c, remaining: state.remaining - 1 } };
}
module.exports = { verifyL1: verifyL1, verifyDev: verifyDev, h16: h16 };

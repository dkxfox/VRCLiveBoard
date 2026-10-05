'use strict';
// 输入法压力测试(F-20260929-03): 用"人类不可能的速度"打长难句, 只看响应速度(不看选词质量)。
// 跑法: node scripts/dev/ime-stress.js
// 说明: 直接在进程内打引擎(不经过 HTTP/端口), 所以**不会碰到用户正在用的 19190 实例**。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { PinyinIME } = require(path.join(ROOT, 'src', 'pinyin.js'));

const SENTENCES = [
  'jintiantianqihenbucuo',                    // 常用句
  'womenshiyizhizaizuoyigeyouyongdegongju',   // 38 字母长句
  'zhegeshurufaxianzaiyongqilaihaibucuo',     // 34 字母
  'woxiangzhidaozhegedongxidaodizenmeyang',   // 38 字母
];
const GARBAGE = [
  'h'.repeat(16), 'q'.repeat(20), 'z'.repeat(24),
  'asdfghjklzxcvbnm', 'zzzzzzzzzzzzzzzzzzzzzzzz', 'x'.repeat(24),
];
const RANDOM = [];
(function () { let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; for (let i = 0; i < 6; i++) { let k = ''; const n = 6 + Math.floor(rnd() * 18); for (let j = 0; j < n; j++) k += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(rnd() * 26)]; RANDOM.push(k); } })();

function pct(arr, p) { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; }
const all = [];
function run(label, keys) {
  const times = [];
  for (const k of keys) { const t = process.hrtime.bigint(); ime.candidates(k, 20); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
  times.forEach((t) => all.push(t));
  const total = times.reduce((a, b) => a + b, 0);
  console.log('  ' + label.padEnd(34) + ' 次数 ' + String(times.length).padStart(4) +
    '  合计 ' + total.toFixed(0).padStart(6) + 'ms   最慢 ' + Math.max.apply(null, times).toFixed(0).padStart(5) + 'ms   p95 ' + pct(times, 0.95).toFixed(0).padStart(4) + 'ms');
  return { total, max: Math.max.apply(null, times) };
}
let ime = null;
(async () => {
  ime = new PinyinIME({ logger: { info: () => {}, warn: (m) => console.log('  [warn] ' + m) }, projectDir: ROOT, fuzzy: ['zh', 'ch', 'sh', 'an'] });
  const tw = Date.now();
  await ime.warmup();
  console.log('  预热(含整句引擎概率表) ' + (Date.now() - tw) + 'ms');

  console.log('');
  console.log('--- 1. 逐字母打长句(每个前缀都是一次请求, 模拟真实连击) ---');
  let worst = 0;
  for (const s of SENTENCES) {
    const keys = []; for (let i = 1; i <= s.length; i++) keys.push(s.slice(0, i));
    const r = run(s.slice(0, 20) + '…(' + s.length + ')', keys);
    worst = Math.max(worst, r.max);
  }
  console.log('');
  console.log('--- 2. 逐字母退格(把长句一个字一个字删掉) ---');
  for (const s of SENTENCES.slice(0, 2)) {
    const keys = []; for (let i = s.length; i >= 1; i--) keys.push(s.slice(0, i));
    const r = run('退格 ' + s.slice(0, 18) + '…', keys); worst = Math.max(worst, r.max);
  }
  console.log('');
  console.log('--- 3. 恶意输入(切不动的串, 曾经把服务端堵死 11 秒) ---');
  for (const g of GARBAGE) { const r = run(JSON.stringify(g.slice(0, 18)) + '(' + g.length + ')', [g]); worst = Math.max(worst, r.max); }
  console.log('');
  console.log('--- 4. 随机字母串(人类乱敲) ---');
  for (const g of RANDOM) { const r = run(JSON.stringify(g), [g]); worst = Math.max(worst, r.max); }
  console.log('');
  console.log('--- 5. 混合乱序 300 次(真实会话的样子) ---');
  const pool = SENTENCES.concat(GARBAGE).concat(RANDOM);
  const mixed = []; let seed = 999;
  for (let i = 0; i < 300; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const s = pool[seed % pool.length]; const n = 1 + (seed % s.length); mixed.push(s.slice(0, n)); }
  const rm = run('混合 300 次', mixed); worst = Math.max(worst, rm.max);

  console.log('');
  console.log('=== 汇总 ===');
  console.log('  总请求 ' + all.length + ' 次, 平均 ' + (all.reduce((a, b) => a + b, 0) / all.length).toFixed(1) + 'ms');
  console.log('  p50 ' + pct(all, 0.5).toFixed(0) + 'ms   p95 ' + pct(all, 0.95).toFixed(0) + 'ms   p99 ' + pct(all, 0.99).toFixed(0) + 'ms   最慢 ' + worst.toFixed(0) + 'ms');
  const ok = pct(all, 0.95) <= 150 && worst <= 500;
  console.log(ok ? '  PASS 合格线: p95<=150ms 且 最慢<=500ms' : '  FAIL 超过合格线(p95 150ms / 最慢 500ms)');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });

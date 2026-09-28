'use strict';
// 构建拼音词库(F-20260925-02 P2-a, 2026-09-29): 生成内置输入法用的紧凑"词 -> 拼音 -> 词频"表。
// 数据来源(**只在构建期**用, 不进发布包):
//   · @node-rs/jieba(MIT) 的 dict.txt —— 结巴分词词典, 格式 `词 频次 词性`, 是**真实词频**(不是排名), 覆盖常用词到专有名词;
//   · pinyin-pro(MIT) 给每个词注音(词组级多音字由它处理)。
// 为什么不用 segmentit 的词典: 实测它的"排名"低段被占位值污染(大量生僻词排名 3), 而且词表偏老(键盘/聊天 这类常用词都不在),
//   按它排序会把生僻词顶到最前面 —— 已弃用该来源。
// 产物: src/data/pinyin-dict.json(随程序分发; 在 src 下, 打包无需额外改动)。
// 用法: node scripts/build-pinyin-dict.js [--max 60000]
const fs = require('fs');
const path = require('path');
const { pinyin } = require('pinyin-pro');

const argv = process.argv.slice(2);
function argOf(n, d) { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; }
const MAX_WORDS = Number(argOf('max', 60000));

const dictPath = path.join(__dirname, '..', 'node_modules', '@node-rs', 'jieba', 'dict.txt');
if (!fs.existsSync(dictPath)) {
  console.error('[ERROR] 找不到 ' + dictPath + ' —— 先跑 npm i -D @node-rs/jieba');
  process.exit(1);
}
const lines = fs.readFileSync(dictPath, 'utf8').split('\n');
const freq = new Map();
let raw = 0;
lines.forEach(function (line) {
  const s = line.trim();
  if (!s || s[0] === '#') return;
  const parts = s.split(/\s+/);
  if (parts.length < 2) return;
  const w = parts[0];
  const f = Number(parts[1]);
  if (!isFinite(f) || f <= 0) return;
  if (w.length < 1 || w.length > 4) return;
  if (!/^[\u4e00-\u9fa5]+$/.test(w)) return;      // 只要纯汉字(数字/字母/标点词条不要)
  raw++;
  const prev = freq.get(w);
  if (prev === undefined || f > prev) freq.set(w, f);
});
console.log('词表原始 ' + raw + ' 条 -> 去重 ' + freq.size);

const entries = Array.from(freq.entries()).sort(function (a, b) { return b[1] - a[1]; });   // 词频高的先入选
// 单字不能只靠词频: 常用字必须都在(打字时第一层就是单字), 所以先保底全量单字, 再按词频补词
const singles = entries.filter(function (kv) { return kv[0].length === 1; });
const multi = entries.filter(function (kv) { return kv[0].length > 1; });
const picked = singles.concat(multi.slice(0, Math.max(0, MAX_WORDS - singles.length)));
console.log('单字 ' + singles.length + ' + 词 ' + (picked.length - singles.length) + ' = 入选 ' + picked.length);

const out = [];
let fail = 0;
picked.forEach(function (kv) {
  const w = kv[0];
  let py = '';
  try { py = pinyin(w, { toneType: 'none', type: 'array', v: true }).join('').replace(/\s+/g, '').toLowerCase(); }
  catch (e) { fail++; return; }
  if (!py || !/^[a-z]+$/.test(py)) { fail++; return; }
  out.push([w, py, kv[1]]);
});
console.log('注音完成 ' + out.length + ' 条(失败 ' + fail + ')');

const dest = path.join(__dirname, '..', 'src', 'data', 'pinyin-dict.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify({
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    sources: ['@node-rs/jieba(MIT) dict.txt 词频', 'pinyin-pro(MIT) 注音'],
    count: out.length,
    note: '由 scripts/build-pinyin-dict.js 生成; 只用于内置输入法的候选排序(频次越大越常用)'
  },
  w: out
}), 'utf8');
console.log('已写入 src/data/pinyin-dict.json (' + Math.round(fs.statSync(dest).size / 1024) + 'KB)');
const probe = ['你好', '我们', '什么', '世界', '聊天', '键盘', '输入法', '手势', '覆盖层', '插件'];
const m = new Map(out.map(function (e) { return [e[0], e[2]]; }));
console.log('抽检: ' + probe.map(function (w) { return w + '=' + (m.has(w) ? m.get(w) : '×(不在)'); }).join('  '));
console.log('频次前 10: ' + out.slice(0, 10).map(function (e) { return e[0]; }).join(' '));

'use strict';
// 内置输入法的回归断言(F-20260929-03): 整句 / 词组 / 模糊音 / 精确 / 简拼 一起验。
// 跑法: node scripts/dev/ime-assert.js      (需要先 npm install 与 node scripts/build-pinyin-engine.js)
// 为什么要它: 这几层(精确->前缀->模糊->简拼->整句)之间有排序耦合, 改动一处很容易把另一处弄坏,
//   我自己就在这上面踩过两次(fuzzy 与 sentence 的排序、长串误跑模糊音导致 4.4 秒)。
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { PinyinIME } = require(path.join(ROOT, 'src', 'pinyin.js'));

const CASES = [
  // [输入, 期望出现在前 N 个里的词, 说明]
  ['nihao', '你好', '精确'],
  ['shurufa', '输入法', '精确(靠整句引擎, 我们词库里没有这个词)'],
  ['surufa', '输入法', '模糊音 sh/s 双向'],
  ['zhangsan', '张三', '精确(前缀命中)'],
  ['zangsan', '张三', '模糊音 zh/z 双向'],
  ['zhemeshuo', '这么说', '精确'],
  ['zemeshuo', '这么说', '模糊音 zh/z'],
  ['jintiantianqihenhao', '今天天气很好', '整句(长串)'],
  ['zhegeshurufazhenbucuo', '这个输入法真不错', '整句 + 词组层'],
  ['mingtianjian', '明天见', '整句 + 词组层'],
  ['wm', '我们', '简拼'],
];

(async () => {
  const ime = new PinyinIME({ logger: { info: () => {}, warn: (m) => console.log('  [warn] ' + m) }, projectDir: ROOT, fuzzy: ['zh', 'ch', 'sh', 'an'] });
  await ime.warmup();
  let fail = 0;
  for (const c of CASES) {
    const t0 = Date.now();
    const list = ime.candidates(c[0], 9);
    const ms = Date.now() - t0;
    const idx = list.findIndex((x) => x.w === c[1]);
    const ok = idx >= 0 && idx < 3;
    if (!ok) fail++;
    console.log((ok ? '  PASS ' : '  FAIL ') + c[0].padEnd(20) + ' 期望「' + c[1] + '」 实际前 3: ' +
      list.slice(0, 3).map((x) => x.w + '(' + x.how + ')').join(' ') + '   ' + ms + 'ms   [' + c[2] + ']');
  }
  // 长串不能跑模糊音(会拖到几秒)
  const t = Date.now();
  ime.candidates('womenshiyizhizaizuoyigehendabuqueyongdegongju', 9);
  const slow = Date.now() - t;
  const okSlow = slow < 1000;
  if (!okSlow) fail++;
  console.log((okSlow ? '  PASS ' : '  FAIL ') + '长串(42 字母)耗时 ' + slow + 'ms(<1000ms 才算合格)');
  console.log(fail ? ('== ' + fail + ' 项失败 ==') : '== 全部通过 ==');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL ' + e.message); process.exit(1); });

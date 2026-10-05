'use strict';
// 内置拼音输入法引擎(F-20260925-02 P2-a, 2026-09-29): 把"拼音串"变成"候选词"。
// 为什么自己做: 用户 D0 选的是"内置小输入法" —— 射线点候选的场景下, 候选行怎么排、翻页怎么给、常用词怎么学,
// 都得自己说了算; 而且不依赖系统输入法(覆盖层里能不能显示候选窗是碰运气)。
// 词库: src/data/pinyin-dict.json(构建期由 scripts/build-pinyin-dict.js 用 jieba 词频 + pinyin-pro 注音生成, 均 MIT)。
// 三类命中(按优先级):
//   ① 完整匹配  nihao  -> 你好
//   ② 前缀匹配  nih    -> 你 / 尼 ...(最后一节没打完, 打字过程中最常见的形态)
//   ③ 首字母    nh     -> 你好(简拼)
// 学习: 用户选过的词会记在 logs/pinyin-learn.json 里, 下次排到同类前面(只在本机, 不上传)。
const fs = require('fs');
const path = require('path');

const DICT_REL = path.join('src', 'data', 'pinyin-dict.json');

class PinyinIME {
  constructor(opts) {
    opts = opts || {};
    this.projectDir = opts.projectDir || path.join(__dirname, '..');
    this.logger = opts.logger || { info: function () {}, warn: function () {} };
    this.learnFile = opts.learnFile || path.join(this.projectDir, 'logs', 'pinyin-learn.json');
    this.dict = null;
    this.byPinyin = new Map();     // 'nihao' -> [{w,f}]
    this.keysSorted = [];          // 供前缀二分查找
    this.byInitials = new Map();   // 'nh' -> [{w,f}]
    this.syllables = new Set();
    this.learned = new Map();      // 词 -> 选中次数
    this.stats = { words: 0, syllables: 0, lookups: 0, sentenceHits: 0 };
    // 整句转换(F-20260929-03 切片 1): 用 pinyin-input-method-engine(MIT)的 HMM + 自带概率表。
    // 它的 dist 相对导入没带扩展名, 所以由 scripts/build-pinyin-engine.js 补好扩展名后放进 build/pinyin-engine/。
    this.sentenceEnabled = opts.sentence !== false;
    // 模糊音(F-20260929-03 切片 2): 只做"兜底"—— 精确查不到足够结果时才用变体再查一遍,
    // 这样既不会让精确匹配变慢/变乱, 又能救回"打错一个音"的情况。默认开最常用的四组(可配置)。
    this.fuzzyGroups = Array.isArray(opts.fuzzy) ? opts.fuzzy.slice() : ['zh', 'ch', 'sh', 'an'];
    this.engineDir = opts.engineDir || path.join(this.projectDir, 'build', 'pinyin-engine');
    this.engineDictDir = opts.engineDictDir || path.join(this.projectDir, 'node_modules', 'pinyin-input-method-engine', 'dict');
    this.engine = null;
    this.engineReady = false;
    // 用户词库(F-20260929-03 切片 3): 用户自己输入法导出的词, 只放本地 logs/(第三方数据, 绝不入库)。
    const { UserDict } = require('./pinyin-userdict');
    this.userDict = new UserDict({ logger: this.logger, file: opts.userDictFile || path.join(this.projectDir, 'logs', 'pinyin-user-dict.json') });
    this._hmmCache = new Map();     // HMM 结果缓存(打字过程里同一批切分会被反复查询)
    this.byDigits = null;           // 九键(T9)索引: '6426' -> [{w,f}] (F-20260929-04)
    this.digitKeys = null;
  }
  // 预热(异步, 由 main.js 启动时调用, 失败不影响旧的查表能力)
  async warmup() {
    if (!this.sentenceEnabled || this.engineReady) return false;
    try {
      const t0 = Date.now();
      const { pathToFileURL } = require('url');
      const eng = await import(pathToFileURL(path.join(this.engineDir, 'index.js')).href);
      const read = (f) => JSON.parse(fs.readFileSync(path.join(this.engineDictDir, f), 'utf8'));
      const hmm = new eng.HiddenMarkovModel(read('hmm_py2hz.json'), read('hmm_start.json'), read('hmm_emission.json'), read('hmm_transition.json'));
      // 词组层(F-20260929-03 切片 1b): 用真实的词组词典, 长句里"很不错"这种才会对。
      // 实测开销可接受: dag_phrase.json 18MB 解析 229ms, 连同 HMM 一起堆内存约 68MB。
      const dag = new eng.DirectedAcyclicGraph(read('dag_char.json'), read('dag_phrase.json'));
      this.engine = { splitAsYinJie: eng.splitAsYinJie, hmm: hmm, dag: dag };
      this.engineReady = true;
      this.logger.info('[输入法] 整句引擎就绪(' + (Date.now() - t0) + 'ms, HMM 概率表 ' + Math.round(fs.statSync(path.join(this.engineDictDir, 'hmm_transition.json')).size / 1048576) + 'MB)');
      return true;
    } catch (e) {
      this.logger.warn('[输入法] 整句引擎加载失败(退回查表): ' + e.message);
      return false;
    }
  }
  // HMM 查询带缓存: 同一个切分在打字过程中会被反复问到(逐键请求 + 模糊音变体), 而 HMM 是这条路径上最贵的一步
  // (实测: 3 音节 36ms / 5 音节 145ms / 9 音节 ~190ms; DAG 则几乎 0ms)
  _hmmQuery(seg, n) {
    const key = seg.join(' ') + '|' + n;
    const hit = this._hmmCache.get(key);
    if (hit) return hit;
    const res = this.engine.hmm.query({ yinJieList: seg, maxNum: n }) || [];
    if (this._hmmCache.size > 400) this._hmmCache.clear();
    this._hmmCache.set(key, res);
    return res;
  }
  // 整句候选: 把连写的拼音串按 HMM 解成最可能的汉字序列。
  // opts.dagOnly: 只跑词组层(几乎 0ms) —— 模糊音变体那种"猜测性"查询用这个, 不值得为它付 HMM 的几十到两百毫秒。
  // 这串拼音能不能切成合法音节?(词表里的 406 个音节做 DP, O(n*6))
  // 为什么必须有它: 引擎的 splitAsYinJie 会**枚举所有切分**, 对"切不动的串"会组合爆炸 ——
  // 实测 'hhh...'(16 个 h)要 11.4 秒、6 个 h 要 3.3 秒, 直接把单线程的服务端堵死, 整个控制台跟着卡。
  // 先做一次廉价的可行性判断, 切不动就根本不进引擎(hahaha 能切 -> 正常走引擎, 依然很快)。
  canSegment(k) {
    if (!this.syllables || !this.syllables.size) return true;   // 音节表还没建好时不拦
    const n = k.length;
    const ok = new Array(n + 1).fill(false);
    ok[n] = true;
    for (let i = n - 1; i >= 0; i--) {
      const max = Math.min(n, i + 6);
      for (let j = i + 1; j <= max; j++) {
        if (ok[j] && this.syllables.has(k.slice(i, j))) { ok[i] = true; break; }
      }
    }
    return ok[0];
  }
  sentenceCandidates(k, want, opts) {
    if (!this.engineReady || !this.engine) return [];
    if (!this.canSegment(k)) return [];      // 切不动 = 不是拼音, 不进引擎(见 canSegment 的说明)
    const dagOnly = !!(opts && opts.dagOnly);
    const out = [];
    try {
      // 只取前 2 个切分: 引擎按可能性排序, 而切分数量会组合爆炸(10+ 个), 全部跑一遍是打字卡顿的主因
      const segs = (this.engine.splitAsYinJie(k) || []).slice(0, 2);
      const seen = new Set();
      for (const seg of segs) {
        if (!seg || seg.length < 2) continue;
        // 词组层(DAG, 真实词组词典)与 HMM(语言模型)**交错**给出: 两套打分口径不同, 不能直接混排,
        // 交错能保证两者的首选都出现在最前面 —— 实测 DAG 对"明天见/真不错"更准, HMM 对生僻句更稳。
        let dagRes = [];
        try { dagRes = this.engine.dag.query({ yinJieList: seg, maxNum: Math.min(want, 6) }) || []; } catch (e) { dagRes = []; }
        // HMM 只在**短串**(<=7 音节)上跑: 实测它与 DAG 的**首选完全一致**(DAG 用的是真实词组词典, 很强),
        // 而成本差 100 倍(14 音节长句: 全量 163ms vs 仅 DAG 1ms)。长串用 DAG, 短串两个都跑(第二/第三候选更丰富)。
        const useHmm = !dagOnly && seg.length <= 7;
        const hmmRes = useHmm ? this._hmmQuery(seg, Math.min(want, 6)) : [];
        const res = [];
        for (let i = 0; i < Math.max(dagRes.length, hmmRes.length); i++) {
          if (dagRes[i]) res.push(dagRes[i]);
          if (hmmRes[i]) res.push(hmmRes[i]);
        }
        for (const r of res) {
          const phrase = (r.phraseInfoList || []).map(function (p) { return p.phrase; }).join('');
          if (!phrase || seen.has(phrase)) continue;
          seen.add(phrase);
          // 分数是极小的小数, 转成"相对词频"便于和查表结果一起排序(取对数后线性化)
          const score = Math.max(0, Math.log10(Math.max(r.score, 1e-300)) + 300);
          out.push({ w: phrase, f: Math.round(score * 100), how: 'sentence', seg: (r.phraseInfoList || []).map(function (p) { return p.phrase; }) });
        }
        if (out.length >= want) break;
      }
      this.stats.sentenceHits += out.length ? 1 : 0;
    } catch (e) { return []; }

    return out.slice(0, want);
  }
  load() {
    if (this.dict) return this.dict;
    const p = path.join(this.projectDir, DICT_REL);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const list = raw.w || [];
    list.forEach((e) => {
      const w = e[0], py = e[1], f = e[2];
      if (!this.byPinyin.has(py)) this.byPinyin.set(py, []);
      this.byPinyin.get(py).push({ w: w, f: f });
    });
    this.byPinyin.forEach(function (arr) { arr.sort(function (a, b) { return b.f - a.f; }); });
    // 并入用户词库: 给一个很高的基频, 保证"你自己常用的词"排在同 rank 的最前面
    try {
      this.userDict.load();
      const self2 = this;
      this.userDict.entries.forEach(function (v, w) {
        const py = v.pinyin;
        if (!py) return;
        if (!self2.byPinyin.has(py)) self2.byPinyin.set(py, []);
        self2.byPinyin.get(py).push({ w: w, f: 10000000 + (v.freq || 0), user: true });
      });
      if (this.userDict.entries.size) {
        this.keysSorted = Array.from(this.byPinyin.keys()).sort();
        this.stats.userWords = this.userDict.entries.size;
      }
    } catch (e) { this.logger.warn('[输入法] 用户词库并入失败: ' + e.message); }
    this.keysSorted = Array.from(this.byPinyin.keys()).sort();
    // 单字拼音就是合法音节表: 用它把词的连写拼音切成音节, 再取首字母
    list.forEach((e) => { if (e[0].length === 1) this.syllables.add(e[1]); });
    this.byPinyin.forEach((arr, py) => {
      const syl = this.splitSyllables(py);
      if (!syl || syl.length < 2 || syl.length > 4) return;
      const ini = syl.map(function (s) { return s[0]; }).join('');
      if (!this.byInitials.has(ini)) this.byInitials.set(ini, []);
      arr.slice(0, 30).forEach((e) => this.byInitials.get(ini).push(e));   // 简拼只留高频的, 免得候选爆炸
    });
    this.byInitials.forEach(function (arr) { arr.sort(function (a, b) { return b.f - a.f; }); });
    this.loadLearned();
    this.dict = raw;
    this.stats.words = list.length;
    this.stats.syllables = this.syllables.size;
    this.logger.info('[输入法] 词库已加载: ' + list.length + ' 词 / ' + this.syllables.size + ' 音节' + (this.learned.size ? (' / 学过的词 ' + this.learned.size) : ''));
    return this.dict;
  }
  // 把连写拼音切成音节(贪心最长匹配, 遇到切不开就返回 null)
  splitSyllables(py) {
    const out = [];
    let i = 0;
    while (i < py.length) {
      let hit = '';
      for (let len = Math.min(6, py.length - i); len >= 1; len--) {
        const s = py.substr(i, len);
        if (this.syllables.has(s)) { hit = s; break; }
      }
      if (!hit) return null;
      out.push(hit);
      i += hit.length;
    }
    return out;
  }
  loadLearned() {
    try {
      const j = JSON.parse(fs.readFileSync(this.learnFile, 'utf8'));
      Object.keys(j || {}).forEach((w) => { const n = Number(j[w]); if (n > 0) this.learned.set(w, n); });
    } catch (e) { /* 没学过就是空的 */ }
  }
  saveLearned() {
    try {
      fs.mkdirSync(path.dirname(this.learnFile), { recursive: true });
      const o = {};
      this.learned.forEach(function (v, k) { o[k] = v; });
      fs.writeFileSync(this.learnFile, JSON.stringify(o), 'utf8');
    } catch (e) { this.logger.warn('[输入法] 学习记录写入失败: ' + e.message); }
  }
  learn(word) {
    const w = String(word || '').trim();
    if (!w) return { ok: false, error: '词为空' };
    this.learned.set(w, (this.learned.get(w) || 0) + 1);
    this.saveLearned();
    return { ok: true, word: w, count: this.learned.get(w) };
  }
  boost(e) { return this.learned.get(e.w) ? (1 + 5 * this.learned.get(e.w)) : 1; }
  rank(list) { const self = this; return list.map(function (e) { return { w: e.w, f: e.f, learned: self.learned.get(e.w) || 0, score: e.f * self.boost(e) }; }).sort(function (a, b) { return b.score - a.score; }); }
  prefixRange(keys) {
    // 二分找出 keys 开头的键区间 [lo, hi)
    let lo = 0, hi = this.keysSorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.keysSorted[mid] < keys) lo = mid + 1; else hi = mid; }
    const start = lo;
    hi = this.keysSorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.keysSorted[mid] < keys + '\uffff') lo = mid + 1; else hi = mid; }
    return [start, lo];
  }
  // 词库导入(F-20260929-03 切片 3): 文本 -> 用户词库 -> 热并入(不用重启)
  importUserDict(text, source) {
    const r = this.userDict.importText(text, source);
    if (r.ok) {
      this.dict = null;                 // 让下次 load() 重建索引, 把新词并进去
      this.byPinyin = new Map(); this.keysSorted = []; this.byInitials = new Map();
      this.load();
    }
    return r;
  }
  dictStatus() {
    const u = this.userDict.status();
    return { ok: true, builtin: this.dict ? this.stats.words : 0, user: u.words, source: u.source, importedAt: u.importedAt, skippedNoPinyin: u.noPinyin, skippedNonHan: u.bad, engine: this.engineReady, sentence: this.sentenceEnabled, fuzzy: this.fuzzyGroups };
  }
  // 九键(T9)索引(F-20260929-04 路线 A): 把词库建成"数字串 -> [词]"
  // 数字映射就是手机键盘: 2abc 3def 4ghi 5jkl 6mno 7pqrs 8tuv 9wxyz
  buildDigits() {
    const D = { a: '2', b: '2', c: '2', d: '3', e: '3', f: '3', g: '4', h: '4', i: '4', j: '5', k: '5', l: '5', m: '6', n: '6', o: '6', p: '7', q: '7', r: '7', s: '7', t: '8', u: '8', v: '8', w: '9', x: '9', y: '9', z: '9' };
    const map = new Map();
    this.byPinyin.forEach(function (arr, py) {
      let d = '';
      for (let i = 0; i < py.length; i++) { const c = D[py[i]]; if (!c) { d = ''; break; } d += c; }
      if (!d) return;
      if (!map.has(d)) map.set(d, []);
      const bucket = map.get(d);
      for (let i = 0; i < arr.length; i++) bucket.push(arr[i]);
    });
    this.byDigits = map;
    this.digitKeys = Array.from(map.keys()).sort();
  }
  // 九键候选: 数字串按**前缀**匹配(打 6 / 64 / 642 …), 命中后按词频排序
  t9Candidates(digits, n) {
    this.load();
    const k = String(digits || '').replace(/[^0-9]/g, '');
    const want = Math.max(1, Math.min(20, Number(n) || 9));
    this.stats.lookups++;
    if (!k) return [];
    if (!this.byDigits || !this.digitKeys) this.buildDigits();
    let lo = 0, hi = this.digitKeys.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.digitKeys[mid] < k) lo = mid + 1; else hi = mid; }
    const start = lo;
    hi = this.digitKeys.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.digitKeys[mid] < k + '\uffff') lo = mid + 1; else hi = mid; }
    const seen = new Set(), out = [];
    for (let i = start; i < lo && out.length < want * 4; i++) {
      const arr = this.byDigits.get(this.digitKeys[i]);
      for (let j = 0; j < arr.length && out.length < want * 4; j++) {
        if (seen.has(arr[j].w)) continue;
        seen.add(arr[j].w);
        out.push({ w: arr[j].w, f: arr[j].f, how: 't9', digits: this.digitKeys[i] });
      }
    }
    out.sort((a, b) => b.f - a.f);
    return out.slice(0, want);
  }
  // 生成模糊音变体(有上限, 避免组合爆炸): zh->z, ch->c, sh->s, an->ang 及其反向
  fuzzyVariants(k) {
    const MAP = {
      zh: ['z'], ch: ['c'], sh: ['s'],
      z: ['zh'], c: ['ch'], s: ['sh'],
      an: ['ang'], ang: ['an'], in: ['ing'], ing: ['in'], l: ['n'], n: ['l'], f: ['h'], h: ['f']
    };
    // 注意: 方向要**双向**都要试 —— 配置里写 'sh' 表示"sh 与 s 互相混淆",
    // 所以既要把输入里的 sh 换成 s, 也要把 s 换成 sh(踩过一次: 只做了前一个方向, 于是 surufa 生不出变体)。
    const pairs = [];
    this.fuzzyGroups.forEach(function (g) {
      const alts = MAP[g];
      if (!alts) return;
      alts.forEach(function (a) { pairs.push([g, a]); pairs.push([a, g]); });
    });
    let out = new Set([k]);
    pairs.forEach(function (p) {
      const from = p[0], to = p[1];
      const next = new Set(out);
      out.forEach(function (s) {
        let idx = s.indexOf(from, 0);
        while (idx >= 0) {
          next.add(s.slice(0, idx) + to + s.slice(idx + from.length));
          idx = s.indexOf(from, idx + 1);
        }
      });
      out = next;
    });
    out.delete(k);
    // 变体可能不少(组合爆炸), 但**查不到的会被查表阶段自然跳过**, 所以只做上限保护即可。
    return Array.from(out).slice(0, 24);
  }
  candidates(keys, n) {
    this.load();
    const k = String(keys || '').toLowerCase().replace(/[^a-z]/g, '');
    const want = Math.max(1, Math.min(20, Number(n) || 7));
    this.stats.lookups++;
    if (!k) return [];
    const out = [];
    const push = function (arr, how) { arr.forEach(function (e) { out.push({ w: e.w, f: e.f, how: how }); }); };
    // 注意: 这里有整句时也要继续走查表(单字/词候选跟在后面), 用户可能只想选一个词
    const exact = this.byPinyin.get(k);
    if (exact) push(exact, 'full');
    if (out.length < want * 3 && k.length >= 2) {
      const r = this.prefixRange(k);
      const pref = [];
      for (let i = r[0]; i < r[1] && pref.length < 60; i++) {
        const arr = this.byPinyin.get(this.keysSorted[i]);
        for (let j = 0; j < arr.length && pref.length < 60; j++) pref.push(arr[j]);
      }
      pref.sort(function (a, b) { return b.f - a.f; });
      push(pref, 'prefix');
    }
    // 模糊音兜底: 前面的精确/前缀/简拼都没凑够时, 用变体再查一遍(结果标 how:'fuzzy' 便于界面区分)
    // 只对"词/短语"做模糊音(k.length<=12): 长串是整句输入, 不是打错字 —— 对长串跑变体会拖到几秒
    // (实测一个 42 字母的句子从 165ms 变成 4420ms), 而且没有意义。
    if (out.length < want && k.length >= 2 && k.length <= 12) {
      const seenW = new Set(out.map(function (e) { return e.w; }));
      // 变体上限压到 3, 其中只给**前 2 个**跑引擎 —— 引擎查询是打字路径上最贵的一步(实测每个变体 20~100ms)
      const variants = this.fuzzyVariants(k).slice(0, 3);
      let engineTried = 0;
      for (let vi = 0; vi < variants.length && out.length < want * 2; vi++) {
        const v = variants[vi];
        const arr2 = this.byPinyin.get(v);
        if (arr2) {
          for (let j = 0; j < arr2.length && out.length < want * 2; j++) {
            if (seenW.has(arr2[j].w)) continue;
            seenW.add(arr2[j].w);
            out.push({ w: arr2[j].w, f: arr2[j].f, how: 'fuzzy', from: v });
          }
        }
        // 关键: 我们自己的词库只有 6 万条, 引擎的词表大得多(词组 14 万) —— 纠错主要靠它。
        // 例: surufa -> shurufa -> 「输入法」, 而 shurufa 并不在我们词库里。
        // 变体交给引擎时, 结果标 **sentence 而不是 fuzzy** —— 因为引擎对"变体"和对"原串"的打分是**同一套口径**,
        // 可以直接比大小; 而如果标成 fuzzy(优先级更高), 就会让"正确输入的引擎结果"被"错拼变体的引擎结果"压下去
        // (实测: shurufa 本来能出「输入法」, 却被 surufa 的「宿儒发」挤到后面)。
        if (out.length < want && this.engineReady && engineTried < 2) {
          engineTried++;
          this.sentenceCandidates(v, 3, { dagOnly: true }).forEach(function (e) {
            if (seenW.has(e.w)) return;
            seenW.add(e.w);
            out.push({ w: e.w, f: e.f, how: 'sentence', from: v });
          });
        }
      }
    }
    if (out.length < want * 3 && k.length >= 2 && k.length <= 4) {
      const ini = this.byInitials.get(k);
      if (ini) push(ini.slice(0, 40), 'initials');
    }
    // 去重 + 排序: 先看"学过的"(提升), 再看命中方式, 最后看词频。
    // 命中方式的口径(F-20260929-03): 完整词 > 模糊音纠错 > 前缀 > 整句(语言模型猜测) > 简拼。
    // 注意: 任何新加的 how **必须**在这里登记 —— 漏了会算出 NaN, 排序直接崩(这条踩过一次)。
    const howRank = { full: 0, fuzzy: 1, prefix: 2, sentence: 3, initials: 4 };
    const rankOf = function (how) { return howRank[how] === undefined ? 99 : howRank[how]; };
    const seen = new Set();
    const merged = [];
    out.forEach(function (e) {
      if (seen.has(e.w)) return;
      seen.add(e.w);
      merged.push(e);
    });
    const self = this;
    merged.sort(function (a, b) {
      const la = self.learned.get(a.w) || 0, lb = self.learned.get(b.w) || 0;
      if ((la > 0) !== (lb > 0)) return lb - la;
      if (rankOf(a.how) !== rankOf(b.how)) return rankOf(a.how) - rankOf(b.how);
      return (b.f * self.boost(b)) - (a.f * self.boost(a));
    });
    // 整句候选在**最后**补进来(F-20260929-03): 字典/模糊命中("你大概率就是想打这个词")优先于
    // 语言模型对错拼的猜测; 而长句(词典必然查不到)只有它一个来源, 所以照样会排在第一位。
    if (k.length >= 4 && merged.length < want * 2) {
      const seenW2 = new Set(merged.map(function (e) { return e.w; }));
      this.sentenceCandidates(k, Math.max(1, Math.min(5, want))).forEach(function (e) {
        if (!seenW2.has(e.w)) { seenW2.add(e.w); merged.push(e); }
      });
      merged.sort(function (a, b) {
        const la = self.learned.get(a.w) || 0, lb = self.learned.get(b.w) || 0;
        if ((la > 0) !== (lb > 0)) return lb - la;
        if (rankOf(a.how) !== rankOf(b.how)) return rankOf(a.how) - rankOf(b.how);
        return (b.f * self.boost(b)) - (a.f * self.boost(a));
      });
    }
    return merged.slice(0, want);
  }
  status() {
    this.load();
    return { words: this.stats.words, syllables: this.stats.syllables, lookups: this.stats.lookups, learned: this.learned.size, dict: DICT_REL.replace(/\\/g, '/') };
  }
}
module.exports = { PinyinIME: PinyinIME };

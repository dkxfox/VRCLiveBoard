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
    this.engineDir = opts.engineDir || path.join(this.projectDir, 'build', 'pinyin-engine');
    this.engineDictDir = opts.engineDictDir || path.join(this.projectDir, 'node_modules', 'pinyin-input-method-engine', 'dict');
    this.engine = null;
    this.engineReady = false;
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
      this.engine = { splitAsYinJie: eng.splitAsYinJie, hmm: hmm };
      this.engineReady = true;
      this.logger.info('[输入法] 整句引擎就绪(' + (Date.now() - t0) + 'ms, HMM 概率表 ' + Math.round(fs.statSync(path.join(this.engineDictDir, 'hmm_transition.json')).size / 1048576) + 'MB)');
      return true;
    } catch (e) {
      this.logger.warn('[输入法] 整句引擎加载失败(退回查表): ' + e.message);
      return false;
    }
  }
  // 整句候选: 把连写的拼音串按 HMM 解成最可能的汉字序列
  sentenceCandidates(k, want) {
    if (!this.engineReady || !this.engine) return [];
    const out = [];
    try {
      const segs = this.engine.splitAsYinJie(k) || [];
      const seen = new Set();
      for (const seg of segs) {
        if (!seg || seg.length < 2) continue;
        const res = this.engine.hmm.query({ yinJieList: seg, maxNum: Math.min(want, 6) }) || [];
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
  candidates(keys, n) {
    this.load();
    const k = String(keys || '').toLowerCase().replace(/[^a-z]/g, '');
    const want = Math.max(1, Math.min(20, Number(n) || 7));
    this.stats.lookups++;
    if (!k) return [];
    const out = [];
    const push = function (arr, how) { arr.forEach(function (e) { out.push({ w: e.w, f: e.f, how: how }); }); };
    // 整句优先(F-20260929-03): 输入较长(>=4 个字母)且引擎就绪时, 先给整句候选
    if (k.length >= 4) {
      const sent = this.sentenceCandidates(k, Math.max(1, Math.min(5, want)));
      if (sent.length) out.push.apply(out, sent);
    }
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
    if (out.length < want * 3 && k.length >= 2 && k.length <= 4) {
      const ini = this.byInitials.get(k);
      if (ini) push(ini.slice(0, 40), 'initials');
    }
    // 去重 + 排序: 先看"学过的"(提升), 再看命中方式(完整 > 前缀 > 简拼), 最后看词频
    const howRank = { full: 0, prefix: 1, initials: 2 };
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
      if (howRank[a.how] !== howRank[b.how]) return howRank[a.how] - howRank[b.how];
      return (b.f * self.boost(b)) - (a.f * self.boost(a));
    });
    return merged.slice(0, want);
  }
  status() {
    this.load();
    return { words: this.stats.words, syllables: this.stats.syllables, lookups: this.stats.lookups, learned: this.learned.size, dict: DICT_REL.replace(/\\/g, '/') };
  }
}
module.exports = { PinyinIME: PinyinIME };

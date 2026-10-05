'use strict';
// 用户词库导入(F-20260929-03 切片 3): 把用户自己输入法导出的词库并进内置输入法。
// 为什么要它: 内置词库再大也不认识"你常打的词"; 而搜狗/微软拼音的用户词库正是这些词。
//
// 数据规矩(与 MMD 动作同一条): 用户词库是**第三方数据**, 只放本地(logs/), 绝不入库、绝不随包分发。
//
// 支持的输入格式(逐行, 尽量宽松):
//   词 拼音 词频      <- 深蓝词库转换(imewlconverter)自定义格式; 词频可省略
//   词<TAB>拼音
//   词 拼音
//   词               <- 没有拼音时用 pinyin-pro 注音(可选依赖, 没有就跳过并计数)
// # 开头与空行忽略。
const fs = require('fs');
const path = require('path');

function splitLine(line) {
  const t = String(line).replace(/\r/g, '').trim();
  if (!t || t[0] === '#' || t[0] === '/') return null;
  // 先按制表符/多空格切; 再把第一段当词, 第二段当拼音, 第三段当词频
  const parts = t.split(/[\t]+|\s{1,}/).filter(function (s) { return s.length > 0; });
  if (!parts.length) return null;
  const word = parts[0];
  let pinyin = '', freq = 0;
  if (parts[1] && /^[a-z'’]+$/i.test(parts[1])) pinyin = parts[1].toLowerCase().replace(/['’]/g, '');
  if (parts[2] && /^[0-9]+$/.test(parts[2])) freq = parseInt(parts[2], 10);
  return { word: word, pinyin: pinyin, freq: freq };
}

function parse(text) {
  const out = { entries: [], noPinyin: 0, bad: 0 };
  String(text || '').split(/\n/).forEach(function (line) {
    const e = splitLine(line);
    if (!e) return;
    if (!e.pinyin) { out.noPinyin++; }
    if (!/[\u4e00-\u9fff]/.test(e.word)) { out.bad++; return; }   // 只收含汉字的词
    out.entries.push(e);
  });
  return out;
}

class UserDict {
  constructor(opts) {
    opts = opts || {};
    this.logger = opts.logger || { info: function () {}, warn: function () {} };
    this.file = opts.file || null;                 // 持久化位置(默认由调用方给 logs/pinyin-user-dict.json)
    this.entries = new Map();                      // 词 -> { pinyin, freq, src }
    this.meta = { importedAt: 0, source: '', words: 0, noPinyin: 0, bad: 0 };
    this.pinyinOf = opts.pinyinOf || null;          // 可选: 汉字注音函数(没有就跳过无拼音的行)
  }
  load() {
    try {
      if (!this.file || !fs.existsSync(this.file)) return false;
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      (j.entries || []).forEach((e) => { if (e && e.w && e.py) this.entries.set(e.w, { pinyin: e.py, freq: e.f || 0, src: e.src || '' }); });
      this.meta = Object.assign(this.meta, j.meta || {}, { words: this.entries.size });
      this.logger.info('[输入法] 用户词库已加载: ' + this.entries.size + ' 词(来源: ' + (this.meta.source || '未知') + ')');
      return true;
    } catch (e) { this.logger.warn('[输入法] 用户词库读取失败: ' + e.message); return false; }
  }
  save() {
    if (!this.file) return false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const entries = [];
      this.entries.forEach(function (v, k) { entries.push({ w: k, py: v.pinyin, f: v.freq, src: v.src }); });
      fs.writeFileSync(this.file, JSON.stringify({ meta: this.meta, entries: entries }), 'utf8');
      return true;
    } catch (e) { this.logger.warn('[输入法] 用户词库保存失败: ' + e.message); return false; }
  }
  // 导入: 返回统计(供界面显示), **不抛异常**
  importText(text, source) {
    const p = parse(text);
    let added = 0, replaced = 0, skipped = 0;
    const self = this;
    p.entries.forEach(function (e) {
      let py = e.pinyin;
      if (!py && self.pinyinOf) { try { py = self.pinyinOf(e.word) || ''; } catch (err) { py = ''; } }
      if (!py) { skipped++; return; }
      if (self.entries.has(e.word)) replaced++; else added++;
      self.entries.set(e.word, { pinyin: py, freq: e.freq || 0, src: source || '' });
    });
    this.meta = { importedAt: Date.now(), source: source || '', words: this.entries.size, noPinyin: p.noPinyin, bad: p.bad };
    const saved = this.save();
    const r = { ok: true, added: added, replaced: replaced, skipped: skipped, total: this.entries.size, noPinyin: p.noPinyin, bad: p.bad, saved: saved };
    this.logger.info('[输入法] 词库导入: 新增 ' + added + ' / 覆盖 ' + replaced + ' / 跳过(无拼音) ' + skipped + ' -> 共 ' + this.entries.size + ' 词');
    return r;
  }
  clear() {
    this.entries.clear();
    this.meta = { importedAt: Date.now(), source: '', words: 0, noPinyin: 0, bad: 0 };
    this.save();
    return { ok: true, total: 0 };
  }
  status() {
    return { file: this.file, words: this.entries.size, source: this.meta.source || '', importedAt: this.meta.importedAt || 0, noPinyin: this.meta.noPinyin || 0, bad: this.meta.bad || 0 };
  }
}

module.exports = { UserDict: UserDict, parse: parse };

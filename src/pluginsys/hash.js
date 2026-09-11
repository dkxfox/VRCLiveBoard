'use strict';
// 插件审批哈希(M-20260911-34)
// 旧口径只哈希 index.js —— 改 cdp.js / *.bat / *.ps1 不会让既有授权失效(审计挂账 M7)。
// 新口径把**整个插件目录**纳入: 相对路径 + 内容一起哈希, 目录项排序保证稳定。
// 兼容: 读授权时"旧口径 index.js 哈希"仍然接受(老用户不必重新授权), 新授权一律存全目录哈希。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKIP_DIRS = new Set(['node_modules', 'data']);   // data/ 是运行时数据, 不属于"被批准的代码"

function hashIndex(dir) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'index.js'))).digest('hex').slice(0, 16); } catch (e) { return ''; }
}

function hashDir(dir) {
  const h = crypto.createHash('sha256');
  (function walk(d, rel) {
    let items = [];
    try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    items.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    for (const it of items) {
      const r = rel ? rel + '/' + it.name : it.name;
      const p = path.join(d, it.name);
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) continue;
        h.update('D:' + r + '\n');
        walk(p, r);
      } else {
        try { h.update('F:' + r + '\n'); h.update(fs.readFileSync(p)); } catch (e) {}
      }
    }
  })(dir, '');
  return h.digest('hex').slice(0, 16);
}

function format(id, version, api, bodyHash) { return String(id + '@' + version + '|' + (api || '') + '|' + bodyHash); }

module.exports = { hashIndex: hashIndex, hashDir: hashDir, format: format };

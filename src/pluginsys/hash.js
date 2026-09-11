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

// 全量口径(M-20260911-40): 目录内容 + manifest.permissions —— 权限声明变了也必须重新确认。
// 旧的两级口径(index.js / 目录)在 manager 里继续被兼容接受, 所以老用户不会被要求重新授权。
function permsKey(manifest) {
  try { return JSON.stringify((manifest && manifest.permissions) || {}); } catch (e) { return ''; }
}
function hashPlugin(dir, manifest) {
  const h = crypto.createHash('sha256');
  h.update('PERMS:' + permsKey(manifest) + '\n');
  h.update(hashDir(dir));
  return h.digest('hex').slice(0, 16);
}

module.exports = { hashIndex: hashIndex, hashDir: hashDir, hashPlugin: hashPlugin, permsKey: permsKey, format: format };

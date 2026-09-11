'use strict';
// 前端逻辑文件清单(供各门禁共享): 自动发现 src/web/public/*.js
//   - 2026-09-11 教训: app.js 拆成多文件时, 凡是"写死了要扫哪个文件"的门禁都会静默缩小覆盖范围,
//     所以这里统一成自动发现, 新增前端文件无需再改任何门禁。
//   - 排除: lang.js(词库本身) / skin.js(品牌与节日数据, 不是界面逻辑)
const fs = require('fs');
const path = require('path');
const EXCLUDE = ['lang.js', 'skin.js'];
function uiJsFiles(root) {
  const dir = path.join(root, 'src', 'web', 'public');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names
    .filter((n) => n.endsWith('.js') && EXCLUDE.indexOf(n) < 0)
    .sort()
    .map((n) => path.join(dir, n));
}
function uiJsSources(root) {
  return uiJsFiles(root).map((f) => ({ file: path.basename(f), path: f, text: fs.readFileSync(f, 'utf8') }));
}
function uiJsText(root) {
  return uiJsSources(root).map((x) => x.text).join('\n');
}
// 按 index.html 里 script src 的真实顺序返回(执行顺序必须与浏览器一致:
// app.js 先定义 $ / feErr, 后面的文件才能用; 主题与动效在 app.js 之后)。解析失败则退回按文件名排序。
function uiJsOrder(root) {
  const set = new Set(uiJsFiles(root).map((f) => path.basename(f)));
  const html = fs.readFileSync(path.join(root, 'src', 'web', 'public', 'index.html'), 'utf8');
  const out = [];
  for (const m of html.matchAll(/<script[^>]*src="\/([^"]+)"/g)) {
    const n = m[1];
    if (set.has(n) && out.indexOf(n) < 0) out.push(n);
  }
  if (!out.length) return uiJsFiles(root);
  const dir = path.join(root, 'src', 'web', 'public');
  return out.map((n) => path.join(dir, n));
}
module.exports = { uiJsFiles, uiJsSources, uiJsText, uiJsOrder, EXCLUDE };

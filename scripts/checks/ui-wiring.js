'use strict';
// G-UWIRE 控件接线: index.html 里带 id 的交互控件, 必须在 app.js 里找得到引用
//   坑源: 新版 UI 移植时"只搬了 HTML 控件, 没搬事件处理器" → 20 个死按键(M-20260907-01)
//   与 GHTML 的分工: GHTML 验 JS→HTML(getElementById 目标是否存在), 这里验 HTML→JS(控件有没有人管)
//   两种合法接线形态: ①字符串里出现 id ②$('id') / getElementById('id')(裸标识符靠浏览器命名访问, GBOOT 一律拒绝)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const PUB = path.join(ROOT, 'src', 'web', 'public');
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
const esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
const dead = [];
let total = 0;
const tagRe = /<(button|input|select|textarea)\b([^>]*)>/gi;
let m;
while ((m = tagRe.exec(html)) !== null) {
  const id = (m[2].match(/\bid="([^"]+)"/) || [])[1];
  if (!id) continue;
  total++;
  if (/\bonclick=/i.test(m[2])) continue;
  const e = esc(id);
  const quoted = app.indexOf("'" + id + "'") >= 0 || app.indexOf('"' + id + '"') >= 0;
  const byId = new RegExp("\\$\\('" + e + "'\\)|getElementById\\('" + e + "'\\)").test(app);
  if (!quoted && !byId) dead.push(m[1].toLowerCase() + '#' + id);
}
console.log('[G-UWIRE ui-wiring] 控件接线: 受检 ' + total + ' 个带 id 控件 / 死控件 ' + dead.length);
for (const d of dead) console.log('  -> FAIL 无任何 JS 引用(点了不会有反应): ' + d);
process.exitCode = dead.length ? 1 : 0;

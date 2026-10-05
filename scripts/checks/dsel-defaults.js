'use strict';
// 静态门禁(F-20260929-02 收尾): 自绘下拉不得"空心"。
// 背景: 2026-10-05 用户实测"品牌下拉首次启动是个空心胶囊" —— 值匹配不到任何选项时不显示文字。
// 组件侧已经修成"回落第一个选项"(见 dsel-behavior.js 的 3 条断言), 但**数据侧**也要盯住:
//   HTML 里每个 .dsel 要么有非空 data-value, 要么在 app.js 的 mount(...) 里给了非空 value。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'src', 'web', 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'src', 'web', 'public', 'app.js'), 'utf8');
const bad = [];
let n = 0;
const re = /<button[^>]*class="dsel"[^>]*>/g;
let m;
while ((m = re.exec(html))) {
  const tag = m[0];
  const id = (tag.match(/id="([^"]+)"/) || [])[1];
  if (!id) { bad.push('(无 id 的 .dsel)'); continue; }
  n++;
  const dv = (tag.match(/data-value="([^"]*)"/) || [])[1];
  if (dv === undefined || dv === '') {
    const i = js.indexOf("mount('" + id + "'");
    if (i < 0) { bad.push(id + ': HTML 无 data-value, app.js 里也找不到挂载'); continue; }
    const seg = js.slice(i, i + 600);
    const vm = seg.match(/value:\s*'([^']*)'/);
    // 空字符串本身可能是**合法选项**(例: trigAsrEngine 的第一项就是"关闭", value 为空) -> 那种不算空心
    const head = seg.slice(0, seg.indexOf(']'));
    const emptyIsOption = /value:\s*''/.test(head);
    if (!vm || (!vm[1] && !emptyIsOption)) bad.push(id + ': 挂载时没给非空 value, 且空值不是合法选项(首次会显示为空)');
  }
}
console.log('  .dsel 控件 ' + n + ' 个, 检查默认值');
if (bad.length) { bad.forEach(function (b) { console.log('  FAIL ' + b); }); process.exitCode = 1; }
else console.log('  PASS 每个控件的默认值都非空(或由挂载给出非空值)');
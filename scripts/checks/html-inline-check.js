'use strict';
// G-HTML 控制台页面门禁: 内联+外链脚本语法 + 重复 id + getElementById 目标存在性
//   坑源: 每加一行 HTML 内联脚本边界就漂移(条目 81), 预览框元素从未接线(19)
//   2026-09-02 index.html 拆分后: 主脚本外链为 app.js, 此门禁改为同时检查外链脚本存在性与语法
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const file = path.join(ROOT, 'src', 'web', 'public', 'index.html');
const html = fs.readFileSync(file, 'utf8');

// 动态取脚本边界(禁止写死行号); src 外链与内联一起处理
const blocks = [];
const openRe = /<script([^>]*)>/gi;
let m;
while ((m = openRe.exec(html)) !== null) {
  const src = (m[1].match(/src\s*=\s*["']([^"']+)["']/) || [])[1] || null;
  if (src && !src.startsWith('/api')) {
    blocks.push({ src: src });
    openRe.lastIndex = m.index + m[0].length;
    continue;
  }
  const start = m.index + m[0].length;
  const end = html.indexOf('</script>', start);
  if (end < 0) { blocks.push({ start, end: html.length, broken: true }); break; }
  blocks.push({ start, end, code: html.slice(start, end) });
  openRe.lastIndex = end;
}

let fail = 0;
console.log('[G-HTML html-inline-check] 脚本块: ' + blocks.length + ' (内联 ' + blocks.filter((b) => b.code !== undefined || b.broken).length + ' / 外链 ' + blocks.filter((b) => b.src).length + ')');
for (const [i, b] of blocks.entries()) {
  if (b.src) {
    const f = path.join(ROOT, 'src', 'web', 'public', b.src.replace(/^\//, '').split('/').join(path.sep));
    if (!fs.existsSync(f)) { console.log('  FAIL 外链脚本不存在: ' + b.src); fail++; continue; }
    try {
      new vm.Script(fs.readFileSync(f, 'utf8'), { filename: b.src });
      console.log('  OK   ' + b.src + ' 存在且语法通过 (' + fs.statSync(f).size + ' 字节)');
    } catch (e) { console.log('  FAIL ' + b.src + ' 语法错误: ' + e.message); fail++; }
    continue;
  }
  if (b.broken) { console.log('  FAIL 第 ' + (i + 1) + ' 块缺少 </script> 闭合'); fail++; continue; }
  try { new vm.Script(b.code, { filename: 'index.html#inline' + (i + 1) }); console.log('  OK   第 ' + (i + 1) + ' 块语法通过 (' + b.code.length + ' 字符)'); }
  catch (e) { console.log('  FAIL 第 ' + (i + 1) + ' 块语法错误: ' + e.message); fail++; }
}

// 约定(PROCESS-02 §0 #5 + 台账): 前端逻辑一律进 app.js / 独立 .js, index.html 不再出现内联脚本块。
// 2026-09-11 迁移(theme.js / fx.js)后内联块已清零, 这里把它固化成门禁; 确需内联时请在此显式放行。
const inlineBlocks = blocks.filter((b) => b.code);
if (inlineBlocks.length) { console.log('  FAIL index.html 出现 ' + inlineBlocks.length + ' 个内联脚本块(约定: 前端逻辑进 app.js / 独立 .js)'); fail++; }
else console.log('  OK   无内联脚本块(前端逻辑全部在独立 .js 里)');
// 重复 id
const ids = [...html.matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((x) => x[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) { console.log('  FAIL 重复 id: ' + [...new Set(dup)].join(', ')); fail++; }
else console.log('  OK   id 唯一性: ' + ids.length + ' 个 id 无重复');

// getElementById 目标存在性: HTML + 全部外链脚本一起收集引用(拆分后引用都在 app.js; 动态创建的元素会误报, 故只 WARN)
const idSet = new Set(ids);
const jsTexts = [html];
for (const b of blocks) if (b.src) {
  const f = path.join(ROOT, 'src', 'web', 'public', b.src.replace(/^\//, '').split('/').join(path.sep));
  if (fs.existsSync(f)) jsTexts.push(fs.readFileSync(f, 'utf8'));
}
const refs = [];
// 取用方式两种都要算(M-20260911-42): app.js 里大量用 $('id')(它就是 getElementById 的别名) ——
// 只统计字面量 getElementById( 会漏掉真正出问题的那些元素。
for (const t of jsTexts) refs.push(...[...t.matchAll(/(?:getElementById|\$)\(\s*["']([^"']+)["']\s*\)/g)].map((x) => x[1]));
// 元素声明顺序(M-20260911-42): 前端脚本同步执行, 写在 <script> 之后的元素在加载期根本不存在 ——
// 静态检查看不出"取不到元素", 只能靠位置约束: 凡是被 JS 取用的 id, 必须在第一个 <script> 之前声明。
// 基准取 app.js 自己的 <script> 位置(它才是同步执行 DOM 取用的那个脚本; head 里的 lang.js/skin.js 更早但不碰这些元素)
let anchorAt = html.indexOf('<script src="/app.js"');
if (anchorAt < 0) anchorAt = html.search(/<script/i);
const earlyIds = new Set([...html.slice(0, anchorAt < 0 ? html.length : anchorAt).matchAll(/\sid\s*=\s*["']([^"']+)["']/g)].map((x) => x[1]));
const lateIds = [...new Set(refs)].filter((r) => idSet.has(r) && !earlyIds.has(r));
if (lateIds.length) { console.log('  FAIL 这些元素声明在 <script> 之后(app.js 加载期取不到, 事件挂不上/初始化被跳过): ' + lateIds.slice(0, 10).join(', ')); fail++; }
else console.log('  OK   被 JS 取用的元素都在 <script> 之前声明');

const missing = [...new Set(refs)].filter((r) => !idSet.has(r));
if (missing.length) console.log('  WARN getElementById 目标在 HTML 中不存在(可能是动态创建): ' + missing.slice(0, 10).join(', '));
else console.log('  OK   getElementById 目标全部存在 (' + new Set(refs).size + ' 个)');

// 反馈方式约定(M-20260911-24): 前端不得出现 alert() —— 弹窗会挡住整个界面、内容也回看不了。
// 旧版控制台的反馈都落在页面上(按钮旁 / 结果块 / 底部提示条); 新版移植时有多处被改成 alert, 这里固化成门禁。
const alertHits = [];
for (const b of blocks) {
  if (!b.src) continue;
  const f2 = path.join(ROOT, 'src', 'web', 'public', b.src.replace(/^\//, '').split('/').join(path.sep));
  if (!fs.existsSync(f2)) continue;
  const code = fs.readFileSync(f2, 'utf8');
  const re2 = /(^|[^\w.$])alert\s*\(/g;
  let m2;
  while ((m2 = re2.exec(code)) !== null) alertHits.push(b.src + ':' + code.slice(0, m2.index).split('\n').length);
}
if (alertHits.length) { console.log('  FAIL 前端出现 alert() 弹窗(约定: 用页内提示 note(), 确认类用 confirm): ' + alertHits.join(', ')); fail++; }
else console.log('  OK   前端无 alert() 弹窗(反馈走页内提示)');

// 下拉选项的 value 安全(M-20260911-25): <option data-t="..."> 被 applyLang 写进 textContent 后, 若没显式写 value=,
// 元素的 value 就变成译文 —— 保存/触发时会把"视觉模型(更准,按量计费)"当成模式发给后端。
// 规则: 只要 JS 里读过 $('X').value / getElementById('X').value, 这个 <select id="X"> 的每个 <option> 都必须显式带 value=。
const jsAll = jsTexts.join('\n');
const badSelects = [];
for (const sm2 of html.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/gi)) {
  const sid = (sm2[1].match(/\sid\s*=\s*["']([^"']+)["']/) || [])[1];
  if (!sid) continue;
  const readsValue = new RegExp("(getElementById\\(\\s*[\"']" + sid + "[\"']\\s*\\)|\\$\\(\\s*[\"']" + sid + "[\"']\\s*\\))[^\\n]{0,40}\\.value").test(jsAll);
  if (!readsValue) continue;
  for (const om of sm2[2].matchAll(/<option([^>]*)>/gi)) if (!/value\s*=/.test(om[1])) badSelects.push('#' + sid);
}
if (badSelects.length) { console.log('  FAIL 下拉选项缺显式 value=(JS 会读 .value, 文案翻译后会把译文当值发出去): ' + [...new Set(badSelects)].join(', ')); fail++; }
else console.log('  OK   读了 .value 的下拉都有显式 value=(文案翻译不会污染取值)');


// 公告板列表项长文本的样式契约(M-20260911-49): 这几条是"长公告不再撑变卡片"的全部实现, 缺一条就退化 ——
//   ① min-width:0 —— 没有它 flex 子项按 min-content 宽度撑开, 长文本把行/卡片顶宽;
//   ② -webkit-line-clamp + -webkit-box-orient:vertical + overflow:hidden —— 行高封顶两行;
//   ③ white-space:normal + text-indent/padding-left —— 允许换行并给续行悬挂缩进;
//   ④ 不允许任何一条 .edrow .snip 规则再写回 white-space:nowrap(旧写法, 会覆盖上面的换行)。
const styleText = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [, ''])[1];
// 长文本撑爆卡片(M-20260911-49): grid 轨道里的裸 1fr 其隐含最小值是 auto, 一条长 URL/英文串就能把整列顶宽
//   (实测 #grid2 在 1280 窗口下 1080px → 2867px, 邻列被挤到 233px, 整页横向滚动)。多列时每列都必须写 minmax(0,1fr);
//   单列(响应式降级 / 整体布局)不涉及顶宽, 放行。
const bareGrid = [];
for (const mm of styleText.matchAll(/grid-template-columns\s*:([^;}]*)/g)) {
  const tracks = mm[1].trim().split(/\s+/).filter(Boolean);
  if (tracks.length < 2) continue;
  if (tracks.some((t) => t === '1fr')) bareGrid.push(mm[1].trim());
}
if (bareGrid.length) { console.log('  FAIL grid 多列出现裸 1fr(长文本会顶宽卡片): ' + bareGrid.join(' | ')); fail++; }
else console.log('  OK   grid 多列都是 minmax(0,…)(长文本顶不宽卡片)');
// 公告板正文的自动缩进契约(M-20260911-49): 折行续行缩进, 显式换行不缩(each-line/hanging), 且能断长串。
const pageTextRule = (styleText.match(/[^}]*#pageText\s*\{([^}]*)\}/) || [, ''])[1];
if (!/text-indent\s*:[^;}]*hanging[^;}]*each-line/.test(pageTextRule)) { console.log('  FAIL #pageText 缺少 text-indent:…hanging each-line(长正文折行不会自动缩进)'); fail++; }
else console.log('  OK   公告板正文折行自动缩进(text-indent:hanging each-line)');
const snipRules = [...styleText.matchAll(/\.edrow\s+\.snip\s*\{([^}]*)\}/g)].map((x) => x[1]);
const snipAll = snipRules.join(';');
const snipMiss = [];
if (!/min-width\s*:\s*0/.test(snipAll)) snipMiss.push('min-width:0');
if (!/-webkit-line-clamp\s*:/.test(snipAll)) snipMiss.push('-webkit-line-clamp');
if (!/-webkit-box-orient\s*:\s*vertical/.test(snipAll)) snipMiss.push('-webkit-box-orient:vertical');
if (!/white-space\s*:\s*normal/.test(snipAll)) snipMiss.push('white-space:normal');
if (!/text-indent\s*:\s*-/.test(snipAll)) snipMiss.push('悬挂缩进(text-indent:-…)');
if (/white-space\s*:\s*nowrap/.test(snipAll)) snipMiss.push('(禁止)white-space:nowrap 会覆盖换行');
if (snipMiss.length) { console.log('  FAIL 公告板列表项 .edrow .snip 样式契约缺失: ' + snipMiss.join(', ')); fail++; }
else console.log('  OK   公告板列表项长文本: 两行截断 + 悬挂缩进 + 可收缩(' + snipRules.length + ' 条规则)');

process.exit(fail ? 1 : 0);

'use strict';
// GHTML 附加断言(自绘下拉, F-20260929-02): 组件契约 + 值/文案分离 + 迁移进度
// 背景: 原生 <select> 的下拉是独立顶层窗口 -> 在 VR 桌面视图里点不着; 改用页面内自绘下拉。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const PUB = path.join(ROOT, 'src', 'web', 'public');
const { uiJsText } = require('./_ui-files.js');

const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const js = uiJsText(ROOT);
const fails = [];

// 1) 组件存在且暴露五个方法
const dselPath = path.join(PUB, 'dsel.js');
if (!fs.existsSync(dselPath)) fails.push('缺少 src/web/public/dsel.js(自绘下拉组件)');
else {
  const src = fs.readFileSync(dselPath, 'utf8');
  if (src.indexOf('__dsel') < 0) fails.push('dsel.js 没有暴露 __dsel');
  ['mount', 'get', 'set', 'onChange', 'closeAll'].forEach(function (name) {
    if (src.indexOf(name + ':') < 0 && src.indexOf(name + ' =') < 0 && src.indexOf(name + '(') < 0) {
      fails.push('dsel.js 缺少方法 ' + name);
    }
  });
}
// 2) 引入顺序: dsel.js 必须在 app.js 之前
const iDsel = html.indexOf('/dsel.js');
const iApp = html.indexOf('/app.js');
if (iDsel < 0) fails.push('index.html 没有引入 /dsel.js');
else if (iApp >= 0 && iDsel > iApp) fails.push('index.html 里 /dsel.js 必须在 /app.js 之前引入');

// 3) 每个自绘下拉都要有 data-value(值不能靠文案)
const dselIds = [];
const reTag = /<(?:button|input|div)([^>]*class="[^"]*\bdsel\b[^"]*"[^>]*)>/gi;
let m;
while ((m = reTag.exec(html)) !== null) {
  const id = (m[1].match(/\bid="([^"]+)"/) || [])[1];
  if (!id) continue;
  dselIds.push(id);
  if (!/\bdata-value=/.test(m[1])) fails.push('自绘下拉 #' + id + ' 缺少 data-value(值不能靠文案)');
}
// 4) 已迁移控件不许再读 .value(会把译文当值)
dselIds.forEach(function (id) {
  const e = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(?:\\$|getElementById)\\(\\s*[\'"]' + e + '[\'"]\\s*\\)\\.value');
  if (re.test(js)) fails.push('#' + id + ' 已迁移到自绘下拉, 但前端代码仍在读 .value(应改用 __dsel.get)');
});
// 5) 重复 mount 必须就地更新(页面会轮询刷新; 重建会把旧列表留在 DOM 里 -> 选完不收回、列表越堆越多)
if (fs.existsSync(dselPath)) {
  const dsrc = fs.readFileSync(dselPath, 'utf8');
  if (dsrc.indexOf('if (reg[id]) {') < 0) fails.push('dsel.js 的 mount 必须支持重复调用(就地更新), 不能每次重建');
}

// 6) 迁移进度
const selCount = (html.match(/<select\b/gi) || []).length;
console.log('[GHTML dsel-check] 自绘下拉: 已迁移 ' + dselIds.length + ' 个 / 剩余 <select> ' + selCount + ' 个');
// 控制台里**不允许再出现原生 <select>**: 它的下拉是独立窗口, 在 VR 桌面视图里点不着(F-20260929-02)。
// 需要多选一就用 class="dsel" 的自绘下拉。
if (selCount > 0) fails.push('控制台里还有 ' + selCount + ' 个原生 <select>(VR 里点不着) -> 请改用 class="dsel" 的自绘下拉');
// 2026-10-05: 不得给取值函数赋值 —— window.__dsel.get(x) = ... 会在运行时抛 ReferenceError, 让整页卡在启动画面(用户实测: 网页只剩标题)
if (/__dsel\.get\([^)]*\)\s*=(?!=)/.test(js)) fails.push('前端代码出现 __dsel.get(...) = ...(给取值函数赋值会直接白屏), 应改用 __dsel.set(id, 值)');
for (const f of fails) console.log('  -> FAIL ' + f);
if (!fails.length) console.log('  OK   自绘下拉契约满足(值/文案分离 + 引入顺序 + 无 .value 残留)');
process.exitCode = fails.length ? 1 : 0;

// 默认值检查(2026-10-05): 见 dsel-defaults.js —— 自绘下拉不得空心
require('./dsel-defaults.js');

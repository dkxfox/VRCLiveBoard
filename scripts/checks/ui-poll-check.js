'use strict';
// 前端状态轮询"更新回路"验证(开发工具; 候选门禁, 尚未接入 run-gates.ps1 —— 动门禁运行器属 PROCESS-01 §5 的 H 档, 待拍板)
// 坑源(2026-09-12, 真事故): app.js 的 pollStatus() 里三段更新 —— 当前来源(#curMeta)/截图倒计时(#shotMsg)/端口信息(#portsInfo)——
//   被插进了 **catch 分支**, 只有状态接口抛异常时才执行。也就是说这三项"移植已恢复"的功能**从来没生效过**:
//   语法合法、门禁全绿、界面只是安静地不更新(用户看到的是"来源那一行空着")。
//   同批还发现 #curMeta 用了 String(NM(id)) 显示原始键名(应为 tr(NM(id))), 且丢了 来源/优先级/剩余 三个标签。
// 做法: 从 app.js 里**按大括号配对抽出 pollStatus 源码**, 用假 DOM + 假 fetch 走一遍**正常路径**, 断言元素真被写入。
//   刻意不引第三方 DOM 库: 需要的元素与依赖都是显式声明的小对象(与项目既有"假 WebSocket"思路一致)。
// 局限: 依赖"pollStatus 仍是顶层 async function 且体内无模板字符串/含大括号的字符串" —— 破坏这个前提会**响亮地失败**(提取为空), 不会静默通过。
// 用法: node scripts/checks/ui-poll-check.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'web', 'public', 'app.js'), 'utf8');
const startAt = src.indexOf('async function pollStatus(');
if (startAt < 0) { console.log('FAIL 找不到 pollStatus(app.js 结构变了, 请同步本脚本)'); process.exit(1); }
let depth = 0, endAt = -1, opened = false;
for (let i = startAt; i < src.length; i++) {
  const c = src[i];
  if (c === '{') { depth++; opened = true; } else if (c === '}') { depth--; if (opened && depth === 0) { endAt = i + 1; break; } }
}
if (endAt < 0) { console.log('FAIL pollStatus 大括号不配对(提取失败)'); process.exit(1); }
const fnSrc = src.slice(startAt, endAt);
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; fails.push(msg); console.log('  FAIL ' + msg); } }
const els = {};
function el(id) { if (!els[id]) els[id] = { id: id, textContent: '', className: '', style: {}, hidden: false }; return els[id]; }
const calls = [];
const DATA = {
  '/api/status': { vrc: { running: true, oscEnabled: true }, sources: [], current: { sourceId: 'hardware', priority: 10, ttlUntil: Date.now() + 8000, text: 'x' }, ocrState: { phase: 'countdown', countdown: 3 } },
  '/api/ports/check': { udp9000: { occupied: false } },
  '/api/ports': { web: { host: '127.0.0.1', actual: 19191 }, osc: { port: 9000 } }
};
const sandbox = {
  window: {}, console: console, Date: Date,
  document: { querySelectorAll: function () { return []; } },
  $: el,
  tr: function (k) { return '<' + k + '>'; },
  NM: function (id) { return ({ hardware: 'srcHW', media: 'srcMedia' })[id] || id; },
  setDot: function () {}, renderSrcTable: function () {}, applyAnim: function () {},
  shotHint: function (t) { calls.push('shotHint(' + t + ')'); },
  apiFail: function (id) { calls.push('apiFail(' + id + ')'); },
  fetch: async function (u) { return { json: async function () { return DATA[u] || {}; } }; }
};
vm.createContext(sandbox);
const pollStatus = vm.runInContext('(function(){' + fnSrc + '; return pollStatus;})()', sandbox);
console.log('[前端更新回路] 抽出 pollStatus ' + fnSrc.split('\n').length + ' 行, 用假 DOM/假 fetch 走正常路径');
(async function () {
  await pollStatus();
  const meta = els.curMeta ? els.curMeta.textContent : '';
  const hint = calls.join(',');
  ok(hint.indexOf('apiFail') < 0, '正常路径不触发异常分支 (' + (hint || '无异常回调') + ')');
  ok(meta.indexOf('<curFrom><srcHW>') === 0, '当前来源写成译文且带标签(不是键名): ' + meta);
  ok(meta.indexOf('<curPrio>10') > 0 && meta.indexOf('<curLeft>') > 0 && meta.indexOf('<curLeftS>') > 0, '优先级与剩余秒数带标签: ' + meta);
  ok(hint.indexOf('shotHint(<ocrRunning> 3)') >= 0, '截图倒计时写进提示: ' + hint);
  ok(el('portsInfo').textContent === '<portsWeb> 19191 · <portsOsc> 9000', '端口信息写入: ' + el('portsInfo').textContent);
  ok(el('consoleUrl').textContent === 'http://127.0.0.1:19191', '控制台实际地址写入: ' + el('consoleUrl').textContent);
  ok(el('vrcText').textContent === '<running>' && el('udpText').textContent === '<udpFree>', '状态卡/UDP 状态不受影响');
  console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
  process.exitCode = fail ? 1 : 0;
})();

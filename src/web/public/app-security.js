'use strict';
// 控制台前端 · 块 2/2: 安全与权限(旧版套皮) + i18n 取词 + 语言切换
// 2026-09-11 从 app.js 拆出(见 M-20260911-17)。加载顺序在 app.js 之后、theme.js 之前:
//   window.t 兼容别名在这里赋值, theme.js 的显示名依赖它。
// ===== 安全与权限(旧版套皮) =====
const T = window.VRCB_LANG || { 'zh-CN': {} };
// tr / t / 当前语言码都来自 lang.js(<head> 最先加载) —— 这里不再重复定义(2026-09-25 归位, M-20260925-05):
// app.js 会在本文件执行**之前**就可能调用 tr(), 所以取词必须比 app.js 更早就位。
// 注意: 这里**不要**写 `const tr = window.tr` —— GI18NU 门禁会拦"局部绑定遮蔽取词函数"; 直接用全局 tr 即可。
function langGet() { return window.__lang(); }
function langSet(v) { return window.__lang(v); }
function applyLang() {
  document.documentElement.lang = langGet();
  document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = tr(el.getAttribute('data-t')); });
  document.querySelectorAll('[data-t-ph]').forEach(function (el) { el.placeholder = tr(el.getAttribute('data-t-ph')); }); document.querySelectorAll('[data-tt]').forEach(function (el) { el.title = tr(el.getAttribute('data-tt')); }); try{buildBdVar();}catch(e){apiFail('applyLang',e);}
}
var VAR_LABELS={'{cpu_util}':'varCpuUtil','{cpu_temp}':'varCpuTemp','{gpu_util}':'varGpuUtil','{gpu_temp}':'varGpuTemp','{mem_used}':'varMemUsed','{mem_total}':'varMemTotal','{net_down}':'varNetDown','{net_up}':'varNetUp','{song}':'varSong','{artist}':'varArtist','{album}':'varAlbum','{date}':'varDate','{time}':'varTime'}; function buildBdVar(){var s=$('bdVar');if(!s)return;for(var i=0;i<s.options.length;i++){var o=s.options[i];var k=VAR_LABELS[o.value];if(k)o.textContent=o.value+' · '+tr(k);}} function reRenderAll(){try{applyLang();}catch(e){apiFail('reRenderAll',e);}try{renderBoard();}catch(e){apiFail('reRenderAll',e);}try{renderSrcTable(true);}catch(e){apiFail('reRenderAll',e);}try{renderEnv();}catch(e){apiFail('reRenderAll',e);}try{renderPlgCards();}catch(e){apiFail('reRenderAll',e);}try{pollStatus();}catch(e){apiFail('reRenderAll',e);}try{if(window.__reThemeLabels)window.__reThemeLabels();}catch(e){apiFail('reRenderAll',e);}} async function gateRender() {
  try {
    const st = await (await fetch('/api/devgate/status')).json();
    const cfg = await (await fetch('/api/config')).json();
    const box = document.getElementById('secBox');
    const devSec = document.getElementById('devBoxSec');
    const devSwf = document.getElementById('devBoxSwf');
    if (box) box.style.display = st.level1 ? 'block' : 'none';
    if (devSec) devSec.style.display = st.level2 ? 'block' : 'none';
    if (devSwf) devSwf.style.display = st.level2 ? 'block' : 'none';
    const sec = (cfg.ocrtl && cfg.ocrtl.security) || {};
    const swf = cfg.swearFilter || {};
    const se = document.getElementById('secExtra'); if (se) se.value = sec.extraPrompt || '';
    const sd = document.getElementById('secDef'); if (sd) sd.checked = sec.promptDefense !== false;
    const sj = document.getElementById('secJson'); if (sj) sj.checked = sec.jsonMode !== false;
    const ss = document.getElementById('secSan'); if (ss) ss.checked = sec.outputSanitize !== false;
    const so = document.getElementById('swfOn'); if (so) so.checked = swf.enabled !== false;
    const bw = sec.blockWords || [];
    const svv = document.getElementById('secWordsView'); if (svv) svv.value = bw.join('\n');
    const sve = document.getElementById('secWordsEdit'); if (sve && st.level2) sve.value = bw.join('\n');
    const ww = swf.words || [];
    const swv = document.getElementById('swfWordsView'); if (swv) swv.value = ww.join('\n');
    const sw = document.getElementById('swfWords'); if (sw && st.level2) sw.value = ww.join('\n');
    const gm = document.getElementById('gateMsg');
    if (gm) {
      if (st.level2) gm.textContent = tr('gateL2On');
      else if (st.level1) gm.textContent = tr('gateL1On');
      else if (st.l1LockRemainingSec) { const m = Math.floor(st.l1LockRemainingSec / 60); const s2 = st.l1LockRemainingSec % 60; gm.textContent = (tr('gateLocked') || '').replace('{m}', m).replace('{s}', s2); gm.style.color = 'var(--err)'; }
      else gm.textContent = '';
    }
  } catch(e){apiFail('sec-gate',e);}
}
// 自动感知加密狗解锁: 每 3 秒查一次解锁状态, 变化即自动展开对应设置区(无需刷新/输密码)
let lastGate = { l1: false, l2: false };
setInterval(function () {
  fetch('/api/devgate/status')
    .then(function (r) { return r.json(); })
    .then(function (st) {
      if (!st) return;
      if (st.level1 !== lastGate.l1 || st.level2 !== lastGate.l2) {
        lastGate.l1 = st.level1;
        lastGate.l2 = st.level2;
        gateRender();
      }
    })
    .catch(function(e){apiFail('sec-gate',e);});
}, 3000);
function gateVerify(level) {
  const code = (document.getElementById('gateCode') || {}).value || '';
  fetch('/api/devgate/verify', { method: 'POST', body: JSON.stringify({ level: level, code: code }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const gm = document.getElementById('gateMsg');
      if (j && j.ok) { if (gm) gm.textContent = level === 2 ? tr('gateL2On') : tr('gateL1On'); gateRender(); psLoad(); }
      else if (j && j.lockRemainingSec) { const m = Math.floor(j.lockRemainingSec / 60); const s2 = j.lockRemainingSec % 60; if (gm) { gm.textContent = (tr('gateLocked') || '').replace('{m}', m).replace('{s}', s2); gm.style.color = 'var(--err)'; } }
      else { if (gm) { gm.textContent = tr('gateBad'); gm.style.color = 'var(--err)'; } }
    })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = tr('gateFail') + e.message; });
}
var _g1 = document.getElementById('gateL1'); if (_g1) _g1.onclick = function () { gateVerify(1); };
var _g2 = document.getElementById('gateL2'); if (_g2) _g2.onclick = function () { gateVerify(2); };
function secSave() {
  const args = {
    promptDefense: !!(document.getElementById('secDef') && document.getElementById('secDef').checked),
    jsonMode: !!(document.getElementById('secJson') && document.getElementById('secJson').checked),
    outputSanitize: !!(document.getElementById('secSan') && document.getElementById('secSan').checked),
    extraPrompt: (document.getElementById('secExtra') || {}).value || ''
  };
  fetch('/api/security', { method: 'POST', body: JSON.stringify(args) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? tr('secSaved') : (tr('saveFail')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = tr('saveFail')+': ' + e.message; });
}
function psLoad() {
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (j) {
    const s = j.pluginsSecurity || {};
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.value = v; };
    set('psNet', s.networkPolicy || 'whitelist'); set('psProc', s.processPolicy || 'consent'); set('psFsW', s.fsWritePolicy || 'sandbox'); set('psFsR', s.fsReadPolicy || 'self'); set('psAi', s.aiPolicy || 'allow');
  }).catch(function(e){apiFail('psLoad',e);});
}
function psSave() {
  const v = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
  fetch('/api/security', { method: 'POST', body: JSON.stringify({ pluginsSecurity: { networkPolicy: v('psNet'), processPolicy: v('psProc'), fsWritePolicy: v('psFsW'), fsReadPolicy: v('psFsR'), aiPolicy: v('psAi') } }) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok !== false, j: j }; }).catch(function () { return { ok: r.ok, j: {} }; }); })
    .then(function (o) { const m = document.getElementById('psMsg'); if (m) m.textContent = o.ok ? tr('plgSecSaved') : (tr('failed')+': ' + ((o.j && o.j.error) || '')); });
}
function secAddWordFn() {
  const w = ((document.getElementById('secAddWord') || {}).value || '').trim();
  if (!w) return;
  fetch('/api/security', { method: 'POST', body: JSON.stringify({ addWords: [w] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? tr('secWordAdded') : (tr('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = tr('failed')+': ' + e.message; });
}
function secWordsSave() {
  const words = ((document.getElementById('secWordsEdit') || {}).value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  fetch('/api/security-words', { method: 'POST', body: JSON.stringify({ words: words }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? tr('secWordsSaved') : (tr('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = tr('failed')+': ' + e.message; });
}
function secWordsReset() {
  fetch('/api/security-words', { method: 'POST', body: JSON.stringify({ resetDefaults: true }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? tr('secWordsResetOk') : (tr('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function(e){apiFail('secWordsReset',e);});
}
function swfAddWordFn() {
  const w = ((document.getElementById('swfAddWord') || {}).value || '').trim();
  if (!w) return;
  fetch('/api/swearfilter', { method: 'POST', body: JSON.stringify({ addWords: [w] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? tr('swfWordAdded') : (tr('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = tr('failed')+': ' + e.message; });
}
function swfSave() {
  fetch('/api/swearfilter', { method: 'POST', body: JSON.stringify({ enabled: !!(document.getElementById('swfOn') && document.getElementById('swfOn').checked) }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? tr('swfSaved') : (tr('saveFail')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = tr('saveFail')+': ' + e.message; });
}
function swfWordsSave() {
  const words = ((document.getElementById('swfWords') || {}).value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  fetch('/api/swearfilter-words', { method: 'POST', body: JSON.stringify({ words: words }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? tr('swfWordsSaved') : (tr('saveFail')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = tr('saveFail')+': ' + e.message; });
}
function swfWordsReset() {
  fetch('/api/swearfilter-words', { method: 'POST', body: JSON.stringify({ resetDefaults: true }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? tr('swfWordsResetOk') : (tr('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function(e){apiFail('swfWordsReset',e);});
}
// 安全初始化(在 T/lang 声明后)
try{applyLang();}catch(e){apiFail('sec-gate',e);}
try{gateRender();}catch(e){apiFail('sec-gate',e);}
try{psLoad();}catch(e){apiFail('sec-gate',e);}

// 语言切换
if($('langSel'))$('langSel').onchange=function(){langSet(this.value);try{fetch('/api/lang',{method:'POST',body:JSON.stringify({lang:lang})});}catch(e){apiFail('#langSel',e);}reRenderAll();};

// 语言加载(读回保存的语言)
(async function(){try{var _c=await (await fetch('/api/config')).json();langSet((_c&&_c.lang)||'zh-CN');var _ls=$('langSel');if(_ls)_ls.value=langGet();reRenderAll();}catch(e){apiFail('#langSel',e);}})();


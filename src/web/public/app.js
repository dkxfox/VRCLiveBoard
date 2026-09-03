
// 前端错误上报(诊断): 任何未捕获错误写进后端日志, 便于远程排障
window.onerror = function (msg, src, line) {
  try { fetch('/api/fe-err', { method: 'POST', body: JSON.stringify({ msg: String(msg), line: line, ua: navigator.userAgent }) }); } catch (e) {}
};
window.addEventListener('unhandledrejection', function (ev) {
  try { fetch('/api/fe-err', { method: 'POST', body: JSON.stringify({ msg: 'Promise拒绝: ' + String(ev.reason), line: 0, ua: navigator.userAgent }) }); } catch (e) {}
});
const T = window.VRCB_LANG || { 'zh-CN': {} };

let lang = 'zh-CN';
function t(k) { const d = T[lang] || T['zh-CN']; return (d[k] !== undefined) ? d[k] : (T['zh-CN'][k] !== undefined ? T['zh-CN'][k] : k); }
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t(el.getAttribute('data-t')); });
  document.querySelectorAll('[data-t-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-t-ph')); });
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
let pagesCache = null;
async function loadPages() {
  try {
    const r = await fetch('/api/config'); const c = await r.json();
    pagesCache = c.pages.slice();
    document.getElementById('rotMs').value = Math.max(3, Math.round((Number(c.rotationMs) || 8000) / 1000));
    renderPages();
  } catch (e) {}
}
let collapsedPages = {};
function renderPages() {
  const box = document.getElementById('pages');
  box.innerHTML = '';
  const bc = document.getElementById('boardsCount');
  if (bc) bc.textContent = (t('boardsCount') || '').replace('{n}', String((pagesCache || []).length));
  (pagesCache || []).forEach(function (p, i) {
    const isCol = !!collapsedPages[i];
    const div = document.createElement('div');
    div.className = 'pagebox';
    const head = document.createElement('div');
    head.className = 'pagehead';
    head.style.cursor = 'pointer';
    const caret = document.createElement('span');
    caret.textContent = isCol ? '▶' : '▼';
    const countSpan = document.createElement('span');
    const prev = document.createElement('span');
    prev.className = 'sub';
    prev.style.flex = '1';
    prev.style.padding = '0 8px';
    const mkSmall = function (label, title, fn) {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.classList.add('gray');
      b.style.padding = '2px 8px';
      b.style.fontSize = '12px';
      b.style.marginRight = '4px';
      b.onclick = function (ev) { ev.stopPropagation(); fn(); };
      return b;
    };
    if (i > 0) head.appendChild(mkSmall('▲', t('moveUp'), function () { const a = pagesCache[i - 1]; pagesCache[i - 1] = pagesCache[i]; pagesCache[i] = a; const c2 = collapsedPages[i - 1]; collapsedPages[i - 1] = collapsedPages[i]; collapsedPages[i] = c2; renderPages(); }));
    if (i < (pagesCache || []).length - 1) head.appendChild(mkSmall('▼', t('moveDown'), function () { const a = pagesCache[i + 1]; pagesCache[i + 1] = pagesCache[i]; pagesCache[i] = a; const c2 = collapsedPages[i + 1]; collapsedPages[i + 1] = collapsedPages[i]; collapsedPages[i] = c2; renderPages(); }));
    head.appendChild(mkSmall('⧉', t('dupPage'), function () { pagesCache.splice(i + 1, 0, { text: pagesCache[i].text }); renderPages(); }));
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = t('del');
    del.onclick = function () { pagesCache.splice(i, 1); delete collapsedPages[i]; renderPages(); };
    head.appendChild(caret);
    head.appendChild(countSpan);
    head.appendChild(prev);
    head.appendChild(del);
    div.appendChild(head);
    const ta = document.createElement('textarea');
    ta.rows = 3;
    ta.value = p.text;
    if (isCol) ta.style.display = 'none';
    const updateCount = function () {
      const n = Array.from(ta.value).length;
      countSpan.textContent = t('pageN') + (i + 1) + t('pageN2') + ' ' + n + t('chars') + (n > 144 ? t('charsOver') : '');
      countSpan.style.color = n > 144 ? 'var(--err)' : 'var(--muted)';
      const first = ta.value.split(/\r?\n/)[0] || '';
      const arr = Array.from(first);
      prev.textContent = isCol ? (arr.length ? (arr.slice(0, 36).join('') + (arr.length > 36 ? '…' : '')) : t('emptyPage')) : '';
    };
    ta.oninput = function () { pagesCache[i].text = ta.value; updateCount(); };
    head.onclick = function (ev) {
      if (ev && ev.target && ev.target.tagName === 'BUTTON') return;
      collapsedPages[i] = !collapsedPages[i];
      renderPages();
    };
    div.appendChild(ta);
    updateCount();
    box.appendChild(div);
  });
}
function toggleBoardsCard() {
  const body = document.getElementById('boardsBody');
  const caret = document.getElementById('boardsCaret');
  if (!body) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? '' : 'none';
  if (caret) caret.textContent = hidden ? '▼' : '▶';
  try { localStorage.setItem('vrcbBoardsOpen', hidden ? '1' : '0'); } catch (e) {}
}
(function () {
  try { if (localStorage.getItem('vrcbBoardsOpen') === '0') { const b = document.getElementById('boardsBody'); if (b) b.style.display = 'none'; const c = document.getElementById('boardsCaret'); if (c) c.textContent = '▶'; } } catch (e) {}
})();
document.getElementById('collapseAll').onclick = function () { for (let k = 0; k < (pagesCache || []).length; k++) collapsedPages[k] = true; renderPages(); };
document.getElementById('expandAll').onclick = function () { collapsedPages = {}; renderPages(); };
document.getElementById('addPage').onclick = function () { pagesCache = pagesCache || []; pagesCache.push({ text: '' }); renderPages(); };
document.getElementById('savePages').onclick = async function () {
  try {
    // 输入框单位是秒(≥3), 后端字段 rotationMs 是毫秒 → 保存时换算并夹取下限
    const rotSec = Math.max(3, Math.round(Number(document.getElementById('rotMs').value) || 8));
    const r = await fetch('/api/config', { method: 'POST', body: JSON.stringify({ pages: pagesCache || [], rotationMs: rotSec * 1000 }) });
    const j = await r.json();
    document.getElementById('pageMsg').textContent = j.ok ? t('savedOk') + j.pageCount + t('savedOk2') : t('saveFail') + ': ' + (j.error || '');
  } catch (e) { document.getElementById('pageMsg').textContent = t('saveFail'); }
};
async function poll() {
  try {
    const r = await fetch('/api/status'); const s = await r.json();
    const v = s.vrc;
    let dotCls = 'off'; let txt = t('vrcOff');
    if (v && v.running && v.oscEnabled) { dotCls = 'on'; txt = t('vrcOn') + (v.oscPort || '?') + ')'; }
    else if (v && v.running) { dotCls = 'warn'; txt = (v.oscEnabled === null || v.oscEnabled === undefined) ? t('vrcUnknown') : t('vrcWarn'); }
    else if (v && !v.running && v.oscEnabled !== null) { txt = v.oscEnabled ? t('vrcLastOn') : t('vrcLastOff'); }
    document.getElementById('vrcDot').className = 'dot ' + dotCls;
    document.getElementById('vrcText').textContent = txt;
    document.getElementById('current').textContent = s.current && s.current.text ? s.current.text : '-';
    const curMeta = document.getElementById('currentMeta');
    if (curMeta) {
      if (s.current) {
        const c = s.current;
        const nm = { hardware: t('srcHW'), media: t('srcMedia'), pages: t('srcPages'), livetranslate: t('srcLive'), ocrregion: t('srcOcr') };
        let metaTxt = t('curFrom') + (c.sourceId === 'transient' ? t('srcTransient') : (nm[c.sourceId] || c.sourceId)) + t('curPrio') + (c.priority || 0);
        if (c.ttlUntil) metaTxt += t('curLeft') + Math.max(0, Math.round((c.ttlUntil - Date.now()) / 1000)) + t('curLeftS');
        curMeta.textContent = metaTxt;
      } else curMeta.textContent = '';
    }
    if (s.ocrState && s.ocrState.phase === 'countdown') {
      document.getElementById('ocrtlState').textContent = t('cdLabel') + s.ocrState.countdown + '...';
    }
    const tb = document.getElementById('srcs'); tb.innerHTML = '';
    const tvOn = document.getElementById('transVoiceOn');
    const lvSrc = (s.sources || []).find(function (x) { return x.id === 'livetranslate'; });
    if (tvOn && lvSrc) tvOn.checked = !!lvSrc.enabled;
    const names = { hardware: t('srcHW'), media: t('srcMedia'), pages: t('srcPages'), livetranslate: t('srcLive'), ocrregion: t('srcOcr') };
    const descs = { hardware: t('srcHWd'), media: t('srcMediad'), pages: t('srcPagesd'), livetranslate: t('srcLived'), ocrregion: t('srcOcrd') };
    for (const x of s.sources) {
      const tr = document.createElement('tr');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = x.enabled;
      cb.onchange = async function () { try { await fetch('/api/sources', { method: 'POST', body: JSON.stringify({ id: x.id, enabled: cb.checked }) }); } catch (e) {} };
      const td1 = document.createElement('td'); td1.appendChild(cb);
      const td2 = document.createElement('td'); td2.textContent = names[x.id] || x.id;
      const td3 = document.createElement('td'); td3.textContent = descs[x.id] || '';
      if (x.helperRunning !== undefined) td3.textContent += (x.helperRunning ? t('smtcRun') : t('smtcDown'));
      if (x.lastError) td3.textContent += t('srcHint') + x.lastError;
      const td4 = document.createElement('td');
      const pin = document.createElement('input');
      pin.type = 'number'; pin.min = '-999'; pin.max = '999'; pin.step = '1';
      pin.value = x.priority; pin.style.width = '56px'; pin.title = t('prioHint');
      pin.onchange = async function () {
        try { await fetch('/api/sources', { method: 'POST', body: JSON.stringify({ id: x.id, priority: Number(pin.value) || 0 }) }); } catch (e) {}
      };
      td4.appendChild(pin);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
      tb.appendChild(tr);
    }
  } catch (e) {}
}
document.getElementById('transVoiceOn').onchange = async function () {
  try { await fetch('/api/sources', { method: 'POST', body: JSON.stringify({ id: 'livetranslate', enabled: this.checked }) }); } catch (e) {}
};
document.getElementById('send').onclick = async function () {
  const tx = document.getElementById('box').value;
  try {
    const r = await fetch('/v1/chatbox', { method: 'POST', body: JSON.stringify({ text: tx }) });
    const j = await r.json();
    document.getElementById('msg').textContent = j.ok ? t('sent') : t('sendFail') + (j.error || '');
  } catch (e) { document.getElementById('msg').textContent = t('sendFail'); }
};
document.getElementById('diag').onclick = async function () {
  const pre = document.getElementById('diagOut');
  pre.style.display = 'block';
  pre.textContent = t('diagRun');
  document.getElementById('diagCopy').style.display = 'none';
  try {
    const r = await fetch('/api/diagnose'); const j = await r.json();
    pre.textContent = JSON.stringify(j, null, 2);
    document.getElementById('diagCopy').style.display = 'inline-block';
  } catch (e) { pre.textContent = t('diagFail') + e.message; }
};
document.getElementById('diagCopy').onclick = async function () {
  const pre = document.getElementById('diagOut');
  try { await navigator.clipboard.writeText(pre.textContent); const m = document.getElementById('msg'); if (m) m.textContent = t('healthCopied'); } catch (e) {}
};
document.getElementById('showConsole').onchange = async function () {
  try {
    const r = await fetch('/api/desktop/console', { method: 'POST', body: JSON.stringify({ visible: this.checked }) });
    const j = await r.json();
    if (!j.ok) this.checked = !this.checked;
  } catch (e) { this.checked = !this.checked; }
};
document.getElementById('devdocsBtn').onclick = function () {
  fetch('/api/devdocs/open', { method: 'POST', body: '{}' }).then(function () {}).catch(function () {});
};
document.getElementById('quitBtn').onclick = function () {
  if (confirm(t('quitConfirm'))) fetch('/api/desktop/quit', { method: 'POST', body: '{}' }).catch(function () {});
};
document.getElementById('restartBtn').onclick = function () {
  if (confirm(t('restartConfirm'))) fetch('/api/desktop/restart', { method: 'POST', body: '{}' }).catch(function () {});
};
let logTimer = null;
let logLines = [];
function renderLogs() {
  const el = document.getElementById('logView');
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  const keepTop = el.scrollTop;
  const kw = (document.getElementById('logFilter') || {}).value || '';
  const errOnly = !!(document.getElementById('logErrOnly') && document.getElementById('logErrOnly').checked);
  let lines = logLines;
  if (kw) lines = lines.filter(function (l) { return l.indexOf(kw) >= 0; });
  if (errOnly) lines = lines.filter(function (l) { return /\[(warn|error)\]|错误|失败|error|warn/i.test(l); });
  el.textContent = lines.join('\n');
  // 正在底部 → 跟随滚动; 否则保持原位置(不再被拽回顶部)
  if (atBottom) el.scrollTop = el.scrollHeight;
  else el.scrollTop = Math.min(keepTop, el.scrollHeight - el.clientHeight);
}
async function loadLogs() {
  try {
    const r = await fetch('/api/logs?tail=200'); const j = await r.json();
    if (j && j.lines) logLines = j.lines;
    renderLogs();
  } catch (e) {}
}
document.getElementById('logRefresh').onclick = loadLogs;
document.getElementById('logAuto').onchange = function () {
  if (this.checked) { if (!logTimer) logTimer = setInterval(loadLogs, 4000); }
  else { if (logTimer) { clearInterval(logTimer); logTimer = null; } }
};
document.getElementById('logFilter').oninput = renderLogs;
document.getElementById('logErrOnly').onchange = renderLogs;
document.getElementById('logCopy').onclick = async function () {
  const el = document.getElementById('logView');
  const msg = document.getElementById('logMsg');
  try { await navigator.clipboard.writeText(el ? el.textContent : ''); if (msg) msg.textContent = t('healthCopied'); } catch (e) { if (msg) msg.textContent = 'clipboard: ' + e.message; }
};
document.getElementById('autoStart').onchange = async function () {
  const on = this.checked;
  try {
    const r = await fetch('/api/autostart', { method: 'POST', body: JSON.stringify({ enabled: on }) });
    const j = await r.json();
    document.getElementById('autoMsg').textContent = j.ok ? (on ? t('autoOn') : t('autoOff')) : t('autoFail') + ': ' + (j.error || '');
  } catch (e) { document.getElementById('autoMsg').textContent = t('autoFail'); }
};
async function loadAuto() {
  try {
    const r = await fetch('/api/config'); const c = await r.json();
    if (c.lang) { lang = c.lang; document.getElementById('langSel').value = lang; }
    applyLang();
    document.getElementById('autoStart').checked = !!c.autostart;
    document.getElementById('showConsole').checked = !!(c.desktop && c.desktop.showConsole);
    if (c.ocrtl) {
      document.getElementById('ocrtlDelay').value = c.ocrtl.delayMs / 1000;
      document.getElementById('ocrtlDisplay').value = c.ocrtl.displayMs / 1000;
      document.getElementById('ocrtlLoops').value = c.ocrtl.loops;
      document.getElementById('ocrtlMode').value = c.ocrtl.mode || 'auto';
      const vv = c.ocrtl.vision || {};
      document.getElementById('visBase').value = vv.apiBase || 'https://api.deepseek.com';
      document.getElementById('visModel').value = vv.model || 'deepseek-v4-flash-vision-exp';
      if (vv.hasKey) document.getElementById('visKey').placeholder = 'sk-••••••(已配置)';
      toggleVisionBox();
      const cap = c.ocrtl.capture || {};
      if (cap.mode) document.getElementById('capMode').value = cap.mode;
      updateCapInfo(cap);
    }
    gateRender();
  } catch (e) {}
}
document.getElementById('langSel').onchange = async function () {
  lang = this.value;
  try { await fetch('/api/lang', { method: 'POST', body: JSON.stringify({ lang: lang }) }); } catch (e) {}
  applyLang();
  renderPages(); plgLoad(); pollEnv(); loadLt();
};
function toggleVisionBox() {
  const m = document.getElementById('ocrtlMode').value;
  document.getElementById('visionBox').style.display = (m === 'ocr') ? 'none' : 'block';
}
document.getElementById('ocrtlMode').onchange = toggleVisionBox;
document.getElementById('visSave').onclick = async function () {
  const body = { apiBase: document.getElementById('visBase').value.trim() || 'https://api.deepseek.com', apiKey: document.getElementById('visKey').value.trim(), model: document.getElementById('visModel').value.trim() || 'deepseek-v4-flash-vision-exp', targetLang: 'zh' };
  try {
    const r = await fetch('/api/ocrtl-vision', { method: 'POST', body: JSON.stringify(body) });
    const j = await r.json();
    document.getElementById('visMsg').textContent = j.ok ? t('visSaved') : t('visSaveFail') + (j.error || '');
    if (j.ok) loadAuto();
  } catch (e) { document.getElementById('visMsg').textContent = t('visSaveFail') + e.message; }
};
document.getElementById('ocrtlBtn').onclick = async function () {
  const btn = this; btn.disabled = true;
  const st = document.getElementById('ocrtlState'); st.textContent = '...';
  const out = document.getElementById('ocrtlOut'); out.style.display = 'block'; out.textContent = t('ocrRunning');
  const body = JSON.stringify({ delayMs: (Number(document.getElementById('ocrtlDelay').value) || 5) * 1000, displayMs: (Number(document.getElementById('ocrtlDisplay').value) || 8) * 1000, loops: Number(document.getElementById('ocrtlLoops').value) || 2, mode: document.getElementById('ocrtlMode').value });
  try {
    const r = await fetch('/api/ocrtl', { method: 'POST', body: body });
    const j = await r.json();
    if (j.ok) out.textContent = t('ocrSrcLabel') + '\n' + j.result.ocr + '\n\n' + t('ocrTrLabel') + (j.result.model || '-') + t('ocrTrLabel2') + '\n' + (j.result.translated || t('noCfg'));
    else out.textContent = t('loadFail') + (j.error || '');
    st.textContent = '';
  } catch (e) { out.textContent = t('loadFail') + e.message; st.textContent = ''; }
  btn.disabled = false;
};
// ===== 截图区域(可视化调整) =====
let capDrag = null, capRatio = 1;
function updateCapInfo(cap) {
  const m = document.getElementById('capMode').value;
  let s = t(m === 'window' ? 'capModeWin' : (m === 'screen' ? 'capModeScr' : 'capModeReg'));
  if (m === 'region') {
    const r = (cap && cap.region) || {};
    s = s + ' ' + (r && r.w > 0 ? (r.x + ',' + r.y + ' ' + r.w + '×' + r.h) : t('capNoRegion'));
  }
  document.getElementById('capInfo').textContent = s;
}
document.getElementById('capMode').onchange = async function () {
  try {
    const r = await fetch('/api/capture/set', { method: 'POST', body: JSON.stringify({ mode: this.value }) });
    const j = await r.json();
    if (j.ok) updateCapInfo(j.capture);
  } catch (e) {}
};
document.getElementById('capFull').onclick = async function () {
  try {
    const r = await fetch('/api/capture/set', { method: 'POST', body: JSON.stringify({ mode: 'screen' }) });
    const j = await r.json();
    if (j.ok) { document.getElementById('capMode').value = 'screen'; updateCapInfo(j.capture); }
  } catch (e) {}
};
async function capLoad() {
  const img = document.getElementById('capImg');
  document.getElementById('capRect').style.display = 'none';
  document.getElementById('capSel').textContent = '';
  img.onload = function () {
    capRatio = img.naturalWidth / img.getBoundingClientRect().width;
    document.getElementById('capSel').textContent = '(' + img.naturalWidth + '×' + img.naturalHeight + 'px)';
  };
  img.onerror = function () { document.getElementById('capSel').textContent = t('loadFail'); };
  img.src = '/api/capture/preview?t=' + Date.now();
}
document.getElementById('capAdj').onclick = function () { document.getElementById('capOverlay').style.display = 'flex'; capLoad(); };
document.getElementById('capRefresh').onclick = capLoad;
document.getElementById('capCancel').onclick = function () { document.getElementById('capOverlay').style.display = 'none'; };
document.getElementById('capSave').onclick = async function () {
  const el = document.getElementById('capRect');
  if (!el.style.width || el.style.display === 'none') { document.getElementById('capSel').textContent = t('capHint'); return; }
  const x = Math.round(parseFloat(el.style.left) * capRatio), y = Math.round(parseFloat(el.style.top) * capRatio);
  const w = Math.round(parseFloat(el.style.width) * capRatio), h = Math.round(parseFloat(el.style.height) * capRatio);
  try {
    const r = await fetch('/api/capture/set', { method: 'POST', body: JSON.stringify({ mode: 'region', region: { x: x, y: y, w: w, h: h } }) });
    const j = await r.json();
    if (j.ok) {
      document.getElementById('capMode').value = 'region';
      updateCapInfo(j.capture);
      document.getElementById('capSel').textContent = t('capSaved');
      setTimeout(function () { document.getElementById('capOverlay').style.display = 'none'; }, 700);
    }
  } catch (e) {}
};
(function () {
  const img = document.getElementById('capImg');
  img.addEventListener('mousedown', function (e) {
    e.preventDefault();
    const r = img.getBoundingClientRect();
    capDrag = { sx: (e.clientX - r.left), sy: (e.clientY - r.top) };
  });
  img.addEventListener('mousemove', function (e) {
    if (!capDrag) return;
    const r = img.getBoundingClientRect();
    const cx = Math.min(Math.max(e.clientX - r.left, 0), r.width), cy = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    const left = Math.min(capDrag.sx, cx), top = Math.min(capDrag.sy, cy);
    const el = document.getElementById('capRect');
    el.style.left = left + 'px'; el.style.top = top + 'px';
    el.style.width = Math.abs(cx - capDrag.sx) + 'px'; el.style.height = Math.abs(cy - capDrag.sy) + 'px';
    el.style.display = 'block';
    document.getElementById('capSel').textContent = Math.round(left * capRatio) + ',' + Math.round(top * capRatio) + ' ' + Math.round(Math.abs(cx - capDrag.sx) * capRatio) + '×' + Math.round(Math.abs(cy - capDrag.sy) * capRatio);
  });
  window.addEventListener('mouseup', function () { capDrag = null; });
})();
function envInstall(what) {
  fetch('/api/env/install-' + what, { method: 'POST', body: '{}' }).then(function (r) { return r.json(); }).then(function (j) {
    if (j && !j.ok && j.error) document.getElementById('envMsg').textContent = j.error;
  }).catch(function () {});
  setTimeout(pollEnv, 1500);
}
async function pollEnv() {
  try {
    const r = await fetch('/api/env'); const e = await r.json();
    const rows = document.getElementById('envRows'); rows.innerHTML = '';
    const add = function (name, use, st, ok) {
      const tr = document.createElement('tr');
      const t1 = document.createElement('td'); t1.textContent = name;
      const t2 = document.createElement('td'); t2.textContent = use;
      const t3 = document.createElement('td'); t3.textContent = st; t3.style.color = ok ? 'var(--ok)' : 'var(--warn)';
      const t4 = document.createElement('td');
      tr.appendChild(t1); tr.appendChild(t2); tr.appendChild(t3); tr.appendChild(t4);
      rows.appendChild(tr);
      return t4;
    };
    const mkBtn = function (td, label, what) {
      const b = document.createElement('button');
      b.className = 'small';
      b.textContent = label;
      b.onclick = function () { envInstall(what); };
      td.appendChild(b);
    };
    add(t('envNode'), t('envNodeUse'), t('envNodeState') + e.node.version, true);
    if (e.media.ok) add(t('envMedia'), t('envMediaUse'), t('envAvailable'), true);
    else if (e.install && e.install.running) add(t('envMedia'), t('envMediaUse'), t('envInstalling') + e.install.msg, false);
    else if (e.systemPython.found) mkBtn(add(t('envMedia'), t('envMediaUse'), t('envNeedWinsdk'), false), t('envBtnWinsdk'), 'winsdk');
    else mkBtn(add(t('envMedia'), t('envMediaUse'), t('envMissing'), false), t('envBtnPython'), 'python');
    if (e.livetranslate.found) add(t('envLt'), t('envLtUse'), t('envLtOk') + e.livetranslate.model, true);
    else add(t('envLt'), t('envLtUse'), t('envLtNone'), false);
    const m = document.getElementById('envMsg');
    if (e.install && e.install.running) m.textContent = e.install.msg;
    else if (e.install && e.install.ok === false) m.textContent = e.install.msg;
  } catch (err) {}
}
let plgModalMode = 'approve';
let plgModalTarget = null;
let plgTimer = null;
let plgPanelId = null;
function plgPickXlsx() { const el = document.getElementById('fwFile'); if (el) el.click(); }
function plgImportXlsx(file) {
  if (!file || !plgPanelId) return;
  const reader = new FileReader();
  reader.onload = async function () {
    const base64 = String(reader.result).split(',')[1];
    try {
      const r = await fetch('/api/plugins/import-config', { method: 'POST', body: JSON.stringify({ id: plgPanelId, fileBase64: base64, filename: file.name }) });
      const j = await r.json();
      document.getElementById('plgMsg').textContent = j.ok ? ('已导入 ' + j.count + ' 条' + (j.deduped ? ', 自动去重 ' + j.deduped + ' 条' : '') + ', 插件已重启 ✓') : ('导入失败: ' + (j.error || ''));
      plgLoad();
    } catch (e) { document.getElementById('plgMsg').textContent = '导入失败: ' + e.message; }
  };
  reader.readAsDataURL(file);
}
// ===== 好友欢迎面板: 控制台内编辑名单 =====
let fwRowsCache = [];
let fwXlsxLoading = false;
function fwLoadRows() {
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'friend-welcome', method: 'getRows', args: {} }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { fwRowsCache = (j && Array.isArray(j)) ? j : []; fwRenderRows(); })
    .catch(function () { fwRowsCache = []; fwRenderRows(); });
}
function fwRenderRows() {
  const tb = document.getElementById('fwRowsTb');
  if (!tb) return;
  tb.innerHTML = '';
  for (let i = 0; i < fwRowsCache.length; i++) {
    const x = fwRowsCache[i] || {};
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); const iName = document.createElement('input'); iName.type = 'text'; iName.value = x.name || ''; iName.style.width = '110px'; td1.appendChild(iName);
    const td2 = document.createElement('td'); const iLines = document.createElement('textarea'); iLines.rows = 2; iLines.value = x.lines || '欢迎 {name} 来到房间!'; iLines.style.width = '230px'; td2.appendChild(iLines);
    const td3 = document.createElement('td'); const iLoops = document.createElement('input'); iLoops.type = 'number'; iLoops.min = '1'; iLoops.max = '10'; iLoops.value = x.loops || 2; iLoops.style.width = '50px'; td3.appendChild(iLoops);
    const td4 = document.createElement('td'); const iEach = document.createElement('input'); iEach.type = 'number'; iEach.min = '2'; iEach.max = '120'; iEach.value = x.eachSec || 6; iEach.style.width = '50px'; td4.appendChild(iEach);
    const td5 = document.createElement('td'); const iEn = document.createElement('input'); iEn.type = 'checkbox'; iEn.checked = x.enabled !== false; td5.appendChild(iEn);
    const td6 = document.createElement('td'); const del = document.createElement('button'); del.className = 'small danger'; del.textContent = '删除'; del.onclick = function () { fwRowsCache.splice(i, 1); fwRenderRows(); }; td6.appendChild(del);
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4); tr.appendChild(td5); tr.appendChild(td6);
    tb.appendChild(tr);
  }
}
function fwAddRow() { fwRowsCache.push({ name: '', lines: '欢迎 {name} 来到房间!', loops: 2, eachSec: 6, enabled: true }); fwRenderRows(); }
function fwCollect() {
  const rows = [];
  const trs = document.querySelectorAll('#fwRowsTb tr');
  for (const tr of trs) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 6) continue;
    const name = cells[0].querySelector('input').value.trim();
    if (!name) continue;
    rows.push([name, cells[1].querySelector('textarea').value, Number(cells[2].querySelector('input').value) || 2, Number(cells[3].querySelector('input').value) || 6, cells[4].querySelector('input').checked ? '' : '否']);
  }
  return rows;
}
function fwSaveRows() {
  const rows = fwCollect();
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'friend-welcome', method: 'saveRows', args: { rows: rows } }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const msg = document.getElementById('fwMsg');
      if (msg) msg.textContent = (j && j.ok) ? ('已保存 ' + j.count + ' 人' + (j.deduped ? ', 自动去重 ' + j.deduped + ' 条 ✓' : ' ✓')) : ('保存失败: ' + ((j && j.error) || ''));
      if (j && j.ok) fwLoadRows();
    })
    .catch(function (e) { const msg = document.getElementById('fwMsg'); if (msg) msg.textContent = '保存失败: ' + e.message; });
}
function fwExportXlsx() {
  const doExport = function () {
    if (typeof XLSX === 'undefined') { const msg = document.getElementById('fwMsg'); if (msg) msg.textContent = '导出组件加载失败'; return; }
    const aoa = [['显示名', '欢迎语(多条用|分隔)', '轮巡次数', '每片秒数', '启用(否=停用)']];
    for (const r of fwCollect()) aoa.push(r);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '好友欢迎名单');
    XLSX.writeFile(wb, '好友欢迎名单.xlsx');
  };
  if (typeof XLSX !== 'undefined') { doExport(); return; }
  if (fwXlsxLoading) return;
  fwXlsxLoading = true;
  const s = document.createElement('script');
  s.src = '/api/plugins/asset?id=friend-welcome&file=vendor/xlsx.full.min.js';
  s.onload = function () { fwXlsxLoading = false; doExport(); };
  s.onerror = function () { fwXlsxLoading = false; const msg = document.getElementById('fwMsg'); if (msg) msg.textContent = '导出组件加载失败'; };
  document.head.appendChild(s);
}
// ===== 定时公告面板: 特殊公告批量编辑 =====
let sbRowsCache = [];
let sbXlsxLoading = false;
function sbLoadRows() {
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'scheduled-board', method: 'getRows', args: {} }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { sbRowsCache = (j && Array.isArray(j)) ? j : []; sbRenderRows(); })
    .catch(function () { sbRowsCache = []; sbRenderRows(); });
}
function sbRenderRows() {
  const tb = document.getElementById('sbSpecTb');
  if (!tb) return;
  tb.innerHTML = '';
  for (let i = 0; i < sbRowsCache.length; i++) {
    const x = sbRowsCache[i] || {};
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); const iAt = document.createElement('input'); iAt.type = 'text'; iAt.value = x.at || ''; iAt.placeholder = '2026-09-01 20:00'; iAt.style.width = '150px'; td1.appendChild(iAt);
    const td2 = document.createElement('td'); const iText = document.createElement('textarea'); iText.rows = 2; iText.value = x.text || ''; iText.style.width = '220px'; td2.appendChild(iText);
    const td3 = document.createElement('td'); const iIntr = document.createElement('input'); iIntr.type = 'checkbox'; iIntr.checked = !!x.interrupt; td3.appendChild(iIntr);
    const td4 = document.createElement('td');
    const testBtn = document.createElement('button'); testBtn.className = 'small gray'; testBtn.textContent = '测试'; testBtn.onclick = function () { sbTestFire('special', i); }; td4.appendChild(testBtn);
    const del = document.createElement('button'); del.className = 'small danger'; del.textContent = '删除'; del.onclick = function () { sbRowsCache.splice(i, 1); sbRenderRows(); }; td4.appendChild(del);
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
    tb.appendChild(tr);
  }
}
function sbAddRow() { sbRowsCache.push({ at: '', text: '', interrupt: false }); sbRenderRows(); }
function sbCollect() {
  const rows = [];
  const trs = document.querySelectorAll('#sbSpecTb tr');
  for (const tr of trs) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 4) continue;
    const at = cells[0].querySelector('input').value.trim();
    if (!at) continue;
    rows.push([at, cells[1].querySelector('textarea').value, cells[2].querySelector('input').checked ? '' : '否']);
  }
  return rows;
}
function sbSaveAll() {
  const args = {
    items: (document.getElementById('sbItems') ? document.getElementById('sbItems').value : '').split('\n'),
    intervalMin: Number((document.getElementById('sbInterval') || {}).value) || 30,
    onHour: !!(document.getElementById('sbOnHour') && document.getElementById('sbOnHour').checked),
    onHalf: !!(document.getElementById('sbOnHalf') && document.getElementById('sbOnHalf').checked),
    hourlyText: (document.getElementById('sbHourly') ? document.getElementById('sbHourly').value : '').split('|'),
    interruptHourly: !!(document.getElementById('sbHourIntr') && document.getElementById('sbHourIntr').checked),
    specials: sbCollect()
  };
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'scheduled-board', method: 'saveAll', args: args }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const msg = document.getElementById('sbMsg');
      if (msg) msg.textContent = (j && j.ok) ? ('已保存: 常规 ' + j.items + ' 条 / 特殊 ' + j.specials + ' 条' + (j.deduped ? ', 自动去重 ' + j.deduped + ' 条' : '') + (j.onHour ? ', 整点开' : '') + (j.onHalf ? ', 半点开' : '') + ' ✓') : ('保存失败: ' + ((j && j.error) || ''));
    })
    .catch(function (e) { const msg = document.getElementById('sbMsg'); if (msg) msg.textContent = '保存失败: ' + e.message; });
}
function sbTestFire(type, index) {
  const args = { type: type };
  if (index !== undefined) args.index = index;
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'scheduled-board', method: 'testFire', args: args }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const msg = document.getElementById('sbMsg'); if (msg) msg.textContent = (j && j.ok) ? '已触发, 看看游戏里的聊天框 ✓' : ('触发失败: ' + ((j && j.error) || '')); })
    .catch(function (e) { const msg = document.getElementById('sbMsg'); if (msg) msg.textContent = '触发失败: ' + e.message; });
}
function sbExportXlsx() {
  const doExport = function () {
    if (typeof XLSX === 'undefined') { const msg = document.getElementById('sbMsg'); if (msg) msg.textContent = '导出组件加载失败'; return; }
    const aoa = [['日期时间(YYYY-MM-DD HH:mm)', '公告内容(多条用|分隔)', '是否中断(是/否)']];
    for (const r of sbCollect()) aoa.push(r);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '特殊公告');
    XLSX.writeFile(wb, '特殊公告.xlsx');
  };
  if (typeof XLSX !== 'undefined') { doExport(); return; }
  if (sbXlsxLoading) return;
  sbXlsxLoading = true;
  const s = document.createElement('script');
  s.src = '/api/plugins/asset?id=scheduled-board&file=vendor/xlsx.full.min.js';
  s.onload = function () { sbXlsxLoading = false; doExport(); };
  s.onerror = function () { sbXlsxLoading = false; const msg = document.getElementById('sbMsg'); if (msg) msg.textContent = '导出组件加载失败'; };
  document.head.appendChild(s);
}
// ===== 天气播报面板: 城市批量编辑 =====
let wxRowsCache = [];
let wxXlsxLoading = false;
function wxLoadRows() {
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'weather-board', method: 'getRows', args: {} }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { wxRowsCache = (j && Array.isArray(j)) ? j : []; wxRenderRows(); })
    .catch(function () { wxRowsCache = []; wxRenderRows(); });
}
function wxRenderRows() {
  const tb = document.getElementById('wxRowsTb');
  if (!tb) return;
  tb.innerHTML = '';
  for (let i = 0; i < wxRowsCache.length; i++) {
    const x = wxRowsCache[i] || {};
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); const iName = document.createElement('input'); iName.type = 'text'; iName.value = x.name || ''; iName.placeholder = '如 上海 / 东京'; iName.style.width = '130px'; td1.appendChild(iName);
    const td2 = document.createElement('td'); const iEn = document.createElement('input'); iEn.type = 'checkbox'; iEn.checked = x.enabled !== false; td2.appendChild(iEn);
    const td3 = document.createElement('td');
    const testBtn = document.createElement('button'); testBtn.className = 'small gray'; testBtn.textContent = '测试'; testBtn.onclick = function () { wxTestCity(i); }; td3.appendChild(testBtn);
    const del = document.createElement('button'); del.className = 'small danger'; del.textContent = '删除'; del.onclick = function () { wxRowsCache.splice(i, 1); wxRenderRows(); }; td3.appendChild(del);
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    tb.appendChild(tr);
  }
}
function wxAddRow() { wxRowsCache.push({ name: '', enabled: true }); wxRenderRows(); }
function wxCheckAll(v) {
  for (const x of wxRowsCache) x.enabled = v;
  const boxes = document.querySelectorAll('#wxRowsTb input[type=checkbox]');
  for (const c of boxes) c.checked = v;
}
function wxCollect() {
  const rows = [];
  const trs = document.querySelectorAll('#wxRowsTb tr');
  for (const tr of trs) {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 3) continue;
    const name = cells[0].querySelector('input').value.trim();
    if (!name) continue;
    rows.push([name, cells[1].querySelector('input').checked ? '' : '否']);
  }
  return rows;
}
function wxSaveAll() {
  const args = {
    intervalMin: Number((document.getElementById('wxInterval') || {}).value) || 15,
    displaySec: Number((document.getElementById('wxDisplay') || {}).value) || 60,
    continuous: !!(document.getElementById('wxContinuous') && document.getElementById('wxContinuous').checked),
    prefix: (document.getElementById('wxPrefix') || {}).value || '【天气】'
  };
  const msg = document.getElementById('wxMsg');
  if (msg) msg.textContent = '正在保存并解析城市...';
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'weather-board', method: 'saveRows', args: { rows: wxCollect() } }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !j.ok) { if (msg) msg.textContent = '保存失败: ' + ((j && j.error) || ''); return; }
      return fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'weather-board', method: 'saveConfig', args: args }) })
        .then(function (r2) { return r2.json(); })
        .then(function (j2) {
          if (msg) msg.textContent = '已保存 ' + j.count + ' 个城市' + (j.failed && j.failed.length ? '(解析失败: ' + j.failed.join(',') + ')' : '') + (j.deduped ? ', 去重 ' + j.deduped + ' 条' : '') + ' | 每 ' + (j2.intervalMin || '?') + ' 分钟轮巡 ✓';
          wxLoadRows();
        });
    })
    .catch(function (e) { if (msg) msg.textContent = '保存失败: ' + e.message; });
}
function wxAddPresets(kind) {
  const msg = document.getElementById('wxMsg');
  if (msg) msg.textContent = '正在添加预设城市...';
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'weather-board', method: 'addPresets', args: { kind: kind } }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (msg) msg.textContent = (j && j.ok) ? ('已添加 ' + j.added + ' 个' + (kind === 'cn' ? '国内' : '全球') + '城市(列表共 ' + j.total + ' 个, 默认停用, 勾选启用后记得点保存全部)') : ('添加失败: ' + ((j && j.error) || ''));
      wxLoadRows();
    })
    .catch(function (e) { if (msg) msg.textContent = '添加失败: ' + e.message; });
}
function wxTestCity(index) {
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'weather-board', method: 'testCity', args: { index: index } }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const msg = document.getElementById('wxMsg'); if (msg) msg.textContent = (j && j.ok) ? ('已发送: ' + j.text) : ('测试失败: ' + ((j && j.error) || '')); })
    .catch(function (e) { const msg = document.getElementById('wxMsg'); if (msg) msg.textContent = '测试失败: ' + e.message; });
}
function wxExportXlsx() {
  const doExport = function () {
    if (typeof XLSX === 'undefined') { const msg = document.getElementById('wxMsg'); if (msg) msg.textContent = '导出组件加载失败'; return; }
    const aoa = [['城市名', '启用(否=停用)']];
    for (const r of wxCollect()) aoa.push(r);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '天气城市');
    XLSX.writeFile(wb, '天气城市.xlsx');
  };
  if (typeof XLSX !== 'undefined') { doExport(); return; }
  if (wxXlsxLoading) return;
  wxXlsxLoading = true;
  const s = document.createElement('script');
  s.src = '/api/plugins/asset?id=weather-board&file=vendor/xlsx.full.min.js';
  s.onload = function () { wxXlsxLoading = false; doExport(); };
  s.onerror = function () { wxXlsxLoading = false; const msg = document.getElementById('wxMsg'); if (msg) msg.textContent = '导出组件加载失败'; };
  document.head.appendChild(s);
}
// ===== 网易云歌词面板 =====
function nlSave() {
  const args = {
    updateSec: Number((document.getElementById('nlUpdate') || {}).value) || 4,
    showTranslation: !(document.getElementById('nlTrans') && !document.getElementById('nlTrans').checked),
    allowOtherPlayers: !!(document.getElementById('nlOther') && document.getElementById('nlOther').checked),
    rhythmMode: !!(document.getElementById('nlRhythm') && document.getElementById('nlRhythm').checked),
    showTitle: !(document.getElementById('nlTitle') && !document.getElementById('nlTitle').checked),
    priority: Number((document.getElementById('nlPrio') || {}).value) || 35,
    cdpPort: Number((document.getElementById('nlPort') || {}).value) || 9234,
    cloudExe: String((document.getElementById('nlExe') || {}).value || '').trim()
  };
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'netease-lyrics', method: 'saveConfig', args: args }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const msg = document.getElementById('nlMsg'); if (msg) msg.textContent = (j && j.ok) ? '已保存 ✓' : ('保存失败: ' + ((j && j.error) || '')); })
    .catch(function (e) { const msg = document.getElementById('nlMsg'); if (msg) msg.textContent = '保存失败: ' + e.message; });
}
function nlTest() {
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'netease-lyrics', method: 'testNow', args: {} }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const msg = document.getElementById('nlMsg'); if (msg) msg.textContent = (j && j.ok) ? ('已发送: ' + j.text) : ('测试失败: ' + ((j && j.error) || '')); })
    .catch(function (e) { const msg = document.getElementById('nlMsg'); if (msg) msg.textContent = '测试失败: ' + e.message; });
}
function nlLaunchCdp() {
  if (!confirm('将完全退出网易云并用调试端口重新启动(会中断当前播放几秒), 确定?')) return;
  const msg = document.getElementById('nlMsg');
  if (msg) msg.textContent = '正在重启网易云(最多等 20 秒)...';
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'netease-lyrics', method: 'launchCdp', args: {} }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (msg) msg.textContent = (j && j.ok) ? (j.note || '成功 ✓') : ('失败: ' + ((j && j.error) || '')); })
    .catch(function (e) { if (msg) msg.textContent = '失败: ' + e.message; });
}
function nlStatus() {
  fetch('/api/plugins/call', { method: 'POST', body: JSON.stringify({ id: 'netease-lyrics', method: 'status', args: {} }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const msg = document.getElementById('nlMsg'); if (msg) { const c = j.cdp || {}; msg.textContent = '当前歌曲: ' + (j.songKey || '(无)') + ' | 歌词行数: ' + (j.lines || 0) + ' | CDP: ' + (c.ok ? ('已连接 进度 ' + Math.round((c.posMs || 0) / 1000) + 's/' + Math.round((c.durMs || 0) / 1000) + 's') : '未连接(用启动网易云-CDP.bat 启动客户端)'); } })
    .catch(function () {});
}
// ===== 设置保护(密码门) =====
async function gateRender() {
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
      if (st.level2) gm.textContent = t('gateL2On');
      else if (st.level1) gm.textContent = t('gateL1On');
      else if (st.l1LockRemainingSec) { const m = Math.floor(st.l1LockRemainingSec / 60); const s2 = st.l1LockRemainingSec % 60; gm.textContent = (t('gateLocked') || '').replace('{m}', m).replace('{s}', s2); gm.style.color = 'var(--err)'; }
      else gm.textContent = '';
    }
  } catch (e) {}
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
    .catch(function () {});
}, 3000);
function gateVerify(level) {
  const code = (document.getElementById('gateCode') || {}).value || '';
  fetch('/api/devgate/verify', { method: 'POST', body: JSON.stringify({ level: level, code: code }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const gm = document.getElementById('gateMsg');
      if (j && j.ok) { if (gm) gm.textContent = level === 2 ? t('gateL2On') : t('gateL1On'); gateRender(); psLoad(); }
      else if (j && j.lockRemainingSec) { const m = Math.floor(j.lockRemainingSec / 60); const s2 = j.lockRemainingSec % 60; if (gm) { gm.textContent = (t('gateLocked') || '').replace('{m}', m).replace('{s}', s2); gm.style.color = 'var(--err)'; } }
      else { if (gm) { gm.textContent = t('gateBad'); gm.style.color = 'var(--err)'; } }
    })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = t('gateFail') + e.message; });
}
document.getElementById('gateL1').onclick = function () { gateVerify(1); };
document.getElementById('gateL2').onclick = function () { gateVerify(2); };
function secSave() {
  const args = {
    promptDefense: !!(document.getElementById('secDef') && document.getElementById('secDef').checked),
    jsonMode: !!(document.getElementById('secJson') && document.getElementById('secJson').checked),
    outputSanitize: !!(document.getElementById('secSan') && document.getElementById('secSan').checked),
    extraPrompt: (document.getElementById('secExtra') || {}).value || ''
  };
  fetch('/api/security', { method: 'POST', body: JSON.stringify(args) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? 'AI 安全设置已保存 ✓' : ('保存失败: ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = '保存失败: ' + e.message; });
}
function psLoad() {
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (j) {
    const s = j.pluginsSecurity || {};
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.value = v; };
    set('psNet', s.networkPolicy || 'whitelist'); set('psProc', s.processPolicy || 'consent'); set('psFsW', s.fsWritePolicy || 'sandbox'); set('psFsR', s.fsReadPolicy || 'self'); set('psAi', s.aiPolicy || 'allow');
  }).catch(function () {});
}
function psSave() {
  const v = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
  fetch('/api/security', { method: 'POST', body: JSON.stringify({ pluginsSecurity: { networkPolicy: v('psNet'), processPolicy: v('psProc'), fsWritePolicy: v('psFsW'), fsReadPolicy: v('psFsR'), aiPolicy: v('psAi') } }) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok !== false, j: j }; }).catch(function () { return { ok: r.ok, j: {} }; }); })
    .then(function (o) { const m = document.getElementById('psMsg'); if (m) m.textContent = o.ok ? t('plgSecSaved') : ('失败: ' + ((o.j && o.j.error) || '')); });
}
function secAddWordFn() {
  const w = ((document.getElementById('secAddWord') || {}).value || '').trim();
  if (!w) return;
  fetch('/api/security', { method: 'POST', body: JSON.stringify({ addWords: [w] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? '安全词已添加 ✓' : ('失败: ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = '失败: ' + e.message; });
}
function secWordsSave() {
  const words = ((document.getElementById('secWordsEdit') || {}).value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  fetch('/api/security-words', { method: 'POST', body: JSON.stringify({ words: words }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? '安全词库已保存 ✓' : ('失败: ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = '失败: ' + e.message; });
}
function secWordsReset() {
  fetch('/api/security-words', { method: 'POST', body: JSON.stringify({ resetDefaults: true }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? '已恢复默认安全词 ✓' : ('失败: ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function () {});
}
function swfAddWordFn() {
  const w = ((document.getElementById('swfAddWord') || {}).value || '').trim();
  if (!w) return;
  fetch('/api/swearfilter', { method: 'POST', body: JSON.stringify({ addWords: [w] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? '屏蔽词已添加 ✓' : ('失败: ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = '失败: ' + e.message; });
}
function swfSave() {
  fetch('/api/swearfilter', { method: 'POST', body: JSON.stringify({ enabled: !!(document.getElementById('swfOn') && document.getElementById('swfOn').checked) }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? '过滤开关已保存 ✓' : ('保存失败: ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = '保存失败: ' + e.message; });
}
function swfWordsSave() {
  const words = ((document.getElementById('swfWords') || {}).value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  fetch('/api/swearfilter-words', { method: 'POST', body: JSON.stringify({ words: words }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? '词库已保存 ✓' : ('保存失败: ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = '保存失败: ' + e.message; });
}
function swfWordsReset() {
  fetch('/api/swearfilter-words', { method: 'POST', body: JSON.stringify({ resetDefaults: true }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? '已恢复默认词库 ✓' : ('失败: ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function () {});
}
function plgSave() {
  const v = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
  const n = function (id) { return Number(v(id)) || 0; };
  let cfg = {};
  if (plgPanelId === 'friend-welcome') {
    cfg = { name: v('fwName').trim(), lines: v('fwLines').split('\n').map(function (s) { return s.trim(); }).filter(Boolean), eachMs: n('fwEach') * 1000, loops: n('fwLoops') };
  } else if (plgPanelId === 'scheduled-board') {
    cfg = { items: v('sbItems').split('\n').map(function (s) { return s.trim(); }).filter(Boolean), intervalMin: n('sbInterval') };
  }
  fetch('/api/plugins/config', { method: 'POST', body: JSON.stringify({ id: plgPanelId, cfg: cfg }) }).then(function () {
    return fetch('/api/plugins/restart', { method: 'POST', body: JSON.stringify({ id: plgPanelId }) });
  }).then(function () {
    document.getElementById('plgMsg').textContent = t('savedRestarted');
  });
}
function plgPermsText(p) {
  const parts = [];
  const net = (p && p.network) || [];
  if (net.length) parts.push('<span style="color:#ffb37a">' + esc(t('permNet')) + net.map(esc).join(', ') + '</span>');
  const fsw = (p && p.filesystem && p.filesystem.write) || [];
  const fsr = (p && p.filesystem && p.filesystem.read) || [];
  if (fsr.length) parts.push(esc(t('permRead')) + fsr.map(esc).join(', '));
  if (fsw.length) parts.push(esc(t('permWrite')) + fsw.map(esc).join(', '));
  if (p && p.process) parts.push('<span style="color:#ff6b6b;font-weight:bold">' + esc(t('permProc')) + ' ' + esc(t('plgRiskHigh')) + '</span>');
  const aiTasks = (p && p.ai && p.ai.tasks) || [];
  if (aiTasks.length) parts.push('<span style="color:#ffb37a">' + esc(t('permAi')) + aiTasks.map(esc).join(', ') + '</span>');
  if (!parts.length) parts.push(esc(t('modalNoPerms')));
  return parts;
}
function plgOpenModal(plugin, mode) {
  plgModalMode = mode || 'approve';
  plgModalTarget = plugin;
  const m = document.getElementById('plgModal');
  m.style.display = 'flex';
  const title = document.getElementById('plgModalTitle');
  const risk = document.getElementById('plgRiskNote');
  if (plgModalMode === 'delete') {
    title.textContent = t('modalDeleteTitle');
    risk.style.display = 'none';
    document.getElementById('plgWarnText').innerHTML = '<b>' + plugin.name + '</b> ' + t('modalDeleteWarn');
  } else {
    title.textContent = t('modalApproveTitle');
    risk.style.display = 'block';
    risk.textContent = t('modalRisk');
    const perms = plgPermsText(plugin.permissions);
    document.getElementById('plgWarnText').innerHTML = '<b>' + esc(plugin.name) + '</b> v' + esc(plugin.version) + '<br>' + esc(plugin.description || '') + '<br><br><b>' + esc(t('modalPermsTitle')) + '</b><br>' + perms.map(function (x) { return '· ' + x; }).join('<br>');
    const highRisk = !!(plugin.permissions && (plugin.permissions.process || (plugin.permissions.ai && plugin.permissions.ai.tasks && plugin.permissions.ai.tasks.length)));
    const row = document.getElementById('plgTypeRow');
    if (row) row.style.display = highRisk ? 'flex' : 'none';
    if (highRisk) { const ti = document.getElementById('plgTypeName'); if (ti) { ti.value = ''; ti.placeholder = t('plgTypePh'); } }
  }
  let n = 5;
  const btn = document.getElementById('plgConfirm');
  btn.disabled = true;
  btn.textContent = (plgModalMode === 'delete' ? t('confirmDeleteN') : t('confirmInstallN')) + n + t('closeN');
  if (plgTimer) clearInterval(plgTimer);
  plgTimer = setInterval(function () {
    n--;
    const doneLabel = plgModalMode === 'delete' ? t('confirmDelete') : t('confirmInstall');
    if (n <= 0) { clearInterval(plgTimer); btn.disabled = false; btn.textContent = doneLabel; }
    else btn.textContent = (plgModalMode === 'delete' ? t('confirmDeleteN') : t('confirmInstallN')) + n + t('closeN');
  }, 1000);
}
function plgFail(msg) { const el = document.getElementById('plgErrMsg'); if (el) { let m = '⚠ ' + msg; if (String(msg).indexOf('一级密码') >= 0) m += ' → 先去「高级设置 → 安全与权限」输入一级密码解锁, 再回来操作'; el.textContent = m; } else alert(msg); }
function plgOk(res) { const el = document.getElementById('plgErrMsg'); if (el) el.textContent = ''; return res; }
function plgAct(name, url, body, after) {
  fetch(url, { method: 'POST', body: JSON.stringify(body || {}) })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok !== false, j: j }; }).catch(function () { return { ok: r.ok, j: {} }; }); })
    .then(function (o) {
      if (!o.ok) { plgFail((o.j && o.j.error) ? o.j.error : (name + '失败')); }
      else plgOk();
      if (after) after(o.ok);
    })
    .catch(function (e) { plgFail(name + '失败: ' + e.message); if (after) after(false); });
}
document.getElementById('plgCancel').onclick = function () { document.getElementById('plgModal').style.display = 'none'; plgModalTarget = null; if (plgTimer) clearInterval(plgTimer); };
document.getElementById('plgConfirm').onclick = async function () {
  if (!plgModalTarget) return;
  const highRisk = plgModalMode === 'approve' && !!(plgModalTarget.permissions && (plgModalTarget.permissions.process || (plgModalTarget.permissions.ai && plgModalTarget.permissions.ai.tasks && plgModalTarget.permissions.ai.tasks.length)));
  if (highRisk) {
    const ti = document.getElementById('plgTypeName');
    if (!ti || String(ti.value || '').trim() !== plgModalTarget.id) { plgFail(t('plgTypeBad')); return; }
  }
  const url = plgModalMode === 'delete' ? '/api/plugins/remove' : '/api/plugins/approve';
  const r = await fetch(url, { method: 'POST', body: JSON.stringify({ id: plgModalTarget.id }) });
  const j = await r.json().catch(function () { return {}; });
  if (!r.ok || j.ok === false) { plgFail(j.error || '操作失败'); plgModalTarget = null; return; }
  plgOk();
  document.getElementById('plgModal').style.display = 'none';
  plgModalTarget = null;
  plgLoad();
};
async function plgLoad() {
  try {
    const r = await fetch('/api/plugins'); const j = await r.json();
    const tb = document.getElementById('plgRows'); tb.innerHTML = '';
    for (const p of j.plugins) {
      const tr = document.createElement('tr');
      const t1 = document.createElement('td'); t1.textContent = p.name + (p.description ? ' - ' + p.description : '');
      const t2 = document.createElement('td'); t2.textContent = 'v' + p.version + ' / ' + (p.author || '-');
      const t3 = document.createElement('td'); t3.textContent = (p.permissions && p.permissions.process) ? t('highRisk') : t('normal');
      t3.style.color = (p.permissions && p.permissions.process) ? 'var(--err)' : 'var(--ok)';
      const t4 = document.createElement('td'); t4.textContent = p.enabled ? t('stEnabled') : (p.error ? t('stError') : (p.approved ? t('stApprovedOff') : t('stPending')));
      const tp = document.createElement('td');
      const pin2 = document.createElement('input');
      pin2.type = 'number'; pin2.min = '-999'; pin2.max = '999'; pin2.step = '1';
      pin2.style.width = '56px';
      if (p.priority !== null && p.priority !== undefined) pin2.value = p.priority;
      pin2.placeholder = t('plgPrioPh');
      pin2.title = t('plgPrioHint');
      pin2.onchange = async function () {
        const v = pin2.value.trim();
        const cfg = v === '' ? { priority: null } : { priority: Number(v) || 0 };
        plgAct('优先级', '/api/plugins/config', { id: p.id, cfg: cfg }, function () { plgLoad(); });
      };
      tp.appendChild(pin2);
      const t5 = document.createElement('td');
      const mk = function (label, fn) { const b = document.createElement('button'); b.className = 'small'; b.textContent = label; b.onclick = fn; return b; };
      if (!p.approved) t5.appendChild(mk(t('btnApprove'), function () { plgOpenModal(p, 'approve'); }));
      else if (!p.enabled) t5.appendChild(mk(t('btnEnable'), function () { plgAct('启用', '/api/plugins/enable', { id: p.id }, function () { plgLoad(); }); }));
      else {
        t5.appendChild(mk(t('btnDisable'), function () { plgAct('停用', '/api/plugins/disable', { id: p.id }, function () { plgLoad(); }); }));
        if (p.hasPage) t5.appendChild(mk('打开', function () { window.open('/plugin/' + p.id, '_blank'); }));
        if (p.hasPanel) t5.appendChild(mk(t('btnSettings'), async function () {
          plgPanelId = p.id;
          const pr = await fetch('/api/plugins/panel?id=' + p.id); const pd = await pr.json();
          document.getElementById('plgPanel').innerHTML = pd ? ('<b>' + pd.title + '</b>' + pd.html) : '';
          if (plgPanelId === 'friend-welcome') fwLoadRows();
          if (plgPanelId === 'scheduled-board') sbLoadRows();
          if (plgPanelId === 'weather-board') wxLoadRows();
          if (plgPanelId === 'netease-lyrics') {
            const nb = document.createElement('button');
            nb.className = 'small gray';
            nb.textContent = '用调试端口启动网易云';
            nb.style.marginTop = '8px';
            nb.onclick = nlLaunchCdp;
            document.getElementById('plgPanel').appendChild(nb);
          }
        }));
      }
      const delBtn = mk(t('btnDelete'), function () { plgOpenModal(p, 'delete'); });
      delBtn.className = 'danger small';
      t5.appendChild(delBtn);
      const issues = (p.conflicts || []).filter(function (c) { return c.reason.indexOf('API') >= 0 || c.reason.indexOf('依赖') >= 0 || c.reason.indexOf('互斥') >= 0 || c.reason.indexOf('重复') >= 0; });
      if (issues.length) {
        const w = document.createElement('div');
        w.style.color = 'var(--err)';
        w.style.fontSize = '12px';
        w.textContent = t('conflictW') + issues.map(function (c) { return c.reason; }).join('; ');
        t1.appendChild(w);
      }
      tr.appendChild(t1); tr.appendChild(t2); tr.appendChild(t3); tr.appendChild(t4); tr.appendChild(tp); tr.appendChild(t5);
      tb.appendChild(tr);
    }
    fetch('/api/market').then(function (r) { return r.json(); }).then(function (m) {
      const mc = document.getElementById('marketCard');
      if (m && m.note) { mc.style.display = 'block'; mc.textContent = t('marketNote'); }
    }).catch(function () {});
  } catch (e) {}
}
document.getElementById('plgImport').onclick = async function () {
  const p = document.getElementById('plgZip').value.trim();
  if (!p) { document.getElementById('plgMsg').textContent = t('importNeedPath'); return; }
  const r = await fetch('/api/plugins/import', { method: 'POST', body: JSON.stringify({ path: p }) });
  const j = await r.json();
  document.getElementById('plgMsg').textContent = j.ok ? (t('importOk') + j.id + t('importOk2')) : (t('importFail') + j.error);
  plgLoad();
};
document.getElementById('plgRefresh').onclick = async function () {
  try { await fetch('/api/plugins/scan', { method: 'POST', body: '{}' }); } catch (e) {}
  plgLoad();
};
const SRC_DEFAULT_PRIO = { pages: 5, hardware: 10, media: 30, livetranslate: 40, ocrregion: 45 };
document.getElementById('srcPrioReset').onclick = async function () {
  try {
    const st = await (await fetch('/api/status')).json();
    for (const s of st.sources) {
      const d = SRC_DEFAULT_PRIO[s.id];
      if (d !== undefined) await fetch('/api/sources', { method: 'POST', body: JSON.stringify({ id: s.id, priority: d }) });
    }
  } catch (e) {}
  poll();
};
document.getElementById('plgPrioReset').onclick = async function () {
  try {
    const j = await (await fetch('/api/plugins')).json();
    for (const p of j.plugins) {
      if (p.priority !== null && p.priority !== undefined) await fetch('/api/plugins/config', { method: 'POST', body: JSON.stringify({ id: p.id, cfg: { priority: null } }) });
    }
    plgLoad();
  } catch (e) {}
};
async function loadLt() {
  try {
    const r = await fetch('/api/ocrtl-lt'); const j = await r.json();
    const st = document.getElementById('ltStatus');
    if (j.found) {
      st.textContent = t('ltFound') + j.model + t('ltFound2') + j.targetLang + t('ltFound3');
      st.style.color = 'var(--ok)';
      document.getElementById('ltGuide').style.display = 'none';
    } else {
      st.textContent = t('ltNotFound');
      st.style.color = 'var(--warn)';
      document.getElementById('ltGuide').style.display = 'block';
      document.getElementById('ltGuide').innerHTML = t('ltGuideHtml');
    }
  } catch (e) { document.getElementById('ltStatus').textContent = t('ltChecking'); }
}
document.getElementById('ltCheck').onclick = loadLt;
document.getElementById('ltOpen').onclick = function () {
  window.open('https://space.bilibili.com/21426055/lists/7714676?type=season', '_blank');
};
fetch('/api/version').then(function (r) { return r.json(); }).then(function (j) { document.getElementById('ver').textContent = t('verLine') + j.version + t('codeName') + t('verLine2'); }).catch(function () {});
function checkUpdate() {
  fetch('/api/version/check').then(function (r) { return r.json(); }).then(function (j) {
    const el = document.getElementById('updateHint');
    const btn = document.getElementById('updateBtn');
    if (!j || !j.remote || !j.newer) return;
    if (btn) { btn.href = j.remote.releaseUrl || 'https://github.com/dkxfox/VRCLiveBoard/releases/latest'; btn.textContent = t('updateBtn'); btn.style.display = 'inline-block'; }
    if (!el) return;
    const a = document.createElement('a');
    a.href = j.remote.releaseUrl || 'https://github.com/dkxfox/VRCLiveBoard/releases/latest';
    a.target = '_blank';
    a.style.color = 'var(--accent)';
    a.style.fontWeight = '600';
    a.textContent = t('updateNew').replace('{ver}', j.remote.version).replace('{name}', j.remote.codename || '');
    el.appendChild(a);
  }).catch(function () {});
}
checkUpdate();
setInterval(checkUpdate, 6 * 60 * 60 * 1000);
loadAuto();
loadPages();
// ===== 健康总览(零级) =====
let lastHealth = null;
async function healthLoad() {
  try {
    const j = await (await fetch('/api/health')).json();
    lastHealth = j;
    const b = document.getElementById('healthBody');
    if (!b) return;
    const vrc = j.vrc || {};
    const u = j.udp9000 || {};
    const lines = [];
    if (vrc.running) lines.push(vrc.oscEnabled ? ('🟢 ' + t('portsVrcOn') + (vrc.oscPort || '?')) : ((vrc.oscEnabled === null || vrc.oscEnabled === undefined) ? ('🟡 ' + t('portsVrcUnknown')) : ('🟡 ' + t('portsVrcOff'))));
    else lines.push('⚪ ' + t('portsVrcStop'));
    if (u.occupied === false) lines.push('⚪ ' + t('portsUdpFree'));
    else if (u.occupied === true) {
      const nm = String(u.name || ('PID ' + (u.pid || '?')));
      if (nm.toLowerCase().indexOf('vrchat') >= 0) lines.push('🟢 ' + t('portsUdpOk'));
      else lines.push('🔴 ' + t('portsUdpBusy') + nm);
    }
    else lines.push('⚪ UDP 9000: ' + t('portsUdpUnknown'));
    lines.push('🖥 控制台: http://' + j.web.host + ':' + j.web.actual + (j.web.actual !== j.web.configured ? (' (' + t('portsNow') + j.web.configured + ')') : ''));
    lines.push('📡 OSC 目标: ' + j.osc.host + ':' + j.osc.port);
    lines.push((j.deps.python ? '🟢' : '⚪') + ' Python(听歌显示): ' + (j.deps.python ? '✓' : '✗'));
    lines.push((j.deps.livetranslate ? '🟢' : '⚪') + ' LiveTranslate(翻译): ' + (j.deps.livetranslate ? '✓' : '✗'));
    const pl = j.plugins || {};
    lines.push((pl.errors ? '🔴' : '🟢') + ' 插件: ' + (pl.enabled || 0) + '/' + (pl.total || 0) + ' 启用' + (pl.errors ? (', ' + pl.errors + ' 个报错') : ''));
    b.innerHTML = lines.map(function (x) { return '<div>' + esc2(x) + '</div>'; }).join('');
  } catch (e) {}
}
function esc2(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
document.getElementById('healthRefresh').onclick = function () { healthLoad(); };
document.getElementById('healthCopy').onclick = async function () {
  const msg = document.getElementById('healthMsg');
  try {
    let txt = '';
    const j = lastHealth;
    if (j) {
      const vrc = j.vrc || {}; const u = j.udp9000 || {};
      txt = 'VRCLiveBoard v' + j.version + '\n' +
        'VRChat: ' + (vrc.running ? (vrc.oscEnabled ? ('OSC on, port ' + (vrc.oscPort || '?')) : ((vrc.oscEnabled === null || vrc.oscEnabled === undefined) ? 'OSC unknown (check in game)' : 'OSC OFF')) : 'not running') + '\n' +
        'UDP 9000: ' + (u.occupied === false ? 'free' : (u.occupied === true ? ('occupied by ' + (u.name || u.pid)) : 'unknown')) + '\n' +
        'Console: http://' + j.web.host + ':' + j.web.actual + '\n' +
        'OSC target: ' + j.osc.host + ':' + j.osc.port + '\n' +
        'Python: ' + (j.deps.python ? 'ok' : 'missing') + ' | LiveTranslate: ' + (j.deps.livetranslate ? 'ok' : 'not configured') + '\n' +
        'Plugins: ' + (j.plugins.enabled || 0) + '/' + (j.plugins.total || 0) + ' enabled, ' + (j.plugins.errors || 0) + ' errors';
    }
    await navigator.clipboard.writeText(txt);
    if (msg) msg.textContent = t('healthCopied');
  } catch (e) { if (msg) msg.textContent = 'clipboard: ' + e.message; }
};
// ===== 新手引导(顶部按钮常驻, 首次自动弹出) =====
function guideOpen() {
  const gb = document.getElementById('guideBody');
  if (gb) gb.textContent = t('guideText');
  const o = document.getElementById('guideOverlay');
  if (o) o.style.display = 'flex';
}
function guideClose() {
  const o = document.getElementById('guideOverlay');
  if (o) o.style.display = 'none';
  const no = document.getElementById('guideNoAuto');
  if (no && no.checked) { try { localStorage.setItem('vrcbGuideDone', '1'); } catch (e) {} }
}
document.getElementById('guideBtn').onclick = guideOpen;
try { if (localStorage.getItem('vrcbGuideDone') !== '1') guideOpen(); } catch (e) {}
// ===== 配置备份与恢复(零级) =====
document.getElementById('cfgExport').onclick = async function () {
  try {
    const j = await (await fetch('/api/config/export')).json();
    if (!j || !j.config) return;
    const blob = new Blob([JSON.stringify(j.config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = j.filename || 'VRCLiveBoard-config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {}
};
document.getElementById('cfgImport').onclick = function () { document.getElementById('cfgFile').click(); };
document.getElementById('cfgFile').onchange = async function () {
  const msg = document.getElementById('cfgMsg');
  const fl = this.files && this.files[0];
  if (!fl) return;
  try {
    const obj = JSON.parse(await fl.text());
    const r = await (await fetch('/api/config/import', { method: 'POST', body: JSON.stringify({ config: obj }) })).json();
    if (msg) msg.textContent = r.ok ? t('cfgImportOk') : (t('cfgImportFail') + (r.error || ''));
  } catch (e) { if (msg) msg.textContent = t('cfgImportBad'); }
  this.value = '';
};
// ===== 网络端口卡片(零级) =====
async function portsLoad() {
  try {
    const j = await (await fetch('/api/ports')).json();
    const op = document.getElementById('oscPort'); if (op) op.value = j.osc.port;
    const wp = document.getElementById('webPort'); if (wp) wp.value = j.web.configured;
    const info = document.getElementById('portsInfo');
    if (info) info.textContent = t('portsNow') + j.web.actual + ' | OSC → ' + j.osc.host + ':' + j.osc.port;
    const h = document.getElementById('advHttpHint');
    if (h) h.textContent = (t('advHttpHint') || '').replace('{port}', String(j.web.actual));
    const cu = document.getElementById('consoleUrl');
    if (cu) cu.textContent = 'http://' + j.web.host + ':' + j.web.actual;
  } catch (e) {}
}
async function portsSaveOsc() {
  const v = Number((document.getElementById('oscPort') || {}).value);
  const info = document.getElementById('portsInfo');
  try {
    const r = await (await fetch('/api/ports/osc', { method: 'POST', body: JSON.stringify({ port: v }) })).json();
    if (info) info.textContent = r.ok ? (t('portsNow') + r.port + (r.applied ? ' ✓(已热生效, 无需重启)' : '')) : ('失败: ' + (r.error || ''));
  } catch (e) { if (info) info.textContent = '失败: ' + e.message; }
}

// ===== 侧边栏快捷导航 =====
try { document.getElementById('sidebar').addEventListener('mouseenter', function () { fetch('/api/fe-err', { method: 'POST', body: JSON.stringify({ msg: 'NAV-ENTER', line: 0 }) }); }, { once: true }); } catch (e) {}
document.addEventListener('click', function (ev) {
  const a = ev.target && ev.target.closest ? ev.target.closest('.side-link') : null;
  if (!a) return;
  ev.preventDefault();
  try { fetch('/api/fe-err', { method: 'POST', body: JSON.stringify({ msg: 'NAV-CLICK:' + a.getAttribute('data-target'), line: 0 }) }); } catch (e) {}
  const t = document.getElementById(a.getAttribute('data-target'));
  if (t) {
    const top = t.getBoundingClientRect().top + window.scrollY - 16;
    try { window.scrollTo({ top: top, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, top); }
  }
  document.getElementById('sidebar').classList.remove('open');
}, true);
document.getElementById('reloadBtn').onclick = function () { try { window.location.reload(); } catch (e) {} };
document.getElementById('navToggle').onclick = function () {
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.toggle('open');
};
const SIDE_TARGETS = ['card-status','card-health','card-boards','card-trans','card-env','card-src','card-plg','card-adv-general','card-adv-network','card-adv-security','card-adv-log'];
let navScrolledOnce = false;
window.addEventListener('scroll', function () {
  if (!navScrolledOnce) { navScrolledOnce = true; try { fetch('/api/fe-err', { method: 'POST', body: JSON.stringify({ msg: 'NAV-SCROLL-FIRED', line: 0 }) }); } catch (e) {} }
  const y = window.scrollY + 140;
  let cur = SIDE_TARGETS[0];
  for (const id of SIDE_TARGETS) {
    const el = document.getElementById(id);
    if (el && el.offsetTop <= y) cur = id;
  }
  document.querySelectorAll('.side-link').forEach(function (a) {
    a.classList.toggle('active', a.getAttribute('data-target') === cur);
  });
}, { passive: true });

portsLoad();

async function portsSaveWeb() {
  const v = Number((document.getElementById('webPort') || {}).value);
  const info = document.getElementById('portsInfo');
  try {
    const r = await (await fetch('/api/ports/web', { method: 'POST', body: JSON.stringify({ port: v }) })).json();
    if (info) info.textContent = r.ok ? t('portsRestartHint') : ('失败: ' + (r.error || ''));
  } catch (e) { if (info) info.textContent = '失败: ' + e.message; }
}
async function portsCheck() {
  const out = document.getElementById('portsCheckOut');
  if (out) out.textContent = '…';
  try {
    const j = await (await fetch('/api/ports/check')).json();
    let s = '';
    if (j.udp9000 && j.udp9000.occupied === false) s = t('portsUdpFree');
    else if (j.udp9000 && j.udp9000.occupied === true) {
      const nm = String(j.udp9000.name || ('PID ' + (j.udp9000.pid || '?')));
      s = nm.toLowerCase().indexOf('vrchat') >= 0 ? t('portsUdpOk') : (t('portsUdpBusy') + nm);
    }
    else s = t('portsUdpUnknown');
    if (j.vrc) {
      if (j.vrc.running) s += '\n' + (j.vrc.oscEnabled ? (t('portsVrcOn') + (j.vrc.oscPort || '?')) : t('portsVrcOff'));
      else s += '\n' + t('portsVrcStop');
    }
    let actual = 19190;
    try { const pj = await (await fetch('/api/ports')).json(); actual = pj.web.actual; } catch (e) {}
    const busy = (j.tcpAround || []).filter(function (x) { return x.port !== actual; });
    if (busy.length) s += '\n' + t('portsTcpBusy') + busy.map(function (x) { return x.port + '(' + x.name + ')'; }).join(' ');
    if (out) out.textContent = s;
  } catch (e) { if (out) out.textContent = t('portsCheckErr') + e.message; }
}
portsLoad();
healthLoad();
setInterval(healthLoad, 30000);
setInterval(poll, 2000); poll();
setInterval(pollEnv, 5000); pollEnv();
loadLt();
plgLoad();
psLoad();
try { fetch('/api/fe-err', { method: 'POST', body: JSON.stringify({ msg: 'SCRIPT-BOTTOM-REACHED', line: 0 }) }); } catch (e) {}

'use strict';
window.onerror=function(m,s,l){try{fetch('/api/fe-err',{method:'POST',body:JSON.stringify({msg:String(m),line:l||0})});}catch(e){}};
window.addEventListener('unhandledrejection',function(ev){try{fetch('/api/fe-err',{method:'POST',body:JSON.stringify({msg:'Promise拒绝: '+String(ev.reason&&ev.reason.message||ev.reason)})});}catch(e){}});
var $=function(id){return document.getElementById(id)};
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
// tabs
document.querySelectorAll('#tabs .tab').forEach(function(t){t.onclick=function(){document.querySelectorAll('#tabs .tab').forEach(function(x){x.classList.remove('on');});document.querySelectorAll('[id^=tab-]').forEach(function(p){p.hidden=true;});t.classList.add('on');var p=$('tab-'+t.dataset.tab);if(p)p.hidden=false;};});
try{var qp=new URLSearchParams(location.search).get('tab');if(qp){var qbt=document.querySelector('.tab[data-tab="'+qp+'"]');if(qbt)qbt.click();}}catch(e){}
// composer
var box=$('box'),cur=$('curChat');
if(box&&$('send')){$('send').onclick=async function(){var tx=box.value;if(!tx.trim())return;try{var r=await fetch('/v1/chatbox',{method:'POST',body:JSON.stringify({text:tx})});var j=await r.json();if(j.ok){if(cur)cur.textContent=tx;}else alert(t('sendFailShort')+': '+(j.error||''));}catch(e){}};
box.addEventListener('keydown',function(e){if(e.ctrlKey&&e.key==='Enter'){$('send').click();}});
box.addEventListener('input',function(){var c=$('charCount');if(c)c.textContent=box.value.length;});}
// board
var pages=[],curIdx=0;
async function loadPages(){try{var r=await fetch('/api/config');var c=await r.json();pages=(c.pages||[]).slice();renderBoard();}catch(e){}}
function fl(t){return String(t||'').split('\n')[0]}
function renderBdEditor(){
  var list=$('bdList');if(!list)return;list.innerHTML='';
  pages.forEach(function(p,i){var d=document.createElement('div');d.className='edrow'+(i===curIdx?' on':'');d.style.cursor='pointer';
    d.innerHTML='<span class="mono">'+(i+1)+'</span><span class="snip">'+esc(fl(p.text))+'</span><span class="ops"><button class="small gray" data-a="up" data-i="'+i+'">↑</button><button class="small gray" data-a="down" data-i="'+i+'">↓</button></span>';
    d.onclick=function(){curIdx=i;renderBoard();};
    d.querySelectorAll('button').forEach(function(b){b.onclick=function(ev){ev.stopPropagation();var a=b.dataset.a,i=+b.dataset.i;if(a==='up'&&i>0){var t=pages[i-1];pages[i-1]=pages[i];pages[i]=t;if(curIdx===i)curIdx=i-1;}if(a==='down'&&i<pages.length-1){var t2=pages[i];pages[i]=pages[i+1];pages[i+1]=t2;if(curIdx===i)curIdx=i+1;}renderBoard();};});
    list.appendChild(d);});
  var t=$('bdText');if(t&&pages[curIdx])t.value=pages[curIdx].text;
  var prev=$('bdPrev');if(prev)prev.textContent=pages[curIdx]?(pages[curIdx].text||t('emptyPage')):t('emptyPage');
  applyBdPrevWidth();
}
function renderBoard(){
  var pt=$('pageText');if(pt&&pages.length)pt.textContent=pages[curIdx].text||'-';
  var bc=$('boardCount');if(bc)bc.textContent=t('boardCountN').replace('{n}',pages.length);
  var pn=$('pgNum');if(pn)pn.textContent=t('pageNum').replace('{a}',curIdx+1).replace('{b}',pages.length);
  var bh=$('bdHint');if(bh)bh.textContent=t('boardHint').replace('{n}',pages.length);
  var el=$('edlist');if(el){el.innerHTML='';
    pages.forEach(function(p,i){var d=document.createElement('div');d.className='edrow';
      d.innerHTML='<span class="drag">⠿</span><span class="mono">'+(i+1)+'</span><span class="snip">'+esc(fl(p.text))+'</span><span class="ops"><button class="small gray" data-a="up" data-i="'+i+'">↑</button><button class="small gray" data-a="down" data-i="'+i+'">↓</button><button class="small gray" data-a="del" data-i="'+i+'">'+t('delBtn')+'</button></span>';
      el.appendChild(d);});
    el.querySelectorAll('button').forEach(function(b){b.onclick=function(){var a=b.dataset.a,i=+b.dataset.i;if(a==='up'&&i>0){var t=pages[i-1];pages[i-1]=pages[i];pages[i]=t;if(curIdx===i)curIdx=i-1;}if(a==='down'&&i<pages.length-1){var t2=pages[i];pages[i]=pages[i+1];pages[i+1]=t2;if(curIdx===i)curIdx=i+1;}if(a==='del')pages.splice(i,1);renderBoard();};});}
  renderBdEditor();
}
if($('pgPrev'))$('pgPrev').onclick=function(){if(pages.length)curIdx=(curIdx-1+pages.length)%pages.length;renderBoard();};
if($('pgNext'))$('pgNext').onclick=function(){if(pages.length)curIdx=(curIdx+1)%pages.length;renderBoard();};
if($('addPage'))$('addPage').onclick=function(){pages.push({text:t('newPageText')});curIdx=pages.length-1;renderBoard();};
if($('bdAdd'))$('bdAdd').onclick=function(){pages.push({text:t('newPageText')});curIdx=pages.length-1;renderBoard();};
if($('bdSave'))$('bdSave').onclick=async function(){pages[curIdx].text=$('bdText').value;try{var r=await fetch('/api/config',{method:'POST',body:JSON.stringify({pages:pages})});var j=await r.json();if(!j.ok)alert(t('saveFail'));}catch(e){alert(t('saveFail'));}renderBoard();};
// ===== 公告板补接线(M-20260907-01 批 A) =====
function applyBdPrevWidth(){var w=$('bdWidth'),p=$('bdPrev');if(!w||!p)return;var n=Math.max(8,Math.min(144,Math.round(Number(w.value)||28)));w.value=n;p.style.width=n+'ch';p.style.maxWidth='100%';}
if($('boardEdit'))$('boardEdit').onclick=function(){var em=$('editMode');if(!em)return;var show=em.hidden;em.hidden=!show;this.classList.toggle('on',show);if(show)renderBoard();};
if($('bdVarBtn'))$('bdVarBtn').onclick=function(){var s=$('bdVar'),tx=$('bdText');if(!s||!tx)return;var v=s.value;var st=(tx.selectionStart==null)?tx.value.length:tx.selectionStart,en=(tx.selectionEnd==null)?st:tx.selectionEnd;tx.value=tx.value.slice(0,st)+v+tx.value.slice(en);tx.selectionStart=tx.selectionEnd=st+v.length;tx.focus();};
if($('bdDup'))$('bdDup').onclick=function(){if(!pages.length)return;pages.splice(curIdx+1,0,{text:String((pages[curIdx]||{}).text||'')});curIdx++;renderBoard();};
if($('bdDel'))$('bdDel').onclick=function(){if(!pages.length)return;if(!confirm(t('delPageConfirm')))return;pages.splice(curIdx,1);if(curIdx>=pages.length)curIdx=Math.max(0,pages.length-1);renderBoard();};
if($('bdWidth'))$('bdWidth').onchange=applyBdPrevWidth;
if($('bdRot')){(async function(){try{var c=await (await fetch('/api/config')).json();var el=$('bdRot');if(el)el.value=Math.max(3,Math.round((Number(c.rotationMs)||8000)/1000));}catch(e){}})();$('bdRot').onchange=async function(){var s=Math.max(3,Math.round(Number(this.value)||8));this.value=s;try{await fetch('/api/config',{method:'POST',body:JSON.stringify({rotationMs:s*1000})});}catch(e){}};}
// ===== 批 A 补接线: 数据源 / 翻译 / 高级 / 日志(M-20260907-01) =====
var SRC_DEFAULT_PRIO={pages:5,hardware:10,media:30,livetranslate:40,ocrregion:45};
if($('prioReset'))$('prioReset').onclick=async function(){try{var s=await (await fetch('/api/status')).json();var arr=s.sources||[];for(var i=0;i<arr.length;i++){var d=SRC_DEFAULT_PRIO[arr[i].id];if(d!==undefined)await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:arr[i].id,priority:d})});}}catch(e){}try{pollStatus();}catch(e){}};
if($('ltCheckBtn'))$('ltCheckBtn').onclick=async function(){var st=$('ltStatus');try{var lt=await (await fetch('/api/ocrtl-lt')).json();if(st){st.textContent=lt.found?((lt.model||'LiveTranslate')+' → '+(lt.targetLang||'')):t('ltNotFound');st.style.color=lt.found?'var(--ok)':'var(--warn)';}}catch(e){if(st){st.textContent=t('ltNotFound');st.style.color='var(--warn)';}}};
if($('ltDownloadBtn'))$('ltDownloadBtn').onclick=function(){window.open('https://space.bilibili.com/21426055/lists/7714676?type=season','_blank');};
if($('visSave'))$('visSave').onclick=async function(){try{var body={apiBase:(($('transApiBase')||{}).value||'').trim(),model:(($('transApiModel')||{}).value||'').trim()};var k=(($('transApiKey')||{}).value||'').trim();if(k)body.apiKey=k;var j=await (await fetch('/api/ocrtl-vision',{method:'POST',body:JSON.stringify(body)})).json();alert(j&&j.ok?t('visSaved'):(t('visSaveFail')+((j&&j.error)||'')));}catch(e){alert(t('visSaveFail')+e.message);}};
if($('btnShot'))$('btnShot').onclick=async function(){try{var j=await (await fetch('/api/ocrtl',{method:'POST',body:'{}'})).json();alert(j&&j.ok?t('ocrRunning'):t('triggerFail'));}catch(e){alert(t('triggerFail'));}};
if($('transRegion')){(async function(){try{var c=await (await fetch('/api/config')).json();var md=((c.ocrtl||{}).capture||{}).mode||'window';var v={window:0,region:1,screen:2}[md];var s=$('transRegion');if(s&&v!==undefined)s.selectedIndex=v;}catch(e){}})();$('transRegion').onchange=async function(){var md=['window','region','screen'][this.selectedIndex]||'window';try{await fetch('/api/capture/set',{method:'POST',body:JSON.stringify({mode:md})});}catch(e){}};}
if($('capFullBtn'))$('capFullBtn').onclick=async function(){try{await fetch('/api/capture/set',{method:'POST',body:JSON.stringify({mode:'screen'})});var s=$('transRegion');if(s)s.selectedIndex=2;}catch(e){}};
if($('capAdjBtn'))$('capAdjBtn').onclick=function(){window.open('/api/capture/preview','_blank');};
if($('ocrDelay')){(async function(){try{var c=await (await fetch('/api/config')).json();var o=c.ocrtl||{};if($('ocrDelay'))$('ocrDelay').value=Math.round((Number(o.delayMs)||5000)/1000);if($('ocrDisplay'))$('ocrDisplay').value=Math.round((Number(o.eachMs)||8000)/1000);if($('ocrLoops'))$('ocrLoops').value=Number(o.loops)||2;}catch(e){}})();}
if($('expCfg'))$('expCfg').onclick=async function(){try{var r=await fetch('/api/config/export');if(r.status===403){alert(t('needL1'));return;}var j=await r.json();if(!j||!j.ok){alert(t('saveFail'));return;}var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(j.config,null,2)],{type:'application/json'}));a.download=j.filename||'config.json';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);if(a.parentNode)a.parentNode.removeChild(a);},1500);}catch(e){alert(t('saveFail'));}};
if($('impCfg'))$('impCfg').onclick=function(){var f=document.createElement('input');f.type='file';f.accept='.json';f.onchange=function(){var file=f.files&&f.files[0];if(!file)return;var rd=new FileReader();rd.onload=async function(){try{var j=await (await fetch('/api/config/import',{method:'POST',body:String(rd.result)})).json();alert(j&&j.ok?t('cfgImportOk'):(t('cfgImportFail')+((j&&j.error)||'')));}catch(e){alert(t('cfgImportBad'));}};rd.readAsText(file);};f.click();};
if($('webSave'))$('webSave').onclick=async function(){var v=Number(($('webPort')||{}).value);if(!v){alert(t('saveFail'));return;}try{var j=await (await fetch('/api/ports/web',{method:'POST',body:JSON.stringify({port:v})})).json();if(!j||!j.ok){alert(t('saveFail')+((j&&j.error)||''));return;}await fetch('/api/desktop/restart',{method:'POST',body:'{}'});}catch(e){alert(t('saveFail'));}};
if($('portsCheckBtn'))$('portsCheckBtn').onclick=async function(){var out=$('portsOut');if(out)out.textContent='…';try{var j=await (await fetch('/api/ports/check')).json();var s='';var u=j.udp9000||{};if(u.occupied===false)s=t('portsUdpFree');else if(u.occupied===true){var nm=String(u.name||('PID '+(u.pid||'?')));s=nm.toLowerCase().indexOf('vrchat')>=0?t('portsUdpOk'):(t('portsUdpBusy')+nm);}else s=t('portsUdpUnknown');if(j.vrc){s+='\n'+(j.vrc.running?(j.vrc.oscEnabled?(t('portsVrcOn')+(j.vrc.oscPort||'?')):t('portsVrcOff')):t('portsVrcStop'));}var actual=19190;try{var pj=await (await fetch('/api/ports')).json();actual=(pj.web||{}).actual||19190;}catch(e){}var busy=(j.tcpAround||[]).filter(function(x){return x.port!==actual;});if(busy.length)s+='\n'+t('portsTcpBusy')+busy.map(function(x){return x.port+'('+x.name+')';}).join(' ');if(out)out.textContent=s;}catch(e){if(out)out.textContent=t('portsCheckErr')+e.message;}};
if($('logCopy'))$('logCopy').onclick=async function(){var el=$('logView');var txt=el?el.textContent:'';try{await navigator.clipboard.writeText(txt);alert(t('healthCopied'));}catch(e){try{var ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();alert(t('healthCopied'));}catch(e2){}}};
var logAutoIv=null;
if($('logAuto'))$('logAuto').onchange=function(){if(this.checked){if(logAutoIv)clearInterval(logAutoIv);logAutoIv=setInterval(loadLogs,3000);}else{if(logAutoIv)clearInterval(logAutoIv);logAutoIv=null;}};
if($('dC'))$('dC').onclick=function(){var dr=$('drawer'),sc=$('scrim');if(dr)dr.classList.remove('open');if(sc)sc.classList.remove('on');};
// ===== 插件卡片 =====
function plgName(p){var M={'friend-welcome':'plgNameFriendWelcome','scheduled-board':'plgNameScheduled','weather-board':'plgNameWeather','netease-lyrics':'plgNameNetease'};return M[p.id]?t(M[p.id]):(p.name||p.id);}var plgArr=[];
function plgPermsDesc(p){var ps=p.permissions||{};var parts=[];if(ps.network)parts.push(t('permNetShort')+(ps.network==='whitelist'?('('+t('polWhitelistShort')+')'):''));if(ps.process)parts.push(t('permProcShort'));if(ps.writeFile)parts.push(t('permWriteShort'));if(ps.readFile)parts.push(t('permReadShort'));if(ps.ai)parts.push(t('plgAiShort'));return parts.length?parts.join(' · '):t('plgNone');}
function plgPermsHtml(p){var ps=p.permissions||{};var fs=ps.filesystem||{};var rd=Array.isArray(fs.read)?fs.read:[];var wr=Array.isArray(fs.write)?fs.write:[];var net=Array.isArray(ps.network)?ps.network:[];var ports=Array.isArray(ps.ports)?ps.ports:[];var out=[];function item(label,scope,cons,high){out.push('<div style="margin:2px 0"><b'+(high?' style="color:var(--err)"':'')+'>· '+label+'</b>: '+scope+'<br><span style="font-size:12px;'+(high?'color:var(--warn);font-weight:700':'color:var(--muted)')+'">　'+t('plgConsOver')+': '+cons+'</span></div>');}item(t('permNetShort'),net.length?(t('plgOnlyAllow')+' '+net.join(', ')):t('plgNoNet'),t('plgNetCons'),false);if(rd.length||wr.length)item(t('plgFile'),(rd.length?(t('plgReadPrefix')+rd.join(', ')+']'):t('plgUnreadable'))+(wr.length?(' · '+t('plgWritePrefix')+wr.join(', ')+']'):(' · '+t('plgUnwritable'))),t('plgFileCons'),!!wr.length);else item(t('plgFile'),t('plgFileSelf'),t('plgFileSelfCons'),false);if(ps.process)item(t('permProcShort'),t('plgProcScope'),t('plgProcCons'),true);if(ports.length)item(t('plgPort'),ports.join(', '),t('plgPortCons'),false);if(ps.ai)item(t('plgAiShort'),t('plgAiScope'),t('plgAiCons'),true);return out.join('');}
function plgToggle(url,id){return fetch(url,{method:'POST',body:JSON.stringify({id:id})}).then(function(r){return r.json();}).then(function(j){if(j&&j.ok===false){alert(t('opFail')+': '+(j.error||''));}setTimeout(loadPlugins,600);});}
function plgWarn(p,onOk){var m=$('plgModal');if(!m){onOk();return;}var hr=!!(p.permissions&&(p.permissions.process||(p.permissions.ai&&p.permissions.ai.tasks&&p.permissions.ai.tasks.length)));m.style.display='flex';$('plgModalTitle').textContent=t('plgModalTitle');$('plgWarnText').innerHTML='<b>'+esc(plgName(p))+'</b> v'+esc(p.version||'')+(p.author?(' · '+esc(p.author)):'')+'<br><span style="color:var(--muted)">'+esc(p.description||'')+'</span><br><br><b>'+t('plgReqPerms')+':</b><br>'+plgPermsHtml(p)+'<br><br><b>'+t('plgNote')+':</b> '+t('plgWarnNote');var row=$('plgTypeRow');if(row)row.style.display=hr?'flex':'none';var ti=$('plgTypeName');if(ti){ti.value='';if(hr)ti.placeholder=t('plgTypePh');}var rn=$('plgRiskNote');if(rn)rn.textContent='';$('plgCancel').textContent=t('cancel');$('plgCancel').className='gray';var n=5;var btn=$('plgConfirm');btn.disabled=true;btn.textContent=t('plgConfirmCountdown').replace('{n}',n);if(window._plgIv)clearInterval(window._plgIv);window._plgIv=setInterval(function(){n--;if(n<=0){clearInterval(window._plgIv);btn.disabled=false;btn.textContent=t('plgConfirmText');}else{btn.textContent=t('plgConfirmCountdown').replace('{n}',n);}},1000);btn.onclick=function(){if(btn.disabled)return;if(hr){var tv=($('plgTypeName')||{}).value||'';if(String(tv).trim()!==p.id){var rn2=$('plgRiskNote');if(rn2)rn2.textContent='⚠ '+t('plgTypeBad');return;}}m.style.display='none';onOk();};$('plgCancel').onclick=function(){m.style.display='none';clearInterval(window._plgIv);};}
function plgCard(p){var en=!!(p.enabled||p.run),ap=!!p.approved;var d=document.createElement('div');d.className='plgcard';
 d.innerHTML='<div class="plgcard-head"><b class="plgcard-name">'+esc(plgName(p))+'</b><span class="tag">v'+(p.version||'')+'</span><span class="plgstat">'+(ap?'<span class="pill ok">'+t('stApproved')+'</span>':'<span class="pill warn">'+t('stUnapproved')+'</span>')+(en?'<span class="pill ok">'+t('stEnabled')+'</span>':'<span class="pill gray">'+t('stDisabled')+'</span>')+'</span><span class="plgcard-ctrl"><span class="sw'+(en?' on':'')+'" data-en="'+esc(p.id)+'"></span><button class="small gray" data-set="'+esc(p.id)+'">'+t('btnSettings')+'</button></span></div><div class="plgcard-desc">'+esc(p.description||t('plgNoDesc'))+'</div><div class="plgcard-meta">'+esc(p.id||'')+' · '+t('plgPerms')+': '+esc(plgPermsDesc(p))+(p.error?(' · <span style="color:var(--err)">⚠ '+esc(p.error)+'</span>'):'')+((p.conflicts&&p.conflicts.length)?(' · <span style="color:var(--warn)">⚠ '+t('plgConflict')+': '+esc(p.conflicts.map(function(c){return c.with;}).join(', '))+'</span>'):'')+'</div><div class="plgcard-body" style="display:none"></div>';
 d.querySelector('[data-en]').onclick=function(){var sw=this;var doEnable=function(){sw.classList.add('on');fetch('/api/plugins/approve',{method:'POST',body:JSON.stringify({id:p.id})}).then(function(r){return r.json();}).then(function(j){if(j&&j.ok===false){alert(t('opFail')+': '+(j.error||''));return;}plgToggle('/api/plugins/enable',p.id);});};if(!ap){plgWarn(p,doEnable);}else{var wantOn=!sw.classList.contains('on');sw.classList.toggle('on',wantOn);var url=wantOn?'/api/plugins/enable':'/api/plugins/disable';plgToggle(url,p.id);}};
 d.querySelector('[data-set]').onclick=function(){var body=d.querySelector('.plgcard-body');if(body.style.display==='none'){body.style.display='block';loadPlgSettings(p,body);}else{body.style.display='none';}};
 return d;}
function renderPlgCards(){var el=$('plugCards');if(!el)return;el.innerHTML='';if(!plgArr.length){el.innerHTML='<div class="sub">'+t('plgNoPlugins')+'</div>';return;}plgArr.forEach(function(p){el.appendChild(plgCard(p));});}
async function loadPlugins(){try{var r=await fetch('/api/plugins');var list=await r.json();plgArr=Array.isArray(list)?list:(list.plugins||list.entries||[]);renderPlgCards();if(typeof syncQuickPlg==='function')syncQuickPlg();}catch(e){}}
function loadPlgSettings(p,body){if(!(p.enabled||p.run)){body.innerHTML='<div class="sub" style="margin:8px 0;color:var(--warn)">'+t('plgNotEnabled')+'</div>';return;}if(!p.approved){body.innerHTML='<div class="sub" style="margin:8px 0;color:var(--warn)">'+t('plgNotApproved')+'</div>';return;}body.innerHTML='<div class="sub" style="margin:8px 0">'+t('plgLoading')+'</div>';var fn=window['__plgset_'+String(p.id||'').replace(/-/g,'_')];if(typeof fn==='function'){fn(p,body);}else{body.innerHTML='<div class="sub" style="margin:8px 0">'+t('plgPerms')+': '+esc(plgPermsDesc(p))+'</div><div class="sub">'+t('plgSettingsPending')+'</div>';}}
// ===== 数据源/状态 =====
function NM(id){return ({hardware:'srcHW',media:'srcMedia',pages:'srcPages',livetranslate:'srcLive',ocrregion:'srcOcr'})[id]||id;}
function DSC(id){return ({hardware:'srcHWd',media:'srcMediad',pages:'srcPagesd',livetranslate:'srcLived',ocrregion:'srcOcrd'})[id]||'';}
function srcTok(td,x){var sw=document.createElement('div');sw.className='sw'+(x.enabled?' on':'');sw.dataset.src=x.id;sw.onclick=async function(){sw.classList.toggle('on');try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:x.id,enabled:sw.classList.contains('on')})});}catch(e){}pollStatus();};td.appendChild(sw);}
function renderSrcTable(){var tb=$('srcRows');if(!tb)return;tb.innerHTML='';(window._srcs||[]).forEach(function(x){var tr=document.createElement('tr');var td1=document.createElement('td');srcTok(td1,x);var td2=document.createElement('td');td2.textContent=t(NM(x.id));var td3=document.createElement('td');td3.textContent=t(DSC(x.id));var td4=document.createElement('td');var pi=document.createElement('input');pi.type='number';pi.value=x.priority;pi.style.width='62px';pi.onchange=async function(){try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:x.id,priority:Number(pi.value)||0})});}catch(e){}pollStatus();};td4.appendChild(pi);tr.appendChild(td1);tr.appendChild(td2);tr.appendChild(td3);tr.appendChild(td4);tb.appendChild(tr);});}
function setDot(id,cls){var e=$(id);if(e)e.className='dot '+(cls||'');}
async function pollStatus(){try{
  var s=await (await fetch('/api/status')).json();var v=s.vrc||{};
  window._vrcRunning=!!(v.running&&v.oscEnabled);window._srcs=s.sources||[];renderSrcTable();
  document.querySelectorAll('.sw[data-src]').forEach(function(sw){var src=window._srcs.find(function(x){return x.id===sw.dataset.src;});if(src)sw.classList.toggle('on',!!src.enabled);});
  var ccur=$('curChat');if(ccur&&s.current&&s.current.text!=null)ccur.textContent=s.current.text;
  var hp=$('hpDot'),ht=$('hpText');var ok=v.running&&v.oscEnabled;if(hp&&ht){hp.className='dot '+(ok?'on':'warn');ht.textContent=ok?t('hpNormal'):t('hpCheck');}
  if(v.running&&v.oscEnabled){setDot('vrcDot','on');$('vrcText').textContent=t('running');}else if(v.running){setDot('vrcDot','warn');$('vrcText').textContent=t('vrcOscOff');}else{setDot('vrcDot','');$('vrcText').textContent=t('notRunning');}
  setDot('oscDot',v.oscEnabled?'on':'');$('oscText').textContent=v.oscEnabled?t('oscOn'):t('oscOff');
  var pc=await (await fetch('/api/ports/check')).json();var u=pc.udp9000||{};
  if(u.occupied){var nm=u.name||'';var isV=nm.indexOf('VRChat')>=0;setDot('udpDot',isV?'on':'off');$('udpText').textContent=isV?t('udpVrc'):(t('udpBusy')+': '+nm);}else{setDot('udpDot','');$('udpText').textContent=t('udpFree');}
}catch(e){}}
document.querySelectorAll('.sw[data-src]').forEach(function(sw){sw.addEventListener('click',async function(){sw.classList.toggle('on');try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:sw.dataset.src,enabled:sw.classList.contains('on')})});}catch(e){}pollStatus();});});
if($('diagBtn'))$('diagBtn').onclick=async function(){try{var r=await fetch('/api/diagnose');var j=await r.json();alert(JSON.stringify(j,null,2));}catch(e){}};
if($('healthRefresh'))$('healthRefresh').onclick=pollStatus;
// 环境/翻译
async function renderEnv(){var tb=$('envRows');if(!tb)return;tb.innerHTML='';
  var e=null;try{e=await (await fetch('/api/env')).json();}catch(err){}
  if(!e)return;
  var add=function(name,use,st,ok,btnLabel,btnWhat){var tr=document.createElement('tr');
    var c1=document.createElement('td');c1.textContent=name;
    var c2=document.createElement('td');c2.textContent=use;
    var c3=document.createElement('td');c3.className='sub';c3.textContent=st;c3.style.color=ok?'var(--ok)':'var(--warn)';
    var c4=document.createElement('td');
    if(btnLabel){var b=document.createElement('button');b.className='small gray';b.textContent=btnLabel;b.onclick=function(){envInstall(btnWhat);};c4.appendChild(b);}else{c4.textContent='-';}
    tr.appendChild(c1);tr.appendChild(c2);tr.appendChild(c3);tr.appendChild(c4);tb.appendChild(tr);};
  add(t('envNode'),t('envNodeUse'),t('envNodeState')+((e.node||{}).version||''),true);
  var m=e.media||{},ins=e.install||{};
  if(m.ok)add(t('envMedia'),t('envMediaUse'),t('envAvailable'),true);
  else if(ins.running)add(t('envMedia'),t('envMediaUse'),t('envInstalling')+(ins.msg||''),false);
  else if((e.systemPython||{}).found)add(t('envMedia'),t('envMediaUse'),t('envNeedWinsdk'),false,t('envBtnWinsdk'),'winsdk');
  else add(t('envMedia'),t('envMediaUse'),t('envMissing'),false,t('envBtnPython'),'python');
  var lt=e.livetranslate||{};
  if(lt.found)add(t('envLt'),t('envLtUse'),t('envLtOk')+(lt.model||''),true);
  else add(t('envLt'),t('envLtUse'),t('envLtNone'),false);
  var em=$('envMsg');if(em)em.textContent=(ins.running||ins.ok===false)?(ins.msg||''):'';
  var st=$('ltStatus');if(st){st.textContent=lt.found?(t('envLtConfigured')+' '+(lt.model||'')+' → '+(lt.targetLang||'')):t('envLtNone');st.style.color=lt.found?'var(--ok)':'var(--warn)';}}
function envInstall(what){fetch('/api/env/install-'+what,{method:'POST',body:'{}'}).then(function(r){return r.json();}).then(function(j){if(j&&!j.ok&&j.error){var mm=$('envMsg');if(mm)mm.textContent=j.error;}}).catch(function(){});setTimeout(renderEnv,1500);}
async function loadTrans(){try{var c=await (await fetch('/api/config')).json();var o=c.ocrtl||{};var v=o.vision||{};if($('transMode'))$('transMode').value=o.mode||'auto';if($('transApiBase'))$('transApiBase').value=v.apiBase||'';if($('transApiModel'))$('transApiModel').value=v.model||'';if($('transApiKey')&&v.hasKey)$('transApiKey').placeholder='sk-••••••('+t('envLtConfigured')+')';}catch(e){}}
if($('transVoice'))$('transVoice').onchange=async function(){try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:'livetranslate',enabled:this.checked})});}catch(e){}pollStatus();};
if($('transShot'))$('transShot').onclick=async function(){try{var r=await fetch('/api/ocrtl',{method:'POST',body:'{}'});var j=await r.json();alert(j.ok?t('shotTriggered'):t('triggerFail'));}catch(e){alert(t('triggerFail'));}};
// 高级设置
if($('advAuto')){(async function(){try{var c=await (await fetch('/api/config')).json();$('advAuto').checked=!!c.autostart;}catch(e){}})();$('advAuto').onchange=async function(){try{await fetch('/api/autostart',{method:'POST',body:JSON.stringify({enabled:this.checked})});}catch(e){}};}
if($('advConsole')){(async function(){try{var c=await (await fetch('/api/config')).json();$('advConsole').checked=!((c.desktop||{}).showConsole===false);}catch(e){}})();$('advConsole').onchange=async function(){try{await fetch('/api/desktop/console',{method:'POST',body:JSON.stringify({show:this.checked})});}catch(e){}};}
if($('oscPort')){(async function(){try{var c2=await (await fetch('/api/config')).json();$('oscPort').value=(c2.osc&&c2.osc.port)||9000;}catch(e){}})();$('oscApply').onclick=async function(){try{await fetch('/api/ports/osc',{method:'POST',body:JSON.stringify({port:Number($('oscPort').value)||9000})});alert(t('portApplied'));}catch(e){alert(t('applyFail'));}};}
if($('devdocsBtn'))$('devdocsBtn').onclick=function(){fetch('/api/devdocs/open',{method:'POST',body:'{}'});};
if($('quitBtn'))$('quitBtn').onclick=function(){if(confirm(t('quitConfirmShort')))fetch('/api/desktop/quit',{method:'POST',body:'{}'});};
if($('restartBtn'))$('restartBtn').onclick=function(){if(confirm(t('restartConfirmShort')))fetch('/api/desktop/restart',{method:'POST',body:'{}'});};
async function loadLogs(){try{var r=await fetch('/api/logs?tail=200');var j=await r.json();var arr=Array.isArray(j)?j:(j.lines||[]);var q=(($('logFilter')||{}).value||'');if(q)arr=arr.filter(function(l){return String(l).indexOf(q)>=0;});var el=$('logView');if(el)el.textContent=arr.join('\n')||t('noLog');}catch(e){}}
if($('logRefresh'))$('logRefresh').onclick=loadLogs;if($('logFilter'))$('logFilter').addEventListener('input',loadLogs);
if($('oscTest'))$('oscTest').onclick=async function(){try{var s=await (await fetch('/api/status')).json();var v=s.vrc||{};var pc=await (await fetch('/api/ports/check')).json();var u=pc.udp9000||{};var m=t('oscTestPrefix')+new Date().toLocaleTimeString();var sr=await fetch('/v1/chatbox',{method:'POST',body:JSON.stringify({text:m})});var sj=await sr.json();alert('VRChat: '+(v.running?t('running'):t('notRunning'))+'\nOSC: '+(v.oscEnabled?t('oscOn'):t('oscOff'))+'\nUDP 9000: '+(u.occupied?((u.name||'').indexOf('VRChat')>=0?t('udpVrc'):t('udpBusy')+': '+(u.name||u.pid)):t('udpFree'))+'\n'+t('oscTestMsg')+': '+(sj.ok?(t('sent')+'「'+m+'」'):(t('sendFailShort')+': '+(sj.error||''))));}catch(e){alert(t('testError'));}};
// 动效
function applyAnim(){var off=localStorage.getItem('vrcbAnimMaster')==='1'||(localStorage.getItem('vrcbAnimAutoOff')==='1'&&!!window._vrcRunning);document.body.classList.toggle('no-anim',off);if(!off&&window.__fxRestart)window.__fxRestart();}
if($('animTop')){$('animTop').onclick=function(){var off=!document.body.classList.contains('no-anim');document.body.classList.toggle('no-anim',off);localStorage.setItem('vrcbAnimMaster',off?'1':'0');$('animTop').classList.toggle('on',!off);};$('animTop').classList.toggle('on',localStorage.getItem('vrcbAnimMaster')!=='1');}
if($('animTgl')){$('animTgl').onclick=function(){var on=this.classList.contains('on');this.classList.toggle('on',!on);localStorage.setItem('vrcbAnimAutoOff',on?'0':'1');applyAnim();};$('animTgl').classList.toggle('on',localStorage.getItem('vrcbAnimAutoOff')==='1');}
function starryBoot(){
  var st=document.createElement('style');st.textContent='.pl{position:absolute;left:16%;top:50%;transform:translateY(-50%);height:3px;width:0;background:linear-gradient(90deg,#7c5cf6,#c4b5fd,#7c5cf6);border-radius:2px;box-shadow:0 0 18px #7c5cf6aa;z-index:5}.plogo{position:absolute;left:0;right:0;bottom:50%;height:30%;display:flex;align-items:flex-end;justify-content:center;transform-origin:50% 100%;transform:scaleY(0);z-index:4}.plogo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.plogo .pnew{visibility:hidden;z-index:1}.plogo .pold{z-index:2}.pwipe{position:absolute;top:-12%;bottom:-12%;left:0;width:80px;transform:skewX(-14deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),rgba(167,139,250,.42),transparent);mix-blend-mode:screen;z-index:3;opacity:0}.pword{position:absolute;left:0;right:0;top:50%;width:44%;margin:0 auto;transform-origin:50% 0%;transform:scaleY(0)}.pword img{width:100%;display:block}.ptag{position:absolute;left:0;right:0;bottom:13%;text-align:center;font-size:16px;color:#c4b5fd;opacity:0;letter-spacing:1px}';document.head.appendChild(st);
  var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;z-index:9999;pointer-events:none;background:radial-gradient(110% 110% at 50% 32%, #7c5cf62e 0%, #0b0e13 72%)';
  ov.innerHTML='<div class="pl"></div><div class="plogo"><img class="pnew" src="/starry-new.png"><img class="pold" src="/starry-old.png"><div class="pwipe"></div></div><div class="pword"><img src="/starry-wordmark.png"></div><div class="ptag">'+t('bootStarryTag')+'</div>';
  document.body.appendChild(ov);
  var pl=ov.querySelector('.pl'),plogo=ov.querySelector('.plogo'),pold=ov.querySelector('.pold'),pnew=ov.querySelector('.pnew'),pwipe=ov.querySelector('.pwipe'),pword=ov.querySelector('.pword'),ptag=ov.querySelector('.ptag');
  var prog=0,iv=setInterval(function(){prog+=1.2;if(prog>66){prog=66;clearInterval(iv);}pl.style.width=prog+'%';},20);
  setTimeout(function(){plogo.style.transition='transform .9s cubic-bezier(.2,.7,.3,1)';plogo.style.transform='scaleY(1)';pword.style.transition='transform .9s cubic-bezier(.2,.7,.3,1)';pword.style.transform='scaleY(1)';},1300);
  setTimeout(function(){pwipe.style.opacity='1';pnew.style.visibility='visible';pnew.style.clipPath='inset(0 100% 0 0)';var p=0,iv2=setInterval(function(){p+=2;if(p>108){p=108;clearInterval(iv2);pwipe.style.opacity='0';}pwipe.style.left=p+'%';pold.style.clipPath='inset(0 0 0 '+p+'%)';pnew.style.clipPath='inset(0 '+(100-p)+'% 0 0)';},18);},2700);
  setTimeout(function(){ptag.style.transition='opacity .5s';ptag.style.opacity='1';},3800);
  setTimeout(function(){ov.style.transition='opacity .6s';ov.style.opacity='0';},5600);
  setTimeout(function(){ov.remove();},6300);
}
function playSpecialVideo(sv){
  var vurl='/api/special/video'+(sv&&sv.video?('?file='+encodeURIComponent(sv.video)):'');
  var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;z-index:9999;background:#000;cursor:pointer';
  ov.innerHTML='<video src="'+vurl+'" autoplay playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"></video>'+(sv&&sv.title?('<div style="position:absolute;bottom:26px;left:0;right:0;text-align:center;color:rgba(255,255,255,.7);font-size:13px;letter-spacing:2px;pointer-events:none">'+t('clickToSkip')+'</div>'):'');
  document.body.appendChild(ov);
  var skipped=false; var skip=function(){if(skipped)return;skipped=true;ov.remove();};
  ov.addEventListener('click',skip);
  var v=ov.querySelector('video');
  if(v){v.addEventListener('ended',skip);v.addEventListener('error',function(){if(!skipped)skip();});}
  setTimeout(skip,120000);
}
function simpleBoot(c1,c2,greet,deco,title,tag){
  var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;z-index:9998;pointer-events:none;background:radial-gradient(110% 110% at 50% 32%, '+c1+'40 0%, #0b0e13 72%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;transition:opacity .55s';
  ov.innerHTML='<img src="/api/icon" onerror="this.style.display=\'none\'" style="width:78px;height:78px;border-radius:20px;filter:drop-shadow(0 0 20px '+c1+'99)"><div style="font-size:30px;font-weight:800;background:linear-gradient(90deg,'+c1+','+c2+');-webkit-background-clip:text;background-clip:text;color:transparent">'+title+'</div><div style="color:#9aa7ba;font-size:13px;letter-spacing:3px">'+tag+'</div><div style="color:'+c2+';font-size:14px;font-weight:600">'+(greet?deco+' '+greet:'')+'</div>';
  document.body.appendChild(ov);setTimeout(function(){ov.style.opacity='0';},1900);setTimeout(function(){ov.remove();},2455);
}
// 启动动画(品牌感知)
(async function(){var bc=null;try{bc=await (await fetch('/api/config')).json();}catch(e){}
 var _bs=document.getElementById('bootscrim');if(_bs)_bs.remove();
 var _d0=new Date();var _ds=_d0.getFullYear()+'-'+('0'+(_d0.getMonth()+1)).slice(-2)+'-'+('0'+_d0.getDate()).slice(-2);
 var _specs=(bc&&bc.specialEvents)||[];
 var _r=(window.VRCB_SKIN&&window.VRCB_SKIN.resolve)?window.VRCB_SKIN.resolve(_ds,_specs,(bc&&bc.lang)||'zh-CN'):null;
 if(_r&&_r.type==='special'){playSpecialVideo(_r);return;}
 var brd=(bc&&bc.branding)||'default';
 if(brd==='starry'){starryBoot();return;}
 if(_r){simpleBoot(_r.c1,_r.c2,_r.greet,_r.deco,'VRCLiveBoard',t('bootTagline'));return;}
 simpleBoot('#3b82f6','#7dd3fc','','✦','VRCLiveBoard',t('bootTagline'));return;
 var now=new Date(),m=now.getMonth()+1,d=now.getDate();
 var fest=[[1,1,'元旦快乐','#f59e0b','#60a5fa','🎆'],[9,15,'中秋快乐','#f5c518','#ff8c42','🥮'],[10,1,'国庆快乐','#ff5b5b','#f5c518','🎆'],[10,31,'万圣节快乐','#ff8c00','#c084fc','🎃'],[12,25,'圣诞快乐','#2fbf71','#e2405b','🎄']];
 var t=null;for(var i=0;i<fest.length;i++){var f=fest[i];if(f[0]===m&&f[1]===d){t=f;break;}}
 var c1,c2,greet,deco,title,tag;
 if(brd==='starry'){starryBoot();return;}
 else if(t){c1=t[3];c2=t[4];greet=t[2];deco=t[5];title='VRCLiveBoard';tag=t('bootTagline');}
 else if(m>=3&&m<=5){c1='#34d399';c2='#f9a8d4';greet='春色满园';deco='🌸';title='VRCLiveBoard';tag=t('bootTagline');}
 else if(m>=6&&m<=8){c1='#38bdf8';c2='#86efac';greet='夏日浓荫';deco='☀️';title='VRCLiveBoard';tag=t('bootTagline');}
 else if(m>=9&&m<=11){c1='#f59e0b';c2='#f87171';greet='秋意渐浓';deco='🍂';title='VRCLiveBoard';tag=t('bootTagline');}
 else{c1='#60a5fa';c2='#e0f2fe';greet='冬日暖阳';deco='❄️';title='VRCLiveBoard';tag=t('bootTagline');}
 var ov=document.createElement('div');
 ov.style.cssText='position:fixed;inset:0;z-index:9999;pointer-events:none;background:radial-gradient(110% 110% at 50% 32%, '+c1+'40 0%, #0b0e13 72%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#e8edf3;transition:opacity .55s';
 ov.innerHTML='<img src="/api/icon" onerror="this.style.display=\'none\'" style="width:78px;height:78px;border-radius:20px;filter:drop-shadow(0 0 20px '+c1+'99)"><div style="font-size:30px;font-weight:800;background:linear-gradient(90deg,'+c1+','+c2+');-webkit-background-clip:text;background-clip:text;color:transparent">'+title+'</div><div style="color:#9aa7ba;font-size:13px;letter-spacing:3px">'+tag+'</div><div style="color:'+c2+';font-size:14px;margin-top:6px;font-weight:600">'+(greet?deco+' '+greet:'')+'</div>';
 document.body.appendChild(ov);setTimeout(function(){ov.style.opacity='0';},1900);setTimeout(function(){ov.remove();},2455);
})();
syncQuickPlg();

// 常用插件快捷开关 + 各插件设置
function syncQuickPlg(){document.querySelectorAll('.sw[data-plg]').forEach(function(sw){var p=plgArr.find(function(x){return x.id===sw.dataset.plg;});if(p)sw.classList.toggle('on',!!(p.enabled||p.run));});}
document.querySelectorAll('.sw[data-plg]').forEach(function(sw){sw.addEventListener('click',async function(){var wantOn=!sw.classList.contains('on');sw.classList.toggle('on',wantOn);var url=wantOn?'/api/plugins/enable':'/api/plugins/disable';try{await fetch(url,{method:'POST',body:JSON.stringify({id:sw.dataset.plg})});setTimeout(loadPlugins,500);}catch(e){}});});
function tblRows(body,sel,cols,rows,keys){
  var tb=body.querySelector(sel);if(!tb)return;tb.innerHTML='';
  rows.forEach(function(x,i){var tr=document.createElement('tr');
    cols.forEach(function(c){var td=document.createElement('td');
      if(c.type==='text'){var ip=document.createElement('input');ip.type='text';ip.value=x[c.k]||'';ip.dataset.i=i;ip.dataset.k=c.k;ip.onchange=function(){rows[+this.dataset.i][this.dataset.k]=this.value;};td.appendChild(ip);}
      else if(c.type==='num'){var ip2=document.createElement('input');ip2.type='number';ip2.value=x[c.k]||c.def||'';ip2.style.width='60px';ip2.dataset.i=i;ip2.dataset.k=c.k;ip2.onchange=function(){rows[+this.dataset.i][this.dataset.k]=Number(this.value)||0;};td.appendChild(ip2);}
      else if(c.type==='chk'){var ip3=document.createElement('input');ip3.type='checkbox';ip3.checked=!!x[c.k];ip3.dataset.i=i;ip3.dataset.k=c.k;ip3.onchange=function(){rows[+this.dataset.i][this.dataset.k]=this.checked;};td.appendChild(ip3);}
      else if(c.type==='btn'){var b=document.createElement('button');b.className='small gray';b.textContent=c.label;b.dataset.i=i;b.dataset.act=c.act;b.onclick=function(){c.fn(+this.dataset.i,rows);};td.appendChild(b);}
      else if(c.type==='del'){var d=document.createElement('button');d.className='small danger';d.textContent=(window.UI_TXT&&window.UI_TXT.del)||t('delBtn');d.dataset.i=i;d.onclick=function(){rows.splice(+this.dataset.i,1);render();};td.appendChild(d);}
      tr.appendChild(td);});
    tb.appendChild(tr);});
}
function plugCall(id,method,args){return fetch('/api/plugins/call',{method:'POST',body:JSON.stringify({id:id,method:method,args:args||{}})}).then(function(r){return r.json();});}
function xlsxReady(id,cb){if(window.XLSX)return cb();var s=document.createElement('script');s.src='/api/plugins/asset?id='+id+'&file=vendor/xlsx.full.min.js';s.onload=function(){cb();};s.onerror=function(){};document.head.appendChild(s);}
function exportAoa(id,sheet,aoa,fn){xlsxReady(id,function(){if(!window.XLSX)return;var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),sheet);XLSX.writeFile(wb,fn);});}
// 好友欢迎
window.__plgset_friend_welcome=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">'+t('fwTitle')+'</div><table><thead><tr><th>'+t('fwThName')+'</th><th>'+t('fwThLines')+'</th><th>'+t('fwThLoops')+'</th><th>'+t('fwThSec')+'</th><th>'+t('fwThEnable')+'</th><th></th></tr></thead><tbody class="fwTb"></tbody></table><div class="row" style="margin-top:8px"><button class="small gray" data-fwadd>'+t('btnAdd')+'</button><button class="small" data-fwsave>'+t('btnSave')+'</button><button class="small gray" data-fwexp>'+t('fwExp')+'</button><button class="small gray" data-fwimp>'+t('fwImp')+'</button><input type="file" accept=".xlsx" class="fwFile" style="display:none"><span class="sub" data-fwmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-fwmsg]');
  function render(){tblRows(body,'.fwTb',[{type:'text',k:'name'},{type:'text',k:'lines'},{type:'num',k:'loops',def:2},{type:'num',k:'eachSec',def:6},{type:'chk',k:'enabled'},{type:'del'}],rows,{});}
  body.querySelector('[data-fwadd]').onclick=function(){rows.push({name:'',lines:t('fwWelcomeDefault'),loops:2,eachSec:6,enabled:true});render();};
  body.querySelector('[data-fwsave]').onclick=function(){var rows2=rows.map(function(x){return [x.name||'',x.lines||'',Number(x.loops)||2,Number(x.eachSec)||6,x.enabled!==false];});plugCall('friend-welcome','saveRows',{rows:rows2}).then(function(j){msg.textContent=j&&j.ok?(t('fwSaved').replace('{n}',(j.count||rows2.length))):(t('failed')+': '+(j&&j.error||''));});};body.querySelector('[data-fwexp]').onclick=function(){exportAoa('friend-welcome',t('fwTitle'),[[t('fwThName'),t('fwThLines'),t('fwThLoops'),t('fwThSec'),t('fwThEnable')]].concat(rows.map(function(x){return [x.name||'',x.lines||'',x.loops||2,x.eachSec||6,x.enabled!==false?'':'否'];})),'好友欢迎名单.xlsx');};body.querySelector('[data-fwimp]').onclick=function(){body.querySelector('.fwFile').click();};body.querySelector('.fwFile').onchange=function(ev){var f=ev.target.files&&ev.target.files[0];if(!f)return;xlsxReady('friend-welcome',function(){var rd=new FileReader();rd.onload=function(e){try{var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});var sh=wb.Sheets[wb.SheetNames[0]];var aoa=XLSX.utils.sheet_to_json(sh,{header:1});plugCall('friend-welcome','importRows',{rows:aoa}).then(function(j){msg.textContent=j&&j.ok?(t('fwImported').replace('{n}',(j.count||0))):(t('fwImportFail')+': '+(j&&j.error||''));plugCall('friend-welcome','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});}catch(err){msg.textContent=t('fwImportFail')+': '+err.message;}};rd.readAsArrayBuffer(f);});};
  plugCall('friend-welcome','getRows',{}).then(function(j){rows=Array.isArray(j)?j:((j&&j.rows)||[]);render();});
};
// 定时公告
window.__plgset_scheduled_board=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">'+t('sbTitle')+'</div><div class="sub">'+t('sbRegular')+'</div><textarea class="sbItems" rows="3" style="width:100%"></textarea>'
    +'<div class="row" style="margin:8px 0"><label class="sub"><input type="number" class="sbInterval" value="30" style="width:64px"> '+t('sbMinutes')+'</label><label class="sub"><input type="checkbox" class="sbOnHour"> '+t('sbOnHour')+'</label><label class="sub"><input type="checkbox" class="sbOnHalf"> '+t('sbOnHalf')+'</label><label class="sub"><input type="checkbox" class="sbHourIntr"> '+t('sbHourIntr')+'</label></div>'
    +'<div class="sub">'+t('sbHourly')+'</div><input type="text" class="sbHourly" style="width:100%">'
    +'<div class="sub" style="margin:8px 0 4px">'+t('sbSpecial')+'</div><table><thead><tr><th>'+t('sbThAt')+'</th><th>'+t('sbThContent')+'</th><th>'+t('sbThInterrupt')+'</th><th></th></tr></thead><tbody class="sbTb"></tbody></table>'
    +'<div class="row" style="margin-top:8px"><button class="small gray" data-sbadd>'+t('btnAdd')+'</button><button class="small" data-sbsave>'+t('btnSave')+'</button><button class="small gray" data-sbtest>'+t('sbTest')+'</button><button class="small gray" data-sbexp>'+t('sbExp')+'</button><button class="small gray" data-sbimp>'+t('sbImp')+'</button><input type="file" accept=".xlsx" class="sbFile" style="display:none"><span class="sub" data-sbmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-sbmsg]');
  function render(){tblRows(body,'.sbTb',[{type:'text',k:'at'},{type:'text',k:'text'},{type:'chk',k:'interrupt'},{type:'del'}],rows,{});}
  body.querySelector('[data-sbadd]').onclick=function(){rows.push({at:'',text:'',interrupt:false});render();};
  body.querySelector('[data-sbsave]').onclick=function(){var args={items:body.querySelector('.sbItems').value.split('\n'),intervalMin:Number(body.querySelector('.sbInterval').value)||30,onHour:body.querySelector('.sbOnHour').checked,onHalf:body.querySelector('.sbOnHalf').checked,hourlyText:body.querySelector('.sbHourly').value.split('|'),interruptHourly:body.querySelector('.sbHourIntr').checked,specials:rows.map(function(x){return [x.at||'',x.text||'',x.interrupt?'':'否'];})};plugCall('scheduled-board','saveAll',args).then(function(j){msg.textContent=j&&j.ok?(t('sbSaved').replace('{items}',(j.items||0)).replace('{specials}',(j.specials||0))):(t('failed')+': '+(j&&j.error||''));}).catch(function(e){msg.textContent=t('failed')+': '+e.message;});};
  body.querySelector('[data-sbtest]').onclick=function(){plugCall('scheduled-board','testFire',{type:'regular'}).then(function(j){msg.textContent=j&&j.ok?t('sbFired'):t('sbFireFail');});};body.querySelector('[data-sbexp]').onclick=function(){exportAoa('scheduled-board',t('sbSpecial'),[[t('sbThAt'),t('sbThContent'),t('sbThInterrupt')]].concat(rows.map(function(x){return [x.at||'',x.text||'',x.interrupt?'':'否'];})),'特殊公告.xlsx');};body.querySelector('[data-sbimp]').onclick=function(){body.querySelector('.sbFile').click();};body.querySelector('.sbFile').onchange=function(ev){var f=ev.target.files&&ev.target.files[0];if(!f)return;xlsxReady('scheduled-board',function(){var rd=new FileReader();rd.onload=function(e){try{var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});var sh=wb.Sheets[wb.SheetNames[0]];var aoa=XLSX.utils.sheet_to_json(sh,{header:1});plugCall('scheduled-board','importRows',{rows:aoa}).then(function(j){msg.textContent=j&&j.ok?(t('sbImported').replace('{n}',(j.count||0))):(t('fwImportFail')+': '+(j&&j.error||''));plugCall('scheduled-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});}catch(err){msg.textContent=t('fwImportFail')+': '+err.message;}};rd.readAsArrayBuffer(f);});};
  plugCall('scheduled-board','status',{}).then(function(st){if(st&&st.ok){body.querySelector('.sbItems').value=(st.items||[]).join('\n');body.querySelector('.sbInterval').value=st.intervalMin||30;body.querySelector('.sbOnHour').checked=!!st.onHour;body.querySelector('.sbOnHalf').checked=!!st.onHalf;body.querySelector('.sbHourIntr').checked=!!st.interruptHourly;body.querySelector('.sbHourly').value=(st.hourlyText||[]).join('|');}});plugCall('scheduled-board','getRows',{}).then(function(j){rows=Array.isArray(j)?j:[];render();});
};
// 天气播报
window.__plgset_weather_board=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">'+t('wxTitle')+'</div><div class="row" style="margin:0 0 8px"><label class="sub"><input type="number" class="wxInterval" value="15" style="width:60px"> '+t('sbMinutes')+'</label><label class="sub"><input type="number" class="wxDisplay" value="60" style="width:60px"> '+t('wxDisplaySec')+'</label><label class="sub"><input type="checkbox" class="wxContinuous"> '+t('wxContinuous')+'</label><label class="sub">'+t('wxPrefix')+' <input type="text" class="wxPrefix" value="【天气】"></label></div>'
    +'<table><thead><tr><th>'+t('wxThCity')+'</th><th>'+t('wxThEnable')+'</th><th></th><th></th></tr></thead><tbody class="wxTb"></tbody></table>'
    +'<div class="row" style="margin-top:8px"><button class="small gray" data-wxadd>'+t('btnAdd')+'</button><button class="small gray" data-wxpreset>'+t('wxPresetCn')+'</button><button class="small gray" data-wxpresetw>'+t('wxPresetWorld')+'</button><button class="small" data-wxsave>'+t('btnSave')+'</button><button class="small gray" data-wxexp>'+t('wxExp')+'</button><span class="sub" data-wxmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-wxmsg]');
  function render(){tblRows(body,'.wxTb',[{type:'text',k:'name'},{type:'chk',k:'enabled'},{type:'btn',label:t('btnTest'),act:'test',fn:function(i){plugCall('weather-board','testCity',{index:i}).then(function(j){msg.textContent=j&&j.ok?(t('wxSent').replace('{text}',j.text)):t('wxTestFail');});}},{type:'del'}],rows,{});}
  body.querySelector('[data-wxadd]').onclick=function(){rows.push({name:'',enabled:true});render();};
  body.querySelector('[data-wxpreset]').onclick=function(){plugCall('weather-board','addPresets',{kind:'cn'}).then(function(j){msg.textContent=j&&j.ok?(t('wxAddedCn').replace('{n}',(j.added||0))):t('failed');plugCall('weather-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});};body.querySelector('[data-wxpresetw]').onclick=function(){plugCall('weather-board','addPresets',{kind:'world'}).then(function(j){msg.textContent=j&&j.ok?(t('wxAddedWorld').replace('{n}',(j.added||0))):t('failed');plugCall('weather-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});};
  body.querySelector('[data-wxexp]').onclick=function(){exportAoa('weather-board',t('wxTitle'),[[t('wxThCity'),t('wxThEnable')]].concat(rows.map(function(x){return [x.name||'',x.enabled?'':'否'];})),'天气城市.xlsx');};body.querySelector('[data-wxsave]').onclick=function(){var cfg={intervalMin:Number(body.querySelector('.wxInterval').value)||15,displaySec:Number(body.querySelector('.wxDisplay').value)||60,continuous:body.querySelector('.wxContinuous').checked,prefix:body.querySelector('.wxPrefix').value||'【天气】'};plugCall('weather-board','saveRows',{rows:rows.map(function(x){return [x.name||'',x.enabled?'':'否'];})}).then(function(j){if(!j||!j.ok){msg.textContent=t('failed')+': '+(j&&j.error||'');return;}plugCall('weather-board','saveConfig',cfg).then(function(){msg.textContent=t('wxSaved');});});};
  plugCall('weather-board','status',{}).then(function(st){if(st&&st.ok){body.querySelector('.wxInterval').value=st.intervalMin||15;body.querySelector('.wxDisplay').value=st.displaySec||60;body.querySelector('.wxContinuous').checked=!!st.continuous;body.querySelector('.wxPrefix').value=st.prefix!==undefined?st.prefix:'【天气】';}});plugCall('weather-board','getRows',{}).then(function(j){rows=Array.isArray(j)?j:[];render();});
};
// 网易云歌词
window.__plgset_netease_lyrics=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">'+t('nlTitle')+'</div>'
    +'<div class="row" style="gap:8px;flex-wrap:wrap"><label class="sub"><input type="number" class="nlUpdate" value="4" style="width:56px"> '+t('nlUpdateSec')+'</label><label class="sub"><input type="number" class="nlPrio" value="35" style="width:56px"> '+t('nlPriority')+'</label><label class="sub"><input type="number" class="nlPort" value="9234" style="width:64px"> '+t('nlCdpPort')+'</label></div>'
    +'<div class="row" style="gap:8px;flex-wrap:wrap;margin:6px 0"><label class="sub"><input type="checkbox" class="nlTrans" checked> '+t('nlTrans')+'</label><label class="sub" title="'+t('nlOtherTitle')+'"><input type="checkbox" class="nlOther"> '+t('nlOther')+'</label><label class="sub"><input type="checkbox" class="nlRhythm"> '+t('nlRhythm')+'</label><label class="sub"><input type="checkbox" class="nlTitle" checked> '+t('nlTitleTop')+'</label></div>'
    +'<div class="sub">'+t('nlExePath')+'</div><input type="text" class="nlExe" style="width:100%">'
    +'<div class="sub" style="margin:8px 0">'+t('nlExeHint')+'</div>'
    +'<div class="row" style="margin-top:8px"><button class="small" data-nlsave>'+t('btnSave')+'</button><button class="small gray" data-nltest>'+t('btnTest')+'</button><button class="small gray" data-nlcdp>'+t('nlCdpRestart')+'</button><span class="sub" data-nlmsg></span></div>';
  var msg=body.querySelector('[data-nlmsg]');
  function collect(){return {updateSec:Number(body.querySelector('.nlUpdate').value)||4,showTranslation:body.querySelector('.nlTrans').checked,allowOtherPlayers:body.querySelector('.nlOther').checked,rhythmMode:body.querySelector('.nlRhythm').checked,showTitle:body.querySelector('.nlTitle').checked,priority:Number(body.querySelector('.nlPrio').value)||35,cdpPort:Number(body.querySelector('.nlPort').value)||9234,cloudExe:body.querySelector('.nlExe').value.trim()};}
  body.querySelector('[data-nlsave]').onclick=function(){plugCall('netease-lyrics','saveConfig',collect()).then(function(j){msg.textContent=j&&j.ok?t('wxSaved'):t('failed')+': '+(j&&j.error||'');});};
  body.querySelector('[data-nltest]').onclick=function(){plugCall('netease-lyrics','testNow',{}).then(function(j){msg.textContent=j&&j.ok?(t('wxSent').replace('{text}',j.text)):t('wxTestFail');});};
  body.querySelector('[data-nlcdp]').onclick=function(){if(!confirm(t('nlRestartConfirm')))return;plugCall('netease-lyrics','launchCdp',{}).then(function(j){msg.textContent=j&&j.ok?(j.note||t('nlSuccess')):t('failed')+': '+(j&&j.error||'');});};
  plugCall('netease-lyrics','status',{}).then(function(j){if(j&&j.cfg){var c=j.cfg;body.querySelector('.nlUpdate').value=c.updateSec||4;body.querySelector('.nlPrio').value=c.priority||35;body.querySelector('.nlPort').value=c.cdpPort||9234;body.querySelector('.nlExe').value=c.cloudExe||'';body.querySelector('.nlTrans').checked=c.showTranslation!==false;body.querySelector('.nlOther').checked=!!c.allowOtherPlayers;body.querySelector('.nlRhythm').checked=!!c.rhythmMode;body.querySelector('.nlTitle').checked=c.showTitle!==false;}});
};

// 品牌选择: 变更即保存 + 回显已保存值
if($('brandSel'))$('brandSel').onchange=function(){try{fetch('/api/config',{method:'POST',body:JSON.stringify({branding:this.value})});}catch(e){}};
(async function(){try{var _c=await (await fetch('/api/config')).json();var _bs=$('brandSel');if(_bs&&_c.branding)_bs.value=_c.branding;}catch(e){}})();

// init

pollStatus();setInterval(pollStatus,5000);
loadPages();loadPlugins();renderEnv();loadTrans();loadLogs();
// ===== 安全与权限(旧版套皮) =====
const T = window.VRCB_LANG || { 'zh-CN': {} };

let lang = 'zh-CN';
function t(k) { const d = T[lang] || T['zh-CN']; return (d[k] !== undefined) ? d[k] : (T['zh-CN'][k] !== undefined ? T['zh-CN'][k] : k); }
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t(el.getAttribute('data-t')); });
  document.querySelectorAll('[data-t-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-t-ph')); }); document.querySelectorAll('[data-tt]').forEach(function (el) { el.title = t(el.getAttribute('data-tt')); }); try{buildBdVar();}catch(e){}
}
var VAR_LABELS={'{cpu_util}':'varCpuUtil','{cpu_temp}':'varCpuTemp','{gpu_util}':'varGpuUtil','{gpu_temp}':'varGpuTemp','{mem_used}':'varMemUsed','{mem_total}':'varMemTotal','{net_down}':'varNetDown','{net_up}':'varNetUp','{song}':'varSong','{artist}':'varArtist','{album}':'varAlbum','{date}':'varDate','{time}':'varTime'}; function buildBdVar(){var s=$('bdVar');if(!s)return;for(var i=0;i<s.options.length;i++){var o=s.options[i];var k=VAR_LABELS[o.value];if(k)o.textContent=o.value+' · '+t(k);}} function reRenderAll(){try{applyLang();}catch(e){}try{renderBoard();}catch(e){}try{renderSrcTable();}catch(e){}try{renderEnv();}catch(e){}try{renderPlgCards();}catch(e){}try{pollStatus();}catch(e){}try{if(window.__reThemeLabels)window.__reThemeLabels();}catch(e){}} async function gateRender() {
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
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? t('secSaved') : (t('saveFail')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = t('saveFail')+': ' + e.message; });
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
    .then(function (o) { const m = document.getElementById('psMsg'); if (m) m.textContent = o.ok ? t('plgSecSaved') : (t('failed')+': ' + ((o.j && o.j.error) || '')); });
}
function secAddWordFn() {
  const w = ((document.getElementById('secAddWord') || {}).value || '').trim();
  if (!w) return;
  fetch('/api/security', { method: 'POST', body: JSON.stringify({ addWords: [w] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? t('secWordAdded') : (t('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = t('failed')+': ' + e.message; });
}
function secWordsSave() {
  const words = ((document.getElementById('secWordsEdit') || {}).value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  fetch('/api/security-words', { method: 'POST', body: JSON.stringify({ words: words }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? t('secWordsSaved') : (t('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = t('failed')+': ' + e.message; });
}
function secWordsReset() {
  fetch('/api/security-words', { method: 'POST', body: JSON.stringify({ resetDefaults: true }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? t('secWordsResetOk') : (t('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function () {});
}
function swfAddWordFn() {
  const w = ((document.getElementById('swfAddWord') || {}).value || '').trim();
  if (!w) return;
  fetch('/api/swearfilter', { method: 'POST', body: JSON.stringify({ addWords: [w] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? t('swfWordAdded') : (t('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = t('failed')+': ' + e.message; });
}
function swfSave() {
  fetch('/api/swearfilter', { method: 'POST', body: JSON.stringify({ enabled: !!(document.getElementById('swfOn') && document.getElementById('swfOn').checked) }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? t('swfSaved') : (t('saveFail')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = t('saveFail')+': ' + e.message; });
}
function swfWordsSave() {
  const words = ((document.getElementById('swfWords') || {}).value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  fetch('/api/swearfilter-words', { method: 'POST', body: JSON.stringify({ words: words }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? t('swfWordsSaved') : (t('saveFail')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } })
    .catch(function (e) { const gm = document.getElementById('gateMsg'); if (gm) gm.textContent = t('saveFail')+': ' + e.message; });
}
function swfWordsReset() {
  fetch('/api/swearfilter-words', { method: 'POST', body: JSON.stringify({ resetDefaults: true }) })
    .then(function (r) { return r.json(); })
    .then(function (j) { const gm = document.getElementById('gateMsg'); if (gm) { gm.textContent = (j && j.ok) ? t('swfWordsResetOk') : (t('failed')+': ' + ((j && j.error) || '')); gm.style.color = (j && j.ok) ? 'var(--ok)' : 'var(--err)'; } gateRender(); })
    .catch(function () {});
}
// 安全初始化(在 T/lang 声明后)
try{applyLang();}catch(e){}
try{gateRender();}catch(e){}
try{psLoad();}catch(e){}

// 语言切换
if(langSel)langSel.onchange=function(){lang=this.value;try{fetch('/api/lang',{method:'POST',body:JSON.stringify({lang:lang})});}catch(e){}reRenderAll();};

// 语言加载(读回保存的语言)
(async function(){try{var _c=await (await fetch('/api/config')).json();lang=(_c&&_c.lang)||'zh-CN';var _ls=langSel;if(_ls)_ls.value=lang;reRenderAll();}catch(e){}})();

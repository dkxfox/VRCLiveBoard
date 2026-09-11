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
if(box&&$('send')){$('send').onclick=async function(){var tx=box.value;if(!tx.trim())return;try{var r=await fetch('/v1/chatbox',{method:'POST',body:JSON.stringify({text:tx})});var j=await r.json();if(j.ok){if(cur)cur.textContent=tx;}else alert(tr('sendFailShort')+': '+(j.error||''));}catch(e){}};
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
    d.querySelectorAll('button').forEach(function(b){b.onclick=function(ev){ev.stopPropagation();var a=b.dataset.a,i=+b.dataset.i;if(a==='up'&&i>0){var tp=pages[i-1];pages[i-1]=pages[i];pages[i]=tp;if(curIdx===i)curIdx=i-1;}if(a==='down'&&i<pages.length-1){var t2=pages[i];pages[i]=pages[i+1];pages[i+1]=t2;if(curIdx===i)curIdx=i+1;}renderBoard();};});
    list.appendChild(d);});
  var bdt=$('bdText');if(bdt&&pages[curIdx])bdt.value=pages[curIdx].text;
  var prev=$('bdPrev');if(prev)prev.textContent=pages[curIdx]?(pages[curIdx].text||tr('emptyPage')):tr('emptyPage');
  applyBdPrevWidth();
}
function renderBoard(){
  var pt=$('pageText');if(pt&&pages.length)pt.textContent=pages[curIdx].text||'-';
  var bc=$('boardCount');if(bc)bc.textContent=tr('boardCountN').replace('{n}',pages.length);
  var pn=$('pgNum');if(pn)pn.textContent=tr('pageNum').replace('{a}',curIdx+1).replace('{b}',pages.length);
  var bh=$('bdHint');if(bh)bh.textContent=tr('boardHint').replace('{n}',pages.length);
  var el=$('edlist');if(el){el.innerHTML='';
    pages.forEach(function(p,i){var d=document.createElement('div');d.className='edrow';
      d.innerHTML='<span class="drag">⠿</span><span class="mono">'+(i+1)+'</span><span class="snip">'+esc(fl(p.text))+'</span><span class="ops"><button class="small gray" data-a="up" data-i="'+i+'">↑</button><button class="small gray" data-a="down" data-i="'+i+'">↓</button><button class="small gray" data-a="del" data-i="'+i+'">'+tr('delBtn')+'</button></span>';
      el.appendChild(d);});
    el.querySelectorAll('button').forEach(function(b){b.onclick=function(){var a=b.dataset.a,i=+b.dataset.i;if(a==='up'&&i>0){var tp=pages[i-1];pages[i-1]=pages[i];pages[i]=tp;if(curIdx===i)curIdx=i-1;}if(a==='down'&&i<pages.length-1){var t2=pages[i];pages[i]=pages[i+1];pages[i+1]=t2;if(curIdx===i)curIdx=i+1;}if(a==='del')pages.splice(i,1);renderBoard();};});}
  renderBdEditor();
}
if($('pgPrev'))$('pgPrev').onclick=function(){if(pages.length)curIdx=(curIdx-1+pages.length)%pages.length;renderBoard();};
if($('pgNext'))$('pgNext').onclick=function(){if(pages.length)curIdx=(curIdx+1)%pages.length;renderBoard();};
if($('addPage'))$('addPage').onclick=function(){pages.push({text:tr('newPageText')});curIdx=pages.length-1;renderBoard();};
if($('bdAdd'))$('bdAdd').onclick=function(){pages.push({text:tr('newPageText')});curIdx=pages.length-1;renderBoard();};
if($('bdSave'))$('bdSave').onclick=async function(){pages[curIdx].text=$('bdText').value;try{var r=await fetch('/api/config',{method:'POST',body:JSON.stringify({pages:pages})});var j=await r.json();if(!j.ok)alert(tr('saveFail'));}catch(e){alert(tr('saveFail'));}renderBoard();};
// ===== 公告板补接线(M-20260907-01 批 A) =====
function applyBdPrevWidth(){var w=$('bdWidth'),p=$('bdPrev');if(!w||!p)return;var n=Math.max(8,Math.min(144,Math.round(Number(w.value)||28)));w.value=n;p.style.width=n+'ch';p.style.maxWidth='100%';}
if($('boardEdit'))$('boardEdit').onclick=function(){var em=$('editMode');if(!em)return;var show=em.hidden;em.hidden=!show;this.classList.toggle('on',show);if(show)renderBoard();};
if($('bdVarBtn'))$('bdVarBtn').onclick=function(){var s=$('bdVar'),tx=$('bdText');if(!s||!tx)return;var v=s.value;var st=(tx.selectionStart==null)?tx.value.length:tx.selectionStart,en=(tx.selectionEnd==null)?st:tx.selectionEnd;tx.value=tx.value.slice(0,st)+v+tx.value.slice(en);tx.selectionStart=tx.selectionEnd=st+v.length;tx.focus();};
if($('bdDup'))$('bdDup').onclick=function(){if(!pages.length)return;pages.splice(curIdx+1,0,{text:String((pages[curIdx]||{}).text||'')});curIdx++;renderBoard();};
if($('bdDel'))$('bdDel').onclick=function(){if(!pages.length)return;if(!confirm(tr('delPageConfirm')))return;pages.splice(curIdx,1);if(curIdx>=pages.length)curIdx=Math.max(0,pages.length-1);renderBoard();};
if($('bdWidth'))$('bdWidth').onchange=applyBdPrevWidth;
if($('bdRot')){(async function(){try{var c=await (await fetch('/api/config')).json();var el=$('bdRot');if(el)el.value=Math.max(3,Math.round((Number(c.rotationMs)||8000)/1000));}catch(e){}})();$('bdRot').onchange=async function(){var s=Math.max(3,Math.round(Number(this.value)||8));this.value=s;try{await fetch('/api/config',{method:'POST',body:JSON.stringify({rotationMs:s*1000})});}catch(e){}};}
// ===== 批 A 补接线: 数据源 / 翻译 / 高级 / 日志(M-20260907-01) =====
var SRC_DEFAULT_PRIO={pages:5,hardware:10,media:30,livetranslate:40,ocrregion:45};
if($('prioReset'))$('prioReset').onclick=async function(){try{var s=await (await fetch('/api/status')).json();var arr=s.sources||[];for(var i=0;i<arr.length;i++){var d=SRC_DEFAULT_PRIO[arr[i].id];if(d!==undefined)await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:arr[i].id,priority:d})});}}catch(e){}try{pollStatus();}catch(e){}};
if($('ltCheckBtn'))$('ltCheckBtn').onclick=async function(){var st=$('ltStatus');try{var lt=await (await fetch('/api/ocrtl-lt')).json();if(st){st.textContent=lt.found?((lt.model||'LiveTranslate')+' → '+(lt.targetLang||'')):tr('ltNotFound');st.style.color=lt.found?'var(--ok)':'var(--warn)';}}catch(e){if(st){st.textContent=tr('ltNotFound');st.style.color='var(--warn)';}}};
if($('ltDownloadBtn'))$('ltDownloadBtn').onclick=function(){window.open('https://space.bilibili.com/21426055/lists/7714676?type=season','_blank');};
if($('visSave'))$('visSave').onclick=async function(){try{var body={apiBase:(($('transApiBase')||{}).value||'').trim(),model:(($('transApiModel')||{}).value||'').trim()};var k=(($('transApiKey')||{}).value||'').trim();if(k)body.apiKey=k;var j=await (await fetch('/api/ocrtl-vision',{method:'POST',body:JSON.stringify(body)})).json();alert(j&&j.ok?tr('visSaved'):(tr('visSaveFail')+((j&&j.error)||'')));}catch(e){alert(tr('visSaveFail')+e.message);}};
if($('btnShot'))$('btnShot').onclick=async function(){try{var j=await (await fetch('/api/ocrtl',{method:'POST',body:'{}'})).json();alert(j&&j.ok?tr('ocrRunning'):tr('triggerFail'));}catch(e){alert(tr('triggerFail'));}};
if($('transRegion')){(async function(){try{var c=await (await fetch('/api/config')).json();var md=((c.ocrtl||{}).capture||{}).mode||'window';var v={window:0,region:1,screen:2}[md];var s=$('transRegion');if(s&&v!==undefined)s.selectedIndex=v;}catch(e){}})();$('transRegion').onchange=async function(){var md=['window','region','screen'][this.selectedIndex]||'window';try{await fetch('/api/capture/set',{method:'POST',body:JSON.stringify({mode:md})});}catch(e){}};}
if($('capFullBtn'))$('capFullBtn').onclick=async function(){try{await fetch('/api/capture/set',{method:'POST',body:JSON.stringify({mode:'screen'})});var s=$('transRegion');if(s)s.selectedIndex=2;}catch(e){}};
if($('capAdjBtn'))$('capAdjBtn').onclick=function(){window.open('/api/capture/preview','_blank');};
if($('ocrDelay')){(async function(){try{var c=await (await fetch('/api/config')).json();var o=c.ocrtl||{};if($('ocrDelay'))$('ocrDelay').value=Math.round((Number(o.delayMs)||5000)/1000);if($('ocrDisplay'))$('ocrDisplay').value=Math.round((Number(o.eachMs)||8000)/1000);if($('ocrLoops'))$('ocrLoops').value=Number(o.loops)||2;}catch(e){}})();}
if($('expCfg'))$('expCfg').onclick=async function(){try{var r=await fetch('/api/config/export');if(r.status===403){alert(tr('needL1'));return;}var j=await r.json();if(!j||!j.ok){alert(tr('saveFail'));return;}var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(j.config,null,2)],{type:'application/json'}));a.download=j.filename||'config.json';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);if(a.parentNode)a.parentNode.removeChild(a);},1500);}catch(e){alert(tr('saveFail'));}};
if($('impCfg'))$('impCfg').onclick=function(){var f=document.createElement('input');f.type='file';f.accept='.json';f.onchange=function(){var file=f.files&&f.files[0];if(!file)return;var rd=new FileReader();rd.onload=async function(){try{var j=await (await fetch('/api/config/import',{method:'POST',body:String(rd.result)})).json();alert(j&&j.ok?tr('cfgImportOk'):(tr('cfgImportFail')+((j&&j.error)||'')));}catch(e){alert(tr('cfgImportBad'));}};rd.readAsText(file);};f.click();};
if($('webSave'))$('webSave').onclick=async function(){var v=Number(($('webPort')||{}).value);if(!v){alert(tr('saveFail'));return;}try{var j=await (await fetch('/api/ports/web',{method:'POST',body:JSON.stringify({port:v})})).json();if(!j||!j.ok){alert(tr('saveFail')+((j&&j.error)||''));return;}await fetch('/api/desktop/restart',{method:'POST',body:'{}'});}catch(e){alert(tr('saveFail'));}};
if($('portsCheckBtn'))$('portsCheckBtn').onclick=async function(){var out=$('portsOut');if(out)out.textContent='…';try{var j=await (await fetch('/api/ports/check')).json();var s='';var u=j.udp9000||{};if(u.occupied===false)s=tr('portsUdpFree');else if(u.occupied===true){var nm=String(u.name||('PID '+(u.pid||'?')));s=nm.toLowerCase().indexOf('vrchat')>=0?tr('portsUdpOk'):(tr('portsUdpBusy')+nm);}else s=tr('portsUdpUnknown');if(j.vrc){s+='\n'+(j.vrc.running?(j.vrc.oscEnabled?(tr('portsVrcOn')+(j.vrc.oscPort||'?')):tr('portsVrcOff')):tr('portsVrcStop'));}var actual=19190;try{var pj=await (await fetch('/api/ports')).json();actual=(pj.web||{}).actual||19190;}catch(e){}var busy=(j.tcpAround||[]).filter(function(x){return x.port!==actual;});if(busy.length)s+='\n'+tr('portsTcpBusy')+busy.map(function(x){return x.port+'('+x.name+')';}).join(' ');if(out)out.textContent=s;}catch(e){if(out)out.textContent=tr('portsCheckErr')+e.message;}};
if($('logCopy'))$('logCopy').onclick=async function(){var el=$('logView');var txt=el?el.textContent:'';try{await navigator.clipboard.writeText(txt);alert(tr('healthCopied'));}catch(e){try{var ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();alert(tr('healthCopied'));}catch(e2){}}};
var logAutoIv=null;
if($('logAuto'))$('logAuto').onchange=function(){if(this.checked){if(logAutoIv)clearInterval(logAutoIv);logAutoIv=setInterval(loadLogs,3000);}else{if(logAutoIv)clearInterval(logAutoIv);logAutoIv=null;}};
if($('dC'))$('dC').onclick=function(){var dr=$('drawer'),sc=$('scrim');if(dr)dr.classList.remove('open');if(sc)sc.classList.remove('on');};
// ===== 批 B 补缺失面板(M-20260907-01) =====
var capDrag=null,capRatio=1;
function capLoad(){var img=$('capImg'),rect=$('capRect'),sel=$('capSel');if(!img)return;if(rect)rect.style.display='none';if(sel)sel.textContent='';img.onload=function(){capRatio=img.naturalWidth/img.getBoundingClientRect().width;if(sel)sel.textContent='('+img.naturalWidth+'×'+img.naturalHeight+'px)';};img.onerror=function(){if(sel)sel.textContent=tr('loadFail');};img.src='/api/capture/preview?t='+Date.now();}
if($('capAdjBtn'))$('capAdjBtn').onclick=function(){var ov=$('capOverlay');if(!ov)return;ov.style.display='flex';capLoad();};
if($('capRefresh'))$('capRefresh').onclick=capLoad;
if($('capCancel'))$('capCancel').onclick=function(){var ov=$('capOverlay');if(ov)ov.style.display='none';};
if($('capSave'))$('capSave').onclick=async function(){var el=$('capRect'),sel=$('capSel');if(!el||!el.style.width||el.style.display==='none'){if(sel)sel.textContent=tr('capHint');return;}var x=Math.round(parseFloat(el.style.left)*capRatio),y=Math.round(parseFloat(el.style.top)*capRatio),w=Math.round(parseFloat(el.style.width)*capRatio),h=Math.round(parseFloat(el.style.height)*capRatio);try{var j=await (await fetch('/api/capture/set',{method:'POST',body:JSON.stringify({mode:'region',region:{x:x,y:y,w:w,h:h}})})).json();if(j&&j.ok){var s=$('transRegion');if(s)s.selectedIndex=1;if(sel)sel.textContent=tr('capSaved');setTimeout(function(){var ov=$('capOverlay');if(ov)ov.style.display='none';},700);}}catch(e){}};
(function(){var img=$('capImg');if(!img)return;img.addEventListener('mousedown',function(e){e.preventDefault();var r=img.getBoundingClientRect();capDrag={sx:(e.clientX-r.left),sy:(e.clientY-r.top)};});img.addEventListener('mousemove',function(e){if(!capDrag)return;var r=img.getBoundingClientRect();var cx=Math.min(Math.max(e.clientX-r.left,0),r.width),cy=Math.min(Math.max(e.clientY-r.top,0),r.height);var left=Math.min(capDrag.sx,cx),top=Math.min(capDrag.sy,cy),el=$('capRect');if(!el)return;el.style.left=left+'px';el.style.top=top+'px';el.style.width=Math.abs(cx-capDrag.sx)+'px';el.style.height=Math.abs(cy-capDrag.sy)+'px';el.style.display='block';var sel=$('capSel');if(sel)sel.textContent=Math.round(left*capRatio)+','+Math.round(top*capRatio)+' '+Math.round(Math.abs(cx-capDrag.sx)*capRatio)+'×'+Math.round(Math.abs(cy-capDrag.sy)*capRatio);});window.addEventListener('mouseup',function(){capDrag=null;});})();
if($('plgImport'))$('plgImport').onclick=async function(){var f=$('plgZip'),m=$('plgMsg');var path=f?(f.value||'').trim():'';if(!path){alert(tr('importNeedPath'));return;}try{var j=await (await fetch('/api/plugins/import',{method:'POST',body:JSON.stringify({path:path})})).json();if(m)m.textContent=(j&&j.ok)?(tr('importOk')+(j.id||path)+tr('importOk2')):(tr('importFail')+((j&&j.error)||''));if(j&&j.ok){if(f)f.value='';setTimeout(loadPlugins,800);}}catch(e){if(m)m.textContent=tr('importFail')+e.message;}};
if($('plgRefresh'))$('plgRefresh').onclick=function(){loadPlugins();};
if($('plgPrioReset'))$('plgPrioReset').onclick=async function(){try{var l=await (await fetch('/api/plugins')).json();var arr=Array.isArray(l)?l:(l.plugins||l.entries||[]);for(var i=0;i<arr.length;i++){await fetch('/api/plugins/config',{method:'POST',body:JSON.stringify({id:arr[i].id,cfg:{priority:null}})});}}catch(e){}loadPlugins();};
(function(){fetch('/api/version').then(function(r){return r.json();}).then(function(j){var v=$('ver');if(v)v.textContent=tr('verLine')+(j.version||'')+tr('codeName');}).catch(function(){});
  fetch('/api/version/check').then(function(r){return r.json();}).then(function(j){var uh=$('updateHint');if(!uh||!j||!j.newer)return;var url=(j.remote&&j.remote.releaseUrl)||'#';var ver=(j.remote&&j.remote.version)||'';uh.innerHTML='<a href="'+url+'" target="_blank" rel="noopener" style="color:var(--accent)">'+tr('updateNew').replace('{ver}',ver).replace('{name}','')+'</a>';}).catch(function(){});})();
if($('healthCopy'))$('healthCopy').onclick=async function(){try{var j=await (await fetch('/api/ports/check')).json();await navigator.clipboard.writeText(JSON.stringify(j,null,2));alert(tr('healthCopied'));}catch(e){}};
if($('diagCopy'))$('diagCopy').onclick=async function(){var out=$('diagOut'),txt=out?out.textContent:'';try{await navigator.clipboard.writeText(txt);alert(tr('healthCopied'));}catch(e){}};
if($('logErrOnly'))$('logErrOnly').onchange=loadLogs;
function bdSetCompact(on){var l=$('bdList'),e=$('edlist');if(l)l.classList.toggle('compact',!!on);if(e)e.classList.toggle('compact',!!on);}
if($('collapseAll'))$('collapseAll').onclick=function(){bdSetCompact(true);};
if($('expandAll'))$('expandAll').onclick=function(){bdSetCompact(false);};
// ===== 插件卡片 =====
function plgName(p){var M={'friend-welcome':'plgNameFriendWelcome','scheduled-board':'plgNameScheduled','weather-board':'plgNameWeather','netease-lyrics':'plgNameNetease'};return M[p.id]?tr(M[p.id]):(p.name||p.id);}var plgArr=[];
function plgPermsDesc(p){var ps=p.permissions||{};var parts=[];if(ps.network)parts.push(tr('permNetShort')+(ps.network==='whitelist'?('('+tr('polWhitelistShort')+')'):''));if(ps.process)parts.push(tr('permProcShort'));if(ps.writeFile)parts.push(tr('permWriteShort'));if(ps.readFile)parts.push(tr('permReadShort'));if(ps.ai)parts.push(tr('plgAiShort'));return parts.length?parts.join(' · '):tr('plgNone');}
function plgPermsHtml(p){var ps=p.permissions||{};var fs=ps.filesystem||{};var rd=Array.isArray(fs.read)?fs.read:[];var wr=Array.isArray(fs.write)?fs.write:[];var net=Array.isArray(ps.network)?ps.network:[];var ports=Array.isArray(ps.ports)?ps.ports:[];var out=[];function item(label,scope,cons,high){out.push('<div style="margin:2px 0"><b'+(high?' style="color:var(--err)"':'')+'>· '+label+'</b>: '+scope+'<br><span style="font-size:12px;'+(high?'color:var(--warn);font-weight:700':'color:var(--muted)')+'">　'+tr('plgConsOver')+': '+cons+'</span></div>');}item(tr('permNetShort'),net.length?(tr('plgOnlyAllow')+' '+net.join(', ')):tr('plgNoNet'),tr('plgNetCons'),false);if(rd.length||wr.length)item(tr('plgFile'),(rd.length?(tr('plgReadPrefix')+rd.join(', ')+']'):tr('plgUnreadable'))+(wr.length?(' · '+tr('plgWritePrefix')+wr.join(', ')+']'):(' · '+tr('plgUnwritable'))),tr('plgFileCons'),!!wr.length);else item(tr('plgFile'),tr('plgFileSelf'),tr('plgFileSelfCons'),false);if(ps.process)item(tr('permProcShort'),tr('plgProcScope'),tr('plgProcCons'),true);if(ports.length)item(tr('plgPort'),ports.join(', '),tr('plgPortCons'),false);if(ps.ai)item(tr('plgAiShort'),tr('plgAiScope'),tr('plgAiCons'),true);return out.join('');}
function plgToggle(url,id){return fetch(url,{method:'POST',body:JSON.stringify({id:id})}).then(function(r){return r.json();}).then(function(j){if(j&&j.ok===false){alert(tr('opFail')+': '+(j.error||''));}setTimeout(loadPlugins,600);});}
function plgWarn(p,onOk){var m=$('plgModal');if(!m){onOk();return;}var hr=!!(p.permissions&&(p.permissions.process||(p.permissions.ai&&p.permissions.ai.tasks&&p.permissions.ai.tasks.length)));m.style.display='flex';$('plgModalTitle').textContent=tr('plgModalTitle');$('plgWarnText').innerHTML='<b>'+esc(plgName(p))+'</b> v'+esc(p.version||'')+(p.author?(' · '+esc(p.author)):'')+'<br><span style="color:var(--muted)">'+esc(p.description||'')+'</span><br><br><b>'+tr('plgReqPerms')+':</b><br>'+plgPermsHtml(p)+'<br><br><b>'+tr('plgNote')+':</b> '+tr('plgWarnNote');var row=$('plgTypeRow');if(row)row.style.display=hr?'flex':'none';var ti=$('plgTypeName');if(ti){ti.value='';if(hr)ti.placeholder=tr('plgTypePh');}var rn=$('plgRiskNote');if(rn)rn.textContent='';$('plgCancel').textContent=tr('cancel');$('plgCancel').className='gray';var n=5;var btn=$('plgConfirm');btn.disabled=true;btn.textContent=tr('plgConfirmCountdown').replace('{n}',n);if(window._plgIv)clearInterval(window._plgIv);window._plgIv=setInterval(function(){n--;if(n<=0){clearInterval(window._plgIv);btn.disabled=false;btn.textContent=tr('plgConfirmText');}else{btn.textContent=tr('plgConfirmCountdown').replace('{n}',n);}},1000);btn.onclick=function(){if(btn.disabled)return;if(hr){var tv=($('plgTypeName')||{}).value||'';if(String(tv).trim()!==p.id){var rn2=$('plgRiskNote');if(rn2)rn2.textContent='⚠ '+tr('plgTypeBad');return;}}m.style.display='none';onOk();};$('plgCancel').onclick=function(){m.style.display='none';clearInterval(window._plgIv);};}
function plgCard(p){var en=!!(p.enabled||p.run),ap=!!p.approved;var d=document.createElement('div');d.className='plgcard';
 d.innerHTML='<div class="plgcard-head"><b class="plgcard-name">'+esc(plgName(p))+'</b><span class="tag">v'+(p.version||'')+'</span><span class="plgstat">'+(ap?'<span class="pill ok">'+tr('stApproved')+'</span>':'<span class="pill warn">'+tr('stUnapproved')+'</span>')+(en?'<span class="pill ok">'+tr('stEnabled')+'</span>':'<span class="pill gray">'+tr('stDisabled')+'</span>')+'</span><span class="plgcard-ctrl"><span class="sw'+(en?' on':'')+'" data-en="'+esc(p.id)+'"></span><button class="small gray" data-set="'+esc(p.id)+'">'+tr('btnSettings')+'</button></span></div><div class="plgcard-desc">'+esc(p.description||tr('plgNoDesc'))+'</div><div class="plgcard-meta">'+esc(p.id||'')+' · '+tr('plgPerms')+': '+esc(plgPermsDesc(p))+(p.error?(' · <span style="color:var(--err)">⚠ '+esc(p.error)+'</span>'):'')+((p.conflicts&&p.conflicts.length)?(' · <span style="color:var(--warn)">⚠ '+tr('plgConflict')+': '+esc(p.conflicts.map(function(c){return c.with;}).join(', '))+'</span>'):'')+'</div><div class="plgcard-body" style="display:none"></div>';
 d.querySelector('[data-en]').onclick=function(){var sw=this;var doEnable=function(){sw.classList.add('on');fetch('/api/plugins/approve',{method:'POST',body:JSON.stringify({id:p.id})}).then(function(r){return r.json();}).then(function(j){if(j&&j.ok===false){alert(tr('opFail')+': '+(j.error||''));return;}plgToggle('/api/plugins/enable',p.id);});};if(!ap){plgWarn(p,doEnable);}else{var wantOn=!sw.classList.contains('on');sw.classList.toggle('on',wantOn);var url=wantOn?'/api/plugins/enable':'/api/plugins/disable';plgToggle(url,p.id);}};
 d.querySelector('[data-set]').onclick=function(){var body=d.querySelector('.plgcard-body');if(body.style.display==='none'){body.style.display='block';loadPlgSettings(p,body);}else{body.style.display='none';}};
 return d;}
function renderPlgCards(){var el=$('plugCards');if(!el)return;el.innerHTML='';if(!plgArr.length){el.innerHTML='<div class="sub">'+tr('plgNoPlugins')+'</div>';return;}plgArr.forEach(function(p){el.appendChild(plgCard(p));});}
async function loadPlugins(){try{var r=await fetch('/api/plugins');var list=await r.json();plgArr=Array.isArray(list)?list:(list.plugins||list.entries||[]);renderPlgCards();if(typeof syncQuickPlg==='function')syncQuickPlg();}catch(e){}}
function loadPlgSettings(p,body){if(!(p.enabled||p.run)){body.innerHTML='<div class="sub" style="margin:8px 0;color:var(--warn)">'+tr('plgNotEnabled')+'</div>';return;}if(!p.approved){body.innerHTML='<div class="sub" style="margin:8px 0;color:var(--warn)">'+tr('plgNotApproved')+'</div>';return;}body.innerHTML='<div class="sub" style="margin:8px 0">'+tr('plgLoading')+'</div>';var fn=window['__plgset_'+String(p.id||'').replace(/-/g,'_')];if(typeof fn==='function'){fn(p,body);}else{body.innerHTML='<div class="sub" style="margin:8px 0">'+tr('plgPerms')+': '+esc(plgPermsDesc(p))+'</div><div class="sub">'+tr('plgSettingsPending')+'</div>';}}
// ===== 数据源/状态 =====
function NM(id){return ({hardware:'srcHW',media:'srcMedia',pages:'srcPages',livetranslate:'srcLive',ocrregion:'srcOcr'})[id]||id;}
function DSC(id){return ({hardware:'srcHWd',media:'srcMediad',pages:'srcPagesd',livetranslate:'srcLived',ocrregion:'srcOcrd'})[id]||'';}
function srcTok(td,x){var sw=document.createElement('div');sw.className='sw'+(x.enabled?' on':'');sw.dataset.src=x.id;sw.onclick=async function(){sw.classList.toggle('on');try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:x.id,enabled:sw.classList.contains('on')})});}catch(e){}pollStatus();};td.appendChild(sw);}
function renderSrcTable(){var tb=$('srcRows');if(!tb)return;tb.innerHTML='';(window._srcs||[]).forEach(function(x){var tr=document.createElement('tr');var td1=document.createElement('td');srcTok(td1,x);var td2=document.createElement('td');td2.textContent=tr(NM(x.id));var td3=document.createElement('td');td3.textContent=tr(DSC(x.id));var td4=document.createElement('td');var pi=document.createElement('input');pi.type='number';pi.value=x.priority;pi.style.width='62px';pi.onchange=async function(){try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:x.id,priority:Number(pi.value)||0})});}catch(e){}pollStatus();};td4.appendChild(pi);tr.appendChild(td1);tr.appendChild(td2);tr.appendChild(td3);tr.appendChild(td4);tb.appendChild(tr);});}
function setDot(id,cls){var e=$(id);if(e)e.className='dot '+(cls||'');}
async function pollStatus(){try{
  var s=await (await fetch('/api/status')).json();var v=s.vrc||{};
  window._vrcRunning=!!(v.running&&v.oscEnabled);window._srcs=s.sources||[];renderSrcTable();
  document.querySelectorAll('.sw[data-src]').forEach(function(sw){var src=window._srcs.find(function(x){return x.id===sw.dataset.src;});if(src)sw.classList.toggle('on',!!src.enabled);});
  var ccur=$('curChat');if(ccur&&s.current&&s.current.text!=null)ccur.textContent=s.current.text;
  var hp=$('hpDot'),ht=$('hpText');var ok=v.running&&v.oscEnabled;if(hp&&ht){hp.className='dot '+(ok?'on':'warn');ht.textContent=ok?tr('hpNormal'):tr('hpCheck');}
  if(v.running&&v.oscEnabled){setDot('vrcDot','on');$('vrcText').textContent=tr('running');}else if(v.running){setDot('vrcDot','warn');$('vrcText').textContent=tr('vrcOscOff');}else{setDot('vrcDot','');$('vrcText').textContent=tr('notRunning');}
  setDot('oscDot',v.oscEnabled?'on':'');$('oscText').textContent=v.oscEnabled?tr('oscOn'):tr('oscOff');
  var pc=await (await fetch('/api/ports/check')).json();var u=pc.udp9000||{};
  if(u.occupied){var nm=u.name||'';var isV=nm.indexOf('VRChat')>=0;setDot('udpDot',isV?'on':'off');$('udpText').textContent=isV?tr('udpVrc'):(tr('udpBusy')+': '+nm);}else{setDot('udpDot','');$('udpText').textContent=tr('udpFree');}
}catch(e){}}
document.querySelectorAll('.sw[data-src]').forEach(function(sw){sw.addEventListener('click',async function(){sw.classList.toggle('on');try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:sw.dataset.src,enabled:sw.classList.contains('on')})});}catch(e){}pollStatus();});});
if($('diagBtn'))$('diagBtn').onclick=async function(){var out=$('diagOut'),cp=$('diagCopy');if(out){out.style.display='block';out.textContent='…';}try{var j=await (await fetch('/api/diagnose')).json();if(out)out.textContent=JSON.stringify(j,null,2);if(cp)cp.style.display='inline-block';}catch(e){if(out)out.textContent=tr('diagFail')+e.message;}};
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
  add(tr('envNode'),tr('envNodeUse'),tr('envNodeState')+((e.node||{}).version||''),true);
  var m=e.media||{},ins=e.install||{};
  if(m.ok)add(tr('envMedia'),tr('envMediaUse'),tr('envAvailable'),true);
  else if(ins.running)add(tr('envMedia'),tr('envMediaUse'),tr('envInstalling')+(ins.msg||''),false);
  else if((e.systemPython||{}).found)add(tr('envMedia'),tr('envMediaUse'),tr('envNeedWinsdk'),false,tr('envBtnWinsdk'),'winsdk');
  else add(tr('envMedia'),tr('envMediaUse'),tr('envMissing'),false,tr('envBtnPython'),'python');
  var lt=e.livetranslate||{};
  if(lt.found)add(tr('envLt'),tr('envLtUse'),tr('envLtOk')+(lt.model||''),true);
  else add(tr('envLt'),tr('envLtUse'),tr('envLtNone'),false);
  var em=$('envMsg');if(em)em.textContent=(ins.running||ins.ok===false)?(ins.msg||''):'';
  var st=$('ltStatus');if(st){st.textContent=lt.found?(tr('envLtConfigured')+' '+(lt.model||'')+' → '+(lt.targetLang||'')):tr('envLtNone');st.style.color=lt.found?'var(--ok)':'var(--warn)';}}
function envInstall(what){fetch('/api/env/install-'+what,{method:'POST',body:'{}'}).then(function(r){return r.json();}).then(function(j){if(j&&!j.ok&&j.error){var mm=$('envMsg');if(mm)mm.textContent=j.error;}}).catch(function(){});setTimeout(renderEnv,1500);}
async function loadTrans(){try{var c=await (await fetch('/api/config')).json();var o=c.ocrtl||{};var v=o.vision||{};if($('transMode'))$('transMode').value=o.mode||'auto';if($('transApiBase'))$('transApiBase').value=v.apiBase||'';if($('transApiModel'))$('transApiModel').value=v.model||'';if($('transApiKey')&&v.hasKey)$('transApiKey').placeholder='sk-••••••('+tr('envLtConfigured')+')';}catch(e){}}
if($('transVoice'))$('transVoice').onchange=async function(){try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:'livetranslate',enabled:this.checked})});}catch(e){}pollStatus();};
if($('transShot'))$('transShot').onclick=async function(){try{var r=await fetch('/api/ocrtl',{method:'POST',body:'{}'});var j=await r.json();alert(j.ok?tr('shotTriggered'):tr('triggerFail'));}catch(e){alert(tr('triggerFail'));}};
// 高级设置
if($('advAuto')){(async function(){try{var c=await (await fetch('/api/config')).json();$('advAuto').checked=!!c.autostart;}catch(e){}})();$('advAuto').onchange=async function(){try{await fetch('/api/autostart',{method:'POST',body:JSON.stringify({enabled:this.checked})});}catch(e){}};}
if($('advConsole')){(async function(){try{var c=await (await fetch('/api/config')).json();$('advConsole').checked=!((c.desktop||{}).showConsole===false);}catch(e){}})();$('advConsole').onchange=async function(){try{await fetch('/api/desktop/console',{method:'POST',body:JSON.stringify({show:this.checked})});}catch(e){}};}
if($('oscPort')){(async function(){try{var c2=await (await fetch('/api/config')).json();$('oscPort').value=(c2.osc&&c2.osc.port)||9000;}catch(e){}})();$('oscApply').onclick=async function(){try{await fetch('/api/ports/osc',{method:'POST',body:JSON.stringify({port:Number($('oscPort').value)||9000})});alert(tr('portApplied'));}catch(e){alert(tr('applyFail'));}};}
if($('devdocsBtn'))$('devdocsBtn').onclick=function(){fetch('/api/devdocs/open',{method:'POST',body:'{}'});};
if($('quitBtn'))$('quitBtn').onclick=function(){if(confirm(tr('quitConfirmShort')))fetch('/api/desktop/quit',{method:'POST',body:'{}'});};
if($('restartBtn'))$('restartBtn').onclick=function(){if(confirm(tr('restartConfirmShort')))fetch('/api/desktop/restart',{method:'POST',body:'{}'});};
async function loadLogs(){try{var r=await fetch('/api/logs?tail=200');var j=await r.json();var arr=Array.isArray(j)?j:(j.lines||[]);var q=(($('logFilter')||{}).value||'');if(q)arr=arr.filter(function(l){return String(l).indexOf(q)>=0;});var eo=$('logErrOnly');if(eo&&eo.checked)arr=arr.filter(function(l){return /\[(WARN|ERROR|ERR)\]/i.test(String(l));});var el=$('logView');if(el)el.textContent=arr.join('\n')||tr('noLog');}catch(e){}}
if($('logRefresh'))$('logRefresh').onclick=loadLogs;if($('logFilter'))$('logFilter').addEventListener('input',loadLogs);
if($('oscTest'))$('oscTest').onclick=async function(){try{var s=await (await fetch('/api/status')).json();var v=s.vrc||{};var pc=await (await fetch('/api/ports/check')).json();var u=pc.udp9000||{};var m=tr('oscTestPrefix')+new Date().toLocaleTimeString();var sr=await fetch('/v1/chatbox',{method:'POST',body:JSON.stringify({text:m})});var sj=await sr.json();alert('VRChat: '+(v.running?tr('running'):tr('notRunning'))+'\nOSC: '+(v.oscEnabled?tr('oscOn'):tr('oscOff'))+'\nUDP 9000: '+(u.occupied?((u.name||'').indexOf('VRChat')>=0?tr('udpVrc'):tr('udpBusy')+': '+(u.name||u.pid)):tr('udpFree'))+'\n'+tr('oscTestMsg')+': '+(sj.ok?(tr('sent')+'「'+m+'」'):(tr('sendFailShort')+': '+(sj.error||''))));}catch(e){alert(tr('testError'));}};
// 动效
function applyAnim(){var off=localStorage.getItem('vrcbAnimMaster')==='1'||(localStorage.getItem('vrcbAnimAutoOff')==='1'&&!!window._vrcRunning);document.body.classList.toggle('no-anim',off);if(!off&&window.__fxRestart)window.__fxRestart();}
if($('animTop')){$('animTop').onclick=function(){var off=!document.body.classList.contains('no-anim');document.body.classList.toggle('no-anim',off);localStorage.setItem('vrcbAnimMaster',off?'1':'0');$('animTop').classList.toggle('on',!off);};$('animTop').classList.toggle('on',localStorage.getItem('vrcbAnimMaster')!=='1');}
if($('animTgl')){$('animTgl').onclick=function(){var on=this.classList.contains('on');this.classList.toggle('on',!on);localStorage.setItem('vrcbAnimAutoOff',on?'0':'1');applyAnim();};$('animTgl').classList.toggle('on',localStorage.getItem('vrcbAnimAutoOff')==='1');}
function starryBoot(){
  var st=document.createElement('style');st.textContent='.pl{position:absolute;left:16%;top:50%;transform:translateY(-50%);height:3px;width:0;background:linear-gradient(90deg,#7c5cf6,#c4b5fd,#7c5cf6);border-radius:2px;box-shadow:0 0 18px #7c5cf6aa;z-index:5}.plogo{position:absolute;left:0;right:0;bottom:50%;height:30%;display:flex;align-items:flex-end;justify-content:center;transform-origin:50% 100%;transform:scaleY(0);z-index:4}.plogo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.plogo .pnew{visibility:hidden;z-index:1}.plogo .pold{z-index:2}.pwipe{position:absolute;top:-12%;bottom:-12%;left:0;width:80px;transform:skewX(-14deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),rgba(167,139,250,.42),transparent);mix-blend-mode:screen;z-index:3;opacity:0}.pword{position:absolute;left:0;right:0;top:50%;width:44%;margin:0 auto;transform-origin:50% 0%;transform:scaleY(0)}.pword img{width:100%;display:block}.ptag{position:absolute;left:0;right:0;bottom:13%;text-align:center;font-size:16px;color:#c4b5fd;opacity:0;letter-spacing:1px}';document.head.appendChild(st);
  var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;z-index:9999;pointer-events:none;background:radial-gradient(110% 110% at 50% 32%, #7c5cf62e 0%, #0b0e13 72%)';
  ov.innerHTML='<div class="pl"></div><div class="plogo"><img class="pnew" src="/starry-new.png"><img class="pold" src="/starry-old.png"><div class="pwipe"></div></div><div class="pword"><img src="/starry-wordmark.png"></div><div class="ptag">'+tr('bootStarryTag')+'</div>';
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
  ov.innerHTML='<video src="'+vurl+'" autoplay playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"></video>'+(sv&&sv.title?('<div style="position:absolute;bottom:26px;left:0;right:0;text-align:center;color:rgba(255,255,255,.7);font-size:13px;letter-spacing:2px;pointer-events:none">'+tr('clickToSkip')+'</div>'):'');
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
 if(_r){simpleBoot(_r.c1,_r.c2,_r.greet,_r.deco,'VRCLiveBoard',tr('bootTagline'));return;}
 simpleBoot('#3b82f6','#7dd3fc','','✦','VRCLiveBoard',tr('bootTagline'));return;
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
      else if(c.type==='del'){var d=document.createElement('button');d.className='small danger';d.textContent=(window.UI_TXT&&window.UI_TXT.del)||tr('delBtn');d.dataset.i=i;d.onclick=function(){rows.splice(+this.dataset.i,1);render();};td.appendChild(d);}
      tr.appendChild(td);});
    tb.appendChild(tr);});
}
function plugCall(id,method,args){return fetch('/api/plugins/call',{method:'POST',body:JSON.stringify({id:id,method:method,args:args||{}})}).then(function(r){return r.json();});}
function xlsxReady(id,cb){if(window.XLSX)return cb();var s=document.createElement('script');s.src='/api/plugins/asset?id='+id+'&file=vendor/xlsx.full.min.js';s.onload=function(){cb();};s.onerror=function(){};document.head.appendChild(s);}
function exportAoa(id,sheet,aoa,fn){xlsxReady(id,function(){if(!window.XLSX)return;var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),sheet);XLSX.writeFile(wb,fn);});}
// 好友欢迎
window.__plgset_friend_welcome=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">'+tr('fwTitle')+'</div><table><thead><tr><th>'+tr('fwThName')+'</th><th>'+tr('fwThLines')+'</th><th>'+tr('fwThLoops')+'</th><th>'+tr('fwThSec')+'</th><th>'+tr('fwThEnable')+'</th><th></th></tr></thead><tbody class="fwTb"></tbody></table><div class="row" style="margin-top:8px"><button class="small gray" data-fwadd>'+tr('btnAdd')+'</button><button class="small" data-fwsave>'+tr('btnSave')+'</button><button class="small gray" data-fwexp>'+tr('fwExp')+'</button><button class="small gray" data-fwimp>'+tr('fwImp')+'</button><input type="file" accept=".xlsx" class="fwFile" style="display:none"><span class="sub" data-fwmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-fwmsg]');
  function render(){tblRows(body,'.fwTb',[{type:'text',k:'name'},{type:'text',k:'lines'},{type:'num',k:'loops',def:2},{type:'num',k:'eachSec',def:6},{type:'chk',k:'enabled'},{type:'del'}],rows,{});}
  body.querySelector('[data-fwadd]').onclick=function(){rows.push({name:'',lines:tr('fwWelcomeDefault'),loops:2,eachSec:6,enabled:true});render();};
  body.querySelector('[data-fwsave]').onclick=function(){var rows2=rows.map(function(x){return [x.name||'',x.lines||'',Number(x.loops)||2,Number(x.eachSec)||6,x.enabled!==false];});plugCall('friend-welcome','saveRows',{rows:rows2}).then(function(j){msg.textContent=j&&j.ok?(tr('fwSaved').replace('{n}',(j.count||rows2.length))):(tr('failed')+': '+(j&&j.error||''));});};body.querySelector('[data-fwexp]').onclick=function(){exportAoa('friend-welcome',tr('fwTitle'),[[tr('fwThName'),tr('fwThLines'),tr('fwThLoops'),tr('fwThSec'),tr('fwThEnable')]].concat(rows.map(function(x){return [x.name||'',x.lines||'',x.loops||2,x.eachSec||6,x.enabled!==false?'':'否'];})),'好友欢迎名单.xlsx');};body.querySelector('[data-fwimp]').onclick=function(){body.querySelector('.fwFile').click();};body.querySelector('.fwFile').onchange=function(ev){var f=ev.target.files&&ev.target.files[0];if(!f)return;xlsxReady('friend-welcome',function(){var rd=new FileReader();rd.onload=function(e){try{var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});var sh=wb.Sheets[wb.SheetNames[0]];var aoa=XLSX.utils.sheet_to_json(sh,{header:1});plugCall('friend-welcome','importRows',{rows:aoa}).then(function(j){msg.textContent=j&&j.ok?(tr('fwImported').replace('{n}',(j.count||0))):(tr('fwImportFail')+': '+(j&&j.error||''));plugCall('friend-welcome','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});}catch(err){msg.textContent=tr('fwImportFail')+': '+err.message;}};rd.readAsArrayBuffer(f);});};
  plugCall('friend-welcome','getRows',{}).then(function(j){rows=Array.isArray(j)?j:((j&&j.rows)||[]);render();});
};
// 定时公告
window.__plgset_scheduled_board=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">'+tr('sbTitle')+'</div><div class="sub">'+tr('sbRegular')+'</div><textarea class="sbItems" rows="3" style="width:100%"></textarea>'
    +'<div class="row" style="margin:8px 0"><label class="sub"><input type="number" class="sbInterval" value="30" style="width:64px"> '+tr('sbMinutes')+'</label><label class="sub"><input type="checkbox" class="sbOnHour"> '+tr('sbOnHour')+'</label><label class="sub"><input type="checkbox" class="sbOnHalf"> '+tr('sbOnHalf')+'</label><label class="sub"><input type="checkbox" class="sbHourIntr"> '+tr('sbHourIntr')+'</label></div>'
    +'<div class="sub">'+tr('sbHourly')+'</div><input type="text" class="sbHourly" style="width:100%">'
    +'<div class="sub" style="margin:8px 0 4px">'+tr('sbSpecial')+'</div><table><thead><tr><th>'+tr('sbThAt')+'</th><th>'+tr('sbThContent')+'</th><th>'+tr('sbThInterrupt')+'</th><th></th></tr></thead><tbody class="sbTb"></tbody></table>'
    +'<div class="row" style="margin-top:8px"><button class="small gray" data-sbadd>'+tr('btnAdd')+'</button><button class="small" data-sbsave>'+tr('btnSave')+'</button><button class="small gray" data-sbtest>'+tr('sbTest')+'</button><button class="small gray" data-sbexp>'+tr('sbExp')+'</button><button class="small gray" data-sbimp>'+tr('sbImp')+'</button><input type="file" accept=".xlsx" class="sbFile" style="display:none"><span class="sub" data-sbmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-sbmsg]');
  function render(){tblRows(body,'.sbTb',[{type:'text',k:'at'},{type:'text',k:'text'},{type:'chk',k:'interrupt'},{type:'del'}],rows,{});}
  body.querySelector('[data-sbadd]').onclick=function(){rows.push({at:'',text:'',interrupt:false});render();};
  body.querySelector('[data-sbsave]').onclick=function(){var args={items:body.querySelector('.sbItems').value.split('\n'),intervalMin:Number(body.querySelector('.sbInterval').value)||30,onHour:body.querySelector('.sbOnHour').checked,onHalf:body.querySelector('.sbOnHalf').checked,hourlyText:body.querySelector('.sbHourly').value.split('|'),interruptHourly:body.querySelector('.sbHourIntr').checked,specials:rows.map(function(x){return [x.at||'',x.text||'',x.interrupt?'':'否'];})};plugCall('scheduled-board','saveAll',args).then(function(j){msg.textContent=j&&j.ok?(tr('sbSaved').replace('{items}',(j.items||0)).replace('{specials}',(j.specials||0))):(tr('failed')+': '+(j&&j.error||''));}).catch(function(e){msg.textContent=tr('failed')+': '+e.message;});};
  body.querySelector('[data-sbtest]').onclick=function(){plugCall('scheduled-board','testFire',{type:'regular'}).then(function(j){msg.textContent=j&&j.ok?tr('sbFired'):tr('sbFireFail');});};body.querySelector('[data-sbexp]').onclick=function(){exportAoa('scheduled-board',tr('sbSpecial'),[[tr('sbThAt'),tr('sbThContent'),tr('sbThInterrupt')]].concat(rows.map(function(x){return [x.at||'',x.text||'',x.interrupt?'':'否'];})),'特殊公告.xlsx');};body.querySelector('[data-sbimp]').onclick=function(){body.querySelector('.sbFile').click();};body.querySelector('.sbFile').onchange=function(ev){var f=ev.target.files&&ev.target.files[0];if(!f)return;xlsxReady('scheduled-board',function(){var rd=new FileReader();rd.onload=function(e){try{var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});var sh=wb.Sheets[wb.SheetNames[0]];var aoa=XLSX.utils.sheet_to_json(sh,{header:1});plugCall('scheduled-board','importRows',{rows:aoa}).then(function(j){msg.textContent=j&&j.ok?(tr('sbImported').replace('{n}',(j.count||0))):(tr('fwImportFail')+': '+(j&&j.error||''));plugCall('scheduled-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});}catch(err){msg.textContent=tr('fwImportFail')+': '+err.message;}};rd.readAsArrayBuffer(f);});};
  plugCall('scheduled-board','status',{}).then(function(st){if(st&&st.ok){body.querySelector('.sbItems').value=(st.items||[]).join('\n');body.querySelector('.sbInterval').value=st.intervalMin||30;body.querySelector('.sbOnHour').checked=!!st.onHour;body.querySelector('.sbOnHalf').checked=!!st.onHalf;body.querySelector('.sbHourIntr').checked=!!st.interruptHourly;body.querySelector('.sbHourly').value=(st.hourlyText||[]).join('|');}});plugCall('scheduled-board','getRows',{}).then(function(j){rows=Array.isArray(j)?j:[];render();});
};
// 天气播报
window.__plgset_weather_board=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">'+tr('wxTitle')+'</div><div class="row" style="margin:0 0 8px"><label class="sub"><input type="number" class="wxInterval" value="15" style="width:60px"> '+tr('sbMinutes')+'</label><label class="sub"><input type="number" class="wxDisplay" value="60" style="width:60px"> '+tr('wxDisplaySec')+'</label><label class="sub"><input type="checkbox" class="wxContinuous"> '+tr('wxContinuous')+'</label><label class="sub">'+tr('wxPrefix')+' <input type="text" class="wxPrefix" value="【天气】"></label></div>'
    +'<table><thead><tr><th>'+tr('wxThCity')+'</th><th>'+tr('wxThEnable')+'</th><th></th><th></th></tr></thead><tbody class="wxTb"></tbody></table>'
    +'<div class="row" style="margin-top:8px"><button class="small gray" data-wxadd>'+tr('btnAdd')+'</button><button class="small gray" data-wxpreset>'+tr('wxPresetCn')+'</button><button class="small gray" data-wxpresetw>'+tr('wxPresetWorld')+'</button><button class="small" data-wxsave>'+tr('btnSave')+'</button><button class="small gray" data-wxexp>'+tr('wxExp')+'</button><span class="sub" data-wxmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-wxmsg]');
  function render(){tblRows(body,'.wxTb',[{type:'text',k:'name'},{type:'chk',k:'enabled'},{type:'btn',label:tr('btnTest'),act:'test',fn:function(i){plugCall('weather-board','testCity',{index:i}).then(function(j){msg.textContent=j&&j.ok?(tr('wxSent').replace('{text}',j.text)):tr('wxTestFail');});}},{type:'del'}],rows,{});}
  body.querySelector('[data-wxadd]').onclick=function(){rows.push({name:'',enabled:true});render();};
  body.querySelector('[data-wxpreset]').onclick=function(){plugCall('weather-board','addPresets',{kind:'cn'}).then(function(j){msg.textContent=j&&j.ok?(tr('wxAddedCn').replace('{n}',(j.added||0))):tr('failed');plugCall('weather-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});};body.querySelector('[data-wxpresetw]').onclick=function(){plugCall('weather-board','addPresets',{kind:'world'}).then(function(j){msg.textContent=j&&j.ok?(tr('wxAddedWorld').replace('{n}',(j.added||0))):tr('failed');plugCall('weather-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});};
  body.querySelector('[data-wxexp]').onclick=function(){exportAoa('weather-board',tr('wxTitle'),[[tr('wxThCity'),tr('wxThEnable')]].concat(rows.map(function(x){return [x.name||'',x.enabled?'':'否'];})),'天气城市.xlsx');};body.querySelector('[data-wxsave]').onclick=function(){var cfg={intervalMin:Number(body.querySelector('.wxInterval').value)||15,displaySec:Number(body.querySelector('.wxDisplay').value)||60,continuous:body.querySelector('.wxContinuous').checked,prefix:body.querySelector('.wxPrefix').value||'【天气】'};plugCall('weather-board','saveRows',{rows:rows.map(function(x){return [x.name||'',x.enabled?'':'否'];})}).then(function(j){if(!j||!j.ok){msg.textContent=tr('failed')+': '+(j&&j.error||'');return;}plugCall('weather-board','saveConfig',cfg).then(function(){msg.textContent=tr('wxSaved');});});};
  plugCall('weather-board','status',{}).then(function(st){if(st&&st.ok){body.querySelector('.wxInterval').value=st.intervalMin||15;body.querySelector('.wxDisplay').value=st.displaySec||60;body.querySelector('.wxContinuous').checked=!!st.continuous;body.querySelector('.wxPrefix').value=st.prefix!==undefined?st.prefix:'【天气】';}});plugCall('weather-board','getRows',{}).then(function(j){rows=Array.isArray(j)?j:[];render();});
};
// 网易云歌词
window.__plgset_netease_lyrics=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">'+tr('nlTitle')+'</div>'
    +'<div class="row" style="gap:8px;flex-wrap:wrap"><label class="sub"><input type="number" class="nlUpdate" value="4" style="width:56px"> '+tr('nlUpdateSec')+'</label><label class="sub"><input type="number" class="nlPrio" value="35" style="width:56px"> '+tr('nlPriority')+'</label><label class="sub"><input type="number" class="nlPort" value="9234" style="width:64px"> '+tr('nlCdpPort')+'</label></div>'
    +'<div class="row" style="gap:8px;flex-wrap:wrap;margin:6px 0"><label class="sub"><input type="checkbox" class="nlTrans" checked> '+tr('nlTrans')+'</label><label class="sub" title="'+tr('nlOtherTitle')+'"><input type="checkbox" class="nlOther"> '+tr('nlOther')+'</label><label class="sub"><input type="checkbox" class="nlRhythm"> '+tr('nlRhythm')+'</label><label class="sub"><input type="checkbox" class="nlTitle" checked> '+tr('nlTitleTop')+'</label></div>'
    +'<div class="sub">'+tr('nlExePath')+'</div><input type="text" class="nlExe" style="width:100%">'
    +'<div class="sub" style="margin:8px 0">'+tr('nlExeHint')+'</div>'
    +'<div class="row" style="margin-top:8px"><button class="small" data-nlsave>'+tr('btnSave')+'</button><button class="small gray" data-nltest>'+tr('btnTest')+'</button><button class="small gray" data-nlcdp>'+tr('nlCdpRestart')+'</button><span class="sub" data-nlmsg></span></div>';
  var msg=body.querySelector('[data-nlmsg]');
  function collect(){return {updateSec:Number(body.querySelector('.nlUpdate').value)||4,showTranslation:body.querySelector('.nlTrans').checked,allowOtherPlayers:body.querySelector('.nlOther').checked,rhythmMode:body.querySelector('.nlRhythm').checked,showTitle:body.querySelector('.nlTitle').checked,priority:Number(body.querySelector('.nlPrio').value)||35,cdpPort:Number(body.querySelector('.nlPort').value)||9234,cloudExe:body.querySelector('.nlExe').value.trim()};}
  body.querySelector('[data-nlsave]').onclick=function(){plugCall('netease-lyrics','saveConfig',collect()).then(function(j){msg.textContent=j&&j.ok?tr('wxSaved'):tr('failed')+': '+(j&&j.error||'');});};
  body.querySelector('[data-nltest]').onclick=function(){plugCall('netease-lyrics','testNow',{}).then(function(j){msg.textContent=j&&j.ok?(tr('wxSent').replace('{text}',j.text)):tr('wxTestFail');});};
  body.querySelector('[data-nlcdp]').onclick=function(){if(!confirm(tr('nlRestartConfirm')))return;plugCall('netease-lyrics','launchCdp',{}).then(function(j){msg.textContent=j&&j.ok?(j.note||tr('nlSuccess')):tr('failed')+': '+(j&&j.error||'');});};
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
function tr(k) { const d = T[lang] || T['zh-CN']; return (d[k] !== undefined) ? d[k] : (T['zh-CN'][k] !== undefined ? T['zh-CN'][k] : k); }
window.t = tr; // 兼容: index.html 内联块仍在用 window.t 取词(待内联块迁出后删除, 见 M-20260911-03)
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = tr(el.getAttribute('data-t')); });
  document.querySelectorAll('[data-t-ph]').forEach(function (el) { el.placeholder = tr(el.getAttribute('data-t-ph')); }); document.querySelectorAll('[data-tt]').forEach(function (el) { el.title = tr(el.getAttribute('data-tt')); }); try{buildBdVar();}catch(e){}
}
var VAR_LABELS={'{cpu_util}':'varCpuUtil','{cpu_temp}':'varCpuTemp','{gpu_util}':'varGpuUtil','{gpu_temp}':'varGpuTemp','{mem_used}':'varMemUsed','{mem_total}':'varMemTotal','{net_down}':'varNetDown','{net_up}':'varNetUp','{song}':'varSong','{artist}':'varArtist','{album}':'varAlbum','{date}':'varDate','{time}':'varTime'}; function buildBdVar(){var s=$('bdVar');if(!s)return;for(var i=0;i<s.options.length;i++){var o=s.options[i];var k=VAR_LABELS[o.value];if(k)o.textContent=o.value+' · '+tr(k);}} function reRenderAll(){try{applyLang();}catch(e){}try{renderBoard();}catch(e){}try{renderSrcTable();}catch(e){}try{renderEnv();}catch(e){}try{renderPlgCards();}catch(e){}try{pollStatus();}catch(e){}try{if(window.__reThemeLabels)window.__reThemeLabels();}catch(e){}} async function gateRender() {
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
  }).catch(function () {});
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
    .catch(function () {});
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
    .catch(function () {});
}
// 安全初始化(在 T/lang 声明后)
try{applyLang();}catch(e){}
try{gateRender();}catch(e){}
try{psLoad();}catch(e){}

// 语言切换
if($('langSel'))$('langSel').onchange=function(){lang=this.value;try{fetch('/api/lang',{method:'POST',body:JSON.stringify({lang:lang})});}catch(e){}reRenderAll();};

// 语言加载(读回保存的语言)
(async function(){try{var _c=await (await fetch('/api/config')).json();lang=(_c&&_c.lang)||'zh-CN';var _ls=$('langSel');if(_ls)_ls.value=lang;reRenderAll();}catch(e){}})();

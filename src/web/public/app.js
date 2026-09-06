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
if(box&&$('send')){$('send').onclick=async function(){var tx=box.value;if(!tx.trim())return;try{var r=await fetch('/v1/chatbox',{method:'POST',body:JSON.stringify({text:tx})});var j=await r.json();if(j.ok){if(cur)cur.textContent=tx;}else alert('发送失败: '+(j.error||''));}catch(e){}};
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
  var prev=$('bdPrev');if(prev)prev.textContent=pages[curIdx]?(pages[curIdx].text||'( 空白页 )'):'( 空白页 )';
}
function renderBoard(){
  var pt=$('pageText');if(pt&&pages.length)pt.textContent=pages[curIdx].text||'-';
  var bc=$('boardCount');if(bc)bc.textContent='共 '+pages.length+' 条';
  var pn=$('pgNum');if(pn)pn.textContent='第 '+(curIdx+1)+' / '+pages.length+' 页';
  var cn=$('bdCount');if(cn)cn.textContent=pages.length;
  var el=$('edlist');if(el){el.innerHTML='';
    pages.forEach(function(p,i){var d=document.createElement('div');d.className='edrow';
      d.innerHTML='<span class="drag">⠿</span><span class="mono">'+(i+1)+'</span><span class="snip">'+esc(fl(p.text))+'</span><span class="ops"><button class="small gray" data-a="up" data-i="'+i+'">↑</button><button class="small gray" data-a="down" data-i="'+i+'">↓</button><button class="small gray" data-a="del" data-i="'+i+'">删除</button></span>';
      el.appendChild(d);});
    el.querySelectorAll('button').forEach(function(b){b.onclick=function(){var a=b.dataset.a,i=+b.dataset.i;if(a==='up'&&i>0){var t=pages[i-1];pages[i-1]=pages[i];pages[i]=t;if(curIdx===i)curIdx=i-1;}if(a==='down'&&i<pages.length-1){var t2=pages[i];pages[i]=pages[i+1];pages[i+1]=t2;if(curIdx===i)curIdx=i+1;}if(a==='del')pages.splice(i,1);renderBoard();};});}
  renderBdEditor();
}
if($('pgPrev'))$('pgPrev').onclick=function(){if(pages.length)curIdx=(curIdx-1+pages.length)%pages.length;renderBoard();};
if($('pgNext'))$('pgNext').onclick=function(){if(pages.length)curIdx=(curIdx+1)%pages.length;renderBoard();};
if($('addPage'))$('addPage').onclick=function(){pages.push({text:'== 新页面 ==\n点这里编辑内容'});curIdx=pages.length-1;renderBoard();};
if($('bdAdd'))$('bdAdd').onclick=function(){pages.push({text:'== 新页面 ==\n点这里编辑内容'});curIdx=pages.length-1;renderBoard();};
if($('bdSave'))$('bdSave').onclick=async function(){pages[curIdx].text=$('bdText').value;try{var r=await fetch('/api/config',{method:'POST',body:JSON.stringify({pages:pages})});var j=await r.json();if(!j.ok)alert('保存失败');}catch(e){alert('保存失败');}renderBoard();};
// ===== 插件卡片 =====
var plgArr=[];
function plgPermsDesc(p){var ps=p.permissions||{};var parts=[];if(ps.network)parts.push('网络'+(ps.network==='whitelist'?'(白名单)':''));if(ps.process)parts.push('进程');if(ps.writeFile)parts.push('写文件');if(ps.readFile)parts.push('读文件');if(ps.ai)parts.push('AI');return parts.length?parts.join(' · '):'无';}
function plgPermsHtml(p){var ps=p.permissions||{};var fs=ps.filesystem||{};var rd=Array.isArray(fs.read)?fs.read:[];var wr=Array.isArray(fs.write)?fs.write:[];var net=Array.isArray(ps.network)?ps.network:[];var ports=Array.isArray(ps.ports)?ps.ports:[];var out=[];function item(label,scope,cons,high){out.push('<div style="margin:2px 0"><b'+(high?' style="color:var(--err)"':'')+'>· '+label+'</b>: '+scope+'<br><span style="font-size:12px;'+(high?'color:var(--warn);font-weight:700':'color:var(--muted)')+'">　越界后果: '+cons+'</span></div>');}item('网络',net.length?('仅允许 '+net.join(', ')):'不访问网络','可能把屏幕/聊天内容外传、下载并执行恶意文件',false);if(rd.length||wr.length)item('文件',(rd.length?('读 ['+rd.join(', ')+']'):'不可读')+(wr.length?(' · 写 ['+wr.join(', ')+']'):' · 不可写'),'读: 可能泄露私人文件(密码/聊天记录/密钥); 写: 可能篡改删除文件、写入后门',!!wr.length);else item('文件','仅可读写自身 data 目录','越权时可读写它处文件',false);if(ps.process)item('进程','可启动子进程','可能执行任意命令、控制整台电脑、装后门',true);if(ports.length)item('端口',ports.join(', '),'可能接受外部连接、建立隐蔽通道',false);if(ps.ai)item('AI','可调用 AI 网关','可能把屏幕/聊天内容发送给第三方(内容外泄)+ 产生调用费',true);return out.join('');}
function plgToggle(url,id){return fetch(url,{method:'POST',body:JSON.stringify({id:id})}).then(function(r){return r.json();}).then(function(j){if(j&&j.ok===false){alert('操作失败: '+(j.error||''));}setTimeout(loadPlugins,600);});}
function plgWarn(p,onOk){var m=$('plgModal');if(!m){onOk();return;}m.style.display='flex';$('plgModalTitle').textContent='插件安全警告';$('plgWarnText').innerHTML='<b>'+esc(p.name||p.id)+'</b> v'+esc(p.version||'')+(p.author?(' · '+esc(p.author)):'')+'<br><span style="color:var(--muted)">'+esc(p.description||'')+'</span><br><br><b>请求的权限:</b><br>'+plgPermsHtml(p)+'<br><br><b>说明:</b> 点击「批准并启用」后, 该插件将以上述权限运行; 点击「取消」则不启用。请确认插件来源可信、权限范围合理, 避免授权来历不明的插件读取数据或对外联网。';$('plgCancel').textContent='取消';$('plgCancel').className='gray';var n=5;var btn=$('plgConfirm');btn.disabled=true;btn.textContent='批准启用 ('+n+'s)';if(window._plgIv)clearInterval(window._plgIv);window._plgIv=setInterval(function(){n--;if(n<=0){clearInterval(window._plgIv);btn.disabled=false;btn.textContent='批准并启用';}else{btn.textContent='批准启用 ('+n+'s)';}},1000);btn.onclick=function(){if(btn.disabled)return;m.style.display='none';onOk();};$('plgCancel').onclick=function(){m.style.display='none';clearInterval(window._plgIv);};}
function plgCard(p){var en=!!(p.enabled||p.run),ap=!!p.approved;var d=document.createElement('div');d.className='plgcard';
 d.innerHTML='<div class="plgcard-head"><b class="plgcard-name">'+esc(p.name||p.id)+'</b><span class="tag">v'+(p.version||'')+'</span><span class="plgstat">'+(ap?'<span class="pill ok">已授权</span>':'<span class="pill warn">未授权</span>')+(en?'<span class="pill ok">已启用</span>':'<span class="pill gray">已停用</span>')+'</span><span class="plgcard-ctrl"><span class="sw'+(en?' on':'')+'" data-en="'+esc(p.id)+'"></span><button class="small gray" data-set="'+esc(p.id)+'">设置</button></span></div><div class="plgcard-desc">'+esc(p.description||'(无简介)')+'</div><div class="plgcard-meta">'+esc(p.id||'')+' · 权限: '+esc(plgPermsDesc(p))+(p.error?(' · <span style="color:var(--err)">⚠ '+esc(p.error)+'</span>'):'')+((p.conflicts&&p.conflicts.length)?(' · <span style="color:var(--warn)">⚠ 冲突: '+esc(p.conflicts.map(function(c){return c.with;}).join(', '))+'</span>'):'')+'</div><div class="plgcard-body" style="display:none"></div>';
 d.querySelector('[data-en]').onclick=function(){var sw=this;var doEnable=function(){sw.classList.add('on');plgToggle('/api/plugins/enable',p.id);};if(!ap){plgWarn(p,doEnable);}else{var wantOn=!sw.classList.contains('on');sw.classList.toggle('on',wantOn);var url=wantOn?'/api/plugins/enable':'/api/plugins/disable';plgToggle(url,p.id);}};
 d.querySelector('[data-set]').onclick=function(){var body=d.querySelector('.plgcard-body');if(body.style.display==='none'){body.style.display='block';loadPlgSettings(p,body);}else{body.style.display='none';}};
 return d;}
function renderPlgCards(){var el=$('plugCards');if(!el)return;el.innerHTML='';if(!plgArr.length){el.innerHTML='<div class="sub">未发现已安装插件(检查 plugins 目录, 或导入 zip)。</div>';return;}plgArr.forEach(function(p){el.appendChild(plgCard(p));});}
async function loadPlugins(){try{var r=await fetch('/api/plugins');var list=await r.json();plgArr=Array.isArray(list)?list:(list.plugins||list.entries||[]);renderPlgCards();if(typeof syncQuickPlg==='function')syncQuickPlg();}catch(e){}}
function loadPlgSettings(p,body){if(!(p.enabled||p.run)){body.innerHTML='<div class="sub" style="margin:8px 0;color:var(--warn)">该插件未启用 —— 请先打开开关, 再展开设置。</div>';return;}if(!p.approved){body.innerHTML='<div class="sub" style="margin:8px 0;color:var(--warn)">该插件未授权 —— 请先打开开关(会弹安全警告)完成授权。</div>';return;}body.innerHTML='<div class="sub" style="margin:8px 0">加载设置…</div>';var fn=window['__plgset_'+String(p.id||'').replace(/-/g,'_')];if(typeof fn==='function'){fn(p,body);}else{body.innerHTML='<div class="sub" style="margin:8px 0">权限: '+esc(plgPermsDesc(p))+'</div><div class="sub">该插件的完整设置表单正在接入(参考旧版对应面板)。</div>';}}
// ===== 数据源/状态 =====
var NM={hardware:'电脑状态',media:'媒体',pages:'公告板',livetranslate:'字幕',ocrregion:'OCR 截图'};
var DSC={hardware:'CPU/GPU/内存/网速',media:'正在播放(SMTC)',pages:'多页轮播',livetranslate:'LiveTranslate',ocrregion:'区域识别兜底'};
function srcTok(td,x){var sw=document.createElement('div');sw.className='sw'+(x.enabled?' on':'');sw.dataset.src=x.id;sw.onclick=async function(){sw.classList.toggle('on');try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:x.id,enabled:sw.classList.contains('on')})});}catch(e){}pollStatus();};td.appendChild(sw);}
function renderSrcTable(){var tb=$('srcRows');if(!tb)return;tb.innerHTML='';(window._srcs||[]).forEach(function(x){var tr=document.createElement('tr');var td1=document.createElement('td');srcTok(td1,x);var td2=document.createElement('td');td2.textContent=NM[x.id]||x.id;var td3=document.createElement('td');td3.textContent=DSC[x.id]||'';var td4=document.createElement('td');var pi=document.createElement('input');pi.type='number';pi.value=x.priority;pi.style.width='62px';pi.onchange=async function(){try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:x.id,priority:Number(pi.value)||0})});}catch(e){}pollStatus();};td4.appendChild(pi);tr.appendChild(td1);tr.appendChild(td2);tr.appendChild(td3);tr.appendChild(td4);tb.appendChild(tr);});}
function setDot(id,cls){var e=$(id);if(e)e.className='dot '+(cls||'');}
async function pollStatus(){try{
  var s=await (await fetch('/api/status')).json();var v=s.vrc||{};
  window._vrcRunning=!!(v.running&&v.oscEnabled);window._srcs=s.sources||[];renderSrcTable();
  document.querySelectorAll('.sw[data-src]').forEach(function(sw){var src=window._srcs.find(function(x){return x.id===sw.dataset.src;});if(src)sw.classList.toggle('on',!!src.enabled);});
  var ccur=$('curChat');if(ccur&&s.current&&s.current.text!=null)ccur.textContent=s.current.text;
  var hp=$('hpDot'),ht=$('hpText');var ok=v.running&&v.oscEnabled;if(hp&&ht){hp.className='dot '+(ok?'on':'warn');ht.textContent=ok?'状态正常':'检查 OSC';}
  if(v.running&&v.oscEnabled){setDot('vrcDot','on');$('vrcText').textContent='运行中';}else if(v.running){setDot('vrcDot','warn');$('vrcText').textContent='OSC 未开';}else{setDot('vrcDot','');$('vrcText').textContent='未运行';}
  setDot('oscDot',v.oscEnabled?'on':'');$('oscText').textContent=v.oscEnabled?'已开启':'关闭';
  var pc=await (await fetch('/api/ports/check')).json();var u=pc.udp9000||{};
  if(u.occupied){var nm=u.name||'';var isV=nm.indexOf('VRChat')>=0;setDot('udpDot',isV?'on':'off');$('udpText').textContent=isV?'被 VRChat 占用(正常)':'被占用: '+nm;}else{setDot('udpDot','');$('udpText').textContent='空闲(正常)';}
}catch(e){}}
document.querySelectorAll('.sw[data-src]').forEach(function(sw){sw.addEventListener('click',async function(){sw.classList.toggle('on');try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:sw.dataset.src,enabled:sw.classList.contains('on')})});}catch(e){}pollStatus();});});
if($('diagBtn'))$('diagBtn').onclick=async function(){try{var r=await fetch('/api/diagnose');var j=await r.json();alert(JSON.stringify(j,null,2));}catch(e){}};
if($('healthRefresh'))$('healthRefresh').onclick=pollStatus;
// 环境/翻译
async function renderEnv(){var tb=$('envRows');if(!tb)return;tb.innerHTML='';
  var h=await (await fetch('/api/health')).json();
  [['Node.js','运行本体','✅ 已内置','-'],['听歌显示(Python+winsdk)','SMTC 读取',(h.deps&&h.deps.python?'✅ 就绪':'⚠ 缺 Python'),'-']].forEach(function(r){var tr=document.createElement('tr');['td','td','td','td'].forEach(function(tag,i){var td=document.createElement(tag);if(i===2)td.className='sub';td.textContent=r[i];tr.appendChild(td);});tb.appendChild(tr);});
  var lt=await (await fetch('/api/ocrtl-lt')).json();
  var trLt=document.createElement('tr');var a=document.createElement('td');a.textContent='翻译服务(LiveTranslate)';var b2=document.createElement('td');b2.textContent='字幕';var c2=document.createElement('td');c2.className='sub';c2.textContent=lt.found?('✅ 已配置'+(lt.model?' ('+lt.model+')':'')):'⚠ 未配置(OCR/LT API)';var d2=document.createElement('td');d2.textContent='-';trLt.appendChild(a);trLt.appendChild(b2);trLt.appendChild(c2);trLt.appendChild(d2);tb.appendChild(trLt);
  var st=$('ltStatus');if(st){st.textContent=lt.found?('已配置 '+(lt.model||'')+' → '+lt.targetLang):'未配置';st.style.color=lt.found?'var(--ok)':'var(--warn)';}}
async function loadTrans(){try{var c=await (await fetch('/api/config')).json();var o=c.ocrtl||{};var v=o.vision||{};if($('transMode'))$('transMode').value=o.mode||'auto';if($('transApiBase'))$('transApiBase').value=v.apiBase||'';if($('transDelay'))$('transDelay').value=o.delayMs||5000;}catch(e){}}
if($('transVoice'))$('transVoice').onchange=async function(){try{await fetch('/api/sources',{method:'POST',body:JSON.stringify({id:'livetranslate',enabled:this.checked})});}catch(e){}pollStatus();};
if($('transShot'))$('transShot').onclick=async function(){try{var r=await fetch('/api/ocrtl/run',{method:'POST',body:'{}'});var j=await r.json();alert(j.ok?'截图翻译已触发':'触发失败');}catch(e){alert('触发失败');}};
// 高级设置
if($('advAuto')){(async function(){try{var c=await (await fetch('/api/config')).json();$('advAuto').checked=!!c.autostart;}catch(e){}})();$('advAuto').onchange=async function(){try{await fetch('/api/autostart',{method:'POST',body:JSON.stringify({enabled:this.checked})});}catch(e){}};}
if($('advConsole')){(async function(){try{var c=await (await fetch('/api/config')).json();$('advConsole').checked=!((c.desktop||{}).showConsole===false);}catch(e){}})();$('advConsole').onchange=async function(){try{await fetch('/api/desktop/console',{method:'POST',body:JSON.stringify({show:this.checked})});}catch(e){}};}
if($('oscPort')){(async function(){try{var c2=await (await fetch('/api/config')).json();$('oscPort').value=(c2.osc&&c2.osc.port)||9000;}catch(e){}})();$('oscApply').onclick=async function(){try{await fetch('/api/ports/osc',{method:'POST',body:JSON.stringify({port:Number($('oscPort').value)||9000})});alert('端口已应用, 重启生效');}catch(e){alert('应用失败');}};}
if($('devdocsBtn'))$('devdocsBtn').onclick=function(){fetch('/api/devdocs/open',{method:'POST',body:'{}'});};
if($('quitBtn'))$('quitBtn').onclick=function(){if(confirm('确定完全关闭?'))fetch('/api/desktop/quit',{method:'POST',body:'{}'});};
if($('restartBtn'))$('restartBtn').onclick=function(){if(confirm('确定快速重启?'))fetch('/api/desktop/restart',{method:'POST',body:'{}'});};
async function loadLogs(){try{var r=await fetch('/api/logs?tail=200');var j=await r.json();var arr=Array.isArray(j)?j:(j.lines||[]);var q=(($('logFilter')||{}).value||'');if(q)arr=arr.filter(function(l){return String(l).indexOf(q)>=0;});var el=$('logView');if(el)el.textContent=arr.join('\n')||'(无日志)';}catch(e){}}
if($('logRefresh'))$('logRefresh').onclick=loadLogs;if($('logFilter'))$('logFilter').addEventListener('input',loadLogs);
if($('oscTest'))$('oscTest').onclick=async function(){try{var s=await (await fetch('/api/status')).json();var v=s.vrc||{};var pc=await (await fetch('/api/ports/check')).json();var u=pc.udp9000||{};var m='【OSC 测试】'+new Date().toLocaleTimeString();var sr=await fetch('/v1/chatbox',{method:'POST',body:JSON.stringify({text:m})});var sj=await sr.json();alert('VRChat: '+(v.running?'运行中':'未运行')+'\nOSC: '+(v.oscEnabled?'已开启':'关闭')+'\nUDP 9000: '+(u.occupied?((u.name||'').indexOf('VRChat')>=0?'被 VRChat 占用(正常)':'被占用: '+(u.name||u.pid)):'空闲(正常)')+'\n测试消息: '+(sj.ok?('已发送「'+m+'」'):('发送失败: '+(sj.error||''))));}catch(e){alert('测试出错');}};
// 动效
function applyAnim(){var master=localStorage.getItem('vrcbAnimMaster')==='1';var auto=localStorage.getItem('vrcbAnimAutoOff')==='1'&&!!window._vrcRunning;document.body.classList.toggle('no-anim',master||auto);}
if($('animTop')){$('animTop').onclick=function(){var off=!document.body.classList.contains('no-anim');document.body.classList.toggle('no-anim',off);localStorage.setItem('vrcbAnimMaster',off?'1':'0');$('animTop').classList.toggle('on',!off);};$('animTop').classList.toggle('on',localStorage.getItem('vrcbAnimMaster')!=='1');}
if($('animTgl')){$('animTgl').onclick=function(){var on=this.classList.contains('on');this.classList.toggle('on',!on);localStorage.setItem('vrcbAnimAutoOff',on?'0':'1');applyAnim();};$('animTgl').classList.toggle('on',localStorage.getItem('vrcbAnimAutoOff')==='1');}
function starryBoot(){
  var st=document.createElement('style');st.textContent='.pl{position:absolute;left:16%;top:50%;transform:translateY(-50%);height:3px;width:0;background:linear-gradient(90deg,#7c5cf6,#c4b5fd,#7c5cf6);border-radius:2px;box-shadow:0 0 18px #7c5cf6aa;z-index:5}.plogo{position:absolute;left:0;right:0;bottom:50%;height:30%;display:flex;align-items:flex-end;justify-content:center;transform-origin:50% 100%;transform:scaleY(0);z-index:4}.plogo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.plogo .pnew{visibility:hidden;z-index:1}.plogo .pold{z-index:2}.pwipe{position:absolute;top:-12%;bottom:-12%;left:0;width:80px;transform:skewX(-14deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),rgba(167,139,250,.42),transparent);mix-blend-mode:screen;z-index:3;opacity:0}.pword{position:absolute;left:0;right:0;top:50%;width:44%;margin:0 auto;transform-origin:50% 0%;transform:scaleY(0)}.pword img{width:100%;display:block}.ptag{position:absolute;left:0;right:0;bottom:13%;text-align:center;font-size:16px;color:#c4b5fd;opacity:0;letter-spacing:1px}';document.head.appendChild(st);
  var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;z-index:9999;pointer-events:none;background:radial-gradient(110% 110% at 50% 32%, #7c5cf62e 0%, #0b0e13 72%)';
  ov.innerHTML='<div class="pl"></div><div class="plogo"><img class="pnew" src="/starry-new.png"><img class="pold" src="/starry-old.png"><div class="pwipe"></div></div><div class="pword"><img src="/starry-wordmark.png"></div><div class="ptag">凌晨三点的星光,落进你的聊天框</div>';
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
  var ov=document.createElement('div');ov.style.cssText='position:fixed;inset:0;z-index:9999;background:#000;cursor:pointer';
  ov.innerHTML='<video src="/api/special/video" autoplay playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain"></video>'+(sv&&sv.title?('<div style="position:absolute;bottom:26px;left:0;right:0;text-align:center;color:rgba(255,255,255,.7);font-size:13px;letter-spacing:2px;pointer-events:none">点击任意处跳过</div>'):'');
  document.body.appendChild(ov);
  var skipped=false; var skip=function(){if(skipped)return;skipped=true;ov.remove();};
  ov.addEventListener('click',skip);
  var v=ov.querySelector('video');
  if(v){v.addEventListener('ended',skip);v.addEventListener('error',function(){if(!skipped)skip();});}
  setTimeout(skip,120000);
}
// 启动动画(品牌感知)
(async function(){var brd='default';var bc=null;try{bc=await (await fetch('/api/config')).json();brd=bc.branding||'default';}catch(e){}
 if(bc&&bc.specialVideo&&bc.specialVideo.date){var _d0=new Date();var _today=('0'+(_d0.getMonth()+1)).slice(-2)+'-'+('0'+_d0.getDate()).slice(-2);if(bc.specialVideo.date===_today){playSpecialVideo(bc.specialVideo);return;}}
 var now=new Date(),m=now.getMonth()+1,d=now.getDate();
 var fest=[[1,1,'元旦快乐','#f59e0b','#60a5fa','🎆'],[9,15,'中秋快乐','#f5c518','#ff8c42','🥮'],[10,1,'国庆快乐','#ff5b5b','#f5c518','🎆'],[10,31,'万圣节快乐','#ff8c00','#c084fc','🎃'],[12,25,'圣诞快乐','#2fbf71','#e2405b','🎄']];
 var t=null;for(var i=0;i<fest.length;i++){var f=fest[i];if(f[0]===m&&f[1]===d){t=f;break;}}
 var c1,c2,greet,deco,title,tag;
 if(brd==='starry'){starryBoot();return;}
 else if(t){c1=t[3];c2=t[4];greet=t[2];deco=t[5];title='VRCLiveBoard';tag='星光落进聊天框';}
 else if(m>=3&&m<=5){c1='#34d399';c2='#f9a8d4';greet='春色满园';deco='🌸';title='VRCLiveBoard';tag='星光落进聊天框';}
 else if(m>=6&&m<=8){c1='#38bdf8';c2='#86efac';greet='夏日浓荫';deco='☀️';title='VRCLiveBoard';tag='星光落进聊天框';}
 else if(m>=9&&m<=11){c1='#f59e0b';c2='#f87171';greet='秋意渐浓';deco='🍂';title='VRCLiveBoard';tag='星光落进聊天框';}
 else{c1='#60a5fa';c2='#e0f2fe';greet='冬日暖阳';deco='❄️';title='VRCLiveBoard';tag='星光落进聊天框';}
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
      else if(c.type==='del'){var d=document.createElement('button');d.className='small danger';d.textContent=(window.UI_TXT&&window.UI_TXT.del)||'删除';d.dataset.i=i;d.onclick=function(){rows.splice(+this.dataset.i,1);render();};td.appendChild(d);}
      tr.appendChild(td);});
    tb.appendChild(tr);});
}
function plugCall(id,method,args){return fetch('/api/plugins/call',{method:'POST',body:JSON.stringify({id:id,method:method,args:args||{}})}).then(function(r){return r.json();});}
function xlsxReady(id,cb){if(window.XLSX)return cb();var s=document.createElement('script');s.src='/api/plugins/asset?id='+id+'&file=vendor/xlsx.full.min.js';s.onload=function(){cb();};s.onerror=function(){};document.head.appendChild(s);}
function exportAoa(id,sheet,aoa,fn){xlsxReady(id,function(){if(!window.XLSX)return;var wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),sheet);XLSX.writeFile(wb,fn);});}
// 好友欢迎
window.__plgset_friend_welcome=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">好友欢迎名单(进房自动播欢迎语)</div><table><thead><tr><th>显示名</th><th>欢迎语(多条用 | 分隔)</th><th>轮巡</th><th>秒/片</th><th>启用</th><th></th></tr></thead><tbody class="fwTb"></tbody></table><div class="row" style="margin-top:8px"><button class="small gray" data-fwadd>+ 添加</button><button class="small" data-fwsave>保存</button><button class="small gray" data-fwexp>导出名单</button><button class="small gray" data-fwimp>从 Excel 导入</button><input type="file" accept=".xlsx" class="fwFile" style="display:none"><span class="sub" data-fwmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-fwmsg]');
  function render(){tblRows(body,'.fwTb',[{type:'text',k:'name'},{type:'text',k:'lines'},{type:'num',k:'loops',def:2},{type:'num',k:'eachSec',def:6},{type:'chk',k:'enabled'},{type:'del'}],rows,{});}
  body.querySelector('[data-fwadd]').onclick=function(){rows.push({name:'',lines:'欢迎 {name} 来到房间!',loops:2,eachSec:6,enabled:true});render();};
  body.querySelector('[data-fwsave]').onclick=function(){var rows2=rows.map(function(x){return [x.name||'',x.lines||'',Number(x.loops)||2,Number(x.eachSec)||6,x.enabled!==false];});plugCall('friend-welcome','saveRows',{rows:rows2}).then(function(j){msg.textContent=j&&j.ok?('已保存 '+(j.count||rows2.length)+' 人'):('失败: '+(j&&j.error||''));});};body.querySelector('[data-fwexp]').onclick=function(){exportAoa('friend-welcome','好友欢迎名单',[['显示名','欢迎语','轮巡','每片秒','启用']].concat(rows.map(function(x){return [x.name||'',x.lines||'',x.loops||2,x.eachSec||6,x.enabled!==false?'':'否'];})),'好友欢迎名单.xlsx');};body.querySelector('[data-fwimp]').onclick=function(){body.querySelector('.fwFile').click();};body.querySelector('.fwFile').onchange=function(ev){var f=ev.target.files&&ev.target.files[0];if(!f)return;xlsxReady('friend-welcome',function(){var rd=new FileReader();rd.onload=function(e){try{var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});var sh=wb.Sheets[wb.SheetNames[0]];var aoa=XLSX.utils.sheet_to_json(sh,{header:1});plugCall('friend-welcome','importRows',{rows:aoa}).then(function(j){msg.textContent=j&&j.ok?('已导入 '+(j.count||0)+' 人'):('导入失败: '+(j&&j.error||''));plugCall('friend-welcome','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});}catch(err){msg.textContent='导入失败: '+err.message;}};rd.readAsArrayBuffer(f);});};
  plugCall('friend-welcome','getRows',{}).then(function(j){rows=Array.isArray(j)?j:((j&&j.rows)||[]);render();});
};
// 定时公告
window.__plgset_scheduled_board=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">定时公告</div><div class="sub">常规公告(每行一条):</div><textarea class="sbItems" rows="3" style="width:100%"></textarea>'
    +'<div class="row" style="margin:8px 0"><label class="sub"><input type="number" class="sbInterval" value="30" style="width:64px"> 分钟</label><label class="sub"><input type="checkbox" class="sbOnHour"> 整点</label><label class="sub"><input type="checkbox" class="sbOnHalf"> 半点</label><label class="sub"><input type="checkbox" class="sbHourIntr"> 整点中断</label></div>'
    +'<div class="sub">每小时文案(多条用 | 分隔):</div><input type="text" class="sbHourly" style="width:100%">'
    +'<div class="sub" style="margin:8px 0 4px">特殊公告(到点触发):</div><table><thead><tr><th>日期时间</th><th>内容</th><th>中断</th><th></th></tr></thead><tbody class="sbTb"></tbody></table>'
    +'<div class="row" style="margin-top:8px"><button class="small gray" data-sbadd>+ 添加</button><button class="small" data-sbsave>保存</button><button class="small gray" data-sbtest>测试常规</button><button class="small gray" data-sbexp>导出特殊公告</button><button class="small gray" data-sbimp>从 Excel 导入</button><input type="file" accept=".xlsx" class="sbFile" style="display:none"><span class="sub" data-sbmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-sbmsg]');
  function render(){tblRows(body,'.sbTb',[{type:'text',k:'at'},{type:'text',k:'text'},{type:'chk',k:'interrupt'},{type:'del'}],rows,{});}
  body.querySelector('[data-sbadd]').onclick=function(){rows.push({at:'',text:'',interrupt:false});render();};
  body.querySelector('[data-sbsave]').onclick=function(){var args={items:body.querySelector('.sbItems').value.split('\n'),intervalMin:Number(body.querySelector('.sbInterval').value)||30,onHour:body.querySelector('.sbOnHour').checked,onHalf:body.querySelector('.sbOnHalf').checked,hourlyText:body.querySelector('.sbHourly').value.split('|'),interruptHourly:body.querySelector('.sbHourIntr').checked,specials:rows.map(function(x){return [x.at||'',x.text||'',x.interrupt?'':'否'];})};plugCall('scheduled-board','saveAll',args).then(function(j){msg.textContent=j&&j.ok?('已保存: 常规 '+(j.items||0)+' / 特殊 '+(j.specials||0)):('失败: '+(j&&j.error||''));}).catch(function(e){msg.textContent='失败: '+e.message;});};
  body.querySelector('[data-sbtest]').onclick=function(){plugCall('scheduled-board','testFire',{type:'regular'}).then(function(j){msg.textContent=j&&j.ok?'已触发 ✓':'触发失败';});};body.querySelector('[data-sbexp]').onclick=function(){exportAoa('scheduled-board','特殊公告',[['日期时间','公告内容','是否中断']].concat(rows.map(function(x){return [x.at||'',x.text||'',x.interrupt?'':'否'];})),'特殊公告.xlsx');};body.querySelector('[data-sbimp]').onclick=function(){body.querySelector('.sbFile').click();};body.querySelector('.sbFile').onchange=function(ev){var f=ev.target.files&&ev.target.files[0];if(!f)return;xlsxReady('scheduled-board',function(){var rd=new FileReader();rd.onload=function(e){try{var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});var sh=wb.Sheets[wb.SheetNames[0]];var aoa=XLSX.utils.sheet_to_json(sh,{header:1});plugCall('scheduled-board','importRows',{rows:aoa}).then(function(j){msg.textContent=j&&j.ok?('已导入 '+(j.count||0)+' 条'):('导入失败: '+(j&&j.error||''));plugCall('scheduled-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});}catch(err){msg.textContent='导入失败: '+err.message;}};rd.readAsArrayBuffer(f);});};
  plugCall('scheduled-board','status',{}).then(function(st){if(st&&st.ok){body.querySelector('.sbItems').value=(st.items||[]).join('\n');body.querySelector('.sbInterval').value=st.intervalMin||30;body.querySelector('.sbOnHour').checked=!!st.onHour;body.querySelector('.sbOnHalf').checked=!!st.onHalf;body.querySelector('.sbHourIntr').checked=!!st.interruptHourly;body.querySelector('.sbHourly').value=(st.hourlyText||[]).join('|');}});plugCall('scheduled-board','getRows',{}).then(function(j){rows=Array.isArray(j)?j:[];render();});
};
// 天气播报
window.__plgset_weather_board=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">天气播报</div><div class="row" style="margin:0 0 8px"><label class="sub"><input type="number" class="wxInterval" value="15" style="width:60px"> 分钟</label><label class="sub"><input type="number" class="wxDisplay" value="60" style="width:60px"> 显示秒</label><label class="sub"><input type="checkbox" class="wxContinuous"> 连续</label><label class="sub">前缀 <input type="text" class="wxPrefix" value="【天气】"></label></div>'
    +'<table><thead><tr><th>城市</th><th>启用</th><th></th><th></th></tr></thead><tbody class="wxTb"></tbody></table>'
    +'<div class="row" style="margin-top:8px"><button class="small gray" data-wxadd>+ 添加</button><button class="small gray" data-wxpreset>+ 国内预设</button><button class="small gray" data-wxpresetw>+ 国外预设</button><button class="small" data-wxsave>保存</button><button class="small gray" data-wxexp>导出天气城市</button><span class="sub" data-wxmsg></span></div>';
  var rows=[],msg=body.querySelector('[data-wxmsg]');
  function render(){tblRows(body,'.wxTb',[{type:'text',k:'name'},{type:'chk',k:'enabled'},{type:'btn',label:'测试',act:'test',fn:function(i){plugCall('weather-board','testCity',{index:i}).then(function(j){msg.textContent=j&&j.ok?('已发送: '+j.text):'测试失败';});}},{type:'del'}],rows,{});}
  body.querySelector('[data-wxadd]').onclick=function(){rows.push({name:'',enabled:true});render();};
  body.querySelector('[data-wxpreset]').onclick=function(){plugCall('weather-board','addPresets',{kind:'cn'}).then(function(j){msg.textContent=j&&j.ok?('已添加 '+(j.added||0)+' 个国内城市'):'失败';plugCall('weather-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});};body.querySelector('[data-wxpresetw]').onclick=function(){plugCall('weather-board','addPresets',{kind:'world'}).then(function(j){msg.textContent=j&&j.ok?('已添加 '+(j.added||0)+' 个国外/全球城市'):'失败';plugCall('weather-board','getRows',{}).then(function(j2){rows=Array.isArray(j2)?j2:[];render();});});};
  body.querySelector('[data-wxexp]').onclick=function(){exportAoa('weather-board','天气城市',[['城市','启用']].concat(rows.map(function(x){return [x.name||'',x.enabled?'':'否'];})),'天气城市.xlsx');};body.querySelector('[data-wxsave]').onclick=function(){var cfg={intervalMin:Number(body.querySelector('.wxInterval').value)||15,displaySec:Number(body.querySelector('.wxDisplay').value)||60,continuous:body.querySelector('.wxContinuous').checked,prefix:body.querySelector('.wxPrefix').value||'【天气】'};plugCall('weather-board','saveRows',{rows:rows.map(function(x){return [x.name||'',x.enabled?'':'否'];})}).then(function(j){if(!j||!j.ok){msg.textContent='失败: '+(j&&j.error||'');return;}plugCall('weather-board','saveConfig',cfg).then(function(){msg.textContent='已保存 ✓';});});};
  plugCall('weather-board','status',{}).then(function(st){if(st&&st.ok){body.querySelector('.wxInterval').value=st.intervalMin||15;body.querySelector('.wxDisplay').value=st.displaySec||60;body.querySelector('.wxContinuous').checked=!!st.continuous;body.querySelector('.wxPrefix').value=st.prefix!==undefined?st.prefix:'【天气】';}});plugCall('weather-board','getRows',{}).then(function(j){rows=Array.isArray(j)?j:[];render();});
};
// 网易云歌词
window.__plgset_netease_lyrics=function(p,body){
  body.innerHTML='<div class="sub" style="margin:0 0 6px">网易云歌词</div>'
    +'<div class="row" style="gap:8px;flex-wrap:wrap"><label class="sub"><input type="number" class="nlUpdate" value="4" style="width:56px"> 更新秒</label><label class="sub"><input type="number" class="nlPrio" value="35" style="width:56px"> 优先级</label><label class="sub"><input type="number" class="nlPort" value="9234" style="width:64px"> CDP端口</label></div>'
    +'<div class="row" style="gap:8px;flex-wrap:wrap;margin:6px 0"><label class="sub"><input type="checkbox" class="nlTrans" checked> 显示译文(歌词原文下方加一行翻译)</label><label class="sub" title="其它播放器/媒体在播时, 也通过网易云查找并显示该歌曲的歌词"><input type="checkbox" class="nlOther"> 其它媒体也经网易云查歌词</label><label class="sub"><input type="checkbox" class="nlRhythm"> 歌词节奏显示(每句显示到下一句)</label><label class="sub"><input type="checkbox" class="nlTitle" checked> 顶部显示歌名(与 SMTC 联动)</label></div>'
    +'<div class="sub">网易云 exe 路径(留空=自动):</div><input type="text" class="nlExe" style="width:100%">'
    +'<div class="sub" style="margin:8px 0">说明: 歌词的精确同步(拖动/暂停/切歌)需网易云客户端开启 CDP 调试端口(由上方的 CDP 端口决定, 默认 9234)。若网易云当前没开该端口, 点下面按钮会退出并用该端口重启它(会中断播放几秒)。</div>'
    +'<div class="row" style="margin-top:8px"><button class="small" data-nlsave>保存</button><button class="small gray" data-nltest>测试</button><button class="small gray" data-nlcdp>以调试端口重启网易云</button><span class="sub" data-nlmsg></span></div>';
  var msg=body.querySelector('[data-nlmsg]');
  function collect(){return {updateSec:Number(body.querySelector('.nlUpdate').value)||4,showTranslation:body.querySelector('.nlTrans').checked,allowOtherPlayers:body.querySelector('.nlOther').checked,rhythmMode:body.querySelector('.nlRhythm').checked,showTitle:body.querySelector('.nlTitle').checked,priority:Number(body.querySelector('.nlPrio').value)||35,cdpPort:Number(body.querySelector('.nlPort').value)||9234,cloudExe:body.querySelector('.nlExe').value.trim()};}
  body.querySelector('[data-nlsave]').onclick=function(){plugCall('netease-lyrics','saveConfig',collect()).then(function(j){msg.textContent=j&&j.ok?'已保存 ✓':'失败: '+(j&&j.error||'');});};
  body.querySelector('[data-nltest]').onclick=function(){plugCall('netease-lyrics','testNow',{}).then(function(j){msg.textContent=j&&j.ok?('已发送: '+j.text):'测试失败';});};
  body.querySelector('[data-nlcdp]').onclick=function(){if(!confirm('将重启网易云(CDP 调试端口), 确定?'))return;plugCall('netease-lyrics','launchCdp',{}).then(function(j){msg.textContent=j&&j.ok?(j.note||'成功 ✓'):'失败: '+(j&&j.error||'');});};
  plugCall('netease-lyrics','status',{}).then(function(j){if(j&&j.cfg){var c=j.cfg;body.querySelector('.nlUpdate').value=c.updateSec||4;body.querySelector('.nlPrio').value=c.priority||35;body.querySelector('.nlPort').value=c.cdpPort||9234;body.querySelector('.nlExe').value=c.cloudExe||'';body.querySelector('.nlTrans').checked=c.showTranslation!==false;body.querySelector('.nlOther').checked=!!c.allowOtherPlayers;body.querySelector('.nlRhythm').checked=!!c.rhythmMode;body.querySelector('.nlTitle').checked=c.showTitle!==false;}});
};

// 品牌选择: 变更即保存 + 回显已保存值
if($('brandSel'))$('brandSel').onchange=function(){try{fetch('/api/config',{method:'POST',body:JSON.stringify({branding:this.value})});}catch(e){}};
(async function(){try{var _c=await (await fetch('/api/config')).json();var _bs=$('brandSel');if(_bs&&_c.branding)_bs.value=_c.branding;}catch(e){}})();
// init
try{applyLang();}catch(e){}
pollStatus();setInterval(pollStatus,5000);
loadPages();loadPlugins();renderEnv();loadTrans();loadLogs();
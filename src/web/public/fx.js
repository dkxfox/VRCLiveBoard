// 背景星空(canvas): 原 index.html 内联块, 2026-09-11 迁出 —— 见 M-20260911-16
// 对外契约: window.__fxRestart()(由 app.js 的 applyAnim 在动效重新打开时调用)
(function(){
  var cv=document.getElementById('fxbg'); if(!cv)return; var ctx=cv.getContext('2d');
  var W=0,H=0; function rs(){W=cv.width=Math.floor(innerWidth);H=cv.height=Math.floor(innerHeight);}
  function hash(ix,iy){var h=(ix*374761393+iy*668265263)|0;h=((h^(h>>13))*1274126177)|0;return (((h^(h>>16))>>>0)/4294967295);}
  function sm(t){return t*t*(3-2*t);}
  function vnoise(x,y){var ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;var a=hash(ix,iy),b=hash(ix+1,iy),c=hash(ix,iy+1),d=hash(ix+1,iy+1),u=sm(fx),v=sm(fy);return (a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v;}
  function flow(x,y){var e=.02;var n1=vnoise(x,y),n2=vnoise(x+e,y),n3=vnoise(x,y+e);return [(n3-n1)/e,-(n2-n1)/e];}
  var P=[]; var N= innerWidth<720?150:300;
  function seed(){P.length=0; for(var i=0;i<N;i++)P.push({x:Math.random()*W,y:Math.random()*H,vx:0,vy:0,r:Math.random()*1.7+0.5,a:Math.random()*.16+.10,hue:Math.random()<.5?0:1});}
  rs(); seed();
  var mx=-9999,my=-9999,mvx=0,mvy=0,raf=0;
  addEventListener('mousemove',function(e){var nx=e.clientX,ny=e.clientY;mvx=nx-mx;mvy=ny-my;mx=nx;my=ny;});
  addEventListener('mouseout',function(e){if(!e.relatedTarget){mx=-9999;my=-9999;mvx=0;mvy=0;}});
  function step(){
    ctx.clearRect(0,0,W,H); ctx.globalCompositeOperation='lighter';
    for(var i=0;i<P.length;i++){var p=P[i];
      var f=flow(p.x*0.0040,p.y*0.0040); var vx=f[0]*1.0, vy=f[1]*1.0;
      if(mx>-9000){var dx=p.x-mx,dy=p.y-my,d=Math.sqrt(dx*dx+dy*dy); if(d<190&&d>0.01){var s=(190-d)/190,tx=-dy/d,ty=dx/d; vx+=tx*s*2.8;vy+=ty*s*2.8;vx+=mvx*0.02*s;vy+=mvy*0.02*s;}}
      p.x+=vx; p.y+=vy; if(p.x<-10)p.x=W+10;if(p.x>W+10)p.x=-10;if(p.y<-10)p.y=H+10;if(p.y>H+10)p.y=-10;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r*1.9,0,6.2832); ctx.fillStyle= p.hue? ('rgba(100,170,240,'+(p.a*0.4).toFixed(3)+')') : ('rgba(120,160,250,'+(p.a*0.4).toFixed(3)+')'); ctx.fill();
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.2832); ctx.fillStyle= p.hue? ('rgba(150,205,250,'+p.a.toFixed(3)+')') : ('rgba(170,190,255,'+p.a.toFixed(3)+')'); ctx.fill();
    }
    ctx.globalCompositeOperation='source-over';
  }
  var _last=0;
  function loop(ts){
    if(document.body.classList.contains('no-anim')||matchMedia('(prefers-reduced-motion: reduce)').matches){ ctx.clearRect(0,0,W,H); raf=0; return; }
    raf=requestAnimationFrame(loop);
    if(!ts||ts-_last>=33){ _last=ts; step(); }
  }
  function start(){ if(!raf){ mx=-9999;my=-9999;mvx=0;mvy=0; raf=requestAnimationFrame(loop);} }
  window.__fxRestart=start;
  addEventListener('resize',function(){ rs(); seed(); if(!raf)start(); });
  var at=document.getElementById('animTgl'); if(at){at.addEventListener('click',function(){setTimeout(start,0);});}
  var fm=new URLSearchParams(location.search).get('fx'); if(fm){var a=fm.split(','); mx=+a[0];my=+a[1];}
  start();
})();

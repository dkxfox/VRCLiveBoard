'use strict';
// 启动画面(M-20260911-50): 桌面壳开一个无边框窗口加载本页(网页控制台的首屏动画仍然在 app.js 里)。
// 决策完全交给 /api/efx/boot —— 与网页控制台同源, 壳不再自己判断日期窗口/开关/已播记录。
// 收尾约定(与 electron/main.js 的轮询对应): 播完 / 跳过 / 播放出错都置 window.__splashDone = true。
(function () {
  var done = false;
  window.__splashDone = false;
  window.__splashWhy = '';
  var q = null; try { q = new URLSearchParams(location.search); } catch (e) {}
  var dateArg = (q && q.get('date')) || '';
  var elVideo = document.getElementById('video');
  var elNorm = document.getElementById('norm');
  var elBar = document.getElementById('barIn');
  var bail = null;

  // 迷你三语应用器: 启动画面不加载 app.js(它带着整套控制台逻辑), 但文案仍走同一份字典, 不新增硬编码
  function t(key, lang) {
    try {
      var d = window.VRCB_LANG || {};
      var L = d[lang] || d['zh-CN'] || {};
      return L[key] || (d['zh-CN'] || {})[key] || key;
    } catch (e) { return key; }
  }
  function applyLang(lang) {
    var list = document.querySelectorAll('[data-t]');
    for (var i = 0; i < list.length; i++) {
      var k = list[i].getAttribute('data-t');
      var v = t(k, lang);
      if (v) list[i].textContent = v;
    }
  }

  function finish(why) {
    if (done) return; done = true;
    window.__splashWhy = String(why || '');
    window.__splashDone = true;
    try { document.body.style.transition = 'opacity .3s'; document.body.style.opacity = '0'; } catch (e) {}
  }
  function skip() { finish('skip'); }
  document.addEventListener('click', skip);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') skip(); });
  window.__splashSkip = skip;

  function progress(ms) {
    if (!elBar) return;
    elBar.style.transition = 'width ' + ms + 'ms linear';
    elBar.style.width = '100%';
  }
  function playSpecial(ev) {
    if (!elVideo) return finish('no-video-el');
    elVideo.style.display = 'block';
    elVideo.src = '/api/special/video?file=' + encodeURIComponent(ev.video);
    progress(ev.durationMs || 60000);
    elVideo.addEventListener('ended', function () { finish('ended'); });
    elVideo.addEventListener('error', function () { finish('video-error'); });
    var p = null; try { p = elVideo.play(); } catch (e) {}
    if (p && p.catch) p.catch(function () { finish('autoplay-blocked'); });   // 自动播放被拒也不能挡人(壳会立刻亮主窗口)
    bail = setTimeout(function () { finish('timeout'); }, 130000);
  }
  function playNormal() {
    if (elNorm) elNorm.classList.add('on');
    setTimeout(function () { if (elNorm) elNorm.classList.add('show'); }, 60);
    progress(2400);
    setTimeout(function () { finish('normal'); }, 2400);
  }

  // 语言: config.web.lang(与文案字典同一份口径)
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (c) {
    applyLang((c && c.lang) || (navigator.language || 'zh-CN'));
  }).catch(function () { applyLang(navigator.language || 'zh-CN'); });

  fetch('/api/efx/boot' + (dateArg ? ('?date=' + encodeURIComponent(dateArg)) : ''))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.action === 'special' && d.event && d.event.video) { playSpecial(d.event); return; }
      if (d && d.action === 'off') { finish('off'); return; }   // 动效开关关且今天没有特殊彩蛋 → 不播启动动画(设计 §2/§4)
      playNormal();
    })
    .catch(function () { finish('boot-fail'); });   // 拿不到决策就放行 —— 启动画面绝不能把用户挡在控制台外面
})();

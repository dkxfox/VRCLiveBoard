'use strict';
// 页面内自绘下拉(F-20260929-02 切片 1) —— 替代原生 <select>
// 为什么要有它: 原生 <select> 的下拉是**独立顶层窗口**, 在 VR 桌面视图(OVR 的"选择窗口")里
//   画面能看见、点击进不去 -> 点不着。画在自己页面里才能点。
//
// 对外契约(内部契约, 门禁与其他前端文件按此使用; 照 theme.js / fx.js 的做法写在这里):
//   window.__dsel = { mount(id, opts), get(id), set(id, value), onChange(id, fn), closeAll() }
//   opts: { options: [{ value, labelKey | label }], value, placeholderKey, width }
//   约定(来自 html-inline-check 那个坑): **值放 data-value, 不随翻译变化**; 文案走 labelKey -> 可翻译。
//   键盘: 点击展开; 数字 1~9 直选第 N 项(VR 虚拟键盘靠这个); ↑/↓ 移动; Enter 选中; Esc/点外部关闭。
//   **回调约定**: 回调里请用 `__dsel.get(id)` 取当前值, 不要依赖回调参数 —— 原生 onchange 被直接调用时是没有参数的。
//   兼容: 根节点暴露 value 读写, 并把 onChange 的回调同时挂到 root.onchange 上, `$('id').value` 那套写法继续可用。
//   降级: 出错只显示为普通文本, 不抛错、不阻塞启动。
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var reg = {};          // id -> { root, wrap, list, opts, value, onChange, open }
  var openOne = null;

  function t(key, fallback) {
    try { if (typeof window.tr === 'function' && key) return window.tr(key); } catch (e) {}
    return fallback === undefined ? (key || '') : fallback;
  }
  function labelOf(it) {
    if (!it) return '';
    var pre = it.labelPrefix || '';   // 前缀不翻译(例如变量名 {cpu_util})
    if (it.labelKey) return pre + t(it.labelKey, it.label || it.labelKey);
    return pre + (it.label || String(it.value));
  }
  function find(id, value) {
    var st = reg[id]; if (!st) return null;
    var list = st.opts.options || [];
    for (var i = 0; i < list.length; i++) if (String(list[i].value) === String(value)) return list[i];
    return null;
  }
  function paint(id) {
    var st = reg[id]; if (!st) return;
    var it = find(id, st.value);
    var label = it ? labelOf(it) : t(st.opts.placeholderKey, st.opts.placeholder || '');
    st.root.textContent = label;
    st.root.setAttribute('data-value', st.value === undefined || st.value === null ? '' : String(st.value));
    st.root.setAttribute('aria-expanded', st.open ? 'true' : 'false');
  }
  function close(id) {
    var st = reg[id]; if (!st || !st.open) return;
    st.open = false; if (openOne === id) openOne = null;
    if (st.list) st.list.style.display = 'none';
    paint(id);
  }
  function closeAll() { Object.keys(reg).forEach(close); }
  function choose(id, idx) {
    var st = reg[id]; if (!st) return;
    var list = st.opts.options || [];
    if (idx < 0 || idx >= list.length) return;
    set(id, list[idx].value);
    close(id);
    if (typeof st.onChange === 'function') { try { st.onChange(st.value, labelOf(list[idx])); } catch (e) {} }
    // 同时按原生习惯在根节点上触发 onchange(GBOOT 之类"改了会不会落盘"的接线断言按这个判断;
    // 也让习惯 $('id').onchange 的老代码继续可用)。这是**真事件**, 不是为了让断言变绿而空挂一个函数。
    if (typeof st.root.onchange === 'function') { try { st.root.onchange({ target: st.root, value: st.value }); } catch (e) {} }
  }
  function open(id) {
    var st = reg[id]; if (!st) return;
    if (openOne && openOne !== id) close(openOne);
    st.open = true; openOne = id;
    if (!st.list) {
      var l = document.createElement('div');
      l.className = 'dsel-list';
      l.setAttribute('role', 'listbox');
      l.style.cssText = 'position:absolute;left:0;top:100%;margin-top:2px;z-index:60;background:#141a26;border:1px solid rgba(96,128,180,.5);border-radius:6px;min-width:100%;max-height:320px;overflow:auto;box-shadow:0 6px 18px rgba(0,0,0,.5)';
      st.wrap.appendChild(l);
      st.list = l;
    }
    st.list.innerHTML = '';
    (st.opts.options || []).forEach(function (it, i) {
      var o = document.createElement('div');
      o.className = 'dsel-item';
      o.setAttribute('role', 'option');
      o.setAttribute('data-value', String(it.value));
      o.setAttribute('data-idx', String(i));
      o.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:13px;white-space:nowrap' + (String(it.value) === String(st.value) ? ';background:rgba(96,128,180,.25)' : '');
      o.textContent = (i < 9 ? (i + 1) + '. ' : '') + labelOf(it);
      o.onmouseenter = function () { o.style.background = 'rgba(96,128,180,.35)'; };
      o.onmouseleave = function () { o.style.background = (String(it.value) === String(st.value)) ? 'rgba(96,128,180,.25)' : ''; };
      o.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); choose(id, i); };
      st.list.appendChild(o);
    });
    st.list.style.display = '';
    paint(id);
  }
  function toggle(id) { var st = reg[id]; if (!st) return; if (st.open) close(id); else open(id); }
  function set(id, v) { var st = reg[id]; if (!st) return; st.value = v; paint(id); }
  function get(id) { var st = reg[id]; return st ? st.value : undefined; }

  function mount(id, opts) {
    try {
      var root = document.getElementById(id);
      if (!root) return false;
      opts = opts || {};
      opts.options = opts.options || [];
      // **重复 mount 必须就地更新, 不能重建**: 页面会周期性刷新(动作页每 3 秒拉一次状态),
      // 每次重建都会在 DOM 里留下一个旧的下拉列表 —— 表现就是"选完不收回、列表越堆越多"。
      if (reg[id]) {
        var st0 = reg[id];
        if (st0.open) close(id);
        st0.opts = opts;
        if (opts.value !== undefined && opts.value !== null && opts.value !== '') st0.value = opts.value;
        if (opts.width) st0.wrap.style.width = opts.width;
        paint(id);
        return true;
      }
      var wrap = document.createElement('span');
      wrap.className = 'dsel-wrap';
      wrap.style.cssText = 'position:relative;display:inline-block';
      if (opts.width) wrap.style.width = opts.width;
      if (root.parentNode) root.parentNode.insertBefore(wrap, root);
      wrap.appendChild(root);
      root.className = (root.className ? root.className + ' ' : '') + 'dsel';
      root.style.cssText = (root.style.cssText || '') + ';text-align:left;cursor:pointer';
      var st = { root: root, wrap: wrap, list: null, opts: opts, value: opts.value, onChange: null, open: false };
      reg[id] = st;
      // 与原生控件保持兼容: 根节点暴露 value 读写(读 = 当前值, 写 = 设值并重绘)。
      // 这样"老代码 / 门禁断言"按 $('id').value 的写法依然成立, 不必为了新组件到处改断言。
      try {
        Object.defineProperty(root, 'value', {
          configurable: true,
          get: function () { return st.value; },
          set: function (v) { st.value = v; paint(id); }
        });
      } catch (e) {}
      root.onclick = function (ev) { if (ev && ev.stopPropagation) ev.stopPropagation(); toggle(id); };
      paint(id);
      return true;
    } catch (e) { return false; }
  }

  if (document.addEventListener) {
    // 点击外部关闭。**必须忽略落在本组件内部的点击**(捕获阶段先于按钮自身的 onclick 执行,
    // 否则"再点一次按钮关闭"会先被这里关掉、又被按钮打开 —— 表现就是"点按钮关不上")。
    document.addEventListener('click', function (ev) {
      var target = ev && ev.target;
      Object.keys(reg).forEach(function (id) {
        var st = reg[id];
        if (!st || !st.open) return;
        if (target && st.wrap && st.wrap.contains && st.wrap.contains(target)) return;   // 组件内部: 交给按钮自己的 onclick 处理
        close(id);
      });
    }, true);
    document.addEventListener('keydown', function (ev) {
      if (!openOne) return;
      var st = reg[openOne]; if (!st) return;
      var k = ev.key || '';
      var list = st.opts.options || [];
      if (k === 'Escape') { close(openOne); if (ev.preventDefault) ev.preventDefault(); return; }
      if (k === 'Enter') { var it = find(openOne, st.value); choose(openOne, it ? list.indexOf(it) : 0); if (ev.preventDefault) ev.preventDefault(); return; }
      var d = (k === 'ArrowDown') ? 1 : (k === 'ArrowUp' ? -1 : 0);
      if (d) {
        var cur = list.indexOf(find(openOne, st.value));
        var nxt = Math.max(0, Math.min(list.length - 1, (cur < 0 ? 0 : cur + d)));
        set(openOne, list[nxt] && list[nxt].value);
        if (ev.preventDefault) ev.preventDefault();
        return;
      }
      if (/^[1-9]$/.test(k)) { choose(openOne, parseInt(k, 10) - 1); if (ev.preventDefault) ev.preventDefault(); }
    }, true);
  }

  // onChange 除了登记组件回调, 还把同一个函数挂到根的 onchange 上(原生习惯) —— 门禁与老代码都能看到"这个控件有人管"。
  function onChange(id, fn) {
    var st = reg[id]; if (!st) return;
    st.onChange = fn;
    if (typeof fn === 'function') st.root.onchange = fn;
  }
  // fire(id): 用**当前值**触发一次 change —— 供门禁/自动化断言模拟"用户做了选择"。
  //   (不伪造值: 断言应先 set 再 fire, 与用户操作等价)
  function fire(id) {
    var st = reg[id]; if (!st) return;
    if (typeof st.onChange === 'function') { try { st.onChange(st.value); } catch (e) {} }
    if (typeof st.root.onchange === 'function') { try { st.root.onchange({ target: st.root, value: st.value }); } catch (e) {} }
  }
  window.__dsel = { mount: mount, get: get, set: set, onChange: onChange, closeAll: closeAll, fire: fire };
})();

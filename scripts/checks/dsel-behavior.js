'use strict';
// 自绘下拉的**行为测试**(F-20260929-02): 用一个极小的 DOM 桩把 dsel.js 跑起来, 逐个模拟真实操作。
// 为什么要这一步: 用户要求"一个一个改, 一个一个自己试试" —— VR 里的人工确认留给最后, 组件行为必须先在本地断言。
// 覆盖: 展开 / 选一项后收回 / 再点按钮收回 / 点外部收回 / Esc / 数字键直选 / 重复 mount 不堆积 / 迁移进度。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeDom() {
  const byId = {};
  function el(tag) {
    const e = {
      tagName: String(tag || 'div').toUpperCase(), style: { cssText: '' }, _text: '', children: [], attrs: {}, _ev: {},
      className: '', parentNode: null,
      set textContent(v) { e._text = String(v); }, get textContent() { return e._text; },
      set innerHTML(v) { if (v === '') e.children = []; e._html = v; }, get innerHTML() { return e._html || ''; },
      appendChild(c) { c.parentNode = e; e.children.push(c); return c; },
      insertBefore(c, ref) { c.parentNode = e; const i = e.children.indexOf(ref); if (i >= 0) e.children.splice(i, 0, c); else e.children.push(c); return c; },
      removeChild(c) { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); return c; },
      remove() { if (e.parentNode) e.parentNode.removeChild(e); },
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute(k) { return k in e.attrs ? e.attrs[k] : null; },
      addEventListener(t, fn) { e._ev[t] = fn; }, removeEventListener() {},
      contains(n) { if (n === e) return true; return e.children.some(function (c) { return c.contains && c.contains(n); }); },
      querySelector() { return null; }, querySelectorAll() { return []; },
      fire(ev) { if (e.onclick) e.onclick(ev || { stopPropagation: function () {}, target: e }); }
    };
    return e;
  }
  const doc = {
    _docEv: {}, createElement: el,
    getElementById(id) { return byId[id] || null; },
    addEventListener(t, fn) { (doc._docEv[t] = doc._docEv[t] || []).push(fn); },
    fire(t, ev) { (doc._docEv[t] || []).forEach(function (f) { f(ev); }); }
  };
  return { doc: doc, el: el, byId: byId };
}

const dom = makeDom();
const sandbox = { window: {}, document: dom.doc, console: console };
sandbox.window.document = dom.doc;
sandbox.window.tr = function (k) { return k; };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'web', 'public', 'dsel.js'), 'utf8'), sandbox);

const __dsel = sandbox.window.__dsel;
const fails = [];
function ok(c, m) { if (c) console.log('  PASS ' + m); else { console.log('  FAIL ' + m); fails.push(m); } }
function listOf(root, wrap) { return wrap.children.filter(function (c) { return c.className === 'dsel-list'; }); }

// 控件与选项
const btn = dom.el('button'); btn.attrs = {}; dom.byId['sel1'] = btn;
const host = dom.el('div'); host.appendChild(btn);
__dsel.mount('sel1', { options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }, { value: 'c', label: '丙' }], value: 'a' });
const wrap = btn.parentNode;
ok(!!wrap && wrap.className === 'dsel-wrap', 'mount 建了容器');
ok(__dsel.get('sel1') === 'a', '初始值 = a');
ok(btn.getAttribute('data-value') === 'a', 'data-value 跟值走(不是文案)');

// 展开
btn.fire();
const lists1 = listOf(btn, wrap);
ok(lists1.length === 1, '点击展开出列表(1 个)');
ok(lists1[0].style.display !== 'none', '列表可见');
ok(lists1[0].children.length === 3, '列表 3 项');

// 选第 2 项 -> 收回
lists1[0].children[1].fire();
ok(__dsel.get('sel1') === 'b', '点第 2 项选中 = b');
ok(btn.textContent === '乙', '按钮文案跟着变');
ok(listOf(btn, wrap)[0].style.display === 'none', '选完立刻收回(本次修的 bug)');

// 再点按钮: 展开 -> 再点 -> 收回
btn.fire();
ok(listOf(btn, wrap)[0].style.display !== 'none', '再点按钮可再展开');
btn.fire();
ok(listOf(btn, wrap)[0].style.display === 'none', '再点按钮收回(不再"关不上")');

// 点外部收回
btn.fire();
dom.doc.fire('click', { target: host });
ok(listOf(btn, wrap)[0].style.display === 'none', '点外部收回');

// Esc 与数字键
btn.fire();
dom.doc.fire('keydown', { key: 'Escape', preventDefault: function () {} });
ok(listOf(btn, wrap)[0].style.display === 'none', 'Esc 收回');
btn.fire();
dom.doc.fire('keydown', { key: '3', preventDefault: function () {} });
ok(__dsel.get('sel1') === 'c', '数字键 3 直选第 3 项(VR 虚拟键盘的关键)');
ok(listOf(btn, wrap)[0].style.display === 'none', '数字键选完也收回');

// 重复 mount(轮询场景): 列表不能堆积, 且不该把已选项丢掉
__dsel.mount('sel1', { options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }, { value: 'c', label: '丙' }] });
ok(listOf(btn, wrap).length === 1, '重复 mount 不会堆出第二个列表');
ok(__dsel.get('sel1') === 'c', '重复 mount 不丢当前值');
btn.fire();
ok(listOf(btn, wrap)[0].children.length === 3, '重复 mount 后列表内容仍正确');

// 原生兼容层(切片 4 的 8 处转换都依赖它): value 读写 + onchange 直接赋值仍可用
__dsel.mount('sel4', { options: [{ value: 'p', label: '甲' }, { value: 'q', label: '乙' }], value: 'p' });
const b4 = dom.el('button'); dom.byId['sel4'] = b4;
__dsel.mount('sel4', { options: [{ value: 'p', label: '甲' }, { value: 'q', label: '乙' }], value: 'p' });
b4.value = 'q';
ok(__dsel.get('sel4') === 'q', '老代码写 $("id").value 生效(兼容层)');
ok(b4.value === 'q', '老代码读 $("id").value 也对');
let seen = null;
b4.onchange = function () { seen = this.value; };
b4.fire();                                   // 点开再点第一项
const l4 = b4.parentNode.children.filter(function (c) { return c.className === 'dsel-list'; })[0];
l4.children[0].fire();
ok(seen === 'p', '直接给 onchange 赋值仍能收到变更(this.value 正确)');

console.log(fails.length ? ('== 行为测试 ' + fails.length + ' 项失败 ==') : '== 行为测试全部通过 ==');
process.exit(fails.length ? 1 : 0);

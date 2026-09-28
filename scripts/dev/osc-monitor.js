'use strict';
// OSC 监听器(开发用, 2026-09-27): 听 VRChat 回传到 9001 的所有 OSC 消息, 用来看
//   ① VRChat 到底会发哪些参数(尤其 Voice / GestureLeft / GestureRight / MuteSelf 这类能不能当触发器);
//   ② 每个地址的变化频率与间隔(判断"手势当 PTT"的延迟够不够);
//   ③ /avatar/change 报出的当前头像 id, 并顺带把该头像的 OSC 配置(哪些参数带 output)找出来。
// 用法:
//   node scripts/dev/osc-monitor.js                # 一直听, 每 5 秒打一次小结, Ctrl+C 结束
//   node scripts/dev/osc-monitor.js --seconds 30   # 听 30 秒后自动结束并打汇总
//   node scripts/dev/osc-monitor.js --learn        # 学习模式: 只显示"能当触发器"的变化(Bool/Int 或低频变化), 过滤 VelocityX 这种高频噪声
//   node scripts/dev/osc-monitor.js --json out.json# 结束时把原始记录落盘
//   node scripts/dev/osc-monitor.js --port 9002    # 换端口
// 注意: 9001 是 VRChat 的 OSC 输出端口, VRChat 只往这里发; 若被别的工具占用会收不到 —— 用 --port 前先在 VRChat 侧无法改端口,
//       所以正确做法是关掉占用 9001 的那个工具。
const fs = require('fs');
const path = require('path');
const { UDPPort } = require('osc');

const argv = process.argv.slice(2);
function argOf(name, def) { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && argv[i + 1][0] !== '-' ? argv[i + 1] : def; }
const PORT = Number(argOf('port', 9001));
const SECONDS = Number(argOf('seconds', 0));
const LEARN = argv.indexOf('--learn') >= 0;
const JSONOUT = argOf('json', '');
const BUILTIN = ['Voice', 'GestureLeft', 'GestureRight', 'GestureLeftWeight', 'GestureRightWeight', 'MuteSelf', 'AFK', 'Seated', 'VRMode', 'Grounded', 'Viseme', 'Earmuffs', 'InStation'];

const t0 = Date.now();
const stats = new Map();       // address -> {n, changes, last, lastValue, gaps: []}
const raw = [];
function rel() { return ((Date.now() - t0) / 1000).toFixed(2).padStart(7) + 's'; }
function valStr(args) { return (args || []).map(function (a) { const v = a.value; return (typeof v === 'string') ? JSON.stringify(v) : String(v); }).join(' '); }
function isBuiltin(addr) { const m = /^\/avatar\/parameters\/(.+)$/.exec(addr); return !!m && BUILTIN.indexOf(m[1]) >= 0; }

function onMessage(msg) {
  const addr = msg.address;
  const vs = valStr(msg.args);
  const now = Date.now();
  let st = stats.get(addr);
  if (!st) { st = { n: 0, changes: 0, last: 0, lastValue: null, gaps: [] }; stats.set(addr, st); }
  st.n++;
  const changed = st.lastValue !== vs;
  if (changed) { st.changes++; if (st.last) st.gaps.push(now - st.last); st.last = now; st.lastValue = vs; }
  raw.push({ ms: now - t0, addr: addr, value: vs });
  if (raw.length > 20000) raw.shift();
  const silent = LEARN && !isBuiltin(addr) && !/^(Bool|Int)$/.test(String((msg.args && msg.args[0] && msg.args[0].type) || '')) && st.gaps.length > 3 && median(st.gaps) < 150;
  if (!LEARN || (changed && !silent)) {
    const tag = isBuiltin(addr) ? ' ★内置(可当触发器)' : '';
    console.log(rel() + ' ' + addr.padEnd(46) + ' ' + vs.padEnd(12) + (changed ? '变化' : '    ') + tag);
  }
}
function median(arr) { if (!arr.length) return 0; const a = arr.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; }

function avatarConfigInfo(avatarId) {
  try {
    const base = path.join(process.env.USERPROFILE || '', 'AppData', 'LocalLow', 'VRChat', 'VRChat', 'OSC');
    let hit = null;
    (function walk(d) {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.toLowerCase() === (String(avatarId).toLowerCase() + '.json')) hit = p;
      }
    })(base);
    if (!hit) return '(本机 OSC 目录里没有这个头像的配置)';
    const rawj = fs.readFileSync(hit, 'utf8');
    const j = JSON.parse(rawj.charCodeAt(0) === 0xFEFF ? rawj.slice(1) : rawj);
    const ps = j.parameters || [];
    const outs = ps.filter(function (x) { return x.output && x.output.address; });
    const types = {};
    outs.forEach(function (x) { const t = (x.output && x.output.type) || '?'; types[t] = (types[t] || 0) + 1; });
    return '头像 "' + (j.name || '?') + '": ' + ps.length + ' 个参数, ' + outs.length + ' 个会发出来 ' + JSON.stringify(types) +
      '; 内置可当触发器的: ' + BUILTIN.filter(function (b) { return ps.some(function (x) { return x.name === b; }); }).join(', ');
  } catch (e) { return '(读头像配置失败: ' + e.message + ')'; }
}

const port = new UDPPort({ localAddress: '127.0.0.1', localPort: PORT, metadata: true });
port.on('message', function (msg) {
  if (msg.address === '/avatar/change') {
    console.log(rel() + ' /avatar/change -> ' + valStr(msg.args));
    console.log('         ' + avatarConfigInfo((msg.args && msg.args[0] && msg.args[0].value) || ''));
  }
  onMessage(msg);
});
port.on('error', function (e) { console.log('OSC 监听出错: ' + ((e && e.message) || e)); });
port.open();
console.log('');
console.log('=== VRCLiveBoard OSC 监听器(实验工具, 只在监听, 不改任何东西) ===');
console.log('要做的事:');
console.log('  1) 先开 VRChat, 并在游戏里确认 OSC 已开: Action Menu -> Options -> OSC -> Enabled');
console.log('  2) 戴上头显, 接下来 ' + (SECONDS || 60) + ' 秒按顺序做这些动作:');
console.log('       a. 右手【握拳】保持 2 秒 -> 张开, 重复 3 次');
console.log('       b. 按住【语音键】说一句话(2~3 秒), 重复 2 次');
console.log('       c. 切一次【静音】, 再切回来');
console.log('       d. 做两个手势: 食指指(Point)、胜利(V), 各保持 2 秒');
console.log('  3) 结束后数据会自动存到 logs\\osc-quest3.json(程序目录下), 跟开发者说一声即可');
console.log('');
console.log('监听中: 127.0.0.1:' + PORT + (LEARN ? ' (学习模式: 只显示能当触发器的变化)' : '') + (SECONDS ? (', ' + SECONDS + ' 秒后结束') : ', 按 Ctrl+C 结束'));
console.log('----------------------------------------------------------------');

function summary() {
  const rows = Array.from(stats.entries()).sort(function (a, b) { return b[1].n - a[1].n; });
  console.log('');
  console.log('=== 汇总: 共 ' + raw.length + ' 条消息 / ' + rows.length + ' 个地址 ===');
  console.log('  地址'.padEnd(48) + '条数  变化  中位间隔  最小间隔  最后值');
  rows.forEach(function (kv) {
    const a = kv[0], s = kv[1];
    console.log('  ' + a.padEnd(46) + String(s.n).padStart(5) + String(s.changes).padStart(6) + String(median(s.gaps) + 'ms').padStart(10) + String((s.gaps.length ? Math.min.apply(null, s.gaps) : 0) + 'ms').padStart(10) + '  ' + String(s.lastValue).slice(0, 14) + (isBuiltin(a) ? ' ★' : ''));
  });
  const builtinsSeen = rows.filter(function (kv) { return isBuiltin(kv[0]) && kv[1].changes > 0; }).map(function (kv) { return kv[0].split('/').pop(); });
  console.log('内置参数里出现过的(可当触发器): ' + (builtinsSeen.length ? builtinsSeen.join(', ') : '(无)'));
  if (!raw.length) {
    console.log('');
    console.log('!!! 一条都没收到, 请按顺序检查:');
    console.log('    1) VRChat 里 OSC 是不是真的开着(Action Menu -> Options -> OSC -> Enabled)');
    console.log('    2) 有没有别的工具占用了 9001:  netstat -ano | findstr :9001');
    console.log('    3) VRChat 是不是正在运行(参数要游戏在跑才会发)');
    console.log('    4) 这 ' + Math.round((Date.now() - t0) / 1000) + ' 秒里有没有做动作(参数是"变化时才发", 不动就没有消息)');
    console.log('    5) 也可以在游戏里走两步(移动本身也会发参数)来确认链路是否通');
  }
  if (JSONOUT) { try { fs.writeFileSync(JSONOUT, JSON.stringify({ port: PORT, seconds: (Date.now() - t0) / 1000, messages: raw }, null, 1), 'utf8'); console.log('原始记录已写入: ' + JSONOUT); } catch (e) { console.log('写文件失败: ' + e.message); } }
}

if (SECONDS > 0) setTimeout(function () { summary(); try { port.close(); } catch (e) {} process.exit(0); }, SECONDS * 1000);
else setInterval(function () { console.log('  … 已收 ' + raw.length + ' 条 / ' + stats.size + ' 个地址'); }, 5000);
process.on('SIGINT', function () { summary(); try { port.close(); } catch (e) {} process.exit(0); });

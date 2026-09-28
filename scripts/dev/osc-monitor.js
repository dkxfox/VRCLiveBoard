'use strict';
// OSC 监听器(开发用, 2026-09-27): 听 VRChat 回传到 9001 的所有 OSC 消息, 用来看
//   ① VRChat 到底会发哪些参数(尤其 Voice / GestureLeft / GestureRight / MuteSelf 这类能不能当触发器);
//   ② 每个地址的变化频率与间隔(判断"手势当 PTT"的延迟够不够);
//   ③ /avatar/change 报出的当前头像 id, 并顺带把该头像的 OSC 配置(哪些参数带 output)找出来。
// 用法:
//   node scripts/dev/osc-monitor.js                # 一直听, 每 5 秒打一次小结, Ctrl+C 结束
//   node scripts/dev/osc-monitor.js --seconds 30   # 听 30 秒后自动结束并打汇总
//   node scripts/dev/osc-monitor.js --learn        # 学习模式: 只显示"能当触发器"的变化(Bool/Int 或低频变化), 过滤 VelocityX 这种高频噪声
//   node scripts/dev/osc-monitor.js --json auto    # 结束时把原始记录落盘(logs/osc-<时间戳>.json, 不会覆盖上一次)
//   node scripts/dev/osc-monitor.js --analyze logs/osc-20260928-103441.json# 事后分析一份已保存的记录(含延迟上限估算)
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
const MUTEDTEST = argv.indexOf('--mutedtest') >= 0;
const JSONOUT = argOf('json', '');
const BUILTIN = ['Voice', 'GestureLeft', 'GestureRight', 'GestureLeftWeight', 'GestureRightWeight', 'MuteSelf', 'AFK', 'Seated', 'VRMode', 'Grounded', 'Viseme', 'Earmuffs', 'InStation'];

// ---- 分析模式: 事后读一份保存的记录(不需要 VRChat 在跑) ----
if (argv.indexOf('--analyze') >= 0) {
  const f = argOf('analyze', '');
  if (!f || !fs.existsSync(f)) { console.log('用法: node scripts/dev/osc-monitor.js --analyze <保存的 json>'); process.exit(1); }
  analyzeFile(f);
  process.exit(0);
}

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
if (MUTEDTEST) {
  console.log('=== 静音说话测试(结论由窗口自动给出) ===');
  console.log('请按顺序做:');
  console.log('  1) 在 VRChat 里按静音键, 确认自己是【静音】(游戏里说话时静音图标会亮)');
  console.log('  2) 保持静音, 正常说两句话(每句 3~4 秒), 中间停 2 秒');
  console.log('  3) 说完等 3 秒');
  console.log('  4) 取消静音, 再说一句话(3~4 秒) —— 这是对照组');
  console.log('  5) 时间到了窗口会直接给出结论');
  console.log('');
}
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
  printMuteVerdict(raw);
  if (!raw.length) {
    console.log('');
    console.log('!!! 一条都没收到, 请按顺序检查:');
    console.log('    1) VRChat 里 OSC 是不是真的开着(Action Menu -> Options -> OSC -> Enabled)');
    console.log('    2) 有没有别的工具占用了 9001:  netstat -ano | findstr :9001');
    console.log('    3) VRChat 是不是正在运行(参数要游戏在跑才会发)');
    console.log('    4) 这 ' + Math.round((Date.now() - t0) / 1000) + ' 秒里有没有做动作(参数是"变化时才发", 不动就没有消息)');
    console.log('    5) 也可以在游戏里走两步(移动本身也会发参数)来确认链路是否通');
  }
  if (JSONOUT) {
    try {
      let out = JSONOUT;
      if (out === 'auto' || out === 'AUTO') {
        const d = new Date();
        const p2 = function (n) { return ('0' + n).slice(-2); };
        out = path.join('logs', 'osc-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '.json');
      }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify({ port: PORT, seconds: (Date.now() - t0) / 1000, messages: raw }, null, 1), 'utf8');
      console.log('原始记录已写入: ' + path.resolve(out));
    } catch (e) { console.log('写文件失败: ' + e.message); }
  }
}

if (SECONDS > 0) setTimeout(function () { summary(); try { port.close(); } catch (e) {} process.exit(0); }, SECONDS * 1000);
else setInterval(function () { console.log('  … 已收 ' + raw.length + ' 条 / ' + stats.size + ' 个地址'); }, 5000);
process.on('SIGINT', function () { summary(); try { port.close(); } catch (e) {} process.exit(0); });

// ---- 事后分析(2026-09-28 加): 读一份保存的记录, 打出与监听结束相同的表, 外加"延迟上限估算" ----
// 延迟估算原理: 挑消息最多的那个参数(如 Upright, ~87Hz ≈ 10ms 一条)当**心跳**, 看每个事件距离"它之前最近的一次心跳"
// 有多久 —— 这就是 VRChat 从状态变化到发出 OSC 的延迟上限(受心跳间隔限制)。
function analyzeFile(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const msgs = j.messages || [];
  console.log('=== 分析: ' + file + ' ===');
  console.log('时长 ' + Number(j.seconds || 0).toFixed(1) + 's   消息 ' + msgs.length + ' 条   端口 ' + j.port);
  const by = new Map();
  msgs.forEach(function (m) {
    let s = by.get(m.addr);
    if (!s) { s = { n: 0, changes: 0, last: null, lastMs: 0, gaps: [], first: null, events: [] }; by.set(m.addr, s); }
    s.n++;
    if (s.last !== m.value) {
      s.changes++;
      if (s.lastMs) s.gaps.push(m.ms - s.lastMs);
      s.lastMs = m.ms; s.last = m.value;
      if (s.first === null) s.first = m.ms;
      s.events.push({ ms: m.ms, v: m.value });
    }
  });
  const rows = Array.from(by.entries()).sort(function (a, b) { return b[1].n - a[1].n; });
  console.log('');
  console.log('  地址'.padEnd(48) + '条数  变化  中位间隔  首现');
  rows.forEach(function (kv) {
    const a = kv[0], s = kv[1];
    const nm = a.replace('/avatar/parameters/', '');
    console.log('  ' + a.padEnd(46) + String(s.n).padStart(5) + String(s.changes).padStart(6) + String(median(s.gaps) + 'ms').padStart(10) + String((s.first / 1000).toFixed(2) + 's').padStart(9) + (isBuiltin(a) ? ' ★' : (nm.indexOf('Gesture') === 0 ? ' (头像自定义手势参数)' : '')));
  });
  const built = rows.filter(function (kv) { return isBuiltin(kv[0]); });
  if (built.length) {
    console.log('');
    console.log('=== 内置参数逐次变化(时间/值, 最多 30 次) ===');
    built.forEach(function (kv) {
      console.log('  ' + kv[0].replace('/avatar/parameters/', '').padEnd(20) + kv[1].changes + ' 次: ' + kv[1].events.slice(0, 30).map(function (e) { return (e.ms / 1000).toFixed(2) + 's=' + String(e.v).slice(0, 8); }).join('  '));
    });
  }
  const hb = rows[0];
  if (hb && hb[1].gaps.length > 5) {
    const hbMs = msgs.filter(function (m) { return m.addr === hb[0]; }).map(function (m) { return m.ms; });
    console.log('');
    console.log('=== 延迟上限估算(心跳 = ' + hb[0] + ', ' + hbMs.length + ' 条, 中位 ' + median(hb[1].gaps) + 'ms) ===');
    built.forEach(function (kv) {
      const ds = [];
      kv[1].events.forEach(function (e) {
        let best = null;
        for (let i = 0; i < hbMs.length; i++) { if (hbMs[i] <= e.ms) best = hbMs[i]; else break; }
        if (best !== null) ds.push(e.ms - best);
      });
      if (ds.length) console.log('  ' + kv[0].replace('/avatar/parameters/', '').padEnd(20) + '事件 ' + ds.length + ' 次, 距前一次心跳: 中位 ' + median(ds) + 'ms / 最大 ' + Math.max.apply(null, ds) + 'ms');
    });
  }
  printMuteVerdict(msgs);
  const noise = rows.filter(function (kv) { return !isBuiltin(kv[0]) && median(kv[1].gaps) > 0 && median(kv[1].gaps) < 150; });
  if (noise.length) {
    console.log('');
    console.log('=== 高频噪声(学习模式会自动过滤这些; 它们不适合当触发器) ===');
    noise.forEach(function (kv) { console.log('  ' + kv[0].padEnd(46) + '中位间隔 ' + median(kv[1].gaps) + 'ms'); });
  }
}

// ---- 静音期间 Voice 行为(2026-09-28 加): 回答「静音玩家能不能用说话即听写」----
function printMuteVerdict(msgs) {
  const mutes = msgs.filter(function (m) { return m.addr === '/avatar/parameters/MuteSelf'; });
  const voices = msgs.filter(function (m) { return m.addr === '/avatar/parameters/Voice'; });
  if (!mutes.length || !voices.length) { return; }
  let muted = null, onVoice = 0, offVoice = 0, unknown = 0, muteMax = 0, offMax = 0, lastState = null, lastMs = null, mutedMs = 0;
  const endMs = msgs.length ? msgs[msgs.length - 1].ms : 0;
  msgs.forEach(function (m) {
    if (m.addr === '/avatar/parameters/MuteSelf') {
      const v = String(m.value) === 'true';
      if (lastState === true && lastMs !== null) mutedMs += (m.ms - lastMs);
      lastState = v; lastMs = m.ms; muted = v;
    } else if (m.addr === '/avatar/parameters/Voice') {
      const val = Number(m.value) || 0;
      if (muted === true) { onVoice++; if (val > muteMax) muteMax = val; }
      else if (muted === false) { offVoice++; if (val > offMax) offMax = val; }
      else unknown++;
    }
  });
  if (lastState === true && lastMs !== null) mutedMs += Math.max(0, endMs - lastMs);   // 收尾时仍处于静音状态
  console.log('');
  console.log('=== 静音期间 Voice 行为(这次测试要回答的问题) ===');
  console.log('  MuteSelf 切换 ' + mutes.length + ' 次; 静音累计约 ' + (mutedMs / 1000).toFixed(1) + 's');
  console.log('  Voice 变化: 非静音期间 ' + offVoice + ' 次(峰值 ' + offMax.toFixed(4) + ') / 静音期间 ' + onVoice + ' 次(峰值 ' + muteMax.toFixed(4) + ')' + (unknown ? ' / 状态未知 ' + unknown + ' 次' : ''));
  if (onVoice > 0 && muteMax > 0.005) {
    console.log('  >>> 结论: **静音时 Voice 仍会上报说话电平** -> 「说话即听写」可以给静音玩家用(VRChat 的静音只是不外发声音, 本地电平照旧)。');
  } else if (mutedMs >= 5000 && offVoice > 0) {
    console.log('  >>> 结论: **静音的那 ' + (mutedMs / 1000).toFixed(1) + ' 秒里 Voice 一次都没动**(非静音时动了 ' + offVoice + ' 次) -> 若你静音时确实说了话, 就说明**静音会抑制 Voice**, 「说话即听写」只适合不静音的玩家, 静音玩家请用「握拳」这类手势触发器。');
    console.log('      (若那段时间你其实没说话, 请重跑一次并确保: 先静音 -> 说话 -> 再取消静音。)');
  } else {
    console.log('  >>> 数据不足: 这次没有同时出现「静音状态切换」与「说话电平」。请确认: ① 真的切过静音键 ② 静音时说了话 ③ 监听窗口覆盖了这两件事。');
  }
}

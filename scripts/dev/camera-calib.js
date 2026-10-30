#!/usr/bin/env node
'use strict';
// 相机标定/实验小工具(开发用; scripts/dev 不进发布包)
// 用法: node scripts/dev/camera-calib.js <命令> [参数...]
//   probe                      列出 /usercamera 与 /dolly 的当前值
//   shot <标签>                拍一张(并打印最新照片名)
//   pulse <轴> <毫秒>          输入脉冲(MoveForward/LookRight/...), 结束一律归零
//   set <地址> <值>            给 /usercamera 或 /dolly 下的地址写值(true/false/数字; 整数会被打成 type i)
//   setf <地址> <数值>         同上但强制 float32(端点 TYPE=f 时用这个, 例如 SmoothingStrength)
//   fly <on|off>               飞行模式开关
//   speed <值>                 FlySpeed
//   turn <值>                  TurnSpeed
//   streaming <on|off>         直播相机(/usercamera/Streaming)
//   dolly-play [延迟秒]        触发运镜播放(默认 1 秒)
//   dolly-stop                 停止运镜
//   dolly-import <字符串>      试导入(语义未证实)
//   pose-listen [秒]          只监听 Pose 并打印(诊断 9001 是否空闲、游戏是否在发)
//   move-forward <米>          闭环: 相机向前自动走 N 米后停住并报误差(默认 1.000)
//   move-left <米>             闭环: 相机向左平移 N 米后停住并报误差(默认 1.000)
//   move-vertical <米>         闭环竖直移动(正=上/负=下; 实测 /input/LookVertical 就是上下平移轴)
//   move-to <前> <左> <上>    三维点到点(相机系, 米; 正=前/左/上, 负=后/右/下)
//   rotate <角度>             闭环转向(正=右转/负=左转; 临时 TurnSpeed=0.1 求精度, 结束还原)
//   range <轴> <秒> [值]      范围探针: 按住轴 N 秒记录轨迹, 判断"在哪里停住"(跟随模式包络线用)
//   record <秒> [auto]        录制轨迹(用户自由飞, Pose 约 61Hz) -> logs/traj-<时间>.json; auto=等你开始飞再录
//   traj-info <文件>          查看轨迹统计(样本/时长/范围/路径长/俯仰范围)
//   replay <文件> [步长秒]    重放轨迹(相对起点: 位置+偏航; 路点串行, 比原速慢; 俯仰无法重放)
//   replay2 <文件> [倍速]     连续重放 v2(约10Hz闭环, 无长停稳, 目标接近原速; 俯仰无法重放)
//   replay3 <文件> [倍速] [最长秒]  平滑重放 v3(前馈速度+死区修正+降速提精度; 治"运动中抖动")
//   replay2s <文件> [倍速]     v2.2 + 平滑偏航(偏航改 bool 脉冲, 治 LookHorizontal 模拟量只有±1导致的甩头)
//   replay-seg <文件> [段数=3] [倍速] [最多跑几段]   分段锚定重放: 每段开环前馈(不逐tick反馈) + 段末终点修正(治累积误差/越跑越偏)
//   axis <轴名> <值> <毫秒>    通用 float 轴探针(保持-读数-归零; 例: axis LookVertical 1 200)
//   selftest-move              离线自测(不连 VRChat): 模拟不同真实速度, 校验控制律
//   zero                       所有输入轴归零
const dgram = require('dgram'); const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
function oscqPort() {
  const dir = path.join(os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat');
  try {
    const logs = fs.readdirSync(dir).filter(f => /^output_log.*\.txt$/.test(f)).map(f => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const l of logs) { const m = /type OSCQuery on (\d+)/.exec(fs.readFileSync(l.f, 'utf8')); if (m) return Number(m[1]); }
  } catch (e) {}
  return 9001;
}
const PORT = oscqPort();
const OSC_PORT = 9000;
function oscString(str) { const b = Buffer.from(String(str), 'utf8'); const o = Buffer.alloc(Math.ceil((b.length + 1) / 4) * 4); b.copy(o, 0); return o; }
function oscMsg(addr, args) {
  const list = Array.isArray(args) ? args : [];
  const tags = ',' + list.map(a => typeof a === 'string' ? 's' : (typeof a === 'boolean' ? (a ? 'T' : 'F') : (Number.isInteger(a) ? 'i' : 'f'))).join('');
  const parts = [oscString(addr), oscString(tags)];
  list.forEach(a => { if (typeof a === 'string') parts.push(oscString(a)); else if (typeof a === 'number') { const b = Buffer.alloc(4); if (Number.isInteger(a)) b.writeInt32BE(a); else b.writeFloatBE(a); parts.push(b); } });
  return Buffer.concat(parts);
}
const sock = dgram.createSocket('udp4');
const send = (addr, args) => new Promise(r => sock.send(oscMsg(addr, args), OSC_PORT, '127.0.0.1', () => r(true)));
// ⚠️ 2026-10-22 实发: oscMsg 把"整数值"打成 OSC type 'i', 而 /usercamera 的数值端点 TYPE=f;
//    往 SmoothingStrength 写 0 之后 OSCQuery 读回变成 7.96e8(脏值) -> 这类端点必须用 float32。
function oscMsgF(addr, value) { const b = Buffer.alloc(4); b.writeFloatBE(Number(value) || 0); return Buffer.concat([oscString(addr), oscString(',f'), b]); }
const sendF = (addr, value) => new Promise(r => sock.send(oscMsgF(addr, value), OSC_PORT, '127.0.0.1', () => r(true)));
// 数字写入口: 先查端点 TYPE, i 用整数编码, 其余(f/未知)一律 float32 —— 避免再写出 7.96e8 那种脏值
async function sendNum(addr, value) { const t = await getType(addr); if (t === 'i') return send(addr, [Math.round(Number(value))]); return sendF(addr, value); }
const getVal = p => new Promise(res => { const rq = http.get('http://127.0.0.1:' + PORT + p, { timeout: 4000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d).VALUE); } catch (e) { res(null); } }); }); rq.on('error', () => res(undefined)); rq.on('timeout', () => { rq.destroy(); res(undefined); }); });
// 读端点 OSCQuery 的 TYPE(f=浮点 / i=整数), 用于按端点类型选编码(见 sendF 的教训)
const getType = p => new Promise(res => { const rq = http.get('http://127.0.0.1:' + PORT + p, { timeout: 4000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d).TYPE); } catch (e) { res(null); } }); }); rq.on('error', () => res(null)); rq.on('timeout', () => { rq.destroy(); res(null); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AXES = ['MoveForward', 'MoveBackward', 'MoveLeft', 'MoveRight', 'LookLeft', 'LookRight'];
async function zeroAll() { for (const a of AXES) { await send('/input/' + a, [false]); await sleep(40); } }
const picRoot = path.join(os.homedir(), 'Pictures', 'VRChat');
function photos() { const out = []; (function w(d) { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (/\.png$/i.test(e.name)) out.push({ p, t: fs.statSync(p).mtimeMs, n: e.name }); } } catch (x) {} })(picRoot); return out.sort((a, b) => b.t - a.t); }
const USECAM = ['ShowUIInCamera','Flying','Lock','LocalPlayer','RemotePlayer','Environment','GreenScreen','SmoothMovement','LookAtMe','AutoLevelRoll','AutoLevelPitch','ShowFocus','Streaming','TriggerTakesPhotos','DollyPathsStayVisible','FlingToClose','AudioFromCamera','RollWhileFlying','OrientationIsLandscape','Zoom','Exposure','FocalDistance','Aperture','Hue','Saturation','Lightness','LookAtMeXOffset','LookAtMeYOffset','FlySpeed','TurnSpeed','SmoothingStrength','PhotoRate'];
// ===== 2026-10-22 新增: Pose 监听 + 闭环点位移动 + 离线自测 =====
// 依据: docs/CAMERA-OSC-CAPABILITY.md 第 7.10 节(用户配合实测)。
//   /usercamera/Pose  ,ffffff  [posX, posY(高度 m), posZ, pitch(°), yaw(°), roll(°)]
//   世界坐标、角度 0~360; **事件驱动** —— 相机静止时不发, 运动时约 61Hz => "当前姿态" = 最后一次收到的值。
// ⚠️ 9001 是"游戏 -> 客户端"回传口, 同一时刻只能一个程序收; 被占用时这里会明确报错(不静默)。
const POSE_PORT = 9001;
const POSE_ADDR = '/usercamera/Pose';
let poseSock = null;
let lastPose = null;       // { pos:[x,y,z], rot:[pitch,yaw,roll] }
let lastPoseAt = 0;
let poseT0 = 0;
const poseSamples = [];
const round3 = (v) => Math.round(Number(v) * 1000) / 1000;
function parseOsc(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  const aEnd = buf.indexOf(0);
  if (aEnd < 0) return null;
  const addr = buf.slice(0, aEnd).toString('utf8');
  let p = aEnd + 1; while (p % 4) p++;
  const tEnd = buf.indexOf(0, p);
  if (tEnd < 0) return null;
  const tags = buf.slice(p, tEnd).toString('utf8');
  p = tEnd + 1; while (p % 4) p++;
  const args = [];
  for (let i = 1; i < tags.length; i++) {
    const t = tags[i];
    if (t === 'f') { args.push(buf.readFloatBE(p)); p += 4; }
    else if (t === 'i') { args.push(buf.readInt32BE(p)); p += 4; }
    else return null;   // Pose 只有 float; 其它消息(字符串等)不解析, 直接忽略
  }
  return { addr, tags, args };
}
function bindPose() {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', (m) => {
      const o = parseOsc(m);
      if (!o || o.addr !== POSE_ADDR || o.args.length < 6) return;
      const v = o.args.slice(0, 6).map(Number);
      if (v.some((x) => !isFinite(x))) return;
      lastPose = { pos: [v[0], v[1], v[2]], rot: [v[3], v[4], v[5]] };
      lastPoseAt = Date.now();
      if (!poseT0) poseT0 = lastPoseAt;
      poseSamples.push({ ms: lastPoseAt - poseT0, pos: lastPose.pos.map(round3), rot: lastPose.rot.map((x) => +x.toFixed(2)) });
      if (poseSamples.length > 20000) poseSamples.shift();
    });
    s.on('error', (e) => reject(new Error('UDP ' + POSE_PORT + ' 监听失败(可能被别的程序占用): ' + String((e && e.message) || e))));
    s.bind(POSE_PORT, '127.0.0.1', () => resolve(s));
  });
}
function waitPose(afterAt, timeoutMs) {
  const t0w = Date.now();
  return new Promise((resolve) => {
    (function poll() {
      if (lastPoseAt > afterAt) return resolve(true);
      if (Date.now() - t0w > timeoutMs) return resolve(false);
      setTimeout(poll, 30);
    })();
  });
}
function dist3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
// 控制律(实机闭环与离线自测共用): 误差越大脉冲越长; 0.6 步进防过冲; 最短 30ms
function nextPulseMs(err, speed) {
  if (err <= 0.04) return 0;
  const raw = (err / Math.max(0.2, speed)) * 1000 * 0.6;
  return Math.max(30, Math.min(400, Math.round(raw)));
}
async function pulseAxis(axis, ms) {
  const dur = Math.max(30, Math.min(20000, Math.round(ms) || 40));
  try { await send('/input/' + axis, [true]); await sleep(dur); }
  finally { await send('/input/' + axis, [false]); }
  await sleep(600);   // 等相机停稳; Pose 事件驱动, 最后一帧就是终点
}
async function moveClosed(axis, targetM) {
  const label = axis === 'MoveLeft' ? '向左' : (axis === 'MoveRight' ? '向右' : (axis === 'MoveBackward' ? '向后' : '向前'));
  const target = Math.max(0.05, Math.min(20, Number(targetM) || 1));
  const tol = 0.15;         // 判 PASS 的误差线(米)
  const stopAt = 0.05;      // 控制器提前量(比判线更紧)
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  // OSCQuery 的 VALUE 是数组(如 [true]/[5]); 先归一化, 否则 [true] !== true 会把恢复逻辑带偏
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = {
    flying: one(await getVal('/usercamera/Flying')),
    flySpeed: one(await getVal('/usercamera/FlySpeed')),
    turnSpeed: one(await getVal('/usercamera/TurnSpeed')),
    smoothing: one(await getVal('/usercamera/SmoothingStrength')),
  };
  console.log('前置状态: Flying=' + JSON.stringify(pre.flying) + ' FlySpeed=' + JSON.stringify(pre.flySpeed) +
    ' TurnSpeed=' + JSON.stringify(pre.turnSpeed) + ' Smoothing=' + JSON.stringify(pre.smoothing));
  poseSock = await bindPose();
  const s0 = Number(pre.smoothing);
  try {
    if (pre.flying !== true) {
      await send('/usercamera/Flying', [true]); await sleep(500);
      console.log('飞行模式已打开 -> 读回 ' + JSON.stringify(await getVal('/usercamera/Flying')));
    }
    if (isFinite(s0) && s0 !== 0) {
      await sendF('/usercamera/SmoothingStrength', 0); await sleep(400);
      console.log('SmoothingStrength 写 0 -> 读回 ' + JSON.stringify(await getVal('/usercamera/SmoothingStrength')) + '(原值 ' + JSON.stringify(pre.smoothing) + ', 结束还原)');
    }
    // 1) 取初始姿态: 相机静止时 Pose 不发 -> 先轻推 100ms(位置以推完后的姿态为起点)
    if (!lastPose) {
      await pulseAxis(axis, 100);
      if (!(await waitPose(0, 2000)) && axis !== 'MoveForward') {
        console.log('⚠️ ' + label + ' 微推后收不到 Pose, 改用 MoveForward 取姿态');
        await pulseAxis('MoveForward', 100);
      }
      if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose(检查: 9001 是否被占用 / 是否已在世界里 / 相机是否可动)');
    }
    await sleep(300);
    const start = lastPose.pos.slice();
    // 2) 标定脉冲 120ms -> 实测速度(不依赖 OSC 读回; 教训: 读回值≠真实速度)
    const calBefore = lastPose.pos.slice();
    await pulseAxis(axis, 120);
    const calDist = dist3(lastPose.pos, calBefore);
    if (calDist <= 0.005) throw new Error(label + '(' + axis + ') 未产生位移 —— 该方向可能不可用, 已停止(不盲目重试)');
    let speed = calDist / 0.12;
    console.log('标定: ' + label + ' 120ms 位移 ' + calDist.toFixed(3) + ' m -> 估速度 ' + speed.toFixed(2) + ' m/s');
    // 3) 闭环逐步逼近(短脉冲, 每次读 Pose 算误差)
    let pulses = 1;
    for (let i = 0; i < 24; i++) {
      const travelled = dist3(lastPose.pos, start);
      const err = target - travelled;
      if (err <= stopAt) break;
      const ms = nextPulseMs(err, speed);
      if (!ms) break;
      const before = lastPose.pos.slice();
      await pulseAxis(axis, ms);
      const d = dist3(lastPose.pos, before);
      pulses++;
      if (d > 0.005) speed = d / (ms / 1000);   // 用实测更新速度估计
    }
    const end = lastPose.pos.slice();
    const travelled = dist3(end, start);
    const out = {
      at: new Date().toISOString(),
      axis: axis, label: label,
      target: round3(target), tolerance: tol,
      start: start.map(round3), end: end.map(round3),
      vector: [round3(end[0] - start[0]), round3(end[1] - start[1]), round3(end[2] - start[2])],
      travelled: round3(travelled),
      error: round3(travelled - target),
      pass: Math.abs(travelled - target) <= tol,
      pulses: pulses, speed: +speed.toFixed(2),
      pre: pre, calibration: { ms: 120, moved: round3(calDist) },
      poseSamples: poseSamples.length,
      samples: poseSamples,
    };
    try {
      fs.mkdirSync('logs', { recursive: true });
      out.file = 'logs/pose-' + axis.toLowerCase() + '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
      fs.writeFileSync(out.file, JSON.stringify(out, null, 1), 'utf8');
    } catch (e) { out.file = null; }
    console.log('结果(' + label + '): 起点 [' + start.map((x) => x.toFixed(2)).join(', ') + '] -> 终点 [' + end.map((x) => x.toFixed(2)).join(', ') + ']  位移向量 [' + (end[0] - start[0]).toFixed(2) + ', ' + (end[1] - start[1]).toFixed(2) + ', ' + (end[2] - start[2]).toFixed(2) + ']');
    console.log('      实际位移 ' + travelled.toFixed(3) + ' m / 误差 ' + ((travelled - target) >= 0 ? '+' : '') + ((travelled - target) * 100).toFixed(1) + ' cm / 脉冲 ' + pulses + ' 次 / Pose 采样 ' + poseSamples.length + ' 条');
    if (out.file) console.log('      明细已存 ' + out.file);
    return out;
  } finally {
    try { await zeroAll(); } catch (e) {}
    if (isFinite(s0) && s0 !== 0) { try { await sendF('/usercamera/SmoothingStrength', s0); await sleep(250); console.log('SmoothingStrength 已还原 -> ' + JSON.stringify(await getVal('/usercamera/SmoothingStrength'))); } catch (e) {} }
    if (pre.flying === false) { try { await send('/usercamera/Flying', [false]); await sleep(250); } catch (e) {} }
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}
async function selftestMove() {
  // 纯离线(不建 socket / 不发 OSC): 模拟"真实速度未知"的相机, 对照
  //   开环: 按文档常数 2.86 m/s 一次脉冲走 1 米;
  //   闭环: 先 120ms 标定, 再按误差分步逼近(与实机同一控制律)。
  const CONST = 2.86;   // 能力总表 7.10.5 的实测量级
  const cases = [1.4, 2.86, 4.0];
  const rows = [];
  let allPass = true;
  for (const actual of cases) {
    const openMs = Math.round(1 / CONST * 1000);
    const openErr = actual * openMs / 1000 - 1;
    let pos = actual * 0.12;           // 标定脉冲 120ms
    let pulses = 1;
    let est = pos / 0.12;              // 标定得到的估计速度
    for (let i = 0; i < 24; i++) {
      const err = 1 - pos;
      if (err <= 0.05) break;
      const ms = nextPulseMs(err, est);
      if (!ms) break;
      pos += actual * ms / 1000; pulses++;
      est = actual;                    // 实机每步都用"实测位移/时长"更新估计
    }
    const closedErr = pos - 1;
    const pass = Math.abs(closedErr) <= 0.15;
    allPass = allPass && pass;
    rows.push({ actual, openErr, closedErr, pulses, pass });
  }
  console.log('离线自测(不连 VRChat) —— 目标 1.000 m, 判线 ±15 cm');
  console.log('  真实速度   开环(按常数一次走完)   闭环(标定+分步)   脉冲数   结论');
  for (const r of rows) {
    console.log('  ' + r.actual.toFixed(2).padStart(5) + ' m/s   ' + (r.openErr * 100).toFixed(1).padStart(8) + ' cm            ' +
      (r.closedErr * 100).toFixed(1).padStart(8) + ' cm     ' + String(r.pulses).padStart(3) + '     ' + (r.pass ? 'PASS' : 'FAIL'));
  }
  console.log('  => ' + (allPass ? 'PASS: 三种真实速度下闭环都 <= 15 cm; 开环误差随速度漂移明显(所以必须闭环)' : 'FAIL: 控制律需要调整'));
  return allPass;
}

// ===== 垂直移动闭环(2026-10-22): /input/LookVertical(浮点 -1~1) =====
// ⭐ 2026-10-22 实测意外发现: 这个轴**不是**抬头/低头, 而是让飞行相机**直接上下平移**:
//    LookVertical=+1 保持 200ms -> posY +0.625 m(约 3.1 m/s, 与前进同速), 姿态不变.
//    相机俯仰没有 OSC 入口(见 DEV-NOTES 355), 但垂直平移有了 -> 轨迹重放的第三个平移轴齐了.
async function holdFloat(axis, value, ms) {
  const dur = Math.max(30, Math.min(2000, Math.round(ms) || 80));
  try { await sendF('/input/' + axis, value); await sleep(dur); }
  finally { await sendF('/input/' + axis, 0); }
  await sleep(450);
}
async function moveVertical(targetM) {
  const target = Math.max(-20, Math.min(20, Number(targetM) || 1));
  const tol = 0.15;
  const axis = 'LookVertical';
  const dir = target >= 0 ? 1 : -1;          // +1 = 上(实测); 向下视为对称(本轮回头会验证)
  const label = dir > 0 ? '向上' : '向下';
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = { flying: one(await getVal('/usercamera/Flying')), smoothing: one(await getVal('/usercamera/SmoothingStrength')) };
  console.log('前置状态: Flying=' + JSON.stringify(pre.flying) + ' Smoothing=' + JSON.stringify(pre.smoothing) + ' | 目标 ΔY = ' + target.toFixed(3) + ' m(' + label + ')');
  poseSock = await bindPose();
  const s0 = Number(pre.smoothing);
  try {
    if (pre.flying !== true) { await send('/usercamera/Flying', [true]); await sleep(500); console.log('飞行模式已打开 -> ' + JSON.stringify(await getVal('/usercamera/Flying'))); }
    if (isFinite(s0) && s0 !== 0) { await sendF('/usercamera/SmoothingStrength', 0); await sleep(400); console.log('SmoothingStrength 写 0 -> 读回 ' + JSON.stringify(await getVal('/usercamera/SmoothingStrength')) + '(原值 ' + JSON.stringify(pre.smoothing) + ', 结束还原)'); }
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose'); }
    await sleep(300);
    const start = lastPose.pos.slice();
    // 1) 120ms 标定: 实测竖直速度, 同时确认方向
    const calBefore = lastPose.pos.slice();
    await holdFloat(axis, dir, 120);
    const calDy = lastPose.pos[1] - calBefore[1];
    if (calDy * dir <= 0.01) throw new Error(axis + ' 保持 ' + dir + ' 后没有按预期竖直移动(ΔY=' + calDy.toFixed(3) + ' m) —— 方向/可用性变了, 已停止(不盲目重试)');
    let speed = Math.abs(calDy) / 0.12;
    console.log('标定: ' + axis + '=' + dir + ' 保持 120ms -> ΔY ' + calDy.toFixed(3) + ' m -> 估竖直速度 ' + speed.toFixed(2) + ' m/s');
    // 2) 闭环逼近(过冲就停, 不反向 —— 反方向未验证)
    let pulses = 1;
    for (let i = 0; i < 24; i++) {
      const dy = lastPose.pos[1] - start[1];
      const err = target - dy;
      if (Math.sign(err) !== dir || Math.abs(err) <= 0.05) break;
      const ms = Math.max(30, Math.min(400, Math.round(Math.abs(err) / speed * 1000 * 0.6)));
      const before = lastPose.pos.slice();
      await holdFloat(axis, dir, ms);
      const d = lastPose.pos[1] - before[1];
      pulses++;
      if (Math.abs(d) > 0.005) speed = Math.abs(d) / (ms / 1000);
    }
    const end = lastPose.pos.slice();
    const dy = end[1] - start[1];
    const horiz = Math.hypot(end[0] - start[0], end[2] - start[2]);
    const out = {
      at: new Date().toISOString(), axis: axis, label: label,
      target: round3(target), tolerance: tol, direction: dir,
      start: start.map(round3), end: end.map(round3),
      vector: [round3(end[0] - start[0]), round3(end[1] - start[1]), round3(end[2] - start[2])],
      dy: round3(dy), error: round3(dy - target), horiz: round3(horiz),
      pass: Math.abs(dy - target) <= tol && horiz <= 0.3,
      pulses: pulses, speed: +speed.toFixed(2),
      poseSamples: poseSamples.length, samples: poseSamples,
      pre: pre, calibration: { ms: 120, dy: round3(calDy) },
    };
    try {
      fs.mkdirSync('logs', { recursive: true });
      out.file = 'logs/pose-vertical-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
      fs.writeFileSync(out.file, JSON.stringify(out, null, 1), 'utf8');
    } catch (e) { out.file = null; }
    console.log('结果(' + label + '): 起点 [' + start.map((x) => x.toFixed(2)).join(', ') + '] -> 终点 [' + end.map((x) => x.toFixed(2)).join(', ') + ']  位移向量 [' + (end[0] - start[0]).toFixed(2) + ', ' + (end[1] - start[1]).toFixed(2) + ', ' + (end[2] - start[2]).toFixed(2) + ']');
    console.log('      实际 ΔY ' + dy.toFixed(3) + ' m / 误差 ' + ((dy - target) >= 0 ? '+' : '') + ((dy - target) * 100).toFixed(1) + ' cm / 水平漂移 ' + (horiz * 100).toFixed(1) + ' cm / 脉冲 ' + pulses + ' 次 / Pose 采样 ' + poseSamples.length + ' 条');
    if (out.file) console.log('      明细已存 ' + out.file);
    return out;
  } finally {
    try { await sendF('/input/' + axis, 0); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (isFinite(s0) && s0 !== 0) { try { await sendF('/usercamera/SmoothingStrength', s0); await sleep(250); console.log('SmoothingStrength 已还原 -> ' + JSON.stringify(await getVal('/usercamera/SmoothingStrength'))); } catch (e) {} }
    if (pre.flying === false) { try { await send('/usercamera/Flying', [false]); await sleep(250); } catch (e) {} }
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// ===== 三维点到点(2026-10-22): 相机系(前/左/上) -> 分段闭环 -> 期望世界向量对照 =====
// 前置假设: 相机水平(pitch≈0), 这样 MoveForward 只改变水平位置; 俯仰不为 0 时直接报错停下.
// 分段顺序: 前 -> 左 -> 上; 每段用 120ms 标定 + 分步逼近(与单轴闭环同一控制律).
async function moveTo(frontM, leftM, upM) {
  const target = { front: Number(frontM) || 0, left: Number(leftM) || 0, up: Number(upM) || 0 };
  const tol = 0.15;
  if (!target.front && !target.left && !target.up) throw new Error('三个分量都是 0; 用法: move-to <前> <左> <上>');
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = { flying: one(await getVal('/usercamera/Flying')), smoothing: one(await getVal('/usercamera/SmoothingStrength')) };
  console.log('目标(相机系): 前 ' + target.front.toFixed(3) + ' / 左 ' + target.left.toFixed(3) + ' / 上 ' + target.up.toFixed(3) + ' m | 前置 Flying=' + JSON.stringify(pre.flying) + ' Smoothing=' + JSON.stringify(pre.smoothing));
  poseSock = await bindPose();
  const s0 = Number(pre.smoothing);
  try {
    if (pre.flying !== true) { await send('/usercamera/Flying', [true]); await sleep(500); console.log('飞行模式已打开 -> ' + JSON.stringify(await getVal('/usercamera/Flying'))); }
    if (isFinite(s0) && s0 !== 0) { await sendF('/usercamera/SmoothingStrength', 0); await sleep(400); console.log('SmoothingStrength 写 0 -> 读回 ' + JSON.stringify(await getVal('/usercamera/SmoothingStrength')) + '(原值 ' + JSON.stringify(pre.smoothing) + ', 结束还原)'); }
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose'); }
    await sleep(300);
    const start = lastPose.pos.slice();
    const yaw0 = Number(lastPose.rot[1]) || 0;
    let p0 = ((Number(lastPose.rot[0]) % 360) + 360) % 360; if (p0 > 180) p0 -= 360;
    if (Math.abs(p0) > 5) throw new Error('相机俯仰 ' + p0.toFixed(1) + '°, 不是水平状态; 前进会带高度分量, 先停(请把相机放平再试)');
    // 分段闭环(共用 lastPose / poseSock)
    const seg = async function (kind, amount, axisName, dir) {
      const segTarget = Math.max(0.03, Math.min(10, amount));
      const doPulse = kind === 'float'
        ? function (ms) { return holdFloat(axisName, dir, ms); }
        : function (ms) { return pulseAxis(axisName, ms); };
      const segStart = lastPose.pos.slice();
      const calBefore = lastPose.pos.slice();
      await doPulse(120);
      const calDist = dist3(lastPose.pos, calBefore);
      if (calDist <= 0.005) throw new Error(axisName + ' 标定无位移, 已停止(不盲目重试)');
      let speed = calDist / 0.12;
      let pulses = 1;
      for (let i = 0; i < 24; i++) {
        const travelled = dist3(lastPose.pos, segStart);
        const err = segTarget - travelled;
        if (err <= 0.05) break;
        const ms = nextPulseMs(err, speed);
        if (!ms) break;
        const before = lastPose.pos.slice();
        await doPulse(ms);
        const d = dist3(lastPose.pos, before);
        pulses++;
        if (d > 0.005) speed = d / (ms / 1000);
      }
      const segEnd = lastPose.pos.slice();
      const moved = dist3(segEnd, segStart);
      console.log('  段 ' + axisName + ': 目标 ' + segTarget.toFixed(3) + ' m / 实际 ' + moved.toFixed(3) + ' m(' + pulses + ' 脉冲)');
      return { axis: axisName, direction: dir || 0, target: round3(segTarget), moved: round3(moved), pulses: pulses, speed: +speed.toFixed(2) };
    };
    const segs = [];
    if (Math.abs(target.front) > 0.02) segs.push(await seg('bool', Math.abs(target.front), target.front >= 0 ? 'MoveForward' : 'MoveBackward'));
    if (Math.abs(target.left) > 0.02) segs.push(await seg('bool', Math.abs(target.left), target.left >= 0 ? 'MoveLeft' : 'MoveRight'));
    if (Math.abs(target.up) > 0.02) segs.push(await seg('float', Math.abs(target.up), 'LookVertical', target.up >= 0 ? 1 : -1));
    const end = lastPose.pos.slice();
    const th = yaw0 * Math.PI / 180;
    const expected = [
      round3(Math.sin(th) * target.front - Math.cos(th) * target.left),
      round3(target.up),
      round3(Math.cos(th) * target.front + Math.sin(th) * target.left),
    ];
    const actual = [round3(end[0] - start[0]), round3(end[1] - start[1]), round3(end[2] - start[2])];
    const errVec = [round3(actual[0] - expected[0]), round3(actual[1] - expected[1]), round3(actual[2] - expected[2])];
    const errNorm = round3(Math.hypot(errVec[0], errVec[1], errVec[2]));
    const pass = errNorm <= tol;
    const out = {
      at: new Date().toISOString(),
      cameraFrameTarget: target, tolerance: tol,
      yawStart: round3(yaw0), pitchStart: round3(p0),
      start: start.map(round3), end: end.map(round3),
      expectedWorld: expected, actualVector: actual, errorVector: errVec, errorNorm: errNorm, pass: pass,
      segments: segs, pulseTotal: segs.reduce(function (a, s) { return a + s.pulses; }, 0),
      poseSamples: poseSamples.length, samples: poseSamples, pre: pre,
    };
    try {
      fs.mkdirSync('logs', { recursive: true });
      out.file = 'logs/pose-point-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
      fs.writeFileSync(out.file, JSON.stringify(out, null, 1), 'utf8');
    } catch (e) { out.file = null; }
    console.log('结果: 起点 [' + start.map(function (x) { return x.toFixed(2); }).join(', ') + '] -> 终点 [' + end.map(function (x) { return x.toFixed(2); }).join(', ') + ']');
    console.log('      实际向量 [' + actual.join(', ') + '] m | 期望向量 [' + expected.join(', ') + '] m(按起始 yaw=' + yaw0.toFixed(1) + '° 换算)');
    console.log('      误差向量 [' + errVec.join(', ') + '] m -> 误差 ' + (errNorm * 100).toFixed(1) + ' cm(判线 ±' + (tol * 100).toFixed(0) + ' cm)');
    if (out.file) console.log('      明细已存 ' + out.file);
    return out;
  } finally {
    try { await sendF('/input/LookVertical', 0); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (isFinite(s0) && s0 !== 0) { try { await sendF('/usercamera/SmoothingStrength', s0); await sleep(250); console.log('SmoothingStrength 已还原 -> ' + JSON.stringify(await getVal('/usercamera/SmoothingStrength'))); } catch (e) {} }
    if (pre.flying === false) { try { await send('/usercamera/Flying', [false]); await sleep(250); } catch (e) {} }
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// ===== 偏航闭环转向(2026-10-22): /input/LookLeft|LookRight(bool) =====
// 依据: 上一会话实测 LookRight 300ms -> yaw +54.44°(TurnSpeed=1 ≈ 181.5°/s), 闭环可收敛到 ±3.4°.
// 本次改进: 临时把 TurnSpeed 降到 0.1(≈18°/s)再闭环 —— 30ms 最短脉冲只有 ~0.54°, 精度目标 <1°; 结束还原.
function wrap180(d) { const x = ((Number(d) || 0) % 360 + 360) % 360; return x > 180 ? x - 360 : x; }
async function turnBy(deltaDeg) {
  const delta = Math.max(-180, Math.min(180, Number(deltaDeg) || 0));
  if (Math.abs(delta) < 0.5) throw new Error('转角太小(用法: rotate <角度>, 正=右转/负=左转)');
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = { flying: one(await getVal('/usercamera/Flying')), turnSpeed: one(await getVal('/usercamera/TurnSpeed')) };
  console.log('前置: Flying=' + JSON.stringify(pre.flying) + ' TurnSpeed=' + JSON.stringify(pre.turnSpeed) + ' | 目标转角 ' + delta.toFixed(1) + '°(' + (delta > 0 ? '右' : '左') + ')');
  poseSock = await bindPose();
  const ts0 = Number(pre.turnSpeed);
  try {
    if (pre.flying !== true) { await send('/usercamera/Flying', [true]); await sleep(500); console.log('飞行模式已打开 -> ' + JSON.stringify(await getVal('/usercamera/Flying'))); }
    let usedTs = pre.turnSpeed;
    if (isFinite(ts0) && ts0 !== 0.1) {
      await sendF('/usercamera/TurnSpeed', 0.1); await sleep(400);
      usedTs = one(await getVal('/usercamera/TurnSpeed'));
      console.log('TurnSpeed 临时降到 0.1 -> 读回 ' + JSON.stringify(usedTs) + '(原值 ' + JSON.stringify(pre.turnSpeed) + ', 结束还原)');
    }
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose'); }
    await sleep(300);
    const startPos = lastPose.pos.slice();
    const startYaw = wrap180(lastPose.rot[1]);
    // 探针: 100ms 右转 -> 判断方向与速率
    const probeBefore = lastPose.rot[1];
    await pulseAxis('LookRight', 100);
    const probeDelta = wrap180(lastPose.rot[1] - probeBefore);
    if (Math.abs(probeDelta) < 0.5) throw new Error('LookRight 没让相机偏航(轴无效/被占用), 已停止(不盲目重试)');
    const rightSign = probeDelta > 0 ? 1 : -1;
    const rate = Math.abs(probeDelta) / 0.1;
    const incAxis = rightSign > 0 ? 'LookRight' : 'LookLeft';
    const decAxis = rightSign > 0 ? 'LookLeft' : 'LookRight';
    const minStep = rate * 0.03;
    const tolDeg = Math.max(1.0, minStep * 1.2);
    console.log('探针: LookRight 100ms -> Δyaw ' + probeDelta.toFixed(2) + '° -> 速率 ' + rate.toFixed(1) + ' °/s; 判线 ±' + tolDeg.toFixed(1) + '°');
    const targetYaw = wrap180(startYaw + delta);
    let pulses = 1;
    let curYaw = wrap180(lastPose.rot[1]);
    for (let i = 0; i < 30; i++) {
      const err = wrap180(targetYaw - curYaw);
      if (Math.abs(err) <= tolDeg) break;
      const ms = Math.max(30, Math.min(600, Math.round(Math.abs(err) / rate * 1000 * 0.6)));
      await pulseAxis(err > 0 ? incAxis : decAxis, ms);
      pulses++;
      curYaw = wrap180(lastPose.rot[1]);
    }
    const endYaw = wrap180(lastPose.rot[1]);
    const actual = wrap180(endYaw - startYaw);
    const error = wrap180(actual - delta);
    const posDrift = Math.hypot(lastPose.pos[0] - startPos[0], lastPose.pos[1] - startPos[1], lastPose.pos[2] - startPos[2]);
    const out = {
      at: new Date().toISOString(),
      delta: round3(delta), direction: delta > 0 ? '右' : '左',
      startYaw: round3(startYaw), targetYaw: round3(targetYaw), endYaw: round3(endYaw),
      actualDelta: round3(actual), error: round3(error), tolerance: +tolDeg.toFixed(2),
      pass: Math.abs(error) <= tolDeg,
      pulses: pulses, rateDegPerSec: +rate.toFixed(1), turnSpeedUsed: usedTs, posDrift: round3(posDrift),
      pre: pre, poseSamples: poseSamples.length, samples: poseSamples,
    };
    try {
      fs.mkdirSync('logs', { recursive: true });
      out.file = 'logs/pose-turn-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
      fs.writeFileSync(out.file, JSON.stringify(out, null, 1), 'utf8');
    } catch (e) { out.file = null; }
    console.log('结果: yaw ' + startYaw.toFixed(2) + '° -> ' + endYaw.toFixed(2) + '°(实际转 ' + actual.toFixed(2) + '°, 误差 ' + error.toFixed(2) + '°); 位置漂移 ' + (posDrift * 100).toFixed(1) + ' cm / 脉冲 ' + pulses + ' 次 / Pose 采样 ' + poseSamples.length + ' 条');
    if (out.file) console.log('      明细已存 ' + out.file);
    return out;
  } finally {
    try { await send('/input/LookLeft', [false]); await send('/input/LookRight', [false]); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (isFinite(ts0) && ts0 !== 0.1) { try { await sendF('/usercamera/TurnSpeed', ts0); await sleep(250); console.log('TurnSpeed 已还原 -> ' + JSON.stringify(await getVal('/usercamera/TurnSpeed'))); } catch (e) {} }
    if (pre.flying === false) { try { await send('/usercamera/Flying', [false]); await sleep(250); } catch (e) {} }
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// ===== 运动范围探针(2026-10-22): 按住一个输入轴 N 秒, 全程采样 Pose, 判断"在哪里停住" =====
// 用途: 跟随玩家(自拍杆)模式的运动包络线; 也可用于自由模式测速度/撞墙.
// 用法: range MoveForward 4 | range LookVertical 3 1 | range LookVertical 3 -1
const FLOAT_AXES = { LookVertical: true, LookHorizontal: true, Vertical: true, Horizontal: true };
async function rangeProbe(axisName, seconds, value) {
  const secs = Math.max(0.5, Math.min(8, Number(seconds) || 3));
  const isFloat = !!FLOAT_AXES[axisName];
  const val = isFloat ? (Number(value) < 0 ? -1 : 1) : 1;
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = { flying: one(await getVal('/usercamera/Flying')), smoothing: one(await getVal('/usercamera/SmoothingStrength')) };
  console.log('范围探针: ' + axisName + (isFloat ? ('=' + val) : '') + ' 保持 ' + secs + ' 秒 | Flying=' + JSON.stringify(pre.flying) + ' Smoothing=' + JSON.stringify(pre.smoothing));
  poseSock = await bindPose();
  const axisSet = isFloat
    ? function (v) { return sendF('/input/' + axisName, v); }
    : function (v) { return send('/input/' + axisName, [!!v]); };
  try {
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose'); }
    await sleep(300);
    const start = lastPose.pos.slice();
    const yaw0 = wrap180(lastPose.rot[1]);
    const track = [];
    let dirUnit = null;              // 实际前进方向(由最初 >0.25 m 的位移确定)
    let lastProgress = 0;            // 沿该方向的最大前进距离
    let lastProgressAt = Date.now(); // 最近一次"前进"增长的时刻(顶到边界后不再增长)
    const t0 = Date.now();
    await axisSet(isFloat ? val : 1);
    while (Date.now() - t0 < secs * 1000) {
      await sleep(100);
      const p = lastPose.pos.slice();
      const el = Date.now() - t0;
      track.push({ ms: el, pos: p.map(round3), rot: lastPose.rot.map((x) => +Number(x).toFixed(2)) });
      const rel = [p[0] - start[0], p[1] - start[1], p[2] - start[2]];
      const relLen = Math.hypot(rel[0], rel[1], rel[2]);
      if (!dirUnit && relLen > 0.25) dirUnit = [rel[0] / relLen, rel[1] / relLen, rel[2] / relLen];
      if (dirUnit) {
        const prog = rel[0] * dirUnit[0] + rel[1] * dirUnit[1] + rel[2] * dirUnit[2];
        if (prog > lastProgress + 0.02) { lastProgress = prog; lastProgressAt = Date.now(); }
      }
    }
    await axisSet(isFloat ? 0 : 0);
    await sleep(800);
    const end = lastPose.pos.slice();
    const vec = [round3(end[0] - start[0]), round3(end[1] - start[1]), round3(end[2] - start[2])];
    const total = round3(Math.hypot(vec[0], vec[1], vec[2]));
    const horiz = round3(Math.hypot(vec[0], vec[2]));
    const vert = round3(vec[1]);
    const plateauMs = Math.max(0, (t0 + secs * 1000) - lastProgressAt);
    const stopAtMs = Math.max(0, secs * 1000 - plateauMs);
    let maxSpeed = 0;
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1].pos, b = track[i].pos;
      const dt = (track[i].ms - track[i - 1].ms) / 1000;
      if (dt > 0) maxSpeed = Math.max(maxSpeed, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / dt);
    }
    const out = {
      at: new Date().toISOString(), axis: axisName, holdSec: secs, value: isFloat ? val : 1,
      start: start.map(round3), end: end.map(round3), offsetFromStart: vec,
      distance: total, horizontal: horiz, vertical: vert,
      yawStart: round3(yaw0), dir: dirUnit ? dirUnit.map(round3) : null,
      progress: round3(lastProgress), plateauMs: Math.round(plateauMs), stopAtSec: +(stopAtMs / 1000).toFixed(2),
      stoppedEarly: plateauMs >= 400,
      maxSpeed: round3(maxSpeed), samples: poseSamples.length, track: track,
    };
    try {
      fs.mkdirSync('logs', { recursive: true });
      out.file = 'logs/pose-range-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
      fs.writeFileSync(out.file, JSON.stringify(out, null, 1), 'utf8');
    } catch (e) { out.file = null; }
    console.log('结果: 起点 [' + start.map((x) => x.toFixed(2)).join(', ') + '] -> 终点 [' + end.map((x) => x.toFixed(2)).join(', ') + ']');
    console.log('      位移 ' + total.toFixed(3) + ' m(水平 ' + horiz.toFixed(3) + ' / 垂直 ' + vert.toFixed(3) + '); 峰值速度 ' + maxSpeed.toFixed(2) + ' m/s');
    console.log('      ' + (!out.dir
      ? '⚠️ 全程几乎没动(受阻/边界或轴无效)'
      : (out.stoppedEarly
        ? ('⚠️ 前进在 ' + (stopAtMs / 1000).toFixed(2) + ' 秒后停住(共 ' + lastProgress.toFixed(2) + ' m) -> 到边界/受阻; 之后又有 ' + (total - lastProgress).toFixed(2) + ' m 位移(沿边界滑动或下沉)')
        : '全程持续前进, 未触边界')));
    if (out.file) console.log('      明细已存 ' + out.file);
    return out;
  } finally {
    try { await axisSet(isFloat ? 0 : 0); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// ===== 轨迹录制(2026-10-22, 重放准备): 用户用飞行模式自由飞, Pose 约 61Hz 存盘 =====//  格式沿用上一会话: { recordedAt, durationSec, hz, start, startRot, samples:[{t,pos,rot}] }
async function recordTrajectory(seconds, auto) {
  const secs = Math.max(2, Math.min(120, Number(seconds) || 10));
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  poseSock = await bindPose();
  try {
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose'); }
    await sleep(300);
    const nudgeAt = Date.now();
    if (auto) {
      console.log('auto 模式: 等你开始飞(收到新的 Pose)… 最多等 120 秒(现在可以开始飞了)');
      const waitStart = Date.now();
      while (Date.now() - waitStart < 120000 && lastPoseAt <= nudgeAt + 200) await sleep(150);
      if (lastPoseAt <= nudgeAt + 200) throw new Error('auto 等待超时(120 秒内没检测到相机移动)');
      console.log('检测到相机开始移动 -> 开始录制 ' + secs + ' 秒');
    }
    poseSamples.length = 0; poseT0 = 0; lastPoseAt = 0;
    if (!auto) console.log('开始录制 ' + secs + ' 秒: 请用飞行模式自由飞(平移 + 左右转; 尽量别抬头/低头)…');
    const t0 = Date.now();
    let warned = false;
    while (Date.now() - t0 < secs * 1000) {
      await sleep(100);
      if (!lastPose && !warned && Date.now() - t0 > 2500) { warned = true; console.log('⚠️ 还没收到 Pose(相机还没动?)'); }
    }
    await sleep(700);
    const n = poseSamples.length;
    if (n < 10) throw new Error('录制到的 Pose 太少(' + n + ' 条) —— 相机可能没动');
    const first = poseSamples[0];
    const samples = poseSamples.map(function (s) { return { t: +((s.ms - first.ms) / 1000).toFixed(3), pos: s.pos, rot: s.rot }; });
    const dur = samples[samples.length - 1].t;
    const rng = function (get) { const v = samples.map(get); return { min: Math.min.apply(null, v), max: Math.max.apply(null, v) }; };
    const px = rng(function (s) { return s.pos[0]; }), py = rng(function (s) { return s.pos[1]; }), pz = rng(function (s) { return s.pos[2]; });
    const pt = rng(function (s) { return s.rot[0]; }), yw = rng(function (s) { return s.rot[1]; }), rl = rng(function (s) { return s.rot[2]; });
    let pathLen = 0;
    for (let i = 1; i < samples.length; i++) pathLen += dist3(samples[i].pos, samples[i - 1].pos);
    const out = {
      at: new Date().toISOString(), recordedAt: new Date().toISOString(),
      durationSec: +dur.toFixed(3), hz: +(n / Math.max(0.001, dur)).toFixed(1),
      start: samples[0].pos.slice(), startRot: samples[0].rot.slice(),
      ranges: { posX: px, posY: py, posZ: pz, pitch: pt, yaw: yw, roll: rl },
      pathLength: +pathLen.toFixed(3), samples: samples,
    };
    fs.mkdirSync('logs', { recursive: true });
    out.file = 'logs/traj-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    fs.writeFileSync(out.file, JSON.stringify(out, null, 1), 'utf8');
    console.log('录制完成: ' + n + ' 条 / ' + dur.toFixed(2) + ' 秒 / ' + out.hz + ' Hz / 路径长 ' + pathLen.toFixed(2) + ' m');
    console.log('  位置范围 X ' + px.min.toFixed(2) + '~' + px.max.toFixed(2) + ' / Y ' + py.min.toFixed(2) + '~' + py.max.toFixed(2) + ' / Z ' + pz.min.toFixed(2) + '~' + pz.max.toFixed(2));
    console.log('  姿态范围 pitch ' + pt.min.toFixed(1) + '~' + pt.max.toFixed(1) + '° / yaw ' + yw.min.toFixed(1) + '~' + yw.max.toFixed(1) + '° / roll ' + rl.min.toFixed(1) + '~' + rl.max.toFixed(1) + '°');
    console.log('  已存 ' + out.file);
    return out;
  } finally {
    try { await zeroAll(); } catch (e) {}
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// ===== 轨迹信息 =====// 用途: 重放前先看轨迹是否可用(样本/时长/路径长/俯仰范围)
function trajInfo(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = Array.isArray(j.samples) ? j.samples : [];
  if (raw.length < 5) throw new Error('轨迹样本太少: ' + raw.length);
  const b = raw[0]; const dur = raw[raw.length - 1].t;
  let path = 0, maxFromStart = 0; let pMin = 999, pMax = -999, yMin = 999, yMax = -999;
  for (let i = 1; i < raw.length; i++) path += dist3(raw[i].pos, raw[i - 1].pos);
  for (const s of raw) { maxFromStart = Math.max(maxFromStart, dist3(s.pos, b.pos)); pMin = Math.min(pMin, s.rot[0]); pMax = Math.max(pMax, s.rot[0]); yMin = Math.min(yMin, s.rot[1]); yMax = Math.max(yMax, s.rot[1]); }
  console.log('轨迹: ' + file);
  console.log('  样本 ' + raw.length + ' 条 / 时长 ' + dur.toFixed(2) + ' s / 平均 ' + (raw.length / Math.max(0.001, dur)).toFixed(1) + ' Hz');
  console.log('  路径长 ' + path.toFixed(2) + ' m / 离起点最远 ' + maxFromStart.toFixed(2) + ' m');
  console.log('  起点 pos=[' + b.pos.map(function (x) { return x.toFixed(2); }).join(', ') + '] yaw=' + b.rot[1].toFixed(1) + '°');
  console.log('  俯仰范围 ' + pMin.toFixed(1) + '~' + pMax.toFixed(1) + '°' + (Math.max(Math.abs(pMin), Math.abs(pMax)) > 5 ? ' ⚠️ 俯仰无法重放' : '') + ' / 偏航范围 ' + yMin.toFixed(1) + '~' + yMax.toFixed(1) + '°');
  return { file: file, n: raw.length, durSec: dur, pathLength: path, maxFromStart: maxFromStart };
}

// ===== 轨迹重放(2026-10-22, 准备版) =====
// 原理: 轨迹是**世界坐标绝对位置**; 重放时以"当前相机位姿"为起点, 只重放**相对位移 + 相对偏航**
//       (等价于"玩家相对坐标"在玩家不动时的效果) -> 同一世界/不同世界都能重放.
// 执行: 每个路点"先转向 -> 再按相机系(前/左/上)三段闭环平移"; 串行执行, 比原速慢.
// 限制: 相机俯仰无 OSC 入口 -> 录制时保持水平; 重放前会检查当前俯仰.
async function replayTraj(file, stepSec, dry) {
  const step = Math.max(0.3, Math.min(5, Number(stepSec) || 1.0));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = Array.isArray(j.samples) ? j.samples : [];
  if (raw.length < 5) throw new Error('轨迹样本太少: ' + raw.length);
  const b = raw[0];
  const dur = raw[raw.length - 1].t;
  // 相对偏航必须先"展开"(连续累计) —— 否则 360° 环绕会被折成 ±180 的跳变
  const relYawArr = [];
  let prevRaw = Number(b.rot[1]) || 0, accYaw = 0;
  for (const s of raw) { accYaw += wrap180((Number(s.rot[1]) || 0) - prevRaw); prevRaw = Number(s.rot[1]) || 0; relYawArr.push(accYaw); }
  const waypoints = [];
  let nextT = step, lastK = -1;
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (s.t >= nextT || i === raw.length - 1) {
      if (lastK >= 0) {
        const prevWp = waypoints[lastK];
        const dPos = dist3(s.pos, raw[prevWp.idx].pos);
        const dYaw = Math.abs(relYawArr[i] - relYawArr[prevWp.idx]);
        const isLast = (i === raw.length - 1);
        if (!isLast && dPos < 0.05 && dYaw < 3) { nextT = s.t + step; continue; }
      }
      waypoints.push({ idx: i, t: s.t, pos: s.pos, yawRel: relYawArr[i] });
      lastK = waypoints.length - 1;
      nextT = s.t + step;
    }
  }
  let path = 0, maxOff = 0, pMin = 999, pMax = -999;
  for (let i = 1; i < raw.length; i++) path += dist3(raw[i].pos, raw[i - 1].pos);
  for (const s of raw) { maxOff = Math.max(maxOff, dist3(s.pos, b.pos)); pMin = Math.min(pMin, s.rot[0]); pMax = Math.max(pMax, s.rot[0]); }
  console.log('轨迹: ' + file + ' | 样本 ' + raw.length + ' | 时长 ' + dur.toFixed(2) + 's | 路径长 ' + path.toFixed(2) + 'm | 离起点最远 ' + maxOff.toFixed(2) + 'm');
  console.log('俯仰范围 ' + pMin.toFixed(1) + '~' + pMax.toFixed(1) + '°' + (Math.max(Math.abs(pMin), Math.abs(pMax)) > 5 ? ' ⚠️ 俯仰无法重放(按水平处理)' : '') + ' | 路点数 ' + waypoints.length + '(步长 ' + step + 's)');
  for (let k = 0; k < waypoints.length; k++) {
    const wp = waypoints[k];
    const rel = [wp.pos[0] - b.pos[0], wp.pos[1] - b.pos[1], wp.pos[2] - b.pos[2]];
    console.log('  #' + (k + 1) + ' t=' + wp.t.toFixed(1) + 's rel=[' + rel.map(function (x) { return x.toFixed(2); }).join(', ') + '] Δyaw=' + wp.yawRel.toFixed(1) + '°');
  }
  if (dry) { console.log('(dry: 只打印路点, 相机不动)'); return { dry: true, waypoints: waypoints.length }; }
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = { flying: one(await getVal('/usercamera/Flying')), smoothing: one(await getVal('/usercamera/SmoothingStrength')), turnSpeed: one(await getVal('/usercamera/TurnSpeed')) };
  poseSock = await bindPose();
  const s0 = Number(pre.smoothing), ts0 = Number(pre.turnSpeed);
  try {
    if (pre.flying !== true) { await send('/usercamera/Flying', [true]); await sleep(500); }
    if (isFinite(s0) && s0 !== 0) { await sendF('/usercamera/SmoothingStrength', 0); await sleep(300); }
    if (isFinite(ts0) && ts0 !== 0.1) { await sendF('/usercamera/TurnSpeed', 0.1); await sleep(300); console.log('TurnSpeed 临时 0.1(转向精度), 结束还原'); }
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose'); }
    await sleep(300);
    const origin = lastPose.pos.slice();
    const yaw0 = wrap180(lastPose.rot[1]);
    let pNow = ((Number(lastPose.rot[0]) % 360) + 360) % 360; if (pNow > 180) pNow -= 360;
    if (Math.abs(pNow) > 5) throw new Error('相机俯仰 ' + pNow.toFixed(1) + '°, 请先把相机放平再重放');
    let turnRate = null, turnSign = 1;
    const turnTo = async function (targetYaw) {
      if (turnRate === null) {
        const y0 = wrap180(lastPose.rot[1]);
        await pulseAxis('LookRight', 100);
        const d = wrap180(wrap180(lastPose.rot[1]) - y0);
        if (Math.abs(d) < 0.3) throw new Error('LookRight 无效, 无法重放转向');
        turnSign = d > 0 ? 1 : -1; turnRate = Math.abs(d) / 0.1;
      }
      for (let i = 0; i < 25; i++) {
        const cur = wrap180(lastPose.rot[1]);
        const err = wrap180(targetYaw - cur);
        if (Math.abs(err) <= 2) return cur;
        const ms = Math.max(30, Math.min(600, Math.round(Math.abs(err) / turnRate * 1000 * 0.6)));
        const dir = Math.sign(err) * turnSign;
        await pulseAxis(dir > 0 ? 'LookRight' : 'LookLeft', ms);
      }
      throw new Error('转向未收敛(目标 ' + targetYaw.toFixed(1) + '°)');
    };
    const moveBy = async function (front, left, up) {
      const segs = [];
      const doSeg = async function (axis, amount, floatDir) {
        const target = Math.abs(amount);
        if (target < 0.03) return;
        const isFloat = axis === 'LookVertical';
        const doPulse = isFloat ? function (ms) { return holdFloat(axis, floatDir, ms); } : function (ms) { return pulseAxis(axis, ms); };
        const segStart = lastPose.pos.slice();
        const calBefore = lastPose.pos.slice();
        await doPulse(120);
        const calDist = dist3(lastPose.pos, calBefore);
        if (calDist <= 0.005) throw new Error(axis + ' 标定无位移(边界/受阻?)');
        let speed = calDist / 0.12, pulses = 1;
        for (let i = 0; i < 20; i++) {
          const err = target - dist3(lastPose.pos, segStart);
          if (err <= 0.05) break;
          const ms = nextPulseMs(err, speed);
          if (!ms) break;
          const before = lastPose.pos.slice();
          await doPulse(ms);
          const d = dist3(lastPose.pos, before); pulses++;
          if (d > 0.005) speed = d / (ms / 1000);
        }
        segs.push({ axis: axis, target: +target.toFixed(3), moved: +dist3(lastPose.pos, segStart).toFixed(3), pulses: pulses });
      };
      if (Math.abs(front) > 0.03) await doSeg(front >= 0 ? 'MoveForward' : 'MoveBackward', front);
      if (Math.abs(left) > 0.03) await doSeg(left >= 0 ? 'MoveLeft' : 'MoveRight', left);
      if (Math.abs(up) > 0.03) await doSeg('LookVertical', up, up >= 0 ? 1 : -1);
      return segs;
    };
    const results = [];
    const tStart = Date.now();
    for (let k = 0; k < waypoints.length; k++) {
      const wp = waypoints[k];
      const rel = [wp.pos[0] - b.pos[0], wp.pos[1] - b.pos[1], wp.pos[2] - b.pos[2]];
      const targetWorld = [origin[0] + rel[0], origin[1] + rel[1], origin[2] + rel[2]];
      const targetYaw = wrap180(yaw0 + wp.yawRel);
      await turnTo(targetYaw);
      const th = wrap180(lastPose.rot[1]) * Math.PI / 180;
      const dx = targetWorld[0] - lastPose.pos[0], dy = targetWorld[1] - lastPose.pos[1], dz = targetWorld[2] - lastPose.pos[2];
      const front = dx * Math.sin(th) + dz * Math.cos(th);
      const left = -dx * Math.cos(th) + dz * Math.sin(th);
      const segs = await moveBy(front, left, dy);
      const reached = lastPose.pos.slice();
      const posErr = dist3(reached, targetWorld);
      const yawErr = wrap180(targetYaw - wrap180(lastPose.rot[1]));
      results.push({ k: k + 1, t: wp.t, targetWorld: targetWorld.map(round3), reached: reached.map(round3), posErr: round3(posErr), yawErr: round3(yawErr), segs: segs });
      console.log('  路点 ' + (k + 1) + '/' + waypoints.length + ' (t=' + wp.t.toFixed(1) + 's): 位置误差 ' + (posErr * 100).toFixed(1) + ' cm / 偏航误差 ' + yawErr.toFixed(2) + '°');
    }
    const elapsed = (Date.now() - tStart) / 1000;
    const maxPosErr = Math.max.apply(null, results.map(function (r) { return r.posErr; }));
    const maxYawErr = Math.max.apply(null, results.map(function (r) { return Math.abs(r.yawErr); }));
    const lastRes = results[results.length - 1];
    const out = { at: new Date().toISOString(), file: file, waypoints: waypoints.length, stepSec: step,
      origin: origin.map(round3), yaw0: round3(yaw0), recordedPitchRange: [round3(pMin), round3(pMax)],
      elapsedSec: +elapsed.toFixed(1), maxPosErr: round3(maxPosErr), maxYawErr: round3(maxYawErr), finalPosErr: lastRes.posErr,
      results: results, poseSamples: poseSamples.length, samples: poseSamples };
    fs.mkdirSync('logs', { recursive: true });
    out.fileOut = 'logs/replay-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    fs.writeFileSync(out.fileOut, JSON.stringify(out, null, 1), 'utf8');
    console.log('');
    console.log('重放完成: ' + waypoints.length + ' 路点 / 用时 ' + elapsed.toFixed(1) + ' s(原轨迹 ' + dur.toFixed(1) + ' s)');
    console.log('  最大位置误差 ' + (maxPosErr * 100).toFixed(1) + ' cm / 最大偏航误差 ' + maxYawErr.toFixed(2) + '° / 最终位置误差 ' + (lastRes.posErr * 100).toFixed(1) + ' cm');
    console.log('  明细已存 ' + out.fileOut);
    return out;
  } finally {
    try { await sendF('/input/LookVertical', 0); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (isFinite(ts0) && ts0 !== 0.1) { try { await sendF('/usercamera/TurnSpeed', ts0); await sleep(200); } catch (e) {} }
    if (isFinite(s0) && s0 !== 0) { try { await sendF('/usercamera/SmoothingStrength', s0); await sleep(200); } catch (e) {} }
    if (pre.flying === false) { try { await send('/usercamera/Flying', [false]); await sleep(200); } catch (e) {} }
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// ===== 连续重放 v2(2026-10-30, A 轮速度/精度) =====
// 针对 v1 的"卡顿/慢 4.4x": v1 每个脉冲后等 600ms 停稳; v2 约 90ms 一个 tick, 闭环连续修正, 不停稳.
// 输入只用已证实的: MoveForward/Backward/Left/Right(bool), LookLeft/Right(偏航, 临时 TurnSpeed=0.3), LookVertical(上下, float).
async function replayContinuous(file, speedFactor, dry, smoothYaw) {
  const speed = Math.max(0.3, Math.min(3, Number(speedFactor) || 1.0));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = Array.isArray(j.samples) ? j.samples : [];
  if (raw.length < 5) throw new Error('轨迹样本太少: ' + raw.length);
  const b = raw[0];
  const dur = raw[raw.length - 1].t;
  const relPos = raw.map(function (s) { return [s.pos[0] - b.pos[0], s.pos[1] - b.pos[1], s.pos[2] - b.pos[2]]; });
  const relYaw = []; let prevRaw = Number(b.rot[1]) || 0, accYaw = 0;
  for (const s of raw) { accYaw += wrap180((Number(s.rot[1]) || 0) - prevRaw); prevRaw = Number(s.rot[1]) || 0; relYaw.push(accYaw); }
  let pMin = 999, pMax = -999, path = 0, maxOff = 0;
  for (let i = 1; i < raw.length; i++) path += dist3(raw[i].pos, raw[i - 1].pos);
  for (const s of raw) { pMin = Math.min(pMin, s.rot[0]); pMax = Math.max(pMax, s.rot[0]); maxOff = Math.max(maxOff, dist3(s.pos, b.pos)); }
  console.log('轨迹: ' + file + ' | 样本 ' + raw.length + ' | 时长 ' + dur.toFixed(2) + 's | 路径 ' + path.toFixed(2) + 'm | 最远 ' + maxOff.toFixed(2) + 'm | 俯仰 ' + pMin.toFixed(1) + '~' + pMax.toFixed(1) + '°' + (Math.max(Math.abs(pMin), Math.abs(pMax)) > 5 ? ' ⚠️(无法重放,按水平)' : ''));
  console.log('连续重放 v2: 倍速 ' + speed + 'x(1.0=原速)');
  let idx = 0;
  function sampleAt(t) {
    while (idx < raw.length - 1 && raw[idx + 1].t <= t) idx++;
    const ai = idx, ni = Math.min(idx + 1, raw.length - 1);
    const span = Math.max(1e-6, raw[ni].t - raw[ai].t);
    const u = Math.max(0, Math.min(1, (t - raw[ai].t) / span));
    return {
      pos: [relPos[ai][0] + (relPos[ni][0] - relPos[ai][0]) * u, relPos[ai][1] + (relPos[ni][1] - relPos[ai][1]) * u, relPos[ai][2] + (relPos[ni][2] - relPos[ai][2]) * u],
      yawRel: relYaw[ai] + (relYaw[ni] - relYaw[ai]) * u,
    };
  }
  if (dry) {
    for (let t = 0; t <= dur + 0.001; t += Math.max(0.5, dur / 10)) {
      const s = sampleAt(t);
      console.log('  t=' + t.toFixed(1) + 's rel=[' + s.pos.map(function (x) { return x.toFixed(2); }).join(', ') + '] yawRel=' + s.yawRel.toFixed(1) + '°');
    }
    console.log('(dry: 只打印插值点, 相机不动)');
    return { dry: true };
  }
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = { flying: one(await getVal('/usercamera/Flying')), smoothing: one(await getVal('/usercamera/SmoothingStrength')), turnSpeed: one(await getVal('/usercamera/TurnSpeed')) };
  poseSock = await bindPose();
  const s0 = Number(pre.smoothing), ts0 = Number(pre.turnSpeed);
  let tsEdited = false;
  const TICK = 70;
  try {
    if (pre.flying !== true) { await send('/usercamera/Flying', [true]); await sleep(400); }
    if (isFinite(s0) && s0 !== 0) { await sendF('/usercamera/SmoothingStrength', 0); await sleep(250); }
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose'); }
    await sleep(250);
    const origin = lastPose.pos.slice();
    const yaw0 = wrap180(lastPose.rot[1]);
    let pNow = ((Number(lastPose.rot[0]) % 360) + 360) % 360; if (pNow > 180) pNow -= 360;
    if (Math.abs(pNow) > 5) throw new Error('相机俯仰 ' + pNow.toFixed(1) + '°, 请先把相机放平再重放');
    let turnSign = 1, yawRate = 175;
    if (smoothYaw) {
      if (!isFinite(ts0) || Math.abs(ts0 - 0.5) > 0.001) { await sendF('/usercamera/TurnSpeed', 0.5); tsEdited = true; await sleep(350); }
      const yProbe2 = wrap180(lastPose.rot[1]);
      await pulseAxis('LookRight', 200); await sleep(300);
      const dProbe2 = wrap180(wrap180(lastPose.rot[1]) - yProbe2);
      if (Math.abs(dProbe2) < 0.3) throw new Error('LookRight 无效, 无法重放转向');
      turnSign = dProbe2 > 0 ? 1 : -1;
      yawRate = Math.abs(dProbe2) / 0.2;
      console.log('偏航探针(平滑偏航, TurnSpeed=0.5): ' + yawRate.toFixed(1) + ' °/s');
    } else {
      const yProbe = wrap180(lastPose.rot[1]);
      try { await sendF('/input/LookHorizontal', 1); await sleep(120); } finally { await sendF('/input/LookHorizontal', 0); }
      await sleep(120);
      const dProbe = wrap180(wrap180(lastPose.rot[1]) - yProbe);
      if (Math.abs(dProbe) < 0.2) throw new Error('LookHorizontal 无效, 无法重放转向');
      turnSign = dProbe > 0 ? 1 : -1;
      yawRate = Math.abs(dProbe) / 0.12;
      console.log('偏航探针(LookHorizontal=1): ' + yawRate.toFixed(1) + ' °/s');
    }
    const pulseAxisNT = async function (axis, ms) {
      const d = Math.max(20, Math.min(300, Math.round(ms)));
      try { await send('/input/' + axis, [true]); await sleep(d); } finally { await send('/input/' + axis, [false]); }
      await sleep(18);
    };
    const pulseVertNT = async function (dir, ms) {
      const d = Math.max(20, Math.min(300, Math.round(ms)));
      try { await sendF('/input/LookVertical', dir); await sleep(d); } finally { await sendF('/input/LookVertical', 0); }
      await sleep(18);
    };
    const tStart = Date.now();
    let ticks = 0, sumPos = 0, maxPos = 0, maxYaw = 0, iter = 0;
    while (true) {
      iter++; if (iter > 3000) break;
      const elapsed = (Date.now() - tStart) / 1000;
      const tp = Math.min(elapsed * speed, dur);
      const wp = sampleAt(tp);
      const targetWorld = [origin[0] + wp.pos[0], origin[1] + wp.pos[1], origin[2] + wp.pos[2]];
      const targetYaw = wrap180(yaw0 + wp.yawRel);
      const curYaw = wrap180(lastPose.rot[1]);
      const th = curYaw * Math.PI / 180;
      const dx = targetWorld[0] - lastPose.pos[0], dy = targetWorld[1] - lastPose.pos[1], dz = targetWorld[2] - lastPose.pos[2];
      const front = dx * Math.sin(th) + dz * Math.cos(th);
      const left = -dx * Math.cos(th) + dz * Math.sin(th);
      const yawErr = wrap180(targetYaw - curYaw);
      const posErr = dist3(lastPose.pos, targetWorld);
      ticks++; sumPos += posErr; maxPos = Math.max(maxPos, posErr); maxYaw = Math.max(maxYaw, Math.abs(yawErr));
      if (smoothYaw) {
        if (Math.abs(yawErr) > 1.5) {
          const deg = Math.min(8, Math.abs(yawErr));
          const axisY = (yawErr > 0 ? turnSign : -turnSign) > 0 ? 'LookRight' : 'LookLeft';
          await pulseAxisNT(axisY, Math.min(90, deg / (yawRate || 36) * 1000));
        }
      } else {
        let yawV = 0;
        if (Math.abs(yawErr) > 1.2) yawV = Math.max(-1, Math.min(1, (turnSign * yawErr) / 12));
        try { await sendF('/input/LookHorizontal', yawV); } catch (e) {}
      }
      const absF = Math.abs(front), absL = Math.abs(left), absU = Math.abs(dy);
      const db = smoothYaw ? 0.08 : 0.035;
      const remain = Math.max(30, TICK - 25);
      if (absU > Math.max(absF, absL) && absU > db) await pulseVertNT(dy >= 0 ? 1 : -1, remain);
      else if (absF >= absL && absF > db) await pulseAxisNT(front >= 0 ? 'MoveForward' : 'MoveBackward', remain);
      else if (absL > db) await pulseAxisNT(left >= 0 ? 'MoveLeft' : 'MoveRight', remain);
      else await sleep(25);
      if (elapsed * speed >= dur + 0.10) break;
    }
    // 收尾: 最多 3 秒把"偏航 + 位置"收敛到终点(v1 的终点精度靠停稳, v2 用专门收尾段补回)
    const fin = sampleAt(dur);
    const finalWorld = [origin[0] + fin.pos[0], origin[1] + fin.pos[1], origin[2] + fin.pos[2]];
    const finalYawTarget = wrap180(yaw0 + fin.yawRel);
    for (let i = 0; i < 60; i++) {
      const curYaw2 = wrap180(lastPose.rot[1]);
      const yerr2 = wrap180(finalYawTarget - curYaw2);
      const th2 = curYaw2 * Math.PI / 180;
      const dx2 = finalWorld[0] - lastPose.pos[0], dy2 = finalWorld[1] - lastPose.pos[1], dz2 = finalWorld[2] - lastPose.pos[2];
      const f2 = dx2 * Math.sin(th2) + dz2 * Math.cos(th2);
      const l2 = -dx2 * Math.cos(th2) + dz2 * Math.sin(th2);
      const perr = dist3(lastPose.pos, finalWorld);
      if (Math.abs(yerr2) <= 1 && perr <= 0.05) break;
      if (smoothYaw) {
        if (Math.abs(yerr2) > 1) {
          const axisY2 = (yerr2 > 0 ? turnSign : -turnSign) > 0 ? 'LookRight' : 'LookLeft';
          await pulseAxisNT(axisY2, Math.min(120, Math.abs(yerr2) / (yawRate || 36) * 1000));
        }
      } else {
        let yv = 0;
        if (Math.abs(yerr2) > 1) yv = Math.max(-1, Math.min(1, (turnSign * yerr2) / 10));
        try { await sendF('/input/LookHorizontal', yv); } catch (e) {}
      }
      if (Math.abs(dy2) > 0.04 && Math.abs(dy2) >= Math.max(Math.abs(f2), Math.abs(l2))) await pulseVertNT(dy2 >= 0 ? 1 : -1, 55);
      else if (Math.abs(f2) >= Math.abs(l2) && Math.abs(f2) > 0.035) await pulseAxisNT(f2 >= 0 ? 'MoveForward' : 'MoveBackward', 55);
      else if (Math.abs(l2) > 0.035) await pulseAxisNT(l2 >= 0 ? 'MoveLeft' : 'MoveRight', 55);
      else await sleep(30);
    }
    try { await sendF('/input/LookHorizontal', 0); } catch (e) {}
    await sleep(200);
    const elapsed = (Date.now() - tStart) / 1000;
    const finalPosErr = dist3(lastPose.pos, finalWorld);
    const finalYawErr = wrap180(finalYawTarget - wrap180(lastPose.rot[1]));
    const out = {
      at: new Date().toISOString(), mode: 'continuous-v2', file: file, speed: speed,
      recordedDurationSec: round3(dur), elapsedSec: +elapsed.toFixed(1), ratio: +(elapsed / dur).toFixed(2),
      ticks: ticks, meanPosErr: round3(sumPos / Math.max(1, ticks)), maxPosErr: round3(maxPos), maxYawErr: round3(maxYaw),
      finalPosErr: round3(finalPosErr), finalYawErr: round3(finalYawErr),
      origin: origin.map(round3), yaw0: round3(yaw0), recordedPitchRange: [round3(pMin), round3(pMax)],
      poseSamples: poseSamples.length, samples: poseSamples,
    };
    fs.mkdirSync('logs', { recursive: true });
    out.fileOut = 'logs/replay-cont-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    fs.writeFileSync(out.fileOut, JSON.stringify(out, null, 1), 'utf8');
    console.log('');
    console.log('连续重放完成: 用时 ' + elapsed.toFixed(1) + ' s(原 ' + dur.toFixed(1) + ' s, 倍率 ' + (elapsed / dur).toFixed(2) + ') / tick ' + ticks);
    console.log('  平均位置误差 ' + ((sumPos / Math.max(1, ticks)) * 100).toFixed(1) + ' cm / 最大位置误差 ' + (maxPos * 100).toFixed(1) + ' cm / 最大偏航误差 ' + maxYaw.toFixed(2) + '°');
    console.log('  终点位置误差 ' + (finalPosErr * 100).toFixed(1) + ' cm / 终点偏航误差 ' + finalYawErr.toFixed(2) + '°');
    console.log('  明细已存 ' + out.fileOut);
    return out;
  } finally {
    try { await sendF('/input/LookVertical', 0); } catch (e) {}
    try { await sendF('/input/LookHorizontal', 0); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (tsEdited) { try { await sendF('/usercamera/TurnSpeed', ts0); await sleep(180); } catch (e) {} }
    if (isFinite(s0) && s0 !== 0) { try { await sendF('/usercamera/SmoothingStrength', s0); await sleep(180); } catch (e) {} }
    if (pre.flying === false) { try { await send('/usercamera/Flying', [false]); await sleep(180); } catch (e) {} }
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// ===== 平滑重放 v3(2026-10-30, 治"运动中位置反馈抖动") =====
// 抖动根因: v2 用"位置误差 -> 30~45ms 脉冲"驱动; FlySpeed=0.2 时实际 ~3.1 m/s, 最小脉冲 = 9~14 cm,
//          而每 tick 目标只前进 ~8 cm -> 过冲/来回修正 + 轴抖动. 偏航每 tick 纠偏也会左右摆.
// v3 改法: ① 重放期间临时降低 FlySpeed(默认 0.1)并实测真实速度 -> 脉冲粒度变小;
//          ② 用录制轨迹的"速度前馈"决定脉冲时长(方向稳定, 不再靠误差追);
//          ③ 位置修正加 12 cm 死区(小于死区不修正, 消除稳态抖动); ④ 偏航用前馈角速度 + 死区比例修正.
async function replaySmooth(file, speedFactor, maxSec, dry) {
  const speed = Math.max(0.3, Math.min(2, Number(speedFactor) || 1.0));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = Array.isArray(j.samples) ? j.samples : [];
  if (raw.length < 5) throw new Error('轨迹样本太少: ' + raw.length);
  const b = raw[0];
  const dur = raw[raw.length - 1].t;
  const timeLimit = Math.max(0.5, Math.min(dur, Number(maxSec) || dur));
  const relPos = raw.map(function (s) { return [s.pos[0] - b.pos[0], s.pos[1] - b.pos[1], s.pos[2] - b.pos[2]]; });
  const relYaw = []; let prevRaw = Number(b.rot[1]) || 0, accYaw = 0;
  for (const s of raw) { accYaw += wrap180((Number(s.rot[1]) || 0) - prevRaw); prevRaw = Number(s.rot[1]) || 0; relYaw.push(accYaw); }
  let pMin = 999, pMax = -999;
  for (const s of raw) { pMin = Math.min(pMin, s.rot[0]); pMax = Math.max(pMax, s.rot[0]); }
  console.log('轨迹: ' + file + ' | 样本 ' + raw.length + ' | 时长 ' + dur.toFixed(2) + 's | 本次重放 ' + timeLimit.toFixed(1) + 's | 俯仰 ' + pMin.toFixed(1) + '~' + pMax.toFixed(1) + '°' + (Math.max(Math.abs(pMin), Math.abs(pMax)) > 5 ? ' ⚠️(无法重放,按水平)' : ''));
  console.log('平滑重放 v3: 倍速 ' + speed + 'x | 前馈+死区修正 | 降 FlySpeed 提精度');
  let idx = 0;
  function sampleAt(t) {
    while (idx < raw.length - 1 && raw[idx + 1].t <= t) idx++;
    const ai = idx, ni = Math.min(idx + 1, raw.length - 1);
    const span = Math.max(1e-6, raw[ni].t - raw[ai].t);
    const u = Math.max(0, Math.min(1, (t - raw[ai].t) / span));
    return { pos: [relPos[ai][0] + (relPos[ni][0] - relPos[ai][0]) * u, relPos[ai][1] + (relPos[ni][1] - relPos[ai][1]) * u, relPos[ai][2] + (relPos[ni][2] - relPos[ai][2]) * u], yawRel: relYaw[ai] + (relYaw[ni] - relYaw[ai]) * u };
  }
  let vidx = 0;
  function velAt(t) {
    const w = 0.15;
    const t1 = Math.max(0, t - w), t2 = Math.min(dur, t + w);
    while (vidx < raw.length - 1 && raw[vidx].t < t1) vidx++;
    let i1 = vidx; while (i1 > 0 && raw[i1].t > t1) i1--;
    let i2 = vidx; while (i2 < raw.length - 1 && raw[i2].t < t2) i2++;
    const dt = Math.max(0.02, raw[i2].t - raw[i1].t);
    return { v: [(relPos[i2][0] - relPos[i1][0]) / dt, (relPos[i2][1] - relPos[i1][1]) / dt, (relPos[i2][2] - relPos[i1][2]) / dt], w: (relYaw[i2] - relYaw[i1]) / dt };
  }
  if (dry) {
    console.log('t(s)  速度前馈(m/s)  偏航前馈(°/s)  目标偏移(m)');
    for (let t = 0; t <= timeLimit + 0.001; t += Math.max(0.5, timeLimit / 12)) {
      const s = sampleAt(t), vv = velAt(t);
      console.log(t.toFixed(1) + '   ' + Math.hypot(vv.v[0], vv.v[1], vv.v[2]).toFixed(2) + '   ' + vv.w.toFixed(1) + '   [' + s.pos.map(function (x) { return x.toFixed(2); }).join(', ') + ']');
    }
    console.log('(dry: 只打印前馈计划, 相机不动)');
    return { dry: true };
  }
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = { flying: one(await getVal('/usercamera/Flying')), smoothing: one(await getVal('/usercamera/SmoothingStrength')), turnSpeed: one(await getVal('/usercamera/TurnSpeed')), flySpeed: one(await getVal('/usercamera/FlySpeed')) };
  poseSock = await bindPose();
  const s0 = Number(pre.smoothing), ts0 = Number(pre.turnSpeed), fs0 = Number(pre.flySpeed);
  const TICK = 110;
  let vReal = 0.55, vVert = 3.1, yawRate = 175, reqSpeed = 0.1, speedEff = speed, turnEdited = false;
  const pulseAxisNT = async function (axis, ms) { const d = Math.max(20, Math.min(260, Math.round(ms))); try { await send('/input/' + axis, [true]); await sleep(d); } finally { await send('/input/' + axis, [false]); } await sleep(12); };
  const holdVertNT = async function (dir, ms) { const d = Math.max(20, Math.min(260, Math.round(ms))); try { await sendF('/input/LookVertical', dir); await sleep(d); } finally { await sendF('/input/LookVertical', 0); } await sleep(12); };
  // 测速: 脉冲后必须等 Pose 稳定再读终点(Pose 事件驱动, 停稳帧可能晚到 100~200ms)
  const measureDist = async function (kind, ms) {
    const before = lastPose.pos.slice();
    if (kind === 'V') await holdVertNT(1, ms); else await pulseAxisNT(kind, ms);
    await sleep(350);
    return dist3(lastPose.pos, before) / (ms / 1000);
  };
  try {
    if (pre.flying !== true) { await send('/usercamera/Flying', [true]); await sleep(400); }
    if (isFinite(s0) && s0 !== 0) { await sendF('/usercamera/SmoothingStrength', 0); await sleep(250); }
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose(飞行模式没开?)'); }
    await sleep(250);
    const origin = lastPose.pos.slice();
    const yaw0 = wrap180(lastPose.rot[1]);
    let pNow = ((Number(lastPose.rot[0]) % 360) + 360) % 360; if (pNow > 180) pNow -= 360;
    if (Math.abs(pNow) > 5) throw new Error('相机俯仰 ' + pNow.toFixed(1) + '°, 请先把相机放平再重放');
    // 校验 SmoothingStrength 真的是 0(OSCQuery 读回可能滞后, 等 1 秒再读)
    let sRead = Number(one(await getVal('/usercamera/SmoothingStrength')));
    if (sRead !== 0) { await sleep(1000); sRead = Number(one(await getVal('/usercamera/SmoothingStrength'))); }
    if (sRead !== 0) { await sendF('/usercamera/SmoothingStrength', 0); await sleep(700); sRead = Number(one(await getVal('/usercamera/SmoothingStrength'))); }
    if (sRead !== 0) throw new Error('SmoothingStrength 写 0 失败(读回 ' + sRead + '), 测速会失真, 已中止');
    // 实测真实速度(不改 FlySpeed —— 用户设置不能动); 录制速度若超过实际速度, 自动降倍速播放
    if (!isFinite(ts0) || Math.abs(ts0 - 0.2) > 0.001) { await sendF('/usercamera/TurnSpeed', 0.2); turnEdited = true; await sleep(350); }
    vReal = await measureDist('MoveForward', 200); if (!(vReal > 0.1 && vReal < 8)) vReal = 0.55;
    vVert = await measureDist('V', 200); if (!(vVert > 0.2 && vVert < 8)) vVert = 3.1;
    const ya = wrap180(lastPose.rot[1]); await pulseAxisNT('LookRight', 200); await sleep(300); const dyw = wrap180(wrap180(lastPose.rot[1]) - ya); yawRate = Math.abs(dyw) / 0.2; if (!(yawRate > 8 && yawRate < 400)) yawRate = 36; const turnSign = dyw >= 0 ? 1 : -1;
    for (let t0 = 0; t0 <= timeLimit; t0 += 0.2) { const vv0 = velAt(t0); reqSpeed = Math.max(reqSpeed, Math.hypot(vv0.v[0], vv0.v[2])); }
    speedEff = Math.min(speed, Math.max(0.25, 0.85 * vReal / Math.max(0.1, reqSpeed)));
    console.log('实测: 水平 ' + vReal.toFixed(2) + ' m/s / 垂直 ' + vVert.toFixed(2) + ' m/s / 偏航 ' + yawRate.toFixed(1) + ' °/s');
    console.log('轨迹需求速度 ' + reqSpeed.toFixed(2) + ' m/s -> 自动倍速 ' + speedEff.toFixed(2) + 'x(不改 FlySpeed, 不破坏用户设置)');
    // 重新记录起点(降速/标定脉冲之后)
    const o2 = lastPose.pos.slice();
    const y2 = wrap180(lastPose.rot[1]);
    const tStart = Date.now();
    let ticks = 0, sumPos = 0, maxPos = 0, maxYaw = 0, iter = 0;
    const tickLog = [];
    while (true) {
      iter++; if (iter > 4000) break;
      const elapsed = (Date.now() - tStart) / 1000;
      const tp = Math.min(elapsed * speedEff, timeLimit);
      const wp = sampleAt(tp);
      const targetWorld = [o2[0] + wp.pos[0], o2[1] + wp.pos[1], o2[2] + wp.pos[2]];
      const targetYaw = wrap180(y2 + wp.yawRel);
      const curYaw = wrap180(lastPose.rot[1]);
      const th = curYaw * Math.PI / 180;
      const dx = targetWorld[0] - lastPose.pos[0], dy = targetWorld[1] - lastPose.pos[1], dz = targetWorld[2] - lastPose.pos[2];
      const posErr = dist3(lastPose.pos, targetWorld);
      const yawErr = wrap180(targetYaw - curYaw);
      ticks++; sumPos += posErr; maxPos = Math.max(maxPos, posErr); maxYaw = Math.max(maxYaw, Math.abs(yawErr));
      // 偏航前馈 + 死区修正(bool 脉冲; 实测 /input/LookHorizontal 只有 ±1 有效)
      const vv = velAt(tp);
      let yawCmd = vv.w * speedEff;
      if (Math.abs(yawErr) > 1.2) yawCmd += Math.sign(yawErr) * Math.min(30, Math.abs(yawErr) * 4);
      const yawDeg = yawCmd * (TICK / 1000);
      const actions = [];
      const addAction = function (axis, ms, dir) {
        const a = actions.find(function (x) { return x.axis === axis; });
        if (a) { a.ms = Math.max(a.ms, ms); return; }
        actions.push({ axis: axis, ms: ms, dir: dir || 0 });
      };
      if (Math.abs(yawDeg) > 0.45) {
        const yawAxis = (yawDeg > 0 ? turnSign : -turnSign) > 0 ? 'LookRight' : 'LookLeft';
        addAction(yawAxis, Math.abs(yawDeg) / yawRate * 1000, 0);
      }
      // 平移前馈: 录制速度 -> 相机系 -> 保持时长
      const ff = vReal > 0.3 ? vReal : 1.5;
      const fwd = vv.v[0] * Math.sin(th) + vv.v[2] * Math.cos(th);
      const lft = -vv.v[0] * Math.cos(th) + vv.v[2] * Math.sin(th);
      const upl = vv.v[1];
      const dF = Math.abs(fwd) * speedEff / ff * TICK, dL = Math.abs(lft) * speedEff / ff * TICK, dU = Math.abs(upl) * speedEff / vVert * TICK;
      if (dF >= 20) addAction(fwd >= 0 ? 'MoveForward' : 'MoveBackward', dF, 0);
      if (dL >= 20) addAction(lft >= 0 ? 'MoveLeft' : 'MoveRight', dL, 0);
      if (dU >= 20) addAction('V', dU, upl >= 0 ? 1 : -1);
      // 位置修正: 误差超死区才补(合并到同轴, 取较长时长)
      if (posErr > 0.12) {
        const absF = Math.abs(dx * Math.sin(th) + dz * Math.cos(th)), absL = Math.abs(-dx * Math.cos(th) + dz * Math.sin(th)), absU = Math.abs(dy);
        const corr = Math.min(70, 25 + posErr * 100);
        if (absU > Math.max(absF, absL) && absU > 0.06) addAction('V', corr, dy >= 0 ? 1 : -1);
        else if (absF >= absL && absF > 0.06) addAction((dx * Math.sin(th) + dz * Math.cos(th)) >= 0 ? 'MoveForward' : 'MoveBackward', corr, 0);
        else if (absL > 0.06) addAction((-dx * Math.cos(th) + dz * Math.sin(th)) >= 0 ? 'MoveLeft' : 'MoveRight', corr, 0);
      }
      tickLog.push({ tp: +tp.toFixed(2), posErr: +posErr.toFixed(3), yawErr: +yawErr.toFixed(1), acts: actions.map(function (a) { return a.axis + ':' + Math.round(a.ms); }).join(' ') });
      if (actions.length === 0) await sleep(35);
      else {
        // 并发启动, 按各自时长独立释放(避免串行把 tick 拉长 -> 追不上目标)
        try {
          for (const a of actions) { if (a.axis === 'V') await sendF('/input/LookVertical', a.dir); else await send('/input/' + a.axis, [true]); }
        } catch (e) {}
        const tA = Date.now();
        const sortedA = actions.slice().sort(function (x, y) { return x.ms - y.ms; });
        for (const a of sortedA) {
          const wait = a.ms - (Date.now() - tA);
          if (wait > 0) await sleep(wait);
          try { if (a.axis === 'V') await sendF('/input/LookVertical', 0); else await send('/input/' + a.axis, [false]); } catch (e) {}
        }
        await sleep(15);
      }
      if (elapsed * speedEff >= timeLimit + 0.05) break;
    }
    // 收尾: 最多 3 秒把"偏航 + 位置"收敛到终点(避免播放结束还在追)
    const fin0 = sampleAt(timeLimit);
    const finWorld = [o2[0] + fin0.pos[0], o2[1] + fin0.pos[1], o2[2] + fin0.pos[2]];
    const finYaw = wrap180(y2 + fin0.yawRel);
    for (let i = 0; i < 45; i++) {
      const cy = wrap180(lastPose.rot[1]);
      const ye = wrap180(finYaw - cy);
      const th2 = cy * Math.PI / 180;
      const dx2 = finWorld[0] - lastPose.pos[0], dy2 = finWorld[1] - lastPose.pos[1], dz2 = finWorld[2] - lastPose.pos[2];
      const pe = dist3(lastPose.pos, finWorld);
      if (Math.abs(ye) <= 1.2 && pe <= 0.05) break;
      if (Math.abs(ye) > 1) { const yAxis = (ye > 0 ? turnSign : -turnSign) > 0 ? 'LookRight' : 'LookLeft'; await pulseAxisNT(yAxis, Math.min(120, Math.abs(ye) / yawRate * 1000)); await sleep(120); }
      const absF = Math.abs(dx2 * Math.sin(th2) + dz2 * Math.cos(th2));
      const absL = Math.abs(-dx2 * Math.cos(th2) + dz2 * Math.sin(th2));
      const absU = Math.abs(dy2);
      const corrMs = 60;
      if (absU > Math.max(absF, absL) && absU > 0.05) await holdVertNT(dy2 >= 0 ? 1 : -1, corrMs);
      else if (absF >= absL && absF > 0.04) await pulseAxisNT((dx2 * Math.sin(th2) + dz2 * Math.cos(th2)) >= 0 ? 'MoveForward' : 'MoveBackward', corrMs);
      else if (absL > 0.04) await pulseAxisNT((-dx2 * Math.cos(th2) + dz2 * Math.sin(th2)) >= 0 ? 'MoveLeft' : 'MoveRight', corrMs);
      else await sleep(35);
    }
    try { await sendF('/input/LookHorizontal', 0); } catch (e) {}
    await sleep(200);
    const elapsed = (Date.now() - tStart) / 1000;
    const fin = sampleAt(timeLimit);
    const finalWorld = [o2[0] + fin.pos[0], o2[1] + fin.pos[1], o2[2] + fin.pos[2]];
    const finalPosErr = dist3(lastPose.pos, finalWorld);
    const finalYawErr = wrap180(wrap180(y2 + fin.yawRel) - wrap180(lastPose.rot[1]));
    // 抖动指标: Pose 速度的高频变化(加速度噪声)
    const ss = [];
    for (let i = 1; i < poseSamples.length; i++) { const a = poseSamples[i - 1], c = poseSamples[i]; const dt = (c.ms - a.ms) / 1000; if (dt <= 0 || dt > 0.2) continue; const sp = dist3(c.pos, a.pos) / dt; ss.push({ sp: sp, t: c.ms / 1000 }); }
    const accs = [];
    for (let i = 1; i < ss.length; i++) { const dt = ss[i].t - ss[i - 1].t; if (dt <= 0) continue; accs.push(Math.abs(ss[i].sp - ss[i - 1].sp) / dt); }
    accs.sort(function (x, y) { return x - y; });
    const meanAcc = accs.length ? accs.reduce(function (a, b) { return a + b; }, 0) / accs.length : 0;
    const p95Acc = accs.length ? accs[Math.min(accs.length - 1, Math.floor(accs.length * 0.95))] : 0;
    const out = { at: new Date().toISOString(), mode: 'smooth-v3', file: file, speed: speed, timeLimit: round3(timeLimit),
      recordedDurationSec: round3(dur), elapsedSec: +elapsed.toFixed(1), ratio: +(elapsed / timeLimit).toFixed(2),
      speedEff: round3(speedEff), reqSpeed: round3(reqSpeed), vReal: round3(vReal), vVert: round3(vVert), yawRate: round3(yawRate),
      ticks: ticks, meanPosErr: round3(sumPos / Math.max(1, ticks)), maxPosErr: round3(maxPos), maxYawErr: round3(maxYaw),
      finalPosErr: round3(finalPosErr), finalYawErr: round3(finalYawErr),
      jitterMeanAccel: round3(meanAcc), jitterP95Accel: round3(p95Acc), poseSamples: poseSamples.length,
      origin: o2.map(round3), yaw0: round3(y2), tickLog: tickLog, samples: poseSamples };
    fs.mkdirSync('logs', { recursive: true });
    out.fileOut = 'logs/replay-smooth-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    fs.writeFileSync(out.fileOut, JSON.stringify(out, null, 1), 'utf8');
    console.log('');
    console.log('平滑重放完成: 用时 ' + elapsed.toFixed(1) + ' s(本次目标 ' + timeLimit.toFixed(1) + ' s, 倍率 ' + (elapsed / timeLimit).toFixed(2) + ') / tick ' + ticks);
    console.log('  平均位置误差 ' + ((sumPos / Math.max(1, ticks)) * 100).toFixed(1) + ' cm / 最大 ' + (maxPos * 100).toFixed(1) + ' cm / 最大偏航误差 ' + maxYaw.toFixed(2) + '°');
    console.log('  终点位置误差 ' + (finalPosErr * 100).toFixed(1) + ' cm / 终点偏航误差 ' + finalYawErr.toFixed(2) + '°');
    console.log('  抖动指标: 平均加速度噪声 ' + meanAcc.toFixed(2) + ' m/s² / P95 ' + p95Acc.toFixed(2) + ' m/s²');
    console.log('  明细已存 ' + out.fileOut);
    return out;
  } finally {
    try { await sendF('/input/LookHorizontal', 0); } catch (e) {}
    try { await sendF('/input/LookVertical', 0); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (turnEdited) { try { await sendF('/usercamera/TurnSpeed', ts0); await sleep(200); } catch (e) {} }
    if (isFinite(s0) && s0 !== 0) { try { await sendF('/usercamera/SmoothingStrength', s0); await sleep(200); } catch (e) {} }
    if (pre.flying === false) { try { await send('/usercamera/Flying', [false]); await sleep(150); } catch (e) {} }
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// ===== 分段锚定重放(2026-10-30, 用户提议): 开环前馈 + 段末终点修正, 防累积误差 =====
// 思路: 把一条轨迹切成 N 段; 每段只做"速度前馈"(不做逐 tick 位置反馈 -> 不抖), 段末用闭环把终点拉回"意图坐标";
//       下一段的意图坐标锚定在全局计划上 -> 上一段的残余误差在段末被吃掉, 不会越跑越偏.
async function replaySegments(file, segCount, speedFactor, maxSeg, dry) {
  const speed = Math.max(0.3, Math.min(2, Number(speedFactor) || 1.0));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const raw = Array.isArray(j.samples) ? j.samples : [];
  if (raw.length < 5) throw new Error('轨迹样本太少: ' + raw.length);
  const b = raw[0];
  const dur = raw[raw.length - 1].t;
  const nSeg = Math.max(2, Math.min(6, Number(segCount) || 3));
  const segsToRun = Math.min(nSeg, Math.max(1, Number(maxSeg) || nSeg));
  const segDur = dur / nSeg;
  const relPos = raw.map(function (s) { return [s.pos[0] - b.pos[0], s.pos[1] - b.pos[1], s.pos[2] - b.pos[2]]; });
  const relYaw = []; let prevRaw = Number(b.rot[1]) || 0, accYaw = 0;
  for (const s of raw) { accYaw += wrap180((Number(s.rot[1]) || 0) - prevRaw); prevRaw = Number(s.rot[1]) || 0; relYaw.push(accYaw); }
  let pMin = 999, pMax = -999; for (const s of raw) { pMin = Math.min(pMin, s.rot[0]); pMax = Math.max(pMax, s.rot[0]); }
  console.log('轨迹: ' + file + ' | 样本 ' + raw.length + ' | 时长 ' + dur.toFixed(2) + 's | 分段 ' + nSeg + ' x ' + segDur.toFixed(1) + 's | 俯仰 ' + pMin.toFixed(1) + '~' + pMax.toFixed(1) + '°' + (Math.max(Math.abs(pMin), Math.abs(pMax)) > 5 ? ' ⚠️(无法重放,按水平)' : ''));
  let idx = 0;
  function sampleAt(t) { while (idx < raw.length - 1 && raw[idx + 1].t <= t) idx++; const ai = idx, ni = Math.min(idx + 1, raw.length - 1); const span = Math.max(1e-6, raw[ni].t - raw[ai].t); const u = Math.max(0, Math.min(1, (t - raw[ai].t) / span)); return { pos: [relPos[ai][0] + (relPos[ni][0] - relPos[ai][0]) * u, relPos[ai][1] + (relPos[ni][1] - relPos[ai][1]) * u, relPos[ai][2] + (relPos[ni][2] - relPos[ai][2]) * u], yawRel: relYaw[ai] + (relYaw[ni] - relYaw[ai]) * u }; }
  let vidx = 0;
  function velAt(t) { const w = 0.15; const t1 = Math.max(0, t - w), t2 = Math.min(dur, t + w); while (vidx < raw.length - 1 && raw[vidx].t < t1) vidx++; let i1 = vidx; while (i1 > 0 && raw[i1].t > t1) i1--; let i2 = vidx; while (i2 < raw.length - 1 && raw[i2].t < t2) i2++; const dt = Math.max(0.02, raw[i2].t - raw[i1].t); return { v: [(relPos[i2][0] - relPos[i1][0]) / dt, (relPos[i2][1] - relPos[i1][1]) / dt, (relPos[i2][2] - relPos[i1][2]) / dt], w: (relYaw[i2] - relYaw[i1]) / dt }; }
  // 平滑速度表: 消除 Pose 稀疏/尖峰 -> 否则开环前馈会被 4.7 m/s 的假尖峰带飞(上一轮 4m 开环误差的来源)
  function sampleAt2(t) {
    let lo = 0, hi = raw.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (raw[mid].t <= t) lo = mid; else hi = mid - 1; }
    const ai = lo, ni = Math.min(lo + 1, raw.length - 1);
    const span = Math.max(1e-6, raw[ni].t - raw[ai].t);
    const u = Math.max(0, Math.min(1, (t - raw[ai].t) / span));
    return { pos: [relPos[ai][0] + (relPos[ni][0] - relPos[ai][0]) * u, relPos[ai][1] + (relPos[ni][1] - relPos[ai][1]) * u, relPos[ai][2] + (relPos[ni][2] - relPos[ai][2]) * u], yawRel: relYaw[ai] + (relYaw[ni] - relYaw[ai]) * u };
  }
  const VDT = 0.05;
  const velTab = [];
  for (let tt = 0; tt <= dur + 1e-9; tt += VDT) { const ss = sampleAt2(tt); velTab.push({ t: tt, p: ss.pos, y: ss.yawRel }); }
  const velS = velTab.map(function (row, i) {
    const i1 = Math.max(0, i - Math.round(0.15 / VDT)), i2 = Math.min(velTab.length - 1, i + Math.round(0.15 / VDT));
    const dt2 = Math.max(0.02, velTab[i2].t - velTab[i1].t);
    let vx = (velTab[i2].p[0] - velTab[i1].p[0]) / dt2, vy = (velTab[i2].p[1] - velTab[i1].p[1]) / dt2, vz = (velTab[i2].p[2] - velTab[i1].p[2]) / dt2;
    let w = (velTab[i2].y - velTab[i1].y) / dt2;
    const mag = Math.hypot(vx, vy, vz); if (mag > 2.0) { const k = 2.0 / mag; vx *= k; vy *= k; vz *= k; }
    if (Math.abs(w) > 120) w = Math.sign(w) * 120;
    return { t: row.t, v: [vx, vy, vz], w: w };
  });
  function velSmooth(t) { const fidx = Math.max(0, Math.min(velS.length - 1, t / VDT)); const i = Math.floor(fidx), j = Math.min(velS.length - 1, i + 1), u = fidx - i; const a = velS[i], b = velS[j]; return { v: [a.v[0] + (b.v[0] - a.v[0]) * u, a.v[1] + (b.v[1] - a.v[1]) * u, a.v[2] + (b.v[2] - a.v[2]) * u], w: a.w + (b.w - a.w) * u }; }
  let reqSpeed = 0.1; for (let t0 = 0; t0 <= dur; t0 += 0.2) { const vv0 = velSmooth(t0); reqSpeed = Math.max(reqSpeed, Math.hypot(vv0.v[0], vv0.v[2])); }
  if (dry) {
    console.log('段  时间(s)      意图终点(相对起点)                意图偏航  需求速度');
    for (let k = 0; k < nSeg; k++) { const t0 = k * segDur, t1 = Math.min(dur, (k + 1) * segDur); const e = sampleAt2(t1); console.log(' ' + (k + 1) + '  ' + t0.toFixed(1) + '~' + t1.toFixed(1) + '   [' + e.pos.map(function (x) { return x.toFixed(2); }).join(', ') + ']   ' + e.yawRel.toFixed(1) + '°   ' + reqSpeed.toFixed(2) + ' m/s'); }
    console.log('(dry: 只打印分段计划, 相机不动)');
    return { dry: true, segCount: nSeg };
  }
  lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const pre = { flying: one(await getVal('/usercamera/Flying')), smoothing: one(await getVal('/usercamera/SmoothingStrength')), turnSpeed: one(await getVal('/usercamera/TurnSpeed')) };
  poseSock = await bindPose();
  const s0 = Number(pre.smoothing), ts0 = Number(pre.turnSpeed);
  let tsEdited = false;
  let vReal = 0.55, vVert = 3.1, yawRate = 90, turnSign = 1, speedEff = speed;
  const TICK = 80, TURN_TS = 0.1;
  const pulseAxisNT = async function (axis, ms) { const d = Math.max(20, Math.min(260, Math.round(ms))); try { await send('/input/' + axis, [true]); await sleep(d); } finally { await send('/input/' + axis, [false]); } await sleep(12); };
  const holdVertNT = async function (dir, ms) { const d = Math.max(20, Math.min(260, Math.round(ms))); try { await sendF('/input/LookVertical', dir); await sleep(d); } finally { await sendF('/input/LookVertical', 0); } await sleep(12); };
  const measureDist = async function (kind, ms) { const before = lastPose.pos.slice(); if (kind === 'V') await holdVertNT(1, ms); else await pulseAxisNT(kind, ms); await sleep(350); return dist3(lastPose.pos, before) / (ms / 1000); };
  try {
    if (pre.flying !== true) { await send('/usercamera/Flying', [true]); await sleep(400); }
    if (isFinite(s0) && s0 !== 0) { await sendF('/usercamera/SmoothingStrength', 0); await sleep(250); }
    if (!isFinite(ts0) || Math.abs(ts0 - TURN_TS) > 0.001) {
      tsEdited = true;
      for (let attempt = 0; attempt < 3; attempt++) {
        await sendF('/usercamera/TurnSpeed', TURN_TS); await sleep(800);
        const tsRead = Number(one(await getVal('/usercamera/TurnSpeed')));
        if (isFinite(tsRead) && Math.abs(tsRead - TURN_TS) < 0.001) break;
      }
    }
    if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose(飞行模式没开?)'); }
    await sleep(250);
    vReal = await measureDist('MoveForward', 200); if (!(vReal > 0.1 && vReal < 8)) vReal = 0.55;
    vVert = await measureDist('V', 200); if (!(vVert > 0.2 && vVert < 8)) vVert = 3.1;
    const yb = wrap180(lastPose.rot[1]); await pulseAxisNT('LookRight', 200); await sleep(300); const dyb = wrap180(wrap180(lastPose.rot[1]) - yb); yawRate = Math.abs(dyb) / 0.2; if (!(yawRate > 20 && yawRate < 400)) yawRate = 90; turnSign = dyb >= 0 ? 1 : -1;
    speedEff = Math.min(speed, Math.max(0.25, 0.85 * vReal / Math.max(0.1, reqSpeed)));
    console.log('实测: 水平 ' + vReal.toFixed(2) + ' m/s / 垂直 ' + vVert.toFixed(2) + ' m/s / 偏航(TurnSpeed ' + TURN_TS + ') ' + yawRate.toFixed(1) + ' °/s');
    console.log('轨迹需求速度 ' + reqSpeed.toFixed(2) + ' m/s -> 开环倍速 ' + speedEff.toFixed(2) + 'x(不改 FlySpeed)');
    const aPos2 = lastPose.pos.slice();
    const aYaw2 = wrap180(lastPose.rot[1]);
    const results = [];
    const tStartAll = Date.now();
    for (let k = 0; k < segsToRun; k++) {
      const t0 = k * segDur, t1 = Math.min(dur, (k + 1) * segDur);
      const endS = sampleAt2(t1);
      const intendedEnd = [aPos2[0] + endS.pos[0], aPos2[1] + endS.pos[1], aPos2[2] + endS.pos[2]];
      const intendedYawEnd = wrap180(aYaw2 + endS.yawRel);
      const segStart = Date.now();
      let debtYaw = 0;
      const segPlay = (t1 - t0) / speedEff;
      while (true) {
        const el = (Date.now() - segStart) / 1000;
        const tp = t0 + Math.min((t1 - t0), el * speedEff);
        const vv = velSmooth(tp);
        const curYaw = wrap180(lastPose.rot[1]);
        const th = curYaw * Math.PI / 180;
        const fwd = vv.v[0] * Math.sin(th) + vv.v[2] * Math.cos(th);
        const lft = -vv.v[0] * Math.cos(th) + vv.v[2] * Math.sin(th);
        const upl = vv.v[1];
        // 平移: 直接用模拟量(/input/Vertical + /input/Horizontal + /input/LookVertical) —— 两方向同时走也用连续量, 没有 bool 脉冲顿挫
        const clamp1 = function (x) { return Math.max(-1, Math.min(1, x)); };
        const vF = fwd * speedEff, vR = -lft * speedEff, vU = upl * speedEff, wS = vv.w * speedEff;
        // 静止/近静止: 硬归零并完全不动(避免"模拟量微修正"导致静止时持续抖动)
        if (Math.abs(vF) < 0.01 && Math.abs(vR) < 0.01 && Math.abs(vU) < 0.01 && Math.abs(wS) < 0.3) {
          try { await sendF('/input/Vertical', 0); await sendF('/input/Horizontal', 0); await sendF('/input/LookVertical', 0); } catch (e) {}
          debtYaw = 0;
          await sleep(40);
        } else {
          try {
            await sendF('/input/Vertical', clamp1(vF / vReal));
            await sendF('/input/Horizontal', clamp1(vR / vReal));
            await sendF('/input/LookVertical', clamp1(vU / vVert));
          } catch (e) {}
          debtYaw += wS * (TICK / 1000);
          if (Math.abs(debtYaw) >= 0.25) {
            const ms = Math.max(20, Math.abs(debtYaw) / yawRate * 1000);
            await pulseAxisNT((debtYaw > 0 ? turnSign : -turnSign) > 0 ? 'LookRight' : 'LookLeft', ms);
            debtYaw -= Math.sign(debtYaw) * (ms / 1000) * yawRate;
          }
          debtYaw = Math.max(-4, Math.min(4, debtYaw));
          await sleep(20);
        }
        if (el >= segPlay) break;
      }
      try { await sendF('/input/Vertical', 0); await sendF('/input/Horizontal', 0); await sendF('/input/LookVertical', 0); } catch (e) {}
      const openErr = dist3(lastPose.pos, intendedEnd);
      const openYawErr = wrap180(intendedYawEnd - wrap180(lastPose.rot[1]));
      for (let i = 0; i < 90; i++) {
        const cy = wrap180(lastPose.rot[1]);
        const ye = wrap180(intendedYawEnd - cy);
        const thc = cy * Math.PI / 180;
        const dxc = intendedEnd[0] - lastPose.pos[0], dyc = intendedEnd[1] - lastPose.pos[1], dzc = intendedEnd[2] - lastPose.pos[2];
        const pe = dist3(lastPose.pos, intendedEnd);
        if (Math.abs(ye) <= 1.2 && pe <= 0.05) break;
        if (Math.abs(ye) > 1) { await pulseAxisNT((ye > 0 ? turnSign : -turnSign) > 0 ? 'LookRight' : 'LookLeft', Math.min(90, Math.abs(ye) / yawRate * 1000)); await sleep(80); }
        const f2 = dxc * Math.sin(thc) + dzc * Math.cos(thc);
        const l2 = -dxc * Math.cos(thc) + dzc * Math.sin(thc);
        const corrMs = Math.max(40, Math.min(140, 30 + pe * 120));
        if (Math.abs(dyc) > Math.max(Math.abs(f2), Math.abs(l2)) && Math.abs(dyc) > 0.04) await holdVertNT(dyc >= 0 ? 1 : -1, corrMs);
        else if (Math.abs(f2) >= Math.abs(l2) && Math.abs(f2) > 0.035) await pulseAxisNT(f2 >= 0 ? 'MoveForward' : 'MoveBackward', corrMs);
        else if (Math.abs(l2) > 0.035) await pulseAxisNT(l2 >= 0 ? 'MoveLeft' : 'MoveRight', corrMs);
        else await sleep(30);
      }
      const finalErr = dist3(lastPose.pos, intendedEnd);
      const finalYawErr = wrap180(intendedYawEnd - wrap180(lastPose.rot[1]));
      results.push({ seg: k + 1, t0: +t0.toFixed(1), t1: +t1.toFixed(1), openErr: round3(openErr), openYawErr: round3(openYawErr), finalErr: round3(finalErr), finalYawErr: round3(finalYawErr), reached: lastPose.pos.map(round3) });
      console.log('  段 ' + (k + 1) + '/' + nSeg + ' (' + t0.toFixed(1) + '~' + t1.toFixed(1) + 's): 开环误差 ' + (openErr * 100).toFixed(1) + ' cm -> 修正后 ' + (finalErr * 100).toFixed(1) + ' cm / 偏航 ' + finalYawErr.toFixed(2) + '°');
    }
    const elapsedAll = (Date.now() - tStartAll) / 1000;
    const lastR = results[results.length - 1];
    const out = { at: new Date().toISOString(), mode: 'seg-anchored', file: file, segCount: nSeg, speedEff: round3(speedEff), vReal: round3(vReal), yawRate: round3(yawRate), reqSpeed: round3(reqSpeed), elapsedSec: +elapsedAll.toFixed(1), results: results, finalErr: lastR.finalErr, finalYawErr: lastR.finalYawErr, anchorPos: aPos2.map(round3), anchorYaw: round3(aYaw2), samples: poseSamples };
    fs.mkdirSync('logs', { recursive: true });
    out.fileOut = 'logs/replay-seg-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    fs.writeFileSync(out.fileOut, JSON.stringify(out, null, 1), 'utf8');
    console.log('');
    console.log('分段锚定完成: ' + nSeg + ' 段 / 总用时 ' + elapsedAll.toFixed(1) + ' s / 最终误差 ' + (lastR.finalErr * 100).toFixed(1) + ' cm / 最终偏航 ' + lastR.finalYawErr.toFixed(2) + '°');
    console.log('  明细已存 ' + out.fileOut);
    return out;
  } finally {
    try { await sendF('/input/LookHorizontal', 0); } catch (e) {}
    try { await sendF('/input/LookVertical', 0); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (tsEdited) { try { await sendF('/usercamera/TurnSpeed', ts0); await sleep(200); } catch (e) {} }
    if (isFinite(s0) && s0 !== 0) { try { await sendF('/usercamera/SmoothingStrength', s0); await sleep(200); } catch (e) {} }
    if (pre.flying === false) { try { await send('/usercamera/Flying', [false]); await sleep(150); } catch (e) {} }
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

// 进程被杀时尽量把输入归零(硬杀 SIGKILL 无法拦截, 但 Ctrl+C / 任务终止可以)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, function () {
    try { zeroAll(); } catch (e) {}
    setTimeout(function () { process.exit(0); }, 120);
  });
}

(async () => {
  const [cmd, a1, a2, a3, a4] = process.argv.slice(2);
  const parse = v => v === 'true' ? true : (v === 'false' ? false : (isFinite(Number(v)) ? (String(v).indexOf('.') >= 0 ? Number(v) : Number(v)) : v));
  if (!cmd || cmd === 'probe') {
    console.log('OSCQuery 端口 = ' + PORT + (await getVal('/usercamera/Flying') === undefined ? '  ⚠️ 取不到(VRChat 没开?)' : ''));
    for (const k of ['Flying', 'FlySpeed', 'TurnSpeed', 'SmoothingStrength', 'Streaming', 'ShowUIInCamera', 'OrientationIsLandscape', 'Environment', 'GreenScreen']) console.log('  /usercamera/' + k.padEnd(24) + ' = ' + JSON.stringify(await getVal('/usercamera/' + k)));
    for (const k of ['Play', 'PlayDelayed']) console.log('  /dolly/' + k.padEnd(31) + ' = ' + JSON.stringify(await getVal('/dolly/' + k)));
    sock.close(); return;
  }
  if (cmd === 'shot') { await send('/usercamera/Capture', []); await sleep(4500); const ph = photos()[0]; console.log('📷 ' + (a1 || '') + ' -> ' + (ph ? ph.n : '(没拿到)')); sock.close(); return; }
  if (cmd === 'pulse') { const axis = a1, ms = Math.max(50, Math.min(20000, Number(a2) || 300));
    try { await send('/input/' + axis, [true]); await sleep(ms); } finally { await send('/input/' + axis, [false]); }
    console.log('已脉冲 ' + axis + ' ' + ms + 'ms(已归零)'); sock.close(); return; }
  if (cmd === 'zero' || cmd === 'panic') {
    await zeroAll();
    try { await sendF('/input/LookHorizontal', 0); await sendF('/input/LookVertical', 0); } catch (e) {}
    console.log('所有输入轴已归零' + (cmd === 'panic' ? '(panic)' : ''));
    sock.close(); return;
  }
  const map = { fly: '/usercamera/Flying', speed: '/usercamera/FlySpeed', turn: '/usercamera/TurnSpeed', streaming: '/usercamera/Streaming' };
  if (map[cmd]) { const v = parse(a1); if (typeof v === 'number') await sendNum(map[cmd], v); else await send(map[cmd], [v]); await sleep(700); console.log(cmd + ' -> ' + JSON.stringify(await getVal(map[cmd]))); sock.close(); return; }
  if (cmd === 'set') { const v = parse(a2); if (typeof v === 'number') await sendNum(a1, v); else await send(a1, [v]); await sleep(700); console.log(a1 + ' -> ' + JSON.stringify(await getVal(a1))); sock.close(); return; }
  if (cmd === 'setf') { await sendF(a1, parse(a2)); await sleep(700); console.log(a1 + ' (float) -> ' + JSON.stringify(await getVal(a1))); sock.close(); return; }
  if (cmd === 'dolly-play') { const d = Number(a1) || 1; await sendNum('/dolly/PlayDelayed', d); await sleep(600); console.log('已发 PlayDelayed ' + d + ' -> Play=' + JSON.stringify(await getVal('/dolly/Play'))); sock.close(); return; }
  if (cmd === 'dolly-stop') { await send('/dolly/Play', [false]); await sleep(600); console.log('已停 -> Play=' + JSON.stringify(await getVal('/dolly/Play'))); sock.close(); return; }
  if (cmd === 'dolly-import') { await send('/dolly/Import', [String(a1)]); await sleep(900); console.log('已发 Import "' + a1 + '" -> Play=' + JSON.stringify(await getVal('/dolly/Play'))); sock.close(); return; }
  if (cmd === 'axis') {
    const name = String(a1 || ''); const value = Number(a2);
    const ms = Math.max(30, Math.min(2000, Number(a3) || 150));
    if (!name || !isFinite(value)) { console.log('用法: node scripts/dev/camera-calib.js axis <轴名> <值> <毫秒>  例: axis LookHorizontal 1 200'); sock.close(); return; }
    lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
    poseSock = await bindPose();
    try {
      if (!lastPose) { await pulseAxis('MoveForward', 40); if (!(await waitPose(0, 2500))) throw new Error('收不到 /usercamera/Pose'); }
      await sleep(250);
      const before = { pos: lastPose.pos.slice(), rot: lastPose.rot.slice() };
      console.log('轴 ' + name + ' = ' + value + ' 保持 ' + ms + 'ms; 之前 pos=[' + before.pos.map((x) => x.toFixed(3)).join(', ') + '] rot=[' + before.rot.map((x) => x.toFixed(2)).join(', ') + ']');
      await holdFloat(name, value, ms);
      await sleep(200);
      const after = { pos: lastPose.pos.slice(), rot: lastPose.rot.slice() };
      console.log('之后 pos=[' + after.pos.map((x) => x.toFixed(3)).join(', ') + '] rot=[' + after.rot.map((x) => x.toFixed(2)).join(', ') + ']');
      console.log('变化: Δpos=[' + [0,1,2].map((i) => (after.pos[i] - before.pos[i]).toFixed(3)).join(', ') + '] Δrot=[' + [0,1,2].map((i) => (after.rot[i] - before.rot[i]).toFixed(2)).join(', ') + ']');
    } finally {
      try { await sendF('/input/' + name, 0); } catch (e) {}
      try { await zeroAll(); } catch (e) {}
      if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
    }
    sock.close(); return;
  }
  if (cmd === 'move-vertical') {
    const r = await moveVertical(Number(a1) || 1);
    console.log('');
    console.log('⭐ ' + (r.pass ? 'PASS' : 'FAIL') + ': ' + r.label + ' 目标 ΔY ' + r.target.toFixed(3) + ' m / 实际 ΔY ' + r.dy.toFixed(3) + ' m / 误差 ' + (r.error * 100).toFixed(1) + ' cm(判线 ±' + (r.tolerance * 100).toFixed(0) + ' cm, 水平漂移 ' + (r.horiz * 100).toFixed(1) + ' cm)');
    sock.close(); return;
  }
  if (cmd === 'range') {
    if (!a1) { console.log('用法: node scripts/dev/camera-calib.js range <轴> <秒> [值]  例: range MoveForward 4 / range LookVertical 3 1'); sock.close(); return; }
    const r = await rangeProbe(String(a1), Number(a2) || 3, a3);
    console.log('');
    console.log('⭐ 范围探针: ' + r.axis + ' 保持 ' + r.holdSec + ' 秒 -> 位移 ' + r.distance.toFixed(2) + ' m' + (r.stoppedEarly ? ('(前进 ' + r.progress.toFixed(2) + ' m 后停住, 之后沿边界再滑 ' + (r.distance - r.progress).toFixed(2) + ' m)') : '(未触边界)'));
    sock.close(); return;
  }
  if (cmd === 'rotate') {
    const r = await turnBy(Number(a1) || 45);
    console.log('');
    console.log('⭐ ' + (r.pass ? 'PASS' : 'FAIL') + ': ' + r.direction + '转 目标 ' + r.delta.toFixed(1) + '° / 实际 ' + r.actualDelta.toFixed(1) + '° / 误差 ' + r.error.toFixed(2) + '°(判线 ±' + r.tolerance.toFixed(1) + '°)');
    sock.close(); return;
  }
  if (cmd === 'move-to') {
    const r = await moveTo(Number(a1) || 0, Number(a2) || 0, Number(a3) || 0);
    console.log('');
    console.log('⭐ ' + (r.pass ? 'PASS' : 'FAIL') + ': 三维点到点 误差 ' + (r.errorNorm * 100).toFixed(1) + ' cm(判线 ±' + (r.tolerance * 100).toFixed(0) + ' cm)');
    sock.close(); return;
  }
  if (cmd === 'record') {
    await recordTrajectory(Number(a1) || 10, String(a2) === 'auto');
    sock.close(); return;
  }
  if (cmd === 'traj-info') {
    if (!a1) { console.log('用法: node scripts/dev/camera-calib.js traj-info <轨迹文件>'); sock.close(); return; }
    trajInfo(String(a1));
    sock.close(); return;
  }
  if (cmd === 'replay') {
    if (!a1) { console.log('用法: node scripts/dev/camera-calib.js replay <轨迹文件> [步长秒=1] [dry]'); sock.close(); return; }
    await replayTraj(String(a1), Number(a2) || 1.0, String(a3) === 'dry');
    sock.close(); return;
  }
  if (cmd === 'replay2') {
    if (!a1) { console.log('用法: node scripts/dev/camera-calib.js replay2 <轨迹文件> [倍速=1] [dry]'); sock.close(); return; }
    await replayContinuous(String(a1), Number(a2) || 1.0, String(a3) === 'dry');
    sock.close(); return;
  }
  if (cmd === 'replay2s') {
    if (!a1) { console.log('用法: node scripts/dev/camera-calib.js replay2s <轨迹文件> [倍速=1] [dry]'); sock.close(); return; }
    await replayContinuous(String(a1), Number(a2) || 1.0, String(a3) === 'dry', true);
    sock.close(); return;
  }
  if (cmd === 'replay-seg') {
    if (!a1) { console.log('用法: node scripts/dev/camera-calib.js replay-seg <轨迹文件> [段数=3] [倍速=1] [dry]'); sock.close(); return; }
    const drySeg = String(a4) === 'dry';
    const maxSegArg = (!drySeg && isFinite(Number(a4)) && a4 !== '') ? Number(a4) : null;
    await replaySegments(String(a1), Number(a2) || 3, Number(a3) || 1.0, maxSegArg, drySeg);
    sock.close(); return;
  }
  if (cmd === 'replay3') {
    if (!a1) { console.log('用法: node scripts/dev/camera-calib.js replay3 <轨迹文件> [倍速=1] [最长秒] [dry]'); sock.close(); return; }
    const dry3 = (String(a3) === 'dry' || String(a4) === 'dry');
    const maxSec3 = (a3 && String(a3) !== 'dry') ? Number(a3) : null;
    await replaySmooth(String(a1), Number(a2) || 1.0, maxSec3, dry3);
    sock.close(); return;
  }
  if (cmd === 'pose-listen') {
    const secs = Math.max(1, Math.min(120, Number(a1) || 10));
    lastPose = null; lastPoseAt = 0; poseT0 = 0; poseSamples.length = 0;
    console.log('监听 /usercamera/Pose 最多 ' + secs + ' 秒(127.0.0.1:' + POSE_PORT + '); 请在 VR 里动一下相机…');
    try {
      poseSock = await bindPose();
      const tEnd = Date.now() + secs * 1000;
      let lastPrint = 0;
      while (Date.now() < tEnd) {
        await sleep(200);
        if (lastPose && Date.now() - lastPrint > 500) {
          lastPrint = Date.now();
          console.log('  Pose pos=[' + lastPose.pos.map((x) => x.toFixed(2)).join(', ') + '] rot=[' + lastPose.rot.map((x) => x.toFixed(1)).join(', ') + '] 采样=' + poseSamples.length);
        }
      }
      console.log(lastPose ? ('结束: 共 ' + poseSamples.length + ' 条 Pose 采样') : '⚠️ 一条 Pose 都没收到(相机没动 / 不在世界里 / 端口不对)');
    } finally { if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; } }
    sock.close(); return;
  }
  if (cmd === 'move-forward' || cmd === 'move-left') {
    const axis = cmd === 'move-left' ? 'MoveLeft' : 'MoveForward';
    const r = await moveClosed(axis, Number(a1) || 1);
    console.log('');
    console.log('⭐ ' + (r.pass ? 'PASS' : 'FAIL') + ': ' + r.label + ' 目标 ' + r.target.toFixed(3) + ' m / 实际 ' + r.travelled.toFixed(3) + ' m / 误差 ' + (r.error * 100).toFixed(1) + ' cm(判线 ±' + (r.tolerance * 100).toFixed(0) + ' cm)');
    sock.close(); return;
  }
  if (cmd === 'selftest-move') {
    const ok = await selftestMove();
    sock.close();
    process.exitCode = ok ? 0 : 1;
    return;
  }
  console.log('未知命令: ' + cmd); sock.close();
})().catch(async e => { console.log('出错: ' + e.message); try { await zeroAll(); } catch (x) {} try { if (poseSock) poseSock.close(); } catch (x) {} sock.close(); });
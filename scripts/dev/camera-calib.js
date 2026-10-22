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
    let lastPos = start.slice();
    let lastMoveAt = Date.now();
    const t0 = Date.now();
    await axisSet(isFloat ? val : 1);
    while (Date.now() - t0 < secs * 1000) {
      await sleep(100);
      const p = lastPose.pos.slice();
      const el = Date.now() - t0;
      const d = dist3(p, lastPos);
      track.push({ ms: el, pos: p.map(round3) });
      if (d > 0.01) { lastPos = p.slice(); lastMoveAt = Date.now(); }
    }
    await axisSet(isFloat ? 0 : 0);
    await sleep(800);
    const end = lastPose.pos.slice();
    const vec = [round3(end[0] - start[0]), round3(end[1] - start[1]), round3(end[2] - start[2])];
    const total = round3(Math.hypot(vec[0], vec[1], vec[2]));
    const horiz = round3(Math.hypot(vec[0], vec[2]));
    const vert = round3(vec[1]);
    const plateauMs = Math.max(0, (t0 + secs * 1000) - lastMoveAt);
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
      yawStart: round3(yaw0), plateauMs: Math.round(plateauMs),
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
    console.log('      ' + (out.stoppedEarly ? ('⚠️ 后段停住 ' + (plateauMs / 1000).toFixed(2) + ' 秒不动 -> 已到范围边界或撞到物体') : '全程持续移动, 未触到边界'));
    if (out.file) console.log('      明细已存 ' + out.file);
    return out;
  } finally {
    try { await axisSet(isFloat ? 0 : 0); } catch (e) {}
    try { await zeroAll(); } catch (e) {}
    if (poseSock) { try { poseSock.close(); } catch (e) {} poseSock = null; }
  }
}

(async () => {
  const [cmd, a1, a2, a3] = process.argv.slice(2);
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
  if (cmd === 'zero') { await zeroAll(); console.log('所有输入轴已归零'); sock.close(); return; }
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
    console.log('⭐ 范围探针: ' + r.axis + ' 保持 ' + r.holdSec + ' 秒 -> 位移 ' + r.distance.toFixed(2) + ' m' + (r.stoppedEarly ? ('(后段 ' + (r.plateauMs / 1000).toFixed(2) + ' 秒未动)') : '(未触边界)'));
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
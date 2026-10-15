#!/usr/bin/env node
'use strict';
// 相机标定/实验小工具(开发用; scripts/dev 不进发布包)
// 用法: node scripts/dev/camera-calib.js <命令> [参数...]
//   probe                      列出 /usercamera 与 /dolly 的当前值
//   shot <标签>                拍一张(并打印最新照片名)
//   pulse <轴> <毫秒>          输入脉冲(MoveForward/LookRight/...), 结束一律归零
//   set <地址> <值>            给 /usercamera 或 /dolly 下的地址写值(true/false/数字)
//   fly <on|off>               飞行模式开关
//   speed <值>                 FlySpeed
//   turn <值>                  TurnSpeed
//   streaming <on|off>         直播相机(/usercamera/Streaming)
//   dolly-play [延迟秒]        触发运镜播放(默认 1 秒)
//   dolly-stop                 停止运镜
//   dolly-import <字符串>      试导入(语义未证实)
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
const getVal = p => new Promise(res => { const rq = http.get('http://127.0.0.1:' + PORT + p, { timeout: 4000 }, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d).VALUE); } catch (e) { res(null); } }); }); rq.on('error', () => res(undefined)); rq.on('timeout', () => { rq.destroy(); res(undefined); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AXES = ['MoveForward', 'MoveBackward', 'MoveLeft', 'MoveRight', 'LookLeft', 'LookRight'];
async function zeroAll() { for (const a of AXES) { await send('/input/' + a, [false]); await sleep(40); } }
const picRoot = path.join(os.homedir(), 'Pictures', 'VRChat');
function photos() { const out = []; (function w(d) { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (/\.png$/i.test(e.name)) out.push({ p, t: fs.statSync(p).mtimeMs, n: e.name }); } } catch (x) {} })(picRoot); return out.sort((a, b) => b.t - a.t); }
const USECAM = ['ShowUIInCamera','Flying','Lock','LocalPlayer','RemotePlayer','Environment','GreenScreen','SmoothMovement','LookAtMe','AutoLevelRoll','AutoLevelPitch','ShowFocus','Streaming','TriggerTakesPhotos','DollyPathsStayVisible','FlingToClose','AudioFromCamera','RollWhileFlying','OrientationIsLandscape','Zoom','Exposure','FocalDistance','Aperture','Hue','Saturation','Lightness','LookAtMeXOffset','LookAtMeYOffset','FlySpeed','TurnSpeed','SmoothingStrength','PhotoRate'];
(async () => {
  const [cmd, a1, a2] = process.argv.slice(2);
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
  if (map[cmd]) { await send(map[cmd], [parse(a1)]); await sleep(700); console.log(cmd + ' -> ' + JSON.stringify(await getVal(map[cmd]))); sock.close(); return; }
  if (cmd === 'set') { await send(a1, [parse(a2)]); await sleep(700); console.log(a1 + ' -> ' + JSON.stringify(await getVal(a1))); sock.close(); return; }
  if (cmd === 'dolly-play') { const d = Number(a1) || 1; await send('/dolly/PlayDelayed', [d]); await sleep(600); console.log('已发 PlayDelayed ' + d + ' -> Play=' + JSON.stringify(await getVal('/dolly/Play'))); sock.close(); return; }
  if (cmd === 'dolly-stop') { await send('/dolly/Play', [false]); await sleep(600); console.log('已停 -> Play=' + JSON.stringify(await getVal('/dolly/Play'))); sock.close(); return; }
  if (cmd === 'dolly-import') { await send('/dolly/Import', [String(a1)]); await sleep(900); console.log('已发 Import "' + a1 + '" -> Play=' + JSON.stringify(await getVal('/dolly/Play'))); sock.close(); return; }
  console.log('未知命令: ' + cmd); sock.close();
})().catch(async e => { console.log('出错: ' + e.message); try { await zeroAll(); } catch (x) {} sock.close(); });
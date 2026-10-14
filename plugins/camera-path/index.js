'use strict';
// 相机运镜控制(plugin id: camera-path)v0.1.0 —— 切片 1
//
// 本切片只做三件事(都是可测的):
//   ① OSC 发送(VRChat 的 /usercamera/* 与 /chatbox/input)
//   ② **包体自检** —— 2026-10-14 实测踩过: OSC 字符串漏了 NUL 结尾与 4 字节对齐, VRChat 直接忽略,
//      当时被我误判成"VRChat 不支持相机端点"。所以编码正确性在这里是**一等公民**: 每个包都过 audit()。
//   ③ 能力探测(端点是否可用)与降级: 不可用就如实报告, 不静默失败。
//
// 未做(后续切片): 运镜文件导入导出 / 三视图预览 / 预计时长 / 事件映射 / 第三方联动口。

const dgram = require('dgram');
const http = require('http');

// ---------- OSC 编码: 唯一正确实现, 被 audit() 与单测共同约束 ----------
function oscString(s) {
  const b = Buffer.from(String(s), 'utf8');
  const out = Buffer.alloc(Math.ceil((b.length + 1) / 4) * 4); // +1 是 NUL, 再补齐到 4 的倍数
  b.copy(out, 0);
  return out;
}
function oscMessage(address, args) {
  const list = Array.isArray(args) ? args : [];
  const tags = ',' + list.map(function (a) {
    if (typeof a === 'string') return 's';
    if (typeof a === 'boolean') return a ? 'T' : 'F';
    return 'f';
  }).join('');
  const parts = [oscString(address), oscString(tags)];
  list.forEach(function (a) {
    if (typeof a === 'string') parts.push(oscString(a));
    else if (typeof a === 'number') { const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b); }
    // 布尔不带参数(只用类型标签)
  });
  return Buffer.concat(parts);
}
// 包体自检: 任何一个 OSC 包都必须满足这些不变量, 否则发送端有 bug
function auditPacket(buf) {
  const problems = [];
  if (!Buffer.isBuffer(buf)) return ['不是 Buffer'];
  if (buf.length === 0) problems.push('空包');
  if (buf.length % 4 !== 0) problems.push('总长度不是 4 的倍数(' + buf.length + ')');
  const first = buf.indexOf(0);
  if (first < 0) problems.push('地址没有 NUL 结尾');
  else if (first === 0) problems.push('地址为空');
  return problems;
}

module.exports = function (ctx) {
  const cfg = (ctx && ctx.config) || {};
  const port = Number(cfg.oscPort) > 0 ? Number(cfg.oscPort) : 9000;
  const host = '127.0.0.1';
  const sock = dgram.createSocket('udp4');
  let sent = 0, failed = 0, lastError = '';
  const caps = { checked: false, camera: null, note: '' };

  function send(address, args) {
    const packet = oscMessage(address, args);
    const bad = auditPacket(packet);
    if (bad.length) {                       // 自检不过: 绝不发出去, 直接记账(正是 2026-10-14 的教训)
      failed++;
      lastError = '包体自检失败(' + address + '): ' + bad.join('; ');
      if (ctx && ctx.log) ctx.log('warn', lastError);
      return Promise.resolve(false);
    }
    return new Promise(function (resolve) {
      sock.send(packet, port, host, function (err) {
        if (err) { failed++; lastError = String(err.message || err); resolve(false); }
        else { sent++; resolve(true); }
      });
    });
  }

  // ---------- 运动原语(切片 3) ----------
  const AXES = ['MoveForward', 'MoveBackward', 'MoveLeft', 'MoveRight', 'LookLeft', 'LookRight'];
  let lastPulse = null;
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function getCap(path) {                      // 读 OSCQuery(能力查询); 拿不到就返回 null, 不抛
    return new Promise(function (resolve) {
      const ports = caps.queryPort ? [caps.queryPort] : [54420, 9001, 55719];
      let idx = 0;
      const tryOne = function () {
        if (idx >= ports.length) return resolve(null);
        const p = ports[idx++];
        const req = http.get('http://127.0.0.1:' + p + path, { timeout: 1500 }, function (res) {
          let d = ''; res.on('data', function (c) { d += c; });
          res.on('end', function () { try { caps.queryPort = p; resolve(JSON.parse(d).VALUE); } catch (e) { tryOne(); } });
        });
        req.on('error', function () { tryOne(); });
        req.on('timeout', function () { req.destroy(); tryOne(); });
      };
      tryOne();
    });
  }
  // ⚠️ 安全不变量: 任何脉冲都必须**保证归零** —— 用 try/finally, 否则一次异常会把某个轴卡在"按住"状态
  async function zeroAll() {
    for (const a of AXES) { await send('/input/' + a, [false]); await sleep(40); }
  }
  async function pulse(axis, ms) {
    const dur = Math.max(50, Math.min(20000, Number(ms) || 300));
    lastPulse = { axis: axis, ms: dur, at: Date.now() };
    let ok = false;
    try {
      ok = await send('/input/' + axis, [true]);
      await sleep(dur);
    } finally {
      await send('/input/' + axis, [false]);   // 无论成功失败都要松开
    }
    return ok;
  }

  // 能力探测: 相机端点是否被 VRChat 暴露(用 OSCQuery; 端口每次启动都变, 先探测再回退)
  function probe(queryPort) {
    return new Promise(function (resolve) {
      const req = http.get('http://127.0.0.1:' + queryPort + '/usercamera/Capture', { timeout: 2500 }, function (res) {
        let d = ''; res.on('data', function (c) { d += c; });
        res.on('end', function () {
          try { const j = JSON.parse(d); resolve(!!(j && j.FULL_PATH)); } catch (e) { resolve(false); }
        });
      });
      req.on('error', function () { resolve(false); });
      req.on('timeout', function () { req.destroy(); resolve(false); });
    });
  }

  return {
    apply: async function () {
      if (!cfg.probeOnApply) { caps.checked = false; caps.note = '已跳过探测(设置里关闭)'; return { ok: true, note: caps.note }; }
      for (const p of [54420, 9001, 55719]) {              // 常见候选; 生产版将改为从 VRChat 日志读取
        if (await probe(p)) { caps.checked = true; caps.camera = true; caps.note = 'OSCQuery 在 ' + p + ', 相机端点可用'; break; }
      }
      if (!caps.checked) { caps.camera = false; caps.note = '未发现可用的 OSCQuery(相机控制可能不可用); OSC 发送仍会尝试'; }
      if (ctx && ctx.log) ctx.log('info', '[camera-path] ' + caps.note);
      return { ok: true, note: caps.note };
    },
    dispose: function () { try { sock.close(); } catch (e) {} },

    api: {
      status: function () {
        return {
          ok: true,
          camera: caps.camera, note: caps.note,
          osc: { host: host, port: port, sent: sent, failed: failed, lastError: lastError },
          capabilities: ['Capture', 'CaptureDelayed', 'ShowUIInCamera', 'GreenScreen', 'LocalPlayer', 'RemotePlayer', 'Environment', 'LookAtMe', 'Zoom', 'Exposure', 'FlySpeed', 'TurnSpeed', 'SmoothingStrength', 'OrientationIsLandscape'],
          notSupported: ['相机位姿(Position/Rotation/Pose 无端点)', '驱动飞行相机移动(PC 模式需鼠标中键)'],
        };
      },
      // 给控制台/别的插件用: 拍一张(可选先隐藏 UI 图层)
      capture: async function (opts) {
        const hideUi = !opts || opts.hideUi !== false ? !!cfg.hideUiInPhoto : false;
        if (hideUi) await send('/usercamera/ShowUIInCamera', [false]);
        const ok = await send('/usercamera/Capture', []);
        if (hideUi) { await new Promise(function (r) { setTimeout(r, 1200); }); await send('/usercamera/ShowUIInCamera', [true]); }
        return { ok: ok, hidUi: hideUi };
      },
      send: send,
      _audit: auditPacket,   // 供单测直接使用
      _encode: oscMessage,

      // ===== 运动原语(切片 3)=====
      // ⚠️ 只在 **VR 模式** 下有效: 2026-10-14 实测 Flying=true 后
      //    /input/MoveForward 脉冲 2.5 秒 -> 画面差异 50%(PC 模式下同一实验仅 0.19%, 因为 PC 飞行要按住鼠标中键)。
      // ⚠️ 开环: 没有位姿反馈, 推多远/转到哪程序并不知道 —— 因此**只做短脉冲**, 并把每次动作都记进状态。
      motion: {
        moveForward: function (ms) { return pulse('MoveForward', ms); },
        moveBackward: function (ms) { return pulse('MoveBackward', ms); },
        moveLeft: function (ms) { return pulse('MoveLeft', ms); },
        moveRight: function (ms) { return pulse('MoveRight', ms); },
        lookLeft: function (ms) { return pulse('LookLeft', ms); },
        lookRight: function (ms) { return pulse('LookRight', ms); },
        setFlying: function (on) { return send('/usercamera/Flying', [!!on]); },
        setFlySpeed: function (v) { return send('/usercamera/FlySpeed', [Number(v) || 0.2]); },
        setTurnSpeed: function (v) { return send('/usercamera/TurnSpeed', [Number(v) || 1]); },
        stopAll: zeroAll,
        // 一个"推轨"组合: 开飞行 -> 设速度 -> 前进 -> 停 -> (可选)还原飞行
        dolly: async function (opts) {
          const o = opts || {};
          const ms = Math.max(50, Math.min(20000, Number(o.ms) || 800));
          const back = o.restoreFlying !== false;
          const wasFlying = String(await getCap('/usercamera/Flying')) === 'true';
          await send('/usercamera/Flying', [true]); await sleep(400);
          if (o.flySpeed) { await send('/usercamera/FlySpeed', [o.flySpeed]); await sleep(400); }
          const ok = await pulse('MoveForward', ms);
          if (o.lookMs) await pulse(o.lookLeft ? 'LookLeft' : 'LookRight', o.lookMs);
          if (back && !wasFlying) await send('/usercamera/Flying', [false]);
          return { ok: ok, ms: ms, drift: '开环: 位移未知, 会累积' };
        },
      },
      _lastPulse: function () { return lastPulse; },
    },
  };
};

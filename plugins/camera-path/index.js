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
    },
  };
};

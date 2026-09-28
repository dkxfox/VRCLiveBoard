'use strict';
// 动作播放器(F-20260929-01 路线 B): VMD 时间轴 -> 追踪点姿态 -> 60Hz OSC 发给 VMT(端口 39570)
// 端点选择: /VMT/Room/Unity(左手系 + 四元数 + 房间空间, VMT 官方标注 Recommended)
//   参数: (int)index, (int)enable, (float)timeoffset, (float)x,y,z, (float)qx,qy,qz,qw
// 安全: 停止 / 出错 / close 时, 必须给所有追踪点发 enable=0 —— 否则 VMT 里那些虚拟追踪器会**冻在最后一帧**。
const { solveFrame, fitScale } = require('./skeleton');

const FPS = 30;
const VMT_DEFAULT_PORT = 39570;
const TRACKER_COUNT = 11;

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) { bb = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) return [a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t];
  const th = Math.acos(Math.max(-1, Math.min(1, d)));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
}

class MocapPlayer {
  constructor(opts) {
    opts = opts || {};
    this.logger = opts.logger || { info: function () {}, warn: function () {} };
    this.osc = opts.osc || null;                       // 注入 src/osc.js 的发送器(测试里换假的)
    this.vmd = opts.vmd || null;
    this.host = opts.host || '127.0.0.1';
    this.port = Number(opts.port || VMT_DEFAULT_PORT);
    this.hz = Math.min(120, Math.max(10, Number(opts.hz || 60)));
    this.timeOffset = Number(opts.timeOffset || 0);
    this.playing = false; this.pausedAt = 0; this.startedAt = 0; this.timer = null;
    this.sent = 0; this.sentAt = 0; this.lastError = null;
    this._fit = null; this._origin = null;
    if (this.vmd) this.prepare();
  }
  prepare() {
    const v = this.vmd;
    if (!v || !v.frames || !v.frames.length) throw new Error('没有动作数据');
    const need = ['center', 'upper_body', 'head', 'wrist_L', 'wrist_R'];
    // 只用关键帧处采样来做归一化(够用; 也避免把整支动作全解一遍)
    const probe = [];
    const step = Math.max(1, Math.floor(v.byBone.get('head') ? v.byBone.get('head').length / 60 : 1));
    for (let i = 0; ; i++) {
      const f = i * step * 10;
      if (f > v.maxFrame) break;
      probe.push(this._solveAtFrameRaw(f));
      if (probe.length > 200) break;
    }
    this._fit = fitScale(probe);
    // 以第一帧的根位置做水平原点, 免得角色跑到别处去
    const first = this._solveAtFrameRaw(0);
    this._origin = [first[0].pos[0], 0, first[0].pos[2]];
    this.logger.info('[动作] 已准备: ' + v.durationSec.toFixed(1) + ' 秒 / ' + v.boneFrameCount + ' 关键帧 / 11 追踪点 / ' + this.hz + 'Hz -> ' + this.host + ':' + this.port);
  }
  _poseAtFrame(frame) {   // 每根骨头在给定帧的 {pos, rot}(相邻关键帧线性/球面插值)
    const pose = {};
    const self = this;
    this.vmd.byBone.forEach(function (arr, bone) {
      let k0 = arr[0], k1 = arr[arr.length - 1];
      for (let i = 0; i < arr.length - 1; i++) {
        if (arr[i].frame <= frame && arr[i + 1].frame >= frame) { k0 = arr[i]; k1 = arr[i + 1]; break; }
      }
      const span = (k1.frame - k0.frame) || 1;
      const t = Math.max(0, Math.min(1, (frame - k0.frame) / span));
      const pos = [k0.pos[0] + (k1.pos[0] - k0.pos[0]) * t, k0.pos[1] + (k1.pos[1] - k0.pos[1]) * t, k0.pos[2] + (k1.pos[2] - k0.pos[2]) * t];
      pose[bone] = { pos: pos, rot: slerp(k0.rot, k1.rot, t) };
    });
    return pose;
  }
  _solveAtFrameRaw(frame) { return solveFrame(this._poseAtFrame(frame)); }
  // 给定秒数 -> 11 个追踪点的**米制**姿态
  sampleAt(sec) {
    const frame = Math.max(0, Math.min(this.vmd.maxFrame, sec * FPS));
    const pts = this._solveAtFrameRaw(frame);
    const fit = this._fit, org = this._origin;
    return pts.map(function (p) {
      return {
        name: p.name,
        pos: [(p.pos[0] - org[0]) * fit.scale, (p.pos[1] - fit.floorY) * fit.scale, (p.pos[2] - org[2]) * fit.scale],
        rot: p.rot
      };
    });
  }
  _send(index, enable, pts) {
    if (!this.osc) return false;
    const p = pts ? pts[index] : null;
    const args = [
      { type: 'i', value: index },
      { type: 'i', value: enable ? 1 : 0 },
      { type: 'f', value: this.timeOffset }
    ];
    if (p) {
      args.push({ type: 'f', value: p.pos[0] }, { type: 'f', value: p.pos[1] }, { type: 'f', value: p.pos[2] });
      args.push({ type: 'f', value: p.rot[0] }, { type: 'f', value: p.rot[1] }, { type: 'f', value: p.rot[2] }, { type: 'f', value: p.rot[3] });
    }
    const ok = this.osc.send('/VMT/Room/Unity', args);
    if (ok !== false) { this.sent++; this.sentAt = Date.now(); }
    return ok !== false;
  }
  // 定住不动: 反复发同一个时刻的姿态(供 VRChat 校准全身追踪用), 不推进时间轴
  hold(sec) {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.holdAt = Number(sec || 0);
    this.holding = true;
    const self = this;
    const pts = this.sampleAt(this.holdAt);
    this.timer = setInterval(function () { for (let i = 0; i < TRACKER_COUNT; i++) self._send(i, true, pts); }, Math.round(1000 / this.hz));
    if (this.timer.unref) this.timer.unref();
    this.logger.info('[动作] 已定住(第 ' + this.holdAt + ' 秒的姿态), 追踪点静止 —— 可以去 VRChat 校准全身追踪');
    return { ok: true, holdAt: this.holdAt };
  }
  tick() {   // 一次发送(测试里可以直接调, 不必等定时器)
    const sec = this.timeOffset * 0 + ((Date.now() - this.startedAt) / 1000) + this.pausedAt;
    if (sec > this.vmd.durationSec) { this.stop('播放结束'); return false; }
    const pts = this.sampleAt(sec);
    this._lastPts = pts;
    for (let i = 0; i < TRACKER_COUNT; i++) this._send(i, true, pts);
    return true;
  }
  start() {
    if (this.playing) return { ok: true, note: '已在播放' };
    this.playing = true;
    this.startedAt = Date.now();
    const self = this;
    this.timer = setInterval(function () {
      try { if (!self.tick()) clearInterval(self.timer); }
      catch (e) { self.lastError = e.message; self.logger.warn('[动作] 发送出错: ' + e.message); self.stop('出错'); }
    }, Math.round(1000 / this.hz));
    if (this.timer.unref) this.timer.unref();   // 不阻塞进程退出
    this.logger.info('[动作] 开始播放(每帧发 ' + TRACKER_COUNT + ' 个追踪点)');
    return { ok: true };
  }
  stop(why) {
    const wasPlaying = this.playing;
    this.playing = false;
    this.holding = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.pausedAt = 0;
    // 停止时的处理(源码依据: enable 是**设备类型**, 1=Tracker, 0 是非法值):
    // 所以不再发 enable=0, 而是用最后一帧姿态 + enable=1 让追踪点**冻结在原位**, 然后停止发送。
    const last = this._lastPts || this.sampleAt(0);
    for (let i = 0; i < TRACKER_COUNT; i++) this._send(i, true, last);if (wasPlaying) this.logger.info('[动作] 已停止并关闭追踪点(' + (why || '手动') + ')');
    return { ok: true, sent: this.sent };
  }
  status() {
    return { playing: this.playing, sent: this.sent, hz: this.hz, port: this.port, durationSec: this.vmd ? this.vmd.durationSec : 0, trackers: TRACKER_COUNT, error: this.lastError };
  }
  close() { this.stop('关闭'); }
}
module.exports = { MocapPlayer: MocapPlayer, TRACKER_COUNT: TRACKER_COUNT, VMT_DEFAULT_PORT: VMT_DEFAULT_PORT };

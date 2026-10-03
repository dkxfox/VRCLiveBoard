'use strict';
// 动作播放服务(F-20260929-01 路线 B): 把 VMD 变成 VMT 虚拟追踪器姿态。
// 职责很窄: 列出可用动作 / 开始 / 停止 / 状态。 发送细节在 src/mocap/player.js。
// 安全: ① 只能播放 assets/motions 目录下的 .vmd(防路径穿越); ② 单实例(重复 start 会先停旧的);
//       ③ 帧率与端口做范围校验; ④ 停止时一定会给 11 个追踪点发 enable=0(否则虚拟追踪器冻住)。
const fs = require('fs');
const path = require('path');
const { parseVmd } = require('./vmd');
const { MocapPlayer, VMT_DEFAULT_PORT } = require('./player');
const { OscSender } = require('../osc');

const MOTION_DIR = path.join(__dirname, '..', '..', 'assets', 'motions');

class MocapService {
  constructor(opts) {
    opts = opts || {};
    this.logger = opts.logger || { info: function () {}, warn: function () {} };
    this.dir = opts.dir || MOTION_DIR;
    this.host = opts.host || '127.0.0.1';
    this.port = Number(opts.port || VMT_DEFAULT_PORT);
    this.hz = Number(opts.hz || 60);
    this.player = null;
    this.osc = null;
    this.current = null;
    this.lastError = null;
    this.startedAt = 0;
  }
  listFiles() {
    const dir = this.dir;   // 必须在回调外捕获: 回调里的 this 不是实例(踩过: path.join(undefined, f) 抛错被内层 catch 吞掉 -> 列表全 0)
    try {
      return fs.readdirSync(dir).filter(function (f) { return /\.vmd$/i.test(f); }).map(function (f) {
        let size = 0, durationSec = 0, bones = 0, frames = 0;
        try {
          const full = path.join(dir, f);
          size = fs.statSync(full).size;
          const v = parseVmd(fs.readFileSync(full));
          durationSec = v.durationSec; bones = v.boneCount; frames = v.boneFrameCount;
        } catch (e) { /* 坏文件就在列表里显示 0, 不影响其它动作 */ }
        return { file: f, size: size, durationSec: durationSec, bones: bones, keyframes: frames };
      }).sort(function (a, b) { return a.file.localeCompare(b.file); });
    } catch (e) { return []; }
  }
  // 只接受目录内的文件名(防路径穿越: 不许出现分隔符/上级引用)
  resolve(file) {
    const name = String(file || '').trim();
    if (!name || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf('..') >= 0) return null;
    if (!/\.vmd$/i.test(name)) return null;
    const full = path.join(this.dir, name);
    if (path.dirname(path.resolve(full)) !== path.resolve(this.dir)) return null;
    if (!fs.existsSync(full)) return null;
    return full;
  }
  status() {
    const st = this.player ? this.player.status() : null;
    return {
      ok: true,
      playing: !!(st && st.playing),
      current: this.current,
      sent: st ? st.sent : 0,
      durationSec: st ? st.durationSec : 0,
      trackers: st ? st.trackers : 11,
      hz: this.hz,
      host: this.host,
      port: this.port,
      files: this.listFiles(),
      error: this.lastError
    };
  }
  async start(file, opts) {
    opts = opts || {};
    this.stop('切换动作');
    const full = this.resolve(file);
    if (!full) { this.lastError = '动作文件不合法或不存在(只能选 assets/motions 下的 .vmd)'; return { ok: false, error: this.lastError }; }
    const port = Number(opts.port || this.port);
    if (!Number.isFinite(port) || port < 1 || port > 65535) { this.lastError = '端口不合法'; return { ok: false, error: this.lastError }; }
    const hz = Number(opts.hz || this.hz);
    if (!Number.isFinite(hz) || hz < 10 || hz > 120) { this.lastError = '帧率不合法(10~120)'; return { ok: false, error: this.lastError }; }
    try {
      const vmd = parseVmd(fs.readFileSync(full));
      const osc = new OscSender({ host: this.host, port: port });
      await osc.open();
      this.osc = osc;
      this.player = new MocapPlayer({ vmd: vmd, osc: osc, host: this.host, port: port, hz: hz, logger: this.logger });
      this.current = path.basename(full);
      this.port = port; this.hz = hz;
      this.startedAt = Date.now();
      this.lastError = null;
      this.player.start();
      return { ok: true, file: this.current, durationSec: vmd.durationSec, port: port, hz: hz, trackers: 11 };
    } catch (e) {
      this.lastError = e.message;
      this.logger.warn('[动作] 启动失败: ' + e.message);
      this.stop('启动失败');
      return { ok: false, error: e.message };
    }
  }
  // 定住不动(校准全身追踪用): 没有播放器时先起一个(用第一个可用动作), 然后让追踪点静止。
  async hold(sec, file) {
    try {
      if (!this.player) {
        const list = this.listFiles();
        const pick = file || (list[0] && list[0].file);
        if (!pick) return { ok: false, error: "没有可用动作文件" };
        const r = await this.start(pick, {});
        if (!r.ok) return r;
      }
      this.player.hold(Number(sec || 0));
      return { ok: true, holdAt: Number(sec || 0), file: this.current };
    } catch (e) { this.lastError = e.message; return { ok: false, error: e.message }; }
  }
  stop(why) {
    let stopped = false;
    if (this.player) { try { this.player.stop(why || '手动停止'); stopped = true; } catch (e) {} this.player = null; }
    if (this.osc) { try { this.osc.close(); } catch (e) {} this.osc = null; }
    this.current = null;
    return { ok: true, stopped: stopped };
  }
}

module.exports = { MocapService: MocapService, MOTION_DIR: MOTION_DIR };

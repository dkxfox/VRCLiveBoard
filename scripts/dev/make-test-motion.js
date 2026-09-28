'use strict';
// 生成一支**自制的测试动作**(F-20260929-01 路线 B 用): 2 分钟, 标准 MMD 骨骼, 音乐节拍感。
// 为什么自己做而不是下载: MMD 圈的动作**绝大多数禁止 MMD 以外用途/禁止 VRChat/禁止再配布**,
//   我们的插件绝不能内置动作素材; 自制的这支完全免许可, 足够验证"解析 -> 时间轴 -> OSC 流"。
// 用法: node scripts/dev/make-test-motion.js [输出路径] [秒数]
const fs = require('fs');
const path = require('path');
const { buildVmd, FPS } = require(path.join(process.cwd(), 'src', 'mocap', 'vmd.js'));

const out = process.argv[2] || path.join(process.cwd(), 'assets', 'motions', 'test-dance.vmd');
const seconds = Number(process.argv[3] || 120);
const BPM = 120;                      // 每秒 2 拍
const KEYSTEP = 6;                    // 每 6 帧一个关键帧(0.2 秒) —— 接近真实动作的关键帧密度
const totalFrames = seconds * FPS;

// 标准 MMD 骨骼名(用 ASCII 写, 解析器两种都能读); 每个骨骼给出"随节拍运动"的函数
const defs = {
  center:      function (b) { return { pos: [0, 8 + Math.sin(b * Math.PI / 2) * 0.6, Math.sin(b * Math.PI) * 3], rot: [0, Math.sin(b * Math.PI / 2) * 0.25, 0, 1] }; },
  upper_body:  function (b) { return { pos: [0, 0, 0], rot: [Math.sin(b * Math.PI) * 0.15, 0, Math.sin(b * Math.PI / 2) * 0.2, 1] }; },
  upper_body2: function (b) { return { pos: [0, 0, 0], rot: [Math.sin(b * Math.PI + 1) * 0.12, 0, 0, 1] }; },
  neck:        function (b) { return { pos: [0, 0, 0], rot: [Math.sin(b * Math.PI) * 0.08, 0, 0, 1] }; },
  head:        function (b) { return { pos: [0, 0, 0], rot: [Math.sin(b * Math.PI) * 0.12, Math.sin(b * Math.PI / 2) * 0.2, 0, 1] }; },
  shoulder_L:  function (b) { return { pos: [0, 0, 0], rot: [0, 0, Math.sin(b * Math.PI) * 0.15, 1] }; },
  shoulder_R:  function (b) { return { pos: [0, 0, 0], rot: [0, 0, -Math.sin(b * Math.PI) * 0.15, 1] }; },
  arm_L:       function (b) { return { pos: [0, 0, 0], rot: [0, 0, Math.sin(b * Math.PI) * 1.1, 1] }; },
  arm_R:       function (b) { return { pos: [0, 0, 0], rot: [0, 0, -Math.sin(b * Math.PI) * 1.1, 1] }; },
  elbow_L:     function (b) { return { pos: [0, 0, 0], rot: [0, Math.abs(Math.sin(b * Math.PI)) * 0.9, 0, 1] }; },
  elbow_R:     function (b) { return { pos: [0, 0, 0], rot: [0, -Math.abs(Math.sin(b * Math.PI)) * 0.9, 0, 1] }; },
  wrist_L:     function (b) { return { pos: [0, 0, 0], rot: [0, 0, Math.sin(b * Math.PI / 2) * 0.3, 1] }; },
  wrist_R:     function (b) { return { pos: [0, 0, 0], rot: [0, 0, -Math.sin(b * Math.PI / 2) * 0.3, 1] }; },
  lower_body:  function (b) { return { pos: [0, 0, 0], rot: [0, Math.sin(b * Math.PI) * 0.18, 0, 1] }; },
  leg_L:       function (b) { return { pos: [0, 0, 0], rot: [Math.max(0, Math.sin(b * Math.PI)) * 0.5, 0, 0, 1] }; },
  leg_R:       function (b) { return { pos: [0, 0, 0], rot: [Math.max(0, -Math.sin(b * Math.PI)) * 0.5, 0, 0, 1] }; },
  knee_L:      function (b) { return { pos: [0, 0, 0], rot: [Math.max(0, Math.sin(b * Math.PI)) * 0.7, 0, 0, 1] }; },
  knee_R:      function (b) { return { pos: [0, 0, 0], rot: [Math.max(0, -Math.sin(b * Math.PI)) * 0.7, 0, 0, 1] }; },
  ankle_L:     function (b) { return { pos: [0, 0, 0], rot: [0, 0, 0, 1] }; },
  ankle_R:     function (b) { return { pos: [0, 0, 0], rot: [0, 0, 0, 1] }; }
};

const kf = [];
for (let f = 0; f <= totalFrames; f += KEYSTEP) {
  const b = (f / FPS) * (BPM / 60);              // 第几拍
  Object.keys(defs).forEach(function (bone) {
    const v = defs[bone](b);
    kf.push({ bone: bone, frame: f, pos: v.pos, rot: v.rot });
  });
}
const buf = buildVmd('vrcb-test-dance', kf);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log('已生成: ' + out);
console.log('  时长 ' + seconds + ' 秒 / ' + totalFrames + ' 帧 / 骨骼 ' + Object.keys(defs).length + ' 根 / 关键帧 ' + kf.length + ' 条 / ' + Math.round(buf.length / 1024) + 'KB');

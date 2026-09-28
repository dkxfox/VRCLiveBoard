'use strict';
// 骨骼 -> 追踪点姿态映射(F-20260929-01 路线 B, 2026-09-29)
// 目标: 把 VMD 的骨骼关键帧, 变成 VMT 需要的**11 个追踪点**姿态(位置 + 四元数)。
// 两个必须写明的近似(不然会以为是 bug):
//   ① VMD **只有骨骼关键帧, 没有骨骼长度/层级** —— 那些在 PMX 模型里。这里用**标准 MMD 骨架比例**近似;
//   ② 为了让近似不失控, 最后做了**自动归一化**: 按"头顶到脚底 ≈ 1.55m"缩放, 并把最低脚底平移到 y=0(地面)。
// 坐标系: MMD 是**左手系 + Y 向上**(和 Unity 一样), 而 VMT 的 /VMT/Room/Unity 正是"Unity like Left-handed"
//   -> **不需要做轴向转换**(这也是选这个端点的原因)。
const MMD_UNITS_PER_METER_GUESS = 1 / 0.08;   // 仅用于初值; 实际由自动归一化定标

// 追踪点定义: name -> { parent, offset(相对父骨骼的静息偏移, 单位: MMD 单位) }
// 偏移量是标准 MMD 骨架的近似值; 顺序即输出顺序(0..10), 与 VMT 管理器里的 index 对应由用户指定。
const POINTS = [
  { name: 'hip',        parent: 'center',      offset: [0, 0, 0] },
  { name: 'chest',      parent: 'upper_body',  offset: [0, 0, 0] },
  { name: 'head',       parent: 'head',        offset: [0, 0, 0] },
  { name: 'hand_L',     parent: 'wrist_L',     offset: [0, 0, 0] },
  { name: 'hand_R',     parent: 'wrist_R',     offset: [0, 0, 0] },
  { name: 'elbow_L',    parent: 'elbow_L',     offset: [0, 0, 0] },
  { name: 'elbow_R',    parent: 'elbow_R',     offset: [0, 0, 0] },
  { name: 'knee_L',     parent: 'knee_L',      offset: [0, 0, 0] },
  { name: 'knee_R',     parent: 'knee_R',      offset: [0, 0, 0] },
  { name: 'foot_L',     parent: 'ankle_L',     offset: [0, 0, 0] },
  { name: 'foot_R',     parent: 'ankle_R',     offset: [0, 0, 0] }
];

// 骨骼层级 + 静息偏移(近似标准 MMD 骨架; 名字同时接受日文与 ASCII)
const BONES = {
  center:      { parent: null,         offset: [0, 0, 0] },
  upper_body:  { parent: 'center',     offset: [0, 2.0, 0] },
  upper_body2: { parent: 'upper_body', offset: [0, 2.0, 0] },
  neck:        { parent: 'upper_body2',offset: [0, 3.0, 0] },
  head:        { parent: 'neck',       offset: [0, 2.0, 0] },
  shoulder_L:  { parent: 'upper_body2',offset: [1.2, 2.6, 0] },
  shoulder_R:  { parent: 'upper_body2',offset: [-1.2, 2.6, 0] },
  arm_L:       { parent: 'shoulder_L', offset: [1.0, 0, 0] },
  arm_R:       { parent: 'shoulder_R', offset: [-1.0, 0, 0] },
  elbow_L:     { parent: 'arm_L',      offset: [3.8, 0, 0] },
  elbow_R:     { parent: 'arm_R',      offset: [-3.8, 0, 0] },
  wrist_L:     { parent: 'elbow_L',    offset: [2.8, 0, 0] },
  wrist_R:     { parent: 'elbow_R',    offset: [-2.8, 0, 0] },
  lower_body:  { parent: 'center',     offset: [0, -0.8, 0] },
  leg_L:       { parent: 'lower_body', offset: [0.9, -2.0, 0] },
  leg_R:       { parent: 'lower_body', offset: [-0.9, -2.0, 0] },
  knee_L:      { parent: 'leg_L',      offset: [0, -4.6, 0] },
  knee_R:      { parent: 'leg_R',      offset: [0, -4.6, 0] },
  ankle_L:     { parent: 'knee_L',     offset: [0, -4.4, 0] },
  ankle_R:     { parent: 'knee_R',     offset: [0, -4.4, 0] }
};

// 日文骨骼名 -> 内部名(真实 VMD 里是这些)
const JP = {
  'センター': 'center', '上半身': 'upper_body', '上半身2': 'upper_body2', '首': 'neck', '頭': 'head',
  '左肩': 'shoulder_L', '右肩': 'shoulder_R', '左腕': 'arm_L', '右腕': 'arm_R',
  '左ひじ': 'elbow_L', '右ひじ': 'elbow_R', '左手首': 'wrist_L', '右手首': 'wrist_R',
  '下半身': 'lower_body', '左足': 'leg_L', '右足': 'leg_R', '左ひざ': 'knee_L', '右ひざ': 'knee_R',
  '左足首': 'ankle_L', '右足首': 'ankle_R'
};

function normalizeBoneName(n) {
  if (!n) return n;
  if (BONES[n]) return n;
  if (JP[n]) return JP[n];
  return n;
}

function qMul(a, b) {   // a*b (四元数, [x,y,z,w])
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
function qRot(q, v) {   // 用四元数旋转向量
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x
  ];
}
function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function qNorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

// 给定某一帧各骨骼的 {pos, rot}, 做一次正向运动学 -> 每个追踪点的世界位置与朝向(MMD 单位)
function solveFrame(pose) {
  const world = {};   // bone -> { pos, rot }
  const order = ['center', 'upper_body', 'upper_body2', 'neck', 'head', 'shoulder_L', 'arm_L', 'elbow_L', 'wrist_L',
    'shoulder_R', 'arm_R', 'elbow_R', 'wrist_R', 'lower_body', 'leg_L', 'knee_L', 'ankle_L', 'leg_R', 'knee_R', 'ankle_R'];
  order.forEach(function (b) {
    const def = BONES[b];
    const local = pose[b] || { pos: [0, 0, 0], rot: [0, 0, 0, 1] };
    const parent = def.parent ? world[def.parent] : null;
    const rest = def.offset;
    let pos, rot;
    if (!parent) {
      pos = [local.pos[0] + rest[0], local.pos[1] + rest[1], local.pos[2] + rest[2]];
      rot = qNorm(local.rot);
    } else {
      const rotatedRest = qRot(parent.rot, rest);
      pos = vAdd(vAdd(parent.pos, rotatedRest), local.pos);
      rot = qNorm(qMul(parent.rot, local.rot));
    }
    world[b] = { pos: pos, rot: rot };
  });
  return POINTS.map(function (p) {
    const w = world[p.parent] || { pos: [0, 0, 0], rot: [0, 0, 0, 1] };
    const off = qRot(w.rot, p.offset);
    return { name: p.name, pos: vAdd(w.pos, off), rot: w.rot };
  });
}

// 自动归一化: 按"头顶到最低脚底 ≈ 1.55m"缩放 + 把最低脚底平移到 y=0
function fitScale(framesMmD) {
  let minY = Infinity, maxY = -Infinity;
  framesMmD.forEach(function (pts) {
    pts.forEach(function (p) {
      if (p.name === 'head' || p.name === 'foot_L' || p.name === 'foot_R') {
        if (p.pos[1] < minY) minY = p.pos[1];
        if (p.pos[1] > maxY) maxY = p.pos[1];
      }
    });
  });
  const spanUnits = Math.max(1e-6, maxY - minY);
  const scale = 1.55 / spanUnits;
  return { scale: scale, floorY: minY };
}

module.exports = { POINTS: POINTS, BONES: BONES, JP: JP, solveFrame: solveFrame, fitScale: fitScale, normalizeBoneName: normalizeBoneName };

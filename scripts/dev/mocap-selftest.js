const dgram = require('dgram');
const path = require('path');
const osc = require(path.join(process.cwd(), 'node_modules', 'osc'));
const { buildVmd, parseVmd } = require(path.join(process.cwd(), 'src', 'mocap', 'vmd.js'));
const { MocapPlayer } = require(path.join(process.cwd(), 'src', 'mocap', 'player.js'));

const PORT = 39571;                                // 测试用监听口(不去碰 VMT 的 39570)
const got = [];                                    // 抓到的包(这才是"抓包证据")
const sock = dgram.createSocket('udp4');
let fails = 0;
function ok(c, m) { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; }

// 造一支 20 秒的动作(测试用, 快)
const kf = [];
const bones = ['center', 'upper_body', 'upper_body2', 'neck', 'head', 'shoulder_L', 'arm_L', 'elbow_L', 'wrist_L',
  'shoulder_R', 'arm_R', 'elbow_R', 'wrist_R', 'lower_body', 'leg_L', 'knee_L', 'ankle_L', 'leg_R', 'knee_R', 'ankle_R'];
for (let f = 0; f <= 600; f += 6) {
  const b = (f / 30) * 2;
  bones.forEach(function (bn) {
    kf.push({ bone: bn, frame: f, pos: bn === 'center' ? [0, 8, 0] : [0, 0, 0], rot: [Math.sin(b * Math.PI) * 0.3, Math.sin(b * Math.PI / 2) * 0.2, Math.sin(b * Math.PI) * 0.4, 1] });
  });
}
const vmd = parseVmd(buildVmd('selftest-dance', kf));
const fakeOsc = { send: function (addr, args) { return true; } };

sock.on('message', function (msg) {
  try { got.push(osc.readPacket(msg, { metadata: true })); } catch (e) { got.push({ parseError: e.message }); }
});
sock.bind(PORT, '127.0.0.1', function () {
  const realOsc = {
    send: function (addr, args) {
      const buf = osc.writePacket({ address: addr, args: args }, { metadata: true });
      sock.send(buf, 0, buf.length, PORT, '127.0.0.1');
      return true;
    }
  };
  const p = new MocapPlayer({ vmd: vmd, osc: realOsc, port: PORT, hz: 60, logger: { info: function () {}, warn: function (m) { console.log('  [warn] ' + m); } } });
  console.log('  动作: ' + vmd.durationSec.toFixed(2) + ' 秒 / 关键帧 ' + vmd.boneFrameCount + ' / 追踪点 11 / 60Hz');
  p.start();
  setTimeout(function () {
    const during = got.length;
    console.log('  1 秒内抓到 ' + during + ' 个包(期望约 11×60=660)');
    ok(during > 400 && during < 900, '发送频率合理: ' + during + ' 包/秒');
    const addrs = new Set(got.map(function (g) { return g.address; }));
    ok(addrs.size === 1 && addrs.has('/VMT/Room/Unity'), '地址正确: ' + Array.from(addrs).join(','));
    const idx = new Set();
    let full = 0, posBad = 0, qBad = 0;
    got.forEach(function (g) {
      if (!g.args || g.args.length < 3) return;
      const i = g.args[0].value, en = g.args[1].value;
      if (en === 1) idx.add(i);
      if (g.args.length === 10) {
        full++;
        const x = g.args[3].value, y = g.args[4].value, z = g.args[5].value;
        if (!isFinite(x) || !isFinite(y) || !isFinite(z) || Math.abs(x) > 3 || Math.abs(z) > 3 || y < -0.3 || y > 3) posBad++;
        const q = [g.args[6].value, g.args[7].value, g.args[8].value, g.args[9].value];
        const n = Math.hypot(q[0], q[1], q[2], q[3]);
        if (!isFinite(n) || Math.abs(n - 1) > 0.05) qBad++;
      }
    });
    ok(idx.size === 11, '11 个追踪点都被启用过: ' + idx.size);
    ok(full === during, '启用包都带完整姿态(10 个参数): ' + full + '/' + during);
    ok(posBad === 0, '位置数值都在合理范围(米): 异常 ' + posBad);
    ok(qBad === 0, '四元数都是单位长度: 异常 ' + qBad);
    got.length = 0;
    p.stop('测试');
    setTimeout(function () {
      const dis = got.filter(function (g) { return g.args && g.args[1] && g.args[1].value === 0; });
      ok(dis.length === 11, '停止时给 11 个追踪点都发了 enable=0: ' + dis.length);
      // 顺带: 单帧采样一次, 看头顶是否高于脚底(常识校验)
      const s = p.sampleAt(1.0);
      const head = s.find(function (x) { return x.name === 'head'; });
      const foot = s.find(function (x) { return x.name === 'foot_L'; });
      ok(head && foot && head.pos[1] > foot.pos[1], '姿态常识: 头顶 y=' + head.pos[1].toFixed(2) + 'm > 脚底 y=' + foot.pos[1].toFixed(2) + 'm');
      console.log(fails ? ('== ' + fails + ' 项失败 ==') : '== 全部通过 ==');
      sock.close();
      process.exit(fails ? 1 : 0);
    }, 300);
  }, 1000);
});
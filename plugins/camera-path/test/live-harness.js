'use strict';
// camera-path 真机验收夹具(连 VRChat, 会真的导入/播放运镜; 仅开发用, 不随包)
// 用法:
//   node plugins/camera-path/test/live-harness.js list
//   node plugins/camera-path/test/live-harness.js play <文件名或索引> [延迟秒]
//   node plugins/camera-path/test/live-harness.js status|stop|test|zero
const path = require('path');
const factory = require(path.join(__dirname, '..', 'index.js'));
const inst = factory({
  config: { oscPort: 9000, oscQueryPort: 0, delaySec: 0, autoStopSec: 0, maxKeyframesPerSegment: 6, stopRestoresLock: true, hideUiInPhoto: false },
  log: function (lvl, msg) { console.log('[plugin ' + lvl + '] ' + msg); },
});
const api = inst.api;
(async function () {
  const cmd = process.argv[2] || 'status';
  try {
    if (cmd === 'list') {
      const r = await api.listPresets({});
      if (!r.ok) { console.log('listPresets FAIL', r.error); process.exitCode = 1; return; }
      console.log('dir:', r.dir, '| maxKF:', r.maxKeyframesPerSegment, '| count:', r.presets.length);
      r.presets.forEach(function (p, i) { console.log('  #' + i + ' ' + p.file + ' | ' + (p.isLocal ? 'LOCAL' : 'WORLD') + ' | pts=' + p.points + ' segs=' + p.segments + ' maxSeg=' + p.maxSegment + (p.needsSplit ? ' NEEDS_SPLIT' : '') + (p.ok ? '' : ' BAD:' + p.error)); });
    } else if (cmd === 'play') {
      const arg = process.argv[3] || '';
      const delay = Number(process.argv[4]) || 0;
      const args = /^\d+$/.test(arg) ? { index: Number(arg), delaySec: delay } : { file: arg, delaySec: delay };
      const r = await api.playPreset(args);
      console.log('playPreset:', JSON.stringify(r));
      if (!r || !r.ok) process.exitCode = 1;
      // 不 dispose(保留播放), 但必须显式退出: 插件 UDP socket 会保持进程存活
      await new Promise(function (res) { setTimeout(res, 200); });
      process.exit(r && r.ok ? 0 : 1);
    } else if (cmd === 'status') {
      console.log('status:', JSON.stringify(await api.status({}), null, 1));
    } else if (cmd === 'stop') {
      console.log('stop:', JSON.stringify(await api.stop({})));
    } else if (cmd === 'test') {
      console.log('test:', JSON.stringify(await api.test({})));
    } else if (cmd === 'zero') {
      console.log('zero:', JSON.stringify(await api.zeroAll({})));
    } else { console.log('未知命令'); process.exitCode = 2; }
  } catch (e) { console.log('ERR', e && e.message); process.exitCode = 1; }
  // play 命令不 dispose(否则会 stop 播放); 其它命令清理
  if (cmd !== 'play') { try { await inst.dispose(); } catch (e) {} }
})();

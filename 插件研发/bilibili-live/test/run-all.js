'use strict';
// 插件全部离线单测的总入口: node test/run-all.js
// 用子进程逐个跑 —— 每个测试自带 PASS/FAIL 计数与退出码, 这里只汇总(子进程输出原样透传, 免得互相盖掉)。
const { spawnSync } = require('child_process');
const path = require('path');
const FILES = ['frame.test.js', 'policy.test.js', 'official.test.js', 'events.test.js', 'session.test.js'];
let failed = 0;
for (const f of FILES) {
  console.log('== ' + f);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', f)], { encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) { failed += 1; console.log('   ^^ 子进程异常: 退出码 ' + r.status + (r.error ? ' / ' + r.error.message : '') + (r.signal ? ' / signal ' + r.signal : '')); }
}
console.log(failed ? ('== 有 ' + failed + ' 个测试文件失败 ==') : '== 全部 ' + FILES.length + ' 个测试文件通过 ==');
process.exitCode = failed ? 1 : 0;

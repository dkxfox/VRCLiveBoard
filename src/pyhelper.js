'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

// 解析可用的 Python(用于 SMTC 媒体助手):
// 1) 系统 python 且 winsdk 可用 -> python
// 2) 便携 .pydist/python.exe 且 winsdk 可用 -> 便携路径
// 3) 都没有 -> null(媒体功能降级, 控制台环境卡提示安装)
function resolvePython(projectRoot) {
  const candidates = ['python', path.join(projectRoot, '.pydist', 'python.exe')];
  for (const c of candidates) {
    try {
      const out = execFileSync(c, ['-c', 'import winsdk; print("ok")'], { timeout: 20000, windowsHide: true, encoding: 'utf8' });
      if (String(out).indexOf('ok') >= 0) return c;
    } catch (e) { /* 下一个 */ }
  }
  return null;
}
module.exports = { resolvePython };

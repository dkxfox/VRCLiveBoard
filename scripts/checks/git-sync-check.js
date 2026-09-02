'use strict';
// G-SYNC 同步门禁: 工作区必须干净且与 origin/main 一致
//   坑源: 上传副本改了、项目根没回写造成双向漂移(条目 84)
const { execFileSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const allowDirty = process.argv.includes('--allow-dirty');
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();

let fail = 0;
try {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = git(['status', '--porcelain']).split('\n').filter((x) => x.trim());
  const modified = dirty.filter((l) => !l.startsWith('??'));
  const untracked = dirty.filter((l) => l.startsWith('??'));
  let ahead = '?', behind = '?';
  try {
    git(['fetch', 'origin', branch, '--quiet']);
    const counts = git(['rev-list', '--left-right', '--count', 'origin/' + branch + '...' + branch]).split(/\s+/);
    behind = counts[0]; ahead = counts[1];
  } catch (e) { console.log('  WARN 无法访问 origin: ' + String(e.message).split('\n')[0]); }

  console.log('[G-SYNC git-sync-check] 分支 ' + branch + ' | 未提交 ' + modified.length + ' | 未跟踪 ' + untracked.length + ' | ahead ' + ahead + ' / behind ' + behind);
  for (const l of dirty.slice(0, 12)) console.log('    ' + l);
  if (modified.length && !allowDirty) { console.log('  FAIL 有未提交改动(收尾前必须提交)'); fail++; }
  if (untracked.length) { console.log('  FAIL 有未跟踪文件(要么提交, 要么写进 .gitignore —— 不许悬着)'); fail++; }
  if (ahead !== '0' && ahead !== '?') { console.log('  FAIL 本地领先 origin ' + ahead + ' 个提交(未推送)'); fail++; }
  if (behind !== '0' && behind !== '?') { console.log('  FAIL 本地落后 origin ' + behind + ' 个提交(先拉取)'); fail++; }
  if (!fail) console.log('  PASS 工作区干净且与 origin 完全一致');
} catch (e) {
  console.log('  FAIL git 检查失败: ' + String(e.message).split('\n')[0]);
  fail++;
}
process.exit(fail ? 1 : 0);

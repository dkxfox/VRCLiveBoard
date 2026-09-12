'use strict';
// G-VER 版本一致性门禁: 发版时"四处版本号"必须完全一致
//   坑源: 使用说明/版本说明/README/package.json 分散在四个文件, 靠人记必漏(条目 61/82)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/^\uFEFF/, '');

const pkg = JSON.parse(read('package.json')).version;
const rows = [];
function grab(label, file, re, all) {
  let txt;
  try { txt = read(file); } catch (e) { rows.push([label, file, null, 'READ FAIL: ' + e.message]); return; }
  const ms = [...txt.matchAll(re)];
  if (!ms.length) { rows.push([label, file, null, '未找到版本标记(正则: ' + re + ')']); return; }
  const seen = all ? [...new Set(ms.map((m) => m[1]))] : [ms[0][1]];
  for (const v of seen) rows.push([label, file, v, v === pkg ? 'OK' : '不一致(应为 ' + pkg + ')']);
}

grab('version.json', 'version.json', /"version"\s*:\s*"([0-9]+\.[0-9]+\.[0-9]+)"/g);
grab('使用说明标题', '使用说明.txt', /使用说明书\(v([0-9]+\.[0-9]+\.[0-9]+)/g);
grab('使用说明页脚', '使用说明.txt', /版本:\s*v([0-9]+\.[0-9]+\.[0-9]+)/g);
grab('版本说明标题', '版本说明.txt', /版本说明\(当前:\s*v([0-9]+\.[0-9]+\.[0-9]+)/g);
grab('版本说明首节', '版本说明.txt', /^v([0-9]+\.[0-9]+\.[0-9]+)/gm);
grab('README 当前版本', 'README.md', /当前版本[::]\s*v([0-9]+\.[0-9]+\.[0-9]+)/g);
grab('README 下载文件名', 'README.md', /VRCLiveBoard-[A-Za-z-]+-v([0-9]+\.[0-9]+\.[0-9]+)\.zip/g, true);

// 代号一致性(M-20260911-52): 启动横幅曾把代号写死在 src/main.js, 换代号后日志仍报旧名(1.4.0 实测才发现)。
// 规则: 横幅代号必须从 version.json 读, main.js 里不得出现任何硬编码代号。
let _cnRow = null;
try {
  const mainJs = read('src/main.js');
  const vj = JSON.parse(read('version.json'));
  // 只看代码: 注释里提到旧代号是正常的(本轮就被自己的注释坑过一次) —— 去掉行注释再扫
  const code = mainJs.split('\n').map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');
  const names = [...new Set(['星光', '集市', String(vj.codename || '')].filter(Boolean))];
  const hard = names.filter((n) => code.includes(n));
  if (hard.length) _cnRow = ['启动横幅代号', 'src/main.js', hard.join('/'), '硬编码了代号(应从 version.json 读)'];
  else if (!mainJs.includes('version.json')) _cnRow = ['启动横幅代号', 'src/main.js', null, '横幅没有从 version.json 读代号'];
  else _cnRow = ['启动横幅代号', 'src/main.js', String(vj.codename || ''), 'OK'];
} catch (e) { _cnRow = ['启动横幅代号', 'src/main.js', null, 'CHECK FAIL: ' + e.message]; }
rows.push(_cnRow);

const bad = rows.filter((r) => r[3] !== 'OK');
if (process.argv.includes('--json')) console.log(JSON.stringify({ package: pkg, rows }, null, 2));
else {
  console.log('[G-VER version-sync] package.json = ' + pkg);
  for (const [label, file, v, st] of rows) console.log('  ' + (st === 'OK' ? 'OK  ' : 'FAIL') + ' ' + label.padEnd(16) + (v || '-') + '  (' + file + ')' + (st === 'OK' ? '' : ' <- ' + st));
}
process.exit(bad.length ? 1 : 0);

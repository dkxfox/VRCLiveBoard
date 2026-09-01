'use strict';
// 依赖自愈: package.json 依赖变化时自动 npm install
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const need = JSON.stringify(pkg.dependencies || {});
let have = '';
try { have = fs.readFileSync(path.join(root, 'node_modules', '.install-stamp'), 'utf8'); } catch (e) {}

if (have === need) { process.exit(0); }

console.log('依赖有更新,正在安装...');
const env = Object.assign({}, process.env, { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' });
let r = spawnSync('npm install --omit=dev --no-audit --no-fund', { cwd: root, stdio: 'inherit', shell: true, env: env });
if (r.status !== 0) {
  console.log('常规安装未成功,改用忽略脚本模式重试...');
  r = spawnSync('npm install --omit=dev --no-audit --no-fund --ignore-scripts', { cwd: root, stdio: 'inherit', shell: true, env: env });
}
if (r.status !== 0) { console.error('依赖安装失败,请检查网络后重试'); process.exit(1); }
try { fs.writeFileSync(path.join(root, 'node_modules', '.install-stamp'), need); } catch (e) {}
console.log('依赖就绪');

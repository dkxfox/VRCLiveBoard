'use strict';
// 确定性安装 Electron 二进制: 从 npmmirror 下载 zip → PowerShell 解压 → 写 path.txt
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ver = (pkg.dependencies && pkg.dependencies.electron) || '43.4.0';
const distDir = path.join(root, 'node_modules', 'electron', 'dist');
const exePath = path.join(distDir, 'electron.exe');

if (fs.existsSync(exePath)) { console.log('Electron 二进制已就绪'); process.exit(0); }

const mirror = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
const url = mirror + 'v' + ver + '/electron-v' + ver + '-win32-x64.zip';
const zipPath = process.env.VRCB_ELECTRON_ZIP || path.join(root, '.electron-cache', 'electron-v' + ver + '-win32-x64.zip');

(async function () {
  if (!fs.existsSync(zipPath)) {
    console.log('下载 Electron ' + ver + ' ...');
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) { console.error('下载失败: HTTP ' + r.status + ' ' + url); process.exit(1); }
    const total = Number(r.headers.get('content-length') || 0);
    let got = 0;
    const out = fs.createWriteStream(zipPath);
    const reader = r.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      out.write(Buffer.from(value));
      if (got % 20971520 < 65536) console.log('  ' + (got / 1048576).toFixed(0) + 'MB' + (total ? '/' + (total / 1048576).toFixed(0) + 'MB' : ''));
    }
    await new Promise(function (res, rej) { out.end(res); out.on('error', rej); });
    console.log('下载完成');
  } else { console.log('使用本地缓存 zip: ' + zipPath); }

  fs.mkdirSync(distDir, { recursive: true });
  const ps1 = "$ErrorActionPreference='Stop'; Expand-Archive -Path '" + zipPath + "' -DestinationPath '" + distDir + "' -Force";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps1], { stdio: 'inherit', timeout: 300000 });
  if (r.status !== 0 || !fs.existsSync(exePath)) { console.error('解压失败'); process.exit(1); }
  fs.writeFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), 'electron.exe');
  console.log('Electron 就绪: ' + exePath);
})().catch(function (e) { console.error('安装失败: ' + e.message); process.exit(1); });

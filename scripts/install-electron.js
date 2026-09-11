'use strict';
// 确定性安装 Electron 二进制: 从 npmmirror 下载 zip → PowerShell 解压 → 写 path.txt
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

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
    // 国内优先 npmmirror(快), 失败再回退官方 release(适合有代理的用户) —— 2026-09-11 审计 M4 + 国内可用性
    const mirrors = [mirror, 'https://github.com/electron/electron/releases/download/'];
    let r = null, lastErr = '';
    for (const m of mirrors) {
      try {
        const u = m + 'v' + ver + '/electron-v' + ver + '-win32-x64.zip';
        const rr = await fetch(u, { redirect: 'follow' });
        if (rr.ok) { r = rr; break; }
        lastErr = 'HTTP ' + rr.status + ' ' + u;
      } catch (e) { lastErr = e.message; }
    }
    if (!r) { console.error('下载失败: ' + lastErr); process.exit(1); }
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

  // 完整性校验(2026-09-11 审计 M4): 镜像公布 SHASUMS256.txt 就严格比对(不一致直接中止);
  // 该镜像没提供时给出明确警告后继续 —— 校验是为了防投毒, 但不能因为镜像少个文件就让国内用户装不上。
  try {
    const sr = await fetch(mirror + 'v' + ver + '/SHASUMS256.txt', { redirect: 'follow' });
    if (sr.ok) {
      const want = (String(await sr.text()).split('\n').find((l) => l.trim().endsWith('electron-v' + ver + '-win32-x64.zip')) || '').trim().split(/\s+/)[0];
      const got = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
      if (!want) console.log('警告: SHASUMS256.txt 中没有本文件条目, 跳过完整性校验');
      else if (want.toLowerCase() !== got) {
        console.error('完整性校验失败: zip 的 SHA256 与镜像公布值不一致, 已中止安装(镜像被篡改或下载损坏)');
        console.error('  期望 ' + want);
        console.error('  实际 ' + got);
        process.exit(1);
      } else console.log('完整性校验通过(SHA256 与镜像公布值一致)');
    } else console.log('警告: 该镜像未提供 SHASUMS256.txt, 跳过完整性校验(不影响使用)');
  } catch (e) { console.log('警告: 完整性校验无法完成(' + e.message + '), 继续安装'); }

  fs.mkdirSync(distDir, { recursive: true });
  const ps1 = "$ErrorActionPreference='Stop'; Expand-Archive -Path '" + zipPath + "' -DestinationPath '" + distDir + "' -Force";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps1], { stdio: 'inherit', timeout: 300000 });
  if (r.status !== 0 || !fs.existsSync(exePath)) { console.error('解压失败'); process.exit(1); }
  fs.writeFileSync(path.join(root, 'node_modules', 'electron', 'path.txt'), 'electron.exe');
  console.log('Electron 就绪: ' + exePath);
})().catch(function (e) { console.error('安装失败: ' + e.message); process.exit(1); });

'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// 便携 Python 一键安装: 下载官方 embeddable 包 -> 解压到 .pydist -> 启用 site -> 装 winsdk
// 目标用户无需访问官网/管理员权限; 全部数据约 20MB, 位于程序目录内。
const PY_VER = '3.12.10';
const PY_DIR = '.pydist';

function pyRoot(projectRoot) { return path.join(projectRoot, PY_DIR); }
function pyExe(projectRoot) { return path.join(pyRoot(projectRoot), 'python.exe'); }

function existsPython(projectRoot) {
  try { return fs.existsSync(pyExe(projectRoot)); } catch (e) { return false; }
}

function run(cmd, args, timeoutMs) {
  return new Promise(function (resolve) {
    let out = '';
    try {
      const child = execFile(cmd, args, { timeout: timeoutMs || 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, function (err, stdout, stderr) {
        resolve({ code: err ? (err.code || 1) : 0, out: String(stdout || ''), err: String(stderr || '') });
      });
      child.stdout.on('data', function (d) { out += String(d); });
    } catch (e) { resolve({ code: 1, err: String(e.message) }); }
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise(async function (resolve, reject) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(600000) });
      if (!r.ok) return reject(new Error('下载失败 HTTP ' + r.status));
      const total = Number(r.headers.get('content-length') || 0);
      let got = 0;
      const out = fs.createWriteStream(dest);
      const reader = r.body.getReader();
      let lastPct = -1;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        out.write(Buffer.from(value));
        if (onProgress && total) {
          const pct = Math.round(got * 100 / total);
          if (pct !== lastPct) { lastPct = pct; onProgress('下载中 ' + pct + '%'); }
        }
      }
      await new Promise(function (res, rej) { out.end(res); out.on('error', rej); });
      resolve();
    } catch (e) { reject(e); }
  });
}

async function installPortablePython(projectRoot, logger, onProgress) {
  const report = function (msg) { if (logger) logger.info('[pypy] ' + msg); if (onProgress) onProgress(msg); };
  try {
    report('开始安装便携 Python ' + PY_VER + ' ...');
    const dir = pyRoot(projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(dir, 'python-embed.zip');
    if (!fs.existsSync(pyExe(projectRoot))) {
      report('下载官方便携包(约 11MB)...');
      const url = 'https://www.python.org/ftp/python/' + PY_VER + '/python-' + PY_VER + '-embed-amd64.zip';
      await downloadFile(url, zipPath, function (p) { report('下载中 ' + p + '%'); });
      report('解压...');
      const r = await run('tar', ['-xf', zipPath, '-C', dir], 180000);
      if (r.code !== 0) throw new Error('解压失败: ' + (r.err || r.out).slice(0, 200));
    }
    // 启用 site 以便安装第三方包
    const pth = path.join(dir, 'python312._pth');
    if (fs.existsSync(pth)) {
      const content = fs.readFileSync(pth, 'utf8').replace(/\r/g, '');
      const lines = content.split('\n').map(function (l) { return l.replace(/^#\s*/, '').trim(); }).filter(Boolean);
      if (lines.indexOf('Lib\\site-packages') < 0) lines.splice(1, 0, 'Lib\\site-packages');
      if (lines.indexOf('import site') < 0) lines.push('import site');
      fs.writeFileSync(pth, lines.join('\r\n') + '\r\n');
    }
    // 安装 pip(需要网络)
    report('安装 pip...');
    const gp = path.join(dir, 'get-pip.py');
    if (!fs.existsSync(gp)) {
      await downloadFile('https://bootstrap.pypa.io/get-pip.py', gp, null);
    }
    let r = await run(pyExe(projectRoot), [gp, '--no-warn-script-location'], 300000);
    if (r.code !== 0) { report('pip 安装异常(继续尝试 winsdk): ' + (r.err || r.out).slice(0, 150)); }
    // 安装 winsdk
    report('安装 winsdk(媒体功能依赖)...');
    r = await run(pyExe(projectRoot), ['-m', 'pip', 'install', 'winsdk', '--no-input'], 600000);
    if (r.code !== 0) throw new Error('winsdk 安装失败: ' + (r.err || r.out).slice(0, 300));
    // 验证
    r = await run(pyExe(projectRoot), ['-c', 'import winsdk; print("winsdk-ok")'], 30000);
    if (r.code !== 0 || r.out.indexOf('winsdk-ok') < 0) throw new Error('winsdk 验证失败');
    report('便携 Python 安装完成: ' + pyExe(projectRoot));
    return { ok: true, exe: pyExe(projectRoot) };
  } catch (e) {
    report('安装失败: ' + e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { installPortablePython, existsPython, pyExe };

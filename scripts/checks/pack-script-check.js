'use strict';
// 打包脚本自身健康检查(M-20260911-37, 审计 H1)
// make-dist.ps1 是"什么能出厂"的唯一执行者: 它一旦丢 UTF-8 BOM, PS5.1 会按 GBK 读, 中文排除项
// (秘密开发*/旧版控制台/测试素材)会静默失效, 而脚本仍会打印 integrity OK。所以在发布审计第 0a 步先查它自己。
// 用法: node scripts/checks/pack-script-check.js   (退出码 0=通过)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(ROOT, 'scripts', 'make-dist.ps1');
let fail = 0;
function ok(cond, msg) { if (cond) console.log('  OK   ' + msg); else { console.log('  FAIL ' + msg); fail++; } }

if (!fs.existsSync(FILE)) { console.log('  FAIL 找不到 ' + FILE); process.exit(1); }
const buf = fs.readFileSync(FILE);
const hasBom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
ok(hasBom, 'make-dist.ps1 带 UTF-8 BOM(PS5.1 才能正确读中文排除项)');

// PS5.1 只解析不执行: 语法错误 = 脚本跑不起来(或被人"删掉报错的中文条目"止血)
let parseOk = false, detail = '';
try {
  const cmd = "$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('" +
    FILE.replace(/'/g, "''") + "',[ref]$t,[ref]$e); if(@($e).Count -gt 0){ Write-Output ('ERR:' + @($e).Count + ':' + $e[0].Message); exit 1 } else { Write-Output 'PARSE-OK'; exit 0 }";
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  parseOk = String(out).indexOf('PARSE-OK') >= 0;
  detail = String(out).trim();
} catch (e) { detail = String((e.stdout || '') + (e.stderr || e.message)).trim(); }
ok(parseOk, 'make-dist.ps1 能被 Windows PowerShell 5.1 解析' + (parseOk ? '' : ' — ' + detail.slice(0, 160)));

console.log('  [pack-script-check] ' + (fail ? (fail + ' 项未通过') : 'make-dist.ps1 健康'));
process.exit(fail ? 1 : 0);

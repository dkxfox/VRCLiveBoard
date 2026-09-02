'use strict';
// G2 编码门禁: 项目里所有"编码相关"事故的机器化复检
//   坑源: 启动.bat 中文被压成 ???(条目 81)、make-dist 双 BOM 解析错(66)、
//         PS 无 BOM 被按 GBK 读导致中文路径找不到(85)、zip 内 GBK 文件名(67)
// 规则:
//   *.bat  : 不得有 BOM; 必须 CRLF; 含中文时必须是 GBK(即"按 UTF-8 解码能得到中文"= 违规)
//   *.ps1  : 含非 ASCII 时必须恰好一个 UTF-8 BOM(单 BOM)
//   *.js/*.json/*.mjs/*.cjs : 不得有 BOM, 必须是合法 UTF-8; json 必须能 parse
//   其它文本: 必须是合法 UTF-8(.bat 除外)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'logs', '.git', '.electron-cache', '.pydist', '.ocr-langs', '.ocr-cache', 'vendor', '.userdata']);
const TEXT_EXT = new Set(['.bat', '.ps1', '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.py', '.html', '.css', '.cs']);

function hasBom(b) { return b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF; }
function doubleBom(b) { return hasBom(b) && b.length >= 6 && b[3] === 0xEF && b[4] === 0xBB && b[5] === 0xBF; }
function isValidUtf8(b) { return Buffer.compare(Buffer.from(b.toString('utf8'), 'utf8'), b) === 0; }
function hasCjk(s) { return /[\u4e00-\u9fff\u3040-\u30ff]/.test(s); }

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || /测试|截图/.test(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function check(file) {
  const bad = [];
  const rel = path.relative(ROOT, file);
  const b = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  if (b.length === 0) return bad;

  if (ext === '.bat') {
    if (hasBom(b)) bad.push([rel, 'bat 不得带 BOM(cmd 会把 BOM 当命令)']);
    const txt = b.toString('latin1');
    if (txt.indexOf('\n') >= 0 && !/\r\n/.test(txt)) bad.push([rel, 'bat 必须是 CRLF 换行']);
    if (isValidUtf8(b) && hasCjk(b.toString('utf8'))) bad.push([rel, 'bat 含 UTF-8 中文 -> 必须改存 GBK(代码页 936), 否则中文变乱码']);
  } else if (ext === '.ps1') {
    const nonAscii = b.some((x) => x > 127);
    if (doubleBom(b)) bad.push([rel, '双 BOM(第二个 BOM 会顶掉首行, PS5.1 解析错)']);
    else if (nonAscii && !hasBom(b)) bad.push([rel, '含非 ASCII 但缺 UTF-8 BOM -> PS5.1 会按 GBK 读, 中文路径/字符串必炸']);
    if (hasBom(b) && !isValidUtf8(b.subarray(3))) bad.push([rel, '声明了 BOM 却不是合法 UTF-8']);
  } else {
    if (hasBom(b) && (ext === '.js' || ext === '.mjs' || ext === '.cjs' || ext === '.json')) bad.push([rel, ext + ' 不得带 BOM']);
    const body = hasBom(b) ? b.subarray(3) : b;
    if (!isValidUtf8(body)) bad.push([rel, '不是合法 UTF-8(可能被按 GBK 保存过)']);
    if (ext === '.json') {
      try { JSON.parse(body.toString('utf8')); } catch (e) { bad.push([rel, 'JSON 解析失败: ' + e.message]); }
    }
  }
  return bad;
}

const files = walk(ROOT, []);
const violations = [];
for (const f of files) violations.push(...check(f));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scanned: files.length, violations }, null, 2));
} else {
  console.log('[G2 encoding-lint] 扫描 ' + files.length + ' 个文本文件');
  if (violations.length === 0) console.log('  PASS: 0 violation');
  else for (const [f, why] of violations) console.log('  FAIL ' + f + ' -> ' + why);
}
process.exit(violations.length ? 1 : 0);

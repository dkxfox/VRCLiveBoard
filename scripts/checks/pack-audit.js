'use strict';
// G-PACK 发布包完整性/机密门禁: 直接审计打好的 zip(所见即所发)
//   坑源: config.json.bak 随包外流(条目 85)、zip 内 GBK 文件名(67)、包内旧盐(87)
// 用法: node scripts/checks/pack-audit.js <zip> [<zip> ...]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const FORBIDDEN_NAME = [/\.bak$/i, /^config\.json\.bak$/i, /继续开发命令\.txt$/, /dev-unlocker/i, /加密狗/, /发布公告/, /\.ocr-tmp\.png$/, /master\.key$/, /master-pass/i, /授权登记表/];
const REQUIRED = ['package.json', 'config.json', '使用说明.txt', 'README.md', 'src/main.js', 'src/web/server.js', 'src/web/public/index.html', '启动.bat', '启动桌面版.bat'];
// 真实凭据特征: 所有文本条目都扫
const SECRET_RE = [/sk-[a-zA-Z0-9]{16,}/, /SESSDATA=[0-9a-fA-F]{8}/, /ghp_[A-Za-z0-9]{20,}/, /gho_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/];
// 私有配置字段: 只在 .json 里算违规(文档里讨论字段名是正常的, 不能误杀 DEV-NOTES)
const SECRET_RE_JSON = [/"(devchain|level1Password)"\s*:/, /"anchor"\s*:\s*"[0-9a-f]{16}"/];
const TEXT_EXT = new Set(['.json', '.txt', '.js', '.md', '.ps1', '.bat', '.cfg', '.html', '.py']);

function readZip(zp) {
  const b = fs.readFileSync(zp);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 70000; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('EOCD 未找到(不是合法 zip?)');
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) break;
    const flags = b.readUInt16LE(off + 8);
    const method = b.readUInt16LE(off + 10);
    const cSize = b.readUInt32LE(off + 20);
    const uSize = b.readUInt32LE(off + 24);
    const nameLen = b.readUInt16LE(off + 28), extraLen = b.readUInt16LE(off + 30), cmtLen = b.readUInt16LE(off + 32);
    const lho = b.readUInt32LE(off + 42);
    const raw = b.subarray(off + 46, off + 46 + nameLen);
    entries.push({ raw, name: raw.toString('utf8'), flags, method, cSize, uSize, lho });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return { buf: b, entries };
}
function readEntry(z, e) {
  const b = z.buf;
  if (b.readUInt32LE(e.lho) !== 0x04034b50) throw new Error('local header 异常: ' + e.name);
  const nameLen = b.readUInt16LE(e.lho + 26), extraLen = b.readUInt16LE(e.lho + 28);
  const start = e.lho + 30 + nameLen + extraLen;
  const data = b.subarray(start, start + e.cSize);
  return e.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
}

function audit(zp) {
  const label = path.basename(zp);
  const fails = [], warns = [];
  const z = readZip(zp);
  const names = z.entries.map((e) => e.name);

  // 1. 文件名层
  let nonAscii = 0, noFlag = 0, badUtf8 = 0, backslash = 0;
  for (const e of z.entries) {
    if (Buffer.compare(Buffer.from(e.name, 'utf8'), e.raw) !== 0) badUtf8++;
    if (e.raw.some((x) => x > 127)) { nonAscii++; if (!(e.flags & 0x800)) noFlag++; }
    if (e.name.includes('\\')) backslash++;
  }
  if (noFlag) fails.push('有 ' + noFlag + ' 个非 ASCII 名缺 UTF-8 标志(非中文系统解压会报损坏)');
  if (badUtf8) fails.push('有 ' + badUtf8 + ' 个文件名不是合法 UTF-8');
  if (backslash) fails.push('有 ' + backslash + ' 个条目名含反斜杠(违反 zip 规范)');

  // 2. 禁入名单
  for (const n of names) for (const re of FORBIDDEN_NAME) if (re.test(n)) fails.push('禁入文件混入: ' + n);

  // 3. 必备文件
  for (const r of REQUIRED) if (!names.includes(r)) fails.push('缺少必备文件: ' + r);

  // 4. config.json 脱敏
  const cfgEntry = z.entries.find((e) => e.name === 'config.json');
  if (cfgEntry) {
    const cfg = readEntry(z, cfgEntry).toString('utf8');
    if (/sk-[a-zA-Z0-9]{16,}/.test(cfg)) fails.push('config.json 含真实 API key');
    if (/"devchain"/.test(cfg)) fails.push('config.json 含 devchain 锚点');
    if (/"level1Password"/.test(cfg)) fails.push('config.json 含一级密码');
  }

  // 4b. 官方插件恢复备份: 打包必须为 plugins\ 下每个插件生成 官方可选插件\<id>\ 副本(用户误删可拷回)
  const officialDirs = fs.readdirSync(path.join(ROOT, 'plugins'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const id of officialDirs) {
    if (!names.includes('plugins/' + id + '/manifest.json')) fails.push('包内缺少插件本体: plugins/' + id);
    if (!names.includes('官方可选插件/' + id + '/manifest.json')) fails.push('包内缺少误删恢复备份: 官方可选插件/' + id);
  }
  if (!names.includes('官方可选插件/说明-如何装回插件.txt')) fails.push('包内缺少 官方可选插件/说明-如何装回插件.txt');

  // 5. 盐一致性: 包内 devgate 必须与当前源码同盐(否则授权版必然解锁失败)
  const dgEntry = z.entries.find((e) => e.name === 'src/devgate.js');
  if (dgEntry) {
    const zipSalt = (readEntry(z, dgEntry).toString('utf8').match(/const SALT = '([^']+)'/) || [])[1];
    const srcSalt = (fs.readFileSync(path.join(ROOT, 'src', 'devgate.js'), 'utf8').match(/const SALT = '([^']+)'/) || [])[1];
    if (zipSalt !== srcSalt) fails.push('包内 devgate 盐(' + zipSalt + ')与当前源码盐(' + srcSalt + ')不一致');
  }

  // 6. 版本一致性
  const pkgEntry = z.entries.find((e) => e.name === 'package.json');
  if (pkgEntry) {
    const zipVer = JSON.parse(readEntry(z, pkgEntry).toString('utf8')).version;
    const srcVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    if (zipVer !== srcVer) warns.push('包内版本 ' + zipVer + ' 与源码 ' + srcVer + ' 不同(旧包?)');
    if (!path.basename(zp).includes('v' + zipVer)) warns.push('文件名版本与包内 package.json(' + zipVer + ')不符');
  }

  // 7. 全量机密扫描(跳过 node_modules 与大文件)
  let scanned = 0;
  for (const e of z.entries) {
    if (e.name.startsWith('node_modules/') || e.uSize > 2 * 1024 * 1024 || e.name.endsWith('/')) continue;
    if (!TEXT_EXT.has(path.extname(e.name).toLowerCase())) continue;
    let txt;
    try { txt = readEntry(z, e).toString('utf8'); } catch (err) { warns.push('无法解压 ' + e.name + ': ' + err.message); continue; }
    scanned++;
    for (const re of SECRET_RE) if (re.test(txt)) fails.push('机密特征命中: ' + e.name + ' (' + re + ')');
    if (path.extname(e.name).toLowerCase() === '.json') {
      for (const re of SECRET_RE_JSON) if (re.test(txt)) fails.push('私有配置字段出现在 json: ' + e.name + ' (' + re + ')');
    }
  }

  console.log('[G-PACK] ' + label);
  console.log('  条目 ' + z.entries.length + ' | 非ASCII名 ' + nonAscii + ' | 缺UTF8标志 ' + noFlag + ' | 非法UTF8 ' + badUtf8 + ' | 反斜杠 ' + backslash + ' | 机密扫描 ' + scanned + ' 个文本条目');
  for (const w of warns) console.log('  WARN ' + w);
  for (const f of fails) console.log('  FAIL ' + f);
  if (!fails.length) console.log('  PASS');
  return fails.length;
}

const zips = process.argv.slice(2);
if (!zips.length) { console.log('用法: node scripts/checks/pack-audit.js <zip> [<zip> ...]'); process.exit(2); }
let bad = 0;
for (const z of zips) { try { bad += audit(z); } catch (e) { console.log('[G-PACK] ' + path.basename(z) + '  FAIL ' + e.message); bad++; } }
process.exit(bad ? 1 : 0);

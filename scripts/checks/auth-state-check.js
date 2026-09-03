'use strict';
// G-AUTH 授权体系状态检查(流程 3 的 3A 检查项; 只对开发者机有意义 —— dev-dongle 缺省时自动跳过)
// 用法: node scripts/checks/auth-state-check.js
// 红线(2026-09-02 凭据投影规则): 只输出投影信息(姓名/状态/次数/布尔/盐前缀), 永不打印一级密码、母狗口令、锚点值。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const MASTER = path.join(ROOT, 'dev-dongle', 'master');
let fails = 0, warns = 0;
const ok = (s) => console.log('  OK   ' + s);
const warn = (s) => { console.log('  WARN ' + s); warns++; };
const bad = (s) => { console.log('  FAIL ' + s); fails++; };

console.log('[G-AUTH auth-state-check]');
if (!fs.existsSync(MASTER)) { console.log('  跳过(非开发者机: dev-dongle/master 不存在)'); console.log('  PASS'); process.exit(0); }

// 1. 盐一致(devgate 与母狗必须逐字一致, 否则授权版必然解锁失败)
try {
  const devgate = fs.readFileSync(path.join(ROOT, 'src', 'devgate.js'), 'utf8');
  const master = fs.readFileSync(path.join(MASTER, 'master.js'), 'utf8');
  const saltA = (devgate.match(/const SALT = '([^']+)'/) || [])[1];
  const saltB = (master.match(/const CHAIN_SALT = '([^']+)'/) || [])[1];
  if (saltA && saltB && saltA === saltB) ok('链盐一致: ' + saltA.slice(0, 12) + '...');
  else bad('链盐不一致: devgate=' + (saltA || '?') + ' master=' + (saltB || '?'));
} catch (e) { bad('盐检查失败: ' + e.message); }

// 2. 母狗密钥对
const keyF = path.join(MASTER, 'master.key');
const passF = path.join(MASTER, 'master-pass.txt');
if (fs.existsSync(keyF) && fs.existsSync(passF)) ok('母狗密钥对在(master.key + master-pass.txt)');
else bad('母狗密钥缺失: master.key / master-pass.txt(见 DEV-NOTES 条目 37/86)');

// 3. 工作区 config.json 锚点状态
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const dc = cfg.devchain;
  if (dc) {
    const rem = Number(dc.remaining);
    const anchorOk = /^[0-9a-f]{16}$/i.test(String(dc.anchor || ''));
    if (anchorOk && Number.isFinite(rem) && rem >= 0 && rem <= 999) ok('开发者本机已装锚点: 剩余 ' + rem + ' 次; 一级密码: ' + (cfg.level1Password ? '已回填(' + String(cfg.level1Password).length + '位)' : '缺失'));
    else bad('config.json devchain 字段异常: remaining=' + dc.remaining + ' anchor格式=' + anchorOk);
  } else {
    warn('开发者本机未装锚点(零级状态; 需要时: node dev-dongle/master/master.js register 开发者 --config config.json)');
  }
} catch (e) { bad('config.json 读取失败: ' + e.message); }

// 4. 登记表(用母狗自带的 vendor xlsx; 只投影姓名与行数, 不打印口令)
const xlsxPath = path.join(MASTER, 'vendor', 'xlsx.js');
const regPath = path.join(MASTER, '授权登记表.xlsx');
if (!fs.existsSync(regPath)) warn('授权登记表.xlsx 不存在');
else if (!fs.existsSync(xlsxPath)) warn('母狗 vendor xlsx 缺失, 跳过登记表检查');
else {
  try {
    const XLSX = require(xlsxPath);
    const wb = XLSX.readFile(regPath);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const data = rows.slice(1).filter((r) => r && String(r[0] || '').trim());
    ok('登记表: 表头 + ' + data.length + ' 行' + (data.length ? '(' + data.map((r) => String(r[0])).join(' / ') + ')' : '(空白待重新登记)'));
  } catch (e) { bad('登记表读取失败: ' + e.message); }
}

// 5. mini-template 三件套
const tpl = path.join(MASTER, 'mini-template');
for (const f of ['mini-unlock.ps1', '启动迷你狗.bat', '加密狗安全声明.txt']) {
  if (fs.existsSync(path.join(tpl, f))) ok('mini-template: ' + f);
  else bad('mini-template 缺 ' + f);
}

// 6. 母狗备份与开发者申请版(只报状态)
const bak = path.join(MASTER, 'backup');
const bakN = fs.existsSync(bak) ? fs.readdirSync(bak).length : 0;
if (bakN) warn('母狗 backup 目录有 ' + bakN + ' 个备份(正常; 备份含明文口令, 勿上传勿进包)'); else ok('母狗 backup 目录为空');
const applyDir = path.join(ROOT, 'dist', '开发者申请版');
if (fs.existsSync(applyDir)) {
  const items = fs.readdirSync(applyDir).map((n) => n.replace(/-v\d[\d.]*/g, '-v<版本>'));
  if (items.length === 1 && items[0] === '申请说明.txt') ok('dist/开发者申请版 只有 申请说明.txt(授权包待重新生成)');
  else warn('dist/开发者申请版 内容: ' + items.join(' / '));
}

console.log('  ---- ' + (fails ? fails + ' FAIL' : '0 FAIL') + ' / ' + warns + ' WARN ----');
if (fails) { console.log('  FAIL'); process.exit(1); }
console.log('  PASS'); process.exit(0);

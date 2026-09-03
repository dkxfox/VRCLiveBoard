'use strict';
// GPLUG 插件门禁: 单一源 + manifest 契约 + 更新包版本一致
//   规则来源(用户拍板 2026-09-01): plugins\ 是唯一源; 官方可选插件\ 只是"打包时生成的误删恢复备份",
//   仓库里不得存在第二份插件代码(历史上双副本导致每次改动要手工同步两处, 见 DEV-NOTES 72/73/76)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const PLUGINS = path.join(ROOT, 'plugins');
const OPTIONAL = path.join(ROOT, '官方可选插件');
const SUPPORTED_API = ['2.0.0'];

let fail = 0, warn = 0;
const say = (ok, msg) => { console.log('  ' + (ok === 'FAIL' ? 'FAIL' : ok === 'WARN' ? 'WARN' : 'OK  ') + ' ' + msg); if (ok === 'FAIL') fail++; if (ok === 'WARN') warn++; };

// 1. 单一源
const stray = fs.existsSync(OPTIONAL) ? fs.readdirSync(OPTIONAL, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
if (stray.length) say('FAIL', '官方可选插件\\ 里存在插件目录(应由打包生成, 仓库只留说明): ' + stray.map((e) => e.name).join(', '));
else say('OK', '插件单一源: 官方可选插件\\ 无重复代码');

// 2. 每个插件的 manifest 契约
const dirs = fs.readdirSync(PLUGINS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
console.log('[GPLUG plugin-check] 目录插件 ' + dirs.length + ' 个: ' + dirs.join(', '));
const manifests = {};
for (const id of dirs) {
  const dir = path.join(PLUGINS, id);
  const mp = path.join(dir, 'manifest.json');
  if (!fs.existsSync(mp)) { say('FAIL', id + ': 缺 manifest.json'); continue; }
  let m;
  try { m = JSON.parse(fs.readFileSync(mp, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { say('FAIL', id + ': manifest.json 解析失败 ' + e.message); continue; }
  let bodyHash = '';
  try { bodyHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'index.js'))).digest('hex').slice(0, 16); } catch (e) {}
  manifests[id] = { m: m, bodyHash: bodyHash };
  const problems = [];
  if (m.id !== id) problems.push('manifest.id(' + m.id + ') 与目录名不符');
  if (!/^\d+\.\d+\.\d+$/.test(String(m.version || ''))) problems.push('version 不是 x.y.z');
  if (!SUPPORTED_API.includes(String(m.api || ''))) problems.push('api ' + m.api + ' 不在支持列表 ' + SUPPORTED_API.join('/'));
  if (!m.name) problems.push('缺 name');
  if (typeof m.permissions !== 'object' || m.permissions === null) problems.push('缺 permissions 声明(契约式权限的审计依据)');
  if (!fs.existsSync(path.join(dir, 'index.js'))) problems.push('缺 index.js 入口');
  if (m.ai !== undefined) {
    if (typeof m.ai !== 'object' || m.ai === null || !Array.isArray(m.ai.tasks)) problems.push('ai 声明必须是 { tasks: [...] }');
    else for (const t of m.ai.tasks) { if (t !== 'translate' && t !== 'chat') problems.push('ai.tasks 非法任务: ' + t + '(允许 translate/chat)'); }
  }
  // vendor 依赖真实存在(cpexcel 那类坑)
  const idx = fs.existsSync(path.join(dir, 'index.js')) ? fs.readFileSync(path.join(dir, 'index.js'), 'utf8') : '';
  for (const rel of [...idx.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)].map((x) => x[1])) {
    const target = path.join(dir, rel.endsWith('.js') ? rel : rel + '.js');
    if (!fs.existsSync(target)) problems.push('index.js 引用了不存在的文件: ' + rel);
  }
  if (problems.length) say('FAIL', id + ': ' + problems.join('; '));
  else say('OK', id + ' v' + m.version + ' (api ' + m.api + ', 授权哈希 ' + m.id + '@' + m.version + '|' + m.api + '|' + bodyHash.slice(0, 8) + '...)');
}

// 3. 更新包版本一致
const updDir = path.join(ROOT, 'dist', '插件更新包');
if (fs.existsSync(updDir)) {
  for (const f of fs.readdirSync(updDir).filter((x) => x.endsWith('.zip'))) {
    const mm = f.match(/^(.+)-(\d+\.\d+\.\d+)/);
    if (!mm) { say('WARN', '更新包命名无法解析版本: ' + f); continue; }
    const [, id, ver] = mm;
    if (!manifests[id]) { say('WARN', '更新包 ' + f + ' 对应的插件不在 plugins\\'); continue; }
    if (manifests[id].m.version !== ver) say('WARN', '更新包 ' + f + ' 版本(' + ver + ')落后于源码(' + manifests[id].m.version + '), 发布前需重建');
    else say('OK', '更新包 ' + f + ' 与源码版本一致');
  }
}

// 4. config.default.json 里的预置授权哈希必须与当前版本对得上
const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.default.json'), 'utf8'));
for (const [id, ent] of Object.entries(def.pluginApprovals || {})) {
  const rec = manifests[id];
  const m = rec && rec.m;
  const want = m ? m.id + '@' + m.version + '|' + m.api + '|' + rec.bodyHash : null;
  if (!m) say('WARN', 'config.default 预置了未知插件的授权: ' + id);
  else if (ent.hash !== want) say('FAIL', 'config.default 预置授权哈希过期: ' + id + ' 有 ' + ent.hash + ', 应为 ' + want);
}

console.log('  ---- ' + (fail ? fail + ' FAIL' : '0 FAIL') + ' / ' + warn + ' WARN ----');
process.exit(fail ? 1 : 0);

'use strict';
// 把 pinyin-input-method-engine 的 dist 修好扩展名后复制到 build/pinyin-engine/
// 为什么要这一步: 它的 dist 是 TS 直出的 ESM, 相对导入**不带扩展名**(export * from './core'),
//   Node 的 ESM 加载器不认 -> 必须补上 .js / /index.js。算法本身只有 ~7KB, 数据(dict/*.json)才是大头。
// 产物仍是 ESM(运行时用 await import 加载), 我们不改它的内容, 只补扩展名。
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', 'pinyin-input-method-engine', 'dist');
const OUT = path.join(__dirname, '..', 'build', 'pinyin-engine');

function fixSpecifiers(code, fileDir, outDir) {
  // 只处理相对说明符: from './x' / from "../y" / import('./z')
  return code.replace(/(from\s+|import\s*\(\s*)(['"])(\.\.?\/[^'"]+)\2/g, function (m, pre, q, spec) {
    if (/\.(js|json|mjs|cjs)$/.test(spec)) return m;
    const abs = path.resolve(fileDir, spec);
    let fixed = spec;
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) fixed = spec.replace(/\/$/, '') + '/index.js';
    else fixed = spec + '.js';
    return pre + q + fixed + q;
  });
}

function walk(dir, rel) {
  rel = rel || '';
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const src = path.join(dir, e.name);
    const r = path.join(rel, e.name);
    if (e.isDirectory()) { n += walk(src, r); continue; }
    if (!e.name.endsWith('.js')) continue;                       // 只要 .js(不要 .map/.d.ts)
    const out = path.join(OUT, r);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, fixSpecifiers(fs.readFileSync(src, 'utf8'), dir, OUT), 'utf8');
    n++;
  }
  return n;
}

if (!fs.existsSync(SRC)) { console.log('FAIL 找不到 ' + SRC + '(先 npm install)'); process.exit(1); }
fs.rmSync(OUT, { recursive: true, force: true });
const n = walk(SRC);
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ type: 'module', note: '由 scripts/build-pinyin-engine.js 生成: 只是为了让 Node 按 ESM 加载(否则有告警)' }, null, 2));
console.log('已修复并输出 ' + n + ' 个文件 -> ' + path.relative(process.cwd(), OUT));

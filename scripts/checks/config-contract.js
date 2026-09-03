'use strict';
// GCONF 配置契约门禁: 公开版默认配置必须自洽, 安全类开关必须默认开
//   坑源: config.default 漏 web.host -> 控制台显示 http://undefined:19190(条目 15);
//         新功能加了 config key 却没进默认配置 -> 公开版缺键(条目 31 的同类)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.default.json'), 'utf8').replace(/^\uFEFF/, ''));

let fail = 0, warn = 0;
const say = (lv, msg) => { console.log('  ' + (lv === 'FAIL' ? 'FAIL' : lv === 'WARN' ? 'WARN' : 'OK  ') + ' ' + msg); if (lv === 'FAIL') fail++; if (lv === 'WARN') warn++; };
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// 1. 必备键(缺了会直接出可见故障)
const REQUIRED = ['osc.host', 'osc.port', 'web.host', 'web.port', 'web.lang', 'chatbox.maxChars', 'sources.pages.enabled', 'update.mirror'];
for (const k of REQUIRED) {
  if (get(def, k) === undefined) say('FAIL', '缺必备键 ' + k);
}
if (!fail) say('OK', '必备键齐全 (' + REQUIRED.length + ' 项)');

// 2. 安全类开关必须默认开启(用户口径: 涉及安全的功能强制开启安全开关)
const SECURITY_TRUE = ['ocrtl.security.promptDefense', 'ocrtl.security.jsonMode', 'ocrtl.security.outputSanitize', 'chatbox.swearFilter.enabled'];
for (const k of SECURITY_TRUE) {
  const v = get(def, k);
  if (v === true) say('OK', '安全开关默认开启: ' + k);
  else say('FAIL', '安全开关必须默认 true: ' + k + ' 现为 ' + JSON.stringify(v));
}

// 3. 公开版不得预置任何私有内容
for (const k of ['devchain', 'level1Password', 'gate']) if (def[k] !== undefined) say('FAIL', 'config.default 不得包含 ' + k);
if (JSON.stringify(def).match(/sk-[a-zA-Z0-9]{16,}/)) say('FAIL', 'config.default 含疑似 API key');
if (get(def, 'ocrtl.vision.apiKey') !== '') say('FAIL', 'ocrtl.vision.apiKey 必须为空字符串');

// 4. 新功能默认关闭(除安全开关外), 只允许白名单里的源默认开
const DEFAULT_ON_ALLOW = ['sources.pages', 'sources.hardware'];
for (const [name, s] of Object.entries(def.sources || {})) {
  const key = 'sources.' + name;
  if (s && s.enabled === true && !DEFAULT_ON_ALLOW.includes(key)) say('WARN', key + ' 默认开启(新功能应默认关闭, 确认这是有意的)');
}
say('OK', '默认开启的数据源: ' + Object.entries(def.sources || {}).filter(([, s]) => s && s.enabled).map(([n]) => n).join(', '));

// 5. 代码里读到但默认配置没有的键(只报 WARN, 供人工判断)
const srcFiles = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(p); } else if (e.name.endsWith('.js')) srcFiles.push(p); } })(path.join(ROOT, 'src'));
const seen = new Set();
for (const f of srcFiles) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/\bconfig\.([a-zA-Z_][\w]*)\.([a-zA-Z_][\w]*)/g)) seen.add(m[1] + '.' + m[2]);
}
const NOISE_K1 = new Set(['json', 'default', 'js', 'txt']);
const NOISE_K2 = new Set(['json', 'bak', 'length', 'map', 'filter', 'forEach', 'corrupt', 'push', 'slice']);
const missing = [...seen].filter((k) => {
  const [k1, k2] = k.split('.');
  if (NOISE_K1.has(k1) || NOISE_K2.has(k2)) return false;          // 'config.json.bak' 这类字符串字面量
  if (k.startsWith('sources.') || /^(plugins|pluginApprovals|pluginEnabled)\./.test(k)) return false;
  return get(def, k) === undefined;
});
if (missing.length) say('WARN', '代码读取但默认配置未定义(确认是否需要默认值): ' + missing.slice(0, 12).join(', '));
else say('OK', '代码读取的 config 键都有默认值');

// 6. 插件安全策略默认档(2026-09-03, F-20260903-01): 默认 = 宽松但审计可见; 收紧档是可选的一级开关
const PLUGIN_SEC_DEFAULT = { networkPolicy: 'whitelist', processPolicy: 'consent', fsWritePolicy: 'sandbox', fsReadPolicy: 'self', aiPolicy: 'allow' };
const PLUGIN_SEC_ENUMS = { networkPolicy: ['whitelist', 'localOnly', 'off'], processPolicy: ['consent', 'deny'], fsWritePolicy: ['sandbox', 'declared', 'deny'], fsReadPolicy: ['self', 'declared', 'deny'], aiPolicy: ['allow', 'localOnly', 'off'] };
const ps = get(def, 'plugins.security') || {};
let psBad = 0;
for (const k of Object.keys(PLUGIN_SEC_DEFAULT)) {
  if (ps[k] === undefined) { say('FAIL', 'plugins.security 缺 ' + k + '(默认 ' + PLUGIN_SEC_DEFAULT[k] + ')'); psBad++; }
  else if (ps[k] !== PLUGIN_SEC_DEFAULT[k]) say('WARN', 'plugins.security.' + k + ' 默认值=' + ps[k] + '(标准默认 ' + PLUGIN_SEC_DEFAULT[k] + '; 收紧档应由一级密码切换, 默认配置保持标准默认)');
}
for (const k of Object.keys(PLUGIN_SEC_ENUMS)) {
  if (ps[k] !== undefined && PLUGIN_SEC_ENUMS[k].indexOf(ps[k]) < 0) { say('FAIL', 'plugins.security.' + k + ' 非法枚举值 ' + ps[k]); psBad++; }
}
if (!psBad) say('OK', '插件安全策略默认档合规(whitelist/consent/sandbox/self)');

console.log('  ---- ' + fail + ' FAIL / ' + warn + ' WARN ----');
process.exit(fail ? 1 : 0);

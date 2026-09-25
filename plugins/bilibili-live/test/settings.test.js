'use strict';
// 设置契约测试(离线): manifest 声明给控制台渲染的每个字段, 都必须是插件**真的读**的配置键。
// 起因: 2026-09-25 连续踩了两次"设置面板像模像样、底层不生效"(弹幕带昵称、保持展示), 所以把契约固化成断言。
const path = require('path');
const manifest = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const DEFAULTS = require('../index.js').DEFAULTS;
const B = require('../lib/bridge.js');
const P = require('../lib/policy.js');
// "代码真的会读的键" = 插件默认表 ∪ 桥/策略默认表 ∪ 四个凭据(凭据没有默认值, 但一定会被读)
const READ_KEYS = Object.keys(DEFAULTS).concat(Object.keys(B.DEFAULT_CFG)).concat(Object.keys(P.DEFAULT_CFG))
  .concat(['accessKeyId', 'accessKeySecret', 'appId', 'roomOwnerAuthCode']);
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
// 插件会读、但不在 DEFAULTS 里的键(策略层透传 + 卡片优先级)
const PASS_THROUGH = ['priority', 'preemptBackground', 'respectPriority', 'protectSources', 'queueMax', 'highValueQueueMax', 'danmakuQueueTtlMs', 'aggregateWindowMs', 'aggregateFormat', 'aggregateKinds', 'stuckEscapeMs'];

const fields = Array.isArray(manifest.settings) ? manifest.settings : [];
ok(fields.length >= 12, 'manifest 声明了设置字段(' + fields.length + ' 个)');
const dead = fields.filter(function (f) { return READ_KEYS.indexOf(f.key) < 0 && PASS_THROUGH.indexOf(f.key) < 0; });
ok(dead.length === 0, '每个声明字段都被代码真正读取(没有"摆设开关"): ' + (dead.length ? dead.map(function (f) { return f.key; }).join(',') : '无'));
const badType = fields.filter(function (f) { return ['text', 'password', 'number', 'bool'].indexOf(String(f.type)) < 0; });
ok(badType.length === 0, '字段 type 合法(text/password/number/bool)');
const badLabel = fields.filter(function (f) { return !f.label; });
ok(badLabel.length === 0, '每个字段都有 label');
const numBad = fields.filter(function (f) { return f.type === 'number' && !isFinite(Number(f.default)); });
ok(numBad.length === 0, 'number 字段的默认值是数字');
const boolBad = fields.filter(function (f) { return f.type === 'bool' && typeof f.default !== 'boolean'; });
ok(boolBad.length === 0, 'bool 字段的默认值是布尔');
ok((manifest.permissions.network || []).indexOf('live-open.biliapi.com') >= 0 && (manifest.permissions.network || []).indexOf('chat.bilibili.com') >= 0, '官方通道域名已声明');
ok((manifest.permissions.network || []).indexOf('api.live.bilibili.com') >= 0, '公开房间信息接口域名已声明(显示热度才用到 —— 声明是显式的, 用户授权时看得到)');
// 用户明确要过的开关, 一个都不能少
for (const key of ['showUname', 'holdEnabled', 'scHoldMs', 'giftHoldMs', 'guardHoldMs', 'showRoomTitle', 'showRoomId', 'showRoomPopularity', 'ignoreSelf', 'autoStart']) {
  ok(fields.some(function (f) { return f.key === key; }), '开关存在: ' + key);
}
ok(DEFAULTS.showRoomTitle === true && DEFAULTS.showRoomId === true && DEFAULTS.showRoomPopularity === false, '房间信息默认: 标题/房间号开, 热度关(要用公开接口, 用户自己决定)');
// 还没暴露到界面上的可调项(诚实列出来, 免得以为界面上都能改)
const NOT_EXPOSED = ['danmakuQueueTtlMs', 'queueMax', 'highValueQueueMax', 'respectPriority', 'preemptBackground', 'protectSources', 'aggregateWindowMs', 'aggregateFormat', 'blockedWords', 'kinds', 'timeoutMs', 'restartDelayMs', 'stuckEscapeMs'];
const missing = NOT_EXPOSED.filter(function (k) { return READ_KEYS.indexOf(k) >= 0; });
console.log('  (注: 这些键可由 config.json 调, 但还没做成界面字段 -> ' + missing.join(', ') + ')');

console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exitCode = fail ? 1 : 0;

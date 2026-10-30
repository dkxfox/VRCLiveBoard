'use strict';
// camera-path v0.2.0 离线单测(不连 VRChat, 不发 OSC; 只测编码/解析/拆分/扫描)
// 运行: node plugins/camera-path/test/run-tests.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' -> ' + (e && e.message)); }
}
function kf(x, y, z, idx, pid, extra) {
  return Object.assign({ IsLocal: false, Position: { X: x, Y: y, Z: z }, Rotation: { X: 0, Y: 0, Z: 0 }, FocalDistance: 2, Aperture: 15, Hue: 120, Saturation: 100, Lightness: 50, LookAtMeXOffset: 0, LookAtMeYOffset: 0, Zoom: 45, Exposure: 0, Speed: 0.4, Duration: 2, Index: idx, PathIndex: pid }, extra || {});
}
function makeFrames(n, start, step, pid) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(kf(start + i * step, 1.5, 0, i, pid || 0));
  return a;
}

const pluginFactory = require(path.join(__dirname, '..', 'index.js'));
const inst = pluginFactory({ config: {}, log: function () {} });
const api = inst.api;

t('OSC 编码: 字符串 NUL + 4 字节对齐', function () {
  const b = api._encode('/dolly/Import', ['C:/a.json']);
  assert.ok(Buffer.isBuffer(b));
  assert.strictEqual(b.length % 4, 0);
  assert.deepStrictEqual(api._audit(b), []);
});
t('OSC 编码: int 用 i, float 用 f, bool 用 T/F', function () {
  const b = api._encode('/test', [3, 1.5, true]);
  const s = b.toString('latin1');
  assert.ok(s.indexOf(',ifsT') >= 0 || s.indexOf(',ifT') >= 0);
});
t('parseVrcPath: 2 帧', function () {
  const info = api._parse(makeFrames(2, 0, 1));
  assert.strictEqual(info.ok, true);
  assert.strictEqual(info.points, 2);
  assert.strictEqual(info.segments, 1);
  assert.strictEqual(info.maxSegment, 2);
  assert.ok(info.distance > 0);
});
t('parseVrcPath: 12 帧单段', function () {
  const info = api._parse(makeFrames(12, 0, 1));
  assert.strictEqual(info.ok, true);
  assert.strictEqual(info.maxSegment, 12);
});
t('parseVrcPath: 非法(缺 Position)要报错', function () {
  const info = api._parse([{ Rotation: { X: 0, Y: 0, Z: 0 } }]);
  assert.strictEqual(info.ok, false);
  assert.ok(info.error);
});
t('sanitizePath: ≤7 帧不改动', function () {
  const frames = makeFrames(7, 0, 1);
  const r = api._sanitize(frames, 7);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.info.maxSegment, 7);
});
t('sanitizePath: 12 帧拆成 ≤7 的多段且保留所有点', function () {
  const frames = makeFrames(12, 0, 1);
  const r = api._sanitize(frames, 7);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changed, true);
  assert.ok(r.info.maxSegment <= 7, 'maxSegment=' + r.info.maxSegment);
  assert.ok(r.info.segments >= 2, 'segments=' + r.info.segments);
  assert.ok(r.json.length >= frames.length, '拆分后不能丢点');
  assert.strictEqual(r.json[0].PathIndex, 0);
  const segs = {};
  r.json.forEach(function (k) { (segs[k.PathIndex] = segs[k.PathIndex] || []).push(k); });
  Object.keys(segs).forEach(function (p) { segs[p].forEach(function (k, i) { assert.strictEqual(Number(k.Index), i); }); });
});
t('sanitizePath: 多段输入(2 段)也能处理', function () {
  const frames = makeFrames(4, 0, 1, 0).concat(makeFrames(12, 0, 1, 1));
  const r = api._sanitize(frames, 7);
  assert.strictEqual(r.ok, true);
  assert.ok(r.info.maxSegment <= 7);
  assert.ok(r.info.segments >= 3);
});
t('sanitizePath: 默认拆分阈值 6 -> 12 帧拆 6+6', function () {
  const r = api._sanitize(makeFrames(12, 0, 1), 6);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.info.segmentSizes, [6, 6]);
  assert.strictEqual(r.info.maxSegment, 6);
});
t('scanPresets: 忽略 _vrcliveboard_tmp_ 临时文件', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-tmp-'));
  fs.writeFileSync(path.join(dir, '_vrcliveboard_tmp_x.json'), JSON.stringify(makeFrames(2, 0, 1)));
  fs.writeFileSync(path.join(dir, 'real.json'), JSON.stringify(makeFrames(2, 0, 1)));
  const r = api._scan(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.presets.length, 1);
  assert.strictEqual(r.presets[0].file, 'real.json');
  fs.rmSync(dir, { recursive: true, force: true });
});
t('scanPresets: 临时目录读取/排序/错误容忍', function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  fs.writeFileSync(path.join(dir, 'a-good.json'), JSON.stringify(makeFrames(3, 0, 1)));
  fs.writeFileSync(path.join(dir, 'b-bad.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'ignore.txt'), 'x');
  const r = api._scan(dir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.presets.length, 2);
  const good = r.presets.find(function (p) { return p.file === 'a-good.json'; });
  const bad = r.presets.find(function (p) { return p.file === 'b-bad.json'; });
  assert.ok(good && good.ok && good.points === 3);
  assert.ok(bad && bad.ok === false && bad.error);
  fs.rmSync(dir, { recursive: true, force: true });
});

try { inst.dispose(); } catch (e) {}
console.log('\n[camera-path tests] PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);

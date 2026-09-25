'use strict';
// 官方通道签名/请求构造单测(纯离线, 用**假密钥**: 不需要也不应该用真凭据): node lib/official.test.js
const crypto = require('crypto');
const O = require('./official.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

const AK = 'AKfake0000000001';
const SK = 'SKfake-not-a-real-secret-000000000002';
const AT = 1700000000000;          // 固定时间戳, 让签名可复现
const NONCE = 'abcdef0123456789';
const BODY = JSON.stringify({ code: 'AUTHCODE', app_id: 1234567890123 });

// ① 签名串必须逐字正确(六个头按序 key:value 换行) —— 这是最容易写错、也最难从报错里看出的一环
const s = O.signHeaders(AK, SK, BODY, { at: AT, nonce: NONCE });
const expectStr = [
  'x-bili-accesskeyid:' + AK,
  'x-bili-content-md5:' + crypto.createHash('md5').update(Buffer.from(BODY, 'utf8')).digest('hex'),
  'x-bili-signature-method:HMAC-SHA256',
  'x-bili-signature-nonce:' + NONCE,
  'x-bili-signature-version:1.0',
  'x-bili-timestamp:1700000000'
].join('\n');
ok(s.strToSign === expectStr, '签名串逐字正确(六行, 顺序固定, 时间戳为秒)');
ok(O.HEADER_ORDER.join(',') === 'x-bili-accesskeyid,x-bili-content-md5,x-bili-signature-method,x-bili-signature-nonce,x-bili-signature-version,x-bili-timestamp', '头顺序契约与官方一致');

// ② 签名值 = HMAC-SHA256(secret, 签名串), 独立复算一遍
const expectSig = crypto.createHmac('sha256', SK).update(expectStr, 'utf8').digest('hex');
ok(s.headers.Authorization === expectSig && /^[a-f0-9]{64}$/.test(s.headers.Authorization), 'Authorization = HMAC-SHA256(secret, 签名串) 的 hex');
ok(s.headers['x-bili-content-md5'] === crypto.createHash('md5').update(Buffer.from(BODY, 'utf8')).digest('hex'), 'content-md5 = 请求体的 MD5');
ok(s.headers['x-bili-signature-method'] === 'HMAC-SHA256' && s.headers['x-bili-signature-version'] === '1.0', 'method/version 固定值正确');
ok(s.headers['Content-Type'] === 'application/json' && s.headers.Accept === 'application/json', 'Content-Type / Accept 正确');
ok(!('x-bili-accesskeysecret' in s.headers), '请求头里没有 secret 字段');

// ③ 安全: secret 绝不泄漏到任何返回值/日志摘要里
ok(JSON.stringify(s.headers).indexOf(SK) < 0 && s.strToSign.indexOf(SK) < 0, '头与签名串里都不含 secret');
const red = O.redactHeaders(s.headers);
const redTxt = JSON.stringify(red);
ok(redTxt.indexOf(SK) < 0 && redTxt.indexOf(s.headers.Authorization) < 0, '日志脱敏摘要不含 secret、也不含完整签名');
ok(red.accessKeyId === 'AKfa…(16)' && red.signatureLength === 64, '脱敏摘要只留 key 前 4 位与签名长度(' + red.accessKeyId + ')');

// ④ 请求体构造
ok(O.buildStartBody(1234567890123, 'AUTHCODE') === BODY, 'start 请求体 = {code, app_id}(app_id 为数字)');
let threw = false; try { O.buildStartBody(0, 'x'); } catch (e) { threw = true; }
ok(threw, 'app_id 无效时拒绝构造');
threw = false; try { O.buildStartBody(1, ''); } catch (e) { threw = true; }
ok(threw, '缺主播身份码时拒绝构造');
ok(O.buildHeartbeatBody('GAME123') === JSON.stringify({ game_id: 'GAME123' }), '心跳/结束请求体 = {game_id}');

// ⑤ 完整请求: 端点正确, 且 URL 里不夹带任何凭据
const req = O.buildRequest('start', BODY, { accessKeyId: AK, accessKeySecret: SK }, { at: AT, nonce: NONCE });
ok(req.url === O.BASE + '/v2/app/start' && req.method === 'POST', '端点与方式正确(' + req.url + ')');
ok(req.url.indexOf(AK) < 0 && req.url.indexOf(SK) < 0 && req.url.indexOf('?') < 0, 'URL 是干净的(凭据只在请求头, 不进 URL)');
threw = false; try { O.buildRequest('nope', BODY, { accessKeyId: AK, accessKeySecret: SK }); } catch (e) { threw = true; }
ok(threw, '未知端点被拒绝');
threw = false; try { O.buildRequest('start', BODY, {}); } catch (e) { threw = true; }
ok(threw, '缺凭据时拒绝构造');

// ⑥ 响应解析
const d = O.parseResponse(JSON.stringify({ code: 0, message: '0', data: { game_id: 'G1', host_server_url_list: ['wss://a'], auth_body: 'AB' } }));
ok(d.game_id === 'G1', 'code=0 时返回 data');
let err = null; try { O.parseResponse(JSON.stringify({ code: 1001, message: '参数错误' })); } catch (e) { err = e; }
ok(err && err.code === 1001 && /参数错误/.test(err.message), '非 0 code 抛出并带上 code/message');
err = null; try { O.parseResponse('<html>502</html>'); } catch (e) { err = e; }
ok(err && /不是 JSON/.test(err.message), '非 JSON 响应明确报错(便于区分网关错误)');

// ⑦ start 返回字段兼容 snake_case 与 camelCase
const n1 = O.normalizeStart({ game_id: 'G2', host_server_url_list: ['wss://x'], auth_body: 'B', room_owner_uid: 7, room_owner_open_id: 'OID' });
const n2 = O.normalizeStart({ gameId: 'G2', hostServerUrlList: ['wss://x'], authBody: 'B' });
ok(n1.gameId === 'G2' && n1.hosts.length === 1 && n1.authBody === 'B' && n1.roomOwnerUid === 7, 'snake_case 返回被归一化');
ok(n2.gameId === 'G2' && n2.hosts.length === 1, 'camelCase 返回也能读(字段名兜底)');
ok(O.normalizeStart(null).hosts.length === 0, '空返回不崩(降级为空列表)');

console.log('  ---- ' + pass + ' PASS / ' + fail + ' FAIL ----');
process.exitCode = fail ? 1 : 0;

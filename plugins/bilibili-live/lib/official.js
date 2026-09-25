'use strict';
// B站直播开放平台 —— 签名与请求构造(纯函数 + 一个极薄的发送层, 零依赖: Node 内置 crypto/fetch)
//
// 签名规范(从跑通的官方接入实现逐字核对, 见 07-接入实现要点.md):
//   请求头六个 x-bili-*, **顺序即签名串顺序**(不能重排):
//     x-bili-accesskeyid / x-bili-content-md5(请求体 MD5) / x-bili-signature-method(HMAC-SHA256)
//     / x-bili-signature-nonce / x-bili-signature-version(1.0) / x-bili-timestamp(秒)
//   签名串 = 这六行按顺序 `key:value` 用 \n 连接(不含末尾换行)
//   Authorization = HMAC-SHA256(key=access_key_secret, msg=签名串) 的 hex
//   另带 Content-Type: application/json 与 Accept: application/json
// 安全: access_key_secret 只作为 HMAC 的 key 参与计算, **永不放进任何返回值/日志**(redactHeaders 专门用于日志)。
const crypto = require('crypto');

const BASE = 'https://live-open.biliapi.com';
const PATHS = { start: '/v2/app/start', heartbeat: '/v2/app/heartbeat', end: '/v2/app/end' };
const HEADER_ORDER = ['x-bili-accesskeyid', 'x-bili-content-md5', 'x-bili-signature-method', 'x-bili-signature-nonce', 'x-bili-signature-version', 'x-bili-timestamp'];

function md5Hex(str) { return crypto.createHash('md5').update(Buffer.from(String(str), 'utf8')).digest('hex'); }

// 纯函数: 传入 body 字符串与凭据, 产出可直接用于请求的头(含 Authorization)
// opts.at / opts.nonce 可注入, 便于确定性单测
function signHeaders(accessKeyId, accessKeySecret, bodyStr, opts) {
  const o = opts || {};
  const at = Number.isFinite(o.at) ? o.at : Date.now();
  const nonce = o.nonce || crypto.randomUUID().replace(/-/g, '');
  const values = {
    'x-bili-accesskeyid': String(accessKeyId || ''),
    'x-bili-content-md5': md5Hex(bodyStr == null ? '' : bodyStr),
    'x-bili-signature-method': 'HMAC-SHA256',
    'x-bili-signature-nonce': String(nonce),
    'x-bili-signature-version': '1.0',
    'x-bili-timestamp': String(Math.floor(at / 1000))
  };
  const strToSign = HEADER_ORDER.map(function (k) { return k + ':' + values[k]; }).join('\n');
  const signature = crypto.createHmac('sha256', String(accessKeySecret || '')).update(strToSign, 'utf8').digest('hex');
  const headers = {};
  for (const k of HEADER_ORDER) headers[k] = values[k];
  headers.Authorization = signature;
  headers['Content-Type'] = 'application/json';
  headers.Accept = 'application/json';
  return { headers: headers, strToSign: strToSign, signature: signature };
}

// 请求体: start 需要 code(主播身份码) + app_id(项目 ID)
function buildStartBody(appId, code) {
  const n = Number(appId);
  if (!Number.isFinite(n) || n <= 0) throw new Error('app_id 无效');
  if (!code) throw new Error('缺少主播身份码');
  return JSON.stringify({ code: String(code), app_id: n });
}
function buildHeartbeatBody(gameId) {
  if (!gameId) throw new Error('缺少 game_id');
  return JSON.stringify({ game_id: String(gameId) });
}
// end 的请求体是 {app_id, game_id}(2026-09-25 查实: blivedm _end_game 传的就是这两个);
// 心跳只带 game_id —— 两者**不是**同一个体, 别复用。
function buildEndBody(appId, gameId) {
  if (!gameId) throw new Error('缺少 game_id');
  const n = Number(appId);
  if (!Number.isFinite(n) || n <= 0) throw new Error('app_id 无效');
  return JSON.stringify({ app_id: n, game_id: String(gameId) });
}

// 组装一个完整请求(不发送, 便于单测与日志脱敏)
function buildRequest(path, bodyStr, creds, opts) {
  if (!PATHS[path]) throw new Error('未知端点: ' + path);
  if (!creds || !creds.accessKeyId || !creds.accessKeySecret) throw new Error('缺少 access_key_id / access_key_secret');
  const signed = signHeaders(creds.accessKeyId, creds.accessKeySecret, bodyStr, opts);
  return { url: BASE + PATHS[path], method: 'POST', headers: signed.headers, body: bodyStr, strToSign: signed.strToSign };
}

// 日志脱敏: 只保留 key 的前 4 位与签名长度, **绝不输出 secret**(安全约定见 07 第六节)
function redactHeaders(headers) {
  const h = headers || {};
  const kid = String(h['x-bili-accesskeyid'] || '');
  return {
    accessKeyId: kid ? (kid.slice(0, 4) + '…(' + kid.length + ')') : '-',
    nonce: String(h['x-bili-signature-nonce'] || '').slice(0, 8) + '…',
    timestamp: h['x-bili-timestamp'] || '',
    signatureLength: String(h.Authorization || '').length
  };
}

// 响应解析: 官方约定 code=0 成功; 其余一律抛出(带 code 与 message, 便于上层分类)
function parseResponse(text) {
  let j = null;
  try { j = JSON.parse(String(text || '')); } catch (e) { throw new Error('开放平台返回不是 JSON: ' + String(text).slice(0, 120)); }
  if (!j || typeof j !== 'object') throw new Error('开放平台返回为空');
  if (Number(j.code) !== 0) {
    const err = new Error('开放平台错误 ' + j.code + ': ' + (j.message || j.msg || ''));
    err.code = Number(j.code);
    err.message2 = String(j.message || j.msg || '');
    throw err;
  }
  return j.data || {};
}
// start 的成功返回: 字段名兼容 snake_case 与 camelCase
// 主播信息在 **data.anchor_info** 里(2026-09-20 查实: blivedm open_live.py 读 data['anchor_info']['uid'|'open_id'|'room_id'];
// 顶层那套 room_owner_* 只是老写法, 两个都认)。主播 open_id 用来识别"主播自己发的弹幕"。
function normalizeStart(data) {
  const d = data || {};
  // 真实形状(2026-09-25 实机 + blivedm _parse_start_game 印证):
  //   data.game_info.game_id / data.websocket_info.wss_link[] / data.websocket_info.auth_body / data.anchor_info.*
  // 扁平那套(game_id / host_server_url_list / auth_body)只作兼容保留。
  const gi = (d.game_info && typeof d.game_info === 'object') ? d.game_info : {};
  const ws = (d.websocket_info && typeof d.websocket_info === 'object') ? d.websocket_info : {};
  const hosts = ws.wss_link || ws.wssLink || d.host_server_url_list || d.hostServerUrlList || [];
  const ai = (d.anchor_info && typeof d.anchor_info === 'object') ? d.anchor_info : {};
  return {
    gameId: gi.game_id || gi.gameId || d.game_id || d.gameId || '',
    hosts: Array.isArray(hosts) ? hosts.slice() : [],
    authBody: ws.auth_body || ws.authBody || d.auth_body || d.authBody || '',
    roomId: Number(ai.room_id || d.room_id || d.roomId || 0) || 0,
    roomOwnerUid: Number(ai.uid || d.room_owner_uid || d.roomOwnerUid || 0) || 0,
    roomOwnerOpenId: String(ai.open_id || d.room_owner_open_id || d.roomOwnerOpenId || '') || '',
    roomOwnerName: String(ai.uname || d.room_owner_uname || '') || ''
  };
}

// 极薄发送层(不在离线单测覆盖范围内; 真连时由本地假服务器/真环境验证)
async function postJson(path, bodyStr, creds, opts) {
  const o = opts || {};
  const req = buildRequest(path, bodyStr, creds, o);
  // fetchImpl 可注入: 插件里传 ctx.http.request(受权限门禁与审计), 单测里传假的
  const doFetch = typeof o.fetchImpl === 'function' ? o.fetchImpl : fetch;
  const res = await doFetch(req.url, {
    method: 'POST', headers: req.headers, body: req.body,
    signal: AbortSignal.timeout(Number(o.timeoutMs) || 10000)
  });
  const text = await res.text();
  return { status: res.status, data: parseResponse(text) };
}
async function startSession(creds, appId, code, opts) {
  const r = await postJson('start', buildStartBody(appId, code), creds, opts);
  const st = normalizeStart(r.data);
  if (!st.gameId || !st.hosts.length || !st.authBody) {
    // 诊断只带**键名**(响应里可能有 auth_body 这类令牌, 绝不能进日志)
    const keys = Object.keys(r.data || {}).join(',') || '(空)';
    const e = new Error('start 成功但没有场次信息(data 键: ' + keys + ') —— 常见原因: 主播还没开播, 或该项目在本房间还有场次没结束');
    e.emptyStart = true; e.dataKeys = keys;
    throw e;
  }
  return st;
}
async function heartbeatSession(creds, gameId, opts) {
  if (!gameId) return { skipped: true, reason: 'no-game-id' };       // 没有场次号就别发(否则平台只会回"缺少 game_id")
  return postJson('heartbeat', buildHeartbeatBody(gameId), creds, opts);
}
async function endSession(creds, gameId, opts) {
  if (!gameId) return { skipped: true, reason: 'no-game-id' };       // 同上: 结束场次前先确认有场次号
  try {
    return await postJson('end', buildEndBody(creds && creds.appId, gameId), creds, opts);
  } catch (e) {
    if (e && (e.code === 7000 || e.code === 7003)) return { closed: true };   // 项目已经关了 = 也算结束成功
    throw e;
  }
}

module.exports = {
  BASE: BASE, PATHS: PATHS, HEADER_ORDER: HEADER_ORDER,
  md5Hex: md5Hex, signHeaders: signHeaders, buildStartBody: buildStartBody, buildHeartbeatBody: buildHeartbeatBody, buildEndBody: buildEndBody,
  buildRequest: buildRequest, redactHeaders: redactHeaders, parseResponse: parseResponse, normalizeStart: normalizeStart,
  postJson: postJson, startSession: startSession, heartbeatSession: heartbeatSession, endSession: endSession
};

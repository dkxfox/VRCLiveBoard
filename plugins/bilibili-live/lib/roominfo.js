'use strict';
// B站直播 —— 直播间信息(标题/房间号/热度)的纯逻辑: 取数、格式化、拼文案
//
// 数据来源(诚实标注):
//   · 房间号 / 主播名: 官方开放平台 start 的 anchor_info(一定有);
//   · 标题: 官方通道的 LIVE_OPEN_PLATFORM_LIVE_START 事件里有 title/area_name(开播那一刻推来);
//   · **热度(人气值)官方通道不提供** —— 只有公开的网页房间信息接口有(room/v1/Room/get_info 的 data.online),
//     所以"显示热度"是**独立开关**(默认关), 打开才会去请求那个接口; 顺手也能拿到更准的标题。
const DEFAULT_CFG = {
  showRoomTitle: true,
  showRoomId: true,
  showRoomPopularity: false,     // 需要访问公开网页接口, 默认关(见上面说明)
  roomInfoPrefix: '【直播间】',
  roomInfoPriority: 8,           // 低优先级: 只在没有别的可显示时才轮到它(公告板是 5)
  roomInfoIntervalMs: 60000      // 刷新间隔(官方数据是事件驱动, 这里只管热度轮询)
};
function cfgOf(cfg) { return Object.assign({}, DEFAULT_CFG, cfg || {}); }

// 人气值格式化: 12345 -> 1.2万
function formatPopularity(n) {
  const v = Number(n) || 0;
  if (v >= 100000000) return trimZero((v / 100000000).toFixed(1)) + '亿';
  if (v >= 10000) return trimZero((v / 10000).toFixed(1)) + '万';
  return String(v);
}
function trimZero(s) { return String(s).replace(/\.0$/, ''); }

// 拼文案: 三个开关各自决定要不要这一段; 一个都没有 -> 返回空串(上层据此不显示)
function buildRoomInfoText(info, cfg) {
  const c = cfgOf(cfg);
  const i = info || {};
  const parts = [];
  if (c.showRoomTitle !== false && i.title) parts.push(String(i.title));
  if (c.showRoomId !== false && i.roomId) parts.push('房间 ' + String(i.roomId));
  if (c.showRoomPopularity !== false && Number(i.popularity) > 0) parts.push('热度 ' + formatPopularity(i.popularity));
  if (!parts.length) return '';
  return String(c.roomInfoPrefix === undefined ? DEFAULT_CFG.roomInfoPrefix : c.roomInfoPrefix) + parts.join(' · ');
}

// 宽容读取公开房间信息接口的返回(字段名以网页接口为准, 缺就给默认值)
function pickRoomInfo(json) {
  const d = (json && json.data && typeof json.data === 'object') ? json.data : (json && typeof json.data === 'object' ? json.data : {});
  return {
    roomId: Number(d.room_id || d.roomId || 0) || 0,
    title: String(d.title || ''),
    popularity: Number(d.online || d.popularity || 0) || 0,
    liveStatus: Number(d.live_status === undefined ? d.liveStatus : d.live_status) || 0,
    areaName: String(d.area_name || d.areaName || '')
  };
}

module.exports = { DEFAULT_CFG: DEFAULT_CFG, cfgOf: cfgOf, formatPopularity: formatPopularity, buildRoomInfoText: buildRoomInfoText, pickRoomInfo: pickRoomInfo };

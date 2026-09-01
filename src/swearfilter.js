'use strict';
// 聊天框脏话过滤器: 命中词替换为 ***
const DEFAULTS = [
  '妈的', '他妈的', '你妈的', '操', '我操', '卧槽', '草泥马', '傻逼', '傻b', 'sb', 'cnm', 'nmsl', '他妈', '尼玛',
  '滚蛋', '去死', '贱人', '婊子', '混蛋', '王八蛋', '龟儿子', '屌', '艹', '靠北', '干你娘', 'fuck', 'shit', 'bitch',
  'asshole', 'damn', 'fck', 'wtf', 'f**k', 's**t', 'b**ch', 'dumbass', 'bastard', 'cunt', 'motherfucker',
  // 外挂/作弊(2026-08-27 用户要求新增)
  '外挂', '开挂', '外挂群', '卖挂', '买挂', '挂逼', '透视挂', '自瞄', '锁头', '脚本狗', '秒杀挂', '加速挂', '无敌挂', '飞天挂', '遁地挂', '作弊器', 'aimbot', 'wallhack',
  // 盗用模型/接口/账号(2026-08-27 用户要求新增, 待审查)
  '盗用模型', '盗模型', '模型盗用', '破解模型', '越狱模型', '盗用接口', '盗接口', '倒卖key', '卖key', '共享key', '盗号', '盗用API', '贩卖账号', '账号共享', '模型外泄'
];
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function filterText(text, words) {
  let out = String(text);
  const list = (words && words.length) ? words : DEFAULTS;
  for (const w of list) {
    if (!w) continue;
    let pattern = w;
    if (/^[\w]+$/.test(w)) pattern = '\\b' + esc(w) + '\\b';
    else pattern = esc(w);
    try { out = out.replace(new RegExp(pattern, 'gi'), function (m) { return '*'.repeat(Math.min(4, Math.max(1, Array.from(m).length))); }); } catch (e) {}
  }
  return out;
}
module.exports = { DEFAULTS: DEFAULTS, filterText: filterText };

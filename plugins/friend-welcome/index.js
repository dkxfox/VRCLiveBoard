'use strict';
// 官方示例: 好友欢迎 v1.1 —— 批量名单(Excel 导入), player.joined 事件 -> 专属轮巡 -> 自动恢复
module.exports = function (ctx) {
  let busy = false;
  function friends() {
    const f = ctx.config.friends || [];
    if (!f.length && ctx.config.name) {
      const old = { name: ctx.config.name, lines: ctx.config.lines || ['欢迎 {name} 来到房间!', '大家鼓掌欢迎~'], loops: Number(ctx.config.loops) || 2, eachMs: Number(ctx.config.eachMs) || 6000, enabled: true };
      ctx.config.friends = [old];
      return [old];
    }
    return f;
  }
  function onJoin(pname, meta) {
    // 进房快照: 玩家进入房间时, VRChat 会把房间里已存在的玩家补写一遍 OnPlayerJoined;
    // 这些"已在场"的好友不触发欢迎, 只有玩家进房之后真正进入的好友才触发。
    if (meta && meta.alreadyInWorld) { ctx.logger.info('[friend-welcome] 跳过进房快照: ' + String(pname || '').replace(/\(usr_[^)]*\)/g, '').trim()); return; }
    // 只使用显示名, 不发送/不显示任何 UID 形态(usr_xxx)
    const displayName = String(pname || '')
      .replace(/\(\s*usr_[a-z0-9-]+\s*\)|\busr_[a-z0-9-]+\b/gi, '')
      .replace(/\(\s*\)/g, '')
      .trim();
    if (busy) return;
    for (const fr of friends()) {
      if (!fr || fr.enabled === false) continue;
      const n = String(fr.name || '').trim();
      if (!n) continue;
      if (String(pname).toLowerCase().indexOf(n.toLowerCase()) < 0) continue;
      busy = true;
      const lines = (fr.lines || []).map(function (l) { return String(l).split('{name}').join(displayName || pname); });
      if (!lines.length) { busy = false; continue; }
      const eachMs = Math.max(2000, Number(fr.eachMs) || 6000);
      const loops = Math.max(1, Number(fr.loops) || 2);
      ctx.chatbox.showSequence(lines, { priority: 90, eachMs: eachMs, loops: loops }).then(function () { busy = false; });
      break;
    }
  }
  // 统一入口: 标准化 + 按显示名去重(大小写不敏感, 保留第一条)
  function normalizeRows(rows) {
    let start = 0;
    if (rows && rows[0] && String(rows[0][0] || '').indexOf('显示') >= 0) start = 1;
    const out = [];
    const seen = new Set();
    let deduped = 0;
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = String(r[0] || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) { deduped++; continue; }
      seen.add(key);
      const en = String(r[4] === undefined || r[4] === null ? '' : r[4]).toLowerCase();
      out.push({
        name: name,
        lines: String(r[1] || '欢迎 {name} 来到房间!').split('|').map(function (s) { return s.trim(); }).filter(Boolean),
        loops: Math.min(10, Math.max(1, Number(r[2]) || 2)),
        eachMs: Math.min(120000, Math.max(2000, (Number(r[3]) || 6) * 1000)),
        enabled: !(en === '否' || en === 'no' || en === 'false' || en === '0')
      });
    }
    return { out: out, deduped: deduped };
  }
  function importRows(rows) {
    const n = normalizeRows(rows);
    ctx.config.friends = n.out;
    return { count: n.out.length, deduped: n.deduped };
  }
  function getRows() {
    return (ctx.config.friends || []).map(function (f) {
      return { name: f.name, lines: (f.lines || []).join('|'), loops: f.loops || 2, eachSec: Math.round((f.eachMs || 6000) / 1000), enabled: f.enabled !== false };
    });
  }
  function saveRows(input) {
    if (input && typeof input === 'object' && Array.isArray(input.rows)) input = input.rows;
    const n = normalizeRows(input);
    ctx.config.friends = n.out;
    return { ok: true, count: n.out.length, deduped: n.deduped };
  }
  return {
    apply: function () { ctx.events.on('player.joined', onJoin); },
    dispose: function () { ctx.events.off('player.joined', onJoin); },
    importRows: importRows,
    api: { getRows: getRows, saveRows: saveRows },
    panel: {
      title: '好友欢迎设置',
      html: function () {
        return '<div class="sub">名单管理: 可直接在表格里编辑, 也可整表导入/导出 Excel。保存时自动按显示名去重(重复的保留第一条)。</div>' +
          '<div class="row" style="margin-top:8px">' +
          '<button class="small" onclick="fwAddRow()">添加一行</button>' +
          '<button class="small" onclick="fwSaveRows()">保存全部</button>' +
          '<button class="small" style="background:#55606e" onclick="fwExportXlsx()">下载当前名单</button>' +
          '<button class="small" style="background:#55606e" onclick="window.open(\'/api/plugins/asset?id=friend-welcome&file=好友名单模板.xlsx\', \'_blank\')">下载 Excel 模板</button>' +
          '<button class="small" style="background:#55606e" onclick="plgPickXlsx()">从 Excel 导入</button>' +
          '</div>' +
          '<table style="margin-top:8px"><thead><tr><th>显示名</th><th>欢迎语(多条用 | 分隔)</th><th>轮巡</th><th>每片秒</th><th>启用</th><th></th></tr></thead><tbody id="fwRowsTb"></tbody></table>' +
          '<div class="sub" id="fwMsg" style="margin-top:8px;color:#3ddc84"></div>' +
          '<input id="fwFile" type="file" accept=".xlsx" style="display:none" onchange="plgImportXlsx(this.files[0])">';
      }
    }
  };
};

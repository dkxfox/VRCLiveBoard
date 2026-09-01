'use strict';
// 官方示例: 定时公告 v2.0 —— 常规轮播 + 整点/半点播报 + 指定日期时间特殊公告 + 可选中断 + 批量管理(Excel)
module.exports = function (ctx) {
  let idx = 0;
  let stopInterval = null;
  let stopMinute = null;
  const firedKeys = new Set(); // 去重: 整点/半点按"日期+时段"、特殊公告按"时间+内容"

  function items() {
    return (ctx.config.items || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
  }
  function fireLines(lines, interrupt, label) {
    const arr = (lines || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (!arr.length) return false;
    ctx.logger.info('[定时公告] 触发 ' + label + ': ' + arr[0].slice(0, 40));
    if (interrupt) {
      // 中断模式: 高优先级 + 强制发送, 盖过其它功能, 播完自动恢复
      ctx.chatbox.showSequence(arr, { priority: 99, eachMs: 6000, loops: 2 });
    } else {
      // 非中断: 排队发送, 尊重当前显示与限频
      ctx.chatbox.showSequence(arr, { priority: 80, eachMs: 6000, loops: 1, force: false });
    }
    return true;
  }
  function showNext() {
    const list = items();
    if (!list.length) return;
    ctx.chatbox.send(list[idx % list.length], { priority: 80, ttlMs: 10000 });
    idx++;
  }
  function parseAt(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  }
  function minuteCheck() {
    const now = new Date();
    const cfg = ctx.config;
    // 整点/半点
    const isHour = now.getMinutes() === 0;
    const isHalf = now.getMinutes() === 30;
    if ((isHour && cfg.onHour) || (isHalf && cfg.onHalf)) {
      const key = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate() + 'T' + (isHour ? 'H' : 'h') + now.getHours();
      if (!firedKeys.has(key)) {
        firedKeys.add(key);
        fireLines(cfg.hourlyText || [], cfg.interruptHourly, isHour ? '整点播报' : '半点播报');
      }
    }
    // 特殊公告: 仅在设定时刻之后 2 分钟窗口内触发一次(错过不补发)
    for (const s of (cfg.specials || [])) {
      if (!s || !s.at) continue;
      const t = parseAt(s.at);
      if (!t) continue;
      const diff = now.getTime() - t;
      if (diff >= 0 && diff < 120000) {
        const key = s.at + '|' + ((s.text || []).join('|'));
        if (!firedKeys.has(key)) {
          firedKeys.add(key);
          fireLines(s.text, !!s.interrupt, '特殊公告');
        }
      }
    }
  }
  // 批量设置(特殊公告)
  function normalizeSpecials(rows) {
    let start = 0;
    if (rows && rows[0] && String(rows[0][0] || '').indexOf('日期') >= 0) start = 1;
    const out = [];
    const seen = new Set();
    let deduped = 0;
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] || [];
      const at = String(r[0] || '').trim();
      if (!at || !parseAt(at)) continue;
      const key = at.toLowerCase();
      if (seen.has(key)) { deduped++; continue; }
      seen.add(key);
      const intr = String(r[2] === undefined || r[2] === null ? '' : r[2]).toLowerCase();
      out.push({
        at: at,
        text: String(r[1] || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean),
        interrupt: !(intr === '否' || intr === 'no' || intr === 'false' || intr === '0')
      });
    }
    return { out: out, deduped: deduped };
  }
  function getRows() {
    return (ctx.config.specials || []).map(function (s) {
      return { at: s.at, text: (s.text || []).join('|'), interrupt: !!s.interrupt };
    });
  }
  function saveRows(input) {
    if (input && typeof input === 'object' && Array.isArray(input.rows)) input = input.rows;
    const n = normalizeSpecials(input);
    ctx.config.specials = n.out;
    return { ok: true, count: n.out.length, deduped: n.deduped };
  }
  function importRows(rows) {
    const n = normalizeSpecials(rows);
    ctx.config.specials = n.out;
    return { ok: true, count: n.out.length, deduped: n.deduped };
  }
  function saveAll(input) {
    if (input && typeof input === 'object' && input.args) input = input.args;
    const o = input || {};
    ctx.config.items = (o.items || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    ctx.config.intervalMin = Math.max(1, Number(o.intervalMin) || 30);
    ctx.config.onHour = o.onHour === true;
    ctx.config.onHalf = o.onHalf === true;
    ctx.config.hourlyText = (o.hourlyText || []).reduce(function (acc, s) { return acc.concat(String(s).split('|')); }, []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    ctx.config.interruptHourly = o.interruptHourly === true;
    const n = normalizeSpecials(o.specials || []);
    ctx.config.specials = n.out;
    // 间隔变化即时生效
    if (stopInterval) stopInterval();
    if (ctx.config.items.length) {
      const min = Math.max(1, Number(ctx.config.intervalMin) || 30);
      stopInterval = ctx.events.every(min * 60000, showNext);
    }
    return { ok: true, items: ctx.config.items.length, specials: n.out.length, deduped: n.deduped, intervalMin: ctx.config.intervalMin, onHour: ctx.config.onHour, onHalf: ctx.config.onHalf, interruptHourly: ctx.config.interruptHourly };
  }
  function testFire(input) {
    if (input && typeof input === 'object' && input.type) {
      const cfg = ctx.config;
      if (input.type === 'hour') return { ok: fireLines(cfg.hourlyText || [], cfg.interruptHourly, '整点播报测试') };
      if (input.type === 'special' && input.index !== undefined) {
        const s = (ctx.config.specials || [])[Number(input.index)];
        if (s) return { ok: fireLines(s.text, !!s.interrupt, '特殊公告测试') };
        return { ok: false, error: '索引越界' };
      }
    }
    return { ok: false, error: '未知测试类型' };
  }
  return {
    apply: function () {
      const min = Math.max(1, Number(ctx.config.intervalMin) || 30);
      if (items().length) stopInterval = ctx.events.every(min * 60000, showNext);
      stopMinute = ctx.events.every(15000, minuteCheck);
    },
    dispose: function () { if (stopInterval) stopInterval(); if (stopMinute) stopMinute(); },
    importRows: importRows,
    api: { getRows: getRows, saveRows: saveRows, saveAll: saveAll, testFire: testFire },
    panel: {
      title: '定时公告设置',
      html: function (cfg) {
        const intr = cfg.interruptHourly ? 'checked' : '';
        return '<div class="sub">常规公告(每行一条, 按顺序轮播):</div>' +
          '<textarea id="sbItems" rows="3" style="width:100%">' + ((cfg.items || []).join('\n')) + '</textarea>' +
          '<div class="row" style="margin-top:6px"><span style="font-size:13px">间隔(分钟):</span><input id="sbInterval" type="number" min="1" value="' + (cfg.intervalMin || 30) + '" style="width:60px"></div>' +
          '<div class="sub" style="margin-top:12px">整点/半点播报:</div>' +
          '<div class="row" style="margin-top:6px">' +
          '<label style="font-size:13px;margin-right:14px"><input type="checkbox" id="sbOnHour" ' + (cfg.onHour ? 'checked' : '') + '> 整点触发</label>' +
          '<label style="font-size:13px"><input type="checkbox" id="sbOnHalf" ' + (cfg.onHalf ? 'checked' : '') + '> 半点触发</label>' +
          '</div>' +
          '<div class="sub" style="margin-top:6px">播报内容(多条用 | 分隔):</div>' +
          '<textarea id="sbHourly" rows="2" style="width:100%">' + ((cfg.hourlyText || []).join('|')) + '</textarea>' +
          '<div class="row" style="margin-top:6px">' +
          '<label style="font-size:13px"><input type="checkbox" id="sbHourIntr" ' + intr + '> 触发时中断其它功能(高优先级强制显示)</label>' +
          '<button class="small" style="background:#55606e;margin-left:auto" onclick="sbTestFire(' + "'hour'" + ')">立即测试播报</button>' +
          '</div>' +
          '<div class="sub" style="margin-top:14px">特殊公告(指定日期时间各触发一次; 错过不补发):</div>' +
          '<div class="row" style="margin-top:8px">' +
          '<button class="small" onclick="sbAddRow()">添加一行</button>' +
          '<button class="small" onclick="sbSaveAll()">保存全部</button>' +
          '<button class="small" style="background:#55606e" onclick="sbExportXlsx()">导出特殊公告</button>' +
          '<button class="small" style="background:#55606e" onclick="window.open(\'/api/plugins/asset?id=scheduled-board&file=特殊公告模板.xlsx\', \'_blank\')">下载 Excel 模板</button>' +
          '<button class="small" style="background:#55606e" onclick="plgPickXlsx()">从 Excel 导入</button>' +
          '</div>' +
          '<table style="margin-top:8px"><thead><tr><th>日期时间(YYYY-MM-DD HH:mm)</th><th>公告内容(多条用 | 分隔)</th><th>中断其它功能</th><th></th></tr></thead><tbody id="sbSpecTb"></tbody></table>' +
          '<div class="sub" id="sbMsg" style="margin-top:8px;color:#3ddc84"></div>' +
          '<input id="fwFile" type="file" accept=".xlsx" style="display:none" onchange="plgImportXlsx(this.files[0])">';
      }
    }
  };
};

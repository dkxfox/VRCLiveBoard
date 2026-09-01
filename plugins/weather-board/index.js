'use strict';
// 官方可选插件: 天气播报 v1.0 —— Open-Meteo 主源 + wttr.in 降级, 城市批量管理 + 轮巡
module.exports = function (ctx) {
  let idx = 0;
  let stopTimer = null;
  const cache = {}; // key -> {data, at}

  const PRESETS = {
    cn: [
      ['北京', 39.90, 116.40], ['上海', 31.23, 121.47], ['广州', 23.13, 113.26], ['深圳', 22.55, 114.06], ['成都', 30.57, 104.07],
      ['重庆', 29.56, 106.55], ['杭州', 30.27, 120.15], ['武汉', 30.59, 114.31], ['西安', 34.34, 108.94], ['南京', 32.06, 118.80],
      ['天津', 39.08, 117.20], ['苏州', 31.30, 120.58], ['郑州', 34.75, 113.63], ['长沙', 28.23, 112.94], ['沈阳', 41.80, 123.43],
      ['青岛', 36.07, 120.38], ['大连', 38.91, 121.61], ['宁波', 29.87, 121.55], ['厦门', 24.48, 118.09], ['福州', 26.07, 119.30],
      ['昆明', 25.04, 102.71], ['贵阳', 26.65, 106.63], ['济南', 36.65, 117.12], ['合肥', 31.82, 117.23], ['石家庄', 38.04, 114.51],
      ['哈尔滨', 45.80, 126.53], ['长春', 43.82, 125.32], ['南昌', 28.68, 115.86], ['南宁', 22.82, 108.32], ['海口', 20.04, 110.34],
      ['太原', 37.87, 112.55], ['兰州', 36.06, 103.83], ['乌鲁木齐', 43.83, 87.62], ['呼和浩特', 40.84, 111.75], ['银川', 38.49, 106.23],
      ['西宁', 36.62, 101.78], ['拉萨', 29.65, 91.14], ['无锡', 31.49, 120.31], ['佛山', 23.02, 113.12], ['东莞', 23.02, 113.75],
      ['珠海', 22.27, 113.58], ['温州', 28.00, 120.70], ['泉州', 24.87, 118.68], ['常州', 31.81, 119.97], ['南通', 31.98, 120.89], ['徐州', 34.26, 117.19]
    ],
    world: [
      ['东京', 35.68, 139.69], ['首尔', 37.57, 126.98], ['新加坡', 1.35, 103.82], ['曼谷', 13.76, 100.50], ['吉隆坡', 3.14, 101.69],
      ['悉尼', -33.87, 151.21], ['墨尔本', -37.81, 144.96], ['奥克兰', -36.85, 174.76], ['伦敦', 51.51, -0.13], ['巴黎', 48.86, 2.35],
      ['柏林', 52.52, 13.41], ['莫斯科', 55.76, 37.62], ['纽约', 40.71, -74.01], ['洛杉矶', 34.05, -118.24], ['旧金山', 37.77, -122.42],
      ['西雅图', 47.61, -122.33], ['芝加哥', 41.88, -87.63], ['多伦多', 43.65, -79.38], ['温哥华', 49.28, -123.12], ['迪拜', 25.20, 55.27],
      ['香港', 22.32, 114.17], ['台北', 25.03, 121.57], ['澳门', 22.20, 113.55], ['马德里', 40.42, -3.70], ['罗马', 41.90, 12.50],
      ['阿姆斯特丹', 52.37, 4.90], ['苏黎世', 47.38, 8.54], ['圣保罗', -23.55, -46.63], ['墨西哥城', 19.43, -99.13], ['孟买', 19.08, 72.88],
      ['新德里', 28.61, 77.21], ['伊斯坦布尔', 41.01, 28.98]
    ]
  };
  const WMO = {
    0: ['晴', '☀️'], 1: ['基本晴', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
    45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
    51: ['毛毛雨', '🌦️'], 53: ['小雨', '🌦️'], 55: ['中雨', '🌧️'],
    61: ['小雨', '🌧️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'], 66: ['冻雨', '🌧️'], 67: ['冻雨', '🌧️'],
    71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '❄️'],
    80: ['阵雨', '🌦️'], 81: ['强阵雨', '🌧️'], 82: ['暴雨', '⛈️'],
    85: ['阵雪', '🌨️'], 86: ['强阵雪', '❄️'],
    95: ['雷暴', '⛈️'], 96: ['雷暴冰雹', '⛈️'], 99: ['雷暴冰雹', '⛈️']
  };
  function emojiFor(desc) {
    const s = String(desc || '').toLowerCase();
    if (/thunder|雷/.test(s)) return '⛈️';
    if (/snow|雪/.test(s)) return '🌨️';
    if (/rain|drizzle|shower|雨/.test(s)) return '🌧️';
    if (/fog|mist|雾/.test(s)) return '🌫️';
    if (/overcast|阴/.test(s)) return '☁️';
    if (/cloud|多云|云/.test(s)) return '⛅';
    return '☀️';
  }
  function cities() {
    return (ctx.config.cities || []).filter(function (c) { return c && c.name && c.lat != null; });
  }
  async function fetchOpenMeteo(city) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + city.lat + '&longitude=' + city.lon +
      '&current=temperature_2m,apparent_temperature,weather_code' +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=2';
    const r = await ctx.http.request(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const cur = j.current || {};
    const daily = j.daily || {};
    const c = WMO[cur.weather_code] || ['未知', '🌡️'];
    const d = WMO[(daily.weather_code || [])[1]] || null;
    return {
      temp: Math.round(Number(cur.temperature_2m) || 0),
      feel: Math.round(Number(cur.apparent_temperature) || 0),
      desc: c[0], emoji: c[1],
      tmin: d && daily.temperature_2m_min ? Math.round(Number(daily.temperature_2m_min[1])) : null,
      tmax: d && daily.temperature_2m_max ? Math.round(Number(daily.temperature_2m_max[1])) : null,
      tdesc: d ? d[0] : '', temoji: d ? d[1] : '',
      src: 'open-meteo'
    };
  }
  async function fetchWttr(name) {
    const r = await ctx.http.request('https://wttr.in/' + encodeURIComponent(name) + '?format=j1', { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const c = (j.current_condition || [])[0] || {};
    const desc = (c.weatherDesc && c.weatherDesc[0] && c.weatherDesc[0].value) || '';
    return { temp: Math.round(Number(c.temp_C) || 0), feel: Math.round(Number(c.FeelsLikeC) || 0), desc: desc, emoji: emojiFor(desc), tmin: null, tmax: null, tdesc: '', temoji: '', src: 'wttr' };
  }
  async function getWeather(city) {
    const key = city.name + '|' + city.lat + ',' + city.lon;
    const hit = cache[key];
    if (hit && Date.now() - hit.at < 15 * 60000) return hit.data;
    let data = null;
    try { data = await fetchOpenMeteo(city); } catch (e) {
      ctx.logger.warn('[天气] Open-Meteo 失败(' + city.name + '): ' + e.message + ', 降级 wttr.in');
      try { data = await fetchWttr(city.name); } catch (e2) {
        ctx.logger.warn('[天气] wttr.in 也失败(' + city.name + '): ' + e2.message);
        if (hit) return hit.data; // 有旧缓存则兜底
        throw e2;
      }
    }
    cache[key] = { data: data, at: Date.now() };
    return data;
  }
  function render(city, d) {
    let s = (ctx.config.prefix !== undefined ? String(ctx.config.prefix) : '【天气】') + city.name + ' ' + d.temp + '°C ' + d.desc + d.emoji + ' 体感' + d.feel + '°';
    if (d.tmax != null) s += ' | 明天 ' + d.tmin + '~' + d.tmax + '° ' + d.tdesc + d.temoji;
    if (d.src === 'wttr') s += '(备用源)';
    return s;
  }
  async function showNext(force) {
    const list = cities().filter(function (c) { return c.enabled !== false; });
    if (!list.length) return { ok: false, error: '没有启用的城市' };
    const city = list[idx % list.length];
    idx = (idx + 1) % list.length;
    try {
      const d = await getWeather(city);
      const text = render(city, d);
      ctx.chatbox.send(text, { priority: 70, ttlMs: Math.max(8000, (Number(ctx.config.displaySec) || 60) * 1000), force: !!force });
      return { ok: true, text: text };
    } catch (e) {
      ctx.logger.warn('[天气] 获取失败(' + city.name + '): ' + e.message);
      return { ok: false, error: city.name + ' 获取失败: ' + e.message };
    }
  }
  async function geocode(name) {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) + '&count=1&language=zh&format=json';
    const r = await ctx.http.request(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const hit = (j.results || [])[0];
    if (!hit) throw new Error('未找到该城市');
    return { name: String(hit.name || name), lat: hit.latitude, lon: hit.longitude };
  }
  function normalizeRows(rows) {
    let start = 0;
    if (rows && rows[0] && String(rows[0][0] || '').indexOf('城市') >= 0) start = 1;
    const seen = new Set();
    const out = [];
    let deduped = 0;
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = String(r[0] || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) { deduped++; continue; }
      seen.add(key);
      const en = String(r[1] === undefined || r[1] === null ? '' : r[1]).toLowerCase();
      out.push({ name: name, enabled: !(en === '否' || en === 'no' || en === 'false' || en === '0') });
    }
    return { out: out, deduped: deduped };
  }
  async function saveRows(input) {
    if (input && typeof input === 'object' && Array.isArray(input.rows)) input = input.rows;
    const n = normalizeRows(input);
    const result = [];
    const failed = [];
    for (const row of n.out) {
      const old = (ctx.config.cities || []).find(function (c) { return String(c.name || '').toLowerCase() === row.name.toLowerCase(); });
      if (old && old.lat != null) { result.push({ name: old.name, lat: old.lat, lon: old.lon, enabled: row.enabled }); continue; }
      try {
        const g = await geocode(row.name);
        result.push({ name: g.name, lat: g.lat, lon: g.lon, enabled: row.enabled });
      } catch (e) { failed.push(row.name); }
    }
    ctx.config.cities = result;
    if (result.some(function (c) { return c.enabled !== false; })) setTimeout(function () { showNext(false); }, 1200);
    return { ok: true, count: result.length, deduped: n.deduped, failed: failed };
  }
  function getRows() {
    return cities().map(function (c) { return { name: c.name, enabled: c.enabled !== false }; });
  }
  function importRows(rows) { return saveRows(rows); }
  function rebuildTimer() {
    if (stopTimer) stopTimer();
    if (ctx.config.continuous) {
      stopTimer = ctx.events.every(Math.max(10, (Number(ctx.config.displaySec) || 60)) * 1000, function () { showNext(false); });
    } else {
      stopTimer = ctx.events.every(Math.max(1, Number(ctx.config.intervalMin) || 15) * 60000, function () { showNext(false); });
    }
  }
  function saveConfig(input) {
    if (input && typeof input === 'object' && input.args) input = input.args;
    const o = input || {};
    ctx.config.intervalMin = Math.max(1, Number(o.intervalMin) || 15);
    ctx.config.displaySec = Math.min(300, Math.max(10, Number(o.displaySec) || 60));
    ctx.config.continuous = o.continuous === true;
    if (o.prefix !== undefined) ctx.config.prefix = String(o.prefix);
    rebuildTimer();
    return { ok: true, intervalMin: ctx.config.intervalMin, displaySec: ctx.config.displaySec, continuous: ctx.config.continuous, prefix: ctx.config.prefix };
  }
  function testCity(input) {
    if (input && typeof input === 'object' && input.args) input = input.args;
    const list = cities().filter(function (c) { return c.enabled !== false; });
    const i = input && input.index !== undefined ? Number(input.index) : (idx + list.length - 1) % list.length;
    const city = list[i];
    if (!city) return { ok: false, error: '没有可用城市' };
    return getWeather(city).then(function (d) {
      const text = render(city, d);
      ctx.chatbox.send(text, { priority: 95, ttlMs: 15000, force: true });
      return { ok: true, text: text };
    }).catch(function (e) { return { ok: false, error: String(e.message) }; });
  }
  return {
    apply: function () {
      rebuildTimer();
      if (cities().some(function (c) { return c.enabled !== false; })) setTimeout(function () { showNext(false); }, 3000);
    },
    dispose: function () { if (stopTimer) stopTimer(); },
    importRows: importRows,
    api: { getRows: getRows, saveRows: saveRows, saveConfig: saveConfig, testCity: testCity, addPresets: function (input) {
      if (input && typeof input === 'object' && input.args) input = input.args;
      const kind = (input && input.kind === 'world') ? 'world' : 'cn';
      const list = PRESETS[kind] || [];
      const cur = ctx.config.cities = ctx.config.cities || [];
      let added = 0;
      for (const p of list) {
        if (cur.some(function (c) { return String(c.name || '').toLowerCase() === p[0].toLowerCase(); })) continue;
        cur.push({ name: p[0], lat: p[1], lon: p[2], enabled: false });
        added++;
      }
      return { ok: true, added: added, total: cur.length, kind: kind };
    } },
    panel: {
      title: '天气播报设置',
      html: function (cfg) {
        const contChk = cfg.continuous ? 'checked' : '';
        return '<div class="sub">城市列表(中文名, 如 上海/东京):</div>' +
          '<div class="row" style="margin-top:8px">' +
          '<button class="small" onclick="wxAddPresets(' + "'cn'" + ')">一键添加全国主要城市</button>' +
          '<button class="small" onclick="wxAddPresets(' + "'world'" + ')">一键添加全球主要城市</button>' +
          '</div>' +
          '<div class="sub" style="margin-top:6px">(预设城市默认停用, 勾选你想播报的即可)</div>' +
          '<div class="row" style="margin-top:8px">' +
          '<button class="small" onclick="wxAddRow()">添加一行</button>' +
          '<button class="small" onclick="wxSaveAll()">保存全部</button>' +
          '<button class="small" style="background:#55606e" onclick="wxCheckAll(true)">全部启用</button>' +
          '<button class="small" style="background:#55606e" onclick="wxCheckAll(false)">全部停用</button>' +
          '<button class="small" style="background:#55606e" onclick="wxExportXlsx()">导出城市列表</button>' +
          '<button class="small" style="background:#55606e" onclick="window.open(\'/api/plugins/asset?id=weather-board&file=天气城市模板.xlsx\', \'_blank\')">下载 Excel 模板</button>' +
          '<button class="small" style="background:#55606e" onclick="plgPickXlsx()">从 Excel 导入</button>' +
          '</div>' +
          '<div class="row" style="margin-top:8px"><span style="font-size:13px">播报前缀:</span><input id="wxPrefix" type="text" value="' + (cfg.prefix !== undefined ? cfg.prefix : '【天气】') + '" style="width:80px"><span style="font-size:13px;margin-left:12px">轮巡间隔(分钟):</span><input id="wxInterval" type="number" min="1" value="' + (cfg.intervalMin || 15) + '" style="width:60px"><span style="font-size:13px;margin-left:12px">每次显示(秒):</span><input id="wxDisplay" type="number" min="10" max="300" value="' + (cfg.displaySec || 60) + '" style="width:60px"></div>' +
          '<div class="row" style="margin-top:6px"><label style="font-size:13px"><input type="checkbox" id="wxContinuous" ' + contChk + '> 连续循环播报(每"显示秒"换下一个城市, 不停歇)</label></div>' +
          '<table style="margin-top:8px"><thead><tr><th>城市名</th><th>启用</th><th></th></tr></thead><tbody id="wxRowsTb"></tbody></table>' +
          '<div class="sub" id="wxMsg" style="margin-top:8px;color:#3ddc84"></div>' +
          '<input id="fwFile" type="file" accept=".xlsx" style="display:none" onchange="plgImportXlsx(this.files[0])">';
      }
    }
  };
};

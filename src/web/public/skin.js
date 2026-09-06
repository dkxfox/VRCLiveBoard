'use strict';
// ===== 皮肤判定: 农历 + 节气 + 特殊彩蛋 + 节日 + 季节 =====
window.VRCB_SKIN = (function () {
  var LUNAR = [19416,19168,42352,21717,53856,55632,91476,22176,39632,21970,19168,42422,42192,53840,119381,46400,54944,44450,38320,84343,18800,42160,46261,27216,27968,109396,11104,38256,21234,18800,25958,54432,59984,28309,23248,11104,100067,37600,116951,51536,54432,120998,46416,22176,107956,9680,37584,53938,43344,46423,27808,46416,86869,19872,42416,83315,21168,43432,59728,27296,44710,43856,19296,43748,42352,21088,62051,55632,23383,22176,38608,19925,19152,42192,54484,53840,54616,46400,46752,103846,38320,18864,43380,42160,45690,27216,27968,44870,43872,38256,19189,18800,25776,29859,59984,27480,23232,43872,38613,37600,51552,55636,54432,55888,30034,22176,43959,9680,37584,51893,43344,46240,47780,44368,21977,19360,42416,86390,21168,43312,31060,27296,44368,23378,19296,42726,42208,53856,60005,54576,23200,30371,38608,19195,19152,42192,118966,53840,54560,56645,46496,22224,21938,18864,42359,42160,43600,111189,27936,44448,84835,37744,18936,18800,25776,92326,59984,27424,108228,43744,37600,53987,51552,54615,54432,55888,23893,22176,42704,21972,21200,43448,43344,46240,46758,44368,21920,43940,42416,21168,45683,26928,29495,27296,44368,84821,19296,42352,21732,53600,59752,54560,55968,92838,22224,19168,43476,41680,53584,62034,54560];
  function leapMonth(y) { var v = LUNAR[y - 1900] & 0xf; return v === 0xf ? 0 : v; }
  function leapDays(y) { if (leapMonth(y)) return (LUNAR[y - 1900] & 0x10000) ? 30 : 29; return 0; }
  function yearDays(y) { var s = 348, i; for (i = 0x8000; i > 0x8; i >>= 1) s += (LUNAR[y - 1900] & i) ? 1 : 0; return s + leapDays(y); }
  function monthDays(y, m) { return (LUNAR[y - 1900] & (0x10000 >> m)) ? 30 : 29; }
  // 公历 -> 农历(月/日/是否闰月)
    function solar2lunar(y, m, d) {
    if (y < 1900 || y > 2100) return { lMonth: 0, lDay: 0, isLeap: false };
    var offset = (Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000;
    var temp = 0, i;
    for (i = 1900; i < 2101 && offset > 0; i++) { temp = yearDays(i); offset -= temp; }
    if (offset < 0) { offset += temp; i--; }
    var year = i, leap = leapMonth(year), isLeap = false;
    for (i = 1; i < 13 && offset > 0; i++) {
      if (leap > 0 && i === (leap + 1) && isLeap === false) { --i; isLeap = true; temp = leapDays(year); }
      else { temp = monthDays(year, i); }
      if (isLeap === true && i === (leap + 1)) isLeap = false;
      offset -= temp;
    }
    if (offset === 0 && leap > 0 && i === leap + 1) { if (isLeap) { isLeap = false; } else { isLeap = true; --i; } }
    if (offset < 0) { offset += temp; --i; }
    return { lMonth: i, lDay: offset + 1, isLeap: isLeap };
  }
    // 节气日期(近似, 误差<=1天): 小寒约1/6起, 每节气约15.2184天
  function termDate(year, idx) {
    var base = new Date(Date.UTC(year, 0, 6) + idx * 15.2184 * 86400000);
    return { m: base.getUTCMonth() + 1, d: base.getUTCDate() };
  }
  // 立春=2 立夏=8 立秋=14 立冬=20
  function seasonOf(month, day, year) {
    var t = [termDate(year, 2), termDate(year, 8), termDate(year, 14), termDate(year, 20)];
    var seasons = ['春', '夏', '秋', '冬'];
    var cur = month * 100 + day;
    for (var i = 0; i < 4; i++) { var s = t[i].m * 100 + t[i].d; for (var k = 0; k < 4; k++) { if (cur === s + k) return seasons[i]; } }
    return null;
  }
  function resolve(dateStr, specials, lang) {
    var y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7), d = +dateStr.slice(8, 10);
    var mmdd = dateStr.slice(5, 10);
    // ① 特殊彩蛋(多条目)
    if (Array.isArray(specials)) for (var i = 0; i < specials.length; i++) { var s = specials[i]; if (s && s.date === mmdd) return { type: 'special', video: s.video, title: s.title }; }
    // ② 节日(农历 + 固定)
    var ln = solar2lunar(y, m, d);
    if (ln.lMonth === 0) { /* 超出农历表范围, 跳过农历节日 */ }
    else if (ln.lMonth === 1 && ln.lDay === 1) return { type: 'festival', name: '春节', c1: '#ff4d4d', c2: '#ffd54d', greet: '🧧 新年快乐', deco: '🏮' };
    else if (ln.lMonth === 1 && ln.lDay === 15) return { type: 'festival', name: '元宵', c1: '#fb7185', c2: '#fbbf24', greet: '🏮 元宵快乐', deco: '🏮' };
    else if (ln.lMonth === 8 && ln.lDay === 15) return { type: 'festival', name: '中秋', c1: '#f5c518', c2: '#ff8c42', greet: '🥮 中秋快乐', deco: '🥮' };
    var L = lang || 'zh-CN';
    var FIX = [['1','1','元旦','#f59e0b','#60a5fa','🕛 元旦快乐','🎆',null],['10','1','国庆','#ff5b5b','#f5c518','🎆 国庆快乐','🎆','zh-CN'],['12','25','圣诞','#2fbf71','#e2405b','🎄 圣诞快乐','🎄',null],['10','31','万圣节','#ff8c00','#c084fc','🎃 万圣节快乐','🎃',null]];
    for (var j = 0; j < FIX.length; j++) { var f = FIX[j]; if (f[7] && L !== f[7]) continue; if (f[0] === String(m) && f[1] === String(d)) return { type: 'festival', name: f[2], c1: f[3], c2: f[4], greet: f[5], deco: f[6] }; }
    // ③ 季节: 仅节气日+此后3天; 平时=日常(返回 null)
    var seas = seasonOf(m, d, y);
    if (seas) {
      var SEA = { '春': ['#34d399', '#f9a8d4', '春色满园', '🌸'], '夏': ['#38bdf8', '#86efac', '夏日浓荫', '☀️'], '秋': ['#f59e0b', '#f87171', '秋意渐浓', '🍂'], '冬': ['#60a5fa', '#e0f2fe', '冬日暖阳', '❄️'] };
      var se = SEA[seas];
      return { type: 'season-term', season: seas, c1: se[0], c2: se[1], greet: se[2], deco: se[3] };
    }
    return null;
  }
  return { solar2lunar: solar2lunar, resolve: resolve };
})();
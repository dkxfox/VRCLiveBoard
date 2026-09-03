'use strict';
// 官方可选插件: 网易云歌词 v1.1.3 —— 优先用 CDP 直读网易云客户端精确进度+歌名(拖动/暂停/手动点歌全同步),
// 连不上 CDP 时回退: SMTC 进度(其它播放器) -> 本地时钟估算。
const { CdpClient } = require('./cdp.js');
module.exports = function (ctx) {
  let stopTimer = null;
  let cdp = null;
  let timeline = [];
  let songKey = '';
  let lastLineKey = '';
  let lastFailAt = 0;
  // 网易云不上报 SMTC 进度(实测 PlaybackInfo.position 与 TimelineProperties 恒为 0), 用本地时钟估算
  const est = { startAt: 0, pausedAt: 0, pausedAcc: 0, lastStatus: 4 };
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
  // 兼容旧代码: 保存 cdpPort 默认值
  ctx.config.cdpPort = ctx.config.cdpPort || 9234;
  const HDRS = { 'User-Agent': UA, 'Referer': 'https://music.163.com/' };

  function mediaState() {
    try { return (ctx.media && ctx.media.state) ? ctx.media.state() : null; } catch (e) { return null; }
  }
  async function fetchLyrics(title, artist) {
    const kw = encodeURIComponent(((artist ? artist + ' ' : '') + title).slice(0, 80));
    const s = await ctx.http.request('https://music.163.com/api/search/get?s=' + kw + '&type=1&limit=5&offset=0', { headers: HDRS, signal: AbortSignal.timeout(20000) });
    const sj = await s.json();
    const songs = (sj.result && sj.result.songs) || [];
    if (!songs.length) throw new Error('未搜索到歌曲');
    let best = songs[0];
    for (const x of songs) { if (String(x.name || '').toLowerCase().indexOf(title.toLowerCase()) >= 0) { best = x; break; } }
    const l = await ctx.http.request('https://music.163.com/api/song/lyric?id=' + best.id + '&lv=1&kv=1&tv=-1', { headers: HDRS, signal: AbortSignal.timeout(20000) });
    const lj = await l.json();
    return { lrc: (lj.lrc && lj.lrc.lyric) || '', tlyric: (lj.tlyric && lj.tlyric.lyric) || '', name: best.name };
  }
  function parseLrc(raw, isTrans) {
    const out = [];
    for (const line of String(raw || '').split(/\r?\n/)) {
      const re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
      const stamps = [];
      let m;
      while ((m = re.exec(line)) !== null) stamps.push((+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? (+m[3].padEnd(3, '0').slice(0, 3)) : 0));
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!text) continue;
      for (const t of stamps) out.push({ t: t, text: text, trans: !!isTrans });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }
  function buildTimeline(lrc, tlyric) {
    const byTime = {};
    for (const x of parseLrc(lrc, false)) {
      byTime[x.t] = byTime[x.t] || {};
      byTime[x.t].orig = byTime[x.t].orig ? byTime[x.t].orig + ' ' + x.text : x.text;
    }
    for (const x of parseLrc(tlyric, true)) {
      byTime[x.t] = byTime[x.t] || {};
      byTime[x.t].trans = byTime[x.t].trans ? byTime[x.t].trans + ' ' + x.text : x.text;
    }
    return Object.keys(byTime).map(Number).sort(function (a, b) { return a - b; }).map(function (t) {
      return { t: t, orig: byTime[t].orig || '', trans: byTime[t].trans || '' };
    });
  }
  function lineAt(posMs) {
    let cur = null;
    for (const e of timeline) { if (e.t <= posMs) cur = e; else break; }
    return cur;
  }
  async function tick() {
    const st = mediaState();
    if (!st || !st.enabled) return;
    const d = st.data;
    if (!d || !d.title) return;
    const source = String(d.source || '').toLowerCase();
    const isNetease = !source || source.indexOf('cloudmusic') >= 0 || source.indexOf('netease') >= 0;
    if (!ctx.config.allowOtherPlayers && !isNetease) return;
    const title = String(d.title);
    const artist = String(d.artist || '');
    // v1.1.1: 点播放列表手动换歌时客户端不更新 SMTC 标题 —— 用 CDP 直读的客户端歌名做第一信号
    const cdpTitle = (isNetease && cdp && cdp.fresh && cdp.pos.title) ? String(cdp.pos.title) : '';
    const detTitle = cdpTitle || title;
    const key = detTitle + '|' + artist;
    const status = (Number(d.status) === 4) ? 4 : 5;
    if (key !== songKey) {
      songKey = key;
      est.startAt = Date.now(); est.pausedAt = 0; est.pausedAcc = 0; est.lastStatus = status;
      const fetchKey = key;
      try {
        const r = await fetchLyrics(detTitle, artist);
        if (songKey !== fetchKey) return; // 竞态防护: 抓歌词期间又换了歌, 丢弃旧结果
        timeline = buildTimeline(r.lrc, r.tlyric);
        lastLineKey = '';
        ctx.logger.info('[网易云歌词] 获取 ' + r.name + ' 歌词 ' + timeline.length + ' 行(译文 ' + (r.tlyric ? '有' : '无') + '; 识别来源 ' + (cdpTitle ? 'CDP歌名' : 'SMTC') + ')');
      } catch (e) {
        if (songKey !== fetchKey) return;
        timeline = [];
        if (Date.now() - lastFailAt > 60000) { ctx.logger.warn('[网易云歌词] 获取失败: ' + e.message); lastFailAt = Date.now(); }
      }
    } else {
      // 时钟估算: 播放推进 / 暂停冻结
      if (status === 4 && est.lastStatus !== 4) { if (est.pausedAt) est.pausedAcc += Date.now() - est.pausedAt; est.pausedAt = 0; }
      else if (status !== 4 && est.lastStatus === 4) { est.pausedAt = Date.now(); }
      est.lastStatus = status;
    }
    if (!timeline.length) return;
    // 位置来源优先级: CDP(精确, 含拖动) > SMTC position(其它播放器) > 本地时钟
    let pos = 0;
    if (isNetease && cdp && cdp.fresh && cdp.pos.posMs > 0) pos = cdp.pos.posMs;
    else pos = Number(d.position_ms) || 0;
    if (pos <= 0) {
      if (status === 4) pos = Math.max(0, Date.now() - est.startAt - est.pausedAcc);
      else if (est.pausedAt) pos = Math.max(0, est.pausedAt - est.startAt - est.pausedAcc);
    }
    const cur = lineAt(pos);
    if (!cur) return;
    const lk = cur.t + '|' + cur.orig;
    if (lk === lastLineKey) return;
    lastLineKey = lk;
    sendLine(cur, pos, false);
  }
  function sendLine(cur, pos, force) {
    let text = '';
    if (ctx.config.showTitle !== false) text += '♪ ' + (songKey || '').split('|')[0].slice(0, 34) + '\n';
    text += '♫ ' + cur.orig.slice(0, 54);
    if (ctx.config.showTranslation !== false && cur.trans) text += '\n' + '✎ ' + cur.trans.slice(0, 54);
    let ttl = Math.max(4000, (Number(ctx.config.updateSec) || 4) * 1000);
    if (ctx.config.rhythmMode) {
      // 歌词节奏模式: 每句显示到下一句开始(上下限 3~30 秒)
      let nextT = null;
      for (const e of timeline) { if (e.t > cur.t) { nextT = e.t; break; } }
      const dur = nextT ? (nextT - cur.t) : ttl;
      ttl = Math.min(30000, Math.max(3000, dur));
    }
    const prio = Math.min(999, Math.max(-999, Number(ctx.config.priority) || 35));
    ctx.chatbox.send(text, { priority: prio, ttlMs: ttl, force: !!force });
  }
  function status() {
    const c = cdp ? { ok: cdp.fresh, posMs: cdp.pos.posMs, durMs: cdp.pos.durMs, title: cdp.pos.title || '', port: cdp.port } : { ok: false, port: ctx.config.cdpPort || 9234 };
    return { songKey: songKey, lines: timeline.length, playing: mediaState() ? !!((mediaState().data || {}).title) : false, cdp: c };
  }
  function saveConfig(input) {
    if (input && typeof input === 'object' && input.args) input = input.args;
    const o = input || {};
    ctx.config.updateSec = Math.min(30, Math.max(3, Number(o.updateSec) || 4));
    ctx.config.showTranslation = o.showTranslation !== false;
    ctx.config.allowOtherPlayers = o.allowOtherPlayers === true;
    ctx.config.rhythmMode = o.rhythmMode === true;
    ctx.config.showTitle = o.showTitle !== false;
    ctx.config.priority = Math.min(999, Math.max(-999, Math.round(Number(o.priority) || 35)));
    ctx.config.cdpPort = Math.min(65535, Math.max(1024, Math.round(Number(o.cdpPort) || 9234)));
    if (o.cloudExe !== undefined) ctx.config.cloudExe = String(o.cloudExe || '').trim();
    return { ok: true, updateSec: ctx.config.updateSec, showTranslation: ctx.config.showTranslation, allowOtherPlayers: ctx.config.allowOtherPlayers, rhythmMode: ctx.config.rhythmMode, showTitle: ctx.config.showTitle, priority: ctx.config.priority, cdpPort: ctx.config.cdpPort, cloudExe: ctx.config.cloudExe || '' };
  }
  // 首次启用自动部署: CDP 连不上(客户端没带调试端口)时, 自动在桌面创建启动器快捷方式
  function ensureCdpShortcut() {
    try {
      const fs = require('fs'); const os = require('os'); const path = require('path');
      const bat = path.join(__dirname, '启动网易云-CDP.bat');
      if (!fs.existsSync(bat)) return;
      const desktops = [path.join(os.homedir(), 'Desktop')];
      if (process.env.USERPROFILE) {
        const od = path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop');
        if (fs.existsSync(od)) desktops.unshift(od);
      }
      let lnk = null;
      for (const d of desktops) {
        if (!fs.existsSync(d)) continue;
        lnk = path.join(d, '网易云音乐-歌词同步.lnk');
        break;
      }
      if (!lnk || fs.existsSync(lnk)) return;
      const { spawn } = require('child_process');
      const ps = "$w=New-Object -ComObject WScript.Shell; $l=$w.CreateShortcut($env:VRCB_LNK); $l.TargetPath=$env:VRCB_BAT; $l.WorkingDirectory=$env:VRCB_DIR; $l.Description='VRCLiveBoard netease lyrics CDP launcher'; $l.Save()";
      spawn('powershell', ['-NoProfile', '-Command', ps], {
        env: Object.assign({}, process.env, { VRCB_LNK: lnk, VRCB_BAT: bat, VRCB_DIR: __dirname }),
        stdio: 'ignore', windowsHide: true
      });
      ctx.logger.info('[网易云歌词] 首次使用: 已在桌面创建"网易云音乐-歌词同步"快捷方式, 用它启动网易云即可精确同步');
    } catch (e) {}
  }
  // 一键用调试端口启动网易云: 检测 → 退出旧实例 → 带端口重启 → 验证 → 重连 CDP
  // v1.1.3: 智能查找安装路径(手动配置 > 运行中进程实际路径 > 注册表卸载信息 > 默认目录), 兼容自定义安装目录
  function psOut(cmd) {
    try {
      return require("child_process").execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true, encoding: "utf8", timeout: 15000 }).trim();
    } catch (e) { return ""; }
  }
  async function findCloudExe() {
    const fsx = require("fs");
    if (ctx.config.cloudExe) { const m = String(ctx.config.cloudExe).trim(); if (fsx.existsSync(m)) return m; }
    const running = psOut("(Get-Process cloudmusic -ErrorAction SilentlyContinue | Select-Object -First 1).Path");
    if (running && fsx.existsSync(running)) return running;
    const reg = psOut("Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '网易云|CloudMusic|Netease' } | ForEach-Object { if ($_.InstallLocation) { Join-Path $_.InstallLocation 'cloudmusic.exe' } elseif ($_.DisplayIcon) { ($_.DisplayIcon -replace '\"','' -replace ',\\d+$','') } } | Where-Object { Test-Path $_ } | Select-Object -First 1");
    if (reg && fsx.existsSync(reg)) return reg;
    const cands = ["C:\\Program Files\\Netease\\CloudMusic\\cloudmusic.exe", "C:\\Program Files (x86)\\Netease\\CloudMusic\\cloudmusic.exe"];
    for (const c of cands) { if (fsx.existsSync(c)) return c; }
    return null;
  }
  function sleepMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function cdpPortUp() {
    try { await fetch("http://127.0.0.1:" + (ctx.config.cdpPort || 9234) + "/json", { signal: AbortSignal.timeout(1500) }); return true; } catch (e) { return false; }
  }
  async function launchCdp() {
    const exe = await findCloudExe();
    if (!exe) return { ok: false, error: "未找到网易云安装(cloudmusic.exe)。若装在自定义目录: 在插件面板填写安装路径, 或保持网易云正在运行再点此按钮" };
    const port = ctx.config.cdpPort || 9234;
    if (await cdpPortUp()) return { ok: true, note: "网易云已带调试端口运行, 无需操作 ✓" };
    try { require("child_process").execFileSync("taskkill", ["/IM", "cloudmusic.exe", "/F"], { windowsHide: true }); await sleepMs(1500); } catch (e) {}
    const { spawn } = require("child_process");
    try { spawn(exe, ["--remote-debugging-port=" + port], { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch (e) { return { ok: false, error: "启动失败: " + e.message }; }
    for (let i = 0; i < 20; i++) {
      await sleepMs(1000);
      if (await cdpPortUp()) {
        if (cdp) cdp.start().catch(function () {});
        return { ok: true, note: "已用调试端口重启网易云并连上 ✓(精确同步生效)" };
      }
    }
    return { ok: false, error: "启动超时: 调试端口未就绪(可试桌面快捷方式)" };
  }
  function testNow() {
    const st = mediaState();
    if (!st || !st.data || !st.data.title) return { ok: false, error: '当前没有正在播放的媒体' };
    if (!timeline.length) return { ok: false, error: '歌词尚未加载(检查歌曲是否在网易云曲库)' };
    const pos = Number(st.data.position_ms) || 0;
    const cur = lineAt(pos);
    if (!cur) return { ok: false, error: '无当前歌词行' };
    const lk = cur.t + '|' + cur.orig;
    lastLineKey = lk;
    sendLine(cur, pos, true);
    let text = '';
    if (ctx.config.showTitle !== false) text += '♪ ' + (songKey || '').split('|')[0].slice(0, 34) + '\n';
    text += '♫ ' + cur.orig.slice(0, 54);
    if (ctx.config.showTranslation !== false && cur.trans) text += '\n' + '✎ ' + cur.trans.slice(0, 54);
    return { ok: true, text: text };
  }
  return {
    apply: function () {
      cdp = new CdpClient(ctx.config.cdpPort || 9234, ctx.logger);
      cdp.start().then(function (ok) { if (!ok) ensureCdpShortcut(); }).catch(function () {});
      stopTimer = ctx.events.every(1000, tick);
    },
    dispose: function () { if (stopTimer) stopTimer(); if (cdp) { cdp.dispose(); cdp = null; } },
    api: { status: status, saveConfig: saveConfig, testNow: testNow, launchCdp: launchCdp },
    panel: {
      title: '网易云歌词设置',
      html: function (cfg) {
        const trChk = cfg.showTranslation !== false ? 'checked' : '';
        const otherChk = cfg.allowOtherPlayers ? 'checked' : '';
        const rhythmChk = cfg.rhythmMode ? 'checked' : '';
        const titleChk = cfg.showTitle !== false ? 'checked' : '';
        return '<div class="sub">当"正在播放的歌"(SMTC)功能与本插件都启用时, 自动识别网易云当前歌曲的歌词, 按播放进度在聊天框同步显示原文+译文。进度来源: CDP 直读客户端(精确, 拖动/暂停/切歌全同步)→ 其它播放器的 SMTC 进度 → 本地时钟估算。首次使用: ①插件页授权并启用本插件(同时确认"正在播放的歌"已开启); ②点下方「用调试端口启动网易云」一键启动(自动退出旧实例并带调试端口重启); 桌面"网易云音乐-歌词同步"快捷方式仍可用作备用。详见插件目录 歌词同步-首次使用说明.txt。</div>' +
          '<div class="row" style="margin-top:8px"><span style="font-size:13px">CDP 调试端口:</span><input id="nlPort" type="number" min="1024" max="65535" value="' + (cfg.cdpPort || 9234) + '" style="width:80px"><span style="font-size:12px;color:#8b98a9;margin-left:8px" id="nlCdp">(状态点"查看状态")</span></div>' +
          '<div class="row" style="margin-top:8px"><span style="font-size:13px">网易云安装路径(自动找不到时手动填, 可留空):</span><input id="nlExe" type="text" value="' + String(cfg.cloudExe || '').replace(/"/g, '&quot;') + '" placeholder="cloudmusic.exe 完整路径" style="width:340px"></div>' +
          '<div class="row" style="margin-top:8px"><span style="font-size:13px">每行显示(秒, 节奏模式关闭时生效):</span><input id="nlUpdate" type="number" min="3" max="30" value="' + (cfg.updateSec || 4) + '" style="width:60px"><span style="font-size:13px;margin-left:12px">优先级:</span><input id="nlPrio" type="number" min="-999" max="999" value="' + (cfg.priority !== undefined ? cfg.priority : 35) + '" style="width:60px"></div>' +
          '<div class="row" style="margin-top:6px">' +
          '<label style="font-size:13px;margin-right:14px"><input type="checkbox" id="nlTrans" ' + trChk + '> 显示译文</label>' +
          '<label style="font-size:13px;margin-right:14px"><input type="checkbox" id="nlRhythm" ' + rhythmChk + '> 歌词节奏显示(每句按歌曲节奏自动切换)</label>' +
          '<label style="font-size:13px;margin-right:14px"><input type="checkbox" id="nlTitle" ' + titleChk + '> 顶部显示歌名(与 SMTC 联动)</label>' +
          '<label style="font-size:13px"><input type="checkbox" id="nlOther" ' + otherChk + '> 也匹配其它播放器</label>' +
          '</div>' +
          '<div class="row" style="margin-top:8px">' +
          '<button class="small" onclick="nlSave()">保存设置</button>' +
          '<button class="small" style="background:#55606e" onclick="nlTest()">测试当前歌词行</button>' +
          '<button class="small" style="background:#55606e" onclick="nlStatus()">查看状态</button>' +
          '</div>' +
          '<div class="sub" id="nlMsg" style="margin-top:8px;color:#3ddc84"></div>';
      }
    }
  };
};

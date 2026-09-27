'use strict';
// 播放期性能取证(M-20260927-07): 卡顿排查需要"同一时轴"上的三方证据 ——
//   ① 主进程事件循环延迟(perf_hooks.monitorEventLoopDelay): 每 3 秒那种尖峰会在这里现形;
//   ② 各进程 CPU(process.cpuUsage + Electron app.getAppMetrics): 指出是哪个进程在吃 CPU;
//   ③ 视频响应的投递曲线(res.socket.bytesWritten 每 200ms 采样): 数据是"一直流"还是"中间断供";
//   ④ 渲染端 <video> 的 waiting/stalled 事件与 rAF 掉帧(由页面 POST /api/diag/perf 送回来)。
// 设计: **启动即自动 arm 300 秒**, 到点自动落盘 logs/perf-<id>.json —— 用户只要"重启程序 -> 让彩蛋播一遍",
//       不需要记任何 URL; 想看实时结果可以随时打开 /api/diag/perf(读报告不销毁会话, 可反复读)。
// 开销: 事件循环直方图是原生实现(每 10ms 一格, 无 JS 回调), 每秒一次采样 + 播放期每 200ms 记一个字节数, 可忽略。
const fs = require('fs');
const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');

const DEFAULT_SECONDS = 300;
const MAX_SECONDS = 1800;
let session = null;

function iso(t) { return new Date(t).toISOString(); }
function clampSec(v) { const n = Number(v); if (!isFinite(n) || n <= 0) return DEFAULT_SECONDS; return Math.max(15, Math.min(MAX_SECONDS, Math.round(n))); }

// 注意: 会话进行中调用是空操作(回 already:true), 只在"上一次已结束"时才会开新会话
function arm(seconds) {
  if (session) return { ok: true, id: session.id, already: true, seconds: session.seconds };
  const secs = clampSec(seconds);
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const t0 = Date.now();
  const s = { id: 'perf-' + t0, t0: t0, startedAt: iso(t0), seconds: secs, endsAt: t0 + secs * 1000, h: h, samples: [], video: [], ticks: [], ops: [], client: null, reported: 0 };
  const cpu0 = process.cpuUsage();
  s.iv = setInterval(function () {
    const lag = h.max / 1e6; h.reset();
    let procs = [];
    try {
      const el = require('electron');
      if (el && el.app && typeof el.app.getAppMetrics === 'function') {
        procs = el.app.getAppMetrics().map(function (m) { return { type: m.type, pid: m.pid, cpu: Math.round((m.cpu && m.cpu.percentCPUUsage) || 0) }; });
      }
    } catch (e) {}
    const cu = process.cpuUsage(cpu0);
    s.samples.push({ atMs: Date.now() - t0, lagMs: Math.round(lag), selfCpuMs: Math.round((cu.user + cu.system) / 1000), procs: procs });
    if (Date.now() > s.endsAt) stop('timeout');
  }, 1000);
  session = s;
  return { ok: true, id: s.id, seconds: s.seconds, note: '取证已开始, ' + s.seconds + ' 秒后自动落盘 logs/' + s.id + '.json' };
}

function stop(why) {
  if (!session) return { ok: false, error: '没有进行中的取证会话' };
  const s = session;
  try { clearInterval(s.iv); } catch (e) {}
  try { s.h.disable(); } catch (e) {}
  s.endedAt = iso(Date.now());
  s.why = why || 'stopped';
  // 到点自动落盘: 用户不必记住任何 URL, 重现一次就够了
  try { report(); } catch (e) {}
  return { ok: true, id: s.id };
}

function videoMark(d) { if (session) { session.video.push(d); if (session.video.length > 200) session.video.shift(); } }
// 主进程重活打点(>=20ms 才记): "这一秒被谁堵住了"必须能直接读出名字, 否则报告只是噪声
function mark(d) {
  if (!session || !d || !(d.ms >= 20)) return;
  session.ops.push({ atMs: Math.max(0, (d.at || Date.now()) - session.t0), name: d.name, ms: d.ms });
  if (session.ops.length > 400) session.ops.shift();
}
// 源 tick 计时(>=20ms 才记: 正常源是毫秒级, 记全量没意义还会淹掉信号)
function tickMark(d) {
  if (!session || !d || !(d.ms >= 20)) return;
  session.ticks.push({ atMs: Math.max(0, d.at - session.t0), src: d.src, ms: d.ms });
  if (session.ticks.length > 600) session.ticks.shift();
}
function clientReport(payload) {
  if (!session) return { ok: false, error: '没有进行中的取证会话(程序启动后会自动记录 ' + DEFAULT_SECONDS + ' 秒; 重启程序后再试)' };
  session.client = payload || null;
  return { ok: true };
}

// 响应投递曲线里的"断供": 相邻采样点字节数不变且间隔超过 300ms
function deliveryGaps(marks) {
  const out = [];
  if (!marks || marks.length < 2) return out;
  for (let i = 1; i < marks.length; i++) {
    const d = marks[i].ms - marks[i - 1].ms;
    if (marks[i].bw === marks[i - 1].bw && d >= 300) out.push({ atMs: marks[i - 1].ms, gapMs: d });
  }
  return out;
}
// 页面端 waiting/stalled -> 下一个 playing 的停顿时长(用户感受到的"卡一下")
function clientStalls(client) {
  const out = [];
  const v = client && client.video;
  const ev = (v && Array.isArray(v.events)) ? v.events : [];
  let open = null;
  ev.forEach(function (e) {
    if (e.name === 'waiting' || e.name === 'stalled') { if (!open) open = e; }
    else if ((e.name === 'playing' || e.name === 'seeked') && open) {
      out.push({ startMs: open.at, endMs: e.at, ms: Math.max(0, e.at - open.at), ct: open.ct, kind: open.name, dec: open.dec, drop: open.drop, buf: open.buf, endBuf: e.buf });
      open = null;
    }
  });
  if (open) out.push({ startMs: open.at, endMs: null, ms: null, ct: open.ct, kind: open.name });
  return out;
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 800); }

// 源 tick 与页面停顿对轴: 一次 >=300ms 的 tick 若与某次停顿同轴, 基本就是它拉出来的
function tickHits(ticks, stalls) {
  const slow = (ticks || []).filter(function (t) { return t.ms >= 300; });
  const hits = [];
  slow.forEach(function (t) {
    stalls.forEach(function (st) {
      if (st.startMs != null && st.startMs >= t.atMs - 500 && st.startMs <= t.atMs + t.ms + 500) hits.push({ src: t.src, tickMs: t.ms, atMs: t.atMs, stallMs: st.ms });
    });
  });
  return { slow: slow, hits: hits };
}

function verdicts(s, spikes, stalls, respGaps) {
  const out = [];
  const hasSpike = spikes.length > 0;
  const overlap = function (list, at) { return list.some(function (x) { return near(x.atMs, at); }); };
  if (stalls.length && hasSpike) {
    const hit = stalls.filter(function (st) { return st.startMs != null && overlap(spikes, st.startMs); });
    out.push(hit.length ? ('页面停顿与主进程事件循环尖峰同轴 ' + hit.length + '/' + stalls.length + ' 次 -> 优先查主进程(插件定时任务/日志写盘/采集进程)')
      : ('页面停顿 ' + stalls.length + ' 次, 与事件循环尖峰不同轴 -> 主进程不是卡顿源, 看渲染/解码与数据投递'));
  } else if (stalls.length && !hasSpike) {
    out.push('页面停顿 ' + stalls.length + ' 次但主进程事件循环全程平稳 -> 指向渲染端/解码端, 以及文件数据投递');
  }
  const fin = (s.client && s.client.video && s.client.video.final) || null;
  if (fin && fin.drop >= 20) out.push('渲染端累计丢帧 ' + fin.drop + ' 帧(已解码 ' + fin.dec + ') -> 解码/渲染跟不上, 看显卡解码与整机 CPU 争抢');
  else if (fin && fin.drop < 5 && stalls.length) out.push('丢帧极少(' + fin.drop + ')却出现停顿 -> 更像"数据/时钟被卡住", 而不是解码能力不足');
  // 只有"确实把事件循环堵住"的操作才算嫌疑(2026-09-27 修正): 第一版只看耗时, 把 287ms 的**异步**采集也算成凶手,
  // 属于假阳性 —— 异步子进程耗时再长也不阻塞主线程。判据: 该操作窗口内必须有一次 >=80ms 的事件循环尖峰。
  const blocking = (s.ops || []).filter(function (o) { return o.ms >= 100 && spikeInWindow(spikes, o.atMs, o.atMs + o.ms); });
  const nonBlocking = (s.ops || []).filter(function (o) { return o.ms >= 100 && blocking.indexOf(o) < 0; });
  const opHits = blocking.filter(function (o) { return stalls.some(function (st) { return st.startMs != null && st.startMs >= o.atMs - 500 && st.startMs <= o.atMs + o.ms + 500; }); });
  if (opHits.length) out.push('页面停顿与"确实阻塞过事件循环"的慢操作同轴 ' + opHits.length + ' 次: ' + opHits.slice(0, 6).map(function (o) { return o.name + '(' + o.ms + 'ms)'; }).join(', ') + ' -> 先治这个操作');
  else if (blocking.length) out.push('有 ' + blocking.length + ' 次阻塞过事件循环的慢操作, 但未与停顿同轴 -> 不是本次停顿的直接原因');
  else if (nonBlocking.length) out.push('有 ' + nonBlocking.length + ' 次耗时较长但**不阻塞事件循环**的操作(异步子进程) -> 不构成主线程阻塞, 不必当凶手');
  if (blocking.length === 0 && stalls.length) out.push('主线程没有任何 >=80ms 阻塞却仍停顿 -> 结论: 问题在渲染/媒体管线本身(解码/呈现/音频时钟), 不在主进程');
  const th = tickHits(s.ticks, stalls);
  if (th.hits.length) out.push('页面停顿与慢源 tick 同轴 ' + th.hits.length + ' 次: ' + th.hits.slice(0, 6).map(function (h) { return h.src + '(' + h.tickMs + 'ms)'; }).join(', ') + ' -> 先治这个源');
  else if (th.slow.length) out.push('有 ' + th.slow.length + ' 次慢源 tick(>=300ms)但未与停顿同轴 -> 源不是直接原因, 仍需看它是否抬高 CPU');
  if (respGaps.length) out.push('视频响应中途有 ' + respGaps.length + ' 段"断供"(相邻采样字节数不变 >=300ms) -> 数据到达侧(磁盘/NAS/读流)需要看');
  const slow = (s.video || []).filter(function (v) { return v.throughputKBps != null && v.throughputKBps < 400 && v.bytes > 200000; });
  if (slow.length) out.push(slow.length + ' 次视频响应平均吞吐低于 400KB/s -> 播放期带宽/读盘跟不上 1Mbps 视频会持续补缓冲');
  if (!stalls.length && !hasSpike && !respGaps.length) out.push('本次没抓到停顿: 要么没复现, 要么视频没真正播(看 client.video.events 是否为空)');
  return out;
}

// 运行环境快照: 排障时必须能确认"这一轮到底跑在什么开关下"(否则测试结论无从解释)
function envInfo() {
  const o = { electron: false, versions: null, videoSwitches: {}, gpuStatus: null };
  try {
    const el = require('electron');
    if (el && el.app) {
      o.electron = true;
      o.versions = { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node };
      try { if (el.app.commandLine && el.app.commandLine.hasSwitch) { o.videoSwitches.softwareVideoDecode = el.app.commandLine.hasSwitch('disable-accelerated-video-decode'); o.videoSwitches.disableGpu = el.app.commandLine.hasSwitch('disable-gpu'); } } catch (e) {}
      try { if (typeof el.app.getGPUFeatureStatus === 'function') { const st = el.app.getGPUFeatureStatus() || {}; o.gpuStatus = { video_decode: st.video_decode, gpu_compositing: st.gpu_compositing }; } } catch (e) {}
    }
  } catch (e) {}
  if (!o.electron) o.versions = { node: process.versions.node };
  o.argvSoftDecode = process.argv.indexOf('--disable-accelerated-video-decode') >= 0;
  o.hwMode = process.env.VRCB_HW_MODE || null;   // 桌面壳按 config 决定的档位(auto/decode/off), 非壳模式为 null
  return o;
}

// 只留最近 keep 份 perf-*.json(按文件名里的时间戳排序, 最旧先删)
function pruneReports(dir, keep) {
  try {
    const files = fs.readdirSync(dir).filter(function (f) { return /^perf-\d+\.json$/.test(f); }).sort();
    files.slice(0, Math.max(0, files.length - keep)).forEach(function (f) { try { fs.unlinkSync(path.join(dir, f)); } catch (e) {} });
  } catch (e) {}
}

function spikeInWindow(spikes, start, end) { return (spikes || []).some(function (sp) { return sp.atMs >= start - 1200 && sp.atMs <= end + 1200; }); }

function writeReport(s) {
  const lags = s.samples.map(function (x) { return x.lagMs; }).slice().sort(function (a, b) { return a - b; });
  const pick = function (q) { return lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * q))] : 0; };
  const spikes = s.samples.filter(function (x) { return x.lagMs >= 80; });
  const responses = (s.video || []).map(function (v) {
    return { atMs: Math.max(0, v.at - s.t0), ms: v.ms, ranged: v.ranged, bytes: v.bytes,
      throughputKBps: v.ms > 0 ? Math.round(v.bytes / v.ms) : null, status: v.status, gaps: deliveryGaps(v.marks), marks: (v.marks || []).length };
  });
  const stalls = clientStalls(s.client);
  const respGaps = responses.reduce(function (acc, r) { return acc.concat(r.gaps.map(function (g) { return { atMs: r.atMs + g.atMs, gapMs: g.gapMs }; })); }, []);
  const lf = ((s.client && s.client.video && s.client.video.longFrames) || []).slice().sort(function (a, b) { return b.ms - a.ms; });
  const summary = {
    id: s.id, startedAt: s.startedAt, endedAt: s.endedAt || iso(Date.now()), why: s.why || 'reading', seconds: s.seconds,
    env: envInfo(),
    active: Date.now() <= s.endsAt, remainingMs: Math.max(0, s.endsAt - Date.now()), readCount: s.reported,
    eventLoop: { samples: lags.length, p50Ms: pick(0.5), p90Ms: pick(0.9), p99Ms: pick(0.99), maxMs: lags.length ? lags[lags.length - 1] : 0,
      spikeCount80ms: spikes.length,
      spikes: spikes.slice(0, 25).map(function (x) { return { atMs: x.atMs, lagMs: x.lagMs, selfCpuMs: x.selfCpu, procs: (x.procs || []).map(function (p) { return p.type + '#' + p.pid + '=' + p.cpu + '%'; }).join(' ') }; }) },
    videoResponses: responses.slice(-40),
    slowOps: { count: (s.ops || []).length,
      byName: (s.ops || []).reduce(function (acc, o) { acc[o.name] = Math.max(acc[o.name] || 0, o.ms); return acc; }, {}),
      ops: (s.ops || []).slice(-80) },
    sourceTicks: { count: (s.ticks || []).length, slow300ms: tickHits(s.ticks, stalls).slow.length,
      bySrc: (s.ticks || []).reduce(function (acc, t) { acc[t.src] = Math.max(acc[t.src] || 0, t.ms); return acc; }, {}),
      ticks: (s.ticks || []).slice(-120) },
    sources: s.sources || null,
    clientVideo: (function () {
      const cv = (s.client && s.client.video) || null;
      const fin = cv && cv.final;
      return { frames: cv ? cv.frames : null, durMs: cv ? cv.durMs : null, eventCount: cv && cv.events ? cv.events.length : 0,
        decoded: fin ? fin.dec : null, dropped: fin ? fin.drop : null, bufferedEnd: fin ? fin.buf : null };
    })(),
    clientStalls: stalls,
    clientLongFrames: lf.slice(0, 20),
    client: s.client,
  };
  summary.verdict = verdicts(s, spikes, stalls, respGaps);
  let file = null;
  try {
    const dir = path.join(__dirname, '..', 'logs');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, s.id + '.json');
    fs.writeFileSync(file, JSON.stringify(summary, null, 1), 'utf8');
    pruneReports(dir, 10);   // 留存上限: 每次启动都会生成一份, 留最近 10 份即可(见 PROCESS-01 §10)
  } catch (e) {}
  summary.file = file;
  return summary;
}

function report() {
  if (!session) return { ok: false, error: '没有取证数据(程序启动后会自动记录 ' + DEFAULT_SECONDS + ' 秒; 重启程序后再试)' };
  const s = session;
  // 读报告**不销毁**会话(2026-09-27 修正): 门禁的"路由可达性扫描"会 GET 这个接口, 若在这里把会话清掉,
  // 随后的真实断言就会拿到"没有取证数据"; 而且用户也可能想多读两次。采样继续到自然结束(arm 的 seconds)。
  s.reported = (s.reported || 0) + 1;
  return { ok: true, report: writeReport(s) };
}
module.exports = { arm: arm, stop: stop, report: report, clientReport: clientReport, videoMark: videoMark, tickMark: tickMark, mark: mark, active: function () { return !!session; }, DEFAULT_SECONDS: DEFAULT_SECONDS };

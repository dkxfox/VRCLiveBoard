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

function arm(seconds) {
  if (session) return { ok: true, id: session.id, already: true, seconds: session.seconds };
  const secs = clampSec(seconds);
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  const t0 = Date.now();
  const s = { id: 'perf-' + t0, t0: t0, startedAt: iso(t0), seconds: secs, endsAt: t0 + secs * 1000, h: h, samples: [], video: [], client: null, reported: 0 };
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
      out.push({ startMs: open.at, endMs: e.at, ms: Math.max(0, e.at - open.at), ct: open.ct, kind: open.name });
      open = null;
    }
  });
  if (open) out.push({ startMs: open.at, endMs: null, ms: null, ct: open.ct, kind: open.name });
  return out;
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol || 800); }

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
  if (respGaps.length) out.push('视频响应中途有 ' + respGaps.length + ' 段"断供"(相邻采样字节数不变 >=300ms) -> 数据到达侧(磁盘/NAS/读流)需要看');
  const slow = (s.video || []).filter(function (v) { return v.throughputKBps != null && v.throughputKBps < 400 && v.bytes > 200000; });
  if (slow.length) out.push(slow.length + ' 次视频响应平均吞吐低于 400KB/s -> 播放期带宽/读盘跟不上 1Mbps 视频会持续补缓冲');
  if (!stalls.length && !hasSpike && !respGaps.length) out.push('本次没抓到停顿: 要么没复现, 要么视频没真正播(看 client.video.events 是否为空)');
  return out;
}

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
    active: Date.now() <= s.endsAt, remainingMs: Math.max(0, s.endsAt - Date.now()), readCount: s.reported,
    eventLoop: { samples: lags.length, p50Ms: pick(0.5), p90Ms: pick(0.9), p99Ms: pick(0.99), maxMs: lags.length ? lags[lags.length - 1] : 0,
      spikeCount80ms: spikes.length,
      spikes: spikes.slice(0, 25).map(function (x) { return { atMs: x.atMs, lagMs: x.lagMs, selfCpuMs: x.selfCpu, procs: (x.procs || []).map(function (p) { return p.type + '#' + p.pid + '=' + p.cpu + '%'; }).join(' ') }; }) },
    videoResponses: responses.slice(-40),
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
module.exports = { arm: arm, stop: stop, report: report, clientReport: clientReport, videoMark: videoMark, active: function () { return !!session; }, DEFAULT_SECONDS: DEFAULT_SECONDS };

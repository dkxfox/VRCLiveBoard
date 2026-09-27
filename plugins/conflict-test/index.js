'use strict';
// 冲突检测测试插件(全权限夹具) —— 开发自测用, 永不随包出厂。
//   能验证的东西: ① 审批窗把 网络/写文件/进程/端口/AI 五类权限逐项列出来(process 与 ai 会让它进高危档, 需输入插件名)
//                ② 启用后与 conflict-test-b 同时开 → 插件卡上出现「独占资源冲突」与「优先级相同」
//                ③ 「权限自测」按钮逐项试一遍 http/文件/进程/AI, 把「允许」或「被拒」如实回给控制台(拒绝会带原因)
const path = require('path');

module.exports = function (ctx) {
  let timer = null;
  let ticks = 0;
  const dataFile = path.join(__dirname, 'data', 'selftest.txt');
  function label() { return String(ctx.config.prefix || '[冲突测试]'); }
  const source = {
    id: 'board',
    enabled: true,
    priority: 45,   // 与 conflict-test-b 的数据源同优先级 → 两个都启用时冲突引擎会报「优先级相同」
    intervalMs: Math.max(5000, Math.min(600000, (Number(ctx.config.intervalSec) || 30) * 1000)),
    getText: function () {
      if (ctx.config.enabledDemo === false) return '';
      ticks++;
      const cur = ctx.chatbox.current();
      const now = cur && cur.text ? String(cur.text).slice(0, 14) : '(空)';
      return label() + ' 第 ' + ticks + ' 次轮询 · 当前屏幕: ' + now;
    }
  };
  return {
    apply: function () {
      ctx.registerSource(source);
      timer = setInterval(function () { /* 只是证明「有定时器, 且 dispose 会清掉」 */ }, 60000);
    },
    dispose: function () {
      if (timer) { clearInterval(timer); timer = null; }
    },
    api: {
      // 权限自测: 每项只试一次, 失败也照实回(拒绝信息里带原因, 是演示的重点)
      selfTest: async function () {
        const out = {};
        try { const r = await ctx.http.request('https://example.com/', { signal: AbortSignal.timeout(8000) }); out['① 网络 example.com'] = '允许 (HTTP ' + r.status + ')'; }
        catch (e) { out['① 网络 example.com'] = '被拒/失败: ' + e.message; }
        try { ctx.fs.write(dataFile, 'hello ' + new Date().toISOString()); out['② 写自己目录'] = '允许 (' + dataFile + ')'; }
        catch (e) { out['② 写自己目录'] = '被拒: ' + e.message; }
        try { out['③ 读回'] = '允许: ' + ctx.fs.read(dataFile).slice(0, 40); }
        catch (e) { out['③ 读回'] = '被拒: ' + e.message; }
        try { ctx.fs.write(path.join(__dirname, '..', '..', 'config.json'), 'x'); out['④ 写 config.json'] = '**没被拦住** —— 这是 bug, 请报告'; }
        catch (e) { out['④ 写 config.json(硬拒名单)'] = '被拒(符合预期): ' + e.message; }
        try { const p = ctx.exec.run('cmd', ['/c', 'echo', 'vrcb-conflict-test']); out['⑤ 进程'] = p && p.pid ? '允许 (pid ' + p.pid + ')' : '允许'; }
        catch (e) { out['⑤ 进程'] = '被拒: ' + e.message; }
        try { const r2 = await ctx.ai.chat({ task: 'chat', text: '只回四个字: 收到测试' }); out['⑥ AI(ctx.ai)'] = '允许: ' + String((r2 && r2.text) || '').slice(0, 40); }
        catch (e) { out['⑥ AI(ctx.ai)'] = '被拒/失败: ' + e.message; }
        return { ok: true, result: out };
      },
      show: function () {
        ctx.chatbox.send(label() + ' 手动触发(优先级 95 —— 会抢占电脑状态/公告板)', { priority: 95, ttlMs: 6000 });
        return { ok: true };
      },
      status: function () {
        return { ok: true, ticks: ticks, priority: source.priority, intervalMs: source.intervalMs,
          exclusive: 'vrchat-chatbox(与 conflict-test-b 共享)',
          current: (function () { const c = ctx.chatbox.current(); return c ? String(c.text || '').slice(0, 30) : '(空)'; })() };
      }
    }
  };
};

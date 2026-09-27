'use strict';
// 冲突检测测试 B(伙伴夹具): 只做两件事 —— 占用与 A 相同的独占资源, 并注册同优先级的数据源。
module.exports = function (ctx) {
  const source = {
    id: 'board',
    enabled: true,
    priority: 45,   // 与 conflict-test 相同
    intervalMs: 60000,
    getText: function () { return '[冲突测试B] 我也在轮询(优先级 45, 与 A 相同)'; }
  };
  return {
    apply: function () { ctx.registerSource(source); },
    dispose: function () {},
    api: {
      status: function () { return { ok: true, priority: source.priority, exclusive: 'vrchat-chatbox(与 conflict-test 共享)' }; }
    }
  };
};

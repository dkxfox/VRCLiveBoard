'use strict';
module.exports = function (ctx) {
  return {
    apply: function () { ctx.resource && ctx.resource('exclusive', 'chatbox-timeline'); },
    dispose: function () {},
    api: { status: function () { return { ok: true, note: '冲突测试插件(运行时资源注册表)' }; } },
    panel: { title: '冲突测试插件', html: function () { return '<div class="sub">本插件仅用于测试运行时资源注册表: 与 friend-welcome 声明同一独占资源 chatbox-timeline, 二者同时启用时应被阻止。</div>'; } }
  };
};

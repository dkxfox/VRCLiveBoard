'use strict';
// 冲突检测测试 DEP: 故意让「启用」被冲突引擎拦住(缺依赖 + 与 weather-board 互斥)。
//   启用时会得到: 「冲突: 缺少依赖插件 no-such-plugin(要求 >=1.0.0)」或「冲突: manifest 声明与 weather-board 互斥」。
module.exports = function (ctx) {
  return {
    apply: function () { /* 启用不了, 这里不会被执行 */ },
    dispose: function () {},
    api: {
      status: function () { return { ok: true, note: '如果这个插件启用了, 说明冲突引擎漏了依赖/互斥检查 —— 请报告' }; }
    }
  };
};

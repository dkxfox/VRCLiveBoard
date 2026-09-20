'use strict';
// B站直播互动插件 —— 【占位骨架, 尚未实现】(2026-09-20 建档; 资料见同目录 01~06) 
//
// 计划架构(详见 05-玩法与架构.md):
//   玩法层(公告板变量 / 播报 / OSC / 计分板)
//        ↑ BilibiliEvent { type, user, text, value, ts }
//   传输层 ├─ official adapter  走官方直播开放平台(start/heartbeat/end + Hmac-SHA256)
//          └─ dev adapter       社区协议(仅本机自用, 不进发布包)
//
// 依赖: 零新增依赖 —— 用 Node 内置 WebSocket / zlib(含 brotli) / crypto / fetch;
//       注意本项目 engines 写的是 node>=18, 而全局 WebSocket 要 21+/22 才稳定(见 README 末尾的待办)。
//
// 权限说明: manifest 只声明官方通道用到的三个域名; 社区通道的域名不进声明(它不进包)。

module.exports = {
  // onLoad / onUnload 目前都是空实现: 这个插件被拷进 plugins/ 后可以正常加载、不报错、也不做任何事,
  // 目的是先把"位置"和"资料"占住。等真正开发时再按 05 文档替换这里。
  onLoad: function () {},
  onUnload: function () {}
};

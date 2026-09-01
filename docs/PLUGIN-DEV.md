# VRCLiveBoard 插件开发指南(v2)

插件 = 一个文件夹,放进程序目录的 plugins\ 下,内含 manifest.json 和 index.js。
控制台"插件"卡片会列出它;首次启用需在红色弹窗授权(倒计时 5 秒)。

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "一句话说明",
  "api": "2.0.0",
  "permissions": {
    "network": [],
    "filesystem": { "read": [], "write": [] },
    "process": false,
    "ports": []
  },
  "dependencies": {},"conflicts": [],"exclusive": [],"loadOrder": 100
}
```

字段说明:
- api: 必须是 2.x(当前运行时);不匹配会拒绝启用。
- permissions.network: 允许访问的域名列表(如 ["homeassistant.local"],"*" 表示任意)。
- permissions.filesystem.read/write: 允许读写路径前缀列表;
- permissions.process: true 才允许执行外部程序(高危,授权弹窗会红字标出)。
- dependencies: 依赖的其他插件 {id: 版本或"*"}。
- conflicts: 与之互斥的插件 id 列表。
- exclusive: 独占资源名(两个插件声明同一个资源会互相冲突,如 "chatbox.priority.90")。
- loadOrder: 加载顺序,数字小先加载。

## index.js(能力注入 ctx)

```js
module.exports = function (ctx) {
  return {
    apply() { ctx.events.on('player.joined', onJoin); },
    dispose() { ctx.events.off('player.joined', onJoin); },
    panel: { title: '设置', html(cfg) { return '...HTML...'; } }
  };
};
```

ctx 能力清单:
- ctx.config: 插件设置对象(控制台面板保存后自动持久化到 config.json)。
- ctx.events.on/off('player.joined'|'player.left', fn): 玩家进出事件(日志监听,约 1.5s 延迟)。
- ctx.events.every(ms, fn): 定时器,返回取消函数(停用插件时务必取消)。
- ctx.chatbox.send(text, {priority, ttlMs, force}): 发送临时文本到聊天框(优先级越高越优先)。
- ctx.chatbox.showSequence(chunks, {priority, eachMs, loops}): 按片轮巡展示,结束后自动恢复原状。
- ctx.http.request(url, options): fetch 包装,受 network 权限门禁。
- ctx.fs.read/write(path): 受 filesystem 权限门禁。
- ctx.exec.run(cmd, args): 受 process 权限门禁。
- ctx.registerSource(src): 注册长期数据源 {id, priority, intervalMs, getText}。
- ctx.plugins: 插件管理器(查询其他插件状态)。

所有经 ctx 的敏感调用都会记入 logs\plugin-audit.log(审计)。

## 常见坑(官方踩过)

1. **call 传参**: 控制台"调用插件接口"会把整个 args 对象作为唯一参数传入。方法入口先解包:
   ```js
   async function resolve(input) {
     if (input && typeof input === 'object' && input.input) input = input.input;
     ...
   }```
2. **模块级 ctx**: 严格模式下未声明就赋值会 ReferenceError。用 `let ctx = null;` 在工厂里赋值, 或把所有用到 ctx 的函数写进工厂闭包内。
3. **settings 断引用**: ctx.config 是引用, 运行中改配置必须原地合并(运行时已保证); 重启后 config.plugins[id] 自动回填, 放心用 ctx.config.xxx。
4. **网络清单**: B 站类插件要声明 api.bilibili.com / bilibili.com / b23.tv 三个域(重定向与 CDN 之外的主域)。
5. **Node 里的 xlsx**: 浏览器版 xlsx.full.min.js 在 Node 会炸, 用 CJS 版 + vendor 目录(参考 friend-welcome 插件)。

## 官方插件参考实现

- plugins/friend-welcome: 事件(player.joined)+ 面板 + Excel 批量导入(SheetJS)+ showSequence 轮播。
- plugins/scheduled-board: every 定时 + chatbox.send, 最简单的完整示例。
- (已作废, 不再提供) bilibili-direct 直链插件已于 2026-08-22 按用户决定删除, 后续开发不复用。

## 冲突监测规则

- 安装/启用时: api 版本不符、缺依赖、依赖版本不符、声明互斥、同 ID 重复 → 拒绝或红字提示;
- 运行时: 聊天框相同优先级抢显示、越权调用 → 冲突组展示在插件列表;
- 建议: 互相抢聊天框的插件调不同优先级,或修改 exclusive 声明。

## AI 友好模板(把需求描述替换即可让 AI 生成插件)

```
写一个 VRCLiveBoard 插件。
功能: <一句话描述>
事件: <player.joined / player.left / 定时 / 无>
输出: <聊天框文本 / 网络请求 / 文件>
权限: <network 域名列表 / process 是否需要>
设置面板: <需要哪些输入框>
只输出 manifest.json 与 index.js 两个文件内容,遵守 docs/PLUGIN-DEV.md 规范。
```

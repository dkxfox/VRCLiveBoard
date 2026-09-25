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

## 声明设置字段(可选, 2026-09-20 新增)

manifest 里可以声明 `settings` 数组, 控制台会在插件卡片里**自动渲染输入框**并保存到 `ctx.config`
(不再依赖"插件自带 HTML 面板"—— 那条路的面板容器在 1.4.x 控制台里缺失, 见 ISSUES):

```json
"settings": [
  { "key": "apiKey", "label": "API Key", "type": "password", "secret": true, "hint": "说明文字" },
  { "key": "intervalMin", "label": "间隔(分钟)", "type": "number", "default": 15 },
  { "key": "enabled", "label": "启用播报", "type": "bool", "default": true }
]
```

- `type`: `text` / `password` / `number` / `bool`;
- `secret: true` = 敏感值: **永远不会回传给浏览器**(界面只显示"已保存/未填写"), 留空保存表示"不修改"; 日志里也别打印它;
- 保存走已有的 `POST /api/plugins/config`; 插件里用 `ctx.config.<key>` 读。

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
- ctx.chatbox.current(): 当前正在显示什么 `{text, sourceId, priority, ttlUntil, at}`(副本; 空场为 null)——
  插件要"该抢占还是该排队"就得看它(2026-09-20 为 B站插件新增)。
- ctx.chatbox.showSequence(chunks, {priority, eachMs, loops}): 按片轮巡展示,结束后自动恢复原状。
- ctx.http.request(url, options): fetch 包装,受 network 权限门禁。
- ctx.fs.read/write(path): 受 filesystem 权限门禁。
- ctx.exec.run(cmd, args): 受 process 权限门禁。
- ctx.registerSource(src): 注册长期数据源 {id, priority, intervalMs, getText}(**注册即启用**; 要临时停就在源对象上设 `enabled:false`)。
  注意: 主程序只轮询 `enabled` 为真的源 —— 旧版程序不会替你补这个默认值, 写插件时建议显式带上 `enabled: true`。
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

## 插件市场(1.4.0): 入库流程与分级

市场 = **同一个 GitHub 仓库的 `market/` 目录** + jsDelivr/raw 双源分发(与更新检测同一套: 国内可达, 直连只作回退)。客户端只认这一份目录, 不做任何"服务端登录"。

### 目录结构
```
market/index.json            插件目录(唯一索引; 由脚本生成, 别手改)
market/revoke.json           吊销列表(命中即拒绝安装并提示原因)
market/packages/<id>-<ver>.zip   分发包(客户端装的就是它)
```

### 入库流程(代发制 —— 作者多为国内小圈子, "PR 流程"对人不成立)
1. 作者把 **插件 zip + 说明 + 联系方式** 私聊给开发者;
2. 开发者本地过审: 放进 `plugins/<id>/` → 跑门禁(G1/G2/GPLUG/GBOOT 与行为断言) → 人工看权限声明与来源;
3. 生成目录: `node scripts/make-market.js --tier reviewed --only <id>`(官方插件用 `--tier official`);
4. 提交 `market/` 并推送 —— 客户端最多 6 小时后(或点"刷新目录")看到它;
5. 出问题: 往 `market/revoke.json` 加一条 `{id, versions:["*"], reason}`, 提交推送 —— 全量客户端立即拒装并显示原因。

### 分级(tier)
| 分级 | 含义 | 客户端表现 |
| --- | --- | --- |
| `official` | 官方自带插件 | 徽章"官方" |
| `reviewed` | 已人工审核的第三方 | 徽章"已审核" |
| `experimental` | 实验区/未审核(目录里没写 tier 时的**默认值**) | 徽章"实验" |
| `local` | 只在本机存在(自装/已下架) | 徽章"本地" |

分级只影响**标记与提示**, 不替代授权: 从市场装的插件仍然要在控制台里过一次红窗授权(高危插件还要输入插件名)才能启用。

### 客户端拿到的保证
- 目录条目必须带 **sha256**(缺则整条丢弃)与**白名单下载地址**(只允许官方仓库的 jsDelivr/raw/github 域名, 防投毒);
- 下载后先比 `size`(±1KB)再比 **sha256**, 不符即拒绝安装并报出两侧前缀;
- 解包走 `manager.importZip` 的既有防线(zip ≤50MB / 解包 ≤200MB / 条目 ≤2000 / 防 zip-slip / id 白名单);
- 安装来源(分级/哈希/时间)记进 `config.marketInstalled`, 重启后仍知道它来自哪个分级。

### 自定义源(国内镜像/内网目录)
`config.market.indexUrl` / `config.market.revokeUrl` 可指向自建镜像(与官方源同一份 schema); 指向 `http://127.0.0.1` 时视为**测试模式**, 允许同源 http 下载地址(门禁就是这么跑端到端的)。

### 分级与安全策略的关系(2026-09-12 核对)

分级(tier)**只影响标记与提示**, 不改变任何权限判定: 插件安全策略是全局一套(`config.plugins.security`, 默认
`networkPolicy=whitelist / processPolicy=consent / fsWritePolicy=sandbox / fsReadPolicy=self`), 所有插件(含官方)
走同一套默认值, 授权红窗与高危插件的"输入插件名确认"一个都不少 —— 从市场装不比手动导入多任何权限。

按分级**再收紧**(例如实验区强制 `aiPolicy=off`、或实验区禁止进程能力)属于 1.4.x 候选, **不在 1.4.0 范围内**;
写在这里免得以后误以为已经做了。

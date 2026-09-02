# F-20260902-01 index.html 拆分(内联脚本外链化)

> 流程见 docs/PROCESS-02-开发更新.md。这是三流程闭环后的第一次全流程实战(H 风险档)。

## 0. 状态

- 状态: DONE
- 归属: 主体(src/web/public/)
- 目标版本: 1.3.1 同号(纯重构, 行为不变, 不进发布)
- 关联: DEV-NOTES 条目 92

## 1. 七问(D0)

1. **谁在什么场景下用**: 所有使用者打开控制台页面;动机是技术债 —— 98,959 字节的 index.html 里有 73,966 字符内联脚本, 每加一行边界就漂移(DEV-NOTES 81)
2. **要不要占聊天框**: 不占(纯前端重构)
3. **新配置项**: 无
4. **新端点**: 无;新增静态资源 GET /app.js(走既有静态资源路由, 已有防目录穿越 + no-store + application/javascript)
5. **新依赖**: 无
6. **失败降级**: app.js 404 → 页面无交互;由 GHTML 门禁(外链存在性)+ 冒烟(页面可加载)+ 用户实例实测三层兜底
7. **不做什么**: 不改任何 JS 逻辑、不改样式、不做模块化拆分(那是后续轮次);只做"搬出去 + 同位置引用"

## 2. 四张契约(D1)

### API 契约
| 端点 | 变化 |
| --- | --- |
| GET /app.js | 新增静态资源,复用既有 serveFile 路径(安全字符校验/防穿越/no-store/正确 MIME) |

### 配置契约 / 显示契约 / 权限契约
无变化。

### 关键实现约束
- 执行顺序必须与拆分前完全一致:原内联脚本位于 </body> 前, DOM 已解析, 且排在 lang.js 之后;外链 <script src="/app.js"></script> 保持同一位置 → 顺序不变
- 字节级搬运:提取内容与原内联块逐字一致(脚本断言 code === 提取物), 不改行尾、不加 BOM

## 3. 切片计划(D2)

- [x] 切片 1: 提取内联脚本到 src/web/public/app.js, index.html 换成同位置外链引用(本 commit 即全部, 一次 revert 可回退)

## 4. 验收断言(D3)

- ASSERT: 控制台页面可加载|/|VRCLiveBoard
- ASSERT: app.js 静态资源可获取|/app.js|fetch|poll|render
- ASSERT: lang.js 正常|/lang.js|VRCB_LANG
- [x] 影响面回归: server.js 未改(路由契约不变);GHTML 已升级并 PASS
- [ ] 用户在自己实例确认(重启后控制台功能全量可用)

## 5. 发布准备(D4)

- [x] 使用说明/版本说明/README 无需改(纯重构, 无用户可见变化)
- [x] 打包清单: app.js 位于 public/ 随目录进包, 无需改 make-dist;GPACK 会验证
- [x] pack-audit 通过

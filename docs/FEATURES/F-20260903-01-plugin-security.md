# F-20260903-01 插件系统安全收紧

> 七问答完(2026-09-03, 与用户多轮讨论后拍板: 默认档=声明+审批放行, 收紧档=一级密码可选; 误伤面已逐插件核对)。

## 0. 状态

- 状态: **ACCEPT**(2026-09-27 收口: 5 个切片全绿; 门禁侧 GCONF 守默认档 + 隔离冒烟覆盖 /api/security 单向收紧与 require 钩子; 《使用说明》"插件安全策略"段与《版本说明》十、均已写明; pack-audit 多次 AUDIT PASS)
- 归属: 主体(插件系统核心)
- 目标版本: 下个补丁版(不升 1.4.0, 走流程 1 补丁位) → **已随 1.4.x 系列出厂**
- 关联: DEV-NOTES 条目 95 / **222(2026-09-27 收口)**
- 遗留: 仅"用户在自己实例做一次 UI 复核"一项(ACCEPT 语义 = 代码与门禁完成, 等用户一句话转 DONE; 按 PROCESS-04 §12 不由 AI 代签)

## 1. 七问(D0)

1. **谁在什么场景下用**: ①普通用户(含无密钥用户)安装/审批第三方插件 —— 必须零影响;②安全敏感用户/开发者想要更严档位(公共机、企业管控);③官方四个插件(含天气外网、网易云直接 require child_process)必须保持可用。
2. **要不要占聊天框**: 不占(纯设置/审批/执行点改动)。
3. **新配置项**: `plugins.security = { networkPolicy:'whitelist', processPolicy:'consent', fsWritePolicy:'sandbox', fsReadPolicy:'self' }`(默认 = 宽松但审计可见;收紧档 localOnly/off/deny/declared 由一级密码切换)。安全默认体现在: 未声明即拒(已有)、硬拒名单、审计默认开、审批哈希纳入代码内容 —— 全部默认生效。
4. **新端点**: 不新增端点 —— 扩展 `POST /api/security`(一级)接受 pluginsSecurity 字段(403 未解锁 / 400 非法枚举);`GET /api/config`(零级)返回 plugins.security 当前值;审批窗 UI 增强。
5. **新依赖**: 无(sha256 用内置 crypto, require 钩子用内置 Module)。
6. **失败降级**: plugins.security 缺失/非法值 → 回落默认档并 WARN 日志;策略对象热生效(改设置即刻作用到后续调用)。
7. **不做什么**: 不做 vm 沙箱/进程级隔离(威胁模型不变: 防被动提取与越权调用, 不防本机所有者改代码);不做端口监听能力;不收紧安装/启用/停用等零级操作;不改变公开版默认体验。

## 2. 四张契约(D1)

### API 契约
| 端点 | 方法 | 请求 | 响应 | 错误码 | 门禁 |
| --- | --- | --- | --- | --- | --- |
| /api/security | POST | `{ pluginsSecurity:{ networkPolicy, processPolicy, fsWritePolicy, fsReadPolicy, aiPolicy } }`(可选字段) | `{ ok:true, security, pluginsSecurity }` | 400 枚举非法 / 403 未解锁时放宽或改一级字段 | **0 级可单向收紧+恢复默认; 放宽与其余字段仍一级**(条目 98) |
| /api/config | GET | - | 增加 `pluginsSecurity:{...}` 当前生效值 | - | 零级(只读) |
| /api/plugins/approve | POST | 不变 | 不变(hash 算法升级) | 不变 | 零级 |

### 配置契约
| key | 类型 | 默认值 | 说明 | 老配置缺键时 |
| --- | --- | --- | --- | --- |
| plugins.security.networkPolicy | 'whitelist'\|'localOnly'\|'off' | whitelist | 外网策略: 声明+审批放行 / 仅回环 / 全禁 | 整块缺失→全默认 |
| plugins.security.processPolicy | 'consent'\|'deny' | consent | 进程执行: 审批制 / 全禁(拦截 ctx.exec 与直接 require child_process) | 同上 |
| plugins.security.fsWritePolicy | 'sandbox'\|'declared'\|'deny' | sandbox | 写: 仅插件目录+data 沙盒 / 加 manifest 声明路径 / 全禁 | 同上 |
| plugins.security.fsReadPolicy | 'self'\|'declared'\|'deny' | self | 读: 仅自身目录 / 加声明路径 / 全禁 | 同上 |
| (硬名单, 不可配置) | - | - | config.json、*.bak、dev-dongle、src、scripts、logs 永拒写; config.json、*.bak、dev-dongle 永拒读 | - |

### 显示契约
- 审批窗: 权限逐项 + 风险分级(process=红色高危 / 非回环外网域名=橙色 / 读写路径逐条列出, 全部 HTML 转义);声明 process 的插件需**输入插件名**确认;5 秒停留保留。
- 安全与权限卡(L1): 四个策略下拉, 保存走 /api/security。

### 权限契约(插件)
- 官方插件不新增声明;ctx.http 受 networkPolicy;ctx.exec 受 processPolicy;ctx.fs 受沙盒+硬名单;插件直接 require 危险内置模块走审计钩子(默认记录, deny 档拦截)。

## 3. 切片计划(D2)

- [x] 切片 1: config.default + permissions.js 策略/硬名单 + manager.js ctx 接线(可独立 revert)
- [x] 切片 2: 审批哈希纳入 index.js sha256(manager + server approve + plugin-check 同步)
- [x] 切片 3: require 审计钩子(默认审计; processPolicy=deny 拦 child_process; networkPolicy=off 拦 http/https/net/dgram)
- [x] 切片 4: server.js 两个端点 + app.js 审批窗风险分级/转义/输入确认 + lang.js ×3 + 安全卡四下拉
- [x] 切片 5: config-contract 契约 + 文档(使用说明/PROCESS-02/03)

## 4. 验收断言(D3)

- ASSERT: 插件安全默认策略|/api/config|networkPolicy.*whitelist
- ASSERT: 审批窗按风险着色渲染权限(process/写文件=红, 其余=黄)|/app.js|plgPermsHtml
- ASSERT: 高危插件需输入插件名或 ID 确认|/app.js|plgRiskNote
- [x] 影响面回归(PROCESS-01 §6 矩阵)已勾选(2026-09-27: config.default→GCONF、app.js→GHTML/GUWIRE/GBOOT、lang.js→GI18N/GI18NU/GI18NH、server.js 路由→GROUTE + 隔离冒烟、插件→GPLUG、文档→GDOC; 全绿)
- [ ] 用户在自己实例确认(UI/交互类必填)
> **断言重校(2026-09-27)**: 原两条断言写的 `plgRiskHigh` / `plgPermsRisk` 是 2026-09-03 的实现名, 09-11 前端拆分重写后已不存在(仅 lang.js 剩死键) —— **功能仍在, 是断言指错了目标**(见 M-20260927-02)。

## 5. 发布准备(D4)

- [x] 使用说明.txt 章节(插件系统章补"插件安全策略"段 —— GDOC 断言 "插件安全策略的放宽"/"安全策略、授权记录" 守着)
- [x] 版本说明.txt 条目(第十节已写"插件安全收紧: 插件卡新增五个安全策略…0 级可看、可单向收紧, 放宽需一级密码; 审批窗逐项列示权限、高危…")
- [x] README 功能一览(2026-09-27 判定: 现状已列"插件系统自由扩展"; 安全策略细节由《使用说明》与《版本说明》覆盖, **不重复进 README**, 避免三处维护)
- [x] 打包清单: 无新文件(仅 config.default.json / 既有前端文件)
- [x] pack-audit 通过(1.4.x 各次发布均为 AUDIT PASS)

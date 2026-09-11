# 流程 2:开发更新(Feature Development)

> 配套:`docs/PROCESS-01-维护与优化.md`(维护流程)、`docs/GLOSSARY.md`、`docs/FEATURES/`(功能卡)、`scripts/checks/`(门禁)。
> 口径由用户于 2026-09-01 拍板,下列五条是**硬约束**,不是建议。

## 0. 五条硬约束(用户拍板)

1. **新功能默认关闭**;但**涉及安全的功能,其安全类开关强制开启**(例:任何调用 AI / 外部接口的功能,提示词防线、结构化输出、输出消毒必须默认 `true`,只允许一级密码持有者关闭)。
2. **主体已基本完善,新功能优先做成插件**;主体只负责核心功能(采集 → 合成 → OSC 发送 → 控制台)。
3. **发版节奏**:攒够 milestone 且有重要功能才发 1.4.0;平时修 bug、小修控制台**不发次版本**(走流程 1 的补丁位)。
4. **插件单一源**:`plugins/` 是唯一源码位置;`官方可选插件/` 是**用户误删后的恢复备份**,**只存在于打包产物中**,由 `make-dist` 从 `plugins/` 生成,仓库里不得有第二份代码。
5. **`index.html` 拆分**排在下一轮安全审计之后做,作为全流程的第一次实战演练。
   - 【已兑现 · 2026-09-07 复核】功能卡 F-20260902-01(DONE, 条目 92)完成外链化; 随后新版 UI 重写, index.html 由 98,959 字节降至 38,067 字节, 内联脚本由 73,966 字符降至 6,355 字符。**新约定: 后续前端逻辑一律进 `app.js` 或独立 `.js`, 不再往 index.html 内联堆砌**(避免旧债复发)。

## 1. D0 需求受理:功能卡 + 必答七问

新功能一律先建 `docs/FEATURES/F-YYYYMMDD-NN-名字.md`(模板见 `F-TEMPLATE.md`),**七问答不完不许进设计**:

| # | 问题 | 不答清楚的后果 |
| --- | --- | --- |
| 1 | 谁在什么场景下用?(用户故事一句话) | 做出来没人用 |
| 2 | 要不要占聊天框?优先级/显示时长/冲突时谁让位? | 抢占既有显示,用户以为坏了 |
| 3 | 新配置项的全路径 key、默认值、公开版行为? | 公开版缺键(历史坑:漏 `web.host` → `http://undefined:19190`) |
| 4 | 新端点的方法/响应/错误码/**门禁级别**? | 门禁一刀切,公开版用户被锁在门外(条目 58/59) |
| 5 | 新依赖?体积?能否 vendor 化? | 自包含包已 211MB |
| 6 | 失败时怎么降级? | 一个接口挂掉,整个功能哑掉 |
| 7 | **不做什么**(非目标)? | 需求膨胀,一轮做不完 |

先过 **A0 歧义闸**(见 PROCESS-01 §2):功能描述里每个动词都要能唯一映射到实现动作,映射不唯一就回述确认。

## 2. D1 设计:主体 vs 插件 + 四张契约

**决策树(默认答案是插件)**

```
影响核心显示管线(composer / osc / 限频 / 截断)? ──是──→ 主体
      │否
      ↓
所有用户都需要, 且无外部依赖? ──是──→ 主体(慎重, 需说明为何不能做插件)
      │否
      ↓
                                    → 插件(默认)
```

**实现前先写四张契约,写进功能卡:**

| 契约 | 必须写清 |
| --- | --- |
| **API 契约** | 端点、方法、请求/响应 shape、错误码、**门禁级别**(零级 / 一级 / 开发者级) |
| **配置契约** | key 全路径、默认值、`config.default.json` 同步、老配置缺键的兜底(`main.js` 预建对象再传活引用) |
| **显示契约** | 优先级数值、ttl、144 字符预算分配、与既有源冲突时谁让位 |
| **权限契约**(插件) | `manifest.permissions`:network 域名白名单 / filesystem 读写路径 / process / ports |

**关于插件权限的事实**(别误解):`src/pluginsys/permissions.js` 是**契约式权限**——只在插件通过 `ctx.net / ctx.fs / ctx.process` 调用时强制,并写 `logs/plugin-audit.log`;插件若直接 `require('fs')` 可绕过。**真正的信任边界是红窗授权**,权限声明的价值是审计与知情同意。

**插件安全策略(2026-09-03, F-20260903-01)**: 在契约之上叠加了执行级收紧, 默认档(whitelist / consent / sandbox / self)对正常插件透明: ①未声明域名一律拒; ②敏感文件(config.json、*.bak、dev-dongle、src、scripts、logs、dist)硬拒读写; ③审批哈希 = `id@version|api|sha256(index.js)`, 改代码不升版本也会使审批失效; ④插件直接 require 危险内置模块(child_process/http/https/net/dgram/tls)走 `Module._load` 审计钩子(默认记录, `processPolicy=deny` 拦 child_process, `networkPolicy=off` 拦网络模块); ⑤收紧档(localOnly/off/deny/declared)由一级密码经 `/api/security` 热切换。⑥**插件 AI 一律走 `ctx.ai` 网关**(F-20260903-02): 插件声明 `manifest.ai.tasks`, 主体代理复用用户 AI 配置与三层防线, 密钥不进插件上下文, 每插件 5 秒节流, `aiPolicy`(allow/localOnly/off, L1 可切换)。诚实边界不变: 不做进程级沙箱, 本机文件写权限者始终可改代码绕过。

**现有优先级阶梯**(新功能必须在此表里找到自己的位置):

| 优先级 | 来源 |
| --- | --- |
| 99 / 95 | 插件强制播报(打断) / 单条测试 |
| 80 | 临时推送(HTTP API) |
| 70 | 天气播报 |
| 45 / 40 | OCR / 字幕 |
| 35 / 30 | 网易云歌词 / 媒体 |
| 10 / 5 | 电脑状态 / 公告板轮播 |

## 3. D2 实现:切片 + 默认关闭 + 兼容兜底

- **切片交付**:每个 commit 独立可 `git revert`;禁止一次性大改 `index.html`(现状 98,959 字节、单个内联脚本 73,966 字符)
- **默认关闭**:新功能在 `config.default.json` 里 `enabled:false`(`config-contract.js` 会对默认开启的源发 WARN)
- **安全开关强制开**:凡涉及 AI / 外部内容注入的功能,其安全开关默认 `true`,并加进 `config-contract.js` 的 `SECURITY_TRUE` 列表(门禁会守住)
- **向后兼容**:老配置缺新键必须有默认值兜底
- **i18n 三语同步**:GI18N 拦

**插件改版必做五件事**(漏一件用户就会以为坏了):

1. `manifest.version` +1
2. 授权哈希 `id@version|api`(`manager.js:55`)随之失效 → **更新说明必须写"需重新红窗授权一次"**
3. 若 `config.default.json` 预置了 `pluginApprovals`,同步(`plugin-check.js` 会比对)
4. 重建 `dist/插件更新包/<id>-<版本>.zip` + 更新说明(`plugin-check.js` 会比对版本)
5. **不需要**再手工同步 `官方可选插件/` —— 打包时自动从 `plugins/` 生成

**例外(2026-09-02 增补, 来自条目 93): 纯文案/描述类改动(面板说明、说明书、i18n 文本)可不升 manifest.version** —— 不升版本 = 授权哈希不失效 = 用户无需重新红窗授权; 但必须与 ISSUES 卡关联记录, 且 `dist\插件更新包` 重打时同步携带(plugin-check 只比对版本, 不会发现内容旧)。

## 4. D3 验收:成功标准必须是可执行断言

功能卡里的成功标准写成 `- ASSERT: 名字|/api/路径|期望正则`,然后:

```powershell
powershell -File scripts\checks\feature-accept.ps1 -Card docs\FEATURES\F-20260901-01-xxx.md -Port 19260
```

**验收四层**:①契约测试(正例 + 错误码 + 未解锁 403)②功能卡断言全绿 ③影响面回归(PROCESS-01 §6 矩阵)④**用户在自己实例上确认**(UI / 交互类必须,AI 判断不了"顺不顺手")。

## 5. D4 集成与发布准备

- 版本:达到 milestone 才 +次版本(1.4.0);未达标的改动按流程 1 走补丁位
- 文档四同步:`使用说明.txt` 章节 / `版本说明.txt` 条目 / `README.md` 功能一览 / `DEV-NOTES` 条目; **凡改动功能描述/位置/权限口径, 同步更新 `docs/DOC-BASELINE.json`(GDOC 门禁的 must/mustNot 断言, 人工复核)**
- **打包清单同步**:新增根目录文件默认视为"会进包",明确决定进 `$required` 还是 `$xfFiles`
- 出包后必须跑 `pack-audit.js`(会校验:插件本体 + 官方可选插件恢复备份 + 盐一致 + 机密扫描)
- 最后走流程 3(安全审计)的发布前检查

## 6. 门禁(在流程 1 基础上新增三个)

| 门 | 检查 | 脚本 |
| --- | --- | --- |
| **GPLUG** | 插件单一源、manifest 契约(id/version/api/permissions/index.js)、vendor 引用真实存在、更新包版本一致、预置授权哈希不过期 | `plugin-check.js` |
| **GCONF** | 必备键齐全、**安全开关默认 true**、公开版无私有内容、默认开启的源白名单、代码读取的键都有默认值 | `config-contract.js` |
| **验收** | 功能卡断言批量跑 | `feature-accept.ps1` |

一条命令跑全套:

```powershell
powershell -File scripts\checks\run-gates.ps1 -Smoke
```

## 7. 技术债台账(流程 2 排期,不混进流程 1)

| 债 | 现状 | 计划 |
| --- | --- | --- |
| `index.html` 内联脚本残留(**改判**, 2026-09-11 审核) | 原判"已还清"不准确: 剩余 6,355 字符**是真实功能逻辑** —— 主题系统 3,553 字符(THEMES 六套配色 + 色板 + KEYMAP)与星空背景 2,802 字符(canvas fx, 对外暴露 window.__fxRestart), 均与 PROCESS-02 §0 #5"前端逻辑只进 app.js"的约定冲突 | 低优先级: 迁到 theme.js / fx.js, HTML 只留 script 外链 |
| ~~插件 vendor 重复~~ | **已还清**: 三插件各裁到 4 文件(约 2.2MB/插件, 原 7.1MB); 剩重打包与体积基线更新见 M-20260901-04 | 重打包收尾(待用户指令) |
| 三插件 vendor xlsx 版本漂移 | weather-board 0.18.5 vs 另两个 0.20.3 | M-20260904-01: 统一 0.20.3 + 回归 Excel 导入/导出, 与 M-20260901-04 一并重打包 |
| `lang.js` 单文件 579 键 72.7KB | 三语混排, 体积随新 UI 增长(原 285 键 40KB) | 低优先级; 若继续增长再评估按 Tab 拆多文件 |
| `app.js` 单文件密度 | 66.5KB / 440 行 / 平均 154 字符每行 / 24 行超 500 字符 / 最长 1,507; 分区: "数据源/状态" 180 行、"安全与权限(旧版套皮)" 155 行 | 低优先级: 按功能拆多文件(保持无构建步骤, 顺序 script 或 ESM), 至少把"安全与权限(旧版套皮)"整块独立出去 |
| `server.js` 路由链 | 909 行, 55 条路由挤压在 L141~L866 的单条 if/else 链(约 725 行); 门禁与错误返回靠逐条手写 | 中优先级: 抽成路由表 + 统一 needL1/needL2 与错误包装器; 是漏门(M-20260911-02)与静默失败的共同解法 |
| 跨文件隐式契约 | 13 个 window.* 全局无声明处: app.js 读 window.__fxRestart / __reThemeLabels(index.html 内联块写入), index.html 内联块读 window.t | 低优先级: 随内联块迁出一起收敛, 或集中为单一 window.VRCB 命名空间并在文件头写明契约 |
| 主题命名三套并存 | 配置存 blue → KEYMAP 映射中文"海蓝" → THEME_LABELS 再映射 i18n 键 themeOcean; setTheme("海蓝") 以中文名作内部标识 | 低优先级: 内部一律用 key(blue), 显示名走 t(); 与内联块迁出合并做 |
| 前后端静默失败 | **前端已还清**(2026-09-11 批 2): 56 处空 catch 接入 apiFail() —— 按位置去重只报一次, 统一走 feErr() 且上报失败即停(同时修掉 上报失败→unhandledrejection→再上报 的自激); 剩 2 处保留为空 = 上报链路自身。后端 server.js 另有 22 处空 catch 未处理 | 后端 22 处随批 3(抽路由表 + 统一错误包装)一并处理 |
| 无 lint / 单测 / CI | 无 eslint / prettier / tsconfig / .github; package.json 只有 start 与 desktop 两个脚本; 24 个 checks 脚本靠 run-gates.ps1 手工串 | 低优先级: 把 checks 挂成 npm scripts(不引入新依赖), 便于编辑器与 CI 复用 |


**待复验(2026-09-11 代码审核: 子代理报告, 本人未逐条复核, 勿直接当结论)**
- H3 配置导入只写 config.json 不动 rootConfig, 后续 persist() 会以旧内存覆盖导入结果(server.js:801-811 对 101-103)
- H4 electron/main.js:21 CONSOLE_URL 写死 19190, 而服务端端口被占会 port++ 回退(server.js:891-903)、改端口仅置 needRestart → 端口被占或改端口后桌面窗口白屏且无提示
- H5 无统一 shutdown: main.js:32/44/55 的 setInterval 句柄未保存; web.stop()(server.js:906)与 media.stop() 从未调用; quit/restart 直接 process.exit → python 助手 5 秒自愈重拉 + 端口残留
- M1 readBody 无 error/aborted 处理, 超 256KB 时 req.destroy() 不回响应; /api/health 触发多次 netstat/tasklist 阻塞事件循环
- M5 pluginsys/manager.js 定时器只增不减, disable 不清插件 interval, 反复 restart 会累积
- L1 logger.js 与 autostart.js 双写同一 app.log 且按 1MB 截断(会交错半行); L3 /api/special/video 的 Range 处理在 bytes=5000-100 时会算出负 Content-Length
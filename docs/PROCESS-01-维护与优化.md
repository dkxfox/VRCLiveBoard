# 流程 1:维护与优化(Maintenance & Optimization)

> 适用对象:接手本项目的人类开发者与 AI。**本文件是可执行的操作规程,不是建议。**
> 配套:`docs/PROCESS-04-工作规范.md`(**行动纪律 12 条, 所有流程共用的"怎么做"**)、`docs/GLOSSARY.md`(术语)、`docs/ISSUES.md`(问题登记)、`scripts/checks/`(门禁脚本)。

## 0. 为什么要有这份东西

2026-09-01 一天之内出过三类事故:发布包里混进含真实 API key 的 `config.json.bak`(靠"排除清单"防护,而清单是黑名单)、公开版 README 只改了上传副本导致双向漂移、PS 脚本无 BOM 被按 GBK 读导致中文路径找不到。三次的共同点都不是"不会写代码",而是**没有机器化的关卡**。

因此本流程的设计原则只有三条:

1. **机器判定优先**:能被脚本判定的事,不接受自然语言结论。
2. **默认危险,显式安全**:新增文件默认当作"会进包";删除默认当作"不可逆"。
3. **单一真相源**:项目根即唯一副本;任何"另一份拷贝"都是事故温床。

## 1. 适用范围与红线

**属于流程 1**:bug 修复、交互/文案优化、性能与稳定性小改、文档同步、依赖小版本升级。
**不属于**(转流程 2 / 3):新功能、新插件、新接口、UI 结构大改、加密狗与门禁逻辑变更、**发布产物构成变更**(增删随包文件、改官方可选插件恢复备份的构成等)。

**打包脚本的归属(2026-09-27 澄清, 修掉原文与 §5 / §6 的自相矛盾)**: `scripts\make-dist.ps1`、`scripts\pack-*.js`、`scripts\checks\*.ps1` 等**打包/门禁脚本自身的缺陷修复属于流程 1**, 按 §5 的 H 档处理(≤2 文件 / ≤80 行, 独立提交, 且必须实跑打包 + GPACK 作证据); 而**改产物构成或打包策略**(例如决定某个目录进不进包)属于流程 2, 要登记功能卡。一句话:**修脚本走流程 1, 改产物走流程 2**。

| 约束 | 值 |
| --- | --- |
| 版本语义 | 只允许补丁位 +1(如 1.3.1 → 1.3.2) |
| 红线 | ①不碰用户实例 **19190** ②不改用户 `config.json` ③密钥/凭据永不进会话/提交(含 API key、母狗口令、一级密码、token)④只改项目根; **凭据投影规则**: 查询含凭据文件(如 授权登记表.xlsx)时只输出投影列(姓名/状态/次数/布尔), 不打印口令值 —— 2026-09-02 增补 |
| 测试端口 | 19250 / 19260(smoke.ps1 已硬性拒绝 19190) |

## 2. A0 指令歧义审查闸(所有流程共用,置于最前)

> 由来:"把库存为 1 的商品加入购物车"被理解成"库存 -1 → 变 0 → 删除商品"。本项目的等价物是"清空一切原有授信数据"是否包含母狗口令备份。

**判定式:是否必须停下确认 = 不可逆性 × 影响范围 × 歧义度**

| 情形 | 处置 |
| --- | --- |
| 动作**可逆**(改代码、加文件、能 `git revert`)且歧义低 | 直接做,做完报告里写明"我的解读是 X" |
| 动作**不可逆**且存在任一歧义 | **必须回述确认**,不许"合理推测" |
| 混合 | **先做可逆部分**,不可逆部分单独列出确认 |

**回述确认协议**(四要素,禁止用"你确定吗"代替):
1. 我理解的动作 =(动词 + 对象 + **范围边界**)
2. 执行后会**消失或永久改变**的东西 =(逐条)
3. 我**不会**动的东西 =(边界)
4. 回滚方式 =(能撤/怎么撤/撤不了就明说)
→ 给出 A/B/C 选项,不用开放式提问。

**不可逆动作清单**(命中即触发确认):删除或替换 Release 资产、force-push / 改写历史、清空授权登记表、轮换盐或密钥、删除 `dist` 产物、覆盖用户 `config.json`、`taskkill` 用户实例、对外发包、删除任何"可能是最后副本"的文件。

**最后副本规则**:删除任何可能唯一的东西之前,**必须先用机器输出证明另有可用副本**(例:删母狗备份前先验证 `master-pass.txt` 能通过 verifier)。

**AI 自检三问**(写进 DEV-NOTES 的"解读与边界"一行):这句话有没有第二种合理解读?执行后什么会消失?理解错了能不能撤回?

## 3. 主流程 M0 → M4

| 阶段 | 动作 | 产出 | 不满足不许进下一步 |
| --- | --- | --- | --- |
| **M0 登记** | 在 `docs/ISSUES.md` 开卡:编号 / 来源 / 现象 / **复现步骤** / 影响面 / 严重度 / 状态 | 一行卡片 | 没有复现步骤 → 标 `NEED-REPRO` 回问,**不许猜着开工** |
| **M1 取证** | 隔离实例复现(`smoke.ps1 -Port 19250`),取 `logs/app.log` 尾部 + `/api/diagnose` | 根因一句话("因为 X 所以 Y") | 根因含"可能/也许" → 回 M1。**L 档(文案/i18n/样式/日志措辞)例外**: 允许"代码级取证 + 修复后隔离实例断言"代替事前复现(2026-09-02 增补, 来自条目 93 的 M1 成本失衡) |
| **M2 改动** | 只修这一个根因;禁止顺手重构 | 改动文件清单 | 超出规模档位 → 见第 5 节升级条款 |
| **M3 门禁** | `run-gates.ps1`(必要时 `-Smoke` / `-Pack`) | **GATES SUMMARY 表** | 任一 FAIL 或未跑 → 不许说"已修复" |
| **M4 收口** | 版本同步 → **GDOC 说明文件一致性(改动了功能描述/位置/口径必跑, 基线同步更新)** → DEV-NOTES 条目 → commit/push → **`node scripts\checks\git-sync-check.js`(机器证据, 不许用 git status 人工代替)** → 关卡片 | 提交号 + GSYNC PASS | GSYNC 非 PASS → 未收口 |

**严重度与响应**:S1 崩溃/数据丢失/安全 → 立即单独发补丁;S2 主功能不可用 → 24 小时内;S3 体验 / S4 优化 → 攒批,满 5 条或满一周发一个补丁版。

## 4. 门禁清单(全部机器可判定)

一条命令跑完:

```powershell
powershell -File scripts\checks\run-gates.ps1 -Smoke -Assert '被修的bug|/api/xxx|期望正则'
```

| 门 | 检查 | 脚本 | 来自哪次事故 |
| --- | --- | --- | --- |
| **G1** | 改动文件语法(js / ps1 / json) | run-gates 内置 | 数组元素断行导致 node --check 失败(条目 73) |
| **G2** | 编码规范:bat=无BOM+CRLF+非UTF8中文;含中文 ps1=单 BOM;js/json=无 BOM | `encoding-lint.js` | 81 / 66 / 85 |
| **GVER** | 版本号七处一致(package/version.json/使用说明×2/版本说明×2/README×2) | `version-sync.js` | 61 / 82 |
| **GI18N** | zh-CN / zh-TW / en 键集合一致 | `i18n-check.js` | 65 / 71 |
| **GI18NU** | i18n 引用完整性: `tr('key')` / `data-t` 引用的键必须存在于 lang.js; 附占位符 WARN | `i18n-usage.js` | 114 |
| **GI18NH** | 硬编码文案检测: 未接 `data-t` 的中文与 I18N-BASELINE 白名单比对, **新增即 FAIL** | `i18n-hardcode.js` | 114 |
| **GHTML** | 内联脚本**动态边界**语法 + id 唯一 + getElementById 目标 | `html-inline-check.js` | 81 / 19 |
| **GUWIRE** | 控件接线: index.html 里带 id 的交互控件必须在 app.js 里找得到引用(HTML→JS 方向, 与 GHTML 互补) | `ui-wiring.js` | 121(M-20260907-01 的 20 个死按键) |
| **GBOOT** | 前端启动可执行性: DOM 桩件里真跑 lang.js + app.js, 断言无异常 / 无 unhandledRejection / 启动动画分支可达 | `frontend-boot.js` | 121(M-20260911-01 启动动画静默失效) |
| **G4** | 隔离冒烟:临时目录 + 测试端口真启动 + 8 项端点 + **本次专项断言** | `smoke.ps1` | 30(测试打到用户实例) |
| **GPLUG** | 插件单一源 + manifest 契约 + 更新包版本 + 预置授权哈希 | `plugin-check.js` | 63 / 72 |
| **GCONF** | 必备键 + **安全开关默认 true** + 公开版无私有内容 | `config-contract.js` | 15 / 31 |
| **GROUTE** | 后端口径清单: server.js 的 (method, path, 门禁等级) 必须与 ROUTES-BASELINE.json 完全一致 | `route-inventory.js` | 129 |
| **GDOC** | 说明文件过时检查: DOC-BASELINE 的 must/mustNot 子串断言 + 引用文件存在 | `doc-consistency.js` | 2026-09-03 文档漂移审计 |
| **GPACK** | 发布包审计:禁入文件 / UTF-8 文件名标志 / config 脱敏 / **包内盐与源码一致** / **官方插件恢复备份齐全** / 全量机密扫描 | `pack-audit.js` | 85 / 67 / 87 |
| **GSYNC** | 工作区干净 + 与 origin/main 零差 + 无悬空未跟踪文件 | `git-sync-check.js` | 84 |

**运行开关(2026-09-27 补记)**:快跑 **14** 个门(G1/G2/GVER/GI18N/GI18NU/GI18NH/GHTML/GUWIRE/GBOOT/GPLUG/GCONF/GROUTE/GDOC/GSYNC);`-Smoke` 追加 **G4** 隔离冒烟;`-Pack <zip>` 追加 **GPACK** 包审计;`-SmokeOnly` 只跑 G4(必须与 `-Smoke` 同用)。
**这份名单必须与 `run-gates.ps1` 的 GATES SUMMARY 一致** —— 新增/改名门禁时两处一起改(GDOC 会守本文件的关键子串, 见 `docs\DOC-BASELINE.json`)。

**证据规范**:只有 `GATES SUMMARY` 表可以作为"已验证"的证据贴进 DEV-NOTES;禁止用"我检查过了 / 应该没问题"代替。

## 5. 改动规模:风险分档 + 可回滚硬指标

| 档位 | 典型改动 | 预算 | 门禁 |
| --- | --- | --- | --- |
| **L 低风险** | 文案、i18n、样式、日志措辞 | 不限文件数 | G1 + G2 + GI18N |
| **M 中风险**(默认) | 单模块逻辑修复 | ≤ 5 文件 / ≤ 200 行 | G1–GHTML + G4 + 影响面矩阵 |
| **H 高风险** | 跨模块、门禁/加密狗、OSC 协议、打包脚本 | ≤ 2 文件 / ≤ 80 行,拆成独立提交 | 全门禁 + 用户确认 + 沙箱专项 |

**真正的硬指标是可回滚性:每个 commit 必须能单独 `git revert` 而不破坏构建。**

**超限不是禁止,而是触发升级条款**(任选其一):① 拆成多个可独立回滚的提交;② 补齐对应回归项并写明;③ 在 DEV-NOTES 说明"为什么必须一次做完"。

**同质小修批量条款**(2026-09-02 增补, 来自条目 93): 同一批同质 L/M 档修复可以合并为一个 commit(即使合计文件数超过 M 档的 5 个), 档位按"任一单修的最高档"计, 合并批一律跑全门禁 + 影响面矩阵, 并在 DEV-NOTES 写明"为什么必须一次做完"。禁止跨档混批(例如把 H 档门禁改动混进 L 档文案批)。

## 6. 影响面矩阵(改左边 → 必测右边)

| 触碰文件 | 强制回归项 |
| --- | --- |
| `src/composer.js` | 优先级排序 / 轮播 / 144 截断 / 1.2s 限频 / 脏话过滤仍在发送前生效 |
| `src/osc.js` | **三参数直发不弹窗**(s,T,F)、限频 |
| `src/web/server.js` | 路由契约(200/403 各自正确)、`no-store`、未解锁时 403 |
| `src/web/public/index.html` | GHTML + 侧边栏锚点 + 三语渲染 |
| `src/web/public/lang.js` | GI18N;新增文案必须三语同补(GI18NU/GI18NH 会反向检查引用与硬编码) |
| `src/web/public/app.js` | GHTML + GUWIRE + GBOOT(控件接线与启动可执行性都在这里);`apiFail` 静默失败上报仍在;切语言走 `reRenderAll()` |
| `plugins/**` | GPLUG;版本号变更 → 授权哈希失效 → **必须提示用户重新红窗授权**;`plugins/` 是唯一源,`官方可选插件/` 由打包生成,**不要手工同步第二份** |
| `src/pluginsys/manager.js` | GPLUG + 隔离冒烟的**插件生命周期**(批准→启用→接口→停用→再启用)、`manifest.settings` 渲染与保存热生效、`registerSource` 默认 `enabled` 为真 |
| `config.default.json` | GCONF;新功能默认关闭、安全开关默认 true、公开版无私有内容 |
| **文档事实变更**(功能描述/位置/权限口径/文案) | **GDOC**;同步更新 `docs/DOC-BASELINE.json` 并经人工复核 |
| `src/devgate.js` / `dev-dongle/master/master.js` | 两处盐逐字一致 + 沙箱七项(注册→发码→接受→重放拒→旧盐拒→迷你狗盐→登记表未污染) |
| `启动*.bat` | G2 + 含空格路径双击可用 |
| `scripts/make-dist.ps1` | 单 BOM + PARSE_OK + 实跑打包 + GPACK |
| `package.json` / `package-lock.json` / `plugins/*/vendor/**`(第三方组件) | dep-audit(依赖清单 + 8 项产物哈希)+ **`docs/THIRD-PARTY.md` 同步**(版本 / 许可证 / 来源 / 是否随包) |
| `scripts/checks/**`(门禁自身) | **门禁红队自测**(`release-audit.ps1` 第 0 步 / `gate-selftest.ps1`):改了门禁就必须证明它**还能抓住原来能抓的东西** —— 扫描器自己绿了比漏报更危险 |
| `src/versioncheck.js` | 多源取最高 / releaseUrl 白名单 / 6h 缓存 |
| **任何新增的根目录文件** | **默认视为"会进包"**:确认是否要加进 `$xfFiles` 排除 |

## 7. DEV-NOTES 条目模板(固定六段)

```
NN. **一句话标题**(日期, 触发人/来源):
- 解读与边界: 我把这句话理解成什么 / 不动什么(A0 产物)
- 现象: 用户原话 + 复现步骤
- 根因: 因为 X 所以 Y(禁止"可能")
- 改动: 文件:行为(逐条)
- 证据: GATES SUMMARY 表 + 关键命令输出摘要
- 遗留 / 教训
```

## 8. 会话开场与收尾清单(AI 专用)

**开场五件事**:① 读 `DEV-NOTES` §1–2 + 最近 3 条条目 ② 读 `ISSUES.md` 未关闭项 ③ 跑 `git-sync-check.js` ④ 确认用户实例是否在跑(在跑就绕开)⑤ **读 `docs\PROCESS-04-工作规范.md` §0 速查**(行动纪律, 2026-09-27 增补)。

**收尾五件事**:① `run-gates.ps1` 汇总表 ② DEV-NOTES 条目 ③ 版本一致(GVER) ④ commit + push,GSYNC PASS ⑤ 清临时文件 / 端口 / 凭据。

## 9. 常用命令速查

```powershell
powershell -File scripts\checks\run-gates.ps1 -AllowDirty        # 改到一半的自检
powershell -File scripts\checks\run-gates.ps1 -Smoke             # 提交前完整门禁
powershell -File scripts\checks\smoke.ps1 -Zip dist\公开版\xxx.zip -Port 19260
node scripts\checks\pack-audit.js dist\公开版\*.zip             # 发布前包审计
node scripts\checks\version-sync.js                              # 改版本号后
node scripts\checks\auth-state-check.js                         # 授权体系状态(流程 3 的 3A; 开发者机)
node scripts\checks\doc-consistency.js                          # 说明文件过时检查(GDOC)
powershell -File scripts\checks\run-gates.ps1 -Smoke -SmokeOnly  # 只跑隔离冒烟(前端/接口改动的自检)
powershell -File scripts\make-dist.ps1                            # 打包(改打包脚本后必跑; -SkipLight 只出桌面包)
powershell -File scripts\checks\release-audit.ps1                 # 3B 发布前检查(11 步; 见 PROCESS-03 §2)
powershell -File scripts\checks\feature-accept.ps1 -Card docs\FEATURES\F-xxx.md  # 功能卡验收断言
powershell -File scripts\checks\audit-3a.ps1                      # 3A 一键(机密扫描 + 攻击面 + 依赖/产物)
node scripts\checks\secret-scan.js                               # 3A 机密扫描(工作区 + git 历史)
node scripts\checks\surface-scan.js                              # 3A 攻击面基线比对
node scripts\checks\dep-audit.js                                 # 3A 依赖审计 + 产物哈希
node plugins\bilibili-live\test\run-all.js                       # 插件离线单测(任一插件改版后跑自己那份)
```

## 10. 数据与产物留存与清理周期(2026-09-27 增补)

原则: **可再生的清, 不可再生的留; 含凭据的立刻删; 证据链永久留。**

| 对象 | 策略 | 谁来做 |
| --- | --- | --- |
| `dist\公开版\` 旧版本包 | 只留**当前版本**(打包前目录先清空) | `make-dist.ps1` 自动 |
| `审计报告-AUDIT-*.txt`(仓库根) | **永久保留** —— 发布证据链, 不参与清理 | 人工 |
| `logs\`(用户侧 app.log / boot.log / 插件审计日志等) | 超 100KB 只留尾部 100KB; 超 30 天删除; 残留截图临时文件超 1 天删除; 旧版本 electron 缓存删除 | `src/housekeeping.js` 每 6h 自动 |
| `.electron-cache` / `.pydist` / `.ocr-langs`(开发机) | **保留**(删了要重新下载或编译); 空间紧张时再删, 删前在 DEV-NOTES 记一条 | 人工 |
| `config.json.bak` 及任何含口令/密钥的副本 | **立刻删** —— 属机密面(secret-scan 会扫到) | 人工 |
| `DEV-NOTES.md` / `ISSUES.md` / `docs` 下的基线 | 永久, **只归档不删除**(历史本身就是证据) | 人工 |
| 临时脚本与中间产物 | 一律写 `$env:TEMP`, 不落仓库(PROCESS-04 §11 第 6 条) | 人工 |

**节奏**: 每个 milestone 发布收口时做一次清点 —— ① `git status` 无悬空文件 ② `dist` 只剩当前版本 ③ 缓存体积记录在案 ④ 临时文件已清; 结果写进当次 DEV-NOTES 条目。

**清理属"可逆性存疑"的动作**: 不确定能不能再生的, 先问再删; 已经删掉的, 在 DEV-NOTES 里留一句"删了什么、为什么可再生"。

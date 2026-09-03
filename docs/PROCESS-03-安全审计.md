# 流程 3:安全审计(Security Audit)

> 配套:`docs/SECURITY-BASELINE.json`(攻击面/依赖/产物哈希基线)、`scripts/checks/` 里的安全门禁。
> 原则:**审计器本身也要被审计** —— config.json.bak 泄密的根因不是没有扫描器,而是扫描器有盲区却没人发现。

## 0. 三个子流程

| 子流程 | 何时触发 | 必跑 | 产出 |
| --- | --- | --- | --- |
| **3A 定期检查** | 每次重大改动收尾;或每周 | secret-scan / surface-scan / dep-audit / gate-selftest / **auth-state-check(授权体系状态, 开发者机)** / **doc-consistency(说明文件与实况一致性)** | 发现项列表(分级 C1-C4) |
| **3B 发布前检查** | 每次打包发布前(补丁/次版本/插件更新包) | release-audit.ps1(7 步一次跑完) | 审计报告 + SHA256SUMS |
| **3C 完整性测试** | 与 3B 合并执行 | 产物哈希基线比对 + 校验和公示 + 解包审计 | 哈希清单 |

## 1. 发现项分级与处置时限

| 级别 | 含义 | 示例 | 时限 |
| --- | --- | --- | --- |
| **C1** | 密钥/凭据泄露、可被外部利用 | 真实 API key 进包 | **立即**:吊销、清理、发补丁 |
| **C2** | 发布物有缺陷、依赖有已知高危漏洞 | zip 缺文件、npm audit 高危 | 发布前必修 |
| **C3** | 需要排期修 | 中低危依赖、架构债 | 进 ISSUES,定 milestone |
| **C4** | 仅记录 | 文档不一致 | 顺手修 |

## 2. 3B 发布前检查(release-audit.ps1 的七步)

1. **门禁自测(红队夹具)**:先往临时副本注入 10 类故障(明文密钥 / bat 乱码 / ps1 缺 BOM / 版本只改一处 / 语言包缺键 / 内联脚本语法 / 插件二副本 / 安全开关被关 / 新增未知域名 / **断言机制失效(中文+多断言转发)**),全部必须被拦住。**这步 FAIL 时,后面所有 PASS 都不算数。**
2. **机密扫描**:工作区(无扩展名白名单)+ **git 历史全部 blob**(密钥进过历史,删文件没用)。
3. **攻击面基线**:出厂代码的外部域名 / 端口 / 危险 API 用法必须与 SECURITY-BASELINE.json 一致 —— 新增任何一项都必须显式进基线。
4. **授权体系状态**(auth-state-check, 开发者机):登记表行数(只投影姓名/状态/次数)/ config.json 锚点剩余次数 / 两处链盐一致 / mini-template 三件套 / 母狗密钥对 / 开发者申请版内容; 非开发者机自动跳过。
5. **依赖与产物完整性**:依赖清单变动 + 关键产物哈希(exe/ico/launcher.cs/smtc.py/插件 vendor 聚合)+ npm audit。
6. **常规门禁**:run-gates(G1/G2/GVER/GI18N/GHTML/GPLUG/GCONF)。
7. **隔离冒烟**:临时目录 + 测试端口 19260,8 项端点。
8. **发布包审计**:pack-audit(禁入文件/UTF-8 标志/脱敏/盐一致/恢复备份齐全/机密扫描/**体积与 zipVolumes 基线比对, 漂移即 FAIL**)+ 生成 SHA256SUMS-v<版本>.txt(把校验和写进 Release 说明公示)。

最后 git-sync-check 确认工作区与 origin 零差。**发布允许条件 = 报告结尾出现 AUDIT PASS,且第 0 步自测 10/10。**

## 3. 基线文件管理

- docs/SECURITY-BASELINE.json 有四个区块:surface(攻击面)、supplyChain(依赖+产物哈希)、zipVolumes(发布包体积/条目数, 按包种类 Lite-RequiresNode / Desktop-SelfContained)、updatedAt。发布重打包后, 用 pack-audit 打印的体积/条目数更新 zipVolumes(漂移比对依赖它)。
- **更新基线的唯一方式**:跑 --update-baseline 并**人工复核打印出来的每一项**再提交。基线更新本身是高危操作,必须走 A0 确认。
- 任何「基线变了」的提交都要在 DEV-NOTES 里写明:变了什么、为什么、谁审过。

## 4. 威胁模型(每次审计先复读)

| 威胁 | 项目现状 | 防线 |
| --- | --- | --- |
| 提示词注入(截图/字幕/插件输入里的恶意文本) | 视觉翻译吃外部图片文字; 插件 AI 吃插件传入文本 | 三层防线 + outputSanitize 默认开(条目 22.5);插件 AI 经 ctx.ai 网关同套防线(F-20260903-02);GCONF 守开关 |
| 插件作恶(任意代码) | 插件是普通 Node 模块 | **红窗授权是真正的信任边界**;契约权限 + 插件安全策略(F-20260903-01: 默认透明收紧 + 硬拒名单 + 内容哈希 + require 审计钩子 + 一级可切换的收紧档); 诚实边界: 防不了本机所有者改代码 |
| 供应链篡改 | 依赖 6 个、vendor 3 份、关键二进制 5 个 | dep-audit 哈希基线 |
| 机密泄露 | 本地 config 含真实 key | 打包三道闸 + secret-scan + git 历史扫描 |
| 仿冒分发 | 代码公开 | README 唯一渠道声明 + Release SHA256 公示 |
| 本机物理窃取 | 用户明示不担心 | 三级门禁 + 一次性码(见条目 37) |

## 5. 已处理发现项(格式即模板)

### A-20260902-01 ws 8.18.0 高危(经 osc 依赖)
- 级别: C2。证据:npm audit 报 GHSA-58qx-3vcg-4xpx(未初始化内存泄露)+ GHSA-96hv-2xvq-fx4p(内存耗尽 DoS)。
- 暴露评估:我们只用 osc 的 UDPPort(UDP 发送),不建 WebSocket;但 ws 仍在依赖树上且 node_modules 会随自包含包出厂 → 按 C2 处理。
- 处置:package.json 加 overrides 把 ws 抬到 8.21.3(osc 声明的是精确 8.18.0;overrides 强制抬升后 osc 2.4.5 加载正常,UDPPort 可用)。复查 npm audit = 0 vulnerabilities。
- 教训:别跑 npm audit fix --force(会把 osc 降级到 2.4.2,破坏性变更);用 overrides 精确抬升最安全。

### A-20260902-02 门禁自测首跑抓出两个盲区
- 级别: C4(流程自身)。①encoding-lint 的 bat 检查只看整文件是否合法 UTF-8,漏掉「GBK 文件里混入 UTF-8 中文行」的混合编码 → 改为逐行判定;②自测夹具本身写错了故障(把 UTF-8 字节追加到 GBK 文件,整文件反而不合法 UTF-8,检测不到)。双双修复后 9/9。
- 教训:红队夹具第一次跑就抓到了「检查器盲区 + 夹具错误」两个问题 —— 这步绝不能省。


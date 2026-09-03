# 问题登记表(ISSUES)

> GitHub Issues 已关闭(问题清单不对外),使用者反馈走群/私聊,由维护者登记到这里。
> 规则:**先登记再动手**;没有复现步骤的标 `NEED-REPRO` 并回问;修完必须写"验证方式"。

## 卡片模板

```
### M-YYYYMMDD-NN 一句话标题
- 状态: OPEN | NEED-REPRO | FIXED | CLOSED | WONTFIX
- 严重度: S1 崩溃/数据/安全 | S2 主功能 | S3 体验 | S4 优化
- 来源: 谁在什么场景下报的
- 现象: 用户原话
- 复现: 1. … 2. … 3. 期望 X,实际 Y
- 影响面: 哪些版本/哪些人受影响
- 根因: (M1 之后填,禁止"可能")
- 改动: 文件:行为
- 验证: GATES SUMMARY / 专项断言 / 用户确认
- 关联: DEV-NOTES 条目号、commit
```

---

## 进行中

### M-20260902-05 快捷导航 ☰ 按钮不显眼, 改为文字
- 状态: OPEN
- 严重度: S4
- 来源: 用户反馈(2026-09-02)
- 现象: 侧边栏收起时页头只显示 ☰ 符号, 视觉上不明显
- 复现: 窄屏(<980px)或收起侧边栏后看页头按钮
- 影响面: 全部控制台用户

### M-20260902-06 健康总览 UDP 9000 行红色指示灯误报
- 状态: OPEN
- 严重度: S3
- 来源: 多名使用者反馈
- 现象: "UDP 9000 空闲: VRChat 没在监听" 一直红灯, 被误认为软件异常
- 影响面: 全部用户

### M-20260902-07 公告板变量 {song} {artist} {album} 不好用
- 状态: OPEN
- 严重度: S3
- 来源: 使用者反馈
- 影响面: 使用公告板 + 媒体变量的用户

### M-20260902-08 网易云歌词设置描述文本过时
- 状态: OPEN
- 严重度: S4
- 来源: 用户要求
- 影响面: 网易云插件用户

### M-20260901-04 插件 vendor 重复导致包体积膨胀
- 状态: OPEN
- 严重度: S4
- 来源: 流程 2 落地时实测(启用官方插件恢复备份后)
- 现象: friend-welcome / scheduled-board / weather-board 各自带一份 ~7MB 的 xlsx vendor(仓库内合计 21MB);启用"官方可选插件"恢复备份后,lite 包 11.9MB → 20.2MB,自包含包 221.7MB → 230.0MB
- 根因: 三个插件各自复制了完整 xlsx 发行版(含 .map / extendscript / full.min / mini.min 等运行时用不到的文件),打包时又复制一份作恢复备份 → 同一份库进包 6 次
- 候选方案: ①**裁剪 vendor**(只保留 `xlsx.js` + `dist/cpexcel.js`,预计每插件省 ~6MB,且不破坏"复制文件夹即可装回"的自包含特性)②共享 vendor(会破坏插件自包含,不推荐)③备份不含 vendor(恢复后 Excel 导入会坏,不推荐)
- 影响面: 仅体积;功能不受影响
- 待办: 验证插件实际引用了哪些 vendor 文件 → 裁剪 → 跑 Excel 导入/导出实测 → 重打包对比体积

## 已关闭

### A-20260902-01 ws 8.18.0 高危(经 osc 依赖)
- 状态: CLOSED
- 严重度: S1(安全, 按 C2 流程处置)
- 来源: 流程 3 首轮 npm audit
- 现象: GHSA-58qx-3vcg-4xpx(未初始化内存泄露)+ GHSA-96hv-2xvq-fx4p(内存耗尽 DoS), ws 8.18.0 由 osc@2.4.5 精确依赖带入
- 根因: osc 锁死 ws 8.18.0(修复版为 8.21.3)
- 改动: package.json 加 overrides {"ws": "8.21.3"}
- 验证: npm audit = 0 vulnerabilities;osc UDPPort 加载正常;smoke 8/8
- 关联: DEV-NOTES 条目 91

### A-20260902-02 门禁自测首跑抓出两个盲区
- 状态: CLOSED
- 严重度: S4(流程自身)
- 现象: 红队夹具首跑 8/9 —— encoding-lint 漏掉「GBK bat 文件混入 UTF-8 中文行」的混合编码
- 根因: bat 检查只看整文件是否合法 UTF-8;且夹具自身构造的故障也不对(UTF-8 字节追加到 GBK 文件后整文件不再合法 UTF-8)
- 改动: encoding-lint bat 改为逐行判定;夹具改为"纯 UTF-8 中文 bat 文件"
- 验证: gate-selftest 9/9
- 关联: DEV-NOTES 条目 91

### M-20260901-01 迷你狗启动脚本不是 CRLF
- 状态: CLOSED
- 严重度: S3
- 来源: 流程 1 门禁 G2 首次运行自动发现
- 现象: `dev-dongle/master/mini-template/启动迷你狗.bat` 为 LF 换行,随每个迷你狗与授权包分发
- 根因: 该文件创建时未按项目 bat 规范(CRLF)写入;历史上 LF 曾导致 cmd 解析错乱(DEV-NOTES 坑 2)
- 改动: 重写为 CRLF(纯 ASCII,内容不变)
- 验证: `encoding-lint.js` 由 FAIL 转 PASS
- 关联: DEV-NOTES 条目 89

### M-20260901-02 backup.ps1 含非 ASCII 却无 BOM
- 状态: CLOSED
- 严重度: S3
- 来源: 门禁 G2
- 现象: 文件头自称 "ASCII only - PS5.1 safe",实际含一行中文注释且无 BOM
- 根因: 后期加注释时破坏了自己声明的约定;PS5.1 会按 GBK 解码该行(注释无害,但与危险案例不可区分)
- 改动: 该注释改回 ASCII 英文
- 验证: `encoding-lint.js` PASS
- 关联: DEV-NOTES 条目 89

### M-20260901-03 英文语言包 pageN2 为空
- 状态: CLOSED(确认为设计如此)
- 严重度: S4
- 来源: 门禁 GI18N
- 现象: `en.pageN2 = ""`
- 根因: 英文 "Page 3" 本就无后缀,空值是有意的;是检查规则过严
- 改动: `i18n-check.js` 把"空值"从 FAIL 降级为 WARN
- 验证: GI18N PASS + WARN 一行
- 关联: DEV-NOTES 条目 89

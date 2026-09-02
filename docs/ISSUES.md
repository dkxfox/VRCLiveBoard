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

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
- 状态: FIXED
- 严重度: S4
- 来源: 用户反馈(2026-09-02)
- 现象: 侧边栏收起时页头只显示 ☰ 符号, 视觉上不明显
- 复现: 窄屏(<980px)或收起侧边栏后看页头按钮
- 影响面: 全部控制台用户
- 根因: 按钮是静态 HTML 文本 '☰', 无文字标签
- 改动: index.html:navToggle 加 data-t="navMenu"; lang.js 三语新增 navMenu(菜单/選單/Menu)
- 验证: GATES 9/9 PASS(GHTML/GI18N/G4 专项断言 navMenu); 独立实例 19260 验证 lang.js 三语含 navMenu
- 关联: DEV-NOTES 条目 93

### M-20260902-06 健康总览 UDP 9000 行红色指示灯误报
- 状态: FIXED
- 严重度: S3
- 来源: 多名使用者反馈
- 现象: "UDP 9000 空闲: VRChat 没在监听" 一直红灯, 被误认为软件异常
- 复现: 不开游戏打开控制台 → 健康总览 UDP 9000 行显示 🔴
- 影响面: 全部用户
- 根因: healthLoad 把 UDP 9000 空闲(游戏没开/没开 OSC 的常态)标成 🔴, 文案也未说明这是正常状态
- 改动: app.js healthLoad 空闲态 🔴→⚪; lang.js 三语 portsUdpFree 改为"未运行或没开 OSC(正常; 打开游戏后会自动变绿)"
- 验证: GATES 9/9 PASS(GI18N/G4); 独立实例验证 /app.js 空闲态已用 ⚪(🔴 已消失)+ 三语新文案
- 关联: DEV-NOTES 条目 93

### M-20260902-07 公告板变量 {song} {artist} {album} 不好用
- 状态: FIXED
- 严重度: S3
- 来源: 使用者反馈(现象经回问拍板: 停播后残留 + 默认关闭无提示, 两项都修)
- 现象: 停播后公告板 {song} 残留最后一首歌; 媒体功能默认关闭时变量恒为空却无任何提示
- 复现: 1. 开启"正在播放的歌"并放歌 2. 停止播放 3. 公告板含 {song} 的页面仍显示上一首歌
- 影响面: 使用公告板 + 媒体变量的用户
- 根因: media.js 只在有新鲜 SMTC 数据时写 vars, 停播/超时直接 return null 不清空 → 残留; 且媒体源默认关闭时 vars 从未赋值
- 改动: media.js getText 无新鲜数据时清空 song/artist/album; lang.js 三语 pagesVars 注明媒体变量需开启"正在播放的歌"
- 验证: GATES 9/9 PASS(G1/GI18N/G4); 独立实例验证: 停播超 6s 后 getText 返回 null 且 song/artist/album 三变量清空
- 关联: DEV-NOTES 条目 93

### M-20260902-08 网易云歌词设置描述文本过时
- 状态: FIXED
- 严重度: S4
- 来源: 用户要求
- 现象: 插件面板与使用说明第六节的"首次使用"步骤仍描述旧流程(完全退出网易云→双击桌面快捷方式), 未提面板内已有的一键启动按钮(v1.1.2 起)
- 复现: 打开网易云歌词插件面板看顶部说明段; 使用说明.txt 第六节步骤 2/3 与 FAQ
- 影响面: 网易云插件用户
- 根因: 1.1.2 增加 launchCdp 一键启动后, 面板描述与使用说明未同步更新
- 改动: plugins/netease-lyrics/index.js 面板描述(拖动/暂停/切歌全同步; 首次使用改为一键启动为主、桌面快捷方式为备); 使用说明.txt 第六节步骤与 FAQ 同步(插件版本保持 1.1.3, 授权哈希不失效)
- 验证: GATES 9/9 PASS(G1/G2/GPLUG); 独立实例 approve+enable 后面板返回新文案且旧文案已消失
- 关联: DEV-NOTES 条目 93

### M-20260901-04 插件 vendor 重复导致包体积膨胀
- 状态: OPEN
- 严重度: S4
- 来源: 流程 2 落地时实测(启用官方插件恢复备份后)
- 现象: friend-welcome / scheduled-board / weather-board 各自带一份 ~7MB 的 xlsx vendor(仓库内合计 21MB);启用"官方可选插件"恢复备份后,lite 包 11.9MB → 20.2MB,自包含包 221.7MB → 230.0MB
- 根因: 三个插件各自复制了完整 xlsx 发行版(含 .map / extendscript / full.min / mini.min 等运行时用不到的文件),打包时又复制一份作恢复备份 → 同一份库进包 6 次
- 候选方案: ①**裁剪 vendor**(保留运行时实际引用的 4 件: `vendor/xlsx.js` + `vendor/xlsx.full.min.js` + `vendor/dist/cpexcel.js` + `vendor/dist/LICENSE`,预计每插件省 ~4.8MB,且不破坏"复制文件夹即可装回"的自包含特性)②共享 vendor(会破坏插件自包含,不推荐)③备份不含 vendor(恢复后 Excel 导入会坏,不推荐)
- 影响面: 仅体积;功能不受影响
- 待办: 重打包对比体积 + 更新 zipVolumes 基线(待用户"收尾"指令; 其余步骤已于 2026-09-04 完成, 见下)
- 改动(2026-09-04): 每插件删 vendor/dist 的 11 个死重文件, 保留 vendor/xlsx.js + vendor/xlsx.full.min.js + vendor/dist/cpexcel.js + vendor/dist/LICENSE; 各插件 vendor 15→4 文件(friend/sched 7,166,350→2,340,405B, weather 7,026,165→2,200,220B), 源码层每插件省 4,825,945B ×3 ≈ 14.48MB
- 验证(2026-09-04): ①直接 Node 导入/导出两路径三插件 PASS; ②隔离实例 19260 approve/enable/asset(vendor/xlsx.full.min.js 200, 881,727B)/import-config ok=True 全通过; ③run-gates -Smoke 9 PASS/1 FAIL(GSYNC 领先 origin 属既有, 非本次)
- 关联: DEV-NOTES 条目 108
- 体积实测(2026-09-02): lite 包 15.74MB 压缩后 = 基础 9.23MB + 官方可选插件恢复备份 6.51MB(占 41%); vendor xlsx 双份合计 12.94MB。裁剪 vendor 后预计 lite 回到 ~10MB

### M-20260902-09 run-gates 多断言转发被嵌套 powershell 空格合并
- 状态: FIXED
- 严重度: S4(流程工具)
- 来源: 条目 93 四修复跑门禁时发现
- 现象: run-gates.ps1 -Smoke -Assert 'a|/x|r1','b|/x|r2' 经嵌套 powershell -File 转发后, 数组被空格合并成单个参数, smoke 只收到一条拼串断言(且中文断言还会被 Invoke-WebRequest 按拉丁-1 解码成乱码, 永远匹配不上)
- 复现: run-gates.ps1 -Smoke -Assert 两个以上断言 → G4 只跑出一条专项且必 FAIL; 单条纯 ASCII 断言正常
- 影响面: 只有开发者跑门禁时; 不影响用户
- 根因: ①PS 把数组传给原生 exe(powershell.exe -File)时按空格合并成一个参数 → 多断言塌成一条; ②smoke 的 T() 用 Invoke-WebRequest 的 .Content, 响应无 charset 头时按拉丁-1 解码 → UTF-8 中文变乱码
- 改动: smoke.ps1 改用 RawContentStream 按 UTF-8 解码响应体 + 断言参数按 [char]31 拆分; run-gates.ps1 转发前用 [char]31 拼接 + 新增 -SmokeOnly(只跑 G4, 供门禁自测); feature-accept.ps1 同步先拼接再转发; gate-selftest.ps1 新增第 10 夹具(中文多断言经 run-gates→smoke 全链路自检)
- 验证: gate-selftest 10/10(含新第 10 夹具); run-gates 中文双断言 G4 冒烟 10/10(专项 2/2 PASS, 端口 19250 释放、TEMP 清理)
- 关联: DEV-NOTES 条目 94

### M-20260903-01 运行时垃圾文件管理(已梳理并修复累积点)
- 状态: FIXED
- 严重度: S4
- 来源: 用户提出"稍后想确认一下运行中的垃圾文件管理的问题"(2026-09-03)
- 现象: 用户问"运行中是否会累积垃圾文件"
- 复现: 取证结论 —— 真累积点两个半: ①logs/plugin-audit.log 每次插件调用都落盘但不在截断清单, 无限增长; ②Electron 用户数据目录(%APPDATA%\vrcliveboard)的 Chromium 缓存(Cache/Code Cache/GPUCache/ShaderCache)运行中持续增长, housekeeping 管不到; ③logs/app.log 只在启动时截断, 长期挂机会缓慢增长。其余均有管理(.ocr-cache 30天、.ocr-tmp.png 单文件、config.json.bak 设计内、插件 data 目录随删除清理、.tmp-import finally 清理)
- 根因: 见上
- 改动: housekeeping 截断清单加 plugin-audit.log + 清理 >1 天的 .ocr-tmp.png 残留; main.js 的 runHousekeeping 周期化(6 小时一次, 不再只跑启动时); 新增 electron/userdata-cleanup.js(GPU/Shader 类缓存启动即清, Cache/Code Cache/blob_storage 只清 >7 天未动的)+ electron/main.js 启动时接线并 clearCache()
- 验证: 夹具实测 —— plugin-audit.log/app.log 1.5MB 截断为 100KB、.ocr-tmp.png 2 天旧文件被清; userData 夹具 GPUCache/ShaderCache 清、过期 Cache 清、新 Code Cache 保留; GATES(回填)
- 关联: DEV-NOTES 条目 101

### M-20260903-02 UDP 9000 探测不可靠: 游戏正常运行时仍显示空闲
- 状态: FIXED
- 严重度: S3
- 来源: 用户实机反馈(2026-09-03, M-06 指示灯修复之后)
- 现象: 游戏与软件正常运行时, 健康总览 UDP 9000 行大部分时间仍显示"空闲"
- 复现: 开 VRChat(OSC 已开, 默认 9000)并运行软件 → 健康总览仍显示"空闲"
- 根因: udpProbe 用 bind 探测 —— Windows 上 Node UDP 默认 SO_REUSEADDR, VRChat 已持 0.0.0.0:9000 时我们对 127.0.0.1:9000 的 bind 依然成功 → 永远返回 occupied:false
- 改动: server.js udpProbe 改为查 netstat UDP 端点表(有进程绑定 :9000 即占用); 健康总览与端口体检: 占用且进程名含 VRChat → 🟢"正常", 其他程序占用 → 🔴"被占用"; lang.js 三语 portsUdpFree 补"改了自定义接收端口"说明
- 验证: 隔离实例(19260)实测 —— VRChat 运行中(用户正实机测试)时新探测返回 occupied:true + name VRChat.exe(旧探测此场景必报空闲, 正是用户反馈的现象); 假监听器因 EADDRINUSE 无法抢占(证明 VRChat 套接字未被影响); GATES 9 PASS / 0 FAIL(冒烟 10/10 含两专项断言)
- 关联: M-20260902-06、DEV-NOTES 条目 97

### M-20260903-03 桌面版首次启动任务栏仍显示默认图标
- 状态: FIXED(含一次回归与回滚, 用户最终确认恢复正常)
- 回归记录(2026-09-03): 增加"开始菜单快捷方式自愈(带 AUMID+图标)"后用户反馈任务栏图标变空白("一张白纸" —— Windows 图标源解析失败的典型表现); 已删除已写入的 VRCLiveBoard.lnk 并移除 ensureShortcut 逻辑, 保留首帧修复(show:false + ready-to-show); 用户回滚后确认"现在正常"
- 最终结论: 三层方案收敛为两层 —— 首帧时序修复(有效)+ ClearIconCache.bat(一次性兜底); 快捷方式层证伪(IShellLink 对 PNG-in-ICO 的图标提取不可靠, 反而空白)
- 严重度: S3
- 来源: 用户反馈(2026-09-03, 坑 20/23 之后的第三次)
- 现象: 桌面版第一次启动时任务栏显示 Electron 默认图标
- 复现: 全新环境/清过图标缓存后第一次启动桌面版 → 任务栏默认图标
- 根因: ①窗口创建即显示, 首帧前 Windows 按默认图标缓存了 AUMID 分组; ②未打包的 electron.exe 场景下, 自定义 AUMID(com.vrcliveboard.app)没有任何持久图标源(开始菜单无快捷方式), 任务栏只能拿 exe 默认图标; ③历史默认图标已进 Windows 图标缓存
- 改动: electron/main.js 窗口 show:false + ready-to-show 再显示(3 秒兜底); 启动时自愈写入开始菜单快捷方式 VRCLiveBoard.lnk(带 app.ico + AUMID, 给分组持久图标源); 新增根目录 ClearIconCache.bat(清图标缓存一次性工具, ASCII+CRLF)
- 验证: app.ico 168,394B 且 7 尺寸条目; electron/main.js 语法过; 无头 SHELL-OK; GATES(回填)
- 关联: 坑 20/23、DEV-NOTES 条目 99

### M-20260904-01 三个官方插件 xlsx vendor 版本不一致
- 状态: OPEN(已登记, 待后续统一版本 —— 用户 2026-09-04 拍板"稍后再更新版本")
- 严重度: S4(优化)
- 来源: M-20260901-04 裁剪时顺带发现(2026-09-04, 见 DEV-NOTES 条目 108 遗留②)
- 现象: weather-board 的 vendor/xlsx.js 为 SheetJS 0.18.5, 而 friend-welcome / scheduled-board 为 0.20.3
- 复现: 读各插件 plugins/<id>/vendor/xlsx.js 首行 "XLSX.version = 'x.y.z';"
- 影响面: 仅版本漂移与维护负担; 当前各插件自带 vendor 且隔离实测正常, 无运行时冲突
- 根因: 三插件各自复制完整 vendor, 复制时间线不同导致版本漂移
- 候选方案: ①统一为 0.20.3(用 friend/scheduled 所带版本替换 weather-board 的 vendor/xlsx.js 与 vendor/dist/cpexcel.js, 再回归 Excel 导入/导出)②维持各自版本(现状, 不推荐但无害)
- 待办: 统一版本 → 回归三插件 Excel 导入/导出 → 与 M-20260901-04 一并重打包
- 关联: M-20260901-04、DEV-NOTES 条目 108

### M-20260904-02 加速器拦截 loopback UDP 9000 → 聊天框设置正常却不显示
- 状态: FIXED(根因确认, 用户实机恢复)
- 严重度: S2(主功能不可用)
- 来源: 使用者反馈(2026-09-04) + 排查确认
- 现象: VRChat OSC 已开、监听 9000、软件健康总览正常, 但软件发送的 /chatbox/input 不在聊天框显示; 用户手动打字能显示
- 复现: 开启"加速器(小黑盒)"时出现; 手动打字正常、软件 OSC 不见即此症状
- 影响面: 使用加速器/虚拟网卡的 VRChat 用户
- 根因: 加速器创建虚拟网卡或劫持 loopback, 使发往 127.0.0.1:9000 的 OSC 包到不了 VRChat 真实监听地址
- 处置: 退出加速器(或排除 loopback) + 重启 VRChat 即恢复
- 验证: 用户实机"退出加速器 + 重启 VRChat"后立即显示
- 关联: DEV-NOTES 条目 109; M-20260903-06(同类相关, 但症状为全红待复现)

## 审计发现(2026-09-03 全量审计, 均为 C4 仅记录)

### A-20260903-04 systeminformation CVE-2025-68154(fsSize 命令注入)—— 不适用, 仅记录
- 级别: C4
- 证据: OSV API 实测 5.33.5 无在册影响; 全项目无 fsSize 调用(唯一使用 = networkStats)
- 处置: 若未来引入 fsSize, 必须先确认版本已修复且路径参数不经外部输入
- 关联: DEV-NOTES 条目 102

### A-20260903-05 Electron CVE-2026-34769(renderer 命令行开关注入)—— 不适用, 仅记录
- 级别: C4
- 证据: OSV/GHSA-9wfr-w7mm-pc7f 影响范围 ≤38.8.6 / 39.x<39.8.0 / 40.x<40.7.0 / 41.0.0-alpha.1~<41.0.0-beta.8; 本项目 43.4.0 不在范围; 且只加载本地控制台、新窗口由 setWindowOpenHandler 拒绝(不加载远程内容)
- 处置: 保持升级节奏(43 系列 EOL 2027-01-05), 无需立即动作
- 关联: DEV-NOTES 条目 102

### M-20260903-05 控制台加 GitHub 访问按钮
- 状态: FIXED
- 严重度: S4
- 来源: 用户要求(2026-09-03)
- 现象: 控制台页头无 GitHub 仓库入口
- 改动: index.html 页头新增 GitHub 按钮(新窗口打开 + rel=noopener, 桌面版经 setWindowOpenHandler 走系统浏览器); lang.js 三语 ghBtn; 使用说明四章页头描述同步; DOC-BASELINE 增 must 断言
- 验证: GATES(GHTML/GI18N/GSURF 域名基线已有 github.com/GDOC 新断言)

### M-20260903-06 VRChat 已开 OSC 但软件显示无法连接(全红)
- 状态: NEED-REPRO(已回问, 待反馈者提供信息)
- 严重度: S2(主功能不可用)
- 来源: 使用者反馈(2026-09-03)
- 现象: "VRC 中开启了 OSC 功能, 但软件无法连接, 所有状态指示都是红灯"
- 复现: 无(待回问: ①软件版本是否 v1.3.2 ②顶部圆点颜色(绿/黄/灰) ③是否在世界内 ④启动方式/加速器/自定义端口 ⑤UDP 9000 行具体文字 ⑥一键诊断报告)
- 影响面: 待定
- 初步假设(按概率): ①旧版本(≤1.3.1)UDP 空闲=红的旧误报设计, v1.3.2 已修复 → 先升级复测; ②OSC 未真正生效(需进世界/每账号设置); ③日志未读到(USERPROFILE 不一致/非标准启动); ④OSC 端口不一致(--osc 参数); ⑤9000 被其他进程占用; ⑥加速器/杀软拦 loopback
- 关联: M-20260902-06(UDP 指示灯旧误报, v1.3.2 修复)、DEV-NOTES 105

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
## M-20260906-01 新 UI 多语言补齐(CLOSED)
- 现象: 新版控制台(仪表盘)界面文案为硬编码简体中文; 无语言选择器; lang.js 只有旧版键。
- 影响: 繁体/英文用户看不到对应语言; 与旧版三语能力不对等。
- 计划: ①新 UI 各 Tab/卡片/按钮文案录入 lang.js 三语; ②index.html 硬编码改 data-t; ③头部加语言选择器 + 切换重渲染。
- 改动(2026-09-06/07): ①lang.js 357→579 键×三语, 覆盖高级设置/公告板/状态条/翻译/环境/插件卡片+授权弹窗/4 个插件设置面板/主题名/变量下拉/启动文案; ②index.html 162 处 data-t / data-t-ph / data-tt + 主题名三语映射; ③头部 #langSel 三选项 + reRenderAll() 切语言重渲染动态内容(仅 applyLang 不够); ④顺带补齐插件授权链路(弹窗被吞进隐藏 tab、approve 调用丢失、高危二次确认)。
- 验证(2026-09-07): run-gates -Smoke 11 PASS / 1 FAIL(GSYNC 未推送 —— 用户明令不推送, 属预期例外); GI18N 579 键三语对齐; GI18NU 0 缺失; GI18NH 与白名单基线一致; GHTML + 隔离冒烟 8/8 全过。
- 关联: DEV-NOTES 条目 113/114/115; commits 705c5d1 / 4ec8a1e / 3259ee6 / 07c9cff / 51e8596 / b25d35c / f8fa7fa / 0bf94a7 / 79eed0b / d10bf7c

## M-20260907-01 新版 UI 功能接线缺失(死按键 / 失效输入框 / 缺失面板)(CLOSED)
- 来源: 用户"进行实机测试, 完整检测现有软件 UI 中和旧版不一致的内容"
- 现象: 新版控制台(单屏仪表盘)存在大量"有控件无功能": 20 个按钮点击无反应; 12 个输入框改了不生效; 若干旧版面板整块丢失; 同一动作两条路径交互不一致。
- 复现: ①打开控制台; ②点公告板「编辑」/ 翻译「截图翻译」/ 高级「端口体检」等任意死按键 → 无任何反应; ③在日志「过滤关键字」输入内容 → 列表不过滤; ④用「常用」标签的插件快捷开关启用未授权插件 → 开关闪回且无提示(而「插件」标签的卡片开关会正常弹授权窗)。
- 影响面: 全部控制台用户; 多个核心功能不可用(配置导出导入、端口体检、截图翻译、日志过滤、版本显示、插件安全策略)。
- 根因: 新版 UI 移植时只搬了 HTML 控件, 漏接 app.js 的事件处理器; 部分旧版面板未移植; 新控件命名与 app.js 既有引用不一致(如日志过滤框缺 id="logFilter")。
- 证据(实机 2026-09-07): smoke.ps1 -Port 19260 专项断言 21 PASS / 4 FAIL —— 12 个死按键确实存在于服务端返回页面; verLine / psNet / plgImport 在页面中不存在; 后端路由(/api/config/export、/api/ports/check、/api/ocrtl、/api/capture/preview、/api/env、/api/plugins/import、/api/plugins/config 等)全部存在且实测可用, 证明是前端未接线而非后端缺能力。
- 分级: 批 A = 接线类(20 按钮 + 12 输入框, M 档同质批量); 批 B = 缺失面板类(插件安全策略 / 截图区域 / 插件导入 / 版本显示, H 档, 另行排期)。
- 改动(批 A, 2026-09-07): ①index.html 补 15 处控件 id(prioReset/ltCheckBtn/ltDownloadBtn/visSave/btnShot/capAdjBtn/capFullBtn/transApiModel/ocrDelay/ocrDisplay/ocrLoops/webPort/webSave/portsCheckBtn/portsOut/logFilter/logCopy/bdRot/envMsg), 修正日志行 id 归属(可见复选框才该有 logAuto), 移除公告板 2 只装饰按钮(批量导入/导出 —— 新版新增且从无实现)与 env 静态占位行; ②app.js 新增"批 A 补接线"块 + 公告板 6 项 + renderEnv 改用 /api/env 并支持 winsdk/Python 一键安装; ③lang.js 增 delPageConfirm / needL1 两键×三语。
- 验证(批 A, 2026-09-07): run-gates -Smoke 11 PASS/1 FAIL(GSYNC 未推送属预期); smoke.ps1 -Port 19260 专项断言 28 PASS/0 FAIL; 死按键复扫 20 → 0。
- 改动(批 B, 2026-09-07, 用户"全做(8 项一次补完)"): ①index.html 补齐 8 项面板 —— 插件安全策略(psNet/psProc/psFsW/psFsR/psAi + psSave + psMsg)、截图区域可视化覆盖层(#capOverlay 含 capImg/capRect/capSel/capRefresh/capSave/capCancel, z-index 10000 压过启动动画)、插件导入工具条(plgZip/plgImport/plgRefresh/plgPrioReset/plgMsg)、版本号 #ver + #updateHint、诊断结果 #diagOut + #diagCopy、#healthCopy、#logErrOnly、公告板折叠 #collapseAll/#expandAll, 并加 .edlist.compact .snip{display:none} 紧凑样式; ②app.js 新增"批 B 补缺失面板"块 —— 截图覆盖层拖拽选区(按 naturalWidth/rect.width 换算真实像素, 保存走 /api/capture/set region 并回写模式下拉)、插件 zip 导入(空路径复用既有 importNeedPath 键)、插件优先级重置、版本号+更新检查(/api/version、/api/version/check)、健康信息复制、诊断复制、日志只看错误(/\[(WARN|ERROR|ERR)\]/i 过滤)、折叠展开(bdSetCompact)。
- 验证(批 B, 2026-09-07): run-gates -Smoke 11 PASS/1 FAIL(GSYNC 未推送属预期例外); GI18NU 0 缺失(修正 1 处新引用键名 plgImportPath → 复用既有 importNeedPath, 未新增重复键); smoke.ps1 -Port 19260 专项断言 44 PASS/0 FAIL(17 项新面板控件 + 7 项批 B app.js 接线 + 12 项批 A 回归 + 8 项基线); 死按键复扫保持 0; 8 项面板 HTML/app.js 双向引用核对 100%。
- 状态: CLOSED(批 A + 批 B 全部完成, 无遗留项)

## M-20260911-01 启动动画不播放(async IIFE 内 var t 遮蔽全局 t 函数)(CLOSED)
- 来源: 用户实机测试反馈"启动动画现在不播放了, 检查一下"(2026-09-11)
- 现象: 控制台页面加载时不再播放启动动画; 品牌为「默认/自动」时完全不播, 品牌为「星轨茶会(starry)」时正常; 每次加载日志新增一条 [WARN] [前端] Promise拒绝: t is not a function。
- 复现: ①branding=normal(用户当前配置); ②打开或刷新控制台 → 无启动动画, 页面直接出现; ③logs/app.log 新增 "Promise拒绝: t is not a function"。
- 影响面: 所有非 starry 品牌用户的启动动画(纯视觉, 不影响功能); 附带污染日志。
- 根因: app.js 的启动动画是 (async function(){...})() IIFE, 其内部 `var t=null` 被提升到 IIFE 作用域顶部, 遮蔽了全局 `function t(k)`(i18n 取词)。于是 IIFE 内 t('bootTagline') 在 t 仍为 undefined 时被调用 → TypeError → async IIFE 以 rejected promise 结束, 动画从未创建(bootscrim 已先行移除, 所以页面看着"正常"只是没动画)。该 `var t` 属于 0460cc3 的"节日/季节动画"块; a2b937f 把该块重构为 simpleBoot 并在其上方插入 `_r` 早返回, 使旧块成为不可达死代码, 但 var 提升造成的遮蔽照旧生效。
- 证据: ①logs/app.log 中 2026-09-08 09:03(x3) 与 2026-09-11 17:21 / 18:10 / 18:16 共 6 条 "Promise拒绝: t is not a function"; ②提取式 harness(用 node vm 加载真实 IIFE, 对 simpleBoot/starryBoot/playSpecialVideo/t/document/fetch 打桩)复现: branding=normal(有皮肤/无皮肤)与 auto 三场景全部 `TypeError: t is not a function` 且调用链为空, branding=starry 正常调用 starryBoot; ③git log -S 定位: `var t=null` 由 5ececfe 引入、节日块由 0460cc3 引入、`_r` 早返回由 a2b937f 引入(三者同为 2026-09-06, 均非批 A/批 B 引入)。
- 改动(2026-09-11): 删除 app.js 中已不可达的旧节日/季节块(14 行, 含 `var t=null`)。该块与 simpleBoot 重复(同为 ov 构建 + 图标/问候/装饰/标题), 且被上一行 `return;` 判定为不可达; 删除后 IIFE 内不再有局部 t 声明, t('bootTagline') 重新解析到全局函数。改动量: 1 文件 / -14 行 / +0 行。
- 验证(2026-09-11): harness 四场景复跑全部无异常且调用链正确 —— normal+皮肤 → simpleBoot(#f59e0b,#f87171,秋意渐浓,🍂); normal+无皮肤 → simpleBoot(#3b82f6,#7dd3fc,'','✦'); auto+皮肤 → simpleBoot(节日配色); starry → starryBoot; run-gates -Smoke = 11 PASS / 1 FAIL(GSYNC 未推送属预期例外); smoke.ps1 -Port 19260 专项断言 20 PASS / 0 FAIL(8 基线 + 8 启动动画相关 + 4 批 B 回归); node --check 通过。
- 遗留: ①同文件另有两处同类遮蔽待用户定夺 —— renderBdEditor() 第 25 行 `var t=$('bdText')` 之后的 t('emptyPage')(#bdList / #bdPrev 在 index.html 均存在, 故当页面文本为空或公告板被删空时**可达**, 会抛同类 TypeError); 以及第 23/38 行 `var t=pages[i-1]`(仅用于数组交换, 内部无 t() 调用, 实测无害)。②"节日/季节/问候语"内联动画自 a2b937f 起即不可达, 现由 skin.js 皮肤判定 + simpleBoot 承担; 如日后想恢复问候语动画, 可从 a2b937f^ 取回旧实现。
- 状态: CLOSED(动画已恢复; 两处同类遮蔽经用户确认后再另行处理)

## M-20260911-02 本机任意文件读: /api/special/video 路径穿越(CLOSED)
- 来源: 2026-09-11 新版代码审核(用户"审核一下新版代码")
- 现象: GET /api/special/video?file=<任意路径> 可读取本机任意文件; file=config.json 即可取走工程根下的配置文件。
- 复现: 浏览器或 curl 访问 http://127.0.0.1:19190/api/special/video?file=config.json → 返回 config.json 原文(含 level1Password、devchain.anchor); file=../../../../Windows/win.ini 可越出工程根。
- 影响面: 本机任意进程/脚本可读取任意文件, 并据此拿到一级密码 → 该密码保护的配置导出/导入等门禁全部失效。web.host 默认 127.0.0.1(仅回环), 故暂未暴露到局域网; 但不影响本机提权性质。
- 根因: server.js 第 487 行 `const f = path.join(__dirname, '..', '..', rel)` 对 rel 零校验(既未拒 '..', 也未做 resolve 后的目录前缀比对)。对照: 同一文件第 142-144 行的静态资源分支**已**显式做了 URL 解码与 '..' / '\\' 拒绝 —— 同类防护只做了一半。
- 证据(本人复验): 读 src/web/server.js:484-495 确认; config.default.json 与 config.json 的 web.host 均为 127.0.0.1; 静态资源分支 L142-144 有防穿越代码。
- 改动(批 1, 2026-09-11): server.js 在 fs.stat 之前加目录围栏 —— 以 assets 目录为边界, path.resolve 归一化后要求结果落在 assets/ 之内, 否则 403。**边界取 assets/ 而不是工程根**: config.json 本身就在工程根内, 只挡"根外"挡不住它; 而该接口的产物(上传接口写入的正是 assets/videos/)天然在 assets/ 下。覆盖 ../ 穿越、带盘符的绝对路径与根内其它文件。scripts/checks/smoke.ps1 扩展断言语法: 第 4 段可选 = 期望 HTTP 状态码, 使 403 拦截类修复能被门禁长期看住(3 段旧写法保持兼容)。
- 验证(批 1, 2026-09-11): 隔离实例 :19260 专项断言 **15 PASS / 0 FAIL** —— A1 file=config.json → 403、A2 ../../../../Windows/win.ini → 403、A3 C:/Windows/win.ini → 403、A4 file=assets/videos/nope.mp4 → 404(阳性对照: 过围栏、仅文件不存在)、A5 未配置 file → 404(行为不变); run-gates -Smoke = 13 PASS / 1 FAIL(GSYNC 未推送属预期)。
- 状态: CLOSED

## M-20260911-03 前端门禁盲区: 控件接线与启动可执行性无任何门禁(CLOSED)
- 来源: 2026-09-11 新版代码审核
- 现象: 近两次前端事故(M-20260907-01 的 20 个死按键、M-20260911-01 的启动动画不播)在提交时全部门禁为绿, 事故类型没有任何闸能拦。
- 复现: ①删掉 index.html 里某个按钮的 app.js 引用 → run-gates 仍 11 PASS; ②在启动 IIFE 里写一句必然抛错的代码 → 门禁仍全绿, 只有运行时日志里多一行 unhandled rejection。
- 影响面: 前端"静默失效"类缺陷全靠人工实机发现, 回归成本高。
- 根因: GHTML(html-inline-check.js)只做 JS → HTML 单向检查(getElementById 目标是否存在、id 是否唯一、脚本语法), **不做 HTML → JS 反向检查**(控件是否有任何 JS 引用), 也不执行任何前端代码(无"能不能跑起来"的断言)。
- 改动(批 1, 2026-09-11): 新增 scripts/checks/ui-wiring.js(G-UWIRE)与 scripts/checks/frontend-boot.js(G-BOOT), 在 run-gates.ps1 注册为 GUWIRE / GBOOT 两道闸(写 .ps1 时保留 UTF-8 BOM)。G-UWIRE 遍历 index.html 里 87 个带 id 的 button/input/select/textarea, 要求每个都能在 app.js 找到**显式**引用(字符串 id / $(id) / getElementById(id))或带内联 onclick —— 裸标识符(浏览器命名访问)不算接线, 由 G-BOOT 直接拒绝。G-BOOT 用 DOM 桩件(按 index.html 真实存在的 id 给元素桩, 不存在的给 null)在 node vm 里加载 lang.js + app.js, 断言: ①顶层加载无异常 ②加载期无 unhandledRejection ③ tr() 能取到真实文案且 window.t 别名一致 ④启动动画三个品牌分支各自走到 simpleBoot / starryBoot。
- 验证(批 1, 2026-09-11): **两道闸首次试跑就抓出两个真问题** —— ① app.js 末尾 if(langSel) 依赖浏览器命名访问(G-BOOT 报 langSel is not defined), 已改为 $('langSel') 显式取并加守卫; ② G-BOOT 自己的桩件缺 tr 导致启动分支报 tr is not defined(门禁自身的 bug), 已修, 并给"裸标识符访问 DOM id"的报错补了中文提示。修完后 G-UWIRE 0 死控件 / G-BOOT 顶层加载正常; run-gates -Smoke = **13 PASS / 1 FAIL**(GSYNC 属预期)。
- 状态: CLOSED

## M-20260911-04 i18n 取词函数单字母 t 的遮蔽风险 + 2 处无守卫 DOM 赋值(CLOSED)
- 来源: 2026-09-11 新版代码审核(承接 M-20260911-01 的根因)
- 现象: ①i18n 取词函数名为单字母 t, 与最常见的临时变量名冲突, 已被 `var t=null` 咬过两次(启动动画事故 + 公告板编辑器潜伏用例); ②app.js 第 355-356 行 `document.getElementById('gateL1'/'gateL2').onclick = ...` 无空值守卫。
- 复现: ①在任意函数作用域内写 `var t=<任意值>` 并在其后调用 t('key') → TypeError; ②用 DOM 桩件加载 app.js(元素缺失) → 顶层即抛 `TypeError: Cannot set properties of null (setting 'onclick')` 并中断, 其后所有代码(含语言切换与初始化)全部失效。
- 影响面: ①类事故会复发且症状隐蔽(async IIFE 场景下只剩一行 unhandled rejection); ②只要 gateL1 / gateL2 任一 id 被改名或所在区块被裁, 整个控制台脚本从该行起失效。
- 根因: ①取词函数采用单字母全局名(第 304 行 function t(k)), 而 app.js 全文件 257 处 var 声明, 无块级作用域纪律; ②旧版套皮代码直接对 getElementById 结果取属性, 未沿用新版 `if($('x'))` 的守卫写法。
- 证据(本人复验): ①M-20260911-01 的提取式 harness 与线上日志; ②DOM 桩件加载 app.js 实测抛错行即 L355; ③全文件扫描: 局部 `var t=` 现存 3 处(L23 数组交换无害、L25 可达、L38 数组交换无害)。
- 改动(批 1, 2026-09-11): ① app.js 取词函数 function t(k) → function tr(k), 305 处调用点按"前一字符非词字符"的边界规则整体重命名(避免误伤 alert( / createElement( / setTimeout( / parseFloat( 这类词尾), 并保留 window.t = tr 兼容 index.html 内联块(批 3 迁出内联块后删除); ② 消除 3 处局部 var t=(公告板两处数组交换 → tp, 编辑器文本域 → bdt)—— 其中编辑器那处正是 t('emptyPage') 的可达崩溃点; ③ app.js:355-356 两处无守卫赋值改为 var _g = document.getElementById(...); if (_g) _g.onclick = ...; ④ i18n-usage.js 的取词正则改为 \btr?\( , 并新增"禁止局部绑定 t"检查(命中即 FAIL)。
- 验证(批 1, 2026-09-11): node --check 通过; GI18NU 键数 **202 与改名前完全一致**(证明无调用点漏改/漏迁); G-BOOT 顶层加载无异常、tr('bootTagline') 取到真实文案、window.t 与 tr 取值一致; 全文件残留"前一字符非词字符的 t(" = **0 处**、残留局部绑定 t = **0 处**; run-gates -Smoke = 13 PASS / 1 FAIL(GSYNC 属预期)。
- 状态: CLOSED

## M-20260911-05 更新链接注入路径: 白名单未锚尾 + 前端 innerHTML 未转义(CLOSED)
- 来源: 2026-09-11 新版代码审核
- 现象: 版本更新提示把服务端返回的 releaseUrl 直接拼进 innerHTML 的 href, 未转义; 而服务端白名单正则只锚定前缀、未锚定结尾。
- 复现: 构造 version.json: {"version":"9.9.9","releaseUrl":"https://github.com/dkxfox/VRCLiveBoard\"><img src=x onerror=alert(1)>"} → versioncheck.validate() 放行(前缀匹配成功), 前端 app.js 将其拼入 `<a href="...">` → 注入的 img/onerror 进入控制台页面。
- 影响面: 需要攻击者控制更新源。config.update.mirror 是**用户可配置的第一优先源**(versioncheck.js:52-53), 所以威胁模型下可达; 也可通过劫持 jsDelivr/GitHub 响应实现。
- 根因: 双半格防线 —— 服务端 versioncheck.js:26 正则 `^https://(github.com/dkxfox/VRCLiveBoard|cdn.jsdelivr.net/gh/dkxfox/VRCLiveBoard)` 无 `$` 与字符集约束; 前端 app.js:85(批 B 新增代码)直接 innerHTML 拼接。
- 改动(批 2, 2026-09-11): ① 服务端 versioncheck.js 白名单正则**锚尾 + 限定路径字符集**(^https://官方域名(/[A-Za-z0-9._~%/-]*)?$), 原正则只锚前缀, 形如 .../VRCLiveBoard"><img onerror=...> 的载荷能通过校验; ② 前端 app.js 的更新提示由 innerHTML 拼接改为 **DOM API**(a.href 属性赋值 + a.textContent + a.rel=noopener), 并加 https 前缀校验 —— 该路径从此不参与 HTML 解析, 对注入结构性免疫; ③ 顺带修掉上报链路的**递归隐患**: fetch(/api/fe-err) 自身失败会触发 unhandledrejection, 而该处理器又去 POST fe-err → 自激; 现统一走 feErr(), 上报失败即永久关闭(_feErrOff)。
- 验证(批 2, 2026-09-11): 用真实 checkUpdate() 喂 4 档载荷 —— 恶意(引号+标签) → remote=null 拒绝; 合法(带路径 /releases/tag/v1.3.3) → 接受; 合法(裸链接) → 接受; 第三方域名 → 拒绝。前端在恶意 releaseUrl 下: createElement 未产生 img/script/iframe/svg 任何注入载体, #updateHint 仅 1 个子节点(A 元素), URL 仅作属性赋值、文案走 textContent; 专项冒烟 18 PASS / 0 FAIL; run-gates -Smoke = 13 PASS / 1 FAIL(GSYNC 属预期)。
- 状态: CLOSED
## M-20260911-06 配置导入: 只写文件不更新内存 + 接口只认导出信封 + 坏导入可打残配置(CLOSED)
- 来源: 2026-09-11 代码审核子代理报 H3(标注未复验) → 本人复核确认为真; 修复过程中实测又发现两项同源问题
- 现象: ①导入配置后, 只要在控制台再改任何设置, 导入结果就被内存里的旧配置整体覆盖(静默丢失); ②导入接口只接受控制台导出的信封(ok/filename/config 三段), 把 config.json 直接拖进去只会得到"无效配置"; ③(实测新发现)传入控制台 GET /api/config 的**扁平视图**(它的 sources 是数组)会把内存里的 sources 段顶成数组, 之后所有读 sources.pages 的接口抛未捕获异常且**不回包**(客户端表现为卡死), 并且这个坏结构还会被 persist() 写进 config.json。
- 影响面: 配置导入功能实质不可用(导入即丢); 一次错误导入可把运行中的配置结构与磁盘文件同时打残。
- 根因: 导入处理器只 fs.writeFileSync 文件、完全不更新 rootConfig, 而 persist() 写的是内存; 形状校验只判断"有没有核心段"不判断类型; 合并函数遇到类型不符直接整体覆盖。
- 证据(隔离实例 :19260, 全新配置, 端到端): ①扁平载荷 → 400 且磁盘配置完好(sources 仍是对象); ②导出信封导入 → 200; ③随后 POST /api/config → 内存与磁盘 branding 均为 starry、sources.pages.rotationMs=9999、level1Password 未被删、sources.pages.pages 仍是数组; ④修复前同一序列会把 sources 写成数组, 日志留下 [未捕获异常] TypeError: Cannot read properties of undefined (reading 'pages')。
- 改动(批 3, 2026-09-11): ① configio 新增 applyInPlace(): 原地深合并 —— 保持子对象引用(webCfg / composer.swearFilter 等持有者立即生效)、不删除内存里已有而导入文件没有的键、类型不符(用数组或标量顶替对象段)时跳过而不覆盖; ② 导入处理器: 合并进内存后走 persist() 原子落盘(不再只写文件), 解析兼容"导出信封"与"裸 config.json"两种形状, 失败返回 500; ③ 形状校验改为"至少一个核心段, 且它必须是对象(数组不算)"; ④ GET/POST /api/config 对 sources.pages 的读取加空安全, 缺失时给空值而不是抛未捕获异常。
- 验证(批 3, 2026-09-11): configio 单元测试 7 项全过(引用保持 / 不删键 / 数组整体替换 / __proto__ 跳过 / 落盘回读); 端到端 15 项中 14 项自动通过, 第 15 项为**测试脚本自身读错路径**(磁盘上 rotationMs 位于 sources.pages.rotationMs, 已人工核实为 9999, 实际通过); run-gates -Smoke = 13 PASS / 1 FAIL(GSYNC 属预期)。
- 状态: CLOSED

## M-20260911-07 无统一退出: python 助手与端口残留(CLOSED)
- 来源: 2026-09-11 代码审核子代理报 H5(标注未复验) → 本人复核确认为真
- 现象: 退出路径只调 composer.stop() + osc.close(); web.stop() 与 media.stop() 虽然都存在却**从未被调用**; /api/desktop/quit 与 /api/desktop/restart 直接 process.exit(0)。
- 影响面: Windows 上 python(SMTC 媒体助手)不随父进程退出 → 残留进程; 重启时端口未优雅释放 → 新进程可能抢不到端口被回退到别的端口, 与 M-20260911-08 叠加即"白屏"。
- 根因: 退出逻辑散在三处且每处只做半套; 三个 setInterval 句柄未保存, 想清也清不掉。
- 改动(批 3, 2026-09-11): src/main.js 新增 shutdown(reason, proceed): 清三个定时器 → composer.stop() → mediaSource.stop()(杀 python 子进程) → await web.stop()(释放端口, 上限 1.5 秒) → osc.close() → exitNow()(桌面内嵌模式走 app.quit, 否则 process.exit); 挂 SIGINT / SIGTERM / 进程事件 vrcb:shutdown; /api/desktop/quit 与 restart 改走 onQuit/onRestart 钩子(重启在清理完成后才 relaunch); electron/main.js 在 before-quit 里先请核心清理、完成后再真正退出(3 秒兜底, 核心卡住也不会退不掉窗口)。
- 验证(批 3, 2026-09-11): 静态与逻辑核对 11 项全过(web.stop / mediaSource.stop / 三个 clearInterval / SIGTERM / vrcb:shutdown / 端口上报 / 壳侧握手); 隔离实例正常启停、端口 19260 释放 True; run-gates -Smoke = 13 PASS / 1 FAIL(预期)。
- 状态: CLOSED

## M-20260911-08 桌面壳端口写死 19190 → 端口被占即白屏(CLOSED)
- 来源: 2026-09-11 代码审核子代理报 H4(标注未复验) → 本人复核确认为真
- 现象: electron/main.js 的 CONSOLE_URL 写死 http://127.0.0.1:19190; 而核心在端口被占时会自动回退(src/web/server.js 的 start() 最多 +10), 控制台里改端口也只置 needRestart。于是"19190 被占"或"改过端口"之后, 窗口加载的是一个不存在的地址 → **白屏且无任何提示**, 托盘"在浏览器打开"同样打开错地址。
- 影响面: 桌面版用户在端口冲突或改端口场景下看到空白窗口, 无自助排查线索。
- 根因: 核心的实际端口只在 src/main.js 内部使用(consolePort), 没有任何通道告诉桌面壳; 壳与核心之间缺少就绪/端口契约。
- 改动(批 3, 2026-09-11): ① src/main.js 在 web.start() 后写 process.env.VRCB_CONSOLE_PORT 并 emit 进程事件 vrcb:console-ready; ② 壳侧 consoleUrl() 取实际端口(缺省回落 19190), whenCoreReady() 等就绪(最多 15 秒)后再 loadURL, 托盘"在浏览器打开"同源; ③ did-fail-load 自动重试 3 次(忽略 -3 中断), 仍失败则加载一页中文错误页 —— 写明尝试的地址、去 logs/app.log 搜"网页控制台"看实际端口, 不再白屏。
- 验证(批 3, 2026-09-11): 从 electron/main.js 提取真实 consoleUrl 与 whenCoreReady 执行 7 项断言全过(缺省回落 19190 / 用实际端口 19193 / 就绪即回调 / 未就绪则挂等待 / 事件后回调一次 / 重复事件不重复加载)。**边界**: 桌面壳全量启动会拉起用户实例(读用户 config、占 19190), 故"端口被占时窗口仍能连上"这条未在本机实机验证, 需用户实机确认。
- 状态: CLOSED(核心逻辑已验证; 实机表现待用户确认)
## M-20260911-09 t→tr 改名与局部变量 tr 碰撞: 数据源卡片表体为空 + 插件设置表格删除列失效(CLOSED)
- 来源: 用户实机反馈"检查数据源卡片，内部内容缺失"(2026-09-11); 根因是 **M-20260911-04 批 1 改名的回归**
- 现象: 「数据源」标签页的表格只有表头, 表体一行都没有; 另有三处插件设置面板表格的删除按钮列同样失效。
- 复现: 打开控制台 → 数据源标签 → 表格无任何行(数据源名称/说明/优先级/开关全都不显示)。
- 影响面: 数据源卡片完全不可用(看不到也调不了任何数据源的启用与优先级); 三个插件设置表格的删除列失效。
- 根因: 批 1 把 i18n 取词函数 t 改名为 tr 时, 撞上了 app.js 里早已存在的局部变量 tr(表格行 var tr=document.createElement('tr'))。renderSrcTable 在同一行内先 var tr= 再 tr(NM(x.id)) → 把行元素当函数调用 → TypeError 被 pollStatus 自身的 try/catch 吞掉(只留下一条 [api] 上报), forEach 中断 → 表体为空。tblRows 里的 tr('delBtn') 同因。
- 证据: ① 升级后的 G-BOOT 对 HEAD 版本(含碰撞) **exit=1**, 精确报「数据源表格 #srcRows 渲染后仍为空」并在日志给出 tr is not a function at app.js:120; 对修复版 exit=0 —— 证明该门禁升级后确实能拦住这类回归; ② 全量扫描: app.js 中局部 tr 绑定共 4 处(renderSrcTable / renderEnv 内的 add / tblRows), 其中 2 处内部确实调用了取词函数; ③ 真实 /api/status 的 sources 字段(id/enabled/priority/intervalMs)与门禁桩件数据一致, 故桩件断言能代表真实渲染路径。
- 改动(2026-09-11): ① app.js 三处局部 var tr 改名 rowEl(共 7 处替换); ② 把首个标签页回调参数 t 改名 tab, 让"无遮蔽"成为绝对不变量; ③ i18n-usage 门禁规则从"禁止局部绑定 t"扩展到"禁止局部绑定或参数名为 t / tr"; ④ G-BOOT 升级: 元素桩按 id 缓存同一实例、appendChild 记录子节点、打桩数据改为真实形状(/api/status、/api/config、/api/plugins、/api/logs、/api/env、/api/version)、等 25 个 tick 让 await 链跑完, 并新增两条**渲染内容断言**(#srcRows 与 #plugCards 必须有子节点); ⑤ 修掉两个门禁自身缺陷: byId 作用域写错(异常被门禁自己的 unhandledRejection 监听吞掉 → 什么都不打印且退出码 0)、appendChild 空实现(内容断言永远不可能通过); 三个 checks 的 process.exit() 改为 process.exitCode(管道下 process.exit 会丢弃未刷新的输出)。
- 教训: ① **改名重构必须扫"新名字与既有局部标识符的冲突"** —— 我批 1 只扫了旧名 t 的残留, 没扫新名 tr 的占用; ② **门禁断言必须落在产物上**(渲染结果), 只断言"没抛异常"是无效的 —— 这类错误会被应用自身的 try/catch 吃掉, 连 Promise 拒绝都看不到; ③ 门禁自身也要有"异常必须报 FAIL"的兜底, 否则作用域写错会让门禁静默通过(本轮实测: 升级后的门禁第一版正是这样假通过的)。
- 状态: CLOSED
## M-20260911-10 默认启动动画: 图标与文字不同步(图标后蹦)(CLOSED)
- 来源: 用户"我注意到默认启动动画在播放时软件图标并不是和文字一同出现的。能否优化"(2026-09-11)
- 现象: 默认启动动画里标题与副标题立即出现, 软件图标晚一拍才蹦出来, 两者不同步。
- 复现: 刷新控制台页面 → 动画开场只有文字, 图标随后补上。
- 影响面: 纯观感问题, 但每次启动(刷新)都会出现。
- 根因: simpleBoot 的覆盖层挂到 body 后**立即完全不透明**, 而图标是 <img src="/api/icon"> 异步取回, 且该接口响应头是 no-store(每次页面加载都要重新取) → 首帧只有文字, 图标随后才到。
- 证据: ① 代码路径: app.js 的 simpleBoot 里 cssText 没有初始 opacity, 图标是异步资源; server.js 的 /api/icon 走 serveFile(no-store); ② 门禁对照: 未优化版(HEAD)在升级后的 G-BOOT 上 exit=1, 报「simpleBoot 内容初始不是透明态: 图标会比文字晚出现」+「simpleBoot 未给图标注册 load 监听」; 优化版 exit=0。
- 改动(2026-09-11): ① simpleBoot 把内容(图标+标题+副标题+问候语)包进 .bwrap 容器并置 opacity:0 + transition; **覆盖层背景保持立即不透明**(否则会先闪一下控制台页面再播动画); 图标 load/error 后整组一起淡入, 并留 600ms 兜底(图标再慢也会显示, 出错也不会整段空白); 淡出 1900→2100ms、移除 2455→2700ms, 让"看清"的时长基本不变。② G-BOOT 升级: 元素桩记录事件监听、按 id/选择器缓存实例、style.cssText 做真正的声明解析、innerHTML 做极简解析(识别 class 与 style), 并新增三条断言 —— 启动动画内容必须初始透明、图标就绪后整组淡入、覆盖层本身不得隐藏。
- 用户实机确认(2026-09-11): **通过**
- 状态: CLOSED
## M-20260911-11 启动动画图标滞后: 2.4MB 大图 + 每次刷新重下(CLOSED)
- 来源: 用户"看起来还是滞后, 我注意到图标是有圆角的, 这个是实时渲染的吗? 要不改成死图片试试?"(2026-09-11)
- 现象: 上一轮"等图标就绪再显示"之后仍感觉滞后(600ms 兜底经常触发, 于是又变成文字先出现、图标后补)。
- 复现: 刷新控制台 → 启动动画先出文字, 图标慢半拍。
- 影响面: 每次刷新(启动)都会滞后; 顺带每次刷新白传 2.4MB。
- 根因(逐条回答用户的两个疑问): ① **图标不是实时渲染的** —— /api/icon 只是把工程根下的"软件图标.png"原样发出去(server.js:509-511 → serveFile), 用户看到的圆角是 CSS(border-radius:20px)在浏览器端做的; ② 那张图是 **2,477,976 字节 / 1728x1728**, 而动画里只显示 78px; ③ 更关键: serveFile 对所有静态资源都发 Cache-Control: no-store(这是为界面热更新服务的), 于是**每次刷新都要重新下载 2.4MB 并解码一张 1728² 的图**, 动画自然等不及。
- 证据: ① 文件实测 2,477,976 字节 / 1728x1728(读 PNG 头得到); ② 项目自带的 scripts/make-icon.ps1 早就在用 System.Drawing 做多尺寸降采样, electron/app.ico 里 256x256 那档只有 109,677 字节; ③ 隔离实例实测: /icon-256.png → 200 / 109,677 字节 / 带 ETag / 二次带 If-None-Match → **304 且 0 字节**, 而 /api/icon 仍是 2419.9 KB, /app.js 仍是 no-store(热更新未受影响)。
- 改动(2026-09-11): ① 从 electron/app.ico 中抽出 256x256 那一档(纯字节操作, 不引入任何依赖)存为 src/web/public/icon-256.png(107KB, **小 22.6 倍**); ② simpleBoot 与 startup-test.html 改用它, 并保留 /api/icon 作为 onerror 兜底(小图缺失时仍能显示), 再失败才隐藏; ③ index.html 的 head 增加 <link rel="preload" as="image" href="/icon-256.png">, 让下载在页面解析时就并行开始, 而不是等 /api/config 返回后才发起; ④ server.js 新增 serveAsset(): 图片类静态资源改用 ETag + no-cache(内容没变回 304), 其它文件保持 no-store 以免影响界面热更新; ⑤ G-BOOT 增加三条守卫断言: 启动动画必须使用 icon-256.png(用回 /api/icon 大图即 FAIL)、index.html 必须含 preload、图标必须注册 load 监听。
- 用户实机确认(2026-09-11): **通过**
- 状态: CLOSED
## M-20260911-12 后端未复验四项(M1/M5/L1/L3)复核并修复 + 端口体检不再卡死事件循环 + 22 处空 catch 接入上报(CLOSED)
- 来源: 2026-09-11 代码审核子代理报告的未复验清单 → 本次逐条复核: **四条全部属实**; 另更正一处子项
- 现象与复现:
  - **M1 readBody**: POST 超大 body(>256KB) 时直接 req.destroy() 且不回包 → 客户端只能看到"卡死"; 连接出错/中断时回调也永不触发, 请求同样挂住。
  - **L3 视频 Range**: Range: bytes=5000-100 → start=5000/end=100 → Content-Length = 100-5000+1 = 负数, createReadStream({start:5000,end:100}) 同步抛 ERR_OUT_OF_RANGE → 响应永不结束, 服务端只留一条未捕获异常。
  - **M5 插件定时器**: ctx.events.every() 产生的 interval 只进管理器总表, disable() 从不清 → 反复启用/停用会累积定时器。
  - **L1 日志双写**: autostart 生成的 bat 把 node src\\main.js 的 stdout 重定向进 logs\\app.log, 而 logger.js 同时 console.log + appendFileSync 写同一文件 → **每行日志写两遍**(实际症状比报告的"交错半行"更重)。
  - **M1 附带**: 端口体检在请求路径里同步跑 netstat/tasklist, 期间**整个事件循环停摆**(composer/OSC 一起停)。
- 更正: 子代理称 M5 还包含"scan() 在构造与 main.js 各调一次会重复启动 vrclog 监听" —— 复核 vrclog.js:93-95 为 if (watcher) return; 自带幂等, **该子项不成立**, 未做改动。
- 改动(批 3b, 2026-09-11): ① readBody 统一 finish() 出口: 超限清空并 destroy 后仍回调一次, error/aborted 也回调(零改调用点, 调用方总能走到自己的校验分支); ② Range: 支持后缀区间 bytes=-N, 不可满足区间按规范回 416 + Content-Range: bytes */total, 未解析出合法区间则忽略 Range 头回 200; ③ manager.js: every() 把定时器同时记在插件名下, 返回的清除函数从两处移除, disable() 先清插件名下定时器再 dispose; ④ autostart 生成的 bat 改把 stdout 写 logs\\stdout.log, housekeeping 截断清单同步加入 stdout.log; ⑤ server.js 22 处空 catch 全部接入 noteFail(where, err) —— 与前端 apiFail 对称, 按位置去重只报一次; ⑥ **netstatTable()/pidNames() 改为异步 execFile**, portCheck 内部改 await, 并把两次进程调用并行化。
- 验证(批 3b, 2026-09-11): ① Range 六个用例全过: 完整 200(1000 字节) / bytes=0-99 → 206+100 字节 / bytes=100- → 206 / bytes=-100 → 206(后缀 900-999) / **bytes=5000-100 → 416 且 1ms 返回**(修复前卡死) / 非法 Range 头 → 200; ② 300KB POST → **HTTP 200 且 7ms 返回**(修复前不回包), 之后服务正常; ③ 插件定时器: 启用后 1 个 → 停用后 0 个 → 反复启停 5 轮仍为 0(修复前每轮 +1); ④ **事件循环 A/B 实测**(隔离实例, 并发发 /api/ports/check 与 /api/version): 旧版(execFileSync) 体检 1700ms 期间另一个请求要等 **1661ms**; 新版(异步) 体检 1386ms 期间另一个请求仅 **5ms**; ⑤ run-gates -Smoke = 13 PASS / 1 FAIL(GSYNC 未推送属预期)。
- 遗留(低影响, 未处理): server.js 环境检测里两处 execFileSync('python', ...) 仍是同步(python 启动百毫秒级, 且仅在用户点"环境检测"时触发); 本机 netstat 实测 1.4~2.2 秒, 已异步化。
- 状态: CLOSED
## M-20260911-13 后端关键修复缺少永久护栏(安全围栏 / Range / 超限 / 缓存 / 事件循环)(CLOSED)
- 来源: 本次审核批次的自我检查 —— 批 1 的路径围栏、批 3b 的 Range/超限/缓存/事件循环修复, 当时都只有"临时跑过一次"的证据, **没有进常驻门禁**
- 现象: 这些修复若被后续改动破坏, run-gates 仍会全绿 —— 冒烟断言只做 GET + 正则匹配, 既不能发自定义请求头, 也不能发 POST 大 body, 更不能断言时序
- 影响面: "本机任意文件读"与"请求挂死"都属于"坏了也看不出来"的高危类型; 缓存策略(ETag/304)退化也只是变慢, 无人察觉
- 根因: 冒烟机制的能力边界 = GET + 正则; 而需要验证的行为分别依赖 **自定义请求头**(Range / If-None-Match)、**POST 大 body**、**并发时序**(事件循环是否被阻塞)
- 改动(2026-09-11): ① smoke.ps1 内置断言新增 4 条常驻项: config 读取拦截(403)、目录穿越拦截(403)、小图可服务(PNG)、环境检测接口; ② 新增 scripts/checks/backend-flow.js —— 在隔离实例上跑完整契约: 安全围栏 2 项 / Range 5 项(完整 200、0-99 206、后缀 bytes=-100、不可满足 416、非法头 200) / ETag+304 2 项 / 300KB POST / 事件循环非阻塞; ③ smoke.ps1 增加 -Flow 开关调用它, run-gates.ps1 的 G4 始终带 -Flow, 使之成为每次门禁的常规部分; ④ 事件循环断言带"样本不足则跳过"(体检 <300ms 时跳过), 避免在 netstat 很快的机器上误报
- 验证: run-gates -Smoke 的 G4 段内: 4 条新断言全过 + backend-flow **12 PASS / 0 FAIL**(含不可满足区间 416 立即返回、304 无响应体、300KB POST 9ms 返回、体检 **1305ms** 期间其他请求仅 **3ms**); gate-selftest.ps1 **11/11** 通过(确认门禁体系未被破坏); 总门禁 13 PASS / 1 FAIL(GSYNC 未推送属预期)
- 状态: CLOSED
## M-20260911-14 后端口径没有清单: 漏门与新增路由都无法被发现(CLOSED)
- 来源: 2026-09-11 审核的延续 —— M-20260911-02 的漏门(路径围栏缺失)暴露了结构性问题: 后端 55 条路由分散在手写 if 链里, 既没有清单, 也没有任何机制阻止"新路由忘了加门禁"
- 现象: 没有人能一眼说出"后端到底有多少条路由、哪几条本该要密码"; 把某条路由的 needL1 摘掉, 所有门禁依旧全绿
- 影响面: 漏门属静默类风险 —— 只会在安全上体现, 不会在功能上体现, 实机测试也测不出来
- 根因: 路由与门禁都是手写 if 语句, 缺少"口径清单"这个单一事实来源; 也没有 GSURF(攻击面基线)那样的"变化必须显式登记"机制
- 改动(2026-09-11): ① 新增 docs/ROUTES-BASELINE.json —— 55 条路由的 method + path + 门禁等级(49 零级 / 4 一级 / 2 开发者级), 含等级图例、四个特殊分支说明与 6 条人工注解(哪些是条件式一级、哪些按 F-20260903-01 设计属零级); ② 新增 scripts/checks/route-inventory.js(门禁 GROUTE): 从 server.js 解析路由与等级(**以 403 响应为锚**: needL1(res) / !unlockState.level1+403 / !unlockState.level2+403), 与基线逐条比对, 任何差异即 FAIL, 并检查首页/静态/插件静态/兜底 404 四个特殊分支未被静默删除; ③ run-gates.ps1 注册 GROUTE
- 验证(2026-09-11): ① 门禁绿灯: 代码 55 条 / 基线 55 条 / L0 49 L1 4 L2 2; ② **三类事故实测全部拦下** —— 悄悄新增一条路由 → "新增路由未登记"; 把 /api/config/export 的 needL1 摘掉 → "门禁等级变化: 基线 L1 -> 代码 L0(是不是漏了 needL1 / 403?)"; 基线里留一条代码中已删除的路由 → "基线里的路由已不存在"; 复原后门禁恢复绿灯且 server.js 字节级完好; ③ run-gates -Smoke = **14 PASS / 1 FAIL**(GSYNC 未推送属预期)
- 状态: CLOSED
## M-20260911-15 server.js 路由链抽表: 725 行 if/else → 精确路由表(CLOSED)
- 来源: 台账「server.js 路由链」(中优先级)+ 用户"继续优化"; 上一步刚补的 GROUTE 口径清单正是为这次重构准备的安全网
- 现象: 55 条路由挤压在单条 if/else 链里(约 725 行), 新增接口要手工插进链中; 门禁与错误返回逐条手写
- 影响面: 结构性 —— 每次加接口的出错面大(漏门 / 插错位置), 且 review 一个 700 行的移动式 diff 极难发现问题
- 根因: 路由分发用线性 if 链, 没有表结构, 也没有"分发"这一层的单一入口
- 改动(2026-09-11): ① 抽取 54 个路由块(含 1 个双路径 chatbox)从请求处理器内搬到 createServer 作用域, 变为 on(method, path, function (req, res, url) {...}) 注册(共 55 条), 处理器统一签名, 原闭包变量引用不变; ② 请求处理器只剩五步: 跨站守卫 → 首页 → 静态资源 → 插件静态前缀 → **表分发** → 兜底 404; ③ /plugin/* 前缀分支与区域内 3 条区块注释原样保留; ④ GROUTE 解析器升级为识别新形态(同时保留对旧 if 形态的兼容, 便于对照历史版本与二分定位); ⑤ backend-flow 新增**路由可达性扫描**: 清单里的 GET 路由逐条实打, 用响应体区分"落空 404"(分发器没匹配到)与业务 404, 任何一条丢失即 FAIL
- 验证(2026-09-11): ① **无损证明**: 换表前后 GROUTE 均报"代码 55 条 / 基线 55 条 / L0 49 L1 4 L2 2", 路由与门禁等级一字不差; ② G4 内 backend-flow **13 PASS / 0 FAIL**, 含"清单内 **17 条 GET 路由全部可达(无落空 404)**"; ③ 全套门禁 **14 PASS / 1 FAIL**(GSYNC 未推送属预期); ④ 行数 985→998, 最长行仍 1259 字符(未恶化)
- 状态: CLOSED
## M-20260911-16 index.html 内联块迁出(theme.js / fx.js)+ 主题标识 ASCII 化 + 门禁覆盖同步(CLOSED)
- 来源: 台账三行 ——「index.html 内联脚本残留(改判)」「主题命名三套并存」「跨文件隐式契约」; 用户"继续优化"
- 现象: ① index.html 里仍有 6,355 字符**真实功能逻辑**(主题系统 3,553 / 星空背景 2,802), 与 PROCESS-02 §0 #5「前端逻辑只进 app.js」的约定冲突; ② 主题一个概念三套命名 —— 配置/URL 侧用英文 key(blue), KEYMAP 映射到中文标识(海蓝), THEME_LABELS 再映射到 i18n 键(themeOcean), setTheme 以中文名作内部标识
- 影响面: index.html 继续膨胀; 主题相关改动要同时改三处; 内联代码不进门禁的可维护性检查
- 根因: 新版 UI 重写时主题与背景动效留在内联块里; 主题名最初以中文作标识, 后来加 i18n 与 URL 参数时各加了一层映射, 没人回收
- 改动(2026-09-11): ① 两个内联块**逐字**迁出为 src/web/public/theme.js(3,937 字节)与 fx.js(2,990 字节), index.html 现为 5 个外链脚本、**0 内联块**; ② 主题内部标识统一为 ASCII key(blue/teal/violet/green/amber/neon), 显示名仍走 window.t(themeXxx), 删掉恒等的 KEYMAP 映射层, URL 参数 ?t=xxx 直接用 key 校验 —— theme.js 代码区中文归零; ③ 门禁覆盖同步扩展(关键: 不能因为搬家而让检查范围缩水): GBOOT 加载 theme.js/fx.js 并断言两个跨文件契约(window.__reThemeLabels 可调用 / window.__fxRestart 存在)**外加主题真的应用了**(documentElement 上有 --bg 变量、#themeName 是文案而不是 i18n 键); GI18NH 扫描范围从 app.js 扩到 app.js + theme.js + fx.js; GHTML 新增「index.html 不得出现内联脚本块」的约定检查; ④ G-BOOT 沙箱补 canvas 2D 上下文桩与 innerWidth/innerHeight 等浏览器全局
- 验证(2026-09-11): ① GHTML: 5 外链 / 0 内联, 且**反向实测**塞回一个内联块立即 FAIL; ② GBOOT: 三个脚本全部加载通过, 两个契约存在且可调用, 主题变量已应用; ③ GI18NH: 扩展扫描后仍与基线一致(JS 6 项), **无需放宽基线**; ④ 全套门禁 **14 PASS / 1 FAIL**(GSYNC 未推送属预期)
- 用户实机确认(2026-09-11): 主题色板切换与安全与权限面板均**正常**
- 状态: CLOSED
## M-20260911-17 app.js 拆模块: 安全与权限整块独立 + 门禁改为自动发现(CLOSED)
- 来源: 台账「app.js 单文件密度」(低优先级: 至少把"安全与权限(旧版套皮)"整块独立出去); 用户"继续优化"
- 现象: app.js 单文件 71.7KB / 440 行, 平均 154 字符每行; 其中"安全与权限(旧版套皮)"整块(约 12.5KB)与界面主体混在一起
- 影响面: 文件持续膨胀; 每次改动都在一个 70KB 的文件里定位
- 根因: 新版 UI 移植时把旧版的安全设置整块贴进 app.js, 之后一直没拆
- 改动(2026-09-11): ① 按「安全与权限(旧版套皮)」分区标记切成两个经典脚本 —— app.js(59.5KB, 界面主体: 工具/标签页/公告板/插件/数据源/环境/动效/初始化)与 app-security.js(12.8KB, 安全设置 + i18n 取词 + 语言切换); index.html 按顺序外链(app.js → app-security.js → theme.js → fx.js); ② **拆分前先让门禁具备自动发现能力**: 新增 scripts/checks/_ui-files.js(自动发现 public/*.js, 排除 lang.js 词库与 skin.js 品牌数据; uiJsOrder 直接读 index.html 的 script 标签决定执行顺序), 四个前端门禁(i18n-usage / i18n-hardcode / ui-wiring / frontend-boot)全部改用它 —— 否则新文件会掉出门禁视野
- 验证(2026-09-11): ① **覆盖零缩水**(拆分前后对比): GI18NU 均 202 键、GUWIRE 均 87 控件 / 0 死控件、GI18NH 均与基线一致(HTML 21 / JS 6), 现在扫 4 个前端文件; ② GBOOT 按 index.html 的真实顺序加载 4 个文件: 顶层正常、两个跨文件契约可调用、主题变量已应用; ③ GHTML: 6 个外链全部存在且语法通过、0 内联块、157 个 id 无重复; ④ 全套门禁 **14 PASS / 1 FAIL**(GSYNC 未推送属预期)
- 用户实机确认(2026-09-11): 主题色板切换与安全与权限面板均**正常**
- 状态: CLOSED
## M-20260911-18 动效开关关掉后打不开: 星空画布不重启 + 已保存设置在加载时不生效(CLOSED)
- 来源: 用户"修一个bug, 动效开关关了后打不开"(2026-09-11)
- 现象: ① 点顶部「动效」主开关关掉动效后, 再点一次开关**视觉上**能变回"开", 但**背景星空不再回来**(看着就是"打不开"); ② 关掉动效后刷新页面, 动效会自己回来(设置等于没生效)。
- 复现: 点 #animTop 关动效 → 再点一次 → 画布静止不动; 关动效后刷新 → 动效照跑。
- 影响面: 动效主开关的"关→开"是坏的; 而且关上之后刷新即失效(设置只在当次会话有效)。
- 根因: ① fx.js 的画布循环一旦看到 body.no-anim 就自停(raf=0)并 return, 而**全项目只有 applyAnim() 会调用 window.__fxRestart()**; 但主开关 #animTop 的处理器直接操作 class、从不调用 applyAnim() → 关掉是自停、打开没人重启。② applyAnim() 只在"自动开关(#animTgl)"的处理器里被调用, 页面加载时从不调用 → 主开关把设置**只写进 localStorage 却没人读**。
- 证据(沙箱复现, 带可用的 classList 与有状态 localStorage): 修复前 —— 关→开后 __fxRestart 调用次数 **0**(FAIL); 加载时预设 master=1 → body **没有** no-anim(FAIL)。修复后两项均通过。门禁 A/B: 分别撤掉两处修复, G-BOOT 精确报出「动效重新打开时没有重启星空画布(__fxRestart 未被调用)」与「已保存的"关闭动效"在页面加载时没有被应用(主开关只存不读)」, 复原后通过。
- 改动(2026-09-11): ① #animTop 处理器改为"写 localStorage + 走 applyAnim()"(由 applyAnim 统一切类并重启画布); ② 动效分区末尾新增加载时的 applyAnim()(应用已保存设置); ③ pollStatus 里 _vrcRunning 变化后重判 applyAnim() —— 否则"检测到游戏在运行就自动停用动效"只在手动切换那一刻生效; ④ 顺手改正主开关的提示文案(animTitle 原为"游戏时关闭动效", 那其实是自动开关的描述; 三语改为"关闭 / 开启动效(含粒子与过渡)"); ⑤ G-BOOT 沙箱把 classList 与 localStorage 从空壳换成可用实现, 并新增三条动效断言(关得掉 / 开得回 / 加载时应用已保存设置)。
- 状态: CLOSED
## M-20260911-19 主题重启后不保留: theme.js 从不持久化(CLOSED)
- 来源: 用户"主题重启后不保存设置的主题样式"(2026-09-11)
- 现象: 在控制台用色板选好主题, 重启软件或刷新页面后回到默认的"海蓝"(blue)。
- 复现: 点色板换成"霓虹" → 重启/刷新 → 仍是"海蓝"。
- 影响面: 主题选择只在当次会话有效, 等于设置项不生效。
- 根因: theme.js(2026-09-11 从 index.html 内联块**逐字**迁出)从来没有持久化逻辑 —— 启动时无条件 setTheme('blue'), 色板点击只改内存与 CSS 变量, 既不写 localStorage 也不进 config。内部标识当天虽已统一为 ASCII key, 但"保存用户选择"这一步从未做过。
- 证据(A/B, 隔离沙箱带可用 localStorage): **HEAD 版** —— 点选后 localStorage 里没有 vrcbTheme、重开页面 --bg 回到默认(2 项 FAIL); **修复版** —— 点选写盘 ✓ / 重开恢复 ✓ / URL 参数优先 ✓ / 未保存时回落 blue ✓。门禁 A/B: 分别撤掉"写盘"与"启动恢复", G-BOOT 精确报出「点选主题后没有写入 localStorage(vrcbTheme)」与「重开页面没有恢复上次选的主题(主题不持久化)」。
- 改动(2026-09-11): ① setTheme 增加第二参数 save(默认保存): 用户点选即写入 localStorage['vrcbTheme'], 带 try/catch(隐私模式/禁用存储时不炸); ② 启动改用 pickTheme() 按优先级选主题 —— URL ?t=xxx(分享与测试) > localStorage 上次选择 > 默认 blue, 首次应用传 save=false(只有用户显式选择才记录); ③ 头部注释写明口径与优先级; ④ G-BOOT 新增主题持久化断言(点选要写盘 / 重开要恢复)。
- 说明: 选择存 localStorage 而不是 config —— 与动效开关(vrcbAnimMaster)及旧版控制台(vrcbBoardsOpen / vrcbGuideDone)同一层, 属"本机界面偏好"; 主题是纯客户端 CSS 变量, 服务端不需要知道, 因此不动 config 契约与 GCONF/GROUTE 基线。
- 状态: CLOSED
## M-20260911-20 数据源表格每 5 秒被整表重建: 正在输入的优先级会被打断(CLOSED)
- 来源: "程序还有哪些需要优化"自查(用户说"也可能我没发现" —— 这条正是此类)
- 现象: 在「数据源」标签里改优先级数字时, 输入框会在最多 5 秒内被替换掉: 已输入的字符丢失、焦点丢失、onchange 不触发(等于改不了这一格)。
- 复现: 打开数据源标签 → 在优先级输入框里慢慢输入数字(先别回车) → 5 秒内输入框被重建, 输入内容消失。
- 影响面: 优先级是本页唯一的可编辑字段, 也就是说这一页的编辑功能实际上很难用。
- 根因: pollStatus 每 5 秒跑一次并调用 renderSrcTable(), 而后者**无条件** tb.innerHTML='' + 逐行重建(每行都新建 input 元素)。
- 证据: ① 代码路径 —— pollStatus 每 5s(app.js:309) → renderSrcTable(app.js:133) → 无条件重建(app.js:129); ② 门禁 A/B —— 撤掉"数据没变不重建"守卫后, G-BOOT 报「数据没变时数据源表格仍被整表重建(正在输入的优先级会被打断)」, 复原后通过。
- 改动(2026-09-11): ① renderSrcTable(force) 加两道守卫 —— 数据签名(JSON.stringify)未变则不重建; 表格内有焦点(正在编辑)则不重建, 等下一次轮询; 只有真正重建时才更新签名; ② reRenderAll(切语言)改为 renderSrcTable(true) 强制重建, 否则表格会留在旧语言; ③ G-BOOT 新增断言: 数据没变不得重建 / 数据变了必须重建 / 重建后行数正确; ④ 顺带修门禁桩件保真度: innerHTML 赋值现在会清空 children(真实 DOM 行为), 否则"重建后旧节点应消失"这类断言永远失败。
- 状态: CLOSED

## M-20260911-21 每次截图都冷启动一个 PowerShell: 抽核心 + 常驻助手(CLOSED)
- 来源: 「截图开销」项(M-20260911-20 已量化: 每次截图 1.1~1.2 秒, 其中冷启动约 0.5 秒); 用户"从第二项开始"→"继续"(常驻进程属新增组件, 已单独确认)
- 现象: 拍摄本身只要几十毫秒, 但每次截图都要新起一个 powershell.exe; 一次截图翻译(OCR 默认 loops=2)至少付两次, 控制台「截图预览」按钮也付一次。
- 复现: 计时 `powershell -File src\helpers\screen_capture.ps1 -mode screen -scale 1 -maxdim 800 -out x.png` → 约 1.1~1.2 秒; 同一个 PowerShell 进程里连着拍第二张只要几十毫秒。
- 影响面: 截图翻译的固定开销约 1 秒/次, 与屏幕内容无关, 用户感知为"点了要等"。
- 根因: powershell.exe 冷启动 + Add-Type(Roslyn 编译 CapWin32、加载 UIAutomation)每个进程都要重付一遍。
- 证据(2026-09-11): ① 常驻后同一进程内第二次拍摄实测 **38~56ms**(改前每次 1.1~1.2 秒); ② 与 HEAD 版一次性脚本同机、同参数、同标题逐条比对 PNG(尺寸+字节数): 不存在的窗口 / 中文标题 / 空标题 / 英文标题四条**完全一致**(如 "VRCLiveBoard 控制台" 1128x608 / 48298 字节); 有一次不一致, 复跑 3 轮后逐字节一致 —— 那扇窗口当时正从小尺寸切到大尺寸, 与本次改动无关; ③ 新门禁 capture-host.js **13 PASS / 0 FAIL**, 含"常驻起不来时自动回退一次性调用"(把 spawn 打成抛错, 仍回 NO-REGION 且留下告警); ④ 门禁 A/B 见 DEV-NOTES 137。
- 改动(2026-09-11): ① 新增 src/helpers/capture_core.ps1 —— 拍摄核心(Add-Type 只做一次; Find-WindowByTitle 抽成函数; Invoke-Capture 返回协议串而不是 exit); ② src/helpers/screen_capture.ps1 变 14 行薄壳(参数与 stdout 协议一字不改); ③ 新增 src/helpers/capture_host.ps1 —— 常驻进程(stdin 逐行 JSON 指令 → 一行结果, 用 UTF-8 StreamReader 读); ④ 新增 src/capturehost.js —— 客户端(懒启动 / 串行化 / 超时 / 自愈 / 回退 / 退出); ⑤ 接线三处: ocrtranslate.js(captureWindow/foregroundGame)、web/server.js 截图预览、main.js 统一退出; ⑥ 新增门禁 scripts/checks/capture-host.js(13 项, 由 smoke.ps1 -Flow 在隔离实例上跑); ⑦ make-dist 必备文件清单补 3 个新文件。
- 说明: 回退是硬约定 —— 常驻起不来/响应超时/进程异常退出, 一律自动退回改造前的一次性调用, 最坏情况等于改造前; 因此本次不引入新的失败模式(代价是极端情况下白等一次启动超时)。
- 状态: CLOSED

## M-20260911-22 截图翻译改成弹对话框: 旧版是按钮旁的内联提示(用户实机反馈)(CLOSED)
- 来源: 用户实机反馈"改版后的会在截图之后弹出来一个对话框。原版是在按下截图按钮后就在按钮旁边提示"
- 现象: 点「截图翻译」后, 要等整轮跑完才弹出一个 alert 弹窗, 内容只有一句"进行中,请对准游戏里的文字..." —— 进度与结果都没有落在界面上; 旧版控制台是在按钮旁显示进度(#ocrtlState)+ 在下方块里显示 OCR 原文与译文(#ocrtlOut)。
- 复现: 控制台 → 翻译 → 截图翻译 → 点按钮 → 5 秒倒计时 + 整条流水线跑完 → 弹窗才出现(此时"进行中"已经没意义)。
- 影响面: 用户既拿不到进度(跑的时候界面没动静), 也拿不到结果(识别/译文只进聊天框, 控制台里看不到); 弹窗还打断操作。
- 根因: ① 新版 UI 移植这块时把旧版的 #ocrtlState/#ocrtlOut 换成了 alert(); 而 /api/ocrtl 是**同步等完整条流水线**才回响应(server.js:631), 所以弹窗必然出现在所有动作之后 —— 提示与动作在时间上完全错位。② 顺带查出: 3 个参数输入(倒计时/显示/循环)在移植时丢了 overrides 传递, 成了摆设; 且「显示(秒)」读的配置键写错(eachMs), 配置里其实是 displayMs, 于是永远显示默认 8 秒。
- 证据(2026-09-11): ① G-BOOT 新增 5 条断言(在桩件里真点一次按钮): 成功路径把 OCR 原文+译文写进 #shotOut 且结果块显示、按钮恢复可点; 失败路径把失败原因写进按钮旁 #shotMsg; **alert 次数必须为 0**; ② A/B 两个变体各自被精确拦下 —— 把 alert 加回去 → "截图翻译仍然弹对话框(alert 1 次)"; 让结果块不写内容 → "没有把 OCR 原文写进 #shotOut / 没有把译文写进 #shotOut / #shotOut 结果块没有显示出来" 三条; 恢复后复跑全绿; ③ 全套门禁 14 PASS / 1 FAIL(唯一 FAIL: GSYNC 报本地提交未推送)。
- 改动(2026-09-11): ① index.html: 按钮后加 <span id="shotMsg">(按钮旁提示), 卡片底部加 <pre id="shotOut">(结果块); ② app.js: 新增 shotHint(text,warn) 助手(写 #shotMsg 并按成败着色 var(--warn)/var(--ok)); #btnShot 重写为 —— 置灰按钮 → 立即显示"进行中,请对准游戏里的文字..." → 带 {delayMs,displayMs,loops} 触发 → 成功清提示并把"OCR 原文 / 译文(模型)"写进结果块, 失败在按钮旁显示 请求失败 + 原因 → 恢复按钮可点; ③ 删掉移植遗留的死处理器 #transShot(新版 index.html 无此 id, 且同样用 alert); ④ #ocrDisplay 读的配置键 eachMs → displayMs。
- 说明: 提示与结果复用了旧版已有的三语键(ocrRunning / ocrSrcLabel / ocrTrLabel / ocrTrLabel2 / loadFail) —— 这些键在新版 lang.js 里一直都在却没人引用, 说明"内联提示"本就是原设计, 是移植时丢掉的。
- 状态: CLOSED

## M-20260911-23 识别方式(以及三个参数)改了不落盘: 重启回默认(用户实机反馈)(CLOSED)
- 来源: 用户实机反馈"识别方式不会随着重启保存"
- 现象: 在「翻译 → 截图翻译」把识别方式从 auto 改成 vision/ocr, 重启或刷新后回到 auto; 倒计时/显示/循环三个输入框改了同样不保留。
- 复现: 翻译标签 → 识别方式选 vision → 重启软件(或刷新页面再看这项) → 又是 auto。
- 影响面: 这一项在**新版里完全没有作用** —— 既不落盘, 也没随触发发出去(移植后的触发体只带 delayMs/displayMs/loops, 这正是上一张卡 M-20260911-22 里改的那一处)。也就是说选了 vision 仍按 auto 跑, 用户以为换了识别方式, 实际什么都没变。
- 根因: ① 新版 UI 只在 loadTrans() 里把 config 读进下拉框, 没有任何保存路径(旧版虽然也不落盘, 但至少把 mode 当 overrides 随触发发出去, 当次生效); ② 服务端唯一能写 ocrtl 的接口 POST /api/ocrtl-vision 只认 vision 段四个字段(apiBase/apiKey/model/targetLang), mode 与三个参数没有入口 —— 合起来就是"改了等于没改"的完整闭环; ③ 同一面板另有一处同类: #ocrDisplay 读的键写错(eachMs), 配置里其实是 displayMs, 于是永远显示默认 8 秒。
- 证据(2026-09-11): ① 契约测试(隔离实例 backend-flow ⑦): 保存接口 200 → 回传生效值 → 运行中配置 → **落盘到 config.json** → 非法值被忽略 → 恢复默认, 共 7 条; ② A/B 两个方向都精确可分 —— 把服务端的 mode 处理改成不生效: 4 条 FAIL(回传/内存配置/落盘/非法值)而"越界夹取"那两条照旧通过; 撤掉 #transMode 的 onchange: G-BOOT 报 "#transMode 未接线(改了识别方式不会落盘, 重启回默认)"; ③ 修复后: 契约测试 17 PASS / 0 FAIL, G-BOOT 全绿, 全套门禁 14 PASS / 1 FAIL(唯一 FAIL: GSYNC 报本地提交未推送)。
- 改动(2026-09-11): ① server.js: POST /api/ocrtl-vision 扩展为 ocrtl 设置写入接口 —— 接受 mode(白名单 auto/vision/ocr)、delayMs(1000~60000)、displayMs(3000~120000)、loops(1~10), 一律夹取并回传生效值, 另加 rootConfig.ocrtl 空值守卫; ② app.js: 新增 saveOcrtl(), 识别方式与三个输入框接上 onchange(改完立刻落盘, 回传的生效值写回界面, 失败走 apiFail); ③ app.js: 触发体补上 mode(与旧版一致 —— 即使保存失败, 当次也按所选识别方式跑); ④ 修 #ocrDisplay 读的键 eachMs → displayMs; ⑤ 门禁: backend-flow 新增 7 条契约断言, G-BOOT 新增"改了必须发出保存请求 + 三个输入框必须接线"断言。
- 说明: 三个参数沿用同一个写入接口而不是新开路由 —— 路由清单(GROUTE)与 docs/ROUTES-BASELINE.json 不用动。另外注意"识别方式"(auto/vision/ocr)与"截图区域"(window/region/screen, 走 /api/capture/set)是两个不同的 mode, 面板上前者不保存、后者一直正常 —— 移植时最容易被合并掉的正是这种"同名不同物"。
- 状态: CLOSED

## M-20260911-24 反馈方式统一: 15 处 alert 弹窗改页内提示(用户"全做了吧")(CLOSED)
- 来源: 用户实机反馈"截图翻译弹对话框"之后, 本人自查发现同类写法还有 14 处; 用户指示"全做了吧"
- 现象: 保存设置、导出/导入配置、复制日志/体检结果、插件开关失败、端口生效、OSC 测试…… 全部用 alert() 弹窗反馈 —— 挡住整个界面要点一下才能继续、内容回看不了, 且与旧版控制台"反馈落在页面上"完全不一致。
- 影响面: 十几处日常操作被打断; 前端没有统一方式做"成功/失败"着色; 后续想加"重试/撤销"也没有落点。
- 根因: 新版 UI 移植时逐处用 alert() 顶替了旧版的页内提示(按钮旁 / 结果块 / 消息元素), 既没有统一助手, 也没有门禁约束 —— 谁写谁弹。
- 证据(2026-09-11): ① app.js 里 alert() 调用 **25 → 0**(用配对括号取完整实参再重写; 第一次用短锚点改写的做法把 3 处 "实参后还有字符串拼接" 的调用插坏, node --check 当场拦下); ② GHTML 新增静态规则"前端不得出现 alert()", A/B: 塞回一个 alert → 精确报 /app.js:23, 撤掉即通过; ③ G-BOOT 新增运行期断言(note() 必须让底部提示条显示并写入文字); ④ 全套门禁见 DEV-NOTES 140。
- 改动(2026-09-11): ① index.html 加底部提示条 #note(样式 + 元素, 4 秒自动消失); ② app.js 新增 note(text,kind,target) —— 不传 target 上提示条(ok/warn 着色), 传 target 写进指定元素(如 #plgMsg); ③ 25 处调用全部改写: 成功 ok 色 / 失败 warn 色 / 三元(成功失败同一调用)保持中性色, 插件导入缺路径写进 #plgMsg; ④ html-inline-check.js 增加"不得出现 alert()"规则; ⑤ frontend-boot.js 增加提示条断言; ⑥ PROCESS-02 §0 增加约定。
- 说明: 确认类弹窗(退出/重启/删页/装未授权插件)是 confirm(), 语义正确, 未动。
- 状态: CLOSED

## M-20260911-25 打包排除缺口: 彩蛋设计文件与旧版控制台会随包出厂(CLOSED)
- 来源: 用户"全做了吧"(建议里 D 项的打包疑点)
- 现象: make-dist.ps1 的排除表没有覆盖两样东西 —— ① 顶层开发文件 秘密开发-彩蛋设计.txt / 秘密开发-彩蛋设计演示.html(.gitignore 忽略, 但 robocopy 不认 .gitignore); ② 旧版控制台备份/(3 个文件 145.8KB)。两者都会被打进发布包。
- 影响面: 彩蛋设计稿外流直接剧透玩法; 旧版控制台随包出厂既是体积也是维护困惑(用户会看到两份控制台)。GPACK(pack-audit.js)的 FORBIDDEN_NAME 里没有"彩蛋/秘密开发/旧版控制台", 所以发布包审计也拦不住。
- 根因: 排除表按"已知文件名"逐个列举($xfFiles 里只有 秘密开发-新版UI计划.txt), 而 .gitignore 与打包排除表是两套互不相干的机制 —— 新增开发文件时容易只加进 .gitignore。
- 证据(2026-09-11): 用与脚本相同的 /XD /XF 口径做 robocopy /L 预演(只列不拷): 新口径 128 个文件 / 去掉这两项排除 133 个 → **差值正好 5**(旧版控制台备份 3 个 + 彩蛋文件 2 个; 目录枚举复核为 3 个)。注: robocopy 输出的中文文件名按 OEM 代码页乱码, 所以用"文件数差值"而不是按名字匹配做证据。
- 改动(2026-09-11): ① make-dist.ps1: $exclAbs 增加 旧版控制台备份; $xfFiles 增加 '秘密开发-彩蛋设计*'(通配, 覆盖 txt/html); ② pack-audit.js: FORBIDDEN_NAME 增加 /彩蛋/、/秘密开发/、/旧版控制台/ —— 即使排除表漏了, GPACK 也会在发布包审计里拦住。
- 说明: 仓库里两份都保留(旧版控制台是移植对照物, 彩蛋稿是设计存档), 只是不进包。GPACK 需要真 zip 才能跑(未随本次门禁执行), 规则本身已就位。
- 状态: CLOSED

## M-20260911-26 OCR 截图链路审计: 高危"静默复用旧截图"及一批中低危项修复(CLOSED)
- 来源: 子代理只读审计(用户"全做了吧"), 行动版落盘 docs/AUDIT-20260911-01-OCR链路.md
- 现象(高): 截图失败时助手回的是 "CAPTURE-FAIL: 原因"(脚本自身仍 exit 0), 而 captureWindow 只判 NO-WINDOW / NO-REGION, 其它一律当成功 → 失败时会拿着**上一轮残留的 .ocr-tmp.png** 去 OCR / 上传视觉接口, 聊天框显示旧截图的译文, 用户完全无感。现场证据: 仓库根目录就留着那次的 1,670,111 字节 .ocr-tmp.png(2026-09-11 21:41)。
- 影响面: 静默错误结果 + 旧截图被重复外发给第三方视觉接口(隐私); 另一个后果是本地 OCR 对不存在的路径报错, 排查困难。
- 根因: 客户端只做"否定式"判断(认出两个已知失败串), 没有"白名单式"判断(只有 OK 才算成功); 临时文件又是固定路径且用完不删, 两个缺陷叠加才产生"旧图当新图"。
- 证据(2026-09-11): ① 门禁新增 6 条用例(capture-host.js): OK 放行 / NO-WINDOW / NO-REGION / CAPTURE-FAIL / 空串 / 未知内容各自精确抛错, 跑出 20 PASS / 0 FAIL; ② 同时修掉同源的一批: 唯一临时文件 + 用完即删、mode=vision 未配置时不发注定 401 的请求并明确回退提示、分片上限给前缀留位(此前每片结尾被静默截 3~7 字)、worker 失败不再永久缓存、常驻进程加代次隔离与 stdin error 监听、超时立刻断开、回退错误信息提炼 stderr、cropW/cropH 非数字归一化、beep 加 error 监听。
- 改动(2026-09-11): 见 docs/AUDIT-20260911-01-OCR链路.md 的"已修"表(9 条); 挂账 7 条已在同文件与 PROCESS-02 §8 列明。
- 说明: 常驻助手本身经审计确认无进程泄漏、无注入面、UTF-8 双向正确、协议不会串行(详见审计"已核实无问题" 11 条)。
- 状态: CLOSED

## M-20260911-27 官方插件审计: netease 权限声明不实(高)已改正 + 其余挂账(CLOSED)
- 来源: 子代理只读审计(用户"全做了吧"), 行动版落盘 docs/AUDIT-20260911-02-官方插件.md
- 现象(高): netease-lyrics 的 manifest 写 permissions.process = false, 实际代码却 spawn/execFileSync PowerShell、读注册表卸载项、taskkill /F 强杀网易云、并 spawn 任意 cloudExe; 而审批红窗的高危提示只看 permissions.process —— 用户在"无害插件"的认知下完成了授权, 属**声明不实/告知失效**(宿主自述为契约式权限而非沙箱)。
- 影响面: 授权提示的信息基础失真; 收紧 processPolicy=deny 的用户也会被该插件的行为惊到。
- 根因: manifest 权限字段是"声明", 但没有任何门禁校验"声明与实现一致"; 插件的 require 钩子默认只审计不拦, 直连 require('child_process') 也不进审计日志。
- 证据(2026-09-11): 改后 GPLUG 0 FAIL / 0 WARN(授权哈希 netease-lyrics@1.1.3|2.0.0|070b2c70... 与更新包 netease-lyrics-1.1.3-2.zip 版本一致)。
- 改动(2026-09-11): manifest: process -> true; ports -> [9234]; description 补上"需要进程能力: 启动/结束网易云、写桌面快捷方式, 并占用本地调试端口 9234"。
- 说明: 版本号未动, 所以老用户的既有授权继续有效(manifest 不在授权哈希内 —— 这正是审计挂账里"审批哈希只覆盖 index.js"那条的另一面)。
- 挂账: 中危 8 条 + 低危 10 条已逐条列进 docs/AUDIT-20260911-02-官方插件.md 与 PROCESS-02 §8(其中 netease 的 fs/网络声明与 ctx.* 改造、cdp 定时器与 _send 超时、friend-welcome 的 busy 卡死与子串匹配、审批哈希覆盖面、weather 导入无上限等)。
- 状态: CLOSED

## M-20260911-28 审计收尾: 控制台差异 + 桌面壳/打包链路的高危项(用户"全做了吧")(CLOSED)
- 来源: 子代理只读审计(4 份); 行动版落盘 docs/AUDIT-20260911-01/02/03/04
- 现象与影响: ① "显示命令行窗口"开关**反着坏**(前端发 show, 服务端只认 visible → 取消勾选无效, 还会把已关的窗口重新打开); ② 打包链路: 开发自测插件 plugins/conflict-test(全权限)会随下一个包出厂, 而 pack-audit 反而强制要求它在包里; pack-audit 的禁入名单缺目录级规则(dev-dongle/ 里的 master.js、母狗使用说明、mini-template 等漏网); ③ **C1 级机密卫生**: 门禁自测把整仓复制到 %TEMP%, 排除表漏了 dev-dongle 与 config.json → 每次发布审计都会把 master.key / master-pass.txt / 授权登记表.xlsx / 含 devchain+level1Password 的真实配置复制到 %TEMP%(且只在脚本末尾删); ④ Electron 的 setWindowOpenHandler 把任意 URL 交给 shell.openExternal(file:/ms-settings:/smb: 都可能被执行), 无导航守卫; ⑤ .gitignore(私有文件名索引)、startup-test.html、开发者文档/04 随包出厂。
- 证据(2026-09-11): ① 全部门禁复跑通过(见提交记录), GPLUG 0 FAIL / 0 WARN, G2 编码 0 violation; ② 折叠见 DEV-NOTES 144; ③ 四份审计文档含"已核实无问题"清单, 避免重复排查。
- 改动(2026-09-11): ① app.js 的 {show:...} → {visible:...}; ② make-dist 插件复制跳过 conflict-test(两处), $xfFiles 增加 conflict-test/.gitignore/startup-test.html/打包与分发.md; ③ pack-audit 的 FORBIDDEN_NAME 补 9 条(dev-dongle 目录级/母狗/chain.json/mini-dongle/mini-unlock/.ocr-preview.png/.gitignore/startup-test/打包与分发)并让官方插件枚举跳过 conflict-test; ④ gate-selftest 的临时副本排除 dev-dongle/旧版控制台备份/测试素材目录 + /XF 机密文件, 并用 config.default.json 顶一份干净 config; ⑤ electron/main.js 的 openExternal 只放行 https + 加 will-navigate 守卫。
- 说明: 未修项(控制台差异 15 条 + 打包/壳 14 条)已逐条列进四份审计文档与 PROCESS-02 §8; 其中"docs/ 出厂范围""排除表改清单文件""--no-sandbox""Electron 镜像哈希"属需你拍板的决策项。
- 状态: CLOSED
## M-20260911-29 控制台恢复移植丢失(批 1): 新手引导 / 截图倒计时 / 当前来源 / 控制台地址 / 数据源状态(CLOSED)
- 来源: 新旧控制台差异审计(用户"全修了吧")的"建议优先修"清单
- 现象: ① 新手引导整块丢失(旧版首访自动弹 + 可勾"不再自动" + 页头常驻按钮), 键 guideTitle/guideText/guideNoAuto/guideBtn 三语都在却零引用; ② 截图翻译点完只有一句"进行中", 几十秒里界面毫无进度(后端 ocrState 一直在给 phase/countdown); ③ 聊天框预览看不出当前是谁在占、还剩多久(current/priority/ttlUntil 后端一直在给); ④ 页头写死 http://127.0.0.1:19190/, 端口被占自动 +1 时显示的是**错地址**; ⑤ 数据源"说明"列不再显示 helper 运行状态与 lastError(后端字段一直在)。
- 证据(2026-09-11): ① 666 个 id(160 → 166): 新增 #curMeta / #consoleUrl / #guideBtn / #guideOverlay / #guideNoAuto / #guideOk; ② G-BOOT 顶层加载正常 + GHTML 通过(id 唯一 / getElementById 目标全在 / 无 alert / 下拉 value 安全); ③ 全套门禁见提交记录。
- 改动(2026-09-11): ① index.html: 引导层(遮罩 + 标题/正文/不再自动/按钮, 三语键全是现成的) + 页头常驻引导按钮 + 当前来源行 #curMeta + 控制台实际地址 #consoleUrl; ② app.js: guideShow/guideHide + 首访自动弹一次(写 localStorage vrcbGuideDone) + 常驻按钮打开; pollStatus 里补三件事 —— 当前来源/优先级/剩余秒数、截图倒计时(phase==='countdown' 时把秒数写进按钮旁提示)、控制台实际地址(读 /api/ports 的 web.host/actual); 数据源说明列补 (SMTC 进程: 运行中/未运行) 与 lastError 前 60 字(用现成的 smtcRun/smtcDown 三语键)。
- 说明: 本批只做"键齐全、无产品口径争议"的 5 项; 其余控制台挂账(插件三件套: 删除/打开页/重扫、健康总览接回 /api/health、更新按钮回页头、capInfo、portsInfo、13 段说明文字、成功回执、日志行为)仍列在 docs/AUDIT-20260911-03-新旧控制台差异.md。
- 状态: CLOSED
## M-20260911-30 打包唯一清单 + 国内可用性(镜像回退/哈希校验/npm 国内源)+ 出厂白名单(CLOSED)
- 来源: 打包链路审计的"下一步建议" + 用户"按照你的建议来, 考虑到国内用户的使用"
- 现象: ① "什么能出厂"由 make-dist 脚本里的两套字面量名单决定(pack-audit 另有一套正则), 越用越容易漏; ② 首次运行从 npm 源装依赖、从镜像下载 Electron 并直接解压执行, 无任何完整性校验; ③ docs/ 与仓库根有一批内部资料顺带进包(ISSUES/PROCESS-*/基线 json/开发者文档 04/版本说明内部条目等)。
- 影响面: 漏排除 = 内部资料/开发物料出厂; 无校验 = 镜像或中间人被投毒的后果是用户机执行任意代码; 但**不能**为了校验把国内用户挡住(官方 GitHub 在国内经常连不上)。
- 根因: 名单分散在两个脚本里各自维护; 安装链路只考虑"能装上", 没考虑"装上的东西是否可信"; 出厂范围从来没有白名单。
- 证据(2026-09-11): ① 清单文件 scripts/pack-exclude.json 成为唯一来源(dirs 13 / files 31 / 禁入正则 23), make-dist 与 pack-audit 都读它; ② make-dist 的 PS5.1 解析错误 0(BOM 保留), GPLUG 仍 0 FAIL / 0 WARN; ③ 全套门禁见提交记录。
- 改动(2026-09-11): ① 新增 scripts/pack-exclude.json(目录/文件/目录名正则/禁入正则/docs 白名单); make-dist 读它并与历史字面量取并集, pack-audit 的 FORBIDDEN_NAME 直接由它生成(两边不再各写一套); docs 只发 DEV-NOTES/GLOSSARY/PLUGIN-DEV/LIVETRANSLATE/RESEARCH, FEATURES 目录与其余 docs 文件全部不进包; ② install-electron.js: 国内优先 npmmirror、失败自动回退官方 release; 下载后**用镜像公布的 SHASUMS256.txt 严格校验**(不一致直接中止), 镜像没提供时明确警告后继续(不因校验把国内用户挡住); ③ ensure-deps.js: 默认源失败后自动改用 registry.npmmirror.com 重试一次, 用户不必手工配 registry。
- 拍板结论(2026-09-11, 用户授权按建议执行): **保留 `--no-sandbox`** —— 国内机器 GPU/驱动差异大, 去掉可能白屏而收益只是一个没有现成利用链的纵深防御缺口; 同时本轮已把 openExternal 收成"只放行 https"并加了 will-navigate 守卫, 实际暴露面已大幅下降。这一条与被否掉的"改官方源"一起记在此处, 避免以后被当成遗漏重复提。
- 状态: CLOSED
## M-20260911-31 插件代码级修复(批 1): friend-welcome 永久卡死 + 子串匹配, cdp 定时器/超时/上限(CLOSED)
- 来源: 官方插件审计的中危项(用户"全修了吧")
- 现象: ① friend-welcome 一旦某次播报抛错(例如手工改 config.json 让 lines 变成非数组), busy 永远为 true —— 此后所有好友进房被静默丢弃, 插件看起来正常但已永久失效; ② 好友名用 indexOf 子串匹配, 填"小"会命中所有名字含"小"的陌生人; ③ netease 的 cdp 客户端在 await 连接期间被停用时, 重连定时器会在停用之后才创建且引用丢失 → 停用后每 15 秒仍重连, 连上还会起 1 秒轮询, 永久不可回收; ④ cdp 的 _send 无超时无上限, ws 卡住时每秒新增一个永不 settle 的 Promise/Map 条目, dispose 也不结束它们。
- 证据(2026-09-11): ① 改动后 node --check 通过、GPLUG 0 FAIL / 0 WARN(注: 授权哈希只覆盖 index.js —— 改 cdp.js 不会让既有授权失效, 这正是审计挂账里那条"哈希覆盖面"的另一面, 已列决策项); ② 全套门禁见提交记录。
- 改动(2026-09-11): ① friend-welcome: 子串匹配改精确匹配(忽略大小写, 名称去空白), lines 加 Array 校验, showSequence 用 Promise.resolve 包住并补 .catch + try/catch —— **任何失败都解锁 busy**; ② netease cdp: 新增 _disposed 标记, start() 在 await 之后先检查再建定时器且先清旧的; _send 加 8 秒超时与 200 条上限; dispose() 标记停用 + 结束所有未应答请求并清空。
- 说明: 插件行为没有门禁覆盖(现有插件门禁只查契约与单一源), 这批修复靠静态复核 + node --check; 要真正回归需要插件测试夹具(已列挂账)。
- 状态: CLOSED
## M-20260911-32 插件代码级修复(批 2): weather 导入上限 / scheduled 测试按钮 / netease 回显与日志 / 自测夹具移出(CLOSED)
- 来源: 官方插件审计的挂账(用户"继续")
- 现象: ① weather-board 导入逐行串行 geocode(每行 15 秒超时)且无行数上限, 大表会把控制台请求挂很久; 一次性 setTimeout 未登记, 停用后仍会发一条, 反复导入还会叠加; ② scheduled-board 的"立即测试播报"永远报"未知测试类型"(前端传 regular, 插件只认 hour/special); ③ netease 的 status() 不返回 cfg, 而前端读 j.cfg → 设置面板回显永久失效; ④ netease 有两处 spawn 无 'error' 监听(靠主进程全局兜底才没崩), taskkill 失败被空 catch 吞掉; ⑤ 开发自测夹具 conflict-test(全权限)留在 plugins/ 里, 会被复制进包并让用户看到高危授权弹窗。
- 证据(2026-09-11): ① 三个插件 node --check 通过; ② GPLUG 0 FAIL / 0 WARN(plugins/ 现为 4 个, conflict-test 已移到 dev-fixtures/ 并从打包清单排除); ③ 全套门禁见提交记录。
- 改动(2026-09-11): ① weather-board: 单次导入上限 200 行(超出在返回值里给 truncated), 一次性定时器用句柄登记 + 重新导入先清旧的; ② scheduled-board: testFire 支持 regular(播第一条常规公告, 没有则明确报错), saveRows 补入参保护; ③ netease: status() 返回 cfg, 两处 spawn 补 'error' 监听, taskkill 失败改为记日志(不再静默); ④ friend-welcome: exclusive 声明 chatbox-timeline(此前占用独占资源却没声明, 静态冲突检测看不见); ⑤ conflict-test 移出 plugins/ → dev-fixtures/(git mv, 打包清单已加 dev-fixtures)。
- 说明: weather-board 的授权哈希随 index.js 变化(0991d931...), 已授权的用户会被要求重新授权一次 —— 这是设计如此(index.js 是哈希对象)。
- 状态: CLOSED
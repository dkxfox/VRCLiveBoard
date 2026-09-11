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

## M-20260911-05 更新链接注入路径: 白名单未锚尾 + 前端 innerHTML 未转义(OPEN)
- 来源: 2026-09-11 新版代码审核
- 现象: 版本更新提示把服务端返回的 releaseUrl 直接拼进 innerHTML 的 href, 未转义; 而服务端白名单正则只锚定前缀、未锚定结尾。
- 复现: 构造 version.json: {"version":"9.9.9","releaseUrl":"https://github.com/dkxfox/VRCLiveBoard\"><img src=x onerror=alert(1)>"} → versioncheck.validate() 放行(前缀匹配成功), 前端 app.js 将其拼入 `<a href="...">` → 注入的 img/onerror 进入控制台页面。
- 影响面: 需要攻击者控制更新源。config.update.mirror 是**用户可配置的第一优先源**(versioncheck.js:52-53), 所以威胁模型下可达; 也可通过劫持 jsDelivr/GitHub 响应实现。
- 根因: 双半格防线 —— 服务端 versioncheck.js:26 正则 `^https://(github.com/dkxfox/VRCLiveBoard|cdn.jsdelivr.net/gh/dkxfox/VRCLiveBoard)` 无 `$` 与字符集约束; 前端 app.js:85(批 B 新增代码)直接 innerHTML 拼接。
- 计划: 批 2 —— 服务端正则锚尾 + 限制路径字符集; 前端改 esc() 或 DOM API 赋值(纵深防御)。
- 状态: OPEN(批 2)

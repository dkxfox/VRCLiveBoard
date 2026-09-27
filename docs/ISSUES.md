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

> **从归档块保留的未关闭项(2026-09-27)**: 下列 1 张卡归档时仍未关闭(编号沿用旧编号), 因此留在主表。

### M-20260903-06 VRChat 已开 OSC 但软件显示无法连接(全红)
- 状态: NEED-REPRO(已回问, 待反馈者提供信息)
- 严重度: S2(主功能不可用)
- 来源: 使用者反馈(2026-09-03)
- 现象: "VRC 中开启了 OSC 功能, 但软件无法连接, 所有状态指示都是红灯"
- 复现: 无(待回问: ①软件版本是否 v1.3.2 ②顶部圆点颜色(绿/黄/灰) ③是否在世界内 ④启动方式/加速器/自定义端口 ⑤UDP 9000 行具体文字 ⑥一键诊断报告)
- 影响面: 待定
- 初步假设(按概率): ①旧版本(≤1.3.1)UDP 空闲=红的旧误报设计, v1.3.2 已修复 → 先升级复测; ②OSC 未真正生效(需进世界/每账号设置); ③日志未读到(USERPROFILE 不一致/非标准启动); ④OSC 端口不一致(--osc 参数); ⑤9000 被其他进程占用; ⑥加速器/杀软拦 loopback
- 关联: M-20260902-06(UDP 指示灯旧误报, v1.3.2 修复)、DEV-NOTES 105

> **归档说明(2026-09-27)**: 2026-09-03 全量审计的 C4 记录 + 已关闭卡片 + 2026-09-11 那一整批 CLOSED 卡(共 61 张)已移入 **`docs/ISSUES-ARCHIVE.md`**(编号未重排); 主表只留卡片模板 + 进行中 + 2026-09-19 之后的卡。
## M-20260919-01 截图翻译: 拍不到画面时把“全黑图”当成成功 + 抬窗只第一次生效(用户实机反馈)
- 状态: FIXED(待用户 VR 实机确认)
- 严重度: S2(主功能: 窗口最小化/被遮挡时, 截图翻译会 OCR 空图或拍错窗口)
- 来源: 用户反馈(2026-09-19): “截图翻译似乎只有第一次会在截图时避让窗口…我们需要保证即使是在 VR 多窗口下也能正确截到 VRC 的窗口”
- 现象: 用户观察到“抬窗”只有第一次生效, 怀疑后续截的是屏幕上恰好显示的东西。本机实测(VRChat 在跑): 窗口 1920x1080、未最小化、**不是前台**(前台是另一个 1294x767 的窗口), 此时 PrintWindow 仍拿到正常画面(平均亮度 187 / 近黑 0%) —— 说明**拍窗口内容本身与遮挡无关**, 隐患在别处。
- 根因(四处): ① 只判断 PrintWindow 的**返回值**, 不判断**画面是否有效** —— Unity/D3D 窗口在最小化等状态下常见“返回 true 但整幅全黑”, 改前照收, 于是 OCR 拿空图, 用户看到“没翻译/没反应”; ② 抬窗用裸 SetForegroundWindow: 后台进程会被 Windows 拒绝(只闪任务栏) —— 这就是“只有第一次”的真身(第一次多半是前台恰好允许); ③ 窗口解析取 UIA 首个同名匹配, 多窗口下不明确, 且**没有任何日志**说明拍了哪个窗口; ④ 失败没有专门错误码, 排障无从下手。
- 影响面: 所有截图翻译用户; 窗口最小化 / 被其它窗口完全遮挡 / 长时间不在前台时必然受影响 —— VR 用户(桌面窗口常最小化)首当其冲。
- 改动: ① 候选窗口**枚举 + 打分**(标题精确/包含、Unity 类、VRChat 进程、可见、未最小化、面积; **永不含自家进程**, 仅门禁可用 allowSelf 打开); ② 新增**空画面判定**: 近黑率 ≥92% 或采样颜色 ≤3 视为无效; ③ 抓取改为**分级阶梯**: PrintWindow(**不动窗口**) → 无效才恢复(若最小化)/抬窗(AttachThreadInput + SetWindowPos(HWND_TOP) + SetForegroundWindow)/等待/重拍 → 再无效才屏幕拷贝 → 仍无效回新错误码 EMPTY-CAPTURE; ④ 新增诊断日志 logs/capture-diag.log(窗口描述/策略/亮度/近黑率/候选数/是否抬窗); ⑤ 新增 probeimg 模式(同一判定器检查任意 PNG); ⑥ 调用方识别 EMPTY-CAPTURE 并给明确中文提示(绝不拿空图去 OCR)。
- 验证: ① 本机实测真实 VRChat 窗口: strategy=printwindow avg=187 black=0pct raised=False —— **拍到了, 且完全没打扰窗口**; ② 门禁 capture-host.js 20 → **27 条**(黑图/纯色图判为不可用、正常图判为可用、缺图回 PROBE-FAIL、真实窗口“抓到且未打扰”、全黑窗口必须被拒); ③ 契约回归: title=NoSuchWindowXYZ 仍回 NO-WINDOW(候选兜底不会劫持别的标题); ④ 隔离冒烟 15/15。
- 教训: ① **“API 返回成功”不等于“拿到了有用的东西”** —— 图像/渲染类接口必须对**内容**做体检(本项目第二次栽在这类“不会报错的错”上); ② **抬窗在 Windows 上不可靠**, 不该放在关键路径上: 能用“拍窗口自身内容”解决的就别动 z-order; ③ 窗口类功能必须留“到底拍了哪个窗口”的日志, 否则用户报“拍不到”时没有任何抓手。
- 关联: DEV-NOTES 180
- 状态: FIXED(等用户在 VR 实机确认)

## M-20260919-02 默认模型名写成接口不存在的 deepseek-v4.1-flash → 每次截图都静默回退本地 OCR(我自己引入)
- 状态: FIXED(待用户实机确认)
- 严重度: S2(主功能降级: 截图翻译一直走本地 OCR, 用户只看到“翻译很糊”)
- 来源: 用户反馈(2026-09-19): “我怎么感觉现在用 deepseek-v4.1-flash 好像都是 OCR 模式啊？V41 是有视觉多模态的”
- 现象: 截图翻译有结果, 但都是本地 OCR 的糊字; 界面**没有任何提示**, 只有日志里有 `HTTP 400 ... but you passed deepseek-v4.1-flash`。
- 根因: ① 我在条目 177 把用户口述的模型名直接写进了 `config.default.json`, **没有对着真实接口验一次**; ② 接口实际只支持 `deepseek-flash` / `deepseek-v4-pro`; ③ 视觉失败路径**只写日志**(与 M-20260911-41 同款的“静默回退”毛病)。
- 影响面: 1.4.1 之后按新默认真空装的用户; 手动填该名字的老用户同样中招。
- 改动: ① 默认值改 **deepseek-flash**(config.default.json / lang.js 示例 / 使用说明); ② **视觉失败可见化**: 失败时往聊天框推 transient + 把 `visionError` 放进结果对象, 界面在按钮旁与结果块显示(复用既有三语键 visionFail, 此前是死键)。
- 验证: ① 接口实测: `GET /models` = deepseek-flash / deepseek-v4-pro; 图片请求两者 200、`deepseek-v4.1-flash` 400、旧名 `deepseek-v4-flash-vision-exp` 200 但别名到 deepseek-flash; ② 端到端实测(用户密钥 + 合成英文图): full 与 smart 两档各约 1.5s, 行为与设计一致( smart 跳过 Join/世界名/UI 标签, 只翻简介/规则/作者公告并保留 SDK 2.0 原词); ③ 门禁 14 PASS + 隔离冒烟 15/15。
- 教训: **外部标识符(模型名/URL/参数名)必须对着真实接口验一次再写进默认值**; 手边就有密钥, 一次 `/models` 就能避免。“能用 ≠ 名字对”(旧名是被别名过去的)。
- 关联: DEV-NOTES 181(更正 177)
- 补充(2026-09-19, 用户提醒我查官网后核对): 官网模型表写明 **deepseek-v4-pro 不支持 Vision**, 且思考模式默认开启(effort=high) —— 实测同图 关闭思考 1.0s/41 token vs 默认 5.0s/1126 token(思考占 1077), v4-pro 直接回“图片无法显示”。已按文档改为: 视觉请求默认关闭思考(官方域名; 第三方端点默认不带该字段, 可用 ocrtl.vision.thinking 覆盖)=见 DEV-NOTES 182。
- 状态: FIXED(待用户实机确认)

## M-20260919-03 插件卡片上「没有优先级设定框」(其实有, 被折叠区重渲染抹掉了)(用户实机反馈)
- 状态: FIXED(待用户实机确认)
- 严重度: S3(体验: 单个插件的优先级改不了, 只剩页顶的一键重置)
- 来源: 用户反馈(2026-09-19): 「插件系统里的插件少了优先级的设定框」
- 现象: 插件卡片上看不到优先级输入框; 只有插件页顶部的「优先级重置」按钮。
- 根因(**代码里其实有这个输入框, 只是活不过一次渲染**): `app.js` 把它 `insertBefore` 进了 `.plgcard-body` —— 那是**可折叠的设置区**: ① 默认 `display:none`, 不展开就看不见; ② 一展开, `loadPlgSettings()` 会用 `innerHTML = ...` 重写整块, **把刚建好的输入框抹掉**。同一类坑 M-20260911-47 已经踩过一次(删除按钮当时也在折叠区里, 不展开根本看不到)。
- 影响面: 所有想单独调某个插件优先级的用户; 官方与第三方插件一视同仁。
- 改动: 输入框移到**卡片头** `.plgcard-ctrl`(与删除按钮同处, 常显), 带「优先级」标签 + 占位「默认」+ 悬停说明(复用 `thPrio` / `plgPrioPh` / `plgPrioHint` 三个此前躺着没用的键); **留空 = 交回插件自带默认**(与旧版同口径 `priority:null`), 输入夹到 ±999, 保存后给回执(新键 `plgPrioSaved`, 三语)并刷新卡片。
- 验证: 门禁 `frontend-boot.js` 新增断言「卡片头里必须有优先级输入框(带占位提示)」, 并**红队验证**: 把控件改回折叠区 → 门禁报 `FAIL 插件卡片的卡片头里没有优先级输入框(控件被挂到了会被重渲染的折叠区?)`, 恢复后 exit=0; 常规门禁 14 PASS + 隔离冒烟 15/15。
- 教训: **「控件在不在用户看得见的地方」是产品属性, 不是实现细节** —— 同一个坑(卡片级控件放进折叠区)在删除按钮和优先级输入框上各踩一次; 这次把它变成门禁: 只要控件被挪回折叠区就 FAIL。
- 关联: DEV-NOTES 185; 审计 AUDIT-20260911-03 第 28 行
- 状态: FIXED(待用户实机确认)

## M-20260919-04 插件页新增「打开插件文件夹」按钮(用户建议)
- 状态: FIXED(待用户实机确认)
- 严重度: S4(体验优化)
- 来源: 用户建议(2026-09-19): 「给插件导入那个卡片里加个打开插件文件夹目录的按钮如何?」
- 现象/诉求: 安装插件第 1 条路是"把插件文件夹放进程序目录的 plugins", 但用户得自己找路径; zip 导入那条路要手打完整路径。
- 改动: ① 后端新增 `POST /api/plugins/open-dir` —— **不接受任何路径参数**, 只开 `<程序目录>/plugins`(否则等于对外提供了一个"打开任意路径"的接口); 桌面壳走 Electron `shell.openPath`, 纯 Node 走 `cmd /c start`(与既有 `/api/devdocs/open` 同一套做法); ② 插件卡新增「打开插件文件夹」按钮 + 成功/失败回执(三语); ③ 路由基线登记(level 0)并写明理由; ④ **无人值守护栏**: `VRCB_NO_SHELL=1` 时只回路径不弹窗 —— 否则每跑一次冒烟都会在用户桌面弹出资源管理器; 冒烟脚本已设该变量。
- 验证: 门禁 14 PASS; 隔离冒烟 15/15(backend-flow 100 → **105 条**): 接口可用 / 只回 plugins 路径 / **传入 path 参数被忽略** / 无人值守 skipped=true / GET 不匹配 404; 使用说明第七节补了两行。
- 关联: DEV-NOTES 186

## M-20260920-01 控制台「打开页面」(第三方面板)是死按键 —— 面板容器在 1.4.x 控制台里缺失(开发 B站插件时自查)
- 状态: **WONTFIX-面板 / FIXED-死按键**(2026-09-25 结论): 面板容器缺失已久且没有真实需求方, 决定**不支持插件自带面板**; 「打开页面」死按键与关闭残留逻辑**已摘除**, 带 panel 的插件改为显示一行说明(三语 `plgPanelGone`), 设置统一走 `manifest.settings`(见 PLUGIN-DEV.md)。恢复面板能力需另立功能卡。
- 严重度: S3(体验: 插件自带设置页打不开, 第三方插件的面板能力等于没有)
- 来源: 做 B站插件设置界面时顺手核对 —— 点按钮 → 前端找不到容器
- 现象: 插件卡片上的「打开页面」按钮点了没有任何反应。
- 复现: 1. 启用任一带 `panel` 的插件(如 weather-board); 2. 在插件卡片点「打开页面」; 3. 期望弹出面板, 实际什么都不发生。
- 根因: ① `app.js` 的处理器取 `plgPanelOverlay` / `plgPanelFrame`, 而这两个元素在 `index.html` 里**根本不存在**(新版控制台重写时丢了容器, 同类遗漏见 M-20260907-01「缺失面板类」), 处理器开头 `if (!ov || !fr) return;` 于是静默返回; ② `GET /api/plugins/panel` 只回 JSON(`{title, html}`), 没有把面板 HTML 渲染成 iframe 页面的壳, 也没有 `wxSaveAll` / `plgPickXlsx` 这类"面板内函数 → 插件 `api` 方法"的桥 —— 也就是说面板即便弹出来也调不到插件方法。
- 影响面: 1.4.x 全版本; 官方 weather-board / friend-welcome / scheduled-board 与所有带面板的第三方插件。
- 改动(本次**未修**, 只登记并绕开): B站插件不走面板, 改用 `manifest.settings` + 插件卡片自动渲染(见 DEV-NOTES 197); 面板本身两个选项: 补"容器 + 渲染壳 + api 桥", 或明确废弃并摘掉「打开页面」按钮。
- 验证: 本次只做静态走查(`app.js:236` / `app.js:471` / `server.js:559`); 待修时补断言(点按钮必须出现 iframe 且能调到插件方法)。
- 关联: DEV-NOTES 197; M-20260907-01(缺失面板类)

## M-20260920-02 占位插件的 README 说"拷进 plugins/ 能正常加载", 其实导出形状不符合插件契约(自查)
- 状态: FIXED
- 严重度: S4(开发期误导, 不影响用户)
- 来源: 自查(把占位代码搬进 `plugins/` 时)
- 现象: `插件研发/bilibili-live/index.js` 导出的是 `{onLoad, onUnload}`, 而契约要的是 `module.exports = function (ctx) { return { apply, dispose, api, panel } }`。
- 根因: 写占位骨架时按"类钩子"的直觉写的, 没对着 `docs/PLUGIN-DEV.md` 逐字核对导出形状; 而"能正常加载"**从未真正验证过** —— 门禁不扫 `插件研发/`(不随包出厂), 谁也没试过把它拷进 `plugins/`。
- 改动: 代码搬进 `plugins/bilibili-live/` 并改成真正的插件工厂(`apply` / `dispose` / `api`), 从此由 GPLUG 门禁按同一套契约校验; 占位 README 里那句话已删掉。
- 验证: `node scripts/checks/plugin-check.js` → `OK bilibili-live v0.2.0 (api 2.0.0, 授权哈希 bilibili-live@0.2.0|2.0.0|cc04ae4c...)`; 插件离线单测 166 条全绿。
- 教训: **"文件放对了"不等于"契约对"** —— 契约类的东西要对着规范逐字写, 并且让门禁覆盖得到(现在由 GPLUG 覆盖)。
- 关联: DEV-NOTES 197

## M-20260925-01 【C3·审计器自身】dep-audit 的 npm audit 是**假通过**(ENOLOCK 被当成"0 漏洞")(PROCESS-03 3A 发现)
- 状态: FIXED(假通过已消除; 让 npm audit 真正可跑需用户决定加不加根 lockfile)
- 严重度: C3(依赖侧防线形同虚设, 但不直接可利用)
- 来源: 2026-09-25 走 PROCESS-03 3A 时, 注意到 dep-audit 打印 OK 而其 stderr 里有 npm 报错
- 现象: `node scripts/checks/dep-audit.js` 打印 `OK npm audit: 严重 0 / 高危 0 / 中 0 / 低 0`, 但 npm 实际**没跑成功**。
- 根因: 本机工作区在 UNC 路径上且**仓库根没有 package-lock.json**, `npm audit --json` 回 `{"error":{"code":"ENOLOCK",...}}` 并退出 1; dep-audit 的 catch 分支解析该 JSON 后取 `j.metadata.vulnerabilities`(**不存在**)→ 得到 `{}` → 当成"0 个漏洞"打 OK。**扫描器说自己绿了, 比漏报更危险**。
- 改动: `scripts/checks/dep-audit.js` catch 分支: 没有 `metadata.vulnerabilities` 就报 **WARN + 原因**, 不再算通过(新增 warn 计数与汇总行)。
- 验证: 复跑输出 `WARN npm audit 没有给出结果(ENOLOCK: This command requires an existing lockfile.) —— 这条不算通过, 需人工确认` + `---- 1 WARN ----`; 依赖清单与 8 项受监控产物哈希仍 OK。
- 已修(2026-09-25, 用户"继续完成修补"): ① 生成并提交根 `package-lock.json`(**26KB**, 在本地临时目录用 `npm install --package-lock-only --ignore-scripts` 生成后拷回 —— UNC 工作区里 npm 的 cmd 包装器跑不了); ② 修掉 `dep-audit` 执行 npm 的方式: Windows 上 `.cmd` 必须 shell 才能 spawn, 而 shell(cmd.exe) 不接受 UNC 做 cwd → 改为**用当前 node 直接跑 npm 的 CLI js**。复跑结果: `OK npm audit: 严重 0 / 高危 0 / 中 0 / 低 0(合计 0)` —— 依赖审计从"假通过"变成**真的在跑**。
- 关联: DEV-NOTES 208; PROCESS-03 §0「审计器本身也要被审计」

## M-20260925-02 【C2·已修】弹幕服务器地址未做白名单校验 —— 认证令牌可能被发到任意主机(PROCESS-03 3A 发现)
- 状态: FIXED
- 严重度: C2(令牌外泄的前提是 start 响应被篡改, 但代价高、修起来便宜)
- 来源: 审计新插件代码时自查(manifest 声明的域名只对 `ctx.http.request` 生效, WebSocket 不受门禁约束)
- 现象: `session.js` 直接用 start 响应里的 `host_server_url_list` 建连接; 而**认证帧里带 auth_body(令牌)** —— 被篡改/劫持的响应就能把令牌发到 `wss://evil.example.com`。
- 根因: 动态返回的服务器地址是**外部输入**, 原实现照单全收(`07-接入实现要点.md` 里其实写过"需白名单校验", 但没实现)。
- 改动: `session.js` 新增 `hostAllowed()` 与 `allowHosts`(默认 `*.chat.bilibili.com` + 本机回环); 白名单外**不建连接**、记 `lastError` 并写日志; 纯函数导出便于断言。
- 验证: 新增 9 条单测 —— 官方域名/子域/回环放行; 陌生域名拒绝; **伪造后缀 `chat.bilibili.com.evil.com` 拒绝**(按域名边界匹配); 白名单外主机 wsFactory **一次都没被调用**。
- 残余边界(诚实): 框架层仍不会拦"插件自己 new WebSocket(...) 去别处" —— 本次是**插件自己**加了闸; 要框架级强制需另立卡。

## M-20260925-03 【C3·已修】帧解析缺三道闸: 压缩炸弹 / 超长帧 / 缓冲无限涨(PROCESS-03 3A 发现)
- 状态: FIXED
- 严重度: C3(内存类 DoS; 触发前提是服务端被控制或数据被篡改)
- 根因: 帧头长度由对端说了算; `brotliDecompressSync` 无上限(几百 KB 可解出几百 MB); 压缩帧可嵌套; `session` 接收缓冲无上限。
- 改动: `frame.js` 三道闸 —— ①单帧声明长度上限 8MB(`too-large` 错误帧, 不去分配内存)②解压后上限 4MB(`maxOutputLength`, 抛错即当坏帧)③压缩嵌套 ≤3 层; `session.js` 加 8MB 接收缓冲上限(超限断开重连)并把错误帧写进日志。
- 验证: `frame.test.js` 新增 4 条(超长帧 / 真·压缩炸弹 / 5 层嵌套 / **正常一层压缩仍照常展开**), 既有用例全绿。

## M-20260925-04 【C4·已修】surface-scan 扫描器盲区: 把"永不进包"的测试文件算进了出厂攻击面(PROCESS-03 3A 发现)
- 状态: FIXED
- 严重度: C4(扫描器噪音, 会逼着基线无意义扩容或被忽略)
- 现象: 报 `新增域名 i0.hdslb.com, x` 与 `新增危险API child_process: plugins/bilibili-live/test/run-all.js` —— 全是测试夹具里的假 URL 与测试汇总脚本。
- 根因: 脚本注释写着"只扫会随包出厂的代码", 实现却只跳过 `node_modules/vendor/.git`, 不知道 `scripts/pack-exclude.json`(打包脚本用的唯一排除清单)。
- 改动: 读 `pack-exclude.json` 的 dirs/files 并在遍历时跳过; 复跑后只剩两个**真实**新增域名。
- 验证: `FAIL 外部域名 新增: api.live.bilibili.com, live-open.biliapi.com`(人工复核后进基线: 域名 14 → **16**, `updatedAt` → 2026-09-25), 其余类别全部 OK。

## M-20260925-05 【C3】i18n 取词函数 `tr` 在加载期不可用(app.js 依赖后加载的 app-security.js)(本轮实机发现)
- 状态: **FIXED**(2026-09-25 根因已除: `tr`/`t`/语言码归位 `lang.js`(head 最先加载), app-security.js 只留 `langGet/langSet`; GBOOT 加断言"lang.js 执行后 tr 立刻可用"; 前端桩件阶段 2~8 的沙箱统一补跑 lang.js)
- 严重度: C3(实机日志 `[前端] Promise拒绝: tr is not defined`)
- 现象: 页面加载期的异步路径(微任务/立刻返回的 fetch 回调)调 `tr()` 抛 ReferenceError → 某处文案不更新, 只留一条 Promise 拒绝。
- 根因: `function tr()` 定义在 **app-security.js**, 而它在 app.js **之后**执行; GBOOT 原来只拦"顶层同步调用", 异步路径是漏网。
- 已做(兜底): app.js 顶部加 `window.tr` 兜底(按原键显示 + 英文 console 提醒一次), app-security.js 执行后用真 tr 覆盖。
- 待修(**根因**): 把取词函数与词典初始化从 app-security.js 挪到 lang.js(或独立 `i18n.js`, 排在 app.js 之前), app-security.js 只留安全策略; GBOOT 补断言"app.js 执行前 tr 必须已可用"。
- 关联: DEV-NOTES 208

## M-20260925-06 【C3】隔离冒烟的"插件生命周期"用例只覆盖了 1 个插件(本轮新建, 泛化待做)
- 状态: **FIXED**(2026-09-25: `plugin-behavior.js` 新增"通用插件生命周期"块, 遍历 `plugins/` 全部 5 个插件跑 factory→apply→dispose, 断言"不抛错 / 数据源 enabled+priority+getText 齐 / dispose 后定时器全取消"; 结果 45 PASS / 0 FAIL)
- 严重度: C3(本轮正是这类缺口放过了"数据源没 enabled")
- 现状: `backend-flow.js` ⑦c 只对 `bilibili-live` 跑"批准→启用→调接口→停用→再启用", 并断言"数据源已注册/停用后接口不可调"。
- 待修: 泛化成遍历 `plugins/` —— 每个插件至少断言: 工厂 apply/dispose 不抛错、启用后列表 enabled、停用后接口 400、注册的数据源 `enabled` 为真(后者用假 ctx 在 plugin-behavior.js 做即可)。
- 关联: DEV-NOTES 209/210

## M-20260925-07 【C4】`feature-accept.ps1` 的 ASSERT 正则不能含引号(框架传参把引号吃掉)(本轮写功能卡时踩到)
- 状态: **FIXED**(2026-09-25): 断言改走 **base64** 通道(`feature-accept.ps1` 编码 → `smoke.ps1 -AssertB64` 解码), 引号/竖线不再经过命令行解析层; 功能卡里那条正则已改回自然的 `"id":"bilibili-live"` 写法并复跑 **19 PASS / 0 FAIL**。
- 严重度: C4(工具坑: 写卡片的人会以为是自己正则写错)
- 现象: `- ASSERT: 插件已被装载并列出|/api/plugins|"id":"bilibili-live"` 永远 FAIL, 去掉引号(`bilibili-live`)立刻 PASS, 而打印出的响应体里明明有 `"id":"bilibili-live"`。
- 根因: 断言文本经 PowerShell 参数/字符串层传递, 双引号在某层被剥掉。
- 待修: 改成不经引号层的传递(写临时 JSON 再读 / base64 / 单引号包裹), 并删掉卡片模板里的规避说明。
- 关联: DEV-NOTES 207/210

## M-20260925-08 【C4】官方插件设置"死面板 + 老内联渲染器"两套并存(与 M-20260920-01 同源)
- 状态: OPEN
- 严重度: C4(体验/维护: 用户点了没反应; 两套机制并存容易漏改)
- 现状: ① 「打开页面」仍是死按键 —— 4 个官方插件的 `panel` 全部打不开; ② 官方插件设置走各自 `window.__plgset_<id>` 内联 HTML, 而本轮新增的通用机制是 `manifest.settings`(数据驱动 + 密钥不回显 + 保存热生效)。
- 待修: 先对面板给出结论(补齐 或 废弃并摘按钮), 再把 4 个官方插件设置逐步迁到 `manifest.settings`(**迁移完成前不要删 `__plgset_*`**, 否则设置界面直接消失)。
- 关联: M-20260920-01; DEV-NOTES 197/210

## M-20260927-01 【C4】轻量版在 Node 18/20 上会以"看不懂的方式"失败: 说明没写清 + 主程序无版本自检(PROCESS-01/02/03 标准审计发现)
- 状态: FIXED
- 严重度: C4(文档口径缺口; 直接后果是用户装完跑不起来却拿不到可读提示)
- 来源: 2026-09-27 标准与记录审计(汇报 P0-5, 用户拍板"连启动检查一起做")
- 现象: `package.json` 已是 `engines.node >=22`、README 也写明 22+("随包的插件用了全局 WebSocket, Node 18/20 会失败"), 但《使用说明》轻量版一段只写"需要电脑已安装 Node.js"; 且**主程序启动时没有任何版本自检** —— Node 18/20 用户只能看到插件在后台报 `WebSocket is not defined` 之类的错, 或某个功能"就是不动"。
- 复现: 1. 在 Node 18/20 环境解压 Lite 包; 2. 双击 `启动.bat`; 3. 期望: 明确告知需要 Node 22+; 实际(改前): 启动看似正常, 启用歌词/B站插件后才以无关报错的形式失败。
- 影响面: 按《使用说明》装轻量版且系统 Node < 22 的用户。桌面版不受影响 —— 实测 `ELECTRON_RUN_AS_NODE=1 electron -e ...` → `electron-node 24.18.1 / electron 43.4.0 / ws-global function`。
- 根因: ① `engines` 字段只对 npm 安装生效, 双击 bat 的用户走不到; ② "运行要求"写在说明文件的**插件章节**(第 395 行)而不是安装章节; ③ 主程序把环境判定权完全交给插件运行时。
- 改动: ① `使用说明.txt` 轻量版段 → "需要电脑已安装 Node.js **22 或更高(18/20 会跑不起来)**"; ② `src/main.js` 启动横幅之后加自检: `process.versions.node` 主版本 < 22 → `logger.warn` 明确提示并给出升级指引(**只提示、不拦启动**); ③ `docs/DOC-BASELINE.json` 把 `Node.js 22 或更高` 固化为 must 断言(GDOC 从此守这条口径)。
- 验证: 常规门禁 **14 PASS**(G1 覆盖 main.js 语法 / G2 编码 / GDOC 含新断言 0 FAIL)+ 隔离冒烟 **15/15 PASS**; 详见 DEV-NOTES 219。
- 关联: DEV-NOTES 219; 条目 218(审计批 A)

## M-20260927-03 【C3】manifest.ai 没进 status().permissions → AI 插件既不显示也不走高危确认(功能卡收口时发现)
- 状态: FIXED(2026-09-27)
- 严重度: C3(安全 UX 静默降级; 当时没有任何插件声明 ai, 属潜在缺口 —— 一旦有 AI 插件, 用户会在"不知道它要花我的 AI 额度"的情况下授权)
- 来源: 2026-09-27 功能卡收口时跑 feature-accept, F-20260903-02 的"审批窗AI能力显示"断言 FAIL, 顺链查到根因
- 现象: 声明 `manifest.ai.tasks` 的插件在审批窗里**看不到 AI 能力项**, 也**不需要输入插件名确认**; 而《使用说明》第 138/221 行明确承诺"声明进程执行或 AI 能力的高危插件还需输入插件名确认"。
- 根因: `manifest.ai` 是**顶层**字段(PLUGIN-DEV 示例), 但 `PluginManager.status()` 只回 `permissions: e.manifest.permissions`; 前端 `app.js` 的 `plgPermsDesc` / `plgPermsHtml` / `plgWarn` 一直按 `p.permissions.ai` 判定 → 恒为 undefined(既不显示、也不进高危档)。
- 影响面: 所有走控制台审批的 AI 插件(当前 **0 个**; 官方 5 个插件均未声明 ai)。潜在面: 未来任何 AI 插件。
- 改动: ① `src/pluginsys/manager.js` 新增纯函数 `permsViewOf(manifest)`(把 `manifest.ai.tasks` 归并进 `permissions.ai`, 其余字段原样透传), `status()` 改用它, 并导出供门禁断言; ② `scripts/checks/plugin-check.js`(GPLUG)新增 **6 条断言**: 5 条纯函数(映射成功 / 不覆盖原字段 / 未声明不产生 / 空数组不产生 / manifest 缺失安全回退)+ **1 条行为级**(临时目录造一个声明 ai 的假插件, 真实 `new PluginManager(...)` 后断言 `status().plugins[0].permissions.ai.tasks` 存在)。
- 验证: ① GPLUG → `0 FAIL / 0 WARN`(6 条新断言全绿); ② **红队**: 把 `status()` 改回旧写法 → 门禁报 `FAIL status() 行为: 声明 ai 的插件没有带 permissions.ai —— 审批窗会漏掉 AI 高危确认与 AI 显示`(exit=1), 恢复后 `0 FAIL`; ③ 常规门禁 14 PASS + 隔离冒烟 15/15。
- 关联: DEV-NOTES 221; F-20260903-02; 使用说明 第 138/221 行
## M-20260927-02 【C4】两张功能卡的 ASSERT 指向重构后不存在的标识符 → feature-accept 假 FAIL(功能卡收口时发现)
- 状态: FIXED(2026-09-27)
- 严重度: C4(记录与工具: 卡片"自测"常年 FAIL, 反而没人看得出功能到底还在不在)
- 来源: 2026-09-27 功能卡收口时跑 feature-accept
- 现象: `feature-accept.ps1 -Card F-20260903-01` → `SMOKE RESULT: pass=13 fail=2`; `-Card F-20260903-02` → `pass=13 fail=1`。失败项 = "审批窗风险分级在页面脚本|/app.js|plgRiskHigh / plgPermsRisk" 与 "审批窗AI能力显示|/app.js|permAi"。
- 根因: 这三条断言写于 2026-09-03, 之后前端经历 2026-09-11 的拆分与重写(app.js 拆出 app-security.js 等), 审批窗实现改名为 `plgPermsHtml` / `plgWarn` / `plgRiskNote` / `plgAiShort`; **旧标识符 `plgRiskHigh`、`permAi` 只剩 lang.js 里的死键, `plgPermsRisk` 从来没有过**。断言没人跑, 于是没人发现(这正是 M-20260927-03 那种真缺口能藏两个月的原因)。
- 影响面: 这两张卡的自测长期假 FAIL; "功能还在不在"没有机器证据(实际功能仍在, 见验证)。
- 改动: ① 两张卡的 ASSERT 行改为**真实且带行为含义**的标识符(F-20260903-01: `plgPermsHtml` + `plgRiskNote`; F-20260903-02: `plgAiShort`), 每张卡加一行"断言重校(2026-09-27)"说明; ② F-20260903-02 用文字指向 GPLUG 的 6 条 AI 映射断言 —— **不写实例断言**(当前无插件声明 ai, 写了就是假绿); ③ 两张卡的 D3/D4 勾选项按实测补全。
- 验证: 改后重跑 —— F-20260903-01 `SMOKE RESULT: pass=15 fail=0`(exit=0); F-20260903-02 `pass=14 fail=0`(exit=0); 功能本体走查 `app.js:176-186`(风险着色 + 高危判定 + 输入插件名/ID + 5 秒倒计时)与 `index.html:365-376`(`plgModal` / `plgRiskNote` / `plgConfirm` 容器在)。
- 遗留: ~~`plgRiskHigh` / `permAi` 死键~~ **已于 2026-09-27 清理**(三语各删 2 键, 649 → 647 键, 见 M-20260927-04); `plgPermsRisk` 从未存在过(只出现在卡片文本里, 卡片已改)。
- 关联: DEV-NOTES 222; F-20260903-01 / F-20260903-02; M-20260927-03
## M-20260927-04 【C4】i18n 死键清理: `plgRiskHigh` / `permAi`(前端重写后被更强措辞取代)+ 台账数字同步
- 状态: FIXED(2026-09-27)
- 严重度: C4(i18n 卫生; 直接后果是"看键猜功能"—— 本轮正是靠死键才误判过审批窗功能是否还在)
- 来源: M-20260927-02 的遗留项(功能卡收口时发现)
- 现象: `lang.js` 主字典里三语各有一条 `plgRiskHigh`("(高危: 可执行任意命令!)")与 `permAi`("AI 能力(使用你的 AI 配置与密钥, 可能产生费用):"), **全仓库无任何代码引用**(已用 `plgRiskHigh|permAi|plgPermsRisk` 扫 `src/**`、`plugins/**`、`electron/`、`index.html` 佐证)。
- 根因: 2026-09-11 前端重写把审批窗改成按权限逐项渲染 + 风险着色, 旧的两条"整块警告"文案被新键取代, 但旧键没人删 —— GI18N 只管"三语键集合是否一致", **不管"键有没有人用"**(这点在条目 214 里已有过同款记录)。
- 关键判断(先核实再删): 删之前确认**新措辞没有变弱** —— 现值 `plgAiCons` = "可能把屏幕/聊天内容发送给第三方(内容外泄)+ 产生调用费"、`plgProcCons` = "可能执行任意命令、控制整台电脑、装后门"、`plgWarnNote` = 明确的批准/取消告知; 旧键的"(高危: 可执行任意命令!)"与"可能产生费用"**已被覆盖且更具体**, 故不存在"删掉就丢警告"的风险。
- 改动: ① `src/web/public/lang.js` 三语各删 2 键(共 6 处), 649 → **647 键**, 85,609 → **85,247 字节**; ② `docs/PROCESS-02` §7 台账同步为实测值(647 键 / 85.2KB); ③ 本卡与 M-20260927-02 的遗留互相勾销。
- 验证: `i18n-check.js` → 三语 **647 键(缺 0 / 多 0 / 空 0)**; `i18n-usage.js` → 引用完整性 OK(tr() 269 / data-t 234 / 字典 647); `i18n-hardcode.js` → 白名单基线不变(21 + 6 项); 常规门禁 14 PASS + 隔离冒烟 15/15。
- 关联: DEV-NOTES 223; M-20260927-02(发现者); 条目 214(同类: 死键是移植遗漏的指纹)
## M-20260927-05 【C4】DEV-NOTES 历史结构异常 4 处: 编号倒序 ×2 + 空条目 ×2(建 GNOTES 门禁时发现)
- 状态: **FIXED**(2026-09-27 同日清理完毕: 倒序搬正 + 空条目加标注 + 白名单清空)
- 严重度: C4(检索与可信度: 记录乱序会让"按编号读历史"的人走错方向)
- 来源: 2026-09-27 新建 `dev-notes-index.js`(GNOTES)时, 门禁**第一次运行**就报出来
- 现象(4 处, 门禁输出为证): ① 条目 **122 在 121 之前**(269/283 行); ② 条目 **214 在 211 之前**(962/969 行); ③④ 条目 **110、111 是空条目**(只有标题没有正文, 184/185 行, 且 112 号缺失)
- 根因: 与本次会话我自己犯过两次的错**同一类** —— 追加条目时锚点取成"上一条内部的某一行", 新条目被插进上一条中间/之前; 当时的门禁(GDOC 等)只守说明文件, 不守 DEV-NOTES 的结构, 所以没人发现。
- 处置(本次): **先登记 + 进基线白名单**(`docs/DEV-NOTES-INDEX-BASELINE.json`): GNOTES 对白名单内报 WARN、白名单外报 **FAIL** —— 新事故立刻红灯, 历史项不阻塞提交。
- 待办(需要用户定): ① 两处倒序**可以纯搬块修正**(用"输入集合 = 输出集合"断言保证一个字节不丢), 但会改动历史记录的行序; ② 空条目 110/111 的正文已不可考(标题即全部信息): 要么补写"当时发生了什么", 要么标注"(正文缺失, 仅存标题)"。**建议**: 倒序搬正 + 空条目加标注, 一次做完并把过程写进 DEV-NOTES。
- **清理结果(2026-09-27)**: ① 两处倒序用脚本**按编号重排**(断言: 块集合一致 + 内容零丢失 + 重排后严格递增, 全部 true; 位置变化的块 = 121/122/211/212/213/214); ② 两个空条目各加一行"正文缺失"标注并指向同期条目(113/114), **不追补、不臆造内容**; ③ `docs/DEV-NOTES-INDEX-BASELINE.json` 两张白名单表**清空**(留 `clearedAt/clearedBy` 字段说明来龙去脉), 从此非空即代表存在被容忍的历史异常。
- 验证: `node scripts\checks\dev-notes-index.js` → **0 FAIL / 0 WARN**(条目编号严格递增 119 条 / 每条目都有正文 / 索引一致); 常规门禁 15 PASS + 隔离冒烟 15/15。
- 关联: DEV-NOTES 225(门禁建立)、**226(清理)**; M-20260927-02 / M-20260927-04(同类写入事故)
## M-20260927-06 【S3】启动彩蛋"按日期触发"从未真正生效: mmddOf 不认 ISO 日期(用户实机"不播放视频")
- 状态: FIXED(2026-09-27)
- 严重度: S3(彩蛋是锦上添花, 不播不影响正常使用; 但"从不触发"= 该功能 100% 失效)
- 来源: 用户实机测试 —— 我把触发日期改成今天后请其自测, 反馈"不播放视频"(2026-09-27)
- 现象: 事件窗口设成今天 → 重启程序 → 启动画面只有普通动画, 不播视频; `config.json` 的 `efx.played` 始终为空(证明判定根本没命中)。
- 根因(E1 实测): `efxDecision` 的**默认路径**用 `mmddOf(localDateStr())`, 而 `localDateStr()` 返回 **'YYYY-MM-DD'**, `mmddOf` 的正则只接受 **MM-DD** → 返回空串 → `dayNumOf('') = -1` → `efxInWindow` 恒为 false。`?date=` 与测试页路径总是显式传 MM-DD, 所以一直显示正常 —— 这个 bug 从功能上线(`486790a`, 2026-09-12, 1.4.0)一直藏到 1.4.5。
- 影响面: **1.4.0 ~ 1.4.5 全部版本**: 任何"按日期窗口"的特殊彩蛋都不播("开关关→强播一次"的路径同样走这个判定, 也不播)。显式传 `date=MM-DD` 的调用(开发测试页预览)不受影响。
- 改动: ① `src/web/server.js`: `mmddOf` 改为与 `parseDateArg` 同口径(`^(?:\d{4}-)?(\d{2})-(\d{2})$`), ISO 与 MM-DD 都接受, 垃圾输入仍返回空串; ② `scripts/checks/backend-flow.js` 新增 **3 条回归断言**(隔离实例): 默认路径(不传 date)命中今天 / 显式传 ISO 日期命中 / 窗口外日期不命中 —— 全部 `dry=1`, 不写已播状态。
- 验证: **红队对照**(必做): 把 `mmddOf` 改回旧实现 → 断言报 `FAIL 启动彩蛋: 默认路径(不传 date)命中今天的窗口(action=normal)`(backend-flow 134 PASS / 1 FAIL); 恢复修复 → `PASS ... (action=special)`(backend-flow **135 PASS / 0 FAIL**) —— 断言确实抓得住这个 bug。常规门禁 15 PASS + 隔离冒烟 15/15。
- 遗留: 已发布的 **1.4.5 带此 bug**, 修复随**下一个版本(1.4.6)** 出厂; 用户本机从仓库运行, 重启即生效。



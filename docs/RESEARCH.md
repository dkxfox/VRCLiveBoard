# VRCLiveBoard 调研笔记(2026-01)

> 目标: VRChat 用 OSC 工具 —— 展示电脑状态/媒体信息/自定义公告板,预留扩展接口(桌面歌词、第三方程序文本推送)。

## VRChat 协议要点(以官方文档 docs.vrchat.com/docs/osc-overview 为准,部分数值待游戏内实测)

- 开启: 游戏内 Action Menu → Options → OSC → Enabled。
- 应用 → VRChat: UDP 127.0.0.1:**9000**(默认,游戏内可改);VRChat → 应用: **9001**。
- 聊天框: /chatbox/input(string)、/chatbox/typing(bool)。
- 限制: 最多 **144 字符**;支持 \n 换行(观看者需在设置里开启聊天框换行);emoji 不渲染;超长消息可能被整体丢弃 → 一律自动截断。
- 同步节流: 聊天框网络同步约 1 次/秒 → 轮播间隔 ≥3 秒。
- OSCQuery: http://localhost:9000(JSON,可查询 avatar 参数,后期用)。
- 高级显示: /avatar/parameters/* + 文字 shader(远期可选,不走聊天框)。
- 预期管理: 聊天框显示在自己和附近玩家头顶,不是全屏;所有人都能看到的"公告板"效果 = 轮播聊天框文本。

## 社区同类工具(参考对象)

- **VRCOSC**(VolcanicArts/VRCOSC, vrcosc.com): C#/Avalonia 模块化 OSC 程序,Media(now playing)/HardwareStats/Chatbox 等模块齐全。架构参考: 模块注册 + 统一更新循环 + OSC 路由。
- **TTS-Voice-Wizard**: STT/TTS + SMTC now playing → 聊天框。证实 SMTC 是社区通用的"正在播放"来源。
- **KillFrenzyAvatarText**: 早期聊天框文本工具。
- **VRCTextboxOSC / VRCTextboxSTT**(I5UCC): 文本框 → OSC / Whisper STT → 聊天框。
- **Billboard**(Frosty704/Billboard): VRChat 公告板,与本项目"人肉公告板"定位最接近。
- **advosc**(TheArmagan): 高级聊天框编辑器 + 裸 OSC + avatar 配置。
- **vrchat-ime-chat**(26d0): IME 输入 → 聊天框(CJK 输入参考)。
- **VRChat Speech Assistant**(GitLab): 语音 → 聊天框。
- **MioVRC_Translator**(CokoIya): 翻译 → VRChat OSC(与用户翻译软件需求同类)。
- **vrchat-box**(Rust crate): 聊天框客户端库。
- 官方仓库: vrchat-community/osc(GitHub,wiki/docs);中文镜像 docs.vrczh.org。

## 本机环境实测(决定技术选型)

- 机器: Windows,Node v24.19.0,npm 11.17.0,Python 3.12.10,**无 .NET SDK**;RTX 5070 Ti(nvidia-smi 可用)。
- 网络: npm registry 可用;npmmirror 可用(Electron 二进制有戏);GitHub/PyPI 文件站/powershell curl 全被挡;**pip 装不了包** → Python 出局。
- 沙箱内可测: OSC UDP 回路(osc 2.4.5 只有 UDPPort 导出)、UIA(System.Windows.Automation)、nvidia-smi、tesseract.js + @tesseract.js-data/chi_sim(npm 上有,离线中文 OCR)、systeminformation(npm)。
- 沙箱内被挡但用户桌面可用: WinRT(SMTC 媒体会话 / Windows OCR)、WMI(CPU/内存)。
  → SMTC 用 PowerShell 5.1 常驻 helper 输出 JSON lines(用户桌面可用;沙箱测不了,做优雅降级)。
- 沙箱 pwsh 完全看不到工作区 UNC(连 Z:\ 也不行),开发回路 = write 工具 → 真实 Temp 目录 → pwsh/node 执行;交付物 = 源码经 write 工具进工作区 + 用户侧 npm install 脚本。
- 项目目录: \\Tank_os\anm\DeepSeek Harness工作区\VRCLiveBoard(用户侧 Z:\DeepSeek Harness工作区\VRCLiveBoard)。

## 方案骨架(详见 PLAN)

数据源(TextSource: hardware / media / pages / clipboard / http / windowtext)
→ 合成器(优先级、模板变量 {cpu} {song} {time}、轮播、144 字符截断)
→ OSC 客户端(/chatbox/input → UDP 9000)
→ VRChat 聊天框

技术栈: Node.js + 纯 JS 依赖 + 本地网页控制台(第 4 期评估 Electron 外壳/托盘,走 npmmirror)。

## 桌面歌词 / 翻译软件接入路线(第二期起)

1. 首选 UIA: PowerShell helper 轮询目标窗口 UIA 文本树(本机已测 UIA 可用)。对用标准控件渲染的悬浮窗有效,零延迟零依赖。
2. 兜底 OCR: tesseract.js + chi_sim 对屏幕区域(悬浮窗位置)截图识别,~200-500ms/帧,离线可用。
3. 外部推送: 本地 HTTP API(POST /v1/chatbox),任何能跑脚本的软件都能接。
4. 插件目录: plugins/*.js 注册自定义 TextSource。

# VRChat 面部参数 OSC 调研(2026-10-30)

> 状态: **调研产物**(PROCESS-05 §7.1「功能调研状态」)—— 只读资料, 未改动程序本体; 本轮只新增本文件。
> 起因: 用户新消息「VRChat 已经把自带的面部参数映射到 OSC 上了」→ 核实该说法并形成可复核的草稿, 供 Lead 整合。
> 纪律: 全程只读(仓库文件 / VRChat 日志与 OSC 配置 JSON / OSCQuery HTTP GET / 网页抓取); **本轮未发送任何 OSC 或 UDP 报文、未触碰 19190、未改游戏配置、未构建**。
> 口径: 「官方原文」「社区二手」「本机实测」分开标注; 没查到的直接写「没查到」; E3/E4 不当定论(见 §0.2)。

## 0. 结论与证据等级

### 0.1 结论(可直接引用的版本)

1. **消息基本成立, 但方向必须说清** [E3官方 + E1]:
   VRChat 2026.4.1(正式版 2026-10-28, build 1936)的「Updated Face Tracking」把 **102 个 Unified Expressions 面部追踪键**接进了 OSC; 接入方式是 **一个输入端点** `/tracking/face/v1` —— 外部程序发一条 OSC blob(102 字节, 每个键 1 字节 0~255, 解码为 0.0~1.0)。方向是 **外部程序 → VRChat**, **不是** 102 个可以单独写的地址, 也**不是** VRChat 把这 102 个值逐个发给外部程序。
2. **VRChat → 外部方向只新增了 3 个只读布尔状态** [E3官方 + E1]:
   - `/avatar/parameters/UserEyeTracking` —— 内置 Animator 参数 `UserEyeTracking` 的「默认 OSC 输出映射」;
   - `/avatar/parameters/UserFaceTracking` —— 内置 Animator 参数 `UserFaceTracking` 的默认输出映射;
   - `/avatar/avatarfullfacetracking` —— 当前头像是否启用 Face Tracking + `Use All Tracking Keys`(不是 Animator 参数; 经 OSCQuery 暴露)。
   本机 316 份头像 OSC 配置里, 2026-10-28 之前生成的 **311 份都没有** `UserFaceTracking`/`UserEyeTracking`, 2026-10-29 之后生成的 **5 份都有** → 与 2026.4.1 的引入时点吻合(E1, 见 §2.6)。
3. **附带新增** `/avatar/name`(OSCQuery 只读, 头像名; 2026.4.1 发行说明; 本机实测可见)[E3官方 + E1]。
4. **前提条件(不能漏)**: 要真正「用 OSC 驱动脸」, 头像在上传时必须启用 Face Tracking 描述符 + `Use All Tracking Keys`; 制作侧 SDK 目前仍是 **Open Beta 3.10.6-beta.4(2026-10-23)**, 官方警告 beta 内容可能失效, 且新功能可能需要客户端 2026.4.1+ [E3官方]。→ 这是「**不再需要自定义同步参数 / 接收 prefab**」, **不是**「任意头像零改装」。
5. **旧的 `/tracking/eye/*` OSC 输入仍然在**(官方文档 2025-11-13 版; 本机 2026.4.1p1 的 OSCQuery 也在), 新面捕是另一套端点; 眼睛数据在新端点里以 UE 的 `EyeLook*`/`EyeClosed*` 等键出现 [E3官方 + E1]。
6. **没查到的东西(明确写出来)**: 没有查到任何官方文档/端点说明「VRChat 把 102 个面捕值逐个输出给外部程序」; 本机 OSCQuery 里也只有上述 3 个状态输出。**若用户的消息是这个意思, 该解读不成立**。
7. **本轮未实测**: 未发送过 `/tracking/face/v1` 报文(任务禁止发 OSC/UDP), 所以「发了之后头像真的动」这一环是 **E3 文档结论、未 E1 复现**; FT-enabled 头像上的 `avatarfullfacetracking=true` 分支也未观测(本机当前头像为 false)。全部列入 §4。

### 0.2 证据等级口径

- 任务口径: **E1 实测可复现 / E2 仓库或本机数据可查 / E3 官方文档 / E4 推断**。
- 仓库 `docs/PROCESS-04-工作规范.md §3` 的 E3 定义是「第三方文档或成熟实现」, 与本任务口径不完全一致 → 本文件按任务口径标注, 并额外区分:
  - **E3官方** = VRChat 官方发行说明 / 官方文档;
  - **E3′(二手)** = 新闻、博客、社区整理(只作旁证, 不当定论);
  - **E2** = 仓库现有资料或本机可复查数据; **E4** = 推断(已写证伪方法)。
- 建议 Lead 收口时统一 E3 口径(这是流程问题, 不是事实问题)。

### 0.3 一句话给 Lead

**VRChat 确实把原生面捕接到了 OSC, 但接法是「外部程序往一个 102 字节 blob 地址里写」; 往外发的只有 3 个布尔状态。要做表情驱动, 前提是头像用 beta SDK 开启 Face Tracking。**

## 1. 来源(URL + 摘录 + 读法)

抓取时间: 2026-10-30(北京时间)。官方 docs.vrchat.com 页面用「URL + `.md`」读 markdown(官方索引页明说可这样取: 「Append .md to any documentation page URL to get its markdown version」, 见 S9); 官方 Creation beta 文档站是 HTML, 用正文提取读。

### 1.1 官方原文(第一手)

- **S1 · VRChat 2026.4.1 发行说明(2026-10-28, Build 1936, Live)** — 官方。
  URL: https://docs.vrchat.com/docs/vrchat-202641 (读法: `.md` 版 /docs/vrchat-202641.md)
  摘录: 「### Updated Face Tracking! … The new Face Tracking system has its own OSC support as well! **We now network all 102 Unified Expressions values** without using your synced parameter budget. … You don't need a face tracker to try out the new Facetracking features, either. You can with just a webcam!」
  同页另有: 「Added a new OSC Endpoint, available through OSCQuery: `/avatar/name`, which gives tools the ability to react to specific avatars being loaded by their name set in the SDK.」
- **S2 · VRChat 2026.4.1 (OPEN BETA) 发行说明(2026-10-09 起 Build 1931, 后续 1932~1935)** — 官方。
  URL: https://docs.vrchat.com/docs/vrchat-202641-open-beta (读法: `.md` 版)
  摘录: 「OSC Note … this new endpoint is `/avatar/name`, available through OSCQuery …」;「Added a "Face Tracking" debug page.」(Build 1935, 2026-10-22);「Fixed an issue that could cause some avatars using face tracking to appear slightly sunk into the floor for remote viewers.」→ 说明面捕相关代码在 Open Beta 分支已存在(首个包含它的 build 未逐版核对)。
- **S3 · 官方 Creation 文档 · OSC Face Tracking(Last updated 2026-10-26)** — 官方(beta 文档站; 由 S1 正文直接链接过来)。
  URL: https://vrc-beta-docs.netlify.app/avatars/face-tracking/osc
  摘录(要点, 全文规则见 §2.2):
  「External applications can send face tracking data directly to VRChat's Face Tracking system using OSC. The input uses the Unified Expressions tracking keys established by VRCFaceTracking (VRCFT).」
  「Enable OSC in VRChat and use an avatar configured for Face Tracking with Use All Tracking Keys enabled.」
  「Address `/tracking/face/v1`; Arguments One OSC blob (type tag b; OSC type-tag string ,b); Blob payload size Exactly 102 bytes; Byte order One unsigned byte per tracking key, in the order below; Value range 0 to 255. VRChat decodes each byte as byte / 255.0 …」
  「UserEyeTracking and UserFaceTracking are built-in animator parameters. The addresses above are their default OSC output mappings. **Sending values to these parameters does not enable tracking.**」
  「VRChat exposes `/avatar/avatarfullfacetracking` through OSCQuery and sends its value after `/avatar/change`. Use it to check whether the newly loaded avatar supports native face tracking input through `/tracking/face/v1`.」
- **S4 · 官方 Creation 文档 · Face Tracking(Last updated 2026-10-26)** — 官方。
  URL: https://vrc-beta-docs.netlify.app/avatars/face-tracking
  摘录: 「supports the Unified Expressions standard from VRCFaceTracking (VRCFT) …」;「Use All Tracking Keys exposes the full set of Unified Expressions keys and identifies the avatar as supporting full face tracking」;「VRChat synchronizes the full set of Unified Expressions tracking data to remote viewers … Like NetIK … face tracking synchronization can be lossy」;「External tracking applications can send Unified Expressions data to `/tracking/face/v1`.」;「Selfie Expression drives Unified Expressions using a webcam …」
- **S5 · 官方 Creation 文档 · Animator Parameters(Last updated 2026-10-28)** — 官方。
  URL: https://vrc-beta-docs.netlify.app/avatars/animator-parameters
  摘录: 「All built-in parameters are read-only. You cannot change them with an Expressions Menu or OSC.」;「UserEyeTracking: Returns true when eye tracking data is available … UserFaceTracking: Returns true when face tracking is allowed and a face tracking source is active.」;「External applications can read them through OSC tracking status outputs.」;Viseme 为 `0-14` Int、Voice 为 `0.0-1.0` Float 的只读内置参数。
- **S6 · 官方 SDK 发行说明 3.10.6-beta.4(2026-10-23)** — 官方。
  URL: https://vrc-beta-docs.netlify.app/releases/release-3-10-6
  摘录: 「SDK Version 3.10.6-beta.4 brings support for native face tracking …」;「These features are currently in Open Beta! New features may require client version 2026.4.1 or higher. … Content uploaded using a beta SDK may break in future versions.」;「This SDK version still uses Unity 2022.3!」
- **S7 · 官方 docs.vrchat.com · OSC Eye Tracking(updatedAt 2025-11-13)** — 官方。
  URL: https://docs.vrchat.com/docs/osc-eye-tracking (`.md` 版)
  摘录: 「VRChat now offers support for receiving eye tracking data (eyelook and eyelid) via OSC.」;地址表 `/tracking/eye/EyesClosedAmount`、`CenterPitchYaw`、`CenterPitchYawDist`、`CenterVec`、`CenterVecFull`、`LeftRightPitchYaw`、`LeftRightVec`;「After 10 seconds without receiving data, eye tracking behavior will revert to default …」
- **S8 · 官方 docs.vrchat.com 其他** — 官方。
  OSC Overview: https://docs.vrchat.com/docs/osc-overview (端口 9000/9001;「stream data out of VRChat」)
  OSC Avatar Parameters: https://docs.vrchat.com/docs/osc-avatar-parameters (输出方向、按头像生成 OSC 配置 JSON)
  OSCQuery: https://docs.vrchat.com/docs/oscquery (2023.3.1 起实现 OSCQuery)
- **S9 · 官方文档索引 llms.txt** — 官方。
  URL: https://docs.vrchat.com/llms.txt (读法: 直接抓取; 用于确认「官方索引里有哪些 OSC 页面」以及 `.md` 读法)
- **S10 · OSCQuery 规范(Vidvox/OSCQueryProposal)** — 官方规范(第三方标准)。
  URL: https://github.com/Vidvox/OSCQueryProposal
  摘录: 「ACCESS … Returns 0 if there is no value … 1 if the value may only be retrieved, 2 if the value may only be set, or 3 if the value may be both retrieved and set.」← §2.4 的 ACCESS 读法依据。

### 1.2 社区二手(旁证, 不作定论)

- **S11 · MIXED News(2026-10-29)** — 二手(新闻)。
  URL: https://mixed-news.com/en/vrchat-live-face-tracking-qr-login-safety-center/
  摘录: 「VRChat's improved face tracking has moved into the live release … Version 2026.4.1 arrived on October 28.」「The face-tracking system can synchronise 102 Unified Expressions values without consuming an avatar's synced parameter budget. Creators need to configure support; a webcam can supply expressions through the selfie feature …」
- **S12 · VR.org(2026-10-24)** — 二手(媒体分析)。
  URL: https://vr.org/articles/vrchat-native-face-tracking-avatars-sdk-open-beta-unified-expressions-2026
  摘录: 「Face tracking used to be something you bolted on from outside … It is now a field in the descriptor …」;「VRCFaceTracking feeds the new system over OSC from its latest beta on Steam …」;「Unified Expressions is the naming standard that VRCFaceTracking … uses …」
- **S13 · なたで日記(2026-10-11, 日文)** — 二手(社区技术整理)。
  URL: https://blog.natade.net/2026/10/11/vrchat-osc-eye-tracking/ (读法: WordPress REST API 取正文)
  摘录: 区分 `/avatar/parameters/...`(改 Animator 参数)与 `/tracking/eye/...`(喂 VRChat 标准 Eye Look);「標準Eye Lookへ送られたOSCデータを、そのままBlend Treeの入力値として参照することはできない」(标准 Eye Look 收到的 OSC 数据不能直接当 Blend Tree 输入)。
- **S14 · VRNavi(2026-10-29, 日文)** — 二手(更新摘要)。
  URL: https://vrnavi.jp/vrchat-update-2026-4-1/
  摘录: 「対応する外部ソフトウェアでは、OSCを使った顔トラッキングの入力にも対応します。」;该文同时说明 Face Tracking 相关 SDK 仍为 Open Beta。

### 1.3 本机实测(E1;数据见 §2.6)

- **S15 · VRChat 运行日志** — 本机只读。路径: `C:\Users\10166\AppData\LocalLow\VRChat\VRChat\output_log_2026-10-30_12-11-00.txt`(最后写入 2026-10-30 12:22:22)
- **S16 · OSCQuery HTTP GET** — 本机只读。从日志找到「type OSCQuery on 61007」后 GET `http://127.0.0.1:61007/`(未发任何 UDP/OSC)
- **S17 · 头像 OSC 配置 JSON** — 本机只读。目录: `C:\Users\10166\AppData\LocalLow\VRChat\VRChat\OSC\usr_b839a8bb-905e-4a7e-b058-88e2d495a4c5\Avatars`

### 1.4 明确「没查到」的

- **截至 2026-10-30, docs.vrchat.com 没有 OSC Face Tracking 页面**: 官方索引 `llms.txt` 的 OSC 分组只有 OSC Eye Tracking(没有 Face);直取 `/docs/osc-face-tracking.md` 返回 **404**。**官方面捕文档目前只在 beta 文档站**(由正式版发行说明 S1 正文直接链接)。
- **creators.vrchat.com 目前没有 Face Tracking 页**: `/avatars/face-tracking` 与 `/avatars/face-tracking/osc` 均 **404**(beta 文档站上同名页面才是可读的)。
- 官方**没有**说明 `/tracking/face/v1` 的**发送频率、超时/断流回退**行为(对比: 旧的 Eye Tracking 文档明确写了 10 秒超时)。
- 官方**没有任何**「把 102 个面捕值输出给外部程序」的文档或端点描述。
- 官方**没有**承诺 102 键顺序/报文格式跨版本稳定。

## 2. 地址 / 类型 / 量程 / 方向 / 版本

### 2.1 端点总表

| 地址 | OSC 类型/参数 | 量程/格式 | 方向 | OSCQuery ACCESS | 版本/状态 | 证据 |
| --- | --- | --- | --- | ---: | --- | --- |
| `/tracking/face/v1` | blob(类型标签 `b`), 单参数 | **恰好 102 字节**; 每字节 0~255 → 0.0~1.0(byte/255.0) | **外部 → VRChat**(写) | 2 | **2026.4.1 新增** | E3官方(S3) + E1本机 |
| `/avatar/parameters/UserEyeTracking` | bool(类型标签 `T`/`F`, 无参数) | true/false | VRChat → 外部(只读) | 1 | 2026.4.1 新增(内置 Animator 参数的默认 OSC 输出映射) | E3官方(S3/S5) + E1本机 |
| `/avatar/parameters/UserFaceTracking` | bool(`T`/`F`) | true/false | VRChat → 外部(只读) | 1 | 2026.4.1 新增(同上) | E3官方(S3/S5) + E1本机 |
| `/avatar/avatarfullfacetracking` | bool(`T`/`F`) | true/false | VRChat → 外部(只读; 经 OSCQuery 暴露, `/avatar/change` 后发送值) | 1 | 2026.4.1 新增(不是 Animator 参数) | E3官方(S3) + E1本机 |
| `/avatar/name` | string(`s`) | 头像名(SDK 里设置的名字; UTF-8 经 OSCQuery) | VRChat → 外部(只读) | 1 | 2026.4.1 新增 | E3官方(S1/S2) + E1本机 |
| `/tracking/eye/EyesClosedAmount` | float(`f`) | 0~1(闭眼程度) | 外部 → VRChat(写) | 2 | 旧端点(文档 2025-11-13) | E3官方(S7) + E1本机 |
| `/tracking/eye/CenterPitchYaw` | float×2(`ff`) | 度(Pitch 正=下, Yaw 正=右) | 外部 → VRChat | 2 | 旧端点 | E3官方(S7) + E1本机 |
| `/tracking/eye/CenterPitchYawDist` | float×3(`fff`) | 度, 度, 米(注视角) | 外部 → VRChat | 2 | 旧端点 | E3官方(S7) |
| `/tracking/eye/CenterVec` | float×3(`fff`) | HMD 局部归一化方向向量 | 外部 → VRChat | 2 | 旧端点 | E3官方(S7) |
| `/tracking/eye/CenterVecFull` | float×3(`fff`) | HMD 局部方向向量(长度=注视角距离 m) | 外部 → VRChat | 2 | 旧端点 | E3官方(S7) |
| `/tracking/eye/LeftRightPitchYaw` | float×4(`ffff`) | 左P, 左Y, 右P, 右Y(度) | 外部 → VRChat | 2 | 旧端点 | E3官方(S7) |
| `/tracking/eye/LeftRightVec` | float×6(`ffffff`) | 左右眼 HMD 局部归一化方向向量 | 外部 → VRChat | 2 | 旧端点 | E3官方(S7) |
| `/avatar/parameters/Viseme` | int(`i`) | 0~14(Oculus 口型; 用 Jawbone/Jawflap 时 0~100 表音量) | VRChat → 外部(只读) | 1 | 旧内置参数 | E3官方(S5) + E1 + E2 |
| `/avatar/parameters/Voice` | float(`f`) | 0.0~1.0(麦克风音量) | VRChat → 外部(只读) | 1 | 旧内置参数 | E3官方(S5) + E1 + E2 |
| `/avatar/change` | string(`s`) | 头像 id | VRChat → 外部(ACCESS=3 读写标记, 实际用法是 VRChat 发出) | 3 | 旧端点 | E3官方(S8) + E1本机 |

相邻端点(用于对照方向, 不属于面捕):
| `/tracking/trackers/1..8` 与 `/tracking/trackers/head` 的 `position`/`rotation` | float×3/×3 | 世界坐标(米)/欧拉角(度) | 外部 → VRChat | 2 | 旧(OSC Trackers) | E3官方 + E1 |
| `/tracking/vrsystem/head/pose` 等 | float×6 | 位姿 | VRChat → 外部 | 1 | 旧 | E1(本机) + E2(F-20261006-01) |
| `/dolly/Play` | bool(`T`) | true/false | 读写 | 3 | 旧 | E2(F-20261006-01 §32) |

> 表头说明: 「OSCQuery ACCESS」= 1 只读(VRChat→外部) / 2 只写(外部→VRChat) / 3 读写(规范原文 S10; 本机对照见 §2.4)。

### 2.2 面捕输入 `/tracking/face/v1` 的报文规则(官方原文要点)

- **地址**: `/tracking/face/v1`, **大小写敏感**。
- **消息格式**: 一条消息带 **一个 OSC blob 参数**, 类型标签 `b`(OSC type-tag 字符串 `,b`)。
- **长度**: blob 数据**恰好 102 字节**(不含 OSC blob 长度字段与 4 字节对齐 padding); 每字节对应一个 tracking key, **顺序固定**(见附录 A)。
- **量程**: 每字节 0~255; VRChat 解码为 `byte / 255.0` → 0.0~1.0。
- **必须每条消息都发完整 102 字节**; 追踪源没有的键填 0, 但**位置必须保留**, 不能省略。
- 参数个数不对或 blob 长度不对的消息会被**直接忽略**(无回执/无报错)。
- 例: 把第 36 号字节设为 255、其余 0 → 得到 `JawOpen = 1`、其它键 0。
- `Voice` 与 `Viseme_*` 是 **VRChat 提供的输入, 不在这个 payload 里**。
- **前置条件**: VRChat 内 OSC 开启 + 头像配置 Face Tracking 且启用 `Use All Tracking Keys`(否则检查 `/avatar/avatarfullfacetracking` 为 false)。

### 2.3 VRChat → 外部的 3 个只读状态(新)

| 地址 | 含义(官方) | 本机实测值(2026-10-30 12:29) |
| --- | --- | --- |
| `/avatar/parameters/UserEyeTracking` | 本地用户是否有**眼睛追踪数据**; 只有自动眼动不算 | false(本机未开面捕/眼追) |
| `/avatar/parameters/UserFaceTracking` | 面捕是否被允许且**有面捕源在活动** | false(同上) |
| `/avatar/avatarfullfacetracking` | **当前头像**是否启用了 Face Tracking + `Use All Tracking Keys`(与该用户有没有面捕源无关) | false(当前头像未配置) |

- 前两个是 **内置 Animator 参数**的默认 OSC 输出映射; 官方明确: **往这些地址写值不会开启追踪**(它们是只读输出)。
- `/avatar/avatarfullfacetracking` **不是** Animator 参数, 是单独的 OSCQuery 端点; 官方: 「VRChat exposes … through OSCQuery and sends its value after `/avatar/change`」。
- 这 3 个地址的更新是否只走 OSCQuery、还是也走 UDP 9001, 官方文字没有完全写死(见 §4 待验证 #3)。

### 2.4 方向怎么读: OSCQuery ACCESS 语义 + 一处仓库既有记录需要更正

OSCQuery 规范(§1.1 S10): **1 = 只读(可被外部读取 → VRChat 发出)**, **2 = 只写(可被外部写入 → VRChat 接收)**, **3 = 读写**。本机对照(E1):

| 地址 | ACCESS | 已知方向 | 结论 |
| --- | ---: | --- | --- |
| `/chatbox/input`、`/input/Jump`、`/input/Vertical` | 2 | 外部→VRChat(仓库既有结论) | 2 = 输入 |
| `/tracking/face/v1`、`/tracking/eye/*`、`/tracking/trackers/*` | 2 | 官方文档: 外部→VRChat | 2 = 输入 |
| `/usercamera/Pose`、`/avatar/name`、`/tracking/vrsystem/head/pose`、`/avatar/parameters/Viseme`/`Voice`/`User*` | 1 | VRChat→外部(输出) | 1 = 输出 |
| `/dolly/Play` | 3 | 仓库已实测可读可写 | 3 = 读写 |

> ⚠️ **仓库既有记录的一处不同**: `docs/FEATURES/F-20261006-01-直播镜头联动.md §32.1`写到「`/tracking/trackers/...`、`/tracking/eye/*`、`/tracking/vrsystem/head/pose` 都是 ACCESS=2(= VRChat 往外发, 我们可接收)」。按 S10 规范 + 官方文档 + 本机对照, **ACCESS=2 是「外部写入 VRChat」**;其中 `/tracking/eye/*` 与 `/tracking/trackers/*` 是**输入**(2), `/tracking/vrsystem/*` 才是**输出**(1)。→ 建议 Lead 在整合时修正该处(本轮只读, 未改任何文件)。

### 2.5 版本与时间线

- **2026-10-05 前**(旧世界): 官方只有 `/tracking/eye/*` 眼睛输入(2025-11-13 文档)+ `/tracking/trackers/*` 身体追踪输入 + `/avatar/parameters/*` 自定义参数通道; 面捕主要靠社区 VRCFaceTracking 发自定义 avatar 参数。
- **2026-10-09**: 客户端 2026.4.1 **Open Beta**(Build 1931)开始; 面捕相关修复/调试页最晚在 **2026-10-22 Build 1935** 已出现(官方 Open Beta 发行说明 S2)。
- **2026-10-23**: SDK **3.10.6-beta.4** 官方发行说明: 「brings support for native face tracking」; 标注 Open Beta、新功能可能需客户端 2026.4.1+、beta 上传内容可能失效(S6)。
- **2026-10-26**: 官方 Creation beta 文档站 Face Tracking / OSC Face Tracking 页最后更新(S3/S4)。
- **2026-10-28**: 客户端 **2026.4.1 正式版(Live, Build 1936)**; 发行说明 S1 的「Updated Face Tracking」= 本调研的主题。
- **2026-10-29**: 2026.4.1p1(Build 1937)。
- **2026-10-30**: 本机核对: 客户端 **2026.4.1p1-1937-299983b13b-Release**, OSC enabled True, OSCQuery 端口 **61007**, `/tracking/face/v1` 在列(§2.6)。
- **截至 2026-10-30**: 正式 SDK 发布页最新仍是 **3.10.5(2026-09-04)**; 3.10.6 只在 beta 文档站 → 做 FT 头像目前需要 beta SDK。

### 2.6 本机实测证据(2026-10-30 12:2x, E1)

环境: Windows 用户 10166; VRChat 正在运行。

1. 日志 `C:\Users\10166\AppData\LocalLow\VRChat\VRChat\output_log_2026-10-30_12-11-00.txt`:
   - 「VRChat Build: **2026.4.1p1-1937-299983b13b-Release**」(第 82 行);
   - 「Advertising Service VRChat-Client-262625 of type **OSCQuery on 61007**」(第 60 行)、「… type OSC on 9000」(第 61 行);
   - 「OSC enabled: True」(第 112 行);
   - 「[DebugUI] Registered 12 debug UI pages … **FaceTracking** …」(第 59 行);
   - 更新通知文案: 「This release brings the Safety Center, **Updated Face Tracking**, and an improved login flow! …」(第 950 行)。
2. OSCQuery GET `http://127.0.0.1:61007/`(2026-10-30 12:29 抓取):
   - `/tracking/face/v1` → `TYPE=b ACCESS=2`;
   - `/avatar/parameters/UserEyeTracking` → `TYPE=T ACCESS=1 VALUE=[false]`;
   - `/avatar/parameters/UserFaceTracking` → `TYPE=T ACCESS=1 VALUE=[false]`;
   - `/avatar/avatarfullfacetracking` → `TYPE=T ACCESS=1 VALUE=[false]`;
   - `/avatar/name` → `TYPE=s ACCESS=1 VALUE=["Ly's Laevatain"]`; `/avatar/change` → 当前头像 id `avtr_9bfcab25-48ba-4f24-aa80-e6863e4e08d0`;
   - 旧 `/tracking/eye/*` 仍在(TYPE=ff/fff/ffff/ffffff, ACCESS=2)。
3. 头像 OSC 配置 JSON:
   - 最新一份 `avtr_9bfcab25-48ba-4f24-aa80-e6863e4e08d0.json`(mtime **2026-10-30 12:18:44**, 头像名 Ly's Laevatain): 共 **155** 个参数(Bool 76 / Int 31 / Float 48); 其中 **155** 个带 output、**125** 个带 input;
   - 该文件含内置只读输出 `UserFaceTracking`、`UserEyeTracking`(Bool, 仅 output, 无 input); 也含 `Viseme`、`Voice`、`TrackingType` 等旧只读内置;
   - 同一目录下 Mamehinata 的头像配置(2026-10-29 15:16 生成)共 **120** 个参数, 同样含这两个新输出;
   - **全量扫描**该目录 **316** 份头像 JSON: **2026-10-28 前生成的 311 份 0 份含** `UserFaceTracking`/`UserEyeTracking`; **2026-10-29 后生成的 5 份 5 份都含**;
   - 用官方 102 个 UE 键名在新配置里做**同名参数检查: 0 个命中** → 面捕确实**不是**走 `/avatar/parameters/<键名>`, 而是独立 blob 端点。
4. 当前头像 `avatarfullfacetracking=false` → 本机**没有** FT-enabled 头像, 因此 true 分支与真实驱动效果未验证(§4)。

## 3. 与仓库现有资料的关系

1. **F-20261022-01(头像反向 OSC 联动实测)**
   - 该卡结论「`/avatar/parameters/<Bool>` 用 int 0/1 写入 FAIL」与本次新面捕通道**无关**: 新通道不经过自定义 avatar 参数, 不解决也不否定那个 Bool 编码问题;
   - 该卡记录的 Mamehinata 「92 个参数」是 2026-10-22 时点的数据; 本机同头像配置在 **2026-10-29 15:16** 重新生成后为 **120 个参数**, 并含两个新内置输出。差额原因**未验证**(期间用户可能在隔壁改模工作区重传过头像, 不能全归因于 2026.4.1), 但「两个新内置参数只出现在 10-28 之后生成的配置里」与更新时点吻合(311/5 对齐, §2.6);
   - 该卡「只读内置: GestureLeft/Right、Viseme、Voice、Velocity*、ScaleFactor 等」可**追加** `UserEyeTracking`/`UserFaceTracking`(2026.4.1 起)。
2. **F-20260928-01(动作输出 / 反向 OSC)**
   - 「切片 2 表情/头像参数」现在多了一条**官方原生路线**: 发 `/tracking/face/v1`(102B blob) → VRChat 自己的 Face Tracking 系统驱动头像; 不需要自定义同步参数/prefab;
   - 但前提头像启用 Face Tracking(需 beta SDK 上传), 因此它**不能**直接替代「任意头像零改装」; 原有 `/avatar/parameters/VRCEmote`(已实测 PASS)与自定义参数路线仍保留;
   - 动作输出层已有的「限速 / 自动复位 / 断流兜底」原则**应延伸**到面捕流: 停止时应发全 0 的 102B 包(是否有超时未知, §4 #4), 并对 30~60Hz 级发送做上限与单测。
3. **F-20260929-01(外挂式跳舞驱动)**
   - 身体动作仍走 VMT(不受影响); **面部**现在可以交给 VRChat 原生面捕同步(本地+远端, 不占同步参数预算);
   - 用户 2026-10-22 拍板的「改装程序/接收 prefab」路线里, **face 部分可以被原生 Face Tracking 取代**; body 部分仍需 VMT/接收端; 是否调整该方向需用户/Lead 决策(本轮只记录)。
4. **DEV-NOTES 246/248/260/364(触发器/反向通道)**
   - 246/260 已确立「仅监听 9001 + 读内置只读参数」的触发器能力; 新增两个只读 bool 输出可作为**新触发条件**(例如「面捕可用/头像支持面捕」时启用某插件/提示);
   - 364 记录的 92 参数表/证据路径/改装程序方向, 被本文件补充(见上)。
5. **F-20260925-02 §8.2/§9.2(内置回传参数清单)**
   - 该处「VRChat 会回传的内置参数」清单需追加 `UserEyeTracking`/`UserFaceTracking`(2026.4.1 起); `/avatar/name` 也可作为「头像识别」输入。
6. **F-20261006-01 §32.1(相机调研里的 /tracking 记录)**
   - 其对 ACCESS=2 的方向解读与规范/官方文档/本机实测**相反**(见 §2.4), 建议修正; 其余相机结论不受影响。
7. **文档整体**: 本文件是**调研草稿**, 不是功能卡; 若 Lead 决定推进, 应按 PROCESS-02 重新走 D0(七问/不做什么), 并更新 DEV-NOTES 条目(由 Lead 收口, 本轮不改其它文件)。

## 4. 不确定项 / 待验证

| # | 待验证项 | 现状(为什么没验证) | 建议验证方法(含约束) |
| ---: | --- | --- | --- |
| 1 | `/tracking/face/v1` 是否真的能驱动头像(Face Tracking 端到端) | 任务禁止发 OSC/UDP, 本轮只读 | 用户授权 + 隔离环境(仅本机 9000)发合成 blob, 在 FT-enabled 头像上目视/面捕调试页确认; 发完发全 0 收尾 |
| 2 | `avatarfullfacetracking=true` 分支 | 本机当前头像未启用 FT | 找一个 FT-enabled 头像(需 beta SDK 上传)后重读 OSCQuery / 听 9001 |
| 3 | `avatarfullfacetracking` 是否也走 UDP 9001(还是只在 OSCQuery) | 文档只写「通过 OSCQuery 暴露 + `/avatar/change` 后发送其值」 | 只读监听 9001(不发送)抓包; 或换头像触发 `/avatar/change` 观察 |
| 4 | `/tracking/face/v1` 的超时/断流回退行为 | 官方文档未写(旧 Eye Tracking 明确 10s 超时) | 发一帧后停发, 观察头像是否保持/回默认; 需用户授权 |
| 5 | 发送频率/带宽建议(30/60Hz? 每帧 102B) | 官方未写 | 小流量实测 + VRChat CPU/网络观测; 先保守 30Hz |
| 6 | 102 键顺序/报文格式的跨版本稳定性 | 官方未承诺; 文档在 beta 站 | 跟随发行说明/文档复核; 实现侧做版本闸(读 `avatarfullfacetracking`/客户端版本) |
| 7 | 常用 OSC 库对 blob 的编码细节(类型标签 `b`、长度、4 字节对齐) | 未写 codec; 仓库 `src/osc.js` 现有能力未核对 | 写最小 encoder + 单测(与官方 102B/对齐规则对照), 建议保存 golden payload |
| 8 | `/tracking/eye/*` 与 `/tracking/face/v1` 同时发送时的合并/优先级 | 未验证 | 两组同时发, 观察眼睛行为; 或查官方后续文档 |
| 9 | 面捕输入值是否会被 VRChat 以某种形式「回传」(除 3 个 bool 外) | 官方只列 3 个输出; 本机 OSCQuery 也只有这些 | 监听 9001 看是否有未文档化输出(只读, 需授权) |
| 10 | 「VRChat 把面捕值输出给外部」这一解读 | **无任何官方文档/端点/本机节点支持**; 若用户消息是这个意思则不成立 | 向用户确认消息出处(公告/群/视频), 对齐表述 |
| 11 | Mamehinata 配置 92 → 120 参数的差额原因 | 期间用户可能重传过头像, 无法区分 | 查隔壁改模工作区的上传记录/头像版本; 或对比新旧 OSC 配置(旧文件已被覆盖) |
| 12 | 正式 SDK 何时支持 Face Tracking(3.10.6 转正) | 截至 2026-10-30 正式 SDK 最新 3.10.5 | 关注官方 SDK 发行说明; 之前 FT 头像需 beta SDK |
| 13 | `/avatar/name` 的 UTF-8 在 UDP OSC 上是否可用 | 官方 Open Beta 说明: OSCQuery 已修 UTF-8, 普通 OSC(UDP) 仍在探索 | 只作为 OSCQuery 字段用; 不依赖 UDP 字符串 |
| 14 | `Use All Tracking Keys` 关闭时, 向 face v1 发包是否被完全忽略 | 未发包验证 | 用未启用的头像发中性包, 观察是否影响表情(需授权) |

## 5. 对 VRCLiveBoard 的用途 / 风险

### 5.1 可行用途(按风险从低到高)

- **A. 状态感知(低风险, 建议先做)**: 读取 3 个只读 bool + `/avatar/name`, 在控制台/插件显示「本机面捕源是否活动」「当前头像是否支持原生面捕」「当前头像名」; 用于**功能可用性判断/降级**, 避免用户误以为「发了没效果」。前两个 bool 是内置参数的 OSC 输出映射(走 9001 的可能性大), `avatarfullfacetracking` 走 OSCQuery —— 具体到达方式待验证(#3), 但**都是只读**, 不改变 VRChat 状态。
- **B. 表情驱动(中风险, 本消息的核心价值)**: 把「预设表情 / 情绪 / 眨眼 / 口型」打包成 102B blob, 以 30~60Hz 发 `/tracking/face/v1`; 由 VRChat 自己的 Face Tracking 系统驱动头像, **不需要自定义同步参数, 也不占同步预算**; 场景: 一键表情、直播事件触发表情、与触发器层联动。**前提是用户头像已启用 Face Tracking(beta SDK 上传)**。
- **C. 与触发器层联动(中风险, 依赖 B)**: 手势/语音触发 → 面捕表情; 与现有 `src/triggers.js` 读到的信号组合; 复用「限速/自动复位/断流归零」原则。
- **D. 为「外挂式跳舞驱动」补表情通道(低优先, 依赖 B)**: 身体 VMT 不变; 面部用原生面捕同步(本地 + 远端由 VRChat 负责, 远端为有损同步); 注意同一头像的 FT 与手势/动画层可能互相覆盖(取决于 blendshape 映射与权重, 未验证)。
- **E. 直播互动: 观众触发表情(高风险, 默认不做)**: 与 F-20260928-01「读法 C」同风险(远程操控/观感/ToS/授权), 必须「用户明确授权 + 一键切断 + 限速 + 只对授权对象开放」; 官方支持面捕**不等于**降低这类风险。

### 5.2 风险与红线(不美化)

1. **版本与 SDK 耦合**: `/tracking/face/v1` 要 2026.4.1+; 做 FT 头像要 beta SDK(3.10.6-beta.x, 可能变/可能失效); 2026.4.1 不兼容旧客户端; 用户和观众版本可能不一致。
2. **头像必须先改装(至少一次)**: 要在 Avatar Descriptor 启用 Face Tracking + `Use All Tracking Keys` + 映射 blendshape; 与「零改装」宣传要划清界限。不同头像映射不同, 同一 blob 在不同头像上效果不同 → 需要「每头像配置/映射说明」。
3. **协议严格、无回执**: 102 字节长度/顺序错一字节就被**静默忽略**; 没有 ACK。实现必须有: golden payload 单测、长度/序号断言、发送前版本闸、失败不静默(如实告诉用户「已发送, 未确认」); 验证手段只能靠 `avatarfullfacetracking` + 用户目视/调试页。
4. **精度与远端观感**: 本地每键 8-bit(1/255)量化; 远端同步是**有损**的(官方明说, 类似 NetIK, 距离影响保真度) → 不能承诺「和面捕一样精细」; 这与 F-20260929-01 §1.3 的「远端 8bit」注意事项同类。
5. **频率/带宽/性能**: 官方未给频率/超时; 若 30~60Hz 持续发, 需评估 VRChat 处理与 UDP 负载; 与聊天框共用 9000 端口(不同地址), 但**必须限频并避免与现有 chatbox 突发叠加**; 停止时建议发一帧全 0(是否必须未知, #4)。
6. **合规**: OSC 面捕是**官方支持功能**, 只驱动本机, 不碰他人; 但「自动/合成表情」仍受 VRChat 一般条款约束; 不做自动化刷屏、不伪装他人、不用于绕过验证; 直播互动场景需单独授权设计。
7. **隐私/生物特征**: 本方案只发送**合成值**, 不采集/不上传用户面部数据; 若将来接摄像头或读取真实面捕数据(目前没有官方输出通道, 见 §1.4), 必须本地处理、明示、不落盘、不上传。
8. **文档/接口成熟度**: 官方面捕文档只在 beta 站, 客户端正式版发行说明也提示 SDK 仍 beta; 102 键顺序/报文格式可能变 → 本文件所有版本/格式结论都绑定了 2026-10-30 的抓取时间, 后续必须复核。
9. **不要把它当「通用头像表情接口」**: 未开启 FT 的头像(`avatarfullfacetracking=false`)发送大概率无效(未验证, #14); UI 上应先探测再提示。

### 5.3 建议的下一步(供 Lead 决策, 不自行开工)

1. **先做 A(状态感知)的可行性核对**: 只读, 风险低; 确认两个 bool 是走 9001 还是只走 OSCQuery(#3), 再决定是否进功能卡。
2. **B 的立项前提**: 用户已有/愿意用 beta SDK 重传头像; 否则只能作为「未来能力记录」, 不做承诺。
3. **若要实测 B**: 按 PROCESS-04 §7 隔离纪律, 在用户明确同意后由用户本机小流量验证(本轮禁止发 OSC, 不能代做)。
4. **文档收口**: 待 Lead 确认后, 再把本文件的事实并入 DEV-NOTES 条目 / 功能卡(本轮不动其它文件)。

## 附录 A: 102 个 Unified Expressions tracking key(官方顺序, 零基)

来源: 官方 Creation beta 文档站 OSC Face Tracking(S3, Last updated 2026-10-26); 键名同时用于 Face Tracking 的 Blendshapes Sets / Parameter Behaviors。**`Voice` 与 `Viseme_*` 不在这个 payload 里**。

| # | Tracking key | # | Tracking key |
| ---: | --- | ---: | --- |
| 0 | EyeLookOutRight | 51 | LipFunnelUpperLeft |
| 1 | EyeLookInRight | 52 | LipFunnelLowerRight |
| 2 | EyeLookUpRight | 53 | LipFunnelLowerLeft |
| 3 | EyeLookDownRight | 54 | LipPuckerUpperRight |
| 4 | EyeLookOutLeft | 55 | LipPuckerUpperLeft |
| 5 | EyeLookInLeft | 56 | LipPuckerLowerRight |
| 6 | EyeLookUpLeft | 57 | LipPuckerLowerLeft |
| 7 | EyeLookDownLeft | 58 | MouthUpperUpRight |
| 8 | EyeClosedRight | 59 | MouthUpperUpLeft |
| 9 | EyeClosedLeft | 60 | MouthUpperDeepenRight |
| 10 | EyeDilationRight | 61 | MouthUpperDeepenLeft |
| 11 | EyeDilationLeft | 62 | NoseSneerRight |
| 12 | EyeConstrictRight | 63 | NoseSneerLeft |
| 13 | EyeConstrictLeft | 64 | MouthLowerDownRight |
| 14 | EyeSquintRight | 65 | MouthLowerDownLeft |
| 15 | EyeSquintLeft | 66 | MouthUpperRight |
| 16 | EyeWideRight | 67 | MouthUpperLeft |
| 17 | EyeWideLeft | 68 | MouthLowerRight |
| 18 | BrowPinchRight | 69 | MouthLowerLeft |
| 19 | BrowPinchLeft | 70 | MouthCornerPullRight |
| 20 | BrowLowererRight | 71 | MouthCornerPullLeft |
| 21 | BrowLowererLeft | 72 | MouthCornerSlantRight |
| 22 | BrowInnerUpRight | 73 | MouthCornerSlantLeft |
| 23 | BrowInnerUpLeft | 74 | MouthFrownRight |
| 24 | BrowOuterUpRight | 75 | MouthFrownLeft |
| 25 | BrowOuterUpLeft | 76 | MouthStretchRight |
| 26 | NasalDilationRight | 77 | MouthStretchLeft |
| 27 | NasalDilationLeft | 78 | MouthDimpleRight |
| 28 | NasalConstrictRight | 79 | MouthDimpleLeft |
| 29 | NasalConstrictLeft | 80 | MouthRaiserUpper |
| 30 | CheekSquintRight | 81 | MouthRaiserLower |
| 31 | CheekSquintLeft | 82 | MouthPressRight |
| 32 | CheekPuffRight | 83 | MouthPressLeft |
| 33 | CheekPuffLeft | 84 | MouthTightenerRight |
| 34 | CheekSuckRight | 85 | MouthTightenerLeft |
| 35 | CheekSuckLeft | 86 | TongueOut |
| 36 | JawOpen | 87 | TongueUp |
| 37 | JawRight | 88 | TongueDown |
| 38 | JawLeft | 89 | TongueRight |
| 39 | JawForward | 90 | TongueLeft |
| 40 | JawBackward | 91 | TongueRoll |
| 41 | JawClench | 92 | TongueBendDown |
| 42 | JawMandibleRaise | 93 | TongueCurlUp |
| 43 | MouthClosed | 94 | TongueSquish |
| 44 | LipSuckUpperRight | 95 | TongueFlat |
| 45 | LipSuckUpperLeft | 96 | TongueTwistRight |
| 46 | LipSuckLowerRight | 97 | TongueTwistLeft |
| 47 | LipSuckLowerLeft | 98 | SoftPalateClose |
| 48 | LipSuckCornerRight | 99 | ThroatSwallow |
| 49 | LipSuckCornerLeft | 100 | NeckFlexRight |
| 50 | LipFunnelUpperRight | 101 | NeckFlexLeft |

## 附录 B: 复现线索(只读)与本轮边界

- **OSCQuery 端口**: 从当日 `output_log_*.txt` 里搜「of type OSCQuery on <端口>」; 然后 GET `http://127.0.0.1:<端口>/`; 节点上的 `ACCESS` 按规范读方向(1 读 / 2 写 / 3 读写)。
- **头像 OSC 配置**: `%USERPROFILE%\AppData\LocalLow\VRChat\VRChat\OSC\{userId}\Avatars\{avatarId}.json`; 每个参数的 `input`/`output` 的 `address` 与 `type` 即 VRChat 的输入/输出映射(官方 OSC Avatar Parameters 文档 S8)。
- **日志关键行**: 「VRChat Build:」「OSC enabled:」「Advertising Service … type OSCQuery on …」。
- **本轮可复现数据**: 见 §2.6(时间 2026-10-30 12:2x, 客户端 2026.4.1p1-1937-299983b13b-Release); 注意 OSCQuery 端口每次启动随机, 以日志为准。
- **本轮边界**: 未发送任何 OSC/UDP; 未监听 9001; 未改游戏配置; 未构建; 未碰 19190; 未改其它文件。
- **本次产物**: 仅新增本文件 `\\Tank_os\anm\DeepSeek Harness工作区\VRCLiveBoard\docs\RESEARCH-FACE-OSC.md`。

---

> 复核建议: 本文所有「2026.4.1 新增」判断都基于 2026-10-30 的官方文档 + 本机 2026.4.1p1 证据; 若后续版本更新, 请按 §1 的 URL 重新核对后再引用。

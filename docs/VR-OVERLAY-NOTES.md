# VR 覆盖层(Overlay)路线调研笔记

> 建立: 2026-10-05。**为 1.5「月光」预留** —— 如果这条路走得通, 会是一个很大的更新。
> 性质: **纯思路调研**。样本是本地的一个第三方程序(只有编译产物, **没有源码, 许可证未知**), 本文**不含它的任何代码**, 只记做法与结论。

## 0. 一句话背景

我们此前做过一条 VR 原生覆盖层键盘的线(`scripts/vrkeyboard`), **因平台限制暂停**了;本地样本 `VRPhoneScreenOverlay` 把"手机屏幕投成 VR 覆盖层并可在 VR 里操作"这件事**做成了**, 值得把思路记下来。

## 1. 样本:VRPhoneScreenOverlay v0.2.6-beta.6

### 1.1 它是什么(从程序集与依赖推断)
```
形态   .NET 10(win-x64)桌面程序, 自包含打包
图形   OpenVR + Vortice.Direct3D11 / DXGI        -> SteamVR 覆盖层 + D3D11 纹理
音频   NAudio 3.0(Wasapi/Asio/Midi) + Concentus -> Opus 编解码
手机侧 MediaCodec 硬编 H.264 -> WebSocket 传输 -> PC 解码
自有程序集 19 个: Android / Media / Input / Network / Protocols / PhotoSync /
                   Settings / Diagnostics / Presentation / SteamVR / Core / Contracts
附带   SteamVR.BindingTool.exe(生成/安装绑定) + Maintenance.exe(维护/更新)
```
**结论**: 是**真机投屏**(手机硬编 -> PC 解码 -> 覆盖层), **不是安卓模拟器**(无任何模拟器组件)。

### 1.2 安全体检结论(2026-10-05, 只读扫描, 从未执行)
- 做法: 对**它自己的 19 个程序集**做 UTF-16 字符串提取(.NET 字符串常量在 `#US` 堆, 纯 ASCII 扫不到), 过滤 URL/域名/IP/敏感 API;
- **它自己的代码只连一个域名**:
  - `hoshinochika.cloud/vrphonescreen/api/v1/diagnostics/init`(启动时诊断上报)
  - `hoshinochika.cloud/vrphonescreen/api/v1/updates/manifest`(查更新)
- **未发现**: 挖矿 / 键盘记录 / 剪贴板窃取 / 计划任务与自启 / 从 pastebin·telegram·短链 拉取内容(扫到的 Registry、Startup 命中**全部来自它自带的 .NET 运行时字符串**, 非其行为);
- 剪贴板同步是**可选且默认关**(`clipboard_autosync=false`);
- ⚠️ **它没有代码签名**: 19 个自有程序集全部 `NotSigned`(第一次扫到的 "Valid / CN=.NET" 是它打包进去的 .NET 运行时, 那是微软签的);
- ⚠️ **它会联网**(诊断 + 更新, 个人域名);但核心投屏是**本地**的, 防火墙拦掉不影响使用;
- 版本 0.2.6-beta, **未成熟**。

### 1.3 最值得学的一段:它的"输入配方"
```
app/manifest.vrmanifest       -> 注册为 SteamVR 应用
app/action_manifest.json      -> 动作定义 + 7 种手柄的默认绑定
app/bindings/*.json           -> vive / wmr / knuckles / oculus_touch / hp_wmr / pico / pico_ice
SteamVR.BindingTool.exe       -> 还提供一个绑定工具(改键用)
```
动作设计(可直接借鉴的命名与粒度):
```
左右手拖拽空间: LeftHandSpaceDrag / RightHandSpaceDrag
重置位置:       ResetOffsets
设备功能键:     PhoneBack / PhoneHome / PhoneRecents / PhoneControlPanel / PhoneScreenshot
```
关键技术点(从它的自有程序集里看到的 API 名):
- `EnsureActionManifestSubmitted` / `ActionManifestPath` / `_OpenBindingUI` / `VREvent_Input_BindingSubscriptionChanged` -> **应用自己提交 action manifest** 并监听绑定变化;
- `_SetOverlayInputMethod` / `_SetOverlayMouseScale` / `_SetOverlayCursorPositionOverride` -> 用**覆盖层自身的鼠标通道**做点击(把"点屏幕"映射成 overlay 上的坐标);
- `_SetOverlayTextureColorSpace` / `_SetOverlayRenderingPid` / D3D11 纹理路径 -> 帧数据以 D3D11 纹理喂给覆盖层;
- `VROverlayTransform_DashboardTab` / `DashboardThumb` -> 挂在 **SteamVR 仪表盘**上(官方位置, 玩家随时能开)。

## 2. 我们自己的前车之鉴(`scripts/vrkeyboard`, 已暂停)

| 当初的卡点 | 现在的判断 |
| --- | --- |
| 覆盖层应用拿不到手柄输入(`NoActiveActionSet`) | **样本证明可行** —— 关键是**自己提交 action manifest + 提供绑定**;我们当时没有这一步 |
| 纹理直推导致高亮闪烁 / Bitmap 泄漏越用越卡 | 样本走 D3D11 纹理 + 颜色空间设置;重建时应当用**常驻缓冲 + 帧节流** |
| 仪表盘不接纳覆盖层 / 输入焦点问题 | 样本用 `VROverlayTransform_DashboardTab` 挂**仪表盘标签页**;输入走 overlay 鼠标通道而非抢占焦点 |

## 3. 若要重启:先做最小验证(建议顺序)
```
1. 只做"注册 + 提交 manifest + 读一个动作"—— 证明能拿到手柄输入(这是当初的死结)
2. 再做"一张静态纹理挂上去, 不闪烁"—— 证明渲染路径干净
3. 再做"鼠标通道点一下有反应"—— 证明交互闭环
4. 最后才谈"挂仪表盘"与"投什么内容"
```
每一步都要有可执行的断言(照本项目一贯做法), 不要一次性把三件事叠起来做。

## 4. 如果走通, 1.5 可以是什么样(设想, 未定)
- **公告板进视野**: 把轮巡的 LED 字幕做成一个**不遮视野**的小覆盖层 —— 这是本项目"在场感优先"原则最自然的延伸;
- **控制台轻量面板**: 只放最常用的几个按钮(发送/快捷回复), 而不是把整个网页投进来;
- **照片回传**: VRChat 的照片目录取回 PC(**不需要覆盖层**, 现在就能做, 甚至可以做成官方插件);
- ✗ **不做手机投屏本身**: 样本在做, 而且很重(overlay + 视频 + 输入三件事叠加);我们做 **OSC 数据面**, 各管一段。

## 5. 纪律与边界
1. **不抄代码**: 样本只有编译产物、许可证未知 -> 只借鉴做法, 不反编译复制;
2. **不遮视野**: 任何覆盖层功能都要过"在场感优先"这条原则(不遮视野、不刷屏、不打扰同场玩家);
3. **先验证再承诺**: 第 3 节的最小验证过了, 再谈 1.5 的功能;
4. **本笔记不含任何第三方代码**, 也不含本项目的彩蛋相关内容(仓库是公开的)。

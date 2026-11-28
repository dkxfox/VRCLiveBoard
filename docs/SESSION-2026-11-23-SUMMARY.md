# SESSION 2026-11-23 进度总结

> 用途: 下次接手时先看本文件, 再读 `docs/DEV-NOTES.md` §1 与条目 349–395。
> 当前版本: **1.4.8「补漏」EA**; 功能卡/环境准备最后提交: **b14f14e**; 工作区干净。

## 0. 最新状态保存(2026-11-25 收口)

- 虚拟混音台插件 **v0.5.0** / 引擎 **v0.5.0**; 基础功能测试通过。
- A/B 卡片可用: A 通道条 + B 机械 VU; 设备/增益/闪避参数/start-stop/系统采集“不使用”; meter 实时。
- 已修复: A/B VU 轮询、VU 数字卡历史最大值、状态 I/O 阻塞音频线程、CABLE 自反馈、采集缓冲积压。
- 当前延迟约 **1s**, 用户暂接受; VU 刷新仍约 500ms 级。
- 正式版目标: 输出端到端 **<100ms**, VU 接近实时; 麦克风低电平门限/静默省 CPU; 先做低延迟音频原型 + `--latency-test`, 再做 60Hz 遥测/UI 30fps, 再做麦克风门限/降噪旁路。
- 最新验证: test:mixer 21 PASS; test:mixer:cable 3 PASS; test:mixer:latency 2 PASS; gates 16 PASS / 0 FAIL。
- 2026-11-28: latency-test CABLE 往返约 112–126ms; 1ms 探针无改善; VU 已到 30fps(状态/前端 33ms); 同步 cue 引擎/API/卡片 UI+进度已完成(0ms onset); camera-path 联动已接; Cue 增加 FLAC + 峰值电平表; M2.1 后端已迁主程序(引擎/manager/11 路由); 主 Tab 走主 API; Cue 播放变慢/卡顿已修(缓冲反馈供样, 实测 1.0x); 下一步 cue同回调/运行中音量、camera内部化、插件退役。
## 0. 最新状态保存(2026-11-24)

- 虚拟混音台插件: **v0.4.1**(experimental), 引擎 **0.4.0**; `setup()` 已检测到 VB-CABLE, 返回 `installed=true`。
- **VB-CABLE 已安装**: 官方 Driver Pack 46 / 安装器 2.1.5.8, 签名验证通过, UAC 安装完成; `CABLE Input` / `CABLE Output` 已出现。
- 安装器曾把 Windows 默认播放/录音改为 CABLE; 已恢复为安装前的物理设备, 避免系统声音被吞。
- **待重启 Windows**: 官方要求重启后驱动最终生效; 尚未自动重启。
- 最新验证: `npm run test:mixer` 18 PASS; `test:mixer:capture` 6 PASS; `test:mixer:cable` 3 PASS; `gates` 16 PASS / 0 FAIL。
- 2026-11-25 VRChat 实机链路已通: 耳机麦 Front Mic + 磁带 USB CODEC -> CABLE Input, VRChat 麦克风 CABLE Output; 用户确认麦+4dB/音乐0.72/attack45-release600-hold650；S3 实时 start/stop + 手动参数 + A/B 卡片 UI 已接；状态 I/O 移出音频线程修卡顿；cue/运镜待做。
- 下一步: 重启 → 复查 CABLE Input/Output → `--output-test` 指 CABLE Input + 采集 CABLE Output → VRChat 麦克风选 CABLE Output → 真人讲话+音乐闪避实测。
## 1. 本轮完成

### 1.1 文档与开发记录归档
- `docs/DEV-NOTES.md` 只保留 §1–§5 + 条目 349–395; 更早条目 **110–348** 与原 §1 历史移入 `docs/DEV-NOTES-ARCHIVE.md`(只归档不删除)。
- 过时文档移入 `docs/ARCHIVE/`(1.4.6 发布说明/复盘、2026-10-22 会话摘要、无引用 mockup); 删除 `docs/Thumbs.db`。
- 新增保留策略: 从下个版本起主文件只保留最近两个发布版本的开发记录; 水位线/归档工具见 `PROCESS-01 §10.1` 与 `scripts/checks/dev-notes-archive.js`。

### 1.2 问题收尾
- **M-20260901-04** 插件 vendor 体积问题已复核并关闭: 1.4.8 Lite 8.99MB(vs 15.74/20.2MB); 共享 vendor 与备份去 vendor 因破坏自包含恢复不做。
- **M-20260903-06** OSC 全红排查资料已落地: `docs/SUPPORT/M-20260903-06-OSC排查资料.md`; 问题仍为 NEED-REPRO, 等反馈者补充。

### 1.3 虚拟混音台(下一步开发)
- 功能卡: `docs/FEATURES/F-20261123-01-虚拟混音台.md` (**BUILD**: 方案/视觉确认, S1 完成; S2a 闪避核心完成)。
- **2026-11-24 S1 已完成**: `plugins/virtual-mixer` v0.2.0 experimental + C#/NAudio 引擎；`--list-devices` / `--selftest` / `--duck-selftest`；测试 **17 PASS**，全量门禁 **16 PASS / 0 FAIL**；侧链闪避核心已离线验证；真实采集到 WAV 已通过 smoke（6 PASS）；`WasapiOut` 输出代码已静音 smoke，VB-CABLE 已安装且 CABLE 回路 3 PASS；默认音频为物理设备；待 VRChat 麦克风端到端；UI 未接。
- 已确认:
  - 引导安装第三方 VB-CABLE; 用户态插件不创建/打包驱动。
  - 一根虚拟跳线即可; 三条(可扩到 8)内部混音通道, 每路可选“送跳线/仅监听”, 汇到一路虚拟麦克风。
  - 两套布局都做: **A 通道条 + B-VU 机械表**, 页面右上角切换并记忆; 默认暂定 B-VU。
  - 机械 VU: 四通道各一只, 主输出单只; 刻度铺满, 指针旋转中心在可见表盘下方; 保留数字 dB/峰值 LED; Cue 有进度/倒计时/每行清除/清空 Cue。
  - 技术: C#/.NET Framework + NAudio 音频引擎; 复用 `/api/plugins/call` + JSON 方法/cue; 计划加 `ctx.plugins.call` 小桥供运镜联动。
  - 性能: VU 30fps、只改指针 transform、页面隐藏暂停; CPU 增量目标 <1%, 超过自动降级数字表。

### 1.4 测试环境
- 已用官方安装程序卸载 **Voicemeeter**: 注册表项与音频端点已消失(复查 count=0)。
- DriverStore 仍留 `oem70.inf`; 官方要求**重启 Windows** 后才彻底移除。
- 本机仍有 Virtual Desktop Audio、网易虚拟音频设备、Steam Streaming 等其它虚拟设备; 不是 VB-CABLE/Voicemeeter, 可保留。

## 2. 下次开始(重启后)
1. 复查 `Voicemeeter` 音频端点不存在; Windows 默认播放/录音切回物理设备, 声音正常。
2. **S2a**: 系统回环 + 麦克风采集 + 48k 混音 + 电台讲话闪避(核心)；S2b mic 压缩/预设；S3 A/B-VU 页面；S4 cue/运镜联动/打包。
3. S2 接系统回环/麦克风采集; S3 接虚拟声卡检测/向导 + A/B-VU 页面; S4 接 cue/运镜联动/打包/安全审计。

## 3. 关键入口
- 功能卡: `docs/FEATURES/F-20261123-01-虚拟混音台.md`
- 视觉稿: `docs/FEATURES/assets/virtual-mixer-mockup-a.png` / `virtual-mixer-mockup-b-vu.png` / 对应 HTML
- 归档: `docs/DEV-NOTES-ARCHIVE.md`, `docs/ARCHIVE/README.md`
- 问题卡: `docs/ISSUES.md`

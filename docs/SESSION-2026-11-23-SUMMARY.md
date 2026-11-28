# SESSION 2026-11-28 进度总结（当前）

> 下次接手先看本文件，再读 `docs/DEV-NOTES.md` 的 424–436 与功能卡。
> 当前程序：VRCLiveBoard 1.4.8「补漏」EA；混音台主功能已迁入主程序。
> 工作区：main 与 origin 同步；最近提交 `9d49a14`。

## 0. 当前状态

- 主控制台已有 **“混音台”Tab**，页面 `src/web/public/mixer-page.js`。
- 主程序持有引擎：`src/audio/mixer/engine/` + `src/audio/mixer-manager.js`。
- 主 API：`/api/mixer/status|devices|config|channel|monitor|start|stop|meter|cue|cue/stop|cue/clear|cue/status|cue/gain|preset|pick-file|latency`。
- 旧 `plugins/virtual-mixer` 仍保留，但主页面已不依赖它；插件引擎尚未同步 M/S/监听/降噪，**不要再用旧插件操作**。插件退役仍待办。
- camera-path 插件 `plugins/camera-path` v0.4.1 仍承担运镜；cue 的相机联动仍走插件 API，**运镜尚未内部化**。

## 1. 已完成功能

### 主混音台
- 系统 / 麦克风 / 自定义 / 主输出 4 卡；A 横向通道条 + B-VU 两布局。
- B-VU 按 TEAC 实机参考：`-20/-10/-7/-5/-3/0/+3`、0~+3 红区、PEAK、约 4:3。
- 设备选择、增益、M/S、通道“跳线”开关、通道监听、主输出增益/M 静音。
- 独立监听输出选择；监听不受送线影响。
- 麦克风降噪（NoiseGate 门控，实时开关；不是 RNNoise）。
- 预设：音乐 / 电台 / 弹唱（当前只覆盖闪避/降噪）。
- CABLE 检测提示；A/B 布局默认 B 并持久化；页面隐藏时轮询降频。

### Cue
- 双文件同步、lead、麦克风回避、FLAC、峰值电平、进度。
- Cue 监听（复用页面监听输出）、播放中实时音量（`cue-control.json`）。
- 每行独立 `-24~+12dB` 增益 + 原生文件选择器（Electron；纯 Node 回 501）。
- 运镜下拉有“不使用”；运镜联动仍是近似同步。
- CueEngine 已修复 Windows Sleep 粒度导致的变速：缓冲反馈供样 220ms。

### 主程序/后端
- 主引擎由主进程启动/停止/释放；control 文件 100ms 热更新 M/S/监听/降噪/送线/主输出。
- 主页面走主 API，不要求 virtual-mixer 插件启用/授权。
- 实时监听第二路 WasapiOut；Cue 可同时走 CABLE + 监听。

## 2. 验证与证据

- `npm run gates`：**16 PASS / 0 FAIL**。
- 高码率压力（Z:\\曲库，192kHz/24bit FLAC、598MB FLAC）：单/双 Cue 均 **1.00~1.01x** 实时。
- 并发（Live + 双 192k Cue + 监听 + 麦克风/闪避/降噪）：Cue/Live 均 0.98~1.01x。
- 低配置模拟（两进程固定 1 逻辑核 + BelowNormal）：仍 0.98~1.00x。
- Cue 运行中音量：1→0.2 时 status level 0.29999→0.05999，PID 不变。
- 主输出增益/M、送线、Cue 每行增益、预设均实测/代码检查通过。
- 详细记录：DEV-NOTES **430–436**。

## 3. 已知限制 / 风险

- Cue 仍是**独立进程**，不是与 LiveEngine 同一输出回调。
- 运镜仍依赖 camera-path 插件，Cue 与运镜不是采样级锁定。
- 麦克风降噪只有一个门限开关；没有 light/standard/strong、RNNoise、高通、压缩。
- 只有 1 个自定义通道；计划里的 自定义 2 / 8 通道、“添加通道”未做。
- Cue 没有 `at` 时间戳排程、loop、actions/channel 映射。
- 文件选择器只在桌面 Electron 可用；Lite/Node 环境仍可手输路径。
- 端到端 <100ms 未正式达标；CABLE 往返约 100–126ms，VRChat 内端到端未重新验收。
- 旧 virtual-mixer 插件未退役；正式打包、插件市场包、安全审计未做。
- 主页面二次开发 API 文档还没写；旧插件 API 与主 API 并存。

## 4. 下次优先做

1. **Cue 与 LiveEngine 同一输出回调**（同步/监听/闪避的真正统一）。
2. **运镜内部化**，去掉主页面对外部 camera-path 插件 API 的依赖；再评估精确锁相。
3. 降噪完整挡位 + 高通 + mic 压缩 + 预设完善。
4. 自定义 2 / 多通道与“添加通道”。
5. Cue `at` 排程 / loop / actions；主 API 二次开发文档。
6. virtual-mixer 插件退役、正式打包、安全审计、端到端 <100ms 验收。

## 5. 关键入口

- 功能卡：`docs/FEATURES/F-20261123-01-虚拟混音台.md`
- 主页面：`src/web/public/mixer-page.js`
- 主管理器：`src/audio/mixer-manager.js`
- 引擎：`src/audio/mixer/engine/`（`LiveEngine.cs` / `CueEngine.cs` / `NoiseGate.cs`）
- API：`src/web/server.js` / `docs/ROUTES-BASELINE.json`
- 视觉参考：`docs/FEATURES/assets/virtual-mixer-mockup-a.png` / `...-b-vu.png`
- 测试命令：`npm run gates`；引擎构建 `src/audio/mixer/engine/build.bat`

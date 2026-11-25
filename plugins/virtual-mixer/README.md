# 虚拟混音台（S3 实时链路）

> 状态：实验插件。已打通 采集 -> 通道增益 -> 侧链闪避 -> CABLE Input -> VRChat；
> 提供实时 start/stop、可调参数，以及插件卡片内的 A/B 混合台界面；降噪/压缩、cue 同步播放后续接入。

## 文件

- manifest.json：插件声明，process=true（触发红窗授权）；设置字段由控制台自动渲染
- index.js：插件入口；status / devices / setup / liveConfig / start / stop / reloadConfig / 自测桥
- engine/VirtualMixerEngine.cs / Ducker.cs / LiveEngine.cs / CaptureTest.cs / OutputTest.cs / ProbeCaptures.cs / ToneTest.cs
- engine/NAudio.dll：NAudio 1.10.0（MIT，见 NAudio.LICENSE.txt）
- engine/build.bat：用 Windows 自带 csc 编译引擎
- test/：离线/采集/CABLE 回路 smoke

## 构建

    cd plugins\virtual-mixer\engine
    .\build.bat

需要 .NET Framework 4.x（Windows 10/11 自带），不需要 .NET SDK / NuGet。

## 自测

    npm run test:mixer
    npm run test:mixer:capture
    npm run test:mixer:cable

- test:mixer：版本/设备/离线混音/闪避/插件桥（不占用真实音频）
- capture：真实采集到 WAV（占用麦克风约 1.5s，不打开扬声器）
- cable：向 CABLE Input 注入 440Hz，从 CABLE Output 采集（仅虚拟线）

## 实时启停与手动调整

插件设置由控制台按 manifest.settings 自动渲染。设备字段必须填设备友好名（可用 devices() 查看）。

关键设置：

| key | 默认 | 说明 |
|---|---|---|
| masterOutputDevice | 空 | 输出，通常 CABLE Input (VB-Audio Virtual Cable) |
| systemCaptureDevice | 空 | 系统回环采集的播放设备；空=默认播放设备；选“不使用”=关闭系统采集 |
| micCaptureDevice | 空 | 耳机/声卡麦克风 |
| customCaptureDevice | 空 | 磁带/乐器/第二声卡等自定义输入；空=关闭 |
| micGainDb | 4 | 麦克风输出增益 dB |
| musicGain | 0.72 | 自定义输入通道增益 0-2 |
| systemGain | 1 | 系统回环增益 0-2 |
| duckEnabled | true | 讲话闪避开关 |
| duckDepthDb | -15 | 闪避深度 |
| duckThresholdDb | -35 | 触发阈值 dBFS |
| duckAttackMs | 45 | 淡入时间 |
| duckReleaseMs | 600 | 恢复时间 |
| duckHoldMs | 650 | 停顿保持 |
| duckLookaheadMs | 8 | 预看量 |
| sidechainHpfHz | 120 | 侧链高通 |
| autoStart | false | 打开并保存=启动实时混音；关闭=停止 |

start() / stop() 也可由插件 API 调用。修改数值后，控制台保存会调用 reloadConfig；autoStart=true 时自动重启引擎应用新参数。

安全约定：默认 autoStart=false，不会自动打开音频；设备名必须精确匹配，找不到会拒绝启动，避免误输出到物理扬声器。

## A/B 界面

在控制台“插件”页打开本插件设置，卡片内可切换：

- **A 通道条**：系统/麦克风/自定义/主输出四列，数字 dB。
- **B-VU**：机械 VU 表（主输出单只大表）、峰值灯、数字 dB。

设备下拉、增益滑杆、高级闪避参数与开始/停止按钮都在同一张卡片；电平来自实时引擎每秒状态。

## 当前不支持

- A/B-VU 控制台页面、降噪、压缩、cue/运镜联动
- 插件包/市场更新（仍在实验插件路径）

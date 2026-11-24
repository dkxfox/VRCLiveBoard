# 虚拟混音台（S1 骨架）

> 状态：实验插件，**S2a 核心完成：设备枚举 + 离线混音 + 电台侧链闪避算法**。
> 实时采集/输出、降噪/压缩、A/B-VU 控制台页面在后续切片接入。

## 文件

- `manifest.json`：插件声明，`process: true`（会触发红窗授权）
- `index.js`：插件入口；暴露 `status` / `engineVersion` / `devices` / `selftest` / `start` / `stop`
- `engine/VirtualMixerEngine.cs` / `Ducker.cs`：C#/.NET Framework 引擎与侧链闪避核心
- `engine/NAudio.dll`：NAudio 1.10.0（MIT，见 `NAudio.LICENSE.txt`）
- `engine/build.bat`：用 Windows 自带的 csc 编译引擎
- `test/engine-selftest.js`：离线引擎/插件桥自测

## 构建

```powershell
cd plugins\virtual-mixer\engine
.\build.bat
```

需要 .NET Framework 4.x（Windows 10/11 自带）。不需要 .NET SDK / NuGet。

## 自测

```powershell
node plugins\virtual-mixer\test\engine-selftest.js
```

检查：
1. `--version`
2. `--list-devices` 输出可解析的 render/capture JSON
3. `--selftest` 生成 48kHz/2ch/2s WAV，峰值与 RMS 合理
4. 插件 `devices()` / `selftest()` / `duckSelftest()` 桥返回结构正确
5. duck selftest：讲话段音乐衰减 ≥6dB（实测约 9.7dB）

## 当前不支持

- 实时系统回环 / 麦克风采集（S2a 核心算法已离线验证，实时链路下一片）
- 虚拟跳线路由 / 闪避 / 压缩 / 降噪
- 控制台 A/B-VU 页面

这些在 S2/S3 接入。
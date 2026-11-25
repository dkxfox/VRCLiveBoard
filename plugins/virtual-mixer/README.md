# 虚拟混音台（S1 骨架）

> 状态：实验插件，**S2a 核心完成：设备枚举 + 离线混音 + 电台侧链闪避算法**。
> 虚拟跳线实时输出实测、降噪/压缩、A/B-VU 控制台页面在后续切片接入。

## 文件

- `manifest.json`：插件声明，`process: true`（会触发红窗授权）
- `index.js`：插件入口；暴露 `status` / `engineVersion` / `devices` / `setup` / `selftest` / `duckSelftest` / `captureTest` / `start` / `stop`
- `engine/VirtualMixerEngine.cs` / `Ducker.cs` / `CaptureTest.cs` / `OutputTest.cs`：引擎、侧链闪避、采集与输出 smoke
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
npm run test:mixer
```

检查：
1. `--version`
2. `--list-devices` 输出可解析的 render/capture JSON
3. `--selftest` 生成 48kHz/2ch/2s WAV，峰值与 RMS 合理
4. 插件 `devices()` / `selftest()` / `duckSelftest()` / `captureTest()` 桥返回结构正确
5. duck selftest：讲话段音乐衰减 ≥6dB（实测约 9.7dB）
6. `captureTest()` 真实采集到 WAV（可选，见下）

## 当前不支持

- 虚拟跳线实时输出实测（输出代码已 smoke，但当前未安装 VB-CABLE）

### CABLE 回路 smoke（仅虚拟线，不打开物理扬声器）

```powershell
npm run test:mixer:cable
```

### 真实采集 smoke（会占用麦克风 ~1.5 秒，不打开扬声器）

```powershell
npm run test:mixer:capture
```
- 虚拟跳线路由 / 闪避 / 压缩 / 降噪
- 控制台 A/B-VU 页面

这些在 S2/S3 接入。
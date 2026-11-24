# 虚拟混音台（S1 骨架）

> 状态：实验插件，**S1 只完成引擎骨架 + 设备枚举 + 离线双轨混音自测**。
> 实时采集、电台闪避、A/B-VU 控制台页面、自动化 API 在后续切片接入。

## 文件

- `manifest.json`：插件声明，`process: true`（会触发红窗授权）
- `index.js`：插件入口；暴露 `status` / `engineVersion` / `devices` / `selftest` / `start` / `stop`
- `engine/VirtualMixerEngine.cs`：C#/.NET Framework 引擎源码
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
4. 插件 `devices()` / `selftest()` 桥返回结构正确

## 当前不支持

- 实时系统回环 / 麦克风采集
- 虚拟跳线路由 / 闪避 / 压缩 / 降噪
- 控制台 A/B-VU 页面

这些在 S2/S3 接入。
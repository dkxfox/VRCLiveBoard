# VR 覆盖层键盘(开发工具, 不随包)

这是 VRCLiveBoard 的 VR 世界覆盖层键盘原型, 目前 **P1 可用**: 右手柄 aim 射线、扳机点击、中文拼音候选、发送到 VRChat 聊天框、按键声音/手柄震动。

## 前置

- SteamVR 正在运行;
- **VRChat(任一 scene app)正在运行并已进入世界** —— SteamVR 的 action 输入需要场景应用提供输入上下文, 没有它读到的 pose 一直是 `bActive=0`(实测)。
- 本工具只在 `scripts/vrkeyboard` 下, 不参与主程序打包。

## 构建

```bat
scripts\vrkeyboard\build.bat
```

使用 Windows 自带 .NET Framework 4 的 `csc.exe`; 会把 `actions.json` / 绑定 / app manifest 复制到 `out\`。

## 运行

```bat
out\vrkeyboard.exe --run --world --show-at-start
```

- `--world` 必须带: 仪表盘模式(默认)没有 action 输入上下文;
- 控制口: `http://127.0.0.1:19192/` (`/show` `/hide` `/toggle` `/state`);
- 日志: 仓库根 `logs/vrkeyboard.log` 或 `%TEMP%\vrkeyboard.log`。

## 自检

```bat
out\vrkeyboard.exe --selftest
out\vrkeyboard.exe --sim
```

## 第三方代码

`openvr_api.cs` 是 Valve OpenVR SDK 的官方 C# 绑定(BSD-3-Clause), 原样 vendor 用于覆盖层纹理/震动; 许可证与来源见 `docs/THIRD-PARTY.md`。仅本开发工具使用, 不随产品包分发。

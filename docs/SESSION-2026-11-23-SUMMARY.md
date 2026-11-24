# SESSION 2026-11-23 进度总结

> 用途: 下次接手时先看本文件, 再读 `docs/DEV-NOTES.md` §1 与条目 349–395。
> 当前版本: **1.4.8「补漏」EA**; 功能卡/环境准备最后提交: **b14f14e**; 工作区干净。

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
- **2026-11-24 S1 已完成**: `plugins/virtual-mixer` v0.2.0 experimental + C#/NAudio 引擎；`--list-devices` / `--selftest` / `--duck-selftest`；测试 **17 PASS**，全量门禁 **16 PASS / 0 FAIL**；侧链闪避核心已离线验证；真实采集到 WAV 已通过 smoke（6 PASS）；`WasapiOut` 输出代码已静音 smoke，VB-CABLE 已安装（setup installed=true），默认音频已恢复物理设备；待重启/VRChat 实测；UI 未接。
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

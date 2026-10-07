# VRChat 相机 · OSC 调研笔记

> 建立: 2026-10-05。**调研状态产物**(按 PROCESS-05 §7.1: 只读资料, 未改动程序本体)。
> 起因: 用户确认"最早 VRC 的 OSC 能控制相机运动", 并提到 VRC+ 的**相机运镜**(轨迹可导出导入), 想把
> **相机运镜 + 直播插件 + 动作控制**结合起来做直播节目效果。
> 本文只记**查到的事实与出处**, 未确认的一律标注, 不猜。

## 1. 已确认:VRChat 的 OSC 里有 `/usercamera/` 命名空间

"usercamera" = 游戏里那台**官方摄像机**(player camera), 区别于世界里的 `VRC Camera Dolly` 组件。

### 1.1 相机"动作"端点(官方文档, 2025.3.3 Open Beta, **可写**)
```
/usercamera/Close            关闭相机
/usercamera/Capture          拍照
/usercamera/CaptureDelayed   定时拍照
```
出处: 官方更新文档 `docs.vrchat.com/docs/vrchat-202533-openbeta#osc-camera-endpoints`
(经社区库 vrc-camera-synchronizer 的 issue #9 转引, 原文明确写"documents three camera action endpoints with write access")。

### 1.2 相机偏移(官方反馈平台原文, float 可读写)
```
/usercamera/LookAtMeXOffset    "看向我"的水平偏移
/usercamera/LookAtMeYOffset    "看向我"的垂直偏移
```
出处: VRChat 官方反馈平台 bug 报告 "Camera OSC Look-At-Me Offsets Swaped"
(报告正文逐字引用了这两个地址, 说明它们已上线且双向)。

### 1.3 ⚠️ 尚未确认(不要当结论用)
- `/usercamera/` 的**完整地址清单**: 社区库把相机端点分成 **toggles / sliders / pose / actions** 几类,
  并有 issue「Implement OSC Camera **Pose**」——**强烈暗示存在位姿类端点**, 但**本文未读到官方清单**, 不下结论。
- 相机能否通过 OSC **自由移动/旋转**(用户的原始问题): 目前只能确认到"偏移 + 动作"这一类;
  **下一步**: 读官方 OSC 文档的相机章节(或对应版本更新公告)拿完整清单。

## 2. VRC+ 的两个相机功能(2025.1.3, 官方更新)

### 2.1 Camera Drone(摄影无人机)—— VRC+ 功能
官方描述: "功能齐全的无人机, 您可以在 VRChat 内飞行", 可用作额外录制工具。
其更新说明中明确写着 **"…这一切都适用于 OSC"**。
-> 含义: **无人机同样吃 OSC**, 即程序可以驱动一台会飞的相机。

### 2.2 Camera Dolly(摄影轨道相机)—— VRC+ 功能, 即用户说的"相机运镜"
官方描述: "允许您为相机设置**预定义的路径**…像摄像机的**客户端内动画系统**";
重点: **路径管理 —— 路径允许您按顺序播放多个动画**, 并新增了可动画的相机参数控件。
-> 含义: VRC+ 用户手里已经有"**带轨迹的运镜**"这套东西(用户提到轨迹可导出/导入, 与"路径管理"吻合)。

## 3. 这三样凑一起意味着什么(想法记录, 非承诺)

```
相机运镜(Camera Dolly 轨迹 / Drone + OSC)      ->  "镜头怎么动"
直播插件(本项目已有 bilibili-live: 弹幕/礼物/醒目留言/上舰) ->  "什么时候动、为什么动"
动作控制(avatar 参数 / OSC 输入 / 本项目控制台)   ->  "人和场景怎么配合"
```
**节目效果的具体形态**(示例, 待评估):
- 收到**醒目留言/上舰** -> 触发一段运镜(镜头推到该观众名字的公告板前);
- **弹幕刷屏** -> 切无人机环绕镜头;
- 定时公告/歌曲切换 -> 预设的第二个机位;
- 语音字幕(本项目已有)配合镜头 -> 相当于自带"导播切机位"。
**为什么有戏**: 这三块各自都已经能用, 缺的只是"**谁在什么时候按下运镜**" —— 而直播插件恰好提供了这个信号源。

## 4. 已知边界与风险(不美化)
1. **VRC+ 是付费订阅功能**: Camera Drone / Camera Dolly 都要求订阅, 不能假定所有用户都有;
2. **OSC 是本地能力**: 控制的是**本机** VRChat 的相机 —— 直播场景成立, 但"控制别人的镜头"不成立;
3. **不注入游戏**: 本项目一贯原则(OSC + 本地接口), 相机这条线同样**不碰游戏进程**;
4. **端点清单未读完**: 在拿到官方完整清单前, **不能承诺**"能自由控制相机运动";
5. **付费 + 版本相关**: 相机 OSC 端点是近几个版本才有的(2025.1.3 / 2025.3.3), 老版本没有。

## 5. 下一步(仍属调研)
1. 读官方 OSC 文档相机章节 -> 拿 **`/usercamera/` 完整地址清单**(类型/读写/取值范围);
2. 确认 **Camera Dolly 的轨迹是否可被外部读写**(用户提到导出导入 —— 若可通过文件交换, 则"预设机位"可以做成配置);
3. 用副本做一次**最小验证**(只发 OSC、不改本体): 给 `/usercamera/Capture` 发一条, 看相机是否拍照;
4. 全部清楚了再按 PROCESS-02 出 **D0 需求卡**(届时才是开发维护状态)。

## 6. 出处
- VRChat 官方反馈平台: Camera OSC Look-At-Me Offsets Swaped
  https://vrchat.canny.io/bug-reports/p/camera-osc-look-at-me-offsets-swaped
- VRChat 2025.1.3 更新(含 Camera Drone / Camera Dolly 官方说明, 中文镜像)
  https://docs.vrcd.org.cn/books/vrchat-5al/page/vrchat-202513/
- 社区库转引官方文档的相机动作端点(2025.3.3 Open Beta)
  https://github.com/jessiqa1118/vrc-camera-synchronizer/issues/9
- 同库: 相机位姿端点意向(佐证存在 pose 类端点, 未确认清单)
  https://github.com/jessiqa1118/vrc-camera-synchronizer/issues/14
- 使用同一命名空间的第三方商品(CameraMaster OSC, 旁证社区在用)
  https://booth.pm/ja/items/7657769

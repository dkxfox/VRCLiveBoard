# 相机 OSC 能力总表(VRChat)

> 来源:2026-10-14 ~ 10-16 在网格房间里与用户配合的实测。详细过程见
> `docs/FEATURES/F-20261006-01-直播镜头联动.md`(73 节)。
> 本文件是**可直接使用的结论与规格**,不含实验过程。

---

## 一、能力总览(一句话版)

    ✅ 能做:  切相机模式 · 拍照/定时拍照 · 图层与绿幕 · 透明底 8K 立绘
              · 镜头参数(变焦/曝光/光圈/焦距)· 构图偏移 · 防抖/水平锁定
              · 触发/换/停运镜(VRC+)· 飞行相机位移(仅 VR)
    ⚠️ 半自动: 跟随方式、对焦模式、对焦点 —— **无 OSC 入口, 必须手动设**
    ❌ 不能做: 读相机位姿 · 精确控制相机位置与朝向 · 读运镜播放进度
              · HSL 调色(可写但无效果)

---

## 二、38 个 /usercamera 地址完整表

| 地址 | 类型 | 权限 | 已验证效果 | 说明 |
| --- | --- | --- | --- | --- |
| Mode | int | 读写 | ✅ | **相机模式:1 本地单张 / 2 直播 / 3 动画(未启用) / 4 本地多图层 / 5 拍立得 / 6 无人机(需另召唤模型) / 7、8 空** |
| Capture | bool | 写 | ✅ | 拍照。8K PNG(RGBA, 带真实 alpha) |
| CaptureDelayed | bool | 写 | ✅ | 延时约 8 秒后拍照 |
| Close | bool | 写 | ✅ | 关闭相机 |
| Flying | bool | 读写 | ✅ | 飞行模式。**位移脉冲的前置条件** |
| FlySpeed | float | 读写 | ✅ | ⭐ **数值 = 米/秒,严格 1:1**(0.1/3/5 三点验证)。范围约 0.1~14.2 |
| TurnSpeed | float | 读写 | ✅ | 转向速度,1.0 档约 180 度/秒(0.1 档实测约 18 度/秒)。**非线性**,见待测 |
| LookAtMe | bool | 读写 | ✅ | 对准我 —— 画面中心锁定玩家**头部**并跟踪 |
| LookAtMeXOffset | float | 读写 | ✅ | 构图水平偏移,**量程 ±25**,每 10 单位约画面宽度 1/8 |
| LookAtMeYOffset | float | 读写 | ✅ | 构图垂直偏移,效果**比水平更干净**(10 单位约画面高度 1/8~1/5) |
| Aperture | float | 读写 | ✅ | 光圈。**15 = 全清晰,1.4 = 大幅虚化**(数值越小景深越浅) |
| FocalDistance | float | 读写 | ✅ | 焦距。**可精确写入**(写 1 读 1、写 5 读 5)。手动对焦模式下决定焦点距离 |
| Zoom | float | 读写 | ✅ | 变焦。可读(实测 91.22);未设置时读出 NaN |
| Exposure | float | 读写 | ✅ | 曝光,肉眼可见 |
| SmoothMovement | bool | 读写 | ✅ | 开启防抖。**不改变位移总量**,只让起步/停止更平顺 |
| AutoLevelRoll | bool | 读写 | ✅ | 滚转水平。开 = 画面永远水平 |
| AutoLevelPitch | bool | 读写 | ✅ | 俯仰水平。开 = 相机指向被强制摆平 |
| RollWhileFlying | bool | 读写 | ✅ | 联动镜头旋转:**转动手里监视器的角度** -> 镜头滚转 |
| LocalPlayer | bool | 读写 | ✅ | 图层:自己 |
| RemotePlayer | bool | 读写 | ✅ | 图层:其他玩家 |
| Environment | bool | 读写 | ✅ | 图层:场景(关掉 + 关绿幕 = 透明底) |
| GreenScreen | bool | 读写 | ✅ | 绿幕(优先于场景) |
| ShowUIInCamera | bool | 读写 | ✅ | 图层:游戏 UI(聊天框等) |
| OrientationIsLandscape | bool | 读写 | ✅ | 横构图 false 则输出 4320x7680 竖图 |
| DollyPathsStayVisible | bool | 读写 | ✅(作用已知) | 运镜路径常显 |
| Duration | float | 读写 | ❓ | 疑为拍摄/录制时长,当前 1 |
| PhotoRate | float | 读写 | ❓ | 疑为连拍速率,当前 1 |
| TriggerTakesPhotos | bool | 读写 | ❓ | 疑为"触发即拍照",当前 false |
| ShowFocus | bool | 读写 | ❓ | 疑为对焦相关显示,当前 false |
| AudioFromCamera | bool | 读写 | ❓ | 疑为相机收音,当前 false |
| Lock | bool | 读写 | ❓ | 疑为锁定相机,当前 true |
| Streaming | bool | 读写 | ❓ | **是什么未知**(曾干扰过显示输出,已还原) |
| FlingToClose | bool | 读写 | ❓ | 是什么未知(用户已找到开关,非"抓取关闭相机") |
| SmoothingStrength | float | 读写 | ❓ | 平滑强度,当前 5 —— **很可能就是起步/停止缓动的强度** |
| Pose | 6 float | **只读** | ❌ | **VRChat 实测不发**(监听 8 秒零相机报文) -> 拿不到位姿 |
| Hue / Saturation / Lightness | float | 读写 | ❌ | 可写但**无任何可见效果** |

---

## 三、/dolly 四个地址(运镜,VRC+)

| 地址 | 类型 | 权限 | 已验证 |
| --- | --- | --- | --- |
| Play | bool | 读写 | ✅ 触发/停止播放 |
| PlayDelayed | int | 读写 | ✅ 延迟 N 秒后播放(与面板"开始(3秒)"一致) |
| Import | string | 写 | ✅ ⭐ **参数 = 完整 Windows 路径(反斜杠)**;必须用 **Local(跟随玩家)** 轨迹 |
| Export / ExportLocal | string | 写 | ❓ 语义未测 |

**已实测的完整链路**:

    路径库 -> /dolly/Import <完整Windows路径>  (换轨迹)  -> /dolly/PlayDelayed 3  (播放)
    => 相机按**新导入的那条**轨迹运动(VRChat 自己播, 零漂移)

---

## 四、/input(仅 VR 模式有效)

    MoveForward / MoveBackward / MoveLeft / MoveRight / LookLeft / LookRight ...(全部 bool, 写)
    PC 模式下无效(PC 飞行需按住鼠标中键)

**位移换算**(三点验证):

    前进 X 米 = 脉冲 (X / FlySpeed) 秒
    例:走 5 米, FlySpeed = 0.2 -> 25 秒;  FlySpeed = 3 -> 1.67 秒
    注意: 开环无反馈, 长距离会累积误差 -> 建议**短程多段**(每段 <= 5 秒)

---

## 五、三个配方(插件可直接用)

### 5.1 电影感画面

    Mode = 1(本地单张) 或 2(直播)
    对焦模式 = 半自动(SA)      [手动设, 无 OSC 入口]
    对焦点   = 点一次圈 -> 回到中心  [手动设, 无 OSC 入口]
    Aperture = 1.4             [OSC]
    LookAtMe = true            [OSC]
    AutoLevelRoll = true       [OSC]
    => 主体永远清晰居中、背景柔化、画面不歪

  原理:半自动模式的对焦点是**监视器上的一个二维坐标点**(像手机点屏幕对焦),
  没有人脸识别/运动追踪;但 LookAtMe 能让玩家的头**永远待在画面中心**,
  于是"把焦点放在中心"就等于**等效的自动跟焦**。

### 5.2 简易实时运镜(不依赖 VRC+)

    Flying = true              [OSC, 仅 VR]
    LookAtMe = true            [OSC]
    位置由 /input 脉冲控制(FlySpeed 数值 = 米/秒)
    => 环绕 / 推近 / 拉远 / 平移, 而且镜头始终盯着玩家

### 5.3 直播自动链路(事件触发)

    事件(上舰/礼物)
      -> Mode = 2(直播相机, 显示器输出相机画面 -> OBS 直接抓窗口)
      -> /dolly/Import 换一条专用轨迹
      -> /dolly/PlayDelayed 3
      -> Capture 定格一张 8K
      -> 还原 Mode

---

## 六、必须手动设定的四项(无 OSC 入口,已实证)

    ① 跟随方式   默认(镜头与监视器一体,像拿手机) / 玩家(自拍杆,跟着你) / 世界(三脚架,固定)
                 -> 按**活动范围**选: 到处走用玩家, 定点表演用世界
    ② 对焦模式   关闭(全清晰) / 半自动(自动对画面中心) / 手动(焦距可控)
    ③ 对焦点     点一次圈回到中心, 点别处换新焦点(二维坐标,无人脸识别)
    ④ 飞行模式   若要用实时运镜(也可用 OSC 写,但实测写入不稳定,以面板为准)

---

## 七、避坑与纪律(都踩过)

    1. OSC 报文必须 **NUL 结尾 + 4 字节对齐**, 否则 VRChat **静默忽略**;
    2. **用 OSC 写 FlySpeed 会出怪值**(写 1 读回 15)-> 一律"写后读回确认", 不一致以读回为准;
       速度/模式这类值**优先让用户在面板上调, 插件只读**;
    3. OSCQuery 端口**每次启动都变**, 需从 output_log 里读 "type OSCQuery on <port>";
    4. 照片在 **Pictures/VRChat/<年-月>/** 下, 不在顶层;
    5. 半自动/全自动模式下 `FocalDistance` 只是**上次手动写入的残留值**, 不能用来判断当前焦点;
    6. "对准我"跟踪的是**头部**, 头部有自然微动 -> 用**人像像素位置**做测量会有噪音,
       验证这类参数时**用地平线/墙地交界当参照**更可靠;
    7. 测量前请用户**锁死参照物**(如锁定 T-pose 模型), 并且**一次只改一个变量**。

---

## 八、待办清单

**待测变量(10 个)**:Duration · PhotoRate · TriggerTakesPhotos · ShowFocus ·
AudioFromCamera · Lock · Streaming · FlingToClose · DollyPathsStayVisible · SmoothingStrength

**待测数值/关系(5 项)**:
1. TurnSpeed 的真实档位-速度关系(非线性之谜;怀疑是起步缓动造成)
2. 起步加速曲线 / 末段减速(拟合 v(t) 后可精确换算短脉冲)
3. 短脉冲位移是否也偏慢(FlySpeed 三点验证都是长脉冲做的)
4. 速度模式下运镜的真实时长(文件里的 Duration 不可信)
5. /dolly/Export 的语义

**注意点**:构图偏移设得较大时, 半自动对焦的焦点仍在画面中心 -> 人像可能跑出清晰范围。

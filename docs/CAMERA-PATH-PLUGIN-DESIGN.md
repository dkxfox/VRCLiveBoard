# 相机运镜(录制/重放)插件化准备 —— 设计与任务分解

> 状态: **v0.3.0 已落地(dolly 预设 + 局域网控制台)**; 记录/重放与核心 OSC hub 仍按本设计后续实施 | 日期: 2026-10-30 | 关联: `plugins/camera-path`(v0.1.0)、`F-20261006-01`、`F-20261014-01`、`CAMERA-CONSOLE-DESIGN.md`、`DEV-NOTES 350/375~381`
> 范围: 只做**插件化准备工作**(设计/缺口/里程碑/验收/风险), 不改产品代码; 实施另行开工。

## 0. 目标与边界

**目标**: 把 2026-10-22~30 在开发工具(`scripts/dev/camera-calib.js`)里验证过的能力搬进 `camera-path` 插件, 发布 **v0.2.0**:
- 录制: 读 VRChat `/usercamera/Pose`(事件驱动 ~61Hz) → 世界坐标轨迹文件;
- 重放: 以当前位姿为起点做**相对重放**(位置+偏航), 采用**模拟量连续矢量**控制;
- 安全: 任何退出/异常都要把输入全部归零(含 4 个模拟轴), 相机不得自己继续动;
- 不做: 俯仰重放(无 OSC 入口)、不改用户 FlySpeed、不碰 VRChat dolly 文件语义未证实部分。

**已验证的核心结论(测试证据见 DEV-NOTES 375~381, 能力总表 7.10.16~7.10.22)**:
| 能力 | 结果 |
| --- | --- |
| 连续重放(模拟量矢量, kp=9) | 完整 15s 轨迹 17.0s, 平均 3.3cm / 终点 3.4cm, 终点偏航 -0.79° |
| 平滑度 | 线加速度噪声 mean 51.2→**6.97**(-86%), P95 296→**22**(-93%) |
| 静止安全 | 静止轨迹 0.0cm/0.00°, idle 2s **0 Pose** |
| 已知小缺陷 | 末端低速定位偶发“抖一下”(bool 小脉冲 20ms≈6cm 量化) |

## 0.1 已落地(2026-10-30, 见 DEV-NOTES 383)

- `plugins/camera-path` → **v0.2.0**: 预设扫描/一键导入播放/仅导入/停止/自动拆分(≤6 帧每段)/临时文件清理/状态/测试 API + 控制台自定义卡片(三语)。
- 实测限制: 单段 >6 关键帧不稳、临时文件必须在 CameraPaths、Import 后等待 ≥800ms。

## 1. 现状盘点

**插件 `plugins/camera-path` v0.1.0(已有)**:
- 自带 `dgram` OSC 发送(含包体自检 `audit()`)、端点能力探测、自动隐藏 UI 拍照、`/dolly/Play|PlayDelayed` 引擎、VRC 运镜 JSON 解析;
- 权限: `network:[127.0.0.1]`, `filesystem.read: Documents/VRChat/CameraPaths`, `process:false`, `ports:[]`;
- **不随包出厂**(`scripts/pack-exclude.json` 含 `plugins\camera-path`)。

**核心侧现状**:
- 插件系统 `api 2.0.0`: ctx 提供 config/events/chatbox/http/fs/exec/registerSource/plugins,**没有 OSC 输入订阅能力**;
- `src/triggers.js` 在启用时**独占绑定 127.0.0.1:9001**(`UDPPort`), 插件无法同时监听 Pose;
- 插件动作按钮(`manifest.actions` + `POST /api/plugins/action`)只在 **F-20261014-01 DRAFT** 里规划, 尚未实现;
- 控制台插件卡片只渲染 `settings`, 没有“开始/停止/录制/重放”按钮。

## 2. 缺口清单(按依赖排序)

### 2.1 核心(必须先做)
| # | 缺口 | 说明 | 风险 |
| --- | --- | --- | --- |
| C1 | **OSC 输入中枢** | 核心独占 UDP 9001, 解析后按 `/usercamera/Pose`、`/avatar/parameters/*` 分发给触发器与插件; 新增 `ctx.oscIn.subscribe(filter, cb)` + manifest 权限 `osc.input`(高危, 红窗) | 中高(改到触发器/权限体系) |
| C2 | **插件动作桥** | 按 F-20261014-01: manifest `actions` + `POST /api/plugins/action`(白名单, 一级门禁) + 插件卡按钮区 | 中 |
| C3 | **插件权限扩展** | `osc.input` 声明与审计(所有订阅记 `plugin-audit.log`); 文件写入允许插件 data 目录或 `Documents/VRChat/CameraPaths` | 中 |
| C4 | **状态回传** | 插件 `status()` + `ctx.registerSource` 给控制台显示: 录制中/重放中/相机是否在动/错误 | 低 |

### 2.2 插件(可并行)
| # | 缺口 | 说明 |
| --- | --- | --- |
| P1 | Pose 采集/缓存 | 事件驱动 → 缓存最近位姿; 需要“微推一下”取初值(工程已在开发工具实现) |
| P2 | 模拟量连续控制器 | 前馈(录制速度)+kp·误差; 三轴同时写 `/input/Vertical|Horizontal|LookVertical`; 收尾归零模拟量 + TurnSpeed=0.1 bool 小脉冲收偏航; kp=9 已调优 |
| P3 | 安全归零 | `zeroAll()` 必须包含 4 个模拟轴; 异常/停用/崩溃路径统一; 可选看门狗(无 Pose 却持续发指令→停) |
| P4 | 轨迹存储/格式 | JSON v1: `{format, createdAt, durationSec, hz, start, startRot, samples:[{t,pos,rot}]}`; 存 `Documents/VRChat/CameraPaths`; 兼容开发工具文件 |
| P5 | 设置项 | `kp`、`durationSec`(录制时长)、`safeMaxSpeed`、`easeOutSec`、`maxReplaySec`、`allowAutoEnableFlying`(默认 false, 飞行模式需用户手动开) |
| P6 | 已知缺陷 | 末端低速“抖一下”: 候选修法 a) 收尾用更低速/更小模拟量(需实测模拟轴小值是否有效); b) 收尾分多级(ease-out 更慢); c) 用 VRChat 自带 dolly 播最后一段(若语义可用) |

## 3. 架构方案(推荐 A)

**A(推荐): 核心 OSC 中枢 + 插件动作桥**
```
UDP 9001 ──> core OSC hub ──┬─> triggers(现有输入触发器)
                            ├─> camera-path(订阅 Pose)
                            └─> 其他插件(按权限)
camera-path ──> core plugin actions(按钮/接口) ──> 录制/重放/停止/panic
camera-path ──> UDP 9000(发 /input/*、/usercamera/*; 复用 v0.1.0 的 OSC 编码器)
```
优点: 9001 唯一 socket, 不依赖触发器开关; 权限/审计统一; 插件可复用核心的 OSC 编解码。

**B(退路, 不推荐)**: 插件按设置自己绑 9001, 仅在“触发器未启用”时工作; 需在状态里明确冲突提示。缺点: 与触发器互斥、用户体验差、难审计。

**C(界面, 后续)**: `CAMERA-CONSOLE-DESIGN` 的插件自带静态页 + WebSocket; 第一版用动作按钮 + `status()` 即可, 页面后置。

## 4. 接口契约(草案)

- **OSC 输入订阅**: `ctx.oscIn.subscribe(['/usercamera/Pose'], fn)`; 回调 `{address, args, at}`; 退订返回函数; 插件停用时核心自动清理。
- **动作**: manifest `actions:[{name,label,hint,confirm?}]`; 控制台 `POST /api/plugins/action {id,action}` → `{ok,result}`; camera-path 首批: `record10s`、`replayLast`、`stop`、`panic`。
- **设置**: `kp`(默认9)、`recordSeconds`(10)、`maxReplaySec`(60)、`easeOutSec`(1.0)、`autoEnableFlying`(false)。
- **状态**: `status()` → `{ok, recording, replaying, lastPos, lastError, activeAxis}`。

## 5. 安全红线(必须遵守)

1. **归零**: 停用/异常/调用 `panic` 一律 `zeroAll()`(6 个 bool 轴 + 4 个模拟轴), 并读回确认相机静止(idle 无 Pose);
2. **不写 FlySpeed/TurnSpeed 用户值**: 控制器只在需要时临时改 TurnSpeed 且在 finally 还原(已有工程实现);
3. **飞行模式**: 默认不自动打开(`autoEnableFlying=false`), 未开时明确报错“请在相机面板打开飞行”;
4. **看门狗**: 重放中若 1s 没收到 Pose 或相机位置连续 0.5s 无变化且指令非零 → 立即停发并归零;
5. **权限**: `osc.input` 高危需红窗授权; 所有订阅/发送走审计; 插件不联网(仅 127.0.0.1)。

## 6. 里程碑与验收

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| M1 | 核心 OSC hub + `ctx.oscIn` + `osc.input` 权限/审计 | 单测: 单 socket、两订阅者、停用清理; 触发器回归全绿; 15 门禁 PASS |
| M2 | 插件 v0.2.0 引擎(录制/重放/归零) + 离线单测 | 单测: 轨迹解析、控制器数学、归零覆盖 10 轴、看门狗; 不连 VRChat |
| M3 | 插件动作桥(F-20261014-01) + camera-path 四个动作 | 控制台按钮可用; 未声明 action 被拒(403) |
| M4 | 真机验收 | 录制 10s → 重放 15s 轨迹: 平均≤10cm/终点≤5cm/终点偏航≤2°; 结束后 idle 0 Pose; panic 立即停 |
| M5 | 文档/版本 | manifest 0.2.0 + changelog; DEV-NOTES/能力总表更新; 视用户决定是否随包/市场 |

**注意**: M1 是核心改动, 需按 PROCESS-02/03 走门禁与安全审计; M2 可先用假 Pose 数据做离线单测。

## 7. 风险与未决问题

1. **是否随包出厂**: 现在 `plugins/camera-path` 在 pack-exclude 里(实验)。v0.2.0 要不要进包/进市场? 进包需移除排除项 + 更新包审计基线(zipVolumes)。
2. **`osc.input` 权限模型**: 订阅全部 Pose 还是仅 `/usercamera/Pose`? 建议先只允许白名单地址, 降低风险。
3. **插件版本/授权**: 新权限会触发二次红窗授权; 需在发布说明里写清。
4. **低速末端抖动**: 需在 M4 前解决或明确接受(候选修法见 P6)。
5. **VRChat 版本变化**: Pose 字段/坐标约定/事件频率可能变, 插件需在启动时自检并降级报告。

## 8. 需要用户拍板的点

1. v0.2.0 先做**实验插件(不进包)** 还是直接规划进包/市场? (默认: 先实验, 验证后再决定)
2. 动作入口用**控制台按钮**(需先做 M3 动作桥) 还是先只用“调用插件接口”? (默认: 做 M3, 体验最好)
3. 录制时长默认 10s、重放最长 60s 是否合适? (默认: 合适)
4. 低速末端抖动是否作为 v0.2.0 的**阻塞项**(先修再发) 还是已知限制? (默认: 不阻塞, 记录并后续修)

## 9. 证据与参考

- 开发工具研究记录: `DEV-NOTES 375~381`, `docs/CAMERA-OSC-CAPABILITY.md` 7.10.16~7.10.22;
- 插件动作桥草案: `docs/FEATURES/F-20261014-01-插件动作桥.md`;
- 控制台页面设计: `docs/CAMERA-CONSOLE-DESIGN.md`;
- 现有插件: `plugins/camera-path/`(v0.1.0), `docs/PLUGIN-DEV.md`(api 2.0.0 / settings / 安全策略)。
# VRChat OSC 官方功能说明(实测要点)

## 开启方式
游戏内 Action Menu → Options → OSC → Enabled。开启后 VRChat 监听 **UDP 9000 端口**(收消息)。

## 聊天框(本项目核心通道)
- OSC 地址: **/chatbox/input**, 消息格式必须是三个参数:
  1. s(字符串): 文本内容
  2. b(布尔): true = 直接显示(不弹输入框确认); false = 只填入输入框等待确认
  3. b(布尔): 播放提示音开关(false = 静音)
- 上限: **144 字符, 最多 9 行**。超出被截断。
- 发送频率限制: 官方约 **5 条 / 5 秒**, 本程序内置 1.2 秒最小间隔 + 去重。
- 玩家打字时: 文字会被暂存到输入框区域, 停止输入后恢复显示。
- 观看者需要在设置里开 "聊天框换行" 才能看到多行效果。

## OSCQuery(注意!)
- 2025/2026 版 VRChat 的 OSCQuery 服务走**随机端口**(实测 59771 等), 不是 9000。
- 因此"检测 VRChat OSC 是否开启"不能用端口探测, 本项目改为解析日志:
  %USERPROFILE%\AppData\LocalLow\VRChat\VRChat\output_log_*.txt
  关键行: "OSC enabled: True"、"Advertising Service ... of type OSC on 9000"。

## 玩家进出事件(日志格式, 2026 实测)
- 进房: [Behaviour] Entering Room: <世界名>
- 玩家加入: [Behaviour] OnPlayerJoined <显示名> (usr_<uuid>)
- 玩家离开: [Behaviour] OnPlayerLeft <显示名> (usr_<uuid>)
- 坑: 你进入房间后约 10 秒, VRChat 会把房间里**已存在的玩家**(含你自己)补写一遍 OnPlayerJoined —— 好友欢迎插件已按"进房后 30 秒内视为快照"跳过。
- 坑: 显示名后带 (usr_uuid), 展示前要去掉, 否则会出现 "名字 ()" 残留。

## 其他常用 OSC 地址(预留, 未全部使用)
- /avatar/parameters/* — 头像参数输入(需要 avatar 支持, 可以控制特定 prefab)
- /input/MoveForward、/input/Jump 等 — 移动输入模拟(谨慎)
- /tracking/trackers/* — 追踪器
- 官方文档页: docs.vrchat.com(OSC 章节)。本项目只需要 /chatbox/input。

## 视频播放限制(合规相关)
- 2024.4.2+ 官方禁止在**公开房间**放视频(版权), 只允许好友房/私人房;
- 本项目不含任何视频下载/直链功能(B 站直链插件已作废删除), 请勿在公开房使用相关工具。

# LiveTranslate 接入调研(2026-01 实测)

软件: LiveTranslate-portable-v2026.06.06(Python 3.12 + uv,SenseVoice Small ASR + LLM 翻译,RTX CUDA)。
目录: C:\Users\10166\Downloads\LiveTranslate-portable-v2026.06.06\LiveTranslate

## 关键发现

1. **转写文件(首选接入点)**: \transcripts\livetrans_YYYYMMDD_HHMMSS_translation.txt
   - 每次启动新建一组文件: _original.txt(原文) / _translation.txt(译文) / _all.txt。
   - 格式: 首行 # Session started at ...;之后每行 [HH:MM:SS] 文本,实时追加。
   - 接入方案: 监听 transcripts\ 目录,取最新 *_translation.txt 的最后 1~3 行 → 推送聊天框。零延迟、零 OCR。
   - 注意: 软件移动目录后路径会变,路径做成可配置。
2. **OCR 兜底**: 悬浮窗类名 SubtitleWindow,标题 "LiveTranslate Subtitle",默认位置 (378,900) 尺寸 1000x131,文本区域约 (394,908)-(1362,1023);白字黑底(translation_color #ffffff, bg #000000, 字号 14)。OCR 前反色 + 阈值。
3. **UIA 不可行**: 悬浮窗 UIA 树只有空 Group,文本为自绘(PyQt/Qt 自绘),抓不到。
4. **控制面板窗口**: 类名 SubtitleOverlay,标题 "LiveTranslate",包含 RMS/VAD 进度条、模型选择(deepseek API / hunyuan 本地 127.0.0.1:1234)。
5. user_settings.json: auto_save_transcript=true(转写保存默认开启),subtitle_mode.enabled,窗口坐标在 subtitle_mode/window_x|y。

## 会话文件示例

    # Session started at 2026-06-09 20:57:25
    [20:58:53] 很高兴见到你。

→ 推送聊天框时去掉 [时间戳],取 text 部分。

## 实现状态(VRCLiveBoard plugins/)

1. **livetranslate.js(已实现,沙箱端到端验证通过)**: 每 1.5s 扫描 transcriptsDir 下最新的 *_translation.txt,取最后 N 行(config.lines,默认 2),去除 [HH:MM:SS] 前缀后作为聊天框文本;文件 mtime 超过 maxAgeMs(默认 12s)视为停止说话,自动让位给其他源。优先级 40(临时推送 80 > 媒体 30 > 硬件 10 > 轮播 5)。
2. **ocrregion.js(已实现,兜底)**: 默认停用。用 PowerShell UIA 按窗口标题 "LiveTranslate Subtitle" 自动定位悬浮窗矩形(窗口被拖动也能跟上),截图后 tesseract.js + chi_sim 离线 OCR(白字黑底无需反色,实测准确)。注意: 截图取的是屏幕最上层像素,悬浮窗被遮挡时 OCR 无效(LiveTranslate 自带 Top-most 开关可解决);转录文件方案不受遮挡影响,因此优先用文件。
3. 沙箱实测结论: 中文 OCR 两种配色均识别正确;真实屏幕截图+OCR 链路可用;WinRT(SMTC)在沙箱内不可测,用户桌面可用。

# 第三方组件与许可证清单(THIRD-PARTY)

> **用途**: 记录"我们用了谁的代码/素材、什么许可证、随不随包出厂"。依赖的**机器基线**在 `docs/SECURITY-BASELINE.json`(dep-audit 盯版本与产物哈希); 本文件管的是它管不到的那一层: **许可证、来源、分发方式**。
> **维护口径**: 只写**核实过**的字段(版本取自 `package.json` / `package-lock.json` / vendor 文件头); 没核实的写"待确认", 禁止照抄印象 —— 本文件第 2 节里的 `cptable 1.15.0` 就是一次"照抄印象会写错"的实例(那是代码页表版本, 不是 SheetJS 版本)。
> 建立于 2026-09-27(标准审计发现的 P2 缺章: 此前只有依赖哈希, 没有许可证与来源清单)。

## 1. 随包出厂(自包含版解压即用; 版本均为实测)

| 组件 | 版本 | 许可证 | 用途 | 位置 / 许可文本 |
| --- | --- | --- | --- | --- |
| electron | 43.4.0 | MIT(内嵌 Chromium / Node 各自许可) | 桌面外壳; 内嵌 Node **24.18.1** | `node_modules/electron/dist/` — 自带 `LICENSE` 与 `LICENSES.chromium.html` ✓ |
| osc | 2.4.5 | MIT OR GPL-2.0(我们按 **MIT** 使用) | OSC UDP 发送 | `node_modules/osc` — 包内无 LICENSE 文件, 依 package.json 声明 |
| systeminformation | 5.33.5 | MIT | CPU / GPU / 内存 / 网速采集 | `node_modules/systeminformation` — 自带 `LICENSE` ✓ |
| tesseract.js | 7.0.0 | Apache-2.0 | 截图翻译的本地 OCR | `node_modules/tesseract.js` — 自带 `LICENSE.md` ✓ |
| @tesseract.js-data/chi_sim | 1.0.0 | MIT | 中文识别模型 | 包内无 LICENSE 文件, 依 package.json 声明 |
| @tesseract.js-data/jpn | 1.0.0 | MIT | 日文识别模型 | 同上 |

Lite 包不带 electron(需系统 Node 22+), 其余依赖由 npm 按需安装, 许可文本随包落地。

## 2. 插件 vendor(随插件出厂)

| 组件 | 版本 | 许可证 | 谁在用 | 备注 |
| --- | --- | --- | --- | --- |
| SheetJS `xlsx`(CJS 构建 `vendor/xlsx.js`) | 0.20.3 | Apache-2.0(SheetJS Community Edition) | friend-welcome / scheduled-board | 文件头只有 `(C) 2013-present SheetJS`, **许可证文本没有随 vendor 附带** |
| SheetJS `xlsx`(CJS 构建 `vendor/xlsx.js`) | **0.18.5** | Apache-2.0 | weather-board | **版本落后**, 已挂 PROCESS-02 §7 台账(M-20260904-01: 统一 0.20.3 + 回归 Excel 导入导出) |
| SheetJS `xlsx`(浏览器构建 `vendor/xlsx.full.min.js`) | 与同目录 `xlsx.js` 同源 | Apache-2.0 | 三个插件的面板 / 前端 | 文件头里的 `cptable{version:"1.15.0"}` 是**代码页表**版本, **不是** SheetJS 版本(已实测) |

**待办(合规)**: 三个插件的 `vendor/` 里都没有 SheetJS 的 LICENSE 副本。Apache-2.0 要求随分发保留许可与声明 —— 上架 / 发版时把 Apache-2.0 文本与 NOTICE 放进各插件 `vendor/`(或插件 README 末尾附全文)。**未完成前不要新增 vendor 依赖。**

## 3. 用户侧按需安装(不由我们的 zip 分发)

| 组件 | 许可证 | 触发方式 | 说明 |
| --- | --- | --- | --- |
| Python(便携版或系统版) | PSF-2.0 | 控制台"环境检测"一键安装便携版; 或用户系统已装 | `src/pyhelper.js` 依次找系统 `python` 与 `.pydist\python.exe`; 官方 `python-embed.zip` 自带 `LICENSE.txt` ✓ |
| winsdk(PyPI) | MIT | pip 安装 | SMTC 媒体助手依赖; 缺失时媒体功能降级并在日志说明 |
| LiveTranslate(第三方便携程序) | 作者声明(**未核**) | 用户自行下载 | 我们只读它产出的 `transcripts/*.txt`; **不再分发**, 也不进任何 zip |

## 4. 素材

| 素材 | 状态 | 说明 |
| --- | --- | --- |
| `assets/videos/*.mp4`(当前 `fes-0615.mp4`, 7.8MB) | **来源与授权未记录 —— 待用户确认** | 启动彩蛋视频, **只进自包含包**(Lite 排除); `events.json` 不入库, 打包时注入。发布前请确认素材来源 / 可分发性, 或换成自制素材 |
| 图标 / 主题 / 星空背景 / 彩蛋代码 | 本项目自制 | — |

## 5. 规则(新增第三方组件时照做)

1. 新增或升级任何第三方组件(依赖 / vendor / 模型文件 / 素材), **在同一次提交里更新本文件** —— 否则 dep-audit 只看得见哈希, 看不见许可证与来源。
2. 版本以文件头或 `package.json` 的**实测值**为准, 不许照抄印象; 许可证以包内 LICENSE 文件或 `package.json` 的 `license` 字段为准, **两者都没有就写"待确认"并去上游核实**。
3. 许可证不明或来源说不清的组件 / 素材**不进包**; 已经在包里的(如上表的彩蛋视频)先确认再发下一版。
4. 插件的 `vendor/` 若引入第三方库, 必须带许可文本(见第 2 节待办)。
5. 本文件不替代 `docs/SECURITY-BASELINE.json`(机器基线); 两者合起来才是"依赖 + 许可证"的完整面。

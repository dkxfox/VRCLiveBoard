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

**✅ 已补齐(2026-09-27)**: 三个插件各自在**插件目录根**放了 `LICENSE-Apache-2.0.txt`(Apache-2.0 全文, 取自本仓库 `node_modules/tesseract.js/LICENSE.md` 的规范文本)与 `THIRD-PARTY-NOTICE.txt`(声明: 组件/版本/上游/许可/我们只做原样拷贝)。放在**插件根而不是 vendor/** 是有意的: ① surface-scan 不扫 `.txt`, 所以不会让攻击面基线漂移; ② dep-audit 只监控 `plugins/<id>/vendor/` 的聚合哈希, 根目录新增文件不影响它; ③ 市场 zip 会带上这两个文件(许可随分发一起走)。**代价(已接受并记录)**: 授权哈希覆盖整个插件目录 → 三个插件各升一个补丁位(`friend-welcome 1.3.3` / `scheduled-board 2.0.1` / `weather-board 1.0.1`), **已装用户更新后需要重新授权一次**; `market/packages` 与 `market/index.json` 已同步重建。

## 3. 用户侧按需安装(不由我们的 zip 分发)

| 组件 | 许可证 | 触发方式 | 说明 |
| --- | --- | --- | --- |
| Python(便携版或系统版) | PSF-2.0 | 控制台"环境检测"一键安装便携版; 或用户系统已装 | `src/pyhelper.js` 依次找系统 `python` 与 `.pydist\python.exe`; 官方 `python-embed.zip` 自带 `LICENSE.txt` ✓ |
| winsdk(PyPI) | MIT | pip 安装 | SMTC 媒体助手依赖; 缺失时媒体功能降级并在日志说明 |
| LiveTranslate(第三方便携程序) | 作者声明(**未核**) | 用户自行下载 | 我们只读它产出的 `transcripts/*.txt`; **不再分发**, 也不进任何 zip |

## 4. 素材

| 素材 | 状态 | 说明 |
| --- | --- | --- |
| `assets/videos/*.mp4`(当前 `fes-0615.mp4`, 7.8MB) | **来源仍待用户确认 —— 但已由机制挡住: 未登记就不随包** | 启动彩蛋视频, **只进自包含包**(Lite 排除); `events.json` 不入库, 打包时注入。**登记处: `docs/ASSET-PROVENANCE.json`** —— `source/license/confirmedBy` 三项填齐才随包, 否则 `make-dist` 会把它从包里移除并在日志里点名。发布前请确认素材来源 / 可分发性, 或换成自制素材 |
| 图标 / 主题 / 星空背景 / 彩蛋代码 | 本项目自制 | — |

## 5. 规则(新增第三方组件时照做)

1. 新增或升级任何第三方组件(依赖 / vendor / 模型文件 / 素材), **在同一次提交里更新本文件** —— 否则 dep-audit 只看得见哈希, 看不见许可证与来源。
2. 版本以文件头或 `package.json` 的**实测值**为准, 不许照抄印象; 许可证以包内 LICENSE 文件或 `package.json` 的 `license` 字段为准, **两者都没有就写"待确认"并去上游核实**。
3. 许可证不明或来源说不清的组件 / 素材**不进包**: 素材走 `docs/ASSET-PROVENANCE.json` 登记(`make-dist` 会移除未登记的并点名), 组件走本文件与第 2 节的许可文本。
4. 插件的 `vendor/` 若引入第三方库, **同一目录树的插件根**必须带 `LICENSE-<许可>.txt` + `THIRD-PARTY-NOTICE.txt`(见第 2 节做法; 根目录放 txt 不会扰动攻击面/产物基线)。
5. **市场发布也受同一份禁入名单约束**: `make-market.js` 现在会跳过命中 `pack-exclude.json` 的 `forbiddenNamePatterns` 的插件 id("不进包的东西也不进市场"); 2026-09-27 修之前, 三个开发夹具曾被误当成官方插件写进市场索引。
6. 本文件不替代 `docs/SECURITY-BASELINE.json`(机器基线); 两者合起来才是"依赖 + 许可证"的完整面。

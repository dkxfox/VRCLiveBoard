# 文档归档区(ARCHIVE)

> 本目录只存放**已过时但仍有历史价值**的文档; 不删除、不随发布包分发。
> 当前有效文档仍在 `docs/` 根目录; 开发记录见 `docs/DEV-NOTES.md`(最近两个版本)与 `docs/DEV-NOTES-ARCHIVE.md`(更早)。

## 归档规则

- 只有当文档**已被新版本/新文档取代**, 或属于旧版本的发布说明/复盘/会话摘要时才移入本目录。
- 移动时保留原文件名, 并在本表登记; 不修改原文内容。
- 审计报告(`AUDIT-*`)、问题卡(`ISSUES*`)、安全/依赖基线(`*-BASELINE.json`)是证据链, **不归档、不删除**。
- 归档文件不进入发布包(docs 出厂白名单只含 PLUGIN-DEV/GLOSSARY/LIVETRANSLATE/RESEARCH/DEV-NOTES/THIRD-PARTY 等当前文档)。

## 已归档内容

| 归档路径 | 原路径 | 归档原因 | 日期 |
| --- | --- | --- | --- |
| `RELEASES/v1.4.6/RELEASE-1.4.6-NOTES.md` | `docs/RELEASE-1.4.6-NOTES.md` | 1.4.6 发布说明, 已被 1.4.7/1.4.8 版本说明取代 | 2026-11-23 |
| `RELEASES/v1.4.6/RETRO-1.4.6.md` | `docs/RETRO-1.4.6.md` | 1.4.6 复盘, 历史版本材料 | 2026-11-23 |
| `SESSIONS/SESSION-2026-10-22-SUMMARY.md` | `docs/SESSION-2026-10-22-SUMMARY.md` | 旧会话摘要, 当前状态已由 1.4.8/DEV-NOTES §1 取代 | 2026-11-23 |
| `DESIGNS/mockup-fader-detail.png` | `docs/mockup-fader-detail.png` | 无引用的旧相机推子示意图 | 2026-11-23 |

## 已清理的生成垃圾

- `docs/Thumbs.db`(Windows 缩略图缓存, 非文档, 已删除; 不参与版本历史)。

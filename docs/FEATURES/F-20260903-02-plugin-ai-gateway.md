# F-20260903-02 插件 AI 网关(ctx.ai)

> 七问答完(2026-09-03, 用户拍板"先做吧"; 设计结论: 插件不持密钥, 由主体代理复用用户 AI 配置与三层防线)。

## 0. 状态

- 状态: BUILD
- 归属: 主体(插件系统核心, 跨插件能力)
- 目标版本: 下个补丁版
- 关联: DEV-NOTES 条目 96

## 1. 七问(D0)

1. **谁在什么场景下用**: 插件开发者想做 AI 功能(翻译/问答类)而无密钥、无防线能力; 用户只想授权一次并继承自己的 AI 配置与安全设置。
2. **要不要占聊天框**: 不占(结果由插件自行决定是否经 ctx.chatbox 输出, 仍受脏话过滤与限频)。
3. **新配置项**: `plugins.security.aiPolicy = 'allow'`(默认; 枚举 allow/localOnly/off)。AI 端点与密钥复用 `ocrtl.vision`(已有, 不新增键)。安全类: 三层防线(promptDefense/jsonMode/outputSanitize/blockWords)默认 true 由主体强制。
4. **新端点**: 不新增端点 —— 能力经 `/api/plugins/call` 的 ctx.ai.chat 暴露; `POST /api/security`(一级)扩展 aiPolicy 枚举。
5. **新依赖**: 无(内置 fetch; 防线复用 ocrtranslate 已导出的 sanitizeTranslation/DEFAULT_BLOCK_WORDS)。
6. **失败降级**: json_object 失败/400 → 自动重试自由文本; 注入/安全词命中 → 拒绝返回错误; 接口未配置/需密钥/策略拒绝 → 明确错误; 每插件 5 秒节流。
7. **不做什么**: 不做插件自有密钥托管; 不给插件读回 apiBase/apiKey; 不做按 token 计费/配额(只有节流+审计); 不改视觉翻译管线本身。

## 2. 四张契约(D1)

### API 契约
| 能力 | 调用 | 响应 | 错误 |
| --- | --- | --- | --- |
| ctx.ai.chat | `{ task:'translate'\|'chat', text, lang? }` | `{ ok:true, text }` | 未声明任务/策略 off/localOnly 且非本机/未配置/需密钥/节流/注入命中 → throw(经 /api/plugins/call 返回 error) |

### 配置契约
| key | 类型 | 默认值 | 说明 | 老配置缺键时 |
| --- | --- | --- | --- | --- |
| plugins.security.aiPolicy | 'allow'\|'localOnly'\|'off' | allow | 插件 AI 策略: 放行(继承防线)/仅本机接口/全禁 | 整块缺失→默认 |

### 显示契约
- 审批窗: 声明 ai.tasks 的插件橙色显示"AI 能力(使用你的 AI 配置与密钥, 可能产生费用): translate/chat"; **按高危档处理(输入插件名确认)**。
- 安全卡: 第五个下拉"插件AI"(L1)。

### 权限契约(插件)
- `manifest.ai = { "tasks": ["translate", "chat"] }`; 不声明 → ctx.ai 调用即拒绝; 密钥永不进入插件上下文。

## 3. 切片计划(D2)

- [x] 切片 1: permissions(aiPolicy 默认 + auditEvent)+ 新建 aigateway.js
- [x] 切片 2: manager.js ctx.ai + 节流 + aiConfig provider; main.js/config.default/server.js 枚举
- [x] 切片 3: 审批窗 AI 显示 + 高危确认 + 安全卡第五下拉 + i18n ×3
- [x] 切片 4: plugin-check ai 契约 + config-contract aiPolicy 默认档
- [x] 切片 5: 隔离实例验证(本地假 OpenAI 端点)+ 文档

## 4. 验收断言(D3)

- ASSERT: 插件AI策略默认|/api/config|aiPolicy.*allow
- ASSERT: 审批窗AI能力显示|/app.js|permAi
- [ ] 影响面回归(PROCESS-01 §6 矩阵)已勾选
- [ ] 用户在自己实例确认(UI/交互类必填)

## 5. 发布准备(D4)

- [ ] 使用说明.txt(插件章补 AI 能力段; 安全设置补 aiPolicy)
- [ ] 版本说明.txt(下次补丁版)
- [ ] 打包清单: 无新文件
- [ ] pack-audit 通过

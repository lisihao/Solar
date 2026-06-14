# 对话式 AI 整理 — 设计基线（Design Baseline）

**状态：** ✅ v1.0 锁定（四路 4/4 共识 + P0 调研通过，2026-05-21）；**P1 可开工**（见 §10）
**强制级别：** 评审通过后转 MUST
**日期：** 2026-05-21
**作者：** Claude Code
**关联：** [ADR-006](../../decisions/006-conversational-organize.md) · `library/ai-file-organizer` · `library/collections` · AI Ask 流式范式（`ai-ask.service.ts`）
**评审基线版本：** v1.0（P0 调研通过并回写，已锁定；见 §10 + [评审纪要](../2026-05-21-design-review-minutes.md) §6）

> 一句话目标：让书签 / 笔记 / 外部连接内容的整理，**既能一键执行预设动作，也能像聊天一样下自然语言指令，由 AI 边对话边真实改动用户的库**。

---

## 1. 背景与目标

### 现状

- `AIOrganizePanel`（前端）= 一键预设动作：批量打标 / 智能分类 / 主题聚类 / 笔记要点 / 笔记关联 / 图片打标…，每个动作固定、不可对话微调。
- 后端整理能力分散：`ai-file-organizer`（AI 分析建议 analyze→apply）+ `collections.service`（真实写操作：批量打标 / 移动 / 改状态 / 建集合）。
- 用户痛点：只能跑死板的预设，无法表达「把所有 AI 论文归到一个新集合并打 `LLM`/`agent` 标签，已读的别动」这类组合意图。

### 目标

1. 保留并增强「一键整理」（现有模式不回退）。
2. 新增「对话整理」：自然语言指令 → AI 规划 → 调工具真实改动库 → 流式回报做了什么 → 用户可继续追加指令。
3. 覆盖三类内容：**书签、笔记、外部连接**（统一对话界面，按 scope 切换数据源）。

### 非目标（本期不做）

- 不做跨用户 / 团队级整理（仅当前用户自己的库）。
- 不做自动定时整理（仅用户主动触发）。
- **做单步即时撤销**（每个动作卡一键反向回滚，评审 Q2 已定）；不做多步「撤销栈」。破坏性/批量 >20 条执行前预演确认（Q3）。

---

## 2. 范围

| 数据源                         | 读                       | 写（整理动作）                                       | 底层既有能力                                |
| ------------------------------ | ------------------------ | ---------------------------------------------------- | ------------------------------------------- |
| 书签（collections/resources）  | 列集合 / 列条目 / 看标签 | 建集合、批量打标、移动、改读状态、AI 分类建议        | `collections.service` + `ai-file-organizer` |
| 笔记（notes）                  | 列笔记 / 标签            | 打标、归集、要点/关联（复用现有一键能力的底层）      | `notes` 模块                                |
| 外部连接（Notion/GDrive/飞书） | 列已同步内容             | **本期只读 + 归类到集合/知识库**（不回写第三方平台） | 各 integration 同步产物                     |

> 写操作的「破坏性」分级见 §8；外部平台**只读**是硬约束（不回写第三方）。

---

## 3. 架构设计

### 3.1 总体（最大化复用平台 agent 运行时 + 工具框架，不重造轮子）

> 核心原则（评审修订）：**「理解意图 → 选工具 → 执行 → 回应」这套循环平台已有**（`FunctionCallingExecutor`，经 **`ToolFacade.chatWithToolsStream()`** 暴露；⚠️ `executeAgent` 经评审实测是单次 LLM 无工具循环、不可用——见[评审纪要](../2026-05-21-design-review-minutes.md) BLK-1）。organize 不自写循环，只**注册领域工具 + 复用 agent 运行时**。

```
前端「对话整理」面板
   │  POST /library/organize-chat/stream   (SSE)
   ▼
OrganizeChatController (SSE)
   │  转发 agent 的 AgentEvent 流为 SSE
   ▼
OrganizeChatService
   │  ① 准备「库整理 agent」：systemPrompt(scope) + 该 scope 的 organize 工具集
   │  ② 调 ToolFacade.chatWithToolsStream({ systemPrompt, userPrompt, context:AICapabilityContext })
   │     —— 平台 ReAct 循环自己理解意图、决定调哪些工具、多轮执行、产出 AgentEvent 流
   ▼
ToolRegistry / ToolFacade（平台工具框架）
   │  organize 工具 = 标准 ITool，execute() 内薄封装 ↓ 既有服务
   ▼
CollectionsService / AiFileOrganizerService / NotesService（既有写/读，带 userId 鉴权）
```

复用点（= 不造的轮子）：意图理解 + 工具选择 + 多轮执行循环（agent 运行时）、工具注册/执行/定义（ToolFacade）、LLM 调用（engine）、流式（agent AgentEvent → SSE）、代理兜底（ai-ask reconcile 范式）、批量写（collections 既有方法）。

### 3.2 关键决策（ADR 摘要，详见 ADR-006）

| 决策                | 选择（评审修订：max reuse）                                                                                                  | 理由                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 意图理解 + 执行循环 | **复用 `ToolFacade.chatWithToolsStream()`**（内即 `FunctionCallingExecutor`；`executeAgent` 经评审是单次 LLM 不可用，BLK-1） | 平台已有成熟 agent 循环（理解意图→选工具→多轮执行）；自写 tool-loop = 重造轮子。已删 IntentRouter，意图交给 agent |
| 工具                | **实现为标准 `ITool` 注册 `ToolRegistry`，经 `ToolFacade` 执行**                                                             | 复用平台工具框架（注册/执行/FunctionDefinition/权限中间件），不内联 switch                                        |
| 流式                | SSE 转发 agent `AgentEvent` 流 + 代理兜底（`ai-ask-stream` reconcile 范式）                                                  | 复用既有实时 + 抗代理范式                                                                                         |
| 写操作落点          | 工具 `execute()` 薄封装 `CollectionsService` 等**既有方法**（userId 鉴权），不新写 SQL                                       | 复用已测批量写                                                                                                    |

### 3.3 后端模块结构（新建，薄）

```
backend/src/modules/ai-app/library/organize-chat/
├── organize-chat.module.ts        imports: 单一 @/modules/ai-harness/facade（ToolFacade）、CollectionsModule、AiFileOrganizerModule、NotesModule
├── organize-chat.controller.ts    @Post(':scope/stream') SSE；@Throttle；JwtAuthGuard
├── organize-chat.service.ts       组装 agent（systemPrompt + scope 工具集）→ executeAgent → AgentEvent 转 SSE（薄，无自写循环）
├── tools/                         organize ITool 实现（create-collection / tag-items / move-items / set-status / list-* / suggest-classification），onModuleInit 注册到 ToolRegistry
└── dto/organize-chat.dto.ts       { message, scope, conversationHistory, collectionId? }
```

> P0 开工前确认：`executeAgent` 的入参是否支持「按次传入工具子集 + 注入 userId/scope context + 流式 AgentEvent」；若需补一个 harness facade 的薄方法，也属复用而非重造。

### 3.4 工具目录（FunctionDefinition）

| 工具                                    | 入参                                              | 映射                                            | sideEffect |
| --------------------------------------- | ------------------------------------------------- | ----------------------------------------------- | ---------- |
| `list_collections`                      | —                                                 | `getUserCollections(userId)`                    | none       |
| `list_items`                            | `{collectionId?, status?, limit?}`                | `getCollection`/`getCollectionItemsPaginated`   | none       |
| `create_collection`                     | `{name, description?, icon?, color?}`             | `createCollection`                              | idempotent |
| `tag_items`                             | `{itemIds[], tags[], operation:add\|remove\|set}` | `batchUpdateTags`                               | idempotent |
| `move_items`                            | `{itemIds[], targetCollectionId}`                 | `batchMoveItems`                                | idempotent |
| `set_status`                            | `{itemIds[], status}`                             | `batchUpdateStatus`                             | idempotent |
| `suggest_classification`                | `{itemIds?}`                                      | `ai-file-organizer.analyze`（只给建议，不落地） | none       |
| （笔记/外部同形工具，scope 切换数据源） |                                                   | `NotesService` / 同步产物只读                   |            |

> 工具入参全部以 `userId`（从 SSE 鉴权上下文注入，**不信任 LLM 传的 userId**）做行级过滤。

---

## 4. 前端设计

- `AIOrganizePanel` 顶部加模式切换：**一键整理 | 对话整理**（canonical `Tabs`）。
- 「对话整理」= 轻量聊天区（消息流 + 输入框），复用 AI Ask 的流式消费 + **代理兜底对账**（`reconcile`）。
- AI 的工具动作以**结构化卡片**呈现：`已建集合「AI 论文」` / `给 12 条打标 +LLM` / `移动 8 条 → AI 论文`，可点进对应集合。
- **每张动作卡带 `[撤销]` 入口**（Q2）：点击调对应**反向 batch**（move 回原集合 / remove 刚加标签 / 还原状态）。**P2 验收含「动作卡可撤销且库回滚」**。
- 破坏性动作（删除/清空类，本期范围内仅潜在的 set/remove 大批量）→ 执行前 inline 确认（复用全局 `confirm`）。
- 卡片/态/弹层全部走 canonical（标准 22），网格走 `CardGrid`，不自写。

---

## 5. 数据流 / 时序（对话一轮）

```
用户：「把所有 AI 论文归到新集合『AI 论文』并打标 LLM，已读的别动」
 → status: planning
 → tool: list_items({ status:'unread' })           → 18 条未读（已读天然排除＝「已读的别动」）
 → tool: create_collection({ name:'AI 论文' })      → 新集合 c_ai
 → agent 从 18 条筛出 AI 论文相关 12 条（itemIds 均 ⊆ 上一步返回集 → BLK-3 服务端校验）
 → 12 条 ≤20 直接执行；若 >20 先 emit intent_preview 等用户确认（Q3）
 → tool: move_items({ itemIds:[12 条], targetCollectionId:'c_ai' })
 → tool: tag_items({ itemIds:[12 条], tags:['LLM'], operation:'add' })
 → chunk(总结：建集合 + 移 12 条 + 打标，已读 0 触碰) → done
 每张动作卡带 [撤销]（反向 batch，Q2）；流被代理掐断 → GET 对账恢复（同 ai-ask）

> 该样例证明工具粒度可表达「带条件过滤的组合意图」：`list_items.status` 过滤 + agent 选子集 + 写工具只作用于该子集（且受 itemIds⊆白名单校验）。
```

---

## 6. 安全 / 权限 / 破坏性操作

- 全部工具调用强制注入服务端 `userId`，行级过滤；LLM 不能越权改他人数据。
- 破坏性分级（`sideEffect`）：本期以 `idempotent` 为主；任何「批量 set 覆盖标签 / 移动大批量 / 删除」在前端执行前 `confirm`。
- 输入：`message` class-validator 校验；`scope` 枚举；`itemIds` 服务端校验归属。
- 配额：复用 credits（整理 = 一次 LLM 调用 + 工具，计费同 ai-ask `operationType: 'organize'`）。

---

## 7. 分阶段交付 + 验收标准（强成功标准）

| 阶段                       | 内容                                                   | 验收（可独立验证）                                                                                        |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **P1 后端框架 + 书签工具** | module/controller/service/tools；书签 6 工具；SSE+对账 | 单测：tool-loop 给定 mock chat 返回 toolCalls → 正确执行 + 产出 done；`npx tsc` 0；一条指令端到端改动书签 |
| **P2 前端对话模式**        | 面板 Tabs + 聊天区 + 工具卡片 + 代理兜底               | 真机：选书签→对话「建集合并打标」→看到工具卡片 + 库实际变化；audit/lint 0                                 |
| **P3 笔记 + 外部**         | NotesService 工具 + 外部只读归类                       | 三个 scope 都能对话整理；外部不回写第三方（断言无写第三方调用）                                           |
| **P4 加固**                | 破坏性确认、配额、错误路径、i18n                       | 交付前自检清单全过                                                                                        |

---

### 7.1 落地进度（backfill）

| 波次                                                                              | 状态 | commit      |
| --------------------------------------------------------------------------------- | ---- | ----------- |
| P1-1 数据层（OrganizeSession/Message + 迁移）                                     | ✅   | `7b931ed40` |
| P1-2 工具层（6 书签 ITool，userId 鉴权 + ≤100 上限）                              | ✅   | `99bf649a7` |
| P1-3 集成核心（service chatWithToolsStream + SSE controller + module + app 注册） | ✅   | `5b0503124` |
| P1-4 测试（13 用例：鉴权/上限/SSE 转换/扣费/余额闸）                              | ✅   | `fe78c4e60` |
| P2-1 前端 SSE 客户端（streamOrganizeMessage + 代理对账）                          | ✅   | `08c79dfc2` |
| P2-2 对话模式（面板 Tab + OrganizeChatMode + 工具动作 chip + EmptyState）         | ✅   | `4bcf75b1e` |

**P1 后端 + P2 前端（书签）功能完成**——对话整理书签端到端可用。每波 tsc 0 + verify:arch 100/100 + audit 14/14 硬零 + pre-push 全闸门绿。
待运行时实测：BLK-6 `consumeCredits` token 真扣费 + 真机 E2E（需部署后核账/跑一条指令）。
剩余：**单步撤销**（Q2，需后端 reverse-batch 端点）· **破坏性/批量>20 预演确认**（Q3）· **P3** 笔记/外部工具 · **P4** i18n/错误路径加固。

---

## 8. 风险与缓解

| 风险                 | 缓解                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| LLM 误改大批量数据   | userId 行级过滤 + 破坏性动作前端确认 + 工具入参服务端校验归属          |
| 条目过多撑爆 context | `list_items` 分页 + 默认只取必要字段（id/title/tags/collection）+ 上限 |
| 代理掐断流           | 复用 ai-ask 对账兜底（已验证范式）                                     |
| tool-loop 死循环     | 最大轮次上限 + 每轮无进展即终止                                        |
| 与一键模式重复       | 一键 = 对话的「预设快捷指令」，底层共用工具，不双写逻辑                |

---

## 9. 评审清单 / 待确认

- [ ] 破坏性动作清单与确认粒度（逐条 vs 批量一次确认）是否符合预期？
- [ ] 外部连接「只读 + 归类到本地集合/知识库」是否够用，还是需要回写第三方（明确不做）？
- [ ] 计费：整理一轮按 1 次 ai-ask 计，还是按工具调用数计？
- [ ] 会话持久化：对话整理是否复用 `AskSession` 表，还是独立 `OrganizeSession`？（建议独立，避免污染 ai-ask 会话列表）
- [ ] tool-loop 最大轮次 N（建议 6）。

---

## 10. P0 技术调研结论（2026-05-21，✅ 通过 → 锁 v1.0）

P0 读码核验三门禁，均有可落地答案：

| 门禁                   | 结论                  | 落地方式（代码锚点）                                                                                                                                                                                                             |
| ---------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLK-3a 工具隔离        | ✅ 平台已内建         | organize ITool 注册全局 + DB `ToolConfig.allowedRoles:['organize-agent']`；调用传 `context.roleId='organize-agent'`，`AICapabilityResolver.resolveToolsForAgent` 自动过滤（`ai-capability-resolver.service.ts:104-116/709-723`） |
| BLK-3b userId 链路     | ✅ 100% 打通          | `AICapabilityContext.userId` → `function-calling-executor.ts:1192` `ToolContext.userId` → `tool.execute(input, ctx)`。工具内用 `ctx.userId` 调 collections 行级过滤，安全门禁过                                                  |
| BLK-4 会话历史         | ⚠️ v1 拼 systemPrompt | `chatWithToolsStream` 无 history 入参；v1 把历史拼进 systemPrompt（同 ai-ask `buildSystemPromptWithContext`，零 facade 改动）；后期可薄扩展 `priorMessages`                                                                      |
| BLK-6 modelConfig/计费 | ✅ 复用 ai-ask        | `getModelConfig`（`ai-ask.service.ts:1381` 抄）+ `BillingContext.run({moduleType:'organize-chat'})` + 入口 `creditsService.checkBalance`。**P1 需实测 chatWithToolsStream 的 token 真扣费**（不确定项，P1 验证）                 |

**结论：P0 通过，#1 解锁 P1。** P1 起步清单：① OrganizeSession Prisma model + 手写迁移（Q4 已批）② organize-chat 模块（service 抄 ai-ask modelConfig/billing/reconcile + ToolFacade.chatWithToolsStream）③ 书签 6 个 ITool（薄封装 collections，注册 + allowedRoles）④ SSE controller。验收见 §7 P1（含「BLK-6 token 真扣费」实测项）。

```

```

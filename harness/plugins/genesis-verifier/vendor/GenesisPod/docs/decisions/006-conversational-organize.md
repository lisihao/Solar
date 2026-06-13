# 006. 对话式 AI 整理 - ChatFacade tool-loop + 薄封装既有写操作

**Date**: 2026-05-21
**Status**: ✅ Accepted + **v1.0 锁定**（四路 4/4 共识 + P0 调研通过，2026-05-21）。P0 三门禁 BLK-3/4/6 均有可落地答案（工具隔离=roleId+allowedRoles、userId 链路 100% 通、历史 v1 拼 systemPrompt、modelConfig/计费复用 ai-ask）→ **P1 解锁**（见设计 §10）
**评审纪要**: [features/2026-05-21-design-review-minutes.md](../features/2026-05-21-design-review-minutes.md)
**关联设计文档**: [features/library/conversational-organize-design.md](../features/library/conversational-organize-design.md)

## 背景

`library` 现有「一键整理」（`AIOrganizePanel` + `ai-file-organizer` + `collections` 批量写）只能跑死板预设，无法表达组合意图（"把所有 AI 论文归一个新集合并打标，已读的别动"）。需新增「对话整理」：自然语言指令 → AI 边对话边真实改动书签/笔记/外部内容。一键模式保留不回退。

## 决策（2026-05-21 评审修订：最大化复用平台能力，不重复造轮子）

1. **复用平台 ReAct 工具循环（评审订正：原写 `executeAgent` 是认错 API）**：用 `ToolFacade.chatWithToolsStream()`（内即 `FunctionCallingExecutor.executeWithContext`：理解意图 → 选工具 → 多轮执行 → 回应，产 `AsyncGenerator<AgentEvent>`，AI Ask 已在用）跑「库整理 agent」。
   - **不**自写 tool-loop；意图交给该循环里的 LLM。
   - ⚠️ `executeAgent()` 经评审实测 = `AgentExecutorService.executeTask`（单次 LLM、无工具循环、非流式、无 `tools` 入参），**不可用于对话整理**——见评审纪要 BLK-1。
2. **单一 facade 入口 + 平台工具框架**：organize-chat（ai-app）只 `import @/modules/ai-harness/facade`（ToolFacade/AiChatService/ITool/ToolRegistry/ToolContext/AgentEvent 全在此 re-export，比「同时调 harness+engine」更合规）。organize 工具实现为标准 `ITool`、薄封装 `CollectionsService`/`AiFileOrganizerService`/`NotesService` **既有方法**，**不重写 SQL**。
   - **P0 必答（BLK-3）**：`chatWithToolsStream` 按 `AICapabilityContext` 解析工具、无「按次传子集」入参 → 需定 organize 工具如何只对本 agent 可见（专用 `roleId`/`domain` + resolver role 过滤）+ `userId` 到 `ToolContext.userId` 的完整传递链路（否则行级过滤是虚假保证）。**P0 未答不得进 P1。**
3. **强权限**：所有工具调用注入服务端 `userId` 做行级过滤，不信任 LLM 传的 id；破坏性动作前端 `confirm`；外部连接**只读 + 归类到本地**，不回写第三方。
4. **流式**：SSE（同 AI Ask）消费 agent 的 `AgentEvent` 流；+ 代理掐断对账兜底（复用已立 `ai-ask-stream` reconcile 范式）。
5. **会话**：独立 `OrganizeSession`（不复用 `AskSession`，避免污染 ai-ask 会话列表）。

> 原 v0.1 决策（薄 tool-loop + 不进 harness/ToolRegistry）经评审推翻：违背「最大化复用平台能力」。改为复用 `executeAgent` + `ToolFacade`。

## 范围 / 顺序

- 覆盖书签 + 笔记 + 外部连接（统一对话界面，scope 切数据源）。
- 用户已定：**本特性先于 [ADR-007] Agent Teams 迁移**。

## 影响

- 新增后端模块 `organize-chat` + 前端面板「对话整理」Tab。
- 0 破坏：一键模式与既有整理能力不变；对话模式底层共用同一批写操作。

## 待评审（详见设计文档 §9）

破坏性确认粒度 / 计费口径（按轮 vs 按工具）/ tool-loop 轮次上限 / 外部只读边界。

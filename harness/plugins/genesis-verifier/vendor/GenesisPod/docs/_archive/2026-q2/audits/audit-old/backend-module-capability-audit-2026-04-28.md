# Backend Module Capability Audit — 2026-04-28

> 专项审计：后端各模块**能力盘点 + 归属审视 + 调整建议**。
> 区别于常规 12 维度合规扫描，本次聚焦"模块归属与能力归并"维度。
> 审计员：arch-auditor sub-agent
> 审计基准：72 个源文件实读 + 31 次 import-graph grep。结论均有证据，未读不评。

---

## 1. 执行摘要

后端模块体系跨 **6 个顶层分层**（ai-infra、ai-engine、ai-harness、ai-app、open-api、intent-gateway），约 1803 个生产 TS 文件、1026 个测试文件。最近的 PR-X13~X25 重构已成功完成 HTTP 控制器搬迁到 open-api、领域 Facade 搬迁到 ai-harness、僵尸模块清理。

**核心结论：架构整体健康，存在 1 个未文档化的结构性歧义和若干归属问题。**

### Top 5 调整建议

1. **P0 — ai-harness 缺乏正式分层定位**
   CLAUDE.md 描述 5 层架构提到"ai-engine/runtime（PR 7 已合并）"，但实际仓库里是 `ai-harness`。引擎与应用之间这一层是**真实存在且必要**的，但没有官方文档。应正式定位为 **L2.5 "Agent Runtime Harness"** 并更新文档。

2. **P1 — ai-app/byok 控制器穿透 ai-engine/credentials 内部**
   byok 模块的 5 个控制器直接 `import { KeyAssignmentsService } from "../../ai-engine/credentials/key-assignments/key-assignments.service"` 等路径，绕过 facade。这是 ai-app 中最严重的 Facade 边界违规。

3. **P1 — ai-app/explore 错位**
   实际能力是 YouTube 字幕抓取 + 转录文 PDF 生成，这是**内容获取基础设施**，不是 AI 应用。应下沉到 `common/` 或 `ai-engine/content/`。

4. **P1 — 两个 SkillRegistry 并存且同名**
   `ai-engine/skills/registry/SkillRegistry`（CRUD 风格、按 domain 索引）和 `ai-harness/kernel/skills/SkillRegistry`（SKILL.md frontmatter 风格、按 name 索引）共存，接口完全不同但类名相同，造成混淆。harness 版本是新的（SOTA），但都没有"正典化"标记。

5. **P2 — ai-app/management（ingestion + workspace）不属于 AI App**
   数据采集调度和 workspace 管理是平台基础能力，不依赖 AI，也不被任何其他 ai-app 消费。

---

## 2. 分层模块矩阵

### L1 ai-infra（14 子域）

| 子域             | 能力                                               | 标签        | 备注                                                                                         |
| ---------------- | -------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| auth             | JWT/Google OAuth、Passport 策略                    | ✅ 归属正确 | 全局 AuthModule                                                                              |
| credits          | 积分余额、计费、签到                               | ✅ 归属正确 | 大部分 AI App 都消费                                                                         |
| email            | SMTP 事务邮件                                      | ✅ 归属正确 | 底层基础设施                                                                                 |
| encryption       | AES-256-CBC 密钥加密                               | ✅ 归属正确 | 同时被 ai-engine/credentials 和 ai-infra/secrets 使用                                        |
| monitoring       | AI 指标、错误追踪、健康检查、数据保留              | ✅ 归属正确 | @Global                                                                                      |
| notifications    | 应用内通知推送                                     | ✅ 归属正确 | 被 research、topic-insights 消费                                                             |
| release          | Git changelog + AI 生成 release notes + 全用户推送 | ⚠️ 职责过载 | 把基础设施（通知发送）和产品业务（AI 生成 changelog）混在一起；AI 生成那部分应上提           |
| secrets          | 平台密钥库（AES 加密、版本化、访问日志）           | ✅ 归属正确 | engine 和多个 app 消费                                                                       |
| settings         | 全局系统配置（管理员可编辑）                       | ✅ 归属正确 | @Global                                                                                      |
| storage          | R2/本地存储、topic 报告存储                        | ✅ 归属正确 | 多 app 共用                                                                                  |
| table-management | 管理员 DB 表清空/统计                              | 🏷️ 命名误导 | 名字叫 "table-management" 实际是 admin 维护工具，应改名为 `db-admin` 或迁到 `open-api/admin` |
| abstractions     | DI Token：AI_CHAT_TOKEN、AI_OBSERVABILITY_TOKEN    | ✅ 归属正确 | 解耦 L1 与 L2 具体类                                                                         |
| facade           | 重导出 ai-infra 公共服务                           | ✅ 归属正确 | 强制层边界                                                                                   |

### L2 ai-engine（12 子域）

| 子域             | 能力                                                                                   | 标签          | 备注                                                              |
| ---------------- | -------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| llm              | LLM 适配器（UniversalLLMAdapter）、chat、模型选举、预算、降级、prompt 适配             | ✅ 归属正确   | LLM 核心                                                          |
| tools            | 工具注册表、工具分类（信息/搜索/分析/生成/政策）、并发                                 | ✅ 归属正确   | registry 是框架，categories 是实现                                |
| skills           | CRUD 风格 SkillRegistry、SkillBuilder、Sandbox、Content、Analytics、Loader             | 🔁 重复存在   | 与 ai-harness/kernel/skills 不同接口同名（详见 3e）               |
| planning         | 上下文压缩、任务分解、Agent 执行、token 预算、查询循环、反思、AutoDream、DAG 执行器    | ✅ 归属正确   | 通用编排基元                                                      |
| safety           | Guardrails、断路器、能力守卫、质量评估、约束引擎                                       | ✅ 归属正确   | 横切安全层                                                        |
| knowledge        | RAG（embedding/vector/chunk/pipeline）、search、memory store、evidence                 | ✅ 归属正确   | 知识能力核心                                                      |
| credentials      | BYOK 基础设施：用户 API key、模型配置、可分发密钥池、key resolver                      | 🔀 部分应迁移 | 服务本身位置正确（基础设施），但 ai-app/byok 控制器穿透其内部路径 |
| content          | 图像匹配、内容抓取（YouTube/URL）、内容特征分析                                        | ✅ 归属正确   | 内容处理基元                                                      |
| core             | 共享类型（agent/context types）、工具类（multi-key manager、BaseRegistry）             | ✅ 归属正确   | 基础类型                                                          |
| abstractions     | DI port token（AGENT_REGISTRY_PORT、MCP_PROVIDER_PORT 等）                             | ✅ 归属正确   | 反向依赖隔离                                                      |
| facade           | engine 公共桶：导出 SkillRegistry、ToolRegistry、AiChatService、planning/safety/RAG 等 | ✅ 归属正确   | 现在主要透传 harness 类型                                         |
| tools/deprecated | Python/JS/Shell executor 工具（因 RCE 风险禁用）                                       | 💀 疑似作废   | 0 消费者（grep 确认）。已被 ContainerExecutorTool 替代，可删可留  |

### L2.5 ai-harness（**未文档化的分层**）

> 这一层处于 ai-engine（基元）和 ai-app（业务）之间，承载"Agent 运行时脚手架"。CLAUDE.md 中"ai-engine/runtime"的描述已过时——真实模块叫 `ai-harness`。这个层是**正确的**、**必要的**，只是文档没更新。

| 子域       | 能力                                                                                                                                                                                      | 标签        | 备注                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------- |
| kernel     | HarnessedAgent 规范、AgentFactory、SpecAgentRegistry、HookRegistry、SkillRegistry（SKILL.md 风格）、SkillLoader/Activator、DX 工具、learning                                              | ✅ 归属正确 | Agent 脚手架基元        |
| execution  | ReActLoop、PlanActLoop、ReflexionLoop、LeaderWorkerLoop、LoopRegistry、ToolInvoker、LlmExecutor、context（compactor/pruner/manager）                                                      | ✅ 归属正确 | Agent 执行引擎          |
| memory     | 向量存储（InMemory/Prisma）、MemoryAutoIndexer、CheckpointService、ProcessMemoryManager、HierarchicalMemoryCascade                                                                        | ✅ 归属正确 | Agent 记忆基础设施      |
| process    | ProcessManager、ProcessSupervisor、SubagentSpawner、KernelScheduler、CollaborationModule（review/todo/voting/handoff）、AgentRegistry（运行时）、HandoffService                           | ✅ 归属正确 | 多 Agent 进程管理       |
| protocol   | EventBus/DomainEventBus/Journal/CheckpointManager、IPC、Realtime（WS gateway）、MCP（Manager/ClientRegistry/Relay）、A2A                                                                  | ✅ 归属正确 | 通信协议                |
| governance | TraceCollector、AiObservability、LlmTracing、EvalPipeline、SessionLatencyTracker、ConstraintEnforcement、CostController、RateLimiter、ResourceManager、Judge/verifiers、HealthCheckRunner | ✅ 归属正确 | 治理与可观测            |
| runtime    | TeamsModule（TeamRegistry/RoleRegistry/TeamFactory/MissionOrchestrator/TeamsService）、MissionExecutor、KernelApi、BillingRuntimeEnvAdapter、judge-primitives                             | ✅ 归属正确 | 高层运行时编排          |
| facade     | ai-app 唯一入口：重导出 7 个子域 + AIFacade/ChatFacade/RAGFacade/AgentFacade/TeamFacade/ToolFacade                                                                                        | ✅ 归属正确 | ai-app 应该走的统一入口 |

**ai-harness vs CLAUDE.md 验证**：

- `ai-engine/ai-engine.module.ts` 的注释明确写："★ HarnessModule / RuntimeModule / RealtimeModule + CollaborationModule 由 app.module.ts / harness.module.ts 直接装配。AI Engine 不再反向依赖 ai-harness."
- `ai-engine/runtime` 目录**不存在**。CLAUDE.md 写的"全部能力归并到 ai-engine/runtime"是错误描述。
- 实际迁移到了 `ai-harness/runtime`。

### L3 ai-app（17 子域 + library 子组）

| 子域                                        | 能力                                                                                                             | 标签        | 备注                                                                                                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| research                                    | 多步深度研究、辩论引擎、研究项目 CRUD、迭代循环、研究记忆、评估                                                  | ✅ 归属正确 | 旗舰 AI App                                                                                                                                                                                                                                    |
| topic-insights                              | 话题维度研究、mission 编排、报告合成、搜索流水线（8 个适配器）、质量门                                           | ✅ 归属正确 | research 衍生应用                                                                                                                                                                                                                              |
| teams                                       | AI 辩论/协作、话题管理、mission 执行、WebSocket；通过 `AiTeamsModule` 被 planning 复用                           | ✅ 归属正确 | planning 跨 app 依赖是已知 P3 债务                                                                                                                                                                                                             |
| writing                                     | 长文本（小说）多 agent 协作（5 角色）、bible 管理、质量流水线、并行编排、一致性引擎                              | ✅ 归属正确 | 业务 AI App                                                                                                                                                                                                                                    |
| office                                      | PPT/slides 生成（基于 skills 流水线）、内容分析、合成；通过 DI token 跨 app 引用 research/writing/topic-insights | ✅ 归属正确 | 跨 app 用 contracts 接口契约（正确模式）                                                                                                                                                                                                       |
| ask                                         | AI 多模型对话（流式）、function calling                                                                          | ✅ 归属正确 | 轻量 AI App                                                                                                                                                                                                                                    |
| image                                       | AI 图像生成（Imagen4 等）、brand kit、信息图、analytics                                                          | ✅ 归属正确 | 用 forwardRef 解循环依赖                                                                                                                                                                                                                       |
| social                                      | 微信/小红书内容生成、社交发布、基于 MCP 的平台适配器                                                             | ✅ 归属正确 | 业务 AI App                                                                                                                                                                                                                                    |
| simulation                                  | 多角色辩论模拟、场景引擎                                                                                         | ✅ 归属正确 | 小而内聚                                                                                                                                                                                                                                       |
| planning                                    | AI 项目规划（基于 Teams 基础设施）                                                                               | ⚠️ 职责过载 | 仅 1 controller + 2 service + 1 team config，重度依赖 AiTeamsModule。考虑：(a) team config 上提到 harness/runtime/teams；(b) 合并到 teams 模块                                                                                                 |
| agent-playground                            | SOTA agent demo：leader-worker mission、9 个角色服务、mission 状态机、replay buffer                              | 🔀 应迁移   | 不是业务 app，是 ai-harness 能力的开发演示 + 集成测试场。应迁到 `dev-tools/` 或独立的 dev-harness。MissionEventBuffer 只被自己消费                                                                                                             |
| library/rag                                 | 业务 RAG：文档处理、嵌入、知识库管理、Google Drive 集成                                                          | ✅ 归属正确 | 在 ai-engine/knowledge/rag 之上的业务层                                                                                                                                                                                                        |
| library/knowledge-graph                     | PostgreSQL 实体关系图                                                                                            | ✅ 归属正确 | 业务能力                                                                                                                                                                                                                                       |
| library/collections, notes, recommendations | 用户内容库管理                                                                                                   | ✅ 归属正确 | 业务能力                                                                                                                                                                                                                                       |
| library/integrations                        | 飞书/Notion/Google Drive 同步                                                                                    | ✅ 归属正确 | 第三方集成                                                                                                                                                                                                                                     |
| library/ai-file-organizer                   | AI 文件整理                                                                                                      | ✅ 归属正确 |                                                                                                                                                                                                                                                |
| explore                                     | YouTube 字幕抓取 + PDF 导出 + 视频管理                                                                           | ⬇️ 应下沉   | 实际能力是 `ai-engine/content/fetch/youtube.service.ts` 的薄包装，被 `common/content-processing` 和 `ai-app/social` 引用——已经是事实上的"共享基础设施"。应折叠到 `ai-engine/content` 或 `common/`                                              |
| management/ingestion                        | 数据源 CRUD、爬虫、采集任务调度、数据质量监控                                                                    | 🔀 应迁移   | 平台数据采集基础设施，不是 AI App。应迁到独立 `data-ingestion/` 或 ai-infra                                                                                                                                                                    |
| management/workspace                        | Workspace CRUD、任务管理、AI 辅助报告模板生成                                                                    | ⚠️ 职责过载 | Workspace 管理是平台关注点；混入了 AI 模板生成。模板生成依赖 ai-harness ChatFacade                                                                                                                                                             |
| byok                                        | 用户级 BYOK key/模型配置 controller                                                                              | 🔀 应迁移   | controller 在 app 层概念正确（用户端点），但 5 个 controller 直接 import `ai-engine/credentials/*/service` 和 `ai-engine/llm/services/*`。**ai-app 中最严重的 Facade 违规**。修法：(a) 迁到 `open-api/byok-user`；(b) 给 credentials 加 facade |
| contracts/interfaces                        | DI token 定义 + 跨 app 数据导出接口                                                                              | ✅ 归属正确 | 干净的避免直接服务依赖的模式                                                                                                                                                                                                                   |
| contracts/report-template                   | 报告写作标准常量 + 后处理流水线                                                                                  | ✅ 归属正确 | 共享工具，正确作为跨 app 契约                                                                                                                                                                                                                  |
| feedback                                    | 用户反馈采集、AI 分诊（去重 + LLM 分类）、截屏分析、GitHub issue 创建                                            | ⚠️ 职责过载 | 把用户端反馈（app）和运营 AI 分诊（ops 工具）混在一起。GitHub 集成 + 分诊属于运营，不是用户特性                                                                                                                                                |

### L4 open-api（11 子域）

| 子域       | 能力                                                                                                                                        | 标签        | 备注                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------- |
| admin      | 15 个 admin 控制器（用户、AI Teams、日志、权限、计费、监控、缓存、agents、研究模板、审批、kernel、模型推荐、observability、harness 检查器） | ✅ 归属正确 | 管理后台                     |
| ai-core    | AI 模型/设置管理 controller + service                                                                                                       | ✅ 归属正确 | PR-X6 从 ai-engine 迁出      |
| agents-api | Agent 列表/执行端点                                                                                                                         | ✅ 归属正确 | 外部 agent 调用              |
| mcp-server | 完整 MCP server（tools/resources/prompts/streaming/sessions）                                                                               | ✅ 归属正确 | L4 暴露 L2-L3                |
| mcp-admin  | 外部 MCP server 管理                                                                                                                        | ✅ 归属正确 |                              |
| public-api | 外部 REST API（MCP key 认证）                                                                                                               | ✅ 归属正确 | 通过 AIFacade 委派           |
| a2a-api    | Agent-to-Agent 协议 controller                                                                                                              | ✅ 归属正确 | PR-X17 已迁移                |
| byok-admin | distributable keys / assignments / requests / dashboard 的 admin 控制器                                                                     | ✅ 归属正确 | 与 user-facing byok 正确分离 |
| skills-api | Skills CRUD/列表                                                                                                                            | ✅ 归属正确 | PR-X16 从 ai-engine 迁出     |
| teams-api  | Teams controller                                                                                                                            | ✅ 归属正确 | PR-X16 从 ai-harness 迁出    |
| webhooks   | webhook 订阅 + 事件分发                                                                                                                     | ✅ 归属正确 |                              |

**Open-API 覆盖度分析**：

- ai-app 大部分模块（research、topic-insights、teams、writing、office、ask、image、social、simulation、planning、library/_、explore、management/_）都自带 controller 直接通过自己的 module 暴露，**没有走 open-api**。这是**有意的设计**——这些是内部应用端点，open-api 层专指对外暴露（MCP / Public REST / A2A / Webhooks / Admin）。
- 没有发现孤立的 open-api 模块。

### L5 intent-gateway（1 子域）

| 模块           | 能力                                               | 标签        | 备注                                                                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| intent-gateway | IntentRouterService 包装，将文本意图路由到 AI 模块 | 💀 疑似作废 | **整个模块零消费者**（grep 确认）。`IntentGatewayService`、`IntentGatewayModule` 在 `intent-gateway/` 之外没有任何 import。模块自己头注释标 "L6"（与 CLAUDE.md L5 矛盾）。底层 `IntentRouterService` 在 `ai-engine/planning` 是真实在用的，但这层 gateway 包装是死代码 |

---

## 3. 专项问题深度分析

### 3a. ai-harness vs ai-engine/runtime 错位

**结论：ai-harness 是合理的、独立的分层——不是命名错误，但缺乏文档。**

- 证据：`ai-engine/ai-engine.module.ts` 注释明确："HarnessModule 由 app.module.ts / harness.module.ts 直接装配，AI Engine 不再反向依赖 ai-harness。"
- CLAUDE.md 仍说 "ai-kernel 已彻底删除，全部能力归并到 ai-engine/runtime（PR 7）"——**事实错误**。`ai-engine/runtime` 不存在，迁移目标是 `ai-harness/runtime`。
- ai-harness 正确处于 engine 与 app 之间：编排 engine 能力（ReActLoop 用 engine 的 AiChatService + ToolRegistry），engine 不知道 harness。
- 这一层承担：agent loop 执行、多 agent 进程管理、checkpoint/memory、协议（MCP/A2A/WS）、治理可观测、ai-app 用的统一 AIFacade。

**建议定位：L2.5 "Agent Runtime Harness"**——位于 L2（AI Engine 基元）和 L3（AI App 业务）之间。

**动作**：更新 CLAUDE.md，把 ai-harness 写入官方分层。**代码无需变更**。

### 3b. Planning 边界（ai-engine/planning vs ai-app/planning）

**结论：边界清晰，但存在已知技术债。**

- `ai-engine/planning`：通用编排基元（ContextCompression、TaskPlanner、TokenBudget、QueryLoop、DAGExecutor、AgentExecutor、AdaptivePlanner、AutoDream）。框架级。
- `ai-app/planning`：单一业务用例（AI 辅助项目规划，编排 team 辩论产出规划文档）。导入 `AiTeamsModule` 当基础设施。

`ai-app/planning → ai-app/teams` 的依赖是已记录的 P3 债务。模块本身很薄（1 controller + 2 service + 1 team config）。位置上 ai-app 是对的，但跨 app 耦合应该解决：(a) 把 planning team config 上提到 harness/runtime/teams；(b) 合并 planning 到 teams。

### 3c. Teams 三层关系

三个都叫 "teams" 的组件：

1. **`ai-harness/runtime/teams`** — TeamRegistry、RoleRegistry、TeamFactory、MissionOrchestrator、TeamsService。**Teams 框架**——配置 team 拓扑、管理角色分配、编排 mission。L2.5。
2. **`ai-app/teams`** — AiTeamsModule，含辩论机制、话题管理、WebSocket gateway、实时协作、长内容集成。**辩论产品**，建立在框架之上。L3。
3. **`open-api/teams-api`** — 单一 TeamsController（PR-X16 从 ai-harness 迁来）。L4。

**结论：分层正确**。三个组件确实是不同抽象层。命名重叠会让人困惑但分离是健康的。

### 3d. BYOK 边界（ai-app/byok vs open-api/byok-admin vs ai-engine/credentials）

**结论：结构性切分正确，但 ai-app/byok 有 facade 违规。**

- `ai-engine/credentials`：基础设施（加密存储、key 校验、resolver、可分发密钥池）。L2 正确。
- `ai-app/byok`：用户端控制器（个人 API key CRUD、模型发现、auto-configure）。概念上 L3 正确。**但**控制器直接 `import` engine 内部路径：
  - 证据：`byok/key-assignments.controller.ts:4: import { KeyAssignmentsService } from "../../ai-engine/credentials/key-assignments/key-assignments.service"`
  - 证据：`byok/user-models.controller.ts:14: import { AiModelDiscoveryService } from "../../ai-engine/llm/services/ai-model-discovery.service"`
- `open-api/byok-admin`：分发 key 池管理的 admin 控制器。L4 正确。

**与 ai-engine/credentials 重叠**：无功能重叠。服务在 engine，控制器分别在 ai-app（用户端）和 open-api（admin 端）。

**修复**：ai-app/byok 控制器应通过 harness facade 或模块系统消费 credentials 服务，不要走直接路径 import。

### 3e. Skills 跨层

**存在 4 个不同的 "skills" 概念**：

1. **`ai-engine/skills`**：CRUD 风格 skill 系统：ISkill 接口（layer/domain/tags）、SkillRegistry（按 domain 索引）、SkillBuilder、SkillContent（DB-backed）、SkillLoader、SkillSandbox。被 skills-api 用于外部 skill 管理。
2. **`ai-harness/kernel/skills`**：SKILL.md 运行时系统：ISkill（frontmatter + instructions）、SkillRegistry（按 name 索引）、SkillLoader（解析 .md）、SkillActivator。被 HarnessModule 用于 ReActLoop 中激活指令包。
3. **`ai-app/*/skills/` 目录下的 .skill.md**：在 research、writing、topic-insights、office/slides 中。是 SKILL.md 指令文件，启动时通过 `PromptSkillBridge.registerDomain()` 注册。**是内容不是代码**。位置正确。
4. **`ai-engine/skills/runtime`（PromptSkillBridge）**：桥接器，启动时把各 domain 的 .skill.md 读入 `ai-engine/skills/registry`。

**重复问题**：两个 `SkillRegistry` 类同名但接口不同。harness 那个（SKILL.md 风格）是新的，被 HarnessModule 用。engine 那个（CRUD 风格）被 skills-api 用。承担不同职责但同名，造成混淆。

**建议**：把 harness 那个改名为 `SkillMdRegistry` 或 `InstructionRegistry`，明确区分。无功能改动。

### 3f. ai-app 各模块下的 agents/

各 ai-app 模块的 agents 子目录（research/agents、teams/agents、image/agents、simulation/agents、writing/agents、office/agents、topic-insights/agents）定义领域特定 agent。**位置正确**。它们继承 harness 基类（BaseAgent、PlanBasedAgent），在 `onModuleInit` 中通过 `AgentRegistry` 注册。

**没有可下沉的共性**：research agents 需要 research-specific context，writing agents 需要 writing-specific context……harness 基类已经提供了共享的执行框架。

### 3g. Research Memory vs Harness Memory

- `ai-app/research/memory/ResearchMemoryService`：research 专属——session 后总结教训、查历史 research 上下文、保存策略有效性。**领域特定的跨 session 学习**。位置正确。
- `ai-harness/memory`：基础设施记忆——working memory（ProcessMemoryManager、HierarchicalMemoryCascade）、向量存储、checkpoint。**框架级进程内记忆**。位置正确。

**无冲突**：不同用途。

### 3h. Prompts 分布

- `ai-engine/llm/prompts`：底层 prompt 模板和 prompt registry。框架。
- `ai-app/ask/prompts`、`office/prompts`、`social/prompts`、`topic-insights/prompts`：各业务 domain 特定 prompt。
- `ai-app/research/skills/*.skill.md`：research 指令文件（作为 SKILL.md 处理）。

**业务 prompt 留在 ai-app 是对的**。Prompt 框架（registry、adaptation）在 engine。无需下沉。

### 3i. ai-infra/secrets vs ai-engine/credentials

**边界清晰，无重复**：

- `ai-infra/secrets`：**平台级密钥库**。存任意命名密钥（API key、DB URL 等）给平台管理员用。`Secret` Prisma model，含版本、访问日志、分类标签。被 ai-app/feedback（GitHub token）、MCPServerModule（MCP API key）等消费。
- `ai-engine/credentials`：**用户级 BYOK 凭证**。每用户的 LLM provider API key、模型配置、共享访问的可分发密钥池。`UserApiKey`、`UserModelConfig`、`DistributableKeyPool` model。

两者都用 `EncryptionService`（来自 `ai-infra/encryption`）。这是对的：加密是共享基础设施。无重复实现。

### 3j. intent-gateway 状态

**零消费者证据**：

```bash
grep -r "IntentGatewayService\|IntentGatewayModule" backend/src --include="*.ts" -l | grep -v "intent-gateway"
# → (空)
```

`IntentGatewayModule` 导出 `IntentGatewayService`。**整个代码库无任何 import**。模块头注释标 "L6"——与 CLAUDE.md 的 L5 矛盾。底层 `IntentRouterService`（在 `ai-engine/planning`）是真在用的，但这层 gateway 包装是**死代码**。

### 3k. open-api 完整性

ai-app 模块直接暴露自己的 HTTP 控制器（不走专门的 open-api 模块）：research、topic-insights、teams、writing、office、ask、image、social、simulation、planning、library/_、explore、management/_。

这是**有意设计**——这些是内部应用端点，不是"开放"外部 API。open-api 层专指：MCP Server、Public REST、A2A、Webhooks、Admin/Management。

**没有发现孤立的 open-api 模块**。所有 open-api 都对应清晰的底层基础设施。

---

## 4. 调整建议路线图

### P0 — 必须立即修复

| ID   | 动作                                                                                                           | 目标 | 影响文件  | 风险         |
| ---- | -------------------------------------------------------------------------------------------------------------- | ---- | --------- | ------------ |
| P0-1 | 更新 CLAUDE.md：把 ai-harness 正式定位为 L2.5 "Agent Runtime Harness"；删除关于 "ai-engine/runtime" 的错误描述 | 文档 | CLAUDE.md | 低（仅文档） |

### P1 — 本迭代修复

| ID   | 动作                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 目标                                                                                                                                       | 影响文件                       | 风险                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------- |
| P1-1 | 修复 ai-app/byok 的 facade 违规：5 个 controller 不得直接 import `ai-engine/credentials/*/service` 或 `ai-engine/llm/services/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | ai-app/byok/\*.controller.ts                                                                                                               | 5 个 controller 文件           | 中——需要给 harness/engine facade 加 credentials 服务导出          |
| P1-2 | 把 ai-app/explore 迁到 `common/` 或 `ai-engine/content/`：它是 `ai-engine/content/fetch/youtube.service.ts` 的薄包装，被 `common/content-processing` 引用，事实上是基础设施                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 把 explore.module.ts + youtube\*.ts + pdf-generator.ts 迁到 `common/content/` 或 `ai-engine/content/fetch/`                                | 5-8 个文件                     | 中——更新 3 个 import 站点                                         |
| P1-3 | 把 harness 的 SkillRegistry 重命名为 SkillMdRegistry，消除与 engine SkillRegistry 的同名冲突                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ai-harness/kernel/skills/skill.registry.ts + 所有 import 站点                                                                              | ~15-20 个文件                  | 中                                                                |
| P1-4 | 删除 `backend/src/config/` 顶层目录（仅含孤立的 `domain-whitelist.config.ts`），生产代码 0 引用，职责已被 `ai-app/management/ingestion/config/source-whitelist.service` 取代；同时清理 `ai-app/library/proxy/__tests__/` 中两个死 `jest.mock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `backend/src/config/domain-whitelist.config.ts` + 2 个 proxy spec 文件                                                                     | 3 个文件                       | 低                                                                |
| P1-5 | 删除 `backend/src/coverage-supplemental/`（19MB 的 Jest 覆盖率产物泄漏进 src），并在 `backend/.gitignore` 增加 `coverage-supplemental/` 防止再发生                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `backend/src/coverage-supplemental/coverage-final.json` + `.gitignore`                                                                     | 1 个删除 + 1 个 gitignore 修改 | 低                                                                |
| P1-6 | 把 `backend/src/modules/__tests__/` 下的跨模块集成回归测试迁到 `backend/tests/integration/`（与 P1-8 联动）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 2 个 spec 文件                                                                                                                             | 2 个文件移动 + jest 配置确认   | 低                                                                |
| P1-7 | 审视 `backend/src/types/` 4 个第三方包类型 stub：①**删除 `openai.d.ts`**（官方包自带类型，手写 stub 主动遮蔽且字段过时，遗漏 tool calling/structured output 等）；②检查 `tesseract.js.d.ts`、`turndown.d.ts` 能否换用 `@types/tesseract.js`、`@types/turndown` 替代，能则删；③保留 `youtubei.d.ts`（上游确实无官方类型）；④加 `README.md` 说明目录用途，防滥用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `backend/src/types/*.d.ts` + 1 个新增 README                                                                                               | 4-5 个文件                     | 中——删除 openai stub 后需验证 LLM 适配器编译通过                  |
| P1-8 | **`backend/test/` 重组为 `backend/tests/`** + **测试 mock 集中化**：①目录改名（test → tests）解决单复数命名违规；②内部按类型分目录：`tests/e2e/`（10 个 _.e2e-spec.ts）、`tests/integration/`（接收 `slides/_` 与来自 P1-6 的 2 个 spec）、`tests/manual/`（3 个 browser/ 手动验证脚本——它们没有 .spec 后缀，jest 跑不到）、`tests/**mocks**/`（**合并 `backend/src/**mocks**/`5 个 ESM mock 和`backend/test/**mocks**/pdfjs-dist.ts`**——src 不应该住测试基础设施，根因是 jest 主配置 `rootDir: "src"`不当）；③联动改`package.json`（test:e2e 路径、format/lint 的 test/** glob）、`jest.config.js`（`rootDir`从`"src"`改`"."`、`testRegex`改`"src/.\*\\.spec\\.ts$"`、`moduleNameMapper`中`<rootDir>/**mocks**/`改`<rootDir>/tests/**mocks**/`）、`jest-e2e.json`（testRegex 加 e2e/ 前缀 + mock 路径同步）、`Dockerfile:61`（`**mocks**` 排除规则）、`.eslintrc.js:25`（`test/**mocks**` 路径） | `backend/test/` 全量 + `backend/src/__mocks__/` 全量 + `package.json` + `jest.config.js` + `jest-e2e.json` + `Dockerfile` + `.eslintrc.js` | ~31 个文件移动 + 5 个配置改动  | 中——jest rootDir 变更影响所有 spec 路径解析，需全量跑一遍单测验证 |
| P1-9 | **`backend/` 根目录大扫除**：①**新建 `backend/.gitignore`**（当前不存在，导致 coverage 类垃圾被追踪），含 `coverage/`、`dist/`、`exports/`、`*.tsbuildinfo`、`.eslintcache`、`coverage-supplemental/`、`node_modules/` 等；②删除 `package.json.build`（1 行时间戳死文件）；③合并 6 个 jest 配置（`jest.config.js`/`jest.config.swc.js`/`jest.coverage-app.js`/`jest.coverage-app.swc.js`/`jest.coverage-engine.js`/`jest.coverage-engine.swc.js`）为 1-2 个 + 用 CLI 参数区分；④确认 `start.sh` vs `Procfile` 是否冗余（railway/heroku 部署只用一个）；⑤确认 `exports/`、`public/` 是源还是产物，产物要 gitignore                                                                                                                                                                                                                                                                                 | `backend/.gitignore`（新增）+ `package.json.build`（删）+ 6 个 jest 配置 + `start.sh`/`Procfile` 二选一                                    | 1 新增 + 1-7 删除 + 1 修改     | 中——package.json 的 test/coverage 脚本要联动                      |

### P2 — 下一迭代规划

| ID   | 动作                                                                                                                                                                                 | 目标                        | 影响文件                 | 风险                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------ | ----------------------------- |
| P2-1 | 重新分类 ai-app/management（ingestion + workspace）为平台层而非 AI App。选项：(a) 迁到新 `data-platform/` 顶级模块；(b) 把 ingestion 迁到 ai-infra；(c) 保留但文档标注非 AI 基础设施 | ai-app/management/\*        | 20-30 个文件             | 仅改名风险低                  |
| P2-2 | 删除或迁移 ai-app/agent-playground 到 `open-api/dev-tools` 或独立 dev-harness 模块                                                                                                   | ai-app/agent-playground/    | ~30 个文件               | 中——MissionEventBuffer 消费者 |
| P2-3 | 整体删除 intent-gateway（零消费者）。保留 ai-engine/planning 中的 IntentRouterService（已有用）                                                                                      | intent-gateway/（3 个文件） | 3 个文件 + app.module.ts | 低                            |
| P2-4 | 解决 ai-app/planning → ai-app/teams 跨 app 依赖：把 planning team config 上提到 ai-harness/runtime/teams 或合并到 teams                                                              | ai-app/planning/            | ~5 个文件                | 中                            |

### P3 — 长期改进

| ID   | 动作                                                                                                                 | 目标              | 影响文件   | 风险 |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------- | ---- |
| P3-1 | 在代码注释中明确 ai-engine/skills vs ai-harness/kernel/skills 的边界与正典化路径                                     | 仅注释            | 0 代码文件 | 低   |
| P3-2 | 拆 ai-app/feedback：用户端 controller 留 ai-app；GitHub-ops 分诊迁到 `ops/` 或 `admin/`                              | ai-app/feedback/  | 5-8 个文件 | 中   |
| P3-3 | 把 ReleaseService 的 AI 生成逻辑移出 ai-infra（基础设施层不应使用 AI）。迁到新 `ops/release/` 或 `open-api/release/` | ai-infra/release/ | 3-5 个文件 | 中   |
| P3-4 | ai-infra/table-management 改名为 db-admin 或迁到 open-api/admin 子控制器                                             | 2-3 个文件        | 低         |

---

## 5. 疑似作废 / 零消费者清单

| 组件                                                                                       | 证据                                                                                                                                                                                                                                                                                                                                               | 建议动作                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intent-gateway/`（整个模块）                                                              | 全代码库 0 import（grep 确认）                                                                                                                                                                                                                                                                                                                     | **删除**——3 个文件。保留 ai-engine/planning 的 IntentRouterService                                                                                    |
| `ai-engine/tools/deprecated/`                                                              | 0 import（grep 确认）。ShellExecutor、PythonExecutor、JavaScriptExecutor 因 RCE 风险已禁用                                                                                                                                                                                                                                                         | 可删可留，无功能风险。如保留应加 README 说明意图                                                                                                      |
| `backend/src/config/`（整个顶层目录，仅 1 个文件 `domain-whitelist.config.ts`）            | 生产代码 **0 import**（grep 全量确认）。仅 2 个测试文件 `jest.mock("../../../../../config/domain-whitelist.config", ...)` 引用——但这两个 mock 是**孤儿**，对应的真实 import 在生产代码中不存在。职责已被 `ai-app/management/ingestion/config/services/source-whitelist.service.ts`（DB-driven 版本）取代。违反"按模块聚合"规范——单文件独占顶层目录 | **删除**整个 `backend/src/config/` 目录 + 删除 proxy 模块两个测试文件中的死 `jest.mock`。如 Library Proxy 仍需白名单，应走 `source-whitelist.service` |
| `ai-app/teams/services/collaboration/context/index.ts`（现已是 shim）                      | PR-X25 后是纯 re-export shim，转发到 harness/facade 和 engine/facade                                                                                                                                                                                                                                                                               | **保留**——为 teams 内部提供稳定 import 路径，优先级低                                                                                                 |
| `ai-app/library/rag/index.ts` 中的 `rag.interfaces` 和 `rag-pipeline.service` shim         | PR-X25 已删除 shim 后的源文件，留 re-export 桩                                                                                                                                                                                                                                                                                                     | **保留**——记录已迁移内容，无需动                                                                                                                      |
| `backend/src/coverage-supplemental/coverage-final.json`（19MB）                            | Istanbul/Jest 标准覆盖率产物被错放进 `src/`。正常产物应在 `backend/coverage/`（已存在）。被 git 跟踪占仓库空间，且会被打进生产构建。`.gitignore` 缺少对应规则                                                                                                                                                                                      | **删除**整目录 + 在 `backend/.gitignore` 添加 `coverage-supplemental/` 规则                                                                           |
| `backend/src/modules/__tests__/`（2 个 spec 文件）                                         | `business-logic-simulation.spec.ts`（跨 9 模块全分支模拟）+ `production-anomaly-defense.spec.ts`（跨 topic-insights + contracts 真实生产数据回归）。属于跨模块集成回归测试，违反 `.claude/rules/testing.md`"单测与源文件同目录"规范                                                                                                                | **迁移**到 `backend/tests/integration/`（如不存在则创建）                                                                                             |
| `backend/src/types/openai.d.ts`                                                            | 手写 OpenAI SDK 类型 stub（1 月份字段），但 `openai` npm 包**自带完整官方类型**。手写 stub 反而**遮蔽**官方类型，导致 SDK 新 API（tool calling、structured output、response_format 等）在编译期不可见                                                                                                                                              | **删除**——官方类型自动接管                                                                                                                            |
| `backend/src/types/tesseract.js.d.ts`、`turndown.d.ts`                                     | 手写 stub。上游存在 `@types/tesseract.js`、`@types/turndown`                                                                                                                                                                                                                                                                                       | **替换**为 `npm i -D @types/...`，删除手写 stub                                                                                                       |
| `backend/test/browser/` 下 3 个文件                                                        | `browser-verification.ts`、`standalone-browser-test.ts`、`test-reader-mode-e2e.ts`——**无 `.spec.ts` 后缀**，jest-e2e.json 的 `testRegex: ".e2e-spec.ts$"` 跑不到，是手动验证脚本错放在测试目录                                                                                                                                                     | **迁移**到 `tests/manual/`（重组时一起处理，不算 spec）                                                                                               |
| `backend/test/slides/` 下的 `e2e-orchestrator.spec.ts` 等                                  | 用 `.spec.ts` 后缀，但 jest 默认从 `src/` 找 `*.spec.ts`、jest-e2e 只认 `*.e2e-spec.ts`——**两个 jest 配置都跑不到**，是死测试                                                                                                                                                                                                                      | 重组到 `tests/integration/slides/` 并修正 jest 配置                                                                                                   |
| `backend/package.json.build`                                                               | 1 行内容 `// Build: 1766269355`，仅时间戳                                                                                                                                                                                                                                                                                                          | **删除**                                                                                                                                              |
| `backend/.eslintcache`（14KB）+ `backend/tsconfig.tsbuildinfo`（970KB）                    | 编译/lint 缓存产物，被 git 跟踪                                                                                                                                                                                                                                                                                                                    | 加入待新建的 `backend/.gitignore`                                                                                                                     |
| `backend/jest.config.swc.js` + 4 个 `jest.coverage-*.js` 变体                              | 6 个 jest 配置文件，每个 5-10 行，主要差异可用 jest CLI 参数（`--testPathPattern`、`--collectCoverageFrom`）解决                                                                                                                                                                                                                                   | 合并为 1-2 个，多余的删除                                                                                                                             |
| `backend/src/__mocks__/`（5 个 ESM 兼容 mock：p-limit、marked、exceljs、pptxgenjs、jsdom） | 测试基础设施错放在生产源码目录。已被 `jest.config.js:23` 通过 `!**/__mocks__/**` 从 coverage 排除、被 `Dockerfile:61` 从镜像排除、被 `.eslintrc.js:25` 特殊处理——多处补丁说明已是已知技术债。根因：jest 主配置 `rootDir: "src"` 强制 mock 必须在 src 下才能用 `<rootDir>/__mocks__` 引用                                                           | 与 `backend/test/__mocks__/pdfjs-dist.ts` **合并迁到 `backend/tests/__mocks__/`**；同时把 jest 主配置 `rootDir` 从 `"src"` 改为 `"."`                 |

---

## 6. 工程目录规范缺口（补充审计）

### 现状的"统一工程目录"规范

按 `.claude/rules/testing.md` 和 `standards/00-overview.md`：

- 单元测试 → 与源文件同目录的 `__tests__/` 或 `*.spec.ts`
- E2E 测试 → `backend/tests/e2e/`
- 配置 → 按模块聚合到各模块的 `config/`（不应有顶层 `src/config/`）
- 覆盖率产物 → `backend/coverage/`（必须 gitignore）

### 实际违规

| 违规                               | 实例                                                                                       | 应在                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 顶层目录散落孤立单文件             | `backend/src/config/domain-whitelist.config.ts`                                            | 应聚合到模块或彻底删除                                                       |
| 构建/测试产物泄漏到源码目录        | `backend/src/coverage-supplemental/`                                                       | 应在 `backend/coverage/` 且 gitignore                                        |
| 跨模块测试无明确归属               | `backend/src/modules/__tests__/`                                                           | 现规范有缺口——介于单测和 e2e 之间                                            |
| 测试根目录命名违规（单数 vs 复数） | `backend/test/`（NestJS 脚手架默认）                                                       | `backend/tests/`（与项目其他规范一致）                                       |
| 测试根目录内部无类型分层           | `backend/test/` 下 e2e、集成、手动脚本、mock 全混在一起                                    | 应按 `tests/{e2e,integration,manual,__mocks__}/` 分目录                      |
| 第三方类型 stub 集中堆放但内容过时 | `backend/src/types/openai.d.ts`（遮蔽官方类型）                                            | 删除过时的，保留必要的，加 README                                            |
| `backend/.gitignore` 缺失          | 整个 backend 根目录无 `.gitignore`，导致 coverage、tsbuildinfo、.eslintcache 等被 git 追踪 | 必须新建                                                                     |
| 根目录 jest 配置爆炸               | 6 个 jest.\* 文件（主 + swc 变体 + coverage-app/engine 变体）                              | 合并为 1-2 个，差异用 CLI 参数                                               |
| 根目录死文件                       | `backend/package.json.build`（1 行时间戳）                                                 | 删除                                                                         |
| 测试 mock 错放在 `src/` 且分两处   | `backend/src/__mocks__/`（5 个 ESM mock）+ `backend/test/__mocks__/`（1 个 mock）          | 集中到 `backend/tests/__mocks__/`，并把 jest `rootDir` 从 `"src"` 改为 `"."` |

### 规范缺口与补全建议

**当前规范缺少"集成测试层"的明确定义**——介于单测（同目录）和 E2E（`tests/e2e/`）之间的、跨模块组合的回归测试没有归宿。

建议在 `.claude/rules/testing.md` 补充三层测试定位：

```
backend/
├── .gitignore                             ← ★ 必须存在（覆盖 coverage/dist/exports/cache）
├── src/
│   ├── {module}/**/*.spec.ts              ← 单元测试（与源同目录）
│   ├── types/                             ← 仅放第三方无官方类型的 stub（含 README）
│   └── 禁止: 顶层 config/、coverage-*/、modules/__tests__/、构建产物
├── tests/                                 ← ★ 改名（test → tests）解决单复数问题
│   ├── unit/                              ← （可选）跨域单测，主流仍走与源同目录
│   ├── integration/                       ← 集成测试（跨模块组合、真实数据回归）★ 新增
│   ├── e2e/                               ← 端到端测试（含 HTTP/DB）
│   ├── manual/                            ← 手动验证脚本（非自动化测试）★ 新增
│   ├── __mocks__/                         ← 全局 mock
│   ├── jest-e2e.json
│   ├── jest-integration.json (新增)
│   └── setup.ts
├── coverage/                              ← Jest 产物（gitignore）
├── jest.config.js                         ← 唯一主配置（差异通过 CLI 参数）
└── 部署/工程根级文件（Dockerfile、Procfile、railway.toml、nest-cli.json 等）
```

并在规范中增加红线：

- **`backend/src/` 只能包含 NestJS 源码、模块化资源（含模块内 `config/`、`__tests__/`、`prompts/`）+ `types/` 第三方类型 stub**
- **任何顶层非模块目录（`src/config/`、`src/coverage-*`、`src/modules/__tests__/` 等）必须有充分理由，否则视为违规**
- **覆盖率/构建/缓存产物必须配套 `.gitignore` 规则；`.gitignore` 不允许缺失**
- **测试根目录用复数 `tests/`，不用单数 `test/`（NestJS 脚手架默认是错的）**
- **jest 配置最多 2 个**（主配置 + e2e/integration 变体），不允许通过新增配置文件区分 testPathPattern**——这种应该用 CLI 参数**

### 建议落地动作（汇总）

| ID   | 动作                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P1-4 | 删除 `backend/src/config/` 顶层目录                                                                                                 |
| P1-5 | 删除 `backend/src/coverage-supplemental/` + 补 gitignore                                                                            |
| P1-6 | 迁 `backend/src/modules/__tests__/` 的 2 个 spec 到 `backend/tests/integration/`                                                    |
| P1-7 | 清理 `backend/src/types/` 过时 stub（删 openai.d.ts、换 `@types/*`）                                                                |
| P1-8 | 重组 `backend/test/` → `backend/tests/`（改名 + 内部分层 e2e/integration/manual）                                                   |
| P1-9 | 大扫除 `backend/` 根目录（新建 .gitignore、删 package.json.build、合并 6 个 jest 配置、确认 start.sh/Procfile/exports/public 归属） |
| P2-5 | 在 `.claude/rules/testing.md` 和 `standards/00-overview.md` 中补充集成测试层定义、源码目录红线、jest 配置上限、测试目录命名规范     |

---

## 7. 附录 — 本次审计读取的关键文件

### Facade/Index（8）

- `ai-engine/facade/index.ts`
- `ai-harness/facade/index.ts`
- `ai-infra/facade/index.ts`
- `ai-app/library/rag/index.ts`
- `ai-app/teams/services/collaboration/context/index.ts`
- `ai-harness/kernel/skills/index.ts`
- `ai-app/contracts/report-template/index.ts`
- `ai-engine/tools/deprecated/index.ts`

### Module 文件（34）

- `ai-engine/ai-engine.module.ts`、`ai-harness/harness.module.ts`、`ai-harness/runtime/runtime.module.ts`
- `ai-harness/runtime/teams/teams.module.ts`、`ai-harness/protocol/a2a/a2a.module.ts`
- `intent-gateway/intent-gateway.module.ts`、`intent-gateway/intent-gateway.service.ts`
- `ai-app/byok/byok.module.ts`、`ai-app/feedback/feedback.module.ts`
- `ai-app/planning/ai-planning.module.ts`、`ai-app/teams/ai-teams.module.ts`
- `ai-app/research/research.module.ts`、`ai-app/topic-insights/topic-insights.module.ts`
- `ai-app/writing/ai-writing.module.ts`、`ai-app/office/ai-office.module.ts`
- `ai-app/image/ai-image.module.ts`、`ai-app/social/ai-social.module.ts`
- `ai-app/ask/ai-ask.module.ts`、`ai-app/simulation/ai-simulation.module.ts`
- `ai-app/agent-playground/agent-playground.module.ts`
- `ai-app/explore/explore.module.ts`、`ai-app/management/workspace/workspace.module.ts`
- `ai-app/management/ingestion/scheduler/scheduler.module.ts`
- `ai-app/management/ingestion/sources/sources.module.ts`
- `ai-app/library/rag/rag.module.ts`、`ai-app/library/knowledge-graph/knowledge-graph.module.ts`
- `open-api/admin/admin.module.ts`、`open-api/teams-api/teams-api.module.ts`
- `open-api/byok-admin/byok-admin.module.ts`、`open-api/mcp-server/mcp-server.module.ts`
- `open-api/agents-api/agents-api.module.ts`、`open-api/a2a-api/a2a-api.module.ts`
- `open-api/public-api/public-api.module.ts`、`open-api/skills-api/skills-api.module.ts`
- `open-api/ai-core/ai-core.module.ts`、`open-api/webhooks/webhooks.module.ts`
- `ai-infra/auth/auth.module.ts`、`ai-infra/secrets/secrets.module.ts`
- `ai-infra/encryption/encryption.service.ts`
- `ai-infra/monitoring/monitoring.module.ts`、`ai-infra/settings/settings.module.ts`
- `ai-infra/release/release.module.ts`、`ai-infra/table-management/table-management.module.ts`
- `app.module.ts`

### Service / Interface 文件（22）

- `ai-harness/kernel/skills/skill.registry.ts`
- `ai-engine/skills/registry/skill.registry.ts`
- `ai-harness/kernel/abstractions/skill.interface.ts`
- `ai-engine/skills/abstractions/skill.interface.ts`
- `ai-app/research/memory/research-memory.service.ts`
- `ai-harness/memory/working/process-memory-manager.service.ts`
- `ai-app/contracts/interfaces/data-export.interface.ts`
- `ai-infra/secrets/secrets.service.ts`
- `ai-infra/facade/index.ts`

### 关键 grep 查询（31 次）

import-graph 查询，覆盖：facade 绕过检测、跨层反向依赖、intent-gateway 和 deprecated 工具的消费者计数、跨 app 模块 import、ai-app 中的 SkillRegistry 使用、ConstraintEnforcementService 的 import 路径、contracts 消费站点、ExploreModule 消费站点、BYOK 直接 credentials import、WorkspaceModule/ReleaseModule 消费者、各层模块文件计数。

---

**审计员**：arch-auditor sub-agent
**主控**：Claude Code (Opus 4.7)
**生成时间**：2026-04-28


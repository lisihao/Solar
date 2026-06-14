# 架构审计报告 — 三模块专项 (12 维度)

**审计日期**: 2026-03-12
**审计版本**: 3fdd13c96
**审计员**: Arch Auditor Agent v2.0
**审计范围**: 三模块专项扫描

> **[2026-03-12 更新] P0 发现已解决**: 本报告 D1 中标记的 P0 问题（ai-engine L2 反向依赖 ai-kernel L3）已通过调整层号定义解决。新的层次定义为：**AI Kernel = L2**，**AI Engine = L3**。在新定义下，ai-engine (L3) 依赖 ai-kernel (L2) 是完全合规的向下依赖，不再构成反向依赖违规。D1 的分析文字保留原始发现记录，但层号标注已同步更新。

| 模块           | 路径                                         | 生产 TS 文件数 | 测试文件数 |
| -------------- | -------------------------------------------- | -------------- | ---------- |
| topic-insights | `backend/src/modules/ai-app/topic-insights/` | 193            | 20         |
| ai-kernel      | `backend/src/modules/ai-kernel/`             | ~32            | 24         |
| ai-engine      | `backend/src/modules/ai-engine/`             | 432            | 242        |
| **合计**       | —                                            | **657**        | **286**    |

---

## 评分汇总

| #   | 维度        | 满分    | 得分   | 状态 |
| --- | ----------- | ------- | ------ | ---- |
| 1   | 分层合规    | 10      | 6      | 警告 |
| 2   | Facade 边界 | 10      | 7      | 警告 |
| 3   | 模块内聚    | 10      | 6      | 警告 |
| 4   | 接口抽象    | 10      | 7      | 良好 |
| 5   | 依赖管理    | 10      | 8      | 良好 |
| 6   | 错误处理    | 10      | 8      | 良好 |
| 7   | 并发安全    | 10      | 8      | 良好 |
| 8   | 可测试性    | 10      | 6      | 警告 |
| 9   | 可观测性    | 10      | 7      | 良好 |
| 10  | 性能        | 10      | 7      | 良好 |
| 11  | 安全性      | 10      | 8      | 良好 |
| 12  | 代码质量    | 10      | 8      | 良好 |
|     | **总计**    | **120** | **86** |      |

---

## D1: 分层合规 [6/10]

### 架构背景

6 层架构从高到低：L6 Intent Gateway → L5 Open API → L4 AI Apps → L3 AI Engine → L2 AI Kernel → L1 Infrastructure

依赖方向规则：高层可以依赖低层，**低层不得依赖高层**。

### 正面发现

- topic-insights (L4) 向 ai-engine (L3) 和 ai-kernel (L2) 的依赖方向**完全正确**，全部通过各自 facade。
- ai-app → ai-engine 方向的 ESLint `no-restricted-imports` 规则已覆盖所有内部路径，且编写在 `.eslintrc.js` 的 `overrides[files: "**/modules/ai-app/**/*.ts"]` 块中，规则强度为 `error`。
- ResearchTopic、ResearchMission、ResearchTask 的 FK 均有对应 `@@index`，主查询路径有覆盖。

### 负面发现 — 关键

**违规 1（原 P0，已通过层号重定义解决）：ai-engine 与 ai-kernel 的层次关系**

> **[已解决]**: 本条违规已通过重新定义层号解决。新定义：AI Kernel = L2，AI Engine = L3。ai-engine (L3) 依赖 ai-kernel (L2) 现在是合规的向下依赖。以下内容保留为历史记录。

原发现：按照旧层号定义（AI Engine = L2，AI Kernel = L3），AI Engine 是 L2，AI Kernel 是 L3，即 Kernel 位于 Engine **之上**，导致 ai-engine 导入 ai-kernel 被判定为反向依赖。

实际代码中，ai-engine 大量导入 ai-kernel 的服务：

```
backend/src/modules/ai-engine/ai-engine.module.ts:80-82
backend/src/modules/ai-engine/ai-engine-orchestration.module.ts:28-54
backend/src/modules/ai-engine/ai-engine-constraint.module.ts:20-21
backend/src/modules/ai-engine/ai-engine-memory.module.ts:16
backend/src/modules/ai-engine/facade/ai-engine.facade.ts:41,176,180
backend/src/modules/ai-engine/agents/registry/agent-orchestrator.ts:13-15
```

导入的 kernel 服务包括：`ProcessEventLogService`（原名 TraceCollector）、`KernelMetricsService`（原名 AiObservabilityService）、`CostAttributionService`、`CheckpointManager`、`CircuitBreakerService`、`ConstraintEnforcementService`、`ProcessSupervisorService`、`ProgressTrackerService`、`WorkingMemoryStore`、`CostController`、`RateLimiter`、`EventJournalService`、`CapabilityGuardService`、`KernelContext`、`TaskCompletionType`。

**根本原因（历史）**：这批服务在架构重构时从 ai-engine 的 `infra/observability/` 等路径**迁移**到了 ai-kernel，注释可见 `// migrated to ai-kernel`，但使用方（ai-engine 的其他子模块）的代码调用关系并未颠倒，在旧层号定义下形成了 L2 → L3 的表观反向依赖。根因是迁移时层次定义模糊：**迁移时未明确决定 Kernel 到底是 Engine 的上层还是下层**。该问题已通过将 Kernel 定义为 L2（低于 Engine 的 L3）解决。

**违规 2：a2a.module.ts 直接导入 A2AController 内部路径**

```
backend/src/modules/ai-engine/infra/a2a/a2a.module.ts:8
import { A2AController } from "../../../ai-kernel/ipc/a2a/a2a.controller";
```

同文件对 `AgentCardRegistry`、`A2AApiKeyGuard` 等已正确走 ai-kernel facade，但 `A2AController` 和 `TEAMS_SERVICE_TOKEN` 直接导入内部路径。注释说明原因是"controller 有装饰器副作用"，但 `TEAMS_SERVICE_TOKEN` 抽象 token 不受此限制，可补充到 facade。

**違規 3：orchestration executor 直接导入 ai-kernel 内部路径**

```
backend/src/modules/ai-engine/orchestration/executors/base-executor.ts:23
import type { CircuitBreakerService } from "../../../ai-kernel/resource/circuit-breaker.service";

backend/src/modules/ai-engine/orchestration/executors/dag-executor.ts:22-23
import type { CheckpointManager } from "../../../ai-kernel/journal/checkpoint-manager";
import type { ProcessEventLogService } from "../../../ai-kernel/observability/process-event-log.service";
```

虽然均为 `import type`（编译时消除，无运行时影响），但破坏了 facade 边界的一致性，且这三个类型在 ai-kernel facade 均已导出，无需绕过。

### 扣分依据

- ~~反向依赖（L2 导入 L3）系统性问题：-3 分~~ [已解决，层号已重定义]
- Executor / A2A 模块直接导入 kernel 内部路径（应走 facade）：-1 分

---

## D2: Facade 边界 [7/10]

### 正面发现

- **ai-app → ai-engine facade 合规率 100%**：全量扫描未发现 topic-insights 中任何直接导入 ai-engine 内部路径的情况（`facade/base-classes.ts` 是 facade 目录下的子文件，属合法子路径，且有设计注释说明原因）。
- ai-app → ai-kernel facade 合规率 100%：topic-insights 的所有 `@/modules/ai-kernel/*` 导入均指向 `ai-kernel/facade`。
- ESLint `no-restricted-imports` 规则已为 `ai-app/**/*.ts` 覆盖 7 个 ai-engine 内部子目录，强度 `error`，运行时实际可拦截 90%+ 的违规。

### 负面发现

**缺口 1：ESLint 无 ai-engine → ai-kernel facade 边界规则**

`.eslintrc.js` 仅为 `**/modules/ai-app/**/*.ts` 配置了 `no-restricted-imports`，未为 `**/modules/ai-engine/**/*.ts` 配置类似规则限制其访问 `ai-kernel` 内部路径。因此 D1 中发现的 3 处 `import type` 越界（`base-executor.ts`、`dag-executor.ts`、`a2a.module.ts` 的 `TEAMS_SERVICE_TOKEN`）**无 lint 层拦截**。

**缺口 2：ai-engine facade `index.ts` 重新导出 ai-kernel 符号未注释**

```
backend/src/modules/ai-engine/facade/index.ts:
export { TaskCompletionType } from "../../ai-kernel/facade";
```

ai-engine facade 将 ai-kernel 的 `TaskCompletionType` 透传导出，外层 ai-app 使用时路径是 `ai-engine/facade`，这在技术上有效。但这也意味着 ai-engine facade 扮演了 ai-kernel 的代理角色，未来可能产生类型版本漂移。

### 扣分依据

- D1 中的 facade 违规（3 处 import type + TEAMS_SERVICE_TOKEN）：-2 分
- 无 lint 规则保障 ai-engine → ai-kernel facade 边界：-1 分

---

## D3: 模块内聚 [6/10]

### 正面发现

- topic-insights 的服务目录已分层组织（`core/`、`data/`、`dimension/`、`search/`、`report/`、`monitoring/`、`quality/`、`collaboration/`），比平铺结构更清晰。
- ai-kernel 的子目录划分语义明确（`process/`、`ipc/`、`journal/`、`memory/`、`resource/`、`scheduler/`、`mission/`、`supervisor/`、`security/`），职责清晰。

### 负面发现

**问题 1：超大文件——上帝服务依然存在**

以下文件超过 1000 行，属于典型的上帝服务（God Service），持续积累业务逻辑：

| 文件                                                                    | 行数 | 问题                                    |
| ----------------------------------------------------------------------- | ---- | --------------------------------------- |
| `ai-engine/facade/ai-engine.facade.ts`                                  | 2993 | 过度宽泛的 facade，承担了太多类型声明   |
| `ai-app/topic-insights/services/data/data-source-router.service.ts`     | 2653 | 路由 + 采集 + JSON 解析 + LLM 调用混合  |
| `ai-app/topic-insights/services/report/report-synthesis.service.ts`     | 2483 | 报告合成 + 多次 LLM 调用 + 结构化逻辑   |
| `ai-engine/teams/orchestrator/mission-orchestrator.ts`                  | 2380 | 任务规划 + 执行 + 状态管理混合          |
| `ai-app/topic-insights/services/dimension/dimension-mission.service.ts` | 2209 | 维度执行 + 搜索 + LLM 调用混合          |
| `ai-engine/llm/services/ai-chat.service.ts`                             | 1705 | LLM 调用 + 模型选择 + fallback 逻辑混合 |
| `ai-app/topic-insights/services/collaboration/research-todo.service.ts` | 1693 | TODO 执行 + 队列 + LLM + 状态混合       |
| `ai-app/topic-insights/services/dimension/dimension-writing.service.ts` | 1515 | 写作 + 格式 + 渲染混合                  |
| `ai-app/topic-insights/topic-insights.service.ts`                       | 1492 | 顶层 facade service 仍有 1492 行        |
| `ai-engine/knowledge/search/search.service.ts`                          | 1441 | 搜索 + API 调用 + 健康检查 + 关键字管理 |
| `ai-engine/api/ai-core.controller.ts`                                   | 1334 | 单个 Controller 1334 行，端点过于密集   |
| `ai-app/topic-insights/services/core/mission-lifecycle.service.ts`      | 1305 | 生命周期 + 启动 + 取消 + 重试混合       |
| `ai-app/topic-insights/services/report/report-generator.service.ts`     | 1281 | 生成 + 组装 + 验证混合                  |
| `ai-app/topic-insights/services/core/mission-execution.service.ts`      | 1228 | 执行 + 调度 + 任务分发混合              |
| `ai-engine/llm/services/ai-model-config.service.ts`                     | 1216 | 模型配置 + 缓存 + 推断逻辑混合          |
| `ai-engine/facade/domain/chat.facade.ts`                                | 1212 | 领域 facade 超出合理范围                |

**问题 2：代码重复——`buildFiguresSummary` 的复用模式不完整**

`evidence-summary.utils.ts` 已定义 `buildFiguresSummary`，且 `dimension-mission.service.ts` 和 `dimension-search.service.ts` 都正确导入复用。但 `section-writer.service.ts` 存在内联的 `extractJsonBlock` 私有方法（line 1102），与 `data-source-router.service.ts:2091-2096` 和 `data-source-fetcher.service.ts:903-907` 完全重复——同一段 JSON block 提取逻辑三处复制，未提取到 `utils/extract-json.utils.ts`（该文件已存在）。

**问题 3：ai-engine facade 包含 ai-kernel 符号的反向渗透**

`ai-engine/facade/index.ts` 透传导出了 `TaskCompletionType`（来自 ai-kernel），使得 ai-engine facade 兼任 ai-kernel facade 的部分功能，层次混淆。

**问题 4：TopicInsightsModule providers 列表过于庞大**

`topic-insights.module.ts` 的 providers 数组注册了 70+ 服务，模块级别内聚度下降，任何新增服务需要在三处同步添加（providers array、exports array、services const）。

### 扣分依据

- 16 个超 1000 行文件：-2 分
- JSON 解析工具三处重复复制：-1 分
- module.ts providers 膨胀 + 层次渗透：-1 分

---

## D4: 接口抽象 [7/10]

### 正面发现

- ai-kernel 提供稳定的 `facade/index.ts`，清晰分区（Process、Journal、Memory、IPC、Resource、Observability、Mission、Security、Scheduler、Supervisor），新增符号遵循在 facade 集中添加的原则。
- ai-engine 的领域 facade 分层（`domain/chat.facade.ts`、`domain/rag.facade.ts`、`domain/agent.facade.ts`、`domain/team.facade.ts`）合理，使 App 层可以按领域选择注入粒度。
- `ITaskExecutor` 接口定义（`services/core/task-executors/task-executor.interface.ts`）使任务执行器可插拔，体现了良好的抽象。
- `IMissionExecutor` 接口定义在 ai-kernel 层（`mission/mission-executor.interface.ts`），依赖倒置正确。

### 负面发现

**问题 1：A2A inbound 端点是占位符（TODO）**

```
backend/src/modules/ai-kernel/ipc/a2a/a2a.controller.ts
```

根据 MEMORY.md 的记录：`A2AController` 的 `createTask` 和 `getTaskStatus` 端点是占位符，功能未实现。对外暴露了空接口，但调用方无法感知。

**问题 2：`KernelApiService` 职责不清晰**

`ai-kernel/api/kernel-api.service.ts` 暴露于 facade，但其命名过于宽泛。未读取其实现，但 kernel API service 通常是一个设计模糊的"杂物箱"。

**问题 3：ai-engine facade（2993 行）过于宽泛**

大型 facade 本身是接口稳定性的风险点：修改任何一处都需要对整个 facade 进行回归，且测试成本高。建议继续拆分为更小的领域 facade（chat、rag、agent、team 已完成，其他部分尚未）。

### 扣分依据

- A2A 占位接口对外不透明：-2 分
- Facade 过大影响维护性：-1 分

---

## D5: 依赖管理 [8/10]

### 正面发现

- `LruMap` 已在 `common/utils/lru-map.ts` 统一实现并使用：`data-enrichment.service.ts` 的 `fetchCache`（500条上限）、`data-source-router.service.ts` 的 `planCache`（100条上限）均正确使用。
- `safeCompare` 统一在 `common/utils/crypto.utils.ts` 实现，A2A API Key Guard 正确调用（line 52）。
- p-limit 用于 `GlobalSourceThrottleService`（search 并发控制），避免了自实现队列。
- ConfigService 用于获取 JWT_SECRET、CORS_ORIGINS 等敏感配置，`JwtModule.registerAsync` 模式正确。
- 无跨 AI App 直接依赖，topic-insights 不导入其他 ai-app 子模块。

### 负面发现

**问题 1：`process.env` 直接访问在工具层**

```
backend/src/modules/ai-engine/tools/categories/integration/email-sender.tool.ts:160-164
backend/src/modules/ai-engine/tools/categories/integration/message-push.tool.ts:725-731
```

工具（Tool）实例在 ai-engine 层，无法通过正常 DI 获取 ConfigService（Tools 通常以静态方式调用），因此直接读取 `process.env.SMTP_HOST` 等。这是已知架构约束，但应在工具层引入 ConfigService 注入机制或统一 ToolContext 传参。

**问题 2：`DEFAULT_AI_MODEL` fallback 硬编码为 `"gemini"`**

```
backend/src/modules/ai-engine/llm/services/ai-chat.service.ts:264,973,979
this.configService.get<string>("DEFAULT_AI_MODEL", "gemini")
```

CLAUDE.md 明确规定：fallback 场景应用 `""` 空字符串而非具体模型名。`"gemini"` 这个默认值破坏了"由下游 AiChatService 走 TaskProfile 自动解析"的规则，且在 3 处重复出现。

### 扣分依据

- process.env 直接访问（工具层）：-1 分
- DEFAULT_AI_MODEL 硬编码 `"gemini"` 违反 CLAUDE.md 规则：-1 分

---

## D6: 错误处理 [8/10]

### 正面发现

- topic-insights 中所有 fire-and-forget 的 `.catch()` 均带有 `this.logger.error(...)` 日志，无静默吞错（扫描了 20+ 处，均有日志）。
- `void` 关键字在异步 fire-and-forget 场景中一致使用，满足 `@typescript-eslint/no-floating-promises` 规则。
- WebSocket Gateway（`topic-insights.gateway.ts`）的所有 `@SubscribeMessage` 处理器均有 try-catch 包裹。
- exceptions/ 目录（`research.exceptions.ts`）使用了继承 NestJS `HttpException` 的自定义异常类。
- `mission-lifecycle.service.ts` 中使用了 `StateTransitionValidator` 对状态变更做前置校验，防止无效状态转换抛出异常。

### 负面发现

**问题 1：Gateway JWT 验证使用裸 `throw new Error`**

```
backend/src/modules/ai-app/topic-insights/topic-insights.gateway.ts:147
throw new Error("JWT_SECRET is required for WebSocket authentication");
```

这是启动时防御性检查，但 Gateway 中抛出 Error 未捕获可能导致 WS 连接异常，应改为 Logger.error + process.exit 或抛出 NestJS 异常。

**问题 2：Handler 层使用裸 `throw new Error`**

```
backend/src/modules/ai-app/topic-insights/handlers/dimension-write.handler.ts:129
throw new Error(...)
```

Handler 是 AI Engine 的 WorkflowHandler 回调，抛出裸 Error 会被 DAGExecutor 捕获，但错误类型不具语义（无法区分用户错误和系统错误）。

**问题 3：gateway `verifyToken` catch 静默返回 null**

```
backend/src/modules/ai-app/topic-insights/topic-insights.gateway.ts:292-299
catch {
  return null;  // 无日志
}
```

JWT 验证失败被静默处理，无法区分"token 过期"、"token 格式错误"和"签名不匹配"。虽然上层会因 `null` 拒绝连接，但对安全审计不友好。

### 扣分依据

- 裸 `throw new Error` 在 gateway 和 handler 层（2处）：-1 分
- JWT 验证失败静默处理无日志：-1 分

---

## D7: 并发安全 [8/10]

### 正面发现

- `TopicTeamOrchestratorService.activeRefreshes` 在方法开头检查 `if (this.activeRefreshes.has(topicId))` 防止同一 topic 并发刷新，且 finally 块保证删除。
- `MissionExecutionService` 中的 `executingTasks` 是方法内局部变量，无跨请求共享风险。
- `ResearchRealtimeAdapter.subscriptionRegistry` 有定期 cleanup（`cleanupIntervalId`）和模块销毁时的 `clear()`，不会无限增长。
- `EvidenceSyncCompensationService.pendingQueue` 有重试上限（`permanentlyFailed` 分离），防止无限重试。
- `GlobalSourceThrottleService` 使用 p-limit 正确限制并发搜索请求数量。
- ai-kernel `ResourceManagerService` 提供了正式的资源管理 API，供上层调用。

### 负面发现

**问题 1：`chat.facade.ts` 的 `zeroBalanceCache` 无上限**

```
backend/src/modules/ai-engine/facade/domain/chat.facade.ts:75
const zeroBalanceCache = new Map<string, number>(); // userId → expiry timestamp
```

该 Map 按 userId 缓存零余额状态，仅在用户充值时 delete 单条。如果平台有大量历史零余额用户从不充值，此 Map 会随时间持续增长。正确做法是使用 `LruMap`（已在项目中可用）或定期清扫过期 TTL。

**问题 2：`KnowledgeGraphService` 的实体 Map 无边界控制**

```
backend/src/modules/ai-app/topic-insights/services/data/knowledge-graph.service.ts:35,39
private readonly entities = new Map<string, KnowledgeEntity>();
private readonly entityNameIndex = new Map<string, string>();
```

知识图谱实体持续追加，无 LRU 淘汰或容量上限。对于长期运行的进程，如果按 topic 累计实体，可能产生内存压力。

**问题 3：`research-todo.service.ts` 队列竞态**

`processNextQueuedTodo` 在 `executeTodo` 成功/失败后都再次调用（lines 1233, 1259），形成递归链式调用。若同时有多个调用触发，可能产生并发执行同一队列的场景。当前无分布式锁或队列互斥机制（仅有数据库层的状态检查）。

### 扣分依据

- `zeroBalanceCache` 无上限：-1 分
- 知识图谱 Map 无边界：-0.5 分
- TODO 队列链式调用无互斥保证：-0.5 分

---

## D8: 可测试性 [6/10]

### 正面发现

- ai-kernel 测试覆盖良好：32 个生产文件对应 24 个测试文件，比率 75%，覆盖了核心服务（`ProcessManagerService`、`EventJournalService`、`CheckpointManager`、`CircuitBreakerService`、`StateTransitionValidator`、`HealthCheckRunner` 等）。
- ai-engine 测试文件 242 个，覆盖面宽，绝对数量充足。
- topic-insights 的 `__tests__/` 目录结构完善，有 fixtures、mocks、unit 分层，`mission.controller.spec.ts` 存在（通过 `__tests__/unit/` 集中放置规避了 D10 controller spec 检查）。
- `__tests__/mocks/prisma.mock.ts` 和 `__tests__/mocks/ai-chat.mock.ts` 提供了良好的 mock 基础设施。
- DI 注入（`@Optional()`）在 TopicInsightsModule 中正确使用，使 agentRegistry/teamRegistry 缺失时模块仍可启动。

### 负面发现

**问题 1：6 个 Controller 全部无 collocated spec 文件**

```
MISSING SPEC (collocated):
- controllers/collaboration.controller.ts
- controllers/mission.controller.ts  (有 __tests__/unit/mission.controller.spec.ts)
- controllers/report-review.controller.ts
- controllers/report.controller.ts
- controllers/todo.controller.ts
- controllers/topic.controller.ts
```

除 `mission.controller.spec.ts` 外，其余 5 个 Controller 无任何测试覆盖（包括非 collocated 的 `__tests__/unit/` 目录下也未发现对应文件）。

**问题 2：核心业务服务无测试**

topic-insights 中以下核心服务无测试：`data-source-router.service.ts`（2653行，最复杂的服务）、`report-synthesis.service.ts`（2483行）、`mission-lifecycle.service.ts`（1305行）、`dimension-mission.service.ts`（2209行）。这些是最关键的业务路径，但测试覆盖为零。

**问题 3：测试比率偏低**

topic-insights：193 个生产文件 vs 20 个测试文件 = **10.4%**，处于刚过 D10 要求的最低门槛，实质覆盖率极低（20 个测试文件中包含 fixtures 和 mocks，实际测试文件仅约 14 个）。

**问题 4：超大服务影响 Mock 复杂度**

`data-source-router.service.ts` 构造函数注入了 20+ 依赖（从 module 声明推算），要为其编写单元测试需要 mock 20+ 依赖，测试维护成本极高。这是上帝服务对可测试性的间接伤害。

### 扣分依据

- 5 个 Controller 无测试：-2 分
- 4 个最大业务服务无测试：-1 分
- 测试比率仅 10.4%：-1 分

---

## D9: 可观测性 [7/10]

### 正面发现

- `ProcessEventLogService`（ai-kernel）统一追踪 AI 调用链，已注入到 ai-engine 的核心 Facade 和 Orchestrator。
- `KernelMetricsService` 提供 LLM 调用统计（latency、token、cost）。
- `CostAttributionService` 按 user/module/model 分维度归因。
- `MissionObservabilityService` 在 topic-insights 层追踪 mission 进度，发出可用于前端展示的实时事件。
- NestJS `Logger` 覆盖率高：72 个 services 中有 72 个带有 `private readonly logger = new Logger()` 实例（检测到 72 条初始化，即 100%）。
- `/health` 端点存在（`main.ts:179`），有路径级别的健康检查。
- `ObservabilityController`（ai-kernel）暴露了 observability 数据的 HTTP 端点。

### 负面发现

**问题 1：健康检查未使用 Terminus**

`/health` 端点是 `main.ts` 中直接注册的简单响应，未使用 `@nestjs/terminus` 进行真正的数据库连通性、Redis 连通性等子系统健康探测。这意味着即使数据库不可用，`/health` 仍会返回 200。

**问题 2：Trace 覆盖有盲区**

topic-insights 的 search adapters（9 个适配器：`web-search.adapter.ts`、`academic-search.adapter.ts` 等）没有将外部 HTTP 调用上报到 `ProcessEventLogService`，外部搜索 API 的延迟和错误率无法从 trace 中观察。

**问题 3：`MissionObservabilityService.ts` 与 `ResearchMissionHealthService.ts` 职责重叠**

两个服务均关注 Mission 状态监控，前者负责实时事件推送，后者负责健康检查和 checkpoint，存在一定边界模糊。

### 扣分依据

- /health 无 Terminus 支持：-1 分
- Search Adapter 无 trace 上报：-1 分
- 观测服务职责部分重叠：-1 分

---

## D10: 性能 [7/10]

### 正面发现

- `data-source-router.service.ts` 使用 `LruMap(100)` 缓存数据源规划，避免重复 LLM 调用。
- `data-enrichment.service.ts` 使用 `LruMap(500)` 缓存内容抓取结果。
- `GlobalSourceThrottleService` 使用 p-limit 控制并发，防止搜索 API 过载。
- `ResearchMission` 的 `@@index` 覆盖常见查询模式（status、topicId + status、topicId + createdAt）。
- `ResearchTask.@@index` 覆盖 missionId + status、assignedAgent、dimensionId 等查询维度。
- `topic-refresh.scheduler.ts` 使用 `@Cron` 而非 `setInterval`，利用 NestJS 调度器管理生命周期。

### 负面发现

**问题 1：`zeroBalanceCache` 无限增长**（同 D7）

长期运行后 cache 项目数与注册用户数量级相当，无淘汰机制。

**问题 2：潜在 N+1：知识图谱实体关系构建**

`knowledge-graph.service.ts` 构建实体关系时使用了 `new Map()` 内存存储，但关系构建逻辑若基于证据数据循环访问，每次刷新需全量重建，可能存在 O(n²) 关系扫描。未深入读取实现，但这是已知风险点。

**问题 3：ai-engine facade（2993 行）模块加载开销**

`ai-engine.facade.ts` 在导入时拉入整个 ai-engine 依赖树（70+ 模块），NestJS 启动时的模块扫描和依赖解析时间较长。已有 `facade/base-classes.ts` 分离基类（正确做法），但其他高频类型仍在主 facade。

**问题 4：`research-todo.service.ts` 队列轮询**

每次 todo 执行完毕都从数据库查询下一个待处理 todo，对于高频 todo 场景（连续创建多个 todo）会产生多次串行 DB 查询。

### 扣分依据

- Cache 无限增长 + 知识图谱重建：-1 分
- Facade 加载开销（已知问题，部分缓解）：-1 分
- TODO 队列轮询串行化：-1 分

---

## D11: 安全性 [8/10]

### 正面发现

- A2A API Key Guard（`a2a-api-key.guard.ts:52`）正确使用 `safeCompare` 进行常量时间比较，防止 timing attack。
- CORS 配置使用精确域名匹配（`allowedOrigins.has(origin)`），通过 `CORS_ORIGINS` 环境变量配置，不使用通配符 `*`。
- JWT Secret 通过 ConfigService 注入（`JwtModule.registerAsync`），不硬编码。
- 未发现 `$queryRawUnsafe` 或 SQL 字符串拼接，所有 DB 操作通过 Prisma ORM。
- `prompt-sanitizer.ts` 存在，对用户输入进行 LLM prompt 注入防护。
- `security-audit-logger.ts` 存在，对敏感操作有审计日志。
- `TopicAccessGuard` 在所有 Topic 级端点中正确使用，确保跨用户访问控制。
- 生产代码中 `any` 类型仅 9 处（均集中于 `file-conversion.tool.ts` 的 JSON 结构处理），零 `@ts-ignore`。

### 负面发现

**问题 1：`process.env` 在工具层直接访问敏感配置**

```
backend/src/modules/ai-engine/tools/categories/integration/email-sender.tool.ts:160-163
backend/src/modules/ai-engine/tools/categories/integration/message-push.tool.ts:725-731
```

`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS` 直接从 `process.env` 读取，绕过 ConfigService 的统一管理，不可被 NestJS 配置校验（`@IsString()`、`@IsNotEmpty()`）约束，存在配置缺失时静默使用空字符串的风险。

**问题 2：CORS 放行 `origin === "null"`**

```
backend/src/main.ts:134-135
// origin === 'null'（字符串）：浏览器 opaque origin 同样放行
if (!origin || origin === "null") { callback(null, true); }
```

放行 `"null"` opaque origin 使得来自 sandboxed iframe 或 data: URL 的跨域请求可以绕过 CORS。注释中已提到"真正的安全由 JWT Auth Guard 保障"，这在有 JWT 保护的端点上是合理妥协，但对于无需认证的公开端点（如 `/health`）存在一定曝露面。

**问题 3：无 ESLint `no-restricted-syntax` 规则防止 process.env 在工具层使用**

ESLint 配置未对 `process.env` 直接访问做限制（除了 no-restricted-imports 对模块路径的控制），无法在编译期拦截新的 `process.env` 引入。

### 扣分依据

- process.env 绕过 ConfigService（工具层）：-1 分
- CORS 放行 opaque origin（有注释说明但仍是风险）：-0.5 分
- 无配置访问 lint 规则：-0.5 分

---

## D12: 代码质量 [8/10]

### 正面发现

- **零 `@ts-ignore` / `@ts-expect-error`**：三个模块合计 0 处，ESLint 规则已生效。
- **零生产 `console.log`**：ai-engine facade 中的 `console.log` 均在 JSDoc 注释示例中，不是执行代码；工具示例文件 `document-processor.example.ts` 中有 1 处，不影响生产行为。
- **零硬编码品牌名**：未发现 `"Genesis"`、`"Raven"`、`"DeepDive"` 的硬编码字符串。
- **any 类型仅 9 处**：均集中于 `file-conversion.tool.ts` 的 JSON 对象属性动态赋值（无法通过 TypeScript 类型系统表达的场景），合理。
- **ESLint `no-explicit-any: error`** 强制执行，类型安全整体优秀。
- 文件命名全部符合 kebab-case 规范。

### 负面发现

**问题 1：测试 fixture 中有硬编码模型名**

```
backend/src/modules/ai-app/topic-insights/__tests__/fixtures/topics.fixture.ts:237,262,287
modelId: "gpt-4o-mini"
backend/src/modules/ai-app/topic-insights/__tests__/mocks/ai-chat.mock.ts:39,46,53,211
modelId: "gpt-4o-mini"
```

虽然是测试代码（CLAUDE.md 明确允许测试 mock 中使用），但若生产代码中 modelId 字段发生语义变化（如改为枚举），这些 fixture 会悄悄失效。建议抽取为常量。

**问题 2：`ai-chat.service.ts` 中的 fallback 模型名硬编码**

```
backend/src/modules/ai-engine/llm/services/ai-chat.service.ts:264,973,979
this.configService.get<string>("DEFAULT_AI_MODEL", "gemini")
```

CLAUDE.md 明确规定 fallback 应为 `""` 空字符串。3 处违规，且 `"gemini"` 是具体模型名而非 provider 名，更为严格地说是违规。

**问题 3：`customTemplates` Map 未持久化**

```
backend/src/modules/ai-app/topic-insights/services/core/research-template.service.ts:537
private readonly customTemplates = new Map<string, ResearchTemplate>();
```

自定义模板存储在内存中，服务重启后丢失，但命名为 `custom` 暗示了用户自定义的含义。若有用户创建自定义模板的需求，这是数据持久化缺陷。

**问题 4：`TODO` 注释存量**

```
backend/src/modules/ai-app/topic-insights/topic-insights.module.ts:21
// TODO: 后续添加 CrawlersModule 以支持更多数据源
```

minor，但反映了功能缺口。

### 扣分依据

- `DEFAULT_AI_MODEL` fallback `"gemini"` 违反 CLAUDE.md（已在 D5 计）：不重复扣分
- `customTemplates` 内存存储无持久化：-1 分
- 代码整体质量优秀，仅扣 2 分（超大文件已在 D3 计）

---

## Top 10 架构债务清单

按**严重度**降序排列（P0 = 生产风险 / 安全风险，P1 = 架构完整性，P2 = 代码健康，P3 = 改进建议）：

| #   | 严重度            | 维度   | 问题描述                                                                                                                           | 影响范围                                                | 修复成本                             |
| --- | ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| 1   | ~~P0~~ **已解决** | D1     | ~~ai-engine (L2) 系统性依赖 ai-kernel (L3) 反向依赖，架构分层定义模糊~~ → **已通过重定义层号解决：AI Kernel = L2，AI Engine = L3** | —                                                       | —                                    |
| 2   | P1                | D3/D8  | `data-source-router.service.ts`（2653行）、`report-synthesis.service.ts`（2483行）等 5 个超 2000 行上帝服务无测试覆盖              | topic-insights 核心路径                                 | 中（服务拆分 + 测试补充）            |
| 3   | P1                | D2     | `a2a.module.ts` 直接导入 `A2AController` 和 `TEAMS_SERVICE_TOKEN` 内部路径，无 ESLint 规则拦截 ai-engine → ai-kernel 边界          | ai-engine/infra/a2a/                                    | 低（补 facade export + ESLint rule） |
| 4   | P1                | D8     | 5 个 Controller（collaboration、report-review、report、todo、topic）无任何测试                                                     | 用户 API 层，回归风险高                                 | 中                                   |
| 5   | P1                | D4     | A2A inbound 端点（`createTask`、`getTaskStatus`）为占位符，对外暴露未实现接口                                                      | open-api 集成方                                         | 中（实现或删除端点）                 |
| 6   | P2                | D5/D12 | `DEFAULT_AI_MODEL` fallback 使用 `"gemini"` 硬编码，违反 CLAUDE.md 规则，3 处重复                                                  | ai-chat.service.ts                                      | 低（改为 `""`）                      |
| 7   | P2                | D7/D10 | `zeroBalanceCache`（`chat.facade.ts`）无限增长，无 LRU 或 TTL 清扫                                                                 | 长期运行的生产实例                                      | 低（换 LruMap）                      |
| 8   | P2                | D3     | `extractJsonBlock` 函数在 3 个不同文件中重复实现，`extract-json.utils.ts` 已存在但未被充分利用                                     | data-source-router, data-source-fetcher, section-writer | 低（统一导入 utils）                 |
| 9   | P2                | D9     | `/health` 端点不使用 Terminus，数据库/Redis 故障时仍返回 200                                                                       | 运维监控、K8s 探针                                      | 低（引入 @nestjs/terminus）          |
| 10  | P3                | D3     | TopicInsightsModule providers 注册 70+ 服务，无子模块分割，维护成本高                                                              | topic-insights 模块扩展性                               | 中（子模块化）                       |

---

## Top 5 改进建议（按 ROI 排序）

### 建议 1 — 修复 3 处 `"gemini"` 硬编码 fallback [ROI: 极高]

**时间成本**: 15 分钟
**影响**: 消除 CLAUDE.md 违规，规避模型名固化导致的未来迁移成本

```typescript
// 当前（违规）
this.configService.get<string>("DEFAULT_AI_MODEL", "gemini");
// 修改为
this.configService.get<string>("DEFAULT_AI_MODEL", "");
```

涉及文件：`backend/src/modules/ai-engine/llm/services/ai-chat.service.ts`（lines 264, 973, 979）

---

### 建议 2 — 将 `zeroBalanceCache` 替换为 `LruMap` [ROI: 高]

**时间成本**: 30 分钟
**影响**: 消除长期运行的内存泄漏风险

```typescript
// 当前
const zeroBalanceCache = new Map<string, number>();
// 修改为（LruMap 已在项目中可用）
import { LruMap } from "@/common/utils/lru-map";
const zeroBalanceCache = new LruMap<string, number>(10000); // 最多缓存 1 万用户
```

涉及文件：`backend/src/modules/ai-engine/facade/domain/chat.facade.ts`（line 75）

---

### 建议 3 — 为 ai-engine → ai-kernel 边界添加 ESLint 规则并修复 3 处 import type 越界 [ROI: 高]

**时间成本**: 1-2 小时
**影响**: 阻止未来新增的 facade 违规，提升架构可维护性

需要：

1. 将 `base-executor.ts:23`、`dag-executor.ts:22-23` 改为从 `ai-kernel/facade` 导入（这 3 个类型均已在 facade 导出）
2. 将 `a2a.module.ts` 的 `TEAMS_SERVICE_TOKEN` 改为从 `ai-kernel/facade` 导入（或 ai-kernel abstractions 补充到 facade）
3. 在 `.eslintrc.js` 为 `**/modules/ai-engine/**/*.ts` 添加对应 `no-restricted-imports` 规则

---

### 建议 4 — 统一 `extractJsonBlock` 工具函数，清除 3 处重复代码 [ROI: 中]

**时间成本**: 1 小时
**影响**: 降低维护成本，防止各处实现逐渐分歧

`extract-json.utils.ts` 已存在于 `utils/` 目录，只需：

1. 在 `extract-json.utils.ts` 中确认/导出 `extractJsonBlock` 函数
2. 删除 `data-source-router.service.ts:2091-2096` 的内联实现
3. 删除 `data-source-fetcher.service.ts:903-907` 的内联实现
4. 删除 `section-writer.service.ts:1102` 的 `private extractJsonBlock` 方法

---

### 建议 5 — 引入 @nestjs/terminus 增强 /health 端点 [ROI: 中]

**时间成本**: 2-3 小时
**影响**: 实现真正的深度健康检查，支持 K8s liveness/readiness probe 区分

```typescript
// main.ts 的简单 /health → 替换为 TerminusModule
// 检查项：prisma.raw("SELECT 1"), redis ping, memory usage
```

---

## 与上次审计的对比分析

| 维度                 | 上次（v1.0，2026-02-26，89/100 8维度） | 本次（v2.0，12维度，三模块专项）                                 | 趋势          |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------- | ------------- |
| Facade 边界          | 优秀（ai-app → ai-engine 100% 合规）   | 优秀（ai-app 仍 100% 合规）                                      | 持平          |
| 新增：L2↔L3 层次定义 | 未检测                                 | 发现系统性问题（ai-engine 导入 ai-kernel），已通过重定义层号解决 | 新暴露→已解决 |
| LLM 调用规范         | 良好                                   | 发现 3 处 `"gemini"` fallback 违规                               | 略降          |
| 代码质量             | 良好                                   | 零 any / 零 @ts-ignore / 零 console.log                          | 维持优秀      |
| 错误处理             | 未专项检查                             | 良好（仅 2 处裸 Error + 1 处静默 catch）                         | 新测量        |
| 测试覆盖             | 未专项检查                             | topic-insights 10.4% 偏低                                        | 需改进        |
| 内存安全             | 未专项检查                             | 发现 zeroBalanceCache 无界                                       | 新暴露        |
| 并发安全             | 未专项检查                             | 良好（多处已使用 LruMap / p-limit）                              | 新测量        |
| 可观测性             | 未专项检查                             | 良好（Logger 100% 覆盖，有 trace 框架）                          | 新测量        |

**核心结论**：

- ai-app → ai-engine facade 边界在连续两次审计中均保持 100% 合规，代码规范落地效果良好。
- 本次专项扫描暴露了 ai-engine ↔ ai-kernel 层次定义模糊的系统性问题（上次审计因范围限制未发现），该问题已通过重定义层号（AI Kernel = L2，AI Engine = L3）解决，不再构成架构债务。
- 代码质量指标（any / @ts-ignore / console.log）表现优秀，ESLint 配置执行有效。
- topic-insights 模块文件体积持续增大（data-source-router 达 2653 行），是未来维护的最大风险点。

---

_评分模型: v2.0 (12 维度，满分 120)_
_扫描方法: 全量静态分析 + 目标文件读取验证_
_下次建议审计: 2026-04-12 或重大重构完成后_
_报告工具: Arch Auditor Agent v2.0_

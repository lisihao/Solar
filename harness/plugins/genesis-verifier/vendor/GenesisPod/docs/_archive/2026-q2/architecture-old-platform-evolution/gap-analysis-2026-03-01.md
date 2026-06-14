# Target Architecture Gap Analysis

> 对比 `ai-engine-target-architecture.md` 7-Phase 目标与当前代码实际状态。
> 日期: 2026-03-01 | Commit: 基于 main + 当前未提交变更

## Executive Summary

| Phase   | 描述                          | 状态        | 完成度 |
| ------- | ----------------------------- | ----------- | ------ |
| Phase 1 | Kernel 独立导出               | DONE        | 100%   |
| Phase 2 | 目录归位                      | MOSTLY DONE | 85%    |
| Phase 3 | AI Engine 内容模块下沉        | DONE        | 100%   |
| Phase 4 | AI Kernel L3 合规             | DONE        | 100%   |
| Phase 5 | 拆 God Facade → 5 领域 Facade | MOSTLY DONE | 85%    |
| Phase 6 | 消费者迁移到领域 Facade       | NOT STARTED | 5%     |
| Phase 7 | 去 @Global()                  | NOT STARTED | 0%     |

**整体进度: ~68%** (Phase 5 nearly complete 2026-03-01)

---

## Phase 1: Kernel 独立导出 - DONE (100%)

- `ai-kernel/facade/index.ts` 已创建，导出所有公开 API
- `KernelContext` 已下沉到 `common/context/`
- Engine facade 转发 kernel symbols 作为过渡兼容（30 行 re-export）

**剩余**: 无。Phase 6 会删除 Engine 对 Kernel 的转发。

---

## Phase 2: 目录归位 - MOSTLY DONE (85%)

### 已完成的迁移

| 迁移                                                                          | 状态                  |
| ----------------------------------------------------------------------------- | --------------------- |
| `agent-os/` → `intent-gateway/`                                               | DONE                  |
| `content/` → `ai-app/library/`                                                | DONE                  |
| `ingestion/` → `ai-app/library/ingestion/`                                    | DONE                  |
| `ai-app/rag/` → `ai-app/library/rag/`                                         | DONE                  |
| `admin/` → `open-api/admin/`                                                  | DONE                  |
| `feedback/` → `ai-app/feedback/`                                              | DONE                  |
| `integrations/` (feishu/notion/google-drive) → `ai-app/library/integrations/` | DONE                  |
| `ai-infra/facade/index.ts` 创建                                               | DONE (本次)           |
| ai-infra 消费者迁移走 facade                                                  | DONE (本次, 72 files) |

### 未完成

| 目标迁移          | 当前位置            | 目标位置               | 阻碍 |
| ----------------- | ------------------- | ---------------------- | ---- |
| ai-file-organizer | 已不存在于 ai-infra | 需确认是否已迁移或删除 | LOW  |
| proxy             | 已不存在于 ai-infra | 需确认是否已迁移或删除 | LOW  |

---

## Phase 3: AI Engine 内容模块下沉 - DONE (100%)

| 迁移                                                                | 状态 |
| ------------------------------------------------------------------- | ---- |
| `ai-engine/content/long-form/` → `ai-app/writing/content-engine/`   | DONE |
| `ai-engine/content/analysis/` → `ai-app/office/content-analysis/`   | DONE |
| `ai-engine/content/synthesis/` → `ai-app/office/content-synthesis/` | DONE |
| Engine content/ 只保留 `fetch/` + `image/` + `types/`               | DONE |

---

## Phase 4: AI Kernel L3 合规 - DONE (100%) [Fixed 2026-03-01]

### 问题: L2 (ai-engine) 大量直接导入 L3 (ai-kernel) 内部路径

**40+ 违规文件**, 集中在 ai-engine 内部。这些应该通过 `ai-kernel/facade` 导入。

### 违规清单 (Top 25)

| #   | 文件                                                                 | 直接导入的 kernel 内部路径                                                |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `ai-engine/agents/registry/agent-orchestrator.ts`                    | `ai-kernel/journal/`, `ai-kernel/security/`, `ai-kernel/context/`         |
| 2   | `ai-engine/llm/services/ai-chat.service.ts`                          | `ai-kernel/journal/`, `ai-kernel/observability/` x2, `ai-kernel/context/` |
| 3   | `ai-engine/teams/teams.module.ts`                                    | `ai-kernel/mission/`, `ai-kernel/journal/`                                |
| 4   | `ai-engine/teams/orchestrator/mission-orchestrator.ts`               | `ai-kernel/mission/`, `ai-kernel/journal/`                                |
| 5   | `ai-engine/infra/observability/ai-observability.service.ts`          | `ai-kernel/observability/` (re-export shim)                               |
| 6   | `ai-engine/infra/observability/cost-attribution.service.ts`          | `ai-kernel/observability/` (re-export shim)                               |
| 7   | `ai-engine/infra/observability/trace-collector.service.ts`           | `ai-kernel/observability/` (re-export shim)                               |
| 8   | `ai-engine/infra/a2a/` (5 files)                                     | `ai-kernel/ipc/a2a/` (re-export shims)                                    |
| 9   | `ai-engine/infra/realtime/services/` (2 files)                       | `ai-kernel/ipc/` (re-export shims)                                        |
| 10  | `ai-engine/knowledge/memory/stores/short-term-memory.service.ts`     | `ai-kernel/memory/` (re-export shim)                                      |
| 11  | `ai-engine/orchestration/checkpoints/checkpoint-manager.ts`          | `ai-kernel/journal/` (re-export shim)                                     |
| 12  | `ai-engine/orchestration/services/circuit-breaker.service.ts`        | `ai-kernel/resource/` (re-export shim)                                    |
| 13  | `ai-engine/orchestration/services/constraint-enforcement.service.ts` | `ai-kernel/resource/` (re-export shim)                                    |
| 14  | `ai-engine/orchestration/state-machine/execution-state.manager.ts`   | `ai-kernel/supervisor/` (re-export shim)                                  |
| 15  | `ai-engine/teams/services/a2a-message-bus.service.ts`                | `ai-kernel/ipc/` (re-export shim)                                         |
| 16  | `ai-engine/teams/constraints/constraint-engine.ts`                   | `ai-kernel/resource/` (re-export shim)                                    |
| 17  | `ai-engine/safety/constraint/guardrails/rate-limiter.ts`             | `ai-kernel/resource/` (re-export shim)                                    |
| 18  | `ai-engine/safety/constraint/guardrails/cost-controller.ts`          | `ai-kernel/resource/` (re-export shim)                                    |
| 19  | `open-api/admin/kernel-admin.controller.ts`                          | `ai-kernel/api/`                                                          |

### Kernel Facade 缺失的导出 (13 symbols)

以下 symbol 被外部消费者使用但未在 `ai-kernel/facade/index.ts` 中导出:

1. `CostAttributionService` (observability)
2. `ObservabilityController` (observability)
3. `A2AController` (ipc/a2a)
4. `A2AClientService` (ipc/a2a)
5. `A2ATeamMemberAdapter` (ipc/a2a)
6. `AgentCardRegistry` (ipc/a2a)
7. `A2AApiKeyGuard` (ipc/a2a)
8. `ProgressTrackerService` (ipc)
9. `CircuitBreakerService` (resource)
10. `ConstraintEnforcementService` (resource)
11. `ConstraintEngine` (resource)
12. `RateLimiter` (resource)
13. `CostController` (resource)

### 修复计划

**Step 1**: 将 13 个缺失 symbol 添加到 `ai-kernel/facade/index.ts`
**Step 2**: 将 25+ 个 ai-engine 文件的直接 kernel import 改为通过 `ai-kernel/facade`
**Step 3**: `open-api/admin/kernel-admin.controller.ts` 改为通过 facade 导入

**预估工作量**: M (25+ 文件修改, ~100 行 import 变更)

---

## Phase 5: 拆 God Facade → 5 领域 Facade - MOSTLY DONE (85%)

### 已完成

- 5 个领域 Facade 文件已创建并通过 `facade/index.ts` 导出
- **审计**: 100 个方法中 97 个已有领域 Facade 覆盖 (97%)
- **新增覆盖** (2026-03-01):
  - RAGFacade: `get embedding`, `get vector`, `get contentFetch` getters
  - ChatFacade: `checkConstraints()`, `get modelFallback`
  - AgentFacade: `get circuitBreaker`
- AIEngineFacade 类级别已标记 `@deprecated`
- Group B 跨层方法已标记 `@deprecated`: `longContentEngine`, `continuationProtocol`

### 未覆盖 (3 个方法 — 刻意保留)

| 方法                            | 原因                                          | 处置计划                |
| ------------------------------- | --------------------------------------------- | ----------------------- |
| `registerResearchExecutor`      | 跨层注册桥 (L5→L2→L4)                         | Phase 6 重构为直接 DI   |
| `executeDirectResearch`         | 跨层执行桥 (L5→L2→L4)                         | Phase 6 重构为直接 DI   |
| `INTENT_CONFIRMATION_THRESHOLD` | 静态常量, 消费者应从 IntentRouterService 导入 | Phase 6 迁移 1 个消费者 |

### 未完成

| 项目                                            | 状态                                   |
| ----------------------------------------------- | -------------------------------------- |
| AIEngineFacade 变 thin shim (委托到领域 Facade) | NOT DONE — 2971 行, 方法仍有自己的实现 |
| facade/index.ts 精简到类型+常量                 | NOT DONE — 仍是 399+ 行 139 export     |

**预估工作量**: M (委托逻辑可渐进实施，Phase 6 消费者迁移后 God Object 自然变空)

---

## Phase 6: 消费者迁移到领域 Facade - NOT STARTED (5%)

### 目标

将 137+ 个文件从 `AIEngineFacade` 迁移到对应的领域 Facade:

- Ask → `ChatFacade`
- RAG/Library → `RAGFacade`
- Research/Teams → `AgentFacade` + `TeamFacade`
- Tools → `ToolFacade`

### 前置条件

- Phase 5 完成 (领域 Facade 方法覆盖 100%)
- Engine facade 删除 kernel re-export (30 行)

### 附加: 删除 Engine 对 Kernel 的转发

`ai-engine/facade/index.ts` 第 379-409 行 re-export 了 30 个 ai-kernel symbol。Phase 6 需删除这些行，所有消费者改为直接从 `ai-kernel/facade` 导入。

**预估工作量**: XL (137 文件 + 30 行 kernel re-export 清理)

---

## Phase 7: 去 @Global() - NOT STARTED (0%)

### 目标

- 拆 `AiEngineModule` → 5 个子 Module (Chat/RAG/Agent/Tool/Team)
- 拆 `AiKernelModule` → 按职责分 Module
- 所有消费者显式 `imports: [...]`
- 删除 AIEngineFacade 空壳

### 前置条件

- Phase 5 + 6 全部完成
- 所有消费者已迁移到领域 Facade

**预估工作量**: XL (架构级变更, 影响所有 .module.ts)

---

## Facade 利用率审计

### ai-infra Facade: DONE (本次新建 + 迁移 72 文件)

所有 ai-app/ai-engine/ai-kernel/open-api 模块已通过 `ai-infra/facade` 导入基础服务。

### ai-engine Facade: 高利用率, 3 个残留违规已修复

- 3 个测试文件直接导入 `ai-engine/llm/services/ai-chat.service` → 本次修复为 facade 导入
- 生产代码无违规

### ai-kernel Facade: 严重未充分利用

- 40+ 文件直接导入 kernel 内部路径
- 13 个 symbol 未在 facade 导出
- 主要违规者是 `ai-engine/` 内部 (而非 ai-app)
- 需要 Phase 4 来修复

---

## 优先级排序 (下一步行动)

| Priority | Phase | 任务                                               | 影响                | 工作量 |
| -------- | ----- | -------------------------------------------------- | ------------------- | ------ |
| P0       | 4     | Kernel facade 补充 13 个缺失导出 + 迁移 25 文件    | 消除 L2→L3 直接依赖 | M      |
| P1       | 5     | 审计 AIEngineFacade → 领域 Facade 覆盖度           | 为 Phase 6 做准备   | S      |
| P1       | 5     | AIEngineFacade 方法委托到领域 Facade + @deprecated | 消除 God Object     | L      |
| P2       | 6     | 消费者批量迁移 (137 files)                         | 完成架构解耦        | XL     |
| P3       | 6     | 删除 Engine facade 的 Kernel re-export             | 清理转发层          | S      |
| P4       | 7     | 去 @Global(), 显式模块导入                         | 依赖可追踪          | XL     |

---

## 当前 3 层 Facade 状态

```
ai-engine/facade/index.ts     → 410 行, 139+ export (含 30 行 kernel 转发)
                                 5 个领域 Facade 已创建但消费者未迁移
                                 AIEngineFacade 2951 行 God Object 仍在使用

ai-kernel/facade/index.ts     → 部分导出, 缺少 13 个 symbol
                                 40+ 外部文件绕过 facade 直接导入内部路径

ai-infra/facade/index.ts      → 本次新建, 30+ symbol 导出
                                 72 文件已完成迁移, 0 违规
```

# Rule · L2 ai-engine 内部禁止消费自己的 facade barrel

> 2026-04-24 沉淀。起因：Railway 生产 "LlmExecutor dependency at index [0]"
> DI 错误，根因是 ai-engine 内部 20+ 文件从 `@/modules/ai-engine/facade` 导入。

## 规则

**`backend/src/modules/ai-engine/**/\*.ts` 中任何文件都不得从以下路径导入任何符号：\*\*

- `@/modules/ai-engine/facade`
- `../ai-engine/facade`（任意相对深度指向 `ai-engine/facade/index.ts`）
- `./facade`（在 ai-engine 根目录下指向 facade barrel）

**唯一例外**：`ai-engine/facade/` 目录内部文件（facade 自身定义）。

## 为什么

`facade/index.ts` 是一个包含 50+ 子模块 re-export 的 barrel。它设计给 **L3 AI App**（`modules/ai-app/*`）做**单向**导入入口。

当 L2 ai-engine **内部**代码也从这个 barrel 导入时，会出现：

```
L2 子模块 A (e.g. llm/services/ai-chat.service.ts)
  → import from facade/index.ts
    → facade 再导出 B, C, D, E ...
      → B, C, D 可能反过来 depend on A (同样 facade 路径 or 直接)
      → TypeScript module-evaluation 阶段遇到循环，返回未初始化的 {}
      → 运行时 Nest DI 看到 class reference = undefined
      → 报 "Cannot resolve dependency at index [0]"
```

生产表现：

```
ERROR [ExceptionHandler] Nest can't resolve dependencies of the LlmExecutor (?).
Please make sure that the argument dependency at index [0] is available in
the HarnessModule context.
```

此时 LlmExecutor 的 index[0] 是 AiChatService；AiChatService 自己从 facade
barrel 导入而未能就绪。

## 正确做法

L2 内部导入走**直接相对路径**指向 **真实源文件**。例：

```typescript
// ❌ 错误
import { CircuitBreakerService } from "@/modules/ai-engine/facade";

// ✅ 正确
import { CircuitBreakerService } from "../runtime/resource/circuit-breaker.service";
```

符号 → 真实源路径的映射表：

| 符号                                          | 真实源                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `AiChatService`                               | `llm/services/ai-chat.service.ts`                                      |
| `CircuitBreakerService`, `TaskCompletionType` | `runtime/resource/circuit-breaker.service.ts`                          |
| `CostController`                              | `runtime/resource/cost-controller.ts`                                  |
| `RateLimiter`                                 | `runtime/resource/rate-limiter.ts`                                     |
| `ConstraintEnforcementService`                | `runtime/resource/constraint-enforcement.service.ts`                   |
| `ConstraintEngine`                            | `runtime/resource/constraint-engine.ts`                                |
| `ProcessSupervisorService`                    | `runtime/supervisor/process-supervisor.service.ts`                     |
| `CheckpointManager`                           | `runtime/journal/checkpoint-manager.ts`                                |
| `EventJournalService`                         | `runtime/journal/event-journal.service.ts`                             |
| `ProgressTrackerService`                      | `runtime/ipc/progress-tracker.service.ts`                              |
| `EventBusService`                             | `runtime/ipc/event-bus.service.ts`                                     |
| `MessageBusService`                           | `runtime/ipc/message-bus.service.ts`                                   |
| `AgentLifecycleProtocolService`               | `runtime/ipc/agent-lifecycle-protocol.service.ts`                      |
| `MissionExecutorService`                      | `runtime/mission/mission-executor.service.ts`                          |
| `HierarchicalMemoryCascadeService`            | `runtime/memory/hierarchical-memory-cascade.service.ts`                |
| `TraceCollectorService`                       | `runtime/observability/trace-collector.service.ts`                     |
| `AiObservabilityService`                      | `runtime/observability/ai-observability.service.ts`                    |
| `CostAttributionService`                      | `runtime/observability/cost-attribution.service.ts`                    |
| `SessionLatencyTrackerService`                | `runtime/observability/session-latency-tracker.service.ts`             |
| `CapabilityGuardService`                      | `runtime/security/capability-guard.service.ts`                         |
| `ModelElectionService`                        | `llm/election/index.ts`                                                |
| `KernelContext`                               | `common/context/kernel-context.ts` (注意：在 common/，不在 ai-engine/) |

## Nest v10 的 @Optional + forwardRef 副作用

即使没有 barrel 循环，以下组合在 Nest v10 也可能导致 sibling provider
resolution 不稳定：

```typescript
// HarnessModule
imports: [forwardRef(() => AiEngineLLMModule)],  // ← forward ref 模块边界
providers: [
  AgentFactory,  // ← 其构造函数里有 @Optional private election?: ModelElectionService
  LlmExecutor,   // ← 同一 list 的 sibling
]
```

Nest 在实例化 AgentFactory 时尝试 optional-resolve ModelElectionService（它来
自 forwardRef 模块），这个 resolution 的 side effect 可能弄乱 sibling
LlmExecutor 的 AiChatService 解析。

**缓解**：把 `@Optional` + forwardRef 依赖从 constructor 移到 **setter
injection**，在 `onApplicationBootstrap` 时 wire，此时所有 provider 已
instantiated。

HarnessModule 既有的 `setSubagentSpawner` 是这个模式的范例；新加的
`setElectionService` 同理。

## 自动化防护

建议 CI 加一步 grep check：

```bash
grep -rn "from [\"']@/modules/ai-engine/facade[\"']\|from [\"'].*ai-engine/facade[\"']" \
  backend/src/modules/ai-engine --include="*.ts" \
  | grep -v "__tests__\|\.spec\.ts\|facade/index.ts\|facade/ai-engine.facade.ts\|facade/base-classes.ts" \
  && { echo "Found L2 facade barrel import — violates rule 16"; exit 1; } \
  || echo "OK"
```

## 验证

2026-04-24 修复后：

- 扫描零违规（除 facade 自身文件）
- `tsc --noEmit` 0 err
- ai-engine + topic-insights 回归 13835 tests pass

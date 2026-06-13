# Exit Policy 子文档（Q3）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §1.4 / §10 Q3 / §13 P0
> **优先级**：P0

---

## 1. 问题域

ReAct/Reflexion Loop 的迭代必须有**多重独立出口**，单一 finalize 出口会被卡死的 LLM 拖到 budget 耗尽。每个出口必须：

1. 有标准 ExitReason
2. 有对应 partialOutput 兜底策略
3. 有标准化 failureCode + diagnostic 让上层做决策

---

## 2. ExitReason 枚举

```typescript
type ExitReason =
  // ─── 成功类 ────────────────────────────
  | "completed" // finalize + 校验全过
  // ─── 质量类（output 仍可用，但低于期望）─
  | "validation_rejected_max" // 校验 reject 达上限，强制接受次优产物
  // ─── 资源类 ────────────────────────────
  | "budget_exhausted" // tokensUsed >= maxTokens
  | "max_iterations" // iterations >= maxIterations
  | "wall_time_exceeded" // wallTime >= maxWallTimeMs
  // ─── 错误类 ────────────────────────────
  | "failed_parse" // LLM 输出无法 parse 成 action
  | "failed_tool" // 同一 toolId 连续 N 次失败
  | "failed_model" // 模型不可用 + fallback 链耗尽
  | "empty_response" // 连续空输出熔断
  // ─── 主动类 ────────────────────────────
  | "cancelled"; // abortSignal triggered
```

---

## 3. 优先级

```
cancelled > failed_* > budget_exhausted > wall_time > max_iterations > validation_rejected_max > completed
```

多个出口同时触发时取优先级最高，emit 一次 `terminated` 事件。

---

## 4. partialOutput 兜底策略

| ExitReason                | output           | partialOutput                             |
| ------------------------- | ---------------- | ----------------------------------------- |
| `completed`               | 必填             | undefined                                 |
| `validation_rejected_max` | 必填（强制接受） | undefined                                 |
| `budget_exhausted`        | undefined        | bestOutput so far（历轮最完整）           |
| `max_iterations`          | undefined        | bestOutput so far                         |
| `wall_time_exceeded`      | undefined        | bestOutput so far                         |
| `failed_parse`            | undefined        | 最后一次 finalize 候选（即使没过 schema） |
| `failed_tool`             | undefined        | 最后一次 finalize 候选                    |
| `failed_model`            | undefined        | 最后一次 finalize 候选                    |
| `empty_response`          | undefined        | 历轮最佳（reflexion bestOutput）          |
| `cancelled`               | undefined        | 已 finalize 但未通过校验的最后产物        |

---

## 5. 阈值（D2 / D7 / D9）

| 项                        | 默认值                         |
| ------------------------- | ------------------------------ |
| MAX_FINALIZE_REJECTS      | **3**（D2）                    |
| TOOL_CIRCUIT_THRESHOLD    | **3** 同 toolId 连续失败（D7） |
| MAX_WALL_TIME_PER_STAGE   | **180,000 ms**（D9）           |
| MAX_WALL_TIME_PER_MISSION | **1,800,000 ms**（D9）         |
| MAX_CONSECUTIVE_EMPTY     | **2**（reflexion 层）          |

---

## 6. failureCode + diagnostic

每个非 `completed` 出口必须 emit `error` 事件，含：

```typescript
{
  message: string;
  failureCode: HarnessFailureCode;     // 25 个标准枚举之一
  recoverable: boolean;
  diagnostic: {
    iteration?: number;
    modelId?: string;
    toolId?: string;
    consecutiveFailures?: number;
    elapsedMs?: number;
    tokensUsed?: number;
    bestScore?: number;
    // ... per-failureCode 特定字段
  };
  recoveryHint?: {
    action: 'retry'|'switch_model'|'abort'|'downgrade';
    reason: string;
    fallbackModelId?: string;
    retryAfterMs?: number;
  };
}
```

---

## 7. failureCode → ExitReason 映射表

| failureCode                      | ExitReason                |
| -------------------------------- | ------------------------- |
| `LOOP_BUDGET_EXHAUSTED`          | `budget_exhausted`        |
| `LOOP_MAX_ITERATIONS`            | `max_iterations`          |
| `LOOP_WALL_TIME_EXCEEDED`        | `wall_time_exceeded`      |
| `LOOP_REASONING_COT_EXHAUSTION`  | `failed_parse`            |
| `PARSE_INVALID_ACTION`           | `failed_parse`            |
| `PARSE_OUTPUT_NOT_JSON`          | `failed_parse`            |
| `TOOL_CIRCUIT_BROKEN`            | `failed_tool`             |
| `MODEL_UNAVAILABLE`              | `failed_model`            |
| `MODEL_FALLBACK_CHAIN_EXHAUSTED` | `failed_model`            |
| `REFLEXION_CONSECUTIVE_EMPTY`    | `empty_response`          |
| `REFLEXION_VERIFIER_LOW_SCORE`   | `validation_rejected_max` |
| `RUNNER_OUTPUT_SCHEMA_MISMATCH`  | `validation_rejected_max` |
| `BUSINESS_RULE_VIOLATION`        | `validation_rejected_max` |
| `USER_CANCELLED`                 | `cancelled`               |

---

## 8. 实现要点

- ReActLoop 主循环每 iter 后检查所有出口条件，按优先级判定
- ReflexionLoop 在 ACT 完后检查空响应熔断（`MAX_CONSECUTIVE_EMPTY=2`）
- `wall_time_exceeded` 是新增检查，需要在 Loop 入参 `criteria` 加 `maxWallTimeMs`
- `failed_tool` 熔断按 (toolId, consecutiveFailures) 计数，跨 iter 累计
- `terminated` 事件只 emit 一次（最高优先级出口）

---

## 9. 验收标准

- 任何 mission 失败必有 ExitReason + failureCode + diagnostic
- 上层 orchestrator 仅靠 RunResult 三段式即可决策（不需要扫 events）
- 失败路径 partialOutput 永远不为空（除真无产物的 `cancelled` 早期路径）
- wall_time 出口可独立触发（不依赖 budget）
- failed_tool 熔断后不再调该工具（其余工具不受影响）

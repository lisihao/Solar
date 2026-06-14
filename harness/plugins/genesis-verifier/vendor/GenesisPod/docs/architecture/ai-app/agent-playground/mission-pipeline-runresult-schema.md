# RunResult Schema 子文档（Q4）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §1.2 / §10 Q4 / §13 P0
> **优先级**：P0

---

## 1. 问题域

边界 1 出参 RunResult 必须 caller-friendly：成功/失败/降级三分支都有产物，元信息直挂不需要从 events 反推，工具使用快照可视化用。

---

## 2. 完整 schema

```typescript
interface RunResult<T = unknown> {
  // ─── 段 1：业务产物 ─────────────────────────────
  output?: T; // 校验全过的强类型产物
  partialOutput?: unknown; // 失败/降级路径的次优产物

  // ─── 段 2：终态 ─────────────────────────────────
  state: "completed" | "failed" | "cancelled" | "degraded";
  exitReason: ExitReason; // 见 exit-policy.md
  failureCode?: HarnessFailureCode; // state≠completed 时必填
  diagnostic?: Record<string, unknown>;
  recoveryHint?: {
    action: "retry" | "switch_model" | "abort" | "downgrade";
    reason: string;
    fallbackModelId?: string;
    retryAfterMs?: number;
  };

  // ─── 段 3：运行元信息 ──────────────────────────
  iterations: number;
  wallTimeMs: number;
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  costCents: number; // 已乘单价 + 含 fallback 累计
  modelTrail: readonly {
    iter: number;
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
  }[];
  events: IAgentEvent[]; // 完整事件流，可重放

  // ─── 段 4：工具使用快照 ────────────────────────
  toolsUsed: readonly {
    toolId: string;
    calls: number;
    totalLatencyMs: number;
    failures: number;
    avgTokensPerCall?: number;
  }[];
  toolsCatalogSnapshot: readonly string[]; // 本次召回给 LLM 看的工具 id 集

  // ─── 段 5：元数据 ──────────────────────────────
  meta: {
    agentId: string;
    specVersion?: string;
    sessionId?: string;
    startedAt: number;
    finishedAt: number;
  };
}
```

---

## 3. 字段填充时机

| 段                                    | 填充时机                                       |
| ------------------------------------- | ---------------------------------------------- |
| 1 output                              | finalize 校验全过                              |
| 1 partialOutput                       | 各 ExitReason 兜底策略（见 exit-policy.md §4） |
| 2 state                               | Loop run() 完成时计算                          |
| 2 exitReason                          | terminated 事件触发时                          |
| 2 failureCode/diagnostic/recoveryHint | error 事件最后一次                             |
| 3 iterations                          | Loop run() 累计                                |
| 3 wallTimeMs                          | finishedAt - startedAt                         |
| 3 tokensUsed                          | BudgetAccountant 累计                          |
| 3 costCents                           | BillingContext 累计                            |
| 3 modelTrail                          | 每 iter chat 完追加                            |
| 3 events                              | 全程 emit 累计                                 |
| 4 toolsUsed                           | 每 action_executed 累加                        |
| 4 toolsCatalogSnapshot                | tools_recalled 事件填充一次                    |
| 5 meta                                | run 开始 + 结束分别填充                        |

---

## 4. 与现有契约的差异

| 旧                                                    | 新                                                |
| ----------------------------------------------------- | ------------------------------------------------- |
| `RunResult { events, state, lastOutput, iterations }` | 完整三段式 + 元信息直挂                           |
| caller 调用 `extractTokenSpend(events)`               | caller 直接读 `r.tokensUsed.total`                |
| 失败后 `output` 可能是 undefined / "" / null          | `output` 严格 undefined；`partialOutput` 收纳兜底 |
| 仅有 `terminated.reason: 'budget'\|'completed'\|...`  | `exitReason` 10 种标准枚举                        |

---

## 5. caller 决策模板

```typescript
const r = await runner.run(Spec, input, opts);

switch (r.state) {
  case "completed":
    consume(r.output); // 强类型，业务直接用
    break;
  case "degraded":
    consume(r.partialOutput); // 降级使用
    logWarn(`degraded: ${r.exitReason}`);
    break;
  case "failed":
    if (r.recoveryHint?.action === "switch_model") {
      retry({ modelOverride: r.recoveryHint.fallbackModelId });
    } else {
      failureLearner.recordFailure(r.failureCode!, r.diagnostic);
      degrade();
    }
    break;
  case "cancelled":
    cleanup();
    break;
}
// 无论哪种 state 都可以：
metrics.record(r.tokensUsed.total, r.costCents, r.toolsUsed);
```

---

## 6. 验收标准

- caller 不再需要 `extractTokenSpend(events)` / `extractFailureMessage(events)` 等工具函数
- `state==='completed'` 时 `output` 必非空且符合 outputSchema
- `state!=='completed'` 时 `output===undefined` 且 `partialOutput` 有合理兜底（除 cancelled 早期）
- `tokensUsed.total === prompt + completion` 恒成立
- `toolsUsed.[].calls === ` 该工具的 action_executed 事件数

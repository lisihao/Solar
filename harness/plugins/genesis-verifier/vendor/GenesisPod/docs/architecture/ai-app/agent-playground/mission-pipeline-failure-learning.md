# Failure Learning 子文档（D6）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §3.4 [3.a] / §12 D6
> **优先级**：P0（已实现，文档化基线）

---

## 1. 问题域

跨 mission 学习失败模式：历史已知该 (agentSpec, prompt 前缀, model, failureCode) 撞过墙，下次同 key 命中时**预先**绕开失败 model（markModelDisabled），让 fallback 链直接走可行路径，不浪费 token 撞同一堵墙。

---

## 2. 数据模型

```typescript
// agent_failure_records 表
interface FailureRecord {
  id: string;
  key: {
    agentSpecId: string; // 如 'playground.researcher'
    modelId: string;
    systemPrompt: string; // hash 输入：topic::dim::language 等稳定 key
    failureCode: HarnessFailureCode;
  };
  count: number; // 同 key 出现次数
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastFallbackModel?: string; // 最近一次成功 workaround 用的 model
  resolvedAt?: Date; // recordSuccessfulFallback 后填
  diagnostic: Record<string, unknown>; // 最近一次的根因证据
}
```

---

## 3. 触发阈值（D6）

| 项                       | 取值           | 说明                                |
| ------------------------ | -------------- | ----------------------------------- |
| 触发预禁用               | **count >= 2** | 一次失败可能偶发，2+ 才确认稳定问题 |
| 必须有 lastFallbackModel | true           | 没有可行备选不能预禁用              |

---

## 4. 工作流（baseline §3.4 [3.a] 摘录）

```typescript
// [3.a] Researcher 启动前
const promptKey = `${topic}::${dim.name}::${language}`;
const knownFailures = await failureLearner.lookup({
  agentSpecId: 'playground.researcher',
  systemPrompt: promptKey,
});

const preDisabled: { failed: string; fallback: string }[] = [];
for (const rec of knownFailures) {
  if (rec.count >= 2 && rec.lastFallbackModel) {
    billing.markModelDisabled(rec.modelId, rec.lastFallbackModel);
    preDisabled.push({ failed: rec.modelId, fallback: rec.lastFallbackModel });
  }
}

// [3.b] Researcher 实际跑
const r = await runner.run(ResearcherAgent, ..., { environment: billing });

// [3.c] 跑完反馈给 FailureLearner
if (r.state !== 'completed') {
  // 失败：记录新失败模式
  await failureLearner.recordFailure({
    key: { agentSpecId, modelId: actualFailedModel, systemPrompt: promptKey, failureCode: r.failureCode! },
    diagnostic: r.diagnostic,
  });
} else if (preDisabled.length > 0) {
  // 成功且用了 fallback：记录 workaround 有效
  const actualModel = extractModelFromTrail(r.modelTrail);
  for (const pd of preDisabled) {
    if (actualModel === pd.fallback) {
      await failureLearner.recordSuccessfulFallback({ key: ..., fallbackModelId: pd.fallback });
    }
  }
}
```

---

## 5. emit 事件

```typescript
{
  type: 'failure-pattern:pre-applied',
  payload: {
    dimension: string,
    preDisabled: { failed: string; fallback: string }[],
    matchedRecords: number,
  }
}
```

---

## 6. 与 RuntimeEnv 的边界

- `BillingRuntimeEnvAdapter.markModelDisabled(failed, fallback)`：在本 mission 内禁用某 model
- `BillingRuntimeEnvAdapter.suggestFallback({ reason })`：当前 stage 失败时给恢复建议
- FailureLearner 只跨 mission 持久化，不直接干预 LLM 调用 —— 通过 envAdapter 间接生效

---

## 7. 实现要点

- promptKey 必须稳定可哈希（不含时间 / sessionId 等漂移字段）
- 同 key 的 record 会持续累积 count，不为每次失败建新行
- recordSuccessfulFallback 仅设 resolvedAt，不删除（保留历史可视化）
- 多种 failureCode 可能共用一组 (agentSpec, modelId, systemPrompt) → 分行存

---

## 8. 验收标准

- 第二次同 key 失败后预禁用，第三次不再撞同墙
- recordSuccessfulFallback 后，下次同 key 直接走 fallback model
- emit failure-pattern:pre-applied 含完整 preDisabled 列表
- DB 查询 (agentSpecId, systemPrompt) ⇒ failureRecords[] O(log n)（建索引）

---

## 9. 风险 / 边界

- promptKey 选择不当（如含 mission UUID）→ 永远命中不到
- model 升级后老的 failureRecord 仍生效 → 加 modelVersion 字段，定期清理过期记录
- 部分 failureCode（如 LOOP_BUDGET_EXHAUSTED）跟 model 无关 → 不预禁用，仅做 trace

# Finalize Gate 子文档（D2 / D8）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §3.4 / §10 Q3 / §12 D2 D8
> **优先级**：P0（已部分实现，待完善 D8 注入策略）

---

## 1. 问题域

LLM emit `finalize` 不等于"任务完成"。finalize 必须经过：

1. schema 校验（z.parse outputSchema）
2. business rule 校验（spec.validateBusinessRules）

任一不通过 → 不当作终止，而是 reject + critique 注入 reminder → 回 chat 让 LLM 修。
最多 reject N 次（D2=3）后强制接受次优产物（exitReason=`validation_rejected_max`）。

---

## 2. 校验闸位置

```
ReActLoop.executeAction(decision)
  ├─ kind: tool_call → ToolInvoker
  ├─ kind: parallel_tool_call → ToolInvoker.batch
  └─ kind: finalize
        ├─ Step 1: outputSchemaValidator(output) → { ok }|{ ok:false, issues }
        ├─ Step 2: validateBusinessRules(output) → string|null
        └─ 任一 fail → emit validation_failed + 累积 reminder + 继续 loop
            └─ 累积 ≥ MAX_FINALIZE_REJECTS=3 → 强制接受 + emit terminated('validation_rejected_max')
```

---

## 3. 关键阈值

| 项                   | 取值       | 说明                               |
| -------------------- | ---------- | ---------------------------------- |
| MAX_FINALIZE_REJECTS | **3**      | reject 上限（D2）                  |
| reminder 注入策略    | **累积式** | 每次 reject 追加，不替换上次（D8） |

---

## 4. reminder 注入策略（D8 = 累积式）

```typescript
// 每次 reject 后追加新的 reminder
envelope.append([
  {
    role: "user",
    content: [
      `# Validation Round ${rejectCount}/${MAX_FINALIZE_REJECTS}`,
      `Your finalize output failed validation:`,
      issues,
      ``,
      `Previous attempts:`,
      ...previousIssues, // 历轮 issues 累积
      ``,
      `Please address ALL issues and emit a new finalize action.`,
    ].join("\n"),
  },
]);
```

**为什么累积式**：

- LLM 容易"修一个忘一个"，累积式让它看到所有历史问题
- 与 ReflexionLoop 的 critique 注入策略一致

**为什么不是替换式**：

- 替换式只看最新一条 critique，可能反复在两个 issue 之间来回
- 累积式形成 progressive 学习曲线

---

## 5. emit 事件

```typescript
{
  type: 'validation_failed',
  payload: {
    rejectCount: number,
    maxRejects: 3,
    issues: string,                          // schema + business rule 合并
    candidateOutput: unknown,                // 该轮 finalize 的产物（可作 partialOutput 兜底）
  }
}
```

---

## 6. 强制接受时的 exitReason

```typescript
if (rejectCount >= MAX_FINALIZE_REJECTS) {
  // 选历轮"最完整"的 finalize 候选作为 partialOutput
  const bestCandidate = pickBestByCompleteness(allCandidates);
  emit("terminated", { exitReason: "validation_rejected_max" });
  return {
    state: "degraded",
    output: bestCandidate, // 注意：放在 output 而非 partialOutput
    // 因为 validation_rejected_max 视为"低于期望但可用"
    exitReason: "validation_rejected_max",
  };
}
```

---

## 7. 实现要点

- AgentRunner.materialize 已把 spec.outputSchema + spec.validateBusinessRules 包成 validator 函数（baseline §1.1）
- ReActLoop 已有 finalize 拦截 + reject 计数（已实现 baseline 当前状态）
- D8 累积式注入需要 envelope 维护 `previousValidationIssues: string[]` 状态
- candidateOutput 字段每次 reject 都更新到 envelope.metadata，最终被 ReActLoop 取到作 fallback

---

## 8. 验收标准

- finalize 不通过时不直接退出，而是 emit validation_failed + 继续 loop
- 第 3 次 reject 后强制接受 bestCandidate，state='degraded' / exitReason='validation_rejected_max'
- 累积式 reminder 让 LLM 看到所有历轮 issues
- 强制接受路径下 output 必非空（绝不返回 undefined）

---

## 9. 风险 / 边界

- LLM 可能在 reject 后"放弃"emit 空 finalize → 走 empty_response 熔断（exit-policy.md）
- bestCandidate 选择算法（按字段完整度评分）—— 简单实现：count non-empty required fields
- reject 累积可能让 prompt 越来越长 → 超 50K 时 baseline §9.1 Summarize-on-Handoff 处理

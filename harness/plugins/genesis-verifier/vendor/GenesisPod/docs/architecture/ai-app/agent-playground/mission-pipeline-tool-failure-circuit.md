# Tool Failure Circuit 子文档（D7）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §1.4 / §10 Q3 / §12 D7
> **优先级**：P0

---

## 1. 问题域

ReActLoop 内同一 toolId 连续失败时（如 web-search 暂时 503）会一直重试，浪费 token / 时间。需要熔断：连续 N 次同 toolId 失败 → emit `failed_tool` exitReason，退出 loop（partialOutput = bestSoFar）。

---

## 2. 阈值（D7）

| 项                     | 取值  |
| ---------------------- | ----- |
| TOOL_CIRCUIT_THRESHOLD | **3** |

---

## 3. 计数策略

```typescript
// ReActLoop 内维护
const toolFailureCounters = new Map<string, number>();

function onActionExecuted(action: Action, result: ActionResult) {
  if (action.kind !== 'tool_call' && action.kind !== 'parallel_tool_call') return;

  const toolIds = action.kind === 'tool_call' ? [action.toolId] : action.calls.map(c => c.toolId);

  for (const toolId of toolIds) {
    if (result.error) {
      toolFailureCounters.set(toolId, (toolFailureCounters.get(toolId) ?? 0) + 1);
      if (toolFailureCounters.get(toolId)! >= TOOL_CIRCUIT_THRESHOLD) {
        emit('terminated', { exitReason: 'failed_tool' });
        // partialOutput = 历轮最完整的 finalize 候选（同 baseline §1.4）
        return triggerExit('failed_tool', { toolId, consecutiveFailures: ... });
      }
    } else {
      // 成功 → 重置该 toolId 的计数器
      toolFailureCounters.set(toolId, 0);
    }
  }
}
```

**关键**：

- 计数按 `toolId` 区分（不同工具计数独立）
- 单工具一次成功立即重置计数（容忍 transient 故障）
- parallel_tool_call 中各 toolId 独立判定

---

## 4. failureCode + diagnostic

```typescript
{
  failureCode: 'TOOL_CIRCUIT_BROKEN',
  diagnostic: {
    toolId: 'web-search',
    consecutiveFailures: 3,
    lastError: 'HTTP 503 from upstream',
    elapsedMs: 12300,
  },
  recoveryHint: {
    action: 'switch_model',  // 不是切 tool（工具池可能就这一个），是切上层模型
    reason: 'tool service unavailable, try alternative model with built-in browse',
  }
}
```

---

## 5. 与 ToolInvoker 的协同

ToolInvoker 不感知熔断，照常返回 error。ReActLoop 在 onActionExecuted 钩子中维护计数器。

ToolRegistry 元数据可加 `circuitBreaker: { threshold?: number; resetMs?: number }` 字段做工具级配置，但本 baseline 不实现，全用全局 D7=3。

---

## 6. 实现要点

- 计数器在 ReActLoop 实例字段，不持久化（单 mission 单 stage 内闭环）
- 跨 stage 的失败模式由 FailureLearner 兜底（参 failure-learning.md）
- emit `terminated` 后立即退出 loop，不再 chat

---

## 7. 验收标准

- web-search 连续 3 次返回 error → exitReason=`failed_tool`
- web-search 失败 2 次后第 3 次成功 → 计数器重置，loop 继续
- parallel 调用中 web-search 失败 + arxiv-search 成功 → web-search 计数 +1，arxiv-search 重置
- diagnostic 含 toolId + consecutiveFailures + lastError

---

## 8. 风险 / 边界

- 工具失败可能因为 input 错（不是工具坏）→ 熔断后 recoveryHint 提示切模型而非永久禁工具
- 阈值 3 可能太严（某工具天生不稳定）→ 工具级 circuitBreaker 配置（p1）
- 用户期待"试一下别的工具" → 当前实现是退出 loop；未来可考虑"切到 hint 推荐的下一个 toolId"

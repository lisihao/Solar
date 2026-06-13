# Decision Examples

## Example 1: "事实提取" 能力

```
Q: 如果做 AI 客服，能复用吗？
A: 能。客服对话中也需要提取关键事实（客户问题、订单号等）

结论：放在 AI Engine (ContextEvolutionService)
```

## Example 2: "小说人物一致性检查" 能力

```
Q: 如果做 AI 客服，能复用吗？
A: 不能。这是小说特有的检查逻辑

Q: 是官方场景吗？
A: 不是。小说创作不是预定义场景

结论：放在 自定义 AI Teams 的配置中
```

## Example 3: "研究报告引用格式" 能力

```
Q: 如果做 AI 客服，能复用吗？
A: 不能。客服不需要引用格式

Q: 是官方场景吗？
A: 是。AI Studio 专门做研究报告

结论：放在 预定义 AI Teams (AI Studio) 的配置中
```

## AI Engine Capabilities

| Capability   | Service                      | Path                       |
| ------------ | ---------------------------- | -------------------------- |
| LLM 调用     | AiChatService                | `ai-engine/llm/`           |
| 搜索增强     | SearchService                | `ai-engine/search/`        |
| 任务分解     | TaskDecomposerService        | `ai-engine/orchestration/` |
| Agent 执行   | AgentExecutorService         | `ai-engine/orchestration/` |
| 输出审核     | OutputReviewerService        | `ai-engine/orchestration/` |
| 熔断器       | CircuitBreakerService        | `ai-engine/orchestration/` |
| Token 预算   | TokenBudgetService           | `ai-engine/orchestration/` |
| 上下文初始化 | ContextInitializationService | `ai-engine/orchestration/` |
| 上下文演进   | ContextEvolutionService      | `ai-engine/orchestration/` |

## Should Migrate to AI Engine

| Capability                   | Current Location | Reason                       |
| ---------------------------- | ---------------- | ---------------------------- |
| ConstraintEnforcementService | ai-app/teams     | Generic constraint mechanism |
| 长内容分块                   | ai-app/teams     | Generic chunking/merging     |

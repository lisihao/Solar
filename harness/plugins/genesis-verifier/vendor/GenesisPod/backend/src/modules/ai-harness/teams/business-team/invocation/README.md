# business-team / invocation

Agent 调用 framework：retry / abort / backoff / span lifecycle + DAG 并发调度。

## 含

- `business-team-agent-invoker.framework.ts` — `BusinessTeamAgentInvokerFramework`（P1；retry/backoff/abort 包装 + agent span/event forward + 业务 hook 注入）
- `business-team-dag-concurrency.ts` — `runDagConcurrency`：纯函数 DAG 调度器（in-memory 拓扑排序 + N 并发）
- `abstractions/business-team-agent-invoker.interface.ts` — `BusinessTeamAgentInvokerConfig` / `Hooks` / `InvocationContext`

## 业务侧应如何继承

`PlaygroundAgentInvoker extends BusinessTeamAgentInvokerFramework`：注入 retry 策略、span emitter、event forwarder（`makeAgentEventForwarder`）即得完整 invocation pipeline。多 agent stage 并发用 `runDagConcurrency(graph, runner)` 不需要 extends。

## 历史

- 2026-05-24 P1：从双源 ai-app 业务侧 invoker（playground + social/radar 旧 invoker 通用骨架）抽出（`@migrated-from`）。`runDagConcurrency` 自原 `agent-execution-support` 上提。

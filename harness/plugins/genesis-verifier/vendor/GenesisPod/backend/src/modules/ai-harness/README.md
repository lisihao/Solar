# ai-harness

> Agent 运行时与编排层。负责“agent 怎么跑”，不负责“agent 能做什么”。

## 定位

依赖方向严格单向：

```text
ai-app -> ai-harness -> ai-engine -> platform
```

（`platform` 是 L1 真实目录名，旧称 `ai-infra`；路径为 `modules/platform/`）

判断口径：

- 只要涉及 agent lifecycle、loop、mission/session state、memory semantics、team orchestration、runtime protocol，就归 `ai-harness`
- 只要是 LLM / tools / RAG / knowledge 等原子能力，就不归 `ai-harness`

## 当前顶层

```text
ai-harness/
├── agents/         # agent 定义、注册、builtin skills、学习与开发工具
├── evaluation/     # critique、judge、quality gate、figure evaluation
├── facade/         # 对外稳定入口
├── guardrails/     # runtime resource guardrails、billing、constraints
├── handoffs/       # agent handoff 与 registry
├── lifecycle/      # supervisor、learning、process lifecycle
├── memory/         # working memory、checkpoint、vector、indexing、consolidation
├── protocols/      # events、journal、ipc、realtime 等协议
├── runner/         # loop、executor、context、prompt、env、plan execution
├── teams/          # multi-agent team、orchestrator、collaboration
├── tracing/        # trace collection、otel tracer、span export
└── __tests__/      # harness-level integration / architecture-facing tests
```

## 明确边界

- `agents/`
  - 定义 agent 是什么、怎么装配
  - 不承载 engine 原子能力实现

- `runner/`
  - 负责一次 agent execution
  - 不承载业务域 mission 脚本

- `memory/`
  - 负责 harness 侧 memory semantics
  - embedding / vector primitive 仍依赖 engine 或 infra 底座

- `teams/`
  - 负责多 agent 编排
  - 不应回流 app 级具体专题流程

- `facade/`
  - 是 ai-app / open-api 消费 harness 的唯一稳定入口
  - 不允许把内部路径穿透当成长期做法

## benchmark Agent Team 沉淀拓扑

新 MissionPipeline 派 team(`playground` / `writing-team` / 未来 `debate-team`
/ `planning-team` 等)拷贝时的 canonical reference:

- 架构文档:[`docs/architecture/ai-harness/facade/sediment-topology.md`](../../../../docs/architecture/ai-harness/facade/sediment-topology.md)
- 6 个共存 sediment zone(Z1 mission-lifecycle / Z2 mission-checkpoint / Z3 business-team
  framework / Z4 mission-pipeline-orchestrator / Z5 stage primitives / Z6 待裁定 mission
  executor)与 grep-verified 依赖边
- **所有 ai-harness import 路径必须为 `@/modules/ai-harness/facade`**(`backend/.eslintrc.js`
  Section 10 + R8 override 强制),sediment-topology.md 是 facade re-export 的逻辑分区参考

## 当前收敛重点

- 继续清理 `memory/` 的命名与 contract 一致性
- 限制 engine → harness 只保留受控 adapter / token 边界
- 把过时目录命名和测试残片从 harness 主树清掉

# L2.5 AI Harness

> Agent 运行时与编排层。负责"agent 怎么跑"，不负责"agent 能做什么"。
> 单一信息源：[`backend/src/modules/ai-harness/README.md`](../../../backend/src/modules/ai-harness/README.md)

## 11 个顶层聚合

| 聚合          | 代码路径                 | 职责                                                                |
| ------------- | ------------------------ | ------------------------------------------------------------------- |
| `agents/`     | `ai-harness/agents/`     | agent 定义、registry、subagent、builtin skills、learning            |
| `runner/`     | `ai-harness/runner/`     | loop / executor / context / prompt / env / plan execution           |
| `teams/`      | `ai-harness/teams/`      | multi-agent team / orchestrator / collaboration（含投票/辩论/审核） |
| `handoffs/`   | `ai-harness/handoffs/`   | agent handoff（OpenAI 标准）+ registry                              |
| `memory/`     | `ai-harness/memory/`     | working / vector / checkpoint / event-store / consolidation         |
| `protocols/`  | `ai-harness/protocols/`  | a2a / ipc / events / realtime / journal                             |
| `evaluation/` | `ai-harness/evaluation/` | critique / judge / quality gate / figure evaluation                 |
| `guardrails/` | `ai-harness/guardrails/` | budget / billing / rate-limit / concurrency / constraint            |
| `tracing/`    | `ai-harness/tracing/`    | otel / eval / latency / llm-events / attribution                    |
| `lifecycle/`  | `ai-harness/lifecycle/`  | hooks / supervisor / mission lifecycle / learning                   |
| `facade/`     | `ai-harness/facade/`     | 对外门面（仅 re-export + thin delegation）                          |

## 边界规则

- **不承载 engine 原子能力**：单次 LLM、单次 tool、单 skill execute 都在 L2 ai-engine
- **不承载 app 业务流程**：mission 业务脚本归 L3 ai-app
- 一切对外消费走 `ai-harness/facade`
- 依赖方向：`ai-app → ai-harness → ai-engine → platform`，禁止反向

## benchmark Agent Team 沉淀拓扑

详见 [sediment-topology.md](facade/sediment-topology.md) — `ai-harness` 内部存在 6 个共存
sediment zone(Z1 mission-lifecycle / Z2 mission-checkpoint / Z3 business-team
framework / Z4 mission-pipeline-orchestrator / Z5 stage primitives / Z6 待裁定
mission executor)。新 benchmark Agent Team(MissionPipeline 派)拷贝时,**仍通过
`ai-harness/facade` 间接消费 5 zone 公开符号**,sediment-topology.md 是 facade
re-export 的逻辑分区参考,不是直接 import 子路径授权。

## L2 vs L2.5 速查

| 概念                       | 归属         |
| -------------------------- | ------------ |
| 调一次 LLM                 | L2 ai-engine |
| 跑一次 ReAct loop          | L2.5 harness |
| 一个 SKILL.md 的 execute   | L2 ai-engine |
| Agent 怎么造 / 怎么跑      | L2.5 harness |
| Mission / multi-agent team | L2.5 harness |
| Tool 调用                  | L2 ai-engine |
| ToolInvoker（agent 视角）  | L2.5 harness |

## 跨聚合能力文档簇

| 能力簇            | 目录                                                                    | 说明                                                                                              |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Coding Agent      | [`coding-agent/`](coding-agent/coding-agent-feasibility-and-roadmap.md) | 编码 agent 可行性与路线                                                                           |
| 全自驱 Agent Team | [`self-driven-team/`](self-driven-team/README.md)                       | AI 问答伪模型入口 → Harness 自驱交付（横跨 teams/evaluation/lifecycle/protocols/runner + engine） |

> 能力簇 = 横跨多个聚合的端到端能力，不与任何单一聚合名重叠（MECE 合规）。

## 子目录说明

`protocols/` 已收纳 SSE / WebSocket 实时通信文档（旧 `ai-infra/realtime/` 已并入）。

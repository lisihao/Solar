# AI Engine — L2 核心能力层

> GenesisPod 五层架构 (L4 → L3 → L2.5 → L2 → L1) 中的 **L2 引擎层**：
> 提供"原子能力"。无 Agent 概念、无 mission 概念、无 process 概念。
> 上层 (L2.5 ai-harness) 编排这些原子能力组装出 agent 运行时。
>
> **依赖方向**：ai-engine → platform（L1，真实目录 `modules/platform/`，旧称 ai-infra）。**禁止反向 import** ai-harness / ai-app / open-api。
> 运行时需要 harness chat 能力的服务统一通过 `CHAT_PROVIDER_PORT` 注入，不允许直接 import `ChatFacade`。
> 目前唯一保留的直接 harness import 是 `skills/runtime/adapters/engine-skill-provider.adapter.ts`，它是 engine → harness 的窄口 provider adapter。
> 端口（Dependency Inversion 模式 — adapter 必然 import 它实现的端口接口）。

## 目录结构

```
ai-engine/
├── README.md
├── ai-engine.module.ts           ← 顶层聚合 module（imports 所有子 module）
├── index.ts                       ← top-level barrel
├── facade/                        ★ 对外门面与共享抽象
│   ├── abstractions/
│   └── exports/                   按子域切分的 re-export 桶
│
├── llm/                           ★ LLM 调用、适配、选型、定价
│   ├── abstractions/
│   ├── adapters/
│   ├── byok/                      自带 key 的运行时解析
│   ├── chat/                      AiChatService 等调用核心
│   ├── factory/
│   ├── image/
│   ├── models/                    模型元数据
│   │   ├── capability/
│   │   ├── catalog/
│   │   ├── config/
│   │   ├── pricing/
│   │   └── selection/             无状态择优
│   ├── output/                    structured / sanitization
│   ├── prompts/
│   ├── providers/
│   └── types/
│
├── tools/                         ★ 工具目录、执行与 source adapters
│   ├── abstractions/
│   ├── adapters/                  含 mcp/
│   ├── base/
│   ├── cache/
│   ├── categories/
│   ├── concurrency/
│   ├── middleware/
│   ├── registry/
│   ├── result-spill/
│   └── search-fusion/
│
├── rag/                           ★ RAG 基元
│   ├── abstractions/
│   ├── chunking/
│   ├── embedding/
│   ├── pipeline/
│   └── vector/
│
├── knowledge/                     ★ 知识抽取与组织
│   ├── consistency/
│   ├── evidence/
│   ├── extraction/
│   ├── rerank/
│   ├── search/
│   ├── synthesis/
│   └── world-building/
│
├── content/                       ★ 内容处理与格式化
│   ├── abstractions/
│   ├── citation/
│   ├── fetch/
│   ├── figure/
│   ├── image/
│   ├── markdown/
│   ├── report-template/
│   ├── sources/
│   └── types/
│
├── routing/                       ★ 请求→模型/技能/工具的无状态打分路由（W-2026-06-02）
│   └── eval/
│
├── reliability/                   ★ 引擎级韧性（W7）
│   ├── entity-health/
│   └── rate-limit/
│
├── evaluation/                    ★ 无状态启发式质量检查（无 LLM、无 agent 状态，W2）
│   ├── abstractions/
│   ├── checkers/
│   ├── services/
│   └── types/
│
├── skills/                        ★ Skill 定义、注册与运行时桥接
│   ├── abstractions/
│   ├── analytics/
│   ├── base/
│   ├── builder/
│   ├── content/
│   ├── ecosystem/
│   ├── loader/
│   ├── output-manager/
│   ├── registry/
│   ├── routing/
│   ├── runtime/
│   ├── sandbox/
│   ├── spec-builder/
│   └── types/
│
├── planning/                      ★ 通用规划/调控原语（与 agent 无关）
│   ├── budget/
│   ├── context/
│   ├── intent/                    intent-detection.service（项目唯一意图识别落点）
│   └── reflection/
│
└── safety/                        ★ 安全（pii/moderation/injection/guardrails tripwire）
    ├── guardrails/
    ├── moderation/
    ├── security/
    ├── utils/
    └── validation/
```

## 设计原则

1. **0 Agent 概念**：本层不知道什么是 agent / mission / process —— 那都是 L2.5 的事。
2. **0 反向依赖**：通过 verify:arch + ESLint no-restricted-imports 双重看护。
3. **facade 为唯一公共入口**：ai-app / ai-harness 必须从 `@/modules/ai-engine/facade` import。
4. **TaskProfile 优先**：所有 LLM 调用走 `aiChatService.chat({ taskProfile, modelType })`，禁止硬编码 modelId / temperature / maxTokens（CLAUDE.md 红线）。
5. **顶层保留 12 个规范聚合**（2026-06-02 核实）：`llm/tools/rag/knowledge/content/routing/reliability/evaluation/skills/planning/safety/facade`。其中 `routing`（W-2026-06-02）/`reliability`（W7）/`evaluation`（W2）为后续扩出；`credentials` 已于 2026-05-01 迁至 L1 `platform/credentials`（真实路径 `modules/platform/credentials/`）。
6. **NestJS module 按子目录就近**：每个能力子域有自己的 `*.module.ts`，集中在 `ai-engine.module.ts` 聚合。

## 与 L2.5 ai-harness 的边界

| 概念                       | 归属         | 原因                              |
| -------------------------- | ------------ | --------------------------------- |
| 调一次 LLM                 | L2 ai-engine | 原子能力                          |
| 跑一次 ReAct loop          | L2.5 harness | 多次 LLM + 多次 tool 的编排       |
| 一个 SKILL.md 的 execute   | L2 ai-engine | 单 skill 的运行                   |
| Agent 怎么造 / 怎么跑      | L2.5 harness | agent / loop / spec / hook        |
| Mission / multi-agent team | L2.5 harness | mission orchestrator + teams      |
| Tool 调用                  | L2 ai-engine | 单 tool（含 middleware pipeline） |
| ToolInvoker（agent 视角）  | L2.5 harness | 有 agent context 的工具调用包装   |

## 看护机制

- **verify:arch**：jest spec 锁定单向依赖（`backend/src/__tests__/architecture/layer-boundaries.spec.ts`）
- **ESLint no-restricted-imports**：`.eslintrc.js` 拦截 ai-engine → ai-harness 反向 import（K-adapter 唯一例外已 allowlist）
- **pre-push hook**：`.husky/pre-push` 第 0 步先跑 verify:arch

## 历史演进

- 早期 `modules/ai-kernel/`（已删，PR-7）：第一代 agent 运行时尝试，能力混进 engine
- `modules/ai-engine/runtime/`（已迁出，PR-X4 ~ PR-X10）：所有 agent 运行时下沉到 ai-harness
- 2026-05-02（W17）：顶层 `core/` 与 `abstractions/` 解散，补齐 `rag/`、`planning/`
- 2026-05-02（W20）：撤销 engine 顶层 `credentials/`，BYOK 运行时解析归入 `llm/byok`（含连接测试 / direct-key / 自动配置）
- 2026-05-01 (PR-X-Q ~ PR-X-U)：内部颗粒度统一 + 子 module 收到子目录
- 当前架构合规度 **9.85/10**（详见 [CLAUDE.md L4→L3→L2.5→L2→L1 规则](../../../.claude/CLAUDE.md)）

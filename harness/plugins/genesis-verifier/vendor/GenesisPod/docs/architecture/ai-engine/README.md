# L2 AI Engine

> 核心能力层。提供"原子能力"——无 agent / mission / process 概念。上层 (L2.5 ai-harness) 编排这些原子能力组装出 agent 运行时。
> 单一信息源：[`backend/src/modules/ai-engine/README.md`](../../../backend/src/modules/ai-engine/README.md)

## 12 个顶层聚合

| 聚合           | 代码路径                 | 职责                                                     |
| -------------- | ------------------------ | -------------------------------------------------------- |
| `facade/`      | `ai-engine/facade/`      | 对外门面与共享抽象                                       |
| `llm/`         | `ai-engine/llm/`         | LLM 调用、适配、选型、定价、prompt adaptation            |
| `tools/`       | `ai-engine/tools/`       | 工具目录、middleware pipeline、source adapters（含 MCP） |
| `rag/`         | `ai-engine/rag/`         | embedding / chunking / vector / pipeline                 |
| `knowledge/`   | `ai-engine/knowledge/`   | extraction / synthesis / rerank / world-building         |
| `content/`     | `ai-engine/content/`     | citation / fetch / figure / markdown / report-template   |
| `routing/`     | `ai-engine/routing/`     | 请求→模型/技能/工具的无状态打分路由                      |
| `reliability/` | `ai-engine/reliability/` | 引擎级韧性（rate-limit / entity-health）                 |
| `evaluation/`  | `ai-engine/evaluation/`  | 无状态启发式质量检查（无 LLM、无 agent 状态）            |
| `skills/`      | `ai-engine/skills/`      | SKILL.md 注册 + runtime + sandbox + ecosystem            |
| `planning/`    | `ai-engine/planning/`    | budget / context / intent / reflection                   |
| `safety/`      | `ai-engine/safety/`      | pii / moderation / injection / guardrails tripwire       |

## 设计原则

1. **0 Agent 概念** — 本层不知道什么是 agent / mission / process
2. **0 反向依赖** — `ai-engine → platform`（L1）单向，依靠 `verify:arch` + ESLint 双重看护
3. **facade 为唯一公共入口** — `ai-app` / `ai-harness` 必须从 `@/modules/ai-engine/facade` import
4. **TaskProfile 优先** — 所有 LLM 调用走 `aiChatService.chat({ taskProfile, modelType })`，禁止硬编码 modelId / temperature / maxTokens（CLAUDE.md 红线）
5. **MCP 在 engine 不在 harness** — tool source adapter，与 OpenAPI / function 同层

## TaskProfile 速查

| creativity      | temperature | 场景             |
| --------------- | ----------- | ---------------- |
| `deterministic` | 0.1         | 分类、提取、JSON |
| `low`           | 0.3         | 分析、总结       |
| `medium`        | 0.7         | 对话、研究       |
| `high`          | 0.9         | 创意写作         |

| outputLength | maxTokens | 场景     |
| ------------ | --------- | -------- |
| `minimal`    | 500       | 分类标签 |
| `short`      | 1500      | 摘要     |
| `medium`     | 4000      | 标准分析 |
| `long`       | 8000      | 报告章节 |
| `extended`   | 16000     | 完整文档 |

## 看护机制

- `verify:arch`（jest spec：`backend/src/__tests__/architecture/layer-boundaries.spec.ts`）
- ESLint `no-restricted-imports`（`.eslintrc.js`）
- `.husky/pre-push` 第 0 步先跑 `verify:arch`

## 当前架构合规度

**9.85/10**（详见代码 README）。

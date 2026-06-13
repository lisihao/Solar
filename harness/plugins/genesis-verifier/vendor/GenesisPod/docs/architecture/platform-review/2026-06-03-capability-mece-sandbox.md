# Genesis.ai 能力分层与目录 MECE 设计

> **日期**：2026-06-03
> **性质**：架构设计规范（非审计报告）——确立"一个能力归哪一层、哪个目录"的可执行判定规则，并据此给出目标态目录划分与能力汇聚建议
> **范围**：ai-app / ai-harness / ai-engine / platform / plugins / open-api 六层
> **关联**：[2026-05-30-layered-review-v2.md](2026-05-30-layered-review-v2.md)（安全/成熟度评审，本文不重复其结论）

---

## 0. 问题陈述

当前能力分布的问题不是"某个模块放错了",而是**缺少一条自顶向下、可执行的归属规则**——导致：

- 同一能力散落多处（凭证 6 处、可观测性 3 处、限流 5 处），无单一权威实现；
- 同名概念跨层复用（`evaluation`、`planning`、`teams`、`storage` 各两处）；
- 归属靠个案讨论而非规则推导，新能力落地时无据可依；
- 文档与实现漂移（`ai-infra` 已改名 `platform`、`src/plugins/` 层未入 CLAUDE.md）。

本文的解法：先定**分工原则**（每层一句话契约）→ 再给**MECE 决策树**（任意能力 → 唯一归属）→ 据此推出**目标目录划分** → 最后把散落能力**逐个过决策树汇聚**。

---

## 1. 自顶向下的分工原则（六层职责契约）

依赖方向严格单向：**L4 → L3 → L2.5 → L2 → L1**；L0 plugins 横切，由 L1 通过 DI token 消费。

| 层                  | 唯一职责                       | 必须拥有                                                                                       | 禁止拥有                                     | 一句话判定测试                                    |
| ------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------- |
| **L4 open-api**     | 协议与对外契约适配             | REST/RPC/MCP/A2A controller、鉴权、DTO、SSE 编排                                               | 业务逻辑、持久化策略、能力实现               | "删掉它，能力仍在，只是少了对外入口"              |
| **L3 ai-app**       | 特定业务场景的编排与体验       | 业务流程、UX 状态、领域模型、stage adapter、向 registry 注册自有 agent/team/skill              | 通用 AI 基元、运行时引擎、基础设施           | "换一个产品形态就不再需要它"                      |
| **L2.5 ai-harness** | agent / mission 的运行时编排   | agent 实例与循环、mission 生命周期、记忆/检查点、团队协作框架、agent 间协议、运行时 guardrail  | 无 agent 概念的纯基元、具体业务、对外协议    | "它必然引用 agent / mission / session 运行时状态" |
| **L2 ai-engine**    | 无状态 AI 基元                 | LLM 调用/适配/选型/定价、RAG、知识抽取、内容处理、工具与技能**定义**、无状态质量检查、安全护栏 | agent/mission 状态、业务、基础设施           | "给定输入即可纯函数式断言输出，无需 agent 上下文" |
| **L1 platform**     | 与 AI 无关也成立的通用基础设施 | auth、密钥/加密/secret、存储编排、监控/审计、通知/邮件、计费/额度、韧性、DB 运维、配置、发布   | AI/模型/agent 语义、可替换后端的**具体实现** | "一个非 AI 的 SaaS 也会需要它"                    |
| **L0 plugins**      | 可替换 / 可选的具体后端实现    | 经 manifest + hook + capability 接入的 backend（R2/redis/pgvector/otel-exporter…）             | 核心契约、被多处直接 import 的逻辑           | "能在不改核心代码的前提下换掉或卸载"              |

> 两条容易混淆的边界，单独点明：
>
> - **"定义" vs "运行"**：tool/skill 的 schema、registry、loader 是**定义**（L2 engine）；用某个 agent 去**执行**一次 tool/skill 调用是**运行**（L2.5 harness）。
> - **"通用资源" vs "AI 推理"**：API 密钥、存储、网络、限流是支撑 AI 的**通用资源**（L1），不是 AI 推理本身——所以归 platform，即便它们服务于 LLM 调用。

---

## 2. 能力归属决策树（MECE 的可执行形式）

任意能力 X，依次回答，命中第一个"是"即落定归属。每个能力恰好落到一个叶子 → 互斥；五问覆盖所有情形 → 穷尽。

```
Q1  X 是否对外（第三方/外部系统）暴露的接口或协议适配？
    └─是→ L4 open-api（仅 controller/协议，逻辑下沉到被代理层）
    └─否↓

Q2  X 是否只服务于某个具体业务场景（research/writing/office…），
    换个产品形态就不需要？
    └─是→ L3 ai-app
    └─否↓（X 是通用能力）

Q3  X 是否属于"模型推理 / 生成 / 检索 / agent"语义？
    （注意：密钥、存储、网络、限流等"支撑 AI 的通用资源"在此选"否"）
    └─否→ Q3a
    └─是→ Q4

  Q3a  X 是否是"可替换的具体后端实现"（R2 / redis / pgvector / otel-exporter）？
       └─是→ L0 plugins
       └─否→ L1 platform

Q4  X 是否携带 agent / mission / session 运行时状态？
    └─否（无状态基元，给定输入即产出，可纯函数式测试）→ L2 ai-engine
    └─是（编排 agent 循环、mission 生命周期、跨 step 状态）→ L2.5 ai-harness
```

**用法**：能力可被拆分时，先拆到"单一职责的最小单元"再逐一过树。例如"凭证"会拆成 `存储/加密/健康/解析/对外端点/用户UX` 六个单元，分别落到 L1 与 L4/L3 的薄适配。

---

## 3. 目录 MECE 六原则

决策树解决"哪一层",这六条解决"层内如何分目录、如何避免漂移"：

1. **一能力一家（互斥）**：同一能力只有一个权威实现，其余位置必须是薄适配（controller/facade/port），不得有第二份逻辑。
2. **能力穷尽（无遗漏）**：每个能力都能被决策树指到唯一叶子；指不到 → 说明该能力定义不清，先拆分。
3. **顶层皆业界标准词**：禁自造 `kernel/runtime/process/governance`，沿用 engine/harness/agents/memory/tools 等标准词。
4. **同名概念全项目唯一**：不同层禁止用同一目录名表达不同概念（当前 `evaluation/planning/teams/storage` 违反）。
5. **每聚合自带 `abstractions/`**：端口定义在本聚合内，跨层依赖一律走端口反转（如 engine 通过 `ISkillProvider` 被 harness 注入），禁大杂烩 re-export。
6. **命名即归属**：目录名应能无歧义反推它属于哪层；做不到就改名。

---

## 4. 目标态目录划分（自顶向下，标注与现状的差异）

> 图例：`＋`新增 · `→`迁入 · `✂`剥离/迁出 · `✎`改名 · 无标记=保持

### L4 open-api（协议适配，逻辑全下沉）

```
open-api/
  rest/        public-api · ai-core · agents-api · teams-api · skills-api
  protocol/
    mcp/       mcp-server · mcp-admin
    a2a/       ✎ 合并 v0.1-shim + v0.3-rpc + discovery 为单一聚合（skillId→teamId 改配置驱动）
  admin/       系统运维枢纽（25+ 子控制器）
  byok-admin/  ✂ 仅保留 controller，统计/维护逻辑下沉 L1 credentials
  webhooks/
```

### L3 ai-app（业务，剥离错位的基础设施）

```
ai-app/
  research/ writing/ office/ social/ radar/ topic-insights/ library/
  ask/ explore/ image/ simulation/ feedback/ custom-agents/ agent-playground/
  contracts/                跨 app DI 契约（保留，解耦范例）
  byok/                     ✂ 仅保留用户 UX，凭证逻辑走 L1 端口
  planning/                 ✎ → event-planning（与 engine/planning 去重名）
  teams/                    ✂ 协作基础设施剥离到 harness，仅留 topic/消息/实时业务
  management/workspace/     workspace 配置（保留）
  ✂ management/ingestion → platform/data-ingestion
  ✂ notifications-bridge   → platform/notifications（纯事件适配，非业务）
```

### L2.5 ai-harness（运行时编排）

```
ai-harness/
  agents/ runner/ handoffs/ lifecycle/ teams/
  memory/        ✎ checkpoint(agent-step)→ step-snapshot；mission-checkpoint 保留；event-store 与 protocols/journal 划清
  protocols/     ✎ 明确 ipc(进程内)/events(域事件)/journal(append-log) 三层职责
  evaluation/    ✎ → quality-judge（与 engine/evaluation 去重名；此处含 LLM critique/verify）
  guardrails/    成本/预算/并发（AI+mission 专属，保留）
  tracing/       ✂ 仅产生 agent-aware span 事件，喂给 L1 统一 telemetry 管道；采集/导出契约迁 L1
  ＋ teams/collaboration  ← 从 ai-app/teams 迁入的 VotingManager/HandoffCoordinator/MissionPipeline
```

### L2 ai-engine（无状态基元）

```
ai-engine/
  llm/ rag/ knowledge/ content/ tools/ skills/ planning/ safety/
  evaluation/    无状态启发式 checker（保留原名，harness 侧改名后此处即唯一同名归属）
  routing/       ✎ 吸收 llm/selection——ModelElection 基于 ScoredRouter 实现，消除双套打分
  reliability/   ✂ rate-limit 的"存储+算法"下沉 L1；此处仅留 AI 实体健康策略与调用点
  ✂ credentials/ → platform/credentials（见 §5 主题 A，最大一处迁移）
  facade/
```

### L1 platform（通用基础设施，承接收敛）

```
platform/
  auth/ credits/ db-ops/ settings/ release/ resilience/ email/
  ＋ credentials/            ← 收敛 engine/credentials + secrets + encryption + key-health
       store/ encryption/ health/ resolver/ distribution/   （engine 仅留一个取 key 的窄端口）
  observability/            ✎ 合并 monitoring + harness 采集/导出契约
       metrics/ audit/ health-check/ telemetry-pipeline/
  notifications/            ＋ ← notifications-bridge 事件适配
  storage/                  治理/编排（后端实现在 L0）
  rate-limit/               ＋ ← Redis-backed token bucket（engine/harness 仅持策略与调用点）
  ＋ data-ingestion/        ← ai-app/management/ingestion
```

### L0 plugins（可替换后端，保持现状即正确样板）

```
plugins/
  core/                     manifest + HookBus + capability 三层校验 + replaces 互斥
  observability/telemetry-otel        ← 被 L1 observability/telemetry-pipeline 消费
  security/sandbox-isolated-vm
  storage/{object-r2, tool-cache-redis, vector-pgvector, vector-jsonb}
```

---

## 5. 能力汇聚建议（逐个过决策树）

> 每行的"归属"都由 §2 决策树推出，不是个案判断。

| 能力域                  | 当前散落                                                                                            | 决策树判定                                                                                             | 目标归属（一家 + 薄适配）                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **A 凭证/密钥**         | engine/credentials · platform/{secrets,encryption,key-health} · app/byok · open-api/byok-admin      | 存储/加密/健康/解析=通用资源非 AI 推理 → **Q3a 否 → L1**；UX → L3；对外 → L4                           | **L1 `platform/credentials`** 单一权威；engine 留取 key 窄端口；app/byok 仅 UX；open-api/byok-admin 仅 controller。6 处 → 1 实现 + 3 薄适配 |
| **B 可观测性**          | platform/monitoring · harness/tracing · plugins/observability                                       | 采集/审计=通用 → **L1**；exporter=可替换后端 → **L0**；agent span=AI+mission → **L2.5（仅产事件）**    | **L1 `observability` 拥有契约+采集+管道**；L0 提供 exporter；harness 只发 agent-aware span。命名消除三处"可观测性"                          |
| **C 限流/韧性**         | engine/reliability · engine/safety · harness/guardrails · platform/resilience · platform/key-health | token-bucket 存储+算法=通用 → **L1**；budget/cost=AI+mission → **L2.5**；circuit-breaker=通用 → **L1** | **L1 `rate-limit`（Redis）+ `resilience`** 持基元；engine/harness 仅持策略与调用点。消除进程内内存态多 pod 失真                             |
| **D evaluation 同名**   | engine/evaluation（无状态）· harness/evaluation（LLM）                                              | 都 AI 专属；无状态 → **L2**，有 LLM/mission → **L2.5**。层正确，仅违反"同名唯一"                       | engine 保留 `evaluation`；**harness 改名 `quality-judge`**                                                                                  |
| **E routing/selection** | engine/routing · engine/llm/selection                                                               | 同为 L2 无状态基元，同层重复                                                                           | **合并**：ModelElection 基于 `routing/ScoredRouter` 实现                                                                                    |
| **F teams 同名**        | harness/teams（框架）· app/teams（业务+基础设施包装）                                               | 框架=通用编排 → **L2.5**；topic/UX=业务 → **L3**                                                       | 协作基础设施剥离回 **harness/teams/collaboration**；app/teams 仅留业务                                                                      |
| **G planning 同名**     | engine/planning（基元）· app/planning（业务）                                                       | 基元 → L2；业务 → L3。层正确，仅违反"同名唯一"                                                         | engine 保留；**app 改名 `event-planning`**                                                                                                  |
| **H 错位小模块**        | app/notifications-bridge · app/management/ingestion                                                 | 事件适配/数据管道=通用基础设施 → **Q3 否 → L1**                                                        | 迁 **platform/notifications**、**platform/data-ingestion**                                                                                  |
| **I storage 同名**      | platform/storage · plugins/storage                                                                  | 编排=L1；后端=L0。**已是正确样板**                                                                     | 无需改，作为 DI-token 分层范例保护                                                                                                          |

---

## 6. 落地节奏

按"风险 × 是否需决策"分波，不按工作量：

- **第一波（纯改名/迁移，无逻辑变更，低风险）**：D（harness evaluation→quality-judge）、G（app planning→event-planning）、H（2 个错位模块迁 L1）、文档漂移修正（CLAUDE.md 补 platform 改名 + plugins 层）。
- **第二波（同层合并，中风险）**：E（routing 吸收 selection）、F（teams 协作基础设施剥离）。
- **第三波（跨层收敛，需端口设计，高收益）**：A（凭证收敛 L1）、B（可观测性收敛）、C（限流下沉 L1）。其中 A 与 v2 评审 rank 1（IDOR）协同——能力归位后统一 access guard 接线面显著收敛。
- **看护固化（与上述并行）**：第 4 原则"同名唯一"、第 1 原则"一能力一家"升级为架构 spec/lint，防止再次漂移（当前仅 honor）。

> 需用户拍板的两个真实分叉（不替决策）：
>
> 1. **凭证解析的 AI-aware 程度**：是否接受 CLAUDE.md "BYOK 解析零 agent 状态属 L1" 的判据，将其全栈收敛 L1（本文 §5-A 按此假设）；还是认为 provider failover 选 key 带 AI 语义、应留 L2 engine。
> 2. **teams 根治范围（XL）**：是否同步把 topic/mission 抽象从 app 提到 engine，还是本轮只做协作基础设施剥离。

---

**维护者**：Claude Code · **版本**：2.0（重写：原 1.0 为平铺审计，本版改为原则驱动的设计规范）
**下次复审触发**：任一波次落地后，或新增顶层聚合 / 出现新同名目录时

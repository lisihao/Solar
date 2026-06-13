# GenesisPod 分层架构总图

> 按实际代码目录（`backend/src/modules/`）整理的五层系统架构图。
> 信息源：2026-05-29 对 `ai-app` / `ai-harness` / `ai-engine` / `ai-infra` / `open-api` 各层目录的实测扫描，非记忆推断。
> 配套：总览数据流见 [system-overview.md](system-overview.md)；分层规则见 [ARCHITECTURE_RULES.md](ARCHITECTURE_RULES.md)。

---

## 1. 五层总图（单向依赖）

```mermaid
flowchart TB
    subgraph L4["L4 · open-api（对外入口）"]
        direction LR
        OA["public-api · a2a · agents-api · teams-api<br/>skills-api · mcp-server · webhooks · admin"]
    end

    subgraph L3["L3 · ai-app（产品能力 / 20 模块）"]
        direction LR
        APP["research · teams · office · writing · ask · image<br/>social · simulation · planning · library · explore<br/>topic-insights · agent-playground · custom-agents · radar · byok ..."]
    end

    subgraph L25["L2.5 · ai-harness（Agent 运行时 / 11 聚合）"]
        direction LR
        H["agents · runner · teams · handoffs · memory<br/>protocols · evaluation · guardrails · tracing · lifecycle · facade"]
    end

    subgraph L2["L2 · ai-engine（原子能力 / 10 聚合）"]
        direction LR
        E["llm · tools · rag · knowledge · skills<br/>planning · safety · content · credentials · facade"]
    end

    subgraph L1["L1 · ai-infra（平台底座）"]
        direction LR
        I["auth · credits · storage · secrets · encryption<br/>settings · email · notifications · monitoring · resilience · release"]
    end

    L4 --> L3
    L3 --> L25
    L3 --> L2
    L3 --> L1
    L25 --> L2
    L25 --> L1
    L2 --> L1

    classDef layer fill:#0f172a,stroke:#334155,color:#e2e8f0
    class L4,L3,L25,L2,L1 layer
```

**依赖铁律**：L4 → L3 → L2.5 → L2 → L1，严格单向。

- `ai-engine` **不知道** agent / mission（无 agent 状态）；`ai-harness` 必知 agent / mission。
- `ai-app` 访问下层**只能走各自 facade**（`ai-engine/facade`、`ai-harness/facade`、`ai-infra/facade`），禁止穿透内部路径。
- 三层看护：ESLint `no-restricted-imports` + `layer-boundaries.spec.ts` + `.husky/pre-push`。

---

## 2. L4 · open-api（对外入口）

```mermaid
flowchart LR
    subgraph OPENAPI["modules/open-api"]
        PUB["public-api<br/>公开 REST"]
        A2A["a2a-api / a2a-rpc / a2a-server<br/>Agent-to-Agent 协议"]
        AGT["agents-api"]
        TEAM["teams-api"]
        SKILL["skills-api"]
        MCP["mcp-server / mcp-admin<br/>MCP 对外"]
        WH["webhooks"]
        ADM["admin / byok-admin / ai-core"]
    end
    OPENAPI --> AIAPP["L3 ai-app"]
```

| 子模块                                                     | 职责                              |
| ---------------------------------------------------------- | --------------------------------- |
| `public-api`                                               | 对外公开 REST API                 |
| `a2a-api` / `a2a-rpc.controller` / `a2a-server.controller` | Agent-to-Agent 协议服务端         |
| `agents-api` / `teams-api` / `skills-api`                  | Agent / Team / Skill 对外编程接口 |
| `mcp-server` / `mcp-admin`                                 | MCP 协议对外暴露与管理            |
| `webhooks`                                                 | 外部回调入口                      |
| `admin` / `byok-admin` / `ai-core`                         | 后台与核心管理接口                |

> 经 `5ed371432` 重构后，open-api 通过 facade 访问 ai-engine / ai-harness，并有 eslint guard 守护。

---

## 3. L3 · ai-app（产品能力，20 模块）

```mermaid
flowchart TB
    subgraph CORE["深度研究 / 协作"]
        RES["research（135）"]
        TI["topic-insights（429）"]
        TEAMS["teams（135）"]
        SIM["simulation（16）"]
        PLAN["planning（17）"]
    end
    subgraph CONTENT["内容生成"]
        OFF["office（200）"]
        WR["writing（279）"]
        SOC["social（217）"]
        IMG["image（69）"]
        ASK["ask（40）"]
    end
    subgraph MANAGE["资源 / 平台"]
        LIB["library（179）"]
        EXP["explore（67）"]
        PG["agent-playground（245）"]
        CA["custom-agents"]
        BYOK["byok · radar · feedback · management · notifications-bridge · contracts"]
    end
    CORE & CONTENT & MANAGE --> FAC["经 facade 调用 L2.5 / L2 / L1"]
```

| 模块                      | 文件数    | 定位                                                         |
| ------------------------- | --------- | ------------------------------------------------------------ |
| `topic-insights`          | 429       | 话题洞察（Research 衍生，最大模块）                          |
| `writing`                 | 279       | AI 长文写作                                                  |
| `agent-playground`        | 245       | 结构化 mission pipeline / 事件流 / 重跑 / 导出               |
| `social`                  | 217       | 社交内容生成                                                 |
| `office`                  | 200       | 文档 / PPT / 设计生成                                        |
| `library`                 | 179       | 资源库（collections/notes/rag/knowledge-graph/integrations） |
| `research` / `teams`      | 135 / 135 | 深度研究 / 多 Agent 协作辩论                                 |
| `image` / `explore`       | 69 / 67   | 图像生成 / 内容浏览发现                                      |
| `ask`                     | 40        | 智能问答多模型切换                                           |
| `planning` / `simulation` | 17 / 16   | AI 规划 / 多角色模拟辩论                                     |
| `custom-agents` 等        | —         | 自定义 Agent、BYOK、radar、feedback、management 等           |

**当前两大活跃多 Agent 系统**：`teams`（Topic 协作 / 辩论 / TeamMission）与 `agent-playground`（结构化 mission pipeline）。

---

## 4. L2.5 · ai-harness（Agent 运行时，11 聚合）

```mermaid
flowchart TB
    subgraph HARNESS["modules/ai-harness"]
        AG["agents<br/>core · registry · subagents<br/>domain · skill-runtime · learning"]
        RUN["runner<br/>loop · executor · tool-invoker<br/>tool-routing · scheduler · dag · plan-execution · context · prompt"]
        TM["teams<br/>orchestrator · collaboration<br/>business-team · constraints · factory · registry"]
        HO["handoffs<br/>Agent 切换（OpenAI 标准）"]
        MEM["memory<br/>vector · working · checkpoint<br/>mission-checkpoint · consolidation · indexing · stores"]
        PROTO["protocols<br/>a2a · ipc · events · realtime · journal"]
        EVAL["evaluation<br/>critique · verify · figure · dreaming"]
        GUARD["guardrails<br/>budget · billing · resources<br/>constraints · runtime · exports"]
        TRACE["tracing<br/>tracer · latency · observability · evaluation · exports"]
        LIFE["lifecycle<br/>hooks · manager · supervisor<br/>mission-lifecycle · learning"]
        FAC["facade<br/>对外门面（re-export + thin delegation）"]
    end
    HARNESS --> ENGINE["L2 ai-engine"]
```

| 聚合         | 关键子目录                                                                       | 职责                                                                     |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `agents`     | core / registry / subagents / domain / skill-runtime / learning                  | Agent 定义与注册                                                         |
| `runner`     | loop / executor / tool-invoker / tool-routing / scheduler / dag / plan-execution | Agent 运行循环与执行                                                     |
| `teams`      | orchestrator / collaboration（voting/debate/review）/ business-team              | 团队业务编排模式                                                         |
| `handoffs`   | handoff.service / agent-registry                                                 | Agent 切换（OpenAI 标准）                                                |
| `memory`     | vector / working / checkpoint / mission-checkpoint / consolidation / indexing    | Agent 状态与记忆                                                         |
| `protocols`  | a2a / ipc / events / realtime / journal                                          | 5 个 agent 层协议（A2AMessage 接口源头在 `protocols/ipc/abstractions/`） |
| `evaluation` | critique / verify / figure / dreaming                                            | 质量评判                                                                 |
| `guardrails` | budget / billing / resources / constraints / runtime                             | 资源限额                                                                 |
| `tracing`    | tracer / latency / observability / evaluation                                    | 追踪                                                                     |
| `lifecycle`  | hooks / manager / supervisor / mission-lifecycle / learning                      | 韧性与生命周期                                                           |
| `facade`     | ai.facade / harness.facade / sub-facades                                         | 对外门面                                                                 |

> 历史包袱已清：`ai-kernel/`（删）、`ai-engine/runtime/`（迁出）、`intent-gateway/`（删，空壳）。所有 Agent 运行时能力集中在本层。

---

## 5. L2 · ai-engine（原子能力，10 聚合）

```mermaid
flowchart TB
    subgraph ENGINE["modules/ai-engine"]
        LLM["llm<br/>adapters · selection · pricing · capability<br/>failover · structured-output · prompt-adaptation · key-health"]
        TOOLS["tools<br/>registry · adapters(mcp/openapi/function)<br/>middleware · cache · search-fusion · concurrency"]
        RAG["rag<br/>embedding · chunking · vector · pipeline"]
        KNOW["knowledge<br/>extraction · entity/relation · synthesis<br/>rerank · evidence · consistency · world-building"]
        SKILLS["skills<br/>registry · loader · runtime · sandbox<br/>builder · spec-builder · ecosystem · analytics"]
        PLANNING["planning<br/>intent · context · reflection · budget"]
        SAFETY["safety<br/>security · guardrails · constraint · quality · resilience"]
        CONTENT["content<br/>fetch · cleaner · markdown · citation<br/>figure · image · report-template · sources"]
        CRED["credentials<br/>BYOK / secret resolver"]
        FAC["facade<br/>engine 公共桶"]
    end
    ENGINE --> INFRA["L1 ai-infra"]
```

| 聚合          | 关键子目录                                                                 | 职责                                                 |
| ------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| `llm`         | adapters / selection / pricing / capability / failover / structured-output | LLM 调用 + 模型适配 + 路由 + 定价                    |
| `tools`       | registry / adapters(mcp/openapi/function) / middleware / cache             | 项目唯一 tools（MCP 在此，与 OpenAPI/function 同层） |
| `rag`         | embedding / chunking / vector / pipeline                                   | 检索基元                                             |
| `knowledge`   | extraction / synthesis / rerank / evidence / world-building                | 知识抽取                                             |
| `skills`      | registry / loader / runtime / sandbox / builder                            | 项目唯一 SkillRegistry                               |
| `planning`    | intent / context / reflection / budget                                     | 任务分解（不含 agent loop）                          |
| `safety`      | security / guardrails / constraint / quality                               | PII / moderation / injection                         |
| `content`     | fetch / markdown / citation / figure / sources                             | 内容处理                                             |
| `credentials` | —                                                                          | BYOK / secret resolver                               |
| `facade`      | exports / abstractions                                                     | engine 公共桶                                        |

> MECE 原则：`tools` 全项目唯一在 engine、`SkillRegistry` 全项目唯一、engine 无 agent / mission 状态。

---

## 6. L1 · ai-infra（平台底座）

```mermaid
flowchart LR
    subgraph INFRA["modules/ai-infra"]
        AUTH["auth"]
        CRED["credentials / secrets / encryption"]
        CREDIT["credits<br/>原子扣费（atomic deduction）"]
        STORE["storage"]
        SET["settings"]
        EMAIL["email / notifications"]
        MON["monitoring / resilience"]
        REL["release"]
        DBG["db-governance"]
    end
```

| 子模块                                   | 职责                                                     |
| ---------------------------------------- | -------------------------------------------------------- |
| `auth`                                   | 认证授权                                                 |
| `credits`                                | 积分 / 原子扣费（`ccd267ba8` 修复 lost-update 与负余额） |
| `storage`                                | 对象存储                                                 |
| `secrets` / `encryption` / `credentials` | 密钥与加密                                               |
| `settings`                               | 平台配置                                                 |
| `email` / `notifications`                | 邮件与通知                                               |
| `monitoring` / `resilience`              | 监控与韧性                                               |
| `release` / `db-governance`              | 发布与数据库治理                                         |

---

## 7. 基础设施与运行时环境

```mermaid
flowchart LR
    FE["frontend<br/>Next.js 14 + Zustand + Tailwind"]
    BE["backend<br/>NestJS 10 + Prisma"]
    PG[("PostgreSQL 16<br/>结构化 + JSONB + 图关系")]
    REDIS[("Redis 7<br/>缓存 / 会话")]
    OBJ[("Object Storage")]
    LLMAPI["LiteLLM → OpenAI / Claude / Grok"]

    FE -->|HTTP / SSE / WebSocket| BE
    BE --> PG
    BE --> REDIS
    BE --> OBJ
    BE --> LLMAPI
```

- **数据库**：PostgreSQL 16 唯一库（已移除 MongoDB / Neo4j / Qdrant，成本优化 70-75%）。
- **缓存**：Redis 7。
- **部署**：Docker + Railway + PM2。

---

## 8. 维护要求

1. 架构图必须能指回真实目录 / controller / service / Prisma 模型，禁止凭记忆推断。
2. 顶层结构变化时，同步更新本文、[system-overview.md](system-overview.md)、`docs/README.md`、`STRUCTURE.md`。
3. 新增聚合 / 子模块时，先确认是否违反 MECE 与单向依赖，再更新本图。

---

**最后更新**：2026-05-29
**信息源**：实测目录扫描
**维护者**：Claude Code

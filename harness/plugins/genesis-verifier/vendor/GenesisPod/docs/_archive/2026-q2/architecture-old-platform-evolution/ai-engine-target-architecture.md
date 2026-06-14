# 平台 6 层架构目标

> 基于现有代码实际依赖分析 + 架构审计结论，提出的全栈重构目标。
> modules/ 子目录 = 架构层，目录结构即架构。

## 现状问题

```
1. AIEngineFacade = 2951 行 God Object + 399 行 index.ts（139 re-export）
2. ai-infra (L1) 有 7 个模块反向依赖 L3/L2/L4（admin、feedback、integrations/*）
3. ai-kernel (L2) 多处反向依赖 L3 接口（IProgressTracker、IEventEmitter、IMemoryStore）
4. ai-engine/content/ 内含 3 个业务模块（long-form、analysis、synthesis）应属 L4
5. content/ 和 ingestion/ 是孤儿模块，不属于任何层
6. agent-os/ 命名不准确，实际职责是意图路由
7. @Global() 无边界 — Engine + Kernel 全局可注入，依赖不可追踪
```

## 目标架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  L6  Intent Gateway（意图网关）                                       │
│  intent-gateway/                                                    │
│  统一入口 · 意图解析 · 请求分发 · 调用链追踪                          │
├─────────────────────────────────────────────────────────────────────┤
│  L5  Open API（开放接口层）                                           │
│  open-api/                                                          │
│  ├── admin/         管理后台 API（从 ai-infra 搬入）                   │
│  ├── mcp-server/    MCP Server（JSON-RPC 2.0）                       │
│  ├── public-api/    外部 REST API                                    │
│  └── webhooks/      事件推送                                         │
├─────────────────────────────────────────────────────────────────────┤
│  L4  AI Apps（业务应用层）                                            │
│  ai-app/                                                            │
│  ├── ask/           智能问答                                         │
│  ├── research/      深度研究                                         │
│  ├── teams/         多 Agent 协作                                    │
│  ├── writing/       AI 写作                                         │
│  │   └── content-engine/  （从 ai-engine/content/long-form 搬入）     │
│  ├── office/        文档/PPT 生成                                    │
│  │   ├── content-analysis/  （从 ai-engine/content/analysis 搬入）    │
│  │   └── content-synthesis/ （从 ai-engine/content/synthesis 搬入）   │
│  ├── social/        社交内容                                         │
│  ├── image/         图片应用                                         │
│  ├── coding/        AI 编程                                          │
│  ├── planning/      规划                                             │
│  ├── simulation/    仿真                                             │
│  ├── topic-insights/ 话题洞察                                        │
│  ├── feedback/      用户反馈（从 ai-infra 搬入）                      │
│  ├── ai-file-organizer/  文件整理（从 ai-infra 搬入）                 │
│  └── library/       知识库（content + ingestion + RAG 统一）          │
│      ├── resources/      资源管理（原 content/resources）              │
│      ├── collections/    收藏集（原 content/collections）              │
│      ├── notes/          笔记（原 content/notes）                     │
│      ├── workspace/      工作台（原 content/workspace）                │
│      ├── explore/        探索发现（原 content/explore）                │
│      ├── feed/           信息流（原 content/feed）                     │
│      ├── comments/       评论（原 content/comments）                  │
│      ├── knowledge-graph/ 知识图谱（原 content/knowledge-graph）       │
│      ├── recommendations/ 推荐（原 content/recommendations）          │
│      ├── reports/        报告（原 content/reports）                    │
│      ├── ingestion/      数据采集（原 modules/ingestion/）             │
│      │   ├── crawlers/   爬虫                                        │
│      │   ├── sources/    数据源                                       │
│      │   ├── scheduler/  调度器                                       │
│      │   └── config/     采集配置                                     │
│      ├── rag/            RAG 检索增强（原 ai-app/rag/）               │
│      │   └── integrations/                                           │
│      │       ├── feishu/       飞书（从 ai-infra 搬入）               │
│      │       ├── notion/       Notion（从 ai-infra 搬入）             │
│      │       └── google-drive/ Google Drive（从 ai-infra 搬入）       │
│      └── proxy/          代理抓取（从 ai-infra 搬入）                  │
├─────────────────────────────────────────────────────────────────────┤
│  L2  AI Kernel（内核层）                                              │
│  ai-kernel/                                                         │
│  ├── facade/index.ts      统一导出（独立，不经 Engine 转发）           │
│  ├── abstractions/        自有接口（不依赖 L3 定义）                   │
│  ├── process/             进程管理                                    │
│  ├── ipc/                 进程间通信                                  │
│  ├── memory/              内核记忆                                    │
│  ├── journal/             事件日志                                    │
│  ├── mission/             任务执行                                    │
│  ├── scheduler/           调度器                                      │
│  ├── supervisor/          进程监管                                    │
│  ├── resource/            资源管理                                    │
│  ├── security/            安全控制                                    │
│  ├── context/             上下文（KernelContext re-export shim）       │
│  ├── observability/       可观测性                                    │
│  └── api/                 内核 API                                    │
├─────────────────────────────────────────────────────────────────────┤
│  L3  AI Engine（核心能力层）                                          │
│  ai-engine/                                                         │
│  ├── facade/                                                        │
│  │   ├── domain/          5 个领域 Facade（拆分 God Object）          │
│  │   │   ├── chat.facade.ts     LLM 对话                             │
│  │   │   ├── rag.facade.ts      RAG 检索                             │
│  │   │   ├── agent.facade.ts    Agent 执行                           │
│  │   │   ├── team.facade.ts     Team 协作                            │
│  │   │   └── tool.facade.ts     Tool 执行                            │
│  │   ├── index.ts         静态 re-export（类型、常量、Registry）       │
│  │   └── ai-engine.facade.ts  @deprecated thin shim（过渡期保留）     │
│  ├── llm/                 LLM 调用                                    │
│  ├── agents/              Agent 框架                                  │
│  ├── tools/               Tool 框架                                   │
│  ├── teams/               Team 框架                                   │
│  ├── skills/              Skill 框架                                  │
│  ├── mcp/                 MCP 客户端                                  │
│  ├── orchestration/       编排引擎                                    │
│  ├── knowledge/           知识管理（RAG 核心、搜索、证据）             │
│  ├── safety/              Guardrails 安全                             │
│  ├── content/             通用内容能力                                 │
│  │   ├── fetch/           网页抓取 + SSRF 防护（保留）                 │
│  │   └── image/           图片生成/匹配（保留）                       │
│  ├── core/                核心类型与工具                               │
│  └── infra/               引擎基础设施（实时通信、可观测性）           │
├─────────────────────────────────────────────────────────────────────┤
│  L1  Infrastructure（基础设施层）                                     │
│  ai-infra/                                                          │
│  ├── facade/index.ts      统一导出                                    │
│  ├── auth/                认证授权                                    │
│  ├── credits/             计费积分                                    │
│  ├── secrets/             密钥管理                                    │
│  ├── storage/             R2 存储                                     │
│  ├── email/               邮件                                       │
│  ├── notifications/       通知                                       │
│  ├── monitoring/          监控（健康检查解耦 L3 依赖）                 │
│  ├── release/             版本管理                                    │
│  ├── settings/            系统设置                                    │
│  ├── table-management/    表管理                                      │
│  └── user-api-keys/       用户 API 密钥                               │
└─────────────────────────────────────────────────────────────────────┘
```

## 目标依赖关系（单向、可追踪）

```
L6 Intent Gateway ──→ L4 AI Apps       (意图路由到具体应用)
                  ──→ L3 Engine Facades (Agent 执行)
                  ──→ L1 Infra Facade   (Auth)

L5 Open API ──→ L4 AI Apps             (Admin 管理各 App)
            ──→ L3 Engine Facades      (MCP Server 直接调用能力)
            ──→ L1 Infra Facade        (Auth、Secrets)

L4 AI Apps ──→ L2 Kernel Facade        (进程管理、记忆)
           ──→ L3 Engine Facades       (LLM、RAG、Agent、Tool、Team)
           ──→ L1 Infra Facade         (Credits、Secrets、Storage)

L2 Kernel ──→ L1 Infra                 (Prisma、Cache)

L3 Engine ──→ L1 Infra                 (Prisma、Secrets、Credits)

禁止:
  - L1 → L2/L3/L4（基础层不依赖上层）
  - L3 → L2（Engine 不依赖 Kernel）
  - L2 → L3（Kernel 不依赖 Engine）
  - L4 App 之间互相依赖（通过 L3/L2 中转）
```

## 核心变化：五件事

### 1. 拆 God Facade → 5 个领域 Facade

```
现状:
  AIEngineFacade (2951 行, 80 方法, 什么都管)
  facade/index.ts (399 行, 139 re-export)

目标:
  ai-engine/facade/domain/
  ├── chat.facade.ts    ← chat(), chatStream(), chatStructured(), chatWithSkills()
  ├── rag.facade.ts     ← search(), embed(), ingest(), buildContext()
  ├── agent.facade.ts   ← executeAgent(), routeIntent()
  ├── team.facade.ts    ← startMission(), executeMissionStream()
  └── tool.facade.ts    ← executeTool(), chatWithTools(), chatWithToolsStream()

  每个 < 500 行，职责单一，@Injectable() 独立注入。
```

App 按需注入：

```typescript
// 现状：注入一个万能类
constructor(private readonly facade: AIEngineFacade) {}

// 目标：注入你需要的
constructor(
  private readonly chat: ChatFacade,       // Ask 模块只需要这个
  private readonly rag: RAGFacade,         // RAG 模块只需要这个
) {}
```

### 2. Kernel 独立导出，不经 Engine 转发

```
现状:
  App → import { ProcessManagerService } from "ai-engine/facade"
         ↑ engine/facade/index.ts 第 369-399 行转发自 ai-kernel

目标:
  App → import { ProcessManagerService } from "ai-kernel/facade"
         ↑ 直接从 kernel 导入，不绕路
```

Engine facade 删除全部 L2 re-export（当前 30 行）。

### 3. 三层 Facade 体系

```
ai-engine/facade/   → 5 个领域 Facade + 静态类型导出
ai-kernel/facade/   → Kernel 所有公开 API（进程、记忆、IPC、调度...）
ai-infra/facade/    → 基础服务（Credits、Secrets、Storage、Auth...）

每层 Facade = 该层对外的唯一出口。上层只能通过 Facade 访问下层。
```

### 4. 模块归位 — 消除分层违规

| 模块               | 现位置 (违规)  | 目标位置                             | 原因                 |
| ------------------ | -------------- | ------------------------------------ | -------------------- |
| admin/             | ai-infra (L1)  | open-api (L5)                        | 管理 API 属于接口层  |
| feedback/          | ai-infra (L1)  | ai-app (L4)                          | 用 AI 做分诊，是应用 |
| feishu/            | ai-infra (L1)  | ai-app/library/rag/integrations (L4) | 服务于知识库         |
| notion/            | ai-infra (L1)  | ai-app/library/rag/integrations (L4) | 同上                 |
| google-drive/      | ai-infra (L1)  | ai-app/library/rag/integrations (L4) | 同上                 |
| ai-file-organizer/ | ai-infra (L1)  | ai-app (L4)                          | 用 AI 分类，是应用   |
| proxy/             | ai-infra (L1)  | ai-app/library/proxy (L4)            | 服务于内容获取       |
| content/long-form/ | ai-engine (L3) | ai-app/writing/content-engine (L4)   | 写作业务逻辑         |
| content/analysis/  | ai-engine (L3) | ai-app/office/content-analysis (L4)  | PPT 分析业务         |
| content/synthesis/ | ai-engine (L3) | ai-app/office/content-synthesis (L4) | 报告组装业务         |
| agent-os/          | 命名不准确     | intent-gateway/ (L6)                 | 改名为意图网关       |
| content/           | 孤儿           | ai-app/library/ (L4)                 | 知识库统一管理       |
| ingestion/         | 孤儿           | ai-app/library/ingestion (L4)        | 并入知识库           |
| ai-app/rag/        | L4 散落        | ai-app/library/rag (L4)              | 并入知识库           |

### 5. 去 @Global()，显式声明依赖（后续阶段）

```
现状:
  @Global() AiEngineModule    → 任何模块都能注入任何 Engine 服务
  @Global() AiKernelModule    → 同上

目标:
  AiEngineChatModule          → 只导出 ChatFacade
  AiEngineRAGModule           → 只导出 RAGFacade
  AiEngineAgentModule         → 只导出 AgentFacade
  AiEngineToolModule          → 只导出 ToolFacade
  AiEngineTeamModule          → 只导出 TeamFacade
  AiKernelModule              → 只导出 Kernel Facade
  AiInfraModule               → 只导出 Infra Facade

  消费者显式声明:
  @Module({
    imports: [AiEngineChatModule, AiKernelModule],
  })
  export class AiAskModule {}
```

## 现状 vs 目标对比

| 维度              | 现状                    | 目标                           |
| ----------------- | ----------------------- | ------------------------------ |
| modules/ 一级目录 | 8 个（含 2 个孤儿）     | 6 个（严格对应 6 层）          |
| Engine Facade     | 1 个 2951 行 God Object | 5 个各 < 500 行领域 Facade     |
| facade/index.ts   | 399 行 139 export       | 精简到类型+常量导出            |
| L3→L2 re-export   | 30 行转发               | 0，Kernel 独立导出             |
| L1 分层违规       | 7 个模块反向依赖        | 0，全部归位                    |
| L3 业务泄漏       | 3 个 content/\* 子模块  | 0，下沉到 L4                   |
| L2 接口依赖       | 直接 import L3 接口     | 自有 abstractions/             |
| content/ingestion | 孤儿，不属于任何层      | 统一到 ai-app/library/         |
| @Global()         | Engine + Kernel 全局    | 无，显式 imports（后续）       |
| 消费者感知        | 80 个方法一锅端         | 按需注入，各 Facade 10-15 方法 |

## 迁移路径

```
Phase 1: Kernel 独立导出 ✅ DONE
  - KernelContext 下沉到 common/
  - 新建 kernel/facade/index.ts
  - Engine facade 转发 kernel（过渡兼容）

Phase 2: 目录归位 — 消除孤儿和分层违规
  - agent-os/ → intent-gateway/
  - content/ + ingestion/ → ai-app/library/
  - ai-app/rag/ → ai-app/library/rag/
  - ai-infra 违规模块搬到正确层
  - 新建 ai-infra/facade/index.ts
  - 迁移 ai-infra 消费者走 facade

Phase 3: AI Engine 内容模块下沉
  - content/long-form → ai-app/writing/content-engine
  - content/analysis + synthesis → ai-app/office/
  - 更新 engine facade 移除这些 export

Phase 4: AI Kernel L2 合规
  - 接口下沉到 common/ 或 kernel/abstractions/
  - 断开 A2A Controller 对 L3 的直接依赖
  - Kernel 完全自治，零 L3 import

Phase 5: 拆 God Facade — 5 个领域 Facade
  - 新建 ChatFacade, RAGFacade, AgentFacade, TeamFacade, ToolFacade
  - AIEngineFacade 变 thin shim（@deprecated 委托）
  - 注册为 Provider

Phase 6: 消费者迁移到领域 Facade
  - 137 个文件逐模块批量迁移
  - 删除 AIEngineFacade deprecated 方法
  - 删除 engine facade 的 kernel re-export

Phase 7: 去 @Global()（独立阶段，不在本轮）
  - 拆分 AiEngineModule → 5 个子 Module
  - 所有消费者显式 imports
  - 删除 AIEngineFacade 空壳

每个 Phase 结束时：type-check 0 errors + 全部测试通过。
```

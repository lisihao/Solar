# AI Engine 架构目录映射

> 本文档将架构设计视图映射到实际目录结构

## 模块依赖图 → 目录对应

```
                    ┌─────────────────────────────────────────┐
                    │              ai-engine.module           │
                    │     backend/src/modules/ai-engine/      │
                    └─────────────────────────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
┌───────────────┐               ┌───────────────┐               ┌───────────────┐
│   Registries  │               │   Executors   │               │   Services    │
│   注册表层    │               │   执行器层    │               │   服务层      │
└───────────────┘               └───────────────┘               └───────────────┘
```

---

## 1. Registries（注册表）

**架构职责**: 动态注册和管理 Tools/Skills/Agents

| 注册表            | 目录路径           | 核心文件            |
| ----------------- | ------------------ | ------------------- |
| **ToolRegistry**  | `tools/registry/`  | `tool.registry.ts`  |
| **SkillRegistry** | `skills/registry/` | `skill.registry.ts` |
| **AgentRegistry** | `agents/registry/` | `agent-registry.ts` |
| **TeamRegistry**  | `teams/registry/`  | `team-registry.ts`  |
| **RoleRegistry**  | `teams/registry/`  | `role-registry.ts`  |

```
ai-engine/
├── tools/
│   └── registry/
│       └── tool.registry.ts        ★ 48个工具注册
├── skills/
│   └── registry/
│       └── skill.registry.ts       ★ 技能动态加载
├── agents/
│   └── registry/
│       ├── agent-registry.ts       ★ 5种Agent注册
│       └── agent-orchestrator.ts   ★ Agent编排入口
└── teams/
    └── registry/
        ├── team-registry.ts        ★ 预定义团队
        └── role-registry.ts        ★ 角色定义
```

---

## 2. Executors（执行器）

**架构职责**: 工作流执行策略（顺序/并行/DAG/函数调用）

| 执行器                      | 目录路径                   | 核心文件                       |
| --------------------------- | -------------------------- | ------------------------------ |
| **BaseExecutor**            | `orchestration/executors/` | `base-executor.ts`             |
| **SequentialExecutor**      | `orchestration/executors/` | `sequential-executor.ts`       |
| **ParallelExecutor**        | `orchestration/executors/` | `parallel-executor.ts`         |
| **DagExecutor**             | `orchestration/executors/` | `dag-executor.ts`              |
| **FunctionCallingExecutor** | `orchestration/executors/` | `function-calling-executor.ts` |

```
ai-engine/
└── orchestration/
    ├── executors/
    │   ├── base-executor.ts           ★ 执行器基类
    │   ├── sequential-executor.ts     ★ 顺序执行
    │   ├── parallel-executor.ts       ★ 并行执行
    │   ├── dag-executor.ts            ★ DAG图执行
    │   ├── function-calling-executor.ts ★ 函数调用
    │   └── retry-strategy.ts          重试策略
    └── checkpoints/
        └── checkpoint-manager.ts      ★ 检查点管理
```

---

## 3. Services（服务层）

**架构职责**: 核心业务服务实现

| 服务                 | 目录路径         | 核心文件               |
| -------------------- | ---------------- | ---------------------- |
| **AiChatService**    | `llm/services/`  | `ai-chat.service.ts`   |
| **SearchService**    | `search/`        | `search.service.ts`    |
| **ImageFactory**     | `image/factory/` | `image.factory.ts`     |
| **EmbeddingService** | `rag/embedding/` | `embedding.service.ts` |
| **VectorService**    | `rag/vector/`    | `vector.service.ts`    |

```
ai-engine/
├── llm/
│   └── services/
│       ├── ai-chat.service.ts         ★ 核心LLM调用
│       ├── ai-api-caller.service.ts   ★ API调用层
│       ├── ai-model-config.service.ts ★ 模型配置
│       └── task-profile.types-mapper.service.ts
├── search/
│   └── search.service.ts              ★ 全局搜索
├── image/
│   └── factory/
│       └── image.factory.ts           ★ 图像生成工厂
└── rag/
    ├── embedding/
    │   └── embedding.service.ts       ★ 向量嵌入
    └── vector/
        └── vector.service.ts          ★ 向量搜索
```

---

## 4. Collaboration（协作框架）

**架构职责**: 多Agent协作模式（Handoff/Voting）

| 组件               | 目录路径                  | 核心文件                     |
| ------------------ | ------------------------- | ---------------------------- |
| **HandoffPattern** | `collaboration/patterns/` | `handoff-pattern.ts`         |
| **VotingPattern**  | `collaboration/patterns/` | `voting-pattern.ts`          |
| **ReviewWorkflow** | `collaboration/review/`   | `review-workflow.service.ts` |

```
ai-engine/
└── collaboration/
    ├── collaboration.module.ts        ★ 协作模块
    ├── patterns/
    │   ├── handoff-pattern.ts         ★ Agent交接
    │   └── voting-pattern.ts          ★ 投票共识
    ├── review/
    │   └── review-workflow.service.ts ★ 审查工作流
    └── todo/
        └── todo.service.ts            ★ Todo管理
```

---

## 5. Constraint（约束引擎）

**架构职责**: 成本控制、速率限制、内容过滤

| 组件                | 目录路径                 | 核心文件              |
| ------------------- | ------------------------ | --------------------- |
| **CostController**  | `constraint/guardrails/` | `cost-controller.ts`  |
| **RateLimiter**     | `constraint/guardrails/` | `rate-limiter.ts`     |
| **ContentFilter**   | `constraint/guardrails/` | `content-filter.ts`   |
| **SchemaValidator** | `constraint/validators/` | `schema-validator.ts` |

```
ai-engine/
└── constraint/
    ├── ai-engine-constraint.module.ts  ★ 约束模块
    ├── guardrails/
    │   ├── cost-controller.ts          ★ 成本控制
    │   ├── rate-limiter.ts             ★ 速率限制
    │   └── content-filter.ts           ★ 内容过滤
    └── validators/
        └── schema-validator.ts         ★ Schema验证
```

---

## 6. Memory（记忆系统）

**架构职责**: 短期/长期记忆存储

| 组件                | 目录路径         | 核心文件                       |
| ------------------- | ---------------- | ------------------------------ |
| **ShortTermMemory** | `memory/stores/` | `short-term-memory.service.ts` |
| **LongTermMemory**  | `memory/stores/` | `long-term-memory.service.ts`  |
| **InMemoryStore**   | `memory/stores/` | `in-memory-store.ts`           |

```
ai-engine/
└── memory/
    ├── ai-engine-memory.module.ts     ★ 记忆模块
    └── stores/
        ├── in-memory-store.ts         ★ 内存存储
        ├── short-term-memory.service.ts ★ 会话级记忆
        └── long-term-memory.service.ts  ★ 用户级记忆
```

---

## 7. 完整目录树

```
backend/src/modules/ai-engine/
│
├── 📋 模块入口
│   ├── ai-engine.module.ts            ★ 主模块(Global)
│   ├── ai-engine-llm.module.ts        LLM子模块
│   ├── ai-engine-tools.module.ts      工具子模块
│   ├── ai-engine-skills.module.ts     技能子模块
│   ├── ai-engine-orchestration.module.ts 编排子模块
│   ├── ai-engine-memory.module.ts     记忆子模块
│   └── ai-engine-constraint.module.ts 约束子模块
│
├── 🎯 core/                           核心层
│   ├── types/                         类型定义
│   ├── errors/                        错误系统
│   ├── exceptions/                    异常定义
│   └── interfaces/                    核心接口
│
├── 🔧 tools/                          工具系统(48个)
│   ├── abstractions/                  ITool接口
│   ├── base/                          BaseTool基类
│   ├── registry/                      ★ ToolRegistry
│   ├── middleware/                    工具中间件
│   └── categories/                    工具分类
│       ├── information/               信息获取(10个)
│       ├── generation/                内容生成(6个)
│       ├── execution/                 执行工具(4个)
│       ├── collaboration/             协作工具(6个)
│       ├── processing/                数据处理(8个)
│       ├── integration/               系统集成(6个)
│       ├── memory/                    记忆工具(5个)
│       └── export/                    导出工具(4个)
│
├── 🛠️ skills/                         技能系统
│   ├── abstractions/                  ISkill接口
│   ├── base/                          BaseSkill基类
│   ├── registry/                      ★ SkillRegistry
│   ├── loader/                        SKILL.md加载器
│   └── builder/                       Prompt构建器
│
├── 🤖 agents/                         Agent框架
│   ├── abstractions/                  IAgent接口
│   ├── base/                          BaseAgent/ReactiveAgent
│   ├── registry/                      ★ AgentRegistry
│   └── implementations/               Agent实现(5种)
│
├── 📊 orchestration/                  编排引擎
│   ├── executors/                     ★ 执行器(4种)
│   └── checkpoints/                   检查点管理
│
├── 🧠 memory/                         记忆系统
│   └── stores/                        ★ 记忆存储(3种)
│
├── 🔒 constraint/                     约束引擎
│   ├── guardrails/                    ★ 保护栏(3种)
│   └── validators/                    验证器
│
├── 🤝 collaboration/                  协作框架
│   ├── patterns/                      ★ 协作模式(2种)
│   └── review/                        审查工作流
│
├── 🧠 llm/                            LLM适配层
│   ├── adapters/                      ★ LLM适配器(3种)
│   ├── factory/                       LLM工厂
│   └── services/                      ★ AiChatService
│
├── 👥 teams/                          多Agent协作
│   ├── registry/                      ★ TeamRegistry
│   ├── orchestrator/                  任务编排
│   └── factory/                       团队工厂
│
├── 🎭 facade/                         统一门面
│   └── ai-engine.facade.ts            ★ 统一入口
│
└── 📄 api/                            API层
    ├── ai-core.controller.ts          REST控制器
    └── ai-core.service.ts             核心服务
```

---

## 8. 调用链路示例

### LLM 调用链路

```
Controller → Facade → AiChatService → AiApiCallerService → Provider API
                          ↓
                    AIMetricsService (记录指标)
```

### Agent 执行链路

```
Controller → AgentOrchestrator → AgentRegistry → BaseAgent
                                       ↓
                              ReactiveAgent.execute()
                                       ↓
                              ToolRegistry.getTool() → Tool.execute()
```

### Team 执行链路

```
Controller → TeamsService → MissionOrchestrator → Team
                                    ↓
                           RoleRegistry → Member.execute()
                                    ↓
                           CollaborationPattern (Handoff/Voting)
```

---

## 9. 关键设计原则

1. **Registry 模式**: 所有可扩展组件通过 Registry 动态注册
2. **Adapter 模式**: LLM 层抽象，支持多 Provider
3. **Factory 模式**: 按需创建 Team/Image/LLM 实例
4. **Facade 模式**: `ai-engine.facade.ts` 提供统一入口
5. **Strategy 模式**: Executor 实现不同执行策略

---

**最后更新**: 2026-02-05
**维护者**: Claude Code


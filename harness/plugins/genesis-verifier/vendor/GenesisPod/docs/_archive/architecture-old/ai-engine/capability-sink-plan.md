# AI Engine 能力下沉总体方案

> 版本: 1.0
> 日期: 2025-01-06
> 状态: 规划中

---

## 一、背景与目标

### 1.1 当前问题

```
┌─────────────────────────────────────────────────────────────────────┐
│  问题 1: 架构层级混乱                                               │
│  - AI Teams 应用层包含了大量通用引擎能力                            │
│  - AI Studio 独立实现，没有复用 AI Engine                           │
│  - 代码重复，维护成本高                                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  问题 2: 能力边界不清                                               │
│  - 任务分解、Agent执行、审核反馈 在应用层实现                       │
│  - 这些是通用能力，应该在 AI Engine 中                              │
│  - 其他 Apps (AI Office, AI Simulation) 无法复用                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  问题 3: 缺少持续迭代支持                                           │
│  - 研究/文档输出是一次性的                                          │
│  - 没有版本管理和增量更新能力                                       │
│  - 用户无法选中部分内容进行迭代                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 目标架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        应用层 (AI Apps)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  AI Studio   │  │  AI Office   │  │ AI Simulation│              │
│  │  (研究报告)  │  │  (商务文档)  │  │  (辩论推演)  │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│         └─────────────────┼─────────────────┘                       │
│                           │                                         │
│  职责: 业务流程、数据持久化、WebSocket 事件、应用配置               │
├─────────────────────────────────────────────────────────────────────┤
│                     协作机制层 (AI Teams)                            │
│                                                                     │
│  职责: Leader-Member 模式、Topic/Mission 数据模型、团队管理         │
├─────────────────────────────────────────────────────────────────────┤
│                      AI Engine (核心引擎)                           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  🆕 下沉能力                                                   │ │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐     │ │
│  │  │ 任务分解  │ │ Agent执行 │ │ 输出审核  │ │ 迭代管理  │     │ │
│  │  │Decomposer │ │ Executor  │ │ Reviewer  │ │ Iterator  │     │ │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘     │ │
│  │  ┌───────────┐ ┌───────────┐                                  │ │
│  │  │ 约束校验  │ │ Token预算 │                                  │ │
│  │  │ Validator │ │  Budget   │                                  │ │
│  │  └───────────┘ └───────────┘                                  │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  现有能力                                                      │ │
│  │  Orchestrator | Skills | Tools | Constraints | Memory | Agents │ │
│  └───────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                   AI Orchestration (模型适配)                        │
│  LiteLLM / 多模型提供商 (OpenAI, Claude, Gemini, Grok)              │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 核心原则

| 原则         | 说明                                     |
| ------------ | ---------------------------------------- |
| **单一职责** | 每层只做自己该做的事                     |
| **依赖倒置** | 应用层依赖引擎层，不反过来               |
| **接口隔离** | AI Engine 提供清晰的 API，不暴露实现细节 |
| **复用优先** | 通用能力必须在 AI Engine，避免重复实现   |

---

## 二、能力下沉清单

### 2.1 下沉能力概览

| 序号 | 能力       | 当前位置                                                 | 目标位置                                  | 优先级 |
| ---- | ---------- | -------------------------------------------------------- | ----------------------------------------- | ------ |
| 1    | 任务分解   | `ai-app/teams/mission/task-breakdown.service.ts`         | `ai-engine/decomposition/`                | P0     |
| 2    | Agent执行  | `ai-app/teams/mission/mission-execution.service.ts`      | `ai-engine/orchestration/agent-executor/` | P0     |
| 3    | 输出审核   | `ai-app/teams/mission/mission-review.service.ts`         | `ai-engine/review/`                       | P0     |
| 4    | 约束校验   | `ai-app/teams/context/constraint-enforcement.service.ts` | `ai-engine/constraint/validators/`        | P1     |
| 5    | Token预算  | `ai-app/teams/context/token-budget.service.ts`           | `ai-engine/constraint/budget/`            | P1     |
| 6    | 上下文构建 | `ai-app/teams/mission/mission-context.service.ts`        | `ai-engine/context/`                      | P1     |
| 7    | 迭代管理   | 新增                                                     | `ai-engine/iteration/`                    | P0     |

### 2.2 下沉后的目录结构

```
backend/src/modules/ai-engine/
├── core/                              # 核心定义（已有）
│   ├── interfaces/
│   │   ├── task.interface.ts          # 🆕 ITask, ITaskDefinition
│   │   ├── agent.interface.ts         # 已有
│   │   └── mission.interface.ts       # 🆕 IMission, IMissionPlan
│   └── types/
│
├── decomposition/                     # 🆕 任务分解
│   ├── index.ts
│   ├── task-decomposer.service.ts     # 核心分解服务
│   ├── strategies/
│   │   ├── sequential-decomposer.ts   # 顺序分解策略
│   │   ├── parallel-decomposer.ts     # 并行分解策略
│   │   └── dag-decomposer.ts          # DAG分解策略
│   ├── matchers/
│   │   └── member-matcher.service.ts  # 成员匹配
│   └── resolvers/
│       └── dependency-resolver.ts     # 依赖解析
│
├── orchestration/                     # 编排器（已有，增强）
│   ├── executors/
│   │   ├── base-executor.ts           # 已有
│   │   ├── sequential-executor.ts     # 已有
│   │   ├── parallel-executor.ts       # 已有
│   │   ├── dag-executor.ts            # 已有
│   │   └── agent-executor.ts          # 🆕 Agent任务执行器
│   └── scheduler/
│       └── task-scheduler.service.ts  # 🆕 任务调度器
│
├── review/                            # 🆕 审核机制
│   ├── index.ts
│   ├── output-reviewer.service.ts     # 输出审核服务
│   ├── feedback-generator.ts          # 反馈生成
│   ├── revision-manager.ts            # 修订管理
│   └── criteria/
│       ├── quality-criteria.ts        # 质量标准
│       └── consistency-criteria.ts    # 一致性标准
│
├── iteration/                         # 🆕 迭代管理
│   ├── index.ts
│   ├── iteration-manager.service.ts   # 迭代管理服务
│   ├── diff-tracker.service.ts        # 差异追踪
│   ├── partial-update.service.ts      # 部分更新
│   ├── version-manager.service.ts     # 版本管理
│   └── context/
│       └── iteration-context.ts       # 迭代上下文
│
├── constraint/                        # 约束系统（已有，增强）
│   ├── engine/
│   │   └── constraint-engine.ts       # 已有
│   ├── validators/                    # 🆕 约束校验
│   │   ├── constraint-extractor.ts    # 约束提取
│   │   ├── constraint-validator.ts    # 约束校验
│   │   └── violation-reporter.ts      # 违规报告
│   ├── budget/                        # 🆕 Token预算
│   │   ├── token-budget.service.ts    # Token预算服务
│   │   └── budget-allocator.ts        # 预算分配器
│   └── guardrails/
│       └── cost-controller.ts         # 已有
│
├── context/                           # 🆕 上下文管理
│   ├── index.ts
│   ├── context-builder.service.ts     # 上下文构建
│   ├── context-compressor.ts          # 上下文压缩
│   └── prompt-assembler.ts            # 提示词组装
│
├── memory/                            # 记忆系统（已有）
├── skills/                            # 技能系统（已有）
├── tools/                             # 工具系统（已有）
├── agents/                            # Agent库（已有）
├── collaboration/                     # 协作模式（已有）
└── teams/                             # 团队抽象（已有）
```

---

## 三、详细设计文档索引

| 文档          | 路径                                                                               | 说明                              |
| ------------- | ---------------------------------------------------------------------------------- | --------------------------------- |
| 任务分解设计  | [design/decomposition-service-design.md](./design/decomposition-service-design.md) | 任务分解服务详细设计              |
| Agent执行设计 | [design/agent-executor-design.md](./design/agent-executor-design.md)               | Agent执行器详细设计               |
| 审核机制设计  | [design/review-service-design.md](./design/review-service-design.md)               | 输出审核服务详细设计              |
| 迭代管理设计  | [design/iteration-manager-design.md](./design/iteration-manager-design.md)         | 迭代管理服务详细设计              |
| AI Studio重构 | [migration/ai-studio-refactor-plan.md](./migration/ai-studio-refactor-plan.md)     | AI Studio 基于 AI Engine 重构方案 |

---

## 四、实施路线图

### Phase 0: 基础准备 (1周)

```
目标: 准备工作，不影响现有功能

任务:
├── 1. 创建目录结构
│   ├── ai-engine/decomposition/
│   ├── ai-engine/review/
│   ├── ai-engine/iteration/
│   └── ai-engine/context/
│
├── 2. 定义核心接口
│   ├── ITaskDecomposer
│   ├── IAgentExecutor
│   ├── IOutputReviewer
│   └── IIterationManager
│
└── 3. 编写单元测试骨架
```

### Phase 1: 任务分解下沉 (1周)

```
目标: 将任务分解能力从 AI Teams 下沉到 AI Engine

任务:
├── 1. 实现 TaskDecomposerService
│   ├── 迁移 task-breakdown.service.ts 核心逻辑
│   ├── 抽象为通用接口
│   └── 支持多种分解策略
│
├── 2. 实现 MemberMatcherService
│   └── 成员匹配逻辑（模糊匹配、专业领域匹配）
│
├── 3. 实现 DependencyResolver
│   └── 任务依赖解析
│
├── 4. AI Teams 改为调用 AI Engine
│   └── TaskBreakdownService → 调用 TaskDecomposerService
│
└── 5. 验证
    ├── 单元测试
    └── 集成测试（AI Teams Mission 功能不变）
```

### Phase 2: Agent执行下沉 (1周)

```
目标: 将 Agent 执行调度能力下沉到 AI Engine

任务:
├── 1. 实现 AgentExecutorService
│   ├── 任务执行核心逻辑
│   ├── 并发控制
│   ├── 重试机制
│   └── 故障转移
│
├── 2. 实现 TaskSchedulerService
│   ├── 基于依赖的任务调度
│   └── 优先级队列
│
├── 3. AI Teams 改为调用 AI Engine
│   └── MissionExecutionService → 调用 AgentExecutorService
│
└── 4. 验证
```

### Phase 3: 审核机制下沉 (1周)

```
目标: 将输出审核能力下沉到 AI Engine

任务:
├── 1. 实现 OutputReviewerService
│   ├── 审核逻辑抽象
│   ├── 多种审核标准
│   └── 审核结果解析
│
├── 2. 实现 RevisionManager
│   ├── 修订循环管理
│   └── 最大修订次数控制
│
├── 3. AI Teams 改为调用 AI Engine
│   └── MissionReviewService → 调用 OutputReviewerService
│
└── 4. 验证
```

### Phase 4: 迭代管理能力 (2周)

```
目标: 实现持续迭代能力（新增）

任务:
├── 1. 实现 IterationManagerService
│   ├── 迭代请求处理
│   ├── 迭代上下文构建
│   └── 迭代执行编排
│
├── 2. 实现 DiffTrackerService
│   ├── 内容差异计算
│   └── 变更记录
│
├── 3. 实现 VersionManagerService
│   ├── 版本创建
│   └── 版本历史管理
│
├── 4. 实现 PartialUpdateService
│   ├── 选中内容更新
│   ├── 章节深化
│   └── 一致性保持
│
└── 5. 单元测试 + 集成测试
```

### Phase 5: AI Studio 重构 (2周)

```
目标: AI Studio 基于 AI Engine 重构

任务:
├── 1. 定义研究团队模板
│   ├── 快速调研团队
│   ├── 深度研究团队
│   └── 综合研究团队
│
├── 2. 重构 Deep Research 流程
│   └── 调用 AI Engine 的分解/执行/审核能力
│
├── 3. 实现结构化输出
│   ├── 章节 ID
│   ├── 作者溯源
│   └── 引用关联
│
├── 4. 集成迭代能力
│   ├── 前端选中交互
│   └── 后端迭代接口
│
└── 5. 全量测试
```

---

## 五、风险与缓解

| 风险                 | 影响 | 缓解措施                         |
| -------------------- | ---- | -------------------------------- |
| 下沉过程影响现有功能 | 高   | 保持双写模式，逐步切换           |
| 接口设计不够通用     | 中   | 先分析 AI Office/Simulation 需求 |
| 性能下降             | 中   | 基准测试，优化热点路径           |
| 测试覆盖不足         | 中   | 先写测试，再迁移代码             |

---

## 六、成功指标

| 指标       | 目标                                        |
| ---------- | ------------------------------------------- |
| 代码复用率 | AI Teams 中 80%+ 的核心逻辑迁移到 AI Engine |
| 功能回归   | AI Teams Mission 功能 100% 正常             |
| 新增能力   | 迭代管理能力可用                            |
| 文档完整性 | 每个下沉能力有详细设计文档                  |

---

## 七、相关文档

- [AI Engine 架构 PRD](./ai-engine-architecture-prd.md)
- [AI Teams 架构改进计划](../architecture/ai-teams-architecture-improvement-plan.md)
- [AI Teams 核心集成计划](../architecture/ai-teams-core-integration-plan.md)

---

## 附录：术语表

| 术语            | 定义                           |
| --------------- | ------------------------------ |
| **下沉 (Sink)** | 将应用层的通用能力移动到引擎层 |
| **任务分解**    | 将大任务拆分为多个子任务的过程 |
| **Agent执行**   | 调度 Agent 执行具体任务的能力  |
| **输出审核**    | Leader 检查成员产出质量的机制  |
| **迭代管理**    | 对已有输出进行增量更新的能力   |

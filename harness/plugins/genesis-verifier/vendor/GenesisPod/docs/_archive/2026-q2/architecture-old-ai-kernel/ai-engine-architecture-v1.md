# AI Engine 架构文档

> 版本: 1.0 | 更新日期: 2026-01-02 | 文件数: 242

## 1. 概述

AI Engine 是 GenesisPod 的核心基座层，提供统一的多 Agent 协作引擎能力。

```
┌─────────────────────────────────────────────────────────────────┐
│                     AI Applications                              │
│  (ai-studio, ai-office, ai-teams, ai-simulation, ai-coding)     │
├─────────────────────────────────────────────────────────────────┤
│                       AI Engine (本模块)                         │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐ │
│  │  Agents │  Tools  │  Skills │ Orchestr│ Collab  │Constraint│ │
│  ├─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤ │
│  │   LLM   │  Memory │   MCP   │   RAG   │  Image  │  Search │ │
│  └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                          Core Layer                              │
│              (types, interfaces, errors, exceptions)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 目录结构

```
ai-engine/
├── ai-engine.module.ts          # NestJS 主模块
├── index.ts                     # 统一导出
│
├── core/                        # 核心抽象层
│   ├── types/                   # 基础类型定义
│   │   ├── common.types.ts      # 通用类型
│   │   ├── context.types.ts     # 上下文类型
│   │   ├── event.types.ts       # 事件类型
│   │   └── agent.types.ts       # Agent 相关类型
│   ├── interfaces/              # 核心接口
│   │   ├── executable.interface.ts   # IExecutable 统一执行接口
│   │   ├── registry.interface.ts     # IRegistry 注册表接口
│   │   └── lifecycle.interface.ts    # 生命周期接口
│   ├── errors/                  # 错误类型
│   │   ├── engine.error.ts        # 基础错误类
│   │   ├── tool.error.ts        # 工具错误
│   │   ├── skill.error.ts       # 技能错误
│   │   └── agent-error.ts       # Agent 错误
│   └── exceptions/              # 异常类型
│       └── ai-service.exception.ts   # AI 服务异常
│
├── tools/                       # 工具系统 (48+ 工具)
│   ├── abstractions/            # 工具接口
│   │   └── tool.interface.ts    # ITool 接口
│   ├── base/                    # 基类
│   │   └── base-tool.ts         # BaseTool
│   ├── middleware/              # 中间件
│   │   ├── tool-pipeline.ts     # 工具管道
│   │   ├── validation.middleware.ts
│   │   └── timeout.middleware.ts
│   ├── registry/                # 注册表
│   │   └── tool.registry.ts     # ToolRegistry
│   └── categories/              # 工具分类 (48 个)
│       ├── information/         # 信息获取类
│       ├── generation/          # 内容生成类
│       ├── processing/          # 数据处理类
│       ├── execution/           # 执行类
│       ├── collaboration/       # 协作类
│       ├── integration/         # 集成类
│       ├── export/              # 导出类
│       └── memory/              # 记忆类
│
├── skills/                      # 技能系统
│   ├── abstractions/            # 技能接口
│   │   └── skill.interface.ts   # ISkill 接口
│   ├── base/                    # 基类
│   │   └── base-skill.ts        # BaseSkill
│   └── registry/                # 注册表
│       └── skill.registry.ts    # SkillRegistry (层次/领域/标签索引)
│
├── agents/                      # Agent 框架
│   ├── abstractions/            # Agent 接口
│   │   └── agent.interface.ts   # IAgent 接口
│   ├── base/                    # 基类
│   │   ├── base-agent.ts        # BaseAgent
│   │   ├── reactive-agent.ts    # ReAct 循环模式
│   │   └── plan-agent.ts        # Plan-Based 模式
│   ├── registry/                # 注册表
│   │   ├── agent-registry.ts    # AgentRegistry
│   │   └── agent-orchestrator.ts
│   ├── implementations/         # 内置 Agent (6 个)
│   │   ├── researcher/          # 研究员 Agent
│   │   ├── developer/           # 开发者 Agent
│   │   ├── designer/            # 设计师 Agent
│   │   ├── image-designer/      # 图像设计 Agent
│   │   ├── simulator/           # 模拟器 Agent
│   │   └── team-collaboration/  # 团队协作 Agent
│   └── api/                     # HTTP API
│       ├── agents.controller.ts
│       ├── agents.service.ts
│       └── dto/                 # 请求/响应 DTO
│
├── orchestration/               # 编排引擎
│   ├── abstractions/            # 编排接口
│   │   └── orchestrator.interface.ts  # 4 种执行模式定义
│   ├── executors/               # 执行器
│   │   ├── sequential-executor.ts     # 顺序执行
│   │   ├── parallel-executor.ts       # 并行执行
│   │   ├── dag-executor.ts            # DAG 执行 (依赖检测)
│   │   └── function-calling-executor.ts
│   └── checkpoints/             # 检查点
│       └── checkpoint-manager.ts
│
├── collaboration/               # 协作框架
│   ├── abstractions/            # 协作接口
│   │   └── collaborator.interface.ts
│   └── patterns/                # 协作模式
│       ├── handoff-pattern.ts   # 任务委派模式
│       └── voting-pattern.ts    # 共识投票模式
│
├── constraint/                  # 约束引擎
│   ├── validators/              # 验证器
│   │   └── schema-validator.ts
│   └── guardrails/              # 安全护栏
│       ├── cost-controller.ts   # 成本控制 (预算/告警)
│       ├── rate-limiter.ts      # 速率限制
│       └── content-filter.ts    # 内容过滤
│
├── llm/                         # LLM 适配层
│   ├── abstractions/            # LLM 接口
│   │   └── llm-adapter.interface.ts
│   ├── adapters/                # 适配器
│   │   ├── base-llm.adapter.ts
│   │   └── function-calling-llm.adapter.ts
│   ├── factory/                 # 工厂
│   │   └── llm.factory.ts       # LLMFactory
│   └── services/                # 服务
│       └── ai-chat.service.ts   # 统一 Chat 服务
│
├── memory/                      # 记忆系统
│   ├── abstractions/            # 记忆接口
│   │   └── memory.interface.ts
│   └── stores/                  # 存储实现
│       ├── in-memory-store.ts
│       ├── short-term-memory.service.ts
│       └── long-term-memory.service.ts
│
├── mcp/                         # MCP 协议 (Model Context Protocol)
│   ├── abstractions/            # MCP 接口
│   │   └── mcp.interface.ts
│   ├── client/                  # 客户端
│   │   └── mcp-client.ts        # Stdio 传输实现
│   ├── manager/                 # 管理器
│   │   └── mcp-manager.ts       # 多服务器管理
│   └── tools/                   # 工具适配
│       └── mcp-tool-adapter.ts
│
├── image/                       # 图像生成
│   ├── abstractions/            # 图像接口
│   │   └── image-adapter.interface.ts
│   ├── adapters/                # 适配器
│   │   ├── openai-image.adapter.ts
│   │   ├── gemini-image.adapter.ts
│   │   ├── stability-image.adapter.ts
│   │   └── together-image.adapter.ts
│   ├── factory/                 # 工厂
│   │   └── image.factory.ts
│   └── image.module.ts
│
├── rag/                         # RAG 管道
│   ├── embedding/               # 向量嵌入
│   │   └── embedding.service.ts
│   ├── chunking/                # 文档分块
│   │   └── document-chunker.ts
│   ├── vector/                  # 向量存储
│   │   └── vector.service.ts
│   └── pipeline/                # RAG 管道
│
├── search/                      # 搜索服务
│   └── search.service.ts        # Tavily/Serper/DuckDuckGo
│
├── teams/                       # Team 模型 (高级抽象)
│   ├── abstractions/            # Team 接口
│   ├── base/                    # 基类
│   ├── factory/                 # Team 工厂
│   ├── orchestrator/            # Mission 编排
│   │   └── mission-orchestrator.ts
│   ├── registry/                # Team 注册表
│   ├── services/                # Team 服务
│   ├── templates/               # 预定义 Team 模板
│   └── controllers/             # HTTP API
│
├── api/                         # 公共 API
│   ├── ai-core.controller.ts    # /api/v1/ai/* 端点
│   └── ai-core.service.ts       # 模型管理服务
│
├── docs/                        # 文档
│   ├── ARCHITECTURE.md          # 本文档
│   └── ai-engine-architecture-prd.md
│
└── __tests__/                   # 单元测试
    ├── agents/
    ├── tools/
    ├── orchestration/
    ├── constraint/
    └── memory/
```

---

## 3. 核心接口

### 3.1 IExecutable - 统一执行接口

所有可执行单元 (Tool/Skill/Agent) 的基础接口：

```typescript
interface IExecutable<TInput, TOutput, TContext = BaseContext> {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  execute(input: TInput, context: TContext): Promise<ExecutionResult<TOutput>>;
  validateInput?(input: TInput): ValidationResult;
  getCapabilities?(): CapabilityDescriptor;
}
```

### 3.2 ITool - 工具接口

```typescript
interface ITool<TInput, TOutput> extends IExecutable<
  TInput,
  TOutput,
  ToolContext
> {
  readonly category: ToolCategory;
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema;

  toFunctionDefinition(): FunctionDefinition; // LLM Function Calling
}
```

### 3.3 ISkill - 技能接口

```typescript
interface ISkill<TInput, TOutput> extends IExecutable<
  TInput,
  TOutput,
  SkillContext
> {
  readonly layer: SkillLayer; // atomic | composed | workflow
  readonly domain: string; // research | generation | analysis
  readonly requiredTools?: string[];
  readonly requiredSkills?: string[];

  checkPreconditions?(context: SkillContext): Promise<PreconditionResult>;
  getFallback?(): ISkill<TInput, TOutput> | null;
}
```

### 3.4 IAgent - Agent 接口

```typescript
interface IAgent<TInput, TOutput> extends IExecutable<
  TInput,
  TOutput,
  AgentContext
> {
  readonly capabilities: AgentCapability[];
  readonly supportedModes: ExecutionMode[]; // reactive | plan-based

  plan?(input: TInput, context: AgentContext): Promise<ExecutionPlan>;
  executeStream?(
    plan: ExecutionPlan,
    context: AgentContext,
  ): AsyncGenerator<AgentEvent>;
}
```

---

## 4. 编排引擎

### 4.1 执行模式

| 模式         | 说明       | 适用场景 |
| ------------ | ---------- | -------- |
| `sequential` | 顺序执行   | 简单流程 |
| `parallel`   | 并行执行   | 独立任务 |
| `dag`        | DAG 执行   | 复杂依赖 |
| `reactive`   | 响应式执行 | 动态决策 |

### 4.2 步骤类型 (11 种)

```typescript
type StepType =
  | "tool" // 工具调用
  | "skill" // 技能调用
  | "agent" // Agent 调用
  | "decision" // 决策节点
  | "parallel" // 并行执行
  | "loop" // 循环
  | "map" // 映射 (并行处理数组)
  | "reduce" // 归约
  | "checkpoint" // 检查点
  | "human" // 人工介入
  | "subflow"; // 子工作流
```

---

## 5. 协作模式

### 5.1 Handoff Pattern (任务委派)

```
Leader ──delegate──> Member ──report──> Leader ──review──> [approve|rework]
```

### 5.2 Voting Pattern (共识投票)

支持策略：

- `majority` - 过半数
- `supermajority` - 三分之二
- `unanimous` - 全票通过
- `weighted` - 加权投票

---

## 6. 约束引擎

### 6.1 成本控制 (CostController)

```typescript
interface CostControllerConfig {
  budget: {
    hourly?: number;
    daily?: number;
    weekly?: number;
    monthly?: number;
  };
  alertThreshold: number; // 0.8 = 80% 时告警
  modelPricing: Record<string, TokenPricing>;
}
```

### 6.2 速率限制 (RateLimiter)

```typescript
interface RateLimitConfig {
  windowMs: number; // 时间窗口
  maxRequests: number; // 最大请求数
  keyGenerator?: (ctx) => string;
}
```

---

## 7. 模块依赖图

```
                    ┌─────────────────────────────────────────┐
                    │              ai-engine.module           │
                    └─────────────────────────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
┌───────────────┐               ┌───────────────┐               ┌───────────────┐
│   Registries  │               │   Executors   │               │   Services    │
├───────────────┤               ├───────────────┤               ├───────────────┤
│ ToolRegistry  │               │ Sequential    │               │ AiChatService │
│ SkillRegistry │◄──────────────│ Parallel      │               │ SearchService │
│ AgentRegistry │               │ DAG           │               │ ImageFactory  │
└───────┬───────┘               │ FunctionCall  │               │ EmbeddingServ │
        │                       └───────────────┘               └───────────────┘
        │                               │
        │                               ▼
        │                       ┌───────────────┐
        │                       │ Collaboration │
        │                       ├───────────────┤
        │                       │ Handoff       │
        │                       │ Voting        │
        │                       └───────────────┘
        │                               │
        ▼                               ▼
┌───────────────┐               ┌───────────────┐
│  Constraint   │               │    Memory     │
├───────────────┤               ├───────────────┤
│ CostController│               │ ShortTerm     │
│ RateLimiter   │               │ LongTerm      │
│ ContentFilter │               │ InMemoryStore │
└───────────────┘               └───────────────┘
```

---

## 8. 使用示例

### 8.1 注册自定义工具

```typescript
import { Injectable } from "@nestjs/common";
import { ToolRegistry, BaseTool, ToolResult } from "@/modules/ai-engine";

@Injectable()
export class MyToolRegistrar {
  constructor(private readonly toolRegistry: ToolRegistry) {
    this.registerTools();
  }

  private registerTools() {
    this.toolRegistry.register(new MyCustomTool());
  }
}

class MyCustomTool extends BaseTool<MyInput, MyOutput> {
  readonly id = "my-custom-tool";
  readonly name = "My Custom Tool";
  readonly category = "processing";

  async executeCore(input: MyInput): Promise<ToolResult<MyOutput>> {
    // 实现逻辑
    return { success: true, data: result };
  }
}
```

### 8.2 使用 DAG 执行器

```typescript
import { DAGExecutor } from "@/modules/ai-engine";

const workflow = {
  mode: "dag",
  steps: [
    { id: "step1", type: "tool", toolId: "search", input: { query: "..." } },
    { id: "step2", type: "tool", toolId: "analyze", dependsOn: ["step1"] },
    { id: "step3", type: "skill", skillId: "summarize", dependsOn: ["step2"] },
  ],
};

const result = await dagExecutor.execute(workflow, context);
```

### 8.3 使用成本控制

```typescript
import { CostController } from "@/modules/ai-engine";

const controller = new CostController({
  budget: { daily: 100 }, // $100/天
  alertThreshold: 0.8,
});

// 检查预算
if (!controller.canSpend(estimatedCost)) {
  throw new BudgetExceededError();
}

// 记录消耗
controller.recordUsage({
  category: "llm",
  tokens: { input: 1000, output: 500 },
  model: "gpt-4o",
});
```

---

## 9. 导出清单

通过 `@/modules/ai-engine` 统一导出：

| 分类              | 导出项                                                                             |
| ----------------- | ---------------------------------------------------------------------------------- |
| **Registries**    | `ToolRegistry`, `SkillRegistry`, `AgentRegistry`                                   |
| **Executors**     | `SequentialExecutor`, `ParallelExecutor`, `DAGExecutor`, `FunctionCallingExecutor` |
| **Collaboration** | `VotingManager`, `HandoffCoordinator`                                              |
| **Constraint**    | `CostController`, `RateLimiter`, `ContentFilter`, `SchemaValidator`                |
| **LLM**           | `LLMFactory`, `AiChatService`, `FunctionCallingLLMAdapter`                         |
| **Memory**        | `ShortTermMemoryService`, `LongTermMemoryService`, `InMemoryStore`                 |
| **MCP**           | `MCPManager`, `MCPClient`                                                          |
| **Image**         | `ImageFactory`                                                                     |
| **Search**        | `SearchService`                                                                    |
| **RAG**           | `EmbeddingService`, `VectorService`, `DocumentChunker`                             |

---

## 10. 统计信息

| 指标       | 数值 |
| ---------- | ---- |
| 总文件数   | 242  |
| 目录数     | 77   |
| 内置工具   | 48   |
| 内置 Agent | 6    |
| 执行模式   | 4    |
| 步骤类型   | 11   |
| 协作模式   | 2    |
| 图像适配器 | 4    |

---

## 附录

### A. 相关文档

- [架构重构 PRD](./ai-engine-architecture-prd.md)
- [产品愿景](../../../docs/ai-teams/ai-teams-product-vision.md)

### B. 变更历史

| 版本 | 日期       | 变更内容 |
| ---- | ---------- | -------- |
| 1.0  | 2026-01-02 | 初始版本 |



# AI Engine 架构重构 PRD

> **版本**: v1.0
> **创建日期**: 2026-01-02
> **状态**: 已批准，实施中

## 1. 概述

将现有 `ai-agents` 模块重构为分层的 `ai-engine` 架构：**AI Application → AI Engine → AI Core**

### 1.1 决策确认

| 决策项       | 选择                                 |
| ------------ | ------------------------------------ |
| 迁移策略     | 一次性迁移（直接重构，不保留兼容层） |
| 应用层处理   | 提取通用能力到 ai-engine             |
| Skill 动态性 | 静态注册                             |
| 交付阶段     | 6 个阶段                             |

### 1.2 设计原则

- **SOLID 原则**: 单一职责、开闭原则、依赖倒置
- **可扩展性**: 使用字符串 ID 替代枚举，支持动态注册
- **职责分离**: 工具中间件模式，BaseTool 精简化
- **统一执行**: 合并 Plan-Based 和 ReAct 两套执行模式

---

## 2. 目标架构

```
backend/src/modules/ai/
├── ai-engine/                    # 基座层（通用多Agent引擎）
│   ├── core/                     # 核心抽象
│   │   ├── types/                # 基础类型
│   │   ├── errors/               # 统一错误系统
│   │   └── interfaces/           # 核心接口
│   │
│   ├── tools/                    # 工具系统
│   │   ├── abstractions/         # 工具抽象
│   │   ├── base/                 # 基类
│   │   ├── middleware/           # 中间件
│   │   ├── registry/             # 注册表
│   │   └── categories/           # 48个工具分类
│   │
│   ├── skills/                   # 技能系统
│   │   ├── abstractions/         # 技能抽象
│   │   ├── base/                 # 基类
│   │   ├── registry/             # 注册表
│   │   └── builtin/              # 内置技能
│   │
│   ├── agents/                   # Agent 框架
│   │   ├── abstractions/         # Agent 抽象
│   │   ├── base/                 # 基类
│   │   ├── registry/             # 注册表
│   │   └── routing/              # 路由
│   │
│   ├── orchestration/            # 编排引擎
│   │   ├── executors/            # 执行器
│   │   ├── planners/             # 计划器
│   │   ├── checkpoints/          # 检查点
│   │   └── events/               # 事件系统
│   │
│   ├── collaboration/            # 协作框架
│   │   ├── patterns/             # 协作模式
│   │   ├── protocols/            # 通信协议
│   │   └── consensus/            # 共识机制
│   │
│   ├── constraint/               # 约束引擎
│   │   ├── validators/           # 验证器
│   │   ├── guardrails/           # 安全护栏
│   │   └── policies/             # 策略
│   │
│   ├── llm/                      # LLM 适配层
│   ├── memory/                   # 记忆系统
│   └── mcp/                      # MCP 协议
│
├── ai-teams/                     # 应用：AI Teams
├── ai-studio/                    # 应用：深度研究
├── ai-simulation/                # 应用：辩论模拟
├── ai-coding/                    # 应用：AI 编程
└── ai-office/                    # 应用：办公套件
```

---

## 3. 核心接口设计

### 3.1 IExecutable - 统一执行接口

```typescript
interface IExecutable<TInput, TOutput, TContext = BaseContext> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  execute(input: TInput, context: TContext): Promise<ExecutionResult<TOutput>>;
  validateInput?(input: TInput): ValidationResult;
  getCapabilities?(): CapabilityDescriptor;
}

interface ExecutionResult<T> {
  success: boolean;
  data?: T;
  error?: ExecutionError;
  metadata: ExecutionMetadata;
}
```

### 3.2 ITool - 工具接口

```typescript
interface ITool<TInput = unknown, TOutput = unknown> extends IExecutable<
  TInput,
  TOutput,
  ToolContext
> {
  readonly category: ToolCategory;
  readonly inputSchema: JSONSchema;
  readonly outputSchema: JSONSchema;
  readonly defaultTimeout?: number;
  toFunctionDefinition(): FunctionDefinition;
}

// 使用字符串而非枚举
type ToolCategory =
  | "information"
  | "generation"
  | "processing"
  | "execution"
  | "integration"
  | "memory"
  | "export"
  | "collaboration"
  | string;
```

### 3.3 ISkill - 技能接口

```typescript
interface ISkill<TInput, TOutput> extends IExecutable<
  TInput,
  TOutput,
  SkillContext
> {
  readonly layer: SkillLayer;
  readonly domain: string;
  readonly requiredTools?: string[];
  readonly requiredSkills?: string[];
  checkPreconditions?(context: SkillContext): Promise<PreconditionResult>;
  getFallback?(): ISkill<TInput, TOutput> | null;
}

type SkillLayer =
  | "understanding"
  | "planning"
  | "design"
  | "content"
  | "rendering"
  | "optimization"
  | "quality"
  | string;
```

### 3.4 IAgent - Agent 接口

```typescript
interface IAgent<
  TInput = AgentInput,
  TOutput = AgentResult,
> extends IExecutable<TInput, TOutput, AgentContext> {
  readonly capabilities: string[];
  readonly supportedModes: ExecutionMode[];
  readonly requiredSkills?: string[];
  readonly requiredTools?: string[];
  plan(input: TInput, context: AgentContext): Promise<ExecutionPlan>;
  executeStream(
    plan: ExecutionPlan,
    context: AgentContext,
  ): AsyncGenerator<AgentEvent>;
  isReady(): boolean;
}

type ExecutionMode = "plan-based" | "reactive" | "hybrid";
```

### 3.5 IRegistry - 注册表接口

```typescript
interface IRegistry<T extends { id: string }> {
  register(item: T): void;
  registerMany(items: T[]): void;
  get(id: string): T;
  tryGet(id: string): T | undefined;
  has(id: string): boolean;
  getAll(): T[];
  unregister(id: string): boolean;
  clear(): void;
}
```

---

## 4. 关键改进

### 4.1 工具中间件模式

**问题**: 现有 `BaseTool` 承担过多职责（验证、超时、重试、错误处理）

**解决方案**:

```typescript
// 中间件接口
interface IToolMiddleware {
  before?(input: unknown, context: ToolContext): Promise<void>;
  after?(result: ToolResult, context: ToolContext): Promise<ToolResult>;
  onError?(error: Error, context: ToolContext): Promise<ToolResult | void>;
}

// 使用管道
const pipeline = new ToolPipeline()
  .use(new ValidationMiddleware(validator))
  .use(new TimeoutMiddleware(30000))
  .use(new RetryMiddleware({ maxRetries: 3 }))
  .use(new LoggingMiddleware());

const result = await pipeline.execute(tool, input, context);
```

### 4.2 字符串 ID 替代枚举

**问题**: `AgentType`、`ToolType` 枚举不可扩展

**解决方案**:

```typescript
// 之前
enum AgentType { SLIDES = "SLIDES", DOCS = "DOCS" }

// 之后
export type AgentId = string;
export const BUILTIN_AGENTS = {
  SLIDES: 'slides',
  DOCS: 'docs',
} as const;

// 注册表接受任意字符串
registry.register({ id: 'my-custom-agent', ... });
```

### 4.3 统一执行模式

**问题**: Plan-Based 和 Function Calling 两套执行系统

**解决方案**:

```typescript
abstract class BaseAgent implements IAgent {
  readonly supportedModes: ExecutionMode[] = ["plan-based", "reactive"];

  async execute(input: AgentInput, context: AgentContext) {
    const mode = context.executionMode || this.defaultMode;
    switch (mode) {
      case "plan-based":
        return this.executePlanBased(input, context);
      case "reactive":
        return this.executeReactive(input, context);
      case "hybrid":
        return this.executeHybrid(input, context);
    }
  }
}
```

---

## 5. 交付阶段

### 阶段 1: Core 核心层

- 创建 `ai-engine/core/`
- 类型系统、错误处理、基础接口
- 迁移: `ai-agents/core/errors/`

### 阶段 2: Tools 工具系统

- 创建 `ai-engine/tools/`
- 中间件模式重构
- 迁移: 48 个工具

### 阶段 3: Skills 技能系统

- 创建 `ai-engine/skills/`
- BaseSkill 设计
- 迁移: `ai-office/slides/skills/` 通用部分

### 阶段 4: Agents 框架

- 创建 `ai-engine/agents/` + `llm/` + `memory/` + `mcp/`
- 统一执行模式
- 迁移: Agent 核心

### 阶段 5: Orchestration 编排引擎

- 创建 `ai-engine/orchestration/`
- 工作流引擎、检查点系统
- 迁移: 执行器

### 阶段 6: Collaboration + Constraint

- 创建 `ai-engine/collaboration/` + `constraint/`
- 协作模式、约束引擎
- 迁移: 协作工具、护栏系统

---

## 6. 文件变更统计

| 类别         | 数量                   |
| ------------ | ---------------------- |
| 新增核心文件 | ~60 个                 |
| 迁移工具文件 | 48 个                  |
| 迁移技能文件 | ~20 个                 |
| 删除旧文件   | `ai-agents/core/` 整体 |

---

## 7. 模块依赖关系

```
core ─────┬──────────────────────────────────────────┐
          │                                          │
          ▼                                          │
       tools ◄── llm      memory                     │
          │       ▲          ▲                       │
          ▼       │          │                       │
       skills ────┴──────────┘                       │
          │                                          │
          ▼                                          │
       agents                                        │
          │                                          │
          ▼                                          │
    orchestration ──► collaboration                  │
          │                                          │
          ▼                                          │
     constraint ◄────────────────────────────────────┘
```

**依赖规则**:

- `core` 是最底层，不依赖其他模块
- `tools` 只依赖 `core`
- `skills` 依赖 `core`, `tools`, `llm`, `memory`
- `agents` 依赖 `core`, `tools`, `skills`
- `constraint` 被所有模块使用，但只依赖 `core`

---

## 8. 验证标准

每个阶段完成后需验证：

1. **编译通过**: `npm run build`
2. **测试通过**: `npm run test`
3. **API 兼容**: 应用层调用方式不变
4. **功能正常**: 手动测试核心流程

---

## 9. 风险与缓解

| 风险                   | 缓解措施                               |
| ---------------------- | -------------------------------------- |
| 大规模重构导致功能失效 | 每阶段完成后进行集成测试               |
| 循环依赖               | 严格遵循依赖方向                       |
| NestJS 模块加载顺序    | 使用 `forwardRef()` 处理必要的循环引用 |
| 接口不兼容             | 保持 Execute 返回类型一致              |

---

## 附录: 现有代码映射

| 现有路径                           | 目标路径                       |
| ---------------------------------- | ------------------------------ |
| `ai-agents/core/agent/`            | `ai-engine/agents/`            |
| `ai-agents/core/tool/`             | `ai-engine/tools/`             |
| `ai-agents/core/execution/`        | `ai-engine/orchestration/`     |
| `ai-agents/core/llm/`              | `ai-engine/llm/`               |
| `ai-agents/core/memory/`           | `ai-engine/memory/`            |
| `ai-agents/core/mcp/`              | `ai-engine/mcp/`               |
| `ai-agents/core/guardrails/`       | `ai-engine/constraint/`        |
| `ai-agents/tools/`                 | `ai-engine/tools/categories/`  |
| `ai-office/slides/skills/`         | `ai-engine/skills/` (通用部分) |
| `ai-teams/services/collaboration/` | `ai-engine/collaboration/`     |

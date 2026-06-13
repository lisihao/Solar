# AI-Agents 模块能力概览

**技术架构文档**

---

## 文档信息

| 属性     | 内容                                |
| -------- | ----------------------------------- |
| 版本     | v1.0                                |
| 作者     | Architecture Team                   |
| 创建日期 | 2025-12-19                          |
| 状态     | 已发布                              |
| 关联模块 | `backend/src/modules/ai/ai-agents/` |

---

## 目录

1. [模块概述](#1-模块概述)
2. [核心架构](#2-核心架构)
3. [Agent 系统](#3-agent-系统)
4. [工具系统](#4-工具系统)
5. [执行引擎](#5-执行引擎)
6. [记忆系统](#6-记忆系统)
7. [安全护栏](#7-安全护栏)
8. [MCP 协议支持](#8-mcp-协议支持)
9. [API 端点](#9-api-端点)
10. [可复用服务清单](#10-可复用服务清单)

---

## 1. 模块概述

### 1.1 定位

**ai-agents** 是 GenesisPod 的核心 Agent 矩阵系统，实现了一个高度可扩展的多 Agent 协作框架。作为 AI 能力的基础设施层，为其他业务模块提供：

- 统一的 Agent 抽象和生命周期管理
- 完整的工具系统（48 种工具，8 大类别）
- 灵活的执行引擎（Plan 模式 + Autonomous 模式）
- 多模型 LLM 适配层
- 安全护栏和验证系统

### 1.2 能力矩阵总览

| 能力维度       | 覆盖范围                           | 实现状态 |
| -------------- | ---------------------------------- | -------- |
| **Agent 类型** | 4 种专项 Agent                     | 完整实现 |
| **工具数量**   | 48 种工具（8 大分类）              | 完整实现 |
| **执行模式**   | Plan + Autonomous                  | 完整实现 |
| **LLM 支持**   | OpenAI, Anthropic, Google, Grok+   | 完整实现 |
| **任务管理**   | 完整生命周期 + SSE 流              | 完整实现 |
| **产出物类型** | PPTX, DOCX, PDF, IMAGE, CODE, DATA | 完整实现 |
| **错误处理**   | 细粒度分类 + 智能重试              | 完整实现 |
| **安全护栏**   | 5 大类型安全控制                   | 完整实现 |
| **记忆系统**   | 短期 + 长期 + 语义搜索             | 完整实现 |
| **MCP 支持**   | 资源 + 工具 + 进度                 | 完整实现 |

### 1.3 代码规模

```
ai-agents/
├── core/                 # 核心引擎 (~15,000 行)
├── implementations/      # Agent 实现 (~3,000 行)
├── tools/               # 工具实现 (~4,000 行)
├── dto/                 # API DTO (~1,500 行)
└── *.ts                 # 模块入口 (~500 行)

总计: ~24,000 行 TypeScript 代码
```

---

## 2. 核心架构

### 2.1 分层架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Layer                                 │
│  AiAgentsController (REST API + SSE Stream)                     │
├─────────────────────────────────────────────────────────────────┤
│                     Service Layer                                │
│  AiAgentsService (任务管理 + 产出物持久化)                       │
├─────────────────────────────────────────────────────────────────┤
│                   Orchestration Layer                            │
│  AgentOrchestrator ─── AgentRegistry ─── ToolRegistry           │
├─────────────────────────────────────────────────────────────────┤
│                    Execution Layer                               │
│  FunctionCallingExecutor ─── LLMAdapter ─── RetryStrategy       │
├─────────────────────────────────────────────────────────────────┤
│                     Agent Layer                                  │
│  BaseAgent → SlidesAgent | DocsAgent | DesignerAgent | Developer│
├─────────────────────────────────────────────────────────────────┤
│                      Tool Layer                                  │
│  BaseTool → 48 种具体工具实现                                    │
├─────────────────────────────────────────────────────────────────┤
│                   Cross-Cutting Concerns                         │
│  Memory │ Guardrails │ Validation │ Metrics │ MCP │ Errors     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心目录结构

```
backend/src/modules/ai/ai-agents/
├── core/
│   ├── agent/           # Agent 核心
│   │   ├── agent.interface.ts      # IAgent 接口定义
│   │   ├── base.agent.ts           # BaseAgent 抽象基类
│   │   ├── agent.registry.ts       # Agent 注册中心
│   │   ├── agent.orchestrator.ts   # Agent 编排器
│   │   └── agent.types.ts          # 类型定义
│   │
│   ├── tool/            # 工具核心
│   │   ├── tool.interface.ts       # ITool 接口定义
│   │   ├── base.tool.ts            # BaseTool 抽象基类
│   │   ├── tool.registry.ts        # 工具注册中心
│   │   └── tool.types.ts           # 工具类型枚举
│   │
│   ├── execution/       # 执行引擎
│   │   ├── function-calling-executor.ts  # Function Calling 执行器
│   │   ├── execution-metrics.ts          # 执行指标收集
│   │   └── retry-strategy.ts             # 重试策略
│   │
│   ├── llm/             # LLM 适配层
│   │   ├── llm-adapter.interface.ts      # LLM 适配器接口
│   │   ├── llm-adapter.factory.ts        # 适配器工厂
│   │   └── providers/                    # 各 Provider 实现
│   │
│   ├── memory/          # 记忆系统
│   │   ├── memory.interface.ts           # 记忆接口
│   │   ├── short-term.memory.ts          # 短期记忆
│   │   └── long-term.memory.ts           # 长期记忆
│   │
│   ├── mcp/             # MCP 协议支持
│   │   ├── mcp-adapter.ts                # MCP 适配器
│   │   ├── mcp-server.ts                 # MCP 服务器
│   │   ├── resource-manager.ts           # 资源管理器
│   │   └── transports/                   # 传输协议
│   │
│   ├── guardrails/      # 安全护栏
│   │   ├── guardrail.service.ts          # 护栏服务
│   │   ├── content-filter.ts             # 内容过滤
│   │   ├── pii-detector.ts               # PII 检测
│   │   └── rate-limiter.ts               # 速率限制
│   │
│   ├── validation/      # 验证系统
│   │   ├── schema-validator.ts           # JSONSchema 验证
│   │   └── format-validators.ts          # 格式验证器
│   │
│   └── errors/          # 错误系统
│       ├── tool.error.ts                 # 工具错误
│       └── error-codes.constants.ts                # 错误码定义
│
├── implementations/     # Agent 实现
│   ├── slides.agent.ts                   # PPT 生成 Agent
│   ├── docs.agent.ts                     # 文档生成 Agent
│   ├── designer.agent.ts                 # 设计 Agent
│   └── developer.agent.ts                # 开发 Agent
│
├── tools/               # 工具实现
│   ├── information/     # 信息获取类
│   ├── generation/      # 内容生成类
│   ├── processing/      # 数据处理类
│   ├── execution/       # 代码执行类
│   ├── integration/     # 外部集成类
│   ├── memory/          # 记忆管理类
│   ├── export/          # 产出物导出类
│   └── collaboration/   # Agent 协作类
│
├── dto/                 # 数据传输对象
│   ├── execute-request.dto.ts
│   ├── task-response.dto.ts
│   └── artifact.dto.ts
│
├── ai-agents.module.ts  # NestJS 模块定义
├── ai-agents.service.ts # 主服务
└── ai-agents.controller.ts # REST 控制器
```

---

## 3. Agent 系统

### 3.1 Agent 类型枚举

```typescript
enum AgentType {
  SLIDES = "slides", // PPT 生成专家
  DOCS = "docs", // 文档撰写专家
  DESIGNER = "designer", // 设计生成专家
  DEVELOPER = "developer", // 代码开发专家
}
```

### 3.2 Agent 接口定义

```typescript
interface IAgent {
  // 基本信息
  readonly type: AgentType;
  readonly config: AgentConfig;

  // 生命周期方法
  plan(input: AgentInput): Promise<AgentPlan>;
  execute(plan: AgentPlan): AsyncGenerator<AgentEvent>;

  // 能力查询
  getCapabilities(): string[];
  getRequiredTools(): ToolType[];
  getSupportedModels(): AIModelType[];
}

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  requiredTools: ToolType[];
  supportedModels: AIModelType[];
  maxSteps: number;
  timeout: number;
}
```

### 3.3 Agent 输入/输出类型

```typescript
// 输入
interface AgentInput {
  prompt: string; // 用户指令
  files?: FileReference[]; // 上传文件
  urls?: string[]; // 参考 URL
  resourceIds?: string[]; // 关联资源 ID
  options?: Record<string, unknown>; // 额外选项
}

// 执行计划
interface AgentPlan {
  id: string;
  agentType: AgentType;
  objective: string;
  steps: PlanStep[];
  estimatedDuration: number;
  requiredTools: ToolType[];
  requiredModels: AIModelType[];
}

// 流式事件
type AgentEvent =
  | { type: "plan_ready"; plan: AgentPlan }
  | { type: "step_start"; stepId: string; description: string }
  | { type: "step_progress"; stepId: string; progress: number }
  | { type: "tool_call"; toolType: ToolType; input: unknown }
  | { type: "tool_result"; toolType: ToolType; result: unknown }
  | { type: "artifact"; artifact: Artifact }
  | { type: "step_complete"; stepId: string; output: unknown }
  | { type: "complete"; result: AgentResult }
  | { type: "error"; error: AgentError };
```

### 3.4 已实现的 Agent

#### SlidesAgent（PPT 生成专家）

```typescript
class SlidesAgent extends BaseAgent {
  type = AgentType.SLIDES;

  capabilities = [
    "自动生成演示文稿大纲",
    "智能配图和图表",
    "多种主题风格切换",
    "内容优化和排版",
  ];

  requiredTools = [
    ToolType.WEB_SEARCH,
    ToolType.TEXT_GENERATION,
    ToolType.IMAGE_GENERATION,
    ToolType.EXPORT_PPTX,
  ];

  templates = [
    "business-pitch", // 商业提案
    "product-launch", // 产品发布
    "quarterly-report", // 季度汇报
    "team-intro", // 团队介绍
  ];
}
```

#### DocsAgent（文档撰写专家）

```typescript
class DocsAgent extends BaseAgent {
  type = AgentType.DOCS;

  capabilities = [
    "自动调研资料",
    "智能生成大纲",
    "分阶段撰写内容",
    "导出多种格式",
  ];

  requiredTools = [
    ToolType.WEB_SEARCH,
    ToolType.RAG_SEARCH,
    ToolType.TEXT_GENERATION,
    ToolType.EXPORT_DOCX,
    ToolType.EXPORT_PDF,
  ];

  templates = [
    "technical-doc", // 技术文档
    "business-plan", // 商业计划
    "research-report", // 研究报告
    "work-report", // 工作报告
  ];
}
```

#### DesignerAgent（设计生成专家）

```typescript
class DesignerAgent extends BaseAgent {
  type = AgentType.DESIGNER;

  capabilities = ["海报设计", "Logo 设计", "Banner 生成", "多风格变体"];

  requiredTools = [ToolType.IMAGE_GENERATION, ToolType.EXPORT_IMAGE];
}
```

#### DeveloperAgent（代码开发专家）

```typescript
class DeveloperAgent extends BaseAgent {
  type = AgentType.DEVELOPER;

  capabilities = ["代码生成", "代码解释", "代码重构", "单元测试生成"];

  requiredTools = [
    ToolType.CODE_GENERATION,
    ToolType.PYTHON_EXECUTOR,
    ToolType.JAVASCRIPT_EXECUTOR,
  ];

  supportedLanguages = ["python", "javascript", "typescript", "java", "go"];
}
```

### 3.5 Agent 注册中心

```typescript
class AgentRegistry {
  // 注册 Agent
  register(agent: IAgent): void;

  // 获取 Agent
  get(type: AgentType): IAgent | undefined;
  getAll(): IAgent[];

  // 获取配置（包括未注册的）
  getAllConfigs(): AgentConfig[];

  // 统计信息
  getStats(): {
    total: number;
    registered: number;
    types: AgentType[];
  };
}
```

---

## 4. 工具系统

### 4.1 工具分类总览

| 类别              | 工具数量 | 主要用途               |
| ----------------- | -------- | ---------------------- |
| **Information**   | 6        | 信息获取（搜索、抓取） |
| **Generation**    | 6        | 内容生成（文本、图像） |
| **Processing**    | 7        | 数据处理（分析、转换） |
| **Execution**     | 6        | 代码执行（沙箱、容器） |
| **Integration**   | 6        | 外部集成（邮件、存储） |
| **Memory**        | 5        | 记忆管理（短期、长期） |
| **Export**        | 4        | 产出物导出             |
| **Collaboration** | 8        | Agent 协作             |

### 4.2 完整工具清单

#### Information（信息获取）

| 工具类型          | 描述         | 输入参数                   | 输出类型       |
| ----------------- | ------------ | -------------------------- | -------------- |
| `WEB_SEARCH`      | 网络搜索     | query, maxResults, filters | SearchResult[] |
| `WEB_SCRAPER`     | 网页抓取     | url, selector, format      | ScrapedContent |
| `DATA_FETCH`      | 数据源获取   | source, query, params      | DataSet        |
| `RAG_SEARCH`      | 语义向量搜索 | query, topK, filters       | RAGResult[]    |
| `DATABASE_QUERY`  | 数据库查询   | query, params, timeout     | QueryResult    |
| `KNOWLEDGE_GRAPH` | 知识图谱查询 | query, depth, nodeTypes    | GraphResult    |

#### Generation（内容生成）

| 工具类型            | 描述         | 输入参数                    | 输出类型       |
| ------------------- | ------------ | --------------------------- | -------------- |
| `TEXT_GENERATION`   | 文本内容生成 | prompt, maxTokens, style    | GeneratedText  |
| `IMAGE_GENERATION`  | 图像生成     | prompt, size, style, model  | GeneratedImage |
| `CODE_GENERATION`   | 代码生成     | prompt, language, framework | GeneratedCode  |
| `AUDIO_GENERATION`  | 文本转语音   | text, voice, speed          | AudioFile      |
| `VIDEO_GENERATION`  | 视频生成     | script, style, duration     | VideoFile      |
| `STRUCTURED_OUTPUT` | 结构化输出   | prompt, schema              | JSONObject     |

#### Processing（数据处理）

| 工具类型          | 描述         | 输入参数                   | 输出类型         |
| ----------------- | ------------ | -------------------------- | ---------------- |
| `DATA_ANALYSIS`   | 数据分析     | data, analysisType, params | AnalysisResult   |
| `FILE_CONVERSION` | 文件格式转换 | file, targetFormat         | ConvertedFile    |
| `FILE_PARSER`     | 文件解析     | file, extractFields        | ParsedContent    |
| `DATA_VALIDATION` | 数据校验     | data, schema, rules        | ValidationResult |
| `DATA_CLEANING`   | 数据清洗     | data, cleaningRules        | CleanedData      |
| `DOCUMENT_DIFF`   | 文档对比     | doc1, doc2, diffType       | DiffResult       |
| `TEMPLATE_RENDER` | 模板渲染     | template, data             | RenderedContent  |

#### Execution（代码执行）

| 工具类型              | 描述            | 输入参数                | 输出类型        |
| --------------------- | --------------- | ----------------------- | --------------- |
| `PYTHON_EXECUTOR`     | Python 沙箱执行 | code, packages, timeout | ExecutionResult |
| `JAVASCRIPT_EXECUTOR` | JS 沙箱执行     | code, modules, timeout  | ExecutionResult |
| `SQL_EXECUTOR`        | SQL 查询执行    | query, database, params | QueryResult     |
| `SHELL_EXECUTOR`      | Shell 命令执行  | command, workdir, env   | ShellResult     |
| `CONTAINER_EXECUTOR`  | Docker 容器执行 | image, command, volumes | ContainerResult |
| `OCR_RECOGNITION`     | 图片文字识别    | image, language, format | OCRResult       |

#### Integration（外部集成）

| 工具类型               | 描述         | 输入参数                  | 输出类型       |
| ---------------------- | ------------ | ------------------------- | -------------- |
| `MESSAGE_PUSH`         | 消息推送     | channel, recipients, msg  | PushResult     |
| `CLOUD_STORAGE`        | 云存储上传   | file, bucket, path        | StorageResult  |
| `GITHUB_INTEGRATION`   | GitHub 交互  | action, repo, params      | GitHubResult   |
| `EMAIL_SENDER`         | 邮件发送     | to, subject, body, attach | EmailResult    |
| `CALENDAR_INTEGRATION` | 日历管理     | action, event, params     | CalendarResult |
| `WEBHOOK_TRIGGER`      | Webhook 触发 | url, method, payload      | WebhookResult  |

#### Memory（记忆管理）

| 工具类型            | 描述         | 输入参数                   | 输出类型         |
| ------------------- | ------------ | -------------------------- | ---------------- |
| `SHORT_TERM_MEMORY` | 会话级记忆   | action, key, value, ttl    | MemoryResult     |
| `LONG_TERM_MEMORY`  | 持久化记忆   | action, key, value, meta   | MemoryResult     |
| `ENTITY_MEMORY`     | 实体信息记忆 | entityType, entityId, data | EntityResult     |
| `KNOWLEDGE_BASE`    | 知识库查询   | query, filters, topK       | KBResult         |
| `USER_PREFERENCES`  | 用户偏好存储 | userId, preferences        | PreferenceResult |

#### Export（产出物导出）

| 工具类型       | 描述      | 输入参数                   | 输出类型  |
| -------------- | --------- | -------------------------- | --------- |
| `EXPORT_PPTX`  | PPT 导出  | slides, template, options  | PPTXFile  |
| `EXPORT_DOCX`  | Word 导出 | content, template, options | DOCXFile  |
| `EXPORT_PDF`   | PDF 导出  | content, options           | PDFFile   |
| `EXPORT_IMAGE` | 图片导出  | content, format, quality   | ImageFile |

#### Collaboration（Agent 协作）

| 工具类型                 | 描述       | 输入参数                   | 输出类型         |
| ------------------------ | ---------- | -------------------------- | ---------------- |
| `AGENT_HANDOFF`          | Agent 委派 | targetAgent, task, context | HandoffResult    |
| `HUMAN_APPROVAL`         | 人工审批   | request, timeout           | ApprovalResult   |
| `AGENT_COMMUNICATION`    | Agent 通信 | targetAgent, message       | CommResult       |
| `TASK_DELEGATION`        | 任务委派   | subtasks, assignees        | DelegationResult |
| `CONSENSUS_MECHANISM`    | 投票共识   | proposal, voters, rules    | ConsensusResult  |
| `WORKFLOW_ORCHESTRATION` | 工作流编排 | workflow, inputs           | WorkflowResult   |
| `PROGRESS_REPORT`        | 进度报告   | taskId, progress, status   | ReportResult     |
| `ERROR_ESCALATION`       | 错误升级   | error, severity, context   | EscalationResult |

### 4.3 工具基类

```typescript
abstract class BaseTool<TInput, TOutput> implements ITool {
  abstract readonly type: ToolType;
  abstract readonly category: ToolCategory;
  abstract readonly config: ToolConfig;

  // 自动输入验证
  protected abstract getInputSchema(): JSONSchema;

  // 超时管理（默认 30s）
  protected getTimeout(): number;

  // 核心执行方法
  async execute(
    input: TInput,
    context: ToolContext,
  ): Promise<ToolResult<TOutput>> {
    // 1. 验证输入
    this.validateInput(input);

    // 2. 设置超时和取消处理
    const result = await this.withTimeout(
      this.doExecute(input, context),
      this.getTimeout(),
      context.abortSignal,
    );

    // 3. 返回标准化结果
    return {
      success: true,
      data: result,
      duration: elapsed,
      tokensUsed: this.countTokens(result),
    };
  }

  // 子类实现具体逻辑
  protected abstract doExecute(
    input: TInput,
    context: ToolContext,
  ): Promise<TOutput>;

  // 转换为 OpenAI Function Calling 格式
  toFunctionDefinition(): FunctionDefinition {
    return {
      name: this.type,
      description: this.config.description,
      parameters: this.getInputSchema(),
    };
  }
}
```

### 4.4 工具注册中心

```typescript
class ToolRegistry {
  // 注册工具
  register(tool: ITool): void;
  registerMany(tools: ITool[]): void;

  // 获取工具
  get(type: ToolType): ITool | undefined;
  getAll(): ITool[];
  getByCategory(category: ToolCategory): ITool[];

  // 获取配置
  getAllConfigs(): ToolConfig[];

  // 统计信息
  getStats(): {
    total: number;
    registered: number;
    byCategory: Record<ToolCategory, number>;
  };
}
```

---

## 5. 执行引擎

### 5.1 双执行模式

#### Plan 模式（规划执行）

适用于：复杂多步骤任务、需要预先规划的场景

```typescript
// 执行流程
async *execute(input: AgentInput, agentType?: AgentType) {
  // 1. 选择或使用指定 Agent
  const agent = agentType
    ? this.agentRegistry.get(agentType)
    : this.selectAgent(input);

  // 2. 生成执行计划
  const plan = await agent.plan(input);
  yield { type: 'plan_ready', plan };

  // 3. 按步骤执行
  for await (const event of agent.execute(plan)) {
    yield event;
  }
}
```

#### Autonomous 模式（自主执行）

适用于：不确定的工具组合、LLM 自主决策场景

```typescript
// 执行流程
async *executeAutonomous(llmAdapter: ILLMAdapter, input: AgentInput) {
  const executor = new FunctionCallingExecutor(
    llmAdapter,
    this.toolRegistry,
    { maxIterations: 10 }
  );

  // LLM 自主选择和调用工具
  for await (const event of executor.run(input)) {
    yield event;
  }
}
```

### 5.2 Function Calling 执行器

```typescript
class FunctionCallingExecutor {
  constructor(
    private llmAdapter: ILLMAdapter,
    private toolRegistry: ToolRegistry,
    private options: ExecutorOptions,
  ) {}

  async *run(input: AgentInput): AsyncGenerator<AgentEvent> {
    let iteration = 0;
    let messages = this.buildInitialMessages(input);

    while (iteration < this.options.maxIterations) {
      // 1. 调用 LLM 获取下一步动作
      const response = await this.llmAdapter.callWithFunctions(
        messages,
        this.getFunctionDefinitions(),
      );

      // 2. 如果没有工具调用，返回最终结果
      if (!response.functionCall) {
        yield { type: "complete", result: response.content };
        return;
      }

      // 3. 执行工具调用
      const tool = this.toolRegistry.get(response.functionCall.name);
      const result = await tool.execute(
        response.functionCall.arguments,
        this.buildContext(),
      );

      yield {
        type: "tool_result",
        toolType: tool.type,
        result: result.data,
      };

      // 4. 将结果加入对话历史
      messages.push({
        role: "function",
        name: response.functionCall.name,
        content: JSON.stringify(result.data),
      });

      iteration++;
    }
  }
}
```

### 5.3 执行指标收集

```typescript
class ExecutionMetricsCollector {
  // 收集的指标
  interface ExecutionMetrics {
    taskId: string;
    agentType: AgentType;
    startTime: Date;
    endTime: Date;
    duration: number;           // 毫秒
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: ToolCallMetric[];
    retries: number;
    errors: ErrorMetric[];
    status: 'success' | 'failed' | 'cancelled';
  }

  interface ToolCallMetric {
    toolType: ToolType;
    duration: number;
    tokensUsed: number;
    success: boolean;
    retries: number;
  }
}
```

### 5.4 重试策略

```typescript
class RetryStrategy {
  // 指数退避重试
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions,
  ): Promise<T> {
    let lastError: Error;
    let attempt = 0;

    while (attempt < options.maxRetries) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (!this.isRetryable(error)) {
          throw error;
        }

        const delay = this.calculateDelay(attempt, options);
        await this.sleep(delay);
        attempt++;
      }
    }

    throw lastError;
  }

  private calculateDelay(attempt: number, options: RetryOptions): number {
    // 指数退避: baseDelay * 2^attempt + jitter
    const exponentialDelay = options.baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * options.jitterMax;
    return Math.min(exponentialDelay + jitter, options.maxDelay);
  }
}
```

---

## 6. 记忆系统

### 6.1 记忆接口

```typescript
// 基础记忆存储
interface IMemoryStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  clear(): Promise<void>;
}

// 长期记忆（扩展语义搜索）
interface ILongTermMemoryStore extends IMemoryStore {
  // 语义搜索
  search(query: string, options?: SearchOptions): Promise<MemorySearchResult[]>;

  // 列表查询
  list(options?: ListOptions): Promise<MemoryItem[]>;

  // 元数据更新
  updateMetadata(key: string, metadata: Record<string, unknown>): Promise<void>;
}

interface MemorySearchResult {
  key: string;
  value: unknown;
  score: number; // 相似度分数
  metadata: Record<string, unknown>;
}
```

### 6.2 短期记忆实现

```typescript
class ShortTermMemory implements IMemoryStore {
  // 基于 Redis 或内存的会话级存储
  // 默认 TTL: 30 分钟
  // 自动过期清理

  private readonly defaultTTL = 30 * 60 * 1000; // 30 分钟

  async set(key: string, value: unknown, ttl = this.defaultTTL): Promise<void>;
  async get(key: string): Promise<unknown>;
}
```

### 6.3 长期记忆实现

```typescript
class LongTermMemory implements ILongTermMemoryStore {
  // 基于 PostgreSQL + 向量数据库
  // 支持语义搜索
  // 无过期（持久化）

  async search(
    query: string,
    options?: SearchOptions,
  ): Promise<MemorySearchResult[]> {
    // 1. 生成 query 的向量嵌入
    const embedding = await this.embedder.embed(query);

    // 2. 向量相似度搜索
    const results = await this.vectorStore.search(
      embedding,
      options?.topK ?? 10,
    );

    // 3. 应用过滤条件
    return this.applyFilters(results, options?.filters);
  }
}
```

---

## 7. 安全护栏

### 7.1 护栏类型

| 护栏类型     | 功能描述                | 配置项               |
| ------------ | ----------------------- | -------------------- |
| **内容过滤** | 过滤敏感/违规内容       | 黑名单词、恶意分类器 |
| **PII 检测** | 检测和脱敏个人隐私信息  | 检测类型、脱敏策略   |
| **速率限制** | 限制 API 调用频率       | 每分钟/小时/天限制   |
| **成本控制** | 控制 Token 使用成本     | 预算上限、告警阈值   |
| **输出验证** | 验证输出符合预期 Schema | JSONSchema、格式规则 |

### 7.2 护栏服务

```typescript
class GuardrailService {
  // 输入过滤
  async filterInput(
    input: string,
    config: InputFilterConfig,
  ): Promise<FilterResult> {
    const results = await Promise.all([
      this.contentFilter.check(input),
      this.piiDetector.detect(input),
    ]);

    return {
      passed: results.every((r) => r.passed),
      violations: results.flatMap((r) => r.violations),
      sanitizedInput: this.sanitize(input, results),
    };
  }

  // 输出验证
  async validateOutput(
    output: unknown,
    config: OutputValidationConfig,
  ): Promise<ValidationResult> {
    return this.schemaValidator.validate(output, config.schema);
  }

  // 速率限制检查
  async checkRateLimit(
    userId: string,
    toolType: ToolType,
  ): Promise<RateLimitResult> {
    const limits = this.getLimits(toolType);
    const usage = await this.getUsage(userId, toolType);

    return {
      allowed: usage < limits.max,
      remaining: limits.max - usage,
      resetAt: this.getResetTime(limits),
    };
  }

  // 成本控制检查
  async checkCostLimit(
    tokensUsed: number,
    config: CostConfig,
  ): Promise<CostCheckResult> {
    const currentCost = await this.getCurrentCost();
    const projectedCost = currentCost + this.calculateCost(tokensUsed);

    return {
      allowed: projectedCost <= config.budget,
      currentCost,
      projectedCost,
      budget: config.budget,
      warningThreshold: config.warningThreshold,
    };
  }

  // PII 检测
  async detectSensitiveInfo(text: string): Promise<PIIDetectionResult> {
    return this.piiDetector.detect(text);
  }
}
```

---

## 8. MCP 协议支持

### 8.1 MCP 概述

Model Context Protocol (MCP) 是一个标准化的协议，用于 AI 模型与外部资源和工具的交互。

### 8.2 MCP 适配器

```typescript
class MCPAdapter {
  // 资源管理
  async listResources(): Promise<MCPResource[]>;
  async readResource(uri: string): Promise<ResourceContent>;

  // 工具管理
  async listTools(): Promise<MCPTool[]>;
  async callTool(name: string, input: unknown): Promise<MCPToolResult>;

  // 进度报告
  async reportProgress(taskId: string, progress: Progress): void;

  // 取消支持
  async cancel(taskId: string): Promise<void>;
}
```

### 8.3 传输协议

```typescript
// Stdio 传输（本地进程通信）
class StdioTransport implements MCPTransport {
  async connect(command: string, args: string[]): Promise<void>;
  async send(message: MCPMessage): Promise<void>;
  async receive(): Promise<MCPMessage>;
}

// HTTP-SSE 传输（远程服务通信）
class HttpSseTransport implements MCPTransport {
  async connect(url: string): Promise<void>;
  async send(message: MCPMessage): Promise<void>;
  // SSE 流式接收
  subscribe(callback: (message: MCPMessage) => void): void;
}
```

### 8.4 资源管理器

```typescript
class ResourceManager {
  // 文件资源提供者
  private fileProvider: FileResourceProvider;

  async getResource(uri: string): Promise<Resource> {
    const provider = this.resolveProvider(uri);
    return provider.read(uri);
  }

  async listResources(pattern?: string): Promise<Resource[]> {
    return this.fileProvider.list(pattern);
  }
}
```

---

## 9. API 端点

### 9.1 REST API

| 方法 | 端点                              | 功能                |
| ---- | --------------------------------- | ------------------- |
| GET  | `/agents`                         | 获取所有 Agent 配置 |
| GET  | `/agents/status`                  | 获取 Agent 状态报告 |
| GET  | `/agents/:type/templates`         | 获取 Agent 模板     |
| POST | `/agents/execute`                 | 执行 Agent 任务     |
| GET  | `/agents/tasks/:taskId`           | 获取任务状态        |
| SSE  | `/agents/tasks/:taskId/stream`    | 任务进度流          |
| POST | `/agents/tasks/:taskId/cancel`    | 取消任务            |
| GET  | `/agents/tasks/:taskId/artifacts` | 获取产出物列表      |
| GET  | `/agents/artifacts/:id/download`  | 下载产出物          |

### 9.2 请求/响应示例

#### 执行任务

```typescript
// POST /agents/execute
// Request
{
  "agentType": "slides",
  "input": {
    "prompt": "帮我做一个关于 2024 年 AI 发展趋势的 PPT",
    "options": {
      "template": "business-pitch",
      "pageCount": 10
    }
  }
}

// Response
{
  "taskId": "task_abc123",
  "status": "pending",
  "agentType": "slides",
  "createdAt": "2025-12-19T10:00:00Z"
}
```

#### SSE 事件流

```typescript
// GET /agents/tasks/:taskId/stream
// Response (SSE)

event: plan_ready
data: {"plan":{"id":"plan_1","steps":[...]}}

event: step_start
data: {"stepId":"step_1","description":"搜索 AI 发展趋势资料"}

event: tool_call
data: {"toolType":"WEB_SEARCH","input":{"query":"2024 AI trends"}}

event: tool_result
data: {"toolType":"WEB_SEARCH","result":[...]}

event: step_complete
data: {"stepId":"step_1","output":{...}}

event: artifact
data: {"type":"PPTX","name":"ai-trends-2024.pptx","url":"..."}

event: complete
data: {"result":{...}}
```

---

## 10. 可复用服务清单

### 10.1 核心服务

| 服务                        | 导出路径                    | 用途               |
| --------------------------- | --------------------------- | ------------------ |
| `AgentOrchestrator`         | `ai-agents/core/execution`  | Agent 编排和路由   |
| `AgentRegistry`             | `ai-agents/core/agent`      | Agent 生命周期管理 |
| `ToolRegistry`              | `ai-agents/core/tool`       | 工具注册和查询     |
| `FunctionCallingExecutor`   | `ai-agents/core/execution`  | LLM 工具调用执行   |
| `LLMAdapterFactory`         | `ai-agents/core/llm`        | 多模型 LLM 适配    |
| `SchemaValidator`           | `ai-agents/core/validation` | JSONSchema 验证    |
| `GuardrailService`          | `ai-agents/core/guardrails` | 安全护栏           |
| `RetryStrategy`             | `ai-agents/core/execution`  | 重试策略           |
| `ExecutionMetricsCollector` | `ai-agents/core/execution`  | 执行指标收集       |

### 10.2 记忆服务

| 服务              | 导出路径                | 用途       |
| ----------------- | ----------------------- | ---------- |
| `ShortTermMemory` | `ai-agents/core/memory` | 会话级记忆 |
| `LongTermMemory`  | `ai-agents/core/memory` | 持久化记忆 |

### 10.3 MCP 服务

| 服务              | 导出路径             | 用途         |
| ----------------- | -------------------- | ------------ |
| `MCPAdapter`      | `ai-agents/core/mcp` | MCP 协议适配 |
| `MCPServer`       | `ai-agents/core/mcp` | MCP 服务器   |
| `ResourceManager` | `ai-agents/core/mcp` | 资源管理     |

### 10.4 错误处理

| 类           | 导出路径                | 用途           |
| ------------ | ----------------------- | -------------- |
| `ToolError`  | `ai-agents/core/errors` | 工具执行错误   |
| `AgentError` | `ai-agents/core/errors` | Agent 执行错误 |
| `ErrorCodes` | `ai-agents/core/errors` | 错误码枚举     |

---

## 附录 A: 类型定义速查

```typescript
// Agent 类型
enum AgentType {
  SLIDES,
  DOCS,
  DESIGNER,
  DEVELOPER,
}

// 工具类型（48 种）
enum ToolType {
  // Information
  WEB_SEARCH,
  WEB_SCRAPER,
  DATA_FETCH,
  RAG_SEARCH,
  DATABASE_QUERY,
  KNOWLEDGE_GRAPH,
  // Generation
  TEXT_GENERATION,
  IMAGE_GENERATION,
  CODE_GENERATION,
  AUDIO_GENERATION,
  VIDEO_GENERATION,
  STRUCTURED_OUTPUT,
  // Processing
  DATA_ANALYSIS,
  FILE_CONVERSION,
  FILE_PARSER,
  DATA_VALIDATION,
  DATA_CLEANING,
  DOCUMENT_DIFF,
  TEMPLATE_RENDER,
  // Execution
  PYTHON_EXECUTOR,
  JAVASCRIPT_EXECUTOR,
  SQL_EXECUTOR,
  SHELL_EXECUTOR,
  CONTAINER_EXECUTOR,
  OCR_RECOGNITION,
  // Integration
  MESSAGE_PUSH,
  CLOUD_STORAGE,
  GITHUB_INTEGRATION,
  EMAIL_SENDER,
  CALENDAR_INTEGRATION,
  WEBHOOK_TRIGGER,
  // Memory
  SHORT_TERM_MEMORY,
  LONG_TERM_MEMORY,
  ENTITY_MEMORY,
  KNOWLEDGE_BASE,
  USER_PREFERENCES,
  // Export
  EXPORT_PPTX,
  EXPORT_DOCX,
  EXPORT_PDF,
  EXPORT_IMAGE,
  // Collaboration
  AGENT_HANDOFF,
  HUMAN_APPROVAL,
  AGENT_COMMUNICATION,
  TASK_DELEGATION,
  CONSENSUS_MECHANISM,
  WORKFLOW_ORCHESTRATION,
  PROGRESS_REPORT,
  ERROR_ESCALATION,
}

// 任务状态
enum AgentTaskStatus {
  PENDING,
  PLANNING,
  EXECUTING,
  COMPLETED,
  FAILED,
  CANCELLED,
}

// 产出物类型
enum ArtifactType {
  PPTX,
  DOCX,
  PDF,
  IMAGE,
  CODE,
  DATA,
}
```

---

## 附录 B: 依赖模块

```typescript
// ai-agents 导入的依赖模块
import { AiOfficeModule } from "../ai-office"; // PPT/Word/PDF 生成
import { AiImageModule } from "../ai-image"; // 图像生成和处理
import { AiCoreModule } from "../ai-core"; // 基础 AI 能力
import { AiStudioModule } from "../ai-studio"; // 内容编辑工具
```

---

## 版本历史

| 版本 | 日期       | 作者              | 变更说明     |
| ---- | ---------- | ----------------- | ------------ |
| v1.0 | 2025-12-19 | Architecture Team | 初始版本发布 |


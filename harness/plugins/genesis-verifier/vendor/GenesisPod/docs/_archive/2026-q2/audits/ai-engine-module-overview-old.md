# AI Engine 模块总览

> **版本**: 1.0
> **最后更新**: 2026-01-15
> **代码位置**: `backend/src/modules/ai-engine/`

---

## 模块架构图

```
AI Engine (290+ 文件)
│
├── facade/                  # 统一入口层
│   ├── ai-engine.facade.ts  (1315 行) - 所有 AI Apps 的调用入口
│   └── types/               - Facade 接口类型定义
│
├── llm/                     # LLM 能力层
│   ├── services/
│   │   ├── ai-chat.service.ts         - 核心 LLM 调用服务
│   │   └── task-profile.types-mapper.service.ts - TaskProfile 映射
│   ├── adapters/
│   │   ├── universal-llm.adapter.ts   - 通用 LLM 适配器
│   │   └── function-calling-llm.adapter.ts - 函数调用适配器
│   ├── model-fallback/
│   │   └── model-fallback.service.ts  (574 行) - 模型降级容错
│   ├── types/
│   │   └── task-profile.types.ts            - TaskProfile 接口定义
│   └── factory/              - LLM 工厂
│
├── search/                  # 搜索能力层
│   └── search.service.ts    - 统一搜索服务 (Tavily, Serper, DDG)
│
├── tools/                   # 工具系统 (55+ 工具)
│   ├── abstractions/        - ITool 接口
│   ├── base/                - BaseTool 基类
│   ├── registry/            - ToolRegistry 工具注册表
│   ├── middleware/          - 工具中间件
│   └── categories/          - 8 个工具分类
│       ├── information/     - 信息获取工具 (7)
│       ├── generation/      - 内容生成工具 (7)
│       ├── processing/      - 数据处理工具 (8)
│       ├── execution/       - 代码执行工具 (6)
│       ├── collaboration/   - 协作工具 (6)
│       ├── integration/     - 第三方集成 (7)
│       ├── export/          - 导出工具 (5)
│       └── memory/          - 记忆工具 (5)
│
├── agents/                  # Agent 框架
│   ├── abstractions/        - IAgent 接口
│   ├── base/
│   │   ├── reactive-agent.ts       - ReAct Agent 基类
│   │   ├── plan-based-agent.ts     - Plan-Based Agent 基类
│   │   └── plan-agent.ts           - 规划 Agent
│   ├── registry/
│   │   └── agent-orchestrator.ts   - Agent 编排器
│   └── implementations/     - 5 个内置 Agent
│       ├── developer/       - 开发者 Agent
│       ├── researcher/      - 研究员 Agent
│       ├── simulator/       - 模拟器 Agent
│       ├── image-designer/  - 图像设计 Agent
│       └── team-collaboration/ - 团队协作 Agent
│
├── orchestration/           # 编排引擎
│   ├── executors/           - 4 个任务执行器
│   │   ├── sequential-executor.ts      - 顺序执行
│   │   ├── parallel-executor.ts        - 并行执行
│   │   ├── dag-executor.ts             - DAG 依赖图执行
│   │   └── function-calling-executor.ts - 函数调用编排
│   ├── services/            - 11 个编排服务
│   │   ├── task-decomposer.service.ts
│   │   ├── agent-executor.service.ts
│   │   ├── output-reviewer.service.ts
│   │   ├── iteration-manager.service.ts
│   │   ├── context-evolution.service.ts
│   │   ├── context-initialization.service.ts
│   │   ├── context-compression.service.ts
│   │   ├── constraint-enforcement.service.ts
│   │   ├── intent-detection.service.ts
│   │   ├── circuit-breaker.service.ts
│   │   ├── token-budget.service.ts
│   │   └── reflection.service.ts (406 行) - 自我反思
│   ├── state-machine/
│   │   └── execution-state.manager.ts (436 行) - 状态机管理
│   ├── checkpoints/         - 断点续传
│   └── utils/               - 工具函数
│
├── teams/                   # 团队系统
│   ├── abstractions/        - ITeam, IRole, IMember 接口
│   ├── base/
│   │   ├── team.ts          - Team 基类
│   │   ├── role.ts          - Role 基类
│   │   ├── member.ts        - Member 基类
│   │   └── workflow.ts      - Workflow 基类
│   ├── templates/           - 预定义团队模板
│   │   ├── research-team.ts - 深度研究团队
│   │   ├── debate-team.ts   - 辩论对抗团队
│   │   └── report-team.ts   - 报告生成团队
│   ├── services/
│   │   └── teams.service.ts - TeamsService 主服务
│   ├── orchestrator/        - MissionOrchestrator 任务编排
│   ├── constraints/         - ConstraintEngine 约束引擎
│   ├── registry/            - TeamRegistry, RoleRegistry
│   └── controllers/         - Teams API 控制器
│
├── memory/                  # 记忆系统
│   ├── abstractions/        - IMemory 接口
│   └── stores/
│       ├── in-memory-store.ts          - 内存存储
│       ├── short-term-memory.service.ts - 短期记忆
│       └── long-term-memory.service.ts  - 长期记忆
│
├── constraint/              # 约束引擎
│   ├── validators/
│   │   └── schema-validator.ts  - JSON Schema 验证
│   └── guardrails/
│       ├── content-filter.ts    - 内容过滤
│       └── cost-controller.ts   - 成本控制
│
├── rag/                     # RAG 系统
│   ├── embedding/
│   │   └── embedding.service.ts - 向量嵌入服务
│   ├── vector/
│   │   └── vector.service.ts    - 向量存储与检索
│   └── chunking/
│       └── document-chunker.ts  - 文档分块
│
├── image/                   # 图像生成
│   ├── abstractions/        - IImageAdapter 接口
│   ├── adapters/            - 多 Provider 适配器
│   └── factory/             - ImageFactory
│
├── long-content/            # 长内容处理
│   ├── services/            - LongContentEngine
│   ├── interfaces/          - 接口定义
│   └── constants/           - 常量配置
│
├── mcp/                     # MCP 协议
│   ├── abstractions/        - MCP 接口
│   ├── client/              - MCP 客户端
│   ├── manager/             - MCP 管理器
│   └── tools/               - MCP 工具适配器
│
├── skills/                  # 技能系统
│   ├── abstractions/        - ISkill 接口
│   ├── base/                - BaseSkill 基类
│   ├── registry/            - SkillRegistry
│   └── output-manager/      - 输出管理
│
├── collaboration/           # 协作框架
│   ├── abstractions/        - 协作接口
│   └── patterns/
│       └── voting-pattern.ts - 投票共识模式
│
└── core/                    # 核心抽象
    ├── types/               - 公共类型
    ├── errors/              - 错误类型
    ├── exceptions/          - 异常类
    └── interfaces/          - 核心接口
```

---

## 模块详细说明

### 1. Facade (统一入口)

**代码位置**: `facade/ai-engine.facade.ts` (1315 行)

**职责**:

- 所有 AI Apps 的唯一调用入口
- 聚合 LLM、Search、Agent、Team、Memory 等能力
- 内置熔断器保护
- 统一错误处理

**核心方法**:

```typescript
// LLM 能力
async chat(request: ChatRequest): Promise<ChatResponse>
async *chatStream(request: ChatRequest): AsyncGenerator<...>
async selectModel(options: ModelSelectionOptions): Promise<ModelInfo>

// 搜索能力
async search(request: SearchRequest): Promise<SearchResponse>
formatSearchResultsForContext(results: SearchResultItem[]): string

// 团队能力
async startTeamMission(request: StartMissionRequest): Promise<MissionResult>
cancelMission(missionId: string): boolean
getMissionStatus(missionId: string): MissionStatus

// 上下文能力
async buildContext(request: BuildContextRequest): Promise<string>

// 记忆能力
async storeMemory(request: StoreMemoryRequest): Promise<void>
async retrieveMemory(request: RetrieveMemoryRequest): Promise<MemoryItem[]>

// Agent 能力
async executeAgent(request: AgentExecutionRequest): Promise<AgentExecutionResult>
isAgentAvailable(agentId: string): boolean

// 工具能力
async executeTool<T>(request: ToolExecutionRequest): Promise<ToolExecutionResult<T>>
getAvailableTools(category?: ToolCategory): ToolInfo[]
```

**使用示例**:

```typescript
@Injectable()
export class MyService {
  constructor(private readonly aiFacade: AIEngineFacade) {}

  async analyze(input: string) {
    return await this.aiFacade.chat({
      messages: [{ role: "user", content: input }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "low", outputLength: "medium" },
    });
  }
}
```

---

### 2. LLM (语言模型层)

**代码位置**: `llm/`

**核心服务**:

| 服务                        | 职责                 | 代码量 |
| --------------------------- | -------------------- | ------ |
| `AiChatService`             | 统一 LLM 调用入口    | ~500   |
| `TaskProfileMapperService`  | TaskProfile 参数映射 | ~100   |
| `ModelFallbackService`      | 模型降级容错         | 574    |
| `UniversalLLMAdapter`       | 通用模型适配器       | ~200   |
| `FunctionCallingLLMAdapter` | 函数调用适配器       | ~150   |

**TaskProfile 映射规则**:

```typescript
// TaskProfile 接口
interface TaskProfile {
  creativity?: 'deterministic' | 'low' | 'medium' | 'high';
  outputLength?: 'minimal' | 'short' | 'medium' | 'standard' | 'long' | 'extended';
  taskType?: 'extraction' | 'analysis' | 'conversation' | 'writing' | 'reflection';
  outputFormat?: 'json' | 'markdown' | 'plaintext';
}

// 映射示例
creativity: 'low' → temperature: 0.3
outputLength: 'medium' → maxTokens: 4000
```

**模型降级策略** (ModelFallbackService):

```typescript
Primary Model → Fallback Model → Default Model
    ↓ 失败           ↓ 失败         ↓ 失败
  自动降级        自动降级      返回错误
```

**数据库驱动配置**:

- 所有模型配置存储在 `AIModel` 表
- 支持动态启用/禁用模型
- 支持模型能力配置 (isReasoning, supportsTemperature, etc.)

---

### 3. Search (搜索层)

**代码位置**: `search/search.service.ts`

**支持的 Provider**:

| Provider   | 特点         | API Key | 质量 |
| ---------- | ------------ | ------- | ---- |
| Tavily     | 最完整信息   | 需要    | 最高 |
| Serper     | Google 搜索  | 需要    | 高   |
| DuckDuckGo | 无需 API Key | 不需要  | 中   |

**使用示例**:

```typescript
const results = await this.aiFacade.search({
  query: "量子计算最新进展",
  maxResults: 5,
  provider: "tavily", // 可选
});

// 格式化为上下文
const context = this.aiFacade.formatSearchResultsForContext(results.results);
```

---

### 4. Tools (工具系统)

**代码位置**: `tools/categories/`

**8 个工具分类**:

| 分类              | 工具数 | 示例工具                                     |
| ----------------- | ------ | -------------------------------------------- |
| **information**   | 7      | web-search, rag-search, data-fetch           |
| **generation**    | 7      | text-generation, code-generation, image-gen  |
| **processing**    | 8      | data-analysis, data-cleaning, data-transform |
| **execution**     | 6      | python-executor, js-executor, sql-executor   |
| **collaboration** | 6      | agent-communication, task-delegation         |
| **integration**   | 7      | github-api, email, calendar, cloud-storage   |
| **export**        | 5      | pdf-export, pptx-export, docx-export         |
| **memory**        | 5      | short-term-memory, long-term-memory          |

**工具接口**:

```typescript
interface ITool<TInput = any, TOutput = any> {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  execute(input: TInput, context?: ToolContext): Promise<TOutput>;
  validate?(input: TInput): Promise<ValidationResult>;
}
```

**注册和使用**:

```typescript
// 注册工具
toolRegistry.register(new MyCustomTool());

// 获取工具
const tool = toolRegistry.get("my-tool-id");
const result = await tool.execute(input);

// 获取 Function Definition (用于 LLM 函数调用)
const functions = this.aiFacade.getToolFunctionDefinitions([
  "web-search",
  "rag-search",
]);
```

---

### 5. Agents (Agent 框架)

**代码位置**: `agents/`

**Agent 类型**:

| 类型            | 基类             | 特点             |
| --------------- | ---------------- | ---------------- |
| **ReAct Agent** | `ReactiveAgent`  | 推理-行动循环    |
| **Plan-Based**  | `PlanBasedAgent` | 规划-执行分离    |
| **Plan Agent**  | `PlanAgent`      | 生成多步执行计划 |

**内置 Agent 实现**:

| Agent              | ID                   | 职责           |
| ------------------ | -------------------- | -------------- |
| Developer          | `developer`          | 代码生成和分析 |
| Researcher         | `researcher`         | 信息检索和总结 |
| Simulator          | `simulator`          | 场景模拟和推演 |
| Image Designer     | `image-designer`     | 图像设计和生成 |
| Team Collaboration | `team-collaboration` | 团队协作编排   |

**Agent 执行流程**:

```
1. 接收输入 (AgentInput)
2. 规划 (可选，Plan-Based)
3. 执行步骤
4. 调用工具 (可选)
5. 生成结果 (AgentResult)
6. 发出事件 (AgentEvent)
```

**使用示例**:

```typescript
const result = await this.aiFacade.executeAgent({
  agentId: "researcher",
  input: {
    task: "总结这篇论文",
    context: paperContent,
  },
  taskProfile: {
    creativity: "medium",
    outputLength: "standard",
  },
});
```

---

### 6. Orchestration (编排引擎)

**代码位置**: `orchestration/`

**4 个执行器**:

| 执行器                    | 职责         | 使用场景     |
| ------------------------- | ------------ | ------------ |
| `SequentialExecutor`      | 顺序执行任务 | 串行工作流   |
| `ParallelExecutor`        | 并行执行任务 | 无依赖任务   |
| `DAGExecutor`             | 依赖图执行   | 复杂依赖关系 |
| `FunctionCallingExecutor` | 函数调用编排 | LLM 工具调用 |

**11 个编排服务**:

| 服务                           | 职责             | 代码量  |
| ------------------------------ | ---------------- | ------- |
| `TaskDecomposerService`        | 任务分解         | ~200    |
| `AgentExecutorService`         | Agent 执行       | ~300    |
| `OutputReviewerService`        | 输出审查         | ~250    |
| `IterationManagerService`      | 迭代管理         | ~200    |
| `ContextEvolutionService`      | 上下文进化       | ~150    |
| `ContextInitializationService` | 上下文初始化     | ~100    |
| `ContextCompressionService`    | 上下文压缩       | ~150    |
| `ConstraintEnforcementService` | 约束强制         | ~100    |
| `IntentDetectionService`       | 意图检测         | ~100    |
| `CircuitBreakerService`        | 熔断器           | ~200    |
| `TokenBudgetService`           | Token 预算管理   | ~150    |
| **`ReflectionService`**        | **自我反思机制** | **406** |
| **`ExecutionStateManager`**    | **状态机管理**   | **436** |

**重点能力**:

1. **自我反思** (ReflectionService):
   - 从 Deep Research 沉淀
   - 自动评估输出质量
   - 触发迭代改进

2. **状态机管理** (ExecutionStateManager):
   - 从 Teams MissionState 沉淀
   - 统一状态转换逻辑
   - 支持状态持久化

3. **熔断器** (CircuitBreakerService):
   - 模型故障检测
   - 自动降级
   - 限速保护

---

### 7. Teams (团队系统)

**代码位置**: `teams/`

**核心概念**:

```
Team (团队)
  ├── Leader (领导者)
  │   └── 负责分解任务、分配工作、整合结果
  ├── Member (成员) × N
  │   └── 执行具体任务、提供专业输出
  └── Workflow (工作流)
      └── 定义协作模式和流程
```

**预定义团队模板**:

| 模板          | ID              | Leader      | Members                    |
| ------------- | --------------- | ----------- | -------------------------- |
| Research Team | `research-team` | Coordinator | Searcher, Analyst, Writer  |
| Debate Team   | `debate-team`   | Moderator   | Proponent, Opponent        |
| Report Team   | `report-team`   | Editor      | Outliner, Writer, Reviewer |

**协作模式**:

- **Leader-Member**: Leader 分配任务，Member 执行
- **Voting**: 成员投票达成共识
- **Handoff**: 任务在 Agent 间交接

**使用示例**:

```typescript
const mission = await this.aiFacade.startTeamMission({
  teamType: "research-team",
  input: {
    topic: "AI Agent 架构设计",
    requirements: "分析主流框架",
  },
  onProgress: (progress) => {
    console.log(`${progress.percentage}%`);
  },
});
```

---

### 8. Memory (记忆系统)

**代码位置**: `memory/stores/`

**两种记忆类型**:

| 类型         | 服务                     | 生命周期     | 存储方式    |
| ------------ | ------------------------ | ------------ | ----------- |
| **短期记忆** | `ShortTermMemoryService` | 会话级 (TTL) | 内存        |
| **长期记忆** | `LongTermMemoryService`  | 用户级       | 数据库+向量 |

**使用场景**:

- **短期记忆**: 对话历史、临时上下文
- **长期记忆**: 用户偏好、知识积累

**使用示例**:

```typescript
// 存储记忆
await this.aiFacade.storeMemory({
  sessionId: "session-123",
  type: "short-term",
  content: "用户喜欢简洁的回答",
  metadata: { importance: "high" },
});

// 检索记忆
const memories = await this.aiFacade.retrieveMemory({
  sessionId: "session-123",
  type: "short-term",
  limit: 10,
});
```

---

### 9. Constraint (约束引擎)

**代码位置**: `constraint/`

**4 种约束类型**:

| 约束        | 服务              | 职责             |
| ----------- | ----------------- | ---------------- |
| Schema 验证 | `SchemaValidator` | JSON Schema 验证 |
| 内容过滤    | `ContentFilter`   | 敏感内容检测     |
| 成本控制    | `CostController`  | 模型使用成本限制 |
| 速率限制    | `RateLimiter`     | API 调用频率限制 |

**使用示例**:

```typescript
const result = this.aiFacade.checkConstraints({
  type: "content",
  content: userInput,
  constraints: {
    maxTokens: 4000,
    allowedLanguages: ["zh", "en"],
    filterSensitive: true,
  },
});

if (!result.passed) {
  throw new Error(result.violations.join(", "));
}
```

---

### 10. RAG (检索增强生成)

**代码位置**: `rag/`

**3 个核心服务**:

| 服务               | 职责           |
| ------------------ | -------------- |
| `EmbeddingService` | 文本向量化     |
| `VectorService`    | 向量存储与检索 |
| `DocumentChunker`  | 智能文档分块   |

**RAG 流程**:

```
1. 文档分块 (DocumentChunker)
2. 向量嵌入 (EmbeddingService)
3. 存储向量 (VectorService)
4. 语义检索 (VectorService.search)
5. 上下文构建 (格式化检索结果)
```

---

### 11. Image (图像生成)

**代码位置**: `image/`

**支持的 Provider**:

| Provider     | 模型           | 特点     |
| ------------ | -------------- | -------- |
| OpenAI       | DALL-E 3       | 高质量   |
| Google       | Imagen 4       | 可控性强 |
| Stability AI | SDXL           | 开源     |
| Midjourney   | Midjourney API | 艺术风格 |

**使用示例**:

```typescript
const image = await imageFactory.generate({
  provider: "openai",
  prompt: "赛博朋克风格的城市夜景",
  size: "1024x1024",
  quality: "hd",
});
```

---

### 12. Long Content (长内容处理)

**代码位置**: `long-content/`

**核心能力**:

- 超长文本分段处理
- 上下文滑动窗口
- 渐进式生成
- 内容合并策略

**使用场景**:

- 长篇报告生成
- 书籍章节创作
- 超长文档总结

---

### 13. MCP (模型上下文协议)

**代码位置**: `mcp/`

**职责**:

- MCP 协议客户端实现
- MCP 服务器管理
- MCP 工具适配

---

### 14. Skills (技能系统)

**代码位置**: `skills/`

**职责**:

- 工具的高级组合
- 预定义技能模板
- 技能注册表

**Skill vs Tool**:

- **Tool**: 原子能力 (web-search, code-exec)
- **Skill**: 工具组合 (research-skill = search + analyze + summarize)

---

### 15. Collaboration (协作框架)

**代码位置**: `collaboration/`

**核心模式**:

- **Voting Pattern**: 投票共识
- **Handoff Pattern**: 任务交接
- **Debate Pattern**: 辩论对抗

---

## 模块间依赖关系

```
AIEngineFacade (统一入口)
    ↓ 依赖
┌───────────────────────────────────────┐
│ AiChatService (LLM 调用)              │
│ SearchService (搜索)                  │
│ TeamsService (团队协作)               │
│ ShortTermMemoryService (短期记忆)     │
│ LongTermMemoryService (长期记忆)      │
│ AgentExecutorService (Agent 执行)     │
│ ToolRegistry (工具注册表)             │
│ CircuitBreakerService (熔断器)        │
└───────────────────────────────────────┘
    ↓ 依赖
┌───────────────────────────────────────┐
│ ModelFallbackService (模型降级)       │
│ TaskProfileMapperService (参数映射)   │
│ ReflectionService (自我反思)          │
│ ExecutionStateManager (状态机)        │
│ ConstraintEngine (约束引擎)           │
│ EmbeddingService (向量嵌入)           │
│ VectorService (向量检索)              │
│ ImageFactory (图像生成)               │
└───────────────────────────────────────┘
```

---

## 最佳实践

### 1. 使用 Facade 作为唯一入口

```typescript
// ✅ 正确
constructor(private readonly aiFacade: AIEngineFacade) {}

// ❌ 错误
constructor(
  private readonly aiChatService: AiChatService,
  private readonly searchService: SearchService,
) {}
```

### 2. 使用 TaskProfile 而非硬编码

```typescript
// ✅ 正确
taskProfile: {
  creativity: 'medium',
  outputLength: 'standard',
}

// ❌ 错误
temperature: 0.7,
maxTokens: 6000,
```

### 3. 使用 modelType 而非具体模型

```typescript
// ✅ 正确
modelType: AIModelType.CHAT;

// ❌ 错误
model: "gpt-4o";
```

### 4. 利用编排服务

```typescript
// ✅ 正确：使用编排服务
const tasks = await this.taskDecomposer.decompose(complexTask);
const results = await this.parallelExecutor.execute(tasks);

// ❌ 错误：手动编排
for (const task of tasks) {
  await this.executeTask(task);
}
```

---

## 相关文档

- [统一入口设计](./facade-design.md)
- [LLM 能力层](./llm-capabilities.md)
- [工具系统](./tools-system.md)
- [Agent 框架](./agent-framework.md)
- [编排引擎](./orchestration.md)
- [团队系统](./teams-system.md)

---

**维护者**: 技术架构团队
**最后更新**: 2026-01-15



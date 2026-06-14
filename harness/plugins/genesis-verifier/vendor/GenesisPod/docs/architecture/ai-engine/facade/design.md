# AIEngineFacade 统一入口设计

> **版本**: 1.0
> **最后更新**: 2026-01-15
> **代码位置**: `backend/src/modules/ai-engine/facade/ai-engine.facade.ts` (1315 行)

---

## 设计目标

### 核心原则

1. **单一入口**: 所有 AI Apps 通过 Facade 消费 AI Engine 能力
2. **能力聚合**: 整合 LLM、Search、Agent、Team、Memory 等能力
3. **语义化配置**: 使用 TaskProfile 描述任务，而非硬编码参数
4. **向下委托**: Facade 只做路由和适配，具体实现在内部服务
5. **自动保护**: 内置熔断器、重试、降级机制

### 架构定位

```
┌─────────────────────────────────────────────────────────────┐
│  AI Apps Layer (业务应用层)                                 │
│  ─────────────────────────────────────                      │
│  AI Research | AI Teams | AI Office | AI Writing | ...     │
└────────────────────────────┬────────────────────────────────┘
                             │ 只通过 AIEngineFacade 调用
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  AIEngineFacade (统一入口，1315 行)                         │
│  ─────────────────────────────────────                      │
│  - chat()         : LLM 对话                                │
│  - search()       : 智能搜索                                │
│  - executeAgent() : Agent 执行                              │
│  - startTeamMission() : 团队任务                            │
│  - buildContext() : 上下文构建                              │
│  - storeMemory()  : 记忆存储                                │
│  - executeTool()  : 工具执行                                │
└────────────────────────────┬────────────────────────────────┘
                             │ 委托给内部服务
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  AI Engine Core Services (核心服务层)                       │
│  ─────────────────────────────────────                      │
│  AiChatService | SearchService | TeamsService | ...         │
└─────────────────────────────────────────────────────────────┘
```

---

## 接口设计

### 完整接口清单

```typescript
@Injectable()
export class AIEngineFacade {
  // ==================== LLM 能力 ====================

  /** 统一对话入口（内置熔断器保护） */
  async chat(request: ChatRequest): Promise<ChatResponse>;

  /** 流式对话（真正 SSE 流式输出） */
  async *chatStream(
    request: ChatRequest,
  ): AsyncGenerator<{ content: string; done: boolean; error?: string }>;

  /** 智能模型选择（考虑熔断器状态、负载均衡） */
  async selectModel(options: ModelSelectionOptions): Promise<ModelInfo | null>;

  /** 获取推理模型 */
  async getReasoningModel(): Promise<ModelInfo | null>;

  /** 获取扩展模型信息 */
  async getAvailableModelsExtended(
    modelType?: AIModelType,
  ): Promise<ModelInfo[]>;

  /** 获取可用模型列表 */
  async getAvailableModels(
    modelType?: AIModelType,
  ): Promise<Array<{ id: string; name: string; provider: string }>>;

  // ==================== 搜索能力 ====================

  /** 智能搜索 */
  async search(request: SearchRequest): Promise<SearchResponse>;

  /** 格式化搜索结果为上下文 */
  formatSearchResultsForContext(results: SearchResultItem[]): string;

  // ==================== 团队协作能力 ====================

  /** 创建并启动团队任务 */
  async startTeamMission(request: StartMissionRequest): Promise<MissionResult>;

  /** 取消团队任务 */
  cancelMission(missionId: string): boolean;

  /** 获取任务状态 */
  getMissionStatus(missionId: string): MissionStatus | null;

  // ==================== 上下文能力 ====================

  /** 构建上下文（支持多源） */
  async buildContext(request: BuildContextRequest): Promise<string>;

  // ==================== 约束检查能力 ====================

  /** 检查约束（Token、内容过滤、JSON Schema） */
  checkConstraints(request: ConstraintCheckRequest): ConstraintResult;

  // ==================== 记忆能力 ====================

  /** 存储记忆 */
  async storeMemory(request: StoreMemoryRequest): Promise<void>;

  /** 检索记忆 */
  async retrieveMemory(request: RetrieveMemoryRequest): Promise<MemoryItem[]>;

  /** 清除记忆 */
  async clearMemory(sessionId: string): Promise<void>;

  // ==================== Agent 执行能力 ====================

  /** 执行 Agent 任务 */
  async executeAgent(
    request: AgentExecutionRequest,
  ): Promise<AgentExecutionResult>;

  /** 检查 Agent 是否可用 */
  isAgentAvailable(agentId: string): boolean;

  // ==================== Tool 执行能力 ====================

  /** 执行工具 */
  async executeTool<T>(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult<T>>;

  /** 获取可用工具列表 */
  getAvailableTools(category?: ToolCategory): ToolInfo[];

  /** 检查工具是否可用 */
  isToolAvailable(toolId: string): boolean;

  /** 获取工具的 Function Definition */
  getToolFunctionDefinitions(toolIds?: string[]): FunctionDefinition[];
}
```

---

## 核心方法详解

### 1. chat() - LLM 对话

**方法签名**:

```typescript
async chat(request: ChatRequest): Promise<ChatResponse>
```

**请求接口** (`ChatRequest`):

```typescript
interface ChatRequest {
  // 消息列表
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;

  // 系统提示词（可选）
  systemPrompt?: string;

  // ★ 推荐方式：语义化配置
  modelType?: AIModelType; // CHAT, CHAT_FAST, MULTIMODAL, etc.
  taskProfile?: TaskProfile; // creativity, outputLength, taskType, outputFormat

  // 兼容方式：直接参数（优先级更高）
  model?: string; // 直接指定模型 ID
  maxTokens?: number;
  temperature?: number;

  // 高级选项
  strictMode?: boolean; // 严格模式：失败时抛出异常
  provider?: string; // 指定 Provider
  apiKey?: string; // 自定义 API Key
  apiEndpoint?: string; // 自定义 API Endpoint
}
```

**响应接口** (`ChatResponse`):

```typescript
interface ChatResponse {
  content: string; // LLM 生成的内容
  model: string; // 实际使用的模型
  usage?: {
    totalTokens: number; // Token 使用量
  };
  isError?: boolean; // 是否为错误响应（非严格模式）
}
```

**使用示例**:

```typescript
// ✅ 推荐用法：使用 TaskProfile
const response = await this.aiFacade.chat({
  messages: [
    { role: 'system', content: 'You are a research assistant.' },
    { role: 'user', content: userInput },
  ],
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: 'medium',        // 中等创意
    outputLength: 'standard',    // 标准长度
    taskType: 'analysis',
    outputFormat: 'markdown',
  },
});

// ✅ 兼容用法：直接参数（特殊场景）
const response = await this.aiFacade.chat({
  messages: [...],
  model: 'gpt-4o',
  maxTokens: 6000,
  temperature: 0.85,
});
```

**内置保护机制**:

1. **熔断器保护**: 自动检测模型故障，触发降级
2. **参数映射**: TaskProfile → temperature/maxTokens
3. **模型选择**: modelType → 数据库查询具体模型
4. **错误处理**: 严格模式抛异常，非严格模式返回错误内容

---

### 2. chatStream() - 流式对话

**方法签名**:

```typescript
async *chatStream(
  request: ChatRequest,
): AsyncGenerator<{
  content: string;
  done: boolean;
  error?: string;
}>
```

**使用示例**:

```typescript
const stream = this.aiFacade.chatStream({
  messages: [{ role: "user", content: "写一首诗" }],
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "high",
    outputLength: "medium",
  },
});

for await (const chunk of stream) {
  console.log(chunk.content);
  if (chunk.done) break;
  if (chunk.error) throw new Error(chunk.error);
}
```

---

### 3. search() - 智能搜索

**方法签名**:

```typescript
async search(request: SearchRequest): Promise<SearchResponse>
```

**请求接口** (`SearchRequest`):

```typescript
interface SearchRequest {
  query: string; // 搜索关键词
  maxResults?: number; // 最大结果数 (默认 5)
  provider?: "tavily" | "serper" | "duckduckgo"; // 指定 Provider
  timeRange?: "day" | "week" | "month" | "year"; // 时间范围
  language?: string; // 语言 (zh, en, etc.)
}
```

**响应接口** (`SearchResponse`):

```typescript
interface SearchResponse {
  results: SearchResultItem[];
  query: string;
  provider: string;
  totalResults: number;
}

interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  publishedAt?: string;
  score?: number;
}
```

**使用示例**:

```typescript
const results = await this.aiFacade.search({
  query: "量子计算最新进展",
  maxResults: 5,
  provider: "tavily",
  timeRange: "month",
});

// 格式化为上下文
const context = this.aiFacade.formatSearchResultsForContext(results.results);

// 结合 LLM 使用
const response = await this.aiFacade.chat({
  messages: [
    { role: "system", content: `参考以下搜索结果：\n${context}` },
    { role: "user", content: "总结量子计算的最新进展" },
  ],
  modelType: AIModelType.CHAT,
});
```

---

### 4. startTeamMission() - 团队任务

**方法签名**:

```typescript
async startTeamMission(request: StartMissionRequest): Promise<MissionResult>
```

**请求接口** (`StartMissionRequest`):

```typescript
interface StartMissionRequest {
  teamType: TeamType; // 'research-team', 'debate-team', 'report-team'
  input: MissionInput; // 任务输入
  config?: TeamConfig; // 团队配置（可选）
  onProgress?: ProgressCallback; // 进度回调
}

interface MissionInput {
  topic: string; // 任务主题
  requirements?: string; // 任务要求
  context?: string; // 任务上下文
  constraints?: Record<string, any>; // 约束条件
}

type ProgressCallback = (progress: MissionProgress) => void;

interface MissionProgress {
  missionId: string;
  status: "planning" | "executing" | "reviewing" | "completed" | "failed";
  percentage: number;
  currentStep?: string;
  message?: string;
}
```

**响应接口** (`MissionResult`):

```typescript
interface MissionResult {
  missionId: string;
  status: "completed" | "failed";
  output: string;
  artifacts?: Array<{
    type: string;
    content: string;
    metadata?: Record<string, any>;
  }>;
  metrics?: {
    duration: number;
    tokensUsed: number;
    steps: number;
  };
}
```

**使用示例**:

```typescript
const mission = await this.aiFacade.startTeamMission({
  teamType: "research-team",
  input: {
    topic: "AI Agent 架构设计",
    requirements: "分析主流 Agent 框架的设计模式",
    constraints: {
      maxTokens: 10000,
      outputFormat: "markdown",
    },
  },
  onProgress: (progress) => {
    console.log(
      `[${progress.missionId}] ${progress.percentage}% - ${progress.message}`,
    );
  },
});

console.log("任务完成:", mission.output);
```

---

### 5. executeAgent() - Agent 执行

**方法签名**:

```typescript
async executeAgent(
  request: AgentExecutionRequest,
): Promise<AgentExecutionResult>
```

**请求接口** (`AgentExecutionRequest`):

```typescript
interface AgentExecutionRequest {
  agentId: string; // Agent ID ('researcher', 'developer', etc.)
  input: {
    task: string; // 任务描述
    context?: string; // 任务上下文
    files?: Array<{
      // 上传文件（可选）
      name: string;
      content: string;
      type: string;
    }>;
  };
  taskProfile?: TaskProfile; // 任务配置
  tools?: string[]; // 可用工具列表（可选）
  maxIterations?: number; // 最大迭代次数
}
```

**响应接口** (`AgentExecutionResult`):

```typescript
interface AgentExecutionResult {
  output: string;
  status: "success" | "failure" | "timeout";
  artifacts?: Array<{
    type: string;
    content: string;
  }>;
  toolCalls?: Array<{
    toolId: string;
    input: any;
    output: any;
  }>;
  metrics?: {
    duration: number;
    iterations: number;
    tokensUsed: number;
  };
}
```

**使用示例**:

```typescript
const result = await this.aiFacade.executeAgent({
  agentId: "researcher",
  input: {
    task: "总结这篇论文的核心贡献",
    context: paperContent,
  },
  taskProfile: {
    creativity: "medium",
    outputLength: "standard",
  },
  tools: ["web-search", "rag-search"],
  maxIterations: 5,
});

console.log("Agent 输出:", result.output);
console.log(
  "使用工具:",
  result.toolCalls?.map((t) => t.toolId),
);
```

---

### 6. buildContext() - 上下文构建

**方法签名**:

```typescript
async buildContext(request: BuildContextRequest): Promise<string>
```

**请求接口** (`BuildContextRequest`):

```typescript
interface BuildContextRequest {
  sources: ContextSource[]; // 上下文来源列表
  maxTokens?: number; // 最大 Token 数
  prioritize?: "recent" | "relevant" | "important"; // 优先级策略
}

interface ContextSource {
  type: "search" | "memory" | "file" | "database" | "custom";
  content?: string; // 直接内容
  id?: string; // 资源 ID (memory, file)
  query?: string; // 查询 (search, database)
  metadata?: Record<string, any>;
}
```

**使用示例**:

```typescript
const context = await this.aiFacade.buildContext({
  sources: [
    { type: "search", query: "量子计算" },
    { type: "memory", id: sessionId },
    { type: "file", id: fileId },
  ],
  maxTokens: 4000,
  prioritize: "relevant",
});

const response = await this.aiFacade.chat({
  messages: [
    { role: "system", content: context },
    { role: "user", content: userInput },
  ],
  modelType: AIModelType.CHAT,
});
```

---

### 7. storeMemory() / retrieveMemory() - 记忆管理

**存储记忆**:

```typescript
async storeMemory(request: StoreMemoryRequest): Promise<void>

interface StoreMemoryRequest {
  sessionId: string;
  type: 'short-term' | 'long-term';
  content: string;
  metadata?: {
    importance?: 'low' | 'medium' | 'high';
    tags?: string[];
    ttl?: number;                // TTL (秒，仅短期记忆)
  };
}
```

**检索记忆**:

```typescript
async retrieveMemory(request: RetrieveMemoryRequest): Promise<MemoryItem[]>

interface RetrieveMemoryRequest {
  sessionId: string;
  type: 'short-term' | 'long-term';
  query?: string;                // 查询关键词（可选）
  limit?: number;                // 最大数量
  minRelevance?: number;         // 最小相关度 (0-1)
}

interface MemoryItem {
  id: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  relevance?: number;            // 相关度评分
}
```

**使用示例**:

```typescript
// 存储记忆
await this.aiFacade.storeMemory({
  sessionId: "session-123",
  type: "short-term",
  content: "用户喜欢简洁的回答",
  metadata: {
    importance: "high",
    tags: ["preference"],
    ttl: 3600, // 1 小时后过期
  },
});

// 检索记忆
const memories = await this.aiFacade.retrieveMemory({
  sessionId: "session-123",
  type: "short-term",
  query: "用户偏好",
  limit: 10,
  minRelevance: 0.7,
});

// 结合 LLM 使用
const memoryContext = memories.map((m) => m.content).join("\n");
const response = await this.aiFacade.chat({
  messages: [
    { role: "system", content: `用户偏好：\n${memoryContext}` },
    { role: "user", content: userInput },
  ],
  modelType: AIModelType.CHAT,
});
```

---

### 8. executeTool() - 工具执行

**方法签名**:

```typescript
async executeTool<T>(
  request: ToolExecutionRequest,
): Promise<ToolExecutionResult<T>>
```

**请求接口** (`ToolExecutionRequest`):

```typescript
interface ToolExecutionRequest {
  toolId: string; // 工具 ID
  input: any; // 工具输入
  context?: {
    sessionId?: string;
    userId?: string;
    metadata?: Record<string, any>;
  };
}
```

**响应接口** (`ToolExecutionResult<T>`):

```typescript
interface ToolExecutionResult<T> {
  success: boolean;
  output?: T;
  error?: string;
  metadata?: {
    duration: number;
    toolId: string;
    timestamp: Date;
  };
}
```

**使用示例**:

```typescript
// 执行 web 搜索工具
const searchResult = await this.aiFacade.executeTool<SearchResult>({
  toolId: "web-search",
  input: {
    query: "量子计算",
    maxResults: 5,
  },
});

// 执行 Python 代码
const codeResult = await this.aiFacade.executeTool<CodeExecutionResult>({
  toolId: "python-executor",
  input: {
    code: 'print("Hello, World!")',
  },
});
```

---

## 内置保护机制

### 1. 熔断器保护

**触发条件**:

- 连续失败次数 >= 阈值
- 错误率 >= 阈值
- 响应时间 >= 阈值

**降级策略**:

```
Primary Model → Fallback Model → Default Model → 错误响应
```

**使用示例**:

```typescript
// Facade 内置熔断器，无需显式调用
const response = await this.aiFacade.chat(request);
// 自动处理模型故障和降级
```

### 2. 敏感信息过滤

**过滤规则**:

```typescript
const SENSITIVE_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /bearer\s+\S+/gi,
];
```

**自动过滤**: 所有通过 Facade 的内容自动过滤敏感信息

---

## 使用最佳实践

### 1. 始终通过 Facade

```typescript
// ✅ 正确
@Injectable()
export class MyService {
  constructor(private readonly aiFacade: AIEngineFacade) {}
}

// ❌ 错误：直接依赖内部服务
@Injectable()
export class MyService {
  constructor(private readonly aiChatService: AiChatService) {}
}
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

### 4. 处理异步和错误

```typescript
// ✅ 正确
try {
  const response = await this.aiFacade.chat(request);
  return response.content;
} catch (error) {
  this.logger.error("Chat failed:", error);
  throw new AiServiceUnavailableError("LLM service unavailable");
}

// ❌ 错误：不处理错误
const response = await this.aiFacade.chat(request);
return response.content;
```

---

## 性能优化建议

### 1. 使用流式输出

```typescript
// 长内容生成使用流式输出
const stream = this.aiFacade.chatStream(request);
for await (const chunk of stream) {
  // 实时显示内容
  yield chunk.content;
}
```

### 2. 批量操作

```typescript
// ✅ 正确：并行执行
const tasks = queries.map((q) =>
  this.aiFacade.search({ query: q, maxResults: 3 }),
);
const results = await Promise.all(tasks);

// ❌ 错误：串行执行
const results = [];
for (const query of queries) {
  results.push(await this.aiFacade.search({ query, maxResults: 3 }));
}
```

### 3. 缓存记忆

```typescript
// 会话开始时一次性加载记忆
const memories = await this.aiFacade.retrieveMemory({
  sessionId,
  type: "short-term",
});

// 后续使用缓存
const memoryContext = memories.map((m) => m.content).join("\n");
```

---

## 常见问题

### Q1: 为什么必须通过 Facade？

**A**: Facade 提供统一的错误处理、熔断保护、参数映射、日志记录等机制，直接调用内部服务会绕过这些保护。

### Q2: TaskProfile 和直接参数哪个优先级高？

**A**: 直接参数 (`temperature`, `maxTokens`) 优先级更高，用于特殊场景。推荐使用 TaskProfile。

### Q3: 如何选择合适的 modelType？

**A**:

- `CHAT`: 标准聊天任务
- `CHAT_FAST`: 快速低成本任务
- `MULTIMODAL`: 需要视觉输入
- `IMAGE_GENERATION`: 图像生成

### Q4: 熔断器如何重置？

**A**: 熔断器自动重置，无需手动操作。当模型恢复正常后，自动从 OPEN 状态转为 HALF_OPEN，再转为 CLOSED。

---

## 相关文档

- [模块总览](./module-overview.md)
- [LLM 能力层](./llm-capabilities.md)
- [参数抽象](./ai-engine-parameter-abstraction.md)
- [目标架构](./ai-engine-target-architecture.md)

---

**维护者**: 技术架构团队
**最后更新**: 2026-01-15

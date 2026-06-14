# AI 编排服务

## 概述

Genesis 实现了数据库驱动的 AI 编排层，通过 `AIModel` 表管理所有模型配置，实现零硬编码、动态切换和自动降级。

## 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                AI Orchestration Architecture                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              Application Layer (AI Apps)              │ │
│  │  AI Ask | AI Office | AI Teams | AI Studio...        │ │
│  └───────────────────────────────────────────────────────┘ │
│                            │                                 │
│                            ▼                                 │
│  ┌───────────────────────────────────────────────────────┐ │
│  │              AiChatService (核心服务)                  │ │
│  │  • chat(options): 统一聊天接口                         │ │
│  │  • TaskProfile 语义化配置                             │ │
│  │  • 数据库驱动的模型选择                               │ │
│  └───────────────────────────────────────────────────────┘ │
│         │                   │                   │            │
│         ▼                   ▼                   ▼            │
│  ┌──────────┐      ┌─────────────┐      ┌──────────────┐  │
│  │TaskProfile│      │ AIModel     │      │Model Fallback│  │
│  │  Mapper  │      │Config Cache │      │   Service    │  │
│  └──────────┘      └─────────────┘      └──────────────┘  │
│         │                   │                   │            │
│         └───────────────────┼───────────────────┘            │
│                             ▼                                │
│  ┌───────────────────────────────────────────────────────┐ │
│  │            LLM Adapters (统一接口)                     │ │
│  │  • AIChatLLMAdapter (基础对话)                        │ │
│  │  • FunctionCallingLLMAdapter (函数调用)               │ │
│  │  • UniversalLLMAdapter (通用适配)                     │ │
│  └───────────────────────────────────────────────────────┘ │
│                             │                                │
│         ┌───────────────────┼───────────────────┐            │
│         ▼                   ▼                   ▼            │
│  ┌──────────┐      ┌──────────────┐      ┌──────────┐      │
│  │  OpenAI  │      │  Anthropic   │      │  Google  │      │
│  │ API      │      │  API         │      │  API     │      │
│  └──────────┘      └──────────────┘      └──────────┘      │
│         │                   │                   │            │
│  ┌──────────┐      ┌──────────────┐                         │
│  │   xAI    │      │   Custom     │                         │
│  │  API     │      │   Models     │                         │
│  └──────────┘      └──────────────┘                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. AiChatService (统一入口)

位置：`backend/src/modules/ai-engine/llm/services/ai-chat.service.ts`

```typescript
@Injectable()
export class AiChatService {
  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly taskProfileMapper: TaskProfileMapperService,
  ) {}

  /**
   * 统一聊天接口
   * ★ 推荐使用 taskProfile 替代 temperature/maxTokens 硬编码
   */
  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    // 1. 从数据库加载模型配置
    const modelConfig = await this.getModelConfig(options.model);

    // 2. 使用 TaskProfile 映射参数
    const params = this.taskProfileMapper.mapToParameters(
      options.taskProfile || { creativity: "medium", outputLength: "medium" },
      modelConfig,
    );

    // 3. 构建请求
    const request = {
      model: modelConfig.modelId,
      messages: this.buildMessages(options),
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      ...this.getApiSpecificParams(modelConfig),
    };

    // 4. 调用 API
    const response = await this.callApi(modelConfig.apiEndpoint, request);

    return {
      content: response.choices[0].message.content,
      model: modelConfig.name,
      tokensUsed: response.usage?.total_tokens || 0,
    };
  }
}
```

**关键特性：**

- 零硬编码模型配置，全部从数据库读取
- Task Profile 语义化描述任务需求
- 自动适配不同 Provider 的 API 格式
- 统一的错误处理和重试机制

### 2. TaskProfile (语义化配置)

位置：`backend/src/modules/ai-engine/llm/types/task-profile.types.ts`

```typescript
/**
 * 任务配置：语义化方式描述任务需求
 * ★ 推荐使用这种方式替代硬编码 temperature/maxTokens
 */
export interface TaskProfile {
  /**
   * 创造性水平
   * - deterministic: 确定性输出（分类、提取、JSON）
   * - low: 低创造性（分析、总结）
   * - medium: 中等创造性（对话、研究）
   * - high: 高创造性（创意写作、头脑风暴）
   */
  creativity?: "deterministic" | "low" | "medium" | "high";

  /**
   * 输出长度
   * - minimal: 极短（标签、分类）
   * - short: 短（摘要、总结）
   * - medium: 中等（标准分析）
   * - standard: 标准（编辑任务）
   * - long: 长（报告、章节）
   * - extended: 超长（完整文档）
   */
  outputLength?:
    | "minimal"
    | "short"
    | "medium"
    | "standard"
    | "long"
    | "extended";

  /**
   * 响应速度
   * - instant: 即时响应（简单任务）
   * - fast: 快速（标准任务）
   * - balanced: 平衡（复杂任务）
   * - thorough: 深思熟虑（研究任务）
   */
  responseSpeed?: "instant" | "fast" | "balanced" | "thorough";
}
```

**映射规则：**

| creativity    | temperature | 使用场景                 |
| ------------- | ----------- | ------------------------ |
| deterministic | 0.1         | 分类、提取、JSON 生成    |
| low           | 0.3         | 分析、总结、翻译         |
| medium        | 0.7         | 对话、研究、文档编辑     |
| high          | 0.9         | 创意写作、头脑风暴、设计 |

| outputLength | maxTokens | 使用场景       |
| ------------ | --------- | -------------- |
| minimal      | 500       | 标签、分类     |
| short        | 1500      | 摘要、总结     |
| medium       | 4000      | 标准分析       |
| standard     | 6000      | 编辑任务       |
| long         | 8000      | 报告、章节     |
| extended     | 16000     | 完整文档、书籍 |

**使用示例：**

```typescript
// ✅ 推荐方式：语义化配置
const response = await this.aiChatService.chat({
  model: "gpt-4o",
  messages: [{ role: "user", content: "分析这段文本" }],
  taskProfile: {
    creativity: "low", // 分析任务，低创造性
    outputLength: "medium", // 中等长度分析
  },
});

// ❌ 不推荐：硬编码参数
const response = await this.aiChatService.chat({
  model: "gpt-4o",
  messages: [{ role: "user", content: "分析这段文本" }],
  temperature: 0.3, // 硬编码，难以维护
  maxTokens: 4000,
});
```

### 3. 数据库驱动的模型配置

**AIModel 表结构：**

```prisma
model AIModel {
  id            String   @id @default(uuid())
  name          String   @unique        // "gpt-4o"
  displayName   String                  // "GPT-4o"
  provider      String                  // "openai"
  modelId       String                  // "gpt-4o-2024-11-20"
  apiEndpoint   String                  // "https://api.openai.com/v1/chat/completions"
  apiKey        String?                 // 加密存储
  maxTokens     Int      @default(4096)
  temperature   Float    @default(0.7)
  isEnabled     Boolean  @default(true)
  isDefault     Boolean  @default(false)

  // ★ 数据库驱动的能力配置
  capabilities  AIModelCapability?

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model AIModelCapability {
  id            String   @id @default(uuid())
  modelId       String   @unique
  model         AIModel  @relation(fields: [modelId], references: [id])

  // 模型特性
  isReasoning             Boolean @default(false)  // 推理模型（o1, o3, gpt-5）
  supportsTemperature     Boolean @default(true)   // 是否支持 temperature
  supportsStreaming       Boolean @default(true)   // 是否支持流式输出
  supportsFunctionCalling Boolean @default(false)  // 是否支持函数调用
  supportsVision          Boolean @default(false)  // 是否支持视觉输入

  // API 格式
  apiFormat               String  @default("openai") // openai, anthropic, google, xai
  tokenParamName          String  @default("max_tokens") // max_tokens 或 max_completion_tokens

  // 性能配置
  defaultTimeoutMs        Int     @default(60000)
  priority                Int     @default(50)      // 模型优先级（用于降级）

  // 定价
  priceInputPerMillion    Float?
  priceOutputPerMillion   Float?
}
```

**配置示例：**

```sql
-- GPT-4o (标准对话模型)
INSERT INTO "AIModel" (name, displayName, provider, modelId, apiEndpoint, isEnabled)
VALUES ('gpt-4o', 'GPT-4o', 'openai', 'gpt-4o-2024-11-20',
        'https://api.openai.com/v1/chat/completions', true);

-- GPT-5.1 (推理模型)
INSERT INTO "AIModel" (name, displayName, provider, modelId, apiEndpoint, isEnabled)
VALUES ('gpt-5.1', 'GPT-5.1 (Reasoning)', 'openai', 'gpt-5.1',
        'https://api.openai.com/v1/chat/completions', true);

INSERT INTO "AIModelCapability" (modelId, isReasoning, supportsTemperature, tokenParamName)
VALUES (
  (SELECT id FROM "AIModel" WHERE name = 'gpt-5.1'),
  true,  -- 推理模型
  false, -- 不支持 temperature
  'max_completion_tokens' -- OpenAI 推理模型使用此参数
);

-- Claude Sonnet 4.5
INSERT INTO "AIModel" (name, displayName, provider, modelId, apiEndpoint, isEnabled)
VALUES ('claude-sonnet-4.5', 'Claude Sonnet 4.5', 'anthropic',
        'claude-sonnet-4-5-20250929',
        'https://api.anthropic.com/v1/messages', true);

INSERT INTO "AIModelCapability" (modelId, apiFormat, tokenParamName)
VALUES (
  (SELECT id FROM "AIModel" WHERE name = 'claude-sonnet-4.5'),
  'anthropic',
  'max_tokens'
);
```

### 4. Model Fallback Service (自动降级)

位置：`backend/src/modules/ai-engine/llm/model-fallback/model-fallback.service.ts`

```typescript
@Injectable()
export class ModelFallbackService {
  private readonly fallbackChains: Map<string, string[]> = new Map();

  constructor(private readonly prisma: PrismaService) {
    this.initializeFallbackChains();
  }

  /**
   * 从数据库加载降级链配置
   */
  private async initializeFallbackChains() {
    // 根据 priority 字段构建降级链
    const models = await this.prisma.aIModel.findMany({
      where: { isEnabled: true },
      include: { capabilities: true },
      orderBy: { capabilities: { priority: "desc" } },
    });

    // 按 provider 分组构建降级链
    const groups = this.groupBy(models, (m) => m.provider);

    groups.forEach((models, provider) => {
      const chain = models.map((m) => m.name);
      models.forEach((m) => {
        this.fallbackChains.set(m.name, chain);
      });
    });
  }

  /**
   * 获取降级模型
   */
  async getFallbackModel(
    originalModel: string,
    error: Error,
  ): Promise<string | null> {
    const chain = this.fallbackChains.get(originalModel);
    if (!chain || chain.length <= 1) return null;

    // 跳过原始模型，返回下一个
    const index = chain.indexOf(originalModel);
    if (index === -1 || index === chain.length - 1) return null;

    return chain[index + 1];
  }
}
```

**降级策略：**

1. **同 Provider 降级**: GPT-5.1 → GPT-4o → GPT-4o-mini
2. **跨 Provider 降级**: OpenAI → Anthropic → Google
3. **按优先级降级**: 根据 `priority` 字段排序
4. **错误类型降级**: Rate Limit → 切换 Provider，模型不存在 → 降级模型

### 5. LLM Adapters (统一接口)

**适配器架构：**

```typescript
// 基础适配器
export interface LLMAdapter {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
}

// AI 对话适配器（标准对话）
@Injectable()
export class AIChatLLMAdapter implements LLMAdapter {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // 根据 apiFormat 调用不同的 API
    switch (request.apiFormat) {
      case "openai":
        return this.callOpenAI(request);
      case "anthropic":
        return this.callAnthropic(request);
      case "google":
        return this.callGoogle(request);
      default:
        throw new Error(`Unsupported API format: ${request.apiFormat}`);
    }
  }
}

// 函数调用适配器（Tool Use）
@Injectable()
export class FunctionCallingLLMAdapter implements LLMAdapter {
  async chat(request: ChatRequestWithTools): Promise<ChatResponseWithTools> {
    // 处理函数调用
  }
}
```

## 使用指南

### 基础对话

```typescript
@Injectable()
export class MyService {
  constructor(private readonly aiChatService: AiChatService) {}

  async analyze(text: string) {
    const response = await this.aiChatService.chat({
      model: "gpt-4o", // 或从配置读取
      messages: [
        {
          role: "system",
          content: "你是一位专业的文本分析师",
        },
        {
          role: "user",
          content: `分析以下文本：\n\n${text}`,
        },
      ],
      taskProfile: {
        creativity: "low", // 分析任务
        outputLength: "medium", // 中等长度
      },
    });

    return response.content;
  }
}
```

### 多轮对话

```typescript
async conversation(conversationId: string, userMessage: string) {
  // 1. 加载历史消息
  const history = await this.loadConversationHistory(conversationId);

  // 2. 构建消息列表
  const messages = [
    ...history,
    { role: 'user', content: userMessage }
  ];

  // 3. 调用 AI
  const response = await this.aiChatService.chat({
    model: 'gpt-4o',
    messages,
    taskProfile: {
      creativity: 'medium',
      outputLength: 'medium',
    },
  });

  // 4. 保存消息
  await this.saveMessages(conversationId, userMessage, response.content);

  return response.content;
}
```

### 流式响应

```typescript
async *streamResponse(prompt: string): AsyncIterable<string> {
  const response = await fetch("/api/ai/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      taskProfile: { creativity: "medium", outputLength: "long" },
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (data.type === "content") {
          yield data.content;
        }
      }
    }
  }
}
```

### 模型选择策略

```typescript
/**
 * 根据任务类型选择最佳模型
 */
function selectModel(taskType: string): string {
  const modelMap: Record<string, string> = {
    reasoning: "gpt-5.1", // 推理任务
    creative: "gpt-4o", // 创意任务
    fast: "gpt-4o-mini", // 快速任务
    vision: "gpt-4o", // 视觉任务
    code: "gpt-4o", // 代码任务
  };

  return modelMap[taskType] || "gpt-4o";
}

// 使用
const response = await this.aiChatService.chat({
  model: selectModel("reasoning"),
  messages: [...],
  taskProfile: { creativity: "deterministic", outputLength: "medium" },
});
```

## 错误处理

```typescript
try {
  const response = await this.aiChatService.chat(options);
} catch (error) {
  if (error instanceof RateLimitError) {
    // 速率限制，稍后重试
    await this.delay(error.retryAfter);
    return this.chat(options);
  } else if (error instanceof ModelNotFoundError) {
    // 模型不存在，使用降级模型
    const fallbackModel = await this.modelFallbackService.getFallbackModel(
      options.model,
      error,
    );
    if (fallbackModel) {
      return this.chat({ ...options, model: fallbackModel });
    }
  } else if (error instanceof APIError) {
    // API 错误，记录并返回友好消息
    this.logger.error(`AI API Error: ${error.message}`);
    throw new AiServiceUnavailableError("AI 服务暂时不可用，请稍后重试");
  }

  throw error;
}
```

## 成本追踪

```typescript
// 记录 AI 调用
await this.prisma.aICallLog.create({
  data: {
    model: response.model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    totalTokens: response.usage.totalTokens,
    cost: this.calculateCost(response),
    userId: user.id,
    taskType: "chat",
  },
});

// 计算成本
function calculateCost(response: ChatResponse): number {
  const pricing = {
    "gpt-4o": { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
    "gpt-5.1": { input: 10 / 1_000_000, output: 30 / 1_000_000 },
    "claude-sonnet-4.5": { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  };

  const price = pricing[response.model] || { input: 0, output: 0 };
  return (
    response.usage.inputTokens * price.input +
    response.usage.outputTokens * price.output
  );
}
```

## 最佳实践

### 1. 使用 TaskProfile 替代硬编码

```typescript
// ✅ 好的做法
const response = await this.aiChatService.chat({
  model: "gpt-4o",
  messages: [...],
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
  },
});

// ❌ 不好的做法
const response = await this.aiChatService.chat({
  model: "gpt-4o",
  messages: [...],
  temperature: 0.3,
  maxTokens: 4000,
});
```

### 2. 从数据库读取模型配置

```typescript
// ✅ 好的做法
const defaultModel = await this.prisma.aIModel.findFirst({
  where: { isDefault: true, isEnabled: true },
});

// ❌ 不好的做法
const defaultModel = "gpt-4o"; // 硬编码
```

### 3. 处理推理模型的特殊性

```typescript
// 推理模型不支持 temperature 和 stream
const modelConfig = await this.getModelConfig(model);

if (modelConfig.capabilities?.isReasoning) {
  // 推理模型：移除 temperature，使用 max_completion_tokens
  const request = {
    model: modelConfig.modelId,
    messages: [...],
    max_completion_tokens: params.maxTokens,
  };
} else {
  // 标准模型：正常使用
  const request = {
    model: modelConfig.modelId,
    messages: [...],
    temperature: params.temperature,
    max_tokens: params.maxTokens,
  };
}
```

## 参考资源

- [OpenAI API 文档](https://platform.openai.com/docs)
- [Anthropic API 文档](https://docs.anthropic.com/)
- [Google AI 文档](https://ai.google.dev/docs)
- [TaskProfile 设计原则](../../guides/ai-calling-standards.md)

---

**最后更新**: 2026-01-15
**维护者**: Genesis Team


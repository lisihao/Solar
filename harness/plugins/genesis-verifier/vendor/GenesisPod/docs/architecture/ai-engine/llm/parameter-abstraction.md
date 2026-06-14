# AI Engine 参数抽象架构设计文档

> **状态**: ✅ 已实现
> **创建日期**: 2026-01-10
> **最后更新**: 2026-01-10
> **作者**: Claude Code

---

## 1. 问题诊断

### 1.1 核心问题

AI App 层直接传递模型特定参数（temperature, maxTokens），导致以下问题：

1. **参数名称不统一**：不同模型使用不同参数名
   - OpenAI: `max_tokens` / `max_completion_tokens`
   - Google: `maxOutputTokens`
   - 有些模型不支持 `temperature`

2. **参数范围不同**：
   - 推理模型（o1, o3, gpt-5）需要更多 tokens 用于内部推理
   - 某些模型 temperature 范围不同

3. **硬编码散落**：
   - 50+ 处 temperature 硬编码（0.1-0.9）
   - 50+ 处 maxTokens 硬编码（500-16000）
   - 1 处模型名称硬编码 "gpt-4o-mini"

### 1.2 现有统计

基于代码库扫描的硬编码分布：

| 参数值               | 出现次数 | 典型场景              |
| -------------------- | -------- | --------------------- |
| temperature: 0.1-0.3 | ~25      | JSON 提取、分类、分析 |
| temperature: 0.5     | ~10      | 反思、评估            |
| temperature: 0.7     | ~35      | 通用对话、研究        |
| temperature: 0.8-0.9 | ~16      | 创意写作              |
| maxTokens: 500-1500  | ~15      | 短响应、提取          |
| maxTokens: 2000-4000 | ~30      | 中等响应、分析        |
| maxTokens: 6000-8000 | ~25      | 长内容、章节          |
| maxTokens: 16000+    | ~8       | 推理模型、超长内容    |

### 1.3 已实现的基础设施

| 组件                       | 位置                                                | 状态      |
| -------------------------- | --------------------------------------------------- | --------- |
| `TaskProfile` 接口         | `llm/types/task-profile.types.ts`                   | ✅ 已实现 |
| `TaskProfileMapperService` | `llm/services/task-profile.types-mapper.service.ts` | ✅ 已实现 |
| `AIModelType` 枚举         | `schema.prisma:2342-2357`                           | ✅ 已使用 |
| `getDefaultModelByType()`  | `ai-chat.service.ts`                                | ✅ 已实现 |
| 统一调用入口 `chat()`      | `ai-chat.service.ts:4161`                           | ✅ 已实现 |
| 数据库模型配置             | AIModel 表                                          | ✅ 已配置 |

---

## 2. 解决方案设计

### 2.1 架构原则

```
┌────────────────────────────────────────────────────────────┐
│  AI App 层                                                  │
│  职责：描述任务需求（WHAT）                                  │
│  - 使用 TaskProfile 描述任务特征                            │
│  - 指定 modelType 而非具体模型名                            │
│  - 不了解模型参数细节                                       │
└───────────────────────┬────────────────────────────────────┘
                        │ taskProfile + modelType
                        ↓
┌────────────────────────────────────────────────────────────┐
│  AI Engine 层                                               │
│  职责：处理模型细节（HOW）                                  │
│  - 根据 TaskProfile 映射到具体参数                          │
│  - 根据 modelType 从数据库选择模型                          │
│  - 处理不同模型的参数差异（名称、类型、范围）               │
│  - 推理模型特殊处理                                         │
└────────────────────────────────────────────────────────────┘
```

### 2.2 统一调用入口架构 ✅ 已实现

```
┌─────────────────────────────────────────────────────────────────┐
│  All External Callers (Services, Agents, Adapters)              │
│  ──────────────────────────────────────────────────             │
│  aiChatService.chat({                                           │
│    messages,                                                    │
│    taskProfile: { creativity: "medium", outputLength: "long" }, │
│    modelType: AIModelType.CHAT,                                 │
│  })                                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  AiChatService.chat() - Unified Entry Point                     │
│  ─────────────────────────────────────────                      │
│  1. Resolve model (modelType → database lookup)                 │
│  2. Map TaskProfile → (temperature, maxTokens)                  │
│  3. Call generateChatCompletion() [internal]                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  generateChatCompletion() [Internal Only]                       │
│  ─────────────────────────────────────────                      │
│  Parameters already resolved, direct API call                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 TaskProfile 接口设计

```typescript
// backend/src/modules/ai-engine/llm/types/task-profile.types.ts

export type CreativityLevel =
  | "deterministic" // 分类、提取、JSON → temp ~0.1
  | "low" // 分析、总结 → temp ~0.3
  | "medium" // 对话、研究 → temp ~0.7
  | "high"; // 创意写作 → temp ~0.9

export type OutputLengthLevel =
  | "minimal" // ~500 tokens: 是/否判断、分类
  | "short" // ~1500 tokens: 摘要、简短回复
  | "medium" // ~4000 tokens: 详细分析、对话
  | "standard" // ~6000 tokens: 中长内容、编辑
  | "long" // ~8000 tokens: 报告、章节
  | "extended"; // ~16000+ tokens: 超长内容、推理模型

export type TaskType =
  | "extraction" // 实体提取、解析
  | "analysis" // 深度分析、评估
  | "conversation" // 对话、问答
  | "writing" // 内容创作
  | "reflection"; // 自我评估、元认知

export type OutputFormat =
  | "json" // 结构化 JSON
  | "markdown" // 格式化 Markdown
  | "plaintext"; // 纯文本

export interface TaskProfile {
  creativity?: CreativityLevel;
  outputLength?: OutputLengthLevel;
  taskType?: TaskType;
  outputFormat?: OutputFormat;
}
```

### 2.4 参数映射规则

#### 2.4.1 创意度 → temperature 映射

| CreativityLevel | temperature | 适用场景              |
| --------------- | ----------- | --------------------- |
| `deterministic` | 0.1         | 分类、提取、JSON 解析 |
| `low`           | 0.3         | 分析、总结、评估      |
| `medium`        | 0.7         | 对话、研究、规划      |
| `high`          | 0.9         | 创意写作、头脑风暴    |

#### 2.4.2 输出长度 → maxTokens 映射

| OutputLengthLevel | maxTokens | 适用场景             |
| ----------------- | --------- | -------------------- |
| `minimal`         | 500       | 是/否判断、分类标签  |
| `short`           | 1500      | 摘要、简短回复       |
| `medium`          | 4000      | 详细分析、标准对话   |
| `standard`        | 6000      | 中长内容、编辑任务   |
| `long`            | 8000      | 报告、章节、全面分析 |
| `extended`        | 16000     | 超长内容、推理模型   |

#### 2.4.3 特殊调整规则

1. **推理模型**（isReasoning=true）：
   - 强制 `maxTokens >= 8000`
   - `extended` 输出自动提升到 16000

2. **JSON 输出格式**：
   - 强制 `temperature <= 0.3`（确保结构稳定）

3. **不支持 temperature 的模型**：
   - 跳过 temperature 参数

### 2.5 chat() 方法签名

```typescript
// ai-chat.service.ts - 统一入口方法

async chat(options: {
  messages: ChatMessage[];
  systemPrompt?: string;

  // ★ 推荐：语义化任务描述
  /** Task profile - AI Engine 映射为具体参数 */
  taskProfile?: TaskProfile;
  /** 模型类型 - AI Engine 从数据库选择具体模型 */
  modelType?: AIModelType;

  // 兼容：直接参数（优先级最高，用于特殊场景）
  maxTokens?: number;
  temperature?: number;
  /** 直接指定模型 ID（高级用法） */
  model?: string;

  /** 严格模式：API 失败时抛出异常 */
  strictMode?: boolean;

  // API Key 场景参数
  provider?: string;
  apiKey?: string;
  apiEndpoint?: string;
}): Promise<{
  content: string;
  usage?: { totalTokens: number };
  model: string;
  isError?: boolean;
}>
```

### 2.6 参数解析优先级

```
1. 直接参数（maxTokens, temperature）    ← 最高优先级，向后兼容
     ↓ 如果未指定
2. TaskProfile 映射                      ← 推荐方式
     ↓ 如果未指定
3. 数据库模型配置                        ← 模型默认值
     ↓ 如果未配置
4. 硬编码默认值（4096, 0.7）            ← 最后兜底
```

---

## 3. 适配器层集成 ✅ 已实现

### 3.1 UniversalLLMAdapter

```typescript
// backend/src/modules/ai-engine/llm/adapters/universal-llm.adapter.ts

async chat(options: LLMRequestOptions): Promise<LLMResponse> {
  // ★ 统一通过 aiChatService.chat() 调用
  const result = await this.aiChatService.chat({
    model,
    messages,
    // ★ 传递 TaskProfile，让 AI Engine 处理参数映射
    taskProfile: options.taskProfile,
    // 直接参数（优先级高于 TaskProfile）
    maxTokens: options.maxTokens,
    temperature: options.temperature,
  });

  return {
    id: `chatcmpl-${Date.now()}`,
    content: result.content,
    finishReason: "stop",
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: result.usage?.totalTokens || 0,
    },
    model: result.model,
    createdAt: new Date(),
  };
}
```

### 3.2 FunctionCallingLLMAdapter

```typescript
// backend/src/modules/ai-engine/llm/adapters/function-calling-llm.adapter.ts

async chat(options: LLMRequestOptions): Promise<LLMResponse> {
  const { messages, functions, temperature, maxTokens, model, taskProfile } = options;

  // ★ 传递 TaskProfile
  return this.aiChatService.chat({
    provider,
    model: modelId,
    apiKey,
    apiEndpoint,
    systemPrompt,
    messages,
    taskProfile,  // ★ 正确传递
    maxTokens,
    temperature,
    ...(tools ? { tools, tool_choice } : {}),
  });
}
```

### 3.3 LLMRequestOptions 接口

```typescript
// backend/src/modules/ai-engine/orchestration/executors/function-calling-executor.ts

export interface LLMRequestOptions {
  messages: LLMMessage[];
  functions?: FunctionDefinition[];
  tools?: Array<{ type: "function"; function: FunctionDefinition }>;
  function_call?: "auto" | "none" | { name: string };
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** ★ TaskProfile for semantic parameter mapping */
  taskProfile?: TaskProfile;
}
```

---

## 4. 使用示例

### 4.1 AI App 层调用示例

```typescript
// ✓ 推荐：使用 TaskProfile
const response = await this.aiChatService.chat({
  messages: [{ role: "user", content: userInput }],
  systemPrompt: ANALYSIS_PROMPT,
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "low",           // 分析任务需要低创意
    outputLength: "medium",      // 中等长度输出
    taskType: "analysis",
    outputFormat: "json",        // 输出 JSON
  },
});

// ✓ 兼容：直接参数（特殊场景）
const response = await this.aiChatService.chat({
  messages: [...],
  model: "gpt-4o",
  maxTokens: 6000,              // 直接指定
  temperature: 0.85,            // 直接指定
});
```

### 4.2 迁移前后对比

**迁移前（硬编码）：**

```typescript
// writing-mission.service.ts
const response = await this.aiChatService.chat({
  messages,
  model: writerModel,
  temperature: 0.8, // 硬编码
  maxTokens: 6000, // 硬编码
});
```

**迁移后（TaskProfile）：**

```typescript
const response = await this.aiChatService.chat({
  messages,
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "high", // 创意写作
    outputLength: "long", // 长篇章节
    taskType: "writing",
  },
});
```

---

## 5. 实现计划与完成状态

### Phase 1: 基础设施 ✅ 已完成

| 任务                  | 文件                                                | 状态      |
| --------------------- | --------------------------------------------------- | --------- |
| 创建 TaskProfile 类型 | `llm/types/task-profile.types.ts`                   | ✅ 已完成 |
| 创建导出桶文件        | `llm/types/index.ts`                                | ✅ 已完成 |
| 创建参数映射服务      | `llm/services/task-profile.types-mapper.service.ts` | ✅ 已完成 |
| 更新 chat() 方法      | `llm/services/ai-chat.service.ts`                   | ✅ 已完成 |
| 注册新服务            | `llm/llm.module.ts`                                 | ✅ 已完成 |

### Phase 2-4: 全面迁移 ✅ 已完成

| 任务                           | 涉及文件数 | 状态      |
| ------------------------------ | ---------- | --------- |
| 适配器层 TaskProfile 支持      | 2          | ✅ 已完成 |
| LLMRequestOptions 接口更新     | 1          | ✅ 已完成 |
| tokensUsed → usage.totalTokens | 28         | ✅ 已完成 |
| 统一调用入口                   | 全部       | ✅ 已完成 |

### 相关提交记录

| 提交 Hash | 描述                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| 862bde1c  | feat(ai-engine): add TaskProfile abstraction for semantic parameter mapping    |
| dad9f005  | feat(ai-engine): complete TaskProfile migration across all modules (Phase 2-4) |
| eac59fd6  | refactor(ai-engine): unify LLM calling patterns through chat() entry point     |

---

## 6. 向后兼容性保证

### 6.1 兼容性策略

1. **直接参数仍然有效**：优先级最高
2. **现有代码无需修改**：可以继续使用直接参数
3. **渐进式迁移**：AI App 可以逐步切换到 TaskProfile
4. **无破坏性改动**：新旧代码可以共存

### 6.2 响应格式兼容 ✅ 已实现

```typescript
// 同时支持新旧两种响应格式
const totalTokens =
  "tokensUsed" in result
    ? result.tokensUsed // 旧格式 (generateChatCompletion)
    : result.usage?.totalTokens || 0; // 新格式 (chat)
```

---

## 7. 风险评估

| 风险           | 可能性 | 影响 | 缓解措施                           | 状态      |
| -------------- | ------ | ---- | ---------------------------------- | --------- |
| 映射规则不准确 | 中     | 中   | 基于 134 个硬编码分析得出，可调整  | ✅ 已验证 |
| 破坏现有功能   | 低     | 高   | 直接参数优先级最高，完全向后兼容   | ✅ 已验证 |
| 迁移工作量大   | 高     | 低   | Phase 1 只做基础设施，后续分批迁移 | ✅ 已完成 |
| 性能影响       | 低     | 低   | 映射逻辑简单，无数据库查询         | ✅ 已验证 |

---

## 8. 已解决的问题

### 8.1 映射规则验证 ✅

temperature 和 maxTokens 的映射值经过代码审查验证，符合实际使用场景。

### 8.2 TaskProfile 字段完整性 ✅

当前字段（creativity, outputLength, taskType, outputFormat）覆盖了绝大多数场景。

### 8.3 迁移策略验证 ✅

分阶段迁移策略成功实施，28 个文件已完成迁移。

### 8.4 细粒度控制 ✅

支持同时使用 TaskProfile 和直接参数，直接参数优先级更高。

---

## 附录

### A. 相关文件路径

| 文件类型                | 路径                                                                              |
| ----------------------- | --------------------------------------------------------------------------------- |
| TaskProfile 类型定义    | `backend/src/modules/ai-engine/llm/types/task-profile.types.ts`                   |
| TaskProfile 映射服务    | `backend/src/modules/ai-engine/llm/services/task-profile.types-mapper.service.ts` |
| AI Chat 服务            | `backend/src/modules/ai-engine/llm/services/ai-chat.service.ts`                   |
| Universal LLM 适配器    | `backend/src/modules/ai-engine/llm/adapters/universal-llm.adapter.ts`             |
| Function Calling 适配器 | `backend/src/modules/ai-engine/llm/adapters/function-calling-llm.adapter.ts`      |
| 数据库 Schema           | `backend/prisma/schema.prisma:2342-2401`                                          |

### B. AIModelType 枚举值

```prisma
enum AIModelType {
  CHAT              // 标准聊天（GPT-4, Claude, Gemini Pro）
  CHAT_FAST         // 快速低成本（GPT-4o-mini, Claude Haiku）
  IMAGE_GENERATION  // 图片生成（DALL-E 3, Imagen 4）
  IMAGE_EDITING     // 图片编辑
  MULTIMODAL        // 多模态（Gemini 2.0 Flash）
  EMBEDDING         // 向量嵌入
  RERANK            // 重排序
}
```

### C. 迁移文件清单

以下 28 个文件已完成 `tokensUsed` → `usage.totalTokens` 迁移：

| 模块        | 文件                              |
| ----------- | --------------------------------- |
| AI Ask      | `ai-ask.service.ts`               |
| AI Coding   | `ai-coding.service.ts`            |
| AI Coding   | `coding-agent.service.ts`         |
| AI Image    | `analytics.service.ts`            |
| AI Office   | `content-analysis.service.ts`     |
| AI Office   | `content-compression.skill.ts`    |
| AI Office   | `four-step-design.skill.ts`       |
| AI Office   | `outline-planning.skill.ts`       |
| AI Office   | `terminology-unifier.skill.ts`    |
| AI Office   | `transition-checker.skill.ts`     |
| AI Sim      | `ai-assist.service.ts`            |
| AI Studio   | `ai-studio-chat.service.ts`       |
| AI Studio   | `report-synthesizer.service.ts`   |
| AI Studio   | `research-planner.service.ts`     |
| AI Studio   | `self-reflection.service.ts`      |
| AI Teams    | `team-mission.service.ts`         |
| AI Engine   | `developer.agent.ts`              |
| AI Engine   | `ai-core.controller.ts`           |
| AI Engine   | `ai-core.service.ts`              |
| AI Engine   | `function-calling-llm.adapter.ts` |
| AI Engine   | `universal-llm.adapter.ts`        |
| AI Engine   | `ai-chat.service.ts`              |
| AI Engine   | `function-calling-executor.ts`    |
| AI Engine   | `agent-executor.service.ts`       |
| AI Engine   | `output-reviewer.service.ts`      |
| Content     | `collections.service.ts`          |
| Content     | `notes.service.ts`                |
| Integration | `wechat-work.service.ts`          |

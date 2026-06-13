# Anthropic 最佳实践优化方案

## 评估日期: 2026-03-17

## 概述

本文档基于 Anthropic 官方最佳实践（2026 年 3 月），以 Topic Insights 为切入点进行逐项对标分析，并给出可直接执行的优化方案。

**核心原则**：AI App 层只表达语义意图，AI Engine 层根据 provider 自动映射到具体参数。

---

## 改动分层：平台通用 vs 模块专属

> 以下按"谁受益"分类，明确哪些是 AI Engine 平台级增强（所有 AI App 共享），哪些是 Topic Insights 专属改进。

### 平台级增强（AI Engine L3 层，所有模块受益）

| 优化项                   | 层级      | 受益模块                                      | 核心改动                          |
| ------------------------ | --------- | --------------------------------------------- | --------------------------------- |
| **P0-1: 深度推理**       | AI Engine | Research, Teams, Writing, Office, Ask, **TI** | TaskProfile + Mapper + API Caller |
| **P0-2: Prompt 缓存**    | AI Engine | Research, Teams, Writing, Office, Ask, **TI** | ChatRequest + API Caller          |
| **P1-2: 严格结构化输出** | AI Engine | Research, Teams, Writing, Office, **TI**      | chatStructured + API Caller       |
| **P2-3: 流式输出增强**   | AI Engine | Research, Writing, Ask, **TI**                | chatStream 已有，需完善           |

### Topic Insights 专属增强

| 优化项                        | 层级                  | 受益模块                                  | 核心改动                          |
| ----------------------------- | --------------------- | ----------------------------------------- | --------------------------------- |
| **P1-1: 原生引用**            | Engine 类型 + TI 消费 | **仅 TI**（其他模块无 evidence 引用需求） | ContentPart 扩展 + Section Writer |
| **P2-1: Tool Use 替代 Skill** | TI agentic loop       | **TI**（Leader 自主搜索）                 | Leader + Section Writer           |
| **P2-2: XML Tags 重构**       | TI prompts            | **TI**                                    | prompts/\*.ts                     |
| **P3-2: 复杂度路由**          | TI 研究入口           | **TI**                                    | topic-insights.service.ts         |

### 跨模块可复用（由 TI 首创，其他模块可选用）

| 优化项                 | 首创模块 | 可复用模块                             |
| ---------------------- | -------- | -------------------------------------- |
| **P3-1: 评估体系**     | TI       | Research, Writing, Office              |
| **原生引用模式**       | TI       | Research（Deep Dive 报告也有引用需求） |
| **Complexity Routing** | TI       | Research（简单/复杂研究分流）          |

---

## 目录

### 第一部分：平台级增强（AI Engine 层）

- [P0-1: 深度推理（Extended Thinking）](#p0-1-深度推理extended-thinking)
- [P0-2: Prompt 缓存（Prompt Caching）](#p0-2-prompt-缓存prompt-caching)
- [P1-2: 严格结构化输出（Strict Structured Output）](#p1-2-严格结构化输出strict-structured-output)

### 第二部分：Topic Insights 专属增强

- [P1-1: 原生引用（Citations）](#p1-1-原生引用citations)
- [P2-1: 原生 Tool Use 替代 Skill 注入](#p2-1-原生-tool-use-替代-skill-注入)
- [P2-2: XML Tags 重构 Prompt](#p2-2-xml-tags-重构-prompt)
- [P2-3: 流式输出用于报告生成](#p2-3-流式输出用于报告生成)

### 第三部分：长期能力建设

- [P3-1: 评估体系](#p3-1-评估体系)
- [P3-2: 复杂度路由（Complexity Routing）](#p3-2-复杂度路由complexity-routing)

### 附录

- [附录 A: 影响文件清单](#附录-a-影响文件清单)
- [附录 B: 各提供商能力矩阵](#附录-b-各提供商能力矩阵)

---

# 第一部分：平台级增强（AI Engine 层）

> 以下优化在 AI Engine L3 层实现，所有 AI App 模块自动受益。Topic Insights 是首个消费方，但 Research、Teams、Writing、Office、Ask 等模块无需额外改动即可使用。

## P0-1: 深度推理（Extended Thinking）

### 当前状态

AI Engine 检测到 reasoning model 时仅做两件事：

1. 调整 `maxTokens`（`task-profile.types-mapper.service.ts:74-118`）
2. 设置 `reasoning_effort: "low"`（`ai-api-caller.service.ts:164-167`）

```typescript
// ai-api-caller.service.ts — 当前对 o1/o3 的处理
if (isO1O3Model) {
  requestBody.reasoning_effort = "low"; // ★ 硬编码为 low，浪费推理能力
}
```

Claude 的 Extended Thinking 和 Gemini 的 Thinking Config 完全未启用。

### Anthropic 最佳实践

| 提供商                 | 参数                                                                   | 适用场景               |
| ---------------------- | ---------------------------------------------------------------------- | ---------------------- |
| Claude Opus 4.6        | `thinking: { type: "adaptive" }` + `output_config: { effort: "high" }` | 推荐方式，模型自适应   |
| Claude Sonnet 4.6      | `thinking: { type: "enabled", budget_tokens: N }`                      | 手动控制 thinking 预算 |
| OpenAI o1/o3/o4-mini   | `reasoning_effort: "low" / "medium" / "high"`                          | 推理强度控制           |
| Google Gemini Thinking | `generationConfig: { thinkingConfig: { thinkingBudget: N } }`          | Thinking token 预算    |
| DeepSeek R1            | 自动（无需额外参数），但需给足 maxTokens                               | —                      |

### 优化方案

#### Step 1: 扩展 TaskProfile 类型

**文件**: `backend/src/modules/ai-engine/llm/types/task-profile.types.ts`

```typescript
// 在 TaskProfile 接口中新增字段
export interface TaskProfile {
  creativity?: CreativityLevel;
  outputLength?: OutputLengthLevel;
  taskType?: TaskType;
  outputFormat?: OutputFormat;

  // ★ 新增：深度推理控制
  /**
   * 推理深度。AI Engine 自动映射到各提供商参数：
   * - Claude: thinking.type / effort
   * - OpenAI: reasoning_effort
   * - Gemini: thinkingConfig.thinkingBudget
   * - DeepSeek: maxTokens 倍增
   *
   * 默认 undefined = 不启用深度推理（普通模型直接忽略此字段）
   */
  reasoningDepth?: "light" | "moderate" | "deep";
}
```

#### Step 2: 扩展 TaskProfileMapper 映射逻辑

**文件**: `backend/src/modules/ai-engine/llm/services/task-profile.types-mapper.service.ts`

```typescript
// 新增映射表
const REASONING_DEPTH_CONFIG = {
  light: { claudeEffort: "low", openaiEffort: "low", geminiBudget: 4096 },
  moderate: {
    claudeEffort: "medium",
    openaiEffort: "medium",
    geminiBudget: 10000,
  },
  deep: { claudeEffort: "high", openaiEffort: "high", geminiBudget: 24000 },
} as const;

// 扩展 MappedParameters 输出
interface MappedParameters {
  temperature: number;
  maxTokens: number;
  // ★ 新增
  reasoningConfig?: {
    claudeThinking?:
      | { type: "adaptive" }
      | { type: "enabled"; budgetTokens: number };
    claudeEffort?: string;
    openaiReasoningEffort?: string;
    geminiThinkingBudget?: number;
  };
}

// 在 mapToParameters() 末尾新增逻辑
if (profile?.reasoningDepth && modelConfig?.isReasoning) {
  const depthConfig = REASONING_DEPTH_CONFIG[profile.reasoningDepth];

  result.reasoningConfig = {
    claudeThinking: { type: "adaptive" },
    claudeEffort: depthConfig.claudeEffort,
    openaiReasoningEffort: depthConfig.openaiEffort,
    geminiThinkingBudget: depthConfig.geminiBudget,
  };

  // 深度推理需要更大的 maxTokens 来容纳 thinking tokens
  if (profile.reasoningDepth === "deep") {
    result.maxTokens = Math.max(result.maxTokens, 32000);
  }
}
```

#### Step 3: 各 Provider API Caller 注入参数

**文件**: `backend/src/modules/ai-engine/llm/services/ai-api-caller.service.ts`

**OpenAI 兼容 API（line 202-216）**:

```typescript
// 替换现有 reasoning_effort 硬编码
if (reasoningConfig?.openaiReasoningEffort) {
  requestBody.reasoning_effort = reasoningConfig.openaiReasoningEffort;
} else if (isO1O3Model) {
  requestBody.reasoning_effort = "low"; // 保留向后兼容默认值
}
```

**Anthropic API（line 323-340）**:

```typescript
// 在 requestBody 构建后新增
if (reasoningConfig?.claudeThinking) {
  requestBody.thinking = reasoningConfig.claudeThinking;
  if (reasoningConfig.claudeEffort) {
    requestBody.output_config = { effort: reasoningConfig.claudeEffort };
  }
}
```

**Google Gemini API（line 416-440）**:

```typescript
// 在 generationConfig 构建后新增
if (reasoningConfig?.geminiThinkingBudget) {
  generationConfig.thinkingConfig = {
    thinkingBudget: reasoningConfig.geminiThinkingBudget,
  };
}
```

#### Step 4: 在 facade/index.ts 导出新类型

```typescript
export type {
  TaskProfile,
  CreativityLevel,
  OutputLengthLevel,
  ContentPart,
  TextContentPart,
  ImageUrlContentPart,
  // ★ 如有新增 ReasoningDepth 类型也在此导出
} from "../llm/types";
```

#### Step 5: Topic Insights 消费侧使用

**仅需修改 3 处核心调用**，添加 `reasoningDepth` 字段：

```typescript
// 1. leader-planning.service.ts:304-319 — 研究规划（最适合深度推理）
response = await this.chatFacade.chat({
  messages: [...],
  model: leaderModel.modelId,
  taskProfile: {
    creativity: "medium",
    outputLength: "extended",
    reasoningDepth: "deep",       // ★ 新增
  },
  responseFormat: "json",
});

// 2. leader-review.service.ts — Leader 审核维度质量
const response = await this.chatFacade.chat({
  messages: [...],
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
    reasoningDepth: "moderate",   // ★ 新增
  },
});

// 3. critique-refine.service.ts — 质量批评循环
const result = await this.chatFacade.chatStructured<RawCritiqueResponse>({
  messages: [...],
  taskProfile: {
    creativity: "low",
    outputLength: "medium",
    reasoningDepth: "moderate",   // ★ 新增
  },
});
```

**不需要启用的场景**（避免不必要延迟和成本）：

- `section-writer.service.ts` — 普通写作，不需要推理
- `query-strategy.service.ts` — 生成搜索查询，简单任务
- `social-search.adapter.ts` — 社交内容分析，轻量任务

### 预期收益

| 指标         | 改进前                         | 改进后                               |
| ------------ | ------------------------------ | ------------------------------------ |
| 研究规划质量 | Leader 用普通 chat，规划逻辑浅 | 深度推理，多因素权衡                 |
| 质量审核深度 | 表面检查                       | 深度逻辑推理、矛盾检测               |
| 成本增加     | —                              | ~20-30%（仅在 3 个高价值调用点启用） |
| 延迟增加     | —                              | 规划增加 10-30s，审核增加 5-15s      |

---

## P0-2: Prompt 缓存（Prompt Caching）

### 当前状态

每次 LLM 调用都发送完整内容，零缓存。

一次典型研究流程的 LLM 调用：

- Leader 规划: 1 次（system prompt ~2000 tokens）
- 维度研究: 5-8 维度 × 3-5 sections ≈ **15-40 次调用**
  - 同一 system prompt `SECTION_WRITING_SYSTEM_PROMPT` 重复发送 15-40 次
  - 同一维度的 evidence 在多个 section 间重复发送
- 质量审核: 5-8 次
- 报告综合: 1-2 次

**总计 ~25-50 次调用，system prompt 重复率 > 80%**。

### Anthropic 最佳实践

```python
# 将静态内容标记为可缓存
system=[{
    "type": "text",
    "text": "大段静态 system prompt...",
    "cache_control": {"type": "ephemeral"}  # 5 分钟缓存，读取 0.1x 成本
}]
```

缓存前缀层次：`[Tools] → [System] → [Context/Examples] → [Messages]`

### 优化方案

#### Step 1: 扩展 ChatMessage 类型支持 cache_control

**文件**: `backend/src/modules/ai-engine/llm/types/task-profile.types.ts`

```typescript
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
  contentParts?: ContentPart[];
  // ★ 新增：提示 Engine 层此消息内容可缓存
  cacheControl?: { type: "ephemeral"; ttl?: "5m" | "1h" };
}
```

#### Step 2: ChatRequest 新增顶层缓存策略

**文件**: `backend/src/modules/ai-engine/facade/types/facade.types.ts`

```typescript
export interface ChatRequest {
  // ...existing fields...

  // ★ 新增：请求级缓存策略
  // "auto" = 自动缓存 system prompt（推荐）
  // "manual" = 只缓存标记了 cacheControl 的消息
  // undefined = 不缓存（默认，向后兼容）
  cachePolicy?: "auto" | "manual";
}
```

#### Step 3: Anthropic API Caller 注入 cache_control

**文件**: `backend/src/modules/ai-engine/llm/services/ai-api-caller.service.ts`

在 `callAnthropicAPI()` 方法（line 298-364）中：

```typescript
// Anthropic API 构建系统消息时注入 cache_control
if (systemMessage?.content && cachePolicy) {
  // 将 system prompt 包装为可缓存的 content block
  requestBody.system = [
    {
      type: "text",
      text: systemMessage.content,
      cache_control: { type: "ephemeral" },
    },
  ];
} else if (systemMessage?.content) {
  requestBody.system = systemMessage.content; // 保持现有行为
}

// 用户消息中标记了 cacheControl 的也注入
const mappedMessages = otherMessages.map((m) => {
  const msg: Record<string, unknown> = {
    role: m.role === "assistant" ? "assistant" : "user",
    content: resolveAnthropicContent(m),
  };
  // Manual cache control on specific messages
  if (m.cacheControl && cachePolicy === "manual") {
    // 将 content 包装为数组格式以支持 cache_control
    msg.content = [
      {
        type: "text",
        text: typeof msg.content === "string" ? msg.content : "",
        cache_control: { type: "ephemeral" },
      },
    ];
  }
  return msg;
});
```

#### Step 4: 响应元数据捕获缓存指标

```typescript
// 解析 Anthropic 响应时提取缓存指标
const cacheMetrics = {
  cacheCreationInputTokens: data.usage?.cache_creation_input_tokens || 0,
  cacheReadInputTokens: data.usage?.cache_read_input_tokens || 0,
};

// 记录到 metrics（fire-and-forget）
if (cacheMetrics.cacheReadInputTokens > 0) {
  void this.kernelMetrics?.recordCacheHit(model, cacheMetrics);
}
```

#### Step 5: Topic Insights 消费侧启用缓存

**只需在调用时添加 `cachePolicy: "auto"`**：

```typescript
// section-writer.service.ts:292 — 同一 system prompt 重复 15-40 次
const response = await this.chatFacade.chatWithSkills({
  messages: [
    { role: "system", content: effectiveSystemPrompt },
    { role: "user", content: finalUserPrompt },
  ],
  additionalSkills: skillIds,
  cachePolicy: "auto", // ★ 新增：自动缓存 system prompt
  taskProfile: { creativity: "medium", outputLength: "long" },
});

// report-synthesis.service.ts:1407 — 综合报告
const response = await this.chatFacade.chatWithSkills({
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ],
  cachePolicy: "auto", // ★ 新增
  taskProfile: { creativity: "medium", outputLength: "extended" },
});
```

#### 注意：OpenAI / Gemini 的缓存处理

| 提供商        | 缓存机制                               | 实现方式                   |
| ------------- | -------------------------------------- | -------------------------- |
| Anthropic     | `cache_control: { type: "ephemeral" }` | 上述方案                   |
| OpenAI        | 自动缓存（2024.10+），无需额外参数     | 无需改动，自动生效         |
| Google Gemini | Context Caching API（独立端点）        | 暂不实现，复杂度高，ROI 低 |

因此 `cachePolicy: "auto"` 在 OpenAI 调用时直接忽略即可（OpenAI 自动缓存），Gemini 也忽略。只对 Anthropic 生效。

### 预期收益

| 场景                      | 调用次数                   | 缓存命中率 | 成本节省                  |
| ------------------------- | -------------------------- | ---------- | ------------------------- |
| Section writing（同维度） | 3-5 次共享 system prompt   | ~80%       | **72% input token 成本**  |
| Section writing（跨维度） | 15-40 次共享 system prompt | ~95%       | **85% input token 成本**  |
| 质量审核                  | 5-8 次共享 system prompt   | ~80%       | **72%**                   |
| **总体**                  | 25-50 次/研究              | ~85%       | **~75% input token 成本** |

> 计算：缓存命中 0.1x + 缓存未命中 1.25x → 85% 命中率 × 0.1 + 15% × 1.25 = 0.085 + 0.1875 ≈ 0.27x（节省 73%）

---

> **P1-2（严格结构化输出）也属于平台级增强**，见下文 P1-2 章节。

---

# 第二部分：Topic Insights 专属增强

> 以下优化主要在 Topic Insights 模块层实现，部分涉及 AI Engine 类型扩展。

## P1-1: 原生引用（Citations）

### 当前状态

引用依赖 prompt 指令 + 正则后处理：

```typescript
// section-writer.service.ts — prompt 中指示使用 [N] 格式
// report 生成后通过正则提取引用编号
const referencesUsed = this.extractReferences(content); // 正则 /\[(\d+)\]/g
```

问题：LLM 可能编造不存在的引用编号、错误匹配来源、遗漏引用。

### Anthropic 最佳实践

```python
messages=[{
    "role": "user",
    "content": [
        {
            "type": "document",
            "source": { "type": "text", "media_type": "text/plain", "data": evidence_text },
            "title": "Source #1: McKinsey Report",
            "citations": { "enabled": True },
        },
        # ...more documents...
        { "type": "text", "text": "Based on these sources, write analysis..." },
    ],
}]
```

**关键优势**：`cited_text` 不计入 output tokens（免费），引用位置保证有效。

### 优化方案

#### Step 1: 扩展 ContentPart 类型

**文件**: `backend/src/modules/ai-engine/llm/types/task-profile.types.ts`

```typescript
// 新增 Document content part
export interface DocumentContentPart {
  type: "document";
  source: {
    type: "text";
    media_type: "text/plain";
    data: string;
  };
  title?: string;
  context?: string;
  citations?: { enabled: boolean };
}

export type ContentPart =
  | TextContentPart
  | ImageUrlContentPart
  | DocumentContentPart; // ★ 新增
```

#### Step 2: Anthropic API Caller 处理 document 类型

**文件**: `backend/src/modules/ai-engine/llm/services/ai-api-caller.service.ts`

```typescript
// resolveAnthropicContent() 中新增 document 处理
function resolveAnthropicContent(msg: ChatMessage) {
  if (!msg.contentParts?.length) return msg.content;
  return msg.contentParts.map((part) => {
    if (part.type === "document") {
      return {
        type: "document",
        source: part.source,
        title: part.title,
        context: part.context,
        citations: part.citations,
      };
    }
    // ...existing text/image handling
  });
}
```

**非 Anthropic Provider 降级处理**：

```typescript
// OpenAI / Gemini 不支持 document 类型，自动降级为 text
function resolveOpenAIContent(msg: ChatMessage) {
  if (!msg.contentParts?.length) return msg.content;
  return msg.contentParts.map((part) => {
    if (part.type === "document") {
      // 降级：将 document 转为 text（保留标题作为前缀）
      return {
        type: "text",
        text: `[Source: ${part.title || "Unknown"}]\n${part.source.data}`,
      };
    }
    // ...existing handling
  });
}
```

#### Step 3: 响应解析提取引用

```typescript
// 新增引用解析
interface CitationBlock {
  type: "cite";
  citedText: string;
  documentIndex: number;
  startCharIndex: number;
  endCharIndex: number;
}

// 解析 Anthropic 响应中的 citations
function extractCitations(responseContent: unknown[]): CitationBlock[] {
  return responseContent
    .filter((block) => block.type === "text" && block.citations?.length)
    .flatMap((block) =>
      block.citations.map((c) => ({
        type: "cite",
        citedText: c.cited_text,
        documentIndex: c.document_index,
        startCharIndex: c.start_char_index,
        endCharIndex: c.end_char_index,
      })),
    );
}
```

#### Step 4: Topic Insights Section Writer 使用

**文件**: `backend/src/modules/ai-app/topic-insights/services/dimension/section-writer.service.ts`

```typescript
// 将 evidence 从 prompt 文本改为 document content parts
const contentParts: ContentPart[] = [
  // Evidence 作为可引用文档
  ...evidenceData.map((e, i) => ({
    type: "document" as const,
    source: {
      type: "text" as const,
      media_type: "text/plain" as const,
      data: e.fullContent || e.snippet || "",
    },
    title: `[${i + 1}] ${e.title} (${e.domain})`,
    context: `Credibility: ${e.credibilityScore}/100, Published: ${e.publishedAt}`,
    citations: { enabled: true },
  })),
  // 写作指令
  {
    type: "text" as const,
    text: finalUserPrompt, // 写作指令（不含 evidence，已在 document 中）
  },
];

const response = await this.chatFacade.chatWithSkills({
  messages: [
    { role: "system", content: effectiveSystemPrompt },
    { role: "user", content: "", contentParts }, // ★ 使用 contentParts
  ],
  cachePolicy: "auto",
  taskProfile: { creativity: "medium", outputLength: "long" },
});
```

### 注意事项

- 原生 Citations 与 Structured Outputs **不兼容**（Anthropic 限制）
- 因此 `chatStructured()` 调用不适用此优化
- Section Writer 和 Report Synthesis 是最佳使用场景

### 预期收益

| 指标                   | 改进前                    | 改进后                 |
| ---------------------- | ------------------------- | ---------------------- |
| 引用准确率             | ~70-80%（靠 prompt 指令） | ~95%+（原生保证）      |
| 引用 output token 成本 | 全额计费                  | cited_text 免费        |
| 后处理复杂度           | 正则 + 验证 + 修复        | 直接使用结构化数据     |
| 虚假引用               | 偶有发生                  | 不可能（指向真实文档） |

---

## P1-2: 严格结构化输出（Strict Structured Output） `[平台级]`

### 当前状态（已实现，R2-#35）

Harness 循环（`simple-loop` 和 `react-loop` 非 function-calling 分支）现在通过 `structuredOutputStrategy: "json_schema"` + `outputJsonSchema` 参数调用 `AiChatService.chat()`，由 `StructuredOutputRouter` 按 provider 选择原生 JSON Schema 约束（OpenAI `json_schema` / Anthropic `tool_use` / Gemini `response_schema` 等），不再依赖 prompt 嵌入 schema + 5 层文本解析回退。

> 注：`chat.facade.ts` 的 `chatStructured()` 辅助方法（prompt-injection 路径）仍存在，供非 harness 的直调场景使用，但 harness 管控的结构化输出已走原生路径。

### Anthropic 最佳实践

```python
# Structured Outputs — 保证 100% 格式合规
response = client.messages.create(
    model="claude-opus-4-6",
    output_config={
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": { ... },
                "required": [...],
                "additionalProperties": False,  # ★ 关键
            }
        }
    },
)
```

### 优化方案

#### Step 1: ChatRequest 新增 outputSchema

**文件**: `backend/src/modules/ai-engine/facade/types/facade.types.ts`

```typescript
export interface ChatRequest {
  // ...existing fields...

  // ★ 新增：JSON Schema 结构化输出（保证格式合规）
  outputSchema?: {
    type: "json_schema";
    schema: Record<string, unknown>;
    strict?: boolean; // 默认 true
  };
}
```

#### Step 2: API Caller 按 Provider 注入

**Anthropic**:

```typescript
if (outputSchema) {
  requestBody.output_config = {
    format: {
      type: "json_schema",
      schema: outputSchema.schema,
    },
  };
}
```

**OpenAI**:

```typescript
if (outputSchema) {
  requestBody.response_format = {
    type: "json_schema",
    json_schema: {
      name: "structured_output",
      schema: outputSchema.schema,
      strict: outputSchema.strict !== false,
    },
  };
}
```

**Gemini**:

```typescript
if (outputSchema) {
  generationConfig.responseMimeType = "application/json";
  generationConfig.responseSchema = outputSchema.schema;
}
```

#### Step 3: chatStructured() 简化

当 provider 支持原生 structured output 时，跳过多层 JSON 恢复逻辑：

```typescript
// chat.facade.ts — chatStructured() 改造
async chatStructured<T>(request: StructuredChatRequest): Promise<StructuredChatResponse<T>> {
  const response = await this.chat({
    ...request,
    outputSchema: {
      type: "json_schema",
      schema: request.schema,
      strict: true,
    },
    // 不再需要将 schema 嵌入 system prompt
  });

  // 原生结构化输出 — 直接 parse，无需恢复逻辑
  try {
    const parsed = JSON.parse(response.content) as T;
    return { data: parsed, rawContent: response.content, model: response.model };
  } catch (e) {
    // 仅在不支持原生 structured output 的 provider 时走 fallback
    return this.fallbackJsonParsing<T>(response.content, request);
  }
}
```

### 预期收益

| 指标                | 改进前                | 改进后                             |
| ------------------- | --------------------- | ---------------------------------- |
| JSON 解析成功率     | ~85-90%（需多层恢复） | ~100%（原生保证）                  |
| 解析代码复杂度      | 5 层 fallback 逻辑    | 单次 JSON.parse                    |
| 额外字段 / 格式错误 | 偶有发生              | `additionalProperties: false` 阻止 |

---

## P2-1: 原生 Tool Use 替代 Skill 注入

### 当前状态

Skills = Markdown 文档拼入 system prompt（`chatWithSkills()` at `chat.facade.ts:457-555`）。

```typescript
// 当前流程
chatWithSkills({ additionalSkills: ["fact-check", "trend-analysis"] });
// → 加载 skill markdown 文档
// → 拼接到 system prompt 末尾
// → 发送给 LLM
```

问题：

- 每个 skill 占 500-2000 tokens context
- LLM 不能动态选择调用哪个 skill
- LLM 不能自主发起搜索（搜索由代码预先执行）

### Anthropic 最佳实践

```python
tools=[
    {
        "name": "web_search",
        "description": "Search the web for current information on a topic",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Search query" },
                "sources": {
                    "type": "array",
                    "items": { "type": "string", "enum": ["web", "academic", "news"] }
                }
            },
            "required": ["query"],
            "additionalProperties": False
        }
    }
]
```

### 优化方案（分阶段）

**阶段 1：Leader 可自主调用搜索工具**

```typescript
// leader-planning.service.ts — 给 Leader 提供工具
const response = await this.chatFacade.chat({
  messages: [...],
  tools: [
    {
      name: "web_search",
      description: "搜索互联网获取最新信息",
      strict: true,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          dataSource: { type: "string", enum: ["web", "academic", "github", "hackernews"] },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "verify_fact",
      description: "验证一个事实声明是否有可靠来源支持",
      strict: true,
      inputSchema: {
        type: "object",
        properties: {
          claim: { type: "string" },
          context: { type: "string" },
        },
        required: ["claim"],
        additionalProperties: false,
      },
    },
  ],
  toolChoice: "auto",  // LLM 自行决定是否调用
  taskProfile: { creativity: "medium", outputLength: "extended", reasoningDepth: "deep" },
});
```

**阶段 2：Section Writer 可追加搜索**

当 LLM 判断当前 evidence 不足时，可自主调用 `web_search` 获取补充信息。需要实现 agentic loop：

```typescript
// section-writer.service.ts — 工具调用循环
let response = await this.chatFacade.chat({
  messages: [...],
  tools: [webSearchTool],
  toolChoice: "auto",
});

// Agentic loop: 处理工具调用
while (response.stopReason === "tool_use") {
  const toolCalls = response.toolUseBlocks;
  const toolResults = await Promise.all(
    toolCalls.map(tc => this.executeSearch(tc.input))
  );

  // 追加工具结果，继续对话
  response = await this.chatFacade.chat({
    messages: [
      ...previousMessages,
      { role: "assistant", content: response.content },
      { role: "user", contentParts: toolResults.map(r => ({
        type: "tool_result",
        toolUseId: r.id,
        content: r.result,
      }))},
    ],
    tools: [webSearchTool],
    toolChoice: "auto",
  });
}
```

> **注意**：此优化工作量大，涉及 agentic loop 实现。建议在 P0/P1 完成后再推进。

### 预期收益

| 指标         | 改进前                              | 改进后                      |
| ------------ | ----------------------------------- | --------------------------- |
| 搜索自主性   | 代码预设搜索，LLM 只写作            | LLM 可自主补充搜索          |
| Context 占用 | skill markdown 占 3000-10000 tokens | tool 定义占 200-500 tokens  |
| 迭代研究     | 不支持                              | LLM 发现不足 → 自动追加搜索 |

---

## P2-2: XML Tags 重构 Prompt

### 当前状态

Prompt 使用 Markdown 格式（`## 标题`、`### 子标题`、`- 列表`）。

### Anthropic 最佳实践

```xml
<documents>
  <document index="1">
    <source>McKinsey Global Institute</source>
    <document_content>...</document_content>
  </document>
</documents>

<instructions>
Based on the documents, write a structured analysis...
</instructions>

<output_format>
Return JSON with the following structure:
{ "sections": [...], "citations": [...] }
</output_format>

<constraints>
- Maximum 1500 words
- Must cite at least 3 sources
</constraints>
```

### 优化方案

重构 `backend/src/modules/ai-app/topic-insights/prompts/` 下的 prompt 文件：

```typescript
// dimension-research.prompt.ts — 改造示例
export const SECTION_WRITING_SYSTEM_PROMPT = `
<role>
你是资深研究分析师，擅长撰写深度分析报告章节。
</role>

<constraints>
- 必须基于提供的证据撰写，不得编造事实
- 每个论点必须有至少一个引用支撑
- 使用 [N] 格式引用来源
- 目标字数：{{targetWords}} 字
</constraints>

<output_format>
输出纯 Markdown 格式的章节内容。
- 使用 ### 作为小节标题
- 关键数据用**粗体**标注
- 在适当位置插入图表建议（用 \`\`\`chart 代码块）
</output_format>
`;

export const SECTION_WRITING_USER_PROMPT_TEMPLATE = `
<section_meta>
章节标题：{{sectionTitle}}
章节描述：{{sectionDescription}}
目标字数：{{targetWords}}
最少引用数：{{minReferences}}
</section_meta>

<key_points>
{{keyPoints}}
</key_points>

<temporal_context>
当前日期：{{currentDate}}
时效要求：{{freshnessRequirement}}
</temporal_context>

<previous_sections>
{{previousContent}}
</previous_sections>

<evidence>
{{evidenceList}}
</evidence>

<leader_guidance>
{{agentGuidance}}
</leader_guidance>

请基于以上证据和要求，撰写「{{sectionTitle}}」章节。
`;
```

### 迁移策略

1. **逐文件迁移**，先改 `dimension-research.prompt.ts`，验证质量无退化
2. 再迁移 `report-synthesis.prompt.ts`、`research-leader.prompt.ts` 等
3. 长文档（evidence）放在 prompt 顶部（Anthropic 推荐：提升 30% 质量）

---

## P2-3: 流式输出用于报告生成

### 当前状态

所有 LLM 调用使用 fire-and-forget 模式：等待完整响应 → 存 DB → 发 WebSocket 事件。

### 优化方案

**仅在两个高延迟场景启用流式**：

1. **Report Synthesis**（综合报告，`outputLength: "extended"` = 16K+ tokens）
2. **Leader Chat**（Leader 多轮对话，用户期望实时响应）

```typescript
// report-synthesis.service.ts — 流式综合报告
const stream = this.chatFacade.chatStream({
  messages: [...],
  cachePolicy: "auto",
  taskProfile: { creativity: "medium", outputLength: "extended" },
});

let fullContent = "";
for await (const chunk of stream) {
  fullContent += chunk.content;
  // 每 500 字发送一次 WebSocket 进度更新
  if (fullContent.length % 500 < chunk.content.length) {
    this.eventEmitter.emitSynthesisProgress(topicId, {
      phase: "writing",
      preview: fullContent.slice(-200),
      progress: Math.min(fullContent.length / estimatedLength, 0.95),
    });
  }
  if (chunk.done) break;
}
```

---

# 第三部分：长期能力建设

> 以下优化是长期投资，TI 首创，其他模块可复用。

## P3-1: 评估体系

### 当前状态

无离线评估系统。`CritiqueRefineService` 是运行时自评，不是离线评估。

### Anthropic 最佳实践

> 优先**量大自动化**而非少量人工评审。定义 SMART 成功标准，用 LLM 做 grader。

### 优化方案

#### Step 1: 定义评估指标

```typescript
// backend/src/modules/ai-app/topic-insights/eval/metrics.ts
export interface ReportEvalMetrics {
  // 自动化指标（代码评分）
  citationAccuracy: number; // 引用编号是否对应真实 evidence（0-1）
  structureCompleteness: number; // 是否包含所有必要章节（0-1）
  wordCountRatio: number; // 实际/目标字数比（0.8-1.2 为合格）
  evidenceCoverage: number; // 引用了多少比例的 evidence（0-1）

  // LLM 评分指标（用不同模型做 grader）
  factualAccuracy: number; // 1-5 Likert 量表
  analyticalDepth: number; // 1-5
  readability: number; // 1-5
  actionability: number; // 1-5
}
```

#### Step 2: 构建 Eval Dataset

```
backend/src/modules/ai-app/topic-insights/eval/
├── dataset/
│   ├── macro-ai-policy.json        # 宏观主题 gold standard
│   ├── tech-llm-benchmark.json     # 技术主题 gold standard
│   ├── company-nvidia.json         # 公司主题 gold standard
│   └── event-deepseek-r1.json      # 事件主题 gold standard
├── graders/
│   ├── citation-grader.ts          # 代码评分：引用准确性
│   ├── structure-grader.ts         # 代码评分：结构完整性
│   └── llm-grader.ts              # LLM 评分：深度/可读性
├── runner.ts                       # Eval 执行器
└── metrics.ts                      # 指标定义
```

#### Step 3: 集成到 CI

每次 prompt 文件修改时自动跑 eval，输出质量变化报告。

---

## P3-2: 复杂度路由（Complexity Routing）

### 当前状态

所有 topic 走完整 Leader 规划流程（包括简单 topic）。

### Anthropic 最佳实践

> Routing：分类输入，路由到专门处理程序。简单问题用 Haiku，复杂问题用 Opus。

### 优化方案

```typescript
// topic-insights.service.ts — 研究启动前的复杂度路由
async startResearch(topicId: string) {
  const topic = await this.topicCrud.findById(topicId);

  // 快速复杂度评估（用 Haiku 级模型）
  const complexity = await this.chatFacade.chatStructured<{ level: string }>({
    messages: [{
      role: "user",
      content: `评估研究复杂度: "${topic.name}" (${topic.type})。
输出 JSON: { "level": "simple" | "moderate" | "complex" }`,
    }],
    schema: {
      type: "object",
      properties: { level: { type: "string", enum: ["simple", "moderate", "complex"] } },
      required: ["level"],
      additionalProperties: false,
    },
    modelType: AIModelType.CHAT_FAST,  // 用快速模型评估
    taskProfile: { creativity: "deterministic", outputLength: "minimal" },
  });

  switch (complexity.data?.level) {
    case "simple":
      // 跳过 Leader 规划，使用预设维度模板
      return this.quickResearch(topic);
    case "moderate":
      // Leader 规划，但用 moderate reasoning
      return this.standardResearch(topic, "moderate");
    case "complex":
      // 完整 Leader 规划 + deep reasoning
      return this.fullResearch(topic, "deep");
  }
}
```

---

## 附录 A: 影响文件清单

### AI Engine 层（核心改动）

| 文件                                                          | 改动类型    | 涉及优化项             |
| ------------------------------------------------------------- | ----------- | ---------------------- |
| `ai-engine/llm/types/task-profile.types.ts`                   | 类型扩展    | P0-1, P1-1             |
| `ai-engine/llm/services/task-profile.types-mapper.service.ts` | 映射逻辑    | P0-1                   |
| `ai-engine/llm/services/ai-api-caller.service.ts`             | API 构建    | P0-1, P0-2, P1-1, P1-2 |
| `ai-engine/llm/services/ai-chat.service.ts`                   | 响应解析    | P0-2, P1-1             |
| `ai-engine/facade/types/facade.types.ts`                      | 请求类型    | P0-2, P1-2, P2-1       |
| `ai-engine/facade/domain/chat.facade.ts`                      | Facade 方法 | P1-2, P2-1             |
| `ai-engine/facade/index.ts`                                   | 类型导出    | P0-1, P1-1             |

### Topic Insights 层（消费侧适配）

| 文件                                                             | 改动类型             | 涉及优化项 |
| ---------------------------------------------------------------- | -------------------- | ---------- |
| `topic-insights/services/core/leader/leader-planning.service.ts` | 参数调整             | P0-1, P0-2 |
| `topic-insights/services/core/leader/leader-review.service.ts`   | 参数调整             | P0-1       |
| `topic-insights/services/dimension/section-writer.service.ts`    | 参数调整 + Citations | P0-2, P1-1 |
| `topic-insights/services/report/report-synthesis.service.ts`     | 参数调整 + 流式      | P0-2, P2-3 |
| `topic-insights/services/quality/critique-refine.service.ts`     | 参数调整             | P0-1       |
| `topic-insights/prompts/*.ts`                                    | XML 重构             | P2-2       |

### 其他 AI App 模块受益示例（平台级增强上线后）

| 模块            | 可直接使用的平台能力        | 使用方式                                              |
| --------------- | --------------------------- | ----------------------------------------------------- |
| **AI Research** | reasoningDepth, cachePolicy | Deep Dive 报告生成时启用 `reasoningDepth: "deep"`     |
| **AI Teams**    | reasoningDepth              | 辩论评审、共识总结时启用 `reasoningDepth: "moderate"` |
| **AI Writing**  | cachePolicy, outputSchema   | 长文写作时缓存 system prompt；大纲生成用 strict JSON  |
| **AI Office**   | cachePolicy                 | PPT/Doc 生成时同一模板多 slide 共享缓存               |
| **AI Ask**      | reasoningDepth              | 复杂问答时自动启用深度推理                            |

> 以上模块仅需在调用 `chatFacade.chat()` / `chatWithSkills()` 时添加对应参数，无需其他改动。

### 实施顺序建议

```
Phase 1（1-2 周）: P0-1 + P0-2 [平台级]
  → AI Engine 类型扩展 + Mapper + API Caller
  → Topic Insights 3 处调用添加 reasoningDepth
  → Topic Insights 所有 chatWithSkills 添加 cachePolicy
  → ★ 完成后，所有 AI App 模块即可使用 reasoningDepth + cachePolicy

Phase 2（2-3 周）: P1-2 [平台级] + P1-1 [TI 专属]
  → chatStructured strict mode (平台级，所有模块受益)
  → ContentPart 扩展 DocumentContentPart
  → API Caller 处理 document / strict schema
  → Section Writer 使用 document-based citations

Phase 3（3-4 周）: P2-1 + P2-2 + P2-3 [TI 专属]
  → Tool Use 定义 + agentic loop
  → Prompt XML 重构（逐文件，需要 eval 验证）
  → Report Synthesis 流式输出

Phase 4（持续）: P3-1 + P3-2 [TI 首创，可复用]
  → Eval dataset 构建
  → Complexity routing 实现
  → 其他模块按需接入
```

---

## 附录 B: 各提供商能力矩阵

| 能力              |     Anthropic Claude     | OpenAI GPT/o-series  |    Google Gemini    | DeepSeek |  Grok  |
| ----------------- | :----------------------: | :------------------: | :-----------------: | :------: | :----: |
| Extended Thinking |     `thinking` 参数      |  `reasoning_effort`  |  `thinkingConfig`   |   自动   |   ❌   |
| Prompt Caching    |     `cache_control`      |   自动（无需参数）   | Context Caching API |    ❌    |   ❌   |
| Native Citations  | `citations: { enabled }` |          ❌          |         ❌          |    ❌    |   ❌   |
| Structured Output |   `json_schema` format   | `json_schema` format |  `responseSchema`   |    ❌    |   ❌   |
| Tool Use (strict) |    ✅ `strict: true`     |  ✅ `strict: true`   |         ✅          |    ✅    |   ❌   |
| Streaming         |          ✅ SSE          |        ✅ SSE        |       ✅ SSE        |  ✅ SSE  | ✅ SSE |

> 表中 ❌ 不代表完全不支持，而是不支持与 Anthropic 等价的原生特性。API Caller 对不支持的特性应静默忽略（不报错）。

---

**文档状态**: 初版
**作者**: Claude Code
**最后更新**: 2026-03-17

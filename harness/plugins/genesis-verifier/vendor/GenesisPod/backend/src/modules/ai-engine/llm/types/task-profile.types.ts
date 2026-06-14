/**
 * TaskProfile - AI App 使用语义化任务描述，AI Engine 处理参数映射
 *
 * 设计原则：
 * - AI App 层描述任务需求（WHAT）
 * - AI Engine 层处理模型细节（HOW）
 *
 * 使用示例：
 * ```typescript
 * // 推荐方式：使用 TaskProfile
 * await aiChatService.chat({
 *   messages,
 *   modelType: AIModelType.CHAT,
 *   taskProfile: {
 *     creativity: "low",        // 分析任务需要低创意
 *     outputLength: "medium",   // 中等长度输出
 *   },
 * });
 *
 * // 兼容方式：直接参数（优先级最高）
 * await aiChatService.chat({
 *   messages,
 *   temperature: 0.3,
 *   maxTokens: 4000,
 * });
 * ```
 */

/**
 * 创意度等级 - AI Engine 映射到 temperature 等参数
 *
 * | 等级 | temperature | 适用场景 |
 * |------|-------------|----------|
 * | deterministic | 0.1 | 分类、提取、JSON 解析 |
 * | low | 0.3 | 分析、总结、评估 |
 * | medium | 0.7 | 对话、研究、规划 |
 * | high | 0.9 | 创意写作、头脑风暴 |
 */
export type CreativityLevel = "deterministic" | "low" | "medium" | "high";

/**
 * 输出长度等级 - AI Engine 映射到 maxTokens
 *
 * | 等级 | maxTokens | 适用场景 |
 * |------|-----------|----------|
 * | minimal | 500 | 是/否判断、分类标签 |
 * | short | 1500 | 摘要、简短回复 |
 * | medium | 4000 | 详细分析、标准对话 |
 * | standard | 6000 | 中长内容、编辑任务 |
 * | long | 8000 | 报告、章节、全面分析 |
 * | extended | 16000 | 超长内容、推理模型 |
 */
export type OutputLengthLevel =
  | "minimal"
  | "short"
  | "medium"
  | "standard"
  | "long"
  | "extended";

/**
 * 任务类型 - 辅助参数优化（Phase 2 实现）
 */
export type TaskType =
  | "extraction" // 实体提取、解析
  | "analysis" // 深度分析、评估
  | "conversation" // 对话、问答
  | "writing" // 内容创作
  | "reflection"; // 自我评估、元认知

/**
 * TaskKind — 任务语义标签（影响参数映射，如 outputLength / temperature）。
 *
 * ★ 2026-05-21：历史上 TaskProfileMapperService.pickModelType() 曾按 taskKind 把
 * review / sanity-check / classify / summarize 自动路由到 CHAT_FAST —— 该路由是
 * **死代码（无任何生产调用方）已删除**。模型档位现由单一权威
 * resolveEffectiveModelType（ai-engine/llm/models/selection/model-policy.ts）按
 * downgradePolicy 统一裁决，taskKind 不再决定用哪个模型档。
 */
export type TaskKind =
  | "review"
  | "sanity-check"
  | "classify"
  | "summarize"
  | "plan"
  | "write"
  | "research";

/**
 * 输出格式 - 影响 temperature 调整（Phase 2 实现）
 */
export type OutputFormat =
  | "json" // 结构化 JSON（需要更低 temperature）
  | "markdown" // 格式化 Markdown
  | "plaintext" // 纯文本
  | "text"; // 纯文本（别名，兼容 facade.types.ts）

/**
 * 推理深度等级
 *
 * | 等级 | OpenAI reasoning_effort | 适用场景 |
 * |------|------------------------|----------|
 * | light | low | 简单分类、快速判断 |
 * | moderate | medium | 分析、审核、规划 |
 * | deep | high | 复杂推理、多步骤规划、因果分析 |
 */
/**
 * ReasoningDepth — task profile 抽象的"该思考多久"
 *   - "minimal": 最省 token，gpt-5 系列特有，reasoning < 1k tokens
 *   - "light":   低 effort，reasoning ~ 1-5k tokens
 *   - "moderate": 中 effort，reasoning ~ 5-15k tokens
 *   - "deep":    高 effort，reasoning ~ 15-50k tokens（需要复杂多步推理时用）
 */
export type ReasoningDepth = "minimal" | "light" | "moderate" | "deep";

/**
 * ReasoningDepth → OpenAI reasoning_effort 映射（共享常量）
 *
 * 所有发送 reasoning_effort 的 path 都必须用这张表，不得在调用点 hardcode "low"。
 * - ai-api-caller.callOpenAICompatibleAPI (Path A: 系统配置)
 * - ai-direct-key.generateChatCompletionWithKey (Path B: BYOK)
 * - ai-stream-handler.streamOpenAICompatible (Stream)
 *
 * 缺省值 "low" —— 这是所有 reasoning 模型（OpenAI o1/o3/o4 + gpt-5/4.x BYOK
 * 变体 + DeepSeek / Grok-reasoning）都接受的**最低公分母**值。
 *
 * 历史教训：曾把 default 改成 "minimal" 想限制 CoT 用量，但 BYOK 上的
 * gpt-5.x 模型实际只接受 'none / low / medium / high / xhigh'，会直接报
 * INVALID_REQUEST: "Unsupported value: 'reasoning_effort' does not support
 * 'minimal' with this model"，让整个 mission 一启动就挂（PROVIDER_API_ERROR）。
 * minimal 只能在 caller 显式声明且**确认 model 支持**时使用。
 */
export const REASONING_DEPTH_TO_EFFORT: Record<ReasoningDepth, string> = {
  minimal: "minimal", // 仅 caller 显式 + 已知 model 支持时用，default 不要走这里
  light: "low",
  moderate: "medium",
  deep: "high",
};

/**
 * 把 ReasoningDepth 安全映射成 OpenAI reasoning_effort 字符串。
 * undefined / 未知值 → "low"（最普适的低挡，所有 reasoning 模型都接受）。
 *
 * 不再 default 到 "minimal" —— 见 REASONING_DEPTH_TO_EFFORT 注释，会让某些
 * BYOK reasoning 模型（如 gpt-5.4）直接报 INVALID_REQUEST 拒绝整次调用。
 */
export function reasoningDepthToEffort(depth?: string): string {
  if (!depth) return "low";
  return REASONING_DEPTH_TO_EFFORT[depth as ReasoningDepth] ?? "low";
}

/**
 * 已知支持 reasoning_effort='minimal' 的模型 ID 模式（白名单）。
 *
 * 不支持 minimal 的 reasoning 模型（如 gpt-5.x BYOK 部分变体、o1/o3 老版）
 * 收到 minimal 会直接 INVALID_REQUEST 拒绝，让 mission 挂。
 *
 * 默认保守：未在白名单的模型，minimal 降级到 low。
 *
 * 当前已知支持 minimal 的（基于官方文档 + 实测）：
 * - gpt-5* (官方 API，非 BYOK)
 * - gpt-4.1-mini, o3-mini, o4-mini
 * - gemini-2.5-flash-thinking
 *
 * 未来扩展：把这张表搬到 DB AIModelConfig.supportsMinimalEffort 字段。
 */
const MINIMAL_EFFORT_SUPPORTED_PATTERNS: RegExp[] = [
  /^gpt-5(?!\.\d)/, // gpt-5 / gpt-5o，但不含 gpt-5.x BYOK 变体
  /^gpt-4\.1-mini/,
  /^o3-mini/,
  /^o4-mini/,
  /^gemini-2\.5-flash-thinking/,
];

export function isMinimalEffortSupported(modelId: string | undefined): boolean {
  if (!modelId) return false;
  return MINIMAL_EFFORT_SUPPORTED_PATTERNS.some((re) => re.test(modelId));
}

/**
 * 安全把 reasoningDepth 映射成 reasoning_effort，自动降级 minimal 到 low
 * （当 model 不支持 minimal 时）。
 */
export function safeReasoningEffort(
  depth: string | undefined,
  modelId: string | undefined,
): string {
  const effort = reasoningDepthToEffort(depth);
  if (effort === "minimal" && !isMinimalEffortSupported(modelId)) {
    return "low";
  }
  return effort;
}

/**
 * 多模态内容部分 — 用于 Vision 场景（图片审查、多模态分析）
 *
 * 兼容 OpenAI / Anthropic / Google / xAI 的多模态消息格式：
 * - OpenAI: content: [{ type: "text", text }, { type: "image_url", image_url: { url } }]
 * - Anthropic: content: [{ type: "text", text }, { type: "image", source: { type: "url", url } }]
 * - Google: parts: [{ text }, { inlineData / fileData }]
 *
 * AI Engine 的 AiApiCallerService 负责将此统一格式转换为各 provider 的原生格式。
 */
export type ContentPart = TextContentPart | ImageUrlContentPart;

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageUrlContentPart {
  type: "image_url";
  image_url: {
    url: string;
    /** 图片细节级别，默认 "auto" */
    detail?: "low" | "high" | "auto";
  };
}

/**
 * 聊天消息
 * 统一类型定义，所有模块应从此处导入
 *
 * 多模态支持：
 * - content: string — 纯文本消息（默认、最常用，100% 向后兼容）
 * - contentParts?: ContentPart[] — 多模态消息（含图片 URL 等，用于 Vision 场景）
 *
 * 当 contentParts 存在时，AiApiCallerService 会优先使用 contentParts 构建 API 请求，
 * content 字段仍然需要提供（作为纯文本 fallback / 日志摘要）。
 *
 * Native function-calling 支持（layer 4/5，2026-05-07）：
 * - role: "tool" — 工具调用结果消息（前一轮 LLM 吐 tool_calls，本轮把执行结果回传）
 * - toolCallId — 与 LLM 上一轮 tool_calls[].id 配对（OpenAI tool_call_id /
 *   Anthropic tool_use_id）。callOpenAICompatibleAPI 透传到 wire 字段；
 *   callAnthropicAPI 转 content:[{type:"tool_result",tool_use_id,...}] 形态
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  /** 多模态内容部分，设置后 API 调用会使用此字段代替 content */
  contentParts?: ContentPart[];
  /** Native FC tool result 配对 id（仅 role:"tool" 用） */
  toolCallId?: string;
}

/**
 * 任务配置 - AI App 用语义化方式描述任务需求
 *
 * AI Engine 根据 TaskProfile 和选定模型的特性，
 * 自动映射为具体的模型参数（temperature, maxTokens 等）
 */
export interface TaskProfile {
  /**
   * 创意度等级
   * AI Engine 映射到 temperature 等参数
   * 不同模型的映射可能不同（某些模型不支持 temperature）
   */
  creativity?: CreativityLevel;

  /**
   * 输出长度等级
   * AI Engine 映射到 maxTokens
   * 推理模型会自动调整为更高值（至少 8000）
   */
  outputLength?: OutputLengthLevel;

  /**
   * 任务类型（Phase 2 实现）
   * 辅助 AI Engine 优化参数选择
   */
  taskType?: TaskType;

  /**
   * 任务种类 — 语义标签，影响参数映射（creativity / outputLength）。
   *
   * ★ 2026-05-21：曾经 taskKind 经 TaskProfileMapperService.pickModelType() 自动
   * 路由到 CHAT_FAST —— 该路由是死代码已删除。模型档位现由单一权威
   * resolveEffectiveModelType（ai-engine/llm/models/selection/model-policy.ts）按
   * downgradePolicy 统一裁决，taskKind 不再决定用哪个模型档。
   */
  taskKind?: TaskKind;

  /**
   * 输出格式（Phase 2 实现）
   * JSON 格式会自动降低 temperature 以确保结构稳定
   */
  outputFormat?: OutputFormat;

  /**
   * 响应格式（别名，兼容旧代码）
   * @deprecated 使用 outputFormat 替代
   */
  responseFormat?: OutputFormat;

  /**
   * 推理深度 — AI Engine 自动映射到各提供商参数：
   * - OpenAI o1/o3/o4: reasoning_effort
   * - xAI Grok reasoning: (no param needed, but affects maxTokens)
   * - Anthropic Claude: thinking config (future)
   * - Google Gemini: thinkingConfig (future)
   *
   * undefined = 不启用深度推理（默认，向后兼容）
   */
  reasoningDepth?: ReasoningDepth;
}

/**
 * 创意度到 temperature 的映射常量
 * AI Engine 内部使用，AI App 不应直接使用
 */
export const CREATIVITY_TO_TEMPERATURE: Record<CreativityLevel, number> = {
  deterministic: 0.1,
  low: 0.3,
  medium: 0.7,
  high: 0.9,
};

/**
 * 输出长度到 maxTokens 的映射常量
 * AI Engine 内部使用，AI App 不应直接使用
 */
export const OUTPUT_LENGTH_TO_TOKENS: Record<OutputLengthLevel, number> = {
  minimal: 500,
  short: 1500,
  medium: 4000,
  standard: 6000,
  long: 8000,
  extended: 16000,
};

/**
 * 推理模型的默认最小 token 数
 *
 * ★ 重要：推理模型（如 o1, o3, GPT-5.x）会将大部分 completion tokens
 * 用于内部推理（Chain of Thought），实际输出内容可能只占 10-20%。
 *
 * 例如：如果 max_completion_tokens=12000，模型可能用 12000 全部用于推理，
 * 导致 content="" 空输出。
 *
 * 不同模型系列的实际 max output tokens 差异很大：
 * - OpenAI o1/o3/o4: 65536-100000（可以放心设高）
 * - Anthropic Claude 4: 16384（硬限制）
 * - xAI Grok 4: 16384（硬限制）
 * - Google Gemini 2.5/3: 65536（可以设高）
 * - DeepSeek R1: 65536（可以设高）
 *
 * 因此不能一刀切 25000，需要根据模型实际限制动态计算。
 */
export const REASONING_MODEL_MIN_TOKENS = 25000;

/**
 * 根据模型实际 max tokens 计算推理模型的最小请求 tokens
 *
 * 策略：取模型最大值的 100%（即直接用满），因为推理模型需要尽可能多的空间，
 * 但不能超过模型的硬限制。对于高容量模型（>= 25000），使用 25000 作为下限。
 */
export function getReasoningMinTokens(
  modelMaxTokens: number | undefined,
): number {
  if (!modelMaxTokens) return REASONING_MODEL_MIN_TOKENS;
  // 模型最大值本身就是硬限制，直接使用
  return Math.min(modelMaxTokens, REASONING_MODEL_MIN_TOKENS);
}

/**
 * JSON 输出格式的最大 temperature
 * 确保输出结构稳定
 */
export const JSON_OUTPUT_MAX_TEMPERATURE = 0.3;

/**
 * 已知模型的实际最大 output tokens 限制
 *
 * ★ 用于兜底校验：即使数据库 maxTokens 配置错误，也不会超过 API 实际限制
 * 使用 Array 而非 Record，因为需要有序前缀匹配（如 gpt-4o-mini 必须在 gpt-4o 之前）
 *
 * 格式：[模型名称前缀(小写), 最大 output tokens]
 */
export const MODEL_KNOWN_LIMITS: Array<[string, number]> = [
  // OpenAI
  ["gpt-4o-mini", 16384],
  ["gpt-4o", 16384],
  ["gpt-4-turbo", 4096],
  ["gpt-4", 8192],
  ["o1-mini", 65536],
  ["o1-pro", 100000],
  ["o1", 100000],
  ["o3-mini", 65536],
  ["o3", 100000],
  ["o4-mini", 100000],
  // Anthropic
  ["claude-sonnet-4", 16384],
  ["claude-opus-4", 16384],
  ["claude-3.5-sonnet", 8192],
  ["claude-3.5-haiku", 8192],
  ["claude-3-opus", 4096],
  ["claude-3-sonnet", 8192],
  ["claude-3-haiku", 4096],
  // Google Gemini
  ["gemini-2.5", 65536],
  ["gemini-2.0", 8192],
  ["gemini-3", 65536],
  // xAI
  ["grok-3", 131072],
  ["grok-4", 16384],
  // DeepSeek
  ["deepseek-reasoner", 65536],
  ["deepseek-chat", 8192],
];

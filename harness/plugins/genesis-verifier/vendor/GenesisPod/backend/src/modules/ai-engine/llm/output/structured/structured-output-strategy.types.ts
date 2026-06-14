/**
 * Structured Output Strategy 类型定义
 *
 * 这些 strategy 字符串值与 ai_models.structured_output_strategy 列直接对应。
 * 管理员在 admin UI 配置每个模型的首选 strategy + fallbackStrategies 降级链。
 *
 * 设计原则：
 *   - 不同 provider 同名 strategy 含义可不同（json_schema 在 OpenAI 是 strict，
 *     在 DeepSeek 是 lenient）；adapter 内部按自己的 provider 实现细节
 *   - prompt 是兜底（任何 provider 都支持，但精度最差）
 *   - none 表示禁用 structured output（直返文本，调用方自行处理）
 */

export const STRUCTURED_OUTPUT_STRATEGIES = [
  "json_schema_strict", // OpenAI strict mode / Grok strict
  "json_schema", // OpenAI/Grok json_schema 但非 strict / DeepSeek-chat
  "tool_use", // Anthropic Tools API（function_calling 约束）
  "anthropic_output_config", // Anthropic native structured outputs（output_config.format，GA 2026）
  "json_mode", // response_format: { type: "json_object" }
  "gemini_response_schema", // Gemini generationConfig.responseSchema + responseMimeType
  "gbnf_grammar", // Llama.cpp / vLLM GBNF（开源本地模型）
  "prompt", // system prompt + post-parse + zod safeParse
  "none", // 禁用 structured output，直返文本
] as const;

export type StructuredOutputStrategy =
  (typeof STRUCTURED_OUTPUT_STRATEGIES)[number];

export function isStructuredOutputStrategy(
  v: unknown,
): v is StructuredOutputStrategy {
  return (
    typeof v === "string" &&
    (STRUCTURED_OUTPUT_STRATEGIES as readonly string[]).includes(v)
  );
}

/**
 * Adapter 入参：要用什么 schema、什么 strategy、当前请求的 messages 等。
 */
export interface AdaptInput {
  /** Zod schema 已经转好的 JSON Schema 对象（zodToJsonSchema 输出） */
  jsonSchema: Record<string, unknown>;
  /** schema 的语义化名称（嵌入 tool_use 名 / json_schema 的 name 字段等） */
  schemaName: string;
  /** 模型 id（某些 provider 对模型名敏感，如 DeepSeek-reasoner） */
  modelId: string;
}

/**
 * Adapter 输出：要修改的 requestBody 增量补丁，由 caller 合并到原 requestBody。
 */
export interface AdaptOutput {
  /** 要增加 / 修改的 request body 字段 */
  requestBodyPatch: Record<string, unknown>;
  /**
   * 系统提示注入（仅 prompt strategy 使用）。caller 会把这串拼到 system message
   * 末尾或 unshift 一条 system 消息。
   */
  systemPromptAddon?: string;
}

export interface PostParseInput {
  /** LLM 原始返回（content 字符串或 tool_use 块） */
  rawContent: string;
  /** 可能的 tool_use 解析结果（仅 anthropic tool_use strategy 路径） */
  toolUseBlock?: { name?: string; input?: unknown };
}

export interface PostParseOutput {
  /** 提取后的 JSON 对象（未 zod 校验，caller 自己 zod parse 兜底） */
  json: unknown;
  /** 用户是否需要 retry（如 LLM 返回了 markdown 包裹被 sanitize 过） */
  sanitized?: boolean;
}

/**
 * IStructuredOutputAdapter — 一个 strategy 对应一个 adapter 实现
 *
 * adapter 不持有 LLM HTTP client；只负责"如何构造 request" + "如何提取 JSON"。
 * caller (AiApiCallerService) 用 adapter 改写 requestBody 后发请求，再用同一
 * adapter 解析返回。
 */
export interface IStructuredOutputAdapter {
  /** Strategy id（与 ai_models.structured_output_strategy 一致） */
  readonly strategy: StructuredOutputStrategy;

  /**
   * 修改 requestBody 让 LLM 按该 strategy 输出结构化数据。
   * 返回 patch object 而不是直改原 requestBody，让 caller 显式合并。
   */
  adapt(input: AdaptInput): AdaptOutput;

  /**
   * 从 LLM 原始返回中提取 JSON。失败返 null，caller 走 fallback strategy。
   */
  postParse(input: PostParseInput): PostParseOutput | null;
}

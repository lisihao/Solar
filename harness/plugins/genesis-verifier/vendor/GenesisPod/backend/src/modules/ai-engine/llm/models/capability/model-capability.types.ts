/**
 * ModelCapabilities —— v3.1 阶段 A 数据模型
 *
 * 唯一数据载体：描述某 (provider, modelId) 在 LLM 调用层的全部能力维度。
 * v3 §3.2 字段表（enum 主导，bool 仅用于真二态）。
 *
 * 设计原则：
 *   - enum 优先（如 nativeMode 7 枚举值），永远不让运行时靠模型名 substring 判
 *   - 零业务逻辑：纯数据 + zod schema，业务派生在 ModelCapabilityService 内
 *   - 嵌套结构按维度聚合：structuredOutput / toolUse / reasoning / ...
 *
 * v3.1 阶段 A 范围：本类型不出 ai-engine/llm/models/capability + ai-engine/llm/services
 *   facade（防 ai-app 直接读 caps 再生散点 if 判断）—— 详见 v3 §3.6。
 *
 * v3.1 阶段 B 演进：本文件会被 capability_overrides JSONB 写入侧用于强校验
 *   （zod parse；拼错 TS 不编译）。
 */

import { z } from "zod";

import {
  STRUCTURED_OUTPUT_STRATEGIES,
  type StructuredOutputStrategy,
} from "../../output/structured/structured-output-strategy.types";

// ─────────────── structuredOutput 维度（v3 §3.2 #1, #2） ───────────────

/**
 * Native structured-output 模式 —— 决定 request body 里写哪种 response_format。
 *
 * 注意：这是 StructuredOutputStrategy 的子集（去掉 'none' 不算，加入"按
 * provider 自定义"位）；v3.1 阶段 A 直接复用 StructuredOutputStrategy 枚举值。
 */
export const NATIVE_STRUCTURED_OUTPUT_MODES = STRUCTURED_OUTPUT_STRATEGIES;
export type NativeStructuredOutputMode = StructuredOutputStrategy;

// ─────────────── toolUse 维度（v3 §3.2 #3, #4） ───────────────

export const TOOL_USE_MODES = [
  "openai_functions", // OpenAI/兼容 tools[] + tool_choice
  "anthropic_tools", // Anthropic Tools API（input_schema）
  "gemini_function_calling", // Gemini functionDeclarations
  "none", // 不支持
] as const;
export type ToolUseMode = (typeof TOOL_USE_MODES)[number];

// ─────────────── reasoning 维度（v3 §3.2 #5, #11） ───────────────

export const REASONING_KINDS = [
  "none",
  "reasoning_effort", // OpenAI o1/o3/o4: reasoning_effort=low|medium|high|minimal
  "thinking_budget", // Anthropic Claude extended-thinking: thinking.budget_tokens
  "extended_thinking", // Anthropic Sonnet 3.7+ thinking block
  "opaque", // DeepSeek-reasoner / Gemini-2.5: 模型自决，无显式 param
] as const;
export type ReasoningKind = (typeof REASONING_KINDS)[number];

export const REASONING_EXPOSE_CONTENTS = [
  "none", // 不暴露推理过程
  "thinking_block", // Anthropic content[].type === 'thinking'
  "reasoning_field", // DeepSeek reasoning_content / OpenAI reasoning summary
] as const;
export type ReasoningExposeContent = (typeof REASONING_EXPOSE_CONTENTS)[number];

// ─────────────── temperature 维度（v3 §3.2 #6） ───────────────

export const TEMPERATURE_SUPPORTS = [
  "full", // 0.0 ~ 2.0 自由
  "fixed_1_0", // o1 系列：API 强制 1.0，传别的值 400
  "none", // 不接受 temperature 字段
] as const;
export type TemperatureSupport = (typeof TEMPERATURE_SUPPORTS)[number];

// ─────────────── tokenParam 维度（v3 §3.2 #7） ───────────────

export const TOKEN_PARAM_NAMES = [
  "max_tokens", // OpenAI 旧 / Anthropic / 大多数 OpenAI 兼容
  "max_completion_tokens", // OpenAI 推理模型 (o1/o3/o4/gpt-5)
  "max_output_tokens", // Vertex AI（snake_case 版本）
  "maxOutputTokens", // Gemini native API（camelCase）
] as const;
export type TokenParamName = (typeof TOKEN_PARAM_NAMES)[number];

// ─────────────── vision 维度（v3 §3.2 #8） ───────────────

export const VISION_SUPPORTS = [
  "none",
  "image_url", // OpenAI-style image_url block
  "base64_only", // 仅接受 base64 data URI
  "native_multimodal", // Gemini fileData / 多模态原生
] as const;
export type VisionSupport = (typeof VISION_SUPPORTS)[number];

// ─────────────── systemPrompt 维度（v3 §3.2 #12） ───────────────

export const SYSTEM_PROMPT_PLACEMENTS = [
  "messages_array", // role:"system" 放在 messages[0]
  "top_level_system_field", // Anthropic / Gemini systemInstruction 顶层字段
  "first_user_concat", // 不支持 system，拼到首条 user 内
] as const;
export type SystemPromptPlacement = (typeof SYSTEM_PROMPT_PLACEMENTS)[number];

// ─────────────── promptCache 维度（v3 §3.2 #13, nice-to-have） ───────────────

export const PROMPT_CACHE_SUPPORTS = [
  "none",
  "anthropic_cache_control", // Anthropic cache_control: { type: "ephemeral" }
  "openai_prompt_cache", // OpenAI cached_tokens（自动）
  "gemini_cached_content", // Gemini cachedContent
] as const;
export type PromptCacheSupport = (typeof PROMPT_CACHE_SUPPORTS)[number];

// ─────────────── 复合：ModelCapabilities ───────────────

export interface ModelCapabilities {
  structuredOutput: {
    /** request body 里写哪种 response_format（'none' = 完全不支持，走 prompt） */
    nativeMode: NativeStructuredOutputMode;
    /** 首选失败按序降级；不含 nativeMode；最终兜底 'prompt' 由派生层补 */
    fallbackChain: readonly NativeStructuredOutputMode[];
  };
  toolUse: {
    mode: ToolUseMode;
    /** 单回合多 tool_call 并发 */
    parallelCalls: boolean;
  };
  reasoning: {
    kind: ReasoningKind;
    exposeContent: ReasoningExposeContent;
  };
  temperature: {
    support: TemperatureSupport;
  };
  /** request body token 上限 key 名 */
  tokenParam: TokenParamName;
  vision: {
    support: VisionSupport;
  };
  streaming: {
    support: boolean;
  };
  context: {
    /** prompt 上限 */
    maxInputTokens: number;
    /** completion 上限 */
    maxOutputTokens: number;
  };
  systemPrompt: {
    placement: SystemPromptPlacement;
  };
  promptCache: {
    support: PromptCacheSupport;
  };
}

// ─────────────── zod schema（B 阶段 capability_overrides 写入侧用） ───────────────

// v3.1 阶段 A review (2026-05-24)：每个 enum schema 通过 z.ZodType<ConcreteEnum>
// 保留字面量联合（不是 string），让顶层 schema 能 satisfies z.ZodType<ModelCapabilities>
// 严校（拼错字段名 TS 不编译）。

const nativeModeSchema: z.ZodType<NativeStructuredOutputMode> = z.enum(
  NATIVE_STRUCTURED_OUTPUT_MODES as readonly [string, ...string[]],
) as z.ZodType<NativeStructuredOutputMode>;
const toolUseModeSchema: z.ZodType<ToolUseMode> = z.enum(
  TOOL_USE_MODES as readonly [string, ...string[]],
) as z.ZodType<ToolUseMode>;
const reasoningKindSchema: z.ZodType<ReasoningKind> = z.enum(
  REASONING_KINDS as readonly [string, ...string[]],
) as z.ZodType<ReasoningKind>;
const reasoningExposeSchema: z.ZodType<ReasoningExposeContent> = z.enum(
  REASONING_EXPOSE_CONTENTS as readonly [string, ...string[]],
) as z.ZodType<ReasoningExposeContent>;
const temperatureSupportSchema: z.ZodType<TemperatureSupport> = z.enum(
  TEMPERATURE_SUPPORTS as readonly [string, ...string[]],
) as z.ZodType<TemperatureSupport>;
const tokenParamSchema: z.ZodType<TokenParamName> = z.enum(
  TOKEN_PARAM_NAMES as readonly [string, ...string[]],
) as z.ZodType<TokenParamName>;
const visionSupportSchema: z.ZodType<VisionSupport> = z.enum(
  VISION_SUPPORTS as readonly [string, ...string[]],
) as z.ZodType<VisionSupport>;
const systemPromptPlacementSchema: z.ZodType<SystemPromptPlacement> = z.enum(
  SYSTEM_PROMPT_PLACEMENTS as readonly [string, ...string[]],
) as z.ZodType<SystemPromptPlacement>;
const promptCacheSupportSchema: z.ZodType<PromptCacheSupport> = z.enum(
  PROMPT_CACHE_SUPPORTS as readonly [string, ...string[]],
) as z.ZodType<PromptCacheSupport>;

/**
 * 完整 ModelCapabilities zod schema —— catalog 静态数据 + B 阶段 override 强校验。
 *
 * v3.1 阶段 A review (2026-05-24)：
 *   - 顶层 + 每个子对象 `.strict()`：拼错字段名 zod parse 直接报错（不静默漏）
 *   - 用 `satisfies z.ZodType<ModelCapabilities>` 替代 `as z.ZodType<>` cast，
 *     让 TS 严校 schema 与 interface 同步（拼错字段 TS 不编译）
 */
export const ModelCapabilitiesSchema = z
  .object({
    structuredOutput: z
      .object({
        nativeMode: nativeModeSchema,
        fallbackChain: z.array(nativeModeSchema).readonly(),
      })
      .strict(),
    toolUse: z
      .object({
        mode: toolUseModeSchema,
        parallelCalls: z.boolean(),
      })
      .strict(),
    reasoning: z
      .object({
        kind: reasoningKindSchema,
        exposeContent: reasoningExposeSchema,
      })
      .strict(),
    temperature: z
      .object({
        support: temperatureSupportSchema,
      })
      .strict(),
    tokenParam: tokenParamSchema,
    vision: z
      .object({
        support: visionSupportSchema,
      })
      .strict(),
    streaming: z
      .object({
        support: z.boolean(),
      })
      .strict(),
    context: z
      .object({
        maxInputTokens: z.number().int().nonnegative(),
        maxOutputTokens: z.number().int().nonnegative(),
      })
      .strict(),
    systemPrompt: z
      .object({
        placement: systemPromptPlacementSchema,
      })
      .strict(),
    promptCache: z
      .object({
        support: promptCacheSupportSchema,
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<ModelCapabilities>;

/**
 * v3.1 §3.3 `capability_overrides.__meta` 子对象 schema —— B.4 self-heal +
 * B.6 reverse-probe 写入；export 供 B.4 写入侧复用（不在外部重定义）。
 *
 * `.strict()`：拒未知 meta 字段，防 typo 静默漏（如 `selfHealedAtt`）。
 */
export const ModelCapabilitiesOverridesMetaSchema = z
  .object({
    autoDowngraded: z.boolean().optional(),
    selfHealedAt: z.string().optional(), // ISO 字符串
    selfHealedReason: z.string().optional(), // 短码（如 "json_schema_400"）
    lastProbeAt: z.string().optional(),
    nextProbeAt: z.string().optional(),
    probeFailCount: z.number().int().nonnegative().optional(),
    source: z
      .enum(["self-heal-user", "admin-override", "reverse-probe"])
      .optional(),
  })
  .strict();

export type ModelCapabilitiesOverridesMeta = z.infer<
  typeof ModelCapabilitiesOverridesMetaSchema
>;

/**
 * v3.1 阶段 B 用：`capability_overrides JSONB` 列 zod schema（partial / deep）。
 *
 * 任何字段都可被 override；未填字段走优先级链下一级回退。
 *
 * **严校三层**（review 2026-05-24 加固）：
 *   1. root `.strict()` —— 拒未知顶层字段（除 `__meta`）
 *   2. 每个 sub-object `.strict().partial()` —— 拒未知子字段（不静默漏 typo）
 *      顺序很重要：先 strict 再 partial，partial 不会撤掉 strict
 *   3. `__meta` 自己 `.strict()` —— 拒未知 meta 字段
 *
 * 静默漏修复（reviewer 实测发现）：
 *   - 修前：`{ reasoning: { effort: "low" } }` → 接受为 `{reasoning: {}}`（effort 被默默丢）
 *   - 修后：sub-strict 直接拒整个 override，调用方 warn + 回退（defeat L4→L3→L2 链）
 */
export const ModelCapabilitiesOverridesSchema = z
  .object({
    structuredOutput: z
      .object({
        nativeMode: nativeModeSchema.optional(),
        fallbackChain: z.array(nativeModeSchema).readonly().optional(),
      })
      .strict()
      .partial()
      .optional(),
    toolUse: z
      .object({
        mode: toolUseModeSchema.optional(),
        parallelCalls: z.boolean().optional(),
      })
      .strict()
      .partial()
      .optional(),
    reasoning: z
      .object({
        kind: reasoningKindSchema.optional(),
        exposeContent: reasoningExposeSchema.optional(),
      })
      .strict()
      .partial()
      .optional(),
    temperature: z
      .object({
        support: temperatureSupportSchema.optional(),
      })
      .strict()
      .partial()
      .optional(),
    tokenParam: tokenParamSchema.optional(),
    vision: z
      .object({
        support: visionSupportSchema.optional(),
      })
      .strict()
      .partial()
      .optional(),
    streaming: z
      .object({
        support: z.boolean().optional(),
      })
      .strict()
      .partial()
      .optional(),
    context: z
      .object({
        maxInputTokens: z.number().int().nonnegative().optional(),
        maxOutputTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .partial()
      .optional(),
    systemPrompt: z
      .object({
        placement: systemPromptPlacementSchema.optional(),
      })
      .strict()
      .partial()
      .optional(),
    promptCache: z
      .object({
        support: promptCacheSupportSchema.optional(),
      })
      .strict()
      .partial()
      .optional(),
    // v3.1 §3.3 capability_overrides JSONB `__meta` 子字段。
    // B.4 self-heal + B.6 reverse-probe 写入；root strict 会拒所以必须显式入 schema。
    // 子对象自己 strict，拒未知 meta 字段。
    __meta: ModelCapabilitiesOverridesMetaSchema.optional(),
  })
  .strict();

export type ModelCapabilitiesOverrides = z.infer<
  typeof ModelCapabilitiesOverridesSchema
>;

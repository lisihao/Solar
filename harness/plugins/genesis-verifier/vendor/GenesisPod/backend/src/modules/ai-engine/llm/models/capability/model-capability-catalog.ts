/**
 * ModelCapability Catalog —— v3.1 §3.5 数据驱动 capability defaults
 *
 * 纯数据文件（零业务逻辑）。把原 `structured-output-router.service.ts:48-135`
 * 的 PROVIDER_DEFAULT_CHAINS 17 条按 v3 §3.5 收编为 PROVIDER_CAPABILITY_DEFAULTS，
 * 并附 v3 §3.2 的 13 维度 capability 默认值。
 *
 * 匹配语义（first-match-wins）：
 *   - provider: 小写后等值比较（与 AIModelConfig.provider 一致）
 *   - modelPattern: RegExp（modelId 小写后 .test()），未填 = 仅匹配 provider
 *   - 一条规则匹配上后立即返回 capabilities（不会继续合并后续规则）
 *
 * D4 强制字段（v3.1 决议）：
 *   - rationale ≥30 字：说明"为什么 + API 行为依据"
 *   - addedBy 必填：git author email（catalog 投毒防御）
 *   - addedAt 必填：ISO date（投毒回溯）
 *   - sourceUrl 选填：避免逼造假
 *
 * 范围：本文件**仅**被 `ModelCapabilityService.resolveCapabilities()` 读取，
 *   禁止其它业务文件 import（contract spec 看护）。
 *
 * v3.1 阶段 A 数据来源：
 *   - 17 条全部源自 router PROVIDER_DEFAULT_CHAINS 1:1 映射（chain → fallbackChain）
 *   - 其它维度（temperature / tokenParam / vision / ...）按 provider 官方文档
 *     2026-05 现状填写
 *
 * 演进策略：
 *   - 新增模型：加新条目，rationale 写明"为什么"
 *   - 已知模型行为变化：改对应条目 + 在 commit message 注明 provider 文档链接
 *   - 阶段 D6 删 5 个 supports_* bool 列后：本文件无变化（catalog 与 19 列正交）
 */

import type { ModelCapabilities } from "./model-capability.types";

/**
 * 单条 catalog 规则。
 *
 * - `provider` 必填（小写比较），与 `AIModelConfig.provider` 同语义
 * - `modelPattern` 选填（小写 .test()），用于在同 provider 下区分子模型
 *   （如 deepseek-reasoner 与 deepseek-chat）
 * - `apiFormat` 选填（小写比较，v3.1 §B+.1 加）。当 AIModelConfig.apiFormat
 *   存在时（admin / BYOK 填了 ai_models.apiFormat），matchCatalog 优先做
 *   apiFormat-priority pass —— 但**仅当 entry 同时带 modelPattern** 才参与
 *   apiFormat-priority 匹配，否则降到 provider-priority 路径。这样
 *   `apiFormat='openai'` 这种粗匹配字段不会让任意 modelId 误命中第一条 openai-compat 规则。
 * - `capabilities` 是 Partial：未填字段由上层 service 用 SAFE_DEFAULTS 兜底
 */
export interface ProviderCapabilityRule {
  readonly provider: string;
  readonly modelPattern?: RegExp;
  readonly apiFormat?: string;
  readonly capabilities: Partial<ModelCapabilities>;
  readonly rationale: string;
  readonly addedBy: string;
  readonly addedAt: string; // ISO date
  readonly sourceUrl?: string;
}

/**
 * 由原 router PROVIDER_DEFAULT_CHAINS 整理得 17 条 + 同维度上的官方 API 行为。
 *
 * **顺序要求**：modelPattern 更具体的条目放前面（first-match-wins）。
 * 例如 deepseek-reasoner 在 deepseek-chat 之前；openrouter claude/gemini 在
 * openrouter generic 之前。
 */
export const PROVIDER_CAPABILITY_DEFAULTS: readonly ProviderCapabilityRule[] = [
  // ─────────── 1. Anthropic Claude 4.5+（native structured outputs，GA 2026） ───────────
  {
    provider: "anthropic",
    modelPattern: /(?:opus|sonnet|haiku)-4-[5-9]/,
    capabilities: {
      structuredOutput: {
        nativeMode: "anthropic_output_config",
        fallbackChain: ["tool_use"],
      },
      toolUse: { mode: "anthropic_tools", parallelCalls: true },
      reasoning: { kind: "extended_thinking", exposeContent: "thinking_block" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "top_level_system_field" },
      promptCache: { support: "anthropic_cache_control" },
    },
    rationale:
      "Claude 4.5+（Opus 4.5/4.6/4.7、Sonnet 4.5/4.6、Haiku 4.5）2026-05 起 GA 支持 native structured outputs：output_config.format={type:'json_schema',schema}，schema 编译成 grammar 约束 token 生成，首次即保证合规，比 tool_use 模拟更可靠；不需 beta header（anthropic-version:2023-06-01）。降级链 native→tool_use→prompt，配合 in-request 当次降级(A)，catalog 漂移或个别模型不支持也不会崩。",
    addedBy: "hello@gens.team",
    addedAt: "2026-05-25",
    sourceUrl:
      "https://platform.claude.com/docs/en/build-with-claude/structured-outputs",
  },
  // ─────────── 2. Anthropic Claude（旧模型兜底：3.x / 4.0-4.4 走 tool_use） ───────────
  {
    provider: "anthropic",
    capabilities: {
      structuredOutput: { nativeMode: "tool_use", fallbackChain: [] },
      toolUse: { mode: "anthropic_tools", parallelCalls: true },
      reasoning: { kind: "extended_thinking", exposeContent: "thinking_block" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "top_level_system_field" },
      promptCache: { support: "anthropic_cache_control" },
    },
    rationale:
      "Anthropic Claude 不支持 native json_schema response_format，结构化输出必须走 tool_use（input_schema 约束 function calling）；system 走顶层 system 字段而非 messages[]；支持 prompt-cache cache_control。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://docs.anthropic.com/en/api/messages",
  },
  // ─────────── 3. Claude 别名 + 4.5+（native structured outputs） ───────────
  {
    provider: "claude",
    modelPattern: /(?:opus|sonnet|haiku)-4-[5-9]/,
    capabilities: {
      structuredOutput: {
        nativeMode: "anthropic_output_config",
        fallbackChain: ["tool_use"],
      },
      toolUse: { mode: "anthropic_tools", parallelCalls: true },
      reasoning: { kind: "extended_thinking", exposeContent: "thinking_block" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "top_level_system_field" },
      promptCache: { support: "anthropic_cache_control" },
    },
    rationale:
      "Provider 字段写作 'claude' 的 Claude 4.5+ 模型与 anthropic 同 API 同能力——native structured outputs(output_config.format) GA；与上面 anthropic 4.5+ 条目保持一致，避免别名路径回落到旧 tool_use。降级链 native→tool_use→prompt。",
    addedBy: "hello@gens.team",
    addedAt: "2026-05-25",
    sourceUrl:
      "https://platform.claude.com/docs/en/build-with-claude/structured-outputs",
  },
  // ─────────── 4. Claude 别名（旧模型兜底：3.x / 4.0-4.4 走 tool_use） ───────────
  {
    provider: "claude",
    capabilities: {
      structuredOutput: { nativeMode: "tool_use", fallbackChain: [] },
      toolUse: { mode: "anthropic_tools", parallelCalls: true },
      reasoning: { kind: "extended_thinking", exposeContent: "thinking_block" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "top_level_system_field" },
      promptCache: { support: "anthropic_cache_control" },
    },
    rationale:
      "Provider 字段写作 'claude' 时（部分 BYOK 路径直接写模型家族名）与 anthropic 行为一致——同协议同 API 同能力矩阵；保留独立条目避免 fallback 到 SAFE_DEFAULTS。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 3. Google Gemini ───────────
  {
    provider: "google",
    capabilities: {
      structuredOutput: {
        nativeMode: "gemini_response_schema",
        fallbackChain: ["json_mode"],
      },
      toolUse: { mode: "gemini_function_calling", parallelCalls: true },
      reasoning: { kind: "opaque", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "maxOutputTokens",
      vision: { support: "native_multimodal" },
      streaming: { support: true },
      systemPrompt: { placement: "top_level_system_field" },
      promptCache: { support: "gemini_cached_content" },
    },
    rationale:
      "Gemini native API 用 generationConfig.responseSchema + responseMimeType=application/json 实现结构化输出；token 上限字段 camelCase maxOutputTokens；systemInstruction 顶层；2.5 系列推理为 opaque（无显式 thinking budget）。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://ai.google.dev/api/generate-content#generation_config",
  },
  // ─────────── 4. Gemini provider 别名 ───────────
  {
    provider: "gemini",
    capabilities: {
      structuredOutput: {
        nativeMode: "gemini_response_schema",
        fallbackChain: ["json_mode"],
      },
      toolUse: { mode: "gemini_function_calling", parallelCalls: true },
      reasoning: { kind: "opaque", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "maxOutputTokens",
      vision: { support: "native_multimodal" },
      streaming: { support: true },
      systemPrompt: { placement: "top_level_system_field" },
      promptCache: { support: "gemini_cached_content" },
    },
    rationale:
      "Provider 字段写作 'gemini'（部分 BYOK 路径直接写）与 google 行为一致——同 native API 同能力矩阵；保留别名条目避免回落 SAFE_DEFAULTS。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 5. DeepSeek Reasoner（特殊：不支持 response_format） ───────────
  {
    provider: "deepseek",
    modelPattern: /reasoner/,
    apiFormat: "openai",
    capabilities: {
      structuredOutput: { nativeMode: "none", fallbackChain: [] },
      toolUse: { mode: "none", parallelCalls: false },
      reasoning: { kind: "opaque", exposeContent: "reasoning_field" },
      temperature: { support: "none" },
      tokenParam: "max_tokens",
      vision: { support: "none" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "deepseek-reasoner（DeepSeek-R1 / DeepSeek-V4-Flash thinking mode）官方明确不支持 response_format 字段（API 直接 INVALID_REQUEST），结构化输出必须走 prompt + 系统约束；推理 token 走 reasoning_content 单独字段暴露；不接受 temperature/tools。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://api-docs.deepseek.com/guides/reasoning_model",
  },

  // ─────────── 6. DeepSeek V4-Pro（json_object only；API 现状不支持 json_schema） ───────────
  {
    provider: "deepseek",
    modelPattern: /v4[-_]?pro/,
    apiFormat: "openai",
    capabilities: {
      structuredOutput: { nativeMode: "json_mode", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "opaque", exposeContent: "reasoning_field" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "none" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "DeepSeek-V4-Pro（2026-05 现状）API 不支持 json_schema，发 response_format.type=json_schema 直接被拒；仅支持 json_object 模式；尽管模型支持思考，但默认请求路径走 json_object 安全可用——这是 2026-05-24 线上事故根因（之前 isDeepseekReasoner=false 误判走 json_schema）。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://api-docs.deepseek.com/",
  },

  // ─────────── 7. DeepSeek catch-all（V4-Flash 等；json_object only，不支持 json_schema） ───────────
  {
    provider: "deepseek",
    capabilities: {
      structuredOutput: {
        // ★ 2026-05-25 线上事故修：DeepSeek 官方 API 只支持 response_format
        //   {type:"json_object"}，不支持 {type:"json_schema"}（发了直接
        //   INVALID_REQUEST "response_format type is unavailable"）。原默认
        //   json_schema 让 deepseek-v4-flash（既不匹配 /reasoner/ 也不匹配
        //   /v4-pro/）掉进本 catch-all 后发 json_schema 崩溃。改 json_mode。
        nativeMode: "json_mode",
        fallbackChain: [],
      },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "none" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "DeepSeek（2026-05 现状仅 V4-Flash + V4-Pro）API 只支持 response_format {type:'json_object'}，不支持 {type:'json_schema'}（OpenAI strict 风格）；严格 schema 仅经 tool_use/function-calling 提供。结构化输出走 json_mode → prompt 兜底。本条覆盖所有未被前面 /reasoner/、/v4-pro/ 命中的 DeepSeek 模型（含 v4-flash）。官方依据 https://api-docs.deepseek.com/guides/json_mode。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://api-docs.deepseek.com/guides/json_mode",
  },

  // ─────────── 8. OpenAI（含 GPT-4o / o1 / o3） ───────────
  {
    provider: "openai",
    capabilities: {
      structuredOutput: {
        nativeMode: "json_schema_strict",
        fallbackChain: ["json_schema", "json_mode"],
      },
      toolUse: { mode: "openai_functions", parallelCalls: true },
      reasoning: { kind: "reasoning_effort", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "openai_prompt_cache" },
    },
    rationale:
      "OpenAI 全系支持 json_schema strict（response_format.type=json_schema + strict:true，2024 末发布）；GPT-4o 支持 temperature 全量，o1/o3 系列由 isReasoning 列与本条 reasoning.kind=reasoning_effort 共同表达（reasoning_effort param 注入按 isReasoning 列判，本字段告诉调用方该模型 kind）。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://platform.openai.com/docs/guides/structured-outputs",
  },

  // ─────────── 9. xAI Grok ───────────
  {
    provider: "xai",
    capabilities: {
      structuredOutput: {
        nativeMode: "json_schema_strict",
        fallbackChain: ["json_schema", "json_mode"],
      },
      toolUse: { mode: "openai_functions", parallelCalls: true },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "xAI Grok（grok-2 / grok-3）走 OpenAI-compatible API，支持 json_schema strict；端点格式与 OpenAI 一致；reasoning kind 视具体模型（grok-3-reasoning 走 reasoning_effort，本条默认 'none' 给标准 grok-2/3）。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://docs.x.ai/api",
  },
  // ─────────── 10. Grok provider 别名 ───────────
  {
    provider: "grok",
    capabilities: {
      structuredOutput: {
        nativeMode: "json_schema_strict",
        fallbackChain: ["json_schema", "json_mode"],
      },
      toolUse: { mode: "openai_functions", parallelCalls: true },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "Provider 字段写作 'grok'（部分 BYOK 路径直接写模型家族名）与 xai 行为一致——同 API 同能力矩阵；保留别名条目避免回落 SAFE_DEFAULTS。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 11. 本地 / 开源（Ollama / vLLM / TGI / Llama.cpp / LMStudio） ───────────
  {
    provider: "ollama",
    capabilities: {
      structuredOutput: { nativeMode: "gbnf_grammar", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "Ollama 走本地 llama.cpp 后端，最佳结构化输出方式是 GBNF grammar（一定输出合法 JSON，无须 prompt 哄）；不同模型支持 vision 程度不一，默认按 llava 类支持 image_url。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },
  {
    provider: "vllm",
    capabilities: {
      structuredOutput: { nativeMode: "gbnf_grammar", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "none" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "vLLM 0.6+ 支持 guided_grammar（GBNF），是最可靠的结构化输出方式；OpenAI-compatible API 但 response_format json_schema 支持不一致（不同模型行为差异大），默认走 GBNF 兜底 prompt。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 12. ByteDance Doubao / 火山方舟 ───────────
  {
    provider: "bytedance",
    capabilities: {
      structuredOutput: { nativeMode: "json_mode", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "ByteDance Doubao / 火山方舟（volcengine）走 OpenAI-compatible 端点，结构化输出仅支持 json_object 模式（type=json_object），无 json_schema strict；与 Volcengine Ark Runtime 行为一致。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 13. Zhipu GLM ───────────
  {
    provider: "zhipu",
    capabilities: {
      structuredOutput: { nativeMode: "json_mode", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "智谱 GLM-4 系列（OpenAI-compatible API）仅支持 json_object 模式输出，无 json_schema strict；CogVLM 系列支持 image_url 视觉输入；端点路径 /api/paas/v4/chat/completions 与 OpenAI 一致。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 14. Groq（hosted Llama / Mixtral） ───────────
  {
    provider: "groq",
    capabilities: {
      structuredOutput: { nativeMode: "json_mode", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: true },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "none" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "Groq（hosted Llama-3 / Mixtral / Gemma 推理加速）走 OpenAI-compatible 端点，结构化输出走 json_object（response_format type=json_object）；不支持 vision；速度极快但不支持 json_schema strict。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://console.groq.com/docs/api-reference",
  },

  // ─────────── 15. OpenRouter Claude 二级匹配 ───────────
  {
    provider: "openrouter",
    modelPattern: /claude|anthropic/,
    capabilities: {
      structuredOutput: { nativeMode: "tool_use", fallbackChain: [] },
      toolUse: { mode: "anthropic_tools", parallelCalls: true },
      reasoning: { kind: "extended_thinking", exposeContent: "thinking_block" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "OpenRouter 代理 anthropic/claude-* 模型时透传到 Anthropic 真实 API，结构化输出必须走 tool_use（与 native Anthropic 一致）；OpenRouter 自身的 prompt-cache header 与 native cache_control 不互通，default 关；systemPrompt 走 messages_array（OpenRouter 适配层）。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 16. OpenRouter Gemini 二级匹配 ───────────
  {
    provider: "openrouter",
    modelPattern: /gemini/,
    capabilities: {
      structuredOutput: {
        nativeMode: "gemini_response_schema",
        fallbackChain: ["json_mode"],
      },
      toolUse: { mode: "gemini_function_calling", parallelCalls: true },
      reasoning: { kind: "opaque", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "native_multimodal" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "OpenRouter 代理 google/gemini-* 时透传 Gemini native API，结构化输出走 responseSchema；OpenRouter 适配层把 maxOutputTokens 映射为 max_tokens（与 native Gemini 不同，本条覆盖此差异）；systemPrompt 走 messages_array。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 17. OpenRouter 通用兜底 ───────────
  {
    provider: "openrouter",
    capabilities: {
      structuredOutput: {
        nativeMode: "json_schema",
        fallbackChain: ["json_mode"],
      },
      toolUse: { mode: "openai_functions", parallelCalls: true },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "OpenRouter 通用模型（llama / qwen / mistral / 其它）走 OpenAI-compatible 接口，多数支持 json_schema lenient（非 strict），按 json_schema → json_mode → prompt 三级降级；本条覆盖前两条 claude/gemini 之外的全部 openrouter 路由。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 18. Mistral ───────────
  {
    provider: "mistral",
    capabilities: {
      structuredOutput: { nativeMode: "json_mode", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: true },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "Mistral API（mistral-large / mistral-small / pixtral）支持 response_format type=json_object，不支持 json_schema strict；Pixtral 支持视觉 image_url；OpenAI-compatible 端点格式。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://docs.mistral.ai/api/",
  },

  // ─────────── 19. Qwen / Alibaba DashScope ───────────
  {
    provider: "qwen",
    capabilities: {
      structuredOutput: { nativeMode: "json_mode", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "通义千问 Qwen 系列（DashScope OpenAI-compatible mode）支持 json_object 响应格式；qwen-vl 系列支持 image_url 视觉；不支持 json_schema strict；与 alibaba/dashscope 行为一致。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 20. Moonshot / Kimi ───────────
  {
    provider: "moonshot",
    capabilities: {
      structuredOutput: { nativeMode: "json_mode", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "image_url" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "Moonshot Kimi 系列（kimi-k2 / moonshot-v1-*）走 OpenAI-compatible 端点，支持 json_object 模式输出；不支持 json_schema strict；视觉模型走 image_url 协议。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
  },

  // ─────────── 21. Cohere ───────────
  {
    provider: "cohere",
    capabilities: {
      structuredOutput: { nativeMode: "none", fallbackChain: [] },
      toolUse: { mode: "openai_functions", parallelCalls: false },
      reasoning: { kind: "none", exposeContent: "none" },
      temperature: { support: "full" },
      tokenParam: "max_tokens",
      vision: { support: "none" },
      streaming: { support: true },
      systemPrompt: { placement: "messages_array" },
      promptCache: { support: "none" },
    },
    rationale:
      "Cohere Command-R 系列 generate / chat API 不支持 response_format 字段（无 json_schema 也无 json_mode），结构化输出只能走 prompt + 后解析（fallbackChain 为空，由派生层自动补 prompt 兜底）。",
    addedBy: "boris.baoxinghuai@gmail.com",
    addedAt: "2026-05-23",
    sourceUrl: "https://docs.cohere.com/reference/chat",
  },
];

/**
 * SAFE_DEFAULTS —— 优先级链最后一级兜底（v3.1 §3.4 #5）。
 *
 * 当某 capability 字段在 19 列、catalog、override 都没值时用本默认。
 *
 * 设计原则（v3.1 阶段 A review 2026-05-24 注释纠正）：
 *   - **结构化输出/工具/视觉/缓存/推理维度全保守（'none'）** —— 绝不撒谎说支持，
 *     遇到未知模型走 prompt + post-parse 兜底，永远不会发送 provider 不识别的字段
 *   - **功能性维度（温度/流式）默认乐观** —— LLM API 普遍支持 temperature 参数
 *     和 SSE 流式（不支持的是极少数特例），保守关掉反而误伤大多数正常模型
 *
 * 关键：`structuredOutput.nativeMode = 'none'` —— 派生 chain 时只剩兜底 'prompt'，
 * 不会发任何 response_format 字段，安全可调任意未知模型。
 */
export const SAFE_DEFAULTS: ModelCapabilities = {
  structuredOutput: { nativeMode: "none", fallbackChain: [] },
  toolUse: { mode: "none", parallelCalls: false },
  reasoning: { kind: "none", exposeContent: "none" },
  temperature: { support: "full" },
  tokenParam: "max_tokens",
  vision: { support: "none" },
  streaming: { support: true },
  context: { maxInputTokens: 0, maxOutputTokens: 0 },
  systemPrompt: { placement: "messages_array" },
  promptCache: { support: "none" },
};

/**
 * Catalog 版本号（v3.1 §B.6 / §4.7 反向探测复原通道之一）。
 *
 * 用途：probe daemon 周期内比对代码常量与 Redis 'capability:catalog:version'，
 * 检测到代码版本 > Redis 版本时执行批量 reset —— 清掉所有
 * `__meta.autoDowngraded=true` 的 self-heal capability_overrides，让升级后的
 * catalog 重新接管能力裁决（"复原通道 #3"）。
 *
 * 规则：
 *   - 每次修改 PROVIDER_CAPABILITY_DEFAULTS（含新增/删除/调整 nativeMode 等关键字段）
 *     或 SAFE_DEFAULTS 时 +1
 *   - 仅整型单调递增，不跳号
 *   - probe daemon 首次见到 Redis 缺失时初始化为当前代码版本（不触发批量 reset）
 */
export const CATALOG_VERSION = 2;

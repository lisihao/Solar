import { AIModelType } from "@prisma/client";

/**
 * 一键 AI 配置推荐矩阵的**硬编码默认值**。
 *
 * 这是系统首次启动的 seed 数据；seed 之后，管理员可以在
 * 「/admin/ai 推荐矩阵」里编辑，service 会优先读 DB。
 *
 * 每个 patterns 是**正则字符串数组**（不是 RegExp 实例，方便 JSON 序列化 / DB 存储）。
 * 匹配时：按顺序走，第一个 `new RegExp(p, "i")` 命中的 modelId 即胜出。
 */
export interface DefaultRecommendation {
  provider: string;
  modelType: AIModelType;
  patterns: string[];
  priority: number;
  note?: string;
}

/**
 * **modelType 别名**——没有专用模型的类型直接复用另一个类型的 patterns。
 *
 * 规则：`ModelRecommendationsService.getForProvider()` 查 (provider, modelType) 时，
 * DB 和硬编码默认都没命中，而 alias 里有映射 → 拿被映射的类型 patterns 返回。
 *
 * `applyToProviders` 白名单限定只对**质量足够的 provider**生效，避免把中等
 * CHAT 模型（如 Cohere command-r-plus、Groq llama）误装成 EVALUATOR——
 * 报告打分需要 GPT-4o / Claude 3.5 Sonnet / Gemini 1.5 Pro / Grok 3 这种
 * 第一梯队。
 */
export interface ModelTypeAlias {
  aliasTo: AIModelType;
  /** 若设置则只对列表中的 provider 生效；不设置则对所有 provider 生效 */
  applyToProviders?: string[];
}

export const MODEL_TYPE_ALIASES: Partial<Record<AIModelType, ModelTypeAlias>> =
  {
    // EVALUATOR = 强 CHAT 来打分，只对质量梯队靠前的 provider 自动继承
    [AIModelType.EVALUATOR]: {
      aliasTo: AIModelType.CHAT,
      applyToProviders: ["openai", "anthropic", "google", "xai"],
    },
  };

/**
 * **一键配置 provider 质量梯队**——每个 modelType 一个有序数组，
 * 第一个能命中的 provider 胜出，**auto-configure 就此停下不再为该 type 建第二个**。
 *
 * 设计原则：
 *   - 每个类型只建一个默认行，避免列表被中等 provider 污染（如 Cohere command-r-plus 被
 *     建成 CHAT）
 *   - 排序体现质量：前面是第一梯队，后面是 fallback
 *   - 类型没列出的 provider 不会被自动创建（即使 provider 有匹配模型）。用户可手动 Add Model
 *   - RERANK 只有 Cohere/Jina/Voyage 能做；IMAGE_GENERATION 主要 OpenAI/Google
 */
export const PROVIDER_PREFERENCE_BY_TYPE: Record<AIModelType, string[]> = {
  [AIModelType.CHAT]: [
    "openai",
    "anthropic",
    "google",
    "xai",
    "deepseek",
    "qwen",
    "openrouter",
    "minimax",
  ],
  [AIModelType.CHAT_FAST]: [
    "openai",
    "anthropic",
    "google",
    "groq",
    "xai",
    "deepseek",
    "qwen",
  ],
  [AIModelType.CODE]: ["anthropic", "openai", "google"],
  [AIModelType.MULTIMODAL]: ["google", "openai", "anthropic"],
  [AIModelType.EMBEDDING]: ["openai", "voyage", "google", "cohere"],
  [AIModelType.IMAGE_GENERATION]: ["openai", "google"],
  [AIModelType.IMAGE_EDITING]: ["openai"],
  [AIModelType.RERANK]: ["cohere", "voyage"],
  [AIModelType.EVALUATOR]: ["openai", "anthropic", "google", "xai"],
};

/**
 * **全局黑名单后缀** —— 无论 provider / modelType，这些特殊变体都不参与一键配置匹配。
 * 原因：provider 的 /v1/models 里会返回一堆语音/搜索/实时/预览/图像等特殊模型，
 * 用通用 regex（如 `^gpt-4o`）会误中 `gpt-4o-search-preview`、`gpt-4o-mini-tts` 等。
 * service 在跑 firstMatch 前会先用这个列表过滤掉 availableIds。
 */
export const EXCLUDED_MODEL_SUBSTRINGS = [
  "-search",
  "-tts",
  "-audio",
  "-realtime",
  "-transcribe",
  "-preview",
  "-exp-",
  "-experimental",
  "-beta",
  "-image-", // gpt-image-*（除非明确在 IMAGE_GENERATION 里）
];

/**
 * FIX 2: Non-text-generation model ID guard.
 *
 * Returns true when the modelId looks like an image/audio/video generation
 * model that should NEVER appear in chat/text candidate pools, even if its
 * UserModelConfig.modelType was mis-stored as CHAT.
 *
 * Patterns covered:
 *   - imagine / dall-e / dall_e / imagen  (image generation families)
 *   - midjourney / stable-diffusion / flux / sora / veo / ideogram
 *   - -tts / -audio / whisper             (audio / TTS models)
 *   - -image- / -image$                   (existing EXCLUDED_MODEL_SUBSTRINGS + end anchor)
 *
 * NOT applied when the query itself is for IMAGE_GENERATION / IMAGE_EDITING
 * / EMBEDDING / RERANK — those queries legitimately want these models.
 */
export function isNonTextGenerationModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return /imagine|dall[-_]e|imagen|midjourney|stable[-_]?diffusion|sdxl|flux|sora|veo|ideogram|-tts|-audio|whisper|-image-|-image$/.test(
    lower,
  );
}

/** Model types that are TEXT-oriented; non-text models should be excluded from their pools. */
export const TEXT_MODEL_TYPES: ReadonlySet<string> = new Set([
  "CHAT",
  "CHAT_FAST",
  "CODE",
  "MULTIMODAL",
  "EVALUATOR",
]);

export const DEFAULT_RECOMMENDATIONS: DefaultRecommendation[] = [
  // ============ OpenAI ============
  // 代际通配：`^gpt-[4-9]` / `^o[1-9]` 覆盖任意代际（gpt-4/5/6/...、o1/o3/o4/...）
  // 真正的"谁最新"由 fetchOpenAIModels 按 created 时间戳降序决定，
  // pattern 只负责"属于哪一族"（CHAT / CHAT_FAST / IMAGE 等）。
  // 结合 EXCLUDED_MODEL_SUBSTRINGS 过滤掉 -search/-tts/-audio 等特殊变体。
  {
    provider: "openai",
    modelType: AIModelType.CHAT,
    patterns: ["^gpt-[4-9](?!.*-mini)(?!.*-nano)", "^o[1-9]"],
    priority: 50,
  },
  {
    provider: "openai",
    modelType: AIModelType.CHAT_FAST,
    patterns: ["^gpt-[4-9].*-mini", "^gpt-[4-9].*-nano", "^gpt-3\\.5-turbo"],
    priority: 50,
  },
  {
    provider: "openai",
    modelType: AIModelType.CODE,
    patterns: ["^gpt-[4-9](?!.*-mini)(?!.*-nano)"],
    priority: 50,
  },
  {
    provider: "openai",
    modelType: AIModelType.MULTIMODAL,
    patterns: ["^gpt-[4-9](?!.*-mini)(?!.*-nano)"],
    priority: 50,
  },
  {
    provider: "openai",
    modelType: AIModelType.EMBEDDING,
    patterns: [
      "^text-embedding-3-small",
      "^text-embedding-3-large",
      "^text-embedding-ada-002",
    ],
    priority: 50,
  },
  {
    provider: "openai",
    modelType: AIModelType.IMAGE_GENERATION,
    patterns: ["^dall-e-3", "^gpt-image-1$"],
    priority: 50,
  },
  {
    provider: "openai",
    modelType: AIModelType.IMAGE_EDITING,
    patterns: ["^dall-e-2$"],
    priority: 50,
  },

  // ============ Anthropic ============（代际通配）
  // Anthropic 自 2024-11 起提供官方 GET /v1/models，discovery 走动态发现并按
  // 版本号降序排（sortByRecencyDesc），所以 pattern 只判"族"（opus/sonnet/haiku），
  // 谁最新由 discovery 排序决定——claude-opus-4-x / claude-sonnet-4-x 自动胜出。
  {
    provider: "anthropic",
    modelType: AIModelType.CHAT,
    patterns: ["claude-opus|claude-sonnet|claude-\\d+-5-sonnet"],
    priority: 50,
  },
  {
    provider: "anthropic",
    modelType: AIModelType.CHAT_FAST,
    patterns: ["claude-.*haiku"],
    priority: 50,
  },
  {
    provider: "anthropic",
    modelType: AIModelType.CODE,
    patterns: ["claude-sonnet|claude-opus"],
    priority: 50,
  },
  {
    provider: "anthropic",
    modelType: AIModelType.MULTIMODAL,
    patterns: ["claude-sonnet|claude-opus"],
    priority: 50,
  },

  // ============ Google ============（代际通配：gemini-X-pro 任意版本）
  {
    provider: "google",
    modelType: AIModelType.CHAT,
    patterns: [
      "^gemini-\\d(\\.\\d)?-pro",
      "^gemini-\\d(\\.\\d)?-flash(?!-lite)",
    ],
    priority: 50,
  },
  {
    provider: "google",
    modelType: AIModelType.CHAT_FAST,
    patterns: ["^gemini-\\d(\\.\\d)?-flash-lite", "^gemini-\\d(\\.\\d)?-flash"],
    priority: 50,
  },
  {
    provider: "google",
    modelType: AIModelType.MULTIMODAL,
    patterns: [
      "^gemini-\\d(\\.\\d)?-pro",
      "^gemini-\\d(\\.\\d)?-flash(?!-lite)",
    ],
    priority: 50,
  },
  {
    provider: "google",
    modelType: AIModelType.EMBEDDING,
    patterns: ["^text-embedding-004", "embedding"],
    priority: 50,
  },

  // ============ xAI ============（代际通配：grok-\d 任意版本）
  {
    provider: "xai",
    modelType: AIModelType.CHAT,
    patterns: ["^grok-[2-9](?!-mini)"],
    priority: 50,
  },
  {
    provider: "xai",
    modelType: AIModelType.CHAT_FAST,
    patterns: ["^grok-[2-9]-mini"],
    priority: 50,
  },

  // ============ DeepSeek ============
  {
    provider: "deepseek",
    modelType: AIModelType.CHAT,
    patterns: ["^deepseek-chat$", "^deepseek-v3"],
    priority: 50,
  },
  {
    provider: "deepseek",
    modelType: AIModelType.CHAT_FAST,
    patterns: ["^deepseek-chat$"],
    priority: 50,
  },

  // ============ Cohere ============
  {
    provider: "cohere",
    modelType: AIModelType.CHAT,
    patterns: ["^command-r-plus"],
    priority: 50,
  },
  {
    provider: "cohere",
    modelType: AIModelType.CHAT_FAST,
    patterns: ["^command-r(?!-plus)"],
    priority: 50,
  },
  {
    provider: "cohere",
    modelType: AIModelType.RERANK,
    patterns: ["^rerank-v3\\.5", "^rerank"],
    priority: 50,
  },

  // ============ Voyage AI ============
  // 200M tokens/月免费（voyage-3-lite），用作 OpenAI text-embedding-3-small 触 429 兜底
  {
    provider: "voyage",
    modelType: AIModelType.EMBEDDING,
    patterns: ["^voyage-3-lite", "^voyage-3", "^voyage-large-2", "^voyage-"],
    priority: 60,
  },
  {
    provider: "voyage",
    modelType: AIModelType.RERANK,
    patterns: ["^rerank-2", "^rerank-1"],
    priority: 60,
  },

  // ============ Groq ============
  {
    provider: "groq",
    modelType: AIModelType.CHAT,
    patterns: ["^llama-3\\.3-70b", "^mixtral-8x7b"],
    priority: 50,
  },
  {
    provider: "groq",
    modelType: AIModelType.CHAT_FAST,
    patterns: ["^llama-3\\.3-70b", "^mixtral-8x7b", "^llama-3\\.1-8b"],
    priority: 50,
  },

  // ============ Qwen ============
  {
    provider: "qwen",
    modelType: AIModelType.CHAT,
    patterns: ["^qwen-max", "^qwen-plus"],
    priority: 50,
  },
  {
    provider: "qwen",
    modelType: AIModelType.CHAT_FAST,
    patterns: ["^qwen-turbo", "^qwen-plus"],
    priority: 50,
  },

  // ============ OpenRouter ============
  {
    provider: "openrouter",
    modelType: AIModelType.CHAT,
    patterns: ["auto$"],
    priority: 50,
  },

  // ============ MiniMax ============
  {
    provider: "minimax",
    modelType: AIModelType.CHAT,
    patterns: ["^MiniMax-Text-01"],
    priority: 50,
  },
];

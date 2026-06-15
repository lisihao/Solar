/**
 * 统一的 External Tool → Secret Name 映射
 *
 * 设计原则：
 * 1. Secret 名称使用 kebab-case，与 Secret Manager 实际存储一致
 * 2. 所有使用 Secret 的代码都必须通过此映射获取名称
 * 3. 不允许在其他地方硬编码 Secret 名称
 *
 * 命名规范：
 * - 使用 kebab-case: tavily-search-api-key
 * - 不使用 SCREAMING_SNAKE_CASE: TAVILY_API_KEY
 * - 不使用 camelCase: tavilyApiKey
 */

/**
 * External Tool ID → Secret Name 映射
 * 这是系统的唯一真相来源（Single Source of Truth）
 */
export const EXTERNAL_TOOL_SECRET_MAPPING: Record<string, string> = {
  // ==================== Web Search ====================
  tavily: "tavily-search-api-key",
  serper: "serper-api-key",
  perplexity: "perplexity-api-key",

  // ==================== Content Extraction ====================
  jina: "jina-api-key",
  firecrawl: "firecrawl-api-key",
  tavilyExtract: "tavily-extraction-api-key",

  // ==================== YouTube ====================
  supadata: "supadata-api-key",

  // ==================== TTS ====================
  elevenlabs: "elevenlabs-api-key",
  googleTts: "google-tts-api-key",

  // ==================== Skills ====================
  skillsmp: "skillsmp-api-key",

  // ==================== Policy Research ====================
  "congress-gov": "congress-gov",
  opensanctions: "opensanctions-api",

  // ==================== GitHub ====================
  "github-search": "github-token",
  "github-integration": "github-token",

  // ==================== Audio Generation ====================
  "audio-generation": "elevenlabs-api-key",

  // ==================== Academic Research ====================
  openalex: "openalex-api-key", // provider ID alias (frontend uses 'openalex')
  "openalex-search": "openalex-api-key", // registry tool ID
  "semantic-scholar": "semantic-scholar-api-key",
  pubmed: "pubmed-api-key",

  // ==================== Finance ====================
  "alpha-vantage": "alpha-vantage-api-key",
  "finance-api": "alpha-vantage-api-key", // alias: finance-api tool uses Alpha Vantage

  // ==================== Weather ====================
  "weather-api": "openweathermap-api-key",

  // ==================== Image Search ====================
  "bing-image-search": "bing-image-search-api-key",
  "google-image-search": "google-cse-api-key",
  "google-cse-engine-id": "google-cse-engine-id",
  "serpapi-image-search": "serpapi-api-key",
  "image-search": "serpapi-api-key", // aggregator uses primary provider key (SerpAPI)
};

/**
 * 便捷常量：按类别分组的 Secret 名称
 * 用于 SearchService、ExtractionService 等服务
 */
export const SECRET_NAMES = {
  // Web Search
  TAVILY_SEARCH: EXTERNAL_TOOL_SECRET_MAPPING.tavily,
  SERPER: EXTERNAL_TOOL_SECRET_MAPPING.serper,
  PERPLEXITY: EXTERNAL_TOOL_SECRET_MAPPING.perplexity,

  // Content Extraction
  JINA: EXTERNAL_TOOL_SECRET_MAPPING.jina,
  FIRECRAWL: EXTERNAL_TOOL_SECRET_MAPPING.firecrawl,
  TAVILY_EXTRACTION: EXTERNAL_TOOL_SECRET_MAPPING.tavilyExtract,

  // YouTube
  SUPADATA: EXTERNAL_TOOL_SECRET_MAPPING.supadata,

  // TTS
  ELEVENLABS: EXTERNAL_TOOL_SECRET_MAPPING.elevenlabs,
  GOOGLE_TTS: EXTERNAL_TOOL_SECRET_MAPPING.googleTts,

  // Skills
  SKILLSMP: EXTERNAL_TOOL_SECRET_MAPPING.skillsmp,

  // Policy Research
  CONGRESS_GOV: EXTERNAL_TOOL_SECRET_MAPPING["congress-gov"],
  OPENSANCTIONS: EXTERNAL_TOOL_SECRET_MAPPING.opensanctions,

  // GitHub
  GITHUB_TOKEN: EXTERNAL_TOOL_SECRET_MAPPING["github-search"],

  // Academic Research
  OPENALEX: EXTERNAL_TOOL_SECRET_MAPPING["openalex-search"],
  SEMANTIC_SCHOLAR: EXTERNAL_TOOL_SECRET_MAPPING["semantic-scholar"],
  PUBMED: EXTERNAL_TOOL_SECRET_MAPPING.pubmed,

  // Finance
  ALPHA_VANTAGE: EXTERNAL_TOOL_SECRET_MAPPING["alpha-vantage"],

  // Weather
  OPENWEATHERMAP: EXTERNAL_TOOL_SECRET_MAPPING["weather-api"],

  // Image Search
  BING_IMAGE_SEARCH: EXTERNAL_TOOL_SECRET_MAPPING["bing-image-search"],
  GOOGLE_CSE: EXTERNAL_TOOL_SECRET_MAPPING["google-image-search"],
  GOOGLE_CSE_ENGINE_ID: EXTERNAL_TOOL_SECRET_MAPPING["google-cse-engine-id"],
  SERPAPI: EXTERNAL_TOOL_SECRET_MAPPING["serpapi-image-search"],
} as const;

/**
 * Legacy 名称 → 新名称映射
 * 用于向后兼容，在 getValueInternal 中自动转换
 */
export const LEGACY_SECRET_NAME_MAPPING: Record<string, string> = {
  // 旧的 SCREAMING_SNAKE_CASE 格式 → 新的 kebab-case 格式
  TAVILY_API_KEY: SECRET_NAMES.TAVILY_SEARCH,
  SERPER_API_KEY: SECRET_NAMES.SERPER,
  PERPLEXITY_API_KEY: SECRET_NAMES.PERPLEXITY,
  JINA_API_KEY: SECRET_NAMES.JINA,
  FIRECRAWL_API_KEY: SECRET_NAMES.FIRECRAWL,
  SUPADATA_API_KEY: SECRET_NAMES.SUPADATA,
  ELEVENLABS_API_KEY: SECRET_NAMES.ELEVENLABS,
  GOOGLE_TTS_API_KEY: SECRET_NAMES.GOOGLE_TTS,
  SKILLSMP_API_KEY: SECRET_NAMES.SKILLSMP,
  CONGRESS_API_KEY: SECRET_NAMES.CONGRESS_GOV,
};

/**
 * 获取工具对应的 Secret 名称
 * @param toolId 工具 ID
 * @returns Secret 名称，如果不存在返回 null
 */
export function getSecretNameForTool(toolId: string): string | null {
  return EXTERNAL_TOOL_SECRET_MAPPING[toolId] || null;
}

/**
 * 获取 Secret 名称对应的工具 ID
 * @param secretName Secret 名称
 * @returns 工具 ID，如果不存在返回 null
 */
export function getToolIdForSecret(secretName: string): string | null {
  for (const [toolId, name] of Object.entries(EXTERNAL_TOOL_SECRET_MAPPING)) {
    if (name === secretName) return toolId;
  }
  return null;
}

/**
 * 规范化 Secret 名称
 * 如果是旧格式（SCREAMING_SNAKE_CASE），转换为新格式（kebab-case）
 * @param name 原始名称
 * @returns 规范化后的名称
 */
export function normalizeSecretName(name: string): string {
  // 如果是旧格式，转换为新格式
  if (LEGACY_SECRET_NAME_MAPPING[name]) {
    return LEGACY_SECRET_NAME_MAPPING[name];
  }
  return name;
}

/**
 * SystemSetting 键 → Secret 名称映射
 * 用于迁移脚本
 */
export const SYSTEM_SETTING_TO_SECRET_MAPPING: Array<{
  key: string;
  name: string;
  displayName: string;
  category: string;
  provider: string;
  setupGuideUrl?: string;
  freeTierAvailable: boolean;
  description?: string;
}> = [
  {
    key: "search.perplexity.apiKey",
    name: SECRET_NAMES.PERPLEXITY,
    displayName: "Perplexity API Key",
    category: "SEARCH",
    provider: "Perplexity",
    setupGuideUrl: "https://www.perplexity.ai/settings/api",
    freeTierAvailable: false,
    description: "Perplexity online search",
  },
  {
    key: "search.tavily.apiKey",
    name: SECRET_NAMES.TAVILY_SEARCH,
    displayName: "Tavily Search API Key",
    category: "SEARCH",
    provider: "Tavily",
    setupGuideUrl: "https://app.tavily.com/home",
    freeTierAvailable: true,
    description: "Web search API for AI agents",
  },
  {
    key: "search.serper.apiKey",
    name: SECRET_NAMES.SERPER,
    displayName: "Serper API Key",
    category: "SEARCH",
    provider: "Serper",
    setupGuideUrl: "https://serper.dev/api-key",
    freeTierAvailable: true,
    description: "Google search results API",
  },
  {
    key: "extraction.jina.apiKey",
    name: SECRET_NAMES.JINA,
    displayName: "Jina Reader API Key",
    category: "EXTRACTION",
    provider: "Jina",
    setupGuideUrl: "https://jina.ai/?sui=apikey",
    freeTierAvailable: true,
    description: "Web content extraction (Reader API)",
  },
  {
    key: "extraction.firecrawl.apiKey",
    name: SECRET_NAMES.FIRECRAWL,
    displayName: "Firecrawl API Key",
    category: "EXTRACTION",
    provider: "Firecrawl",
    setupGuideUrl: "https://www.firecrawl.dev/app/api-keys",
    freeTierAvailable: true,
    description: "Web scraping with JS rendering",
  },
  {
    key: "extraction.tavily.apiKey",
    name: SECRET_NAMES.TAVILY_EXTRACTION,
    displayName: "Tavily Extraction API Key",
    category: "EXTRACTION",
    provider: "Tavily",
    setupGuideUrl: "",
    freeTierAvailable: true,
    description: "Tavily content extraction (same dashboard as search)",
  },
  {
    key: "youtube.supadata.apiKey",
    name: SECRET_NAMES.SUPADATA,
    displayName: "Supadata YouTube API Key",
    category: "YOUTUBE",
    provider: "Supadata",
    setupGuideUrl: "",
    freeTierAvailable: false,
    description: "YouTube transcript API",
  },
  {
    key: "tts.elevenlabs.apiKey",
    name: SECRET_NAMES.ELEVENLABS,
    displayName: "ElevenLabs TTS API Key",
    category: "TTS",
    provider: "ElevenLabs",
    setupGuideUrl: "https://elevenlabs.io/app/settings/api-keys",
    freeTierAvailable: true,
    description: "High-quality TTS voices",
  },
  {
    key: "tts.google.apiKey",
    name: SECRET_NAMES.GOOGLE_TTS,
    displayName: "Google Cloud TTS API Key",
    category: "TTS",
    provider: "Google",
    setupGuideUrl: "",
    freeTierAvailable: true,
    description: "Google Cloud Text-to-Speech",
  },
  {
    key: "skillsmp.apiKey",
    name: SECRET_NAMES.SKILLSMP,
    displayName: "SkillsMP API Key",
    category: "SKILLSMP",
    provider: "SkillsMP",
    setupGuideUrl: "",
    freeTierAvailable: false,
    description: "Internal skills marketplace",
  },
  {
    key: "imageSearch.bing.apiKey",
    name: SECRET_NAMES.BING_IMAGE_SEARCH,
    displayName: "Bing Image Search API Key",
    category: "IMAGE_SEARCH",
    provider: "Bing",
    setupGuideUrl: "",
    freeTierAvailable: false,
    description: "Bing Image Search (deprecating)",
  },
  {
    key: "imageSearch.google.apiKey",
    name: SECRET_NAMES.GOOGLE_CSE,
    displayName: "Google Custom Search API Key",
    category: "IMAGE_SEARCH",
    provider: "Google",
    setupGuideUrl: "https://programmablesearchengine.google.com/",
    freeTierAvailable: true,
    description: "Google Custom Search Engine",
  },
  {
    key: "imageSearch.google.engineId",
    name: SECRET_NAMES.GOOGLE_CSE_ENGINE_ID,
    displayName: "Google Custom Search Engine ID",
    category: "IMAGE_SEARCH",
    provider: "Google",
    setupGuideUrl: "https://programmablesearchengine.google.com/",
    freeTierAvailable: true,
    description: "Google CSE Engine ID (paired with CSE API key)",
  },
  {
    key: "imageSearch.serpapi.apiKey",
    name: SECRET_NAMES.SERPAPI,
    displayName: "SerpAPI API Key",
    category: "IMAGE_SEARCH",
    provider: "SerpAPI",
    setupGuideUrl: "https://serpapi.com/manage-api-key",
    freeTierAvailable: true,
    description: "SerpAPI multi-engine search",
  },
];

/**
 * LLM Provider 名称模式（小写，子串匹配）
 *
 * Secret name 包含其中任一 token → 归 LLM Provider 类
 * 新增 LLM 接入时仅需在这里追加一行
 */
export const LLM_PROVIDER_NAME_PATTERNS: readonly string[] = [
  "openai",
  "claude",
  "anthropic",
  "gemini",
  "google-ai", // 区分 google-cse / google-tts
  "grok",
  "xai",
  "doubao",
  "deepseek",
  "openrouter",
  "cohere",
  "glm",
  "groq",
  "codex",
  "qwen",
  "mistral",
  "llama",
  "yi-",
  "voyage",
] as const;

/**
 * Secret 分类
 *
 * - "preset-tool": 在 SYSTEM_SETTING_TO_SECRET_MAPPING 里登记的平台工具 key
 * - "llm-provider": 名称命中 LLM_PROVIDER_NAME_PATTERNS
 * - "custom": 用户自定义（默认友好态，无警告）
 * - "orphan": 真孤儿（保留位，目前判定逻辑：在 SYSTEM_SETTING 历史登记过但已下线，本期不实现）
 */
export type SecretClassification =
  | "preset-tool"
  | "llm-provider"
  | "custom"
  | "orphan";

/**
 * 对一个 secret name 进行 4 分类
 *
 * 优先级：preset-tool > llm-provider > custom
 * orphan 保留位，本期永远不返回（需"下线工具列表"才能严格判定）
 */
export function classifySecret(name: string): SecretClassification {
  const lower = name.toLowerCase();

  // 1. preset tool（A 类）
  if (SYSTEM_SETTING_TO_SECRET_MAPPING.some((m) => m.name === name)) {
    return "preset-tool";
  }

  // 2. LLM provider（B 类）
  if (LLM_PROVIDER_NAME_PATTERNS.some((p) => lower.includes(p))) {
    return "llm-provider";
  }

  // 3. 默认归自定义（C 类，无警告）
  // orphan（D 类）暂保留位不实现 — 需要"下线工具列表"才能严格判定
  return "custom";
}

/**
 * 从 SYSTEM_SETTING_TO_SECRET_MAPPING 推导出"预期应配置的 secret"清单
 * 不查 DB，纯静态数据
 */
export function getExpectedSecretsMetadata(): Array<{
  name: string;
  displayName: string;
  category: string;
  provider: string;
  setupGuideUrl?: string;
  freeTierAvailable: boolean;
  description?: string;
  relatedToolIds: string[];
}> {
  return SYSTEM_SETTING_TO_SECRET_MAPPING.map((m) => ({
    name: m.name,
    displayName: m.displayName,
    category: m.category,
    provider: m.provider,
    setupGuideUrl: m.setupGuideUrl,
    freeTierAvailable: m.freeTierAvailable,
    description: m.description,
    relatedToolIds: Object.entries(EXTERNAL_TOOL_SECRET_MAPPING)
      .filter(([_, v]) => v === m.name)
      .map(([k]) => k),
  }));
}

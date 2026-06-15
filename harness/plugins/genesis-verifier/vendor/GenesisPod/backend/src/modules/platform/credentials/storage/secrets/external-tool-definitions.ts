import { EXTERNAL_TOOL_SECRET_MAPPING } from "./secret-name.catalog";

/**
 * External Tool 富定义
 *
 * userConfigurable 语义：
 *   true  = 用户可在 /me/tools 自配 Key（默认，不写等于 true）
 *   false = 内置/无需 Key 的工具（如 duckduckgo），前端不展示配置入口
 */
export interface ExternalToolDefinition {
  id: string;
  name: string;
  category: string;
  url: string;
  noKeyRequired?: boolean;
  freeQuota?: string;
  pricing?: string;
  /** 对应 Secret Manager 中的密钥名称 */
  secretKeyName?: string;
  /** 用户是否可在「我的工具」页自配 Key（noKeyRequired=true 的工具应显式标 false） */
  userConfigurable?: boolean;
}

/**
 * External Tools 预定义列表
 * 这些是外部 API 服务，需要配置 API 密钥
 *
 * secretKeyName 使用统一的 EXTERNAL_TOOL_SECRET_MAPPING，不允许硬编码 Secret 名称。
 * noKeyRequired=true 的工具显式标 userConfigurable: false，其余默认视为 true。
 */
export const EXTERNAL_TOOL_DEFINITIONS: ExternalToolDefinition[] = [
  // Web Search
  {
    id: "perplexity",
    name: "Perplexity",
    category: "Web Search",
    url: "https://perplexity.ai",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.perplexity,
  },
  {
    id: "tavily",
    name: "Tavily",
    category: "Web Search",
    url: "https://tavily.com",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.tavily,
  },
  {
    id: "serper",
    name: "Serper",
    category: "Web Search",
    url: "https://serper.dev",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.serper,
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    category: "Web Search",
    url: "https://duckduckgo.com",
    noKeyRequired: true,
    userConfigurable: false,
  },
  // Content Extraction
  {
    id: "jina",
    name: "Jina AI Reader",
    category: "Content Extraction",
    url: "https://jina.ai/reader",
    freeQuota: "1M tokens/month",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.jina,
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    category: "Content Extraction",
    url: "https://firecrawl.dev",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.firecrawl,
  },
  {
    id: "tavilyExtract",
    name: "Tavily Extract",
    category: "Content Extraction",
    url: "https://tavily.com",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.tavilyExtract,
  },
  // YouTube
  {
    id: "supadata",
    name: "Supadata",
    category: "YouTube",
    url: "https://supadata.ai",
    freeQuota: "100/month",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.supadata,
  },
  // TTS
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    category: "TTS",
    url: "https://elevenlabs.io",
    freeQuota: "10,000 chars/month",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.elevenlabs,
  },
  {
    id: "googleTts",
    name: "Google Cloud TTS",
    category: "TTS",
    url: "https://cloud.google.com/text-to-speech",
    freeQuota: "4M chars/month",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.googleTts,
  },
  // Skills Marketplace
  {
    id: "skillsmp",
    name: "SkillsMP",
    category: "Skills",
    url: "https://skillsmp.com",
    freeQuota: "Basic search free",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.skillsmp,
  },
  // Finance Data
  {
    id: "alpha-vantage",
    name: "Alpha Vantage",
    category: "Finance Data",
    url: "https://www.alphavantage.co",
    freeQuota: "25 requests/day",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING["alpha-vantage"],
  },
  // Academic Research
  {
    id: "arxiv-search",
    name: "ArXiv",
    category: "Academic Research",
    url: "https://arxiv.org",
    noKeyRequired: true,
    freeQuota: "3 requests/second",
    userConfigurable: false,
  },
  {
    id: "openalex-search",
    name: "OpenAlex",
    category: "Academic Research",
    url: "https://openalex.org",
    freeQuota:
      "100k requests/month (free), unlimited (with polite pool mailto)",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING["openalex-search"],
  },
  {
    id: "semantic-scholar",
    name: "Semantic Scholar",
    category: "Academic Research",
    url: "https://www.semanticscholar.org",
    freeQuota: "100 requests/5 min (free), 100 req/s (with key)",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING["semantic-scholar"],
  },
  {
    id: "pubmed",
    name: "PubMed (NCBI)",
    category: "Academic Research",
    url: "https://pubmed.ncbi.nlm.nih.gov",
    freeQuota: "3 req/s (free), 10 req/s (with key)",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING.pubmed,
  },
  // Tech Community
  {
    id: "hackernews-search",
    name: "HackerNews (Algolia)",
    category: "Tech Community",
    url: "https://hn.algolia.com",
    noKeyRequired: true,
    freeQuota: "Unlimited (recommended: 1 req/s)",
    userConfigurable: false,
  },
  // GitHub
  {
    id: "github-search",
    name: "GitHub Search",
    category: "GitHub",
    url: "https://github.com",
    freeQuota: "10 req/hour (free), 30 req/min (with token)",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING["github-search"],
  },
  // Weather
  {
    id: "weather-api",
    name: "OpenWeatherMap",
    category: "Weather",
    url: "https://openweathermap.org",
    freeQuota: "60 req/min, 1,000 req/day",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING["weather-api"],
  },
  // Policy Research
  {
    id: "federal-register",
    name: "Federal Register",
    category: "Policy Research",
    url: "https://www.federalregister.gov",
    noKeyRequired: true,
    userConfigurable: false,
  },
  {
    id: "congress-gov",
    name: "Congress.gov",
    category: "Policy Research",
    url: "https://api.congress.gov",
    freeQuota: "5,000 requests/hour",
    secretKeyName: EXTERNAL_TOOL_SECRET_MAPPING["congress-gov"],
  },
  {
    id: "whitehouse-news",
    name: "White House News",
    category: "Policy Research",
    url: "https://www.whitehouse.gov/news",
    noKeyRequired: true,
    userConfigurable: false,
  },
];

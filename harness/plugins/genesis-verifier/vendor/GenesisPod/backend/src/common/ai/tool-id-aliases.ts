export const TOOL_ID_ALIAS_TO_REGISTRY_ID: Record<string, string> = {
  tavily: "web-search",
  perplexity: "web-search",
  serper: "web-search",
  duckduckgo: "web-search",
  jina: "web-scraper",
  firecrawl: "web-scraper",
  tavilyExtract: "web-scraper",
  arxiv: "arxiv-search",
  "semantic-scholar": "semantic-scholar",
  pubmed: "pubmed",
  openalex: "openalex-search",
  hackernews: "hackernews-search",
  "github-search": "github-search",
  "industry-report": "industry-report-search",
  "federal-register": "federal-register",
  "congress-gov": "congress-gov",
  "whitehouse-news": "whitehouse-news",
  "alpha-vantage": "finance-api",
  "weather-api": "weather-api",
  elevenlabs: "audio-generation",
  googleTts: "audio-generation",
};

const REGISTRY_ID_TO_TOOL_ID_ALIASES = Object.entries(
  TOOL_ID_ALIAS_TO_REGISTRY_ID,
).reduce<Record<string, string[]>>((acc, [aliasId, registryId]) => {
  const aliases = acc[registryId] ?? [registryId];
  if (!aliases.includes(aliasId)) {
    aliases.push(aliasId);
  }
  acc[registryId] = aliases;
  return acc;
}, {});

export function getRegistryToolId(toolId: string): string {
  return TOOL_ID_ALIAS_TO_REGISTRY_ID[toolId] ?? toolId;
}

export function getToolIdAliases(toolId: string): string[] {
  const registryId = getRegistryToolId(toolId);
  const aliases = REGISTRY_ID_TO_TOOL_ID_ALIASES[registryId] ?? [registryId];

  if (toolId === registryId) {
    return aliases;
  }

  return [toolId, ...aliases.filter((id) => id !== toolId)];
}

/**
 * 2026-05-07: Provider→Registry 是 N:1 时，每个 provider 必须保留**自己的**
 * secretKey，registry 行的 secretKey 是无意义的（last-write-wins 会被随机
 * 一个 sibling 覆盖）。此 helper 用于：
 *
 * - admin updateToolConfig: 不向 multi-provider parent 同步 secretKey
 * - 前端 ToolsManagement bridge: 不从 multi-provider parent 继承 secretKey 给
 *   sibling provider（避免 Tavily 的 key 泄漏给 Perplexity / Serper / DuckDuckGo）
 *
 * 1:1 映射（arxiv→arxiv-search / pubmed→pubmed 等）继续 sync —— 那种情况
 * provider 和 parent 在语义上是同一个工具，sync 是为了与 ToolRegistry 注册名对齐。
 */
export function isMultiProviderRegistry(registryId: string): boolean {
  // alias 数组结构：[registryId, ...providerIds]，所以多 provider = aliases.length > 2
  // 同时 N:1 时 registryId !== providerId 才进得了 alias 数组（即 entry 数 ≥ 2）
  const aliases = REGISTRY_ID_TO_TOOL_ID_ALIASES[registryId];
  if (!aliases) return false;
  // 排除 registryId 本身（如果它也作为 provider 出现，比如 'github-search'）
  const providerCount = aliases.filter((id) => id !== registryId).length;
  return providerCount >= 2;
}

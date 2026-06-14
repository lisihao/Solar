/**
 * Search Result Fusion 通用工具 — Phase 8 沉淀
 *
 * 沉淀自：ai-app/{app}/services/search/fusion/result-fusion.service.ts
 * 提取**纯算法**部分（无业务类型耦合），让 consumer / 其他 ai-app 也可消费。
 *
 * 包含：
 *   - normalizeUrl: URL 归一化（去 utm_* 参数 / trailing slash / fragment）
 *   - dedupeByUrlAndTitle: 两遍去重（URL → title 词集 Jaccard）
 *   - tokenizeQuery: query 分词（去 site: filter / OR / 停用词，保留 CJK）
 *   - computeRelevanceScore: query 关键词命中评分（title 2x 权重 + 短片惩罚）
 *   - enforceDomainDiversity: 域名多样性限制
 *   - extractDomain: URL → 主域名
 *
 * 设计：
 *   - 调用方传 `IndexedItem` 接口实现（id/url/title/snippet/domain），不绑业务类型
 *   - 所有函数纯函数，无 IO，无 logger（调用方自行记录）
 */

/** 调用方需提供的最小字段集 */
export interface IndexedItem {
  url: string;
  title: string;
  snippet?: string;
  domain?: string;
}

const STOP_WORDS = new Set([
  // 中英常见停用词
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "be",
  "by",
  "this",
  "that",
  "it",
  "as",
  "from",
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "which",
  "的",
  "了",
  "是",
  "有",
  "和",
  "在",
  "我",
  "他",
  "她",
  "它",
  "们",
  "这",
  "那",
  "也",
]);

/**
 * URL 归一化（用于去重 key）
 * - 去尾 /
 * - 去 hash fragment
 * - 去 utm_/fbclid 等追踪参数
 * - lowercase host
 */
export function normalizeUrl(rawUrl: string): string {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl.trim());
    // 删除追踪参数
    const trackingPrefixes = ["utm_", "fbclid", "gclid", "mc_", "_hsenc"];
    const params = u.searchParams;
    const toDel: string[] = [];
    params.forEach((_, k) => {
      const lower = k.toLowerCase();
      if (trackingPrefixes.some((p) => lower.startsWith(p))) {
        toDel.push(k);
      }
    });
    for (const k of toDel) params.delete(k);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/+$/, "").replace(/#.*$/, "");
  }
}

/**
 * 两遍去重：先按归一化 URL，再按 title 词集 Jaccard（完全相同的词集判同）
 */
export function dedupeByUrlAndTitle<T extends IndexedItem>(items: T[]): T[] {
  const seenUrls = new Set<string>();
  const urlDeduped: T[] = [];
  for (const item of items) {
    const key = normalizeUrl(item.url);
    if (!key || seenUrls.has(key)) continue;
    seenUrls.add(key);
    urlDeduped.push(item);
  }
  const seenTitleKeys = new Set<string>();
  const titleDeduped: T[] = [];
  for (const item of urlDeduped) {
    const titleKey = (item.title ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(" ");
    if (!titleKey) {
      titleDeduped.push(item); // 无 title 不参与 title 去重
      continue;
    }
    if (seenTitleKeys.has(titleKey)) continue;
    seenTitleKeys.add(titleKey);
    titleDeduped.push(item);
  }
  return titleDeduped;
}

/**
 * Query 分词（去 site:filter / OR / 引号 / 停用词，保留 CJK）
 */
export function tokenizeQuery(query: string): string[] {
  if (!query) return [];
  const cleaned = query
    .replace(/site:\S+/gi, "")
    .replace(/\bOR\b/gi, "")
    .replace(/["']/g, "")
    .toLowerCase();
  const tokens = cleaned
    .split(/[\s,;|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  return [...new Set(tokens)];
}

/**
 * 0-1 之间的相关性评分。
 * - title 命中权重 0.6，snippet 命中权重 0.4
 * - 完整 query 字符串在 title 中精确出现 +0.15
 * - title+snippet 总长 < 50 字符时 ×0.5（低质量惩罚）
 */
export function computeRelevanceScore<T extends IndexedItem>(
  item: T,
  query: string,
): number {
  if (!query) return 0.5;
  const queryTerms = tokenizeQuery(query);
  if (queryTerms.length === 0) return 0.5;

  const titleLower = (item.title || "").toLowerCase();
  const snippetLower = (item.snippet || "").toLowerCase();
  const combined = titleLower + " " + snippetLower;

  let titleHits = 0;
  let snippetHits = 0;
  for (const term of queryTerms) {
    if (titleLower.includes(term)) titleHits++;
    if (snippetLower.includes(term)) snippetHits++;
  }
  const titleCoverage = titleHits / queryTerms.length;
  const snippetCoverage = snippetHits / queryTerms.length;
  let score = titleCoverage * 0.6 + snippetCoverage * 0.4;

  const queryLower = query.toLowerCase().trim();
  if (queryLower.length > 5 && titleLower.includes(queryLower)) {
    score = Math.min(1.0, score + 0.15);
  }
  if (combined.length < 50) score *= 0.5;
  return Math.max(0, Math.min(1.0, score));
}

/**
 * 提取域名（无 www. / lowercase）
 */
export function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/**
 * 域名多样性约束：每个域名最多保留 maxPerDomain 条（按输入顺序优先）
 */
export function enforceDomainDiversity<T extends IndexedItem>(
  items: T[],
  maxPerDomain = 3,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const d = item.domain ?? extractDomain(item.url);
    const c = counts.get(d) ?? 0;
    if (c < maxPerDomain) {
      out.push(item);
      counts.set(d, c + 1);
    }
  }
  return out;
}

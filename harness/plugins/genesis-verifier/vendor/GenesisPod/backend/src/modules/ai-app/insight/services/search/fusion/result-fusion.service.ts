/**
 * Result Fusion Service
 *
 * Handles deduplication, credibility scoring, and ranking of search results
 * aggregated from multiple data sources (web / academic / github / social / ...).
 *
 * Extracted from the old DataSourceRouterService aggregateResults() /
 * enforceDomainDiversity() / calculateCredibilityScore() methods.
 *
 * NOTE — this is NOT Reciprocal Rank Fusion (RRF). This service performs a
 * linear-weighted composite (relevance + source-type credibility + domain
 * authority + recency + content depth) because sources are heterogeneous in
 * credibility (academic ≫ social) — pure RRF would over-weight low-credibility
 * sources. Multi-QUERY RRF for the same source lives in
 * `services/data/rag-fusion.service.ts#fuseResults`.
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  DataSourceType,
  type DataSourceResult,
  type AggregatedSearchResult,
} from "../../../types/data-source.types";
import type { AdapterSearchResult } from "../search.types";
// ★ Phase 10 (2026-04-29): TI 已有自己的 normalizeUrl / extractDomain 行为
// (强升 https / lowercase 整 URL / 保留 www.) — 与沉淀版的"标准化"行为不兼容
// 沉淀版 (ai-harness/facade search-fusion) 给新业务用, TI 保持原实现避免回归
// 备注: TI 行为已被 spec 锁定, 切换需配套 spec 调整, 暂不强迁

/** Maximum number of items allowed from the same domain */
const MAX_ITEMS_PER_DOMAIN = 3;

/** Source-type credibility base scores */
const SOURCE_TYPE_SCORES: Partial<Record<DataSourceType, number>> = {
  [DataSourceType.ACADEMIC]: 0.9,
  [DataSourceType.OPENALEX]: 0.9,
  [DataSourceType.PUBMED]: 0.9,
  [DataSourceType.SEMANTIC_SCHOLAR]: 0.85,
  [DataSourceType.INDUSTRY_REPORT]: 0.85,
  [DataSourceType.GITHUB]: 0.7,
  [DataSourceType.WEB]: 0.6,
  [DataSourceType.HACKERNEWS]: 0.5,
  [DataSourceType.SOCIAL_X]: 0.4,
};

/** Default score for source types not listed above */
const DEFAULT_SOURCE_TYPE_SCORE = 0.55;

/** Known academic domain suffixes that receive an authority bonus */
const ACADEMIC_DOMAIN_PATTERNS = [
  ".edu",
  ".ac.uk",
  ".ac.jp",
  "arxiv.org",
  "scholar.google.com",
  "semanticscholar.org",
  "pubmed.ncbi.nlm.nih.gov",
  "openalex.org",
  "jstor.org",
  "springer.com",
  "nature.com",
  "sciencedirect.com",
  "ieee.org",
  "acm.org",
];

/** Score weight configuration — relevance-first ranking */
const WEIGHTS = {
  relevance: 0.35,
  sourceType: 0.25,
  domainAuthority: 0.15,
  recency: 0.15,
  contentDepth: 0.1,
};

/** Common stop words to exclude from relevance matching */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "and",
  "or",
  "not",
  "with",
  "by",
  "from",
  "as",
  "it",
  "be",
  "this",
  "that",
  "which",
  "but",
  "if",
  "about",
  "site",
  "com",
  "org",
  // Chinese stop words
  "的",
  "了",
  "在",
  "是",
  "和",
  "与",
  "对",
  "从",
  "到",
  "也",
  "就",
  "都",
  "而",
  "及",
  "或",
]);

export interface ScoredResult {
  item: DataSourceResult;
  score: number;
  relevanceScore: number;
  credibilityScore: number;
}

@Injectable()
export class ResultFusionService {
  private readonly logger = new Logger(ResultFusionService.name);

  /**
   * Fuse results from multiple sources into a scored, deduplicated, ranked list.
   *
   * Pipeline: flatten → deduplicate (URL then title Jaccard) → score → sort → domain diversity cap
   */
  fuse(
    sourceResults: Map<DataSourceType, AdapterSearchResult>,
    searchQuery: string,
  ): AggregatedSearchResult {
    const startTime = Date.now();

    // 1. Flatten all items, tracking per-source counts for metadata
    const allItems: DataSourceResult[] = [];
    const sourceCountMap: Partial<Record<DataSourceType, number>> = {};

    for (const [sourceType, adapterResult] of sourceResults) {
      allItems.push(...adapterResult.items);
      sourceCountMap[sourceType] = adapterResult.items.length;
    }

    this.logger.debug(
      `Fusing ${allItems.length} raw items from ${sourceResults.size} sources`,
    );

    // 2. Deduplicate by URL, then by title similarity
    const dedupedItems = this.deduplicate(allItems);

    this.logger.debug(
      `After deduplication: ${dedupedItems.length} items (removed ${allItems.length - dedupedItems.length})`,
    );

    // 3. Score each item (relevance + credibility composite)
    const scored: ScoredResult[] = dedupedItems.map((item) => {
      const relevanceScore = this.getRelevanceScore(item, searchQuery);
      const credibilityScore = this.getCredibilityScore(item);
      const score =
        relevanceScore * WEIGHTS.relevance +
        credibilityScore *
          (WEIGHTS.sourceType +
            WEIGHTS.domainAuthority +
            WEIGHTS.contentDepth) +
        this.getRecencyScore(item.publishedAt) * WEIGHTS.recency;
      return { item, score, relevanceScore, credibilityScore };
    });

    // 4. Sort by composite score descending
    scored.sort((a, b) => b.score - a.score);

    // 5. Enforce domain diversity — no more than MAX_ITEMS_PER_DOMAIN per domain
    const diverseScored = this.enforceDomainDiversity(scored);

    const sources = Array.from(sourceResults.keys());
    const executionTimeMs = Date.now() - startTime;

    this.logger.log(
      `Fusion complete: ${allItems.length} raw → ${dedupedItems.length} deduped → ${diverseScored.length} diverse (${executionTimeMs}ms)`,
    );

    return {
      items: diverseScored.map((s) => s.item),
      totalCount: diverseScored.length,
      sources,
      metadata: {
        searchQuery,
        executionTimeMs,
        sourceResults: sourceCountMap as Record<DataSourceType, number>,
      },
      scoredItems: diverseScored,
    };
  }

  // ============================================================================
  // Deduplication
  // ============================================================================

  private deduplicate(items: DataSourceResult[]): DataSourceResult[] {
    const seenUrls = new Set<string>();
    const urlDeduped: DataSourceResult[] = [];

    for (const item of items) {
      const normalized = this.normalizeUrl(item.url);
      if (!seenUrls.has(normalized)) {
        seenUrls.add(normalized);
        urlDeduped.push(item);
      }
    }

    // Second pass: title-similarity deduplication on the already URL-deduped list
    const titleDeduped: DataSourceResult[] = [];
    const seenTitleKeys = new Set<string>();

    for (const candidate of urlDeduped) {
      const titleKey = candidate.title
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(" ");
      if (seenTitleKeys.has(titleKey)) continue;
      seenTitleKeys.add(titleKey);
      titleDeduped.push(candidate);
    }

    return titleDeduped;
  }

  // ============================================================================
  // Scoring
  // ============================================================================

  /**
   * Credibility score combining source type, domain authority, and content depth.
   * Returns 0–1.
   */
  getCredibilityScore(item: DataSourceResult): number {
    const sourceTypeScore = this.getSourceTypeScore(item.sourceType);
    const domainAuthorityScore = this.getDomainAuthorityScore(
      item.domain ?? item.url,
    );
    const contentDepthScore = this.getContentDepthScore(item.snippet);

    // Weighted average within the credibility sub-components
    return (
      sourceTypeScore * 0.5 +
      domainAuthorityScore * 0.3 +
      contentDepthScore * 0.2
    );
  }

  /**
   * Relevance score: how well the item matches the search query.
   * Uses keyword overlap between query terms and title + snippet.
   * Returns 0–1.
   */
  getRelevanceScore(item: DataSourceResult, searchQuery: string): number {
    if (!searchQuery) return 0.5; // neutral if no query

    const queryTerms = this.tokenize(searchQuery);
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

    // Title match is 2x more important than snippet match
    const titleCoverage = titleHits / queryTerms.length;
    const snippetCoverage = snippetHits / queryTerms.length;
    let score = titleCoverage * 0.6 + snippetCoverage * 0.4;

    // Bonus: exact phrase match in title (boost for highly relevant results)
    const queryLower = searchQuery.toLowerCase().trim();
    if (queryLower.length > 5 && titleLower.includes(queryLower)) {
      score = Math.min(1.0, score + 0.15);
    }

    // Bonus: citation count from academic sources (metadata.citationCount)
    const citationCount = (item.metadata?.citationCount as number) || 0;
    if (citationCount > 100) {
      score = Math.min(1.0, score + 0.1);
    } else if (citationCount > 20) {
      score = Math.min(1.0, score + 0.05);
    }

    // Penalty: very short snippet likely means low-quality result
    if (combined.length < 50) {
      score *= 0.5;
    }

    return Math.max(0, Math.min(1.0, score));
  }

  /**
   * Tokenize a query string into meaningful terms, removing stop words and noise.
   */
  private tokenize(query: string): string[] {
    // Remove site: filters, OR operators, quotes
    const cleaned = query
      .replace(/site:\S+/gi, "")
      .replace(/\bOR\b/gi, "")
      .replace(/["']/g, "")
      .toLowerCase();

    // Split on whitespace and non-alphanumeric (preserving CJK characters)
    const tokens = cleaned
      .split(/[\s,;|]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

    return [...new Set(tokens)];
  }

  // ============================================================================
  // Domain Diversity
  // ============================================================================

  private enforceDomainDiversity(scored: ScoredResult[]): ScoredResult[] {
    const domainCounts = new Map<string, number>();
    const result: ScoredResult[] = [];

    for (const entry of scored) {
      const domain = this.extractDomain(entry.item.url);
      const count = domainCounts.get(domain) ?? 0;

      if (count < MAX_ITEMS_PER_DOMAIN) {
        result.push(entry);
        domainCounts.set(domain, count + 1);
      }
    }

    return result;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Normalize a URL for deduplication:
   * - Lowercase scheme + host
   * - Strip trailing slash
   * - Strip fragment (#...)
   * - Normalize to https
   *
   * ★ Phase 10 (2026-04-29): 已评估接入 ai-engine 沉淀的 normalizeUrl,
   * 但沉淀版"不强升 https + 不 lowercase 整 URL + 去 www."的标准化行为
   * 与 TI spec 不兼容, 保留原实现; 沉淀版给新业务复用。
   */
  normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Normalize protocol
      parsed.protocol = "https:";
      // Remove fragment
      parsed.hash = "";
      // Remove trailing slash from pathname
      if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      return parsed.toString().toLowerCase();
    } catch {
      return url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
    }
  }

  /**
   * Word-level Jaccard similarity between two title strings.
   * Returns a value in [0, 1].
   */
  calculateTitleSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersectionCount = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) intersectionCount++;
    }

    const unionCount = wordsA.size + wordsB.size - intersectionCount;
    return intersectionCount / unionCount;
  }

  /**
   * Extract hostname from a URL string, falling back to the raw string.
   * ★ Phase 10 (2026-04-29): 沉淀版 extractSearchDomain 会去 www. 前缀,
   * TI spec 期待保留 www. (e.g. www.example.com), 故保留原实现。
   */
  extractDomain(url: string): string {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  /** Base credibility score for a given source type. */
  getSourceTypeScore(sourceType: DataSourceType): number {
    return SOURCE_TYPE_SCORES[sourceType] ?? DEFAULT_SOURCE_TYPE_SCORE;
  }

  /**
   * Domain authority bonus score.
   * Returns 1.0 for known authoritative domains, 0.9 for .gov, 0.7 baseline.
   */
  getDomainAuthorityScore(domainOrUrl: string): number {
    const lower = domainOrUrl.toLowerCase();

    if (ACADEMIC_DOMAIN_PATTERNS.some((pattern) => lower.includes(pattern))) {
      return 1.0;
    }
    if (lower.includes(".gov") || lower.includes(".mil")) {
      return 0.9;
    }
    return 0.7;
  }

  /**
   * Recency score based on publishedAt age:
   * - Within 1 year  → 1.0
   * - 1–3 years      → 0.8
   * - Older / absent → 0.6
   */
  getRecencyScore(publishedAt?: Date): number {
    if (!publishedAt) return 0.6;

    const ageMs = Date.now() - publishedAt.getTime();
    const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365);

    if (ageYears <= 1) return 1.0;
    if (ageYears <= 3) return 0.8;
    return 0.6;
  }

  /**
   * Content depth score based on snippet length:
   * - > 500 chars → 1.0
   * - > 200 chars → 0.7
   * - Otherwise   → 0.5
   */
  getContentDepthScore(snippet: string | null | undefined): number {
    const len = snippet?.length || 0;
    if (len > 500) return 1.0;
    if (len > 200) return 0.7;
    return 0.5;
  }
}

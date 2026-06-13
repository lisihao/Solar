import { Injectable, Logger } from "@nestjs/common";
import {
  DataSourceType,
  DataSourceResult,
  AggregatedSearchResult,
} from "../../types/data-source.types";
import {
  dataSourceToToolId,
  toolIdToDataSource,
  convertToolsToDataSources,
} from "../../config/data-source-mapping.config";

/**
 * Data Source Strategy Service
 *
 * 负责数据源路由策略和结果处理：
 * - 数据源选择和映射
 * - 结果聚合和去重
 * - 可信度评分
 * - 域名多样性控制
 */
@Injectable()
export class DataSourceStrategyService {
  private readonly logger = new Logger(DataSourceStrategyService.name);

  // ============================================================================
  // Data Source Mapping (委托到集中配置)
  // ============================================================================

  /**
   * 将 DataSourceType 映射到 Tool ID
   */
  dataSourceToToolId(source: DataSourceType): string | null {
    return dataSourceToToolId(source);
  }

  /**
   * 将 Tool ID 映射回 DataSourceType
   */
  toolIdToDataSource(toolId: string): DataSourceType | null {
    return toolIdToDataSource(toolId);
  }

  /**
   * 将 Leader 分配的工具列表转换为数据源类型列表
   */
  convertToolsToDataSources(tools: string[]): DataSourceType[] {
    return convertToolsToDataSources(tools);
  }

  // ============================================================================
  // Result Aggregation
  // ============================================================================

  /**
   * 聚合搜索结果
   */
  aggregateResults(
    results: PromiseSettledResult<DataSourceResult[]>[],
    sources: DataSourceType[],
  ): AggregatedSearchResult {
    const allResults: DataSourceResult[] = [];
    const seenUrls = new Set<string>();
    const seenTitles = new Map<string, number>();

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const item of result.value) {
          if (!item.url) continue;

          const normalizedUrl = this.normalizeUrl(item.url);
          if (seenUrls.has(normalizedUrl)) {
            continue;
          }

          if (this.isTitleSimilar(item.title, seenTitles)) {
            continue;
          }

          seenUrls.add(normalizedUrl);
          if (item.title) {
            seenTitles.set(item.title.toLowerCase(), 0.9);
          }
          allResults.push(item);
        }
      }
    }

    const sortedResults = allResults.sort(
      (a, b) =>
        this.calculateCredibilityScore(b) - this.calculateCredibilityScore(a),
    );

    const diverseResults = this.enforceDomainDiversity(sortedResults);

    return {
      items: diverseResults,
      totalCount: diverseResults.length,
      sources: sources,
    };
  }

  /**
   * 统计每个数据源的结果数
   */
  countResultsBySource(
    results: PromiseSettledResult<DataSourceResult[]>[],
    sources: DataSourceType[],
  ): Record<DataSourceType, number> {
    const counts: Record<string, number> = {};

    results.forEach((result, index) => {
      const source = sources[index];
      if (result.status === "fulfilled") {
        counts[source] = result.value.length;
      } else {
        counts[source] = 0;
      }
    });

    return counts as Record<DataSourceType, number>;
  }

  // ============================================================================
  // Deduplication
  // ============================================================================

  /**
   * URL 标准化
   */
  normalizeUrl(url: string): string {
    if (!url) return "";
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete("utm_source");
      parsed.searchParams.delete("utm_medium");
      parsed.searchParams.delete("utm_campaign");
      parsed.searchParams.delete("ref");
      return parsed.toString().replace(/\/$/, "").toLowerCase();
    } catch (error) {
      this.logger.debug(`[normalizeUrl] Failed to normalize URL: ${error}`);
      return url.toLowerCase();
    }
  }

  /**
   * 检查标题是否与已有标题相似
   */
  private isTitleSimilar(
    title: string,
    seenTitles: Map<string, number>,
  ): boolean {
    if (!title) return false;
    const titleLower = title.toLowerCase();

    for (const [seenTitle, threshold] of seenTitles.entries()) {
      const similarity = this.calculateTitleSimilarity(titleLower, seenTitle);
      if (similarity >= threshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * 计算标题相似度 (简单的 Jaccard 相似度)
   */
  private calculateTitleSimilarity(title1: string, title2: string): number {
    if (!title1 || !title2) return 0;
    const words1 = new Set(title1.toLowerCase().split(/\s+/));
    const words2 = new Set(title2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  // ============================================================================
  // Domain Diversity
  // ============================================================================

  /**
   * 域名多样性强制
   */
  private enforceDomainDiversity(
    results: DataSourceResult[],
    maxRatio: number = 0.3,
  ): DataSourceResult[] {
    if (results.length <= 3) return results;

    const authoritativeDomains = [
      ".gov",
      ".edu",
      "arxiv.org",
      "nature.com",
      "science.org",
      "ieee.org",
      "acm.org",
    ];
    const authoritativeCount = results.filter((r) => {
      const domain = this.extractDomain(r.url);
      return domain && authoritativeDomains.some((ad) => domain.endsWith(ad));
    }).length;
    if (authoritativeCount > results.length * 0.4) {
      maxRatio = Math.max(maxRatio, 0.5);
    }

    const domainCounts = new Map<string, number>();
    for (const item of results) {
      const domain = this.extractDomain(item.url);
      if (domain) {
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
      }
    }

    const maxPerDomain = Math.max(2, Math.ceil(results.length * maxRatio));

    const overRepresented = Array.from(domainCounts.entries()).filter(
      ([, count]) => count > maxPerDomain,
    );

    if (overRepresented.length === 0) return results;

    for (const [domain, count] of overRepresented) {
      this.logger.warn(
        `[enforceDomainDiversity] Domain "${domain}" has ${count}/${results.length} results (${Math.round((count / results.length) * 100)}%), capping at ${maxPerDomain}`,
      );
    }

    const domainSeen = new Map<string, number>();
    return results.filter((item) => {
      const domain = this.extractDomain(item.url);
      if (!domain) return true;
      const seen = domainSeen.get(domain) || 0;
      if (seen >= maxPerDomain) return false;
      domainSeen.set(domain, seen + 1);
      return true;
    });
  }

  /**
   * 从 URL 提取域名
   */
  extractDomain(url: string): string | null {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./, "");
      if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        return null;
      }
      return hostname;
    } catch (error) {
      this.logger.debug(`[extractDomain] Invalid URL: ${error}`);
      return null;
    }
  }

  // ============================================================================
  // Credibility Scoring
  // ============================================================================

  /**
   * 计算可信度评分
   */
  calculateCredibilityScore(item: DataSourceResult): number {
    let score = 0;

    score += this.getSourceTypeScore(item.sourceType) * 0.4;
    score += this.getDomainAuthorityScore(item.domain) * 0.3;
    score += this.getRecencyScore(item.publishedAt) * 0.2;
    score += this.getContentDepthScore(item.snippet?.length || 0) * 0.1;

    return score;
  }

  /**
   * 数据源类型评分
   */
  private getSourceTypeScore(sourceType: DataSourceType): number {
    const scores: Record<DataSourceType, number> = {
      [DataSourceType.ACADEMIC]: 100,
      [DataSourceType.GITHUB]: 85,
      [DataSourceType.WEB]: 70,
      [DataSourceType.HACKERNEWS]: 75,
      [DataSourceType.RSS]: 65,
      [DataSourceType.LOCAL]: 80,
      [DataSourceType.FEDERAL_REGISTER]: 95,
      [DataSourceType.CONGRESS]: 95,
      [DataSourceType.WHITEHOUSE]: 90,
      [DataSourceType.SOCIAL_X]: 60,
      [DataSourceType.SEMANTIC_SCHOLAR]: 100,
      [DataSourceType.PUBMED]: 95,
      [DataSourceType.OPENALEX]: 100,
      [DataSourceType.FINANCE_API]: 85,
      [DataSourceType.WEATHER_API]: 75,
      [DataSourceType.INDUSTRY_REPORT]: 88,
    };

    return scores[sourceType] || 50;
  }

  /**
   * 域名权威性评分
   */
  private getDomainAuthorityScore(domain?: string): number {
    if (!domain) return 50;

    const highAuthority = [
      "arxiv.org",
      "nature.com",
      "science.org",
      "ieee.org",
      "github.com",
      "stackoverflow.com",
      "nytimes.com",
      "wsj.com",
      "bloomberg.com",
      "reuters.com",
    ];

    const mediumAuthority = [
      "medium.com",
      "dev.to",
      "wikipedia.org",
      "techcrunch.com",
      "wired.com",
      "arstechnica.com",
    ];

    if (highAuthority.some((d) => domain.includes(d))) {
      return 100;
    }

    if (mediumAuthority.some((d) => domain.includes(d))) {
      return 70;
    }

    if (domain.endsWith(".edu") || domain.endsWith(".gov")) {
      return 90;
    }

    return 50;
  }

  /**
   * 发布时间新鲜度评分
   */
  private getRecencyScore(publishedAt?: Date): number {
    if (!publishedAt) return 50;

    const daysSincePublished =
      (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSincePublished <= 7) return 100;
    if (daysSincePublished <= 30) return 85;
    if (daysSincePublished <= 90) return 70;
    if (daysSincePublished <= 180) return 55;
    if (daysSincePublished <= 365) return 40;

    return 25;
  }

  /**
   * 内容深度评分
   */
  private getContentDepthScore(contentLength: number): number {
    if (contentLength >= 500) return 100;
    if (contentLength >= 300) return 80;
    if (contentLength >= 200) return 60;
    if (contentLength >= 100) return 40;

    return 20;
  }
}

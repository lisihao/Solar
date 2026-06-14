/**
 * Industry Report Search Adapter
 *
 * Searches curated industry report sources (McKinsey, a16z, SemiAnalysis, etc.)
 * via a site-filtered web-search tool query.
 * Source list is loaded from ToolConfig (toolId: "industry-report") in the DB
 * and cached in memory for 5 minutes.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { getToolIdAliases } from "@/common/ai/tool-id-aliases";
import { EntityHealthRegistry } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";
import type { AdapterSearchRequest } from "../search.types";
import { SearchAdapterBase } from "./search-adapter.base";

interface IndustryReportSource {
  id: string;
  name: string;
  domain: string;
  category: string;
  credibilityScore: number;
  enabled: boolean;
  topicTypes: string[];
}

@Injectable()
export class IndustryReportSearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(IndustryReportSearchAdapter.name);

  readonly sourceId = "industry-report";
  readonly sourceType = DataSourceType.INDUSTRY_REPORT;
  readonly concurrency = 1;
  readonly defaultTimeoutMs = 15000;

  private cachedSources: IndustryReportSource[] | null = null;
  private cacheExpiry = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly prisma: PrismaService,
    @Optional() circuitBreaker?: EntityHealthRegistry,
    @Optional() latencyTracker?: SessionLatencyTrackerService,
  ) {
    super(circuitBreaker, latencyTracker);
  }

  private async getEnabledSources(
    topicType?: string,
  ): Promise<IndustryReportSource[]> {
    // Cache check
    if (this.cachedSources && Date.now() < this.cacheExpiry) {
      const sources = this.cachedSources.filter((s) => s.enabled);
      if (topicType) {
        return sources.filter((s) => s.topicTypes.includes(topicType));
      }
      return sources;
    }

    // Load from DB
    try {
      this.cachedSources = await this.loadConfiguredSources();
      this.cacheExpiry = Date.now() + IndustryReportSearchAdapter.CACHE_TTL_MS;
    } catch (error) {
      this.logger.warn(`Failed to load industry report sources: ${error}`);
      this.cachedSources = [];
    }

    const sources = this.cachedSources.filter((s) => s.enabled);
    if (topicType) {
      return sources.filter((s) => s.topicTypes.includes(topicType));
    }
    return sources;
  }

  private async loadConfiguredSources(): Promise<IndustryReportSource[]> {
    for (const toolId of getToolIdAliases(this.sourceId)) {
      const toolConfig = await this.prisma.toolConfig.findUnique({
        where: { toolId },
      });
      const config = toolConfig?.config as
        | { sources?: IndustryReportSource[] }
        | undefined
        | null;
      const sources = config?.sources ?? [];

      if (sources.length > 0) {
        return sources;
      }
    }

    return [];
  }

  override async isAvailable(): Promise<boolean> {
    const sources = await this.getEnabledSources();
    return sources.length > 0;
  }

  protected async doSearch(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    const topicType = (request.metadata as Record<string, unknown>)
      ?.topicType as string | undefined;
    const sources = await this.getEnabledSources(topicType);

    if (sources.length === 0) {
      this.logger.debug("[doSearch] No enabled industry report sources");
      return [];
    }

    // Batch sources into site: query (max 5 per query to avoid excessively long queries)
    const siteFilter = sources
      .slice(0, 5)
      .map((s) => `site:${s.domain}`)
      .join(" OR ");

    const siteQuery = `(${siteFilter}) ${request.query}`;

    this.logger.log(
      `[doSearch] Searching ${sources.length} industry sources for: ${request.query.substring(0, 60)}...`,
    );

    // Build credibility / name lookup maps
    const credibilityByDomain = new Map<string, number>();
    const nameByDomain = new Map<string, string>();
    for (const s of sources) {
      credibilityByDomain.set(s.domain, s.credibilityScore);
      nameByDomain.set(s.domain, s.name);
    }

    return this.executeToolSearch(
      this.toolRegistry,
      "web-search",
      {
        query: siteQuery,
        maxResults: request.maxResults || 10,
      },
      (toolResult) => {
        const results = toolResult["results"] as
          | Array<{
              title: string;
              url: string;
              snippet?: string;
              publishedAt?: string;
            }>
          | undefined;

        if (!results || !Array.isArray(results)) return [];

        return results.map((r) => {
          let matchedCredibility = 0.8;
          let matchedSource = "Industry Report";
          try {
            const hostname = new URL(r.url).hostname.replace("www.", "");
            for (const [domain, score] of credibilityByDomain) {
              if (hostname.includes(domain) || domain.includes(hostname)) {
                matchedCredibility = score;
                matchedSource = nameByDomain.get(domain) ?? matchedSource;
                break;
              }
            }
          } catch {
            // Ignore URL parse errors; use defaults
          }

          return {
            sourceType: DataSourceType.INDUSTRY_REPORT,
            title: r.title ?? "",
            url: r.url,
            snippet: r.snippet ?? "",
            publishedAt: r.publishedAt ? new Date(r.publishedAt) : undefined,
            domain: matchedSource,
            credibilityScore: matchedCredibility,
            metadata: {
              industrySource: matchedSource,
              credibilityScore: matchedCredibility,
            },
          };
        });
      },
    );
  }
}

/**
 * Academic Search Adapter
 *
 * Multi-source academic search with phased strategy:
 *   Phase 1 (parallel): OpenAlex + PubMed
 *   Phase 2 (if needed): Semantic Scholar
 *   Phase 2b (if needed): ArXiv (with deadline guard)
 *
 * Uses GlobalSourceThrottleService for per-sub-source concurrency control.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EntityHealthRegistry } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";
import type { AdapterSearchRequest, QueryContext } from "../search.types";
import { GlobalSourceThrottleService } from "../global-source-throttle.service";
import { SearchAdapterBase } from "./search-adapter.base";

/** Total budget for the phased strategy */
const TOTAL_BUDGET_MS = 20_000;
/** Minimum results before skipping later phases */
const SUFFICIENT_RESULTS = 10;
/** Words to strip from academic queries */
const NOISE_WORDS = /\b(latest|recent|\d{4})\b/gi;

@Injectable()
export class AcademicSearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(AcademicSearchAdapter.name);

  readonly sourceId = "academic";
  readonly sourceType = DataSourceType.ACADEMIC;
  readonly additionalTypes = [
    DataSourceType.OPENALEX,
    DataSourceType.SEMANTIC_SCHOLAR,
    DataSourceType.PUBMED,
  ];
  readonly concurrency = 5;
  readonly defaultTimeoutMs = 20000;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly throttle: GlobalSourceThrottleService,
    @Optional() circuitBreaker?: EntityHealthRegistry,
    @Optional() latencyTracker?: SessionLatencyTrackerService,
  ) {
    super(circuitBreaker, latencyTracker);
  }

  formatQuery(baseQuery: string, _context?: QueryContext): string {
    return baseQuery
      .replace(NOISE_WORDS, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  protected async doSearch(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const { query, maxResults, signal } = request;
    const perSource = Math.ceil(maxResults / 2);

    // ── Phase 1: OpenAlex + PubMed in parallel ──────────────────────────────
    const [openAlexResult, pubmedResult] = await Promise.allSettled([
      this.throttle.execute(
        "openalex-search",
        () => this.searchOpenAlex(query, perSource),
        signal,
      ),
      this.throttle.execute(
        "pubmed",
        () => this.searchPubMed(query, perSource),
        signal,
      ),
    ]);

    const phase1Items: DataSourceResult[] = [];
    if (openAlexResult.status === "fulfilled") {
      phase1Items.push(...openAlexResult.value);
    } else {
      this.logger.warn(`[doSearch] OpenAlex failed: ${openAlexResult.reason}`);
    }
    if (pubmedResult.status === "fulfilled") {
      phase1Items.push(...pubmedResult.value);
    } else {
      this.logger.warn(`[doSearch] PubMed failed: ${pubmedResult.reason}`);
    }

    if (
      phase1Items.length >= SUFFICIENT_RESULTS ||
      Date.now() >= deadline ||
      signal?.aborted
    ) {
      return this.deduplicateResults(phase1Items);
    }

    // ── Phase 2: Semantic Scholar ────────────────────────────────────────────
    const remaining2 = deadline - Date.now();
    if (remaining2 > 2000) {
      try {
        const ssItems = await this.throttle.execute(
          "semantic-scholar",
          () => this.searchSemanticScholar(query, perSource),
          signal,
        );
        phase1Items.push(...ssItems);
      } catch (err) {
        this.logger.warn(`[doSearch] Semantic Scholar failed: ${err}`);
      }
    }

    if (
      phase1Items.length >= SUFFICIENT_RESULTS ||
      Date.now() >= deadline ||
      signal?.aborted
    ) {
      return this.deduplicateResults(phase1Items);
    }

    // ── Phase 2b: ArXiv with deadline guard ──────────────────────────────────
    const remaining2b = deadline - Date.now();
    if (remaining2b > 2000) {
      try {
        const arxivItems = await Promise.race([
          this.throttle.execute(
            "arxiv-search",
            () => this.searchArXiv(query, perSource),
            signal,
          ),
          new Promise<DataSourceResult[]>((_, reject) =>
            setTimeout(
              () => reject(new Error("arxiv deadline exceeded")),
              remaining2b,
            ),
          ),
        ]);
        phase1Items.push(...arxivItems);
      } catch (err) {
        this.logger.warn(`[doSearch] ArXiv failed: ${err}`);
      }
    }

    return this.deduplicateResults(phase1Items);
  }

  // ── Sub-source helpers ────────────────────────────────────────────────────

  private async searchOpenAlex(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    return this.executeToolSearch(
      this.toolRegistry,
      "openalex-search",
      { query, maxResults, sortBy: "relevance" },
      (toolResult) => {
        const results = toolResult["results"] as
          | Array<{
              title: string;
              doi?: string;
              publicationDate?: string;
              abstract?: string;
              citationCount?: number;
              openAccessUrl?: string;
              authors?: string[];
            }>
          | undefined;

        if (!results || !Array.isArray(results)) return [];

        return results.map((r) => ({
          sourceType: DataSourceType.OPENALEX,
          title: r.title ?? "",
          url: r.openAccessUrl ?? (r.doi ? `https://doi.org/${r.doi}` : ""),
          snippet: r.abstract ?? "",
          publishedAt: r.publicationDate
            ? new Date(r.publicationDate)
            : undefined,
          metadata: {
            citationCount: r.citationCount,
            authors: r.authors,
            doi: r.doi,
          },
        }));
      },
    );
  }

  private async searchSemanticScholar(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    return this.executeToolSearch(
      this.toolRegistry,
      "semantic-scholar",
      {
        query,
        maxResults,
        fields: "title,url,abstract,year,citationCount,authors",
      },
      (toolResult) => {
        const data = toolResult["data"] as
          | Array<{
              title: string;
              url?: string;
              abstract?: string;
              year?: number;
              citationCount?: number;
            }>
          | undefined;

        if (!data || !Array.isArray(data)) return [];

        return data.map((r) => ({
          sourceType: DataSourceType.SEMANTIC_SCHOLAR,
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.abstract ?? "",
          publishedAt: r.year ? new Date(`${r.year}-01-01`) : undefined,
          metadata: {
            citationCount: r.citationCount,
          },
        }));
      },
    );
  }

  private async searchPubMed(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    return this.executeToolSearch(
      this.toolRegistry,
      "pubmed",
      { query, maxResults },
      (toolResult) => {
        const articles = toolResult["articles"] as
          | Array<{
              title: string;
              url?: string;
              abstract?: string;
              publishedDate?: string;
              authors?: string[];
              journal?: string;
            }>
          | undefined;

        if (!articles || !Array.isArray(articles)) return [];

        return articles.map((r) => ({
          sourceType: DataSourceType.PUBMED,
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.abstract ?? "",
          publishedAt: r.publishedDate ? new Date(r.publishedDate) : undefined,
          metadata: {
            authors: r.authors,
            journal: r.journal,
          },
        }));
      },
    );
  }

  private async searchArXiv(
    query: string,
    maxResults: number,
  ): Promise<DataSourceResult[]> {
    return this.executeToolSearch(
      this.toolRegistry,
      "arxiv-search",
      { query, maxResults },
      (toolResult) => {
        const papers = toolResult["papers"] as
          | Array<{
              title: string;
              url?: string;
              abstract?: string;
              published?: string;
              authors?: string[];
              categories?: string[];
            }>
          | undefined;

        if (!papers || !Array.isArray(papers)) return [];

        return papers.map((r) => ({
          sourceType: DataSourceType.ACADEMIC,
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.abstract ?? "",
          publishedAt: r.published ? new Date(r.published) : undefined,
          metadata: {
            authors: r.authors,
            categories: r.categories,
          },
        }));
      },
    );
  }

  // ── Deduplication ─────────────────────────────────────────────────────────

  private deduplicateResults(items: DataSourceResult[]): DataSourceResult[] {
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const unique: DataSourceResult[] = [];

    for (const item of items) {
      const urlKey = item.url.trim().toLowerCase();
      const titleKey = item.title.trim().toLowerCase();

      if (urlKey && seenUrls.has(urlKey)) continue;
      if (titleKey && seenTitles.has(titleKey)) continue;

      if (urlKey) seenUrls.add(urlKey);
      if (titleKey) seenTitles.add(titleKey);
      unique.push(item);
    }

    return unique;
  }
}

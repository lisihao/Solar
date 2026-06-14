/**
 * Search Executor Service
 *
 * Coordinates adapter execution through the global throttle.
 * Replaces the standardSearch() method from the old DataSourceRouterService.
 *
 * Sources run in parallel (via Promise.allSettled); within each source,
 * queries run sequentially with early stopping once maxResults is reached.
 * All calls go through GlobalSourceThrottleService for per-source queuing.
 */

import { Injectable, Logger } from "@nestjs/common";
import type { DataSourceType } from "../../types/data-source.types";
import type {
  ISearchAdapter,
  AdapterSearchResult,
  SourceAwareQueries,
} from "./search.types";
import { GlobalSourceThrottleService } from "./global-source-throttle.service";
import {
  WebSearchAdapter,
  AcademicSearchAdapter,
  GithubSearchAdapter,
  HackernewsSearchAdapter,
  SocialSearchAdapter,
  PolicySearchAdapter,
  FinanceSearchAdapter,
  WeatherSearchAdapter,
  LocalSearchAdapter,
  IndustryReportSearchAdapter,
} from "./adapters";

@Injectable()
export class SearchExecutorService {
  private readonly logger = new Logger(SearchExecutorService.name);
  private readonly adapterMap: Map<DataSourceType, ISearchAdapter>;

  constructor(
    private readonly throttle: GlobalSourceThrottleService,
    webAdapter: WebSearchAdapter,
    academicAdapter: AcademicSearchAdapter,
    githubAdapter: GithubSearchAdapter,
    hackernewsAdapter: HackernewsSearchAdapter,
    socialAdapter: SocialSearchAdapter,
    policyAdapter: PolicySearchAdapter,
    financeAdapter: FinanceSearchAdapter,
    weatherAdapter: WeatherSearchAdapter,
    localAdapter: LocalSearchAdapter,
    industryReportAdapter: IndustryReportSearchAdapter,
  ) {
    this.adapterMap = new Map<DataSourceType, ISearchAdapter>();

    const allAdapters: ISearchAdapter[] = [
      webAdapter,
      academicAdapter,
      githubAdapter,
      hackernewsAdapter,
      socialAdapter,
      policyAdapter,
      financeAdapter,
      weatherAdapter,
      localAdapter,
      industryReportAdapter,
    ];

    for (const adapter of allAdapters) {
      this.adapterMap.set(adapter.sourceType, adapter);
      if (adapter.additionalTypes) {
        for (const type of adapter.additionalTypes) {
          this.adapterMap.set(type, adapter);
        }
      }
    }

    this.logger.log(
      `Adapter map initialized with ${this.adapterMap.size} source type entries`,
    );
  }

  /**
   * Search all requested sources in parallel.
   *
   * Sources run concurrently via Promise.allSettled; queries within a source
   * run sequentially with early stopping once maxResults accumulates.
   * Each individual search call is routed through the global throttle.
   *
   * @param sources       - List of DataSourceType values to search
   * @param queries       - Base and per-source query variants
   * @param options       - maxResults, since, signal, metadata
   * @returns             Map of source → AdapterSearchResult (only fulfilled sources included)
   */
  async searchAllSources(
    sources: DataSourceType[],
    queries: SourceAwareQueries,
    options: {
      maxResults: number;
      since?: Date;
      signal?: AbortSignal;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Map<DataSourceType, AdapterSearchResult>> {
    const { maxResults, since, signal, metadata } = options;
    const startTime = Date.now();

    const sourceSearchTasks = sources.map(async (source) => {
      const adapter = this.adapterMap.get(source);

      if (!adapter) {
        this.logger.warn(`No adapter found for source type: ${source}`);
        return { source, result: null };
      }

      const sourceQueries =
        queries.sourceSpecific.get(source) ?? queries.baseQueries;

      const accumulatedItems: AdapterSearchResult["items"] = [];
      const queriesUsed: string[] = [];
      let totalDurationMs = 0;
      let lastError: string | undefined;

      for (const query of sourceQueries) {
        if (signal?.aborted) {
          this.logger.debug(
            `[${source}] Aborting query loop — signal cancelled`,
          );
          break;
        }

        if (accumulatedItems.length >= maxResults) {
          this.logger.debug(
            `[${source}] Early stop — accumulated ${accumulatedItems.length} >= maxResults ${maxResults}`,
          );
          break;
        }

        const remaining = maxResults - accumulatedItems.length;
        const formattedQuery = adapter.formatQuery(query);

        try {
          const adapterResult = await this.throttle.execute(
            adapter.sourceId,
            () =>
              adapter.search({
                query: formattedQuery,
                maxResults: remaining,
                since,
                timeoutMs: adapter.defaultTimeoutMs,
                signal,
                metadata,
              }),
            signal,
          );

          accumulatedItems.push(...adapterResult.items);
          queriesUsed.push(formattedQuery);
          totalDurationMs += adapterResult.sourceMetrics.durationMs;
          lastError = adapterResult.sourceMetrics.error;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[${source}] Query "${formattedQuery}" failed: ${message}`,
          );

          queriesUsed.push(formattedQuery);
          lastError = message;
          // Do not break — try remaining queries unless aborted
          if (signal?.aborted) break;
        }
      }

      if (queriesUsed.length === 0) {
        // No queries ran at all (e.g. empty sourceQueries)
        return { source, result: null };
      }

      const result: AdapterSearchResult = {
        items: accumulatedItems,
        sourceMetrics: {
          sourceId: adapter.sourceId,
          durationMs: totalDurationMs,
          queryUsed: queriesUsed.join(" | "),
          totalAvailable: accumulatedItems.length,
          error: lastError,
        },
      };

      return { source, result };
    });

    const settled = await Promise.allSettled(sourceSearchTasks);

    const resultMap = new Map<DataSourceType, AdapterSearchResult>();

    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        this.logger.warn(
          `Source search task rejected unexpectedly: ${String(outcome.reason)}`,
        );
        continue;
      }

      const { source, result } = outcome.value;
      if (result !== null) {
        resultMap.set(source, result);
      }
    }

    this.logger.debug(
      `searchAllSources completed: ${resultMap.size}/${sources.length} sources returned results in ${Date.now() - startTime}ms`,
    );

    return resultMap;
  }

  /**
   * Look up the adapter for a given source type.
   */
  getAdapter(source: DataSourceType): ISearchAdapter | undefined {
    return this.adapterMap.get(source);
  }

  /**
   * Return all source types for which an adapter is registered and currently available.
   * Availability check is async — unavailable adapters are silently excluded.
   */
  async getAvailableSources(): Promise<DataSourceType[]> {
    const checks = Array.from(this.adapterMap.entries()).map(
      async ([sourceType, adapter]) => {
        try {
          const available = await adapter.isAvailable();
          return available ? sourceType : null;
        } catch {
          return null;
        }
      },
    );

    const results = await Promise.all(checks);
    return results.filter((s): s is DataSourceType => s !== null);
  }
}

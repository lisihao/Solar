/**
 * Web Search Adapter
 *
 * Executes web searches via the "web-search" tool (Tavily/Serper).
 * Supports freshness-aware query formatting.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EntityHealthRegistry } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";
import type { AdapterSearchRequest, QueryContext } from "../search.types";
import { SearchAdapterBase } from "./search-adapter.base";

@Injectable()
export class WebSearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(WebSearchAdapter.name);

  readonly sourceId = "web-search";
  readonly sourceType = DataSourceType.WEB;
  readonly concurrency = 8;
  readonly defaultTimeoutMs = 15000;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Optional() circuitBreaker?: EntityHealthRegistry,
    @Optional() latencyTracker?: SessionLatencyTrackerService,
  ) {
    super(circuitBreaker, latencyTracker);
  }

  formatQuery(baseQuery: string, context?: QueryContext): string {
    if (context?.freshness === "recent") {
      const year = new Date().getFullYear();
      return `${baseQuery} ${year} latest`;
    }
    return baseQuery;
  }

  protected async doSearch(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    return this.executeToolSearch(
      this.toolRegistry,
      "web-search",
      {
        query: request.query,
        maxResults: request.maxResults,
        ...(request.since ? { since: request.since.toISOString() } : {}),
      },
      (toolResult) => {
        const results = toolResult["results"] as
          | Array<{
              title: string;
              url: string;
              content: string;
              publishedDate?: string;
            }>
          | undefined;

        if (!results || !Array.isArray(results)) return [];

        return results.map((r) => ({
          sourceType: DataSourceType.WEB,
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.content ?? "",
          publishedAt: r.publishedDate ? new Date(r.publishedDate) : undefined,
          domain: r.url ? new URL(r.url).hostname : undefined,
        }));
      },
    );
  }
}

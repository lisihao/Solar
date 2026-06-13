/**
 * GitHub Search Adapter
 *
 * Searches GitHub repositories via the "github-search" tool.
 * Results are sorted by stars.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EntityHealthRegistry } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";
import type { AdapterSearchRequest } from "../search.types";
import { SearchAdapterBase } from "./search-adapter.base";

@Injectable()
export class GithubSearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(GithubSearchAdapter.name);

  readonly sourceId = "github-search";
  readonly sourceType = DataSourceType.GITHUB;
  readonly concurrency = 2;
  readonly defaultTimeoutMs = 15000;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Optional() circuitBreaker?: EntityHealthRegistry,
    @Optional() latencyTracker?: SessionLatencyTrackerService,
  ) {
    super(circuitBreaker, latencyTracker);
  }

  formatQuery(baseQuery: string): string {
    const lower = baseQuery.toLowerCase();
    if (
      !lower.includes("framework") &&
      !lower.includes("library") &&
      !lower.includes("sdk") &&
      !lower.includes("package") &&
      !lower.includes("plugin")
    ) {
      return `${baseQuery} framework OR library`;
    }
    return baseQuery;
  }

  protected async doSearch(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    return this.executeToolSearch(
      this.toolRegistry,
      "github-search",
      {
        query: request.query,
        maxResults: request.maxResults,
        sortBy: "stars",
      },
      (toolResult) => {
        const repositories = toolResult["repositories"] as
          | Array<{
              fullName: string;
              description?: string;
              url: string;
              stars: number;
              language?: string;
              updatedAt?: string;
            }>
          | undefined;

        if (!repositories || !Array.isArray(repositories)) return [];

        return repositories.map((r) => ({
          sourceType: DataSourceType.GITHUB,
          title: r.fullName ?? "",
          url: r.url ?? "",
          snippet: r.description ?? "",
          publishedAt: r.updatedAt ? new Date(r.updatedAt) : undefined,
          domain: "github.com",
          metadata: {
            stars: r.stars,
            language: r.language,
          },
        }));
      },
    );
  }
}

/**
 * Local Search Adapter
 *
 * Searches the internal knowledge base (RAG) using RAGFacade.
 * Supports optional knowledgeBaseIds filter via request.metadata.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EntityHealthRegistry } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { RAGFacade } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";
import type { AdapterSearchRequest } from "../search.types";
import { SearchAdapterBase } from "./search-adapter.base";

@Injectable()
export class LocalSearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(LocalSearchAdapter.name);

  readonly sourceId = "local-search";
  readonly sourceType = DataSourceType.LOCAL;
  readonly concurrency = 3;
  readonly defaultTimeoutMs = 10000;

  constructor(
    private readonly ragFacade: RAGFacade,
    @Optional() circuitBreaker?: EntityHealthRegistry,
    @Optional() latencyTracker?: SessionLatencyTrackerService,
  ) {
    super(circuitBreaker, latencyTracker);
  }

  protected async doSearch(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    const knowledgeBaseIds = request.metadata?.["knowledgeBaseIds"];

    const response = await this.ragFacade.search({
      query: request.query,
      maxResults: request.maxResults,
      sources: ["local"],
      ...(knowledgeBaseIds ? { metadata: { knowledgeBaseIds } } : {}),
    });

    if (!response.success || !response.results.length) {
      if (response.error) {
        this.logger.debug(
          `[doSearch] RAG search returned no results: ${response.error}`,
        );
      }
      return [];
    }

    return response.results.map((item) => ({
      sourceType: DataSourceType.LOCAL,
      title: item.title ?? "",
      url: item.url ?? "",
      snippet: item.content ?? "",
      publishedAt: item.publishedDate
        ? new Date(item.publishedDate)
        : undefined,
      domain: item.domain,
      metadata: {
        score: item.score,
      },
    }));
  }
}

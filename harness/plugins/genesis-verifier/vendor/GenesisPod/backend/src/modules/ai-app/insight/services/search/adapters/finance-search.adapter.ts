/**
 * Finance Search Adapter
 *
 * Retrieves financial data via the "finance-api" tool (Alpha Vantage).
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
export class FinanceSearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(FinanceSearchAdapter.name);

  readonly sourceId = "finance-api";
  readonly sourceType = DataSourceType.FINANCE_API;
  readonly concurrency = 1;
  readonly defaultTimeoutMs = 20000;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    @Optional() circuitBreaker?: EntityHealthRegistry,
    @Optional() latencyTracker?: SessionLatencyTrackerService,
  ) {
    super(circuitBreaker, latencyTracker);
  }

  protected async doSearch(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    return this.executeToolSearch(
      this.toolRegistry,
      "finance-api",
      {
        query: request.query,
        maxResults: request.maxResults,
      },
      (toolResult) => {
        const data = toolResult["data"] as
          | Array<{
              symbol?: string;
              name?: string;
              description?: string;
              exchange?: string;
              type?: string;
              [key: string]: unknown;
            }>
          | undefined;

        if (!data || !Array.isArray(data)) return [];

        return data.map((r) => ({
          sourceType: DataSourceType.FINANCE_API,
          title: r.name ? `${r.symbol ?? ""} - ${r.name}` : (r.symbol ?? ""),
          url: r.symbol ? `https://finance.yahoo.com/quote/${r.symbol}` : "",
          snippet:
            r.description ?? `${r.type ?? ""} on ${r.exchange ?? ""}`.trim(),
          domain: "finance.yahoo.com",
          metadata: {
            symbol: r.symbol,
            exchange: r.exchange,
            type: r.type,
          },
        }));
      },
    );
  }
}

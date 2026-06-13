/**
 * Weather Search Adapter
 *
 * Retrieves weather data via the "weather-api" tool (Open-Meteo).
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
export class WeatherSearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(WeatherSearchAdapter.name);

  readonly sourceId = "weather-api";
  readonly sourceType = DataSourceType.WEATHER_API;
  readonly concurrency = 1;
  readonly defaultTimeoutMs = 10000;

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
      "weather-api",
      {
        query: request.query,
        maxResults: request.maxResults,
      },
      (toolResult) => {
        // Normalize arbitrary weather API shape into DataSourceResult[]
        const items = (toolResult["results"] ??
          toolResult["data"] ??
          toolResult["forecasts"] ??
          []) as Array<Record<string, unknown>>;

        if (!Array.isArray(items)) return [];

        return items.map((r) => ({
          sourceType: DataSourceType.WEATHER_API,
          title: String(
            r["location"] ?? r["name"] ?? r["title"] ?? "Weather Data",
          ),
          url: String(r["url"] ?? "https://open-meteo.com"),
          snippet: String(
            r["description"] ?? r["summary"] ?? r["content"] ?? "",
          ),
          publishedAt: r["time"]
            ? new Date(String(r["time"]))
            : r["date"]
              ? new Date(String(r["date"]))
              : undefined,
          domain: "open-meteo.com",
          metadata: r,
        }));
      },
    );
  }
}

/**
 * Policy Search Adapter
 *
 * Aggregates results from three U.S. policy data sources in parallel:
 *   - Federal Register (executive orders, regulations)
 *   - Congress.gov (legislation, bills)
 *   - White House News (statements, briefings)
 *
 * Uses ToolRegistry to execute each policy tool via the facade pattern.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EntityHealthRegistry } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { ToolRegistry, type ToolContext } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";
import type { AdapterSearchRequest } from "../search.types";
import { SearchAdapterBase } from "./search-adapter.base";

function makeToolContext(toolId: string): ToolContext {
  return {
    executionId: `topic-insights-${toolId}-${Date.now()}`,
    toolId,
    callerType: "orchestrator",
    createdAt: new Date(),
  };
}

@Injectable()
export class PolicySearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(PolicySearchAdapter.name);

  readonly sourceId = "policy";
  readonly sourceType = DataSourceType.FEDERAL_REGISTER;
  readonly additionalTypes = [
    DataSourceType.CONGRESS,
    DataSourceType.WHITEHOUSE,
  ];
  readonly concurrency = 3;
  readonly defaultTimeoutMs = 15000;

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
    const { query, maxResults } = request;
    const perSource = Math.ceil(maxResults / 3);

    const [fedResult, congressResult, whResult] = await Promise.allSettled([
      this.executePolicyTool("federal-register", {
        query,
        maxResults: perSource,
      }),
      this.executePolicyTool("congress-gov", { query, limit: perSource }),
      this.executePolicyTool("whitehouse-news", { query, limit: perSource }),
    ]);

    const results: DataSourceResult[] = [];

    // Federal Register
    if (fedResult.status === "fulfilled" && fedResult.value) {
      const data = fedResult.value as Record<string, unknown>;
      if (data["success"]) {
        const documents = (data["documents"] ?? []) as Array<
          Record<string, unknown>
        >;
        for (const doc of documents) {
          results.push({
            sourceType: DataSourceType.FEDERAL_REGISTER,
            title: String(doc["title"] ?? ""),
            url: String(doc["htmlUrl"] ?? ""),
            snippet: String(doc["abstract"] ?? ""),
            publishedAt: doc["publicationDate"]
              ? new Date(String(doc["publicationDate"]))
              : undefined,
            domain: "federalregister.gov",
            metadata: {
              documentNumber: doc["documentNumber"],
              documentType: doc["type"],
              agencies: doc["agencies"],
            },
          });
        }
      }
    } else if (fedResult.status === "rejected") {
      this.logger.warn(
        `[doSearch] FederalRegister failed: ${fedResult.reason}`,
      );
    }

    // Congress.gov
    if (congressResult.status === "fulfilled" && congressResult.value) {
      const data = congressResult.value as Record<string, unknown>;
      if (data["success"]) {
        const bills = (data["bills"] ?? []) as Array<Record<string, unknown>>;
        for (const bill of bills) {
          const latestAction = bill["latestAction"] as
            | Record<string, unknown>
            | undefined;
          results.push({
            sourceType: DataSourceType.CONGRESS,
            title: String(bill["shortTitle"] ?? bill["title"] ?? ""),
            url: String(bill["url"] ?? ""),
            snippet: String(latestAction?.["text"] ?? bill["title"] ?? ""),
            publishedAt: bill["introducedDate"]
              ? new Date(String(bill["introducedDate"]))
              : undefined,
            domain: "congress.gov",
            metadata: {
              billNumber: bill["number"],
              billType: bill["type"],
              congress: bill["congress"],
              policyArea: bill["policyArea"],
              latestActionDate: latestAction?.["actionDate"],
            },
          });
        }
      }
    } else if (congressResult.status === "rejected") {
      this.logger.warn(
        `[doSearch] CongressGov failed: ${congressResult.reason}`,
      );
    }

    // White House News
    if (whResult.status === "fulfilled" && whResult.value) {
      const data = whResult.value as Record<string, unknown>;
      if (data["success"]) {
        const items = (data["items"] ?? []) as Array<Record<string, unknown>>;
        for (const item of items) {
          results.push({
            sourceType: DataSourceType.WHITEHOUSE,
            title: String(item["title"] ?? ""),
            url: String(item["url"] ?? ""),
            snippet: String(item["summary"] ?? ""),
            publishedAt: item["date"]
              ? new Date(String(item["date"]))
              : undefined,
            domain: "whitehouse.gov",
            metadata: {
              contentType: item["type"],
            },
          });
        }
      }
    } else if (whResult.status === "rejected") {
      this.logger.warn(`[doSearch] WhiteHouseNews failed: ${whResult.reason}`);
    }

    return results;
  }

  /**
   * Execute a policy tool via ToolRegistry.
   * Returns the tool's raw result data, or null if tool is not registered.
   */
  private async executePolicyTool(
    toolId: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const tool = this.toolRegistry.tryGet(toolId);
    if (!tool) {
      this.logger.warn(`[executePolicyTool] ${toolId} not registered`);
      return null;
    }

    const context = makeToolContext(toolId);
    const result = await tool.execute(input, context);

    if (!result.success || !result.data) {
      this.logger.warn(
        `[executePolicyTool] ${toolId} returned success=${result.success}`,
      );
      return null;
    }

    return result.data;
  }
}

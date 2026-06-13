/**
 * Social Search Adapter (X/Twitter)
 *
 * Uses Grok Live Search via ChatFacade to find trending discussions on X.
 * Falls back to a web-search tool with "site:x.com OR site:twitter.com" prefix
 * if Grok is unavailable or returns an unparseable response.
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { EntityHealthRegistry } from "@/modules/ai-harness/facade";
import { SessionLatencyTrackerService } from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";
import type { AdapterSearchRequest } from "../search.types";
import { SearchAdapterBase } from "./search-adapter.base";

/** Shape of each item the Grok prompt returns */
interface GrokResultItem {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

@Injectable()
export class SocialSearchAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger(SocialSearchAdapter.name);

  readonly sourceId = "social-x";
  readonly sourceType = DataSourceType.SOCIAL_X;
  readonly concurrency = 2;
  readonly defaultTimeoutMs = 15000;

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly toolRegistry: ToolRegistry,
    @Optional() circuitBreaker?: EntityHealthRegistry,
    @Optional() latencyTracker?: SessionLatencyTrackerService,
  ) {
    super(circuitBreaker, latencyTracker);
  }

  protected async doSearch(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    // Primary: Grok Live Search
    try {
      const results = await this.searchViaGrok(request);
      if (results.length > 0) return results;
    } catch (err) {
      this.logger.warn(`[doSearch] Grok Live Search failed: ${err}`);
    }

    // Fallback: web-search with X domain filter
    return this.searchViaWebFallback(request);
  }

  // ── Primary: Grok Live Search ─────────────────────────────────────────────

  private async searchViaGrok(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    const systemPrompt = [
      "You are a social media research assistant with real-time access to X (Twitter).",
      "Return ONLY a valid JSON array of objects — no markdown, no explanation.",
      `Each object must have exactly these fields: { "title": string, "url": string, "snippet": string, "date": string }`,
      `"title" is the tweet/thread headline or user, "url" is a direct link, "snippet" is key content, "date" is ISO 8601.`,
    ].join(" ");

    const userContent = [
      `Find the top ${request.maxResults} trending discussions on X/Twitter about: "${request.query}".`,
      "Focus on high-engagement posts, notable threads, and key opinions.",
      "Return ONLY the JSON array.",
    ].join(" ");

    const response = await this.chatFacade.chat({
      messages: [{ role: "user", content: userContent }],
      systemPrompt,
      operationName: "社交搜索",
      modelType: AIModelType.CHAT,
      skipGuardrails: true, // 内部系统调用，社交搜索
      taskProfile: { creativity: "deterministic", outputLength: "medium" },
    });

    if (response.isError || !response.content) return [];

    return this.parseGrokResponse(response.content);
  }

  private parseGrokResponse(content: string): DataSourceResult[] {
    try {
      // Strip markdown code fences if present
      const cleaned = content
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();

      const parsed = JSON.parse(cleaned) as unknown;
      if (!Array.isArray(parsed)) return [];

      return (parsed as GrokResultItem[]).map((item) => ({
        sourceType: DataSourceType.SOCIAL_X,
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: item.snippet ?? "",
        publishedAt: item.date ? new Date(item.date) : undefined,
        domain: "x.com",
      }));
    } catch {
      this.logger.warn("[parseGrokResponse] Failed to parse JSON response");
      return [];
    }
  }

  // ── Fallback: web-search with X domain filter ─────────────────────────────

  private async searchViaWebFallback(
    request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    const domainQuery = `site:x.com OR site:twitter.com ${request.query}`;

    return this.executeToolSearch(
      this.toolRegistry,
      "web-search",
      {
        query: domainQuery,
        maxResults: request.maxResults,
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
          sourceType: DataSourceType.SOCIAL_X,
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: r.content ?? "",
          publishedAt: r.publishedDate ? new Date(r.publishedDate) : undefined,
          domain: "x.com",
        }));
      },
    );
  }
}

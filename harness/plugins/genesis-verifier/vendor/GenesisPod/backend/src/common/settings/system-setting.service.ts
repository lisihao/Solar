/**
 * SystemSettingService
 *
 * Lightweight read-only service for accessing SystemSetting values from the database.
 * Extracted from AdminService to break the circular dependency chain:
 *   AiEngineModule → ContentFetchModule → ContentProcessingModule → ExploreModule → AdminModule → AiEngineModule
 *
 * This service only depends on PrismaService (no heavy module imports),
 * allowing ContentProcessingModule and ExploreModule to access settings
 * without importing AdminModule.
 */

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SystemSettingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read a single setting value from the SystemSetting table.
   * Returns parsed JSON if the value is valid JSON, otherwise raw string.
   * Returns null if the key does not exist.
   */
  async getSetting(key: string): Promise<unknown> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });

    if (!setting) {
      return null;
    }

    try {
      return setting.value ? JSON.parse(setting.value) : null;
    } catch {
      return setting.value;
    }
  }

  /**
   * Get the YouTube API key for a given provider (e.g. "supadata").
   * Returns the full (unmasked) key for internal use.
   */
  async getYoutubeApiKey(provider: "supadata"): Promise<string | null> {
    return this.getSetting(`youtube.${provider}.apiKey`) as Promise<
      string | null
    >;
  }

  /**
   * Get search configuration with masked API keys (for Admin UI display).
   *
   * Supports both legacy single-key format and new multi-key array format
   * for Tavily and Serper providers.
   */
  async getSearchConfig() {
    const provider = await this.getSetting("search.provider");
    const perplexityKey = await this.getSetting("search.perplexity.apiKey");
    const enabled = await this.getSetting("search.enabled");

    // Multi-key format (new)
    const tavilyKeys = await this.getSetting("search.tavily.apiKeys");
    const serperKeys = await this.getSetting("search.serper.apiKeys");

    // Legacy single-key format
    const tavilyKeyLegacy = await this.getSetting("search.tavily.apiKey");
    const serperKeyLegacy = await this.getSetting("search.serper.apiKey");

    // Merge new and legacy formats
    const tavilyKeyList = Array.isArray(tavilyKeys)
      ? tavilyKeys
      : tavilyKeyLegacy
        ? [tavilyKeyLegacy]
        : [];
    const serperKeyList = Array.isArray(serperKeys)
      ? serperKeys
      : serperKeyLegacy
        ? [serperKeyLegacy]
        : [];

    return {
      provider: (provider as string) || "tavily",
      enabled: enabled !== false,
      perplexity: {
        apiKey: perplexityKey ? "***configured***" : null,
        hasApiKey: !!perplexityKey,
      },
      tavily: {
        apiKey: tavilyKeyList.length > 0 ? "***configured***" : null,
        hasApiKey: tavilyKeyList.length > 0,
        keyCount: tavilyKeyList.length,
      },
      serper: {
        apiKey: serperKeyList.length > 0 ? "***configured***" : null,
        hasApiKey: serperKeyList.length > 0,
        keyCount: serperKeyList.length,
      },
      duckduckgo: {
        apiKey: null,
        hasApiKey: true,
        noKeyRequired: true,
      },
    };
  }

  /**
   * Get the actual (unmasked) search API key for a given provider.
   * Used internally when performing search operations.
   */
  async getSearchApiKey(provider: string): Promise<string | null> {
    if (provider === "perplexity") {
      return this.getSetting("search.perplexity.apiKey") as Promise<
        string | null
      >;
    } else if (provider === "tavily") {
      return this.getSetting("search.tavily.apiKey") as Promise<string | null>;
    } else if (provider === "serper") {
      return this.getSetting("search.serper.apiKey") as Promise<string | null>;
    }
    return null;
  }
}

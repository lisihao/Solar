import { Injectable, Logger } from "@nestjs/common";
import { AIModelType, ResearchTopic, TopicDimension } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";
import type { SourceAwareQueries } from "../search.types";

@Injectable()
export class QueryStrategyService {
  private readonly logger = new Logger(QueryStrategyService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * Generate bilingual, source-aware queries from topic + dimension.
   */
  async generateQueries(
    topic: ResearchTopic,
    dimension: TopicDimension,
  ): Promise<SourceAwareQueries> {
    // 1. Collect raw queries from dimension.searchQueries (JSON array, max 3)
    const rawQueries = this.extractRawQueries(topic, dimension);

    // 2. Detect language of original queries
    const hasChinese = rawQueries.some((q) => this.containsChinese(q));
    const hasEnglish = rawQueries.some((q) => !this.containsChinese(q));
    const language: "en" | "zh" | "mixed" =
      hasChinese && hasEnglish ? "mixed" : hasChinese ? "zh" : "en";

    // 3. Generate bilingual pairs
    let chineseQueries: string[];
    let englishQueries: string[];

    if (language === "zh" || language === "mixed") {
      // Original contains Chinese — translate to English
      const chineseOnly = rawQueries.filter((q) => this.containsChinese(q));
      const englishOnly = rawQueries.filter((q) => !this.containsChinese(q));
      const translated = await this.batchTranslate(
        chineseOnly.slice(0, 3),
        "en",
      );
      chineseQueries = rawQueries;
      englishQueries = [
        ...englishOnly,
        ...translated.filter((t) => t.length > 0),
      ];
    } else {
      // Original is English — translate to Chinese (max 2)
      const translated = await this.batchTranslate(
        rawQueries.slice(0, 2),
        "zh",
      );
      englishQueries = rawQueries;
      chineseQueries = translated.filter((t) => t.length > 0);
    }

    // Deduplicate
    englishQueries = [...new Set(englishQueries)];
    chineseQueries = [...new Set(chineseQueries)];

    // 4. Determine technical topic for GitHub query enhancement
    const isTechnical = this.isTechnicalTopic(topic.name, dimension.name);

    // 5. Build source-specific query map
    const sourceSpecific = new Map<DataSourceType, string[]>();

    // WEB: Chinese queries (if topic is Chinese) + English with time suffix
    const webEnglish = englishQueries
      .slice(0, 3)
      .map((q) => this.enhanceWithTimestamp(q, dimension));
    const webQueries =
      language === "zh" || language === "mixed"
        ? [...chineseQueries.slice(0, 2), ...webEnglish]
        : webEnglish;
    sourceSpecific.set(DataSourceType.WEB, [...new Set(webQueries)]);

    // ACADEMIC: English only, clean (no time words)
    const academicQueries = englishQueries.slice(0, 3);
    sourceSpecific.set(DataSourceType.ACADEMIC, academicQueries);
    sourceSpecific.set(DataSourceType.OPENALEX, academicQueries);
    sourceSpecific.set(DataSourceType.SEMANTIC_SCHOLAR, academicQueries);
    sourceSpecific.set(DataSourceType.PUBMED, academicQueries);

    // GITHUB: English, append "framework OR library" if technical
    const githubQueries = englishQueries.slice(0, 2).map((q) => {
      if (isTechnical && !q.toLowerCase().includes("framework")) {
        return `${q} framework OR library`;
      }
      return q;
    });
    sourceSpecific.set(DataSourceType.GITHUB, githubQueries);

    // HACKERNEWS: English only (community is English-dominant)
    sourceSpecific.set(DataSourceType.HACKERNEWS, englishQueries.slice(0, 2));

    // SOCIAL_X: Both languages
    const socialQueries = [
      ...chineseQueries.slice(0, 2),
      ...englishQueries.slice(0, 2),
    ];
    sourceSpecific.set(DataSourceType.SOCIAL_X, [...new Set(socialQueries)]);

    // Policy sources: English only
    const policyQueries = englishQueries.slice(0, 2);
    sourceSpecific.set(DataSourceType.FEDERAL_REGISTER, policyQueries);
    sourceSpecific.set(DataSourceType.CONGRESS, policyQueries);
    sourceSpecific.set(DataSourceType.WHITEHOUSE, policyQueries);

    // LOCAL: Both languages (local KB may have both)
    const localQueries = [
      ...new Set([
        ...chineseQueries.slice(0, 2),
        ...englishQueries.slice(0, 2),
      ]),
    ];
    sourceSpecific.set(DataSourceType.LOCAL, localQueries);

    // 6. Compose base queries (all unique queries, English-first)
    const baseQueries = [
      ...new Set([...englishQueries, ...chineseQueries]),
    ].slice(0, 6);

    this.logger.debug(
      `Generated queries for "${topic.name}/${dimension.name}": ` +
        `${englishQueries.length} EN, ${chineseQueries.length} ZH`,
    );

    return {
      baseQueries,
      sourceSpecific,
      language,
    };
  }

  /**
   * Extract raw queries from dimension.searchQueries JSON array (max 3),
   * with fallback to "${topic.name} ${dimension.name}".
   */
  private extractRawQueries(
    topic: ResearchTopic,
    dimension: TopicDimension,
  ): string[] {
    const fallback = `${topic.name} ${dimension.name}`;

    const raw = dimension.searchQueries;
    if (!raw) {
      return [fallback];
    }

    // searchQueries is a Prisma Json field — parse if it's a string
    let parsed: unknown;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [fallback];
      }
    } else {
      parsed = raw;
    }

    if (!Array.isArray(parsed)) {
      return [fallback];
    }

    const queries = (parsed as unknown[])
      .filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
      .slice(0, 3);

    return queries.length > 0 ? queries : [fallback];
  }

  /**
   * Batch translate queries to target language using a single LLM call.
   * On error returns empty array; caller uses original queries as fallback.
   */
  private async batchTranslate(
    queries: string[],
    targetLanguage: "en" | "zh",
  ): Promise<string[]> {
    if (queries.length === 0) {
      return [];
    }

    const langLabel =
      targetLanguage === "en" ? "English" : "Chinese (Simplified)";
    const systemPrompt =
      `You are a professional translator for search queries. ` +
      `Translate each search query to ${langLabel}. ` +
      `Output ONLY the translated queries, one per line, in the same order as the input. ` +
      `Do not add explanations, numbering, or any extra text.`;

    const userContent = queries.join("\n");

    try {
      const response = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        operationName: "查询生成",
        modelType: AIModelType.CHAT,
        skipGuardrails: true, // 内部系统调用，搜索查询翻译
        taskProfile: { creativity: "deterministic", outputLength: "minimal" },
      });

      const content =
        typeof response.content === "string" ? response.content.trim() : "";

      if (!content) {
        return [];
      }

      const lines = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      return lines;
    } catch (err) {
      this.logger.warn(
        `batchTranslate to ${targetLanguage} failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Enhance a query with a time-based suffix based on dimension freshness cues.
   * Skips enhancement if query already contains a year or "latest".
   */
  private enhanceWithTimestamp(
    query: string,
    dimension: TopicDimension,
  ): string {
    const currentYear = new Date().getFullYear();

    // Skip if query already has a year or "latest"
    const alreadyHasTime = /\b(latest|recent|\d{4})\b/i.test(query);
    if (alreadyHasTime) {
      return query;
    }

    const description =
      typeof dimension.description === "string"
        ? dimension.description.toLowerCase()
        : "";

    // Historical/archival dimension — no time suffix
    const isHistorical =
      /历史|传统|evolution|history|historical|heritage|origin/i.test(
        description,
      );
    if (isHistorical) {
      return query;
    }

    // Trend/forecast dimension — append "latest trends"
    const isTrend =
      /趋势|发展|动态|forecast|trend|outlook|future|emerging/i.test(
        description,
      );
    if (isTrend) {
      return `${query} ${currentYear} latest trends`;
    }

    // Default — append "latest recent"
    return `${query} ${currentYear} latest recent`;
  }

  /**
   * Check whether text contains Chinese characters.
   */
  private containsChinese(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
  }

  /**
   * Heuristic: determine if a topic/dimension is technical in nature.
   */
  private isTechnicalTopic(topicName: string, dimensionName: string): boolean {
    const combined = `${topicName} ${dimensionName}`.toLowerCase();
    return /\b(api|sdk|framework|library|tool|code|software|platform|stack|open.?source|github|developer|programming|database|model|llm|ai|ml)\b/.test(
      combined,
    );
  }
}

/**
 * Smart Content Extractor Skill (P0)
 *
 * Replaces the naive `sourceText.substring(0, 3000)` with intelligent
 * content extraction:
 * 1. Split source text into paragraphs
 * 2. Score paragraphs by keyword overlap with page outline
 * 3. Extract data points (numbers, percentages, trends)
 * 4. Extract quotes
 * 5. Generate structured prompt fragment
 *
 * LLM is only called when candidate paragraphs > 10 (for ranking)
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  ISkill,
  SkillContext,
  SkillResult,
  SkillLayer,
  SKILL_LAYERS,
} from "@/modules/ai-harness/facade";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import type {
  SmartContentExtractorInput,
  SmartContentExtractorOutput,
  ExtractedDataPoint,
} from "./types/enhancement-types";

@Injectable()
export class SmartContentExtractorSkill implements ISkill<
  SmartContentExtractorInput,
  SmartContentExtractorOutput
> {
  private readonly logger = new Logger(SmartContentExtractorSkill.name);

  readonly id = "slides-smart-content-extractor";
  readonly name = "Smart Content Extractor";
  readonly description =
    "Intelligently extracts relevant content from source text for slide generation";
  readonly layer: SkillLayer = SKILL_LAYERS.UNDERSTANDING;
  readonly domain = "slides";
  readonly tags = ["slides", "content", "extraction", "relevance"];
  readonly version = "1.0.0";

  constructor(@Optional() private readonly chatFacade?: ChatFacade) {}

  async execute(
    input: SmartContentExtractorInput,
    context: SkillContext,
  ): Promise<SkillResult<SmartContentExtractorOutput>> {
    const startTime = new Date();

    try {
      const { pageOutline, sourceText } = input;

      if (!sourceText || sourceText.length === 0) {
        return {
          success: true,
          data: {
            relevantParagraphs: [],
            dataPoints: [],
            quotes: [],
            promptFragment: "",
          },
          metadata: {
            executionId: context.executionId,
            startTime,
            endTime: new Date(),
            duration: Date.now() - startTime.getTime(),
          },
        };
      }

      this.logger.log(
        `[execute] Extracting content for page "${pageOutline.title}" from ${sourceText.length} chars`,
      );

      // 1. Split into paragraphs
      const paragraphs = this.splitParagraphs(sourceText);

      // 2. Extract keywords from page outline
      const keywords = this.extractKeywords(pageOutline);

      // 3. Score and rank paragraphs
      let relevantParagraphs = this.rankParagraphs(paragraphs, keywords);

      // 4. If too many candidates, optionally use LLM for refined ranking
      if (relevantParagraphs.length > 10 && this.chatFacade) {
        try {
          relevantParagraphs = await this.llmRankParagraphs(
            relevantParagraphs,
            pageOutline.title,
            pageOutline.contentBrief,
            context,
          );
        } catch (error) {
          this.logger.warn(
            `[execute] LLM ranking failed, using keyword-based ranking: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Take top 5-8 paragraphs
      relevantParagraphs = relevantParagraphs.slice(0, 8);

      // 5. Extract data points
      const dataPoints = this.extractDataPoints(relevantParagraphs);

      // 6. Extract quotes
      const quotes = this.extractQuotes(relevantParagraphs);

      // 7. Generate prompt fragment
      const promptFragment = this.buildPromptFragment(
        relevantParagraphs,
        dataPoints,
        quotes,
        pageOutline.title,
      );

      this.logger.log(
        `[execute] Extracted ${relevantParagraphs.length} paragraphs, ${dataPoints.length} data points, ${quotes.length} quotes`,
      );

      return {
        success: true,
        data: {
          relevantParagraphs,
          dataPoints,
          quotes,
          promptFragment,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`[execute] Failed: ${errorMessage}`);

      return {
        success: false,
        error: {
          code: "CONTENT_EXTRACTION_FAILED",
          message: errorMessage,
          retryable: false,
        },
        metadata: {
          executionId: context.executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * Split source text into paragraphs
   */
  private splitParagraphs(text: string): string[] {
    return text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 20);
  }

  /**
   * Extract keywords from page outline
   */
  private extractKeywords(
    pageOutline: SmartContentExtractorInput["pageOutline"],
  ): string[] {
    const sources = [
      pageOutline.title,
      pageOutline.subtitle || "",
      pageOutline.contentBrief || "",
      ...(pageOutline.keyElements || []),
    ];

    const text = sources.join(" ").toLowerCase();

    // Extract meaningful tokens (>= 2 chars for Chinese, >= 3 for English)
    const chineseTokens = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    const englishTokens =
      text.match(/[a-zA-Z]{3,}/g)?.map((t) => t.toLowerCase()) || [];

    // Deduplicate
    return [...new Set([...chineseTokens, ...englishTokens])];
  }

  /**
   * Rank paragraphs by keyword overlap score
   */
  private rankParagraphs(paragraphs: string[], keywords: string[]): string[] {
    if (keywords.length === 0) {
      return paragraphs.slice(0, 8);
    }

    const scored = paragraphs.map((p) => {
      const lower = p.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          score += 1;
        }
      }
      return { paragraph: p, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Filter out paragraphs with zero overlap (unless we have too few)
    const relevant = scored.filter((s) => s.score > 0);
    if (relevant.length >= 3) {
      return relevant.map((s) => s.paragraph);
    }

    // If too few relevant paragraphs, take top scored anyway
    return scored.slice(0, 8).map((s) => s.paragraph);
  }

  /**
   * Use LLM for refined paragraph ranking (only when >10 candidates)
   */
  private async llmRankParagraphs(
    paragraphs: string[],
    title: string,
    contentBrief: string,
    _context: SkillContext,
  ): Promise<string[]> {
    if (!this.chatFacade) return paragraphs;

    const numbered = paragraphs
      .slice(0, 15)
      .map((p, i) => `[${i + 1}] ${p.substring(0, 200)}`)
      .join("\n");

    const response = await this.chatFacade.chat({
      messages: [
        {
          role: "system",
          content:
            "You rank text paragraphs by relevance. Output only a comma-separated list of paragraph numbers (e.g., 3,1,7,5). No explanation.",
        },
        {
          role: "user",
          content: `Slide title: "${title}"\nContent brief: "${contentBrief}"\n\nRank these paragraphs by relevance (most relevant first). Return top 8 numbers:\n\n${numbered}`,
        },
      ],
      modelType: "CHAT" as AIModelType,
      taskProfile: {
        creativity: "deterministic",
        outputLength: "minimal",
      },
    });

    if (response.isError || !response.content) {
      return paragraphs;
    }

    // Parse the numbered list
    const indices = response.content
      .match(/\d+/g)
      ?.map((n) => parseInt(n, 10) - 1)
      .filter((i) => i >= 0 && i < paragraphs.length);

    if (!indices || indices.length === 0) {
      return paragraphs;
    }

    // Return paragraphs in ranked order
    const ranked = indices.map((i) => paragraphs[i]);
    // Add any remaining paragraphs not in the ranking
    const remaining = paragraphs.filter((p) => !ranked.includes(p));
    return [...ranked, ...remaining];
  }

  /**
   * Extract data points from text using regex
   */
  private extractDataPoints(paragraphs: string[]): ExtractedDataPoint[] {
    const text = paragraphs.join("\n");
    const dataPoints: ExtractedDataPoint[] = [];

    // Percentages
    const percentMatches = text.matchAll(/(\d+(?:\.\d+)?)\s*%/g);
    for (const match of percentMatches) {
      const contextStart = Math.max(0, (match.index ?? 0) - 40);
      const contextEnd = Math.min(
        text.length,
        (match.index ?? 0) + match[0].length + 40,
      );
      dataPoints.push({
        type: "percentage",
        value: `${match[1]}%`,
        context: text.substring(contextStart, contextEnd).trim(),
      });
    }

    // Large numbers (with units like million, billion, etc.)
    const numberMatches = text.matchAll(
      /(\$?\d[\d,.]*)\s*(million|billion|trillion|万|亿|千万)/gi,
    );
    for (const match of numberMatches) {
      const contextStart = Math.max(0, (match.index ?? 0) - 30);
      const contextEnd = Math.min(
        text.length,
        (match.index ?? 0) + match[0].length + 30,
      );
      dataPoints.push({
        type: "number",
        value: match[0],
        context: text.substring(contextStart, contextEnd).trim(),
      });
    }

    // Trends (increase, decrease, growth)
    const trendMatches = text.matchAll(
      /(increase|decrease|grow|decline|rise|drop|surge|上升|下降|增长|减少|激增)[^.。]*?(\d+(?:\.\d+)?)\s*%?/gi,
    );
    for (const match of trendMatches) {
      dataPoints.push({
        type: "trend",
        value: match[0].substring(0, 80),
        context: match[0].substring(0, 100),
      });
    }

    // Comparisons (X vs Y, compared to)
    const comparisonMatches = text.matchAll(
      /(?:compared to|versus|vs\.?|相比|对比)[^.。]{0,80}/gi,
    );
    for (const match of comparisonMatches) {
      dataPoints.push({
        type: "comparison",
        value: match[0].substring(0, 80),
        context: match[0].substring(0, 100),
      });
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    return dataPoints
      .filter((dp) => {
        if (seen.has(dp.value)) return false;
        seen.add(dp.value);
        return true;
      })
      .slice(0, 10);
  }

  /**
   * Extract quotes from text
   */
  private extractQuotes(paragraphs: string[]): string[] {
    const text = paragraphs.join("\n");
    const quotes: string[] = [];

    // English quotes
    const enQuotes = text.matchAll(/"([^"]{10,200})"/g);
    for (const match of enQuotes) {
      quotes.push(match[1]);
    }

    // Chinese quotes
    const cnQuotes = text.matchAll(/\u201c([^\u201d]{10,200})\u201d/g);
    for (const match of cnQuotes) {
      quotes.push(match[1]);
    }

    return [...new Set(quotes)].slice(0, 5);
  }

  /**
   * Build structured prompt fragment
   */
  private buildPromptFragment(
    paragraphs: string[],
    dataPoints: ExtractedDataPoint[],
    quotes: string[],
    pageTitle: string,
  ): string {
    const sections: string[] = [];

    sections.push(`## Source Material (curated for "${pageTitle}")`);

    if (paragraphs.length > 0) {
      sections.push(
        "\n### Key Passages\n" +
          paragraphs.map((p) => p.substring(0, 300)).join("\n\n"),
      );
    }

    if (dataPoints.length > 0) {
      sections.push(
        "\n### Data Points (use these for KPI cards and statistics)\n" +
          dataPoints
            .map((dp) => `- **${dp.value}** (${dp.type}): ${dp.context}`)
            .join("\n"),
      );
    }

    if (quotes.length > 0) {
      sections.push(
        "\n### Notable Quotes (use in callout boxes)\n" +
          quotes.map((q) => `- "${q}"`).join("\n"),
      );
    }

    return sections.join("\n");
  }
}

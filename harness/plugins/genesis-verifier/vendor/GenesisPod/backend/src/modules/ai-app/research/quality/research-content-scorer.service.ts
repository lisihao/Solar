/**
 * Research Content Scorer Service
 *
 * 双层质量体系的 Layer 2：LLM 内容评分（语义维度）。
 *
 * 评分维度（每项 0–1 分）：
 *   factuality   — 事实准确性（引用是否支撑论点）
 *   depth        — 分析深度（是否有深入见解而非表面描述）
 *   coherence    — 逻辑连贯性（段落间逻辑是否通顺）
 *   completeness — 内容完整性（是否覆盖查询的核心方面）
 *
 * overall = 0.3 * factuality + 0.25 * depth + 0.25 * coherence + 0.2 * completeness
 *
 * 失败时返回默认 0.5 分（graceful degradation）。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ContentScore } from "./quality.types";

/** 传入 LLM 的最大报告字符数，防止 token 超限 */
const MAX_CONTENT_CHARS = 6000;

interface ContentScorerJsonResult {
  factuality: number;
  depth: number;
  coherence: number;
  completeness: number;
}

const DEFAULT_SCORE: ContentScore = {
  factuality: 0.5,
  depth: 0.5,
  coherence: 0.5,
  completeness: 0.5,
  overallScore: 0.5,
};

@Injectable()
export class ResearchContentScorerService {
  private readonly logger = new Logger(ResearchContentScorerService.name);

  constructor(@Optional() private readonly chatFacade?: ChatFacade) {}

  /**
   * 对报告内容进行 LLM 语义评分。
   *
   * @param content 报告 Markdown 内容
   * @param query   原始研究查询，用于评估内容完整性
   */
  async scoreContent(content: string, query: string): Promise<ContentScore> {
    if (!this.chatFacade) {
      this.logger.warn(
        "[ContentScorer] ChatFacade not available, returning default score",
      );
      return DEFAULT_SCORE;
    }

    try {
      const truncatedContent = content.slice(0, MAX_CONTENT_CHARS);

      const prompt = `你是一个研究报告质量评估专家。请对以下研究报告进行内容质量评分。

## 研究查询
${query}

## 报告内容
${truncatedContent}

## 评分维度说明
- factuality (事实准确性)：引用标记 [n] 是否支撑相应论点，声明是否有依据。
- depth (分析深度)：是否提供了深入的见解与分析，而非仅做表面描述或罗列事实。
- coherence (逻辑连贯性)：段落间逻辑是否通顺，上下文衔接是否自然，论证脉络是否清晰。
- completeness (内容完整性)：是否覆盖了研究查询的核心方面，重要子话题是否有所涉及。

## 输出格式（JSON）
{
  "factuality": 0.0-1.0,
  "depth": 0.0-1.0,
  "coherence": 0.0-1.0,
  "completeness": 0.0-1.0
}

只返回 JSON，不要其他内容。`;

      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        modelType: AIModelType.CHAT_FAST,
        taskProfile: { creativity: "deterministic", outputLength: "short" },
        responseFormat: "json",
        skipGuardrails: true,
      });

      const text = response.content ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn(
          "[ContentScorer] No JSON found in score response, returning default",
        );
        return DEFAULT_SCORE;
      }

      const parsed = JSON.parse(jsonMatch[0]) as ContentScorerJsonResult;

      const factuality = this.clamp(parsed.factuality);
      const depth = this.clamp(parsed.depth);
      const coherence = this.clamp(parsed.coherence);
      const completeness = this.clamp(parsed.completeness);
      const overallScore =
        0.3 * factuality + 0.25 * depth + 0.25 * coherence + 0.2 * completeness;

      return {
        factuality: Math.round(factuality * 100) / 100,
        depth: Math.round(depth * 100) / 100,
        coherence: Math.round(coherence * 100) / 100,
        completeness: Math.round(completeness * 100) / 100,
        overallScore: Math.round(overallScore * 100) / 100,
      };
    } catch (error) {
      this.logger.error(`[ContentScorer] scoreContent failed: ${error}`);
      return DEFAULT_SCORE;
    }
  }

  private clamp(value: unknown): number {
    const num = typeof value === "number" ? value : 0.5;
    return Math.max(0, Math.min(1, num));
  }
}

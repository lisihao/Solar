/**
 * Research Critique Service
 *
 * 双层质量体系的 Critique-lite：单轮改进建议（不自动 refine）。
 *
 * 仅在 Layer 2 overallScore < 0.6 时触发，生成改进建议供后续处理参考。
 * 失败时返回空建议（graceful degradation）。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import type { ContentScore, CritiqueResult } from "./quality.types";

/** 传入 LLM 的最大报告字符数 */
const MAX_CONTENT_CHARS = 6000;

interface CritiqueJsonResult {
  suggestions: string[];
  criticalIssues: string[];
  refinedSummary?: string;
}

const EMPTY_CRITIQUE: CritiqueResult = {
  suggestions: [],
  criticalIssues: [],
};

@Injectable()
export class ResearchCritiqueService {
  private readonly logger = new Logger(ResearchCritiqueService.name);

  constructor(@Optional() private readonly chatFacade?: ChatFacade) {}

  /**
   * 针对低分报告生成改进建议。
   *
   * 注意：此方法只生成建议，不执行内容改写。
   *
   * @param content 报告 Markdown 内容
   * @param query   原始研究查询
   * @param score   来自 ResearchContentScorerService 的评分结果
   */
  async critique(
    content: string,
    query: string,
    score: ContentScore,
  ): Promise<CritiqueResult> {
    if (!this.chatFacade) {
      this.logger.warn(
        "[Critique] ChatFacade not available, returning empty critique",
      );
      return EMPTY_CRITIQUE;
    }

    try {
      const truncatedContent = content.slice(0, MAX_CONTENT_CHARS);

      const weakDimensions = this.describeWeakDimensions(score);

      const prompt = `你是一个研究报告改进顾问。以下报告在内容质量评分中得分偏低，请提供具体的改进建议。

## 研究查询
${query}

## 报告内容
${truncatedContent}

## 已识别的薄弱维度
${weakDimensions}

## 任务
1. 列出 3-5 条具体可执行的改进建议（suggestions）。
2. 列出需要立即修正的严重问题（criticalIssues），如事实错误、重大逻辑漏洞等；若无则返回空数组。
3. 提供一段精简摘要（refinedSummary），概括报告的核心问题与改进方向（可选，100字以内）。

## 输出格式（JSON）
{
  "suggestions": ["建议1", "建议2", "建议3"],
  "criticalIssues": ["严重问题1"],
  "refinedSummary": "摘要"
}

只返回 JSON，不要其他内容。`;

      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        modelType: AIModelType.CHAT,
        taskProfile: { creativity: "low", outputLength: "short" },
        responseFormat: "json",
        skipGuardrails: true,
      });

      const text = response.content ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn(
          "[Critique] No JSON found in critique response, returning empty",
        );
        return EMPTY_CRITIQUE;
      }

      const parsed = JSON.parse(jsonMatch[0]) as CritiqueJsonResult;

      return {
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.filter((s) => typeof s === "string")
          : [],
        criticalIssues: Array.isArray(parsed.criticalIssues)
          ? parsed.criticalIssues.filter((s) => typeof s === "string")
          : [],
        refinedSummary:
          typeof parsed.refinedSummary === "string"
            ? parsed.refinedSummary
            : undefined,
      };
    } catch (error) {
      this.logger.error(`[Critique] critique failed: ${error}`);
      return EMPTY_CRITIQUE;
    }
  }

  /**
   * 将低分维度转为文字描述，帮助 LLM 聚焦问题所在。
   */
  private describeWeakDimensions(score: ContentScore): string {
    const dimensionLabels: Record<
      keyof Omit<ContentScore, "overallScore">,
      string
    > = {
      factuality: `事实准确性 (factuality=${score.factuality})`,
      depth: `分析深度 (depth=${score.depth})`,
      coherence: `逻辑连贯性 (coherence=${score.coherence})`,
      completeness: `内容完整性 (completeness=${score.completeness})`,
    };

    const WEAK_THRESHOLD = 0.6;
    const weakDims = (
      Object.keys(dimensionLabels) as Array<
        keyof Omit<ContentScore, "overallScore">
      >
    ).filter((key) => score[key] < WEAK_THRESHOLD);

    if (weakDims.length === 0) {
      return `综合评分偏低 (overall=${score.overallScore})，各维度尚可但仍有提升空间。`;
    }

    return weakDims.map((key) => `- ${dimensionLabels[key]}`).join("\n");
  }
}

/**
 * Critique-Refine Service
 *
 * P1 优化：批评-改进循环服务
 * 参考：Reflexion (Shinn et al., 2023)
 *
 * ★ 重构：使用 chatStructured<T>() 替代 chat() + extractJsonFromAIResponse()，
 *   合并 3 处重复的 shouldStop/getStopReason/determineStopReason 为 1 个方法。
 */

// Sediment from {app} (2026-04-29) — ai-harness/evaluation/critique/
// 来源: ai-app/{app}/services/quality/critique-refine.service.ts
// + 类型来源: ai-app/{app}/types/quality.types.ts
// TI 仍在使用原 service；本副本由 {app} 等新业务通过 ai-harness/facade 调用。
import { Injectable, Logger } from "@nestjs/common";
// ★ 内部相对路径（避免 ai-harness 自循环 import facade）
import { ChatFacade } from "../../facade/domain/chat.facade";
import { validateLatexDelimiters } from "../../../../common/utils/latex-delimiter-validator";
import {
  CritiqueCategory,
  CritiqueSeverity,
  CritiqueItem,
  CritiqueResult,
  RefineResult,
  CritiqueRefineIteration,
  CritiqueRefineLoopResult,
  CritiqueRefineConfig,
  DEFAULT_CRITIQUE_REFINE_CONFIG,
} from "./quality.types";

export interface CritiqueRefineRequest {
  content: string;
  context: {
    topicName: string;
    dimensionName: string;
    targetAudience?: string;
    qualityExpectation?: string;
  };
  config?: Partial<CritiqueRefineConfig>;
}

/** chatStructured schema for critique response */
interface RawCritiqueResponse {
  overallScore: number;
  categoryScores: Record<string, number>;
  items: Array<{
    id?: string;
    category: string;
    severity: string;
    location?: { type: string; reference: string; quote?: string };
    issue?: string;
    suggestion?: string;
    exampleFix?: string;
    relatedEvidence?: unknown;
  }>;
  strengths: string[];
  improvementPriorities: string[];
  summary: string;
}

/** chatStructured schema for refine response */
interface RawRefineResponse {
  refinedContent: string;
  changesApplied: Array<{
    critiqueItemId?: string;
    original?: string;
    revised?: string;
    reason?: string;
    changeType?: string;
  }>;
  remainingIssues: string[];
  refinementSummary: string;
}

/** Stop evaluation result */
type StopReason =
  | "target_reached"
  | "no_critical_issues"
  | "no_improvement"
  | "score_converged"
  | "max_iterations";

const CRITIQUE_SCHEMA = {
  type: "object" as const,
  required: ["overallScore", "items", "summary"],
  additionalProperties: false as const,
  properties: {
    overallScore: { type: "number" as const },
    categoryScores: {
      type: "object" as const,
      additionalProperties: { type: "number" as const },
    },
    items: { type: "array" as const, items: { type: "string" as const } },
    strengths: { type: "array" as const, items: { type: "string" as const } },
    improvementPriorities: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    summary: { type: "string" as const },
  },
};

const REFINE_SCHEMA = {
  type: "object" as const,
  required: ["refinedContent", "changesApplied"],
  additionalProperties: false as const,
  properties: {
    refinedContent: { type: "string" as const },
    changesApplied: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    remainingIssues: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    refinementSummary: { type: "string" as const },
  },
};

@Injectable()
export class CritiqueRefineService {
  private readonly logger = new Logger(CritiqueRefineService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 执行完整的批评-改进循环
   */
  async runCritiqueRefineLoop(
    request: CritiqueRefineRequest,
  ): Promise<CritiqueRefineLoopResult> {
    const startTime = Date.now();
    const config = { ...DEFAULT_CRITIQUE_REFINE_CONFIG, ...request.config };

    this.logger.log(
      `[runCritiqueRefineLoop] Starting for dimension: ${request.context.dimensionName}`,
    );

    const iterations: CritiqueRefineIteration[] = [];
    let currentContent = request.content;
    let totalChanges = 0;

    for (let i = 0; i < config.maxIterations; i++) {
      const iterationNumber = i + 1;

      this.logger.log(
        `[runCritiqueRefineLoop] Iteration ${iterationNumber}/${config.maxIterations}`,
      );

      // 1. 批评当前内容
      const critique = await this.critiqueContent(
        currentContent,
        request.context,
        config,
      );

      // 2. 检查是否需要继续（统一 stop 判断）
      const stopReason = this.evaluateStopCondition(
        critique,
        config,
        iterations,
      );
      if (stopReason) {
        this.logger.log(
          `[runCritiqueRefineLoop] Stopping at iteration ${iterationNumber}: ${stopReason}`,
        );
        break;
      }

      // 3. 改进内容
      const refinement = await this.refineContent(
        currentContent,
        critique,
        request.context,
      );

      // 4. 记录迭代
      iterations.push({
        iterationNumber,
        critique,
        refinement,
        contentBefore: currentContent,
        contentAfter: refinement.refinedContent,
        scoreChange: refinement.scoreImprovement,
        timestamp: new Date(),
      });

      totalChanges += refinement.changesApplied.length;
      currentContent = refinement.refinedContent;

      // 5. 检查改进幅度
      if (refinement.scoreImprovement < config.minImprovementThreshold) {
        this.logger.log(
          `[runCritiqueRefineLoop] Stopping: improvement ${refinement.scoreImprovement.toFixed(3)} below threshold`,
        );
        break;
      }
    }

    // 最终评估
    const finalCritique = await this.critiqueContent(
      currentContent,
      request.context,
      config,
    );

    const initialScore =
      iterations.length > 0
        ? iterations[0].critique.overallScore
        : finalCritique.overallScore;
    const finalScore = finalCritique.overallScore;

    const stopReason =
      this.evaluateStopCondition(finalCritique, config, iterations) ||
      "max_iterations";

    const result: CritiqueRefineLoopResult = {
      finalContent: currentContent,
      iterations,
      finalScore,
      totalScoreImprovement: finalScore - initialScore,
      totalChanges,
      reachedTargetScore: finalScore >= config.targetScore,
      stopReason: this.mapStopReasonToLoopResult(stopReason),
      metadata: {
        totalIterations: iterations.length,
        totalTimeMs: Date.now() - startTime,
        tokensUsed: 0,
      },
    };

    this.logger.log(
      `[runCritiqueRefineLoop] Completed: ${iterations.length} iterations, ` +
        `score ${initialScore.toFixed(2)} -> ${finalScore.toFixed(2)}`,
    );

    return result;
  }

  /**
   * 批评内容 — 使用 chatStructured<T>() 替代手动 JSON 提取
   */
  async critiqueContent(
    content: string,
    context: CritiqueRefineRequest["context"],
    config: CritiqueRefineConfig,
  ): Promise<CritiqueResult> {
    const userPrompt = `请对以下研究内容进行多维度批评。

## 研究背景
- 主题：${context.topicName}
- 维度：${context.dimensionName}
- 目标受众：${context.targetAudience || "专业人士"}
- 质量期望：${context.qualityExpectation || "高质量研究报告"}

## 待审核内容
${content}

请按 content-critique skill 的评审维度体系（8类）和严重度分级（4级）进行评审，输出 JSON。`;

    try {
      const response =
        await this.chatFacade.chatStructured<RawCritiqueResponse>({
          messages: [{ role: "user", content: userPrompt }],
          additionalSkills: ["content-critique"],
          operationName: "内容批评",
          skipGuardrails: true,
          taskProfile: {
            creativity: "low",
            outputLength: "long",
            reasoningDepth: "moderate",
          },
          schema: CRITIQUE_SCHEMA,
          strictMode: false,
          throwOnParseError: false,
          maxRetries: 1,
        });

      if (response.data) {
        return this.parseCritiqueResponse(response.data, config);
      }
    } catch (error) {
      this.logger.error(`[critiqueContent] Error: ${error}`);
    }

    return this.createFallbackCritique(config);
  }

  /**
   * 改进内容 — 使用 chatStructured<T>() 替代手动 JSON 提取
   */
  async refineContent(
    content: string,
    critique: CritiqueResult,
    context: CritiqueRefineRequest["context"],
  ): Promise<RefineResult> {
    // 按优先级排序，只处理 critical + major
    const issuesToFix = [...critique.items]
      .sort((a, b) => {
        const order = {
          [CritiqueSeverity.CRITICAL]: 0,
          [CritiqueSeverity.MAJOR]: 1,
          [CritiqueSeverity.MINOR]: 2,
          [CritiqueSeverity.SUGGESTION]: 3,
        };
        return order[a.severity] - order[b.severity];
      })
      .filter(
        (issue) =>
          issue.severity === CritiqueSeverity.CRITICAL ||
          issue.severity === CritiqueSeverity.MAJOR,
      );

    if (issuesToFix.length === 0) {
      return {
        refinedContent: content,
        changesApplied: [],
        remainingIssues: critique.items.filter(
          (i) =>
            i.severity === CritiqueSeverity.MINOR ||
            i.severity === CritiqueSeverity.SUGGESTION,
        ),
        scoreImprovement: 0,
        refinementSummary: "无需修改，内容已达到质量标准",
      };
    }

    const issuesText = issuesToFix
      .map(
        (issue, i) =>
          `${i + 1}. [${issue.severity}] ${issue.issue}\n   位置: ${issue.location.reference}\n   建议: ${issue.suggestion}${issue.exampleFix ? `\n   示例: ${issue.exampleFix}` : ""}`,
      )
      .join("\n\n");

    const userPrompt = `请根据以下批评意见修改内容。

## 研究背景
- 主题：${context.topicName}
- 维度：${context.dimensionName}

## 原始内容
${content}

## 需要修正的问题
${issuesText}

请按 content-refine skill 的改进原则（优先级聚焦、最小变更、精准定位、逻辑连贯）进行修改，输出 JSON。`;

    try {
      const response = await this.chatFacade.chatStructured<RawRefineResponse>({
        messages: [{ role: "user", content: userPrompt }],
        additionalSkills: ["content-refine"],
        operationName: "内容修订",
        skipGuardrails: true,
        taskProfile: {
          creativity: "low",
          outputLength: "long",
          reasoningDepth: "moderate",
        },
        schema: REFINE_SCHEMA,
        strictMode: false,
        throwOnParseError: false,
        maxRetries: 1,
      });

      if (response.data) {
        return this.parseRefineResponse(
          response.data,
          content,
          critique,
          issuesToFix,
        );
      }
    } catch (error) {
      this.logger.error(`[refineContent] Error: ${error}`);
    }

    return {
      refinedContent: content,
      changesApplied: [],
      remainingIssues: critique.items,
      scoreImprovement: 0,
      refinementSummary: "改进失败，保留原内容",
    };
  }

  /**
   * ★ 统一的停止条件评估（合并原 shouldStop + getStopReason + determineStopReason）
   * 返回 StopReason 或 null（不应停止）
   */
  private evaluateStopCondition(
    critique: CritiqueResult,
    config: CritiqueRefineConfig,
    iterations: CritiqueRefineIteration[],
  ): StopReason | null {
    // 达到目标分数
    if (critique.overallScore >= config.targetScore) {
      return "target_reached";
    }

    // 无关键问题
    if (config.stopOnNoCritical && critique.criticalIssues.length === 0) {
      return "no_critical_issues";
    }

    // 无改进
    if (config.stopOnNoImprovement && iterations.length > 0) {
      const lastIteration = iterations[iterations.length - 1];
      if (lastIteration.scoreChange < config.minImprovementThreshold) {
        return "no_improvement";
      }
    }

    // 收敛检测：3次迭代分数在±0.05范围内波动
    if (iterations.length >= 3) {
      const recentScores = iterations
        .slice(-3)
        .map((it) => it.critique.overallScore);
      const minScore = Math.min(...recentScores);
      const maxScore = Math.max(...recentScores);
      if (maxScore - minScore < 0.05) {
        this.logger.log(
          `[evaluateStopCondition] Score convergence detected: ${recentScores.map((s) => s.toFixed(3)).join(", ")}`,
        );
        return "score_converged";
      }
    }

    return null;
  }

  /**
   * 将内部 StopReason 映射到 CritiqueRefineLoopResult['stopReason'] 兼容值
   */
  private mapStopReasonToLoopResult(
    reason: StopReason,
  ): CritiqueRefineLoopResult["stopReason"] {
    switch (reason) {
      case "target_reached":
        return "target_reached";
      case "no_critical_issues":
        return "no_critical_issues";
      case "no_improvement":
      case "score_converged":
        return "no_improvement";
      case "max_iterations":
        return "max_iterations";
    }
  }

  /**
   * 解析 critique 结构化响应
   */
  private parseCritiqueResponse(
    data: RawCritiqueResponse,
    config: CritiqueRefineConfig,
  ): CritiqueResult {
    const items: CritiqueItem[] = (data.items || []).map(
      (item, index: number) => ({
        id: item.id || `issue-${index + 1}`,
        category: this.parseCategory(item.category),
        severity: this.parseSeverity(item.severity),
        location: item.location
          ? {
              type: item.location.type as
                | "paragraph"
                | "sentence"
                | "section"
                | "document",
              reference: item.location.reference,
              quote: item.location.quote,
            }
          : { type: "document" as const, reference: "全文" },
        issue: item.issue || "",
        suggestion: item.suggestion || "",
        exampleFix: item.exampleFix,
        relatedEvidence: item.relatedEvidence
          ? (item.relatedEvidence as string[])
          : undefined,
      }),
    );

    const criticalIssues = items.filter(
      (item) => item.severity === CritiqueSeverity.CRITICAL,
    );
    const overallScore = Math.max(0, Math.min(1, data.overallScore || 0.5));

    return {
      overallScore,
      categoryScores: this.normalizeCategoryScores(
        data.categoryScores,
        config.enabledCategories,
      ),
      items,
      strengths: data.strengths || [],
      criticalIssues,
      improvementPriorities: data.improvementPriorities || [],
      summary: data.summary || "",
      meetsQualityStandard: this.checkQualityStandard(
        overallScore,
        criticalIssues.length,
        items.filter((i) => i.severity === CritiqueSeverity.MAJOR).length,
        config,
      ),
      suggestedRefinementRounds: this.suggestRefinementRounds(
        overallScore,
        criticalIssues.length,
      ),
    };
  }

  /**
   * 解析 refine 结构化响应
   */
  private parseRefineResponse(
    data: RawRefineResponse,
    originalContent: string,
    critique: CritiqueResult,
    issuesToFix: CritiqueItem[],
  ): RefineResult {
    const remainingIssueIds = new Set(data.remainingIssues || []);
    const remainingIssues = critique.items.filter(
      (item) =>
        remainingIssueIds.has(item.id) ||
        item.severity === CritiqueSeverity.MINOR ||
        item.severity === CritiqueSeverity.SUGGESTION,
    );

    const fixedCount = issuesToFix.length - remainingIssueIds.size;
    const scoreImprovement = fixedCount * 0.05 * (1 - critique.overallScore);

    // ★ LaTeX safety: reject refinement that introduces new LaTeX damage.
    //   Content-refine is supposed to improve prose/logic, not touch math;
    //   if the refined version has MORE delimiter issues than the original,
    //   the LLM regressed formulas — fall back to originalContent.
    const candidateRefined = data.refinedContent || originalContent;
    const originalIssues =
      validateLatexDelimiters(originalContent).issues.length;
    const refinedIssues =
      validateLatexDelimiters(candidateRefined).issues.length;
    const safeRefined =
      refinedIssues > originalIssues ? originalContent : candidateRefined;
    if (refinedIssues > originalIssues) {
      this.logger.warn(
        `[critique-refine] Refined content introduced LaTeX damage (${originalIssues} -> ${refinedIssues} issues), reverting to original`,
      );
    }

    return {
      refinedContent: safeRefined,
      changesApplied: (data.changesApplied || []).map((change) => ({
        critiqueItemId: change.critiqueItemId || "",
        original: change.original || "",
        revised: change.revised || "",
        reason: change.reason || "",
        changeType: (change.changeType ||
          "improvement") as RefineResult["changesApplied"][0]["changeType"],
      })),
      remainingIssues,
      scoreImprovement: Math.max(0, Math.min(0.3, scoreImprovement)),
      refinementSummary:
        data.refinementSummary || `修复了 ${fixedCount} 个问题`,
    };
  }

  private parseCategory(category: string): CritiqueCategory {
    const mapping: Record<string, CritiqueCategory> = {
      factual: CritiqueCategory.FACTUAL,
      logical: CritiqueCategory.LOGICAL,
      coverage: CritiqueCategory.COVERAGE,
      clarity: CritiqueCategory.CLARITY,
      style: CritiqueCategory.STYLE,
      depth: CritiqueCategory.DEPTH,
      relevance: CritiqueCategory.RELEVANCE,
      citation: CritiqueCategory.CITATION,
    };
    return mapping[category?.toLowerCase()] || CritiqueCategory.FACTUAL;
  }

  private parseSeverity(severity: string): CritiqueSeverity {
    const mapping: Record<string, CritiqueSeverity> = {
      critical: CritiqueSeverity.CRITICAL,
      major: CritiqueSeverity.MAJOR,
      minor: CritiqueSeverity.MINOR,
      suggestion: CritiqueSeverity.SUGGESTION,
    };
    return mapping[severity?.toLowerCase()] || CritiqueSeverity.MINOR;
  }

  private normalizeCategoryScores(
    scores: Record<string, number>,
    enabledCategories: CritiqueCategory[],
  ): Record<CritiqueCategory, number> {
    const result = {} as Record<CritiqueCategory, number>;
    for (const category of enabledCategories) {
      result[category] = Math.max(0, Math.min(1, scores[category] || 0.5));
    }
    return result;
  }

  private checkQualityStandard(
    overallScore: number,
    criticalCount: number,
    majorCount: number,
    config: CritiqueRefineConfig,
  ): boolean {
    return (
      overallScore >= config.qualityStandard.minOverallScore &&
      criticalCount <= config.qualityStandard.maxCriticalIssues &&
      majorCount <= config.qualityStandard.maxMajorIssues
    );
  }

  private suggestRefinementRounds(
    overallScore: number,
    criticalCount: number,
  ): number {
    if (criticalCount > 0) return 3;
    if (overallScore < 0.6) return 3;
    if (overallScore < 0.75) return 2;
    if (overallScore < 0.85) return 1;
    return 0;
  }

  private createFallbackCritique(config: CritiqueRefineConfig): CritiqueResult {
    const categoryScores = {} as Record<CritiqueCategory, number>;
    for (const category of config.enabledCategories) {
      categoryScores[category] = 0.6;
    }

    return {
      overallScore: 0.6,
      categoryScores,
      items: [],
      strengths: [],
      criticalIssues: [],
      improvementPriorities: ["建议人工审核"],
      summary: "自动批评失败，建议人工审核",
      meetsQualityStandard: false,
      suggestedRefinementRounds: 1,
    };
  }
}

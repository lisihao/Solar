/**
 * Research Reflection Service
 *
 * 研究反思服务：在研究过程中评估数据质量，决定是否需要补充搜索
 *
 * 核心功能:
 * 1. 评估当前收集的证据是否足够覆盖研究目标
 * 2. 识别信息缺口（哪些方面证据不足）
 * 3. 生成补充搜索建议
 *
 * 解决的问题:
 * - 单次搜索可能无法覆盖所有研究维度
 * - 某些细分领域可能证据不足
 * - 提供智能的补充搜索决策
 */

import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import type { EnrichedEvidenceData } from "../../types/research.types";
import type {
  ReflectionResult,
  ReflectionContext,
} from "../../types/collaboration.types";

@Injectable()
export class ResearchReflectionService {
  private readonly logger = new Logger(ResearchReflectionService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 评估当前收集的证据是否足够
   *
   * @param context 反思上下文
   * @returns 反思结果
   */
  async evaluateEvidence(
    context: ReflectionContext,
  ): Promise<ReflectionResult> {
    this.logger.log(
      `[evaluateEvidence] Evaluating ${context.evidence.length} evidence items for dimension: ${context.dimensionName}`,
    );

    const prompt = this.buildReflectionPrompt(context);

    try {
      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        operationName: "研究反思",
        modelType: AIModelType.CHAT_FAST,
        skipGuardrails: true, // 内部系统调用，证据评估含外部搜索数据
        taskProfile: {
          creativity: "low",
          outputLength: "short",
        },
      });

      const result = this.parseReflectionResult(response.content);

      this.logger.log(
        `[evaluateEvidence] Result: ${result.decision} (score: ${result.score}), gaps: ${result.gaps.length}`,
      );

      return result;
    } catch (error) {
      this.logger.warn(
        `[evaluateEvidence] Failed to evaluate: ${error instanceof Error ? error.message : String(error)}`,
      );

      // 评估失败时，默认认为证据充足，避免阻塞流程
      return {
        decision: "sufficient",
        score: 70,
        gaps: [],
        reasoning: "评估过程出现异常，默认继续执行",
      };
    }
  }

  /**
   * 快速检查：证据数量和质量是否达到最低要求
   * 用于决定是否需要进行完整的 AI 评估
   */
  quickCheck(evidence: EnrichedEvidenceData[]): {
    needsFullEvaluation: boolean;
    reason: string;
  } {
    // 检查证据数量
    if (evidence.length < 3) {
      return {
        needsFullEvaluation: true,
        reason: `证据数量不足 (${evidence.length}/3)`,
      };
    }

    // 检查有效 URL 比例
    const validCount = evidence.filter(
      (e) => e.contentSource === "fetched" || e.snippet,
    ).length;
    const validRatio = validCount / evidence.length;

    if (validRatio < 0.5) {
      return {
        needsFullEvaluation: true,
        reason: `有效内容比例过低 (${Math.round(validRatio * 100)}%)`,
      };
    }

    // 检查内容长度
    const avgContentLength =
      evidence.reduce(
        (sum, e) => sum + (e.fullContent?.length || e.snippet?.length || 0),
        0,
      ) / evidence.length;

    if (avgContentLength < 200) {
      return {
        needsFullEvaluation: true,
        reason: `平均内容长度过短 (${Math.round(avgContentLength)} chars)`,
      };
    }

    return {
      needsFullEvaluation: false,
      reason: "基础检查通过",
    };
  }

  /**
   * 生成补充搜索查询
   */
  async suggestAdditionalQueries(
    dimensionName: string,
    gaps: string[],
  ): Promise<string[]> {
    if (gaps.length === 0) {
      return [];
    }

    const currentYear = new Date().getFullYear();

    // 简单策略：基于缺口生成查询
    return gaps
      .slice(0, 3)
      .map((gap) => `${dimensionName} ${gap} ${currentYear}`);
  }

  /**
   * 构建反思提示词
   */
  private buildReflectionPrompt(context: ReflectionContext): string {
    const evidenceSummary = context.evidence
      .slice(0, 10)
      .map(
        (e, i) =>
          `${i + 1}. [${e.sourceType || "web"}] ${e.title} - ${e.contentSource === "fetched" ? "完整内容" : "摘要"}`,
      )
      .join("\n");

    const goalsText = context.researchGoals?.length
      ? context.researchGoals.map((g, i) => `${i + 1}. ${g}`).join("\n")
      : "未指定具体研究目标";

    return `你是一位研究质量评估专家，请评估以下研究维度的证据收集情况。

## 研究维度
- 名称: ${context.dimensionName}
- 描述: ${context.dimensionDescription || "无"}

## 研究目标
${goalsText}

## 已收集的证据 (${context.evidence.length} 条)
${evidenceSummary}
${context.evidence.length > 10 ? `...还有 ${context.evidence.length - 10} 条` : ""}

## 时效性要求
${context.freshnessRequirement || "不限制"}

---

请评估：
1. 当前证据是否足够支撑对该维度的深入分析？
2. 是否存在明显的信息缺口？
3. 是否需要补充搜索？

以 JSON 格式输出：
{
  "decision": "sufficient" | "need_more" | "pivot",
  "score": 0-100,
  "gaps": ["缺口1", "缺口2"],
  "reasoning": "评估理由（50字内）",
  "suggestedQueries": ["补充查询1", "补充查询2"]
}

注意：
- score >= 70 且无明显缺口时，decision 应为 "sufficient"
- 只有在缺口严重影响分析时才建议 "need_more"
- "pivot" 仅用于证据完全不相关的情况`;
  }

  /**
   * 解析反思结果
   */
  private parseReflectionResult(content: string): ReflectionResult {
    try {
      // 尝试提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new InternalServerErrorException("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        decision: parsed.decision || "sufficient",
        score: typeof parsed.score === "number" ? parsed.score : 70,
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
        reasoning: parsed.reasoning || "无",
        suggestedQueries: Array.isArray(parsed.suggestedQueries)
          ? parsed.suggestedQueries
          : undefined,
      };
    } catch {
      this.logger.warn(
        "[parseReflectionResult] Failed to parse response, using defaults",
      );
      return {
        decision: "sufficient",
        score: 70,
        gaps: [],
        reasoning: "解析失败，默认通过",
      };
    }
  }
}

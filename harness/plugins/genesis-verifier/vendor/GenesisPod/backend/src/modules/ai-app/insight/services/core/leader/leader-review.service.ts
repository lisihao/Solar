/**
 * Leader Review Service
 *
 * 负责任务审核和验证相关逻辑：
 * - reviewTaskResult: AI-based task result review
 * - extractClaims: V5 事实断言提取
 * - verifyHypotheses: V5 假设验证
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { LeaderDecisionType, AIModelType } from "@prisma/client";
import { extractJsonFromResponse } from "../../../utils/extract-json.utils";
import { toPrismaJson } from "@/common/utils/prisma-json.utils";
import { LEADER_REVIEW_PROMPT } from "../../../prompts";
import {
  type ReviewDecision,
  type LeaderModelInfo,
} from "../../../types/leader.types";

@Injectable()
export class LeaderReviewService {
  private readonly logger = new Logger(LeaderReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatFacade: ChatFacade,
  ) {}

  /**
   * Leader 审核任务结果
   */
  async reviewTaskResult(
    missionId: string,
    taskId: string,
    result: string | Record<string, unknown>,
    dimensionName?: string,
  ): Promise<ReviewDecision> {
    this.logger.log(`[reviewTaskResult] Reviewing task ${taskId}`);

    // 获取推理模型
    const leaderModel = await this.getReasoningModel();
    if (!leaderModel) {
      throw new ServiceUnavailableException(
        "No reasoning model available for Leader",
      );
    }

    // 构建 prompt
    const prompt = LEADER_REVIEW_PROMPT.replace(
      "{taskType}",
      "dimension_research",
    )
      .replace("{dimensionName}", dimensionName || "未知")
      .replace("{result}", JSON.stringify(result, null, 2));

    // 调用 AI 审核
    const startTime = Date.now();
    let response;
    try {
      response = await this.chatFacade.chat({
        messages: [
          {
            role: "system",
            content: "你是研究质量审核专家，请输出 JSON 格式的审核决策。",
          },
          { role: "user", content: prompt },
        ],
        operationName: "章节审核",
        model: leaderModel.modelId,
        skipGuardrails: true, // 内部系统调用，非用户输入
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
          reasoningDepth: "moderate",
        },
      });
    } catch (reviewError) {
      this.logger.error(
        `[reviewTaskResult] AI call failed: ${reviewError instanceof Error ? reviewError.message : reviewError}`,
      );
      return {
        taskId,
        status: "approved",
        feedback: "审核失败（AI 调用异常，默认通过）",
      };
    }
    const latencyMs = Date.now() - startTime;

    // 解析审核结果
    const review = extractJsonFromResponse<{
      status: "approved" | "needs_revision" | "rejected";
      feedback?: string;
      suggestions?: string[];
      revisionInstructions?: string;
      revisionNeeded?: boolean;
    }>(response.content, this.logger, "status"); // requiredKey for validation

    if (!review) {
      this.logger.warn(
        "[reviewTaskResult] Failed to parse review, defaulting to approved",
      );
      return {
        taskId,
        status: "approved",
        feedback: "审核通过（解析失败，默认通过）",
      };
    }

    // 记录决策
    await this.recordDecision(
      missionId,
      LeaderDecisionType.REVIEW,
      {
        taskId,
        dimensionName,
      },
      review,
      review.feedback || "",
      leaderModel.modelId,
      latencyMs,
    );

    return {
      taskId,
      status: review.status ?? "approved",
      feedback: review.feedback || "",
      suggestions: review.suggestions,
      revisionInstructions: review.revisionInstructions,
    };
  }

  /**
   * V5 L3: 从章节内容中提取事实断言
   * 使用 CHAT_FAST 模型批量处理
   */
  async extractClaims(
    sectionId: string,
    sectionContent: string,
  ): Promise<import("../../../types/research-depth.types").ExtractedClaim[]> {
    this.logger.log(
      `[extractClaims] Extracting claims from section ${sectionId}`,
    );

    const { CLAIM_EXTRACTION_PROMPT } =
      await import("../../../prompts/research-depth.prompt");
    const prompt = CLAIM_EXTRACTION_PROMPT.replace(
      "{sectionContent}",
      sectionContent.substring(0, 4000),
    ).replace("{sectionId}", sectionId);

    try {
      const result = await this.chatFacade.chatStructured<{
        claims: import("../../../types/research-depth.types").ExtractedClaim[];
      }>({
        messages: [{ role: "user", content: prompt }],
        operationName: "断言提取",
        systemPrompt: "你是事实核查专家，精确提取可验证的事实断言。",
        schema: {
          type: "object",
          required: ["claims"],
          additionalProperties: false,
          properties: {
            claims: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string" },
                  statement: { type: "string" },
                  sectionId: { type: "string" },
                  sourceEvidenceIndices: {
                    type: "array",
                    items: { type: "number" },
                  },
                  importance: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                  },
                },
                required: [
                  "id",
                  "statement",
                  "sectionId",
                  "sourceEvidenceIndices",
                  "importance",
                ],
              },
            },
          },
        },
        modelType: AIModelType.CHAT_FAST,
        skipGuardrails: true,
        throwOnParseError: false,
        taskProfile: {
          creativity: "deterministic",
          outputLength: "medium",
          reasoningDepth: "moderate",
        },
      });

      if (result.data?.claims) {
        this.logger.log(
          `[extractClaims] Extracted ${result.data.claims.length} claims from section ${sectionId}`,
        );
        return result.data.claims;
      }

      this.logger.warn(
        `[extractClaims] Failed to parse claims for section ${sectionId}. Raw (first 300 chars): ${result.rawContent?.slice(0, 300)}`,
      );
      return [];
    } catch (error) {
      this.logger.error(
        `[extractClaims] Error extracting claims for section ${sectionId}: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  /**
   * V5 L3: 验证研究假设
   * 根据收集到的证据验证 L1 阶段提出的假设
   */
  async verifyHypotheses(
    hypotheses: import("../../../types/research-depth.types").ResearchHypothesis[],
    evidenceSummary: string,
  ): Promise<
    import("../../../types/research-depth.types").HypothesisVerificationResult[]
  > {
    if (hypotheses.length === 0) return [];

    this.logger.log(
      `[verifyHypotheses] Verifying ${hypotheses.length} hypotheses`,
    );

    const { HYPOTHESIS_VERIFICATION_PROMPT } =
      await import("../../../prompts/research-depth.prompt");
    const prompt = HYPOTHESIS_VERIFICATION_PROMPT.replace(
      "{hypothesesJson}",
      JSON.stringify(hypotheses, null, 2),
    ).replace("{evidenceSummary}", evidenceSummary.substring(0, 6000));

    try {
      const result = await this.chatFacade.chatStructured<{
        results: import("../../../types/research-depth.types").HypothesisVerificationResult[];
      }>({
        messages: [{ role: "user", content: prompt }],
        operationName: "假设验证",
        systemPrompt: "你是研究方法论专家，严谨验证研究假设。",
        schema: {
          type: "object",
          required: ["results"],
          additionalProperties: false,
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  hypothesisId: { type: "string" },
                  status: {
                    type: "string",
                    enum: [
                      "supported",
                      "refuted",
                      "partially_supported",
                      "inconclusive",
                    ],
                  },
                  supportingEvidence: { type: "string" },
                  contradictingEvidence: { type: "string" },
                  confidence: { type: "number" },
                  refinedStatement: { type: "string" },
                },
                required: [
                  "hypothesisId",
                  "status",
                  "supportingEvidence",
                  "contradictingEvidence",
                  "confidence",
                ],
              },
            },
          },
        },
        modelType: AIModelType.CHAT_FAST,
        skipGuardrails: true,
        strictMode: false,
        throwOnParseError: false,
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
          reasoningDepth: "moderate",
        },
      });

      if (result.data?.results) {
        this.logger.log(
          `[verifyHypotheses] Verified ${result.data.results.length} hypotheses`,
        );
        return result.data.results;
      }

      this.logger.warn(
        `[verifyHypotheses] Failed to parse hypothesis verification results`,
      );
      return [];
    } catch (error) {
      this.logger.error(`[verifyHypotheses] Error: ${error}`);
      return [];
    }
  }

  /**
   * 记录 Leader 决策
   */
  private async recordDecision(
    missionId: string,
    type: LeaderDecisionType,
    input: Record<string, unknown>,
    decision: Record<string, unknown>,
    reasoning: string,
    modelUsed?: string,
    latencyMs?: number,
  ): Promise<void> {
    try {
      await this.prisma.leaderDecision.create({
        data: {
          missionId,
          type,
          input: toPrismaJson(input),
          decision: toPrismaJson(decision),
          reasoning,
          modelUsed,
          latencyMs,
        },
      });
    } catch (error) {
      this.logger.error(`[recordDecision] Failed to record decision: ${error}`);
    }
  }

  /**
   * 获取推理模型信息（本地副本）
   */
  private async getReasoningModel(): Promise<LeaderModelInfo | null> {
    const modelInfo = await this.chatFacade.getReasoningModel();

    if (!modelInfo) {
      return null;
    }

    return {
      modelId: modelInfo.id,
      modelName: modelInfo.name,
      provider: modelInfo.provider,
      isReasoning: modelInfo.isReasoning ?? false,
    };
  }
}

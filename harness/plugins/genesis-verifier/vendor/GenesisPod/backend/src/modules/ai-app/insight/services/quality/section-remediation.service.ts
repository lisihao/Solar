/**
 * Section Remediation Service
 *
 * 根据 SectionSelfEvalService 的评估结果，对低分 section 执行定向补救。
 * 核心设计：
 * - 所有弱维度合并为一条补救指令（单次 LLM 调用）
 * - 低分 section 自动升级到 STRONG tier 模型补救
 * - 非阻断：try-catch 包裹，补救失败保留原内容
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade, AIFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import type {
  RemediationAction,
  RemediationResult,
} from "../../types/quality.types";
import { classifyModelTier, ModelTier } from "../../config/model-tier.config";
import { validateLatexDelimiters } from "@/common/utils/latex-delimiter-validator";

@Injectable()
export class SectionRemediationService {
  private readonly logger = new Logger(SectionRemediationService.name);

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly engineFacade: AIFacade,
  ) {}

  /**
   * 对 section 执行定向补救
   *
   * @param content 原始内容
   * @param actions 需要执行的补救动作列表
   * @param originalModelId 原始写作模型 ID
   * @param language 语言 (zh/en)
   * @returns 补救结果（含新内容或跳过原因）
   */
  async remediate(input: {
    content: string;
    sectionTitle: string;
    actions: RemediationAction[];
    originalModelId?: string;
    /** 预解析的补救模型 ID（避免重复调用 selectModel） */
    resolvedRemediationModelId?: string;
    language?: string;
  }): Promise<RemediationResult> {
    const {
      content,
      sectionTitle,
      actions,
      originalModelId,
      resolvedRemediationModelId,
      language,
    } = input;

    if (actions.length === 0) {
      return {
        content,
        actionsApplied: [],
        skipped: true,
        skipReason: "no_actions_needed",
      };
    }

    try {
      // 使用预解析的模型 ID，或重新解析
      const remediationModelId =
        resolvedRemediationModelId ??
        (await this.resolveRemediationModel(originalModelId ?? ""));

      const lang = language?.startsWith("en") ? "en" : "zh";
      const actionInstructions = actions
        .map((a) => `- [${a.dimension} 得分 ${a.score}/10] ${a.guidance}`)
        .join("\n");

      const prompt =
        lang === "zh"
          ? `你是一位资深报告编辑。以下章节在质量自评中存在薄弱环节，请在保留原有内容框架和引用的基础上进行定向改进。

章节标题：${sectionTitle}

需改进的维度：
${actionInstructions}

原始内容：
${content}

要求：
1. 保留原文的引用标记（如 [1]、[2]）和核心论点
2. 只在薄弱维度上增强，不要大幅重写无关段落
3. 直接输出改进后的完整章节内容，不要加任何解释或前缀`
          : `You are a senior report editor. The following section has weak areas identified by quality self-evaluation. Improve it while preserving the original structure and citations.

Section: ${sectionTitle}

Areas to improve:
${actionInstructions}

Original content:
${content}

Requirements:
1. Preserve citation markers (e.g., [1], [2]) and core arguments
2. Only enhance weak dimensions, don't heavily rewrite unrelated paragraphs
3. Output the improved full section content directly, no explanations or prefixes`;

      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        operationName: "章节修复",
        modelType: AIModelType.CHAT,
        model: remediationModelId || undefined,
        skipGuardrails: true,
        taskProfile: {
          creativity: "medium",
          outputLength: "long",
        },
      });

      if (response.isError) {
        this.logger.warn(
          `[remediate] API error for "${sectionTitle}": ${response.content.slice(0, 200)}`,
        );
        return {
          content,
          actionsApplied: [],
          skipped: true,
          skipReason: `api_error: ${response.content.slice(0, 100)}`,
        };
      }

      const remediated = response.content.trim();
      // 基本验证：补救后内容不能比原内容短太多（防止截断）
      if (remediated.length < content.length * 0.5) {
        this.logger.warn(
          `[remediate] Remediated content too short (${remediated.length} vs original ${content.length}), keeping original`,
        );
        return {
          content,
          actionsApplied: [],
          skipped: true,
          skipReason: "remediated_content_too_short",
        };
      }

      // ★ LaTeX safety: if remediated content has MORE LaTeX issues
      //   than the original, the remediation LLM regressed formula
      //   handling — keep the original to avoid making things worse.
      const beforeIssues = validateLatexDelimiters(content).issues.length;
      const afterIssues = validateLatexDelimiters(remediated).issues.length;
      if (afterIssues > beforeIssues) {
        this.logger.warn(
          `[remediate] Remediation regressed LaTeX (${beforeIssues} -> ${afterIssues} issues) for "${sectionTitle}", keeping original`,
        );
        return {
          content,
          actionsApplied: [],
          skipped: true,
          skipReason: "remediated_content_latex_regressed",
        };
      }

      this.logger.log(
        `[remediate] Section "${sectionTitle}" remediated: ${actions.map((a) => a.type).join(", ")} (model: ${response.model || remediationModelId || "default"})`,
      );

      return {
        content: remediated,
        actionsApplied: actions,
        skipped: false,
      };
    } catch (error) {
      this.logger.warn(
        `[remediate] Failed for "${sectionTitle}", keeping original: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        content,
        actionsApplied: [],
        skipped: true,
        skipReason: `error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取当次补救实际使用的模型 ID
   */
  async getRemediationModelId(originalModelId: string): Promise<string> {
    return this.resolveRemediationModel(originalModelId);
  }

  /**
   * 解析补救模型：非 STRONG tier → 选择一个 STRONG tier 模型
   */
  private async resolveRemediationModel(
    originalModelId: string,
  ): Promise<string> {
    const tier = classifyModelTier(originalModelId);
    if (tier === ModelTier.STRONG) {
      return originalModelId; // 已经是 STRONG，用同模型
    }

    try {
      const model = await this.engineFacade.selectModel({
        modelType: AIModelType.CHAT,
      });
      if (model) {
        // selectModel 返回 priority 最高的模型，通常是 STRONG tier
        const selectedTier = classifyModelTier(model.id);
        if (selectedTier === ModelTier.STRONG) {
          return model.id;
        }
      }
    } catch {
      this.logger.warn(
        "[resolveRemediationModel] selectModel failed, using default",
      );
    }

    return ""; // 空字符串让下游 AiChatService 走 TaskProfile 自动解析
  }
}



import { Injectable, Logger } from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { validateLatexDelimiters } from "@/common/utils/latex-delimiter-validator";
import {
  classifyModelTier,
  ModelTier,
} from "@/modules/ai-engine/llm/types/model-tier.types";
import { AIFacade } from "../../facade/ai.facade";
import { ChatFacade } from "../../facade/domain/chat.facade";
import type { RemediationAction, RemediationResult } from "./quality.types";

@Injectable()
export class SectionRemediationService {
  private readonly logger = new Logger(SectionRemediationService.name);

  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly engineFacade: AIFacade,
  ) {}

  async remediate(input: {
    content: string;
    sectionTitle: string;
    actions: RemediationAction[];
    originalModelId?: string;
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
      const remediationModelId =
        resolvedRemediationModelId ??
        (await this.resolveRemediationModel(originalModelId ?? ""));

      const lang = language?.startsWith("en") ? "en" : "zh";
      const actionInstructions = actions
        .map((action) =>
          lang === "zh"
            ? `- [${action.dimension} 得分 ${action.score}/10] ${action.guidance}`
            : `- [${action.dimension} score ${action.score}/10] ${action.guidance}`,
        )
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
        operationName: "section_remediation",
        modelType: AIModelType.CHAT,
        model: remediationModelId || undefined,
        skipGuardrails: true,
        taskProfile: {
          creativity: "medium",
          outputLength: "extended",
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
        `[remediate] Section "${sectionTitle}" remediated: ${actions.map((action) => action.type).join(", ")} (model: ${response.model || remediationModelId || "default"})`,
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

  async getRemediationModelId(originalModelId: string): Promise<string> {
    return this.resolveRemediationModel(originalModelId);
  }

  private async resolveRemediationModel(
    originalModelId: string,
  ): Promise<string> {
    const tier = classifyModelTier(originalModelId);
    if (tier === ModelTier.STRONG) {
      return originalModelId;
    }

    try {
      const model = await this.engineFacade.selectModel({
        modelType: AIModelType.CHAT,
      });
      if (model) {
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

    return "";
  }
}

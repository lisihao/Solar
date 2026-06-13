// Sediment from {app} (2026-04-29) — ai-harness/evaluation/critique/
// 来源: ai-app/{app}/services/quality/section-self-eval.service.ts
// TI 仍在使用原 service；本副本由 {app} 等新业务通过 ai-harness/facade 调用。
/**
 * Section Self-Evaluation Service
 *
 * 轻量级 4 维自评服务，在写作管线内快速评估单个 section 质量。
 * 与 ReportEvaluationService（10 维、事后评审）互补：
 * - 本服务：4 维、写中评估、CHAT 模型、~700 token
 * - ReportEvaluation：10 维、事后评审、EVALUATOR 模型、~2000 token
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "../../facade/domain/chat.facade";
import { AIModelType } from "@prisma/client";
import type {
  SectionSelfEvalResult,
  SelfEvalDimension,
  RemediationAction,
  RemediationActionType,
} from "./quality.types";

const SELF_EVAL_DIMENSIONS: SelfEvalDimension[] = [
  "analytical_depth",
  "evidence_coverage",
  "actionability",
  "writing_quality",
];

const ACTION_TYPE_MAP: Record<SelfEvalDimension, RemediationActionType> = {
  analytical_depth: "deepen_analysis",
  evidence_coverage: "inject_evidence",
  actionability: "add_recommendations",
  writing_quality: "improve_style",
};

const GUIDANCE_MAP: Record<RemediationActionType, { zh: string; en: string }> =
  {
    deepen_analysis: {
      zh: "补充因果推理链条，分析数据背后的驱动因素，给出趋势预判",
      en: "Add causal reasoning chains, analyze driving factors behind data, provide trend predictions",
    },
    inject_evidence: {
      zh: "补充引用更多高质量来源的证据，增加引用多样性，确保关键论点有数据支撑",
      en: "Cite more high-quality sources, increase citation diversity, ensure key arguments are data-backed",
    },
    add_recommendations: {
      zh: "补充具体可操作的建议，包含优先级排序和风险提示，给出明确的行动方案",
      en: "Add specific actionable recommendations with priority ranking and risk warnings, provide clear action plans",
    },
    improve_style: {
      zh: "改善写作风格：去除 AI 痕迹，优化段落结构，使表达更专业自然",
      en: "Improve writing style: remove AI artifacts, optimize paragraph structure, make expression more professional and natural",
    },
  };

@Injectable()
export class SectionSelfEvalService {
  private readonly logger = new Logger(SectionSelfEvalService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 对单个 section 进行 4 维快速自评
   */
  async evaluateSection(input: {
    content: string;
    sectionTitle: string;
    topicName: string;
    language?: string;
  }): Promise<SectionSelfEvalResult> {
    const lang = input.language?.startsWith("en") ? "en" : "zh";
    const contentPreview = input.content.slice(0, 2000);

    const prompt =
      lang === "zh"
        ? `你是报告质量评审员。快速评估以下章节的 4 个维度，每个维度打 1-10 分。

章节标题：${input.sectionTitle}
所属话题：${input.topicName}

内容：
${contentPreview}

请严格按以下 JSON 格式回复，不要有其他文字：
{"analytical_depth":N,"evidence_coverage":N,"actionability":N,"writing_quality":N}`
        : `You are a report quality reviewer. Quickly evaluate this section on 4 dimensions, score 1-10 each.

Section: ${input.sectionTitle}
Topic: ${input.topicName}

Content:
${contentPreview}

Reply strictly in this JSON format, no other text:
{"analytical_depth":N,"evidence_coverage":N,"actionability":N,"writing_quality":N}`;

    try {
      const response = await this.chatFacade.chat({
        messages: [{ role: "user", content: prompt }],
        operationName: "章节自评",
        modelType: AIModelType.CHAT,
        skipGuardrails: true,
        taskProfile: {
          creativity: "deterministic",
          outputLength: "minimal",
        },
      });

      const scores = this.parseScores(response.content);
      // ★ 2026-05-13 #60 自适应 weakAreas（用户反馈"总是 2 个 redo"，不根据实际情况）：
      //   旧逻辑 `score < 7` 是绝对阈值，导致 6/6/7/7 这种"总体过得去但 LLM 给分
      //   保守"的章节也总有 2 个 dim 被打回 redo。改为：
      //
      //     weakArea = (score < 7) AND (score < sectionMax - 1)
      //
      //   核心：dim 必须既绝对偏弱、又相对落后于本章节最强项才算 weak。
      //   这避免了"全 6/7" 时还要找 2 个出来 redo 的强迫症行为。
      //
      //   实例：
      //   - 6,6,7,7 (max=7) → 6<7 ✓ 但 6<6 NO → 0 个 redo（用户期望，避免"总是 2"）
      //   - 5,7,7,7 (max=7) → 5<6 ✓ → 1 个 redo（真有 1 项明显弱才修 1）
      //   - 5,4,8,6 (max=8) → ad=5<7, ec=4<7, wq=6<7 全 <7=7 → 3 个 redo（强对比时全标）
      //   - 8,8,9,9 (max=9) → 任何都 ≥7 → 0 个 redo
      const sectionMax = Math.max(
        ...SELF_EVAL_DIMENSIONS.map((d) => scores[d] ?? 10),
      );
      const weakAreas = SELF_EVAL_DIMENSIONS.filter((d) => {
        const s = scores[d] ?? 10;
        return s < 7 && s < sectionMax - 1;
      });

      return {
        scores,
        weakAreas,
        overallOk: weakAreas.length === 0,
      };
    } catch (error) {
      this.logger.warn(
        `[evaluateSection] Self-eval failed for "${input.sectionTitle}": ${error instanceof Error ? error.message : String(error)}`,
      );
      // Fail-open: 评估失败不阻断写作流程
      return {
        scores: {
          analytical_depth: 7,
          evidence_coverage: 7,
          actionability: 7,
          writing_quality: 7,
        },
        weakAreas: [],
        overallOk: true,
      };
    }
  }

  /**
   * 根据自评结果确定需要执行的补救动作
   */
  determineRemediationActions(
    evalResult: SectionSelfEvalResult,
    _threshold = 7,
    language = "zh",
  ): RemediationAction[] {
    const lang = language.startsWith("en") ? "en" : "zh";

    return evalResult.weakAreas.map((dim) => ({
      type: ACTION_TYPE_MAP[dim],
      dimension: dim,
      score: evalResult.scores[dim] ?? 0,
      guidance: GUIDANCE_MAP[ACTION_TYPE_MAP[dim]][lang],
    }));
  }

  private parseScores(raw: string): Record<SelfEvalDimension, number> {
    const defaults: Record<SelfEvalDimension, number> = {
      analytical_depth: 7,
      evidence_coverage: 7,
      actionability: 7,
      writing_quality: 7,
    };

    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = raw.match(/\{[^}]+\}/);
      if (!jsonMatch) return defaults;

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      for (const dim of SELF_EVAL_DIMENSIONS) {
        const val = parsed[dim];
        if (typeof val === "number" && val >= 1 && val <= 10) {
          defaults[dim] = Math.round(val);
        }
      }
    } catch {
      this.logger.warn(
        `[parseScores] Failed to parse self-eval response: ${raw.slice(0, 200)}`,
      );
    }

    return defaults;
  }
}

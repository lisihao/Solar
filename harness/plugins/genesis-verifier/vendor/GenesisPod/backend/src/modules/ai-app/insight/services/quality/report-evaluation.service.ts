/**
 * Report Evaluation Service
 *
 * 按章节（维度）的 10 维报告质量评审服务
 * 使用 EVALUATOR 类型模型进行结构化评审，确保跨报告评分一致性
 *
 * 多模型系统下，每个章节可能由不同模型撰写，按章节评审可以：
 * 1. 对比同一报告中不同模型的表现
 * 2. 识别哪些章节质量高/低
 * 3. 为模型选型提供数据支撑
 */

import { Injectable, Logger } from "@nestjs/common";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { AIModelType } from "@prisma/client";
import { stripReasoningBlocks } from "@/common/utils/json-extraction.utils";

/** 评审维度定义 */
export interface EvaluationDimension {
  id: string;
  name: string;
  nameEn: string;
  weight: number;
  description: string;
  score?: number; // 1-10
  comment?: string; // 该维度的评语
}

/** 单章节评审结果 */
export interface ChapterEvaluation {
  chapterId: string; // 维度 ID
  chapterTitle: string; // 维度标题
  writerModel: string; // 撰写该章节的模型
  dimensions: EvaluationDimension[];
  chapterScore: number; // 1-100 加权总分
  grade: string; // A/B/C/D/F
  feedback: string; // 该章节的评语
  remediationTraces?: import("../../types/quality.types").RemediationTrace[];
}

/** 整体评审结果（含按章节明细） */
export interface EvaluationResult {
  chapters: ChapterEvaluation[]; // 按章节评审
  overallScore: number; // 1-100 所有章节加权平均
  grade: string; // A/B/C/D/F
  feedback: string; // 整体评语
  modelComparison: ModelComparisonEntry[]; // 模型对比
  evaluatorModel: string; // 评审使用的模型
  evaluatedAt: string; // 评审时间
}

/** 模型对比条目 */
export interface ModelComparisonEntry {
  modelId: string;
  chapterCount: number; // 该模型撰写的章节数
  avgScore: number; // 平均分
  bestDimension: string; // 该模型最强维度
  weakestDimension: string; // 该模型最弱维度
}

/** 章节输入（由调用方提供） */
export interface ChapterInput {
  chapterId: string;
  chapterTitle: string;
  writerModel: string;
  content: string; // 章节正文
  sourcesUsed: number;
}

/** 默认 10 维定义 */
const DEFAULT_DIMENSIONS: EvaluationDimension[] = [
  {
    id: "factual_accuracy",
    name: "事实准确性",
    nameEn: "Factual Accuracy",
    weight: 0.15,
    description: "数据和论断能否追溯到引用来源，引用是否准确",
  },
  {
    id: "analytical_depth",
    name: "分析深度",
    nameEn: "Analytical Depth",
    weight: 0.15,
    description: "是否有因果推理和趋势判断，还是仅停留在事实陈述",
  },
  {
    id: "evidence_coverage",
    name: "证据覆盖度",
    nameEn: "Evidence Coverage",
    weight: 0.1,
    description: "是否充分使用了高可信度来源，引用是否多样",
  },
  {
    id: "information_density",
    name: "信息密度",
    nameEn: "Information Density",
    weight: 0.1,
    description: "单位篇幅的有效信息量，是否有冗余重复",
  },
  {
    id: "logical_consistency",
    name: "逻辑一致性",
    nameEn: "Logical Consistency",
    weight: 0.1,
    description: "论述是否自洽，数据是否矛盾",
  },
  {
    id: "visual_quality",
    name: "图表专业度",
    nameEn: "Visual Quality",
    weight: 0.1,
    description: "图表来源是否权威，图文是否对应，是否有信息增量",
  },
  {
    id: "writing_quality",
    name: "写作质量",
    nameEn: "Writing Quality",
    weight: 0.1,
    description: "表达是否专业，无 AI 痕迹，段落结构合理",
  },
  {
    id: "originality",
    name: "独创性",
    nameEn: "Originality",
    weight: 0.05,
    description: "是否有跨来源的综合判断和非显而易见的洞察",
  },
  {
    id: "timeliness",
    name: "时效性",
    nameEn: "Timeliness",
    weight: 0.05,
    description: "是否使用了最新的数据和来源",
  },
  {
    id: "actionability",
    name: "可操作性",
    nameEn: "Actionability",
    weight: 0.1,
    description: "是否有明确的建议、优先级排序和风险提示",
  },
];

/** 每章节内容截断上限 */
const MAX_CHAPTER_CHARS = 4000;
/** 并发评审上限（避免 rate limit） */
const MAX_CONCURRENT_EVALUATIONS = 3;

@Injectable()
export class ReportEvaluationService {
  private readonly logger = new Logger(ReportEvaluationService.name);

  constructor(private readonly chatFacade: ChatFacade) {}

  /**
   * 按章节对报告进行 10 维结构化评审
   */
  async evaluateReport(input: {
    reportTitle: string;
    topicType: string;
    chapters: ChapterInput[];
    language?: string; // zh/en，评审语言自适应
  }): Promise<EvaluationResult> {
    // 1. 获取评审模型
    const { modelId: evaluatorModelId, isEvaluator } =
      await this.resolveEvaluatorModel();
    this.logger.log(
      `[evaluateReport] Evaluating ${input.chapters.length} chapters with model: ${evaluatorModelId || "default"} (type: ${isEvaluator ? "EVALUATOR" : "CHAT"})`,
    );

    // 2. 按章节并行评审（限流）
    const chapterResults: ChapterEvaluation[] = [];
    for (
      let i = 0;
      i < input.chapters.length;
      i += MAX_CONCURRENT_EVALUATIONS
    ) {
      const batch = input.chapters.slice(i, i + MAX_CONCURRENT_EVALUATIONS);
      const batchResults = await Promise.all(
        batch.map((chapter) =>
          this.evaluateChapter(
            chapter,
            input.topicType,
            evaluatorModelId,
            isEvaluator,
            input.language,
          ),
        ),
      );
      chapterResults.push(...batchResults);
    }

    // 3. 聚合整体评分
    const overallScore =
      chapterResults.length > 0
        ? Math.round(
            chapterResults.reduce((sum, c) => sum + c.chapterScore, 0) /
              chapterResults.length,
          )
        : 0;

    // 4. 模型对比
    const modelComparison = this.buildModelComparison(chapterResults);

    // 5. 整体评语
    const feedback = this.buildOverallFeedback(chapterResults, modelComparison);

    const result: EvaluationResult = {
      chapters: chapterResults,
      overallScore,
      grade: this.scoreToGrade(overallScore),
      feedback,
      modelComparison,
      evaluatorModel: evaluatorModelId,
      evaluatedAt: new Date().toISOString(),
    };

    this.logger.log(
      `[evaluateReport] Evaluation completed: score=${result.overallScore}, grade=${result.grade}, ` +
        `chapters=${chapterResults.length}, models=${modelComparison.length}`,
    );

    return result;
  }

  /**
   * 评审单个章节
   */
  private async evaluateChapter(
    chapter: ChapterInput,
    topicType: string,
    evaluatorModel: string,
    isEvaluator: boolean,
    language?: string,
  ): Promise<ChapterEvaluation> {
    const truncatedContent =
      chapter.content.length > MAX_CHAPTER_CHARS
        ? chapter.content.substring(0, MAX_CHAPTER_CHARS) +
          `\n\n[...已截断，共 ${chapter.content.length} 字...]`
        : chapter.content;

    const dimensionsList = DEFAULT_DIMENSIONS.map(
      (d, i) =>
        `${i + 1}. **${d.name}** (${d.nameEn}, ${(d.weight * 100).toFixed(0)}%): ${d.description}`,
    ).join("\n");

    const isEnglish = language?.startsWith("en");
    const systemPrompt = isEnglish
      ? `You are a professional research report quality reviewer. Evaluate the following chapter with structured quality assessment.
Be objective and strict, scoring based on actual content quality.
Output must be a valid JSON object. All comments and feedback must be in English.`
      : `你是专业的研究报告质量评审专家。你需要对报告的单个章节进行结构化质量评审。
评审必须客观、严格，基于内容实际质量打分。
输出必须是合法的 JSON 对象。所有评语和反馈必须使用中文。`;

    const userPrompt = `## 待评审章节

- 章节标题: ${chapter.chapterTitle}
- 话题类型: ${topicType}
- 撰写模型: ${chapter.writerModel || "未知"}
- 引用来源数: ${chapter.sourcesUsed}

### 章节内容
${truncatedContent}

## 评审维度（每项 1-10 分，附 20-50 字评语）

${dimensionsList}

## 输出 JSON

{
  "dimensions": [
    { "id": "factual_accuracy", "score": 8, "comment": "简短评语" },
    ...（10 个维度全部输出）
  ],
  "feedback": "1-2 句该章节的总评"
}`;

    try {
      const response = await this.chatFacade.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        operationName: "报告评估",
        model: evaluatorModel || undefined,
        modelType: isEvaluator ? AIModelType.EVALUATOR : AIModelType.CHAT,
        skipGuardrails: true,
        responseFormat: "json",
        taskProfile: {
          creativity: "low",
          outputLength: "medium",
        },
      });

      const parsed = this.parseEvaluationResponse(response.content);
      const dimensions = this.mergeDimensions(parsed.dimensions);
      const chapterScore = this.calcWeightedScore(dimensions);

      return {
        chapterId: chapter.chapterId,
        chapterTitle: chapter.chapterTitle,
        writerModel: chapter.writerModel || "unknown",
        dimensions,
        chapterScore,
        grade: this.scoreToGrade(chapterScore),
        feedback: parsed.feedback,
      };
    } catch (error) {
      this.logger.warn(
        `[evaluateChapter] Failed for "${chapter.chapterTitle}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        chapterId: chapter.chapterId,
        chapterTitle: chapter.chapterTitle,
        writerModel: chapter.writerModel || "unknown",
        dimensions: DEFAULT_DIMENSIONS.map((d) => ({ ...d })),
        chapterScore: 0,
        grade: "-",
        feedback: "评审失败",
      };
    }
  }

  /**
   * 构建模型对比
   */
  private buildModelComparison(
    chapters: ChapterEvaluation[],
  ): ModelComparisonEntry[] {
    const modelMap = new Map<
      string,
      { scores: number[]; dimScores: Map<string, number[]> }
    >();

    for (const ch of chapters) {
      if (ch.chapterScore === 0) continue; // 跳过评审失败的
      if (!modelMap.has(ch.writerModel)) {
        modelMap.set(ch.writerModel, {
          scores: [],
          dimScores: new Map<string, number[]>(),
        });
      }
      const entry = modelMap.get(ch.writerModel)!;
      entry.scores.push(ch.chapterScore);
      for (const dim of ch.dimensions) {
        if (dim.score !== undefined) {
          if (!entry.dimScores.has(dim.id)) {
            entry.dimScores.set(dim.id, []);
          }
          entry.dimScores.get(dim.id)!.push(dim.score);
        }
      }
    }

    return Array.from(modelMap.entries()).map(([modelId, data]) => {
      const avgScore = Math.round(
        data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
      );

      // 找最强/最弱维度
      let bestDim = "";
      let bestAvg = 0;
      let weakestDim = "";
      let weakestAvg = 11;
      for (const [dimId, scores] of data.dimScores.entries()) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avg > bestAvg) {
          bestAvg = avg;
          bestDim = dimId;
        }
        if (avg < weakestAvg) {
          weakestAvg = avg;
          weakestDim = dimId;
        }
      }

      const dimNameMap = new Map(DEFAULT_DIMENSIONS.map((d) => [d.id, d.name]));

      return {
        modelId,
        chapterCount: data.scores.length,
        avgScore,
        bestDimension: dimNameMap.get(bestDim) ?? bestDim,
        weakestDimension: dimNameMap.get(weakestDim) ?? weakestDim,
      };
    });
  }

  /**
   * 构建整体评语
   */
  private buildOverallFeedback(
    chapters: ChapterEvaluation[],
    modelComparison: ModelComparisonEntry[],
  ): string {
    const validChapters = chapters.filter((c) => c.chapterScore > 0);
    if (validChapters.length === 0) return "评审服务暂不可用。";

    const best = validChapters.reduce((a, b) =>
      a.chapterScore > b.chapterScore ? a : b,
    );
    const worst = validChapters.reduce((a, b) =>
      a.chapterScore < b.chapterScore ? a : b,
    );

    let feedback = `最强章节: "${best.chapterTitle}"(${best.chapterScore}分)，最弱章节: "${worst.chapterTitle}"(${worst.chapterScore}分)。`;

    if (modelComparison.length > 1) {
      const bestModel = modelComparison.reduce((a, b) =>
        a.avgScore > b.avgScore ? a : b,
      );
      feedback += ` 模型对比: ${bestModel.modelId} 表现最佳(均分${bestModel.avgScore})。`;
    }

    return feedback;
  }

  // ==================== 工具方法 ====================

  /**
   * 解析评审模型：优先 EVALUATOR 类型，fallback 到 CHAT
   * 返回 { modelId, isEvaluator } 以便调用时正确设置 modelType
   */
  private async resolveEvaluatorModel(): Promise<{
    modelId: string;
    isEvaluator: boolean;
  }> {
    try {
      const model = await this.chatFacade.getDefaultModelByType(
        AIModelType.EVALUATOR,
      );
      if (model?.modelId) return { modelId: model.modelId, isEvaluator: true };
    } catch {
      // fallback
    }
    try {
      const fallback = await this.chatFacade.getDefaultModelByType(
        AIModelType.CHAT,
      );
      return { modelId: fallback?.modelId ?? "", isEvaluator: false };
    } catch {
      return { modelId: "", isEvaluator: false };
    }
  }

  private parseEvaluationResponse(content: string): {
    dimensions: Array<{ id: string; score: number; comment: string }>;
    feedback: string;
  } {
    let cleaned = content.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }
    cleaned = stripReasoningBlocks(cleaned);

    const parsed = JSON.parse(cleaned) as {
      dimensions?: Array<{ id: string; score: number; comment: string }>;
      feedback?: string;
    };
    return {
      dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : [],
      feedback: parsed.feedback ?? "",
    };
  }

  private mergeDimensions(
    parsed: Array<{ id: string; score: number; comment: string }>,
  ): EvaluationDimension[] {
    return DEFAULT_DIMENSIONS.map((dim) => {
      const found = parsed.find((d) => d.id === dim.id);
      return {
        ...dim,
        score: found
          ? Math.max(1, Math.min(10, Math.round(found.score)))
          : undefined,
        comment: found?.comment ?? undefined,
      };
    });
  }

  private calcWeightedScore(dimensions: EvaluationDimension[]): number {
    // 用全部维度权重之和归一化，缺失维度视为 0 贡献（惩罚缺失）
    const fullWeightSum = dimensions.reduce((s, d) => s + d.weight, 0);
    if (fullWeightSum === 0) return 0;
    const weightedSum = dimensions.reduce(
      (s, d) => s + (d.score ?? 0) * d.weight,
      0,
    );
    return Math.round((weightedSum / fullWeightSum) * 10);
  }

  private scoreToGrade(score: number): string {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    if (score === 0) return "-";
    return "F";
  }
}

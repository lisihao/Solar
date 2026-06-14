/**
 * Quality Trace Compute Service —— 沉淀自 {app}/services/quality/report-quality-trace.service.ts (2026-04-29)
 *
 * 全链路质量可观测性的纯计算核心：5 个探针 + 5 维评分 + 最终 grade。
 *
 * 设计：
 * - 本服务仅负责 trace context 维护 + 评分计算，**不涉及 prisma persistence**
 * - prompt provenance 由消费方注入（TI 用 PROMPT_METADATA，consumer 用自己的快照）
 * - 持久化由消费方各自实现（各 ai-app 把 qualityTrace JSON 写到自家 mission 表）
 *
 * 标杆参考实现，consumer 等新模块从 `@/modules/ai-harness/facade` 消费。
 * TI 是商用基线，保留独立的本地副本不切换到本实现。
 */

import { Injectable, Logger } from "@nestjs/common";
import { scanContentDefects, type ContentDefectScan } from "./defect-scanner";

// ==================== Types（与 TI ReportQualityTrace 兼容） ====================

/** Prompt 版本/hash 元数据（消费方自定义快照） */
export interface PromptMetadata {
  version: string;
  hash: string;
}

export interface QualityTraceContext<P extends string = string> {
  reportId: string;
  startedAt: number;
  evidenceQuality?: EvidenceQualityProbe;
  dimensionOutputs: DimensionOutputProbe[];
  postProcessing?: PostProcessingProbe;
  synthesisOutput?: SynthesisOutputProbe;
  finalAssessment?: FinalAssessmentProbe;
  outputReview?: OutputReviewProbe;
  /** Prompt provenance —— 由消费方注入（TI: PROMPT_METADATA，consumer: 自己的 prompt 快照） */
  promptProvenance?: Partial<Record<P, PromptMetadata>>;
}

export interface EvidenceQualityProbe {
  totalEvidences: number;
  credibilityDistribution: {
    high: number;
    medium: number;
    low: number;
    unscored: number;
  };
  uniqueDomains: number;
  fullContentRatio: number;
  evidencesWithFigures: number;
  recentRatio: number;
}

export interface DimensionOutputProbe {
  dimensionId: string;
  dimensionName: string;
  rawOutput: {
    contentLength: number;
    keyFindingsCount: number;
    citationsUsed: number;
    uniqueSourcesCited: number;
    figureRefsCount: number;
    jsonParsed: boolean;
    usedFallback: boolean;
  };
  defects: ContentDefectScan;
  qualityGate?: {
    passed: boolean;
    errorCount: number;
    warningCount: number;
    autoFixCount: number;
    violationsByRule: Record<string, number>;
  };
  critiqueRefine?: {
    initialScore: number;
    finalScore: number;
    iterations: number;
    stopReason: string;
  };
  writerModel?: string;
  remediationModel?: string;
  selfEvalScoresBefore?: Record<string, number>;
  selfEvalScoresAfter?: Record<string, number>;
  selfEvalDelta?: number;
  weakAreasResolved?: boolean;
}

export interface PostProcessingProbe {
  fixesApplied: Record<string, number>;
  totalFixes: number;
  charsBefore: number;
  charsAfter: number;
  truncatedDimensions: number;
  deduplicatedParagraphs: number;
  warnings: string[];
}

export interface SynthesisOutputProbe {
  sectionLengths: {
    executiveSummary: number;
    preface: number;
    crossDimensionAnalysis: number;
    riskAssessment: number;
    strategicRecommendations: number;
    conclusion: number;
  };
  jsonParsed: boolean;
  fallbackLevel: number;
  generationTimeMs: number;
  tokensUsed: number;
}

export interface FinalAssessmentProbe {
  overallScore: number;
  scores: {
    formatting: number;
    completeness: number;
    sourceQuality: number;
    structure: number;
    languageConsistency: number;
  };
  grade: "A" | "B" | "C" | "D" | "F";
  topIssues: Array<{
    category: string;
    description: string;
    severity: "error" | "warning";
    count: number;
  }>;
}

export interface OutputReviewProbe {
  passed: boolean;
  score: number;
  scores?: {
    completeness?: number;
    accuracy?: number;
    logic?: number;
    professionalism?: number;
  };
  feedback: string;
  issues: string[];
  suggestions: string[];
  reviewErrored?: boolean;
  errorMessage?: string;
}

export interface QualityTrace<P extends string = string> {
  version: 1;
  generatedAt: string;
  pipelineVersion: string;
  evidenceQuality: EvidenceQualityProbe;
  dimensionOutputs: DimensionOutputProbe[];
  postProcessing: PostProcessingProbe;
  synthesisOutput: SynthesisOutputProbe;
  finalAssessment: FinalAssessmentProbe;
  outputReview?: OutputReviewProbe;
  promptProvenance?: Partial<Record<P, PromptMetadata>>;
}

/** 通用 Evidence 形状（TI 用 prisma TopicEvidence，consumer 可自定义；compute 只需以下字段） */
export interface QualityTraceEvidence {
  domain?: string | null;
  snippet?: string | null;
  publishedAt?: Date | string | null;
  credibilityScore?: number | null;
}

// ==================== Service ====================

@Injectable()
export class QualityTraceComputeService {
  private readonly logger = new Logger(QualityTraceComputeService.name);

  /**
   * 创建新 trace context。promptProvenance 由消费方注入。
   */
  createTrace<P extends string = string>(
    reportId: string,
    promptProvenance?: Partial<Record<P, PromptMetadata>>,
  ): QualityTraceContext<P> {
    return {
      reportId,
      startedAt: Date.now(),
      dimensionOutputs: [],
      promptProvenance,
    };
  }

  /** 记录某维度的补救闭环三元组（前/后/delta/resolved） */
  recordDimensionRemediationLoop<P extends string>(
    ctx: QualityTraceContext<P>,
    dimensionId: string,
    data: {
      selfEvalScoresBefore: Record<string, number>;
      selfEvalScoresAfter: Record<string, number>;
      weakAreasResolved: boolean;
      remediationModel?: string;
    },
  ): void {
    const dim = ctx.dimensionOutputs.find((d) => d.dimensionId === dimensionId);
    if (!dim) return;
    const before = Object.values(data.selfEvalScoresBefore);
    const after = Object.values(data.selfEvalScoresAfter);
    const avgBefore = before.length
      ? before.reduce((a, b) => a + b, 0) / before.length
      : 0;
    const avgAfter = after.length
      ? after.reduce((a, b) => a + b, 0) / after.length
      : 0;
    dim.selfEvalScoresBefore = data.selfEvalScoresBefore;
    dim.selfEvalScoresAfter = data.selfEvalScoresAfter;
    dim.selfEvalDelta = Number((avgAfter - avgBefore).toFixed(2));
    dim.weakAreasResolved = data.weakAreasResolved;
    if (data.remediationModel) dim.remediationModel = data.remediationModel;
  }

  /** Probe 1: Record evidence quality metrics */
  recordEvidenceQuality<P extends string>(
    ctx: QualityTraceContext<P>,
    evidences: QualityTraceEvidence[],
  ): void {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const domains = new Set<string>();
      let withContent = 0;
      const withFigures = 0;
      let recentCount = 0;
      let highCred = 0;
      let medCred = 0;
      let lowCred = 0;
      let unscored = 0;

      for (const e of evidences) {
        if (e.domain) domains.add(e.domain);
        if (e.snippet && e.snippet.length > 100) withContent++;
        if (e.publishedAt && new Date(e.publishedAt) > sixMonthsAgo)
          recentCount++;

        const score = e.credibilityScore;
        if (typeof score === "number" && score > 0) {
          if (score >= 70) highCred++;
          else if (score >= 40) medCred++;
          else lowCred++;
        } else {
          unscored++;
        }
      }

      ctx.evidenceQuality = {
        totalEvidences: evidences.length,
        credibilityDistribution: {
          high: highCred,
          medium: medCred,
          low: lowCred,
          unscored,
        },
        uniqueDomains: domains.size,
        fullContentRatio:
          evidences.length > 0 ? withContent / evidences.length : 0,
        evidencesWithFigures: withFigures,
        recentRatio: evidences.length > 0 ? recentCount / evidences.length : 0,
      };
    } catch (err) {
      this.logger.warn(
        `[Probe 1] Evidence quality recording failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Probe 2: Scan dimension LLM raw output for defects */
  scanDimensionOutput<P extends string>(
    ctx: QualityTraceContext<P>,
    dimensionId: string,
    dimensionName: string,
    rawContent: string,
    meta: {
      keyFindingsCount?: number;
      citationsUsed?: number;
      uniqueSourcesCited?: number;
      figureRefsCount?: number;
      jsonParsed?: boolean;
      usedFallback?: boolean;
    } = {},
  ): void {
    try {
      const defects = scanContentDefects(rawContent);

      ctx.dimensionOutputs.push({
        dimensionId,
        dimensionName,
        rawOutput: {
          contentLength: rawContent.length,
          keyFindingsCount: meta.keyFindingsCount ?? 0,
          citationsUsed: meta.citationsUsed ?? 0,
          uniqueSourcesCited: meta.uniqueSourcesCited ?? 0,
          figureRefsCount: meta.figureRefsCount ?? 0,
          jsonParsed: meta.jsonParsed ?? true,
          usedFallback: meta.usedFallback ?? false,
        },
        defects,
      });

      const totalDefects = Object.values(defects).reduce(
        (sum, v) => sum + (typeof v === "number" ? v : 0),
        0,
      );
      if (totalDefects > 0) {
        this.logger.debug(
          `[Probe 2] Dimension "${dimensionName}": ${totalDefects} defects found`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[Probe 2] Dimension defect scan failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Probe 2b: Record quality gate results for a dimension */
  recordDimensionQualityGate<P extends string>(
    ctx: QualityTraceContext<P>,
    dimensionId: string,
    result: {
      passed: boolean;
      errorCount: number;
      warningCount: number;
      autoFixCount: number;
      violationsByRule: Record<string, number>;
    },
  ): void {
    const dim = ctx.dimensionOutputs.find((d) => d.dimensionId === dimensionId);
    if (dim) {
      dim.qualityGate = result;
    }
  }

  /** Probe 3: Record post-processing fix statistics */
  recordPostProcessing<P extends string>(
    ctx: QualityTraceContext<P>,
    fixes: Record<string, number>,
    charsBefore: number,
    charsAfter: number,
    warnings: string[],
    truncatedDimensions = 0,
    deduplicatedParagraphs = 0,
  ): void {
    try {
      ctx.postProcessing = {
        fixesApplied: fixes,
        totalFixes: Object.values(fixes).reduce((s, v) => s + v, 0),
        charsBefore,
        charsAfter,
        truncatedDimensions,
        deduplicatedParagraphs,
        warnings,
      };
    } catch (err) {
      this.logger.warn(
        `[Probe 3] Post-processing recording failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Probe 4: Record synthesis LLM output metrics */
  recordSynthesisOutput<P extends string>(
    ctx: QualityTraceContext<P>,
    sections: Record<string, string>,
    fallbackLevel: number,
    generationTimeMs: number,
    tokensUsed: number,
    jsonParsed: boolean,
  ): void {
    try {
      ctx.synthesisOutput = {
        sectionLengths: {
          executiveSummary: (sections.executiveSummary || "").length,
          preface: (sections.preface || "").length,
          crossDimensionAnalysis: (sections.crossDimensionAnalysis || "")
            .length,
          riskAssessment: (sections.riskAssessment || "").length,
          strategicRecommendations: (sections.strategicRecommendations || "")
            .length,
          conclusion: (sections.conclusion || "").length,
        },
        jsonParsed,
        fallbackLevel,
        generationTimeMs,
        tokensUsed,
      };
    } catch (err) {
      this.logger.warn(
        `[Probe 4] Synthesis output recording failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Record OutputReviewer result */
  recordOutputReview<P extends string>(
    ctx: QualityTraceContext<P>,
    result: OutputReviewProbe,
  ): void {
    ctx.outputReview = result;
  }

  /** Probe 5: Compute final quality assessment from accumulated trace data */
  computeFinalAssessment<P extends string>(
    ctx: QualityTraceContext<P>,
  ): FinalAssessmentProbe {
    const formatting = this.computeFormattingScore(ctx);
    const completeness = this.computeCompletenessScore(ctx);
    const sourceQuality = this.computeSourceScore(ctx);
    const structure = this.computeStructureScore(ctx);
    const languageConsistency = this.computeLanguageScore(ctx);

    const overall = Math.round(
      formatting * 0.25 +
        completeness * 0.2 +
        sourceQuality * 0.2 +
        structure * 0.2 +
        languageConsistency * 0.15,
    );

    const grade =
      overall >= 90
        ? "A"
        : overall >= 75
          ? "B"
          : overall >= 60
            ? "C"
            : overall >= 40
              ? "D"
              : "F";

    const topIssues = this.extractTopIssues(ctx);

    ctx.finalAssessment = {
      overallScore: overall,
      scores: {
        formatting,
        completeness,
        sourceQuality,
        structure,
        languageConsistency,
      },
      grade,
      topIssues,
    };

    return ctx.finalAssessment;
  }

  /** Finalize trace and return complete data ready for persistence */
  finalizeTrace<P extends string>(
    ctx: QualityTraceContext<P>,
    pipelineVersion = "v5.0",
  ): QualityTrace<P> {
    if (!ctx.finalAssessment) {
      this.computeFinalAssessment(ctx);
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      pipelineVersion,
      evidenceQuality: ctx.evidenceQuality || {
        totalEvidences: 0,
        credibilityDistribution: { high: 0, medium: 0, low: 0, unscored: 0 },
        uniqueDomains: 0,
        fullContentRatio: 0,
        evidencesWithFigures: 0,
        recentRatio: 0,
      },
      dimensionOutputs: ctx.dimensionOutputs,
      postProcessing: ctx.postProcessing || {
        fixesApplied: {},
        totalFixes: 0,
        charsBefore: 0,
        charsAfter: 0,
        truncatedDimensions: 0,
        deduplicatedParagraphs: 0,
        warnings: [],
      },
      synthesisOutput: ctx.synthesisOutput || {
        sectionLengths: {
          executiveSummary: 0,
          preface: 0,
          crossDimensionAnalysis: 0,
          riskAssessment: 0,
          strategicRecommendations: 0,
          conclusion: 0,
        },
        jsonParsed: false,
        fallbackLevel: 0,
        generationTimeMs: 0,
        tokensUsed: 0,
      },
      finalAssessment: ctx.finalAssessment!,
      outputReview: ctx.outputReview,
      promptProvenance: ctx.promptProvenance,
    };
  }

  // ==================== Scoring Algorithms ====================

  private computeFormattingScore<P extends string>(
    ctx: QualityTraceContext<P>,
  ): number {
    let score = 100;
    for (const dim of ctx.dimensionOutputs) {
      score -= dim.defects.bareLatexCount * 3;
      score -= dim.defects.brokenDollarNesting * 5;
      score -= dim.defects.unwrappedEnvironments * 4;
      score -= dim.defects.pseudoCodeLines * 4;
      score -= dim.defects.htmlEntities * 2;
      score -= dim.defects.longListItems * 1;
    }
    if (ctx.postProcessing && ctx.postProcessing.totalFixes > 20) {
      score -= Math.min(10, (ctx.postProcessing.totalFixes - 20) * 0.5);
    }
    return Math.max(0, Math.min(100, score));
  }

  private computeCompletenessScore<P extends string>(
    ctx: QualityTraceContext<P>,
  ): number {
    let score = 100;
    for (const dim of ctx.dimensionOutputs) {
      if (dim.rawOutput.contentLength < 4000) score -= 10;
      else if (dim.rawOutput.contentLength < 2000) score -= 20;
      if (dim.rawOutput.usedFallback) score -= 15;
    }
    if (ctx.synthesisOutput) {
      const sections = ctx.synthesisOutput.sectionLengths;
      if (sections.executiveSummary < 200) score -= 15;
      if (sections.crossDimensionAnalysis < 200) score -= 10;
      if (sections.conclusion < 100) score -= 10;
    }
    return Math.max(0, Math.min(100, score));
  }

  private computeSourceScore<P extends string>(
    ctx: QualityTraceContext<P>,
  ): number {
    let score = 100;
    if (!ctx.evidenceQuality) return 50;

    const eq = ctx.evidenceQuality;
    if (eq.totalEvidences < 10) score -= 20;
    else if (eq.totalEvidences < 20) score -= 10;
    if (eq.uniqueDomains < 5) score -= 15;
    else if (eq.uniqueDomains < 10) score -= 5;
    if (eq.fullContentRatio < 0.5) score -= 15;
    if (eq.recentRatio < 0.3) score -= 10;
    if (eq.credibilityDistribution.low > eq.credibilityDistribution.high)
      score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  private computeStructureScore<P extends string>(
    ctx: QualityTraceContext<P>,
  ): number {
    if (ctx.dimensionOutputs.length === 0) return 100;

    let totalScore = 0;
    for (const dim of ctx.dimensionOutputs) {
      let dimScore = 100;
      dimScore -= Math.min(dim.defects.missingHeadings, 6) * 5;
      dimScore -= Math.min(dim.defects.headingEchoes, 3) * 3;
      dimScore -= Math.min(dim.defects.trappedConclusions, 3) * 3;
      totalScore += Math.max(0, dimScore);
    }

    return Math.round(totalScore / ctx.dimensionOutputs.length);
  }

  private computeLanguageScore<P extends string>(
    ctx: QualityTraceContext<P>,
  ): number {
    let score = 100;
    for (const dim of ctx.dimensionOutputs) {
      if (dim.defects.foreignContentRatio > 0.1) score -= 20;
      else if (dim.defects.foreignContentRatio > 0.05) score -= 10;
      score -= dim.defects.leakedMetaNotes * 5;
      score -= dim.defects.leakedFigureNotes * 3;
    }
    return Math.max(0, Math.min(100, score));
  }

  private extractTopIssues<P extends string>(
    ctx: QualityTraceContext<P>,
  ): FinalAssessmentProbe["topIssues"] {
    const issues: FinalAssessmentProbe["topIssues"] = [];

    let totalBareLatex = 0;
    let totalBrokenDollar = 0;
    let totalPseudoCode = 0;
    let totalLeakedMeta = 0;
    let totalMissingHeadings = 0;
    let totalHeadingEchoes = 0;
    let totalLongListItems = 0;

    for (const dim of ctx.dimensionOutputs) {
      totalBareLatex += dim.defects.bareLatexCount;
      totalBrokenDollar += dim.defects.brokenDollarNesting;
      totalPseudoCode += dim.defects.pseudoCodeLines;
      totalLeakedMeta += dim.defects.leakedMetaNotes;
      totalMissingHeadings += dim.defects.missingHeadings;
      totalHeadingEchoes += dim.defects.headingEchoes;
      totalLongListItems += dim.defects.longListItems;
    }

    if (totalBareLatex > 0)
      issues.push({
        category: "formatting",
        description: `${totalBareLatex} bare LaTeX expressions not wrapped in $`,
        severity: "error",
        count: totalBareLatex,
      });
    if (totalBrokenDollar > 0)
      issues.push({
        category: "formatting",
        description: `${totalBrokenDollar} broken $ nesting issues`,
        severity: "error",
        count: totalBrokenDollar,
      });
    if (totalPseudoCode > 0)
      issues.push({
        category: "formatting",
        description: `${totalPseudoCode} pseudocode lines detected`,
        severity: "warning",
        count: totalPseudoCode,
      });
    if (totalLeakedMeta > 0)
      issues.push({
        category: "language",
        description: `${totalLeakedMeta} leaked meta-annotations`,
        severity: "error",
        count: totalLeakedMeta,
      });
    if (totalMissingHeadings > 0)
      issues.push({
        category: "structure",
        description: `${totalMissingHeadings} content blocks missing headings`,
        severity: "warning",
        count: totalMissingHeadings,
      });
    if (totalHeadingEchoes > 0)
      issues.push({
        category: "structure",
        description: `${totalHeadingEchoes} heading echoes (duplicated text)`,
        severity: "warning",
        count: totalHeadingEchoes,
      });
    if (totalLongListItems > 0)
      issues.push({
        category: "formatting",
        description: `${totalLongListItems} overly long list items (>120 chars)`,
        severity: "warning",
        count: totalLongListItems,
      });

    issues.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      return b.count - a.count;
    });

    return issues.slice(0, 10);
  }
}

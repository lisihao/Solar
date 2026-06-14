/**
 * Report Quality Trace Service
 *
 * 全链路质量可观测性：在报告生成管道的每个环节插入质量探针，
 * 记录度量指标，持久化到 TopicReport.qualityTrace (JSONB)。
 *
 * 5 个探针：
 *   Probe 1: 证据采集质量
 *   Probe 2: 维度 LLM 输出缺陷检测
 *   Probe 3: 后处理修复统计
 *   Probe 4: 合成 LLM 输出质量
 *   Probe 5: 最终质量评分
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { toPrismaJson } from "@/common/utils/prisma-json.utils";
import type { TopicEvidence } from "@prisma/client";
import {
  scanContentDefects,
  extractDefectDetails,
  type ContentDefectScan,
  type DefectDetails,
} from "./defect-scanner";
import {
  PROMPT_METADATA,
  type PromptMetadata,
  type PromptName,
} from "../../prompts/prompt-version";

// ==================== Types ====================

export interface QualityTraceContext {
  reportId: string;
  startedAt: number;
  evidenceQuality?: EvidenceQualityProbe;
  dimensionOutputs: DimensionOutputProbe[];
  postProcessing?: PostProcessingProbe;
  synthesisOutput?: SynthesisOutputProbe;
  finalAssessment?: FinalAssessmentProbe;
  outputReview?: OutputReviewProbe;
  /** ★ Prompt provenance —— 本次生成链路涉及的所有 prompt 版本 + hash 快照 */
  promptProvenance?: Partial<Record<PromptName, PromptMetadata>>;
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
  /** ★ 写作/补救时使用的模型 ID（与 prompt version 组合可回溯某分数的完整成因） */
  writerModel?: string;
  remediationModel?: string;
  /** ★ 补救闭环三元组：补救前 / 补救后 / delta */
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
  /** Whether the review passed */
  passed: boolean;
  /** Weighted score (1-10) */
  score: number;
  /** Per-dimension scores from reviewer */
  scores?: {
    completeness?: number;
    accuracy?: number;
    logic?: number;
    professionalism?: number;
  };
  /** Overall feedback text */
  feedback: string;
  /** Specific issues identified */
  issues: string[];
  /** Improvement suggestions */
  suggestions: string[];
  /** Whether the review itself errored (API failure, parse failure) */
  reviewErrored?: boolean;
  /** Error message if review failed */
  errorMessage?: string;
}

export interface ReportQualityTrace {
  version: 1;
  generatedAt: string;
  pipelineVersion: string;
  evidenceQuality: EvidenceQualityProbe;
  dimensionOutputs: DimensionOutputProbe[];
  postProcessing: PostProcessingProbe;
  synthesisOutput: SynthesisOutputProbe;
  finalAssessment: FinalAssessmentProbe;
  /** OutputReviewer LLM review result (Phase 4 of synthesis pipeline) */
  outputReview?: OutputReviewProbe;
  /**
   * ★ Prompt 溯源：本次生成链路涉及的所有 prompt 的 version + hash。
   * 用于把分数回溯到具体 prompt 版本（LangSmith / Langfuse 风格的 telemetry）。
   */
  promptProvenance?: Partial<Record<PromptName, PromptMetadata>>;
}

// ==================== Service ====================

@Injectable()
export class ReportQualityTraceService {
  private readonly logger = new Logger(ReportQualityTraceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Create a new trace context for a report generation run */
  createTrace(reportId: string): QualityTraceContext {
    return {
      reportId,
      startedAt: Date.now(),
      dimensionOutputs: [],
      // ★ 构建期快照所有已知 prompt 的 version + hash；如某 prompt 在本次
      // 生成中未被使用，读取方可自行过滤，但持久化成本极小（几十字节）。
      promptProvenance: { ...PROMPT_METADATA },
    };
  }

  /**
   * 为某个维度记录补救闭环三元组（scoreBefore / scoreAfter / delta / resolved）。
   * 在 SectionRemediationService 补救完成、强制重评完成后调用。
   */
  recordDimensionRemediationLoop(
    ctx: QualityTraceContext,
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
  recordEvidenceQuality(
    ctx: QualityTraceContext,
    evidences: TopicEvidence[],
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
        // TopicEvidence doesn't have metadata field — use credibilityScore directly
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

  /** Probe 2: Scan dimension LLM raw output for defects (before post-processing) */
  scanDimensionOutput(
    ctx: QualityTraceContext,
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

      // Log significant defects
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
  recordDimensionQualityGate(
    ctx: QualityTraceContext,
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
  recordPostProcessing(
    ctx: QualityTraceContext,
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
  recordSynthesisOutput(
    ctx: QualityTraceContext,
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

  /** Record OutputReviewer result (Phase 4 of synthesis pipeline) */
  recordOutputReview(
    ctx: QualityTraceContext,
    result: OutputReviewProbe,
  ): void {
    ctx.outputReview = result;
  }

  /** Probe 5: Compute final quality assessment from accumulated trace data */
  computeFinalAssessment(ctx: QualityTraceContext): FinalAssessmentProbe {
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

  /** Finalize trace and return complete data for DB storage */
  finalizeTrace(ctx: QualityTraceContext): ReportQualityTrace {
    if (!ctx.finalAssessment) {
      this.computeFinalAssessment(ctx);
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      pipelineVersion: "v5.0",
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

  /** Persist quality trace to database */
  async persistTrace(
    reportId: string,
    trace: ReportQualityTrace,
  ): Promise<void> {
    try {
      await this.prisma.topicReport.update({
        where: { id: reportId },
        data: { qualityTrace: toPrismaJson(trace) },
      });
      this.logger.log(
        `[QualityTrace] Persisted trace for report ${reportId}: grade=${trace.finalAssessment.grade}, score=${trace.finalAssessment.overallScore}`,
      );
    } catch (err) {
      this.logger.warn(
        `[QualityTrace] Failed to persist trace (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Get quality trace for a report */
  async getQualityTrace(reportId: string): Promise<ReportQualityTrace | null> {
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      select: { qualityTrace: true },
    });
    return (report?.qualityTrace as unknown as ReportQualityTrace) ?? null;
  }

  /** Get quality summary (simplified version for frontend) */
  async getQualitySummary(reportId: string): Promise<{
    grade: string;
    overallScore: number;
    scores: Record<string, number>;
    topIssues: Array<{
      category: string;
      description: string;
      severity: string;
      count: number;
    }>;
    postProcessingFixes: number;
    pipelineVersion: string;
    dimensionCount: number;
    evidenceCount: number;
    outputReview?: OutputReviewProbe;
  } | null> {
    const trace = await this.getQualityTrace(reportId);
    if (!trace) return null;

    return {
      grade: trace.finalAssessment.grade,
      overallScore: trace.finalAssessment.overallScore,
      scores: trace.finalAssessment.scores,
      topIssues: trace.finalAssessment.topIssues,
      postProcessingFixes: trace.postProcessing.totalFixes,
      pipelineVersion: trace.pipelineVersion,
      dimensionCount: trace.dimensionOutputs.length,
      evidenceCount: trace.evidenceQuality.totalEvidences,
      outputReview: trace.outputReview,
    };
  }

  /**
   * Get defect details by scanning fullReport content on demand.
   * Returns actual offending lines per defect rule.
   */
  async getQualityDetails(
    reportId: string,
    rule?: string,
  ): Promise<{
    details: DefectDetails;
    dimensionBreakdown: Array<{
      dimensionName: string;
      defects: ContentDefectScan;
    }>;
  } | null> {
    // Get fullReport for on-demand scanning
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      select: { fullReport: true },
    });
    if (!report?.fullReport) return null;

    // Scan fullReport for details
    const allDetails = extractDefectDetails(report.fullReport, 30);

    // If a specific rule is requested, filter to just that rule
    const details: DefectDetails = rule
      ? { [rule]: allDetails[rule] ?? [] }
      : allDetails;

    // Get per-dimension breakdown from stored trace
    const trace = await this.getQualityTrace(reportId);
    const dimensionBreakdown = (trace?.dimensionOutputs ?? []).map((dim) => ({
      dimensionName: dim.dimensionName,
      defects: dim.defects,
    }));

    return { details, dimensionBreakdown };
  }

  // ==================== Scoring Algorithms ====================

  private computeFormattingScore(ctx: QualityTraceContext): number {
    let score = 100;
    for (const dim of ctx.dimensionOutputs) {
      score -= dim.defects.bareLatexCount * 3;
      score -= dim.defects.brokenDollarNesting * 5;
      score -= dim.defects.unwrappedEnvironments * 4;
      score -= dim.defects.pseudoCodeLines * 4;
      score -= dim.defects.htmlEntities * 2;
      score -= dim.defects.longListItems * 1;
    }
    // Post-processing fixes are a good sign (problems caught), but many fixes = many original problems
    if (ctx.postProcessing && ctx.postProcessing.totalFixes > 20) {
      score -= Math.min(10, (ctx.postProcessing.totalFixes - 20) * 0.5);
    }
    return Math.max(0, Math.min(100, score));
  }

  private computeCompletenessScore(ctx: QualityTraceContext): number {
    let score = 100;
    for (const dim of ctx.dimensionOutputs) {
      if (dim.rawOutput.contentLength < 4000) score -= 10;
      else if (dim.rawOutput.contentLength < 2000) score -= 20;
      if (dim.rawOutput.usedFallback) score -= 15;
    }
    // Check synthesis sections
    if (ctx.synthesisOutput) {
      const sections = ctx.synthesisOutput.sectionLengths;
      if (sections.executiveSummary < 200) score -= 15;
      if (sections.crossDimensionAnalysis < 200) score -= 10;
      if (sections.conclusion < 100) score -= 10;
    }
    return Math.max(0, Math.min(100, score));
  }

  private computeSourceScore(ctx: QualityTraceContext): number {
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

  private computeStructureScore(ctx: QualityTraceContext): number {
    if (ctx.dimensionOutputs.length === 0) return 100;

    // Per-dimension scoring: each dimension contributes equally
    let totalScore = 0;
    for (const dim of ctx.dimensionOutputs) {
      let dimScore = 100;
      // Cap missingHeadings penalty at 30 per dimension (6 × 5 = 30)
      dimScore -= Math.min(dim.defects.missingHeadings, 6) * 5;
      dimScore -= Math.min(dim.defects.headingEchoes, 3) * 3;
      dimScore -= Math.min(dim.defects.trappedConclusions, 3) * 3;
      totalScore += Math.max(0, dimScore);
    }

    return Math.round(totalScore / ctx.dimensionOutputs.length);
  }

  private computeLanguageScore(ctx: QualityTraceContext): number {
    let score = 100;
    for (const dim of ctx.dimensionOutputs) {
      if (dim.defects.foreignContentRatio > 0.1) score -= 20;
      else if (dim.defects.foreignContentRatio > 0.05) score -= 10;
      score -= dim.defects.leakedMetaNotes * 5;
      score -= dim.defects.leakedFigureNotes * 3;
    }
    return Math.max(0, Math.min(100, score));
  }

  private extractTopIssues(
    ctx: QualityTraceContext,
  ): FinalAssessmentProbe["topIssues"] {
    const issues: FinalAssessmentProbe["topIssues"] = [];

    // Aggregate defects across dimensions
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

    // Sort by severity (errors first) then by count
    issues.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
      return b.count - a.count;
    });

    return issues.slice(0, 10); // Top 10 issues
  }
}

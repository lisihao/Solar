/**
 * Credibility Report Service
 *
 * 可信度报告服务 (Phase 2.1)
 *
 * 核心职责：
 * 1. 计算研究报告的可信度评分
 * 2. 分析来源质量和多样性
 * 3. 评估时效性和覆盖度
 * 4. 生成 AI 质量指标
 * 5. 识别并声明局限性
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ReportEvaluationService,
  type EvaluationResult,
} from "../quality/report-evaluation.service";

/**
 * 来源类型分布
 */
export interface SourceBreakdown {
  government: number;
  academic: number;
  industry: number;
  news: number;
  blog: number;
  other: number;
  total: number;
}

/**
 * 时效性分布
 */
export interface TimeBreakdown {
  within1Month: number;
  within3Months: number;
  within6Months: number;
  within1Year: number;
  older: number;
  unknown: number;
  total: number;
}

/**
 * 维度覆盖详情
 */
export interface DimensionCoverageDetail {
  dimensionId: string;
  dimensionName: string;
  sourceCount: number;
  targetCount: number;
  status: "excellent" | "good" | "fair" | "poor";
  coveragePercent: number;
}

/**
 * AI 质量指标
 */
export interface AIQualityMetrics {
  planningRounds: number;
  revisionAverage: number;
  approvalRate: number;
  averageConfidence: string;
  totalAgentActivities: number;
}

/**
 * 可信度报告
 */
export interface CredibilityReportData {
  overallScore: number;
  authorityScore: number;
  diversityScore: number;
  timelinessScore: number;
  coverageScore: number;
  sourceBreakdown: SourceBreakdown;
  timeBreakdown: TimeBreakdown;
  coverageDetails: DimensionCoverageDetail[];
  aiQualityMetrics: AIQualityMetrics;
  limitations: string[];
  // AI 评审结果 (10 维)
  aiEvaluation?: EvaluationResult;
  combinedScore?: number;
  combinedGrade?: string;
  summaryText?: string;
}

@Injectable()
export class CredibilityReportService {
  private readonly logger = new Logger(CredibilityReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly evaluationService?: ReportEvaluationService,
  ) {}

  /**
   * 生成或更新报告的可信度评估
   */
  async generateCredibilityReport(
    reportId: string,
  ): Promise<CredibilityReportData> {
    this.logger.log(`Generating credibility report for: ${reportId}`);

    // 1. 获取报告及其相关数据
    const report = await this.prisma.topicReport.findUnique({
      where: { id: reportId },
      include: {
        topic: {
          include: {
            dimensions: { where: { isEnabled: true } },
          },
        },
        evidences: true,
        dimensionAnalyses: {
          include: {
            dimension: true,
          },
        },
      },
    });

    if (!report) {
      throw new NotFoundException(`Report not found: ${reportId}`);
    }

    // 2. 计算来源分布
    const sourceBreakdown = this.calculateSourceBreakdown(report.evidences);

    // 3. 计算时效性分布
    const timeBreakdown = this.calculateTimeBreakdown(report.evidences);

    // 4. 计算维度覆盖度
    const coverageDetails = this.calculateCoverageDetails(
      report.topic.dimensions,
      report.dimensionAnalyses,
      report.evidences,
    );

    // 5. 获取 AI 质量指标
    const aiQualityMetrics = await this.calculateAIQualityMetrics(
      report.topic.id,
    );

    // 6. 计算各项评分
    const authorityScore = this.calculateAuthorityScore(sourceBreakdown);
    const diversityScore = this.calculateDiversityScore(sourceBreakdown);
    const timelinessScore = this.calculateTimelinessScore(timeBreakdown);
    const coverageScore = this.calculateCoverageScore(coverageDetails);

    // 7. 计算综合评分（加权平均）
    const overallScore = this.calculateOverallScore({
      authorityScore,
      diversityScore,
      timelinessScore,
      coverageScore,
    });

    // 8. 生成局限性声明
    const limitations = this.generateLimitations({
      sourceBreakdown,
      timeBreakdown,
      coverageDetails,
      aiQualityMetrics,
    });

    // 9. AI 10 维评审 — 按章节评审（多模型对比）
    let aiEvaluation: EvaluationResult | undefined;
    let combinedScore: number | undefined;
    let combinedGrade: string | undefined;
    let summaryText: string | undefined;

    if (this.evaluationService) {
      try {
        // 从 dimensionAnalyses 构建章节输入
        // ★ 对 modelUsed 为空的旧数据，从 ResearchTask 回填模型信息
        let taskModelMap: Map<string, string> | undefined;
        const hasMissingModels = report.dimensionAnalyses.some(
          (da) => !da.modelUsed,
        );
        if (hasMissingModels) {
          const tasks = await this.prisma.researchTask.findMany({
            where: {
              dimensionId: {
                in: report.dimensionAnalyses
                  .map((da) => da.dimensionId)
                  .filter(Boolean),
              },
              taskType: "dimension_research",
              status: "COMPLETED",
            },
            select: { dimensionId: true, modelId: true },
          });
          taskModelMap = new Map(
            tasks
              .filter((t) => t.dimensionId && t.modelId)
              .map((t) => [t.dimensionId!, t.modelId!]),
          );
        }

        const chapters = report.dimensionAnalyses.map((da) => {
          const dataPoints = da.dataPoints as Record<string, unknown> | null;
          const detailedContent =
            typeof dataPoints?.detailedContent === "string"
              ? dataPoints.detailedContent
              : (da.summary ?? "");
          const dimId = da.dimensionId ?? da.id;
          return {
            chapterId: dimId,
            chapterTitle: da.dimension?.name ?? "未知维度",
            writerModel: da.modelUsed ?? taskModelMap?.get(dimId) ?? "unknown",
            content: detailedContent,
            sourcesUsed: da.sourcesUsed ?? 0,
          };
        });

        aiEvaluation = await this.evaluationService.evaluateReport({
          reportTitle: report.topic.name,
          topicType: report.topic.type,
          chapters,
          language: (report.topic as { language?: string }).language ?? "zh",
        });

        // ★ 附加补救记录：从 dataPoints.remediationTraces 读取
        for (const chEval of aiEvaluation.chapters) {
          const da = report.dimensionAnalyses.find(
            (d) => (d.dimensionId ?? d.id) === chEval.chapterId,
          );
          if (da) {
            const dp = da.dataPoints as Record<string, unknown> | null;
            const traces = dp?.remediationTraces;
            if (Array.isArray(traces) && traces.length > 0) {
              chEval.remediationTraces =
                traces as import("../../types/quality.types").RemediationTrace[];
            }
          }
        }

        // 综合评分：来源可信度 ×0.4 + AI 评审 ×0.6
        if (aiEvaluation.overallScore > 0) {
          combinedScore = Math.round(
            overallScore * 0.4 + aiEvaluation.overallScore * 0.6,
          );
          combinedGrade = this.scoreToGrade(combinedScore);
          summaryText = aiEvaluation.feedback
            ? aiEvaluation.feedback.split(/[。.！!]/)[0] + "。"
            : undefined;
        }
      } catch (error) {
        this.logger.warn(
          `AI evaluation skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 10. 保存到数据库
    const credibilityData: CredibilityReportData = {
      overallScore,
      authorityScore,
      diversityScore,
      timelinessScore,
      coverageScore,
      sourceBreakdown,
      timeBreakdown,
      coverageDetails,
      aiQualityMetrics,
      limitations,
      aiEvaluation,
      combinedScore,
      combinedGrade,
      summaryText,
    };

    await this.saveCredibilityReport(reportId, credibilityData);

    this.logger.log(
      `Credibility report generated: overall score ${overallScore.toFixed(1)}`,
    );

    return credibilityData;
  }

  /**
   * 获取报告的可信度评估
   */
  async getCredibilityReport(
    reportId: string,
  ): Promise<CredibilityReportData | null> {
    const existing = await this.prisma.credibilityReport.findUnique({
      where: { reportId },
    });

    if (!existing) {
      return null;
    }

    return {
      overallScore: existing.overallScore,
      authorityScore: existing.authorityScore,
      diversityScore: existing.diversityScore,
      timelinessScore: existing.timelinessScore,
      coverageScore: existing.coverageScore,
      sourceBreakdown: existing.sourceBreakdown as unknown as SourceBreakdown,
      timeBreakdown: existing.timeBreakdown as unknown as TimeBreakdown,
      coverageDetails:
        existing.coverageDetails as unknown as DimensionCoverageDetail[],
      aiQualityMetrics:
        existing.aiQualityMetrics as unknown as AIQualityMetrics,
      limitations: existing.limitations,
      aiEvaluation: existing.aiEvaluation
        ? (existing.aiEvaluation as unknown as EvaluationResult)
        : undefined,
      combinedScore: existing.combinedScore ?? undefined,
      combinedGrade: existing.combinedGrade ?? undefined,
      summaryText: existing.summaryText ?? undefined,
    };
  }

  /**
   * 获取或生成可信度报告
   */
  async getOrGenerateCredibilityReport(
    reportId: string,
  ): Promise<CredibilityReportData> {
    const existing = await this.getCredibilityReport(reportId);
    if (existing) {
      return existing;
    }
    return this.generateCredibilityReport(reportId);
  }

  /**
   * 综合分数转等级
   */
  private scoreToGrade(score: number): string {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
  }

  /**
   * 计算来源类型分布
   */
  private calculateSourceBreakdown(
    evidences: Array<{ sourceType: string | null; domain: string | null }>,
  ): SourceBreakdown {
    const breakdown: SourceBreakdown = {
      government: 0,
      academic: 0,
      industry: 0,
      news: 0,
      blog: 0,
      other: 0,
      total: evidences.length,
    };

    for (const evidence of evidences) {
      const type = this.categorizeSource(evidence.sourceType, evidence.domain);
      breakdown[type]++;
    }

    return breakdown;
  }

  /**
   * 分类来源类型
   * ★ 增强版：更全面地识别来源类型
   */
  private categorizeSource(
    sourceType: string | null,
    domain: string | null,
  ): keyof Omit<SourceBreakdown, "total"> {
    // 首先基于 sourceType 判断（数据源路由器已经分类）
    if (sourceType) {
      const typeLower = sourceType.toLowerCase();
      // 学术来源
      if (
        typeLower === "academic" ||
        typeLower === "arxiv" ||
        typeLower === "scholar"
      ) {
        return "academic";
      }
      // 新闻来源
      if (typeLower === "news" || typeLower === "hackernews") {
        return "news";
      }
      // 政府来源
      if (typeLower === "government" || typeLower === "local_policy") {
        return "government";
      }
      // 行业来源
      if (
        typeLower === "local_report" ||
        typeLower === "industry" ||
        typeLower === "github"
      ) {
        return "industry";
      }
    }

    // 基于 domain 进行更详细的判断
    if (domain) {
      const domainLower = domain.toLowerCase();

      // ★ 政府来源 - 扩展识别
      if (
        domainLower.includes(".gov") ||
        domainLower.includes(".gov.") ||
        domainLower.includes("government") ||
        domainLower.includes("whitehouse") ||
        domainLower.includes("congress.gov") ||
        domainLower.includes("state.gov") ||
        domainLower.includes("treasury.gov") ||
        domainLower.includes("federalreserve") ||
        domainLower.includes("sec.gov") ||
        domainLower.includes("census.gov") ||
        domainLower.includes("bls.gov") ||
        domainLower.includes("commerce.gov")
      ) {
        return "government";
      }

      // ★ 学术来源 - 扩展识别
      if (
        domainLower.includes(".edu") ||
        domainLower.includes("arxiv") ||
        domainLower.includes("springer") ||
        domainLower.includes("nature.com") ||
        domainLower.includes("science.org") ||
        domainLower.includes("ieee.org") ||
        domainLower.includes("acm.org") ||
        domainLower.includes("sciencedirect") ||
        domainLower.includes("wiley.com") ||
        domainLower.includes("researchgate") ||
        domainLower.includes("semanticscholar") ||
        domainLower.includes("jstor.org") ||
        domainLower.includes("pubmed") ||
        domainLower.includes("ncbi.nlm.nih") ||
        domainLower.includes("scholar.google") ||
        domainLower.includes("ssrn.com") ||
        domainLower.includes("academic.oup") ||
        domainLower.includes("cambridge.org") ||
        domainLower.includes("oxford") ||
        domainLower.includes("mit.edu") ||
        domainLower.includes("stanford.edu") ||
        domainLower.includes("harvard.edu")
      ) {
        return "academic";
      }

      // ★ 新闻来源 - 大幅扩展识别
      if (
        domainLower.includes("reuters") ||
        domainLower.includes("bloomberg") ||
        domainLower.includes("wsj") ||
        domainLower.includes("nytimes") ||
        domainLower.includes("bbc") ||
        domainLower.includes("cnn") ||
        domainLower.includes("cnbc") ||
        domainLower.includes("foxnews") ||
        domainLower.includes("theguardian") ||
        domainLower.includes("washingtonpost") ||
        domainLower.includes("apnews") ||
        domainLower.includes("news.yahoo") ||
        domainLower.includes("news.google") ||
        domainLower.includes("fortune") ||
        domainLower.includes("forbes") ||
        domainLower.includes("businessinsider") ||
        domainLower.includes("economist") ||
        domainLower.includes("ft.com") ||
        domainLower.includes("politico") ||
        domainLower.includes("axios") ||
        domainLower.includes("thehill") ||
        domainLower.includes("newsweek") ||
        domainLower.includes("time.com") ||
        domainLower.includes("usatoday") ||
        domainLower.includes("latimes") ||
        domainLower.includes("chicagotribune") ||
        domainLower.includes("npr.org") ||
        domainLower.includes("pbs.org") ||
        domainLower.includes("abc.com") ||
        domainLower.includes("nbcnews") ||
        domainLower.includes("cbsnews") ||
        domainLower.includes("sina.com") ||
        domainLower.includes("163.com") ||
        domainLower.includes("qq.com") ||
        domainLower.includes("sohu.com") ||
        domainLower.includes("ifeng.com") ||
        domainLower.includes("caixin") ||
        domainLower.includes("xinhua") ||
        domainLower.includes("chinadaily") ||
        domainLower.includes("scmp.com") ||
        domainLower.includes("marketwatch") ||
        domainLower.includes("seekingalpha") ||
        domainLower.includes("investopedia")
      ) {
        return "news";
      }

      // ★ 行业来源 - 扩展识别
      if (
        domainLower.includes("github") ||
        domainLower.includes("gitlab") ||
        domainLower.includes("stackoverflow") ||
        domainLower.includes("techcrunch") ||
        domainLower.includes("wired") ||
        domainLower.includes("arstechnica") ||
        domainLower.includes("theverge") ||
        domainLower.includes("venturebeat") ||
        domainLower.includes("zdnet") ||
        domainLower.includes("cnet") ||
        domainLower.includes("engadget") ||
        domainLower.includes("tomshardware") ||
        domainLower.includes("anandtech") ||
        domainLower.includes("gartner") ||
        domainLower.includes("mckinsey") ||
        domainLower.includes("bcg.com") ||
        domainLower.includes("bain.com") ||
        domainLower.includes("deloitte") ||
        domainLower.includes("pwc.com") ||
        domainLower.includes("kpmg") ||
        domainLower.includes("accenture") ||
        domainLower.includes("statista") ||
        domainLower.includes("ibisworld") ||
        domainLower.includes("idc.com") ||
        domainLower.includes("forrester") ||
        domainLower.includes("mordorintelligence") ||
        domainLower.includes("grandviewresearch") ||
        domainLower.includes("marketsandmarkets")
      ) {
        return "industry";
      }

      // ★ 博客来源识别
      if (
        domainLower.includes("medium.com") ||
        domainLower.includes("blog") ||
        domainLower.includes("wordpress") ||
        domainLower.includes("substack") ||
        domainLower.includes("ghost.io") ||
        domainLower.includes("dev.to") ||
        domainLower.includes("hashnode") ||
        domainLower.includes("blogger") ||
        domainLower.includes("tumblr")
      ) {
        return "blog";
      }
    }

    // ★ 对于 web 类型的通用来源，尝试基于 URL 路径推断
    // 如果 domain 包含知名公司/组织名称，归类为行业
    if (domain) {
      const domainLower = domain.toLowerCase();
      // 知名科技公司
      if (
        domainLower.includes("microsoft") ||
        domainLower.includes("google") ||
        domainLower.includes("amazon") ||
        domainLower.includes("apple") ||
        domainLower.includes("meta") ||
        domainLower.includes("openai") ||
        domainLower.includes("anthropic") ||
        domainLower.includes("nvidia") ||
        domainLower.includes("intel") ||
        domainLower.includes("amd.com") ||
        domainLower.includes("ibm.com") ||
        domainLower.includes("oracle") ||
        domainLower.includes("salesforce") ||
        domainLower.includes("adobe") ||
        domainLower.includes("tesla")
      ) {
        return "industry";
      }
    }

    return "other";
  }

  /**
   * 计算时效性分布
   */
  private calculateTimeBreakdown(
    evidences: Array<{ publishedAt: Date | null }>,
  ): TimeBreakdown {
    const now = new Date();
    const breakdown: TimeBreakdown = {
      within1Month: 0,
      within3Months: 0,
      within6Months: 0,
      within1Year: 0,
      older: 0,
      unknown: 0,
      total: evidences.length,
    };

    for (const evidence of evidences) {
      if (!evidence.publishedAt) {
        breakdown.unknown++;
        continue;
      }

      const daysSince = Math.floor(
        (now.getTime() - evidence.publishedAt.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (daysSince <= 30) {
        breakdown.within1Month++;
      } else if (daysSince <= 90) {
        breakdown.within3Months++;
      } else if (daysSince <= 180) {
        breakdown.within6Months++;
      } else if (daysSince <= 365) {
        breakdown.within1Year++;
      } else {
        breakdown.older++;
      }
    }

    return breakdown;
  }

  /**
   * 计算维度覆盖度
   */
  private calculateCoverageDetails(
    dimensions: Array<{ id: string; name: string; minSources: number | null }>,
    analyses: Array<{ dimensionId: string; dimension: { name: string } }>,
    evidences: Array<{ id: string }>,
  ): DimensionCoverageDetail[] {
    const totalEvidences = evidences.length;
    const dimensionCount = dimensions.length;

    // 估算每个维度的来源数（简化：平均分配）
    const avgSourcesPerDimension =
      dimensionCount > 0 ? Math.floor(totalEvidences / dimensionCount) : 0;

    return dimensions.map((dim) => {
      const hasAnalysis = analyses.some((a) => a.dimensionId === dim.id);
      const targetCount = dim.minSources || 5;
      const sourceCount = hasAnalysis ? avgSourcesPerDimension : 0;
      const coveragePercent = Math.min(
        100,
        Math.round((sourceCount / targetCount) * 100),
      );

      let status: DimensionCoverageDetail["status"];
      if (coveragePercent >= 100) {
        status = "excellent";
      } else if (coveragePercent >= 75) {
        status = "good";
      } else if (coveragePercent >= 50) {
        status = "fair";
      } else {
        status = "poor";
      }

      return {
        dimensionId: dim.id,
        dimensionName: dim.name,
        sourceCount,
        targetCount,
        status,
        coveragePercent,
      };
    });
  }

  /**
   * 计算 AI 质量指标
   */
  private async calculateAIQualityMetrics(
    topicId: string,
  ): Promise<AIQualityMetrics> {
    // 获取 Agent 活动统计
    const activities = await this.prisma.researchAgentActivity.findMany({
      where: { topicId },
      select: {
        agentRole: true,
        activityType: true,
        progress: true,
      },
    });

    const totalActivities = activities.length;
    const planningActivities = activities.filter(
      (a) => a.activityType === "PLANNING",
    ).length;
    const reviewActivities = activities.filter(
      (a) => a.agentRole === "reviewer",
    ).length;
    const completedActivities = activities.filter(
      (a) => a.progress === 100,
    ).length;

    // 计算各指标
    const planningRounds = Math.max(1, planningActivities);
    const revisionAverage =
      reviewActivities > 0 ? reviewActivities / Math.max(1, planningRounds) : 0;
    const approvalRate =
      totalActivities > 0 ? (completedActivities / totalActivities) * 100 : 0;

    // 基于活动完成率估算置信度
    const averageConfidence =
      approvalRate >= 90 ? "high" : approvalRate >= 70 ? "medium" : "low";

    return {
      planningRounds,
      revisionAverage: Math.round(revisionAverage * 10) / 10,
      approvalRate: Math.round(approvalRate),
      averageConfidence,
      totalAgentActivities: totalActivities,
    };
  }

  /**
   * 计算权威性评分 (0-100)
   */
  private calculateAuthorityScore(breakdown: SourceBreakdown): number {
    if (breakdown.total === 0) return 0;

    // 权威来源权重
    const weights = {
      government: 1.0,
      academic: 0.9,
      industry: 0.7,
      news: 0.6,
      blog: 0.3,
      other: 0.4,
    };

    let weightedSum = 0;
    weightedSum += breakdown.government * weights.government;
    weightedSum += breakdown.academic * weights.academic;
    weightedSum += breakdown.industry * weights.industry;
    weightedSum += breakdown.news * weights.news;
    weightedSum += breakdown.blog * weights.blog;
    weightedSum += breakdown.other * weights.other;

    // 归一化到 0-100
    const maxPossible = breakdown.total * 1.0; // 最高权重
    return Math.round((weightedSum / maxPossible) * 100);
  }

  /**
   * 计算多样性评分 (0-100)
   */
  private calculateDiversityScore(breakdown: SourceBreakdown): number {
    if (breakdown.total === 0) return 0;

    // 计算使用的来源类型数
    const typeCounts = [
      breakdown.government,
      breakdown.academic,
      breakdown.industry,
      breakdown.news,
      breakdown.blog,
      breakdown.other,
    ];

    const usedTypes = typeCounts.filter((c) => c > 0).length;
    const totalTypes = 6;

    // 多样性 = 使用的类型数 / 总类型数 * 100
    // 加上分布均匀度奖励
    const typeScore = (usedTypes / totalTypes) * 60;

    // 计算分布均匀度（使用基尼系数的逆）
    const total = breakdown.total;
    const proportions = typeCounts.map((c) => c / total);
    const entropy = -proportions
      .filter((p) => p > 0)
      .reduce((sum, p) => sum + p * Math.log2(p), 0);
    const maxEntropy = Math.log2(totalTypes);
    const uniformityScore = (entropy / maxEntropy) * 40;

    return Math.round(typeScore + uniformityScore);
  }

  /**
   * 计算时效性评分 (0-100)
   */
  private calculateTimelinessScore(breakdown: TimeBreakdown): number {
    if (breakdown.total === 0) return 0;

    // 时效性权重
    const weights = {
      within1Month: 1.0,
      within3Months: 0.85,
      within6Months: 0.7,
      within1Year: 0.5,
      older: 0.2,
      unknown: 0.3,
    };

    let weightedSum = 0;
    weightedSum += breakdown.within1Month * weights.within1Month;
    weightedSum += breakdown.within3Months * weights.within3Months;
    weightedSum += breakdown.within6Months * weights.within6Months;
    weightedSum += breakdown.within1Year * weights.within1Year;
    weightedSum += breakdown.older * weights.older;
    weightedSum += breakdown.unknown * weights.unknown;

    const maxPossible = breakdown.total * 1.0;
    return Math.round((weightedSum / maxPossible) * 100);
  }

  /**
   * 计算覆盖度评分 (0-100)
   */
  private calculateCoverageScore(
    coverageDetails: DimensionCoverageDetail[],
  ): number {
    if (coverageDetails.length === 0) return 0;

    // 计算平均覆盖百分比
    const avgCoverage =
      coverageDetails.reduce((sum, d) => sum + d.coveragePercent, 0) /
      coverageDetails.length;

    // 计算完成维度比例
    const completedDimensions = coverageDetails.filter(
      (d) => d.status === "excellent" || d.status === "good",
    ).length;
    const completionRate = (completedDimensions / coverageDetails.length) * 100;

    // 综合评分 = 平均覆盖 * 0.6 + 完成率 * 0.4
    return Math.round(avgCoverage * 0.6 + completionRate * 0.4);
  }

  /**
   * 计算综合评分
   */
  private calculateOverallScore(scores: {
    authorityScore: number;
    diversityScore: number;
    timelinessScore: number;
    coverageScore: number;
  }): number {
    // 加权平均
    const weights = {
      authority: 0.3,
      diversity: 0.2,
      timeliness: 0.25,
      coverage: 0.25,
    };

    return Math.round(
      scores.authorityScore * weights.authority +
        scores.diversityScore * weights.diversity +
        scores.timelinessScore * weights.timeliness +
        scores.coverageScore * weights.coverage,
    );
  }

  /**
   * 生成局限性声明
   */
  private generateLimitations(data: {
    sourceBreakdown: SourceBreakdown;
    timeBreakdown: TimeBreakdown;
    coverageDetails: DimensionCoverageDetail[];
    aiQualityMetrics: AIQualityMetrics;
  }): string[] {
    const limitations: string[] = [];

    // 来源数量不足
    if (data.sourceBreakdown.total < 10) {
      limitations.push(
        `来源数量有限（仅${data.sourceBreakdown.total}个），可能影响分析全面性`,
      );
    }

    // 缺乏权威来源
    const authoritySources =
      data.sourceBreakdown.government + data.sourceBreakdown.academic;
    if (
      authoritySources === 0 ||
      authoritySources / data.sourceBreakdown.total < 0.1
    ) {
      limitations.push("缺乏政府或学术权威来源，建议补充官方数据");
    }

    // 来源类型单一
    const usedTypes = [
      data.sourceBreakdown.government,
      data.sourceBreakdown.academic,
      data.sourceBreakdown.industry,
      data.sourceBreakdown.news,
    ].filter((c) => c > 0).length;
    if (usedTypes < 3) {
      limitations.push("来源类型较为单一，可能存在信息偏差");
    }

    // 时效性问题
    const recentSources =
      data.timeBreakdown.within1Month + data.timeBreakdown.within3Months;
    if (recentSources / data.timeBreakdown.total < 0.3) {
      limitations.push("大部分来源较为陈旧，可能不反映最新发展");
    }

    // 未知发布时间
    if (data.timeBreakdown.unknown / data.timeBreakdown.total > 0.3) {
      limitations.push("部分来源发布时间未知，时效性难以评估");
    }

    // 维度覆盖不足
    const poorCoverage = data.coverageDetails.filter(
      (d) => d.status === "poor",
    );
    if (poorCoverage.length > 0) {
      const dimNames = poorCoverage
        .slice(0, 3)
        .map((d) => d.dimensionName)
        .join("、");
      limitations.push(`「${dimNames}」等维度数据覆盖不足，分析可能不够深入`);
    }

    // AI 置信度
    if (data.aiQualityMetrics.averageConfidence === "low") {
      limitations.push("AI 分析置信度较低，建议人工复核关键结论");
    }

    // 默认声明
    if (limitations.length === 0) {
      limitations.push("本报告基于公开信息生成，仅供参考");
    }

    return limitations;
  }

  /**
   * 保存可信度报告到数据库
   */
  private async saveCredibilityReport(
    reportId: string,
    data: CredibilityReportData,
  ): Promise<void> {
    // 使用 JSON.parse(JSON.stringify(...)) 来正确序列化为 Prisma JSON 类型
    const sourceBreakdownJson = JSON.parse(
      JSON.stringify(data.sourceBreakdown),
    );
    const timeBreakdownJson = JSON.parse(JSON.stringify(data.timeBreakdown));
    const coverageDetailsJson = JSON.parse(
      JSON.stringify(data.coverageDetails),
    );
    const aiQualityMetricsJson = JSON.parse(
      JSON.stringify(data.aiQualityMetrics),
    );

    const aiEvaluationJson = data.aiEvaluation
      ? JSON.parse(JSON.stringify(data.aiEvaluation))
      : undefined;

    await this.prisma.credibilityReport.upsert({
      where: { reportId },
      create: {
        reportId,
        overallScore: data.overallScore,
        authorityScore: data.authorityScore,
        diversityScore: data.diversityScore,
        timelinessScore: data.timelinessScore,
        coverageScore: data.coverageScore,
        sourceBreakdown: sourceBreakdownJson,
        timeBreakdown: timeBreakdownJson,
        coverageDetails: coverageDetailsJson,
        aiQualityMetrics: aiQualityMetricsJson,
        limitations: data.limitations,
        ...(aiEvaluationJson !== undefined && {
          aiEvaluation: aiEvaluationJson,
        }),
        ...(data.combinedScore !== undefined && {
          combinedScore: data.combinedScore,
        }),
        ...(data.combinedGrade !== undefined && {
          combinedGrade: data.combinedGrade,
        }),
        ...(data.summaryText !== undefined && {
          summaryText: data.summaryText,
        }),
      },
      update: {
        overallScore: data.overallScore,
        authorityScore: data.authorityScore,
        diversityScore: data.diversityScore,
        timelinessScore: data.timelinessScore,
        coverageScore: data.coverageScore,
        sourceBreakdown: sourceBreakdownJson,
        timeBreakdown: timeBreakdownJson,
        coverageDetails: coverageDetailsJson,
        aiQualityMetrics: aiQualityMetricsJson,
        limitations: data.limitations,
        ...(aiEvaluationJson !== undefined && {
          aiEvaluation: aiEvaluationJson,
        }),
        ...(data.combinedScore !== undefined && {
          combinedScore: data.combinedScore,
        }),
        ...(data.combinedGrade !== undefined && {
          combinedGrade: data.combinedGrade,
        }),
        ...(data.summaryText !== undefined && {
          summaryText: data.summaryText,
        }),
        updatedAt: new Date(),
      },
    });
  }
}

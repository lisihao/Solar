import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ExportReportDto } from "../../../dto";
import { ExportOrchestratorService } from "@/common/export/services/export-orchestrator.service";
import { ExportFormat } from "@prisma/client";
import { ReportSynthesisService } from "../../report/report-synthesis.service";
import { sanitizeMarkdownContent } from "@/common/utils/sanitize-content.utils";

/**
 * 清理AI生成内容中的HTML标签
 */
function cleanHtmlTagsFromContent(
  content: string | null | undefined,
): string | null {
  if (!content) return content as null;

  let cleaned = content;

  // 1. 将 <br>, <br/>, <br /> 转换为换行符
  cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");

  // 2. 将 </p><p> 转换为双换行（段落分隔）
  cleaned = cleaned.replace(/<\/p>\s*<p>/gi, "\n\n");

  // 3. 将 <p> 和 </p> 单独出现时转换为换行
  cleaned = cleaned.replace(/<\/?p>/gi, "\n");

  // 4. 移除其他常见HTML标签但保留内容
  cleaned = cleaned.replace(
    /<\/?(?:div|span|strong|em|b|i|u|a|ul|ol|li|h[1-6])[^>]*>/gi,
    "",
  );

  // 5. 清理多余的连续换行（超过2个变成2个）
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // 6. 清理行首行尾的空白
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * TopicExportService
 *
 * 负责专题的导出、分享、可见性管理
 */
@Injectable()
export class TopicExportService {
  private readonly logger = new Logger(TopicExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exportOrchestrator: ExportOrchestratorService,
    private readonly reportService: ReportSynthesisService,
  ) {}

  /**
   * 导出报告
   */
  async exportReport(
    userId: string,
    topicId: string,
    reportId: string,
    dto: ExportReportDto,
  ) {
    // 验证专题所有权
    await this.verifyTopicOwnership(userId, topicId);

    const report = await this.reportService.getReport(reportId);

    if (!report || report.topicId !== topicId) {
      throw new NotFoundException("Report not found");
    }

    // 映射格式
    const format = dto.format === "pdf" ? ExportFormat.PDF : ExportFormat.DOCX;

    // 创建导出任务
    const jobResponse = await this.exportOrchestrator.createExportJob(userId, {
      source: {
        type: "REPORT",
        reportId,
      },
      format,
      options: {
        includeCover: true,
        includeTableOfContents: true,
        includeReferences: true,
        fileName: `research-report-v${report.version}`,
      },
    });

    // 如果任务已完成，直接返回下载链接
    if (jobResponse.status === "COMPLETED" && jobResponse.downloadUrl) {
      return {
        downloadUrl: jobResponse.downloadUrl,
        fileName: jobResponse.fileName,
        fileSize: jobResponse.fileSize,
      };
    }

    // 否则返回任务 ID 让前端轮询
    return {
      jobId: jobResponse.jobId,
      status: jobResponse.status,
      downloadUrl: jobResponse.downloadUrl,
    };
  }

  /**
   * 更新专题可见性
   * ★ 修复：使用 Prisma update 替代 raw SQL，确保更新成功
   */
  async updateVisibility(
    userId: string,
    topicId: string,
    visibility: string,
  ): Promise<{ success: boolean; visibility: string }> {
    this.logger.log(
      `[updateVisibility] 更新专题 ${topicId} 可见性为 ${visibility}`,
    );

    // 验证所有者权限
    const topic = await this.prisma.researchTopic.findFirst({
      where: { id: topicId, userId },
    });

    if (!topic) {
      this.logger.warn(
        `[updateVisibility] 专题 ${topicId} 不存在或用户 ${userId} 无权修改`,
      );
      throw new NotFoundException("专题不存在或无权修改");
    }

    // 使用 Prisma update 替代 raw SQL，确保类型安全
    const updatedTopic = await this.prisma.researchTopic.update({
      where: { id: topicId },
      data: {
        visibility: visibility as "PRIVATE" | "SHARED" | "PUBLIC",
      },
      select: { id: true, name: true, visibility: true },
    });

    this.logger.log(
      `[updateVisibility] 专题 "${updatedTopic.name}" (${topicId}) 可见性已更新为 ${updatedTopic.visibility}`,
    );

    return { success: true, visibility: updatedTopic.visibility };
  }

  /**
   * 获取专题共享设置
   */
  async getSharingSettings(
    userId: string,
    topicId: string,
  ): Promise<{
    topicId: string;
    visibility: string;
    collaboratorCount: number;
    publicLink?: string;
  }> {
    // 先验证访问权限
    const topic = await this.prisma.researchTopic.findFirst({
      where: {
        id: topicId,
        OR: [
          { userId },
          { collaborators: { some: { userId, isActive: true } } },
        ],
      },
    });

    if (!topic) {
      throw new NotFoundException("专题不存在或无权访问");
    }

    // 获取协作者数量
    const collaboratorCount = await this.prisma.topicCollaborator.count({
      where: { topicId, isActive: true },
    });

    // 使用原始查询获取 visibility 字段
    const result = await this.prisma.$queryRaw<{ visibility: string }[]>`
      SELECT visibility FROM research_topics WHERE id = ${topicId}
    `;
    const visibility = result[0]?.visibility || "PRIVATE";

    return {
      topicId: topic.id,
      visibility,
      collaboratorCount,
      publicLink:
        visibility === "PUBLIC" ? `/shared/topics/${topic.id}` : undefined,
    };
  }

  /**
   * 获取公开的专题详情（无需认证）
   * ★ 优化：使用 Prisma 直接查询，确保返回完整数据
   */
  async getSharedTopic(topicId: string) {
    this.logger.log(`[getSharedTopic] 获取公开专题 ${topicId}`);

    // 直接查询专题（包含 visibility 检查）
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      include: {
        dimensions: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!topic) {
      this.logger.warn(`[getSharedTopic] 专题 ${topicId} 不存在`);
      throw new NotFoundException("Topic not found");
    }

    this.logger.debug(
      `[getSharedTopic] 专题 "${topic.name}" 可见性: ${topic.visibility}`,
    );

    if (topic.visibility !== "PUBLIC") {
      this.logger.warn(
        `[getSharedTopic] 专题 "${topic.name}" (${topicId}) 不是公开的，拒绝访问`,
      );
      throw new NotFoundException("Topic not found or not publicly accessible");
    }

    // ★ 获取【有内容的】报告统计，跳过空草稿
    const [completedReportCount, latestCompletedReport] = await Promise.all([
      this.prisma.topicReport.count({
        where: {
          topicId,
          dimensionAnalyses: { some: {} },
        },
      }),
      this.prisma.topicReport.findFirst({
        where: {
          topicId,
          dimensionAnalyses: { some: {} },
        },
        orderBy: { generatedAt: "desc" },
        select: {
          id: true,
          version: true,
          totalSources: true,
          generatedAt: true,
        },
      }),
    ]);

    const result = {
      ...topic,
      totalReports: completedReportCount,
      totalSources:
        latestCompletedReport?.totalSources || topic.totalSources || 0,
      lastRefreshAt: latestCompletedReport?.generatedAt || topic.lastRefreshAt,
    };

    this.logger.log(
      `[getSharedTopic] 返回专题 "${topic.name}", ${completedReportCount} 份已完成报告, ${result.totalSources} 个来源`,
    );

    return result;
  }

  /**
   * 获取公开专题的最新报告（无需认证）
   * ★ 优化：增强日志和错误处理
   */
  async getSharedTopicLatestReport(topicId: string) {
    this.logger.log(
      `[getSharedTopicLatestReport] 获取专题 ${topicId} 的最新报告`,
    );

    // 检查专题是否存在且为公开
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { id: true, name: true, visibility: true },
    });

    if (!topic) {
      this.logger.warn(`[getSharedTopicLatestReport] 专题 ${topicId} 不存在`);
      throw new NotFoundException("Topic not found");
    }

    if (topic.visibility !== "PUBLIC") {
      this.logger.warn(
        `[getSharedTopicLatestReport] 专题 "${topic.name}" 不是公开的`,
      );
      throw new NotFoundException("Topic not found or not publicly accessible");
    }

    // ★ 获取最新的【有内容的】报告
    const report = await this.prisma.topicReport.findFirst({
      where: {
        topicId,
        dimensionAnalyses: { some: {} },
      },
      orderBy: { generatedAt: "desc" },
      include: {
        topic: {
          select: {
            id: true,
            name: true,
            type: true,
            description: true,
          },
        },
        dimensionAnalyses: {
          include: {
            dimension: {
              select: {
                id: true,
                name: true,
                description: true,
              },
            },
          },
          orderBy: {
            dimension: {
              sortOrder: "asc",
            },
          },
        },
      },
    });

    if (!report) {
      this.logger.warn(
        `[getSharedTopicLatestReport] 专题 "${topic.name}" 没有已完成的报告`,
      );
      throw new NotFoundException("No completed reports found for this topic");
    }

    this.logger.log(
      `[getSharedTopicLatestReport] 返回报告 v${report.version}, ` +
        `${report.dimensionAnalyses?.length || 0} 个维度分析`,
    );

    // 转换报告数据，提取 dataPoints 中的字段到顶层
    return this.transformReportForFrontend(report);
  }

  /**
   * 转换报告数据以适配前端接口
   * ★ 同时清理AI生成内容中的HTML标签和Markdown格式问题
   */
  private transformReportForFrontend(report: Record<string, unknown> | null) {
    if (!report) return report;

    // ★ 清理报告级别的内容字段（HTML标签 + 下划线等格式问题）
    if (report.executiveSummary) {
      report.executiveSummary = sanitizeMarkdownContent(
        cleanHtmlTagsFromContent(report.executiveSummary as string) || "",
      );
    }
    if (report.fullReport) {
      report.fullReport = sanitizeMarkdownContent(
        cleanHtmlTagsFromContent(report.fullReport as string) || "",
      );
    }

    // 转换维度分析数据
    if (report.dimensionAnalyses) {
      // ★ 辅助函数：清理HTML + 下划线等格式问题
      const cleanAndSanitize = (content: string | undefined | null): string => {
        if (!content) return "";
        return sanitizeMarkdownContent(cleanHtmlTagsFromContent(content) || "");
      };

      interface DataPointsShape {
        trends?: Record<string, unknown>[];
        challenges?: Record<string, unknown>[];
        opportunities?: Record<string, unknown>[];
        confidenceLevel?: string;
        detailedContent?: string;
      }

      interface KeyFindingShape {
        finding?: string;
        implication?: string;
        [key: string]: unknown;
      }

      interface AnalysisShape {
        analysis?: string;
        summary?: string;
        dataPoints?: DataPointsShape | null;
        keyFindings?: KeyFindingShape[];
        [key: string]: unknown;
      }

      report.dimensionAnalyses = (
        report.dimensionAnalyses as AnalysisShape[]
      ).map((analysis: AnalysisShape) => {
        const dataPoints = analysis.dataPoints as DataPointsShape | null;

        // ★ 清理维度分析中的文本内容
        const cleanedAnalysis = cleanAndSanitize(analysis.analysis);
        const cleanedSummary = cleanAndSanitize(analysis.summary);
        const cleanedDetailedContent = cleanAndSanitize(
          dataPoints?.detailedContent,
        );

        // ★ 清理 keyFindings 中的文本
        const cleanedKeyFindings =
          analysis.keyFindings?.map((kf: KeyFindingShape) => ({
            ...kf,
            finding: cleanAndSanitize(kf.finding),
            implication: cleanAndSanitize(kf.implication),
          })) || [];

        // ★ 清理趋势、挑战、机会中的文本
        const cleanedTrends = (dataPoints?.trends || []).map(
          (t: Record<string, unknown>) => ({
            ...t,
            trend: cleanAndSanitize(t.trend as string),
            drivers: cleanAndSanitize(t.drivers as string),
            prediction: cleanAndSanitize(t.prediction as string),
          }),
        );

        const cleanedChallenges = (dataPoints?.challenges || []).map(
          (c: Record<string, unknown>) => ({
            ...c,
            challenge: cleanAndSanitize(c.challenge as string),
            rootCause: cleanAndSanitize(c.rootCause as string),
            impact: cleanAndSanitize(c.impact as string),
            potentialSolutions: cleanAndSanitize(
              c.potentialSolutions as string,
            ),
          }),
        );

        const cleanedOpportunities = (dataPoints?.opportunities || []).map(
          (o: Record<string, unknown>) => ({
            ...o,
            opportunity: cleanAndSanitize(o.opportunity as string),
            potential: cleanAndSanitize(o.potential as string),
            requirements: cleanAndSanitize(o.requirements as string),
          }),
        );

        return {
          ...analysis,
          analysis: cleanedAnalysis,
          summary: cleanedSummary,
          keyFindings: cleanedKeyFindings,
          // 从 dataPoints 提取到顶层（已清理）
          trends: cleanedTrends,
          challenges: cleanedChallenges,
          opportunities: cleanedOpportunities,
          confidenceLevel: dataPoints?.confidenceLevel || null,
          detailedContent: cleanedDetailedContent,
        };
      });
    }

    return report;
  }

  /**
   * 验证专题所有权（仅创建者可访问，用于写入操作）
   */
  private async verifyTopicOwnership(
    userId: string,
    topicId: string,
  ): Promise<void> {
    const topic = await this.prisma.researchTopic.findUnique({
      where: { id: topicId },
      select: { userId: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }

    if (topic.userId !== userId) {
      throw new ForbiddenException(
        "You do not have permission to access this topic",
      );
    }
  }
}

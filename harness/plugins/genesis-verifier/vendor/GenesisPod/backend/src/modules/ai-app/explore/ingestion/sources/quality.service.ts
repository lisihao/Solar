import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

export interface QualityIssue {
  id: string;
  resourceId: string;
  resourceTitle: string;
  resourceType: string;
  issueType: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  message: string;
  detectedAt: Date;
  reviewStatus: string;
}

export interface QualityStats {
  totalResources: number;
  totalIssues: number;
  highPriority: number;
  mediumPriority: number;
  lowPriority: number;
  avgQualityScore: number;
  completenessRate: number;
  duplicateRate: number;
}

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 获取所有质量问题
   */
  async getIssues(filters?: {
    severity?: string;
    reviewStatus?: string;
    limit?: number;
  }): Promise<QualityIssue[]> {
    const where: Record<string, unknown> = {};

    if (filters?.reviewStatus) {
      where.reviewStatus = filters.reviewStatus;
    }

    const metrics = await this.prisma.dataQualityMetric.findMany({
      where,
      take: filters?.limit || 100,
      orderBy: { createdAt: "desc" },
    });

    // 解析issues字段
    const issues: QualityIssue[] = [];
    for (const metric of metrics) {
      if (!metric.issues) continue;

      const issueArray = metric.issues as Array<{
        type: string;
        severity: "HIGH" | "MEDIUM" | "LOW";
        message: string;
      }>;
      for (const issue of issueArray) {
        // 根据severity过滤
        if (filters?.severity && issue.severity !== filters.severity) {
          continue;
        }

        issues.push({
          id: `${metric.id}_${issue.type}`,
          resourceId: metric.resourceId,
          resourceTitle: "Resource Title", // TODO: 从resource表获取
          resourceType: metric.resourceType,
          issueType: issue.type,
          severity: issue.severity,
          message: issue.message,
          detectedAt: metric.createdAt,
          reviewStatus: metric.reviewStatus,
        });
      }
    }

    return issues;
  }

  /**
   * 获取质量统计
   */
  async getStats(): Promise<QualityStats> {
    const metrics = await this.prisma.dataQualityMetric.findMany();

    const issues = await this.getIssues();
    const highPriority = issues.filter((i) => i.severity === "HIGH").length;
    const mediumPriority = issues.filter((i) => i.severity === "MEDIUM").length;
    const lowPriority = issues.filter((i) => i.severity === "LOW").length;

    const avgQualityScore =
      metrics.length > 0
        ? metrics.reduce((sum, m) => sum + m.qualityScore, 0) / metrics.length
        : 0;

    const avgCompletenessScore =
      metrics.length > 0
        ? metrics.reduce((sum, m) => sum + m.completenessScore, 0) /
          metrics.length
        : 0;

    const duplicates = metrics.filter((m) => m.isDuplicate).length;
    const duplicateRate =
      metrics.length > 0 ? (duplicates / metrics.length) * 100 : 0;

    return {
      totalResources: metrics.length,
      totalIssues: issues.length,
      highPriority,
      mediumPriority,
      lowPriority,
      avgQualityScore,
      completenessRate: avgCompletenessScore,
      duplicateRate,
    };
  }

  /**
   * 更新问题审核状态
   */
  async updateReviewStatus(
    resourceId: string,
    status: string,
    note?: string,
  ): Promise<void> {
    await this.prisma.dataQualityMetric.updateMany({
      where: { resourceId },
      data: {
        reviewStatus: status,
        reviewNote: note,
        reviewedAt: new Date(),
      },
    });
  }

  /**
   * 评估资源质量
   */
  async assessResourceQuality(resourceId: string): Promise<{
    qualityScore: number;
    completenessScore: number;
    issues: Array<{
      type: string;
      severity: string;
      message: string;
    }>;
  } | null> {
    const resource = await this.prisma.resource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      return null;
    }

    // 计算完整性评分
    const hasTitle = !!resource.title && resource.title.length > 0;
    const hasContent =
      !!resource.content ||
      !!resource.abstract ||
      (!!resource.pdfUrl && resource.pdfUrl.length > 0);
    const hasAuthor =
      !!resource.authors && (resource.authors as unknown[]).length > 0;
    const hasPublishDate = !!resource.publishedAt;
    const hasMetadata = !!resource.metadata;

    const completenessScore =
      (hasTitle ? 20 : 0) +
      (hasContent ? 30 : 0) +
      (hasAuthor ? 20 : 0) +
      (hasPublishDate ? 15 : 0) +
      (hasMetadata ? 15 : 0);

    // 检测问题
    const issues: Array<{
      type: string;
      severity: string;
      message: string;
    }> = [];
    if (!hasTitle) {
      issues.push({
        type: "MISSING_TITLE",
        severity: "HIGH",
        message: "Resource is missing a title",
      });
    }
    if (!hasContent) {
      issues.push({
        type: "MISSING_CONTENT",
        severity: "HIGH",
        message: "Resource has no content or abstract",
      });
    }
    if (!hasAuthor) {
      issues.push({
        type: "MISSING_AUTHOR",
        severity: "MEDIUM",
        message: "No author information available",
      });
    }
    if (resource.title && resource.title.length < 10) {
      issues.push({
        type: "SHORT_TITLE",
        severity: "LOW",
        message: "Title is too short",
      });
    }

    // 保存或更新质量指标
    const qualityScore = completenessScore;

    await this.prisma.dataQualityMetric.upsert({
      where: {
        resourceType_resourceId: {
          resourceType: resource.type,
          resourceId: resource.id,
        },
      },
      create: {
        resourceType: resource.type,
        resourceId: resource.id,
        sourceUrl: resource.sourceUrl,
        qualityScore,
        completenessScore,
        relevanceScore: 0,
        duplicateScore: 0,
        isDuplicate: false,
        issues,
        tags: [],
        reviewStatus: "PENDING",
      },
      update: {
        qualityScore,
        completenessScore,
        issues,
      },
    });

    return {
      qualityScore,
      completenessScore,
      issues,
    };
  }

  /**
   * 批量评估质量
   */
  async batchAssessQuality(limit: number = 100): Promise<number> {
    const resources = await this.prisma.resource.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
    });

    let assessed = 0;
    for (const resource of resources) {
      try {
        await this.assessResourceQuality(resource.id);
        assessed++;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to assess quality for ${resource.id}: ${errorMessage}`,
        );
      }
    }

    return assessed;
  }
}

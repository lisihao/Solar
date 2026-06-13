import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AnnotationStatus, AnnotationType } from "@prisma/client";

/**
 * 报告批注管理服务
 * 负责批注的 CRUD 和批量操作
 */
@Injectable()
export class ReportAnnotationService {
  private readonly logger = new Logger(ReportAnnotationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建批注
   */
  async createAnnotation(
    reportId: string,
    userId: string,
    dto: {
      content: string;
      type: AnnotationType;
      selectedText?: string;
      startOffset: number;
      endOffset: number;
      selectorPrefix?: string;
      selectorSuffix?: string;
      color?: string;
    },
  ) {
    const annotation = await this.prisma.reportAnnotation.create({
      data: {
        reportId,
        content: dto.content,
        type: dto.type,
        selectedText: dto.selectedText,
        startOffset: dto.startOffset,
        endOffset: dto.endOffset,
        // TODO: 运行 prisma migrate 后启用以下字段
        // selectorPrefix: dto.selectorPrefix,
        // selectorSuffix: dto.selectorSuffix,
        // color: dto.color || 'yellow',
        createdById: userId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    this.logger.log(
      `Annotation ${annotation.id} created for report ${reportId}`,
    );
    return annotation;
  }

  /**
   * 获取报告的所有批注
   */
  async getAnnotations(reportId: string, status?: AnnotationStatus) {
    const where: Record<string, unknown> = { reportId };
    if (status) {
      where.status = status;
    }

    return this.prisma.reportAnnotation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    });
  }

  /**
   * 更新批注
   */
  async updateAnnotation(
    annotationId: string,
    dto: {
      content?: string;
      status?: AnnotationStatus;
    },
  ) {
    const annotation = await this.prisma.reportAnnotation.findUnique({
      where: { id: annotationId },
    });

    if (!annotation) {
      throw new NotFoundException(`Annotation ${annotationId} not found`);
    }

    const updated = await this.prisma.reportAnnotation.update({
      where: { id: annotationId },
      data: {
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    });

    this.logger.log(`Annotation ${annotationId} updated`);
    return updated;
  }

  /**
   * 删除批注
   */
  async deleteAnnotation(annotationId: string) {
    const annotation = await this.prisma.reportAnnotation.findUnique({
      where: { id: annotationId },
    });

    if (!annotation) {
      throw new NotFoundException(`Annotation ${annotationId} not found`);
    }

    await this.prisma.reportAnnotation.delete({
      where: { id: annotationId },
    });

    this.logger.log(`Annotation ${annotationId} deleted`);
    return { success: true };
  }

  /**
   * 解决批注
   */
  async resolveAnnotation(annotationId: string, userId: string) {
    const annotation = await this.prisma.reportAnnotation.findUnique({
      where: { id: annotationId },
    });

    if (!annotation) {
      throw new NotFoundException(`Annotation ${annotationId} not found`);
    }

    const resolved = await this.prisma.reportAnnotation.update({
      where: { id: annotationId },
      data: {
        status: AnnotationStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedById: userId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    });

    this.logger.log(`Annotation ${annotationId} resolved by user ${userId}`);
    return resolved;
  }

  /**
   * 批量解决批注
   */
  async resolveAllAnnotations(
    reportId: string,
    userId: string,
    annotationIds?: string[],
  ) {
    const where: Record<string, unknown> = {
      reportId,
      status: AnnotationStatus.OPEN,
    };

    if (annotationIds && annotationIds.length > 0) {
      where.id = { in: annotationIds };
    }

    const result = await this.prisma.reportAnnotation.updateMany({
      where,
      data: {
        status: AnnotationStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedById: userId,
      },
    });

    this.logger.log(
      `Resolved ${result.count} annotations for report ${reportId}`,
    );
    return result.count;
  }

  /**
   * 获取批注统计
   */
  async getAnnotationStats(reportId: string) {
    const annotations = await this.prisma.reportAnnotation.findMany({
      where: { reportId },
      select: {
        status: true,
        type: true,
      },
    });

    const stats = {
      total: annotations.length,
      byStatus: {
        open: annotations.filter((a) => a.status === AnnotationStatus.OPEN)
          .length,
        resolved: annotations.filter(
          (a) => a.status === AnnotationStatus.RESOLVED,
        ).length,
        dismissed: annotations.filter(
          (a) => a.status === AnnotationStatus.DISMISSED,
        ).length,
      },
      byType: {
        comment: annotations.filter((a) => a.type === AnnotationType.COMMENT)
          .length,
        suggestion: annotations.filter(
          (a) => a.type === AnnotationType.SUGGESTION,
        ).length,
        issue: annotations.filter((a) => a.type === AnnotationType.ISSUE)
          .length,
        reference: annotations.filter(
          (a) => a.type === AnnotationType.REFERENCE,
        ).length,
      },
    };

    return stats;
  }
}

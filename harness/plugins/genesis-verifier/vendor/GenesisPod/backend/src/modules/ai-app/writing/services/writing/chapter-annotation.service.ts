import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { AnnotationStatus } from "@prisma/client";
import {
  CreateAnnotationDto,
  UpdateAnnotationDto,
  AnnotationResponse,
} from "../../dto/chapter-annotation.dto";

@Injectable()
export class ChapterAnnotationService {
  private readonly logger = new Logger(ChapterAnnotationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取章节的所有批注
   */
  async getAnnotations(
    chapterId: string,
    userId: string,
    status?: AnnotationStatus,
  ): Promise<{ items: AnnotationResponse[]; total: number }> {
    await this.verifyChapterAccess(chapterId, userId);

    const where = {
      chapterId,
      ...(status && { status }),
    };

    const [items, total] = await Promise.all([
      this.prisma.chapterAnnotation.findMany({
        where,
        orderBy: { startOffset: "asc" },
      }),
      this.prisma.chapterAnnotation.count({ where }),
    ]);

    return {
      items: items.map((a) => this.mapToResponse(a)),
      total,
    };
  }

  /**
   * 创建批注
   */
  async createAnnotation(
    chapterId: string,
    userId: string,
    dto: CreateAnnotationDto,
  ): Promise<AnnotationResponse> {
    await this.verifyChapterAccess(chapterId, userId);

    const annotation = await this.prisma.chapterAnnotation.create({
      data: {
        chapterId,
        startOffset: dto.startOffset,
        endOffset: dto.endOffset,
        content: dto.content,
        type: dto.type || "COMMENT",
        selectedText: dto.selectedText,
      },
    });

    this.logger.log(`Annotation created for chapter ${chapterId}`);

    return this.mapToResponse(annotation);
  }

  /**
   * 更新批注
   */
  async updateAnnotation(
    annotationId: string,
    userId: string,
    dto: UpdateAnnotationDto,
  ): Promise<AnnotationResponse> {
    await this.getAnnotationWithAccess(annotationId, userId);

    const updateData: Record<string, unknown> = {};

    if (dto.content !== undefined) {
      updateData.content = dto.content;
    }

    if (dto.status !== undefined) {
      updateData.status = dto.status;
      if (dto.status === AnnotationStatus.RESOLVED) {
        updateData.resolvedAt = new Date();
      }
    }

    const updated = await this.prisma.chapterAnnotation.update({
      where: { id: annotationId },
      data: updateData,
    });

    this.logger.log(`Annotation ${annotationId} updated`);

    return this.mapToResponse(updated);
  }

  /**
   * 删除批注
   */
  async deleteAnnotation(annotationId: string, userId: string): Promise<void> {
    await this.getAnnotationWithAccess(annotationId, userId);

    await this.prisma.chapterAnnotation.delete({
      where: { id: annotationId },
    });

    this.logger.log(`Annotation ${annotationId} deleted`);
  }

  /**
   * 批量解决批注
   */
  async resolveAnnotations(
    chapterId: string,
    userId: string,
    annotationIds: string[],
  ): Promise<{ resolved: number }> {
    await this.verifyChapterAccess(chapterId, userId);

    const result = await this.prisma.chapterAnnotation.updateMany({
      where: {
        id: { in: annotationIds },
        chapterId,
      },
      data: {
        status: AnnotationStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    });

    this.logger.log(
      `${result.count} annotations resolved for chapter ${chapterId}`,
    );

    return { resolved: result.count };
  }

  /**
   * 获取批注统计
   */
  async getAnnotationStats(
    chapterId: string,
    userId: string,
  ): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  }> {
    await this.verifyChapterAccess(chapterId, userId);

    const annotations = await this.prisma.chapterAnnotation.findMany({
      where: { chapterId },
      select: { status: true, type: true },
    });

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const a of annotations) {
      byStatus[a.status] = (byStatus[a.status] || 0) + 1;
      byType[a.type] = (byType[a.type] || 0) + 1;
    }

    return {
      total: annotations.length,
      byStatus,
      byType,
    };
  }

  // ==================== Private Methods ====================

  private async verifyChapterAccess(chapterId: string, userId: string) {
    const chapter = await this.prisma.writingChapter.findUnique({
      where: { id: chapterId },
      include: {
        volume: {
          include: {
            project: { select: { ownerId: true } },
          },
        },
      },
    });

    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    if (chapter.volume.project.ownerId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return chapter;
  }

  private async getAnnotationWithAccess(annotationId: string, userId: string) {
    const annotation = await this.prisma.chapterAnnotation.findUnique({
      where: { id: annotationId },
      include: {
        chapter: {
          include: {
            volume: {
              include: {
                project: { select: { ownerId: true } },
              },
            },
          },
        },
      },
    });

    if (!annotation) {
      throw new NotFoundException("Annotation not found");
    }

    if (annotation.chapter.volume.project.ownerId !== userId) {
      throw new ForbiddenException("Access denied");
    }

    return annotation;
  }

  private mapToResponse(annotation: {
    id: string;
    chapterId: string;
    startOffset: number;
    endOffset: number;
    content: string;
    type: string;
    status: string;
    selectedText: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }): AnnotationResponse {
    return {
      id: annotation.id,
      chapterId: annotation.chapterId,
      startOffset: annotation.startOffset,
      endOffset: annotation.endOffset,
      content: annotation.content,
      type: annotation.type as AnnotationResponse["type"],
      status: annotation.status as AnnotationResponse["status"],
      selectedText: annotation.selectedText,
      createdAt: annotation.createdAt,
      resolvedAt: annotation.resolvedAt,
    };
  }
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  PostWriteValidationService,
  ConsistencyIssue,
} from "./post-write-validation.service";
import { ConflictResolutionService } from "./conflict-resolution.service";
import { ChapterCoherenceService } from "./chapter-coherence.service";
import { ContextBuilderService } from "../writing/context-builder.service";

@Injectable()
export class ConsistencyEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postWriteValidation: PostWriteValidationService,
    private readonly conflictResolution: ConflictResolutionService,
    private readonly chapterCoherence: ChapterCoherenceService,
    private readonly contextBuilder: ContextBuilderService,
  ) {}

  async buildWritingContext(
    chapterId: string,
    bibleSnapshot?: Record<string, unknown>,
  ) {
    return this.contextBuilder.buildWritingContext(chapterId, bibleSnapshot);
  }

  async validateChapter(chapterId: string, userId: string) {
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

    if (!chapter || chapter.volume.project.ownerId !== userId) {
      throw new Error("Chapter not found or access denied");
    }

    if (!chapter.content) {
      return { status: "SKIPPED", reason: "No content to validate" };
    }

    const report = await this.postWriteValidation.validate(
      chapterId,
      chapter.content,
    );

    // Save check result
    await this.prisma.consistencyCheck.create({
      data: {
        chapterId,
        checkType: "CHARACTER",
        status: report.issues.length > 0 ? "ISSUES_FOUND" : "PASSED",
        issues: report.issues as object[],
        suggestions: report.suggestions as unknown as object[],
      },
    });

    return report;
  }

  async getProjectReport(projectId: string, userId: string) {
    const project = await this.prisma.writingProject.findFirst({
      where: { id: projectId, ownerId: userId },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    const checks = await this.prisma.consistencyCheck.findMany({
      where: {
        chapter: {
          volume: { projectId },
        },
      },
      include: {
        chapter: {
          select: { id: true, title: true, chapterNumber: true },
        },
      },
      orderBy: { checkedAt: "desc" },
    });

    const summary = {
      total: checks.length,
      passed: checks.filter((c) => c.status === "PASSED").length,
      issuesFound: checks.filter((c) => c.status === "ISSUES_FOUND").length,
      pending: checks.filter((c) => c.status === "PENDING").length,
      resolved: checks.filter((c) => c.status === "RESOLVED").length,
    };

    return {
      projectId,
      summary,
      recentChecks: checks.slice(0, 20),
    };
  }

  async resolveConflicts(chapterId: string, issues: unknown[]) {
    return this.conflictResolution.resolve(
      chapterId,
      issues as ConsistencyIssue[],
    );
  }

  /**
   * 检查章节与前一章节的连贯性
   */
  async checkChapterCoherence(chapterId: string, userId: string) {
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

    if (!chapter || chapter.volume.project.ownerId !== userId) {
      throw new Error("Chapter not found or access denied");
    }

    const result =
      await this.chapterCoherence.checkChapterTransition(chapterId);

    // 保存检查结果
    await this.chapterCoherence.saveCoherenceCheck(chapterId, result);

    return result;
  }

  /**
   * 检查整卷的章节连贯性
   */
  async checkVolumeCoherence(volumeId: string, userId: string) {
    const volume = await this.prisma.writingVolume.findUnique({
      where: { id: volumeId },
      include: {
        project: { select: { ownerId: true } },
      },
    });

    if (!volume || volume.project.ownerId !== userId) {
      throw new Error("Volume not found or access denied");
    }

    return this.chapterCoherence.checkVolumeCoherence(volumeId);
  }

  /**
   * 快速连贯性检查（用于写作流程中实时调用）
   */
  async quickCoherenceCheck(chapterId: string) {
    return this.chapterCoherence.quickCoherenceCheck(chapterId);
  }
}

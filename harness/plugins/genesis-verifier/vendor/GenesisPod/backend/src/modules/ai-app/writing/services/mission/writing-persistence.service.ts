/**
 * Writing Persistence Service
 *
 * 负责所有与数据库交互的操作，包括任务记录、内容保存、项目管理等。
 *
 * 核心职责：
 * 1. Mission CRUD 操作
 * 2. 章节和卷的创建、更新
 * 3. 内容保存和字数统计
 * 4. 任务日志管理
 * 5. 权限验证
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import type {
  WritingMissionInput,
  WritingMissionResult,
} from "./writing-mission.types";

@Injectable()
export class WritingPersistence {
  private readonly logger = new Logger(WritingPersistence.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 验证项目访问权限
   */
  async verifyProjectAccess(projectId: string, userId: string): Promise<void> {
    const project = await this.prisma.writingProject.findUnique({
      where: { id: projectId },
      select: { ownerId: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== userId) {
      throw new Error("Access denied");
    }
  }

  /**
   * 创建任务记录
   */
  async createMissionRecord(
    missionId: string,
    input: WritingMissionInput,
    _userId: string,
  ) {
    // Convert mission type to uppercase and map to valid enum values
    const missionTypeMap: Record<string, string> = {
      outline: "OUTLINE",
      chapter: "CHAPTER",
      revision: "REVISION",
      consistency: "CONSISTENCY",
      consistency_check: "CONSISTENCY",
      full_story: "CHAPTER",
      edit: "REVISION",
    };
    const missionType =
      missionTypeMap[input.missionType.toLowerCase()] || "CHAPTER";

    return this.prisma.writingMission.create({
      data: {
        id: missionId,
        projectId: input.projectId,
        missionType: missionType as
          | "OUTLINE"
          | "CHAPTER"
          | "REVISION"
          | "CONSISTENCY",
        targetId: input.chapterId || input.volumeId || input.projectId,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        contextPackage: {
          userPrompt: input.userPrompt,
          targetWordCount: input.targetWordCount,
          additionalInstructions: input.additionalInstructions,
        },
      },
    });
  }

  /**
   * 更新任务记录
   */
  async updateMissionRecord(
    missionId: string,
    result: WritingMissionResult,
  ): Promise<void> {
    const mission = await this.prisma.writingMission.update({
      where: { id: missionId },
      data: {
        status: result.success ? "COMPLETED" : "FAILED",
        completedAt: new Date(),
        result: {
          success: result.success,
          content: result.content,
          wordCount: result.wordCount,
          tokensUsed: result.tokensUsed,
          costUsed: result.costUsed,
          duration: result.duration,
          error: result.error
            ? {
                code: result.error.code,
                message: result.error.message,
                retryable: result.error.retryable,
              }
            : null,
        },
      },
    });

    // 更新项目状态
    const project = await this.prisma.writingProject.findUnique({
      where: { id: mission.projectId },
      select: { currentWords: true },
    });

    if (project) {
      const newStatus = result.success
        ? "REVISING"
        : project.currentWords > 0
          ? "REVISING"
          : "PLANNING";

      await this.prisma.writingProject.update({
        where: { id: mission.projectId },
        data: { status: newStatus },
      });

      this.logger.log(
        `Updated project ${mission.projectId} status to ${newStatus}`,
      );
    }
  }

  /**
   * 保存生成的内容
   */
  async saveGeneratedContent(
    input: WritingMissionInput,
    content: string,
    wordCount: number,
    missionId?: string,
    modelId?: string,
    updateStoryBibleCallback?: (
      projectId: string,
      missionId: string,
      chapterNumber: number,
      content: string,
      modelId: string,
    ) => Promise<void>,
  ): Promise<void> {
    try {
      // 跳过完成标记
      if (
        content.startsWith("[ALL_CHAPTERS_COMPLETED]") ||
        content.startsWith("[CONTINUATION_COMPLETE]")
      ) {
        this.logger.log(
          `Skipping save for completion marker: ${content.substring(0, 50)}...`,
        );
        return;
      }

      if (
        input.missionType === "full_story" ||
        input.missionType === "outline"
      ) {
        await this.createVolumeAndChapters(input.projectId, content, wordCount);
      } else if (input.missionType === "chapter" && input.chapterId) {
        await this.updateChapterContent(input.chapterId, content, wordCount);
        if (missionId && modelId && updateStoryBibleCallback) {
          const chapter = await this.prisma.writingChapter.findUnique({
            where: { id: input.chapterId },
            select: { chapterNumber: true },
          });
          if (chapter) {
            await updateStoryBibleCallback(
              input.projectId,
              missionId,
              chapter.chapterNumber,
              content,
              modelId,
            );
          }
        }
      } else if (input.missionType === "chapter" && input.volumeId) {
        await this.createNewChapter(input.volumeId, content, wordCount);
        if (missionId && modelId && updateStoryBibleCallback) {
          const chapterCount = await this.prisma.writingChapter.count({
            where: { volumeId: input.volumeId },
          });
          await updateStoryBibleCallback(
            input.projectId,
            missionId,
            chapterCount,
            content,
            modelId,
          );
        }
      } else if (input.missionType === "edit") {
        if (input.chapterId) {
          await this.updateChapterContent(input.chapterId, content, wordCount);
          if (missionId && modelId && updateStoryBibleCallback) {
            const chapter = await this.prisma.writingChapter.findUnique({
              where: { id: input.chapterId },
              select: { chapterNumber: true },
            });
            if (chapter) {
              await updateStoryBibleCallback(
                input.projectId,
                missionId,
                chapter.chapterNumber,
                content,
                modelId,
              );
            }
          }
        } else {
          await this.saveEditToLatestContent(
            input.projectId,
            content,
            wordCount,
          );
        }
      }

      await this.updateProjectWordCount(input.projectId);
      this.logger.log(
        `Saved generated content: ${wordCount} words for project ${input.projectId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to save generated content: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 创建大纲结构（卷和章节，空内容）
   */
  async createOutlineStructure(
    projectId: string,
    outline: {
      core: { summary: string; genre: string; theme: string };
      volumes: Array<{
        title: string;
        conflict: string;
        plot: string;
        emotion: string;
      }>;
      chapters: Array<{
        volumeIndex: number;
        title: string;
        plot: string;
        keyPoint: string;
      }>;
    },
  ): Promise<void> {
    try {
      // 删除现有的卷和章节
      const existingVolumes = await this.prisma.writingVolume.findMany({
        where: { projectId },
        select: { id: true },
      });
      if (existingVolumes.length > 0) {
        await this.prisma.writingChapter.deleteMany({
          where: { volumeId: { in: existingVolumes.map((v) => v.id) } },
        });
        await this.prisma.writingVolume.deleteMany({
          where: { projectId },
        });
      }

      // 创建卷
      const volumeMap = new Map<number, string>();
      for (let i = 0; i < outline.volumes.length; i++) {
        const vol = outline.volumes[i];
        const volume = await this.prisma.writingVolume.create({
          data: {
            projectId,
            title: vol.title || `第${this.numberToChinese(i + 1)}卷`,
            volumeNumber: i + 1,
            synopsis: vol.plot || vol.conflict || "",
            targetWords: 50000,
          },
        });
        volumeMap.set(i, volume.id);
      }

      // 创建章节（空内容）
      for (const ch of outline.chapters) {
        const volumeId = volumeMap.get(ch.volumeIndex);
        if (!volumeId) continue;

        const existingChapters = await this.prisma.writingChapter.count({
          where: { volumeId },
        });

        await this.prisma.writingChapter.create({
          data: {
            volumeId,
            title: ch.title,
            chapterNumber: existingChapters + 1,
            content: "",
            outline: ch.plot || ch.keyPoint || "",
            wordCount: 0,
            status: "DRAFT",
          },
        });
      }

      this.logger.log(
        `Created outline structure: ${outline.volumes.length} volumes, ${outline.chapters.length} chapters`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create outline structure: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * 创建卷和章节（从内容分割）
   */
  async createVolumeAndChapters(
    projectId: string,
    content: string,
    wordCount: number,
  ): Promise<void> {
    const splitChapters = this.splitIntoChapters(content);
    this.logger.log(`Split content into ${splitChapters.length} chapters`);

    const existingChapters = await this.prisma.writingChapter.findMany({
      where: { volume: { projectId } },
      orderBy: { chapterNumber: "asc" },
      include: { volume: true },
    });

    // 如果有现有章节，更新它们
    if (existingChapters.length > 0) {
      for (let i = 0; i < splitChapters.length; i++) {
        const chapterContent = splitChapters[i];
        const chapterWordCount = this.countWords(chapterContent);
        const chapterNumber = i + 1;
        const chapterTitle = this.extractChapterTitle(
          chapterContent,
          chapterNumber,
        );

        const existingChapter = existingChapters.find(
          (ch) => ch.chapterNumber === chapterNumber,
        );

        if (existingChapter) {
          await this.prisma.writingChapter.update({
            where: { id: existingChapter.id },
            data: {
              content: chapterContent,
              wordCount: chapterWordCount,
              status: "DRAFT",
              updatedAt: new Date(),
            },
          });
        } else {
          const firstVolume = existingChapters[0]?.volume;
          if (firstVolume) {
            await this.prisma.writingChapter.create({
              data: {
                volumeId: firstVolume.id,
                title: chapterTitle,
                chapterNumber,
                content: chapterContent,
                wordCount: chapterWordCount,
                status: "DRAFT",
              },
            });
          }
        }
      }
      await this.updateProjectWordCount(projectId);
      return;
    }

    // 创建新卷和章节
    let volume = await this.prisma.writingVolume.findFirst({
      where: { projectId },
      orderBy: { volumeNumber: "asc" },
    });

    if (!volume) {
      volume = await this.prisma.writingVolume.create({
        data: {
          projectId,
          title: "第一卷",
          volumeNumber: 1,
          synopsis: "AI 生成的故事内容",
          targetWords: wordCount,
        },
      });
    }

    for (let i = 0; i < splitChapters.length; i++) {
      const chapterContent = splitChapters[i];
      const chapterWordCount = this.countWords(chapterContent);
      const chapterNumber = i + 1;
      const chapterTitle = this.extractChapterTitle(
        chapterContent,
        chapterNumber,
      );

      await this.prisma.writingChapter.create({
        data: {
          volumeId: volume.id,
          title: chapterTitle,
          chapterNumber,
          content: chapterContent,
          wordCount: chapterWordCount,
          status: "DRAFT",
        },
      });
    }
  }

  /**
   * 更新章节内容
   */
  async updateChapterContent(
    chapterId: string,
    content: string,
    wordCount: number,
  ): Promise<void> {
    await this.prisma.writingChapter.update({
      where: { id: chapterId },
      data: {
        content,
        wordCount,
        status: "DRAFT",
        updatedAt: new Date(),
      },
    });
  }

  /**
   * 创建新章节
   */
  async createNewChapter(
    volumeId: string,
    content: string,
    wordCount: number,
  ): Promise<void> {
    const existingChapterCount = await this.prisma.writingChapter.count({
      where: { volumeId },
    });

    const chapterNumber = existingChapterCount + 1;

    await this.prisma.writingChapter.create({
      data: {
        volumeId,
        title: `第${chapterNumber}章`,
        chapterNumber,
        content,
        wordCount,
        status: "DRAFT",
      },
    });
  }

  /**
   * 保存编辑到最新内容
   */
  private async saveEditToLatestContent(
    projectId: string,
    content: string,
    wordCount: number,
  ): Promise<void> {
    const latestVolume = await this.prisma.writingVolume.findFirst({
      where: { projectId },
      orderBy: { volumeNumber: "desc" },
    });

    if (latestVolume) {
      const latestChapter = await this.prisma.writingChapter.findFirst({
        where: { volumeId: latestVolume.id },
        orderBy: { chapterNumber: "desc" },
      });

      if (latestChapter) {
        await this.updateChapterContent(latestChapter.id, content, wordCount);
      } else {
        await this.createNewChapter(latestVolume.id, content, wordCount);
      }
    } else {
      await this.createVolumeAndChapters(projectId, content, wordCount);
    }
  }

  /**
   * 更新项目字数统计
   */
  async updateProjectWordCount(projectId: string): Promise<void> {
    const volumes = await this.prisma.writingVolume.findMany({
      where: { projectId },
      include: {
        chapters: { select: { wordCount: true } },
      },
    });

    const totalWords = volumes.reduce(
      (sum, vol) =>
        sum + vol.chapters.reduce((s, ch) => s + (ch.wordCount || 0), 0),
      0,
    );

    await this.prisma.writingProject.update({
      where: { id: projectId },
      data: { currentWords: totalWords },
    });

    this.logger.log(
      `Updated project ${projectId} word count: ${totalWords} words`,
    );
  }

  /**
   * 获取项目的所有任务
   */
  async getProjectMissions(
    projectId: string,
    status?: string,
  ): Promise<{ items: unknown[]; total: number }> {
    const where: Record<string, unknown> = { projectId };
    if (status) {
      where.status = status.toUpperCase();
    }

    const [missions, total] = await Promise.all([
      this.prisma.writingMission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.writingMission.count({ where }),
    ]);

    return {
      items: missions.map((m) => ({
        id: m.id,
        projectId: m.projectId,
        missionType: m.missionType,
        status: m.status,
        createdAt: m.createdAt,
        startedAt: m.startedAt,
        completedAt: m.completedAt,
        result: m.result,
        progress:
          ((m.result as Record<string, unknown> | null)?.[
            "progress"
          ] as number) || 0,
        currentStep:
          ((m.result as Record<string, unknown> | null)?.[
            "currentStep"
          ] as string) || "",
      })),
      total,
    };
  }

  /**
   * 获取任务状态
   */
  async getMissionStatus(missionId: string, userId: string) {
    const mission = await this.prisma.writingMission.findUnique({
      where: { id: missionId },
      include: {
        project: { select: { ownerId: true } },
      },
    });

    if (!mission) {
      throw new NotFoundException("Mission not found");
    }

    if (mission.project.ownerId !== userId) {
      throw new NotFoundException("Mission not found");
    }

    return mission;
  }

  /**
   * 强制清理卡住的任务
   */
  async forceCleanupStuckMissions(projectId: string, _userId: string) {
    const stuckMissions = await this.prisma.writingMission.findMany({
      where: {
        projectId,
        status: "IN_PROGRESS",
      },
    });

    if (stuckMissions.length === 0) {
      return {
        success: true,
        message: "没有发现卡住的任务",
        cleanedCount: 0,
      };
    }

    await this.prisma.writingMission.updateMany({
      where: {
        id: { in: stuckMissions.map((m) => m.id) },
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        result: {
          success: false,
          error: {
            code: "FORCED_CLEANUP",
            message: "任务被手动清理",
            retryable: false,
          },
        },
      },
    });

    return {
      success: true,
      message: `已清理 ${stuckMissions.length} 个卡住的任务`,
      cleanedCount: stuckMissions.length,
    };
  }

  /**
   * 取消任务
   */
  async cancelMission(missionId: string, userId: string) {
    const mission = await this.getMissionStatus(missionId, userId);

    if (mission.status !== "IN_PROGRESS") {
      throw new Error("只能取消进行中的任务");
    }

    await this.prisma.writingMission.update({
      where: { id: missionId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        result: {
          success: false,
          error: {
            code: "USER_CANCELLED",
            message: "任务被用户取消",
            retryable: false,
          },
        },
      },
    });

    return { success: true, message: "任务已取消" };
  }

  /**
   * 获取任务日志
   */
  async getMissionLogs(missionId: string, userId: string, limit: number = 100) {
    await this.getMissionStatus(missionId, userId);

    const logs = await this.prisma.writingMissionLog.findMany({
      where: { missionId },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    return logs;
  }

  /**
   * 保存任务日志
   */
  async saveMissionLog(
    missionId: string,
    eventType: string,
    content: string,
    options?: {
      agentId?: string;
      agentName?: string;
      detail?: Record<string, unknown>;
    },
  ) {
    try {
      await this.prisma.writingMissionLog.create({
        data: {
          missionId,
          eventType,
          content,
          agentId: options?.agentId,
          agentName: options?.agentName,
          detail: options?.detail as object | undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to save mission log: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 工具方法：分割内容为章节
   */
  private splitIntoChapters(content: string): string[] {
    const chapterPattern =
      /(?=第[一二三四五六七八九十百千\d]+章|Chapter\s*\d+)/gi;
    const parts = content.split(chapterPattern).filter((p) => p.trim());

    if (parts.length === 0) {
      return [content];
    }

    return parts;
  }

  /**
   * 工具方法：提取章节标题
   */
  private extractChapterTitle(content: string, _chapterNumber: number): string {
    const titleMatch = content.match(
      /^(?:#{1,6}\s*)?第[一二三四五六七八九十百千\d]+[章回][：:\s]+(.+?)[\n\r]/i,
    );

    let chapterTitle = titleMatch
      ? titleMatch[1]
          .trim()
          .replace(/^第[一二三四五六七八九十百千\d]+[章回][：:\s]*/i, "")
          .replace(/^#{1,6}\s*/, "")
      : "";

    if (
      !chapterTitle ||
      chapterTitle.match(/^第[一二三四五六七八九十百千\d]+[章回]$/)
    ) {
      chapterTitle = "";
    }

    return chapterTitle;
  }

  /**
   * 工具方法：计算字数
   */
  private countWords(text: string): number {
    return text.replace(/\s/g, "").length;
  }

  /**
   * 工具方法：数字转中文
   */
  private numberToChinese(num: number): string {
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    const units = ["", "十", "百", "千"];

    if (num < 10) return digits[num];
    if (num === 10) return "十";
    if (num < 20) return "十" + digits[num % 10];

    const str = num.toString();
    let result = "";

    for (let i = 0; i < str.length; i++) {
      const digit = parseInt(str[i]);
      const unit = units[str.length - i - 1];
      if (digit !== 0) {
        result += digits[digit] + unit;
      }
    }

    return result;
  }
}

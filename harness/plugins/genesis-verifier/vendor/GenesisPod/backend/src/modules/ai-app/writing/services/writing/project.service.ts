import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { CreateProjectDto, UpdateProjectDto } from "../../dto/project.dto";
import { CreateVolumeDto } from "../../dto/volume.dto";

@Injectable()
export class ProjectService {
  private readonly _logger = new Logger(ProjectService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateProjectDto) {
    this._logger.log(`Creating writing project for user ${userId}`);

    const project = await this.prisma.writingProject.create({
      data: {
        name: dto.name,
        description: dto.description,
        genre: dto.genre,
        targetWords: dto.targetWords || 100000,
        writingStyle: dto.writingStyle,
        targetAudience: dto.targetAudience,
        pov: dto.pov,
        tense: dto.tense,
        maxParallelWriters: dto.maxParallelWriters || 3,
        ownerId: userId,
        // Auto-create Story Bible
        storyBible: {
          create: {},
        },
      },
      include: {
        storyBible: true,
      },
    });

    return project;
  }

  async findAll(
    userId: string,
    options: { status?: string; limit?: number; cursor?: string },
  ) {
    const { status, limit = 20, cursor } = options;

    const where: Record<string, unknown> = { ownerId: userId };
    if (status) {
      where.status = status;
    }

    const projects = await this.prisma.writingProject.findMany({
      where,
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        volumes: {
          select: { id: true },
        },
        _count: {
          select: {
            volumes: true,
            missions: true,
          },
        },
      },
    });

    const hasMore = projects.length > limit;
    if (hasMore) {
      projects.pop();
    }

    // 自动修复状态不一致：WRITING 状态但无运行中任务 → REVISING
    await this.syncProjectStatuses(
      projects.filter((p) => p.status === "WRITING").map((p) => p.id),
    );

    // 重新获取可能已更新的项目
    const refreshedProjects = await this.prisma.writingProject.findMany({
      where: { id: { in: projects.map((p) => p.id) } },
      orderBy: { createdAt: "desc" },
      include: {
        volumes: {
          select: { id: true },
        },
        _count: {
          select: {
            volumes: true,
            missions: true,
          },
        },
      },
    });

    return {
      items: refreshedProjects,
      hasMore,
      nextCursor: hasMore
        ? refreshedProjects[refreshedProjects.length - 1]?.id
        : null,
    };
  }

  /**
   * 同步项目状态：检查 WRITING 状态的项目是否有运行中任务
   */
  private async syncProjectStatuses(projectIds: string[]) {
    if (projectIds.length === 0) return;

    for (const projectId of projectIds) {
      // 检查是否有运行中的任务
      const runningMission = await this.prisma.writingMission.findFirst({
        where: {
          projectId,
          status: "IN_PROGRESS",
        },
      });

      // 如果没有运行中任务，更新状态
      if (!runningMission) {
        const project = await this.prisma.writingProject.findUnique({
          where: { id: projectId },
          select: { currentWords: true, status: true },
        });

        if (project && project.status === "WRITING") {
          const newStatus = project.currentWords > 0 ? "REVISING" : "PLANNING";
          await this.prisma.writingProject.update({
            where: { id: projectId },
            data: { status: newStatus },
          });
          this._logger.log(
            `Auto-fixed project ${projectId} status: WRITING → ${newStatus}`,
          );
        }
      }
    }
  }

  async findOne(id: string, userId: string) {
    const project = await this.prisma.writingProject.findFirst({
      where: { id, ownerId: userId },
      include: {
        storyBible: {
          include: {
            characters: true,
            worldSettings: true,
            terminologies: true,
            timelineEvents: true,
            factions: true,
          },
        },
        volumes: {
          include: {
            chapters: {
              select: {
                id: true,
                chapterNumber: true,
                title: true,
                status: true,
                wordCount: true,
              },
            },
          },
          orderBy: { volumeNumber: "asc" },
        },
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found");
    }

    return project;
  }

  async update(id: string, userId: string, dto: UpdateProjectDto) {
    await this.verifyOwnership(id, userId);

    return this.prisma.writingProject.update({
      where: { id },
      data: dto,
    });
  }

  async delete(id: string, userId: string) {
    await this.verifyOwnership(id, userId);

    return this.prisma.writingProject.delete({
      where: { id },
    });
  }

  async createVolume(projectId: string, userId: string, dto: CreateVolumeDto) {
    await this.verifyOwnership(projectId, userId);

    return this.prisma.writingVolume.create({
      data: {
        projectId,
        volumeNumber: dto.volumeNumber,
        title: dto.title,
        synopsis: dto.synopsis,
        targetWords: dto.targetWords,
      },
    });
  }

  async getVolumes(projectId: string, userId: string) {
    await this.verifyOwnership(projectId, userId);

    return this.prisma.writingVolume.findMany({
      where: { projectId },
      include: {
        chapters: {
          select: {
            id: true,
            volumeId: true,
            chapterNumber: true,
            title: true,
            outline: true,
            content: true,
            status: true,
            wordCount: true,
          },
          orderBy: { chapterNumber: "asc" },
        },
      },
      orderBy: { volumeNumber: "asc" },
    });
  }

  /**
   * Get public project (for sharing - no auth required)
   * Only returns project if visibility is PUBLIC
   */
  async findPublic(id: string) {
    const project = await this.prisma.writingProject.findFirst({
      where: {
        id,
        visibility: "PUBLIC",
      },
      include: {
        owner: {
          select: {
            username: true,
          },
        },
        volumes: {
          include: {
            chapters: {
              select: {
                id: true,
                chapterNumber: true,
                title: true,
                content: true,
                wordCount: true,
              },
              orderBy: { chapterNumber: "asc" },
            },
          },
          orderBy: { volumeNumber: "asc" },
        },
      },
    });

    if (!project) {
      return null;
    }

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      genre: project.genre,
      currentWords: project.currentWords,
      targetWords: project.targetWords,
      createdAt: project.createdAt.toISOString(),
      userName: project.owner?.username || undefined,
      volumes: project.volumes,
    };
  }

  private async verifyOwnership(projectId: string, userId: string) {
    const project = await this.prisma.writingProject.findFirst({
      where: { id: projectId, ownerId: userId },
    });

    if (!project) {
      throw new ForbiddenException("You do not have access to this project");
    }

    return project;
  }

  /**
   * 根据章节号查找章节
   */
  async findChapterByNumber(projectId: string, chapterNumber: number) {
    return this.prisma.writingChapter.findFirst({
      where: {
        volume: { projectId },
        chapterNumber,
      },
      select: { id: true },
    });
  }

  /**
   * 批量重置章节内容
   */
  async resetChaptersByNumbers(projectId: string, chapterNumbers: number[]) {
    const result = await this.prisma.writingChapter.updateMany({
      where: {
        volume: { projectId },
        chapterNumber: { in: chapterNumbers },
      },
      data: {
        content: "",
        wordCount: 0,
        status: "PLANNED",
      },
    });

    // 更新项目字数统计
    const totalWords = await this.prisma.writingChapter.aggregate({
      where: { volume: { projectId } },
      _sum: { wordCount: true },
    });

    await this.prisma.writingProject.update({
      where: { id: projectId },
      data: { currentWords: totalWords._sum.wordCount || 0 },
    });

    return result;
  }
}

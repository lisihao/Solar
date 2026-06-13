import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * Writing 数据导出服务
 * 封装 Writing 模块的数据导出能力，供 Office 等其他模块调用
 */

export interface ExportableWritingData {
  id: string;
  name: string;
  genre: string | null;
  writingStyle: string | null;
  createdAt: Date;
  volumes: Array<{
    id: string;
    title: string;
    volumeNumber: number;
    chapters: Array<{
      id: string;
      title: string;
      chapterNumber: number;
      content: string | null;
    }>;
  }>;
}

export interface WritingListItem {
  id: string;
  name: string;
  genre: string | null;
  createdAt: Date;
  volumeCount: number;
}

@Injectable()
export class WritingDataExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取 Writing Project 数据（用于导出到其他模块）
   */
  async getProjectForExport(
    projectId: string,
    userId: string,
  ): Promise<ExportableWritingData> {
    const project = await this.prisma.writingProject.findFirst({
      where: {
        id: projectId,
        ownerId: userId,
      },
      include: {
        volumes: {
          orderBy: { volumeNumber: "asc" },
          include: {
            chapters: {
              orderBy: { chapterNumber: "asc" },
            },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Writing project not found: ${projectId}`);
    }

    return {
      id: project.id,
      name: project.name,
      genre: project.genre,
      writingStyle: project.writingStyle,
      createdAt: project.createdAt,
      volumes: project.volumes.map((v) => ({
        id: v.id,
        title: v.title,
        volumeNumber: v.volumeNumber,
        chapters: v.chapters.map((c) => ({
          id: c.id,
          title: c.title,
          chapterNumber: c.chapterNumber,
          content: c.content,
        })),
      })),
    };
  }

  /**
   * 列出用户的 Writing Projects（用于其他模块的选择列表）
   */
  async listProjectsForExport(
    userId: string,
    limit = 50,
  ): Promise<WritingListItem[]> {
    const projects = await this.prisma.writingProject.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        _count: {
          select: { volumes: true },
        },
      },
    });

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      genre: p.genre,
      createdAt: p.createdAt,
      volumeCount: p._count.volumes,
    }));
  }
}

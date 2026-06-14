import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * Research Project 数据导出服务
 * 封装 ResearchProject 模块的数据导出能力，供 Office 等其他模块调用
 */

export interface ExportableResearchProjectData {
  id: string;
  name: string;
  description: string | null;
  researchType: string;
  createdAt: Date;
  outputs: Array<{
    id: string;
    type: string;
    title: string;
    status: string;
    content: string | null;
  }>;
}

export interface ResearchProjectListItem {
  id: string;
  name: string;
  description: string | null;
  researchType: string;
  createdAt: Date;
  outputCount: number;
}

@Injectable()
export class ResearchProjectExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取 Research Project 数据（用于导出到其他模块）
   * 仅包含 COMPLETED 状态的 outputs
   */
  async getProjectForExport(
    projectId: string,
    userId: string,
  ): Promise<ExportableResearchProjectData> {
    const project = await this.prisma.researchProject.findFirst({
      where: {
        id: projectId,
        userId,
      },
      include: {
        outputs: {
          where: { status: "COMPLETED" },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Research project not found: ${projectId}`);
    }

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      researchType: project.researchType,
      createdAt: project.createdAt,
      outputs: project.outputs.map((o) => ({
        id: o.id,
        type: o.type,
        title: o.title,
        status: o.status,
        content: o.content,
      })),
    };
  }

  /**
   * 列出用户的 Research Projects（用于其他模块的选择列表）
   * 仅包含 ACTIVE 状态的项目，按最近访问时间降序
   */
  async listProjectsForExport(
    userId: string,
    limit = 50,
  ): Promise<ResearchProjectListItem[]> {
    const projects = await this.prisma.researchProject.findMany({
      where: {
        userId,
        status: "ACTIVE",
      },
      orderBy: { lastAccessAt: "desc" },
      take: limit,
      include: {
        _count: {
          select: { outputs: true },
        },
      },
    });

    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      researchType: p.researchType,
      createdAt: p.createdAt,
      outputCount: p._count.outputs,
    }));
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TaskStatus } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { CreateWorkspaceDto, UpdateWorkspaceResourcesDto } from "./dto";

const workspaceInclude = {
  resources: {
    include: {
      resource: {
        select: {
          id: true,
          title: true,
          type: true,
          primaryCategory: true,
          tags: true,
          publishedAt: true,
          abstract: true,
          aiSummary: true,
          thumbnailUrl: true,
        },
      },
    },
  },
  tasks: {
    orderBy: {
      createdAt: "desc" as const,
    },
  },
  reports: {
    orderBy: {
      createdAt: "desc" as const,
    },
    select: {
      id: true,
      title: true,
      template: true,
      createdAt: true,
    },
  },
} satisfies Prisma.WorkspaceInclude;

type WorkspaceWithRelations = Prisma.WorkspaceGetPayload<{
  include: typeof workspaceInclude;
}>;

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
    const resourceIds = this.getUniqueResourceIds(dto.resourceIds);
    if (resourceIds.length < 2) {
      throw new BadRequestException("工作区至少需要选择 2 个资源");
    }

    const workspace = await this.prisma.workspace.create({
      data: {
        userId,
        resources: {
          create: resourceIds.map((resourceId) => ({
            resourceId,
          })),
        },
      },
      include: workspaceInclude,
    });

    return this.serializeWorkspace(workspace);
  }

  async getWorkspace(id: string, userId?: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: workspaceInclude,
    });

    if (!workspace) {
      throw new NotFoundException(`Workspace ${id} 不存在`);
    }

    if (userId && workspace.userId !== userId) {
      throw new ForbiddenException(`无权访问 Workspace ${id}`);
    }

    return this.serializeWorkspace(workspace);
  }

  async updateWorkspaceResources(
    id: string,
    userId: string,
    dto: UpdateWorkspaceResourcesDto,
  ) {
    await this.ensureWorkspaceOwnership(id, userId);

    const operations: Prisma.PrismaPromise<unknown>[] = [];

    if (dto.addResourceIds?.length) {
      const ids = this.getUniqueResourceIds(dto.addResourceIds);
      if (ids.length > 0) {
        operations.push(
          this.prisma.workspaceResource.createMany({
            data: ids.map((resourceId) => ({
              workspaceId: id,
              resourceId,
            })),
            skipDuplicates: true,
          }),
        );
      }
    }

    if (dto.removeResourceIds?.length) {
      const ids = this.getUniqueResourceIds(dto.removeResourceIds);
      if (ids.length > 0) {
        operations.push(
          this.prisma.workspaceResource.deleteMany({
            where: {
              workspaceId: id,
              resourceId: { in: ids },
            },
          }),
        );
      }
    }

    if (operations.length === 0) {
      throw new BadRequestException(
        "请提供 addResourceIds 或 removeResourceIds",
      );
    }

    await this.prisma.$transaction(operations);

    return this.getWorkspace(id, userId);
  }

  async ensureWorkspaceOwnership(id: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!workspace) {
      throw new NotFoundException(`Workspace ${id} 不存在`);
    }

    if (workspace.userId !== userId) {
      throw new ForbiddenException(`无权访问 Workspace ${id}`);
    }
  }

  serializeWorkspace(workspace: WorkspaceWithRelations) {
    return {
      id: workspace.id,
      status: workspace.status,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      resourceCount: workspace.resources.length,
      resources: workspace.resources.map((item) => ({
        id: item.resourceId,
        metadata: item.metadata ?? {},
        addedAt: item.createdAt,
        resource: item.resource,
      })),
      tasks: workspace.tasks.map((task) => this.serializeTask(task)),
      reports: workspace.reports,
    };
  }

  serializeTask(
    task: Prisma.WorkspaceTaskGetPayload<{ include?: Record<string, unknown> }>,
    options: { includeResult?: boolean } = {},
  ) {
    const { includeResult = false } = options;
    return {
      id: task.id,
      workspaceId: task.workspaceId,
      templateId: task.templateId,
      externalTaskId: task.externalTaskId,
      model: task.model,
      status: task.status,
      queuePosition: task.queuePosition,
      estimatedTime: task.estimatedTime,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      hasResult: !!task.result,
      hasError: !!task.error,
      result: includeResult ? task.result : undefined,
      error: task.error,
      parameters: task.parameters ?? null,
      metadata: task.metadata ?? {},
    };
  }

  private getUniqueResourceIds(resourceIds: string[]): string[] {
    const unique = Array.from(new Set(resourceIds));
    return unique.filter((id) => Boolean(id));
  }

  isTerminalStatus(status: TaskStatus) {
    return status === TaskStatus.SUCCESS || status === TaskStatus.FAILED;
  }
}

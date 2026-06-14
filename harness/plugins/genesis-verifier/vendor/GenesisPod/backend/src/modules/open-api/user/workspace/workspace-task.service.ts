import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { Prisma, TaskStatus } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { WorkspaceService } from "./workspace.service";
import { CreateWorkspaceTaskDto } from "./dto";
import { WorkspaceAiClient } from "./workspace-ai.client";

const workspaceResourceInclude = {
  resource: {
    select: {
      id: true,
      type: true,
      title: true,
      abstract: true,
      aiSummary: true,
      content: true,
      sourceUrl: true,
      pdfUrl: true,
      tags: true,
      primaryCategory: true,
      authors: true,
      publishedAt: true,
    },
  },
} as const;

type WorkspaceResourceWithData = Prisma.WorkspaceResourceGetPayload<{
  include: typeof workspaceResourceInclude;
}>;

@Injectable()
export class WorkspaceTaskService {
  private readonly logger = new Logger(WorkspaceTaskService.name);
  private readonly taskSyncTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceAiClient: WorkspaceAiClient,
  ) {}

  async createTask(
    userId: string,
    workspaceId: string,
    dto: CreateWorkspaceTaskDto,
  ) {
    await this.workspaceService.ensureWorkspaceOwnership(workspaceId, userId);

    const template = await this.prisma.reportTemplate.findUnique({
      where: { id: dto.templateId },
    });

    if (!template) {
      throw new NotFoundException(`Report template ${dto.templateId} 不存在`);
    }

    const { selectedResources, selectedResourceIds } =
      await this.prepareResourcesForTask(workspaceId, dto.resourceIds);

    let task = await this.prisma.workspaceTask.create({
      data: {
        workspaceId,
        templateId: dto.templateId,
        model: dto.model,
        status: TaskStatus.PENDING,
        parameters: {
          question: dto.question,
          overrides: dto.overrides,
          resourceIds: selectedResourceIds,
        },
      },
    });

    task = await this.enqueueAiTask(
      task,
      dto,
      selectedResources,
      selectedResourceIds,
    );

    if (
      task.externalTaskId &&
      !this.workspaceService.isTerminalStatus(task.status)
    ) {
      this.scheduleStatusSync(task.id);
    }

    return this.workspaceService.serializeTask(task);
  }

  async getTask(userId: string, workspaceId: string, taskId: string) {
    await this.workspaceService.ensureWorkspaceOwnership(workspaceId, userId);

    let task = await this.prisma.workspaceTask.findUnique({
      where: { id: taskId },
    });

    if (!task || task.workspaceId !== workspaceId) {
      throw new NotFoundException(`Workspace Task ${taskId} 不存在`);
    }

    if (
      task.externalTaskId &&
      !this.workspaceService.isTerminalStatus(task.status)
    ) {
      await this.syncTaskStatusFromAi(task);
      const updated = await this.prisma.workspaceTask.findUnique({
        where: { id: taskId },
      });
      if (updated) {
        task = updated;
      }
    }

    return this.workspaceService.serializeTask(task, { includeResult: true });
  }

  private async prepareResourcesForTask(
    workspaceId: string,
    resourceIds?: string[],
  ) {
    const workspaceResources = await this.prisma.workspaceResource.findMany({
      where: { workspaceId },
      include: workspaceResourceInclude,
    });

    if (workspaceResources.length < 2) {
      throw new BadRequestException("工作区至少需要 2 个资源");
    }

    if (!resourceIds || resourceIds.length === 0) {
      return {
        selectedResources: workspaceResources,
        selectedResourceIds: workspaceResources.map((item) => item.resourceId),
      };
    }

    const uniqueIds = Array.from(new Set(resourceIds));
    const resourceMap = new Map(
      workspaceResources.map((item) => [item.resourceId, item]),
    );

    const missing = uniqueIds.filter((id) => !resourceMap.has(id));
    if (missing.length > 0) {
      throw new BadRequestException("存在不属于当前工作区的资源");
    }

    const selectedResources = uniqueIds.map((id) => resourceMap.get(id)!);
    if (selectedResources.length < 2) {
      throw new BadRequestException("请至少选择 2 个资源");
    }

    return {
      selectedResources,
      selectedResourceIds: selectedResources.map((item) => item.resourceId),
    };
  }

  private async enqueueAiTask(
    task: Prisma.WorkspaceTaskGetPayload<{ include?: undefined }>,
    dto: CreateWorkspaceTaskDto,
    resources: WorkspaceResourceWithData[],
    resourceIds: string[],
  ) {
    const payloadResources = resources.map((item) => ({
      id: item.resourceId,
      metadata: item.metadata ?? {},
      resource: item.resource,
    }));

    try {
      const aiTask = await this.workspaceAiClient.createTask({
        workspaceId: task.workspaceId,
        templateId: dto.templateId,
        model: dto.model,
        resources: payloadResources,
        question: dto.question,
        overrides: dto.overrides,
        resourceIds,
      });

      return await this.prisma.workspaceTask.update({
        where: { id: task.id },
        data: {
          externalTaskId: aiTask.id,
          queuePosition: aiTask.queuePosition,
          estimatedTime: aiTask.estimatedTime,
          status: this.mapAiStatus(aiTask.status),
          metadata: aiTask.metadata ?? {},
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to enqueue AI workspace task (workspaceId=${task.workspaceId}, templateId=${dto.templateId})`,
        error instanceof Error ? error.stack : undefined,
      );
      return this.handleEnqueueFailure(
        task,
        error,
        resources,
        resourceIds,
        dto,
      );
    }
  }

  private scheduleStatusSync(taskId: string, delay = 2000) {
    const existing = this.taskSyncTimers.get(taskId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.taskSyncTimers.delete(taskId);
      try {
        const task = await this.prisma.workspaceTask.findUnique({
          where: { id: taskId },
        });

        if (!task?.externalTaskId) {
          return;
        }

        if (this.workspaceService.isTerminalStatus(task.status)) {
          return;
        }

        await this.syncTaskStatusFromAi(task);

        const updated = await this.prisma.workspaceTask.findUnique({
          where: { id: taskId },
        });

        if (
          updated &&
          updated.externalTaskId &&
          !this.workspaceService.isTerminalStatus(updated.status)
        ) {
          const nextDelay = Math.min(delay * 2, 15000);
          this.scheduleStatusSync(taskId, nextDelay);
        }
      } catch (pollError) {
        this.logger.warn(
          `Auto sync task status failed (taskId=${taskId})`,
          pollError instanceof Error ? pollError.stack : undefined,
        );
        const nextDelay = Math.min(delay * 2, 15000);
        this.scheduleStatusSync(taskId, nextDelay);
      }
    }, delay);

    this.taskSyncTimers.set(taskId, timer);
  }

  private async handleEnqueueFailure(
    task: Prisma.WorkspaceTaskGetPayload<{ include?: undefined }>,
    error: unknown,
    resources: WorkspaceResourceWithData[],
    resourceIds: string[],
    dto: CreateWorkspaceTaskDto,
  ) {
    const reason =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";

    this.logger.warn(
      `Falling back to local workspace aggregation (taskId=${task.id}) due to AI service failure: ${reason}`,
    );

    const fallback = this.buildFallbackResult(
      resources,
      dto,
      resourceIds,
      reason,
    );

    return this.prisma.workspaceTask.update({
      where: { id: task.id },
      data: {
        status: TaskStatus.SUCCESS,
        result: fallback.result,
        metadata: fallback.metadata,
        finishedAt: new Date(),
      },
    });
  }

  private buildFallbackResult(
    resources: WorkspaceResourceWithData[],
    dto: CreateWorkspaceTaskDto,
    resourceIds: string[],
    reason: string,
  ) {
    const titles: string[] = [];
    const sections: Array<{ title: string; content: string }> = [];

    resources.forEach((item, index) => {
      const res = item.resource;
      const title = res.title ?? `资源 ${index + 1}`;
      const type = res.type ?? "unknown";
      const category = res.primaryCategory ?? "";
      const summary = res.aiSummary ?? res.abstract ?? "暂无摘要";

      titles.push(`${index + 1}. ${title}（${type}）`);
      sections.push({
        title,
        content: [
          `- 类型：${type}`,
          category ? `- 分类：${category}` : null,
          `- 摘要：${summary}`,
        ]
          .filter(Boolean)
          .join("\n"),
      });
    });

    const overview =
      titles.length > 0 ? titles.join("\n") : "暂无可用资源，请稍后重试。";

    const detailBlocks =
      sections.length > 0
        ? sections
            .map((section) => `### ${section.title}\n${section.content}`)
            .join("\n\n")
        : "暂无详细内容。";

    const question = dto.question ?? "未提供额外问题。";

    const result = {
      summary: `共分析 ${resources.length} 个资源。以下输出为后端兜底逻辑生成，可能缺少模型深度洞察。`,
      sections: [
        { title: "资源概览", content: overview },
        { title: "用户问题", content: question },
        { title: "详细内容", content: detailBlocks },
      ],
    };

    const metadata = {
      model: dto.model,
      generatedAt: new Date().toISOString(),
      resourceIds,
      templateId: dto.templateId,
      fallback: true,
      fallbackReason: reason,
    };

    return { result, metadata };
  }

  private async syncTaskStatusFromAi(
    task: Prisma.WorkspaceTaskGetPayload<{ include?: undefined }>,
  ) {
    if (!task.externalTaskId) {
      return;
    }

    try {
      const status = await this.workspaceAiClient.getTaskStatus(
        task.externalTaskId,
      );
      const mappedStatus = this.mapAiStatus(status.status);
      await this.prisma.workspaceTask.update({
        where: { id: task.id },
        data: {
          status: mappedStatus,
          queuePosition: status.queuePosition,
          estimatedTime: status.estimatedTime,
          result: status.result ?? task.result,
          error: status.error ?? task.error,
          metadata: status.metadata ?? task.metadata ?? {},
          finishedAt: this.isTerminal(mappedStatus)
            ? new Date()
            : task.finishedAt,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to fetch AI task status (externalTaskId=${task.externalTaskId})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private mapAiStatus(status: string): TaskStatus {
    switch (status) {
      case "success":
        return TaskStatus.SUCCESS;
      case "failed":
        return TaskStatus.FAILED;
      case "running":
        return TaskStatus.RUNNING;
      default:
        return TaskStatus.PENDING;
    }
  }

  private isTerminal(status: TaskStatus) {
    return status === TaskStatus.SUCCESS || status === TaskStatus.FAILED;
  }
}

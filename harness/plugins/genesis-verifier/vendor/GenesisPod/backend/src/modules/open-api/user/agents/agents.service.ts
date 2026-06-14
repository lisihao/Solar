/**
 * Agents Service
 * 任务管理和持久化服务
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import { filter, map } from "rxjs/operators";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  OfficeAgentType,
  OfficeTaskStatus,
  OfficeArtifactType,
  Prisma,
} from "@prisma/client";
import {
  AgentId,
  AgentInput,
  AgentPlan,
  AgentResult,
  AgentEvent,
  Artifact,
  AgentTaskStatus,
  ArtifactType,
} from "@/modules/ai-harness/agents/abstractions/agent.types";
import {
  SLIDES_AGENT_ID,
  DOCS_AGENT_ID,
  DESIGNER_AGENT_ID,
} from "@/modules/ai-app/contracts/agent-catalog";

/**
 * 创建任务输入
 */
interface CreateTaskInput {
  userId?: string;
  agentId?: AgentId;
  input: AgentInput;
}

/**
 * 任务事件（带 taskId）
 */
interface TaskEvent {
  taskId: string;
  event: AgentEvent;
}

/**
 * 类型映射：AgentId -> Prisma OfficeAgentType
 */
function toOfficeAgentType(agentId?: AgentId): OfficeAgentType {
  switch (agentId) {
    case SLIDES_AGENT_ID:
      return OfficeAgentType.SLIDES;
    case DOCS_AGENT_ID:
      return OfficeAgentType.DOCS;
    case DESIGNER_AGENT_ID:
      return OfficeAgentType.DESIGNER;
    default:
      return OfficeAgentType.DOCS; // 默认
  }
}

/**
 * 类型映射：前端 AgentTaskStatus -> Prisma OfficeTaskStatus
 */
function toOfficeTaskStatus(status: string): OfficeTaskStatus {
  switch (status) {
    case "PENDING":
      return OfficeTaskStatus.PENDING;
    case "PLANNING":
      return OfficeTaskStatus.PLANNING;
    case "EXECUTING":
      return OfficeTaskStatus.EXECUTING;
    case "COMPLETED":
      return OfficeTaskStatus.COMPLETED;
    case "FAILED":
      return OfficeTaskStatus.FAILED;
    case "CANCELLED":
      return OfficeTaskStatus.CANCELLED;
    default:
      return OfficeTaskStatus.PENDING;
  }
}

/**
 * 类型映射：ArtifactType -> Prisma OfficeArtifactType
 */
function toOfficeArtifactType(type: ArtifactType): OfficeArtifactType {
  switch (type) {
    case "pptx":
      return OfficeArtifactType.PPTX;
    case "docx":
      return OfficeArtifactType.DOCX;
    case "pdf":
      return OfficeArtifactType.PDF;
    case "image":
      return OfficeArtifactType.IMAGE;
    case "code":
      return OfficeArtifactType.CODE;
    case "data":
      return OfficeArtifactType.DATA;
    default:
      return OfficeArtifactType.DATA;
  }
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private readonly eventSubject = new Subject<TaskEvent>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建任务
   */
  async createTask(input: CreateTaskInput): Promise<{ id: string }> {
    const task = await this.prisma.officeAgentTask.create({
      data: {
        userId: input.userId,
        agentType: toOfficeAgentType(input.agentId),
        status: OfficeTaskStatus.PENDING,
        input: input.input as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(`Task created: ${task.id}`);
    return { id: task.id };
  }

  /**
   * 获取任务
   *
   * ★ IDOR 防护：按 (id, ownerUserId) 查询，非属主视作不存在。userId 由全局
   *   JwtAuthGuard 保证存在；调用方必须传真实 userId（不可传 undefined，否则
   *   Prisma 会丢弃该谓词导致越权）。
   */
  async getTask(taskId: string, userId: string) {
    const task = await this.prisma.officeAgentTask.findFirst({
      where: { id: taskId, userId },
      include: {
        artifacts: true,
      },
    });
    return task;
  }

  /**
   * 更新任务状态
   */
  async updateTaskStatus(
    taskId: string,
    status: string,
    error?: string,
  ): Promise<void> {
    const updateData: {
      status: OfficeTaskStatus;
      error?: string;
      startedAt?: Date;
      completedAt?: Date;
      duration?: number;
    } = {
      status: toOfficeTaskStatus(status),
      error,
    };

    if (status === "EXECUTING") {
      const task = await this.prisma.officeAgentTask.findUnique({
        where: { id: taskId },
      });
      if (task && !task.startedAt) {
        updateData.startedAt = new Date();
      }
    }

    if (status === "COMPLETED" || status === "FAILED") {
      updateData.completedAt = new Date();
      const task = await this.prisma.officeAgentTask.findUnique({
        where: { id: taskId },
      });
      if (task?.startedAt) {
        updateData.duration = Date.now() - task.startedAt.getTime();
      }
    }

    await this.prisma.officeAgentTask.update({
      where: { id: taskId },
      data: updateData,
    });
  }

  /**
   * 更新任务计划
   */
  async updateTaskPlan(taskId: string, plan: AgentPlan): Promise<void> {
    await this.prisma.officeAgentTask.update({
      where: { id: taskId },
      data: {
        plan: plan as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 更新任务结果
   */
  async updateTaskResult(taskId: string, result: AgentResult): Promise<void> {
    await this.prisma.officeAgentTask.update({
      where: { id: taskId },
      data: {
        result: result as unknown as Prisma.InputJsonValue,
        tokensUsed: result.tokensUsed,
      },
    });
  }

  /**
   * 保存产出物
   */
  async saveArtifact(taskId: string, artifact: Artifact): Promise<void> {
    await this.prisma.officeAgentArtifact.create({
      data: {
        taskId,
        type: toOfficeArtifactType(artifact.type),
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: artifact.size,
        url: artifact.url,
        content: artifact.content as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 获取任务产出物
   *
   * ★ IDOR 防护：先校验 task 归属，非属主任务的产出物视作不存在。
   */
  async getArtifacts(taskId: string, userId: string): Promise<Artifact[]> {
    const owns = await this.prisma.officeAgentTask.findFirst({
      where: { id: taskId, userId },
      select: { id: true },
    });
    if (!owns) {
      throw new NotFoundException("Task not found");
    }
    const artifacts = await this.prisma.officeAgentArtifact.findMany({
      where: { taskId },
    });
    return artifacts.map((a) => ({
      id: a.id,
      type: a.type.toLowerCase() as ArtifactType,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      url: a.url || undefined,
      content: a.content as Prisma.JsonValue,
    }));
  }

  /**
   * 获取产出物下载
   */
  async getArtifactDownload(
    artifactId: string,
    userId: string,
  ): Promise<{
    url: string | null;
    name: string;
    mimeType: string;
  }> {
    // ★ IDOR 防护：经父 task 的 userId 校验归属，非属主视作不存在。
    const artifact = await this.prisma.officeAgentArtifact.findUnique({
      where: { id: artifactId },
      include: { task: { select: { userId: true } } },
    });
    if (!artifact || artifact.task?.userId !== userId) {
      throw new NotFoundException("Artifact not found");
    }
    return {
      url: artifact.url,
      name: artifact.name,
      mimeType: artifact.mimeType,
    };
  }

  /**
   * 取消任务
   *
   * ★ IDOR 防护：按 (id, ownerUserId) 查询，非属主任务不可取消。
   */
  async cancelTask(taskId: string, userId: string): Promise<boolean> {
    const task = await this.prisma.officeAgentTask.findFirst({
      where: { id: taskId, userId },
    });
    if (task && task.status === OfficeTaskStatus.EXECUTING) {
      await this.prisma.officeAgentTask.update({
        where: { id: taskId },
        data: { status: OfficeTaskStatus.CANCELLED },
      });
      this.publishEvent(taskId, { type: "error", error: "Task cancelled" });
      return true;
    }
    return false;
  }

  /**
   * 发布事件
   */
  publishEvent(taskId: string, event: AgentEvent): void {
    this.eventSubject.next({ taskId, event });
  }

  /**
   * 获取任务事件流
   */
  getTaskStream(taskId: string): Observable<AgentEvent> {
    return this.eventSubject.pipe(
      filter((te) => te.taskId === taskId),
      filter((te) => !!te.event),
      map((te) => te.event),
    );
  }

  /**
   * 获取用户的任务列表
   */
  async getUserTasks(
    userId: string,
    options?: {
      agentId?: AgentId;
      status?: AgentTaskStatus;
      limit?: number;
      offset?: number;
    },
  ) {
    return this.prisma.officeAgentTask.findMany({
      where: {
        userId,
        ...(options?.agentId && {
          agentType: toOfficeAgentType(options.agentId),
        }),
        ...(options?.status && {
          status: toOfficeTaskStatus(options.status),
        }),
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit || 20,
      skip: options?.offset || 0,
      include: {
        artifacts: true,
      },
    });
  }

  /**
   * 查询在途任务（boot recovery 用）
   *
   * 进程崩溃/重启会遗留 status ∈ {PLANNING, EXECUTING} 的任务——内存执行已断，
   * DB 状态卡在中间态。boot 时扫出这些任务重投 BullMQ（jobId=taskId 幂等）。
   * 排除 PENDING：PENDING 的 job 仍在队列里等 worker，BullMQ 自身持久化已覆盖。
   */
  async findInFlightTasks(): Promise<
    Array<{ id: string; agentType: OfficeAgentType; userId: string | null }>
  > {
    const tasks = await this.prisma.officeAgentTask.findMany({
      where: {
        status: { in: [OfficeTaskStatus.PLANNING, OfficeTaskStatus.EXECUTING] },
      },
      select: { id: true, agentType: true, userId: true, input: true },
    });
    return tasks.map((t) => ({
      id: t.id,
      agentType: t.agentType,
      userId: t.userId,
    }));
  }

  /**
   * 读取任务的原始 input（boot recovery 重投时重建 AgentInput）
   */
  async getTaskInput(taskId: string): Promise<AgentInput | null> {
    const task = await this.prisma.officeAgentTask.findUnique({
      where: { id: taskId },
      select: { input: true },
    });
    if (!task) return null;
    return task.input as unknown as AgentInput;
  }

  /**
   * 把 Prisma OfficeAgentType 反映射回 AgentId（boot recovery 重投用）
   */
  officeAgentTypeToAgentId(type: OfficeAgentType): AgentId {
    switch (type) {
      case OfficeAgentType.SLIDES:
        return SLIDES_AGENT_ID;
      case OfficeAgentType.DOCS:
        return DOCS_AGENT_ID;
      case OfficeAgentType.DESIGNER:
        return DESIGNER_AGENT_ID;
      default:
        return DOCS_AGENT_ID;
    }
  }

  /**
   * 清理过期任务
   */
  async cleanupExpiredTasks(
    maxAge: number = 24 * 60 * 60 * 1000,
  ): Promise<number> {
    const expiredDate = new Date(Date.now() - maxAge);

    const result = await this.prisma.officeAgentTask.deleteMany({
      where: {
        createdAt: { lt: expiredDate },
        status: { in: [OfficeTaskStatus.COMPLETED, OfficeTaskStatus.FAILED] },
      },
    });

    this.logger.log(`Cleaned up ${result.count} expired tasks`);
    return result.count;
  }
}

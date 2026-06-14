/**
 * Slides Repository - 数据持久化层
 *
 * 负责 SlidesMission、SlidesTask、SlidesMissionEvent 的数据库操作
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  USER_EVENT_NAME,
  MODULE,
  ACTION,
  type UserEventPayload,
} from "@/common/observability/user-event.types";
import { Prisma } from "@prisma/client";
import {
  SlidesMission,
  SlidesTask,
  SlidesMissionEvent,
  SlidesMissionEventType,
  SlidesTeamMemberRole,
  SlidesTaskStatus,
  SlidesMissionStatus,
  SlidesMissionPhase,
  SlidesTaskPriority,
  TaskBreakdown,
  QualityAuditResult,
  SlidesTeamOrchestratorInput,
} from "./types";
import { GeneratedSlide, PPTOutline } from "../types/slides.types";
import { v4 as uuidv4 } from "uuid";

// Prisma 枚举映射
const STATUS_MAP: Record<SlidesMissionStatus, string> = {
  pending: "PENDING",
  planning: "PLANNING",
  in_progress: "EXECUTING",
  reviewing: "REVIEWING",
  auditing: "AUDITING",
  synthesizing: "SYNTHESIZING",
  completed: "COMPLETED",
  failed: "FAILED",
};

const PHASE_MAP: Record<SlidesMissionPhase, string> = {
  planning: "PLANNING",
  executing: "EXECUTING",
  reviewing: "REVIEWING",
  auditing: "AUDITING",
  synthesizing: "SYNTHESIZING",
  completed: "COMPLETED",
  failed: "FAILED",
};

const TASK_STATUS_MAP: Record<SlidesTaskStatus, string> = {
  pending: "PENDING",
  in_progress: "IN_PROGRESS",
  awaiting_review: "AWAITING_REVIEW",
  revision_needed: "REVISION_NEEDED",
  completed: "COMPLETED",
  failed: "FAILED",
  cancelled: "CANCELLED",
};

const PRIORITY_MAP: Record<SlidesTaskPriority, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MEDIUM",
  low: "LOW",
};

const ROLE_MAP: Record<SlidesTeamMemberRole, string> = {
  leader: "LEADER",
  analyst: "ANALYST",
  strategist: "STRATEGIST",
  writer: "WRITER",
  reviewer: "REVIEWER",
};

const EVENT_TYPE_MAP: Record<SlidesMissionEventType, string> = {
  "mission:created": "MISSION_CREATED",
  "mission:started": "MISSION_STARTED",
  "mission:phase_changed": "MISSION_PHASE_CHANGED",
  "mission:status_changed": "MISSION_STATUS_CHANGED",
  "mission:completed": "MISSION_COMPLETED",
  "mission:failed": "MISSION_FAILED",
  "planning:started": "PLANNING_STARTED",
  "planning:completed": "PLANNING_COMPLETED",
  "task:created": "TASK_CREATED",
  "task:started": "TASK_STARTED",
  "task:completed": "TASK_COMPLETED",
  "task:awaiting_review": "TASK_AWAITING_REVIEW",
  "task:revision_needed": "TASK_REVISION_NEEDED",
  "task:failed": "TASK_FAILED",
  "review:started": "REVIEW_STARTED",
  "review:approved": "REVIEW_APPROVED",
  "review:revision_requested": "REVIEW_REVISION_REQUESTED",
  "audit:started": "AUDIT_STARTED",
  "audit:completed": "AUDIT_COMPLETED",
  "synthesis:started": "SYNTHESIS_STARTED",
  "synthesis:completed": "SYNTHESIS_COMPLETED",
  "page:generated": "PAGE_GENERATED",
  progress: "PROGRESS",
  // AI 思考事件（V5.0）
  "thinking:step": "THINKING_STEP",
  "thinking:decision": "THINKING_DECISION",
  "thinking:insight": "THINKING_INSIGHT",
  "thinking:warning": "THINKING_WARNING",
  "thinking:output": "THINKING_OUTPUT",
  "thinking:summary": "THINKING_SUMMARY",
};

// 反向映射
const REVERSE_STATUS_MAP = Object.fromEntries(
  Object.entries(STATUS_MAP).map(([k, v]) => [v, k]),
) as Record<string, SlidesMissionStatus>;

const REVERSE_PHASE_MAP = Object.fromEntries(
  Object.entries(PHASE_MAP).map(([k, v]) => [v, k]),
) as Record<string, SlidesMissionPhase>;

const REVERSE_TASK_STATUS_MAP = Object.fromEntries(
  Object.entries(TASK_STATUS_MAP).map(([k, v]) => [v, k]),
) as Record<string, SlidesTaskStatus>;

const REVERSE_PRIORITY_MAP = Object.fromEntries(
  Object.entries(PRIORITY_MAP).map(([k, v]) => [v, k]),
) as Record<string, SlidesTaskPriority>;

const REVERSE_ROLE_MAP = Object.fromEntries(
  Object.entries(ROLE_MAP).map(([k, v]) => [v, k]),
) as Record<string, SlidesTeamMemberRole>;

const REVERSE_EVENT_TYPE_MAP = Object.fromEntries(
  Object.entries(EVENT_TYPE_MAP).map(([k, v]) => [v, k]),
) as Record<string, SlidesMissionEventType>;

@Injectable()
export class SlidesRepository {
  private readonly logger = new Logger(SlidesRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  // ============================================
  // Mission 操作
  // ============================================

  /**
   * 创建新的 Mission
   */
  async createMission(
    input: SlidesTeamOrchestratorInput,
  ): Promise<SlidesMission> {
    const missionId = uuidv4();

    const dbMission = await this.prisma.slidesMission.create({
      data: {
        id: missionId,
        userId: input.userId,
        sessionId: input.sessionId,
        sourceText: input.sourceText,
        userRequirement: input.userRequirement,
        targetPages: input.targetPages,
        stylePreference: input.stylePreference || "dark",
        themeId: input.themeId,
        targetAudience: input.targetAudience,
        status: "PENDING",
        currentPhase: "PLANNING",
        pages: [],
        errors: [],
        metadata: {},
        sourceSubscription: input.sourceSubscription
          ? (input.sourceSubscription as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    this.logger.log(`[createMission] Created mission ${missionId}`);

    return this.dbMissionToMission(dbMission);
  }

  /**
   * 获取 Mission
   */
  async getMission(missionId: string): Promise<SlidesMission | null> {
    const dbMission = await this.prisma.slidesMission.findUnique({
      where: { id: missionId },
      include: {
        tasks: true,
      },
    });

    if (!dbMission) {
      return null;
    }

    return this.dbMissionToMission(dbMission);
  }

  /**
   * 更新 Mission 状态
   */
  async updateMissionStatus(
    missionId: string,
    status: SlidesMissionStatus,
    phase?: SlidesMissionPhase,
  ): Promise<void> {
    const data: Prisma.SlidesMissionUpdateInput = {
      status: STATUS_MAP[
        status
      ] as Prisma.EnumSlidesMissionStatusFieldUpdateOperationsInput["set"],
    };

    if (phase) {
      data.currentPhase = PHASE_MAP[
        phase
      ] as Prisma.EnumSlidesMissionPhaseFieldUpdateOperationsInput["set"];
    }

    if (status === "in_progress" || status === "planning") {
      data.startedAt = new Date();
    }

    if (status === "completed" || status === "failed") {
      data.completedAt = new Date();
    }

    await this.prisma.slidesMission.update({
      where: { id: missionId },
      data,
    });
  }

  /**
   * 更新 Mission 任务分解
   */
  async updateMissionTaskBreakdown(
    missionId: string,
    breakdown: TaskBreakdown,
    totalTasks: number,
  ): Promise<void> {
    await this.prisma.slidesMission.update({
      where: { id: missionId },
      data: {
        taskBreakdown: breakdown as unknown as Prisma.InputJsonValue,
        totalTasks,
      },
    });
  }

  /**
   * 更新 Mission 大纲
   */
  async updateMissionOutline(
    missionId: string,
    outline: PPTOutline,
  ): Promise<void> {
    await this.prisma.slidesMission.update({
      where: { id: missionId },
      data: {
        outline: outline as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 更新 Mission 页面
   */
  async updateMissionPages(
    missionId: string,
    pages: GeneratedSlide[],
  ): Promise<void> {
    await this.prisma.slidesMission.update({
      where: { id: missionId },
      data: {
        pages: pages as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 更新 Mission 质量审计结果
   */
  async updateMissionQualityAudit(
    missionId: string,
    audit: QualityAuditResult,
  ): Promise<void> {
    await this.prisma.slidesMission.update({
      where: { id: missionId },
      data: {
        qualityAudit: audit as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 更新 Mission 进度
   */
  async updateMissionProgress(
    missionId: string,
    completedTasks: number,
  ): Promise<void> {
    await this.prisma.slidesMission.update({
      where: { id: missionId },
      data: { completedTasks },
    });
  }

  /**
   * 更新 Mission 错误信息
   */
  async updateMissionError(
    missionId: string,
    errorMessage: string,
    errors?: unknown[],
  ): Promise<void> {
    await this.prisma.slidesMission.update({
      where: { id: missionId },
      data: {
        errorMessage,
        errors: errors as Prisma.InputJsonValue,
        status: "FAILED",
        completedAt: new Date(),
      },
    });
  }

  /**
   * 完成 Mission
   */
  async completeMission(
    missionId: string,
    pages: GeneratedSlide[],
    duration: number,
    qualityAudit?: QualityAuditResult,
  ): Promise<void> {
    const updated = await this.prisma.slidesMission.update({
      where: { id: missionId },
      data: {
        status: "COMPLETED",
        currentPhase: "COMPLETED",
        pages: pages as unknown as Prisma.InputJsonValue,
        qualityAudit: qualityAudit as unknown as Prisma.InputJsonValue,
        duration,
        completedAt: new Date(),
      },
      select: {
        userId: true,
        userRequirement: true,
        sourceText: true,
      },
    });

    // 触发持久化通知（fire-and-forget；NotificationEventListener 监听）
    if (this.eventEmitter && updated?.userId) {
      const title =
        (updated.userRequirement?.trim() ||
          updated.sourceText?.trim().slice(0, 80)) ??
        missionId;
      this.eventEmitter.emit("notification.task-completed", {
        kind: "office-slides",
        userId: updated.userId,
        refId: missionId,
        title,
        metrics: { pageCount: pages.length },
      });

      // 运营看板埋点（W2, PRD §4.2）：office 产出完成。成本不在此（唯一真源 AIEngineMetric）。
      this.eventEmitter.emit(USER_EVENT_NAME, {
        userId: updated.userId,
        module: MODULE.AI_OFFICE,
        action: ACTION.COMPLETED,
        resourceType: "SlidesMission",
        resourceId: missionId,
      } satisfies UserEventPayload);
    }
  }

  // ============================================
  // Task 操作
  // ============================================

  /**
   * 批量创建 Task
   */
  async createTasks(missionId: string, tasks: SlidesTask[]): Promise<void> {
    await this.prisma.slidesTask.createMany({
      data: tasks.map((task) => ({
        id: task.id,
        missionId,
        title: task.title,
        description: task.description,
        priority: PRIORITY_MAP[task.priority] as
          | "CRITICAL"
          | "HIGH"
          | "MEDIUM"
          | "LOW",
        assignee: ROLE_MAP[task.assignee] as
          | "LEADER"
          | "ANALYST"
          | "STRATEGIST"
          | "WRITER"
          | "REVIEWER"
          | "DESIGNER",
        skillId: task.skillId,
        input: task.input as Prisma.InputJsonValue,
        dependencies: task.dependencies,
        status: TASK_STATUS_MAP[task.status] as
          | "PENDING"
          | "IN_PROGRESS"
          | "AWAITING_REVIEW"
          | "REVISION_NEEDED"
          | "COMPLETED"
          | "FAILED"
          | "CANCELLED",
        revisionCount: task.revisionCount,
        maxRevisions: task.maxRevisions,
      })),
    });
  }

  /**
   * 更新 Task 状态
   */
  async updateTaskStatus(
    taskId: string,
    status: SlidesTaskStatus,
  ): Promise<void> {
    const data: Prisma.SlidesTaskUpdateInput = {
      status: TASK_STATUS_MAP[
        status
      ] as Prisma.EnumSlidesTaskStatusFieldUpdateOperationsInput["set"],
    };

    if (status === "in_progress") {
      data.startedAt = new Date();
    }

    if (status === "completed" || status === "failed") {
      data.completedAt = new Date();
    }

    await this.prisma.slidesTask.update({
      where: { id: taskId },
      data,
    });
  }

  /**
   * 更新 Task 结果
   */
  async updateTaskResult(taskId: string, result: unknown): Promise<void> {
    await this.prisma.slidesTask.update({
      where: { id: taskId },
      data: {
        result: result as Prisma.InputJsonValue,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  }

  /**
   * 更新 Task 审核反馈
   */
  async updateTaskReview(
    taskId: string,
    feedback: string,
    score?: number,
    needsRevision?: boolean,
  ): Promise<void> {
    const data: Prisma.SlidesTaskUpdateInput = {
      reviewFeedback: feedback,
      reviewScore: score,
    };

    if (needsRevision) {
      data.status = "REVISION_NEEDED";
      data.revisionCount = { increment: 1 };
    } else {
      data.status = "COMPLETED";
      data.completedAt = new Date();
    }

    await this.prisma.slidesTask.update({
      where: { id: taskId },
      data,
    });
  }

  // ============================================
  // Event 操作
  // ============================================

  /**
   * 记录事件
   */
  async recordEvent(event: SlidesMissionEvent): Promise<void> {
    const eventType = EVENT_TYPE_MAP[event.type];
    if (!eventType) {
      this.logger.warn(`[recordEvent] Unknown event type: ${event.type}`);
      return;
    }

    await this.prisma.slidesMissionEvent.create({
      data: {
        missionId: event.missionId,
        type: eventType as
          | "MISSION_CREATED"
          | "MISSION_STARTED"
          | "MISSION_PHASE_CHANGED"
          | "MISSION_STATUS_CHANGED"
          | "MISSION_COMPLETED"
          | "MISSION_FAILED"
          | "PLANNING_STARTED"
          | "PLANNING_COMPLETED"
          | "TASK_CREATED"
          | "TASK_STARTED"
          | "TASK_COMPLETED"
          | "TASK_AWAITING_REVIEW"
          | "TASK_REVISION_NEEDED"
          | "TASK_FAILED"
          | "REVIEW_STARTED"
          | "REVIEW_APPROVED"
          | "REVIEW_REVISION_REQUESTED"
          | "AUDIT_STARTED"
          | "AUDIT_COMPLETED"
          | "SYNTHESIS_STARTED"
          | "SYNTHESIS_COMPLETED"
          | "PAGE_GENERATED"
          | "PROGRESS",
        data: event.data as Prisma.InputJsonValue,
        taskId: event.data.taskId as string | undefined,
        memberId: event.data.memberId as string | undefined,
        timestamp: event.timestamp,
      },
    });
  }

  /**
   * 批量记录事件
   */
  async recordEvents(events: SlidesMissionEvent[]): Promise<void> {
    await this.prisma.slidesMissionEvent.createMany({
      data: events.map((event) => ({
        missionId: event.missionId,
        type: EVENT_TYPE_MAP[event.type] as
          | "MISSION_CREATED"
          | "MISSION_STARTED"
          | "MISSION_PHASE_CHANGED"
          | "MISSION_STATUS_CHANGED"
          | "MISSION_COMPLETED"
          | "MISSION_FAILED"
          | "PLANNING_STARTED"
          | "PLANNING_COMPLETED"
          | "TASK_CREATED"
          | "TASK_STARTED"
          | "TASK_COMPLETED"
          | "TASK_AWAITING_REVIEW"
          | "TASK_REVISION_NEEDED"
          | "TASK_FAILED"
          | "REVIEW_STARTED"
          | "REVIEW_APPROVED"
          | "REVIEW_REVISION_REQUESTED"
          | "AUDIT_STARTED"
          | "AUDIT_COMPLETED"
          | "SYNTHESIS_STARTED"
          | "SYNTHESIS_COMPLETED"
          | "PAGE_GENERATED"
          | "PROGRESS",
        data: event.data as Prisma.InputJsonValue,
        taskId: event.data.taskId as string | undefined,
        memberId: event.data.memberId as string | undefined,
        timestamp: event.timestamp,
      })),
    });
  }

  /**
   * 获取 Mission 事件
   */
  async getMissionEvents(
    missionId: string,
    limit?: number,
  ): Promise<SlidesMissionEvent[]> {
    const dbEvents = await this.prisma.slidesMissionEvent.findMany({
      where: { missionId },
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return dbEvents.map((e) => ({
      type:
        REVERSE_EVENT_TYPE_MAP[e.type] ||
        ("progress" as SlidesMissionEventType),
      missionId: e.missionId,
      timestamp: e.timestamp,
      data: e.data as Record<string, unknown>,
    }));
  }

  // ============================================
  // 查询方法
  // ============================================

  /**
   * 获取用户的 Mission 列表
   */
  async getUserMissions(
    userId: string,
    options?: {
      status?: SlidesMissionStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<SlidesMission[]> {
    const where: Prisma.SlidesMissionWhereInput = { userId };

    if (options?.status) {
      where.status = STATUS_MAP[
        options.status
      ] as Prisma.EnumSlidesMissionStatusFilter["equals"];
    }

    const dbMissions = await this.prisma.slidesMission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit || 20,
      skip: options?.offset || 0,
      include: { tasks: true },
    });

    return dbMissions.map((m) => this.dbMissionToMission(m));
  }

  /**
   * 获取 Session 的 Mission
   */
  async getSessionMission(sessionId: string): Promise<SlidesMission | null> {
    const dbMission = await this.prisma.slidesMission.findFirst({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      include: { tasks: true },
    });

    if (!dbMission) {
      return null;
    }

    return this.dbMissionToMission(dbMission);
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 将数据库 Mission 转换为内存 Mission
   */
  private dbMissionToMission(dbMission: {
    id: string;
    userId: string;
    sessionId: string;
    sourceText: string;
    userRequirement: string | null;
    targetPages: number | null;
    stylePreference: string | null;
    themeId: string | null;
    status: string;
    currentPhase: string;
    taskBreakdown: unknown;
    outline: unknown;
    pages: unknown;
    qualityAudit: unknown;
    totalTasks: number;
    completedTasks: number;
    metadata: unknown;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    tasks?: unknown[];
  }): SlidesMission {
    const mission: SlidesMission = {
      id: dbMission.id,
      userId: dbMission.userId,
      sessionId: dbMission.sessionId,
      sourceText: dbMission.sourceText,
      userRequirement: dbMission.userRequirement || undefined,
      targetPages: dbMission.targetPages || undefined,
      stylePreference:
        (dbMission.stylePreference as "dark" | "light") || undefined,
      themeId: dbMission.themeId || undefined,
      status: REVERSE_STATUS_MAP[dbMission.status] || "pending",
      currentPhase: REVERSE_PHASE_MAP[dbMission.currentPhase] || "planning",
      taskBreakdown: dbMission.taskBreakdown as TaskBreakdown | undefined,
      outline: dbMission.outline as PPTOutline | undefined,
      pages: (dbMission.pages as GeneratedSlide[]) || [],
      qualityAudit: dbMission.qualityAudit as QualityAuditResult | undefined,
      tasks: dbMission.tasks
        ? this.dbTasksToTasks(dbMission.tasks as DbTask[])
        : [],
      totalTasks: dbMission.totalTasks,
      completedTasks: dbMission.completedTasks,
      metadata: (dbMission.metadata as Record<string, unknown>) || {},
      createdAt: dbMission.createdAt,
      startedAt: dbMission.startedAt || undefined,
      completedAt: dbMission.completedAt || undefined,
    };

    return mission;
  }

  // 定义数据库任务类型
  private dbTasksToTasks(dbTasks: DbTask[]): SlidesTask[] {
    return dbTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      priority: REVERSE_PRIORITY_MAP[t.priority] || "medium",
      assignee: REVERSE_ROLE_MAP[t.assignee] || "designer",
      skillId: t.skillId,
      input: t.input,
      dependencies: t.dependencies,
      status: REVERSE_TASK_STATUS_MAP[t.status] || "pending",
      result: t.result || undefined,
      reviewFeedback: t.reviewFeedback || undefined,
      revisionCount: t.revisionCount,
      maxRevisions: t.maxRevisions,
      createdAt: t.createdAt,
      startedAt: t.startedAt || undefined,
      completedAt: t.completedAt || undefined,
    }));
  }
}

// 内部类型定义
interface DbTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  assignee: string;
  skillId: string;
  input: unknown;
  dependencies: string[];
  status: string;
  result: unknown;
  reviewFeedback: string | null;
  revisionCount: number;
  maxRevisions: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

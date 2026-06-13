/**
 * Slides Engine v3.0 - Checkpoint Service
 *
 * 检查点管理服务，支持版本管理和回滚
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  SlidesSessionStatus,
  SlidesCheckpointType,
  Prisma,
} from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import {
  Checkpoint,
  CheckpointType,
  CheckpointState,
  CheckpointMetadata,
  SlidesSession,
} from "./checkpoint.types";

/**
 * CheckpointType 到 Prisma 枚举的映射
 */
const CHECKPOINT_TYPE_TO_PRISMA: Record<CheckpointType, SlidesCheckpointType> =
  {
    task_decomposition: SlidesCheckpointType.TASK_DECOMPOSITION,
    outline_confirmed: SlidesCheckpointType.OUTLINE_CONFIRMED,
    page_rendered: SlidesCheckpointType.PAGE_RENDERED,
    batch_rendered: SlidesCheckpointType.BATCH_RENDERED,
    user_modified: SlidesCheckpointType.USER_MODIFIED,
    auto_save: SlidesCheckpointType.AUTO_SAVE,
  };

/**
 * Prisma 枚举到 CheckpointType 的映射
 */
function prismaToCheckpointType(
  prismaType: SlidesCheckpointType,
): CheckpointType {
  const map: Record<SlidesCheckpointType, CheckpointType> = {
    [SlidesCheckpointType.TASK_DECOMPOSITION]: "task_decomposition",
    [SlidesCheckpointType.OUTLINE_CONFIRMED]: "outline_confirmed",
    [SlidesCheckpointType.PAGE_RENDERED]: "page_rendered",
    [SlidesCheckpointType.BATCH_RENDERED]: "batch_rendered",
    [SlidesCheckpointType.USER_MODIFIED]: "user_modified",
    [SlidesCheckpointType.AUTO_SAVE]: "auto_save",
  };
  return map[prismaType];
}

/**
 * Session 状态映射
 */
const SESSION_STATUS_TO_PRISMA: Record<
  "active" | "completed" | "archived",
  SlidesSessionStatus
> = {
  active: SlidesSessionStatus.ACTIVE,
  completed: SlidesSessionStatus.COMPLETED,
  archived: SlidesSessionStatus.ARCHIVED,
};

const PRISMA_TO_SESSION_STATUS: Record<
  SlidesSessionStatus,
  "active" | "completed" | "archived"
> = {
  [SlidesSessionStatus.ACTIVE]: "active",
  [SlidesSessionStatus.COMPLETED]: "completed",
  [SlidesSessionStatus.ARCHIVED]: "archived",
};

/**
 * 创建检查点的输入
 */
export interface CreateCheckpointInput {
  sessionId: string;
  name?: string;
  type: CheckpointType;
  state: CheckpointState;
  metadata?: Partial<CheckpointMetadata>;
}

/**
 * 检查点过滤条件
 */
export interface CheckpointFilter {
  sessionId?: string;
  type?: CheckpointType;
  fromDate?: Date;
  toDate?: Date;
}

/**
 * 检查点差异
 */
export interface CheckpointDiff {
  from: Checkpoint;
  to: Checkpoint;
  changes: {
    field: string;
    before: unknown;
    after: unknown;
  }[];
  pagesAdded: number[];
  pagesModified: number[];
  pagesRemoved: number[];
}

/**
 * 自动保存配置
 */
export interface AutoSaveConfig {
  phaseComplete: boolean;
  pageInterval: number;
  userConfirm: boolean;
  timeIntervalMs: number;
  maxCheckpoints: number;
}

const DEFAULT_AUTO_SAVE_CONFIG: AutoSaveConfig = {
  phaseComplete: true,
  pageInterval: 5,
  userConfirm: true,
  timeIntervalMs: 5 * 60 * 1000, // 5 minutes
  maxCheckpoints: 50,
};

@Injectable()
export class SlidesCheckpointService {
  private readonly logger = new Logger(SlidesCheckpointService.name);
  private autoSaveConfig: AutoSaveConfig = DEFAULT_AUTO_SAVE_CONFIG;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 创建新会话
   */
  async createSession(userId: string, title: string): Promise<SlidesSession> {
    this.logger.log(`[createSession] Creating session for user: ${userId}`);

    const session = await this.prisma.slidesSession.create({
      data: {
        id: uuidv4(),
        userId,
        title,
        status: SlidesSessionStatus.ACTIVE,
      },
    });

    return {
      id: session.id,
      userId: session.userId,
      title: session.title,
      status: PRISMA_TO_SESSION_STATUS[session.status],
      currentCheckpointId: session.currentStateId || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * 获取会话
   */
  async getSession(sessionId: string): Promise<SlidesSession | null> {
    const session = await this.prisma.slidesSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return null;

    return {
      id: session.id,
      userId: session.userId,
      title: session.title,
      status: PRISMA_TO_SESSION_STATUS[session.status],
      currentCheckpointId: session.currentStateId || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * 获取用户的会话列表
   */
  async getSessions(filter: {
    userId?: string;
    status?: "active" | "completed" | "archived";
    limit?: number;
  }): Promise<SlidesSession[]> {
    const where: Record<string, unknown> = {};

    if (filter.userId) {
      where.userId = filter.userId;
    }
    if (filter.status) {
      where.status = SESSION_STATUS_TO_PRISMA[filter.status];
    }

    const sessions = await this.prisma.slidesSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: filter.limit || 50,
    });

    return sessions.map((session) => ({
      id: session.id,
      userId: session.userId,
      title: session.title,
      status: PRISMA_TO_SESSION_STATUS[session.status],
      currentCheckpointId: session.currentStateId || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  }

  /**
   * 更新会话状态
   */
  async updateSessionStatus(
    sessionId: string,
    status: "active" | "completed" | "archived",
  ): Promise<void> {
    await this.prisma.slidesSession.update({
      where: { id: sessionId },
      data: { status: SESSION_STATUS_TO_PRISMA[status] },
    });
  }

  /**
   * 更新会话标题
   */
  async updateSessionTitle(
    sessionId: string,
    title: string,
  ): Promise<SlidesSession> {
    this.logger.log(
      `[updateSessionTitle] Session: ${sessionId}, Title: ${title}`,
    );

    const session = await this.prisma.slidesSession.update({
      where: { id: sessionId },
      data: { title },
    });

    return {
      id: session.id,
      userId: session.userId,
      title: session.title,
      status: PRISMA_TO_SESSION_STATUS[session.status],
      currentCheckpointId: session.currentStateId || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * 删除会话及其所有关联数据
   * 包括：checkpoints, missions, tasks, mission_events
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.logger.log(`[deleteSession] Deleting session: ${sessionId}`);

    // 1. 获取所有关联的 missions
    const missions = await this.prisma.slidesMission.findMany({
      where: { sessionId },
      select: { id: true },
    });
    const missionIds = missions.map((m) => m.id);

    if (missionIds.length > 0) {
      // 2. 删除 mission_events
      const eventsDeleted = await this.prisma.slidesMissionEvent.deleteMany({
        where: { missionId: { in: missionIds } },
      });
      this.logger.log(
        `[deleteSession] Deleted ${eventsDeleted.count} mission events`,
      );

      // 3. 删除 tasks
      const tasksDeleted = await this.prisma.slidesTask.deleteMany({
        where: { missionId: { in: missionIds } },
      });
      this.logger.log(`[deleteSession] Deleted ${tasksDeleted.count} tasks`);

      // 4. 删除 missions
      const missionsDeleted = await this.prisma.slidesMission.deleteMany({
        where: { id: { in: missionIds } },
      });
      this.logger.log(
        `[deleteSession] Deleted ${missionsDeleted.count} missions`,
      );
    }

    // 5. 删除所有检查点
    const checkpointsDeleted = await this.prisma.slidesCheckpoint.deleteMany({
      where: { sessionId },
    });
    this.logger.log(
      `[deleteSession] Deleted ${checkpointsDeleted.count} checkpoints`,
    );

    // 6. 最后删除会话
    await this.prisma.slidesSession.delete({
      where: { id: sessionId },
    });

    this.logger.log(
      `[deleteSession] Session ${sessionId} deleted successfully`,
    );
  }

  /**
   * 创建检查点
   */
  async create(input: CreateCheckpointInput): Promise<Checkpoint> {
    const { sessionId, name, type, state, metadata = {} } = input;

    // 获取上一个检查点
    const previousCheckpoint = await this.getLatestCheckpoint(sessionId);

    // 生成版本号
    const version = this.generateVersion(previousCheckpoint?.version);

    // 生成检查点名称
    const checkpointName = name || this.generateCheckpointName(type, state);

    this.logger.log(
      `[create] Creating checkpoint: ${checkpointName} (${type}) for session: ${sessionId}`,
    );

    const checkpoint = await this.prisma.slidesCheckpoint.create({
      data: {
        id: uuidv4(),
        sessionId,
        name: checkpointName,
        type: CHECKPOINT_TYPE_TO_PRISMA[type],
        version,
        stateJson: state as unknown as Prisma.InputJsonValue,
        metadata: {
          ...metadata,
          previousCheckpointId: previousCheckpoint?.id,
          trigger: metadata.trigger || "auto",
        } as Prisma.InputJsonValue,
      },
    });

    // 更新会话的当前状态
    await this.prisma.slidesSession.update({
      where: { id: sessionId },
      data: { currentStateId: checkpoint.id },
    });

    // 检查是否需要清理旧检查点
    await this.pruneIfNeeded(sessionId);

    return this.mapToCheckpoint(checkpoint);
  }

  /**
   * 获取检查点
   */
  async get(checkpointId: string): Promise<Checkpoint> {
    const checkpoint = await this.prisma.slidesCheckpoint.findUnique({
      where: { id: checkpointId },
    });

    if (!checkpoint) {
      throw new NotFoundException(`Checkpoint not found: ${checkpointId}`);
    }

    // ★ DIAGNOSTIC: Log raw database data
    const stateJson = checkpoint.stateJson as Record<string, unknown>;
    this.logger.log(
      `[get] ★ Checkpoint ${checkpointId.slice(0, 8)}... DB stateJson keys: ${Object.keys(stateJson || {}).join(", ")}`,
    );
    this.logger.log(
      `[get] ★ DB stateJson.pages: type=${typeof stateJson?.pages}, isArray=${Array.isArray(stateJson?.pages)}, length=${(stateJson?.pages as unknown[])?.length || 0}`,
    );
    if (
      Array.isArray(stateJson?.pages) &&
      (stateJson.pages as unknown[]).length > 0
    ) {
      const firstPage = (stateJson.pages as Record<string, unknown>[])[0];
      this.logger.log(
        `[get] ★ DB First page: keys=${Object.keys(firstPage || {}).join(", ")}, html=${(firstPage?.html as string)?.length || 0} chars`,
      );
    }

    return this.mapToCheckpoint(checkpoint);
  }

  /**
   * 获取会话的最新检查点
   */
  async getLatestCheckpoint(sessionId: string): Promise<Checkpoint | null> {
    const checkpoint = await this.prisma.slidesCheckpoint.findFirst({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
    });

    return checkpoint ? this.mapToCheckpoint(checkpoint) : null;
  }

  /**
   * 列出检查点
   */
  async list(filter?: CheckpointFilter): Promise<Checkpoint[]> {
    const where: Record<string, unknown> = {};

    if (filter?.sessionId) {
      where.sessionId = filter.sessionId;
    }
    if (filter?.type) {
      where.type = filter.type;
    }
    if (filter?.fromDate || filter?.toDate) {
      where.createdAt = {};
      if (filter.fromDate) {
        (where.createdAt as Record<string, Date>).gte = filter.fromDate;
      }
      if (filter.toDate) {
        (where.createdAt as Record<string, Date>).lte = filter.toDate;
      }
    }

    const checkpoints = await this.prisma.slidesCheckpoint.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return checkpoints.map((cp) => this.mapToCheckpoint(cp));
  }

  /**
   * 恢复到指定检查点
   * @returns 包含 state, sessionId, checkpointId 的对象
   */
  async restore(checkpointId: string): Promise<{
    state: CheckpointState;
    sessionId: string;
    checkpointId: string;
  }> {
    this.logger.log(`[restore] Restoring to checkpoint: ${checkpointId}`);

    const checkpoint = await this.get(checkpointId);

    // ★ DIAGNOSTIC: Log checkpoint state after get()
    this.logger.log(
      `[restore] ★ checkpoint.state keys: ${Object.keys(checkpoint.state || {}).join(", ")}`,
    );
    this.logger.log(
      `[restore] ★ checkpoint.state.pages: ${checkpoint.state?.pages?.length || 0} pages`,
    );
    this.logger.log(
      `[restore] ★ checkpoint.state.outlinePlan: ${checkpoint.state?.outlinePlan ? "exists" : "undefined"}`,
    );

    // 更新会话的当前状态
    await this.prisma.slidesSession.update({
      where: { id: checkpoint.sessionId },
      data: { currentStateId: checkpointId },
    });

    // 同步 mission.pages：让 chatEdit 等服务能读到最新页面内容
    if (checkpoint.state?.pages?.length) {
      const latestMission = await this.prisma.slidesMission.findFirst({
        where: { sessionId: checkpoint.sessionId },
        orderBy: { createdAt: "desc" },
      });
      if (latestMission) {
        await this.prisma.slidesMission.update({
          where: { id: latestMission.id },
          data: { pages: checkpoint.state.pages as unknown as object },
        });
        this.logger.log(
          `[restore] Synced ${checkpoint.state.pages.length} pages to mission ${latestMission.id}`,
        );
      }
    }

    // 创建一个恢复检查点以记录操作
    // 清除名称中已有的 "Restored from: " 前缀，避免无限累积
    const baseName = checkpoint.name.replace(/^(Restored from: )+/, "");
    const restoredName = `Restored: ${baseName}`.substring(0, 200); // 限制长度
    await this.create({
      sessionId: checkpoint.sessionId,
      name: restoredName,
      type: "user_modified",
      state: checkpoint.state,
      metadata: {
        trigger: "user",
        description: `Restored from checkpoint ${checkpointId}`,
      },
    });

    return {
      state: checkpoint.state,
      sessionId: checkpoint.sessionId,
      checkpointId: checkpoint.id,
    };
  }

  /**
   * 比较两个检查点
   */
  async diff(
    checkpointId1: string,
    checkpointId2: string,
  ): Promise<CheckpointDiff> {
    const [cp1, cp2] = await Promise.all([
      this.get(checkpointId1),
      this.get(checkpointId2),
    ]);

    const changes: CheckpointDiff["changes"] = [];
    const pagesAdded: number[] = [];
    const pagesModified: number[] = [];
    const pagesRemoved: number[] = [];

    // 比较任务分解
    if (
      JSON.stringify(cp1.state.taskDecomposition) !==
      JSON.stringify(cp2.state.taskDecomposition)
    ) {
      changes.push({
        field: "taskDecomposition",
        before: cp1.state.taskDecomposition,
        after: cp2.state.taskDecomposition,
      });
    }

    // 比较大纲
    if (
      JSON.stringify(cp1.state.outlinePlan) !==
      JSON.stringify(cp2.state.outlinePlan)
    ) {
      changes.push({
        field: "outlinePlan",
        before: cp1.state.outlinePlan,
        after: cp2.state.outlinePlan,
      });
    }

    // 比较页面
    const pages1 = new Map(
      (cp1.state.pages || []).map((p) => [p.pageNumber, p]),
    );
    const pages2 = new Map(
      (cp2.state.pages || []).map((p) => [p.pageNumber, p]),
    );

    // 找出新增的页面
    for (const pageNum of pages2.keys()) {
      if (!pages1.has(pageNum)) {
        pagesAdded.push(pageNum);
      }
    }

    // 找出删除的页面
    for (const pageNum of pages1.keys()) {
      if (!pages2.has(pageNum)) {
        pagesRemoved.push(pageNum);
      }
    }

    // 找出修改的页面
    for (const [pageNum, page1] of pages1) {
      const page2 = pages2.get(pageNum);
      if (page2 && JSON.stringify(page1) !== JSON.stringify(page2)) {
        pagesModified.push(pageNum);
      }
    }

    return {
      from: cp1,
      to: cp2,
      changes,
      pagesAdded,
      pagesModified,
      pagesRemoved,
    };
  }

  /**
   * 删除检查点
   */
  async delete(checkpointId: string): Promise<void> {
    this.logger.log(`[delete] Deleting checkpoint: ${checkpointId}`);

    await this.prisma.slidesCheckpoint.delete({
      where: { id: checkpointId },
    });
  }

  /**
   * 清理旧检查点，只保留最近 N 个
   */
  async prune(sessionId: string, keepLast: number = 50): Promise<number> {
    this.logger.log(
      `[prune] Pruning checkpoints for session: ${sessionId}, keeping: ${keepLast}`,
    );

    // 获取所有检查点，按时间排序
    const checkpoints = await this.prisma.slidesCheckpoint.findMany({
      where: { sessionId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (checkpoints.length <= keepLast) {
      return 0;
    }

    // 删除超出限制的检查点
    const toDelete = checkpoints.slice(keepLast).map((cp) => cp.id);

    await this.prisma.slidesCheckpoint.deleteMany({
      where: { id: { in: toDelete } },
    });

    this.logger.log(`[prune] Deleted ${toDelete.length} old checkpoints`);
    return toDelete.length;
  }

  /**
   * 获取检查点版本树
   */
  async getVersionTree(sessionId: string): Promise<
    {
      checkpoint: Checkpoint;
      children: string[];
    }[]
  > {
    const checkpoints = await this.list({ sessionId });

    return checkpoints.map((cp) => ({
      checkpoint: cp,
      children: checkpoints
        .filter((c) => c.metadata.previousCheckpointId === cp.id)
        .map((c) => c.id),
    }));
  }

  /**
   * 设置自动保存配置
   */
  setAutoSaveConfig(config: Partial<AutoSaveConfig>): void {
    this.autoSaveConfig = { ...this.autoSaveConfig, ...config };
  }

  /**
   * 获取自动保存配置
   */
  getAutoSaveConfig(): AutoSaveConfig {
    return { ...this.autoSaveConfig };
  }

  /**
   * 判断是否需要自动保存
   */
  shouldAutoSave(
    trigger: "phase_complete" | "page_rendered" | "time_interval",
    pageNumber?: number,
  ): boolean {
    switch (trigger) {
      case "phase_complete":
        return this.autoSaveConfig.phaseComplete;
      case "page_rendered":
        return (
          pageNumber !== undefined &&
          pageNumber % this.autoSaveConfig.pageInterval === 0
        );
      case "time_interval":
        return this.autoSaveConfig.timeIntervalMs > 0;
      default:
        return false;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 如果需要则清理旧检查点
   */
  private async pruneIfNeeded(sessionId: string): Promise<void> {
    const count = await this.prisma.slidesCheckpoint.count({
      where: { sessionId },
    });

    if (count > this.autoSaveConfig.maxCheckpoints) {
      await this.prune(sessionId, this.autoSaveConfig.maxCheckpoints);
    }
  }

  /**
   * 生成版本号
   */
  private generateVersion(previousVersion?: string): string {
    if (!previousVersion) {
      return "1.0.0";
    }

    const parts = previousVersion.split(".").map(Number);
    parts[2] += 1; // 增加补丁版本

    if (parts[2] >= 100) {
      parts[2] = 0;
      parts[1] += 1;
    }

    if (parts[1] >= 100) {
      parts[1] = 0;
      parts[0] += 1;
    }

    return parts.join(".");
  }

  /**
   * 生成检查点名称
   */
  private generateCheckpointName(
    type: CheckpointType,
    state: CheckpointState,
  ): string {
    const timestamp = new Date().toISOString().slice(11, 19);

    switch (type) {
      case "task_decomposition":
        return `任务分解 (${state.taskDecomposition?.totalPages || 0}页) - ${timestamp}`;
      case "outline_confirmed":
        return `大纲确认 - ${timestamp}`;
      case "page_rendered":
        const pages = state.pages || [];
        const completedPages = pages.filter(
          (p) => p.status === "completed",
        ).length;
        return `页面渲染 (${completedPages}/${pages.length}) - ${timestamp}`;
      case "batch_rendered":
        return `批量渲染完成 - ${timestamp}`;
      case "user_modified":
        return `用户修改 - ${timestamp}`;
      case "auto_save":
        return `自动保存 - ${timestamp}`;
      default:
        return `检查点 - ${timestamp}`;
    }
  }

  /**
   * 映射数据库记录到 Checkpoint 类型
   */
  private mapToCheckpoint(record: {
    id: string;
    sessionId: string;
    name: string;
    type: SlidesCheckpointType;
    version: string;
    stateJson: unknown;
    metadata: unknown;
    createdAt: Date;
  }): Checkpoint {
    return {
      id: record.id,
      sessionId: record.sessionId,
      name: record.name,
      type: prismaToCheckpointType(record.type),
      version: record.version,
      timestamp: record.createdAt,
      state: record.stateJson as CheckpointState,
      metadata: record.metadata as CheckpointMetadata,
    };
  }
}

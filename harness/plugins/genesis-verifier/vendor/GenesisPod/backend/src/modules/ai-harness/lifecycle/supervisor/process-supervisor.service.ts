/**
 * Process Supervisor Service
 *
 * 通用的任务执行状态管理器，提供：
 * - 并发任务执行跟踪
 * - 任务状态 TTL 管理
 * - 定期清理超时状态
 * - 状态统计和调试
 *
 * 使用场景：
 * - Mission 执行状态管理
 * - Agent 任务并发控制
 * - 长时间运行任务的生命周期管理
 *
 * ★ Migrated from ai-engine/planning/state-machine/execution-state.manager.ts
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import { CacheService } from "@/common/cache/cache.service";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ProcessManagerService } from "@/modules/ai-harness/lifecycle/manager/process-manager.service";

// ==================== 类型定义 ====================

/**
 * 状态项接口，包含开始时间用于 TTL 计算
 */
export interface StateEntry {
  startTime: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 状态类别枚举
 */
export enum StateCategory {
  /** 任务执行 */
  TASK = "task",
  /** 工作流/Mission 执行 */
  WORKFLOW = "workflow",
  /** 修订/重试 */
  REVISION = "revision",
  /** 自定义类别 */
  CUSTOM = "custom",
}

/**
 * 状态统计信息
 */
export interface ExecutionStateStats {
  /** 各类别的活跃数量 */
  activeCounts: Record<StateCategory | string, number>;
  /** 各类别最老状态的年龄（毫秒） */
  oldestAges: Record<StateCategory | string, number | null>;
  /** 总活跃状态数 */
  totalActive: number;
  /** 清理配置 */
  config: {
    ttlMs: number;
    cleanupIntervalMs: number;
  };
}

/**
 * 状态管理配置
 */
export interface ExecutionStateConfig {
  /** 状态超时时间（毫秒） */
  ttlMs?: number;
  /** 清理间隔（毫秒） */
  cleanupIntervalMs?: number;
  /** 是否启用自动清理 */
  enableAutoCleanup?: boolean;
}

// ==================== 服务实现 ====================

@Injectable()
export class ProcessSupervisorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProcessSupervisorService.name);

  // ==================== 状态存储 ====================

  /**
   * 多类别状态存储: category -> (id -> StateEntry)
   *
   * 2026-05-15 PR-E.P2 评估：保留 in-process（不迁 Redis）。理由：
   *   - ProcessSupervisor 监督的是**该 pod 内**正在跑的进程（NodeJS 子进程 / 推理任务）
   *     —— "进程" 本身就 pod-local，stateStore 跨 pod 共享无业务意义
   *   - 30min TTL + 5min 自动 cleanup 已经控制内存，pod 重启即丢符合语义
   *   - 嵌套 Map 跨 pod 序列化复杂度高，收益与代价不匹配（YAGNI）
   */
  private readonly stateStore = new Map<string, Map<string, StateEntry>>();

  // ==================== 配置 ====================

  /** 状态超时时间（默认 30 分钟） */
  private ttlMs = 30 * 60 * 1000;

  /** 清理间隔（默认 5 分钟） */
  private cleanupIntervalMs = 5 * 60 * 1000;

  /** 是否启用自动清理 */
  private enableAutoCleanup = true;

  /** 清理定时器 */
  private cleanupInterval: NodeJS.Timeout | null = null;

  /** Process timeout: 30 minutes with no state change */
  private readonly PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
  /** Zombie detection: process has been RUNNING for > 2 hours */
  private readonly ZOMBIE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
  /** Health check interval: every 30 seconds */
  private readonly HEALTH_CHECK_INTERVAL_MS = 30 * 1000;

  /** Health check timer */
  private healthCheckInterval: NodeJS.Timeout | null = null;

  /** Whether the agent_processes table exists in the database */
  private dbTableReady = false;

  /** Whether the process_memories table exists in the database */
  private dbMemoryTableReady = false;

  constructor(
    @Optional() private readonly cacheService?: CacheService,
    @Optional() private readonly prisma?: PrismaService,
    // Reserved for future use: process lifecycle management (injected but not yet consumed)
    @Optional() processManager?: ProcessManagerService,
  ) {
    void processManager; // reserved for future use
  }

  // ==================== 生命周期 ====================

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `[ProcessSupervisorService] Initializing with TTL=${this.ttlMs}ms, cleanup interval=${this.cleanupIntervalMs}ms`,
    );
    if (this.enableAutoCleanup) {
      this.startCleanupScheduler();
    }
    // Check if kernel tables exist before starting DB-dependent schedulers
    if (this.prisma) {
      this.dbTableReady = await this.checkTableExists("agent_processes");
      this.dbMemoryTableReady = await this.checkTableExists("process_memories");
      if (!this.dbTableReady) {
        this.logger.warn(
          "agent_processes table not found — health check and recovery disabled until next deploy",
        );
        return;
      }
      this.startHealthCheckScheduler();
      void this.recoverOnStartup();
    }
  }

  onModuleDestroy(): void {
    this.logger.log(`[ProcessSupervisorService] Shutting down`);
    this.stopCleanupScheduler();
    this.stopHealthCheckScheduler();
  }

  private async checkTableExists(tableName: string): Promise<boolean> {
    if (!this.prisma) return false;
    try {
      const result = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(
        Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ${tableName}) AS "exists"`,
      );
      return result[0]?.exists === true;
    } catch {
      return false;
    }
  }

  /**
   * 配置状态管理器
   */
  configure(config: ExecutionStateConfig): void {
    if (config.ttlMs !== undefined) {
      this.ttlMs = config.ttlMs;
    }
    if (config.cleanupIntervalMs !== undefined) {
      this.cleanupIntervalMs = config.cleanupIntervalMs;
    }
    if (config.enableAutoCleanup !== undefined) {
      this.enableAutoCleanup = config.enableAutoCleanup;
      if (this.enableAutoCleanup) {
        this.startCleanupScheduler();
      } else {
        this.stopCleanupScheduler();
      }
    }
    this.logger.log(
      `[ProcessSupervisorService] Configured: TTL=${this.ttlMs}ms, cleanup=${this.cleanupIntervalMs}ms, autoCleanup=${this.enableAutoCleanup}`,
    );
  }

  /**
   * Redis 键生成
   */
  private redisStateKey(category: string, id: string): string {
    return `ai:state:${category}:${id}`;
  }

  // ==================== 状态操作 API ====================

  /**
   * 开始跟踪一个状态
   * @returns true 如果成功开始，false 如果已存在
   */
  start(
    category: StateCategory | string,
    id: string,
    description?: string,
    metadata?: Record<string, unknown>,
  ): boolean {
    const categoryStore = this.getOrCreateCategory(category);

    if (categoryStore.has(id)) {
      this.logger.debug(
        `[ProcessSupervisorService] ${category}:${id} already active`,
      );
      return false;
    }

    categoryStore.set(id, {
      startTime: Date.now(),
      description,
      metadata,
    });

    this.logger.debug(
      `[ProcessSupervisorService] Started ${category}:${id}. Active in category: ${categoryStore.size}`,
    );

    // Dual-write to Redis (CacheService handles errors internally)
    if (this.cacheService) {
      const entry = categoryStore.get(id)!;
      void this.cacheService.set(
        this.redisStateKey(category, id),
        entry,
        Math.ceil(this.ttlMs / 1000),
      );
    }

    return true;
  }

  /**
   * 结束跟踪一个状态
   */
  finish(category: StateCategory | string, id: string): void {
    const categoryStore = this.stateStore.get(category);
    if (categoryStore?.delete(id)) {
      this.logger.debug(
        `[ProcessSupervisorService] Finished ${category}:${id}. Active in category: ${categoryStore.size}`,
      );

      // Delete from Redis
      if (this.cacheService) {
        void this.cacheService.del(this.redisStateKey(category, id));
      }
    }
  }

  /**
   * 检查状态是否活跃
   */
  isActive(category: StateCategory | string, id: string): boolean {
    return this.stateStore.get(category)?.has(id) ?? false;
  }

  /**
   * 获取状态信息
   */
  getState(
    category: StateCategory | string,
    id: string,
  ): StateEntry | undefined {
    return this.stateStore.get(category)?.get(id);
  }

  /**
   * 获取类别中所有活跃的 ID
   */
  getActiveIds(category: StateCategory | string): string[] {
    return Array.from(this.stateStore.get(category)?.keys() ?? []);
  }

  /**
   * 获取类别中所有活跃的状态
   */
  getActiveStates(
    category: StateCategory | string,
  ): Map<string, StateEntry> | undefined {
    return this.stateStore.get(category);
  }

  // ==================== 便捷方法 (兼容 MissionStateManager) ====================

  /** 开始任务执行 */
  startTask(taskId: string, description?: string): boolean {
    return this.start(StateCategory.TASK, taskId, description);
  }

  /** 结束任务执行 */
  finishTask(taskId: string): void {
    this.finish(StateCategory.TASK, taskId);
  }

  /** 检查任务是否正在执行 */
  isTaskExecuting(taskId: string): boolean {
    return this.isActive(StateCategory.TASK, taskId);
  }

  /** 开始工作流执行 */
  startWorkflow(workflowId: string, description?: string): boolean {
    return this.start(StateCategory.WORKFLOW, workflowId, description);
  }

  /** 结束工作流执行 */
  finishWorkflow(workflowId: string): void {
    this.finish(StateCategory.WORKFLOW, workflowId);
  }

  /** 检查工作流是否正在执行 */
  isWorkflowExecuting(workflowId: string): boolean {
    return this.isActive(StateCategory.WORKFLOW, workflowId);
  }

  /** 开始修订 */
  startRevision(taskId: string, description?: string): boolean {
    return this.start(StateCategory.REVISION, taskId, description);
  }

  /** 结束修订 */
  finishRevision(taskId: string): void {
    this.finish(StateCategory.REVISION, taskId);
  }

  /** 检查是否正在修订 */
  isRevisionInProgress(taskId: string): boolean {
    return this.isActive(StateCategory.REVISION, taskId);
  }

  // ==================== 统计和调试 ====================

  /**
   * 获取状态统计信息
   */
  getStats(): ExecutionStateStats {
    const now = Date.now();
    const activeCounts: Record<string, number> = {};
    const oldestAges: Record<string, number | null> = {};
    let totalActive = 0;

    for (const [category, store] of this.stateStore) {
      activeCounts[category] = store.size;
      totalActive += store.size;

      if (store.size === 0) {
        oldestAges[category] = null;
      } else {
        let oldest = now;
        for (const entry of store.values()) {
          if (entry.startTime < oldest) {
            oldest = entry.startTime;
          }
        }
        oldestAges[category] = now - oldest;
      }
    }

    return {
      activeCounts,
      oldestAges,
      totalActive,
      config: {
        ttlMs: this.ttlMs,
        cleanupIntervalMs: this.cleanupIntervalMs,
      },
    };
  }

  /**
   * 获取执行中任务 ID 列表 (兼容方法)
   */
  getExecutingTaskIds(): string[] {
    return this.getActiveIds(StateCategory.TASK);
  }

  /**
   * 获取执行中工作流 ID 列表 (兼容方法)
   */
  getExecutingMissionIds(): string[] {
    return this.getActiveIds(StateCategory.WORKFLOW);
  }

  /**
   * 获取正在修订的任务 ID 列表 (兼容方法)
   */
  getRevisingTaskIds(): string[] {
    return this.getActiveIds(StateCategory.REVISION);
  }

  // ==================== 清理逻辑 ====================

  /**
   * 启动定期清理调度器
   */
  private startCleanupScheduler(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredStates();
    }, this.cleanupIntervalMs).unref();

    this.logger.log(
      `[ProcessSupervisorService] Cleanup scheduler started (interval: ${this.cleanupIntervalMs}ms)`,
    );
  }

  /**
   * 停止清理调度器
   */
  private stopCleanupScheduler(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.log(`[ProcessSupervisorService] Cleanup scheduler stopped`);
    }
  }

  /**
   * 清理超时的状态项
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [category, store] of this.stateStore) {
      for (const [id, entry] of store) {
        if (now - entry.startTime > this.ttlMs) {
          store.delete(id);
          cleanedCount++;
          this.logger.warn(
            `[ProcessSupervisorService] Cleaned expired state: ${category}:${id} (age: ${Math.round((now - entry.startTime) / 1000 / 60)}min)`,
          );
        }
      }
    }

    if (cleanedCount > 0) {
      this.logger.log(
        `[ProcessSupervisorService] Cleanup completed: removed ${cleanedCount} expired states`,
      );
    }
  }

  /**
   * 强制清理所有状态（用于测试或紧急情况）
   */
  forceCleanAll(): void {
    const stats = this.getStats();
    for (const store of this.stateStore.values()) {
      store.clear();
    }
    this.logger.warn(
      `[ProcessSupervisorService] Force cleaned all states: ${JSON.stringify(stats)}`,
    );
  }

  /**
   * 清理指定类别的所有状态
   */
  clearCategory(category: StateCategory | string): void {
    const store = this.stateStore.get(category);
    if (store) {
      const count = store.size;
      store.clear();
      this.logger.log(
        `[ProcessSupervisorService] Cleared ${count} states from category ${category}`,
      );
    }
  }

  /**
   * 手动触发清理（用于 admin 操作）
   */
  triggerCleanup(): {
    before: ExecutionStateStats;
    after: ExecutionStateStats;
  } {
    const before = this.getStats();
    this.cleanupExpiredStates();
    const after = this.getStats();
    return { before, after };
  }

  // ==================== 健康检查和崩溃恢复 ====================

  /**
   * Start health check scheduler
   */
  private startHealthCheckScheduler(): void {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    this.healthCheckInterval = setInterval(() => {
      void this.healthCheck();
    }, this.HEALTH_CHECK_INTERVAL_MS).unref();
    this.logger.log(
      `Health check scheduler started (interval: ${this.HEALTH_CHECK_INTERVAL_MS}ms)`,
    );
  }

  /**
   * Stop health check scheduler
   */
  private stopHealthCheckScheduler(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Periodic health check: detect timeouts, zombies, orphans, resource leaks
   */
  async healthCheck(): Promise<void> {
    if (!this.prisma) return;

    try {
      const now = new Date();

      // 1. Detect timed-out processes (RUNNING but no update for too long)
      const timedOut = await this.prisma.agentProcess.findMany({
        where: {
          state: "RUNNING",
          updatedAt: { lt: new Date(now.getTime() - this.PROCESS_TIMEOUT_MS) },
        },
        select: { id: true, agentId: true, updatedAt: true },
      });

      for (const p of timedOut) {
        this.logger.warn(
          `Process ${p.id} (agent: ${p.agentId}) timed out, marking as FAILED`,
        );
        await this.prisma.agentProcess.updateMany({
          where: { id: p.id },
          data: {
            state: "FAILED",
            error: "Process timed out (no activity)",
            completedAt: now,
          },
        });
      }

      // 2. Detect zombie processes (RUNNING for too long)
      const zombies = await this.prisma.agentProcess.findMany({
        where: {
          state: "RUNNING",
          startedAt: { lt: new Date(now.getTime() - this.ZOMBIE_THRESHOLD_MS) },
        },
        select: { id: true, agentId: true, startedAt: true },
      });

      for (const z of zombies) {
        this.logger.warn(
          `Process ${z.id} (agent: ${z.agentId}) detected as zombie, marking`,
        );
        await this.prisma.agentProcess.updateMany({
          where: { id: z.id },
          data: { state: "ZOMBIE" },
        });
      }

      // 3. Clean up expired memory (only if process_memories table exists)
      let expiredMemoryCount = 0;
      if (this.dbMemoryTableReady) {
        const expiredMemory = await this.prisma.processMemory.deleteMany({
          where: { expiresAt: { lt: now } },
        });
        expiredMemoryCount = expiredMemory.count;
      }

      if (timedOut.length > 0 || zombies.length > 0 || expiredMemoryCount > 0) {
        this.logger.log(
          `Health check: timedOut=${timedOut.length}, zombies=${zombies.length}, expiredMemory=${expiredMemoryCount}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Recover processes on startup (onModuleInit)
   * Processes that were RUNNING or WAITING when the server crashed should be recovered
   */
  async recoverOnStartup(): Promise<void> {
    if (!this.prisma) return;

    try {
      // Find processes that were RUNNING or WAITING (server likely crashed)
      const staleProcesses = await this.prisma.agentProcess.findMany({
        where: {
          state: { in: ["RUNNING", "WAITING"] },
        },
        select: { id: true, state: true, agentId: true, checkpoint: true },
      });

      if (staleProcesses.length === 0) return;

      this.logger.warn(
        `Found ${staleProcesses.length} stale processes from previous run`,
      );

      for (const p of staleProcesses) {
        if (p.checkpoint) {
          // Has checkpoint: transition back to READY for retry
          this.logger.log(
            `Process ${p.id} has checkpoint, transitioning to READY for retry`,
          );
          await this.prisma.agentProcess.updateMany({
            where: { id: p.id },
            data: { state: "READY" },
          });
        } else {
          // No checkpoint: mark as FAILED
          this.logger.warn(
            `Process ${p.id} has no checkpoint, marking as FAILED`,
          );
          await this.prisma.agentProcess.updateMany({
            where: { id: p.id },
            data: {
              state: "FAILED",
              error: "Server restart: process interrupted without checkpoint",
              completedAt: new Date(),
            },
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Startup recovery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 获取或创建类别存储
   */
  private getOrCreateCategory(category: string): Map<string, StateEntry> {
    let store = this.stateStore.get(category);
    if (!store) {
      store = new Map();
      this.stateStore.set(category, store);
    }
    return store;
  }
}

/**
 * Kernel Scheduler Service
 * Manages process scheduling with priority-based queue and tenant isolation
 *
 * Uses PostgreSQL FOR UPDATE SKIP LOCKED for distributed-safe scheduling
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

@Injectable()
export class KernelSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KernelSchedulerService.name);
  private schedulerInterval: NodeJS.Timeout | null = null;
  private tableExists = false;

  /** Max concurrent RUNNING processes globally */
  private readonly maxConcurrent: number;
  /** Max concurrent RUNNING processes per tenant (userId) */
  private readonly maxPerTenant: number;
  /** Schedule check interval in ms */
  private readonly scheduleIntervalMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.maxConcurrent = this.configService.get<number>(
      "KERNEL_MAX_CONCURRENT",
      50,
    );
    this.maxPerTenant = this.configService.get<number>(
      "KERNEL_MAX_PER_TENANT",
      10,
    );
    this.scheduleIntervalMs = this.configService.get<number>(
      "KERNEL_SCHEDULE_INTERVAL_MS",
      1000,
    );
  }

  async onModuleInit(): Promise<void> {
    this.tableExists = await this.checkTableExists();
    if (!this.tableExists) {
      this.logger.warn(
        "agent_processes table not found — scheduler disabled until next deploy",
      );
      return;
    }
    this.startScheduler();
    this.logger.log(
      `Kernel Scheduler started: maxConcurrent=${this.maxConcurrent}, maxPerTenant=${this.maxPerTenant}, interval=${this.scheduleIntervalMs}ms`,
    );
  }

  onModuleDestroy(): void {
    this.stopScheduler();
  }

  private async checkTableExists(): Promise<boolean> {
    try {
      const result = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(
        Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_processes') AS "exists"`,
      );
      return result[0]?.exists === true;
    } catch {
      return false;
    }
  }

  private startScheduler(): void {
    if (this.schedulerInterval) clearInterval(this.schedulerInterval);
    this.schedulerInterval = setInterval(() => {
      void this.scheduleNext();
    }, this.scheduleIntervalMs).unref();
  }

  private stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      this.logger.log("Kernel Scheduler stopped");
    }
  }

  /**
   * Schedule next READY processes for execution.
   * Uses raw SQL with FOR UPDATE SKIP LOCKED for distributed safety.
   */
  async scheduleNext(): Promise<string[]> {
    if (!this.tableExists) return [];

    try {
      // Count currently running processes
      const runningCount = await this.prisma.agentProcess.count({
        where: { state: "RUNNING" },
      });

      if (runningCount >= this.maxConcurrent) {
        return [];
      }

      const slotsAvailable = this.maxConcurrent - runningCount;

      // Find READY processes ordered by priority DESC, created_at ASC
      // Using raw SQL for FOR UPDATE SKIP LOCKED (not supported by Prisma natively)
      const readyProcesses = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; user_id: string }>
      >(
        `SELECT id, user_id FROM agent_processes
         WHERE state = 'READY'
         ORDER BY priority DESC, created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        slotsAvailable,
      );

      if (readyProcesses.length === 0) return [];

      // Check per-tenant limits
      const scheduledIds: string[] = [];
      const tenantRunningCounts = new Map<string, number>();

      // Pre-load tenant running counts
      const tenantCounts = await this.prisma.agentProcess.groupBy({
        by: ["userId"],
        where: { state: "RUNNING" },
        _count: true,
      });
      for (const tc of tenantCounts) {
        tenantRunningCounts.set(tc.userId, tc._count);
      }

      for (const process of readyProcesses) {
        const tenantRunning = tenantRunningCounts.get(process.user_id) ?? 0;
        if (tenantRunning >= this.maxPerTenant) {
          continue; // Skip this tenant, they're at capacity
        }

        // Transition to RUNNING (updateMany avoids P2025 on race condition)
        try {
          const { count } = await this.prisma.agentProcess.updateMany({
            where: { id: process.id, state: "READY" },
            data: { state: "RUNNING", startedAt: new Date() },
          });
          if (count > 0) {
            scheduledIds.push(process.id);
            tenantRunningCounts.set(process.user_id, tenantRunning + 1);
          } else {
            this.logger.debug(
              `Process ${process.id} already scheduled by another instance`,
            );
          }
        } catch (err) {
          // 生产默认 warn+ 级别，debug 不可见；调度失败会让 process 停在 READY
          // 循环重试，静默等于隐形循环失败
          this.logger.warn(
            `Process ${process.id} scheduling failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      if (scheduledIds.length > 0) {
        this.logger.debug(`Scheduled ${scheduledIds.length} processes`);
      }

      return scheduledIds;
    } catch (error) {
      this.logger.error(
        `Scheduler error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Get scheduler stats
   */
  async getStats(): Promise<{
    running: number;
    ready: number;
    maxConcurrent: number;
    maxPerTenant: number;
  }> {
    if (!this.tableExists) {
      return {
        running: 0,
        ready: 0,
        maxConcurrent: this.maxConcurrent,
        maxPerTenant: this.maxPerTenant,
      };
    }

    const [running, ready] = await Promise.all([
      this.prisma.agentProcess.count({ where: { state: "RUNNING" } }),
      this.prisma.agentProcess.count({ where: { state: "READY" } }),
    ]);

    return {
      running,
      ready,
      maxConcurrent: this.maxConcurrent,
      maxPerTenant: this.maxPerTenant,
    };
  }
}

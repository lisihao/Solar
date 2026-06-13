import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * DataRetentionScheduler —— 高增长表的统一老化清理（2026-06-12）。
 *
 * 背景：admin 数据管理实测 harness_agent_events 339MB / agent_playground_mission_events
 * 183MB / harness_checkpoints 147MB / ai_engine_metrics 69MB 持续膨胀——这些表此前
 * **没有任何老化机制**（仅 radar 简报与 BYOK 有自己的 cron 清理）。
 *
 * 策略（保守、可配置）：
 *   - 事件/指标/审计类按 age 删除（replay/观测价值随时间归零）
 *   - checkpoint 仅删终态 agent 的过期断点（running 的永不动 —— resume 依赖）
 *   - 每表保留天数可用环境变量覆盖（RETENTION_*_DAYS）
 *   - ENABLE_DATA_RETENTION !== "true" 时整体禁用（与 radar scheduler 同款开关模式）
 *   - DATA_RETENTION_DRY_RUN=true 时只统计不删除（上线前先观察一轮）
 *
 * 凌晨 03:10 UTC 执行，避开 radar 简报清理（02:00）与 BYOK 维护（00:20/00:30）。
 */
@Injectable()
export class DataRetentionScheduler {
  private readonly logger = new Logger(DataRetentionScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private days(envKey: string, fallback: number): number {
    const raw = this.config.get<string>(envKey);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  private cutoff(daysAgo: number): Date {
    return new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
  }

  @Cron("10 3 * * *", {
    name: "data-retention-sweep",
    timeZone: "UTC",
    disabled: process.env.ENABLE_DATA_RETENTION !== "true",
  })
  async sweep(): Promise<void> {
    const dryRun = this.config.get<string>("DATA_RETENTION_DRY_RUN") === "true";
    this.logger.log(
      `[data-retention] sweep start (dryRun=${dryRun ? "yes" : "no"})`,
    );
    const results: string[] = [];

    /* 1. harness_agent_events —— agent 事件流（resume/replay 用），默认保留 30 天 */
    await this.run(results, "harness_agent_events", dryRun, () => {
      const where = {
        emittedAt: {
          lt: this.cutoff(this.days("RETENTION_HARNESS_EVENTS_DAYS", 30)),
        },
      };
      return dryRun
        ? this.prisma.harnessAgentEvent.count({ where })
        : this.prisma.harnessAgentEvent
            .deleteMany({ where })
            .then((r) => r.count);
    });

    /* 2. harness_checkpoints —— 仅删终态 agent 的过期断点，running 永不动 */
    await this.run(results, "harness_checkpoints", dryRun, () => {
      const where = {
        takenAt: {
          lt: this.cutoff(this.days("RETENTION_CHECKPOINT_DAYS", 14)),
        },
        agentState: { in: ["completed", "failed", "cancelled"] },
      };
      return dryRun
        ? this.prisma.harnessCheckpoint.count({ where })
        : this.prisma.harnessCheckpoint
            .deleteMany({ where })
            .then((r) => r.count);
    });

    /* 3. agent_playground_mission_events —— mission 事件 journal，默认保留 30 天 */
    await this.run(results, "agent_playground_mission_events", dryRun, () => {
      const where = {
        createdAt: {
          lt: this.cutoff(this.days("RETENTION_MISSION_EVENTS_DAYS", 30)),
        },
      };
      return dryRun
        ? this.prisma.agentPlaygroundMissionEvent.count({ where })
        : this.prisma.agentPlaygroundMissionEvent
            .deleteMany({ where })
            .then((r) => r.count);
    });

    /* 4. ai_engine_metrics —— 观测指标，默认保留 30 天（billing 走 credit 表不受影响） */
    await this.run(results, "ai_engine_metrics", dryRun, () => {
      const where = {
        createdAt: { lt: this.cutoff(this.days("RETENTION_METRICS_DAYS", 30)) },
      };
      return dryRun
        ? this.prisma.aIEngineMetric.count({ where })
        : this.prisma.aIEngineMetric.deleteMany({ where }).then((r) => r.count);
    });

    /* 5. secret_access_logs —— 安全审计日志，默认保留 90 天（合规要求最长） */
    await this.run(results, "secret_access_logs", dryRun, () => {
      const where = {
        timestamp: {
          lt: this.cutoff(this.days("RETENTION_SECRET_LOGS_DAYS", 90)),
        },
      };
      return dryRun
        ? this.prisma.secretAccessLog.count({ where })
        : this.prisma.secretAccessLog
            .deleteMany({ where })
            .then((r) => r.count);
    });

    this.logger.log(
      `[data-retention] sweep done: ${results.join("; ") || "nothing to do"}`,
    );
  }

  /** 单表清理隔离执行 —— 一张表失败不阻塞其余表 */
  private async run(
    results: string[],
    table: string,
    dryRun: boolean,
    fn: () => Promise<number>,
  ): Promise<void> {
    try {
      const count = await fn();
      results.push(`${table}=${count}${dryRun ? "(dry)" : ""}`);
    } catch (err) {
      this.logger.error(
        `[data-retention] ${table} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      results.push(`${table}=ERROR`);
    }
  }
}

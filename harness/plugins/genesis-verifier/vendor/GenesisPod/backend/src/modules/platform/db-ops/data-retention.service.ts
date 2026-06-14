/**
 * DataRetentionService — 数据保留策略服务
 *
 * 定期清理过期的运营日志、活动记录、临时数据，
 * 防止数据库无限增长。每天凌晨 3:00 UTC 执行。
 *
 * 保留策略：
 * - ai_engine_metrics:           30 天
 * - research_agent_activities:   30 天
 * - ai_usage_logs:               30 天
 * - process_events:              14 天
 * - secret_access_logs:          30 天
 * - mission_logs:                30 天
 * - leader_decisions:            30 天
 * - credit_transactions:         90 天
 * - research_tasks (FAILED):     30 天后清空 result JSON
 * - research_tasks (COMPLETED):  60 天后清空 result JSON（保留 result_summary）
 * - child_embeddings (orphan):   立即清理
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  DATA_RETENTION_RULES,
  DataRetentionRule,
} from "./policies/data-retention-rule.catalog";

@Injectable()
export class DataRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DataRetentionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // 启动后延迟 5 分钟执行首次清理，之后每 24 小时执行一次
    const DELAY_MS = 5 * 60 * 1000;
    const INTERVAL_MS = 24 * 60 * 60 * 1000;

    setTimeout(() => {
      void this.runRetention();
      this.timer = setInterval(() => void this.runRetention(), INTERVAL_MS);
    }, DELAY_MS);

    this.logger.log(
      `[DataRetention] Scheduled: first run in 5min, then every 24h`,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 执行所有保留策略规则
   */
  async runRetention(): Promise<{ table: string; affected: number }[]> {
    this.logger.log("[DataRetention] Starting retention cleanup...");
    const results: { table: string; affected: number }[] = [];
    const startTime = Date.now();

    for (const rule of DATA_RETENTION_RULES) {
      try {
        const affected = await this.applyRule(rule);
        results.push({ table: rule.table, affected });
        if (affected > 0) {
          this.logger.log(
            `[DataRetention] ${rule.description}: ${affected} rows ${rule.action === "delete" ? "deleted" : "updated"} (${rule.table}, >${rule.retentionDays}d)`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `[DataRetention] Failed on ${rule.table}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 清理孤儿 child_embeddings
    try {
      const orphanResult = await this.prisma.$executeRawUnsafe(`
        DELETE FROM child_embeddings ce
        WHERE NOT EXISTS (SELECT 1 FROM child_chunks cc WHERE cc.id = ce.child_chunk_id)
      `);
      if (orphanResult > 0) {
        results.push({
          table: "child_embeddings (orphans)",
          affected: orphanResult,
        });
        this.logger.log(
          `[DataRetention] Orphan child_embeddings: ${orphanResult} deleted`,
        );
      }
    } catch {
      // ignore
    }

    const elapsed = Date.now() - startTime;
    const totalAffected = results.reduce((sum, r) => sum + r.affected, 0);
    this.logger.log(
      `[DataRetention] Completed in ${elapsed}ms — ${totalAffected} total rows cleaned`,
    );

    return results;
  }

  private async applyRule(rule: DataRetentionRule): Promise<number> {
    const whereClause = [
      `"${rule.timestampColumn}" < NOW() - INTERVAL '${rule.retentionDays} days'`,
      rule.extraWhere,
    ]
      .filter(Boolean)
      .join(" AND ");

    if (rule.action === "delete") {
      return this.prisma.$executeRawUnsafe(
        `DELETE FROM "${rule.table}" WHERE ${whereClause}`,
      );
    }

    return this.prisma.$executeRawUnsafe(
      `UPDATE "${rule.table}" SET ${rule.updateSet} WHERE ${whereClause}`,
    );
  }
}

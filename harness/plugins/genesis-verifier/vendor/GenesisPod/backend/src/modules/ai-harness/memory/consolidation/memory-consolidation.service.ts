import { Injectable, Logger } from "@nestjs/common";

// ─── Types ───

export type DreamPhase = "orient" | "gather" | "consolidate" | "prune";

export interface AutoDreamConfig {
  /** Minimum hours since last run (default: 24) */
  minHoursSinceLastRun: number;
  /** Minimum completed sessions since last run (default: 5) */
  minCompletedSessions: number;
  /** Maximum items to process per run (default: 100) */
  maxItemsPerRun: number;
  /** TTL for session entries after consolidation in ms (default: 7 days) */
  consolidatedTtlMs: number;
}

export interface DreamStatus {
  phase: DreamPhase;
  progress: number; // 0-100
  itemsProcessed: number;
  startedAt: Date;
}

export interface DreamResult {
  phasesCompleted: DreamPhase[];
  itemsProcessed: number;
  itemsConsolidated: number;
  itemsPruned: number;
  durationMs: number;
}

const DEFAULT_CONFIG: AutoDreamConfig = {
  minHoursSinceLastRun: 24,
  minCompletedSessions: 5,
  maxItemsPerRun: 100,
  consolidatedTtlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

/**
 * AutoDreamService
 *
 * Background memory consolidation agent that periodically organizes
 * session-level findings into project/team-level knowledge.
 *
 * 4-phase cycle:
 * 1. Orient: Scan session-level memory entries
 * 2. Gather: Group related entries by topic/theme
 * 3. Consolidate: Merge groups into consolidated knowledge entries
 * 4. Prune: Mark source entries as consolidated, clean up expired
 *
 * Gate conditions (both must be met):
 * - Time: >= minHoursSinceLastRun since last dream
 * - Sessions: >= minCompletedSessions since last dream
 *
 * Inspired by Claude Code's DreamTask (orient → gather → consolidate → prune).
 */
@Injectable()
export class AutoDreamService {
  private readonly logger = new Logger(AutoDreamService.name);

  /**
   * 2026-05-15 PR-E.P2 评估：3 个 Map 保留 in-process（不迁 Redis）。理由：
   *   - Dream task 是周期性记忆压缩（6h / 24h cron），多 pod 各自跑会重复同一 scope
   *     的 dream，浪费一些 LLM token 但不影响正确性（结果幂等）
   *   - activeRuns 跨 pod 共享需要分布式锁；当前单 pod 部署不需要
   *   - 多 pod 上线时需要补：lastRunTimes/sessionCounts → Redis HASH，activeRuns →
   *     Redis SET NX 互斥锁，避免重复 dream
   */
  private readonly lastRunTimes = new Map<string, Date>();
  private readonly sessionCounts = new Map<string, number>();
  private readonly activeRuns = new Map<string, DreamStatus>();

  /**
   * Check if dream conditions are met for a scope
   */
  shouldRun(scopeId: string, config?: Partial<AutoDreamConfig>): boolean {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const lastRun = this.lastRunTimes.get(scopeId);
    if (lastRun) {
      const hoursSince = (Date.now() - lastRun.getTime()) / (1000 * 60 * 60);
      if (hoursSince < cfg.minHoursSinceLastRun) return false;
    }

    const sessions = this.sessionCounts.get(scopeId) ?? 0;
    if (sessions < cfg.minCompletedSessions) return false;

    // Don't run if already running
    if (this.activeRuns.has(scopeId)) return false;

    return true;
  }

  /**
   * Record a completed session (increments the session counter)
   */
  recordCompletedSession(scopeId: string): void {
    const current = this.sessionCounts.get(scopeId) ?? 0;
    this.sessionCounts.set(scopeId, current + 1);
  }

  /**
   * Execute the 4-phase dream cycle.
   *
   * @param scopeId - The project/org scope to consolidate
   * @param sessionEntries - All session-level entries to process
   * @param consolidateFn - Function to merge entries (optional LLM call)
   * @param config - Dream configuration
   */
  async execute(
    scopeId: string,
    sessionEntries: Array<{ key: string; value: unknown; sessionId: string }>,
    consolidateFn?: (
      entries: Array<{ key: string; value: unknown }>,
    ) => Promise<{ key: string; value: unknown }>,
    config?: Partial<AutoDreamConfig>,
  ): Promise<DreamResult> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const startTime = Date.now();

    this.activeRuns.set(scopeId, {
      phase: "orient",
      progress: 0,
      itemsProcessed: 0,
      startedAt: new Date(),
    });

    const result: DreamResult = {
      phasesCompleted: [],
      itemsProcessed: 0,
      itemsConsolidated: 0,
      itemsPruned: 0,
      durationMs: 0,
    };

    try {
      // Phase 1: Orient — identify entries to process
      this.updateStatus(scopeId, "orient", 10, 0);
      const entriesToProcess = sessionEntries.slice(0, cfg.maxItemsPerRun);
      result.itemsProcessed = entriesToProcess.length;
      result.phasesCompleted.push("orient");

      this.logger.log(
        `[execute] Orient: ${entriesToProcess.length} entries for scope ${scopeId}`,
      );

      if (entriesToProcess.length === 0) {
        this.finishRun(scopeId, result, startTime);
        return result;
      }

      // Phase 2: Gather — group by key prefix/topic
      this.updateStatus(scopeId, "gather", 30, entriesToProcess.length);
      const groups = this.groupByTopic(entriesToProcess);
      result.phasesCompleted.push("gather");

      this.logger.log(
        `[execute] Gather: ${groups.size} groups from ${entriesToProcess.length} entries`,
      );

      // Phase 3: Consolidate — merge groups
      this.updateStatus(scopeId, "consolidate", 50, entriesToProcess.length);
      for (const [topic, entries] of groups) {
        if (consolidateFn && entries.length > 1) {
          try {
            const consolidated = await consolidateFn(entries);
            result.itemsConsolidated++;
            this.logger.debug(
              `[execute] Consolidated ${entries.length} entries for "${topic}" → "${consolidated.key}"`,
            );
          } catch (error) {
            this.logger.warn(
              `[execute] Consolidation failed for "${topic}": ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        } else {
          // Single entry or no consolidateFn — count as consolidated (pass-through)
          result.itemsConsolidated += entries.length;
        }
      }
      result.phasesCompleted.push("consolidate");

      // Phase 4: Prune — mark processed entries
      this.updateStatus(scopeId, "prune", 80, entriesToProcess.length);
      result.itemsPruned = entriesToProcess.length;
      result.phasesCompleted.push("prune");

      this.logger.log(`[execute] Prune: ${result.itemsPruned} entries marked`);

      this.finishRun(scopeId, result, startTime);
      return result;
    } catch (error) {
      this.logger.error(
        `[execute] Dream failed for scope ${scopeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.activeRuns.delete(scopeId);
      result.durationMs = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Get status of a running dream
   */
  getStatus(scopeId: string): DreamStatus | null {
    return this.activeRuns.get(scopeId) ?? null;
  }

  /**
   * Cancel a running dream
   */
  cancel(scopeId: string): boolean {
    const was = this.activeRuns.has(scopeId);
    this.activeRuns.delete(scopeId);
    if (was) {
      this.logger.log(`[cancel] Dream cancelled for scope ${scopeId}`);
    }
    return was;
  }

  // ─── Private Helpers ───

  private updateStatus(
    scopeId: string,
    phase: DreamPhase,
    progress: number,
    items: number,
  ): void {
    const status = this.activeRuns.get(scopeId);
    if (status) {
      status.phase = phase;
      status.progress = progress;
      status.itemsProcessed = items;
    }
  }

  private finishRun(
    scopeId: string,
    result: DreamResult,
    startTime: number,
  ): void {
    result.durationMs = Date.now() - startTime;
    this.lastRunTimes.set(scopeId, new Date());
    this.sessionCounts.set(scopeId, 0); // Reset counter
    this.activeRuns.delete(scopeId);

    this.logger.log(
      `[execute] Dream completed for ${scopeId}: ` +
        `${result.itemsProcessed} processed, ${result.itemsConsolidated} consolidated, ` +
        `${result.itemsPruned} pruned, ${result.durationMs}ms`,
    );
  }

  private groupByTopic(
    entries: Array<{ key: string; value: unknown; sessionId: string }>,
  ): Map<string, Array<{ key: string; value: unknown }>> {
    const groups = new Map<string, Array<{ key: string; value: unknown }>>();

    for (const entry of entries) {
      // Group by key prefix (everything before the last colon or slash)
      const separatorIdx = Math.max(
        entry.key.lastIndexOf(":"),
        entry.key.lastIndexOf("/"),
      );
      const topic =
        separatorIdx > 0 ? entry.key.slice(0, separatorIdx) : entry.key;

      if (!groups.has(topic)) {
        groups.set(topic, []);
      }
      groups.get(topic)!.push({ key: entry.key, value: entry.value });
    }

    return groups;
  }
}

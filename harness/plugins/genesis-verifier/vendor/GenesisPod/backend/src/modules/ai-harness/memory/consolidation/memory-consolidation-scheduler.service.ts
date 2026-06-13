import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  AutoDreamService,
  AutoDreamConfig,
  DreamResult,
} from "./memory-consolidation.service";

export interface SchedulerConfig {
  /** How often to check if a scope is eligible to dream, in ms (default: 60 min) */
  pollIntervalMs: number;
  /** Dream config forwarded to AutoDreamService.execute() */
  dreamConfig?: Partial<AutoDreamConfig>;
}

export interface ScheduledScope {
  scopeId: string;
  /** Supplier that yields current session entries when called */
  getEntries: () => Promise<
    Array<{ key: string; value: unknown; sessionId: string }>
  >;
  /** Optional consolidation function forwarded to AutoDreamService */
  consolidateFn?: (
    entries: Array<{ key: string; value: unknown }>,
  ) => Promise<{ key: string; value: unknown }>;
}

export interface SchedulerStats {
  registeredScopes: number;
  totalRunsTriggered: number;
  lastCheckAt: Date | null;
}

const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  pollIntervalMs: 60 * 60 * 1000, // 60 minutes
};

/**
 * AutoDreamSchedulerService
 *
 * Manages periodic background execution of AutoDreamService across
 * multiple project/org scopes.
 *
 * Responsibilities:
 * - Register/deregister scopes for automated consolidation
 * - Poll each scope on a configurable interval
 * - Delegate gate checks and execution to AutoDreamService
 * - Accumulate basic run statistics
 *
 * The scheduler owns the setInterval timer and cleans it up on module destroy.
 */
@Injectable()
export class AutoDreamSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AutoDreamSchedulerService.name);

  private readonly scopes = new Map<string, ScheduledScope>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stats: SchedulerStats = {
    registeredScopes: 0,
    totalRunsTriggered: 0,
    lastCheckAt: null,
  };

  constructor(private readonly autoDreamService: AutoDreamService) {}

  /**
   * Auto-start the scheduler on module initialization.
   * Uses the default poll interval (60 minutes).
   *
   * ★ 2026-05-25 默认关闭：latent LLM 调用（BYOK 烧钱风险）。
   *   Set ENABLE_MEMORY_CONSOLIDATION=true to opt in.
   */
  onModuleInit(): void {
    if (process.env.ENABLE_MEMORY_CONSOLIDATION !== "true") {
      this.logger.warn(
        "[AutoDreamScheduler] background memory consolidation DISABLED (default) — " +
          "set ENABLE_MEMORY_CONSOLIDATION=true to opt in",
      );
      return;
    }
    this.start();
    this.logger.log("[onModuleInit] AutoDream scheduler started automatically");
  }

  // ─── Lifecycle ───

  /**
   * Start the background polling loop.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(config?: Partial<SchedulerConfig>): void {
    if (this.pollTimer !== null) {
      this.logger.warn("[start] Scheduler is already running, ignoring");
      return;
    }

    const cfg = { ...DEFAULT_SCHEDULER_CONFIG, ...config };

    this.logger.log(
      `[start] Starting scheduler, poll interval: ${cfg.pollIntervalMs}ms`,
    );

    this.pollTimer = setInterval(() => {
      void this.tick(cfg.dreamConfig);
    }, cfg.pollIntervalMs);
  }

  /**
   * Stop the background polling loop.
   */
  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.log("[stop] Scheduler stopped");
    }
  }

  onModuleDestroy(): void {
    this.stop();
  }

  // ─── Scope Registration ───

  /**
   * Register a scope for automated consolidation.
   * If the scope was already registered it will be replaced.
   */
  register(scope: ScheduledScope): void {
    this.scopes.set(scope.scopeId, scope);
    this.stats.registeredScopes = this.scopes.size;
    this.logger.log(`[register] Scope registered: ${scope.scopeId}`);
  }

  /**
   * Remove a scope from automated consolidation.
   */
  deregister(scopeId: string): void {
    const removed = this.scopes.delete(scopeId);
    this.stats.registeredScopes = this.scopes.size;
    if (removed) {
      this.logger.log(`[deregister] Scope removed: ${scopeId}`);
    }
  }

  /**
   * Notify the scheduler that a session completed in a scope.
   * Delegates to AutoDreamService.recordCompletedSession().
   *
   * ★ F5 Fix: Auto-register the scope if not already registered so that
   * tick() can iterate it and AutoDream actually fires.
   */
  notifySessionCompleted(scopeId: string): void {
    this.autoDreamService.recordCompletedSession(scopeId);

    // Auto-register scope if not already registered so tick() has something to iterate
    if (!this.scopes.has(scopeId)) {
      this.register({
        scopeId,
        getEntries: async () => [], // Default: empty entries (callers can override via register())
      });
    }

    this.logger.debug(
      `[notifySessionCompleted] Session recorded for ${scopeId}`,
    );
  }

  // ─── Manual Trigger ───

  /**
   * Immediately trigger the dream cycle for a specific scope,
   * bypassing gate checks (useful for testing / admin triggers).
   */
  async triggerNow(
    scopeId: string,
    dreamConfig?: Partial<AutoDreamConfig>,
  ): Promise<DreamResult | null> {
    const scope = this.scopes.get(scopeId);
    if (!scope) {
      this.logger.warn(`[triggerNow] Unknown scope: ${scopeId}`);
      return null;
    }

    return this.runScope(scope, dreamConfig);
  }

  // ─── Stats ───

  getStats(): Readonly<SchedulerStats> {
    return { ...this.stats };
  }

  // ─── Private ───

  private async tick(dreamConfig?: Partial<AutoDreamConfig>): Promise<void> {
    this.stats.lastCheckAt = new Date();
    this.logger.debug(
      `[tick] Checking ${this.scopes.size} scopes at ${this.stats.lastCheckAt.toISOString()}`,
    );

    for (const scope of this.scopes.values()) {
      if (this.autoDreamService.shouldRun(scope.scopeId, dreamConfig)) {
        this.stats.totalRunsTriggered++;
        this.logger.log(
          `[tick] Gate passed for scope ${scope.scopeId}, triggering dream`,
        );

        // Fire-and-forget: each scope runs independently
        void this.runScope(scope, dreamConfig).catch((error: unknown) => {
          this.logger.error(
            `[tick] Unhandled error for scope ${scope.scopeId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }
  }

  private async runScope(
    scope: ScheduledScope,
    dreamConfig?: Partial<AutoDreamConfig>,
  ): Promise<DreamResult> {
    let entries: Array<{ key: string; value: unknown; sessionId: string }>;

    try {
      entries = await scope.getEntries();
    } catch (error) {
      this.logger.error(
        `[runScope] Failed to fetch entries for ${scope.scopeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        phasesCompleted: [],
        itemsProcessed: 0,
        itemsConsolidated: 0,
        itemsPruned: 0,
        durationMs: 0,
      };
    }

    return this.autoDreamService.execute(
      scope.scopeId,
      entries,
      scope.consolidateFn,
      dreamConfig,
    );
  }
}

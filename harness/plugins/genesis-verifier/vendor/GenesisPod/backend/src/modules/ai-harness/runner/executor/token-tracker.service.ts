import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";

/**
 * Token usage snapshot for a tracking session
 */
export interface TokenUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  callCount: number;
}

/**
 * Token usage from a single LLM response
 */
export interface TokenUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  model?: string;
}

/**
 * Internal session data with TTL tracking (not exposed via public interface)
 */
interface SessionInternal extends TokenUsageSnapshot {
  _createdAt: number;
}

/**
 * TokenTrackerService - tracks actual API-reported token usage per session
 *
 * Replaces character-based estimation with real provider-reported token counts.
 * Each "session" is a logical unit (e.g., one query loop execution, one section write).
 */
@Injectable()
export class TokenTrackerService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenTrackerService.name);
  private readonly sessions = new Map<string, SessionInternal>();
  private readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Cleanup stale sessions every 5 minutes
    this.cleanupTimer = setInterval(
      () => {
        const expiry = Date.now() - this.SESSION_TTL_MS;
        for (const [id, session] of this.sessions) {
          if (session._createdAt < expiry) {
            this.logger.warn(`[cleanup] Evicting stale session: ${id}`);
            this.sessions.delete(id);
          }
        }
      },
      5 * 60 * 1000,
    );
    this.cleanupTimer.unref(); // Don't prevent Node.js process from exiting
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  /**
   * Create a new tracking session
   */
  createSession(sessionId: string): void {
    this.sessions.set(sessionId, {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      callCount: 0,
      _createdAt: Date.now(),
    });
  }

  /**
   * Record token usage from an LLM response
   */
  recordUsage(sessionId: string, usage: TokenUsageEntry): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(
        `[recordUsage] Session ${sessionId} not found, creating`,
      );
      this.createSession(sessionId);
      this.recordUsage(sessionId, usage);
      return;
    }

    session.inputTokens += usage.inputTokens;
    session.outputTokens += usage.outputTokens;
    session.cacheCreationTokens += usage.cacheCreationTokens ?? 0;
    session.cacheReadTokens += usage.cacheReadTokens ?? 0;
    session.totalTokens += usage.inputTokens + usage.outputTokens;
    session.callCount += 1;

    this.logger.debug(
      `[recordUsage] Session ${sessionId}: call #${session.callCount}, ` +
        `+${usage.inputTokens}in/${usage.outputTokens}out, ` +
        `total=${session.totalTokens}`,
    );
  }

  /**
   * Get current usage snapshot for a session
   */
  getUsage(sessionId: string): TokenUsageSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    // Exclude the internal _createdAt field from the public snapshot
    const { _createdAt: _, ...snapshot } = session;
    return snapshot;
  }

  /**
   * Check if a session has exceeded a token budget
   */
  isOverBudget(sessionId: string, budgetLimit: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.totalTokens >= budgetLimit;
  }

  /**
   * Get remaining budget for a session
   */
  getRemainingBudget(sessionId: string, budgetLimit: number): number {
    const session = this.sessions.get(sessionId);
    if (!session) return budgetLimit;
    return Math.max(0, budgetLimit - session.totalTokens);
  }

  /**
   * Clean up a completed session
   */
  endSession(sessionId: string): TokenUsageSnapshot | null {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (!session) return null;
    // Exclude the internal _createdAt field from the public snapshot
    const { _createdAt: _, ...snapshot } = session;
    return snapshot;
  }
}

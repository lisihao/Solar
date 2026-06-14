import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";

// ─── Types ───

export interface PersistedMessage {
  id: string;
  sessionId: string;
  fromAgentId: string;
  toAgentId: string;
  type: string;
  priority: "low" | "normal" | "high";
  payload: unknown;
  correlationId?: string;
  deliveredAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
}

/**
 * MessagePersistenceService
 *
 * In-memory dead-letter queue for inter-agent messages.
 * When a message is published to an offline agent, it's stored here
 * until the agent comes back online and retrieves it.
 *
 * Key behaviors:
 * - persist(): store a message for later delivery
 * - loadPending(): get all undelivered messages for an agent
 * - markDelivered(): mark a message as delivered
 * - cleanup(): remove expired messages
 */
@Injectable()
export class MessagePersistenceService implements OnModuleDestroy {
  private readonly logger = new Logger(MessagePersistenceService.name);
  private readonly messages = new Map<string, PersistedMessage>();
  private idCounter = 0;

  // ★ F7 Fix: Periodic cleanup timer to remove delivered/expired messages
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Cleanup delivered + expired messages every 10 minutes
    this.cleanupTimer = setInterval(
      () => {
        this.cleanup();
      },
      10 * 60 * 1000,
    );
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  persist(
    sessionId: string,
    fromAgentId: string,
    toAgentId: string,
    type: string,
    payload: unknown,
    options?: {
      priority?: "low" | "normal" | "high";
      correlationId?: string;
      ttlMs?: number;
    },
  ): string {
    const id = `msg-${Date.now()}-${++this.idCounter}`;
    const msg: PersistedMessage = {
      id,
      sessionId,
      fromAgentId,
      toAgentId,
      type,
      priority: options?.priority ?? "normal",
      payload,
      correlationId: options?.correlationId,
      expiresAt: options?.ttlMs
        ? new Date(Date.now() + options.ttlMs)
        : undefined,
      createdAt: new Date(),
    };
    this.messages.set(id, msg);
    this.logger.debug(
      `[persist] ${id}: ${fromAgentId} → ${toAgentId} (${type})`,
    );
    return id;
  }

  loadPending(sessionId: string, agentId: string): PersistedMessage[] {
    const now = new Date();
    const pending: PersistedMessage[] = [];
    for (const msg of this.messages.values()) {
      if (msg.sessionId !== sessionId || msg.toAgentId !== agentId) continue;
      if (msg.deliveredAt) continue;
      if (msg.expiresAt && msg.expiresAt < now) continue;
      pending.push(msg);
    }
    // Sort by priority (high first) then by creation time
    const priorityOrder: Record<"low" | "normal" | "high", number> = {
      high: 0,
      normal: 1,
      low: 2,
    };
    pending.sort((a, b) => {
      const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pd !== 0) return pd;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return pending;
  }

  markDelivered(messageId: string): boolean {
    const msg = this.messages.get(messageId);
    if (!msg || msg.deliveredAt) return false;
    msg.deliveredAt = new Date();
    return true;
  }

  cleanup(olderThan?: Date): number {
    const threshold = olderThan ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // default 24h
    let cleaned = 0;
    const now = new Date();
    for (const [id, msg] of this.messages) {
      if (msg.deliveredAt && msg.deliveredAt < threshold) {
        this.messages.delete(id);
        cleaned++;
      } else if (msg.expiresAt && msg.expiresAt < now) {
        this.messages.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.debug(`[cleanup] Removed ${cleaned} messages`);
    }
    return cleaned;
  }

  getPendingCount(sessionId: string, agentId: string): number {
    return this.loadPending(sessionId, agentId).length;
  }
}

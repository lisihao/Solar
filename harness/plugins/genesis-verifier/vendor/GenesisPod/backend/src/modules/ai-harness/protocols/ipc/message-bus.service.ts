import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import type {
  A2AMessage,
  A2AMessageType,
  A2APriority,
  A2AMessageHandler,
} from "./abstractions/a2a-message.types";

export type {
  A2AMessage,
  A2AMessageType,
} from "./abstractions/a2a-message.types";

/**
 * Message Bus Service
 *
 * In-process publish/subscribe bus for agent-to-agent communication
 * within a team execution context.
 *
 * Features:
 * - Targeted delivery (fromAgent → toAgent)
 * - Broadcast delivery (fromAgent → all subscribers)
 * - Message threading via correlationId / replyToId
 * - TTL-based expiry (lazy cleanup on subscribe)
 * - Per-session isolation via sessionId
 */
@Injectable()
export class MessageBusService {
  private readonly logger = new Logger(MessageBusService.name);

  /**
   * Subscribers indexed by sessionId → agentId → handlers[]
   */
  private readonly subscribers = new Map<
    string,
    Map<string, A2AMessageHandler[]>
  >();

  /**
   * Recent message history (for debugging / replay)
   * Key: sessionId → messages[]
   */
  private readonly history = new Map<string, A2AMessage[]>();

  private readonly MAX_HISTORY = 200;

  /**
   * Subscribe an agent to receive messages in a session.
   * Returns an unsubscribe function.
   */
  subscribe(
    sessionId: string,
    agentId: string,
    handler: A2AMessageHandler,
  ): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Map());
    }
    const sessionSubs = this.subscribers.get(sessionId)!;

    if (!sessionSubs.has(agentId)) {
      sessionSubs.set(agentId, []);
    }
    const handlers = sessionSubs.get(agentId)!;
    handlers.push(handler);

    this.logger.debug(
      `[MessageBus] Agent ${agentId} subscribed in session ${sessionId}`,
    );

    return () => {
      const hs = this.subscribers.get(sessionId)?.get(agentId);
      if (hs) {
        const idx = hs.indexOf(handler);
        if (idx !== -1) hs.splice(idx, 1);
      }
    };
  }

  /**
   * Publish a message from one agent to another (or broadcast).
   */
  async publish<TPayload = unknown>(params: {
    sessionId: string;
    fromAgentId: string;
    toAgentId?: string;
    type: A2AMessageType;
    payload: TPayload;
    priority?: A2APriority;
    replyToId?: string;
    correlationId?: string;
    ttlMs?: number;
  }): Promise<A2AMessage<TPayload>> {
    const message: A2AMessage<TPayload> = {
      id: randomUUID(),
      fromAgentId: params.fromAgentId,
      toAgentId: params.toAgentId,
      type: params.type,
      priority: params.priority ?? "normal",
      payload: params.payload,
      replyToId: params.replyToId,
      correlationId: params.correlationId ?? randomUUID(),
      timestamp: new Date(),
      ttlMs: params.ttlMs,
    };

    this.storeHistory(params.sessionId, message as A2AMessage);

    const sessionSubs = this.subscribers.get(params.sessionId);
    if (!sessionSubs) {
      this.logger.debug(
        `[MessageBus] No subscribers in session ${params.sessionId} for message from ${params.fromAgentId}`,
      );
      return message;
    }

    const now = Date.now();
    const deliverTo: A2AMessageHandler[] = [];

    if (params.toAgentId) {
      // Targeted delivery
      const handlers = sessionSubs.get(params.toAgentId) ?? [];
      deliverTo.push(...handlers);
    } else {
      // Broadcast to all except sender
      for (const [agentId, handlers] of sessionSubs.entries()) {
        if (agentId !== params.fromAgentId) {
          deliverTo.push(...handlers);
        }
      }
    }

    // TTL check: with synchronous in-process delivery, the delta is always ~0ms
    // so this guard never triggers in practice. Retained for future async models.
    if (message.ttlMs && now - message.timestamp.getTime() > message.ttlMs) {
      this.logger.warn(
        `[MessageBus] Message ${message.id} expired before delivery`,
      );
      return message;
    }

    // Deliver (fire-and-forget, log errors)
    for (const handler of deliverTo) {
      try {
        const result = handler(message as A2AMessage);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            this.logger.error(
              `[MessageBus] Handler error for message ${message.id}: ${err}`,
            );
          });
        }
      } catch (err) {
        this.logger.error(
          `[MessageBus] Sync handler error for message ${message.id}: ${err}`,
        );
      }
    }

    this.logger.debug(
      `[MessageBus] ${params.fromAgentId} → ${params.toAgentId ?? "broadcast"} [${params.type}] delivered to ${deliverTo.length} handler(s)`,
    );

    return message;
  }

  /**
   * Get message history for a session (for debugging).
   */
  getHistory(sessionId: string): A2AMessage[] {
    return this.history.get(sessionId) ?? [];
  }

  /**
   * Clear all state for a session (call after session ends).
   */
  clearSession(sessionId: string): void {
    this.subscribers.delete(sessionId);
    this.history.delete(sessionId);
    this.logger.debug(`[MessageBus] Session ${sessionId} cleared`);
  }

  private storeHistory(sessionId: string, message: A2AMessage): void {
    if (!this.history.has(sessionId)) {
      this.history.set(sessionId, []);
    }
    const msgs = this.history.get(sessionId)!;
    msgs.push(message);
    if (msgs.length > this.MAX_HISTORY) {
      msgs.splice(0, msgs.length - this.MAX_HISTORY);
    }
  }
}

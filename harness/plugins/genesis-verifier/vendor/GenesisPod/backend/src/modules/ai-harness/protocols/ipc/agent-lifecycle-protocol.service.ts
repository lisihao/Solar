import { Injectable, Logger, Optional } from "@nestjs/common";
import { MessagePersistenceService } from "./message-persistence.service";

// ─── Types ───

export type LifecycleMessageType =
  | "shutdown_request"
  | "shutdown_ack"
  | "plan_approval"
  | "plan_rejection"
  | "task_notification"
  | "heartbeat"
  | "resume_request";

export interface ShutdownRequestPayload {
  reason: string;
  gracePeriodMs: number;
}

export interface PlanApprovalPayload {
  planId: string;
  approved: boolean;
  feedback?: string;
}

export interface TaskNotificationPayload {
  taskId: string;
  status: "completed" | "failed" | "cancelled";
  summary: string;
  result?: unknown;
  tokensUsed?: number;
  durationMs?: number;
}

/**
 * AgentLifecycleProtocolService
 *
 * Structured lifecycle communication between agents.
 * Supports shutdown negotiation, plan approval, task completion notification,
 * and heartbeat monitoring.
 *
 * All messages are persisted via MessagePersistenceService for reliability.
 */
@Injectable()
export class AgentLifecycleProtocolService {
  private readonly logger = new Logger(AgentLifecycleProtocolService.name);

  constructor(
    @Optional() private readonly persistence?: MessagePersistenceService,
  ) {}

  requestShutdown(
    sessionId: string,
    fromAgent: string,
    toAgent: string,
    payload: ShutdownRequestPayload,
  ): string | null {
    if (!this.persistence) {
      this.logger.warn(
        "[requestShutdown] MessagePersistenceService not available",
      );
      return null;
    }
    return this.persistence.persist(
      sessionId,
      fromAgent,
      toAgent,
      "shutdown_request",
      payload,
      { priority: "high" },
    );
  }

  acknowledgeShutdown(
    sessionId: string,
    fromAgent: string,
    toAgent: string,
    accepted: boolean,
  ): string | null {
    if (!this.persistence) return null;
    return this.persistence.persist(
      sessionId,
      fromAgent,
      toAgent,
      "shutdown_ack",
      { accepted },
      { priority: "high" },
    );
  }

  submitPlanForApproval(
    sessionId: string,
    fromAgent: string,
    toAgent: string,
    planId: string,
    plan: unknown,
  ): string | null {
    if (!this.persistence) return null;
    return this.persistence.persist(
      sessionId,
      fromAgent,
      toAgent,
      "plan_approval",
      { planId, plan },
      { priority: "normal" },
    );
  }

  respondToPlan(
    sessionId: string,
    fromAgent: string,
    toAgent: string,
    payload: PlanApprovalPayload,
  ): string | null {
    if (!this.persistence) return null;
    const type = payload.approved ? "plan_approval" : "plan_rejection";
    return this.persistence.persist(
      sessionId,
      fromAgent,
      toAgent,
      type,
      payload,
      { priority: "normal" },
    );
  }

  notifyTaskComplete(
    sessionId: string,
    fromAgent: string,
    toAgent: string,
    payload: TaskNotificationPayload,
  ): string | null {
    if (!this.persistence) return null;
    const id = this.persistence.persist(
      sessionId,
      fromAgent,
      toAgent,
      "task_notification",
      payload,
      { priority: "normal" },
    );
    // ★ F7 Fix: Observability hook — log if the target agent has pending messages and should be resumed
    const shouldResume = this.checkAndResume(sessionId, toAgent);
    if (shouldResume) {
      this.logger.log(
        `[notifyTaskComplete] Agent ${toAgent} has pending messages, should be resumed`,
      );
    }
    return id;
  }

  sendHeartbeat(sessionId: string, agentId: string): string | null {
    if (!this.persistence) return null;
    // Heartbeats are broadcast (no specific toAgent)
    return this.persistence.persist(
      sessionId,
      agentId,
      "*",
      "heartbeat",
      { timestamp: new Date().toISOString() },
      { priority: "low", ttlMs: 60 * 1000 }, // 1 min TTL
    );
  }

  /**
   * Check if an agent has pending messages and should be resumed.
   */
  checkAndResume(sessionId: string, agentId: string): boolean {
    if (!this.persistence) return false;
    const pending = this.persistence.getPendingCount(sessionId, agentId);
    if (pending > 0) {
      this.logger.log(
        `[checkAndResume] Agent ${agentId} has ${pending} pending messages`,
      );
      return true;
    }
    return false;
  }
}

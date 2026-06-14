/**
 * Agent-to-Agent (A2A) Message Protocol
 *
 * Defines typed messages that agents can send to each other
 * within a team execution context.
 */

export type A2AMessageType =
  | "task_request" // Agent requests another agent to do a subtask
  | "task_result" // Agent reports result of a subtask
  | "info_share" // Agent shares information (broadcast or targeted)
  | "question" // Agent asks another agent a question
  | "answer" // Agent answers a question
  | "status_update" // Agent reports its current status
  | "handoff"; // Agent hands off execution to another agent

export type A2APriority = "low" | "normal" | "high" | "urgent";

/**
 * A2A Message envelope
 */
export interface A2AMessage<TPayload = unknown> {
  /** Unique message ID */
  id: string;
  /** Sender agent ID */
  fromAgentId: string;
  /** Target agent ID (undefined = broadcast to all) */
  toAgentId?: string;
  /** Message type */
  type: A2AMessageType;
  /** Priority */
  priority: A2APriority;
  /** Message payload */
  payload: TPayload;
  /** Reply-to message ID (for threading) */
  replyToId?: string;
  /** Correlation ID for tracking a conversation thread */
  correlationId?: string;
  /** When the message was created */
  timestamp: Date;
  /** Optional TTL in milliseconds */
  ttlMs?: number;
}

/**
 * Task request payload
 */
export interface TaskRequestPayload {
  taskId: string;
  description: string;
  context?: Record<string, unknown>;
  deadline?: Date;
}

/**
 * Task result payload
 */
export interface TaskResultPayload {
  taskId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

/**
 * Info share payload
 */
export interface InfoSharePayload {
  topic: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * A2A message handler function
 */
export type A2AMessageHandler<TPayload = unknown> = (
  message: A2AMessage<TPayload>,
) => void | Promise<void>;

/**
 * Domain Event 类型 —— 业务事件流的标准化容器
 *
 * 与 IAgentEvent 的区别：
 *   - IAgentEvent 是 Loop 通用事件（thinking/action_planned/output/...）
 *   - DomainEvent 是业务自定义类型（mission:started / dimension:research_progress / ...）
 *
 * 业务方在 EventRegistry.register({ type, schema }) 注册自己的事件类型，
 * Harness 用 EventBus.emit() 发出，IBroadcastAdapter 落地到 Socket.IO / SSE / Webhook。
 */

import type { z } from "zod";

export interface DomainEvent<TPayload = unknown> {
  /** 业务事件类型，e.g. '{app}.mission:started' */
  readonly type: string;
  /** 业务作用域：哪个 user/workspace/topic 应当收到 */
  readonly scope: {
    userId?: string;
    workspaceId?: string;
    /** 业务自定义 scope key, e.g. { topicId, missionId } */
    [key: string]: string | undefined;
  };
  /** 事件载荷（注册时由 schema 校验） */
  readonly payload: TPayload;
  /** 关联的 agent / trace */
  readonly agentId?: string;
  readonly traceId?: string;
  /** 业务幂等 key（去重） */
  readonly idempotencyKey?: string;
  readonly timestamp: number;
}

export interface DomainEventTypeSpec<TPayload = unknown> {
  /** 类型 id（必须全局唯一） */
  readonly type: string;
  /** Zod schema，校验 payload 合法性 */
  readonly schema?: z.ZodType<TPayload>;
  /** 限流：每 source（agentId）每 windowMs 内最多 N 条 */
  readonly throttle?: {
    windowMs: number;
    maxEvents: number;
  };
  /** 是否要求 ack（业务方 broadcast adapter 决定如何持久化） */
  readonly requiresAck?: boolean;
}

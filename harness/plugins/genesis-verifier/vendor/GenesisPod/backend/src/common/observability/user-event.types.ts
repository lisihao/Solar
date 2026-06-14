/**
 * 统一用户事件 —— 事件字典 + payload 类型 + status→action 映射表
 *
 * 运营看板 W1（PRD §4.1 / §4.2 / §4.6）。
 *
 * 归属 common/observability（评审定论 must-fix#2）：所有 emit 方（11 个 ai-app）与
 * UserEventListener 都能合法 import；放任一 ai-app 内部会触发"ai-app 不得跨 app import"断言。
 *
 * 与 UserActivity（前端资源浏览埋点）语义正交：UserEvent = 后端跨模块业务动作流。
 * 成本不在此处：成本唯一真源是 AIEngineMetric，故 payload 不含 tokens/costUsd。
 */

import type { EventEmitter2 } from "@nestjs/event-emitter";

/** 业务模块标识（与 user_events.module 取值集对齐）。 */
export const MODULE = {
  AI_RESEARCH: "ai-research",
  AI_TEAMS: "ai-teams",
  AI_OFFICE: "ai-office",
  AI_WRITING: "ai-writing",
  AI_ASK: "ai-ask",
  AI_IMAGE: "ai-image",
  AI_SOCIAL: "ai-social",
  TOPIC_INSIGHTS: "topic-insights",
  LIBRARY: "library",
  EXPLORE: "explore",
} as const;

export type UserEventModule = (typeof MODULE)[keyof typeof MODULE];

/** 业务动作标识（与 user_events.action 取值集对齐）。 */
export const ACTION = {
  STARTED: "started",
  COMPLETED: "completed",
  FAILED: "failed",
  SAVED: "saved",
  SHARED: "shared",
  PUBLISHED: "published",
  VIEWED: "viewed",
} as const;

export type UserEventAction = (typeof ACTION)[keyof typeof ACTION];

/**
 * 统一用户事件 payload（emit 方与 listener 共用）。
 *
 * 由 emit 方一律 `void this.events.emit('user.event', payload)` 发出（fire-and-forget）。
 * - success 三态：true=成功产出 / false=失败 / null（即 undefined 落库为 NULL）=不计入成功产出。
 * - metadata 承载 channel/source（W2 注册埋点预留）。
 */
export interface UserEventPayload {
  userId: string;
  module: UserEventModule;
  action: UserEventAction;
  resourceType?: string;
  resourceId?: string;
  /** 归一后的主题键，支撑主题运营（W2 起填充）。 */
  topicKey?: string;
  /** 三态：true / false / undefined(=null，不计入成功产出)。 */
  success?: boolean;
  metadata?: Record<string, unknown>;
  /** 事件发生时间，缺省由 listener 落库时取 now()。 */
  createdAt?: Date;
}

/** EventEmitter2 事件名（与 llm.cost.record 同范式）。 */
export const USER_EVENT_NAME = "user.event";

/**
 * 统一发射 user.event（fire-and-forget，自动判空）。
 * 各业务模块复用，避免在调用点重复写 `if (emitter) { emitter.emit(...) }` 块
 * （尤其 god-class 文件需控制净增行数）。
 */
export function emitUserEvent(
  emitter: EventEmitter2 | undefined,
  payload: UserEventPayload,
): void {
  if (!emitter || !payload.userId) return;
  emitter.emit(USER_EVENT_NAME, payload);
}

/**
 * status → action 映射表（逐模块写死真实枚举，PRD §4.2 must-fix#4）。
 *
 * 各模块业务 status 枚举互不一致，故 UserEvent 用 string 而非 enum；W2 埋点时各模块
 * 用本表把真实 status 翻译成统一 action，防脏数据 / 防分母虚高（禁止把 PENDING「已创建未跑」当 started）。
 *
 * 例外（无标准 started/completed/failed 三态的模块）见下方常量后注释。
 */
export const STATUS_TO_ACTION: Record<
  UserEventModule,
  Record<string, UserEventAction>
> = {
  // ai-research：ResearchMissionStatus（无 PENDING）。
  [MODULE.AI_RESEARCH]: {
    EXECUTING: ACTION.STARTED,
    COMPLETED: ACTION.COMPLETED,
    FAILED: ACTION.FAILED,
  },
  // ai-teams：MissionStatus（PLANNING/PENDING 不算 started，防分母虚高）。
  [MODULE.AI_TEAMS]: {
    IN_PROGRESS: ACTION.STARTED,
    COMPLETED: ACTION.COMPLETED,
    FAILED: ACTION.FAILED,
  },
  // ai-writing：WritingMissionStatus。
  [MODULE.AI_WRITING]: {
    IN_PROGRESS: ACTION.STARTED,
    COMPLETED: ACTION.COMPLETED,
    FAILED: ACTION.FAILED,
  },
  // ai-office 例外：OfficeDocumentStatus 无 FAILED → 失败率不适用（恒 0）。
  [MODULE.AI_OFFICE]: {
    GENERATING: ACTION.STARTED,
    COMPLETED: ACTION.COMPLETED,
  },
  // ai-image 例外：GeneratedImage 无 status（只 createdAt），行存在=completed；完成率/耗时不适用。
  [MODULE.AI_IMAGE]: {
    CREATED: ACTION.COMPLETED,
  },
  // ai-ask 例外：AskSession/AskMessage 无 status，钉死 AskMessage 创建=started；仅辅助活跃，不计北极星。
  [MODULE.AI_ASK]: {
    MESSAGE_CREATED: ACTION.STARTED,
  },
  // ai-social：SocialContentStatus。
  [MODULE.AI_SOCIAL]: {
    PUBLISHED: ACTION.PUBLISHED,
    FAILED: ACTION.FAILED,
  },
  // topic-insights：同 ai-research 范式（TopicReport 生成）。
  [MODULE.TOPIC_INSIGHTS]: {
    EXECUTING: ACTION.STARTED,
    COMPLETED: ACTION.COMPLETED,
    FAILED: ACTION.FAILED,
  },
  // library：Collection/Note 创建=saved（内容沉淀）。
  [MODULE.LIBRARY]: {
    CREATED: ACTION.SAVED,
  },
  // explore 例外：ActivityType（大写）大小写归一，仅辅助活跃。
  [MODULE.EXPLORE]: {
    VIEW: ACTION.VIEWED,
    SHARE: ACTION.SHARED,
  },
};

/**
 * 按模块 + 业务 status 翻译为统一 action（W2 埋点用）。
 * 命中映射返回对应 action；未命中（未知 status）返回 undefined，调用方据此跳过 emit。
 * status 大小写归一（explore 的 ActivityType 是大写，库里其余枚举也是大写）。
 */
export function resolveAction(
  module: UserEventModule,
  status: string,
): UserEventAction | undefined {
  return STATUS_TO_ACTION[module]?.[status.toUpperCase()];
}

/**
 * Feedback Events
 *
 * 反馈事件定义
 */

import type {
  TriageInput,
  TriageDecision,
  FeedbackAttachment,
} from "../triage/triage-decision.types";

// ============================================
// 事件名称
// ============================================

export enum FeedbackEvent {
  // 生命周期事件
  CREATED = "feedback.created",
  UPDATED = "feedback.updated",
  CLOSED = "feedback.closed",

  // 分诊事件
  TRIAGE_STARTED = "feedback.triage.started",
  TRIAGE_COMPLETED = "feedback.triage.completed",
  TRIAGE_FAILED = "feedback.triage.failed",

  // 修复事件
  FIX_STARTED = "feedback.fix.started",
  FIX_COMPLETED = "feedback.fix.completed",
  FIX_FAILED = "feedback.fix.failed",

  // 状态变更事件
  STATUS_CHANGED = "feedback.status.changed",
  ASSIGNED = "feedback.assigned",

  // 通知事件
  NOTIFICATION_SENT = "feedback.notification.sent",
}

// ============================================
// 事件负载类型
// ============================================

/**
 * 反馈创建事件负载
 */
export interface FeedbackCreatedPayload {
  feedbackId: string;
  type: "BUG" | "FEATURE" | "IMPROVEMENT" | "OTHER" | "ANNOTATION";
  title: string;
  description: string;
  attachments: FeedbackAttachment[];
  userId?: string;
  userEmail?: string;
  pageUrl?: string;
  userAgent?: string;
  createdAt: Date;
}

/**
 * 分诊开始事件负载
 */
export interface TriageStartedPayload {
  feedbackId: string;
  input: TriageInput;
  startedAt: Date;
}

/**
 * 分诊完成事件负载
 */
export interface TriageCompletedPayload {
  feedbackId: string;
  decision: TriageDecision;
  completedAt: Date;
}

/**
 * 分诊失败事件负载
 */
export interface TriageFailedPayload {
  feedbackId: string;
  error: string;
  failedAt: Date;
}

/**
 * 修复开始事件负载
 */
export interface FixStartedPayload {
  feedbackId: string;
  fixType: "auto" | "manual";
  approach?: string;
  startedAt: Date;
}

/**
 * 修复完成事件负载
 */
export interface FixCompletedPayload {
  feedbackId: string;
  fixType: "auto" | "manual";
  result: {
    success: boolean;
    prUrl?: string;
    issueUrl?: string;
    resolution?: string;
  };
  completedAt: Date;
}

/**
 * 修复失败事件负载
 */
export interface FixFailedPayload {
  feedbackId: string;
  fixType: "auto" | "manual";
  error: string;
  failedAt: Date;
}

/**
 * 状态变更事件负载
 */
export interface StatusChangedPayload {
  feedbackId: string;
  oldStatus: string;
  newStatus: string;
  changedBy: "system" | "admin" | "auto";
  reason?: string;
  changedAt: Date;
}

/**
 * 分配事件负载
 */
export interface AssignedPayload {
  feedbackId: string;
  assignee: string;
  assignedBy: "system" | "admin";
  assignedAt: Date;
}

/**
 * 通知发送事件负载
 */
export interface NotificationSentPayload {
  feedbackId: string;
  channel: "email" | "feishu" | "dingtalk" | "slack" | "github";
  recipient: string;
  notificationType: "created" | "status_update" | "resolved";
  sentAt: Date;
}

// ============================================
// 事件负载映射
// ============================================

export interface FeedbackEventPayloadMap {
  [FeedbackEvent.CREATED]: FeedbackCreatedPayload;
  [FeedbackEvent.UPDATED]: {
    feedbackId: string;
    changes: Record<string, unknown>;
  };
  [FeedbackEvent.CLOSED]: { feedbackId: string; reason: string };
  [FeedbackEvent.TRIAGE_STARTED]: TriageStartedPayload;
  [FeedbackEvent.TRIAGE_COMPLETED]: TriageCompletedPayload;
  [FeedbackEvent.TRIAGE_FAILED]: TriageFailedPayload;
  [FeedbackEvent.FIX_STARTED]: FixStartedPayload;
  [FeedbackEvent.FIX_COMPLETED]: FixCompletedPayload;
  [FeedbackEvent.FIX_FAILED]: FixFailedPayload;
  [FeedbackEvent.STATUS_CHANGED]: StatusChangedPayload;
  [FeedbackEvent.ASSIGNED]: AssignedPayload;
  [FeedbackEvent.NOTIFICATION_SENT]: NotificationSentPayload;
}

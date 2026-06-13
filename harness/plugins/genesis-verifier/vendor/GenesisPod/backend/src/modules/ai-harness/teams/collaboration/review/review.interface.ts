/**
 * Review Workflow Interface
 * 审查工作流抽象接口
 */

/**
 * 审查状态
 */
export type ReviewStatus =
  | "pending" // 待审查
  | "in_progress" // 审查中
  | "approved" // 已通过
  | "rejected" // 已拒绝
  | "revision_required"; // 需要修订

/**
 * 审查优先级
 */
export type ReviewPriority = "low" | "medium" | "high" | "urgent";

/**
 * 审查请求
 */
export interface ReviewRequest {
  entityType: string; // 实体类型 (report, chapter, dimension)
  entityId: string; // 实体 ID
  requesterId: string; // 请求者 ID
  reviewerId?: string; // 审查者 ID（可选，自动分配）
  criteria: string[]; // 审查标准
  deadline?: Date; // 截止日期
  priority?: ReviewPriority;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 审查建议
 */
export interface ReviewSuggestion {
  type: "addition" | "deletion" | "modification" | "question" | "comment";
  location?: string;
  content: string;
  priority: "required" | "recommended" | "optional";
  resolved?: boolean;
}

/**
 * 审查反馈
 */
export interface ReviewFeedback {
  overallRating: number; // 1-5
  comments: string;
  criteriaRatings: {
    [criterion: string]: number;
  };
  suggestions: ReviewSuggestion[];
  recommendation: "approve" | "revise" | "reject";
}

/**
 * 审查事件
 * ★ timestamp 支持 Date 对象或 ISO 字符串（存入 JSON 字段时使用字符串）
 */
export interface ReviewEvent {
  type:
    | "created"
    | "assigned"
    | "started"
    | "feedback_added"
    | "status_changed"
    | "completed"
    | "reopened"
    | "cancelled";
  timestamp: Date | string; // ★ 支持 ISO 字符串格式
  actor: string;
  details?: Record<string, unknown>;
}

/**
 * 审查记录
 */
export interface Review {
  id: string;
  request: ReviewRequest;
  status: ReviewStatus;
  reviewer?: {
    id: string;
    name: string;
    role?: string;
  };
  feedback?: ReviewFeedback;
  timeline: ReviewEvent[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  version: number; // 乐观锁版本
}

/**
 * 审查统计
 */
export interface ReviewStats {
  totalReviews: number;
  pendingCount: number;
  inProgressCount: number;
  completedCount: number;
  avgCompletionTime: number; // 平均完成时间 (ms)
  avgRating: number;
}

/**
 * 审查工作流接口
 */
export interface IReviewWorkflow {
  /**
   * 创建审查请求
   */
  createReview(request: ReviewRequest): Promise<Review>;

  /**
   * 分配审查者
   */
  assignReviewer(
    reviewId: string,
    reviewerId: string,
    assignedBy: string,
  ): Promise<Review>;

  /**
   * 自动分配审查者
   */
  autoAssign(reviewId: string): Promise<Review>;

  /**
   * 开始审查
   */
  startReview(reviewId: string, reviewerId: string): Promise<Review>;

  /**
   * 提交审查反馈
   */
  submitFeedback(
    reviewId: string,
    feedback: ReviewFeedback,
    reviewerId: string,
  ): Promise<Review>;

  /**
   * 更新审查状态
   */
  updateStatus(
    reviewId: string,
    status: ReviewStatus,
    actor: string,
  ): Promise<Review>;

  /**
   * 获取审查记录
   */
  getReview(reviewId: string): Promise<Review | null>;

  /**
   * 获取实体的所有审查
   */
  getReviewsForEntity(entityType: string, entityId: string): Promise<Review[]>;

  /**
   * 获取审查者的待审列表
   */
  getPendingReviews(reviewerId: string): Promise<Review[]>;

  /**
   * 获取审查统计
   */
  getStats(filters?: {
    entityType?: string;
    reviewerId?: string;
  }): Promise<ReviewStats>;

  /**
   * 取消审查
   */
  cancelReview(
    reviewId: string,
    actor: string,
    reason?: string,
  ): Promise<Review>;

  /**
   * 重新打开审查
   */
  reopenReview(
    reviewId: string,
    actor: string,
    reason?: string,
  ): Promise<Review>;
}

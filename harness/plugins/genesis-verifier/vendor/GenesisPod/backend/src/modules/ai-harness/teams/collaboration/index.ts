/**
 * AI Engine - Collaboration Module
 * 协作框架导出
 *
 * 包含：
 * - 协作接口和类型
 * - 交接模式
 * - 投票模式
 */

// Abstractions
export * from "./abstractions";

// Patterns
export * from "./patterns";

// Review Workflow (使用显式导出避免命名冲突)
export type {
  IReviewWorkflow,
  Review,
  ReviewRequest as ReviewWorkflowRequest,
  ReviewFeedback,
  ReviewStatus,
  ReviewStats,
  ReviewEvent,
} from "./review/review.interface";
export { ReviewWorkflowService } from "./review/review-workflow.service";

// Todo Management
export * from "./todo";

// Module
export { CollaborationModule } from "./collaboration.module";

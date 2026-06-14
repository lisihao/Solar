/**
 * Collaboration Services - Main Exports
 *
 * 目录结构:
 * - mission/   任务相关服务
 * - agent/     Agent 相关服务
 * - context/   上下文相关服务
 * - utils/     工具函数
 * - config/    配置常量
 * - interfaces/ 类型定义
 * - prompt/    提示词模板
 */

// 接口定义（优先导出，避免冲突）
export * from "./interfaces";

// Mission 服务（排除冲突的类型）
export {
  TeamMissionService,
  MissionExecutionService,
  MissionReviewService,
  MissionPromptService,
  MissionQueryService,
  // W2-F: MissionContextService/MissionInputService/MissionStateManager 已迁 harness，
  //   改从 @/modules/ai-harness/facade 注入，本 barrel 不再 re-export。
  // TaskBreakdownService 已删 (2026-04-30)
  MissionLifecycleService,
  MissionRetryService,
  MissionHealthCheckService,
  MissionAICallerService,
  TeamMessageService,
  TeamMemberService,
} from "./mission";
export type {
  // MissionPromptService 中的非冲突类型
  TaskBreakdown,
  TeamMemberInfo,
} from "./mission";

// Context 服务（排除冲突的类型）
export {
  ConstraintEnforcementService,
  TokenBudgetCalculatorService,
} from "./context";
export type {
  ConstraintSeverity,
  ExtractedConstraint,
  OutputValidationResult,
} from "./context";
export type { ConstraintViolation as ContextConstraintViolation } from "@/modules/ai-harness/facade";

// 协作服务（根目录）
export * from "./team-collaboration.service";
export * from "./debate.service";

// 工具函数
export * from "./utils";

// 配置
export * from "./config";

// 提示词模板
export * from "./prompt";

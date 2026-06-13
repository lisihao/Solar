/**
 * AI Engine - Teams Abstractions
 * 团队抽象层导出
 */

// Team (v3 R0-A1-c: BUILTIN_TEAMS / BuiltinTeamId 已下推到各 ai-app)
export type {
  TeamId,
  TeamType,
  TeamConfig,
  MemberRoleConfig,
  ITeam,
  TeamCapability,
  TeamExecutionStatus,
  TeamExecutionContext,
} from "./team.interface";

// Role
export type {
  RoleId,
  BuiltinRoleId,
  RoleType,
  WorkStyle,
  IRole,
  RoleConfig,
} from "./role.interface";
export {
  BUILTIN_ROLES,
  DEFAULT_WORK_STYLE,
  LEADER_WORK_STYLE,
  ROLE_DESCRIPTIONS,
} from "./role.interface";

// Member
export type {
  TeamMemberId,
  MemberStatus,
  ITeamMember,
  MemberConfig,
  ILeader,
  TaskInput,
  TaskAttachment,
  SubTask,
  TaskAssignment,
  MemberOutput,
  ReviewResult,
  ReviewIssue,
  IntegratedResult,
  ReworkDecision,
} from "./member.interface";

// Workflow
export type {
  WorkflowType,
  WorkflowStepType,
  WorkflowStepStatus,
  IWorkflow,
  IWorkflowStep,
  StepCondition,
  RetryConfig,
  ReviewConfig,
  ReviewCriterion,
  LoopConfig,
  WorkflowValidationResult,
  WorkflowValidationError,
  WorkflowValidationWarning,
  WorkflowExecutionState,
  StepExecutionState,
  WorkflowConfig,
  WorkflowStepConfig,
} from "./workflow.interface";

// Mission Context Package
export type {
  HardConstraint,
  CoreEntity,
  Prohibition,
  QualityStandard,
  EstablishedFact,
  TaskUnderstanding,
  MissionContextPackage,
} from "./mission-context.interface";
export {
  createEmptyContextPackage,
  validateContextPackage,
  mergeContextPackages,
} from "./mission-context.interface";

// RoleInventory abstractions (Self-Driven Team P2, safety-05/safety-10)
export type { RolePrototype, IRoleInventory } from "./role-inventory.interface";
export { ROLE_INVENTORY } from "./role-inventory.interface";

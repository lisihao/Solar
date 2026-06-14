/**
 * Collaboration Tools
 * 协作工具集 - Agent 间协作和人机协作
 */

// ============================================================================
// Tool Classes
// ============================================================================
export { AgentHandoffTool } from "./agent-handoff.tool";
export { HumanApprovalTool } from "./human-approval.tool";
export { AgentCommunicationTool } from "./agent-communication.tool";
export { TaskDelegationTool } from "./task-delegation.tool";
export { ConsensusMechanismTool } from "./consensus-mechanism.tool";
export { WorkflowOrchestrationTool } from "./workflow-orchestration.tool";

// ============================================================================
// Types - Agent Handoff
// ============================================================================
export type {
  TaskDefinition,
  HandoffOptions,
  AgentHandoffInput,
  HandoffStatus,
  AgentHandoffOutput,
} from "./agent-handoff.tool";

// ============================================================================
// Types - Human Approval
// ============================================================================
export type {
  ApprovalType,
  ChoiceOption,
  ApprovalContext,
  ApprovalOptions,
  HumanApprovalInput,
  ApprovalResponse,
  HumanApprovalOutput,
} from "./human-approval.tool";

// ============================================================================
// Types - Agent Communication
// ============================================================================
export type {
  MessageType,
  MessagePriority,
  MessageStatus,
  Message,
  CommunicationOperation,
  AgentCommunicationInput,
  AgentCommunicationOutput,
} from "./agent-communication.tool";

// ============================================================================
// Types - Task Delegation
// ============================================================================
export type {
  DelegationStatus,
  TaskPriority,
  DelegatedTask,
  TaskDelegationInput,
  TaskDelegationOutput,
} from "./task-delegation.tool";

// ============================================================================
// Types - Consensus Mechanism
// ============================================================================
export type {
  ConsensusStrategy,
  VoteValue,
  Voter,
  Vote,
  ConsensusProposal,
  ConsensusMechanismInput,
  ConsensusMechanismOutput,
} from "./consensus-mechanism.tool";

// ============================================================================
// Types - Workflow Orchestration
// ============================================================================
export type {
  WorkflowStatus,
  StepStatus,
  ExecutionMode,
  WorkflowStep,
  Workflow,
  WorkflowOrchestrationInput,
  WorkflowOrchestrationOutput,
} from "./workflow-orchestration.tool";

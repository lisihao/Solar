/**
 * Multi-Agent System - AI Office 2.0
 * 统一导出所有Agent
 */

export { CoordinatorAgent } from './coordinator.agent';
export type { AgentPlan } from './coordinator.agent';

export { ResourceAnalysisAgent } from './resource-analysis.agent';
export type { ResourceAnalysis } from './resource-analysis.agent';

export { VerificationAgent } from './verification.agent';
export type {
  VerificationResult,
  VerificationBadge,
  VerificationStatus,
} from './verification.agent';

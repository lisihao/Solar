/**
 * Output Reviewer Types
 *
 * 2026-05-01 (PR-X-O): 从 interfaces.ts 拆出。
 */

import type { AiCallerFn } from "../../../ai-engine/llm/types/ai-caller.types";
import type { TeamMemberInfo } from "./team-member.types";
import type { ExecutionContext, ExecutionResult } from "./agent-executor.types";

/** 审核请求 */
export interface ReviewRequest {
  missionId: string;
  task: {
    id: string;
    title: string;
    description?: string;
  };
  content: string;
  leader: TeamMemberInfo;
  criteria?: ReviewCriteria;
  missionDescription?: string;
  constraints?: Array<{ type: string; description: string }>;
}

/** 审核标准 */
export interface ReviewCriteria {
  completenessWeight?: number;
  accuracyWeight?: number;
  logicWeight?: number;
  professionalismWeight?: number;
  // ★ v2: 扩展评审维度（10 维）
  evidenceCoverageWeight?: number;
  informationDensityWeight?: number;
  visualQualityWeight?: number;
  originalityWeight?: number;
  timelinessWeight?: number;
  actionabilityWeight?: number;
  passThreshold?: number;
  maxRevisions?: number;
}

/** 审核结果 */
export interface ReviewResult {
  passed: boolean;
  score: number;
  scores?: Record<string, number>;
  feedback: string;
  issues: string[];
  suggestions: string[];
  tokensUsed: number;
}

/** 修订请求 */
export interface RevisionRequest {
  originalContext: ExecutionContext;
  originalContent: string;
  reviewFeedback: string;
  issues: string[];
  revisionCount: number;
}

/** 输出审核服务接口 */
export interface IOutputReviewerService {
  reviewOutput(
    request: ReviewRequest,
    aiCaller?: AiCallerFn,
  ): Promise<ReviewResult>;

  summarizeForReview(
    content: string,
    taskTitle: string,
    model: string,
    missionId: string,
    aiCaller?: AiCallerFn,
  ): Promise<{ summary: string; keyExcerpts?: string }>;

  executeRevision(
    request: RevisionRequest,
    aiCaller?: AiCallerFn,
  ): Promise<ExecutionResult>;
}

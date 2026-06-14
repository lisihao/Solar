/**
 * Task Decomposer Types
 *
 * 2026-05-01 (PR-X-O): 从 interfaces.ts 拆出。
 */

import type { TaskDefinition, TeamMemberInfo } from "./team-member.types";

/** 任务分解输入 */
export interface DecompositionInput {
  /** 任务内容（AI 生成的分解结果文本） */
  content: string;
  /** 团队成员列表 */
  teamMembers: TeamMemberInfo[];
  /** Mission ID（用于创建任务） */
  missionId?: string;
}

/** 任务分解结果 */
export interface DecompositionResult {
  /** 解析出的任务列表 */
  tasks: TaskDefinition[];
  /** 任务理解 */
  understanding: string;
  /** 执行计划 */
  executionPlan: string;
  /** 风险提示 */
  risks: string;
  /** 匹配统计 */
  matchStats: {
    totalRows: number;
    matched: number;
    fuzzyMatched: number;
    unmatched: string[];
  };
}

/** 任务分解服务接口 */
export interface ITaskDecomposerService {
  parseTaskBreakdown(input: DecompositionInput): DecompositionResult;
  rebalanceTaskAssignments(
    tasks: TaskDefinition[],
    teamMembers: TeamMemberInfo[],
  ): TaskDefinition[];
}

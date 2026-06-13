/**
 * Agent Executor Types
 *
 * 2026-05-01 (PR-X-O): 从 interfaces.ts 拆出。
 */

import type { TaskProfile } from "../../../ai-engine/llm/types";
import type { TeamMemberInfo } from "./team-member.types";

/** 执行上下文 */
export interface ExecutionContext {
  missionId: string;
  topicId: string;
  task: {
    id: string;
    title: string;
    description?: string;
    assigneeId: string;
  };
  executor: TeamMemberInfo;
  systemPrompt: string;
  userPrompt: string;
  searchContext?: string;
  previousResults?: Record<string, string>;
}

/** 执行配置 */
export interface ExecutionConfig {
  maxTokens?: number;
  temperature?: number;
  taskProfile?: TaskProfile;
  enableSearch?: boolean;
  maxRetries?: number;
  retryInitialDelay?: number;
  timeout?: number;
  maxIterations?: number;
  maxToolCalls?: number;
}

/** 执行结果 */
export interface ExecutionResult {
  success: boolean;
  content: string;
  tokensUsed: number;
  duration: number;
  error?: string;
  retryable?: boolean;
  searchResults?: Array<{ title: string; url: string; snippet: string }>;
}

/** Agent 执行服务接口 */
export interface IAgentExecutorService {
  executeTask(
    context: ExecutionContext,
    config?: ExecutionConfig,
  ): Promise<ExecutionResult>;

  executeTasks(
    contexts: ExecutionContext[],
    config?: ExecutionConfig & { concurrency?: number },
  ): Promise<ExecutionResult[]>;

  isAgentAvailable(agentId: string): boolean;

  recordExecution(agentId: string, success: boolean, duration: number): void;
}

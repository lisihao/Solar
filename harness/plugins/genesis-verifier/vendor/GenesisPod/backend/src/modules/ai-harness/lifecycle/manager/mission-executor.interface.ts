import type {
  ProcessId,
  ProcessSnapshot,
} from "../../../ai-harness/lifecycle/manager/process.types";

/**
 * Mission Executor Interface
 * Wraps mission orchestration with process lifecycle management
 */
export interface IMissionExecutor {
  /**
   * Execute a mission, creating a tracked process
   */
  execute(options: MissionExecuteOptions): Promise<MissionExecuteResult>;

  /**
   * Execute with an auto-fail timeout (AbortController pattern)
   */
  executeWithTimeout(
    options: MissionExecuteOptions,
    timeoutMs: number,
  ): Promise<MissionExecuteResult>;

  /**
   * Execute with automatic retry on transient failures
   */
  executeWithRetry(
    options: MissionExecuteOptions,
    retryOptions?: RetryOptions,
  ): Promise<MissionExecuteResult>;

  /**
   * Recover a failed/interrupted process from its last checkpoint
   */
  recover(processId: ProcessId): Promise<MissionExecuteResult>;

  /**
   * Cancel a running mission
   */
  cancel(processId: ProcessId): Promise<void>;

  /**
   * Get mission status
   */
  getStatus(processId: ProcessId): Promise<ProcessSnapshot | null>;
}

export interface RetryOptions {
  maxRetries?: number;
  backoffMs?: number;
}

export interface MissionExecuteOptions {
  userId: string;
  agentId: string;
  teamSessionId?: string;
  input: Record<string, unknown>;
  priority?: number;
  tokenBudget?: number;
  costBudget?: number;
  grantedTools?: string[];
  grantedSkills?: string[];
}

export interface MissionExecuteResult {
  processId: ProcessId;
  process: ProcessSnapshot;
}

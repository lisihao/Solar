/**
 * Mission Executor Service
 * Wraps MissionOrchestrator with process lifecycle management.
 * Does NOT rewrite the orchestrator — delegates to it while adding
 * process tracking, event journaling, and resource management.
 */
import { Injectable, Logger } from "@nestjs/common";
import { ProcessManagerService } from "../../../ai-harness/lifecycle/manager/process-manager.service";
import { EventJournalService } from "../../../ai-harness/protocols/journal/event-journal.service";
import type { ProcessId } from "../../../ai-harness/lifecycle/manager/process.types";
import type {
  IMissionExecutor,
  MissionExecuteOptions,
  MissionExecuteResult,
  RetryOptions,
} from "./mission-executor.interface";

@Injectable()
export class MissionExecutorService implements IMissionExecutor {
  private readonly logger = new Logger(MissionExecutorService.name);

  constructor(
    private readonly processManager: ProcessManagerService,
    private readonly eventJournal: EventJournalService,
  ) {}

  /**
   * Execute a mission with full process lifecycle tracking.
   *
   * Flow:
   * 1. Spawn AgentProcess (state: CREATED)
   * 2. Transition to READY
   * 3. Transition to RUNNING
   * 4. Record events via EventJournal
   * 5. On completion: transition to COMPLETED
   * 6. On error: transition to FAILED
   */
  async execute(options: MissionExecuteOptions): Promise<MissionExecuteResult> {
    // 1. Create process record
    const process = await this.processManager.spawn({
      userId: options.userId,
      agentId: options.agentId,
      teamSessionId: options.teamSessionId,
      priority: options.priority,
      tokenBudget: options.tokenBudget,
      costBudget: options.costBudget,
      input: options.input,
      grantedTools: options.grantedTools,
      grantedSkills: options.grantedSkills,
    });

    const processId = process.id;

    // 2. Record spawn event
    await this.eventJournal.record(processId, "process:spawned", {
      agentId: options.agentId,
      teamSessionId: options.teamSessionId,
    });

    // 3. Transition to READY then RUNNING
    await this.processManager.transition(processId, "READY");
    const runningProcess = await this.processManager.transition(
      processId,
      "RUNNING",
    );

    await this.eventJournal.record(processId, "process:started");

    this.logger.log(
      `Mission process ${processId} started for agent ${options.agentId}`,
    );

    return {
      processId,
      process: runningProcess,
    };
  }

  /**
   * Mark a mission process as completed
   */
  async complete(
    processId: ProcessId,
    output?: Record<string, unknown>,
  ): Promise<void> {
    if (output) {
      await this.processManager.checkpoint(processId, output);
    }
    await this.processManager.transition(processId, "COMPLETED");
    await this.eventJournal.record(processId, "process:completed", { output });
    this.logger.log(`Mission process ${processId} completed`);
  }

  /**
   * Mark a mission process as failed
   */
  async fail(processId: ProcessId, error: string): Promise<void> {
    try {
      await this.processManager.transition(processId, "FAILED");
    } catch {
      // Process might already be in terminal state
      this.logger.warn(`Could not transition process ${processId} to FAILED`);
    }
    await this.eventJournal.record(processId, "process:failed", { error });
    this.logger.error(`Mission process ${processId} failed: ${error}`);
  }

  /**
   * Cancel a running mission
   */
  async cancel(processId: ProcessId): Promise<void> {
    await this.processManager.cancel(processId);
    await this.eventJournal.record(processId, "process:cancelled");
    this.logger.log(`Mission process ${processId} cancelled`);
  }

  /**
   * Get mission process status
   */
  async getStatus(processId: ProcessId) {
    return this.processManager.getState(processId);
  }

  /**
   * Execute with an auto-fail timeout.
   * If the process is not completed within timeoutMs, it is marked as FAILED.
   */
  async executeWithTimeout(
    options: MissionExecuteOptions,
    timeoutMs: number,
  ): Promise<MissionExecuteResult> {
    const result = await this.execute(options);

    const timer = setTimeout(() => {
      void this.fail(result.processId, `Timeout after ${timeoutMs}ms`).catch(
        (err) =>
          this.logger.warn(
            `Timeout cleanup failed for ${result.processId}: ${err}`,
          ),
      );
    }, timeoutMs);

    // Attach cleanup handle so callers can clear if they complete early
    (
      result as MissionExecuteResult & {
        _timeoutRef?: ReturnType<typeof setTimeout>;
      }
    )._timeoutRef = timer;

    return result;
  }

  /**
   * Execute with automatic retry on transient failures.
   */
  async executeWithRetry(
    options: MissionExecuteOptions,
    retryOptions: RetryOptions = {},
  ): Promise<MissionExecuteResult> {
    const maxRetries = retryOptions.maxRetries ?? 3;
    const backoffMs = retryOptions.backoffMs ?? 1000;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.execute(options);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.logger.warn(
          `Mission execute attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`,
        );

        if (attempt < maxRetries) {
          const delay = backoffMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError ?? new Error("All retry attempts exhausted");
  }

  /**
   * Recover a failed/interrupted process from its last checkpoint.
   * Reads the last checkpoint, transitions the process back to RUNNING.
   */
  async recover(processId: ProcessId): Promise<MissionExecuteResult> {
    const snapshot = await this.processManager.getState(processId);
    if (!snapshot) {
      throw new Error(`Process ${processId} not found`);
    }

    if (snapshot.state === "RUNNING") {
      this.logger.warn(`Process ${processId} is already running`);
      return { processId, process: snapshot };
    }

    // Transition back to READY then RUNNING
    await this.processManager.transition(processId, "READY");
    const runningProcess = await this.processManager.transition(
      processId,
      "RUNNING",
    );

    await this.eventJournal.record(processId, "process:recovered", {
      previousState: snapshot.state,
      hasCheckpoint: snapshot.checkpoint != null,
    });

    this.logger.log(
      `Mission process ${processId} recovered from ${snapshot.state}`,
    );

    return { processId, process: runningProcess };
  }
}

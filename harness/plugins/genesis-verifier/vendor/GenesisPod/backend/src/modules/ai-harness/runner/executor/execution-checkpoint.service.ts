import { Injectable, Logger } from "@nestjs/common";
import type { TokenUsageSnapshot } from "./token-tracker.service";

export interface ExecutionCheckpoint {
  executionId: string;
  iteration: number;
  messages: Array<{ role: string; content: string | unknown }>;
  toolResults: Array<{ toolId: string; result: unknown }>;
  tokenUsage: TokenUsageSnapshot;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

/**
 * ExecutionCheckpointService
 *
 * Saves and restores fine-grained execution state within a FunctionCallingExecutor loop.
 * Uses in-memory Map storage keyed by executionId (same pattern as TokenTrackerService).
 * Only the latest checkpoint per executionId is retained.
 */
@Injectable()
export class ExecutionCheckpointService {
  private readonly logger = new Logger(ExecutionCheckpointService.name);
  private readonly checkpoints = new Map<string, ExecutionCheckpoint>();

  /**
   * Save (or overwrite) the checkpoint for the given executionId.
   * Only the latest checkpoint is kept.
   */
  save(checkpoint: ExecutionCheckpoint): void {
    this.checkpoints.set(checkpoint.executionId, checkpoint);
    this.logger.debug(
      `[save] Checkpoint for ${checkpoint.executionId} at iteration ${checkpoint.iteration}`,
    );
  }

  /**
   * Restore the latest checkpoint for the given executionId.
   * Returns null if no checkpoint exists.
   */
  restore(executionId: string): ExecutionCheckpoint | null {
    const cp = this.checkpoints.get(executionId) ?? null;
    if (cp) {
      this.logger.log(
        `[restore] Restoring ${executionId} from iteration ${cp.iteration}`,
      );
    }
    return cp;
  }

  /**
   * Get the latest checkpoint without side effects.
   */
  getLatest(executionId: string): ExecutionCheckpoint | null {
    return this.checkpoints.get(executionId) ?? null;
  }

  /**
   * Remove the checkpoint for the given executionId and return it.
   * Should be called when an execution completes (success or permanent failure).
   */
  endExecution(executionId: string): ExecutionCheckpoint | null {
    const cp = this.checkpoints.get(executionId) ?? null;
    this.checkpoints.delete(executionId);
    return cp;
  }

  /**
   * Get all active (non-cleaned-up) execution IDs.
   */
  getActiveExecutions(): string[] {
    return Array.from(this.checkpoints.keys());
  }
}

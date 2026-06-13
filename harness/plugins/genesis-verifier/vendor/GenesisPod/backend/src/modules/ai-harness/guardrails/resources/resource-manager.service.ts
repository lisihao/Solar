/**
 * Resource Manager Service
 * Process-level resource management (token budget, cost budget, circuit breaker)
 */
import { Injectable, Logger } from "@nestjs/common";
import { ProcessManagerService } from "@/modules/ai-harness/lifecycle/manager/process-manager.service";
import type {
  ProcessId,
  ResourceConsumption,
} from "@/modules/ai-harness/lifecycle/manager/process.types";

@Injectable()
export class ResourceManagerService {
  private readonly logger = new Logger(ResourceManagerService.name);

  constructor(private readonly processManager: ProcessManagerService) {}

  /**
   * Check if a process has sufficient budget to proceed
   */
  async checkBudget(
    processId: ProcessId,
  ): Promise<{ canProceed: boolean; reason?: string }> {
    const process = await this.processManager.getState(processId);
    if (!process) return { canProceed: false, reason: "Process not found" };

    if (process.tokensUsed >= process.tokenBudget) {
      return {
        canProceed: false,
        reason: `Token budget exhausted: ${process.tokensUsed}/${process.tokenBudget}`,
      };
    }
    if (process.costUsed >= process.costBudget) {
      return {
        canProceed: false,
        reason: `Cost budget exhausted: ${process.costUsed}/${process.costBudget}`,
      };
    }

    return { canProceed: true };
  }

  /**
   * Consume resources and update process record
   */
  async consume(
    processId: ProcessId,
    consumption: ResourceConsumption,
  ): Promise<void> {
    const budgetCheck = await this.checkBudget(processId);
    if (!budgetCheck.canProceed) {
      throw new Error(
        `Resource limit exceeded for process ${processId}: ${budgetCheck.reason}`,
      );
    }
    await this.processManager.consumeResources(processId, consumption);
    this.logger.debug(
      `Process ${processId} consumed: tokens=${consumption.tokensUsed ?? 0}, cost=${consumption.costUsed ?? 0}`,
    );
  }

  /**
   * Get resource utilization for a process
   */
  async getUtilization(processId: ProcessId): Promise<{
    tokenUtilization: number;
    costUtilization: number;
    tokensRemaining: number;
    costRemaining: number;
  } | null> {
    const process = await this.processManager.getState(processId);
    if (!process) return null;

    return {
      tokenUtilization:
        process.tokenBudget > 0 ? process.tokensUsed / process.tokenBudget : 0,
      costUtilization:
        process.costBudget > 0 ? process.costUsed / process.costBudget : 0,
      tokensRemaining: Math.max(0, process.tokenBudget - process.tokensUsed),
      costRemaining: Math.max(0, process.costBudget - process.costUsed),
    };
  }
}

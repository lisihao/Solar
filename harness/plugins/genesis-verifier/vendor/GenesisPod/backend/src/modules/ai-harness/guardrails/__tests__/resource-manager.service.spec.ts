/**
 * ResourceManagerService Unit Tests
 *
 * Tests process-level resource management:
 * - checkBudget()    - determine whether a process can proceed
 * - consume()        - deduct resources or throw when over budget
 * - getUtilization() - report token/cost utilisation percentages
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ResourceManagerService } from "../resources/resource-manager.service";
import { ProcessManagerService } from "@/modules/ai-harness/lifecycle/manager/process-manager.service";
import type {
  ProcessSnapshot,
  ResourceConsumption,
} from "@/modules/ai-harness/lifecycle/manager/process.types";
import { ProcessState } from "@prisma/client";

describe("ResourceManagerService", () => {
  let service: ResourceManagerService;
  let mockProcessManager: {
    getState: jest.Mock;
    consumeResources: jest.Mock;
  };

  const processId = "proc-xyz-999";

  /** Build a minimal ProcessSnapshot with configurable budget/usage values. */
  function makeSnapshot(
    overrides: Partial<
      Pick<
        ProcessSnapshot,
        "tokenBudget" | "tokensUsed" | "costBudget" | "costUsed"
      >
    >,
  ): ProcessSnapshot {
    return {
      id: processId,
      userId: "user-001",
      parentId: null,
      agentId: "agent-001",
      teamSessionId: null,
      state: ProcessState.RUNNING,
      priority: 5,
      tokenBudget: 10_000,
      tokensUsed: 0,
      costBudget: 1.0,
      costUsed: 0,
      checkpoint: null,
      input: null,
      output: null,
      error: null,
      grantedTools: [],
      grantedSkills: [],
      dataScope: null,
      metadata: null,
      version: 1,
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockProcessManager = {
      getState: jest.fn(),
      consumeResources: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourceManagerService,
        { provide: ProcessManagerService, useValue: mockProcessManager },
      ],
    }).compile();

    service = module.get<ResourceManagerService>(ResourceManagerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── checkBudget() ────────────────────────────────────────────────────────

  describe("checkBudget()", () => {
    it("should return canProceed true when usage is well within both budgets", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 10_000,
          tokensUsed: 4_999,
          costBudget: 1.0,
          costUsed: 0.3,
        }),
      );

      const result = await service.checkBudget(processId);

      expect(result.canProceed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should return canProceed false when token budget is exactly exhausted", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 5_000,
          tokensUsed: 5_000,
          costBudget: 1.0,
          costUsed: 0,
        }),
      );

      const result = await service.checkBudget(processId);

      expect(result.canProceed).toBe(false);
      expect(result.reason).toContain("Token budget exhausted");
      expect(result.reason).toContain("5000/5000");
    });

    it("should return canProceed false when token usage exceeds the budget", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 5_000,
          tokensUsed: 6_000,
          costBudget: 1.0,
          costUsed: 0,
        }),
      );

      const result = await service.checkBudget(processId);

      expect(result.canProceed).toBe(false);
      expect(result.reason).toContain("Token budget exhausted");
    });

    it("should return canProceed false when cost budget is exactly exhausted", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 10_000,
          tokensUsed: 1_000,
          costBudget: 2.0,
          costUsed: 2.0,
        }),
      );

      const result = await service.checkBudget(processId);

      expect(result.canProceed).toBe(false);
      expect(result.reason).toContain("Cost budget exhausted");
      expect(result.reason).toContain("2/2");
    });

    it("should return canProceed false when cost usage exceeds the budget", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 10_000,
          tokensUsed: 100,
          costBudget: 1.0,
          costUsed: 1.5,
        }),
      );

      const result = await service.checkBudget(processId);

      expect(result.canProceed).toBe(false);
      expect(result.reason).toContain("Cost budget exhausted");
    });

    it("should return canProceed false with 'Process not found' reason when process does not exist", async () => {
      mockProcessManager.getState.mockResolvedValue(null);

      const result = await service.checkBudget(processId);

      expect(result.canProceed).toBe(false);
      expect(result.reason).toBe("Process not found");
    });

    it("should check token budget before cost budget", async () => {
      // Both budgets are exhausted — token check should win
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 100,
          tokensUsed: 100,
          costBudget: 0.5,
          costUsed: 0.5,
        }),
      );

      const result = await service.checkBudget(processId);

      expect(result.reason).toContain("Token budget exhausted");
    });
  });

  // ─── consume() ────────────────────────────────────────────────────────────

  describe("consume()", () => {
    const consumption: ResourceConsumption = {
      tokensUsed: 500,
      costUsed: 0.05,
    };

    it("should consume resources successfully when within budget", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 10_000,
          tokensUsed: 1_000,
          costBudget: 1.0,
          costUsed: 0.1,
        }),
      );
      mockProcessManager.consumeResources.mockResolvedValue(undefined);

      await service.consume(processId, consumption);

      expect(mockProcessManager.consumeResources).toHaveBeenCalledWith(
        processId,
        consumption,
      );
    });

    it("should throw when the token budget is exceeded", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 500,
          tokensUsed: 500,
          costBudget: 1.0,
          costUsed: 0,
        }),
      );

      await expect(service.consume(processId, consumption)).rejects.toThrow(
        `Resource limit exceeded for process ${processId}`,
      );
      expect(mockProcessManager.consumeResources).not.toHaveBeenCalled();
    });

    it("should throw when the cost budget is exceeded", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 10_000,
          tokensUsed: 100,
          costBudget: 0.1,
          costUsed: 0.1,
        }),
      );

      await expect(service.consume(processId, consumption)).rejects.toThrow(
        `Resource limit exceeded for process ${processId}`,
      );
      expect(mockProcessManager.consumeResources).not.toHaveBeenCalled();
    });

    it("should throw when the process is not found", async () => {
      mockProcessManager.getState.mockResolvedValue(null);

      await expect(service.consume(processId, consumption)).rejects.toThrow(
        `Resource limit exceeded for process ${processId}`,
      );
      expect(mockProcessManager.consumeResources).not.toHaveBeenCalled();
    });

    it("should forward the consumption object as-is to processManager", async () => {
      mockProcessManager.getState.mockResolvedValue(makeSnapshot({}));
      mockProcessManager.consumeResources.mockResolvedValue(undefined);

      const partial: ResourceConsumption = { tokensUsed: 200 };
      await service.consume(processId, partial);

      expect(mockProcessManager.consumeResources).toHaveBeenCalledWith(
        processId,
        partial,
      );
    });
  });

  // ─── getUtilization() ─────────────────────────────────────────────────────

  describe("getUtilization()", () => {
    it("should return correct utilization percentages when budgets are partially consumed", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 10_000,
          tokensUsed: 2_500,
          costBudget: 2.0,
          costUsed: 0.5,
        }),
      );

      const result = await service.getUtilization(processId);

      expect(result).not.toBeNull();
      expect(result!.tokenUtilization).toBeCloseTo(0.25);
      expect(result!.costUtilization).toBeCloseTo(0.25);
      expect(result!.tokensRemaining).toBe(7_500);
      expect(result!.costRemaining).toBeCloseTo(1.5);
    });

    it("should return utilization of 1.0 when budget is fully consumed", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 1_000,
          tokensUsed: 1_000,
          costBudget: 1.0,
          costUsed: 1.0,
        }),
      );

      const result = await service.getUtilization(processId);

      expect(result!.tokenUtilization).toBe(1.0);
      expect(result!.costUtilization).toBe(1.0);
      expect(result!.tokensRemaining).toBe(0);
      expect(result!.costRemaining).toBe(0);
    });

    it("should clamp tokensRemaining and costRemaining to 0 when over budget", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 500,
          tokensUsed: 600,
          costBudget: 0.5,
          costUsed: 0.8,
        }),
      );

      const result = await service.getUtilization(processId);

      expect(result!.tokensRemaining).toBe(0);
      expect(result!.costRemaining).toBe(0);
    });

    it("should return null when process is not found", async () => {
      mockProcessManager.getState.mockResolvedValue(null);

      const result = await service.getUtilization(processId);

      expect(result).toBeNull();
    });

    it("should return tokenUtilization of 0 when tokenBudget is zero", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 0,
          tokensUsed: 0,
          costBudget: 1.0,
          costUsed: 0,
        }),
      );

      const result = await service.getUtilization(processId);

      expect(result!.tokenUtilization).toBe(0);
    });

    it("should return costUtilization of 0 when costBudget is zero", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          tokenBudget: 1_000,
          tokensUsed: 0,
          costBudget: 0,
          costUsed: 0,
        }),
      );

      const result = await service.getUtilization(processId);

      expect(result!.costUtilization).toBe(0);
    });
  });
});

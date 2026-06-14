/**
 * HarnessApiService Unit Tests
 *
 * Verifies that every public method on HarnessApiService is a thin delegation
 * layer that forwards calls (with the correct arguments) to the matching
 * dependency service and returns whatever that service returns.
 *
 * All five dependencies are fully mocked so no I/O or database is required.
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  HarnessApiService,
  KernelApiService,
} from "../api/harness-api.service";
import { ProcessManagerService } from "../../lifecycle/manager/process-manager.service";
import { EventJournalService } from "../../protocols/journal/event-journal.service";
import { WorkingMemoryManagerService } from "../../memory/working/working-memory-manager.service";
import { ResourceManagerService } from "../../guardrails/resources/resource-manager.service";
import { MissionExecutorService } from "@/modules/ai-harness/lifecycle/manager/mission-executor.service";
import { EntityHealthRegistry } from "../../../ai-engine/reliability/entity-health/entity-health.registry";
import { EventBusService } from "../../protocols/ipc/event-bus.service";
import { MessageBusService } from "../../protocols/ipc/message-bus.service";
import { ProgressTrackerService } from "../../protocols/ipc/progress-tracker.service";
import { AiObservabilityService } from "../../tracing/observability/ai-observability.service";
import { CostAttributionService } from "../../tracing/observability/cost-attribution.service";
import { CapabilityGuardService } from "../../guardrails/capability";
import { KernelSchedulerService } from "../../runner/scheduler/kernel-scheduler.service";

// â”€â”€â”€ Shared test fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PROCESS_ID = "process-abc-123";
const USER_ID = "user-xyz-456";

const mockProcessSnapshot = {
  id: PROCESS_ID,
  userId: USER_ID,
  parentId: null,
  agentId: "agent-1",
  teamSessionId: null,
  state: "RUNNING",
  priority: 5,
  tokenBudget: 50000,
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
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const mockJournalEntry = {
  id: "event-e1",
  processId: PROCESS_ID,
  sequence: 1,
  type: "test:event",
  payload: null,
  result: null,
  createdAt: new Date("2025-01-01"),
};

const mockMemoryEntry = {
  processId: PROCESS_ID,
  layer: "WORKING" as const,
  key: "some-key",
  value: { data: 42 },
};

// â”€â”€â”€ Mocked service objects â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const mockProcessManager = {
  spawn: jest.fn().mockResolvedValue(mockProcessSnapshot),
  getState: jest.fn().mockResolvedValue(mockProcessSnapshot),
  listByUser: jest.fn().mockResolvedValue([mockProcessSnapshot]),
  listAll: jest.fn().mockResolvedValue([mockProcessSnapshot]),
  pause: jest.fn().mockResolvedValue(mockProcessSnapshot),
  resume: jest.fn().mockResolvedValue(mockProcessSnapshot),
  cancel: jest.fn().mockResolvedValue(mockProcessSnapshot),
};

const mockEventJournal = {
  record: jest.fn().mockResolvedValue(mockJournalEntry),
  getHistory: jest
    .fn()
    .mockResolvedValue({ entries: [mockJournalEntry], total: 1 }),
};

const mockMemoryManager = {
  read: jest.fn().mockResolvedValue({ data: "cached" }),
  write: jest.fn().mockResolvedValue(undefined),
  query: jest.fn().mockResolvedValue([mockMemoryEntry]),
  cleanup: jest.fn().mockResolvedValue(0),
};

const mockResourceManager = {
  checkBudget: jest.fn().mockResolvedValue({ canProceed: true }),
  consume: jest.fn().mockResolvedValue(undefined),
};

const mockMissionExecutor = {
  execute: jest
    .fn()
    .mockResolvedValue({ processId: PROCESS_ID, process: mockProcessSnapshot }),
  complete: jest.fn().mockResolvedValue(undefined),
  fail: jest.fn().mockResolvedValue(undefined),
};

const mockCircuitBreaker = {
  getAllHealthMetrics: jest.fn().mockReturnValue([]),
  getStats: jest
    .fn()
    .mockReturnValue({ totalBreakers: 0, oldestBreakerAge: null, config: {} }),
  reset: jest.fn(),
};

const mockEventBus = {
  getActiveSubscriptionCount: jest.fn().mockReturnValue(0),
};

const mockMessageBus = {
  getHistory: jest.fn().mockReturnValue([]),
};

const mockProgressTracker = {
  getActiveTasks: jest.fn().mockReturnValue([]),
  getProgress: jest.fn().mockReturnValue(null),
};

const mockKernelMetrics = {
  getDashboard: jest.fn().mockReturnValue({ totalCalls: 0 }),
};

const mockCostAttribution = {
  getCostReport: jest.fn().mockReturnValue({ totalCost: 0 }),
  getHourlyTrend: jest.fn().mockReturnValue([]),
  checkBudgetAlerts: jest.fn().mockReturnValue([]),
};

const mockCapabilityGuard = {
  getCapabilities: jest.fn().mockResolvedValue({
    grantedTools: [],
    grantedSkills: [],
    dataScope: null,
  }),
};

const mockKernelScheduler = {
  getStats: jest.fn().mockResolvedValue({
    running: 0,
    ready: 0,
    maxConcurrent: 50,
    maxPerTenant: 10,
  }),
};

// â”€â”€â”€ Test suite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("HarnessApiService", () => {
  let service: HarnessApiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HarnessApiService,
        { provide: ProcessManagerService, useValue: mockProcessManager },
        { provide: EventJournalService, useValue: mockEventJournal },
        { provide: WorkingMemoryManagerService, useValue: mockMemoryManager },
        { provide: ResourceManagerService, useValue: mockResourceManager },
        { provide: MissionExecutorService, useValue: mockMissionExecutor },
        { provide: EntityHealthRegistry, useValue: mockCircuitBreaker },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: MessageBusService, useValue: mockMessageBus },
        { provide: ProgressTrackerService, useValue: mockProgressTracker },
        { provide: AiObservabilityService, useValue: mockKernelMetrics },
        { provide: CostAttributionService, useValue: mockCostAttribution },
        { provide: CapabilityGuardService, useValue: mockCapabilityGuard },
        { provide: KernelSchedulerService, useValue: mockKernelScheduler },
      ],
    }).compile();

    service = module.get<HarnessApiService>(HarnessApiService);
  });

  it("keeps KernelApiService as a deprecated alias", () => {
    expect(KernelApiService).toBe(HarnessApiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // â”€â”€â”€ Process Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("spawn()", () => {
    it("should delegate to processManager.spawn and return its result", async () => {
      const options = {
        userId: USER_ID,
        agentId: "agent-1",
        tokenBudget: 10000,
      };

      const result = await service.spawn(options);

      expect(mockProcessManager.spawn).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.spawn).toHaveBeenCalledWith(options);
      expect(result).toBe(mockProcessSnapshot);
    });
  });

  describe("getProcess()", () => {
    it("should delegate to processManager.getState with the processId", async () => {
      const result = await service.getProcess(PROCESS_ID);

      expect(mockProcessManager.getState).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.getState).toHaveBeenCalledWith(PROCESS_ID);
      expect(result).toBe(mockProcessSnapshot);
    });

    it("should return null when processManager.getState returns null", async () => {
      mockProcessManager.getState.mockResolvedValueOnce(null);

      const result = await service.getProcess("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("listProcesses()", () => {
    it("should delegate to processManager.listByUser with userId and no states filter", async () => {
      const result = await service.listProcesses(USER_ID);

      expect(mockProcessManager.listByUser).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.listByUser).toHaveBeenCalledWith(
        USER_ID,
        undefined,
      );
      expect(result).toEqual([mockProcessSnapshot]);
    });

    it("should forward the states filter to processManager.listByUser", async () => {
      const states = ["RUNNING", "PAUSED"] as any;

      await service.listProcesses(USER_ID, states);

      expect(mockProcessManager.listByUser).toHaveBeenCalledWith(
        USER_ID,
        states,
      );
    });
  });

  describe("pauseProcess()", () => {
    it("should delegate to processManager.pause with the processId", async () => {
      const result = await service.pauseProcess(PROCESS_ID);

      expect(mockProcessManager.pause).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.pause).toHaveBeenCalledWith(PROCESS_ID);
      expect(result).toBe(mockProcessSnapshot);
    });
  });

  describe("resumeProcess()", () => {
    it("should delegate to processManager.resume with the processId", async () => {
      const result = await service.resumeProcess(PROCESS_ID);

      expect(mockProcessManager.resume).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.resume).toHaveBeenCalledWith(PROCESS_ID);
      expect(result).toBe(mockProcessSnapshot);
    });
  });

  describe("cancelProcess()", () => {
    it("should delegate to processManager.cancel with the processId", async () => {
      const result = await service.cancelProcess(PROCESS_ID);

      expect(mockProcessManager.cancel).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.cancel).toHaveBeenCalledWith(PROCESS_ID);
      expect(result).toBe(mockProcessSnapshot);
    });
  });

  // â”€â”€â”€ Mission â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("executeMission()", () => {
    it("should delegate to missionExecutor.execute and return its result", async () => {
      const options = {
        userId: USER_ID,
        agentId: "agent-1",
        input: { task: "research AI trends" },
        tokenBudget: 20000,
      };

      const result = await service.executeMission(options);

      expect(mockMissionExecutor.execute).toHaveBeenCalledTimes(1);
      expect(mockMissionExecutor.execute).toHaveBeenCalledWith(options);
      expect(result).toEqual({
        processId: PROCESS_ID,
        process: mockProcessSnapshot,
      });
    });
  });

  describe("completeMission()", () => {
    it("should delegate to missionExecutor.complete with processId and output", async () => {
      const output = { summary: "Done" };

      await service.completeMission(PROCESS_ID, output);

      expect(mockMissionExecutor.complete).toHaveBeenCalledTimes(1);
      expect(mockMissionExecutor.complete).toHaveBeenCalledWith(
        PROCESS_ID,
        output,
      );
    });

    it("should delegate to missionExecutor.complete with no output when omitted", async () => {
      await service.completeMission(PROCESS_ID);

      expect(mockMissionExecutor.complete).toHaveBeenCalledWith(
        PROCESS_ID,
        undefined,
      );
    });
  });

  describe("failMission()", () => {
    it("should delegate to missionExecutor.fail with processId and error message", async () => {
      const errorMessage = "Quota exceeded";

      await service.failMission(PROCESS_ID, errorMessage);

      expect(mockMissionExecutor.fail).toHaveBeenCalledTimes(1);
      expect(mockMissionExecutor.fail).toHaveBeenCalledWith(
        PROCESS_ID,
        errorMessage,
      );
    });
  });

  // â”€â”€â”€ Memory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("readMemory()", () => {
    it("should delegate to memoryManager.read with processId, layer, and key", async () => {
      const layer = "WORKING" as any;
      const key = "my-key";

      const result = await service.readMemory(PROCESS_ID, layer, key);

      expect(mockMemoryManager.read).toHaveBeenCalledTimes(1);
      expect(mockMemoryManager.read).toHaveBeenCalledWith(
        PROCESS_ID,
        layer,
        key,
      );
      expect(result).toEqual({ data: "cached" });
    });

    it("should return null when memoryManager.read returns null", async () => {
      mockMemoryManager.read.mockResolvedValueOnce(null);

      const result = await service.readMemory(
        PROCESS_ID,
        "WORKING" as any,
        "missing",
      );

      expect(result).toBeNull();
    });
  });

  describe("writeMemory()", () => {
    it("should delegate to memoryManager.write with the full MemoryEntry", async () => {
      await service.writeMemory(mockMemoryEntry);

      expect(mockMemoryManager.write).toHaveBeenCalledTimes(1);
      expect(mockMemoryManager.write).toHaveBeenCalledWith(mockMemoryEntry);
    });
  });

  describe("queryMemory()", () => {
    it("should delegate to memoryManager.query with the query object and return entries", async () => {
      const query = {
        processId: PROCESS_ID,
        layer: "WORKING" as any,
        keyPattern: "some-*",
        limit: 10,
      };

      const result = await service.queryMemory(query);

      expect(mockMemoryManager.query).toHaveBeenCalledTimes(1);
      expect(mockMemoryManager.query).toHaveBeenCalledWith(query);
      expect(result).toEqual([mockMemoryEntry]);
    });

    it("should return an empty array when memoryManager.query returns none", async () => {
      mockMemoryManager.query.mockResolvedValueOnce([]);

      const result = await service.queryMemory({ processId: PROCESS_ID });

      expect(result).toEqual([]);
    });
  });

  // â”€â”€â”€ Resources â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("checkBudget()", () => {
    it("should delegate to resourceManager.checkBudget with processId", async () => {
      const result = await service.checkBudget(PROCESS_ID);

      expect(mockResourceManager.checkBudget).toHaveBeenCalledTimes(1);
      expect(mockResourceManager.checkBudget).toHaveBeenCalledWith(PROCESS_ID);
      expect(result).toEqual({ canProceed: true });
    });

    it("should return canProceed false and a reason when budget is exhausted", async () => {
      mockResourceManager.checkBudget.mockResolvedValueOnce({
        canProceed: false,
        reason: "Token budget exhausted: 50000/50000",
      });

      const result = await service.checkBudget(PROCESS_ID);

      expect(result.canProceed).toBe(false);
      expect(result.reason).toContain("Token budget exhausted");
    });
  });

  describe("consumeResources()", () => {
    it("should delegate to resourceManager.consume with processId and consumption", async () => {
      const consumption = { tokensUsed: 500, costUsed: 0.02 };

      await service.consumeResources(PROCESS_ID, consumption);

      expect(mockResourceManager.consume).toHaveBeenCalledTimes(1);
      expect(mockResourceManager.consume).toHaveBeenCalledWith(
        PROCESS_ID,
        consumption,
      );
    });

    it("should delegate with a tokens-only consumption object", async () => {
      const consumption = { tokensUsed: 100 };

      await service.consumeResources(PROCESS_ID, consumption);

      expect(mockResourceManager.consume).toHaveBeenCalledWith(
        PROCESS_ID,
        consumption,
      );
    });
  });

  // â”€â”€â”€ Journal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("recordEvent()", () => {
    it("should delegate to eventJournal.record with processId, type, and payload", async () => {
      const type = "user:action";
      const payload = { action: "click", target: "button" };

      const result = await service.recordEvent(PROCESS_ID, type, payload);

      expect(mockEventJournal.record).toHaveBeenCalledTimes(1);
      expect(mockEventJournal.record).toHaveBeenCalledWith(
        PROCESS_ID,
        type,
        payload,
      );
      expect(result).toBe(mockJournalEntry);
    });

    it("should delegate without a payload when none is provided", async () => {
      await service.recordEvent(PROCESS_ID, "process:started");

      expect(mockEventJournal.record).toHaveBeenCalledWith(
        PROCESS_ID,
        "process:started",
        undefined,
      );
    });
  });

  describe("getEventHistory()", () => {
    it("should delegate to eventJournal.getHistory with processId and options", async () => {
      const options = { limit: 25, offset: 50 };

      const result = await service.getEventHistory(PROCESS_ID, options);

      expect(mockEventJournal.getHistory).toHaveBeenCalledTimes(1);
      expect(mockEventJournal.getHistory).toHaveBeenCalledWith(
        PROCESS_ID,
        options,
      );
      expect(result).toEqual({ entries: [mockJournalEntry], total: 1 });
    });

    it("should delegate with no options when omitted", async () => {
      await service.getEventHistory(PROCESS_ID);

      expect(mockEventJournal.getHistory).toHaveBeenCalledWith(
        PROCESS_ID,
        undefined,
      );
    });

    it("should return an empty entries array when journal has no events", async () => {
      mockEventJournal.getHistory.mockResolvedValueOnce({
        entries: [],
        total: 0,
      });

      const result = await service.getEventHistory(PROCESS_ID);

      expect(result.entries).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  // â”€â”€â”€ listAllProcesses() â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("listAllProcesses()", () => {
    it("should delegate to processManager.listAll with no arguments", async () => {
      const result = await service.listAllProcesses();

      expect(mockProcessManager.listAll).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.listAll).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
      expect(result).toEqual([mockProcessSnapshot]);
    });

    it("should forward states and limit to processManager.listAll", async () => {
      const states = ["RUNNING"] as any;

      await service.listAllProcesses(states, 10);

      expect(mockProcessManager.listAll).toHaveBeenCalledWith(states, 10);
    });
  });

  // â”€â”€â”€ Circuit Breaker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("getCircuitBreakerMetrics()", () => {
    it("should delegate to circuitBreaker.getAllHealthMetrics and return result", () => {
      const metrics = [{ entityId: "svc-a", state: "CLOSED", failures: 0 }];
      mockCircuitBreaker.getAllHealthMetrics.mockReturnValueOnce(metrics);

      const result = service.getCircuitBreakerMetrics();

      expect(mockCircuitBreaker.getAllHealthMetrics).toHaveBeenCalledTimes(1);
      expect(result).toBe(metrics);
    });
  });

  describe("getCircuitBreakerStats()", () => {
    it("should delegate to circuitBreaker.getStats and return result", () => {
      const stats = { totalBreakers: 2, oldestBreakerAge: 5000, config: {} };
      mockCircuitBreaker.getStats.mockReturnValueOnce(stats);

      const result = service.getCircuitBreakerStats();

      expect(mockCircuitBreaker.getStats).toHaveBeenCalledTimes(1);
      expect(result).toBe(stats);
    });
  });

  describe("resetCircuitBreaker()", () => {
    it("should delegate to circuitBreaker.reset with entityId", () => {
      const entityId = "external-llm";

      service.resetCircuitBreaker(entityId);

      expect(mockCircuitBreaker.reset).toHaveBeenCalledTimes(1);
      expect(mockCircuitBreaker.reset).toHaveBeenCalledWith(entityId);
    });
  });

  // â”€â”€â”€ IPC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("getEventBusStats()", () => {
    it("should return active subscription count wrapped in object", () => {
      mockEventBus.getActiveSubscriptionCount.mockReturnValueOnce(5);

      const result = service.getEventBusStats();

      expect(mockEventBus.getActiveSubscriptionCount).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ activeSubscriptions: 5 });
    });

    it("should return zero subscriptions when event bus is idle", () => {
      mockEventBus.getActiveSubscriptionCount.mockReturnValueOnce(0);

      const result = service.getEventBusStats();

      expect(result.activeSubscriptions).toBe(0);
    });
  });

  describe("getMessageBusHistory()", () => {
    it("should delegate to messageBus.getHistory with sessionId", () => {
      const sessionId = "session-xyz";
      const history = [{ id: "msg-1", content: "hello" }];
      mockMessageBus.getHistory.mockReturnValueOnce(history);

      const result = service.getMessageBusHistory(sessionId);

      expect(mockMessageBus.getHistory).toHaveBeenCalledTimes(1);
      expect(mockMessageBus.getHistory).toHaveBeenCalledWith(sessionId);
      expect(result).toBe(history);
    });

    it("should return empty array when no history exists for session", () => {
      mockMessageBus.getHistory.mockReturnValueOnce([]);

      const result = service.getMessageBusHistory("empty-session");

      expect(result).toEqual([]);
    });
  });

  describe("getActiveTasks()", () => {
    it("should delegate to progressTracker.getActiveTasks and return result", () => {
      const tasks = [{ taskId: "t1", progress: 50 }];
      mockProgressTracker.getActiveTasks.mockReturnValueOnce(tasks);

      const result = service.getActiveTasks();

      expect(mockProgressTracker.getActiveTasks).toHaveBeenCalledTimes(1);
      expect(result).toBe(tasks);
    });

    it("should return empty array when no active tasks", () => {
      mockProgressTracker.getActiveTasks.mockReturnValueOnce([]);

      const result = service.getActiveTasks();

      expect(result).toEqual([]);
    });
  });

  describe("getTaskProgress()", () => {
    it("should delegate to progressTracker.getProgress with taskId", () => {
      const taskId = "task-abc";
      const progress = { taskId, percent: 75, status: "running" };
      mockProgressTracker.getProgress.mockReturnValueOnce(progress);

      const result = service.getTaskProgress(taskId);

      expect(mockProgressTracker.getProgress).toHaveBeenCalledTimes(1);
      expect(mockProgressTracker.getProgress).toHaveBeenCalledWith(taskId);
      expect(result).toBe(progress);
    });

    it("should return null when task does not exist", () => {
      mockProgressTracker.getProgress.mockReturnValueOnce(null);

      const result = service.getTaskProgress("non-existent");

      expect(result).toBeNull();
    });
  });

  // â”€â”€â”€ Observability â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("getDashboard()", () => {
    it("should delegate to kernelMetrics.getDashboard with no period", () => {
      const dashboard = { totalCalls: 100, avgLatency: 250 };
      mockKernelMetrics.getDashboard.mockReturnValueOnce(dashboard);

      const result = service.getDashboard();

      expect(mockKernelMetrics.getDashboard).toHaveBeenCalledTimes(1);
      expect(mockKernelMetrics.getDashboard).toHaveBeenCalledWith(undefined);
      expect(result).toBe(dashboard);
    });

    it("should forward periodMinutes to kernelMetrics.getDashboard", () => {
      mockKernelMetrics.getDashboard.mockReturnValueOnce({ totalCalls: 50 });

      service.getDashboard(60);

      expect(mockKernelMetrics.getDashboard).toHaveBeenCalledWith(60);
    });
  });

  describe("getCostReport()", () => {
    it("should delegate to costAttribution.getCostReport with no options", () => {
      const report = { totalCost: 1.5, breakdown: [] };
      mockCostAttribution.getCostReport.mockReturnValueOnce(report);

      const result = service.getCostReport();

      expect(mockCostAttribution.getCostReport).toHaveBeenCalledTimes(1);
      expect(mockCostAttribution.getCostReport).toHaveBeenCalledWith(undefined);
      expect(result).toBe(report);
    });

    it("should forward options to costAttribution.getCostReport", () => {
      mockCostAttribution.getCostReport.mockReturnValueOnce({ totalCost: 0.5 });
      const options = { periodHours: 24, userId: USER_ID };

      service.getCostReport(options);

      expect(mockCostAttribution.getCostReport).toHaveBeenCalledWith(options);
    });
  });

  describe("getHourlyTrend()", () => {
    it("should delegate to costAttribution.getHourlyTrend with no hours", () => {
      const trend = [{ hour: "10:00", cost: 0.1 }];
      mockCostAttribution.getHourlyTrend.mockReturnValueOnce(trend);

      const result = service.getHourlyTrend();

      expect(mockCostAttribution.getHourlyTrend).toHaveBeenCalledTimes(1);
      expect(mockCostAttribution.getHourlyTrend).toHaveBeenCalledWith(
        undefined,
      );
      expect(result).toBe(trend);
    });

    it("should forward hours to costAttribution.getHourlyTrend", () => {
      mockCostAttribution.getHourlyTrend.mockReturnValueOnce([]);

      service.getHourlyTrend(12);

      expect(mockCostAttribution.getHourlyTrend).toHaveBeenCalledWith(12);
    });
  });

  describe("checkBudgetAlerts()", () => {
    it("should delegate to costAttribution.checkBudgetAlerts and return result", () => {
      const alerts = [{ type: "WARNING", message: "80% budget used" }];
      mockCostAttribution.checkBudgetAlerts.mockReturnValueOnce(alerts);

      const result = service.checkBudgetAlerts();

      expect(mockCostAttribution.checkBudgetAlerts).toHaveBeenCalledTimes(1);
      expect(result).toBe(alerts);
    });

    it("should return empty array when no budget alerts", () => {
      mockCostAttribution.checkBudgetAlerts.mockReturnValueOnce([]);

      const result = service.checkBudgetAlerts();

      expect(result).toEqual([]);
    });
  });

  // â”€â”€â”€ Security â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("getCapabilities()", () => {
    it("should delegate to capabilityGuard.getCapabilities with processId", async () => {
      const capabilities = {
        grantedTools: ["web-search"],
        grantedSkills: [],
        dataScope: null,
      };
      mockCapabilityGuard.getCapabilities.mockResolvedValueOnce(capabilities);

      const result = await service.getCapabilities(PROCESS_ID);

      expect(mockCapabilityGuard.getCapabilities).toHaveBeenCalledTimes(1);
      expect(mockCapabilityGuard.getCapabilities).toHaveBeenCalledWith(
        PROCESS_ID,
      );
      expect(result).toBe(capabilities);
    });

    it("should return empty capabilities when process has no grants", async () => {
      mockCapabilityGuard.getCapabilities.mockResolvedValueOnce({
        grantedTools: [],
        grantedSkills: [],
        dataScope: null,
      });

      const result = await service.getCapabilities(PROCESS_ID);

      expect(result.grantedTools).toHaveLength(0);
    });
  });

  // â”€â”€â”€ Scheduler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("getSchedulerStats()", () => {
    it("should delegate to kernelScheduler.getStats and return result", async () => {
      const stats = {
        running: 3,
        ready: 7,
        maxConcurrent: 50,
        maxPerTenant: 10,
      };
      mockKernelScheduler.getStats.mockResolvedValueOnce(stats);

      const result = await service.getSchedulerStats();

      expect(mockKernelScheduler.getStats).toHaveBeenCalledTimes(1);
      expect(result).toBe(stats);
    });
  });

  // â”€â”€â”€ Memory (admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe("cleanupExpiredMemory()", () => {
    it("should delegate to memoryManager.cleanup with processId and return count", async () => {
      mockMemoryManager.cleanup.mockResolvedValueOnce(4);

      const result = await service.cleanupExpiredMemory(PROCESS_ID);

      expect(mockMemoryManager.cleanup).toHaveBeenCalledTimes(1);
      expect(mockMemoryManager.cleanup).toHaveBeenCalledWith(PROCESS_ID);
      expect(result).toBe(4);
    });

    it("should return 0 when no expired entries were cleaned up", async () => {
      const result = await service.cleanupExpiredMemory(PROCESS_ID);

      expect(mockMemoryManager.cleanup).toHaveBeenCalledWith(PROCESS_ID);
      expect(result).toBe(0);
    });
  });
});

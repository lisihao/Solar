/**
 * KernelController unit tests
 *
 * Covers:
 * - listProcesses – by userId, by state filter, with limit, without userId (listAll)
 * - getProcess – found / not found
 * - getProcessJournal
 * - checkBudget
 * - pauseProcess / resumeProcess / cancelProcess
 * - completeMission / failMission
 * - listJournal – with/without filters, DB error fallback
 * - queryMemory – with layer, without layer, with limit, invalid layer ignored
 * - cleanupExpiredMemory
 * - getIpcStats
 * - getActiveProgress
 * - getMessageHistory
 * - getCircuitBreakers / getCircuitBreakerStats / resetCircuitBreaker
 * - getDashboard – period parsing, response shape
 * - getCostReport
 * - getCostTrend
 * - getCapabilities
 * - getSchedulerStats
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { MemoryLayer, ProcessState } from "@prisma/client";
import { KernelController } from "../kernel/kernel.controller";
import { KernelApiService } from "../../../ai-harness/facade";
import { ProcessJournalQueryService } from "../../../ai-harness/memory/process-journal-query.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

// ─── mock factories ───────────────────────────────────────────────────────────

const makeProcess = (overrides: Record<string, unknown> = {}) => ({
  id: "proc-1",
  userId: "user-1",
  state: ProcessState.RUNNING,
  type: "MISSION",
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeDashboard = () => ({
  period: { start: new Date(), end: new Date() },
  totalCalls: 100,
  totalTokens: 5000,
  totalCost: 1.5,
  successRate: 0.98,
  avgLatencyMs: 200,
  p95LatencyMs: 400,
  p99LatencyMs: 600,
  fallbackRate: 0.01,
  byModel: { "gpt-4": { calls: 50, tokens: 2500, cost: 0.75, latencyMs: 200 } },
  byModule: { research: { calls: 50, tokens: 2500, cost: 0.75 } },
  byUser: [{ userId: "user-1", calls: 100, cost: 1.5 }],
  recentErrors: [{ model: "gpt-4", error: "timeout", timestamp: new Date() }],
});

const makeCostReport = () => ({
  period: { start: new Date(), end: new Date() },
  totalCost: 2.0,
  totalTokens: 10000,
  byUser: [],
  byModule: [],
  byModel: [],
  hourlyTrend: [],
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("KernelController", () => {
  let controller: KernelController;
  let mockKernelApi: jest.Mocked<Partial<KernelApiService>>;
  let mockPrisma: {
    processEvent: {
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockKernelApi = {
      listProcesses: jest.fn().mockResolvedValue([]),
      listAllProcesses: jest.fn().mockResolvedValue([]),
      getProcess: jest.fn().mockResolvedValue(null),
      getEventHistory: jest.fn().mockResolvedValue({ entries: [], total: 0 }),
      checkBudget: jest.fn().mockResolvedValue({ canProceed: true }),
      pauseProcess: jest.fn().mockResolvedValue(makeProcess()),
      resumeProcess: jest.fn().mockResolvedValue(makeProcess()),
      cancelProcess: jest.fn().mockResolvedValue(makeProcess()),
      completeMission: jest.fn().mockResolvedValue(undefined),
      failMission: jest.fn().mockResolvedValue(undefined),
      queryMemory: jest.fn().mockResolvedValue([]),
      cleanupExpiredMemory: jest.fn().mockResolvedValue(5),
      getEventBusStats: jest.fn().mockReturnValue({ activeSubscriptions: 10 }),
      getActiveTasks: jest.fn().mockReturnValue([]),
      getMessageBusHistory: jest.fn().mockReturnValue([]),
      getCircuitBreakerMetrics: jest.fn().mockReturnValue([]),
      getCircuitBreakerStats: jest.fn().mockReturnValue({ total: 0 }),
      resetCircuitBreaker: jest.fn(),
      getDashboardWithFallback: jest.fn().mockResolvedValue(makeDashboard()),
      getCostReport: jest.fn().mockReturnValue(makeCostReport()),
      getHourlyTrend: jest.fn().mockReturnValue([]),
      getCapabilities: jest.fn().mockResolvedValue({ tools: [] }),
      getSchedulerStats: jest.fn().mockResolvedValue({ jobs: 0 }),
    };

    mockPrisma = {
      processEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KernelController],
      providers: [
        { provide: KernelApiService, useValue: mockKernelApi },
        ProcessJournalQueryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<KernelController>(KernelController);
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // listProcesses
  // ──────────────────────────────────────────────────────────────────────────

  describe("listProcesses", () => {
    it("calls listProcesses when userId is provided", async () => {
      mockKernelApi.listProcesses!.mockResolvedValue([makeProcess()]);

      const result = await controller.listProcesses(
        "user-1",
        undefined,
        undefined,
      );

      expect(mockKernelApi.listProcesses).toHaveBeenCalledWith(
        "user-1",
        undefined,
      );
      expect(result.total).toBe(1);
    });

    it("calls listAllProcesses when no userId", async () => {
      mockKernelApi.listAllProcesses!.mockResolvedValue([makeProcess()]);

      const result = await controller.listProcesses(undefined, undefined, "10");

      expect(mockKernelApi.listAllProcesses).toHaveBeenCalledWith(
        undefined,
        10,
      );
      expect(result.processes).toHaveLength(1);
    });

    it("parses state filter correctly", async () => {
      mockKernelApi.listAllProcesses!.mockResolvedValue([]);

      await controller.listProcesses(undefined, "RUNNING,PAUSED", "50");

      expect(mockKernelApi.listAllProcesses).toHaveBeenCalledWith(
        [ProcessState.RUNNING, ProcessState.PAUSED],
        50,
      );
    });

    it("ignores invalid states in filter", async () => {
      mockKernelApi.listAllProcesses!.mockResolvedValue([]);

      await controller.listProcesses(undefined, "RUNNING,INVALID_STATE", "50");

      const stateArg = (mockKernelApi.listAllProcesses as jest.Mock).mock
        .calls[0][0];
      expect(stateArg).not.toContain("INVALID_STATE");
    });

    it("passes undefined stateFilter when states string is empty after filtering", async () => {
      mockKernelApi.listAllProcesses!.mockResolvedValue([]);

      await controller.listProcesses(undefined, "INVALID_STATE", "50");

      expect(mockKernelApi.listAllProcesses).toHaveBeenCalledWith(
        undefined,
        50,
      );
    });

    it("defaults to limit=50 when limit param is absent", async () => {
      mockKernelApi.listAllProcesses!.mockResolvedValue([]);

      await controller.listProcesses(undefined, undefined, undefined);

      const limitArg = (mockKernelApi.listAllProcesses as jest.Mock).mock
        .calls[0][1];
      expect(limitArg).toBe(50);
    });

    it("truncates processes array to maxResults", async () => {
      const processes = Array.from({ length: 10 }, (_, i) =>
        makeProcess({ id: `proc-${i}` }),
      );
      mockKernelApi.listAllProcesses!.mockResolvedValue(processes);

      const result = await controller.listProcesses(undefined, undefined, "5");

      expect(result.processes).toHaveLength(5);
      expect(result.total).toBe(10);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getProcess
  // ──────────────────────────────────────────────────────────────────────────

  describe("getProcess", () => {
    it("returns process when found", async () => {
      const process = makeProcess({ id: "proc-1" });
      mockKernelApi.getProcess!.mockResolvedValue(process);

      const result = await controller.getProcess("proc-1");

      expect(result).toEqual(process);
    });

    it("returns error object when process not found", async () => {
      mockKernelApi.getProcess!.mockResolvedValue(null);

      const result = await controller.getProcess("nonexistent");

      expect((result as { error: string }).error).toBe("Process not found");
      expect((result as { processId: string }).processId).toBe("nonexistent");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // getProcessJournal
  // ──────────────────────────────────────────────────────────────────────────

  describe("getProcessJournal", () => {
    it("calls getEventHistory with parsed limit and offset", async () => {
      mockKernelApi.getEventHistory!.mockResolvedValue({
        entries: [],
        total: 0,
      });

      await controller.getProcessJournal("proc-1", "20", "10");

      expect(mockKernelApi.getEventHistory).toHaveBeenCalledWith("proc-1", {
        limit: 20,
        offset: 10,
      });
    });

    it("defaults limit=100 offset=0 when not provided", async () => {
      await controller.getProcessJournal("proc-1", undefined, undefined);

      expect(mockKernelApi.getEventHistory).toHaveBeenCalledWith("proc-1", {
        limit: 100,
        offset: 0,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // checkBudget
  // ──────────────────────────────────────────────────────────────────────────

  describe("checkBudget", () => {
    it("delegates to kernelApi.checkBudget", async () => {
      mockKernelApi.checkBudget!.mockResolvedValue({
        canProceed: false,
        reason: "Over budget",
      });

      const result = await controller.checkBudget("proc-1");

      expect(result).toEqual({ canProceed: false, reason: "Over budget" });
      expect(mockKernelApi.checkBudget).toHaveBeenCalledWith("proc-1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // pauseProcess / resumeProcess / cancelProcess
  // ──────────────────────────────────────────────────────────────────────────

  describe("process actions", () => {
    it("pauseProcess returns success with process", async () => {
      const process = makeProcess({ state: ProcessState.PAUSED });
      mockKernelApi.pauseProcess!.mockResolvedValue(process);

      const result = await controller.pauseProcess("proc-1");

      expect(result.success).toBe(true);
      expect(result.process).toEqual(process);
    });

    it("resumeProcess returns success with process", async () => {
      const process = makeProcess({ state: ProcessState.RUNNING });
      mockKernelApi.resumeProcess!.mockResolvedValue(process);

      const result = await controller.resumeProcess("proc-1");

      expect(result.success).toBe(true);
      expect(result.process).toEqual(process);
    });

    it("cancelProcess returns success with process", async () => {
      const process = makeProcess({ state: ProcessState.CANCELLED });
      mockKernelApi.cancelProcess!.mockResolvedValue(process);

      const result = await controller.cancelProcess("proc-1");

      expect(result.success).toBe(true);
      expect(result.process).toEqual(process);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // completeMission / failMission
  // ──────────────────────────────────────────────────────────────────────────

  describe("mission actions", () => {
    it("completeMission calls kernelApi.completeMission with reason", async () => {
      const result = await controller.completeMission("proc-1");

      expect(mockKernelApi.completeMission).toHaveBeenCalledWith("proc-1", {
        reason: "admin_force_complete",
      });
      expect(result.success).toBe(true);
    });

    it("failMission calls kernelApi.failMission with message", async () => {
      const result = await controller.failMission("proc-1");

      expect(mockKernelApi.failMission).toHaveBeenCalledWith(
        "proc-1",
        "Admin force-failed",
      );
      expect(result.success).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // listJournal
  // ──────────────────────────────────────────────────────────────────────────

  describe("listJournal", () => {
    it("returns entries and total from prisma", async () => {
      const events = [{ id: "evt-1", type: "STARTED", createdAt: new Date() }];
      mockPrisma.processEvent.findMany.mockResolvedValue(events);
      mockPrisma.processEvent.count.mockResolvedValue(1);

      const result = await controller.listJournal(
        undefined,
        undefined,
        undefined,
      );

      expect(result.entries).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("filters by processId when provided", async () => {
      mockPrisma.processEvent.findMany.mockResolvedValue([]);
      mockPrisma.processEvent.count.mockResolvedValue(0);

      await controller.listJournal("proc-1", undefined, "50");

      const findManyArgs = mockPrisma.processEvent.findMany.mock.calls[0][0];
      expect(findManyArgs.where.processId).toBe("proc-1");
    });

    it("filters by type when provided", async () => {
      mockPrisma.processEvent.findMany.mockResolvedValue([]);
      mockPrisma.processEvent.count.mockResolvedValue(0);

      await controller.listJournal(undefined, "STARTED", "50");

      const findManyArgs = mockPrisma.processEvent.findMany.mock.calls[0][0];
      expect(findManyArgs.where.type).toBe("STARTED");
    });

    it("defaults take to 100 when limit is not provided", async () => {
      mockPrisma.processEvent.findMany.mockResolvedValue([]);
      mockPrisma.processEvent.count.mockResolvedValue(0);

      await controller.listJournal(undefined, undefined, undefined);

      const findManyArgs = mockPrisma.processEvent.findMany.mock.calls[0][0];
      expect(findManyArgs.take).toBe(100);
    });

    it("returns empty result when prisma throws", async () => {
      mockPrisma.processEvent.findMany.mockRejectedValue(new Error("DB error"));

      const result = await controller.listJournal(
        undefined,
        undefined,
        undefined,
      );

      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // queryMemory
  // ──────────────────────────────────────────────────────────────────────────

  describe("queryMemory", () => {
    it("queries memory with processId", async () => {
      mockKernelApi.queryMemory!.mockResolvedValue([]);

      const result = await controller.queryMemory(
        "proc-1",
        undefined,
        undefined,
      );

      expect(mockKernelApi.queryMemory).toHaveBeenCalledWith(
        expect.objectContaining({ processId: "proc-1" }),
      );
      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("includes valid MemoryLayer in query", async () => {
      mockKernelApi.queryMemory!.mockResolvedValue([]);

      await controller.queryMemory("proc-1", MemoryLayer.WORKING, undefined);

      expect(mockKernelApi.queryMemory).toHaveBeenCalledWith(
        expect.objectContaining({ layer: MemoryLayer.WORKING }),
      );
    });

    it("ignores invalid layer string", async () => {
      mockKernelApi.queryMemory!.mockResolvedValue([]);

      await controller.queryMemory(
        "proc-1",
        "INVALID_LAYER" as never,
        undefined,
      );

      const queryArg = (mockKernelApi.queryMemory as jest.Mock).mock
        .calls[0][0];
      expect(queryArg.layer).toBeUndefined();
    });

    it("parses limit when provided", async () => {
      mockKernelApi.queryMemory!.mockResolvedValue([]);

      await controller.queryMemory("proc-1", undefined, "25");

      const queryArg = (mockKernelApi.queryMemory as jest.Mock).mock
        .calls[0][0];
      expect(queryArg.limit).toBe(25);
    });

    it("returns total as entries.length", async () => {
      const entries = [{ key: "k1" }, { key: "k2" }];
      mockKernelApi.queryMemory!.mockResolvedValue(entries as never);

      const result = await controller.queryMemory(
        "proc-1",
        undefined,
        undefined,
      );

      expect(result.total).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // cleanupExpiredMemory
  // ──────────────────────────────────────────────────────────────────────────

  describe("cleanupExpiredMemory", () => {
    it("calls kernelApi and returns deleted count", async () => {
      mockKernelApi.cleanupExpiredMemory!.mockResolvedValue(7);

      const result = await controller.cleanupExpiredMemory("proc-1");

      expect(result.success).toBe(true);
      expect(result.deleted).toBe(7);
      expect(mockKernelApi.cleanupExpiredMemory).toHaveBeenCalledWith("proc-1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IPC
  // ──────────────────────────────────────────────────────────────────────────

  describe("getIpcStats", () => {
    it("merges eventBusStats with activeTaskCount", async () => {
      mockKernelApi.getEventBusStats!.mockReturnValue({
        activeSubscriptions: 15,
      });
      mockKernelApi.getActiveTasks!.mockReturnValue([{}, {}] as never);

      const result = await controller.getIpcStats();

      expect(result.activeSubscriptions).toBe(15);
      expect(result.activeTaskCount).toBe(2);
    });
  });

  describe("getActiveProgress", () => {
    it("returns tasks and total count", () => {
      mockKernelApi.getActiveTasks!.mockReturnValue([{}, {}, {}] as never);

      const result = controller.getActiveProgress();

      expect(result.total).toBe(3);
      expect(result.tasks).toHaveLength(3);
    });
  });

  describe("getMessageHistory", () => {
    it("returns messages and total for sessionId", () => {
      mockKernelApi.getMessageBusHistory!.mockReturnValue([
        { id: "msg-1" },
        { id: "msg-2" },
      ] as never);

      const result = controller.getMessageHistory("session-abc");

      expect(result.total).toBe(2);
      expect(mockKernelApi.getMessageBusHistory).toHaveBeenCalledWith(
        "session-abc",
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Resources / Circuit Breakers
  // ──────────────────────────────────────────────────────────────────────────

  describe("circuit breakers", () => {
    it("getCircuitBreakers returns breakers and total", () => {
      mockKernelApi.getCircuitBreakerMetrics!.mockReturnValue([
        { entityId: "svc-1", state: "CLOSED" },
      ] as never);

      const result = controller.getCircuitBreakers();

      expect(result.total).toBe(1);
      expect(result.breakers).toHaveLength(1);
    });

    it("getCircuitBreakerStats delegates to kernelApi", () => {
      mockKernelApi.getCircuitBreakerStats!.mockReturnValue({
        total: 5,
        open: 1,
      } as never);

      const result = controller.getCircuitBreakerStats();

      expect(result).toEqual({ total: 5, open: 1 });
    });

    it("resetCircuitBreaker calls kernelApi and returns success", () => {
      const result = controller.resetCircuitBreaker("svc-abc");

      expect(mockKernelApi.resetCircuitBreaker).toHaveBeenCalledWith("svc-abc");
      expect(result.success).toBe(true);
      expect(result.entityId).toBe("svc-abc");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Observability
  // ──────────────────────────────────────────────────────────────────────────

  describe("getDashboard", () => {
    it("calls getDashboardWithFallback with parsed period", async () => {
      const dashboard = makeDashboard();
      mockKernelApi.getDashboardWithFallback!.mockResolvedValue(dashboard);

      const result = await controller.getDashboard("30");

      expect(mockKernelApi.getDashboardWithFallback).toHaveBeenCalledWith(30);
      expect(result.totalCalls).toBe(100);
    });

    it("defaults to 60 minutes when period is not provided", async () => {
      mockKernelApi.getDashboardWithFallback!.mockResolvedValue(
        makeDashboard(),
      );

      await controller.getDashboard(undefined);

      expect(mockKernelApi.getDashboardWithFallback).toHaveBeenCalledWith(60);
    });

    it("formats period with ISO timestamps", async () => {
      mockKernelApi.getDashboardWithFallback!.mockResolvedValue(
        makeDashboard(),
      );

      const result = await controller.getDashboard("60");

      expect(typeof result.period.startTime).toBe("string");
      expect(typeof result.period.endTime).toBe("string");
      expect(result.period.minutes).toBe(60);
    });

    it("maps byModel entries to array", async () => {
      const dashboard = makeDashboard();
      mockKernelApi.getDashboardWithFallback!.mockResolvedValue(dashboard);

      const result = await controller.getDashboard("60");

      expect(Array.isArray(result.byModel)).toBe(true);
      expect(result.byModel[0].model).toBe("gpt-4");
    });

    it("maps recentErrors with iso timestamp", async () => {
      const dashboard = makeDashboard();
      mockKernelApi.getDashboardWithFallback!.mockResolvedValue(dashboard);

      const result = await controller.getDashboard("60");

      expect(Array.isArray(result.recentErrors)).toBe(true);
      expect(typeof result.recentErrors[0].timestamp).toBe("string");
    });

    it("handles non-Date timestamp in recentErrors", async () => {
      const dashboard = {
        ...makeDashboard(),
        recentErrors: [
          { model: "gpt-4", error: "timeout", timestamp: "2024-01-01" },
        ],
      };
      mockKernelApi.getDashboardWithFallback!.mockResolvedValue(dashboard);

      const result = await controller.getDashboard("60");

      expect(result.recentErrors[0].timestamp).toBe("2024-01-01");
    });
  });

  describe("getCostReport", () => {
    // 2026-05-15 Round 2 修正：getCostReport / getHourlyTrend 实际同步（仅 controller
    // 方法是 async 以兼容 HTTP handler），mock 用 mockReturnValue 即可，过去误用
    // mockResolvedValue 在 controller 去 await 后会传 Promise 对象给 .toISOString。
    it("calls getCostReport with parsed hours", async () => {
      mockKernelApi.getCostReport!.mockReturnValue(makeCostReport());

      const result = await controller.getCostReport("12");

      expect(mockKernelApi.getCostReport).toHaveBeenCalledWith({
        periodHours: 12,
      });
      expect(result.totalCost).toBe(2.0);
    });

    it("defaults to 24 hours when not provided", async () => {
      mockKernelApi.getCostReport!.mockReturnValue(makeCostReport());

      await controller.getCostReport(undefined);

      expect(mockKernelApi.getCostReport).toHaveBeenCalledWith({
        periodHours: 24,
      });
    });

    it("formats period with ISO timestamps", async () => {
      mockKernelApi.getCostReport!.mockReturnValue(makeCostReport());

      const result = await controller.getCostReport("24");

      expect(typeof result.period.startTime).toBe("string");
      expect(typeof result.period.endTime).toBe("string");
    });
  });

  describe("getCostTrend", () => {
    it("returns trend array from kernelApi", async () => {
      const trend = [
        { hour: "2024-01-01T00:00:00.000Z", cost: 0.5, calls: 10 },
      ];
      mockKernelApi.getHourlyTrend!.mockReturnValue(trend);

      const result = await controller.getCostTrend("6");

      expect(result.trend).toEqual(trend);
      expect(result.total).toBe(1);
      expect(mockKernelApi.getHourlyTrend).toHaveBeenCalledWith(6);
    });

    it("defaults to 24 hours when not provided", async () => {
      mockKernelApi.getHourlyTrend!.mockReturnValue([]);

      await controller.getCostTrend(undefined);

      expect(mockKernelApi.getHourlyTrend).toHaveBeenCalledWith(24);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Security
  // ──────────────────────────────────────────────────────────────────────────

  describe("getCapabilities", () => {
    it("delegates to kernelApi.getCapabilities", async () => {
      const caps = { tools: ["read", "write"] };
      mockKernelApi.getCapabilities!.mockResolvedValue(caps as never);

      const result = await controller.getCapabilities("proc-1");

      expect(result).toEqual(caps);
      expect(mockKernelApi.getCapabilities).toHaveBeenCalledWith("proc-1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Scheduler
  // ──────────────────────────────────────────────────────────────────────────

  describe("getSchedulerStats", () => {
    it("delegates to kernelApi.getSchedulerStats", async () => {
      const stats = { jobs: 3, active: 1 };
      mockKernelApi.getSchedulerStats!.mockResolvedValue(stats);

      const result = await controller.getSchedulerStats();

      expect(result).toEqual(stats);
    });
  });
});

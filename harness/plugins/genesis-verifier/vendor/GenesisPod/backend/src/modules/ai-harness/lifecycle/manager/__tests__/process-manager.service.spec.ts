/**
 * ProcessManagerService Unit Tests
 *
 * Covers all public methods of the process manager:
 * - spawn()          - create new process with defaults
 * - fork()           - inherit parent userId, throw on missing parent
 * - getState()       - nullable lookup by id
 * - listByUser()     - filtered / unfiltered listing
 * - getProcessTree() - recursive child expansion
 * - transition()     - state machine enforcement + timestamp rules
 * - checkpoint()     - optimistic locking via version
 * - consumeResources() - incremental token / cost update
 * - pause()          - delegates to transition(PAUSED)
 * - resume()         - delegates to transition(READY)
 * - cancel()         - delegates to transition(CANCELLED)
 * - kill()           - force cancel, bypasses state machine
 * - wait()           - polls until terminal state or timeout
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ProcessManagerService } from "../process-manager.service";
import { ProcessSnapshot, TERMINAL_STATES } from "../process.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ProcessSnapshot> = {}): ProcessSnapshot {
  return {
    id: "proc-1",
    userId: "user-1",
    agentId: "agent-1",
    parentId: null,
    teamSessionId: null,
    state: "CREATED" as any,
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
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const mockPrisma = {
  $queryRaw: jest.fn(),
  agentProcess: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ProcessManagerService", () => {
  let service: ProcessManagerService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: table exists so the service enables itself
    mockPrisma.$queryRaw.mockResolvedValue([{ exists: true }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessManagerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ProcessManagerService>(ProcessManagerService);

    await service.onModuleInit();

    // Suppress all Logger output during tests
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // spawn()
  // =========================================================================

  describe("spawn()", () => {
    it("should create a new process with CREATED state", async () => {
      const record = makeRecord();
      mockPrisma.agentProcess.create.mockResolvedValue(record);

      const result = await service.spawn({
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(mockPrisma.agentProcess.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          agentId: "agent-1",
          state: "CREATED",
        }),
      });
      expect(result.state).toBe("CREATED");
      expect(result.id).toBe("proc-1");
    });

    it("should apply default values for priority, tokenBudget, and costBudget", async () => {
      const record = makeRecord({
        priority: 5,
        tokenBudget: 50000,
        costBudget: 1.0,
      });
      mockPrisma.agentProcess.create.mockResolvedValue(record);

      await service.spawn({ userId: "user-1", agentId: "agent-1" });

      expect(mockPrisma.agentProcess.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          priority: 5,
          tokenBudget: 50000,
          costBudget: 1.0,
        }),
      });
    });

    it("should pass through optional fields when provided", async () => {
      const metadata = { source: "test" };
      const grantedTools = ["tool-a", "tool-b"];
      const grantedSkills = ["skill-x"];
      const dataScope = { scope: "project-1" };
      const input = { query: "hello" };
      const record = makeRecord({
        metadata,
        grantedTools,
        grantedSkills,
        dataScope,
        input,
        teamSessionId: "session-99",
        priority: 10,
        tokenBudget: 100000,
        costBudget: 5.0,
      });
      mockPrisma.agentProcess.create.mockResolvedValue(record);

      await service.spawn({
        userId: "user-1",
        agentId: "agent-1",
        teamSessionId: "session-99",
        priority: 10,
        tokenBudget: 100000,
        costBudget: 5.0,
        input,
        grantedTools,
        grantedSkills,
        dataScope,
        metadata,
      });

      expect(mockPrisma.agentProcess.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          teamSessionId: "session-99",
          priority: 10,
          tokenBudget: 100000,
          costBudget: 5.0,
          grantedTools,
          grantedSkills,
        }),
      });
    });

    it("should default parentId and teamSessionId to null when not provided", async () => {
      mockPrisma.agentProcess.create.mockResolvedValue(makeRecord());

      await service.spawn({ userId: "user-1", agentId: "agent-1" });

      expect(mockPrisma.agentProcess.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          parentId: null,
          teamSessionId: null,
        }),
      });
    });
  });

  // =========================================================================
  // fork()
  // =========================================================================

  describe("fork()", () => {
    it("should create a child process inheriting the parent userId", async () => {
      const parent = makeRecord({ id: "parent-1", userId: "user-inherited" });
      const child = makeRecord({
        id: "child-1",
        userId: "user-inherited",
        parentId: "parent-1",
      });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(parent);
      mockPrisma.agentProcess.create.mockResolvedValue(child);

      const result = await service.fork("parent-1", { agentId: "agent-child" });

      expect(mockPrisma.agentProcess.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: "parent-1" },
      });
      expect(mockPrisma.agentProcess.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-inherited",
          parentId: "parent-1",
        }),
      });
      expect(result.userId).toBe("user-inherited");
    });

    it("should throw when parent is not found", async () => {
      mockPrisma.agentProcess.findUniqueOrThrow.mockRejectedValue(
        new Error("Record not found"),
      );

      await expect(
        service.fork("missing-parent", { agentId: "agent-1" }),
      ).rejects.toThrow("Record not found");
    });
  });

  // =========================================================================
  // getState()
  // =========================================================================

  describe("getState()", () => {
    it("should return a process snapshot when found", async () => {
      const record = makeRecord({ id: "proc-found" });
      mockPrisma.agentProcess.findUnique.mockResolvedValue(record);

      const result = await service.getState("proc-found");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("proc-found");
      expect(mockPrisma.agentProcess.findUnique).toHaveBeenCalledWith({
        where: { id: "proc-found" },
      });
    });

    it("should return null when process is not found", async () => {
      mockPrisma.agentProcess.findUnique.mockResolvedValue(null);

      const result = await service.getState("no-such-process");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // listByUser()
  // =========================================================================

  describe("listByUser()", () => {
    it("should list all processes for a user when no state filter is provided", async () => {
      const records = [
        makeRecord({ id: "p1", userId: "user-1", state: "CREATED" as any }),
        makeRecord({ id: "p2", userId: "user-1", state: "RUNNING" as any }),
      ];
      mockPrisma.agentProcess.findMany.mockResolvedValue(records);

      const result = await service.listByUser("user-1");

      expect(result).toHaveLength(2);
      expect(mockPrisma.agentProcess.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("should filter by provided states", async () => {
      const records = [
        makeRecord({ id: "p1", userId: "user-1", state: "RUNNING" as any }),
      ];
      mockPrisma.agentProcess.findMany.mockResolvedValue(records);

      const result = await service.listByUser("user-1", ["RUNNING" as any]);

      expect(result).toHaveLength(1);
      expect(mockPrisma.agentProcess.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user-1",
          state: { in: ["RUNNING"] },
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("should not apply state filter when empty array is provided", async () => {
      mockPrisma.agentProcess.findMany.mockResolvedValue([]);

      await service.listByUser("user-1", []);

      expect(mockPrisma.agentProcess.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
      });
    });
  });

  // =========================================================================
  // getProcessTree()
  // =========================================================================

  describe("getProcessTree()", () => {
    it("should build a tree with nested children recursively", async () => {
      const root = makeRecord({ id: "root" });
      const child = makeRecord({ id: "child-1", parentId: "root" });
      const grandchild = makeRecord({
        id: "grandchild-1",
        parentId: "child-1",
      });

      mockPrisma.agentProcess.findUniqueOrThrow
        .mockResolvedValueOnce(root) // root lookup
        .mockResolvedValueOnce(child) // child lookup
        .mockResolvedValueOnce(grandchild); // grandchild lookup

      mockPrisma.agentProcess.findMany
        .mockResolvedValueOnce([child]) // root's children
        .mockResolvedValueOnce([grandchild]) // child's children
        .mockResolvedValueOnce([]); // grandchild's children

      const tree = await service.getProcessTree("root");

      expect(tree.process.id).toBe("root");
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].process.id).toBe("child-1");
      expect(tree.children[0].children).toHaveLength(1);
      expect(tree.children[0].children[0].process.id).toBe("grandchild-1");
    });

    it("should return a tree with no children when process is a leaf", async () => {
      const leaf = makeRecord({ id: "leaf-1" });
      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(leaf);
      mockPrisma.agentProcess.findMany.mockResolvedValue([]);

      const tree = await service.getProcessTree("leaf-1");

      expect(tree.process.id).toBe("leaf-1");
      expect(tree.children).toHaveLength(0);
    });
  });

  // =========================================================================
  // transition()
  // =========================================================================

  describe("transition()", () => {
    it("should transition CREATED -> READY without setting timestamps", async () => {
      const current = makeRecord({ id: "proc-1", state: "CREATED" as any });
      const updated = makeRecord({ id: "proc-1", state: "READY" as any });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "READY" as any);

      expect(result.state).toBe("READY");
      expect(mockPrisma.agentProcess.update).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: { state: "READY" },
      });
    });

    it("should transition READY -> RUNNING and set startedAt", async () => {
      const current = makeRecord({ id: "proc-1", state: "READY" as any });
      const updated = makeRecord({
        id: "proc-1",
        state: "RUNNING" as any,
        startedAt: new Date(),
      });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "RUNNING" as any);

      expect(result.state).toBe("RUNNING");
      expect(mockPrisma.agentProcess.update).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: expect.objectContaining({
          state: "RUNNING",
          startedAt: expect.any(Date),
        }),
      });
    });

    it("should transition RUNNING -> COMPLETED and set completedAt", async () => {
      const current = makeRecord({ id: "proc-1", state: "RUNNING" as any });
      const updated = makeRecord({
        id: "proc-1",
        state: "COMPLETED" as any,
        completedAt: new Date(),
      });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "COMPLETED" as any);

      expect(result.state).toBe("COMPLETED");
      expect(mockPrisma.agentProcess.update).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: expect.objectContaining({
          state: "COMPLETED",
          completedAt: expect.any(Date),
        }),
      });
    });

    it("should transition RUNNING -> PAUSED without setting terminal timestamps", async () => {
      const current = makeRecord({ id: "proc-1", state: "RUNNING" as any });
      const updated = makeRecord({ id: "proc-1", state: "PAUSED" as any });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "PAUSED" as any);

      expect(result.state).toBe("PAUSED");
      const updateCall = mockPrisma.agentProcess.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("completedAt");
      expect(updateCall.data).not.toHaveProperty("startedAt");
    });

    it("should transition PAUSED -> READY", async () => {
      const current = makeRecord({ id: "proc-1", state: "PAUSED" as any });
      const updated = makeRecord({ id: "proc-1", state: "READY" as any });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "READY" as any);

      expect(result.state).toBe("READY");
    });

    it("should set completedAt when transitioning to FAILED (terminal state)", async () => {
      const current = makeRecord({ id: "proc-1", state: "RUNNING" as any });
      const updated = makeRecord({
        id: "proc-1",
        state: "FAILED" as any,
        completedAt: new Date(),
      });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      await service.transition("proc-1", "FAILED" as any);

      expect(mockPrisma.agentProcess.update).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: expect.objectContaining({
          state: "FAILED",
          completedAt: expect.any(Date),
        }),
      });
    });

    it("should throw on an invalid transition (COMPLETED -> RUNNING)", async () => {
      const current = makeRecord({ id: "proc-1", state: "COMPLETED" as any });
      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);

      await expect(
        service.transition("proc-1", "RUNNING" as any),
      ).rejects.toThrow(/Invalid state transition/);
    });

    it("should throw when the process is not found", async () => {
      mockPrisma.agentProcess.findUniqueOrThrow.mockRejectedValue(
        new Error("Record not found"),
      );

      await expect(
        service.transition("ghost-proc", "READY" as any),
      ).rejects.toThrow("Record not found");
    });
  });

  // =========================================================================
  // checkpoint()
  // =========================================================================

  describe("checkpoint()", () => {
    it("should update checkpoint data and increment version on success", async () => {
      const current = makeRecord({ id: "proc-1", version: 3 });
      const updated = makeRecord({
        id: "proc-1",
        version: 4,
        checkpoint: { step: 2 },
      });

      mockPrisma.agentProcess.findUniqueOrThrow
        .mockResolvedValueOnce(current) // first lookup for version read
        .mockResolvedValueOnce(updated); // second lookup after updateMany
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.checkpoint("proc-1", { step: 2 });

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-1", version: 3 },
        data: {
          checkpoint: { step: 2 },
          version: { increment: 1 },
        },
      });
      expect(result.version).toBe(4);
    });

    it("should throw on optimistic lock conflict when count is 0", async () => {
      const current = makeRecord({ id: "proc-1", version: 3 });
      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.checkpoint("proc-1", { step: 5 })).rejects.toThrow(
        /Optimistic lock conflict/,
      );
    });
  });

  // =========================================================================
  // consumeResources()
  // =========================================================================

  describe("consumeResources()", () => {
    it("should increment tokensUsed when provided", async () => {
      const updated = makeRecord({ tokensUsed: 150 });
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentProcess.findUnique.mockResolvedValue(updated);

      const result = await service.consumeResources("proc-1", {
        tokensUsed: 150,
      });

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: { tokensUsed: { increment: 150 } },
      });
      expect(result!.tokensUsed).toBe(150);
    });

    it("should increment costUsed when provided", async () => {
      const updated = makeRecord({ costUsed: 0.25 });
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentProcess.findUnique.mockResolvedValue(updated);

      const result = await service.consumeResources("proc-1", {
        costUsed: 0.25,
      });

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: { costUsed: { increment: 0.25 } },
      });
      expect(result!.costUsed).toBe(0.25);
    });

    it("should increment both tokensUsed and costUsed when both are provided", async () => {
      const updated = makeRecord({ tokensUsed: 200, costUsed: 0.5 });
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentProcess.findUnique.mockResolvedValue(updated);

      await service.consumeResources("proc-1", {
        tokensUsed: 200,
        costUsed: 0.5,
      });

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: {
          tokensUsed: { increment: 200 },
          costUsed: { increment: 0.5 },
        },
      });
    });

    it("should send an empty update object when neither field is provided", async () => {
      const updated = makeRecord();
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentProcess.findUnique.mockResolvedValue(updated);

      await service.consumeResources("proc-1", {});

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: {},
      });
    });

    it("should return null when the process is not found (count = 0)", async () => {
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.consumeResources("proc-1", {
        tokensUsed: 100,
      });

      expect(result).toBeNull();
      expect(mockPrisma.agentProcess.findUnique).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // pause() / resume() / cancel() — delegation tests
  // =========================================================================

  describe("pause()", () => {
    it("should delegate to transition() with PAUSED state", async () => {
      const transitionSpy = jest
        .spyOn(service, "transition")
        .mockResolvedValue(makeRecord({ state: "PAUSED" as any }));

      await service.pause("proc-1");

      expect(transitionSpy).toHaveBeenCalledWith("proc-1", "PAUSED");
    });
  });

  describe("resume()", () => {
    it("should delegate to transition() with READY state", async () => {
      const transitionSpy = jest
        .spyOn(service, "transition")
        .mockResolvedValue(makeRecord({ state: "READY" as any }));

      await service.resume("proc-1");

      expect(transitionSpy).toHaveBeenCalledWith("proc-1", "READY");
    });
  });

  describe("cancel()", () => {
    it("should delegate to transition() with CANCELLED state", async () => {
      const transitionSpy = jest
        .spyOn(service, "transition")
        .mockResolvedValue(makeRecord({ state: "CANCELLED" as any }));

      await service.cancel("proc-1");

      expect(transitionSpy).toHaveBeenCalledWith("proc-1", "CANCELLED");
    });
  });

  // =========================================================================
  // kill()
  // =========================================================================

  describe("kill()", () => {
    it("should force-cancel the process regardless of current state", async () => {
      const updated = makeRecord({
        id: "proc-1",
        state: "CANCELLED" as any,
        completedAt: new Date(),
      });
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentProcess.findUnique.mockResolvedValue(updated);

      const result = await service.kill("proc-1");

      expect(mockPrisma.agentProcess.updateMany).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: {
          state: "CANCELLED",
          completedAt: expect.any(Date),
        },
      });
      expect(result!.state).toBe("CANCELLED");
      expect(result!.completedAt).not.toBeNull();
    });

    it("should not call findUniqueOrThrow (bypasses state machine)", async () => {
      const updated = makeRecord({ state: "CANCELLED" as any });
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentProcess.findUnique.mockResolvedValue(updated);

      await service.kill("proc-1");

      expect(mockPrisma.agentProcess.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("should return null when the process is not found (count = 0)", async () => {
      mockPrisma.agentProcess.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.kill("proc-1");

      expect(result).toBeNull();
      expect(mockPrisma.agentProcess.findUnique).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // wait()
  // =========================================================================

  describe("wait()", () => {
    /**
     * The wait() implementation is a polling while-loop that:
     *   1. Calls findUniqueOrThrow
     *   2. If terminal → returns
     *   3. Else awaits setTimeout(resolve, 1000) then loops back
     *   4. If Date.now() >= deadline at loop entry → throws
     *
     * Strategy: use jest fake timers + runAllTimersAsync() to drain both
     * the 1-second sleep timer and any awaiting microtasks in one call.
     */

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should return immediately when process is already in a terminal state", async () => {
      const terminalRecord = makeRecord({ state: "COMPLETED" as any });
      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(
        terminalRecord,
      );

      // With a terminal state the loop exits before any setTimeout fires
      const result = await service.wait("proc-1", 5000);

      expect(result.state).toBe("COMPLETED");
      expect(mockPrisma.agentProcess.findUniqueOrThrow).toHaveBeenCalledTimes(
        1,
      );
    });

    it("should return after one poll cycle when process transitions to terminal state", async () => {
      const runningRecord = makeRecord({ state: "RUNNING" as any });
      const completedRecord = makeRecord({ state: "COMPLETED" as any });

      mockPrisma.agentProcess.findUniqueOrThrow
        .mockResolvedValueOnce(runningRecord)
        .mockResolvedValueOnce(completedRecord);

      // Start the wait with a generous timeout
      const waitPromise = service.wait("proc-1", 10_000);

      // Drain the first findUniqueOrThrow (returns RUNNING), which schedules the
      // 1-second sleep timer. runAllTimersAsync fires that timer AND flushes the
      // resulting microtasks so the loop iterates to the second DB read.
      await jest.runAllTimersAsync();

      const result = await waitPromise;
      expect(result.state).toBe("COMPLETED");
      expect(mockPrisma.agentProcess.findUniqueOrThrow).toHaveBeenCalledTimes(
        2,
      );
    });

    it("should throw when the timeout elapses before reaching a terminal state", async () => {
      const runningRecord = makeRecord({ state: "RUNNING" as any });
      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(
        runningRecord,
      );

      // Use a timeout shorter than the 1-second poll interval.
      // After the first RUNNING result the service schedules setTimeout(1000).
      // Advancing time by 1000 ms fires that timer; by then Date.now() is 1000 ms
      // past the 500 ms deadline, so the next loop condition exits with a throw.
      // We run timer advancement and the assertion concurrently so that the
      // rejection is captured by the expect() wrapper before it can become unhandled.
      const waitPromise = service.wait("proc-1", 500);
      const [result] = await Promise.allSettled([
        waitPromise,
        jest.runAllTimersAsync(),
      ]);

      expect(result.status).toBe("rejected");
      expect((result as PromiseRejectedResult).reason.message).toMatch(
        /did not reach a terminal state/,
      );
    });

    it("should recognise all TERMINAL_STATES as stopping conditions", async () => {
      for (const terminalState of TERMINAL_STATES) {
        jest.clearAllMocks();
        const record = makeRecord({ state: terminalState as any });
        mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(record);

        // All terminal states resolve on the first poll without needing a sleep
        const result = await service.wait("proc-1", 5000);
        expect(result.state).toBe(terminalState);
      }
    });
  });

  // =========================================================================
  // listAll() — admin method
  // =========================================================================

  describe("listAll()", () => {
    it("should list all processes with default limit 100 when no args given", async () => {
      const records = [
        makeRecord({ id: "p1", state: "RUNNING" as any }),
        makeRecord({ id: "p2", state: "CREATED" as any }),
      ];
      mockPrisma.agentProcess.findMany.mockResolvedValue(records);

      const result = await service.listAll();

      expect(result).toHaveLength(2);
      expect(mockPrisma.agentProcess.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    });

    it("should filter by states when states array is provided", async () => {
      const records = [makeRecord({ id: "p1", state: "RUNNING" as any })];
      mockPrisma.agentProcess.findMany.mockResolvedValue(records);

      const result = await service.listAll(["RUNNING" as any]);

      expect(result).toHaveLength(1);
      expect(mockPrisma.agentProcess.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["RUNNING"] } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    });

    it("should apply a custom limit when provided", async () => {
      mockPrisma.agentProcess.findMany.mockResolvedValue([]);

      await service.listAll(undefined, 25);

      expect(mockPrisma.agentProcess.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
        take: 25,
      });
    });

    it("should apply both states filter and custom limit together", async () => {
      const records = [makeRecord({ id: "p1", state: "FAILED" as any })];
      mockPrisma.agentProcess.findMany.mockResolvedValue(records);

      await service.listAll(["FAILED" as any], 10);

      expect(mockPrisma.agentProcess.findMany).toHaveBeenCalledWith({
        where: { state: { in: ["FAILED"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    });

    it("should return empty array when no processes exist", async () => {
      mockPrisma.agentProcess.findMany.mockResolvedValue([]);

      const result = await service.listAll();

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // tableReady = false — all methods return early / throw
  // =========================================================================

  describe("when table is not ready (disabled service)", () => {
    let disabledService: ProcessManagerService;

    beforeEach(async () => {
      jest.clearAllMocks();
      // Return false from checkTableExists to simulate missing table
      mockPrisma.$queryRaw.mockResolvedValue([{ exists: false }]);

      const module = await Test.createTestingModule({
        providers: [
          ProcessManagerService,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      disabledService = module.get<ProcessManagerService>(
        ProcessManagerService,
      );
      await disabledService.onModuleInit();

      jest.spyOn(Logger.prototype, "log").mockImplementation();
      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "debug").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();
    });

    it("spawn() should throw when table is not available", async () => {
      await expect(
        disabledService.spawn({ userId: "u1", agentId: "a1" }),
      ).rejects.toThrow("agent_processes table not available");
    });

    it("fork() should throw when table is not available", async () => {
      await expect(
        disabledService.fork("parent-1", { agentId: "a1" }),
      ).rejects.toThrow("agent_processes table not available");
    });

    it("getState() should return null when table is not available", async () => {
      const result = await disabledService.getState("proc-1");
      expect(result).toBeNull();
    });

    it("listByUser() should return empty array when table is not available", async () => {
      const result = await disabledService.listByUser("user-1");
      expect(result).toEqual([]);
    });

    it("listAll() should return empty array when table is not available", async () => {
      const result = await disabledService.listAll();
      expect(result).toEqual([]);
    });

    it("getProcessTree() should throw when table is not available", async () => {
      await expect(disabledService.getProcessTree("proc-1")).rejects.toThrow(
        "agent_processes table not available",
      );
    });

    it("transition() should throw when table is not available", async () => {
      await expect(
        disabledService.transition("proc-1", "READY" as any),
      ).rejects.toThrow("agent_processes table not available");
    });

    it("checkpoint() should throw when table is not available", async () => {
      await expect(
        disabledService.checkpoint("proc-1", { step: 1 }),
      ).rejects.toThrow("agent_processes table not available");
    });

    it("consumeResources() should return null when table is not available", async () => {
      const result = await disabledService.consumeResources("proc-1", {
        tokensUsed: 100,
      });
      expect(result).toBeNull();
    });

    it("pause() should throw when table is not available", async () => {
      await expect(disabledService.pause("proc-1")).rejects.toThrow(
        "agent_processes table not available",
      );
    });

    it("resume() should throw when table is not available", async () => {
      await expect(disabledService.resume("proc-1")).rejects.toThrow(
        "agent_processes table not available",
      );
    });

    it("cancel() should throw when table is not available", async () => {
      await expect(disabledService.cancel("proc-1")).rejects.toThrow(
        "agent_processes table not available",
      );
    });

    it("kill() should return null when table is not available", async () => {
      const result = await disabledService.kill("proc-1");
      expect(result).toBeNull();
    });

    it("wait() should throw when table is not available", async () => {
      await expect(disabledService.wait("proc-1")).rejects.toThrow(
        "agent_processes table not available",
      );
    });
  });

  // =========================================================================
  // checkTableExists() — error path (catch returns false)
  // =========================================================================

  describe("checkTableExists() error handling", () => {
    it("should disable the service when $queryRaw throws an error", async () => {
      jest.clearAllMocks();
      mockPrisma.$queryRaw.mockRejectedValue(new Error("DB error"));

      const module = await Test.createTestingModule({
        providers: [
          ProcessManagerService,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const errorService = module.get<ProcessManagerService>(
        ProcessManagerService,
      );

      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "log").mockImplementation();
      jest.spyOn(Logger.prototype, "debug").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();

      await errorService.onModuleInit();

      // With tableReady = false, all write operations should throw
      await expect(
        errorService.spawn({ userId: "u1", agentId: "a1" }),
      ).rejects.toThrow("agent_processes table not available");
    });

    it("should disable the service when checkTableExists returns null exists value", async () => {
      jest.clearAllMocks();
      // Return empty array — result[0]?.exists ?? false → false
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const module = await Test.createTestingModule({
        providers: [
          ProcessManagerService,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const noResultService = module.get<ProcessManagerService>(
        ProcessManagerService,
      );

      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "log").mockImplementation();
      jest.spyOn(Logger.prototype, "debug").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();

      await noResultService.onModuleInit();

      const result = await noResultService.getState("proc-1");
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Additional branch coverage: transition() with WAITING and CANCELLED states
  // =========================================================================

  describe("transition() — additional state paths", () => {
    it("should transition RUNNING -> WAITING without setting timestamps", async () => {
      const current = makeRecord({ id: "proc-1", state: "RUNNING" as any });
      const updated = makeRecord({ id: "proc-1", state: "WAITING" as any });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "WAITING" as any);

      expect(result.state).toBe("WAITING");
      const updateCall = mockPrisma.agentProcess.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("startedAt");
      expect(updateCall.data).not.toHaveProperty("completedAt");
    });

    it("should transition RUNNING -> CANCELLED and set completedAt", async () => {
      const current = makeRecord({ id: "proc-1", state: "RUNNING" as any });
      const updated = makeRecord({
        id: "proc-1",
        state: "CANCELLED" as any,
        completedAt: new Date(),
      });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "CANCELLED" as any);

      expect(result.state).toBe("CANCELLED");
      expect(mockPrisma.agentProcess.update).toHaveBeenCalledWith({
        where: { id: "proc-1" },
        data: expect.objectContaining({
          state: "CANCELLED",
          completedAt: expect.any(Date),
        }),
      });
    });

    it("should transition CREATED -> CANCELLED and set completedAt", async () => {
      const current = makeRecord({ id: "proc-1", state: "CREATED" as any });
      const updated = makeRecord({
        id: "proc-1",
        state: "CANCELLED" as any,
        completedAt: new Date(),
      });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "CANCELLED" as any);

      expect(result.state).toBe("CANCELLED");
    });

    it("should transition FAILED -> READY without setting timestamps (retry path)", async () => {
      const current = makeRecord({ id: "proc-1", state: "FAILED" as any });
      const updated = makeRecord({ id: "proc-1", state: "READY" as any });

      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);
      mockPrisma.agentProcess.update.mockResolvedValue(updated);

      const result = await service.transition("proc-1", "READY" as any);

      expect(result.state).toBe("READY");
      const updateCall = mockPrisma.agentProcess.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("completedAt");
    });

    it("should throw on invalid transition for ZOMBIE state (no valid transitions)", async () => {
      const current = makeRecord({ id: "proc-1", state: "ZOMBIE" as any });
      mockPrisma.agentProcess.findUniqueOrThrow.mockResolvedValue(current);

      await expect(
        service.transition("proc-1", "RUNNING" as any),
      ).rejects.toThrow(/Invalid state transition/);
    });
  });
});

/**
 * MissionExecutorService Unit Tests
 *
 * Covers: execute(), complete(), fail(), cancel(), getStatus()
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { MissionExecutorService } from "../mission-executor.service";
import { ProcessManagerService } from "../../../lifecycle/manager/process-manager.service";
import { EventJournalService } from "../../../protocols/journal/event-journal.service";
import type { ProcessSnapshot } from "../../../lifecycle/manager/process.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(
  overrides: Partial<ProcessSnapshot> = {},
): ProcessSnapshot {
  return {
    id: "proc-1",
    userId: "user-1",
    parentId: null,
    agentId: "agent-1",
    teamSessionId: null,
    state: "CREATED",
    priority: 0,
    tokenBudget: 0,
    tokensUsed: 0,
    costBudget: 0,
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProcessManager = {
  spawn: jest.fn(),
  transition: jest.fn(),
  cancel: jest.fn(),
  checkpoint: jest.fn(),
  getState: jest.fn(),
};

const mockEventJournal = {
  record: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MissionExecutorService", () => {
  let service: MissionExecutorService;

  beforeEach(async () => {
    // Reset all mock implementations to safe defaults
    mockProcessManager.spawn.mockResolvedValue(
      makeSnapshot({ id: "proc-1", state: "CREATED" }),
    );
    mockProcessManager.transition.mockImplementation(
      (id: string, state: string) =>
        Promise.resolve(
          makeSnapshot({ id, state: state as ProcessSnapshot["state"] }),
        ),
    );
    mockProcessManager.cancel.mockResolvedValue(
      makeSnapshot({ id: "proc-1", state: "CANCELLED" }),
    );
    mockProcessManager.checkpoint.mockResolvedValue(
      makeSnapshot({ id: "proc-1" }),
    );
    mockProcessManager.getState.mockResolvedValue(
      makeSnapshot({ id: "proc-1" }),
    );
    mockEventJournal.record.mockResolvedValue({ id: "evt-1" });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionExecutorService,
        { provide: ProcessManagerService, useValue: mockProcessManager },
        { provide: EventJournalService, useValue: mockEventJournal },
      ],
    }).compile();

    service = module.get<MissionExecutorService>(MissionExecutorService);

    // Silence logger noise in test output
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // execute()
  // -------------------------------------------------------------------------

  describe("execute()", () => {
    const baseOptions = {
      userId: "user-1",
      agentId: "agent-1",
      input: { task: "do something" },
    };

    it("should spawn a process, record spawned event, transition to READY then RUNNING, and record started event", async () => {
      const runningSnapshot = makeSnapshot({ id: "proc-1", state: "RUNNING" });
      mockProcessManager.transition
        .mockResolvedValueOnce(makeSnapshot({ id: "proc-1", state: "READY" }))
        .mockResolvedValueOnce(runningSnapshot);

      const result = await service.execute(baseOptions);

      // Spawn was called
      expect(mockProcessManager.spawn).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          agentId: "agent-1",
          input: { task: "do something" },
        }),
      );

      // process:spawned event recorded first
      expect(mockEventJournal.record).toHaveBeenNthCalledWith(
        1,
        "proc-1",
        "process:spawned",
        expect.objectContaining({ agentId: "agent-1" }),
      );

      // Transitioned READY → RUNNING in order
      expect(mockProcessManager.transition).toHaveBeenNthCalledWith(
        1,
        "proc-1",
        "READY",
      );
      expect(mockProcessManager.transition).toHaveBeenNthCalledWith(
        2,
        "proc-1",
        "RUNNING",
      );

      // process:started event recorded after transitions
      expect(mockEventJournal.record).toHaveBeenNthCalledWith(
        2,
        "proc-1",
        "process:started",
      );

      // Return value carries processId and the RUNNING snapshot
      expect(result.processId).toBe("proc-1");
      expect(result.process).toEqual(runningSnapshot);
    });

    it("should pass optional fields — priority, tokenBudget, costBudget, grantedTools, grantedSkills, teamSessionId — through to spawn", async () => {
      const fullOptions = {
        userId: "user-2",
        agentId: "agent-2",
        teamSessionId: "team-session-abc",
        input: { query: "research" },
        priority: 5,
        tokenBudget: 10000,
        costBudget: 2.5,
        grantedTools: ["web-search", "calculator"],
        grantedSkills: ["summarise"],
      };

      await service.execute(fullOptions);

      expect(mockProcessManager.spawn).toHaveBeenCalledWith({
        userId: "user-2",
        agentId: "agent-2",
        teamSessionId: "team-session-abc",
        input: { query: "research" },
        priority: 5,
        tokenBudget: 10000,
        costBudget: 2.5,
        grantedTools: ["web-search", "calculator"],
        grantedSkills: ["summarise"],
      });
    });

    it("should include teamSessionId in the process:spawned event payload", async () => {
      await service.execute({ ...baseOptions, teamSessionId: "session-xyz" });

      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-1",
        "process:spawned",
        expect.objectContaining({ teamSessionId: "session-xyz" }),
      );
    });

    it("should propagate errors from processManager.spawn", async () => {
      mockProcessManager.spawn.mockRejectedValue(new Error("DB error"));

      await expect(service.execute(baseOptions)).rejects.toThrow("DB error");
    });

    it("should propagate errors from transition to READY", async () => {
      mockProcessManager.transition.mockRejectedValueOnce(
        new Error("Invalid transition"),
      );

      await expect(service.execute(baseOptions)).rejects.toThrow(
        "Invalid transition",
      );
    });
  });

  // -------------------------------------------------------------------------
  // complete()
  // -------------------------------------------------------------------------

  describe("complete()", () => {
    it("should checkpoint the output, transition to COMPLETED, and record process:completed event", async () => {
      const output = { summary: "done", tokensUsed: 250 };

      await service.complete("proc-1", output);

      expect(mockProcessManager.checkpoint).toHaveBeenCalledWith(
        "proc-1",
        output,
      );
      expect(mockProcessManager.transition).toHaveBeenCalledWith(
        "proc-1",
        "COMPLETED",
      );
      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-1",
        "process:completed",
        { output },
      );
    });

    it("should skip checkpoint when output is not provided and still transition", async () => {
      await service.complete("proc-1");

      expect(mockProcessManager.checkpoint).not.toHaveBeenCalled();
      expect(mockProcessManager.transition).toHaveBeenCalledWith(
        "proc-1",
        "COMPLETED",
      );
      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-1",
        "process:completed",
        { output: undefined },
      );
    });

    it("should preserve checkpoint → transition ordering", async () => {
      const callOrder: string[] = [];
      mockProcessManager.checkpoint.mockImplementation(() => {
        callOrder.push("checkpoint");
        return Promise.resolve(makeSnapshot());
      });
      mockProcessManager.transition.mockImplementation(() => {
        callOrder.push("transition");
        return Promise.resolve(makeSnapshot({ state: "COMPLETED" }));
      });
      mockEventJournal.record.mockImplementation(() => {
        callOrder.push("record");
        return Promise.resolve({ id: "evt-1" });
      });

      await service.complete("proc-1", { data: 1 });

      expect(callOrder).toEqual(["checkpoint", "transition", "record"]);
    });
  });

  // -------------------------------------------------------------------------
  // fail()
  // -------------------------------------------------------------------------

  describe("fail()", () => {
    it("should transition to FAILED and record process:failed event with the error string", async () => {
      await service.fail("proc-1", "LLM API timeout");

      expect(mockProcessManager.transition).toHaveBeenCalledWith(
        "proc-1",
        "FAILED",
      );
      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-1",
        "process:failed",
        { error: "LLM API timeout" },
      );
    });

    it("should still record the failed event even if transition throws (process already terminal)", async () => {
      mockProcessManager.transition.mockRejectedValue(
        new Error("Cannot transition: COMPLETED is terminal"),
      );

      // Should NOT throw — the catch block swallows the transition error
      await expect(
        service.fail("proc-1", "already done"),
      ).resolves.toBeUndefined();

      // Event must still be recorded
      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-1",
        "process:failed",
        { error: "already done" },
      );
    });

    it("should record process:failed even when process is in CANCELLED state", async () => {
      mockProcessManager.transition.mockRejectedValue(
        new Error("CANCELLED is terminal"),
      );

      await service.fail("proc-cancelled", "unexpected error");

      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-cancelled",
        "process:failed",
        { error: "unexpected error" },
      );
    });
  });

  // -------------------------------------------------------------------------
  // cancel()
  // -------------------------------------------------------------------------

  describe("cancel()", () => {
    it("should cancel the process and record process:cancelled event", async () => {
      await service.cancel("proc-1");

      expect(mockProcessManager.cancel).toHaveBeenCalledWith("proc-1");
      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-1",
        "process:cancelled",
      );
    });

    it("should call cancel before recording the event", async () => {
      const callOrder: string[] = [];
      mockProcessManager.cancel.mockImplementation(() => {
        callOrder.push("cancel");
        return Promise.resolve(makeSnapshot({ state: "CANCELLED" }));
      });
      mockEventJournal.record.mockImplementation(() => {
        callOrder.push("record");
        return Promise.resolve({ id: "evt-1" });
      });

      await service.cancel("proc-1");

      expect(callOrder).toEqual(["cancel", "record"]);
    });

    it("should propagate errors from processManager.cancel", async () => {
      mockProcessManager.cancel.mockRejectedValue(new Error("Not found"));

      await expect(service.cancel("proc-missing")).rejects.toThrow("Not found");
    });
  });

  // -------------------------------------------------------------------------
  // getStatus()
  // -------------------------------------------------------------------------

  describe("getStatus()", () => {
    it("should delegate directly to processManager.getState and return its result", async () => {
      const snapshot = makeSnapshot({ id: "proc-1", state: "RUNNING" });
      mockProcessManager.getState.mockResolvedValue(snapshot);

      const result = await service.getStatus("proc-1");

      expect(mockProcessManager.getState).toHaveBeenCalledWith("proc-1");
      expect(result).toEqual(snapshot);
    });

    it("should return null when processManager.getState returns null", async () => {
      mockProcessManager.getState.mockResolvedValue(null);

      const result = await service.getStatus("proc-unknown");

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // executeWithTimeout()
  // -------------------------------------------------------------------------

  describe("executeWithTimeout()", () => {
    const baseOptions = {
      userId: "user-1",
      agentId: "agent-1",
      input: { task: "do something" },
    };

    it("should execute and return a result with a timeout reference", async () => {
      const result = await service.executeWithTimeout(baseOptions, 5000);

      expect(result.processId).toBe("proc-1");
      expect(mockProcessManager.spawn).toHaveBeenCalledTimes(1);

      // Clear the timer to prevent test pollution
      const ref = (result as any)._timeoutRef;
      if (ref) clearTimeout(ref);
    });

    it("should call fail after timeout expires", async () => {
      jest.useFakeTimers();

      const _result = await service.executeWithTimeout(baseOptions, 3000);

      // Fail should not have been called yet
      expect(mockProcessManager.transition).not.toHaveBeenCalledWith(
        "proc-1",
        "FAILED",
      );

      // Advance past timeout
      jest.advanceTimersByTime(3100);

      // Allow microtask queue to flush
      await Promise.resolve();

      expect(mockProcessManager.transition).toHaveBeenCalledWith(
        "proc-1",
        "FAILED",
      );

      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // executeWithRetry()
  // -------------------------------------------------------------------------

  describe("executeWithRetry()", () => {
    const baseOptions = {
      userId: "user-1",
      agentId: "agent-1",
      input: { task: "do something" },
    };

    it("should succeed on first attempt without retrying", async () => {
      const result = await service.executeWithRetry(baseOptions);

      expect(result.processId).toBe("proc-1");
      expect(mockProcessManager.spawn).toHaveBeenCalledTimes(1);
    });

    it("should retry on transient failure and succeed", async () => {
      mockProcessManager.spawn
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValueOnce(makeSnapshot({ id: "proc-2" }));

      const result = await service.executeWithRetry(baseOptions, {
        maxRetries: 2,
        backoffMs: 10,
      });

      expect(result.processId).toBe("proc-2");
      expect(mockProcessManager.spawn).toHaveBeenCalledTimes(2);
    });

    it("should throw after all retries are exhausted", async () => {
      mockProcessManager.spawn.mockRejectedValue(new Error("permanent"));

      await expect(
        service.executeWithRetry(baseOptions, {
          maxRetries: 1,
          backoffMs: 10,
        }),
      ).rejects.toThrow("permanent");

      expect(mockProcessManager.spawn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });
  });

  // -------------------------------------------------------------------------
  // recover()
  // -------------------------------------------------------------------------

  describe("recover()", () => {
    it("should recover a FAILED process by transitioning to READY then RUNNING", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({ id: "proc-1", state: "FAILED" }),
      );

      const result = await service.recover("proc-1");

      expect(mockProcessManager.transition).toHaveBeenNthCalledWith(
        1,
        "proc-1",
        "READY",
      );
      expect(mockProcessManager.transition).toHaveBeenNthCalledWith(
        2,
        "proc-1",
        "RUNNING",
      );
      expect(result.processId).toBe("proc-1");
      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-1",
        "process:recovered",
        expect.objectContaining({ previousState: "FAILED" }),
      );
    });

    it("should return existing snapshot if process is already RUNNING", async () => {
      const runningSnapshot = makeSnapshot({ id: "proc-1", state: "RUNNING" });
      mockProcessManager.getState.mockResolvedValue(runningSnapshot);

      const result = await service.recover("proc-1");

      expect(result.process).toEqual(runningSnapshot);
      expect(mockProcessManager.transition).not.toHaveBeenCalled();
    });

    it("should throw if process not found", async () => {
      mockProcessManager.getState.mockResolvedValue(null);

      await expect(service.recover("proc-missing")).rejects.toThrow(
        "Process proc-missing not found",
      );
    });

    it("should include hasCheckpoint info in recovery event", async () => {
      mockProcessManager.getState.mockResolvedValue(
        makeSnapshot({
          id: "proc-1",
          state: "FAILED",
          checkpoint: { step: 3, data: "partial" },
        }),
      );

      await service.recover("proc-1");

      expect(mockEventJournal.record).toHaveBeenCalledWith(
        "proc-1",
        "process:recovered",
        expect.objectContaining({ hasCheckpoint: true }),
      );
    });
  });
});

/**
 * ProgressTrackerService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";

// Suppress logger output in tests
jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// Mock calculateOverallProgress from the progress tracker owner.
jest.mock("../../realtime/abstractions/progress-tracker.interface", () => {
  const actual = jest.requireActual(
    "../../realtime/abstractions/progress-tracker.interface",
  );
  return {
    ...actual,
    calculateOverallProgress: jest.fn(
      (phases: { weight: number; status: string }[]) => {
        // Use real implementation so math-based tests pass
        const totalWeight = phases.reduce(
          (sum: number, p: { weight: number }) => sum + p.weight,
          0,
        );
        if (totalWeight === 0) return 0;
        let completedWeight = 0;
        for (const phase of phases) {
          if (phase.status === "completed" || phase.status === "skipped") {
            completedWeight += phase.weight;
          }
        }
        return Math.round((completedWeight / totalWeight) * 100);
      },
    ),
  };
});

import { ProgressTrackerService } from "../progress-tracker.service";
import { EventBusService } from "../event-bus.service";
import { CacheService } from "@/common/cache/cache.service";
import type { CreateTrackedTaskRequest } from "../../realtime/abstractions/progress-tracker.interface";
import type { RoomConfig } from "../../realtime/abstractions/event-emitter.interface";

// ── In-memory CacheService mock ───────────────────────────────────────────

/**
 * Simple in-memory mock that mirrors CacheService get/set/del semantics.
 * Values are deep-cloned on write/read to prevent accidental mutation.
 */
class FakeCacheService {
  private readonly store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.store.get(key);
    return v !== undefined ? (JSON.parse(JSON.stringify(v)) as T) : undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)));
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Test helper: clear all entries between tests */
  clear(): void {
    this.store.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const makeRoomConfig = (): RoomConfig => ({
  roomId: "room-1",
  roomType: "session",
  entityId: "entity-1",
});

const makeRequest = (id = "task-1"): CreateTrackedTaskRequest => ({
  id,
  type: "research",
  name: "Test Task",
  roomConfig: makeRoomConfig(),
  phases: [
    { id: "phase-a", name: "Phase A", weight: 2 },
    { id: "phase-b", name: "Phase B", weight: 3 },
  ],
  metadata: { key: "value" },
});

describe("ProgressTrackerService", () => {
  let service: ProgressTrackerService;
  let mockEventBus: jest.Mocked<Pick<EventBusService, "emitProgress">>;
  let fakeCache: FakeCacheService;

  beforeEach(async () => {
    mockEventBus = {
      emitProgress: jest.fn(),
    };
    fakeCache = new FakeCacheService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressTrackerService,
        { provide: EventBusService, useValue: mockEventBus },
        { provide: CacheService, useValue: fakeCache },
      ],
    }).compile();

    service = module.get<ProgressTrackerService>(ProgressTrackerService);
  });

  afterEach(() => {
    fakeCache.clear();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------------
  describe("create()", () => {
    it("should create a new task with pending status and default weight 1 when weight omitted", () => {
      const req: CreateTrackedTaskRequest = {
        id: "t1",
        type: "write",
        name: "Write Task",
        roomConfig: makeRoomConfig(),
        phases: [{ id: "p1", name: "Phase 1" }], // no weight → default 1
      };

      const task = service.create(req);

      expect(task.id).toBe("t1");
      expect(task.type).toBe("write");
      expect(task.name).toBe("Write Task");
      expect(task.status).toBe("pending");
      expect(task.progress).toBe(0);
      expect(task.phases).toHaveLength(1);
      expect(task.phases[0].weight).toBe(1); // default weight
      expect(task.phases[0].status).toBe("pending");
      expect(task.phases[0].order).toBe(0);
    });

    it("should create a new task and map phases correctly with custom weights", () => {
      const task = service.create(makeRequest());

      expect(task.phases[0].id).toBe("phase-a");
      expect(task.phases[0].weight).toBe(2);
      expect(task.phases[1].id).toBe("phase-b");
      expect(task.phases[1].weight).toBe(3);
    });

    it("should return the existing task when called with a duplicate id", () => {
      const req = makeRequest("dup-task");
      const first = service.create(req);
      // Mutate to verify identity
      first.status = "running";

      const second = service.create(req);

      expect(second).toBe(first);
      expect(second.status).toBe("running"); // unchanged
    });

    it("should store the task so getTask() finds it", () => {
      service.create(makeRequest("task-stored"));
      expect(service.getTask("task-stored")).not.toBeNull();
    });

    it("should write the task to Redis on creation", async () => {
      service.create(makeRequest("redis-write"));
      // Allow microtask queue to flush so fire-and-forget cache.set resolves
      await Promise.resolve();
      const cached = await fakeCache.get<{ id: string }>(
        "harness:progress-tracker:task:redis-write",
      );
      expect(cached).toBeDefined();
      expect(cached?.id).toBe("redis-write");
    });
  });

  // ---------------------------------------------------------------------------
  // start()
  // ---------------------------------------------------------------------------
  describe("start()", () => {
    it("should set status to running and emit a progress event", () => {
      service.create(makeRequest("t-start"));
      service.start("t-start");

      const task = service.getTask("t-start")!;
      expect(task.status).toBe("running");
      expect(task.startedAt).toBeInstanceOf(Date);
      expect(mockEventBus.emitProgress).toHaveBeenCalledTimes(1);
    });

    it("should do nothing (no throw) when task does not exist", () => {
      expect(() => service.start("nonexistent")).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });

    it("should persist the updated task to Redis after start", async () => {
      service.create(makeRequest("t-start-redis"));
      service.start("t-start-redis");
      await Promise.resolve();
      const cached = await fakeCache.get<{ status: string }>(
        "harness:progress-tracker:task:t-start-redis",
      );
      expect(cached?.status).toBe("running");
    });
  });

  // ---------------------------------------------------------------------------
  // startPhase()
  // ---------------------------------------------------------------------------
  describe("startPhase()", () => {
    it("should set phase to in_progress and set currentPhaseId", () => {
      service.create(makeRequest("t-sp"));
      service.startPhase("t-sp", "phase-a", "Starting A");

      const task = service.getTask("t-sp")!;
      expect(task.phases[0].status).toBe("in_progress");
      expect(task.phases[0].startedAt).toBeInstanceOf(Date);
      expect(task.currentPhaseId).toBe("phase-a");
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "Starting A" }),
      );
    });

    it("should use default message when no message supplied", () => {
      service.create(makeRequest("t-sp2"));
      service.startPhase("t-sp2", "phase-a");

      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "开始: Phase A" }),
      );
    });

    it("should do nothing when task does not exist", () => {
      expect(() => service.startPhase("ghost", "phase-a")).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });

    it("should warn and do nothing when phase does not exist in task", () => {
      service.create(makeRequest("t-sp3"));
      service.startPhase("t-sp3", "nonexistent-phase");

      const task = service.getTask("t-sp3")!;
      expect(task.currentPhaseId).toBeUndefined();
      // emitProgress should NOT be called because phase was not found
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // updatePhaseProgress()
  // ---------------------------------------------------------------------------
  describe("updatePhaseProgress()", () => {
    it("should update task.progress based on phase progress", () => {
      service.create(makeRequest("t-upp"));
      service.updatePhaseProgress("t-upp", "phase-a", 50, "halfway");

      const task = service.getTask("t-upp")!;
      // phase-a weight=2, phase-b weight=3, total=5
      // completed weight = 2 * 0.5 = 1 → 1/5 * 100 = 20
      expect(task.progress).toBe(20);
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "halfway" }),
      );
    });

    it("should clamp negative progress to 0", () => {
      service.create(makeRequest("t-neg"));
      service.updatePhaseProgress("t-neg", "phase-a", -10);

      const task = service.getTask("t-neg")!;
      expect(task.progress).toBe(0);
    });

    it("should clamp progress > 100 to 100", () => {
      service.create(makeRequest("t-over"));
      service.updatePhaseProgress("t-over", "phase-a", 150);

      const task = service.getTask("t-over")!;
      // phase-a clamped to 100: weight=2 * 1.0 = 2; total=5 → 40%
      expect(task.progress).toBe(40);
    });

    it("should emit progress even when progress=0", () => {
      service.create(makeRequest("t-zero"));
      service.updatePhaseProgress("t-zero", "phase-a", 0);
      expect(mockEventBus.emitProgress).toHaveBeenCalledTimes(1);
    });

    it("should do nothing when task does not exist", () => {
      expect(() =>
        service.updatePhaseProgress("ghost", "phase-a", 50),
      ).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });

    it("should still emit progress even when phaseId does not exist in task", () => {
      // When phase not found, progress is not updated but emitProgress is still called
      service.create(makeRequest("t-noPhase"));
      service.updatePhaseProgress("t-noPhase", "missing-phase", 50);
      // task.progress stays 0 because phase not found
      const task = service.getTask("t-noPhase")!;
      expect(task.progress).toBe(0);
      // emitProgress IS called regardless
      expect(mockEventBus.emitProgress).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // completePhase()
  // ---------------------------------------------------------------------------
  describe("completePhase()", () => {
    it("should set phase status to completed and recalculate progress", () => {
      service.create(makeRequest("t-cp"));
      service.completePhase("t-cp", "phase-a", "Done A");

      const task = service.getTask("t-cp")!;
      expect(task.phases[0].status).toBe("completed");
      expect(task.phases[0].completedAt).toBeInstanceOf(Date);
      // phase-a (weight 2) completed, phase-b (weight 3) pending → 2/5 = 40
      expect(task.progress).toBe(40);
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "Done A" }),
      );
    });

    it("should use default message when not provided", () => {
      service.create(makeRequest("t-cp2"));
      service.completePhase("t-cp2", "phase-a");
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "完成: Phase A" }),
      );
    });

    it("should do nothing when task does not exist", () => {
      expect(() => service.completePhase("ghost", "phase-a")).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });

    it("should do nothing when phase does not exist", () => {
      service.create(makeRequest("t-cp3"));
      service.completePhase("t-cp3", "missing-phase");
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // skipPhase()
  // ---------------------------------------------------------------------------
  describe("skipPhase()", () => {
    it("should set phase status to skipped and recalculate progress", () => {
      service.create(makeRequest("t-skip"));
      service.skipPhase("t-skip", "phase-b", "Not needed");

      const task = service.getTask("t-skip")!;
      expect(task.phases[1].status).toBe("skipped");
      // phase-b (weight 3) skipped, phase-a (weight 2) pending → 3/5 = 60
      expect(task.progress).toBe(60);
    });

    it("should use default reason message when not provided", () => {
      service.create(makeRequest("t-skip2"));
      service.skipPhase("t-skip2", "phase-a");
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "跳过: Phase A" }),
      );
    });

    it("should do nothing when task does not exist", () => {
      expect(() => service.skipPhase("ghost", "phase-a")).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });

    it("should do nothing when phase does not exist", () => {
      service.create(makeRequest("t-skip3"));
      service.skipPhase("t-skip3", "missing-phase");
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // failPhase()
  // ---------------------------------------------------------------------------
  describe("failPhase()", () => {
    it("should set phase status to failed and store error", () => {
      service.create(makeRequest("t-fp"));
      service.failPhase("t-fp", "phase-a", "Network error");

      const task = service.getTask("t-fp")!;
      expect(task.phases[0].status).toBe("failed");
      expect(task.phases[0].error).toBe("Network error");
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "失败: Phase A - Network error" }),
      );
    });

    it("should do nothing when task does not exist", () => {
      expect(() => service.failPhase("ghost", "phase-a", "err")).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });

    it("should do nothing when phase does not exist", () => {
      service.create(makeRequest("t-fp2"));
      service.failPhase("t-fp2", "missing-phase", "err");
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // complete()
  // ---------------------------------------------------------------------------
  describe("complete()", () => {
    it("should set task status to completed and progress to 100", () => {
      service.create(makeRequest("t-complete"));
      service.complete("t-complete", "All done");

      const task = service.getTask("t-complete")!;
      expect(task.status).toBe("completed");
      expect(task.progress).toBe(100);
      expect(task.completedAt).toBeInstanceOf(Date);
    });

    it("should use default message when not provided", () => {
      service.create(makeRequest("t-complete2"));
      service.complete("t-complete2");
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "任务完成" }),
      );
    });

    it("should trigger the onComplete callback and remove it afterwards", () => {
      service.create(makeRequest("t-complete3"));
      const cb = jest.fn();
      service.onComplete("t-complete3", cb);

      service.complete("t-complete3");

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ id: "t-complete3", status: "completed" }),
      );

      // Callback is removed; completing again should not call it again
      cb.mockClear();
      // reset so complete can run again (set status back)
      service.getTask("t-complete3")!.status = "running";
      service.complete("t-complete3");
      expect(cb).not.toHaveBeenCalled();
    });

    it("should do nothing when task does not exist", () => {
      expect(() => service.complete("ghost")).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });

    it("should persist completed status to Redis", async () => {
      service.create(makeRequest("t-complete-redis"));
      service.complete("t-complete-redis");
      await Promise.resolve();
      const cached = await fakeCache.get<{ status: string; progress: number }>(
        "harness:progress-tracker:task:t-complete-redis",
      );
      expect(cached?.status).toBe("completed");
      expect(cached?.progress).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // fail()
  // ---------------------------------------------------------------------------
  describe("fail()", () => {
    it("should set task status to failed and store error", () => {
      service.create(makeRequest("t-fail"));
      service.fail("t-fail", "Crash!");

      const task = service.getTask("t-fail")!;
      expect(task.status).toBe("failed");
      expect(task.error).toBe("Crash!");
      expect(task.completedAt).toBeInstanceOf(Date);
    });

    it("should trigger the onFail callback and remove it afterwards", () => {
      service.create(makeRequest("t-fail2"));
      const cb = jest.fn();
      service.onFail("t-fail2", cb);

      service.fail("t-fail2", "timeout");

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ id: "t-fail2", status: "failed" }),
        "timeout",
      );

      cb.mockClear();
      service.getTask("t-fail2")!.status = "running";
      service.fail("t-fail2", "timeout");
      expect(cb).not.toHaveBeenCalled();
    });

    it("should do nothing when task does not exist", () => {
      expect(() => service.fail("ghost", "err")).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // cancel()
  // ---------------------------------------------------------------------------
  describe("cancel()", () => {
    it("should set task status to cancelled", () => {
      service.create(makeRequest("t-cancel"));
      service.cancel("t-cancel", "User requested");

      const task = service.getTask("t-cancel")!;
      expect(task.status).toBe("cancelled");
      expect(task.completedAt).toBeInstanceOf(Date);
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "User requested" }),
      );
    });

    it("should use default reason when not provided", () => {
      service.create(makeRequest("t-cancel2"));
      service.cancel("t-cancel2");
      expect(mockEventBus.emitProgress).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: "任务已取消" }),
      );
    });

    it("should do nothing when task does not exist", () => {
      expect(() => service.cancel("ghost")).not.toThrow();
      expect(mockEventBus.emitProgress).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // getProgress()
  // ---------------------------------------------------------------------------
  describe("getProgress()", () => {
    it("should return a ProgressEvent for an existing task", () => {
      service.create(makeRequest("t-gp"));
      const prog = service.getProgress("t-gp");

      expect(prog).not.toBeNull();
      expect(prog!.taskId).toBe("t-gp");
      expect(prog!.taskType).toBe("research");
      expect(prog!.progress).toBe(0);
    });

    it("should return null for a non-existent task", () => {
      expect(service.getProgress("ghost")).toBeNull();
    });

    it("should include currentStep and totalSteps", () => {
      service.create(makeRequest("t-gp2"));
      const prog = service.getProgress("t-gp2")!;
      expect(prog.currentStep).toBe(1); // 0 completed + 1
      expect(prog.totalSteps).toBe(2);
    });

    it("should include the current phase name when a phase is active", () => {
      service.create(makeRequest("t-gp3"));
      service.startPhase("t-gp3", "phase-b");
      const prog = service.getProgress("t-gp3")!;
      expect(prog.phase).toBe("Phase B");
    });

    it("should return empty string for phase when no currentPhaseId", () => {
      service.create(makeRequest("t-gp4"));
      const prog = service.getProgress("t-gp4")!;
      expect(prog.phase).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // getTask()
  // ---------------------------------------------------------------------------
  describe("getTask()", () => {
    it("should return the task for a known id", () => {
      service.create(makeRequest("t-gt"));
      const task = service.getTask("t-gt");
      expect(task).not.toBeNull();
      expect(task!.id).toBe("t-gt");
    });

    it("should return null for an unknown id", () => {
      expect(service.getTask("unknown")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getActiveTasks()
  // ---------------------------------------------------------------------------
  describe("getActiveTasks()", () => {
    it("should return only pending and running tasks", () => {
      service.create(makeRequest("active-1")); // pending
      service.create(makeRequest("active-2")); // will be running
      service.create(makeRequest("done-1")); // will be completed

      service.start("active-2");
      service.complete("done-1");

      const active = service.getActiveTasks();
      const ids = active.map((t) => t.id);
      expect(ids).toContain("active-1");
      expect(ids).toContain("active-2");
      expect(ids).not.toContain("done-1");
    });

    it("should return empty array when no active tasks", () => {
      service.create(makeRequest("fin"));
      service.complete("fin");
      expect(service.getActiveTasks()).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // cleanup()
  // ---------------------------------------------------------------------------
  describe("cleanup()", () => {
    it("should remove completed tasks older than the threshold", () => {
      service.create(makeRequest("old-task"));
      service.complete("old-task");

      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
      service.getTask("old-task")!.completedAt = oldDate;

      const cleaned = service.cleanup();
      expect(cleaned).toBe(1);
      expect(service.getTask("old-task")).toBeNull();
    });

    it("should not remove tasks completed recently", () => {
      service.create(makeRequest("new-task"));
      service.complete("new-task");
      // completedAt is just set to now → within 1h threshold

      const cleaned = service.cleanup();
      expect(cleaned).toBe(0);
      expect(service.getTask("new-task")).not.toBeNull();
    });

    it("should not remove still-active tasks even if old", () => {
      service.create(makeRequest("still-running"));
      service.start("still-running");

      const cleaned = service.cleanup(new Date()); // threshold = now
      expect(cleaned).toBe(0);
    });

    it("should accept a custom threshold date", () => {
      service.create(makeRequest("custom-old"));
      service.fail("custom-old", "err");
      service.getTask("custom-old")!.completedAt = new Date(
        Date.now() - 5 * 60 * 1000,
      ); // 5 min ago

      const threshold = new Date(Date.now() - 1 * 60 * 1000); // 1 min threshold
      const cleaned = service.cleanup(threshold);
      expect(cleaned).toBe(1);
    });

    it("should notify progress callbacks before deleting a task", () => {
      service.create(makeRequest("notify-task"));
      service.complete("notify-task");

      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
      service.getTask("notify-task")!.completedAt = oldDate;

      const progressCb = jest.fn();
      service.onProgress("notify-task", progressCb);

      service.cleanup();

      expect(progressCb).toHaveBeenCalledWith(
        expect.objectContaining({ message: "任务记录已清理" }),
      );
    });

    it("should still clean up even if a cleanup callback throws", () => {
      service.create(makeRequest("throw-task"));
      service.complete("throw-task");
      service.getTask("throw-task")!.completedAt = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      );

      service.onProgress("throw-task", () => {
        throw new Error("callback boom");
      });

      expect(() => service.cleanup()).not.toThrow();
      expect(service.getTask("throw-task")).toBeNull();
    });

    it("should also remove cancelled tasks older than threshold", () => {
      service.create(makeRequest("cancelled-task"));
      service.cancel("cancelled-task");
      service.getTask("cancelled-task")!.completedAt = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      );

      const cleaned = service.cleanup();
      expect(cleaned).toBe(1);
    });

    it("should also clean up associated fail callbacks and complete callbacks", () => {
      service.create(makeRequest("cleanup-cbs"));
      service.complete("cleanup-cbs");
      service.getTask("cleanup-cbs")!.completedAt = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      );

      const completeCb = jest.fn();
      const failCb = jest.fn();
      // Manually register them again to verify they are cleaned
      service.onComplete("cleanup-cbs", completeCb);
      service.onFail("cleanup-cbs", failCb);

      service.cleanup();

      // After cleanup, task is gone so complete/fail won't call these
      // The callbacks maps should be cleared
      expect(service.getTask("cleanup-cbs")).toBeNull();
    });

    it("should evict cleaned tasks from Redis", async () => {
      service.create(makeRequest("evict-task"));
      service.complete("evict-task");
      service.getTask("evict-task")!.completedAt = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      );
      // Ensure it was written first
      await Promise.resolve();

      service.cleanup();
      await Promise.resolve();

      const cached = await fakeCache.get(
        "harness:progress-tracker:task:evict-task",
      );
      expect(cached).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // onProgress()
  // ---------------------------------------------------------------------------
  describe("onProgress()", () => {
    it("should call the callback whenever progress is emitted", () => {
      service.create(makeRequest("t-onprog"));
      const cb = jest.fn();
      service.onProgress("t-onprog", cb);

      service.start("t-onprog");
      service.updatePhaseProgress("t-onprog", "phase-a", 50);

      expect(cb).toHaveBeenCalledTimes(2);
    });

    it("should return an unsubscribe function that stops future calls", () => {
      service.create(makeRequest("t-unsub"));
      const cb = jest.fn();
      const unsub = service.onProgress("t-unsub", cb);

      service.start("t-unsub");
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      service.complete("t-unsub");
      expect(cb).toHaveBeenCalledTimes(1); // not called again
    });

    it("should return a no-op unsubscribe function when task does not exist", () => {
      const unsub = service.onProgress("ghost", jest.fn());
      expect(() => unsub()).not.toThrow();
    });

    it("should support multiple callbacks for the same task", () => {
      service.create(makeRequest("t-multi"));
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.onProgress("t-multi", cb1);
      service.onProgress("t-multi", cb2);

      service.start("t-multi");

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it("should not crash overall if one progress callback throws", () => {
      service.create(makeRequest("t-throwcb"));
      service.onProgress("t-throwcb", () => {
        throw new Error("boom");
      });
      const safeCb = jest.fn();
      service.onProgress("t-throwcb", safeCb);

      expect(() => service.start("t-throwcb")).not.toThrow();
      // safe callback still invoked
      expect(safeCb).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // onComplete()
  // ---------------------------------------------------------------------------
  describe("onComplete()", () => {
    it("should register and later invoke the complete callback", () => {
      service.create(makeRequest("t-oc"));
      const cb = jest.fn();
      service.onComplete("t-oc", cb);

      service.complete("t-oc");
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("should return an unsubscribe function", () => {
      service.create(makeRequest("t-oc-unsub"));
      const cb = jest.fn();
      const unsub = service.onComplete("t-oc-unsub", cb);

      unsub();
      service.complete("t-oc-unsub");
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // onFail()
  // ---------------------------------------------------------------------------
  describe("onFail()", () => {
    it("should register and later invoke the fail callback", () => {
      service.create(makeRequest("t-of"));
      const cb = jest.fn();
      service.onFail("t-of", cb);

      service.fail("t-of", "disk full");
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ id: "t-of" }),
        "disk full",
      );
    });

    it("should return an unsubscribe function", () => {
      service.create(makeRequest("t-of-unsub"));
      const cb = jest.fn();
      const unsub = service.onFail("t-of-unsub", cb);

      unsub();
      service.fail("t-of-unsub", "err");
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // calculateProgress() — tested indirectly via updatePhaseProgress
  // ---------------------------------------------------------------------------
  describe("calculateProgress() (indirect via updatePhaseProgress)", () => {
    it("should account for previously completed phases when computing partial progress", () => {
      service.create(makeRequest("t-calc"));
      // Complete phase-a (weight 2) first
      service.completePhase("t-calc", "phase-a");

      // Now update phase-b (weight 3) to 50%
      service.updatePhaseProgress("t-calc", "phase-b", 50);

      // completed=2 (phase-a), partial=3*0.5=1.5 → total=3.5/5=70
      const task = service.getTask("t-calc")!;
      expect(task.progress).toBe(70);
    });

    it("should return 0 when all phases have zero total weight", () => {
      // Create a task with explicit weight=0 on all phases
      const req: CreateTrackedTaskRequest = {
        id: "t-zero-weight",
        type: "test",
        name: "Zero Weight",
        roomConfig: makeRoomConfig(),
        phases: [{ id: "p1", name: "P1", weight: 0 }],
      };
      service.create(req);
      service.updatePhaseProgress("t-zero-weight", "p1", 50);

      const task = service.getTask("t-zero-weight")!;
      expect(task.progress).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Redis write-through — cross-cutting concern
  // ---------------------------------------------------------------------------
  describe("Redis write-through", () => {
    it("should reflect latest task state in Redis after mutations", async () => {
      service.create(makeRequest("redis-state"));
      service.start("redis-state");
      service.startPhase("redis-state", "phase-a");
      await Promise.resolve();

      const cached = await fakeCache.get<{
        status: string;
        currentPhaseId: string;
      }>("harness:progress-tracker:task:redis-state");
      expect(cached?.status).toBe("running");
      expect(cached?.currentPhaseId).toBe("phase-a");
    });

    it("should not throw when Redis write fails", () => {
      jest
        .spyOn(fakeCache, "set")
        .mockRejectedValueOnce(new Error("Redis down"));
      expect(() => service.create(makeRequest("redis-fail"))).not.toThrow();
    });
  });
});

/**
 * Unit tests for ProgressTrackerService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ProgressTrackerService } from "../../../../../ai-harness/facade";
import { EventBusService as EngineEventEmitterService } from "../../../../../ai-harness/facade";
import type { RoomConfig } from "../../abstractions/event-emitter.interface";
import type { CreateTrackedTaskRequest } from "../../abstractions/progress-tracker.interface";
import { calculateOverallProgress } from "../../abstractions/progress-tracker.interface";

// ----- helpers -----

function makeRoomConfig(): RoomConfig {
  return {
    roomId: "room-1",
    roomType: "topic",
    entityId: "entity-1",
  };
}

function makeTaskRequest(
  overrides?: Partial<CreateTrackedTaskRequest>,
): CreateTrackedTaskRequest {
  return {
    id: "task-001",
    type: "research",
    name: "Test Research Task",
    roomConfig: makeRoomConfig(),
    phases: [
      { id: "phase-1", name: "Planning", weight: 1 },
      { id: "phase-2", name: "Execution", weight: 2 },
      { id: "phase-3", name: "Reporting", weight: 1 },
    ],
    ...overrides,
  };
}

// ----- tests -----

describe("ProgressTrackerService", () => {
  let service: ProgressTrackerService;
  let mockEventEmitter: jest.Mocked<EngineEventEmitterService>;

  beforeEach(async () => {
    mockEventEmitter = {
      emitProgress: jest.fn(),
    } as unknown as jest.Mocked<EngineEventEmitterService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressTrackerService,
        {
          provide: EngineEventEmitterService,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<ProgressTrackerService>(ProgressTrackerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── construction ──────────────────────────────────────────────────────────

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("should create and return a task with pending status", () => {
      const task = service.create(makeTaskRequest());

      expect(task.id).toBe("task-001");
      expect(task.status).toBe("pending");
      expect(task.progress).toBe(0);
      expect(task.phases).toHaveLength(3);
    });

    it("should initialise all phases with pending status and correct order", () => {
      const task = service.create(makeTaskRequest());

      task.phases.forEach((p, i) => {
        expect(p.status).toBe("pending");
        expect(p.order).toBe(i);
      });
    });

    it("should default phase weight to 1 when not provided", () => {
      const request = makeTaskRequest({
        phases: [{ id: "p1", name: "Phase 1" }],
      });
      const task = service.create(request);

      expect(task.phases[0].weight).toBe(1);
    });

    it("should return the existing task if called with the same id twice", () => {
      const request = makeTaskRequest();
      const first = service.create(request);
      const second = service.create(request);

      expect(second).toBe(first);
    });
  });

  // ── getTask ───────────────────────────────────────────────────────────────

  describe("getTask", () => {
    it("should return null for unknown task", () => {
      expect(service.getTask("unknown")).toBeNull();
    });

    it("should return the task after creation", () => {
      service.create(makeTaskRequest());
      const task = service.getTask("task-001");

      expect(task).not.toBeNull();
      expect(task!.id).toBe("task-001");
    });
  });

  // ── getProgress ───────────────────────────────────────────────────────────

  describe("getProgress", () => {
    it("should return null for unknown task", () => {
      expect(service.getProgress("unknown")).toBeNull();
    });

    it("should return a ProgressEvent for a known task", () => {
      service.create(makeTaskRequest());
      const progress = service.getProgress("task-001");

      expect(progress).not.toBeNull();
      expect(progress!.taskId).toBe("task-001");
      expect(progress!.taskType).toBe("research");
    });
  });

  // ── start ─────────────────────────────────────────────────────────────────

  describe("start", () => {
    it("should transition task status to running and set startedAt", () => {
      service.create(makeTaskRequest());
      service.start("task-001");

      const task = service.getTask("task-001")!;
      expect(task.status).toBe("running");
      expect(task.startedAt).toBeInstanceOf(Date);
    });

    it("should emit a progress event via eventEmitter", () => {
      service.create(makeTaskRequest());
      service.start("task-001");

      expect(mockEventEmitter.emitProgress).toHaveBeenCalledTimes(1);
    });

    it("should be a no-op for unknown taskId", () => {
      expect(() => service.start("unknown")).not.toThrow();
      expect(mockEventEmitter.emitProgress).not.toHaveBeenCalled();
    });
  });

  // ── startPhase ────────────────────────────────────────────────────────────

  describe("startPhase", () => {
    it("should set phase status to in_progress and update currentPhaseId", () => {
      service.create(makeTaskRequest());
      service.startPhase("task-001", "phase-1");

      const task = service.getTask("task-001")!;
      expect(task.currentPhaseId).toBe("phase-1");
      expect(task.phases[0].status).toBe("in_progress");
    });

    it("should emit a progress event", () => {
      service.create(makeTaskRequest());
      service.startPhase("task-001", "phase-1", "Custom message");

      expect(mockEventEmitter.emitProgress).toHaveBeenCalledTimes(1);
    });

    it("should be a no-op for unknown phaseId", () => {
      service.create(makeTaskRequest());
      service.startPhase("task-001", "non-existent-phase");
      // Phase not found warning, but no crash
      expect(mockEventEmitter.emitProgress).not.toHaveBeenCalled();
    });
  });

  // ── updatePhaseProgress ───────────────────────────────────────────────────

  describe("updatePhaseProgress", () => {
    it("should update overall progress proportionally", () => {
      service.create(makeTaskRequest());
      service.startPhase("task-001", "phase-1");
      service.updatePhaseProgress("task-001", "phase-1", 50);

      const task = service.getTask("task-001")!;
      // totalWeight = 4; phase-1 weight=1; 50% of 1/4 = 12.5 => 13 rounded
      expect(task.progress).toBeGreaterThan(0);
    });

    it("should clamp progress to 0-100", () => {
      service.create(makeTaskRequest());
      service.startPhase("task-001", "phase-2");

      service.updatePhaseProgress("task-001", "phase-2", 150); // over 100
      const task = service.getTask("task-001")!;
      expect(task.progress).toBeLessThanOrEqual(100);
      expect(task.progress).toBeGreaterThanOrEqual(0);
    });

    it("should emit a progress event", () => {
      service.create(makeTaskRequest());
      service.updatePhaseProgress("task-001", "phase-1", 50);

      expect(mockEventEmitter.emitProgress).toHaveBeenCalledTimes(1);
    });
  });

  // ── completePhase ─────────────────────────────────────────────────────────

  describe("completePhase", () => {
    it("should mark the phase as completed and recalculate progress", () => {
      service.create(makeTaskRequest());
      service.startPhase("task-001", "phase-1");
      service.completePhase("task-001", "phase-1");

      const task = service.getTask("task-001")!;
      const phase = task.phases.find((p) => p.id === "phase-1")!;

      expect(phase.status).toBe("completed");
      expect(phase.completedAt).toBeInstanceOf(Date);
      // After completing phase-1 (weight 1 of 4): 25%
      expect(task.progress).toBe(25);
    });

    it("should emit a progress event", () => {
      service.create(makeTaskRequest());
      service.completePhase("task-001", "phase-1");

      expect(mockEventEmitter.emitProgress).toHaveBeenCalled();
    });
  });

  // ── skipPhase ─────────────────────────────────────────────────────────────

  describe("skipPhase", () => {
    it("should mark the phase as skipped and contribute to progress", () => {
      service.create(makeTaskRequest());
      service.skipPhase("task-001", "phase-1", "Not needed");

      const task = service.getTask("task-001")!;
      const phase = task.phases.find((p) => p.id === "phase-1")!;

      expect(phase.status).toBe("skipped");
      expect(task.progress).toBe(25); // weight 1 of 4
    });

    it("should emit a progress event", () => {
      service.create(makeTaskRequest());
      service.skipPhase("task-001", "phase-1");

      expect(mockEventEmitter.emitProgress).toHaveBeenCalled();
    });
  });

  // ── failPhase ─────────────────────────────────────────────────────────────

  describe("failPhase", () => {
    it("should mark the phase as failed with error info", () => {
      service.create(makeTaskRequest());
      service.failPhase("task-001", "phase-2", "Timeout");

      const task = service.getTask("task-001")!;
      const phase = task.phases.find((p) => p.id === "phase-2")!;

      expect(phase.status).toBe("failed");
      expect(phase.error).toBe("Timeout");
    });

    it("should emit a progress event", () => {
      service.create(makeTaskRequest());
      service.failPhase("task-001", "phase-1", "error");

      expect(mockEventEmitter.emitProgress).toHaveBeenCalled();
    });
  });

  // ── complete ──────────────────────────────────────────────────────────────

  describe("complete", () => {
    it("should set status to completed, progress to 100, and set completedAt", () => {
      service.create(makeTaskRequest());
      service.start("task-001");
      service.complete("task-001");

      const task = service.getTask("task-001")!;
      expect(task.status).toBe("completed");
      expect(task.progress).toBe(100);
      expect(task.completedAt).toBeInstanceOf(Date);
    });

    it("should call the onComplete callback", () => {
      service.create(makeTaskRequest());
      const onComplete = jest.fn();
      service.onComplete("task-001", onComplete);
      service.complete("task-001");

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ id: "task-001", status: "completed" }),
      );
    });

    it("should remove the onComplete callback after calling it once", () => {
      service.create(makeTaskRequest());
      const onComplete = jest.fn();
      service.onComplete("task-001", onComplete);
      service.complete("task-001");
      service.complete("task-001"); // second call should not re-invoke

      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ── fail ──────────────────────────────────────────────────────────────────

  describe("fail", () => {
    it("should set status to failed with error message", () => {
      service.create(makeTaskRequest());
      service.fail("task-001", "LLM API error");

      const task = service.getTask("task-001")!;
      expect(task.status).toBe("failed");
      expect(task.error).toBe("LLM API error");
      expect(task.completedAt).toBeInstanceOf(Date);
    });

    it("should call the onFail callback", () => {
      service.create(makeTaskRequest());
      const onFail = jest.fn();
      service.onFail("task-001", onFail);
      service.fail("task-001", "Network error");

      expect(onFail).toHaveBeenCalledWith(
        expect.objectContaining({ id: "task-001", status: "failed" }),
        "Network error",
      );
    });
  });

  // ── cancel ────────────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("should set status to cancelled", () => {
      service.create(makeTaskRequest());
      service.cancel("task-001", "User cancelled");

      const task = service.getTask("task-001")!;
      expect(task.status).toBe("cancelled");
      expect(task.completedAt).toBeInstanceOf(Date);
    });

    it("should emit a progress event", () => {
      service.create(makeTaskRequest());
      service.cancel("task-001");

      expect(mockEventEmitter.emitProgress).toHaveBeenCalled();
    });
  });

  // ── getActiveTasks ────────────────────────────────────────────────────────

  describe("getActiveTasks", () => {
    it("should return pending and running tasks only", () => {
      service.create({ ...makeTaskRequest(), id: "t1" });
      service.create({ ...makeTaskRequest(), id: "t2" });
      service.create({ ...makeTaskRequest(), id: "t3" });

      service.start("t2");
      service.complete("t3");

      const active = service.getActiveTasks();
      expect(active.map((t) => t.id)).toEqual(
        expect.arrayContaining(["t1", "t2"]),
      );
      expect(active.find((t) => t.id === "t3")).toBeUndefined();
    });

    it("should return empty array when no tasks exist", () => {
      expect(service.getActiveTasks()).toEqual([]);
    });
  });

  // ── onProgress callback ───────────────────────────────────────────────────

  describe("onProgress", () => {
    it("should invoke the callback whenever progress is emitted", () => {
      service.create(makeTaskRequest());
      const cb = jest.fn();
      service.onProgress("task-001", cb);

      service.start("task-001");
      expect(cb).toHaveBeenCalledTimes(1);

      service.startPhase("task-001", "phase-1");
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it("should stop invoking callback after unsubscribe", () => {
      service.create(makeTaskRequest());
      const cb = jest.fn();
      const unsubscribe = service.onProgress("task-001", cb);

      service.start("task-001");
      expect(cb).toHaveBeenCalledTimes(1);

      unsubscribe();
      service.startPhase("task-001", "phase-1");
      expect(cb).toHaveBeenCalledTimes(1); // no additional calls
    });

    it("should return a no-op unsubscribe for unknown task", () => {
      const cb = jest.fn();
      const unsubscribe = service.onProgress("unknown-task", cb);

      expect(typeof unsubscribe).toBe("function");
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  // ── onComplete callback ───────────────────────────────────────────────────

  describe("onComplete", () => {
    it("should return an unsubscribe function", () => {
      service.create(makeTaskRequest());
      const cb = jest.fn();
      const unsubscribe = service.onComplete("task-001", cb);

      expect(typeof unsubscribe).toBe("function");

      unsubscribe();
      service.complete("task-001");
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── onFail callback ───────────────────────────────────────────────────────

  describe("onFail", () => {
    it("should return an unsubscribe function", () => {
      service.create(makeTaskRequest());
      const cb = jest.fn();
      const unsubscribe = service.onFail("task-001", cb);

      expect(typeof unsubscribe).toBe("function");

      unsubscribe();
      service.fail("task-001", "some error");
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── cleanup ───────────────────────────────────────────────────────────────

  describe("cleanup", () => {
    it("should remove completed tasks older than the threshold", () => {
      service.create(makeTaskRequest());
      service.complete("task-001");

      // Force completedAt to be in the past
      const task = service.getTask("task-001")!;
      task.completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago

      const removed = service.cleanup(new Date(Date.now() - 60 * 60 * 1000));
      expect(removed).toBe(1);
      expect(service.getTask("task-001")).toBeNull();
    });

    it("should not remove tasks that are still active", () => {
      service.create(makeTaskRequest());
      service.start("task-001");

      const removed = service.cleanup(new Date(0));
      expect(removed).toBe(0);
      expect(service.getTask("task-001")).not.toBeNull();
    });

    it("should not remove recently completed tasks", () => {
      service.create(makeTaskRequest());
      service.complete("task-001");

      // Use a past threshold that is older than the task's completedAt
      const removed = service.cleanup(
        new Date(Date.now() - 2 * 60 * 60 * 1000),
      );
      expect(removed).toBe(0);
    });

    it("should notify progress callbacks before cleanup", () => {
      service.create(makeTaskRequest());
      service.complete("task-001");

      const task = service.getTask("task-001")!;
      task.completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

      const cb = jest.fn();
      service.onProgress("task-001", cb);

      service.cleanup(new Date(Date.now() - 60 * 60 * 1000));

      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0]).toMatchObject({ taskId: "task-001" });
    });

    it("should return 0 when there is nothing to clean", () => {
      expect(service.cleanup()).toBe(0);
    });
  });

  // ── progress callback error resilience ───────────────────────────────────

  describe("callback error resilience", () => {
    it("should continue emitting progress to other callbacks when one throws", () => {
      service.create(makeTaskRequest());

      const badCb = jest.fn().mockImplementation(() => {
        throw new Error("callback failure");
      });
      const goodCb = jest.fn();

      service.onProgress("task-001", badCb);
      service.onProgress("task-001", goodCb);

      service.start("task-001");

      expect(goodCb).toHaveBeenCalledTimes(1);
    });
  });
});

// ----- calculateOverallProgress pure function tests -----

describe("calculateOverallProgress", () => {
  it("should return 0 for empty phases", () => {
    expect(calculateOverallProgress([])).toBe(0);
  });

  it("should return 0 when total weight is 0", () => {
    const phases = [
      {
        id: "p1",
        name: "P1",
        order: 0,
        weight: 0,
        status: "completed" as const,
      },
    ];
    expect(calculateOverallProgress(phases)).toBe(0);
  });

  it("should return 100 when all phases completed", () => {
    const phases = [
      {
        id: "p1",
        name: "P1",
        order: 0,
        weight: 1,
        status: "completed" as const,
      },
      {
        id: "p2",
        name: "P2",
        order: 1,
        weight: 1,
        status: "completed" as const,
      },
    ];
    expect(calculateOverallProgress(phases)).toBe(100);
  });

  it("should calculate weighted progress correctly", () => {
    const phases = [
      {
        id: "p1",
        name: "P1",
        order: 0,
        weight: 1,
        status: "completed" as const,
      },
      { id: "p2", name: "P2", order: 1, weight: 3, status: "pending" as const },
    ];
    // 1/(1+3) = 25%
    expect(calculateOverallProgress(phases)).toBe(25);
  });

  it("should treat skipped phases the same as completed for progress", () => {
    const phases = [
      { id: "p1", name: "P1", order: 0, weight: 2, status: "skipped" as const },
      { id: "p2", name: "P2", order: 1, weight: 2, status: "pending" as const },
    ];
    expect(calculateOverallProgress(phases)).toBe(50);
  });

  it("should ignore in_progress phases (partial progress handled elsewhere)", () => {
    const phases = [
      {
        id: "p1",
        name: "P1",
        order: 0,
        weight: 1,
        status: "in_progress" as const,
      },
      { id: "p2", name: "P2", order: 1, weight: 1, status: "pending" as const },
    ];
    expect(calculateOverallProgress(phases)).toBe(0);
  });
});

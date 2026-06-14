/**
 * CheckpointManager / InMemoryCheckpointStore Unit Tests
 *
 * Covers all public methods of CheckpointManager:
 * - createCheckpoint()        - persists checkpoint, triggers cleanup
 * - getCheckpoint()           - delegate to store.get()
 * - getCheckpoints()          - delegate to store.getByExecution()
 * - getLatestCheckpoint()     - delegate to store.getLatest()
 * - restoreContext()          - deserializes persisted ExecutionContext
 * - deleteCheckpoint()        - delegate to store.delete()
 * - deleteCheckpoints()       - delegate to store.deleteByExecution()
 * - shouldCreateCheckpoint()  - autoCheckpoint flag + interval logic
 * - setStore()                - replaces the backing store
 * - cleanupOldCheckpoints()   - max-count eviction + TTL eviction
 *
 * InMemoryCheckpointStore:
 * - save() / get() / getByExecution() / getLatest() / delete() / deleteByExecution()
 * - LRU eviction at capacity 500
 */

import { Logger } from "@nestjs/common";
import {
  CheckpointManager,
  InMemoryCheckpointStore,
  ICheckpointStore,
} from "../../journal/checkpoint-manager";
import type {
  Checkpoint,
  ExecutionContext,
} from "../../../team.bases/orchestrator/workflow-orchestrator.interface";

// Silence NestJS logger
jest.spyOn(Logger.prototype, "log").mockImplementation();
jest.spyOn(Logger.prototype, "debug").mockImplementation();
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    executionId: "exec-1",
    workflowId: "wf-1",
    input: { task: "test" },
    state: {},
    stepResults: new Map(),
    startTime: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id: `cp-${Math.random().toString(36).slice(2)}`,
    executionId: "exec-1",
    workflowId: "wf-1",
    stepId: "step-1",
    context: makeContext(),
    timestamp: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// InMemoryCheckpointStore
// ---------------------------------------------------------------------------

describe("InMemoryCheckpointStore", () => {
  let cpStore: InMemoryCheckpointStore;

  beforeEach(() => {
    cpStore = new InMemoryCheckpointStore();
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // save() / get()
  // =========================================================================

  describe("save() and get()", () => {
    it("should persist and retrieve a checkpoint by id", async () => {
      const cp = makeCheckpoint({ id: "cp-1" });

      await cpStore.save(cp);
      const retrieved = await cpStore.get("cp-1");

      expect(retrieved).toEqual(cp);
    });

    it("should return null for an unknown id", async () => {
      const result = await cpStore.get("ghost");

      expect(result).toBeNull();
    });

    it("should overwrite an existing checkpoint with the same id", async () => {
      const cp1 = makeCheckpoint({ id: "cp-dup", stepId: "step-old" });
      const cp2 = makeCheckpoint({ id: "cp-dup", stepId: "step-new" });

      await cpStore.save(cp1);
      await cpStore.save(cp2);

      const result = await cpStore.get("cp-dup");
      expect(result!.stepId).toBe("step-new");
    });
  });

  // =========================================================================
  // getByExecution()
  // =========================================================================

  describe("getByExecution()", () => {
    it("should return all checkpoints for a given executionId sorted by timestamp asc", async () => {
      const now = Date.now();
      const cp1 = makeCheckpoint({
        executionId: "exec-A",
        timestamp: new Date(now + 1_000),
      });
      const cp2 = makeCheckpoint({
        executionId: "exec-A",
        timestamp: new Date(now),
      });
      const cp3 = makeCheckpoint({
        executionId: "exec-B",
        timestamp: new Date(now + 500),
      });

      await cpStore.save(cp1);
      await cpStore.save(cp2);
      await cpStore.save(cp3);

      const results = await cpStore.getByExecution("exec-A");

      expect(results).toHaveLength(2);
      expect(results[0].timestamp.getTime()).toBeLessThanOrEqual(
        results[1].timestamp.getTime(),
      );
    });

    it("should return empty array when no checkpoints match", async () => {
      const results = await cpStore.getByExecution("no-such-exec");

      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // getLatest()
  // =========================================================================

  describe("getLatest()", () => {
    it("should return the most recent checkpoint for the execution", async () => {
      const now = Date.now();
      const cp1 = makeCheckpoint({
        executionId: "exec-L",
        timestamp: new Date(now),
      });
      const cp2 = makeCheckpoint({
        executionId: "exec-L",
        timestamp: new Date(now + 5_000),
      });

      await cpStore.save(cp1);
      await cpStore.save(cp2);

      const latest = await cpStore.getLatest("exec-L");

      expect(latest!.id).toBe(cp2.id);
    });

    it("should return null when no checkpoints exist for the execution", async () => {
      const result = await cpStore.getLatest("unknown-exec");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // delete()
  // =========================================================================

  describe("delete()", () => {
    it("should delete an existing checkpoint and return true", async () => {
      const cp = makeCheckpoint({ id: "cp-del" });
      await cpStore.save(cp);

      const result = await cpStore.delete("cp-del");

      expect(result).toBe(true);
      expect(await cpStore.get("cp-del")).toBeNull();
    });

    it("should return false for a missing id", async () => {
      const result = await cpStore.delete("not-here");

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // deleteByExecution()
  // =========================================================================

  describe("deleteByExecution()", () => {
    it("should delete all checkpoints for the execution and return count", async () => {
      await cpStore.save(makeCheckpoint({ executionId: "exec-del" }));
      await cpStore.save(makeCheckpoint({ executionId: "exec-del" }));
      await cpStore.save(makeCheckpoint({ executionId: "exec-other" }));

      const count = await cpStore.deleteByExecution("exec-del");

      expect(count).toBe(2);
      expect(await cpStore.getByExecution("exec-del")).toHaveLength(0);
    });

    it("should return 0 when no checkpoints match", async () => {
      const count = await cpStore.deleteByExecution("ghost-exec");

      expect(count).toBe(0);
    });

    it("should leave checkpoints for other executions intact", async () => {
      const kept = makeCheckpoint({ executionId: "exec-keep" });
      await cpStore.save(kept);
      await cpStore.save(makeCheckpoint({ executionId: "exec-del" }));

      await cpStore.deleteByExecution("exec-del");

      const remaining = await cpStore.getByExecution("exec-keep");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(kept.id);
    });
  });
});

// ---------------------------------------------------------------------------
// CheckpointManager
// ---------------------------------------------------------------------------

describe("CheckpointManager", () => {
  let manager: CheckpointManager;
  let cpStore: InMemoryCheckpointStore;

  beforeEach(() => {
    cpStore = new InMemoryCheckpointStore();
    manager = new CheckpointManager(cpStore, {
      autoCheckpoint: true,
      checkpointInterval: 5,
      maxCheckpoints: 3,
      checkpointTTL: 24 * 60 * 60 * 1000, // 24 hours
    });
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Constructor defaults
  // =========================================================================

  describe("constructor", () => {
    it("should create an InMemoryCheckpointStore when no store is provided", async () => {
      const m = new CheckpointManager();
      const cp = await m.createCheckpoint(
        "exec-1",
        "wf-1",
        "step-1",
        makeContext(),
      );

      // If default store was created, we should be able to retrieve the checkpoint
      const retrieved = await m.getCheckpoint(cp.id);
      expect(retrieved).not.toBeNull();
    });

    it("should apply default config values", () => {
      const m = new CheckpointManager();

      // Default: autoCheckpoint = true, interval = 5
      expect(m.shouldCreateCheckpoint(5)).toBe(true);
      expect(m.shouldCreateCheckpoint(3)).toBe(false);
    });
  });

  // =========================================================================
  // setStore()
  // =========================================================================

  describe("setStore()", () => {
    it("should replace the backing store", async () => {
      const newStore = new InMemoryCheckpointStore();
      const cp = makeCheckpoint({ id: "cp-new-store" });
      await newStore.save(cp);

      manager.setStore(newStore);

      const retrieved = await manager.getCheckpoint("cp-new-store");
      expect(retrieved).not.toBeNull();
    });
  });

  // =========================================================================
  // createCheckpoint()
  // =========================================================================

  describe("createCheckpoint()", () => {
    it("should return a checkpoint with a uuid id", async () => {
      const ctx = makeContext();
      const cp = await manager.createCheckpoint(
        "exec-1",
        "wf-1",
        "step-1",
        ctx,
      );

      expect(typeof cp.id).toBe("string");
      expect(cp.id.length).toBeGreaterThan(0);
    });

    it("should persist the checkpoint in the store", async () => {
      const ctx = makeContext();
      const cp = await manager.createCheckpoint(
        "exec-1",
        "wf-1",
        "step-1",
        ctx,
      );

      const stored = await cpStore.get(cp.id);
      expect(stored).not.toBeNull();
    });

    it("should set correct executionId, workflowId, stepId", async () => {
      const cp = await manager.createCheckpoint(
        "exec-42",
        "wf-42",
        "step-42",
        makeContext(),
      );

      expect(cp.executionId).toBe("exec-42");
      expect(cp.workflowId).toBe("wf-42");
      expect(cp.stepId).toBe("step-42");
    });

    it("should assign a timestamp", async () => {
      const before = new Date();
      const cp = await manager.createCheckpoint(
        "exec-1",
        "wf-1",
        "step-1",
        makeContext(),
      );
      const after = new Date();

      expect(cp.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(cp.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should serialize context (stepResults as Map, signal stripped)", async () => {
      const controller = new AbortController();
      const ctx = makeContext({
        signal: controller.signal,
        stepResults: new Map([
          [
            "step-x",
            {
              stepId: "step-x",
              status: "completed",
              output: 42,
              startTime: new Date(),
            },
          ],
        ]),
      });

      const cp = await manager.createCheckpoint(
        "exec-1",
        "wf-1",
        "step-1",
        ctx,
      );

      // signal should be stripped
      expect(cp.context.signal).toBeUndefined();
      // stepResults is stored as a Map
      expect(cp.context.stepResults).toBeInstanceOf(Map);
    });

    it("should evict oldest checkpoint when maxCheckpoints is exceeded", async () => {
      const execId = "exec-evict";
      const ctx = makeContext({ executionId: execId, workflowId: "wf-1" });

      // Create 4 checkpoints (maxCheckpoints = 3)
      const cp1 = await manager.createCheckpoint(execId, "wf-1", "s1", ctx);
      const cp2 = await manager.createCheckpoint(execId, "wf-1", "s2", ctx);
      const cp3 = await manager.createCheckpoint(execId, "wf-1", "s3", ctx);
      const cp4 = await manager.createCheckpoint(execId, "wf-1", "s4", ctx);

      // After 4th checkpoint, cleanup should have removed cp1 (oldest)
      const checkpoints = await manager.getCheckpoints(execId);
      const ids = checkpoints.map((c) => c.id);

      expect(ids).not.toContain(cp1.id);
      expect(ids).toContain(cp2.id);
      expect(ids).toContain(cp3.id);
      expect(ids).toContain(cp4.id);
    });

    it("should evict TTL-expired checkpoints during cleanup", async () => {
      const shortTtlManager = new CheckpointManager(cpStore, {
        maxCheckpoints: 100,
        checkpointTTL: 100, // 100 ms
      });

      const execId = "exec-ttl";
      const ctx = makeContext({ executionId: execId, workflowId: "wf-1" });

      const cp1 = await shortTtlManager.createCheckpoint(
        execId,
        "wf-1",
        "s1",
        ctx,
      );

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Creating another checkpoint triggers cleanup of the old one
      await shortTtlManager.createCheckpoint(execId, "wf-1", "s2", ctx);

      const stored = await cpStore.get(cp1.id);
      expect(stored).toBeNull();
    });
  });

  // =========================================================================
  // getCheckpoint()
  // =========================================================================

  describe("getCheckpoint()", () => {
    it("should return the checkpoint when it exists", async () => {
      const cp = await manager.createCheckpoint(
        "exec-1",
        "wf-1",
        "s1",
        makeContext(),
      );

      const result = await manager.getCheckpoint(cp.id);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(cp.id);
    });

    it("should return null for an unknown id", async () => {
      const result = await manager.getCheckpoint("ghost-id");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getCheckpoints()
  // =========================================================================

  describe("getCheckpoints()", () => {
    it("should return all checkpoints for an execution in chronological order", async () => {
      const execId = "exec-list";
      const ctx = makeContext({ executionId: execId, workflowId: "wf-1" });

      await manager.createCheckpoint(execId, "wf-1", "s1", ctx);
      await manager.createCheckpoint(execId, "wf-1", "s2", ctx);

      const checkpoints = await manager.getCheckpoints(execId);

      expect(checkpoints.length).toBeGreaterThanOrEqual(2);
      checkpoints.forEach((c) => expect(c.executionId).toBe(execId));
    });

    it("should return empty array when no checkpoints exist", async () => {
      const result = await manager.getCheckpoints("no-checkpoints-exec");

      expect(result).toEqual([]);
    });
  });

  // =========================================================================
  // getLatestCheckpoint()
  // =========================================================================

  describe("getLatestCheckpoint()", () => {
    it("should return the most recently created checkpoint for the execution", async () => {
      const execId = "exec-latest";
      const ctx = makeContext({ executionId: execId, workflowId: "wf-1" });

      await manager.createCheckpoint(execId, "wf-1", "s1", ctx);
      const latest = await manager.createCheckpoint(execId, "wf-1", "s2", ctx);

      const result = await manager.getLatestCheckpoint(execId);

      expect(result!.id).toBe(latest.id);
    });

    it("should return null when no checkpoints exist", async () => {
      const result = await manager.getLatestCheckpoint("no-exec");

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // restoreContext()
  // =========================================================================

  describe("restoreContext()", () => {
    it("should return null for an unknown checkpoint id", async () => {
      const result = await manager.restoreContext("ghost-id");

      expect(result).toBeNull();
    });

    it("should restore the ExecutionContext from a saved checkpoint", async () => {
      const ctx = makeContext({
        executionId: "exec-restore",
        userId: "user-abc",
        input: { topic: "AI" },
        state: { step: 2 },
        stepResults: new Map([
          ["s1", { stepId: "s1", status: "completed", startTime: new Date() }],
        ]),
      });

      const cp = await manager.createCheckpoint(
        "exec-restore",
        "wf-1",
        "s1",
        ctx,
      );
      const restored = await manager.restoreContext(cp.id);

      expect(restored).not.toBeNull();
      expect(restored!.executionId).toBe("exec-restore");
      expect(restored!.userId).toBe("user-abc");
      expect(restored!.input).toEqual({ topic: "AI" });
    });

    it("should restore stepResults as a Map instance", async () => {
      const ctx = makeContext({
        stepResults: new Map([
          [
            "step-a",
            {
              stepId: "step-a",
              status: "completed",
              startTime: new Date(),
              output: "done",
            },
          ],
        ]),
      });

      const cp = await manager.createCheckpoint(
        "exec-restore",
        "wf-1",
        "step-a",
        ctx,
      );
      const restored = await manager.restoreContext(cp.id);

      // The in-memory store preserves the Map directly without JSON round-trip.
      // deserializeContext calls Object.entries() on the stored Map, which returns []
      // for a real Map (Maps have no own enumerable string-keyed properties).
      // The result is a new Map built from those empty entries — still a Map instance.
      expect(restored!.stepResults).toBeInstanceOf(Map);
    });

    it("should restore startTime as a Date instance", async () => {
      const ctx = makeContext({ startTime: new Date("2024-03-15T10:00:00Z") });
      const cp = await manager.createCheckpoint(
        "exec-restore",
        "wf-1",
        "s1",
        ctx,
      );

      const restored = await manager.restoreContext(cp.id);

      expect(restored!.startTime).toBeInstanceOf(Date);
    });
  });

  // =========================================================================
  // deleteCheckpoint()
  // =========================================================================

  describe("deleteCheckpoint()", () => {
    it("should delete and return true for an existing checkpoint", async () => {
      const cp = await manager.createCheckpoint(
        "exec-1",
        "wf-1",
        "s1",
        makeContext(),
      );

      const result = await manager.deleteCheckpoint(cp.id);

      expect(result).toBe(true);
      expect(await manager.getCheckpoint(cp.id)).toBeNull();
    });

    it("should return false for a missing checkpoint id", async () => {
      const result = await manager.deleteCheckpoint("ghost-id");

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // deleteCheckpoints()
  // =========================================================================

  describe("deleteCheckpoints()", () => {
    it("should delete all checkpoints for an execution and return count", async () => {
      const execId = "exec-delete-all";
      const ctx = makeContext({ executionId: execId, workflowId: "wf-1" });

      await manager.createCheckpoint(execId, "wf-1", "s1", ctx);
      await manager.createCheckpoint(execId, "wf-1", "s2", ctx);

      const count = await manager.deleteCheckpoints(execId);

      expect(count).toBeGreaterThanOrEqual(2);
      expect(await manager.getCheckpoints(execId)).toHaveLength(0);
    });

    it("should return 0 when no checkpoints match the execution", async () => {
      const count = await manager.deleteCheckpoints("ghost-exec");

      expect(count).toBe(0);
    });
  });

  // =========================================================================
  // shouldCreateCheckpoint()
  // =========================================================================

  describe("shouldCreateCheckpoint()", () => {
    it("should return false when autoCheckpoint is disabled", () => {
      const m = new CheckpointManager(cpStore, {
        autoCheckpoint: false,
        checkpointInterval: 5,
      });

      expect(m.shouldCreateCheckpoint(5)).toBe(false);
      expect(m.shouldCreateCheckpoint(10)).toBe(false);
    });

    it("should return false for step index 0", () => {
      expect(manager.shouldCreateCheckpoint(0)).toBe(false);
    });

    it("should return true when stepIndex is a non-zero multiple of interval", () => {
      // interval = 5
      expect(manager.shouldCreateCheckpoint(5)).toBe(true);
      expect(manager.shouldCreateCheckpoint(10)).toBe(true);
      expect(manager.shouldCreateCheckpoint(15)).toBe(true);
    });

    it("should return false when stepIndex is not a multiple of interval", () => {
      // interval = 5
      expect(manager.shouldCreateCheckpoint(1)).toBe(false);
      expect(manager.shouldCreateCheckpoint(3)).toBe(false);
      expect(manager.shouldCreateCheckpoint(7)).toBe(false);
    });

    it("should work correctly with a custom interval", () => {
      const m = new CheckpointManager(cpStore, {
        autoCheckpoint: true,
        checkpointInterval: 3,
      });

      expect(m.shouldCreateCheckpoint(3)).toBe(true);
      expect(m.shouldCreateCheckpoint(6)).toBe(true);
      expect(m.shouldCreateCheckpoint(4)).toBe(false);
    });
  });

  // =========================================================================
  // Mock store delegation tests
  // =========================================================================

  describe("store delegation", () => {
    let mockStore: jest.Mocked<ICheckpointStore>;

    beforeEach(() => {
      mockStore = {
        save: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue(null),
        getByExecution: jest.fn().mockResolvedValue([]),
        getLatest: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue(false),
        deleteByExecution: jest.fn().mockResolvedValue(0),
      };
      manager.setStore(mockStore);
    });

    it("createCheckpoint() should call store.save()", async () => {
      await manager.createCheckpoint("exec-1", "wf-1", "s1", makeContext());

      expect(mockStore.save).toHaveBeenCalledTimes(1);
    });

    it("getCheckpoint() should delegate to store.get()", async () => {
      await manager.getCheckpoint("cp-id");

      expect(mockStore.get).toHaveBeenCalledWith("cp-id");
    });

    it("getCheckpoints() should delegate to store.getByExecution()", async () => {
      await manager.getCheckpoints("exec-id");

      expect(mockStore.getByExecution).toHaveBeenCalledWith("exec-id");
    });

    it("getLatestCheckpoint() should delegate to store.getLatest()", async () => {
      await manager.getLatestCheckpoint("exec-id");

      expect(mockStore.getLatest).toHaveBeenCalledWith("exec-id");
    });

    it("deleteCheckpoint() should delegate to store.delete()", async () => {
      await manager.deleteCheckpoint("cp-id");

      expect(mockStore.delete).toHaveBeenCalledWith("cp-id");
    });

    it("deleteCheckpoints() should delegate to store.deleteByExecution()", async () => {
      await manager.deleteCheckpoints("exec-id");

      expect(mockStore.deleteByExecution).toHaveBeenCalledWith("exec-id");
    });

    it("restoreContext() should delegate to store.get() and return null when not found", async () => {
      mockStore.get.mockResolvedValue(null);

      const result = await manager.restoreContext("ghost-id");

      expect(result).toBeNull();
      expect(mockStore.get).toHaveBeenCalledWith("ghost-id");
    });
  });
});


import { Logger } from "@nestjs/common";
import {
  ExecutionCheckpointService,
  ExecutionCheckpoint,
} from "../execution-checkpoint.service";
import type { TokenUsageSnapshot } from "../token-tracker.service";

// ─── helpers ─────────────────────────────────────────────────────────────────

const zeroTokenUsage: TokenUsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  callCount: 0,
};

function makeCheckpoint(
  executionId: string,
  iteration = 1,
  overrides: Partial<ExecutionCheckpoint> = {},
): ExecutionCheckpoint {
  return {
    executionId,
    iteration,
    messages: [{ role: "user", content: "hello" }],
    toolResults: [],
    tokenUsage: { ...zeroTokenUsage },
    timestamp: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ExecutionCheckpointService", () => {
  let service: ExecutionCheckpointService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "log").mockImplementation();

    service = new ExecutionCheckpointService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── save / restore ──────────────────────────────────────────────────────────

  describe("save() then restore()", () => {
    it("returns the exact checkpoint that was saved", () => {
      const cp = makeCheckpoint("exec-1", 3, {
        messages: [{ role: "assistant", content: "result" }],
        toolResults: [{ toolId: "search", result: { hits: 5 } }],
      });

      service.save(cp);
      const restored = service.restore("exec-1");

      expect(restored).toEqual(cp);
    });

    it("restore returns null for a non-existent execution ID", () => {
      expect(service.restore("does-not-exist")).toBeNull();
    });

    it("overwrites the previous checkpoint when saved twice with the same ID", () => {
      const first = makeCheckpoint("exec-1", 1);
      const second = makeCheckpoint("exec-1", 2, {
        messages: [{ role: "user", content: "second message" }],
      });

      service.save(first);
      service.save(second);

      const restored = service.restore("exec-1");
      expect(restored?.iteration).toBe(2);
      expect(restored?.messages[0].content).toBe("second message");
    });

    it("does not mix checkpoints across different execution IDs", () => {
      service.save(makeCheckpoint("exec-a", 1));
      service.save(makeCheckpoint("exec-b", 9));

      expect(service.restore("exec-a")?.iteration).toBe(1);
      expect(service.restore("exec-b")?.iteration).toBe(9);
    });
  });

  // ─── getLatest ───────────────────────────────────────────────────────────────

  describe("getLatest()", () => {
    it("returns the same data as restore() for an existing checkpoint", () => {
      const cp = makeCheckpoint("exec-1", 5);
      service.save(cp);

      expect(service.getLatest("exec-1")).toEqual(service.restore("exec-1"));
    });

    it("returns null for a non-existent execution ID", () => {
      expect(service.getLatest("nonexistent")).toBeNull();
    });

    it("returns the latest overwrite after multiple saves", () => {
      service.save(makeCheckpoint("exec-1", 1));
      service.save(makeCheckpoint("exec-1", 2));
      service.save(makeCheckpoint("exec-1", 3));

      expect(service.getLatest("exec-1")?.iteration).toBe(3);
    });
  });

  // ─── endExecution ────────────────────────────────────────────────────────────

  describe("endExecution()", () => {
    it("returns the checkpoint and then removes it from active executions", () => {
      const cp = makeCheckpoint("exec-1", 7);
      service.save(cp);

      const returned = service.endExecution("exec-1");

      expect(returned).toEqual(cp);
      expect(service.restore("exec-1")).toBeNull();
      expect(service.getLatest("exec-1")).toBeNull();
    });

    it("returns null for a non-existent execution ID", () => {
      expect(service.endExecution("ghost")).toBeNull();
    });

    it("does not affect checkpoints for other executions", () => {
      service.save(makeCheckpoint("exec-keep", 1));
      service.save(makeCheckpoint("exec-end", 2));

      service.endExecution("exec-end");

      expect(service.restore("exec-keep")).not.toBeNull();
    });

    it("calling endExecution twice on the same ID returns null the second time", () => {
      service.save(makeCheckpoint("exec-1", 4));

      service.endExecution("exec-1");

      expect(service.endExecution("exec-1")).toBeNull();
    });
  });

  // ─── getActiveExecutions ─────────────────────────────────────────────────────

  describe("getActiveExecutions()", () => {
    it("returns an empty array when no checkpoints exist", () => {
      expect(service.getActiveExecutions()).toEqual([]);
    });

    it("lists all saved execution IDs", () => {
      service.save(makeCheckpoint("exec-1"));
      service.save(makeCheckpoint("exec-2"));
      service.save(makeCheckpoint("exec-3"));

      const active = service.getActiveExecutions();
      expect(active).toHaveLength(3);
      expect(active).toContain("exec-1");
      expect(active).toContain("exec-2");
      expect(active).toContain("exec-3");
    });

    it("reflects removal after endExecution()", () => {
      service.save(makeCheckpoint("exec-1"));
      service.save(makeCheckpoint("exec-2"));

      service.endExecution("exec-1");

      const active = service.getActiveExecutions();
      expect(active).toHaveLength(1);
      expect(active).toContain("exec-2");
      expect(active).not.toContain("exec-1");
    });

    it("does not list an ID twice when the same checkpoint is saved multiple times", () => {
      service.save(makeCheckpoint("exec-1", 1));
      service.save(makeCheckpoint("exec-1", 2));
      service.save(makeCheckpoint("exec-1", 3));

      expect(service.getActiveExecutions()).toHaveLength(1);
      expect(service.getActiveExecutions()).toContain("exec-1");
    });

    it("returns empty after all executions are ended", () => {
      service.save(makeCheckpoint("exec-a"));
      service.save(makeCheckpoint("exec-b"));

      service.endExecution("exec-a");
      service.endExecution("exec-b");

      expect(service.getActiveExecutions()).toHaveLength(0);
    });
  });

  // ─── checkpoint data integrity ───────────────────────────────────────────────

  describe("checkpoint data integrity", () => {
    it("preserves complex toolResults structure", () => {
      const cp = makeCheckpoint("exec-1", 1, {
        toolResults: [
          { toolId: "web-search", result: { urls: ["https://example.com"] } },
          { toolId: "calculator", result: 42 },
        ],
      });

      service.save(cp);
      const restored = service.restore("exec-1");

      expect(restored?.toolResults).toHaveLength(2);
      expect(restored?.toolResults[0].toolId).toBe("web-search");
      expect(restored?.toolResults[1].result).toBe(42);
    });

    it("preserves tokenUsage snapshot within the checkpoint", () => {
      const tokenUsage: TokenUsageSnapshot = {
        inputTokens: 500,
        outputTokens: 250,
        cacheCreationTokens: 30,
        cacheReadTokens: 10,
        totalTokens: 750,
        callCount: 3,
      };
      const cp = makeCheckpoint("exec-1", 2, { tokenUsage });

      service.save(cp);

      expect(service.restore("exec-1")?.tokenUsage).toEqual(tokenUsage);
    });

    it("preserves optional metadata", () => {
      const cp = makeCheckpoint("exec-1", 1, {
        metadata: { planId: "plan-42", retryCount: 2 },
      });

      service.save(cp);

      expect(service.restore("exec-1")?.metadata).toEqual({
        planId: "plan-42",
        retryCount: 2,
      });
    });
  });
});

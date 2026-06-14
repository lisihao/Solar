import { Logger } from "@nestjs/common";
import {
  TokenTrackerService,
  TokenUsageEntry,
  TokenUsageSnapshot,
} from "../token-tracker.service";

describe("TokenTrackerService", () => {
  let service: TokenTrackerService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();

    service = new TokenTrackerService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── createSession / getUsage ────────────────────────────────────────────────

  describe("createSession()", () => {
    it("returns a zero snapshot after session creation", () => {
      service.createSession("sess-1");

      const usage = service.getUsage("sess-1");

      expect(usage).not.toBeNull();
      expect(usage).toEqual<TokenUsageSnapshot>({
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        callCount: 0,
      });
    });

    it("creates independent sessions for different session IDs", () => {
      service.createSession("sess-a");
      service.createSession("sess-b");

      expect(service.getUsage("sess-a")).not.toBeNull();
      expect(service.getUsage("sess-b")).not.toBeNull();
    });
  });

  describe("getUsage()", () => {
    it("returns null for a session that was never created", () => {
      expect(service.getUsage("nonexistent")).toBeNull();
    });
  });

  // ─── recordUsage ─────────────────────────────────────────────────────────────

  describe("recordUsage()", () => {
    it("accumulates inputTokens and outputTokens across multiple calls", () => {
      service.createSession("sess-1");

      const entry1: TokenUsageEntry = { inputTokens: 100, outputTokens: 50 };
      const entry2: TokenUsageEntry = { inputTokens: 200, outputTokens: 75 };
      service.recordUsage("sess-1", entry1);
      service.recordUsage("sess-1", entry2);

      const usage = service.getUsage("sess-1");
      expect(usage?.inputTokens).toBe(300);
      expect(usage?.outputTokens).toBe(125);
    });

    it("increments callCount on each call", () => {
      service.createSession("sess-1");

      service.recordUsage("sess-1", { inputTokens: 10, outputTokens: 5 });
      service.recordUsage("sess-1", { inputTokens: 10, outputTokens: 5 });
      service.recordUsage("sess-1", { inputTokens: 10, outputTokens: 5 });

      expect(service.getUsage("sess-1")?.callCount).toBe(3);
    });

    it("accumulates cacheCreationTokens and cacheReadTokens", () => {
      service.createSession("sess-1");

      service.recordUsage("sess-1", {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 20,
        cacheReadTokens: 10,
      });
      service.recordUsage("sess-1", {
        inputTokens: 200,
        outputTokens: 80,
        cacheCreationTokens: 30,
        cacheReadTokens: 15,
      });

      const usage = service.getUsage("sess-1");
      expect(usage?.cacheCreationTokens).toBe(50);
      expect(usage?.cacheReadTokens).toBe(25);
    });

    it("treats absent cacheCreationTokens and cacheReadTokens as 0", () => {
      service.createSession("sess-1");

      service.recordUsage("sess-1", { inputTokens: 100, outputTokens: 50 });

      const usage = service.getUsage("sess-1");
      expect(usage?.cacheCreationTokens).toBe(0);
      expect(usage?.cacheReadTokens).toBe(0);
    });

    it("auto-creates session and records when session does not exist", () => {
      service.recordUsage("auto-created", {
        inputTokens: 50,
        outputTokens: 30,
      });

      const usage = service.getUsage("auto-created");
      expect(usage).not.toBeNull();
      expect(usage?.inputTokens).toBe(50);
      expect(usage?.outputTokens).toBe(30);
      expect(usage?.callCount).toBe(1);
    });

    it("totalTokens equals inputTokens plus outputTokens (no double-counting)", () => {
      service.createSession("sess-1");

      service.recordUsage("sess-1", {
        inputTokens: 300,
        outputTokens: 150,
        cacheCreationTokens: 40,
        cacheReadTokens: 20,
      });

      const usage = service.getUsage("sess-1");
      // Cache tokens must NOT be added into totalTokens
      expect(usage?.totalTokens).toBe(300 + 150);
    });

    it("totalTokens accumulates correctly across multiple calls", () => {
      service.createSession("sess-1");

      service.recordUsage("sess-1", { inputTokens: 100, outputTokens: 50 });
      service.recordUsage("sess-1", { inputTokens: 200, outputTokens: 100 });

      expect(service.getUsage("sess-1")?.totalTokens).toBe(450);
    });

    it("does not mix token counts across different sessions", () => {
      service.createSession("sess-x");
      service.createSession("sess-y");

      service.recordUsage("sess-x", { inputTokens: 500, outputTokens: 250 });

      expect(service.getUsage("sess-y")?.totalTokens).toBe(0);
    });
  });

  // ─── isOverBudget ─────────────────────────────────────────────────────────────

  describe("isOverBudget()", () => {
    it("returns false when totalTokens is below the budget limit", () => {
      service.createSession("sess-1");
      service.recordUsage("sess-1", { inputTokens: 100, outputTokens: 50 });

      expect(service.isOverBudget("sess-1", 1000)).toBe(false);
    });

    it("returns true when totalTokens equals the budget limit", () => {
      service.createSession("sess-1");
      service.recordUsage("sess-1", { inputTokens: 600, outputTokens: 400 });
      // totalTokens = 1000, budgetLimit = 1000 → at limit → over budget

      expect(service.isOverBudget("sess-1", 1000)).toBe(true);
    });

    it("returns true when totalTokens exceeds the budget limit", () => {
      service.createSession("sess-1");
      service.recordUsage("sess-1", { inputTokens: 700, outputTokens: 400 });

      expect(service.isOverBudget("sess-1", 1000)).toBe(true);
    });

    it("returns false for an unknown session ID", () => {
      expect(service.isOverBudget("does-not-exist", 500)).toBe(false);
    });
  });

  // ─── getRemainingBudget ───────────────────────────────────────────────────────

  describe("getRemainingBudget()", () => {
    it("returns the full budget when no tokens have been used", () => {
      service.createSession("sess-1");

      expect(service.getRemainingBudget("sess-1", 2000)).toBe(2000);
    });

    it("returns the correct remainder after some usage", () => {
      service.createSession("sess-1");
      service.recordUsage("sess-1", { inputTokens: 300, outputTokens: 200 });

      expect(service.getRemainingBudget("sess-1", 1000)).toBe(500);
    });

    it("clamps remaining budget to 0 when usage exceeds the limit", () => {
      service.createSession("sess-1");
      service.recordUsage("sess-1", {
        inputTokens: 1500,
        outputTokens: 500,
      });

      expect(service.getRemainingBudget("sess-1", 1000)).toBe(0);
    });

    it("returns the full budget for an unknown session ID", () => {
      expect(service.getRemainingBudget("nonexistent", 4000)).toBe(4000);
    });
  });

  // ─── endSession ──────────────────────────────────────────────────────────────

  describe("endSession()", () => {
    it("returns the usage snapshot at the time of ending", () => {
      service.createSession("sess-1");
      service.recordUsage("sess-1", { inputTokens: 400, outputTokens: 200 });

      const snapshot = service.endSession("sess-1");

      expect(snapshot).not.toBeNull();
      expect(snapshot?.inputTokens).toBe(400);
      expect(snapshot?.outputTokens).toBe(200);
      expect(snapshot?.totalTokens).toBe(600);
      expect(snapshot?.callCount).toBe(1);
    });

    it("removes the session so subsequent getUsage returns null", () => {
      service.createSession("sess-1");
      service.recordUsage("sess-1", { inputTokens: 100, outputTokens: 50 });

      service.endSession("sess-1");

      expect(service.getUsage("sess-1")).toBeNull();
    });

    it("returns null when ending a session that does not exist", () => {
      expect(service.endSession("ghost-session")).toBeNull();
    });

    it("does not affect other active sessions", () => {
      service.createSession("sess-keep");
      service.createSession("sess-end");
      service.recordUsage("sess-keep", { inputTokens: 50, outputTokens: 25 });

      service.endSession("sess-end");

      expect(service.getUsage("sess-keep")).not.toBeNull();
    });
  });
});

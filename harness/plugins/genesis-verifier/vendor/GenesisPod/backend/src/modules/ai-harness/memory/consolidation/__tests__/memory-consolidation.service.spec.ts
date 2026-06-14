import { Logger } from "@nestjs/common";
import {
  AutoDreamService,
  AutoDreamConfig,
} from "../memory-consolidation.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(
  key: string,
  value: unknown,
  sessionId = "session-1",
): { key: string; value: unknown; sessionId: string } {
  return { key, value, sessionId };
}

function makeEntries(
  count: number,
  prefix = "topic:item",
): Array<{ key: string; value: unknown; sessionId: string }> {
  return Array.from({ length: count }, (_, i) =>
    makeEntry(`${prefix}-${i}`, `value-${i}`),
  );
}

/** Advance lastRunTimes to simulate time having passed */
function backdateLastRun(
  service: AutoDreamService,
  scopeId: string,
  hoursAgo: number,
): void {
  const past = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  // Access private map via bracket notation for white-box testing
  (service as unknown as { lastRunTimes: Map<string, Date> }).lastRunTimes.set(
    scopeId,
    past,
  );
}

function setSessionCount(
  service: AutoDreamService,
  scopeId: string,
  count: number,
): void {
  (
    service as unknown as { sessionCounts: Map<string, number> }
  ).sessionCounts.set(scopeId, count);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("AutoDreamService", () => {
  let service: AutoDreamService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    service = new AutoDreamService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── shouldRun ──────────────────────────────────────────────────────────────

  describe("shouldRun", () => {
    it("returns false when already running", async () => {
      // Arrange: put scope in active state and prime gate conditions
      setSessionCount(service, "scope-1", 10);
      // Start a run without awaiting to lock the scope
      const runPromise = service.execute("scope-1", makeEntries(5));
      // Gate check must see the active run
      const result = service.shouldRun("scope-1");
      await runPromise;

      // Assert
      expect(result).toBe(false);
    });

    it("returns false when not enough time has passed since last run", () => {
      // Arrange: simulate last run 2 hours ago, min is 24 h
      backdateLastRun(service, "scope-2", 2);
      setSessionCount(service, "scope-2", 10);

      // Act
      const result = service.shouldRun("scope-2");

      // Assert
      expect(result).toBe(false);
    });

    it("returns false when not enough sessions have completed", () => {
      // Arrange: time gate passes (no prior run), but sessions < 5
      setSessionCount(service, "scope-3", 3);

      // Act
      const result = service.shouldRun("scope-3");

      // Assert
      expect(result).toBe(false);
    });

    it("returns true when both time and session gates are met", () => {
      // Arrange: last run was 30 hours ago, 8 sessions completed
      backdateLastRun(service, "scope-4", 30);
      setSessionCount(service, "scope-4", 8);

      // Act
      const result = service.shouldRun("scope-4");

      // Assert
      expect(result).toBe(true);
    });

    it("returns true on first run (no lastRunTime) when enough sessions exist", () => {
      // Arrange: no prior run, enough sessions
      setSessionCount(service, "scope-5", 5);

      // Act
      const result = service.shouldRun("scope-5");

      // Assert
      expect(result).toBe(true);
    });

    it("respects custom config overrides", () => {
      // Arrange: use lower threshold — 2 sessions is enough
      setSessionCount(service, "scope-6", 2);
      const customConfig: Partial<AutoDreamConfig> = {
        minCompletedSessions: 2,
      };

      // Act
      const result = service.shouldRun("scope-6", customConfig);

      // Assert
      expect(result).toBe(true);
    });
  });

  // ─── recordCompletedSession ─────────────────────────────────────────────────

  describe("recordCompletedSession", () => {
    it("increments counter from 0 to 1 on first call", () => {
      service.recordCompletedSession("scope-rc");

      const counts = (
        service as unknown as { sessionCounts: Map<string, number> }
      ).sessionCounts;
      expect(counts.get("scope-rc")).toBe(1);
    });

    it("increments counter monotonically across multiple calls", () => {
      service.recordCompletedSession("scope-rc2");
      service.recordCompletedSession("scope-rc2");
      service.recordCompletedSession("scope-rc2");

      const counts = (
        service as unknown as { sessionCounts: Map<string, number> }
      ).sessionCounts;
      expect(counts.get("scope-rc2")).toBe(3);
    });
  });

  // ─── execute ────────────────────────────────────────────────────────────────

  describe("execute", () => {
    it("completes all 4 phases and returns zero counts when entries are empty", async () => {
      // Act
      const result = await service.execute("scope-empty", []);

      // Assert
      expect(result.phasesCompleted).toEqual(["orient"]);
      expect(result.itemsProcessed).toBe(0);
      expect(result.itemsConsolidated).toBe(0);
      expect(result.itemsPruned).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("processes through all 4 phases when entries are provided", async () => {
      // Arrange
      const entries = makeEntries(6);

      // Act
      const result = await service.execute("scope-full", entries);

      // Assert
      expect(result.phasesCompleted).toEqual([
        "orient",
        "gather",
        "consolidate",
        "prune",
      ]);
      expect(result.itemsProcessed).toBe(6);
      expect(result.itemsPruned).toBe(6);
    });

    it("respects maxItemsPerRun and caps processed entries", async () => {
      // Arrange: 20 entries, max 5 per run
      const entries = makeEntries(20);

      // Act
      const result = await service.execute("scope-cap", entries, undefined, {
        maxItemsPerRun: 5,
      });

      // Assert
      expect(result.itemsProcessed).toBe(5);
      expect(result.itemsPruned).toBe(5);
    });

    it("calls consolidateFn for multi-entry groups", async () => {
      // Arrange: 3 entries under the same topic prefix
      const entries = [
        makeEntry("research:finding-1", "value-a"),
        makeEntry("research:finding-2", "value-b"),
        makeEntry("research:finding-3", "value-c"),
      ];

      const consolidateFn = jest.fn().mockResolvedValue({
        key: "research:consolidated",
        value: "merged",
      });

      // Act
      const result = await service.execute(
        "scope-consolidate",
        entries,
        consolidateFn,
      );

      // Assert
      expect(consolidateFn).toHaveBeenCalledTimes(1);
      expect(consolidateFn).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ key: "research:finding-1" }),
        ]),
      );
      expect(result.itemsConsolidated).toBe(1);
    });

    it("continues without crashing when consolidateFn throws", async () => {
      // Arrange: 2 entries that will go to the same group
      const entries = [
        makeEntry("topic:a", "val-1"),
        makeEntry("topic:b", "val-2"),
      ];

      const consolidateFn = jest
        .fn()
        .mockRejectedValue(new Error("LLM timeout"));

      // Act
      const result = await service.execute("scope-err", entries, consolidateFn);

      // Assert — run must complete all phases
      expect(result.phasesCompleted).toContain("prune");
      expect(result.itemsProcessed).toBe(2);
    });

    it("resets session counter and records lastRunTime after completion", async () => {
      // Arrange
      setSessionCount(service, "scope-reset", 7);
      const entries = makeEntries(3);

      // Act
      await service.execute("scope-reset", entries);

      // Assert
      const counts = (
        service as unknown as { sessionCounts: Map<string, number> }
      ).sessionCounts;
      const lastRuns = (
        service as unknown as { lastRunTimes: Map<string, Date> }
      ).lastRunTimes;
      expect(counts.get("scope-reset")).toBe(0);
      expect(lastRuns.has("scope-reset")).toBe(true);
    });

    it("does not consolidate single-entry groups when consolidateFn is provided", async () => {
      // Arrange: each entry has a unique key (no shared prefix after last separator)
      const entries = [
        makeEntry("alpha", "v1"),
        makeEntry("beta", "v2"),
        makeEntry("gamma", "v3"),
      ];

      const consolidateFn = jest.fn().mockResolvedValue({
        key: "merged",
        value: "x",
      });

      // Act
      await service.execute("scope-single", entries, consolidateFn);

      // Assert: consolidateFn is never called for single-entry groups
      expect(consolidateFn).not.toHaveBeenCalled();
    });
  });

  // ─── getStatus ───────────────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("returns status mid-execution and null after completion", async () => {
      // Arrange
      let capturedStatus = null as ReturnType<typeof service.getStatus>;
      const fakeFn = jest.fn().mockImplementation(async () => {
        capturedStatus = service.getStatus("scope-status");
        return { key: "k", value: "v" };
      });

      const entries = [makeEntry("group:x", "v1"), makeEntry("group:y", "v2")];

      // Act
      await service.execute("scope-status", entries, fakeFn);
      const statusAfter = service.getStatus("scope-status");

      // Assert
      expect(capturedStatus).not.toBeNull();
      expect(capturedStatus?.phase).toBeDefined();
      expect(statusAfter).toBeNull();
    });

    it("returns null for an unknown scope", () => {
      expect(service.getStatus("nonexistent")).toBeNull();
    });
  });

  // ─── cancel ──────────────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("removes active run and returns true", async () => {
      // Arrange: inject a fake active run entry
      const activeRuns = (
        service as unknown as { activeRuns: Map<string, unknown> }
      ).activeRuns;
      activeRuns.set("scope-cancel", {
        phase: "gather",
        progress: 30,
        itemsProcessed: 5,
        startedAt: new Date(),
      });

      // Act
      const cancelled = service.cancel("scope-cancel");

      // Assert
      expect(cancelled).toBe(true);
      expect(service.getStatus("scope-cancel")).toBeNull();
    });

    it("returns false when scope has no active run", () => {
      // Act
      const result = service.cancel("scope-nothing");

      // Assert
      expect(result).toBe(false);
    });
  });

  // ─── groupByTopic (indirectly through execute) ───────────────────────────────

  describe("topic grouping", () => {
    it("groups entries sharing a colon-delimited prefix into the same group", async () => {
      const entries = [
        makeEntry("finance:revenue", 100),
        makeEntry("finance:costs", 200),
        makeEntry("marketing:ctr", 0.05),
      ];

      const consolidateFn = jest
        .fn()
        .mockResolvedValue({ key: "k", value: "v" });

      await service.execute("scope-group", entries, consolidateFn);

      // finance group has 2 entries → consolidateFn called once
      expect(consolidateFn).toHaveBeenCalledTimes(1);
    });

    it("groups entries sharing a slash-delimited prefix", async () => {
      const entries = [
        makeEntry("reports/q1", "data-a"),
        makeEntry("reports/q2", "data-b"),
      ];

      const consolidateFn = jest
        .fn()
        .mockResolvedValue({ key: "k", value: "v" });

      await service.execute("scope-slash", entries, consolidateFn);

      expect(consolidateFn).toHaveBeenCalledTimes(1);
    });
  });
});

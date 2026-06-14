import {
  decideMissionInFlight,
  HEARTBEAT_FRESH_THRESHOLD_MS_DEFAULT,
  BUSINESS_EVENT_FRESH_THRESHOLD_MS_DEFAULT,
} from "../heartbeat-decision";

const HB = HEARTBEAT_FRESH_THRESHOLD_MS_DEFAULT; // 60_000
const BE = BUSINESS_EVENT_FRESH_THRESHOLD_MS_DEFAULT; // 300_000

describe("decideMissionInFlight", () => {
  describe("status short-circuit", () => {
    it("non-running status → inFlight=false regardless of heartbeat/event", () => {
      for (const status of [
        "completed",
        "failed",
        "quality-failed",
        "cancelled",
      ]) {
        const result = decideMissionInFlight({
          status,
          heartbeatAgeMs: 0,
          latestBusinessEventAgeMs: 0,
        });
        expect(result.inFlight).toBe(false);
        expect(result.zombieDetected).toBe(false);
      }
    });

    it("custom runningStatuses: only listed statuses are treated as running", () => {
      const runningStatuses = ["active", "processing"] as const;
      expect(
        decideMissionInFlight({
          status: "running",
          heartbeatAgeMs: 0,
          latestBusinessEventAgeMs: 0,
          runningStatuses,
        }).inFlight,
      ).toBe(false);
      expect(
        decideMissionInFlight({
          status: "active",
          heartbeatAgeMs: 0,
          latestBusinessEventAgeMs: 0,
          runningStatuses,
        }).inFlight,
      ).toBe(true);
    });
  });

  describe("9-cell matrix (status=running)", () => {
    // Cell 1: heartbeat FRESH + business FRESH → inFlight=true
    it("cell 1: HB fresh + BE fresh → inFlight", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: HB - 1,
        latestBusinessEventAgeMs: BE - 1,
      });
      expect(r.inFlight).toBe(true);
      expect(r.zombieDetected).toBe(false);
      expect(r.reason).toMatch(/heartbeat.*ago.*business event.*ago/i);
    });

    // Cell 2: heartbeat FRESH + business STALE → zombie
    it("cell 2: HB fresh + BE stale → zombieDetected", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: HB - 1,
        latestBusinessEventAgeMs: BE + 1,
      });
      expect(r.inFlight).toBe(false);
      expect(r.zombieDetected).toBe(true);
    });

    // Cell 3: heartbeat FRESH + business NULL → zombie
    it("cell 3: HB fresh + BE null → zombieDetected", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: HB - 1,
        latestBusinessEventAgeMs: null,
      });
      expect(r.inFlight).toBe(false);
      expect(r.zombieDetected).toBe(true);
    });

    // Cell 4: heartbeat STALE + business FRESH → not inFlight (RV-7)
    it("cell 4: HB stale + BE fresh → not inFlight (RV-7)", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: HB + 1,
        latestBusinessEventAgeMs: BE - 1,
      });
      expect(r.inFlight).toBe(false);
      expect(r.zombieDetected).toBe(false);
    });

    // Cell 5: heartbeat STALE + business STALE → not inFlight
    it("cell 5: HB stale + BE stale → not inFlight", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: HB + 1,
        latestBusinessEventAgeMs: BE + 1,
      });
      expect(r.inFlight).toBe(false);
      expect(r.zombieDetected).toBe(false);
    });

    // Cell 6: heartbeat STALE + business NULL → not inFlight
    it("cell 6: HB stale + BE null → not inFlight", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: HB + 1,
        latestBusinessEventAgeMs: null,
      });
      expect(r.inFlight).toBe(false);
      expect(r.zombieDetected).toBe(false);
    });

    // Cell 7: heartbeat NULL + business FRESH → not inFlight (RV-7)
    it("cell 7: HB null + BE fresh → not inFlight (RV-7)", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: null,
        latestBusinessEventAgeMs: BE - 1,
      });
      expect(r.inFlight).toBe(false);
      expect(r.zombieDetected).toBe(false);
    });

    // Cell 8: heartbeat NULL + business STALE → not inFlight
    it("cell 8: HB null + BE stale → not inFlight", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: null,
        latestBusinessEventAgeMs: BE + 1,
      });
      expect(r.inFlight).toBe(false);
      expect(r.zombieDetected).toBe(false);
    });

    // Cell 9: heartbeat NULL + business NULL → not inFlight (fresh mission, no events yet)
    it("cell 9: HB null + BE null → not inFlight", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: null,
        latestBusinessEventAgeMs: null,
      });
      expect(r.inFlight).toBe(false);
      expect(r.zombieDetected).toBe(false);
    });
  });

  describe("threshold overrides", () => {
    it("custom heartbeatFreshThresholdMs is respected", () => {
      const custom = 10_000;
      // heartbeatAgeMs=9999 is fresh at 10s threshold
      expect(
        decideMissionInFlight({
          status: "running",
          heartbeatAgeMs: custom - 1,
          latestBusinessEventAgeMs: 0,
          heartbeatFreshThresholdMs: custom,
        }).inFlight,
      ).toBe(true);
      // heartbeatAgeMs=10001 is stale at 10s threshold
      expect(
        decideMissionInFlight({
          status: "running",
          heartbeatAgeMs: custom + 1,
          latestBusinessEventAgeMs: 0,
          heartbeatFreshThresholdMs: custom,
        }).inFlight,
      ).toBe(false);
    });

    it("custom businessEventFreshThresholdMs is respected", () => {
      const custom = 30_000;
      expect(
        decideMissionInFlight({
          status: "running",
          heartbeatAgeMs: 0,
          latestBusinessEventAgeMs: custom - 1,
          businessEventFreshThresholdMs: custom,
        }).inFlight,
      ).toBe(true);
      expect(
        decideMissionInFlight({
          status: "running",
          heartbeatAgeMs: 0,
          latestBusinessEventAgeMs: custom + 1,
          businessEventFreshThresholdMs: custom,
        }).zombieDetected,
      ).toBe(true);
    });
  });

  describe("boundary conditions", () => {
    it("heartbeatAgeMs exactly at threshold → treated as stale (not fresh)", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: HB,
        latestBusinessEventAgeMs: 0,
      });
      expect(r.inFlight).toBe(false);
    });

    it("latestBusinessEventAgeMs exactly at threshold → treated as stale", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: 0,
        latestBusinessEventAgeMs: BE,
      });
      expect(r.zombieDetected).toBe(true);
    });

    it("age=0 is always fresh", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: 0,
        latestBusinessEventAgeMs: 0,
      });
      expect(r.inFlight).toBe(true);
    });
  });

  describe("reason field", () => {
    it("inFlight=true includes reason string with age values", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: 5000,
        latestBusinessEventAgeMs: 3000,
      });
      expect(r.reason).toBeDefined();
      expect(r.reason).toContain("5s");
      expect(r.reason).toContain("3s");
    });

    it("inFlight=false has no reason", () => {
      const r = decideMissionInFlight({
        status: "running",
        heartbeatAgeMs: null,
        latestBusinessEventAgeMs: null,
      });
      expect(r.reason).toBeUndefined();
    });
  });
});

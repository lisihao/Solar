/**
 * process.types Unit Tests
 *
 * Validates the VALID_TRANSITIONS state machine table and the TERMINAL_STATES
 * constant defined in process.types.ts.
 *
 * These are pure data-structure tests — no I/O, no dependencies, no mocks.
 */

import { VALID_TRANSITIONS, TERMINAL_STATES } from "../process.types";

describe("VALID_TRANSITIONS state machine", () => {
  // ─── CREATED ────────────────────────────────────────────────────────────────

  describe("CREATED state", () => {
    it("should allow transition to READY", () => {
      expect(VALID_TRANSITIONS["CREATED"]).toContain("READY");
    });

    it("should allow transition to CANCELLED", () => {
      expect(VALID_TRANSITIONS["CREATED"]).toContain("CANCELLED");
    });

    it("should not allow transition to RUNNING", () => {
      expect(VALID_TRANSITIONS["CREATED"]).not.toContain("RUNNING");
    });

    it("should not allow transition to PAUSED", () => {
      expect(VALID_TRANSITIONS["CREATED"]).not.toContain("PAUSED");
    });

    it("should not allow transition to COMPLETED", () => {
      expect(VALID_TRANSITIONS["CREATED"]).not.toContain("COMPLETED");
    });

    it("should not allow transition to FAILED", () => {
      expect(VALID_TRANSITIONS["CREATED"]).not.toContain("FAILED");
    });

    it("should only have exactly 2 valid target states", () => {
      expect(VALID_TRANSITIONS["CREATED"]).toHaveLength(2);
    });
  });

  // ─── READY ──────────────────────────────────────────────────────────────────

  describe("READY state", () => {
    it("should allow transition to RUNNING", () => {
      expect(VALID_TRANSITIONS["READY"]).toContain("RUNNING");
    });

    it("should allow transition to CANCELLED", () => {
      expect(VALID_TRANSITIONS["READY"]).toContain("CANCELLED");
    });

    it("should not allow transition to COMPLETED directly", () => {
      expect(VALID_TRANSITIONS["READY"]).not.toContain("COMPLETED");
    });

    it("should not allow transition to PAUSED", () => {
      expect(VALID_TRANSITIONS["READY"]).not.toContain("PAUSED");
    });

    it("should not allow transition to FAILED directly", () => {
      expect(VALID_TRANSITIONS["READY"]).not.toContain("FAILED");
    });

    it("should only have exactly 2 valid target states", () => {
      expect(VALID_TRANSITIONS["READY"]).toHaveLength(2);
    });
  });

  // ─── RUNNING ────────────────────────────────────────────────────────────────

  describe("RUNNING state", () => {
    it("should allow transition to PAUSED", () => {
      expect(VALID_TRANSITIONS["RUNNING"]).toContain("PAUSED");
    });

    it("should allow transition to WAITING", () => {
      expect(VALID_TRANSITIONS["RUNNING"]).toContain("WAITING");
    });

    it("should allow transition to COMPLETED", () => {
      expect(VALID_TRANSITIONS["RUNNING"]).toContain("COMPLETED");
    });

    it("should allow transition to FAILED", () => {
      expect(VALID_TRANSITIONS["RUNNING"]).toContain("FAILED");
    });

    it("should allow transition to CANCELLED", () => {
      expect(VALID_TRANSITIONS["RUNNING"]).toContain("CANCELLED");
    });

    it("should not allow transition to CREATED", () => {
      expect(VALID_TRANSITIONS["RUNNING"]).not.toContain("CREATED");
    });

    it("should not allow transition to READY", () => {
      expect(VALID_TRANSITIONS["RUNNING"]).not.toContain("READY");
    });

    it("should only have exactly 5 valid target states", () => {
      expect(VALID_TRANSITIONS["RUNNING"]).toHaveLength(5);
    });
  });

  // ─── PAUSED ─────────────────────────────────────────────────────────────────

  describe("PAUSED state", () => {
    it("should allow transition to READY (to be resumed)", () => {
      expect(VALID_TRANSITIONS["PAUSED"]).toContain("READY");
    });

    it("should allow transition to CANCELLED", () => {
      expect(VALID_TRANSITIONS["PAUSED"]).toContain("CANCELLED");
    });

    it("should not allow transition directly back to RUNNING", () => {
      expect(VALID_TRANSITIONS["PAUSED"]).not.toContain("RUNNING");
    });

    it("should not allow transition to COMPLETED", () => {
      expect(VALID_TRANSITIONS["PAUSED"]).not.toContain("COMPLETED");
    });

    it("should only have exactly 2 valid target states", () => {
      expect(VALID_TRANSITIONS["PAUSED"]).toHaveLength(2);
    });
  });

  // ─── WAITING ────────────────────────────────────────────────────────────────

  describe("WAITING state", () => {
    it("should allow transition to READY", () => {
      expect(VALID_TRANSITIONS["WAITING"]).toContain("READY");
    });

    it("should allow transition to FAILED", () => {
      expect(VALID_TRANSITIONS["WAITING"]).toContain("FAILED");
    });

    it("should allow transition to CANCELLED", () => {
      expect(VALID_TRANSITIONS["WAITING"]).toContain("CANCELLED");
    });

    it("should not allow transition directly to COMPLETED", () => {
      expect(VALID_TRANSITIONS["WAITING"]).not.toContain("COMPLETED");
    });

    it("should only have exactly 3 valid target states", () => {
      expect(VALID_TRANSITIONS["WAITING"]).toHaveLength(3);
    });
  });

  // ─── COMPLETED ──────────────────────────────────────────────────────────────

  describe("COMPLETED state", () => {
    it("should have no valid transitions (terminal state)", () => {
      expect(VALID_TRANSITIONS["COMPLETED"]).toHaveLength(0);
    });

    it("should not allow transition to any state", () => {
      const allStates = [
        "CREATED",
        "READY",
        "RUNNING",
        "PAUSED",
        "WAITING",
        "FAILED",
        "CANCELLED",
        "ZOMBIE",
      ];
      for (const state of allStates) {
        expect(VALID_TRANSITIONS["COMPLETED"]).not.toContain(state);
      }
    });
  });

  // ─── FAILED ─────────────────────────────────────────────────────────────────

  describe("FAILED state", () => {
    it("should allow transition to READY to support retry", () => {
      expect(VALID_TRANSITIONS["FAILED"]).toContain("READY");
    });

    it("should not allow transition to RUNNING directly", () => {
      expect(VALID_TRANSITIONS["FAILED"]).not.toContain("RUNNING");
    });

    it("should not allow transition to COMPLETED", () => {
      expect(VALID_TRANSITIONS["FAILED"]).not.toContain("COMPLETED");
    });

    it("should not allow transition to CANCELLED", () => {
      expect(VALID_TRANSITIONS["FAILED"]).not.toContain("CANCELLED");
    });

    it("should only have exactly 1 valid target state", () => {
      expect(VALID_TRANSITIONS["FAILED"]).toHaveLength(1);
    });
  });

  // ─── CANCELLED ──────────────────────────────────────────────────────────────

  describe("CANCELLED state", () => {
    it("should have no valid transitions (terminal state)", () => {
      expect(VALID_TRANSITIONS["CANCELLED"]).toHaveLength(0);
    });

    it("should not allow transition to any state", () => {
      const allStates = [
        "CREATED",
        "READY",
        "RUNNING",
        "PAUSED",
        "WAITING",
        "COMPLETED",
        "FAILED",
        "ZOMBIE",
      ];
      for (const state of allStates) {
        expect(VALID_TRANSITIONS["CANCELLED"]).not.toContain(state);
      }
    });
  });

  // ─── ZOMBIE ─────────────────────────────────────────────────────────────────

  describe("ZOMBIE state", () => {
    it("should have no valid transitions (terminal state)", () => {
      expect(VALID_TRANSITIONS["ZOMBIE"]).toHaveLength(0);
    });

    it("should not allow transition to any state", () => {
      const allStates = [
        "CREATED",
        "READY",
        "RUNNING",
        "PAUSED",
        "WAITING",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
      ];
      for (const state of allStates) {
        expect(VALID_TRANSITIONS["ZOMBIE"]).not.toContain(state);
      }
    });
  });

  // ─── Table-level invariants ──────────────────────────────────────────────────

  describe("table-level invariants", () => {
    it("should define transitions for all 8 known process states", () => {
      const expectedStates = [
        "CREATED",
        "READY",
        "RUNNING",
        "PAUSED",
        "WAITING",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "ZOMBIE",
      ];
      for (const state of expectedStates) {
        expect(VALID_TRANSITIONS).toHaveProperty(state);
      }
    });

    it("should only reference known states as transition targets", () => {
      const knownStates = new Set([
        "CREATED",
        "READY",
        "RUNNING",
        "PAUSED",
        "WAITING",
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "ZOMBIE",
      ]);

      for (const targets of Object.values(VALID_TRANSITIONS)) {
        for (const target of targets) {
          expect(knownStates.has(target)).toBe(true);
        }
      }
    });
  });
});

// ─── TERMINAL_STATES ────────────────────────────────────────────────────────

describe("TERMINAL_STATES", () => {
  it("should include COMPLETED", () => {
    expect(TERMINAL_STATES).toContain("COMPLETED");
  });

  it("should include FAILED", () => {
    expect(TERMINAL_STATES).toContain("FAILED");
  });

  it("should include CANCELLED", () => {
    expect(TERMINAL_STATES).toContain("CANCELLED");
  });

  it("should include ZOMBIE", () => {
    expect(TERMINAL_STATES).toContain("ZOMBIE");
  });

  it("should not include RUNNING", () => {
    expect(TERMINAL_STATES).not.toContain("RUNNING");
  });

  it("should not include PAUSED", () => {
    expect(TERMINAL_STATES).not.toContain("PAUSED");
  });

  it("should not include READY", () => {
    expect(TERMINAL_STATES).not.toContain("READY");
  });

  it("should not include CREATED", () => {
    expect(TERMINAL_STATES).not.toContain("CREATED");
  });

  it("should not include WAITING", () => {
    expect(TERMINAL_STATES).not.toContain("WAITING");
  });

  it("should have exactly 4 terminal states", () => {
    expect(TERMINAL_STATES).toHaveLength(4);
  });

  it("should be consistent with VALID_TRANSITIONS (COMPLETED, CANCELLED, ZOMBIE have no outbound transitions)", () => {
    // FAILED is in TERMINAL_STATES but retains a READY transition to support retry.
    // The other three terminal states are truly sink nodes.
    const sinkStates = ["COMPLETED", "CANCELLED", "ZOMBIE"] as const;
    for (const state of sinkStates) {
      expect(VALID_TRANSITIONS[state]).toHaveLength(0);
    }
  });

  it("should be consistent with VALID_TRANSITIONS (FAILED allows a retry transition to READY)", () => {
    // FAILED is considered terminal (no further work begins) but the state machine
    // intentionally keeps one outbound edge so operators can retry the process.
    expect(VALID_TRANSITIONS["FAILED"]).toContain("READY");
    expect(VALID_TRANSITIONS["FAILED"]).toHaveLength(1);
  });

  it("should be consistent with VALID_TRANSITIONS (non-terminal states have at least one transition)", () => {
    const allStates = Object.keys(VALID_TRANSITIONS);
    const terminalSet = new Set(TERMINAL_STATES);

    for (const state of allStates) {
      if (!terminalSet.has(state as any)) {
        expect(VALID_TRANSITIONS[state as any].length).toBeGreaterThan(0);
      }
    }
  });
});

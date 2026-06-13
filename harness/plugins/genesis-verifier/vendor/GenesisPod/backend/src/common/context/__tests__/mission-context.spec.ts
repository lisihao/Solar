/**
 * MissionContext contract spec — locks the 2026-05-11 rename + the
 * "agentProcessId is optional, missionId is the catch-all" semantics.
 *
 * Why this spec exists: the prod log flood incident was caused by 4+
 * callers stuffing missionId into the `processId` slot. After renaming
 * the field to `agentProcessId` and adding JSDoc, this spec asserts:
 *   1. omitting agentProcessId is legal (TS + runtime)
 *   2. getAgentProcessId() returns undefined when not set
 *   3. setting only missionId / userId works (no FK trap)
 *   4. setting agentProcessId surfaces it via the getter
 *   5. nested run() inherits + overrides cleanly
 */

import { MissionContext } from "../mission-context";

describe("MissionContext (post 2026-05-11 rename)", () => {
  it("returns undefined for agentProcessId when not set", () => {
    MissionContext.run({ userId: "u1" }, () => {
      expect(MissionContext.getAgentProcessId()).toBeUndefined();
      expect(MissionContext.get()?.userId).toBe("u1");
    });
  });

  it("accepts missionId-only context (no agentProcessId) — the business-team / playground path", () => {
    MissionContext.run({ missionId: "mission-abc", userId: "u1" }, () => {
      expect(MissionContext.getMissionId()).toBe("mission-abc");
      expect(MissionContext.getAgentProcessId()).toBeUndefined();
    });
  });

  it("surfaces agentProcessId via the dedicated getter when set", () => {
    MissionContext.run(
      { agentProcessId: "agent-process-xyz", userId: "u1" },
      () => {
        expect(MissionContext.getAgentProcessId()).toBe("agent-process-xyz");
      },
    );
  });

  it("propagates context through nested async scopes", async () => {
    await MissionContext.run(
      { agentProcessId: "outer", missionId: "mission-1", userId: "u1" },
      async () => {
        await Promise.resolve();
        expect(MissionContext.getAgentProcessId()).toBe("outer");
        expect(MissionContext.getMissionId()).toBe("mission-1");
      },
    );
  });

  it("nested run() can override agentProcessId without affecting outer scope", () => {
    MissionContext.run({ agentProcessId: "outer", userId: "u1" }, () => {
      MissionContext.run(
        { ...MissionContext.get()!, agentProcessId: "inner" },
        () => {
          expect(MissionContext.getAgentProcessId()).toBe("inner");
        },
      );
      expect(MissionContext.getAgentProcessId()).toBe("outer");
    });
  });
});

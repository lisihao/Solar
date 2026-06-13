/**
 * narrative.util.spec.ts
 * Tests for the narrate() helper function.
 */

import { narrate } from "../../artifacts/narrative.util";
import type { EmitFn } from "../../context/mission-deps";

function makeEmit(): jest.MockedFunction<EmitFn> {
  return jest.fn().mockResolvedValue(undefined);
}

describe("narrate", () => {
  it("calls emit with playground.agent:narrative type", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s2-leader-plan",
      role: "leader",
      tag: "thinking",
      text: "Planning...",
    });
    expect(emit).toHaveBeenCalledTimes(1);
    const args = emit.mock.calls[0][0];
    expect(args.type).toBe("playground.agent:narrative");
  });

  it("passes missionId and userId correctly", async () => {
    const emit = makeEmit();
    await narrate(emit, "mission-99", "user-42", {
      stage: "s3-researchers",
      role: "researcher",
      tag: "searching",
      text: "Searching...",
    });
    const args = emit.mock.calls[0][0];
    expect(args.missionId).toBe("mission-99");
    expect(args.userId).toBe("user-42");
  });

  it("passes stage, role, tag, text in payload", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s6-analyst",
      role: "analyst",
      tag: "analyzing",
      text: "Analyzing data",
    });
    const payload = emit.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.stage).toBe("s6-analyst");
    expect(payload.role).toBe("analyst");
    expect(payload.tag).toBe("analyzing");
    expect(payload.text).toBe("Analyzing data");
  });

  it("passes dimension when provided", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s3-researchers",
      role: "writer",
      tag: "writing",
      text: "Writing chapter",
      dimension: "Technology",
    });
    const payload = emit.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.dimension).toBe("Technology");
  });

  it("passes chapterIndex when provided", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s8-writer-draft",
      role: "writer",
      tag: "writing",
      text: "Writing",
      chapterIndex: 3,
    });
    const payload = emit.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.chapterIndex).toBe(3);
  });

  it("passes agentId in event when provided", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s2-leader-plan",
      role: "leader",
      tag: "planning",
      text: "Plan",
      agentId: "leader#0",
    });
    const args = emit.mock.calls[0][0];
    expect(args.agentId).toBe("leader#0");
  });

  it("does not throw when emit rejects (best-effort)", async () => {
    const emit = jest.fn().mockRejectedValue(new Error("bus down"));
    await expect(
      narrate(emit, "m1", "u1", {
        stage: "s5-reconciler",
        role: "reconciler",
        tag: "info",
        text: "Reconciling",
      }),
    ).resolves.toBeUndefined();
  });

  it("handles warning tag correctly", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s9-critic-l4",
      role: "critic",
      tag: "warning",
      text: "Issues found",
    });
    const payload = emit.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.tag).toBe("warning");
  });

  it("handles success tag correctly", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s10-leader-signoff",
      role: "leader",
      tag: "signing",
      text: "Signed off",
    });
    const payload = emit.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.tag).toBe("signing");
    expect(payload.text).toBe("Signed off");
  });

  it("payload.dimension is undefined when not provided", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s11-persist",
      role: "mission",
      tag: "info",
      text: "Done",
    });
    const payload = emit.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.dimension).toBeUndefined();
  });

  it("payload.chapterIndex is undefined when not provided", async () => {
    const emit = makeEmit();
    await narrate(emit, "m1", "u1", {
      stage: "s11-persist",
      role: "mission",
      tag: "success",
      text: "Mission complete",
    });
    const payload = emit.mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.chapterIndex).toBeUndefined();
  });
});

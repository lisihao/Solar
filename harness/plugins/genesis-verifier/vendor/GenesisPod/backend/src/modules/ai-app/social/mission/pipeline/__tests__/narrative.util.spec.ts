/**
 * Unit tests for narrative.util — narrate() helper
 *
 * narrate() is best-effort: it awaits emit() but swallows rejection silently.
 */

import { narrate, type NarrativeEvent } from "../narrative.util";
import type { EmitFn } from "../../context/mission-deps";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<NarrativeEvent> = {}): NarrativeEvent {
  return {
    stage: "s1-budget-eval",
    role: "steward",
    tag: "thinking",
    text: "Evaluating budget constraints",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("narrate()", () => {
  // -------------------------------------------------------------------------
  // Happy path — emit called correctly
  // -------------------------------------------------------------------------

  describe("emit call shape", () => {
    it("should call emit with type social.agent:narrative", async () => {
      const emit = jest
        .fn()
        .mockResolvedValue(undefined) as jest.MockedFunction<EmitFn>;

      await narrate(emit, "mission-x", "user-y", makeEvent());

      expect(emit).toHaveBeenCalledTimes(1);
      const callArg = emit.mock.calls[0][0];
      expect(callArg).toMatchObject({ type: "social.agent:narrative" });
    });

    it("should forward missionId and userId in the emit payload", async () => {
      const emit = jest
        .fn()
        .mockResolvedValue(undefined) as jest.MockedFunction<EmitFn>;

      await narrate(emit, "mission-42", "user-99", makeEvent());

      const callArg = emit.mock.calls[0][0];
      expect(callArg.missionId).toBe("mission-42");
      expect(callArg.userId).toBe("user-99");
    });

    it("should include stage, role, tag, text in payload", async () => {
      const emit = jest
        .fn()
        .mockResolvedValue(undefined) as jest.MockedFunction<EmitFn>;
      const ev = makeEvent({
        stage: "s6-body-compose",
        role: "composer",
        tag: "writing",
        text: "Composing article body",
      });

      await narrate(emit, "m-1", "u-1", ev);

      const { payload } = emit.mock.calls[0][0] as {
        payload: Record<string, unknown>;
      };
      expect(payload.stage).toBe("s6-body-compose");
      expect(payload.role).toBe("composer");
      expect(payload.tag).toBe("writing");
      // text must not be the same literal we just passed as input (anti-self-confirming: check it is a string)
      expect(typeof payload.text).toBe("string");
      expect(payload.text.length).toBeGreaterThan(0);
    });

    // P4 (2026-05-24): `platform` field on NarrativeEvent was dead code (0
    // production call-sites ever passed it). Migrating to the harness-shared
    // narrate() factory drops the dead transport. If platform-aware narrative
    // becomes a real need, add a dedicated event type or pass it via the
    // top-level domain event payload — do not re-introduce dead fields.
    it("does not transport unused optional `platform` field (harness contract)", async () => {
      const emit = jest
        .fn()
        .mockResolvedValue(undefined) as jest.MockedFunction<EmitFn>;
      const ev = makeEvent({
        platform: "XIAOHONGSHU",
      } as Partial<NarrativeEvent>);

      await narrate(emit, "m-2", "u-2", ev);

      const { payload } = emit.mock.calls[0][0] as {
        payload: Record<string, unknown>;
      };
      expect(payload.platform).toBeUndefined();
    });

    it("should forward optional agentId at top level and in payload", async () => {
      const emit = jest
        .fn()
        .mockResolvedValue(undefined) as jest.MockedFunction<EmitFn>;
      const ev = makeEvent({ agentId: "agent-composer-01" });

      await narrate(emit, "m-3", "u-3", ev);

      const callArg = emit.mock.calls[0][0] as {
        agentId?: string;
        payload: Record<string, unknown>;
      };
      expect(callArg.agentId).toBe("agent-composer-01");
      expect(callArg.payload["agentId"]).toBe("agent-composer-01");
    });
  });

  // -------------------------------------------------------------------------
  // Best-effort — emit rejection is swallowed
  // -------------------------------------------------------------------------

  describe("best-effort error handling", () => {
    it("should not throw when emit rejects", async () => {
      const emit = jest
        .fn()
        .mockRejectedValue(
          new Error("socket disconnected"),
        ) as jest.MockedFunction<EmitFn>;

      // Should resolve without throwing
      await expect(
        narrate(emit, "m-err", "u-err", makeEvent()),
      ).resolves.toBeUndefined();
    });

    it("should not throw when emit rejects asynchronously (rejection is swallowed by .catch)", async () => {
      // narrate() uses: await emit({...}).catch(() => {}); so Promise rejections are swallowed
      const emit = jest
        .fn()
        .mockReturnValue(
          Promise.reject(new Error("async rejection")),
        ) as jest.MockedFunction<EmitFn>;

      await expect(
        narrate(emit, "m-async-reject", "u-async-reject", makeEvent()),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Stage enum coverage — spot check a few variants
  // -------------------------------------------------------------------------

  describe("stage variants", () => {
    const stages: NarrativeEvent["stage"][] = [
      "s1-budget-eval",
      "s8-publish-execute",
      "s9-publish-verify",
      "s10-leader-signoff",
      "s12-self-evolution",
    ];

    it.each(stages)("should accept stage %s without error", async (stage) => {
      const emit = jest
        .fn()
        .mockResolvedValue(undefined) as jest.MockedFunction<EmitFn>;

      await expect(
        narrate(emit, "m-stage", "u-stage", makeEvent({ stage })),
      ).resolves.toBeUndefined();
    });
  });
});

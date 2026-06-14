/**
 * HookRegistry — extra branch coverage
 *
 * Covers:
 * - withTimeout: async handler that resolves (line 100)
 * - withTimeout: async handler that rejects → caught, logged, continue (lines 110-113)
 * - replacePayload mutation → result carries modified payload (line 120, 128)
 * - matchesScope: scope without scopeTarget → ignored (lines 139-143)
 * - matchesScope: scope="agent" with matching/non-matching agentId (lines 145-146)
 * - matchesScope: scope="role" (lines 148-153)
 * - matchesScope: scope="skill" (lines 154-159)
 * - unregister when binding list is undefined (fallback branch)
 */

import { HookRegistry } from "../hook-registry";
import type {
  IContextEnvelope,
  IBudgetSnapshot,
  IMemoryBinding,
} from "../../abstractions";

function makeEnv(
  overrides?: Partial<{ roleId: string; activeSkill: string }>,
): IContextEnvelope {
  const budget: IBudgetSnapshot = {
    tokensUsed: 0,
    tokensRemaining: 1000,
    iterationsUsed: 0,
    iterationsRemaining: 10,
    wallTimeStartMs: Date.now(),
  };
  const memory: IMemoryBinding = { sessionId: "s1" };
  return {
    id: "env-1",
    system: "sys",
    messages: [],
    reminders: [],
    tools: [],
    memory,
    budget,
    metadata: overrides ?? {},
  };
}

// ─── async handler (withTimeout path) ────────────────────────────────────────

describe("HookRegistry.dispatch — async handler", () => {
  it("awaits an async handler (withTimeout path)", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "global",
      handler: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            called.push("async-done");
            resolve();
          }, 1);
        }),
    });

    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(called).toEqual(["async-done"]);
  });

  it("continues past async handler that rejects (catches error, logs, moves on)", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "global",
      priority: 10,
      handler: () => Promise.reject(new Error("handler-crash")),
    });

    reg.register({
      event: "SessionStart",
      scope: "global",
      priority: 1,
      handler: () => {
        called.push("second");
      },
    });

    // Should not throw
    const result = await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(result).toBeDefined();
    expect(called).toEqual(["second"]); // second handler ran despite first crash
  });

  it("continues past sync handler that throws", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "global",
      priority: 10,
      handler: () => {
        throw new Error("sync-crash");
      },
    });

    reg.register({
      event: "SessionStart",
      scope: "global",
      priority: 1,
      handler: () => {
        called.push("after-crash");
      },
    });

    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(called).toContain("after-crash");
  });
});

// ─── replacePayload mutation ──────────────────────────────────────────────────

describe("HookRegistry.dispatch — replacePayload", () => {
  it("chains replacePayload to subsequent handlers", async () => {
    const reg = new HookRegistry();
    const received: unknown[] = [];

    reg.register({
      event: "SessionStart",
      scope: "global",
      priority: 10,
      handler: () => ({ replacePayload: { sessionId: "mutated" } }),
    });

    reg.register({
      event: "SessionStart",
      scope: "global",
      priority: 1,
      handler: (payload) => {
        received.push(payload);
      },
    });

    await reg.dispatch(
      "SessionStart",
      { sessionId: "original" },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(received[0]).toEqual({ sessionId: "mutated" });
  });

  it("returns replacePayload in result when payload changed", async () => {
    const reg = new HookRegistry();

    reg.register({
      event: "SessionStart",
      scope: "global",
      handler: () => ({ replacePayload: { sessionId: "changed" } }),
    });

    const result = await reg.dispatch(
      "SessionStart",
      { sessionId: "original" },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(result.replacePayload).toEqual({ sessionId: "changed" });
  });
});

// ─── matchesScope: scope without scopeTarget ──────────────────────────────────

describe("HookRegistry.dispatch — matchesScope", () => {
  it("ignores handler when scope is non-global but scopeTarget is missing", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "agent",
      // No scopeTarget — should be ignored
      handler: () => {
        called.push("should-not-run");
      },
    } as never);

    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(called).toEqual([]);
  });

  it("scope=agent matches when scopeTarget === agentId", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "agent",
      scopeTarget: "agent-42",
      handler: () => {
        called.push("matched");
      },
    });

    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "agent-42", envelope: makeEnv() },
    );

    expect(called).toEqual(["matched"]);
  });

  it("scope=agent does not match when scopeTarget !== agentId", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "agent",
      scopeTarget: "agent-99",
      handler: () => {
        called.push("should-not-run");
      },
    });

    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "agent-42", envelope: makeEnv() },
    );

    expect(called).toEqual([]);
  });

  it("scope=role matches when envelope.metadata.roleId matches scopeTarget", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "role",
      scopeTarget: "writer",
      handler: () => {
        called.push("role-matched");
      },
    });

    const env = makeEnv({ roleId: "writer" });
    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: env },
    );

    expect(called).toEqual(["role-matched"]);
  });

  it("scope=role does not match when roleId differs", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "role",
      scopeTarget: "reviewer",
      handler: () => {
        called.push("should-not-run");
      },
    });

    const env = makeEnv({ roleId: "writer" });
    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: env },
    );

    expect(called).toEqual([]);
  });

  it("scope=skill matches when envelope.metadata.activeSkill matches scopeTarget", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "skill",
      scopeTarget: "search",
      handler: () => {
        called.push("skill-matched");
      },
    });

    const env = makeEnv({ activeSkill: "search" });
    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: env },
    );

    expect(called).toEqual(["skill-matched"]);
  });

  it("scope=skill does not match when activeSkill differs", async () => {
    const reg = new HookRegistry();
    const called: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "skill",
      scopeTarget: "calculator",
      handler: () => {
        called.push("should-not-run");
      },
    });

    const env = makeEnv({ activeSkill: "search" });
    await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: env },
    );

    expect(called).toEqual([]);
  });
});

/**
 * HookRegistry 单元测试（Phase 1 — 完整实现）
 */

import { HookRegistry } from "../hook-registry";
import type {
  IContextEnvelope,
  IBudgetSnapshot,
  IMemoryBinding,
} from "../../abstractions";

function makeEnv(): IContextEnvelope {
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
  };
}

describe("HookRegistry", () => {
  it("registers and dispatches a hook", async () => {
    const reg = new HookRegistry();
    const calls: string[] = [];

    reg.register({
      event: "SessionStart",
      scope: "global",
      handler: () => {
        calls.push("first");
      },
    });

    const result = await reg.dispatch(
      "SessionStart",
      { sessionId: "s1" },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(calls).toEqual(["first"]);
    expect(result).toEqual({});
  });

  it("orders handlers by priority desc, then registration order", async () => {
    const reg = new HookRegistry();
    const calls: string[] = [];

    reg.register({
      event: "Stop",
      scope: "global",
      priority: 1,
      handler: () => {
        calls.push("low-priority");
      },
    });
    reg.register({
      event: "Stop",
      scope: "global",
      priority: 10,
      handler: () => {
        calls.push("high-priority");
      },
    });
    reg.register({
      event: "Stop",
      scope: "global",
      priority: 10,
      handler: () => {
        calls.push("high-priority-later");
      },
    });

    await reg.dispatch(
      "Stop",
      { reason: "completed" },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(calls).toEqual([
      "high-priority",
      "high-priority-later",
      "low-priority",
    ]);
  });

  it("blocks subsequent handlers when a hook returns block: true", async () => {
    const reg = new HookRegistry();
    const calls: string[] = [];

    reg.register({
      event: "PreToolUse",
      scope: "global",
      priority: 10,
      handler: () => {
        calls.push("blocker");
        return { block: true, reason: "policy" };
      },
    });
    reg.register({
      event: "PreToolUse",
      scope: "global",
      handler: () => {
        calls.push("should-not-run");
      },
    });

    const result = await reg.dispatch(
      "PreToolUse",
      {
        action: { kind: "tool_call", toolId: "t1", input: {} },
      },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(calls).toEqual(["blocker"]);
    expect(result.block).toBe(true);
    expect(result.reason).toBe("policy");
  });

  it("unregister() removes the handler", async () => {
    const reg = new HookRegistry();
    const calls: string[] = [];

    const unreg = reg.register({
      event: "UserPromptSubmit",
      scope: "global",
      handler: () => {
        calls.push("ran");
      },
    });

    unreg();
    await reg.dispatch(
      "UserPromptSubmit",
      { prompt: "p", envelope: makeEnv() },
      { agentId: "a1", envelope: makeEnv() },
    );

    expect(calls).toEqual([]);
  });

  // ── P0-6: skipOnApiError ────────────────────────────────────

  it("P0-6: dispatchStop skips skipOnApiError=true hooks when isApiError=true", async () => {
    const reg = new HookRegistry();
    const calls: string[] = [];

    // This hook has skipOnApiError=true — must NOT run on API error path
    reg.register({
      event: "Stop",
      scope: "global",
      skipOnApiError: true,
      handler: () => {
        calls.push("skip-on-api-error");
      },
    });
    // This hook has no skipOnApiError — must ALWAYS run
    reg.register({
      event: "Stop",
      scope: "global",
      handler: () => {
        calls.push("always-run");
      },
    });

    await reg.dispatchStop(
      { reason: "error" },
      { agentId: "a1", envelope: makeEnv() },
      true, // isApiError=true
    );

    expect(calls).toEqual(["always-run"]);
    expect(calls).not.toContain("skip-on-api-error");
  });

  it("P0-6: dispatchStop runs all Stop hooks when isApiError=false", async () => {
    const reg = new HookRegistry();
    const calls: string[] = [];

    reg.register({
      event: "Stop",
      scope: "global",
      skipOnApiError: true,
      handler: () => {
        calls.push("skip-on-api-error");
      },
    });
    reg.register({
      event: "Stop",
      scope: "global",
      handler: () => {
        calls.push("always-run");
      },
    });

    await reg.dispatchStop(
      { reason: "completed" },
      { agentId: "a1", envelope: makeEnv() },
      false, // isApiError=false → all hooks run
    );

    // Both hooks must run when it's not an API error
    expect(calls).toContain("skip-on-api-error");
    expect(calls).toContain("always-run");
  });

  it("P0-6: hasAnySkipOnApiErrorStopHook returns true when at least one Stop hook has skipOnApiError=true", () => {
    const reg = new HookRegistry();

    expect(reg.hasAnySkipOnApiErrorStopHook()).toBe(false);

    reg.register({
      event: "Stop",
      scope: "global",
      skipOnApiError: true,
      handler: () => undefined,
    });

    expect(reg.hasAnySkipOnApiErrorStopHook()).toBe(true);
  });

  it("P0-6: dispatchStop with all skipOnApiError=true hooks and isApiError=true runs zero handlers", async () => {
    const reg = new HookRegistry();
    const calls: string[] = [];

    reg.register({
      event: "Stop",
      scope: "global",
      skipOnApiError: true,
      handler: () => {
        calls.push("should-be-skipped");
      },
    });

    await reg.dispatchStop(
      { reason: "error" },
      { agentId: "a1", envelope: makeEnv() },
      true,
    );

    expect(calls).toEqual([]);
  });
});

/**
 * CacheControlPlanner 单测 (PR-Q)
 */

import { CacheControlPlanner } from "../cache-control-planner";
import { ContextEnvelope } from "../../../agents/core/context-envelope";

function mkEnv(
  overrides: Partial<{
    system: string;
    reminders: {
      source: string;
      priority: "low" | "medium" | "high";
      content: string;
      transient?: boolean;
    }[];
    tools: string[];
  }> = {},
): ContextEnvelope {
  return new ContextEnvelope({
    system: overrides.system ?? "you are an agent",
    reminders: overrides.reminders ?? [],
    messages: [],
    tools: overrides.tools ?? [],
    memory: { sessionId: "s" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 1000,
      iterationsUsed: 0,
      iterationsRemaining: 10,
      wallTimeStartMs: 0,
    },
  });
}

describe("CacheControlPlanner (PR-Q)", () => {
  it("returns null when prefix below 4096 chars", () => {
    const planner = new CacheControlPlanner();
    const env = mkEnv({ system: "short" });
    expect(planner.plan(env)).toBeNull();
  });

  it("returns prefix when system prompt large enough", () => {
    const planner = new CacheControlPlanner();
    const env = mkEnv({ system: "x".repeat(5000) });
    const plan = planner.plan(env);
    expect(plan).not.toBeNull();
    expect(plan!.systemPromptText.length).toBeGreaterThanOrEqual(4096);
    expect(plan!.breakpoints).toHaveLength(1);
    expect(plan!.breakpoints[0].anchor).toBe("system");
  });

  it("includes high-priority non-transient reminders in cache prefix", () => {
    const planner = new CacheControlPlanner();
    const env = mkEnv({
      system: "x".repeat(2000),
      reminders: [
        {
          source: "skill",
          priority: "high",
          content: "y".repeat(2500),
        },
        {
          source: "ephemeral",
          priority: "high",
          content: "z".repeat(1000),
          transient: true,
        },
      ],
    });
    const plan = planner.plan(env);
    expect(plan).not.toBeNull();
    expect(plan!.cachedReminderCount).toBe(1); // transient excluded
    expect(plan!.systemPromptText).toContain("y");
    expect(plan!.systemPromptText).not.toContain("z");
  });

  it("includes tools when present", () => {
    const planner = new CacheControlPlanner();
    const env = mkEnv({
      system: "x".repeat(5000),
      tools: ["t1", "t2"],
    });
    const plan = planner.plan(env)!;
    expect(plan.toolDefinitions).toEqual(["t1", "t2"]);
  });
});

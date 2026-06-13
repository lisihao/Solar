/**
 * PriorityPruner 单元测试
 */

import { PriorityPruner } from "../priority-pruner";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import type { ISystemReminder } from "../../../agents/abstractions";

function makeEnv(reminders: ISystemReminder[]): ContextEnvelope {
  return new ContextEnvelope({
    system: "sys",
    messages: [],
    reminders,
    tools: [],
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

function r(
  content: string,
  priority: ISystemReminder["priority"] = "medium",
  transient = false,
): ISystemReminder {
  return { source: "test", priority, content, transient };
}

describe("PriorityPruner", () => {
  it("returns envelope unchanged when under limit", () => {
    const pruner = new PriorityPruner({ maxReminders: 10 });
    const env = makeEnv([r("a"), r("b"), r("c")]);
    expect(pruner.prune(env)).toBe(env);
  });

  it("keeps last N and high-priority items when over limit", () => {
    const pruner = new PriorityPruner({ maxReminders: 5, keepLastN: 2 });
    const env = makeEnv([
      r("low-1", "low"),
      r("low-2", "low"),
      r("high-1", "high"),
      r("low-3", "low"),
      r("low-4", "low"),
      r("medium-1", "medium"),
      r("tail-1", "low"), // tail
      r("tail-2", "low"), // tail
    ]);
    const pruned = pruner.prune(env);
    const contents = pruned.reminders.map((x) => x.content);

    expect(pruned.reminders).toHaveLength(5);
    // Tail always preserved
    expect(contents).toContain("tail-1");
    expect(contents).toContain("tail-2");
    // High-priority preserved
    expect(contents).toContain("high-1");
    // Medium preserved over low
    expect(contents).toContain("medium-1");
  });

  it("deprioritizes transient reminders", () => {
    const pruner = new PriorityPruner({ maxReminders: 3, keepLastN: 1 });
    const env = makeEnv([
      r("keeper-non-transient", "medium", false),
      r("transient-1", "medium", true),
      r("transient-2", "medium", true),
      r("tail", "low"), // tail (kept by keepLastN)
    ]);
    const pruned = pruner.prune(env);
    const contents = pruned.reminders.map((x) => x.content);

    expect(pruned.reminders).toHaveLength(3);
    expect(contents).toContain("keeper-non-transient");
    expect(contents).toContain("tail");
    // At least one transient should be dropped
    const transientCount = pruned.reminders.filter((x) => x.transient).length;
    expect(transientCount).toBeLessThan(2);
  });

  it("preserves insertion order among kept head items", () => {
    const pruner = new PriorityPruner({ maxReminders: 4, keepLastN: 1 });
    const env = makeEnv([
      r("a", "high"),
      r("b", "high"),
      r("c", "high"),
      r("d", "low"),
      r("tail", "low"),
    ]);
    const pruned = pruner.prune(env);
    // After pruning, 'd' might drop, and 'a','b','c' preserved in order
    const keptHead = pruned.reminders.slice(0, -1).map((x) => x.content);
    const indices = keptHead.map((c) => ["a", "b", "c", "d"].indexOf(c));
    const sorted = [...indices].sort((x, y) => x - y);
    expect(indices).toEqual(sorted);
  });
});

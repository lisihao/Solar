/**
 * ContextManager 集成测试
 */

import { ContextManager } from "../context-manager";
import { ContextCompactor } from "../context-compactor";
import { PriorityPruner } from "../priority-pruner";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import type {
  IContextMessage,
  ISystemReminder,
} from "../../../agents/abstractions";

function makeEnv(opts: {
  messages?: number;
  reminders?: number;
}): ContextEnvelope {
  const msgs: IContextMessage[] = [];
  for (let i = 0; i < (opts.messages ?? 0); i += 1) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i} ` + "y".repeat(600),
      timestamp: i,
    });
  }
  const rems: ISystemReminder[] = [];
  for (let i = 0; i < (opts.reminders ?? 0); i += 1) {
    rems.push({
      source: `r${i}`,
      priority: i % 3 === 0 ? "low" : "medium",
      content: `reminder ${i}`,
    });
  }
  return new ContextEnvelope({
    system: "sys",
    messages: msgs,
    reminders: rems,
    tools: [],
    memory: { sessionId: "s" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 100_000,
      iterationsUsed: 0,
      iterationsRemaining: 20,
      wallTimeStartMs: 0,
    },
  });
}

describe("ContextManager", () => {
  it("no-op when neither compactor nor pruner provided", async () => {
    const mgr = new ContextManager();
    const env = makeEnv({ messages: 20, reminders: 20 });
    const result = await mgr.ensureBudget(env);
    expect(result.envelope).toBe(env);
    expect(result.compacted).toBe(false);
    expect(result.pruned).toBe(false);
  });

  it("invokes compactor when provided", async () => {
    const chat = {
      chat: jest.fn(async () => ({
        content: "summary",
        model: "mock",
        usage: { totalTokens: 10 },
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compactor = new ContextCompactor(chat as any, {
      triggerTokens: 100,
      keepRecent: 2,
    });
    const mgr = new ContextManager(compactor);
    const env = makeEnv({ messages: 10 });
    const result = await mgr.ensureBudget(env);
    expect(result.compacted).toBe(true);
    expect(result.envelope.messages.length).toBeLessThan(env.messages.length);
  });

  it("invokes pruner when provided", async () => {
    const pruner = new PriorityPruner({ maxReminders: 5, keepLastN: 2 });
    const mgr = new ContextManager(undefined, pruner);
    const env = makeEnv({ reminders: 20 });
    const result = await mgr.ensureBudget(env);
    expect(result.pruned).toBe(true);
    expect(result.envelope.reminders).toHaveLength(5);
  });

  it("combines both operations", async () => {
    const chat = {
      chat: jest.fn(async () => ({
        content: "summary",
        model: "mock",
        usage: { totalTokens: 10 },
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compactor = new ContextCompactor(chat as any, {
      triggerTokens: 100,
      keepRecent: 2,
    });
    const pruner = new PriorityPruner({ maxReminders: 5, keepLastN: 2 });
    const mgr = new ContextManager(compactor, pruner);
    const env = makeEnv({ messages: 10, reminders: 20 });
    const result = await mgr.ensureBudget(env);
    expect(result.compacted).toBe(true);
    expect(result.pruned).toBe(true);
    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
  });
});

/**
 * MemoryContextBindingService 单元测试（Phase 2）
 */

import { MemoryContextBindingService } from "../indexing/memory-context-binding.service";
import { ContextEnvelope } from "../../agents/core/context-envelope";

function makeEnvelope(userId?: string): ContextEnvelope {
  return new ContextEnvelope({
    system: "sys",
    messages: [],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1", userId },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 1000,
      iterationsUsed: 0,
      iterationsRemaining: 10,
      wallTimeStartMs: Date.now(),
    },
  });
}

describe("MemoryContextBindingService", () => {
  it("preExecute returns envelope unchanged when coordinator is not present", async () => {
    const bridge = new MemoryContextBindingService();
    const env = makeEnvelope("u1");
    const result = await bridge.preExecute(env, { query: "hello" });
    expect(result).toBe(env);
  });

  it("preExecute returns envelope unchanged when userId is missing", async () => {
    const coordinator = {
      recall: jest.fn(),
      store: jest.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = new MemoryContextBindingService(coordinator as any);
    const env = makeEnvelope(undefined);
    const result = await bridge.preExecute(env, { query: "hello" });
    expect(result).toBe(env);
    expect(coordinator.recall).not.toHaveBeenCalled();
  });

  it("preExecute injects recalled fragments as a reminder", async () => {
    const coordinator = {
      recall: jest.fn(async () => ({
        fragments: [
          {
            layer: 3 as const,
            key: "pref.lang",
            value: "English",
            relevanceScore: 0.9,
            type: "preference",
          },
          {
            layer: 1 as const,
            key: "last-topic",
            value: "AI agents",
            relevanceScore: 0.7,
            type: "conversation",
          },
        ],
        layerHits: { 1: 1, 2: 0, 3: 1, 4: 0 },
      })),
      store: jest.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = new MemoryContextBindingService(coordinator as any);
    const env = makeEnvelope("u1");
    const result = await bridge.preExecute(env, { query: "my topic" });
    expect(result).not.toBe(env);
    expect(result.reminders).toHaveLength(1);
    expect(result.reminders[0].source).toBe("memory-context-binding");
    expect(result.reminders[0].content).toContain("pref.lang");
    expect(result.reminders[0].content).toContain("last-topic");
  });

  it("postExecute calls coordinator.store", async () => {
    const coordinator = {
      recall: jest.fn(),
      store: jest.fn(async () => undefined),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = new MemoryContextBindingService(coordinator as any);
    await bridge.postExecute(
      { sessionId: "s1", userId: "u1" },
      { type: "summary", key: "session-1-summary", value: "we did X" },
    );
    expect(coordinator.store).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "summary",
        key: "session-1-summary",
        value: "we did X",
      }),
      "u1",
      "s1",
    );
  });

  it("postExecute swallows errors silently", async () => {
    const coordinator = {
      recall: jest.fn(),
      store: jest.fn(async () => {
        throw new Error("db down");
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = new MemoryContextBindingService(coordinator as any);
    await expect(
      bridge.postExecute(
        { sessionId: "s1", userId: "u1" },
        { type: "summary", key: "k", value: "v" },
      ),
    ).resolves.toBeUndefined();
  });
});

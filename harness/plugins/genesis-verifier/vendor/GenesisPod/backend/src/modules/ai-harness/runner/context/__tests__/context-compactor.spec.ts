/**
 * ContextCompactor 单元测试
 */

import { ContextCompactor } from "../context-compactor";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import type { IContextMessage } from "../../../agents/abstractions";

function makeLongEnv(
  messageCount: number,
  contentSize = 1000,
): ContextEnvelope {
  const messages: IContextMessage[] = [];
  for (let i = 0; i < messageCount; i += 1) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}: ${"x".repeat(contentSize)}`,
      timestamp: i,
    });
  }
  return new ContextEnvelope({
    system: "sys",
    messages,
    reminders: [],
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

describe("ContextCompactor", () => {
  it("does nothing when under trigger threshold", async () => {
    const chat = { chat: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compactor = new ContextCompactor(chat as any, {
      triggerTokens: 100_000,
    });
    const env = makeLongEnv(4, 100);
    const result = await compactor.compact(env);
    expect(result.compacted).toBe(false);
    expect(result.envelope).toBe(env);
    expect(chat.chat).not.toHaveBeenCalled();
  });

  it("skips compaction when chatService is not provided", async () => {
    const compactor = new ContextCompactor(undefined, {
      triggerTokens: 10,
      keepRecent: 2,
    });
    const env = makeLongEnv(10, 100);
    const result = await compactor.compact(env);
    expect(result.compacted).toBe(false);
  });

  it("compacts old messages and keeps recent N", async () => {
    const chat = {
      chat: jest.fn(async () => ({
        content: "This is the summary of the old conversation.",
        model: "mock",
        usage: { totalTokens: 50 },
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compactor = new ContextCompactor(chat as any, {
      triggerTokens: 100,
      keepRecent: 3,
      summaryMaxChars: 500,
    });
    const env = makeLongEnv(10, 500);
    const result = await compactor.compact(env);

    expect(result.compacted).toBe(true);
    expect(result.removedMessageCount).toBe(7); // 10 - 3 recent
    expect(result.envelope.messages).toHaveLength(4); // 1 summary + 3 recent
    expect(result.envelope.messages[0].role).toBe("system");
    expect(result.envelope.messages[0].content).toContain(
      "context-summary replacing 7 earlier messages",
    );
    // Recent messages preserved in order
    expect(result.envelope.messages[1].content).toContain("message 7");
    expect(result.envelope.messages[2].content).toContain("message 8");
    expect(result.envelope.messages[3].content).toContain("message 9");
  });

  it("preserves original envelope on summarization error", async () => {
    const chat = {
      chat: jest.fn(async () => {
        throw new Error("LLM down");
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compactor = new ContextCompactor(chat as any, {
      triggerTokens: 100,
      keepRecent: 3,
    });
    const env = makeLongEnv(10, 500);
    const result = await compactor.compact(env);
    expect(result.compacted).toBe(false);
    expect(result.envelope).toBe(env);
  });

  it("increments compactedCount in metadata on each compaction", async () => {
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
    const env = makeLongEnv(8, 500);
    const first = await compactor.compact(env);
    expect(first.envelope.metadata?.compactedCount).toBe(1);
  });
});

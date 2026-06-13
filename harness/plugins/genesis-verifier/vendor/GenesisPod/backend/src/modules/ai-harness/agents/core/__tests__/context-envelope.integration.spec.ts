/**
 * ContextEnvelope — extra branch coverage
 *
 * Covers:
 * - withReminder: appends reminder with defaults and custom priority/source
 * - fork: creates new envelope with same content but new id
 */

import { ContextEnvelope } from "../context-envelope";
import type { IBudgetSnapshot, IMemoryBinding } from "../../abstractions";

function makeBudget(): IBudgetSnapshot {
  return {
    tokensUsed: 0,
    tokensRemaining: 5000,
    iterationsUsed: 0,
    iterationsRemaining: 10,
    wallTimeStartMs: Date.now(),
  };
}

function makeMemory(): IMemoryBinding {
  return { sessionId: "session-1" };
}

function makeEnvelope(): ContextEnvelope {
  return new ContextEnvelope({
    system: "system prompt",
    messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
    reminders: [],
    tools: ["tool-1"],
    memory: makeMemory(),
    budget: makeBudget(),
  });
}

// ─── withReminder ─────────────────────────────────────────────────────────────

describe("ContextEnvelope.withReminder", () => {
  it("adds a reminder with default priority (medium) and source (harness)", () => {
    const env = makeEnvelope();
    const mutation = env.withReminder("remember this");

    const newEnv = mutation.envelope as ContextEnvelope;
    expect(newEnv.reminders).toHaveLength(1);
    expect(newEnv.reminders[0].content).toBe("remember this");
    expect(newEnv.reminders[0].priority).toBe("medium");
    expect(newEnv.reminders[0].source).toBe("harness");
    expect(mutation.diff.addedReminders).toBe(1);
  });

  it("adds a reminder with explicit priority and source", () => {
    const env = makeEnvelope();
    const mutation = env.withReminder("urgent reminder", "high", "supervisor");

    const newEnv = mutation.envelope as ContextEnvelope;
    expect(newEnv.reminders[0].priority).toBe("high");
    expect(newEnv.reminders[0].source).toBe("supervisor");
  });

  it("preserves existing messages and tools in the new envelope", () => {
    const env = makeEnvelope();
    const mutation = env.withReminder("reminder");

    const newEnv = mutation.envelope as ContextEnvelope;
    expect(newEnv.messages).toHaveLength(1);
    expect(newEnv.tools).toEqual(["tool-1"]);
    expect(newEnv.system).toBe("system prompt");
  });

  it("preserves envelope id across withReminder", () => {
    const env = makeEnvelope();
    const mutation = env.withReminder("reminder");
    // withReminder passes id to new envelope constructor → same id preserved
    expect((mutation.envelope as ContextEnvelope).id).toBe(env.id);
  });
});

// ─── fork ─────────────────────────────────────────────────────────────────────

describe("ContextEnvelope.fork", () => {
  it("creates a new envelope with new id but same content", () => {
    const env = makeEnvelope();
    const forked = env.fork() as ContextEnvelope;

    // New id
    expect(forked.id).not.toBe(env.id);

    // Same content
    expect(forked.system).toBe(env.system);
    expect(forked.messages).toHaveLength(env.messages.length);
    expect(forked.tools).toEqual(env.tools);
  });

  it("forked envelope messages are independent copies", () => {
    const env = makeEnvelope();
    const forked = env.fork() as ContextEnvelope;

    // Deep copy — they share values but arrays are separate
    expect(forked.messages).not.toBe(env.messages);
    expect(forked.messages[0]).toBe(env.messages[0]); // same object ref (shallow)
  });

  it("forked envelope memory is a shallow copy", () => {
    const env = makeEnvelope();
    const forked = env.fork() as ContextEnvelope;

    expect(forked.memory).not.toBe(env.memory);
    expect(forked.memory.sessionId).toBe(env.memory.sessionId);
  });
});

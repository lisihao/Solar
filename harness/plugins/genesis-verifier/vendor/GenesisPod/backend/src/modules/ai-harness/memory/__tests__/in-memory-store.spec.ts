/**
 * InMemoryStore / ConversationMemory / WorkingMemory structural tests
 *
 * Goals:
 *   1. Classes instantiate without throwing.
 *   2. IMemoryStore contract is structurally sound (all interface methods present and callable).
 *   3. IConversationMemory contract is sound.
 *   4. IWorkingMemory contract is sound.
 *   5. Core logic is correct so silent regressions are caught.
 */

import {
  InMemoryStore,
  ConversationMemory,
  WorkingMemory,
} from "../stores/in-memory-store";
import type {
  IMemoryStore,
  IConversationMemory,
  IWorkingMemory,
} from "../abstractions/memory.interface";

// uuid is used by InMemoryStore to generate entry ids — we do not mock it
// so that multiple entries get distinct ids in each test.

// ---------------------------------------------------------------------------
// InMemoryStore
// ---------------------------------------------------------------------------

describe("InMemoryStore", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new InMemoryStore("test-store");
  });

  it("instantiates without throwing and exposes an id", () => {
    expect(store).toBeInstanceOf(InMemoryStore);
    expect(store.id).toBe("test-store");
  });

  it("satisfies IMemoryStore structural contract", () => {
    const typed: IMemoryStore = store;
    expect(typeof typed.add).toBe("function");
    expect(typeof typed.addBatch).toBe("function");
    expect(typeof typed.get).toBe("function");
    expect(typeof typed.update).toBe("function");
    expect(typeof typed.delete).toBe("function");
    expect(typeof typed.search).toBe("function");
    expect(typeof typed.getRecent).toBe("function");
    expect(typeof typed.cleanup).toBe("function");
    expect(typeof typed.clear).toBe("function");
    expect(typeof typed.count).toBe("function");
  });

  it("add() returns a MemoryEntry with id and timestamp", async () => {
    const entry = await store.add({ type: "fact", content: "hello" });
    expect(entry.id).toBeDefined();
    expect(entry.content).toBe("hello");
    expect(entry.type).toBe("fact");
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it("get() returns the stored entry by id", async () => {
    const added = await store.add({ type: "fact", content: "world" });
    const fetched = await store.get(added.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.content).toBe("world");
  });

  it("get() returns null for unknown id", async () => {
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });

  it("update() merges updates into the existing entry", async () => {
    const added = await store.add({ type: "fact", content: "old" });
    const updated = await store.update(added.id, { content: "new" });
    expect(updated?.content).toBe("new");
    expect(updated?.type).toBe("fact");
  });

  it("update() returns null for unknown id", async () => {
    const result = await store.update("nonexistent", { content: "x" });
    expect(result).toBeNull();
  });

  it("delete() removes the entry and returns true", async () => {
    const added = await store.add({ type: "fact", content: "bye" });
    const deleted = await store.delete(added.id);
    expect(deleted).toBe(true);
    expect(await store.get(added.id)).toBeNull();
  });

  it("delete() returns false for unknown id", async () => {
    const result = await store.delete("nonexistent");
    expect(result).toBe(false);
  });

  it("count() returns total entries without filter", async () => {
    const s = new InMemoryStore();
    await s.add({ type: "fact", content: "a" });
    await s.add({ type: "episode", content: "b" });
    expect(await s.count()).toBe(2);
  });

  it("count() filters by type", async () => {
    const s = new InMemoryStore();
    await s.add({ type: "fact", content: "a" });
    await s.add({ type: "episode", content: "b" });
    expect(await s.count(["fact"])).toBe(1);
  });

  it("clear() empties the store", async () => {
    const s = new InMemoryStore();
    await s.add({ type: "fact", content: "a" });
    await s.clear();
    expect(await s.count()).toBe(0);
  });

  it("addBatch() stores all entries and returns them", async () => {
    const s = new InMemoryStore();
    const results = await s.addBatch([
      { type: "fact", content: "x" },
      { type: "fact", content: "y" },
    ]);
    expect(results).toHaveLength(2);
    expect(await s.count()).toBe(2);
  });

  it("search() filters by type", async () => {
    const s = new InMemoryStore();
    await s.add({ type: "fact", content: "apple" });
    await s.add({ type: "episode", content: "banana" });
    const results = await s.search({ types: ["fact"] });
    expect(results).toHaveLength(1);
    expect(results[0].entry.content).toBe("apple");
  });

  it("search() filters by query string", async () => {
    const s = new InMemoryStore();
    await s.add({ type: "fact", content: "apple pie" });
    await s.add({ type: "fact", content: "banana split" });
    const results = await s.search({ query: "apple" });
    expect(results).toHaveLength(1);
    expect(results[0].entry.content).toBe("apple pie");
  });

  it("search() respects limit", async () => {
    const s = new InMemoryStore();
    await s.add({ type: "fact", content: "a" });
    await s.add({ type: "fact", content: "b" });
    await s.add({ type: "fact", content: "c" });
    const results = await s.search({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("getRecent() returns most recent entries up to limit", async () => {
    const s = new InMemoryStore();
    await s.add({ type: "fact", content: "first" });
    await s.add({ type: "fact", content: "second" });
    const recent = await s.getRecent(1);
    expect(recent).toHaveLength(1);
  });

  it("cleanup() removes expired entries and returns count", async () => {
    const s = new InMemoryStore();
    const past = new Date(Date.now() - 1000);
    await s.add({ type: "fact", content: "expired", expiresAt: past });
    await s.add({ type: "fact", content: "valid" });
    const removed = await s.cleanup();
    expect(removed).toBe(1);
    expect(await s.count()).toBe(1);
  });

  it("search() with embedding uses cosine similarity", async () => {
    const s = new InMemoryStore();
    await s.add({
      type: "fact",
      content: "vec-a",
      embedding: [1, 0],
    });
    await s.add({
      type: "fact",
      content: "vec-b",
      embedding: [0, 1],
    });
    // query embedding [1,0] should score vec-a higher
    const results = await s.search({ embedding: [1, 0] });
    expect(results[0].entry.content).toBe("vec-a");
    expect(results[0].score).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// ConversationMemory
// ---------------------------------------------------------------------------

describe("ConversationMemory", () => {
  let conv: ConversationMemory;

  beforeEach(() => {
    jest.clearAllMocks();
    conv = new ConversationMemory("session-1");
  });

  it("instantiates without throwing and exposes sessionId", () => {
    expect(conv).toBeInstanceOf(ConversationMemory);
    expect(conv.sessionId).toBe("session-1");
  });

  it("satisfies IConversationMemory structural contract", () => {
    const typed: IConversationMemory = conv;
    expect(typeof typed.addMessage).toBe("function");
    expect(typeof typed.getMessages).toBe("function");
    expect(typeof typed.getContextWindow).toBe("function");
    expect(typeof typed.summarize).toBe("function");
    expect(typeof typed.clear).toBe("function");
  });

  it("addMessage() stores messages and getMessages() retrieves them", async () => {
    await conv.addMessage({ role: "user", content: "hello" });
    await conv.addMessage({ role: "assistant", content: "hi" });
    const msgs = await conv.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  it("getMessages() respects limit (returns last N)", async () => {
    await conv.addMessage({ role: "user", content: "msg-1" });
    await conv.addMessage({ role: "user", content: "msg-2" });
    await conv.addMessage({ role: "user", content: "msg-3" });
    const msgs = await conv.getMessages(2);
    expect(msgs).toHaveLength(2);
    expect(msgs[msgs.length - 1].content).toBe("msg-3");
  });

  it("getContextWindow() returns messages within token budget", async () => {
    await conv.addMessage({ role: "user", content: "hi" });
    await conv.addMessage({ role: "assistant", content: "hello" });
    // A generous budget should include both messages
    const window = await conv.getContextWindow(1000);
    expect(window.length).toBeGreaterThanOrEqual(1);
  });

  it("summarize() returns a non-empty string", async () => {
    await conv.addMessage({ role: "user", content: "query" });
    const summary = await conv.summarize();
    expect(typeof summary).toBe("string");
    expect(summary.length).toBeGreaterThan(0);
  });

  it("clear() removes all messages", async () => {
    await conv.addMessage({ role: "user", content: "to be cleared" });
    await conv.clear();
    const msgs = await conv.getMessages();
    expect(msgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// WorkingMemory
// ---------------------------------------------------------------------------

describe("WorkingMemory", () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory();
  });

  it("instantiates without throwing", () => {
    expect(wm).toBeInstanceOf(WorkingMemory);
  });

  it("satisfies IWorkingMemory structural contract", () => {
    const typed: IWorkingMemory = wm;
    expect(typeof typed.set).toBe("function");
    expect(typeof typed.get).toBe("function");
    expect(typeof typed.has).toBe("function");
    expect(typeof typed.delete).toBe("function");
    expect(typeof typed.clear).toBe("function");
    expect(typeof typed.keys).toBe("function");
    expect(typeof typed.toObject).toBe("function");
  });

  it("set() and get() store and retrieve values", () => {
    wm.set("key1", 42);
    expect(wm.get<number>("key1")).toBe(42);
  });

  it("has() returns true for existing keys and false for missing ones", () => {
    wm.set("present", "yes");
    expect(wm.has("present")).toBe(true);
    expect(wm.has("absent")).toBe(false);
  });

  it("delete() removes a key and returns true", () => {
    wm.set("del", "x");
    expect(wm.delete("del")).toBe(true);
    expect(wm.has("del")).toBe(false);
  });

  it("delete() returns false for non-existent key", () => {
    expect(wm.delete("never-set")).toBe(false);
  });

  it("keys() returns all stored keys", () => {
    wm.set("a", 1);
    wm.set("b", 2);
    expect(wm.keys().sort()).toEqual(["a", "b"]);
  });

  it("toObject() returns a plain object representation", () => {
    wm.set("x", 10);
    wm.set("y", "hello");
    const obj = wm.toObject();
    expect(obj).toEqual({ x: 10, y: "hello" });
  });

  it("clear() removes all keys", () => {
    wm.set("a", 1);
    wm.set("b", 2);
    wm.clear();
    expect(wm.keys()).toHaveLength(0);
  });

  it("get() returns undefined for missing key", () => {
    expect(wm.get("missing")).toBeUndefined();
  });
});

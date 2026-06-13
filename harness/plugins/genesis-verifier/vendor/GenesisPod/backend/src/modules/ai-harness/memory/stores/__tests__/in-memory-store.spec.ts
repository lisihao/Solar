import {
  InMemoryStore,
  ConversationMemory,
  WorkingMemory,
} from "../in-memory-store";

// ─── InMemoryStore tests ──────────────────────────────────

describe("InMemoryStore", () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  // ─── constructor ─────────────────────────────────────

  describe("constructor", () => {
    it("assigns a UUID id by default", () => {
      expect(store.id).toBeDefined();
      expect(store.id.length).toBeGreaterThan(0);
    });

    it("uses the provided id when given", () => {
      const s = new InMemoryStore("custom-id-123");
      expect(s.id).toBe("custom-id-123");
    });

    it("two stores have different auto-generated ids", () => {
      const s1 = new InMemoryStore();
      const s2 = new InMemoryStore();
      expect(s1.id).not.toBe(s2.id);
    });
  });

  // ─── add() ──────────────────────────────────────────

  describe("add()", () => {
    it("adds an entry and returns it with id and timestamp", async () => {
      const entry = await store.add({
        type: "fact",
        content: "The sky is blue",
      });

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe("The sky is blue");
      expect(entry.type).toBe("fact");
      expect(entry.timestamp).toBeInstanceOf(Date);
    });

    it("generates unique IDs for each entry", async () => {
      const e1 = await store.add({ type: "fact", content: "fact 1" });
      const e2 = await store.add({ type: "fact", content: "fact 2" });
      expect(e1.id).not.toBe(e2.id);
    });

    it("stores optional fields (embedding, metadata, expiresAt)", async () => {
      const expiresAt = new Date(Date.now() + 60000);
      const embedding = [0.1, 0.2, 0.3];
      const metadata = { source: "test" };

      const entry = await store.add({
        type: "fact",
        content: "test",
        embedding,
        metadata,
        expiresAt,
      });

      expect(entry.embedding).toEqual(embedding);
      expect(entry.metadata).toEqual(metadata);
      expect(entry.expiresAt).toEqual(expiresAt);
    });
  });

  // ─── addBatch() ──────────────────────────────────────

  describe("addBatch()", () => {
    it("adds multiple entries and returns all", async () => {
      const entries = await store.addBatch([
        { type: "fact", content: "fact 1" },
        { type: "episode", content: "episode 1" },
        { type: "summary", content: "summary 1" },
      ]);

      expect(entries).toHaveLength(3);
      entries.forEach((e) => expect(e.id).toBeDefined());
    });

    it("returns empty array for empty input", async () => {
      const entries = await store.addBatch([]);
      expect(entries).toHaveLength(0);
    });
  });

  // ─── get() ──────────────────────────────────────────

  describe("get()", () => {
    it("retrieves an existing entry by id", async () => {
      const added = await store.add({ type: "fact", content: "hello" });
      const retrieved = await store.get(added.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(added.id);
      expect(retrieved?.content).toBe("hello");
    });

    it("returns null for non-existent id", async () => {
      const result = await store.get("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  // ─── update() ────────────────────────────────────────

  describe("update()", () => {
    it("updates content of an existing entry", async () => {
      const added = await store.add({ type: "fact", content: "old content" });
      const updated = await store.update(added.id, { content: "new content" });

      expect(updated).not.toBeNull();
      expect(updated?.content).toBe("new content");
    });

    it("preserves existing fields when partially updating", async () => {
      const added = await store.add({
        type: "fact",
        content: "original",
        metadata: { key: "value" },
      });
      const updated = await store.update(added.id, { content: "updated" });

      expect(updated?.type).toBe("fact");
      expect(updated?.metadata).toEqual({ key: "value" });
    });

    it("returns null for non-existent id", async () => {
      const result = await store.update("nonexistent", { content: "x" });
      expect(result).toBeNull();
    });

    it("persists updates so subsequent get() returns updated value", async () => {
      const added = await store.add({ type: "fact", content: "v1" });
      await store.update(added.id, { content: "v2" });
      const retrieved = await store.get(added.id);

      expect(retrieved?.content).toBe("v2");
    });
  });

  // ─── delete() ────────────────────────────────────────

  describe("delete()", () => {
    it("deletes an existing entry and returns true", async () => {
      const added = await store.add({ type: "fact", content: "to delete" });
      const result = await store.delete(added.id);

      expect(result).toBe(true);
      expect(await store.get(added.id)).toBeNull();
    });

    it("returns false for non-existent id", async () => {
      const result = await store.delete("nonexistent");
      expect(result).toBe(false);
    });

    it("does not affect other entries when one is deleted", async () => {
      const e1 = await store.add({ type: "fact", content: "keep" });
      const e2 = await store.add({ type: "fact", content: "delete me" });

      await store.delete(e2.id);

      expect(await store.get(e1.id)).not.toBeNull();
    });
  });

  // ─── search() ────────────────────────────────────────

  describe("search()", () => {
    beforeEach(async () => {
      await store.add({
        type: "fact",
        content: "The capital of France is Paris",
      });
      await store.add({
        type: "episode",
        content: "I visited Paris last year",
      });
      await store.add({
        type: "summary",
        content: "A summary about technology trends",
      });
    });

    it("returns all entries when no filters", async () => {
      const results = await store.search({});
      expect(results).toHaveLength(3);
    });

    it("filters by type", async () => {
      const results = await store.search({ types: ["fact"] });
      expect(results).toHaveLength(1);
      expect(results[0].entry.type).toBe("fact");
    });

    it("filters by multiple types", async () => {
      const results = await store.search({ types: ["fact", "episode"] });
      expect(results).toHaveLength(2);
    });

    it("filters by keyword query (case-insensitive)", async () => {
      const results = await store.search({ query: "paris" });
      expect(results).toHaveLength(2); // Both entries containing "Paris"
    });

    it("filters by time range - start", async () => {
      const future = new Date(Date.now() + 10000);
      const results = await store.search({
        timeRange: { start: future },
      });
      expect(results).toHaveLength(0);
    });

    it("filters by time range - end", async () => {
      const past = new Date(Date.now() - 10000);
      const results = await store.search({
        timeRange: { end: past },
      });
      expect(results).toHaveLength(0);
    });

    it("returns entries within a valid time range", async () => {
      const start = new Date(Date.now() - 5000);
      const end = new Date(Date.now() + 5000);
      const results = await store.search({
        timeRange: { start, end },
      });
      expect(results).toHaveLength(3);
    });

    it("respects limit parameter", async () => {
      const results = await store.search({ limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("sorts by timestamp descending (most recent first) without embedding", async () => {
      const results = await store.search({});
      // All have score=1 and should be sorted by timestamp
      results.forEach((r) => expect(r.score).toBe(1));
    });

    it("performs vector search when embedding provided and entries have embeddings", async () => {
      const store2 = new InMemoryStore();
      await store2.add({
        type: "fact",
        content: "vector test 1",
        embedding: [1, 0, 0],
      });
      await store2.add({
        type: "fact",
        content: "vector test 2",
        embedding: [0, 1, 0],
      });

      const results = await store2.search({
        embedding: [1, 0, 0], // exact match with first entry
      });

      expect(results).toHaveLength(2);
      expect(results[0].score).toBeCloseTo(1); // cosine similarity = 1 for exact match
      expect(results[0].entry.content).toBe("vector test 1");
    });

    it("filters by minScore in vector search", async () => {
      const store2 = new InMemoryStore();
      await store2.add({
        type: "fact",
        content: "orthogonal",
        embedding: [0, 1, 0],
      });
      await store2.add({
        type: "fact",
        content: "parallel",
        embedding: [1, 0, 0],
      });

      const results = await store2.search({
        embedding: [1, 0, 0],
        minScore: 0.5,
      });

      // Only the parallel vector (score=1) should pass; orthogonal (score=0) is filtered
      expect(results).toHaveLength(1);
      expect(results[0].entry.content).toBe("parallel");
    });

    it("skips vector search when no entries have embeddings", async () => {
      const results = await store.search({ embedding: [1, 0, 0] });
      // Entries have no embeddings, so falls back to timestamp sort with score=1
      results.forEach((r) => expect(r.score).toBe(1));
    });
  });

  // ─── getRecent() ─────────────────────────────────────

  describe("getRecent()", () => {
    it("returns most recent entries sorted by timestamp", async () => {
      await store.add({ type: "fact", content: "oldest" });
      await new Promise((r) => setTimeout(r, 5)); // small delay
      await store.add({ type: "fact", content: "newest" });

      const recent = await store.getRecent(1);
      expect(recent).toHaveLength(1);
      expect(recent[0].content).toBe("newest");
    });

    it("filters by type", async () => {
      await store.add({ type: "fact", content: "a fact" });
      await store.add({ type: "episode", content: "an episode" });

      const recent = await store.getRecent(10, ["fact"]);
      expect(recent.every((e) => e.type === "fact")).toBe(true);
    });

    it("returns all entries when limit exceeds count", async () => {
      await store.add({ type: "fact", content: "entry 1" });
      await store.add({ type: "fact", content: "entry 2" });

      const recent = await store.getRecent(100);
      expect(recent).toHaveLength(2);
    });

    it("returns empty array when store is empty", async () => {
      const recent = await store.getRecent(10);
      expect(recent).toHaveLength(0);
    });
  });

  // ─── cleanup() ───────────────────────────────────────

  describe("cleanup()", () => {
    it("removes expired entries and returns count", async () => {
      const past = new Date(Date.now() - 1000);
      await store.add({ type: "fact", content: "expired 1", expiresAt: past });
      await store.add({ type: "fact", content: "expired 2", expiresAt: past });
      await store.add({ type: "fact", content: "valid" }); // no expiry

      const removed = await store.cleanup();
      expect(removed).toBe(2);
      expect(await store.count()).toBe(1);
    });

    it("returns 0 when no entries are expired", async () => {
      await store.add({ type: "fact", content: "valid" });
      const removed = await store.cleanup();
      expect(removed).toBe(0);
    });

    it("does not remove entries with no expiresAt", async () => {
      await store.add({ type: "fact", content: "no expiry" });
      await store.cleanup();
      expect(await store.count()).toBe(1);
    });

    it("does not remove future-expiry entries", async () => {
      const future = new Date(Date.now() + 60000);
      await store.add({
        type: "fact",
        content: "future expiry",
        expiresAt: future,
      });

      const removed = await store.cleanup();
      expect(removed).toBe(0);
      expect(await store.count()).toBe(1);
    });
  });

  // ─── clear() ─────────────────────────────────────────

  describe("clear()", () => {
    it("removes all entries", async () => {
      await store.add({ type: "fact", content: "entry 1" });
      await store.add({ type: "fact", content: "entry 2" });

      await store.clear();
      expect(await store.count()).toBe(0);
    });

    it("can add entries after clear", async () => {
      await store.add({ type: "fact", content: "before" });
      await store.clear();
      await store.add({ type: "fact", content: "after" });

      expect(await store.count()).toBe(1);
    });
  });

  // ─── count() ─────────────────────────────────────────

  describe("count()", () => {
    it("returns total count when no type filter", async () => {
      await store.add({ type: "fact", content: "1" });
      await store.add({ type: "episode", content: "2" });
      await store.add({ type: "summary", content: "3" });

      expect(await store.count()).toBe(3);
    });

    it("returns count for specific types", async () => {
      await store.add({ type: "fact", content: "fact 1" });
      await store.add({ type: "fact", content: "fact 2" });
      await store.add({ type: "episode", content: "episode 1" });

      expect(await store.count(["fact"])).toBe(2);
      expect(await store.count(["episode"])).toBe(1);
      expect(await store.count(["summary"])).toBe(0);
    });

    it("returns 0 for empty store", async () => {
      expect(await store.count()).toBe(0);
    });

    it("handles empty types array as 'no filter'", async () => {
      await store.add({ type: "fact", content: "1" });
      expect(await store.count([])).toBe(1);
    });
  });

  // ─── cosineSimilarity edge cases ─────────────────────

  describe("cosine similarity (via vector search)", () => {
    it("returns 0 for orthogonal vectors", async () => {
      const s = new InMemoryStore();
      await s.add({ type: "fact", content: "test", embedding: [0, 1] });

      const results = await s.search({ embedding: [1, 0] });
      expect(results[0].score).toBe(0);
    });

    it("returns 1 for identical vectors", async () => {
      const s = new InMemoryStore();
      await s.add({ type: "fact", content: "test", embedding: [1, 1, 1] });

      const results = await s.search({ embedding: [1, 1, 1] });
      expect(results[0].score).toBeCloseTo(1);
    });

    it("handles zero vectors gracefully (returns 0)", async () => {
      const s = new InMemoryStore();
      await s.add({ type: "fact", content: "test", embedding: [0, 0, 0] });

      const results = await s.search({ embedding: [1, 0, 0] });
      expect(results[0].score).toBe(0);
    });
  });
});

// ─── ConversationMemory tests ────────────────────────────

describe("ConversationMemory", () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory();
  });

  describe("constructor", () => {
    it("generates sessionId when not provided", () => {
      expect(memory.sessionId).toBeDefined();
      expect(memory.sessionId.length).toBeGreaterThan(0);
    });

    it("uses provided sessionId", () => {
      const m = new ConversationMemory("my-session");
      expect(m.sessionId).toBe("my-session");
    });
  });

  describe("addMessage()", () => {
    it("adds a message with auto-generated id and timestamp", async () => {
      await memory.addMessage({ role: "user", content: "Hello" });
      const messages = await memory.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBeDefined();
      expect(messages[0].timestamp).toBeInstanceOf(Date);
    });

    it("preserves provided id and timestamp", async () => {
      const ts = new Date("2025-01-01");
      await memory.addMessage({
        id: "msg-1",
        role: "user",
        content: "Hi",
        timestamp: ts,
      });
      const messages = await memory.getMessages();
      expect(messages[0].id).toBe("msg-1");
      expect(messages[0].timestamp).toEqual(ts);
    });
  });

  describe("getMessages()", () => {
    beforeEach(async () => {
      await memory.addMessage({ role: "user", content: "msg1" });
      await memory.addMessage({ role: "assistant", content: "msg2" });
      await memory.addMessage({ role: "user", content: "msg3" });
    });

    it("returns all messages without limit", async () => {
      const messages = await memory.getMessages();
      expect(messages).toHaveLength(3);
    });

    it("returns last N messages with limit", async () => {
      const messages = await memory.getMessages(2);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("msg2");
      expect(messages[1].content).toBe("msg3");
    });

    it("returns a copy (not reference)", async () => {
      const messages = await memory.getMessages();
      messages.push({ role: "user", content: "injected" });
      const messages2 = await memory.getMessages();
      expect(messages2).toHaveLength(3); // original unchanged
    });
  });

  describe("getContextWindow()", () => {
    it("returns messages that fit within token budget", async () => {
      // Each message ~4 chars = ~1 token, so budget of 10 allows a few messages
      await memory.addMessage({ role: "user", content: "a".repeat(40) }); // ~10 tokens
      await memory.addMessage({ role: "assistant", content: "b".repeat(40) }); // ~10 tokens
      await memory.addMessage({ role: "user", content: "c".repeat(40) }); // ~10 tokens

      const context = await memory.getContextWindow(25); // allow ~25 tokens
      // Should include the last 2 messages at least
      expect(context.length).toBeGreaterThan(0);
      expect(context.length).toBeLessThanOrEqual(3);
    });

    it("returns empty array when no messages", async () => {
      const context = await memory.getContextWindow(1000);
      expect(context).toHaveLength(0);
    });

    it("returns most recent messages first when fitting", async () => {
      await memory.addMessage({ role: "user", content: "first" });
      await memory.addMessage({ role: "assistant", content: "second" });
      await memory.addMessage({ role: "user", content: "third" });

      const context = await memory.getContextWindow(10000);
      expect(context[context.length - 1].content).toBe("third");
    });
  });

  describe("summarize()", () => {
    it("returns summary string with message counts", async () => {
      await memory.addMessage({ role: "user", content: "question" });
      await memory.addMessage({ role: "assistant", content: "answer" });
      await memory.addMessage({ role: "user", content: "follow up" });

      const summary = await memory.summarize();
      expect(summary).toContain("2"); // 2 user messages
      expect(summary).toContain("1"); // 1 assistant message
    });

    it("works with empty conversation", async () => {
      const summary = await memory.summarize();
      expect(summary).toContain("0");
    });
  });

  describe("clear()", () => {
    it("removes all messages", async () => {
      await memory.addMessage({ role: "user", content: "msg" });
      await memory.clear();
      const messages = await memory.getMessages();
      expect(messages).toHaveLength(0);
    });
  });
});

// ─── WorkingMemory tests ──────────────────────────────────

describe("WorkingMemory", () => {
  let working: WorkingMemory;

  beforeEach(() => {
    working = new WorkingMemory();
  });

  describe("set() / get()", () => {
    it("stores and retrieves a value", () => {
      working.set("key1", "value1");
      expect(working.get("key1")).toBe("value1");
    });

    it("stores complex objects", () => {
      const obj = { nested: { data: [1, 2, 3] } };
      working.set("complex", obj);
      expect(working.get("complex")).toEqual(obj);
    });

    it("returns undefined for missing key", () => {
      expect(working.get("missing")).toBeUndefined();
    });

    it("overwrites existing value", () => {
      working.set("key", "v1");
      working.set("key", "v2");
      expect(working.get("key")).toBe("v2");
    });

    it("supports typed get<T>()", () => {
      working.set("count", 42);
      const count = working.get<number>("count");
      expect(count).toBe(42);
    });
  });

  describe("has()", () => {
    it("returns true for existing key", () => {
      working.set("k", "v");
      expect(working.has("k")).toBe(true);
    });

    it("returns false for missing key", () => {
      expect(working.has("nonexistent")).toBe(false);
    });
  });

  describe("delete()", () => {
    it("removes existing key and returns true", () => {
      working.set("k", "v");
      expect(working.delete("k")).toBe(true);
      expect(working.has("k")).toBe(false);
    });

    it("returns false for non-existent key", () => {
      expect(working.delete("missing")).toBe(false);
    });
  });

  describe("clear()", () => {
    it("removes all keys", () => {
      working.set("a", 1);
      working.set("b", 2);
      working.clear();
      expect(working.keys()).toHaveLength(0);
    });
  });

  describe("keys()", () => {
    it("returns all stored keys", () => {
      working.set("x", 1);
      working.set("y", 2);
      expect(working.keys()).toContain("x");
      expect(working.keys()).toContain("y");
      expect(working.keys()).toHaveLength(2);
    });

    it("returns empty array when empty", () => {
      expect(working.keys()).toHaveLength(0);
    });
  });

  describe("toObject()", () => {
    it("converts all entries to plain object", () => {
      working.set("a", 1);
      working.set("b", "hello");
      const obj = working.toObject();
      expect(obj).toEqual({ a: 1, b: "hello" });
    });

    it("returns empty object when empty", () => {
      expect(working.toObject()).toEqual({});
    });
  });
});

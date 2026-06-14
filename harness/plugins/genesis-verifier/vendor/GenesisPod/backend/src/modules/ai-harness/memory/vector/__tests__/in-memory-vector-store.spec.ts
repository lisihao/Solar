/**
 * InMemoryVectorStore 单元测试 (PR-I)
 */

import { InMemoryVectorStore } from "../in-memory-vector-store";

describe("InMemoryVectorStore (PR-I)", () => {
  it("recalls top-K by cosine similarity", () => {
    const store = new InMemoryVectorStore();
    store.add({
      key: "a",
      value: "alpha",
      embedding: [1, 0, 0],
      namespace: "u1",
      createdAt: 0,
    });
    store.add({
      key: "b",
      value: "beta",
      embedding: [0, 1, 0],
      namespace: "u1",
      createdAt: 0,
    });
    store.add({
      key: "c",
      value: "gamma",
      embedding: [0.9, 0.1, 0],
      namespace: "u1",
      createdAt: 0,
    });

    const hits = store.recall([1, 0, 0], {
      k: 2,
      namespace: "u1",
      minSimilarity: 0.5,
    });
    expect(hits[0].entry.key).toBe("a");
    expect(hits[0].similarity).toBeCloseTo(1);
    expect(hits[1].entry.key).toBe("c");
  });

  it("isolates by namespace", () => {
    const store = new InMemoryVectorStore();
    store.add({
      key: "a",
      value: 1,
      embedding: [1, 0],
      namespace: "u1",
      createdAt: 0,
    });
    store.add({
      key: "b",
      value: 2,
      embedding: [1, 0],
      namespace: "u2",
      createdAt: 0,
    });
    expect(store.recall([1, 0], { namespace: "u1" })).toHaveLength(1);
    expect(store.recall([1, 0], { namespace: "u2" })).toHaveLength(1);
  });

  it("clear() without namespace removes all entries", () => {
    const store = new InMemoryVectorStore();
    store.add({
      key: "a",
      value: 1,
      embedding: [1],
      namespace: "ns1",
      createdAt: 0,
    });
    store.add({
      key: "b",
      value: 2,
      embedding: [0],
      namespace: "ns2",
      createdAt: 0,
    });
    expect(store.size()).toBe(2);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it("clear(namespace) removes only entries in that namespace", () => {
    const store = new InMemoryVectorStore();
    store.add({
      key: "a",
      value: 1,
      embedding: [1],
      namespace: "keep",
      createdAt: 0,
    });
    store.add({
      key: "b",
      value: 2,
      embedding: [1],
      namespace: "remove",
      createdAt: 0,
    });
    store.add({
      key: "c",
      value: 3,
      embedding: [1],
      namespace: "remove",
      createdAt: 0,
    });
    store.clear("remove");
    expect(store.size()).toBe(1);
    expect(store.recall([1], { namespace: "keep" })).toHaveLength(1);
    expect(store.recall([1], { namespace: "remove" })).toHaveLength(0);
  });

  it("evicts oldest when over capacity", () => {
    const store = new InMemoryVectorStore();
    store.setCapacity(2);
    store.add({
      key: "a",
      value: 1,
      embedding: [1],
      namespace: "n",
      createdAt: 1,
    });
    store.add({
      key: "b",
      value: 2,
      embedding: [1],
      namespace: "n",
      createdAt: 2,
    });
    store.add({
      key: "c",
      value: 3,
      embedding: [1],
      namespace: "n",
      createdAt: 3,
    });
    expect(store.size()).toBe(2);
    const hits = store.recall([1], { namespace: "n", minSimilarity: 0 });
    expect(hits.find((h) => h.entry.key === "a")).toBeUndefined();
  });
});

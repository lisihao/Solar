import { PrismaVectorStore } from "../prisma-vector-store";
import { Prisma } from "@prisma/client";

function makeRow(
  overrides: Partial<{
    id: string;
    namespace: string;
    source: string | null;
    entryKey: string;
    content: string;
    embedding: number[];
    confidence: number;
    tags: string[];
    metadata: unknown;
    createdAt: Date;
    lastAccessedAt: Date;
  }> = {},
) {
  return {
    id: "id-1",
    namespace: "ns",
    source: null,
    entryKey: "k1",
    content: "hello",
    embedding: [0.5, 0.5, 0.0],
    confidence: 1.0,
    tags: [],
    metadata: Prisma.JsonNull,
    createdAt: new Date(),
    lastAccessedAt: new Date(),
    ...overrides,
  };
}

function makePrisma(
  overrides: Partial<{
    create: jest.Mock;
    createMany: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
    updateMany: jest.Mock;
    count: jest.Mock;
  }> = {},
) {
  return {
    harnessVectorMemory: {
      create: jest.fn().mockResolvedValue(makeRow()),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      ...overrides,
    },
  };
}

describe("PrismaVectorStore", () => {
  describe("add()", () => {
    it("creates a record and returns entry", async () => {
      const row = makeRow({ source: "agent:x", metadata: { k: "v" } });
      const prisma = makePrisma({ create: jest.fn().mockResolvedValue(row) });
      const store = new PrismaVectorStore(prisma as never);
      const entry = await store.add({
        namespace: "ns",
        source: "agent:x",
        entryKey: "k1",
        content: "hello",
        embedding: [0.5, 0.5, 0.0],
        confidence: 1.0,
        tags: [],
        metadata: { k: "v" },
      });
      expect(prisma.harnessVectorMemory.create).toHaveBeenCalled();
      expect(entry.content).toBe("hello");
    });

    it("handles null metadata", async () => {
      const prisma = makePrisma({
        create: jest.fn().mockResolvedValue(makeRow()),
      });
      const store = new PrismaVectorStore(prisma as never);
      await store.add({
        namespace: "ns",
        entryKey: "k2",
        content: "hi",
        embedding: [1, 0],
        confidence: 0.8,
        tags: ["tag1"],
      });
      expect(prisma.harnessVectorMemory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: Prisma.JsonNull }),
        }),
      );
    });
  });

  describe("addBatch()", () => {
    it("returns 0 for empty array", async () => {
      const prisma = makePrisma();
      const store = new PrismaVectorStore(prisma as never);
      const count = await store.addBatch([]);
      expect(count).toBe(0);
    });

    it("inserts multiple entries", async () => {
      const prisma = makePrisma({
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
      });
      const store = new PrismaVectorStore(prisma as never);
      const entries = [
        {
          namespace: "ns",
          entryKey: "k1",
          content: "a",
          embedding: [1, 0],
          confidence: 1,
          tags: [],
        },
        {
          namespace: "ns",
          entryKey: "k2",
          content: "b",
          embedding: [0, 1],
          confidence: 1,
          tags: [],
        },
        {
          namespace: "ns",
          entryKey: "k3",
          content: "c",
          embedding: [0.5, 0.5],
          confidence: 0.8,
          tags: [],
        },
      ] as const;
      const count = await store.addBatch(entries);
      expect(count).toBe(3);
    });
  });

  describe("recall()", () => {
    it("returns empty array when no candidates", async () => {
      const prisma = makePrisma({ findMany: jest.fn().mockResolvedValue([]) });
      const store = new PrismaVectorStore(prisma as never);
      const hits = await store.recall([1, 0, 0], { namespace: "ns" });
      expect(hits).toHaveLength(0);
    });

    it("ranks by cosine similarity and applies minSimilarity filter", async () => {
      const rows = [
        makeRow({ id: "id-1", embedding: [1, 0, 0], entryKey: "k1" }),
        makeRow({ id: "id-2", embedding: [0, 1, 0], entryKey: "k2" }),
        makeRow({ id: "id-3", embedding: [1, 0, 0], entryKey: "k3" }),
      ];
      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue(rows),
      });
      const store = new PrismaVectorStore(prisma as never);
      const hits = await store.recall([1, 0, 0], {
        namespace: "ns",
        minSimilarity: 0.9,
      });
      // Only rows with embedding [1,0,0] should be returned (sim=1.0)
      expect(hits.length).toBe(2);
      hits.forEach((h) => expect(h.similarity).toBeGreaterThanOrEqual(0.9));
    });

    it("limits results to k", async () => {
      const rows = [
        makeRow({ id: "id-1", embedding: [1, 0, 0], entryKey: "k1" }),
        makeRow({ id: "id-2", embedding: [0.9, 0.1, 0], entryKey: "k2" }),
        makeRow({ id: "id-3", embedding: [0.8, 0.2, 0], entryKey: "k3" }),
      ];
      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue(rows),
      });
      const store = new PrismaVectorStore(prisma as never);
      const hits = await store.recall([1, 0, 0], {
        namespace: "ns",
        k: 2,
        minSimilarity: 0,
      });
      expect(hits.length).toBe(2);
    });

    it("passes tag filter to query", async () => {
      const prisma = makePrisma({ findMany: jest.fn().mockResolvedValue([]) });
      const store = new PrismaVectorStore(prisma as never);
      await store.recall([1, 0], { namespace: "ns", tags: ["important"] });
      expect(prisma.harnessVectorMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tags: { hasEvery: ["important"] } }),
        }),
      );
    });

    it("handles zero-magnitude embeddings gracefully", async () => {
      const rows = [makeRow({ embedding: [0, 0, 0] })];
      const prisma = makePrisma({
        findMany: jest.fn().mockResolvedValue(rows),
      });
      const store = new PrismaVectorStore(prisma as never);
      // Should not throw
      await expect(
        store.recall([0, 0, 0], { namespace: "ns", minSimilarity: 0 }),
      ).resolves.toBeDefined();
    });
  });

  describe("clearNamespace()", () => {
    it("deletes all entries in namespace", async () => {
      const prisma = makePrisma({
        deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
      });
      const store = new PrismaVectorStore(prisma as never);
      const count = await store.clearNamespace("ns");
      expect(count).toBe(5);
    });
  });

  describe("evictIfNeeded() — LRU eviction when over capacity", () => {
    it("evicts oldest entries when namespace count exceeds capacity", async () => {
      // perNamespaceCapacity = 5000; simulate count=5001 (1 overflow)
      const oldestRow = { id: "old-id" };
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const findMany = jest
        .fn()
        .mockImplementation(
          (
            args:
              | {
                  where?: { namespace?: string };
                  orderBy?: unknown;
                  take?: number;
                  select?: unknown;
                }
              | undefined,
          ) => {
            // When called for recall (no take), return []
            // When called for eviction (take=1), return oldestRow
            if (args?.take === 1) return Promise.resolve([oldestRow]);
            return Promise.resolve([]);
          },
        );
      const count = jest.fn().mockResolvedValue(5001);
      const prisma = makePrisma({ findMany, deleteMany, count });
      const store = new PrismaVectorStore(prisma as never);

      await store.add({
        namespace: "full-ns",
        entryKey: "new-key",
        content: "new content",
        embedding: [1, 0],
        confidence: 1,
        tags: [],
      });

      // Flush the fire-and-forget evictIfNeeded promise
      await new Promise((r) => setImmediate(r));

      expect(count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { namespace: "full-ns" } }),
      );
      expect(deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ["old-id"] } } }),
      );
    });

    it("skips eviction when namespace count is within capacity", async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const count = jest.fn().mockResolvedValue(100); // well within 5000
      const prisma = makePrisma({ deleteMany, count });
      const store = new PrismaVectorStore(prisma as never);

      await store.add({
        namespace: "light-ns",
        entryKey: "k1",
        content: "content",
        embedding: [1, 0],
        confidence: 1,
        tags: [],
      });

      await new Promise((r) => setImmediate(r));

      expect(deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("size()", () => {
    it("returns total count without namespace filter", async () => {
      const prisma = makePrisma({ count: jest.fn().mockResolvedValue(42) });
      const store = new PrismaVectorStore(prisma as never);
      const n = await store.size();
      expect(n).toBe(42);
    });

    it("returns count with namespace filter", async () => {
      const prisma = makePrisma({ count: jest.fn().mockResolvedValue(10) });
      const store = new PrismaVectorStore(prisma as never);
      const n = await store.size("ns");
      expect(n).toBe(10);
    });
  });
});

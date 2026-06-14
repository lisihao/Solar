/**
 * KnowledgeBaseTool - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Line 417: ensureMemoryTable() catch block (DB error → sets memoryTableReady=false)
 *  - Line 450: validateInput default → false (unknown op string via type cast)
 *  - Line 490: doExecute unknown operation default case
 *  - Lines 520, 568, 604, 663, 706, 819: ensureMemoryTable() === false in each op
 *  - Lines 738-741: sortBy === "relevance" path in searchEntries
 *  - Lines 885-889: sortBy "title"/"createdAt" in sortEntries
 *  - Lines 906-923: calculateRelevance() function
 */

import {
  KnowledgeBaseTool,
  KnowledgeOperation,
  KnowledgeEntry,
} from "../knowledge-base.tool";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ToolContext } from "../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers shared with base spec
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "ext-exec",
    toolId: "knowledge-base",
    userId: "user-ext",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  const now = new Date("2025-01-15");
  return {
    id: "kb-ext-001",
    title: "Extended Test Entry",
    content: "Content for extended test",
    category: "Test",
    tags: ["tag-a", "tag-b"],
    metadata: {},
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function makeDbRecord(entry: KnowledgeEntry) {
  return {
    id: "db-ext-001",
    userId: "system",
    key: entry.id,
    type: "knowledge_entry",
    value: entry as unknown as object,
    tags: entry.tags,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KnowledgeBaseTool (extended coverage)", () => {
  // =========================================================================
  // Line 417: ensureMemoryTable() DB error
  // =========================================================================

  describe("ensureMemoryTable() DB error (line 417)", () => {
    it("sets memoryTableReady=false when $queryRaw throws", async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("DB unavailable")),
        longTermMemory: { findMany: jest.fn() },
      };
      const tool = new KnowledgeBaseTool(
        mockPrisma as unknown as PrismaService,
      );

      // CREATE will call ensureMemoryTable → throws → returns false → create returns "unavailable"
      const result = await tool.execute(
        {
          operation: KnowledgeOperation.CREATE,
          entry: { title: "Test", content: "Content" },
        },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("unavailable");
    });
  });

  // =========================================================================
  // Line 490: doExecute unknown operation default case
  // =========================================================================

  describe("doExecute unknown operation (line 490)", () => {
    it("returns error for unknown operation string via type cast", async () => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
        longTermMemory: {},
      };
      const tool = new KnowledgeBaseTool(
        mockPrisma as unknown as PrismaService,
      );

      // Force unknown operation through type cast
      const result = await tool.execute(
        { operation: "UNKNOWN_OP" as KnowledgeOperation },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Unknown operation");
    });
  });

  // =========================================================================
  // Lines 520, 568, 604, 663, 706, 819: ensureMemoryTable() === false
  // =========================================================================

  describe("ensureMemoryTable() returns false (table not ready)", () => {
    let tool: KnowledgeBaseTool;

    beforeEach(() => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ exists: false }]),
        longTermMemory: {},
      };
      tool = new KnowledgeBaseTool(mockPrisma as unknown as PrismaService);
    });

    it("CREATE returns unavailable when table not ready (line 520)", async () => {
      const result = await tool.execute(
        {
          operation: KnowledgeOperation.CREATE,
          entry: { title: "T", content: "C" },
        },
        makeContext(),
      );
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("unavailable");
    });

    it("READ returns unavailable when table not ready (line 568)", async () => {
      const result = await tool.execute(
        { operation: KnowledgeOperation.READ, entryId: "kb-001" },
        makeContext(),
      );
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("unavailable");
    });

    it("UPDATE returns unavailable when table not ready (line 604)", async () => {
      const result = await tool.execute(
        {
          operation: KnowledgeOperation.UPDATE,
          entryId: "kb-001",
          entry: { title: "New Title" },
        },
        makeContext(),
      );
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("unavailable");
    });

    it("DELETE returns unavailable when table not ready (line 663)", async () => {
      const result = await tool.execute(
        { operation: KnowledgeOperation.DELETE, entryId: "kb-001" },
        makeContext(),
      );
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("unavailable");
    });

    it("SEARCH returns empty results when table not ready (loadAllEntries line 706)", async () => {
      const result = await tool.execute(
        { operation: KnowledgeOperation.SEARCH, query: "test" },
        makeContext(),
      );
      // searchEntries calls loadAllEntries which returns [] when table not ready
      expect(result.data?.success).toBe(true);
      expect(result.data?.entries).toHaveLength(0);
    });

    it("LIST_TAGS returns empty tags when table not ready (line 819)", async () => {
      const result = await tool.execute(
        { operation: KnowledgeOperation.LIST_TAGS },
        makeContext(),
      );
      expect(result.data?.success).toBe(true);
      expect(result.data?.tags).toHaveLength(0);
    });
  });

  // =========================================================================
  // Lines 738-741: sortBy === "relevance" in SEARCH
  // =========================================================================

  describe("SEARCH with sortBy=relevance (lines 738-741)", () => {
    it("sorts results by relevance score", async () => {
      const entry1 = makeEntry({
        id: "kb-relevance-low",
        title: "Unrelated Article",
        content: "nothing here",
        tags: [],
        category: "cat",
      });
      const entry2 = makeEntry({
        id: "kb-relevance-high",
        title: "Machine learning overview", // title match → higher score
        content: "machine learning is a field of AI machine",
        tags: ["machine"],
        category: "cat",
      });

      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
        longTermMemory: {
          findMany: jest
            .fn()
            .mockResolvedValue([makeDbRecord(entry1), makeDbRecord(entry2)]),
        },
      };
      const tool = new KnowledgeBaseTool(
        mockPrisma as unknown as PrismaService,
      );

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.SEARCH,
          query: "machine",
          filter: { sortBy: "relevance" as unknown as "updatedAt" },
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      const entries = result.data?.entries ?? [];
      expect(entries.length).toBeGreaterThan(0);
      // High relevance entry should come first
      expect(entries[0].id).toBe("kb-relevance-high");
    });
  });

  // =========================================================================
  // Lines 885-889: sortBy "title"/"createdAt" in sortEntries
  // =========================================================================

  describe("LIST with sortBy title/createdAt (lines 885-889)", () => {
    const entries = [
      makeEntry({
        id: "kb-z",
        title: "Zebra",
        category: "cat",
        createdAt: new Date("2025-01-20"),
        updatedAt: new Date("2025-01-20"),
      }),
      makeEntry({
        id: "kb-a",
        title: "Apple",
        category: "cat",
        createdAt: new Date("2025-01-10"),
        updatedAt: new Date("2025-01-10"),
      }),
    ];

    let tool: KnowledgeBaseTool;

    beforeEach(() => {
      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
        longTermMemory: {
          findMany: jest.fn().mockResolvedValue(entries.map(makeDbRecord)),
        },
      };
      tool = new KnowledgeBaseTool(mockPrisma as unknown as PrismaService);
    });

    it("sorts LIST results by title ascending (line 885)", async () => {
      const result = await tool.execute(
        {
          operation: KnowledgeOperation.LIST,
          filter: { sortBy: "title", sortOrder: "asc" },
        },
        makeContext(),
      );

      const titles = result.data?.entries?.map((e) => e.title) ?? [];
      expect(titles[0]).toBe("Apple");
      expect(titles[1]).toBe("Zebra");
    });

    it("sorts LIST results by title descending (line 885)", async () => {
      const result = await tool.execute(
        {
          operation: KnowledgeOperation.LIST,
          filter: { sortBy: "title", sortOrder: "desc" },
        },
        makeContext(),
      );

      const titles = result.data?.entries?.map((e) => e.title) ?? [];
      expect(titles[0]).toBe("Zebra");
    });

    it("sorts LIST results by createdAt ascending (line 888)", async () => {
      const result = await tool.execute(
        {
          operation: KnowledgeOperation.LIST,
          filter: { sortBy: "createdAt", sortOrder: "asc" },
        },
        makeContext(),
      );

      const ids = result.data?.entries?.map((e) => e.id) ?? [];
      // Earlier createdAt should come first
      expect(ids[0]).toBe("kb-a");
    });
  });

  // =========================================================================
  // Lines 906-923: calculateRelevance
  // The function is called when sortBy=relevance in SEARCH
  // Already tested above, but ensure we hit scoring branches:
  // title match (+10), content frequency (+2 per match), tag match (+5)
  // =========================================================================

  describe("calculateRelevance scoring (lines 906-923)", () => {
    it("entry with title+content+tag match has higher score than title-only match", async () => {
      const entryTitleOnly = makeEntry({
        id: "kb-title-only",
        title: "quantum physics guide",
        content: "unrelated stuff",
        tags: ["general"],
      });
      const entryAllMatch = makeEntry({
        id: "kb-all-match",
        title: "quantum computing basics",
        content: "quantum quantum quantum physics",
        tags: ["quantum", "physics"],
      });

      const mockPrisma = {
        $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
        longTermMemory: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              makeDbRecord(entryTitleOnly),
              makeDbRecord(entryAllMatch),
            ]),
        },
      };
      const tool = new KnowledgeBaseTool(
        mockPrisma as unknown as PrismaService,
      );

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.SEARCH,
          query: "quantum",
          filter: { sortBy: "relevance" as unknown as "updatedAt" },
        },
        makeContext(),
      );

      const entries = result.data?.entries ?? [];
      expect(entries[0].id).toBe("kb-all-match");
    });
  });
});

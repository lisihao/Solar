import {
  KnowledgeBaseTool,
  KnowledgeOperation,
  KnowledgeEntry,
} from "../knowledge-base.tool";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock factory
// ============================================================================

const mockPrisma = {
  $queryRaw: jest.fn().mockResolvedValue([{ exists: true }]),
  longTermMemory: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    findMany: jest.fn(),
  },
};

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "knowledge-base",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeKnowledgeEntry(
  overrides: Partial<KnowledgeEntry> = {},
): KnowledgeEntry {
  return {
    id: "kb-1234567890-abc123",
    title: "React Hooks Best Practices",
    content: "Use useState for local state management...",
    category: "Frontend Development",
    tags: ["React", "Hooks", "JavaScript"],
    metadata: {},
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-10"),
    version: 1,
    source: "Official Docs",
    references: ["https://react.dev/hooks"],
    ...overrides,
  };
}

function makeDbRecord(entry: KnowledgeEntry) {
  return {
    id: "db-record-id",
    userId: "system",
    key: entry.id,
    type: "knowledge_entry",
    value: entry as unknown as object,
    tags: entry.tags,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("KnowledgeBaseTool", () => {
  let tool: KnowledgeBaseTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new KnowledgeBaseTool(mockPrisma as unknown as PrismaService);
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return false for an invalid operation string", () => {
      expect(
        tool.validateInput({ operation: "INVALID" as KnowledgeOperation }),
      ).toBe(false);
    });

    it("should return true for CREATE with title and content", () => {
      expect(
        tool.validateInput({
          operation: KnowledgeOperation.CREATE,
          entry: { title: "Test Title", content: "Test content" },
        }),
      ).toBe(true);
    });

    it("should return false for CREATE without entry", () => {
      expect(tool.validateInput({ operation: KnowledgeOperation.CREATE })).toBe(
        false,
      );
    });

    it("should return false for CREATE without title", () => {
      expect(
        tool.validateInput({
          operation: KnowledgeOperation.CREATE,
          entry: { title: "", content: "Some content" },
        }),
      ).toBe(false);
    });

    it("should return false for CREATE without content", () => {
      expect(
        tool.validateInput({
          operation: KnowledgeOperation.CREATE,
          entry: { title: "A Title", content: "" },
        }),
      ).toBe(false);
    });

    it("should return true for READ with entryId", () => {
      expect(
        tool.validateInput({
          operation: KnowledgeOperation.READ,
          entryId: "kb-123",
        }),
      ).toBe(true);
    });

    it("should return false for READ without entryId", () => {
      expect(tool.validateInput({ operation: KnowledgeOperation.READ })).toBe(
        false,
      );
    });

    it("should return true for UPDATE with entryId", () => {
      expect(
        tool.validateInput({
          operation: KnowledgeOperation.UPDATE,
          entryId: "kb-123",
        }),
      ).toBe(true);
    });

    it("should return false for UPDATE without entryId", () => {
      expect(tool.validateInput({ operation: KnowledgeOperation.UPDATE })).toBe(
        false,
      );
    });

    it("should return true for DELETE with entryId", () => {
      expect(
        tool.validateInput({
          operation: KnowledgeOperation.DELETE,
          entryId: "kb-123",
        }),
      ).toBe(true);
    });

    it("should return false for DELETE without entryId", () => {
      expect(tool.validateInput({ operation: KnowledgeOperation.DELETE })).toBe(
        false,
      );
    });

    it("should return true for SEARCH with query", () => {
      expect(
        tool.validateInput({
          operation: KnowledgeOperation.SEARCH,
          query: "React Hooks",
        }),
      ).toBe(true);
    });

    it("should return false for SEARCH without query", () => {
      expect(tool.validateInput({ operation: KnowledgeOperation.SEARCH })).toBe(
        false,
      );
    });

    it("should return true for LIST without any extra params", () => {
      expect(tool.validateInput({ operation: KnowledgeOperation.LIST })).toBe(
        true,
      );
    });

    it("should return true for LIST_CATEGORIES without any extra params", () => {
      expect(
        tool.validateInput({ operation: KnowledgeOperation.LIST_CATEGORIES }),
      ).toBe(true);
    });

    it("should return true for LIST_TAGS without any extra params", () => {
      expect(
        tool.validateInput({ operation: KnowledgeOperation.LIST_TAGS }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // CREATE operation
  // --------------------------------------------------------------------------

  describe("CREATE operation", () => {
    it("should create a new knowledge entry and return entryId", async () => {
      mockPrisma.longTermMemory.create.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.CREATE,
          entry: {
            title: "React Hooks Best Practices",
            content: "Use useState for local state...",
            category: "Frontend Development",
            tags: ["React", "Hooks"],
            source: "Official Docs",
            references: ["https://react.dev"],
          },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(KnowledgeOperation.CREATE);
      expect(result.data?.entry?.id).toBeDefined();
      expect(result.data?.entry?.title).toBe("React Hooks Best Practices");
      expect(result.data?.entry?.version).toBe(1);
      expect(mockPrisma.longTermMemory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "system",
            type: "knowledge_entry",
          }),
        }),
      );
    });

    it("should use default category when category not provided", async () => {
      mockPrisma.longTermMemory.create.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.CREATE,
          entry: {
            title: "No Category Entry",
            content: "Some content without category",
          },
        },
        createMockContext(),
      );

      expect(result.data?.entry?.category).toBe("未分类");
    });

    it("should initialize entry with empty tags when tags not provided", async () => {
      mockPrisma.longTermMemory.create.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.CREATE,
          entry: { title: "No Tags Entry", content: "Content" },
        },
        createMockContext(),
      );

      expect(result.data?.entry?.tags).toEqual([]);
    });

    it("should set createdAt and updatedAt on creation", async () => {
      mockPrisma.longTermMemory.create.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.CREATE,
          entry: { title: "Timestamp Test", content: "Content" },
        },
        createMockContext(),
      );

      expect(result.data?.entry?.createdAt).toBeDefined();
      expect(result.data?.entry?.updatedAt).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // READ operation
  // --------------------------------------------------------------------------

  describe("READ operation", () => {
    it("should return the knowledge entry when found", async () => {
      const entry = makeKnowledgeEntry();
      const record = makeDbRecord(entry);
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.READ,
          entryId: entry.id,
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(KnowledgeOperation.READ);
      expect(result.data?.entry?.title).toBe("React Hooks Best Practices");
      expect(result.data?.entry?.version).toBe(1);
    });

    it("should return error when entry not found", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.READ,
          entryId: "nonexistent-id",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("nonexistent-id");
    });

    it("should return error when record type is not knowledge_entry", async () => {
      const entry = makeKnowledgeEntry();
      const record = { ...makeDbRecord(entry), type: "other_type" };
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.READ,
          entryId: entry.id,
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // UPDATE operation
  // --------------------------------------------------------------------------

  describe("UPDATE operation", () => {
    it("should update entry fields and increment version", async () => {
      const entry = makeKnowledgeEntry({ version: 1 });
      const record = makeDbRecord(entry);
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);
      mockPrisma.longTermMemory.update.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.UPDATE,
          entryId: entry.id,
          entry: {
            title: "Updated React Hooks Best Practices",
            content: "Updated content...",
            tags: ["React", "Hooks", "TypeScript"],
          },
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(KnowledgeOperation.UPDATE);
      expect(result.data?.entry?.title).toBe(
        "Updated React Hooks Best Practices",
      );
      expect(result.data?.entry?.version).toBe(2);
      expect(result.data?.entry?.tags).toContain("TypeScript");
      expect(mockPrisma.longTermMemory.update).toHaveBeenCalled();
    });

    it("should return error when entry not found for update", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.UPDATE,
          entryId: "nonexistent-id",
          entry: { title: "New Title", content: "New Content" },
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("nonexistent-id");
    });

    it("should merge metadata on update", async () => {
      const entry = makeKnowledgeEntry({ metadata: { author: "Alice" } });
      const record = makeDbRecord(entry);
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);
      mockPrisma.longTermMemory.update.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.UPDATE,
          entryId: entry.id,
          entry: {
            title: "React Hooks Best Practices",
            content: "Content",
            metadata: { reviewer: "Bob" },
          },
        },
        createMockContext(),
      );

      expect(result.data?.entry?.metadata).toMatchObject({
        author: "Alice",
        reviewer: "Bob",
      });
    });
  });

  // --------------------------------------------------------------------------
  // DELETE operation
  // --------------------------------------------------------------------------

  describe("DELETE operation", () => {
    it("should delete entry and return success", async () => {
      const entry = makeKnowledgeEntry();
      const record = makeDbRecord(entry);
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(record);
      mockPrisma.longTermMemory.delete.mockResolvedValueOnce({});

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.DELETE,
          entryId: entry.id,
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(KnowledgeOperation.DELETE);
      expect(result.data?.entry?.title).toBe("React Hooks Best Practices");
      expect(mockPrisma.longTermMemory.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId_key: expect.objectContaining({ userId: "system" }),
          }),
        }),
      );
    });

    it("should return error when entry not found for delete", async () => {
      mockPrisma.longTermMemory.findUnique.mockResolvedValueOnce(null);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.DELETE,
          entryId: "nonexistent-id",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("nonexistent-id");
    });
  });

  // --------------------------------------------------------------------------
  // SEARCH operation
  // --------------------------------------------------------------------------

  describe("SEARCH operation", () => {
    it("should return entries matching by title (case-insensitive)", async () => {
      const reactEntry = makeKnowledgeEntry({
        title: "React Hooks Best Practices",
        content: "How to use hooks",
        tags: ["React"],
      });
      const vueEntry = makeKnowledgeEntry({
        id: "kb-vue",
        title: "Vue Composition API",
        content: "Vue 3 composition patterns",
        tags: ["Vue"],
        category: "Frontend",
        version: 1,
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-05"),
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        makeDbRecord(reactEntry),
        makeDbRecord(vueEntry),
      ]);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.SEARCH,
          query: "react",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(KnowledgeOperation.SEARCH);
      expect(result.data?.entries).toHaveLength(1);
      expect(result.data?.entries?.[0].title).toBe(
        "React Hooks Best Practices",
      );
    });

    it("should return entries matching by content", async () => {
      const entry = makeKnowledgeEntry({
        title: "State Management",
        content: "Redux is a powerful state management solution",
        tags: [],
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        makeDbRecord(entry),
      ]);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.SEARCH,
          query: "redux",
        },
        createMockContext(),
      );

      expect(result.data?.entries).toHaveLength(1);
    });

    it("should return entries matching by tag", async () => {
      const entry = makeKnowledgeEntry({
        title: "Generic Title",
        content: "Generic content",
        tags: ["TypeScript", "typing"],
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        makeDbRecord(entry),
      ]);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.SEARCH,
          query: "typescript",
        },
        createMockContext(),
      );

      expect(result.data?.entries).toHaveLength(1);
    });

    it("should filter search results by category", async () => {
      const frontendEntry = makeKnowledgeEntry({
        title: "React Hooks",
        content: "hooks guide",
        category: "Frontend Development",
        tags: [],
      });
      const backendEntry = makeKnowledgeEntry({
        id: "kb-backend",
        title: "NestJS Hooks",
        content: "nestjs lifecycle hooks",
        category: "Backend Development",
        tags: [],
        version: 1,
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-05"),
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        makeDbRecord(frontendEntry),
        makeDbRecord(backendEntry),
      ]);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.SEARCH,
          query: "hooks",
          filter: { category: "Frontend Development" },
        },
        createMockContext(),
      );

      expect(result.data?.entries).toHaveLength(1);
      expect(result.data?.entries?.[0].category).toBe("Frontend Development");
    });

    it("should return empty entries array when no match found", async () => {
      const entry = makeKnowledgeEntry();
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        makeDbRecord(entry),
      ]);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.SEARCH,
          query: "nonexistent_xyzzy_topic",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.entries).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // LIST operation
  // --------------------------------------------------------------------------

  describe("LIST operation", () => {
    it("should return all entries", async () => {
      const entries = [
        makeKnowledgeEntry({
          id: "kb-1",
          title: "Entry 1",
          updatedAt: new Date("2025-01-10"),
        }),
        makeKnowledgeEntry({
          id: "kb-2",
          title: "Entry 2",
          updatedAt: new Date("2025-01-05"),
        }),
      ];
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce(
        entries.map(makeDbRecord),
      );

      const result = await tool.execute(
        { operation: KnowledgeOperation.LIST },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(KnowledgeOperation.LIST);
      expect(result.data?.entries).toHaveLength(2);
      expect(result.data?.metadata?.totalCount).toBe(2);
    });

    it("should filter entries by category", async () => {
      const frontendEntry = makeKnowledgeEntry({
        id: "kb-1",
        title: "Frontend Entry",
        category: "Frontend",
        updatedAt: new Date("2025-01-10"),
      });
      const backendEntry = makeKnowledgeEntry({
        id: "kb-2",
        title: "Backend Entry",
        category: "Backend",
        updatedAt: new Date("2025-01-05"),
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        makeDbRecord(frontendEntry),
        makeDbRecord(backendEntry),
      ]);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.LIST,
          filter: { category: "Frontend" },
        },
        createMockContext(),
      );

      expect(result.data?.entries).toHaveLength(1);
      expect(result.data?.entries?.[0].category).toBe("Frontend");
    });

    it("should filter entries by tags", async () => {
      const reactEntry = makeKnowledgeEntry({
        id: "kb-1",
        title: "React Entry",
        tags: ["React", "Hooks"],
        updatedAt: new Date("2025-01-10"),
      });
      const vueEntry = makeKnowledgeEntry({
        id: "kb-2",
        title: "Vue Entry",
        tags: ["Vue"],
        updatedAt: new Date("2025-01-05"),
      });
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        makeDbRecord(reactEntry),
        makeDbRecord(vueEntry),
      ]);

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.LIST,
          filter: { tags: ["React"] },
        },
        createMockContext(),
      );

      expect(result.data?.entries).toHaveLength(1);
      expect(result.data?.entries?.[0].title).toBe("React Entry");
    });

    it("should apply limit to list results", async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeKnowledgeEntry({
          id: `kb-${i}`,
          title: `Entry ${i}`,
          updatedAt: new Date(),
        }),
      );
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce(
        entries.map(makeDbRecord),
      );

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.LIST,
          filter: { limit: 5 },
        },
        createMockContext(),
      );

      expect(result.data?.entries).toHaveLength(5);
    });
  });

  // --------------------------------------------------------------------------
  // LIST_CATEGORIES operation
  // --------------------------------------------------------------------------

  describe("LIST_CATEGORIES operation", () => {
    it("should return distinct sorted categories", async () => {
      const entries = [
        makeKnowledgeEntry({ id: "kb-1", title: "E1", category: "Frontend" }),
        makeKnowledgeEntry({ id: "kb-2", title: "E2", category: "Backend" }),
        makeKnowledgeEntry({ id: "kb-3", title: "E3", category: "Frontend" }),
        makeKnowledgeEntry({ id: "kb-4", title: "E4", category: "DevOps" }),
      ];
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce(
        entries.map(makeDbRecord),
      );

      const result = await tool.execute(
        { operation: KnowledgeOperation.LIST_CATEGORIES },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(KnowledgeOperation.LIST_CATEGORIES);
      expect(result.data?.categories).toEqual([
        "Backend",
        "DevOps",
        "Frontend",
      ]);
      expect(result.data?.metadata?.totalCount).toBe(3);
    });

    it("should return empty categories array when no entries exist", async () => {
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([]);

      const result = await tool.execute(
        { operation: KnowledgeOperation.LIST_CATEGORIES },
        createMockContext(),
      );

      expect(result.data?.categories).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // LIST_TAGS operation
  // --------------------------------------------------------------------------

  describe("LIST_TAGS operation", () => {
    it("should return distinct sorted tags from all entries", async () => {
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([
        { tags: ["React", "Hooks"] },
        { tags: ["Vue", "React"] },
        { tags: ["TypeScript"] },
      ]);

      const result = await tool.execute(
        { operation: KnowledgeOperation.LIST_TAGS },
        createMockContext(),
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(KnowledgeOperation.LIST_TAGS);
      expect(result.data?.tags).toEqual([
        "Hooks",
        "React",
        "TypeScript",
        "Vue",
      ]);
      expect(result.data?.metadata?.totalCount).toBe(4);
    });

    it("should return empty tags array when no entries exist", async () => {
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([]);

      const result = await tool.execute(
        { operation: KnowledgeOperation.LIST_TAGS },
        createMockContext(),
      );

      expect(result.data?.tags).toEqual([]);
    });

    it("should call findMany with select: { tags: true } for LIST_TAGS", async () => {
      mockPrisma.longTermMemory.findMany.mockResolvedValueOnce([]);

      await tool.execute(
        { operation: KnowledgeOperation.LIST_TAGS },
        createMockContext(),
      );

      expect(mockPrisma.longTermMemory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { tags: true },
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return error output when Prisma throws during CREATE", async () => {
      mockPrisma.longTermMemory.create.mockRejectedValueOnce(
        new Error("Database unavailable"),
      );

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.CREATE,
          entry: { title: "Test", content: "Content" },
        },
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("Database unavailable");
    });

    it("should return error output when Prisma throws during READ", async () => {
      mockPrisma.longTermMemory.findUnique.mockRejectedValueOnce(
        new Error("Connection timeout"),
      );

      const result = await tool.execute(
        {
          operation: KnowledgeOperation.READ,
          entryId: "kb-123",
        },
        createMockContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("Connection timeout");
    });
  });
});

import {
  LongTermMemoryTool,
  LongTermMemoryOperation,
} from "../long-term-memory.tool";
import { LongTermMemoryService } from "@/modules/ai-harness/memory/stores";
import { ToolContext } from "@/modules/ai-engine/tools/abstractions/tool.interface";

// ============================================================================
// Interfaces for mock return types
// ============================================================================

interface LongTermMemoryItem {
  key: string;
  value: unknown;
  type?: string;
  importance?: number;
  tags?: string[];
}

interface SearchResult {
  key: string;
  value: unknown;
  score: number;
  metadata: unknown;
}

// ============================================================================
// Mock factory
// ============================================================================

const mockMemoryService = {
  setWithUser: jest.fn() as jest.MockedFunction<
    (
      userId: string,
      key: string,
      value: unknown,
      options?: unknown,
    ) => Promise<void>
  >,
  getWithUser: jest.fn() as jest.MockedFunction<
    (userId: string, key: string) => Promise<unknown>
  >,
  search: jest.fn() as jest.MockedFunction<
    (query: string, options?: unknown) => Promise<SearchResult[]>
  >,
  deleteWithUser: jest.fn() as jest.MockedFunction<
    (userId: string, key: string) => Promise<boolean>
  >,
  list: jest.fn() as jest.MockedFunction<
    (options?: unknown) => Promise<LongTermMemoryItem[]>
  >,
  updateMetadata: jest.fn() as jest.MockedFunction<
    (key: string, metadata: unknown, userId?: string) => Promise<boolean>
  >,
};

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "long-term-memory",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("LongTermMemoryTool", () => {
  let tool: LongTermMemoryTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new LongTermMemoryTool(
      mockMemoryService as unknown as LongTermMemoryService,
    );
  });

  // --------------------------------------------------------------------------
  // STORE
  // --------------------------------------------------------------------------

  describe("STORE operation", () => {
    it("should store a value with metadata successfully", async () => {
      mockMemoryService.setWithUser.mockResolvedValueOnce(undefined);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: LongTermMemoryOperation.STORE,
          key: "pref-key",
          value: { theme: "dark" },
          userId: "user-abc",
          type: "preference",
          importance: 8,
          tags: ["ui", "settings"],
          ttl: 86400,
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(LongTermMemoryOperation.STORE);
      expect(result.data?.userId).toBe("user-abc");
      expect(mockMemoryService.setWithUser).toHaveBeenCalledWith(
        "user-abc",
        "pref-key",
        { theme: "dark" },
        {
          ttl: 86400,
          type: "preference",
          importance: 8,
          tags: ["ui", "settings"],
        },
      );
    });

    it("should use context.userId as userId when userId is not provided", async () => {
      mockMemoryService.setWithUser.mockResolvedValueOnce(undefined);
      const context = createMockContext({ userId: "ctx-user" });

      const result = await tool.execute(
        {
          operation: LongTermMemoryOperation.STORE,
          key: "knowledge-key",
          value: "some fact",
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.userId).toBe("ctx-user");
      expect(mockMemoryService.setWithUser).toHaveBeenCalledWith(
        "ctx-user",
        "knowledge-key",
        "some fact",
        expect.objectContaining({}),
      );
    });
  });

  // --------------------------------------------------------------------------
  // RETRIEVE
  // --------------------------------------------------------------------------

  describe("RETRIEVE operation", () => {
    it("should return the stored value for a known key", async () => {
      const storedEntry = {
        value: "my-fact",
        type: "knowledge",
        importance: 7,
        tags: ["science"],
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-10"),
      };
      mockMemoryService.getWithUser.mockResolvedValueOnce(storedEntry);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: LongTermMemoryOperation.RETRIEVE,
          key: "fact-key",
          userId: "user-abc",
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data).toEqual(storedEntry);
      expect(mockMemoryService.getWithUser).toHaveBeenCalledWith(
        "user-abc",
        "fact-key",
      );
    });
  });

  // --------------------------------------------------------------------------
  // SEARCH
  // --------------------------------------------------------------------------

  describe("SEARCH operation", () => {
    it("should return matching results for a search query", async () => {
      const searchResults: SearchResult[] = [
        {
          key: "ai-fact",
          value: "AI is transformative",
          score: 0.9,
          metadata: {},
        },
        { key: "ml-fact", value: "ML uses data", score: 0.7, metadata: {} },
      ];
      mockMemoryService.search.mockResolvedValueOnce(searchResults);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: LongTermMemoryOperation.SEARCH,
          query: "AI technology",
          userId: "user-abc",
          options: { threshold: 0.5, limit: 10 },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data).toEqual({
        results: searchResults,
        count: 2,
      });
      expect(mockMemoryService.search).toHaveBeenCalledWith(
        "AI technology",
        expect.objectContaining({
          userId: "user-abc",
          threshold: 0.5,
          limit: 10,
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // DELETE
  // --------------------------------------------------------------------------

  describe("DELETE operation", () => {
    it("should delete a key and return success", async () => {
      mockMemoryService.deleteWithUser.mockResolvedValueOnce(true);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: LongTermMemoryOperation.DELETE,
          key: "old-key",
          userId: "user-abc",
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data).toEqual({ deleted: true });
      expect(mockMemoryService.deleteWithUser).toHaveBeenCalledWith(
        "user-abc",
        "old-key",
      );
    });
  });

  // --------------------------------------------------------------------------
  // LIST
  // --------------------------------------------------------------------------

  describe("LIST operation", () => {
    it("should return all items sorted by importance", async () => {
      const items: LongTermMemoryItem[] = [
        { key: "k1", value: "v1", importance: 9 },
        { key: "k2", value: "v2", importance: 3 },
      ];
      mockMemoryService.list.mockResolvedValueOnce(items);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: LongTermMemoryOperation.LIST,
          userId: "user-abc",
          options: { sortBy: "importance", limit: 5 },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data).toEqual({ items, count: 2 });
      expect(mockMemoryService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-abc",
          sortBy: "importance",
          limit: 5,
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // UPDATE
  // --------------------------------------------------------------------------

  describe("UPDATE operation", () => {
    it("should update metadata for an existing key", async () => {
      mockMemoryService.updateMetadata.mockResolvedValueOnce(true);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: LongTermMemoryOperation.UPDATE,
          key: "pref-key",
          userId: "user-abc",
          importance: 10,
          tags: ["critical"],
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(LongTermMemoryOperation.UPDATE);
      expect(mockMemoryService.updateMetadata).toHaveBeenCalledWith(
        "pref-key",
        { importance: 10, tags: ["critical"] },
        "user-abc",
      );
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return false for an invalid operation string", () => {
      const valid = tool.validateInput({
        operation: "INVALID" as LongTermMemoryOperation,
        key: "k",
        value: "v",
      });
      expect(valid).toBe(false);
    });

    it("should return false for STORE without key", () => {
      const valid = tool.validateInput({
        operation: LongTermMemoryOperation.STORE,
        value: "something",
      });
      expect(valid).toBe(false);
    });

    it("should return false for SEARCH without query", () => {
      const valid = tool.validateInput({
        operation: LongTermMemoryOperation.SEARCH,
      });
      expect(valid).toBe(false);
    });

    it("should return true for valid LIST operation without key", () => {
      const valid = tool.validateInput({
        operation: LongTermMemoryOperation.LIST,
      });
      expect(valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return error output when LongTermMemoryService throws", async () => {
      mockMemoryService.getWithUser.mockRejectedValueOnce(
        new Error("Database unavailable"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: LongTermMemoryOperation.RETRIEVE,
          key: "any-key",
          userId: "user-abc",
        },
        context,
      );

      // doExecute catches and returns { success: false }, no throw propagated
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("Database unavailable");
    });
  });
});

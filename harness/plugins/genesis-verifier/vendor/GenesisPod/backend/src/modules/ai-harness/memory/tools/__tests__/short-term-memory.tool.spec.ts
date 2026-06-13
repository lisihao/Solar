import {
  ShortTermMemoryTool,
  MemoryOperation,
} from "../short-term-memory.tool";
import { ShortTermMemoryService } from "@/modules/ai-harness/memory/stores";
import { ToolContext } from "@/modules/ai-engine/tools/abstractions/tool.interface";

// ============================================================================
// Mock factory
// ============================================================================

const mockMemoryService = {
  getWithSession: jest.fn<Promise<unknown>, [string, string]>(),
  setWithSession: jest.fn<Promise<void>, [string, string, unknown, number?]>(),
  appendWithSession: jest.fn<
    Promise<void>,
    [string, string, unknown, number?]
  >(),
  deleteWithSession: jest.fn<Promise<boolean>, [string, string]>(),
  clearSession: jest.fn<Promise<void>, [string]>(),
  listSession: jest.fn<
    Promise<Array<{ key: string; value: unknown; expiresAt?: Date }>>,
    [string]
  >(),
};

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "short-term-memory",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("ShortTermMemoryTool", () => {
  let tool: ShortTermMemoryTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new ShortTermMemoryTool(
      mockMemoryService as unknown as ShortTermMemoryService,
    );
  });

  // --------------------------------------------------------------------------
  // GET
  // --------------------------------------------------------------------------

  describe("GET operation", () => {
    it("should return stored value when key exists", async () => {
      mockMemoryService.getWithSession.mockResolvedValueOnce("stored-value");
      const context = createMockContext();

      const result = await tool.execute(
        { operation: MemoryOperation.GET, key: "my-key", sessionId: "sess-1" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data).toBe("stored-value");
      expect(result.data?.operation).toBe(MemoryOperation.GET);
      expect(result.data?.sessionId).toBe("sess-1");
      expect(mockMemoryService.getWithSession).toHaveBeenCalledWith(
        "sess-1",
        "my-key",
      );
    });

    it("should return null data when key does not exist", async () => {
      mockMemoryService.getWithSession.mockResolvedValueOnce(undefined);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: MemoryOperation.GET,
          key: "missing-key",
          sessionId: "sess-1",
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // SET
  // --------------------------------------------------------------------------

  describe("SET operation", () => {
    it("should store value successfully", async () => {
      mockMemoryService.setWithSession.mockResolvedValueOnce(undefined);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: MemoryOperation.SET,
          key: "my-key",
          value: { hello: "world" },
          sessionId: "sess-1",
          ttl: 300,
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(MemoryOperation.SET);
      expect(mockMemoryService.setWithSession).toHaveBeenCalledWith(
        "sess-1",
        "my-key",
        { hello: "world" },
        300,
      );
    });

    it("should use context.executionId as sessionId when sessionId is not provided", async () => {
      mockMemoryService.setWithSession.mockResolvedValueOnce(undefined);
      const context = createMockContext({ executionId: "exec-fallback" });

      const result = await tool.execute(
        { operation: MemoryOperation.SET, key: "my-key", value: "val" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.sessionId).toBe("exec-fallback");
      expect(mockMemoryService.setWithSession).toHaveBeenCalledWith(
        "exec-fallback",
        "my-key",
        "val",
        undefined,
      );
    });
  });

  // --------------------------------------------------------------------------
  // APPEND
  // --------------------------------------------------------------------------

  describe("APPEND operation", () => {
    it("should append value to existing array", async () => {
      mockMemoryService.appendWithSession.mockResolvedValueOnce(undefined);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: MemoryOperation.APPEND,
          key: "list-key",
          value: "new-item",
          sessionId: "sess-2",
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(MemoryOperation.APPEND);
      expect(mockMemoryService.appendWithSession).toHaveBeenCalledWith(
        "sess-2",
        "list-key",
        "new-item",
        undefined,
      );
    });
  });

  // --------------------------------------------------------------------------
  // DELETE
  // --------------------------------------------------------------------------

  describe("DELETE operation", () => {
    it("should delete an existing key and return success", async () => {
      mockMemoryService.deleteWithSession.mockResolvedValueOnce(true);
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: MemoryOperation.DELETE,
          key: "my-key",
          sessionId: "sess-1",
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data).toEqual({ deleted: true });
      expect(mockMemoryService.deleteWithSession).toHaveBeenCalledWith(
        "sess-1",
        "my-key",
      );
    });
  });

  // --------------------------------------------------------------------------
  // CLEAR
  // --------------------------------------------------------------------------

  describe("CLEAR operation", () => {
    it("should clear the session and return success", async () => {
      mockMemoryService.clearSession.mockResolvedValueOnce(undefined);
      const context = createMockContext();

      const result = await tool.execute(
        { operation: MemoryOperation.CLEAR, sessionId: "sess-to-clear" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(MemoryOperation.CLEAR);
      expect(mockMemoryService.clearSession).toHaveBeenCalledWith(
        "sess-to-clear",
      );
    });
  });

  // --------------------------------------------------------------------------
  // LIST
  // --------------------------------------------------------------------------

  describe("LIST operation", () => {
    it("should return all keys in the session", async () => {
      const items = [
        { key: "k1", value: "v1" },
        { key: "k2", value: 42 },
      ];
      mockMemoryService.listSession.mockResolvedValueOnce(items);
      const context = createMockContext();

      const result = await tool.execute(
        { operation: MemoryOperation.LIST, sessionId: "sess-list" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.data).toEqual({ items, count: 2 });
      expect(mockMemoryService.listSession).toHaveBeenCalledWith("sess-list");
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return false for an invalid operation", () => {
      const valid = tool.validateInput({
        operation: "INVALID_OP" as MemoryOperation,
        key: "k",
      });
      expect(valid).toBe(false);
    });

    it("should return false when key is missing for GET operation", () => {
      const valid = tool.validateInput({ operation: MemoryOperation.GET });
      expect(valid).toBe(false);
    });

    it("should return false when value is missing for SET operation", () => {
      const valid = tool.validateInput({
        operation: MemoryOperation.SET,
        key: "my-key",
      });
      expect(valid).toBe(false);
    });

    it("should return true for valid CLEAR operation without key", () => {
      const valid = tool.validateInput({ operation: MemoryOperation.CLEAR });
      expect(valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return error output when ShortTermMemoryService throws", async () => {
      mockMemoryService.getWithSession.mockRejectedValueOnce(
        new Error("Redis connection failed"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: MemoryOperation.GET,
          key: "err-key",
          sessionId: "sess-err",
        },
        context,
      );

      // execute() wraps doExecute; doExecute catches and returns { success: false }
      // so the outer ToolResult is still success:true (no throw propagated)
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("Redis connection failed");
    });
  });
});

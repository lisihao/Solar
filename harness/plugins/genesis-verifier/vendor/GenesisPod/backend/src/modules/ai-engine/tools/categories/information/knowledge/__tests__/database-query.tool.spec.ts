/**
 * DatabaseQueryTool Unit Tests
 *
 * Tests the database-query tool in isolation by mocking PrismaService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseQueryTool, DatabaseQueryOutput } from "../database-query.tool";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-dbq-001",
    toolId: "database-query",
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

function createMockPrismaService() {
  return {
    $queryRawUnsafe: jest.fn(),
    $queryRaw: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("DatabaseQueryTool", () => {
  let tool: DatabaseQueryTool;
  let mockPrisma: ReturnType<typeof createMockPrismaService>;

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseQueryTool,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    tool = module.get<DatabaseQueryTool>(DatabaseQueryTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'database-query'", () => {
      expect(tool.id).toBe("database-query");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for a valid SELECT query", () => {
      expect(
        tool.validateInput({ query: "SELECT * FROM users LIMIT 10" }),
      ).toBe(true);
    });

    it("should return false for an empty query", () => {
      expect(tool.validateInput({ query: "" })).toBe(false);
    });

    it("should return false for a non-SELECT query", () => {
      expect(
        tool.validateInput({ query: "INSERT INTO users VALUES (1)" }),
      ).toBe(false);
    });

    it("should return false for DROP TABLE statement", () => {
      expect(tool.validateInput({ query: "SELECT 1; DROP TABLE users;" })).toBe(
        false,
      );
    });

    it("should return false for DELETE statement", () => {
      expect(
        tool.validateInput({ query: "DELETE FROM users WHERE id=1" }),
      ).toBe(false);
    });

    it("should return false for UPDATE statement", () => {
      expect(
        tool.validateInput({
          query: "SELECT 1 UNION UPDATE users SET name='x'",
        }),
      ).toBe(false);
    });

    it("should return false for TRUNCATE statement", () => {
      expect(
        tool.validateInput({ query: "SELECT 1; TRUNCATE TABLE users;" }),
      ).toBe(false);
    });

    it("should return false for limit > 1000", () => {
      expect(
        tool.validateInput({ query: "SELECT * FROM users", limit: 1001 }),
      ).toBe(false);
    });

    it("should return false for limit < 1", () => {
      expect(
        tool.validateInput({ query: "SELECT * FROM users", limit: 0 }),
      ).toBe(false);
    });

    it("should return true for limit exactly 1000", () => {
      expect(
        tool.validateInput({ query: "SELECT * FROM users", limit: 1000 }),
      ).toBe(true);
    });

    it("should return false for timeout > 300", () => {
      expect(
        tool.validateInput({ query: "SELECT * FROM users", timeout: 301 }),
      ).toBe(false);
    });

    it("should return false for query longer than 10000 chars", () => {
      const longQuery = "SELECT " + "a".repeat(10000);
      expect(tool.validateInput({ query: longQuery })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with rows and columns", async () => {
      const mockRows = [
        { id: 1, name: "Alice", active: true },
        { id: 2, name: "Bob", active: false },
      ];
      mockPrisma.$queryRawUnsafe.mockResolvedValue(mockRows);

      const result: ToolResult<DatabaseQueryOutput> = await tool.execute(
        { query: "SELECT id, name, active FROM users LIMIT 10" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.rows).toHaveLength(2);
      expect(result.data?.rowCount).toBe(2);
    });

    it("should infer column types correctly from first row", async () => {
      const mockRows = [
        {
          id: 1,
          name: "Alice",
          score: 9.5,
          active: true,
          createdAt: new Date(),
          meta: { key: "value" },
          tags: ["a", "b"],
        },
      ];
      mockPrisma.$queryRawUnsafe.mockResolvedValue(mockRows);

      const result = await tool.execute(
        { query: "SELECT * FROM users LIMIT 1" },
        makeContext(),
      );

      const columns = result.data?.columns || [];
      const colMap = Object.fromEntries(columns.map((c) => [c.name, c.type]));

      expect(colMap.id).toBe("integer");
      expect(colMap.name).toBe("string");
      expect(colMap.score).toBe("number");
      expect(colMap.active).toBe("boolean");
      expect(colMap.createdAt).toBe("datetime");
      expect(colMap.meta).toBe("object");
      expect(colMap.tags).toBe("array");
    });

    it("should append LIMIT when not already in query", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      await tool.execute(
        { query: "SELECT * FROM users", limit: 50 },
        makeContext(),
      );

      const calledQuery = mockPrisma.$queryRawUnsafe.mock.calls[0][0] as string;
      expect(calledQuery).toContain("LIMIT 50");
    });

    it("should NOT append LIMIT when already present in query", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      await tool.execute(
        { query: "SELECT * FROM users LIMIT 5" },
        makeContext(),
      );

      const calledQuery = mockPrisma.$queryRawUnsafe.mock.calls[0][0] as string;
      // Should not have LIMIT appended twice
      const limitMatches = (calledQuery.match(/LIMIT/gi) || []).length;
      expect(limitMatches).toBe(1);
    });

    it("should return empty columns when no rows returned", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await tool.execute(
        { query: "SELECT * FROM users WHERE false" },
        makeContext(),
      );

      expect(result.data?.columns).toHaveLength(0);
      expect(result.data?.rowCount).toBe(0);
    });

    it("should include executionTime in output", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: 42 }]);

      const result = await tool.execute(
        { query: "SELECT COUNT(*) as count FROM users" },
        makeContext(),
      );

      expect(result.data?.executionTime).toBeGreaterThanOrEqual(0);
    });

    it("should return executedQuery matching the cleaned query", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await tool.execute(
        { query: "SELECT * FROM users" },
        makeContext(),
      );

      expect(result.data?.executedQuery).toContain("SELECT * FROM users");
    });
  });

  // -------------------------------------------------------------------------
  // Parameterized queries
  // -------------------------------------------------------------------------

  describe("execute() - parameterized queries", () => {
    it("should pass params as positional arguments to $queryRawUnsafe", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      await tool.execute(
        {
          query: "SELECT * FROM users WHERE id = $1",
          params: { "1": "user-uuid" },
        },
        makeContext(),
      );

      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        "user-uuid",
      );
    });

    it("should pass null for missing param positions", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      await tool.execute(
        {
          query: "SELECT * FROM users WHERE id = $1 AND role = $2",
          params: { "1": "uuid-123" },
        },
        makeContext(),
      );

      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        "uuid-123",
        null,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return outer success:false when $queryRawUnsafe throws", async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValue(
        new Error("syntax error at or near 'SELEC'"),
      );

      const result = await tool.execute(
        { query: "SELECT * FROM users" },
        makeContext(),
      );

      // DatabaseQueryTool re-throws, BaseTool catches it
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Query execution failed");
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { query: "SELECT 1" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockPrisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Type inference edge cases
  // -------------------------------------------------------------------------

  describe("type inference", () => {
    it("should infer 'null' for null values", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ val: null }]);

      const result = await tool.execute(
        { query: "SELECT null as val" },
        makeContext(),
      );

      expect(result.data?.columns[0].type).toBe("null");
    });

    it("should infer 'integer' for integer numbers", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ count: 5 }]);

      const result = await tool.execute(
        { query: "SELECT count(*) as count FROM t" },
        makeContext(),
      );

      expect(result.data?.columns[0].type).toBe("integer");
    });
  });
});

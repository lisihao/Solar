/**
 * SQLExecutorTool - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Line 249: read-only mode throws when non-SELECT query is attempted in doExecute
 *  - Lines 342-349: detectQueryType for UPDATE/DELETE/CREATE/ALTER/DROP/TRUNCATE/UNKNOWN
 *  - Lines 460-476: positional parameter handling ($1, $2 style params without named params)
 */

import { SQLExecutorTool } from "../sql-executor.tool";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ToolContext } from "../../../abstractions/tool.interface";

function createMockPrisma() {
  return { $queryRawUnsafe: jest.fn() };
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "ext-exec",
    toolId: "sql-executor",
    userId: "user-ext",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("SQLExecutorTool (extended coverage)", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let tool: SQLExecutorTool;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    tool = new SQLExecutorTool(mockPrisma as unknown as PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  // =========================================================================
  // Line 249: read-only mode in doExecute
  // =========================================================================

  describe("read-only mode enforcement in doExecute (line 249)", () => {
    it("returns error when INSERT attempted with readOnly: true in options", async () => {
      // validateInput blocks this for readOnly=true (default), so we test by
      // using readOnly:false to bypass validateInput, then a readOnly tool override
      // Actually the cleanest way: bypass through a subclass that skips validateInput
      // OR use the fact that doExecute checks readOnly from options
      // With readOnly: false validateInput passes INSERT; but doExecute re-checks readOnly
      // Wait, let's check source: doExecute gets readOnly from input.options?.readOnly ?? true
      // So if we pass options: { readOnly: false } → doExecute allows INSERT

      // For readOnly path in doExecute: we need readOnly=true but validateInput passes
      // validateInput uses options.readOnly ?? true, so INSERT with readOnly=true → blocked
      // This means line 249 is reached via: validateInput uses readOnly=false but doExecute has readOnly from options

      // Actually, line 249 is in doExecute, only reached when validateInput passes.
      // validateInput for readOnly:true blocks INSERT.
      // To reach line 249, we need: validateInput passes (readOnly:false or readOnly not set for allowed op)
      // but doExecute enforces readOnly separately.

      // Looking at the source: doExecute gets readOnly from `input.options?.readOnly ?? true`
      // validateInput gets readOnly from `input.options?.readOnly ?? true`
      // So both use the same value. If validateInput passes INSERT, doExecute should too.

      // The only way to hit line 249 would be if validateInput is bypassed, which
      // we can simulate by directly calling via the protected doExecute path.
      // Let's test the error path in doExecute by overriding validateInput to return true.

      class TestTool extends SQLExecutorTool {
        override validateInput(_input: unknown): boolean {
          return true; // bypass validation
        }
      }
      const testTool = new TestTool(mockPrisma as unknown as PrismaService);

      // readOnly:true (default) + INSERT → doExecute throws at line 249
      const result = await testTool.execute(
        { query: "INSERT INTO t VALUES (1)" },
        makeContext(),
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toContain("Read-only mode");
    });
  });

  // =========================================================================
  // Lines 342-349: detectQueryType for various SQL types
  // =========================================================================

  describe("detectQueryType (lines 342-349)", () => {
    // We exercise detectQueryType through execute() for non-blocked operations

    it("recognizes UPDATE query type in metadata", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      // Need to bypass readOnly guard - use readOnly:false to allow UPDATE
      const result = await tool.execute(
        {
          query: "UPDATE users SET name = 'test' WHERE id = 1",
          options: { readOnly: false },
        },
        makeContext(),
      );

      // queryType should be UPDATE
      expect(result.data?.metadata?.queryType).toBe("UPDATE");
    });

    it("recognizes DELETE query type", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await tool.execute(
        {
          query: "DELETE FROM users WHERE id = 1",
          options: { readOnly: false },
        },
        makeContext(),
      );

      expect(result.data?.metadata?.queryType).toBe("DELETE");
    });

    it("recognizes CREATE query type", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await tool.execute(
        {
          query: "CREATE TABLE test (id INT)",
          options: { readOnly: false },
        },
        makeContext(),
      );

      expect(result.data?.metadata?.queryType).toBe("CREATE");
    });

    it("recognizes ALTER query type", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await tool.execute(
        {
          query: "ALTER TABLE users ADD COLUMN email TEXT",
          options: { readOnly: false },
        },
        makeContext(),
      );

      expect(result.data?.metadata?.queryType).toBe("ALTER");
    });

    it("recognizes TRUNCATE query type", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await tool.execute(
        {
          query: "TRUNCATE TABLE audit_log",
          options: { readOnly: false },
        },
        makeContext(),
      );

      expect(result.data?.metadata?.queryType).toBe("TRUNCATE");
    });

    it("returns UNKNOWN for unrecognized SQL keywords (line 349)", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await tool.execute(
        {
          query: "VACUUM ANALYZE users",
          options: { readOnly: false },
        },
        makeContext(),
      );

      expect(result.data?.metadata?.queryType).toBe("UNKNOWN");
    });
  });

  // =========================================================================
  // Lines 460-476: positional parameter handling ($1, $2)
  // =========================================================================

  describe("positional parameter handling (lines 460-476)", () => {
    it("handles $1 $2 style positional params from numeric keys", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ id: 1 }]);

      const result = await tool.execute(
        {
          query: "SELECT * FROM users WHERE id = $1 AND name = $2",
          parameters: { "1": 42, "2": "Alice" }, // numeric string keys
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      // Verify $queryRawUnsafe was called with the positional values
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        42,
        "Alice",
      );
    });

    it("falls back to object values order when key is not numeric string", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      // parameters without matching string-number keys
      const result = await tool.execute(
        {
          query: "SELECT * FROM items WHERE price > $1",
          parameters: { value: 100 }, // key doesn't match "1"
        },
        makeContext(),
      );

      expect(result.data?.success).toBe(true);
      // Should have passed the value from Object.values
      expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        100,
      );
    });
  });
});

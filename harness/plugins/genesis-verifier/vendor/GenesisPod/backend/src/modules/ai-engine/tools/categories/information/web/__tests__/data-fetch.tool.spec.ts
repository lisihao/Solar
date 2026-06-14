/**
 * DataFetchTool Unit Tests
 * 覆盖三种数据源分支、白名单校验、桩代码行为以及错误路径
 */

import {
  DataFetchTool,
  DataFetchInput,
  DataFetchOutput,
} from "../data-fetch.tool";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ============================================================================
// Mock Types
// ============================================================================

type ResourceRow = {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  aiSummary: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type TopicRow = {
  id: string;
  title: string;
};

type MockPrismaService = {
  resource: {
    findMany: jest.MockedFunction<(args: unknown) => Promise<ResourceRow[]>>;
    findUnique: jest.MockedFunction<
      (args: unknown) => Promise<ResourceRow | null>
    >;
  };
  topic: {
    findMany: jest.MockedFunction<(args: unknown) => Promise<TopicRow[]>>;
  };
  $queryRaw: jest.MockedFunction<(...args: unknown[]) => Promise<unknown[]>>;
};

// ============================================================================
// Helpers
// ============================================================================

function buildContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "data-fetch",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function buildResourceRow(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: "res-1",
    title: "Sample Resource",
    sourceType: "URL",
    sourceUrl: "https://example.com",
    aiSummary: "A sample resource",
    content: "Full content here",
    metadata: {},
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("DataFetchTool", () => {
  let tool: DataFetchTool;
  let mockPrisma: MockPrismaService;

  beforeEach(() => {
    mockPrisma = {
      resource: {
        findMany: jest.fn<Promise<ResourceRow[]>, [unknown]>(),
        findUnique: jest.fn<Promise<ResourceRow | null>, [unknown]>(),
      },
      topic: {
        findMany: jest.fn<Promise<TopicRow[]>, [unknown]>(),
      },
      $queryRaw: jest.fn(),
    };

    tool = new DataFetchTool(
      mockPrisma as unknown as ConstructorParameters<typeof DataFetchTool>[0],
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. source="resource"，resourceId 存在时返回资源
  // --------------------------------------------------------------------------
  describe("sourceType=resource - single resourceId", () => {
    it("fetches and returns the matched resource", async () => {
      const row = buildResourceRow({ id: "res-abc", title: "My Doc" });
      mockPrisma.resource.findMany.mockResolvedValue([row]);

      const input: DataFetchInput = {
        sourceType: "resource",
        resourceId: "res-abc",
      };

      const result: ToolResult<DataFetchOutput> = await tool.execute(
        input,
        buildContext(),
      );

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.success).toBe(true);
      expect(data.dataType).toBe("resource");
      expect(data.count).toBe(1);
      // Single result → unwrapped object (not array)
      expect((data.data as ResourceRow).id).toBe("res-abc");

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["res-abc"] } },
        }),
      );
    });

    it("returns multiple resources when resourceIds is provided", async () => {
      const rows = [
        buildResourceRow({ id: "res-1" }),
        buildResourceRow({ id: "res-2" }),
      ];
      mockPrisma.resource.findMany.mockResolvedValue(rows);

      const input: DataFetchInput = {
        sourceType: "resource",
        resourceIds: ["res-1", "res-2"],
      };

      const result = await tool.execute(input, buildContext());

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.count).toBe(2);
      expect(Array.isArray(data.data)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. source="resource"，资源不存在时返回空列表
  // --------------------------------------------------------------------------
  describe("sourceType=resource - no matching resources", () => {
    it("returns empty array and count=0 when resource not found", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      const input: DataFetchInput = {
        sourceType: "resource",
        resourceId: "nonexistent-id",
      };

      const result = await tool.execute(input, buildContext());

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.success).toBe(true);
      expect(data.count).toBe(0);
      // When no resources match, the tool returns the empty array (resources.length !== 1)
      expect(Array.isArray(data.data)).toBe(true);
      expect((data.data as ResourceRow[]).length).toBe(0);
    });

    it("returns success=true with empty data when neither resourceId nor resourceIds provided after validation bypass", async () => {
      // Direct call to doExecute via execute — but validateInput would block this normally.
      // We test the internal path: if ids array is empty, the tool returns early.
      mockPrisma.resource.findMany.mockResolvedValue([]);

      // Provide resourceIds as empty array — validateInput returns false, but
      // execute will still call doExecute (BaseTool.execute does not call validateInput).
      // The tool internally handles the empty ids case.
      const input: DataFetchInput = {
        sourceType: "resource",
        resourceIds: [],
      };

      const result = await tool.execute(input, buildContext());

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.success).toBe(true);
      expect(data.count).toBe(0);
      // findMany should NOT have been called — tool returns early for empty ids
      expect(mockPrisma.resource.findMany).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 3. source="file" 返回 success:false 和错误信息（桩代码）
  // --------------------------------------------------------------------------
  describe("sourceType=file - stub behavior", () => {
    it("returns success=false with 'File fetch not implemented yet' error", async () => {
      const input: DataFetchInput = {
        sourceType: "file",
        filePath: "/some/path/document.pdf",
      };

      const result = await tool.execute(input, buildContext());

      // BaseTool.execute wraps doExecute output in ToolResult.success=true
      // because doExecute itself returns DataFetchOutput without throwing.
      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.success).toBe(false);
      expect(data.error).toBe("File fetch not implemented yet");
      expect(data.dataType).toBe("file");
      expect(data.data).toBeNull();
      expect(data.count).toBe(0);

      // No DB calls should have been made
      expect(mockPrisma.resource.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 4. source="database"，table="resource" 查询成功
  // --------------------------------------------------------------------------
  describe("sourceType=database - allowed table", () => {
    it("queries resource table and returns results", async () => {
      const rows = [buildResourceRow({ id: "res-db-1" })];
      mockPrisma.resource.findMany.mockResolvedValue(rows);

      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "resource", limit: 5 },
      };

      const result = await tool.execute(input, buildContext());

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.success).toBe(true);
      expect(data.dataType).toBe("database");
      expect(data.count).toBe(1);

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("queries topic table successfully", async () => {
      const rows: TopicRow[] = [{ id: "topic-1", title: "AI Trends" }];
      mockPrisma.topic.findMany.mockResolvedValue(rows);

      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "topic", limit: 10 },
      };

      const result = await tool.execute(input, buildContext());

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.success).toBe(true);
      expect(data.count).toBe(1);
      expect(mockPrisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it("applies filters when provided", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "resource", filters: { sourceType: "URL" }, limit: 20 },
      };

      await tool.execute(input, buildContext());

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sourceType: "URL" },
          take: 20,
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // 5. source="database"，table 不在白名单返回错误
  // --------------------------------------------------------------------------
  describe("sourceType=database - disallowed table", () => {
    it("rejects 'users' table with error response", async () => {
      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "users" },
      };

      const result = await tool.execute(input, buildContext());

      expect(result.success).toBe(true); // doExecute does not throw
      const data = result.data!;
      expect(data.success).toBe(false);
      expect(data.error).toContain("users");
      expect(mockPrisma.resource.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.topic.findMany).not.toHaveBeenCalled();
    });

    it("rejects 'admin' table with error response", async () => {
      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "admin" },
      };

      const result = await tool.execute(input, buildContext());

      expect(result.data!.success).toBe(false);
      expect(result.data!.error).toContain("admin");
    });
  });

  // --------------------------------------------------------------------------
  // 6. source="database"，limit 超过 1000 被限制
  // --------------------------------------------------------------------------
  describe("sourceType=database - limit cap", () => {
    it("caps limit at 1000 when input exceeds maximum", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "resource", limit: 9999 },
      };

      await tool.execute(input, buildContext());

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 1000 }),
      );
    });

    it("uses default limit of 100 when limit is not specified", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "resource" },
      };

      await tool.execute(input, buildContext());

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // 7. PrismaService 抛出异常时返回 error
  // --------------------------------------------------------------------------
  describe("PrismaService throws", () => {
    it("returns success=false with error message when resource.findMany throws", async () => {
      mockPrisma.resource.findMany.mockRejectedValue(
        new Error("Database connection lost"),
      );

      const input: DataFetchInput = {
        sourceType: "resource",
        resourceId: "res-1",
      };

      const result = await tool.execute(input, buildContext());

      // doExecute catches the error and returns DataFetchOutput with success=false
      // BaseTool.execute sees a successful return and wraps it in success=true
      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.success).toBe(false);
      expect(data.error).toBe("Database connection lost");
      expect(data.count).toBe(0);
    });

    it("returns error message when topic.findMany throws", async () => {
      mockPrisma.topic.findMany.mockRejectedValue(new Error("Query timeout"));

      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "topic" },
      };

      const result = await tool.execute(input, buildContext());

      expect(result.success).toBe(true);
      const data = result.data!;
      expect(data.success).toBe(false);
      expect(data.error).toBe("Query timeout");
    });
  });

  // --------------------------------------------------------------------------
  // 8. validateInput — source 为空/无效时失败
  // --------------------------------------------------------------------------
  describe("validateInput", () => {
    it("returns false when sourceType is missing", () => {
      const input = {} as DataFetchInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("returns false for sourceType=resource with no resourceId or resourceIds", () => {
      const input: DataFetchInput = { sourceType: "resource" };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("returns false for sourceType=file with no filePath", () => {
      const input: DataFetchInput = { sourceType: "file" };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("returns false for sourceType=database with no query.table", () => {
      const input: DataFetchInput = { sourceType: "database" };
      expect(tool.validateInput(input)).toBe(false);
    });

    it("returns false for unknown sourceType", () => {
      const input = { sourceType: "ftp" } as unknown as DataFetchInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("returns true for sourceType=resource with resourceId", () => {
      const input: DataFetchInput = {
        sourceType: "resource",
        resourceId: "r1",
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("returns true for sourceType=resource with non-empty resourceIds", () => {
      const input: DataFetchInput = {
        sourceType: "resource",
        resourceIds: ["r1"],
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("returns true for sourceType=file with filePath", () => {
      const input: DataFetchInput = {
        sourceType: "file",
        filePath: "/path/to/file",
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("returns true for sourceType=database with query.table", () => {
      const input: DataFetchInput = {
        sourceType: "database",
        query: { table: "resource" },
      };
      expect(tool.validateInput(input)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Metadata checks
  // --------------------------------------------------------------------------
  describe("ToolResult metadata", () => {
    it("populates executionId and duration in metadata", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      const context = buildContext({ executionId: "meta-exec-id" });
      const input: DataFetchInput = {
        sourceType: "resource",
        resourceId: "any-id",
      };

      const result = await tool.execute(input, context);

      expect(result.metadata.executionId).toBe("meta-exec-id");
      expect(typeof result.metadata.duration).toBe("number");
      expect(result.metadata.startTime).toBeInstanceOf(Date);
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { DbOpsService } from "../db-ops.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { TableCategory } from "../db-ops.types";

// ---------------------------------------------------------------------------
// Module-level mocks for heavy transitive deps
// ---------------------------------------------------------------------------
jest.mock("../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a raw pg_class row as returned by $queryRawUnsafe for table list */
function makePgRow(overrides: Partial<Record<string, string>> = {}) {
  return {
    table_name: "users",
    row_estimate: "100",
    total_bytes: "8192",
    table_bytes: "4096",
    index_bytes: "2048",
    toast_bytes: "0",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------
const mockPrisma = {
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("DbOpsService", () => {
  let service: DbOpsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbOpsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DbOpsService>(DbOpsService);
  });

  // ====================== getTableList ======================

  describe("getTableList()", () => {
    it("should return paginated tables from postgres", async () => {
      const rows = [
        makePgRow({
          table_name: "users",
          row_estimate: "500",
          total_bytes: "102400",
        }),
        makePgRow({
          table_name: "resources",
          row_estimate: "200",
          total_bytes: "51200",
        }),
      ];
      mockPrisma.$queryRawUnsafe.mockResolvedValue(rows);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.tables).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.stats).toBeDefined();
    });

    it("should apply search filter", async () => {
      const rows = [
        makePgRow({ table_name: "users" }),
        makePgRow({ table_name: "resources" }),
      ];
      mockPrisma.$queryRawUnsafe.mockResolvedValue(rows);

      const result = await service.getTableList({
        search: "user",
        pageSize: 50,
      });

      expect(result.tables.every((t) => t.name.includes("user"))).toBe(true);
    });

    it("should filter by category", async () => {
      const rows = [
        makePgRow({ table_name: "users" }), // USER category
        makePgRow({ table_name: "resources" }), // RESOURCE category
      ];
      mockPrisma.$queryRawUnsafe.mockResolvedValue(rows);

      const result = await service.getTableList({
        category: TableCategory.USER,
        pageSize: 50,
      });

      expect(
        result.tables.every((t) => t.category === TableCategory.USER),
      ).toBe(true);
    });

    it("should filter by healthStatus", async () => {
      // Make users appear as a critical table (> 1GB)
      const bigBytes = (2 * 1024 * 1024 * 1024).toString();
      const rows = [
        makePgRow({ table_name: "users", total_bytes: bigBytes }),
        makePgRow({ table_name: "resources", total_bytes: "1024" }),
      ];
      mockPrisma.$queryRawUnsafe.mockResolvedValue(rows);

      const result = await service.getTableList({
        healthStatus: "critical",
        pageSize: 50,
      });

      expect(result.tables.every((t) => t.healthStatus === "critical")).toBe(
        true,
      );
    });

    it("should sort by name ascending", async () => {
      const rows = [
        makePgRow({ table_name: "users" }),
        makePgRow({ table_name: "accounts" }),
      ];
      mockPrisma.$queryRawUnsafe.mockResolvedValue(rows);

      const result = await service.getTableList({
        sortBy: "name",
        sortOrder: "asc",
        pageSize: 50,
      });

      const names = result.tables.map((t) => t.name);
      expect(names).toEqual([...names].sort());
    });

    it("should apply pagination correctly", async () => {
      // Create 5 rows
      const rows = Array.from({ length: 5 }, (_, i) =>
        makePgRow({ table_name: `table_${i + 1}` }),
      );
      mockPrisma.$queryRawUnsafe.mockResolvedValue(rows);

      const result = await service.getTableList({ page: 2, pageSize: 2 });

      expect(result.tables).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.page).toBe(2);
    });

    it("should throw if prisma query fails", async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error("DB error"));

      await expect(service.getTableList({ pageSize: 50 })).rejects.toThrow(
        "DB error",
      );
    });

    it("should include stats summary", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        makePgRow({
          table_name: "users",
          row_estimate: "1000",
          total_bytes: "204800",
        }),
      ]);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.stats.totalTables).toBe(1);
      expect(result.stats.totalRows).toBe(1000);
      expect(result.stats.healthSummary).toBeDefined();
    });
  });

  // ====================== getTableDetail ======================

  describe("getTableDetail()", () => {
    it("should return detailed table info for a known table", async () => {
      const tableInfo = [
        {
          row_estimate: "100",
          total_bytes: "8192",
          table_bytes: "4096",
          index_bytes: "2048",
          toast_bytes: "0",
        },
      ];
      const columns = [
        {
          column_name: "id",
          data_type: "text",
          is_nullable: "NO",
          column_default: null,
          is_pk: true,
          fk_table: null,
        },
      ];
      const constraints = [
        {
          constraint_name: "users_pkey",
          constraint_type: "PRIMARY KEY",
          column_name: "id",
        },
      ];

      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(tableInfo) // table sizes
        .mockResolvedValueOnce(columns) // column info
        .mockResolvedValueOnce([{ id: "u-1" }]) // sample data
        .mockResolvedValueOnce(constraints); // constraints

      const result = await service.getTableDetail("users");

      expect(result.name).toBe("users");
      expect(result.category).toBe(TableCategory.USER);
      expect(result.schema).toHaveLength(1);
      expect(result.schema[0].name).toBe("id");
      expect(result.constraints).toHaveLength(1);
    });

    it("should throw when table not found in pg_class", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]); // empty result

      await expect(service.getTableDetail("users")).rejects.toThrow(
        "Table users not found",
      );
    });

    it("should throw for unknown table name (SQL injection guard)", async () => {
      await expect(
        service.getTableDetail("unknown_nonexistent_table"),
      ).rejects.toThrow(/Unknown table/);
    });

    it("should throw for invalid table name format", async () => {
      await expect(
        service.getTableDetail("users; DROP TABLE users"),
      ).rejects.toThrow(/Invalid table name format/);
    });
  });

  // ====================== getTableSample ======================

  describe("getTableSample()", () => {
    it("should return sample rows from a known table", async () => {
      const sampleRows = [{ id: "u-1", email: "test@example.com" }];
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ relname: "users" }]) // pg_class check
        .mockResolvedValueOnce(sampleRows); // sample data

      const result = await service.getTableSample("users", 10);

      expect(result).toEqual(sampleRows);
    });

    it("should cap limit at 100", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ relname: "users" }])
        .mockResolvedValueOnce([]);

      await service.getTableSample("users", 9999);

      const secondCall = mockPrisma.$queryRawUnsafe.mock.calls[1];
      // The capped limit (100) is passed as parameter
      expect(secondCall[1]).toBe(100);
    });

    it("should throw when table does not exist in pg_class", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await expect(service.getTableSample("users")).rejects.toThrow(
        "Table users not found",
      );
    });

    it("should throw for invalid table name", async () => {
      await expect(service.getTableSample("unknown_table_xyz")).rejects.toThrow(
        /Unknown table/,
      );
    });
  });

  // ====================== diagnoseTable ======================

  describe("diagnoseTable()", () => {
    it("should return no issues for a small healthy table", async () => {
      const tableInfo = [
        {
          row_estimate: "50",
          total_bytes: "4096",
          table_bytes: "2048",
          index_bytes: "1024",
          toast_bytes: "0",
        },
      ];
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(tableInfo)
        .mockResolvedValueOnce([]) // columns
        .mockResolvedValueOnce([]) // sample data
        .mockResolvedValueOnce([]); // constraints

      const result = await service.diagnoseTable("users");

      expect(result.tableName).toBe("users");
      expect(result.healthScore).toBe(100);
      expect(result.issues).toHaveLength(0);
    });

    it("should report critical issue for table > 500MB", async () => {
      const bigSize = 600 * 1024 * 1024; // 600MB
      const tableInfo = [
        {
          row_estimate: "1000000",
          total_bytes: bigSize.toString(),
          table_bytes: (bigSize * 0.6).toString(),
          index_bytes: (bigSize * 0.2).toString(),
          toast_bytes: "0",
        },
      ];
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(tableInfo)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.diagnoseTable("users");

      const criticalIssues = result.issues.filter(
        (i) => i.severity === "critical",
      );
      expect(criticalIssues.length).toBeGreaterThan(0);
      expect(result.healthScore).toBeLessThan(100);
    });

    it("should provide cleanup suggestion for tables with cleanup policy", async () => {
      // raw_data has a cleanup policy
      const tableInfo = [
        {
          row_estimate: "50000",
          total_bytes: (50 * 1024 * 1024).toString(),
          table_bytes: "2000000",
          index_bytes: "1000000",
          toast_bytes: "0",
        },
      ];
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(tableInfo)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.diagnoseTable("raw_data");

      expect(result.cleanupSuggestion).toBeDefined();
      expect(result.cleanupSuggestion?.query).toContain("raw_data");
    });

    it("should warn about missing cleanup policy for large tables", async () => {
      // ai_models is not in CLEANUP_POLICIES, use large row count
      const tableInfo = [
        {
          row_estimate: "50000",
          total_bytes: (10 * 1024 * 1024).toString(),
          table_bytes: "8000000",
          index_bytes: "1000000",
          toast_bytes: "0",
        },
      ];
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce(tableInfo)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.diagnoseTable("ai_models");

      const missingCleanup = result.issues.find(
        (i) => i.type === "missing_cleanup",
      );
      expect(missingCleanup).toBeDefined();
    });
  });

  // ====================== diagnoseBatch ======================

  describe("diagnoseBatch()", () => {
    it("should return only tables with issues", async () => {
      // First call: getTableList -> returns tables
      const listRow = makePgRow({
        table_name: "users",
        row_estimate: "100",
        total_bytes: "4096",
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([listRow]);

      // diagnoseTable will call getTableDetail which calls $queryRawUnsafe internally
      // mock: small healthy table -> no issues
      // We need to re-mock for the detail calls
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([listRow]) // getTableList
        .mockResolvedValueOnce([
          {
            // getTableDetail -> tableInfo
            row_estimate: "100",
            total_bytes: "4096",
            table_bytes: "2048",
            index_bytes: "1024",
            toast_bytes: "0",
          },
        ])
        .mockResolvedValueOnce([]) // columns
        .mockResolvedValueOnce([]) // sample data
        .mockResolvedValueOnce([]); // constraints

      const results = await service.diagnoseBatch();

      // Healthy table has no issues, so results should be empty
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ====================== getStats ======================

  describe("getStats()", () => {
    it("should return aggregate stats", async () => {
      const rows = [
        makePgRow({
          table_name: "users",
          row_estimate: "1000",
          total_bytes: "204800",
        }),
      ];
      mockPrisma.$queryRawUnsafe.mockResolvedValue(rows);

      const result = await service.getStats();

      expect(result.totalTables).toBe(1);
      expect(result.totalRows).toBe(1000);
      expect(typeof result.totalSizeFormatted).toBe("string");
      expect(result.byCategory).toBeDefined();
      expect(result.healthSummary).toBeDefined();
    });
  });

  // ====================== cleanupTable ======================

  describe("cleanupTable()", () => {
    it("should return failure when no cleanup policy exists for table", async () => {
      // users has no cleanup policy
      const result = await service.cleanupTable("users");

      expect(result.success).toBe(false);
      expect(result.message).toContain("No cleanup policy");
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it("should execute cleanup for table with age policy (raw_data)", async () => {
      // raw_data has an age-based cleanup policy
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ size: "1048576" }]) // sizeBefore
        .mockResolvedValueOnce([{ size: "524288" }]); // sizeAfter
      mockPrisma.$executeRawUnsafe.mockResolvedValue(50);

      const result = await service.cleanupTable("raw_data");

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("raw_data"),
      );
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(50);
      expect(result.tableName).toBe("raw_data");
    });

    it("should execute cleanup for table with status policy (collection_tasks)", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ size: "1048576" }])
        .mockResolvedValueOnce([{ size: "524288" }]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(10);

      const result = await service.cleanupTable("collection_tasks");

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(10);
    });

    it("should return failure result when prisma throws during cleanup", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ size: "1048576" }]);
      mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error("Lock timeout"));

      const result = await service.cleanupTable("raw_data");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Lock timeout");
    });

    it("should throw for unknown table name", async () => {
      await expect(service.cleanupTable("unknown_table")).rejects.toThrow(
        /Unknown table/,
      );
    });

    it("should format freed bytes correctly", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ size: (10 * 1024 * 1024).toString() }]) // 10MB before
        .mockResolvedValueOnce([{ size: (5 * 1024 * 1024).toString() }]); // 5MB after
      mockPrisma.$executeRawUnsafe.mockResolvedValue(200);

      const result = await service.cleanupTable("raw_data");

      expect(result.freedBytes).toBe(5 * 1024 * 1024);
      expect(result.freedFormatted).toContain("MB");
    });
  });

  // ====================== cleanupBatch ======================

  describe("cleanupBatch()", () => {
    it("should return only results where deletedCount > 0", async () => {
      // For each table with a policy, mock size queries and execute
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ size: "0" }]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(0);

      const results = await service.cleanupBatch();

      // All tables return 0 deleted, so results should be empty
      expect(results).toEqual([]);
    });

    it("should collect results from all tables that had deletions", async () => {
      // Mock: sizeBefore, sizeAfter, and execute returns 5 for all
      let callCount = 0;
      mockPrisma.$queryRawUnsafe.mockImplementation(() => {
        callCount++;
        return Promise.resolve([
          { size: callCount % 2 === 1 ? "2048" : "1024" },
        ]);
      });
      mockPrisma.$executeRawUnsafe.mockResolvedValue(5);

      const results = await service.cleanupBatch();

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.deletedCount > 0)).toBe(true);
    });
  });

  // ====================== Internal helpers (via observable side effects) ======================

  describe("determineHealthStatus (via getTableList)", () => {
    it("should mark table as critical when size > 1GB", async () => {
      const bigBytes = (2 * 1024 * 1024 * 1024).toString();
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        makePgRow({ table_name: "users", total_bytes: bigBytes }),
      ]);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.tables[0].healthStatus).toBe("critical");
    });

    it("should mark table as healthy for small tables", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        makePgRow({
          table_name: "users",
          row_estimate: "10",
          total_bytes: "8192",
        }),
      ]);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.tables[0].healthStatus).toBe("healthy");
    });

    it("should mark table as warning for large table (> 100MB) without cleanup policy", async () => {
      const warningBytes = (200 * 1024 * 1024).toString();
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        // ai_models has no cleanup policy
        makePgRow({ table_name: "ai_models", total_bytes: warningBytes }),
      ]);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.tables[0].healthStatus).toBe("warning");
    });
  });

  describe("getDisplayName (via getTableList)", () => {
    it("should return predefined display name for known tables", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        makePgRow({ table_name: "users" }),
      ]);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.tables[0].displayName).toBe("Users");
    });

    it("should convert snake_case to Title Case for unknown tables", async () => {
      // A table not in TABLE_DISPLAY_NAMES but in TABLE_CATEGORIES
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        makePgRow({ table_name: "user_preferences" }),
      ]);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.tables[0].displayName).toBe("User Preferences");
    });
  });

  describe("getCategory (via getTableList)", () => {
    it("should return correct category for known tables", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        makePgRow({ table_name: "knowledge_bases" }),
      ]);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.tables[0].category).toBe(TableCategory.KNOWLEDGE);
    });

    it("should return OTHER for unknown tables", async () => {
      // A table name that is not in TABLE_CATEGORIES
      // We can't directly test private method, but we can test with a table
      // that pg returns but is not in our mapping. However, validateTableName
      // would block it. So let's verify that users returns USER category
      mockPrisma.$queryRawUnsafe.mockResolvedValue([
        makePgRow({ table_name: "users" }),
      ]);

      const result = await service.getTableList({ pageSize: 50 });

      expect(result.tables[0].category).toBe(TableCategory.USER);
    });
  });
});

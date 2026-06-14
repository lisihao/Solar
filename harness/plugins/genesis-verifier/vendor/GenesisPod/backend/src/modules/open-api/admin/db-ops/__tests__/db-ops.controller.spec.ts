import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";
import { DbOpsController } from "../db-ops.controller";
import { DbOpsService } from "@/modules/platform/db-ops/db-ops.service";
import {
  TableListResponseDto,
  TableDetailDto,
  TableDiagnosisDto,
  CleanupResultDto,
  TableStatsDto,
} from "@/modules/open-api/admin/db-ops/dto/table-info.dto";

describe("DbOpsController", () => {
  let controller: DbOpsController;
  let service: jest.Mocked<DbOpsService>;

  const mockTableStats: TableStatsDto = {
    totalTables: 10,
    totalRows: 50000,
    totalSize: "500 MB",
    healthyTables: 8,
    tablesWithIssues: 2,
  } as unknown as TableStatsDto;

  const mockTableList: TableListResponseDto = {
    tables: [],
    total: 0,
    page: 1,
    pageSize: 50,
    stats: mockTableStats,
  } as unknown as TableListResponseDto;

  const mockTableDetail: TableDetailDto = {
    name: "users",
    rowCount: 1000,
    size: "10 MB",
  } as unknown as TableDetailDto;

  const mockDiagnosis: TableDiagnosisDto = {
    tableName: "users",
    issues: [],
  } as unknown as TableDiagnosisDto;

  const mockCleanupResult: CleanupResultDto = {
    tableName: "users",
    rowsDeleted: 0,
    success: true,
  } as unknown as CleanupResultDto;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DbOpsController],
      providers: [
        {
          provide: DbOpsService,
          useValue: {
            getTableList: jest.fn().mockResolvedValue(mockTableList),
            getStats: jest.fn().mockResolvedValue(mockTableStats),
            diagnoseBatch: jest.fn().mockResolvedValue([mockDiagnosis]),
            cleanupBatch: jest.fn().mockResolvedValue([mockCleanupResult]),
            getTableDetail: jest.fn().mockResolvedValue(mockTableDetail),
            getTableSample: jest.fn().mockResolvedValue([]),
            diagnoseTable: jest.fn().mockResolvedValue(mockDiagnosis),
            cleanupTable: jest.fn().mockResolvedValue(mockCleanupResult),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DbOpsController>(DbOpsController);
    service = module.get(DbOpsService);
  });

  describe("getTableList", () => {
    it("should return table list with default pagination", async () => {
      const result = await controller.getTableList();
      expect(service.getTableList).toHaveBeenCalledWith({
        search: undefined,
        category: undefined,
        sortBy: undefined,
        sortOrder: undefined,
        page: 1,
        pageSize: 50,
        healthStatus: undefined,
      });
      expect(result).toBe(mockTableList);
    });

    it("should parse page and pageSize from query strings", async () => {
      const result = await controller.getTableList(
        "user",
        undefined,
        undefined,
        "asc",
        "2",
        "25",
        undefined,
      );
      expect(service.getTableList).toHaveBeenCalledWith({
        search: "user",
        category: undefined,
        sortBy: undefined,
        sortOrder: "asc",
        page: 2,
        pageSize: 25,
        healthStatus: undefined,
      });
      expect(result).toBe(mockTableList);
    });
  });

  describe("getStats", () => {
    it("should return table statistics", async () => {
      const result = await controller.getStats();
      expect(service.getStats).toHaveBeenCalled();
      expect(result).toBe(mockTableStats);
    });
  });

  describe("diagnoseBatch", () => {
    it("should return batch diagnosis results", async () => {
      const result = await controller.diagnoseBatch();
      expect(service.diagnoseBatch).toHaveBeenCalled();
      expect(result).toEqual([mockDiagnosis]);
    });
  });

  describe("cleanupBatch", () => {
    it("should return batch cleanup results wrapped in results key", async () => {
      const result = await controller.cleanupBatch();
      expect(service.cleanupBatch).toHaveBeenCalled();
      expect(result).toEqual({ results: [mockCleanupResult] });
    });
  });

  describe("getTableDetail", () => {
    it("should return table detail for a given name", async () => {
      const result = await controller.getTableDetail("users");
      expect(service.getTableDetail).toHaveBeenCalledWith("users");
      expect(result).toBe(mockTableDetail);
    });

    it("should throw BadRequestException when name is empty", async () => {
      await expect(controller.getTableDetail("")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("getTableSample", () => {
    it("should return sample data with default limit", async () => {
      service.getTableSample.mockResolvedValue([{ id: 1 }]);
      const result = await controller.getTableSample("users");
      expect(service.getTableSample).toHaveBeenCalledWith("users", 10);
      expect(result).toEqual([{ id: 1 }]);
    });

    it("should pass parsed limit to service", async () => {
      service.getTableSample.mockResolvedValue([]);
      await controller.getTableSample("users", "5");
      expect(service.getTableSample).toHaveBeenCalledWith("users", 5);
    });

    it("should throw BadRequestException when name is empty", async () => {
      await expect(controller.getTableSample("")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("diagnoseTable", () => {
    it("should return diagnosis for a specific table", async () => {
      const result = await controller.diagnoseTable("users");
      expect(service.diagnoseTable).toHaveBeenCalledWith("users");
      expect(result).toBe(mockDiagnosis);
    });

    it("should throw BadRequestException when name is empty", async () => {
      await expect(controller.diagnoseTable("")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("cleanupTable", () => {
    it("should return cleanup result for a specific table", async () => {
      const result = await controller.cleanupTable("users");
      expect(service.cleanupTable).toHaveBeenCalledWith("users");
      expect(result).toBe(mockCleanupResult);
    });

    it("should throw BadRequestException when name is empty", async () => {
      await expect(controller.cleanupTable("")).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

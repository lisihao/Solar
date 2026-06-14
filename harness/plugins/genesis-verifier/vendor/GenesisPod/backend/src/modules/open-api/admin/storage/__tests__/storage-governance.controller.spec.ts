/**
 * StorageGovernanceController unit tests
 *
 * Route: "storage", @Public()
 * Auth:  every endpoint validates x-admin-key header via safeCompare(key, STORAGE_ADMIN_KEY)
 *        invalid key → BadRequestException("Invalid admin key")
 *
 * Endpoints:
 * - GET  /stats                     → getStorageStats()
 * - POST /cleanup/images            → cleanupImages(keep)
 * - POST /cleanup/raw-data          → cleanupOldRawData(days)
 * - POST /cleanup/collection-tasks  → cleanupOldCollectionTasks(days)
 * - POST /cleanup/import-tasks      → cleanupOldImportTasks(days)
 * - POST /cleanup/metadata          → cleanupExpiredMetadata()
 * - POST /cleanup/user-activities   → cleanupOldUserActivities(days)
 * - POST /cleanup/ask-sessions      → cleanupOldAskSessions(days)
 * - POST /cleanup/office-documents  → cleanupOldOfficeDocuments(days)
 * - POST /cleanup/slides            → cleanupOldSlides(days)
 * - POST /cleanup/knowledge-base    → cleanupKnowledgeBase(id)
 * - POST /cleanup/orphaned-rag      → cleanupOrphanedRagData()
 * - POST /cleanup/all               → runFullCleanup()
 * - GET  /database-analysis         → getDatabaseAnalysis()
 * - POST /vacuum                    → vacuumDatabase()
 * - POST /vacuum-full-all           → vacuumFullAll()
 * - POST /vacuum-full               → vacuumFullTable(tableName)
 * - POST /cleanup-wal               → cleanupWAL()
 * - GET  /disk-usage                → getFullDiskUsage()
 * - GET  /node-memory               → getNodeMemoryStats()  (sync)
 * - GET  /system-memory             → getSystemMemoryStats() (sync)
 * - DELETE /images/all              → deleteAllImages()
 * - DELETE /raw-data/all            → deleteAllRawData()
 * - DELETE /office-documents/all    → deleteAllOfficeDocuments()
 * - DELETE /slides/all              → deleteAllSlides()
 * - DELETE /knowledge-base/all      → deleteAllKnowledgeBaseData()
 */

// Module-level mocks to prevent transitive import failures
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }));
jest.mock("cache-manager", () => ({}));
jest.mock("ioredis", () => ({}));

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageGovernanceController } from "../storage-governance.controller";
import { StorageGovernanceService } from "@/modules/platform/storage/governance/storage-governance.service";
import type {
  StorageStats,
  CleanupResult,
  DatabaseAnalysis,
  NodeMemoryStats,
  SystemMemoryStats,
} from "../storage-governance.service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_KEY = "test-admin-key";
const INVALID_KEY = "wrong-key";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeCleanupResult(category = "test"): CleanupResult {
  return {
    success: true,
    category,
    deletedCount: 10,
    freedSizeMB: 5,
    message: `Cleaned ${category}`,
  };
}

function makeStorageStats(): StorageStats {
  return {
    totalCategories: 3,
    totalRecords: 100,
    estimatedTotalSizeMB: 50,
    categories: [],
    recommendations: [],
  };
}

function makeDatabaseAnalysis(): DatabaseAnalysis {
  return {
    totalDatabaseSizeMB: 200,
    tables: [],
    largestTables: [],
    recommendations: [],
  };
}

function makeNodeMemoryStats(): NodeMemoryStats {
  return {
    heapUsed: 100,
    heapTotal: 200,
    heapUsedPercent: 50,
    rss: 150,
    external: 10,
    arrayBuffers: 5,
    uptime: 3600,
    pid: 1234,
    nodeVersion: "v18.0.0",
    status: "healthy",
    warnings: [],
  };
}

function makeSystemMemoryStats(): SystemMemoryStats {
  return {
    totalMemory: 8,
    freeMemory: 4,
    usedMemory: 4,
    usedPercent: 50,
    platform: "linux",
    cpuCount: 4,
    loadAverage: [0.5, 0.6, 0.7],
    hostname: "server-1",
    status: "healthy",
  };
}

// ---------------------------------------------------------------------------
// Mock StorageGovernanceService
// ---------------------------------------------------------------------------

const mockStorageService = {
  getStorageStats: jest.fn(),
  cleanupImages: jest.fn(),
  deleteAllImages: jest.fn(),
  cleanupOldRawData: jest.fn(),
  deleteAllRawData: jest.fn(),
  cleanupOldCollectionTasks: jest.fn(),
  cleanupOldImportTasks: jest.fn(),
  cleanupExpiredMetadata: jest.fn(),
  cleanupOldUserActivities: jest.fn(),
  cleanupOldAskSessions: jest.fn(),
  cleanupOldOfficeDocuments: jest.fn(),
  deleteAllOfficeDocuments: jest.fn(),
  cleanupOldSlides: jest.fn(),
  deleteAllSlides: jest.fn(),
  cleanupKnowledgeBase: jest.fn(),
  cleanupOrphanedRagData: jest.fn(),
  deleteAllKnowledgeBaseData: jest.fn(),
  runFullCleanup: jest.fn(),
  getDatabaseAnalysis: jest.fn(),
  vacuumDatabase: jest.fn(),
  vacuumFullAll: jest.fn(),
  vacuumFullTable: jest.fn(),
  cleanupWAL: jest.fn(),
  getFullDiskUsage: jest.fn(),
  getNodeMemoryStats: jest.fn(),
  getSystemMemoryStats: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("StorageGovernanceController", () => {
  let controller: StorageGovernanceController;

  beforeAll(() => {
    process.env.STORAGE_ADMIN_KEY = VALID_KEY;
  });

  afterAll(() => {
    delete process.env.STORAGE_ADMIN_KEY;
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageGovernanceController],
      providers: [
        { provide: StorageGovernanceService, useValue: mockStorageService },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => process.env[key] },
        },
      ],
    }).compile();

    controller = module.get<StorageGovernanceController>(
      StorageGovernanceController,
    );
  });

  // -------------------------------------------------------------------------
  // GET /stats → getStorageStats
  // -------------------------------------------------------------------------

  describe("getStorageStats()", () => {
    it("returns storage stats when key is valid", async () => {
      const stats = makeStorageStats();
      mockStorageService.getStorageStats.mockResolvedValue(stats);

      const result = await controller.getStorageStats(VALID_KEY);

      expect(mockStorageService.getStorageStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual(stats);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.getStorageStats(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.getStorageStats).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/images → cleanupImages
  // -------------------------------------------------------------------------

  describe("cleanupImages()", () => {
    it("calls cleanupImages with default keepPerUser=20 when omitted", async () => {
      const result = makeCleanupResult("images");
      mockStorageService.cleanupImages.mockResolvedValue(result);

      const response = await controller.cleanupImages(VALID_KEY, undefined);

      expect(mockStorageService.cleanupImages).toHaveBeenCalledWith(20);
      expect(response).toEqual(result);
    });

    it("calls cleanupImages with parsed keepPerUser when provided", async () => {
      const result = makeCleanupResult("images");
      mockStorageService.cleanupImages.mockResolvedValue(result);

      const response = await controller.cleanupImages(VALID_KEY, "5");

      expect(mockStorageService.cleanupImages).toHaveBeenCalledWith(5);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupImages(INVALID_KEY, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.cleanupImages).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /images/all → deleteAllImages
  // -------------------------------------------------------------------------

  describe("deleteAllImages()", () => {
    it("returns cleanup result when key is valid", async () => {
      const result = makeCleanupResult("images-all");
      mockStorageService.deleteAllImages.mockResolvedValue(result);

      const response = await controller.deleteAllImages(VALID_KEY);

      expect(mockStorageService.deleteAllImages).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.deleteAllImages(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.deleteAllImages).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/raw-data → cleanupRawData
  // -------------------------------------------------------------------------

  describe("cleanupRawData()", () => {
    it("calls cleanupOldRawData with default daysOld=30 when omitted", async () => {
      const result = makeCleanupResult("raw-data");
      mockStorageService.cleanupOldRawData.mockResolvedValue(result);

      const response = await controller.cleanupRawData(VALID_KEY, undefined);

      expect(mockStorageService.cleanupOldRawData).toHaveBeenCalledWith(30);
      expect(response).toEqual(result);
    });

    it("calls cleanupOldRawData with parsed daysOld when provided", async () => {
      const result = makeCleanupResult("raw-data");
      mockStorageService.cleanupOldRawData.mockResolvedValue(result);

      const response = await controller.cleanupRawData(VALID_KEY, "14");

      expect(mockStorageService.cleanupOldRawData).toHaveBeenCalledWith(14);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupRawData(INVALID_KEY, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.cleanupOldRawData).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /raw-data/all → deleteAllRawData
  // -------------------------------------------------------------------------

  describe("deleteAllRawData()", () => {
    it("returns cleanup result when key is valid", async () => {
      const result = makeCleanupResult("raw-data-all");
      mockStorageService.deleteAllRawData.mockResolvedValue(result);

      const response = await controller.deleteAllRawData(VALID_KEY);

      expect(mockStorageService.deleteAllRawData).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.deleteAllRawData(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.deleteAllRawData).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/collection-tasks → cleanupCollectionTasks
  // -------------------------------------------------------------------------

  describe("cleanupCollectionTasks()", () => {
    it("calls cleanupOldCollectionTasks with default daysOld=7 when omitted", async () => {
      const result = makeCleanupResult("collection-tasks");
      mockStorageService.cleanupOldCollectionTasks.mockResolvedValue(result);

      const response = await controller.cleanupCollectionTasks(
        VALID_KEY,
        undefined,
      );

      expect(mockStorageService.cleanupOldCollectionTasks).toHaveBeenCalledWith(
        7,
      );
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupCollectionTasks(INVALID_KEY, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockStorageService.cleanupOldCollectionTasks,
      ).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/import-tasks → cleanupImportTasks
  // -------------------------------------------------------------------------

  describe("cleanupImportTasks()", () => {
    it("calls cleanupOldImportTasks with default daysOld=7 when omitted", async () => {
      const result = makeCleanupResult("import-tasks");
      mockStorageService.cleanupOldImportTasks.mockResolvedValue(result);

      const response = await controller.cleanupImportTasks(
        VALID_KEY,
        undefined,
      );

      expect(mockStorageService.cleanupOldImportTasks).toHaveBeenCalledWith(7);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupImportTasks(INVALID_KEY, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.cleanupOldImportTasks).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/metadata → cleanupMetadata
  // -------------------------------------------------------------------------

  describe("cleanupMetadata()", () => {
    it("calls cleanupExpiredMetadata when key is valid", async () => {
      const result = makeCleanupResult("metadata");
      mockStorageService.cleanupExpiredMetadata.mockResolvedValue(result);

      const response = await controller.cleanupMetadata(VALID_KEY);

      expect(mockStorageService.cleanupExpiredMetadata).toHaveBeenCalledTimes(
        1,
      );
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.cleanupMetadata(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.cleanupExpiredMetadata).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/user-activities → cleanupUserActivities
  // -------------------------------------------------------------------------

  describe("cleanupUserActivities()", () => {
    it("calls cleanupOldUserActivities with default daysOld=30 when omitted", async () => {
      const result = makeCleanupResult("user-activities");
      mockStorageService.cleanupOldUserActivities.mockResolvedValue(result);

      const response = await controller.cleanupUserActivities(
        VALID_KEY,
        undefined,
      );

      expect(mockStorageService.cleanupOldUserActivities).toHaveBeenCalledWith(
        30,
      );
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupUserActivities(INVALID_KEY, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockStorageService.cleanupOldUserActivities,
      ).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/ask-sessions → cleanupAskSessions
  // -------------------------------------------------------------------------

  describe("cleanupAskSessions()", () => {
    it("calls cleanupOldAskSessions with default daysOld=30 when omitted", async () => {
      const result = makeCleanupResult("ask-sessions");
      mockStorageService.cleanupOldAskSessions.mockResolvedValue(result);

      const response = await controller.cleanupAskSessions(
        VALID_KEY,
        undefined,
      );

      expect(mockStorageService.cleanupOldAskSessions).toHaveBeenCalledWith(30);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupAskSessions(INVALID_KEY, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.cleanupOldAskSessions).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/office-documents → cleanupOfficeDocuments
  // -------------------------------------------------------------------------

  describe("cleanupOfficeDocuments()", () => {
    it("calls cleanupOldOfficeDocuments with default daysOld=7 when omitted", async () => {
      const result = makeCleanupResult("office-documents");
      mockStorageService.cleanupOldOfficeDocuments.mockResolvedValue(result);

      const response = await controller.cleanupOfficeDocuments(
        VALID_KEY,
        undefined,
      );

      expect(mockStorageService.cleanupOldOfficeDocuments).toHaveBeenCalledWith(
        7,
      );
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupOfficeDocuments(INVALID_KEY, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockStorageService.cleanupOldOfficeDocuments,
      ).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /office-documents/all → deleteAllOfficeDocuments
  // -------------------------------------------------------------------------

  describe("deleteAllOfficeDocuments()", () => {
    it("calls deleteAllOfficeDocuments when key is valid", async () => {
      const result = makeCleanupResult("office-documents-all");
      mockStorageService.deleteAllOfficeDocuments.mockResolvedValue(result);

      const response = await controller.deleteAllOfficeDocuments(VALID_KEY);

      expect(mockStorageService.deleteAllOfficeDocuments).toHaveBeenCalledTimes(
        1,
      );
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.deleteAllOfficeDocuments(INVALID_KEY),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockStorageService.deleteAllOfficeDocuments,
      ).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/slides → cleanupSlides
  // -------------------------------------------------------------------------

  describe("cleanupSlides()", () => {
    it("calls cleanupOldSlides with default daysOld=7 when omitted", async () => {
      const result = makeCleanupResult("slides");
      mockStorageService.cleanupOldSlides.mockResolvedValue(result);

      const response = await controller.cleanupSlides(VALID_KEY, undefined);

      expect(mockStorageService.cleanupOldSlides).toHaveBeenCalledWith(7);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupSlides(INVALID_KEY, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.cleanupOldSlides).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /slides/all → deleteAllSlides
  // -------------------------------------------------------------------------

  describe("deleteAllSlides()", () => {
    it("calls deleteAllSlides when key is valid", async () => {
      const result = makeCleanupResult("slides-all");
      mockStorageService.deleteAllSlides.mockResolvedValue(result);

      const response = await controller.deleteAllSlides(VALID_KEY);

      expect(mockStorageService.deleteAllSlides).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.deleteAllSlides(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.deleteAllSlides).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/knowledge-base → cleanupKnowledgeBase
  // -------------------------------------------------------------------------

  describe("cleanupKnowledgeBase()", () => {
    it("calls cleanupKnowledgeBase with the provided ID when key is valid", async () => {
      const result = makeCleanupResult("knowledge-base");
      mockStorageService.cleanupKnowledgeBase.mockResolvedValue(result);

      const response = await controller.cleanupKnowledgeBase(
        VALID_KEY,
        "kb-123",
      );

      expect(mockStorageService.cleanupKnowledgeBase).toHaveBeenCalledWith(
        "kb-123",
      );
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when knowledge base ID is missing", async () => {
      await expect(
        controller.cleanupKnowledgeBase(VALID_KEY, ""),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.cleanupKnowledgeBase).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupKnowledgeBase(INVALID_KEY, "kb-123"),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.cleanupKnowledgeBase).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/orphaned-rag → cleanupOrphanedRagData
  // -------------------------------------------------------------------------

  describe("cleanupOrphanedRagData()", () => {
    it("calls cleanupOrphanedRagData when key is valid", async () => {
      const result = makeCleanupResult("orphaned-rag");
      mockStorageService.cleanupOrphanedRagData.mockResolvedValue(result);

      const response = await controller.cleanupOrphanedRagData(VALID_KEY);

      expect(mockStorageService.cleanupOrphanedRagData).toHaveBeenCalledTimes(
        1,
      );
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.cleanupOrphanedRagData(INVALID_KEY),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.cleanupOrphanedRagData).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /knowledge-base/all → deleteAllKnowledgeBaseData
  // -------------------------------------------------------------------------

  describe("deleteAllKnowledgeBaseData()", () => {
    it("calls deleteAllKnowledgeBaseData when key is valid", async () => {
      const result = makeCleanupResult("knowledge-base-all");
      mockStorageService.deleteAllKnowledgeBaseData.mockResolvedValue(result);

      const response = await controller.deleteAllKnowledgeBaseData(VALID_KEY);

      expect(
        mockStorageService.deleteAllKnowledgeBaseData,
      ).toHaveBeenCalledTimes(1);
      expect(response).toEqual(result);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.deleteAllKnowledgeBaseData(INVALID_KEY),
      ).rejects.toThrow(BadRequestException);
      expect(
        mockStorageService.deleteAllKnowledgeBaseData,
      ).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup/all → runFullCleanup
  // -------------------------------------------------------------------------

  describe("runFullCleanup()", () => {
    it("returns full cleanup summary when key is valid", async () => {
      const summary = {
        success: true,
        results: [makeCleanupResult("images"), makeCleanupResult("raw-data")],
        totalDeleted: 20,
        totalFreedMB: 10,
      };
      mockStorageService.runFullCleanup.mockResolvedValue(summary);

      const response = await controller.runFullCleanup(VALID_KEY);

      expect(mockStorageService.runFullCleanup).toHaveBeenCalledTimes(1);
      expect(response).toEqual(summary);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.runFullCleanup(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.runFullCleanup).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // GET /database-analysis → getDatabaseAnalysis
  // -------------------------------------------------------------------------

  describe("getDatabaseAnalysis()", () => {
    it("returns database analysis when key is valid", async () => {
      const analysis = makeDatabaseAnalysis();
      mockStorageService.getDatabaseAnalysis.mockResolvedValue(analysis);

      const response = await controller.getDatabaseAnalysis(VALID_KEY);

      expect(mockStorageService.getDatabaseAnalysis).toHaveBeenCalledTimes(1);
      expect(response).toEqual(analysis);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.getDatabaseAnalysis(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.getDatabaseAnalysis).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /vacuum → vacuumDatabase
  // -------------------------------------------------------------------------

  describe("vacuumDatabase()", () => {
    it("returns vacuum result when key is valid", async () => {
      const vacuumResult = {
        success: true,
        message: "VACUUM ANALYZE completed",
      };
      mockStorageService.vacuumDatabase.mockResolvedValue(vacuumResult);

      const response = await controller.vacuumDatabase(VALID_KEY);

      expect(mockStorageService.vacuumDatabase).toHaveBeenCalledTimes(1);
      expect(response).toEqual(vacuumResult);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.vacuumDatabase(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.vacuumDatabase).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /vacuum-full-all → vacuumFullAll
  // -------------------------------------------------------------------------

  describe("vacuumFullAll()", () => {
    it("returns vacuum-full-all result when key is valid", async () => {
      const vacuumResult = {
        success: true,
        message: "VACUUM FULL completed on all tables",
        results: [{ table: "users", beforeMB: 10, afterMB: 8, freedMB: 2 }],
        totalFreedMB: 2,
      };
      mockStorageService.vacuumFullAll.mockResolvedValue(vacuumResult);

      const response = await controller.vacuumFullAll(VALID_KEY);

      expect(mockStorageService.vacuumFullAll).toHaveBeenCalledTimes(1);
      expect(response).toEqual(vacuumResult);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.vacuumFullAll(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.vacuumFullAll).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /vacuum-full → vacuumFullTable
  // -------------------------------------------------------------------------

  describe("vacuumFullTable()", () => {
    it("calls vacuumFullTable with the provided table name", async () => {
      const vacuumResult = {
        success: true,
        message: "VACUUM FULL completed",
        beforeMB: 10,
        afterMB: 7,
      };
      mockStorageService.vacuumFullTable.mockResolvedValue(vacuumResult);

      const response = await controller.vacuumFullTable(VALID_KEY, "users");

      expect(mockStorageService.vacuumFullTable).toHaveBeenCalledWith("users");
      expect(response).toEqual(vacuumResult);
    });

    it("throws BadRequestException when table name is missing", async () => {
      await expect(controller.vacuumFullTable(VALID_KEY, "")).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.vacuumFullTable).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(
        controller.vacuumFullTable(INVALID_KEY, "users"),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.vacuumFullTable).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // POST /cleanup-wal → cleanupWAL
  // -------------------------------------------------------------------------

  describe("cleanupWAL()", () => {
    it("returns WAL cleanup result when key is valid", async () => {
      const walResult = { success: true, message: "CHECKPOINT completed" };
      mockStorageService.cleanupWAL.mockResolvedValue(walResult);

      const response = await controller.cleanupWAL(VALID_KEY);

      expect(mockStorageService.cleanupWAL).toHaveBeenCalledTimes(1);
      expect(response).toEqual(walResult);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.cleanupWAL(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.cleanupWAL).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // GET /disk-usage → getFullDiskUsage
  // -------------------------------------------------------------------------

  describe("getFullDiskUsage()", () => {
    it("returns disk usage breakdown when key is valid", async () => {
      const diskUsage = {
        totalDiskMB: 1000,
        databaseSizeMB: 200,
        tableDataMB: 150,
        indexesMB: 30,
        toastMB: 10,
        walEstimateMB: 5,
        otherMB: 5,
        breakdown: [{ category: "tables", sizeMB: 150, percentage: 75 }],
      };
      mockStorageService.getFullDiskUsage.mockResolvedValue(diskUsage);

      const response = await controller.getFullDiskUsage(VALID_KEY);

      expect(mockStorageService.getFullDiskUsage).toHaveBeenCalledTimes(1);
      expect(response).toEqual(diskUsage);
    });

    it("throws BadRequestException when key is invalid", async () => {
      await expect(controller.getFullDiskUsage(INVALID_KEY)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStorageService.getFullDiskUsage).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // GET /node-memory → getNodeMemoryStats (sync)
  // -------------------------------------------------------------------------

  describe("getNodeMemoryStats()", () => {
    it("returns node memory stats when key is valid", () => {
      const stats = makeNodeMemoryStats();
      mockStorageService.getNodeMemoryStats.mockReturnValue(stats);

      const result = controller.getNodeMemoryStats(VALID_KEY);

      expect(mockStorageService.getNodeMemoryStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual(stats);
    });

    it("throws BadRequestException when key is invalid", () => {
      expect(() => controller.getNodeMemoryStats(INVALID_KEY)).toThrow(
        BadRequestException,
      );
      expect(mockStorageService.getNodeMemoryStats).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // GET /system-memory → getSystemMemoryStats (sync)
  // -------------------------------------------------------------------------

  describe("getSystemMemoryStats()", () => {
    it("returns system memory stats when key is valid", () => {
      const stats = makeSystemMemoryStats();
      mockStorageService.getSystemMemoryStats.mockReturnValue(stats);

      const result = controller.getSystemMemoryStats(VALID_KEY);

      expect(mockStorageService.getSystemMemoryStats).toHaveBeenCalledTimes(1);
      expect(result).toEqual(stats);
    });

    it("throws BadRequestException when key is invalid", () => {
      expect(() => controller.getSystemMemoryStats(INVALID_KEY)).toThrow(
        BadRequestException,
      );
      expect(mockStorageService.getSystemMemoryStats).not.toHaveBeenCalled();
    });
  });
});

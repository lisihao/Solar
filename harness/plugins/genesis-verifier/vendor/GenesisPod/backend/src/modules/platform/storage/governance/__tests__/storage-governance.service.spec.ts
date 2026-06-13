import { Test, TestingModule } from "@nestjs/testing";
import { StorageGovernanceService } from "../storage-governance.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import * as os from "os";

jest.mock("os", () => ({
  totalmem: jest.fn(),
  freemem: jest.fn(),
  platform: jest.fn(),
  cpus: jest.fn(),
  loadavg: jest.fn(),
  hostname: jest.fn(),
}));

const mockPrisma = {
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
  generatedImage: {
    count: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  rawData: {
    count: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  resource: {
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  note: { count: jest.fn() },
  researchProjectSource: {
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  collectionTask: {
    count: jest.fn(),
    groupBy: jest.fn(),
    deleteMany: jest.fn(),
  },
  importTask: {
    count: jest.fn(),
    groupBy: jest.fn(),
    deleteMany: jest.fn(),
  },
  parsedMetadata: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  deduplicationRecord: { count: jest.fn() },
  dataQualityMetric: { count: jest.fn() },
  userActivity: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicMessage: { count: jest.fn() },
  officeDocument: {
    count: jest.fn(),
    groupBy: jest.fn(),
    deleteMany: jest.fn(),
  },
  officeDocumentVersion: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  officeDocumentResourceRef: { deleteMany: jest.fn() },
  user: { count: jest.fn() },
  comment: { count: jest.fn() },
  askSession: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  askMessage: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  topic: { count: jest.fn() },
  workspace: { count: jest.fn() },
  report: { count: jest.fn() },
  debateSession: { count: jest.fn() },
  brandKit: { count: jest.fn() },
  slidesSession: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  slidesCheckpoint: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  slidesTeamExecution: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  slidesTeamLog: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  knowledgeBase: {
    count: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  knowledgeBaseDocument: {
    count: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  parentChunk: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  childChunk: {
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  childEmbedding: {
    count: jest.fn(),
    groupBy: jest.fn(),
    deleteMany: jest.fn(),
  },
  knowledgeBaseMember: { deleteMany: jest.fn() },
  knowledgeBaseSource: { deleteMany: jest.fn() },
};

describe("StorageGovernanceService", () => {
  let service: StorageGovernanceService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageGovernanceService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StorageGovernanceService>(StorageGovernanceService);
  });

  // ==================== getStorageStats ====================

  describe("getStorageStats", () => {
    it("should return aggregated storage stats with all categories", async () => {
      // Stub every prisma call with zeros to keep test lean
      jest
        .spyOn(
          service as unknown as { getImageStats: () => object },
          "getImageStats" as never,
        )
        .mockResolvedValue({
          name: "generatedImages",
          displayName: "AI Generated Images",
          count: 0,
          estimatedSizeMB: 0,
          description: "0 bookmarked, 0 unbookmarked",
          canCleanup: false,
        } as never);

      // Stub all the remaining category helpers
      const stubCategory = (name: string) =>
        jest
          .spyOn(
            service as unknown as Record<string, () => object>,
            name as never,
          )
          .mockResolvedValue({
            name,
            displayName: name,
            count: 0,
            estimatedSizeMB: 0,
            description: "",
            canCleanup: false,
          } as never);

      stubCategory("getRawDataStats");
      stubCategory("getResourceStats");
      stubCategory("getNoteStats");
      stubCategory("getResearchSourceStats");
      stubCategory("getCollectionTaskStats");
      stubCategory("getImportTaskStats");
      stubCategory("getParsedMetadataStats");
      stubCategory("getDeduplicationStats");
      stubCategory("getDataQualityStats");
      stubCategory("getUserActivityStats");
      stubCategory("getTopicMessageStats");
      stubCategory("getOfficeDocumentStats");
      stubCategory("getUserStats");
      stubCategory("getCommentStats");
      stubCategory("getAskSessionStats");
      stubCategory("getTopicStats");
      stubCategory("getWorkspaceStats");
      stubCategory("getReportStats");
      stubCategory("getDebateStats");
      stubCategory("getBrandKitStats");
      stubCategory("getSlidesStats");
      stubCategory("getKnowledgeBaseStats");

      const result = await service.getStorageStats();

      expect(result.totalCategories).toBe(23);
      expect(result.totalRecords).toBe(0);
      expect(result.estimatedTotalSizeMB).toBe(0);
      expect(Array.isArray(result.categories)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it("should include cleanup recommendation when a category provides one", async () => {
      jest
        .spyOn(
          service as unknown as Record<string, () => object>,
          "getImageStats" as never,
        )
        .mockResolvedValue({
          name: "generatedImages",
          displayName: "AI Generated Images",
          count: 150,
          estimatedSizeMB: 75,
          description: "10 bookmarked, 140 unbookmarked",
          cleanupRecommendation: "140 unbookmarked images can be cleaned",
          canCleanup: true,
        } as never);

      const stubEmpty = (name: string) =>
        jest
          .spyOn(
            service as unknown as Record<string, () => object>,
            name as never,
          )
          .mockResolvedValue({
            name,
            count: 0,
            estimatedSizeMB: 0,
            description: "",
            canCleanup: false,
          } as never);

      [
        "getRawDataStats",
        "getResourceStats",
        "getNoteStats",
        "getResearchSourceStats",
        "getCollectionTaskStats",
        "getImportTaskStats",
        "getParsedMetadataStats",
        "getDeduplicationStats",
        "getDataQualityStats",
        "getUserActivityStats",
        "getTopicMessageStats",
        "getOfficeDocumentStats",
        "getUserStats",
        "getCommentStats",
        "getAskSessionStats",
        "getTopicStats",
        "getWorkspaceStats",
        "getReportStats",
        "getDebateStats",
        "getBrandKitStats",
        "getSlidesStats",
        "getKnowledgeBaseStats",
      ].forEach(stubEmpty);

      const result = await service.getStorageStats();

      expect(result.recommendations).toContain(
        "140 unbookmarked images can be cleaned",
      );
      expect(result.totalRecords).toBe(150);
    });
  });

  // ==================== cleanupImages ====================

  describe("cleanupImages", () => {
    it("should delete old unbookmarked images beyond keepPerUser threshold", async () => {
      // Return a single user group with 30 unbookmarked images (keepPerUser = 20 → 10 to delete)
      mockPrisma.generatedImage.groupBy.mockResolvedValue([
        { userId: "user1", _count: 30 },
      ]);
      const unbookmarkedImages = Array.from({ length: 30 }, (_, i) => ({
        id: `img-${i}`,
      }));
      mockPrisma.generatedImage.findMany.mockResolvedValue(unbookmarkedImages);
      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.cleanupImages(20);

      expect(result.success).toBe(true);
      expect(result.category).toBe("generatedImages");
      expect(result.deletedCount).toBe(10);
      expect(mockPrisma.generatedImage.deleteMany).toHaveBeenCalled();
    });

    it("should not delete when all images are within keep threshold", async () => {
      mockPrisma.generatedImage.groupBy.mockResolvedValue([
        { userId: "user1", _count: 5 },
      ]);
      mockPrisma.generatedImage.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ id: `img-${i}` })),
      );

      const result = await service.cleanupImages(20);

      expect(result.deletedCount).toBe(0);
      expect(mockPrisma.generatedImage.deleteMany).not.toHaveBeenCalled();
    });

    it("should handle null userId group (anonymous images)", async () => {
      mockPrisma.generatedImage.groupBy.mockResolvedValue([
        { userId: null, _count: 25 },
      ]);
      mockPrisma.generatedImage.findMany.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({ id: `img-${i}` })),
      );
      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupImages(20);

      expect(result.success).toBe(true);
      // findMany called with { equals: null } filter
      expect(mockPrisma.generatedImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: { equals: null } }),
        }),
      );
    });

    it("should return failure result on prisma error", async () => {
      mockPrisma.generatedImage.groupBy.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cleanupImages();

      expect(result.success).toBe(false);
      expect(result.message).toContain("DB error");
    });
  });

  // ==================== deleteAllImages ====================

  describe("deleteAllImages", () => {
    it("should delete all images and calculate freed size", async () => {
      mockPrisma.generatedImage.count.mockResolvedValue(10);
      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.deleteAllImages();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(10);
      // 10 images * 500KB / 1024 = ~4.88 MB
      expect(result.freedSizeMB).toBeGreaterThan(0);
      expect(result.message).toContain("10 images");
    });

    it("should return failure when deletion throws", async () => {
      mockPrisma.generatedImage.count.mockResolvedValue(5);
      mockPrisma.generatedImage.deleteMany.mockRejectedValue(
        new Error("constraint error"),
      );

      const result = await service.deleteAllImages();

      expect(result.success).toBe(false);
      expect(result.deletedCount).toBe(0);
    });
  });

  // ==================== cleanupOldRawData ====================

  describe("cleanupOldRawData", () => {
    it("should delete processed raw data older than daysOld", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
      mockPrisma.rawData.deleteMany.mockResolvedValue({ count: 42 });

      const result = await service.cleanupOldRawData(30);

      expect(result.success).toBe(true);
      expect(result.category).toBe("rawData");
      expect(result.deletedCount).toBe(42);
    });

    it("should use default 30 days when no argument provided", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
      mockPrisma.rawData.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupOldRawData();

      expect(result.success).toBe(true);
      expect(result.message).toContain("30 days");
    });

    it("should return failure result on error", async () => {
      // ensureLinkedRawDataProcessed has its own catch, so we need to fail
      // at the deleteMany step to propagate to the outer catch
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]); // ensureLinkedRawDataProcessed succeeds
      mockPrisma.rawData.deleteMany.mockRejectedValue(
        new Error("query failed"),
      );

      const result = await service.cleanupOldRawData(7);

      expect(result.success).toBe(false);
    });
  });

  // ==================== deleteAllRawData ====================

  describe("deleteAllRawData", () => {
    it("should delete all raw data records", async () => {
      mockPrisma.rawData.count.mockResolvedValue(100);
      mockPrisma.rawData.deleteMany.mockResolvedValue({ count: 100 });

      const result = await service.deleteAllRawData();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(100);
    });
  });

  // ==================== cleanupOldCollectionTasks ====================

  describe("cleanupOldCollectionTasks", () => {
    it("should delete completed/failed/cancelled tasks older than threshold", async () => {
      mockPrisma.collectionTask.deleteMany.mockResolvedValue({ count: 15 });

      const result = await service.cleanupOldCollectionTasks(7);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(15);
      expect(result.message).toContain("7 days");
    });

    it("should return failure on error", async () => {
      mockPrisma.collectionTask.deleteMany.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cleanupOldCollectionTasks();

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOldImportTasks ====================

  describe("cleanupOldImportTasks", () => {
    it("should delete SUCCESS/FAILED/CANCELLED import tasks older than threshold", async () => {
      mockPrisma.importTask.deleteMany.mockResolvedValue({ count: 8 });

      const result = await service.cleanupOldImportTasks(7);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(8);
    });
  });

  // ==================== cleanupExpiredMetadata ====================

  describe("cleanupExpiredMetadata", () => {
    it("should delete expired metadata cache entries", async () => {
      mockPrisma.parsedMetadata.deleteMany.mockResolvedValue({ count: 25 });

      const result = await service.cleanupExpiredMetadata();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(25);
      expect(result.category).toBe("parsedMetadata");
    });
  });

  // ==================== cleanupOldUserActivities ====================

  describe("cleanupOldUserActivities", () => {
    it("should delete user activities older than daysOld", async () => {
      mockPrisma.userActivity.deleteMany.mockResolvedValue({ count: 500 });

      const result = await service.cleanupOldUserActivities(30);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(500);
    });
  });

  // ==================== cleanupOldAskSessions ====================

  describe("cleanupOldAskSessions", () => {
    it("should delete messages then sessions older than threshold", async () => {
      mockPrisma.askMessage.deleteMany.mockResolvedValue({ count: 200 });
      mockPrisma.askSession.deleteMany.mockResolvedValue({ count: 30 });

      const result = await service.cleanupOldAskSessions(30);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(30);
      expect(result.message).toContain("30 sessions");
      expect(result.message).toContain("200 messages");
    });

    it("should return failure when deletion fails", async () => {
      mockPrisma.askMessage.deleteMany.mockRejectedValue(
        new Error("FK constraint"),
      );

      const result = await service.cleanupOldAskSessions();

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOldOfficeDocuments ====================

  describe("cleanupOldOfficeDocuments", () => {
    it("should delete docs, versions, and resource refs older than threshold", async () => {
      mockPrisma.officeDocument.count.mockResolvedValue(5);
      mockPrisma.officeDocumentVersion.count.mockResolvedValue(10);
      mockPrisma.officeDocumentResourceRef.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockPrisma.officeDocumentVersion.deleteMany.mockResolvedValue({
        count: 10,
      });
      mockPrisma.officeDocument.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupOldOfficeDocuments(7);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(5);
      expect(result.message).toContain("5 documents");
      expect(result.message).toContain("10 versions");
    });

    it("should return failure on error", async () => {
      mockPrisma.officeDocument.count.mockRejectedValue(new Error("error"));

      const result = await service.cleanupOldOfficeDocuments();

      expect(result.success).toBe(false);
    });
  });

  // ==================== deleteAllOfficeDocuments ====================

  describe("deleteAllOfficeDocuments", () => {
    it("should delete all office documents in correct FK order", async () => {
      mockPrisma.officeDocument.count.mockResolvedValue(3);
      mockPrisma.officeDocumentVersion.count.mockResolvedValue(6);
      mockPrisma.officeDocumentResourceRef.deleteMany.mockResolvedValue({
        count: 0,
      });
      mockPrisma.officeDocumentVersion.deleteMany.mockResolvedValue({
        count: 6,
      });
      mockPrisma.officeDocument.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.deleteAllOfficeDocuments();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
    });
  });

  // ==================== cleanupOldSlides ====================

  describe("cleanupOldSlides", () => {
    it("should delete slides data with team tables present", async () => {
      mockPrisma.slidesSession.count.mockResolvedValue(3);
      mockPrisma.slidesCheckpoint.count.mockResolvedValue(20);
      mockPrisma.slidesTeamLog.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.slidesTeamExecution.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.slidesCheckpoint.deleteMany.mockResolvedValue({ count: 20 });
      mockPrisma.slidesSession.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.cleanupOldSlides(7);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
    });

    it("should gracefully handle missing slides team tables", async () => {
      mockPrisma.slidesSession.count.mockResolvedValue(2);
      mockPrisma.slidesCheckpoint.count.mockResolvedValue(5);
      // Simulate team tables not existing
      mockPrisma.slidesTeamLog.deleteMany.mockRejectedValue(
        new Error("table does not exist"),
      );
      mockPrisma.slidesCheckpoint.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.slidesSession.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.cleanupOldSlides();

      expect(result.success).toBe(true);
    });
  });

  // ==================== deleteAllSlides ====================

  describe("deleteAllSlides", () => {
    it("should delete all slides data including team execution logs", async () => {
      mockPrisma.slidesSession.count.mockResolvedValue(4);
      mockPrisma.slidesCheckpoint.count.mockResolvedValue(12);
      mockPrisma.slidesTeamLog.count.mockResolvedValue(30);
      mockPrisma.slidesTeamExecution.count.mockResolvedValue(10);
      mockPrisma.slidesTeamLog.deleteMany.mockResolvedValue({ count: 30 });
      mockPrisma.slidesTeamExecution.deleteMany.mockResolvedValue({
        count: 10,
      });
      mockPrisma.slidesCheckpoint.deleteMany.mockResolvedValue({ count: 12 });
      mockPrisma.slidesSession.deleteMany.mockResolvedValue({ count: 4 });

      const result = await service.deleteAllSlides();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(4);
      expect(result.message).toContain("4 sessions");
    });
  });

  // ==================== cleanupKnowledgeBase ====================

  describe("cleanupKnowledgeBase", () => {
    it("should delete a knowledge base and all associated data", async () => {
      mockPrisma.knowledgeBase.findUnique.mockResolvedValue({
        id: "kb-1",
        name: "Test KB",
        _count: { documents: 5 },
      });
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
        { id: "doc-1" },
        { id: "doc-2" },
      ]);
      mockPrisma.parentChunk.count.mockResolvedValue(10);
      mockPrisma.childChunk.count.mockResolvedValue(50);
      mockPrisma.childEmbedding.count.mockResolvedValue(50);
      mockPrisma.knowledgeBase.delete.mockResolvedValue({ id: "kb-1" });

      const result = await service.cleanupKnowledgeBase("kb-1");

      expect(result.success).toBe(true);
      expect(result.category).toBe("knowledgeBase");
      expect(result.deletedCount).toBe(5);
      expect(mockPrisma.knowledgeBase.delete).toHaveBeenCalledWith({
        where: { id: "kb-1" },
      });
    });

    it("should return failure when knowledge base not found", async () => {
      mockPrisma.knowledgeBase.findUnique.mockResolvedValue(null);

      const result = await service.cleanupKnowledgeBase("nonexistent-kb");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Knowledge base not found");
    });

    it("should return failure on prisma error", async () => {
      mockPrisma.knowledgeBase.findUnique.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cleanupKnowledgeBase("kb-1");

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOrphanedRagData ====================

  describe("cleanupOrphanedRagData", () => {
    it("should delete orphaned embeddings, child chunks, and parent chunks", async () => {
      // First call: orphaned embeddings count
      // Second call: orphaned child chunks count
      // Third call: orphaned parent chunks count
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: "10" }])
        .mockResolvedValueOnce([{ count: "5" }])
        .mockResolvedValueOnce([{ count: "3" }]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.cleanupOrphanedRagData();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(18);
      expect(result.message).toContain("10 embeddings");
      expect(result.message).toContain("5 child chunks");
      expect(result.message).toContain("3 parent chunks");
    });

    it("should skip deletion when no orphaned records exist", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: "0" }])
        .mockResolvedValueOnce([{ count: "0" }])
        .mockResolvedValueOnce([{ count: "0" }]);

      const result = await service.cleanupOrphanedRagData();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(0);
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it("should return failure on query error", async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error("query error"));

      const result = await service.cleanupOrphanedRagData();

      expect(result.success).toBe(false);
    });
  });

  // ==================== deleteAllKnowledgeBaseData ====================

  describe("deleteAllKnowledgeBaseData", () => {
    it("should delete all RAG data in correct FK order", async () => {
      mockPrisma.childEmbedding.count.mockResolvedValue(1000);
      mockPrisma.childChunk.count.mockResolvedValue(500);
      mockPrisma.parentChunk.count.mockResolvedValue(100);
      mockPrisma.knowledgeBaseDocument.count.mockResolvedValue(20);
      mockPrisma.knowledgeBase.count.mockResolvedValue(3);

      mockPrisma.childEmbedding.deleteMany.mockResolvedValue({ count: 1000 });
      mockPrisma.childChunk.deleteMany.mockResolvedValue({ count: 500 });
      mockPrisma.parentChunk.deleteMany.mockResolvedValue({ count: 100 });
      mockPrisma.knowledgeBaseDocument.deleteMany.mockResolvedValue({
        count: 20,
      });
      mockPrisma.knowledgeBaseMember.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.knowledgeBaseSource.deleteMany.mockResolvedValue({ count: 2 });
      mockPrisma.knowledgeBase.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.deleteAllKnowledgeBaseData();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
      expect(result.message).toContain("3 knowledge bases");

      // Verify deletion order
      const deleteManyOrder = [
        mockPrisma.childEmbedding.deleteMany,
        mockPrisma.childChunk.deleteMany,
        mockPrisma.parentChunk.deleteMany,
        mockPrisma.knowledgeBaseDocument.deleteMany,
      ];
      for (let i = 0; i < deleteManyOrder.length - 1; i++) {
        const aIdx = deleteManyOrder[i].mock.invocationCallOrder[0];
        const bIdx = deleteManyOrder[i + 1].mock.invocationCallOrder[0];
        expect(aIdx).toBeLessThan(bIdx);
      }
    });
  });

  // ==================== getDatabaseAnalysis ====================

  describe("getDatabaseAnalysis", () => {
    it("should return database analysis with table sizes and recommendations", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ size: String(100 * 1024 * 1024) }]) // 100 MB total
        .mockResolvedValueOnce([
          {
            table_name: "generated_images",
            row_estimate: "500",
            total_bytes: String(110 * 1024 * 1024),
            index_bytes: String(5 * 1024 * 1024),
            table_bytes: String(100 * 1024 * 1024),
            toast_bytes: String(5 * 1024 * 1024),
          },
        ]);

      const result = await service.getDatabaseAnalysis();

      expect(result.totalDatabaseSizeMB).toBeCloseTo(100, 0);
      expect(result.tables.length).toBe(1);
      expect(result.tables[0].tableName).toBe("generated_images");
      expect(result.largestTables.length).toBe(1);
    });

    it("should add recommendation for generated_images table > 100 MB", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ size: String(200 * 1024 * 1024) }])
        .mockResolvedValueOnce([
          {
            table_name: "generated_images",
            row_estimate: "1000",
            total_bytes: String(110 * 1024 * 1024),
            index_bytes: "0",
            table_bytes: String(110 * 1024 * 1024),
            toast_bytes: "0",
          },
        ]);

      const result = await service.getDatabaseAnalysis();

      expect(
        result.recommendations.some((r) => r.includes("generated_images")),
      ).toBe(true);
    });

    it("should throw on prisma error", async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error("pg error"));

      await expect(service.getDatabaseAnalysis()).rejects.toThrow("pg error");
    });
  });

  // ==================== vacuumDatabase ====================

  describe("vacuumDatabase", () => {
    it("should execute VACUUM ANALYZE and return success", async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.vacuumDatabase();

      expect(result.success).toBe(true);
      expect(result.message).toContain("VACUUM ANALYZE");
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        "VACUUM ANALYZE",
      );
    });

    it("should return failure when vacuum fails", async () => {
      mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error("vacuum error"));

      const result = await service.vacuumDatabase();

      expect(result.success).toBe(false);
    });
  });

  // ==================== vacuumFullTable ====================

  describe("vacuumFullTable", () => {
    it("should vacuum a valid table and report freed space", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ size: String(50 * 1024 * 1024) }]) // before
        .mockResolvedValueOnce([{ size: String(30 * 1024 * 1024) }]); // after
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.vacuumFullTable("generated_images");

      expect(result.success).toBe(true);
      expect(result.beforeMB).toBeCloseTo(50, 0);
      expect(result.afterMB).toBeCloseTo(30, 0);
    });

    it("should reject invalid table names not in whitelist", async () => {
      const result = await service.vacuumFullTable(
        "malicious_table; DROP TABLE users;",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid table name");
    });

    it("should return failure when vacuum throws", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([{ size: "1000" }]);
      mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error("lock timeout"));

      const result = await service.vacuumFullTable("raw_data");

      expect(result.success).toBe(false);
      expect(result.message).toContain("lock timeout");
    });
  });

  // ==================== cleanupWAL ====================

  describe("cleanupWAL", () => {
    it("should execute CHECKPOINT and return success", async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ wal_bytes: "10000" }]);

      const result = await service.cleanupWAL();

      expect(result.success).toBe(true);
      expect(result.message).toContain("CHECKPOINT");
    });

    it("should return failure on error", async () => {
      mockPrisma.$executeRawUnsafe.mockRejectedValue(
        new Error("checkpoint error"),
      );

      const result = await service.cleanupWAL();

      expect(result.success).toBe(false);
    });
  });

  // ==================== getFullDiskUsage ====================

  describe("getFullDiskUsage", () => {
    it("should return disk usage breakdown", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ size: String(150 * 1024 * 1024) }])
        .mockResolvedValueOnce([
          {
            table_bytes: String(80 * 1024 * 1024),
            index_bytes: String(20 * 1024 * 1024),
            toast_bytes: String(10 * 1024 * 1024),
          },
        ]);

      const result = await service.getFullDiskUsage();

      expect(result.databaseSizeMB).toBeCloseTo(150, 0);
      expect(result.tableDataMB).toBeCloseTo(80, 0);
      expect(result.indexesMB).toBeCloseTo(20, 0);
      expect(result.toastMB).toBeCloseTo(10, 0);
      expect(Array.isArray(result.breakdown)).toBe(true);
    });

    it("should throw on error", async () => {
      mockPrisma.$queryRawUnsafe.mockRejectedValue(new Error("pg error"));

      await expect(service.getFullDiskUsage()).rejects.toThrow("pg error");
    });
  });

  // ==================== runFullCleanup ====================

  describe("runFullCleanup", () => {
    it("should run all cleanup operations and aggregate results", async () => {
      const successResult = {
        success: true,
        category: "test",
        deletedCount: 5,
        freedSizeMB: 1.5,
        message: "ok",
      };

      // All cleanup methods return success
      jest.spyOn(service, "cleanupImages").mockResolvedValue(successResult);
      jest.spyOn(service, "cleanupOldRawData").mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldCollectionTasks")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldImportTasks")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupExpiredMetadata")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldUserActivities")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldAskSessions")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldOfficeDocuments")
        .mockResolvedValue(successResult);
      jest.spyOn(service, "cleanupOldSlides").mockResolvedValue(successResult);

      const result = await service.runFullCleanup();

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(9);
      expect(result.totalDeleted).toBe(45); // 9 * 5
      expect(result.totalFreedMB).toBeCloseTo(13.5); // 9 * 1.5
    });

    it("should return success=false when any cleanup fails", async () => {
      const failResult = {
        success: false,
        category: "test",
        deletedCount: 0,
        freedSizeMB: 0,
        message: "failed",
      };
      const successResult = { ...failResult, success: true };

      jest.spyOn(service, "cleanupImages").mockResolvedValue(failResult);
      jest.spyOn(service, "cleanupOldRawData").mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldCollectionTasks")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldImportTasks")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupExpiredMetadata")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldUserActivities")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldAskSessions")
        .mockResolvedValue(successResult);
      jest
        .spyOn(service, "cleanupOldOfficeDocuments")
        .mockResolvedValue(successResult);
      jest.spyOn(service, "cleanupOldSlides").mockResolvedValue(successResult);

      const result = await service.runFullCleanup();

      expect(result.success).toBe(false);
    });
  });

  // ==================== getNodeMemoryStats ====================

  describe("getNodeMemoryStats", () => {
    it("should return healthy status under normal memory usage", () => {
      const origMemUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 100 * 1024 * 1024, // 100 MB
        heapTotal: 200 * 1024 * 1024, // 200 MB → 50%
        rss: 256 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      });
      jest.spyOn(process, "uptime").mockReturnValue(3600);
      const origVersion = process.version;
      Object.defineProperty(process, "version", {
        value: "v18.0.0",
        configurable: true,
      });

      const result = service.getNodeMemoryStats();

      expect(result.status).toBe("healthy");
      expect(result.warnings).toHaveLength(0);
      expect(result.heapUsed).toBeCloseTo(100, 0);
      expect(result.heapUsedPercent).toBeCloseTo(50, 0);

      process.memoryUsage = origMemUsage;
      Object.defineProperty(process, "version", {
        value: origVersion,
        configurable: true,
      });
    });

    it("should return warning status at 76-90% heap usage", () => {
      const origMemUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 160 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024, // 80%
        rss: 300 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      });

      const result = service.getNodeMemoryStats();

      expect(result.status).toBe("warning");
      process.memoryUsage = origMemUsage;
    });

    it("should return critical status above 90% heap usage", () => {
      const origMemUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 185 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024, // 92.5%
        rss: 200 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
      });

      const result = service.getNodeMemoryStats();

      expect(result.status).toBe("critical");
      expect(result.warnings.length).toBeGreaterThan(0);
      process.memoryUsage = origMemUsage;
    });
  });

  // ==================== getSystemMemoryStats ====================

  describe("getSystemMemoryStats", () => {
    it("should return system memory stats as healthy", () => {
      (os.totalmem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024); // 16 GB
      (os.freemem as jest.Mock).mockReturnValue(8 * 1024 * 1024 * 1024); // 8 GB free (50%)
      (os.platform as jest.Mock).mockReturnValue("linux");
      (os.cpus as jest.Mock).mockReturnValue(new Array(4));
      (os.loadavg as jest.Mock).mockReturnValue([0.5, 0.3, 0.2]);
      (os.hostname as jest.Mock).mockReturnValue("server-1");

      const result = service.getSystemMemoryStats();

      expect(result.status).toBe("healthy");
      expect(result.totalMemory).toBeCloseTo(16, 0);
      expect(result.freeMemory).toBeCloseTo(8, 0);
      expect(result.usedPercent).toBeCloseTo(50, 0);
      expect(result.platform).toBe("linux");
      expect(result.cpuCount).toBe(4);
    });

    it("should return warning status when memory usage >80%", () => {
      (os.totalmem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(2.5 * 1024 * 1024 * 1024); // ~85% used
      (os.platform as jest.Mock).mockReturnValue("linux");
      (os.cpus as jest.Mock).mockReturnValue(new Array(4));
      (os.loadavg as jest.Mock).mockReturnValue([1.0]);
      (os.hostname as jest.Mock).mockReturnValue("server-1");

      const result = service.getSystemMemoryStats();

      expect(result.status).toBe("warning");
    });

    it("should return critical status when memory usage >90%", () => {
      (os.totalmem as jest.Mock).mockReturnValue(16 * 1024 * 1024 * 1024);
      (os.freemem as jest.Mock).mockReturnValue(1 * 1024 * 1024 * 1024); // ~93.75% used
      (os.platform as jest.Mock).mockReturnValue("linux");
      (os.cpus as jest.Mock).mockReturnValue(new Array(2));
      (os.loadavg as jest.Mock).mockReturnValue([2.0]);
      (os.hostname as jest.Mock).mockReturnValue("server-1");

      const result = service.getSystemMemoryStats();

      expect(result.status).toBe("critical");
    });
  });

  // ==================== private stat helpers (via getStorageStats) ====================

  describe("private stats helpers (via getStorageStats without mocking private methods)", () => {
    const setupAllCountMocks = (overrides: Record<string, unknown> = {}) => {
      const defaults: Record<string, number> = {
        generatedImageCount: 0,
        generatedImageBookmarked: 0,
        rawDataCount: 0,
        rawDataProcessed: 0,
        rawDataOldProcessed: 0,
        resourceCount: 0,
        noteCount: 0,
        researchProjectSourceCount: 0,
        collectionTaskCount: 0,
        collectionTaskOld: 0,
        importTaskCount: 0,
        importTaskOld: 0,
        parsedMetadataCount: 0,
        parsedMetadataExpired: 0,
        deduplicationCount: 0,
        dataQualityCount: 0,
        userActivityCount: 0,
        userActivityOld: 0,
        topicMessageCount: 0,
        officeDocumentCount: 0,
        officeDocumentVersionCount: 0,
        officeDocumentOld: 0,
        userCount: 0,
        commentCount: 0,
        askSessionCount: 0,
        askMessageCount: 0,
        askSessionOld: 0,
        topicCount: 0,
        workspaceCount: 0,
        reportCount: 0,
        debateCount: 0,
        brandKitCount: 0,
        slidesSessionCount: 0,
        slidesCheckpointCount: 0,
        slidesSessionOld: 0,
        slidesTeamExecution: 0,
        slidesTeamLog: 0,
        knowledgeBaseCount: 0,
        knowledgeBaseDocumentCount: 0,
        parentChunkCount: 0,
        childChunkCount: 0,
        childEmbeddingCount: 0,
      };
      const vals = { ...defaults, ...overrides };

      const callIndex = 0;
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);

      // generatedImage
      mockPrisma.generatedImage.count
        .mockResolvedValueOnce(vals.generatedImageCount as number)
        .mockResolvedValueOnce(vals.generatedImageBookmarked as number);
      mockPrisma.generatedImage.groupBy.mockResolvedValue([]);

      // rawData - ensureLinkedRawDataProcessed uses $queryRawUnsafe
      mockPrisma.rawData.count
        .mockResolvedValueOnce(vals.rawDataCount as number)
        .mockResolvedValueOnce(vals.rawDataProcessed as number)
        .mockResolvedValueOnce(vals.rawDataOldProcessed as number);
      mockPrisma.rawData.groupBy.mockResolvedValue([]);

      // resource
      mockPrisma.resource.count.mockResolvedValueOnce(
        vals.resourceCount as number,
      );
      mockPrisma.resource.groupBy.mockResolvedValue([]);

      // note
      mockPrisma.note.count.mockResolvedValueOnce(vals.noteCount as number);

      // researchProjectSource
      mockPrisma.researchProjectSource.count.mockResolvedValueOnce(
        vals.researchProjectSourceCount as number,
      );
      mockPrisma.researchProjectSource.groupBy.mockResolvedValue([]);

      // collectionTask
      mockPrisma.collectionTask.count
        .mockResolvedValueOnce(vals.collectionTaskCount as number)
        .mockResolvedValueOnce(vals.collectionTaskOld as number);
      mockPrisma.collectionTask.groupBy.mockResolvedValue([]);

      // importTask
      mockPrisma.importTask.count
        .mockResolvedValueOnce(vals.importTaskCount as number)
        .mockResolvedValueOnce(vals.importTaskOld as number);
      mockPrisma.importTask.groupBy.mockResolvedValue([]);

      // parsedMetadata
      mockPrisma.parsedMetadata.count
        .mockResolvedValueOnce(vals.parsedMetadataCount as number)
        .mockResolvedValueOnce(vals.parsedMetadataExpired as number);

      // deduplication
      mockPrisma.deduplicationRecord.count.mockResolvedValueOnce(
        vals.deduplicationCount as number,
      );

      // dataQuality
      mockPrisma.dataQualityMetric.count.mockResolvedValueOnce(
        vals.dataQualityCount as number,
      );

      // userActivity
      mockPrisma.userActivity.count
        .mockResolvedValueOnce(vals.userActivityCount as number)
        .mockResolvedValueOnce(vals.userActivityOld as number);

      // topicMessage
      mockPrisma.topicMessage.count.mockResolvedValueOnce(
        vals.topicMessageCount as number,
      );

      // officeDocument
      mockPrisma.officeDocument.count
        .mockResolvedValueOnce(vals.officeDocumentCount as number)
        .mockResolvedValueOnce(vals.officeDocumentOld as number);
      mockPrisma.officeDocumentVersion.count.mockResolvedValueOnce(
        vals.officeDocumentVersionCount as number,
      );
      mockPrisma.officeDocument.groupBy.mockResolvedValue([]);

      // user
      mockPrisma.user.count.mockResolvedValueOnce(vals.userCount as number);

      // comment
      mockPrisma.comment.count.mockResolvedValueOnce(
        vals.commentCount as number,
      );

      // askSession
      mockPrisma.askSession.count
        .mockResolvedValueOnce(vals.askSessionCount as number)
        .mockResolvedValueOnce(vals.askSessionOld as number);
      mockPrisma.askMessage.count.mockResolvedValueOnce(
        vals.askMessageCount as number,
      );

      // topic
      mockPrisma.topic.count.mockResolvedValueOnce(vals.topicCount as number);

      // workspace
      mockPrisma.workspace.count.mockResolvedValueOnce(
        vals.workspaceCount as number,
      );

      // report
      mockPrisma.report.count.mockResolvedValueOnce(vals.reportCount as number);

      // debate
      mockPrisma.debateSession.count.mockResolvedValueOnce(
        vals.debateCount as number,
      );

      // brandKit
      mockPrisma.brandKit.count.mockResolvedValueOnce(
        vals.brandKitCount as number,
      );

      // slidesSession
      mockPrisma.slidesSession.count
        .mockResolvedValueOnce(vals.slidesSessionCount as number)
        .mockResolvedValueOnce(vals.slidesSessionOld as number);
      mockPrisma.slidesCheckpoint.count.mockResolvedValueOnce(
        vals.slidesCheckpointCount as number,
      );
      mockPrisma.slidesTeamExecution.count.mockResolvedValueOnce(
        vals.slidesTeamExecution as number,
      );
      mockPrisma.slidesTeamLog.count.mockResolvedValueOnce(
        vals.slidesTeamLog as number,
      );

      // knowledgeBase
      mockPrisma.knowledgeBase.count.mockResolvedValueOnce(
        vals.knowledgeBaseCount as number,
      );
      mockPrisma.knowledgeBaseDocument.count.mockResolvedValueOnce(
        vals.knowledgeBaseDocumentCount as number,
      );
      mockPrisma.parentChunk.count.mockResolvedValueOnce(
        vals.parentChunkCount as number,
      );
      mockPrisma.childChunk.count.mockResolvedValueOnce(
        vals.childChunkCount as number,
      );
      mockPrisma.childEmbedding.count.mockResolvedValueOnce(
        vals.childEmbeddingCount as number,
      );
      mockPrisma.childEmbedding.groupBy.mockResolvedValue([]);

      void callIndex;
    };

    it("returns all 23 categories via real private methods", async () => {
      setupAllCountMocks();

      const result = await service.getStorageStats();

      expect(result.totalCategories).toBe(23);
      expect(Array.isArray(result.categories)).toBe(true);
    });

    it("generates cleanup recommendation when many unbookmarked images", async () => {
      setupAllCountMocks({
        generatedImageCount: 200,
        generatedImageBookmarked: 5,
      });

      const result = await service.getStorageStats();
      const imageCategory = result.categories.find(
        (c) => c.name === "generatedImages",
      );

      expect(imageCategory!.count).toBe(200);
      expect(imageCategory!.canCleanup).toBe(true);
      // 195 unbookmarked > 100 threshold → cleanupRecommendation set
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it("generates cleanup recommendation for old collection tasks", async () => {
      setupAllCountMocks({
        collectionTaskCount: 50,
        collectionTaskOld: 25,
      });

      const result = await service.getStorageStats();
      const taskCategory = result.categories.find(
        (c) => c.name === "collectionTasks",
      );

      expect(taskCategory!.canCleanup).toBe(true);
      // 25 > 20 threshold
      expect(
        result.recommendations.some((r) =>
          r.includes("25 completed/failed collection tasks"),
        ),
      ).toBe(true);
    });

    it("generates cleanup recommendation for old import tasks", async () => {
      setupAllCountMocks({
        importTaskCount: 100,
        importTaskOld: 60,
      });

      const result = await service.getStorageStats();
      const importCategory = result.categories.find(
        (c) => c.name === "importTasks",
      );

      expect(importCategory!.canCleanup).toBe(true);
      // 60 > 50 threshold
      expect(
        result.recommendations.some((r) =>
          r.includes("60 completed import tasks"),
        ),
      ).toBe(true);
    });

    it("generates cleanup recommendation for expired metadata", async () => {
      setupAllCountMocks({
        parsedMetadataCount: 100,
        parsedMetadataExpired: 30,
      });

      const result = await service.getStorageStats();
      const metaCategory = result.categories.find(
        (c) => c.name === "parsedMetadata",
      );

      expect(metaCategory!.canCleanup).toBe(true);
      expect(
        result.recommendations.some((r) =>
          r.includes("30 expired metadata cache entries"),
        ),
      ).toBe(true);
    });

    it("generates cleanup recommendation for old user activities", async () => {
      setupAllCountMocks({
        userActivityCount: 5000,
        userActivityOld: 2000,
      });

      const result = await service.getStorageStats();
      const activityCategory = result.categories.find(
        (c) => c.name === "userActivities",
      );

      expect(activityCategory!.canCleanup).toBe(true);
      // 2000 > 1000 threshold
      expect(
        result.recommendations.some((r) =>
          r.includes("2000 user activity records"),
        ),
      ).toBe(true);
    });

    it("generates cleanup recommendation for old Ask sessions", async () => {
      setupAllCountMocks({
        askSessionCount: 100,
        askSessionOld: 60,
      });

      const result = await service.getStorageStats();
      const askCategory = result.categories.find(
        (c) => c.name === "askSessions",
      );

      expect(askCategory!.canCleanup).toBe(true);
      expect(
        result.recommendations.some((r) =>
          r.includes("60 AI chat sessions older than 30 days"),
        ),
      ).toBe(true);
    });

    it("generates cleanup recommendation for old PPT documents", async () => {
      setupAllCountMocks({
        officeDocumentCount: 20,
        officeDocumentOld: 15,
        officeDocumentVersionCount: 40,
      });

      const result = await service.getStorageStats();
      const docCategory = result.categories.find(
        (c) => c.name === "officeDocuments",
      );

      expect(docCategory!.canCleanup).toBe(true);
      expect(
        result.recommendations.some((r) =>
          r.includes("15 PPT documents older than 7 days"),
        ),
      ).toBe(true);
    });

    it("generates cleanup recommendation for large embedding storage", async () => {
      setupAllCountMocks({
        knowledgeBaseCount: 5,
        knowledgeBaseDocumentCount: 100,
        childEmbeddingCount: 15000,
      });

      const result = await service.getStorageStats();
      const kbCategory = result.categories.find(
        (c) => c.name === "knowledgeBase",
      );

      expect(kbCategory!.canCleanup).toBe(true);
      expect(
        result.recommendations.some((r) =>
          r.includes("Large embedding storage detected"),
        ),
      ).toBe(true);
    });

    it("handles knowledge base stats error gracefully", async () => {
      setupAllCountMocks();
      // The knowledgeBase stats are called via getKnowledgeBaseStats which has its own try/catch.
      // Override count to throw AFTER the setupAllCountMocks() already set the first mock.
      // We need to reset and provide a rejection for all KB-related queries.
      // Since setupAllCountMocks already consumed the mock, the next call will throw.
      mockPrisma.knowledgeBase.count.mockRejectedValue(
        new Error("table not found"),
      );

      const result = await service.getStorageStats();
      const kbCategory = result.categories.find(
        (c) => c.name === "knowledgeBase",
      );

      expect(kbCategory).toBeDefined();
      // The error is caught at the getKnowledgeBaseStats level → returns fallback
      expect(kbCategory!.count).toBe(0);
      expect(kbCategory!.canCleanup).toBe(false);
    });

    it("generates slides cleanup recommendation when old sessions or many checkpoints", async () => {
      setupAllCountMocks({
        slidesSessionCount: 10,
        slidesSessionOld: 8,
        slidesCheckpointCount: 150,
      });

      const result = await service.getStorageStats();
      const slidesCategory = result.categories.find((c) => c.name === "slides");

      expect(slidesCategory!.canCleanup).toBe(true);
      // 8 > 5 OR 150 > 100 → recommendation should exist
      expect(
        result.recommendations.some(
          (r) =>
            r.includes("sessions older than 7 days") ||
            r.includes("checkpoints can be cleaned"),
        ),
      ).toBe(true);
    });

    it("handles slides team table errors gracefully in stats", async () => {
      setupAllCountMocks({
        slidesSessionCount: 2,
        slidesCheckpointCount: 10,
      });
      // Simulate team tables not existing
      mockPrisma.slidesTeamExecution.count.mockRejectedValue(
        new Error("relation does not exist"),
      );

      const result = await service.getStorageStats();
      const slidesCategory = result.categories.find((c) => c.name === "slides");

      // Should still return category without throwing
      expect(slidesCategory).toBeDefined();
      expect(slidesCategory!.count).toBe(2);
    });

    it("uses dimension-based size calculation for embeddings when groupBy succeeds", async () => {
      setupAllCountMocks({
        knowledgeBaseCount: 1,
        knowledgeBaseDocumentCount: 10,
        childEmbeddingCount: 500,
      });
      // Override groupBy to return dimension data
      mockPrisma.childEmbedding.groupBy.mockResolvedValue([
        { dimensions: 1536, _count: 500 },
      ]);

      const result = await service.getStorageStats();
      const kbCategory = result.categories.find(
        (c) => c.name === "knowledgeBase",
      );

      expect(kbCategory).toBeDefined();
      // Size should be calculated from dimensions, not flat estimate
      expect(kbCategory!.estimatedSizeMB).toBeGreaterThan(0);
    });

    it("calculates total records and size across all categories", async () => {
      setupAllCountMocks({
        generatedImageCount: 10,
        rawDataCount: 20,
        resourceCount: 5,
        noteCount: 15,
        userCount: 100,
      });

      const result = await service.getStorageStats();

      // Total records should sum all category counts
      expect(result.totalRecords).toBe(
        result.categories.reduce((sum, c) => sum + c.count, 0),
      );
      expect(result.estimatedTotalSizeMB).toBeGreaterThan(0);
    });
  });

  // ==================== deleteAllRawData (error path) ====================

  describe("deleteAllRawData (error path)", () => {
    it("returns failure when deleteMany throws", async () => {
      mockPrisma.rawData.count.mockResolvedValue(50);
      mockPrisma.rawData.deleteMany.mockRejectedValue(
        new Error("constraint violation"),
      );

      const result = await service.deleteAllRawData();

      expect(result.success).toBe(false);
      expect(result.message).toContain("constraint violation");
    });
  });

  // ==================== cleanupOldImportTasks (error path) ====================

  describe("cleanupOldImportTasks (error path)", () => {
    it("returns failure when deleteMany throws", async () => {
      mockPrisma.importTask.deleteMany.mockRejectedValue(
        new Error("DB timeout"),
      );

      const result = await service.cleanupOldImportTasks();

      expect(result.success).toBe(false);
      expect(result.message).toContain("DB timeout");
    });

    it("uses default 7 days when no argument provided", async () => {
      mockPrisma.importTask.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupOldImportTasks();

      expect(result.success).toBe(true);
      expect(result.message).toContain("7 days");
    });
  });

  // ==================== cleanupExpiredMetadata (error path) ====================

  describe("cleanupExpiredMetadata (error path)", () => {
    it("returns failure when deleteMany throws", async () => {
      mockPrisma.parsedMetadata.deleteMany.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cleanupExpiredMetadata();

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOldUserActivities (error path) ====================

  describe("cleanupOldUserActivities (error path)", () => {
    it("returns failure when deleteMany throws", async () => {
      mockPrisma.userActivity.deleteMany.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cleanupOldUserActivities();

      expect(result.success).toBe(false);
    });

    it("uses default 30 days when no argument provided", async () => {
      mockPrisma.userActivity.deleteMany.mockResolvedValue({ count: 200 });

      const result = await service.cleanupOldUserActivities();

      expect(result.success).toBe(true);
      expect(result.message).toContain("30 days");
    });
  });

  // ==================== deleteAllOfficeDocuments (error path) ====================

  describe("deleteAllOfficeDocuments (error path)", () => {
    it("returns failure when deletion throws", async () => {
      mockPrisma.officeDocument.count.mockResolvedValue(3);
      mockPrisma.officeDocumentVersion.count.mockResolvedValue(6);
      mockPrisma.officeDocumentResourceRef.deleteMany.mockRejectedValue(
        new Error("FK error"),
      );

      const result = await service.deleteAllOfficeDocuments();

      expect(result.success).toBe(false);
    });
  });

  // ==================== deleteAllSlides (error path) ====================

  describe("deleteAllSlides (error path)", () => {
    it("returns failure when slidesCheckpoint.deleteMany throws (outer catch)", async () => {
      // The outer try/catch fires when slidesCheckpoint.deleteMany or slidesSession.deleteMany throws
      // (team table errors are caught by inner try/catch)
      mockPrisma.slidesSession.count.mockResolvedValue(2);
      mockPrisma.slidesCheckpoint.count.mockResolvedValue(5);
      mockPrisma.slidesTeamLog.count.mockResolvedValue(10);
      mockPrisma.slidesTeamExecution.count.mockResolvedValue(3);
      mockPrisma.slidesTeamLog.deleteMany.mockResolvedValue({ count: 10 });
      mockPrisma.slidesTeamExecution.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.slidesCheckpoint.deleteMany.mockRejectedValue(
        new Error("FK constraint"),
      );

      const result = await service.deleteAllSlides();

      expect(result.success).toBe(false);
      expect(result.message).toContain("FK constraint");
    });
  });

  // ==================== deleteAllKnowledgeBaseData (error path) ====================

  describe("deleteAllKnowledgeBaseData (error path)", () => {
    it("returns failure when deletion throws", async () => {
      mockPrisma.childEmbedding.count.mockResolvedValue(100);
      mockPrisma.childChunk.count.mockResolvedValue(50);
      mockPrisma.parentChunk.count.mockResolvedValue(10);
      mockPrisma.knowledgeBaseDocument.count.mockResolvedValue(5);
      mockPrisma.knowledgeBase.count.mockResolvedValue(2);
      mockPrisma.childEmbedding.deleteMany.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.deleteAllKnowledgeBaseData();

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOrphanedRagData (edge cases) ====================

  describe("cleanupOrphanedRagData (edge cases)", () => {
    it("deletes when orphaned embeddings exist but no orphaned chunks", async () => {
      mockPrisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: "5" }]) // orphaned embeddings
        .mockResolvedValueOnce([{ count: "0" }]) // orphaned child chunks
        .mockResolvedValueOnce([{ count: "0" }]); // orphaned parent chunks
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);

      const result = await service.cleanupOrphanedRagData();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(5);
    });
  });
});

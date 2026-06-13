import { Test, TestingModule } from "@nestjs/testing";
import { StorageGovernanceService } from "../storage-governance.service";
import { PrismaService } from "@/common/prisma/prisma.service";

jest.mock("os", () => ({
  totalmem: jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024),
  freemem: jest.fn().mockReturnValue(8 * 1024 * 1024 * 1024),
  platform: jest.fn().mockReturnValue("linux"),
  cpus: jest.fn().mockReturnValue([{}, {}, {}, {}]),
  loadavg: jest.fn().mockReturnValue([0.5, 0.3, 0.2]),
  hostname: jest.fn().mockReturnValue("test-host"),
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
  resource: { count: jest.fn(), groupBy: jest.fn() },
  note: { count: jest.fn() },
  researchProjectSource: { count: jest.fn(), groupBy: jest.fn() },
  collectionTask: {
    count: jest.fn(),
    groupBy: jest.fn(),
    deleteMany: jest.fn(),
  },
  importTask: { count: jest.fn(), groupBy: jest.fn(), deleteMany: jest.fn() },
  parsedMetadata: { count: jest.fn(), deleteMany: jest.fn() },
  deduplicationRecord: { count: jest.fn() },
  dataQualityMetric: { count: jest.fn() },
  userActivity: { count: jest.fn(), deleteMany: jest.fn() },
  topicMessage: { count: jest.fn() },
  officeDocument: {
    count: jest.fn(),
    groupBy: jest.fn(),
    deleteMany: jest.fn(),
  },
  officeDocumentVersion: { count: jest.fn(), deleteMany: jest.fn() },
  officeDocumentResourceRef: { deleteMany: jest.fn() },
  user: { count: jest.fn() },
  comment: { count: jest.fn() },
  askSession: { count: jest.fn(), deleteMany: jest.fn() },
  askMessage: { count: jest.fn(), deleteMany: jest.fn() },
  topic: { count: jest.fn() },
  workspace: { count: jest.fn() },
  report: { count: jest.fn() },
  debateSession: { count: jest.fn() },
  brandKit: { count: jest.fn() },
  slidesSession: { count: jest.fn(), deleteMany: jest.fn() },
  slidesCheckpoint: { count: jest.fn(), deleteMany: jest.fn() },
  slidesTeamExecution: { count: jest.fn(), deleteMany: jest.fn() },
  slidesTeamLog: { count: jest.fn(), deleteMany: jest.fn() },
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
  parentChunk: { count: jest.fn(), deleteMany: jest.fn() },
  childChunk: { count: jest.fn(), deleteMany: jest.fn() },
  childEmbedding: {
    count: jest.fn(),
    groupBy: jest.fn(),
    deleteMany: jest.fn(),
  },
  knowledgeBaseMember: { deleteMany: jest.fn() },
  knowledgeBaseSource: { deleteMany: jest.fn() },
};

describe("StorageGovernanceService (edge cases)", () => {
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

  // ==================== cleanupImages ====================

  describe("cleanupImages", () => {
    it("deletes old unbookmarked images beyond keepPerUser limit", async () => {
      mockPrisma.generatedImage.groupBy.mockResolvedValue([
        { userId: "user-1", _count: 30 },
      ]);
      // 25 unbookmarked, keepPerUser=20 -> delete 5
      mockPrisma.generatedImage.findMany.mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => ({ id: `img-${i}` })),
      );
      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupImages(20);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(5);
      expect(result.category).toBe("generatedImages");
    });

    it("returns zero deletions when all images are within keep limit", async () => {
      mockPrisma.generatedImage.groupBy.mockResolvedValue([
        { userId: "user-1", _count: 5 },
      ]);
      // 10 unbookmarked, keepPerUser=20 -> delete none
      mockPrisma.generatedImage.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: `img-${i}` })),
      );

      const result = await service.cleanupImages(20);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(0);
      expect(mockPrisma.generatedImage.deleteMany).not.toHaveBeenCalled();
    });

    it("returns failure result when Prisma throws", async () => {
      mockPrisma.generatedImage.groupBy.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cleanupImages(20);

      expect(result.success).toBe(false);
      expect(result.message).toContain("Cleanup failed");
    });

    it("handles null userId groups (images with no user)", async () => {
      mockPrisma.generatedImage.groupBy.mockResolvedValue([
        { userId: null, _count: 15 },
      ]);
      mockPrisma.generatedImage.findMany.mockResolvedValue(
        Array.from({ length: 15 }, (_, i) => ({ id: `img-${i}` })),
      );
      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupImages(10);

      expect(result.success).toBe(true);
    });
  });

  // ==================== deleteAllImages ====================

  describe("deleteAllImages", () => {
    it("deletes all images and reports correct count", async () => {
      mockPrisma.generatedImage.count.mockResolvedValue(42);
      mockPrisma.generatedImage.deleteMany.mockResolvedValue({ count: 42 });

      const result = await service.deleteAllImages();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(42);
      expect(result.message).toContain("42");
    });

    it("returns failure when deleteMany throws", async () => {
      mockPrisma.generatedImage.count.mockResolvedValue(10);
      mockPrisma.generatedImage.deleteMany.mockRejectedValue(
        new Error("constraint violation"),
      );

      const result = await service.deleteAllImages();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Delete failed");
    });
  });

  // ==================== cleanupOldRawData ====================

  describe("cleanupOldRawData", () => {
    it("deletes processed raw data older than default 30 days", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
      mockPrisma.rawData.deleteMany.mockResolvedValue({ count: 75 });

      const result = await service.cleanupOldRawData();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(75);
      expect(result.category).toBe("rawData");
    });

    it("uses custom daysOld parameter", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
      mockPrisma.rawData.deleteMany.mockResolvedValue({ count: 10 });

      const result = await service.cleanupOldRawData(7);

      expect(result.success).toBe(true);
      expect(result.message).toContain("7 days");
    });

    it("returns failure when deleteMany throws", async () => {
      mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
      mockPrisma.rawData.deleteMany.mockRejectedValue(new Error("timeout"));

      const result = await service.cleanupOldRawData();

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOldCollectionTasks ====================

  describe("cleanupOldCollectionTasks", () => {
    it("deletes completed/failed/cancelled tasks older than 7 days", async () => {
      mockPrisma.collectionTask.deleteMany.mockResolvedValue({ count: 25 });

      const result = await service.cleanupOldCollectionTasks(7);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(25);
      expect(result.category).toBe("collectionTasks");
    });

    it("returns failure when deleteMany throws", async () => {
      mockPrisma.collectionTask.deleteMany.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.cleanupOldCollectionTasks();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Cleanup failed");
    });
  });

  // ==================== cleanupExpiredMetadata ====================

  describe("cleanupExpiredMetadata", () => {
    it("deletes expired metadata cache entries", async () => {
      mockPrisma.parsedMetadata.deleteMany.mockResolvedValue({ count: 100 });

      const result = await service.cleanupExpiredMetadata();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(100);
      expect(result.category).toBe("parsedMetadata");
    });

    it("returns zero when no expired entries exist", async () => {
      mockPrisma.parsedMetadata.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanupExpiredMetadata();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(0);
    });

    it("returns failure on error", async () => {
      mockPrisma.parsedMetadata.deleteMany.mockRejectedValue(
        new Error("lock error"),
      );

      const result = await service.cleanupExpiredMetadata();

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOldUserActivities ====================

  describe("cleanupOldUserActivities", () => {
    it("deletes old activity records beyond 30 days", async () => {
      mockPrisma.userActivity.deleteMany.mockResolvedValue({ count: 500 });

      const result = await service.cleanupOldUserActivities(30);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(500);
      expect(result.category).toBe("userActivities");
    });

    it("returns failure on error", async () => {
      mockPrisma.userActivity.deleteMany.mockRejectedValue(new Error("error"));

      const result = await service.cleanupOldUserActivities();

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOldAskSessions ====================

  describe("cleanupOldAskSessions", () => {
    it("deletes sessions and their messages", async () => {
      mockPrisma.askMessage.deleteMany.mockResolvedValue({ count: 200 });
      mockPrisma.askSession.deleteMany.mockResolvedValue({ count: 50 });

      const result = await service.cleanupOldAskSessions(30);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(50);
      expect(result.message).toContain("50 sessions");
      expect(result.message).toContain("200 messages");
    });

    it("returns failure when session deletion throws", async () => {
      mockPrisma.askMessage.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.askSession.deleteMany.mockRejectedValue(new Error("error"));

      const result = await service.cleanupOldAskSessions();

      expect(result.success).toBe(false);
    });
  });

  // ==================== cleanupOldOfficeDocuments ====================

  describe("cleanupOldOfficeDocuments", () => {
    it("deletes documents and their versions older than cutoff", async () => {
      mockPrisma.officeDocument.count.mockResolvedValue(5);
      mockPrisma.officeDocumentVersion.count.mockResolvedValue(10);
      mockPrisma.officeDocumentResourceRef.deleteMany.mockResolvedValue({
        count: 3,
      });
      mockPrisma.officeDocumentVersion.deleteMany.mockResolvedValue({
        count: 10,
      });
      mockPrisma.officeDocument.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanupOldOfficeDocuments(7);

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(5);
      expect(result.category).toBe("officeDocuments");
      expect(result.message).toContain("5 documents");
    });

    it("returns failure when count throws", async () => {
      mockPrisma.officeDocument.count.mockRejectedValue(new Error("error"));

      const result = await service.cleanupOldOfficeDocuments();

      expect(result.success).toBe(false);
    });
  });

  // ==================== deleteAllOfficeDocuments ====================

  describe("deleteAllOfficeDocuments", () => {
    it("deletes all office documents and versions in correct order", async () => {
      mockPrisma.officeDocument.count.mockResolvedValue(3);
      mockPrisma.officeDocumentVersion.count.mockResolvedValue(6);
      mockPrisma.officeDocumentResourceRef.deleteMany.mockResolvedValue({
        count: 2,
      });
      mockPrisma.officeDocumentVersion.deleteMany.mockResolvedValue({
        count: 6,
      });
      mockPrisma.officeDocument.deleteMany.mockResolvedValue({ count: 3 });

      const result = await service.deleteAllOfficeDocuments();

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);
      // Verify ordering: refs first, then versions, then docs
      const callOrder = [
        mockPrisma.officeDocumentResourceRef.deleteMany,
        mockPrisma.officeDocumentVersion.deleteMany,
        mockPrisma.officeDocument.deleteMany,
      ];
      callOrder.forEach((fn) => expect(fn).toHaveBeenCalled());
    });

    it("returns failure when deletion throws", async () => {
      mockPrisma.officeDocument.count.mockResolvedValue(5);
      mockPrisma.officeDocumentVersion.count.mockResolvedValue(10);
      mockPrisma.officeDocumentResourceRef.deleteMany.mockRejectedValue(
        new Error("FK violation"),
      );

      const result = await service.deleteAllOfficeDocuments();

      expect(result.success).toBe(false);
      expect(result.message).toContain("Delete failed");
    });
  });
});

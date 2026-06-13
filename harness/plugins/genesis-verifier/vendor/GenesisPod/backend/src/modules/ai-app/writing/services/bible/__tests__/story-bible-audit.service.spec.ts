import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { StoryBibleAuditService } from "../story-bible-audit.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { StoryBibleChangeType, StoryBibleEntityType } from "@prisma/client";

describe("StoryBibleAuditService", () => {
  let service: StoryBibleAuditService;
  let mockPrisma: jest.Mocked<PrismaService>;

  const mockBible = {
    id: "bible-1",
    projectId: "proj-1",
    version: 5,
  };

  const mockAuditLog = {
    id: "log-1",
    bibleId: "bible-1",
    version: 1,
    changeType: "UPDATE" as StoryBibleChangeType,
    entityType: "CHARACTER" as StoryBibleEntityType,
    entityId: "char-1",
    field: "name",
    oldValue: "Old Name",
    newValue: "New Name",
    changedBy: "user",
    reason: null,
    createdAt: new Date("2025-01-01"),
  };

  beforeEach(async () => {
    mockPrisma = {
      storyBible: {
        findUnique: jest.fn(),
      },
      storyBibleAuditLog: {
        create: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        deleteMany: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoryBibleAuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StoryBibleAuditService>(StoryBibleAuditService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("logChange", () => {
    it("should create an audit log entry", async () => {
      (mockPrisma.storyBibleAuditLog.create as jest.Mock).mockResolvedValue(
        mockAuditLog,
      );

      const result = await service.logChange({
        bibleId: "bible-1",
        version: 1,
        changeType: "UPDATE" as StoryBibleChangeType,
        entityType: "CHARACTER" as StoryBibleEntityType,
        entityId: "char-1",
        field: "name",
        oldValue: "Old Name",
        newValue: "New Name",
        changedBy: "user",
      });

      expect(result).toEqual(mockAuditLog);
      expect(mockPrisma.storyBibleAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bibleId: "bible-1",
            changeType: "UPDATE",
            entityType: "CHARACTER",
            field: "name",
          }),
        }),
      );
    });

    it("should propagate errors from prisma", async () => {
      (mockPrisma.storyBibleAuditLog.create as jest.Mock).mockRejectedValue(
        new Error("DB Error"),
      );

      await expect(
        service.logChange({
          bibleId: "bible-1",
          version: 1,
          changeType: "CREATE" as StoryBibleChangeType,
          entityType: "BIBLE" as StoryBibleEntityType,
          field: "premise",
          changedBy: "system",
        }),
      ).rejects.toThrow("DB Error");
    });
  });

  describe("logBulkChanges", () => {
    it("should create multiple audit log entries", async () => {
      (mockPrisma.storyBibleAuditLog.createMany as jest.Mock).mockResolvedValue(
        { count: 3 },
      );

      const entries = [
        {
          bibleId: "bible-1",
          version: 1,
          changeType: "UPDATE" as StoryBibleChangeType,
          entityType: "CHARACTER" as StoryBibleEntityType,
          field: "name",
          changedBy: "user",
        },
        {
          bibleId: "bible-1",
          version: 1,
          changeType: "UPDATE" as StoryBibleChangeType,
          entityType: "CHARACTER" as StoryBibleEntityType,
          field: "age",
          changedBy: "user",
        },
        {
          bibleId: "bible-1",
          version: 1,
          changeType: "CREATE" as StoryBibleChangeType,
          entityType: "WORLD_SETTING" as StoryBibleEntityType,
          field: "name",
          changedBy: "story-architect",
        },
      ];

      const result = await service.logBulkChanges(entries);

      expect(result).toBe(3);
      expect(mockPrisma.storyBibleAuditLog.createMany).toHaveBeenCalled();
    });

    it("should return count of created entries", async () => {
      (mockPrisma.storyBibleAuditLog.createMany as jest.Mock).mockResolvedValue(
        { count: 5 },
      );

      const result = await service.logBulkChanges(
        Array(5).fill({
          bibleId: "bible-1",
          version: 1,
          changeType: "UPDATE" as StoryBibleChangeType,
          entityType: "BIBLE" as StoryBibleEntityType,
          field: "premise",
          changedBy: "user",
        }),
      );

      expect(result).toBe(5);
    });
  });

  describe("getChangeHistory", () => {
    it("should throw NotFoundException when bible not found", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getChangeHistory("nonexistent", {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return paginated audit logs", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.count as jest.Mock).mockResolvedValue(10);
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue([
        mockAuditLog,
      ]);

      const result = await service.getChangeHistory("bible-1", {
        limit: 5,
        offset: 0,
      });

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(10);
      expect(result.hasMore).toBe(true);
    });

    it("should use default limit of 50 when not specified", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await service.getChangeHistory("bible-1");

      expect(mockPrisma.storyBibleAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it("should filter by entityType when provided", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.count as jest.Mock).mockResolvedValue(0);
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await service.getChangeHistory("bible-1", {
        entityType: "CHARACTER" as StoryBibleEntityType,
      });

      expect(mockPrisma.storyBibleAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            entityType: "CHARACTER",
          }),
        }),
      );
    });

    it("should set hasMore to false when all records fit in page", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.count as jest.Mock).mockResolvedValue(1);
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue([
        mockAuditLog,
      ]);

      const result = await service.getChangeHistory("bible-1", { limit: 50 });

      expect(result.hasMore).toBe(false);
    });
  });

  describe("getEntityHistory", () => {
    it("should throw NotFoundException when bible not found", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getEntityHistory(
          "nonexistent",
          "CHARACTER" as StoryBibleEntityType,
          "char-1",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return entity history ordered by createdAt asc", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue([
        mockAuditLog,
      ]);

      const result = await service.getEntityHistory(
        "bible-1",
        "CHARACTER" as StoryBibleEntityType,
        "char-1",
      );

      expect(result).toEqual([mockAuditLog]);
      expect(mockPrisma.storyBibleAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            bibleId: "bible-1",
            entityType: "CHARACTER",
            entityId: "char-1",
          },
          orderBy: { createdAt: "asc" },
        }),
      );
    });
  });

  describe("compareVersions", () => {
    it("should throw NotFoundException when bible not found", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.compareVersions("nonexistent", 1, 3),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return version comparison with differences", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue([
        mockAuditLog,
      ]);

      const result = await service.compareVersions("bible-1", 1, 3);

      expect(result.version1).toBe(1);
      expect(result.version2).toBe(3);
      expect(result.differences).toBeDefined();
      expect(result.totalChanges).toBe(1);
    });

    it("should normalize version order (v1 < v2)", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      // Pass v2 > v1 intentionally reversed
      const result = await service.compareVersions("bible-1", 5, 2);

      expect(result.version1).toBe(2);
      expect(result.version2).toBe(5);
    });

    it("should classify CREATE changeType as added", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue([
        { ...mockAuditLog, changeType: "CREATE" },
      ]);

      const result = await service.compareVersions("bible-1", 1, 3);

      expect(result.differences[0].changeType).toBe("added");
    });

    it("should classify DELETE changeType as removed", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(
        mockBible,
      );
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue([
        { ...mockAuditLog, changeType: "DELETE" },
      ]);

      const result = await service.compareVersions("bible-1", 1, 3);

      expect(result.differences[0].changeType).toBe("removed");
    });
  });

  describe("getLatestVersion", () => {
    it("should return the version number from the bible", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue({
        version: 7,
      });

      const result = await service.getLatestVersion("bible-1");

      expect(result).toBe(7);
    });

    it("should throw NotFoundException when bible not found", async () => {
      (mockPrisma.storyBible.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getLatestVersion("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getVersionStats", () => {
    it("should return statistics for a specific version", async () => {
      (mockPrisma.storyBibleAuditLog.findMany as jest.Mock).mockResolvedValue([
        {
          ...mockAuditLog,
          changeType: "UPDATE",
          entityType: "CHARACTER",
          changedBy: "user",
        },
        {
          ...mockAuditLog,
          changeType: "CREATE",
          entityType: "WORLD_SETTING",
          changedBy: "story-architect",
        },
        {
          ...mockAuditLog,
          changeType: "UPDATE",
          entityType: "CHARACTER",
          changedBy: "user",
        },
      ]);

      const result = await service.getVersionStats("bible-1", 1);

      expect(result.version).toBe(1);
      expect(result.totalChanges).toBe(3);
      expect(result.changesByType["UPDATE"]).toBe(2);
      expect(result.changesByType["CREATE"]).toBe(1);
      expect(result.changesByEntity["CHARACTER"]).toBe(2);
      expect(result.changesByEntity["WORLD_SETTING"]).toBe(1);
      expect(result.changedBy["user"]).toBe(2);
    });
  });

  describe("cleanupOldLogs", () => {
    it("should delete audit logs older than keepDays", async () => {
      (mockPrisma.storyBibleAuditLog.deleteMany as jest.Mock).mockResolvedValue(
        { count: 15 },
      );

      const result = await service.cleanupOldLogs("bible-1", 30);

      expect(result).toBe(15);
      expect(mockPrisma.storyBibleAuditLog.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            bibleId: "bible-1",
            createdAt: expect.objectContaining({ lt: expect.any(Date) }),
          }),
        }),
      );
    });

    it("should use default keepDays of 90 when not specified", async () => {
      (mockPrisma.storyBibleAuditLog.deleteMany as jest.Mock).mockResolvedValue(
        { count: 0 },
      );

      await service.cleanupOldLogs("bible-1");

      const deleteCall = (mockPrisma.storyBibleAuditLog.deleteMany as jest.Mock)
        .mock.calls[0][0];
      const cutoffDate = deleteCall.where.createdAt.lt;
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - 90);
      // Allow 5 second tolerance
      expect(
        Math.abs(cutoffDate.getTime() - expectedDate.getTime()),
      ).toBeLessThan(5000);
    });
  });
});

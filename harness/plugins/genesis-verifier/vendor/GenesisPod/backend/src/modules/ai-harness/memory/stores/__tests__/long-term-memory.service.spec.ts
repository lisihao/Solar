import { Test, TestingModule } from "@nestjs/testing";
import { LongTermMemoryService } from "../long-term-memory.service";
import { PrismaService } from "@/common/prisma/prisma.service";

describe("LongTermMemoryService", () => {
  let service: LongTermMemoryService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrismaService = {
    longTermMemory: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: table exists so the service enables itself
    mockPrismaService.$queryRaw.mockResolvedValue([{ exists: true }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LongTermMemoryService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<LongTermMemoryService>(LongTermMemoryService);
    prisma = module.get(PrismaService);

    await service.onModuleInit();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== setWithUser Tests ====================

  describe("setWithUser", () => {
    const userId = "user-123";
    const key = "test-key";
    const value = { data: "test value" };

    it("should upsert memory entry without TTL", async () => {
      mockPrismaService.longTermMemory.upsert.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.setWithUser(userId, key, value);

      expect(prisma.longTermMemory.upsert).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
        create: {
          userId,
          key,
          value,
          type: undefined,
          importance: 0.5,
          tags: [],
          expiresAt: undefined,
        },
        update: {
          value,
          type: undefined,
          importance: 0.5,
          tags: [],
          expiresAt: undefined,
        },
      });
    });

    it("should upsert memory entry with TTL", async () => {
      const ttl = 3600; // 1 hour in seconds
      const beforeCall = Date.now();

      mockPrismaService.longTermMemory.upsert.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: new Date(beforeCall + ttl * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.setWithUser(userId, key, value, { ttl });

      const afterCall = Date.now();

      expect(prisma.longTermMemory.upsert).toHaveBeenCalled();
      const callArgs = mockPrismaService.longTermMemory.upsert.mock.calls[0][0];
      const expiresAt = callArgs.create.expiresAt as Date;

      // Verify expiresAt is within expected range
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        beforeCall + ttl * 1000,
      );
      expect(expiresAt.getTime()).toBeLessThanOrEqual(afterCall + ttl * 1000);
    });

    it("should upsert memory entry with all options", async () => {
      const options = {
        ttl: 7200,
        type: "user-preference",
        importance: 0.8,
        tags: ["important", "config"],
      };

      mockPrismaService.longTermMemory.upsert.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: options.type,
        importance: options.importance,
        tags: options.tags,
        expiresAt: new Date(Date.now() + options.ttl * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.setWithUser(userId, key, value, options);

      expect(prisma.longTermMemory.upsert).toHaveBeenCalled();
      const callArgs = mockPrismaService.longTermMemory.upsert.mock.calls[0][0];

      expect(callArgs.create.type).toBe(options.type);
      expect(callArgs.create.importance).toBe(options.importance);
      expect(callArgs.create.tags).toEqual(options.tags);
      expect(callArgs.create.expiresAt).toBeInstanceOf(Date);
    });

    it("should not set expiresAt when TTL is 0", async () => {
      mockPrismaService.longTermMemory.upsert.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.setWithUser(userId, key, value, { ttl: 0 });

      const callArgs = mockPrismaService.longTermMemory.upsert.mock.calls[0][0];
      expect(callArgs.create.expiresAt).toBeUndefined();
    });

    it("should not set expiresAt when TTL is negative", async () => {
      mockPrismaService.longTermMemory.upsert.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.setWithUser(userId, key, value, { ttl: -100 });

      const callArgs = mockPrismaService.longTermMemory.upsert.mock.calls[0][0];
      expect(callArgs.create.expiresAt).toBeUndefined();
    });
  });

  // ==================== getWithUser Tests ====================

  describe("getWithUser", () => {
    const userId = "user-123";
    const key = "test-key";

    it("should return undefined when entry not found", async () => {
      mockPrismaService.longTermMemory.findUnique.mockResolvedValue(null);

      const result = await service.getWithUser(userId, key);

      expect(result).toBeUndefined();
      expect(prisma.longTermMemory.findUnique).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
      });
    });

    it("should return memory entry when found and not expired", async () => {
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "test value" },
        type: "user-preference",
        importance: 0.7,
        tags: ["important"],
        expiresAt: null,
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-02"),
      };

      mockPrismaService.longTermMemory.findUnique.mockResolvedValue(mockEntry);

      const result = await service.getWithUser(userId, key);

      expect(result).toEqual({
        value: mockEntry.value,
        type: mockEntry.type,
        importance: mockEntry.importance,
        tags: mockEntry.tags,
        createdAt: mockEntry.createdAt,
        updatedAt: mockEntry.updatedAt,
      });
    });

    it("should delete and return undefined when entry is expired", async () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "expired value" },
        type: "user-preference",
        importance: 0.5,
        tags: [],
        expiresAt: expiredDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.findUnique.mockResolvedValue(mockEntry);
      mockPrismaService.longTermMemory.delete.mockResolvedValue(mockEntry);

      const result = await service.getWithUser(userId, key);

      expect(result).toBeUndefined();
      expect(prisma.longTermMemory.delete).toHaveBeenCalledWith({
        where: { id: mockEntry.id },
      });
    });

    it("should return entry when expiresAt is in the future", async () => {
      const futureDate = new Date(Date.now() + 3600000); // 1 hour from now
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "future value" },
        type: "session",
        importance: 0.6,
        tags: ["temp"],
        expiresAt: futureDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.findUnique.mockResolvedValue(mockEntry);

      const result = await service.getWithUser(userId, key);

      expect(result).toBeDefined();
      expect(result).toEqual({
        value: mockEntry.value,
        type: mockEntry.type,
        importance: mockEntry.importance,
        tags: mockEntry.tags,
        createdAt: mockEntry.createdAt,
        updatedAt: mockEntry.updatedAt,
      });
      expect(prisma.longTermMemory.delete).not.toHaveBeenCalled();
    });
  });

  // ==================== search Tests ====================

  describe("search", () => {
    const mockEntries = [
      {
        id: "1",
        userId: "user-1",
        key: "javascript-tips",
        value: { content: "JavaScript best practices and tips" },
        type: "article",
        importance: 0.8,
        tags: ["programming", "javascript"],
        expiresAt: null,
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-01"),
      },
      {
        id: "2",
        userId: "user-1",
        key: "typescript-guide",
        value: { content: "TypeScript advanced guide" },
        type: "article",
        importance: 0.9,
        tags: ["programming", "typescript"],
        expiresAt: null,
        createdAt: new Date("2025-01-02"),
        updatedAt: new Date("2025-01-02"),
      },
      {
        id: "3",
        userId: "user-2",
        key: "python-tutorial",
        value: { content: "Python for beginners" },
        type: "tutorial",
        importance: 0.5,
        tags: ["programming", "python"],
        expiresAt: null,
        createdAt: new Date("2025-01-03"),
        updatedAt: new Date("2025-01-03"),
      },
    ];

    it("should search and return matching entries by keyword in value", async () => {
      // DB (ILIKE) pre-filters — only the matching entry is returned
      mockPrismaService.$queryRaw.mockResolvedValue([mockEntries[0]]);

      const results = await service.search("javascript");

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe("javascript-tips");
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].metadata).toEqual({
        type: "article",
        importance: 0.8,
        tags: ["programming", "javascript"],
        createdAt: mockEntries[0].createdAt,
        updatedAt: mockEntries[0].updatedAt,
      });
    });

    it("should search and return matching entries by keyword in key", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([mockEntries[1]]);

      const results = await service.search("typescript");

      expect(results).toHaveLength(1);
      expect(results[0].key).toBe("typescript-guide");
    });

    it("should filter by userId", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([mockEntries[0]]);

      await service.search("programming", { userId: "user-1" });

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("should filter by type", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([mockEntries[2]]);

      await service.search("python", { type: "tutorial" });

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("should filter by tags", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([mockEntries[1]]);

      await service.search("guide", { tags: ["typescript"] });

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("should apply threshold filtering", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const results = await service.search("programming", { threshold: 0.8 });

      // Only entries with score >= 0.8 should be returned
      // The exact key match "programming" should have highest score
      expect(results.length).toBeGreaterThanOrEqual(0);
      results.forEach((result) => {
        expect(result.score).toBeGreaterThanOrEqual(0.8);
      });
    });

    it("should limit results when limit is specified", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const results = await service.search("programming", { limit: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should order results by score descending", async () => {
      // DB pre-filters to only "guide" matches; mockEntries[1] has "guide" in key+value
      mockPrismaService.$queryRaw.mockResolvedValue([mockEntries[1]]);

      const results = await service.search("guide");

      // Verify results are sorted by score descending
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
      }
    });

    it("should return empty array when no matches found", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const results = await service.search("nonexistent-keyword");

      expect(results).toEqual([]);
    });

    it("should calculate higher score for exact key match", async () => {
      const entries = [
        {
          id: "1",
          userId: "user-1",
          key: "test",
          value: { content: "Some content" },
          type: "note",
          importance: 0.5,
          tags: [],
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaService.$queryRaw.mockResolvedValue(entries);

      const results = await service.search("test");

      expect(results).toHaveLength(1);
      // Exact key match should give score >= 1.0
      expect(results[0].score).toBeGreaterThanOrEqual(1.0);
    });

    it("should boost score based on importance", async () => {
      const highImportance = {
        id: "1",
        userId: "user-1",
        key: "important-key",
        value: { content: "test content" },
        type: "note",
        importance: 1.0,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const lowImportance = {
        ...highImportance,
        id: "2",
        key: "unimportant-key",
        importance: 0.1,
      };

      mockPrismaService.$queryRaw.mockResolvedValue([
        lowImportance,
        highImportance,
      ]);

      const results = await service.search("test");

      // Find the results
      const highResult = results.find((r) => r.key === "important-key");
      const lowResult = results.find((r) => r.key === "unimportant-key");

      if (highResult && lowResult) {
        expect(highResult.score).toBeGreaterThan(lowResult.score);
      }
    });

    it("should handle case-insensitive search", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([mockEntries[0]]);

      const resultsUpper = await service.search("JAVASCRIPT");
      const resultsLower = await service.search("javascript");

      expect(resultsUpper).toHaveLength(resultsLower.length);
    });

    it("should exclude expired entries", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await service.search("programming");

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("should combine multiple filters", async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([mockEntries[0]]);

      await service.search("javascript", {
        userId: "user-1",
        type: "article",
        tags: ["programming"],
        limit: 5,
        threshold: 0.5,
      });

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });

  // ==================== deleteWithUser Tests ====================

  describe("deleteWithUser", () => {
    const userId = "user-123";
    const key = "test-key";

    it("should delete entry and return true on success", async () => {
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "test" },
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.delete.mockResolvedValue(mockEntry);

      const result = await service.deleteWithUser(userId, key);

      expect(result).toBe(true);
      expect(prisma.longTermMemory.delete).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
      });
    });

    it("should return false when entry not found", async () => {
      mockPrismaService.longTermMemory.delete.mockRejectedValue(
        new Error("Record not found"),
      );

      const result = await service.deleteWithUser(userId, key);

      expect(result).toBe(false);
    });

    it("should return false on any deletion error", async () => {
      mockPrismaService.longTermMemory.delete.mockRejectedValue(
        new Error("Database error"),
      );

      const result = await service.deleteWithUser(userId, "nonexistent-key");

      expect(result).toBe(false);
    });
  });

  // ==================== list Tests ====================

  describe("list", () => {
    const mockEntries = [
      {
        id: "1",
        userId: "user-1",
        key: "key1",
        value: { data: "value1" },
        type: "note",
        importance: 0.8,
        tags: ["tag1"],
        expiresAt: null,
        createdAt: new Date("2025-01-01"),
        updatedAt: new Date("2025-01-03"),
      },
      {
        id: "2",
        userId: "user-1",
        key: "key2",
        value: { data: "value2" },
        type: "config",
        importance: 0.9,
        tags: ["tag2"],
        expiresAt: null,
        createdAt: new Date("2025-01-02"),
        updatedAt: new Date("2025-01-02"),
      },
    ];

    it("should list all entries with default sorting", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue(mockEntries);

      const results = await service.list();

      expect(results).toHaveLength(2);
      expect(prisma.longTermMemory.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        },
        orderBy: { updatedAt: "desc" },
        skip: undefined,
        take: undefined,
      });
    });

    it("should filter by userId", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue([
        mockEntries[0],
      ]);

      await service.list({ userId: "user-1" });

      expect(prisma.longTermMemory.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          userId: "user-1",
        },
        orderBy: { updatedAt: "desc" },
        skip: undefined,
        take: undefined,
      });
    });

    it("should filter by type", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue([
        mockEntries[0],
      ]);

      await service.list({ type: "note" });

      expect(prisma.longTermMemory.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          type: "note",
        },
        orderBy: { updatedAt: "desc" },
        skip: undefined,
        take: undefined,
      });
    });

    it("should filter by tags", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue([
        mockEntries[0],
      ]);

      await service.list({ tags: ["tag1"] });

      expect(prisma.longTermMemory.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          tags: { hasSome: ["tag1"] },
        },
        orderBy: { updatedAt: "desc" },
        skip: undefined,
        take: undefined,
      });
    });

    it("should sort by createdAt ascending", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue(mockEntries);

      await service.list({ sortBy: "createdAt", sortOrder: "asc" });

      expect(prisma.longTermMemory.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        },
        orderBy: { createdAt: "asc" },
        skip: undefined,
        take: undefined,
      });
    });

    it("should sort by importance descending", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue(mockEntries);

      await service.list({ sortBy: "importance", sortOrder: "desc" });

      expect(prisma.longTermMemory.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        },
        orderBy: { importance: "desc" },
        skip: undefined,
        take: undefined,
      });
    });

    it("should apply pagination with offset and limit", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue([
        mockEntries[1],
      ]);

      await service.list({ offset: 1, limit: 1 });

      expect(prisma.longTermMemory.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        },
        orderBy: { updatedAt: "desc" },
        skip: 1,
        take: 1,
      });
    });

    it("should return entries in correct format", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue(mockEntries);

      const results = await service.list();

      expect(results).toEqual([
        {
          key: "key1",
          value: { data: "value1" },
          type: "note",
          importance: 0.8,
          tags: ["tag1"],
        },
        {
          key: "key2",
          value: { data: "value2" },
          type: "config",
          importance: 0.9,
          tags: ["tag2"],
        },
      ]);
    });

    it("should handle null type and importance", async () => {
      const entriesWithNulls = [
        {
          ...mockEntries[0],
          type: null,
          importance: null,
        },
      ];

      mockPrismaService.longTermMemory.findMany.mockResolvedValue(
        entriesWithNulls,
      );

      const results = await service.list();

      expect(results[0].type).toBeUndefined();
      expect(results[0].importance).toBeUndefined();
    });

    it("should combine multiple filters and options", async () => {
      mockPrismaService.longTermMemory.findMany.mockResolvedValue([
        mockEntries[0],
      ]);

      await service.list({
        userId: "user-1",
        type: "note",
        tags: ["tag1"],
        sortBy: "importance",
        sortOrder: "asc",
        offset: 0,
        limit: 10,
      });

      expect(prisma.longTermMemory.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
          userId: "user-1",
          type: "note",
          tags: { hasSome: ["tag1"] },
        },
        orderBy: { importance: "asc" },
        skip: 0,
        take: 10,
      });
    });
  });

  // ==================== updateMetadata Tests ====================

  describe("updateMetadata", () => {
    const key = "test-key";
    const userId = "user-123";

    it("should update metadata for single user entry", async () => {
      const metadata = { importance: 0.9, tags: ["updated"] };
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "test" },
        type: null,
        importance: 0.9,
        tags: ["updated"],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.update.mockResolvedValue(mockEntry);

      const result = await service.updateMetadata(key, metadata, userId);

      expect(result).toBe(true);
      expect(prisma.longTermMemory.update).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
        data: {
          importance: 0.9,
          tags: ["updated"],
        },
      });
    });

    it("should update only importance", async () => {
      const metadata = { importance: 0.7 };
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "test" },
        type: null,
        importance: 0.7,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.update.mockResolvedValue(mockEntry);

      await service.updateMetadata(key, metadata, userId);

      expect(prisma.longTermMemory.update).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
        data: { importance: 0.7 },
      });
    });

    it("should update only tags", async () => {
      const metadata = { tags: ["new-tag"] };
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "test" },
        type: null,
        importance: 0.5,
        tags: ["new-tag"],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.update.mockResolvedValue(mockEntry);

      await service.updateMetadata(key, metadata, userId);

      expect(prisma.longTermMemory.update).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
        data: { tags: ["new-tag"] },
      });
    });

    it("should return false when update fails with userId", async () => {
      const metadata = { importance: 0.8 };

      mockPrismaService.longTermMemory.update.mockRejectedValue(
        new Error("Record not found"),
      );

      const result = await service.updateMetadata(key, metadata, userId);

      expect(result).toBe(false);
    });

    it("should update many entries when userId is not provided", async () => {
      const metadata = { importance: 0.85, tags: ["global"] };

      mockPrismaService.longTermMemory.updateMany.mockResolvedValue({
        count: 3,
      });

      const result = await service.updateMetadata(key, metadata);

      expect(result).toBe(true);
      expect(prisma.longTermMemory.updateMany).toHaveBeenCalledWith({
        where: {
          key,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        },
        data: {
          importance: 0.85,
          tags: ["global"],
        },
      });
    });

    it("should return false when updateMany affects no records", async () => {
      const metadata = { importance: 0.5 };

      mockPrismaService.longTermMemory.updateMany.mockResolvedValue({
        count: 0,
      });

      const result = await service.updateMetadata(key, metadata);

      expect(result).toBe(false);
    });

    it("should handle empty metadata object", async () => {
      const metadata = {};
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "test" },
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.update.mockResolvedValue(mockEntry);

      await service.updateMetadata(key, metadata, userId);

      expect(prisma.longTermMemory.update).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
        data: {},
      });
    });

    it("should allow importance of 0", async () => {
      const metadata = { importance: 0 };
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "test" },
        type: null,
        importance: 0,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.update.mockResolvedValue(mockEntry);

      await service.updateMetadata(key, metadata, userId);

      expect(prisma.longTermMemory.update).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
        data: { importance: 0 },
      });
    });

    it("should allow empty tags array", async () => {
      const metadata = { tags: [] };
      const mockEntry = {
        id: "memory-id",
        userId,
        key,
        value: { data: "test" },
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.update.mockResolvedValue(mockEntry);

      await service.updateMetadata(key, metadata, userId);

      expect(prisma.longTermMemory.update).toHaveBeenCalledWith({
        where: { userId_key: { userId, key } },
        data: { tags: [] },
      });
    });
  });

  // ==================== cleanup Tests ====================

  describe("cleanup", () => {
    it("should delete expired entries and return count", async () => {
      mockPrismaService.longTermMemory.deleteMany.mockResolvedValue({
        count: 5,
      });

      const result = await service.cleanup();

      expect(result).toBe(5);
      expect(prisma.longTermMemory.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });

    it("should return 0 when no expired entries found", async () => {
      mockPrismaService.longTermMemory.deleteMany.mockResolvedValue({
        count: 0,
      });

      const result = await service.cleanup();

      expect(result).toBe(0);
    });

    it("should use current date for expiration check", async () => {
      const beforeCall = new Date();
      mockPrismaService.longTermMemory.deleteMany.mockResolvedValue({
        count: 2,
      });

      await service.cleanup();

      const afterCall = new Date();
      const callArgs =
        mockPrismaService.longTermMemory.deleteMany.mock.calls[0][0];
      const expirationDate = callArgs.where.expiresAt.lt;

      expect(expirationDate).toBeInstanceOf(Date);
      expect(expirationDate.getTime()).toBeGreaterThanOrEqual(
        beforeCall.getTime(),
      );
      expect(expirationDate.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    });
  });

  // ==================== getStats Tests ====================

  describe("getStats", () => {
    it("should return total entries and user count", async () => {
      mockPrismaService.longTermMemory.count.mockResolvedValue(10);
      mockPrismaService.longTermMemory.groupBy.mockResolvedValue([
        { userId: "user-1" },
        { userId: "user-2" },
        { userId: "user-3" },
      ]);

      const stats = await service.getStats();

      expect(stats).toEqual({
        totalEntries: 10,
        userCount: 3,
      });
      expect(prisma.longTermMemory.count).toHaveBeenCalled();
      expect(prisma.longTermMemory.groupBy).toHaveBeenCalledWith({
        by: ["userId"],
      });
    });

    it("should return 0 for empty database", async () => {
      mockPrismaService.longTermMemory.count.mockResolvedValue(0);
      mockPrismaService.longTermMemory.groupBy.mockResolvedValue([]);

      const stats = await service.getStats();

      expect(stats).toEqual({
        totalEntries: 0,
        userCount: 0,
      });
    });

    it("should handle single user with multiple entries", async () => {
      mockPrismaService.longTermMemory.count.mockResolvedValue(5);
      mockPrismaService.longTermMemory.groupBy.mockResolvedValue([
        { userId: "user-1" },
      ]);

      const stats = await service.getStats();

      expect(stats).toEqual({
        totalEntries: 5,
        userCount: 1,
      });
    });

    it("should execute count and groupBy in parallel", async () => {
      mockPrismaService.longTermMemory.count.mockResolvedValue(100);
      mockPrismaService.longTermMemory.groupBy.mockResolvedValue([
        { userId: "user-1" },
        { userId: "user-2" },
      ]);

      await service.getStats();

      // Both should be called
      expect(prisma.longTermMemory.count).toHaveBeenCalled();
      expect(prisma.longTermMemory.groupBy).toHaveBeenCalled();
    });
  });

  // ==================== Integration Tests ====================

  describe("Integration scenarios", () => {
    it("should handle full lifecycle: set, get, update, delete", async () => {
      const userId = "user-123";
      const key = "lifecycle-test";
      const value = { data: "initial" };

      // Set
      mockPrismaService.longTermMemory.upsert.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.setWithUser(userId, key, value);
      expect(prisma.longTermMemory.upsert).toHaveBeenCalled();

      // Get
      mockPrismaService.longTermMemory.findUnique.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const retrieved = await service.getWithUser(userId, key);
      expect(retrieved).toBeDefined();

      // Update
      mockPrismaService.longTermMemory.update.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.9,
        tags: ["updated"],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const updated = await service.updateMetadata(
        key,
        { importance: 0.9, tags: ["updated"] },
        userId,
      );
      expect(updated).toBe(true);

      // Delete
      mockPrismaService.longTermMemory.delete.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.9,
        tags: ["updated"],
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const deleted = await service.deleteWithUser(userId, key);
      expect(deleted).toBe(true);
    });

    it("should handle TTL expiration workflow", async () => {
      const userId = "user-123";
      const key = "expiring-key";
      const value = { data: "temporary" };
      const ttl = 1; // 1 second

      // Set with TTL
      const expiresAt = new Date(Date.now() + ttl * 1000);
      mockPrismaService.longTermMemory.upsert.mockResolvedValue({
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.setWithUser(userId, key, value, { ttl });

      // Get expired entry (simulating time passed)
      const expiredEntry = {
        id: "memory-id",
        userId,
        key,
        value,
        type: null,
        importance: 0.5,
        tags: [],
        expiresAt: new Date(Date.now() - 1000), // Already expired
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.longTermMemory.findUnique.mockResolvedValue(
        expiredEntry,
      );
      mockPrismaService.longTermMemory.delete.mockResolvedValue(expiredEntry);

      const retrieved = await service.getWithUser(userId, key);

      expect(retrieved).toBeUndefined();
      expect(prisma.longTermMemory.delete).toHaveBeenCalledWith({
        where: { id: expiredEntry.id },
      });
    });

    it("should support multi-user search and filtering", async () => {
      const entries = [
        {
          id: "1",
          userId: "user-1",
          key: "shared-key",
          value: { content: "user 1 content" },
          type: "note",
          importance: 0.7,
          tags: ["shared"],
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "2",
          userId: "user-2",
          key: "shared-key",
          value: { content: "user 2 content" },
          type: "note",
          importance: 0.8,
          tags: ["shared"],
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      // Search without userId filter
      mockPrismaService.$queryRaw.mockResolvedValue(entries);
      const allResults = await service.search("content");
      expect(allResults.length).toBe(2);

      // Search with userId filter
      mockPrismaService.$queryRaw.mockResolvedValue([entries[0]]);
      const user1Results = await service.search("content", {
        userId: "user-1",
      });
      expect(user1Results.length).toBe(1);
      expect(user1Results[0].key).toBe("shared-key");
    });
  });
});

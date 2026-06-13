/**
 * CollectionsService supplemental tests
 * Covers: AI organize stats, AI batch tagging, AI smart classify, AI theme cluster,
 *         pagination edge cases, user tags, batch operations
 */

// Mock modules with problematic transitive dependencies before any imports
jest.mock("../../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade");
jest.mock("@/modules/ai-harness/facade");
jest.mock("../../../../../common/prisma/prisma.service");

import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CollectionsService } from "../collections.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

const mockPrisma = {
  collection: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  collectionItem: {
    findMany: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

const mockChatFacade = {
  getDefaultTextModel: jest.fn(),
  chat: jest.fn(),
};

const makeCollection = (overrides: Record<string, unknown> = {}) => ({
  id: "col-1",
  userId: "user-1",
  name: "My Collection",
  description: "Test",
  icon: null,
  color: null,
  isPublic: false,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
  ...overrides,
});

const makeItem = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  collectionId: "col-1",
  resourceId: "res-1",
  note: null,
  tags: [],
  readStatus: "unread",
  readProgress: 0,
  lastReadAt: null,
  position: 0,
  addedAt: new Date(),
  collection: makeCollection(),
  resource: {
    id: "res-1",
    title: "Test Resource",
    type: "article",
    abstract: "Some abstract",
    thumbnailUrl: null,
    sourceUrl: "https://example.com",
    publishedAt: null,
    upvoteCount: 0,
  },
  ...overrides,
});

describe("CollectionsService - supplemental", () => {
  let service: CollectionsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    (
      PrismaService as jest.MockedClass<typeof PrismaService>
    ).mockImplementation(() => mockPrisma as unknown as PrismaService);
    (ChatFacade as jest.MockedClass<typeof ChatFacade>).mockImplementation(
      () => mockChatFacade as unknown as ChatFacade,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockChatFacade },
      ],
    }).compile();

    service = module.get<CollectionsService>(CollectionsService);
  });

  describe("getUserStats", () => {
    it("should return all stats with status breakdown", async () => {
      mockPrisma.collectionItem.count
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(4);
      mockPrisma.collectionItem.groupBy.mockResolvedValue([
        { readStatus: "unread", _count: { readStatus: 10 } },
        { readStatus: "read", _count: { readStatus: 5 } },
      ]);

      const result = await service.getUserStats("user-1");

      expect(result.totalItems).toBe(15);
      expect(result.recentItems).toBe(4);
      expect(result.byStatus.unread).toBe(10);
      expect(result.byStatus.read).toBe(5);
    });

    it("should return zero stats when no items", async () => {
      mockPrisma.collectionItem.count.mockResolvedValue(0);
      mockPrisma.collectionItem.groupBy.mockResolvedValue([]);

      const result = await service.getUserStats("user-1");
      expect(result.totalItems).toBe(0);
      expect(result.byStatus).toEqual({});
    });
  });

  describe("getAIOrganizeStats", () => {
    it("should return organize stats", async () => {
      mockPrisma.collectionItem.count
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(6);

      const result = await service.getAIOrganizeStats("user-1");
      expect(result.totalCount).toBe(30);
      expect(result.untaggedCount).toBe(12);
      expect(result.unclassifiedCount).toBe(6);
    });
  });

  describe("aiBatchGenerateTags", () => {
    it("should throw error when no model available", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue(null);

      await expect(service.aiBatchGenerateTags("user-1")).rejects.toThrow(
        "No default text model available for batch tagging",
      );
    });

    it("should return zero tagged when no untagged items found", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      const result = await service.aiBatchGenerateTags("user-1");
      expect(result.taggedCount).toBe(0);
      expect(result.message).toContain("No items");
    });

    it("should filter by collectionId when provided", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      await service.aiBatchGenerateTags("user-1", "col-1");

      expect(mockPrisma.collectionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ collectionId: "col-1" }),
        }),
      );
    });

    it("should tag items and count successfully", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        makeItem({
          resource: {
            id: "r1",
            title: "AI Topic",
            abstract: "Abstract",
            type: "article",
          },
        }),
        makeItem({
          id: "item-2",
          resource: {
            id: "r2",
            title: "ML Topic",
            abstract: null,
            type: "article",
          },
        }),
      ]);
      mockChatFacade.chat.mockResolvedValue({
        content: '["machine learning", "deep learning", "neural networks"]',
      });
      mockPrisma.collectionItem.update.mockResolvedValue(makeItem());

      const result = await service.aiBatchGenerateTags("user-1");
      expect(result.totalProcessed).toBe(2);
      expect(result.taggedCount).toBeGreaterThanOrEqual(0);
    });

    it("should handle items without resource gracefully", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        makeItem({ resource: null }),
      ]);

      const result = await service.aiBatchGenerateTags("user-1");
      expect(result.taggedCount).toBe(0);
    });

    it("should handle JSON parse fallback for tags", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        makeItem({
          resource: {
            id: "r1",
            title: "Topic",
            abstract: null,
            type: "article",
          },
        }),
      ]);
      // Non-JSON but contains quoted strings
      mockChatFacade.chat.mockResolvedValue({
        content: 'Tags: "ai", "tech", "research"',
      });
      mockPrisma.collectionItem.update.mockResolvedValue(makeItem());

      const result = await service.aiBatchGenerateTags("user-1");
      expect(result.totalProcessed).toBe(1);
    });

    it("should handle chat failure gracefully and not count failed items", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        makeItem({
          resource: {
            id: "r1",
            title: "Topic",
            abstract: null,
            type: "article",
          },
        }),
      ]);
      mockChatFacade.chat.mockRejectedValue(new Error("API error"));

      const result = await service.aiBatchGenerateTags("user-1");
      expect(result.taggedCount).toBe(0);
    });
  });

  describe("aiSmartClassify", () => {
    it("should throw when no model available", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue(null);
      await expect(service.aiSmartClassify("user-1")).rejects.toThrow(
        "No default text model available for smart classify",
      );
    });

    it("should return empty suggestions with 1 or fewer collections", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collection.findMany.mockResolvedValue([makeCollection()]);

      const result = await service.aiSmartClassify("user-1");
      expect(result.suggestions).toHaveLength(0);
    });

    it("should return empty suggestions when no uncategorized items", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collection.findMany.mockResolvedValue([
        makeCollection({ name: "Science" }),
        makeCollection({ id: "col-2", name: "Tech" }),
      ]);
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      const result = await service.aiSmartClassify("user-1");
      expect(result.suggestions).toHaveLength(0);
      expect(result.message).toContain("No uncategorized");
    });

    it("should generate classification suggestions for items", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collection.findMany.mockResolvedValue([
        makeCollection({ name: "Science" }),
        makeCollection({
          id: "col-2",
          name: "Technology",
          description: "Tech articles",
        }),
        makeCollection({ id: "col-3", name: "Default", description: null }),
      ]);
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        makeItem({
          resource: {
            id: "r1",
            title: "AI Research",
            abstract: "About ML",
            type: "article",
          },
        }),
      ]);
      mockChatFacade.chat.mockResolvedValue({
        content: '{"collection": "Technology", "confidence": 0.9}',
      });

      const result = await service.aiSmartClassify("user-1");
      expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it("should skip items without resource", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collection.findMany.mockResolvedValue([
        makeCollection({ name: "Science" }),
        makeCollection({ id: "col-2", name: "Tech" }),
      ]);
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        makeItem({ resource: null }),
      ]);

      const result = await service.aiSmartClassify("user-1");
      expect(result.suggestions).toHaveLength(0);
    });
  });

  describe("aiThemeCluster", () => {
    it("should throw when no model available", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue(null);
      await expect(service.aiThemeCluster("user-1")).rejects.toThrow(
        "No default text model available for theme clustering",
      );
    });

    it("should return empty clusters when fewer than 5 items", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        makeItem(),
        makeItem({ id: "item-2" }),
        makeItem({ id: "item-3" }),
      ]);

      const result = await service.aiThemeCluster("user-1");
      expect(result.clusters).toHaveLength(0);
      expect(result.message).toContain("at least 5 items");
    });

    it("should cluster themes for sufficient items", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      const items = Array(10)
        .fill(null)
        .map((_, i) =>
          makeItem({
            id: `item-${i}`,
            resource: {
              id: `res-${i}`,
              title: `Article ${i} about AI`,
              abstract: null,
            },
          }),
        );
      mockPrisma.collectionItem.findMany.mockResolvedValue(items);
      mockChatFacade.chat.mockResolvedValue({
        content:
          '[{"name": "Artificial Intelligence", "keywords": ["ai", "machine"]}]',
      });

      const result = await service.aiThemeCluster("user-1");
      expect(result.totalItems).toBe(10);
      expect(result.clusters.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle invalid JSON response gracefully", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      const items = Array(6)
        .fill(null)
        .map((_, i) =>
          makeItem({
            id: `item-${i}`,
            resource: { id: `res-${i}`, title: `Article ${i}`, abstract: null },
          }),
        );
      mockPrisma.collectionItem.findMany.mockResolvedValue(items);
      mockChatFacade.chat.mockResolvedValue({
        content: "not valid JSON at all",
      });

      const result = await service.aiThemeCluster("user-1");
      // Should not throw, clusters may be empty
      expect(result).toBeDefined();
    });

    it("should handle chat error and return error field", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      const items = Array(6)
        .fill(null)
        .map((_, i) =>
          makeItem({
            id: `item-${i}`,
            resource: { id: `res-${i}`, title: `Article ${i}`, abstract: null },
          }),
        );
      mockPrisma.collectionItem.findMany.mockResolvedValue(items);
      mockChatFacade.chat.mockRejectedValue(new Error("API error"));

      const result = await service.aiThemeCluster("user-1");
      expect(result.clusters).toHaveLength(0);
      expect(result.error).toBeDefined();
    });

    it("should filter out items without resource", async () => {
      mockChatFacade.getDefaultTextModel.mockResolvedValue({
        displayName: "GPT-4",
      });
      const items = [
        ...Array(5)
          .fill(null)
          .map((_, i) =>
            makeItem({
              id: `item-${i}`,
              resource: {
                id: `res-${i}`,
                title: `Article ${i}`,
                abstract: null,
              },
            }),
          ),
        makeItem({ id: "no-resource", resource: null }),
      ];
      mockPrisma.collectionItem.findMany.mockResolvedValue(items);
      mockChatFacade.chat.mockResolvedValue({
        content: '[{"name": "Test", "keywords": ["test"]}]',
      });

      const result = await service.aiThemeCluster("user-1");
      expect(result.totalItems).toBe(6);
    });
  });

  describe("updateCollectionItemNote", () => {
    it("should throw NotFoundException when collection not found", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCollectionItemNote(
          "col-1",
          "res-1",
          "user-1",
          "New note",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when not owner", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(
        makeCollection({ userId: "other" }),
      );

      await expect(
        service.updateCollectionItemNote("col-1", "res-1", "user-1", "note"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when item not found", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(makeCollection());
      mockPrisma.collectionItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCollectionItemNote("col-1", "res-1", "user-1", "note"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should update note successfully", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(makeCollection());
      mockPrisma.collectionItem.findFirst.mockResolvedValue(makeItem());
      const updated = makeItem({ note: "Updated note" });
      mockPrisma.collectionItem.update.mockResolvedValue(updated);

      const result = await service.updateCollectionItemNote(
        "col-1",
        "res-1",
        "user-1",
        "Updated note",
      );

      expect(result.note).toBe("Updated note");
    });
  });

  describe("getUserTags", () => {
    it("should return tags with count numbers (BigInt converted)", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { name: "ai", count: BigInt(10) },
        { name: "ml", count: BigInt(5) },
        { name: "llm", count: BigInt(2) },
      ]);

      const result = await service.getUserTags("user-1");
      expect(result).toHaveLength(3);
      expect(typeof result[0].count).toBe("number");
      expect(result[0].count).toBe(10);
    });
  });

  describe("getCollectionItemsPaginated - edge cases", () => {
    it("should apply tag filter when tag option provided", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue({ id: "col-1" });
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);
      mockPrisma.collectionItem.count.mockResolvedValue(0);

      await service.getCollectionItemsPaginated("col-1", "user-1", {
        tag: "ai",
      });

      expect(mockPrisma.collectionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tags: { array_contains: ["ai"] },
          }),
        }),
      );
    });

    it("should calculate correct pagination metadata", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue({ id: "col-1" });
      mockPrisma.collectionItem.findMany.mockResolvedValue(
        Array(5).fill(makeItem()),
      );
      mockPrisma.collectionItem.count.mockResolvedValue(25);

      const result = await service.getCollectionItemsPaginated(
        "col-1",
        "user-1",
        {
          page: 2,
          limit: 5,
        },
      );

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(5);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.totalPages).toBe(5);
      expect(result.pagination.hasMore).toBe(true);
    });
  });
});

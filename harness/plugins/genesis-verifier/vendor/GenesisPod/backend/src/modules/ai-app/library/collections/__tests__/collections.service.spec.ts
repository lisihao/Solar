// Mock modules with problematic transitive dependencies before any imports
jest.mock("../../../../../common/cache/cache.module", () => ({}));
jest.mock("../../../../../common/cache/cache.service", () => ({
  CacheService: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade");
jest.mock("@/modules/ai-harness/facade");
jest.mock("../../../../../common/prisma/prisma.service");

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { CollectionsService } from "../collections.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  CreateCollectionDto,
  UpdateCollectionDto,
  AddToCollectionDto,
  UpdateCollectionItemDto,
  BatchMoveItemsDto,
  BatchDeleteItemsDto,
  BatchUpdateTagsDto,
  BatchUpdateStatusDto,
} from "../dto";
import { ReadStatus } from "../dto/update-item.dto";

// ── Mock data ────────────────────────────────────────────────────────────────

const mockCollection = {
  id: "col-1",
  name: "Test Collection",
  description: "desc",
  userId: "user-1",
  isDefault: false,
  isPublic: false,
  icon: null,
  color: null,
  sortOrder: 0,
  tags: ["tag1"],
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const mockCollectionWithItems = {
  ...mockCollection,
  items: [],
  user: { id: "user-1", username: "testuser", avatarUrl: null },
};

const mockResource = {
  id: "res-1",
  type: "article",
  title: "Test Resource",
  abstract: "An abstract",
  thumbnailUrl: null,
  sourceUrl: null,
  publishedAt: null,
  upvoteCount: 0,
};

const mockCollectionItem = {
  id: "item-1",
  collectionId: "col-1",
  resourceId: "res-1",
  note: null,
  tags: [],
  readStatus: ReadStatus.UNREAD,
  readProgress: 0,
  lastReadAt: null,
  position: 0,
  addedAt: new Date("2024-01-01"),
  resource: mockResource,
  collection: { id: "col-1", name: "Test Collection", userId: "user-1" },
};

const mockDefaultModel = {
  id: "model-1",
  modelId: "test-model",
  displayName: "Test Model",
  provider: "openai",
  maxTokens: 4096,
};

// ── Mock Prisma ───────────────────────────────────────────────────────────────

const mockPrisma = {
  collection: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  collectionItem: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  resource: {
    findUnique: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn((cb) => cb(mockPrisma)),
};

// ── Mock Facade ───────────────────────────────────────────────────────────────

const mockFacade = {
  getDefaultTextModel: jest.fn(),
  chat: jest.fn(),
};

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("CollectionsService", () => {
  let service: CollectionsService;

  beforeEach(async () => {
    // Reset mock implementations
    mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
    mockFacade.chat.mockResolvedValue({
      content: '["machine-learning", "nlp", "ai"]',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<CollectionsService>(CollectionsService);
    jest.clearAllMocks();

    // Re-set after clearAllMocks
    mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
    mockFacade.chat.mockResolvedValue({
      content: '["machine-learning", "nlp", "ai"]',
    });
  });

  // ── createCollection ────────────────────────────────────────────────────────

  describe("createCollection", () => {
    const dto: CreateCollectionDto = {
      name: "Test Collection",
      description: "desc",
    };

    it("creates a new collection when no duplicate exists", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue(null);
      mockPrisma.collection.create.mockResolvedValue(mockCollectionWithItems);

      const result = await service.createCollection("user-1", dto);

      expect(result).toEqual(mockCollectionWithItems);
      expect(mockPrisma.collection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: "user-1",
            name: "Test Collection",
          }),
        }),
      );
    });

    it("returns existing collection when duplicate name exists for same user", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue(mockCollection);

      const result = await service.createCollection("user-1", dto);

      expect(result).toEqual(mockCollection);
      expect(mockPrisma.collection.create).not.toHaveBeenCalled();
    });

    it("sets isPublic to false by default", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue(null);
      mockPrisma.collection.create.mockResolvedValue(mockCollectionWithItems);

      await service.createCollection("user-1", { name: "New Collection" });

      expect(mockPrisma.collection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPublic: false }),
        }),
      );
    });

    it("respects isPublic flag when provided", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue(null);
      mockPrisma.collection.create.mockResolvedValue(mockCollectionWithItems);

      await service.createCollection("user-1", {
        name: "Public Collection",
        isPublic: true,
      });

      expect(mockPrisma.collection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isPublic: true }),
        }),
      );
    });
  });

  // ── getUserCollections ──────────────────────────────────────────────────────

  describe("getUserCollections", () => {
    it("returns empty array when user has no collections", async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);

      const result = await service.getUserCollections("user-1");

      expect(result).toEqual([]);
      expect(mockPrisma.collectionItem.findMany).not.toHaveBeenCalled();
    });

    it("returns collections with itemCount and preview items", async () => {
      const collectionsWithCount = [
        { ...mockCollection, _count: { items: 3 } },
      ];
      mockPrisma.collection.findMany.mockResolvedValue(collectionsWithCount);
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        {
          id: "item-1",
          collectionId: "col-1",
          position: 0,
          resource: {
            id: "res-1",
            type: "article",
            title: "Test Resource",
            thumbnailUrl: null,
            publishedAt: null,
          },
        },
      ]);

      const result = await service.getUserCollections("user-1");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "col-1",
        itemCount: 3,
        items: expect.arrayContaining([
          expect.objectContaining({ id: "item-1" }),
        ]),
      });
    });

    it("batches preview items up to 10 per collection", async () => {
      const collectionsWithCount = [
        { ...mockCollection, _count: { items: 15 } },
      ];
      mockPrisma.collection.findMany.mockResolvedValue(collectionsWithCount);

      const manyItems = Array.from({ length: 15 }, (_, i) => ({
        id: `item-${i}`,
        collectionId: "col-1",
        position: i,
        resource: {
          id: `res-${i}`,
          type: "article",
          title: `Resource ${i}`,
          thumbnailUrl: null,
          publishedAt: null,
        },
      }));
      mockPrisma.collectionItem.findMany.mockResolvedValue(manyItems);

      const result = await service.getUserCollections("user-1");

      expect(result[0].items).toHaveLength(10);
    });
  });

  // ── getCollection ───────────────────────────────────────────────────────────

  describe("getCollection", () => {
    it("returns collection with itemCount for owner", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollectionWithItems,
        items: [mockCollectionItem],
      });

      const result = await service.getCollection("col-1", "user-1");

      expect(result).toMatchObject({ id: "col-1", itemCount: 1 });
    });

    it("throws NotFoundException when collection does not exist", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.getCollection("col-x", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when accessing private collection of another user", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollectionWithItems,
        isPublic: false,
        userId: "other-user",
        items: [],
      });

      await expect(service.getCollection("col-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("returns public collection without userId", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollectionWithItems,
        isPublic: true,
        userId: "other-user",
        items: [],
      });

      const result = await service.getCollection("col-1");

      expect(result).toMatchObject({ id: "col-1", itemCount: 0 });
    });
  });

  // ── updateCollection ────────────────────────────────────────────────────────

  describe("updateCollection", () => {
    const dto: UpdateCollectionDto = { name: "Updated Name" };

    it("updates collection for owner", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(mockCollection);
      const updated = { ...mockCollectionWithItems, name: "Updated Name" };
      mockPrisma.collection.update.mockResolvedValue(updated);

      const result = await service.updateCollection("col-1", "user-1", dto);

      expect(result.name).toBe("Updated Name");
      expect(mockPrisma.collection.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "col-1" } }),
      );
    });

    it("throws NotFoundException when collection does not exist", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCollection("col-x", "user-1", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when updating another user's collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        userId: "other-user",
      });

      await expect(
        service.updateCollection("col-1", "user-1", dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── deleteCollection ────────────────────────────────────────────────────────

  describe("deleteCollection", () => {
    it("deletes collection for owner and returns success", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(mockCollection);
      mockPrisma.collection.delete.mockResolvedValue(mockCollection);

      const result = await service.deleteCollection("col-1", "user-1");

      expect(result).toEqual({ success: true });
      expect(mockPrisma.collection.delete).toHaveBeenCalledWith({
        where: { id: "col-1" },
      });
    });

    it("throws NotFoundException when collection does not exist", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.deleteCollection("col-x", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when deleting another user's collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        userId: "other-user",
      });

      await expect(service.deleteCollection("col-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── addToCollection ─────────────────────────────────────────────────────────

  describe("addToCollection", () => {
    const dto: AddToCollectionDto = { resourceId: "res-1" };

    it("adds a new resource item to the collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        items: [],
      });
      mockPrisma.collectionItem.create.mockResolvedValue(mockCollectionItem);
      // suppress auto-tag by returning no model
      mockFacade.getDefaultTextModel.mockResolvedValue(null);

      const result = await service.addToCollection("col-1", "user-1", dto);

      expect(result).toMatchObject({ success: true });
      expect(mockPrisma.collectionItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            collectionId: "col-1",
            resourceId: "res-1",
          }),
        }),
      );
    });

    it("returns early with message when resource already in collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        items: [{ resourceId: "res-1" }],
      });

      const result = await service.addToCollection("col-1", "user-1", dto);

      expect(result).toEqual({
        success: true,
        message: "Resource already in collection",
      });
      expect(mockPrisma.collectionItem.create).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when collection does not exist", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      await expect(
        service.addToCollection("col-x", "user-1", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when adding to another user's collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        userId: "other-user",
        items: [],
      });

      await expect(
        service.addToCollection("col-1", "user-1", dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── removeFromCollection ────────────────────────────────────────────────────

  describe("removeFromCollection", () => {
    it("removes resource from collection and returns success", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(mockCollection);
      mockPrisma.collectionItem.findFirst.mockResolvedValue(mockCollectionItem);
      mockPrisma.collectionItem.delete.mockResolvedValue(mockCollectionItem);

      const result = await service.removeFromCollection(
        "col-1",
        "res-1",
        "user-1",
      );

      expect(result).toEqual({ success: true });
      expect(mockPrisma.collectionItem.delete).toHaveBeenCalledWith({
        where: { id: "item-1" },
      });
    });

    it("throws NotFoundException when collection does not exist", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      await expect(
        service.removeFromCollection("col-x", "res-1", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when removing from another user's collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        userId: "other-user",
      });

      await expect(
        service.removeFromCollection("col-1", "res-1", "user-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when item not in collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(mockCollection);
      mockPrisma.collectionItem.findFirst.mockResolvedValue(null);

      await expect(
        service.removeFromCollection("col-1", "res-missing", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateCollectionItemNote ────────────────────────────────────────────────

  describe("updateCollectionItemNote", () => {
    it("updates item note for collection owner", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(mockCollection);
      mockPrisma.collectionItem.findFirst.mockResolvedValue(mockCollectionItem);
      const updatedItem = { ...mockCollectionItem, note: "New note" };
      mockPrisma.collectionItem.update.mockResolvedValue(updatedItem);

      const result = await service.updateCollectionItemNote(
        "col-1",
        "res-1",
        "user-1",
        "New note",
      );

      expect(result.note).toBe("New note");
      expect(mockPrisma.collectionItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { note: "New note" } }),
      );
    });

    it("throws NotFoundException when collection not found", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCollectionItemNote("col-x", "res-1", "user-1", "note"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when updating note in another user's collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        userId: "other-user",
      });

      await expect(
        service.updateCollectionItemNote("col-1", "res-1", "user-1", "note"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when item not found in collection", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(mockCollection);
      mockPrisma.collectionItem.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCollectionItemNote("col-1", "res-x", "user-1", "note"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── isResourceInUserCollections ─────────────────────────────────────────────

  describe("isResourceInUserCollections", () => {
    it("returns isCollected true with collection list when resource is collected", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        {
          ...mockCollectionItem,
          collection: { id: "col-1", name: "Test Collection" },
        },
      ]);

      const result = await service.isResourceInUserCollections(
        "user-1",
        "res-1",
      );

      expect(result.isCollected).toBe(true);
      expect(result.collections).toHaveLength(1);
      expect(result.collections[0]).toMatchObject({ id: "col-1" });
    });

    it("returns isCollected false with empty list when resource is not collected", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      const result = await service.isResourceInUserCollections(
        "user-1",
        "res-missing",
      );

      expect(result.isCollected).toBe(false);
      expect(result.collections).toHaveLength(0);
    });
  });

  // ── updateCollectionItem ────────────────────────────────────────────────────

  describe("updateCollectionItem", () => {
    const dto: UpdateCollectionItemDto = {
      tags: ["updated-tag"],
      readStatus: ReadStatus.READING,
    };

    it("updates item tags and read status for owner", async () => {
      mockPrisma.collectionItem.findUnique.mockResolvedValue({
        ...mockCollectionItem,
        collection: { userId: "user-1" },
      });
      const updatedItem = { ...mockCollectionItem, tags: ["updated-tag"] };
      mockPrisma.collectionItem.update.mockResolvedValue(updatedItem);

      const result = await service.updateCollectionItem(
        "item-1",
        "user-1",
        dto,
      );

      expect(mockPrisma.collectionItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "item-1" } }),
      );
      expect(result).toMatchObject({ tags: ["updated-tag"] });
    });

    it("sets lastReadAt when readProgress > 0", async () => {
      mockPrisma.collectionItem.findUnique.mockResolvedValue({
        ...mockCollectionItem,
        collection: { userId: "user-1" },
      });
      mockPrisma.collectionItem.update.mockResolvedValue(mockCollectionItem);

      await service.updateCollectionItem("item-1", "user-1", {
        readProgress: 50,
      });

      expect(mockPrisma.collectionItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            readProgress: 50,
            lastReadAt: expect.any(Date),
          }),
        }),
      );
    });

    it("throws NotFoundException when item does not exist", async () => {
      mockPrisma.collectionItem.findUnique.mockResolvedValue(null);

      await expect(
        service.updateCollectionItem("item-x", "user-1", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when updating another user's item", async () => {
      mockPrisma.collectionItem.findUnique.mockResolvedValue({
        ...mockCollectionItem,
        collection: { userId: "other-user" },
      });

      await expect(
        service.updateCollectionItem("item-1", "user-1", dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── getUserTags ─────────────────────────────────────────────────────────────

  describe("getUserTags", () => {
    it("returns tag name and count from raw query", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { name: "machine-learning", count: BigInt(5) },
        { name: "nlp", count: BigInt(3) },
      ]);

      const result = await service.getUserTags("user-1");

      expect(result).toEqual([
        { name: "machine-learning", count: 5 },
        { name: "nlp", count: 3 },
      ]);
    });

    it("returns empty array when user has no tags", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getUserTags("user-1");

      expect(result).toEqual([]);
    });

    it("converts BigInt count to Number", async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { name: "tag1", count: BigInt(100) },
      ]);

      const result = await service.getUserTags("user-1");

      expect(typeof result[0].count).toBe("number");
      expect(result[0].count).toBe(100);
    });
  });

  // ── batchMoveItems ──────────────────────────────────────────────────────────

  describe("batchMoveItems", () => {
    const dto: BatchMoveItemsDto = {
      itemIds: ["item-1", "item-2"],
      targetCollectionId: "col-2",
    };

    it("moves items to target collection and returns movedCount", async () => {
      const targetCollection = { ...mockCollection, id: "col-2" };
      mockPrisma.collection.findUnique.mockResolvedValue(targetCollection);
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, id: "item-1" },
        { ...mockCollectionItem, id: "item-2" },
      ]);
      mockPrisma.collectionItem.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.batchMoveItems("user-1", dto);

      expect(result).toEqual({ success: true, movedCount: 2 });
      expect(mockPrisma.collectionItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { collectionId: "col-2" },
        }),
      );
    });

    it("throws NotFoundException when target collection does not exist", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      await expect(service.batchMoveItems("user-1", dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when target collection belongs to another user", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        id: "col-2",
        userId: "other-user",
      });

      await expect(service.batchMoveItems("user-1", dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("throws ForbiddenException when some items do not belong to user", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue({
        ...mockCollection,
        id: "col-2",
      });
      // Only 1 item found vs 2 requested
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, id: "item-1" },
      ]);

      await expect(service.batchMoveItems("user-1", dto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── batchDeleteItems ────────────────────────────────────────────────────────

  describe("batchDeleteItems", () => {
    const dto: BatchDeleteItemsDto = { itemIds: ["item-1", "item-2"] };

    it("deletes items and returns deletedCount", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, id: "item-1" },
        { ...mockCollectionItem, id: "item-2" },
      ]);
      mockPrisma.collectionItem.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.batchDeleteItems("user-1", dto);

      expect(result).toEqual({ success: true, deletedCount: 2 });
    });

    it("throws ForbiddenException when some items do not belong to user", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, id: "item-1" },
      ]); // Only 1 found but 2 requested

      await expect(service.batchDeleteItems("user-1", dto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── batchUpdateTags ─────────────────────────────────────────────────────────

  describe("batchUpdateTags", () => {
    it('sets tags when operation is "set"', async () => {
      const dto: BatchUpdateTagsDto = {
        itemIds: ["item-1"],
        tags: ["new-tag"],
        operation: "set",
      };
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, tags: ["old-tag"] },
      ]);
      mockPrisma.collectionItem.update.mockResolvedValue(mockCollectionItem);

      const result = await service.batchUpdateTags("user-1", dto);

      expect(result).toEqual({ success: true, updatedCount: 1 });
      expect(mockPrisma.collectionItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tags: ["new-tag"] } }),
      );
    });

    it('adds tags when operation is "add"', async () => {
      const dto: BatchUpdateTagsDto = {
        itemIds: ["item-1"],
        tags: ["new-tag"],
        operation: "add",
      };
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, tags: ["existing-tag"] },
      ]);
      mockPrisma.collectionItem.update.mockResolvedValue(mockCollectionItem);

      await service.batchUpdateTags("user-1", dto);

      expect(mockPrisma.collectionItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            tags: expect.arrayContaining(["existing-tag", "new-tag"]),
          },
        }),
      );
    });

    it('removes tags when operation is "remove"', async () => {
      const dto: BatchUpdateTagsDto = {
        itemIds: ["item-1"],
        tags: ["remove-me"],
        operation: "remove",
      };
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, tags: ["keep-me", "remove-me"] },
      ]);
      mockPrisma.collectionItem.update.mockResolvedValue(mockCollectionItem);

      await service.batchUpdateTags("user-1", dto);

      expect(mockPrisma.collectionItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { tags: ["keep-me"] },
        }),
      );
    });

    it("throws ForbiddenException when some items do not belong to user", async () => {
      const dto: BatchUpdateTagsDto = {
        itemIds: ["item-1", "item-2"],
        tags: ["tag"],
        operation: "set",
      };
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, id: "item-1" },
      ]);

      await expect(service.batchUpdateTags("user-1", dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("deduplicates tags on add operation", async () => {
      const dto: BatchUpdateTagsDto = {
        itemIds: ["item-1"],
        tags: ["dup-tag"],
        operation: "add",
      };
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, tags: ["dup-tag"] },
      ]);
      mockPrisma.collectionItem.update.mockResolvedValue(mockCollectionItem);

      await service.batchUpdateTags("user-1", dto);

      const updateCall = mockPrisma.collectionItem.update.mock.calls[0][0] as {
        data: { tags: string[] };
      };
      const tagsArg = updateCall.data.tags;
      expect(tagsArg.filter((t: string) => t === "dup-tag")).toHaveLength(1);
    });
  });

  // ── batchUpdateStatus ───────────────────────────────────────────────────────

  describe("batchUpdateStatus", () => {
    const dto: BatchUpdateStatusDto = {
      itemIds: ["item-1", "item-2"],
      status: ReadStatus.COMPLETED,
    };

    it("updates status for all owned items", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, id: "item-1" },
        { ...mockCollectionItem, id: "item-2" },
      ]);
      mockPrisma.collectionItem.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.batchUpdateStatus("user-1", dto);

      expect(result).toEqual({ success: true, updatedCount: 2 });
      expect(mockPrisma.collectionItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { readStatus: ReadStatus.COMPLETED },
        }),
      );
    });

    it("throws ForbiddenException when some items do not belong to user", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        { ...mockCollectionItem, id: "item-1" },
      ]); // 1 found vs 2 requested

      await expect(service.batchUpdateStatus("user-1", dto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── getUserStats ────────────────────────────────────────────────────────────

  describe("getUserStats", () => {
    it("returns total, recent items and status counts", async () => {
      mockPrisma.collectionItem.count
        .mockResolvedValueOnce(10) // totalItems
        .mockResolvedValueOnce(3); // recentItems
      mockPrisma.collectionItem.groupBy.mockResolvedValue([
        { readStatus: "UNREAD", _count: { readStatus: 7 } },
        { readStatus: "COMPLETED", _count: { readStatus: 3 } },
      ]);

      const result = await service.getUserStats("user-1");

      expect(result).toMatchObject({
        totalItems: 10,
        recentItems: 3,
        byStatus: {
          UNREAD: 7,
          COMPLETED: 3,
        },
      });
    });

    it("returns zero counts when user has no items", async () => {
      mockPrisma.collectionItem.count.mockResolvedValue(0);
      mockPrisma.collectionItem.groupBy.mockResolvedValue([]);

      const result = await service.getUserStats("user-1");

      expect(result.totalItems).toBe(0);
      expect(result.recentItems).toBe(0);
      expect(result.byStatus).toEqual({});
    });
  });

  // ── getCollectionItemsPaginated ─────────────────────────────────────────────

  describe("getCollectionItemsPaginated", () => {
    it("returns paginated items for a specific collection", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue({ id: "col-1" });
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        mockCollectionItem,
      ]);
      mockPrisma.collectionItem.count.mockResolvedValue(1);

      const result = await service.getCollectionItemsPaginated(
        "col-1",
        "user-1",
        { page: 1, limit: 20 },
      );

      expect(result.items).toHaveLength(1);
      expect(result.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasMore: false,
      });
    });

    it("returns empty result when collection not owned by user", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue(null);

      const result = await service.getCollectionItemsPaginated(
        "col-x",
        "user-1",
        {},
      );

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });

    it("returns all user items when collectionId is null", async () => {
      mockPrisma.collection.findMany.mockResolvedValue([
        { id: "col-1" },
        { id: "col-2" },
      ]);
      mockPrisma.collectionItem.findMany.mockResolvedValue([
        mockCollectionItem,
      ]);
      mockPrisma.collectionItem.count.mockResolvedValue(1);

      const result = await service.getCollectionItemsPaginated(null, "user-1", {
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
    });

    it("returns empty result when user has no collections (null collectionId)", async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);

      const result = await service.getCollectionItemsPaginated(
        null,
        "user-1",
        {},
      );

      expect(result.items).toHaveLength(0);
    });

    it("caps limit at 100", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue({ id: "col-1" });
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);
      mockPrisma.collectionItem.count.mockResolvedValue(0);

      await service.getCollectionItemsPaginated("col-1", "user-1", {
        limit: 9999,
      });

      expect(mockPrisma.collectionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it("applies status filter when provided", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue({ id: "col-1" });
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);
      mockPrisma.collectionItem.count.mockResolvedValue(0);

      await service.getCollectionItemsPaginated("col-1", "user-1", {
        status: "COMPLETED",
      });

      expect(mockPrisma.collectionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ readStatus: "COMPLETED" }),
        }),
      );
    });

    it("calculates hasMore correctly", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue({ id: "col-1" });
      mockPrisma.collectionItem.findMany.mockResolvedValue(
        Array(10).fill(mockCollectionItem),
      );
      mockPrisma.collectionItem.count.mockResolvedValue(25);

      const result = await service.getCollectionItemsPaginated(
        "col-1",
        "user-1",
        { page: 1, limit: 10 },
      );

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.totalPages).toBe(3);
    });
  });

  // ── aiBatchGenerateTags ─────────────────────────────────────────────────────

  describe("aiBatchGenerateTags", () => {
    it("returns zero count when no untagged items found", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      const result = await service.aiBatchGenerateTags("user-1");

      expect(result).toMatchObject({
        taggedCount: 0,
        message: "No items without tags found",
      });
    });

    it("throws when no default text model is available", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(null);

      await expect(service.aiBatchGenerateTags("user-1")).rejects.toThrow(
        "No default text model available for batch tagging",
      );
    });

    it("tags items using AI and updates them in the database", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      const untaggedItem = {
        ...mockCollectionItem,
        tags: [],
        resource: { ...mockResource, abstract: "deep learning paper" },
      };
      mockPrisma.collectionItem.findMany.mockResolvedValue([untaggedItem]);
      mockFacade.chat.mockResolvedValue({
        content: '["deep-learning", "ai", "research"]',
      });
      mockPrisma.collectionItem.update.mockResolvedValue({
        ...untaggedItem,
        tags: ["deep-learning", "ai", "research"],
      });

      const result = await service.aiBatchGenerateTags("user-1");

      expect(result.taggedCount).toBe(1);
      expect(result.totalProcessed).toBe(1);
      expect(mockPrisma.collectionItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tags: expect.arrayContaining(["deep-learning"]),
          }),
        }),
      );
    });

    it("filters by collectionId when provided", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      await service.aiBatchGenerateTags("user-1", "col-1");

      expect(mockPrisma.collectionItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ collectionId: "col-1" }),
        }),
      );
    });
  });

  // ── aiSmartClassify ─────────────────────────────────────────────────────────

  describe("aiSmartClassify", () => {
    it("returns early message when user has less than 2 collections", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockPrisma.collection.findMany.mockResolvedValue([mockCollection]);

      const result = await service.aiSmartClassify("user-1");

      expect(result).toMatchObject({
        suggestions: [],
        message: "Need at least 2 collections for smart classification",
      });
    });

    it("returns empty suggestions when no default items found", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockPrisma.collection.findMany.mockResolvedValue([
        mockCollection,
        { ...mockCollection, id: "col-2", name: "Tech" },
      ]);
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      const result = await service.aiSmartClassify("user-1");

      expect(result).toMatchObject({
        suggestions: [],
        message: "No uncategorized items to classify",
      });
    });

    it("throws when no default text model is available", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(null);

      await expect(service.aiSmartClassify("user-1")).rejects.toThrow(
        "No default text model available for smart classify",
      );
    });

    it("returns classification suggestions from AI", async () => {
      mockFacade.getDefaultTextModel.mockResolvedValue(mockDefaultModel);
      mockPrisma.collection.findMany.mockResolvedValue([
        { id: "col-1", name: "Default", description: null },
        { id: "col-2", name: "Tech", description: "Tech articles" },
        { id: "col-3", name: "Science", description: "Science papers" },
      ]);
      const defaultItem = {
        id: "item-1",
        resource: {
          id: "res-1",
          title: "ML Paper",
          abstract: "About ML",
          type: "paper",
        },
      };
      mockPrisma.collectionItem.findMany.mockResolvedValue([defaultItem]);
      mockFacade.chat.mockResolvedValue({
        content: '{"collection": "Tech", "confidence": 0.9}',
      });

      const result = await service.aiSmartClassify("user-1");

      expect(result).toHaveProperty("suggestions");
      expect(result).toHaveProperty("totalProcessed");
    });
  });
});

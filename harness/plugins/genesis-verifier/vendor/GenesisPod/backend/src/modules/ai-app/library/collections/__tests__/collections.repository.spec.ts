import { Test, TestingModule } from "@nestjs/testing";
import { CollectionsRepository } from "../collections.repository";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("CollectionsRepository", () => {
  let repository: CollectionsRepository;
  let mockPrisma: {
    collection: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    collectionItem: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
  };

  const buildCollection = (id: string, userId = "user-1") => ({
    id,
    userId,
    name: `Collection ${id}`,
    description: null,
    isPublic: false,
    sortOrder: 0,
    coverImage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const buildCollectionItem = (
    id: string,
    collectionId = "col-1",
    resourceId = "res-1",
  ) => ({
    id,
    collectionId,
    resourceId,
    position: 0,
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeAll(async () => {
    mockPrisma = {
      collection: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      collectionItem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionsRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get<CollectionsRepository>(CollectionsRepository);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== findByUserId ====================

  describe("findByUserId", () => {
    it("should return collections for a user ordered by sortOrder asc", async () => {
      const collections = [buildCollection("c1"), buildCollection("c2")];
      mockPrisma.collection.findMany.mockResolvedValue(collections);

      const result = await repository.findByUserId("user-1");

      expect(result).toEqual(collections);
      expect(mockPrisma.collection.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        include: undefined,
        orderBy: { sortOrder: "asc" },
      });
    });

    it("should pass include option when provided", async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);
      const include = { items: true };

      await repository.findByUserId("user-1", include);

      expect(mockPrisma.collection.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        include,
        orderBy: { sortOrder: "asc" },
      });
    });

    it("should return empty array when user has no collections", async () => {
      mockPrisma.collection.findMany.mockResolvedValue([]);

      const result = await repository.findByUserId("new-user");

      expect(result).toEqual([]);
    });
  });

  // ==================== findById ====================

  describe("findById", () => {
    it("should return a collection by ID", async () => {
      const collection = buildCollection("c1");
      mockPrisma.collection.findUnique.mockResolvedValue(collection);

      const result = await repository.findById("c1");

      expect(result).toEqual(collection);
      expect(mockPrisma.collection.findUnique).toHaveBeenCalledWith({
        where: { id: "c1" },
        include: undefined,
      });
    });

    it("should return null when collection not found", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);

      const result = await repository.findById("nonexistent");

      expect(result).toBeNull();
    });

    it("should pass include option to findUnique", async () => {
      mockPrisma.collection.findUnique.mockResolvedValue(null);
      const include = { items: { include: { resource: true } } };

      await repository.findById("c1", include);

      expect(mockPrisma.collection.findUnique).toHaveBeenCalledWith({
        where: { id: "c1" },
        include,
      });
    });
  });

  // ==================== findByUserAndName ====================

  describe("findByUserAndName", () => {
    it("should find a collection by userId and name", async () => {
      const collection = buildCollection("c1");
      mockPrisma.collection.findFirst.mockResolvedValue(collection);

      const result = await repository.findByUserAndName("user-1", "My Reads");

      expect(result).toEqual(collection);
      expect(mockPrisma.collection.findFirst).toHaveBeenCalledWith({
        where: { userId: "user-1", name: "My Reads" },
      });
    });

    it("should return null when no matching collection", async () => {
      mockPrisma.collection.findFirst.mockResolvedValue(null);

      const result = await repository.findByUserAndName("user-1", "Unknown");

      expect(result).toBeNull();
    });
  });

  // ==================== create ====================

  describe("create", () => {
    it("should create a collection", async () => {
      const newCollection = buildCollection("c-new");
      mockPrisma.collection.create.mockResolvedValue(newCollection);

      const result = await repository.create({
        userId: "user-1",
        name: "My Collection",
        user: { connect: { id: "user-1" } },
      });

      expect(result).toEqual(newCollection);
      expect(mockPrisma.collection.create).toHaveBeenCalled();
    });

    it("should pass include option when provided", async () => {
      const newCollection = buildCollection("c-new");
      mockPrisma.collection.create.mockResolvedValue(newCollection);
      const include = { items: true };

      await repository.create(
        { user: { connect: { id: "user-1" } }, name: "Test" },
        include,
      );

      const call = mockPrisma.collection.create.mock.calls[0][0];
      expect(call.include).toEqual(include);
    });
  });

  // ==================== update ====================

  describe("update", () => {
    it("should update a collection", async () => {
      const updated = buildCollection("c1");
      updated.name = "Updated Name";
      mockPrisma.collection.update.mockResolvedValue(updated);

      const result = await repository.update("c1", { name: "Updated Name" });

      expect(result.name).toBe("Updated Name");
      expect(mockPrisma.collection.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { name: "Updated Name" },
        include: undefined,
      });
    });

    it("should pass include option when updating", async () => {
      const updated = buildCollection("c1");
      mockPrisma.collection.update.mockResolvedValue(updated);
      const include = { items: true };

      await repository.update("c1", { isPublic: true }, include);

      const call = mockPrisma.collection.update.mock.calls[0][0];
      expect(call.include).toEqual(include);
    });
  });

  // ==================== delete ====================

  describe("delete", () => {
    it("should delete a collection by ID", async () => {
      const deleted = buildCollection("c1");
      mockPrisma.collection.delete.mockResolvedValue(deleted);

      const result = await repository.delete("c1");

      expect(result).toEqual(deleted);
      expect(mockPrisma.collection.delete).toHaveBeenCalledWith({
        where: { id: "c1" },
      });
    });
  });

  // ==================== countByUserId ====================

  describe("countByUserId", () => {
    it("should return count of collections for a user", async () => {
      mockPrisma.collection.count.mockResolvedValue(5);

      const result = await repository.countByUserId("user-1");

      expect(result).toBe(5);
      expect(mockPrisma.collection.count).toHaveBeenCalledWith({
        where: { userId: "user-1" },
      });
    });

    it("should return 0 when user has no collections", async () => {
      mockPrisma.collection.count.mockResolvedValue(0);

      const result = await repository.countByUserId("new-user");

      expect(result).toBe(0);
    });
  });

  // ==================== findItemsByCollectionId ====================

  describe("findItemsByCollectionId", () => {
    it("should return items ordered by position asc", async () => {
      const items = [
        buildCollectionItem("i1", "col-1", "res-1"),
        buildCollectionItem("i2", "col-1", "res-2"),
      ];
      mockPrisma.collectionItem.findMany.mockResolvedValue(items);

      const result = await repository.findItemsByCollectionId("col-1");

      expect(result).toEqual(items);
      expect(mockPrisma.collectionItem.findMany).toHaveBeenCalledWith({
        where: { collectionId: "col-1" },
        include: undefined,
        orderBy: { position: "asc" },
      });
    });

    it("should pass include option", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);
      const include = { resource: true };

      await repository.findItemsByCollectionId("col-1", include);

      const call = mockPrisma.collectionItem.findMany.mock.calls[0][0];
      expect(call.include).toEqual(include);
    });
  });

  // ==================== findItemById ====================

  describe("findItemById", () => {
    it("should return collection item by ID", async () => {
      const item = buildCollectionItem("i1");
      mockPrisma.collectionItem.findUnique.mockResolvedValue(item);

      const result = await repository.findItemById("i1");

      expect(result).toEqual(item);
    });

    it("should return null when item not found", async () => {
      mockPrisma.collectionItem.findUnique.mockResolvedValue(null);

      const result = await repository.findItemById("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ==================== findItemByCollectionAndResource ====================

  describe("findItemByCollectionAndResource", () => {
    it("should find item by collectionId and resourceId", async () => {
      const item = buildCollectionItem("i1", "col-1", "res-1");
      mockPrisma.collectionItem.findFirst.mockResolvedValue(item);

      const result = await repository.findItemByCollectionAndResource(
        "col-1",
        "res-1",
      );

      expect(result).toEqual(item);
      expect(mockPrisma.collectionItem.findFirst).toHaveBeenCalledWith({
        where: { collectionId: "col-1", resourceId: "res-1" },
      });
    });

    it("should return null when not found", async () => {
      mockPrisma.collectionItem.findFirst.mockResolvedValue(null);

      const result = await repository.findItemByCollectionAndResource(
        "col-1",
        "res-99",
      );

      expect(result).toBeNull();
    });
  });

  // ==================== createItem ====================

  describe("createItem", () => {
    it("should create a collection item", async () => {
      const newItem = buildCollectionItem("i-new");
      mockPrisma.collectionItem.create.mockResolvedValue(newItem);

      const result = await repository.createItem({
        collection: { connect: { id: "col-1" } },
        resource: { connect: { id: "res-1" } },
        position: 0,
      });

      expect(result).toEqual(newItem);
    });
  });

  // ==================== updateItem ====================

  describe("updateItem", () => {
    it("should update a collection item", async () => {
      const updated = buildCollectionItem("i1");
      mockPrisma.collectionItem.update.mockResolvedValue(updated);

      const result = await repository.updateItem("i1", { note: "Read later" });

      expect(result).toEqual(updated);
      expect(mockPrisma.collectionItem.update).toHaveBeenCalledWith({
        where: { id: "i1" },
        data: { note: "Read later" },
        include: undefined,
      });
    });
  });

  // ==================== deleteItem ====================

  describe("deleteItem", () => {
    it("should delete a collection item", async () => {
      const deleted = buildCollectionItem("i1");
      mockPrisma.collectionItem.delete.mockResolvedValue(deleted);

      const result = await repository.deleteItem("i1");

      expect(result).toEqual(deleted);
      expect(mockPrisma.collectionItem.delete).toHaveBeenCalledWith({
        where: { id: "i1" },
      });
    });
  });

  // ==================== updateManyItems ====================

  describe("updateManyItems", () => {
    it("should batch update collection items", async () => {
      mockPrisma.collectionItem.updateMany.mockResolvedValue({ count: 3 });

      const result = await repository.updateManyItems(
        { collectionId: "col-1" },
        { position: 0 },
      );

      expect(result.count).toBe(3);
      expect(mockPrisma.collectionItem.updateMany).toHaveBeenCalledWith({
        where: { collectionId: "col-1" },
        data: { position: 0 },
      });
    });

    it("should return count=0 when no items matched", async () => {
      mockPrisma.collectionItem.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.updateManyItems(
        { collectionId: "nonexistent" },
        { note: "test" },
      );

      expect(result.count).toBe(0);
    });
  });

  // ==================== deleteManyItems ====================

  describe("deleteManyItems", () => {
    it("should batch delete collection items", async () => {
      mockPrisma.collectionItem.deleteMany.mockResolvedValue({ count: 2 });

      const result = await repository.deleteManyItems({
        collectionId: "col-1",
      });

      expect(result.count).toBe(2);
      expect(mockPrisma.collectionItem.deleteMany).toHaveBeenCalledWith({
        where: { collectionId: "col-1" },
      });
    });
  });

  // ==================== countItems ====================

  describe("countItems", () => {
    it("should return count for given where clause", async () => {
      mockPrisma.collectionItem.count.mockResolvedValue(7);

      const result = await repository.countItems({ collectionId: "col-1" });

      expect(result).toBe(7);
      expect(mockPrisma.collectionItem.count).toHaveBeenCalledWith({
        where: { collectionId: "col-1" },
      });
    });
  });

  // ==================== findItems ====================

  describe("findItems", () => {
    it("should find items with pagination params", async () => {
      const items = [buildCollectionItem("i1")];
      mockPrisma.collectionItem.findMany.mockResolvedValue(items);

      const result = await repository.findItems({
        where: { collectionId: "col-1" },
        skip: 0,
        take: 10,
      });

      expect(result).toEqual(items);
      expect(mockPrisma.collectionItem.findMany).toHaveBeenCalledWith({
        where: { collectionId: "col-1" },
        skip: 0,
        take: 10,
        select: undefined,
        include: undefined,
        orderBy: undefined,
      });
    });
  });

  // ==================== groupBy ====================

  describe("groupBy", () => {
    it("should group by specified fields", async () => {
      const groupByResult = [{ collectionId: "col-1", _count: { id: 5 } }];
      mockPrisma.collectionItem.groupBy.mockResolvedValue(groupByResult);

      const result = await repository.groupBy({
        by: ["collectionId"] as never,
        _count: { id: true } as never,
      });

      expect(result).toEqual(groupByResult);
      expect(mockPrisma.collectionItem.groupBy).toHaveBeenCalled();
    });
  });

  // ==================== findUserItems ====================

  describe("findUserItems", () => {
    it("should find all items for a user across collections", async () => {
      const items = [
        buildCollectionItem("i1", "col-1"),
        buildCollectionItem("i2", "col-2"),
      ];
      mockPrisma.collectionItem.findMany.mockResolvedValue(items);

      const result = await repository.findUserItems("user-1");

      expect(result).toEqual(items);
      const call = mockPrisma.collectionItem.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        collection: { userId: "user-1" },
      });
    });

    it("should merge additional where conditions", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      await repository.findUserItems("user-1", {
        where: { resourceId: "res-5" },
      });

      const call = mockPrisma.collectionItem.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        collection: { userId: "user-1" },
        resourceId: "res-5",
      });
    });

    it("should apply pagination options", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      await repository.findUserItems("user-1", { skip: 10, take: 5 });

      const call = mockPrisma.collectionItem.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10);
      expect(call.take).toBe(5);
    });
  });

  // ==================== findResourceInUserCollections ====================

  describe("findResourceInUserCollections", () => {
    it("should find resource across user collections", async () => {
      const items = [
        {
          ...buildCollectionItem("i1", "col-1", "res-1"),
          collection: { id: "col-1", name: "Favorites" },
        },
      ];
      mockPrisma.collectionItem.findMany.mockResolvedValue(items);

      const result = await repository.findResourceInUserCollections(
        "user-1",
        "res-1",
      );

      expect(result).toEqual(items);
      const call = mockPrisma.collectionItem.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        resourceId: "res-1",
        collection: { userId: "user-1" },
      });
    });

    it("should include collection id and name in result", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      await repository.findResourceInUserCollections("user-1", "res-2");

      const call = mockPrisma.collectionItem.findMany.mock.calls[0][0];
      expect(call.include?.collection?.select?.id).toBe(true);
      expect(call.include?.collection?.select?.name).toBe(true);
    });

    it("should return empty array when resource not in any user collection", async () => {
      mockPrisma.collectionItem.findMany.mockResolvedValue([]);

      const result = await repository.findResourceInUserCollections(
        "user-1",
        "res-99",
      );

      expect(result).toEqual([]);
    });
  });
});

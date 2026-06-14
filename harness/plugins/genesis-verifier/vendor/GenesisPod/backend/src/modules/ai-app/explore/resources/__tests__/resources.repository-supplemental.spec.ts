import { Test, TestingModule } from "@nestjs/testing";
import { ResourcesRepository } from "../resources.repository";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("ResourcesRepository (supplemental)", () => {
  let repository: ResourcesRepository;
  let mockPrisma: {
    resource: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      deleteMany: jest.Mock;
    };
    resourceTranslation: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    resourceUpvote: {
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const buildResource = (id: string) => ({
    id,
    title: `Resource ${id}`,
    url: `https://example.com/${id}`,
    type: "ARTICLE",
    sourceUrl: `https://source.com/${id}`,
    normalizedUrl: `https://example.com/${id}`,
    upvoteCount: 0,
    viewCount: 0,
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeAll(async () => {
    mockPrisma = {
      resource: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
        deleteMany: jest.fn(),
      },
      resourceTranslation: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      resourceUpvote: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest
        .fn()
        .mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourcesRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get<ResourcesRepository>(ResourcesRepository);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== findMany ====================

  describe("findMany", () => {
    it("should return resources with pagination", async () => {
      const resources = [buildResource("r1"), buildResource("r2")];
      mockPrisma.resource.findMany.mockResolvedValue(resources);

      const result = await repository.findMany({
        where: { isPublic: true },
        skip: 0,
        take: 20,
        orderBy: { createdAt: "desc" },
      });

      expect(result).toEqual(resources);
      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith({
        where: { isPublic: true },
        skip: 0,
        take: 20,
        orderBy: { createdAt: "desc" },
      });
    });

    it("should work without optional params", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      await repository.findMany({ where: {} });

      expect(mockPrisma.resource.findMany).toHaveBeenCalledWith({
        where: {},
        skip: undefined,
        take: undefined,
        orderBy: undefined,
      });
    });

    it("should return empty array when no resources match", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      const result = await repository.findMany({
        where: { type: "NONEXISTENT" as never },
      });

      expect(result).toEqual([]);
    });
  });

  // ==================== count ====================

  describe("count", () => {
    it("should return resource count for given where clause", async () => {
      mockPrisma.resource.count.mockResolvedValue(42);

      const result = await repository.count({ isPublic: true });

      expect(result).toBe(42);
      expect(mockPrisma.resource.count).toHaveBeenCalledWith({
        where: { isPublic: true },
      });
    });

    it("should return 0 when no resources match", async () => {
      mockPrisma.resource.count.mockResolvedValue(0);

      const result = await repository.count({ type: "UNKNOWN" as never });

      expect(result).toBe(0);
    });
  });

  // ==================== findById ====================

  describe("findById", () => {
    it("should find resource by ID", async () => {
      const resource = buildResource("r1");
      mockPrisma.resource.findUnique.mockResolvedValue(resource);

      const result = await repository.findById("r1");

      expect(result).toEqual(resource);
      expect(mockPrisma.resource.findUnique).toHaveBeenCalledWith({
        where: { id: "r1" },
      });
    });

    it("should return null when resource not found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      const result = await repository.findById("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ==================== findFirst ====================

  describe("findFirst", () => {
    it("should find first matching resource", async () => {
      const resource = buildResource("r1");
      mockPrisma.resource.findFirst.mockResolvedValue(resource);

      const result = await repository.findFirst({
        url: "https://example.com/r1",
      });

      expect(result).toEqual(resource);
      expect(mockPrisma.resource.findFirst).toHaveBeenCalledWith({
        where: { url: "https://example.com/r1" },
      });
    });

    it("should return null when no match found", async () => {
      mockPrisma.resource.findFirst.mockResolvedValue(null);

      const result = await repository.findFirst({ url: "https://unknown.com" });

      expect(result).toBeNull();
    });
  });

  // ==================== create ====================

  describe("create", () => {
    it("should create a resource", async () => {
      const newResource = buildResource("r-new");
      mockPrisma.resource.create.mockResolvedValue(newResource);

      const result = await repository.create({
        title: "New Resource",
        url: "https://example.com/new",
        type: "ARTICLE",
      } as never);

      expect(result).toEqual(newResource);
      expect(mockPrisma.resource.create).toHaveBeenCalled();
    });
  });

  // ==================== update ====================

  describe("update", () => {
    it("should update a resource by ID", async () => {
      const updated = { ...buildResource("r1"), title: "Updated" };
      mockPrisma.resource.update.mockResolvedValue(updated);

      const result = await repository.update("r1", { title: "Updated" });

      expect(result.title).toBe("Updated");
      expect(mockPrisma.resource.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { title: "Updated" },
      });
    });
  });

  // ==================== delete ====================

  describe("delete", () => {
    it("should delete a resource by ID", async () => {
      const deleted = buildResource("r1");
      mockPrisma.resource.delete.mockResolvedValue(deleted);

      const result = await repository.delete("r1");

      expect(result).toEqual(deleted);
      expect(mockPrisma.resource.delete).toHaveBeenCalledWith({
        where: { id: "r1" },
      });
    });
  });

  // ==================== groupByType ====================

  describe("groupByType", () => {
    it("should group resources by type with count", async () => {
      const groupResult = [
        { type: "ARTICLE", _count: { id: 10 } },
        { type: "VIDEO", _count: { id: 5 } },
      ];
      mockPrisma.resource.groupBy.mockResolvedValue(groupResult);

      const result = await repository.groupByType();

      expect(result).toEqual(groupResult);
      expect(mockPrisma.resource.groupBy).toHaveBeenCalledWith({
        by: ["type"],
        _count: { id: true },
      });
    });
  });

  // ==================== findTranslation ====================

  describe("findTranslation", () => {
    it("should find translation by resourceId and language", async () => {
      const translation = {
        resourceId: "r1",
        language: "zh",
        content: "Chinese content",
        modelUsed: "gpt-4",
      };
      mockPrisma.resourceTranslation.findUnique.mockResolvedValue(translation);

      const result = await repository.findTranslation("r1", "zh");

      expect(result).toEqual(translation);
      expect(mockPrisma.resourceTranslation.findUnique).toHaveBeenCalledWith({
        where: { resourceId_language: { resourceId: "r1", language: "zh" } },
      });
    });

    it("should return null when translation not found", async () => {
      mockPrisma.resourceTranslation.findUnique.mockResolvedValue(null);

      const result = await repository.findTranslation("r1", "fr");

      expect(result).toBeNull();
    });
  });

  // ==================== createTranslation ====================

  describe("createTranslation", () => {
    it("should create a translation", async () => {
      const translation = {
        resourceId: "r1",
        language: "zh",
        content: "Chinese content",
        modelUsed: "gpt-4",
      };
      mockPrisma.resourceTranslation.create.mockResolvedValue(translation);

      const result = await repository.createTranslation(translation);

      expect(result).toEqual(translation);
      expect(mockPrisma.resourceTranslation.create).toHaveBeenCalledWith({
        data: translation,
      });
    });
  });

  // ==================== groupBySourceUrl ====================

  describe("groupBySourceUrl", () => {
    it("should group by sourceUrl to find duplicates", async () => {
      const groupResult = [
        { sourceUrl: "https://dup.com/1", _count: { id: 3 } },
      ];
      mockPrisma.resource.groupBy.mockResolvedValue(groupResult);

      const result = await repository.groupBySourceUrl();

      expect(result).toEqual(groupResult);
      const call = mockPrisma.resource.groupBy.mock.calls[0][0];
      expect(call.by).toEqual(["sourceUrl"]);
      expect(call.having?.id?._count?.gt).toBe(1);
    });

    it("should apply type filter when provided", async () => {
      mockPrisma.resource.groupBy.mockResolvedValue([]);

      await repository.groupBySourceUrl({ type: "ARTICLE" });

      const call = mockPrisma.resource.groupBy.mock.calls[0][0];
      expect(call.where?.type).toBe("ARTICLE");
    });
  });

  // ==================== groupByNormalizedUrl ====================

  describe("groupByNormalizedUrl", () => {
    it("should group by normalizedUrl to find duplicates", async () => {
      const groupResult = [
        { normalizedUrl: "https://norm.com/1", _count: { id: 2 } },
      ];
      mockPrisma.resource.groupBy.mockResolvedValue(groupResult);

      const result = await repository.groupByNormalizedUrl();

      expect(result).toEqual(groupResult);
      const call = mockPrisma.resource.groupBy.mock.calls[0][0];
      expect(call.by).toEqual(["normalizedUrl"]);
    });

    it("should apply type filter when provided", async () => {
      mockPrisma.resource.groupBy.mockResolvedValue([]);

      await repository.groupByNormalizedUrl({ type: "VIDEO" });

      const call = mockPrisma.resource.groupBy.mock.calls[0][0];
      expect(call.where?.type).toBe("VIDEO");
    });
  });

  // ==================== deleteMany ====================

  describe("deleteMany", () => {
    it("should delete multiple resources by IDs", async () => {
      mockPrisma.resource.deleteMany.mockResolvedValue({ count: 3 });

      const result = await repository.deleteMany(["r1", "r2", "r3"]);

      expect(result.count).toBe(3);
      expect(mockPrisma.resource.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["r1", "r2", "r3"] } },
      });
    });

    it("should return count=0 when no resources deleted", async () => {
      mockPrisma.resource.deleteMany.mockResolvedValue({ count: 0 });

      const result = await repository.deleteMany([]);

      expect(result.count).toBe(0);
    });
  });

  // ==================== findUpvote ====================

  describe("findUpvote", () => {
    it("should find upvote record by userId and resourceId", async () => {
      const upvote = { id: "upvote-1" };
      mockPrisma.resourceUpvote.findUnique.mockResolvedValue(upvote);

      const result = await repository.findUpvote("user-1", "r1");

      expect(result).toEqual(upvote);
      expect(mockPrisma.resourceUpvote.findUnique).toHaveBeenCalledWith({
        where: { userId_resourceId: { userId: "user-1", resourceId: "r1" } },
      });
    });

    it("should return null when upvote not found", async () => {
      mockPrisma.resourceUpvote.findUnique.mockResolvedValue(null);

      const result = await repository.findUpvote("user-1", "r-new");

      expect(result).toBeNull();
    });
  });

  // ==================== createUpvote ====================

  describe("createUpvote", () => {
    it("should create an upvote record", async () => {
      const upvote = { id: "upvote-new", userId: "user-1", resourceId: "r1" };
      mockPrisma.resourceUpvote.create.mockResolvedValue(upvote);

      const result = await repository.createUpvote("user-1", "r1");

      expect(result).toEqual(upvote);
      expect(mockPrisma.resourceUpvote.create).toHaveBeenCalledWith({
        data: { userId: "user-1", resourceId: "r1" },
      });
    });
  });

  // ==================== deleteUpvote ====================

  describe("deleteUpvote", () => {
    it("should delete upvote by ID", async () => {
      const deleted = { id: "upvote-1" };
      mockPrisma.resourceUpvote.delete.mockResolvedValue(deleted);

      const result = await repository.deleteUpvote("upvote-1");

      expect(result).toEqual(deleted);
      expect(mockPrisma.resourceUpvote.delete).toHaveBeenCalledWith({
        where: { id: "upvote-1" },
      });
    });
  });

  // ==================== incrementUpvoteCount / decrementUpvoteCount ====================

  describe("incrementUpvoteCount", () => {
    it("should increment upvote count by 1", async () => {
      const updated = { ...buildResource("r1"), upvoteCount: 6 };
      mockPrisma.resource.update.mockResolvedValue(updated);

      const result = await repository.incrementUpvoteCount("r1");

      expect(result.upvoteCount).toBe(6);
      expect(mockPrisma.resource.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { upvoteCount: { increment: 1 } },
      });
    });
  });

  describe("decrementUpvoteCount", () => {
    it("should decrement upvote count by 1", async () => {
      const updated = { ...buildResource("r1"), upvoteCount: 4 };
      mockPrisma.resource.update.mockResolvedValue(updated);

      const result = await repository.decrementUpvoteCount("r1");

      expect(result.upvoteCount).toBe(4);
      expect(mockPrisma.resource.update).toHaveBeenCalledWith({
        where: { id: "r1" },
        data: { upvoteCount: { decrement: 1 } },
      });
    });
  });

  // ==================== createUpvoteWithCount ====================

  describe("createUpvoteWithCount", () => {
    it("should create upvote and increment count in a transaction", async () => {
      mockPrisma.resourceUpvote.create.mockResolvedValue({ id: "uv-1" });
      mockPrisma.resource.update.mockResolvedValue(buildResource("r1"));

      await repository.createUpvoteWithCount("user-1", "r1");

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ==================== deleteUpvoteWithCount ====================

  describe("deleteUpvoteWithCount", () => {
    it("should delete upvote and decrement count in a transaction", async () => {
      mockPrisma.resourceUpvote.delete.mockResolvedValue({ id: "uv-1" });
      mockPrisma.resource.update.mockResolvedValue(buildResource("r1"));

      await repository.deleteUpvoteWithCount("uv-1", "r1");

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ==================== findUserUpvotedResourceIds ====================

  describe("findUserUpvotedResourceIds", () => {
    it("should return list of resourceIds upvoted by user", async () => {
      const upvotes = [
        { resourceId: "r1" },
        { resourceId: "r2" },
        { resourceId: "r3" },
      ];
      mockPrisma.resourceUpvote.findMany.mockResolvedValue(upvotes);

      const result = await repository.findUserUpvotedResourceIds("user-1");

      expect(result).toEqual(["r1", "r2", "r3"]);
      expect(mockPrisma.resourceUpvote.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        select: { resourceId: true },
      });
    });

    it("should return empty array when user has no upvotes", async () => {
      mockPrisma.resourceUpvote.findMany.mockResolvedValue([]);

      const result = await repository.findUserUpvotedResourceIds("new-user");

      expect(result).toEqual([]);
    });
  });
});

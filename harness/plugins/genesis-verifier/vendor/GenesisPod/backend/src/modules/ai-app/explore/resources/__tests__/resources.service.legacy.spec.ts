import { Test, TestingModule } from "@nestjs/testing";
import { ResourcesService } from "../resources.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { SourceWhitelistService } from "../../../explore/ingestion/config/services/source-whitelist.service";
import { AIEnrichmentService } from "../ai-enrichment.service";
import { ResourcesRepository } from "../resources.repository";
import { ResourceLifecycleService } from "../resource-lifecycle.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { ResourceType } from "@prisma/client";

describe("ResourcesService", () => {
  let service: ResourcesService;
  let prismaService: jest.Mocked<PrismaService>;
  let mongoDBService: jest.Mocked<RawDataService>;
  let aiEnrichmentService: jest.Mocked<AIEnrichmentService>;
  let repositoryService: jest.Mocked<ResourcesRepository>;

  const mockResource = {
    id: "resource-123",
    type: ResourceType.PAPER,
    title: "Test Paper Title",
    abstract: "This is a test abstract for the paper",
    content: "Full content of the paper",
    sourceUrl: "https://example.com/paper",
    pdfUrl: null,
    thumbnailUrl: null,
    codeUrl: null,
    authors: ["Author 1", "Author 2"],
    organizations: null,
    publishedAt: new Date("2024-01-15"),
    aiSummary: null,
    keyInsights: null,
    methodology: null,
    difficultyLevel: null,
    prerequisites: null,
    structuredAISummary: null,
    primaryCategory: "AI",
    categories: ["Machine Learning", "Deep Learning"],
    tags: ["neural-networks", "transformers"],
    autoTags: [],
    qualityScore: 85.5,
    trendingScore: 120.0,
    viewCount: 100,
    saveCount: 25,
    upvoteCount: 50,
    commentCount: 10,
    metadata: {},
    normalizedUrl: "example.com/paper",
    contentFingerprint: "abc123",
    titleFingerprint: "def456",
    sourceCredibility: 90,
    contentCompleteness: 85,
    freshnessScore: 75,
    citationCount: 50,
    influenceScore: 80,
    maturityStage: "established",
    rawDataId: "rawdata-123",
    embeddingId: null,
    sourceType: "arxiv",
    externalId: "arxiv:2401.12345",
    collectionTaskId: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-10"),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      resource: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      resourceTranslation: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    const mockRawDataService = {
      findRawDataById: jest.fn(),
    };

    const mockWhitelistService = {};

    const mockAIEnrichmentService = {
      translateContent: jest.fn(),
    };

    const mockResourcesRepository = {
      findMany: jest.fn(),
      findById: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      groupByType: jest.fn(),
      findTranslation: jest.fn(),
      createTranslation: jest.fn(),
      groupBySourceUrl: jest.fn(),
      groupByNormalizedUrl: jest.fn(),
      deleteMany: jest.fn(),
      findUpvote: jest.fn(),
      createUpvote: jest.fn(),
      deleteUpvote: jest.fn(),
      incrementUpvoteCount: jest.fn(),
      decrementUpvoteCount: jest.fn(),
      createUpvoteWithCount: jest.fn(),
      deleteUpvoteWithCount: jest.fn(),
      findUserUpvotedResourceIds: jest.fn(),
    };

    const mockLifecycle = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBatch: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourcesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RawDataService, useValue: mockRawDataService },
        { provide: SourceWhitelistService, useValue: mockWhitelistService },
        { provide: AIEnrichmentService, useValue: mockAIEnrichmentService },
        { provide: ResourcesRepository, useValue: mockResourcesRepository },
        { provide: ResourceLifecycleService, useValue: mockLifecycle },
      ],
    }).compile();

    service = module.get<ResourcesService>(ResourcesService);
    prismaService = module.get(PrismaService);
    mongoDBService = module.get(RawDataService);
    aiEnrichmentService = module.get(AIEnrichmentService);
    repositoryService = module.get(ResourcesRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("should return paginated resources with default parameters", async () => {
      // Arrange
      const mockResources = [mockResource];
      (repositoryService.findMany as jest.Mock).mockResolvedValue(
        mockResources,
      );
      (repositoryService.count as jest.Mock).mockResolvedValue(1);

      // Act
      const result = await service.findAll({});

      // Assert
      expect(repositoryService.findMany).toHaveBeenCalledWith({
        where: {
          NOT: { title: "" },
          linkHealth: { notIn: ["BROKEN", "ARCHIVED"] },
        },
        skip: 0,
        take: 20,
        orderBy: { publishedAt: "desc" },
      });
      expect(result.data).toEqual(mockResources);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("should filter resources by type", async () => {
      // Arrange
      (repositoryService.findMany as jest.Mock).mockResolvedValue([
        mockResource,
      ]);
      (repositoryService.count as jest.Mock).mockResolvedValue(1);

      // Act
      await service.findAll({ type: "PAPER" });

      // Assert
      expect(repositoryService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: "PAPER",
          }),
        }),
      );
    });

    it("should filter resources by category", async () => {
      // Arrange
      (repositoryService.findMany as jest.Mock).mockResolvedValue([
        mockResource,
      ]);
      (repositoryService.count as jest.Mock).mockResolvedValue(1);

      // Act
      await service.findAll({ category: "AI" });

      // Assert
      expect(repositoryService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categories: expect.any(Object),
          }),
        }),
      );
    });

    it("should search resources by title and abstract", async () => {
      // Arrange
      (repositoryService.findMany as jest.Mock).mockResolvedValue([
        mockResource,
      ]);
      (repositoryService.count as jest.Mock).mockResolvedValue(1);

      // Act
      await service.findAll({ search: "machine learning" });

      // Assert
      expect(repositoryService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { title: { contains: "machine learning", mode: "insensitive" } },
              {
                abstract: { contains: "machine learning", mode: "insensitive" },
              },
            ],
          }),
        }),
      );
    });

    it("should handle custom pagination parameters", async () => {
      // Arrange
      const mockResources = Array(10).fill(mockResource);
      (repositoryService.findMany as jest.Mock).mockResolvedValue(
        mockResources,
      );
      (repositoryService.count as jest.Mock).mockResolvedValue(50);

      // Act
      const result = await service.findAll({ skip: 20, take: 10 });

      // Assert
      expect(repositoryService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
      expect(result.pagination.hasMore).toBe(true);
    });

    it("should sort by different fields", async () => {
      // Arrange
      (repositoryService.findMany as jest.Mock).mockResolvedValue([
        mockResource,
      ]);
      (repositoryService.count as jest.Mock).mockResolvedValue(1);

      // Act
      await service.findAll({ sortBy: "qualityScore", sortOrder: "desc" });

      // Assert
      expect(repositoryService.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { qualityScore: "desc" },
        }),
      );
    });
  });

  describe("findOne", () => {
    it("should return resource with raw data if available", async () => {
      // Arrange
      (repositoryService.findById as jest.Mock).mockResolvedValue(mockResource);
      (mongoDBService.findRawDataById as jest.Mock).mockResolvedValue({
        data: { original: "data" },
      });

      // Act
      const result = await service.findOne("resource-123");

      // Assert
      expect(repositoryService.findById).toHaveBeenCalledWith("resource-123");
      expect(mongoDBService.findRawDataById).toHaveBeenCalledWith(
        "rawdata-123",
      );
      expect(result.rawData).toEqual({ original: "data" });
    });

    it("should return resource without raw data if rawDataId is null", async () => {
      // Arrange
      const resourceWithoutRawData = { ...mockResource, rawDataId: null };
      (repositoryService.findById as jest.Mock).mockResolvedValue(
        resourceWithoutRawData,
      );

      // Act
      const result = await service.findOne("resource-123");

      // Assert
      expect(mongoDBService.findRawDataById).not.toHaveBeenCalled();
      expect(result.rawData).toBeNull();
    });

    it("should throw NotFoundException if resource not found", async () => {
      // Arrange
      (repositoryService.findById as jest.Mock).mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne("nonexistent-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("create", () => {
    it("should create a new resource", async () => {
      // Arrange
      const createData = {
        type: ResourceType.PAPER,
        title: "New Paper",
        sourceUrl: "https://example.com/new-paper",
      };
      (repositoryService.create as jest.Mock).mockResolvedValue({
        id: "new-resource-id",
        ...createData,
      });

      // Act
      const result = await service.create(createData);

      // Assert
      expect(repositoryService.create).toHaveBeenCalledWith(createData);
      expect(result.id).toBe("new-resource-id");
    });
  });

  describe("update", () => {
    it("should update an existing resource", async () => {
      // Arrange
      const updateData = { title: "Updated Title" };
      (repositoryService.update as jest.Mock).mockResolvedValue({
        ...mockResource,
        title: "Updated Title",
      });

      // Act
      const result = await service.update("resource-123", updateData);

      // Assert
      expect(repositoryService.update).toHaveBeenCalledWith(
        "resource-123",
        updateData,
      );
      expect(result.title).toBe("Updated Title");
    });

    it("should throw NotFoundException if resource not found", async () => {
      // Arrange
      (repositoryService.update as jest.Mock).mockRejectedValue({
        code: "P2025",
      });

      // Act & Assert
      await expect(
        service.update("nonexistent-id", { title: "Test" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("remove", () => {
    it("should delete an existing resource", async () => {
      // Arrange
      (repositoryService.delete as jest.Mock).mockResolvedValue(mockResource);

      // Act
      const result = await service.remove("resource-123");

      // Assert
      expect(repositoryService.delete).toHaveBeenCalledWith("resource-123");
      expect(result.id).toBe("resource-123");
    });

    it("should throw NotFoundException if resource not found", async () => {
      // Arrange
      (repositoryService.delete as jest.Mock).mockRejectedValue({
        code: "P2025",
      });

      // Act & Assert
      await expect(service.remove("nonexistent-id")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getStats", () => {
    it("should return resource statistics grouped by type", async () => {
      // Arrange
      (repositoryService.groupByType as jest.Mock).mockResolvedValue([
        { type: "PAPER", _count: { id: 100 } },
        { type: "BLOG", _count: { id: 50 } },
        { type: "NEWS", _count: { id: 30 } },
      ]);
      (repositoryService.count as jest.Mock).mockResolvedValue(180);

      // Act
      const result = await service.getStats();

      // Assert
      expect(result.total).toBe(180);
      expect(result.byType).toHaveLength(3);
      expect(result.byType[0]).toEqual({ type: "PAPER", count: 100 });
    });
  });

  describe("translateResource", () => {
    it("should return existing translation if available", async () => {
      // Arrange
      const existingTranslation = {
        id: "translation-123",
        resourceId: "resource-123",
        language: "zh-CN",
        content: "翻译后的内容",
      };
      (repositoryService.findTranslation as jest.Mock).mockResolvedValue(
        existingTranslation,
      );

      // Act
      const result = await service.translateResource("resource-123", "zh-CN");

      // Assert
      expect(result).toEqual(existingTranslation);
      expect(aiEnrichmentService.translateContent).not.toHaveBeenCalled();
    });

    it("should create new translation if not exists", async () => {
      // Arrange
      (repositoryService.findTranslation as jest.Mock).mockResolvedValue(null);
      (repositoryService.findById as jest.Mock).mockResolvedValue(mockResource);
      (mongoDBService.findRawDataById as jest.Mock).mockResolvedValue(null);
      (aiEnrichmentService.translateContent as jest.Mock).mockResolvedValue({
        translatedText: "翻译后的内容",
        model: "gpt-4",
      });
      (repositoryService.createTranslation as jest.Mock).mockResolvedValue({
        id: "new-translation-id",
        resourceId: "resource-123",
        language: "zh-CN",
        content: "翻译后的内容",
        modelUsed: "gpt-4",
      });

      // Act
      const result = await service.translateResource("resource-123", "zh-CN");

      // Assert
      expect(aiEnrichmentService.translateContent).toHaveBeenCalled();
      expect(repositoryService.createTranslation).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: "resource-123",
          language: "zh-CN",
          content: "翻译后的内容",
          modelUsed: "gpt-4",
        }),
      );
      expect(result.content).toBe("翻译后的内容");
    });

    it("should throw BadRequestException if resource has no content", async () => {
      // Arrange
      const emptyResource = { ...mockResource, content: null, abstract: null };
      (repositoryService.findTranslation as jest.Mock).mockResolvedValue(null);
      (repositoryService.findById as jest.Mock).mockResolvedValue(
        emptyResource,
      );
      (mongoDBService.findRawDataById as jest.Mock).mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.translateResource("resource-123", "zh-CN"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if translation fails", async () => {
      // Arrange
      (repositoryService.findTranslation as jest.Mock).mockResolvedValue(null);
      (repositoryService.findById as jest.Mock).mockResolvedValue(mockResource);
      (mongoDBService.findRawDataById as jest.Mock).mockResolvedValue(null);
      (aiEnrichmentService.translateContent as jest.Mock).mockResolvedValue(
        null,
      );

      // Act & Assert
      await expect(
        service.translateResource("resource-123", "zh-CN"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("searchSuggestions", () => {
    it("should return search suggestions with highlights", async () => {
      // Arrange
      const searchResults = [
        {
          id: "resource-1",
          type: ResourceType.PAPER,
          title: "Machine Learning Basics",
          abstract:
            "Introduction to machine learning concepts and fundamentals",
          publishedAt: new Date(),
          qualityScore: 90,
        },
        {
          id: "resource-2",
          type: ResourceType.BLOG,
          title: "Advanced AI Techniques",
          abstract: "Machine learning advanced topics and applications",
          publishedAt: new Date(),
          qualityScore: 80,
        },
      ];
      (prismaService.resource.findMany as jest.Mock).mockResolvedValue(
        searchResults,
      );

      // Act
      const result = await service.searchSuggestions("machine learning", 5);

      // Assert
      expect(prismaService.resource.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ title: expect.any(Object) }),
              expect.objectContaining({ abstract: expect.any(Object) }),
              expect.objectContaining({ content: expect.any(Object) }),
            ]),
          }),
          take: 10, // limit * 2
        }),
      );
      expect(result).toHaveLength(2);
      // Results should have highlight field
      expect(result[0].highlight).toBeDefined();
      expect(result[0].id).toBeDefined();
      expect(result[0].title).toBeDefined();
    });

    it("should handle empty search query", async () => {
      // Arrange
      (prismaService.resource.findMany as jest.Mock).mockResolvedValue([]);

      // Act
      const result = await service.searchSuggestions("", 5);

      // Assert
      expect(result).toHaveLength(0);
    });
  });
});

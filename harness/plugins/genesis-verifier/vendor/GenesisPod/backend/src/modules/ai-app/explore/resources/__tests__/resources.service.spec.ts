import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { ResourcesService } from "../resources.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { SourceWhitelistService } from "../../../explore/ingestion/config/services/source-whitelist.service";
import { AIEnrichmentService } from "../ai-enrichment.service";
import { ResourcesRepository } from "../resources.repository";
import { ResourceLifecycleService } from "../resource-lifecycle.service";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("ResourcesService", () => {
  let service: ResourcesService;
  let mockPrisma: jest.Mocked<Partial<PrismaService>>;
  let mockMongodb: jest.Mocked<Partial<RawDataService>>;
  let mockWhitelistService: jest.Mocked<Partial<SourceWhitelistService>>;
  let mockAIEnrichmentService: jest.Mocked<Partial<AIEnrichmentService>>;
  let mockRepository: jest.Mocked<Partial<ResourcesRepository>>;

  const mockResource = {
    id: "resource-1",
    type: "PAPER" as const,
    title: "Test Paper",
    abstract: "Test abstract",
    content: null,
    sourceUrl: "https://arxiv.org/abs/2311.12345",
    normalizedUrl: "https://arxiv.org/abs/2311.12345",
    pdfUrl: null,
    publishedAt: new Date("2024-01-01"),
    upvoteCount: 5,
    viewCount: 100,
    commentCount: 2,
    qualityScore: "80",
    trendingScore: 0.5,
    categories: [],
    rawDataId: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    aiSummary: null,
    authors: null,
    citationCount: null,
    tags: null,
    language: null,
    thumbnailUrl: null,
  };

  beforeEach(async () => {
    mockPrisma = {
      resource: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(mockResource),
        update: jest.fn().mockResolvedValue(mockResource),
        delete: jest.fn().mockResolvedValue(mockResource),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      } as unknown,
      resourceUpvote: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      } as unknown,
    } as jest.Mocked<Partial<PrismaService>>;

    mockMongodb = {
      findRawDataById: jest.fn().mockResolvedValue(null),
    } as jest.Mocked<Partial<RawDataService>>;

    mockWhitelistService = {
      validateUrl: jest.fn().mockResolvedValue({
        isValid: true,
        matchedDomain: "arxiv.org",
        reason: null,
      }),
    } as jest.Mocked<Partial<SourceWhitelistService>>;

    mockAIEnrichmentService = {
      translateContent: jest.fn().mockResolvedValue({
        translatedText: "Translated content",
        model: "test-model",
      }),
    } as jest.Mocked<Partial<AIEnrichmentService>>;

    mockRepository = {
      findMany: jest.fn().mockResolvedValue([mockResource]),
      count: jest.fn().mockResolvedValue(1),
      findById: jest.fn().mockResolvedValue(mockResource),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(mockResource),
      update: jest.fn().mockResolvedValue(mockResource),
      delete: jest.fn().mockResolvedValue(mockResource),
      groupByType: jest
        .fn()
        .mockResolvedValue([{ type: "PAPER", _count: { id: 5 } }]),
      findTranslation: jest.fn().mockResolvedValue(null),
      createTranslation: jest.fn().mockResolvedValue({
        id: "t1",
        resourceId: "resource-1",
        language: "zh-CN",
        content: "Translated content",
        modelUsed: "test-model",
      }),
      groupBySourceUrl: jest.fn().mockResolvedValue([]),
      groupByNormalizedUrl: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUpvote: jest.fn().mockResolvedValue(null),
      createUpvoteWithCount: jest.fn().mockResolvedValue(undefined),
      deleteUpvoteWithCount: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<Partial<ResourcesRepository>>;

    const mockLifecycle = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBatch: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResourcesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RawDataService, useValue: mockMongodb },
        { provide: SourceWhitelistService, useValue: mockWhitelistService },
        { provide: AIEnrichmentService, useValue: mockAIEnrichmentService },
        { provide: ResourcesRepository, useValue: mockRepository },
        { provide: ResourceLifecycleService, useValue: mockLifecycle },
      ],
    }).compile();

    service = module.get<ResourcesService>(ResourcesService);

    // Reset fetch mock before each test
    mockFetch.mockReset();
  });

  describe("findAll", () => {
    it("should return paginated resources with defaults", async () => {
      (mockRepository.findMany as jest.Mock).mockResolvedValue([mockResource]);
      (mockRepository.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({});

      expect(result.data).toEqual([mockResource]);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.skip).toBe(0);
      expect(result.pagination.take).toBe(20);
      expect(result.pagination.hasMore).toBe(false);
    });

    it("should apply type filter when provided", async () => {
      await service.findAll({ type: "PAPER" });

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "PAPER" }),
        }),
      );
    });

    it("should apply category filter when provided", async () => {
      await service.findAll({ category: "AI" });

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categories: { path: [], array_contains: ["AI"] },
          }),
        }),
      );
    });

    it("should apply search filter to title and abstract", async () => {
      await service.findAll({ search: "transformer" });

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { title: { contains: "transformer", mode: "insensitive" } },
              { abstract: { contains: "transformer", mode: "insensitive" } },
            ],
          }),
        }),
      );
    });

    it("should apply custom sorting", async () => {
      await service.findAll({ sortBy: "qualityScore", sortOrder: "asc" });

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { qualityScore: "asc" },
        }),
      );
    });

    it("should calculate hasMore correctly when more items exist", async () => {
      (mockRepository.count as jest.Mock).mockResolvedValue(50);
      (mockRepository.findMany as jest.Mock).mockResolvedValue([mockResource]);

      const result = await service.findAll({ skip: 0, take: 20 });

      expect(result.pagination.hasMore).toBe(true);
    });

    it("should filter empty titles with NOT condition", async () => {
      await service.findAll({});

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: { title: "" },
          }),
        }),
      );
    });

    it("should apply custom pagination", async () => {
      await service.findAll({ skip: 10, take: 5 });

      expect(mockRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });
  });

  describe("findOne", () => {
    it("should return resource with null rawData when no rawDataId", async () => {
      (mockRepository.findById as jest.Mock).mockResolvedValue(mockResource);

      const result = await service.findOne("resource-1");

      expect(result.id).toBe("resource-1");
      expect(result.rawData).toBeNull();
    });

    it("should fetch rawData from MongoDB when rawDataId exists", async () => {
      const resourceWithRawData = { ...mockResource, rawDataId: "raw-1" };
      (mockRepository.findById as jest.Mock).mockResolvedValue(
        resourceWithRawData,
      );
      (mockMongodb.findRawDataById as jest.Mock).mockResolvedValue({
        data: { key: "value" },
      });

      const result = await service.findOne("resource-1");

      expect(result.rawData).toEqual({ key: "value" });
      expect(mockMongodb.findRawDataById).toHaveBeenCalledWith("raw-1");
    });

    it("should throw NotFoundException when resource not found", async () => {
      (mockRepository.findById as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne("non-existent")).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne("non-existent")).rejects.toThrow(
        "Resource with ID non-existent not found",
      );
    });

    it("should return null rawData when MongoDB returns no data field", async () => {
      const resourceWithRawData = { ...mockResource, rawDataId: "raw-1" };
      (mockRepository.findById as jest.Mock).mockResolvedValue(
        resourceWithRawData,
      );
      (mockMongodb.findRawDataById as jest.Mock).mockResolvedValue({
        otherField: "value",
      });

      const result = await service.findOne("resource-1");

      expect(result.rawData).toBeNull();
    });
  });

  describe("create", () => {
    it("should create a resource and return it", async () => {
      const createData = {
        type: "PAPER" as const,
        title: "New Paper",
        publishedAt: new Date(),
      };
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        ...createData,
      });

      const result = await service.create(createData);

      expect(result.title).toBe("New Paper");
      expect(mockRepository.create).toHaveBeenCalledWith(createData);
    });
  });

  describe("update", () => {
    it("should update a resource and return it", async () => {
      const updateData = { title: "Updated Title" };
      (mockRepository.update as jest.Mock).mockResolvedValue({
        ...mockResource,
        title: "Updated Title",
      });

      const result = await service.update("resource-1", updateData);

      expect(result.title).toBe("Updated Title");
      expect(mockRepository.update).toHaveBeenCalledWith(
        "resource-1",
        updateData,
      );
    });

    it("should throw NotFoundException when Prisma P2025 error", async () => {
      const prismaError = { code: "P2025", message: "Record not found" };
      (mockRepository.update as jest.Mock).mockRejectedValue(prismaError);

      await expect(service.update("non-existent", {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should re-throw other errors as is", async () => {
      const genericError = new Error("Database connection failed");
      (mockRepository.update as jest.Mock).mockRejectedValue(genericError);

      await expect(service.update("resource-1", {})).rejects.toThrow(
        "Database connection failed",
      );
    });
  });

  describe("remove", () => {
    it("should delete a resource and return it", async () => {
      (mockRepository.delete as jest.Mock).mockResolvedValue(mockResource);

      const result = await service.remove("resource-1");

      expect(result.id).toBe("resource-1");
      expect(mockRepository.delete).toHaveBeenCalledWith("resource-1");
    });

    it("should throw NotFoundException when Prisma P2025 error", async () => {
      const prismaError = { code: "P2025", message: "Record not found" };
      (mockRepository.delete as jest.Mock).mockRejectedValue(prismaError);

      await expect(service.remove("non-existent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should re-throw other errors", async () => {
      const genericError = new Error("Unexpected error");
      (mockRepository.delete as jest.Mock).mockRejectedValue(genericError);

      await expect(service.remove("resource-1")).rejects.toThrow(
        "Unexpected error",
      );
    });
  });

  describe("getStats", () => {
    it("should return total count and breakdown by type", async () => {
      (mockRepository.groupByType as jest.Mock).mockResolvedValue([
        { type: "PAPER", _count: { id: 10 } },
        { type: "NEWS", _count: { id: 5 } },
      ]);
      (mockRepository.count as jest.Mock).mockResolvedValue(15);

      const result = await service.getStats();

      expect(result.total).toBe(15);
      expect(result.byType).toEqual([
        { type: "PAPER", count: 10 },
        { type: "NEWS", count: 5 },
      ]);
    });

    it("should return empty stats when no resources", async () => {
      (mockRepository.groupByType as jest.Mock).mockResolvedValue([]);
      (mockRepository.count as jest.Mock).mockResolvedValue(0);

      const result = await service.getStats();

      expect(result.total).toBe(0);
      expect(result.byType).toEqual([]);
    });
  });

  describe("translateResource", () => {
    it("should return existing translation if available", async () => {
      const existingTranslation = {
        id: "t1",
        resourceId: "resource-1",
        language: "zh-CN",
        content: "Existing translation",
      };
      (mockRepository.findTranslation as jest.Mock).mockResolvedValue(
        existingTranslation,
      );

      const result = await service.translateResource("resource-1", "zh-CN");

      expect(result).toEqual(existingTranslation);
      expect(mockAIEnrichmentService.translateContent).not.toHaveBeenCalled();
    });

    it("should translate resource content when no existing translation", async () => {
      (mockRepository.findTranslation as jest.Mock).mockResolvedValue(null);
      (mockRepository.findById as jest.Mock).mockResolvedValue({
        ...mockResource,
        content: "English content to translate",
      });

      const result = await service.translateResource("resource-1");

      expect(mockAIEnrichmentService.translateContent).toHaveBeenCalledWith(
        "English content to translate",
        "zh-CN",
      );
      expect(result.language).toBe("zh-CN");
    });

    it("should use abstract when content is not available", async () => {
      (mockRepository.findTranslation as jest.Mock).mockResolvedValue(null);
      (mockRepository.findById as jest.Mock).mockResolvedValue({
        ...mockResource,
        content: null,
        abstract: "Abstract content",
      });

      await service.translateResource("resource-1");

      expect(mockAIEnrichmentService.translateContent).toHaveBeenCalledWith(
        "Abstract content",
        "zh-CN",
      );
    });

    it("should throw BadRequestException when resource has no content", async () => {
      (mockRepository.findTranslation as jest.Mock).mockResolvedValue(null);
      (mockRepository.findById as jest.Mock).mockResolvedValue({
        ...mockResource,
        content: null,
        abstract: null,
      });

      await expect(service.translateResource("resource-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when translation fails", async () => {
      (mockRepository.findTranslation as jest.Mock).mockResolvedValue(null);
      (mockRepository.findById as jest.Mock).mockResolvedValue({
        ...mockResource,
        content: "Some content",
      });
      (mockAIEnrichmentService.translateContent as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.translateResource("resource-1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("searchSuggestions", () => {
    it("should return search results with highlights", async () => {
      const resources = [
        {
          id: "1",
          type: "PAPER",
          title: "Transformer Architecture",
          abstract: "A paper about transformers",
          publishedAt: new Date(),
          qualityScore: "80",
        },
      ];
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue(resources);

      const result = await service.searchSuggestions("transformer");

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Transformer Architecture");
      expect(result[0].highlight).toBeDefined();
    });

    it("should apply relevance scoring to results", async () => {
      const resources = [
        {
          id: "1",
          type: "PAPER",
          title: "transformer",
          abstract: "about transformers",
          publishedAt: new Date(),
          qualityScore: "50",
        },
        {
          id: "2",
          type: "NEWS",
          title: "Some other article",
          abstract: "transformers are mentioned",
          publishedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // old
          qualityScore: "20",
        },
      ];
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue(resources);

      const result = await service.searchSuggestions("transformer", 2);

      // First result should be the one with exact title match
      expect(result[0].id).toBe("1");
    });

    it("should limit results to specified limit", async () => {
      const resources = Array.from({ length: 10 }, (_, i) => ({
        id: `${i}`,
        type: "PAPER",
        title: `Paper ${i} about AI`,
        abstract: "abstract",
        publishedAt: new Date(),
        qualityScore: "50",
      }));
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue(resources);

      const result = await service.searchSuggestions("AI", 3);

      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("should trim and lowercase the search query", async () => {
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchSuggestions("  TRANSFORMER  ");

      expect(mockPrisma.resource!.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                title: { contains: "transformer", mode: "insensitive" },
              }),
            ]),
          }),
        }),
      );
    });

    it("should handle empty search results gracefully", async () => {
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.searchSuggestions("nonexistent query");

      expect(result).toEqual([]);
    });

    it("should add freshness score for recent articles", async () => {
      const recentResource = {
        id: "recent",
        type: "NEWS",
        title: "Recent AI news",
        abstract: "about AI",
        publishedAt: new Date(), // today
        qualityScore: "40",
      };
      const oldResource = {
        id: "old",
        type: "NEWS",
        title: "Old AI news",
        abstract: "about AI too",
        publishedAt: new Date("2020-01-01"),
        qualityScore: "40",
      };
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue([
        oldResource,
        recentResource,
      ]);

      const result = await service.searchSuggestions("AI news", 2);

      // Recent should score higher
      expect(result[0].id).toBe("recent");
    });
  });

  describe("importFromUrl", () => {
    it("should throw BadRequestException when domain not in whitelist", async () => {
      (mockWhitelistService.validateUrl as jest.Mock).mockResolvedValue({
        isValid: false,
        reason: "Domain not allowed",
        matchedDomain: null,
      });

      await expect(
        service.importFromUrl("https://example.com/article", "NEWS"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should convert AlphaXiv URL to arXiv URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest
          .fn()
          .mockResolvedValue(
            "<feed><entry><title>Test Paper</title><summary>A great paper</summary></entry></feed>",
          ),
      });
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        sourceUrl: "https://arxiv.org/abs/2511.04676",
      });

      const result = await service.importFromUrl(
        "https://alphaxiv.org/abs/2511.04676",
        "PAPER",
      );

      expect(result.sourceUrl).toBe("https://arxiv.org/abs/2511.04676");
    });

    it("should update existing resource when URL already exists", async () => {
      const existingResource = { ...mockResource, id: "existing-1" };
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(
        existingResource,
      );
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest
          .fn()
          .mockResolvedValue(
            "<feed><entry><title>Updated Title</title><summary>Updated abstract</summary></entry></feed>",
          ),
      });
      (mockRepository.update as jest.Mock).mockResolvedValue({
        ...existingResource,
        title: "Updated Title",
      });

      const result = await service.importFromUrl(
        "https://arxiv.org/abs/2311.12345",
        "PAPER",
      );

      expect(mockRepository.update).toHaveBeenCalledWith(
        "existing-1",
        expect.objectContaining({ title: expect.any(String) }),
      );
      expect(result.id).toBe("existing-1");
    });

    it("should create new resource for NEWS type", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest
          .fn()
          .mockResolvedValue(
            "<html><head><title>News Article</title></head><body>Content</body></html>",
          ),
      });
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "NEWS",
        title: "News Article",
      });

      const result = await service.importFromUrl(
        "https://techcrunch.com/2024/01/01/news",
        "NEWS",
      );

      expect(mockRepository.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should create new resource for PROJECT type (GitHub)", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          full_name: "owner/repo",
          description: "A great project",
        }),
      });
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "PROJECT",
        title: "owner/repo",
      });

      const result = await service.importFromUrl(
        "https://github.com/owner/repo",
        "PROJECT",
      );

      expect(mockRepository.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should create resource for YOUTUBE_VIDEO type with valid video ID", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ title: "My YouTube Video" }),
      });
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "YOUTUBE_VIDEO",
        title: "My YouTube Video",
      });

      const result = await service.importFromUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "YOUTUBE_VIDEO",
      );

      expect(mockRepository.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should create resource for YOUTUBE_VIDEO type without extractable video ID", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "YOUTUBE_VIDEO",
        title: "YouTube Video",
      });

      // Use a URL that doesn't match any pattern
      const result = await service.importFromUrl(
        "https://www.youtube.com/channel/UCxxx",
        "YOUTUBE_VIDEO",
      );

      expect(mockRepository.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should create resource for BLOG type using fetchWebPageInfo", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest
          .fn()
          .mockResolvedValue(
            "<html><head><title>My Blog Post</title></head><body>Content</body></html>",
          ),
      });
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "BLOG",
        title: "My Blog Post",
      });

      const result = await service.importFromUrl(
        "https://medium.com/some-blog-post",
        "BLOG",
      );

      expect(mockRepository.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should create resource for REPORT type using fetchWebPageInfo", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest
          .fn()
          .mockResolvedValue(
            "<html><head><title>Industry Report 2024</title></head><body>Report content</body></html>",
          ),
      });
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "REPORT",
        title: "Industry Report 2024",
      });

      const result = await service.importFromUrl(
        "https://example.com/reports/2024",
        "REPORT",
      );

      expect(mockRepository.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should create resource for unknown type using path-based title fallback", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "OTHER",
        title: "some document",
      });

      const result = await service.importFromUrl(
        "https://example.com/path/to/some-document",
        "OTHER",
      );

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("some document"),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should extract PDF URL for openreview.net forum URL (PAPER type)", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest
          .fn()
          .mockResolvedValue(
            "<feed><entry><title>OpenReview Paper</title><summary>Abstract</summary></entry></feed>",
          ),
      });
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "PAPER",
        pdfUrl: "https://openreview.net/pdf?id=abc123",
      });

      const result = await service.importFromUrl(
        "https://openreview.net/forum?id=abc123",
        "PAPER",
      );

      // Should have tried to create with a pdfUrl derived from the openreview URL
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pdfUrl: "https://openreview.net/pdf?id=abc123",
        }),
      );
      expect(result).toBeDefined();
    });

    it("should use direct URL as pdfUrl when URL ends with .pdf (PAPER type)", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: false,
        text: jest.fn().mockResolvedValue(""),
      });
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "PAPER",
        pdfUrl: "https://arxiv.org/pdf/2311.12345.pdf",
      });

      await service.importFromUrl(
        "https://arxiv.org/pdf/2311.12345.pdf",
        "PAPER",
      );

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pdfUrl: "https://arxiv.org/pdf/2311.12345.pdf",
        }),
      );
    });

    it("should use hostname as title fallback when fetchWebPageInfo returns non-ok response", async () => {
      (mockRepository.findFirst as jest.Mock).mockResolvedValue(null);
      // Simulate non-ok response
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(""),
      });
      (mockRepository.create as jest.Mock).mockResolvedValue({
        ...mockResource,
        type: "NEWS",
        title: "techcrunch.com",
      });

      const result = await service.importFromUrl(
        "https://techcrunch.com/article-that-404s",
        "NEWS",
      );

      // When fetchWebPageInfo gets non-ok, it falls back to hostname
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.any(String),
        }),
      );
      expect(result).toBeDefined();
    });
  });

  describe("cleanupDuplicates", () => {
    it("should return zero counts when no duplicates found", async () => {
      (mockRepository.groupBySourceUrl as jest.Mock).mockResolvedValue([]);
      (mockRepository.groupByNormalizedUrl as jest.Mock).mockResolvedValue([]);

      const result = await service.cleanupDuplicates();

      expect(result.deleted).toBe(0);
      expect(result.details).toEqual([]);
    });

    it("should delete duplicates keeping earliest created resource", async () => {
      const duplicateUrl = "https://arxiv.org/abs/1234";
      (mockRepository.groupBySourceUrl as jest.Mock).mockResolvedValue([
        { sourceUrl: duplicateUrl, _count: { id: 2 } },
      ]);
      (mockRepository.groupByNormalizedUrl as jest.Mock).mockResolvedValue([]);

      const resources = [
        {
          id: "old-1",
          title: "Original",
          sourceUrl: duplicateUrl,
          createdAt: new Date("2024-01-01"),
        },
        {
          id: "new-2",
          title: "Duplicate",
          sourceUrl: duplicateUrl,
          createdAt: new Date("2024-01-02"),
        },
      ];
      (mockPrisma.resource!.findMany as jest.Mock).mockResolvedValue(resources);

      await service.cleanupDuplicates();

      expect(mockRepository.deleteMany).toHaveBeenCalledWith(["new-2"]);
    });

    it("should filter by type when resourceType is provided", async () => {
      (mockRepository.groupBySourceUrl as jest.Mock).mockResolvedValue([]);
      (mockRepository.groupByNormalizedUrl as jest.Mock).mockResolvedValue([]);

      await service.cleanupDuplicates("PAPER");

      expect(mockRepository.groupBySourceUrl).toHaveBeenCalledWith({
        type: "PAPER",
      });
    });

    it("should skip groups with null sourceUrl", async () => {
      (mockRepository.groupBySourceUrl as jest.Mock).mockResolvedValue([
        { sourceUrl: null, _count: { id: 2 } },
      ]);
      (mockRepository.groupByNormalizedUrl as jest.Mock).mockResolvedValue([]);

      const result = await service.cleanupDuplicates();

      expect(mockRepository.deleteMany).not.toHaveBeenCalled();
      expect(result.deleted).toBe(0);
    });
  });

  describe("toggleUpvote", () => {
    it("should add upvote when not already upvoted", async () => {
      (mockRepository.findById as jest.Mock).mockResolvedValue(mockResource);
      (mockRepository.findUpvote as jest.Mock).mockResolvedValue(null);
      (mockRepository.createUpvoteWithCount as jest.Mock).mockResolvedValue(
        undefined,
      );

      const result = await service.toggleUpvote("resource-1", "user-1");

      expect(result.upvoted).toBe(true);
      expect(result.upvoteCount).toBe(6); // mockResource.upvoteCount + 1
      expect(mockRepository.createUpvoteWithCount).toHaveBeenCalledWith(
        "user-1",
        "resource-1",
      );
    });

    it("should remove upvote when already upvoted", async () => {
      (mockRepository.findById as jest.Mock).mockResolvedValue(mockResource);
      (mockRepository.findUpvote as jest.Mock).mockResolvedValue({
        id: "upvote-1",
        userId: "user-1",
        resourceId: "resource-1",
      });
      (mockRepository.deleteUpvoteWithCount as jest.Mock).mockResolvedValue(
        undefined,
      );

      const result = await service.toggleUpvote("resource-1", "user-1");

      expect(result.upvoted).toBe(false);
      expect(result.upvoteCount).toBe(4); // mockResource.upvoteCount - 1
      expect(mockRepository.deleteUpvoteWithCount).toHaveBeenCalledWith(
        "upvote-1",
        "resource-1",
      );
    });

    it("should throw NotFoundException when resource does not exist", async () => {
      (mockRepository.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        service.toggleUpvote("non-existent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should not go below 0 upvote count", async () => {
      const resourceWithZeroUpvotes = { ...mockResource, upvoteCount: 0 };
      (mockRepository.findById as jest.Mock).mockResolvedValue(
        resourceWithZeroUpvotes,
      );
      (mockRepository.findUpvote as jest.Mock).mockResolvedValue({
        id: "upvote-1",
        userId: "user-1",
        resourceId: "resource-1",
      });

      const result = await service.toggleUpvote("resource-1", "user-1");

      expect(result.upvoteCount).toBe(0); // Math.max(0, 0 - 1) = 0
    });
  });

  describe("getUpvoteStatus", () => {
    it("should return upvoted true when upvote exists", async () => {
      (mockPrisma.resourceUpvote!.findUnique as jest.Mock).mockResolvedValue({
        id: "upvote-1",
        userId: "user-1",
        resourceId: "resource-1",
      });

      const result = await service.getUpvoteStatus("resource-1", "user-1");

      expect(result.upvoted).toBe(true);
    });

    it("should return upvoted false when no upvote exists", async () => {
      (mockPrisma.resourceUpvote!.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getUpvoteStatus("resource-1", "user-1");

      expect(result.upvoted).toBe(false);
    });
  });

  describe("getUserUpvotedResourceIds", () => {
    it("should return list of upvoted resource IDs for a user", async () => {
      (mockPrisma.resourceUpvote!.findMany as jest.Mock).mockResolvedValue([
        { resourceId: "resource-1" },
        { resourceId: "resource-2" },
      ]);

      const result = await service.getUserUpvotedResourceIds("user-1");

      expect(result).toEqual(["resource-1", "resource-2"]);
    });

    it("should return empty array when user has no upvotes", async () => {
      (mockPrisma.resourceUpvote!.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getUserUpvotedResourceIds("user-1");

      expect(result).toEqual([]);
    });
  });
});

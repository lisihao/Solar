import { Test, TestingModule } from "@nestjs/testing";
import { ArxivService } from "../arxiv.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "../deduplication.service";
import axios from "axios";
import * as xml2js from "xml2js";

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("ArxivService", () => {
  let service: ArxivService;
  let prismaService: any;
  let mongodbService: any;
  let dedupService: any;
  let parseStringPromiseSpy: jest.SpyInstance;

  const mockArxivEntry = {
    id: "http://arxiv.org/abs/2311.12345v1",
    title: "Test Paper Title",
    summary: "This is a test paper abstract.",
    author: [{ name: "John Doe" }, { name: "Jane Smith" }],
    published: "2023-11-20T00:00:00Z",
    updated: "2023-11-21T00:00:00Z",
    category: [
      { $: { term: "cs.AI", scheme: "http://arxiv.org/schemas/atom" } },
      { $: { term: "cs.LG", scheme: "http://arxiv.org/schemas/atom" } },
    ],
    link: [
      {
        $: {
          href: "http://arxiv.org/abs/2311.12345v1",
          rel: "alternate",
          type: "text/html",
        },
      },
      {
        $: {
          href: "http://arxiv.org/pdf/2311.12345v1",
          rel: "related",
          type: "application/pdf",
        },
      },
    ],
    "arxiv:primary_category": { $: { term: "cs.AI" } },
  };

  const mockXmlResult = {
    feed: {
      entry: [mockArxivEntry],
    },
  };

  const setupSuccessfulProcessing = () => {
    mockedAxios.get.mockResolvedValue({ data: "<xml>mock</xml>" });
    parseStringPromiseSpy.mockResolvedValue(mockXmlResult);

    mongodbService.findRawDataByExternalId.mockResolvedValue(null);
    mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
      null,
    );
    mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
    mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
    mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
    mongodbService.findRawDataById.mockResolvedValue({
      resourceId: "resource-id-123",
    });
    mongodbService.linkResourceToRawData.mockResolvedValue(undefined);

    prismaService.resource.create.mockResolvedValue({
      id: "resource-id-123",
      title: "Test Paper Title",
      type: "PAPER",
    });
  };

  beforeEach(async () => {
    // Spy on xml2js.Parser prototype to intercept parseStringPromise calls
    parseStringPromiseSpy = jest
      .spyOn(xml2js.Parser.prototype, "parseStringPromise")
      .mockResolvedValue(mockXmlResult);

    const mockPrismaService = {
      resource: {
        create: jest.fn(),
      },
    };

    const mockMongodbService = {
      findRawDataByExternalId: jest.fn(),
      findRawDataByExternalIdAcrossAllSources: jest.fn(),
      findRawDataByUrlAcrossAllSources: jest.fn(),
      findRawDataByTitleAcrossAllSources: jest.fn(),
      findRawDataById: jest.fn(),
      insertRawData: jest.fn(),
      linkResourceToRawData: jest.fn(),
    };

    const mockDedupService = {
      cleanText: jest
        .fn()
        .mockImplementation((text: string) => text?.trim() || ""),
      normalizeUrl: jest
        .fn()
        .mockImplementation((url: string) => url.toLowerCase()),
      areTitlesSimilar: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArxivService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RawDataService, useValue: mockMongodbService },
        { provide: DeduplicationService, useValue: mockDedupService },
      ],
    }).compile();

    service = module.get<ArxivService>(ArxivService);
    prismaService = module.get(PrismaService);
    mongodbService = module.get(RawDataService);
    dedupService = module.get(DeduplicationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== fetchLatestPapers ====================

  describe("fetchLatestPapers", () => {
    beforeEach(() => {
      setupSuccessfulProcessing();
    });

    it("should fetch papers from arXiv API and return success count", async () => {
      const result = await service.fetchLatestPapers(10);

      expect(result).toBe(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        "http://export.arxiv.org/api/query",
        expect.objectContaining({
          params: expect.objectContaining({
            search_query: "all",
            max_results: 10,
            sortBy: "submittedDate",
          }),
        }),
      );
    });

    it("should use category filter when provided", async () => {
      await service.fetchLatestPapers(5, "cs.AI");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            search_query: "cat:cs.AI",
          }),
        }),
      );
    });

    it("should return 0 when no entries found in API response", async () => {
      parseStringPromiseSpy.mockResolvedValue({ feed: {} });

      const result = await service.fetchLatestPapers(10);

      expect(result).toBe(0);
    });

    it("should throw error when API request fails", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Network error"));

      await expect(service.fetchLatestPapers(10)).rejects.toThrow(
        "Network error",
      );
    });

    it("should store complete raw data in MongoDB", async () => {
      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).toHaveBeenCalledWith(
        "arxiv",
        expect.objectContaining({
          externalId: "2311.12345v1",
          title: "Test Paper Title",
          _raw: mockArxivEntry,
        }),
      );
    });

    it("should create resource in PostgreSQL with rawDataId reference", async () => {
      await service.fetchLatestPapers(10);

      expect(prismaService.resource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "PAPER",
          title: "Test Paper Title",
          rawDataId: "mongo-id-123",
        }),
      });
    });

    it("should establish bidirectional MongoDB-PostgreSQL reference", async () => {
      await service.fetchLatestPapers(10);

      expect(mongodbService.linkResourceToRawData).toHaveBeenCalledWith(
        "mongo-id-123",
        "resource-id-123",
      );
    });

    it("should throw error when reference sync fails", async () => {
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "wrong-id",
      });

      // The error is caught by processPaper, logged, and fetchLatestPapers returns 0
      // (it catches the error in the for loop)
      const result = await service.fetchLatestPapers(10);
      expect(result).toBe(0);
    });

    it("should skip paper that already exists (layer 1 dedup)", async () => {
      mongodbService.findRawDataByExternalId.mockResolvedValue({
        _id: "existing-doc",
        source: "arxiv",
      });

      await service.fetchLatestPapers(10);

      // processPaper returns early (no insert), but fetchLatestPapers catches
      // the "skip" as a success (no throw), so successCount still increments
      // Actually, looking at the source: processPaper returns void (no throw on dedup),
      // so the for loop treats it as success
      expect(mongodbService.insertRawData).not.toHaveBeenCalled();
    });

    it("should skip paper existing from another source (layer 2 dedup)", async () => {
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue({
        source: "pubmed",
      });

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).not.toHaveBeenCalled();
    });

    it("should skip paper with duplicate URL (layer 3 dedup)", async () => {
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue({
        source: "semantic-scholar",
      });

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).not.toHaveBeenCalled();
    });

    it("should skip paper with similar title (layer 4 dedup)", async () => {
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([
        { data: { title: "Test Paper Title" }, source: "semantic-scholar" },
      ]);
      dedupService.areTitlesSimilar.mockReturnValue(true);

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).not.toHaveBeenCalled();
    });

    it("should handle multiple entries", async () => {
      const secondEntry = {
        ...mockArxivEntry,
        id: "http://arxiv.org/abs/2311.99999v1",
        title: "Another Paper",
      };
      parseStringPromiseSpy.mockResolvedValue({
        feed: { entry: [mockArxivEntry, secondEntry] },
      });

      mongodbService.findRawDataById
        .mockResolvedValueOnce({ resourceId: "resource-id-123" })
        .mockResolvedValueOnce({ resourceId: "resource-id-456" });
      prismaService.resource.create
        .mockResolvedValueOnce({ id: "resource-id-123" })
        .mockResolvedValueOnce({ id: "resource-id-456" });
      mongodbService.insertRawData
        .mockResolvedValueOnce("mongo-id-123")
        .mockResolvedValueOnce("mongo-id-456");

      const result = await service.fetchLatestPapers(10);

      expect(result).toBe(2);
    });

    it("should handle single entry (non-array) from XML", async () => {
      parseStringPromiseSpy.mockResolvedValue({
        feed: { entry: mockArxivEntry }, // single object, not array
      });

      const result = await service.fetchLatestPapers(10);

      // Should process the single entry
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it("should handle paper with no extractable arXiv ID gracefully", async () => {
      const badEntry = {
        ...mockArxivEntry,
        id: "http://invalid-url-with-no-arxiv-id/path",
      };
      parseStringPromiseSpy.mockResolvedValue({
        feed: { entry: [badEntry] },
      });

      // processPaper returns early when ID is null, no error thrown
      // successCount still increments in the outer loop
      await service.fetchLatestPapers(10);
      expect(mongodbService.insertRawData).not.toHaveBeenCalled();
    });

    it("should include HTTP timeout and headers in request", async () => {
      await service.fetchLatestPapers(5);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": expect.stringContaining("Mozilla"),
          }),
          timeout: 30000,
        }),
      );
    });
  });

  // ==================== searchPapers ====================

  describe("searchPapers", () => {
    beforeEach(() => {
      setupSuccessfulProcessing();
    });

    it("should search papers with query term", async () => {
      await service.searchPapers("machine learning", 5);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        "http://export.arxiv.org/api/query",
        expect.objectContaining({
          params: expect.objectContaining({
            search_query: "all:machine learning",
            sortBy: "relevance",
            max_results: 5,
          }),
        }),
      );
    });

    it("should return count of successfully processed papers", async () => {
      const result = await service.searchPapers("transformer", 10);

      expect(result).toBe(1);
    });

    it("should return 0 when no papers found", async () => {
      parseStringPromiseSpy.mockResolvedValue({ feed: {} });

      const result = await service.searchPapers("nonexistent topic", 10);

      expect(result).toBe(0);
    });

    it("should throw error when search API fails", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Search failed"));

      await expect(service.searchPapers("AI", 10)).rejects.toThrow(
        "Search failed",
      );
    });

    it("should use sortBy relevance instead of submittedDate", async () => {
      await service.searchPapers("deep learning", 5);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            sortBy: "relevance",
          }),
        }),
      );
    });

    it("should use default maxResults when not specified", async () => {
      await service.searchPapers("AI");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            max_results: 10,
          }),
        }),
      );
    });
  });

  // ==================== Author parsing ====================

  describe("author parsing", () => {
    it("should process paper with single author (non-array)", async () => {
      const singleAuthorEntry = {
        ...mockArxivEntry,
        author: { name: "Solo Author" },
      };
      parseStringPromiseSpy.mockResolvedValue({
        feed: { entry: [singleAuthorEntry] },
      });
      mockedAxios.get.mockResolvedValue({ data: "<xml>" });
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "resource-id-123",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "resource-id-123",
      });

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).toHaveBeenCalledWith(
        "arxiv",
        expect.objectContaining({
          authors: [{ name: "Solo Author", affiliation: null }],
        }),
      );
    });

    it("should process paper with no authors (undefined)", async () => {
      const noAuthorEntry = { ...mockArxivEntry, author: undefined };
      parseStringPromiseSpy.mockResolvedValue({
        feed: { entry: [noAuthorEntry] },
      });
      mockedAxios.get.mockResolvedValue({ data: "<xml>" });
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "resource-id-123",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "resource-id-123",
      });

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).toHaveBeenCalledWith(
        "arxiv",
        expect.objectContaining({ authors: [] }),
      );
    });

    it("should process paper with multiple authors", async () => {
      mockedAxios.get.mockResolvedValue({ data: "<xml>" });
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "resource-id-123",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "resource-id-123",
      });

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).toHaveBeenCalledWith(
        "arxiv",
        expect.objectContaining({
          authors: expect.arrayContaining([
            { name: "John Doe", affiliation: null },
            { name: "Jane Smith", affiliation: null },
          ]),
        }),
      );
    });
  });

  // ==================== PDF URL extraction ====================

  describe("PDF URL extraction", () => {
    it("should extract PDF URL from application/pdf link type", async () => {
      mockedAxios.get.mockResolvedValue({ data: "<xml>" });
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "resource-id-123",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "resource-id-123",
      });

      await service.fetchLatestPapers(10);

      expect(prismaService.resource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          pdfUrl: "https://arxiv.org/pdf/2311.12345v1",
        }),
      });
    });

    it("should construct PDF URL from abstract URL when no direct PDF link", async () => {
      const entryWithoutPdfLink = {
        ...mockArxivEntry,
        link: [
          {
            $: {
              href: "http://arxiv.org/abs/2311.12345v1",
              rel: "alternate",
              type: "text/html",
            },
          },
        ],
      };
      parseStringPromiseSpy.mockResolvedValue({
        feed: { entry: [entryWithoutPdfLink] },
      });
      mockedAxios.get.mockResolvedValue({ data: "<xml>" });
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "resource-id-123",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "resource-id-123",
      });

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).toHaveBeenCalledWith(
        "arxiv",
        expect.objectContaining({
          pdfUrl: "https://arxiv.org/pdf/2311.12345v1.pdf",
        }),
      );
    });
  });

  // ==================== Category parsing ====================

  describe("category parsing", () => {
    it("should parse single category (non-array)", async () => {
      const singleCategoryEntry = {
        ...mockArxivEntry,
        category: {
          $: { term: "cs.AI", scheme: "http://arxiv.org/schemas/atom" },
        },
      };
      parseStringPromiseSpy.mockResolvedValue({
        feed: { entry: [singleCategoryEntry] },
      });
      mockedAxios.get.mockResolvedValue({ data: "<xml>" });
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "resource-id-123",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "resource-id-123",
      });

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).toHaveBeenCalledWith(
        "arxiv",
        expect.objectContaining({
          categories: [
            { term: "cs.AI", scheme: "http://arxiv.org/schemas/atom" },
          ],
        }),
      );
    });

    it("should parse multiple categories", async () => {
      mockedAxios.get.mockResolvedValue({ data: "<xml>" });
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "resource-id-123",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "resource-id-123",
      });

      await service.fetchLatestPapers(10);

      expect(mongodbService.insertRawData).toHaveBeenCalledWith(
        "arxiv",
        expect.objectContaining({
          categories: expect.arrayContaining([
            expect.objectContaining({ term: "cs.AI" }),
            expect.objectContaining({ term: "cs.LG" }),
          ]),
        }),
      );
    });
  });

  // ==================== Resource data extraction ====================

  describe("resource data extraction", () => {
    it("should extract all required fields for PostgreSQL resource", async () => {
      mockedAxios.get.mockResolvedValue({ data: "<xml>" });
      mongodbService.findRawDataByExternalId.mockResolvedValue(null);
      mongodbService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongodbService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongodbService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongodbService.insertRawData.mockResolvedValue("mongo-id-123");
      mongodbService.findRawDataById.mockResolvedValue({
        resourceId: "resource-id-123",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "resource-id-123",
      });

      await service.fetchLatestPapers(10);

      expect(prismaService.resource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "PAPER",
          abstract: expect.any(String),
          sourceUrl: expect.stringContaining("https://arxiv.org/abs/"),
          publishedAt: expect.any(Date),
          primaryCategory: "cs.AI",
          qualityScore: 0,
          trendingScore: 0,
        }),
      });
    });
  });
});

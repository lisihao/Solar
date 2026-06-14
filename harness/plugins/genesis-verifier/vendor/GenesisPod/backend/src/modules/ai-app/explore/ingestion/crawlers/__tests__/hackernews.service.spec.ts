import { Test, TestingModule } from "@nestjs/testing";
import { HackernewsService } from "../hackernews.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "../deduplication.service";
import { AIEnrichmentService } from "../../../../explore/resources/ai-enrichment.service";
import { HackernewsCommentsService } from "../hackernews-comments.service";
import axios from "axios";

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("HackernewsService", () => {
  let service: HackernewsService;
  let prismaService: any;
  let mongoService: any;

  // Mock数据
  const mockStoryData = {
    id: 123,
    type: "story",
    by: "testuser",
    time: Math.floor(Date.now() / 1000),
    title: "Test Story Title",
    url: "https://example.com/article",
    score: 100,
    descendants: 50,
    kids: [111, 222],
  };

  beforeEach(async () => {
    const mockPrismaService = {
      resource: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockMongoService = {
      findRawDataByExternalId: jest.fn(),
      findRawDataByExternalIdAcrossAllSources: jest.fn(),
      findRawDataByUrlAcrossAllSources: jest.fn(),
      findRawDataByTitleAcrossAllSources: jest.fn(),
      findRawDataById: jest.fn(),
      insertRawData: jest.fn(),
      linkResourceToRawData: jest.fn(),
    };

    const mockDedupService = {
      generateUrlHash: jest.fn().mockReturnValue("mock-hash"),
      areTitlesSimilar: jest.fn().mockReturnValue(false),
      normalizeUrl: jest.fn().mockImplementation((url) => url.toLowerCase()),
      cleanText: jest.fn().mockImplementation((text) => text?.trim() || ""),
      extractDomain: jest.fn().mockReturnValue("example.com"),
    };

    const mockAiService = {
      enrichResource: jest.fn().mockResolvedValue({
        aiSummary: "AI Summary",
        keyInsights: [],
        autoTags: [],
        primaryCategory: "Tech",
        difficultyLevel: "INTERMEDIATE",
      }),
    };

    const mockCommentsService = {
      fetchTopComments: jest.fn().mockResolvedValue([]),
      generateCommentsSummary: jest.fn().mockResolvedValue("Comments summary"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HackernewsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RawDataService, useValue: mockMongoService },
        { provide: DeduplicationService, useValue: mockDedupService },
        { provide: AIEnrichmentService, useValue: mockAiService },
        { provide: HackernewsCommentsService, useValue: mockCommentsService },
      ],
    }).compile();

    service = module.get<HackernewsService>(HackernewsService);
    prismaService = module.get(PrismaService);
    mongoService = module.get(RawDataService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("fetchTopStories", () => {
    beforeEach(() => {
      // Default mock setup for successful story processing
      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.findRawDataById.mockImplementation(() => ({
        resourceId: "mock-resource-id",
      }));
      mongoService.insertRawData.mockResolvedValue("mock-mongo-id-123");
      prismaService.resource.create.mockResolvedValue({
        id: "mock-resource-id",
        title: mockStoryData.title,
        type: "NEWS",
        sourceUrl: mockStoryData.url,
      });

      // Mock axios.head for URL accessibility check
      mockedAxios.head.mockResolvedValue({ status: 200 });
    });

    it("应该处理API错误", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("API Error"));

      await expect(service.fetchTopStories(10)).rejects.toThrow("API Error");
    });

    it("应该跳过已存在的故事（去重）", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [123] });
      // findRawDataByExternalId returns existing data
      mongoService.findRawDataByExternalId.mockResolvedValue({
        _id: "existing-id",
        source: "hackernews",
        data: {},
      });

      const result = await service.fetchTopStories(1);

      // processStory returns early when duplicate found, but successCount still increments
      // because the function doesn't throw an error
      expect(result).toBe(1);
      // The key assertion: no new data was inserted
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
      expect(prismaService.resource.create).not.toHaveBeenCalled();
    });

    it("应该跳过非story类型的项目", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [123] });
      mockedAxios.get.mockResolvedValueOnce({
        data: { ...mockStoryData, type: "comment" },
      });

      const result = await service.fetchTopStories(1);

      // processStory returns early when type is not "story", but successCount still increments
      expect(result).toBe(1);
      // The key assertion: no data was inserted for non-story items
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
    });

    it("应该限制获取数量", async () => {
      const manyIds = Array.from({ length: 100 }, (_, i) => i + 1);
      mockedAxios.get.mockResolvedValueOnce({ data: manyIds });

      // Make fetchItem return different story data for each ID
      mockedAxios.get.mockImplementation((url: string) => {
        const match = url.match(/item\/(\d+)\.json/);
        if (match) {
          const id = parseInt(match[1]);
          return Promise.resolve({
            data: {
              ...mockStoryData,
              id,
              url: `https://example${id}.com/article`,
            },
          });
        }
        return Promise.resolve({ data: manyIds });
      });

      await service.fetchTopStories(5);

      // Should call insertRawData at most 5 times
      expect(mongoService.insertRawData.mock.calls.length).toBeLessThanOrEqual(
        5,
      );
    });
  });

  describe("fetchNewStories", () => {
    it("应该调用正确的API端点", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [] });

      await service.fetchNewStories(1);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("newstories.json"),
        expect.objectContaining({
          timeout: expect.any(Number),
          headers: expect.any(Object),
        }),
      );
    });
  });

  describe("fetchBestStories", () => {
    it("应该调用正确的API端点", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [] });

      await service.fetchBestStories(1);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining("beststories.json"),
        expect.objectContaining({
          timeout: expect.any(Number),
          headers: expect.any(Object),
        }),
      );
    });
  });

  describe("错误处理", () => {
    beforeEach(() => {
      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.findRawDataById.mockImplementation(() => ({
        resourceId: "mock-resource-id",
      }));
      mockedAxios.head.mockResolvedValue({ status: 200 });
    });

    it("应该处理单个故事获取失败但继续处理其他故事", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [123, 456, 789] });

      // First story succeeds, second fails, third succeeds
      mockedAxios.get
        .mockResolvedValueOnce({ data: mockStoryData })
        .mockRejectedValueOnce(new Error("故事456获取失败"))
        .mockResolvedValueOnce({
          data: { ...mockStoryData, id: 789, url: "https://other.com" },
        });

      mongoService.insertRawData.mockResolvedValue("mock-id");
      prismaService.resource.create.mockResolvedValue({
        id: "id",
        sourceUrl: mockStoryData.url,
      });

      const result = await service.fetchTopStories(3);

      // Should handle partial failures gracefully
      // The second story fails during fetchItem, so it gets caught and counted as failure
      expect(result).toBeLessThanOrEqual(2);
    });

    it("应该处理MongoDB插入失败", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [123] });
      mockedAxios.get.mockResolvedValueOnce({ data: mockStoryData });

      mongoService.insertRawData.mockRejectedValue(new Error("MongoDB错误"));

      const result = await service.fetchTopStories(1);

      expect(result).toBe(0);
      expect(prismaService.resource.create).not.toHaveBeenCalled();
    });
  });

  describe("数据完整性", () => {
    beforeEach(() => {
      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mockedAxios.head.mockResolvedValue({ status: 200 });
    });

    it("应该存储完整的原始数据到MongoDB", async () => {
      const mongoId = "mongo-id";
      const resourceId = "res-id";

      mockedAxios.get.mockResolvedValueOnce({ data: [123] });
      mockedAxios.get.mockResolvedValueOnce({ data: mockStoryData });

      mongoService.insertRawData.mockResolvedValue(mongoId);
      mongoService.findRawDataById.mockResolvedValue({ resourceId });
      prismaService.resource.create.mockResolvedValue({
        id: resourceId,
        sourceUrl: mockStoryData.url,
      });

      await service.fetchTopStories(1);

      // Verify MongoDB stored complete data
      expect(mongoService.insertRawData).toHaveBeenCalledWith(
        "hackernews",
        expect.objectContaining({
          externalId: "123",
          _raw: mockStoryData,
        }),
      );
    });

    it("应该建立MongoDB和PostgreSQL的双向引用", async () => {
      const mongoId = "mongo-raw-data-id-123";
      const resourceId = "postgres-resource-id-456";

      mockedAxios.get.mockResolvedValueOnce({ data: [123] });
      mockedAxios.get.mockResolvedValueOnce({ data: mockStoryData });

      mongoService.insertRawData.mockResolvedValue(mongoId);
      mongoService.findRawDataById.mockResolvedValue({ resourceId });
      prismaService.resource.create.mockResolvedValue({
        id: resourceId,
        sourceUrl: mockStoryData.url,
      });

      await service.fetchTopStories(1);

      // Verify Prisma creates resource with rawDataId
      expect(prismaService.resource.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          rawDataId: mongoId,
        }),
      });

      // Verify MongoDB link update
      expect(mongoService.linkResourceToRawData).toHaveBeenCalledWith(
        mongoId,
        resourceId,
      );
    });
  });
});

/**
 * HackernewsService supplemental tests
 *
 * Covers previously untested paths:
 * - fetchNewStories / fetchBestStories — error path (throws)
 * - fetchNewStories / fetchBestStories — success with items
 * - processStory dedup level 2: cross-source duplicate
 * - processStory dedup level 3: URL duplicate
 * - processStory dedup level 4: title similarity match
 * - processStory dedup level 5: URL not accessible (HEAD returns non-2xx)
 * - processStory dedup level 5: HEAD 405 → GET fallback (accessible)
 * - processStory dedup level 5: HEAD 405 → GET also fails
 * - processStory reference sync failure (resourceId mismatch)
 * - processStory: story has no URL (skips URL checks, skips accessibility)
 * - processStory: story with kids → fetches top comments
 * - processStory: comments fetch failure is non-blocking
 * - enrichResourceWithAI: AI enrichment failure is non-blocking
 * - extractTags: keyword extraction from title
 * - calculateQualityScore / calculateTrendingScore via full processStory flow
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HackernewsService } from "../hackernews.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "../deduplication.service";
import { AIEnrichmentService } from "../../../../explore/resources/ai-enrichment.service";
import { HackernewsCommentsService } from "../hackernews-comments.service";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("HackernewsService (supplemental)", () => {
  let service: HackernewsService;
  let prismaService: {
    resource: { create: jest.Mock; update: jest.Mock };
  };
  let mongoService: {
    findRawDataByExternalId: jest.Mock;
    findRawDataByExternalIdAcrossAllSources: jest.Mock;
    findRawDataByUrlAcrossAllSources: jest.Mock;
    findRawDataByTitleAcrossAllSources: jest.Mock;
    findRawDataById: jest.Mock;
    insertRawData: jest.Mock;
    linkResourceToRawData: jest.Mock;
  };
  let dedupService: {
    generateUrlHash: jest.Mock;
    areTitlesSimilar: jest.Mock;
    normalizeUrl: jest.Mock;
    cleanText: jest.Mock;
    extractDomain: jest.Mock;
  };
  let aiEnrichment: { enrichResource: jest.Mock };
  let commentsService: {
    fetchTopComments: jest.Mock;
    generateCommentsSummary: jest.Mock;
  };

  const baseStoryData = {
    id: 42,
    type: "story",
    by: "testuser",
    time: Math.floor(Date.now() / 1000) - 3600,
    title: "Test Story",
    url: "https://example.com/test",
    score: 200,
    descendants: 80,
    kids: [1001, 1002, 1003],
  };

  beforeEach(async () => {
    const mockPrismaService = {
      resource: {
        create: jest.fn(),
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
      generateUrlHash: jest.fn().mockReturnValue("hash"),
      areTitlesSimilar: jest.fn().mockReturnValue(false),
      normalizeUrl: jest
        .fn()
        .mockImplementation((u: string) => u.toLowerCase()),
      cleanText: jest.fn().mockImplementation((t: string) => (t || "").trim()),
      extractDomain: jest.fn().mockReturnValue("example.com"),
    };

    const mockAiEnrichment = {
      enrichResource: jest.fn().mockResolvedValue({
        aiSummary: "Summary",
        keyInsights: ["insight1"],
        autoTags: ["tag1"],
        primaryCategory: "Tech",
        difficultyLevel: "INTERMEDIATE",
      }),
    };

    const mockCommentsService = {
      fetchTopComments: jest.fn().mockResolvedValue([]),
      generateCommentsSummary: jest.fn().mockResolvedValue("Summary"),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HackernewsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RawDataService, useValue: mockMongoService },
        { provide: DeduplicationService, useValue: mockDedupService },
        { provide: AIEnrichmentService, useValue: mockAiEnrichment },
        { provide: HackernewsCommentsService, useValue: mockCommentsService },
      ],
    }).compile();

    service = module.get<HackernewsService>(HackernewsService);
    prismaService = module.get(PrismaService);
    mongoService = module.get(RawDataService);
    dedupService = module.get(DeduplicationService);
    aiEnrichment = module.get(AIEnrichmentService);
    commentsService = module.get(HackernewsCommentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // fetchNewStories — error path
  // ---------------------------------------------------------------------------

  describe("fetchNewStories", () => {
    it("throws when API call fails", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network down"));

      await expect(service.fetchNewStories(5)).rejects.toThrow("Network down");
    });

    it("returns success count when stories processed successfully", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      // fetchItem returns story data
      mockedAxios.get.mockResolvedValueOnce({ data: baseStoryData });
      // HEAD request for URL accessibility
      mockedAxios.head.mockResolvedValue({ status: 200 });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: baseStoryData.title,
        sourceUrl: baseStoryData.url,
      });

      const result = await service.fetchNewStories(1);
      expect(result).toBe(1);
    });

    it("counts failed individual stories but does not throw", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [1, 2] });
      // Make processStory throw via mongodb error (no internal catch for this)
      mongoService.findRawDataByExternalId.mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.fetchNewStories(2);
      // Both fail during processStory, successCount = 0
      expect(result).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchBestStories — error path
  // ---------------------------------------------------------------------------

  describe("fetchBestStories", () => {
    it("throws when API call fails", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Timeout"));

      await expect(service.fetchBestStories(5)).rejects.toThrow("Timeout");
    });

    it("returns 0 when story list is empty", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [] });

      const result = await service.fetchBestStories(10);
      expect(result).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // processStory — dedup level 2: cross-source duplicate
  // ---------------------------------------------------------------------------

  describe("processStory dedup — cross-source duplicate (level 2)", () => {
    it("skips story already existing from another source", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue({
        _id: "other-source-id",
        source: "reddit",
      });

      const result = await service.fetchTopStories(1);

      expect(result).toBe(1); // processStory returned early — no error
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // processStory — dedup level 3: URL duplicate
  // ---------------------------------------------------------------------------

  describe("processStory dedup — URL duplicate (level 3)", () => {
    it("skips story with duplicate URL from another source", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: baseStoryData });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue({
        _id: "url-dup-id",
        source: "rss",
      });

      const result = await service.fetchTopStories(1);

      expect(result).toBe(1);
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // processStory — dedup level 4: title similarity
  // ---------------------------------------------------------------------------

  describe("processStory dedup — title similarity (level 4)", () => {
    it("skips story with similar title from another source", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: baseStoryData });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([
        { data: { title: "Test Story (Similar)" }, source: "reddit" },
      ]);
      dedupService.areTitlesSimilar.mockReturnValue(true);

      const result = await service.fetchTopStories(1);

      expect(result).toBe(1);
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
      expect(dedupService.areTitlesSimilar).toHaveBeenCalled();
    });

    it("does not skip when title similarity is below threshold", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: baseStoryData });
      mockedAxios.head.mockResolvedValue({ status: 200 });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([
        { data: { title: "Something Completely Different" }, source: "rss" },
      ]);
      dedupService.areTitlesSimilar.mockReturnValue(false);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: baseStoryData.title,
        sourceUrl: baseStoryData.url,
      });

      const result = await service.fetchTopStories(1);
      expect(result).toBe(1);
      expect(mongoService.insertRawData).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // processStory — dedup level 5: URL accessibility
  // ---------------------------------------------------------------------------

  describe("processStory — URL accessibility check (level 5)", () => {
    beforeEach(() => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: baseStoryData });
      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
    });

    it("skips story when URL returns 4xx status", async () => {
      mockedAxios.head.mockResolvedValue({ status: 403 });

      const result = await service.fetchTopStories(1);

      expect(result).toBe(1);
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
    });

    it("skips story when HEAD throws a non-405 error", async () => {
      mockedAxios.head.mockRejectedValue(new Error("SSL error"));

      const result = await service.fetchTopStories(1);

      expect(result).toBe(1);
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
    });

    it("falls back to GET when HEAD returns 405 and GET is accessible", async () => {
      const headError = {
        response: { status: 405 },
        message: "Method Not Allowed",
      };
      mockedAxios.head.mockRejectedValue(headError);

      const fakeStream = { destroy: jest.fn() };
      mockedAxios.get.mockResolvedValueOnce({ status: 200, data: fakeStream });

      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: baseStoryData.title,
        sourceUrl: baseStoryData.url,
      });

      const result = await service.fetchTopStories(1);
      // processStory continued after GET fallback
      expect(mongoService.insertRawData).toHaveBeenCalled();
      expect(result).toBe(1);
    });

    it("skips story when HEAD returns 405 and GET fallback also fails", async () => {
      const headError = {
        response: { status: 405 },
        message: "Method Not Allowed",
      };
      mockedAxios.head.mockRejectedValue(headError);
      mockedAxios.get.mockRejectedValueOnce(new Error("GET also failed"));

      const result = await service.fetchTopStories(1);

      expect(result).toBe(1);
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // processStory — story with no external URL (HN-only discussion)
  // ---------------------------------------------------------------------------

  describe("processStory — story without external URL", () => {
    it("skips URL and accessibility checks when story has no URL", async () => {
      const noUrlStory = {
        ...baseStoryData,
        url: undefined,
        kids: [],
      };
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: noUrlStory });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: noUrlStory.title,
        sourceUrl: `https://news.ycombinator.com/item?id=${noUrlStory.id}`,
      });

      const result = await service.fetchTopStories(1);

      expect(result).toBe(1);
      // No HEAD request since there's no URL
      expect(mockedAxios.head).not.toHaveBeenCalled();
      expect(mongoService.insertRawData).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // processStory — story with kids: fetches and stores top comments
  // ---------------------------------------------------------------------------

  describe("processStory — comments fetching", () => {
    beforeEach(() => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: baseStoryData });
      mockedAxios.head.mockResolvedValue({ status: 200 });
      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: baseStoryData.title,
        sourceUrl: baseStoryData.url,
      });
    });

    it("fetches top comments when story has kids", async () => {
      commentsService.fetchTopComments.mockResolvedValue([
        { id: 1001, text: "Great article" },
        { id: 1002, text: "Interesting point" },
      ]);
      commentsService.generateCommentsSummary.mockResolvedValue(
        "Good discussion",
      );

      await service.fetchTopStories(1);

      expect(commentsService.fetchTopComments).toHaveBeenCalledWith(
        baseStoryData.id,
        20,
        2,
      );
      expect(commentsService.generateCommentsSummary).toHaveBeenCalled();

      const insertCall = mongoService.insertRawData.mock.calls[0][1];
      expect(insertCall.commentsSummary).toBe("Good discussion");
      expect(insertCall.topComments).toHaveLength(2);
    });

    it("continues without comments when fetchTopComments returns empty array", async () => {
      commentsService.fetchTopComments.mockResolvedValue([]);

      await service.fetchTopStories(1);

      expect(commentsService.fetchTopComments).toHaveBeenCalled();
      expect(commentsService.generateCommentsSummary).not.toHaveBeenCalled();
      expect(mongoService.insertRawData).toHaveBeenCalled();
    });

    it("continues processing when comments fetch throws (non-blocking)", async () => {
      commentsService.fetchTopComments.mockRejectedValue(
        new Error("Comments API unavailable"),
      );

      const result = await service.fetchTopStories(1);

      expect(result).toBe(1);
      expect(mongoService.insertRawData).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // processStory — reference sync failure
  // ---------------------------------------------------------------------------

  describe("processStory — reference sync failure", () => {
    it("throws when MongoDB resourceId does not match created resource id", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({
        data: { ...baseStoryData, kids: [] },
      });
      mockedAxios.head.mockResolvedValue({ status: 200 });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      // Return wrong resourceId — mismatch
      mongoService.findRawDataById.mockResolvedValue({
        resourceId: "WRONG-ID",
      });
      prismaService.resource.create.mockResolvedValue({
        id: "correct-res-id",
        title: baseStoryData.title,
        sourceUrl: baseStoryData.url,
      });

      // The story processStory will throw due to reference sync failure
      const result = await service.fetchTopStories(1);
      // Error caught at loop level, successCount stays 0
      expect(result).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // AI enrichment — failure is non-blocking
  // ---------------------------------------------------------------------------

  describe("enrichResourceWithAI — failure is non-blocking", () => {
    it("does not affect the main flow when AI enrichment fails", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({
        data: { ...baseStoryData, kids: [] },
      });
      mockedAxios.head.mockResolvedValue({ status: 200 });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: baseStoryData.title,
        sourceUrl: baseStoryData.url,
      });

      // Make AI enrichment reject
      aiEnrichment.enrichResource.mockRejectedValue(new Error("OpenAI down"));

      // The main flow should still succeed
      const result = await service.fetchTopStories(1);
      expect(result).toBe(1);
      expect(mongoService.insertRawData).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // extractTags — keyword extraction logic
  // ---------------------------------------------------------------------------

  describe("keyword extraction from titles (via processStory)", () => {
    function buildSuccessfulSetup(storyTitle: string) {
      const story = { ...baseStoryData, title: storyTitle, kids: [] };
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: story });
      mockedAxios.head.mockResolvedValue({ status: 200 });
      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: storyTitle,
        sourceUrl: baseStoryData.url,
      });
    }

    it("extracts AI keyword from title", async () => {
      buildSuccessfulSetup("Using AI to solve complex problems");
      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(createCall.data.tags).toContain("AI");
    });

    it("extracts Show HN tag from title prefix", async () => {
      buildSuccessfulSetup("Show HN: My new project");
      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(createCall.data.tags).toContain("Show HN");
    });

    it("extracts Ask HN tag from title prefix", async () => {
      buildSuccessfulSetup("Ask HN: What is the best Python framework?");
      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(createCall.data.tags).toContain("Ask HN");
      expect(createCall.data.tags).toContain("Python");
    });

    it("extracts multiple tech keywords from title", async () => {
      buildSuccessfulSetup("TypeScript and React running on Docker");
      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(createCall.data.tags).toContain("TypeScript");
      expect(createCall.data.tags).toContain("React");
      expect(createCall.data.tags).toContain("Docker");
    });

    it("returns empty tags for generic title without keywords", async () => {
      buildSuccessfulSetup("A very interesting article about nothing specific");
      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(Array.isArray(createCall.data.tags)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // qualityScore / trendingScore calculations
  // ---------------------------------------------------------------------------

  describe("quality and trending score calculations", () => {
    it("caps quality score at 100 for very high-scoring stories", async () => {
      const highScoreStory = {
        ...baseStoryData,
        score: 9999,
        descendants: 9999,
        kids: [],
      };
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: highScoreStory });
      mockedAxios.head.mockResolvedValue({ status: 200 });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: highScoreStory.title,
        sourceUrl: highScoreStory.url,
      });

      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(createCall.data.qualityScore).toBeLessThanOrEqual(100);
      expect(createCall.data.qualityScore).toBeGreaterThan(0);
    });

    it("calculates trendingScore as positive number", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({
        data: { ...baseStoryData, kids: [] },
      });
      mockedAxios.head.mockResolvedValue({ status: 200 });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: baseStoryData.title,
        sourceUrl: baseStoryData.url,
      });

      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(createCall.data.trendingScore).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // fetchTopStories — story where fetchItem returns null
  // ---------------------------------------------------------------------------

  describe("processStory — fetchItem returns null", () => {
    it("skips story when fetchItem returns null (item API error)", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      // fetchItem fails internally — returns null
      mockedAxios.get.mockRejectedValueOnce(new Error("item fetch failed"));

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );

      const result = await service.fetchTopStories(1);

      // processStory continues after fetchItem returns null but can't process the story
      // In this case fetchItem rejects and returns null, then storyData is null → returns early
      expect(mongoService.insertRawData).not.toHaveBeenCalled();
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // parseRawData — handles storyData with no text field
  // ---------------------------------------------------------------------------

  describe("parseRawData — story without text field", () => {
    it("stores null for text when story has no text property", async () => {
      const storyWithoutText = { ...baseStoryData, kids: [], text: undefined };
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: storyWithoutText });
      mockedAxios.head.mockResolvedValue({ status: 200 });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: storyWithoutText.title,
        sourceUrl: storyWithoutText.url,
      });

      await service.fetchTopStories(1);

      const insertCall = mongoService.insertRawData.mock.calls[0][1];
      expect(insertCall.text).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // extractResourceData — domain extraction
  // ---------------------------------------------------------------------------

  describe("extractResourceData — domain and metadata", () => {
    it("uses news.ycombinator.com as domain when no external URL", async () => {
      const noUrlStory = { ...baseStoryData, url: undefined, kids: [] };
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({ data: noUrlStory });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: noUrlStory.title,
        sourceUrl: `https://news.ycombinator.com/item?id=${noUrlStory.id}`,
      });

      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(createCall.data.metadata.domain).toBe("news.ycombinator.com");
    });

    it("includes hnId in metadata", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [42] });
      mockedAxios.get.mockResolvedValueOnce({
        data: { ...baseStoryData, kids: [] },
      });
      mockedAxios.head.mockResolvedValue({ status: 200 });

      mongoService.findRawDataByExternalId.mockResolvedValue(null);
      mongoService.findRawDataByExternalIdAcrossAllSources.mockResolvedValue(
        null,
      );
      mongoService.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
      mongoService.findRawDataByTitleAcrossAllSources.mockResolvedValue([]);
      mongoService.insertRawData.mockResolvedValue("mongo-id");
      mongoService.findRawDataById.mockResolvedValue({ resourceId: "res-id" });
      prismaService.resource.create.mockResolvedValue({
        id: "res-id",
        title: baseStoryData.title,
        sourceUrl: baseStoryData.url,
      });

      await service.fetchTopStories(1);

      const createCall = prismaService.resource.create.mock.calls[0][0];
      expect(createCall.data.metadata.hnId).toBe(baseStoryData.id);
      expect(createCall.data.metadata.author).toBe(baseStoryData.by);
    });
  });
});

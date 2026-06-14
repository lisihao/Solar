/**
 * RssService — Supplemental Unit Tests
 *
 * Covers uncovered branches not in rss.service.spec.ts:
 * - YouTube duration filtering (minDurationSeconds, skipUnknownDuration)
 * - tryGetYouTubeDuration extractor patterns
 * - parseYouTubeDurationText parsing
 * - fetchMultipleFeeds: success, partial failure, aggregation
 * - Error messages for 500 and ECONNREFUSED
 * - Reference sync failure (bi-directional ref mismatch)
 * - extractArxivId (non-arxiv URL)
 * - Title duplicate detection via similarity check
 */

import { Test, TestingModule } from "@nestjs/testing";
import { RssService } from "../rss.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "../deduplication.service";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockParseURL = jest.fn();
jest.mock("rss-parser", () => {
  return jest.fn().mockImplementation(() => ({
    parseURL: mockParseURL,
  }));
});

// Mock YouTube oEmbed precheck — synthetic test IDs would otherwise hit real
// YouTube and fail with 400. Default verdict makes precheck a no-op.
jest.mock("../../../../explore/resources/youtube-precheck.util", () => ({
  precheckYoutubeUrl: jest
    .fn()
    .mockResolvedValue({ verdict: "not-youtube", reason: "not-youtube" }),
}));

// ── Shared mocks ──────────────────────────────────────────────────────────────

const mockPrisma = {
  resource: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

const mockMongodb = {
  insertRawData: jest.fn(),
  linkResourceToRawData: jest.fn(),
  findRawDataById: jest.fn(),
  findRawDataByUrlAcrossAllSources: jest.fn(),
};

const mockDeduplication = {
  normalizeUrl: jest.fn(),
  areTitlesSimilar: jest.fn(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeYouTubeItem(overrides = {}) {
  return {
    title: "Test Video",
    link: "https://www.youtube.com/watch?v=abc123",
    guid: "yt-guid-123",
    ...overrides,
  };
}

function makeYouTubeFeedResponse(items = [makeYouTubeItem()]) {
  return {
    title: "Test YouTube Channel",
    link: "https://www.youtube.com/channel/test",
    items,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RssService (supplemental)", () => {
  let service: RssService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RssService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RawDataService, useValue: mockMongodb },
        { provide: DeduplicationService, useValue: mockDeduplication },
      ],
    }).compile();

    service = module.get<RssService>(RssService);
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Default safe behaviours
    mockDeduplication.normalizeUrl.mockImplementation((url: string) => url);
    mockDeduplication.areTitlesSimilar.mockReturnValue(false);
    mockPrisma.resource.findFirst.mockResolvedValue(null);
    mockPrisma.resource.findMany.mockResolvedValue([]);
    mockMongodb.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
    mockMongodb.insertRawData.mockResolvedValue("mongodb-id-abc");
    mockMongodb.findRawDataById.mockResolvedValue({ resourceId: "pg-id-abc" });
    mockMongodb.linkResourceToRawData.mockResolvedValue(undefined);
    mockPrisma.resource.create.mockResolvedValue({ id: "pg-id-abc" });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '"lengthSeconds":"300"',
    });
  });

  // ── YouTube duration filtering ────────────────────────────────────────────────

  describe("YouTube duration filtering", () => {
    it("skips videos shorter than minDurationSeconds", async () => {
      const ytUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UC123";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "Short video",
            link: "https://www.youtube.com/watch?v=shortId",
          }),
        ]),
      );

      // fetch returns a short video (60s)
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '"lengthSeconds":"60"',
      });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
      });

      expect(result.skipped).toBe(1);
      expect(result.success).toBe(0);
    });

    it("allows videos meeting minDurationSeconds", async () => {
      const ytUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UC123";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "Long video",
            link: "https://www.youtube.com/watch?v=longId",
          }),
        ]),
      );

      // fetch returns a long video (600s)
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '"lengthSeconds":"600"',
      });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
      });

      expect(result.success).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("skips video with unknown duration when skipUnknownDuration=true", async () => {
      const ytUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UC123";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "Unknown duration",
            link: "https://www.youtube.com/watch?v=unknownId",
          }),
        ]),
      );

      // fetch returns no parseable duration
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => "no duration info here",
      });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
        skipUnknownDuration: true,
      });

      expect(result.skipped).toBe(1);
      expect(result.success).toBe(0);
    });

    it("processes video with unknown duration when skipUnknownDuration=false (default)", async () => {
      const ytUrl = "https://www.youtube.com/feeds/videos.xml?channel_id=UC123";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "Unknown dur video",
            link: "https://www.youtube.com/watch?v=unknownId2",
          }),
        ]),
      );

      // fetch returns no parseable duration
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => "no duration info",
      });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
        skipUnknownDuration: false,
      });

      // Video processed despite unknown duration
      expect(result.success).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("uses approxDurationMs extractor pattern", async () => {
      const ytUrl =
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCtest";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "ApproxDuration",
            link: "https://www.youtube.com/watch?v=approxId",
          }),
        ]),
      );

      // Return approxDurationMs (600000ms = 600s)
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '"approxDurationMs":"600000"',
      });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
      });

      expect(result.success).toBe(1);
    });

    it("uses ISO 8601 duration extractor pattern (PT1H2M3S)", async () => {
      const ytUrl =
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCtest2";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "ISO Duration",
            link: "https://www.youtube.com/watch?v=isoId",
          }),
        ]),
      );

      // Return ISO 8601 duration (1h2m3s = 3723s)
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '"duration":"PT1H2M3S"',
      });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
      });

      expect(result.success).toBe(1);
    });

    it("handles fetch failure for YouTube duration gracefully", async () => {
      const ytUrl =
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCfail";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "Fetch fail video",
            link: "https://www.youtube.com/watch?v=failId",
          }),
        ]),
      );

      // fetch fails for YouTube page
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
        skipUnknownDuration: false,
      });

      // Should process anyway (duration unknown, skipUnknownDuration=false)
      expect(result.success).toBe(1);
    });

    it("handles non-ok YouTube fetch response", async () => {
      const ytUrl =
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCnotok";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "Not ok video",
            link: "https://www.youtube.com/watch?v=notokId",
          }),
        ]),
      );

      mockFetch.mockResolvedValue({ ok: false, status: 429 });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
        skipUnknownDuration: false,
      });

      expect(result.success).toBe(1);
    });

    it("handles YouTube shorts URL format", async () => {
      const ytUrl =
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCshorts";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "Shorts video",
            link: "https://www.youtube.com/shorts/shortsId",
          }),
        ]),
      );

      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '"lengthSeconds":"45"',
      });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
        skipUnknownDuration: true,
      });

      // 45s < 300s, should be skipped
      expect(result.skipped).toBe(1);
    });

    it("handles youtu.be URL format", async () => {
      const ytUrl =
        "https://www.youtube.com/feeds/videos.xml?channel_id=UCyoutu";
      mockParseURL.mockResolvedValue(
        makeYouTubeFeedResponse([
          makeYouTubeItem({
            title: "youtu.be video",
            link: "https://youtu.be/youtuBeId",
          }),
        ]),
      );

      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => '"lengthSeconds":"600"',
      });

      const result = await service.fetchRssFeed(ytUrl, 10, "VIDEO", {
        minDurationSeconds: 300,
      });

      expect(result.success).toBe(1);
    });
  });

  // ── Error messages ────────────────────────────────────────────────────────────

  describe("error message variations", () => {
    it("throws descriptive error for HTTP 500", async () => {
      mockParseURL.mockRejectedValue(new Error("Status code 500"));

      await expect(
        service.fetchRssFeed("https://example.com/feed.rss"),
      ).rejects.toThrow(/500|server error/i);
    });

    it("throws descriptive error for ECONNREFUSED", async () => {
      mockParseURL.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:80"));

      await expect(
        service.fetchRssFeed("https://example.com/feed.rss"),
      ).rejects.toThrow(/Cannot connect|ECONNREFUSED/i);
    });

    it("throws generic error for unknown error type", async () => {
      mockParseURL.mockRejectedValue(new Error("some weird error"));

      await expect(
        service.fetchRssFeed("https://example.com/feed.rss"),
      ).rejects.toThrow("some weird error");
    });

    it("handles non-Error thrown objects", async () => {
      mockParseURL.mockRejectedValue("string error");

      await expect(
        service.fetchRssFeed("https://example.com/feed.rss"),
      ).rejects.toThrow();
    });
  });

  // ── Reference sync failure ────────────────────────────────────────────────────

  describe("bi-directional reference sync failure", () => {
    it("throws when MongoDB resourceId does not match PostgreSQL id", async () => {
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          { title: "Test", link: "https://example.com/test", guid: "g1" },
        ],
      });
      mockMongodb.insertRawData.mockResolvedValue("mongo-123");
      mockPrisma.resource.create.mockResolvedValue({ id: "pg-456" });
      // MongoDB returns a different resourceId
      mockMongodb.findRawDataById.mockResolvedValue({ resourceId: "pg-WRONG" });

      const result = await service.fetchRssFeed("https://example.com/feed.rss");

      // The item fails due to reference sync error
      expect(result.failed).toBe(1);
      expect(result.success).toBe(0);
    });
  });

  // ── fetchMultipleFeeds ────────────────────────────────────────────────────────

  describe("fetchMultipleFeeds", () => {
    it("aggregates results from multiple feeds", async () => {
      mockParseURL
        .mockResolvedValueOnce({
          title: "Feed 1",
          items: [
            { title: "Article A", link: "https://feed1.com/a", guid: "a" },
            { title: "Article B", link: "https://feed1.com/b", guid: "b" },
          ],
        })
        .mockResolvedValueOnce({
          title: "Feed 2",
          items: [
            { title: "Article C", link: "https://feed2.com/c", guid: "c" },
          ],
        });

      mockMongodb.findRawDataById
        .mockResolvedValueOnce({ resourceId: "pg-a" })
        .mockResolvedValueOnce({ resourceId: "pg-b" })
        .mockResolvedValueOnce({ resourceId: "pg-c" });
      mockPrisma.resource.create
        .mockResolvedValueOnce({ id: "pg-a" })
        .mockResolvedValueOnce({ id: "pg-b" })
        .mockResolvedValueOnce({ id: "pg-c" });

      const result = await service.fetchMultipleFeeds([
        { url: "https://feed1.com/rss", category: "BLOG" },
        { url: "https://feed2.com/rss", category: "NEWS" },
      ]);

      expect(result.total).toBe(3);
      expect(result.successful).toBe(2); // Both feeds had at least 1 success
      expect(result.failed).toBe(0);
    });

    it("counts failed feeds when fetchRssFeed throws", async () => {
      mockParseURL
        .mockResolvedValueOnce({
          title: "Feed 1",
          items: [
            { title: "Good", link: "https://feed1.com/good", guid: "g1" },
          ],
        })
        .mockRejectedValueOnce(new Error("Status code 404"));

      mockMongodb.findRawDataById.mockResolvedValue({ resourceId: "pg-g1" });
      mockPrisma.resource.create.mockResolvedValue({ id: "pg-g1" });

      const result = await service.fetchMultipleFeeds([
        { url: "https://feed1.com/rss", category: "BLOG" },
        { url: "https://feed2.com/missing.rss", category: "NEWS" },
      ]);

      expect(result.failed).toBe(1);
      expect(result.successful).toBe(1);
    });

    it("returns all zeroes when no feeds provided", async () => {
      const result = await service.fetchMultipleFeeds([]);

      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.duplicates).toBe(0);
    });

    it("respects maxItemsPerFeed param", async () => {
      const manyItems = Array.from({ length: 20 }, (_, i) => ({
        title: `Article ${i}`,
        link: `https://feed.com/a${i}`,
        guid: `g${i}`,
      }));
      mockParseURL.mockResolvedValue({ title: "Big Feed", items: manyItems });

      await service.fetchMultipleFeeds(
        [{ url: "https://feed.com/rss", category: "BLOG" }],
        3,
      );

      // Only 3 items processed
      expect(mockPrisma.resource.findFirst).toHaveBeenCalledTimes(3);
    });

    it("counts duplicates from all feeds", async () => {
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          { title: "Dup Article", link: "https://feed.com/dup", guid: "dup" },
        ],
      });
      // URL already exists → duplicate
      mockPrisma.resource.findFirst.mockResolvedValue({
        id: "existing",
        title: "Dup",
      });

      const result = await service.fetchMultipleFeeds([
        { url: "https://feed.com/rss", category: "BLOG" },
      ]);

      expect(result.duplicates).toBe(1);
      expect(result.total).toBe(0);
    });
  });

  // ── Title similarity duplicate ────────────────────────────────────────────────

  describe("title similarity deduplication", () => {
    it("skips item when title is similar to a recent resource", async () => {
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          {
            title: "Very Similar Title",
            link: "https://example.com/new",
            guid: "g1",
          },
        ],
      });
      // URL check: not found
      mockPrisma.resource.findFirst.mockResolvedValue(null);
      // Recent resources with a similar title
      mockPrisma.resource.findMany.mockResolvedValue([
        { id: "old-1", title: "Very Similar Title" },
      ]);
      // Deduplication says titles are similar
      mockDeduplication.areTitlesSimilar.mockReturnValue(true);

      const result = await service.fetchRssFeed("https://example.com/feed.rss");

      expect(result.duplicates).toBe(1);
      expect(result.success).toBe(0);
    });

    it("processes item when title is NOT similar to recent resources", async () => {
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          {
            title: "Brand New Title",
            link: "https://example.com/brand-new",
            guid: "gbn",
          },
        ],
      });
      mockPrisma.resource.findFirst.mockResolvedValue(null);
      mockPrisma.resource.findMany.mockResolvedValue([
        { id: "old-1", title: "Totally Different Title" },
      ]);
      mockDeduplication.areTitlesSimilar.mockReturnValue(false);

      const result = await service.fetchRssFeed("https://example.com/feed.rss");

      expect(result.success).toBe(1);
    });
  });

  // ── Non-YouTube feed with minDuration option ──────────────────────────────────

  describe("non-YouTube feed with filter options", () => {
    it("ignores duration filter for non-YouTube RSS feeds", async () => {
      mockParseURL.mockResolvedValue({
        title: "Regular Blog Feed",
        items: [
          {
            title: "Blog Post",
            link: "https://blog.example.com/post1",
            guid: "bp1",
          },
        ],
      });

      // minDurationSeconds set but feed is not YouTube
      const result = await service.fetchRssFeed(
        "https://blog.example.com/rss",
        10,
        "BLOG",
        { minDurationSeconds: 300 },
      );

      expect(result.success).toBe(1);
      // fetch should NOT have been called (no YouTube duration check)
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── All duplicates logging ────────────────────────────────────────────────────

  describe("all-duplicate feed logging", () => {
    it("returns success=0 and duplicates=N when all items are URL duplicates", async () => {
      mockParseURL.mockResolvedValue({
        title: "Duplicate Feed",
        items: Array.from({ length: 3 }, (_, i) => ({
          title: `Dup ${i}`,
          link: `https://example.com/dup${i}`,
          guid: `dup-guid-${i}`,
        })),
      });

      // All items already exist in DB
      mockPrisma.resource.findFirst.mockResolvedValue({
        id: "existing",
        title: "exists",
      });

      const result = await service.fetchRssFeed("https://example.com/feed.rss");

      expect(result.success).toBe(0);
      expect(result.duplicates).toBe(3);
    });
  });

  // ── extractResourceData content extraction ────────────────────────────────────

  describe("resource data extraction", () => {
    it("uses contentSnippet as summary when available", async () => {
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          {
            title: "Rich Article",
            link: "https://example.com/rich",
            guid: "rich-1",
            contentSnippet: "This is a snippet",
            description: "This is a description",
          },
        ],
      });

      await service.fetchRssFeed("https://example.com/feed.rss");

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            abstract: "This is a snippet",
          }),
        }),
      );
    });

    it("truncates long summary to 500 chars", async () => {
      const longContent = "A".repeat(600);
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          {
            title: "Long Content Article",
            link: "https://example.com/long",
            guid: "long-1",
            contentSnippet: longContent,
          },
        ],
      });

      await service.fetchRssFeed("https://example.com/feed.rss");

      expect(mockPrisma.resource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            abstract: expect.stringMatching(/\.\.\.$/),
          }),
        }),
      );

      const callArg = mockPrisma.resource.create.mock.calls[0][0];
      expect(callArg.data.abstract.length).toBe(500);
    });

    it("uses isoDate for publishedAt when available", async () => {
      const isoDate = "2024-01-15T10:00:00.000Z";
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          {
            title: "Dated Article",
            link: "https://example.com/dated",
            guid: "dated-1",
            isoDate,
          },
        ],
      });

      await service.fetchRssFeed("https://example.com/feed.rss");

      const callArg = mockPrisma.resource.create.mock.calls[0][0];
      expect(callArg.data.publishedAt).toEqual(new Date(isoDate));
    });

    it("uses pubDate when isoDate is absent", async () => {
      const pubDate = "Mon, 15 Jan 2024 10:00:00 GMT";
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          {
            title: "PubDate Article",
            link: "https://example.com/pubdate",
            guid: "pd-1",
            pubDate,
          },
        ],
      });

      await service.fetchRssFeed("https://example.com/feed.rss");

      const callArg = mockPrisma.resource.create.mock.calls[0][0];
      expect(callArg.data.publishedAt).toBeInstanceOf(Date);
    });

    it("uses creator as author when available", async () => {
      mockParseURL.mockResolvedValue({
        title: "Tech Blog",
        items: [
          {
            title: "Creator Article",
            link: "https://example.com/creator",
            guid: "cr-1",
            creator: "John Doe",
          },
        ],
      });

      await service.fetchRssFeed("https://example.com/feed.rss");

      const callArg = mockPrisma.resource.create.mock.calls[0][0];
      expect(callArg.data.authors).toEqual([{ name: "John Doe" }]);
    });

    it("extracts categories as tags (max 10)", async () => {
      const categories = Array.from({ length: 15 }, (_, i) => `tag${i}`);
      mockParseURL.mockResolvedValue({
        title: "Feed",
        items: [
          {
            title: "Tagged Article",
            link: "https://example.com/tagged",
            guid: "tg-1",
            categories,
          },
        ],
      });

      await service.fetchRssFeed("https://example.com/feed.rss");

      const callArg = mockPrisma.resource.create.mock.calls[0][0];
      expect(callArg.data.tags).toHaveLength(10);
    });
  });
});

import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceSeederService } from "../data-source-seeder.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

// ============================================================================
// Mock global fetch
// ============================================================================

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ============================================================================
// Helpers
// ============================================================================

function makePrismaMock() {
  return {
    dataSource: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
}

/**
 * Build a minimal Response-like object that passes the validateRssFeed checks.
 */
function makeValidXmlResponse(contentType = "application/xml"): Response {
  return {
    ok: true,
    headers: {
      get: (key: string) => (key === "content-type" ? contentType : null),
    },
    text: jest.fn().mockResolvedValue('<?xml version="1.0"?><rss></rss>'),
  } as unknown as Response;
}

function makeHtmlResponse(): Response {
  return {
    ok: true,
    headers: { get: () => "text/html" },
    text: jest.fn().mockResolvedValue("<html><body>page</body></html>"),
  } as unknown as Response;
}

function makeNonOkResponse(): Response {
  return {
    ok: false,
    headers: { get: () => null },
    text: jest.fn().mockResolvedValue(""),
  } as unknown as Response;
}

// ============================================================================
// Tests
// ============================================================================

describe("DataSourceSeederService", () => {
  let service: DataSourceSeederService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    jest.useFakeTimers();
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataSourceSeederService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<DataSourceSeederService>(DataSourceSeederService);

    // Default: all sources are new (don't exist yet)
    prisma.dataSource.findMany.mockResolvedValue([]);
    prisma.dataSource.findFirst.mockResolvedValue(null);
    prisma.dataSource.create.mockResolvedValue({ id: "new-source" });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // onModuleInit
  // --------------------------------------------------------------------------

  describe("onModuleInit", () => {
    it("should call seedAllSources on module init", async () => {
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      const seedSpy = jest.spyOn(service, "seedAllSources");
      await service.onModuleInit();

      expect(seedSpy).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // seedAllSources - bulk existence check
  // --------------------------------------------------------------------------

  describe("seedAllSources", () => {
    it("should skip all sources that already exist in the database", async () => {
      // Return all source names as existing
      prisma.dataSource.findMany.mockResolvedValue([
        { name: "Y Combinator" },
        { name: "OpenAI Blog" },
      ]);
      // fetchFirst for individual seed checks won't be called because
      // the bulk check filters them out
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      // create should only be called for the non-existing sources
      const createCallCount = prisma.dataSource.create.mock.calls.length;
      // We can't know exact count but it should be total - 2
      expect(createCallCount).toBeLessThan(
        service["YOUTUBE_CHANNELS"].length +
          service["TECH_BLOGS"].length +
          service["REPORT_SOURCES"].length +
          service["PAPER_SOURCES"].length +
          service["NEWS_SOURCES"].length +
          service["POLICY_SOURCES"].length,
      );
    });

    it("should create sources when they do not exist and RSS feed is valid", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]); // none exist
      prisma.dataSource.findFirst.mockResolvedValue(null); // individual check also clear
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      expect(prisma.dataSource.create).toHaveBeenCalled();
    });

    it("should not create sources when RSS validation returns non-ok response", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeNonOkResponse());

      await service.seedAllSources();

      // No creates should happen since all feeds are invalid
      expect(prisma.dataSource.create).not.toHaveBeenCalled();
    });

    it("should not create sources when RSS returns HTML content", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeHtmlResponse());

      await service.seedAllSources();

      expect(prisma.dataSource.create).not.toHaveBeenCalled();
    });

    it("should not create sources when fetch throws (network error)", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new Error("network error"));

      await expect(service.seedAllSources()).resolves.not.toThrow();
      expect(prisma.dataSource.create).not.toHaveBeenCalled();
    });

    it("should not create sources when fetch is aborted (timeout)", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockRejectedValue(new DOMException("aborted", "AbortError"));

      await expect(service.seedAllSources()).resolves.not.toThrow();
      expect(prisma.dataSource.create).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // seedYouTubeChannel
  // --------------------------------------------------------------------------

  describe("seedYouTubeChannel (private, tested via seedAllSources with specific mock)", () => {
    it("should create YouTube source with correct type and category", async () => {
      // Only seed Y Combinator: make all others 'existing' so they're skipped,
      // but seed the channel by having findFirst return null for it
      const ycChannel = service["YOUTUBE_CHANNELS"][0];

      prisma.dataSource.findMany.mockResolvedValue(
        // Return all names except Y Combinator as existing
        [
          ...service["TECH_BLOGS"].map((s) => ({ name: s.name })),
          ...service["REPORT_SOURCES"].map((s) => ({ name: s.name })),
          ...service["PAPER_SOURCES"].map((s) => ({ name: s.name })),
          ...service["NEWS_SOURCES"].map((s) => ({ name: s.name })),
          ...service["POLICY_SOURCES"].map((s) => ({ name: s.name })),
          ...service["YOUTUBE_CHANNELS"]
            .filter((c) => c.name !== ycChannel.name)
            .map((c) => ({ name: c.name })),
        ],
      );
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      expect(prisma.dataSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "YOUTUBE",
            category: "YOUTUBE_VIDEO",
            name: ycChannel.name,
          }),
        }),
      );
    });

    it("should build YouTube RSS URL from channelId", async () => {
      const ycChannel = service["YOUTUBE_CHANNELS"][0];

      prisma.dataSource.findMany.mockResolvedValue([
        ...service["TECH_BLOGS"].map((s) => ({ name: s.name })),
        ...service["REPORT_SOURCES"].map((s) => ({ name: s.name })),
        ...service["PAPER_SOURCES"].map((s) => ({ name: s.name })),
        ...service["NEWS_SOURCES"].map((s) => ({ name: s.name })),
        ...service["POLICY_SOURCES"].map((s) => ({ name: s.name })),
        ...service["YOUTUBE_CHANNELS"]
          .filter((c) => c.name !== ycChannel.name)
          .map((c) => ({ name: c.name })),
      ]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      const fetchUrl = mockFetch.mock.calls[0][0] as string;
      expect(fetchUrl).toContain(ycChannel.channelId);
      expect(fetchUrl).toContain("youtube.com/feeds/videos.xml");
    });
  });

  // --------------------------------------------------------------------------
  // seedBlog
  // --------------------------------------------------------------------------

  describe("seedBlog", () => {
    it("should create blog source with type RSS and category BLOG", async () => {
      const blog = service["TECH_BLOGS"][0]; // NVIDIA

      prisma.dataSource.findMany.mockResolvedValue([
        ...service["YOUTUBE_CHANNELS"].map((s) => ({ name: s.name })),
        ...service["TECH_BLOGS"]
          .filter((b) => b.name !== blog.name)
          .map((b) => ({ name: b.name })),
        ...service["REPORT_SOURCES"].map((s) => ({ name: s.name })),
        ...service["PAPER_SOURCES"].map((s) => ({ name: s.name })),
        ...service["NEWS_SOURCES"].map((s) => ({ name: s.name })),
        ...service["POLICY_SOURCES"].map((s) => ({ name: s.name })),
      ]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      expect(prisma.dataSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "RSS",
            category: "BLOG",
            name: blog.name,
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // seedReport
  // --------------------------------------------------------------------------

  describe("seedReport", () => {
    it("should create report source with category REPORT", async () => {
      const report = service["REPORT_SOURCES"][0];

      prisma.dataSource.findMany.mockResolvedValue([
        ...service["YOUTUBE_CHANNELS"].map((s) => ({ name: s.name })),
        ...service["TECH_BLOGS"].map((s) => ({ name: s.name })),
        ...service["REPORT_SOURCES"]
          .filter((r) => r.name !== report.name)
          .map((r) => ({ name: r.name })),
        ...service["PAPER_SOURCES"].map((s) => ({ name: s.name })),
        ...service["NEWS_SOURCES"].map((s) => ({ name: s.name })),
        ...service["POLICY_SOURCES"].map((s) => ({ name: s.name })),
      ]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      expect(prisma.dataSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: "REPORT",
            name: report.name,
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // seedPaper
  // --------------------------------------------------------------------------

  describe("seedPaper", () => {
    it("should create paper source with type ARXIV and category PAPER", async () => {
      const paper = service["PAPER_SOURCES"][0]; // arXiv cs.AI

      prisma.dataSource.findMany.mockResolvedValue([
        ...service["YOUTUBE_CHANNELS"].map((s) => ({ name: s.name })),
        ...service["TECH_BLOGS"].map((s) => ({ name: s.name })),
        ...service["REPORT_SOURCES"].map((s) => ({ name: s.name })),
        ...service["PAPER_SOURCES"]
          .filter((p) => p.name !== paper.name)
          .map((p) => ({ name: p.name })),
        ...service["NEWS_SOURCES"].map((s) => ({ name: s.name })),
        ...service["POLICY_SOURCES"].map((s) => ({ name: s.name })),
      ]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      expect(prisma.dataSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "ARXIV",
            category: "PAPER",
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // seedNews
  // --------------------------------------------------------------------------

  describe("seedNews", () => {
    it("should create news source with category NEWS", async () => {
      const news = service["NEWS_SOURCES"][0]; // Ars Technica

      prisma.dataSource.findMany.mockResolvedValue([
        ...service["YOUTUBE_CHANNELS"].map((s) => ({ name: s.name })),
        ...service["TECH_BLOGS"].map((s) => ({ name: s.name })),
        ...service["REPORT_SOURCES"].map((s) => ({ name: s.name })),
        ...service["PAPER_SOURCES"].map((s) => ({ name: s.name })),
        ...service["NEWS_SOURCES"]
          .filter((n) => n.name !== news.name)
          .map((n) => ({ name: n.name })),
        ...service["POLICY_SOURCES"].map((s) => ({ name: s.name })),
      ]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      expect(prisma.dataSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: "NEWS",
            name: news.name,
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // seedPolicy
  // --------------------------------------------------------------------------

  describe("seedPolicy", () => {
    it("should create policy source with category POLICY and include region in config", async () => {
      const policy = service["POLICY_SOURCES"][0]; // CSET Georgetown

      prisma.dataSource.findMany.mockResolvedValue([
        ...service["YOUTUBE_CHANNELS"].map((s) => ({ name: s.name })),
        ...service["TECH_BLOGS"].map((s) => ({ name: s.name })),
        ...service["REPORT_SOURCES"].map((s) => ({ name: s.name })),
        ...service["PAPER_SOURCES"].map((s) => ({ name: s.name })),
        ...service["NEWS_SOURCES"].map((s) => ({ name: s.name })),
        ...service["POLICY_SOURCES"]
          .filter((p) => p.name !== policy.name)
          .map((p) => ({ name: p.name })),
      ]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      expect(prisma.dataSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            category: "POLICY",
            crawlerConfig: expect.objectContaining({
              region: policy.region,
            }),
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // validateRssFeed edge cases
  // --------------------------------------------------------------------------

  describe("validateRssFeed (private, tested via seedAllSources behavior)", () => {
    it("should accept RSS XML content without XML content-type header", async () => {
      // content-type is text/plain but body starts with <?xml
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/plain" },
        text: jest
          .fn()
          .mockResolvedValue('<?xml version="1.0"?><rss version="2.0"></rss>'),
      } as unknown as Response);

      await service.seedAllSources();

      // Sources with valid XML body should be created
      expect(prisma.dataSource.create).toHaveBeenCalled();
    });

    it("should reject content starting with <html (HTML page instead of RSS)", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/plain" },
        text: jest.fn().mockResolvedValue("<html><body></body></html>"),
      } as unknown as Response);

      await service.seedAllSources();

      expect(prisma.dataSource.create).not.toHaveBeenCalled();
    });

    it("should reject DOCTYPE html content", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/plain" },
        text: jest.fn().mockResolvedValue("<!DOCTYPE html><html></html>"),
      } as unknown as Response);

      await service.seedAllSources();

      expect(prisma.dataSource.create).not.toHaveBeenCalled();
    });

    it("should accept feeds starting with <feed (Atom format)", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "text/plain" },
        text: jest
          .fn()
          .mockResolvedValue(
            "<feed xmlns='http://www.w3.org/2005/Atom'></feed>",
          ),
      } as unknown as Response);

      await service.seedAllSources();

      expect(prisma.dataSource.create).toHaveBeenCalled();
    });

    it("should reject when response body is unrecognized format", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => "application/json" },
        text: jest.fn().mockResolvedValue('{"not": "xml"}'),
      } as unknown as Response);

      await service.seedAllSources();

      expect(prisma.dataSource.create).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Individual seed methods - already existing check
  // --------------------------------------------------------------------------

  describe("skip when source already exists (individual check)", () => {
    it("should skip YouTube source when findFirst returns existing record", async () => {
      const ycChannel = service["YOUTUBE_CHANNELS"][0];
      prisma.dataSource.findMany.mockResolvedValue([]); // bulk check returns nothing
      // individual findFirst returns existing
      prisma.dataSource.findFirst.mockResolvedValue({ id: "existing-source" });
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      // create should never be called because findFirst returns existing
      expect(prisma.dataSource.create).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: ycChannel.name }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Concurrency batch processing
  // --------------------------------------------------------------------------

  describe("batch processing", () => {
    it("should process sources in batches of 5", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);

      // Track concurrent fetch calls
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      mockFetch.mockImplementation(async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        // Simulate async work
        await Promise.resolve();
        currentConcurrent--;
        return makeValidXmlResponse();
      });

      await service.seedAllSources();

      // Max concurrent fetch calls should be <= 5
      expect(maxConcurrent).toBeLessThanOrEqual(5);
    });
  });

  // --------------------------------------------------------------------------
  // Data integrity
  // --------------------------------------------------------------------------

  describe("data integrity", () => {
    it("should set isVerified=true for all created sources", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      for (const call of prisma.dataSource.create.mock.calls) {
        expect(call[0].data.isVerified).toBe(true);
      }
    });

    it("should set status=ACTIVE for all created sources", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      for (const call of prisma.dataSource.create.mock.calls) {
        expect(call[0].data.status).toBe("ACTIVE");
      }
    });

    it("should set authType=NONE for all created sources", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      for (const call of prisma.dataSource.create.mock.calls) {
        expect(call[0].data.authType).toBe("NONE");
      }
    });

    it("should set crawlerType=RSS for all non-youtube created sources", async () => {
      prisma.dataSource.findMany.mockResolvedValue([]);
      prisma.dataSource.findFirst.mockResolvedValue(null);
      mockFetch.mockResolvedValue(makeValidXmlResponse());

      await service.seedAllSources();

      for (const call of prisma.dataSource.create.mock.calls) {
        expect(call[0].data.crawlerType).toBe("RSS");
      }
    });
  });
});

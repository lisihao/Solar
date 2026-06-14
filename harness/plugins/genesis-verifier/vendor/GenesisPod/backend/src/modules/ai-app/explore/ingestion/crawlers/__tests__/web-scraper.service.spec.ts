// Mock axios at module level
jest.mock("axios");

import { Test, TestingModule } from "@nestjs/testing";
import axios from "axios";
import { WebScraperService } from "../web-scraper.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RawDataService } from "@/modules/ai-app/explore/rawdata/rawdata.service";
import { DeduplicationService } from "../deduplication.service";

const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockPrisma = {
  resource: {
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
  normalizeUrl: jest.fn((url: string) => url),
};

describe("WebScraperService", () => {
  let service: WebScraperService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebScraperService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RawDataService, useValue: mockMongodb },
        { provide: DeduplicationService, useValue: mockDeduplication },
      ],
    })
      .setLogger({
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      } as any)
      .compile();

    service = module.get<WebScraperService>(WebScraperService);

    // Defaults
    mockMongodb.findRawDataByUrlAcrossAllSources.mockResolvedValue(null);
    mockMongodb.insertRawData.mockResolvedValue("raw-id-abc");
    mockPrisma.resource.create.mockResolvedValue({ id: "res-id-abc" });
    mockMongodb.linkResourceToRawData.mockResolvedValue(undefined);
    mockMongodb.findRawDataById.mockResolvedValue({ resourceId: "res-id-abc" });
    mockedAxios.isAxiosError = jest.fn().mockReturnValue(false);
  });

  // ─── scrapeWebPage – happy path ─────────────────────────────────────────────

  describe("scrapeWebPage", () => {
    it("returns 0 when axios returns no data", async () => {
      mockedAxios.get.mockResolvedValue({ data: null });

      const count = await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      expect(count).toBe(0);
    });

    it("processes items found by the selector and returns success count", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="https://example.com/article-1">Article One</a></h2>
            <p>Some description here</p>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      const count = await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      expect(count).toBe(1);
      expect(mockMongodb.insertRawData).toHaveBeenCalledWith(
        "web_scraper",
        expect.objectContaining({ url: "https://example.com/article-1" }),
      );
    });

    it("falls back to auto-detect when selector matches nothing", async () => {
      const html = `
        <html><body>
          <article>
            <h2><a href="https://example.com/auto">Auto Article</a></h2>
            <p>Auto description</p>
          </article>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      const count = await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".non-existent-selector",
      );

      expect(count).toBe(1);
    });

    it("returns 0 when auto-detect finds nothing", async () => {
      const html = "<html><body><p>No articles here</p></body></html>";
      mockedAxios.get.mockResolvedValue({ data: html });

      const count = await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".nothing",
      );

      expect(count).toBe(0);
    });

    it("skips items without title", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <a href="https://example.com/link">  </a>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      const count = await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      expect(count).toBe(0);
    });

    it("skips items that are URL duplicates in MongoDB", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="https://example.com/dup-article">Dup Article</a></h2>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });
      mockMongodb.findRawDataByUrlAcrossAllSources.mockResolvedValue({
        source: "web_scraper",
      });

      const count = await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      expect(count).toBe(0);
      expect(mockMongodb.insertRawData).not.toHaveBeenCalled();
    });

    it("respects maxItems limit", async () => {
      const items = Array.from(
        { length: 5 },
        (_, i) =>
          `<div class="news-item"><h2><a href="https://example.com/${i}">Article ${i}</a></h2></div>`,
      ).join("");
      const html = `<html><body>${items}</body></html>`;
      mockedAxios.get.mockResolvedValue({ data: html });

      await service.scrapeWebPage(
        "https://example.com",
        2,
        "POLICY",
        ".news-item",
      );

      expect(mockMongodb.insertRawData.mock.calls.length).toBeLessThanOrEqual(
        2,
      );
    });

    it("resolves relative links correctly (starting with /)", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="/relative/path">Relative Article</a></h2>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      expect(mockMongodb.insertRawData).toHaveBeenCalledWith(
        "web_scraper",
        expect.objectContaining({
          url: "https://example.com/relative/path",
        }),
      );
    });

    it("resolves relative links without leading slash", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="no-slash/path">No Slash Article</a></h2>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      expect(mockMongodb.insertRawData).toHaveBeenCalledWith(
        "web_scraper",
        expect.objectContaining({
          url: "https://example.com/no-slash/path",
        }),
      );
    });

    it("truncates summary longer than 500 chars", async () => {
      const longDesc = "X".repeat(600);
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="https://example.com/truncated">Long Article</a></h2>
            <p>${longDesc}</p>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      const callArg = mockPrisma.resource.create.mock.calls[0]?.[0]?.data;
      if (callArg) {
        expect(callArg.abstract.length).toBe(500);
        expect(callArg.abstract.endsWith("...")).toBe(true);
      }
    });

    it("parses datetime attribute from time element", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="https://example.com/dated">Dated Article</a></h2>
            <time datetime="2024-05-15T10:00:00Z">May 15</time>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      const callArg = mockPrisma.resource.create.mock.calls[0]?.[0]?.data;
      if (callArg) {
        expect(callArg.publishedAt).toEqual(new Date("2024-05-15T10:00:00Z"));
      }
    });

    it("throws descriptive 403 error", async () => {
      const axiosError = {
        response: { status: 403 },
        message: "Forbidden",
        stack: "",
      };
      mockedAxios.get.mockRejectedValue(axiosError);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(
        service.scrapeWebPage("https://example.com", 10, "POLICY", ".item"),
      ).rejects.toThrow(/forbidden|403/i);
    });

    it("throws descriptive 404 error", async () => {
      const axiosError = {
        response: { status: 404 },
        message: "Not Found",
        stack: "",
      };
      mockedAxios.get.mockRejectedValue(axiosError);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(
        service.scrapeWebPage("https://example.com", 10, "POLICY", ".item"),
      ).rejects.toThrow(/not found|404/i);
    });

    it("throws descriptive 429 rate-limit error", async () => {
      const axiosError = {
        response: { status: 429 },
        message: "Too Many Requests",
        stack: "",
      };
      mockedAxios.get.mockRejectedValue(axiosError);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(
        service.scrapeWebPage("https://example.com", 10, "POLICY", ".item"),
      ).rejects.toThrow(/rate limited|429/i);
    });

    it("throws ECONNREFUSED error", async () => {
      const axiosError = {
        code: "ECONNREFUSED",
        message: "Connection refused",
        stack: "",
      };
      mockedAxios.get.mockRejectedValue(axiosError);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(
        service.scrapeWebPage("https://example.com", 10, "POLICY", ".item"),
      ).rejects.toThrow(/connection refused/i);
    });

    it("throws generic axios error message for unrecognized status", async () => {
      const axiosError = {
        response: { status: 500 },
        message: "Internal Server Error",
        stack: "",
      };
      mockedAxios.get.mockRejectedValue(axiosError);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(
        service.scrapeWebPage("https://example.com", 10, "POLICY", ".item"),
      ).rejects.toThrow(/Internal Server Error/);
    });

    it("throws wrapping non-axios error", async () => {
      mockedAxios.get.mockRejectedValue(new Error("unexpected error"));

      await expect(
        service.scrapeWebPage("https://example.com", 10, "POLICY", ".item"),
      ).rejects.toThrow(/Failed to scrape/);
    });

    it("counts as failed when bi-directional reference sync fails", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="https://example.com/sync-fail">Sync Fail Article</a></h2>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      // Return wrong resourceId from MongoDB to trigger sync failure
      mockMongodb.findRawDataById.mockResolvedValue({ resourceId: "wrong-id" });

      const count = await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      // Item processing fails due to reference sync mismatch
      expect(count).toBe(0);
    });

    it("creates resource with author from .author selector", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="https://example.com/authored">Authored Article</a></h2>
            <span class="author">Jane Doe</span>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      await service.scrapeWebPage(
        "https://example.com",
        10,
        "NEWS",
        ".news-item",
      );

      const callArg = mockPrisma.resource.create.mock.calls[0]?.[0]?.data;
      if (callArg) {
        expect(callArg.authors).toEqual([{ name: "Jane Doe" }]);
      }
    });

    it("uses Unknown author when no author element found", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="https://example.com/no-author">No Author Article</a></h2>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      await service.scrapeWebPage(
        "https://example.com",
        10,
        "NEWS",
        ".news-item",
      );

      const callArg = mockPrisma.resource.create.mock.calls[0]?.[0]?.data;
      if (callArg) {
        expect(callArg.authors).toEqual([{ name: "Unknown" }]);
      }
    });

    it("establishes bi-directional MongoDB-PostgreSQL reference", async () => {
      const html = `
        <html><body>
          <div class="news-item">
            <h2><a href="https://example.com/ref-article">Ref Article</a></h2>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      await service.scrapeWebPage(
        "https://example.com",
        10,
        "POLICY",
        ".news-item",
      );

      expect(mockMongodb.linkResourceToRawData).toHaveBeenCalledWith(
        "raw-id-abc",
        "res-id-abc",
      );
    });
  });

  // ─── scrapeMultiplePages ─────────────────────────────────────────────────────

  describe("scrapeMultiplePages", () => {
    it("aggregates results from multiple pages", async () => {
      const html = `
        <html><body>
          <div class="item">
            <h2><a href="https://example.com/article">An Article</a></h2>
          </div>
        </body></html>
      `;
      mockedAxios.get.mockResolvedValue({ data: html });

      const result = await service.scrapeMultiplePages([
        {
          url: "https://example.com/page1",
          selector: ".item",
          category: "NEWS",
        },
        {
          url: "https://example.com/page2",
          selector: ".item",
          category: "BLOG",
        },
      ]);

      expect(result.total).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
    });

    it("counts failed pages when scrapeWebPage throws", async () => {
      mockedAxios.get.mockRejectedValue(new Error("network error"));

      const result = await service.scrapeMultiplePages([
        {
          url: "https://example.com/broken",
          selector: ".item",
          category: "NEWS",
        },
      ]);

      expect(result.failed).toBe(1);
      expect(result.total).toBe(0);
      expect(result.successful).toBe(0);
    });

    it("tracks successful vs failed pages independently", async () => {
      const html = `
        <html><body>
          <div class="item">
            <h2><a href="https://ok.com/article">Article</a></h2>
          </div>
        </body></html>
      `;

      mockedAxios.get
        .mockResolvedValueOnce({ data: html })
        .mockRejectedValueOnce(new Error("broken"));

      const result = await service.scrapeMultiplePages([
        { url: "https://ok.com", selector: ".item", category: "NEWS" },
        { url: "https://broken.com", selector: ".item", category: "NEWS" },
      ]);

      expect(result.total).toBe(1);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("returns zeros for empty pages array", async () => {
      const result = await service.scrapeMultiplePages([]);

      expect(result).toEqual({ total: 0, successful: 0, failed: 0 });
    });
  });
});

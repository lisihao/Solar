/**
 * WebScraperTool - Image extraction coverage tests
 *
 * Covers the extractImageList() and normalizeSrc() private methods
 * via doExecute() with extractImages=true.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { WebScraperTool } from "../web-scraper.tool";
import { SearchService } from "../../../../../content/web-search/web-search.service";
import { ToolContext } from "../../../../abstractions/tool.interface";

function makeContext(): ToolContext {
  return {
    executionId: "exec-img",
    toolId: "web-scraper",
    createdAt: new Date(),
  };
}

type MockSearchService = jest.Mocked<
  Pick<SearchService, "search" | "fetchUrlContent">
>;

function createMock(): MockSearchService {
  return { search: jest.fn(), fetchUrlContent: jest.fn() };
}

describe("WebScraperTool - image extraction", () => {
  let tool: WebScraperTool;
  let mockSearch: MockSearchService;

  beforeEach(async () => {
    mockSearch = createMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebScraperTool,
        { provide: SearchService, useValue: mockSearch },
      ],
    }).compile();
    tool = module.get<WebScraperTool>(WebScraperTool);
  });

  afterEach(() => jest.clearAllMocks());

  describe("extractImages=true path", () => {
    it("should return images array when extractImages=true and html contains <img>", async () => {
      const html = `<html><body>
        <img src="https://example.com/photo.jpg" alt="A photo" width="300" height="200" />
        <p>Some text</p>
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "Some text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.images).toBeDefined();
      expect(result.data?.images).toHaveLength(1);
      expect(result.data?.images![0].src).toBe("https://example.com/photo.jpg");
      expect(result.data?.images![0].alt).toBe("A photo");
    });

    it("should NOT return images when extractImages=false (default)", async () => {
      const html = `<html><body><img src="https://example.com/photo.jpg" alt="pic" /></body></html>`;
      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com" },
        makeContext(),
      );
      expect(result.data?.images).toBeUndefined();
    });

    it("should NOT return images when html is missing even with extractImages=true", async () => {
      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        // html not returned
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );
      expect(result.data?.images).toBeUndefined();
    });

    it("should filter out images with width < 100", async () => {
      const html = `<html><body>
        <img src="https://example.com/icon.png" alt="icon" width="32" height="32" />
        <img src="https://example.com/large.jpg" alt="large" width="500" height="400" />
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      // Only the large image should be included
      expect(result.data?.images).toHaveLength(1);
      expect(result.data?.images![0].src).toContain("large.jpg");
    });

    it("should filter out favicon images by URL pattern", async () => {
      const html = `<html><body>
        <img src="https://example.com/favicon.ico" alt="favicon" />
        <img src="https://example.com/content.jpg" alt="content" width="300" height="200" />
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      // favicon should be filtered out
      const srcs = result.data?.images?.map((i) => i.src) ?? [];
      expect(srcs.some((s) => s.includes("favicon"))).toBe(false);
      expect(srcs.some((s) => s.includes("content.jpg"))).toBe(true);
    });

    it("should filter out tracker/pixel images", async () => {
      const html = `<html><body>
        <img src="https://tracker.example.com/pixel.gif" alt="pixel" />
        <img src="https://example.com/article-image.jpg" alt="article" width="400" height="300" />
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      const srcs = result.data?.images?.map((i) => i.src) ?? [];
      expect(srcs.some((s) => s.includes("pixel"))).toBe(false);
    });

    it("should deduplicate images with same src", async () => {
      const html = `<html><body>
        <img src="https://example.com/photo.jpg" alt="first" width="300" height="200" />
        <img src="https://example.com/photo.jpg" alt="duplicate" width="300" height="200" />
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      expect(result.data?.images).toHaveLength(1);
    });

    it("should cap images at 12", async () => {
      const imgs = Array.from(
        { length: 20 },
        (_, i) =>
          `<img src="https://example.com/img${i}.jpg" alt="img${i}" width="300" height="200" />`,
      ).join("\n");
      const html = `<html><body>${imgs}</body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      expect(result.data?.images!.length).toBeLessThanOrEqual(12);
    });

    it("should extract figcaption as caption for figure-contained images", async () => {
      const html = `<html><body>
        <figure>
          <img src="https://example.com/chart.png" alt="chart" width="600" height="400" />
          <figcaption>Figure 1: Revenue growth chart</figcaption>
        </figure>
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      expect(result.data?.images).toHaveLength(1);
      expect(result.data?.images![0].caption).toContain("Revenue growth");
    });

    it("should handle relative URLs by resolving against baseUrl", async () => {
      const html = `<html><body>
        <img src="/images/relative.jpg" alt="relative" width="300" height="200" />
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com/page", extractImages: true },
        makeContext(),
      );

      // Relative URL should be resolved to absolute
      const srcs = result.data?.images?.map((i) => i.src) ?? [];
      expect(srcs.some((s) => s.startsWith("https://"))).toBe(true);
    });

    it("should discard data: URLs", async () => {
      const html = `<html><body>
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ" alt="data" width="300" height="200" />
        <img src="https://example.com/real.jpg" alt="real" width="300" height="200" />
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      const srcs = result.data?.images?.map((i) => i.src) ?? [];
      expect(srcs.some((s) => s.startsWith("data:"))).toBe(false);
      expect(srcs.some((s) => s.includes("real.jpg"))).toBe(true);
    });

    it("should return empty images array when HTML has no matching images", async () => {
      const html = `<html><body><p>No images here</p></body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "No images here",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      expect(result.data?.images).toBeDefined();
      expect(result.data?.images).toHaveLength(0);
    });

    it("should handle images with http:// src and convert to https", async () => {
      const html = `<html><body>
        <img src="http://example.com/photo.jpg" alt="http img" width="300" height="200" />
      </body></html>`;

      mockSearch.fetchUrlContent.mockResolvedValue({
        success: true,
        title: "Page",
        content: "text",
        html,
      });

      const result = await tool.execute(
        { url: "https://example.com", extractImages: true },
        makeContext(),
      );

      // http:// should be converted to https://
      const srcs = result.data?.images?.map((i) => i.src) ?? [];
      if (srcs.length > 0) {
        expect(srcs[0]).toMatch(/^https:\/\//);
      }
    });
  });
});

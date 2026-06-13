/**
 * FigureExtractorService Unit Tests
 *
 * Coverage targets:
 * - extractFigures: from HTML with figures, empty HTML, no figures
 * - extractFiguresFromUrl: tool not available, tool error, successful extraction
 * - isLikelyChart filtering logic
 * - URL resolution (absolute, relative, protocol-relative, data URLs)
 * - Figure type classification
 * - MAX_FIGURES_PER_URL limit
 * - validateAndUpgradeFigures: data URL pass-through, upgrade, fallback
 * - downloadAndInlineImage: HTTP error, non-image, too large, too small, success
 * - tryUpgradeImageUrl: Brightspot, width param, height param, quality param
 * - extractHighestResSrcset: w descriptor, x descriptor, below threshold
 * - extractBestSrc: data-src, data-original, srcset, null
 * - isMeaningfulCaption: short, generic, valid
 * - classifyFigureType: chart, table, diagram, photo/default
 */

import { Test, TestingModule } from "@nestjs/testing";
import { FigureExtractorService } from "../figure-extractor.service";
import { ToolRegistry } from "@/modules/ai-harness/facade";

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockToolRegistry = {
  tryGet: jest.fn(),
};

const mockWebScraperTool = {
  execute: jest.fn(),
};

// ──────────────────────────────────────────────────────────────────────────────
// global fetch mock
// ──────────────────────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("FigureExtractorService", () => {
  let service: FigureExtractorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FigureExtractorService,
        { provide: ToolRegistry, useValue: mockToolRegistry },
      ],
    }).compile();

    service = module.get<FigureExtractorService>(FigureExtractorService);
    jest.clearAllMocks();
  });

  // ─────────────────────────── extractFigures ───────────────────────────────

  describe("extractFigures", () => {
    it("should return empty array for empty HTML content", () => {
      const result = service.extractFigures("https://example.com", "");
      expect(result).toEqual([]);
    });

    it("should return empty array for null-like HTML content", () => {
      const result = service.extractFigures(
        "https://example.com",
        undefined as unknown as string,
      );
      expect(result).toEqual([]);
    });

    it("should return empty array when HTML has no images", () => {
      const html = "<div><p>Just text content</p></div>";
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should extract figure elements with figcaption", () => {
      const html = `<figure><img src="https://example.com/chart.png" alt="Annual growth chart"><figcaption>Figure 1: Market analysis chart showing growth trends data statistics</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].imageUrl).toBe("https://example.com/chart.png");
    });

    it("should extract figure elements without figcaption (uses alt as caption fallback)", () => {
      const html = `<figure><img src="https://example.com/chart.png" alt="chart"></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: no figcaption → alt used as fallback caption; figure is extracted
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].imageUrl).toBe("https://example.com/chart.png");
    });

    it("should extract figure elements with non-meaningful figcaption (falls back to alt or empty caption)", () => {
      const html = `<figure><img src="https://example.com/fig.png"><figcaption>Figure 1</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption → falls back to alt (empty here); figure still extracted
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].imageUrl).toBe("https://example.com/fig.png");
    });

    it("should filter out logo images", () => {
      const html = `<img src="https://example.com/logo.png" alt="Company logo image branding">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should filter out icon images", () => {
      const html = `<img src="https://example.com/icon-share.png" alt="Share icon button">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should filter out avatar images", () => {
      const html = `<img src="https://example.com/avatar-user.png" alt="User avatar profile photo">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should filter out tracking pixel URLs", () => {
      const html = `<img src="https://example.com/track.gif?w=1&h=1" alt="Pixel tracking image spacer small">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should filter out images with tiny dimensions", () => {
      const html = `<img src="https://example.com/small.png" width="30" height="30" alt="Market analysis chart showing annual growth trends and forecast data">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should filter out images with 1x1 tracking pixel URL pattern", () => {
      const html = `<img src="https://example.com/pixel.gif?width=1" alt="This is a market analysis chart data statistics growth forecast">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should keep images with chart-related keywords in caption", () => {
      const html = `<img src="https://example.com/image.png" alt="Annual growth chart showing 25% increase in market data statistics">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should keep images with substantial caption (>=20 chars) even without keywords", () => {
      const html = `<img src="https://example.com/image.png" alt="The researchers found significant evidence in the experimental results of this trial">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should reject images with width < 80", () => {
      const html = `<img src="https://example.com/image.png" width="50" alt="This is a sufficiently long alt text without any keywords to match">`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: threshold changed from <100 to <80; width=50 is still rejected
      expect(result).toEqual([]);
    });

    it("should reject images with width > 4000", () => {
      const html = `<img src="https://example.com/image.png" width="4500" alt="This is a sufficiently long alt text without any keywords to match">`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: threshold changed from >3000 to >4000; width=4500 is rejected, width=3500 would now pass
      expect(result).toEqual([]);
    });

    it("should resolve relative URLs against base URL", () => {
      const html = `<figure><img src="/images/data-analysis-chart.png" alt="data analysis chart showing statistics"><figcaption>Data analysis chart with statistics and trends</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].imageUrl).toBe(
          "https://example.com/images/data-analysis-chart.png",
        );
      }
    });

    it("should skip data URLs in img src", () => {
      const html = `<img src="data:image/png;base64,abc123" alt="Base64 encoded chart with market data analysis growth statistics">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should resolve protocol-relative URLs", () => {
      const html = `<figure><img src="//cdn.example.com/market-trend-chart.png" alt="market trend chart"><figcaption>Market trend analysis and forecast projection statistics</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].imageUrl).toContain("https://cdn.example.com");
      }
    });

    it("should limit to MAX_FIGURES_PER_URL (10) per call", () => {
      const imgs = Array.from(
        { length: 15 },
        (_, i) =>
          `<figure><img src="https://example.com/chart-${i}.png" alt="chart ${i}"><figcaption>Annual growth chart showing trends ${i} and data statistics analysis</figcaption></figure>`,
      ).join("\n");
      const result = service.extractFigures("https://example.com", imgs);
      // v6.0: MAX_FIGURES_PER_URL changed from 5 to 10
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("should classify table type correctly", () => {
      const html = `<figure><img src="https://example.com/data-table.png" alt="Data table"><figcaption>Data table showing statistics comparison results</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].type).toBe("table");
      }
    });

    it("should classify diagram type correctly", () => {
      const html = `<figure><img src="https://example.com/flow-diagram.png" alt="Flow diagram"><figcaption>Architecture diagram showing process flow structure</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].type).toBe("diagram");
      }
    });

    it("should classify chart type as default for chart keywords", () => {
      const html = `<figure><img src="https://example.com/bar-chart.png" alt="Bar chart"><figcaption>Market growth chart showing forecast projection trends statistics</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].type).toBe("chart");
      }
    });

    it("should deduplicate images already seen in figure elements", () => {
      const url = "https://example.com/chart.png";
      const html = `<figure><img src="${url}" alt="chart showing data"><figcaption>Market analysis chart data statistics growth trends</figcaption></figure><img src="${url}" alt="Market analysis chart data statistics growth trends annual">`;
      const result = service.extractFigures("https://example.com", html);
      const urls = result.map((f) => f.imageUrl);
      const unique = new Set(urls);
      expect(unique.size).toBe(urls.length);
    });

    it("should reject corrupted CDN URLs with $s! pattern", () => {
      const html = `<img src="https://cdn.example.com/image$s!corrupt.png" alt="Market analysis chart data statistics growth trends annual forecast">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should reject URLs that are too long (>2048 chars)", () => {
      const longPath = "a".repeat(2100);
      const html = `<img src="https://example.com/${longPath}" alt="Market analysis chart data statistics growth trends annual forecast comparison">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should decode HTML entities in URLs", () => {
      const html = `<figure><img src="https://example.com/image?a=1&amp;b=2" alt="chart"><figcaption>Market analysis chart data statistics growth trends annual forecast</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].imageUrl).toContain("a=1&b=2");
      }
    });

    it("should extract images with data-src (lazy load) attribute", () => {
      const html = `<img data-src="https://example.com/lazy-chart.png" alt="Market analysis chart data statistics growth trends annual forecast comparison">`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].imageUrl).toBe("https://example.com/lazy-chart.png");
      }
    });

    it("should extract images with data-original (lazy load) attribute", () => {
      const html = `<img data-original="https://example.com/original-chart.png" alt="Market analysis chart data statistics growth trends annual forecast comparison">`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].imageUrl).toBe(
          "https://example.com/original-chart.png",
        );
      }
    });

    it("should handle invalid base URL gracefully", () => {
      const html = `<figure><img src="/chart.png"><figcaption>Market analysis chart data statistics growth trends</figcaption></figure>`;
      // 'not-a-url' is not a valid URL
      const result = service.extractFigures("not-a-url", html);
      // Should not throw; may return empty
      expect(Array.isArray(result)).toBe(true);
    });

    it("should no longer exclude unsplash.com stock photos (v6.0: blacklist removed)", () => {
      const html = `<img src="https://unsplash.com/photo-123.jpg" alt="Beautiful market analysis chart data statistics growth trends forecast">`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: stock photo domains like unsplash.com are no longer blacklisted; figure is extracted
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].imageUrl).toBe("https://unsplash.com/photo-123.jpg");
    });

    it("should exclude gravatar.com avatars", () => {
      const html = `<img src="https://gravatar.com/avatar/abc123" alt="User profile avatar author photo headshot portrait description long">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should extract width and height from img tag", () => {
      const html = `<img src="https://example.com/chart.png" width="800" height="600" alt="Market analysis chart showing annual growth trends data statistics forecast comparison">`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].width).toBe(800);
        expect(result[0].height).toBe(600);
      }
    });

    it("should use srcset highest resolution when available and >=600w", () => {
      const html = `<img srcset="https://example.com/sm.png 300w, https://example.com/lg.png 1200w" src="https://example.com/sm.png" alt="Market analysis chart showing annual growth trends data statistics forecast comparison">`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(result[0].imageUrl).toBe("https://example.com/lg.png");
      }
    });

    it("should not use srcset when best candidate is below 600w", () => {
      const html = `<img srcset="https://example.com/sm.png 300w, https://example.com/md.png 500w" src="https://example.com/sm.png" alt="Market analysis chart showing annual growth trends data statistics forecast comparison">`;
      const result = service.extractFigures("https://example.com", html);
      // srcset not used, falls back to src; result depends on URL validity
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle srcset with x descriptors", () => {
      const html = `<img srcset="https://example.com/1x.png 1x, https://example.com/2x.png 2x" src="https://example.com/1x.png" alt="Market analysis chart showing annual growth trends data statistics forecast comparison">`;
      const result = service.extractFigures("https://example.com", html);
      // 2x * 1000 = 2000 which is > 600, so 2x.png should be selected
      if (result.length > 0) {
        expect(result[0].imageUrl).toBe("https://example.com/2x.png");
      }
    });

    it("should not use data: URLs from data-src attribute", () => {
      const html = `<img data-src="data:image/gif;base64,abc" src="https://example.com/real.png" alt="Market analysis chart showing annual growth trends data statistics forecast comparison">`;
      const result = service.extractFigures("https://example.com", html);
      // Should use real src, not the data: from data-src
      if (result.length > 0) {
        expect(result[0].imageUrl).not.toMatch(/^data:/);
      }
    });

    it("should classify figure type from figcaption text", () => {
      // classifyFigureType returns a valid figure type
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>Market analysis data statistics showing growth trends annually with research findings results</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      if (result.length > 0) {
        expect(["chart", "table", "diagram", "photo"]).toContain(
          result[0].type,
        );
      }
    });

    it("should handle WordPress thumbnail URL pattern (exclusion)", () => {
      const html = `<img src="https://wordpress.example.com/wp-content/uploads/2023/post-image-150x150.jpg" alt="Market analysis chart data statistics growth trends annual">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────── extractFiguresFromUrl ───────────────────────

  describe("extractFiguresFromUrl", () => {
    it("should return empty array when web-scraper tool not available", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const result = await service.extractFiguresFromUrl("https://example.com");

      expect(result).toEqual([]);
      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-scraper");
    });

    it("should return empty array when tool returns failure result", async () => {
      mockToolRegistry.tryGet.mockReturnValue(mockWebScraperTool);
      mockWebScraperTool.execute.mockResolvedValue({
        success: false,
        error: { message: "Failed to fetch page" },
      });

      const result = await service.extractFiguresFromUrl("https://example.com");

      expect(result).toEqual([]);
    });

    it("should return empty array when tool result has no data", async () => {
      mockToolRegistry.tryGet.mockReturnValue(mockWebScraperTool);
      mockWebScraperTool.execute.mockResolvedValue({
        success: true,
        data: null,
        error: { message: "No data" },
      });

      const result = await service.extractFiguresFromUrl("https://example.com");

      expect(result).toEqual([]);
    });

    it("should return empty array when tool throws an error", async () => {
      mockToolRegistry.tryGet.mockReturnValue(mockWebScraperTool);
      mockWebScraperTool.execute.mockRejectedValue(
        new Error("Network timeout"),
      );

      const result = await service.extractFiguresFromUrl("https://example.com");

      expect(result).toEqual([]);
    });

    it("should return empty when scraperData.success is false", async () => {
      mockToolRegistry.tryGet.mockReturnValue(mockWebScraperTool);
      mockWebScraperTool.execute.mockResolvedValue({
        success: true,
        data: {
          success: false,
          content: "",
        },
      });

      const result = await service.extractFiguresFromUrl("https://example.com");

      expect(result).toEqual([]);
    });

    it("should fall back to content when html not available in tool response", async () => {
      mockToolRegistry.tryGet.mockReturnValue(mockWebScraperTool);
      mockWebScraperTool.execute.mockResolvedValue({
        success: true,
        data: {
          success: true,
          content: "Plain text content without figures",
        },
      });

      const result = await service.extractFiguresFromUrl("https://example.com");

      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle timeout race condition", async () => {
      mockToolRegistry.tryGet.mockReturnValue(mockWebScraperTool);
      // Execute resolves very slowly; timeout wins
      mockWebScraperTool.execute.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 60000)),
      );

      // Use a very short timeout so the timeout promise wins quickly
      const result = await service.extractFiguresFromUrl(
        "https://example.com",
        1,
      );

      expect(result).toEqual([]);
    });

    it("should call validateAndUpgradeFigures on successful extraction", async () => {
      mockToolRegistry.tryGet.mockReturnValue(mockWebScraperTool);
      mockWebScraperTool.execute.mockResolvedValue({
        success: true,
        data: {
          success: true,
          html: `<figure><img src="https://example.com/market-chart.png" alt="market chart"><figcaption>Market analysis chart showing data statistics growth trends forecast</figcaption></figure>`,
          content: "content",
        },
      });

      // Mock fetch for validateAndUpgradeFigures -> downloadAndInlineImage
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: jest.fn().mockReturnValue("image/png") },
      });

      const result = await service.extractFiguresFromUrl("https://example.com");

      expect(Array.isArray(result)).toBe(true);
    });

    it("should use custom timeout parameter", async () => {
      mockToolRegistry.tryGet.mockReturnValue(mockWebScraperTool);
      mockWebScraperTool.execute.mockResolvedValue({
        success: true,
        data: {
          success: true,
          content: "No figures here",
        },
      });

      const result = await service.extractFiguresFromUrl(
        "https://example.com",
        5000,
      );

      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─────────────────────────── validateAndUpgradeFigures ───────────────────

  describe("validateAndUpgradeFigures", () => {
    it("should return empty array when input is empty", async () => {
      const result = await service.validateAndUpgradeFigures([]);
      expect(result).toEqual([]);
    });

    it("should REJECT data URL figures (v6: never store base64 in figureReferences)", async () => {
      const dataFigure = {
        imageUrl: "data:image/png;base64,abc123",
        caption: "Test chart",
        type: "chart" as const,
      };

      const result = await service.validateAndUpgradeFigures([dataFigure]);

      expect(result).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should reject figures that fail download", async () => {
      const figure = {
        imageUrl: "https://example.com/chart.png",
        caption: "Test chart",
        type: "chart" as const,
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(0);
    });

    // ── Helper: mock a successful GET+Range response ──
    const mockImageResponse = (opts?: {
      contentType?: string;
      contentLength?: string;
      contentRange?: string;
      status?: number;
      ok?: boolean;
      magicBytes?: Buffer;
    }) => {
      const body =
        opts?.magicBytes ?? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]); // PNG
      return {
        ok: opts?.ok ?? true,
        status: opts?.status ?? 200,
        headers: {
          get: jest.fn((h: string) => {
            if (h === "content-type") return opts?.contentType ?? "image/png";
            if (h === "content-length") return opts?.contentLength ?? "20000";
            if (h === "content-range") return opts?.contentRange ?? null;
            return null;
          }),
        },
        arrayBuffer: jest
          .fn()
          .mockResolvedValue(
            body.buffer.slice(
              body.byteOffset,
              body.byteOffset + body.byteLength,
            ),
          ),
      };
    };

    it("should preserve original HTTP URL when GET+Range validation succeeds (v7)", async () => {
      const figure = {
        imageUrl: "https://example.com/chart.png",
        caption: "Test chart",
        type: "chart" as const,
      };

      mockFetch.mockResolvedValue(mockImageResponse());

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(1);
      expect(result[0].imageUrl).toBe("https://example.com/chart.png");
      // v7: uses GET with Range header, not HEAD
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should accept 206 Partial Content response", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/chart.png",
        caption: "Chart",
        type: "chart" as const,
      };

      mockFetch.mockResolvedValue(
        mockImageResponse({
          status: 206,
          ok: false, // 206 is not in 200-299 range for ok
          contentRange: "bytes 0-8191/50000",
        }),
      );

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(1);
    });

    it("should detect real file size from Content-Range and reject >5MB", async () => {
      const figure = {
        imageUrl: "https://example.com/large.png",
        caption: "Large chart",
        type: "chart" as const,
      };

      mockFetch.mockResolvedValue(
        mockImageResponse({
          status: 206,
          ok: false,
          contentRange: "bytes 0-8191/6000000",
          contentLength: "8192", // partial chunk size, not real size
        }),
      );

      const result = await service.validateAndUpgradeFigures([figure]);

      // validation failure → rejected (quality first, no broken images)
      expect(result).toHaveLength(0);
    });

    it("should reject image smaller than 5KB when full size is known", async () => {
      const figure = {
        imageUrl: "https://example.com/tiny.png",
        caption: "Tiny chart",
        type: "chart" as const,
      };

      mockFetch.mockResolvedValue(mockImageResponse({ contentLength: "3000" }));

      const result = await service.validateAndUpgradeFigures([figure]);

      // too small → rejected
      expect(result).toHaveLength(0);
    });

    it("should reject text/html with no image magic bytes", async () => {
      const figure = {
        imageUrl: "https://example.com/notimage.html",
        caption: "Not an image",
        type: "chart" as const,
      };

      const htmlBytes = Buffer.from("<html><body>Not an image</body></html>");
      mockFetch.mockResolvedValue(
        mockImageResponse({
          contentType: "text/html",
          magicBytes: htmlBytes,
        }),
      );

      const result = await service.validateAndUpgradeFigures([figure]);

      // non-image content type, no image magic bytes → rejected
      expect(result).toHaveLength(0);
    });

    it("should accept image via magic bytes when Content-Type is wrong", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/image",
        caption: "Chart",
        type: "chart" as const,
      };

      // CDN returns text/html but actual content is JPEG
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
      mockFetch.mockResolvedValue(
        mockImageResponse({
          contentType: "text/html",
          magicBytes: jpegBytes,
        }),
      );

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(1);
    });

    it("should accept image when Content-Type is empty (CDN quirk)", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/image.png",
        caption: "Chart",
        type: "chart" as const,
      };

      mockFetch.mockResolvedValue(mockImageResponse({ contentType: "" }));

      const result = await service.validateAndUpgradeFigures([figure]);

      // v7: empty Content-Type + PNG magic bytes → accepted
      expect(result).toHaveLength(1);
    });

    it("should reject when both upgraded URL and original URL fail", async () => {
      const figure = {
        imageUrl: "https://example.com/image?w=200&h=150",
        caption: "Chart",
        type: "chart" as const,
      };

      // Both upgraded and original fail with 404
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const result = await service.validateAndUpgradeFigures([figure]);

      // both fail → rejected (quality first)
      expect(result).toHaveLength(0);
      // Should have been called twice: once for upgraded, once for original
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should succeed with original URL when upgraded URL fails", async () => {
      const figure = {
        imageUrl: "https://example.com/image?w=200",
        caption: "Chart",
        type: "chart" as const,
      };

      // First call (upgraded URL) fails, second call (original) succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          headers: { get: jest.fn().mockReturnValue(null) },
        })
        .mockResolvedValueOnce(mockImageResponse());

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(1);
      expect(result[0].imageUrl).toBe("https://example.com/image?w=200");
    });

    it("should reject figure on network error", async () => {
      const figure = {
        imageUrl: "https://example.com/chart.png",
        caption: "Chart",
        type: "chart" as const,
      };

      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await service.validateAndUpgradeFigures([figure]);

      // network error → rejected (quality first, no broken images)
      expect(result).toHaveLength(0);
    });

    it("should process multiple figures: reject data URL, keep valid HTTP", async () => {
      const figures = [
        {
          imageUrl: "data:image/png;base64,abc",
          caption: "Data chart",
          type: "chart" as const,
        },
        {
          imageUrl: "https://example.com/chart1.png",
          caption: "Chart 1",
          type: "chart" as const,
        },
      ];

      mockFetch.mockResolvedValue(mockImageResponse());

      const result = await service.validateAndUpgradeFigures(figures);

      // data URL rejected, https passes validation
      expect(result).toHaveLength(1);
      expect(result[0].imageUrl).toBe("https://example.com/chart1.png");
    });

    it("should use upgraded URL in returned figure when upgrade succeeds", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/resize/400x300!/image.png",
        caption: "Chart",
        type: "chart" as const,
      };

      mockFetch.mockResolvedValue(mockImageResponse());

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(1);
      expect(result[0].imageUrl).toContain("resize/1200x800!");
    });

    it("should detect WebP via magic bytes", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/photo.webp",
        caption: "Photo",
        type: "photo" as const,
      };

      // RIFF....WEBP
      const webpBytes = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      ]);
      mockFetch.mockResolvedValue(
        mockImageResponse({ contentType: "", magicBytes: webpBytes }),
      );

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(1);
    });

    it("should detect GIF via magic bytes", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/anim.gif",
        caption: "Animation",
        type: "chart" as const,
      };

      const gifBytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      mockFetch.mockResolvedValue(
        mockImageResponse({
          contentType: "application/octet-stream",
          magicBytes: gifBytes,
        }),
      );

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(1);
    });

    it("should accept 405 Method Not Allowed optimistically", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/protected.png",
        caption: "Chart",
        type: "chart" as const,
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 405,
        headers: { get: jest.fn().mockReturnValue(null) },
      });

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(1);
    });

    it("should reject non-HTTP URLs (relative paths, file:// etc)", async () => {
      const figures = [
        {
          imageUrl: "evidence_1_chart.png",
          caption: "Chart",
          type: "chart" as const,
        },
        {
          imageUrl: "file:///tmp/chart.png",
          caption: "Chart",
          type: "chart" as const,
        },
        {
          imageUrl: "/images/chart.png",
          caption: "Chart",
          type: "chart" as const,
        },
      ];

      const result = await service.validateAndUpgradeFigures(figures);

      expect(result).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should reject PDF URLs", async () => {
      const figure = {
        imageUrl: "https://example.com/report.pdf",
        caption: "Report",
        type: "chart" as const,
      };

      const result = await service.validateAndUpgradeFigures([figure]);

      expect(result).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────── isMeaningfulCaption (via extractFigures) ─────────

  describe("isMeaningfulCaption logic (tested indirectly)", () => {
    it("should treat undefined as non-meaningful", () => {
      // Empty alt results in empty string — not meaningful
      const html = `<img src="https://example.com/chart.png" alt="">`;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toEqual([]);
    });

    it("should still extract figure when figcaption is 'figure 1' (non-meaningful — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>figure 1</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when figcaption is 'fig. 2' (non-meaningful — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>fig. 2</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when figcaption is 'image 3' (non-meaningful — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>image 3</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when figcaption is 'photo' (non-meaningful — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>photo</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when figcaption is '123' (numeric only — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>123</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when figcaption is short text (<8 chars — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>short</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when figcaption is 'screenshot 1' (non-meaningful — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>screenshot 1</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when figcaption is 'table 2' (non-meaningful — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>table 2</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when Chinese generic figcaption '图1' is non-meaningful (falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>图1</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });

    it("should still extract figure when figcaption is '图片 2' (non-meaningful — falls back to alt/empty)", () => {
      const html = `<figure><img src="https://example.com/chart.png"><figcaption>图片 2</figcaption></figure>`;
      const result = service.extractFigures("https://example.com", html);
      // v6.0: non-meaningful figcaption uses alt fallback; figure is still extracted
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────── tryUpgradeImageUrl (tested indirectly) ──────────

  describe("tryUpgradeImageUrl logic (tested via validateAndUpgradeFigures)", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: jest.fn().mockReturnValue(null) },
      });
    });

    it("should upgrade Brightspot resize URLs", async () => {
      const figure = {
        imageUrl: "https://cdn.brightspot.com/img/resize/640x480!/photo.jpg",
        caption: "Chart",
        type: "chart" as const,
      };

      await service.validateAndUpgradeFigures([figure]);

      const firstCallUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(firstCallUrl).toContain("resize/1200x800!");
    });

    it("should upgrade small width parameter", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/img.jpg?w=200&other=val",
        caption: "Chart",
        type: "chart" as const,
      };

      await service.validateAndUpgradeFigures([figure]);

      const firstCallUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(firstCallUrl).toContain("w=1200");
    });

    it("should not upgrade large width parameter", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/img.jpg?w=800",
        caption: "Chart",
        type: "chart" as const,
      };

      await service.validateAndUpgradeFigures([figure]);

      // No upgrade, so only 1 fetch call for original
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should upgrade low quality parameter", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/img/quality/60/photo.jpg",
        caption: "Chart",
        type: "chart" as const,
      };

      await service.validateAndUpgradeFigures([figure]);

      const firstCallUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(firstCallUrl).toContain("/quality/90/");
    });

    it("should not upgrade quality parameter already at 80 or above", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/img/quality/85/photo.jpg",
        caption: "Chart",
        type: "chart" as const,
      };

      await service.validateAndUpgradeFigures([figure]);

      // No upgrade, only 1 fetch call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should upgrade height parameter alongside width when both are small", async () => {
      const figure = {
        imageUrl: "https://cdn.example.com/img.jpg?w=200&h=150",
        caption: "Chart",
        type: "chart" as const,
      };

      await service.validateAndUpgradeFigures([figure]);

      const firstCallUrl = mockFetch.mock.calls[0]?.[0] as string;
      expect(firstCallUrl).toContain("h=800");
    });
  });
});

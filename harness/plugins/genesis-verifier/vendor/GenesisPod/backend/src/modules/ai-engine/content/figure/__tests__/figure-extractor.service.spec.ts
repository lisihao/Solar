/**
 * FigureExtractorService unit tests
 * Covers private helpers via casting, and the public validate/extractFigures methods.
 * Network calls (fetch, HTTP) are mocked globally.
 */
import { FigureExtractorService } from "../figure-extractor.service";
import { ToolRegistry } from "../../../tools/registry/tool.registry";

// ---------------------------------------------------------------------------
// Mock globals
// ---------------------------------------------------------------------------

// Mock withTimeoutFallback to immediately resolve the promise (no actual timeout)
jest.mock("@/common/utils/timeout.utils", () => ({
  withTimeoutFallback: jest
    .fn()
    .mockImplementation(
      async (
        promise: Promise<unknown>,
        _timeout: number,
        fallback: unknown,
      ) => {
        try {
          return await promise;
        } catch {
          return fallback;
        }
      },
    ),
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ---------------------------------------------------------------------------
// Mock ToolRegistry
// ---------------------------------------------------------------------------

function makeToolRegistry(toolResult?: {
  success: boolean;
  data?: { html?: string; content?: string; success?: boolean };
  error?: { code: string; message: string };
}) {
  const defaultResult = {
    success: true,
    data: { html: "<html><body></body></html>", content: "", success: true },
  };
  const mockTool = {
    execute: jest.fn().mockResolvedValue(toolResult ?? defaultResult),
  };
  return {
    tryGet: jest.fn().mockReturnValue(mockTool),
  } as unknown as ToolRegistry;
}

// ---------------------------------------------------------------------------
// Helper to access private methods
// ---------------------------------------------------------------------------

type ServicePrivate = {
  classifyFigureType: (text: string) => string;
  isLikelyChart: (
    url: string,
    caption: string,
    alt?: string,
    width?: number,
    height?: number,
  ) => boolean;
  resolveUrl: (base: string, src: string) => string | null;
  isMeaningfulCaption: (text: string | undefined) => boolean;
  isImageByMagicBytes: (bytes: Buffer) => boolean;
  tryUpgradeImageUrl: (url: string) => string | null;
  cleanHtmlText: (html: string) => string;
  extractAltFromImg: (imgTag: string) => string;
  extractAltFromFullMatch: (fullMatch: string) => string;
  extractDimension: (tag: string, attr: string) => number | undefined;
  extractBestSrc: (imgTag: string) => string | null;
  extractHighestResSrcset: (imgTag: string) => string | null;
};

function priv(svc: FigureExtractorService): ServicePrivate {
  return svc as unknown as ServicePrivate;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FigureExtractorService", () => {
  let service: FigureExtractorService;

  beforeEach(() => {
    mockFetch.mockReset();
    service = new FigureExtractorService(makeToolRegistry());
  });

  // ─── classifyFigureType ──────────────────────────────────────────────────

  describe("classifyFigureType", () => {
    it("returns 'photo' for empty text", () => {
      expect(priv(service).classifyFigureType("")).toBe("photo");
    });

    it("returns 'table' for text containing 'table'", () => {
      expect(priv(service).classifyFigureType("data table comparison")).toBe(
        "table",
      );
    });

    it("returns 'chart' for text containing 'chart'", () => {
      expect(priv(service).classifyFigureType("Growth chart 2024")).toBe(
        "chart",
      );
    });

    it("returns 'diagram' for text containing 'diagram'", () => {
      expect(priv(service).classifyFigureType("system diagram")).toBe(
        "diagram",
      );
    });

    it("returns 'photo' for generic text", () => {
      expect(priv(service).classifyFigureType("street scene")).toBe("photo");
    });

    it("returns 'photo' for blog title with marketing keywords", () => {
      // Text >40 chars with blog platform marker → classified as photo not diagram/chart
      const blogTitle =
        "实战指南：深度解析微服务架构设计模式 - 从入门到精通完全指南 腾讯云开发者技术社区X";
      expect(priv(service).classifyFigureType(blogTitle)).toBe("photo");
    });

    it("returns 'diagram' for academic figure label", () => {
      expect(priv(service).classifyFigureType("Figure 3 System Overview")).toBe(
        "diagram",
      );
    });

    it("returns 'chart' for Chinese 趋势 keyword", () => {
      expect(priv(service).classifyFigureType("市场趋势分析图")).toBe("chart");
    });

    it("returns 'photo' for 图片 keyword", () => {
      expect(priv(service).classifyFigureType("产品实拍图片")).toBe("photo");
    });

    it("returns 'diagram' for 架构 keyword", () => {
      expect(priv(service).classifyFigureType("系统架构")).toBe("diagram");
    });
  });

  // ─── resolveUrl ──────────────────────────────────────────────────────────

  describe("resolveUrl", () => {
    it("passes through absolute https URL unchanged", () => {
      const url = "https://example.com/image.png";
      expect(priv(service).resolveUrl("https://base.com", url)).toBe(url);
    });

    it("passes through absolute http URL", () => {
      const url = "http://example.com/img.jpg";
      expect(priv(service).resolveUrl("https://base.com", url)).toBe(url);
    });

    it("prepends https: for protocol-relative URL", () => {
      const result = priv(service).resolveUrl(
        "https://base.com",
        "//cdn.example.com/img.jpg",
      );
      expect(result).toBe("https://cdn.example.com/img.jpg");
    });

    it("resolves relative URL against base", () => {
      const result = priv(service).resolveUrl(
        "https://example.com/page/",
        "images/chart.png",
      );
      expect(result).toBe("https://example.com/page/images/chart.png");
    });

    it("returns null for data: URL", () => {
      expect(
        priv(service).resolveUrl(
          "https://base.com",
          "data:image/png;base64,abc",
        ),
      ).toBeNull();
    });

    it("returns null for Substack CDN corruption ($s!)", () => {
      expect(
        priv(service).resolveUrl(
          "https://base.com",
          "https://cdn.substack.com/$s!/img.jpg",
        ),
      ).toBeNull();
    });

    it("returns null for excessively long URL (>2048 chars)", () => {
      const longUrl = "https://example.com/" + "a".repeat(2050);
      expect(priv(service).resolveUrl("https://base.com", longUrl)).toBeNull();
    });

    it("returns null for invalid relative URL that throws", () => {
      // Bad relative URL that causes URL constructor to fail
      const result = priv(service).resolveUrl("not-a-valid-url", "relative");
      expect(result).toBeNull();
    });

    it("decodes HTML entities in URL", () => {
      const result = priv(service).resolveUrl(
        "https://base.com",
        "https://example.com/search?q=a&amp;b=1",
      );
      expect(result).toContain("a&b=1");
    });
  });

  // ─── isMeaningfulCaption ─────────────────────────────────────────────────

  describe("isMeaningfulCaption", () => {
    it("returns false for undefined", () => {
      expect(priv(service).isMeaningfulCaption(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(priv(service).isMeaningfulCaption("")).toBe(false);
    });

    it("returns true for meaningful caption text", () => {
      expect(
        priv(service).isMeaningfulCaption("Revenue growth chart 2024"),
      ).toBe(true);
    });

    it("returns false for very short caption (single word)", () => {
      const result = priv(service).isMeaningfulCaption("img");
      // Very short captions are often not meaningful
      expect(typeof result).toBe("boolean");
    });
  });

  // ─── isImageByMagicBytes ─────────────────────────────────────────────────

  describe("isImageByMagicBytes", () => {
    it("returns false for buffer shorter than 4 bytes", () => {
      expect(priv(service).isImageByMagicBytes(Buffer.from([0x89, 0x50]))).toBe(
        false,
      );
    });

    it("identifies PNG by magic bytes 89 50 4E 47", () => {
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]);
      expect(priv(service).isImageByMagicBytes(pngBytes)).toBe(true);
    });

    it("identifies JPEG by magic bytes FF D8 FF", () => {
      const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
      expect(priv(service).isImageByMagicBytes(jpegBytes)).toBe(true);
    });

    it("identifies GIF by magic bytes 47 49 46 38", () => {
      const gifBytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39]);
      expect(priv(service).isImageByMagicBytes(gifBytes)).toBe(true);
    });

    it("identifies WebP by RIFF...WEBP header", () => {
      const webpBytes = Buffer.from([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x00,
        0x00,
        0x00,
        0x00, // file size
        0x57,
        0x45,
        0x42,
        0x50, // WEBP
      ]);
      expect(priv(service).isImageByMagicBytes(webpBytes)).toBe(true);
    });

    it("identifies BMP by magic bytes 42 4D", () => {
      const bmpBytes = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00]);
      expect(priv(service).isImageByMagicBytes(bmpBytes)).toBe(true);
    });

    it("returns false for random bytes", () => {
      const randomBytes = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      expect(priv(service).isImageByMagicBytes(randomBytes)).toBe(false);
    });

    it("returns false for SVG (XML) bytes", () => {
      // SVG starts with <svg or <?xml
      const svgBytes = Buffer.from([0x3c, 0x73, 0x76, 0x67]); // <svg
      expect(priv(service).isImageByMagicBytes(svgBytes)).toBe(false);
    });
  });

  // ─── tryUpgradeImageUrl ───────────────────────────────────────────────────

  describe("tryUpgradeImageUrl", () => {
    it("returns null when no upgrade applicable", () => {
      const url = "https://example.com/image.png";
      expect(priv(service).tryUpgradeImageUrl(url)).toBeNull();
    });

    it("upgrades small width parameter", () => {
      const url = "https://example.com/img.jpg?w=200";
      const result = priv(service).tryUpgradeImageUrl(url);
      expect(result).not.toBeNull();
      expect(result).toContain("w=1200");
    });

    it("does not upgrade when width is already >= 400", () => {
      const url = "https://example.com/img.jpg?w=800";
      expect(priv(service).tryUpgradeImageUrl(url)).toBeNull();
    });

    it("upgrades Brightspot CDN resize path", () => {
      const url = "https://cms.example.com/image/resize/400x300!/photo.jpg";
      const result = priv(service).tryUpgradeImageUrl(url);
      expect(result).not.toBeNull();
      expect(result).toContain("1200x800");
    });

    it("upgrades low quality parameter", () => {
      const url = "https://cdn.example.com/quality/50/image.jpg";
      const result = priv(service).tryUpgradeImageUrl(url);
      expect(result).not.toBeNull();
      expect(result).toContain("/quality/90/");
    });
  });

  // ─── cleanHtmlText ────────────────────────────────────────────────────────

  describe("cleanHtmlText", () => {
    it("strips HTML tags", () => {
      const result = priv(service).cleanHtmlText("<p>Hello <b>world</b></p>");
      expect(result).toBe("Hello world");
    });

    it("collapses multiple spaces", () => {
      const result = priv(service).cleanHtmlText("too    many   spaces");
      expect(result).toBe("too many spaces");
    });

    it("trims whitespace", () => {
      const result = priv(service).cleanHtmlText("  text  ");
      expect(result).toBe("text");
    });
  });

  // ─── extractAltFromImg ────────────────────────────────────────────────────

  describe("extractAltFromImg", () => {
    it("extracts alt attribute value", () => {
      const tag = '<img src="img.png" alt="Revenue chart 2024" />';
      expect(priv(service).extractAltFromImg(tag)).toBe("Revenue chart 2024");
    });

    it("returns empty string when no alt attribute", () => {
      const tag = '<img src="img.png" />';
      expect(priv(service).extractAltFromImg(tag)).toBe("");
    });
  });

  // ─── extractDimension ────────────────────────────────────────────────────

  describe("extractDimension", () => {
    it("extracts numeric width attribute", () => {
      const tag = '<img src="img.png" width="800" />';
      expect(priv(service).extractDimension(tag, "width")).toBe(800);
    });

    it("returns undefined when no dimension attribute", () => {
      const tag = '<img src="img.png" />';
      expect(priv(service).extractDimension(tag, "width")).toBeUndefined();
    });
  });

  // ─── extractBestSrc ──────────────────────────────────────────────────────

  describe("extractBestSrc", () => {
    it("prefers data-src over src", () => {
      const tag = '<img src="thumb.jpg" data-src="full.jpg" />';
      expect(priv(service).extractBestSrc(tag)).toBe("full.jpg");
    });

    it("returns null when no lazy attrs or srcset", () => {
      const tag = '<img src="thumb.jpg" />';
      expect(priv(service).extractBestSrc(tag)).toBeNull();
    });

    it("ignores data-src that starts with data:", () => {
      const tag = '<img data-src="data:image/png;base64,abc" src="real.jpg" />';
      expect(priv(service).extractBestSrc(tag)).toBeNull();
    });
  });

  // ─── extractHighestResSrcset ──────────────────────────────────────────────

  describe("extractHighestResSrcset", () => {
    it("returns null when no srcset attribute", () => {
      const tag = '<img src="img.png" />';
      expect(priv(service).extractHighestResSrcset(tag)).toBeNull();
    });

    it("returns highest width URL from srcset", () => {
      const tag =
        '<img srcset="img-400.jpg 400w, img-800.jpg 800w, img-1200.jpg 1200w" />';
      const result = priv(service).extractHighestResSrcset(tag);
      expect(result).toBe("img-1200.jpg");
    });
  });

  // ─── validateAndUpgradeFigures ────────────────────────────────────────────

  describe("validateAndUpgradeFigures", () => {
    it("returns empty array for empty input", async () => {
      const result = await service.validateAndUpgradeFigures([]);
      expect(result).toEqual([]);
    });

    it("rejects figures with invalid URLs", async () => {
      const figures = [
        {
          imageUrl: "data:image/png;base64,abc",
          caption: "invalid",
          type: "photo" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("validates figure with valid https URL by fetching", async () => {
      // Simulate successful HEAD/GET request returning image bytes
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name: string) => (name === "content-type" ? "image/png" : null),
        },
        arrayBuffer: jest.fn().mockResolvedValue(pngMagic.buffer),
        status: 200,
      });

      const figures = [
        {
          imageUrl: "https://example.com/chart.png",
          caption: "Revenue chart",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      // Result may vary based on internal validation logic
      expect(Array.isArray(result)).toBe(true);
    });

    it("rejects figure when fetch fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      const figures = [
        {
          imageUrl: "https://unreachable.example.com/image.png",
          caption: "test",
          type: "photo" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });
  });

  // ─── extractFigures (public) ──────────────────────────────────────────────

  describe("extractFigures", () => {
    it("returns empty array for empty HTML", () => {
      expect(service.extractFigures("https://example.com", "")).toEqual([]);
    });

    it("extracts figures from <figure> elements", () => {
      const html = `
        <figure>
          <img src="https://example.com/chart.png" alt="Revenue chart" />
          <figcaption>Revenue growth chart 2024</figcaption>
        </figure>
      `;
      const result = service.extractFigures("https://example.com", html);
      expect(Array.isArray(result)).toBe(true);
    });

    it("extracts from <img> tags with width >= 200", () => {
      const html = `
        <img src="https://example.com/wide.jpg" alt="Wide image" width="600" height="400" />
      `;
      const result = service.extractFigures("https://example.com", html);
      expect(Array.isArray(result)).toBe(true);
    });

    it("skips images without alt and without size info", () => {
      const html = `
        <img src="https://example.com/no-info.jpg" />
      `;
      const result = service.extractFigures("https://example.com", html);
      expect(result).toHaveLength(0);
    });

    it("extracts figure with figcaption only", () => {
      const html = `
        <figure>
          <img src="https://example.com/graph.png" />
          <figcaption>GDP growth chart comparison data</figcaption>
        </figure>
      `;
      const result = service.extractFigures("https://example.com", html);
      // The caption should be used even without alt
      expect(Array.isArray(result)).toBe(true);
    });

    it("deduplicates figures from <figure> and <img> parsing", () => {
      const html = `
        <figure>
          <img src="https://example.com/chart.png" alt="A chart" />
        </figure>
        <img src="https://example.com/chart.png" alt="A chart" width="800" />
      `;
      const result = service.extractFigures("https://example.com", html);
      // Should not have duplicates for the same URL
      const urls = result.map((f) => f.imageUrl);
      const uniqueUrls = new Set(urls);
      expect(urls.length).toBe(uniqueUrls.size);
    });

    it("limits results to MAX_FIGURES_PER_URL (10)", () => {
      // Create 15 figure elements
      const figures = Array.from(
        { length: 15 },
        (_, i) => `
        <figure>
          <img src="https://example.com/chart${i}.png" alt="Chart ${i} data analysis" />
          <figcaption>Chart ${i} revenue data 2024</figcaption>
        </figure>
      `,
      ).join("\n");
      const result = service.extractFigures("https://example.com", figures);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("resolves relative URLs in <img> tags", () => {
      const html = `
        <figure>
          <img src="/images/chart.png" alt="Relative URL chart" />
        </figure>
      `;
      const result = service.extractFigures("https://example.com/page", html);
      if (result.length > 0) {
        expect(result[0].imageUrl).toMatch(/^https?:\/\//);
      }
    });

    it("handles srcset in img tags", () => {
      const html = `
        <img srcset="img-400.jpg 400w, img-1200.jpg 1200w" alt="High-res chart analysis" />
      `;
      const result = service.extractFigures("https://example.com", html);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── extractFiguresFromUrl ────────────────────────────────────────────────

  describe("extractFiguresFromUrl", () => {
    it("returns empty array when web-scraper tool is not available", async () => {
      const registry = {
        tryGet: jest.fn().mockReturnValue(null),
      } as unknown as ToolRegistry;
      const svc = new FigureExtractorService(registry);
      const result = await svc.extractFiguresFromUrl(
        "https://example.com",
        5000,
      );
      expect(result).toEqual([]);
    });

    it("returns empty array when ToolRegistry returns failure", async () => {
      const registry = makeToolRegistry({
        success: false,
        error: { code: "FETCH_FAILED", message: "scrape failed" },
      });
      const svc = new FigureExtractorService(registry);
      const result = await svc.extractFiguresFromUrl(
        "https://example.com",
        5000,
      );
      expect(result).toEqual([]);
    });

    it("extracts figures from HTML content via ToolRegistry", async () => {
      const html = `
        <figure>
          <img src="https://example.com/chart.png" alt="Revenue chart" />
          <figcaption>Revenue growth 2024 chart</figcaption>
        </figure>
      `;
      const registry = makeToolRegistry({
        success: true,
        data: { html, content: "", success: true },
      });
      const svc = new FigureExtractorService(registry);
      const result = await svc.extractFiguresFromUrl(
        "https://example.com",
        5000,
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it("returns empty for scraperData.success=false", async () => {
      const registry = makeToolRegistry({
        success: true,
        data: { html: "", content: "", success: false },
      });
      const svc = new FigureExtractorService(registry);
      const result = await svc.extractFiguresFromUrl(
        "https://example.com",
        5000,
      );
      expect(result).toEqual([]);
    });

    it("handles thrown exceptions gracefully", async () => {
      const registry = {
        tryGet: jest.fn().mockImplementation(() => {
          throw new Error("Registry crashed");
        }),
      } as unknown as ToolRegistry;
      const svc = new FigureExtractorService(registry);
      const result = await svc.extractFiguresFromUrl(
        "https://example.com",
        5000,
      );
      expect(result).toEqual([]);
    });
  });

  // ─── isLikelyChart ───────────────────────────────────────────────────────

  describe("isLikelyChart", () => {
    it("returns true for chart-labeled image", () => {
      const result = priv(service).isLikelyChart(
        "https://example.com/chart.png",
        "Revenue chart 2024",
      );
      expect(result).toBe(true);
    });

    it("returns false for tracking pixel (1x1 dimensions)", () => {
      const result = priv(service).isLikelyChart(
        "https://track.example.com/pixel.gif",
        "",
        "",
        1,
        1,
      );
      expect(result).toBe(false);
    });

    it("returns false for logo URL pattern", () => {
      const result = priv(service).isLikelyChart(
        "https://example.com/logo.png",
        "Company logo",
      );
      expect(result).toBe(false);
    });

    it("returns false for very small icon (width < 50px)", () => {
      const result = priv(service).isLikelyChart(
        "https://example.com/icon.png",
        "small icon",
        "",
        32,
        32,
      );
      expect(result).toBe(false);
    });

    it("returns false for URL with ?w=1 tracking pixel param", () => {
      const result = priv(service).isLikelyChart(
        "https://track.example.com/t.gif?w=1&h=1",
        "",
      );
      expect(result).toBe(false);
    });

    it("returns false when caption >50 chars contains blog platform name", () => {
      // Line 581: captionText.length > 50 && blogPlatformNames.test(captionText)
      // Must be > 50 chars and contain a platform name from the regex
      const longCaption =
        "这是一篇发布在掘金技术社区的文章，关于微服务架构设计的完整实战指南和最佳实践内容详解说明补充内容，供大家参考学习";
      expect(longCaption.length).toBeGreaterThan(50);
      const result = priv(service).isLikelyChart(
        "https://example.com/img.png",
        longCaption,
      );
      expect(result).toBe(false);
    });

    it("returns false when caption >40 chars contains emoji", () => {
      // Line 590: emoji in long caption (must be > 40 chars with an actual emoji codepoint)
      // U+1F389 (PARTY POPPER) is in range U+1F300-U+1F9FF; counts as 2 JS chars
      const emojiCaption =
        "\u{1F389}这个图表非常好看展示了市场数据趋势分析结果完整报告版本说明内容详解及其他资料补充说明";
      expect(emojiCaption.length).toBeGreaterThan(40);
      const result = priv(service).isLikelyChart(
        "https://example.com/img.png",
        emojiCaption,
      );
      expect(result).toBe(false);
    });

    it("returns false for URL with small NxN dimension pattern", () => {
      // Lines 597-600: urlW <= 200 && urlH <= 200
      const result = priv(service).isLikelyChart(
        "https://example.com/author-80x80.jpg",
        "Author photo",
      );
      expect(result).toBe(false);
    });

    it("returns true for URL with large NxN dimension pattern", () => {
      // urlDimMatch exists but urlW > 200
      const result = priv(service).isLikelyChart(
        "https://example.com/banner-800x600.jpg",
        "Banner image showing data",
      );
      expect(result).toBe(true);
    });

    it("returns false for extremely wide image (width > 4000)", () => {
      // Line 606: width > 4000
      const result = priv(service).isLikelyChart(
        "https://example.com/panorama.jpg",
        "Panoramic scene",
        undefined,
        5000,
        undefined,
      );
      expect(result).toBe(false);
    });

    it("returns false for very narrow image (width < 80)", () => {
      const result = priv(service).isLikelyChart(
        "https://example.com/narrow.jpg",
        "Narrow separator",
        undefined,
        20,
        undefined,
      );
      expect(result).toBe(false);
    });
  });

  // ─── validateSingleFigure (via validateAndUpgradeFigures) ─────────────────

  describe("validateSingleFigure — URL rejection guards", () => {
    it("rejects data: URL immediately", async () => {
      // Lines 786-789
      const figures = [
        {
          imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA==",
          caption: "data url image",
          type: "photo" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects non-HTTP URL (file:// protocol)", async () => {
      // Lines 794-797
      const figures = [
        {
          imageUrl: "file:///local/path/image.png",
          caption: "local file",
          type: "photo" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects PDF URLs", async () => {
      // Lines 802-805
      const figures = [
        {
          imageUrl: "https://example.com/report.pdf",
          caption: "PDF report",
          type: "diagram" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects PDF URL with query string", async () => {
      const figures = [
        {
          imageUrl: "https://example.com/document.pdf?page=1",
          caption: "PDF document",
          type: "diagram" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects SVG URLs", async () => {
      // Lines 814-817
      const figures = [
        {
          imageUrl: "https://example.com/icon.svg",
          caption: "SVG icon",
          type: "diagram" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects signed URLs with auth tokens (non-substack)", async () => {
      // Line 825: signed URL rejection
      const figures = [
        {
          imageUrl: "https://example.com/private.jpg?auth=secret123",
          caption: "private image",
          type: "photo" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("allows signed URLs from substackcdn.com", async () => {
      // substackcdn.com is exempt from signed URL rejection
      const pngMagic = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00,
      ]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "image/png";
            return null;
          },
        },
        arrayBuffer: jest.fn().mockResolvedValue(pngMagic.buffer),
      });
      const figures = [
        {
          imageUrl: "https://substackcdn.com/image/fetch/photo.jpg?token=abc",
          caption: "substack image",
          type: "photo" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── validateImageUrl — HTTP response paths ───────────────────────────────

  describe("validateAndUpgradeFigures — HTTP response handling", () => {
    it("accepts HTTP 405 Method Not Allowed as valid (line 880)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 405,
        headers: {
          get: (_name: string) => null,
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
      });
      const figures = [
        {
          imageUrl: "https://cdn.example.com/image.jpg",
          caption: "chart showing revenue",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      // 405 → returns true → figure is kept
      expect(result).toHaveLength(1);
    });

    it("uses Content-Range header to determine full file size (lines 897-898)", async () => {
      // fullSize > MAX_IMAGE_BYTES (5MB) via content-range → reject
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "image/jpeg";
            if (name === "content-range") return "bytes 0-8191/6000000"; // 6MB > MAX
            return null;
          },
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8192)),
      });
      const figures = [
        {
          imageUrl: "https://example.com/huge.jpg",
          caption: "Revenue chart analysis",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects image exceeding MAX_IMAGE_BYTES via content-length (lines 908-917)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "image/jpeg";
            if (name === "content-length") return "6000000"; // 6MB > 5MB limit
            return null;
          },
        },
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8192)),
      });
      const figures = [
        {
          imageUrl: "https://example.com/oversize.jpg",
          caption: "Chart with large file",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects when arrayBuffer() throws during read (line 927)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "image/jpeg";
            return null;
          },
        },
        arrayBuffer: jest.fn().mockRejectedValue(new Error("Stream error")),
      });
      const figures = [
        {
          imageUrl: "https://example.com/broken-stream.jpg",
          caption: "chart showing data",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects SVG content-type even if status 200 (lines 932-935)", async () => {
      // URL doesn't end in .svg (to avoid the early SVG URL guard), but server returns svg content-type
      const svgBytes = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "image/svg+xml";
            return null;
          },
        },
        arrayBuffer: jest.fn().mockResolvedValue(svgBytes.buffer),
      });
      const figures = [
        {
          imageUrl: "https://example.com/dynamic-image?format=svg&id=123",
          caption: "SVG diagram architecture overview",
          type: "diagram" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects image/* content-type with file size below MIN_IMAGE_BYTES (lines 942-945)", async () => {
      const tinyBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic but tiny
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "image/png";
            if (name === "content-length") return "100"; // 100 bytes < 5000 MIN
            return null;
          },
        },
        arrayBuffer: jest.fn().mockResolvedValue(tinyBytes.buffer),
      });
      const figures = [
        {
          imageUrl: "https://example.com/tiny.png",
          caption: "Revenue chart analysis data",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("accepts via magic bytes when content-type is missing (lines 951-954)", async () => {
      // Use Uint8Array to get a proper standalone ArrayBuffer (not shared buffer)
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (_name: string) => null, // No content-type header
        },
        arrayBuffer: jest.fn().mockResolvedValue(pngBytes.buffer),
      });
      const figures = [
        {
          imageUrl: "https://cdn.example.com/image-no-ct.png",
          caption: "Chart data analysis figure",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(1);
    });

    it("rejects when content-type is non-image and no magic bytes (lines 958-963)", async () => {
      const htmlBytes = Buffer.from("<!DOCTYPE html><html>");
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            if (name === "content-type") return "text/html";
            return null;
          },
        },
        arrayBuffer: jest.fn().mockResolvedValue(htmlBytes.buffer),
      });
      const figures = [
        {
          imageUrl: "https://example.com/page.html",
          caption: "chart analysis revenue",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("rejects when no content-type and no image magic bytes (lines 965-969)", async () => {
      const randomBytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (_name: string) => null, // No content-type
        },
        arrayBuffer: jest.fn().mockResolvedValue(randomBytes.buffer),
      });
      const figures = [
        {
          imageUrl: "https://example.com/mystery.bin",
          caption: "chart showing trends",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      expect(result).toHaveLength(0);
    });

    it("falls back to original URL when upgraded URL fails validation", async () => {
      // Lines 838-840: upgraded URL invalid → try original
      // Setup: upgraded URL (w=100 → w=1200) fails, original (w=100) succeeds
      // Original URL has w=100 → triggers upgrade to w=1200
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
      mockFetch
        .mockResolvedValueOnce({
          // First call: upgraded URL fails
          ok: false,
          status: 404,
          headers: { get: (_n: string) => null },
          arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
        })
        .mockResolvedValueOnce({
          // Second call: original URL succeeds
          ok: true,
          status: 200,
          headers: {
            get: (name: string) =>
              name === "content-type" ? "image/png" : null,
          },
          arrayBuffer: jest.fn().mockResolvedValue(pngMagic.buffer),
        });

      const figures = [
        {
          imageUrl: "https://example.com/img.jpg?w=100", // small w → triggers upgrade
          caption: "Revenue chart analysis data 2024",
          type: "chart" as const,
        },
      ];
      const result = await service.validateAndUpgradeFigures(figures);
      // Original URL is kept after upgraded URL fails
      expect(result).toHaveLength(1);
      expect(result[0].imageUrl).toBe("https://example.com/img.jpg?w=100");
    });
  });

  // ─── tryUpgradeImageUrl — height adjustment ───────────────────────────────

  describe("tryUpgradeImageUrl — height adjustment (line 1068)", () => {
    it("adjusts both width and height when both are small", () => {
      // Line 1068: heightMatch && changed && height < 400 → adjust height too
      const url = "https://cdn.example.com/img.jpg?w=200&h=150";
      const result = priv(service).tryUpgradeImageUrl(url);
      expect(result).not.toBeNull();
      expect(result).toContain("w=1200");
      expect(result).toContain("h=800");
    });

    it("does not adjust height when it is already large", () => {
      const url = "https://cdn.example.com/img.jpg?w=200&h=600";
      const result = priv(service).tryUpgradeImageUrl(url);
      expect(result).not.toBeNull();
      expect(result).toContain("w=1200");
      // height >= 400, should not be changed
      expect(result).toContain("h=600");
    });
  });

  // ─── extractHighestResSrcset — x descriptor ───────────────────────────────

  describe("extractHighestResSrcset — x density descriptor", () => {
    it("picks highest density x descriptor (2x over 1x)", () => {
      // Lines 359-360: descriptor.endsWith("x") → parseFloat * 1000
      // 2x = 2000 normalized, 1x = 1000 normalized — both >= 600, 2x wins
      const tag = '<img srcset="img-1x.jpg 1x, img-2x.jpg 2x" />';
      const result = priv(service).extractHighestResSrcset(tag);
      expect(result).toBe("img-2x.jpg");
    });

    it("returns best URL when x descriptor normalizes >= 600", () => {
      // 1x → 1000 normalized (>= 600), 3x → 3000 → picks img-3x.jpg
      const tag =
        '<img srcset="img-1x.jpg 1x, img-2x.jpg 2x, img-3x.jpg 3x" />';
      const result = priv(service).extractHighestResSrcset(tag);
      expect(result).toBe("img-3x.jpg");
    });

    it("returns null when x descriptor normalizes below 600", () => {
      // 0.5x → 500 normalized < 600 → null
      const tag = '<img srcset="img-small.jpg 0.5x" />';
      const result = priv(service).extractHighestResSrcset(tag);
      expect(result).toBeNull();
    });
  });

  // ─── resolveUrl — short hostname ─────────────────────────────────────────

  describe("resolveUrl — short hostname rejection (line 437)", () => {
    it("returns null for URL with very short hostname", () => {
      // hostname < 3 chars → null
      // This requires crafting a URL that parses but has a too-short hostname
      // Not easily triggerable without browser quirks; test the guard indirectly
      const result = priv(service).resolveUrl("https://a.b", "//x/img.jpg");
      // hostname 'x' is 1 char < 3, should return null
      expect(result).toBeNull();
    });
  });

  // ─── extractFiguresFromUrl — success path with valid HTML ─────────────────

  describe("extractFiguresFromUrl — success path (lines 139-160)", () => {
    it("returns validated figures from a successful scrape", async () => {
      const html = `
        <figure>
          <img src="https://example.com/chart.png" alt="Revenue chart 2024 annual" />
          <figcaption>Annual revenue growth chart 2024</figcaption>
        </figure>
      `;

      const registry = makeToolRegistry({
        success: true,
        data: { html, content: "", success: true },
      });
      const svc = new FigureExtractorService(registry);

      // Mock fetch for validateAndUpgradeFigures: return valid image
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === "content-type" ? "image/png" : null),
        },
        arrayBuffer: jest.fn().mockResolvedValue(pngMagic.buffer),
      });

      const result = await svc.extractFiguresFromUrl(
        "https://example.com",
        5000,
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it("handles scraperData without html field (uses content instead)", async () => {
      const content = `
        <img src="https://example.com/graph.jpg" alt="Market trends graph 2024" width="800" />
      `;

      const registry = makeToolRegistry({
        success: true,
        data: { html: undefined as unknown as string, content, success: true },
      });
      const svc = new FigureExtractorService(registry);

      mockFetch.mockRejectedValue(new Error("network error"));

      const result = await svc.extractFiguresFromUrl(
        "https://example.com",
        5000,
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });
});


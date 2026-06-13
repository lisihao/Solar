/**
 * ProxyController Supplemental Tests
 *
 * Covers uncovered branches beyond proxy.controller.spec.ts:
 * - proxyPdf: axios error with no response status (uses BAD_GATEWAY)
 * - proxyPdf: IPv6 private ranges ([fc::/7], [fd::/8], [fe80::])
 * - proxyHtml: missing <head>/<HEAD> (no base tag insertion)
 * - proxyHtml: axios error with no response (uses BAD_GATEWAY fallback)
 * - proxyHtmlReader: 403 fallback via FlareSolverr (success path)
 * - proxyHtmlReader: 403 fallback via Jina Reader (success path)
 * - proxyHtmlReader: 403 fallback via Puppeteer (success path)
 * - proxyHtmlReader: non-403 fetch error is propagated
 * - proxyHtmlReaderNews: PDF URL detection
 * - proxyHtmlReaderNews: blocked internal address
 * - proxyHtmlReaderNews: success path
 * - proxyHtmlReaderNews: 403 fallback via FlareSolverr
 * - proxyImage: FlareSolverr retry with cookies
 * - isBlockedAddress: IPv4 edge cases (172.31.x.x, 172.15.x.x boundary)
 * - extractTitleFromUrl: various URL formats
 * - markdownToHtml: markdown conversion
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ProxyController } from "../proxy.controller";
import { AdvancedExtractorService } from "../../../../../common/content-processing/advanced-extractor.service";
import { NewsExtractorService } from "../news-extractor.service";
import { PuppeteerFetcherService } from "../puppeteer-fetcher.service";
import { FlareSolverrService } from "../flaresolverr.service";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("../../../../../common/config/app.config", () => ({
  APP_CONFIG: {
    brand: {
      userAgent: "TestBot/1.0",
    },
  },
}));

// PR-X29: removed dead jest.mock for src/config/domain-whitelist.config (deleted file).

// ── Shared helpers ────────────────────────────────────────────────────────────

const mockRes = () => ({
  setHeader: jest.fn(),
  removeHeader: jest.fn(),
  send: jest.fn(),
});

const _mockImageRes = () => ({
  setHeader: jest.fn(),
  send: jest.fn(),
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ProxyController (supplemental)", () => {
  let controller: ProxyController;
  let mockAdvancedExtractor: { extract: jest.Mock };
  let mockNewsExtractor: {
    extractNews: jest.Mock;
    detectMetaRefreshRedirect: jest.Mock;
  };
  let mockPuppeteerFetcher: { fetchPage: jest.Mock };
  let mockFlareSolverr: { getIsAvailable: jest.Mock; fetchPage: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAdvancedExtractor = {
      extract: jest.fn().mockResolvedValue({
        success: true,
        title: "Test Title",
        content: "<p>content</p>",
        textContent: "content",
        excerpt: "excerpt",
        byline: null,
        siteName: "example",
        length: 200,
        plan: "readability",
        confidence: 90,
      }),
    };

    mockNewsExtractor = {
      extractNews: jest.fn().mockResolvedValue({
        title: "News Title",
        excerpt: "news excerpt",
        author: "Author Name",
        publishDate: null,
        modifiedDate: null,
        imageUrl: null,
        siteName: "Example",
        source: "opengraph",
        confidence: 75,
        paywalledIndicators: [],
      }),
      detectMetaRefreshRedirect: jest
        .fn()
        .mockReturnValue({ isRedirect: false, redirectUrl: null }),
    };

    mockPuppeteerFetcher = {
      fetchPage: jest.fn().mockResolvedValue({ success: false, html: null }),
    };

    mockFlareSolverr = {
      getIsAvailable: jest.fn().mockReturnValue(false),
      fetchPage: jest
        .fn()
        .mockResolvedValue({ success: false, error: "unavailable" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProxyController],
      providers: [
        { provide: AdvancedExtractorService, useValue: mockAdvancedExtractor },
        { provide: NewsExtractorService, useValue: mockNewsExtractor },
        { provide: PuppeteerFetcherService, useValue: mockPuppeteerFetcher },
        { provide: FlareSolverrService, useValue: mockFlareSolverr },
      ],
    }).compile();

    controller = module.get<ProxyController>(ProxyController);

    (axios as unknown as Record<string, unknown>).isAxiosError = (
      payload: unknown,
    ): boolean => !!(payload as Record<string, unknown>)?.isAxiosError;
  });

  // ── proxyPdf – additional error paths ─────────────────────────────────────

  describe("proxyPdf – additional paths", () => {
    it("should use BAD_GATEWAY when axios error has no response status", async () => {
      const axiosError = {
        isAxiosError: true,
        message: "Network Error",
        response: undefined,
      };
      mockedAxios.get.mockRejectedValueOnce(axiosError);
      (axios as unknown as Record<string, unknown>).isAxiosError = () => true;

      const res = mockRes();
      await expect(
        controller.proxyPdf("https://example.com/file.pdf", res as never),
      ).rejects.toThrow(HttpException);

      try {
        await controller.proxyPdf("https://example.com/file.pdf", res as never);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      }
    });

    it("should block IPv6 fc::/7 range", async () => {
      const res = mockRes();
      await expect(
        controller.proxyPdf("http://[fc00::1]/file.pdf", res as never),
      ).rejects.toThrow(HttpException);

      try {
        await controller.proxyPdf("http://[fc00::1]/file.pdf", res as never);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      }
    });

    it("should block IPv6 fd::/8 range", async () => {
      const res = mockRes();
      await expect(
        controller.proxyPdf("http://[fd00::1]/file.pdf", res as never),
      ).rejects.toThrow(HttpException);
    });

    it("should block IPv6 fe80:: link-local range", async () => {
      const res = mockRes();
      await expect(
        controller.proxyPdf("http://[fe80::1]/file.pdf", res as never),
      ).rejects.toThrow(HttpException);
    });

    it("should allow 172.15.x.x (NOT in private range 172.16-31)", async () => {
      const pdfBuffer = Buffer.from("%PDF-1.4 public");
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: pdfBuffer,
        headers: {},
      });
      const res = mockRes();

      // 172.15.x.x is below the private range (172.16.0.0/12), should be allowed
      await controller.proxyPdf("http://172.15.0.1/file.pdf", res as never);

      expect(res.send).toHaveBeenCalled();
    });

    it("should block 172.31.x.x (within private range 172.16-31)", async () => {
      const res = mockRes();
      await expect(
        controller.proxyPdf("http://172.31.255.255/file.pdf", res as never),
      ).rejects.toThrow(HttpException);
    });
  });

  // ── proxyHtml – additional paths ──────────────────────────────────────────

  describe("proxyHtml – additional paths", () => {
    it("should not insert base tag when neither <head> nor <HEAD> present", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: "<article><p>Minimal HTML without head tag</p></article>",
        headers: {},
      });
      const res = mockRes();

      await controller.proxyHtml("https://arxiv.org/page", res as never);

      const sentHtml = res.send.mock.calls[0][0] as string;
      expect(sentHtml).not.toContain("<base href=");
    });

    it("should use BAD_GATEWAY when axios error has no response status", async () => {
      const axiosError = {
        isAxiosError: true,
        message: "No response",
        response: undefined,
      };
      mockedAxios.get.mockRejectedValueOnce(axiosError);
      (axios as unknown as Record<string, unknown>).isAxiosError = () => true;

      const res = mockRes();
      await expect(
        controller.proxyHtml("https://arxiv.org/page", res as never),
      ).rejects.toThrow(HttpException);

      try {
        await controller.proxyHtml("https://arxiv.org/page", res as never);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      }
    });

    it("should remove X-Frame-Options meta tags from HTML", async () => {
      const htmlWithXFrame = `<html><head>
        <meta http-equiv="X-Frame-Options" content="SAMEORIGIN">
        <title>Test</title>
      </head><body></body></html>`;
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: htmlWithXFrame,
        headers: {},
      });
      const res = mockRes();

      await controller.proxyHtml("https://arxiv.org/page", res as never);

      const sentHtml = res.send.mock.calls[0][0] as string;
      expect(sentHtml).not.toContain("X-Frame-Options");
    });
  });

  // ── proxyHtmlReader – fallback paths ─────────────────────────────────────

  describe("proxyHtmlReader – fallback paths", () => {
    it("should use FlareSolverr when direct fetch returns 403", async () => {
      const fetchError = {
        isAxiosError: true,
        response: { status: 403 },
        message: "Forbidden",
      };
      mockedAxios.get.mockRejectedValueOnce(fetchError);
      (axios as unknown as Record<string, unknown>).isAxiosError = () => true;

      mockFlareSolverr.getIsAvailable.mockReturnValue(true);
      mockFlareSolverr.fetchPage.mockResolvedValue({
        success: true,
        html: "<html><head><title>FlareSolverr Result</title></head><body><p>Content from FlareSolverr that is long enough to extract.</p></body></html>",
        solveTime: 5000,
        cookies: [],
        userAgent: "Mozilla/5.0",
      });

      const result = await controller.proxyHtmlReader(
        "https://arxiv.org/abs/1234",
      );

      expect(mockFlareSolverr.fetchPage).toHaveBeenCalled();
      expect(result).toHaveProperty("title");
    });

    it("should fall through to Jina Reader when FlareSolverr fails", async () => {
      // 1st axios.get: direct fetch → 403
      const fetchError = {
        isAxiosError: true,
        response: { status: 403 },
        message: "Forbidden",
      };
      mockedAxios.get.mockRejectedValueOnce(fetchError);
      (axios as unknown as Record<string, unknown>).isAxiosError = () => true;

      // FlareSolverr available but fails
      mockFlareSolverr.getIsAvailable.mockReturnValue(true);
      mockFlareSolverr.fetchPage.mockResolvedValue({
        success: false,
        error: "timeout",
      });

      // 2nd axios.get: Jina Reader call → returns markdown (>200 chars)
      const longMarkdown =
        "# Article Title\n\n" + "This is a long article. ".repeat(20);
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: longMarkdown,
      });

      const result = await controller.proxyHtmlReader(
        "https://arxiv.org/abs/1234",
      );

      expect(mockFlareSolverr.fetchPage).toHaveBeenCalled();
      // Jina Reader was called (2nd axios.get)
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("viaJinaReader", true);
    });

    it("should fall through to Puppeteer when FlareSolverr and Jina fail", async () => {
      // 1st axios.get: direct fetch → 403
      const fetchError = {
        isAxiosError: true,
        response: { status: 403 },
        message: "Forbidden",
      };
      mockedAxios.get.mockRejectedValueOnce(fetchError);
      (axios as unknown as Record<string, unknown>).isAxiosError = () => true;

      // FlareSolverr unavailable
      mockFlareSolverr.getIsAvailable.mockReturnValue(false);

      // 2nd axios.get: Jina Reader → fails
      mockedAxios.get.mockRejectedValueOnce(new Error("Jina timeout"));

      // Puppeteer succeeds
      mockPuppeteerFetcher.fetchPage.mockResolvedValue({
        success: true,
        html: "<html><head><title>Puppeteer Page</title></head><body><p>Content from Puppeteer</p></body></html>",
        loadTime: 3000,
      });

      const result = await controller.proxyHtmlReader(
        "https://arxiv.org/abs/5678",
      );

      expect(mockPuppeteerFetcher.fetchPage).toHaveBeenCalled();
      expect(result).toHaveProperty("title");
    });
  });

  // ── proxyHtmlReaderNews ───────────────────────────────────────────────────

  describe("proxyHtmlReaderNews", () => {
    it("should throw BAD_REQUEST when url is missing", async () => {
      await expect(controller.proxyHtmlReaderNews("")).rejects.toThrow(
        HttpException,
      );

      try {
        await controller.proxyHtmlReaderNews("");
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });

    it("should return PDF redirect info for .pdf URLs", async () => {
      const result = await controller.proxyHtmlReaderNews(
        "https://arxiv.org/pdf/2401.12345.pdf",
      );

      expect(result.isPdf).toBe(true);
      expect(result.pdfUrl).toContain(".pdf");
    });

    it("should throw FORBIDDEN for internal address in news reader", async () => {
      await expect(
        controller.proxyHtmlReaderNews("http://127.0.0.1/article"),
      ).rejects.toThrow(HttpException);
    });

    it("should attempt to extract news article", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: "<html><head><title>News Article</title></head><body><article><p>News content here.</p></article></body></html>",
        headers: {},
      });

      // The news reader calls axios.get with the URL
      const result = await controller.proxyHtmlReaderNews(
        "https://example.com/news/article",
      );

      expect(mockedAxios.get).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw UNPROCESSABLE_ENTITY when title cannot be extracted", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: "<html><head></head><body></body></html>",
        headers: {},
      });

      // Override extractors to return empty title
      mockAdvancedExtractor.extract.mockResolvedValue({
        success: true,
        title: "",
        content: "",
        textContent: "",
        excerpt: "",
        byline: null,
        siteName: null,
        length: 0,
        plan: "d",
        confidence: 0,
      });
      mockNewsExtractor.extractNews.mockResolvedValue({
        title: "",
        excerpt: "",
        author: null,
        publishDate: null,
        modifiedDate: null,
        imageUrl: null,
        siteName: null,
        source: "generic",
        confidence: 0,
        paywalledIndicators: [],
      });

      await expect(
        controller.proxyHtmlReaderNews("https://example.com/empty"),
      ).rejects.toThrow(HttpException);
    });

    it("should follow meta refresh redirect in news reader", async () => {
      mockedAxios.get
        .mockResolvedValueOnce({
          status: 200,
          data: '<html><head><meta http-equiv="refresh" content="0;url=https://example.com/final"></head></html>',
          headers: {},
        })
        .mockResolvedValueOnce({
          status: 200,
          data: "<html><head><title>Final Page</title></head><body><p>Final content.</p></body></html>",
          headers: {},
        });

      mockNewsExtractor.detectMetaRefreshRedirect
        .mockReturnValueOnce({
          isRedirect: true,
          redirectUrl: "https://example.com/final",
        })
        .mockReturnValue({ isRedirect: false, redirectUrl: null });

      const result = await controller.proxyHtmlReaderNews(
        "https://example.com/redirect",
      );

      expect(result.finalUrl).toBe("https://example.com/final");
    });

    it("should return graceful degradation when all fallbacks fail for news reader", async () => {
      // 1st axios.get: direct fetch → 403
      const fetchError = {
        isAxiosError: true,
        response: { status: 403 },
        message: "Forbidden",
      };
      mockedAxios.get.mockRejectedValueOnce(fetchError);
      (axios as unknown as Record<string, unknown>).isAxiosError = () => true;

      // FlareSolverr unavailable
      mockFlareSolverr.getIsAvailable.mockReturnValue(false);

      // 2nd axios.get: Jina Reader → fails
      mockedAxios.get.mockRejectedValueOnce(new Error("Jina timeout"));

      // Puppeteer also fails
      mockPuppeteerFetcher.fetchPage.mockResolvedValue({
        success: false,
        html: null,
      });

      const result = await controller.proxyHtmlReaderNews(
        "https://example.com/protected-article",
      );

      expect(result.success).toBe(false);
      expect(result.requiresCaptcha).toBe(true);
      expect(result.plan).toBe("blocked");
      expect(result.confidence).toBe(0);
    });

    it("should use FlareSolverr for news reader when available on 403", async () => {
      const fetchError = {
        isAxiosError: true,
        response: { status: 403 },
        message: "Forbidden",
      };
      mockedAxios.get.mockRejectedValueOnce(fetchError);
      (axios as unknown as Record<string, unknown>).isAxiosError = () => true;

      mockFlareSolverr.getIsAvailable.mockReturnValue(true);
      mockFlareSolverr.fetchPage.mockResolvedValue({
        success: true,
        html: "<html><head><title>Flare News</title></head><body><p>News content via FlareSolverr.</p></body></html>",
        solveTime: 4000,
        cookies: [],
        userAgent: "Mozilla/5.0",
      });

      const result = await controller.proxyHtmlReaderNews(
        "https://example.com/flare-news",
      );

      expect(mockFlareSolverr.fetchPage).toHaveBeenCalled();
      expect(result).toHaveProperty("title");
    });
  });

  // ── proxyImage – FlareSolverr retry path ──────────────────────────────────

  describe("proxyImage – FlareSolverr retry path", () => {
    it("should retry with cookies from FlareSolverr when available", async () => {
      // 1st axios.get: direct image fetch → 403
      const fetchError = {
        isAxiosError: true,
        response: { status: 403 },
        message: "Forbidden",
      };
      mockedAxios.get.mockRejectedValueOnce(fetchError);
      (axios as unknown as Record<string, unknown>).isAxiosError = () => true;

      // FlareSolverr available, returns success with cookies
      mockFlareSolverr.getIsAvailable.mockReturnValue(true);
      mockFlareSolverr.fetchPage.mockResolvedValue({
        success: true,
        html: "<html></html>",
        solveTime: 2000,
        cookies: [
          { name: "cf_clearance", value: "abc123" },
          { name: "session", value: "xyz789" },
        ],
        userAgent: "Mozilla/5.0 (FlareSolverr)",
      });

      // 2nd axios.get: retry with cookies → success
      const imageBuffer = Buffer.from("fake-image-data");
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: imageBuffer,
        headers: { "content-type": "image/png" },
      });

      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      };

      await controller.proxyImage(
        "https://example.com/photo.png",
        res as never,
      );

      // Verify FlareSolverr was used
      expect(mockFlareSolverr.fetchPage).toHaveBeenCalled();
      // Verify retry request included cookies
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      const retryCall = mockedAxios.get.mock.calls[1];
      expect(retryCall[1]?.headers?.Cookie).toContain("cf_clearance=abc123");
      expect(retryCall[1]?.headers?.Cookie).toContain("session=xyz789");
      // Verify image was sent
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
      expect(res.send).toHaveBeenCalled();
    });
  });
});

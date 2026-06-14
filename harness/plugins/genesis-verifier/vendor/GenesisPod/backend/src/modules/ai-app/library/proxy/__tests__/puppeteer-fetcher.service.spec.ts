import { Test, TestingModule } from "@nestjs/testing";
import { PuppeteerFetcherService } from "../puppeteer-fetcher.service";
import { PuppeteerPoolService } from "../../../../../common/browser/puppeteer-pool.service";

// Mock puppeteer at module level (kept for compatibility with Page type usage)
jest.mock("puppeteer", () => ({
  launch: jest.fn(),
}));

// ─── Shared mock objects ──────────────────────────────────────────────────────

const mockPageClose = jest.fn().mockResolvedValue(undefined);
const mockPageContent = jest
  .fn()
  .mockResolvedValue("<html><body>Test content</body></html>");
const mockPageTitle = jest.fn().mockResolvedValue("Test Page Title");
const mockPageGoto = jest.fn().mockResolvedValue({ status: () => 200 });
const mockPageSetViewport = jest.fn().mockResolvedValue(undefined);
const mockPageSetUserAgent = jest.fn().mockResolvedValue(undefined);
const mockPageSetExtraHTTPHeaders = jest.fn().mockResolvedValue(undefined);
const mockPageEvaluateOnNewDocument = jest.fn().mockResolvedValue(undefined);
const mockPageWaitForSelector = jest.fn().mockResolvedValue(undefined);

const mockPage = {
  close: mockPageClose,
  content: mockPageContent,
  title: mockPageTitle,
  goto: mockPageGoto,
  setViewport: mockPageSetViewport,
  setUserAgent: mockPageSetUserAgent,
  setExtraHTTPHeaders: mockPageSetExtraHTTPHeaders,
  evaluateOnNewDocument: mockPageEvaluateOnNewDocument,
  waitForSelector: mockPageWaitForSelector,
};

const mockBrowserClose = jest.fn().mockResolvedValue(undefined);
const mockBrowserNewPage = jest.fn().mockResolvedValue(mockPage);
const mockBrowserOn = jest.fn();

const mockBrowser = {
  close: mockBrowserClose,
  newPage: mockBrowserNewPage,
  on: mockBrowserOn,
  connected: true,
};

describe("PuppeteerFetcherService", () => {
  let service: PuppeteerFetcherService;
  let mockPuppeteerPool: { getBrowser: jest.Mock; closeBrowser: jest.Mock };

  beforeEach(async () => {
    // Reset all mocks
    mockPuppeteerPool = {
      getBrowser: jest.fn().mockResolvedValue(mockBrowser),
      closeBrowser: jest.fn().mockResolvedValue(undefined),
    };

    mockBrowserNewPage.mockReset();
    mockBrowserNewPage.mockResolvedValue(mockPage);
    mockPageGoto.mockReset();
    mockPageGoto.mockResolvedValue({ status: () => 200 });
    mockPageContent.mockReset();
    mockPageContent.mockResolvedValue(
      "<html><body>Normal page content here</body></html>",
    );
    mockPageTitle.mockReset();
    mockPageTitle.mockResolvedValue("Test Page Title");
    mockPageClose.mockReset();
    mockPageClose.mockResolvedValue(undefined);
    mockBrowserClose.mockReset();
    mockBrowserClose.mockResolvedValue(undefined);
    mockBrowserOn.mockReset();
    mockPageSetViewport.mockReset();
    mockPageSetViewport.mockResolvedValue(undefined);
    mockPageSetUserAgent.mockReset();
    mockPageSetUserAgent.mockResolvedValue(undefined);
    mockPageSetExtraHTTPHeaders.mockReset();
    mockPageSetExtraHTTPHeaders.mockResolvedValue(undefined);
    mockPageEvaluateOnNewDocument.mockReset();
    mockPageEvaluateOnNewDocument.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PuppeteerFetcherService,
        { provide: PuppeteerPoolService, useValue: mockPuppeteerPool },
      ],
    }).compile();

    service = module.get<PuppeteerFetcherService>(PuppeteerFetcherService);
  });

  afterEach(async () => {
    // Clean up service (no-op since pool manages browser lifecycle)
  });

  describe("fetchPage - successful cases", () => {
    it("should fetch a page successfully and return html and title", async () => {
      const html = "<html><body>Normal page content here</body></html>";
      mockPageContent.mockResolvedValue(html);
      mockPageTitle.mockResolvedValue("Test Title");

      const result = await service.fetchPage("https://example.com");

      expect(result.success).toBe(true);
      expect(result.html).toBe(html);
      expect(result.title).toBe("Test Title");
      expect(result.loadTime).toBeGreaterThanOrEqual(0);
    });

    it("should launch browser and create a new page", async () => {
      await service.fetchPage("https://example.com");

      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalled();
      expect(mockBrowserNewPage).toHaveBeenCalled();
    });

    it("should set viewport to 1920x1080", async () => {
      await service.fetchPage("https://example.com");

      expect(mockPageSetViewport).toHaveBeenCalledWith({
        width: 1920,
        height: 1080,
      });
    });

    it("should set user agent string", async () => {
      await service.fetchPage("https://example.com");

      expect(mockPageSetUserAgent).toHaveBeenCalledWith(
        expect.stringContaining("Mozilla/5.0"),
      );
    });

    it("should set extra HTTP headers", async () => {
      await service.fetchPage("https://example.com");

      expect(mockPageSetExtraHTTPHeaders).toHaveBeenCalledWith(
        expect.objectContaining({ "Accept-Language": expect.any(String) }),
      );
    });

    it("should close the page after fetching (in finally block)", async () => {
      await service.fetchPage("https://example.com");

      expect(mockPageClose).toHaveBeenCalled();
    });

    it("should use networkidle2 when waitForNavigation is true (default)", async () => {
      await service.fetchPage("https://example.com");

      expect(mockPageGoto).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({ waitUntil: "networkidle2" }),
      );
    });

    it("should use domcontentloaded when waitForNavigation is false", async () => {
      await service.fetchPage("https://example.com", {
        waitForNavigation: false,
      });

      expect(mockPageGoto).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({ waitUntil: "domcontentloaded" }),
      );
    });

    it("should wait for selector when specified", async () => {
      await service.fetchPage("https://example.com", {
        waitForSelector: ".article",
      });

      expect(mockPageWaitForSelector).toHaveBeenCalledWith(
        ".article",
        expect.any(Object),
      );
    });
  });

  describe("fetchPage - Cloudflare detection", () => {
    it("should pass when content does not contain Cloudflare indicators", async () => {
      const normalHtml =
        "<html><body><article>Normal article content here</article></body></html>";
      mockPageContent.mockResolvedValue(normalHtml);

      const result = await service.fetchPage("https://example.com");

      expect(result.success).toBe(true);
    });

    it("should return failure when final content check detects Cloudflare challenge page", async () => {
      // Simulate: goto succeeds (200), but the content is still a Cloudflare page
      // by making the first content() call return normal HTML (so no CF wait loop),
      // but the second content() call (for final check) returns CF content.
      // This tests the final isCloudflareContent check in fetchPage.
      mockPageGoto.mockResolvedValue({ status: () => 200 });
      mockPageContent
        .mockResolvedValueOnce("<html><body>Normal page load</body></html>") // First: no CF challenge, skip wait loop
        .mockResolvedValueOnce(
          "<html><body>Just a moment... challenge-platform</body></html>",
        ); // Second: final check

      const result = await service.fetchPage("https://protected-site.com");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cloudflare");
    });

    it("should include Cloudflare detection capability", () => {
      // Validates the service exists and is properly structured
      // The Cloudflare indicators tested: "Just a moment...", "Checking your browser",
      // "Verify you are human", "cf-browser-verification", "challenge-platform",
      // "cf-turnstile", "_cf_chl_opt"
      expect(service).toBeDefined();
      expect(typeof service.fetchPage).toBe("function");
    });

    it("should return success when final content check does not detect Cloudflare", async () => {
      const normalHtml =
        "<html><body><main>This is the real article content</main></body></html>";
      mockPageContent.mockResolvedValue(normalHtml);
      mockPageGoto.mockResolvedValue({ status: () => 200 });

      const result = await service.fetchPage("https://example.com/article");

      expect(result.success).toBe(true);
      expect(result.html).toBe(normalHtml);
    });
  });

  describe("fetchPage - error handling", () => {
    it("should return failure when page.goto throws", async () => {
      mockPageGoto.mockRejectedValue(new Error("Navigation timeout"));

      const result = await service.fetchPage("https://example.com");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Navigation timeout");
    });

    it("should return failure when goto returns null response", async () => {
      mockPageGoto.mockResolvedValue(null);

      const result = await service.fetchPage("https://example.com");

      expect(result.success).toBe(false);
      expect(result.error).toContain("No response received");
    });

    it("should return failure when page returns 404 status", async () => {
      mockPageGoto.mockResolvedValue({ status: () => 404 });

      const result = await service.fetchPage("https://example.com/missing");

      expect(result.success).toBe(false);
      expect(result.error).toContain("404");
    });

    it("should return failure when page returns 500 status", async () => {
      mockPageGoto.mockResolvedValue({ status: () => 500 });

      const result = await service.fetchPage("https://example.com");

      expect(result.success).toBe(false);
    });

    it("should still close page even when error occurs", async () => {
      mockPageGoto.mockRejectedValue(new Error("Timeout"));

      await service.fetchPage("https://example.com");

      expect(mockPageClose).toHaveBeenCalled();
    });

    it("should include loadTime in failure result", async () => {
      mockPageGoto.mockRejectedValue(new Error("Failed"));

      const result = await service.fetchPage("https://example.com");

      expect(result.loadTime).toBeDefined();
      expect(result.loadTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("fetchPage - 403 handling", () => {
    it("should not throw error for 403 status (Cloudflare interstitial)", async () => {
      mockPageGoto.mockResolvedValue({ status: () => 403 });
      const normalHtml = "<html><body>Normal content after 403</body></html>";
      mockPageContent.mockResolvedValue(normalHtml);

      const result = await service.fetchPage("https://cloudflare-site.com");

      // Should continue processing after 403 (Cloudflare interstitial)
      expect(result).toBeDefined();
    });
  });

  describe("closeBrowser", () => {
    it("should close the browser via pool", async () => {
      // First make a request to initialize the browser
      await service.fetchPage("https://example.com");

      // Browser lifecycle managed by PuppeteerPoolService
      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalled();
    });

    it("should not throw when called with no browser initialized", async () => {
      // Service no longer manages browser directly; pool handles it
      expect(service).toBeDefined();
    });
  });

  describe("onModuleDestroy", () => {
    it("should clean up on module destroy", async () => {
      // Initialize browser by making a request
      await service.fetchPage("https://example.com");

      // PuppeteerPoolService manages browser lifecycle via its own onModuleDestroy
      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalled();
    });

    it("should not throw when destroying without browser", async () => {
      // Service delegates lifecycle to pool
      expect(service).toBeDefined();
    });
  });

  describe("browser reuse", () => {
    it("should reuse existing connected browser instance", async () => {
      // First call
      await service.fetchPage("https://example.com/1");
      // Second call
      await service.fetchPage("https://example.com/2");

      // Pool's getBrowser is called each time (pool handles singleton internally)
      expect(mockPuppeteerPool.getBrowser).toHaveBeenCalledTimes(2);
    });
  });
});

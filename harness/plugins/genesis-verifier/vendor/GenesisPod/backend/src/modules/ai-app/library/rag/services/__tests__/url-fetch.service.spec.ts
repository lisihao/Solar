import { Test, TestingModule } from "@nestjs/testing";
import { Logger, BadRequestException } from "@nestjs/common";
import { UrlFetchService } from "../url-fetch.service";
import { KnowledgeBaseService } from "../knowledge-base.service";

// Mock the global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("UrlFetchService", () => {
  let service: UrlFetchService;
  let mockKbService: jest.Mocked<Partial<KnowledgeBaseService>>;

  const mockHtmlResponse = `<!DOCTYPE html>
<html>
<head>
  <title>Test Article</title>
  <meta name="description" content="This is a test article about testing">
  <meta name="author" content="John Doe">
  <meta property="og:site_name" content="Test Blog">
  <meta property="article:published_time" content="2024-01-15T10:00:00Z">
</head>
<body>
  <nav>Navigation content</nav>
  <main>
    <h1>Test Article</h1>
    <p>This is the main content of the article. It contains useful information about testing.</p>
    <p>Another paragraph with more details about the topic.</p>
  </main>
  <footer>Footer content</footer>
</body>
</html>`;

  const createMockResponse = (
    options: { ok?: boolean; status?: number; text?: string } = {},
  ) => ({
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: jest.fn().mockResolvedValue(options.text ?? mockHtmlResponse),
  });

  beforeEach(async () => {
    mockKbService = {
      addDocument: jest.fn().mockResolvedValue({ id: "doc-1" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlFetchService,
        { provide: KnowledgeBaseService, useValue: mockKbService },
      ],
    }).compile();

    service = module.get<UrlFetchService>(UrlFetchService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();

    mockFetch.mockReset();
  });

  afterEach(() => jest.restoreAllMocks());

  // ==================== fetchUrl ====================

  describe("fetchUrl", () => {
    it("should fetch and parse a URL successfully", async () => {
      mockFetch.mockResolvedValue(createMockResponse());

      const result = await service.fetchUrl("https://example.com/article");

      expect(result.url).toBe("https://example.com/article");
      expect(result.title).toBe("Test Article");
      expect(result.content).toContain("main content");
      expect(result.wordCount).toBeGreaterThan(0);
    });

    it("should extract metadata from HTML", async () => {
      mockFetch.mockResolvedValue(createMockResponse());

      const result = await service.fetchUrl("https://example.com/article");

      expect(result.metadata.author).toBe("John Doe");
      expect(result.metadata.description).toBe(
        "This is a test article about testing",
      );
      expect(result.metadata.siteName).toBe("Test Blog");
      expect(result.metadata.publishDate).toBe("2024-01-15T10:00:00Z");
    });

    it("should throw BadRequestException for invalid URL format", async () => {
      await expect(service.fetchUrl("not-a-valid-url")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException for non-HTTP protocols", async () => {
      await expect(service.fetchUrl("ftp://example.com/file")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when HTTP response is not OK", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ ok: false, status: 404 }),
      );

      await expect(
        service.fetchUrl("https://example.com/notfound"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException with HTTP status in message", async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ ok: false, status: 403 }),
      );

      await expect(
        service.fetchUrl("https://example.com/forbidden"),
      ).rejects.toThrow("HTTP 403");
    });

    it("should throw timeout BadRequestException when request is aborted", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      // Override AbortController to simulate timeout
      jest.spyOn(global, "AbortController").mockImplementation(() => {
        const controller = {
          abort: jest.fn(),
          signal: { aborted: false } as any,
        };
        return controller as any;
      });

      // Mock setTimeout/clearTimeout to immediately abort
      jest.spyOn(global, "setTimeout").mockImplementation((_fn: any) => {
        return 0 as any;
      });

      await expect(
        service.fetchUrl("https://slow-server.example.com"),
      ).rejects.toThrow(BadRequestException);

      jest.restoreAllMocks();
    });

    it("should throw BadRequestException for ENOTFOUND domain error", async () => {
      mockFetch.mockRejectedValue(
        new Error("getaddrinfo ENOTFOUND nonexistent.example.com"),
      );

      await expect(
        service.fetchUrl("https://nonexistent.example.com"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for ECONNREFUSED error", async () => {
      mockFetch.mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:80"),
      );

      await expect(service.fetchUrl("https://localhost")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException with domain not found message for ENOTFOUND", async () => {
      mockFetch.mockRejectedValue(new Error("ENOTFOUND invalid.host"));

      await expect(service.fetchUrl("https://invalid.host")).rejects.toThrow(
        "Domain not found",
      );
    });

    it("should throw BadRequestException with connection refused message for ECONNREFUSED", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.fetchUrl("https://example.com")).rejects.toThrow(
        "Connection refused",
      );
    });

    it("should use hostname as title when title tag is missing", async () => {
      const htmlWithoutTitle =
        "<html><body><main><p>Content here</p></main></body></html>";
      mockFetch.mockResolvedValue(
        createMockResponse({ text: htmlWithoutTitle }),
      );

      const result = await service.fetchUrl("https://example.com/page");

      expect(result.title).toBe("example.com");
    });

    it("should use og:title as fallback when title tag is missing", async () => {
      const htmlWithOgTitle = `<html><head><meta property="og:title" content="OG Title Here"/></head><body><main><p>Content</p></main></body></html>`;
      mockFetch.mockResolvedValue(
        createMockResponse({ text: htmlWithOgTitle }),
      );

      const result = await service.fetchUrl("https://example.com/page");

      expect(result.title).toBe("OG Title Here");
    });

    it("should exclude nav, header and footer from content", async () => {
      mockFetch.mockResolvedValue(createMockResponse());

      const result = await service.fetchUrl("https://example.com/article");

      expect(result.content).not.toContain("Navigation content");
      expect(result.content).not.toContain("Footer content");
    });

    it("should extract content from main tag", async () => {
      mockFetch.mockResolvedValue(createMockResponse());

      const result = await service.fetchUrl("https://example.com/article");

      expect(result.content).toContain("main content of the article");
    });

    it("should count words correctly", async () => {
      const simpleHtml =
        "<html><body><main><p>one two three four five</p></main></body></html>";
      mockFetch.mockResolvedValue(createMockResponse({ text: simpleHtml }));

      const result = await service.fetchUrl("https://example.com/article");

      expect(result.wordCount).toBe(5);
    });

    it("should warn about large content but not throw", async () => {
      const largeHtml =
        "<html><body><main><p>" +
        "word ".repeat(100000) +
        "</p></main></body></html>";
      mockFetch.mockResolvedValue(createMockResponse({ text: largeHtml }));

      jest.spyOn(Logger.prototype, "warn").mockImplementation();

      const result = await service.fetchUrl("https://example.com/large");

      // Should succeed despite large content
      expect(result).toBeDefined();
    });

    it("should use description as content fallback when no main content found", async () => {
      const htmlNoMain = `<html><head><meta name="description" content="Fallback description content"/></head><body></body></html>`;
      mockFetch.mockResolvedValue(createMockResponse({ text: htmlNoMain }));

      const result = await service.fetchUrl("https://example.com/page");

      expect(result.content).toBe("Fallback description content");
    });
  });

  // ==================== importUrl ====================

  describe("importUrl", () => {
    it("should import a URL to a knowledge base", async () => {
      mockFetch.mockResolvedValue(createMockResponse());
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.importUrl(
        "kb-1",
        "https://example.com/article",
      );

      expect(result.id).toBe("doc-1");
      expect(result.title).toBe("Test Article");
      expect(result.url).toBe("https://example.com/article");
    });

    it("should pass fetched content to addDocument", async () => {
      mockFetch.mockResolvedValue(createMockResponse());
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      await service.importUrl("kb-1", "https://example.com/article");

      expect(mockKbService.addDocument).toHaveBeenCalledWith(
        "kb-1",
        expect.objectContaining({
          title: "Test Article",
          sourceType: "URL",
          sourceUrl: "https://example.com/article",
          mimeType: "text/html",
        }),
      );
    });

    it("should propagate BadRequestException from fetchUrl", async () => {
      await expect(service.importUrl("kb-1", "not-a-url")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==================== importUrls ====================

  describe("importUrls", () => {
    it("should import multiple URLs successfully", async () => {
      mockFetch.mockResolvedValue(createMockResponse());
      (mockKbService.addDocument as jest.Mock)
        .mockResolvedValueOnce({ id: "doc-1" })
        .mockResolvedValueOnce({ id: "doc-2" });

      const result = await service.importUrls("kb-1", [
        "https://example.com/page1",
        "https://example.com/page2",
      ]);

      expect(result.success).toBe(2);
      expect(result.documents).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it("should track failed URLs", async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse())
        .mockRejectedValueOnce(new Error("Network error"));
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.importUrls("kb-1", [
        "https://example.com/ok",
        "https://broken.example.com",
      ]);

      expect(result.success).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].url).toBe("https://broken.example.com");
    });

    it("should return empty results for empty URL array", async () => {
      const result = await service.importUrls("kb-1", []);

      expect(result.success).toBe(0);
      expect(result.documents).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });

    it("should continue after one URL fails", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("First URL failed"))
        .mockResolvedValueOnce(createMockResponse());
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-2",
      });

      const result = await service.importUrls("kb-1", [
        "https://fail.example.com",
        "https://example.com/ok",
      ]);

      expect(result.success).toBe(1);
      expect(result.failed).toHaveLength(1);
    });

    it("should include error message in failed entries", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const result = await service.importUrls("kb-1", [
        "https://down.example.com",
      ]);

      expect(result.failed[0].error).toBeTruthy();
    });
  });
});

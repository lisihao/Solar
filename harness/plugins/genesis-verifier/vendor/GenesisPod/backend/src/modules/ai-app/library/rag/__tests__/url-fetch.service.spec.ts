import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { UrlFetchService } from "../services/url-fetch.service";
import { KnowledgeBaseService } from "../services/knowledge-base.service";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("UrlFetchService", () => {
  let service: UrlFetchService;
  let knowledgeBaseService: jest.Mocked<KnowledgeBaseService>;

  beforeEach(async () => {
    const mockKnowledgeBaseService = {
      addDocument: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: "kb-1" }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlFetchService,
        { provide: KnowledgeBaseService, useValue: mockKnowledgeBaseService },
      ],
    }).compile();

    service = module.get<UrlFetchService>(UrlFetchService);
    knowledgeBaseService = module.get(KnowledgeBaseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("fetchUrl", () => {
    it("should throw BadRequestException for invalid URL", async () => {
      await expect(service.fetchUrl("not-a-url")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException for non-HTTP protocols", async () => {
      await expect(service.fetchUrl("ftp://example.com")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException for file:// protocol", async () => {
      await expect(service.fetchUrl("file:///etc/passwd")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should fetch and return content from valid URL", async () => {
      const html = `
        <html>
          <head>
            <title>Test Page Title</title>
            <meta name="description" content="Test description">
            <meta name="author" content="Test Author">
          </head>
          <body>
            <article>
              <p>This is the main content of the test page. It has enough words to be meaningful content.</p>
              <p>Second paragraph with more content to ensure proper extraction works correctly.</p>
            </article>
          </body>
        </html>
      `;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const result = await service.fetchUrl("https://example.com/article");

      expect(result).toHaveProperty("url", "https://example.com/article");
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("content");
      expect(result).toHaveProperty("wordCount");
      expect(result).toHaveProperty("metadata");
    });

    it("should throw BadRequestException when HTTP response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(
        service.fetchUrl("https://example.com/not-found"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle timeout errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("The operation was aborted"));

      await expect(
        service.fetchUrl("https://slow.example.com"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle DNS errors (ENOTFOUND)", async () => {
      mockFetch.mockRejectedValueOnce(
        new Error("getaddrinfo ENOTFOUND example.invalid"),
      );

      await expect(service.fetchUrl("https://example.invalid")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should handle connection refused errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:80"));

      await expect(service.fetchUrl("https://localhost:80")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should extract title from og:title meta tag", async () => {
      const html = `
        <html>
          <head>
            <meta property="og:title" content="OG Title">
          </head>
          <body><p>Content</p></body>
        </html>
      `;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const result = await service.fetchUrl("https://example.com");

      expect(result.title).toBe("OG Title");
    });

    it("should use hostname as fallback title", async () => {
      const html = "<html><body><p>Content</p></body></html>";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(html),
      });

      const result = await service.fetchUrl("https://example.com/page");

      expect(result.title).toBe("example.com");
    });
  });

  describe("importUrls", () => {
    it("should import multiple URLs into knowledge base", async () => {
      const html =
        "<html><head><title>Test</title></head><body><p>Test content with enough words for extraction</p></body></html>";

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(html),
      });
      (knowledgeBaseService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
        title: "Test",
        url: "https://example.com/1",
      });

      const result = await service.importUrls("kb-1", [
        "https://example.com/1",
        "https://example.com/2",
      ]);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("documents");
      expect(result.success).toBe(2);
    });

    it("should handle failed URL fetches gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await service.importUrls("kb-1", [
        "https://example.com/failing",
      ]);

      expect(result.success).toBe(0);
      expect(result.failed.length).toBe(1);
    });

    it("should return empty result for empty URLs array", async () => {
      const result = await service.importUrls("kb-1", []);

      expect(result.success).toBe(0);
      expect(result.failed).toEqual([]);
      expect(result.documents).toEqual([]);
    });

    it("should validate URLs before fetching", async () => {
      const result = await service.importUrls("kb-1", ["not-a-valid-url"]);

      expect(result.success).toBe(0);
      expect(result.failed.length).toBe(1);
    });
  });
});

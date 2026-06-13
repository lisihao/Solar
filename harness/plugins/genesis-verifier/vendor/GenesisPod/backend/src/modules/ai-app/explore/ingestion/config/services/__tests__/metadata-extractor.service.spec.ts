import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { MetadataExtractorService } from "../metadata-extractor.service";

// Mock axios at module level
jest.mock("axios");
import axios from "axios";
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Test suite ────────────────────────────────────────────────────────────────

describe("MetadataExtractorService", () => {
  let service: MetadataExtractorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MetadataExtractorService],
    }).compile();

    service = module.get<MetadataExtractorService>(MetadataExtractorService);
  });

  // ── extractMetadata ──────────────────────────────────────────────────────────

  describe("extractMetadata", () => {
    it("throws BadRequestException for invalid URL", async () => {
      await expect(service.extractMetadata("not-a-url")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns metadata for a valid HTML page", async () => {
      const html = `
        <html lang="en">
          <head>
            <title>Test Page</title>
            <meta property="og:title" content="OG Title" />
            <meta property="og:description" content="OG Description" />
            <meta property="og:image" content="https://example.com/image.jpg" />
            <meta property="og:site_name" content="Example Site" />
            <link rel="canonical" href="https://example.com/test" />
          </head>
          <body>This is some body text with enough words to exceed the minimum threshold for word count calculation.</body>
        </html>
      `;

      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({ data: html });

      const result = await service.extractMetadata("https://example.com/test");

      expect(result).toMatchObject({
        url: "https://example.com/test",
        domain: "example.com",
        title: "OG Title",
        description: "OG Description",
        language: "en",
        contentType: "html",
        siteName: "Example Site",
        canonicalUrl: "https://example.com/test",
      });
    });

    it("falls back to <title> when og:title is absent", async () => {
      const html = `
        <html lang="zh">
          <head><title>Page Title</title></head>
          <body>Some content here</body>
        </html>
      `;

      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({ data: html });

      const result = await service.extractMetadata("https://example.com/page");

      expect(result.title).toBe("Page Title");
      expect(result.language).toBe("zh");
    });

    it("extracts author from meta[name=author]", async () => {
      const html = `
        <html lang="en">
          <head>
            <title>Author Test</title>
            <meta name="author" content="John Doe" />
          </head>
          <body>Body content goes here for testing purposes</body>
        </html>
      `;

      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({ data: html });

      const result = await service.extractMetadata("https://example.com");

      expect(result.authors).toContain("John Doe");
    });

    it("extracts author from JSON-LD structured data", async () => {
      const html = `
        <html lang="en">
          <head>
            <title>JSON-LD Author</title>
            <script type="application/ld+json">
              {"@type": "Article", "author": {"name": "Jane Smith"}}
            </script>
          </head>
          <body>Some body text content here</body>
        </html>
      `;

      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({ data: html });

      const result = await service.extractMetadata("https://example.com");

      expect(result.authors).toContain("Jane Smith");
    });

    it("extracts published date from article:published_time", async () => {
      const html = `
        <html lang="en">
          <head>
            <title>Date Test</title>
            <meta property="article:published_time" content="2024-01-15T12:00:00Z" />
          </head>
          <body>Body content</body>
        </html>
      `;

      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({ data: html });

      const result = await service.extractMetadata("https://example.com");

      expect(result.publishedDate).toBeInstanceOf(Date);
      expect(result.publishedDate?.getFullYear()).toBe(2024);
    });

    it("extracts favicon as absolute URL from relative href", async () => {
      const html = `
        <html lang="en">
          <head>
            <title>Favicon Test</title>
            <link rel="icon" href="/favicon.ico" />
          </head>
          <body>Body content here</body>
        </html>
      `;

      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({ data: html });

      const result = await service.extractMetadata("https://example.com");

      expect(result.favicon).toBe("https://example.com/favicon.ico");
    });

    it("calculates contentHash for HTML pages", async () => {
      const html = `
        <html lang="en">
          <head><title>Hash Test</title></head>
          <body>Some body content to hash</body>
        </html>
      `;

      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({ data: html });

      const result = await service.extractMetadata("https://example.com");

      expect(result.contentHash).toBeDefined();
      expect(typeof result.contentHash).toBe("string");
      expect(result.contentHash!.length).toBeGreaterThan(0);
    });

    it("handles PDF URL by extracting metadata from URL without downloading content", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: {
          "content-type": "application/pdf",
          "content-length": "1048576",
        },
      });

      const result = await service.extractMetadata(
        "https://example.com/report.pdf",
      );

      expect(result.contentType).toBe("application/pdf");
      expect(result.pdfUrl).toBe("https://example.com/report.pdf");
      // Should not call axios.get for PDF
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it("handles PDF URL by extension even without content-type header", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "" },
      });

      const result = await service.extractMetadata(
        "https://example.com/document.pdf",
      );

      expect(result.pdfUrl).toBe("https://example.com/document.pdf");
    });

    it("uses YouTube noembed API for YouTube URLs", async () => {
      // HEAD request first
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      // noembed response
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: {
          title: "My YouTube Video",
          author_name: "Channel Author",
          description: "A great video",
        },
      });

      const result = await service.extractMetadata(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result.domain).toBe("youtube.com");
      expect(result.title).toBe("My YouTube Video");
      expect(result.authors).toContain("Channel Author");
      expect(result.contentType).toBe("video");
      expect(result.siteName).toBe("YouTube");
      expect(result.imageUrl).toContain("dQw4w9WgXcQ");
    });

    it("throws BadRequestException when axios get returns 404", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });

      const axiosError = Object.assign(new Error("Not Found"), {
        isAxiosError: true,
        response: { status: 404 },
        code: undefined,
      });
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);
      mockedAxios.get = jest.fn().mockRejectedValue(axiosError);

      await expect(
        service.extractMetadata("https://example.com/missing"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when axios get returns 403", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });

      const axiosError = Object.assign(new Error("Forbidden"), {
        isAxiosError: true,
        response: { status: 403 },
        code: undefined,
      });
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);
      mockedAxios.get = jest.fn().mockRejectedValue(axiosError);

      await expect(
        service.extractMetadata("https://example.com/protected"),
      ).rejects.toThrow(BadRequestException);
    });

    it("returns pdfUrl undefined for non-PDF binary URLs", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: {
          "content-type": "application/zip",
          "content-length": "2048",
        },
      });

      const result = await service.extractMetadata(
        "https://example.com/archive.zip",
      );

      expect(result.pdfUrl).toBeUndefined();
      expect(result.contentType).toBe("application/zip");
    });
  });

  // ── validateMetadata ─────────────────────────────────────────────────────────

  describe("validateMetadata", () => {
    const baseMetadata = {
      url: "https://example.com",
      domain: "example.com",
      title: "Valid Title",
      language: "en",
      contentType: "html",
    };

    it("returns isValid=true for complete metadata", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        description: "A great description",
        authors: ["Author One"],
        publishedDate: new Date(),
      });

      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("returns isValid=false when title is too short", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        title: "AB",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("标题过短或为空");
    });

    it("returns isValid=false when domain is missing", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        domain: "",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("无法提取域名");
    });

    it("returns isValid=false when URL is missing", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        url: "",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("URL为空");
    });

    it("adds warning when description is missing", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        description: undefined,
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("缺少页面描述");
    });

    it("adds warning when authors are missing", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        authors: undefined,
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("缺少作者信息");
    });

    it("adds warning when publishedDate is missing", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        publishedDate: undefined,
      });

      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("缺少发布日期");
    });

    it("accumulates multiple errors when several fields are invalid", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        title: "",
        domain: "",
        url: "",
      });

      expect(result.isValid).toBe(false);
      expect(result.errors!.length).toBeGreaterThanOrEqual(3);
    });

    it("has no warnings when all optional fields are present", () => {
      const result = service.validateMetadata({
        ...baseMetadata,
        description: "Good description",
        authors: ["Author"],
        publishedDate: new Date(),
      });

      expect(result.warnings).toBeUndefined();
    });
  });

  // ── HEAD request failure handling ────────────────────────────────────────────

  describe("HEAD request failure handling", () => {
    it("proceeds to fetch HTML content when HEAD request fails", async () => {
      const html = `
        <html lang="en">
          <head><title>Fallback Test</title></head>
          <body>Body content here for testing</body>
        </html>
      `;

      mockedAxios.head = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
      mockedAxios.get = jest.fn().mockResolvedValue({ data: html });

      const result = await service.extractMetadata("https://example.com");

      expect(result.title).toBe("Fallback Test");
    });
  });

  // ── binary file detection ─────────────────────────────────────────────────

  describe("binary file detection", () => {
    it("identifies .docx extension as binary without downloading", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" }, // even with misleading content-type
      });

      const result = await service.extractMetadata(
        "https://example.com/report.docx",
      );

      // Should not download page content
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(result.domain).toBe("example.com");
    });

    it("identifies image/* content-type as binary", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "image/jpeg", "content-length": "50000" },
      });

      const result = await service.extractMetadata(
        "https://example.com/photo.jpg",
      );

      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(result.contentType).toBe("image/jpeg");
    });
  });
});

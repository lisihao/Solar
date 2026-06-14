/**
 * MetadataExtractorService supplemental tests
 * Covers: YouTube extraction, PDF/binary files, author extraction,
 *         validateMetadata, error handling edge cases
 */
import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { MetadataExtractorService } from "../metadata-extractor.service";

jest.mock("axios");
import axios from "axios";
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("MetadataExtractorService - supplemental", () => {
  let service: MetadataExtractorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MetadataExtractorService],
    }).compile();

    service = module.get<MetadataExtractorService>(MetadataExtractorService);
  });

  describe("extractMetadata - YouTube URL", () => {
    it("should extract YouTube metadata via noembed API", async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: {
          title: "Amazing AI Video",
          author_name: "TechChannel",
          description: "Learn about AI",
        },
      });

      const result = await service.extractMetadata(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result.title).toBe("Amazing AI Video");
      expect(result.domain).toBe("youtube.com");
      expect(result.contentType).toBe("video");
      expect(result.siteName).toBe("YouTube");
      expect(result.authors).toContain("TechChannel");
    });

    it("should extract YouTube metadata from youtu.be URL", async () => {
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: {
          title: "Short URL Video",
          author_name: "Creator",
        },
      });

      const result = await service.extractMetadata(
        "https://youtu.be/dQw4w9WgXcQ",
      );

      expect(result.title).toBe("Short URL Video");
      expect(result.domain).toBe("youtube.com");
    });

    it("should fall back to HTML extraction when noembed fails", async () => {
      mockedAxios.get = jest
        .fn()
        .mockRejectedValueOnce(new Error("noembed failed"))
        .mockResolvedValueOnce({
          data: `<html>
            <head>
              <meta property="og:title" content="YouTube Fallback Title"/>
              <meta property="og:description" content="Fallback description"/>
              <meta property="og:image" content="https://i.ytimg.com/vi/abc/hqdefault.jpg"/>
            </head>
            <body></body>
          </html>`,
        });

      const result = await service.extractMetadata(
        "https://www.youtube.com/watch?v=abcdef1234",
      );

      expect(result.title).toBeDefined();
      expect(result.domain).toBe("youtube.com");
    });

    it("should throw BadRequestException when both noembed and HTML fallback fail", async () => {
      mockedAxios.get = jest.fn().mockRejectedValue(new Error("All failed"));

      await expect(
        service.extractMetadata("https://www.youtube.com/watch?v=xyz"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("extractMetadata - PDF and binary files", () => {
    it("should handle PDF URL without downloading content", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: {
          "content-type": "application/pdf",
          "content-length": "1048576",
        },
      });

      const result = await service.extractMetadata(
        "https://arxiv.org/pdf/research-paper.pdf",
      );

      expect(result.contentType).toContain("pdf");
      expect(result.domain).toBe("arxiv.org");
      expect(result.pdfUrl).toContain(".pdf");
    });

    it("should handle URL ending in .pdf extension", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "" },
      });

      const result = await service.extractMetadata(
        "https://example.com/report.pdf",
      );

      expect(result.pdfUrl).toContain("report.pdf");
    });

    it("should handle .docx extension as binary", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "application/octet-stream" },
      });

      const result = await service.extractMetadata(
        "https://example.com/document.docx",
      );

      expect(result.domain).toBe("example.com");
      expect(result.pdfUrl).toBeUndefined();
    });

    it("should use HEAD failure fallback and continue to get request", async () => {
      // HEAD fails
      mockedAxios.head = jest.fn().mockRejectedValue(new Error("HEAD failed"));
      // GET succeeds
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html lang="en"><head><title>Test</title></head><body>Content</body></html>`,
      });

      const result = await service.extractMetadata("https://example.com/page");
      expect(result.title).toBeDefined();
    });
  });

  describe("extractMetadata - HTML author extraction", () => {
    it("should extract authors from meta[property=article:author]", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Article</title>
          <meta property="article:author" content="John Doe"/>
          <meta property="article:author" content="Jane Smith"/>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata(
        "https://example.com/article",
      );
      expect(result.authors).toContain("John Doe");
      expect(result.authors).toContain("Jane Smith");
    });

    it("should extract authors from meta[name=author]", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Article</title>
          <meta name="author" content="Bob Johnson"/>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata(
        "https://example.com/article",
      );
      expect(result.authors).toContain("Bob Johnson");
    });

    it("should extract authors from JSON-LD with array format", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Article</title>
          <script type="application/ld+json">
            {"@type": "Article", "author": [{"name": "Alice Author"}, "Bob String"]}
          </script>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata(
        "https://example.com/article",
      );
      expect(result.authors).toContain("Alice Author");
      expect(result.authors).toContain("Bob String");
    });

    it("should extract single author from JSON-LD string", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Article</title>
          <script type="application/ld+json">
            {"@type": "Article", "author": "Single Author"}
          </script>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata(
        "https://example.com/article",
      );
      expect(result.authors).toContain("Single Author");
    });

    it("should extract author from JSON-LD object with name property", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Article</title>
          <script type="application/ld+json">
            {"@type": "Article", "author": {"name": "Named Author"}}
          </script>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata(
        "https://example.com/article",
      );
      expect(result.authors).toContain("Named Author");
    });

    it("should return undefined authors when no author meta present", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head><title>No Author Page</title></head><body>content</body></html>`,
      });

      const result = await service.extractMetadata("https://example.com/page");
      expect(result.authors).toBeUndefined();
    });
  });

  describe("extractMetadata - favicon extraction", () => {
    it("should extract favicon from link[rel=icon]", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Test</title>
          <link rel="icon" href="/favicon.ico"/>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata("https://example.com/page");
      expect(result.favicon).toContain("example.com");
    });

    it("should extract favicon from apple-touch-icon", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Test</title>
          <link rel="apple-touch-icon" href="/apple-touch-icon.png"/>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata("https://example.com/page");
      expect(result.favicon).toContain("example.com");
    });
  });

  describe("extractMetadata - published date", () => {
    it("should extract published date from article:published_time", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Article</title>
          <meta property="article:published_time" content="2024-01-15T10:00:00Z"/>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata(
        "https://example.com/article",
      );
      expect(result.publishedDate).toBeInstanceOf(Date);
    });

    it("should return undefined for invalid date string", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head>
          <title>Article</title>
          <meta property="article:published_time" content="not-a-date"/>
        </head><body>content</body></html>`,
      });

      const result = await service.extractMetadata(
        "https://example.com/article",
      );
      expect(result.publishedDate).toBeUndefined();
    });
  });

  describe("extractMetadata - HTTP error handling", () => {
    it("should throw BadRequestException on 404", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      const error404 = {
        isAxiosError: true,
        response: { status: 404 },
        message: "Not Found",
        code: undefined,
      };
      mockedAxios.get = jest.fn().mockRejectedValue(error404);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(
        service.extractMetadata("https://example.com/missing-page"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException on 403", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      const error403 = {
        isAxiosError: true,
        response: { status: 403 },
        message: "Forbidden",
        code: undefined,
      };
      mockedAxios.get = jest.fn().mockRejectedValue(error403);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(
        service.extractMetadata("https://example.com/forbidden-page"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException on timeout", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      const timeoutError = {
        isAxiosError: true,
        code: "ECONNABORTED",
        message: "Timeout",
        response: undefined,
      };
      mockedAxios.get = jest.fn().mockRejectedValue(timeoutError);
      mockedAxios.isAxiosError = jest.fn().mockReturnValue(true);

      await expect(
        service.extractMetadata("https://example.com/slow-page"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("validateMetadata", () => {
    it("should return valid when all required fields present", () => {
      const metadata = {
        url: "https://example.com/article",
        domain: "example.com",
        title: "Valid Article Title",
        description: "A description",
        authors: ["Author One"],
        publishedDate: new Date(),
        language: "en",
        contentType: "html",
        siteName: "Example",
      };

      const result = service.validateMetadata(metadata);
      expect(result.isValid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should return errors when title is missing", () => {
      const metadata = {
        url: "https://example.com",
        domain: "example.com",
        title: "Ab", // too short
        language: "en",
        contentType: "html",
      };

      const result = service.validateMetadata(metadata);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("标题过短或为空");
    });

    it("should return errors when domain is missing", () => {
      const metadata = {
        url: "https://example.com",
        domain: "",
        title: "Valid Title",
        language: "en",
        contentType: "html",
      };

      const result = service.validateMetadata(metadata);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("无法提取域名");
    });

    it("should return errors when url is missing", () => {
      const metadata = {
        url: "",
        domain: "example.com",
        title: "Valid Title",
        language: "en",
        contentType: "html",
      };

      const result = service.validateMetadata(metadata);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("URL为空");
    });

    it("should return warnings when optional fields missing", () => {
      const metadata = {
        url: "https://example.com",
        domain: "example.com",
        title: "Valid Long Title",
        language: "en",
        contentType: "html",
        // no description, authors, publishedDate
      };

      const result = service.validateMetadata(metadata);
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain("缺少页面描述");
      expect(result.warnings).toContain("缺少作者信息");
      expect(result.warnings).toContain("缺少发布日期");
    });

    it("should return no warnings when all optional fields present", () => {
      const metadata = {
        url: "https://example.com",
        domain: "example.com",
        title: "Complete Article",
        description: "Has a description",
        authors: ["Author"],
        publishedDate: new Date(),
        language: "en",
        contentType: "html",
      };

      const result = service.validateMetadata(metadata);
      expect(result.warnings).toBeUndefined();
    });
  });

  describe("binary file detection", () => {
    it("should detect image content-type as binary", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "image/jpeg" },
      });

      const result = await service.extractMetadata(
        "https://example.com/photo.jpg",
      );
      expect(result.domain).toBe("example.com");
      // Should not throw (binary file path used)
    });

    it("should detect .xlsx extension as binary", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "" },
      });

      const result = await service.extractMetadata(
        "https://example.com/data.xlsx",
      );
      expect(result.domain).toBe("example.com");
    });

    it("should format file size in KB", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: {
          "content-type": "application/pdf",
          "content-length": "51200", // 50KB
        },
      });

      const result = await service.extractMetadata(
        "https://example.com/doc.pdf",
      );
      expect(result.description).toContain("KB");
    });

    it("should format file size in MB", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: {
          "content-type": "application/pdf",
          "content-length": "5242880", // 5MB
        },
      });

      const result = await service.extractMetadata(
        "https://example.com/large.pdf",
      );
      expect(result.description).toContain("MB");
    });

    it("should format file size in GB for large files", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: {
          "content-type": "application/octet-stream",
          "content-length": "2147483648", // 2GB
        },
      });

      const result = await service.extractMetadata(
        "https://example.com/huge.zip",
      );
      expect(result.description).toContain("GB");
    });
  });

  describe("word count detection", () => {
    it("should include wordCount for content with more than 100 words", async () => {
      const longContent = Array(120).fill("word").join(" ");
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head><title>Test</title></head><body>${longContent}</body></html>`,
      });

      const result = await service.extractMetadata(
        "https://example.com/long-article",
      );
      expect(result.wordCount).toBeGreaterThan(100);
    });

    it("should not include wordCount for short content", async () => {
      mockedAxios.head = jest.fn().mockResolvedValue({
        headers: { "content-type": "text/html" },
      });
      mockedAxios.get = jest.fn().mockResolvedValue({
        data: `<html><head><title>Short</title></head><body>Few words</body></html>`,
      });

      const result = await service.extractMetadata("https://example.com/short");
      expect(result.wordCount).toBeUndefined();
    });
  });
});

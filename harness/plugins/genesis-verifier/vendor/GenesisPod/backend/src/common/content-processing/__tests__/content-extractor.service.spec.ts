/**
 * ContentExtractorService Tests
 *
 * Tests cover:
 * - extractFromUrl: YouTube, Bilibili, PDF URL, generic webpage
 * - extractFromFile: text, markdown, JSON, HTML, PDF, SRT/VTT, binary
 * - extractFromImage: Gemini API success and failure paths
 * - extractPdfEnhanced: MinerU path, pdfjs fallback
 * - extractSubtitleText (via extractFromFile)
 * - flattenJson (via extractFromFile with JSON)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { AxiosHeaders, AxiosResponse } from "axios";
import { ContentExtractorService } from "../content-extractor.service";
import { AdvancedExtractorService } from "../advanced-extractor.service";
import { YoutubeService } from "../../../modules/ai-engine/content/fetch/youtube.service";
import { MinerUService } from "../mineru.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAxiosResponse<T>(
  data: T,
  headers: Record<string, string> = {},
): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers: new AxiosHeaders(headers),
    config: { headers: new AxiosHeaders() },
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
describe("ContentExtractorService", () => {
  let service: ContentExtractorService;
  let mockHttpService: jest.Mocked<HttpService>;
  let mockYoutubeService: jest.Mocked<YoutubeService>;
  let mockMinerUService: jest.Mocked<Partial<MinerUService>>;

  beforeEach(async () => {
    mockHttpService = {
      get: jest.fn(),
      post: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    mockYoutubeService = {
      extractVideoId: jest.fn(),
      getTranscript: jest.fn(),
    } as unknown as jest.Mocked<YoutubeService>;

    mockMinerUService = {
      parsePdf: jest.fn(),
      checkAvailability: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentExtractorService,
        {
          provide: AdvancedExtractorService,
          useValue: {
            extract: jest.fn().mockResolvedValue({
              success: true,
              title: "Test",
              textContent: "Extracted content",
              content: "<p>Extracted content</p>",
              excerpt: "",
              byline: "",
              siteName: "",
              length: 17,
              plan: "readability",
              confidence: 80,
            }),
          },
        },
        { provide: HttpService, useValue: mockHttpService },
        { provide: YoutubeService, useValue: mockYoutubeService },
        { provide: MinerUService, useValue: mockMinerUService },
      ],
    }).compile();

    service = module.get<ContentExtractorService>(ContentExtractorService);
  });

  // =========================================================================
  // extractFromUrl – YouTube
  // =========================================================================
  describe("extractFromUrl – YouTube", () => {
    it("extracts subtitles from a YouTube URL", async () => {
      mockYoutubeService.extractVideoId.mockReturnValue("dQw4w9WgXcQ");
      mockYoutubeService.getTranscript.mockResolvedValue({
        title: "Test Video",
        transcript: [{ text: "Hello" }, { text: "world" }],
      } as any);

      const result = await service.extractFromUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).toContain("YouTube Video");
      expect(result).toContain("Test Video");
      expect(result).toContain("Hello world");
    });

    it("returns placeholder when video ID cannot be extracted", async () => {
      mockYoutubeService.extractVideoId.mockReturnValue(null);

      const result = await service.extractFromUrl(
        "https://www.youtube.com/watch?v=invalid",
      );

      expect(result).toContain("[YouTube video:");
    });

    it("falls back to oEmbed when YoutubeService fails", async () => {
      mockYoutubeService.extractVideoId.mockReturnValue("dQw4w9WgXcQ");
      mockYoutubeService.getTranscript.mockRejectedValue(
        new Error("Transcript not available"),
      );

      // oEmbed fallback succeeds
      mockHttpService.get.mockReturnValue(
        of(
          makeAxiosResponse({
            title: "Fallback Title",
            author_name: "Test Author",
          }),
        ),
      );

      const result = await service.extractFromUrl(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      );

      expect(result).toContain("Fallback Title");
    });

    it("returns URL placeholder when all YouTube methods fail", async () => {
      mockYoutubeService.extractVideoId.mockReturnValue("badId");
      mockYoutubeService.getTranscript.mockRejectedValue(new Error("Error"));
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("Network")),
      );

      const result = await service.extractFromUrl("https://youtu.be/badId");

      expect(result).toContain("[YouTube video:");
    });
  });

  // =========================================================================
  // extractFromUrl – Bilibili
  // =========================================================================
  describe("extractFromUrl – Bilibili", () => {
    it("extracts Bilibili video info without subtitles", async () => {
      mockHttpService.get.mockReturnValue(
        of(
          makeAxiosResponse(
            {
              code: 0,
              data: {
                title: "Bilibili Test",
                desc: "Great video",
                owner: { name: "TestOwner" },
                subtitle: { list: [] },
              },
            },
            { "content-type": "application/json" },
          ),
        ),
      );

      const result = await service.extractFromUrl(
        "https://www.bilibili.com/video/BV1xx411c7mD",
      );

      expect(result).toContain("Bilibili Test");
      expect(result).toContain("Great video");
      expect(result).toContain("TestOwner");
    });

    it("extracts Bilibili video with subtitles", async () => {
      mockHttpService.get
        .mockReturnValueOnce(
          of(
            makeAxiosResponse({
              code: 0,
              data: {
                title: "Video with Subs",
                desc: "desc",
                owner: { name: "Author" },
                subtitle: {
                  list: [{ subtitle_url: "https://example.com/subtitle.json" }],
                },
              },
            }),
          ),
        )
        .mockReturnValueOnce(
          of(
            makeAxiosResponse({
              body: [{ content: "Subtitle text here" }],
            }),
          ),
        );

      const result = await service.extractFromUrl(
        "https://www.bilibili.com/video/BV1xx411c7mD",
      );

      expect(result).toContain("Subtitle text here");
    });

    it("returns placeholder when no BV ID found", async () => {
      const result = await service.extractFromUrl(
        "https://www.bilibili.com/video/",
      );

      expect(result).toContain("[Bilibili video:");
    });

    it("returns placeholder on Bilibili API error", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("Network error")),
      );

      const result = await service.extractFromUrl(
        "https://www.bilibili.com/video/BV1xx411c7mD",
      );

      expect(result).toContain("[Bilibili video:");
    });
  });

  // =========================================================================
  // extractFromUrl – PDF URL
  // =========================================================================
  describe("extractFromUrl – PDF URL", () => {
    it("downloads and extracts PDF from URL", async () => {
      // The PDF mock is registered via jest.config.js moduleNameMapper
      mockHttpService.get.mockReturnValue(
        of(
          makeAxiosResponse(Buffer.from("fake pdf data"), {
            "content-type": "application/pdf",
          }),
        ),
      );

      const result = await service.extractFromUrl(
        "https://example.com/doc.pdf",
      );

      expect(typeof result).toBe("string");
    });

    it("returns error message when PDF download fails", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("404 Not Found")),
      );

      const result = await service.extractFromUrl(
        "https://example.com/missing.pdf",
      );

      expect(result).toContain("[Failed to download PDF");
    });
  });

  // =========================================================================
  // extractFromUrl – Generic webpage
  // =========================================================================
  describe("extractFromUrl – Webpage", () => {
    it("extracts HTML content with Readability", async () => {
      const html = `<html><head><title>Test Page</title></head><body><article><p>Article content here.</p></article></body></html>`;

      mockHttpService.get.mockReturnValue(
        of(
          makeAxiosResponse(Buffer.from(html), { "content-type": "text/html" }),
        ),
      );

      const result = await service.extractFromUrl(
        "https://example.com/article",
      );

      expect(typeof result).toBe("string");
      // Readability might produce output or fall back to plain strip
      expect(result.length).toBeGreaterThan(0);
    });

    it("falls back to HTML tag stripping when Readability produces nothing", async () => {
      // Minimal HTML that Readability might reject
      const html = "<html><body><p>Some text</p></body></html>";

      mockHttpService.get.mockReturnValue(
        of(
          makeAxiosResponse(Buffer.from(html), { "content-type": "text/html" }),
        ),
      );

      const result = await service.extractFromUrl(
        "https://example.com/minimal",
      );
      expect(typeof result).toBe("string");
    });

    it("returns error message when URL fetch fails", async () => {
      mockHttpService.get.mockReturnValue(
        throwError(() => new Error("ECONNREFUSED")),
      );

      const result = await service.extractFromUrl(
        "https://unreachable.example.com",
      );

      expect(result).toContain("[Unable to fetch content from:");
    });

    it("handles PDF returned from a webpage URL (content-type detection)", async () => {
      mockHttpService.get.mockReturnValue(
        of(
          makeAxiosResponse(Buffer.from("fake pdf"), {
            "content-type": "application/pdf",
          }),
        ),
      );

      const result = await service.extractFromUrl("https://example.com/file");
      expect(typeof result).toBe("string");
    });
  });

  // =========================================================================
  // extractFromFile
  // =========================================================================
  describe("extractFromFile", () => {
    it("extracts plain text files", async () => {
      const buffer = Buffer.from("Hello, world!");
      const result = await service.extractFromFile(
        buffer,
        "text/plain",
        "file.txt",
      );
      expect(result).toBe("Hello, world!");
    });

    it("extracts markdown files by MIME type", async () => {
      const buffer = Buffer.from("# Heading\nSome text");
      const result = await service.extractFromFile(
        buffer,
        "text/markdown",
        "readme.md",
      );
      expect(result).toBe("# Heading\nSome text");
    });

    it("extracts .txt by extension", async () => {
      const buffer = Buffer.from("text content");
      const result = await service.extractFromFile(
        buffer,
        "application/octet-stream",
        "notes.txt",
      );
      expect(result).toBe("text content");
    });

    it("extracts .md by extension", async () => {
      const buffer = Buffer.from("## Section");
      const result = await service.extractFromFile(
        buffer,
        "application/octet-stream",
        "README.md",
      );
      expect(result).toBe("## Section");
    });

    it("extracts and flattens valid JSON files", async () => {
      const json = { name: "Alice", age: 30, hobbies: ["reading", "coding"] };
      const buffer = Buffer.from(JSON.stringify(json));
      const result = await service.extractFromFile(
        buffer,
        "application/json",
        "data.json",
      );
      expect(result).toContain("Alice");
      expect(result).toContain("30");
    });

    it("returns raw text when JSON is invalid", async () => {
      const buffer = Buffer.from("not valid json {");
      const result = await service.extractFromFile(
        buffer,
        "application/json",
        "bad.json",
      );
      expect(result).toBe("not valid json {");
    });

    it("extracts .json by extension", async () => {
      const buffer = Buffer.from('{"key":"value"}');
      const result = await service.extractFromFile(
        buffer,
        "application/octet-stream",
        "config.json",
      );
      expect(result).toContain("value");
    });

    it("extracts HTML files by MIME type", async () => {
      const html = `<html><head><title>Title</title></head><body><p>Body text</p></body></html>`;
      const buffer = Buffer.from(html);
      const result = await service.extractFromFile(
        buffer,
        "text/html",
        "page.html",
      );
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("extracts HTML files by .html extension", async () => {
      const html = `<html><body><p>content</p></body></html>`;
      const buffer = Buffer.from(html);
      const result = await service.extractFromFile(
        buffer,
        "application/octet-stream",
        "index.html",
      );
      expect(typeof result).toBe("string");
    });

    it("extracts PDF files by MIME type", async () => {
      const buffer = Buffer.from("fake pdf content");
      const result = await service.extractFromFile(
        buffer,
        "application/pdf",
        "report.pdf",
      );
      expect(typeof result).toBe("string");
    });

    it("extracts SRT subtitle files", async () => {
      const srt = `1\n00:00:01,000 --> 00:00:03,000\nHello world\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line`;
      const buffer = Buffer.from(srt);
      // Use application/octet-stream so it bypasses the text/plain branch and hits the .srt branch
      const result = await service.extractFromFile(
        buffer,
        "application/octet-stream",
        "subtitles.srt",
      );
      expect(result).toContain("Hello world");
      expect(result).toContain("Second line");
      // Timestamps should be stripped
      expect(result).not.toContain("00:00:01,000");
    });

    it("extracts VTT subtitle files by MIME type", async () => {
      const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nCaption text`;
      const buffer = Buffer.from(vtt);
      const result = await service.extractFromFile(
        buffer,
        "text/vtt",
        "captions.vtt",
      );
      expect(result).toContain("Caption text");
      expect(result).not.toContain("WEBVTT");
    });

    it("falls back to utf-8 for unknown binary file", async () => {
      const buffer = Buffer.from("some binary content");
      const result = await service.extractFromFile(
        buffer,
        "application/octet-stream",
        "unknown.bin",
      );
      expect(typeof result).toBe("string");
    });
  });

  // =========================================================================
  // extractFromImage
  // =========================================================================
  describe("extractFromImage", () => {
    it("extracts text from image using Gemini API", async () => {
      mockHttpService.post.mockReturnValue(
        of(
          makeAxiosResponse({
            candidates: [
              {
                content: {
                  parts: [{ text: "The image shows a cat on a sofa." }],
                },
              },
            ],
          }),
        ),
      );

      const result = await service.extractFromImage(
        "data:image/jpeg;base64,/9j/...",
        "fake-api-key",
      );

      expect(result).toContain("cat on a sofa");
    });

    it("returns unable-to-extract when candidates are empty", async () => {
      mockHttpService.post.mockReturnValue(
        of(makeAxiosResponse({ candidates: [] })),
      );

      const result = await service.extractFromImage("base64data", "key");
      expect(result).toBe("[Unable to extract content from image]");
    });

    it("returns image-analysis-failed on HTTP error", async () => {
      mockHttpService.post.mockReturnValue(
        throwError(() => new Error("403 Forbidden")),
      );

      const result = await service.extractFromImage("base64data", "bad-key");
      expect(result).toBe("[Image analysis failed]");
    });
  });

  // =========================================================================
  // extractPdfEnhanced
  // =========================================================================
  describe("extractPdfEnhanced", () => {
    it("uses MinerU when available and returns enhanced result", async () => {
      mockMinerUService.checkAvailability!.mockResolvedValue({
        available: true,
        mode: "api",
        message: "OK",
      });
      mockMinerUService.parsePdf!.mockResolvedValue({
        success: true,
        content: "# MinerU Content\nParsed text",
        metadata: {
          pageCount: 3,
          wordCount: 50,
          hasImages: true,
          hasTables: false,
          hasFormulas: false,
          parseTime: 1000,
          method: "api",
        },
        images: [{ index: 0, base64: "abc", caption: "Fig 1", page: 1 }],
        tables: [],
      });

      const buffer = Buffer.from("fake pdf");
      const result = await service.extractPdfEnhanced(buffer);

      expect(result.method).toBe("mineru");
      expect(result.content).toContain("MinerU Content");
      expect(result.metadata.hasImages).toBe(true);
    });

    it("falls back to pdfjs when MinerU fails", async () => {
      mockMinerUService.checkAvailability!.mockResolvedValue({
        available: true,
        mode: "api",
        message: "OK",
      });
      mockMinerUService.parsePdf!.mockResolvedValue({
        success: false,
        content: "",
        metadata: {
          pageCount: 0,
          wordCount: 0,
          hasImages: false,
          hasTables: false,
          hasFormulas: false,
          parseTime: 0,
          method: "api",
        },
        error: "MinerU error",
      });

      const buffer = Buffer.from("fake pdf");
      const result = await service.extractPdfEnhanced(buffer);

      // Should fall back to pdfjs mock
      expect(result.method).toBe("pdfjs");
    });

    it("uses pdfjs directly when MinerU not available", async () => {
      mockMinerUService.checkAvailability!.mockResolvedValue({
        available: false,
        mode: "none",
        message: "Not available",
      });

      const buffer = Buffer.from("fake pdf");
      const result = await service.extractPdfEnhanced(buffer);

      expect(result.method).toBe("pdfjs");
    });

    it("uses pdfjs when useMinerU is false", async () => {
      const buffer = Buffer.from("fake pdf");
      const result = await service.extractPdfEnhanced(buffer, {
        useMinerU: false,
      });

      expect(result.method).toBe("pdfjs");
      expect(mockMinerUService.parsePdf).not.toHaveBeenCalled();
    });
  });
});

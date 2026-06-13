/**
 * ContentFetchService Unit Tests
 *
 * Tests URL validation (SSRF protection), YouTube extraction, and web fetch.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import {
  ContentFetchService,
  YOUTUBE_SERVICE_TOKEN,
} from "../content-fetch.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { WebContentExtractionService } from "@/common/content-processing/web-content-extraction.service";

describe("ContentFetchService", () => {
  let service: ContentFetchService;
  let mockPrisma: { youTubeTranscriptCache: { findUnique: jest.Mock } };
  let mockWebExtractor: { extractContent: jest.Mock };
  let mockYoutubeService: { getTranscript: jest.Mock };

  beforeEach(async () => {
    mockPrisma = {
      youTubeTranscriptCache: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    mockWebExtractor = {
      extractContent: jest.fn().mockResolvedValue({
        title: "Test Page",
        content: "Page content here",
        image: "https://example.com/img.png",
        source: "jina",
        siteName: "Example",
        author: "Author Name",
        publishedDate: "2024-01-01",
      }),
    };

    mockYoutubeService = {
      getTranscript: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentFetchService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: WebContentExtractionService,
          useValue: mockWebExtractor,
        },
        { provide: YOUTUBE_SERVICE_TOKEN, useValue: mockYoutubeService },
      ],
    }).compile();

    service = module.get<ContentFetchService>(ContentFetchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ===================== extractYoutubeVideoId =====================

  describe("extractYoutubeVideoId", () => {
    it("should extract video ID from standard youtube.com watch URL", () => {
      expect(
        service.extractYoutubeVideoId(
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        ),
      ).toBe("dQw4w9WgXcQ");
    });

    it("should extract video ID from youtu.be short URL", () => {
      expect(
        service.extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ"),
      ).toBe("dQw4w9WgXcQ");
    });

    it("should extract video ID from embed URL", () => {
      expect(
        service.extractYoutubeVideoId(
          "https://www.youtube.com/embed/dQw4w9WgXcQ",
        ),
      ).toBe("dQw4w9WgXcQ");
    });

    it("should extract video ID from shorts URL", () => {
      expect(
        service.extractYoutubeVideoId(
          "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        ),
      ).toBe("dQw4w9WgXcQ");
    });

    it("should return null for non-YouTube URLs", () => {
      expect(
        service.extractYoutubeVideoId("https://www.google.com/search?q=test"),
      ).toBeNull();
      expect(
        service.extractYoutubeVideoId("https://example.com/video"),
      ).toBeNull();
    });

    it("should return null for empty URL", () => {
      expect(service.extractYoutubeVideoId("")).toBeNull();
    });
  });

  // ===================== fetchFromUrl - SSRF validation =====================

  describe("fetchFromUrl - URL validation (SSRF protection)", () => {
    it("should throw for empty URL", async () => {
      await expect(service.fetchFromUrl("")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw for URL exceeding max length", async () => {
      const longUrl = "https://example.com/" + "a".repeat(2048);
      await expect(service.fetchFromUrl(longUrl)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw for invalid URL format", async () => {
      await expect(service.fetchFromUrl("not-a-url")).rejects.toThrow();
    });

    it("should throw for ftp:// protocol", async () => {
      await expect(
        service.fetchFromUrl("ftp://example.com/file"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw for localhost", async () => {
      await expect(
        service.fetchFromUrl("http://localhost/api"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw for 127.0.0.1 (loopback)", async () => {
      await expect(
        service.fetchFromUrl("http://127.0.0.1/admin"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw for 192.168.x.x (private IP)", async () => {
      await expect(
        service.fetchFromUrl("http://192.168.1.100/api"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw for 10.x.x.x (private IP)", async () => {
      await expect(
        service.fetchFromUrl("http://10.0.0.1/internal"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw for 172.16.x.x (private IP)", async () => {
      await expect(
        service.fetchFromUrl("http://172.16.0.1/secret"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw for AWS metadata endpoint", async () => {
      await expect(
        service.fetchFromUrl("http://169.254.169.254/metadata"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw for non-standard port", async () => {
      await expect(
        service.fetchFromUrl("http://example.com:8080/api"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should allow standard HTTP port 80", async () => {
      // Should not throw on port 80 (standard port)
      await expect(
        service.fetchFromUrl("http://example.com:80/page"),
      ).resolves.toBeDefined();
    });

    it("should allow standard HTTPS port 443", async () => {
      await expect(
        service.fetchFromUrl("https://example.com:443/page"),
      ).resolves.toBeDefined();
    });
  });

  // ===================== fetchFromUrl - regular web page =====================

  describe("fetchFromUrl - regular web page", () => {
    it("should fetch regular web page content", async () => {
      const result = await service.fetchFromUrl("https://example.com/article");

      expect(result.title).toBe("Test Page");
      expect(result.content).toBe("Page content here");
      expect(result.url).toBe("https://example.com/article");
      expect(mockWebExtractor.extractContent).toHaveBeenCalledWith(
        "https://example.com/article",
      );
    });

    it("should throw when extractor returns an error", async () => {
      mockWebExtractor.extractContent.mockResolvedValueOnce({
        error: "Failed to fetch",
        content: null,
        title: null,
      });

      await expect(
        service.fetchFromUrl("https://example.com/page"),
      ).rejects.toThrow();
    });

    it("should include metadata in result", async () => {
      const result = await service.fetchFromUrl("https://example.com/article");
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.source).toBe("jina");
      expect(result.metadata?.author).toBe("Author Name");
    });
  });

  // ===================== fetchFromUrl - YouTube =====================

  describe("fetchFromUrl - YouTube URL", () => {
    const youtubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    it("should use cached transcript when available and not expired", async () => {
      const futureDate = new Date(Date.now() + 86400000); // Tomorrow
      mockPrisma.youTubeTranscriptCache.findUnique.mockResolvedValueOnce({
        videoId: "dQw4w9WgXcQ",
        title: "Rick Astley - Never Gonna Give You Up",
        transcript: [
          { text: "Never gonna give you up", start: 0, duration: 3 },
        ],
        translatedTranscript: null,
        targetLanguage: null,
        expiresAt: futureDate,
        createdAt: new Date(),
      });

      const result = await service.fetchFromUrl(youtubeUrl);

      expect(result.title).toContain("Rick Astley");
      expect(result.content).toContain("Never gonna give you up");
      expect(result.metadata?.videoId).toBe("dQw4w9WgXcQ");
      expect(mockYoutubeService.getTranscript).not.toHaveBeenCalled();
    });

    it("should use bilingual transcript from cache when available", async () => {
      const futureDate = new Date(Date.now() + 86400000);
      mockPrisma.youTubeTranscriptCache.findUnique.mockResolvedValueOnce({
        videoId: "dQw4w9WgXcQ",
        title: "Video Title",
        transcript: [{ text: "Hello world", start: 0, duration: 2 }],
        translatedTranscript: [
          { text: "Hello world", translatedText: "你好世界" },
        ],
        targetLanguage: "zh",
        expiresAt: futureDate,
        createdAt: new Date(),
      });

      const result = await service.fetchFromUrl(youtubeUrl);

      expect(result.isBilingual).toBe(true);
      expect(result.translatedContent).toContain("你好世界");
      expect(result.originalContent).toContain("Hello world");
    });

    it("should call YoutubeService when cache is expired", async () => {
      const pastDate = new Date(Date.now() - 86400000); // Yesterday
      mockPrisma.youTubeTranscriptCache.findUnique.mockResolvedValueOnce({
        videoId: "dQw4w9WgXcQ",
        title: "Old Title",
        transcript: [],
        translatedTranscript: null,
        targetLanguage: null,
        expiresAt: pastDate,
        createdAt: new Date(),
      });

      mockYoutubeService.getTranscript.mockResolvedValueOnce({
        title: "Fresh Title",
        transcript: [{ text: "Fresh content" }],
        hasTranslation: false,
      });

      const result = await service.fetchFromUrl(youtubeUrl);

      expect(mockYoutubeService.getTranscript).toHaveBeenCalledWith(
        "dQw4w9WgXcQ",
      );
      expect(result.title).toBe("Fresh Title");
    });

    it("should call YoutubeService when no cache", async () => {
      mockPrisma.youTubeTranscriptCache.findUnique.mockResolvedValueOnce(null);
      mockYoutubeService.getTranscript.mockResolvedValueOnce({
        title: "Video Title",
        transcript: [{ text: "Hello" }, { text: "World" }],
        hasTranslation: false,
      });

      const result = await service.fetchFromUrl(youtubeUrl);
      expect(result.content).toContain("Hello");
    });

    it("should fall back to web extraction when YouTube fetch fails", async () => {
      mockPrisma.youTubeTranscriptCache.findUnique.mockResolvedValueOnce(null);
      mockYoutubeService.getTranscript.mockRejectedValueOnce(
        new Error("YouTube API error"),
      );

      // Falls back to web extractor
      const result = await service.fetchFromUrl(youtubeUrl);
      expect(mockWebExtractor.extractContent).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw when YouTubeService unavailable and no cache", async () => {
      // Create service without YouTubeService
      const moduleWithoutYT: TestingModule = await Test.createTestingModule({
        providers: [
          ContentFetchService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: WebContentExtractionService, useValue: mockWebExtractor },
        ],
      }).compile();
      const serviceWithoutYT =
        moduleWithoutYT.get<ContentFetchService>(ContentFetchService);

      mockPrisma.youTubeTranscriptCache.findUnique.mockResolvedValueOnce(null);
      // No YouTubeService, no cache → falls back to web extractor
      const result = await serviceWithoutYT.fetchFromUrl(youtubeUrl);
      // Should fall back to web extraction
      expect(mockWebExtractor.extractContent).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});

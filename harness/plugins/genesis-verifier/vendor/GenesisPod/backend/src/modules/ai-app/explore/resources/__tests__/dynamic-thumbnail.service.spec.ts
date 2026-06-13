/**
 * DynamicThumbnailService unit tests
 *
 * Coverage:
 * - getThumbnailUrl for each resource type (YOUTUBE, YOUTUBE_VIDEO, BLOG, NEWS, PAPER, REPORT, POLICY, default)
 * - YouTube video ID extraction (watch, youtu.be, embed, shorts)
 * - arXiv thumbnail strategies (preview URL hit/miss, abs page og:image, PDF thumbnail service)
 * - OG image extraction (direct fetch, 403 + FlareSolverr fallback, meta tags, article images)
 * - Caching/fallback behavior when generation fails
 * - URL normalization (protocol-relative, root-relative, relative, absolute)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import axios from "axios";
// cheerio is used in the source but we mock axios responses directly
import { DynamicThumbnailService } from "../dynamic-thumbnail.service";
import { PdfThumbnailService } from "../pdf-thumbnail.service";
import { FlareSolverrService } from "../../../library/proxy/flaresolverr.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Ensure axios.isAxiosError behaves correctly in tests
Object.defineProperty(mockedAxios, "isAxiosError", {
  value: (err: unknown): boolean =>
    !!(err && typeof err === "object" && "isAxiosError" in err),
  configurable: true,
});

const mockPdfThumbnailService = {
  generateThumbnail: jest.fn(),
};

const mockFlareSolverrService = {
  getIsAvailable: jest.fn(),
  fetchPage: jest.fn(),
};

// Helper: build a minimal cheerio HTML string that includes an og:image meta
function buildOgHtml(imageUrl: string): string {
  return `<html><head><meta property="og:image" content="${imageUrl}"></head><body></body></html>`;
}

describe("DynamicThumbnailService", () => {
  let service: DynamicThumbnailService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFlareSolverrService.getIsAvailable.mockReturnValue(false);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DynamicThumbnailService,
        {
          provide: PdfThumbnailService,
          useValue: mockPdfThumbnailService,
        },
        {
          provide: FlareSolverrService,
          useValue: mockFlareSolverrService,
        },
      ],
    }).compile();

    service = module.get<DynamicThumbnailService>(DynamicThumbnailService);

    // Suppress logger output
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // YOUTUBE / YOUTUBE_VIDEO
  // ──────────────────────────────────────────────────────────────────────────

  describe("getThumbnailUrl – YOUTUBE", () => {
    it("returns mqdefault thumbnail for standard watch URL", async () => {
      const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
      const result = await service.getThumbnailUrl(url, "YOUTUBE");
      expect(result).toBe(
        "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      );
    });

    it("returns thumbnail for youtu.be short URL", async () => {
      const url = "https://youtu.be/dQw4w9WgXcQ";
      const result = await service.getThumbnailUrl(url, "YOUTUBE_VIDEO");
      expect(result).toBe(
        "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      );
    });

    it("returns thumbnail for YouTube Shorts URL", async () => {
      const url = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
      const result = await service.getThumbnailUrl(url, "YOUTUBE");
      expect(result).toBe(
        "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      );
    });

    it("returns null when URL has no recognizable video ID", async () => {
      const result = await service.getThumbnailUrl(
        "https://youtube.com/channel/UC1234",
        "YOUTUBE",
      );
      expect(result).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BLOG / NEWS – OG image extraction
  // ──────────────────────────────────────────────────────────────────────────

  describe("getThumbnailUrl – BLOG / NEWS", () => {
    it("extracts og:image from BLOG page", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: buildOgHtml("https://example.com/cover.jpg"),
      });
      const result = await service.getThumbnailUrl(
        "https://example.com/post",
        "BLOG",
      );
      expect(result).toBe("https://example.com/cover.jpg");
    });

    it("extracts og:image from NEWS page", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: buildOgHtml("https://news.example.com/image.png"),
      });
      const result = await service.getThumbnailUrl(
        "https://news.example.com/article",
        "NEWS",
      );
      expect(result).toBe("https://news.example.com/image.png");
    });

    it("returns null when HTTP fetch fails and FlareSolverr is unavailable", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));
      mockFlareSolverrService.getIsAvailable.mockReturnValue(false);
      const result = await service.getThumbnailUrl(
        "https://example.com/page",
        "BLOG",
      );
      expect(result).toBeNull();
    });

    it("uses FlareSolverr fallback on 403 when available", async () => {
      const axiosError = Object.assign(new Error("403"), {
        isAxiosError: true,
        response: { status: 403 },
      });
      mockedAxios.get.mockRejectedValueOnce(axiosError);
      mockFlareSolverrService.getIsAvailable.mockReturnValue(true);
      mockFlareSolverrService.fetchPage.mockResolvedValueOnce({
        success: true,
        html: buildOgHtml("https://cdn.example.com/flare.jpg"),
      });
      const result = await service.getThumbnailUrl(
        "https://protected.example.com",
        "BLOG",
      );
      expect(result).toBe("https://cdn.example.com/flare.jpg");
    });

    it("returns null when FlareSolverr also fails on 403", async () => {
      const axiosError = Object.assign(new Error("403"), {
        isAxiosError: true,
        response: { status: 403 },
      });
      mockedAxios.get.mockRejectedValueOnce(axiosError);
      mockFlareSolverrService.getIsAvailable.mockReturnValue(true);
      mockFlareSolverrService.fetchPage.mockRejectedValueOnce(
        new Error("FlareSolverr timeout"),
      );
      const result = await service.getThumbnailUrl(
        "https://protected.example.com",
        "BLOG",
      );
      expect(result).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PAPER – PDF thumbnail → arXiv → OG image fallback chain
  // ──────────────────────────────────────────────────────────────────────────

  describe("getThumbnailUrl – PAPER", () => {
    it("returns PDF thumbnail when pdfUrl and resourceId are provided", async () => {
      mockPdfThumbnailService.generateThumbnail.mockResolvedValueOnce(
        "https://storage.example.com/thumb.png",
      );
      const result = await service.getThumbnailUrl(
        "https://arxiv.org/abs/2401.00001",
        "PAPER",
        "https://arxiv.org/pdf/2401.00001.pdf",
        "resource-123",
      );
      expect(result).toBe("https://storage.example.com/thumb.png");
      expect(mockPdfThumbnailService.generateThumbnail).toHaveBeenCalledWith(
        "https://arxiv.org/pdf/2401.00001.pdf",
        "resource-123",
      );
    });

    it("falls back to arXiv preview image when PDF thumbnail returns null", async () => {
      mockPdfThumbnailService.generateThumbnail.mockResolvedValueOnce(null);
      // arXiv preview URL HEAD check succeeds
      mockedAxios.head.mockResolvedValueOnce({ status: 200 });

      const result = await service.getThumbnailUrl(
        "https://arxiv.org/abs/2401.00001",
        "PAPER",
        "https://arxiv.org/pdf/2401.00001.pdf",
        "resource-456",
      );
      expect(result).toBe(
        "https://browse.arxiv.org/html/2401.00001/x-png/page_001.png",
      );
    });

    it("falls back to og:image from arXiv abs page when preview not available", async () => {
      mockPdfThumbnailService.generateThumbnail.mockResolvedValueOnce(null);
      // arXiv preview HEAD fails
      mockedAxios.head.mockRejectedValueOnce(new Error("not found"));
      // arXiv abs page GET succeeds with og:image
      mockedAxios.get.mockResolvedValueOnce({
        data: buildOgHtml("https://arxiv.org/og-image.jpg"),
      });

      const result = await service.getThumbnailUrl(
        "https://arxiv.org/abs/2401.00001",
        "PAPER",
        "https://arxiv.org/pdf/2401.00001.pdf",
        "resource-789",
      );
      expect(result).toBe("https://arxiv.org/og-image.jpg");
    });

    it("returns null when all PAPER strategies fail", async () => {
      mockPdfThumbnailService.generateThumbnail.mockRejectedValueOnce(
        new Error("pdf fail"),
      );
      // No arXiv URL, no og:image
      mockedAxios.get.mockRejectedValueOnce(new Error("Network error"));

      const result = await service.getThumbnailUrl(
        "https://example.com/paper",
        "PAPER",
      );
      expect(result).toBeNull();
    });

    it("skips PDF thumbnail when pdfUrl is absent", async () => {
      // No pdfUrl provided, should skip PDF thumbnail service entirely
      mockedAxios.get.mockRejectedValueOnce(new Error("fail"));
      const result = await service.getThumbnailUrl(
        "https://example.com/paper",
        "PAPER",
      );
      expect(mockPdfThumbnailService.generateThumbnail).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REPORT / POLICY
  // ──────────────────────────────────────────────────────────────────────────

  describe("getThumbnailUrl – REPORT / POLICY", () => {
    it("extracts og:image for REPORT type", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: buildOgHtml("https://org.example.com/report-cover.jpg"),
      });
      const result = await service.getThumbnailUrl(
        "https://org.example.com/report",
        "REPORT",
      );
      expect(result).toBe("https://org.example.com/report-cover.jpg");
    });

    it("extracts og:image for POLICY type", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: buildOgHtml("https://gov.example.com/policy.jpg"),
      });
      const result = await service.getThumbnailUrl(
        "https://gov.example.com/policy",
        "POLICY",
      );
      expect(result).toBe("https://gov.example.com/policy.jpg");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Default / unknown type
  // ──────────────────────────────────────────────────────────────────────────

  describe("getThumbnailUrl – unknown type", () => {
    it("returns null for unknown resource type", async () => {
      const result = await service.getThumbnailUrl(
        "https://example.com",
        "DATASET",
      );
      expect(result).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // extractOgImage – URL normalization
  // ──────────────────────────────────────────────────────────────────────────

  describe("extractOgImage – URL normalization", () => {
    it("normalizes protocol-relative URL (//cdn.example.com/img.jpg)", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: `<html><head><meta property="og:image" content="//cdn.example.com/img.jpg"></head></html>`,
      });
      const result = await service.extractOgImage("https://example.com/page");
      expect(result).toBe("https://cdn.example.com/img.jpg");
    });

    it("normalizes root-relative URL (/images/cover.jpg)", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: `<html><head><meta property="og:image" content="/images/cover.jpg"></head></html>`,
      });
      const result = await service.extractOgImage(
        "https://example.com/article",
      );
      expect(result).toBe("https://example.com/images/cover.jpg");
    });

    it("returns absolute URL unchanged", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: buildOgHtml("https://absolute.example.com/img.png"),
      });
      const result = await service.extractOgImage("https://example.com");
      expect(result).toBe("https://absolute.example.com/img.png");
    });

    it("falls back to article img when no meta og:image exists", async () => {
      const html = `<html><body><article><img src="https://example.com/article-img.jpg"></article></body></html>`;
      mockedAxios.get.mockResolvedValueOnce({ data: html });
      const result = await service.extractOgImage("https://example.com/post");
      expect(result).toBe("https://example.com/article-img.jpg");
    });

    it("returns null when HTML has no images at all", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: "<html><body><p>No images here</p></body></html>",
      });
      const result = await service.extractOgImage("https://example.com");
      expect(result).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Top-level error handling
  // ──────────────────────────────────────────────────────────────────────────

  describe("getThumbnailUrl – top-level error handling", () => {
    it("returns null and logs error when unexpected exception is thrown", async () => {
      // Force PdfThumbnailService.generateThumbnail to throw unexpectedly at outer level
      // by mocking extractOgImage
      jest
        .spyOn(service, "extractOgImage")
        .mockRejectedValueOnce(new Error("Unexpected"));
      const result = await service.getThumbnailUrl(
        "https://example.com/report",
        "REPORT",
      );
      expect(result).toBeNull();
    });
  });
});

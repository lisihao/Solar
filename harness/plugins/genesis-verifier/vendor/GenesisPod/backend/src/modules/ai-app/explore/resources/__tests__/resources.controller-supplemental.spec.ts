/**
 * ResourcesController Supplemental Unit Tests
 *
 * Covers uncovered branches:
 * - searchSuggestions: query too short
 * - extractThumbnail: no url, PAPER type with resourceId, cache success/failure
 * - generateArxivPdfPreview: no arxivId, null thumbnailUrl
 * - enrichResource: resource not found
 * - enrichResourceStructured: resource not found
 * - uploadThumbnail: no file, resource not found, upload failure
 * - generateThumbnail: resource not found, no pdfUrl, already has thumbnail, generation fails
 * - uploadFile: no type, invalid type, file too large, bad extension, bad MIME, upload failure
 * - getUserUpvotes: no userId
 * - importFromUrl: missing url/type, invalid type, service throws
 * - toggleUpvote: no userId
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ResourcesController } from "../resources.controller";
import { ResourcesService } from "../resources.service";
import { AIEnrichmentService } from "../ai-enrichment.service";
import { PdfThumbnailService } from "../pdf-thumbnail.service";
import { DynamicThumbnailService } from "../dynamic-thumbnail.service";
import { ResourceHealthCheckScheduler } from "../resource-health-check.scheduler";
import { ObjectStorageService } from "../../../../platform/facade";

// Guards: mock JwtAuthGuard + AdminGuard to always pass in unit tests
jest.mock("../../../../../common/guards/jwt-auth.guard", () => ({
  JwtAuthGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockReturnValue(true),
  })),
}));
jest.mock("../../../../../common/guards/admin.guard", () => ({
  AdminGuard: jest.fn().mockImplementation(() => ({
    canActivate: jest.fn().mockReturnValue(true),
  })),
}));

const mockResourcesService = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  searchSuggestions: jest.fn(),
  getStats: jest.fn(),
  cleanupDuplicates: jest.fn(),
  toggleUpvote: jest.fn(),
  getUserUpvotedResourceIds: jest.fn(),
  importFromUrl: jest.fn(),
  translateResource: jest.fn(),
};

const mockAIEnrichmentService = {
  checkHealth: jest.fn(),
  enrichResource: jest.fn(),
  enrichResourceWithStructured: jest.fn(),
};

const mockPdfThumbnailService = {
  generateThumbnail: jest.fn(),
};

const mockDynamicThumbnailService = {
  getThumbnailUrl: jest.fn(),
};

const mockR2StorageService = {
  uploadBuffer: jest.fn(),
};

const mockHealthScheduler = {
  scanAndMarkBroken: jest
    .fn()
    .mockResolvedValue({ scanned: 0, broken: 0, capped: false }),
};

function makeAuthRequest(userId?: string): {
  user?: { id: string };
} {
  return userId ? { user: { id: userId } } : {};
}

function makeFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "test.pdf",
    encoding: "7bit",
    mimetype: "application/pdf",
    size: 1024,
    buffer: Buffer.from("test"),
    destination: "",
    filename: "test.pdf",
    path: "",
    stream: null as unknown as Express.Multer.File["stream"],
    ...overrides,
  };
}

describe("ResourcesController (supplemental)", () => {
  let controller: ResourcesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "error").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "warn").mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, "debug").mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourcesController],
      providers: [
        { provide: ResourcesService, useValue: mockResourcesService },
        { provide: AIEnrichmentService, useValue: mockAIEnrichmentService },
        { provide: PdfThumbnailService, useValue: mockPdfThumbnailService },
        {
          provide: DynamicThumbnailService,
          useValue: mockDynamicThumbnailService,
        },
        { provide: ObjectStorageService, useValue: mockR2StorageService },
        {
          provide: ResourceHealthCheckScheduler,
          useValue: mockHealthScheduler,
        },
      ],
    }).compile();

    controller = module.get<ResourcesController>(ResourcesController);
  });

  // ==================== searchSuggestions ====================

  describe("searchSuggestions", () => {
    it("returns empty suggestions when query is empty string", async () => {
      const result = await controller.searchSuggestions("", 5);
      expect(result).toEqual({ suggestions: [] });
      expect(mockResourcesService.searchSuggestions).not.toHaveBeenCalled();
    });

    it("returns empty suggestions when query is a single character", async () => {
      const result = await controller.searchSuggestions("a", 5);
      expect(result).toEqual({ suggestions: [] });
      expect(mockResourcesService.searchSuggestions).not.toHaveBeenCalled();
    });

    it("returns empty suggestions when query is only spaces", async () => {
      const result = await controller.searchSuggestions("  ", 5);
      expect(result).toEqual({ suggestions: [] });
      expect(mockResourcesService.searchSuggestions).not.toHaveBeenCalled();
    });

    it("calls service and returns suggestions for valid query", async () => {
      const suggestions = ["AI research", "AI tools"];
      mockResourcesService.searchSuggestions.mockResolvedValue(suggestions);
      const result = await controller.searchSuggestions("AI", 5);
      expect(result).toEqual({ suggestions });
      expect(mockResourcesService.searchSuggestions).toHaveBeenCalledWith(
        "AI",
        5,
      );
    });
  });

  // ==================== extractThumbnail ====================

  describe("extractThumbnail", () => {
    it("throws 400 when url is not provided", async () => {
      await expect(
        controller.extractThumbnail("", "BLOG", undefined),
      ).rejects.toThrow(
        new HttpException("URL is required", HttpStatus.BAD_REQUEST),
      );
    });

    it("extracts thumbnail for non-PAPER type without resourceId", async () => {
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(
        "https://cdn.example.com/thumb.jpg",
      );
      const result = await controller.extractThumbnail(
        "https://example.com",
        "BLOG",
        undefined,
      );
      expect(result).toEqual({
        thumbnailUrl: "https://cdn.example.com/thumb.jpg",
        sourceUrl: "https://example.com",
        type: "BLOG",
      });
      expect(mockResourcesService.findOne).not.toHaveBeenCalled();
    });

    it("fetches pdfUrl for PAPER type with resourceId", async () => {
      mockResourcesService.findOne.mockResolvedValue({
        id: "res-1",
        pdfUrl: "https://arxiv.org/pdf/2301.pdf",
      });
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(
        "https://cdn.example.com/thumb.jpg",
      );
      const result = await controller.extractThumbnail(
        "https://arxiv.org/abs/2301",
        "PAPER",
        "res-1",
      );
      expect(mockResourcesService.findOne).toHaveBeenCalledWith("res-1");
      expect(mockDynamicThumbnailService.getThumbnailUrl).toHaveBeenCalledWith(
        "https://arxiv.org/abs/2301",
        "PAPER",
        "https://arxiv.org/pdf/2301.pdf",
        "res-1",
      );
      expect(result.thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
    });

    it("continues without pdfUrl when findOne throws for PAPER type", async () => {
      mockResourcesService.findOne.mockRejectedValue(new Error("not found"));
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(
        "https://cdn.example.com/thumb.jpg",
      );
      const result = await controller.extractThumbnail(
        "https://arxiv.org/abs/2301",
        "PAPER",
        "res-missing",
      );
      expect(result.thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
    });

    it("caches thumbnail to database when thumbnailUrl returned with resourceId", async () => {
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(
        "https://cdn.example.com/thumb.jpg",
      );
      mockResourcesService.update.mockResolvedValue({});
      await controller.extractThumbnail("https://example.com", "BLOG", "res-1");
      expect(mockResourcesService.update).toHaveBeenCalledWith("res-1", {
        thumbnailUrl: "https://cdn.example.com/thumb.jpg",
      });
    });

    it("logs warn but still returns thumbnail when cache update fails", async () => {
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(
        "https://cdn.example.com/thumb.jpg",
      );
      mockResourcesService.update.mockRejectedValue(new Error("db error"));
      const result = await controller.extractThumbnail(
        "https://example.com",
        "BLOG",
        "res-1",
      );
      expect(result.thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
    });

    it("does not cache when thumbnailUrl is null", async () => {
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(null);
      const result = await controller.extractThumbnail(
        "https://example.com",
        "BLOG",
        "res-1",
      );
      expect(result.thumbnailUrl).toBeNull();
      expect(mockResourcesService.update).not.toHaveBeenCalled();
    });

    it("does not cache when resourceId is not provided", async () => {
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(
        "https://cdn.example.com/thumb.jpg",
      );
      await controller.extractThumbnail(
        "https://example.com",
        "BLOG",
        undefined,
      );
      expect(mockResourcesService.update).not.toHaveBeenCalled();
    });
  });

  // ==================== generateArxivPdfPreview ====================

  describe("generateArxivPdfPreview", () => {
    it("throws 400 when arxivId is missing", async () => {
      await expect(controller.generateArxivPdfPreview("")).rejects.toThrow(
        new HttpException("arxivId is required", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 400 when pdfThumbnailService returns null", async () => {
      mockPdfThumbnailService.generateThumbnail.mockResolvedValue(null);
      await expect(
        controller.generateArxivPdfPreview("2301.07041"),
      ).rejects.toThrow();
    });

    it("returns thumbnailUrl on success", async () => {
      mockPdfThumbnailService.generateThumbnail.mockResolvedValue(
        "https://cdn.example.com/preview.jpg",
      );
      const result = await controller.generateArxivPdfPreview("2301.07041");
      expect(result).toEqual({
        thumbnailUrl: "https://cdn.example.com/preview.jpg",
        arxivId: "2301.07041",
      });
      expect(mockPdfThumbnailService.generateThumbnail).toHaveBeenCalledWith(
        "https://arxiv.org/pdf/2301.07041.pdf",
        "2301.07041",
      );
    });
  });

  // ==================== enrichResource ====================

  describe("enrichResource", () => {
    it("throws 404 when resource not found", async () => {
      mockResourcesService.findOne.mockResolvedValue(null);
      await expect(controller.enrichResource("res-404")).rejects.toThrow(
        new HttpException("Resource res-404 not found", HttpStatus.NOT_FOUND),
      );
    });

    it("enriches and updates resource", async () => {
      const resource = {
        id: "res-1",
        title: "Test",
        abstract: "Abstract",
        content: "Content",
        sourceUrl: "https://example.com",
      };
      const enrichment = {
        aiSummary: "Summary",
        keyInsights: ["insight1"],
        primaryCategory: "AI",
        autoTags: ["tag1"],
        difficultyLevel: "INTERMEDIATE",
      };
      const updated = { ...resource, aiSummary: enrichment.aiSummary };
      mockResourcesService.findOne.mockResolvedValue(resource);
      mockAIEnrichmentService.enrichResource.mockResolvedValue(enrichment);
      mockResourcesService.update.mockResolvedValue(updated);
      const result = await controller.enrichResource("res-1");
      expect(mockAIEnrichmentService.enrichResource).toHaveBeenCalledWith({
        title: "Test",
        abstract: "Abstract",
        content: "Content",
        sourceUrl: "https://example.com",
      });
      expect(result).toEqual(updated);
    });
  });

  // ==================== enrichResourceStructured ====================

  describe("enrichResourceStructured", () => {
    it("throws 404 when resource not found", async () => {
      mockResourcesService.findOne.mockResolvedValue(null);
      await expect(
        controller.enrichResourceStructured("res-404"),
      ).rejects.toThrow(
        new HttpException("Resource res-404 not found", HttpStatus.NOT_FOUND),
      );
    });

    it("returns enriched structured data", async () => {
      const resource = {
        id: "res-1",
        title: "Paper",
        abstract: null,
        content: null,
        sourceUrl: "https://paper.example.com",
        type: "PAPER",
      };
      const enrichment = {
        aiSummary: "AI Summary",
        keyInsights: [],
        primaryCategory: "ML",
        autoTags: [],
        difficultyLevel: "ADVANCED",
        structuredAISummary: { sections: [] },
      };
      mockResourcesService.findOne.mockResolvedValue(resource);
      mockAIEnrichmentService.enrichResourceWithStructured.mockResolvedValue(
        enrichment,
      );
      mockResourcesService.update.mockResolvedValue({
        ...resource,
        aiSummary: "AI Summary",
      });

      const result = await controller.enrichResourceStructured("res-1");
      expect(
        mockAIEnrichmentService.enrichResourceWithStructured,
      ).toHaveBeenCalledWith(
        {
          title: "Paper",
          abstract: undefined,
          content: undefined,
          sourceUrl: "https://paper.example.com",
          type: "PAPER",
        },
        "PAPER",
      );
      expect(result._structuredAISummary).toEqual({ sections: [] });
    });
  });

  // ==================== uploadThumbnail ====================

  describe("uploadThumbnail", () => {
    it("throws 400 when no file provided", async () => {
      await expect(
        controller.uploadThumbnail(
          "res-1",
          null as unknown as Express.Multer.File,
        ),
      ).rejects.toThrow(
        new HttpException("No file uploaded", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 404 when resource not found", async () => {
      mockResourcesService.findOne.mockResolvedValue(null);
      const file = makeFile();
      await expect(controller.uploadThumbnail("res-404", file)).rejects.toThrow(
        new HttpException("Resource res-404 not found", HttpStatus.NOT_FOUND),
      );
    });

    it("throws 500 when upload fails", async () => {
      mockResourcesService.findOne.mockResolvedValue({ id: "res-1" });
      mockR2StorageService.uploadBuffer.mockResolvedValue({
        success: false,
        error: "S3 error",
      });
      const file = makeFile({
        originalname: "thumb.png",
        mimetype: "image/png",
      });
      await expect(controller.uploadThumbnail("res-1", file)).rejects.toThrow(
        new HttpException(
          "Failed to upload thumbnail: S3 error",
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });

    it("uploads thumbnail and returns result", async () => {
      mockResourcesService.findOne.mockResolvedValue({ id: "res-1" });
      mockR2StorageService.uploadBuffer.mockResolvedValue({
        success: true,
        url: "https://cdn.example.com/thumbnails/res-1.png",
        key: "thumbnails/res-1.png",
      });
      mockResourcesService.update.mockResolvedValue({
        id: "res-1",
        thumbnailUrl: "https://cdn.example.com/thumbnails/res-1.png",
      });
      const file = makeFile({
        originalname: "thumb.png",
        mimetype: "image/png",
      });
      const result = await controller.uploadThumbnail("res-1", file);
      expect(result.message).toBe("Thumbnail uploaded successfully");
      expect(result.thumbnailUrl).toBe(
        "https://cdn.example.com/thumbnails/res-1.png",
      );
    });
  });

  // ==================== generateThumbnail ====================

  describe("generateThumbnail", () => {
    it("throws 404 when resource not found", async () => {
      mockResourcesService.findOne.mockResolvedValue(null);
      await expect(controller.generateThumbnail("res-404")).rejects.toThrow(
        new HttpException("Resource res-404 not found", HttpStatus.NOT_FOUND),
      );
    });

    it("throws 400 when resource has no pdfUrl", async () => {
      mockResourcesService.findOne.mockResolvedValue({
        id: "res-1",
        pdfUrl: null,
        thumbnailUrl: null,
      });
      await expect(controller.generateThumbnail("res-1")).rejects.toThrow(
        new HttpException(
          "Resource res-1 does not have a PDF URL",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it("returns existing thumbnail without re-generating", async () => {
      const resource = {
        id: "res-1",
        pdfUrl: "https://pdf.example.com/file.pdf",
        thumbnailUrl: "https://cdn.example.com/existing.jpg",
      };
      mockResourcesService.findOne.mockResolvedValue(resource);
      const result = await controller.generateThumbnail("res-1");
      expect(result.message).toBe("Thumbnail already exists");
      expect(result.thumbnailUrl).toBe("https://cdn.example.com/existing.jpg");
      expect(mockPdfThumbnailService.generateThumbnail).not.toHaveBeenCalled();
    });

    it("throws 500 when thumbnail generation returns null", async () => {
      mockResourcesService.findOne.mockResolvedValue({
        id: "res-1",
        pdfUrl: "https://pdf.example.com/file.pdf",
        thumbnailUrl: null,
      });
      mockPdfThumbnailService.generateThumbnail.mockResolvedValue(null);
      await expect(controller.generateThumbnail("res-1")).rejects.toThrow(
        new HttpException(
          "Failed to generate thumbnail for resource res-1",
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );
    });

    it("generates thumbnail and updates resource", async () => {
      const resource = {
        id: "res-1",
        pdfUrl: "https://pdf.example.com/file.pdf",
        thumbnailUrl: null,
      };
      const thumbUrl = "https://cdn.example.com/res-1.jpg";
      mockResourcesService.findOne.mockResolvedValue(resource);
      mockPdfThumbnailService.generateThumbnail.mockResolvedValue(thumbUrl);
      mockResourcesService.update.mockResolvedValue({
        ...resource,
        thumbnailUrl: thumbUrl,
      });
      const result = await controller.generateThumbnail("res-1");
      expect(result.message).toBe("Thumbnail generated successfully");
      expect(result.thumbnailUrl).toBe(thumbUrl);
    });
  });

  // ==================== uploadFile ====================

  describe("uploadFile", () => {
    it("throws 400 when no type provided", async () => {
      const file = makeFile();
      await expect(controller.uploadFile(file, "")).rejects.toThrow(
        new HttpException("Resource type is required", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 400 when invalid resource type", async () => {
      const file = makeFile();
      await expect(controller.uploadFile(file, "UNKNOWN_TYPE")).rejects.toThrow(
        HttpException,
      );
    });

    it("throws 400 when file size exceeds limit for PAPER type", async () => {
      const largeSizeBytes = 55 * 1024 * 1024; // 55MB > 50MB limit
      const file = makeFile({
        size: largeSizeBytes,
        originalname: "paper.pdf",
      });
      await expect(controller.uploadFile(file, "PAPER")).rejects.toThrow(
        HttpException,
      );
    });

    it("throws 400 when file extension is invalid for type", async () => {
      const file = makeFile({ originalname: "paper.docx", size: 1024 });
      await expect(controller.uploadFile(file, "PAPER")).rejects.toThrow(
        HttpException,
      );
    });

    it("throws 400 when MIME type is invalid", async () => {
      // Valid extension but mismatched MIME
      const file = makeFile({
        originalname: "paper.pdf",
        mimetype: "text/html",
        size: 1024,
      });
      await expect(controller.uploadFile(file, "PAPER")).rejects.toThrow(
        HttpException,
      );
    });

    it("throws 500 when upload fails", async () => {
      const file = makeFile({
        originalname: "paper.pdf",
        mimetype: "application/pdf",
        size: 1024,
      });
      mockR2StorageService.uploadBuffer.mockResolvedValue({
        success: false,
        error: "S3 down",
      });
      await expect(controller.uploadFile(file, "PAPER")).rejects.toThrow(
        HttpException,
      );
    });

    it("uploads PAPER file successfully", async () => {
      const file = makeFile({
        originalname: "paper.pdf",
        mimetype: "application/pdf",
        size: 1024,
      });
      mockR2StorageService.uploadBuffer.mockResolvedValue({
        success: true,
        url: "https://cdn.example.com/uploads/paper.pdf",
        key: "uploads/paper.pdf",
      });
      const result = await controller.uploadFile(file, "PAPER");
      expect(result.message).toBe("File uploaded successfully");
      expect(result.file.url).toBe("https://cdn.example.com/uploads/paper.pdf");
      expect(result.file.type).toBe("PAPER");
    });

    it("uploads NEWS image file successfully", async () => {
      const file = makeFile({
        originalname: "cover.jpg",
        mimetype: "image/jpeg",
        size: 1024,
      });
      mockR2StorageService.uploadBuffer.mockResolvedValue({
        success: true,
        url: "https://cdn.example.com/uploads/cover.jpg",
        key: "uploads/cover.jpg",
      });
      const result = await controller.uploadFile(file, "NEWS");
      expect(result.message).toBe("File uploaded successfully");
    });

    it("throws 400 for PROJECT file with invalid extension", async () => {
      const file = makeFile({
        originalname: "project.rar",
        mimetype: "application/rar",
        size: 1024,
      });
      await expect(controller.uploadFile(file, "PROJECT")).rejects.toThrow(
        HttpException,
      );
    });
  });

  // ==================== getUserUpvotes ====================

  describe("getUserUpvotes", () => {
    it("throws 401 when user is not authenticated", async () => {
      await expect(
        controller.getUserUpvotes(
          makeAuthRequest() as Parameters<typeof controller.getUserUpvotes>[0],
        ),
      ).rejects.toThrow(
        new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED),
      );
    });

    it("returns upvoted resource IDs for authenticated user", async () => {
      mockResourcesService.getUserUpvotedResourceIds.mockResolvedValue([
        "res-1",
        "res-2",
      ]);
      const req = makeAuthRequest("user-123") as Parameters<
        typeof controller.getUserUpvotes
      >[0];
      const result = await controller.getUserUpvotes(req);
      expect(result).toEqual({ resourceIds: ["res-1", "res-2"] });
      expect(
        mockResourcesService.getUserUpvotedResourceIds,
      ).toHaveBeenCalledWith("user-123");
    });
  });

  // ==================== toggleUpvote ====================

  describe("toggleUpvote", () => {
    it("throws 401 when user is not authenticated", async () => {
      await expect(
        controller.toggleUpvote(
          "res-1",
          makeAuthRequest() as Parameters<typeof controller.toggleUpvote>[1],
        ),
      ).rejects.toThrow(
        new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED),
      );
    });

    it("toggles upvote for authenticated user", async () => {
      const upvoteResult = { upvoted: true, upvoteCount: 10 };
      mockResourcesService.toggleUpvote.mockResolvedValue(upvoteResult);
      const req = makeAuthRequest("user-123") as Parameters<
        typeof controller.toggleUpvote
      >[1];
      const result = await controller.toggleUpvote("res-1", req);
      expect(result).toEqual(upvoteResult);
      expect(mockResourcesService.toggleUpvote).toHaveBeenCalledWith(
        "res-1",
        "user-123",
      );
    });
  });

  // ==================== importFromUrl ====================

  describe("importFromUrl", () => {
    it("throws 400 when url is missing", async () => {
      await expect(
        controller.importFromUrl({ url: "", type: "BLOG" }),
      ).rejects.toThrow(
        new HttpException("URL and type are required", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 400 when type is missing", async () => {
      await expect(
        controller.importFromUrl({ url: "https://example.com", type: "" }),
      ).rejects.toThrow(
        new HttpException("URL and type are required", HttpStatus.BAD_REQUEST),
      );
    });

    it("throws 400 when type is invalid", async () => {
      await expect(
        controller.importFromUrl({
          url: "https://example.com",
          type: "INVALID_TYPE",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("returns imported resource on success", async () => {
      const resource = {
        id: "res-new",
        title: "Blog Post",
        sourceUrl: "https://example.com",
      };
      mockResourcesService.importFromUrl.mockResolvedValue(resource);
      const result = await controller.importFromUrl({
        url: "https://example.com",
        type: "BLOG",
      });
      expect(result.message).toBe("URL imported successfully");
      expect(result.resource).toEqual(resource);
    });

    it("throws 500 when importFromUrl service throws", async () => {
      mockResourcesService.importFromUrl.mockRejectedValue(
        new Error("Import failed"),
      );
      await expect(
        controller.importFromUrl({ url: "https://example.com", type: "BLOG" }),
      ).rejects.toThrow(HttpException);
    });

    it("accepts all valid types", async () => {
      const resource = { id: "res-new", title: "Paper" };
      mockResourcesService.importFromUrl.mockResolvedValue(resource);
      const validTypes = [
        "PAPER",
        "BLOG",
        "REPORT",
        "NEWS",
        "YOUTUBE_VIDEO",
        "POLICY",
      ];
      for (const type of validTypes) {
        const result = await controller.importFromUrl({
          url: "https://example.com",
          type,
        });
        expect(result.resource).toEqual(resource);
      }
    });
  });

  // ==================== cleanupDuplicates ====================

  describe("cleanupDuplicates", () => {
    it("calls service and returns message", async () => {
      mockResourcesService.cleanupDuplicates.mockResolvedValue({
        deleted: 5,
        kept: 10,
      });
      const result = await controller.cleanupDuplicates("YOUTUBE_VIDEO");
      expect(result.message).toBe("Cleaned up 5 duplicate resources");
      expect(result.deleted).toBe(5);
    });
  });

  // ==================== checkAIHealth ====================

  describe("checkAIHealth", () => {
    it("returns ok when AI service is healthy", async () => {
      mockAIEnrichmentService.checkHealth.mockResolvedValue(true);
      const result = await controller.checkAIHealth();
      expect(result.status).toBe("ok");
      expect(result.aiServiceAvailable).toBe(true);
    });

    it("returns error when AI service is unhealthy", async () => {
      mockAIEnrichmentService.checkHealth.mockResolvedValue(false);
      const result = await controller.checkAIHealth();
      expect(result.status).toBe("error");
      expect(result.aiServiceAvailable).toBe(false);
    });
  });
});

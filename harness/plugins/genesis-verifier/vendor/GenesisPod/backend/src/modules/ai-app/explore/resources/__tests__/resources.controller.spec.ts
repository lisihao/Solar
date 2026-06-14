import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ResourcesController } from "../resources.controller";
import { ResourcesService } from "../resources.service";
import { AIEnrichmentService } from "../ai-enrichment.service";
import { PdfThumbnailService } from "../pdf-thumbnail.service";
import { DynamicThumbnailService } from "../dynamic-thumbnail.service";
import { ResourceHealthCheckScheduler } from "../resource-health-check.scheduler";
import { ObjectStorageService } from "../../../../platform/storage/object-store/object-storage.service";
import { ThrottlerModule } from "@nestjs/throttler";

// Guard mock – allow all requests through in tests
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
  importFromUrl: jest.fn(),
  searchSuggestions: jest.fn(),
  getStats: jest.fn(),
  toggleUpvote: jest.fn(),
  getUserUpvotedResourceIds: jest.fn(),
  cleanupDuplicates: jest.fn(),
  cleanupBrokenResources: jest.fn(),
  translateResource: jest.fn(),
};

const mockHealthScheduler = {
  scanAndMarkBroken: jest
    .fn()
    .mockResolvedValue({ scanned: 0, broken: 0, capped: false }),
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

describe("ResourcesController", () => {
  let controller: ResourcesController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
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

  // ─── findAll ─────────────────────────────────────────────────────

  describe("findAll", () => {
    it("delegates to resourcesService with query params", async () => {
      const mockResult = { items: [], total: 0 };
      mockResourcesService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll(
        0,
        20,
        "PAPER",
        "AI",
        "ML",
        "publishedAt",
        "desc",
      );

      expect(mockResourcesService.findAll).toHaveBeenCalledWith({
        skip: 0,
        take: 20,
        type: "PAPER",
        category: "AI",
        search: "ML",
        sortBy: "publishedAt",
        sortOrder: "desc",
      });
      expect(result).toBe(mockResult);
    });

    it("passes undefined optional params when not supplied", async () => {
      mockResourcesService.findAll.mockResolvedValue({ items: [], total: 0 });

      await controller.findAll(
        0,
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(mockResourcesService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ type: undefined, category: undefined }),
      );
    });
  });

  // ─── searchSuggestions ───────────────────────────────────────────

  describe("searchSuggestions", () => {
    it("returns suggestions from service", async () => {
      mockResourcesService.searchSuggestions.mockResolvedValue(["AI", "AGI"]);

      const result = await controller.searchSuggestions("AI", 5);

      expect(result).toEqual({ suggestions: ["AI", "AGI"] });
      expect(mockResourcesService.searchSuggestions).toHaveBeenCalledWith(
        "AI",
        5,
      );
    });

    it("returns empty suggestions for query shorter than 2 chars", async () => {
      const result = await controller.searchSuggestions("A", 5);
      expect(result).toEqual({ suggestions: [] });
      expect(mockResourcesService.searchSuggestions).not.toHaveBeenCalled();
    });

    it("returns empty suggestions for empty query", async () => {
      const result = await controller.searchSuggestions("", 5);
      expect(result).toEqual({ suggestions: [] });
    });
  });

  // ─── getStats ────────────────────────────────────────────────────

  describe("getStats", () => {
    it("delegates to resourcesService.getStats", async () => {
      const stats = { total: 42, byType: {} };
      mockResourcesService.getStats.mockResolvedValue(stats);

      const result = await controller.getStats();
      expect(result).toBe(stats);
      expect(mockResourcesService.getStats).toHaveBeenCalledTimes(1);
    });
  });

  // ─── checkAIHealth ───────────────────────────────────────────────

  describe("checkAIHealth", () => {
    it("returns ok status when AI service is healthy", async () => {
      mockAIEnrichmentService.checkHealth.mockResolvedValue(true);

      const result = await controller.checkAIHealth();
      expect(result).toEqual({ status: "ok", aiServiceAvailable: true });
    });

    it("returns error status when AI service is down", async () => {
      mockAIEnrichmentService.checkHealth.mockResolvedValue(false);

      const result = await controller.checkAIHealth();
      expect(result).toEqual({ status: "error", aiServiceAvailable: false });
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────

  describe("findOne", () => {
    it("delegates to resourcesService.findOne with id", async () => {
      const resource = { id: "res1", title: "Test" };
      mockResourcesService.findOne.mockResolvedValue(resource);

      const result = await controller.findOne("res1");
      expect(result).toBe(resource);
      expect(mockResourcesService.findOne).toHaveBeenCalledWith("res1");
    });
  });

  // ─── create ──────────────────────────────────────────────────────

  describe("create", () => {
    it("delegates to resourcesService.create", async () => {
      const dto = { title: "New Resource", type: "BLOG" } as any;
      const created = { id: "new1", ...dto };
      mockResourcesService.create.mockResolvedValue(created);

      const result = await controller.create(dto);
      expect(result).toBe(created);
      expect(mockResourcesService.create).toHaveBeenCalledWith(dto);
    });
  });

  // ─── update ──────────────────────────────────────────────────────

  describe("update", () => {
    it("delegates to resourcesService.update with id and dto", async () => {
      const dto = { title: "Updated" } as any;
      const updated = { id: "res1", title: "Updated" };
      mockResourcesService.update.mockResolvedValue(updated);

      const result = await controller.update("res1", dto);
      expect(result).toBe(updated);
      expect(mockResourcesService.update).toHaveBeenCalledWith("res1", dto);
    });
  });

  // ─── remove ──────────────────────────────────────────────────────

  describe("remove", () => {
    it("delegates to resourcesService.remove", async () => {
      mockResourcesService.remove.mockResolvedValue({ deleted: true });

      const result = await controller.remove("res1");
      expect(result).toEqual({ deleted: true });
      expect(mockResourcesService.remove).toHaveBeenCalledWith("res1");
    });
  });

  // ─── importFromUrl ───────────────────────────────────────────────

  describe("importFromUrl", () => {
    it("imports resource from valid URL and type", async () => {
      const resource = { id: "imported1", title: "Paper" };
      mockResourcesService.importFromUrl.mockResolvedValue(resource);

      const result = await controller.importFromUrl({
        url: "https://arxiv.org/abs/1234.5678",
        type: "PAPER",
      });

      expect(result).toEqual({
        message: "URL imported successfully",
        resource,
      });
      expect(mockResourcesService.importFromUrl).toHaveBeenCalledWith(
        "https://arxiv.org/abs/1234.5678",
        "PAPER",
      );
    });

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

    it("throws 400 for invalid resource type", async () => {
      await expect(
        controller.importFromUrl({
          url: "https://example.com",
          type: "INVALID",
        }),
      ).rejects.toThrow(HttpException);
    });

    it("throws 500 when service throws an error", async () => {
      mockResourcesService.importFromUrl.mockRejectedValue(
        new Error("Import failed"),
      );

      await expect(
        controller.importFromUrl({ url: "https://example.com", type: "BLOG" }),
      ).rejects.toThrow(HttpException);
    });

    it("accepts all valid resource types", async () => {
      mockResourcesService.importFromUrl.mockResolvedValue({ id: "x" });
      const validTypes = [
        "PAPER",
        "BLOG",
        "REPORT",
        "NEWS",
        "YOUTUBE_VIDEO",
        "POLICY",
      ];

      for (const type of validTypes) {
        await expect(
          controller.importFromUrl({ url: "https://example.com", type }),
        ).resolves.toBeTruthy();
      }
    });
  });

  // ─── toggleUpvote ─────────────────────────────────────────────────

  describe("toggleUpvote", () => {
    it("toggles upvote for authenticated user", async () => {
      const result = { upvoted: true, upvoteCount: 5 };
      mockResourcesService.toggleUpvote.mockResolvedValue(result);

      const mockReq = { user: { id: "user1" } } as any;
      const res = await controller.toggleUpvote("res1", mockReq);

      expect(res).toBe(result);
      expect(mockResourcesService.toggleUpvote).toHaveBeenCalledWith(
        "res1",
        "user1",
      );
    });

    it("throws 401 when user is not authenticated", async () => {
      const mockReq = { user: undefined } as any;

      await expect(controller.toggleUpvote("res1", mockReq)).rejects.toThrow(
        new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED),
      );
    });
  });

  // ─── getUserUpvotes ───────────────────────────────────────────────

  describe("getUserUpvotes", () => {
    it("returns user upvoted resource IDs", async () => {
      mockResourcesService.getUserUpvotedResourceIds.mockResolvedValue([
        "r1",
        "r2",
      ]);

      const mockReq = { user: { id: "user1" } } as any;
      const result = await controller.getUserUpvotes(mockReq);

      expect(result).toEqual({ resourceIds: ["r1", "r2"] });
    });

    it("throws 401 when user is missing", async () => {
      const mockReq = { user: undefined } as any;

      await expect(controller.getUserUpvotes(mockReq)).rejects.toThrow(
        new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED),
      );
    });
  });

  // ─── extractThumbnail ─────────────────────────────────────────────

  describe("extractThumbnail", () => {
    it("returns thumbnail URL for a valid resource URL", async () => {
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(
        "https://cdn.example.com/thumb.jpg",
      );
      mockResourcesService.update.mockResolvedValue({});

      const result = await controller.extractThumbnail(
        "https://example.com/blog",
        "BLOG",
        "res1",
      );

      expect(result.thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
      expect(result.sourceUrl).toBe("https://example.com/blog");
    });

    it("throws 400 when url is missing", async () => {
      await expect(
        controller.extractThumbnail("", "BLOG", undefined),
      ).rejects.toThrow(
        new HttpException("URL is required", HttpStatus.BAD_REQUEST),
      );
    });

    it("does not update resource when thumbnailUrl is null", async () => {
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(null);

      const result = await controller.extractThumbnail(
        "https://example.com",
        "BLOG",
        "res1",
      );

      expect(result.thumbnailUrl).toBeNull();
      expect(mockResourcesService.update).not.toHaveBeenCalled();
    });

    it("fetches pdfUrl for PAPER type with resourceId", async () => {
      mockResourcesService.findOne.mockResolvedValue({
        id: "res1",
        pdfUrl: "https://arxiv.org/pdf/1234.pdf",
      });
      mockDynamicThumbnailService.getThumbnailUrl.mockResolvedValue(
        "https://thumb.jpg",
      );
      mockResourcesService.update.mockResolvedValue({});

      await controller.extractThumbnail(
        "https://arxiv.org/abs/1234",
        "PAPER",
        "res1",
      );

      expect(mockDynamicThumbnailService.getThumbnailUrl).toHaveBeenCalledWith(
        "https://arxiv.org/abs/1234",
        "PAPER",
        "https://arxiv.org/pdf/1234.pdf",
        "res1",
      );
    });
  });

  // ─── generateArxivPdfPreview ──────────────────────────────────────

  describe("generateArxivPdfPreview", () => {
    it("generates PDF preview for valid arxivId", async () => {
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

    it("throws 400 when arxivId is missing", async () => {
      await expect(controller.generateArxivPdfPreview("")).rejects.toThrow(
        HttpException,
      );
    });

    it("throws 400 when thumbnail generation fails", async () => {
      mockPdfThumbnailService.generateThumbnail.mockResolvedValue(null);

      await expect(
        controller.generateArxivPdfPreview("2301.07041"),
      ).rejects.toThrow(HttpException);
    });
  });

  // ─── enrichResource ───────────────────────────────────────────────

  describe("enrichResource", () => {
    it("enriches resource and updates it", async () => {
      const resource = {
        id: "res1",
        title: "Test",
        abstract: null,
        content: null,
        sourceUrl: "https://x.com",
      };
      const enrichment = {
        aiSummary: "Summary",
        keyInsights: ["insight1"],
        primaryCategory: "AI",
        autoTags: ["ml"],
        difficultyLevel: "intermediate",
      };
      const updated = { ...resource, ...enrichment };

      mockResourcesService.findOne.mockResolvedValue(resource);
      mockAIEnrichmentService.enrichResource.mockResolvedValue(enrichment);
      mockResourcesService.update.mockResolvedValue(updated);

      const result = await controller.enrichResource("res1");
      expect(result).toBe(updated);
    });

    it("throws 404 when resource not found", async () => {
      mockResourcesService.findOne.mockResolvedValue(null);

      await expect(controller.enrichResource("missing")).rejects.toThrow(
        new HttpException("Resource missing not found", HttpStatus.NOT_FOUND),
      );
    });
  });

  // ─── generateThumbnail ────────────────────────────────────────────

  describe("generateThumbnail", () => {
    it("returns existing thumbnail if resource already has one", async () => {
      const resource = {
        id: "res1",
        pdfUrl: "https://pdf.url",
        thumbnailUrl: "https://existing.jpg",
      };
      mockResourcesService.findOne.mockResolvedValue(resource);

      const result = await controller.generateThumbnail("res1");

      expect(result.message).toBe("Thumbnail already exists");
      expect(result.thumbnailUrl).toBe("https://existing.jpg");
      expect(mockPdfThumbnailService.generateThumbnail).not.toHaveBeenCalled();
    });

    it("throws 400 when resource has no pdfUrl", async () => {
      mockResourcesService.findOne.mockResolvedValue({
        id: "res1",
        pdfUrl: null,
        thumbnailUrl: null,
      });

      await expect(controller.generateThumbnail("res1")).rejects.toThrow(
        new HttpException(
          "Resource res1 does not have a PDF URL",
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it("throws 404 when resource does not exist", async () => {
      mockResourcesService.findOne.mockResolvedValue(null);

      await expect(controller.generateThumbnail("res1")).rejects.toThrow(
        new HttpException("Resource res1 not found", HttpStatus.NOT_FOUND),
      );
    });

    it("generates and updates thumbnail when conditions are met", async () => {
      const resource = {
        id: "res1",
        pdfUrl: "https://pdf.url",
        thumbnailUrl: null,
      };
      mockResourcesService.findOne.mockResolvedValue(resource);
      mockPdfThumbnailService.generateThumbnail.mockResolvedValue(
        "https://new.jpg",
      );
      mockResourcesService.update.mockResolvedValue({
        ...resource,
        thumbnailUrl: "https://new.jpg",
      });

      const result = await controller.generateThumbnail("res1");

      expect(result.thumbnailUrl).toBe("https://new.jpg");
      expect(result.message).toBe("Thumbnail generated successfully");
    });
  });

  // ─── cleanupDuplicates ────────────────────────────────────────────

  describe("cleanupDuplicates", () => {
    it("returns cleanup result message", async () => {
      mockResourcesService.cleanupDuplicates.mockResolvedValue({
        deleted: 3,
        total: 10,
      });

      const result = await controller.cleanupDuplicates("YOUTUBE_VIDEO");

      expect(result.message).toBe("Cleaned up 3 duplicate resources");
      expect(result.deleted).toBe(3);
    });
  });

  // ─── cleanupBroken ────────────────────────────────────────────────

  describe("cleanupBroken", () => {
    it("scans first, then cleans, surfacing scanned/deleted counts", async () => {
      mockHealthScheduler.scanAndMarkBroken.mockResolvedValue({
        scanned: 42,
        broken: 7,
        capped: false,
      });
      mockResourcesService.cleanupBrokenResources.mockResolvedValue({
        deleted: 5,
        archived: 2,
        total: 7,
      });

      const result = await controller.cleanupBroken();

      // 顺序很关键：必须先扫描标记 BROKEN，再删除，否则永远删 0
      expect(mockHealthScheduler.scanAndMarkBroken).toHaveBeenCalledTimes(1);
      expect(mockResourcesService.cleanupBrokenResources).toHaveBeenCalledTimes(
        1,
      );
      expect(result.scanned).toBe(42);
      expect(result.deleted).toBe(5);
      expect(result.archived).toBe(2);
      expect(result.capped).toBe(false);
    });
  });

  // ─── translate ────────────────────────────────────────────────────

  describe("translate", () => {
    it("delegates to translateResource service method", () => {
      mockResourcesService.translateResource.mockResolvedValue({
        translated: true,
      });
      void controller.translate("res1", "zh-CN");
      expect(mockResourcesService.translateResource).toHaveBeenCalledWith(
        "res1",
        "zh-CN",
      );
    });
  });
});

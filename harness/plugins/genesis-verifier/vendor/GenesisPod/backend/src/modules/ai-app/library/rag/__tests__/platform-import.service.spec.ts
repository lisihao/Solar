import { Test, TestingModule } from "@nestjs/testing";
import { PlatformImportService } from "../services/platform-import.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "../services/knowledge-base.service";
import { UrlFetchService } from "../services/url-fetch.service";

describe("PlatformImportService", () => {
  let service: PlatformImportService;
  let prisma: jest.Mocked<PrismaService>;
  let knowledgeBaseService: jest.Mocked<KnowledgeBaseService>;
  let urlFetchService: jest.Mocked<UrlFetchService>;

  beforeEach(async () => {
    const mockPrisma = {
      resource: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      note: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    const mockKnowledgeBaseService = {
      addDocument: jest.fn(),
      processAllDocuments: jest.fn(),
      getResourcesByIds: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: "kb-1" }),
    };

    const mockUrlFetchService = {
      fetchUrl: jest.fn(),
      importUrls: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformImportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KnowledgeBaseService, useValue: mockKnowledgeBaseService },
        { provide: UrlFetchService, useValue: mockUrlFetchService },
      ],
    }).compile();

    service = module.get<PlatformImportService>(PlatformImportService);
    prisma = module.get(PrismaService);
    knowledgeBaseService = module.get(KnowledgeBaseService);
    urlFetchService = module.get(UrlFetchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getAvailableBookmarks", () => {
    it("should return bookmarks for user", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "Bookmark 1",
          sourceUrl: "https://example.com/1",
          type: "ARTICLE",
          createdAt: new Date(),
          categories: ["tech"],
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValue(mockResources);
      (prisma.resource.count as jest.Mock).mockResolvedValue(1);

      const result = await service.getAvailableBookmarks("user-1");

      expect(result).toHaveProperty("bookmarks");
      expect(result).toHaveProperty("total");
      expect(result.bookmarks.length).toBe(1);
    });

    it("should filter by search query", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.resource.count as jest.Mock).mockResolvedValue(0);

      await service.getAvailableBookmarks("user-1", { search: "test" });

      const findManyCall = (prisma.resource.findMany as jest.Mock).mock
        .calls[0][0];
      expect(findManyCall.where.OR).toBeDefined();
    });

    it("should filter by tags", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.resource.count as jest.Mock).mockResolvedValue(0);

      await service.getAvailableBookmarks("user-1", { tags: ["tech", "ai"] });

      const findManyCall = (prisma.resource.findMany as jest.Mock).mock
        .calls[0][0];
      expect(findManyCall.where.categories).toBeDefined();
    });

    it("should paginate results", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.resource.count as jest.Mock).mockResolvedValue(50);

      await service.getAvailableBookmarks("user-1", { page: 2, limit: 10 });

      const findManyCall = (prisma.resource.findMany as jest.Mock).mock
        .calls[0][0];
      expect(findManyCall.skip).toBe(10);
      expect(findManyCall.take).toBe(10);
    });

    it("should use default pagination values", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.resource.count as jest.Mock).mockResolvedValue(0);

      await service.getAvailableBookmarks("user-1");

      const findManyCall = (prisma.resource.findMany as jest.Mock).mock
        .calls[0][0];
      expect(findManyCall.skip).toBe(0);
      expect(findManyCall.take).toBe(20);
    });

    it("should exclude bookmarks with empty sourceUrl", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "Has URL",
          sourceUrl: "https://example.com",
          type: "ARTICLE",
          createdAt: new Date(),
          categories: [],
        },
        {
          id: "res-2",
          title: "No URL",
          sourceUrl: "",
          type: "ARTICLE",
          createdAt: new Date(),
          categories: [],
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValue(mockResources);
      (prisma.resource.count as jest.Mock).mockResolvedValue(2);

      const result = await service.getAvailableBookmarks("user-1");

      // The filter(r => r.sourceUrl) should exclude the empty URL resource
      expect(result.bookmarks.length).toBe(1);
      expect(result.bookmarks[0].id).toBe("res-1");
    });
  });

  describe("getAvailableNotes", () => {
    it("should return notes for user", async () => {
      const mockNotes = [
        {
          id: "note-1",
          title: "Test Note",
          createdAt: new Date(),
          updatedAt: new Date(),
          content: "Note content",
          resourceId: null,
          resource: null,
        },
      ];
      (prisma.note.findMany as jest.Mock).mockResolvedValue(mockNotes);
      (prisma.note.count as jest.Mock).mockResolvedValue(1);

      const result = await service.getAvailableNotes("user-1");

      expect(result).toHaveProperty("notes");
      expect(result).toHaveProperty("total", 1);
    });

    it("should include content preview", async () => {
      const content = "A".repeat(200);
      (prisma.note.findMany as jest.Mock).mockResolvedValue([
        {
          id: "note-1",
          title: "Long Note",
          content,
          createdAt: new Date(),
          updatedAt: new Date(),
          resourceId: null,
          resource: null,
        },
      ]);
      (prisma.note.count as jest.Mock).mockResolvedValue(1);

      const result = await service.getAvailableNotes("user-1");

      expect(result.notes[0].contentPreview.length).toBeLessThanOrEqual(103); // 100 chars + "..."
    });

    it("should filter notes by search", async () => {
      (prisma.note.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.note.count as jest.Mock).mockResolvedValue(0);

      await service.getAvailableNotes("user-1", { search: "keyword" });

      const findManyCall = (prisma.note.findMany as jest.Mock).mock.calls[0][0];
      expect(findManyCall.where.OR).toBeDefined();
    });
  });

  describe("importBookmarks", () => {
    it("should import bookmarks into knowledge base", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "Resource 1",
          content: "Resource content",
          abstract: "Abstract",
          sourceUrl: "https://example.com/1",
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValue(mockResources);
      (knowledgeBaseService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.importBookmarks("kb-1", "user-1", ["res-1"]);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("documentIds");
      expect(result.success).toBe(1);
    });

    it("should fetch URL content when resource has no content", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "Resource 1",
          content: null,
          abstract: null,
          sourceUrl: "https://example.com/1",
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValue(mockResources);
      (urlFetchService.fetchUrl as jest.Mock).mockResolvedValue({
        content: "Fetched content",
      });
      (knowledgeBaseService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.importBookmarks("kb-1", "user-1", ["res-1"]);

      expect(urlFetchService.fetchUrl).toHaveBeenCalled();
      expect(result.success).toBe(1);
    });

    it("should handle URL fetch failure gracefully", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "Resource 1",
          content: null,
          abstract: "Fallback abstract",
          sourceUrl: "https://example.com/1",
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValue(mockResources);
      (urlFetchService.fetchUrl as jest.Mock).mockRejectedValue(
        new Error("Network error"),
      );
      (knowledgeBaseService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.importBookmarks("kb-1", "user-1", ["res-1"]);

      // Should still succeed using abstract as fallback
      expect(result.success).toBe(1);
    });

    it("should track bookmarks not found", async () => {
      (prisma.resource.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.importBookmarks("kb-1", "user-1", [
        "not-found-id",
      ]);

      expect(result.failed.length).toBe(1);
      expect(result.failed[0].id).toBe("not-found-id");
    });

    it("should handle addDocument failure gracefully", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "Resource 1",
          content: "Content",
          abstract: null,
          sourceUrl: "https://example.com/1",
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValue(mockResources);
      (knowledgeBaseService.addDocument as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.importBookmarks("kb-1", "user-1", ["res-1"]);

      expect(result.success).toBe(0);
      expect(result.failed.length).toBe(1);
    });
  });

  describe("importNotes", () => {
    it("should import notes into knowledge base", async () => {
      const mockNotes = [
        {
          id: "note-1",
          title: "Test Note",
          content: "Note content",
          resourceId: null,
          resource: null,
        },
      ];
      (prisma.note.findMany as jest.Mock).mockResolvedValue(mockNotes);
      (knowledgeBaseService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.importNotes("kb-1", "user-1", ["note-1"]);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("failed");
      expect(result.success).toBe(1);
    });

    it("should track notes not found", async () => {
      (prisma.note.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.importNotes("kb-1", "user-1", ["not-found"]);

      expect(result.failed.length).toBe(1);
    });
  });
});

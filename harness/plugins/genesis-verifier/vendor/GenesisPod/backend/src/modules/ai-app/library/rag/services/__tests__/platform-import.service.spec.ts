import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { PlatformImportService } from "../platform-import.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { KnowledgeBaseService } from "../knowledge-base.service";
import { UrlFetchService } from "../url-fetch.service";

describe("PlatformImportService", () => {
  let service: PlatformImportService;
  let mockPrisma: any;
  let mockKbService: jest.Mocked<Partial<KnowledgeBaseService>>;
  let mockUrlFetch: jest.Mocked<Partial<UrlFetchService>>;

  const mockResource = {
    id: "resource-1",
    title: "Test Article",
    sourceUrl: "https://example.com/article",
    type: "ARTICLE",
    createdAt: new Date("2024-01-01"),
    categories: ["tech", "ai"],
    content: "Article content here",
    abstract: "Article abstract",
  };

  const mockNote = {
    id: "note-1",
    title: "My Research Notes",
    content: "# Research\n\nThis is my research content",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    resourceId: "resource-1",
    resource: { id: "resource-1", title: "Referenced Article" },
  };

  beforeEach(async () => {
    mockPrisma = {
      resource: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      note: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    mockKbService = {
      findById: jest.fn().mockResolvedValue({ id: "kb-1", name: "My KB" }),
      addDocument: jest.fn().mockResolvedValue({ id: "doc-1" }),
    };

    mockUrlFetch = {
      fetchUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformImportService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: KnowledgeBaseService, useValue: mockKbService },
        { provide: UrlFetchService, useValue: mockUrlFetch },
      ],
    }).compile();

    service = module.get<PlatformImportService>(PlatformImportService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  // ==================== getAvailableBookmarks ====================

  describe("getAvailableBookmarks", () => {
    it("should return bookmarks for a user", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      const result = await service.getAvailableBookmarks("user-1");

      expect(result.bookmarks).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.bookmarks[0].id).toBe("resource-1");
      expect(result.bookmarks[0].url).toBe("https://example.com/article");
    });

    it("should return empty bookmarks when none found", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);
      mockPrisma.resource.count.mockResolvedValue(0);

      const result = await service.getAvailableBookmarks("user-1");

      expect(result.bookmarks).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should apply search filter to query", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);
      mockPrisma.resource.count.mockResolvedValue(0);

      await service.getAvailableBookmarks("user-1", {
        search: "machine learning",
      });

      const callArgs = mockPrisma.resource.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toBeDefined();
    });

    it("should apply tags filter when provided", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);
      mockPrisma.resource.count.mockResolvedValue(0);

      await service.getAvailableBookmarks("user-1", { tags: ["tech", "ai"] });

      const callArgs = mockPrisma.resource.findMany.mock.calls[0][0];
      expect(callArgs.where.categories).toBeDefined();
    });

    it("should apply pagination", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);
      mockPrisma.resource.count.mockResolvedValue(0);

      await service.getAvailableBookmarks("user-1", { page: 2, limit: 10 });

      const callArgs = mockPrisma.resource.findMany.mock.calls[0][0];
      expect(callArgs.skip).toBe(10); // (page-1) * limit
      expect(callArgs.take).toBe(10);
    });

    it("should filter resources without sourceUrl", async () => {
      const resourceWithoutUrl = { ...mockResource, sourceUrl: "" };
      mockPrisma.resource.findMany.mockResolvedValue([resourceWithoutUrl]);
      mockPrisma.resource.count.mockResolvedValue(1);

      const result = await service.getAvailableBookmarks("user-1");

      // Should be filtered out by .filter(r => r.sourceUrl)
      expect(result.bookmarks).toHaveLength(0);
    });

    it("should map categories to tags", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      mockPrisma.resource.count.mockResolvedValue(1);

      const result = await service.getAvailableBookmarks("user-1");

      expect(result.bookmarks[0].tags).toEqual(["tech", "ai"]);
    });

    it("should use default title when resource title is empty", async () => {
      const resourceNoTitle = { ...mockResource, title: "" };
      mockPrisma.resource.findMany.mockResolvedValue([resourceNoTitle]);
      mockPrisma.resource.count.mockResolvedValue(1);

      const result = await service.getAvailableBookmarks("user-1");

      expect(result.bookmarks[0].title).toBe("Untitled");
    });
  });

  // ==================== importBookmarks ====================

  describe("importBookmarks", () => {
    it("should import bookmarks successfully", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.importBookmarks("kb-1", "user-1", [
        "resource-1",
      ]);

      expect(result.success).toBe(1);
      expect(result.documentIds).toContain("doc-1");
      expect(result.failed).toHaveLength(0);
    });

    it("should verify KB access before importing", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]);

      await service.importBookmarks("kb-1", "user-1", []);

      expect(mockKbService.findById).toHaveBeenCalledWith("kb-1", "user-1");
    });

    it("should fetch URL when resource has no content", async () => {
      const resourceNoContent = { ...mockResource, content: "", abstract: "" };
      mockPrisma.resource.findMany.mockResolvedValue([resourceNoContent]);

      (mockUrlFetch.fetchUrl as jest.Mock).mockResolvedValue({
        content: "Fetched content from URL",
      });
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-2",
      });

      const result = await service.importBookmarks("kb-1", "user-1", [
        "resource-1",
      ]);

      expect(mockUrlFetch.fetchUrl).toHaveBeenCalledWith(
        "https://example.com/article",
      );
      expect(result.success).toBe(1);
    });

    it("should use abstract as fallback when URL fetch fails", async () => {
      const resourceNoContent = {
        ...mockResource,
        content: "",
        abstract: "Article abstract",
      };
      mockPrisma.resource.findMany.mockResolvedValue([resourceNoContent]);

      (mockUrlFetch.fetchUrl as jest.Mock).mockRejectedValue(
        new Error("Fetch failed"),
      );
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-3",
      });

      const result = await service.importBookmarks("kb-1", "user-1", [
        "resource-1",
      ]);

      expect(result.success).toBe(1);
      // Content should be abstract as fallback
      const addDocCall = (mockKbService.addDocument as jest.Mock).mock.calls[0];
      expect(addDocCall[1].content).toBe("Article abstract");
    });

    it("should report bookmarks not found in failed list", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([]); // None found

      const result = await service.importBookmarks("kb-1", "user-1", [
        "missing-id",
      ]);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe("missing-id");
      expect(result.failed[0].error).toContain("not found");
    });

    it("should add to failed list when addDocument throws", async () => {
      mockPrisma.resource.findMany.mockResolvedValue([mockResource]);
      (mockKbService.addDocument as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );

      const result = await service.importBookmarks("kb-1", "user-1", [
        "resource-1",
      ]);

      expect(result.success).toBe(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe("DB error");
    });

    it("should import multiple bookmarks and track all results", async () => {
      const resource2 = {
        ...mockResource,
        id: "resource-2",
        title: "Second Article",
      };
      mockPrisma.resource.findMany.mockResolvedValue([mockResource, resource2]);
      (mockKbService.addDocument as jest.Mock)
        .mockResolvedValueOnce({ id: "doc-1" })
        .mockResolvedValueOnce({ id: "doc-2" });

      const result = await service.importBookmarks("kb-1", "user-1", [
        "resource-1",
        "resource-2",
      ]);

      expect(result.success).toBe(2);
      expect(result.documentIds).toHaveLength(2);
    });

    it("should use Untitled Bookmark when resource title is empty", async () => {
      const resourceNoTitle = { ...mockResource, title: "" };
      mockPrisma.resource.findMany.mockResolvedValue([resourceNoTitle]);
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      await service.importBookmarks("kb-1", "user-1", ["resource-1"]);

      const addDocCall = (mockKbService.addDocument as jest.Mock).mock.calls[0];
      expect(addDocCall[1].title).toBe("Untitled Bookmark");
    });
  });

  // ==================== getAvailableNotes ====================

  describe("getAvailableNotes", () => {
    it("should return notes for a user", async () => {
      mockPrisma.note.findMany.mockResolvedValue([mockNote]);
      mockPrisma.note.count.mockResolvedValue(1);

      const result = await service.getAvailableNotes("user-1");

      expect(result.notes).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.notes[0].id).toBe("note-1");
    });

    it("should return empty notes when none found", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);
      mockPrisma.note.count.mockResolvedValue(0);

      const result = await service.getAvailableNotes("user-1");

      expect(result.notes).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should truncate content to 100 chars for preview", async () => {
      const longNote = { ...mockNote, content: "A".repeat(200) };
      mockPrisma.note.findMany.mockResolvedValue([longNote]);
      mockPrisma.note.count.mockResolvedValue(1);

      const result = await service.getAvailableNotes("user-1");

      expect(result.notes[0].contentPreview.length).toBeLessThanOrEqual(104); // 100 chars + "..."
    });

    it("should include resourceTitle when linked resource exists", async () => {
      mockPrisma.note.findMany.mockResolvedValue([mockNote]);
      mockPrisma.note.count.mockResolvedValue(1);

      const result = await service.getAvailableNotes("user-1");

      expect(result.notes[0].resourceTitle).toBe("Referenced Article");
    });

    it("should apply search filter", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);
      mockPrisma.note.count.mockResolvedValue(0);

      await service.getAvailableNotes("user-1", { search: "research" });

      const callArgs = mockPrisma.note.findMany.mock.calls[0][0];
      expect(callArgs.where.OR).toBeDefined();
    });

    it("should apply pagination", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);
      mockPrisma.note.count.mockResolvedValue(0);

      await service.getAvailableNotes("user-1", { page: 3, limit: 5 });

      const callArgs = mockPrisma.note.findMany.mock.calls[0][0];
      expect(callArgs.skip).toBe(10);
      expect(callArgs.take).toBe(5);
    });
  });

  // ==================== importNotes ====================

  describe("importNotes", () => {
    it("should import notes successfully", async () => {
      mockPrisma.note.findMany.mockResolvedValue([mockNote]);
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.importNotes("kb-1", "user-1", ["note-1"]);

      expect(result.success).toBe(1);
      expect(result.documentIds).toContain("doc-1");
    });

    it("should verify KB access before importing notes", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);

      await service.importNotes("kb-1", "user-1", []);

      expect(mockKbService.findById).toHaveBeenCalledWith("kb-1", "user-1");
    });

    it("should use resource-linked title when note title is empty", async () => {
      const noteNoTitle = { ...mockNote, title: "" };
      mockPrisma.note.findMany.mockResolvedValue([noteNoTitle]);
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      await service.importNotes("kb-1", "user-1", ["note-1"]);

      const addDocCall = (mockKbService.addDocument as jest.Mock).mock.calls[0];
      expect(addDocCall[1].title).toBe("Notes on: Referenced Article");
    });

    it("should use Untitled Note as final fallback", async () => {
      const noteNoTitleNoResource = { ...mockNote, title: "", resource: null };
      mockPrisma.note.findMany.mockResolvedValue([noteNoTitleNoResource]);
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      await service.importNotes("kb-1", "user-1", ["note-1"]);

      const addDocCall = (mockKbService.addDocument as jest.Mock).mock.calls[0];
      expect(addDocCall[1].title).toBe("Untitled Note");
    });

    it("should include autoSync metadata in document", async () => {
      mockPrisma.note.findMany.mockResolvedValue([mockNote]);
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      await service.importNotes("kb-1", "user-1", ["note-1"], true);

      const addDocCall = (mockKbService.addDocument as jest.Mock).mock.calls[0];
      expect(addDocCall[1].metadata.autoSync).toBe(true);
    });

    it("should report notes not found in failed list", async () => {
      mockPrisma.note.findMany.mockResolvedValue([]);

      const result = await service.importNotes("kb-1", "user-1", [
        "missing-note",
      ]);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe("missing-note");
    });

    it("should add to failed list when addDocument throws", async () => {
      mockPrisma.note.findMany.mockResolvedValue([mockNote]);
      (mockKbService.addDocument as jest.Mock).mockRejectedValue(
        new Error("Save failed"),
      );

      const result = await service.importNotes("kb-1", "user-1", ["note-1"]);

      expect(result.success).toBe(0);
      expect(result.failed).toHaveLength(1);
    });

    it("should set sourceType to NOTE for note documents", async () => {
      mockPrisma.note.findMany.mockResolvedValue([mockNote]);
      (mockKbService.addDocument as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      await service.importNotes("kb-1", "user-1", ["note-1"]);

      const addDocCall = (mockKbService.addDocument as jest.Mock).mock.calls[0];
      expect(addDocCall[1].sourceType).toBe("NOTE");
    });
  });
});

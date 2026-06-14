import { Test, TestingModule } from "@nestjs/testing";
import { RAGController } from "../rag.controller";
import { KnowledgeBaseService } from "../services/knowledge-base.service";
import { RAGPipelineService } from "@/modules/ai-harness/facade";
import { GoogleDriveRAGService } from "../services/google-drive-rag.service";
import { RAGFacade } from "@/modules/ai-harness/facade";
import { UrlFetchService } from "../services/url-fetch.service";
import { PlatformImportService } from "../services/platform-import.service";
import { PlaygroundReportImportService } from "../services/playground-report-import.service";
import { TopicReportImportService } from "../services/topic-report-import.service";

describe("RAGController", () => {
  let controller: RAGController;
  let knowledgeBaseService: jest.Mocked<KnowledgeBaseService>;
  let ragPipelineService: jest.Mocked<RAGPipelineService>;
  let googleDriveRAGService: jest.Mocked<GoogleDriveRAGService>;
  let _aiFacade: jest.Mocked<RAGFacade>;
  let urlFetchService: jest.Mocked<UrlFetchService>;
  let platformImportService: jest.Mocked<PlatformImportService>;

  const mockUser = { id: "user-1", email: "test@example.com" };
  const mockRequest = { user: mockUser } as any;

  const mockKnowledgeBase = {
    id: "kb-1",
    name: "Test KB",
    userId: "user-1",
    googleDriveFileIds: [],
    sourceTypes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockKbService = {
      create: jest.fn().mockResolvedValue(mockKnowledgeBase),
      findById: jest.fn().mockResolvedValue(mockKnowledgeBase),
      findByUser: jest.fn().mockResolvedValue([mockKnowledgeBase]),
      update: jest.fn().mockResolvedValue(mockKnowledgeBase),
      delete: jest.fn().mockResolvedValue(undefined),
      addDocument: jest
        .fn()
        .mockResolvedValue({ id: "doc-1", title: "Test Doc" }),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
      processAllDocuments: jest.fn().mockResolvedValue({ processed: 1 }),
      getStats: jest
        .fn()
        .mockResolvedValue({ totalDocuments: 5, totalChunks: 50 }),
      listDocuments: jest
        .fn()
        .mockResolvedValue([{ id: "doc-1", title: "Doc 1" }]),
      getResourcesByIds: jest.fn().mockResolvedValue([]),
      getMembers: jest.fn().mockResolvedValue([]),
      addMember: jest.fn().mockResolvedValue({ id: "member-1" }),
      updateMemberRole: jest.fn().mockResolvedValue({ id: "member-1" }),
      removeMember: jest.fn().mockResolvedValue(undefined),
      getDocumentById: jest
        .fn()
        .mockResolvedValue({ id: "doc-1", title: "Doc 1" }),
    };

    const mockRagPipelineService = {
      query: jest.fn().mockResolvedValue({ results: [], context: "" }),
      simpleQuery: jest.fn().mockResolvedValue([
        {
          childChunkId: "chunk-1",
          content: "Result",
          score: 0.9,
          documentId: "doc-1",
          metadata: {},
        },
      ]),
    };

    const mockGoogleDriveService = {
      syncKnowledgeBase: jest
        .fn()
        .mockResolvedValue({ added: 2, updated: 1, failed: 0 }),
      listFolders: jest
        .fn()
        .mockResolvedValue([{ id: "folder-1", name: "My Folder" }]),
    };

    const mockAiFacade = {
      embedding: {
        getConfigInfo: jest.fn().mockResolvedValue({
          model: "text-embedding-3-small",
          dimensions: 1536,
        }),
      },
    };

    const mockUrlFetchService = {
      fetchUrl: jest.fn().mockResolvedValue({
        url: "https://example.com",
        title: "Example",
        content: "Content text",
        wordCount: 2,
        metadata: {},
      }),
      importUrls: jest
        .fn()
        .mockResolvedValue({ success: 2, failed: [], documents: [] }),
    };

    const mockPlatformImportService = {
      getAvailableBookmarks: jest
        .fn()
        .mockResolvedValue({ bookmarks: [], total: 0 }),
      importBookmarks: jest.fn().mockResolvedValue({ success: 1, failed: [] }),
      getAvailableNotes: jest.fn().mockResolvedValue({ notes: [], total: 0 }),
      importNotes: jest.fn().mockResolvedValue({ success: 1, failed: [] }),
    };

    const mockPlaygroundReportImport = {
      listVersions: jest.fn().mockResolvedValue([]),
      importMissionReport: jest.fn().mockResolvedValue({
        documentId: "doc-1",
        title: "Mock Mission (Playground)",
        knowledgeBaseId: "kb-1",
        sourceId: "m1",
        version: null,
        charCount: 100,
      }),
    };

    const mockTopicReportImport = {
      listVersions: jest.fn().mockResolvedValue([]),
      importTopicReport: jest.fn().mockResolvedValue({
        documentId: "doc-1",
        title: "Mock Topic (Topic Insight · v1)",
        knowledgeBaseId: "kb-1",
        sourceId: "t1#v1",
        version: 1,
        charCount: 100,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RAGController],
      providers: [
        { provide: KnowledgeBaseService, useValue: mockKbService },
        { provide: RAGPipelineService, useValue: mockRagPipelineService },
        { provide: GoogleDriveRAGService, useValue: mockGoogleDriveService },
        { provide: RAGFacade, useValue: mockAiFacade },
        { provide: UrlFetchService, useValue: mockUrlFetchService },
        { provide: PlatformImportService, useValue: mockPlatformImportService },
        {
          provide: PlaygroundReportImportService,
          useValue: mockPlaygroundReportImport,
        },
        {
          provide: TopicReportImportService,
          useValue: mockTopicReportImport,
        },
      ],
    }).compile();

    controller = module.get<RAGController>(RAGController);
    knowledgeBaseService = module.get(KnowledgeBaseService);
    ragPipelineService = module.get(RAGPipelineService);
    googleDriveRAGService = module.get(GoogleDriveRAGService);
    _aiFacade = module.get(RAGFacade);
    urlFetchService = module.get(UrlFetchService);
    platformImportService = module.get(PlatformImportService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  // ==================== Embedding Config ====================

  describe("getEmbeddingConfig", () => {
    it("should return embedding config from facade", async () => {
      const result = await controller.getEmbeddingConfig();
      expect(result).toEqual({
        model: "text-embedding-3-small",
        dimensions: 1536,
      });
    });
  });

  // ==================== Knowledge Base CRUD ====================

  describe("createKnowledgeBase", () => {
    it("should create knowledge base without Google Drive files", async () => {
      const dto = { name: "Test KB", description: "Test" };
      const _result = await controller.createKnowledgeBase(
        mockRequest,
        dto as any,
      );

      expect(knowledgeBaseService.create).toHaveBeenCalledWith("user-1", dto);
      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(googleDriveRAGService.syncKnowledgeBase).not.toHaveBeenCalled();
    });

    it("should auto-sync when Google Drive fileIds are provided", async () => {
      const dto = {
        name: "GDrive KB",
        googleDriveFileIds: ["file-1", "file-2"],
      };
      await controller.createKnowledgeBase(mockRequest, dto as any);

      expect(googleDriveRAGService.syncKnowledgeBase).toHaveBeenCalledWith(
        "kb-1",
      );
    });

    it("should auto-sync when Google Drive folderIds are provided", async () => {
      const dto = { name: "GDrive KB", googleDriveFolderIds: ["folder-1"] };
      await controller.createKnowledgeBase(mockRequest, dto as any);

      expect(googleDriveRAGService.syncKnowledgeBase).toHaveBeenCalledWith(
        "kb-1",
      );
    });

    it("should not throw when auto-sync fails", async () => {
      const dto = { name: "GDrive KB", googleDriveFileIds: ["file-1"] };
      (
        googleDriveRAGService.syncKnowledgeBase as jest.Mock
      ).mockRejectedValueOnce(new Error("Sync failed"));

      // Should not throw
      await expect(
        controller.createKnowledgeBase(mockRequest, dto as any),
      ).resolves.toBeDefined();
    });
  });

  describe("listKnowledgeBases", () => {
    it("should return list of knowledge bases", async () => {
      const result = await controller.listKnowledgeBases(mockRequest);

      expect(knowledgeBaseService.findByUser).toHaveBeenCalledWith("user-1");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getKnowledgeBase", () => {
    it("should return knowledge base by id", async () => {
      const result = await controller.getKnowledgeBase(mockRequest, "kb-1");

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(result).toEqual(mockKnowledgeBase);
    });
  });

  describe("getKnowledgeBaseStats", () => {
    it("should return knowledge base stats", async () => {
      const result = await controller.getKnowledgeBaseStats(
        mockRequest,
        "kb-1",
      );

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(knowledgeBaseService.getStats).toHaveBeenCalledWith("kb-1");
      expect(result).toHaveProperty("totalDocuments", 5);
    });
  });

  describe("listDocuments", () => {
    it("should return documents for knowledge base", async () => {
      const result = await controller.listDocuments(mockRequest, "kb-1");

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(knowledgeBaseService.listDocuments).toHaveBeenCalledWith("kb-1");
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("updateKnowledgeBase", () => {
    it("should update knowledge base", async () => {
      const dto = { name: "Updated Name" };
      await controller.updateKnowledgeBase(mockRequest, "kb-1", dto as any);

      expect(knowledgeBaseService.update).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
        dto,
      );
    });
  });

  describe("deleteKnowledgeBase", () => {
    it("should delete knowledge base and return success message", async () => {
      const result = await controller.deleteKnowledgeBase(mockRequest, "kb-1");

      expect(knowledgeBaseService.delete).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(result).toEqual({
        message: "Knowledge base deleted successfully",
      });
    });
  });

  // ==================== Document Management ====================

  describe("addDocument", () => {
    it("should add document to knowledge base", async () => {
      const dto = {
        title: "New Doc",
        content: "Content",
        sourceType: "manual",
        sourceUrl: "https://example.com",
        mimeType: "text/plain",
      };
      const _result = await controller.addDocument(
        mockRequest,
        "kb-1",
        dto as any,
      );

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(knowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-1",
        expect.objectContaining({
          title: "New Doc",
          content: "Content",
          sourceType: "manual",
        }),
      );
    });

    it("should default sourceType to manual when not provided", async () => {
      const dto = { title: "Doc", content: "Content" };
      await controller.addDocument(mockRequest, "kb-1", dto as any);

      expect(knowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-1",
        expect.objectContaining({ sourceType: "manual" }),
      );
    });
  });

  describe("deleteDocument", () => {
    it("should delete document and return success", async () => {
      const result = await controller.deleteDocument(mockRequest, "doc-1");

      expect(knowledgeBaseService.deleteDocument).toHaveBeenCalledWith(
        "doc-1",
        "user-1",
      );
      expect(result).toEqual({ message: "Document deleted successfully" });
    });
  });

  describe("processDocuments", () => {
    it("should process all pending documents", async () => {
      const result = await controller.processDocuments(mockRequest, "kb-1");

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(knowledgeBaseService.processAllDocuments).toHaveBeenCalledWith(
        "kb-1",
      );
      expect(result).toEqual({ processed: 1 });
    });
  });

  // ==================== Google Drive Integration ====================

  describe("syncKnowledgeBase", () => {
    it("should sync knowledge base with Google Drive", async () => {
      const result = await controller.syncKnowledgeBase(mockRequest, "kb-1");

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(googleDriveRAGService.syncKnowledgeBase).toHaveBeenCalledWith(
        "kb-1",
      );
      expect(result).toEqual({ added: 2, updated: 1, failed: 0 });
    });
  });

  describe("listGoogleDriveFolders", () => {
    it("should list Google Drive folders", async () => {
      const result = await controller.listGoogleDriveFolders(mockRequest);

      expect(googleDriveRAGService.listFolders).toHaveBeenCalledWith(
        "user-1",
        undefined,
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it("should pass parentId when provided", async () => {
      await controller.listGoogleDriveFolders(mockRequest, "folder-1");

      expect(googleDriveRAGService.listFolders).toHaveBeenCalledWith(
        "user-1",
        "folder-1",
      );
    });
  });

  // ==================== URL Import ====================

  describe("fetchUrl", () => {
    it("should preview URL content", async () => {
      const dto = { url: "https://example.com" };
      const result = await controller.fetchUrl(mockRequest, "kb-1", dto as any);

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(urlFetchService.fetchUrl).toHaveBeenCalledWith(
        "https://example.com",
      );
      expect(result).toHaveProperty("title", "Example");
    });
  });

  describe("importUrls", () => {
    it("should import URLs to knowledge base", async () => {
      const dto = { urls: ["https://example.com/1", "https://example.com/2"] };
      const result = await controller.importUrls(
        mockRequest,
        "kb-1",
        dto as any,
      );

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(urlFetchService.importUrls).toHaveBeenCalledWith("kb-1", dto.urls);
      expect(result).toHaveProperty("success", 2);
    });
  });

  // ==================== Platform Bookmark Import ====================

  describe("getAvailableBookmarks", () => {
    it("should return available bookmarks", async () => {
      await controller.getAvailableBookmarks(mockRequest, "kb-1");

      expect(knowledgeBaseService.findById).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(platformImportService.getAvailableBookmarks).toHaveBeenCalledWith(
        "user-1",
        { search: undefined, page: undefined, limit: undefined },
      );
    });

    it("should parse page and limit as integers", async () => {
      await controller.getAvailableBookmarks(
        mockRequest,
        "kb-1",
        "test",
        "2",
        "20",
      );

      expect(platformImportService.getAvailableBookmarks).toHaveBeenCalledWith(
        "user-1",
        { search: "test", page: 2, limit: 20 },
      );
    });
  });

  describe("importBookmarks", () => {
    it("should import bookmarks to knowledge base", async () => {
      const dto = { bookmarkIds: ["bm-1", "bm-2"] };
      const result = await controller.importBookmarks(
        mockRequest,
        "kb-1",
        dto as any,
      );

      expect(platformImportService.importBookmarks).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
        ["bm-1", "bm-2"],
      );
      expect(result).toHaveProperty("success", 1);
    });
  });

  // ==================== Platform Note Import ====================

  describe("getAvailableNotes", () => {
    it("should return available notes", async () => {
      await controller.getAvailableNotes(mockRequest, "kb-1");

      expect(platformImportService.getAvailableNotes).toHaveBeenCalledWith(
        "user-1",
        { search: undefined, page: undefined, limit: undefined },
      );
    });
  });

  describe("importNotes", () => {
    it("should import notes to knowledge base", async () => {
      const dto = { noteIds: ["note-1"], autoSync: true };
      await controller.importNotes(mockRequest, "kb-1", dto as any);

      expect(platformImportService.importNotes).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
        ["note-1"],
        true,
      );
    });
  });

  // ==================== OCR Import ====================

  describe("importOcr", () => {
    it("should import OCR documents to knowledge base", async () => {
      const dto = {
        documents: [
          {
            title: "Page 1",
            content: "OCR text here",
            imageUrl: "https://img.example.com/1.jpg",
          },
          {
            title: "Page 2",
            content: "More OCR text",
            imageUrl: "https://img.example.com/2.jpg",
          },
        ],
      };
      const result = await controller.importOcr(
        mockRequest,
        "kb-1",
        dto as any,
      );

      expect(knowledgeBaseService.addDocument).toHaveBeenCalledTimes(2);
      expect(knowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-1",
        expect.objectContaining({
          title: "Page 1",
          content: "OCR text here",
          sourceType: "IMAGE",
          mimeType: "image/*",
        }),
      );
      expect(result).toHaveProperty("count", 2);
      expect(result).toHaveProperty("documentIds");
      expect(result.documentIds).toHaveLength(2);
    });

    it("should return empty result for empty documents array", async () => {
      const dto = { documents: [] };
      const result = await controller.importOcr(
        mockRequest,
        "kb-1",
        dto as any,
      );

      expect(result.count).toBe(0);
      expect(result.documentIds).toEqual([]);
    });
  });

  // ==================== Member Management ====================

  describe("getMembers", () => {
    it("should return knowledge base members", async () => {
      const result = await controller.getMembers(mockRequest, "kb-1");

      expect(knowledgeBaseService.getMembers).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("addMember", () => {
    it("should add member to knowledge base", async () => {
      const dto = { email: "member@example.com", role: "VIEWER" as const };
      await controller.addMember(mockRequest, "kb-1", dto);

      expect(knowledgeBaseService.addMember).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
        "member@example.com",
        "VIEWER",
      );
    });

    it("should add member without role (optional)", async () => {
      const dto = { email: "member@example.com" };
      await controller.addMember(mockRequest, "kb-1", dto);

      expect(knowledgeBaseService.addMember).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
        "member@example.com",
        undefined,
      );
    });
  });

  describe("updateMemberRole", () => {
    it("should update member role", async () => {
      const dto = { role: "ADMIN" as const };
      await controller.updateMemberRole(mockRequest, "kb-1", "member-1", dto);

      expect(knowledgeBaseService.updateMemberRole).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
        "member-1",
        "ADMIN",
      );
    });
  });

  describe("removeMember", () => {
    it("should remove member and return success", async () => {
      const result = await controller.removeMember(
        mockRequest,
        "kb-1",
        "member-1",
      );

      expect(knowledgeBaseService.removeMember).toHaveBeenCalledWith(
        "kb-1",
        "user-1",
        "member-1",
      );
      expect(result).toEqual({ message: "Member removed successfully" });
    });
  });

  // ==================== Query Endpoints ====================

  describe("query", () => {
    it("should execute full RAG query", async () => {
      const dto = {
        query: "What is AI?",
        knowledgeBaseIds: ["kb-1", "kb-2"],
        topK: 5,
        useHyde: true,
        useRerank: false,
        hybridAlpha: 0.7,
        minScore: 0.5,
      };
      (knowledgeBaseService.findById as jest.Mock).mockResolvedValue(
        mockKnowledgeBase,
      );

      const result = await controller.query(mockRequest, dto as any);

      expect(knowledgeBaseService.findById).toHaveBeenCalledTimes(2);
      expect(ragPipelineService.query).toHaveBeenCalledWith({
        query: "What is AI?",
        knowledgeBaseIds: ["kb-1", "kb-2"],
        options: {
          topK: 5,
          useHyde: true,
          useRerank: false,
          hybridAlpha: 0.7,
          minScore: 0.5,
        },
      });
      expect(result).toHaveProperty("results");
    });
  });

  describe("simpleQuery", () => {
    it("should execute simple vector search and enhance results", async () => {
      const dto = {
        query: "AI basics",
        knowledgeBaseIds: ["kb-1"],
        topK: 3,
      };

      const result = await controller.simpleQuery(mockRequest, dto as any);

      expect(ragPipelineService.simpleQuery).toHaveBeenCalledWith(
        "AI basics",
        ["kb-1"],
        3,
      );
      expect(knowledgeBaseService.getDocumentById).toHaveBeenCalledWith(
        "doc-1",
      );
      expect(result).toHaveProperty("results");
      expect(result.results[0]).toHaveProperty("documentTitle", "Doc 1");
      expect(result.results[0]).toHaveProperty("score", 0.9);
    });

    it("should use Unknown Document when document not found", async () => {
      (knowledgeBaseService.getDocumentById as jest.Mock).mockResolvedValue(
        null,
      );
      const dto = { query: "test", knowledgeBaseIds: ["kb-1"], topK: 3 };

      const result = await controller.simpleQuery(mockRequest, dto as any);

      expect(result.results[0].documentTitle).toBe("Unknown Document");
    });
  });

  // ==================== Add Resources ====================

  describe("addResources", () => {
    it("should handle Google Drive resources with sync", async () => {
      (knowledgeBaseService.update as jest.Mock).mockResolvedValue({
        ...mockKnowledgeBase,
        googleDriveFileIds: ["file-1"],
        sourceTypes: ["GOOGLE_DRIVE"],
      });

      const dto = {
        resources: [
          {
            sourceType: "google_drive",
            sourceId: "file-1",
            title: "GDrive File",
          },
        ],
      };
      const result = await controller.addResources(
        mockRequest,
        "kb-1",
        dto as any,
      );

      expect(googleDriveRAGService.syncKnowledgeBase).toHaveBeenCalledWith(
        "kb-1",
      );
      expect(result).toHaveProperty("count", 1);
      expect(result).toHaveProperty("syncResult");
    });

    it("should handle platform resource type with content fetching", async () => {
      const platformResource = {
        id: "res-1",
        content:
          "Long enough content that exceeds the minimum threshold for import operations here",
        abstract: null,
        aiSummary: null,
        sourceUrl: null,
        type: "article",
      };
      (knowledgeBaseService.getResourcesByIds as jest.Mock).mockResolvedValue([
        platformResource,
      ]);

      const dto = {
        resources: [
          {
            sourceType: "platform_resource",
            sourceId: "res-1",
            title: "Platform Resource",
          },
        ],
      };
      const result = await controller.addResources(
        mockRequest,
        "kb-1",
        dto as any,
      );

      expect(knowledgeBaseService.getResourcesByIds).toHaveBeenCalledWith([
        "res-1",
      ]);
      expect(knowledgeBaseService.addDocument).toHaveBeenCalled();
      expect(result).toHaveProperty("count", 1);
      expect(result).toHaveProperty("documents");
    });

    it("should handle platform resource with short content by fetching URL", async () => {
      const platformResource = {
        id: "res-1",
        content: "Short", // less than 500 chars
        abstract: null,
        aiSummary: null,
        sourceUrl: "https://example.com/article",
        type: "article",
      };
      (knowledgeBaseService.getResourcesByIds as jest.Mock).mockResolvedValue([
        platformResource,
      ]);
      (urlFetchService.fetchUrl as jest.Mock).mockResolvedValue({
        content:
          "Full article content that is much longer and more detailed than the short snippet",
      });

      const dto = {
        resources: [
          {
            sourceType: "platform_resource",
            sourceId: "res-1",
            title: "Article",
            sourceUrl: "https://example.com/article",
          },
        ],
      };
      await controller.addResources(mockRequest, "kb-1", dto as any);

      expect(urlFetchService.fetchUrl).toHaveBeenCalledWith(
        "https://example.com/article",
      );
    });

    it("should use placeholder when platform resource not found", async () => {
      (knowledgeBaseService.getResourcesByIds as jest.Mock).mockResolvedValue(
        [],
      );

      const dto = {
        resources: [
          {
            sourceType: "platform_resource",
            sourceId: "nonexistent",
            title: "Missing Resource",
          },
        ],
      };
      await controller.addResources(mockRequest, "kb-1", dto as any);

      // Should still add a document with the title as content
      expect(knowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-1",
        expect.objectContaining({ title: "Missing Resource" }),
      );
    });

    it("should handle legacy source types with placeholder", async () => {
      const dto = {
        resources: [
          {
            sourceType: "notion",
            sourceId: "notion-page-1",
            title: "Notion Page",
          },
        ],
      };
      const result = await controller.addResources(
        mockRequest,
        "kb-1",
        dto as any,
      );

      expect(knowledgeBaseService.addDocument).toHaveBeenCalledWith(
        "kb-1",
        expect.objectContaining({
          content: "[Pending content fetch from notion]",
        }),
      );
      expect(result).toHaveProperty("count", 1);
    });
  });
});

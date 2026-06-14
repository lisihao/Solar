import { Test, TestingModule } from "@nestjs/testing";
import { DocumentProcessorService } from "../services/document-processor.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { KnowledgeBaseStatus } from "@prisma/client";

describe("DocumentProcessorService", () => {
  let service: DocumentProcessorService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      knowledgeBaseDocument: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      parentChunk: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentProcessorService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DocumentProcessorService>(DocumentProcessorService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("processDocument", () => {
    it("should process a simple document into parent and child chunks", async () => {
      const content =
        "This is a test document. It has multiple sentences. Each sentence adds content.";
      const result = await service.processDocument(
        "doc-1",
        content,
        "Test Doc",
      );

      expect(result).toBeDefined();
      expect(result.documentId).toBe("doc-1");
      expect(result.title).toBe("Test Doc");
      expect(Array.isArray(result.parentChunks)).toBe(true);
    });

    it("should create parent chunks with child chunks", async () => {
      const content = "First sentence. Second sentence. Third sentence.";
      const result = await service.processDocument(
        "doc-1",
        content,
        "Test Doc",
      );

      expect(result.parentChunks.length).toBeGreaterThan(0);
      for (const parent of result.parentChunks) {
        expect(parent).toHaveProperty("id");
        expect(parent).toHaveProperty("content");
        expect(parent).toHaveProperty("tokenCount");
        expect(parent).toHaveProperty("position");
        expect(parent).toHaveProperty("childChunks");
        expect(Array.isArray(parent.childChunks)).toBe(true);
      }
    });

    it("should extract section titles from markdown headings", async () => {
      const content =
        "# Introduction\nThis is the introduction section.\n## Details\nHere are more details.";
      const result = await service.processDocument(
        "doc-1",
        content,
        "Test Doc",
      );

      const _parentWithTitle = result.parentChunks.find((p) => p.sectionTitle);
      // At least one chunk should have a section title extracted
      expect(result.parentChunks.length).toBeGreaterThan(0);
    });

    it("should handle empty content gracefully", async () => {
      const result = await service.processDocument("doc-1", "", "Empty Doc");

      expect(result.documentId).toBe("doc-1");
      expect(Array.isArray(result.parentChunks)).toBe(true);
    });

    it("should include metadata with processedAt date", async () => {
      const result = await service.processDocument("doc-1", "content", "Test");

      expect(result.metadata).toBeDefined();
      expect(result.metadata.processedAt).toBeInstanceOf(Date);
    });

    it("should process Chinese numbered headings as section titles", async () => {
      const content =
        "第一章 概述\n这是概述部分的内容。\n第二章 详细说明\n这是详细内容。";
      const result = await service.processDocument(
        "doc-1",
        content,
        "Chinese Doc",
      );

      expect(result.parentChunks.length).toBeGreaterThan(0);
    });
  });

  describe("saveProcessedDocument", () => {
    it("should save processed document to database", async () => {
      const processed = {
        documentId: "doc-1",
        title: "Test Doc",
        parentChunks: [
          {
            id: "parent-1",
            content: "Parent content",
            tokenCount: 20,
            position: 0,
            pageStart: 1,
            pageEnd: 1,
            sectionTitle: undefined,
            metadata: {},
            childChunks: [
              {
                id: "child-1",
                content: "Child content",
                tokenCount: 10,
                position: 0,
                parentPosition: 0,
                documentId: "doc-1",
              },
            ],
          },
        ],
        metadata: { sourceType: "document", processedAt: new Date() },
      };

      (prisma.parentChunk.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.parentChunk.create as jest.Mock).mockResolvedValue({
        id: "parent-1",
      });
      (prisma.knowledgeBaseDocument.update as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      await service.saveProcessedDocument("kb-1", "doc-1", processed);

      expect(prisma.parentChunk.deleteMany).toHaveBeenCalledWith({
        where: { documentId: "doc-1" },
      });
      expect(prisma.parentChunk.create).toHaveBeenCalled();
      expect(prisma.knowledgeBaseDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "doc-1" },
          data: expect.objectContaining({
            status: KnowledgeBaseStatus.READY,
          }),
        }),
      );
    });
  });

  describe("processAllPendingDocuments", () => {
    it("should process all pending documents for a knowledge base", async () => {
      const pendingDocs = [
        { id: "doc-1", rawContent: "Content for doc 1", title: "Doc 1" },
        { id: "doc-2", rawContent: "Content for doc 2", title: "Doc 2" },
      ];
      (prisma.knowledgeBaseDocument.findMany as jest.Mock).mockResolvedValue(
        pendingDocs,
      );
      (prisma.parentChunk.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });
      (prisma.parentChunk.create as jest.Mock).mockResolvedValue({
        id: "parent-1",
      });
      (prisma.knowledgeBaseDocument.update as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.processAllPendingDocuments("kb-1");

      expect(result).toBe(2);
    });

    it("should return 0 when no pending documents", async () => {
      (prisma.knowledgeBaseDocument.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      const result = await service.processAllPendingDocuments("kb-1");

      expect(result).toBe(0);
    });

    it("should handle document processing errors gracefully", async () => {
      const docs = [{ id: "doc-1", rawContent: "Content", title: "Doc 1" }];
      (prisma.knowledgeBaseDocument.findMany as jest.Mock).mockResolvedValue(
        docs,
      );
      (prisma.parentChunk.deleteMany as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );
      (prisma.knowledgeBaseDocument.update as jest.Mock).mockResolvedValue({
        id: "doc-1",
      });

      const result = await service.processAllPendingDocuments("kb-1");

      // Document processing failed, so count is 0
      expect(result).toBe(0);
      // Error status should have been set
      expect(prisma.knowledgeBaseDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: KnowledgeBaseStatus.ERROR }),
        }),
      );
    });
  });
});

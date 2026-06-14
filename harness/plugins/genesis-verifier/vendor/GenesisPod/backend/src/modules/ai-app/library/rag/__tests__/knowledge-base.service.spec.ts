import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { KnowledgeBaseService } from "../services/knowledge-base.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { DocumentProcessorService } from "../services/document-processor.service";
import { EmbeddingProcessorService } from "../services/embedding-processor.service";
import { KnowledgeBaseStatus, KnowledgeBaseSourceType } from "@prisma/client";

describe("KnowledgeBaseService", () => {
  let service: KnowledgeBaseService;
  let prisma: jest.Mocked<PrismaService>;
  let documentProcessor: jest.Mocked<DocumentProcessorService>;
  let embeddingProcessor: jest.Mocked<EmbeddingProcessorService>;

  const mockKnowledgeBase = {
    id: "kb-123",
    name: "Test KB",
    description: "Test description",
    sourceType: KnowledgeBaseSourceType.MANUAL,
    sourceTypes: ["MANUAL"],
    status: KnowledgeBaseStatus.READY,
    userId: "user-1",
    type: "PERSONAL",
    teamId: null,
    googleDriveConnectionId: null,
    googleDriveFolderIds: [],
    googleDriveFileIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSyncedAt: null,
    lastError: null,
    documents: [],
    googleDriveConnection: null,
    _count: { documents: 0 },
    members: [],
  };

  beforeEach(async () => {
    const mockPrisma = {
      knowledgeBase: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      knowledgeBaseDocument: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      knowledgeBaseMember: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      googleDriveConnection: {
        findUnique: jest.fn(),
      },
      resource: {
        findMany: jest.fn(),
      },
      youTubeTranscriptCache: {
        findMany: jest.fn(),
      },
      parentChunk: {
        deleteMany: jest.fn(),
      },
      childChunk: {
        deleteMany: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
      },
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      $transaction: jest.fn(),
    };

    const mockDocumentProcessor = {
      processAllPendingDocuments: jest.fn(),
    };

    const mockEmbeddingProcessor = {
      generateEmbeddingsForKnowledgeBase: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeBaseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DocumentProcessorService, useValue: mockDocumentProcessor },
        {
          provide: EmbeddingProcessorService,
          useValue: mockEmbeddingProcessor,
        },
      ],
    }).compile();

    service = module.get<KnowledgeBaseService>(KnowledgeBaseService);
    prisma = module.get(PrismaService);
    documentProcessor = module.get(DocumentProcessorService);
    embeddingProcessor = module.get(EmbeddingProcessorService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should create a personal knowledge base", async () => {
      (prisma.knowledgeBase.create as jest.Mock).mockResolvedValue(
        mockKnowledgeBase,
      );

      const result = await service.create("user-1", {
        name: "Test KB",
        sourceType: KnowledgeBaseSourceType.MANUAL,
      });

      expect(result).toEqual(mockKnowledgeBase);
      expect(prisma.knowledgeBase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Test KB",
            userId: "user-1",
            status: KnowledgeBaseStatus.PENDING,
          }),
        }),
      );
    });

    it("should auto-detect Google Drive connection when sourceType is GOOGLE_DRIVE", async () => {
      const mockConnection = { id: "conn-123", email: "test@gmail.com" };
      (prisma.googleDriveConnection.findUnique as jest.Mock).mockResolvedValue(
        mockConnection,
      );
      (prisma.knowledgeBase.create as jest.Mock).mockResolvedValue({
        ...mockKnowledgeBase,
        sourceType: KnowledgeBaseSourceType.GOOGLE_DRIVE,
        googleDriveConnectionId: "conn-123",
      });

      const _result = await service.create("user-1", {
        name: "Test KB",
        sourceType: KnowledgeBaseSourceType.GOOGLE_DRIVE,
      });

      expect(prisma.googleDriveConnection.findUnique).toHaveBeenCalled();
      expect(prisma.knowledgeBase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            googleDriveConnectionId: "conn-123",
          }),
        }),
      );
    });

    it("should throw when no Google Drive connection found", async () => {
      (prisma.googleDriveConnection.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.create("user-1", {
          name: "Test KB",
          sourceType: KnowledgeBaseSourceType.GOOGLE_DRIVE,
        }),
      ).rejects.toThrow("No Google Drive connection found");
    });

    it("should create a team knowledge base", async () => {
      (prisma.knowledgeBase.create as jest.Mock).mockResolvedValue({
        ...mockKnowledgeBase,
        type: "TEAM",
        teamId: "team-1",
      });

      await service.create("user-1", {
        name: "Team KB",
        sourceType: KnowledgeBaseSourceType.MANUAL,
        type: "TEAM",
        teamId: "team-1",
      });

      expect(prisma.knowledgeBase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "TEAM",
            teamId: "team-1",
          }),
        }),
      );
    });
  });

  describe("findById", () => {
    it("should return knowledge base by id with userId", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(
        mockKnowledgeBase,
      );

      const result = await service.findById("kb-123", "user-1");

      expect(result).toEqual(mockKnowledgeBase);
    });

    it("should return knowledge base by id without userId", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(
        mockKnowledgeBase,
      );

      const result = await service.findById("kb-123");

      expect(result).toEqual(mockKnowledgeBase);
    });

    it("should throw NotFoundException when not found", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.findById("not-found", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("findByUser", () => {
    it("should return knowledge bases for user", async () => {
      (prisma.knowledgeBase.findMany as jest.Mock).mockResolvedValue([
        mockKnowledgeBase,
      ]);

      const result = await service.findByUser("user-1");

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
    });

    it("should return empty array when no knowledge bases", async () => {
      (prisma.knowledgeBase.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.findByUser("user-1");

      expect(result).toEqual([]);
    });
  });

  describe("update", () => {
    it("should update knowledge base fields", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(
        mockKnowledgeBase,
      );
      (prisma.knowledgeBase.update as jest.Mock).mockResolvedValue({
        ...mockKnowledgeBase,
        name: "Updated Name",
      });

      await service.update("kb-123", "user-1", { name: "Updated Name" });

      expect(prisma.knowledgeBase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "kb-123" },
          data: expect.objectContaining({ name: "Updated Name" }),
        }),
      );
    });

    it("should auto-connect Google Drive when adding as source type", async () => {
      const existingKb = {
        ...mockKnowledgeBase,
        googleDriveConnectionId: null,
      };
      const mockConnection = { id: "conn-456" };

      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(
        existingKb,
      );
      (prisma.googleDriveConnection.findUnique as jest.Mock).mockResolvedValue(
        mockConnection,
      );
      (prisma.knowledgeBase.update as jest.Mock).mockResolvedValue(existingKb);

      await service.update("kb-123", "user-1", {
        sourceTypes: ["GOOGLE_DRIVE"],
      });

      expect(prisma.knowledgeBase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            googleDriveConnectionId: "conn-456",
          }),
        }),
      );
    });
  });

  describe("delete", () => {
    it("should delete knowledge base and related data", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(
        mockKnowledgeBase,
      );
      (prisma.$transaction as jest.Mock).mockResolvedValue(undefined);

      await service.delete("kb-123", "user-1");

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should throw NotFoundException when not found", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.delete("not-found", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("addDocument", () => {
    it("should add document to knowledge base", async () => {
      const mockDoc = {
        id: "doc-123",
        knowledgeBaseId: "kb-123",
        title: "Test Doc",
        sourceType: "MANUAL",
        status: KnowledgeBaseStatus.PENDING,
      };
      (prisma.knowledgeBaseDocument.create as jest.Mock).mockResolvedValue(
        mockDoc,
      );

      const result = await service.addDocument("kb-123", {
        title: "Test Doc",
        sourceType: "MANUAL",
        content: "Test content",
      });

      expect(result).toEqual(mockDoc);
      expect(prisma.knowledgeBaseDocument.create).toHaveBeenCalled();
    });

    it("should sanitize NULL bytes in title and content", async () => {
      (prisma.knowledgeBaseDocument.create as jest.Mock).mockResolvedValue({
        id: "doc-123",
        title: "Test",
      });

      await service.addDocument("kb-123", {
        title: "Test\x00Title",
        sourceType: "MANUAL",
        content: "Content\x00With\x00Nulls",
      });

      const createCall = (prisma.knowledgeBaseDocument.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.title).not.toContain("\x00");
      expect(createCall.data.rawContent).not.toContain("\x00");
    });

    it("should use Untitled when title is empty after sanitization", async () => {
      (prisma.knowledgeBaseDocument.create as jest.Mock).mockResolvedValue({
        id: "doc-123",
        title: "Untitled",
      });

      await service.addDocument("kb-123", {
        title: "\x00\x00\x00",
        sourceType: "MANUAL",
        content: "Content",
      });

      const createCall = (prisma.knowledgeBaseDocument.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.title).toBe("Untitled");
    });
  });

  describe("processAllDocuments", () => {
    it("should process all documents and generate embeddings", async () => {
      (prisma.knowledgeBase.update as jest.Mock).mockResolvedValue(
        mockKnowledgeBase,
      );
      (
        documentProcessor.processAllPendingDocuments as jest.Mock
      ).mockResolvedValue(3);
      (
        embeddingProcessor.generateEmbeddingsForKnowledgeBase as jest.Mock
      ).mockResolvedValue({
        generatedCount: 15,
        totalNeeded: 15,
        failedBatches: 0,
      });

      const result = await service.processAllDocuments("kb-123");

      expect(result.processedCount).toBe(3);
      expect(result.embeddingCount).toBe(15);
      expect(documentProcessor.processAllPendingDocuments).toHaveBeenCalledWith(
        "kb-123",
      );
      expect(
        embeddingProcessor.generateEmbeddingsForKnowledgeBase,
      ).toHaveBeenCalledWith("kb-123");
    });

    it("should set KB status to ERROR on failure", async () => {
      (prisma.knowledgeBase.update as jest.Mock).mockResolvedValue(
        mockKnowledgeBase,
      );
      (
        documentProcessor.processAllPendingDocuments as jest.Mock
      ).mockRejectedValue(new Error("Processing failed"));

      await expect(service.processAllDocuments("kb-123")).rejects.toThrow(
        "Processing failed",
      );

      expect(prisma.knowledgeBase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: KnowledgeBaseStatus.ERROR }),
        }),
      );
    });
  });

  describe("getStats", () => {
    it("should return knowledge base statistics", async () => {
      (prisma.knowledgeBaseDocument.count as jest.Mock).mockResolvedValue(5);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          parent_count: BigInt(10),
          child_count: BigInt(50),
          embedding_count: BigInt(50),
          total_tokens: BigInt(25000),
        },
      ]);
      (prisma.knowledgeBase.findUnique as jest.Mock).mockResolvedValue({
        lastSyncedAt: new Date("2024-01-15"),
      });

      const result = await service.getStats("kb-123");

      expect(result).toEqual({
        documentCount: 5,
        parentChunkCount: 10,
        childChunkCount: 50,
        embeddingCount: 50,
        totalTokens: 25000,
        lastSyncedAt: expect.any(Date),
      });
    });

    it("should return zero stats when no data", async () => {
      (prisma.knowledgeBaseDocument.count as jest.Mock).mockResolvedValue(0);
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);
      (prisma.knowledgeBase.findUnique as jest.Mock).mockResolvedValue({
        lastSyncedAt: null,
      });

      const result = await service.getStats("kb-123");

      expect(result.documentCount).toBe(0);
      expect(result.parentChunkCount).toBe(0);
      expect(result.childChunkCount).toBe(0);
    });
  });

  describe("listDocuments", () => {
    it("should return list of documents with embedding counts", async () => {
      const mockDocs = [
        {
          id: "doc-1",
          title: "Test Doc",
          sourceType: "MANUAL",
          sourceUrl: null,
          mimeType: null,
          status: "READY",
          processedAt: new Date(),
          chunkCount: 5,
          lastError: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (prisma.knowledgeBaseDocument.findMany as jest.Mock).mockResolvedValue(
        mockDocs,
      );
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { document_id: "doc-1", embedding_count: BigInt(5) },
      ]);

      const result = await service.listDocuments("kb-123");

      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty("embeddingCount", 5);
      expect(result[0]).toHaveProperty("isVectorized", true);
    });
  });

  describe("deleteDocument", () => {
    it("should delete document and related data", async () => {
      const mockDoc = {
        id: "doc-1",
        knowledgeBase: { userId: "user-1" },
      };
      (prisma.knowledgeBaseDocument.findFirst as jest.Mock).mockResolvedValue(
        mockDoc,
      );
      (prisma.$transaction as jest.Mock).mockResolvedValue(undefined);

      await service.deleteDocument("doc-1", "user-1");

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should throw NotFoundException when document not found", async () => {
      (prisma.knowledgeBaseDocument.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.deleteDocument("not-found", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw when user does not own the document", async () => {
      (prisma.knowledgeBaseDocument.findFirst as jest.Mock).mockResolvedValue({
        id: "doc-1",
        knowledgeBase: { userId: "other-user" },
      });

      await expect(service.deleteDocument("doc-1", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("hasAccess", () => {
    it("should return true for knowledge base owner", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue({
        userId: "user-1",
        type: "PERSONAL",
      });

      const result = await service.hasAccess("kb-123", "user-1");

      expect(result).toBe(true);
    });

    it("should return false for non-existent knowledge base", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.hasAccess("not-found", "user-1");

      expect(result).toBe(false);
    });

    it("should return false for personal KB when user is not owner", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue({
        userId: "owner-user",
        type: "PERSONAL",
      });

      const result = await service.hasAccess("kb-123", "other-user");

      expect(result).toBe(false);
    });

    it("should return true for team KB when user is member", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue({
        userId: "owner-user",
        type: "TEAM",
      });
      (prisma.knowledgeBaseMember.findFirst as jest.Mock).mockResolvedValue({
        id: "member-1",
        role: "VIEWER",
      });

      const result = await service.hasAccess("kb-123", "member-user");

      expect(result).toBe(true);
    });

    it("should return false for team KB when user is not a member", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue({
        userId: "owner-user",
        type: "TEAM",
      });
      (prisma.knowledgeBaseMember.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.hasAccess("kb-123", "non-member");

      expect(result).toBe(false);
    });
  });

  describe("getResourcesByIds", () => {
    it("should return empty array for empty ids", async () => {
      const result = await service.getResourcesByIds([]);
      expect(result).toEqual([]);
    });

    it("should return resources by ids", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "Resource 1",
          content: "content",
          abstract: null,
          aiSummary: null,
          sourceUrl: "https://example.com",
          type: "ARTICLE",
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValue(mockResources);

      const result = await service.getResourcesByIds(["res-1"]);

      expect(result.length).toBe(1);
    });

    it("should merge YouTube transcripts into resources", async () => {
      const mockResources = [
        {
          id: "res-1",
          title: "YouTube Video",
          content: null,
          abstract: null,
          aiSummary: null,
          sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          type: "YOUTUBE_VIDEO",
        },
      ];
      const mockTranscripts = [
        {
          videoId: "dQw4w9WgXcQ",
          transcript: [{ text: "Hello world" }, { text: "from YouTube" }],
        },
      ];
      (prisma.resource.findMany as jest.Mock).mockResolvedValue(mockResources);
      (prisma.youTubeTranscriptCache.findMany as jest.Mock).mockResolvedValue(
        mockTranscripts,
      );

      const result = await service.getResourcesByIds(["res-1"]);

      expect(result[0].content).toContain("Hello world");
      expect(result[0].content).toContain("from YouTube");
    });
  });

  describe("getMembers", () => {
    it("should return members for owner", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue({
        id: "kb-123",
        userId: "user-1",
        type: "TEAM",
      });
      (prisma.knowledgeBaseMember.findFirst as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.knowledgeBaseMember.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getMembers("kb-123", "user-1");

      expect(Array.isArray(result)).toBe(true);
    });

    it("should throw NotFoundException when kb not found", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getMembers("not-found", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("addMember", () => {
    it("should add member to knowledge base", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue({
        id: "kb-123",
        userId: "user-1",
        type: "TEAM",
      });
      (prisma.knowledgeBaseMember.findFirst as jest.Mock)
        .mockResolvedValueOnce(null) // isAdmin check
        .mockResolvedValueOnce(null); // existing member check
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: "new-user",
        email: "new@example.com",
      });
      (prisma.knowledgeBaseMember.create as jest.Mock).mockResolvedValue({
        id: "member-1",
        user: { id: "new-user", email: "new@example.com" },
      });

      const result = await service.addMember(
        "kb-123",
        "user-1",
        "new@example.com",
        "VIEWER",
      );

      expect(result).toHaveProperty("id");
    });

    it("should throw when user not found by email", async () => {
      (prisma.knowledgeBase.findFirst as jest.Mock).mockResolvedValue({
        id: "kb-123",
        userId: "user-1",
        type: "TEAM",
      });
      (prisma.knowledgeBaseMember.findFirst as jest.Mock).mockResolvedValue(
        null,
      );
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.addMember("kb-123", "user-1", "notfound@example.com"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

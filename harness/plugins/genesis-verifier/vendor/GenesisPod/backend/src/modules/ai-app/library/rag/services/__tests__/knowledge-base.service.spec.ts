import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { KnowledgeBaseService } from "../knowledge-base.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { DocumentProcessorService } from "../document-processor.service";
import { EmbeddingProcessorService } from "../embedding-processor.service";
import { KnowledgeBaseStatus, KnowledgeBaseSourceType } from "@prisma/client";

const mockPrisma = {
  knowledgeBase: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  googleDriveConnection: {
    findUnique: jest.fn(),
  },
  knowledgeBaseDocument: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  knowledgeBaseMember: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
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
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
  $queryRaw: jest.fn(),
};

const mockDocumentProcessor = {
  processAllPendingDocuments: jest.fn(),
};

const mockEmbeddingProcessor = {
  generateEmbeddingsForKnowledgeBase: jest.fn(),
};

describe("KnowledgeBaseService", () => {
  let service: KnowledgeBaseService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeBaseService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: DocumentProcessorService,
          useValue: mockDocumentProcessor,
        },
        {
          provide: EmbeddingProcessorService,
          useValue: mockEmbeddingProcessor,
        },
      ],
    }).compile();

    service = module.get<KnowledgeBaseService>(KnowledgeBaseService);
  });

  // ─── create ──────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates a personal knowledge base without Google Drive", async () => {
      const kb = {
        id: "kb-1",
        name: "My KB",
        type: "PERSONAL",
        status: KnowledgeBaseStatus.PENDING,
      };
      mockPrisma.knowledgeBase.create.mockResolvedValueOnce(kb);

      const result = await service.create("user-1", {
        name: "My KB",
        sourceType: KnowledgeBaseSourceType.MANUAL,
      });

      expect(mockPrisma.knowledgeBase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "My KB",
            userId: "user-1",
            status: KnowledgeBaseStatus.PENDING,
            type: "PERSONAL",
          }),
        }),
      );
      expect(result.id).toBe("kb-1");
    });

    it("auto-detects Google Drive connection when sourceType is GOOGLE_DRIVE", async () => {
      mockPrisma.googleDriveConnection.findUnique.mockResolvedValueOnce({
        id: "conn-1",
      });
      mockPrisma.knowledgeBase.create.mockResolvedValueOnce({ id: "kb-2" });

      await service.create("user-1", {
        name: "Drive KB",
        sourceType: KnowledgeBaseSourceType.GOOGLE_DRIVE,
      });

      const createData = mockPrisma.knowledgeBase.create.mock.calls[0][0].data;
      expect(createData.googleDriveConnectionId).toBe("conn-1");
    });

    it("throws when GOOGLE_DRIVE is requested but no connection exists", async () => {
      mockPrisma.googleDriveConnection.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.create("user-1", {
          name: "Drive KB",
          sourceType: KnowledgeBaseSourceType.GOOGLE_DRIVE,
        }),
      ).rejects.toThrow("No Google Drive connection found");
    });

    it("uses sourceTypes array when provided", async () => {
      mockPrisma.knowledgeBase.create.mockResolvedValueOnce({ id: "kb-3" });

      await service.create("user-1", {
        name: "Multi KB",
        sourceType: KnowledgeBaseSourceType.MANUAL,
        sourceTypes: ["MANUAL", "URL"],
      });

      const createData = mockPrisma.knowledgeBase.create.mock.calls[0][0].data;
      expect(createData.sourceTypes).toEqual(["MANUAL", "URL"]);
    });

    it("falls back to [sourceType] when sourceTypes is empty", async () => {
      mockPrisma.knowledgeBase.create.mockResolvedValueOnce({ id: "kb-4" });

      await service.create("user-1", {
        name: "Single KB",
        sourceType: KnowledgeBaseSourceType.MANUAL,
        sourceTypes: [],
      });

      const createData = mockPrisma.knowledgeBase.create.mock.calls[0][0].data;
      expect(createData.sourceTypes).toEqual([KnowledgeBaseSourceType.MANUAL]);
    });
  });

  // ─── findById ────────────────────────────────────────────────────────────────

  describe("findById", () => {
    it("returns the knowledge base when found", async () => {
      const kb = { id: "kb-1", name: "Test KB" };
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce(kb);

      const result = await service.findById("kb-1", "user-1");

      expect(result).toEqual(kb);
    });

    it("throws NotFoundException when not found", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce(null);

      await expect(service.findById("missing", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("queries without userId filter when userId is omitted", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({ id: "kb-1" });

      await service.findById("kb-1");

      const whereArg =
        mockPrisma.knowledgeBase.findFirst.mock.calls[0][0].where;
      expect(whereArg).toEqual({ id: "kb-1" });
    });
  });

  // ─── findByUser ──────────────────────────────────────────────────────────────

  describe("findByUser", () => {
    it("merges owned and team-member KBs, deduplicating by id", async () => {
      const ownedKb = {
        id: "kb-1",
        createdAt: new Date("2024-01-02"),
        members: [],
        _count: { documents: 1 },
      };
      const teamKb = {
        id: "kb-2",
        createdAt: new Date("2024-01-01"),
        members: [],
        _count: { documents: 0 },
      };
      const duplicateTeamKb = {
        id: "kb-1", // duplicate of owned
        createdAt: new Date("2024-01-02"),
        members: [],
        _count: { documents: 1 },
      };

      mockPrisma.knowledgeBase.findMany
        .mockResolvedValueOnce([ownedKb])
        .mockResolvedValueOnce([teamKb, duplicateTeamKb]);

      const result = await service.findByUser("user-1");

      expect(result).toHaveLength(2);
      expect(result.map((kb) => kb.id)).toEqual(["kb-1", "kb-2"]);
    });

    it("returns only owned KBs when no team memberships", async () => {
      const ownedKb = {
        id: "kb-1",
        createdAt: new Date(),
        members: [],
        _count: { documents: 1 },
      };
      mockPrisma.knowledgeBase.findMany
        .mockResolvedValueOnce([ownedKb])
        .mockResolvedValueOnce([]);

      const result = await service.findByUser("user-1");

      expect(result).toHaveLength(1);
    });

    it("sorts merged results by createdAt descending", async () => {
      const older = {
        id: "kb-old",
        createdAt: new Date("2024-01-01"),
        members: [],
        _count: { documents: 0 },
      };
      const newer = {
        id: "kb-new",
        createdAt: new Date("2024-06-01"),
        members: [],
        _count: { documents: 0 },
      };
      mockPrisma.knowledgeBase.findMany
        .mockResolvedValueOnce([older])
        .mockResolvedValueOnce([newer]);

      const result = await service.findByUser("user-1");

      expect(result[0].id).toBe("kb-new");
      expect(result[1].id).toBe("kb-old");
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates name and description", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        googleDriveConnectionId: null,
      });
      mockPrisma.knowledgeBase.update.mockResolvedValueOnce({ id: "kb-1" });

      await service.update("kb-1", "user-1", { name: "New Name" });

      expect(mockPrisma.knowledgeBase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: "New Name" }),
        }),
      );
    });

    it("auto-connects Google Drive when adding GOOGLE_DRIVE as source type", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        googleDriveConnectionId: null,
      });
      mockPrisma.googleDriveConnection.findUnique.mockResolvedValueOnce({
        id: "conn-1",
      });
      mockPrisma.knowledgeBase.update.mockResolvedValueOnce({ id: "kb-1" });

      await service.update("kb-1", "user-1", {
        sourceTypes: ["MANUAL", "GOOGLE_DRIVE"],
      });

      const updateData = mockPrisma.knowledgeBase.update.mock.calls[0][0].data;
      expect(updateData.googleDriveConnectionId).toBe("conn-1");
    });

    it("throws if GOOGLE_DRIVE is added but no connection found", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        googleDriveConnectionId: null,
      });
      mockPrisma.googleDriveConnection.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.update("kb-1", "user-1", {
          sourceTypes: ["GOOGLE_DRIVE"],
        }),
      ).rejects.toThrow("No Google Drive connection found");
    });
  });

  // ─── delete ──────────────────────────────────────────────────────────────────

  describe("delete", () => {
    it("runs transaction to delete all related data then the KB", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({ id: "kb-1" });
      mockPrisma.$transaction.mockResolvedValueOnce(undefined);

      await service.delete("kb-1", "user-1");

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("throws NotFoundException if KB does not exist", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce(null);

      await expect(service.delete("missing", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── addDocument ─────────────────────────────────────────────────────────────

  describe("addDocument", () => {
    it("creates a document with PENDING status and sanitized fields", async () => {
      const doc = {
        id: "doc-1",
        title: "Test Doc",
        status: KnowledgeBaseStatus.PENDING,
      };
      mockPrisma.knowledgeBaseDocument.create.mockResolvedValueOnce(doc);

      const result = await service.addDocument("kb-1", {
        title: "Test Doc",
        sourceType: "MANUAL",
        content: "Some content",
      });

      expect(mockPrisma.knowledgeBaseDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            knowledgeBaseId: "kb-1",
            status: KnowledgeBaseStatus.PENDING,
          }),
        }),
      );
      expect(result.id).toBe("doc-1");
    });

    it("strips NULL bytes from title and content", async () => {
      mockPrisma.knowledgeBaseDocument.create.mockResolvedValueOnce({
        id: "doc-2",
      });

      await service.addDocument("kb-1", {
        title: "Title\x00With\x00Nulls",
        sourceType: "MANUAL",
        content: "Content\x00Data",
      });

      const createData =
        mockPrisma.knowledgeBaseDocument.create.mock.calls[0][0].data;
      expect(createData.title).not.toContain("\x00");
      expect(createData.rawContent).not.toContain("\x00");
    });

    it("uses Untitled as fallback when title is empty after sanitization", async () => {
      mockPrisma.knowledgeBaseDocument.create.mockResolvedValueOnce({
        id: "doc-3",
      });

      await service.addDocument("kb-1", {
        title: "\x00\x00",
        sourceType: "MANUAL",
        content: "Content",
      });

      const createData =
        mockPrisma.knowledgeBaseDocument.create.mock.calls[0][0].data;
      expect(createData.title).toBe("Untitled");
    });
  });

  // ─── processAllDocuments ──────────────────────────────────────────────────────

  describe("processAllDocuments", () => {
    it("sets KB to PROCESSING, processes documents, then sets to READY", async () => {
      mockPrisma.knowledgeBase.update.mockResolvedValue({ id: "kb-1" });
      mockDocumentProcessor.processAllPendingDocuments.mockResolvedValueOnce(3);
      mockEmbeddingProcessor.generateEmbeddingsForKnowledgeBase.mockResolvedValueOnce(
        { generatedCount: 150, totalNeeded: 150, failedBatches: 0 },
      );

      const result = await service.processAllDocuments("kb-1");

      // 第一次：切 PROCESSING + 清 lastError
      expect(mockPrisma.knowledgeBase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: KnowledgeBaseStatus.PROCESSING,
          }),
        }),
      );
      expect(result.processedCount).toBe(3);
      expect(result.embeddingCount).toBe(150);

      const lastUpdateCall =
        mockPrisma.knowledgeBase.update.mock.calls[
          mockPrisma.knowledgeBase.update.mock.calls.length - 1
        ][0];
      expect(lastUpdateCall.data.status).toBe(KnowledgeBaseStatus.READY);
    });

    it("sets KB to ERROR with lastError when 0 embeddings generated (full failure)", async () => {
      mockPrisma.knowledgeBase.update.mockResolvedValue({ id: "kb-1" });
      mockDocumentProcessor.processAllPendingDocuments.mockResolvedValueOnce(2);
      mockEmbeddingProcessor.generateEmbeddingsForKnowledgeBase.mockResolvedValueOnce(
        {
          generatedCount: 0,
          totalNeeded: 100,
          failedBatches: 2,
          lastError:
            "Embedding circuit-open (0 recent 429s). Upstream rate-limit cooldown until 2026-05-11T21:28:45.615Z",
        },
      );

      const result = await service.processAllDocuments("kb-1");

      const lastUpdateCall =
        mockPrisma.knowledgeBase.update.mock.calls[
          mockPrisma.knowledgeBase.update.mock.calls.length - 1
        ][0];
      expect(lastUpdateCall.data.status).toBe(KnowledgeBaseStatus.ERROR);
      expect(lastUpdateCall.data.lastError).toMatch(/向量化失败|熔断|限流|429/);
      expect(result.embeddingCount).toBe(0);
    });

    it("sets KB to ERROR for partial failure (X < N)", async () => {
      mockPrisma.knowledgeBase.update.mockResolvedValue({ id: "kb-1" });
      mockDocumentProcessor.processAllPendingDocuments.mockResolvedValueOnce(2);
      mockEmbeddingProcessor.generateEmbeddingsForKnowledgeBase.mockResolvedValueOnce(
        {
          generatedCount: 50,
          totalNeeded: 100,
          failedBatches: 1,
          lastError: "Network error",
        },
      );

      const result = await service.processAllDocuments("kb-1");

      const lastUpdateCall =
        mockPrisma.knowledgeBase.update.mock.calls[
          mockPrisma.knowledgeBase.update.mock.calls.length - 1
        ][0];
      expect(lastUpdateCall.data.status).toBe(KnowledgeBaseStatus.ERROR);
      expect(lastUpdateCall.data.lastError).toMatch(/部分失败|50\/100/);
      expect(result.embeddingCount).toBe(50);
    });

    it("sets KB to ERROR status when processing throws", async () => {
      mockPrisma.knowledgeBase.update.mockResolvedValue({ id: "kb-1" });
      mockDocumentProcessor.processAllPendingDocuments.mockRejectedValueOnce(
        new Error("processing failed"),
      );

      await expect(service.processAllDocuments("kb-1")).rejects.toThrow(
        "processing failed",
      );

      const lastUpdateCall =
        mockPrisma.knowledgeBase.update.mock.calls[
          mockPrisma.knowledgeBase.update.mock.calls.length - 1
        ][0];
      expect(lastUpdateCall.data.status).toBe(KnowledgeBaseStatus.ERROR);
      expect(lastUpdateCall.data.lastError).toBe("processing failed");
    });
  });

  // ─── getStats ────────────────────────────────────────────────────────────────

  describe("getStats", () => {
    it("returns stats with counts converted from BigInt", async () => {
      mockPrisma.knowledgeBaseDocument.count.mockResolvedValueOnce(5);
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          parent_count: BigInt(10),
          child_count: BigInt(30),
          embedding_count: BigInt(30),
          total_tokens: BigInt(5000),
        },
      ]);
      mockPrisma.knowledgeBase.findUnique.mockResolvedValueOnce({
        lastSyncedAt: new Date("2024-06-01"),
      });

      const stats = await service.getStats("kb-1");

      expect(stats.documentCount).toBe(5);
      expect(stats.parentChunkCount).toBe(10);
      expect(stats.childChunkCount).toBe(30);
      expect(stats.embeddingCount).toBe(30);
      expect(stats.totalTokens).toBe(5000);
    });

    it("returns zeroed stats when queryRaw returns empty array", async () => {
      mockPrisma.knowledgeBaseDocument.count.mockResolvedValueOnce(0);
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);
      mockPrisma.knowledgeBase.findUnique.mockResolvedValueOnce(null);

      const stats = await service.getStats("kb-empty");

      expect(stats.documentCount).toBe(0);
      expect(stats.parentChunkCount).toBe(0);
      expect(stats.embeddingCount).toBe(0);
    });
  });

  // ─── listDocuments ───────────────────────────────────────────────────────────

  describe("listDocuments", () => {
    it("returns documents with embeddingCount and isVectorized flag", async () => {
      mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValueOnce([
        { id: "doc-1", status: "READY" },
        { id: "doc-2", status: "PENDING" },
      ]);
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { document_id: "doc-1", embedding_count: BigInt(10) },
      ]);

      const docs = await service.listDocuments("kb-1");

      expect(docs).toHaveLength(2);
      expect(docs[0].embeddingCount).toBe(10);
      expect(docs[0].isVectorized).toBe(true);
      expect(docs[1].embeddingCount).toBe(0);
      expect(docs[1].isVectorized).toBe(false);
    });
  });

  // ─── deleteDocument ──────────────────────────────────────────────────────────

  describe("deleteDocument", () => {
    it("deletes the document via transaction", async () => {
      mockPrisma.knowledgeBaseDocument.findFirst.mockResolvedValueOnce({
        id: "doc-1",
        knowledgeBase: { userId: "user-1" },
      });
      mockPrisma.$transaction.mockResolvedValueOnce(undefined);

      await service.deleteDocument("doc-1", "user-1");

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("throws NotFoundException when document not found", async () => {
      mockPrisma.knowledgeBaseDocument.findFirst.mockResolvedValueOnce(null);

      await expect(service.deleteDocument("missing", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when user does not own the document", async () => {
      mockPrisma.knowledgeBaseDocument.findFirst.mockResolvedValueOnce({
        id: "doc-1",
        knowledgeBase: { userId: "other-user" },
      });

      await expect(service.deleteDocument("doc-1", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getMembers ───────────────────────────────────────────────────────────────

  describe("getMembers", () => {
    it("returns members when requester is the owner", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "user-1",
        type: "TEAM",
      });
      // isMember check
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce(null);
      mockPrisma.knowledgeBaseMember.findMany.mockResolvedValueOnce([
        { id: "m-1", userId: "user-2" },
      ]);

      const members = await service.getMembers("kb-1", "user-1");

      expect(members).toHaveLength(1);
    });

    it("returns members when requester is a member", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "user-owner",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce({
        id: "m-1",
        userId: "user-member",
      });
      mockPrisma.knowledgeBaseMember.findMany.mockResolvedValueOnce([
        { id: "m-1" },
      ]);

      const members = await service.getMembers("kb-1", "user-member");

      expect(members).toHaveLength(1);
    });

    it("throws NotFoundException when KB not found", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce(null);

      await expect(service.getMembers("missing", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when requester has no access", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "user-owner",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce(null);

      await expect(service.getMembers("kb-1", "outsider")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── addMember ────────────────────────────────────────────────────────────────

  describe("addMember", () => {
    it("adds a member with default VIEWER role", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner-id",
        type: "TEAM",
      });
      // requesterMembership check
      mockPrisma.knowledgeBaseMember.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null); // existingMember check
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        id: "new-user-id",
        email: "new@example.com",
      });
      mockPrisma.knowledgeBaseMember.create.mockResolvedValueOnce({
        id: "m-new",
        role: "VIEWER",
      });

      const result = await service.addMember(
        "kb-1",
        "owner-id",
        "new@example.com",
      );

      expect(result).toEqual({ id: "m-new", role: "VIEWER" });
    });

    it("throws when requester has no permission", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner-id",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.addMember("kb-1", "non-owner", "new@example.com"),
      ).rejects.toThrow("You do not have permission to add members");
    });

    it("throws when user to add is not found", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner-id",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.addMember("kb-1", "owner-id", "notfound@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws when user is already a member", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner-id",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        id: "user-2",
        email: "user2@example.com",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce({
        id: "m-existing",
      });

      await expect(
        service.addMember("kb-1", "owner-id", "user2@example.com"),
      ).rejects.toThrow("User is already a member");
    });

    it("throws when trying to add owner as member", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner-id",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        id: "owner-id",
        email: "owner@example.com",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.addMember("kb-1", "owner-id", "owner@example.com"),
      ).rejects.toThrow("Owner cannot be added as a member");
    });
  });

  // ─── hasAccess ───────────────────────────────────────────────────────────────

  describe("hasAccess", () => {
    it("returns true for the owner", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "user-1",
        type: "PERSONAL",
      });

      const access = await service.hasAccess("kb-1", "user-1");

      expect(access).toBe(true);
    });

    it("returns false for a non-owner on a PERSONAL KB", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner",
        type: "PERSONAL",
      });

      const access = await service.hasAccess("kb-1", "outsider");

      expect(access).toBe(false);
    });

    it("returns false when KB does not exist", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce(null);

      const access = await service.hasAccess("missing", "user-1");

      expect(access).toBe(false);
    });

    it("returns true for a TEAM KB member with sufficient role", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce({
        id: "m-1",
        role: "EDITOR",
      });

      const access = await service.hasAccess("kb-1", "editor-user", "EDITOR");

      expect(access).toBe(true);
    });

    it("returns false for a TEAM KB member with insufficient role", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce({
        id: "m-1",
        role: "VIEWER",
      });

      const access = await service.hasAccess("kb-1", "viewer-user", "ADMIN");

      expect(access).toBe(false);
    });

    it("returns false when user is not a member of TEAM KB", async () => {
      mockPrisma.knowledgeBase.findFirst.mockResolvedValueOnce({
        id: "kb-1",
        userId: "owner",
        type: "TEAM",
      });
      mockPrisma.knowledgeBaseMember.findFirst.mockResolvedValueOnce(null);

      const access = await service.hasAccess("kb-1", "outsider");

      expect(access).toBe(false);
    });
  });

  // ─── getResourcesByIds ────────────────────────────────────────────────────────

  describe("getResourcesByIds", () => {
    it("returns empty array for empty input", async () => {
      const result = await service.getResourcesByIds([]);

      expect(result).toEqual([]);
      expect(mockPrisma.resource.findMany).not.toHaveBeenCalled();
    });

    it("returns resources with merged YouTube transcript content", async () => {
      const resources = [
        {
          id: "res-1",
          title: "YT Video",
          content: null,
          abstract: null,
          aiSummary: null,
          sourceUrl: "https://youtube.com/watch?v=abc12345678",
          type: "YOUTUBE_VIDEO",
        },
      ];
      mockPrisma.resource.findMany.mockResolvedValueOnce(resources);
      mockPrisma.youTubeTranscriptCache.findMany.mockResolvedValueOnce([
        {
          videoId: "abc12345678",
          transcript: [{ text: "Hello world" }, { text: "Goodbye world" }],
        },
      ]);

      const result = await service.getResourcesByIds(["res-1"]);

      expect(result[0].content).toBe("Hello world Goodbye world");
    });

    it("does not fetch transcripts for non-YouTube resources", async () => {
      const resources = [
        {
          id: "res-1",
          title: "Article",
          content: "Full text",
          abstract: null,
          aiSummary: null,
          sourceUrl: "https://example.com/article",
          type: "NEWS",
        },
      ];
      mockPrisma.resource.findMany.mockResolvedValueOnce(resources);

      await service.getResourcesByIds(["res-1"]);

      expect(mockPrisma.youTubeTranscriptCache.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── getDocumentById ─────────────────────────────────────────────────────────

  describe("getDocumentById", () => {
    it("returns the document by id", async () => {
      const doc = { id: "doc-1", title: "Test" };
      mockPrisma.knowledgeBaseDocument.findUnique.mockResolvedValueOnce(doc);

      const result = await service.getDocumentById("doc-1");

      expect(result).toEqual(doc);
    });

    it("returns null when document is not found", async () => {
      mockPrisma.knowledgeBaseDocument.findUnique.mockResolvedValueOnce(null);

      const result = await service.getDocumentById("missing");

      expect(result).toBeNull();
    });
  });
});

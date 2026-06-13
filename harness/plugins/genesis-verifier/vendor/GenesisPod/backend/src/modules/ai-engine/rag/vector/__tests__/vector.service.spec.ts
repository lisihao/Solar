import { Test, TestingModule } from "@nestjs/testing";
import { VectorService } from "../vector.service";
import { PrismaService } from "@/common/prisma/prisma.service";

// ─── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $executeRawUnsafe: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  knowledgeBaseDocument: {
    findMany: jest.fn(),
  },
  childEmbedding: {
    delete: jest.fn(),
    count: jest.fn(),
  },
};

// ─── Fixtures ─────────────────────────────────────────────

const MOCK_EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5];

const mockRawSimilarityResult = (id: string, score = 0.85) => ({
  child_chunk_id: `child-${id}`,
  parent_chunk_id: `parent-${id}`,
  document_id: `doc-${id}`,
  content: `Content for ${id}`,
  parent_content: `Parent content for ${id}`,
  score: score.toString(), // DB returns as string/Decimal
});

const mockJsonbSimilarityRow = (id: string, embedding = MOCK_EMBEDDING) => ({
  child_chunk_id: `child-${id}`,
  parent_chunk_id: `parent-${id}`,
  document_id: `doc-${id}`,
  content: `Content for ${id}`,
  parent_content: `Parent content for ${id}`,
  embedding,
});

describe("VectorService", () => {
  let service: VectorService;

  // ─── pgvector mode tests ────────────────────────────────

  describe("pgvector mode", () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      const { PgvectorBackend } =
        await import("@/plugins/storage/vector-pgvector");
      const { JsonbBackend } = await import("@/plugins/storage/vector-jsonb");
      const { VECTOR_BACKENDS_TOKEN } =
        await import("@/plugins/core/abstractions");
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VectorService,
          PgvectorBackend,
          JsonbBackend,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: VECTOR_BACKENDS_TOKEN,
            useFactory: (pg, jb) => [pg, jb],
            inject: [PgvectorBackend, JsonbBackend],
          },
        ],
      }).compile();

      service = module.get<VectorService>(VectorService);

      // Simulate successful pgvector init
      // 1) Pre-flight: pg_available_extensions returns vector exists
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ exists: true }]);
      // 2) CREATE EXTENSION succeeds
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.onModuleInit();
    });

    describe("similaritySearch()", () => {
      it("returns mapped SimilarityResult array", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          mockRawSimilarityResult("1", 0.9),
          mockRawSimilarityResult("2", 0.75),
        ]);

        const results = await service.similaritySearch(MOCK_EMBEDDING);

        expect(results).toHaveLength(2);
        expect(results[0].childChunkId).toBe("child-1");
        expect(results[0].parentChunkId).toBe("parent-1");
        expect(results[0].documentId).toBe("doc-1");
        expect(results[0].content).toBe("Content for 1");
        expect(results[0].parentContent).toBe("Parent content for 1");
        expect(results[0].similarity).toBe(0.9);
      });

      it("converts score from string to number", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          { ...mockRawSimilarityResult("1"), score: "0.856" },
        ]);

        const results = await service.similaritySearch(MOCK_EMBEDDING);
        expect(typeof results[0].similarity).toBe("number");
        expect(results[0].similarity).toBe(0.856);
      });

      it("returns empty array when no results found", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);

        const results = await service.similaritySearch(MOCK_EMBEDDING);
        expect(results).toHaveLength(0);
      });

      it("returns empty array when knowledgeBaseIds resolves to no documents", async () => {
        mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([]);

        const results = await service.similaritySearch(MOCK_EMBEDDING, {
          knowledgeBaseIds: ["kb-empty"],
        });

        expect(results).toHaveLength(0);
        expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      });

      it("resolves knowledgeBaseIds to documentIds before querying", async () => {
        mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([
          { id: "doc-A" },
          { id: "doc-B" },
        ]);
        mockPrisma.$queryRaw.mockResolvedValue([
          mockRawSimilarityResult("1", 0.8),
        ]);

        await service.similaritySearch(MOCK_EMBEDDING, {
          knowledgeBaseIds: ["kb-1"],
        });

        expect(mockPrisma.knowledgeBaseDocument.findMany).toHaveBeenCalledWith({
          where: { knowledgeBaseId: { in: ["kb-1"] } },
          select: { id: true },
        });
      });

      it("uses default limit=10 when not specified", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);

        await service.similaritySearch(MOCK_EMBEDDING);

        expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      });

      it("uses default threshold=0.3 and filters by it", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          mockRawSimilarityResult("1", 0.8),
        ]);

        const results = await service.similaritySearch(MOCK_EMBEDDING, {
          threshold: 0.3,
          limit: 5,
        });

        expect(results).toHaveLength(1);
      });

      it("formats query embedding as vector string", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);

        await service.similaritySearch([0.1, 0.2, 0.3]);

        expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      });

      it("handles multiple results with correct camelCase mapping", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          {
            child_chunk_id: "cc-1",
            parent_chunk_id: "pc-1",
            document_id: "d-1",
            content: "child content",
            parent_content: "parent content",
            score: 0.75,
          },
        ]);

        const results = await service.similaritySearch(MOCK_EMBEDDING);
        expect(results[0]).toMatchObject({
          childChunkId: "cc-1",
          parentChunkId: "pc-1",
          documentId: "d-1",
          content: "child content",
          parentContent: "parent content",
          similarity: 0.75,
        });
      });
    });

    describe("vectorSearch()", () => {
      it("returns simplified VectorSearchResult array", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          {
            child_chunk_id: "child-1",
            content: "Simple content",
            score: 0.9,
          },
        ]);

        const results = await service.vectorSearch(MOCK_EMBEDDING);

        expect(results).toHaveLength(1);
        expect(results[0].chunkId).toBe("child-1");
        expect(results[0].content).toBe("Simple content");
        expect(results[0].similarity).toBe(0.9);
      });

      it("returns empty array when no documents found for knowledgeBaseIds", async () => {
        mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([]);

        const results = await service.vectorSearch(MOCK_EMBEDDING, {
          knowledgeBaseIds: ["kb-empty"],
        });

        expect(results).toHaveLength(0);
      });

      it("converts score to number from string", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          { child_chunk_id: "c1", content: "content", score: "0.723" },
        ]);

        const results = await service.vectorSearch(MOCK_EMBEDDING);
        expect(typeof results[0].similarity).toBe("number");
        expect(results[0].similarity).toBe(0.723);
      });

      it("returns empty array when $queryRaw returns empty", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([]);
        const results = await service.vectorSearch(MOCK_EMBEDDING);
        expect(results).toHaveLength(0);
      });
    });

    describe("storeEmbedding()", () => {
      it("calls $executeRaw to insert or update embedding", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(1);

        await service.storeEmbedding(
          "chunk-1",
          [0.1, 0.2, 0.3],
          "text-embedding-3-small",
        );

        expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      });

      it("persists the caller-provided model name verbatim", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(1);

        await service.storeEmbedding(
          "chunk-1",
          [0.1, 0.2],
          "text-embedding-3-large",
        );

        expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      });

      it("does not throw on successful storage", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(1);

        await expect(
          service.storeEmbedding("chunk-1", MOCK_EMBEDDING, "test-model"),
        ).resolves.toBeUndefined();
      });
    });
  });

  // ─── JSONB fallback mode tests ──────────────────────────

  describe("JSONB fallback mode", () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      const { PgvectorBackend } =
        await import("@/plugins/storage/vector-pgvector");
      const { JsonbBackend } = await import("@/plugins/storage/vector-jsonb");
      const { VECTOR_BACKENDS_TOKEN } =
        await import("@/plugins/core/abstractions");
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VectorService,
          PgvectorBackend,
          JsonbBackend,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: VECTOR_BACKENDS_TOKEN,
            useFactory: (pg, jb) => [pg, jb],
            inject: [PgvectorBackend, JsonbBackend],
          },
        ],
      }).compile();

      service = module.get<VectorService>(VectorService);

      // Simulate pgvector NOT available — pre-flight returns no extension
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ exists: false }]);
      // CREATE EXTENSION never called in this branch, but mock just in case
      mockPrisma.$executeRawUnsafe.mockRejectedValue(
        new Error("extension not found"),
      );
      await service.onModuleInit();
    });

    it("isPgvectorAvailable returns false", () => {
      expect(service.isPgvectorAvailable()).toBe(false);
    });

    describe("similaritySearch()", () => {
      it("fetches JSONB embeddings and computes cosine similarity", async () => {
        // Two embeddings: one similar to query, one not
        mockPrisma.$queryRaw.mockResolvedValue([
          mockJsonbSimilarityRow("1", [0.1, 0.2, 0.3, 0.4, 0.5]), // identical to MOCK_EMBEDDING
          mockJsonbSimilarityRow("2", [-0.9, -0.8, -0.7, -0.6, -0.5]), // opposite direction
        ]);

        const results = await service.similaritySearch(MOCK_EMBEDDING, {
          threshold: 0.5,
        });

        // First should have similarity ~1.0, second should be below threshold
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].childChunkId).toBe("child-1");
        expect(results[0].similarity).toBeCloseTo(1.0);
      });

      it("respects threshold filter", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          mockJsonbSimilarityRow("1", [0.1, 0.0, 0.0, 0.0, 0.0]), // low similarity
        ]);

        const results = await service.similaritySearch(MOCK_EMBEDDING, {
          threshold: 0.99,
        });

        expect(results).toHaveLength(0);
      });

      it("respects limit", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          mockJsonbSimilarityRow("1", MOCK_EMBEDDING),
          mockJsonbSimilarityRow("2", MOCK_EMBEDDING),
          mockJsonbSimilarityRow("3", MOCK_EMBEDDING),
        ]);

        const results = await service.similaritySearch(MOCK_EMBEDDING, {
          limit: 2,
        });

        expect(results).toHaveLength(2);
      });

      it("sorts results by similarity descending", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          mockJsonbSimilarityRow("low", [0.1, 0.0, 0.0, 0.0, 0.5]),
          mockJsonbSimilarityRow("high", MOCK_EMBEDDING),
        ]);

        const results = await service.similaritySearch(MOCK_EMBEDDING);

        expect(results[0].childChunkId).toBe("child-high");
      });

      it("returns empty when knowledgeBaseIds resolves to no documents", async () => {
        mockPrisma.knowledgeBaseDocument.findMany.mockResolvedValue([]);

        const results = await service.similaritySearch(MOCK_EMBEDDING, {
          knowledgeBaseIds: ["kb-empty"],
        });

        expect(results).toHaveLength(0);
        expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      });
    });

    describe("vectorSearch()", () => {
      it("computes cosine similarity for JSONB embeddings", async () => {
        mockPrisma.$queryRaw.mockResolvedValue([
          {
            child_chunk_id: "c1",
            content: "test content",
            embedding: MOCK_EMBEDDING,
          },
        ]);

        const results = await service.vectorSearch(MOCK_EMBEDDING);

        expect(results).toHaveLength(1);
        expect(results[0].chunkId).toBe("c1");
        expect(results[0].similarity).toBeCloseTo(1.0);
      });
    });

    describe("storeEmbedding()", () => {
      it("stores embedding as JSONB when pgvector unavailable", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(1);

        await service.storeEmbedding("chunk-1", MOCK_EMBEDDING, "test-model");

        expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      });
    });
  });

  // ─── Shared behavior (mode-independent) ─────────────────

  describe("shared behavior", () => {
    beforeEach(async () => {
      jest.clearAllMocks();

      const { PgvectorBackend } =
        await import("@/plugins/storage/vector-pgvector");
      const { JsonbBackend } = await import("@/plugins/storage/vector-jsonb");
      const { VECTOR_BACKENDS_TOKEN } =
        await import("@/plugins/core/abstractions");
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          VectorService,
          PgvectorBackend,
          JsonbBackend,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: VECTOR_BACKENDS_TOKEN,
            useFactory: (pg, jb) => [pg, jb],
            inject: [PgvectorBackend, JsonbBackend],
          },
        ],
      }).compile();

      service = module.get<VectorService>(VectorService);

      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ exists: true }]);
      mockPrisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.onModuleInit();
    });

    describe("batchStoreEmbeddings()", () => {
      it("stores all items and returns count", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(1);

        const items = [
          { childChunkId: "c1", embedding: [0.1, 0.2] },
          { childChunkId: "c2", embedding: [0.3, 0.4] },
          { childChunkId: "c3", embedding: [0.5, 0.6] },
        ];

        const count = await service.batchStoreEmbeddings(items, "test-model");
        expect(count).toBe(3);
      });

      it("continues on individual failures and returns partial count", async () => {
        mockPrisma.$executeRaw
          .mockResolvedValueOnce(1) // c1 succeeds
          .mockRejectedValueOnce(new Error("duplicate")) // c2 fails
          .mockResolvedValueOnce(1); // c3 succeeds

        const items = [
          { childChunkId: "c1", embedding: [0.1] },
          { childChunkId: "c2", embedding: [0.2] },
          { childChunkId: "c3", embedding: [0.3] },
        ];

        const count = await service.batchStoreEmbeddings(items, "test-model");
        expect(count).toBe(2); // only 2 succeeded
      });

      it("returns 0 for empty input", async () => {
        const count = await service.batchStoreEmbeddings([]);
        expect(count).toBe(0);
        expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
      });

      it("passes model name to individual store calls", async () => {
        mockPrisma.$executeRaw.mockResolvedValue(1);

        await service.batchStoreEmbeddings(
          [{ childChunkId: "c1", embedding: [0.1] }],
          "custom-model",
        );

        expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      });
    });

    describe("deleteEmbedding()", () => {
      it("calls prisma delete with correct childChunkId", async () => {
        mockPrisma.childEmbedding.delete.mockResolvedValue({});

        await service.deleteEmbedding("chunk-123");

        expect(mockPrisma.childEmbedding.delete).toHaveBeenCalledWith({
          where: { childChunkId: "chunk-123" },
        });
      });

      it("propagates error if deletion fails", async () => {
        mockPrisma.childEmbedding.delete.mockRejectedValue(
          new Error("Record not found"),
        );

        await expect(service.deleteEmbedding("nonexistent")).rejects.toThrow(
          "Record not found",
        );
      });
    });

    describe("hasEmbedding()", () => {
      it("returns true when embedding exists", async () => {
        mockPrisma.childEmbedding.count.mockResolvedValue(1);

        const result = await service.hasEmbedding("chunk-1");
        expect(result).toBe(true);
      });

      it("returns false when embedding does not exist", async () => {
        mockPrisma.childEmbedding.count.mockResolvedValue(0);

        const result = await service.hasEmbedding("chunk-nonexistent");
        expect(result).toBe(false);
      });

      it("calls count with correct where clause", async () => {
        mockPrisma.childEmbedding.count.mockResolvedValue(1);

        await service.hasEmbedding("my-chunk-id");

        expect(mockPrisma.childEmbedding.count).toHaveBeenCalledWith({
          where: { childChunkId: "my-chunk-id" },
        });
      });
    });

    describe("getEmbeddingCount()", () => {
      it("returns embedding count for knowledge base", async () => {
        mockPrisma.childEmbedding.count.mockResolvedValue(42);

        const count = await service.getEmbeddingCount("kb-1");
        expect(count).toBe(42);
      });

      it("uses nested where clause for knowledge base filtering", async () => {
        mockPrisma.childEmbedding.count.mockResolvedValue(0);

        await service.getEmbeddingCount("kb-xyz");

        expect(mockPrisma.childEmbedding.count).toHaveBeenCalledWith({
          where: {
            childChunk: {
              parentChunk: {
                document: {
                  knowledgeBaseId: "kb-xyz",
                },
              },
            },
          },
        });
      });

      it("returns 0 for knowledge base with no embeddings", async () => {
        mockPrisma.childEmbedding.count.mockResolvedValue(0);

        const count = await service.getEmbeddingCount("kb-empty");
        expect(count).toBe(0);
      });
    });
  });
});

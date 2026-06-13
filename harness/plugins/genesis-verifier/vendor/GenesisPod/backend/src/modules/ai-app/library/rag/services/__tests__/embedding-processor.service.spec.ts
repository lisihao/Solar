import { Test, TestingModule } from "@nestjs/testing";
import { EmbeddingProcessorService } from "../embedding-processor.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { RAGFacade } from "@/modules/ai-harness/facade";
import { AiModelConfigService } from "@/modules/ai-engine/facade";

describe("EmbeddingProcessorService", () => {
  let service: EmbeddingProcessorService;
  let prisma: jest.Mocked<PrismaService>;

  const mockEmbeddingService = {
    getModel: jest.fn().mockResolvedValue("text-embedding-3-small"),
    generateEmbeddings: jest.fn().mockResolvedValue({
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
    }),
  };

  const mockVectorService = {
    storeEmbedding: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const mockPrisma = {
      childChunk: {
        findMany: jest.fn(),
      },
      knowledgeBase: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const mockAiFacade = {
      embedding: mockEmbeddingService,
      vector: mockVectorService,
    };

    // pickBYOKModelForUser 默认 openai 高 RPM（避免测试因节流变慢）
    const mockAiModelConfig = {
      pickBYOKModelForUser: jest.fn().mockResolvedValue({
        provider: "openai",
        rpmLimit: 3000, // 高 RPM → 几乎不限速
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingProcessorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RAGFacade, useValue: mockAiFacade },
        { provide: AiModelConfigService, useValue: mockAiModelConfig },
      ],
    }).compile();

    service = module.get<EmbeddingProcessorService>(EmbeddingProcessorService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Reset once-queues to prevent bleed-through between tests
    mockEmbeddingService.generateEmbeddings.mockReset();
    mockEmbeddingService.getModel.mockReset();
    // Re-apply default implementations
    mockEmbeddingService.generateEmbeddings.mockResolvedValue({
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
    });
    mockEmbeddingService.getModel.mockResolvedValue("text-embedding-3-small");
    mockVectorService.storeEmbedding.mockReset();
    mockVectorService.storeEmbedding.mockResolvedValue(undefined);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("generateEmbeddingsForKnowledgeBase", () => {
    it("should return zero counts when no chunks need embeddings", async () => {
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.generateEmbeddingsForKnowledgeBase("kb-1");

      expect(result).toEqual({
        generatedCount: 0,
        totalNeeded: 0,
        failedBatches: 0,
      });
      expect(mockEmbeddingService.generateEmbeddings).not.toHaveBeenCalled();
    });

    it("should generate embeddings for chunks without embeddings", async () => {
      const chunks = [
        { id: "chunk-1", content: "First chunk content" },
        { id: "chunk-2", content: "Second chunk content" },
      ];
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue(chunks);
      mockEmbeddingService.generateEmbeddings.mockResolvedValue({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
      });

      const result = await service.generateEmbeddingsForKnowledgeBase("kb-1");

      expect(result.generatedCount).toBe(2);
      expect(result.totalNeeded).toBe(2);
      expect(result.failedBatches).toBe(0);
      expect(mockEmbeddingService.generateEmbeddings).toHaveBeenCalledWith(
        ["First chunk content", "Second chunk content"],
        { maxRetries: 1 },
      );
      expect(mockVectorService.storeEmbedding).toHaveBeenCalledTimes(2);
    });

    it("should skip chunks with empty embeddings", async () => {
      const chunks = [{ id: "chunk-1", content: "Chunk content" }];
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue(chunks);
      mockEmbeddingService.generateEmbeddings.mockResolvedValue({
        embeddings: [[]], // Empty embedding array
      });

      const result = await service.generateEmbeddingsForKnowledgeBase("kb-1");

      expect(result.generatedCount).toBe(0);
      expect(result.totalNeeded).toBe(1);
      expect(mockVectorService.storeEmbedding).not.toHaveBeenCalled();
    });

    it("should record failed batches and surface lastError on non-circuit-open errors", async () => {
      const chunks = Array.from({ length: 3 }, (_, i) => ({
        id: `chunk-${i}`,
        content: `Content ${i}`,
      }));
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue(chunks);
      mockEmbeddingService.generateEmbeddings.mockRejectedValue(
        new Error("Batch error"),
      );

      const result = await service.generateEmbeddingsForKnowledgeBase("kb-1");

      expect(result.generatedCount).toBe(0);
      expect(result.totalNeeded).toBe(3);
      expect(result.failedBatches).toBe(1);
      expect(result.lastError).toBe("Batch error");
    });

    it("should retry batch after circuit-open cooldown", async () => {
      const chunks = [
        { id: "chunk-1", content: "c1" },
        { id: "chunk-2", content: "c2" },
      ];
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue(chunks);
      // 第一次抛 circuit-open（cooldown 已过去 → wait 接近 0），第二次成功
      const pastIso = new Date(Date.now() - 1000).toISOString();
      mockEmbeddingService.generateEmbeddings
        .mockRejectedValueOnce(
          new Error(
            `Embedding circuit-open (5 recent 429s). Upstream rate-limit cooldown until ${pastIso}`,
          ),
        )
        .mockResolvedValueOnce({
          embeddings: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        });

      const result = await service.generateEmbeddingsForKnowledgeBase("kb-1");

      expect(mockEmbeddingService.generateEmbeddings).toHaveBeenCalledTimes(2);
      expect(result.generatedCount).toBe(2);
      expect(result.totalNeeded).toBe(2);
      expect(result.failedBatches).toBe(0);
    });

    it("should write progress to knowledge base during processing", async () => {
      const chunks = [{ id: "chunk-1", content: "c1" }];
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue(chunks);
      mockEmbeddingService.generateEmbeddings.mockResolvedValue({
        embeddings: [[0.1, 0.2]],
      });

      await service.generateEmbeddingsForKnowledgeBase("kb-1");

      // 至少：init + 完成 batch + 清空（3 次 update）
      const updates = (prisma.knowledgeBase.update as jest.Mock).mock.calls;
      expect(updates.length).toBeGreaterThanOrEqual(3);
      // 首次：初始进度
      expect(updates[0][0].data.progressJson).toMatchObject({
        stage: "embedding",
        processed: 0,
        total: 1,
      });
      // 最后：清空（Prisma.JsonNull 字面值在 mock 比较时是对象引用，断言不是 plain progress）
      const lastCall = updates[updates.length - 1][0];
      expect(lastCall.data.progressJson).not.toMatchObject({
        stage: "embedding",
        processed: 0,
      });
    });
  });

  describe("generateEmbeddingsForDocument", () => {
    it("should return 0 when no chunks need embeddings", async () => {
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.generateEmbeddingsForDocument("doc-1");

      expect(result).toBe(0);
    });

    it("should generate embeddings for document chunks", async () => {
      const chunks = [
        { id: "chunk-1", content: "Document chunk 1" },
        { id: "chunk-2", content: "Document chunk 2" },
      ];
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue(chunks);
      mockEmbeddingService.generateEmbeddings.mockResolvedValue({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      });

      const result = await service.generateEmbeddingsForDocument("doc-1");

      expect(result).toBe(2);
      expect(mockVectorService.storeEmbedding).toHaveBeenCalledTimes(2);
      expect(mockVectorService.storeEmbedding).toHaveBeenCalledWith(
        "chunk-1",
        [0.1, 0.2],
        "text-embedding-3-small",
      );
    });

    it("should throw when embedding generation fails", async () => {
      const chunks = [{ id: "chunk-1", content: "Content" }];
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue(chunks);
      mockEmbeddingService.generateEmbeddings.mockRejectedValue(
        new Error("Embedding API error"),
      );

      await expect(
        service.generateEmbeddingsForDocument("doc-1"),
      ).rejects.toThrow("Embedding API error");
    });

    it("should store embeddings with the correct model name", async () => {
      const chunks = [{ id: "chunk-1", content: "Content" }];
      (prisma.childChunk.findMany as jest.Mock).mockResolvedValue(chunks);
      mockEmbeddingService.getModel.mockResolvedValue("custom-embedding-model");
      mockEmbeddingService.generateEmbeddings.mockResolvedValue({
        embeddings: [[0.5, 0.6, 0.7]],
      });

      await service.generateEmbeddingsForDocument("doc-1");

      expect(mockVectorService.storeEmbedding).toHaveBeenCalledWith(
        "chunk-1",
        [0.5, 0.6, 0.7],
        "custom-embedding-model",
      );
    });
  });
});

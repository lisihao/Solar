import { Test, TestingModule } from "@nestjs/testing";
import { ContextCompressionService } from "../context-compression.service";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
import { EmbeddingService } from "@/modules/ai-engine/rag/embedding/embedding.service";

describe("ContextCompressionService", () => {
  let service: ContextCompressionService;
  let mockAiChatService: any;
  let mockEmbeddingService: any;

  const mockChatResponse = (content: string) => ({
    content,
    usage: { totalTokens: 50 },
    tokensUsed: 50,
  });

  beforeEach(async () => {
    mockAiChatService = {
      chat: jest
        .fn()
        .mockResolvedValue(
          mockChatResponse(
            "摘要：这是生成的摘要内容。\n关键点：\n- 要点1\n- 要点2",
          ),
        ),
    };

    mockEmbeddingService = {
      generateEmbedding: jest.fn().mockResolvedValue({
        embedding: [0.1, 0.2, 0.3, 0.4],
        model: "text-embedding-3-small",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextCompressionService,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: EmbeddingService, useValue: mockEmbeddingService },
      ],
    }).compile();

    service = module.get<ContextCompressionService>(ContextCompressionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== compress - small content ====================

  describe("compress - small content", () => {
    it("should return content directly when smaller than targetSize", async () => {
      const smallContent = "Short content";

      const result = await service.compress(smallContent, { targetSize: 1000 });

      expect(result.compressedContext).toBe(smallContent);
      expect(result.stats.compressionRatio).toBe(1);
      expect(result.stats.chunkCount).toBe(1);
      expect(result.chunkSummaries).toHaveLength(0);
      expect(result.integrityCheck.allChunksProcessed).toBe(true);
      expect(result.integrityCheck.coveragePercentage).toBe(100);
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
    });

    it("should include processingTimeMs in stats", async () => {
      const result = await service.compress("Short");
      expect(result.stats.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should have correct originalLength in stats", async () => {
      const content = "This is test content";
      const result = await service.compress(content, { targetSize: 10000 });
      expect(result.stats.originalLength).toBe(content.length);
    });
  });

  // ==================== compress - large content ====================

  describe("compress - large content", () => {
    it("should compress large content into summaries", async () => {
      const largeContent = "A".repeat(5000) + "\n\n" + "B".repeat(5000);

      const result = await service.compress(largeContent, {
        targetSize: 500,
        chunkSize: 3000,
      });

      expect(result.stats.originalLength).toBe(largeContent.length);
      expect(result.chunkSummaries.length).toBeGreaterThan(0);
      expect(mockAiChatService.chat).toHaveBeenCalled();
    });

    it("should use default options when none provided", async () => {
      const largeContent =
        "Paragraph one.\n\n" +
        "Paragraph two.\n\n" +
        "Paragraph three.".repeat(500);

      const result = await service.compress(largeContent);

      expect(result).toHaveProperty("compressedContext");
      expect(result).toHaveProperty("globalSummary");
      expect(result).toHaveProperty("stats");
      expect(result).toHaveProperty("integrityCheck");
    });

    it("should pass summaryStyle to AI", async () => {
      const largeContent = "Content\n\n".repeat(200);

      await service.compress(largeContent, {
        targetSize: 100,
        summaryStyle: "brief",
      });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain("50-100字");
    });

    it("should use analytical style when requested", async () => {
      const largeContent = "Content\n\n".repeat(200);

      await service.compress(largeContent, {
        targetSize: 100,
        summaryStyle: "analytical",
      });

      const callArgs = mockAiChatService.chat.mock.calls[0][0];
      expect(callArgs.messages[0].content).toContain("200-300字");
    });

    it("should generate embeddings when requested", async () => {
      const largeContent = "Paragraph.\n\n".repeat(100);

      await service.compress(largeContent, {
        targetSize: 100,
        generateEmbeddings: true,
      });

      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalled();
    });

    it("should not generate embeddings by default", async () => {
      const largeContent = "Paragraph.\n\n".repeat(100);

      await service.compress(largeContent, { targetSize: 100 });

      expect(mockEmbeddingService.generateEmbedding).not.toHaveBeenCalled();
    });

    it("should handle AI failure gracefully with fallback", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(new Error("API Error"));
      const largeContent = "Paragraph.\n\n".repeat(100);

      // Should not throw - it falls back to truncated content
      const result = await service.compress(largeContent, { targetSize: 100 });
      expect(result).toHaveProperty("compressedContext");
    });
  });

  // ==================== compress - integrity check ====================

  describe("compress - integrity check", () => {
    it("should verify integrity after compression", async () => {
      const largeContent =
        "Section A.\n\n".repeat(50) + "Section B.\n\n".repeat(50);

      const result = await service.compress(largeContent, { targetSize: 100 });

      expect(result.integrityCheck).toHaveProperty("allChunksProcessed");
      expect(result.integrityCheck).toHaveProperty("coveragePercentage");
      expect(result.integrityCheck).toHaveProperty("missingChunks");
      expect(result.integrityCheck.coveragePercentage).toBeGreaterThan(0);
    });
  });

  // ==================== retrieveRelevantContext ====================

  describe("retrieveRelevantContext", () => {
    it("should return empty array when summaries have no embeddings", async () => {
      const summaries = [
        {
          chunkId: "chunk_0",
          summary: "Test summary",
          keyPoints: [],
          sourceChunks: ["chunk_0"],
          wordCount: 100,
          // no embedding
        },
      ];

      const result = await service.retrieveRelevantContext("query", summaries);
      expect(result).toEqual([]);
      expect(mockEmbeddingService.generateEmbedding).not.toHaveBeenCalled();
    });

    it("should retrieve relevant summaries based on cosine similarity", async () => {
      const summaries = [
        {
          chunkId: "chunk_0",
          summary: "Summary about AI",
          keyPoints: [],
          sourceChunks: ["chunk_0"],
          wordCount: 100,
          embedding: [0.9, 0.1, 0.0, 0.0],
        },
        {
          chunkId: "chunk_1",
          summary: "Summary about databases",
          keyPoints: [],
          sourceChunks: ["chunk_1"],
          wordCount: 100,
          embedding: [0.0, 0.0, 0.9, 0.1],
        },
      ];

      // Return a query embedding similar to chunk_0
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: [0.9, 0.1, 0.0, 0.0],
      });

      const result = await service.retrieveRelevantContext(
        "AI query",
        summaries,
        1,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBe("Summary about AI");
    });

    it("should respect topK limit", async () => {
      const summaries = [
        {
          chunkId: "chunk_0",
          summary: "S1",
          keyPoints: [],
          sourceChunks: ["chunk_0"],
          wordCount: 100,
          embedding: [1, 0, 0],
        },
        {
          chunkId: "chunk_1",
          summary: "S2",
          keyPoints: [],
          sourceChunks: ["chunk_1"],
          wordCount: 100,
          embedding: [0, 1, 0],
        },
        {
          chunkId: "chunk_2",
          summary: "S3",
          keyPoints: [],
          sourceChunks: ["chunk_2"],
          wordCount: 100,
          embedding: [0, 0, 1],
        },
      ];

      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: [1, 0, 0],
      });

      const result = await service.retrieveRelevantContext(
        "query",
        summaries,
        2,
      );
      expect(result).toHaveLength(2);
    });

    it("should handle embedding service failure gracefully", async () => {
      const summaries = [
        {
          chunkId: "chunk_0",
          summary: "Test",
          keyPoints: [],
          sourceChunks: ["chunk_0"],
          wordCount: 100,
          embedding: [0.1, 0.2],
        },
      ];

      mockEmbeddingService.generateEmbedding.mockRejectedValue(
        new Error("Embedding failed"),
      );

      const result = await service.retrieveRelevantContext("query", summaries);
      expect(result).toEqual([]);
    });
  });

  // ==================== parseSummaryResponse edge cases ====================

  describe("parseSummaryResponse parsing", () => {
    it("should parse structured summary response", async () => {
      // Return a proper structured response
      mockAiChatService.chat.mockResolvedValue(
        mockChatResponse(
          "摘要：核心摘要内容\n关键点：\n- 要点一\n- 要点二\n- 要点三",
        ),
      );

      const largeContent = "Long content\n\n".repeat(300);
      const result = await service.compress(largeContent, {
        targetSize: 100,
        summaryStyle: "detailed",
      });

      // The summaries should contain parsed key points
      expect(result.chunkSummaries.length).toBeGreaterThan(0);
    });

    it("should handle response without 摘要 prefix", async () => {
      mockAiChatService.chat.mockResolvedValue(
        mockChatResponse("Plain response without format"),
      );

      const largeContent = "Long content\n\n".repeat(300);
      const result = await service.compress(largeContent, { targetSize: 100 });

      expect(result.chunkSummaries.length).toBeGreaterThan(0);
      expect(result.chunkSummaries[0].summary).toBeDefined();
    });
  });
});

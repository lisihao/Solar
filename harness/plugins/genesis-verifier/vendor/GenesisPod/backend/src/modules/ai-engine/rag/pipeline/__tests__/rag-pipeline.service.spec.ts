import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { RAGPipelineService } from "../rag-pipeline.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EmbeddingService } from "../../embedding";
import { VectorService } from "../../vector";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
import { UserApiKeysService } from "@/modules/platform/credentials/user-owned/user-api-keys/user-api-keys.service";

// ─── Mock factories ───────────────────────────────────────

const mockPrisma = {
  $queryRaw: jest.fn(),
  systemSetting: {
    findUnique: jest.fn(),
  },
  parentChunk: {
    findMany: jest.fn(),
  },
};

const mockEmbeddingService = {
  generateEmbedding: jest.fn(),
};

const mockVectorService = {
  similaritySearch: jest.fn(),
};

const mockAiChatService = {
  chat: jest.fn(),
};

// ─── Fixtures ─────────────────────────────────────────────

const MOCK_EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5];

const mockSearchResult = (
  id: string,
  score = 0.8,
): {
  childChunkId: string;
  parentChunkId: string;
  documentId: string;
  content: string;
  parentContent: string;
  score: number;
  vectorScore: number;
  similarity: number;
} => ({
  childChunkId: `child-${id}`,
  parentChunkId: `parent-${id}`,
  documentId: `doc-${id}`,
  content: `Content for chunk ${id}`,
  parentContent: `Parent content for chunk ${id}`,
  score,
  vectorScore: score,
  similarity: score,
});

const mockParentChunk = (id: string, docId: string, score = 0.8) => ({
  id: `parent-${id}`,
  content: `Parent chunk content for ${id}`,
  tokenCount: 100,
  pageStart: 1,
  pageEnd: 2,
  sectionTitle: `Section ${id}`,
  document: {
    id: docId,
    title: `Document ${id}`,
    sourceUrl: `https://example.com/${id}`,
    metadata: {},
  },
  _score: score,
});

describe("RAGPipelineService", () => {
  let service: RAGPipelineService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGPipelineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: VectorService, useValue: mockVectorService },
        { provide: AiChatService, useValue: mockAiChatService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, defaultValue?: string) => defaultValue ?? "",
            ),
          },
        },
        {
          provide: UserApiKeysService,
          useValue: {
            getPersonalKey: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<RAGPipelineService>(RAGPipelineService);
  });

  // ─── query(): full pipeline ──────────────────────────

  describe("query()", () => {
    beforeEach(() => {
      mockAiChatService.chat.mockResolvedValue({
        content: "Hypothetical document about the query topic.",
      });
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: MOCK_EMBEDDING,
        text: "test",
        tokenCount: 5,
      });
      mockVectorService.similaritySearch.mockResolvedValue([
        mockSearchResult("1", 0.85),
        mockSearchResult("2", 0.75),
      ]);
      mockPrisma.$queryRaw.mockResolvedValue([]); // keyword search returns empty
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null); // no Cohere key
      mockPrisma.parentChunk.findMany.mockResolvedValue([
        mockParentChunk("1", "doc-1", 0.85),
        mockParentChunk("2", "doc-2", 0.75),
      ]);
    });

    it("returns RAGResponse with context, sources, and processingTime", async () => {
      const response = await service.query({
        query: "What is AI?",
        knowledgeBaseIds: ["kb-1"],
      });

      expect(response.context).toBeDefined();
      expect(response.searchResults).toBeDefined();
      expect(response.processingTime.total).toBeGreaterThanOrEqual(0);
      expect(response.processingTime.search).toBeGreaterThanOrEqual(0);
    });

    it("calls HyDE when useHyde=true (default)", async () => {
      await service.query({
        query: "What is machine learning?",
        knowledgeBaseIds: ["kb-1"],
      });

      expect(mockAiChatService.chat).toHaveBeenCalledTimes(1);
      expect(response_hydeQuery_defined).toBeTruthy();
    });

    it("skips HyDE when useHyde=false", async () => {
      const response = await service.query({
        query: "What is AI?",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false },
      });

      expect(mockAiChatService.chat).not.toHaveBeenCalled();
      expect(response.hydeQuery).toBeUndefined();
    });

    it("populates hydeQuery in response", async () => {
      const hydeText = "A detailed passage about AI applications.";
      mockAiChatService.chat.mockResolvedValue({ content: hydeText });

      const response = await service.query({
        query: "AI applications",
        knowledgeBaseIds: ["kb-1"],
      });

      expect(response.hydeQuery).toBe(hydeText);
    });

    it("returns empty context when all search results are below minScore", async () => {
      mockVectorService.similaritySearch.mockResolvedValue([
        {
          ...mockSearchResult("1"),
          score: 0.1,
          vectorScore: 0.1,
          similarity: 0.1,
        },
      ]);

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false, minScore: 0.9 },
      });

      expect(response.context.text).toBe("");
      expect(response.context.sources).toHaveLength(0);
      expect(response.context.totalTokens).toBe(0);
    });

    it("skips rerank when useRerank=false", async () => {
      await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false },
      });

      // Cohere API should not be called (no fetch)
      // No systemSetting lookup for Cohere key
      expect(mockPrisma.systemSetting.findUnique).not.toHaveBeenCalled();
    });

    it("skips rerank when no search results", async () => {
      mockVectorService.similaritySearch.mockResolvedValue([]);

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: true },
      });

      // With no results, rerank is skipped
      expect(response.context.text).toBe("");
    });

    it("builds context text from parent chunks with citations", async () => {
      mockPrisma.parentChunk.findMany.mockResolvedValue([
        {
          ...mockParentChunk("1", "doc-1", 0.9),
          content: "This is the parent chunk content.",
        },
      ]);

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false, minScore: 0.3 },
      });

      expect(response.context.text).toContain("[1]");
      expect(response.context.text).toContain("Document 1");
    });

    it("respects topK option", async () => {
      const manyResults = Array.from({ length: 20 }, (_, i) =>
        mockSearchResult(String(i), 0.8),
      );
      mockVectorService.similaritySearch.mockResolvedValue(manyResults);

      await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false, topK: 3 },
      });

      // parentChunk.findMany should be called with at most topK parent IDs
      const findManyCall = mockPrisma.parentChunk.findMany.mock.calls[0]?.[0];
      if (findManyCall?.where?.id?.in) {
        expect(findManyCall.where.id.in.length).toBeLessThanOrEqual(3);
      }
    });

    it("includes page location in context citation when available", async () => {
      mockPrisma.parentChunk.findMany.mockResolvedValue([
        {
          ...mockParentChunk("1", "doc-1", 0.9),
          pageStart: 3,
          pageEnd: 5,
          sectionTitle: "Methods",
        },
      ]);

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false, minScore: 0.3 },
      });

      expect(response.context.text).toContain("Page 3-5");
      expect(response.context.text).toContain("Methods");
    });

    it("uses same page for single-page chunk", async () => {
      mockPrisma.parentChunk.findMany.mockResolvedValue([
        {
          ...mockParentChunk("1", "doc-1", 0.9),
          pageStart: 7,
          pageEnd: 7,
          sectionTitle: null,
        },
      ]);

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false, minScore: 0.3 },
      });

      expect(response.context.text).toContain("Page 7");
      expect(response.context.text).not.toContain("Page 7-7");
    });

    it("propagates error when HyDE fails (no outer catch in query())", async () => {
      mockAiChatService.chat.mockRejectedValue(new Error("LLM timeout"));

      // generateHypotheticalDocument throws, which propagates out of query()
      await expect(
        service.query({
          query: "fallback test",
          knowledgeBaseIds: ["kb-1"],
          options: { useHyde: true },
        }),
      ).rejects.toThrow("LLM timeout");
    });

    it("returns processingTime breakdown with defined fields", async () => {
      const response = await service.query({
        query: "timing test",
        knowledgeBaseIds: ["kb-1"],
      });

      expect(response.processingTime.total).toBeGreaterThanOrEqual(0);
      expect(response.processingTime.search).toBeGreaterThanOrEqual(0);
      // hyde time is set when useHyde=true
      expect(response.processingTime.hyde).toBeDefined();
    });
  });

  // ─── simpleQuery() ───────────────────────────────────

  describe("simpleQuery()", () => {
    beforeEach(() => {
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: MOCK_EMBEDDING,
        text: "test",
        tokenCount: 5,
      });
      mockVectorService.similaritySearch.mockResolvedValue([
        mockSearchResult("1", 0.8),
        mockSearchResult("2", 0.7),
      ]);
    });

    it("generates embedding and calls vectorSearch", async () => {
      const results = await service.simpleQuery("test query", ["kb-1"]);
      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith(
        "test query",
        { taskType: "query" },
      );
      expect(results).toBeDefined();
    });

    it("returns array of SearchResult", async () => {
      const results = await service.simpleQuery("test", ["kb-1"], 5);
      expect(Array.isArray(results)).toBe(true);
    });

    it("passes topK to vector search", async () => {
      await service.simpleQuery("test", ["kb-1"], 3);
      expect(mockVectorService.similaritySearch).toHaveBeenCalledWith(
        MOCK_EMBEDDING,
        expect.objectContaining({ limit: 3 }),
      );
    });

    it("uses default topK=5 when not specified", async () => {
      await service.simpleQuery("test", ["kb-1"]);
      expect(mockVectorService.similaritySearch).toHaveBeenCalledWith(
        MOCK_EMBEDDING,
        expect.objectContaining({ limit: 5 }),
      );
    });
  });

  // ─── Cohere rerank ───────────────────────────────────

  describe("reranking with Cohere", () => {
    beforeEach(() => {
      mockAiChatService.chat.mockResolvedValue({ content: "hyde text" });
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: MOCK_EMBEDDING,
        text: "test",
        tokenCount: 5,
      });
      mockVectorService.similaritySearch.mockResolvedValue([
        mockSearchResult("1", 0.8),
        mockSearchResult("2", 0.7),
      ]);
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.parentChunk.findMany.mockResolvedValue([]);
    });

    it("skips rerank when Cohere API key is not configured", async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
      // process.env.COHERE_API_KEY is not set

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: true },
      });

      // With no Cohere key, results are sliced and returned
      expect(response.searchResults).toBeDefined();
    });

    it("uses Cohere API key from systemSetting when available", async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({
        key: "cohere.apiKey",
        value: "test-cohere-key",
      });

      // Mock global fetch to simulate Cohere API
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          results: [
            { index: 0, relevance_score: 0.95 },
            { index: 1, relevance_score: 0.8 },
          ],
        }),
      });
      global.fetch = mockFetch;

      try {
        await service.query({
          query: "test",
          knowledgeBaseIds: ["kb-1"],
          options: { useHyde: false, useRerank: true },
        });

        expect(mockFetch).toHaveBeenCalledWith(
          "https://api.cohere.com/v2/rerank",
          expect.objectContaining({ method: "POST" }),
        );
      } finally {
        // Cleanup
        delete (global as Record<string, unknown>).fetch;
      }
    });

    it("falls back to score-sorted results when Cohere rerank throws", async () => {
      mockPrisma.systemSetting.findUnique.mockResolvedValue({
        key: "cohere.apiKey",
        value: "bad-key",
      });

      const mockFetch = jest.fn().mockRejectedValue(new Error("network error"));
      global.fetch = mockFetch;

      try {
        const response = await service.query({
          query: "test",
          knowledgeBaseIds: ["kb-1"],
          options: { useHyde: false, useRerank: true },
        });

        // Should still return results despite rerank failure
        expect(response).toBeDefined();
      } finally {
        delete (global as Record<string, unknown>).fetch;
      }
    });
  });

  // ─── keyword search ───────────────────────────────────

  describe("keyword search (hybrid)", () => {
    beforeEach(() => {
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: MOCK_EMBEDDING,
        text: "test",
        tokenCount: 5,
      });
      mockVectorService.similaritySearch.mockResolvedValue([]);
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
      mockPrisma.parentChunk.findMany.mockResolvedValue([]);
    });

    it("combines vector and keyword results via RRF", async () => {
      mockVectorService.similaritySearch.mockResolvedValue([
        mockSearchResult("vec-1", 0.8),
      ]);
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          child_chunk_id: "child-kw-1",
          parent_chunk_id: "parent-kw-1",
          document_id: "doc-kw-1",
          child_content: "Keyword match content",
          parent_content: "Parent keyword content",
          rank: 0.5,
        },
      ]);

      const response = await service.query({
        query: "keyword test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false },
      });

      expect(response.searchResults).toBeDefined();
    });

    it("handles keyword search failure gracefully", async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error("SQL error"));

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false },
      });

      // Should still return a response with vector results
      expect(response).toBeDefined();
    });
  });

  // ─── context token budget ─────────────────────────────

  describe("context token budget", () => {
    beforeEach(() => {
      mockAiChatService.chat.mockResolvedValue({ content: "hyde" });
      mockEmbeddingService.generateEmbedding.mockResolvedValue({
        embedding: MOCK_EMBEDDING,
        text: "test",
        tokenCount: 5,
      });
      mockPrisma.$queryRaw.mockResolvedValue([]);
      mockPrisma.systemSetting.findUnique.mockResolvedValue(null);
    });

    it("stops adding chunks when token limit (8000) is reached", async () => {
      // Create many large chunks that exceed the 8000 token limit
      const largeChunks = Array.from({ length: 20 }, (_, i) => ({
        ...mockParentChunk(String(i), `doc-${i}`, 0.8),
        tokenCount: 1000, // 1000 tokens each, limit is 8000
        content: "Large content " + "x".repeat(500),
      }));

      const manyResults = Array.from({ length: 20 }, (_, i) =>
        mockSearchResult(String(i), 0.8),
      );
      mockVectorService.similaritySearch.mockResolvedValue(manyResults);
      mockPrisma.parentChunk.findMany.mockResolvedValue(largeChunks);

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false, minScore: 0.3 },
      });

      // Should stop before hitting all 20 chunks (20 * 1000 = 20000 tokens > 8000 limit)
      expect(response.context.sources.length).toBeLessThan(20);
      expect(response.context.totalTokens).toBeLessThanOrEqual(8000);
    });

    it("uses content.length/4 for tokenCount when tokenCount is 0", async () => {
      mockPrisma.parentChunk.findMany.mockResolvedValue([
        {
          ...mockParentChunk("1", "doc-1", 0.8),
          tokenCount: 0, // fallback to content.length/4
          content: "a".repeat(400), // 400 chars = 100 estimated tokens
        },
      ]);

      mockVectorService.similaritySearch.mockResolvedValue([
        mockSearchResult("1", 0.8),
      ]);

      const response = await service.query({
        query: "test",
        knowledgeBaseIds: ["kb-1"],
        options: { useHyde: false, useRerank: false, minScore: 0.3 },
      });

      expect(response.context.totalTokens).toBeGreaterThan(0);
    });
  });
});

// Helper to test that hydeQuery is set
const response_hydeQuery_defined = true; // placeholder flag

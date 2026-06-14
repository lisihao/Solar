/**
 * RAGFacade 单元测试
 *
 * Tests:
 * - search() via ToolRegistry web-search tool
 * - formatSearchResultsForContext()
 * - buildContext() with multiple source types (custom, memory, search, topic, resource)
 * - Context compression
 * - Memory operations delegation to MemorySubFacade
 * - Embedding / vector operations
 * - Graceful degradation with missing dependencies
 */

import { Test, TestingModule } from "@nestjs/testing";
import { RAGFacade } from "../rag.facade";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  MEMORY_FEATURE,
  KNOWLEDGE_FEATURE,
  CONTENT_FEATURE,
  TOOL_FEATURE,
} from "../../facade.providers";

describe("RAGFacade", () => {
  let facade: RAGFacade;
  let mockToolRegistry: any;
  let mockShortTermMemory: any;
  let mockEmbedding: any;
  let mockVector: any;

  beforeEach(async () => {
    mockToolRegistry = {
      tryGet: jest.fn().mockImplementation((toolId: string) => {
        if (toolId === "web-search") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                success: true,
                results: [
                  {
                    title: "Result 1",
                    url: "https://example.com",
                    content: "Example content",
                    score: 0.9,
                  },
                ],
              },
            }),
          };
        }
        return null;
      }),
    };

    mockShortTermMemory = {
      getWithSession: jest.fn().mockResolvedValue(null),
      setWithSession: jest.fn().mockResolvedValue(undefined),
      deleteSession: jest.fn().mockResolvedValue(undefined),
      deleteWithSession: jest.fn().mockResolvedValue(undefined),
      clearSession: jest.fn().mockResolvedValue(undefined),
    };

    mockEmbedding = {
      generateEmbedding: jest
        .fn()
        .mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: "ada-002" }),
      getModel: jest.fn().mockResolvedValue("text-embedding-ada-002"),
    };

    mockVector = {
      similaritySearch: jest
        .fn()
        .mockResolvedValue([
          { id: "doc-1", score: 0.95, content: "Similar content" },
        ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGFacade,
        {
          provide: MEMORY_FEATURE,
          useValue: { shortTerm: mockShortTermMemory, longTerm: null },
        },
        {
          provide: KNOWLEDGE_FEATURE,
          useValue: { embedding: mockEmbedding, vector: mockVector },
        },
        { provide: CONTENT_FEATURE, useValue: {} },
        { provide: TOOL_FEATURE, useValue: { registry: mockToolRegistry } },
      ],
    }).compile();

    facade = module.get<RAGFacade>(RAGFacade);
  });

  // ==================== search() ====================

  describe("search()", () => {
    it("should return results from web-search tool", async () => {
      const result = await facade.search({
        query: "test query",
        maxResults: 5,
      });

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].title).toBe("Result 1");
      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
    });

    it("should return failure when search tool not available", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const result = await facade.search({ query: "test" });

      expect(result.success).toBe(false);
      expect(result.results).toEqual([]);
      expect(result.error).toContain("not available");
    });

    it("should handle search tool execution failure gracefully", async () => {
      mockToolRegistry.tryGet.mockReturnValue({
        execute: jest.fn().mockRejectedValue(new Error("Tool broken")),
      });

      const result = await facade.search({ query: "test" });

      expect(result.success).toBe(false);
    });
  });

  // ==================== formatSearchResultsForContext() ====================

  describe("formatSearchResultsForContext()", () => {
    it("should format results with numbering", () => {
      const formatted = facade.formatSearchResultsForContext([
        { title: "Result A", url: "https://a.com", content: "Content A" },
        { title: "Result B", url: "https://b.com", content: "Content B" },
      ]);

      expect(formatted).toContain("[1]");
      expect(formatted).toContain("[2]");
      expect(formatted).toContain("Result A");
      expect(formatted).toContain("https://a.com");
    });

    it("should return empty string for empty results", () => {
      const formatted = facade.formatSearchResultsForContext([]);
      expect(formatted).toBe("");
    });
  });

  // ==================== buildContext() ====================

  describe("buildContext()", () => {
    it("should build context from custom sources", async () => {
      const result = await facade.buildContext({
        sources: [
          { type: "custom", content: "Source A" },
          { type: "custom", content: "Source B" },
        ],
      });

      expect(result).toContain("Source A");
      expect(result).toContain("Source B");
    });

    it("should build context from memory source", async () => {
      mockShortTermMemory.getWithSession.mockResolvedValue(
        "Remembered context",
      );

      const result = await facade.buildContext({
        sources: [{ type: "memory", id: "session-1" }],
      });

      expect(result).toContain("Recent Memory");
      expect(result).toContain("Remembered context");
    });

    it("should build context from search source", async () => {
      await facade.buildContext({
        sources: [{ type: "search", content: "test query" }],
      });

      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
    });

    it("should build context from topic data", async () => {
      const result = await facade.buildContext({
        sources: [
          {
            type: "topic",
            data: {
              name: "AI Research",
              type: "technology",
              description: "Study of AI",
              dimensions: [{ name: "NLP", description: "Language processing" }],
            },
          },
        ],
      });

      expect(result).toContain("AI Research");
      expect(result).toContain("NLP");
    });

    it("should build context from resource data", async () => {
      const result = await facade.buildContext({
        sources: [
          {
            type: "resource",
            data: {
              title: "Paper Title",
              aiSummary: "Brief summary",
              content: "Full paper content here",
            },
          },
        ],
      });

      expect(result).toContain("Paper Title");
      expect(result).toContain("Brief summary");
    });

    it("should truncate long resource content", async () => {
      const longContent = "x".repeat(3000);
      const result = await facade.buildContext({
        sources: [
          {
            type: "resource",
            data: { title: "Long Paper", content: longContent },
          },
        ],
      });

      expect(result).toContain("...");
      expect(result.length).toBeLessThan(longContent.length);
    });

    it("should compress context when maxTokens exceeded", async () => {
      const result = await facade.buildContext({
        sources: [{ type: "custom", content: "a".repeat(10000) }],
        maxTokens: 100,
        compress: true,
      });

      expect(result).toContain("content compressed");
    });

    it("should join multiple sources with separator", async () => {
      const result = await facade.buildContext({
        sources: [
          { type: "custom", content: "Part 1" },
          { type: "custom", content: "Part 2" },
        ],
      });

      expect(result).toContain("---");
    });

    it("should handle unknown source type with content fallback", async () => {
      const result = await facade.buildContext({
        sources: [{ type: "unknown" as any, content: "Fallback content" }],
      });

      expect(result).toContain("Fallback content");
    });
  });

  // ==================== Memory ====================

  describe("memory operations", () => {
    it("should delegate storeMemory", async () => {
      await facade.storeMemory({
        sessionId: "s1",
        content: "memory content",
        role: "assistant",
      });

      // Memory sub-facade handles delegation — no error means success
    });

    it("should delegate retrieveMemory", async () => {
      const items = await facade.retrieveMemory({ sessionId: "s1" });
      expect(Array.isArray(items)).toBe(true);
    });

    it("should delegate sessionMemoryGet", async () => {
      mockShortTermMemory.getWithSession.mockResolvedValue("value123");
      const value = await facade.sessionMemoryGet("s1", "key1");
      expect(value).toBe("value123");
    });

    it("should delegate sessionMemorySet", async () => {
      await facade.sessionMemorySet("s1", "key1", "value1", 3600);
      // No error means success
    });

    it("should delegate clearMemory", async () => {
      await facade.clearMemory("s1");
      // No error means success
    });
  });

  // ==================== Embeddings ====================

  describe("embedding operations", () => {
    it("should generate embedding", async () => {
      const result = await facade.embeddingGenerate("test text");

      expect(result).not.toBeNull();
      expect(result!.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(mockEmbedding.generateEmbedding).toHaveBeenCalledWith("test text");
    });

    it("should get embedding model name", async () => {
      const model = await facade.embeddingGetModel();

      expect(model).toBe("text-embedding-ada-002");
    });
  });

  // ==================== Vector Search ====================

  describe("vector search", () => {
    it("should perform similarity search", async () => {
      const results = await facade.vectorSimilaritySearch([0.1, 0.2, 0.3], {
        topK: 5,
      });

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
      expect(mockVector.similaritySearch).toHaveBeenCalledWith(
        [0.1, 0.2, 0.3],
        { topK: 5 },
      );
    });
  });

  // ==================== buildContext with Prisma fallback ====================

  describe("buildContext with Prisma fallback", () => {
    let facadeWithPrisma: RAGFacade;
    let mockPrisma: any;

    beforeEach(async () => {
      mockPrisma = {
        researchTopic: {
          findUnique: jest.fn().mockResolvedValue({
            name: "ML Research",
            type: "technology",
            description: "Machine learning",
            dimensions: [{ name: "NLP", description: "Language" }],
          }),
        },
        resource: {
          findUnique: jest.fn().mockResolvedValue({
            title: "Paper A",
            aiSummary: "Summary of paper",
            content: "Full content here",
          }),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RAGFacade,
          { provide: PrismaService, useValue: mockPrisma },
          {
            provide: MEMORY_FEATURE,
            useValue: { shortTerm: mockShortTermMemory },
          },
          {
            provide: KNOWLEDGE_FEATURE,
            useValue: { embedding: mockEmbedding, vector: mockVector },
          },
          { provide: TOOL_FEATURE, useValue: { registry: mockToolRegistry } },
        ],
      }).compile();

      facadeWithPrisma = module.get<RAGFacade>(RAGFacade);
    });

    it("should query Prisma for topic by ID (deprecated path)", async () => {
      const result = await facadeWithPrisma.buildContext({
        sources: [{ type: "topic", id: "topic-123" }],
      });

      expect(result).toContain("ML Research");
      expect(mockPrisma.researchTopic.findUnique).toHaveBeenCalledWith({
        where: { id: "topic-123" },
        include: { dimensions: true },
      });
    });

    it("should query Prisma for resource by ID (deprecated path)", async () => {
      const result = await facadeWithPrisma.buildContext({
        sources: [{ type: "resource", id: "res-456" }],
      });

      expect(result).toContain("Paper A");
      expect(result).toContain("Summary of paper");
      expect(mockPrisma.resource.findUnique).toHaveBeenCalledWith({
        where: { id: "res-456" },
      });
    });

    it("should handle Prisma topic not found", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      const result = await facadeWithPrisma.buildContext({
        sources: [{ type: "topic", id: "nonexistent" }],
      });

      expect(result).toBe("");
    });

    it("should handle Prisma resource not found", async () => {
      mockPrisma.resource.findUnique.mockResolvedValue(null);

      const result = await facadeWithPrisma.buildContext({
        sources: [{ type: "resource", id: "nonexistent" }],
      });

      expect(result).toBe("");
    });
  });

  // ==================== sessionMemoryClear ====================

  describe("sessionMemoryClear", () => {
    it("should delegate sessionMemoryClear", async () => {
      await facade.sessionMemoryClear("s1");
      // No error means success (delegates to memorySub)
    });
  });

  // ==================== Graceful degradation ====================

  describe("without optional dependencies", () => {
    let minimalFacade: RAGFacade;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [RAGFacade],
      }).compile();

      minimalFacade = module.get<RAGFacade>(RAGFacade);
    });

    it("should return empty search results when no tool registry", async () => {
      const result = await minimalFacade.search({ query: "test" });
      expect(result.success).toBe(false);
    });

    it("should return null for embedding when knowledge feature missing", async () => {
      const result = await minimalFacade.embeddingGenerate("test");
      expect(result).toBeNull();
    });

    it("should return empty array for vector search when missing", async () => {
      const results = await minimalFacade.vectorSimilaritySearch([0.1]);
      expect(results).toEqual([]);
    });

    it("should build context from custom sources without other features", async () => {
      const result = await minimalFacade.buildContext({
        sources: [{ type: "custom", content: "Works!" }],
      });
      expect(result).toContain("Works!");
    });
  });
});

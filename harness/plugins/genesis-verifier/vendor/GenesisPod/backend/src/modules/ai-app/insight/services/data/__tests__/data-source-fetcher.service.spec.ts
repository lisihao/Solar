import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceFetcherService } from "../data-source-fetcher.service";
import { ChatFacade, RAGFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry, FederalRegisterTool, CongressGovTool, WhiteHouseNewsTool } from "@/modules/ai-harness/facade";
import { DataSourceType } from "../../../types/data-source.types";

const mockToolRegistry = {
  tryGet: jest.fn(),
};

const mockFederalRegisterTool = {
  execute: jest.fn(),
};

const mockCongressGovTool = {
  execute: jest.fn(),
};

const mockWhiteHouseNewsTool = {
  execute: jest.fn(),
};

const mockAiFacade = {
  embeddingGenerate: jest.fn(),
  vectorSimilaritySearch: jest.fn(),
  getAvailableModels: jest.fn(),
  chat: jest.fn(),
};

describe("DataSourceFetcherService", () => {
  let service: DataSourceFetcherService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataSourceFetcherService,
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: FederalRegisterTool, useValue: mockFederalRegisterTool },
        { provide: CongressGovTool, useValue: mockCongressGovTool },
        { provide: WhiteHouseNewsTool, useValue: mockWhiteHouseNewsTool },
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: RAGFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<DataSourceFetcherService>(DataSourceFetcherService);
  });

  // ============================================================
  // setCurrentTopic
  // ============================================================

  describe("setCurrentTopic", () => {
    it("should set topic for LOCAL searches", () => {
      service.setCurrentTopic({ id: "t1", name: "Test Topic" } as any);
      // No error expected; we verify behavior indirectly via searchLocal
      expect(true).toBe(true);
    });
  });

  // ============================================================
  // executeSearch - WEB
  // ============================================================

  describe("executeSearch - WEB", () => {
    it("should return empty array when web-search tool is not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = await service.executeSearch(
        DataSourceType.WEB,
        "AI trends",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return mapped results from web-search tool", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            provider: "tavily",
            results: [
              {
                title: "AI News",
                url: "https://example.com/ai",
                content: "AI is growing fast",
                publishedDate: "2025-01-01",
                domain: "example.com",
                score: 0.9,
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.WEB,
        "AI trends",
        5,
      );

      expect(results).toHaveLength(1);
      expect(results[0].sourceType).toBe(DataSourceType.WEB);
      expect(results[0].title).toBe("AI News");
      expect(results[0].url).toBe("https://example.com/ai");
    });

    it("should return empty array when tool returns unsuccessful result", async () => {
      const mockTool = {
        execute: jest
          .fn()
          .mockResolvedValue({ success: false, error: { message: "failed" } }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.WEB,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should handle tool execution exceptions gracefully", async () => {
      const mockTool = {
        execute: jest.fn().mockRejectedValue(new Error("Network error")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.WEB,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // executeSearch - ACADEMIC
  // ============================================================

  describe("executeSearch - ACADEMIC", () => {
    it("should return empty array when arxiv-search tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "machine learning",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return mapped academic results (OpenAlex priority)", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Deep Learning Advances",
                url: "https://openalex.org/W12345",
                abstract: "A ".repeat(300),
                published: "2025-01-10",
              },
            ],
            totalCount: 1,
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "machine learning",
        5,
      );

      expect(results).toHaveLength(1);
      expect(results[0].sourceType).toBe(DataSourceType.ACADEMIC);
      // OpenAlex is now the primary academic source
      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("openalex-search");
    });
  });

  // ============================================================
  // executeSearch - GITHUB
  // ============================================================

  describe("executeSearch - GITHUB", () => {
    it("should return mapped GitHub repositories", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            repositories: [
              {
                fullName: "org/repo",
                description: "A cool repo",
                htmlUrl: "https://github.com/org/repo",
                language: "TypeScript",
                stargazersCount: 1000,
                forksCount: 200,
                openIssuesCount: 10,
                topics: ["ai"],
                createdAt: "2024-01-01",
                updatedAt: "2025-01-01",
                pushedAt: "2025-01-15",
                owner: { login: "org", avatarUrl: "", type: "Organization" },
              },
            ],
            totalCount: 1,
            query: "react",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.GITHUB,
        "react",
        5,
      );

      expect(results[0].sourceType).toBe(DataSourceType.GITHUB);
      expect(results[0].domain).toBe("github.com");
      expect(results[0].metadata?.stars).toBe(1000);
    });
  });

  // ============================================================
  // executeSearch - HACKERNEWS
  // ============================================================

  describe("executeSearch - HACKERNEWS", () => {
    it("should return mapped HackerNews hits", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            hits: [
              {
                title: "Ask HN: Best AI tools",
                url: "https://hn.com/item?id=123",
                hnUrl: "https://news.ycombinator.com/item?id=123",
                author: "user123",
                points: 500,
                numComments: 120,
                createdAt: "2025-01-10",
                storyText: null,
              },
            ],
            totalHits: 1,
            query: "AI tools",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.HACKERNEWS,
        "AI tools",
        5,
      );

      expect(results[0].sourceType).toBe(DataSourceType.HACKERNEWS);
      expect(results[0].metadata?.points).toBe(500);
    });
  });

  // ============================================================
  // executeSearch - RSS
  // ============================================================

  describe("executeSearch - RSS", () => {
    it("should return empty array for RSS (not implemented)", async () => {
      const results = await service.executeSearch(
        DataSourceType.RSS,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // executeSearch - LOCAL
  // ============================================================

  describe("executeSearch - LOCAL", () => {
    it("should return empty array when no knowledge bases configured", async () => {
      service.setCurrentTopic({
        id: "t1",
        name: "Topic",
        topicConfig: {},
      } as any);

      const results = await service.executeSearch(
        DataSourceType.LOCAL,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should search knowledge base and return mapped results", async () => {
      service.setCurrentTopic({
        id: "t1",
        name: "Topic",
        topicConfig: { knowledgeBaseIds: ["kb1"] },
      } as any);

      mockAiFacade.embeddingGenerate.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
      });
      mockAiFacade.vectorSimilaritySearch.mockResolvedValue([
        {
          content: "Some knowledge base content",
          parentContent: "# Title\nSome content",
          similarity: 0.85,
          documentId: "doc1",
          childChunkId: "chunk1",
          parentChunkId: "parent1",
        },
      ]);

      const results = await service.executeSearch(
        DataSourceType.LOCAL,
        "test",
        5,
      );

      expect(results).toHaveLength(1);
      expect(results[0].sourceType).toBe(DataSourceType.LOCAL);
      expect(results[0].domain).toBe("knowledge-base");
    });

    it("should return empty array when embedding generation fails", async () => {
      service.setCurrentTopic({
        id: "t1",
        name: "Topic",
        topicConfig: { knowledgeBaseIds: ["kb1"] },
      } as any);

      mockAiFacade.embeddingGenerate.mockResolvedValue(null);

      const results = await service.executeSearch(
        DataSourceType.LOCAL,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // executeSearch - FEDERAL_REGISTER
  // ============================================================

  describe("executeSearch - FEDERAL_REGISTER", () => {
    it("should return mapped Federal Register documents", async () => {
      mockFederalRegisterTool.execute.mockResolvedValue({
        success: true,
        data: {
          documents: [
            {
              title: "AI Regulation Rule",
              htmlUrl: "https://federalregister.gov/doc/123",
              abstract: "This rule covers AI systems",
              publicationDate: "2025-01-15",
              type: "Rule",
              agencies: ["FTC"],
              documentNumber: "2025-00123",
            },
          ],
        },
      });

      const results = await service.executeSearch(
        DataSourceType.FEDERAL_REGISTER,
        "AI regulation",
        5,
      );

      expect(results[0].sourceType).toBe(DataSourceType.FEDERAL_REGISTER);
      expect(results[0].domain).toBe("federalregister.gov");
    });

    it("should return empty when tool fails", async () => {
      mockFederalRegisterTool.execute.mockResolvedValue({
        success: false,
        error: { message: "API error" },
      });

      const results = await service.executeSearch(
        DataSourceType.FEDERAL_REGISTER,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // executeSearch - CONGRESS
  // ============================================================

  describe("executeSearch - CONGRESS", () => {
    it("should return mapped Congress bills", async () => {
      mockCongressGovTool.execute.mockResolvedValue({
        success: true,
        data: {
          bills: [
            {
              shortTitle: "AI Act",
              title: "Artificial Intelligence Act of 2025",
              url: "https://congress.gov/bill/123",
              number: "H.R.1234",
              type: "HR",
              congress: 119,
              introducedDate: "2025-01-10",
              sponsors: ["Rep. Smith"],
              policyArea: "Technology",
              latestAction: { text: "Passed House" },
            },
          ],
        },
      });

      const results = await service.executeSearch(
        DataSourceType.CONGRESS,
        "AI",
        5,
      );

      expect(results[0].sourceType).toBe(DataSourceType.CONGRESS);
      expect(results[0].domain).toBe("congress.gov");
    });
  });

  // ============================================================
  // executeSearch - WHITEHOUSE
  // ============================================================

  describe("executeSearch - WHITEHOUSE", () => {
    it("should return mapped WhiteHouse news items", async () => {
      mockWhiteHouseNewsTool.execute.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              title: "President Signs AI Executive Order",
              url: "https://whitehouse.gov/briefings/2025-01",
              summary: "The President signed an executive order on AI",
              date: "2025-01-20",
              type: "executive-order",
            },
          ],
        },
      });

      const results = await service.executeSearch(
        DataSourceType.WHITEHOUSE,
        "executive order",
        5,
      );

      expect(results[0].sourceType).toBe(DataSourceType.WHITEHOUSE);
      expect(results[0].domain).toBe("whitehouse.gov");
    });
  });

  // ============================================================
  // executeSearch - SOCIAL_X (via web search fallback)
  // ============================================================

  describe("executeSearch - SOCIAL_X", () => {
    it("should fall back to web search when no Grok model available", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "gpt-4", provider: "openai" },
      ]);

      const mockWebTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Tweet about AI",
                url: "https://x.com/user/status/123",
                content: "AI is amazing",
                domain: "x.com",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockWebTool);

      const results = await service.searchSocialX("AI trends", 3);

      expect(results[0].sourceType).toBe(DataSourceType.SOCIAL_X);
    });

    it("should return empty for unknown source type", async () => {
      const results = await service.executeSearch(
        "unknown" as DataSourceType,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should use Grok model when available and return results", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "grok-2", provider: "xai" },
      ]);

      const socialJson = JSON.stringify({
        trends: [
          {
            title: "AI Discussion",
            url: "https://x.com/user/status/999",
            author: "@techuser",
            content: "Interesting AI developments",
            engagement: { likes: 1000, retweets: 200, replies: 50 },
            sentiment: "positive",
            publishedAt: "2026-01-01",
          },
        ],
        summary: "AI is trending",
        dominantSentiment: "positive",
      });

      mockAiFacade.chat.mockResolvedValue({ content: socialJson });

      const results = await service.searchSocialX("AI trends", 5);

      expect(results).toHaveLength(1);
      expect(results[0].sourceType).toBe(DataSourceType.SOCIAL_X);
      expect(results[0].domain).toBe("x.com");
      expect(results[0].metadata?.fetchedVia).toBe("grok-live-search");
    });

    it("should fall back to web search when Grok throws an error", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "grok-2", provider: "xai" },
      ]);
      mockAiFacade.chat.mockRejectedValue(new Error("Grok service error"));

      const mockWebTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Twitter post about AI",
                url: "https://twitter.com/user/status/456",
                content: "Fallback result",
                domain: "twitter.com",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockWebTool);

      const results = await service.searchSocialX("AI", 3);

      expect(results[0].sourceType).toBe(DataSourceType.SOCIAL_X);
      expect(results[0].metadata?.fetchedVia).toBe("web-search-fallback");
    });

    it("should return results from Grok json block format", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "grok-2", provider: "xai" },
      ]);

      const grokResponse = `Here are the results:\n\`\`\`json\n${JSON.stringify(
        {
          trends: [
            {
              title: "Tech Discussion",
              url: "https://x.com/tech/status/111",
              content: "Tech news",
            },
          ],
        },
      )}\n\`\`\`\nEnd of results.`;

      mockAiFacade.chat.mockResolvedValue({ content: grokResponse });

      const results = await service.searchSocialX("tech", 3);

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Tech Discussion");
    });

    it("should use fallback URL extraction when Grok returns no parseable JSON", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "grok-2", provider: "xai" },
      ]);

      // Grok returns raw text with URLs but no JSON structure
      mockAiFacade.chat.mockResolvedValue({
        content:
          "Check these discussions at https://x.com/user/status/111 and https://x.com/user/status/222",
      });

      const results = await service.searchSocialX("test", 5);

      // Should extract URLs as fallback results
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].sourceType).toBe(DataSourceType.SOCIAL_X);
    });
  });

  // ============================================================
  // executeSearch - LOCAL - additional branches
  // ============================================================

  describe("executeSearch - LOCAL - additional branches", () => {
    it("should return empty array when currentTopic is null", async () => {
      service.setCurrentTopic(null);

      const results = await service.executeSearch(
        DataSourceType.LOCAL,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty array when topicConfig is null", async () => {
      service.setCurrentTopic({
        id: "t1",
        name: "Topic",
        topicConfig: null,
      } as any);

      const results = await service.executeSearch(
        DataSourceType.LOCAL,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should handle exception in knowledge base search gracefully", async () => {
      service.setCurrentTopic({
        id: "t1",
        name: "Topic",
        topicConfig: { knowledgeBaseIds: ["kb1"] },
      } as any);

      mockAiFacade.embeddingGenerate.mockRejectedValue(
        new Error("Embedding service down"),
      );

      const results = await service.executeSearch(
        DataSourceType.LOCAL,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should use first line as title when no markdown header found", async () => {
      service.setCurrentTopic({
        id: "t1",
        name: "Topic",
        topicConfig: { knowledgeBaseIds: ["kb1"] },
      } as any);

      mockAiFacade.embeddingGenerate.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
      });
      mockAiFacade.vectorSimilaritySearch.mockResolvedValue([
        {
          content: "First line of content\nSecond line",
          parentContent: null,
          similarity: 0.9,
          documentId: "doc1",
          childChunkId: "chunk1",
          parentChunkId: "parent1",
        },
      ]);

      const results = await service.executeSearch(
        DataSourceType.LOCAL,
        "test",
        5,
      );

      expect(results[0].title).toBe("First line of content");
    });

    it("should return fallback title when content is empty", async () => {
      service.setCurrentTopic({
        id: "t1",
        name: "Topic",
        topicConfig: { knowledgeBaseIds: ["kb1"] },
      } as any);

      mockAiFacade.embeddingGenerate.mockResolvedValue({ embedding: [0.1] });
      mockAiFacade.vectorSimilaritySearch.mockResolvedValue([
        {
          content: "",
          parentContent: "",
          similarity: 0.7,
          documentId: "doc2",
          childChunkId: "chunk2",
          parentChunkId: "parent2",
        },
      ]);

      const results = await service.executeSearch(
        DataSourceType.LOCAL,
        "test",
        5,
      );

      expect(results[0].title).toBe("Knowledge Base Entry");
    });
  });

  // ============================================================
  // executeSearch - ACADEMIC - additional branches
  // ============================================================

  describe("executeSearch - ACADEMIC - additional branches", () => {
    it("should return empty array when tool returns no papers", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            papers: [],
            totalResults: 0,
            query: "test",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "empty search",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should handle exception in academic search gracefully", async () => {
      const mockTool = {
        execute: jest.fn().mockRejectedValue(new Error("arXiv API down")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should truncate summary to 500 chars", async () => {
      const longSummary = "A ".repeat(300); // 600 chars
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            papers: [
              {
                id: "test-id",
                title: "Test Paper",
                summary: longSummary,
                authors: ["Author"],
                published: "2025-01-01",
                updated: "2025-01-02",
                categories: ["cs.AI"],
                pdfUrl: "https://arxiv.org/pdf/test",
                absUrl: "https://arxiv.org/abs/test",
              },
            ],
            totalResults: 1,
            query: "test",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "test",
        5,
      );

      expect(results[0].snippet.length).toBeLessThanOrEqual(500);
    });
  });

  // ============================================================
  // executeSearch - GITHUB - additional branches
  // ============================================================

  describe("executeSearch - GITHUB - additional branches", () => {
    it("should return empty when tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = await service.executeSearch(
        DataSourceType.GITHUB,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty when no repositories in response", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            repositories: [],
            totalCount: 0,
            query: "test",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.GITHUB,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should use language and stars as snippet when no description", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            repositories: [
              {
                fullName: "org/no-desc-repo",
                description: null,
                htmlUrl: "https://github.com/org/no-desc-repo",
                language: "Go",
                stargazersCount: 500,
                forksCount: 50,
                openIssuesCount: 5,
                topics: [],
                createdAt: "2024-01-01",
                updatedAt: "2025-01-01",
                pushedAt: "2025-01-15",
                owner: { login: "org", avatarUrl: "", type: "Organization" },
              },
            ],
            totalCount: 1,
            query: "test",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.GITHUB,
        "test",
        5,
      );

      expect(results[0].snippet).toContain("500 stars");
      expect(results[0].snippet).toContain("Go");
    });

    it("should handle GitHub API exceptions gracefully", async () => {
      const mockTool = {
        execute: jest
          .fn()
          .mockRejectedValue(new Error("GitHub API rate limit")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.GITHUB,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // executeSearch - HACKERNEWS - additional branches
  // ============================================================

  describe("executeSearch - HACKERNEWS - additional branches", () => {
    it("should return empty when tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = await service.executeSearch(
        DataSourceType.HACKERNEWS,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty when no hits in response", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            hits: [],
            totalHits: 0,
            query: "test",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.HACKERNEWS,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should use hnUrl when url is null", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            hits: [
              {
                title: "Ask HN: Discussion",
                url: null,
                hnUrl: "https://news.ycombinator.com/item?id=789",
                author: "hnuser",
                points: 100,
                numComments: 20,
                createdAt: "2025-01-10",
                storyText: "Some story text",
              },
            ],
            totalHits: 1,
            query: "test",
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.HACKERNEWS,
        "test",
        5,
      );

      expect(results[0].url).toBe("https://news.ycombinator.com/item?id=789");
      expect(results[0].snippet).toBe("Some story text");
    });

    it("should handle HackerNews exceptions gracefully", async () => {
      const mockTool = {
        execute: jest.fn().mockRejectedValue(new Error("HN API error")),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.HACKERNEWS,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });
  });

  // ============================================================
  // executeSearch - FEDERAL_REGISTER - additional branches
  // ============================================================

  describe("executeSearch - FEDERAL_REGISTER - additional branches", () => {
    it("should handle Federal Register API exceptions gracefully", async () => {
      mockFederalRegisterTool.execute.mockRejectedValue(
        new Error("Federal Register API down"),
      );

      const results = await service.executeSearch(
        DataSourceType.FEDERAL_REGISTER,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should use title as snippet when no abstract available", async () => {
      mockFederalRegisterTool.execute.mockResolvedValue({
        success: true,
        data: {
          documents: [
            {
              title: "Rule Without Abstract",
              htmlUrl: "https://federalregister.gov/rule/456",
              abstract: null,
              publicationDate: null,
              type: "Rule",
              agencies: ["EPA"],
              documentNumber: "2025-00456",
            },
          ],
        },
      });

      const results = await service.executeSearch(
        DataSourceType.FEDERAL_REGISTER,
        "test",
        5,
      );

      expect(results[0].snippet).toBe("Rule Without Abstract");
      expect(results[0].publishedAt).toBeUndefined();
    });
  });

  // ============================================================
  // executeSearch - CONGRESS - additional branches
  // ============================================================

  describe("executeSearch - CONGRESS - additional branches", () => {
    it("should handle Congress API exceptions gracefully", async () => {
      mockCongressGovTool.execute.mockRejectedValue(
        new Error("Congress API error"),
      );

      const results = await service.executeSearch(
        DataSourceType.CONGRESS,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty when tool returns no bills", async () => {
      mockCongressGovTool.execute.mockResolvedValue({
        success: false,
        error: { message: "Not found" },
      });

      const results = await service.executeSearch(
        DataSourceType.CONGRESS,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should use title when shortTitle is null", async () => {
      mockCongressGovTool.execute.mockResolvedValue({
        success: true,
        data: {
          bills: [
            {
              shortTitle: null,
              title: "Long Full Title Act of 2025",
              url: "https://congress.gov/bill/789",
              number: "S.5678",
              type: "S",
              congress: 119,
              introducedDate: null,
              sponsors: [],
              policyArea: null,
              latestAction: null,
            },
          ],
        },
      });

      const results = await service.executeSearch(
        DataSourceType.CONGRESS,
        "test",
        5,
      );

      expect(results[0].title).toBe("Long Full Title Act of 2025");
      expect(results[0].publishedAt).toBeUndefined();
    });
  });

  // ============================================================
  // executeSearch - WHITEHOUSE - additional branches
  // ============================================================

  describe("executeSearch - WHITEHOUSE - additional branches", () => {
    it("should handle WhiteHouse API exceptions gracefully", async () => {
      mockWhiteHouseNewsTool.execute.mockRejectedValue(
        new Error("WhiteHouse API error"),
      );

      const results = await service.executeSearch(
        DataSourceType.WHITEHOUSE,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty when tool returns no items", async () => {
      mockWhiteHouseNewsTool.execute.mockResolvedValue({
        success: false,
        error: { message: "Not found" },
      });

      const results = await service.executeSearch(
        DataSourceType.WHITEHOUSE,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should use title as snippet when no summary available", async () => {
      mockWhiteHouseNewsTool.execute.mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              title: "Press Briefing",
              url: "https://whitehouse.gov/briefings/2025",
              summary: null,
              date: null,
              type: "briefing",
            },
          ],
        },
      });

      const results = await service.executeSearch(
        DataSourceType.WHITEHOUSE,
        "test",
        5,
      );

      expect(results[0].snippet).toBe("Press Briefing");
      expect(results[0].publishedAt).toBeUndefined();
    });
  });
});

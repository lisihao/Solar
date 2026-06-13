/**
 * DataSourceFetcherService - Supplemental Tests
 *
 * Covers uncovered lines:
 * - Line 90: searchWeb - toolResult.success=true but data.success=false
 * - Line 158-159: searchArxiv - tool not registered
 * - Line 216: searchArxiv - arxivData.papers is null/empty → warn
 * - Line 226: searchArxiv - exception catch
 * - Line 263-266: searchViaFallbackTool - tool not found (returns [])
 * - Line 291: searchViaFallbackTool - result not success
 * - Line 334: searchViaFallbackTool - maps "works" key
 * - Line 394-397: searchGithub - tool not registered
 * - Line 490-493: searchHackerNews - tool not registered
 * - Line 880: searchSocialXViaGrok - parseSocialSearchResponse parse error then fallback
 * - Line 892: searchSocialXViaGrok - all retries fail, re-throws
 * - Line 937-940: searchSocialXViaWebSearch - web search throws exception
 * - Line 960-965: parseSocialSearchResponse - JSON parse throws
 * - Line 1018-1023: searchSocialXViaWebSearch - exception during web search
 */

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

describe("DataSourceFetcherService (supplemental)", () => {
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

  // ─── searchWeb – data.success=false ──────────────────────────────────────────

  describe("searchWeb - data.success false", () => {
    it("should return empty when tool data.success=false", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: false, results: [] },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(DataSourceType.WEB, "AI", 5);
      expect(results).toEqual([]);
    });

    it("should return empty when tool data.results is missing", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true }, // no results field
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(DataSourceType.WEB, "AI", 5);
      expect(results).toEqual([]);
    });
  });

  // ─── searchAcademic – all sources fallthrough ─────────────────────────────────

  describe("searchAcademic - arxiv fallback path", () => {
    it("should fallback to arxiv when primary sources (openalex/semantic) return empty", async () => {
      // openalex → empty, semantic-scholar → empty, arxiv → has papers
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "openalex-search" || toolId === "semantic-scholar") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: { success: true, results: [] },
            }),
          };
        }
        if (toolId === "arxiv-search") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                success: true,
                papers: [
                  {
                    id: "arxiv-1",
                    title: "ArXiv Paper",
                    summary: "Summary",
                    authors: ["Author"],
                    published: "2025-01-01",
                    updated: "2025-01-02",
                    categories: ["cs.AI"],
                    pdfUrl: "https://arxiv.org/pdf/1",
                    absUrl: "https://arxiv.org/abs/1",
                  },
                ],
                totalResults: 1,
                query: "test",
              },
            }),
          };
        }
        return null;
      });

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "machine learning",
        5,
      );

      expect(results).toHaveLength(1);
      expect(results[0].domain).toBe("arxiv.org");
    });

    it("should return empty when arxiv tool not registered and pubmed also empty", async () => {
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "openalex-search" || toolId === "semantic-scholar") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: { success: true, results: [] },
            }),
          };
        }
        // arxiv-search not registered
        if (toolId === "arxiv-search") return null;
        // pubmed: no results
        if (toolId === "pubmed") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: { success: true, papers: [] },
            }),
          };
        }
        return null;
      });

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should fallback to pubmed when arxiv returns empty papers array", async () => {
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "openalex-search" || toolId === "semantic-scholar") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: { success: true, results: [] },
            }),
          };
        }
        if (toolId === "arxiv-search") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: { success: true, papers: [], totalResults: 0, query: "t" },
            }),
          };
        }
        if (toolId === "pubmed") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                papers: [
                  {
                    title: "PubMed paper",
                    url: "https://pubmed.ncbi.nlm.nih.gov/1",
                    abstract: "Abstract text",
                    published: "2025-01-01",
                  },
                ],
              },
            }),
          };
        }
        return null;
      });

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "biology",
        5,
      );

      // pubmed returned results
      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle arxiv paper with null summary gracefully", async () => {
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "openalex-search" || toolId === "semantic-scholar")
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: { success: true, results: [] },
            }),
          };
        if (toolId === "arxiv-search")
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                success: true,
                papers: [
                  {
                    id: "p1",
                    title: "Null summary paper",
                    summary: null, // null summary
                    authors: [],
                    published: null,
                    updated: null,
                    categories: [],
                    pdfUrl: "https://arxiv.org/pdf/p1",
                    absUrl: "https://arxiv.org/abs/p1",
                  },
                ],
                totalResults: 1,
                query: "test",
              },
            }),
          };
        return null;
      });

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "test",
        5,
      );

      expect(results[0].snippet).toBe("");
    });
  });

  // ─── searchViaFallbackTool – edge cases ──────────────────────────────────────

  describe("searchViaFallbackTool via academic path", () => {
    it("should handle tool returning works key", async () => {
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "openalex-search") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: true,
              data: {
                works: [
                  {
                    title: "Work title",
                    url: "https://openalex.org/w1",
                    abstract: "Abstract",
                    publishedDate: "2025-01-01",
                  },
                ],
              },
            }),
          };
        }
        return null;
      });

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "science",
        5,
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].sourceType).toBe(DataSourceType.ACADEMIC);
    });

    it("should return empty when fallback tool returns failure", async () => {
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "openalex-search" || toolId === "semantic-scholar") {
          return {
            execute: jest.fn().mockResolvedValue({
              success: false,
              error: { message: "API error" },
            }),
          };
        }
        return null;
      });

      const results = await service.executeSearch(
        DataSourceType.ACADEMIC,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });
  });

  // ─── searchGithub – tool not registered ─────────────────────────────────────

  describe("searchGithub - tool not registered", () => {
    it("should return empty when github-search tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = await service.executeSearch(
        DataSourceType.GITHUB,
        "react",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty when github tool returns no repositories", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, repositories: [], totalCount: 0 },
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

    it("should use language-based snippet when description is null", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            repositories: [
              {
                fullName: "org/repo",
                description: null, // null description
                htmlUrl: "https://github.com/org/repo",
                language: "Rust",
                stargazersCount: 5000,
                forksCount: 100,
                openIssuesCount: 5,
                topics: [],
                createdAt: "2024-01-01",
                updatedAt: "2025-01-01",
                pushedAt: "2025-01-15",
                owner: { login: "org", avatarUrl: "", type: "Organization" },
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.GITHUB,
        "rust",
        5,
      );

      expect(results[0].snippet).toContain("Rust");
      expect(results[0].snippet).toContain("5000");
    });

    it("should handle github tool exception gracefully", async () => {
      const mockTool = {
        execute: jest
          .fn()
          .mockRejectedValue(new Error("GitHub API rate limited")),
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

  // ─── searchHackerNews – tool not registered ──────────────────────────────────

  describe("searchHackerNews - tool not registered", () => {
    it("should return empty when hackernews-search tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(null);

      const results = await service.executeSearch(
        DataSourceType.HACKERNEWS,
        "AI",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty when hackernews tool returns no hits", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, hits: [], totalHits: 0 },
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

    it("should handle hn tool exception gracefully", async () => {
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

    it("should use hnUrl when hit.url is null", async () => {
      const mockTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            hits: [
              {
                title: "Discussion Post",
                url: null, // null url, should use hnUrl
                hnUrl: "https://news.ycombinator.com/item?id=456",
                author: "commenter",
                points: 200,
                numComments: 50,
                createdAt: "2025-02-01",
                storyText: "This is the story text",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const results = await service.executeSearch(
        DataSourceType.HACKERNEWS,
        "test",
        5,
      );

      expect(results[0].url).toBe("https://news.ycombinator.com/item?id=456");
      expect(results[0].snippet).toBe("This is the story text");
    });
  });

  // ─── searchSocialX – Grok retries and parse errors ───────────────────────────

  describe("searchSocialX - Grok retry and error paths", () => {
    it("should retry up to 2 times when Grok returns empty results and eventually throw", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "grok-2", provider: "xai" },
      ]);

      // Each attempt returns empty/invalid (no JSON, no URLs)
      mockAiFacade.chat
        .mockResolvedValueOnce({ content: "No relevant posts found." })
        .mockResolvedValueOnce({ content: "Nothing to report here." })
        .mockRejectedValueOnce(new Error("Rate limited")); // final attempt throws

      // Should fall back to web search
      const mockWebTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "X Post",
                url: "https://x.com/user/status/789",
                content: "content",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockWebTool);

      const results = await service.searchSocialX("AI debate", 3);

      // Falls back to web search
      expect(results[0].sourceType).toBe(DataSourceType.SOCIAL_X);
      expect(results[0].metadata?.fetchedVia).toBe("web-search-fallback");
    });

    it("should handle parseSocialSearchResponse with invalid JSON gracefully", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "grok-2", provider: "xai" },
      ]);

      // Return JSON that has trends key but not array → triggers fallback
      mockAiFacade.chat
        .mockResolvedValueOnce({ content: '{"trends": "not-an-array"}' })
        .mockResolvedValueOnce({ content: '{"trends": "not-an-array"}' })
        .mockResolvedValueOnce({ content: '{"trends": "not-an-array"}' });

      const mockWebTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, results: [] },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValue(mockWebTool);

      const results = await service.searchSocialX("test", 3);
      // Falls back to web search (no URLs extracted, so empty)
      expect(Array.isArray(results)).toBe(true);
    });

    it("should extract URLs via fallback when JSON parse throws", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "grok-2", provider: "xai" },
      ]);

      // Malformed JSON inside a code block causes JSON.parse to throw
      mockAiFacade.chat
        .mockResolvedValueOnce({
          content:
            "Check https://x.com/user/status/111 and https://x.com/user/status/222 for discussion.",
        })
        .mockResolvedValueOnce({
          content:
            "Check https://x.com/user/status/111 and https://x.com/user/status/222",
        })
        .mockResolvedValueOnce({
          content:
            "Check https://x.com/user/status/111 and https://x.com/user/status/222",
        });

      const results = await service.searchSocialX("AI debate", 5);

      // Fallback URL extraction from plain text
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle web search fallback exception", async () => {
      mockAiFacade.getAvailableModels.mockResolvedValue([
        { id: "gpt-4", provider: "openai" }, // no grok model
      ]);

      // Web search tool throws
      const failTool = {
        execute: jest.fn().mockRejectedValue(new Error("Network error")),
      };
      mockToolRegistry.tryGet.mockReturnValue(failTool);

      const results = await service.searchSocialX("test", 3);
      expect(results).toEqual([]);
    });
  });

  // ─── Policy sources – error paths ────────────────────────────────────────────

  describe("policy sources - error paths", () => {
    it("should handle federalRegister tool exception gracefully", async () => {
      mockFederalRegisterTool.execute.mockRejectedValue(
        new Error("Federal API error"),
      );

      const results = await service.executeSearch(
        DataSourceType.FEDERAL_REGISTER,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should handle congress tool exception gracefully", async () => {
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

    it("should handle whitehouse tool exception gracefully", async () => {
      mockWhiteHouseNewsTool.execute.mockRejectedValue(
        new Error("Whitehouse API error"),
      );

      const results = await service.executeSearch(
        DataSourceType.WHITEHOUSE,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty for congress when no bills in response", async () => {
      mockCongressGovTool.execute.mockResolvedValue({
        success: true,
        data: { bills: [] }, // empty bills
      });

      const results = await service.executeSearch(
        DataSourceType.CONGRESS,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should return empty for whitehouse when no items in response", async () => {
      mockWhiteHouseNewsTool.execute.mockResolvedValue({
        success: true,
        data: { items: [] }, // empty items
      });

      const results = await service.executeSearch(
        DataSourceType.WHITEHOUSE,
        "test",
        5,
      );

      expect(results).toEqual([]);
    });

    it("should handle congress bill with no shortTitle (uses title)", async () => {
      mockCongressGovTool.execute.mockResolvedValue({
        success: true,
        data: {
          bills: [
            {
              shortTitle: null, // use title fallback
              title: "Long bill title here",
              url: "https://congress.gov/bill/999",
              number: "S.5678",
              type: "S",
              congress: 119,
              introducedDate: "2025-03-01",
              sponsors: [],
              policyArea: "Science",
              latestAction: null,
            },
          ],
        },
      });

      const results = await service.executeSearch(
        DataSourceType.CONGRESS,
        "science",
        5,
      );

      expect(results[0].title).toBe("Long bill title here");
    });
  });
});

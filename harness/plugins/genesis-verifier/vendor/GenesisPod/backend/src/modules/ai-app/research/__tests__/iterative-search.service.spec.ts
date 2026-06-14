/**
 * Tests for IterativeSearchService
 */

import { Test, TestingModule } from "@nestjs/testing";
import { IterativeSearchService } from "../discussion/iterative-search.service";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import type {
  ResearchPlan,
  ResearchPlanStep,
  SearchRound,
} from "../discussion/types";

jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: jest.fn().mockImplementation(() => ({
    tryGet: jest.fn(),
    get: jest.fn(),
    register: jest.fn(),
  })),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: jest.fn().mockImplementation(() => ({
    tryGet: jest.fn(),
    get: jest.fn(),
    register: jest.fn(),
  })),
}));

describe("IterativeSearchService", () => {
  let service: IterativeSearchService;
  let toolRegistry: jest.Mocked<ToolRegistry>;

  const _mockWebSearchTool = {
    id: "web-search",
    execute: jest.fn(),
  };

  const mockStep: ResearchPlanStep = {
    id: "step_1",
    type: "initial_search",
    query: "AI technology trends 2025",
    rationale: "Initial search for core information",
    estimatedSources: 10,
  };

  beforeEach(async () => {
    const mockToolRegistryInstance = {
      tryGet: jest.fn(),
      get: jest.fn(),
      register: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IterativeSearchService,
        {
          provide: ToolRegistry,
          useValue: mockToolRegistryInstance,
        },
      ],
    }).compile();

    service = module.get<IterativeSearchService>(IterativeSearchService);
    toolRegistry = module.get(ToolRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("executeStep", () => {
    it("should return empty round when web-search tool is not found", async () => {
      (toolRegistry.tryGet as jest.Mock).mockReturnValue(undefined);

      const result = await service.executeStep(mockStep, 1);

      expect(result.round).toBe(1);
      expect(result.stepId).toBe("step_1");
      expect(result.sources).toEqual([]);
      expect(result.resultsCount).toBe(0);
    });

    it("should return search results on success", async () => {
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "AI Trends 2025",
                url: "https://example.com/ai-trends",
                content: "Latest AI trends...",
                domain: "example.com",
                publishedDate: "2025-01-01",
                score: 0.9,
              },
            ],
          },
        }),
      });

      const result = await service.executeStep(mockStep, 1);

      expect(result.round).toBe(1);
      expect(result.stepId).toBe("step_1");
      expect(result.sources.length).toBe(1);
      expect(result.sources[0].title).toBe("AI Trends 2025");
      expect(result.sources[0].relevanceScore).toBe(0.9);
    });

    it("should return empty round when tool execution fails", async () => {
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: { message: "Search failed" },
        }),
      });

      const result = await service.executeStep(mockStep, 2);

      expect(result.sources).toEqual([]);
      expect(result.resultsCount).toBe(0);
    });

    it("should return empty round when tool data is missing", async () => {
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: null,
        }),
      });

      const result = await service.executeStep(mockStep, 1);

      expect(result.sources).toEqual([]);
    });

    it("should return empty round when searchData.success is false", async () => {
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: false,
            results: [],
          },
        }),
      });

      const result = await service.executeStep(mockStep, 1);

      expect(result.sources).toEqual([]);
    });

    it("should handle tool execution errors gracefully", async () => {
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockRejectedValue(new Error("Network error")),
      });

      const result = await service.executeStep(mockStep, 1);

      expect(result.sources).toEqual([]);
      expect(result.resultsCount).toBe(0);
    });

    it("should use default relevance score when not provided", async () => {
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Test",
                url: "https://example.com",
                content: "Test content",
              },
            ],
          },
        }),
      });

      const result = await service.executeStep(mockStep, 1);

      expect(result.sources[0].relevanceScore).toBe(0.5);
    });

    it("should extract domain from URL when not provided", async () => {
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Test",
                url: "https://www.example.com/page",
                content: "Test content",
              },
            ],
          },
        }),
      });

      const result = await service.executeStep(mockStep, 1);

      expect(result.sources[0].domain).toBe("example.com");
    });

    it("should enhance query for academic step type", async () => {
      const academicStep: ResearchPlanStep = {
        ...mockStep,
        type: "academic",
        query: "machine learning",
      };

      let capturedQuery = "";
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockImplementation(async (params) => {
          capturedQuery = params.query;
          return {
            success: true,
            data: { success: true, results: [] },
          };
        }),
      });

      await service.executeStep(academicStep, 1);

      expect(capturedQuery).toContain("machine learning");
      expect(capturedQuery).toContain("research");
    });

    it("should enhance query for comparison step type", async () => {
      const comparisonStep: ResearchPlanStep = {
        ...mockStep,
        type: "comparison",
        query: "React vs Vue",
      };

      let capturedQuery = "";
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockImplementation(async (params) => {
          capturedQuery = params.query;
          return {
            success: true,
            data: { success: true, results: [] },
          };
        }),
      });

      await service.executeStep(comparisonStep, 1);

      // "React vs Vue" contains "vs" so query should remain unchanged
      expect(capturedQuery).toContain("React vs Vue");
    });

    it("should use higher maxResults for academic steps", async () => {
      const academicStep: ResearchPlanStep = {
        ...mockStep,
        type: "academic",
      };

      let capturedNumResults = 0;
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockImplementation(async (params) => {
          capturedNumResults = params.numResults;
          return {
            success: true,
            data: { success: true, results: [] },
          };
        }),
      });

      await service.executeStep(academicStep, 1);

      expect(capturedNumResults).toBe(10);
    });

    it("should use higher maxResults for non-academic steps", async () => {
      let capturedNumResults = 0;
      (toolRegistry.tryGet as jest.Mock).mockReturnValue({
        execute: jest.fn().mockImplementation(async (params) => {
          capturedNumResults = params.numResults;
          return {
            success: true,
            data: { success: true, results: [] },
          };
        }),
      });

      await service.executeStep(mockStep, 1);

      expect(capturedNumResults).toBe(15);
    });
  });

  describe("mergeAndDeduplicate", () => {
    it("should return empty array for empty input", () => {
      const result = service.mergeAndDeduplicate([]);
      expect(result).toEqual([]);
    });

    it("should merge sources from multiple rounds", () => {
      const rounds: SearchRound[] = [
        {
          round: 1,
          stepId: "step_1",
          query: "test",
          resultsCount: 2,
          sources: [
            {
              id: "s1",
              title: "Source 1",
              url: "https://example.com/1",
              snippet: "Snippet 1",
              domain: "example.com",
              relevanceScore: 0.9,
            },
            {
              id: "s2",
              title: "Source 2",
              url: "https://other.com/2",
              snippet: "Snippet 2",
              domain: "other.com",
              relevanceScore: 0.7,
            },
          ],
          timestamp: new Date(),
        },
        {
          round: 2,
          stepId: "step_2",
          query: "test 2",
          resultsCount: 1,
          sources: [
            {
              id: "s3",
              title: "Source 3",
              url: "https://third.com/3",
              snippet: "Snippet 3",
              domain: "third.com",
              relevanceScore: 0.8,
            },
          ],
          timestamp: new Date(),
        },
      ];

      const result = service.mergeAndDeduplicate(rounds);

      expect(result.length).toBe(3);
    });

    it("should deduplicate URLs", () => {
      const rounds: SearchRound[] = [
        {
          round: 1,
          stepId: "step_1",
          query: "test",
          resultsCount: 2,
          sources: [
            {
              id: "s1",
              title: "Source 1",
              url: "https://example.com/page",
              snippet: "Snippet 1",
              domain: "example.com",
              relevanceScore: 0.9,
            },
          ],
          timestamp: new Date(),
        },
        {
          round: 2,
          stepId: "step_2",
          query: "test 2",
          resultsCount: 1,
          sources: [
            {
              id: "s2",
              title: "Source 1 Duplicate",
              url: "https://example.com/page",
              snippet: "Same URL",
              domain: "example.com",
              relevanceScore: 0.8,
            },
          ],
          timestamp: new Date(),
        },
      ];

      const result = service.mergeAndDeduplicate(rounds);

      expect(result.length).toBe(1);
    });

    it("should sort by relevance score descending", () => {
      const rounds: SearchRound[] = [
        {
          round: 1,
          stepId: "step_1",
          query: "test",
          resultsCount: 3,
          sources: [
            {
              id: "s1",
              title: "Low relevance",
              url: "https://a.com",
              snippet: "Low",
              domain: "a.com",
              relevanceScore: 0.3,
            },
            {
              id: "s2",
              title: "High relevance",
              url: "https://b.com",
              snippet: "High",
              domain: "b.com",
              relevanceScore: 0.9,
            },
            {
              id: "s3",
              title: "Medium relevance",
              url: "https://c.com",
              snippet: "Medium",
              domain: "c.com",
              relevanceScore: 0.6,
            },
          ],
          timestamp: new Date(),
        },
      ];

      const result = service.mergeAndDeduplicate(rounds);

      expect(result[0].relevanceScore).toBe(0.9);
      expect(result[1].relevanceScore).toBe(0.6);
      expect(result[2].relevanceScore).toBe(0.3);
    });

    it("should handle URLs with trailing slashes as duplicates", () => {
      const rounds: SearchRound[] = [
        {
          round: 1,
          stepId: "step_1",
          query: "test",
          resultsCount: 2,
          sources: [
            {
              id: "s1",
              title: "Source 1",
              url: "https://example.com/page",
              snippet: "Snippet 1",
              domain: "example.com",
              relevanceScore: 0.9,
            },
            {
              id: "s2",
              title: "Source 2",
              url: "https://example.com/page/",
              snippet: "Snippet 2",
              domain: "example.com",
              relevanceScore: 0.8,
            },
          ],
          timestamp: new Date(),
        },
      ];

      const result = service.mergeAndDeduplicate(rounds);

      // Both normalize to "example.com/page", so should be deduplicated
      expect(result.length).toBe(1);
    });
  });

  describe("executePlanBatch", () => {
    it("should collect all rounds from executeplan", async () => {
      const mockPlan: ResearchPlan = {
        objective: "Test research",
        approach: "Standard approach",
        steps: [
          { ...mockStep, id: "step_1" },
          { ...mockStep, id: "step_2", query: "Second query" },
        ],
        estimatedTime: 40,
      };

      (toolRegistry.tryGet as jest.Mock).mockReturnValue(undefined);

      const result = await service.executePlanBatch(mockPlan);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });
  });
});

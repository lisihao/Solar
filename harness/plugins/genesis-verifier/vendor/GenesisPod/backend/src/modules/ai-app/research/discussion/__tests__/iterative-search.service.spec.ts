/**
 * IterativeSearchService Tests
 *
 * Covers:
 * - executeStep: successful search, tool unavailable, tool failure, exception
 * - executeplan: generator yielding rounds, onProgress callback
 * - executePlanBatch: collects all generator rounds
 * - mergeAndDeduplicate: deduplication by URL, sorted by relevance score
 * - Private helpers via public API:
 *   - enhanceQuery (academic / comparison / verification / default)
 *   - extractDomain (valid URL, invalid URL)
 *   - normalizeUrl (valid URL, invalid URL)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { IterativeSearchService } from "../iterative-search.service";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import type { ResearchPlanStep, ResearchPlan, SearchRound } from "../types";

// ============================================================
// Helpers
// ============================================================

function buildStep(
  overrides: Partial<ResearchPlanStep> = {},
): ResearchPlanStep {
  return {
    id: "step-1",
    type: "initial_search",
    query: "test query",
    rationale: "test rationale",
    estimatedSources: 10,
    ...overrides,
  };
}

function buildSearchResult(index: number) {
  return {
    title: `Result ${index}`,
    url: `https://example${index}.com/article`,
    content: `Content for result ${index}`,
    domain: `example${index}.com`,
    publishedDate: "2024-01-01",
    score: 0.9 - index * 0.1,
  };
}

function buildWebSearchToolSuccess(
  results: ReturnType<typeof buildSearchResult>[],
) {
  return {
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: {
        success: true,
        results,
      },
    }),
  };
}

const buildPlan = (stepCount = 3): ResearchPlan => ({
  objective: "Test research",
  approach: "iterative",
  steps: Array.from({ length: stepCount }, (_, i) =>
    buildStep({ id: `step-${i + 1}`, query: `query ${i + 1}` }),
  ),
  estimatedTime: stepCount * 20,
});

// ============================================================
// Tests
// ============================================================

describe("IterativeSearchService", () => {
  let service: IterativeSearchService;
  let mockToolRegistry: { tryGet: jest.Mock };

  beforeEach(async () => {
    mockToolRegistry = { tryGet: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IterativeSearchService,
        { provide: ToolRegistry, useValue: mockToolRegistry },
      ],
    }).compile();

    service = module.get<IterativeSearchService>(IterativeSearchService);

    // Suppress logger output
    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== executeStep ====================

  describe("executeStep", () => {
    it("should return search round with sources on success", async () => {
      const results = [buildSearchResult(0), buildSearchResult(1)];
      mockToolRegistry.tryGet.mockReturnValue(
        buildWebSearchToolSuccess(results),
      );

      const step = buildStep({ query: "climate change" });
      const round = await service.executeStep(step, 1);

      expect(round.round).toBe(1);
      expect(round.stepId).toBe(step.id);
      expect(round.query).toBe(step.query);
      expect(round.sources).toHaveLength(2);
      expect(round.resultsCount).toBe(2);
      expect(round.timestamp).toBeInstanceOf(Date);
    });

    it("should use numResults=10 for academic steps", async () => {
      const tool = buildWebSearchToolSuccess([buildSearchResult(0)]);
      mockToolRegistry.tryGet.mockReturnValue(tool);

      const step = buildStep({ type: "academic", query: "AI research" });
      await service.executeStep(step, 1);

      expect(tool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ numResults: 10 }),
        expect.anything(),
      );
    });

    it("should use numResults=15 for non-academic steps", async () => {
      const tool = buildWebSearchToolSuccess([buildSearchResult(0)]);
      mockToolRegistry.tryGet.mockReturnValue(tool);

      const step = buildStep({ type: "initial_search", query: "test" });
      await service.executeStep(step, 1);

      expect(tool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ numResults: 15 }),
        expect.anything(),
      );
    });

    it("should return empty round when web-search tool not registered", async () => {
      mockToolRegistry.tryGet.mockReturnValue(undefined);

      const step = buildStep();
      const round = await service.executeStep(step, 2);

      expect(round.round).toBe(2);
      expect(round.sources).toHaveLength(0);
      expect(round.resultsCount).toBe(0);
    });

    it("should return empty round when tool returns success=false", async () => {
      mockToolRegistry.tryGet.mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: false,
          error: { message: "Rate limited" },
        }),
      });

      const round = await service.executeStep(buildStep(), 1);

      expect(round.sources).toHaveLength(0);
    });

    it("should return empty round when toolResult.data is null", async () => {
      mockToolRegistry.tryGet.mockReturnValue({
        execute: jest.fn().mockResolvedValue({ success: true, data: null }),
      });

      const round = await service.executeStep(buildStep(), 1);

      expect(round.sources).toHaveLength(0);
    });

    it("should return empty round when searchData.success is false", async () => {
      mockToolRegistry.tryGet.mockReturnValue({
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: false, results: [] },
        }),
      });

      const round = await service.executeStep(buildStep(), 1);

      expect(round.sources).toHaveLength(0);
    });

    it("should return empty round on exception", async () => {
      mockToolRegistry.tryGet.mockReturnValue({
        execute: jest.fn().mockRejectedValue(new Error("Network error")),
      });

      const round = await service.executeStep(buildStep(), 1);

      expect(round.sources).toHaveLength(0);
    });

    it("should map source fields from search results", async () => {
      const results = [
        {
          title: "Article Title",
          url: "https://news.example.com/article/123",
          content: "Article content snippet",
          domain: "news.example.com",
          publishedDate: "2024-03-15",
          score: 0.87,
        },
      ];
      mockToolRegistry.tryGet.mockReturnValue(
        buildWebSearchToolSuccess(results),
      );

      const round = await service.executeStep(buildStep(), 1);

      const source = round.sources[0];
      expect(source.title).toBe("Article Title");
      expect(source.url).toBe("https://news.example.com/article/123");
      expect(source.snippet).toBe("Article content snippet");
      expect(source.domain).toBe("news.example.com");
      expect(source.publishedDate).toBe("2024-03-15");
      expect(source.relevanceScore).toBe(0.87);
    });

    it("should extract domain from URL when domain field is missing", async () => {
      const results = [
        {
          title: "Test",
          url: "https://www.openai.com/blog/post",
          content: "content",
          score: 0.5,
        },
      ];
      mockToolRegistry.tryGet.mockReturnValue(
        buildWebSearchToolSuccess(results),
      );

      const round = await service.executeStep(buildStep(), 1);

      expect(round.sources[0].domain).toBe("openai.com");
    });

    it("should default relevanceScore to 0.5 when score is missing", async () => {
      const results = [
        { title: "Test", url: "https://example.com", content: "content" },
      ];
      mockToolRegistry.tryGet.mockReturnValue(
        buildWebSearchToolSuccess(results),
      );

      const round = await service.executeStep(buildStep(), 1);

      expect(round.sources[0].relevanceScore).toBe(0.5);
    });

    it("should enhance academic query with keywords when missing", async () => {
      const tool = buildWebSearchToolSuccess([]);
      mockToolRegistry.tryGet.mockReturnValue(tool);

      const step = buildStep({ type: "academic", query: "machine learning" });
      await service.executeStep(step, 1);

      const callArgs = tool.execute.mock.calls[0][0];
      expect(callArgs.query).toContain("research paper academic study");
    });

    it("should not modify academic query that already contains academic keywords", async () => {
      const tool = buildWebSearchToolSuccess([]);
      mockToolRegistry.tryGet.mockReturnValue(tool);

      const step = buildStep({
        type: "academic",
        query: "machine learning research",
      });
      await service.executeStep(step, 1);

      const callArgs = tool.execute.mock.calls[0][0];
      // Should not double-add keywords
      expect(callArgs.query).toBe("machine learning research");
    });

    it("should enhance comparison query", async () => {
      const tool = buildWebSearchToolSuccess([]);
      mockToolRegistry.tryGet.mockReturnValue(tool);

      const step = buildStep({ type: "comparison", query: "React vs Vue" });
      await service.executeStep(step, 1);

      const callArgs = tool.execute.mock.calls[0][0];
      // Already has 'vs' so should not be enhanced
      expect(callArgs.query).toBe("React vs Vue");
    });

    it("should enhance comparison query without comparison keywords", async () => {
      const tool = buildWebSearchToolSuccess([]);
      mockToolRegistry.tryGet.mockReturnValue(tool);

      const step = buildStep({ type: "comparison", query: "SQL databases" });
      await service.executeStep(step, 1);

      const callArgs = tool.execute.mock.calls[0][0];
      expect(callArgs.query).toContain("comparison analysis pros cons");
    });

    it("should enhance verification query with official source and year", async () => {
      const tool = buildWebSearchToolSuccess([]);
      mockToolRegistry.tryGet.mockReturnValue(tool);

      const step = buildStep({
        type: "verification",
        query: "CO2 emissions data",
      });
      await service.executeStep(step, 1);

      const callArgs = tool.execute.mock.calls[0][0];
      expect(callArgs.query).toContain("official source");
      expect(callArgs.query).toContain(String(new Date().getFullYear()));
    });
  });

  // ==================== executeplan (generator) ====================

  describe("executeplan", () => {
    it("should yield SearchRound for each step", async () => {
      const mockTool = buildWebSearchToolSuccess([buildSearchResult(0)]);
      mockToolRegistry.tryGet.mockReturnValue(mockTool);

      const plan = buildPlan(3);
      const rounds: SearchRound[] = [];
      for await (const round of service.executeplan(plan)) {
        rounds.push(round);
      }

      expect(rounds).toHaveLength(3);
      expect(rounds[0].round).toBe(1);
      expect(rounds[1].round).toBe(2);
      expect(rounds[2].round).toBe(3);
    });

    it("should call onProgress callback for each step", async () => {
      mockToolRegistry.tryGet.mockReturnValue(buildWebSearchToolSuccess([]));

      const plan = buildPlan(2);
      const progressCalls: number[] = [];
      const onProgress = (round: number) => progressCalls.push(round);

      for await (const _ of service.executeplan(plan, onProgress)) {
        // consume generator
      }

      expect(progressCalls).toEqual([1, 2]);
    });

    it("should yield empty rounds when tool is unavailable", async () => {
      mockToolRegistry.tryGet.mockReturnValue(undefined);

      const plan = buildPlan(2);
      const rounds: SearchRound[] = [];
      for await (const round of service.executeplan(plan)) {
        rounds.push(round);
      }

      expect(rounds).toHaveLength(2);
      expect(rounds.every((r) => r.sources.length === 0)).toBe(true);
    });
  });

  // ==================== executePlanBatch ====================

  describe("executePlanBatch", () => {
    it("should return all search rounds as array", async () => {
      mockToolRegistry.tryGet.mockReturnValue(
        buildWebSearchToolSuccess([buildSearchResult(0)]),
      );

      const plan = buildPlan(2);
      const result = await service.executePlanBatch(plan);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });

    it("should return empty array when plan has no steps", async () => {
      const plan = buildPlan(0);
      const result = await service.executePlanBatch(plan);

      expect(result).toHaveLength(0);
    });
  });

  // ==================== mergeAndDeduplicate ====================

  describe("mergeAndDeduplicate", () => {
    it("should deduplicate sources with the same URL", () => {
      const rounds: SearchRound[] = [
        {
          round: 1,
          stepId: "step-1",
          query: "q1",
          resultsCount: 2,
          timestamp: new Date(),
          sources: [
            {
              id: "src-1",
              title: "Article A",
              url: "https://example.com/article",
              snippet: "Content A",
              domain: "example.com",
              relevanceScore: 0.9,
            },
            {
              id: "src-2",
              title: "Article B",
              url: "https://other.com/page",
              snippet: "Content B",
              domain: "other.com",
              relevanceScore: 0.7,
            },
          ],
        },
        {
          round: 2,
          stepId: "step-2",
          query: "q2",
          resultsCount: 1,
          timestamp: new Date(),
          sources: [
            {
              id: "src-3",
              title: "Article A duplicate",
              url: "https://www.example.com/article",
              snippet: "Content A dup",
              domain: "example.com",
              relevanceScore: 0.8,
            },
          ],
        },
      ];

      const result = service.mergeAndDeduplicate(rounds);

      expect(result).toHaveLength(2);
    });

    it("should sort results by relevanceScore descending", () => {
      const rounds: SearchRound[] = [
        {
          round: 1,
          stepId: "step-1",
          query: "q",
          resultsCount: 3,
          timestamp: new Date(),
          sources: [
            {
              id: "a",
              title: "A",
              url: "https://a.com",
              snippet: "",
              domain: "a.com",
              relevanceScore: 0.5,
            },
            {
              id: "b",
              title: "B",
              url: "https://b.com",
              snippet: "",
              domain: "b.com",
              relevanceScore: 0.9,
            },
            {
              id: "c",
              title: "C",
              url: "https://c.com",
              snippet: "",
              domain: "c.com",
              relevanceScore: 0.7,
            },
          ],
        },
      ];

      const result = service.mergeAndDeduplicate(rounds);

      expect(result[0].relevanceScore).toBe(0.9);
      expect(result[1].relevanceScore).toBe(0.7);
      expect(result[2].relevanceScore).toBe(0.5);
    });

    it("should return empty array when no rounds provided", () => {
      const result = service.mergeAndDeduplicate([]);

      expect(result).toHaveLength(0);
    });

    it("should return empty array when rounds have no sources", () => {
      const rounds: SearchRound[] = [
        {
          round: 1,
          stepId: "s1",
          query: "q",
          resultsCount: 0,
          timestamp: new Date(),
          sources: [],
        },
      ];

      const result = service.mergeAndDeduplicate(rounds);

      expect(result).toHaveLength(0);
    });

    it("should handle invalid URLs gracefully in deduplication", () => {
      const rounds: SearchRound[] = [
        {
          round: 1,
          stepId: "s1",
          query: "q",
          resultsCount: 1,
          timestamp: new Date(),
          sources: [
            {
              id: "s",
              title: "Test",
              url: "not-a-valid-url",
              snippet: "",
              domain: "",
              relevanceScore: 0.5,
            },
          ],
        },
      ];

      const result = service.mergeAndDeduplicate(rounds);

      expect(result).toHaveLength(1);
    });
  });
});

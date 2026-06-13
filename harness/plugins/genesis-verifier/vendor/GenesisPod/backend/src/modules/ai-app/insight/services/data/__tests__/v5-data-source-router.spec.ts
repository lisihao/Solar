import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { DataSourceRouterService } from "../data-source-router.service";

describe("DataSourceRouterService - V5 Methods", () => {
  let service: DataSourceRouterService;
  let mockExecuteSearch: ReturnType<
    typeof jest.fn<(source: unknown, query: string) => Promise<unknown>>
  >;

  beforeEach(() => {
    service = new DataSourceRouterService(
      {} as any, // toolRegistry
      {} as any, // federalRegisterTool
      {} as any, // congressGovTool
      {} as any, // whiteHouseNewsTool
      {} as any, // dataSourcePlanner
      {} as any, // aiFacade
    );

    // Mock the private executeSearch method
    mockExecuteSearch =
      jest.fn<(source: unknown, query: string) => Promise<unknown>>();
    (service as any).executeSearch = mockExecuteSearch;
  });

  describe("scanLiteratureBaseline", () => {
    const topic = { id: "t1", name: "AI in Healthcare" } as any;
    const dimension = {
      id: "d1",
      name: "Market Overview",
      description: "Market analysis",
    } as any;

    it("should generate 3 academic queries including mckinsey/gartner", async () => {
      mockExecuteSearch.mockResolvedValue([]);

      await service.scanLiteratureBaseline(topic, dimension);

      expect(mockExecuteSearch).toHaveBeenCalledTimes(3);
      const allQueries = mockExecuteSearch.mock.calls.map((c) => c[1]);
      expect(
        allQueries.some((q) => q.includes("mckinsey") || q.includes("bcg")),
      ).toBe(true);
      expect(
        allQueries.some(
          (q) => q.includes("gartner") || q.includes("forrester"),
        ),
      ).toBe(true);
    });

    it("should deduplicate results by URL", async () => {
      const result1 = {
        url: "https://example.com/a",
        title: "A",
        sourceType: "web",
      };
      const result2 = {
        url: "https://example.com/a",
        title: "A dup",
        sourceType: "web",
      };
      const result3 = {
        url: "https://example.com/b",
        title: "B",
        sourceType: "web",
      };

      mockExecuteSearch
        .mockResolvedValueOnce([result1, result2])
        .mockResolvedValueOnce([result3])
        .mockResolvedValueOnce([]);

      const results = await service.scanLiteratureBaseline(topic, dimension);
      expect(results).toHaveLength(2);
    });

    it("should continue when a query fails", async () => {
      const result = {
        url: "https://example.com/a",
        title: "A",
        sourceType: "web",
      };

      mockExecuteSearch
        .mockRejectedValueOnce(new Error("search error"))
        .mockResolvedValueOnce([result])
        .mockResolvedValueOnce([]);

      const results = await service.scanLiteratureBaseline(topic, dimension);
      expect(results).toHaveLength(1);
    });
  });

  describe("searchForHypothesis", () => {
    it("should generate support and counter queries", async () => {
      mockExecuteSearch.mockResolvedValue([]);

      await service.searchForHypothesis(
        "AI adoption will increase healthcare efficiency significantly",
      );

      // 2 support + 2 counter queries
      expect(mockExecuteSearch).toHaveBeenCalledTimes(4);
      const allQueries = mockExecuteSearch.mock.calls.map((c) => c[1]);
      expect(
        allQueries.some(
          (q) =>
            q.includes("evidence support") || q.includes("research findings"),
        ),
      ).toBe(true);
      expect(
        allQueries.some(
          (q) => q.includes("criticism") || q.includes("counter"),
        ),
      ).toBe(true);
    });

    it("should return partial results when queries fail", async () => {
      const supportResult = {
        url: "https://example.com/support",
        title: "Support",
        sourceType: "web",
      };

      mockExecuteSearch
        .mockResolvedValueOnce([supportResult]) // support query 1
        .mockResolvedValueOnce([]) // support query 2
        .mockRejectedValueOnce(new Error("fail")) // counter query 1
        .mockResolvedValueOnce([]); // counter query 2

      const result = await service.searchForHypothesis(
        "AI adoption increases efficiency",
      );
      expect(result.supportResults).toHaveLength(1);
      expect(result.counterResults).toHaveLength(0);
    });
  });
});

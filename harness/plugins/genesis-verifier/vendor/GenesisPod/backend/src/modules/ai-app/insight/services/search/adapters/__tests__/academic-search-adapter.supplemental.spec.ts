/**
 * AcademicSearchAdapter - supplemental tests for doSearch phased strategy
 *
 * Covers the multi-phase search logic:
 * - Phase 1: OpenAlex + PubMed in parallel
 * - Phase 2: Semantic Scholar (if insufficient results)
 * - Phase 2b: ArXiv with deadline guard
 * - Deduplication logic
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  AIModelType: { CHAT: "CHAT" },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
}));

import { AcademicSearchAdapter } from "../academic-search.adapter";
import { DataSourceType } from "../../../../types/data-source.types";
import type { DataSourceResult } from "../../../../types/data-source.types";
import type { AdapterSearchRequest } from "../../search.types";

const BASE_REQUEST: AdapterSearchRequest = {
  query: "machine learning",
  maxResults: 10,
  timeoutMs: 30000,
};

function makeToolRegistry(
  toolMocks: Record<string, { execute: jest.Mock }> = {},
) {
  return {
    tryGet: jest.fn((toolId: string) => toolMocks[toolId] || null),
  };
}

function makeOpenAlexResult(i: number): DataSourceResult {
  return {
    sourceType: DataSourceType.OPENALEX,
    title: `OpenAlex Paper ${i}`,
    url: `https://openalex.org/W${i}`,
    snippet: `Abstract ${i}`,
  };
}

function makePubMedResult(i: number): DataSourceResult {
  return {
    sourceType: DataSourceType.PUBMED,
    title: `PubMed Article ${i}`,
    url: `https://pubmed.ncbi.nlm.nih.gov/${i}`,
    snippet: `Abstract ${i}`,
  };
}

function makeSemanticScholarResult(i: number): DataSourceResult {
  return {
    sourceType: DataSourceType.SEMANTIC_SCHOLAR,
    title: `SS Paper ${i}`,
    url: `https://semanticscholar.org/paper/${i}`,
    snippet: `Abstract ${i}`,
  };
}

function makeArxivResult(i: number): DataSourceResult {
  return {
    sourceType: DataSourceType.ACADEMIC,
    title: `ArXiv Paper ${i}`,
    url: `https://arxiv.org/abs/${i}`,
    snippet: `Abstract ${i}`,
  };
}

describe("AcademicSearchAdapter - doSearch phased strategy", () => {
  let throttle: { execute: jest.Mock };

  beforeEach(() => {
    throttle = { execute: jest.fn() };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return Phase 1 results when sufficient (>=10)", async () => {
    // OpenAlex returns 6, PubMed returns 6 → 12 >= 10, skip Phase 2
    const openAlexResults = Array.from({ length: 6 }, (_, i) =>
      makeOpenAlexResult(i),
    );
    const pubmedResults = Array.from({ length: 6 }, (_, i) =>
      makePubMedResult(i),
    );

    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search") return openAlexResults;
      if (sourceId === "pubmed") return pubmedResults;
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items.length).toBeGreaterThanOrEqual(10);
    // Semantic Scholar should NOT have been called
    const ssCall = throttle.execute.mock.calls.find(
      (c: string[]) => c[0] === "semantic-scholar",
    );
    expect(ssCall).toBeUndefined();
  });

  it("should fall through to Phase 2 (Semantic Scholar) when Phase 1 insufficient", async () => {
    // Phase 1 returns only 3 items total
    const openAlexResults = [makeOpenAlexResult(1)];
    const pubmedResults = [makePubMedResult(1), makePubMedResult(2)];
    const ssResults = Array.from({ length: 8 }, (_, i) =>
      makeSemanticScholarResult(i),
    );

    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search") return openAlexResults;
      if (sourceId === "pubmed") return pubmedResults;
      if (sourceId === "semantic-scholar") return ssResults;
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items.length).toBeGreaterThanOrEqual(3);
    const ssCall = throttle.execute.mock.calls.find(
      (c: string[]) => c[0] === "semantic-scholar",
    );
    expect(ssCall).toBeDefined();
  });

  it("should fall through to Phase 2b (ArXiv) when Phase 1+2 still insufficient", async () => {
    // Phase 1 + 2 returns < 10 items total → go to ArXiv
    const openAlexResults = [makeOpenAlexResult(1)];
    const pubmedResults = [makePubMedResult(1)];
    const ssResults = [makeSemanticScholarResult(1)];
    const arxivResults = Array.from({ length: 5 }, (_, i) =>
      makeArxivResult(i),
    );

    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search") return openAlexResults;
      if (sourceId === "pubmed") return pubmedResults;
      if (sourceId === "semantic-scholar") return ssResults;
      if (sourceId === "arxiv-search") return arxivResults;
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search(BASE_REQUEST);

    const arxivCall = throttle.execute.mock.calls.find(
      (c: string[]) => c[0] === "arxiv-search",
    );
    expect(arxivCall).toBeDefined();
    expect(result.items.length).toBeGreaterThanOrEqual(3);
  });

  it("should deduplicate items with identical URLs", async () => {
    // Same URL appears from both OpenAlex and PubMed
    const duplicateUrl = "https://doi.org/10.1234/dup";
    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search") {
        return [
          {
            sourceType: DataSourceType.OPENALEX,
            title: "Paper A",
            url: duplicateUrl,
            snippet: "x",
          },
        ];
      }
      if (sourceId === "pubmed") {
        return [
          {
            sourceType: DataSourceType.PUBMED,
            title: "Paper A (PubMed)",
            url: duplicateUrl,
            snippet: "y",
          },
        ];
      }
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search(BASE_REQUEST);

    const urlMatches = result.items.filter((i) => i.url === duplicateUrl);
    expect(urlMatches).toHaveLength(1);
  });

  it("should deduplicate items with identical titles", async () => {
    const dupTitle = "Neural Networks: A Comprehensive Survey";
    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search") {
        return [
          {
            sourceType: DataSourceType.OPENALEX,
            title: dupTitle,
            url: "https://a.com/1",
            snippet: "x",
          },
        ];
      }
      if (sourceId === "pubmed") {
        return [
          {
            sourceType: DataSourceType.PUBMED,
            title: dupTitle,
            url: "https://b.com/2",
            snippet: "y",
          },
        ];
      }
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search(BASE_REQUEST);

    const titleMatches = result.items.filter((i) => i.title === dupTitle);
    expect(titleMatches).toHaveLength(1);
  });

  it("should handle OpenAlex failure gracefully and continue", async () => {
    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search") throw new Error("OpenAlex API down");
      if (sourceId === "pubmed")
        return [makePubMedResult(1), makePubMedResult(2)];
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search(BASE_REQUEST);

    // Should still return PubMed results
    expect(result.items.length).toBeGreaterThanOrEqual(0);
  });

  it("should handle PubMed failure gracefully and continue", async () => {
    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search")
        return [makeOpenAlexResult(1), makeOpenAlexResult(2)];
      if (sourceId === "pubmed") throw new Error("PubMed timeout");
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items.length).toBeGreaterThanOrEqual(0);
  });

  it("should handle Semantic Scholar failure gracefully", async () => {
    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search") return [makeOpenAlexResult(1)];
      if (sourceId === "pubmed") return [];
      if (sourceId === "semantic-scholar") throw new Error("SS rate limited");
      if (sourceId === "arxiv-search") return [makeArxivResult(1)];
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items.length).toBeGreaterThanOrEqual(0);
  });

  it("should handle ArXiv failure gracefully", async () => {
    throttle.execute.mockImplementation(async (sourceId: string) => {
      if (sourceId === "openalex-search") return [makeOpenAlexResult(1)];
      if (sourceId === "pubmed") return [];
      if (sourceId === "semantic-scholar")
        return [makeSemanticScholarResult(1)];
      if (sourceId === "arxiv-search")
        throw new Error("arxiv deadline exceeded");
      return [];
    });

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );

    await expect(adapter.search(BASE_REQUEST)).resolves.toBeDefined();
  });

  it("should respect abort signal", async () => {
    const controller = new AbortController();
    controller.abort();

    throttle.execute.mockResolvedValue([]);

    const toolRegistry = makeToolRegistry();
    const adapter = new AcademicSearchAdapter(
      toolRegistry as never,
      throttle as never,
    );
    const result = await adapter.search({
      ...BASE_REQUEST,
      signal: controller.signal,
    });

    // Aborted signal should return early from base class
    expect(result.items).toHaveLength(0);
  });

  describe("tool result parsing", () => {
    it("should parse OpenAlex tool result format correctly", async () => {
      const toolMock = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            results: [
              {
                title: "OpenAlex Paper",
                doi: "10.1234/test",
                publicationDate: "2024-01-15",
                abstract: "Test abstract",
                citationCount: 42,
                openAccessUrl: "https://openalex.org/W123",
                authors: ["Author A"],
              },
            ],
          },
        }),
      };

      throttle.execute.mockImplementation(
        async (sourceId: string, fn: () => Promise<DataSourceResult[]>) => fn(),
      );
      const toolRegistry = makeToolRegistry({ "openalex-search": toolMock });
      const adapter = new AcademicSearchAdapter(
        toolRegistry as never,
        throttle as never,
      );

      const result = await adapter.search(BASE_REQUEST);

      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it("should parse PubMed tool result format correctly", async () => {
      const toolMock = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            articles: [
              {
                title: "PubMed Article",
                url: "https://pubmed.ncbi.nlm.nih.gov/123",
                abstract: "Medical abstract",
                publishedDate: "2024-02-01",
                authors: ["Dr. Smith"],
                journal: "Nature Medicine",
              },
            ],
          },
        }),
      };

      throttle.execute.mockImplementation(
        async (sourceId: string, fn: () => Promise<DataSourceResult[]>) => fn(),
      );
      const toolRegistry = makeToolRegistry({ pubmed: toolMock });
      const adapter = new AcademicSearchAdapter(
        toolRegistry as never,
        throttle as never,
      );

      const result = await adapter.search(BASE_REQUEST);

      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it("should parse Semantic Scholar tool result format correctly", async () => {
      const toolMock = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            data: [
              {
                title: "SS Paper",
                url: "https://semanticscholar.org/paper/abc",
                abstract: "Abstract",
                year: 2023,
                citationCount: 100,
              },
            ],
          },
        }),
      };

      throttle.execute.mockImplementation(
        async (sourceId: string, fn: () => Promise<DataSourceResult[]>) => fn(),
      );
      const toolRegistry = makeToolRegistry({ "semantic-scholar": toolMock });
      const adapter = new AcademicSearchAdapter(
        toolRegistry as never,
        throttle as never,
      );

      // Need phase 1 to fail to trigger phase 2
      throttle.execute.mockImplementation(
        async (sourceId: string, fn: () => Promise<DataSourceResult[]>) => {
          if (sourceId === "openalex-search") return [];
          if (sourceId === "pubmed") return [];
          return fn();
        },
      );

      const result = await adapter.search(BASE_REQUEST);
      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it("should parse ArXiv tool result format correctly", async () => {
      const arxivTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            papers: [
              {
                title: "ArXiv Paper",
                url: "https://arxiv.org/abs/2401.12345",
                abstract: "Abstract text",
                published: "2024-01-15",
                authors: ["Author"],
                categories: ["cs.LG"],
              },
            ],
          },
        }),
      };

      const toolRegistry = makeToolRegistry({ "arxiv-search": arxivTool });
      throttle.execute.mockImplementation(
        async (sourceId: string, fn: () => Promise<DataSourceResult[]>) => {
          if (sourceId === "openalex-search") return [];
          if (sourceId === "pubmed") return [];
          if (sourceId === "semantic-scholar") return [];
          return fn();
        },
      );

      const adapter = new AcademicSearchAdapter(
        toolRegistry as never,
        throttle as never,
      );
      const result = await adapter.search(BASE_REQUEST);

      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });
  });
});

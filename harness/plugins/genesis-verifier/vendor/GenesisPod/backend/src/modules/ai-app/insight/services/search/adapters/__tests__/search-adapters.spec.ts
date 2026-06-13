/**
 * Search Adapters Unit Tests
 *
 * Tests SearchAdapterBase (timeout, circuit breaker, abort),
 * and all concrete adapters: Web, Academic, GitHub, HackerNews,
 * Social, Policy, Local.
 *
 * Also tests SearchExecutorService (searchAllSources, getAdapter,
 * getAvailableSources).
 */

// ---------------------------------------------------------------------------
// Module-level Prisma mock (avoids schema generation requirement)
// ---------------------------------------------------------------------------
jest.mock("@prisma/client", () => ({
  AIModelType: { CHAT: "CHAT" },
  PrismaClient: class {},
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  EntityHealthRegistry: class {},
  TaskCompletionType: {
    TIMEOUT: "TIMEOUT",
    API_ERROR: "API_ERROR",
    SUCCESS: "SUCCESS",
  },
  ToolRegistry: class {},
  ChatFacade: class {},
  RAGFacade: class {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";

import { SearchAdapterBase } from "../search-adapter.base";
import { WebSearchAdapter } from "../web-search.adapter";
import { GithubSearchAdapter } from "../github-search.adapter";
import { HackernewsSearchAdapter } from "../hackernews-search.adapter";
import { SocialSearchAdapter } from "../social-search.adapter";
import { PolicySearchAdapter } from "../policy-search.adapter";
import { LocalSearchAdapter } from "../local-search.adapter";
import { AcademicSearchAdapter } from "../academic-search.adapter";
import { IndustryReportSearchAdapter } from "../industry-report-search.adapter";
import { SearchExecutorService } from "../../search-executor.service";
import { GlobalSourceThrottleService } from "../../global-source-throttle.service";

import { DataSourceType } from "../../../../types/data-source.types";
import type { AdapterSearchRequest } from "../../search.types";
import type { DataSourceResult } from "../../../../types/data-source.types";

// ---------------------------------------------------------------------------
// Helper mocks
// ---------------------------------------------------------------------------

function makeToolRegistry(toolMocks: Record<string, jest.Mock> = {}) {
  return {
    tryGet: jest.fn((toolId: string) => {
      if (toolMocks[toolId]) {
        return { execute: toolMocks[toolId] };
      }
      return undefined;
    }),
  };
}

function makeCircuitBreaker(canExecute = true) {
  return {
    canExecute: jest.fn().mockReturnValue(canExecute),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  };
}

function makeChatFacade(response: Record<string, unknown> = {}) {
  return {
    chat: jest.fn().mockResolvedValue({
      isError: false,
      content: JSON.stringify([
        {
          title: "Tweet 1",
          url: "https://x.com/user/status/1",
          snippet: "interesting tweet",
          date: "2024-01-15T00:00:00Z",
        },
      ]),
      ...response,
    }),
  };
}

function makeRagFacade(
  response: Record<string, unknown> = { success: true, results: [] },
) {
  return {
    search: jest.fn().mockResolvedValue(response),
  };
}

const BASE_REQUEST: AdapterSearchRequest = {
  query: "test query",
  maxResults: 5,
  timeoutMs: 5000,
};

// ---------------------------------------------------------------------------
// SearchAdapterBase — tested through a minimal concrete subclass
// ---------------------------------------------------------------------------

class ConcreteAdapter extends SearchAdapterBase {
  protected readonly logger = new Logger("ConcreteAdapter");
  readonly sourceId = "concrete";
  readonly sourceType = DataSourceType.WEB;
  readonly concurrency = 2;
  readonly defaultTimeoutMs = 5000;

  doSearchImpl: jest.Mock<Promise<DataSourceResult[]>>;

  constructor(cb?: ReturnType<typeof makeCircuitBreaker>) {
    super(cb as any);
    this.doSearchImpl = jest.fn<Promise<DataSourceResult[]>, []>();
  }

  protected doSearch(
    _request: AdapterSearchRequest,
  ): Promise<DataSourceResult[]> {
    return this.doSearchImpl();
  }
}

describe("SearchAdapterBase", () => {
  it("should return results on successful doSearch", async () => {
    const adapter = new ConcreteAdapter();
    const item: DataSourceResult = {
      sourceType: DataSourceType.WEB,
      title: "T",
      url: "https://a.com",
      snippet: "S",
    };
    adapter.doSearchImpl.mockResolvedValue([item]);

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("T");
    expect(result.sourceMetrics.sourceId).toBe("concrete");
    expect(result.sourceMetrics.error).toBeUndefined();
  });

  it("should return empty items when circuit breaker is open", async () => {
    const cb = makeCircuitBreaker(false);
    const adapter = new ConcreteAdapter(cb);

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(0);
    expect(result.sourceMetrics.error).toBe("circuit_breaker_open");
    expect(adapter.doSearchImpl).not.toHaveBeenCalled();
  });

  it("should return empty items when signal is already aborted", async () => {
    const adapter = new ConcreteAdapter();
    const ac = new AbortController();
    ac.abort();

    const result = await adapter.search({ ...BASE_REQUEST, signal: ac.signal });

    expect(result.items).toHaveLength(0);
    expect(result.sourceMetrics.error).toBe("cancelled");
    expect(adapter.doSearchImpl).not.toHaveBeenCalled();
  });

  it("should catch doSearch errors and record circuit breaker failure", async () => {
    const cb = makeCircuitBreaker(true);
    const adapter = new ConcreteAdapter(cb);
    adapter.doSearchImpl.mockRejectedValue(new Error("network error"));

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(0);
    expect(result.sourceMetrics.error).toBe("network error");
    expect(cb.recordFailure).toHaveBeenCalledWith(
      "datasource:concrete",
      "API_ERROR",
      "network error",
    );
  });

  it("should record circuit breaker failure with TIMEOUT type on timeout errors", async () => {
    const cb = makeCircuitBreaker(true);
    const adapter = new ConcreteAdapter(cb);
    adapter.doSearchImpl.mockRejectedValue(
      new Error("concrete timeout (5000ms)"),
    );

    const result = await adapter.search(BASE_REQUEST);

    expect(cb.recordFailure).toHaveBeenCalledWith(
      "datasource:concrete",
      "TIMEOUT",
      expect.any(String),
    );
    expect(result.items).toHaveLength(0);
  });

  it("should record circuit breaker success on successful doSearch", async () => {
    const cb = makeCircuitBreaker(true);
    const adapter = new ConcreteAdapter(cb);
    adapter.doSearchImpl.mockResolvedValue([]);

    await adapter.search(BASE_REQUEST);

    expect(cb.recordSuccess).toHaveBeenCalledWith(
      "datasource:concrete",
      expect.any(Number),
    );
  });

  it("formatQuery should return baseQuery unchanged by default", () => {
    const adapter = new ConcreteAdapter();
    expect(adapter.formatQuery("hello world")).toBe("hello world");
  });

  it("isAvailable should return true by default", async () => {
    const adapter = new ConcreteAdapter();
    expect(await adapter.isAvailable()).toBe(true);
  });

  it("should timeout and return error when doSearch exceeds timeoutMs", async () => {
    const adapter = new ConcreteAdapter();
    adapter.doSearchImpl.mockImplementation(
      () =>
        new Promise<DataSourceResult[]>((resolve) =>
          setTimeout(() => resolve([]), 2000),
        ),
    );

    const result = await adapter.search({ ...BASE_REQUEST, timeoutMs: 50 });

    expect(result.items).toHaveLength(0);
    expect(result.sourceMetrics.error).toContain("timeout");
  }, 3000);

  describe("executeToolSearch", () => {
    it("should return empty array when tool is not registered", async () => {
      const adapter = new ConcreteAdapter();
      const toolRegistry = makeToolRegistry({});

      const result = await (adapter as any).executeToolSearch(
        toolRegistry,
        "missing-tool",
        { query: "test" },
        (r: Record<string, unknown>) => r as unknown as DataSourceResult[],
      );

      expect(result).toHaveLength(0);
    });

    it("should return empty array when tool execution fails", async () => {
      const adapter = new ConcreteAdapter();
      const toolExec = jest
        .fn()
        .mockResolvedValue({ success: false, data: null });
      const toolRegistry = makeToolRegistry({ "fail-tool": toolExec });

      const result = await (adapter as any).executeToolSearch(
        toolRegistry,
        "fail-tool",
        { query: "test" },
        (r: Record<string, unknown>) => r as unknown as DataSourceResult[],
      );

      expect(result).toHaveLength(0);
    });

    it("should call converter with tool result data on success", async () => {
      const adapter = new ConcreteAdapter();
      const toolExec = jest
        .fn()
        .mockResolvedValue({ success: true, data: { key: "value" } });
      const toolRegistry = makeToolRegistry({ "good-tool": toolExec });
      const converter = jest.fn().mockReturnValue([
        {
          sourceType: DataSourceType.WEB,
          title: "converted",
          url: "https://x.com",
          snippet: "s",
        },
      ]);

      const result = await (adapter as any).executeToolSearch(
        toolRegistry,
        "good-tool",
        { query: "test" },
        converter,
      );

      expect(converter).toHaveBeenCalledWith({ key: "value" });
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("converted");
    });
  });
});

// ---------------------------------------------------------------------------
// WebSearchAdapter
// ---------------------------------------------------------------------------

describe("WebSearchAdapter", () => {
  let adapter: WebSearchAdapter;
  let toolRegistry: ReturnType<typeof makeToolRegistry>;

  beforeEach(async () => {
    const webSearchTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            title: "Web Result",
            url: "https://example.com/page",
            content: "web content",
            publishedDate: "2024-01-10",
          },
        ],
      },
    });

    toolRegistry = makeToolRegistry({ "web-search": webSearchTool });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSearchAdapter,
        { provide: "ToolRegistry", useValue: toolRegistry },
      ],
    })
      .overrideProvider(WebSearchAdapter)
      .useFactory({
        factory: () => new WebSearchAdapter(toolRegistry as any),
      })
      .compile();

    adapter = module.get<WebSearchAdapter>(WebSearchAdapter);
  });

  it("should have correct sourceType and sourceId", () => {
    expect(adapter.sourceType).toBe(DataSourceType.WEB);
    expect(adapter.sourceId).toBe("web-search");
  });

  it("formatQuery should append year when freshness is recent", () => {
    const year = new Date().getFullYear();
    const formatted = adapter.formatQuery("AI trends", {
      freshness: "recent",
    } as any);
    expect(formatted).toBe(`AI trends ${year} latest`);
  });

  it("formatQuery should return baseQuery unchanged when freshness is not recent", () => {
    expect(adapter.formatQuery("AI trends")).toBe("AI trends");
    expect(
      adapter.formatQuery("AI trends", { freshness: "standard" } as any),
    ).toBe("AI trends");
  });

  it("search should return mapped DataSourceResults", async () => {
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe(DataSourceType.WEB);
    expect(result.items[0].title).toBe("Web Result");
    expect(result.items[0].url).toBe("https://example.com/page");
    expect(result.items[0].snippet).toBe("web content");
    expect(result.items[0].publishedAt).toBeInstanceOf(Date);
    expect(result.items[0].domain).toBe("example.com");
  });

  it("should pass since parameter when provided", async () => {
    const since = new Date("2024-01-01");
    const webSearchTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    });
    toolRegistry.tryGet.mockImplementation(() => ({ execute: webSearchTool }));

    await adapter.search({ ...BASE_REQUEST, since });

    expect(webSearchTool).toHaveBeenCalledWith(
      expect.objectContaining({ since: since.toISOString() }),
      expect.any(Object),
    );
  });

  it("should return empty results when tool returns non-array results", async () => {
    const tool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: null },
    });
    toolRegistry.tryGet.mockImplementation(() => ({ execute: tool }));

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GithubSearchAdapter
// ---------------------------------------------------------------------------

describe("GithubSearchAdapter", () => {
  let adapter: GithubSearchAdapter;
  let toolRegistry: ReturnType<typeof makeToolRegistry>;

  beforeEach(() => {
    const githubTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        repositories: [
          {
            fullName: "owner/repo",
            description: "A great repo",
            url: "https://github.com/owner/repo",
            stars: 1000,
            language: "TypeScript",
            updatedAt: "2024-01-10T00:00:00Z",
          },
        ],
      },
    });
    toolRegistry = makeToolRegistry({ "github-search": githubTool });
    adapter = new GithubSearchAdapter(toolRegistry as any);
  });

  it("should have correct metadata", () => {
    expect(adapter.sourceId).toBe("github-search");
    expect(adapter.sourceType).toBe(DataSourceType.GITHUB);
  });

  it("formatQuery should add framework/library suffix when not present", () => {
    const result = adapter.formatQuery("machine learning");
    expect(result).toBe("machine learning framework OR library");
  });

  it("formatQuery should NOT add suffix when query already contains framework keyword", () => {
    const result = adapter.formatQuery("react framework");
    expect(result).toBe("react framework");
  });

  it("formatQuery should NOT add suffix for library keyword", () => {
    expect(adapter.formatQuery("utility library")).toBe("utility library");
  });

  it("formatQuery should NOT add suffix for sdk keyword", () => {
    expect(adapter.formatQuery("openai sdk")).toBe("openai sdk");
  });

  it("formatQuery should NOT add suffix for package keyword", () => {
    expect(adapter.formatQuery("npm package manager")).toBe(
      "npm package manager",
    );
  });

  it("formatQuery should NOT add suffix for plugin keyword", () => {
    expect(adapter.formatQuery("webpack plugin")).toBe("webpack plugin");
  });

  it("search should return mapped repo results", async () => {
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe(DataSourceType.GITHUB);
    expect(result.items[0].title).toBe("owner/repo");
    expect(result.items[0].url).toBe("https://github.com/owner/repo");
    expect(result.items[0].snippet).toBe("A great repo");
    expect(result.items[0].domain).toBe("github.com");
    expect(result.items[0].metadata?.["stars"]).toBe(1000);
    expect(result.items[0].metadata?.["language"]).toBe("TypeScript");
    expect(result.items[0].publishedAt).toBeInstanceOf(Date);
  });

  it("should return empty when repositories is not an array", async () => {
    const tool = jest.fn().mockResolvedValue({
      success: true,
      data: { repositories: "not-array" },
    });
    toolRegistry.tryGet.mockImplementation(() => ({ execute: tool }));

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("should return empty when tool not registered", async () => {
    toolRegistry.tryGet.mockReturnValue(undefined);
    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HackernewsSearchAdapter
// ---------------------------------------------------------------------------

describe("HackernewsSearchAdapter", () => {
  let adapter: HackernewsSearchAdapter;
  let toolRegistry: ReturnType<typeof makeToolRegistry>;

  beforeEach(() => {
    const hnTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        stories: [
          {
            title: "HN Story Title",
            url: "https://example.com/story",
            objectID: "12345",
            points: 200,
            author: "hnuser",
            createdAt: "2024-01-10T10:00:00Z",
            commentCount: 50,
          },
        ],
      },
    });
    toolRegistry = makeToolRegistry({ "hackernews-search": hnTool });
    adapter = new HackernewsSearchAdapter(toolRegistry as any);
  });

  it("should have correct metadata", () => {
    expect(adapter.sourceId).toBe("hackernews-search");
    expect(adapter.sourceType).toBe(DataSourceType.HACKERNEWS);
  });

  it("search should return mapped HN story results", async () => {
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe(DataSourceType.HACKERNEWS);
    expect(result.items[0].title).toBe("HN Story Title");
    expect(result.items[0].url).toBe("https://example.com/story");
    expect(result.items[0].domain).toBe("news.ycombinator.com");
    expect(result.items[0].snippet).toContain("200 points");
    expect(result.items[0].snippet).toContain("hnuser");
    expect(result.items[0].snippet).toContain("50 comments");
    expect(result.items[0].metadata?.["points"]).toBe(200);
    expect(result.items[0].metadata?.["author"]).toBe("hnuser");
    expect(result.items[0].publishedAt).toBeInstanceOf(Date);
  });

  it("should construct fallback url from objectID when url is missing", async () => {
    const tool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        stories: [
          {
            title: "No URL Story",
            objectID: "99999",
            points: 10,
            author: "anon",
          },
        ],
      },
    });
    toolRegistry.tryGet.mockImplementation(() => ({ execute: tool }));

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items[0].url).toContain("99999");
    expect(result.items[0].url).toContain("news.ycombinator.com");
  });

  it("should return empty when stories is not an array", async () => {
    const tool = jest.fn().mockResolvedValue({
      success: true,
      data: { stories: null },
    });
    toolRegistry.tryGet.mockImplementation(() => ({ execute: tool }));

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("should handle missing publishedAt gracefully", async () => {
    const tool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        stories: [
          {
            title: "No Date Story",
            objectID: "1",
            points: 5,
            author: "x",
            // no createdAt
          },
        ],
      },
    });
    toolRegistry.tryGet.mockImplementation(() => ({ execute: tool }));

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items[0].publishedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SocialSearchAdapter
// ---------------------------------------------------------------------------

describe("SocialSearchAdapter", () => {
  let adapter: SocialSearchAdapter;
  let chatFacade: ReturnType<typeof makeChatFacade>;
  let toolRegistry: ReturnType<typeof makeToolRegistry>;

  beforeEach(() => {
    chatFacade = makeChatFacade();
    const webSearchTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            title: "Twitter Result",
            url: "https://x.com/user/status/123",
            content: "tweet content",
            publishedDate: "2024-01-10",
          },
        ],
      },
    });
    toolRegistry = makeToolRegistry({ "web-search": webSearchTool });
    adapter = new SocialSearchAdapter(chatFacade as any, toolRegistry as any);
  });

  it("should have correct metadata", () => {
    expect(adapter.sourceId).toBe("social-x");
    expect(adapter.sourceType).toBe(DataSourceType.SOCIAL_X);
  });

  it("should return Grok results when Grok succeeds", async () => {
    const result = await adapter.search(BASE_REQUEST);

    expect(chatFacade.chat).toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe(DataSourceType.SOCIAL_X);
    expect(result.items[0].title).toBe("Tweet 1");
    expect(result.items[0].domain).toBe("x.com");
  });

  it("should fall back to web-search when Grok returns error", async () => {
    chatFacade.chat.mockResolvedValue({ isError: true, content: null });

    const result = await adapter.search(BASE_REQUEST);

    expect(toolRegistry.tryGet).toHaveBeenCalledWith("web-search");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Twitter Result");
  });

  it("should fall back to web-search when Grok throws", async () => {
    chatFacade.chat.mockRejectedValue(new Error("Grok API error"));

    await adapter.search(BASE_REQUEST);

    expect(toolRegistry.tryGet).toHaveBeenCalledWith("web-search");
  });

  it("should fall back to web-search when Grok returns empty array", async () => {
    chatFacade.chat.mockResolvedValue({ isError: false, content: "[]" });

    const _result = await adapter.search(BASE_REQUEST);

    // Empty from Grok → try web-search fallback
    expect(toolRegistry.tryGet).toHaveBeenCalledWith("web-search");
  });

  it("should handle malformed Grok JSON by returning empty and falling back", async () => {
    chatFacade.chat.mockResolvedValue({
      isError: false,
      content: "not valid json {{{",
    });

    const result = await adapter.search(BASE_REQUEST);

    // Falls back to web-search
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Twitter Result");
  });

  it("should parse Grok response wrapped in markdown code fences", async () => {
    chatFacade.chat.mockResolvedValue({
      isError: false,
      content:
        '```json\n[{"title":"T","url":"https://x.com/1","snippet":"s","date":"2024-01-01"}]\n```',
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("T");
  });

  it("should parse Grok response with date field producing valid publishedAt", async () => {
    chatFacade.chat.mockResolvedValue({
      isError: false,
      content: JSON.stringify([
        {
          title: "Dated tweet",
          url: "https://x.com/status/1",
          snippet: "content",
          date: "2024-06-15T12:00:00Z",
        },
      ]),
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items[0].publishedAt).toBeInstanceOf(Date);
    expect(result.items[0].publishedAt!.getFullYear()).toBe(2024);
  });

  it("should handle Grok non-array JSON by returning empty items and falling back", async () => {
    chatFacade.chat.mockResolvedValue({
      isError: false,
      content: '{"not": "an array"}',
    });

    // Falls back
    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(1);
  });

  it("should include social X domain query in fallback web search call", async () => {
    chatFacade.chat.mockResolvedValue({ isError: true, content: null });
    const webTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    });
    toolRegistry.tryGet.mockImplementation(() => ({ execute: webTool }));

    await adapter.search({ ...BASE_REQUEST, query: "AI news" });

    expect(webTool).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("site:x.com"),
      }),
      expect.any(Object),
    );
    expect(webTool).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining("AI news"),
      }),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// PolicySearchAdapter
// ---------------------------------------------------------------------------

describe("PolicySearchAdapter", () => {
  let adapter: PolicySearchAdapter;
  let toolRegistry: ReturnType<typeof makeToolRegistry>;

  function buildPolicyToolRegistry(
    fedResult: unknown,
    congressResult: unknown,
    whResult: unknown,
  ) {
    // Each policy tool is separate — map by toolId
    const fedTool = jest.fn().mockResolvedValue(fedResult);
    const congressTool = jest.fn().mockResolvedValue(congressResult);
    const whTool = jest.fn().mockResolvedValue(whResult);

    const registry = {
      tryGet: jest.fn((id: string) => {
        if (id === "federal-register") return { execute: fedTool };
        if (id === "congress-gov") return { execute: congressTool };
        if (id === "whitehouse-news") return { execute: whTool };
        return undefined;
      }),
    };
    return { registry, fedTool, congressTool, whTool };
  }

  it("should have correct metadata", () => {
    toolRegistry = makeToolRegistry({});
    adapter = new PolicySearchAdapter(toolRegistry as any);

    expect(adapter.sourceId).toBe("policy");
    expect(adapter.sourceType).toBe(DataSourceType.FEDERAL_REGISTER);
    expect(adapter.additionalTypes).toContain(DataSourceType.CONGRESS);
    expect(adapter.additionalTypes).toContain(DataSourceType.WHITEHOUSE);
  });

  it("should aggregate results from all three policy tools", async () => {
    const { registry } = buildPolicyToolRegistry(
      {
        success: true,
        data: {
          success: true,
          documents: [
            {
              title: "Fed Doc",
              htmlUrl: "https://federalregister.gov/d/1",
              abstract: "Federal abstract",
              publicationDate: "2024-01-10",
              documentNumber: "DOC-001",
            },
          ],
        },
      },
      {
        success: true,
        data: {
          success: true,
          bills: [
            {
              shortTitle: "AI Bill",
              url: "https://congress.gov/bill/1",
              introducedDate: "2024-01-05",
              number: "HR1",
              type: "hr",
              congress: 118,
              latestAction: { text: "Passed House", actionDate: "2024-01-06" },
            },
          ],
        },
      },
      {
        success: true,
        data: {
          success: true,
          items: [
            {
              title: "WH Statement",
              url: "https://whitehouse.gov/briefing/1",
              summary: "White house summary",
              date: "2024-01-08",
              type: "press-briefing",
            },
          ],
        },
      },
    );

    adapter = new PolicySearchAdapter(registry as any);
    const result = await adapter.search(BASE_REQUEST);

    expect(result.items.length).toBeGreaterThanOrEqual(3);

    const fedItem = result.items.find(
      (i) => i.sourceType === DataSourceType.FEDERAL_REGISTER,
    );
    expect(fedItem?.title).toBe("Fed Doc");
    expect(fedItem?.domain).toBe("federalregister.gov");

    const congressItem = result.items.find(
      (i) => i.sourceType === DataSourceType.CONGRESS,
    );
    expect(congressItem?.title).toBe("AI Bill");
    expect(congressItem?.domain).toBe("congress.gov");

    const whItem = result.items.find(
      (i) => i.sourceType === DataSourceType.WHITEHOUSE,
    );
    expect(whItem?.title).toBe("WH Statement");
    expect(whItem?.domain).toBe("whitehouse.gov");
  });

  it("should skip federal register items when success=false", async () => {
    const { registry } = buildPolicyToolRegistry(
      { success: true, data: { success: false, documents: [] } },
      { success: true, data: { success: true, bills: [] } },
      { success: true, data: { success: true, items: [] } },
    );

    adapter = new PolicySearchAdapter(registry as any);
    const result = await adapter.search(BASE_REQUEST);

    expect(
      result.items.filter(
        (i) => i.sourceType === DataSourceType.FEDERAL_REGISTER,
      ),
    ).toHaveLength(0);
  });

  it("should handle rejected tool promise gracefully", async () => {
    const registry = {
      tryGet: jest.fn((id: string) => {
        if (id === "federal-register")
          return {
            execute: jest
              .fn()
              .mockRejectedValue(new Error("Fed Register down")),
          };
        return {
          execute: jest.fn().mockResolvedValue({
            success: true,
            data: { success: true, bills: [], items: [] },
          }),
        };
      }),
    };

    adapter = new PolicySearchAdapter(registry as any);
    const result = await adapter.search(BASE_REQUEST);

    // Should not throw, just skip failed source
    expect(result).toBeDefined();
  });

  it("should return null and log warning when tool is not registered", async () => {
    const registry = { tryGet: jest.fn().mockReturnValue(undefined) };
    adapter = new PolicySearchAdapter(registry as any);

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("should use shortTitle falling back to title for congress bill", async () => {
    const { registry } = buildPolicyToolRegistry(
      { success: true, data: { success: true, documents: [] } },
      {
        success: true,
        data: {
          success: true,
          bills: [
            {
              // no shortTitle
              title: "Long Bill Title",
              url: "https://congress.gov/bill/2",
            },
          ],
        },
      },
      { success: true, data: { success: true, items: [] } },
    );

    adapter = new PolicySearchAdapter(registry as any);
    const result = await adapter.search(BASE_REQUEST);

    const congressItem = result.items.find(
      (i) => i.sourceType === DataSourceType.CONGRESS,
    );
    expect(congressItem?.title).toBe("Long Bill Title");
  });
});

// ---------------------------------------------------------------------------
// LocalSearchAdapter
// ---------------------------------------------------------------------------

describe("LocalSearchAdapter", () => {
  let adapter: LocalSearchAdapter;
  let ragFacade: ReturnType<typeof makeRagFacade>;

  beforeEach(() => {
    ragFacade = makeRagFacade({
      success: true,
      results: [
        {
          title: "Local Doc",
          url: "https://internal.com/doc/1",
          content: "local content",
          score: 0.95,
          domain: "internal.com",
          publishedDate: "2024-01-01",
        },
      ],
    });
    adapter = new LocalSearchAdapter(ragFacade as any);
  });

  it("should have correct metadata", () => {
    expect(adapter.sourceId).toBe("local-search");
    expect(adapter.sourceType).toBe(DataSourceType.LOCAL);
  });

  it("should return mapped results from RAG facade", async () => {
    const result = await adapter.search(BASE_REQUEST);

    expect(ragFacade.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "test query",
        maxResults: 5,
        sources: ["local"],
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe(DataSourceType.LOCAL);
    expect(result.items[0].title).toBe("Local Doc");
    expect(result.items[0].snippet).toBe("local content");
    expect(result.items[0].metadata?.["score"]).toBe(0.95);
    expect(result.items[0].publishedAt).toBeInstanceOf(Date);
  });

  it("should return empty when RAG returns success=false", async () => {
    ragFacade.search.mockResolvedValue({ success: false, results: [] });

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("should return empty when RAG returns empty results", async () => {
    ragFacade.search.mockResolvedValue({ success: true, results: [] });

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("should log debug message when RAG returns error field", async () => {
    ragFacade.search.mockResolvedValue({
      success: false,
      results: [],
      error: "Index not available",
    });

    const logSpy = jest
      .spyOn((adapter as any).logger, "debug")
      .mockImplementation(() => {});

    await adapter.search(BASE_REQUEST);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Index not available"),
    );
  });

  it("should pass knowledgeBaseIds from metadata when provided", async () => {
    await adapter.search({
      ...BASE_REQUEST,
      metadata: { knowledgeBaseIds: ["kb-1", "kb-2"] },
    });

    expect(ragFacade.search).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { knowledgeBaseIds: ["kb-1", "kb-2"] },
      }),
    );
  });

  it("should handle missing publishedDate gracefully", async () => {
    ragFacade.search.mockResolvedValue({
      success: true,
      results: [{ title: "No Date", url: "", content: "" }],
    });

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items[0].publishedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AcademicSearchAdapter - formatQuery
// ---------------------------------------------------------------------------

describe("AcademicSearchAdapter - formatQuery", () => {
  let adapter: AcademicSearchAdapter;
  let throttle: { execute: jest.Mock };

  beforeEach(() => {
    throttle = { execute: jest.fn().mockResolvedValue([]) };
    const toolRegistry = makeToolRegistry({});
    adapter = new AcademicSearchAdapter(toolRegistry as any, throttle as any);
  });

  it("should have correct metadata", () => {
    expect(adapter.sourceId).toBe("academic");
    expect(adapter.sourceType).toBe(DataSourceType.ACADEMIC);
    expect(adapter.additionalTypes).toContain(DataSourceType.OPENALEX);
    expect(adapter.additionalTypes).toContain(DataSourceType.SEMANTIC_SCHOLAR);
    expect(adapter.additionalTypes).toContain(DataSourceType.PUBMED);
  });

  it("formatQuery should strip noise words (latest, recent, year)", () => {
    const result = adapter.formatQuery("latest AI trends recent 2024");
    expect(result).not.toContain("latest");
    expect(result).not.toContain("recent");
    expect(result).not.toContain("2024");
    expect(result.trim().length).toBeGreaterThan(0);
  });

  it("formatQuery should collapse multiple spaces after noise word removal", () => {
    const result = adapter.formatQuery("AI latest research");
    expect(result).not.toMatch(/\s{2,}/);
  });

  it("should return empty results when throttle returns empty for all phases", async () => {
    throttle.execute.mockResolvedValue([]);
    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("formatQuery should pass through query without noise words unchanged", () => {
    const result = adapter.formatQuery("machine learning neural networks");
    expect(result).toBe("machine learning neural networks");
  });

  it("formatQuery should accept optional context parameter without error", () => {
    expect(() => adapter.formatQuery("AI trends", {} as any)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AcademicSearchAdapter - phased search strategy
// ---------------------------------------------------------------------------

describe("AcademicSearchAdapter - phased search strategy", () => {
  const makeOpenAlexItem = (i: number): DataSourceResult => ({
    sourceType: DataSourceType.OPENALEX,
    title: `OpenAlex Paper ${i}`,
    url: `https://openalex.org/W${i}`,
    snippet: `Abstract ${i}`,
  });

  const makePubMedItem = (i: number): DataSourceResult => ({
    sourceType: DataSourceType.PUBMED,
    title: `PubMed Article ${i}`,
    url: `https://pubmed.ncbi.nlm.nih.gov/${i}`,
    snippet: `Abstract ${i}`,
  });

  const _makeSemanticScholarItem = (i: number): DataSourceResult => ({
    sourceType: DataSourceType.SEMANTIC_SCHOLAR,
    title: `SS Paper ${i}`,
    url: `https://semanticscholar.org/paper/${i}`,
    snippet: `Abstract ${i}`,
  });

  const _makeArXivItem = (i: number): DataSourceResult => ({
    sourceType: DataSourceType.ACADEMIC,
    title: `ArXiv Paper ${i}`,
    url: `https://arxiv.org/abs/${i}`,
    snippet: `Abstract ${i}`,
  });

  function buildAcademicAdapter(toolMocks: Record<string, jest.Mock>) {
    const toolRegistry = makeToolRegistry(toolMocks);
    // throttle wraps the sub-source calls; execute immediately calls the fn
    const throttle = {
      execute: jest.fn(
        (
          _id: string,
          fn: () => Promise<DataSourceResult[]>,
          _signal?: AbortSignal,
        ) => fn(),
      ),
    };
    return new AcademicSearchAdapter(toolRegistry as any, throttle as any);
  }

  it("should return phase 1 results without entering phase 2 when sufficient results", async () => {
    // 5 from OpenAlex + 5 from PubMed = 10 >= SUFFICIENT_RESULTS(10)
    const openAlexResults = Array.from({ length: 5 }, (_, i) =>
      makeOpenAlexItem(i),
    );
    const pubMedResults = Array.from({ length: 5 }, (_, i) =>
      makePubMedItem(i),
    );

    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: openAlexResults.map((r, i) => ({
          title: r.title,
          openAccessUrl: r.url,
          abstract: r.snippet,
          doi: `10.000/${i}`,
          publicationDate: "2024-01-01",
          citationCount: 5,
          authors: ["Author A"],
        })),
      },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        articles: pubMedResults.map((r) => ({
          title: r.title,
          url: r.url,
          abstract: r.snippet,
          publishedDate: "2024-01-01",
          authors: ["Author B"],
          journal: "Journal X",
        })),
      },
    });
    const ssTool = jest.fn().mockResolvedValue({
      success: true,
      data: { data: [] },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items.length).toBe(10);
    // Semantic Scholar should NOT have been called
    expect(ssTool).not.toHaveBeenCalled();
  });

  it("should enter phase 2 (Semantic Scholar) when phase 1 results < 10", async () => {
    // Only 2 results from phase 1
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            title: "OA Paper 1",
            openAccessUrl: "https://openalex.org/W1",
            abstract: "abs",
          },
        ],
      },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        articles: [
          {
            title: "PM Article 1",
            url: "https://pubmed.ncbi.nlm.nih.gov/1",
            abstract: "abs",
          },
        ],
      },
    });
    const ssTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        data: [
          {
            title: "SS Paper 1",
            url: "https://semanticscholar.org/1",
            abstract: "abs",
            year: 2023,
            citationCount: 10,
          },
        ],
      },
    });
    const arxivTool = jest.fn().mockResolvedValue({
      success: true,
      data: { papers: [] },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
      "arxiv-search": arxivTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(ssTool).toHaveBeenCalled();
    // Should have 3 results total (1 OA + 1 PM + 1 SS)
    expect(result.items.length).toBe(3);
  });

  it("should enter phase 2b (ArXiv) when still < 10 results after Semantic Scholar", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            title: "OA Paper",
            openAccessUrl: "https://openalex.org/1",
            abstract: "abs",
          },
        ],
      },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: [] },
    });
    const ssTool = jest.fn().mockResolvedValue({
      success: true,
      data: { data: [] },
    });
    const arxivTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        papers: [
          {
            title: "ArXiv Paper",
            url: "https://arxiv.org/abs/2401.0001",
            abstract: "abs",
            published: "2024-01-01",
            authors: ["Author C"],
            categories: ["cs.AI"],
          },
        ],
      },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
      "arxiv-search": arxivTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(arxivTool).toHaveBeenCalled();
    expect(result.items.length).toBe(2);
    const arxivItem = result.items.find((i) => i.url.includes("arxiv.org"));
    expect(arxivItem).toBeDefined();
    expect(arxivItem?.metadata?.["categories"]).toContain("cs.AI");
  });

  it("should handle OpenAlex failure gracefully and still return PubMed results", async () => {
    const openAlexTool = jest
      .fn()
      .mockRejectedValue(new Error("OpenAlex API error"));
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        articles: [
          {
            title: "PM Article",
            url: "https://pubmed.ncbi.nlm.nih.gov/1",
            abstract: "abs",
          },
        ],
      },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe(DataSourceType.PUBMED);
  });

  it("should handle PubMed failure gracefully and still return OpenAlex results", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            title: "OA Paper",
            openAccessUrl: "https://openalex.org/1",
            abstract: "abs",
          },
        ],
      },
    });
    const pubMedTool = jest.fn().mockRejectedValue(new Error("PubMed down"));

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].sourceType).toBe(DataSourceType.OPENALEX);
  });

  it("should handle Semantic Scholar failure gracefully", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: [] },
    });
    const ssTool = jest
      .fn()
      .mockRejectedValue(new Error("Semantic Scholar error"));
    const arxivTool = jest.fn().mockResolvedValue({
      success: true,
      data: { papers: [] },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
      "arxiv-search": arxivTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    // Should not throw — gracefully skips SS
    expect(result).toBeDefined();
  });

  it("should handle ArXiv failure gracefully", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: [] },
    });
    const ssTool = jest.fn().mockResolvedValue({
      success: true,
      data: { data: [] },
    });
    const arxivTool = jest
      .fn()
      .mockRejectedValue(new Error("ArXiv deadline exceeded"));

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
      "arxiv-search": arxivTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(result).toBeDefined();
    expect(result.items).toHaveLength(0);
  });

  it("should deduplicate results with same URL across phases", async () => {
    const sharedUrl = "https://openalex.org/W999";
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            title: "Shared Paper",
            openAccessUrl: sharedUrl,
            abstract: "abs",
          },
        ],
      },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        articles: [
          // Same URL, different source type
          {
            title: "Shared Paper Duplicate",
            url: sharedUrl,
            abstract: "abs",
          },
        ],
      },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    // URL dedup: only 1 unique URL
    const urlMatches = result.items.filter((i) => i.url === sharedUrl);
    expect(urlMatches).toHaveLength(1);
  });

  it("should deduplicate results with same title across phases", async () => {
    const sharedTitle = "Identical Paper Title";
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            title: sharedTitle,
            openAccessUrl: "https://openalex.org/W1",
            abstract: "abs",
          },
        ],
      },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        articles: [
          {
            title: sharedTitle,
            url: "https://pubmed.ncbi.nlm.nih.gov/2",
            abstract: "abs",
          },
        ],
      },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    const titleMatches = result.items.filter((i) => i.title === sharedTitle);
    expect(titleMatches).toHaveLength(1);
  });

  it("should map OpenAlex results correctly including doi fallback URL", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            title: "DOI-only Paper",
            // no openAccessUrl
            doi: "10.1000/test.2024",
            abstract: "Abstract text",
            publicationDate: "2024-03-01",
            citationCount: 42,
            authors: ["Smith, J.", "Doe, J."],
          },
        ],
      },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: [] },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].url).toBe("https://doi.org/10.1000/test.2024");
    expect(result.items[0].metadata?.["citationCount"]).toBe(42);
    expect(result.items[0].publishedAt).toBeInstanceOf(Date);
  });

  it("should map Semantic Scholar results correctly", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: [] },
    });
    const ssTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        data: [
          {
            title: "SS Research Paper",
            url: "https://semanticscholar.org/paper/abc123",
            abstract: "SS abstract",
            year: 2023,
            citationCount: 15,
          },
        ],
      },
    });
    const arxivTool = jest.fn().mockResolvedValue({
      success: true,
      data: { papers: [] },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
      "arxiv-search": arxivTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    const ssItem = result.items.find(
      (i) => i.sourceType === DataSourceType.SEMANTIC_SCHOLAR,
    );
    expect(ssItem).toBeDefined();
    expect(ssItem?.title).toBe("SS Research Paper");
    expect(ssItem?.publishedAt?.getUTCFullYear()).toBe(2023);
    expect(ssItem?.metadata?.["citationCount"]).toBe(15);
  });

  it("should handle OpenAlex returning non-array results gracefully", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: null },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: null },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
    });

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("should handle Semantic Scholar returning non-array data gracefully", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: [] },
    });
    const ssTool = jest.fn().mockResolvedValue({
      success: true,
      data: { data: "not-an-array" },
    });
    const arxivTool = jest.fn().mockResolvedValue({
      success: true,
      data: { papers: [] },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
      "arxiv-search": arxivTool,
    });

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("should handle ArXiv returning non-array papers gracefully", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: [] },
    });
    const ssTool = jest.fn().mockResolvedValue({
      success: true,
      data: { data: [] },
    });
    const arxivTool = jest.fn().mockResolvedValue({
      success: true,
      data: { papers: null },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
      "arxiv-search": arxivTool,
    });

    const result = await adapter.search(BASE_REQUEST);
    expect(result.items).toHaveLength(0);
  });

  it("should stop at phase 2 (skip ArXiv) when sufficient results after SS", async () => {
    // Build 10 unique items from OpenAlex+PubMed+SS combined
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        results: Array.from({ length: 3 }, (_, i) => ({
          title: `OA ${i}`,
          openAccessUrl: `https://openalex.org/W${i}`,
          abstract: `abs${i}`,
        })),
      },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        articles: Array.from({ length: 3 }, (_, i) => ({
          title: `PM ${i}`,
          url: `https://pubmed.ncbi.nlm.nih.gov/${i + 100}`,
          abstract: `abs${i}`,
        })),
      },
    });
    const ssTool = jest.fn().mockResolvedValue({
      success: true,
      data: {
        data: Array.from({ length: 4 }, (_, i) => ({
          title: `SS ${i}`,
          url: `https://semanticscholar.org/paper/${i + 200}`,
          abstract: `abs${i}`,
          year: 2023,
          citationCount: i,
        })),
      },
    });
    const arxivTool = jest.fn().mockResolvedValue({
      success: true,
      data: { papers: [{ title: "ArXiv", url: "https://arxiv.org/abs/1" }] },
    });

    const adapter = buildAcademicAdapter({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
      "semantic-scholar": ssTool,
      "arxiv-search": arxivTool,
    });

    const result = await adapter.search(BASE_REQUEST);

    // After phase1(6) + SS(4) = 10 which >= SUFFICIENT_RESULTS, ArXiv should be skipped
    expect(arxivTool).not.toHaveBeenCalled();
    expect(result.items.length).toBe(10);
  });

  it("should abort when signal is already set before search", async () => {
    const openAlexTool = jest.fn().mockResolvedValue({
      success: true,
      data: { results: [] },
    });
    const pubMedTool = jest.fn().mockResolvedValue({
      success: true,
      data: { articles: [] },
    });

    const throttle = {
      execute: jest.fn(
        (
          _id: string,
          fn: () => Promise<DataSourceResult[]>,
          signal?: AbortSignal,
        ) => {
          if (signal?.aborted) return Promise.resolve([]);
          return fn();
        },
      ),
    };

    const toolRegistry = makeToolRegistry({
      "openalex-search": openAlexTool,
      pubmed: pubMedTool,
    });
    const adapter = new AcademicSearchAdapter(
      toolRegistry as any,
      throttle as any,
    );

    const ac = new AbortController();
    ac.abort();

    const result = await adapter.search({ ...BASE_REQUEST, signal: ac.signal });
    expect(result.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SearchExecutorService
// ---------------------------------------------------------------------------

describe("SearchExecutorService", () => {
  let service: SearchExecutorService;
  let throttle: {
    execute: jest.Mock;
    registerSource: jest.Mock;
  };

  function buildMockAdapter(
    sourceId: string,
    sourceType: DataSourceType,
    additionalTypes?: DataSourceType[],
    searchResult: DataSourceResult[] = [],
  ) {
    return {
      sourceId,
      sourceType,
      additionalTypes,
      concurrency: 2,
      defaultTimeoutMs: 5000,
      search: jest.fn().mockResolvedValue({
        items: searchResult,
        sourceMetrics: {
          sourceId,
          durationMs: 100,
          queryUsed: "test",
          totalAvailable: searchResult.length,
        },
      }),
      formatQuery: jest.fn((q: string) => q),
      isAvailable: jest.fn().mockResolvedValue(true),
    };
  }

  beforeEach(async () => {
    throttle = {
      execute: jest
        .fn()
        .mockImplementation((_id: string, fn: () => Promise<unknown>) => fn()),
      registerSource: jest.fn(),
    };

    const webAdapter = buildMockAdapter(
      "web-search",
      DataSourceType.WEB,
      undefined,
      [
        {
          sourceType: DataSourceType.WEB,
          title: "Web 1",
          url: "https://a.com",
          snippet: "s",
        },
      ],
    );
    const academicAdapter = buildMockAdapter(
      "academic",
      DataSourceType.ACADEMIC,
      [
        DataSourceType.OPENALEX,
        DataSourceType.SEMANTIC_SCHOLAR,
        DataSourceType.PUBMED,
      ],
    );
    const githubAdapter = buildMockAdapter(
      "github-search",
      DataSourceType.GITHUB,
    );
    const hackernewsAdapter = buildMockAdapter(
      "hackernews-search",
      DataSourceType.HACKERNEWS,
    );
    const socialAdapter = buildMockAdapter("social-x", DataSourceType.SOCIAL_X);
    const policyAdapter = buildMockAdapter(
      "policy",
      DataSourceType.FEDERAL_REGISTER,
      [DataSourceType.CONGRESS, DataSourceType.WHITEHOUSE],
    );
    const financeAdapter = buildMockAdapter(
      "finance-api",
      DataSourceType.FINANCE_API,
    );
    const weatherAdapter = buildMockAdapter(
      "weather-api",
      DataSourceType.WEATHER_API,
    );
    const localAdapter = buildMockAdapter("local-search", DataSourceType.LOCAL);
    const industryReportAdapter = buildMockAdapter(
      "industry-report",
      DataSourceType.INDUSTRY_REPORT,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchExecutorService,
        { provide: GlobalSourceThrottleService, useValue: throttle },
        { provide: WebSearchAdapter, useValue: webAdapter },
        { provide: AcademicSearchAdapter, useValue: academicAdapter },
        { provide: GithubSearchAdapter, useValue: githubAdapter },
        { provide: HackernewsSearchAdapter, useValue: hackernewsAdapter },
        { provide: SocialSearchAdapter, useValue: socialAdapter },
        { provide: PolicySearchAdapter, useValue: policyAdapter },
        {
          provide: "FinanceSearchAdapter",
          useValue: financeAdapter,
        },
        {
          provide: "WeatherSearchAdapter",
          useValue: weatherAdapter,
        },
        { provide: LocalSearchAdapter, useValue: localAdapter },
        {
          provide: IndustryReportSearchAdapter,
          useValue: industryReportAdapter,
        },
      ],
    })
      .overrideProvider(SearchExecutorService)
      .useFactory({
        factory: () =>
          new SearchExecutorService(
            throttle as any,
            webAdapter as any,
            academicAdapter as any,
            githubAdapter as any,
            hackernewsAdapter as any,
            socialAdapter as any,
            policyAdapter as any,
            financeAdapter as any,
            weatherAdapter as any,
            localAdapter as any,
            industryReportAdapter as any,
          ),
      })
      .compile();

    service = module.get<SearchExecutorService>(SearchExecutorService);
  });

  describe("searchAllSources", () => {
    it("should return results for a source that has results", async () => {
      const results = await service.searchAllSources(
        [DataSourceType.WEB],
        {
          baseQueries: ["test query"],
          sourceSpecific: new Map(),
          language: "en",
        },
        { maxResults: 5 },
      );

      expect(results.has(DataSourceType.WEB)).toBe(true);
      expect(results.get(DataSourceType.WEB)?.items).toHaveLength(1);
    });

    it("should skip unknown source types and log warning", async () => {
      const results = await service.searchAllSources(
        ["unknown-source-type" as DataSourceType],
        {
          baseQueries: ["test"],
          sourceSpecific: new Map(),
          language: "en",
        },
        { maxResults: 5 },
      );

      expect(results.size).toBe(0);
    });

    it("should use source-specific queries when available", async () => {
      const sourceSpecificMap = new Map<DataSourceType, string[]>();
      sourceSpecificMap.set(DataSourceType.WEB, ["specific query"]);

      await service.searchAllSources(
        [DataSourceType.WEB],
        {
          baseQueries: ["base query"],
          sourceSpecific: sourceSpecificMap,
          language: "en",
        },
        { maxResults: 5 },
      );

      // formatQuery should have been called with the specific query
      const webAdapter = service.getAdapter(DataSourceType.WEB) as any;
      expect(webAdapter.formatQuery).toHaveBeenCalledWith("specific query");
    });

    it("should stop early when accumulated items reach maxResults", async () => {
      const sourceSpecificMap = new Map<DataSourceType, string[]>();
      sourceSpecificMap.set(DataSourceType.WEB, ["q1", "q2", "q3"]);

      const webAdapter = service.getAdapter(DataSourceType.WEB) as any;
      webAdapter.search.mockResolvedValue({
        items: [
          {
            sourceType: DataSourceType.WEB,
            title: "r1",
            url: "a",
            snippet: "",
          },
          {
            sourceType: DataSourceType.WEB,
            title: "r2",
            url: "b",
            snippet: "",
          },
          {
            sourceType: DataSourceType.WEB,
            title: "r3",
            url: "c",
            snippet: "",
          },
        ],
        sourceMetrics: {
          sourceId: "web-search",
          durationMs: 50,
          queryUsed: "q1",
        },
      });

      const results = await service.searchAllSources(
        [DataSourceType.WEB],
        {
          baseQueries: [],
          sourceSpecific: sourceSpecificMap,
          language: "en",
        },
        { maxResults: 3 },
      );

      // Only 1 query should have run because 3 items >= maxResults=3
      expect(webAdapter.search).toHaveBeenCalledTimes(1);
      expect(results.get(DataSourceType.WEB)?.items).toHaveLength(3);
    });

    it("should abort query loop when signal is aborted", async () => {
      const ac = new AbortController();
      ac.abort();

      const results = await service.searchAllSources(
        [DataSourceType.WEB],
        {
          baseQueries: ["q1", "q2"],
          sourceSpecific: new Map(),
          language: "en",
        },
        { maxResults: 10, signal: ac.signal },
      );

      // Signal aborted before any query — items should be empty and result null
      expect(results.size).toBe(0);
    });

    it("should continue with remaining queries when one query fails", async () => {
      const webAdapter = service.getAdapter(DataSourceType.WEB) as any;
      webAdapter.search
        .mockRejectedValueOnce(new Error("First query failed"))
        .mockResolvedValueOnce({
          items: [
            {
              sourceType: DataSourceType.WEB,
              title: "ok",
              url: "a",
              snippet: "",
            },
          ],
          sourceMetrics: {
            sourceId: "web-search",
            durationMs: 50,
            queryUsed: "q2",
          },
        });

      const results = await service.searchAllSources(
        [DataSourceType.WEB],
        {
          baseQueries: ["q1", "q2"],
          sourceSpecific: new Map(),
          language: "en",
        },
        { maxResults: 10 },
      );

      expect(results.get(DataSourceType.WEB)?.items).toHaveLength(1);
    });

    it("should handle multiple sources in parallel", async () => {
      const results = await service.searchAllSources(
        [DataSourceType.WEB, DataSourceType.GITHUB],
        {
          baseQueries: ["test"],
          sourceSpecific: new Map(),
          language: "en",
        },
        { maxResults: 5 },
      );

      expect(results.size).toBe(2);
    });

    it("should map additional source types to the same adapter", async () => {
      // OPENALEX should map to the academic adapter
      const academicAdapter = service.getAdapter(DataSourceType.OPENALEX);
      expect(academicAdapter).toBeDefined();
      expect(academicAdapter?.sourceId).toBe("academic");
    });
  });

  describe("getAdapter", () => {
    it("should return adapter for registered source type", () => {
      const adapter = service.getAdapter(DataSourceType.WEB);
      expect(adapter).toBeDefined();
      expect(adapter?.sourceId).toBe("web-search");
    });

    it("should return undefined for unregistered source type", () => {
      const adapter = service.getAdapter("unknown" as DataSourceType);
      expect(adapter).toBeUndefined();
    });

    it("should return the policy adapter for CONGRESS source type (additionalType)", () => {
      const adapter = service.getAdapter(DataSourceType.CONGRESS);
      expect(adapter?.sourceId).toBe("policy");
    });

    it("should return the policy adapter for WHITEHOUSE source type", () => {
      const adapter = service.getAdapter(DataSourceType.WHITEHOUSE);
      expect(adapter?.sourceId).toBe("policy");
    });
  });

  describe("getAvailableSources", () => {
    it("should return sources for which isAvailable returns true", async () => {
      const available = await service.getAvailableSources();

      expect(Array.isArray(available)).toBe(true);
      expect(available.length).toBeGreaterThan(0);
      expect(available).toContain(DataSourceType.WEB);
    });

    it("should exclude sources for which isAvailable returns false", async () => {
      const webAdapter = service.getAdapter(DataSourceType.WEB) as any;
      webAdapter.isAvailable.mockResolvedValue(false);

      const available = await service.getAvailableSources();

      expect(available).not.toContain(DataSourceType.WEB);
    });

    it("should exclude sources for which isAvailable throws", async () => {
      const webAdapter = service.getAdapter(DataSourceType.WEB) as any;
      webAdapter.isAvailable.mockRejectedValue(new Error("check failed"));

      const available = await service.getAvailableSources();

      expect(available).not.toContain(DataSourceType.WEB);
    });
  });
});

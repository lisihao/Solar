/**
 * GithubSearchTool Unit Tests
 *
 * Tests the github-search tool in isolation by mocking PolicyDataService.
 * Uses tool.execute(input, context) to exercise the full BaseTool lifecycle.
 *
 * Note: GithubSearchTool throws on error (unlike arxiv which returns success:false),
 * so BaseTool catches the throw and returns outer success:false.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { GithubSearchTool, GithubSearchOutput } from "../github-search.tool";
import { PolicyDataService } from "../../policy/policy-data.service";
import {
  ToolContext,
  ToolResult,
} from "../../../../abstractions/tool.interface";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "exec-github-001",
    toolId: "github-search",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeGithubApiResponse(count = 1) {
  return {
    total_count: 1000,
    incomplete_results: false,
    items: Array.from({ length: count }, (_, i) => ({
      id: 100000 + i,
      name: `awesome-repo-${i}`,
      full_name: `owner/awesome-repo-${i}`,
      description: `A great repository about ML, index ${i}`,
      html_url: `https://github.com/owner/awesome-repo-${i}`,
      stargazers_count: 5000 + i * 100,
      forks_count: 200 + i * 10,
      language: "Python",
      topics: ["machine-learning", "deep-learning"],
      updated_at: "2024-01-01T00:00:00Z",
      owner: {
        login: "owner",
        avatar_url: "https://github.com/avatars/owner.png",
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Mock PolicyDataService
// ---------------------------------------------------------------------------

type PolicyDataServiceMock = Pick<
  PolicyDataService,
  "httpGet" | "getApiKey" | "clearKeyFailure" | "markKeyFailed"
>;

function createMockPolicyDataService(): jest.Mocked<PolicyDataServiceMock> {
  return {
    httpGet: jest.fn(),
    getApiKey: jest.fn().mockResolvedValue(null),
    clearKeyFailure: jest.fn(),
    markKeyFailed: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("GithubSearchTool", () => {
  let tool: GithubSearchTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GithubSearchTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
      ],
    }).compile();

    tool = module.get<GithubSearchTool>(GithubSearchTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have id = 'github-search'", () => {
      expect(tool.id).toBe("github-search");
    });

    it("should belong to the 'information' category", () => {
      expect(tool.category).toBe("information");
    });

    it("should include github-related tags", () => {
      expect(tool.tags).toContain("github");
      expect(tool.tags).toContain("opensource");
    });
  });

  // -------------------------------------------------------------------------
  // validateInput
  // -------------------------------------------------------------------------

  describe("validateInput()", () => {
    it("should return true for a valid non-empty query", () => {
      expect(tool.validateInput({ query: "machine learning" })).toBe(true);
    });

    it("should return false for an empty query", () => {
      expect(tool.validateInput({ query: "" })).toBe(false);
    });

    it("should return false for a whitespace-only query", () => {
      expect(tool.validateInput({ query: "   " })).toBe(false);
    });

    it("should return true with optional fields provided", () => {
      expect(
        tool.validateInput({
          query: "tensorflow",
          language: "Python",
          sort: "stars",
          maxResults: 20,
        }),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe("execute() - success path", () => {
    it("should return success:true with repositories array", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeGithubApiResponse(3));

      const result: ToolResult<GithubSearchOutput> = await tool.execute(
        { query: "machine learning" },
        makeContext(),
      );

      expect(result.success).toBe(true);
      expect(result.data?.repositories).toHaveLength(3);
      expect(result.data?.totalCount).toBe(1000);
    });

    it("should map API fields to correct output schema", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeGithubApiResponse(1));

      const result = await tool.execute({ query: "pytorch" }, makeContext());

      const repo = result.data?.repositories[0];
      expect(repo).toBeDefined();
      expect(repo?.name).toBe("awesome-repo-0");
      expect(repo?.fullName).toBe("owner/awesome-repo-0");
      expect(repo?.stars).toBe(5000);
      expect(repo?.forks).toBe(200);
      expect(repo?.language).toBe("Python");
      expect(repo?.topics).toContain("machine-learning");
      expect(repo?.owner.login).toBe("owner");
      expect(repo?.owner.avatarUrl).toBeDefined();
    });

    it("should use 'Unknown' for null language field", async () => {
      const response = makeGithubApiResponse(1);
      response.items[0].language = null as unknown as string;
      mockPolicyDataService.httpGet.mockResolvedValue(response);

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.data?.repositories[0].language).toBe("Unknown");
    });

    it("should append language filter to query when language is provided", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeGithubApiResponse(0));

      // 2026-05-13: timeRange="all" 保留无 pushed:>= 日期约束的 q 契约。
      await tool.execute(
        { query: "web framework", language: "TypeScript", timeRange: "all" },
        makeContext(),
      );

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        "https://api.github.com/search/repositories",
        expect.objectContaining({
          q: "web framework language:TypeScript",
        }),
        expect.any(Object),
      );
    });

    it("should include Authorization header when token is available", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("ghp_test_token_123");
      mockPolicyDataService.httpGet.mockResolvedValue(makeGithubApiResponse(1));

      await tool.execute({ query: "test" }, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          Authorization: "Bearer ghp_test_token_123",
        }),
      );
    });

    it("should not include Authorization header when no token", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue(null);
      mockPolicyDataService.httpGet.mockResolvedValue(makeGithubApiResponse(1));

      await tool.execute({ query: "test" }, makeContext());

      const callArgs = mockPolicyDataService.httpGet.mock.calls[0];
      const headers = callArgs[2] as Record<string, string>;
      expect(headers?.Authorization).toBeUndefined();
    });

    it("should respect sort parameter", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeGithubApiResponse(0));

      await tool.execute({ query: "react", sort: "updated" }, makeContext());

      expect(mockPolicyDataService.httpGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sort: "updated" }),
        expect.any(Object),
      );
    });

    it("should include query in output", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue(makeGithubApiResponse(1));

      const result = await tool.execute({ query: "rust async" }, makeContext());

      expect(result.data?.query).toContain("rust async");
    });
  });

  // -------------------------------------------------------------------------
  // Error path
  // -------------------------------------------------------------------------

  describe("execute() - error path", () => {
    it("should return outer success:false when httpGet throws", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network timeout"),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      // GithubSearchTool re-throws on error, BaseTool catches it
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("GitHub 搜索失败");
    });

    it("should throw rate limit error with a specific message", async () => {
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("403 Forbidden"),
      );

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("限速");
    });

    it("should throw when API response has no items", async () => {
      mockPolicyDataService.httpGet.mockResolvedValue({
        total_count: 0,
        items: null,
      });

      const result = await tool.execute({ query: "test" }, makeContext());

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("execute() - cancellation", () => {
    it("should return success:false immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        { query: "any" },
        makeContext({ signal: controller.signal }),
      );

      expect(result.success).toBe(false);
      expect(mockPolicyDataService.httpGet).not.toHaveBeenCalled();
    });
  });
});

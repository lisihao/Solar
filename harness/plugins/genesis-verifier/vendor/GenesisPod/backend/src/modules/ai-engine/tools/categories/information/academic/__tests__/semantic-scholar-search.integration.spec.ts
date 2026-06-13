/**
 * SemanticScholarSearchTool - Extended coverage tests
 *
 * Covers paths not hit by the base spec:
 *  - Lines 265-272: 429 retry with backoff (attempt < maxRetries)
 *  - Lines 276-277: 429 exhausted all retries (60s cooldown)
 *  - Lines 369-370: concurrent request queuing in acquireSlot
 *  - Lines 379-382: global 429 cooldown wait in acquireSlot
 *  - Lines 394-396: rate limit interval wait in acquireSlot
 *  - markKeyFailed with API key on error
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SemanticScholarSearchTool } from "../semantic-scholar-search.tool";
import { PolicyDataService } from "../../policy/policy-data.service";
import { ToolKeyResolverService } from "@/modules/platform/credentials/resolution/tool-key-resolver/tool-key-resolver.service";
import { RequestContext } from "@/common/context/request-context";
import { ToolContext } from "../../../../abstractions/tool.interface";

jest.useFakeTimers();

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "ext-ss-001",
    toolId: "semantic-scholar",
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMockApiResponse() {
  return {
    total: 5,
    data: [
      {
        paperId: "paper-1",
        title: "Test Paper",
        authors: [{ name: "Author One" }],
        abstract: "Test abstract",
        year: 2024,
        citationCount: 10,
        url: "https://www.semanticscholar.org/paper/paper-1",
        externalIds: { ArXiv: "2401.00001", DOI: "10.1234/test" },
      },
    ],
  };
}

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

const mockToolKeyResolverService = {
  resolveToolKey: jest.fn().mockResolvedValue(null),
};

function resetStaticState() {
  (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
    "cooldownUntil"
  ] = 0;
  (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
    "activeRequests"
  ] = 0;
  (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
    "lastRequestTime"
  ] = 0;
  const queue = (
    SemanticScholarSearchTool as unknown as Record<string, unknown>
  )["requestQueue"] as unknown[];
  queue.length = 0;
}

describe("SemanticScholarSearchTool (extended coverage)", () => {
  let tool: SemanticScholarSearchTool;
  let mockPolicyDataService: jest.Mocked<PolicyDataServiceMock>;

  beforeEach(async () => {
    resetStaticState();
    // Default: no userId (system path)
    jest.spyOn(RequestContext, "getUserId").mockReturnValue(undefined);
    mockToolKeyResolverService.resolveToolKey.mockResolvedValue(null);
    mockPolicyDataService = createMockPolicyDataService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemanticScholarSearchTool,
        { provide: PolicyDataService, useValue: mockPolicyDataService },
        {
          provide: ToolKeyResolverService,
          useValue: mockToolKeyResolverService,
        },
      ],
    }).compile();
    tool = module.get<SemanticScholarSearchTool>(SemanticScholarSearchTool);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    resetStaticState();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // =========================================================================
  // Lines 394-396: rate limit interval wait in acquireSlot
  // =========================================================================

  describe("acquireSlot rate limit interval (lines 394-396)", () => {
    it("waits for rate limit interval when requests come too fast", async () => {
      // Set lastRequestTime to now so next request must wait
      (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
        "lastRequestTime"
      ] = Date.now();

      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const executePromise = tool.execute({ query: "test" }, makeContext());

      // Advance timers past the MIN_REQUEST_INTERVAL (1000ms for no key)
      jest.advanceTimersByTime(1100);

      const result = await executePromise;
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // Lines 379-382: global 429 cooldown wait in acquireSlot
  // =========================================================================

  describe("acquireSlot global 429 cooldown (lines 379-382)", () => {
    it("waits for global cooldown when cooldownUntil is in the future", async () => {
      // Set cooldown to 500ms from now
      const cooldownMs = 500;
      (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
        "cooldownUntil"
      ] = Date.now() + cooldownMs;

      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const executePromise = tool.execute(
        { query: "cooldown test" },
        makeContext(),
      );

      // Advance past the cooldown
      jest.advanceTimersByTime(600);

      const result = await executePromise;
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // Lines 369-370: concurrent request queuing
  // =========================================================================

  describe("acquireSlot concurrent queuing (lines 369-370)", () => {
    it("queues second request when at max concurrency", async () => {
      // Saturate the single slot
      (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
        "activeRequests"
      ] = 1;

      // When httpGet resolves, the queued request will get a slot
      mockPolicyDataService.httpGet.mockResolvedValue(makeMockApiResponse());

      const executePromise = tool.execute(
        { query: "queued request" },
        makeContext(),
      );

      // Release the slot by decrementing active requests and calling the queued resolver
      const queue = (
        SemanticScholarSearchTool as unknown as Record<string, unknown>
      )["requestQueue"] as Array<() => void>;

      // Advance timers and release slot so queued request can proceed
      jest.advanceTimersByTime(50);
      // Manually decrement and release
      (SemanticScholarSearchTool as unknown as Record<string, unknown>)[
        "activeRequests"
      ] = 0;
      if (queue.length > 0) {
        const next = queue.shift();
        if (next) next();
      }

      jest.advanceTimersByTime(1100);

      const result = await executePromise;
      expect(result.success).toBe(true);
    });
  });

  // =========================================================================
  // markKeyFailed with API key on error (lines 321-328)
  // =========================================================================

  describe("markKeyFailed with API key on error", () => {
    it("calls markKeyFailed when error occurs with API key", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("my-api-key");
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("500 Server Error"),
      );

      const executePromise = tool.execute(
        { query: "error test" },
        makeContext(),
      );
      jest.advanceTimersByTime(1100);

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(mockPolicyDataService.markKeyFailed).toHaveBeenCalledWith(
        "semantic-scholar",
        "my-api-key",
        500,
      );
    });

    it("calls markKeyFailed with 500 status when no status code in error message", async () => {
      mockPolicyDataService.getApiKey.mockResolvedValue("my-api-key-2");
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("Network timeout"),
      );

      const executePromise = tool.execute(
        { query: "timeout test" },
        makeContext(),
      );
      jest.advanceTimersByTime(1100);

      const result = await executePromise;
      expect(result.data?.success).toBe(false);
      expect(mockPolicyDataService.markKeyFailed).toHaveBeenCalledWith(
        "semantic-scholar",
        "my-api-key-2",
        500,
      );
    });
  });

  // =========================================================================
  // Lines 276-277: 429 exhausted all retries → sets 60s cooldown
  // (Requires real setTimeout so we use manual fake timer advancement)
  // =========================================================================

  describe("429 exhausted all retries (lines 276-277)", () => {
    it("sets 60s cooldown after exhausting all 429 retries", async () => {
      // Make all retries fail with 429
      mockPolicyDataService.httpGet.mockRejectedValue(
        new Error("429 Too Many Requests"),
      );

      const executePromise = tool.execute(
        { query: "rate-limited query" },
        makeContext(),
      );

      // Advance through all retry backoffs (3 retries, cumulative backoff ~23s max).
      // advanceTimersByTimeAsync 在每个定时器回调之间自动冲刷微任务，async 退避链
      // 才能逐级推进。只推进 40s：足够耗尽 3 次退避，又不超过随后设置的 ~60s
      // cooldown（推太多会让 Date.now() 越过 cooldownUntil，断言失败）。
      await jest.advanceTimersByTimeAsync(40000);

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      // After exhausting retries, cooldownUntil should be set to ~60s from now
      const cooldownUntil = (
        SemanticScholarSearchTool as unknown as Record<string, unknown>
      )["cooldownUntil"] as number;
      expect(cooldownUntil).toBeGreaterThan(Date.now());
    });
  });
});

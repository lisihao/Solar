import {
  QueryLoopService,
  ChatFnResult,
  ChatMessage,
  ChatFn,
} from "../query-loop.service";
import { TokenTrackerService } from "../token-tracker.service";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ChatFnResult> = {}): ChatFnResult {
  return {
    content: "response content",
    model: "test-model",
    tokensUsed: 100,
    inputTokens: 50,
    outputTokens: 50,
    isError: false,
    finishReason: "stop",
    ...overrides,
  };
}

const INITIAL_MESSAGES: ChatMessage[] = [
  { role: "user", content: "Write a long essay." },
];

// ─── Mocks ───────────────────────────────────────────────────────────────────

function makeTokenTrackerMock(): jest.Mocked<TokenTrackerService> {
  return {
    createSession: jest.fn(),
    recordUsage: jest.fn(),
    getUsage: jest.fn(),
    isOverBudget: jest.fn().mockReturnValue(false),
    getRemainingBudget: jest.fn(),
    endSession: jest.fn(),
  } as unknown as jest.Mocked<TokenTrackerService>;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("QueryLoopService", () => {
  describe("Basic behavior", () => {
    it("single call returning finishReason 'stop' — no continuation, stoppedReason 'complete', continuations = 0", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockResolvedValueOnce(
        makeResult({ content: "Hello world", finishReason: "stop" }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.continuations).toBe(0);
      expect(result.stoppedReason).toBe("complete");
      expect(result.wasContinued).toBe(false);
      expect(result.content).toBe("Hello world");
      expect(chatFn).toHaveBeenCalledTimes(1);
    });

    it("single call returning finishReason 'length' — one continuation performed, content assembled from both parts", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "part one ",
          finishReason: "length",
          outputTokens: 800,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({ content: "part two", finishReason: "stop" }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.continuations).toBe(1);
      expect(result.wasContinued).toBe(true);
      expect(result.stoppedReason).toBe("complete");
      expect(result.content).toBe("part one part two");
      expect(chatFn).toHaveBeenCalledTimes(2);
    });

    it("multiple continuations until 'stop' — content from all parts joined correctly", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "A",
          finishReason: "length",
          outputTokens: 800,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "B",
          finishReason: "length",
          outputTokens: 800,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({ content: "C", finishReason: "stop" }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.continuations).toBe(2);
      expect(result.content).toBe("ABC");
      expect(result.stoppedReason).toBe("complete");
    });

    it("content assembly — parts are joined with empty string, no separators inserted", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "Hello",
          finishReason: "length",
          outputTokens: 800,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({ content: " World", finishReason: "stop" }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      // Exactly concatenated — no newline, space, or any separator added
      expect(result.content).toBe("Hello World");
    });
  });

  // ─── Stopping conditions ──────────────────────────────────────────────────

  describe("Stopping conditions", () => {
    it("reaches maxContinuations — stops with stoppedReason 'max_continuations'", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      // Always truncated — the loop must cap itself
      chatFn.mockResolvedValue(
        makeResult({ content: "x", finishReason: "length", outputTokens: 800 }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES, {
        maxContinuations: 3,
      });

      expect(result.stoppedReason).toBe("max_continuations");
      // The loop calls LLM (initial) + 3 continuations, stops before a 4th
      expect(result.continuations).toBe(3);
    });

    it("token budget exhausted — stops with stoppedReason 'budget_exhausted'", async () => {
      const mockTracker = makeTokenTrackerMock();
      // Budget not exhausted on first call; exhausted from the second call onward
      mockTracker.isOverBudget
        .mockReturnValueOnce(false) // after call #1 content collected, budget OK
        .mockReturnValue(true); // budget over → stop before continuation #2

      const service = new QueryLoopService(mockTracker);
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "part1",
          finishReason: "length",
          outputTokens: 800,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "part2",
          finishReason: "length",
          outputTokens: 800,
        }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES, {
        tokenBudgetLimit: 500,
      });

      expect(result.stoppedReason).toBe("budget_exhausted");
      expect(mockTracker.isOverBudget).toHaveBeenCalled();
    });

    it("diminishing returns — outputTokens below threshold after minContinuationsForDiminishing — stops with 'diminishing_returns'", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();

      // 3 healthy continuations (still truncated, above threshold)
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "c0",
          finishReason: "length",
          outputTokens: 1000,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "c1",
          finishReason: "length",
          outputTokens: 1000,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "c2",
          finishReason: "length",
          outputTokens: 1000,
        }),
      );
      // After 3 continuations (continuations === minContinuationsForDiminishing = 3)
      // this response has tiny outputTokens → triggers diminishing check
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "c3",
          finishReason: "length",
          outputTokens: 100, // below default diminishingThreshold of 500
        }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES, {
        minContinuationsForDiminishing: 3,
        diminishingThreshold: 500,
      });

      expect(result.stoppedReason).toBe("diminishing_returns");
    });

    it("diminishing returns NOT triggered before minContinuationsForDiminishing", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();

      // Only 2 continuations have happened before the tiny response
      // minContinuationsForDiminishing = 3 → guard should NOT trigger
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "c0",
          finishReason: "length",
          outputTokens: 1000,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "c1",
          finishReason: "length",
          outputTokens: 1000,
        }),
      );
      // After 2 continuations, tiny output → should NOT stop yet (need 3)
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "c2",
          finishReason: "length",
          outputTokens: 50,
        }),
      );
      // Final real finish
      chatFn.mockResolvedValueOnce(
        makeResult({ content: "c3", finishReason: "stop" }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES, {
        minContinuationsForDiminishing: 3,
        diminishingThreshold: 500,
      });

      // Loop must have continued past the tiny-output call and reached "stop"
      expect(result.stoppedReason).toBe("complete");
      expect(result.continuations).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── Truncation detection ─────────────────────────────────────────────────

  describe("Truncation detection (isTruncated private logic)", () => {
    it("finishReason 'length' → treated as truncated, triggers continuation", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "truncated",
          finishReason: "length",
          outputTokens: 500,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({ content: " rest", finishReason: "stop" }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.continuations).toBe(1);
    });

    it("finishReason 'stop' → NOT treated as truncated, no continuation", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "done",
          finishReason: "stop",
          outputTokens: 500,
        }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.continuations).toBe(0);
      expect(chatFn).toHaveBeenCalledTimes(1);
    });

    it("outputTokens near the 4096 boundary without explicit finishReason → treated as truncated (heuristic)", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      // 4096 - 30 = 4066 — within the ±50 window around 4096
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "near limit",
          finishReason: undefined, // no explicit reason
          outputTokens: 4066,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({ content: " continued", finishReason: "stop" }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.continuations).toBe(1);
    });

    it("outputTokens at 3000 (not near any known boundary) → NOT treated as truncated", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      // 3000 is far from 4096, 8192, 16384, 32768 (all more than 50 away)
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "complete response",
          finishReason: undefined,
          outputTokens: 3000,
        }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.continuations).toBe(0);
      expect(chatFn).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────────

  describe("Error handling", () => {
    it("first call returns isError true with no prior content — returns error immediately, wasContinued false", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "error message from LLM",
          isError: true,
          inputTokens: 30,
          outputTokens: 10,
        }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.stoppedReason).toBe("error");
      expect(result.wasContinued).toBe(false);
      expect(result.continuations).toBe(0);
      expect(result.content).toBe("error message from LLM");
      expect(result.totalInputTokens).toBe(30);
      expect(result.totalOutputTokens).toBe(10);
    });

    it("error mid-loop with partial content — stoppedReason 'error', returns accumulated content", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      // First call: successful, truncated
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "partial content",
          finishReason: "length",
          outputTokens: 800,
        }),
      );
      // Second call: error — but we already have partial content
      chatFn.mockResolvedValueOnce(
        makeResult({ content: "error occurred", isError: true }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.stoppedReason).toBe("error");
      // Partial content from the first successful call must be preserved
      expect(result.content).toBe("partial content");
    });

    it("chatFn throws an exception — handled gracefully without crashing", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();
      chatFn.mockRejectedValueOnce(new Error("network timeout"));

      await expect(
        service.executeWithLoop(chatFn, INITIAL_MESSAGES),
      ).rejects.toThrow("network timeout");
    });
  });

  // ─── Token tracking ───────────────────────────────────────────────────────

  describe("Token tracking", () => {
    it("with TokenTrackerService — createSession, recordUsage, and endSession are called correctly across continuations", async () => {
      const mockTracker = makeTokenTrackerMock();
      const service = new QueryLoopService(mockTracker);
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();

      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "first",
          finishReason: "length",
          outputTokens: 800,
          inputTokens: 200,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "second",
          finishReason: "stop",
          outputTokens: 300,
          inputTokens: 100,
        }),
      );

      await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      // Session lifecycle
      expect(mockTracker.createSession).toHaveBeenCalledTimes(1);
      expect(mockTracker.endSession).toHaveBeenCalledTimes(1);

      // recordUsage called once per LLM call
      expect(mockTracker.recordUsage).toHaveBeenCalledTimes(2);

      // Check the recorded entries carry the correct token counts
      const firstUsage = mockTracker.recordUsage.mock.calls[0][1];
      expect(firstUsage.inputTokens).toBe(200);
      expect(firstUsage.outputTokens).toBe(800);

      const secondUsage = mockTracker.recordUsage.mock.calls[1][1];
      expect(secondUsage.inputTokens).toBe(100);
      expect(secondUsage.outputTokens).toBe(300);
    });

    it("without TokenTrackerService (@Optional) — service still works and returns 0 for token fields when tokens not provided", async () => {
      // No tracker injected
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();

      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "result",
          finishReason: "stop",
          inputTokens: undefined,
          outputTokens: undefined,
          tokensUsed: 0,
        }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.content).toBe("result");
      expect(result.totalInputTokens).toBe(0);
      expect(result.totalOutputTokens).toBe(0);
    });

    it("totalInputTokens and totalOutputTokens match the sum accumulated across all calls", async () => {
      const service = new QueryLoopService();
      const chatFn: jest.MockedFunction<ChatFn> = jest.fn();

      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "p1",
          finishReason: "length",
          inputTokens: 100,
          outputTokens: 800,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "p2",
          finishReason: "length",
          inputTokens: 150,
          outputTokens: 800,
        }),
      );
      chatFn.mockResolvedValueOnce(
        makeResult({
          content: "p3",
          finishReason: "stop",
          inputTokens: 200,
          outputTokens: 300,
        }),
      );

      const result = await service.executeWithLoop(chatFn, INITIAL_MESSAGES);

      expect(result.totalInputTokens).toBe(100 + 150 + 200);
      expect(result.totalOutputTokens).toBe(800 + 800 + 300);
    });
  });
});

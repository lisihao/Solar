/**
 * AgentExecutorService expanded unit tests
 *
 * Tests core execution behaviors:
 * - executeTask() — success / failure / retry / circuit breaker
 * - executeTasks() — batch concurrent execution
 * - isAgentAvailable() — circuit breaker state
 * - recordExecution() — circuit breaker state transitions
 * - needsWebSearch() — heuristic detection
 * - buildSearchQuery() — query trimming
 * - formatSearchResults() — output formatting
 * - isRetryableError() — retry classification
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { AgentExecutorService } from "../agent-executor.service";
import { AiChatService } from "../../../../ai-engine/llm/chat/ai-chat.service";
import { ToolRegistry } from "../../../../ai-engine/tools/registry/tool.registry";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

describe("AgentExecutorService (expanded)", () => {
  let service: AgentExecutorService;
  let mockAiChatService: any;
  let mockToolRegistry: any;
  let mockPrisma: any;

  const makeExecutionContext = (overrides = {}) => ({
    executor: {
      id: "agent-1",
      agentName: "Test Agent",
      aiModel: "gpt-4o",
    },
    userPrompt: "Summarize the quarterly report",
    systemPrompt: "You are a helpful assistant.",
    ...overrides,
  });

  beforeEach(async () => {
    mockAiChatService = {
      chat: jest.fn().mockResolvedValue({
        content: "This is a summary of the quarterly report.",
        usage: { totalTokens: 150 },
        isError: false,
        apiKeySource: "system",
      }),
      generateChatCompletion: jest.fn().mockResolvedValue({
        content: "Completion result",
        tokensUsed: 100,
      }),
    };

    mockToolRegistry = {
      tryGet: jest.fn().mockReturnValue(null),
    };

    mockPrisma = {
      aIModel: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentExecutorService,
        { provide: AiChatService, useValue: mockAiChatService },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AgentExecutorService>(AgentExecutorService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== executeTask — success path ====================

  describe("executeTask — success path", () => {
    it("should return success result with content and tokensUsed", async () => {
      const result = await service.executeTask(makeExecutionContext());

      expect(result.success).toBe(true);
      // Content comes from generateChatCompletion (no DB apiKey)
      expect(result.content).toBeDefined();
      expect(result.tokensUsed).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("should use generateChatCompletion when no DB apiKey", async () => {
      // Default mock has no DB config — should fall through to generateChatCompletion
      await service.executeTask(makeExecutionContext());

      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalled();
    });

    it("should always use generateChatCompletion() regardless of DB model apiKey", async () => {
      mockPrisma.aIModel.findFirst.mockResolvedValueOnce({
        modelId: "gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        apiKey: "sk-test-key",
        apiEndpoint: null,
        isEnabled: true,
      });

      const result = await service.executeTask(makeExecutionContext());

      // chat() is no longer called — all paths go through generateChatCompletion()
      expect(mockAiChatService.chat).not.toHaveBeenCalled();
      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should pass taskProfile to AI call", async () => {
      await service.executeTask(makeExecutionContext(), {
        taskProfile: { creativity: "low", outputLength: "short" },
      });

      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: { creativity: "low", outputLength: "short" },
        }),
      );
    });

    it("should handle tokensUsed from generateChatCompletion() format (tokensUsed field)", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValueOnce({
        content: "Response via generateChatCompletion()",
        tokensUsed: 200,
      });

      const result = await service.executeTask(makeExecutionContext());
      expect(result.tokensUsed).toBe(200);
    });

    it("should handle tokensUsed from generateChatCompletion() format (tokensUsed)", async () => {
      mockAiChatService.generateChatCompletion.mockResolvedValueOnce({
        content: "Completion",
        tokensUsed: 75,
      });

      const result = await service.executeTask(makeExecutionContext());
      expect(result.tokensUsed).toBe(75);
    });
  });

  // ==================== executeTask — circuit breaker ====================

  describe("executeTask — circuit breaker", () => {
    it("should return unavailable when circuit breaker is open", async () => {
      // Force circuit breaker open by recording 3 consecutive failures
      for (let i = 0; i < 3; i++) {
        service.recordExecution("agent-1", false, 100);
      }

      const result = await service.executeTask(makeExecutionContext());

      expect(result.success).toBe(false);
      expect(result.error).toContain("circuit breaker open");
      expect(result.retryable).toBe(true);
    });

    it("should allow execution when agent is new (no breaker state)", async () => {
      const available = service.isAgentAvailable("brand-new-agent");
      expect(available).toBe(true);
    });
  });

  // ==================== executeTask — search enhancement ====================

  describe("executeTask — search enhancement", () => {
    it("should perform web search when enableSearch=true and prompt matches", async () => {
      const mockSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Latest AI trends",
                url: "https://example.com/ai",
                content: "AI is advancing rapidly.",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValueOnce(mockSearchTool);

      const context = makeExecutionContext({
        userPrompt: "最新AI技术趋势是什么",
      });

      const result = await service.executeTask(context, { enableSearch: true });

      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
      expect(mockSearchTool.execute).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should not search when enableSearch=false", async () => {
      const context = makeExecutionContext({
        userPrompt: "最新趋势报告搜索",
      });

      await service.executeTask(context, { enableSearch: false });

      expect(mockToolRegistry.tryGet).not.toHaveBeenCalled();
    });

    it("should not search when prompt does not match search indicators", async () => {
      const context = makeExecutionContext({
        userPrompt: "计算1+1等于几",
      });

      await service.executeTask(context, { enableSearch: true });

      expect(mockToolRegistry.tryGet).not.toHaveBeenCalled();
    });

    it("should continue gracefully when web-search tool not available", async () => {
      mockToolRegistry.tryGet.mockReturnValueOnce(null);

      const context = makeExecutionContext({ userPrompt: "最新市场数据" });
      const result = await service.executeTask(context, { enableSearch: true });

      // Should still succeed using normal AI call
      expect(result.success).toBe(true);
    });

    it("should continue gracefully when search tool throws", async () => {
      const failingSearchTool = {
        execute: jest.fn().mockRejectedValue(new Error("Search service down")),
      };
      mockToolRegistry.tryGet.mockReturnValueOnce(failingSearchTool);

      const context = makeExecutionContext({ userPrompt: "当前市场趋势" });
      const result = await service.executeTask(context, { enableSearch: true });

      // Should still succeed with AI call only
      expect(result.success).toBe(true);
    });
  });

  // ==================== executeTask — retry logic ====================

  describe("executeTask — retry logic", () => {
    beforeEach(() => {
      // Speed up retry tests
      jest
        .spyOn(service as any, "sleep")
        .mockImplementation(() => Promise.resolve());
    });

    it("should retry on rate limit error", async () => {
      mockAiChatService.generateChatCompletion
        .mockRejectedValueOnce(new Error("rate limit exceeded"))
        .mockResolvedValueOnce({ content: "Retry success", tokensUsed: 50 });

      const result = await service.executeTask(makeExecutionContext(), {
        maxRetries: 2,
      });

      expect(result.success).toBe(true);
      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalledTimes(2);
    });

    it("should retry on timeout error", async () => {
      mockAiChatService.generateChatCompletion
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValueOnce({
          content: "After timeout retry",
          tokensUsed: 80,
        });

      const result = await service.executeTask(makeExecutionContext(), {
        maxRetries: 1,
      });

      expect(result.success).toBe(true);
    });

    it("should not retry on non-retryable error", async () => {
      mockAiChatService.generateChatCompletion.mockRejectedValue(
        new Error("Invalid model: nonexistent-model"),
      );

      const result = await service.executeTask(makeExecutionContext(), {
        maxRetries: 3,
      });

      // Non-retryable error — should fail after 1 attempt
      expect(result.success).toBe(false);
      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalledTimes(1);
    });

    it("should fail after exhausting all retries", async () => {
      mockAiChatService.generateChatCompletion.mockRejectedValue(
        new Error("429: rate limit"),
      );

      const result = await service.executeTask(makeExecutionContext(), {
        maxRetries: 2,
        retryInitialDelay: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("rate limit");
      // 1 initial + 2 retries = 3 calls
      expect(mockAiChatService.generateChatCompletion).toHaveBeenCalledTimes(3);
    });
  });

  // ==================== executeTask — error handling ====================

  describe("executeTask — error handling", () => {
    it("should return failure result on unexpected exception", async () => {
      // Make both AI call methods throw so execution fails
      mockAiChatService.generateChatCompletion.mockRejectedValue(
        new Error("unexpected crash"),
      );
      mockPrisma.aIModel.findFirst.mockRejectedValueOnce(
        new Error("Database unavailable"),
      );

      const result = await service.executeTask(makeExecutionContext(), {
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
    });

    it("should include searchContext in message when search returns results", async () => {
      const mockSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Market Report",
                url: "https://example.com",
                content: "The market grew by 15%.",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValueOnce(mockSearchTool);

      const context = makeExecutionContext({ userPrompt: "最新市场报告" });
      await service.executeTask(context, { enableSearch: true });

      const chatCall =
        mockAiChatService.generateChatCompletion.mock.calls[0][0];
      const userMessage = chatCall.messages.find((m: any) => m.role === "user");
      expect(userMessage.content).toContain("搜索结果参考");
    });
  });

  // ==================== executeTasks — batch ====================

  describe("executeTasks", () => {
    it("should execute multiple tasks concurrently", async () => {
      const contexts = [
        makeExecutionContext({
          executor: { id: "a1", agentName: "A1", aiModel: "gpt-4o" },
        }),
        makeExecutionContext({
          executor: { id: "a2", agentName: "A2", aiModel: "gpt-4o" },
        }),
        makeExecutionContext({
          executor: { id: "a3", agentName: "A3", aiModel: "gpt-4o" },
        }),
      ];

      const results = await service.executeTasks(contexts);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("should respect concurrency limit", async () => {
      let concurrentCount = 0;
      let maxConcurrent = 0;

      mockAiChatService.generateChatCompletion.mockImplementation(async () => {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        await new Promise((r) => setTimeout(r, 5));
        concurrentCount--;
        return { content: "Done", tokensUsed: 10 };
      });

      const contexts = Array.from({ length: 6 }, (_, i) =>
        makeExecutionContext({
          executor: {
            id: `agent-${i}`,
            agentName: `Agent ${i}`,
            aiModel: "gpt-4o",
          },
        }),
      );

      await service.executeTasks(contexts, { concurrency: 2 });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("should return partial results if some tasks fail", async () => {
      mockAiChatService.generateChatCompletion
        .mockResolvedValueOnce({ content: "OK", tokensUsed: 50 })
        .mockRejectedValueOnce(new Error("invalid model"))
        .mockResolvedValueOnce({ content: "OK again", tokensUsed: 50 });

      const contexts = [
        makeExecutionContext({
          executor: { id: "ok-1", agentName: "OK1", aiModel: "gpt-4o" },
        }),
        makeExecutionContext({
          executor: { id: "fail", agentName: "Fail", aiModel: "gpt-4o" },
        }),
        makeExecutionContext({
          executor: { id: "ok-2", agentName: "OK2", aiModel: "gpt-4o" },
        }),
      ];

      const results = await service.executeTasks(contexts);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
    });
  });

  // ==================== isAgentAvailable ====================

  describe("isAgentAvailable", () => {
    it("should return true when no state exists", () => {
      expect(service.isAgentAvailable("never-seen")).toBe(true);
    });

    it("should return true after successful execution", () => {
      service.recordExecution("agent-ok", true, 200);
      expect(service.isAgentAvailable("agent-ok")).toBe(true);
    });

    it("should return false after 3 consecutive failures (circuit open)", () => {
      for (let i = 0; i < 3; i++) {
        service.recordExecution("agent-fail", false, 100);
      }
      expect(service.isAgentAvailable("agent-fail")).toBe(false);
    });

    it("should allow half-open attempt after cooldown period", () => {
      for (let i = 0; i < 3; i++) {
        service.recordExecution("agent-cooldown", false, 100);
      }

      // Simulate time passing by manipulating lastFailureTime
      const state = (service as any).circuitBreakers.get("agent-cooldown");
      state.lastFailureTime = new Date(Date.now() - 70000); // 70 seconds ago

      // Should enter half-open state
      const available = service.isAgentAvailable("agent-cooldown");
      expect(available).toBe(true);
    });

    it("should block after max half-open attempts", () => {
      for (let i = 0; i < 3; i++) {
        service.recordExecution("agent-halfopen", false, 100);
      }

      const state = (service as any).circuitBreakers.get("agent-halfopen");
      state.lastFailureTime = new Date(Date.now() - 70000);

      // Use up half-open attempts
      service.isAgentAvailable("agent-halfopen"); // attempt 1
      service.isAgentAvailable("agent-halfopen"); // attempt 2 (max)
      const blocked = service.isAgentAvailable("agent-halfopen"); // should block now

      expect(blocked).toBe(false);
    });
  });

  // ==================== recordExecution ====================

  describe("recordExecution", () => {
    it("should reset circuit breaker on success", () => {
      // First open the circuit
      for (let i = 0; i < 3; i++) {
        service.recordExecution("agent-reset", false, 100);
      }
      expect(service.isAgentAvailable("agent-reset")).toBe(false);

      // Then record success (simulate half-open succeeded)
      const state = (service as any).circuitBreakers.get("agent-reset");
      state.lastFailureTime = new Date(Date.now() - 70000);
      service.isAgentAvailable("agent-reset"); // enter half-open

      service.recordExecution("agent-reset", true, 200);

      expect(service.isAgentAvailable("agent-reset")).toBe(true);
    });

    it("should increment failure count on each failure", () => {
      service.recordExecution("agent-counting", false, 100);
      service.recordExecution("agent-counting", false, 100);

      const state = (service as any).circuitBreakers.get("agent-counting");
      expect(state.failureCount).toBe(2);
      expect(state.isOpen).toBe(false); // threshold is 3
    });

    it("should open circuit at failure threshold (3)", () => {
      service.recordExecution("agent-threshold", false, 100);
      service.recordExecution("agent-threshold", false, 100);
      service.recordExecution("agent-threshold", false, 100);

      const state = (service as any).circuitBreakers.get("agent-threshold");
      expect(state.isOpen).toBe(true);
    });

    it("should initialize new state when agent first seen", () => {
      service.recordExecution("brand-new", false, 50);

      const state = (service as any).circuitBreakers.get("brand-new");
      expect(state).toBeDefined();
      expect(state.agentId).toBe("brand-new");
      expect(state.failureCount).toBe(1);
    });
  });

  // ==================== private methods via indirect testing ====================

  describe("search-related private methods (via executeTask)", () => {
    const searchIndicators = [
      "最新",
      "最近",
      "当前",
      "现在",
      "2025",
      "搜索",
      "市场",
      "行业",
      "趋势",
      "新闻",
      "latest",
      "recent",
      "current",
      "search",
      "market",
      "trend",
    ];

    it.each(searchIndicators)(
      "should trigger search for prompt containing '%s'",
      async (indicator) => {
        const mockSearchTool = {
          execute: jest.fn().mockResolvedValue({
            success: true,
            data: { success: true, results: [] },
          }),
        };
        mockToolRegistry.tryGet.mockReturnValueOnce(mockSearchTool);

        await service.executeTask(
          makeExecutionContext({ userPrompt: `请提供关于${indicator}的报告` }),
          { enableSearch: true },
        );

        expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
      },
    );
  });

  describe("buildSearchQuery (via executeTask)", () => {
    it("should truncate long prompts to 100 characters", async () => {
      const mockSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [{ title: "T", url: "u", content: "c" }],
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValueOnce(mockSearchTool);

      const longPrompt = "最新" + "A".repeat(200);
      await service.executeTask(
        makeExecutionContext({ userPrompt: longPrompt }),
        { enableSearch: true },
      );

      const executeCall = mockSearchTool.execute.mock.calls[0][0];
      expect(executeCall.query.length).toBeLessThanOrEqual(100);
    });
  });

  describe("formatSearchResults (via executeTask)", () => {
    it("should format and include up to 5 search results in context", async () => {
      const mockSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: Array.from({ length: 8 }, (_, i) => ({
              title: `Result ${i + 1}`,
              url: `https://example.com/${i + 1}`,
              content: `Content ${i + 1}`,
            })),
          },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValueOnce(mockSearchTool);

      await service.executeTask(
        makeExecutionContext({ userPrompt: "最新AI趋势" }),
        { enableSearch: true },
      );

      const chatCall =
        mockAiChatService.generateChatCompletion.mock.calls[0][0];
      const userMessage = chatCall.messages.find((m: any) => m.role === "user");

      // Should only include first 5 results
      let countedResults = 0;
      for (let i = 1; i <= 8; i++) {
        if (userMessage.content.includes(`Result ${i}`)) countedResults++;
      }
      expect(countedResults).toBeLessThanOrEqual(5);
    });
  });
});

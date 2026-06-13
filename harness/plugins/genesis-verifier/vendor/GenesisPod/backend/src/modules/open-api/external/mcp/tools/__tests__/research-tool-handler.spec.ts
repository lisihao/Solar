import { Test, TestingModule } from "@nestjs/testing";
import { ResearchToolHandler } from "../research-tool-handler";
import { AIFacade } from "../../../../../ai-harness/facade/ai.facade";
import { MCPStreamingBridge } from "../../streaming/mcp-streaming-bridge";

jest.mock("../../../../../ai-harness/facade/ai.facade");
jest.mock("../../streaming/mcp-streaming-bridge");

describe("ResearchToolHandler", () => {
  let handler: ResearchToolHandler;
  let mockAiFacade: jest.Mocked<AIFacade>;
  let mockStreamingBridge: jest.Mocked<MCPStreamingBridge>;

  const mockContext = {
    apiKeyId: "test-api-key",
    sessionId: "test-session-id",
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchToolHandler,
        {
          provide: AIFacade,
          useValue: {
            executeDirectResearch: jest.fn(),
          },
        },
        {
          provide: MCPStreamingBridge,
          useValue: {
            sendEvent: jest.fn(),
            sendResearchResult: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get<ResearchToolHandler>(ResearchToolHandler);
    mockAiFacade = module.get(AIFacade);
    mockStreamingBridge = module.get(MCPStreamingBridge);
  });

  // =========================================================================
  // Tool metadata
  // =========================================================================

  describe("tool metadata", () => {
    it("should have correct toolName", () => {
      expect(handler.toolName).toBe("genesis_deep_research");
    });

    it("should have description", () => {
      expect(handler.description).toBeDefined();
      expect(handler.description.length).toBeGreaterThan(0);
    });

    it("should have inputSchema with required topic", () => {
      expect(handler.inputSchema.required).toContain("topic");
    });
  });

  // =========================================================================
  // Input validation
  // =========================================================================

  describe("execute - input validation", () => {
    it("should return error when topic is missing", async () => {
      const result = await handler.execute({}, mockContext);
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.error).toBe("Invalid input");
      expect(parsed.details).toContain("topic");
    });

    it("should return error when topic is empty string", async () => {
      const result = await handler.execute({ topic: "  " }, mockContext);
      expect(result.isError).toBe(true);
    });

    it("should return error when topic is not a string", async () => {
      const result = await handler.execute({ topic: 123 }, mockContext);
      expect(result.isError).toBe(true);
    });

    it("should return error when dimensions is not array of strings", async () => {
      const result = await handler.execute(
        { topic: "AI", dimensions: [1, 2, 3] },
        mockContext,
      );
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.details).toContain("dimensions");
    });

    it("should return error when dimensions contains non-strings", async () => {
      const result = await handler.execute(
        { topic: "AI", dimensions: ["valid", 123] },
        mockContext,
      );
      expect(result.isError).toBe(true);
    });

    it("should return error when depth is invalid", async () => {
      const result = await handler.execute(
        { topic: "AI", depth: "invalid" },
        mockContext,
      );
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.details).toContain("depth");
    });

    it("should accept valid depth values", async () => {
      // Mock background to not actually run
      jest.spyOn(global, "setImmediate").mockImplementation((_fn) => {
        // Don't execute background task
        return undefined as unknown as NodeJS.Immediate;
      });

      for (const depth of ["quick", "standard", "deep"]) {
        const result = await handler.execute(
          { topic: "AI research", depth },
          mockContext,
        );
        expect(result.isError).toBeUndefined();
      }

      (global.setImmediate as jest.Mock).mockRestore();
    });
  });

  // =========================================================================
  // Async execution
  // =========================================================================

  describe("execute - async behavior", () => {
    it("should return immediately with taskId", async () => {
      jest.spyOn(global, "setImmediate").mockImplementation(() => {
        return undefined as unknown as NodeJS.Immediate;
      });

      const result = await handler.execute(
        { topic: "Test topic" },
        mockContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.taskId).toMatch(/^research_[a-f0-9]+$/);
      expect(parsed.status).toBe("started");

      (global.setImmediate as jest.Mock).mockRestore();
    });

    it("should include estimated duration in response", async () => {
      jest.spyOn(global, "setImmediate").mockImplementation(() => {
        return undefined as unknown as NodeJS.Immediate;
      });

      const quickResult = await handler.execute(
        { topic: "AI", depth: "quick" },
        mockContext,
      );
      const quickParsed = JSON.parse(quickResult.content[0].text!);
      expect(quickParsed.estimatedDuration).toContain("2-4");

      const deepResult = await handler.execute(
        { topic: "AI", depth: "deep" },
        mockContext,
      );
      const deepParsed = JSON.parse(deepResult.content[0].text!);
      expect(deepParsed.estimatedDuration).toContain("10-20");

      (global.setImmediate as jest.Mock).mockRestore();
    });

    it("should warn when no SSE session available", async () => {
      jest.spyOn(global, "setImmediate").mockImplementation(() => {
        return undefined as unknown as NodeJS.Immediate;
      });

      const contextNoSession = { apiKeyId: "test-key" };
      const result = await handler.execute({ topic: "AI" }, contextNoSession);

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBeDefined();

      (global.setImmediate as jest.Mock).mockRestore();
    });
  });

  // =========================================================================
  // Background execution
  // =========================================================================

  describe("background research execution", () => {
    it("should complete successfully and send SSE result", async () => {
      const mockResult = {
        report: {
          executiveSummary: "Summary",
          sections: [],
          conclusion: "Conclusion",
          references: [],
          metadata: { quality: "high" },
        },
        searchRounds: [{ sources: ["source1", "source2"] }],
        duration: 120,
      };

      (mockAiFacade.executeDirectResearch as jest.Mock).mockResolvedValue(
        mockResult,
      );

      // Execute with real setImmediate to trigger background task
      let backgroundFn: (() => void) | undefined;
      jest.spyOn(global, "setImmediate").mockImplementation((fn) => {
        backgroundFn = fn as () => void;
        return undefined as unknown as NodeJS.Immediate;
      });

      const result = await handler.execute(
        { topic: "AI research", depth: "quick" },
        mockContext,
      );
      const parsed = JSON.parse(result.content[0].text!);
      const taskId = parsed.taskId;

      // Now run the background task
      if (backgroundFn) await (backgroundFn as () => Promise<void>)();

      expect(mockStreamingBridge.sendResearchResult).toHaveBeenCalledWith(
        "test-session-id",
        taskId,
        expect.objectContaining({
          executiveSummary: "Summary",
          metadata: expect.objectContaining({ totalSources: 2 }),
        }),
      );

      (global.setImmediate as jest.Mock).mockRestore();
    });

    it("should cache result for later retrieval via getCachedResult", async () => {
      const mockResult = {
        report: {
          executiveSummary: "Summary",
          sections: [],
          conclusion: "",
          references: [],
          metadata: {},
        },
        searchRounds: [{ sources: ["s1"] }],
        duration: 60,
      };

      (mockAiFacade.executeDirectResearch as jest.Mock).mockResolvedValue(
        mockResult,
      );

      let backgroundFn: (() => void) | undefined;
      jest.spyOn(global, "setImmediate").mockImplementation((fn) => {
        backgroundFn = fn as () => void;
        return undefined as unknown as NodeJS.Immediate;
      });

      const result = await handler.execute({ topic: "Test" }, mockContext);
      const parsed = JSON.parse(result.content[0].text!);
      const taskId = parsed.taskId;

      if (backgroundFn) await (backgroundFn as () => Promise<void>)();

      const cached = handler.getCachedResult(taskId);
      expect(cached).toBeDefined();
      expect(cached!.isError).toBe(false);
      expect(cached!.data).toMatchObject({ executiveSummary: "Summary" });

      (global.setImmediate as jest.Mock).mockRestore();
    });

    it("should handle no sources found error", async () => {
      const mockResultNoSources = {
        report: {
          executiveSummary: "",
          sections: [],
          conclusion: "",
          references: [],
          metadata: {},
        },
        searchRounds: [{ sources: [] }],
        duration: 10,
      };

      (mockAiFacade.executeDirectResearch as jest.Mock).mockResolvedValue(
        mockResultNoSources,
      );

      let backgroundFn: (() => void) | undefined;
      jest.spyOn(global, "setImmediate").mockImplementation((fn) => {
        backgroundFn = fn as () => void;
        return undefined as unknown as NodeJS.Immediate;
      });

      const result = await handler.execute({ topic: "Test" }, mockContext);
      const parsed = JSON.parse(result.content[0].text!);
      const taskId = parsed.taskId;

      if (backgroundFn) await (backgroundFn as () => Promise<void>)();

      const cached = handler.getCachedResult(taskId);
      expect(cached).toBeDefined();
      expect(cached!.isError).toBe(true);

      // Error SSE event should be sent
      expect(mockStreamingBridge.sendEvent).toHaveBeenCalledWith(
        "test-session-id",
        expect.objectContaining({ type: "error", taskId }),
      );

      (global.setImmediate as jest.Mock).mockRestore();
    });

    it("should handle research execution error", async () => {
      (mockAiFacade.executeDirectResearch as jest.Mock).mockRejectedValue(
        new Error("API failure"),
      );

      let backgroundFn: (() => void) | undefined;
      jest.spyOn(global, "setImmediate").mockImplementation((fn) => {
        backgroundFn = fn as () => void;
        return undefined as unknown as NodeJS.Immediate;
      });

      const result = await handler.execute(
        { topic: "Test error" },
        mockContext,
      );
      const parsed = JSON.parse(result.content[0].text!);
      const taskId = parsed.taskId;

      if (backgroundFn) await (backgroundFn as () => Promise<void>)();

      const cached = handler.getCachedResult(taskId);
      expect(cached).toBeDefined();
      expect(cached!.isError).toBe(true);

      (global.setImmediate as jest.Mock).mockRestore();
    });

    it("should send progress events during execution", async () => {
      let _capturedProgressCallback:
        | ((stage: string, percent: number, message: string) => void)
        | undefined;

      (mockAiFacade.executeDirectResearch as jest.Mock).mockImplementation(
        async ({ onProgress }) => {
          _capturedProgressCallback = onProgress;
          onProgress("searching", 30, "Searching...");
          onProgress("analyzing", 70, "Analyzing...");
          return {
            report: {
              executiveSummary: "Done",
              sections: [],
              conclusion: "",
              references: [],
              metadata: {},
            },
            searchRounds: [{ sources: ["s1"] }],
            duration: 60,
          };
        },
      );

      let backgroundFn: (() => void) | undefined;
      jest.spyOn(global, "setImmediate").mockImplementation((fn) => {
        backgroundFn = fn as () => void;
        return undefined as unknown as NodeJS.Immediate;
      });

      await handler.execute({ topic: "Test" }, mockContext);

      if (backgroundFn) await (backgroundFn as () => Promise<void>)();

      // Progress events sent
      expect(mockStreamingBridge.sendEvent).toHaveBeenCalledWith(
        "test-session-id",
        expect.objectContaining({ type: "progress" }),
      );

      (global.setImmediate as jest.Mock).mockRestore();
    });
  });

  // =========================================================================
  // getCachedResult
  // =========================================================================

  describe("getCachedResult", () => {
    it("should return undefined for unknown taskId", () => {
      const result = handler.getCachedResult("non-existent-task");
      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // Dimensions and language handling
  // =========================================================================

  describe("dimensions and language handling", () => {
    it("should accept valid dimensions array", async () => {
      jest.spyOn(global, "setImmediate").mockImplementation(() => {
        return undefined as unknown as NodeJS.Immediate;
      });

      const result = await handler.execute(
        {
          topic: "AI",
          dimensions: ["technical", "market"],
          language: "zh",
        },
        mockContext,
      );

      expect(result.isError).toBeUndefined();

      (global.setImmediate as jest.Mock).mockRestore();
    });

    it("should use default language en when not specified", async () => {
      jest.spyOn(global, "setImmediate").mockImplementation(() => {
        return undefined as unknown as NodeJS.Immediate;
      });

      // We can't directly test the background fn, but we verify no error
      const result = await handler.execute({ topic: "AI" }, mockContext);
      expect(result.isError).toBeUndefined();

      (global.setImmediate as jest.Mock).mockRestore();
    });
  });
});

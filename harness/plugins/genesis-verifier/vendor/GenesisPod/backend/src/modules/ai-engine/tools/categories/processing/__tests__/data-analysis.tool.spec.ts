/**
 * DataAnalysisTool Unit Tests
 */

import {
  DataAnalysisInput,
  DataAnalysisTool,
} from "../data/data-analysis.tool";
import { AiChatService } from "../../../../llm/chat/ai-chat.service";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Mock setup
// ============================================================================

interface ChatResult {
  content: string;
  model: string;
  usage?: { totalTokens: number };
}

const mockAiChatService = {
  chat: jest.fn() as jest.MockedFunction<
    (options: unknown) => Promise<ChatResult>
  >,
};

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "data-analysis",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

function defaultChatResponse(content = "Analysis result"): ChatResult {
  return { content, model: "gpt-4o", usage: { totalTokens: 100 } };
}

// ============================================================================
// Test suite
// ============================================================================

describe("DataAnalysisTool", () => {
  let tool: DataAnalysisTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new DataAnalysisTool(mockAiChatService as unknown as AiChatService);
  });

  // --------------------------------------------------------------------------
  // Tool metadata
  // --------------------------------------------------------------------------

  describe("tool metadata", () => {
    it("should have correct id and category", () => {
      expect(tool.id).toBe("data-analysis");
      expect(tool.category).toBe("processing");
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true when data and analysisType are provided", () => {
      const input: DataAnalysisInput = {
        data: { key: "value" },
        analysisType: "summary",
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return false when data is null", () => {
      const input = {
        data: null,
        analysisType: "summary",
      } as unknown as DataAnalysisInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when data is undefined", () => {
      const input = {
        data: undefined,
        analysisType: "summary",
      } as unknown as DataAnalysisInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return false when analysisType is missing", () => {
      const input = { data: { value: 1 } } as unknown as DataAnalysisInput;
      expect(tool.validateInput(input)).toBe(false);
    });

    it("should return true when data is an array", () => {
      const input: DataAnalysisInput = {
        data: [1, 2, 3],
        analysisType: "statistics",
      };
      expect(tool.validateInput(input)).toBe(true);
    });

    it("should return true when data is a string", () => {
      const input: DataAnalysisInput = {
        data: "some raw text",
        analysisType: "insights",
      };
      expect(tool.validateInput(input)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Happy path - analysisType variants
  // --------------------------------------------------------------------------

  describe("analysisType: summary", () => {
    it("should call chat and return analysis with success:true", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("Summary result"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: { sales: [100, 200, 300] }, analysisType: "summary" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.analysis).toBe("Summary result");
    });
  });

  describe("analysisType: statistics", () => {
    it("should call chat for statistics analysis", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("- Mean: 200\n- Median: 200"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: [100, 200, 300], analysisType: "statistics" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.analysis).toContain("Mean");
    });
  });

  describe("analysisType: trends", () => {
    it("should return analysis for trends type", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("Upward trend detected"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: { q1: 10, q2: 20, q3: 30 }, analysisType: "trends" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.analysis).toBe("Upward trend detected");
    });
  });

  describe("analysisType: custom", () => {
    it("should include customPrompt in the user message", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("Custom result"),
      );
      const context = createMockContext();

      await tool.execute(
        {
          data: { value: 42 },
          analysisType: "custom",
          customPrompt: "Focus on outliers only.",
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMessage = callArg.messages.find((m) => m.role === "user");
      expect(userMessage?.content).toContain("Focus on outliers only.");
    });
  });

  // --------------------------------------------------------------------------
  // outputFormat variants
  // --------------------------------------------------------------------------

  describe("outputFormat: json - valid JSON response", () => {
    it("should parse JSON response and return structured output", async () => {
      const jsonContent = JSON.stringify({
        analysis: "Stats summary",
        insights: ["Insight 1", "Insight 2"],
        statistics: { mean: 100 },
      });
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse(jsonContent),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: [1, 2, 3], analysisType: "statistics", outputFormat: "json" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.insights).toEqual(["Insight 1", "Insight 2"]);
      expect(result.data?.statistics).toEqual({ mean: 100 });
    });

    it("should parse JSON from markdown code block", async () => {
      const jsonContent =
        '```json\n{"analysis":"block result","insights":["a"]}\n```';
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse(jsonContent),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: {}, analysisType: "summary", outputFormat: "json" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.insights).toEqual(["a"]);
    });

    it("should fall back to raw text when JSON parse fails", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("not valid json {{"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: {}, analysisType: "summary", outputFormat: "json" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.analysis).toBe("not valid json {{");
    });
  });

  describe("outputFormat: markdown", () => {
    it("should extract bullet points as insights from markdown response", async () => {
      const mdContent =
        "## Analysis\n\n- First key insight about the data\n- Second important finding here\n- Third observation made";
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse(mdContent),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: { x: 1 }, analysisType: "insights", outputFormat: "markdown" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(Array.isArray(result.data?.insights)).toBe(true);
      expect(result.data?.insights!.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // depth variants - taskProfile outputLength
  // --------------------------------------------------------------------------

  describe("depth parameter affects taskProfile", () => {
    it("should use outputLength='long' for depth='deep'", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("deep result"),
      );
      const context = createMockContext();

      await tool.execute(
        { data: { x: 1 }, analysisType: "summary", depth: "deep" },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        taskProfile: { outputLength: string };
      };
      expect(callArg.taskProfile.outputLength).toBe("long");
    });

    it("should use outputLength='medium' for depth='standard'", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("standard result"),
      );
      const context = createMockContext();

      await tool.execute(
        { data: { x: 1 }, analysisType: "summary", depth: "standard" },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        taskProfile: { outputLength: string };
      };
      expect(callArg.taskProfile.outputLength).toBe("medium");
    });

    it("should use outputLength='short' for depth='quick'", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("quick result"),
      );
      const context = createMockContext();

      await tool.execute(
        { data: { x: 1 }, analysisType: "summary", depth: "quick" },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        taskProfile: { outputLength: string };
      };
      expect(callArg.taskProfile.outputLength).toBe("short");
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return success:false analysis:'' when chat throws", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(
        new Error("LLM unavailable"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: { x: 1 }, analysisType: "summary" },
        context,
      );

      // doExecute catches internally and returns { analysis: '', success: false }
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.analysis).toBe("");
    });
  });

  // --------------------------------------------------------------------------
  // Output structure
  // --------------------------------------------------------------------------

  describe("output structure", () => {
    it("should always return success boolean field", async () => {
      mockAiChatService.chat.mockResolvedValueOnce(
        defaultChatResponse("result"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { data: { x: 1 }, analysisType: "comparison" },
        context,
      );

      expect(typeof result.data?.success).toBe("boolean");
      expect(typeof result.data?.analysis).not.toBe("undefined");
    });
  });
});

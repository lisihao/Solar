import { AIModelType } from "@prisma/client";
import { TextGenerationTool } from "../text-generation.tool";
import { AiChatService } from "../../../../llm/chat/ai-chat.service";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Interfaces for mock return types
// ============================================================================

interface ChatResult {
  content: string;
  usage?: { totalTokens: number };
  model: string;
  isError?: boolean;
}

interface ChatCallArg {
  messages: Array<{ role: string; content: string }>;
  modelType: AIModelType;
  taskProfile: { creativity: string; outputLength: string };
  maxTokens?: number;
  temperature?: number;
}

// ============================================================================
// Mock factory
// ============================================================================

const mockAiChatService = {
  chat: jest.fn() as jest.MockedFunction<
    (options: unknown) => Promise<ChatResult>
  >,
};

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "text-generation",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("TextGenerationTool", () => {
  let tool: TextGenerationTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new TextGenerationTool(
      mockAiChatService as unknown as AiChatService,
    );
  });

  // --------------------------------------------------------------------------
  // Basic generation
  // --------------------------------------------------------------------------

  describe("basic generation", () => {
    it("should generate text with only a prompt", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "Hello, world!",
        usage: { totalTokens: 42 },
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute({ prompt: "Say hello" }, context);

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.text).toBe("Hello, world!");
      expect(result.data?.tokensUsed).toBe(42);
      expect(result.data?.model).toBe("gpt-4o");
    });

    it("should pass modelType AIModelType.CHAT to chat()", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "response",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute({ prompt: "test" }, context);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.modelType).toBe(AIModelType.CHAT);
    });
  });

  // --------------------------------------------------------------------------
  // systemPrompt
  // --------------------------------------------------------------------------

  describe("systemPrompt", () => {
    it("should prepend a system message when systemPrompt is provided", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "As requested",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Hello", systemPrompt: "You are a helpful assistant." },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant.",
      });
      expect(callArg.messages[1].role).toBe("user");
    });
  });

  // --------------------------------------------------------------------------
  // context inclusion
  // --------------------------------------------------------------------------

  describe("context inclusion", () => {
    it("should prepend context block to the user message when context is provided", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "result",
        model: "gpt-4o",
      });
      const ctx = createMockContext();
      const extraContext = "Background information here.";

      await tool.execute({ prompt: "Summarize", context: extraContext }, ctx);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      const userContent = callArg.messages[callArg.messages.length - 1].content;
      expect(userContent).toContain(`上下文信息：\n${extraContext}`);
      expect(userContent).toContain("Summarize");
    });
  });

  // --------------------------------------------------------------------------
  // outputFormat
  // --------------------------------------------------------------------------

  describe("outputFormat", () => {
    it("should use outputLength='short' for outputFormat='json'", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "{}",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute({ prompt: "Extract", outputFormat: "json" }, context);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.outputLength).toBe("short");
      const userContent = callArg.messages[callArg.messages.length - 1].content;
      expect(userContent).toContain("JSON");
    });

    it("should use outputLength='long' for outputFormat='markdown'", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "# Title",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Write article", outputFormat: "markdown" },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.outputLength).toBe("long");
    });

    it("should use outputLength='medium' for default outputFormat='text'", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "text result",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute({ prompt: "Explain" }, context);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.outputLength).toBe("medium");
    });
  });

  // --------------------------------------------------------------------------
  // maxTokens / temperature overrides
  // --------------------------------------------------------------------------

  describe("override parameters", () => {
    it("should pass explicit maxTokens to chat()", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "long text",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute({ prompt: "Write a lot", maxTokens: 8000 }, context);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.maxTokens).toBe(8000);
    });

    it("should pass explicit temperature to chat()", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "creative text",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Write creatively", temperature: 0.9 },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.temperature).toBe(0.9);
    });

    it("should not include maxTokens or temperature when they are not provided", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "default output",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute({ prompt: "Simple question" }, context);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(Object.prototype.hasOwnProperty.call(callArg, "maxTokens")).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(callArg, "temperature")).toBe(
        false,
      );
    });
  });

  // --------------------------------------------------------------------------
  // taskProfile
  // --------------------------------------------------------------------------

  describe("taskProfile", () => {
    it("should always pass creativity='medium' in taskProfile", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "result",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute({ prompt: "test" }, context);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.creativity).toBe("medium");
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return false when prompt is whitespace only", () => {
      const valid = tool.validateInput({ prompt: "   " });
      expect(valid).toBe(false);
    });

    it("should return false when prompt is an empty string", () => {
      const valid = tool.validateInput({ prompt: "" });
      expect(valid).toBe(false);
    });

    it("should return true for a valid non-empty prompt", () => {
      const valid = tool.validateInput({ prompt: "Hello" });
      expect(valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return { success: false, text: '' } when chat() throws", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(
        new Error("LLM service unavailable"),
      );
      const context = createMockContext();

      const result = await tool.execute({ prompt: "Will this fail?" }, context);

      // doExecute catches and returns { success: false, text: '' }
      // outer ToolResult wraps it as success:true, data contains error state
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.text).toBe("");
    });
  });
});

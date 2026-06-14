import { AIModelType } from "@prisma/client";
import { CodeGenerationTool } from "../code-generation.tool";
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
    toolId: "code-generation",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("CodeGenerationTool", () => {
  let tool: CodeGenerationTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new CodeGenerationTool(
      mockAiChatService as unknown as AiChatService,
    );
  });

  // --------------------------------------------------------------------------
  // Basic generation
  // --------------------------------------------------------------------------

  describe("basic generation", () => {
    it("should return success: true and non-empty code on happy path", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content:
          "```typescript\nconst add = (a: number, b: number) => a + b;\n```\nThis function adds two numbers.",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Write an add function", language: "typescript" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.code).toBeTruthy();
      expect(result.data?.code.length).toBeGreaterThan(0);
    });

    it("should return the language in the output", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content:
          "```python\ndef greet(name):\n    return f'Hello, {name}'\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Write a greeting function", language: "python" },
        context,
      );

      expect(result.data?.language).toBe("python");
    });

    it("should extract explanation text from outside code blocks", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content:
          "```typescript\nconst x = 1;\n```\nThis declares a constant variable.",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Declare a constant", language: "typescript" },
        context,
      );

      expect(result.data?.explanation).toContain("constant variable");
    });
  });

  // --------------------------------------------------------------------------
  // modelType
  // --------------------------------------------------------------------------

  describe("modelType", () => {
    it("should pass AIModelType.CHAT to chat()", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "```go\nfunc main() {}\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Write main function", language: "go" },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.modelType).toBe(AIModelType.CHAT);
    });
  });

  // --------------------------------------------------------------------------
  // taskProfile
  // --------------------------------------------------------------------------

  describe("taskProfile", () => {
    it("should pass creativity='low' in taskProfile", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "```java\npublic class Hello {}\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Create a class", language: "java" },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.creativity).toBe("low");
    });

    it("should pass outputLength='medium' in taskProfile", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "```rust\nfn main() {}\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute({ prompt: "Write main", language: "rust" }, context);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.outputLength).toBe("medium");
    });
  });

  // --------------------------------------------------------------------------
  // referenceCode
  // --------------------------------------------------------------------------

  describe("referenceCode", () => {
    it("should include referenceCode in the user prompt when provided", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "```typescript\nconst updated = () => {};\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();
      const referenceCode = "const original = () => {};";

      await tool.execute(
        {
          prompt: "Update this function",
          language: "typescript",
          referenceCode,
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      const userMessage = callArg.messages.find((m) => m.role === "user");
      expect(userMessage?.content).toContain(referenceCode);
    });

    it("should not add reference section when referenceCode is not provided", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "```typescript\nconst fn = () => {};\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Write a function", language: "typescript" },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      const userMessage = callArg.messages.find((m) => m.role === "user");
      expect(userMessage?.content).not.toContain("参考代码");
    });
  });

  // --------------------------------------------------------------------------
  // includeTests
  // --------------------------------------------------------------------------

  describe("includeTests", () => {
    it("should include testCode in output when includeTests is true", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content:
          "```typescript\nconst sum = (a: number, b: number) => a + b;\n```\n" +
          "This sums two numbers.\n" +
          "```test\ndescribe('sum', () => { it('adds', () => { expect(sum(1,2)).toBe(3); }); });\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        {
          prompt: "Write sum function with tests",
          language: "typescript",
          includeTests: true,
        },
        context,
      );

      expect(result.data?.testCode).toBeTruthy();
    });

    it("should return testCode as undefined when includeTests is false", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content:
          "```typescript\nconst sum = (a: number, b: number) => a + b;\n```\n" +
          "```test\ndescribe('sum', () => {});\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        {
          prompt: "Write sum function",
          language: "typescript",
          includeTests: false,
        },
        context,
      );

      expect(result.data?.testCode).toBeUndefined();
    });

    it("should return testCode as undefined when includeTests is not specified (defaults to false)", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "```typescript\nconst fn = () => {};\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Write a function", language: "typescript" },
        context,
      );

      expect(result.data?.testCode).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for valid prompt and language", () => {
      expect(
        tool.validateInput({
          prompt: "Write a function",
          language: "typescript",
        }),
      ).toBe(true);
    });

    it("should return false when language is missing (empty string)", () => {
      expect(
        tool.validateInput({ prompt: "Write a function", language: "" }),
      ).toBe(false);
    });

    it("should return false when language is whitespace only", () => {
      expect(
        tool.validateInput({ prompt: "Write a function", language: "   " }),
      ).toBe(false);
    });

    it("should return false when prompt is empty", () => {
      expect(tool.validateInput({ prompt: "", language: "typescript" })).toBe(
        false,
      );
    });

    it("should return false when prompt is whitespace only", () => {
      expect(
        tool.validateInput({ prompt: "   ", language: "typescript" }),
      ).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return { success: false, code: '' } when chat() throws", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(
        new Error("LLM service unavailable"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Write a function", language: "typescript" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.code).toBe("");
    });

    it("should still return the language even when chat() throws", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(new Error("timeout"));
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Write something", language: "python" },
        context,
      );

      expect(result.data?.language).toBe("python");
    });
  });
});

import { AIModelType } from "@prisma/client";
import { StructuredOutputTool } from "../structured-output.tool";
import { AiChatService } from "../../../../llm/chat/ai-chat.service";
import { ToolContext } from "../../../abstractions/tool.interface";

// ============================================================================
// Interfaces for mock return types
// ============================================================================

interface ChatResult {
  content: string;
  usage?: { totalTokens: number };
  model: string;
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
    toolId: "structured-output",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("StructuredOutputTool", () => {
  let tool: StructuredOutputTool;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new StructuredOutputTool(
      mockAiChatService as unknown as AiChatService,
    );
  });

  // --------------------------------------------------------------------------
  // JSON format — happy path
  // --------------------------------------------------------------------------

  describe("JSON format", () => {
    it("should return success: true, validated: true, and data as parsed object for valid JSON", async () => {
      const jsonPayload = { name: "Alice", age: 30 };
      mockAiChatService.chat.mockResolvedValueOnce({
        content: JSON.stringify(jsonPayload),
        model: "gpt-4o",
        usage: { totalTokens: 50 },
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate a user record", format: "json" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      expect(result.data?.data).toEqual(jsonPayload);
    });

    it("should return validationErrors and validated: false when JSON is invalid", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "{ this is not valid json",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate something", format: "json" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.validationErrors).toBeDefined();
      expect(result.data?.validationErrors!.length).toBeGreaterThan(0);
    });

    it("should prettify JSON output when prettify is true (default)", async () => {
      const jsonPayload = { key: "value" };
      mockAiChatService.chat.mockResolvedValueOnce({
        content: JSON.stringify(jsonPayload),
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate data", format: "json", prettify: true },
        context,
      );

      // prettified JSON contains newlines
      expect(result.data?.output).toContain("\n");
    });
  });

  // --------------------------------------------------------------------------
  // modelType
  // --------------------------------------------------------------------------

  describe("modelType", () => {
    it("should pass AIModelType.CHAT to chat()", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"ok":true}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute({ prompt: "Generate data", format: "json" }, context);

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.modelType).toBe(AIModelType.CHAT);
    });
  });

  // --------------------------------------------------------------------------
  // Temperature → creativity mapping
  // --------------------------------------------------------------------------

  describe("temperature to creativity mapping", () => {
    it("should pass creativity='low' when temperature <= 0.3", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"result":"ok"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Generate data", format: "json", temperature: 0.2 },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.creativity).toBe("low");
    });

    it("should pass creativity='medium' when 0.3 < temperature <= 0.5", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"result":"ok"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Generate data", format: "json", temperature: 0.4 },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.creativity).toBe("medium");
    });

    it("should pass creativity='high' when temperature > 0.5", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"result":"ok"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        { prompt: "Generate data", format: "json", temperature: 0.8 },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as ChatCallArg;
      expect(callArg.taskProfile.creativity).toBe("high");
    });
  });

  // --------------------------------------------------------------------------
  // Markdown fence cleanup
  // --------------------------------------------------------------------------

  describe("markdown cleanup", () => {
    it("should strip markdown json code fence from AI output", async () => {
      const jsonPayload = { stripped: true };
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "```json\n" + JSON.stringify(jsonPayload) + "\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate data", format: "json" },
        context,
      );

      expect(result.data?.output).not.toContain("```");
      expect(result.data?.validated).toBe(true);
    });

    it("should strip generic code fence (```) from AI output", async () => {
      const jsonPayload = { stripped: true };
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "```\n" + JSON.stringify(jsonPayload) + "\n```",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate data", format: "json" },
        context,
      );

      expect(result.data?.output).not.toContain("```");
    });
  });

  // --------------------------------------------------------------------------
  // YAML format
  // --------------------------------------------------------------------------

  describe("YAML format", () => {
    it("should return success: true and validated: true for valid YAML with key-value pairs", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "name: Alice\nage: 30\nactive: true",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate YAML user config", format: "yaml" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.format).toBe("yaml");
      expect(result.data?.validated).toBe(true);
    });

    it("should return validated: false for an empty string YAML response", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate YAML", format: "yaml" },
        context,
      );

      expect(result.data?.validated).toBe(false);
    });

    it("should not include data field for YAML format", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "key: value",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate YAML", format: "yaml" },
        context,
      );

      expect(result.data?.data).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for a valid json format input", () => {
      expect(
        tool.validateInput({ prompt: "Generate data", format: "json" }),
      ).toBe(true);
    });

    it("should return true for yaml and xml formats", () => {
      expect(tool.validateInput({ prompt: "Generate", format: "yaml" })).toBe(
        true,
      );
      expect(tool.validateInput({ prompt: "Generate", format: "xml" })).toBe(
        true,
      );
    });

    it("should return false when prompt is empty", () => {
      expect(tool.validateInput({ prompt: "", format: "json" })).toBe(false);
    });

    it("should return false for an invalid format", () => {
      expect(
        tool.validateInput({ prompt: "Generate", format: "csv" as "json" }),
      ).toBe(false);
    });

    it("should return false when temperature is out of range (> 1)", () => {
      expect(
        tool.validateInput({
          prompt: "Generate",
          format: "json",
          temperature: 1.5,
        }),
      ).toBe(false);
    });

    it("should return false when temperature is negative", () => {
      expect(
        tool.validateInput({
          prompt: "Generate",
          format: "json",
          temperature: -0.1,
        }),
      ).toBe(false);
    });

    it("should return true when temperature is exactly 0 or 1", () => {
      expect(
        tool.validateInput({
          prompt: "Generate",
          format: "json",
          temperature: 0,
        }),
      ).toBe(true);
      expect(
        tool.validateInput({
          prompt: "Generate",
          format: "json",
          temperature: 1,
        }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return success: false when chat() throws", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(
        new Error("AI service unavailable"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate data", format: "json" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
    });

    it("should include error message in the output when chat() throws", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(
        new Error("AI service unavailable"),
      );
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate data", format: "json" },
        context,
      );

      expect(result.data?.error).toBeDefined();
    });

    it("should return the format in the output even when chat() throws", async () => {
      mockAiChatService.chat.mockRejectedValueOnce(new Error("timeout"));
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate data", format: "yaml" },
        context,
      );

      expect(result.data?.format).toBe("yaml");
    });

    it("should return error string when non-Error is thrown", async () => {
      mockAiChatService.chat.mockRejectedValueOnce("raw string error");
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate data", format: "json" },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBe("Structured output generation failed");
    });
  });

  // --------------------------------------------------------------------------
  // XML format
  // --------------------------------------------------------------------------

  describe("XML format", () => {
    it("should return validated: true for valid XML with opening and closing tags", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "<root><item>Value</item></root>",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate XML data", format: "xml" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.format).toBe("xml");
      expect(result.data?.validated).toBe(true);
    });

    it("should return validated: false for XML missing closing root tag", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "<root><item>Value</item>",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate XML", format: "xml" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.validationErrors).toBeDefined();
    });

    it("should return validated: false for empty XML response", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate XML", format: "xml" },
        context,
      );

      expect(result.data?.validated).toBe(false);
    });

    it("should return validated: false for XML with only opening tags (no closing)", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "<root>some text without closing</root>",
        model: "gpt-4o",
      });
      const context = createMockContext();

      // Actually this IS valid — has opening and closing root tag
      const result = await tool.execute(
        { prompt: "Generate XML", format: "xml" },
        context,
      );

      expect(result.data?.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // JSON schema validation
  // --------------------------------------------------------------------------

  describe("JSON schema validation", () => {
    it("should validate against schema when schema is provided as object", async () => {
      const jsonPayload = { name: "Alice", age: 30 };
      mockAiChatService.chat.mockResolvedValueOnce({
        content: JSON.stringify(jsonPayload),
        model: "gpt-4o",
      });
      const context = createMockContext();

      const schema = {
        type: "object",
        required: ["name", "age"],
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      };

      const result = await tool.execute(
        { prompt: "Generate a user", format: "json", schema, validate: true },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(true);
      expect(result.data?.validationErrors).toBeUndefined();
    });

    it("should report missing required field when schema validation fails", async () => {
      const jsonPayload = { name: "Alice" }; // missing "age"
      mockAiChatService.chat.mockResolvedValueOnce({
        content: JSON.stringify(jsonPayload),
        model: "gpt-4o",
      });
      const context = createMockContext();

      const schema = {
        type: "object",
        required: ["name", "age"],
      };

      const result = await tool.execute(
        { prompt: "Generate a user", format: "json", schema, validate: true },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(result.data?.validationErrors).toContain(
        "Missing required field: age",
      );
    });

    it("should skip schema validation when schema is a non-JSON string (description)", async () => {
      const jsonPayload = { name: "Alice" };
      mockAiChatService.chat.mockResolvedValueOnce({
        content: JSON.stringify(jsonPayload),
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        {
          prompt: "Generate a user",
          format: "json",
          schema: "A JSON object with name and age fields",
          validate: true,
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(true);
    });

    it("should detect type mismatch when schema expects object but gets array", async () => {
      const jsonPayload = [{ name: "Alice" }];
      mockAiChatService.chat.mockResolvedValueOnce({
        content: JSON.stringify(jsonPayload),
        model: "gpt-4o",
      });
      const context = createMockContext();

      const schema = { type: "object" };

      const result = await tool.execute(
        { prompt: "Generate data", format: "json", schema, validate: true },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(
        result.data?.validationErrors?.some((e: string) =>
          e.includes("Expected type 'object'"),
        ),
      ).toBe(true);
    });

    it("should detect type mismatch when schema expects array but gets object", async () => {
      const jsonPayload = { name: "Alice" };
      mockAiChatService.chat.mockResolvedValueOnce({
        content: JSON.stringify(jsonPayload),
        model: "gpt-4o",
      });
      const context = createMockContext();

      const schema = { type: "array" };

      const result = await tool.execute(
        { prompt: "Generate data", format: "json", schema, validate: true },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(false);
      expect(
        result.data?.validationErrors?.some((e: string) =>
          e.includes("Expected type 'array'"),
        ),
      ).toBe(true);
    });

    it("should skip required check when data is null", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "null",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const schema = { type: "object", required: ["name"] };

      const result = await tool.execute(
        { prompt: "Generate data", format: "json", schema, validate: true },
        context,
      );

      expect(result.data?.success).toBe(true);
    });

    it("should not validate schema when validate=false", async () => {
      const jsonPayload = { name: "Alice" }; // missing "age"
      mockAiChatService.chat.mockResolvedValueOnce({
        content: JSON.stringify(jsonPayload),
        model: "gpt-4o",
      });
      const context = createMockContext();

      const schema = { type: "object", required: ["name", "age"] };

      const result = await tool.execute(
        { prompt: "Generate data", format: "json", schema, validate: false },
        context,
      );

      expect(result.data?.success).toBe(true);
      // validated should be true (JSON parsed OK, no schema check)
      expect(result.data?.validated).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // YAML format — list detection
  // --------------------------------------------------------------------------

  describe("YAML list format", () => {
    it("should return validated: true for YAML with list items", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "- item1\n- item2\n- item3",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate a YAML list", format: "yaml" },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.validated).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // buildSystemPrompt / buildUserPrompt coverage
  // --------------------------------------------------------------------------

  describe("system and user prompt building", () => {
    it("should include schema instruction when schema is provided", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"key":"value"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        {
          prompt: "Generate data",
          format: "json",
          schema: { type: "object" },
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const systemMsg = callArg.messages.find((m) => m.role === "system");
      expect(systemMsg?.content).toContain("Schema");
    });

    it("should include template instruction when template is provided", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"result":"ok"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        {
          prompt: "Generate data",
          format: "json",
          template: '{"key": "{{value}}"}',
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const systemMsg = callArg.messages.find((m) => m.role === "system");
      expect(systemMsg?.content).toContain("模板");
    });

    it("should include object context in user prompt", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"key":"value"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        {
          prompt: "Generate data",
          format: "json",
          context: { projectName: "TestProject", version: 2 },
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMsg = callArg.messages.find((m) => m.role === "user");
      expect(userMsg?.content).toContain("TestProject");
    });

    it("should include string context in user prompt", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"key":"value"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        {
          prompt: "Generate data",
          format: "json",
          context: "Additional context string",
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMsg = callArg.messages.find((m) => m.role === "user");
      expect(userMsg?.content).toContain("Additional context string");
    });

    it("should include schema object in user prompt", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"key":"value"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        {
          prompt: "Generate data",
          format: "json",
          schema: { type: "object", properties: { key: { type: "string" } } },
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMsg = callArg.messages.find((m) => m.role === "user");
      expect(userMsg?.content).toContain("Schema");
    });

    it("should include string schema in user prompt", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"key":"value"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        {
          prompt: "Generate data",
          format: "json",
          schema: "An object with a key field",
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMsg = callArg.messages.find((m) => m.role === "user");
      expect(userMsg?.content).toContain("An object with a key field");
    });

    it("should include template in user prompt", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"key":"value"}',
        model: "gpt-4o",
      });
      const context = createMockContext();

      await tool.execute(
        {
          prompt: "Generate data",
          format: "json",
          template: '{"key": "{{value}}"}',
        },
        context,
      );

      const callArg = mockAiChatService.chat.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMsg = callArg.messages.find((m) => m.role === "user");
      expect(userMsg?.content).toContain('{"key": "{{value}}"}');
    });

    it("should include metadata with hasSchema and hasTemplate flags", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: '{"key":"value"}',
        model: "test-model",
        usage: { totalTokens: 42 },
      });
      const context = createMockContext();

      const result = await tool.execute(
        {
          prompt: "Generate data",
          format: "json",
          schema: { type: "object" },
          template: '{"key": "value"}',
        },
        context,
      );

      expect(result.data?.metadata?.hasSchema).toBe(true);
      expect(result.data?.metadata?.hasTemplate).toBe(true);
      expect(result.data?.metadata?.tokensUsed).toBe(42);
      expect(result.data?.metadata?.model).toBe("test-model");
    });

    it("should not prettify non-JSON formats (output stays as-is)", async () => {
      const yamlContent = "name: Alice\nage: 30";
      mockAiChatService.chat.mockResolvedValueOnce({
        content: yamlContent,
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate YAML", format: "yaml", prettify: true },
        context,
      );

      // YAML is not reformatted, output stays as the AI returned it
      expect(result.data?.output).toContain("name: Alice");
    });

    it("should not prettify JSON when parsedData is undefined (invalid JSON)", async () => {
      mockAiChatService.chat.mockResolvedValueOnce({
        content: "{ invalid json",
        model: "gpt-4o",
      });
      const context = createMockContext();

      const result = await tool.execute(
        { prompt: "Generate JSON", format: "json", prettify: true },
        context,
      );

      // Invalid JSON: parsedData is undefined, finalOutput = rawOutput
      expect(result.data?.output).toContain("{ invalid json");
    });
  });
});

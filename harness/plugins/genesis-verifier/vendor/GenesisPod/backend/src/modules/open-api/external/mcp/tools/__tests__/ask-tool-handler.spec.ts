/**
 * Unit tests for AskToolHandler
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  ...jest.requireActual("@prisma/client"),
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    REASONING: "REASONING",
    VISION: "VISION",
    IMAGE: "IMAGE",
    EMBEDDING: "EMBEDDING",
  },
}));

jest.mock("../tool-timeout", () => ({
  withToolTimeout: jest.fn((promise: Promise<unknown>) => promise),
  TOOL_TIMEOUT_MS: 60_000,
}));

jest.mock("../../../../../../common/config/app.config", () => ({
  APP_CONFIG: {
    brand: {
      name: "GenesisPod",
      fullName: "GenesisPod AI",
    },
  },
}));

jest.mock("../../../../../ai-engine/facade", () => ({
  ChatFacade: jest.fn(),
  RAGFacade: jest.fn(),
}));
jest.mock("../../../../../ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
  RAGFacade: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { AskToolHandler } from "../ask-tool-handler";
import { ChatFacade, RAGFacade } from "../../../../../ai-harness/facade";
import { MCPRequestContext } from "../../abstractions/mcp-server.interface";
import { withToolTimeout } from "../tool-timeout";

const mockContext: MCPRequestContext = {
  apiKeyId: "test-key-id",
  sessionId: "session-123",
};

describe("AskToolHandler", () => {
  let handler: AskToolHandler;
  let mockChatFacade: jest.Mocked<ChatFacade>;
  let mockRagFacade: jest.Mocked<RAGFacade>;

  beforeAll(async () => {
    mockChatFacade = {
      chat: jest.fn(),
    } as unknown as jest.Mocked<ChatFacade>;

    mockRagFacade = {
      search: jest.fn(),
    } as unknown as jest.Mocked<RAGFacade>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AskToolHandler,
        { provide: ChatFacade, useValue: mockChatFacade },
        { provide: RAGFacade, useValue: mockRagFacade },
      ],
    }).compile();

    handler = module.get<AskToolHandler>(AskToolHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (withToolTimeout as jest.Mock).mockImplementation(
      (promise: Promise<unknown>) => promise,
    );
  });

  describe("metadata", () => {
    it("should have toolName = genesis_ask", () => {
      expect(handler.toolName).toBe("genesis_ask");
    });

    it("should have a description string", () => {
      expect(typeof handler.description).toBe("string");
      expect(handler.description.length).toBeGreaterThan(0);
    });

    it("should have inputSchema with required question field", () => {
      expect(handler.inputSchema).toBeDefined();
      expect((handler.inputSchema as Record<string, unknown>).type).toBe(
        "object",
      );
      const schema = handler.inputSchema as {
        required: string[];
        properties: Record<string, unknown>;
      };
      expect(schema.required).toContain("question");
      expect(schema.properties).toHaveProperty("question");
      expect(schema.properties).toHaveProperty("context");
      expect(schema.properties).toHaveProperty("webSearch");
    });
  });

  describe("execute - input validation", () => {
    it("should return error when question is missing", async () => {
      const result = await handler.execute({}, mockContext);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.error).toContain("question");
    });

    it("should return error when question is not a string", async () => {
      const result = await handler.execute({ question: 42 }, mockContext);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.error).toContain("question");
    });

    it("should return error when question is empty string", async () => {
      const result = await handler.execute({ question: "" }, mockContext);

      expect(result.isError).toBe(true);
    });
  });

  describe("execute - successful ask without web search", () => {
    beforeEach(() => {
      mockChatFacade.chat.mockResolvedValue({
        content: "This is the AI answer.",
        model: "gpt-4o",
        tokensUsed: 200,
      } as never);
    });

    it("should return a successful response with answer", async () => {
      const result = await handler.execute(
        { question: "What is quantum computing?" },
        mockContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.answer).toBe("This is the AI answer.");
      expect(parsed.model).toBe("gpt-4o");
      expect(parsed.tokensUsed).toBe(200);
      expect(parsed.webSearchUsed).toBe(false);
    });

    it("should call ChatFacade.chat with correct parameters", async () => {
      await handler.execute(
        { question: "What is quantum computing?" },
        mockContext,
      );

      expect(mockChatFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "What is quantum computing?" }],
          strictMode: true,
        }),
      );
    });

    it("should not call RAGFacade when webSearch is false", async () => {
      await handler.execute(
        { question: "What is AI?", webSearch: false },
        mockContext,
      );

      expect(mockRagFacade.search).not.toHaveBeenCalled();
    });

    it("should include userContext in system prompt when provided", async () => {
      await handler.execute(
        {
          question: "Explain this",
          context: "Background info here",
        },
        mockContext,
      );

      const chatCall = mockChatFacade.chat.mock.calls[0][0];
      expect(chatCall.systemPrompt).toContain("Background info here");
    });

    it("should have no systemPrompt when no context provided", async () => {
      await handler.execute({ question: "Simple question" }, mockContext);

      const chatCall = mockChatFacade.chat.mock.calls[0][0];
      expect(chatCall.systemPrompt).toBeUndefined();
    });
  });

  describe("execute - with web search", () => {
    beforeEach(() => {
      mockChatFacade.chat.mockResolvedValue({
        content: "Answer with web context.",
        model: "gpt-4o",
        tokensUsed: 300,
      } as never);
    });

    it("should call RAGFacade.search when webSearch is true", async () => {
      mockRagFacade.search.mockResolvedValue({
        success: true,
        results: [],
      } as never);

      await handler.execute(
        { question: "Latest news?", webSearch: true },
        mockContext,
      );

      expect(mockRagFacade.search).toHaveBeenCalledWith({
        query: "Latest news?",
        maxResults: 5,
      });
    });

    it("should include search results in system prompt", async () => {
      mockRagFacade.search.mockResolvedValue({
        success: true,
        results: [
          { title: "Article 1", content: "Content 1", url: "https://a.com" },
          { title: "Article 2", content: "Content 2", url: "https://b.com" },
        ],
      } as never);

      await handler.execute(
        { question: "Recent AI news?", webSearch: true },
        mockContext,
      );

      const chatCall = mockChatFacade.chat.mock.calls[0][0];
      expect(chatCall.systemPrompt).toContain("Web search results");
      expect(chatCall.systemPrompt).toContain("Article 1");
      expect(chatCall.systemPrompt).toContain("https://a.com");
    });

    it("should set webSearchUsed = true in response", async () => {
      mockRagFacade.search.mockResolvedValue({
        success: true,
        results: [],
      } as never);

      const result = await handler.execute(
        { question: "Question?", webSearch: true },
        mockContext,
      );

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.webSearchUsed).toBe(true);
    });

    it("should proceed without search context when search returns no results", async () => {
      mockRagFacade.search.mockResolvedValue({
        success: true,
        results: [],
      } as never);

      const result = await handler.execute(
        { question: "What?", webSearch: true },
        mockContext,
      );

      expect(result.isError).toBeUndefined();
      const chatCall = mockChatFacade.chat.mock.calls[0][0];
      expect(chatCall.systemPrompt).toBeUndefined();
    });

    it("should proceed without search context when search fails (success: false)", async () => {
      mockRagFacade.search.mockResolvedValue({
        success: false,
        results: [],
      } as never);

      const result = await handler.execute(
        { question: "What?", webSearch: true },
        mockContext,
      );

      expect(result.isError).toBeUndefined();
    });

    it("should proceed gracefully when RAG search throws", async () => {
      mockRagFacade.search.mockRejectedValue(new Error("RAG unavailable"));

      const result = await handler.execute(
        { question: "Question?", webSearch: true },
        mockContext,
      );

      // Should still call chat without search context
      expect(mockChatFacade.chat).toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
    });
  });

  describe("execute - with both context and web search", () => {
    it("should include both userContext and search results in system prompt", async () => {
      mockRagFacade.search.mockResolvedValue({
        success: true,
        results: [
          { title: "Result", content: "Some content", url: "https://x.com" },
        ],
      } as never);

      mockChatFacade.chat.mockResolvedValue({
        content: "Combined answer",
        model: "gpt-4o",
        tokensUsed: 100,
      } as never);

      await handler.execute(
        {
          question: "Tell me about AI",
          context: "I am a developer",
          webSearch: true,
        },
        mockContext,
      );

      const chatCall = mockChatFacade.chat.mock.calls[0][0];
      expect(chatCall.systemPrompt).toContain("I am a developer");
      expect(chatCall.systemPrompt).toContain("Web search results");
    });
  });

  describe("execute - error handling", () => {
    it("should return error response when chat throws", async () => {
      mockChatFacade.chat.mockRejectedValue(new Error("Chat service error"));

      const result = await handler.execute({ question: "Hello?" }, mockContext);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.error).toBe("Failed to process question");
      expect(parsed.details).toBe("Chat service error");
    });

    it("should handle non-Error throws gracefully", async () => {
      mockChatFacade.chat.mockRejectedValue("string error");

      const result = await handler.execute({ question: "Hello?" }, mockContext);

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.details).toBe("Unknown error");
    });

    it("should use withToolTimeout for the chat call", async () => {
      mockChatFacade.chat.mockResolvedValue({
        content: "answer",
        model: "gpt-4o",
        tokensUsed: 50,
      } as never);

      await handler.execute({ question: "test" }, mockContext);

      expect(withToolTimeout).toHaveBeenCalled();
    });
  });
});

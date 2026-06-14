import { Test, TestingModule } from "@nestjs/testing";
import { TeamsDebateToolHandler } from "../teams-tool-handler";
import { ChatFacade } from "../../../../../ai-harness/facade";

jest.mock("../../../../../ai-engine/facade", () => ({
  ChatFacade: jest.fn(),
}));
jest.mock("../../../../../ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

// Mock the timeout utility
jest.mock("../tool-timeout", () => ({
  withToolTimeout: jest.fn((promise) => promise),
  MULTI_STEP_TIMEOUT_MS: 300000,
}));

describe("TeamsDebateToolHandler", () => {
  let handler: TeamsDebateToolHandler;
  let mockChatFacade: { chat: jest.Mock };

  const mockContext = {
    apiKeyId: "test-api-key",
    sessionId: "test-session-id",
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockChatFacade = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsDebateToolHandler,
        { provide: ChatFacade, useValue: mockChatFacade },
      ],
    }).compile();

    handler = module.get<TeamsDebateToolHandler>(TeamsDebateToolHandler);
  });

  // =========================================================================
  // Tool metadata
  // =========================================================================

  describe("tool metadata", () => {
    it("should have correct toolName", () => {
      expect(handler.toolName).toBe("genesis_team_debate");
    });

    it("should have description", () => {
      expect(handler.description.length).toBeGreaterThan(0);
    });

    it("should have inputSchema requiring topic", () => {
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
      expect(parsed.error).toContain("topic");
    });

    it("should return error when topic is empty string", async () => {
      const result = await handler.execute({ topic: "" }, mockContext);
      expect(result.isError).toBe(true);
    });

    it("should return error when topic is not a string", async () => {
      const result = await handler.execute({ topic: 42 }, mockContext);
      expect(result.isError).toBe(true);
    });
  });

  // =========================================================================
  // Debate execution
  // =========================================================================

  describe("execute - debate", () => {
    const proResponse = "AI is beneficial for society.";
    const conResponse = "AI poses significant risks.";
    const judgmentJson = JSON.stringify({
      winner: "draw",
      confidence: "medium",
      proStrengths: ["Innovation"],
      proWeaknesses: ["Risk"],
      conStrengths: ["Safety"],
      conWeaknesses: ["Progress"],
      keyInsights: ["Balance needed"],
      conclusion: "Both sides have merit",
    });

    beforeEach(() => {
      let callCount = 0;
      mockChatFacade.chat.mockImplementation(async () => {
        callCount++;
        // Alternate between pro, con, and judgment responses
        if (callCount % 3 === 0) {
          return { content: judgmentJson };
        } else if (callCount % 2 === 1) {
          return { content: proResponse };
        } else {
          return { content: conResponse };
        }
      });
    });

    it("should execute single round debate successfully", async () => {
      let callCount = 0;
      mockChatFacade.chat.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { content: proResponse };
        if (callCount === 2) return { content: conResponse };
        return { content: judgmentJson };
      });

      const result = await handler.execute(
        { topic: "Should AI be regulated?", rounds: 1 },
        mockContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.topic).toBe("Should AI be regulated?");
      expect(parsed.rounds).toHaveLength(1);
      expect(parsed.rounds[0].proArgument).toBe(proResponse);
      expect(parsed.rounds[0].conArgument).toBe(conResponse);
    });

    it("should execute default 3 rounds when rounds not specified", async () => {
      let callCount = 0;
      mockChatFacade.chat.mockImplementation(async () => {
        callCount++;
        // 3 rounds * 2 calls + 1 judgment = 7 calls
        if (callCount === 7) return { content: judgmentJson };
        return { content: callCount % 2 === 1 ? proResponse : conResponse };
      });

      const result = await handler.execute(
        { topic: "AI regulation" },
        mockContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.rounds).toHaveLength(3);
    });

    it("should cap rounds at 5", async () => {
      let callCount = 0;
      mockChatFacade.chat.mockImplementation(async () => {
        callCount++;
        if (callCount === 11) return { content: judgmentJson }; // 5 rounds * 2 + 1
        return { content: callCount % 2 === 1 ? proResponse : conResponse };
      });

      await handler.execute(
        { topic: "AI", rounds: 10 }, // Request 10, should cap at 5
        mockContext,
      );

      // 5 rounds * 2 chat calls + 1 judgment = 11 calls
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(11);
    });

    it("should use default 3 rounds when 0 is passed (falsy)", async () => {
      mockChatFacade.chat.mockResolvedValue({ content: proResponse });
      mockChatFacade.chat
        .mockResolvedValueOnce({ content: proResponse })
        .mockResolvedValueOnce({ content: conResponse })
        .mockResolvedValueOnce({ content: proResponse })
        .mockResolvedValueOnce({ content: conResponse })
        .mockResolvedValueOnce({ content: proResponse })
        .mockResolvedValueOnce({ content: conResponse })
        .mockResolvedValueOnce({ content: judgmentJson });

      await handler.execute(
        { topic: "AI", rounds: 0 }, // 0 is falsy, defaults to 3 rounds
        mockContext,
      );

      // 0 || 3 = 3 rounds; 3 rounds * 2 + 1 judgment = 7 calls
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(7);
    });

    it("should include perspective in debate when provided", async () => {
      mockChatFacade.chat
        .mockResolvedValueOnce({ content: proResponse })
        .mockResolvedValueOnce({ content: conResponse })
        .mockResolvedValueOnce({ content: judgmentJson });

      const result = await handler.execute(
        {
          topic: "AI regulation",
          rounds: 1,
          perspective: "economic impact",
        },
        mockContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.perspective).toBe("economic impact");
    });

    it("should set perspective to null when not provided", async () => {
      mockChatFacade.chat
        .mockResolvedValueOnce({ content: proResponse })
        .mockResolvedValueOnce({ content: conResponse })
        .mockResolvedValueOnce({ content: judgmentJson });

      const result = await handler.execute(
        { topic: "AI", rounds: 1 },
        mockContext,
      );

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.perspective).toBeNull();
    });

    it("should handle invalid judgment JSON gracefully", async () => {
      mockChatFacade.chat
        .mockResolvedValueOnce({ content: proResponse })
        .mockResolvedValueOnce({ content: conResponse })
        .mockResolvedValueOnce({ content: "This is not valid JSON" });

      const result = await handler.execute(
        { topic: "AI", rounds: 1 },
        mockContext,
      );

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.judgment.winner).toBe("draw");
      expect(parsed.judgment._parseError).toBe(true);
      expect(parsed.judgment.conclusion).toBe("This is not valid JSON");
    });

    it("should return error when chat facade throws", async () => {
      mockChatFacade.chat.mockRejectedValue(new Error("API error"));

      const result = await handler.execute(
        { topic: "AI", rounds: 1 },
        mockContext,
      );

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.error).toBe("Failed to execute debate");
      expect(parsed.details).toBe("API error");
    });

    it("should include debate history in subsequent rounds", async () => {
      const chatCalls: Array<{
        messages: Array<{ role: string; content: string }>;
      }> = [];

      let callCount = 0;
      mockChatFacade.chat.mockImplementation(async (params) => {
        chatCalls.push(params);
        callCount++;
        if (callCount === 5) return { content: judgmentJson }; // 2 rounds * 2 + 1
        return { content: callCount % 2 === 1 ? proResponse : conResponse };
      });

      await handler.execute({ topic: "AI", rounds: 2 }, mockContext);

      // In round 2, pro messages should include round 1 history
      const round2ProCall = chatCalls[2]; // 3rd call = round 2 pro
      expect(round2ProCall.messages.length).toBeGreaterThan(1);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("error handling", () => {
    it("should wrap non-Error exceptions", async () => {
      mockChatFacade.chat.mockRejectedValue("string error");

      const result = await handler.execute(
        { topic: "AI", rounds: 1 },
        mockContext,
      );

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.details).toBe("Unknown error");
    });
  });
});

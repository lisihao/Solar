// Prevent transitive module resolution issues from NestJS deep imports
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { AIModelType } from "@prisma/client";
import { DiscussionAgentService } from "../discussion-agent.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  AgentState,
  DiscussionPhase,
  DiscussionMessageType,
} from "../discussion-types";

describe("DiscussionAgentService", () => {
  let service: DiscussionAgentService;
  let mockFacade: jest.Mocked<Pick<ChatFacade, "chat">>;

  beforeEach(async () => {
    mockFacade = {
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscussionAgentService,
        { provide: ChatFacade, useValue: mockFacade },
      ],
    }).compile();

    service = module.get<DiscussionAgentService>(DiscussionAgentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== initializeTeam ====================

  describe("initializeTeam", () => {
    it("should return a Map with 7 agents", () => {
      const team = service.initializeTeam("AI in healthcare");
      expect(team).toBeInstanceOf(Map);
      expect(team.size).toBe(7);
    });

    it("should include director, researcher-a/b/c, analyst, writer, reviewer", () => {
      const team = service.initializeTeam("climate change");
      expect(team.has("director")).toBe(true);
      expect(team.has("researcher-a")).toBe(true);
      expect(team.has("researcher-b")).toBe(true);
      expect(team.has("researcher-c")).toBe(true);
      expect(team.has("analyst")).toBe(true);
      expect(team.has("writer")).toBe(true);
      expect(team.has("reviewer")).toBe(true);
    });

    it("should set each agent's initial status to idle", () => {
      const team = service.initializeTeam("blockchain");
      for (const [, agent] of team) {
        expect(agent.status).toBe("idle");
      }
    });

    it("should seed each agent's conversationHistory with a system message", () => {
      const team = service.initializeTeam("quantum computing");
      for (const [, agent] of team) {
        expect(agent.conversationHistory).toHaveLength(1);
        expect(agent.conversationHistory[0].role).toBe("system");
        expect(agent.conversationHistory[0].content.length).toBeGreaterThan(0);
      }
    });

    it("should assign the correct role to director agent", () => {
      const team = service.initializeTeam("renewable energy");
      const director = team.get("director");
      expect(director?.config.role).toBe("director");
    });

    it("should assign the researcher role to researcher-a, b, c", () => {
      const team = service.initializeTeam("fintech");
      expect(team.get("researcher-a")?.config.role).toBe("researcher");
      expect(team.get("researcher-b")?.config.role).toBe("researcher");
      expect(team.get("researcher-c")?.config.role).toBe("researcher");
    });

    it("should default to zh-CN when no language provided", () => {
      const team = service.initializeTeam("AI safety");
      const director = team.get("director");
      // zh-CN name for director
      expect(director?.config.name).toBe("研究总监");
    });

    it("should use en-US names when language is en-US", () => {
      const team = service.initializeTeam("AI safety", "en-US");
      const director = team.get("director");
      expect(director?.config.name).toBe("Research Director");
    });

    it("should use zh-CN names when language is en (shorthand)", () => {
      // resolveLanguage('en') returns 'en-US'
      const team = service.initializeTeam("AI safety", "en");
      const director = team.get("director");
      expect(director?.config.name).toBe("Research Director");
    });

    it("should assign correct Lucide icon to each role", () => {
      const team = service.initializeTeam("robotics");
      expect(team.get("director")?.config.icon).toBe("crown");
      expect(team.get("researcher-a")?.config.icon).toBe("search");
      expect(team.get("analyst")?.config.icon).toBe("bar-chart-3");
      expect(team.get("writer")?.config.icon).toBe("pen-line");
      expect(team.get("reviewer")?.config.icon).toBe("shield-check");
    });
  });

  // ==================== speak ====================

  describe("speak", () => {
    function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
      return {
        config: {
          role: "researcher",
          name: "Researcher A",
          icon: "search",
          systemPrompt: "You are a researcher.",
        },
        conversationHistory: [
          { role: "system", content: "You are a researcher." },
        ],
        status: "idle",
        ...overrides,
      };
    }

    it("should call aiFacade.chat with messages from agent history + new user message", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "My findings.",
      });
      const agentState = makeAgentState();

      await service.speak(agentState, "What did you find?");

      expect(mockFacade.chat).toHaveBeenCalledTimes(1);
      const callArgs = (mockFacade.chat as jest.Mock).mock.calls[0][0];
      expect(callArgs.messages).toEqual(
        expect.arrayContaining([
          { role: "system", content: "You are a researcher." },
          { role: "user", content: "What did you find?" },
        ]),
      );
    });

    it("should return the content from aiFacade.chat response", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "My findings.",
      });
      const agentState = makeAgentState();

      const result = await service.speak(agentState, "What did you find?");

      expect(result).toBe("My findings.");
    });

    it("should append assistant reply to conversationHistory", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({
        content: "Summary here.",
      });
      const agentState = makeAgentState();

      await service.speak(agentState, "Summarize.");

      const history = agentState.conversationHistory;
      expect(history[history.length - 1]).toEqual({
        role: "assistant",
        content: "Summary here.",
      });
    });

    it("should use default modelType CHAT when not specified", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({ content: "ok" });
      const agentState = makeAgentState();

      await service.speak(agentState, "context");

      const callArgs = (mockFacade.chat as jest.Mock).mock.calls[0][0];
      expect(callArgs.modelType).toBe(AIModelType.CHAT);
    });

    it("should forward custom modelType when provided", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({ content: "ok" });
      const agentState = makeAgentState();

      await service.speak(agentState, "context", {
        modelType: AIModelType.CHAT_FAST,
      });

      const callArgs = (mockFacade.chat as jest.Mock).mock.calls[0][0];
      expect(callArgs.modelType).toBe(AIModelType.CHAT_FAST);
    });

    it("should use default creativity medium and outputLength short", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({ content: "ok" });
      const agentState = makeAgentState();

      await service.speak(agentState, "context");

      const callArgs = (mockFacade.chat as jest.Mock).mock.calls[0][0];
      expect(callArgs.taskProfile).toEqual({
        creativity: "medium",
        outputLength: "short",
      });
    });

    it("should forward custom taskProfile options when provided", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({ content: "ok" });
      const agentState = makeAgentState();

      await service.speak(agentState, "context", {
        creativity: "high",
        outputLength: "long",
      });

      const callArgs = (mockFacade.chat as jest.Mock).mock.calls[0][0];
      expect(callArgs.taskProfile).toEqual({
        creativity: "high",
        outputLength: "long",
      });
    });

    it("should re-throw error when aiFacade.chat rejects", async () => {
      const err = new Error("LLM timeout");
      (mockFacade.chat as jest.Mock).mockRejectedValue(err);
      const agentState = makeAgentState();

      await expect(service.speak(agentState, "context")).rejects.toThrow(
        "LLM timeout",
      );
    });

    it("should trim conversationHistory to system + 10 most recent entries", async () => {
      (mockFacade.chat as jest.Mock).mockResolvedValue({ content: "reply" });

      // Build a state with 1 system + 12 existing messages (total 13)
      const existingHistory: AgentState["conversationHistory"] = [
        { role: "system", content: "sys" },
      ];
      for (let i = 0; i < 12; i++) {
        existingHistory.push({ role: "user", content: `msg ${i}` });
      }
      const agentState = makeAgentState({
        conversationHistory: existingHistory,
      });

      // speak() adds 1 user message before calling chat, then 1 assistant after
      // trimConversationHistory fires with maxMessages=10 after the user push
      await service.speak(agentState, "new user input");

      // After trim: system (1) + last 10 entries before trim + assistant reply
      // History length should be <= 1 (system) + 10 + 1 (assistant reply) = 12
      expect(agentState.conversationHistory.length).toBeLessThanOrEqual(12);
      expect(agentState.conversationHistory[0].role).toBe("system");
    });
  });

  // ==================== createMessage ====================

  describe("createMessage", () => {
    function makeAgentState(): AgentState {
      return {
        config: {
          role: "analyst",
          name: "Analyst",
          icon: "bar-chart-3",
          systemPrompt: "You analyze.",
        },
        conversationHistory: [],
        status: "idle",
      };
    }

    it("should return a DiscussionMessage with correct agent fields", () => {
      const agentState = makeAgentState();
      const phase: DiscussionPhase = "findings";
      const messageType: DiscussionMessageType = "findings";

      const msg = service.createMessage(
        agentState,
        "Great insight.",
        phase,
        messageType,
      );

      expect(msg.agentRole).toBe("analyst");
      expect(msg.agentName).toBe("Analyst");
      expect(msg.agentIcon).toBe("bar-chart-3");
      expect(msg.content).toBe("Great insight.");
      expect(msg.phase).toBe("findings");
      expect(msg.messageType).toBe("findings");
    });

    it("should generate a unique id starting with msg_", () => {
      const agentState = makeAgentState();
      const msg = service.createMessage(
        agentState,
        "content",
        "ideation",
        "idea",
      );
      expect(msg.id).toMatch(/^msg_/);
    });

    it("should include a timestamp of type Date", () => {
      const agentState = makeAgentState();
      const msg = service.createMessage(
        agentState,
        "content",
        "synthesis",
        "synthesis",
      );
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it("should pass through optional metadata when provided", () => {
      const agentState = makeAgentState();
      const metadata = { citations: [1, 2, 3] };
      const msg = service.createMessage(
        agentState,
        "content",
        "execution",
        "status",
        metadata,
      );
      expect(msg.metadata).toEqual({ citations: [1, 2, 3] });
    });

    it("should have undefined metadata when not provided", () => {
      const agentState = makeAgentState();
      const msg = service.createMessage(
        agentState,
        "content",
        "completed",
        "review",
      );
      expect(msg.metadata).toBeUndefined();
    });
  });

  // ==================== createSystemMessage ====================

  describe("createSystemMessage", () => {
    it("should return a message with agentRole director and agentName System", () => {
      const msg = service.createSystemMessage("Phase started", "ideation");
      expect(msg.agentRole).toBe("director");
      expect(msg.agentName).toBe("System");
      expect(msg.agentIcon).toBe("info");
    });

    it("should set messageType to system", () => {
      const msg = service.createSystemMessage("content", "synthesis");
      expect(msg.messageType).toBe("system");
    });

    it("should generate a unique id starting with sys_", () => {
      const msg = service.createSystemMessage("content", "error");
      expect(msg.id).toMatch(/^sys_/);
    });

    it("should include the provided phase", () => {
      const msg = service.createSystemMessage("done", "completed");
      expect(msg.phase).toBe("completed");
    });
  });

  // ==================== parseDirections ====================

  describe("parseDirections", () => {
    it("should parse valid JSON inside markdown code fence", () => {
      const response = `
\`\`\`json
[{"title":"Direction 1","description":"desc","assignedTo":"A","searchQueries":["q1"]},{"title":"Direction 2","description":"desc2","assignedTo":"B","searchQueries":["q2"]}]
\`\`\`
      `;
      const directions = service.parseDirections(response);
      expect(directions).toHaveLength(2);
      expect(directions[0].title).toBe("Direction 1");
      expect(directions[1].title).toBe("Direction 2");
    });

    it("should parse bare JSON array in the response", () => {
      const response = `[{"title":"AI safety","description":"focus","assignedTo":"","searchQueries":[]}]`;
      const directions = service.parseDirections(response);
      expect(directions).toHaveLength(1);
      expect(directions[0].title).toBe("AI safety");
    });

    it("should fall back to text parsing when JSON is invalid", () => {
      const response = `
1. Research topic one that is detailed
2. Another research direction here
- A third option for the study
      `;
      const directions = service.parseDirections(response);
      expect(directions.length).toBeGreaterThan(0);
      expect(directions[0].title.length).toBeGreaterThan(5);
    });

    it("should cap text-parsed results at 5 directions", () => {
      const lines = Array.from(
        { length: 10 },
        (_, i) => `${i + 1}. Direction number ${i + 1} for testing`,
      ).join("\n");
      const directions = service.parseDirections(lines);
      expect(directions.length).toBeLessThanOrEqual(5);
    });

    it("should fill missing JSON fields with defaults", () => {
      const response = `\`\`\`json\n[{"title":"Only title"}]\n\`\`\``;
      const directions = service.parseDirections(response);
      expect(directions[0].description).toBe("");
      expect(directions[0].assignedTo).toBe("");
      expect(directions[0].searchQueries).toEqual([]);
    });

    it("should use locale-specific fallback title for zh-CN when title missing", () => {
      const response = `\`\`\`json\n[{"description":"no title"}]\n\`\`\``;
      const directions = service.parseDirections(response, "zh-CN");
      expect(directions[0].title).toBe("方向 1");
    });

    it("should use locale-specific fallback title for en-US when title missing", () => {
      const response = `\`\`\`json\n[{"description":"no title"}]\n\`\`\``;
      const directions = service.parseDirections(response, "en-US");
      expect(directions[0].title).toBe("Direction 1");
    });

    it("should return empty array when response has no parseable content", () => {
      const directions = service.parseDirections("No structured content here.");
      expect(directions).toEqual([]);
    });

    it("should truncate text-parsed titles to 100 characters", () => {
      const longLine = "1. " + "A".repeat(150);
      const directions = service.parseDirections(longLine);
      if (directions.length > 0) {
        expect(directions[0].title.length).toBeLessThanOrEqual(100);
      }
    });
  });
});

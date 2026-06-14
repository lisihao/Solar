/**
 * ContextRouterService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ContextRouterService } from "../context-router.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import {
  AgentFacade,
  UserIntent,
  ContextStrategy,
} from "@/modules/ai-harness/facade";

const mockMessages = [
  {
    id: "msg-1",
    content: "Hello world",
    senderId: "user-1",
    aiMemberId: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    sender: { username: "user1", fullName: "User One" },
    aiMember: null,
  },
  {
    id: "msg-2",
    content: "AI response here",
    senderId: null,
    aiMemberId: "ai-1",
    createdAt: new Date("2024-01-01T00:01:00Z"),
    sender: null,
    aiMember: { displayName: "AI Assistant" },
  },
];

const mockDebateMessage = {
  id: "msg-debate",
  content: "辩论主题：AI vs Human\n我方立场：正方\n核心论点：1. AI is better",
  senderId: null,
  aiMemberId: "ai-debate",
  createdAt: new Date("2024-01-01T00:02:00Z"),
  sender: null,
  aiMember: { displayName: "Debater" },
};

describe("ContextRouterService", () => {
  let service: ContextRouterService;
  let prisma: { topicMessage: { findMany: jest.Mock } };
  let aiFacade: { intentDetector: { detectIntent: jest.Mock } | null }; // shape matches AgentFacade.intentDetector

  beforeEach(async () => {
    prisma = {
      topicMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    aiFacade = {
      intentDetector: {
        detectIntent: jest.fn().mockReturnValue({
          intent: UserIntent.GENERAL_CHAT,
          strategy: ContextStrategy.STANDARD,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextRouterService,
        { provide: PrismaService, useValue: prisma },
        { provide: AgentFacade, useValue: aiFacade },
      ],
    }).compile();

    service = module.get<ContextRouterService>(ContextRouterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("routeContext", () => {
    it("should return context route result with STANDARD strategy", async () => {
      prisma.topicMessage.findMany.mockResolvedValue(mockMessages);

      const result = await service.routeContext("topic-1", "Hello", []);

      expect(result).toHaveProperty("intent");
      expect(result).toHaveProperty("strategy");
      expect(result).toHaveProperty("context");
      expect(result).toHaveProperty("systemPromptAddition");
    });

    it("should handle ISOLATED strategy - returns empty context", async () => {
      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.GENERAL_CHAT,
        strategy: ContextStrategy.ISOLATED,
      });

      const result = await service.routeContext("topic-1", "Hello", []);

      expect(result.context).toHaveLength(0);
    });

    it("should handle REFERENCE_RECENT strategy", async () => {
      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.SUMMARIZE,
        strategy: ContextStrategy.REFERENCE_RECENT,
      });
      prisma.topicMessage.findMany.mockResolvedValue([
        ...mockMessages,
        mockDebateMessage,
      ]);

      const result = await service.routeContext(
        "topic-1",
        "Summarize this",
        [],
      );

      expect(result.strategy).toBe(ContextStrategy.REFERENCE_RECENT);
      expect(Array.isArray(result.context)).toBe(true);
    });

    it("should handle RELEVANCE_BASED strategy - falls back to standard", async () => {
      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.GENERAL_CHAT,
        strategy: ContextStrategy.RELEVANCE_BASED,
      });
      prisma.topicMessage.findMany.mockResolvedValue(mockMessages);

      const result = await service.routeContext("topic-1", "Hello", []);

      expect(Array.isArray(result.context)).toBe(true);
    });

    it("should fallback to GENERAL_CHAT intent when intentDetector is unavailable", async () => {
      aiFacade.intentDetector = null;
      prisma.topicMessage.findMany.mockResolvedValue([]);

      const result = await service.routeContext("topic-1", "Hello", []);

      expect(result.intent).toBe(UserIntent.GENERAL_CHAT);
    });

    it('should build context from messages correctly - user messages as "user" role', async () => {
      prisma.topicMessage.findMany.mockResolvedValue([
        {
          id: "msg-user",
          content: "User message",
          senderId: "user-1",
          aiMemberId: null,
          createdAt: new Date(),
          sender: { username: "user1", fullName: null },
          aiMember: null,
        },
      ]);

      const result = await service.routeContext("topic-1", "Hello", []);
      const context = result.context;

      if (context.length > 0) {
        const userMsg = context.find((m) => m.role === "user");
        expect(userMsg).toBeDefined();
      }
    });

    it('should build context from AI messages as "assistant" role', async () => {
      prisma.topicMessage.findMany.mockResolvedValue([
        {
          id: "msg-ai",
          content: "AI response",
          senderId: null,
          aiMemberId: "ai-1",
          createdAt: new Date(),
          sender: null,
          aiMember: { displayName: "Assistant" },
        },
      ]);

      const result = await service.routeContext("topic-1", "Hello", []);
      const context = result.context;

      if (context.length > 0) {
        const aiMsg = context.find((m) => m.role === "assistant");
        expect(aiMsg).toBeDefined();
      }
    });

    it("should filter debate messages in STANDARD strategy", async () => {
      prisma.topicMessage.findMany.mockResolvedValue([
        mockDebateMessage,
        ...mockMessages,
      ]);

      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.GENERAL_CHAT,
        strategy: ContextStrategy.STANDARD,
      });

      const result = await service.routeContext("topic-1", "Hello", []);

      // Debate messages from AI should be filtered in STANDARD strategy
      const hasDebateMsg = result.context.some((m) =>
        m.content.includes("辩论主题"),
      );
      expect(hasDebateMsg).toBe(false);
    });

    it("should include debate messages in REFERENCE_RECENT strategy", async () => {
      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.SUMMARIZE,
        strategy: ContextStrategy.REFERENCE_RECENT,
      });
      prisma.topicMessage.findMany.mockResolvedValue([mockDebateMessage]);

      const result = await service.routeContext("topic-1", "Summarize", []);

      // Debate messages are included but summarized
      expect(result.context.length).toBeGreaterThan(0);
      const debateMsg = result.context.find((m) => m.isDebateMessage);
      expect(debateMsg).toBeDefined();
    });
  });

  describe("generateSystemPromptAddition", () => {
    it("should generate SUMMARIZE prompt addition", async () => {
      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.SUMMARIZE,
        strategy: ContextStrategy.STANDARD,
      });
      prisma.topicMessage.findMany.mockResolvedValue([]);

      const result = await service.routeContext("topic-1", "Summarize", []);

      expect(result.systemPromptAddition).toContain("总结");
    });

    it("should generate GENERATE prompt addition", async () => {
      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.GENERATE,
        strategy: ContextStrategy.STANDARD,
      });
      prisma.topicMessage.findMany.mockResolvedValue([]);

      const result = await service.routeContext(
        "topic-1",
        "Generate image",
        [],
      );

      expect(result.systemPromptAddition).toContain("图片");
    });

    it("should generate ANALYZE prompt addition", async () => {
      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.ANALYZE,
        strategy: ContextStrategy.STANDARD,
      });
      prisma.topicMessage.findMany.mockResolvedValue([]);

      const result = await service.routeContext("topic-1", "Analyze", []);

      expect(result.systemPromptAddition).toContain("分析");
    });

    it("should generate GENERAL_CHAT prompt addition", async () => {
      aiFacade.intentDetector!.detectIntent.mockReturnValue({
        intent: UserIntent.GENERAL_CHAT,
        strategy: ContextStrategy.STANDARD,
      });
      prisma.topicMessage.findMany.mockResolvedValue([]);

      const result = await service.routeContext("topic-1", "Hello", []);

      expect(result.systemPromptAddition).toContain("普通对话");
    });
  });
});

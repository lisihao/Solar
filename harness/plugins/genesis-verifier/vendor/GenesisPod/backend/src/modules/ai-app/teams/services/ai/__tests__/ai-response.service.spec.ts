/**
 * AiResponseService Unit Tests
 *
 * Tests for AI response generation including:
 * - buildSmartContext: smart context assembly
 * - generateAIResponse: full response generation
 * - extractUrls: URL extraction from text
 * - isMissionMessage filtering
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { AiResponseService } from "../ai-response.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { ChatFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { ContextRouterService } from "../context-router.service";
import { TopicContextRetrievalService } from "../topic-context-retrieval.service";
import { TeamMemberAgent } from "../../../agents";
import { TopicEventEmitterService } from "../../events";
import { CreditsService } from "../../../../../platform/credits/credits.service";
import { MetricsService } from "@/modules/platform/monitoring";
import { AuditService } from "../../../../../../common/audit";
import { MessageContentType } from "@prisma/client";

// ============================================================
// Helpers
// ============================================================

const makeMessage = (overrides: Record<string, unknown> = {}) => ({
  id: `msg-${Math.random().toString(36).slice(2)}`,
  topicId: "topic-1",
  content: "Hello, this is a test message.",
  senderId: null,
  aiMemberId: "ai-1",
  createdAt: new Date(),
  deletedAt: null,
  contentType: MessageContentType.TEXT,
  sender: null,
  aiMember: { displayName: "Agent One" },
  mentions: [],
  replyTo: null,
  parsedUrls: null,
  ...overrides,
});

const makeAIMember = (overrides: Record<string, unknown> = {}) => ({
  id: "ai-1",
  aiModel: "gpt-4o",
  displayName: "Agent One",
  avatar: null,
  roleDescription: "Research assistant",
  systemPrompt: "You are a helpful assistant",
  contextWindow: 10,
  capabilities: [],
  canMentionOtherAI: true,
  collaborationStyle: "COOPERATIVE",
  topicId: "topic-1",
  ...overrides,
});

// ============================================================
// Mocks
// ============================================================

const mockPrisma = {
  topicMessage: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  topicAIMember: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  topic: {
    findUnique: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
  },
  topicResource: {
    findMany: jest.fn(),
  },
};

const mockAiFacade = {
  chat: jest
    .fn()
    .mockResolvedValue({ content: "AI response here", tokensUsed: 200 }),
  embed: jest.fn().mockResolvedValue([0.1, 0.2]),
  getModelById: jest.fn().mockResolvedValue({
    modelId: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
  }),
  getAvailableModelsExtended: jest.fn().mockResolvedValue([]),
};

const mockToolRegistry = {
  tryGet: jest.fn().mockReturnValue(null),
  execute: jest.fn(),
};

const mockContextRouter = {
  getStrategy: jest.fn().mockResolvedValue("NONE"),
  buildContext: jest.fn().mockResolvedValue(""),
  routeContext: jest.fn().mockResolvedValue({
    strategy: "NONE",
    additionalContext: "",
    shouldSearch: false,
  }),
};

const mockTeamMemberAgent = {
  generateResponse: jest.fn().mockResolvedValue("Agent response"),
  inferRoleFromDescription: jest.fn().mockReturnValue("assistant"),
  buildSystemPrompt: jest.fn().mockReturnValue("System prompt"),
  getCapabilityContext: jest.fn().mockReturnValue({ tools: [] }),
  resolveTools: jest.fn().mockReturnValue([]),
  buildAgentPrompt: jest.fn().mockReturnValue("Agent prompt"),
  formatMessage: jest
    .fn()
    .mockReturnValue({ role: "assistant", content: "Response" }),
};

const mockTopicEventEmitter = {
  emitToTopic: jest.fn(),
};

const mockCreditsService = {
  checkBalance: jest
    .fn()
    .mockResolvedValue({ sufficient: true, balance: 1000 }),
  deductCredits: jest.fn().mockResolvedValue(undefined),
};

const mockMetricsService = {
  recordMetric: jest.fn(),
  recordAIResponseError: jest.fn(),
  recordAIResponse: jest.fn(),
  recordLatency: jest.fn(),
};

const mockAuditService = {
  log: jest.fn(),
  logAIResponseGenerate: jest.fn().mockResolvedValue(undefined),
};

// ============================================================
// Test suite
// ============================================================

describe("AiResponseService", () => {
  let service: AiResponseService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mocks
    mockPrisma.topicMessage.findMany.mockResolvedValue([]);
    mockPrisma.topicMessage.create.mockResolvedValue({
      id: "msg-1",
      content: "AI response here",
      topicId: "topic-1",
      aiMemberId: "ai-1",
      senderId: null,
      contentType: MessageContentType.TEXT,
      createdAt: new Date(),
    });
    mockPrisma.topicAIMember.findFirst.mockResolvedValue(makeAIMember());
    mockPrisma.topicAIMember.findMany.mockResolvedValue([]);
    mockPrisma.topic.findUnique.mockResolvedValue({
      id: "topic-1",
      name: "Test Topic",
      description: "A topic",
    });
    mockPrisma.topicResource.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiResponseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: ToolFacade, useValue: mockAiFacade },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: ContextRouterService, useValue: mockContextRouter },
        { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
        { provide: TopicEventEmitterService, useValue: mockTopicEventEmitter },
        { provide: TopicContextRetrievalService, useValue: null },
        { provide: CreditsService, useValue: mockCreditsService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<AiResponseService>(AiResponseService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // buildSmartContext
  // ============================================================

  describe("buildSmartContext", () => {
    it("should return empty result when no messages exist", async () => {
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([]);

      const result = await service.buildSmartContext("topic-1", "ai-1");

      expect(result.messages).toEqual([]);
      expect(result.summary).toBeNull();
      expect(result.parsedUrlsContext).toBe("");
    });

    it("should filter out mission system messages", async () => {
      const missionMessage = makeMessage({
        content: "[任务分解]\n\n请执行以下任务...",
      });
      const normalMessage = makeMessage({
        content: "What is AI?",
        senderId: "user-1",
      });

      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
        missionMessage,
        normalMessage,
      ]);

      const result = await service.buildSmartContext("topic-1", "ai-1");

      // Only the normal message should be in the context
      expect(
        result.messages.every((m) => !m.content.includes("[任务分解]")),
      ).toBe(true);
    });

    it("should filter out [工作汇报] messages", async () => {
      const reportMessage = makeMessage({
        content: "[工作汇报] 任务完成度 50%",
      });
      const normalMessage = makeMessage({
        content: "Good progress!",
        senderId: "user-1",
      });

      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
        reportMessage,
        normalMessage,
      ]);

      const result = await service.buildSmartContext("topic-1", "ai-1");

      expect(
        result.messages.every((m) => !m.content.includes("[工作汇报]")),
      ).toBe(true);
    });

    it("should return all normal messages when count is under maxMessages", async () => {
      const messages = Array.from({ length: 5 }, (_, i) =>
        makeMessage({
          content: `Message ${i + 1}`,
          senderId: "user-1",
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(messages);

      const result = await service.buildSmartContext("topic-1", "ai-1", 10);

      expect(result.messages).toHaveLength(5);
    });

    it("should score messages mentioning current AI member higher", async () => {
      const mentionMessage = makeMessage({
        content: "Great work!",
        mentions: [{ aiMemberId: "ai-1", userId: null, mentionType: "DIRECT" }],
        createdAt: new Date(2025, 0, 1),
      });
      const unrelatedMessage = makeMessage({
        content: "Hello everyone",
        mentions: [],
        createdAt: new Date(2025, 0, 2),
      });

      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
        mentionMessage,
        unrelatedMessage,
      ]);

      const result = await service.buildSmartContext("topic-1", "ai-1", 1);

      // With maxMessages=1, the mention message should be selected
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("Great work!");
    });

    it("should always include the latest user message", async () => {
      // Create many AI messages + one user message at the end
      const aiMessages = Array.from({ length: 15 }, (_, i) =>
        makeMessage({
          id: `ai-msg-${i}`,
          content: `AI message ${i}`,
          aiMemberId: "ai-2",
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      const userMessage = makeMessage({
        id: "user-msg-1",
        content: "User question here?",
        senderId: "user-1",
        aiMemberId: null,
        createdAt: new Date(2025, 0, 20),
      });

      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
        ...aiMessages,
        userMessage,
      ]);

      const result = await service.buildSmartContext("topic-1", "ai-1", 5);

      // User message should be force-included
      const userMsgInContext = result.messages.find(
        (m) => m.id === "user-msg-1",
      );
      expect(userMsgInContext).toBeDefined();
    });

    it("should generate summary when many messages are dropped", async () => {
      // Create 20 messages (10 more than maxMessages=10)
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMessage({
          id: `msg-${i}`,
          content: `This is message number ${i} with sufficient content length here.`,
          senderId: i % 3 === 0 ? "user-1" : null,
          aiMember: { displayName: `Agent ${i % 2 === 0 ? "A" : "B"}` },
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(messages);

      const result = await service.buildSmartContext("topic-1", "ai-1", 10);

      // 10 dropped (> 5 threshold) -> summary should be generated
      expect(result.summary).not.toBeNull();
      expect(result.summary).toContain("Earlier discussion");
    });

    it("should prioritize debate opponent messages in debate mode", async () => {
      const opponentMessage = makeMessage({
        id: "opp-msg-1",
        content: "My debate argument",
        aiMemberId: "opponent-1",
        createdAt: new Date(2025, 0, 1),
      });
      const otherMessage = makeMessage({
        id: "other-msg-1",
        content: "Other message",
        aiMemberId: "ai-3",
        createdAt: new Date(2025, 0, 2),
      });

      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
        opponentMessage,
        otherMessage,
      ]);

      const result = await service.buildSmartContext(
        "topic-1",
        "ai-1",
        1,
        "opponent-1",
      );

      // Opponent message should win scoring
      expect(result.messages[0].aiMemberId).toBe("opponent-1");
    });

    it("should include parsedUrls context when URLs exist in messages", async () => {
      const msgWithUrl = makeMessage({
        content: "Check this URL",
        parsedUrls: [
          {
            url: "https://example.com",
            preview: { title: "Example", description: "An example site" },
            extractedContent: { fullText: "Full content here" },
          },
        ],
      });

      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([msgWithUrl]);

      const result = await service.buildSmartContext("topic-1", "ai-1");

      expect(result.parsedUrlsContext).toContain("https://example.com");
    });
  });

  // ============================================================
  // extractUrls (private method tested via cast)
  // ============================================================

  describe("extractUrls", () => {
    it("should extract HTTP URLs from text", () => {
      const text =
        "Visit http://example.com and https://test.org for more info";

      const result = (
        service as unknown as { extractUrls: (t: string) => string[] }
      ).extractUrls(text);

      expect(result).toContain("http://example.com");
      expect(result).toContain("https://test.org");
    });

    it("should return empty array when no URLs exist", () => {
      const result = (
        service as unknown as { extractUrls: (t: string) => string[] }
      ).extractUrls("No URLs here");

      expect(result).toEqual([]);
    });

    it("should deduplicate URLs", () => {
      const text = "https://example.com https://example.com https://other.com";

      const result = (
        service as unknown as { extractUrls: (t: string) => string[] }
      ).extractUrls(text);

      const exampleCount = result.filter(
        (u) => u === "https://example.com",
      ).length;
      expect(exampleCount).toBe(1);
    });
  });

  // ============================================================
  // generateAIResponse
  // ============================================================

  describe("generateAIResponse", () => {
    it("should throw NotFoundException when AI member not found", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.generateAIResponse("topic-1", "user-1", "nonexistent-ai", []),
      ).rejects.toThrow(NotFoundException);
    });

    it("should check credit balance before generating response", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(mockCreditsService.checkBalance).toHaveBeenCalledWith(
        "user-1",
        30,
      );
    });

    it("should throw when user has insufficient credits", async () => {
      mockCreditsService.checkBalance.mockResolvedValueOnce({
        sufficient: false,
        balance: 10,
      });

      await expect(
        service.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).rejects.toThrow();
    });

    it("should call AI facade chat to generate response", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "This is the AI response",
        tokensUsed: 150,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("should build debate prompt when debateRole is provided", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Debate response",
        tokensUsed: 100,
      });

      const debateRole = {
        role: "red" as const,
        opponent: { id: "opponent-1", displayName: "Opponent Bot" },
        topic: "Should AI replace humans?",
      };

      await service.generateAIResponse(
        "topic-1",
        "user-1",
        "ai-1",
        [],
        debateRole,
      );

      // AI should be called with debate-specific prompt
      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
          ]),
        }),
      );
    });

    it("should include resource context in AI prompt when resources exist", async () => {
      // Use AI member without a systemPrompt so resource context is included in the generated prompt
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ systemPrompt: null }),
      );
      mockPrisma.topicResource.findMany.mockResolvedValueOnce([
        {
          name: "Research Paper",
          resource: {
            title: "AI in Healthcare",
            abstract: "This paper covers AI applications in medical diagnosis.",
            sourceUrl: "https://arxiv.org/paper",
            type: "ARTICLE",
          },
        },
      ]);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response with context",
        tokensUsed: 200,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      // Resources are included in the system prompt when no custom systemPrompt is set
      const allContent = chatCall.messages
        .map((m: { content: string }) => m.content)
        .join("\n");
      expect(allContent).toContain("AI in Healthcare");
    });

    it("should respect contextWindow limit from AI member config", async () => {
      const limitedMember = makeAIMember({ contextWindow: 3 });
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(limitedMember);

      const manyMessages = Array.from({ length: 20 }, () =>
        makeMessage({ content: "A normal message", senderId: "user-1" }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(manyMessages);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      // buildSmartContext should be called with Math.min(contextWindow, MAX_CONTEXT_MESSAGES)
      // We can verify by checking no more than 10 messages ended up in the prompt
      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("should attempt web fetch for URLs in recent user messages", async () => {
      const userMessageWithUrl = makeMessage({
        content: "Check this: https://example.com/article",
        senderId: "user-1",
        aiMemberId: null,
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
        userMessageWithUrl,
      ]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());

      const mockWebFetchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { content: "Article content", title: "Article Title" },
        }),
      };
      mockToolRegistry.tryGet.mockReturnValueOnce(mockWebFetchTool);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-fetch");
    });

    it("should work when credit service is not available", async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: mockAiFacade },
          { provide: ToolFacade, useValue: mockAiFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          { provide: ContextRouterService, useValue: mockContextRouter },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          { provide: TopicContextRetrievalService, useValue: null },
          { provide: CreditsService, useValue: null },
          { provide: MetricsService, useValue: null },
          { provide: AuditService, useValue: null },
        ],
      }).compile();

      const serviceWithoutCredits =
        module.get<AiResponseService>(AiResponseService);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      // Should not throw even without CreditsService
      await expect(
        serviceWithoutCredits.generateAIResponse(
          "topic-1",
          "user-1",
          "ai-1",
          [],
        ),
      ).resolves.not.toThrow();
    });
  });

  // ============================================================
  // createAIMessage
  // ============================================================

  describe("createAIMessage", () => {
    it("creates a topic message with the provided content", async () => {
      const createdMessage = {
        id: "ai-msg-1",
        content: "AI generated content",
        topicId: "topic-1",
        aiMemberId: "ai-1",
      };
      mockPrisma.topicMessage.create.mockResolvedValueOnce(createdMessage);

      const result = await service.createAIMessage(
        "topic-1",
        "ai-1",
        "AI generated content",
        "gpt-4o",
        150,
      );

      expect(mockPrisma.topicMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            aiMemberId: "ai-1",
            content: "AI generated content",
            modelUsed: "gpt-4o",
            tokensUsed: 150,
          }),
        }),
      );
      expect(result).toEqual(createdMessage);
    });

    it("defaults tokensUsed to 0 when not provided", async () => {
      mockPrisma.topicMessage.create.mockResolvedValueOnce({
        id: "ai-msg-2",
        content: "test",
      });

      await service.createAIMessage("topic-1", "ai-1", "test", "gpt-4o");

      expect(mockPrisma.topicMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tokensUsed: 0 }),
        }),
      );
    });

    it("updates topic updatedAt after creating message", async () => {
      mockPrisma.topicMessage.create.mockResolvedValueOnce({
        id: "ai-msg-3",
        content: "test",
      });

      await service.createAIMessage("topic-1", "ai-1", "test", "gpt-4o");

      expect(mockPrisma.topic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "topic-1" },
          data: expect.objectContaining({ updatedAt: expect.any(Date) }),
        }),
      );
    });
  });

  // ============================================================
  // parseAIMentionsFromContent
  // ============================================================

  describe("parseAIMentionsFromContent", () => {
    it("returns empty array when no AI members exist", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValueOnce([]);

      const result = await service.parseAIMentionsFromContent(
        "topic-1",
        "Hello @Bot",
      );

      expect(result).toEqual([]);
    });

    it("detects @mention of an AI by display name", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValueOnce([
        { id: "ai-1", displayName: "Bot", autoRespond: true },
      ]);

      const result = await service.parseAIMentionsFromContent(
        "topic-1",
        "Hello @Bot, how are you?",
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: "ai-1", displayName: "Bot" });
    });

    it("detects @mention with quoted display name", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValueOnce([
        { id: "ai-1", displayName: "Research Bot", autoRespond: true },
      ]);

      const result = await service.parseAIMentionsFromContent(
        "topic-1",
        'Hey @"Research Bot" please help',
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ai-1");
    });

    it("excludes the specified AI member from results", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValueOnce([
        { id: "ai-2", displayName: "OtherBot", autoRespond: true },
      ]);

      await service.parseAIMentionsFromContent(
        "topic-1",
        "@OtherBot hello",
        "ai-1",
      );

      // Should have passed excludeAiMemberId in where clause
      expect(mockPrisma.topicAIMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { not: "ai-1" },
          }),
        }),
      );
    });

    it("does not exclude when excludeAiMemberId is not provided", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValueOnce([]);

      await service.parseAIMentionsFromContent("topic-1", "Hello");

      expect(mockPrisma.topicAIMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ topicId: "topic-1" }),
        }),
      );
    });

    it("returns empty when content does not match any AI name", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValueOnce([
        { id: "ai-1", displayName: "Bot", autoRespond: true },
      ]);

      const result = await service.parseAIMentionsFromContent(
        "topic-1",
        "Hello world",
      );

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // shouldSearchForInfo (private method)
  // ============================================================

  describe("shouldSearchForInfo (private)", () => {
    const invoke = (content: string) =>
      (
        service as unknown as { shouldSearchForInfo: (s: string) => boolean }
      ).shouldSearchForInfo(content);

    it('returns true for content with "最新"', () => {
      expect(invoke("最新 AI 新闻")).toBe(true);
    });

    it('returns true for content with "latest"', () => {
      expect(invoke("What is the latest news?")).toBe(true);
    });

    it('returns true for content with "today"', () => {
      expect(invoke("What happened today?")).toBe(true);
    });

    it('returns true for content with "price"', () => {
      expect(invoke("What is the price of BTC?")).toBe(true);
    });

    it('returns true for content with "what is"', () => {
      expect(invoke("what is machine learning?")).toBe(true);
    });

    it('returns true for content with "2025"', () => {
      expect(invoke("2025 AI trends")).toBe(true);
    });

    it("returns false for generic content without search triggers", () => {
      expect(invoke("Hello, how are you doing?")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(invoke("")).toBe(false);
    });
  });

  // ============================================================
  // shouldUseTools (private method)
  // ============================================================

  describe("shouldUseTools (private)", () => {
    const invoke = (
      aiMember: Parameters<AiResponseService["shouldUseTools" & string]>[0],
    ) =>
      (
        service as unknown as {
          shouldUseTools: (m: typeof aiMember) => boolean;
        }
      ).shouldUseTools(aiMember);

    it("returns true when capabilities array is non-empty", () => {
      const member = {
        displayName: "Bot",
        capabilities: ["web-search"],
        roleDescription: null,
      };
      expect(invoke(member as never)).toBe(true);
    });

    it("returns false when capabilities is empty array", () => {
      const member = {
        displayName: "Bot",
        capabilities: [],
        roleDescription: null,
      };
      expect(invoke(member as never)).toBe(false);
    });

    it('returns true when roleDescription contains "leader"', () => {
      const member = {
        displayName: "Bot",
        capabilities: [],
        roleDescription: "I am the leader of the team",
      };
      expect(invoke(member as never)).toBe(true);
    });

    it('returns true when roleDescription contains "researcher"', () => {
      const member = {
        displayName: "Bot",
        capabilities: [],
        roleDescription: "Senior researcher",
      };
      expect(invoke(member as never)).toBe(true);
    });

    it('returns true when roleDescription contains "analyst"', () => {
      const member = {
        displayName: "Bot",
        capabilities: [],
        roleDescription: "Data analyst",
      };
      expect(invoke(member as never)).toBe(true);
    });

    it('returns true when roleDescription contains "搜索"', () => {
      const member = {
        displayName: "Bot",
        capabilities: [],
        roleDescription: "专业搜索助手",
      };
      expect(invoke(member as never)).toBe(true);
    });

    it("returns false for plain assistant with no keywords", () => {
      const member = {
        displayName: "Bot",
        capabilities: null,
        roleDescription: "A friendly assistant",
      };
      expect(invoke(member as never)).toBe(false);
    });
  });

  // ============================================================
  // buildMemberConfig (private method)
  // ============================================================

  describe("buildMemberConfig (private)", () => {
    const invoke = (aiMember: object) =>
      (
        service as unknown as {
          buildMemberConfig: (m: typeof aiMember) => Record<string, unknown>;
        }
      ).buildMemberConfig(aiMember);

    it("returns member config with memberId and displayName", () => {
      const aiMember = {
        id: "ai-1",
        displayName: "Bot",
        roleDescription: "Research assistant",
        capabilities: ["search"],
      };

      const config = invoke(aiMember);

      expect(config.memberId).toBe("ai-1");
      expect(config.displayName).toBe("Bot");
    });

    it("uses inferRoleFromDescription to determine role", () => {
      const aiMember = {
        id: "ai-1",
        displayName: "Bot",
        roleDescription: "leader of the team",
        capabilities: [],
      };

      invoke(aiMember);

      expect(mockTeamMemberAgent.inferRoleFromDescription).toHaveBeenCalledWith(
        "leader of the team",
      );
    });

    it("handles null capabilities by defaulting to empty array", () => {
      const aiMember = {
        id: "ai-1",
        displayName: "Bot",
        roleDescription: null,
        capabilities: null,
      };

      const config = invoke(aiMember);

      expect(config.capabilities).toEqual([]);
    });

    it("includes roleDescription in expertiseAreas when present", () => {
      const aiMember = {
        id: "ai-1",
        displayName: "Bot",
        roleDescription: "Data science expert",
        capabilities: [],
      };

      const config = invoke(aiMember);

      expect(config.expertiseAreas).toContain("Data science expert");
    });
  });

  // ============================================================
  // getDefaultModelId (private method)
  // ============================================================

  describe("getDefaultModelId (private)", () => {
    const invoke = (modelId: string) =>
      (
        service as unknown as {
          getDefaultModelId: (id: string) => Promise<string>;
        }
      ).getDefaultModelId(modelId);

    it("returns the model identifier as-is when it contains a dash and known provider", async () => {
      await expect(invoke("gpt-4-turbo")).resolves.toBe("gpt-4-turbo");
      await expect(invoke("claude-3-5-sonnet-20241022")).resolves.toBe(
        "claude-3-5-sonnet-20241022",
      );
      await expect(invoke("grok-3-latest")).resolves.toBe("grok-3-latest");
    });

    it('resolves shorthand "grok" via available models', async () => {
      mockAiFacade.getAvailableModelsExtended.mockResolvedValueOnce([
        { id: "grok-3-latest", name: "Grok 3", isAvailable: true },
      ]);
      await expect(invoke("grok")).resolves.toBe("grok-3-latest");
    });

    it('resolves shorthand "claude" via available models', async () => {
      mockAiFacade.getAvailableModelsExtended.mockResolvedValueOnce([
        {
          id: "claude-sonnet-4-20250514",
          name: "Claude Sonnet",
          isAvailable: true,
        },
      ]);
      await expect(invoke("claude")).resolves.toBe("claude-sonnet-4-20250514");
    });

    it('resolves shorthand "gemini" via available models', async () => {
      mockAiFacade.getAvailableModelsExtended.mockResolvedValueOnce([
        { id: "gemini-2.0-flash", name: "Gemini Flash", isAvailable: true },
      ]);
      await expect(invoke("gemini")).resolves.toBe("gemini-2.0-flash");
    });

    it("returns identifier as-is for unknown model without dashes when no match found", async () => {
      mockAiFacade.getAvailableModelsExtended.mockResolvedValueOnce([]);
      await expect(invoke("unknown-custom-model")).resolves.toBe(
        "unknown-custom-model",
      );
    });
  });

  // ============================================================
  // isRetryableError (private method)
  // ============================================================

  describe("isRetryableError (private)", () => {
    const invoke = (error: Error) =>
      (
        service as unknown as { isRetryableError: (e: Error) => boolean }
      ).isRetryableError(error);

    it("returns true for timeout errors", () => {
      expect(invoke(new Error("Request timeout exceeded"))).toBe(true);
    });

    it("returns true for rate limit errors", () => {
      expect(invoke(new Error("rate limit exceeded"))).toBe(true);
    });

    it("returns true for 429 status", () => {
      expect(invoke(new Error("429 Too Many Requests"))).toBe(true);
    });

    it("returns true for 503 status", () => {
      expect(invoke(new Error("503 Service Unavailable"))).toBe(true);
    });

    it("returns true for ECONNRESET", () => {
      expect(invoke(new Error("ECONNRESET connection reset"))).toBe(true);
    });

    it("returns true for socket hang up", () => {
      expect(invoke(new Error("socket hang up"))).toBe(true);
    });

    it("returns false for authentication error", () => {
      expect(invoke(new Error("Invalid API key"))).toBe(false);
    });

    it("returns false for not found error", () => {
      expect(invoke(new Error("Resource not found"))).toBe(false);
    });
  });

  // ============================================================
  // generateAIResponse - additional branches
  // ============================================================

  describe("generateAIResponse - additional branches", () => {
    it("records metrics when metricsService is available", async () => {
      const metricsMock = {
        recordAIResponseLatency: jest.fn(),
        recordAIResponseTokens: jest.fn(),
        recordAIResponseError: jest.fn(),
      };

      const module = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: mockAiFacade },
          { provide: ToolFacade, useValue: mockAiFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          { provide: ContextRouterService, useValue: mockContextRouter },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          { provide: TopicContextRetrievalService, useValue: null },
          { provide: CreditsService, useValue: mockCreditsService },
          { provide: MetricsService, useValue: metricsMock },
          { provide: AuditService, useValue: mockAuditService },
        ],
      }).compile();

      const svc = module.get<AiResponseService>(AiResponseService);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 500,
      });

      await svc.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(metricsMock.recordAIResponseLatency).toHaveBeenCalledWith(
        "gpt-4o",
        expect.any(Number),
      );
      expect(metricsMock.recordAIResponseTokens).toHaveBeenCalledWith(
        "gpt-4o",
        500,
      );
    });

    it("records error metric when AI chat fails", async () => {
      const metricsMock = {
        recordAIResponseLatency: jest.fn(),
        recordAIResponseTokens: jest.fn(),
        recordAIResponseError: jest.fn(),
      };

      const module = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: mockAiFacade },
          { provide: ToolFacade, useValue: mockAiFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          { provide: ContextRouterService, useValue: mockContextRouter },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          { provide: TopicContextRetrievalService, useValue: null },
          { provide: CreditsService, useValue: mockCreditsService },
          { provide: MetricsService, useValue: metricsMock },
          { provide: AuditService, useValue: mockAuditService },
        ],
      }).compile();

      const svc = module.get<AiResponseService>(AiResponseService);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockRejectedValueOnce(new Error("API error"));

      // Should not throw even when chat fails (generates error message instead)
      await expect(
        svc.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();

      expect(metricsMock.recordAIResponseError).toHaveBeenCalledWith(
        "gpt-4o",
        "generation_failed",
      );
    });

    it('uses blue team debate prompt when debateRole is "blue"', async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Blue team response",
        tokensUsed: 100,
      });

      const debateRole = {
        role: "blue" as const,
        opponent: { id: "red-ai-1", displayName: "Red Bot" },
        topic: "AI safety",
      };

      await service.generateAIResponse(
        "topic-1",
        "user-1",
        "ai-1",
        [],
        debateRole,
      );

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const systemMsg = chatCall.messages.find(
        (m: { role: string }) => m.role === "system",
      );
      expect(systemMsg.content).toContain("蓝方");
      expect(systemMsg.content).toContain("反方");
    });

    it("calls auditService when available", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Audited response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(mockAuditService.logAIResponseGenerate).toHaveBeenCalledWith(
        "topic-1",
        "ai-1",
        expect.any(String), // message id
        "gpt-4o",
        100,
      );
    });

    it("includes AI collaboration prompt when canMentionOtherAI is true and other AIs exist", async () => {
      const aiMemberWithCollaboration = makeAIMember({
        canMentionOtherAI: true,
        systemPrompt: null,
      });
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        aiMemberWithCollaboration,
      );
      mockPrisma.topicAIMember.findMany.mockResolvedValueOnce([
        { id: "ai-2", displayName: "Colleague Bot", roleDescription: "Helper" },
      ]);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Collaborative response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const systemMsg = chatCall.messages.find(
        (m: { role: string }) => m.role === "system",
      );
      expect(systemMsg.content).toContain("Colleague Bot");
    });

    it("uses web-search tool when last user message triggers search", async () => {
      const userMessage = makeMessage({
        content: "最新 AI 研究进展",
        senderId: "user-1",
        aiMemberId: null,
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([userMessage]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());

      const mockWebSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: {
            success: true,
            results: [
              {
                title: "Latest AI",
                url: "https://ai.com",
                content: "AI research content",
              },
            ],
          },
        }),
      };
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-search") return mockWebSearchTool;
        return null;
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Search-enhanced response",
        tokensUsed: 200,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(mockToolRegistry.tryGet).toHaveBeenCalledWith("web-search");
      expect(mockWebSearchTool.execute).toHaveBeenCalled();
    });

    it("handles web fetch tool failure gracefully", async () => {
      const userMessage = makeMessage({
        content: "Check https://failing.com for info",
        senderId: "user-1",
        aiMemberId: null,
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([userMessage]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());

      const mockWebFetchTool = {
        execute: jest.fn().mockRejectedValue(new Error("Network error")),
      };
      mockToolRegistry.tryGet.mockReturnValueOnce(mockWebFetchTool);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response without fetch",
        tokensUsed: 100,
      });

      // Should not throw even when web fetch fails
      await expect(
        service.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();
    });

    it("truncates very long context messages to MAX_SINGLE_MESSAGE_LENGTH", async () => {
      const longMessage = makeMessage({
        content: "X".repeat(3000), // > MAX_SINGLE_MESSAGE_LENGTH (2000)
        senderId: "user-1",
        aiMemberId: null,
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([longMessage]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      // Verify chat was called (truncation happens internally)
      expect(mockAiFacade.chat).toHaveBeenCalled();
      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const userMsgs = chatCall.messages.filter(
        (m: { role: string }) => m.role === "user",
      );
      if (userMsgs.length > 0) {
        expect(userMsgs[0].content.length).toBeLessThanOrEqual(2000 + 50); // Allow for truncation message
      }
    });

    it("includes replyTo quoted content in chat message", async () => {
      const replyMessage = makeMessage({
        content: "My reply to you",
        senderId: "user-1",
        aiMemberId: null,
        replyTo: {
          id: "orig-msg",
          senderId: null,
          aiMemberId: "ai-1",
          content: "Original AI message",
          sender: null,
          aiMember: { displayName: "Agent One" },
        },
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([replyMessage]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const allContent = chatCall.messages
        .map((m: { content: string }) => m.content)
        .join(" ");
      expect(allContent).toContain("引用");
      expect(allContent).toContain("Original AI message");
    });

    it("calls contextRetrievalService when available and query is long enough", async () => {
      const contextRetrievalMock = {
        buildEnhancedContext: jest.fn().mockResolvedValue("Semantic context"),
      };

      const module = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: mockAiFacade },
          { provide: ToolFacade, useValue: mockAiFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          { provide: ContextRouterService, useValue: mockContextRouter },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          {
            provide: TopicContextRetrievalService,
            useValue: contextRetrievalMock,
          },
          { provide: CreditsService, useValue: null },
          { provide: MetricsService, useValue: null },
          { provide: AuditService, useValue: null },
        ],
      }).compile();

      const svc = module.get<AiResponseService>(AiResponseService);

      const longUserMessage = makeMessage({
        content:
          "This is a long user question about AI research and its impact on society today",
        senderId: "user-1",
        aiMemberId: null,
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([longUserMessage]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ systemPrompt: null }),
      );
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await svc.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(contextRetrievalMock.buildEnhancedContext).toHaveBeenCalled();
    });

    it("handles isReasoning model with extended output length", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ aiModel: "o1-mini" }),
      );
      mockAiFacade.getModelById.mockResolvedValueOnce({
        modelId: "o1-mini",
        name: "o1-mini",
        provider: "openai",
        isReasoning: true,
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Deep reasoning response",
        tokensUsed: 2000,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.taskProfile.outputLength).toBe("extended");
    });

    it("handles large model (maxTokens >= 6000) with long output length", async () => {
      // v3.1 C 阶段 (2026-05-24)：isLargeModel 不再判 modelId 子串，改读
      // aiModelConfig.maxTokens >= 6000；GPT-4 系列 admin 配置普遍 8000 满足。
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ aiModel: "gpt-4-turbo" }),
      );
      mockAiFacade.getModelById.mockResolvedValueOnce({
        modelId: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        provider: "openai",
        isReasoning: false,
        maxTokens: 8000,
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "GPT-4 response",
        tokensUsed: 500,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.taskProfile.outputLength).toBe("long");
    });

    it("handles medium output length for non-large models (maxTokens < 6000)", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ aiModel: "llama-3" }),
      );
      mockAiFacade.getModelById.mockResolvedValueOnce({
        modelId: "llama-3",
        name: "Llama 3",
        provider: "meta",
        isReasoning: false,
        maxTokens: 4096,
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Llama response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.taskProfile.outputLength).toBe("medium");
    });

    // v3.1 C 阶段（2026-05-24）：守护 capability 数据驱动 — modelId 含 "gpt-4"
    // 但 maxTokens 未配置（< 6000）时，必须降级 medium（旧启发式会误判 long）。
    it("guards capability-driven: modelId looks 'large' but maxTokens < 6000 → medium", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ aiModel: "gpt-4-nano-byok" }),
      );
      mockAiFacade.getModelById.mockResolvedValueOnce({
        modelId: "gpt-4-nano-byok",
        name: "GPT-4 nano BYOK",
        provider: "openai",
        isReasoning: false,
        maxTokens: 2048, // 小型 BYOK，启发式会误判 long
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "nano response",
        tokensUsed: 50,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.taskProfile.outputLength).toBe("medium");
    });

    // v3.1 C 阶段（2026-05-24）：守护 capability 数据驱动 — modelId 不含 "gpt-4"
    // 但 maxTokens >= 6000（大型 BYOK 或新 provider）时，必须升级 long。
    it("guards capability-driven: modelId looks 'small' but maxTokens >= 6000 → long", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ aiModel: "qwen-max" }),
      );
      mockAiFacade.getModelById.mockResolvedValueOnce({
        modelId: "qwen-max",
        name: "Qwen Max",
        provider: "alibaba",
        isReasoning: false,
        maxTokens: 8000,
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Qwen response",
        tokensUsed: 200,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      expect(chatCall.taskProfile.outputLength).toBe("long");
    });

    it("handles REFERENCE_RECENT context strategy from contextRouter", async () => {
      require("@nestjs/common"); // fallback (ContextStrategy not used directly)
      const mockContextRouterWithRefRecent = {
        routeContext: jest.fn().mockResolvedValue({
          intent: "REFERENCE",
          strategy: "REFERENCE_RECENT",
          systemPromptAddition: "Please reference recent messages",
          context: [],
        }),
      };

      const module = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: mockAiFacade },
          { provide: ToolFacade, useValue: mockAiFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          {
            provide: ContextRouterService,
            useValue: mockContextRouterWithRefRecent,
          },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          { provide: TopicContextRetrievalService, useValue: null },
          { provide: CreditsService, useValue: null },
          { provide: MetricsService, useValue: null },
          { provide: AuditService, useValue: null },
        ],
      }).compile();

      const svc = module.get<AiResponseService>(AiResponseService);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Context-aware response",
        tokensUsed: 100,
      });

      await expect(
        svc.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();
    });
  });

  // ============================================================
  // generateWithToolsWithRetry (private, tested via generateAIResponse
  // when shouldUseTools returns true and toolRegistry returns tools)
  // ============================================================

  describe("generateWithTools path via generateAIResponse", () => {
    it("falls back to standard mode when generateWithTools throws", async () => {
      const memberWithCapabilities = makeAIMember({
        capabilities: ["web-search"],
      });
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        memberWithCapabilities,
      );
      mockTeamMemberAgent.resolveTools.mockReturnValueOnce(["web-search"]);

      // Make aiFacade not have functionCallingAdapter — triggers throw in generateWithTools
      const facadeWithoutFC = {
        ...mockAiFacade,
        functionCallingAdapter: undefined,
        functionCallingExecutor: undefined,
      };
      const module = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: facadeWithoutFC },
          { provide: ToolFacade, useValue: facadeWithoutFC },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          { provide: ContextRouterService, useValue: mockContextRouter },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          { provide: TopicContextRetrievalService, useValue: null },
          { provide: CreditsService, useValue: mockCreditsService },
          { provide: MetricsService, useValue: null },
          { provide: AuditService, useValue: null },
        ],
      }).compile();

      const svc = module.get<AiResponseService>(AiResponseService);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Fallback response",
        tokensUsed: 100,
      });
      // Should fall back and succeed
      await expect(
        svc.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();
    });

    it("uses generateWithTools successfully when functionCallingAdapter is available", async () => {
      const memberWithCapabilities = makeAIMember({
        capabilities: ["web-search"],
      });
      mockPrisma.topicAIMember.findFirst.mockResolvedValue(
        memberWithCapabilities,
      );
      mockTeamMemberAgent.resolveTools.mockReturnValue(["web-search"]);

      async function* mockGenerator() {
        yield {
          type: "tool_call" as const,
          tool: "web-search",
          input: { query: "test" },
        };
        yield {
          type: "tool_result" as const,
          tool: "web-search",
          output: { results: [] },
          duration: 100,
        };
        yield {
          type: "complete" as const,
          result: {
            summary: "Generated with tools",
            tokensUsed: 200,
            duration: 500,
          },
        };
      }

      const mockFunctionCallingExecutor = {
        executeWithContext: jest.fn().mockReturnValue(mockGenerator()),
      };
      const mockFunctionCallingAdapter = {
        setConfig: jest.fn(),
      };

      const facadeWithFC = {
        ...mockAiFacade,
        functionCallingAdapter: mockFunctionCallingAdapter,
        functionCallingExecutor: mockFunctionCallingExecutor,
      };

      const module = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: facadeWithFC },
          { provide: ToolFacade, useValue: facadeWithFC },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          { provide: ContextRouterService, useValue: mockContextRouter },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          { provide: TopicContextRetrievalService, useValue: null },
          { provide: CreditsService, useValue: mockCreditsService },
          { provide: MetricsService, useValue: null },
          { provide: AuditService, useValue: null },
        ],
      }).compile();

      const svc = module.get<AiResponseService>(AiResponseService);
      mockPrisma.topicMessage.create.mockResolvedValue({
        id: "tool-msg-1",
        content: "Generated with tools",
        topicId: "topic-1",
        aiMemberId: "ai-1",
      });

      const result = await svc.generateAIResponse(
        "topic-1",
        "user-1",
        "ai-1",
        [],
      );

      expect(mockFunctionCallingAdapter.setConfig).toHaveBeenCalledWith({
        aiMemberId: "ai-1",
        workspaceId: "topic-1",
      });
      expect(result).toBeDefined();
    });

    it("handles error event in generateWithTools and uses error fallback content", async () => {
      const memberWithCapabilities = makeAIMember({
        capabilities: ["web-search"],
      });
      mockPrisma.topicAIMember.findFirst.mockResolvedValue(
        memberWithCapabilities,
      );
      mockTeamMemberAgent.resolveTools.mockReturnValue(["web-search"]);

      async function* errorGenerator() {
        yield {
          type: "error" as const,
          error: "Tool execution failed",
          tool: "web-search",
        };
        yield {
          type: "complete" as const,
          result: { summary: "", tokensUsed: 0, duration: 100 },
        };
      }

      const mockFunctionCallingExecutor = {
        executeWithContext: jest.fn().mockReturnValue(errorGenerator()),
      };
      const mockFunctionCallingAdapter = { setConfig: jest.fn() };

      const facadeWithFC = {
        ...mockAiFacade,
        functionCallingAdapter: mockFunctionCallingAdapter,
        functionCallingExecutor: mockFunctionCallingExecutor,
      };

      const module = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: facadeWithFC },
          { provide: ToolFacade, useValue: facadeWithFC },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          { provide: ContextRouterService, useValue: mockContextRouter },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          { provide: TopicContextRetrievalService, useValue: null },
          { provide: CreditsService, useValue: mockCreditsService },
          { provide: MetricsService, useValue: null },
          { provide: AuditService, useValue: null },
        ],
      }).compile();

      const svc = module.get<AiResponseService>(AiResponseService);
      mockPrisma.topicMessage.create.mockResolvedValue({
        id: "error-msg-1",
        content: "工具调用出现错误",
        topicId: "topic-1",
        aiMemberId: "ai-1",
      });

      await expect(
        svc.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();
      // error event should have emitted tool:error
      expect(mockTopicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "tool:error",
        expect.objectContaining({ aiMemberId: "ai-1" }),
      );
    });
  });

  // ============================================================
  // generateWithToolsWithRetry directly (private method)
  // ============================================================

  describe("generateWithToolsWithRetry (private)", () => {
    it("retries on retryable errors and eventually succeeds", async () => {
      const mockGenerateWithTools = jest
        .fn()
        .mockRejectedValueOnce(new Error("timeout error"))
        .mockRejectedValueOnce(new Error("rate limit exceeded"))
        .mockResolvedValueOnce({
          id: "success-msg",
          content: "Success after retries",
        });

      const svcCasted = service as unknown as {
        generateWithToolsWithRetry: (
          topicId: string,
          aiMember: object,
          contextMessages: unknown[],
          toolTypes: unknown[],
          systemPrompt: string,
          maxRetries?: number,
        ) => Promise<unknown>;
        delay: (ms: number) => Promise<void>;
        generateWithTools: (...args: unknown[]) => Promise<unknown>;
      };

      // Patch generateWithTools
      const original = svcCasted.generateWithTools;
      svcCasted.generateWithTools = mockGenerateWithTools;
      // Override delay to be instant
      svcCasted.delay = jest.fn().mockResolvedValue(undefined);

      const result = await svcCasted.generateWithToolsWithRetry(
        "topic-1",
        { id: "ai-1", aiModel: "gpt-4o", displayName: "Bot" },
        [],
        [],
        "system prompt",
        3,
      );

      expect(result).toEqual({
        id: "success-msg",
        content: "Success after retries",
      });
      expect(mockGenerateWithTools).toHaveBeenCalledTimes(3);

      svcCasted.generateWithTools = original;
    });

    it("throws non-retryable errors immediately without retrying", async () => {
      const nonRetryableError = new Error("Invalid API key");
      const mockGenerateWithTools = jest
        .fn()
        .mockRejectedValueOnce(nonRetryableError);

      const svcCasted = service as unknown as {
        generateWithToolsWithRetry: (
          topicId: string,
          aiMember: object,
          contextMessages: unknown[],
          toolTypes: unknown[],
          systemPrompt: string,
          maxRetries?: number,
        ) => Promise<unknown>;
        generateWithTools: (...args: unknown[]) => Promise<unknown>;
        delay: (ms: number) => Promise<void>;
      };

      const original = svcCasted.generateWithTools;
      svcCasted.generateWithTools = mockGenerateWithTools;
      svcCasted.delay = jest.fn().mockResolvedValue(undefined);

      await expect(
        svcCasted.generateWithToolsWithRetry(
          "topic-1",
          { id: "ai-1", aiModel: "gpt-4o", displayName: "Bot" },
          [],
          [],
          "system prompt",
          3,
        ),
      ).rejects.toThrow("Invalid API key");

      // Should only call once (non-retryable)
      expect(mockGenerateWithTools).toHaveBeenCalledTimes(1);

      svcCasted.generateWithTools = original;
    });

    it("throws lastError when all retries are exhausted", async () => {
      const retryableError = new Error("timeout error");
      const mockGenerateWithTools = jest.fn().mockRejectedValue(retryableError);

      const svcCasted = service as unknown as {
        generateWithToolsWithRetry: (
          topicId: string,
          aiMember: object,
          contextMessages: unknown[],
          toolTypes: unknown[],
          systemPrompt: string,
          maxRetries?: number,
        ) => Promise<unknown>;
        generateWithTools: (...args: unknown[]) => Promise<unknown>;
        delay: (ms: number) => Promise<void>;
      };

      const original = svcCasted.generateWithTools;
      svcCasted.generateWithTools = mockGenerateWithTools;
      svcCasted.delay = jest.fn().mockResolvedValue(undefined);

      await expect(
        svcCasted.generateWithToolsWithRetry(
          "topic-1",
          { id: "ai-1", aiModel: "gpt-4o", displayName: "Bot" },
          [],
          [],
          "system prompt",
          2,
        ),
      ).rejects.toThrow("timeout error");

      expect(mockGenerateWithTools).toHaveBeenCalledTimes(2);

      svcCasted.generateWithTools = original;
    });
  });

  // ============================================================
  // buildSmartContext — summary content extraction patterns
  // ============================================================

  describe("buildSmartContext — summary content extraction", () => {
    it("includes chapter title in summary when messages contain chapter markers", async () => {
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMessage({
          id: `msg-${i}`,
          content:
            i === 0
              ? "第一章：人工智能的起源与发展历程详述"
              : `Regular message ${i}`,
          senderId: i % 2 === 0 ? "user-1" : null,
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(messages);

      const result = await service.buildSmartContext("topic-1", "ai-1", 10);

      // 10+ dropped messages -> summary generated
      expect(result.summary).not.toBeNull();
    });

    it("includes decision markers in summary when messages contain decision patterns", async () => {
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMessage({
          id: `msg-${i}`,
          content:
            i === 0
              ? "我们决定采用微服务架构来解决这个性能问题，预计可以提升50%效率"
              : `Regular message ${i}`,
          senderId: i % 2 === 0 ? "user-1" : null,
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(messages);

      const result = await service.buildSmartContext("topic-1", "ai-1", 10);

      expect(result.summary).not.toBeNull();
    });

    it("includes task markers in summary when messages contain task patterns", async () => {
      const messages = Array.from({ length: 20 }, (_, i) =>
        makeMessage({
          id: `msg-${i}`,
          content:
            i === 0
              ? "主要任务是完成整个系统的重构工作，包括前端和后端的全面升级"
              : `Regular message ${i}`,
          senderId: i % 2 === 0 ? "user-1" : null,
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(messages);

      const result = await service.buildSmartContext("topic-1", "ai-1", 10);

      expect(result.summary).not.toBeNull();
    });

    it("returns early with empty parsedUrlsContext when parsedUrls has empty array", async () => {
      const msg = makeMessage({
        content: "Message with empty parsedUrls",
        parsedUrls: [],
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([msg]);

      const result = await service.buildSmartContext("topic-1", "ai-1");

      expect(result.parsedUrlsContext).toBe("");
    });

    it("handles parsedUrls with URL but no preview content", async () => {
      const msgWithMinimalUrl = makeMessage({
        content: "Check this",
        parsedUrls: [
          {
            url: "https://minimal.com",
            preview: null,
            extractedContent: null,
          },
        ],
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
        msgWithMinimalUrl,
      ]);

      const result = await service.buildSmartContext("topic-1", "ai-1");

      expect(result.parsedUrlsContext).toContain("https://minimal.com");
    });
  });

  // ============================================================
  // generateAIResponse — context management branches
  // ============================================================

  describe("generateAIResponse — context management", () => {
    it("handles context with no user messages (uses empty userMessageContent)", async () => {
      // All messages are from AI, no user messages
      const aiOnlyMessages = Array.from({ length: 5 }, (_, i) =>
        makeMessage({
          id: `ai-msg-${i}`,
          content: `AI message ${i}`,
          aiMemberId: "ai-2",
          senderId: null,
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(aiOnlyMessages);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response to AI-only context",
        tokensUsed: 100,
      });

      await expect(
        service.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();

      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("handles context messages exceeding MAX_TOTAL_CONTEXT_CHARS (100k)", async () => {
      // Create messages with very long content to exceed 100k chars
      const longMessages = Array.from({ length: 12 }, (_, i) =>
        makeMessage({
          id: `long-msg-${i}`,
          content: "X".repeat(10000), // 10k chars each, 12 messages = 120k total
          senderId: i === 0 ? "user-1" : null,
          aiMemberId: i === 0 ? null : "ai-2",
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(longMessages);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await expect(
        service.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();

      // Context should have been trimmed
      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("handles STANDARD strategy when latestUserMsg is not in recent slice", async () => {
      // Many messages but the user message is old (not in the recent slice)
      // Force context router to return STANDARD strategy
      const messages = Array.from({ length: 8 }, (_, i) =>
        makeMessage({
          id: `msg-${i}`,
          content: `Message ${i}`,
          senderId: i === 0 ? "user-1" : null, // user message first (oldest)
          aiMemberId: i === 0 ? null : "ai-2",
          createdAt: new Date(2025, 0, i + 1),
        }),
      );
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(messages);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await expect(
        service.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();
    });

    it("handles semantic retrieval failure gracefully", async () => {
      const contextRetrievalMock = {
        buildEnhancedContext: jest
          .fn()
          .mockRejectedValue(new Error("Retrieval failed")),
      };

      const module = await Test.createTestingModule({
        providers: [
          AiResponseService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: mockAiFacade },
          { provide: ToolFacade, useValue: mockAiFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          { provide: ContextRouterService, useValue: mockContextRouter },
          { provide: TeamMemberAgent, useValue: mockTeamMemberAgent },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          {
            provide: TopicContextRetrievalService,
            useValue: contextRetrievalMock,
          },
          { provide: CreditsService, useValue: null },
          { provide: MetricsService, useValue: null },
          { provide: AuditService, useValue: null },
        ],
      }).compile();

      const svc = module.get<AiResponseService>(AiResponseService);
      const longUserMessage = makeMessage({
        content:
          "This is a long user query about something very specific in AI research and applications",
        senderId: "user-1",
        aiMemberId: null,
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([longUserMessage]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ systemPrompt: null }),
      );
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      // Should not throw even when contextRetrievalService fails
      await expect(
        svc.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();
    });

    it("handles debate context filtering correctly for blue team", async () => {
      const contextMessages = [
        makeMessage({
          id: "msg-1",
          content: "User question",
          senderId: "user-1",
          aiMemberId: null,
        }),
        makeMessage({
          id: "msg-2",
          content: "Red team argument",
          aiMemberId: "red-ai",
          senderId: null,
        }),
        makeMessage({
          id: "msg-3",
          content: "Third AI comment",
          aiMemberId: "ai-3",
          senderId: null,
        }),
      ];
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce(contextMessages);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        makeAIMember({ id: "ai-1", displayName: "Blue Bot" }),
      );
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Blue team response",
        tokensUsed: 100,
      });

      const debateRole = {
        role: "blue" as const,
        opponent: { id: "red-ai", displayName: "Red Bot" },
        topic: "AI regulation debate",
      };

      await service.generateAIResponse(
        "topic-1",
        "user-1",
        "ai-1",
        [],
        debateRole,
      );

      // Debate prompt should include blue team instructions
      const chatCall = mockAiFacade.chat.mock.calls[0][0];
      const systemMsg = chatCall.messages.find(
        (m: { role: string }) => m.role === "system",
      );
      expect(systemMsg.content).toContain("反方");
    });

    it("generates AI collaboration prompt when canMentionOtherAI is true but no other AIs exist", async () => {
      const aiMemberWithCollab = makeAIMember({
        canMentionOtherAI: true,
        systemPrompt: null,
      });
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(
        aiMemberWithCollab,
      );
      mockPrisma.topicAIMember.findMany.mockResolvedValueOnce([]); // No other AIs
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Solo response",
        tokensUsed: 100,
      });

      await expect(
        service.generateAIResponse("topic-1", "user-1", "ai-1", []),
      ).resolves.not.toThrow();
    });

    it("web fetch tool returns no content field — skips adding URL context", async () => {
      const userMessageWithUrl = makeMessage({
        content: "Check https://example.com",
        senderId: "user-1",
        aiMemberId: null,
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
        userMessageWithUrl,
      ]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());

      const mockWebFetchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { title: "Example", content: null }, // no content
        }),
      };
      mockToolRegistry.tryGet.mockReturnValueOnce(mockWebFetchTool);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("web search tool returns empty results — skips adding search context", async () => {
      const userMessage = makeMessage({
        content: "最新 AI 研究",
        senderId: "user-1",
        aiMemberId: null,
      });
      mockPrisma.topicMessage.findMany.mockResolvedValueOnce([userMessage]);
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(makeAIMember());

      const mockWebSearchTool = {
        execute: jest.fn().mockResolvedValue({
          success: true,
          data: { success: true, results: [] }, // empty results
        }),
      };
      mockToolRegistry.tryGet.mockImplementation((toolId: string) => {
        if (toolId === "web-search") return mockWebSearchTool;
        return null;
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 100,
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(mockAiFacade.chat).toHaveBeenCalled();
    });
  });

  // ============================================================
  // delay (private method)
  // ============================================================

  describe("delay (private)", () => {
    it("resolves after given milliseconds", async () => {
      const invoke = (ms: number) =>
        (service as unknown as { delay: (ms: number) => Promise<void> }).delay(
          ms,
        );

      await expect(invoke(0)).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // Mission message detection (private, tested via buildSmartContext)
  // ============================================================

  describe("mission message filtering", () => {
    const missionPatterns = [
      "[任务规划]\n详细计划",
      "[任务分配] Agent1负责...",
      "[任务进度] 50% 完成",
      "[开始工作] 现在开始...",
      "[结果整合] 汇总结果",
      "[最终交付] 这是最终结果",
      "[Leader反馈] 请修改...",
      "[Mission] Status update",
      "[AgentTask] Task details",
      "🚀 **团队任务已创建**",
      "❌ 任务执行出错",
    ];

    missionPatterns.forEach((pattern) => {
      it(`should filter out message starting with: "${pattern.substring(0, 30)}..."`, async () => {
        const missionMsg = makeMessage({ content: pattern });
        const normalMsg = makeMessage({
          content: "Normal conversation",
          senderId: "user-1",
        });
        mockPrisma.topicMessage.findMany.mockResolvedValueOnce([
          missionMsg,
          normalMsg,
        ]);

        const result = await service.buildSmartContext("topic-1", "ai-1");

        const filteredOut = result.messages.every((m) => m.content !== pattern);
        expect(filteredOut).toBe(true);
      });
    });
  });
});

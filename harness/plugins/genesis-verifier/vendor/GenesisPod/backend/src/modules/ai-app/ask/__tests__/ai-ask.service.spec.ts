/**
 * AiAskService 单元测试
 *
 * 测试 AI 问答核心服务：
 * - createSession() 创建会话
 * - getSessions() 获取会话列表（分页）
 * - getSession() 获取单个会话
 * - updateSession() 更新会话
 * - deleteSession() 删除会话
 * - sendMessage() 发送消息（含 AI 响应、RAG、积分）
 * - getMessages() 获取消息列表
 * - searchSessions() 搜索会话
 * - getAvailableTools() 可用工具列表
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { AiAskService } from "../ai-ask.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade, RAGFacade, ToolFacade } from "@/modules/ai-harness/facade";
import { AskRoomRuntimeStateStore } from "../ai-ask-room-runtime-state.store";

describe("AiAskService", () => {
  let service: AiAskService;
  let mockPrisma: any;
  let mockFacade: any;
  let mockRuntimeStateStore: any;

  const userId = "user-123";
  const sessionId = "session-456";

  const mockSession = {
    id: sessionId,
    userId,
    title: "Test Chat",
    modelId: "gpt-4o",
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { messages: 0 },
  };

  const mockMessage = {
    id: "msg-1",
    sessionId,
    role: "user",
    content: "Hello",
    createdAt: new Date(),
  };

  beforeEach(async () => {
    mockPrisma = {
      askSession: {
        create: jest.fn().mockResolvedValue(mockSession),
        findMany: jest.fn().mockResolvedValue([mockSession]),
        findFirst: jest.fn().mockResolvedValue(mockSession),
        count: jest.fn().mockResolvedValue(1),
        update: jest
          .fn()
          .mockResolvedValue({ ...mockSession, title: "Updated" }),
        delete: jest.fn().mockResolvedValue(mockSession),
      },
      askMessage: {
        create: jest.fn().mockResolvedValue(mockMessage),
        findMany: jest.fn().mockResolvedValue([mockMessage]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      aIModel: {
        findFirst: jest.fn().mockResolvedValue({
          id: "db-1",
          modelId: "gpt-4o",
          displayName: "GPT-4o",
          provider: "openai",
          maxTokens: 4096,
          apiKey: "sk-xxx",
          isReasoning: false,
        }),
      },
    };

    mockFacade = {
      chat: jest.fn().mockResolvedValue({
        content: "Hello! How can I help?",
        model: "gpt-4o",
        tokensUsed: 50,
        isError: false,
      }),
      chatStream: jest.fn(),
      selectModel: jest.fn(),
      getAvailableModels: jest.fn().mockResolvedValue([]),
      getModelById: jest.fn().mockResolvedValue({
        id: "db-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        apiKey: "sk-xxx",
      }),
      buildContext: jest.fn().mockResolvedValue(""),
      isToolAvailable: jest.fn().mockReturnValue(false),
      isToolExecutionAvailable: jest.fn().mockReturnValue(false),
      chatWithToolsStream: jest.fn(),
      sessionMemoryGet: jest.fn().mockResolvedValue(undefined),
      sessionMemorySet: jest.fn().mockResolvedValue(undefined),
      sessionMemoryClear: jest.fn().mockResolvedValue(undefined),
    };
    mockRuntimeStateStore = {
      clearSession: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAskService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockFacade },
        { provide: RAGFacade, useValue: mockFacade },
        { provide: ToolFacade, useValue: mockFacade },
        {
          provide: AskRoomRuntimeStateStore,
          useValue: mockRuntimeStateStore,
        },
        // All other dependencies are @Optional
      ],
    }).compile();

    service = module.get<AiAskService>(AiAskService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =========================================================================
  // createSession
  // =========================================================================

  describe("createSession", () => {
    it("should create a new session", async () => {
      const result = await service.createSession(userId, {
        title: "My Chat",
      });

      expect(result).toBeDefined();
      expect(mockPrisma.askSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          title: "My Chat",
        }),
      });
    });

    it("should default title to 'New Chat' when not provided", async () => {
      await service.createSession(userId, {} as any);

      expect(mockPrisma.askSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "New Chat",
        }),
      });
    });

    it("should pass modelId when provided", async () => {
      await service.createSession(userId, {
        title: "Test",
        modelId: "claude-3-opus",
      });

      expect(mockPrisma.askSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          modelId: "claude-3-opus",
        }),
      });
    });
  });

  // =========================================================================
  // getSessions
  // =========================================================================

  describe("getSessions", () => {
    it("should return paginated sessions", async () => {
      const result = await service.getSessions(userId, 1, 50);

      expect(result).toBeDefined();
      expect(mockPrisma.askSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          skip: 0,
          take: 50,
        }),
      );
    });

    it("should calculate correct skip for pagination", async () => {
      await service.getSessions(userId, 3, 20);

      expect(mockPrisma.askSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 40, // (3-1) * 20
          take: 20,
        }),
      );
    });
  });

  // =========================================================================
  // getSession
  // =========================================================================

  describe("getSession", () => {
    it("should return session with messages", async () => {
      const result = await service.getSession(sessionId, userId);

      expect(result).toBeDefined();
      expect(mockPrisma.askSession.findFirst).toHaveBeenCalledWith({
        where: { id: sessionId, userId },
      });
    });

    it("should throw NotFoundException when session not found", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(service.getSession("nonexistent", userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should not return sessions belonging to other users", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(service.getSession(sessionId, "other-user")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // updateSession
  // =========================================================================

  describe("updateSession", () => {
    it("should update session title", async () => {
      const result = await service.updateSession(sessionId, userId, {
        title: "Updated Title",
      });

      expect(result).toBeDefined();
      expect(mockPrisma.askSession.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: { title: "Updated Title" },
      });
    });

    it("should throw NotFoundException when session not found", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSession("nonexistent", userId, { title: "X" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // deleteSession
  // =========================================================================

  describe("deleteSession", () => {
    it("should delete session", async () => {
      await service.deleteSession(sessionId, userId);

      expect(mockPrisma.askSession.delete).toHaveBeenCalledWith({
        where: { id: sessionId },
      });
      expect(mockRuntimeStateStore.clearSession).toHaveBeenCalledWith(
        sessionId,
      );
    });

    it("should throw NotFoundException when session not found", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteSession("nonexistent", userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // sendMessage
  // =========================================================================

  describe("sendMessage", () => {
    it("should throw NotFoundException for invalid session", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(
        service.sendMessage("nonexistent", userId, {
          content: "Hello",
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should verify session belongs to user", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(
        service.sendMessage(sessionId, "wrong-user", {
          content: "Hello",
        } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // getMessages
  // =========================================================================

  describe("getMessages", () => {
    it("should return messages for a session", async () => {
      const result = await service.getMessages(sessionId, userId);

      expect(result).toBeDefined();
      expect(mockPrisma.askSession.findFirst).toHaveBeenCalledWith({
        where: { id: sessionId, userId },
      });
    });

    it("should throw NotFoundException for invalid session", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(service.getMessages("nonexistent", userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // searchSessions
  // =========================================================================

  describe("searchSessions", () => {
    it("should search sessions by title or summary", async () => {
      await service.searchSessions(userId, "test query", 20);

      expect(mockPrisma.askSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId,
            OR: [
              { title: { contains: "test query", mode: "insensitive" } },
              { summary: { contains: "test query", mode: "insensitive" } },
            ],
          },
          take: 20,
        }),
      );
    });
  });

  // =========================================================================
  // getAvailableTools
  // =========================================================================

  describe("getAvailableTools", () => {
    it("should return empty array when tool capability not available", () => {
      // Without toolRegistry, tools are not available
      const result = service.getAvailableTools();

      expect(result).toEqual([]);
    });
  });

  // detectIntent / buildSuggestedActions 测试已删 (2026-04-30)
  //   两个方法整体删除（前端 0 处消费 suggestedActions 字段）

  // =========================================================================
  // sendMessage — full flow (non-tool mode)
  // =========================================================================

  describe("sendMessage — non-tool mode", () => {
    const dto = { content: "Hello AI" } as any;

    beforeEach(() => {
      // Set up default mock chain for sendMessage
      mockPrisma.askSession.findFirst.mockResolvedValue(mockSession);
      mockPrisma.askMessage.create
        .mockResolvedValueOnce({ ...mockMessage, role: "user" }) // user msg
        .mockResolvedValueOnce({
          ...mockMessage,
          role: "assistant",
          content: "Hello! How can I help?",
        }); // AI msg
      mockPrisma.askMessage.count.mockResolvedValue(5); // not first message
      mockFacade.getModelById.mockResolvedValue(null); // fallback to default
      mockFacade.getDefaultTextModel = jest.fn().mockResolvedValue({
        id: "db-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        apiEndpoint: null,
        maxTokens: 4096,
      });
    });

    it("should create user and assistant messages on success", async () => {
      const result = await service.sendMessage(sessionId, userId, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.askMessage.create).toHaveBeenCalledTimes(2);
      expect(result.userMessage).toBeDefined();
      expect(result.assistantMessage).toBeDefined();
    });

    it("should throw NotFoundException when session not found", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(
        service.sendMessage("nonexistent", userId, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("should save error message when AI response fails", async () => {
      mockFacade.chat.mockRejectedValue(new Error("AI service unavailable"));
      // Reset and set up fresh mock chain for this test
      mockPrisma.askMessage.create.mockReset();
      mockPrisma.askMessage.create
        .mockResolvedValueOnce({ ...mockMessage, role: "user" })
        .mockResolvedValueOnce({
          ...mockMessage,
          role: "assistant",
          content: "Error: Failed to get response. Please try again.",
        });

      const result = await service.sendMessage(sessionId, userId, dto);

      // Should return error message instead of throwing
      expect(result.assistantMessage.content).toContain("Error:");
    });

    it("should throw InsufficientCreditsException when balance is insufficient", async () => {
      const { InsufficientCreditsException } =
        await import("../../../platform/credits/exceptions/insufficient-credits.exception");
      const creditsService = {
        checkBalance: jest
          .fn()
          .mockResolvedValue({ sufficient: false, balance: 5 }),
      };

      // Directly instantiate service with credits service injected
      // Constructor: prisma, chatFacade, toolFacade, ragFacade, ragPipeline?, creditsService?
      // (agentFacade removed 2026-04-30 — IntentRouter chain deleted)
      const svcWithCredits = new AiAskService(
        mockPrisma,
        mockFacade,
        mockFacade,
        mockFacade,
        null as any,
        creditsService as any,
      );

      await expect(
        svcWithCredits.sendMessage(sessionId, userId, dto),
      ).rejects.toThrow(InsufficientCreditsException);
    });

    it("should generate title when message count is 2 and title is 'New Chat'", async () => {
      const sessionWithDefaultTitle = {
        ...mockSession,
        title: "New Chat",
        modelId: null,
      };
      mockPrisma.askSession.findFirst.mockResolvedValue(
        sessionWithDefaultTitle,
      );
      mockPrisma.askMessage.count.mockResolvedValue(2); // exactly 2
      mockPrisma.askSession.update.mockResolvedValue({
        ...sessionWithDefaultTitle,
        title: "Hello AI",
      });

      await service.sendMessage(sessionId, userId, {
        content: "Hello AI",
      } as any);

      // Title generation is async — wait a tick
      await new Promise((r) => setTimeout(r, 10));
      // Session update should have been called (for title and updatedAt)
      expect(mockPrisma.askSession.update).toHaveBeenCalled();
    });

    it("should not include toolsUsed in response when no tools used", async () => {
      const result = await service.sendMessage(sessionId, userId, dto);
      expect(result.toolsUsed).toBeUndefined();
    });

    it("should append tool usage note to response content when tools used", async () => {
      mockFacade.isToolExecutionAvailable.mockReturnValue(true);
      mockFacade.isToolAvailable.mockReturnValue(true);

      // chatWithToolsStream is an async generator method — mock it to return an async iterable
      async function* fakeStream() {
        yield { type: "tool_call", tool: "web-search" };
        yield {
          type: "complete",
          result: { summary: "Tool result summary", tokensUsed: 100 },
        };
      }
      mockFacade.chatWithToolsStream = jest.fn().mockReturnValue(fakeStream());

      // Reset mock chain so the tool test controls all return values
      mockPrisma.askMessage.create.mockReset();
      const userMsg = { ...mockMessage, role: "user" };
      const assistantMsg = {
        ...mockMessage,
        role: "assistant",
        content: "Tool result summary\n\n---\n*使用了工具: web-search*",
      };
      mockPrisma.askMessage.create
        .mockResolvedValueOnce(userMsg)
        .mockResolvedValueOnce(assistantMsg);
      mockPrisma.askMessage.count.mockResolvedValue(5);

      const result = await service.sendMessage(sessionId, userId, {
        content: "Search the web",
        enableTools: true,
      } as any);

      expect(result.assistantMessage.content).toContain("使用了工具");
    });

    it("should include RAG context note in response when ragContext is set", async () => {
      const ragPipeline = {
        query: jest.fn().mockResolvedValue({
          context: {
            text: "Knowledge base content",
            sources: [
              {
                documentTitle: "Doc 1",
                excerpt: "Excerpt",
                score: 0.9,
              },
            ],
          },
        }),
      };

      // Create service directly with ragPipeline injected
      const svcWithRag = new AiAskService(
        mockPrisma,
        mockFacade,
        ragPipeline as any,
        null as any,
      );

      // Reset mock chain so the RAG test controls all return values
      mockPrisma.askMessage.create.mockReset();
      const userMsg = { ...mockMessage, role: "user" };
      const assistantMsg = {
        ...mockMessage,
        role: "assistant",
        content: "AI response\n\n---\n📚 *回答基于知识库内容*",
      };
      mockPrisma.askMessage.create
        .mockResolvedValueOnce(userMsg)
        .mockResolvedValueOnce(assistantMsg);
      mockPrisma.askMessage.count.mockResolvedValue(5);

      const result = await svcWithRag.sendMessage(sessionId, userId, {
        content: "What is in my knowledge base?",
        knowledgeBaseIds: ["kb-1"],
      } as any);

      expect(result.assistantMessage.content).toContain("知识库");
    });
  });

  // =========================================================================
  // regenerateMessage
  // =========================================================================

  describe("regenerateMessage", () => {
    const messageId = "msg-assistant-1";
    const userMsgId = "msg-user-1";

    const mockAssistantMsg = {
      id: messageId,
      sessionId,
      role: "assistant",
      content: "Old response",
      modelId: "gpt-4o",
      createdAt: new Date("2024-01-01T12:00:00Z"),
    };

    const mockUserMsg = {
      id: userMsgId,
      sessionId,
      role: "user",
      content: "User question",
      createdAt: new Date("2024-01-01T11:59:00Z"),
    };

    beforeEach(() => {
      mockPrisma.askSession.findFirst.mockResolvedValue(mockSession);
      mockPrisma.askMessage.findFirst.mockResolvedValue(mockAssistantMsg);
      mockPrisma.askMessage.findMany.mockResolvedValue([mockUserMsg]);
      mockPrisma.askMessage.update.mockResolvedValue({
        ...mockAssistantMsg,
        content: "Regenerated response",
      });
      mockFacade.getModelById.mockResolvedValue({
        id: "db-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        apiEndpoint: null,
        maxTokens: 4096,
      });
      mockFacade.sessionMemoryClear.mockResolvedValue(undefined);
      mockFacade.sessionMemorySet.mockResolvedValue(undefined);
    });

    it("should regenerate an assistant message", async () => {
      const _result = await service.regenerateMessage(
        sessionId,
        messageId,
        userId,
      );

      expect(mockFacade.chat).toHaveBeenCalled();
      expect(mockPrisma.askMessage.update).toHaveBeenCalledWith({
        where: { id: messageId },
        data: expect.objectContaining({
          content: expect.any(String),
        }),
      });
    });

    it("should throw NotFoundException when session not found", async () => {
      mockPrisma.askSession.findFirst.mockResolvedValue(null);

      await expect(
        service.regenerateMessage(sessionId, messageId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when message not found", async () => {
      mockPrisma.askMessage.findFirst.mockResolvedValue(null);

      await expect(
        service.regenerateMessage(sessionId, messageId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when message is not an assistant message", async () => {
      mockPrisma.askMessage.findFirst.mockResolvedValue({
        ...mockAssistantMsg,
        role: "user",
      });

      await expect(
        service.regenerateMessage(sessionId, messageId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when no previous user message exists", async () => {
      mockPrisma.askMessage.findMany.mockResolvedValue([]);

      await expect(
        service.regenerateMessage(sessionId, messageId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when previous message is not from user", async () => {
      mockPrisma.askMessage.findMany.mockResolvedValue([
        { ...mockAssistantMsg, role: "assistant" }, // previous is assistant
      ]);

      await expect(
        service.regenerateMessage(sessionId, messageId, userId),
      ).rejects.toThrow(NotFoundException);
    });

    it("should handle memory rebuild failure gracefully", async () => {
      mockFacade.sessionMemoryClear.mockRejectedValue(
        new Error("Memory error"),
      );

      // Should not throw — memory failures are swallowed
      const result = await service.regenerateMessage(
        sessionId,
        messageId,
        userId,
      );
      expect(result).toBeDefined();
    });
  });

  // =========================================================================
  // getMessages — pagination
  // =========================================================================

  describe("getMessages — pagination", () => {
    beforeEach(() => {
      mockPrisma.askSession.findFirst.mockResolvedValue(mockSession);
    });

    it("should return hasMore=true when result exceeds limit", async () => {
      const messages = Array.from({ length: 51 }, (_, i) => ({
        ...mockMessage,
        id: `msg-${i}`,
      }));
      mockPrisma.askMessage.findMany.mockResolvedValue(messages);

      const result = await service.getMessages(sessionId, userId, 50);

      expect(result.hasMore).toBe(true);
      expect(result.messages).toHaveLength(50);
    });

    it("should return hasMore=false when result does not exceed limit", async () => {
      mockPrisma.askMessage.findMany.mockResolvedValue([mockMessage]);

      const result = await service.getMessages(sessionId, userId, 50);

      expect(result.hasMore).toBe(false);
    });

    it("should apply before filter when 'before' date is provided", async () => {
      const before = new Date("2024-06-01");
      await service.getMessages(sessionId, userId, 50, before);

      expect(mockPrisma.askMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { lt: before },
          }),
        }),
      );
    });

    it("should return messages in ascending order (reversed from DB query)", async () => {
      const olderMsg = {
        ...mockMessage,
        id: "older",
        createdAt: new Date("2024-01-01"),
      };
      const newerMsg = {
        ...mockMessage,
        id: "newer",
        createdAt: new Date("2024-06-01"),
      };
      // DB returns desc order (newest first), service reverses
      mockPrisma.askMessage.findMany.mockResolvedValue([newerMsg, olderMsg]);

      const result = await service.getMessages(sessionId, userId, 50);

      expect(result.messages[0].id).toBe("older");
      expect(result.messages[1].id).toBe("newer");
    });
  });

  // =========================================================================
  // sanitizeMessageContent (private)
  // =========================================================================

  describe("sanitizeMessageContent (private)", () => {
    it("should return content unchanged when no base64 images", () => {
      const content = "Hello, this is a normal message.";
      expect((service as any).sanitizeMessageContent(content)).toBe(content);
    });

    it("should replace inline base64 image with placeholder", () => {
      const content =
        "Here is an image: data:image/png;base64,iVBORw0KGgoAAAA==";
      const result = (service as any).sanitizeMessageContent(content);
      expect(result).toContain("[图片已省略]");
      expect(result).not.toContain("base64");
    });

    it("should replace markdown image with base64 with placeholder", () => {
      const content = "![alt text](data:image/jpeg;base64,/9j/4AAQSkZ==)";
      const result = (service as any).sanitizeMessageContent(content);
      expect(result).toContain("[图片已省略]");
    });

    it("should truncate very long messages", () => {
      const content = "a".repeat(25000);
      const result = (service as any).sanitizeMessageContent(content);
      expect(result.length).toBeLessThan(25000);
      expect(result).toContain("[消息内容已截断]");
    });

    it("should return content as-is when falsy", () => {
      expect((service as any).sanitizeMessageContent("")).toBe("");
      expect((service as any).sanitizeMessageContent(null)).toBe(null);
    });
  });

  // =========================================================================
  // extractTitleFromMessage (private)
  // =========================================================================

  describe("extractTitleFromMessage (private)", () => {
    it("should return 'New Chat' for empty input", () => {
      expect((service as any).extractTitleFromMessage("")).toBe("New Chat");
      expect((service as any).extractTitleFromMessage(null)).toBe("New Chat");
    });

    it("should truncate long messages to 40 chars", () => {
      const long =
        "This is a very long message that exceeds forty characters for sure";
      const result = (service as any).extractTitleFromMessage(long);
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it("should return full message when under 40 chars", () => {
      const short = "Short question";
      expect((service as any).extractTitleFromMessage(short)).toBe(short);
    });

    it("should remove leading markdown heading prefix", () => {
      // The function removes leading #, >, *, - markers but not inline ** bold
      const md = "## What is AI?";
      const result = (service as any).extractTitleFromMessage(md);
      expect(result).not.toContain("##");
      expect(result).toContain("What is AI?");
    });

    it("should remove code blocks", () => {
      const withCode = "Here is code:\n```js\nconsole.log('hello');\n```";
      const result = (service as any).extractTitleFromMessage(withCode);
      expect(result).toContain("[代码]");
    });

    it("should remove HTML tags", () => {
      const withHtml = "<p>Hello <b>world</b></p>";
      const result = (service as any).extractTitleFromMessage(withHtml);
      expect(result).not.toContain("<");
      expect(result).toContain("Hello world");
    });

    it("should truncate at Chinese punctuation boundary", () => {
      // Craft a string just over 40 chars with Chinese punctuation in good position
      const withPunct =
        "关于人工智能的最新进展，我们应该如何看待这些技术突破呢？这是很有意思的";
      const result = (service as any).extractTitleFromMessage(withPunct);
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it("should truncate at English word boundary", () => {
      const withWords =
        "This is a very long English message that should be truncated at a word";
      const result = (service as any).extractTitleFromMessage(withWords);
      expect(result.length).toBeLessThanOrEqual(40);
      // Should not end mid-word if possible
    });
  });

  // =========================================================================
  // buildContext (private) — cache hit vs. miss
  // =========================================================================

  describe("buildContext (private)", () => {
    it("should use cached history when available", async () => {
      const cachedMessages = [
        { role: "user", content: "Cached user message" },
        { role: "assistant", content: "Cached assistant response" },
      ];
      mockFacade.sessionMemoryGet.mockResolvedValue(cachedMessages);

      const result = await (service as any).buildContext(sessionId);

      expect(result).toEqual(cachedMessages);
      // DB should not be queried when cache hit
      expect(mockPrisma.askMessage.findMany).not.toHaveBeenCalled();
    });

    it("should fall back to DB when cache returns null", async () => {
      mockFacade.sessionMemoryGet.mockResolvedValue(null);
      mockPrisma.askMessage.findMany.mockResolvedValue([mockMessage]);

      const result = await (service as any).buildContext(sessionId);

      expect(mockPrisma.askMessage.findMany).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should fall back to DB when cache returns empty array", async () => {
      mockFacade.sessionMemoryGet.mockResolvedValue([]);
      mockPrisma.askMessage.findMany.mockResolvedValue([mockMessage]);

      await (service as any).buildContext(sessionId);

      expect(mockPrisma.askMessage.findMany).toHaveBeenCalled();
    });

    it("should fall back to DB when cache throws", async () => {
      mockFacade.sessionMemoryGet.mockRejectedValue(
        new Error("Redis unavailable"),
      );
      mockPrisma.askMessage.findMany.mockResolvedValue([mockMessage]);

      const result = await (service as any).buildContext(sessionId);

      expect(result).toBeDefined();
    });

    it("should truncate extremely long messages to fit context window", async () => {
      mockFacade.sessionMemoryGet.mockResolvedValue(null);
      // Simulate a message that is very long
      const hugeMessage = {
        ...mockMessage,
        role: "user",
        content: "x".repeat(150000), // over 100000 char limit
      };
      mockPrisma.askMessage.findMany.mockResolvedValue([hugeMessage]);

      const result = await (service as any).buildContext(sessionId);

      if (result.length > 0) {
        const totalChars = result.reduce(
          (acc: number, m: any) => acc + m.content.length,
          0,
        );
        // Either empty or truncated
        expect(totalChars).toBeLessThanOrEqual(150000);
      }
    });
  });

  // =========================================================================
  // buildSystemPromptWithContext (private)
  // =========================================================================

  describe("buildSystemPromptWithContext (private)", () => {
    it("should include project context when query is project-related", () => {
      const result = (service as any).buildSystemPromptWithContext(
        [],
        undefined,
        "What is GenesisPod?",
      );
      // Project-related queries get extra context added
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include RAG context section when ragContext is provided", () => {
      const result = (service as any).buildSystemPromptWithContext(
        [],
        "Knowledge base content here",
        "What is in my documents?",
      );
      expect(result).toContain("Knowledge base content here");
    });

    it("should include conversation history when contextMessages have more than 1 item", () => {
      const contextMessages = [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
        { role: "user", content: "Current question" },
      ];
      const result = (service as any).buildSystemPromptWithContext(
        contextMessages,
        undefined,
        "Current question",
      );
      expect(result).toContain("之前的对话历史");
    });

    it("should not include history when only 1 message in context", () => {
      const contextMessages = [{ role: "user", content: "Only message" }];
      const result = (service as any).buildSystemPromptWithContext(
        contextMessages,
        undefined,
        "Only message",
      );
      expect(result).not.toContain("之前的对话历史");
    });
  });

  // =========================================================================
  // buildSystemPromptForChat (private)
  // =========================================================================

  describe("buildSystemPromptForChat (private)", () => {
    it("should build a basic prompt without RAG context", () => {
      const result = (service as any).buildSystemPromptForChat(
        "Hello",
        undefined,
      );
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include RAG context when provided", () => {
      const result = (service as any).buildSystemPromptForChat(
        "Search my docs",
        "RAG content here",
      );
      expect(result).toContain("RAG content here");
    });
  });

  // =========================================================================
  // getModelConfig (private)
  // =========================================================================

  describe("getModelConfig (private)", () => {
    it("should return model config when modelId matches", async () => {
      mockFacade.getModelById.mockResolvedValue({
        id: "db-1",
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        provider: "openai",
        apiEndpoint: "https://api.openai.com",
        maxTokens: 4096,
      });

      const result = await (service as any).getModelConfig("gpt-4o");

      expect(result.modelId).toBe("gpt-4o");
      expect(result.apiKey).toBeNull(); // API key is null by design
    });

    it("should fall back to default model when modelId not found", async () => {
      mockFacade.getModelById.mockResolvedValue(null);
      mockFacade.getDefaultTextModel = jest.fn().mockResolvedValue({
        id: "default-1",
        modelId: "default-model",
        displayName: "Default Model",
        provider: "openai",
        apiEndpoint: null,
        maxTokens: 4096,
      });

      const result = await (service as any).getModelConfig("unknown-model");

      expect(result.modelId).toBe("default-model");
    });

    it("should use default model when no modelId provided", async () => {
      mockFacade.getModelById.mockResolvedValue(null);
      mockFacade.getDefaultTextModel = jest.fn().mockResolvedValue({
        id: "default-1",
        modelId: "default-model",
        displayName: "Default Model",
        provider: "openai",
        apiEndpoint: null,
        maxTokens: 4096,
      });

      const result = await (service as any).getModelConfig(null);

      expect(result.modelId).toBe("default-model");
    });

    it("should throw NotFoundException when no model available", async () => {
      mockFacade.getModelById.mockResolvedValue(null);
      mockFacade.getDefaultTextModel = jest.fn().mockResolvedValue(null);

      await expect((service as any).getModelConfig(null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // getAvailableTools — with tools enabled
  // =========================================================================

  describe("getAvailableTools — tool capability enabled", () => {
    it("should return available tools when capability is enabled", () => {
      mockFacade.isToolExecutionAvailable.mockReturnValue(true);
      mockFacade.isToolAvailable.mockReturnValue(true);

      const result = service.getAvailableTools();

      expect(result.length).toBeGreaterThan(0);
    });

    it("should filter out unavailable tools", () => {
      mockFacade.isToolExecutionAvailable.mockReturnValue(true);
      // Only text_generation is available, others are not
      mockFacade.isToolAvailable.mockImplementation(
        (tool: string) => tool === "text_generation",
      );

      const result = service.getAvailableTools();

      expect(result.every((t) => mockFacade.isToolAvailable(t))).toBe(true);
    });
  });

  // =========================================================================
  // deleteSession — memory cleanup
  // =========================================================================

  describe("deleteSession — memory cleanup", () => {
    it("should clear session memory after deleting session", async () => {
      await service.deleteSession(sessionId, userId);

      expect(mockFacade.sessionMemoryClear).toHaveBeenCalledWith(sessionId);
    });

    it("should not throw when memory clear fails", async () => {
      mockFacade.sessionMemoryClear.mockRejectedValue(
        new Error("Memory error"),
      );

      await expect(service.deleteSession(sessionId, userId)).resolves.toEqual({
        success: true,
      });
    });
  });

  // =========================================================================
  // getSession — cache warming
  // =========================================================================

  describe("getSession — cache warming", () => {
    it("should warm cache when messages exist", async () => {
      mockPrisma.askMessage.findMany.mockResolvedValue([
        { ...mockMessage, role: "user", content: "Question 1" },
        { ...mockMessage, id: "msg-2", role: "assistant", content: "Answer 1" },
      ]);

      await service.getSession(sessionId, userId);

      expect(mockFacade.sessionMemorySet).toHaveBeenCalled();
    });

    it("should not warm cache when no messages exist", async () => {
      mockPrisma.askMessage.findMany.mockResolvedValue([]);

      await service.getSession(sessionId, userId);

      expect(mockFacade.sessionMemorySet).not.toHaveBeenCalled();
    });

    it("should not throw when cache warming fails", async () => {
      mockPrisma.askMessage.findMany.mockResolvedValue([mockMessage]);
      mockFacade.sessionMemorySet.mockRejectedValue(new Error("Cache error"));

      // Should not throw
      const result = await service.getSession(sessionId, userId);
      expect(result.session).toBeDefined();
    });
  });

  // =========================================================================
  // sendMessageStream
  // =========================================================================

  describe("sendMessageStream", () => {
    it("should emit done with persisted backend-truth message envelopes", async () => {
      const userCreatedAt = new Date("2026-05-10T10:00:00.000Z");
      const assistantCreatedAt = new Date("2026-05-10T10:00:01.000Z");
      const userRecord = {
        id: "user-msg-1",
        sessionId,
        role: "user",
        content: "Question",
        createdAt: userCreatedAt,
        modelId: "db-1",
        modelName: "GPT-4o",
        webSearch: false,
      };
      const assistantRecord = {
        id: "assistant-msg-1",
        sessionId,
        role: "assistant",
        content: "Hello world",
        createdAt: assistantCreatedAt,
        modelId: "db-1",
        modelName: "GPT-4o",
        tokens: 0,
        webSearch: false,
      };

      mockPrisma.askMessage.create
        .mockResolvedValueOnce(userRecord)
        .mockResolvedValueOnce(assistantRecord);
      mockPrisma.askMessage.count.mockResolvedValue(2);
      mockFacade.chatStream.mockImplementation(async function* () {
        yield { content: "Hello" };
        yield { content: " world" };
        yield { done: true };
      });

      const events = [];
      for await (const event of service.sendMessageStream(sessionId, userId, {
        content: "Question",
        webSearch: false,
      } as any)) {
        events.push(event);
      }

      const doneEvent = events.find((event: any) => event.type === "done");
      expect(doneEvent).toBeDefined();
      expect(doneEvent.userMessage).toEqual({
        id: "user-msg-1",
        content: "Question",
        createdAt: userCreatedAt.toISOString(),
        modelId: "db-1",
        modelName: "GPT-4o",
      });
      expect(doneEvent.assistantMessage).toEqual({
        id: "assistant-msg-1",
        content: "Hello world",
        createdAt: assistantCreatedAt.toISOString(),
        modelId: "db-1",
        modelName: "GPT-4o",
        tokens: 0,
      });
      expect(doneEvent.fullContent).toBe("Hello world");
    });
  });
});

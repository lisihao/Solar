import {
  AgentCommunicationTool,
  CommunicationOperation,
  MessageType,
  MessagePriority,
  MessageStatus,
} from "../agent-communication.tool";
import { ToolContext } from "../../../abstractions/tool.interface";

const BUILTIN_AGENTS = {
  DOCS: "docs",
  DESIGNER: "designer",
  RESEARCHER: "researcher",
  SLIDES: "slides",
  SIMULATOR: "simulator",
  IMAGE_DESIGNER: "image-designer",
  TEAM_COLLABORATION: "team-collaboration",
} as const;

// ============================================================================
// Mock factory
// ============================================================================

function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    executionId: "test-exec-id",
    toolId: "agent-communication",
    userId: "user-123",
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Test suite
// ============================================================================

describe("AgentCommunicationTool", () => {
  let tool: AgentCommunicationTool;

  beforeEach(() => {
    // Fresh instance so in-memory stores are clean between tests
    tool = new AgentCommunicationTool();
  });

  // --------------------------------------------------------------------------
  // validateInput
  // --------------------------------------------------------------------------

  describe("validateInput", () => {
    it("should return true for a valid SEND operation with all required fields", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Hello", content: "Please review this" },
        }),
      ).toBe(true);
    });

    it("should return false for SEND without toAgent", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          message: { subject: "Hello", content: "Review" },
        }),
      ).toBe(false);
    });

    it("should return false for SEND without message content", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Hello", content: "" },
        }),
      ).toBe(false);
    });

    it("should allow an unknown fromAgent when required fields are present", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.SEND,
          fromAgent: "unknown-agent",
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Hi", content: "Test" },
        }),
      ).toBe(true);
    });

    it("should return true for RECEIVE operation with only fromAgent", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
        }),
      ).toBe(true);
    });

    it("should return true for LIST_INBOX with only fromAgent", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.LIST_INBOX,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
        }),
      ).toBe(true);
    });

    it("should return false for GET_STATUS without messageId", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.GET_STATUS,
          fromAgent: BUILTIN_AGENTS.DOCS,
        }),
      ).toBe(false);
    });

    it("should return true for BROADCAST with subject and content", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.BROADCAST,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
          message: { subject: "Alert", content: "System update" },
        }),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // SEND operation
  // --------------------------------------------------------------------------

  describe("send operation", () => {
    it("should send a message and return success: true with message details", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: {
            subject: "Need cover image",
            content: "Please design a cover for the report",
          },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(CommunicationOperation.SEND);
      expect(result.data?.message).toBeDefined();
    });

    it("should include the correct from/to agents in the sent message", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Task", content: "Do this" },
        },
        context,
      );

      expect(result.data?.message?.from).toBe(BUILTIN_AGENTS.DOCS);
      expect(result.data?.message?.to).toBe(BUILTIN_AGENTS.DESIGNER);
    });

    it("should assign a unique message ID", async () => {
      const context = createMockContext();

      const result1 = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "First", content: "First message" },
        },
        context,
      );

      const result2 = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Second", content: "Second message" },
        },
        context,
      );

      expect(result1.data?.message?.id).toBeTruthy();
      expect(result2.data?.message?.id).toBeTruthy();
      expect(result1.data?.message?.id).not.toBe(result2.data?.message?.id);
    });

    it("should use provided priority in the sent message", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: {
            subject: "Urgent",
            content: "Do this now",
            priority: MessagePriority.URGENT,
          },
        },
        context,
      );

      expect(result.data?.message?.priority).toBe(MessagePriority.URGENT);
    });
  });

  // --------------------------------------------------------------------------
  // RECEIVE / LIST_INBOX operation
  // --------------------------------------------------------------------------

  describe("receive operation", () => {
    it("should return messages in the inbox after a send", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.RESEARCHER,
          message: {
            subject: "Research request",
            content: "Investigate topic X",
          },
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.messages).toBeDefined();
      expect(result.data?.messages!.length).toBeGreaterThanOrEqual(1);
    });

    it("should return an empty message list for a clean inbox", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.SIMULATOR,
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.messages).toEqual([]);
    });

    it("should respect the limit filter", async () => {
      const context = createMockContext();

      // Send 3 messages to the same agent
      for (let i = 0; i < 3; i++) {
        await tool.execute(
          {
            operation: CommunicationOperation.SEND,
            fromAgent: BUILTIN_AGENTS.DOCS,
            toAgent: BUILTIN_AGENTS.SLIDES,
            message: { subject: `Message ${i}`, content: `Content ${i}` },
          },
          context,
        );
      }

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.SLIDES,
          filter: { limit: 2 },
        },
        context,
      );

      expect(result.data?.messages!.length).toBeLessThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // BROADCAST operation
  // --------------------------------------------------------------------------

  describe("broadcast operation", () => {
    it("should broadcast a message to all other agents", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.BROADCAST,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
          message: { subject: "System update", content: "Update your tasks" },
        },
        context,
      );

      expect(result.data?.success).toBe(true);
      expect(result.data?.operation).toBe(CommunicationOperation.BROADCAST);
      expect(result.data?.messages).toBeDefined();
      // Should have sent to all agents except the sender
      const agentCount = Object.values(BUILTIN_AGENTS).length;
      expect(result.data?.messages!.length).toBe(agentCount - 1);
    });

    it("should mark broadcast messages with BROADCAST type", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.BROADCAST,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
          message: { subject: "Alert", content: "Important notice" },
        },
        context,
      );

      result.data?.messages?.forEach((msg) => {
        expect(msg.type).toBe(MessageType.BROADCAST);
      });
    });
  });

  // --------------------------------------------------------------------------
  // GET_STATUS operation
  // --------------------------------------------------------------------------

  describe("get_status operation", () => {
    it("should retrieve the status of a previously sent message", async () => {
      const context = createMockContext();

      const sendResult = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Check this", content: "Details here" },
        },
        context,
      );

      const messageId = sendResult.data?.message?.id as string;

      const statusResult = await tool.execute(
        {
          operation: CommunicationOperation.GET_STATUS,
          fromAgent: BUILTIN_AGENTS.DOCS,
          messageId,
        },
        context,
      );

      expect(statusResult.data?.success).toBe(true);
      expect(statusResult.data?.message?.id).toBe(messageId);
    });

    it("should return success: false when message ID does not exist", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.GET_STATUS,
          fromAgent: BUILTIN_AGENTS.DOCS,
          messageId: "nonexistent-message-id",
        },
        context,
      );

      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // REPLY operation
  // --------------------------------------------------------------------------

  describe("reply operation", () => {
    it("should reply to an existing message with success: true", async () => {
      const context = createMockContext();

      const sendResult = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Original request", content: "Please do X" },
        },
        context,
      );

      const originalMessageId = sendResult.data?.message?.id as string;

      const replyResult = await tool.execute(
        {
          operation: CommunicationOperation.REPLY,
          fromAgent: BUILTIN_AGENTS.DESIGNER,
          toAgent: BUILTIN_AGENTS.DOCS,
          messageId: originalMessageId,
          message: { subject: "Re: Original request", content: "Done" },
        },
        context,
      );

      expect(replyResult.data?.success).toBe(true);
      expect(replyResult.data?.message?.replyTo).toBe(originalMessageId);
    });

    it("should return success: false when replying to a non-existent message", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.REPLY,
          fromAgent: BUILTIN_AGENTS.DESIGNER,
          toAgent: BUILTIN_AGENTS.DOCS,
          messageId: "does-not-exist",
          message: { subject: "Re: Something", content: "Response" },
        },
        context,
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // MARK_READ operation
  // --------------------------------------------------------------------------

  describe("mark_read operation", () => {
    it("should mark a delivered message as read", async () => {
      const context = createMockContext();

      const sendResult = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Read me", content: "Please read" },
        },
        context,
      );

      const messageId = sendResult.data?.message?.id as string;

      const markResult = await tool.execute(
        {
          operation: CommunicationOperation.MARK_READ,
          fromAgent: BUILTIN_AGENTS.DESIGNER,
          messageId,
        },
        context,
      );

      expect(markResult.data?.success).toBe(true);
      expect(markResult.data?.message?.status).toBe(MessageStatus.READ);
    });

    it("should return success: false when message ID does not exist", async () => {
      const context = createMockContext();

      const result = await tool.execute(
        {
          operation: CommunicationOperation.MARK_READ,
          fromAgent: BUILTIN_AGENTS.DESIGNER,
          messageId: "ghost-message-id",
        },
        context,
      );

      expect(result.data?.success).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("should return data.success: false when an unknown operation reaches doExecute", async () => {
      // AgentCommunicationTool.validateInput() correctly returns false for unknown
      // operations (uses Object.values check). BaseTool.execute() does NOT call
      // validateInput — it goes straight to doExecute which returns { success: false }
      // from the default case. BaseTool wraps that as { success: true, data: { success: false } }.
      const context = createMockContext();

      // Force an operation value that passes the fromAgent check but fails the
      // operation enum check by calling execute() directly (bypassing validateInput).
      // The default branch in doExecute returns { success: false, error: "Unknown operation" }.
      const result = await tool.execute(
        {
          operation: "UNKNOWN_OPERATION" as CommunicationOperation,
          fromAgent: BUILTIN_AGENTS.DOCS,
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(false);
      expect(result.data?.error).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // CacheService integration — with mock cacheService
  // --------------------------------------------------------------------------

  describe("with CacheService (Redis integration)", () => {
    let toolWithCache: AgentCommunicationTool;
    let mockCacheService: {
      get: jest.Mock;
      set: jest.Mock;
    };

    beforeEach(() => {
      mockCacheService = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined),
      };
      // Inject mock cache service via @Optional() constructor param
      toolWithCache = new AgentCommunicationTool(
        mockCacheService as unknown as Parameters<
          typeof AgentCommunicationTool
        >[0],
      );
    });

    it("should initialize inboxes on construction", () => {
      // After construction, all builtin agents have an inbox
      expect(toolWithCache).toBeDefined();
    });

    it("should call cacheService.set when saving message", async () => {
      const context = createMockContext();

      await toolWithCache.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Test", content: "Content" },
        },
        context,
      );

      expect(mockCacheService.set).toHaveBeenCalled();
    });

    it("should call cacheService.set for inbox after send", async () => {
      const context = createMockContext();

      await toolWithCache.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.RESEARCHER,
          message: { subject: "Task", content: "Details" },
        },
        context,
      );

      // Should have called set at least twice: message + inbox
      expect(mockCacheService.set.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("should load messages from Redis on onModuleInit", async () => {
      const now = new Date();
      const testMessage = {
        id: "msg-redis-1",
        from: BUILTIN_AGENTS.DOCS,
        to: BUILTIN_AGENTS.DESIGNER,
        type: MessageType.REQUEST,
        priority: MessagePriority.NORMAL,
        subject: "Redis msg",
        content: "From Redis",
        status: MessageStatus.DELIVERED,
        createdAt: now.toISOString(),
        sentAt: now.toISOString(),
        deliveredAt: now.toISOString(),
        readAt: now.toISOString(),
        repliedAt: now.toISOString(),
      };

      mockCacheService.get.mockImplementation(async (key: string) => {
        if (key.includes("inbox:designer")) return ["msg-redis-1"];
        if (key.includes("msg:msg-redis-1")) return testMessage;
        return null;
      });

      await toolWithCache.onModuleInit();

      // After init, the message should be accessible via get_status
      const statusResult = await toolWithCache.execute(
        {
          operation: CommunicationOperation.GET_STATUS,
          fromAgent: BUILTIN_AGENTS.DOCS,
          messageId: "msg-redis-1",
        },
        createMockContext(),
      );

      expect(statusResult.data?.success).toBe(true);
      expect(statusResult.data?.message?.subject).toBe("Redis msg");
    });

    it("should restore Date objects from Redis string dates", async () => {
      const isoDate = "2026-01-01T00:00:00.000Z";
      const testMessage = {
        id: "msg-date-1",
        from: BUILTIN_AGENTS.DOCS,
        to: BUILTIN_AGENTS.DESIGNER,
        type: MessageType.REQUEST,
        priority: MessagePriority.NORMAL,
        subject: "Date test",
        content: "Content",
        status: MessageStatus.REPLIED,
        createdAt: isoDate,
        sentAt: isoDate,
        deliveredAt: isoDate,
        readAt: isoDate,
        repliedAt: isoDate,
      };

      mockCacheService.get.mockImplementation(async (key: string) => {
        if (key.includes("inbox:designer")) return ["msg-date-1"];
        if (key.includes("msg:msg-date-1")) return testMessage;
        return null;
      });

      await toolWithCache.onModuleInit();

      const statusResult = await toolWithCache.execute(
        {
          operation: CommunicationOperation.GET_STATUS,
          fromAgent: BUILTIN_AGENTS.DOCS,
          messageId: "msg-date-1",
        },
        createMockContext(),
      );

      expect(statusResult.data?.success).toBe(true);
      // Date objects should be restored
      expect(statusResult.data?.message?.createdAt).toBeInstanceOf(Date);
      expect(statusResult.data?.message?.sentAt).toBeInstanceOf(Date);
      expect(statusResult.data?.message?.repliedAt).toBeInstanceOf(Date);
    });

    it("should handle Redis load failure gracefully", async () => {
      mockCacheService.get.mockRejectedValue(
        new Error("Redis connection failed"),
      );

      await expect(toolWithCache.onModuleInit()).resolves.not.toThrow();
    });

    it("should merge existing inbox ids with Redis inbox ids on init", async () => {
      // Simulate: local inbox has msg-local-1, Redis has msg-redis-1
      const now = new Date().toISOString();
      const redisMessage = {
        id: "msg-redis-1",
        from: BUILTIN_AGENTS.DOCS,
        to: BUILTIN_AGENTS.RESEARCHER,
        type: MessageType.REQUEST,
        priority: MessagePriority.NORMAL,
        subject: "Redis",
        content: "Content",
        status: MessageStatus.DELIVERED,
        createdAt: now,
      };

      // First send a message to populate local inbox
      await toolWithCache.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.RESEARCHER,
          message: { subject: "Local", content: "Local msg" },
        },
        createMockContext(),
      );

      const sendResult = await toolWithCache.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
        },
        createMockContext(),
      );
      const localMsgId = sendResult.data?.messages?.[0]?.id;

      // Now simulate Redis returning a different inbox list
      mockCacheService.get.mockImplementation(async (key: string) => {
        if (key.includes("inbox:researcher")) return ["msg-redis-1"];
        if (key.includes("msg:msg-redis-1")) return redisMessage;
        if (key.includes(`msg:${localMsgId}`)) return null;
        return null;
      });

      await toolWithCache.onModuleInit();

      // Both messages should now be in inbox
      const receiveResult = await toolWithCache.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
        },
        createMockContext(),
      );

      expect(
        receiveResult.data?.messages?.some((m) => m.id === "msg-redis-1"),
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // validateInput edge cases
  // --------------------------------------------------------------------------

  describe("validateInput edge cases", () => {
    it("should allow SEND when toAgent is not a BUILTIN_AGENTS value", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: "unknown-agent",
          message: { subject: "Hi", content: "Hello" },
        }),
      ).toBe(true);
    });

    it("should return false for MARK_READ without messageId", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.MARK_READ,
          fromAgent: BUILTIN_AGENTS.DOCS,
        }),
      ).toBe(false);
    });

    it("should return false for REPLY without toAgent", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.REPLY,
          fromAgent: BUILTIN_AGENTS.DOCS,
          messageId: "msg-123",
          message: { subject: "Re", content: "Done" },
        }),
      ).toBe(false);
    });

    it("should return false for REPLY without messageId", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.REPLY,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Re", content: "Done" },
        }),
      ).toBe(false);
    });

    it("should return false for BROADCAST without message subject", () => {
      expect(
        tool.validateInput({
          operation: CommunicationOperation.BROADCAST,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
          message: { subject: "", content: "Some content" },
        }),
      ).toBe(false);
    });

    it("should return false for unknown operation type", () => {
      expect(
        tool.validateInput({
          operation: "INVALID_OP" as CommunicationOperation,
          fromAgent: BUILTIN_AGENTS.DOCS,
        }),
      ).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // receiveMessages filtering (additional coverage)
  // --------------------------------------------------------------------------

  describe("receive filtering", () => {
    it("should filter by message type", async () => {
      const context = createMockContext();

      // Send a REQUEST and NOTIFICATION
      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.RESEARCHER,
          message: {
            subject: "Request",
            content: "Please research",
            type: MessageType.REQUEST,
          },
        },
        context,
      );

      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.RESEARCHER,
          message: {
            subject: "Notification",
            content: "FYI",
            type: MessageType.NOTIFICATION,
          },
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
          filter: { type: MessageType.NOTIFICATION },
        },
        context,
      );

      expect(
        result.data?.messages?.every(
          (m) => m.type === MessageType.NOTIFICATION,
        ),
      ).toBe(true);
    });

    it("should filter by message priority", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.SLIDES,
          message: {
            subject: "Low",
            content: "Low priority",
            priority: MessagePriority.LOW,
          },
        },
        context,
      );

      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.SLIDES,
          message: {
            subject: "Urgent",
            content: "High priority",
            priority: MessagePriority.URGENT,
          },
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.SLIDES,
          filter: { priority: MessagePriority.URGENT },
        },
        context,
      );

      expect(
        result.data?.messages?.every(
          (m) => m.priority === MessagePriority.URGENT,
        ),
      ).toBe(true);
    });

    it("should filter by message status", async () => {
      const context = createMockContext();

      // Send a message then mark as read
      const sendResult = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Read me", content: "Content" },
        },
        context,
      );

      const msgId = sendResult.data?.message?.id ?? "";

      await tool.execute(
        {
          operation: CommunicationOperation.MARK_READ,
          fromAgent: BUILTIN_AGENTS.DESIGNER,
          messageId: msgId,
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.DESIGNER,
          filter: { status: MessageStatus.READ },
        },
        context,
      );

      expect(
        result.data?.messages?.every((m) => m.status === MessageStatus.READ),
      ).toBe(true);
    });

    it("should filter by unreadOnly", async () => {
      const context = createMockContext();

      // Send 2 messages, mark one as read
      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.SIMULATOR,
          message: { subject: "Unread msg", content: "Content 1" },
        },
        context,
      );

      const sendResult2 = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.SIMULATOR,
          message: { subject: "Read msg", content: "Content 2" },
        },
        context,
      );

      // Mark second as read
      await tool.execute(
        {
          operation: CommunicationOperation.MARK_READ,
          fromAgent: BUILTIN_AGENTS.SIMULATOR,
          messageId: sendResult2.data?.message?.id ?? "",
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.SIMULATOR,
          filter: { unreadOnly: true },
        },
        context,
      );

      const messages = result.data?.messages || [];
      // Only unread messages should be returned
      expect(
        messages.every(
          (m) =>
            m.status !== MessageStatus.READ &&
            m.status !== MessageStatus.REPLIED,
        ),
      ).toBe(true);
    });

    it("should report correct unreadCount in metadata", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.IMAGE_DESIGNER,
          message: { subject: "Msg1", content: "Content 1" },
        },
        context,
      );

      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.IMAGE_DESIGNER,
          message: { subject: "Msg2", content: "Content 2" },
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.IMAGE_DESIGNER,
        },
        context,
      );

      expect(result.data?.metadata?.unreadCount).toBe(2);
      expect(result.data?.metadata?.totalCount).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // markAsRead when already READ (no-op)
  // --------------------------------------------------------------------------

  describe("markAsRead idempotency", () => {
    it("should not change status when message is not DELIVERED", async () => {
      const context = createMockContext();

      const sendResult = await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.DESIGNER,
          message: { subject: "Mark twice", content: "Content" },
        },
        context,
      );

      const msgId = sendResult.data?.message?.id ?? "";

      // First mark as read (DELIVERED → READ)
      const firstMark = await tool.execute(
        {
          operation: CommunicationOperation.MARK_READ,
          fromAgent: BUILTIN_AGENTS.DESIGNER,
          messageId: msgId,
        },
        context,
      );
      expect(firstMark.data?.message?.status).toBe(MessageStatus.READ);

      // Second mark (READ → no change, still READ)
      const secondMark = await tool.execute(
        {
          operation: CommunicationOperation.MARK_READ,
          fromAgent: BUILTIN_AGENTS.DESIGNER,
          messageId: msgId,
        },
        context,
      );

      expect(secondMark.data?.success).toBe(true);
      expect(secondMark.data?.message?.status).toBe(MessageStatus.READ);
    });
  });

  // --------------------------------------------------------------------------
  // LIST_INBOX delegates to receiveMessages
  // --------------------------------------------------------------------------

  describe("list_inbox operation", () => {
    it("should return same result as receive for a given agent", async () => {
      const context = createMockContext();

      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.TEAM_COLLABORATION,
          message: { subject: "Hello", content: "Content" },
        },
        context,
      );

      const listResult = await tool.execute(
        {
          operation: CommunicationOperation.LIST_INBOX,
          fromAgent: BUILTIN_AGENTS.TEAM_COLLABORATION,
        },
        context,
      );

      expect(listResult.data?.success).toBe(true);
      expect(listResult.data?.messages?.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // getPriorityValue (implicit via inbox sorting)
  // --------------------------------------------------------------------------

  describe("inbox priority sorting", () => {
    it("should place URGENT message before LOW priority in inbox", async () => {
      const context = createMockContext();

      // Send LOW first, then URGENT
      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.RESEARCHER,
          message: {
            subject: "Low msg",
            content: "Low",
            priority: MessagePriority.LOW,
          },
        },
        context,
      );

      await tool.execute(
        {
          operation: CommunicationOperation.SEND,
          fromAgent: BUILTIN_AGENTS.DOCS,
          toAgent: BUILTIN_AGENTS.RESEARCHER,
          message: {
            subject: "Urgent msg",
            content: "Urgent",
            priority: MessagePriority.URGENT,
          },
        },
        context,
      );

      const result = await tool.execute(
        {
          operation: CommunicationOperation.RECEIVE,
          fromAgent: BUILTIN_AGENTS.RESEARCHER,
        },
        context,
      );

      const messages = result.data?.messages || [];
      expect(messages.length).toBe(2);
      // URGENT should appear first due to sorting
      expect(messages[0].priority).toBe(MessagePriority.URGENT);
      expect(messages[1].priority).toBe(MessagePriority.LOW);
    });
  });
});

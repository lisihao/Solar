// --- Circular dependency mocks: must be BEFORE all imports ---
jest.mock("../../../../common/content-processing", () => ({
  UrlParserService: jest.fn(),
  WebContentExtractionService: jest.fn(),
  ContentExtractionService: jest.fn(),
  ParsedUrlType: {},
  ParseStatus: {},
  ContentProcessingModule: {},
}));

jest.mock(
  "../../../../common/content-processing/content-processing.module",
  () => ({
    ContentProcessingModule: class MockContentProcessingModule {},
  }),
);

jest.mock("../../../platform/credits/billing-context.store", () => ({
  BillingContext: {
    run: jest.fn((_, fn) => fn()),
  },
}));

import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { TopicType, TopicRole, MessageContentType } from "@prisma/client";
import { AiTeamsService } from "../ai-teams.service";

const mockPrisma = {
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  topic: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  topicMember: {
    createMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicAIMember: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicMessage: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicMessageReaction: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicMessageMention: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicMessageAttachment: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicMessageBookmark: {
    deleteMany: jest.fn(),
  },
  topicMessageForward: {
    deleteMany: jest.fn(),
  },
  topicSummary: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicResource: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  missionLog: { deleteMany: jest.fn() },
  agentTask: { deleteMany: jest.fn() },
  teamMission: { deleteMany: jest.fn() },
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};

const mockAiFacade = {
  chat: jest.fn(),
};

const mockUrlParserService = {
  detectAndParseUrls: jest.fn(),
};

const mockAiResponseService = {
  generateAIResponse: jest.fn(),
  createAIMessage: jest.fn(),
  parseAIMentionsFromContent: jest.fn(),
};

const mockMembershipService = {
  addMember: jest.fn(),
  addMemberByEmail: jest.fn(),
  addMembers: jest.fn(),
  updateMember: jest.fn(),
  removeMember: jest.fn(),
  leaveTopic: jest.fn(),
  addAIMember: jest.fn(),
  updateAIMember: jest.fn(),
  removeAIMember: jest.fn(),
  updateAIMemberTeamRole: jest.fn(),
  setupDebateAIs: jest.fn(),
};

const mockPublicService = {
  getPublicTopics: jest.fn(),
  requestToJoinTopic: jest.fn(),
  getJoinRequests: jest.fn(),
  getMyJoinRequests: jest.fn(),
  reviewJoinRequest: jest.fn(),
  cancelJoinRequest: jest.fn(),
};

const mockForwardBookmarkService = {
  forwardMessages: jest.fn(),
  bookmarkMessage: jest.fn(),
  unbookmarkMessage: jest.fn(),
  getBookmarks: jest.fn(),
  getBookmarkCategories: jest.fn(),
};

const mockAuditService = {
  logTopicCreate: jest.fn(),
  logMemberAdd: jest.fn(),
  logMessageSend: jest.fn(),
};

const mockTopicEventEmitter = {
  emitTopicEvent: jest.fn(),
};

describe("AiTeamsService", () => {
  let service: AiTeamsService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new AiTeamsService(
      mockPrisma as never,
      mockAiFacade as never,
      mockUrlParserService as never,
      mockAiResponseService as never,
      mockMembershipService as never,
      mockPublicService as never,
      mockForwardBookmarkService as never,
      mockAuditService as never,
      mockTopicEventEmitter as never,
    );
  });

  // ==================== createTopic ====================

  describe("createTopic", () => {
    const userId = "user-1";
    const dto = {
      name: "Test Topic",
      description: "A test topic",
      type: TopicType.PRIVATE,
      memberIds: ["user-2"],
      aiMembers: [
        {
          aiModel: "gpt-4",
          displayName: "AI Assistant",
          roleDescription: "Helper",
          systemPrompt: "You are helpful",
        },
      ],
    };

    it("creates a topic and returns full topic info", async () => {
      const topicId = "topic-1";
      const createdTopic = { id: topicId };
      const fullTopic = {
        id: topicId,
        name: dto.name,
        members: [{ userId, role: TopicRole.OWNER }],
        aiMembers: [],
        type: TopicType.PRIVATE,
        _count: { messages: 0, resources: 0 },
        currentUserRole: TopicRole.OWNER,
        memberCount: 1,
        aiMemberCount: 0,
        createdBy: {
          id: userId,
          username: "testuser",
          fullName: "Test User",
          avatarUrl: null,
        },
      };

      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<string>) => {
          const tx = {
            topic: { create: jest.fn().mockResolvedValue(createdTopic) },
            topicMember: { createMany: jest.fn() },
            topicAIMember: { createMany: jest.fn() },
          };
          return fn(tx as never);
        },
      );

      mockPrisma.topic.findUnique.mockResolvedValue(fullTopic);

      const result = await service.createTopic(userId, dto);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockAuditService.logTopicCreate).toHaveBeenCalledWith(
        userId,
        topicId,
        dto.name,
      );
      expect(mockTopicEventEmitter.emitTopicEvent).toHaveBeenCalledWith(
        "topic.created",
        expect.any(Object),
      );
      expect(result).toEqual(expect.objectContaining({ id: topicId }));
    });

    it("creates a topic without optional memberIds and aiMembers", async () => {
      const simpleDto = { name: "Simple Topic" };
      const topicId = "topic-2";
      const createdTopic = { id: topicId };
      const fullTopic = {
        id: topicId,
        name: "Simple Topic",
        members: [{ userId, role: TopicRole.OWNER }],
        aiMembers: [],
        type: TopicType.PRIVATE,
        _count: { messages: 0, resources: 0 },
        currentUserRole: TopicRole.OWNER,
        memberCount: 1,
        aiMemberCount: 0,
        createdBy: {
          id: userId,
          username: "u",
          fullName: "U",
          avatarUrl: null,
        },
      };

      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<string>) => {
          const tx = {
            topic: { create: jest.fn().mockResolvedValue(createdTopic) },
            topicMember: { createMany: jest.fn() },
            topicAIMember: { createMany: jest.fn() },
          };
          return fn(tx as never);
        },
      );
      mockPrisma.topic.findUnique.mockResolvedValue(fullTopic);

      await service.createTopic(userId, simpleDto as never);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("propagates transaction errors", async () => {
      mockPrisma.$transaction.mockRejectedValue(new Error("DB error"));

      await expect(service.createTopic(userId, dto)).rejects.toThrow(
        "DB error",
      );
    });
  });

  // ==================== getTopics ====================

  describe("getTopics", () => {
    it("returns topics with unread counts when membership has lastReadAt", async () => {
      const userId = "user-1";
      const topics = [
        {
          id: "topic-1",
          type: TopicType.PRIVATE,
          members: [{ userId, role: TopicRole.OWNER, lastReadAt: new Date() }],
          aiMembers: [],
          _count: { messages: 5, resources: 0 },
        },
      ];

      mockPrisma.topic.findMany.mockResolvedValue(topics);
      mockPrisma.$queryRaw.mockResolvedValue([
        { topic_id: "topic-1", unread_count: BigInt(3) },
      ]);

      const result = await service.getTopics(userId);

      expect(result[0].unreadCount).toBe(3);
      expect(result[0].memberCount).toBe(1);
    });

    it("returns total message count as unread when no lastReadAt", async () => {
      const userId = "user-1";
      const topics = [
        {
          id: "topic-1",
          type: TopicType.PRIVATE,
          members: [{ userId, role: TopicRole.OWNER, lastReadAt: null }],
          aiMembers: [],
          _count: { messages: 10, resources: 0 },
        },
      ];

      mockPrisma.topic.findMany.mockResolvedValue(topics);
      mockPrisma.$queryRaw.mockResolvedValue([]);

      const result = await service.getTopics(userId);

      expect(result[0].unreadCount).toBe(10);
    });

    it("skips raw query when no topics", async () => {
      mockPrisma.topic.findMany.mockResolvedValue([]);

      const result = await service.getTopics("user-1");

      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("filters by type when provided", async () => {
      mockPrisma.topic.findMany.mockResolvedValue([]);

      await service.getTopics("user-1", { type: TopicType.PUBLIC });

      expect(mockPrisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: TopicType.PUBLIC }),
        }),
      );
    });

    it("applies search filter using OR conditions", async () => {
      mockPrisma.topic.findMany.mockResolvedValue([]);

      await service.getTopics("user-1", { search: "test" });

      expect(mockPrisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: expect.anything() }),
            ]),
          }),
        }),
      );
    });
  });

  // ==================== getTopicById ====================

  describe("getTopicById", () => {
    it("returns topic when found and user is a member", async () => {
      const userId = "user-1";
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId, role: TopicRole.OWNER }],
        aiMembers: [],
        _count: { messages: 0, resources: 0 },
      };

      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      const result = await service.getTopicById("topic-1", userId);

      expect(result.currentUserRole).toBe(TopicRole.OWNER);
      expect(result.memberCount).toBe(1);
    });

    it("throws NotFoundException when topic not found", async () => {
      mockPrisma.topic.findUnique.mockResolvedValue(null);

      await expect(service.getTopicById("not-exist", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws ForbiddenException when user is not a member of a PRIVATE topic", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [],
        aiMembers: [],
        _count: { messages: 0, resources: 0 },
      };

      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      await expect(service.getTopicById("topic-1", "user-99")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("allows non-members to access PUBLIC topics", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PUBLIC,
        members: [],
        aiMembers: [],
        _count: { messages: 5, resources: 2 },
      };

      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      const result = await service.getTopicById("topic-1", "user-99");

      expect(result.currentUserRole).toBeUndefined();
    });
  });

  // ==================== updateTopic ====================

  describe("updateTopic", () => {
    it("updates topic when user has permission", async () => {
      const membership = {
        id: "m-1",
        role: TopicRole.OWNER,
        topicId: "topic-1",
        userId: "user-1",
      };
      const updatedTopic = { id: "topic-1", name: "Updated" };

      mockPrisma.topicMember.findUnique.mockResolvedValue(membership);
      mockPrisma.topic.update.mockResolvedValue(updatedTopic);

      const result = await service.updateTopic("topic-1", "user-1", {
        name: "Updated",
      });

      expect(result).toEqual(updatedTopic);
      expect(mockTopicEventEmitter.emitTopicEvent).toHaveBeenCalledWith(
        "topic.updated",
        expect.any(Object),
      );
    });

    it("throws ForbiddenException when user lacks permission", async () => {
      const membership = {
        id: "m-1",
        role: TopicRole.MEMBER,
        topicId: "topic-1",
        userId: "user-1",
      };
      mockPrisma.topicMember.findUnique.mockResolvedValue(membership);

      await expect(
        service.updateTopic("topic-1", "user-1", { name: "Fail" }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== archiveTopic ====================

  describe("archiveTopic", () => {
    it("archives topic when user is OWNER", async () => {
      const membership = { id: "m-1", role: TopicRole.OWNER };
      const archivedTopic = { id: "topic-1", type: TopicType.ARCHIVED };

      mockPrisma.topicMember.findUnique.mockResolvedValue(membership);
      mockPrisma.topic.update.mockResolvedValue(archivedTopic);

      const result = await service.archiveTopic("topic-1", "user-1");

      expect(result).toEqual(archivedTopic);
      expect(mockTopicEventEmitter.emitTopicEvent).toHaveBeenCalledWith(
        "topic.archived",
        expect.any(Object),
      );
    });

    it("throws ForbiddenException when user is ADMIN (not OWNER)", async () => {
      const membership = { id: "m-1", role: TopicRole.ADMIN };
      mockPrisma.topicMember.findUnique.mockResolvedValue(membership);

      await expect(service.archiveTopic("topic-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ==================== deleteTopic ====================

  describe("deleteTopic", () => {
    it("deletes topic and all related data when user is OWNER", async () => {
      const membership = { id: "m-1", role: TopicRole.OWNER };
      const deletedTopic = { id: "topic-1" };

      mockPrisma.topicMember.findUnique.mockResolvedValue(membership);
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<typeof deletedTopic>) => {
          const tx = {
            missionLog: { deleteMany: jest.fn() },
            agentTask: { deleteMany: jest.fn() },
            teamMission: { deleteMany: jest.fn() },
            topicMessageReaction: { deleteMany: jest.fn() },
            topicMessageMention: { deleteMany: jest.fn() },
            topicMessageAttachment: { deleteMany: jest.fn() },
            topicMessage: {
              findMany: jest.fn().mockResolvedValue([]),
              deleteMany: jest.fn(),
            },
            topicMessageBookmark: { deleteMany: jest.fn() },
            topicMessageForward: { deleteMany: jest.fn() },
            topicSummary: { deleteMany: jest.fn() },
            topicResource: { deleteMany: jest.fn() },
            topicAIMember: { deleteMany: jest.fn() },
            topicMember: { deleteMany: jest.fn() },
            topic: { delete: jest.fn().mockResolvedValue(deletedTopic) },
          };
          return fn(tx as never);
        },
      );

      const result = await service.deleteTopic("topic-1", "user-1");

      expect(result).toEqual(deletedTopic);
      expect(mockTopicEventEmitter.emitTopicEvent).toHaveBeenCalledWith(
        "topic.deleted",
        expect.any(Object),
      );
    });
  });

  // ==================== Member management delegation ====================

  describe("addMember", () => {
    it("delegates to membershipService", async () => {
      const result = { id: "mem-1" };
      mockMembershipService.addMember.mockResolvedValue(result);

      const actual = await service.addMember("topic-1", "user-1", {
        userId: "user-2",
      } as never);

      expect(mockMembershipService.addMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        { userId: "user-2" },
      );
      expect(actual).toBe(result);
    });
  });

  describe("addAIMember", () => {
    it("delegates to membershipService and logs audit", async () => {
      const aiMember = { id: "ai-1", displayName: "Bot" };
      mockMembershipService.addAIMember.mockResolvedValue(aiMember);

      await service.addAIMember("topic-1", "user-1", {
        displayName: "Bot",
      } as never);

      expect(mockAuditService.logMemberAdd).toHaveBeenCalledWith(
        "user-1",
        "topic-1",
        "ai-1",
        "Bot",
      );
    });

    it("delegates to membershipService without audit when result is null", async () => {
      mockMembershipService.addAIMember.mockResolvedValue(null);

      await service.addAIMember("topic-1", "user-1", {
        displayName: "Bot",
      } as never);

      expect(mockAuditService.logMemberAdd).not.toHaveBeenCalled();
    });
  });

  // ==================== getMessages ====================

  describe("getMessages", () => {
    it("returns paginated messages", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      const msgs = [
        { id: "msg-1", createdAt: new Date() },
        { id: "msg-2", createdAt: new Date() },
      ];
      mockPrisma.topicMessage.findMany.mockResolvedValue(msgs);

      const result = await service.getMessages("topic-1", "user-1", {
        limit: 1,
      });

      expect(result.hasMore).toBe(true);
      expect(result.messages).toHaveLength(1);
    });

    it("returns hasMore=false when fewer messages than limit", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);
      mockPrisma.topicMessage.findMany.mockResolvedValue([{ id: "msg-1" }]);

      const result = await service.getMessages("topic-1", "user-1", {
        limit: 50,
      });

      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("applies cursor filter when provided", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);
      mockPrisma.topicMessage.findMany.mockResolvedValue([]);

      await service.getMessages("topic-1", "user-1", { cursor: "cursor-id" });

      expect(mockPrisma.topicMessage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { lt: "cursor-id" } }),
        }),
      );
    });

    it("throws ForbiddenException when not a member of PRIVATE topic", async () => {
      const topic = { id: "topic-1", type: TopicType.PRIVATE, members: [] };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      await expect(service.getMessages("topic-1", "user-99")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ==================== sendMessage ====================

  describe("sendMessage", () => {
    const topicId = "topic-1";
    const userId = "user-1";
    const dto = { content: "Hello", contentType: MessageContentType.TEXT };

    beforeEach(() => {
      const topic = {
        id: topicId,
        type: TopicType.PRIVATE,
        members: [{ userId }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);
      mockUrlParserService.detectAndParseUrls.mockResolvedValue({
        parsedUrls: [],
      });
    });

    it("sends a message and logs audit", async () => {
      const msgId = "msg-1";
      const createdMsg = { id: msgId };
      const fullMsg = { id: msgId, content: "Hello" };

      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<typeof createdMsg>) => {
          const tx = {
            topicMessage: {
              create: jest.fn().mockResolvedValue(createdMsg),
            },
            topicMessageMention: { createMany: jest.fn() },
            topicMessageAttachment: { createMany: jest.fn() },
            topic: { update: jest.fn() },
          };
          return fn(tx as never);
        },
      );
      mockPrisma.topicMessage.findUnique.mockResolvedValue(fullMsg);

      const result = await service.sendMessage(topicId, userId, dto as never);

      expect(mockAuditService.logMessageSend).toHaveBeenCalledWith(
        userId,
        topicId,
        msgId,
        false,
      );
      expect(mockTopicEventEmitter.emitTopicEvent).toHaveBeenCalledWith(
        "message.created",
        expect.any(Object),
      );
      expect(result).toEqual(fullMsg);
    });

    it("handles URL parsing failures gracefully", async () => {
      mockUrlParserService.detectAndParseUrls.mockRejectedValue(
        new Error("parse fail"),
      );

      const createdMsg = { id: "msg-1" };
      const fullMsg = { id: "msg-1" };
      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: typeof mockPrisma) => Promise<typeof createdMsg>) => {
          const tx = {
            topicMessage: { create: jest.fn().mockResolvedValue(createdMsg) },
            topicMessageMention: { createMany: jest.fn() },
            topicMessageAttachment: { createMany: jest.fn() },
            topic: { update: jest.fn() },
          };
          return fn(tx as never);
        },
      );
      mockPrisma.topicMessage.findUnique.mockResolvedValue(fullMsg);

      // Should not throw even when URL parsing fails
      await expect(
        service.sendMessage(topicId, userId, dto as never),
      ).resolves.toEqual(fullMsg);
    });
  });

  // ==================== deleteMessage ====================

  describe("deleteMessage", () => {
    it("allows message sender to delete their own message", async () => {
      const msg = { id: "msg-1", topicId: "topic-1", senderId: "user-1" };
      mockPrisma.topicMessage.findFirst.mockResolvedValue(msg);
      mockPrisma.topicMessage.update.mockResolvedValue({
        ...msg,
        deletedAt: new Date(),
      });

      await service.deleteMessage("topic-1", "user-1", "msg-1");

      expect(mockPrisma.topicMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "msg-1" } }),
      );
    });

    it("throws NotFoundException when message not found", async () => {
      mockPrisma.topicMessage.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteMessage("topic-1", "user-1", "msg-99"),
      ).rejects.toThrow(NotFoundException);
    });

    it("checks permissions when user is not the sender", async () => {
      const msg = { id: "msg-1", topicId: "topic-1", senderId: "other-user" };
      mockPrisma.topicMessage.findFirst.mockResolvedValue(msg);

      // No membership for permission check
      mockPrisma.topicMember.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMessage("topic-1", "user-1", "msg-1"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== addReaction ====================

  describe("addReaction", () => {
    it("adds a reaction to a message", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      const msg = { id: "msg-1", topicId: "topic-1" };
      mockPrisma.topicMessage.findFirst.mockResolvedValue(msg);

      const reaction = { messageId: "msg-1", userId: "user-1", emoji: "👍" };
      mockPrisma.topicMessageReaction.upsert.mockResolvedValue(reaction);

      const result = await service.addReaction(
        "topic-1",
        "user-1",
        "msg-1",
        "👍",
      );

      expect(result).toEqual(reaction);
    });

    it("throws NotFoundException when message not found", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);
      mockPrisma.topicMessage.findFirst.mockResolvedValue(null);

      await expect(
        service.addReaction("topic-1", "user-1", "msg-99", "👍"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== removeReaction ====================

  describe("removeReaction", () => {
    it("removes a reaction", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);
      mockPrisma.topicMessageReaction.deleteMany.mockResolvedValue({
        count: 1,
      });

      await service.removeReaction("topic-1", "user-1", "msg-1", "👍");

      expect(mockPrisma.topicMessageReaction.deleteMany).toHaveBeenCalledWith({
        where: { messageId: "msg-1", userId: "user-1", emoji: "👍" },
      });
    });
  });

  // ==================== markAsRead ====================

  describe("markAsRead", () => {
    it("marks topic as read with current timestamp when no messageId", async () => {
      const membership = { id: "m-1" };
      mockPrisma.topicMember.findUnique.mockResolvedValue(membership);
      mockPrisma.topicMember.update.mockResolvedValue({
        ...membership,
        lastReadAt: new Date(),
      });

      await service.markAsRead("topic-1", "user-1");

      expect(mockPrisma.topicMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "m-1" },
        }),
      );
    });

    it("marks read at specific message timestamp when messageId provided", async () => {
      const membership = { id: "m-1" };
      const msgDate = new Date("2024-01-01");
      mockPrisma.topicMember.findUnique.mockResolvedValue(membership);
      mockPrisma.topicMessage.findUnique.mockResolvedValue({
        createdAt: msgDate,
      });
      mockPrisma.topicMember.update.mockResolvedValue(membership);

      await service.markAsRead("topic-1", "user-1", "msg-1");

      expect(mockPrisma.topicMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastReadAt: msgDate },
        }),
      );
    });

    it("throws NotFoundException when not a member", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead("topic-1", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== Resources ====================

  describe("getResources", () => {
    it("returns resources for the topic", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      const resources = [{ id: "res-1", topicId: "topic-1" }];
      mockPrisma.topicResource.findMany.mockResolvedValue(resources);

      const result = await service.getResources("topic-1", "user-1");

      expect(result).toEqual(resources);
    });
  });

  describe("addResource", () => {
    it("adds a resource to the topic", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      const resource = { id: "res-1", topicId: "topic-1" };
      mockPrisma.topicResource.create.mockResolvedValue(resource);

      const result = await service.addResource("topic-1", "user-1", {
        resourceId: "r-1",
      } as never);

      expect(result).toEqual(resource);
    });
  });

  describe("removeResource", () => {
    it("allows resource owner to remove it", async () => {
      const resource = { id: "res-1", topicId: "topic-1", addedById: "user-1" };
      mockPrisma.topicResource.findFirst.mockResolvedValue(resource);
      mockPrisma.topicResource.delete.mockResolvedValue(resource);

      await service.removeResource("topic-1", "user-1", "res-1");

      expect(mockPrisma.topicResource.delete).toHaveBeenCalledWith({
        where: { id: "res-1" },
      });
    });

    it("throws NotFoundException when resource not found", async () => {
      mockPrisma.topicResource.findFirst.mockResolvedValue(null);

      await expect(
        service.removeResource("topic-1", "user-1", "res-99"),
      ).rejects.toThrow(NotFoundException);
    });

    it("checks permissions when user is not the resource owner", async () => {
      const resource = {
        id: "res-1",
        topicId: "topic-1",
        addedById: "other-user",
      };
      mockPrisma.topicResource.findFirst.mockResolvedValue(resource);
      mockPrisma.topicMember.findUnique.mockResolvedValue(null);

      await expect(
        service.removeResource("topic-1", "user-1", "res-1"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== Summaries ====================

  describe("getSummaries", () => {
    it("returns summaries for the topic", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      const summaries = [{ id: "sum-1" }];
      mockPrisma.topicSummary.findMany.mockResolvedValue(summaries);

      const result = await service.getSummaries("topic-1", "user-1");

      expect(result).toEqual(summaries);
    });
  });

  describe("generateSummary", () => {
    it("generates a summary using AI", async () => {
      // BillingContext.run is mocked to call fn() directly
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [
          { userId: "user-1", user: { fullName: "User", username: "user" } },
        ],
        aiMembers: [{ id: "ai-1", displayName: "Bot" }],
      };
      mockPrisma.topic.findUnique
        .mockResolvedValueOnce({
          id: "topic-1",
          type: TopicType.PRIVATE,
          members: [{ userId: "user-1" }],
        }) // checkTopicMembership
        .mockResolvedValueOnce(topic); // generateSummary inner findUnique

      const messages = [
        {
          id: "msg-1",
          content: "Hello",
          createdAt: new Date(),
          sender: { username: "user", fullName: "User" },
          aiMember: null,
        },
      ];
      mockPrisma.topicMessage.findMany.mockResolvedValue(messages);
      mockAiFacade.chat.mockResolvedValue({ content: "Generated summary" });

      const summary = { id: "sum-1", content: "Generated summary" };
      mockPrisma.topicSummary.create.mockResolvedValue(summary);

      const result = await service.generateSummary("topic-1", "user-1", {
        title: "Test Summary",
        aiModel: "gpt-4",
      } as never);

      expect(result).toEqual(summary);
      expect(mockAiFacade.chat).toHaveBeenCalled();
    });

    it("throws BadRequestException when no messages to summarize", async () => {
      const topicMembership = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      const topic = {
        id: "topic-1",
        members: [
          { userId: "user-1", user: { fullName: "User", username: "user" } },
        ],
        aiMembers: [],
      };
      mockPrisma.topic.findUnique
        .mockResolvedValueOnce(topicMembership)
        .mockResolvedValueOnce(topic);
      mockPrisma.topicMessage.findMany.mockResolvedValue([]);

      await expect(
        service.generateSummary("topic-1", "user-1", {} as never),
      ).rejects.toThrow(BadRequestException);
    });

    it("falls back to basic summary when AI call fails", async () => {
      const topicMembership = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      const topic = {
        id: "topic-1",
        name: "Test",
        members: [
          { userId: "user-1", user: { fullName: "User", username: "user" } },
        ],
        aiMembers: [{ displayName: "Bot" }],
      };
      mockPrisma.topic.findUnique
        .mockResolvedValueOnce(topicMembership)
        .mockResolvedValueOnce(topic);

      const messages = [
        {
          id: "msg-1",
          content: "Hello",
          createdAt: new Date(),
          sender: { username: "user", fullName: "User" },
          aiMember: null,
        },
      ];
      mockPrisma.topicMessage.findMany.mockResolvedValue(messages);
      mockAiFacade.chat.mockRejectedValue(new Error("AI unavailable"));
      mockPrisma.topicSummary.create.mockResolvedValue({
        id: "sum-1",
        content: "fallback",
      });

      const result = await service.generateSummary(
        "topic-1",
        "user-1",
        {} as never,
      );

      expect(result).toBeDefined();
      expect(mockPrisma.topicSummary.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: expect.stringContaining("AI服务暂时不可用"),
          }),
        }),
      );
    });
  });

  describe("deleteSummary", () => {
    it("allows summary creator to delete it", async () => {
      const summary = {
        id: "sum-1",
        topicId: "topic-1",
        createdById: "user-1",
      };
      mockPrisma.topicSummary.findFirst.mockResolvedValue(summary);
      mockPrisma.topicSummary.delete.mockResolvedValue(summary);

      await service.deleteSummary("topic-1", "user-1", "sum-1");

      expect(mockPrisma.topicSummary.delete).toHaveBeenCalledWith({
        where: { id: "sum-1" },
      });
    });

    it("throws NotFoundException when summary not found", async () => {
      mockPrisma.topicSummary.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteSummary("topic-1", "user-1", "sum-99"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== AI Response delegation ====================

  describe("generateAIResponse", () => {
    it("checks membership and delegates to aiResponseService", async () => {
      const topic = {
        id: "topic-1",
        type: TopicType.PRIVATE,
        members: [{ userId: "user-1" }],
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);
      mockAiResponseService.generateAIResponse.mockResolvedValue({
        id: "ai-msg-1",
      });

      await service.generateAIResponse("topic-1", "user-1", "ai-1", []);

      expect(mockAiResponseService.generateAIResponse).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
        [],
        undefined,
      );
    });
  });

  // ==================== Forward & Bookmark delegation ====================

  describe("forwardMessages", () => {
    it("delegates to forwardBookmarkService", async () => {
      mockForwardBookmarkService.forwardMessages.mockResolvedValue({
        forwarded: 1,
      });

      await service.forwardMessages("topic-1", "user-1", {} as never);

      expect(mockForwardBookmarkService.forwardMessages).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        {},
      );
    });
  });

  describe("getBookmarks", () => {
    it("delegates to forwardBookmarkService", async () => {
      mockForwardBookmarkService.getBookmarks.mockResolvedValue([]);

      await service.getBookmarks("user-1", { category: "starred" });

      expect(mockForwardBookmarkService.getBookmarks).toHaveBeenCalledWith(
        "user-1",
        { category: "starred" },
      );
    });
  });

  // ==================== Public Topics delegation ====================

  describe("getPublicTopics", () => {
    it("delegates to publicService", async () => {
      mockPublicService.getPublicTopics.mockResolvedValue([]);

      await service.getPublicTopics({ search: "test", limit: 20 });

      expect(mockPublicService.getPublicTopics).toHaveBeenCalledWith({
        search: "test",
        limit: 20,
      });
    });
  });

  // ==================== User Search ====================

  describe("searchUserByEmail", () => {
    it("returns user when found by email", async () => {
      const user = {
        id: "user-1",
        email: "test@example.com",
        username: "test",
      };
      mockPrisma.user.findFirst.mockResolvedValue(user);

      const result = await service.searchUserByEmail("test@example.com");

      expect(result).toEqual(user);
    });

    it("throws NotFoundException when user not found", async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.searchUserByEmail("notfound@example.com"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("searchUsers", () => {
    it("returns matching users", async () => {
      const users = [
        { id: "user-1", email: "test@example.com", username: "test" },
      ];
      mockPrisma.user.findMany.mockResolvedValue(users);

      const result = await service.searchUsers("test");

      expect(result).toEqual(users);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it("respects custom limit", async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.searchUsers("test", 5);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });
  });
});

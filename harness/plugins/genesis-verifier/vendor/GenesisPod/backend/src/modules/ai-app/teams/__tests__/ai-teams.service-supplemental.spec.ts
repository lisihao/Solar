/**
 * AiTeamsService Supplemental Tests
 *
 * Targets uncovered paths (~42 lines):
 * - createTopic: topicEventEmitter triggered
 * - sendMessage: with mentions, attachments, auditService, topicEventEmitter
 * - createAIMessage: delegates to aiResponseService
 * - parseAIMentionsFromContent: delegates to aiResponseService
 * - deleteSummary: user is creator (no permission check needed)
 * - requestToJoinTopic, getJoinRequests, getMyJoinRequests, reviewJoinRequest, cancelJoinRequest
 * - bookmarkMessage, unbookmarkMessage, getBookmarks with options, getBookmarkCategories
 * - checkTopicMembership: PRIVATE topic with no membership → ForbiddenException
 * - checkTopicPermission: not a member → ForbiddenException
 */

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

import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { TopicType, TopicRole, MessageContentType } from "@prisma/client";
import { AiTeamsService } from "../ai-teams.service";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
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

const mockAiFacade = { chat: jest.fn() };

const mockUrlParserService = {
  detectAndParseUrls: jest.fn().mockResolvedValue({ parsedUrls: [] }),
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
  getPublicTopics: jest.fn().mockResolvedValue([]),
  requestToJoinTopic: jest.fn().mockResolvedValue({ id: "request-1" }),
  getJoinRequests: jest.fn().mockResolvedValue([]),
  getMyJoinRequests: jest.fn().mockResolvedValue([]),
  reviewJoinRequest: jest.fn().mockResolvedValue({ id: "request-1" }),
  cancelJoinRequest: jest.fn().mockResolvedValue({ id: "request-1" }),
};

const mockForwardBookmarkService = {
  forwardMessages: jest.fn(),
  bookmarkMessage: jest.fn().mockResolvedValue({ id: "bookmark-1" }),
  unbookmarkMessage: jest.fn().mockResolvedValue({ id: "bookmark-1" }),
  getBookmarks: jest.fn().mockResolvedValue([]),
  getBookmarkCategories: jest.fn().mockResolvedValue([]),
};

const mockAuditService = {
  logTopicCreate: jest.fn(),
  logMemberAdd: jest.fn(),
  logMessageSend: jest.fn(),
};

const mockTopicEventEmitter = {
  emitTopicEvent: jest.fn(),
  emitToTopic: jest.fn(),
};

function buildService() {
  return new AiTeamsService(
    mockPrisma as any,
    mockAiFacade as any,
    mockUrlParserService as any,
    mockAiResponseService as any,
    mockMembershipService as any,
    mockPublicService as any,
    mockForwardBookmarkService as any,
    mockAuditService as any,
    mockTopicEventEmitter as any,
    undefined, // missionExecutor
  );
}

// ---------------------------------------------------------------------------
describe("AiTeamsService (supplemental)", () => {
  let service: AiTeamsService;
  const userId = "user-supp-1";
  const topicId = "topic-supp-1";

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();
  });

  // =========================================================================
  // createTopic — topicEventEmitter triggered
  // =========================================================================
  describe("createTopic — event emitter", () => {
    it("emits topic.created event via topicEventEmitter", async () => {
      const topicData = {
        id: topicId,
        name: "Event Test Topic",
        type: TopicType.PRIVATE,
        // User is a member so getTopicById won't throw ForbiddenException
        members: [{ userId, role: TopicRole.OWNER }],
        aiMembers: [],
        _count: { messages: 0, resources: 0 },
        createdBy: { id: userId, username: "user1", fullName: "User One" },
      };

      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        if (typeof fn === "function") {
          return fn({
            topic: {
              create: jest.fn().mockResolvedValue({ id: topicId }),
            },
            topicMember: { createMany: jest.fn() },
            topicAIMember: { createMany: jest.fn() },
          });
        }
        return topicId;
      });

      mockPrisma.topic.findUnique.mockResolvedValue(topicData);

      await service.createTopic(userId, {
        name: "Event Test Topic",
        type: TopicType.PRIVATE,
      } as any);

      expect(mockTopicEventEmitter.emitTopicEvent).toHaveBeenCalledWith(
        "topic.created",
        expect.objectContaining({ topicId, userId }),
      );
    });
  });

  // =========================================================================
  // sendMessage — with mentions, attachments, auditService, topicEventEmitter
  // =========================================================================
  describe("sendMessage — mentions and attachments", () => {
    it("creates message with mentions and calls audit + event emitter", async () => {
      const topic = {
        id: topicId,
        type: TopicType.PRIVATE,
        members: [{ userId, role: TopicRole.MEMBER }],
      };

      const messageRecord = {
        id: "msg-supp-1",
        topicId,
        senderId: userId,
        content: "Hello @Alice",
      };

      mockPrisma.topic.findUnique.mockResolvedValue(topic);
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        return fn({
          topicMessage: {
            create: jest.fn().mockResolvedValue(messageRecord),
          },
          topicMessageMention: {
            createMany: jest.fn(),
          },
          topicMessageAttachment: {
            createMany: jest.fn(),
          },
          topic: {
            update: jest.fn(),
          },
        });
      });
      mockPrisma.topicMessage.findUnique.mockResolvedValue(messageRecord);

      const dto = {
        content: "Hello @Alice",
        contentType: MessageContentType.TEXT,
        mentions: [
          { userId: "user-alice", aiMemberId: null, mentionType: "DIRECT" },
        ],
        attachments: [
          {
            type: "FILE",
            name: "doc.pdf",
            url: "https://example.com/doc.pdf",
            size: 1024,
            mimeType: "application/pdf",
          },
        ],
      };

      await service.sendMessage(topicId, userId, dto as any);

      expect(mockAuditService.logMessageSend).toHaveBeenCalledWith(
        userId,
        topicId,
        "msg-supp-1",
        false,
      );
      expect(mockTopicEventEmitter.emitTopicEvent).toHaveBeenCalledWith(
        "message.created",
        expect.objectContaining({ topicId, senderId: userId }),
      );
    });
  });

  // =========================================================================
  // createAIMessage — delegates to aiResponseService
  // =========================================================================
  describe("createAIMessage", () => {
    it("delegates to aiResponseService.createAIMessage", async () => {
      const aiMemberId = "ai-member-1";
      mockAiResponseService.createAIMessage.mockResolvedValue({
        id: "ai-msg-1",
        content: "AI says hi",
      });

      const result = await service.createAIMessage(
        topicId,
        aiMemberId,
        "AI says hi",
        "gpt-4o",
        50,
      );

      expect(mockAiResponseService.createAIMessage).toHaveBeenCalledWith(
        topicId,
        aiMemberId,
        "AI says hi",
        "gpt-4o",
        50,
      );
      expect(result).toEqual({ id: "ai-msg-1", content: "AI says hi" });
    });
  });

  // =========================================================================
  // parseAIMentionsFromContent — delegates to aiResponseService
  // =========================================================================
  describe("parseAIMentionsFromContent", () => {
    it("delegates to aiResponseService and returns mentions", async () => {
      const mentions = [{ id: "ai-1", displayName: "AI Alice" }];
      mockAiResponseService.parseAIMentionsFromContent.mockResolvedValue(
        mentions,
      );

      const result = await service.parseAIMentionsFromContent(
        topicId,
        "Hey @AI Alice what do you think?",
        "ai-exclude-1",
      );

      expect(
        mockAiResponseService.parseAIMentionsFromContent,
      ).toHaveBeenCalledWith(
        topicId,
        "Hey @AI Alice what do you think?",
        "ai-exclude-1",
      );
      expect(result).toEqual(mentions);
    });
  });

  // =========================================================================
  // deleteSummary — user is the creator (no permission check)
  // =========================================================================
  describe("deleteSummary — creator path", () => {
    it("deletes summary when user is the creator without checking permissions", async () => {
      const summaryId = "summary-1";
      const summary = {
        id: summaryId,
        topicId,
        createdById: userId, // creator
      };

      mockPrisma.topicSummary.findFirst.mockResolvedValue(summary);
      mockPrisma.topicSummary.delete.mockResolvedValue(summary);

      const result = await service.deleteSummary(topicId, userId, summaryId);

      expect(mockPrisma.topicSummary.delete).toHaveBeenCalledWith({
        where: { id: summaryId },
      });
      expect(result).toEqual(summary);
    });
  });

  // =========================================================================
  // requestToJoinTopic — delegates to publicService
  // =========================================================================
  describe("requestToJoinTopic", () => {
    it("delegates to publicService.requestToJoinTopic", async () => {
      const requestMessage = "Please let me join!";
      await service.requestToJoinTopic(topicId, userId, requestMessage);

      expect(mockPublicService.requestToJoinTopic).toHaveBeenCalledWith(
        topicId,
        userId,
        requestMessage,
      );
    });
  });

  // =========================================================================
  // getJoinRequests — delegates to publicService
  // =========================================================================
  describe("getJoinRequests", () => {
    it("delegates to publicService.getJoinRequests", async () => {
      await service.getJoinRequests(topicId, userId);
      expect(mockPublicService.getJoinRequests).toHaveBeenCalledWith(
        topicId,
        userId,
      );
    });
  });

  // =========================================================================
  // getMyJoinRequests — delegates to publicService
  // =========================================================================
  describe("getMyJoinRequests", () => {
    it("delegates to publicService.getMyJoinRequests", async () => {
      await service.getMyJoinRequests(userId);
      expect(mockPublicService.getMyJoinRequests).toHaveBeenCalledWith(userId);
    });
  });

  // =========================================================================
  // reviewJoinRequest — delegates to publicService
  // =========================================================================
  describe("reviewJoinRequest", () => {
    it("delegates to publicService.reviewJoinRequest with approve=true", async () => {
      await service.reviewJoinRequest("request-1", userId, true, "Welcome!");

      expect(mockPublicService.reviewJoinRequest).toHaveBeenCalledWith(
        "request-1",
        userId,
        true,
        "Welcome!",
      );
    });
  });

  // =========================================================================
  // cancelJoinRequest — delegates to publicService
  // =========================================================================
  describe("cancelJoinRequest", () => {
    it("delegates to publicService.cancelJoinRequest", async () => {
      await service.cancelJoinRequest("request-1", userId);
      expect(mockPublicService.cancelJoinRequest).toHaveBeenCalledWith(
        "request-1",
        userId,
      );
    });
  });

  // =========================================================================
  // bookmarkMessage — delegates to forwardBookmarkService
  // =========================================================================
  describe("bookmarkMessage", () => {
    it("delegates to forwardBookmarkService.bookmarkMessage", async () => {
      const dto = { category: "important", note: "Check this later" };
      await service.bookmarkMessage(topicId, userId, "msg-1", dto as any);

      expect(mockForwardBookmarkService.bookmarkMessage).toHaveBeenCalledWith(
        topicId,
        userId,
        "msg-1",
        dto,
      );
    });
  });

  // =========================================================================
  // unbookmarkMessage — delegates to forwardBookmarkService
  // =========================================================================
  describe("unbookmarkMessage", () => {
    it("delegates to forwardBookmarkService.unbookmarkMessage", async () => {
      await service.unbookmarkMessage(topicId, userId, "msg-1");

      expect(mockForwardBookmarkService.unbookmarkMessage).toHaveBeenCalledWith(
        topicId,
        userId,
        "msg-1",
      );
    });
  });

  // =========================================================================
  // getBookmarks — with options
  // =========================================================================
  describe("getBookmarks", () => {
    it("delegates to forwardBookmarkService with options", async () => {
      const options = { category: "important" };
      await service.getBookmarks(userId, options);

      expect(mockForwardBookmarkService.getBookmarks).toHaveBeenCalledWith(
        userId,
        options,
      );
    });

    it("delegates without options", async () => {
      await service.getBookmarks(userId);

      expect(mockForwardBookmarkService.getBookmarks).toHaveBeenCalledWith(
        userId,
        undefined,
      );
    });
  });

  // =========================================================================
  // getBookmarkCategories — delegates to forwardBookmarkService
  // =========================================================================
  describe("getBookmarkCategories", () => {
    it("delegates to forwardBookmarkService.getBookmarkCategories", async () => {
      await service.getBookmarkCategories(userId);
      expect(
        mockForwardBookmarkService.getBookmarkCategories,
      ).toHaveBeenCalledWith(userId);
    });
  });

  // =========================================================================
  // checkTopicMembership — PRIVATE + no member → ForbiddenException
  // =========================================================================
  describe("checkTopicMembership — private topic without membership", () => {
    it("throws ForbiddenException when user is not a member of PRIVATE topic", async () => {
      const topic = {
        id: topicId,
        type: TopicType.PRIVATE,
        members: [], // empty - user is not a member
      };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      await expect(
        service.getMessages(topicId, "non-member-user"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws NotFoundException when topic does not exist", async () => {
      mockPrisma.topic.findUnique.mockResolvedValue(null);

      await expect(service.getMessages(topicId, userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

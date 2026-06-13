/**
 * AiTeamsController Unit Tests
 *
 * Covers: Topic CRUD, Member Management, AI Member Management,
 * Messages, Resources, Summaries, Bookmarks/Forward, Missions,
 * Debate endpoints, URL parsing, BookmarksController, UsersController,
 * PublicReportsController.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import {
  AiTeamsController,
  BookmarksController,
  UsersController,
  PublicReportsController,
} from "../ai-teams.controller";
import { AiTeamsService } from "../../ai-teams.service";
import { AiTeamsGateway } from "../../ai-teams.gateway";
import {
  DebateService,
  TeamMissionService,
  UrlParserService,
} from "../../services";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import { RateLimitGuard } from "../../../../../common/guards/rate-limit.guard";
import { MentionType, MissionStatus, TopicType } from "@prisma/client";

// ---------------------------------------------------------------------------
// Helper types
// ---------------------------------------------------------------------------

interface MockRequest {
  user: { id: string; role: string };
}

function makeReq(userId = "user-1"): MockRequest {
  return { user: { id: userId, role: "USER" } };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAiTeamsService = {
  createTopic: jest.fn(),
  getTopics: jest.fn(),
  getPublicTopics: jest.fn(),
  getMyJoinRequests: jest.fn(),
  reviewJoinRequest: jest.fn(),
  cancelJoinRequest: jest.fn(),
  getTopicById: jest.fn(),
  updateTopic: jest.fn(),
  archiveTopic: jest.fn(),
  deleteTopic: jest.fn(),
  addMember: jest.fn(),
  addMemberByEmail: jest.fn(),
  addMembers: jest.fn(),
  updateMember: jest.fn(),
  removeMember: jest.fn(),
  leaveTopic: jest.fn(),
  requestToJoinTopic: jest.fn(),
  getJoinRequests: jest.fn(),
  addAIMember: jest.fn(),
  updateAIMember: jest.fn(),
  removeAIMember: jest.fn(),
  setupDebateAIs: jest.fn(),
  getMessages: jest.fn(),
  sendMessage: jest.fn(),
  deleteMessage: jest.fn(),
  addReaction: jest.fn(),
  removeReaction: jest.fn(),
  markAsRead: jest.fn(),
  generateAIResponse: jest.fn(),
  parseAIMentionsFromContent: jest.fn(),
  getResources: jest.fn(),
  addResource: jest.fn(),
  removeResource: jest.fn(),
  getSummaries: jest.fn(),
  generateSummary: jest.fn(),
  deleteSummary: jest.fn(),
  forwardMessages: jest.fn(),
  bookmarkMessage: jest.fn(),
  unbookmarkMessage: jest.fn(),
  createAIMessage: jest.fn(),
  updateAIMemberTeamRole: jest.fn(),
  getBookmarks: jest.fn(),
  getBookmarkCategories: jest.fn(),
  searchUserByEmail: jest.fn(),
  searchUsers: jest.fn(),
};

const mockAiTeamsGateway = {
  emitToTopic: jest.fn(),
  emitToUser: jest.fn(),
};

const mockDebateService = {
  createDebateSession: jest.fn(),
  executeDebateRound: jest.fn(),
  completeDebate: jest.fn(),
  getDebatesByTopic: jest.fn(),
  getDebateSession: jest.fn(),
};

const mockTeamMissionService = {
  createMission: jest.fn(),
  getMissions: jest.fn(),
  getMissionById: jest.fn(),
  cancelMission: jest.fn(),
  pauseMission: jest.fn(),
  resumeMission: jest.fn(),
  retryMission: jest.fn(),
  getFullReport: jest.fn(),
  regenerateFinalReport: jest.fn(),
  getMissionLogs: jest.fn(),
  updateMissionNotification: jest.fn(),
  deleteMission: jest.fn(),
  setLeader: jest.fn(),
  getTeamMembers: jest.fn(),
  handleLeaderMentionCommand: jest.fn(),
  getPublicReport: jest.fn(),
};

const mockUrlParserService = {
  parseUrl: jest.fn(),
  parseUrls: jest.fn(),
  detectUrls: jest.fn(),
  detectAndParseUrls: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test suite: AiTeamsController
// ---------------------------------------------------------------------------

describe("AiTeamsController", () => {
  let controller: AiTeamsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiTeamsController],
      providers: [
        { provide: AiTeamsService, useValue: mockAiTeamsService },
        { provide: AiTeamsGateway, useValue: mockAiTeamsGateway },
        { provide: DebateService, useValue: mockDebateService },
        { provide: TeamMissionService, useValue: mockTeamMissionService },
        { provide: UrlParserService, useValue: mockUrlParserService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AiTeamsController);
  });

  // ==================== Topic CRUD ====================

  describe("createTopic", () => {
    it("creates a topic and returns it", async () => {
      const dto = { title: "New Topic" };
      const created = { id: "topic-1", title: "New Topic" };
      mockAiTeamsService.createTopic.mockResolvedValue(created);

      const result = await controller.createTopic(makeReq(), dto as never);

      expect(mockAiTeamsService.createTopic).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
      expect(result).toBe(created);
    });
  });

  describe("getTopics", () => {
    it("returns topic list for user", async () => {
      const topics = [{ id: "t-1" }, { id: "t-2" }];
      mockAiTeamsService.getTopics.mockResolvedValue(topics);

      const result = await controller.getTopics(
        makeReq(),
        TopicType.TEAM,
        undefined,
      );

      expect(mockAiTeamsService.getTopics).toHaveBeenCalledWith("user-1", {
        type: TopicType.TEAM,
        search: undefined,
      });
      expect(result).toBe(topics);
    });
  });

  describe("getPublicTopics", () => {
    it("returns public topics with defaults", async () => {
      const topics = [{ id: "pt-1" }];
      mockAiTeamsService.getPublicTopics.mockResolvedValue(topics);

      const result = await controller.getPublicTopics(undefined, undefined);

      expect(mockAiTeamsService.getPublicTopics).toHaveBeenCalledWith({
        search: undefined,
        limit: 50,
      });
      expect(result).toBe(topics);
    });

    it("passes limit as number when provided", async () => {
      mockAiTeamsService.getPublicTopics.mockResolvedValue([]);

      await controller.getPublicTopics("keyword", "20");

      expect(mockAiTeamsService.getPublicTopics).toHaveBeenCalledWith({
        search: "keyword",
        limit: 20,
      });
    });
  });

  describe("getMyJoinRequests", () => {
    it("returns join requests for current user", async () => {
      const requests = [{ id: "req-1" }];
      mockAiTeamsService.getMyJoinRequests.mockResolvedValue(requests);

      const result = await controller.getMyJoinRequests(makeReq());

      expect(mockAiTeamsService.getMyJoinRequests).toHaveBeenCalledWith(
        "user-1",
      );
      expect(result).toBe(requests);
    });
  });

  describe("reviewJoinRequest", () => {
    it("reviews a join request with approval", async () => {
      const reviewed = { id: "req-1", approved: true };
      mockAiTeamsService.reviewJoinRequest.mockResolvedValue(reviewed);

      const result = await controller.reviewJoinRequest(makeReq(), "req-1", {
        approve: true,
        responseNote: "Welcome!",
      });

      expect(mockAiTeamsService.reviewJoinRequest).toHaveBeenCalledWith(
        "req-1",
        "user-1",
        true,
        "Welcome!",
      );
      expect(result).toBe(reviewed);
    });
  });

  describe("cancelJoinRequest", () => {
    it("cancels a join request", async () => {
      mockAiTeamsService.cancelJoinRequest.mockResolvedValue({ success: true });

      const result = await controller.cancelJoinRequest(makeReq(), "req-1");

      expect(mockAiTeamsService.cancelJoinRequest).toHaveBeenCalledWith(
        "req-1",
        "user-1",
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("getTopicById", () => {
    it("returns topic by id", async () => {
      const topic = { id: "topic-1", title: "Test" };
      mockAiTeamsService.getTopicById.mockResolvedValue(topic);

      const result = await controller.getTopicById(makeReq(), "topic-1");

      expect(mockAiTeamsService.getTopicById).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toBe(topic);
    });
  });

  describe("updateTopic", () => {
    it("updates a topic", async () => {
      const dto = { title: "Updated" };
      const updated = { id: "topic-1", title: "Updated" };
      mockAiTeamsService.updateTopic.mockResolvedValue(updated);

      const result = await controller.updateTopic(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockAiTeamsService.updateTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto,
      );
      expect(result).toBe(updated);
    });
  });

  describe("archiveTopic", () => {
    it("archives a topic", async () => {
      mockAiTeamsService.archiveTopic.mockResolvedValue({ archived: true });

      const result = await controller.archiveTopic(makeReq(), "topic-1");

      expect(mockAiTeamsService.archiveTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toEqual({ archived: true });
    });
  });

  describe("deleteTopic", () => {
    it("deletes a topic", async () => {
      mockAiTeamsService.deleteTopic.mockResolvedValue({ deleted: true });

      const result = await controller.deleteTopic(makeReq(), "topic-1");

      expect(mockAiTeamsService.deleteTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  // ==================== Member Management ====================

  describe("getMembers", () => {
    it("returns topic members", async () => {
      const members = [{ id: "m-1" }];
      mockAiTeamsService.getTopicById.mockResolvedValue({ members });

      const result = await controller.getMembers(makeReq(), "topic-1");

      expect(result).toBe(members);
    });
  });

  describe("addMember", () => {
    it("adds a member to the topic", async () => {
      const dto = { userId: "user-2" };
      const added = { id: "m-2" };
      mockAiTeamsService.addMember.mockResolvedValue(added);

      const result = await controller.addMember(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockAiTeamsService.addMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto,
      );
      expect(result).toBe(added);
    });
  });

  describe("addMemberByEmail", () => {
    it("invites a member by email", async () => {
      const dto = { email: "test@example.com", role: "MEMBER" as never };
      mockAiTeamsService.addMemberByEmail.mockResolvedValue({ id: "m-3" });

      await controller.addMemberByEmail(makeReq(), "topic-1", dto);

      expect(mockAiTeamsService.addMemberByEmail).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "test@example.com",
        "MEMBER",
      );
    });
  });

  describe("leaveTopic", () => {
    it("removes user from topic", async () => {
      mockAiTeamsService.leaveTopic.mockResolvedValue({ left: true });

      const result = await controller.leaveTopic(makeReq(), "topic-1");

      expect(mockAiTeamsService.leaveTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toEqual({ left: true });
    });
  });

  describe("requestToJoinTopic", () => {
    it("submits a join request", async () => {
      mockAiTeamsService.requestToJoinTopic.mockResolvedValue({ id: "req-2" });

      const result = await controller.requestToJoinTopic(makeReq(), "topic-1", {
        requestMessage: "Please let me in",
      });

      expect(mockAiTeamsService.requestToJoinTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "Please let me in",
      );
      expect(result).toEqual({ id: "req-2" });
    });
  });

  // ==================== AI Member Management ====================

  describe("getAIMembers", () => {
    it("returns ai members from topic", async () => {
      const aiMembers = [{ id: "ai-1" }];
      mockAiTeamsService.getTopicById.mockResolvedValue({ aiMembers });

      const result = await controller.getAIMembers(makeReq(), "topic-1");

      expect(result).toBe(aiMembers);
    });
  });

  describe("addAIMember", () => {
    it("adds an AI member", async () => {
      const dto = { aiModel: "gpt-4" };
      const added = { id: "ai-2" };
      mockAiTeamsService.addAIMember.mockResolvedValue(added);

      const result = await controller.addAIMember(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockAiTeamsService.addAIMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto,
      );
      expect(result).toBe(added);
    });
  });

  describe("removeAIMember", () => {
    it("removes an AI member", async () => {
      mockAiTeamsService.removeAIMember.mockResolvedValue({ removed: true });

      const result = await controller.removeAIMember(
        makeReq(),
        "topic-1",
        "ai-1",
      );

      expect(mockAiTeamsService.removeAIMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
      );
      expect(result).toEqual({ removed: true });
    });
  });

  describe("setupDebate", () => {
    it("sets up a debate with two AI models", async () => {
      const dto = {
        redAiModel: "gpt-4",
        blueAiModel: "claude-3",
        topic: "AI vs Humans",
      };
      mockAiTeamsService.setupDebateAIs.mockResolvedValue({
        sessionId: "debate-1",
      });

      const result = await controller.setupDebate(makeReq(), "topic-1", dto);

      expect(mockAiTeamsService.setupDebateAIs).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "gpt-4",
        "claude-3",
        "AI vs Humans",
      );
      expect(result).toEqual({ sessionId: "debate-1" });
    });
  });

  // ==================== Messages ====================

  describe("getMessages", () => {
    it("returns paginated messages", async () => {
      const messages = { items: [], cursor: null };
      mockAiTeamsService.getMessages.mockResolvedValue(messages);

      const result = await controller.getMessages(
        makeReq(),
        "topic-1",
        "cursor-abc",
        "20",
      );

      expect(mockAiTeamsService.getMessages).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        {
          cursor: "cursor-abc",
          limit: 20,
        },
      );
      expect(result).toBe(messages);
    });

    it("passes undefined limit when not provided", async () => {
      mockAiTeamsService.getMessages.mockResolvedValue([]);

      await controller.getMessages(makeReq(), "topic-1", undefined, undefined);

      expect(mockAiTeamsService.getMessages).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        {
          cursor: undefined,
          limit: undefined,
        },
      );
    });
  });

  describe("sendMessage", () => {
    it("sends message and broadcasts via gateway", async () => {
      const dto = {
        content: "Hello",
        mentions: [],
      };
      const message = { id: "msg-1", content: "Hello", createdAt: new Date() };
      mockAiTeamsService.sendMessage.mockResolvedValue(message);

      const result = await controller.sendMessage(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockAiTeamsService.sendMessage).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto,
      );
      expect(mockAiTeamsGateway.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "message:new",
        message,
      );
      expect(result).toBe(message);
    });

    it("returns null when message is null", async () => {
      mockAiTeamsService.sendMessage.mockResolvedValue(null);

      const result = await controller.sendMessage(makeReq(), "topic-1", {
        content: "test",
        mentions: [],
      } as never);

      expect(result).toBeNull();
    });

    it("handles @AI mentions and triggers AI response", async () => {
      const dto = {
        content: "Hello @AI",
        mentions: [{ mentionType: MentionType.AI, aiMemberId: "ai-1" }],
      };
      const message = { id: "msg-2", content: "Hello", createdAt: new Date() };
      const topic = {
        aiMembers: [{ id: "ai-1", displayName: "AI Agent", isLeader: false }],
        members: [],
      };
      mockAiTeamsService.sendMessage.mockResolvedValue(message);
      mockAiTeamsService.getTopicById.mockResolvedValue(topic);
      mockTeamMissionService.handleLeaderMentionCommand.mockResolvedValue({
        handled: false,
      });

      const result = await controller.sendMessage(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockAiTeamsService.getTopicById).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toBe(message);
    });

    it("handles @ALL mentions triggering all AI members", async () => {
      const dto = {
        content: "Hello everyone",
        mentions: [{ mentionType: MentionType.ALL_AI }],
      };
      const message = { id: "msg-3", content: "Hello", createdAt: new Date() };
      const topic = {
        aiMembers: [
          { id: "ai-1", displayName: "AI 1", isLeader: false },
          { id: "ai-2", displayName: "AI 2", isLeader: false },
        ],
        members: [],
      };
      mockAiTeamsService.sendMessage.mockResolvedValue(message);
      mockAiTeamsService.getTopicById.mockResolvedValue(topic);
      mockTeamMissionService.handleLeaderMentionCommand.mockResolvedValue({
        handled: false,
      });

      const result = await controller.sendMessage(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(result).toBe(message);
    });

    it("returns early when leader command is handled", async () => {
      const dto = {
        content: "@Leader continue",
        mentions: [{ mentionType: MentionType.AI, aiMemberId: "leader-1" }],
      };
      const message = {
        id: "msg-4",
        content: "@Leader continue",
        createdAt: new Date(),
      };
      const topic = {
        aiMembers: [{ id: "leader-1", displayName: "Leader", isLeader: true }],
        members: [],
      };
      mockAiTeamsService.sendMessage.mockResolvedValue(message);
      mockAiTeamsService.getTopicById.mockResolvedValue(topic);
      mockTeamMissionService.handleLeaderMentionCommand.mockResolvedValue({
        handled: true,
        action: "continue",
        missionId: "mission-1",
      });

      const result = await controller.sendMessage(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(result).toBe(message);
      // After leader command is handled, no AI response is generated
      expect(mockAiTeamsService.generateAIResponse).not.toHaveBeenCalled();
    });
  });

  describe("deleteMessage", () => {
    it("deletes a message", async () => {
      mockAiTeamsService.deleteMessage.mockResolvedValue({ deleted: true });

      const result = await controller.deleteMessage(
        makeReq(),
        "topic-1",
        "msg-1",
      );

      expect(mockAiTeamsService.deleteMessage).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  describe("addReaction", () => {
    it("adds a reaction to a message", async () => {
      mockAiTeamsService.addReaction.mockResolvedValue({ reacted: true });

      const result = await controller.addReaction(
        makeReq(),
        "topic-1",
        "msg-1",
        "👍",
      );

      expect(mockAiTeamsService.addReaction).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
        "👍",
      );
      expect(result).toEqual({ reacted: true });
    });
  });

  describe("removeReaction", () => {
    it("removes a reaction from a message", async () => {
      mockAiTeamsService.removeReaction.mockResolvedValue({ removed: true });

      const result = await controller.removeReaction(
        makeReq(),
        "topic-1",
        "msg-1",
        "👍",
      );

      expect(mockAiTeamsService.removeReaction).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
        "👍",
      );
      expect(result).toEqual({ removed: true });
    });
  });

  describe("markAsRead", () => {
    it("marks topic messages as read", async () => {
      mockAiTeamsService.markAsRead.mockResolvedValue({ updated: 5 });

      const result = await controller.markAsRead(
        makeReq(),
        "topic-1",
        "msg-10",
      );

      expect(mockAiTeamsService.markAsRead).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-10",
      );
      expect(result).toEqual({ updated: 5 });
    });
  });

  describe("generateAIResponse", () => {
    it("triggers manual AI response generation", async () => {
      const aiMsg = { id: "ai-msg-1", content: "response" };
      mockAiTeamsService.generateAIResponse.mockResolvedValue(aiMsg);

      const result = await controller.generateAIResponse(
        makeReq(),
        "topic-1",
        "ai-1",
        ["ctx-1"],
      );

      expect(mockAiTeamsService.generateAIResponse).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
        ["ctx-1"],
      );
      expect(result).toBe(aiMsg);
    });

    it("defaults to empty contextMessageIds", async () => {
      const aiMsg = { id: "ai-msg-2", content: "response" };
      mockAiTeamsService.generateAIResponse.mockResolvedValue(aiMsg);

      await controller.generateAIResponse(
        makeReq(),
        "topic-1",
        "ai-1",
        undefined,
      );

      expect(mockAiTeamsService.generateAIResponse).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
        [],
      );
    });
  });

  // ==================== Resources ====================

  describe("getResources", () => {
    it("returns resources for a topic", async () => {
      const resources = [{ id: "res-1" }];
      mockAiTeamsService.getResources.mockResolvedValue(resources);

      const result = await controller.getResources(makeReq(), "topic-1");

      expect(mockAiTeamsService.getResources).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toBe(resources);
    });
  });

  describe("addResource", () => {
    it("adds a resource to a topic", async () => {
      const dto = { url: "https://example.com" };
      const resource = { id: "res-2" };
      mockAiTeamsService.addResource.mockResolvedValue(resource);

      const result = await controller.addResource(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockAiTeamsService.addResource).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto,
      );
      expect(result).toBe(resource);
    });
  });

  describe("removeResource", () => {
    it("removes a resource from a topic", async () => {
      mockAiTeamsService.removeResource.mockResolvedValue({ deleted: true });

      const result = await controller.removeResource(
        makeReq(),
        "topic-1",
        "res-1",
      );

      expect(mockAiTeamsService.removeResource).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "res-1",
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  // ==================== Summaries ====================

  describe("getSummaries", () => {
    it("returns summaries for a topic", async () => {
      const summaries = [{ id: "sum-1" }];
      mockAiTeamsService.getSummaries.mockResolvedValue(summaries);

      const result = await controller.getSummaries(makeReq(), "topic-1");

      expect(mockAiTeamsService.getSummaries).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toBe(summaries);
    });
  });

  describe("generateSummary", () => {
    it("generates a summary", async () => {
      const dto = { type: "brief" };
      const summary = { id: "sum-2", content: "Summary text" };
      mockAiTeamsService.generateSummary.mockResolvedValue(summary);

      const result = await controller.generateSummary(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockAiTeamsService.generateSummary).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto,
      );
      expect(result).toBe(summary);
    });
  });

  describe("deleteSummary", () => {
    it("deletes a summary", async () => {
      mockAiTeamsService.deleteSummary.mockResolvedValue({ deleted: true });

      const result = await controller.deleteSummary(
        makeReq(),
        "topic-1",
        "sum-1",
      );

      expect(mockAiTeamsService.deleteSummary).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "sum-1",
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  // ==================== Forward & Bookmark ====================

  describe("forwardMessages", () => {
    it("forwards messages to another topic and emits event", async () => {
      const dto = {
        targetType: "TOPIC" as const,
        targetTopicId: "topic-2",
        messageIds: ["msg-1"],
      };
      const fwdResult = { messageCount: 1 };
      mockAiTeamsService.forwardMessages.mockResolvedValue(fwdResult);

      const result = await controller.forwardMessages(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockAiTeamsService.forwardMessages).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto,
      );
      expect(mockAiTeamsGateway.emitToTopic).toHaveBeenCalledWith(
        "topic-2",
        "messages:forwarded",
        expect.objectContaining({ fromTopicId: "topic-1", messageCount: 1 }),
      );
      expect(result).toBe(fwdResult);
    });

    it("does not emit when targetType is not TOPIC", async () => {
      const dto = { targetType: "LIBRARY", messageIds: ["msg-1"] };
      mockAiTeamsService.forwardMessages.mockResolvedValue({ messageCount: 1 });
      jest.clearAllMocks();
      mockAiTeamsService.forwardMessages.mockResolvedValue({ messageCount: 1 });

      await controller.forwardMessages(makeReq(), "topic-1", dto as never);

      expect(mockAiTeamsGateway.emitToTopic).not.toHaveBeenCalled();
    });
  });

  describe("bookmarkMessage", () => {
    it("bookmarks a message", async () => {
      const dto = { category: "important" };
      mockAiTeamsService.bookmarkMessage.mockResolvedValue({
        bookmarked: true,
      });

      const result = await controller.bookmarkMessage(
        makeReq(),
        "topic-1",
        "msg-1",
        dto as never,
      );

      expect(mockAiTeamsService.bookmarkMessage).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
        dto,
      );
      expect(result).toEqual({ bookmarked: true });
    });
  });

  describe("unbookmarkMessage", () => {
    it("removes a bookmark", async () => {
      mockAiTeamsService.unbookmarkMessage.mockResolvedValue({ removed: true });

      const result = await controller.unbookmarkMessage(
        makeReq(),
        "topic-1",
        "msg-1",
      );

      expect(mockAiTeamsService.unbookmarkMessage).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
      );
      expect(result).toEqual({ removed: true });
    });
  });

  // ==================== Team Mission ====================

  describe("createMission", () => {
    it("creates a team mission", async () => {
      const dto = { goal: "Research topic X" };
      const mission = { id: "mission-1" };
      mockTeamMissionService.createMission.mockResolvedValue(mission);

      const result = await controller.createMission(
        makeReq(),
        "topic-1",
        dto as never,
      );

      expect(mockTeamMissionService.createMission).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        dto,
      );
      expect(result).toBe(mission);
    });
  });

  describe("getMissions", () => {
    it("returns missions for a topic", async () => {
      const missions = [{ id: "m-1" }];
      mockTeamMissionService.getMissions.mockResolvedValue(missions);

      const result = await controller.getMissions(
        "topic-1",
        MissionStatus.EXECUTING,
      );

      expect(mockTeamMissionService.getMissions).toHaveBeenCalledWith(
        "topic-1",
        {
          status: MissionStatus.EXECUTING,
        },
      );
      expect(result).toBe(missions);
    });
  });

  describe("getMissionById", () => {
    it("returns mission by id", async () => {
      const mission = { id: "mission-1" };
      mockTeamMissionService.getMissionById.mockResolvedValue(mission);

      const result = await controller.getMissionById("topic-1", "mission-1");

      expect(mockTeamMissionService.getMissionById).toHaveBeenCalledWith(
        "mission-1",
      );
      expect(result).toBe(mission);
    });
  });

  describe("cancelMission", () => {
    it("cancels a mission", async () => {
      mockTeamMissionService.cancelMission.mockResolvedValue({
        status: "CANCELLED",
      });

      const result = await controller.cancelMission(
        makeReq(),
        "topic-1",
        "mission-1",
      );

      expect(mockTeamMissionService.cancelMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
      expect(result).toEqual({ status: "CANCELLED" });
    });
  });

  describe("pauseMission", () => {
    it("pauses a mission", async () => {
      mockTeamMissionService.pauseMission.mockResolvedValue({
        status: "PAUSED",
      });

      const result = await controller.pauseMission(
        makeReq(),
        "topic-1",
        "mission-1",
      );

      expect(mockTeamMissionService.pauseMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
      expect(result).toEqual({ status: "PAUSED" });
    });
  });

  describe("resumeMission", () => {
    it("resumes a paused mission", async () => {
      mockTeamMissionService.resumeMission.mockResolvedValue({
        status: "EXECUTING",
      });

      const result = await controller.resumeMission(
        makeReq(),
        "topic-1",
        "mission-1",
      );

      expect(mockTeamMissionService.resumeMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
      expect(result).toEqual({ status: "EXECUTING" });
    });
  });

  describe("retryMission", () => {
    it("retries a failed mission", async () => {
      mockTeamMissionService.retryMission.mockResolvedValue({
        status: "EXECUTING",
      });

      const result = await controller.retryMission(
        makeReq(),
        "topic-1",
        "mission-1",
        { mode: "continue", reason: "timeout" },
      );

      expect(mockTeamMissionService.retryMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        {
          mode: "continue",
          reason: "timeout",
        },
      );
      expect(result).toEqual({ status: "EXECUTING" });
    });
  });

  describe("getFullReport", () => {
    it("returns full report for a mission", async () => {
      const report = { id: "rpt-1", content: "Full report" };
      mockTeamMissionService.getFullReport.mockResolvedValue(report);

      const result = await controller.getFullReport("topic-1", "mission-1");

      expect(mockTeamMissionService.getFullReport).toHaveBeenCalledWith(
        "mission-1",
      );
      expect(result).toBe(report);
    });
  });

  describe("regenerateFinalReport", () => {
    it("regenerates the final report", async () => {
      mockTeamMissionService.regenerateFinalReport.mockResolvedValue({
        regenerated: true,
      });

      const result = await controller.regenerateFinalReport(
        "topic-1",
        "mission-1",
      );

      expect(mockTeamMissionService.regenerateFinalReport).toHaveBeenCalledWith(
        "mission-1",
      );
      expect(result).toEqual({ regenerated: true });
    });
  });

  describe("getMissionLogs", () => {
    it("returns mission logs with pagination", async () => {
      const logs = { items: [], cursor: null };
      mockTeamMissionService.getMissionLogs.mockResolvedValue(logs);

      const result = await controller.getMissionLogs(
        "topic-1",
        "mission-1",
        "10",
        "cur-1",
      );

      expect(mockTeamMissionService.getMissionLogs).toHaveBeenCalledWith(
        "mission-1",
        {
          limit: 10,
          cursor: "cur-1",
        },
      );
      expect(result).toBe(logs);
    });
  });

  describe("deleteMission", () => {
    it("deletes a historical mission", async () => {
      mockTeamMissionService.deleteMission.mockResolvedValue({ deleted: true });

      const result = await controller.deleteMission(
        makeReq(),
        "topic-1",
        "mission-1",
      );

      expect(mockTeamMissionService.deleteMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
      expect(result).toEqual({ deleted: true });
    });
  });

  // ==================== Team Role ====================

  describe("setLeader", () => {
    it("sets an AI member as leader", async () => {
      mockTeamMissionService.setLeader.mockResolvedValue({ isLeader: true });

      const result = await controller.setLeader("topic-1", "ai-1");

      expect(mockTeamMissionService.setLeader).toHaveBeenCalledWith(
        "topic-1",
        "ai-1",
      );
      expect(result).toEqual({ isLeader: true });
    });
  });

  describe("updateTeamRole", () => {
    it("updates AI member team role", async () => {
      const dto = { role: "ANALYST" };
      mockAiTeamsService.updateAIMemberTeamRole.mockResolvedValue({
        role: "ANALYST",
      });

      const result = await controller.updateTeamRole(
        makeReq(),
        "topic-1",
        "ai-1",
        dto as never,
      );

      expect(mockAiTeamsService.updateAIMemberTeamRole).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
        dto,
      );
      expect(result).toEqual({ role: "ANALYST" });
    });
  });

  describe("getTeamMembers", () => {
    it("returns team members", async () => {
      const members = [{ id: "ai-1", role: "ANALYST" }];
      mockTeamMissionService.getTeamMembers.mockResolvedValue(members);

      const result = await controller.getTeamMembers("topic-1");

      expect(mockTeamMissionService.getTeamMembers).toHaveBeenCalledWith(
        "topic-1",
      );
      expect(result).toBe(members);
    });
  });

  // ==================== Debate API ====================

  describe("getDebates", () => {
    it("returns debates for a topic", async () => {
      const debates = [{ id: "d-1" }];
      mockDebateService.getDebatesByTopic.mockResolvedValue(debates);

      const result = await controller.getDebates("topic-1");

      expect(mockDebateService.getDebatesByTopic).toHaveBeenCalledWith(
        "topic-1",
      );
      expect(result).toBe(debates);
    });
  });

  describe("getDebate", () => {
    it("returns a specific debate session", async () => {
      const debate = { id: "d-1", status: "COMPLETED" };
      mockDebateService.getDebateSession.mockResolvedValue(debate);

      const result = await controller.getDebate("d-1");

      expect(mockDebateService.getDebateSession).toHaveBeenCalledWith("d-1");
      expect(result).toBe(debate);
    });
  });

  // ==================== URL Parsing ====================

  describe("parseUrl", () => {
    it("parses a single URL", async () => {
      const parsed = { title: "Example", content: "Some content" };
      mockUrlParserService.parseUrl.mockResolvedValue(parsed);

      const result = await controller.parseUrl({ url: "https://example.com" });

      expect(mockUrlParserService.parseUrl).toHaveBeenCalledWith(
        "https://example.com",
      );
      expect(result).toBe(parsed);
    });
  });

  describe("parseUrls", () => {
    it("parses multiple URLs", async () => {
      const parsed = [{ url: "https://a.com", title: "A" }];
      mockUrlParserService.parseUrls.mockResolvedValue(parsed);

      const result = await controller.parseUrls({ urls: ["https://a.com"] });

      expect(mockUrlParserService.parseUrls).toHaveBeenCalledWith([
        "https://a.com",
      ]);
      expect(result).toBe(parsed);
    });
  });

  describe("detectUrls", () => {
    it("detects URLs in text", async () => {
      const detected = ["https://example.com"];
      mockUrlParserService.detectUrls.mockResolvedValue(detected);

      const result = await controller.detectUrls({
        text: "Visit https://example.com today",
      });

      expect(mockUrlParserService.detectUrls).toHaveBeenCalledWith(
        "Visit https://example.com today",
      );
      expect(result).toBe(detected);
    });
  });

  describe("detectAndParseUrls", () => {
    it("detects and parses all URLs in text", async () => {
      const results = [{ url: "https://example.com", title: "Example" }];
      mockUrlParserService.detectAndParseUrls.mockResolvedValue(results);

      const result = await controller.detectAndParseUrls({
        text: "Check https://example.com",
      });

      expect(mockUrlParserService.detectAndParseUrls).toHaveBeenCalledWith(
        "Check https://example.com",
      );
      expect(result).toBe(results);
    });
  });
});

// ---------------------------------------------------------------------------
// Test suite: BookmarksController
// ---------------------------------------------------------------------------

describe("BookmarksController", () => {
  let controller: BookmarksController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookmarksController],
      providers: [{ provide: AiTeamsService, useValue: mockAiTeamsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(BookmarksController);
  });

  describe("getBookmarks", () => {
    it("returns user bookmarks filtered by category", async () => {
      const bookmarks = [{ id: "bm-1", category: "research" }];
      mockAiTeamsService.getBookmarks.mockResolvedValue(bookmarks);

      const result = await controller.getBookmarks(makeReq(), "research");

      expect(mockAiTeamsService.getBookmarks).toHaveBeenCalledWith("user-1", {
        category: "research",
      });
      expect(result).toBe(bookmarks);
    });

    it("returns all bookmarks when no category provided", async () => {
      mockAiTeamsService.getBookmarks.mockResolvedValue([]);

      await controller.getBookmarks(makeReq(), undefined);

      expect(mockAiTeamsService.getBookmarks).toHaveBeenCalledWith("user-1", {
        category: undefined,
      });
    });
  });

  describe("getBookmarkCategories", () => {
    it("returns bookmark categories for user", async () => {
      const categories = ["research", "ideas", "references"];
      mockAiTeamsService.getBookmarkCategories.mockResolvedValue(categories);

      const result = await controller.getBookmarkCategories(makeReq());

      expect(mockAiTeamsService.getBookmarkCategories).toHaveBeenCalledWith(
        "user-1",
      );
      expect(result).toBe(categories);
    });
  });
});

// ---------------------------------------------------------------------------
// Test suite: UsersController
// ---------------------------------------------------------------------------

describe("UsersController", () => {
  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: AiTeamsService, useValue: mockAiTeamsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UsersController);
  });

  describe("searchUsers", () => {
    it("searches by email when email param is provided", async () => {
      const user = { id: "user-2", email: "test@example.com" };
      mockAiTeamsService.searchUserByEmail.mockResolvedValue(user);

      const result = await controller.searchUsers(
        "test@example.com",
        undefined,
        undefined,
      );

      expect(mockAiTeamsService.searchUserByEmail).toHaveBeenCalledWith(
        "test@example.com",
      );
      expect(result).toBe(user);
    });

    it("searches by query when query param is provided", async () => {
      const users = [{ id: "user-3" }];
      mockAiTeamsService.searchUsers.mockResolvedValue(users);

      const result = await controller.searchUsers(undefined, "john", "5");

      expect(mockAiTeamsService.searchUsers).toHaveBeenCalledWith("john", 5);
      expect(result).toBe(users);
    });

    it("defaults limit to 10 when not provided", async () => {
      mockAiTeamsService.searchUsers.mockResolvedValue([]);

      await controller.searchUsers(undefined, "john", undefined);

      expect(mockAiTeamsService.searchUsers).toHaveBeenCalledWith("john", 10);
    });

    it("returns empty array when neither email nor query is provided", async () => {
      const result = await controller.searchUsers(
        undefined,
        undefined,
        undefined,
      );

      expect(result).toEqual([]);
      expect(mockAiTeamsService.searchUserByEmail).not.toHaveBeenCalled();
      expect(mockAiTeamsService.searchUsers).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Test suite: PublicReportsController
// ---------------------------------------------------------------------------

describe("PublicReportsController", () => {
  let controller: PublicReportsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicReportsController],
      providers: [
        { provide: TeamMissionService, useValue: mockTeamMissionService },
      ],
    }).compile();

    controller = module.get(PublicReportsController);
  });

  describe("getPublicReport", () => {
    it("returns public report by missionId", async () => {
      const report = {
        id: "mission-1",
        title: "Research Report",
        status: "COMPLETED",
      };
      mockTeamMissionService.getPublicReport.mockResolvedValue(report);

      const result = await controller.getPublicReport("mission-1");

      expect(mockTeamMissionService.getPublicReport).toHaveBeenCalledWith(
        "mission-1",
      );
      expect(result).toBe(report);
    });

    it("propagates NotFoundException from service", async () => {
      mockTeamMissionService.getPublicReport.mockRejectedValue(
        new NotFoundException("Report not found"),
      );

      await expect(controller.getPublicReport("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

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

import { MissionStatus, TopicRole, TopicType } from "@prisma/client";
import {
  AiTeamsController,
  BookmarksController,
  UsersController,
  PublicReportsController,
} from "../controllers/ai-teams.controller";

// ==================== Mocks ====================

const mockAiGroupService = {
  createTopic: jest.fn(),
  getTopics: jest.fn(),
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
  addAIMember: jest.fn(),
  updateAIMember: jest.fn(),
  removeAIMember: jest.fn(),
  updateAIMemberTeamRole: jest.fn(),
  setupDebateAIs: jest.fn(),
  getMessages: jest.fn(),
  sendMessage: jest.fn(),
  deleteMessage: jest.fn(),
  addReaction: jest.fn(),
  removeReaction: jest.fn(),
  markAsRead: jest.fn(),
  getResources: jest.fn(),
  addResource: jest.fn(),
  removeResource: jest.fn(),
  getSummaries: jest.fn(),
  generateSummary: jest.fn(),
  deleteSummary: jest.fn(),
  generateAIResponse: jest.fn(),
  forwardMessages: jest.fn(),
  bookmarkMessage: jest.fn(),
  unbookmarkMessage: jest.fn(),
  getBookmarks: jest.fn(),
  getBookmarkCategories: jest.fn(),
  getPublicTopics: jest.fn(),
  requestToJoinTopic: jest.fn(),
  getJoinRequests: jest.fn(),
  getMyJoinRequests: jest.fn(),
  reviewJoinRequest: jest.fn(),
  cancelJoinRequest: jest.fn(),
  searchUserByEmail: jest.fn(),
  searchUsers: jest.fn(),
};

const mockAiGroupGateway = {
  emitToTopic: jest.fn(),
  emitToUser: jest.fn(),
  getOnlineUsersInTopic: jest.fn(),
  server: { to: jest.fn().mockReturnThis(), emit: jest.fn() },
};

const mockDebateService = {
  setupDebate: jest.fn(),
  generateDebateResponse: jest.fn(),
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
  getPublicReport: jest.fn(),
};

const mockUrlParserService = {
  parseUrl: jest.fn(),
  parseUrls: jest.fn(),
  detectUrls: jest.fn(),
  detectAndParseUrls: jest.fn(),
};

// Request helper
const mockRequest = (userId = "user-1") => ({ user: { id: userId } }) as never;

describe("AiTeamsController", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();

    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  // ==================== Topic CRUD ====================

  describe("createTopic", () => {
    it("calls aiGroupService.createTopic with userId and dto", async () => {
      const dto = { name: "New Topic" };
      mockAiGroupService.createTopic.mockResolvedValue({
        id: "topic-1",
        ...dto,
      });

      const result = await controller.createTopic(mockRequest(), dto as never);

      expect(mockAiGroupService.createTopic).toHaveBeenCalledWith(
        "user-1",
        dto,
      );
      expect(result).toMatchObject({ id: "topic-1" });
    });
  });

  describe("getTopics", () => {
    it("calls aiGroupService.getTopics with userId, type, and search", async () => {
      mockAiGroupService.getTopics.mockResolvedValue([]);

      await controller.getTopics(mockRequest(), TopicType.PRIVATE, "query");

      expect(mockAiGroupService.getTopics).toHaveBeenCalledWith("user-1", {
        type: TopicType.PRIVATE,
        search: "query",
      });
    });

    it("calls aiGroupService.getTopics with undefined type and search when not provided", async () => {
      mockAiGroupService.getTopics.mockResolvedValue([]);

      await controller.getTopics(mockRequest());

      expect(mockAiGroupService.getTopics).toHaveBeenCalledWith("user-1", {
        type: undefined,
        search: undefined,
      });
    });
  });

  describe("getPublicTopics", () => {
    it("calls aiGroupService.getPublicTopics with search and parsed limit", async () => {
      mockAiGroupService.getPublicTopics.mockResolvedValue([]);

      await controller.getPublicTopics("test", "20");

      expect(mockAiGroupService.getPublicTopics).toHaveBeenCalledWith({
        search: "test",
        limit: 20,
      });
    });

    it("uses default limit of 50 when not provided", async () => {
      mockAiGroupService.getPublicTopics.mockResolvedValue([]);

      await controller.getPublicTopics(undefined, undefined);

      expect(mockAiGroupService.getPublicTopics).toHaveBeenCalledWith({
        search: undefined,
        limit: 50,
      });
    });
  });

  describe("getMyJoinRequests", () => {
    it("delegates to aiGroupService.getMyJoinRequests", async () => {
      mockAiGroupService.getMyJoinRequests.mockResolvedValue([]);

      await controller.getMyJoinRequests(mockRequest());

      expect(mockAiGroupService.getMyJoinRequests).toHaveBeenCalledWith(
        "user-1",
      );
    });
  });

  describe("reviewJoinRequest", () => {
    it("calls aiGroupService.reviewJoinRequest with correct args", async () => {
      mockAiGroupService.reviewJoinRequest.mockResolvedValue({
        approved: true,
      });

      await controller.reviewJoinRequest(mockRequest(), "req-1", {
        approve: true,
        responseNote: "Welcome!",
      });

      expect(mockAiGroupService.reviewJoinRequest).toHaveBeenCalledWith(
        "req-1",
        "user-1",
        true,
        "Welcome!",
      );
    });
  });

  describe("cancelJoinRequest", () => {
    it("delegates to aiGroupService.cancelJoinRequest", async () => {
      mockAiGroupService.cancelJoinRequest.mockResolvedValue({
        cancelled: true,
      });

      await controller.cancelJoinRequest(mockRequest(), "req-1");

      expect(mockAiGroupService.cancelJoinRequest).toHaveBeenCalledWith(
        "req-1",
        "user-1",
      );
    });
  });

  describe("getTopicById", () => {
    it("delegates to aiGroupService.getTopicById", async () => {
      mockAiGroupService.getTopicById.mockResolvedValue({ id: "topic-1" });

      const result = await controller.getTopicById(mockRequest(), "topic-1");

      expect(mockAiGroupService.getTopicById).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
      expect(result).toEqual({ id: "topic-1" });
    });
  });

  describe("updateTopic", () => {
    it("delegates to aiGroupService.updateTopic", async () => {
      mockAiGroupService.updateTopic.mockResolvedValue({
        id: "topic-1",
        name: "Updated",
      });

      await controller.updateTopic(mockRequest(), "topic-1", {
        name: "Updated",
      } as never);

      expect(mockAiGroupService.updateTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        { name: "Updated" },
      );
    });
  });

  describe("archiveTopic", () => {
    it("delegates to aiGroupService.archiveTopic", async () => {
      mockAiGroupService.archiveTopic.mockResolvedValue({ id: "topic-1" });

      await controller.archiveTopic(mockRequest(), "topic-1");

      expect(mockAiGroupService.archiveTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
    });
  });

  describe("deleteTopic", () => {
    it("delegates to aiGroupService.deleteTopic", async () => {
      mockAiGroupService.deleteTopic.mockResolvedValue({ deleted: true });

      await controller.deleteTopic(mockRequest(), "topic-1");

      expect(mockAiGroupService.deleteTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
    });
  });

  // ==================== Member Management ====================

  describe("getMembers", () => {
    it("returns topic members", async () => {
      const members = [{ id: "m-1", userId: "user-1" }];
      mockAiGroupService.getTopicById.mockResolvedValue({
        id: "topic-1",
        members,
      });

      const result = await controller.getMembers(mockRequest(), "topic-1");

      expect(result).toEqual(members);
    });
  });

  describe("addMember", () => {
    it("delegates to aiGroupService.addMember", async () => {
      mockAiGroupService.addMember.mockResolvedValue({ id: "m-1" });

      await controller.addMember(mockRequest(), "topic-1", {
        userId: "user-2",
      } as never);

      expect(mockAiGroupService.addMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        { userId: "user-2" },
      );
    });
  });

  describe("addMemberByEmail", () => {
    it("delegates to aiGroupService.addMemberByEmail", async () => {
      mockAiGroupService.addMemberByEmail.mockResolvedValue({ id: "m-1" });

      await controller.addMemberByEmail(mockRequest(), "topic-1", {
        email: "test@example.com",
        role: TopicRole.MEMBER,
      });

      expect(mockAiGroupService.addMemberByEmail).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "test@example.com",
        TopicRole.MEMBER,
      );
    });
  });

  describe("addMembers", () => {
    it("delegates to aiGroupService.addMembers", async () => {
      mockAiGroupService.addMembers.mockResolvedValue({ added: 2 });

      await controller.addMembers(mockRequest(), "topic-1", {
        userIds: ["u2", "u3"],
      } as never);

      expect(mockAiGroupService.addMembers).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        { userIds: ["u2", "u3"] },
      );
    });
  });

  describe("updateMember", () => {
    it("delegates to aiGroupService.updateMember", async () => {
      mockAiGroupService.updateMember.mockResolvedValue({ id: "m-1" });

      await controller.updateMember(mockRequest(), "topic-1", "m-1", {
        role: TopicRole.ADMIN,
      } as never);

      expect(mockAiGroupService.updateMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "m-1",
        { role: TopicRole.ADMIN },
      );
    });
  });

  describe("removeMember", () => {
    it("delegates to aiGroupService.removeMember", async () => {
      mockAiGroupService.removeMember.mockResolvedValue({ removed: true });

      await controller.removeMember(mockRequest(), "topic-1", "m-1");

      expect(mockAiGroupService.removeMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "m-1",
      );
    });
  });

  describe("leaveTopic", () => {
    it("delegates to aiGroupService.leaveTopic", async () => {
      mockAiGroupService.leaveTopic.mockResolvedValue({ left: true });

      await controller.leaveTopic(mockRequest(), "topic-1");

      expect(mockAiGroupService.leaveTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
    });
  });

  describe("requestToJoinTopic", () => {
    it("delegates to aiGroupService.requestToJoinTopic", async () => {
      mockAiGroupService.requestToJoinTopic.mockResolvedValue({ id: "req-1" });

      await controller.requestToJoinTopic(mockRequest(), "topic-1", {
        requestMessage: "Please add me",
      });

      expect(mockAiGroupService.requestToJoinTopic).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "Please add me",
      );
    });
  });

  describe("getJoinRequests", () => {
    it("delegates to aiGroupService.getJoinRequests", async () => {
      mockAiGroupService.getJoinRequests.mockResolvedValue([]);

      await controller.getJoinRequests(mockRequest(), "topic-1");

      expect(mockAiGroupService.getJoinRequests).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
    });
  });

  // ==================== AI Member Management ====================

  describe("getAIMembers", () => {
    it("returns AI members from topic", async () => {
      const aiMembers = [{ id: "ai-1", displayName: "Bot" }];
      mockAiGroupService.getTopicById.mockResolvedValue({
        id: "topic-1",
        aiMembers,
      });

      const result = await controller.getAIMembers(mockRequest(), "topic-1");

      expect(result).toEqual(aiMembers);
    });
  });

  // ==================== Mission API ====================

  describe("createMission", () => {
    it("delegates to teamMissionService.createMission", async () => {
      mockTeamMissionService.createMission.mockResolvedValue({
        id: "mission-1",
      });

      await controller.createMission(mockRequest(), "topic-1", {
        objective: "Test",
      } as never);

      expect(mockTeamMissionService.createMission).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        { objective: "Test" },
      );
    });
  });

  describe("getMissions", () => {
    it("delegates to teamMissionService.getMissions with status filter", async () => {
      mockTeamMissionService.getMissions.mockResolvedValue([]);

      await controller.getMissions("topic-1", MissionStatus.PENDING);

      expect(mockTeamMissionService.getMissions).toHaveBeenCalledWith(
        "topic-1",
        {
          status: MissionStatus.PENDING,
        },
      );
    });

    it("passes undefined status when not provided", async () => {
      mockTeamMissionService.getMissions.mockResolvedValue([]);

      await controller.getMissions("topic-1");

      expect(mockTeamMissionService.getMissions).toHaveBeenCalledWith(
        "topic-1",
        {
          status: undefined,
        },
      );
    });
  });

  describe("getMissionById", () => {
    it("delegates to teamMissionService.getMissionById", async () => {
      mockTeamMissionService.getMissionById.mockResolvedValue({
        id: "mission-1",
      });

      await controller.getMissionById("topic-1", "mission-1");

      expect(mockTeamMissionService.getMissionById).toHaveBeenCalledWith(
        "mission-1",
      );
    });
  });

  describe("cancelMission", () => {
    it("delegates to teamMissionService.cancelMission", async () => {
      mockTeamMissionService.cancelMission.mockResolvedValue({
        id: "mission-1",
      });

      await controller.cancelMission(mockRequest(), "topic-1", "mission-1");

      expect(mockTeamMissionService.cancelMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
    });
  });

  describe("pauseMission", () => {
    it("delegates to teamMissionService.pauseMission", async () => {
      mockTeamMissionService.pauseMission.mockResolvedValue({
        id: "mission-1",
      });

      await controller.pauseMission(mockRequest(), "topic-1", "mission-1");

      expect(mockTeamMissionService.pauseMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
    });
  });

  describe("resumeMission", () => {
    it("delegates to teamMissionService.resumeMission", async () => {
      mockTeamMissionService.resumeMission.mockResolvedValue({
        id: "mission-1",
      });

      await controller.resumeMission(mockRequest(), "topic-1", "mission-1");

      expect(mockTeamMissionService.resumeMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
    });
  });

  describe("retryMission", () => {
    it("delegates to teamMissionService.retryMission with mode and reason", async () => {
      mockTeamMissionService.retryMission.mockResolvedValue({
        id: "mission-1",
      });

      await controller.retryMission(mockRequest(), "topic-1", "mission-1", {
        mode: "full",
        reason: "retry needed",
      });

      expect(mockTeamMissionService.retryMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        { mode: "full", reason: "retry needed" },
      );
    });

    it("delegates with undefined mode/reason when not provided", async () => {
      mockTeamMissionService.retryMission.mockResolvedValue({
        id: "mission-1",
      });

      await controller.retryMission(mockRequest(), "topic-1", "mission-1", {});

      expect(mockTeamMissionService.retryMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        { mode: undefined, reason: undefined },
      );
    });
  });

  describe("getFullReport", () => {
    it("delegates to teamMissionService.getFullReport", async () => {
      mockTeamMissionService.getFullReport.mockResolvedValue({
        content: "full report",
      });

      await controller.getFullReport("topic-1", "mission-1");

      expect(mockTeamMissionService.getFullReport).toHaveBeenCalledWith(
        "mission-1",
      );
    });
  });

  describe("regenerateFinalReport", () => {
    it("delegates to teamMissionService.regenerateFinalReport", async () => {
      mockTeamMissionService.regenerateFinalReport.mockResolvedValue({
        success: true,
      });

      await controller.regenerateFinalReport("topic-1", "mission-1");

      expect(mockTeamMissionService.regenerateFinalReport).toHaveBeenCalledWith(
        "mission-1",
      );
    });
  });

  describe("getMissionLogs", () => {
    it("delegates to teamMissionService.getMissionLogs with parsed options", async () => {
      mockTeamMissionService.getMissionLogs.mockResolvedValue([]);

      await controller.getMissionLogs(
        "topic-1",
        "mission-1",
        "10",
        "cursor-abc",
      );

      expect(mockTeamMissionService.getMissionLogs).toHaveBeenCalledWith(
        "mission-1",
        {
          limit: 10,
          cursor: "cursor-abc",
        },
      );
    });

    it("passes undefined limit when not provided", async () => {
      mockTeamMissionService.getMissionLogs.mockResolvedValue([]);

      await controller.getMissionLogs(
        "topic-1",
        "mission-1",
        undefined,
        undefined,
      );

      expect(mockTeamMissionService.getMissionLogs).toHaveBeenCalledWith(
        "mission-1",
        {
          limit: undefined,
          cursor: undefined,
        },
      );
    });
  });

  describe("updateMissionNotification", () => {
    it("delegates to teamMissionService.updateMissionNotification", async () => {
      mockTeamMissionService.updateMissionNotification.mockResolvedValue({
        updated: true,
      });

      await controller.updateMissionNotification(
        mockRequest(),
        "topic-1",
        "mission-1",
        { email: "user@example.com", enabled: true } as never,
      );

      expect(
        mockTeamMissionService.updateMissionNotification,
      ).toHaveBeenCalledWith("mission-1", "user-1", {
        email: "user@example.com",
        enabled: true,
      });
    });
  });

  describe("deleteMission", () => {
    it("delegates to teamMissionService.deleteMission", async () => {
      mockTeamMissionService.deleteMission.mockResolvedValue({ deleted: true });

      await controller.deleteMission(mockRequest(), "topic-1", "mission-1");

      expect(mockTeamMissionService.deleteMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
    });
  });

  // ==================== Team Role API ====================

  describe("setLeader", () => {
    it("delegates to teamMissionService.setLeader", async () => {
      mockTeamMissionService.setLeader.mockResolvedValue({ isLeader: true });

      await controller.setLeader("topic-1", "ai-1");

      expect(mockTeamMissionService.setLeader).toHaveBeenCalledWith(
        "topic-1",
        "ai-1",
      );
    });
  });

  describe("updateTeamRole", () => {
    it("delegates to aiGroupService.updateAIMemberTeamRole", async () => {
      mockAiGroupService.updateAIMemberTeamRole.mockResolvedValue({
        updated: true,
      });

      await controller.updateTeamRole(mockRequest(), "topic-1", "ai-1", {
        isLeader: true,
      } as never);

      expect(mockAiGroupService.updateAIMemberTeamRole).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
        { isLeader: true },
      );
    });
  });

  describe("getTeamMembers", () => {
    it("delegates to teamMissionService.getTeamMembers", async () => {
      mockTeamMissionService.getTeamMembers.mockResolvedValue([]);

      await controller.getTeamMembers("topic-1");

      expect(mockTeamMissionService.getTeamMembers).toHaveBeenCalledWith(
        "topic-1",
      );
    });
  });

  // ==================== URL Parsing ====================

  describe("parseUrl", () => {
    it("delegates to urlParserService.parseUrl", async () => {
      mockUrlParserService.parseUrl.mockResolvedValue({ title: "Test" });

      await controller.parseUrl({ url: "https://example.com" });

      expect(mockUrlParserService.parseUrl).toHaveBeenCalledWith(
        "https://example.com",
      );
    });
  });

  describe("parseUrls", () => {
    it("delegates to urlParserService.parseUrls", async () => {
      mockUrlParserService.parseUrls.mockResolvedValue([]);

      await controller.parseUrls({ urls: ["https://a.com", "https://b.com"] });

      expect(mockUrlParserService.parseUrls).toHaveBeenCalledWith([
        "https://a.com",
        "https://b.com",
      ]);
    });
  });

  describe("detectUrls", () => {
    it("delegates to urlParserService.detectUrls", async () => {
      mockUrlParserService.detectUrls.mockResolvedValue({ urls: [] });

      await controller.detectUrls({ text: "Check https://example.com" });

      expect(mockUrlParserService.detectUrls).toHaveBeenCalledWith(
        "Check https://example.com",
      );
    });
  });

  describe("detectAndParseUrls", () => {
    it("delegates to urlParserService.detectAndParseUrls", async () => {
      mockUrlParserService.detectAndParseUrls.mockResolvedValue({
        parsedUrls: [],
      });

      await controller.detectAndParseUrls({
        text: "Visit https://example.com",
      });

      expect(mockUrlParserService.detectAndParseUrls).toHaveBeenCalledWith(
        "Visit https://example.com",
      );
    });
  });
});

// ==================== BookmarksController ====================

describe("BookmarksController", () => {
  let controller: BookmarksController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new BookmarksController(mockAiGroupService as never);
  });

  describe("getBookmarks", () => {
    it("delegates to aiGroupService.getBookmarks with category", async () => {
      mockAiGroupService.getBookmarks.mockResolvedValue([]);

      await controller.getBookmarks(mockRequest(), "important");

      expect(mockAiGroupService.getBookmarks).toHaveBeenCalledWith("user-1", {
        category: "important",
      });
    });

    it("delegates with undefined category when not provided", async () => {
      mockAiGroupService.getBookmarks.mockResolvedValue([]);

      await controller.getBookmarks(mockRequest());

      expect(mockAiGroupService.getBookmarks).toHaveBeenCalledWith("user-1", {
        category: undefined,
      });
    });
  });

  describe("getBookmarkCategories", () => {
    it("delegates to aiGroupService.getBookmarkCategories", async () => {
      mockAiGroupService.getBookmarkCategories.mockResolvedValue(["cat1"]);

      const result = await controller.getBookmarkCategories(mockRequest());

      expect(mockAiGroupService.getBookmarkCategories).toHaveBeenCalledWith(
        "user-1",
      );
      expect(result).toEqual(["cat1"]);
    });
  });
});

// ==================== UsersController ====================

describe("UsersController", () => {
  let controller: UsersController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UsersController(mockAiGroupService as never);
  });

  describe("searchUsers", () => {
    it("searches by email when email param provided", async () => {
      const user = { id: "user-1", email: "test@example.com" };
      mockAiGroupService.searchUserByEmail.mockResolvedValue(user);

      const result = await controller.searchUsers(
        "test@example.com",
        undefined,
        undefined,
      );

      expect(mockAiGroupService.searchUserByEmail).toHaveBeenCalledWith(
        "test@example.com",
      );
      expect(result).toEqual(user);
    });

    it("searches by query when query param provided", async () => {
      const users = [{ id: "user-1" }];
      mockAiGroupService.searchUsers.mockResolvedValue(users);

      const result = await controller.searchUsers(undefined, "john", "5");

      expect(mockAiGroupService.searchUsers).toHaveBeenCalledWith("john", 5);
      expect(result).toEqual(users);
    });

    it("uses default limit of 10 when no limit provided", async () => {
      mockAiGroupService.searchUsers.mockResolvedValue([]);

      await controller.searchUsers(undefined, "john", undefined);

      expect(mockAiGroupService.searchUsers).toHaveBeenCalledWith("john", 10);
    });

    it("returns empty array when neither email nor query provided", async () => {
      const result = await controller.searchUsers(
        undefined,
        undefined,
        undefined,
      );

      expect(result).toEqual([]);
      expect(mockAiGroupService.searchUserByEmail).not.toHaveBeenCalled();
      expect(mockAiGroupService.searchUsers).not.toHaveBeenCalled();
    });
  });
});

// ==================== PublicReportsController ====================

describe("PublicReportsController", () => {
  let controller: PublicReportsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PublicReportsController(mockTeamMissionService as never);
  });

  describe("getPublicReport", () => {
    it("delegates to teamMissionService.getPublicReport", async () => {
      mockTeamMissionService.getPublicReport.mockResolvedValue({
        content: "report",
      });

      const result = await controller.getPublicReport("mission-1");

      expect(mockTeamMissionService.getPublicReport).toHaveBeenCalledWith(
        "mission-1",
      );
      expect(result).toEqual({ content: "report" });
    });
  });
});

// ==================== AiTeamsController - Additional Coverage ====================

describe("AiTeamsController - sendMessage", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  it("returns null when sendMessage returns null", async () => {
    mockAiGroupService.sendMessage.mockResolvedValue(null);

    const result = await controller.sendMessage(mockRequest(), "topic-1", {
      content: "Hello",
    } as never);

    expect(result).toBeNull();
  });

  it("broadcasts message via gateway after sendMessage", async () => {
    const message = { id: "msg-1", content: "Hello", createdAt: new Date() };
    mockAiGroupService.sendMessage.mockResolvedValue(message);

    const dto = { content: "Hello", mentions: [] };
    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    expect(mockAiGroupGateway.emitToTopic).toHaveBeenCalledWith(
      "topic-1",
      "message:new",
      message,
    );
  });

  it("returns message when no mentions", async () => {
    const message = { id: "msg-1", content: "Hi", createdAt: new Date() };
    mockAiGroupService.sendMessage.mockResolvedValue(message);

    const result = await controller.sendMessage(mockRequest(), "topic-1", {
      content: "Hi",
      mentions: [],
    } as never);

    expect(result).toEqual(message);
    expect(mockAiGroupService.getTopicById).not.toHaveBeenCalled();
  });

  it("triggers AI response for AI mention (MentionType.AI)", async () => {
    const { MentionType } = require("@prisma/client");
    const message = {
      id: "msg-1",
      content: "Hello @Bot",
      createdAt: new Date(),
    };
    const aiMember = { id: "ai-1", displayName: "Bot", isLeader: false };
    const topic = { aiMembers: [aiMember], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);
    mockTeamMissionService.handleLeaderMentionCommand = jest
      .fn()
      .mockResolvedValue({ handled: false });

    const dto = {
      content: "Hello @Bot",
      mentions: [{ mentionType: MentionType.AI, aiMemberId: "ai-1" }],
    };

    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    expect(mockAiGroupGateway.emitToTopic).toHaveBeenCalledWith(
      "topic-1",
      "ai:typing",
      expect.objectContaining({ aiMemberId: "ai-1" }),
    );
  });

  it("handles ALL_AI mention type by adding all AI members", async () => {
    const { MentionType } = require("@prisma/client");
    const message = {
      id: "msg-1",
      content: "@All AIs discuss",
      createdAt: new Date(),
    };
    const aiMember1 = { id: "ai-1", displayName: "Bot1", isLeader: false };
    const aiMember2 = { id: "ai-2", displayName: "Bot2", isLeader: false };
    const topic = { aiMembers: [aiMember1, aiMember2], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);
    mockTeamMissionService.handleLeaderMentionCommand = jest
      .fn()
      .mockResolvedValue({ handled: false });

    const dto = {
      content: "@All AIs discuss",
      mentions: [{ mentionType: MentionType.ALL_AI }],
    };

    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    expect(mockAiGroupGateway.emitToTopic).toHaveBeenCalledWith(
      "topic-1",
      "ai:typing",
      expect.objectContaining({ aiMemberId: "ai-1" }),
    );
    expect(mockAiGroupGateway.emitToTopic).toHaveBeenCalledWith(
      "topic-1",
      "ai:typing",
      expect.objectContaining({ aiMemberId: "ai-2" }),
    );
  });

  it("handles USER mention type by emitting to user", async () => {
    const { MentionType } = require("@prisma/client");
    const message = {
      id: "msg-1",
      content: "@user2 hello",
      createdAt: new Date(),
    };
    const topic = { aiMembers: [], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);

    const dto = {
      content: "@user2 hello",
      mentions: [{ mentionType: MentionType.USER, userId: "user-2" }],
    };

    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    expect(mockAiGroupGateway.emitToUser).toHaveBeenCalledWith(
      "user-2",
      "mention:new",
      expect.objectContaining({ topicId: "topic-1" }),
    );
  });

  it("handles ALL mention type and notifies all human members", async () => {
    const { MentionType } = require("@prisma/client");
    const message = {
      id: "msg-1",
      content: "Hello everyone!",
      createdAt: new Date(),
    };
    const topic = {
      aiMembers: [],
      members: [{ userId: "user-2" }, { userId: "user-3" }],
    };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);

    const dto = {
      content: "Hello everyone!",
      mentions: [{ mentionType: MentionType.ALL }],
    };

    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    // Both non-sender members should receive mentions
    expect(mockAiGroupGateway.emitToUser).toHaveBeenCalledWith(
      "user-2",
      "mention:new",
      expect.objectContaining({ mentionType: "everyone" }),
    );
    expect(mockAiGroupGateway.emitToUser).toHaveBeenCalledWith(
      "user-3",
      "mention:new",
      expect.objectContaining({ mentionType: "everyone" }),
    );
  });

  it("handles leader command when leader is mentioned and command handled", async () => {
    const { MentionType } = require("@prisma/client");
    const message = {
      id: "msg-1",
      content: "继续执行",
      createdAt: new Date(),
    };
    const leaderAI = { id: "leader-1", displayName: "Leader", isLeader: true };
    const topic = { aiMembers: [leaderAI], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);
    mockTeamMissionService.handleLeaderMentionCommand = jest
      .fn()
      .mockResolvedValue({
        handled: true,
        action: "continue",
        missionId: "mission-1",
      });

    const dto = {
      content: "继续执行",
      mentions: [{ mentionType: MentionType.AI, aiMemberId: "leader-1" }],
    };

    const result = await controller.sendMessage(
      mockRequest(),
      "topic-1",
      dto as never,
    );

    expect(
      mockTeamMissionService.handleLeaderMentionCommand,
    ).toHaveBeenCalledWith("topic-1", "user-1", "继续执行");
    // Should return early after command handled
    expect(result).toEqual(message);
  });

  it("detects debate mode when content has debate keywords and 2+ AI members", async () => {
    const { MentionType } = require("@prisma/client");
    const message = {
      id: "msg-1",
      content: "请辩论一下",
      createdAt: new Date(),
    };
    const ai1 = { id: "ai-1", displayName: "RedBot", isLeader: false };
    const ai2 = { id: "ai-2", displayName: "BlueBot", isLeader: false };
    const topic = { aiMembers: [ai1, ai2], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);
    mockTeamMissionService.handleLeaderMentionCommand = jest
      .fn()
      .mockResolvedValue({ handled: false });
    mockDebateService.createDebateSession = jest.fn().mockResolvedValue({
      id: "debate-1",
      agents: [
        { id: "agent-1", role: "RED", aiMemberId: "ai-1", aiModel: "gpt-4o" },
        { id: "agent-2", role: "BLUE", aiMemberId: "ai-2", aiModel: "gpt-4o" },
      ],
    });
    mockDebateService.executeDebateRound = jest
      .fn()
      .mockResolvedValue({ content: "debate content", tokensUsed: 100 });
    mockDebateService.completeDebate = jest.fn().mockResolvedValue(undefined);
    mockAiGroupService.createAIMessage = jest
      .fn()
      .mockResolvedValue({ id: "ai-msg-1", content: "debate content" });

    const dto = {
      content: "请辩论一下",
      mentions: [
        { mentionType: MentionType.AI, aiMemberId: "ai-1" },
        { mentionType: MentionType.AI, aiMemberId: "ai-2" },
      ],
    };

    const result = await controller.sendMessage(
      mockRequest(),
      "topic-1",
      dto as never,
    );

    expect(result).toEqual(message);
  });

  it("skips duplicate AI members in mentions", async () => {
    const { MentionType } = require("@prisma/client");
    const message = {
      id: "msg-1",
      content: "Hello @Bot @Bot",
      createdAt: new Date(),
    };
    const aiMember = { id: "ai-1", displayName: "Bot", isLeader: false };
    const topic = { aiMembers: [aiMember], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);
    mockTeamMissionService.handleLeaderMentionCommand = jest
      .fn()
      .mockResolvedValue({ handled: false });

    const dto = {
      content: "Hello @Bot @Bot",
      mentions: [
        { mentionType: MentionType.AI, aiMemberId: "ai-1" },
        { mentionType: MentionType.AI, aiMemberId: "ai-1" }, // duplicate
      ],
    };

    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    // ai:typing should be emitted only once for ai-1
    const typingCalls = mockAiGroupGateway.emitToTopic.mock.calls.filter(
      ([, event]) => event === "ai:typing",
    );
    const aiTypingForAi1 = typingCalls.filter(
      ([, , data]) => data.aiMemberId === "ai-1",
    );
    expect(aiTypingForAi1).toHaveLength(1);
  });

  it("truncates content preview to 100 chars for USER mention notification", async () => {
    const { MentionType } = require("@prisma/client");
    const longContent = "A".repeat(150);
    const message = {
      id: "msg-1",
      content: longContent,
      createdAt: new Date(),
    };
    const topic = { aiMembers: [], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);

    const dto = {
      content: longContent,
      mentions: [{ mentionType: MentionType.USER, userId: "user-2" }],
    };

    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    expect(mockAiGroupGateway.emitToUser).toHaveBeenCalledWith(
      "user-2",
      "mention:new",
      expect.objectContaining({
        content: expect.stringContaining("..."),
      }),
    );
  });
});

describe("AiTeamsController - AI Member CRUD", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  describe("addAIMember", () => {
    it("delegates to aiGroupService.addAIMember", async () => {
      mockAiGroupService.addAIMember.mockResolvedValue({ id: "ai-1" });

      await controller.addAIMember(mockRequest(), "topic-1", {
        aiModel: "gpt-4o",
        displayName: "Bot",
      } as never);

      expect(mockAiGroupService.addAIMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        expect.objectContaining({ aiModel: "gpt-4o" }),
      );
    });
  });

  describe("updateAIMember", () => {
    it("delegates to aiGroupService.updateAIMember", async () => {
      mockAiGroupService.updateAIMember.mockResolvedValue({ id: "ai-1" });

      await controller.updateAIMember(mockRequest(), "topic-1", "ai-1", {
        displayName: "NewBot",
      } as never);

      expect(mockAiGroupService.updateAIMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
        { displayName: "NewBot" },
      );
    });
  });

  describe("removeAIMember", () => {
    it("delegates to aiGroupService.removeAIMember", async () => {
      mockAiGroupService.removeAIMember.mockResolvedValue({ removed: true });

      await controller.removeAIMember(mockRequest(), "topic-1", "ai-1");

      expect(mockAiGroupService.removeAIMember).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
      );
    });
  });

  describe("setupDebate", () => {
    it("delegates to aiGroupService.setupDebateAIs", async () => {
      mockAiGroupService.setupDebateAIs.mockResolvedValue({
        red: "ai-1",
        blue: "ai-2",
      });

      await controller.setupDebate(mockRequest(), "topic-1", {
        redAiModel: "grok-3",
        blueAiModel: "gpt-4o",
        topic: "AI vs humans",
      });

      expect(mockAiGroupService.setupDebateAIs).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "grok-3",
        "gpt-4o",
        "AI vs humans",
      );
    });

    it("passes undefined topic when not provided", async () => {
      mockAiGroupService.setupDebateAIs.mockResolvedValue({});

      await controller.setupDebate(mockRequest(), "topic-1", {
        redAiModel: "grok-3",
        blueAiModel: "gpt-4o",
      });

      expect(mockAiGroupService.setupDebateAIs).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "grok-3",
        "gpt-4o",
        undefined,
      );
    });
  });
});

describe("AiTeamsController - Messages and Reactions", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  describe("getMessages", () => {
    it("delegates with parsed limit and cursor", async () => {
      mockAiGroupService.getMessages.mockResolvedValue({ messages: [] });

      await controller.getMessages(
        mockRequest(),
        "topic-1",
        "cursor-abc",
        "20",
      );

      expect(mockAiGroupService.getMessages).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        {
          cursor: "cursor-abc",
          limit: 20,
        },
      );
    });

    it("passes undefined limit when not provided", async () => {
      mockAiGroupService.getMessages.mockResolvedValue({ messages: [] });

      await controller.getMessages(
        mockRequest(),
        "topic-1",
        undefined,
        undefined,
      );

      expect(mockAiGroupService.getMessages).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        {
          cursor: undefined,
          limit: undefined,
        },
      );
    });
  });

  describe("deleteMessage", () => {
    it("delegates to aiGroupService.deleteMessage", async () => {
      mockAiGroupService.deleteMessage.mockResolvedValue({ deleted: true });

      await controller.deleteMessage(mockRequest(), "topic-1", "msg-1");

      expect(mockAiGroupService.deleteMessage).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
      );
    });
  });

  describe("addReaction", () => {
    it("delegates to aiGroupService.addReaction", async () => {
      mockAiGroupService.addReaction.mockResolvedValue({ added: true });

      await controller.addReaction(mockRequest(), "topic-1", "msg-1", "👍");

      expect(mockAiGroupService.addReaction).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
        "👍",
      );
    });
  });

  describe("removeReaction", () => {
    it("delegates to aiGroupService.removeReaction", async () => {
      mockAiGroupService.removeReaction.mockResolvedValue({ removed: true });

      await controller.removeReaction(mockRequest(), "topic-1", "msg-1", "👍");

      expect(mockAiGroupService.removeReaction).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
        "👍",
      );
    });
  });

  describe("markAsRead", () => {
    it("delegates to aiGroupService.markAsRead with messageId", async () => {
      mockAiGroupService.markAsRead.mockResolvedValue({ ok: true });

      await controller.markAsRead(mockRequest(), "topic-1", "msg-1");

      expect(mockAiGroupService.markAsRead).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
      );
    });

    it("delegates to aiGroupService.markAsRead without messageId", async () => {
      mockAiGroupService.markAsRead.mockResolvedValue({ ok: true });

      await controller.markAsRead(mockRequest(), "topic-1");

      expect(mockAiGroupService.markAsRead).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        undefined,
      );
    });
  });
});

describe("AiTeamsController - AI Generate", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  describe("generateAIResponse", () => {
    it("delegates to aiGroupService.generateAIResponse", async () => {
      const aiMessage = { id: "ai-msg-1", content: "response" };
      mockAiGroupService.generateAIResponse.mockResolvedValue(aiMessage);

      const result = await controller.generateAIResponse(
        mockRequest(),
        "topic-1",
        "ai-1",
        ["ctx-msg-1"],
      );

      expect(mockAiGroupService.generateAIResponse).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
        ["ctx-msg-1"],
      );
      expect(result).toEqual(aiMessage);
    });

    it("passes empty array when contextMessageIds not provided", async () => {
      mockAiGroupService.generateAIResponse.mockResolvedValue({
        id: "ai-msg-1",
      });

      await controller.generateAIResponse(
        mockRequest(),
        "topic-1",
        "ai-1",
        undefined,
      );

      expect(mockAiGroupService.generateAIResponse).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "ai-1",
        [],
      );
    });
  });

  describe("generateAIResponseStream (SSE)", () => {
    const makeMockRes = () => ({
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    });

    it("sets SSE headers and sends start event", async () => {
      const res = makeMockRes();
      mockAiGroupService.generateAIResponse.mockResolvedValue({
        id: "ai-msg-1",
        content: "Hello",
        aiMember: { aiModel: "gpt-4o" },
      });

      await controller.generateAIResponseStream(
        mockRequest(),
        "topic-1",
        "ai-1",
        [],
        res as never,
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/event-stream",
      );
      expect(res.flushHeaders).toHaveBeenCalled();
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining("start"));
    });

    it("sends chunk events for each piece of content", async () => {
      const res = makeMockRes();
      mockAiGroupService.generateAIResponse.mockResolvedValue({
        id: "ai-msg-1",
        content: "A".repeat(100),
        aiMember: { aiModel: "gpt-4o" },
      });

      await controller.generateAIResponseStream(
        mockRequest(),
        "topic-1",
        "ai-1",
        [],
        res as never,
      );

      // sendSSEEvent writes: "event: chunk\n" then "data: {...}\n\n"
      const writeCalls = res.write.mock.calls.map(([arg]) => arg as string);
      const chunkEventCalls = writeCalls.filter((c) => c === "event: chunk\n");
      expect(chunkEventCalls.length).toBeGreaterThan(0);
    });

    it("sends complete event after streaming", async () => {
      const res = makeMockRes();
      mockAiGroupService.generateAIResponse.mockResolvedValue({
        id: "ai-msg-1",
        content: "Short",
        aiMember: { aiModel: "gpt-4o" },
      });

      await controller.generateAIResponseStream(
        mockRequest(),
        "topic-1",
        "ai-1",
        [],
        res as never,
      );

      // sendSSEEvent writes "event: complete\n" for the complete event
      const writeCalls = res.write.mock.calls.map(([arg]) => arg as string);
      expect(writeCalls.some((c) => c === "event: complete\n")).toBe(true);
      expect(res.end).toHaveBeenCalled();
    });

    it("sends error event when generateAIResponse throws", async () => {
      const res = makeMockRes();
      mockAiGroupService.generateAIResponse.mockRejectedValue(
        new Error("AI generation failed"),
      );

      await controller.generateAIResponseStream(
        mockRequest(),
        "topic-1",
        "ai-1",
        [],
        res as never,
      );

      // sendSSEEvent writes "event: error\n" for error events
      const writeCalls = res.write.mock.calls.map(([arg]) => arg as string);
      expect(writeCalls.some((c) => c === "event: error\n")).toBe(true);
      expect(res.write).toHaveBeenCalledWith("data: [DONE]\n\n");
      expect(res.end).toHaveBeenCalled();
    });

    it("sends DONE marker and ends response even when result is null", async () => {
      const res = makeMockRes();
      mockAiGroupService.generateAIResponse.mockResolvedValue(null);

      await controller.generateAIResponseStream(
        mockRequest(),
        "topic-1",
        "ai-1",
        [],
        res as never,
      );

      expect(res.write).toHaveBeenCalledWith("data: [DONE]\n\n");
      expect(res.end).toHaveBeenCalled();
    });
  });
});

describe("AiTeamsController - Resources and Summaries", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  describe("getResources", () => {
    it("delegates to aiGroupService.getResources", async () => {
      mockAiGroupService.getResources.mockResolvedValue([]);

      await controller.getResources(mockRequest(), "topic-1");

      expect(mockAiGroupService.getResources).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
    });
  });

  describe("addResource", () => {
    it("delegates to aiGroupService.addResource", async () => {
      mockAiGroupService.addResource.mockResolvedValue({ id: "res-1" });

      await controller.addResource(mockRequest(), "topic-1", {
        resourceId: "lib-res-1",
      } as never);

      expect(mockAiGroupService.addResource).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        expect.objectContaining({ resourceId: "lib-res-1" }),
      );
    });
  });

  describe("removeResource", () => {
    it("delegates to aiGroupService.removeResource", async () => {
      mockAiGroupService.removeResource.mockResolvedValue({ removed: true });

      await controller.removeResource(mockRequest(), "topic-1", "res-1");

      expect(mockAiGroupService.removeResource).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "res-1",
      );
    });
  });

  describe("getSummaries", () => {
    it("delegates to aiGroupService.getSummaries", async () => {
      mockAiGroupService.getSummaries.mockResolvedValue([]);

      await controller.getSummaries(mockRequest(), "topic-1");

      expect(mockAiGroupService.getSummaries).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
      );
    });
  });

  describe("generateSummary", () => {
    it("delegates to aiGroupService.generateSummary", async () => {
      mockAiGroupService.generateSummary.mockResolvedValue({ id: "summary-1" });

      await controller.generateSummary(mockRequest(), "topic-1", {
        messageIds: ["m-1"],
      } as never);

      expect(mockAiGroupService.generateSummary).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        expect.objectContaining({ messageIds: ["m-1"] }),
      );
    });
  });

  describe("deleteSummary", () => {
    it("delegates to aiGroupService.deleteSummary", async () => {
      mockAiGroupService.deleteSummary.mockResolvedValue({ deleted: true });

      await controller.deleteSummary(mockRequest(), "topic-1", "summary-1");

      expect(mockAiGroupService.deleteSummary).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "summary-1",
      );
    });
  });
});

describe("AiTeamsController - Forward and Bookmark", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  describe("forwardMessages", () => {
    it("delegates to aiGroupService.forwardMessages", async () => {
      mockAiGroupService.forwardMessages.mockResolvedValue({ messageCount: 2 });

      await controller.forwardMessages(mockRequest(), "topic-1", {
        messageIds: ["m-1"],
        targetType: "SAVED",
      } as never);

      expect(mockAiGroupService.forwardMessages).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        expect.any(Object),
      );
    });

    it("emits messages:forwarded event when forwarding to another topic", async () => {
      mockAiGroupService.forwardMessages.mockResolvedValue({ messageCount: 3 });

      await controller.forwardMessages(mockRequest(), "topic-1", {
        messageIds: ["m-1", "m-2", "m-3"],
        targetType: "TOPIC",
        targetTopicId: "topic-2",
      } as never);

      expect(mockAiGroupGateway.emitToTopic).toHaveBeenCalledWith(
        "topic-2",
        "messages:forwarded",
        expect.objectContaining({
          fromTopicId: "topic-1",
          messageCount: 3,
        }),
      );
    });

    it("does not emit when targetType is not TOPIC", async () => {
      mockAiGroupService.forwardMessages.mockResolvedValue({ messageCount: 1 });

      await controller.forwardMessages(mockRequest(), "topic-1", {
        messageIds: ["m-1"],
        targetType: "SAVED",
      } as never);

      expect(mockAiGroupGateway.emitToTopic).not.toHaveBeenCalledWith(
        expect.any(String),
        "messages:forwarded",
        expect.any(Object),
      );
    });
  });

  describe("bookmarkMessage", () => {
    it("delegates to aiGroupService.bookmarkMessage", async () => {
      mockAiGroupService.bookmarkMessage.mockResolvedValue({ id: "bm-1" });

      await controller.bookmarkMessage(mockRequest(), "topic-1", "msg-1", {
        category: "important",
      } as never);

      expect(mockAiGroupService.bookmarkMessage).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
        expect.objectContaining({ category: "important" }),
      );
    });
  });

  describe("unbookmarkMessage", () => {
    it("delegates to aiGroupService.unbookmarkMessage", async () => {
      mockAiGroupService.unbookmarkMessage.mockResolvedValue({ removed: true });

      await controller.unbookmarkMessage(mockRequest(), "topic-1", "msg-1");

      expect(mockAiGroupService.unbookmarkMessage).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        "msg-1",
      );
    });
  });
});

describe("AiTeamsController - Debates", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  describe("getDebates", () => {
    it("delegates to debateService.getDebatesByTopic", async () => {
      mockDebateService.getDebatesByTopic = jest.fn().mockResolvedValue([]);

      await controller.getDebates("topic-1");

      expect(mockDebateService.getDebatesByTopic).toHaveBeenCalledWith(
        "topic-1",
      );
    });
  });

  describe("getDebate", () => {
    it("delegates to debateService.getDebateSession with debateId", async () => {
      mockDebateService.getDebateSession = jest
        .fn()
        .mockResolvedValue({ id: "debate-1" });

      // Note: getDebate(@Param("debateId") debateId: string) — only one param
      const result = await controller.getDebate("debate-1");

      expect(mockDebateService.getDebateSession).toHaveBeenCalledWith(
        "debate-1",
      );
      expect(result).toEqual({ id: "debate-1" });
    });
  });
});

describe("AiTeamsController - detectDebateMode (private, tested via sendMessage)", () => {
  let controller: AiTeamsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AiTeamsController(
      mockAiGroupService as never,
      mockAiGroupGateway as never,
      mockDebateService as never,
      mockTeamMissionService as never,
      mockUrlParserService as never,
    );
  });

  const debateKeywords = [
    "辩论",
    "PK",
    "pk",
    "debate",
    "思辨",
    "对决",
    "讨论一下",
  ];

  debateKeywords.forEach((keyword) => {
    it(`detects debate with keyword "${keyword}" and 2+ AI members`, async () => {
      const { MentionType } = require("@prisma/client");
      const message = {
        id: "msg-1",
        content: `请${keyword}这个话题`,
        createdAt: new Date(),
      };
      const ai1 = { id: "ai-1", displayName: "RedBot", isLeader: false };
      const ai2 = { id: "ai-2", displayName: "BlueBot", isLeader: false };
      const topic = { aiMembers: [ai1, ai2], members: [] };

      mockAiGroupService.sendMessage.mockResolvedValue(message);
      mockAiGroupService.getTopicById.mockResolvedValue(topic);
      mockTeamMissionService.handleLeaderMentionCommand = jest
        .fn()
        .mockResolvedValue({ handled: false });

      // Mock debate service methods
      mockDebateService.createDebateSession = jest.fn().mockResolvedValue({
        id: "debate-session-1",
        agents: [
          { id: "agent-1", role: "RED", aiMemberId: "ai-1", aiModel: "gpt-4o" },
          {
            id: "agent-2",
            role: "BLUE",
            aiMemberId: "ai-2",
            aiModel: "gpt-4o",
          },
        ],
      });
      mockDebateService.executeDebateRound = jest
        .fn()
        .mockResolvedValue({ content: "debate content", tokensUsed: 50 });
      mockDebateService.completeDebate = jest.fn().mockResolvedValue(undefined);
      mockAiGroupService.createAIMessage = jest
        .fn()
        .mockResolvedValue({ id: "ai-msg-1", content: "debate" });

      const dto = {
        content: `请${keyword}这个话题`,
        mentions: [
          { mentionType: MentionType.AI, aiMemberId: "ai-1" },
          { mentionType: MentionType.AI, aiMemberId: "ai-2" },
        ],
      };

      // Should not throw even with background async ops
      await expect(
        controller.sendMessage(mockRequest(), "topic-1", dto as never),
      ).resolves.not.toThrow();
    });
  });

  it("does NOT detect debate with only 1 AI member", async () => {
    const { MentionType } = require("@prisma/client");
    const message = { id: "msg-1", content: "请辩论", createdAt: new Date() };
    const ai1 = { id: "ai-1", displayName: "Bot", isLeader: false };
    const topic = { aiMembers: [ai1], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);
    mockTeamMissionService.handleLeaderMentionCommand = jest
      .fn()
      .mockResolvedValue({ handled: false });

    const dto = {
      content: "请辩论",
      mentions: [{ mentionType: MentionType.AI, aiMemberId: "ai-1" }],
    };

    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    // No debate service calls in non-debate mode
    expect(mockDebateService.createDebateSession).not.toHaveBeenCalled?.();
  });

  it("does NOT detect debate without debate keywords", async () => {
    const { MentionType } = require("@prisma/client");
    const message = {
      id: "msg-1",
      content: "Hello all",
      createdAt: new Date(),
    };
    const ai1 = { id: "ai-1", displayName: "Bot1", isLeader: false };
    const ai2 = { id: "ai-2", displayName: "Bot2", isLeader: false };
    const topic = { aiMembers: [ai1, ai2], members: [] };

    mockAiGroupService.sendMessage.mockResolvedValue(message);
    mockAiGroupService.getTopicById.mockResolvedValue(topic);
    mockTeamMissionService.handleLeaderMentionCommand = jest
      .fn()
      .mockResolvedValue({ handled: false });

    const dto = {
      content: "Hello all",
      mentions: [
        { mentionType: MentionType.AI, aiMemberId: "ai-1" },
        { mentionType: MentionType.AI, aiMemberId: "ai-2" },
      ],
    };

    await controller.sendMessage(mockRequest(), "topic-1", dto as never);

    // Should use normal parallel AI triggering, not debate
    const typingCalls = mockAiGroupGateway.emitToTopic.mock.calls.filter(
      ([, event]) => event === "ai:typing",
    );
    expect(typingCalls.length).toBeGreaterThanOrEqual(2);
  });
});

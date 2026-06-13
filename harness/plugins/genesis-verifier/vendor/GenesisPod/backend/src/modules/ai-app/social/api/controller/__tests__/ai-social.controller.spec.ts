import { HttpException } from "@nestjs/common";
import { AiSocialController } from "../ai-social.controller";
import type { AiSocialService } from "../../../mission/services/ai-social.service";
import type { SocialConnectionsService } from "../../../mission/services/social-connections.service";
import type { XhsMcpFacadeService } from "../../../mission/services/xhs-mcp-facade.service";
import type { SocialImportSourcesService } from "../../../mission/services/social-import-sources.service";
import type { SocialLeaderService } from "../../../mission/services/social-leader.service";
import type { ReviewService } from "../../../mission/services/review.service";
import type { ContentVersionService } from "../../../mission/services/content-version.service";
import type { SocialPipelineDispatcher } from "../../../mission/pipeline/social-pipeline-dispatcher.service";
import { SocialPlatformType } from "../../../mission/types";

// Mock BillingContext to passthrough
jest.mock("../../../../../platform/credits/billing-context.store", () => ({
  BillingContext: {
    run: jest.fn().mockImplementation((_context, fn) => fn()),
  },
}));

function createMockAiSocialService() {
  return {
    getContents: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    createContent: jest.fn().mockResolvedValue({ id: "content-1" }),
    getContent: jest
      .fn()
      .mockResolvedValue({ id: "content-1", userId: "user-1" }),
    updateContent: jest.fn().mockResolvedValue({ id: "content-1" }),
    deleteContent: jest.fn().mockResolvedValue({ deleted: true }),
    batchDeleteContents: jest.fn().mockResolvedValue({ deleted: 2 }),
    batchPublishContents: jest.fn().mockResolvedValue({ published: 2 }),
    checkContent: jest.fn().mockResolvedValue({ passed: true }),
    publishContent: jest.fn().mockResolvedValue({ published: true }),
    scheduleContent: jest.fn().mockResolvedValue({ scheduled: true }),
    cancelPublish: jest.fn().mockResolvedValue({ cancelled: true }),
    getPublishLogs: jest.fn().mockResolvedValue([]),
    getSeriesContents: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<AiSocialService>;
}

function createMockConnectionsService() {
  return {
    getConnections: jest.fn().mockResolvedValue([]),
    initConnection: jest.fn().mockResolvedValue({ connectionId: "c1" }),
    verifyConnection: jest.fn().mockResolvedValue({ verified: true }),
    deleteConnection: jest.fn().mockResolvedValue({ deleted: true }),
    testConnection: jest.fn().mockResolvedValue({ ok: true }),
    refreshConnection: jest.fn().mockResolvedValue({ refreshed: true }),
  } as unknown as jest.Mocked<SocialConnectionsService>;
}

function createMockXhsMcpFacade() {
  return {
    getLoginStatus: jest.fn().mockResolvedValue({ loggedIn: true }),
    listFeeds: jest.fn().mockResolvedValue({ feeds: [] }),
    searchFeeds: jest.fn().mockResolvedValue({ results: [] }),
    getFeedDetail: jest.fn().mockResolvedValue({ feed: {} }),
    postComment: jest.fn().mockResolvedValue({ success: true }),
    getUserProfile: jest.fn().mockResolvedValue({ user: {} }),
  } as unknown as jest.Mocked<XhsMcpFacadeService>;
}

function createMockImportSources() {
  return {
    getExploreSources: jest.fn().mockResolvedValue({ items: [] }),
    getResearchSources: jest.fn().mockResolvedValue([]),
    getOfficeSources: jest.fn().mockResolvedValue([]),
    getWritingSources: jest.fn().mockResolvedValue([]),
    getTopicInsightsSources: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<SocialImportSourcesService>;
}

function createMockMissionDispatcher() {
  return {
    tryReserveInFlight: jest.fn().mockReturnValue({
      missionId: "m-1",
      reused: false,
    }),
    runMission: jest.fn().mockResolvedValue({
      missionId: "m-1",
      status: "completed",
    }),
  } as unknown as jest.Mocked<SocialPipelineDispatcher>;
}

function createMockSocialLeaderService() {
  return {
    processUrl: jest.fn().mockResolvedValue({ content: {}, message: "OK" }),
    processSource: jest.fn().mockResolvedValue({ content: {}, message: "OK" }),
    regenerateContent: jest
      .fn()
      .mockResolvedValue({ content: {}, message: "OK" }),
  } as unknown as jest.Mocked<SocialLeaderService>;
}

function createMockReviewService() {
  return {
    getPendingReviewContents: jest.fn().mockResolvedValue([]),
    approveContent: jest.fn().mockResolvedValue({ approved: true }),
    rejectContent: jest.fn().mockResolvedValue({ rejected: true }),
    resubmitForReview: jest.fn().mockResolvedValue({ resubmitted: true }),
  } as unknown as jest.Mocked<ReviewService>;
}

function createMockContentVersionService() {
  return {
    getVersions: jest.fn().mockResolvedValue([]),
    generateVersion: jest.fn().mockResolvedValue({ id: "v1" }),
    generateAllVersions: jest
      .fn()
      .mockResolvedValue([{ id: "v1" }, { id: "v2" }]),
    updateVersion: jest.fn().mockResolvedValue({ id: "v1" }),
    deleteVersion: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ContentVersionService>;
}

function createMockRequest(userId = "user-abc") {
  return { user: { id: userId } };
}

describe("AiSocialController", () => {
  let controller: AiSocialController;
  let mockAiSocialService: jest.Mocked<AiSocialService>;
  let mockConnections: jest.Mocked<SocialConnectionsService>;
  let mockXhsMcp: jest.Mocked<XhsMcpFacadeService>;
  let mockImportSources: jest.Mocked<SocialImportSourcesService>;
  let mockSocialLeaderService: jest.Mocked<SocialLeaderService>;
  let mockReviewService: jest.Mocked<ReviewService>;
  let mockContentVersionService: jest.Mocked<ContentVersionService>;
  let mockMissionDispatcher: jest.Mocked<SocialPipelineDispatcher>;
  let mockReq: ReturnType<typeof createMockRequest>;

  beforeEach(() => {
    mockAiSocialService = createMockAiSocialService();
    mockConnections = createMockConnectionsService();
    mockXhsMcp = createMockXhsMcpFacade();
    mockImportSources = createMockImportSources();
    mockSocialLeaderService = createMockSocialLeaderService();
    mockReviewService = createMockReviewService();
    mockContentVersionService = createMockContentVersionService();
    mockMissionDispatcher = createMockMissionDispatcher();

    controller = new AiSocialController(
      mockAiSocialService as unknown as AiSocialService,
      mockConnections as unknown as SocialConnectionsService,
      mockXhsMcp as unknown as XhsMcpFacadeService,
      mockImportSources as unknown as SocialImportSourcesService,
      mockSocialLeaderService as unknown as SocialLeaderService,
      mockReviewService as unknown as ReviewService,
      mockContentVersionService as unknown as ContentVersionService,
      mockMissionDispatcher as unknown as SocialPipelineDispatcher,
    );

    mockReq = createMockRequest();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("getConnections", () => {
    it("should return connections for user", async () => {
      const result = await controller.getConnections(mockReq);
      expect(mockConnections.getConnections).toHaveBeenCalledWith("user-abc");
      expect(result).toEqual([]);
    });
  });

  describe("initConnection", () => {
    it("should init a connection", async () => {
      const result = await controller.initConnection(mockReq, "WECHAT_MP");
      expect(mockConnections.initConnection).toHaveBeenCalledWith(
        "user-abc",
        "WECHAT_MP",
      );
      expect(result).toEqual({ connectionId: "c1" });
    });
  });

  describe("verifyConnection", () => {
    it("should verify a connection", async () => {
      const result = await controller.verifyConnection(mockReq, "WECHAT_MP");
      expect(mockConnections.verifyConnection).toHaveBeenCalledWith(
        "user-abc",
        "WECHAT_MP",
      );
      expect(result).toEqual({ verified: true });
    });
  });

  describe("deleteConnection", () => {
    it("should delete a connection", async () => {
      const _result = await controller.deleteConnection(mockReq, "WECHAT_MP");
      expect(mockConnections.deleteConnection).toHaveBeenCalledWith(
        "user-abc",
        "WECHAT_MP",
      );
    });
  });

  describe("getContents", () => {
    it("should return contents with defaults", async () => {
      const _result = await controller.getContents(mockReq);
      expect(mockAiSocialService.getContents).toHaveBeenCalledWith("user-abc", {
        status: undefined,
        contentType: undefined,
        page: 1,
        limit: 20,
      });
    });

    it("should pass query params when provided", async () => {
      await controller.getContents(mockReq, "DRAFT", "WECHAT_ARTICLE", 2, 10);
      expect(mockAiSocialService.getContents).toHaveBeenCalledWith("user-abc", {
        status: "DRAFT",
        contentType: "WECHAT_ARTICLE",
        page: 2,
        limit: 10,
      });
    });
  });

  describe("getPendingReviewContents", () => {
    it("should return pending review contents", async () => {
      const _result = await controller.getPendingReviewContents(mockReq);
      expect(mockReviewService.getPendingReviewContents).toHaveBeenCalledWith(
        "user-abc",
      );
    });
  });

  describe("getContentVersions", () => {
    it("should return versions after ownership check", async () => {
      const result = await controller.getContentVersions(mockReq, "content-1");
      expect(mockAiSocialService.getContent).toHaveBeenCalledWith(
        "user-abc",
        "content-1",
      );
      expect(mockContentVersionService.getVersions).toHaveBeenCalledWith(
        "content-1",
      );
      expect(result).toEqual({ versions: [] });
    });
  });

  describe("generateVersion", () => {
    it("should generate a version successfully", async () => {
      const dto = { platformType: SocialPlatformType.XIAOHONGSHU };
      const result = await controller.generateVersion(
        mockReq,
        "content-1",
        dto,
      );
      expect(mockContentVersionService.generateVersion).toHaveBeenCalledWith(
        "content-1",
        SocialPlatformType.XIAOHONGSHU,
        "user-abc",
      );
      expect(result).toEqual({ version: { id: "v1" } });
    });

    it("should throw HttpException when version generation fails", async () => {
      mockAiSocialService.getContent.mockResolvedValue({
        id: "c1",
        userId: "user-abc",
      } as never);
      mockContentVersionService.generateVersion.mockRejectedValue(
        new Error("Generation failed"),
      );

      const dto = { platformType: SocialPlatformType.XIAOHONGSHU };
      await expect(
        controller.generateVersion(mockReq, "content-1", dto),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("generateAllVersions", () => {
    it("should generate all versions", async () => {
      const result = await controller.generateAllVersions(mockReq, "content-1");
      expect(
        mockContentVersionService.generateAllVersions,
      ).toHaveBeenCalledWith("content-1", "user-abc");
      expect(result).toEqual({ versions: [{ id: "v1" }, { id: "v2" }] });
    });

    it("should throw HttpException on failure", async () => {
      mockContentVersionService.generateAllVersions.mockRejectedValue(
        new Error("All version fail"),
      );

      await expect(
        controller.generateAllVersions(mockReq, "content-1"),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("updateVersion", () => {
    it("should update version for platform", async () => {
      const dto = { content: "Updated content" };
      const result = await controller.updateVersion(
        mockReq,
        "content-1",
        "xiaohongshu",
        dto as never,
      );
      expect(mockContentVersionService.updateVersion).toHaveBeenCalledWith(
        "content-1",
        "XIAOHONGSHU",
        dto,
      );
      expect(result).toEqual({ version: { id: "v1" } });
    });
  });

  describe("deleteVersion", () => {
    it("should delete version for platform", async () => {
      const result = await controller.deleteVersion(
        mockReq,
        "content-1",
        "xiaohongshu",
      );
      expect(mockContentVersionService.deleteVersion).toHaveBeenCalledWith(
        "content-1",
        "XIAOHONGSHU",
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("batchDeleteContents", () => {
    it("should batch delete contents", async () => {
      const _result = await controller.batchDeleteContents(mockReq, {
        ids: ["id1", "id2"],
      });
      expect(mockAiSocialService.batchDeleteContents).toHaveBeenCalledWith(
        "user-abc",
        ["id1", "id2"],
      );
    });
  });

  describe("batchPublishContents", () => {
    it("should batch publish contents", async () => {
      const _result = await controller.batchPublishContents(mockReq, {
        ids: ["id1", "id2"],
        connectionId: "conn-1",
      });
      expect(mockAiSocialService.batchPublishContents).toHaveBeenCalledWith(
        "user-abc",
        ["id1", "id2"],
        "conn-1",
      );
    });
  });

  describe("processUrl", () => {
    it("should process URL and return result", async () => {
      const dto = {
        url: "https://example.com",
        targetType: "WECHAT_ARTICLE" as never,
      };
      const result = await controller.processUrl(mockReq, dto);
      expect(mockSocialLeaderService.processUrl).toHaveBeenCalledWith(
        "user-abc",
        dto,
      );
      expect(result).toEqual({ content: {}, message: "OK" });
    });

    it("should throw HttpException when processUrl fails", async () => {
      mockSocialLeaderService.processUrl.mockRejectedValue(
        new Error("URL fetch failed"),
      );

      await expect(
        controller.processUrl(mockReq, {
          url: "bad-url",
          targetType: "WECHAT_ARTICLE" as never,
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("processSource", () => {
    it("should process source and return result", async () => {
      const dto = {
        sourceType: "RESEARCH" as never,
        sourceId: "research-id",
        targetType: "WECHAT_ARTICLE" as never,
      };
      const _result = await controller.processSource(mockReq, dto);
      expect(mockSocialLeaderService.processSource).toHaveBeenCalledWith(
        "user-abc",
        dto,
      );
    });

    it("should throw HttpException when processSource fails", async () => {
      mockSocialLeaderService.processSource.mockRejectedValue(
        new Error("Source not found"),
      );

      await expect(
        controller.processSource(mockReq, {
          sourceType: "RESEARCH" as never,
          sourceId: "bad-id",
          targetType: "WECHAT_ARTICLE" as never,
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("regenerateContent", () => {
    it("should regenerate content", async () => {
      const _result = await controller.regenerateContent(mockReq, "content-1");
      expect(mockSocialLeaderService.regenerateContent).toHaveBeenCalledWith(
        "user-abc",
        "content-1",
      );
    });

    it("should throw HttpException on error", async () => {
      mockSocialLeaderService.regenerateContent.mockRejectedValue(
        new Error("Regenerate error"),
      );

      await expect(
        controller.regenerateContent(mockReq, "content-1"),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("XHS endpoints", () => {
    it("should get login status", async () => {
      const _result = await controller.xhsLoginStatus(mockReq);
      expect(mockXhsMcp.getLoginStatus).toHaveBeenCalled();
    });

    it("should list feeds", async () => {
      const _result = await controller.xhsListFeeds(mockReq);
      expect(mockXhsMcp.listFeeds).toHaveBeenCalled();
    });

    it("should search feeds with keyword", async () => {
      const _result = await controller.xhsSearchFeeds(mockReq, "test-keyword");
      expect(mockXhsMcp.searchFeeds).toHaveBeenCalledWith("test-keyword");
    });

    it("should throw when xhsSearchFeeds has no keyword", async () => {
      await expect(controller.xhsSearchFeeds(mockReq, "")).rejects.toThrow(
        HttpException,
      );
    });

    it("should get feed detail with token", async () => {
      const _result = await controller.xhsGetFeedDetail(
        mockReq,
        "feed-1",
        "xsec-token",
      );
      expect(mockXhsMcp.getFeedDetail).toHaveBeenCalledWith(
        "feed-1",
        "xsec-token",
      );
    });

    it("should throw when xhsGetFeedDetail missing xsecToken", async () => {
      await expect(
        controller.xhsGetFeedDetail(mockReq, "feed-1", ""),
      ).rejects.toThrow(HttpException);
    });

    it("should post comment", async () => {
      await controller.xhsPostComment(mockReq, "feed-1", {
        xsecToken: "tok",
        content: "Great post!",
      });
      expect(mockXhsMcp.postComment).toHaveBeenCalledWith(
        "feed-1",
        "tok",
        "Great post!",
      );
    });

    it("should throw when xhsPostComment missing xsecToken or content", async () => {
      await expect(
        controller.xhsPostComment(mockReq, "feed-1", {
          xsecToken: "",
          content: "Hi",
        }),
      ).rejects.toThrow(HttpException);

      await expect(
        controller.xhsPostComment(mockReq, "feed-1", {
          xsecToken: "tok",
          content: "",
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  describe("Review endpoints", () => {
    it("should approve content", async () => {
      await controller.approveContent(mockReq, "content-1", {
        note: "Looks good",
      });
      expect(mockReviewService.approveContent).toHaveBeenCalledWith(
        "user-abc",
        "content-1",
        "Looks good",
      );
    });

    it("should reject content", async () => {
      await controller.rejectContent(mockReq, "content-1", {
        note: "Contains errors",
      });
      expect(mockReviewService.rejectContent).toHaveBeenCalledWith(
        "user-abc",
        "content-1",
        "Contains errors",
      );
    });

    it("should resubmit for review", async () => {
      await controller.resubmitForReview(mockReq, "content-1");
      expect(mockReviewService.resubmitForReview).toHaveBeenCalledWith(
        "user-abc",
        "content-1",
      );
    });
  });

  describe("Source listing endpoints", () => {
    it("should get explore sources", async () => {
      await controller.getExploreSources(mockReq, "RESEARCH", "1", "20");
      expect(mockImportSources.getExploreSources).toHaveBeenCalledWith(
        "user-abc",
        { type: "RESEARCH", page: 1, limit: 20 },
      );
    });

    it("should get research sources", async () => {
      await controller.getResearchSources(mockReq);
      expect(mockImportSources.getResearchSources).toHaveBeenCalledWith(
        "user-abc",
      );
    });

    it("should get office sources", async () => {
      await controller.getOfficeSources(mockReq);
      expect(mockImportSources.getOfficeSources).toHaveBeenCalledWith(
        "user-abc",
      );
    });

    it("should get writing sources", async () => {
      await controller.getWritingSources(mockReq);
      expect(mockImportSources.getWritingSources).toHaveBeenCalledWith(
        "user-abc",
      );
    });
  });
});

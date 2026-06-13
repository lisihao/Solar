import { UnauthorizedException } from "@nestjs/common";
import { TopicController } from "../topic.controller";
import type { TopicInsightsService } from "../../topic-insights.service";
import { of } from "rxjs";

function createMockTopicService() {
  return {
    getSharedTopic: jest
      .fn()
      .mockResolvedValue({ id: "topic-1", isPublic: true }),
    getSharedTopicLatestReport: jest.fn().mockResolvedValue({ id: "report-1" }),
    createTopic: jest.fn().mockResolvedValue({ id: "topic-1" }),
    listTopics: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getTopic: jest.fn().mockResolvedValue({ id: "topic-1" }),
    updateTopic: jest.fn().mockResolvedValue({ id: "topic-1" }),
    deleteTopic: jest.fn().mockResolvedValue({ deleted: true }),
    triggerRefresh: jest.fn().mockResolvedValue({ jobId: "job-1" }),
    getResearchStrategy: jest
      .fn()
      .mockResolvedValue({ strategy: "incremental" }),
    quickCheckResearchStatus: jest
      .fn()
      .mockResolvedValue({ needsRefresh: false }),
    smartStartResearch: jest.fn().mockResolvedValue({ taskId: "task-1" }),
    getRefreshStatus: jest.fn().mockResolvedValue({ status: "idle" }),
    streamRefreshProgress: jest
      .fn()
      .mockReturnValue(of({ data: { progress: 50 }, type: "message" })),
    cancelRefresh: jest.fn().mockResolvedValue({ cancelled: true }),
    listDimensions: jest.fn().mockResolvedValue([]),
    addDimension: jest.fn().mockResolvedValue({ id: "dim-1" }),
    updateDimension: jest.fn().mockResolvedValue({ id: "dim-1" }),
    deleteDimension: jest.fn().mockResolvedValue({ deleted: true }),
    refreshDimension: jest.fn().mockResolvedValue({ jobId: "dim-job-1" }),
    reorderDimensions: jest.fn().mockResolvedValue({ reordered: true }),
    getTemplates: jest.fn().mockResolvedValue([]),
    createFromTemplate: jest.fn().mockResolvedValue({ id: "topic-from-tpl" }),
    getSchedule: jest.fn().mockResolvedValue({ schedule: "daily" }),
    updateSchedule: jest.fn().mockResolvedValue({ updated: true }),
    getLogs: jest.fn().mockResolvedValue([]),
    getStats: jest.fn().mockResolvedValue({ totalReports: 5 }),
    recalculateTopicStats: jest.fn().mockResolvedValue({ totalReports: 5 }),
    getResearchHistory: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<TopicInsightsService>;
}

function createMockRequest(userId?: string) {
  return { user: { id: userId } };
}

describe("TopicController", () => {
  let controller: TopicController;
  let mockTopicService: jest.Mocked<TopicInsightsService>;
  let mockReq: ReturnType<typeof createMockRequest>;

  beforeEach(() => {
    mockTopicService = createMockTopicService();
    controller = new TopicController(
      mockTopicService as unknown as TopicInsightsService,
    );
    mockReq = createMockRequest("user-xyz");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Public endpoints", () => {
    it("should get shared topic without auth", async () => {
      const result = await controller.getSharedTopic("topic-1");
      expect(mockTopicService.getSharedTopic).toHaveBeenCalledWith("topic-1");
      expect(result).toEqual({ id: "topic-1", isPublic: true });
    });

    it("should get shared topic latest report without auth", async () => {
      const _result = await controller.getSharedTopicLatestReport("topic-1");
      expect(mockTopicService.getSharedTopicLatestReport).toHaveBeenCalledWith(
        "topic-1",
      );
    });
  });

  describe("createTopic", () => {
    it("should create a topic", async () => {
      const dto = { name: "AI Topic", type: "RESEARCH" } as never;
      const result = await controller.createTopic(mockReq as never, dto);
      expect(mockTopicService.createTopic).toHaveBeenCalledWith(
        "user-xyz",
        dto,
      );
      expect(result).toEqual({ id: "topic-1" });
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.createTopic(reqNoUser as never, {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("listTopics", () => {
    it("should list topics for user", async () => {
      const query = { type: "RESEARCH" } as never;
      await controller.listTopics(mockReq as never, query);
      expect(mockTopicService.listTopics).toHaveBeenCalledWith(
        "user-xyz",
        query,
      );
    });

    it("should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.listTopics(reqNoUser as never, {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("getTopic", () => {
    it("should get topic by id", async () => {
      const _result = await controller.getTopic(mockReq as never, "topic-1");
      expect(mockTopicService.getTopic).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });
  });

  describe("updateTopic", () => {
    it("should update topic", async () => {
      const dto = { name: "Updated Topic" } as never;
      await controller.updateTopic(mockReq as never, "topic-1", dto);
      expect(mockTopicService.updateTopic).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        dto,
      );
    });
  });

  describe("deleteTopic", () => {
    it("should delete topic", async () => {
      await controller.deleteTopic(mockReq as never, "topic-1");
      expect(mockTopicService.deleteTopic).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });
  });

  describe("Refresh operations", () => {
    it("should trigger refresh", async () => {
      const dto = { mode: "incremental" } as never;
      await controller.triggerRefresh(mockReq as never, "topic-1", dto);
      expect(mockTopicService.triggerRefresh).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        dto,
      );
    });

    it("should get research strategy", async () => {
      await controller.getResearchStrategy(mockReq as never, "topic-1");
      expect(mockTopicService.getResearchStrategy).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });

    it("should quick check research status", async () => {
      await controller.quickCheckResearchStatus(mockReq as never, "topic-1");
      expect(mockTopicService.quickCheckResearchStatus).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });

    it("should smart start research", async () => {
      await controller.smartStartResearch(mockReq as never, "topic-1");
      expect(mockTopicService.smartStartResearch).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });

    it("should get refresh status", async () => {
      await controller.getRefreshStatus(mockReq as never, "topic-1");
      expect(mockTopicService.getRefreshStatus).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });

    it("should stream refresh progress via SSE", () => {
      const observable = controller.streamRefreshProgress(
        mockReq as never,
        "topic-1",
      );
      expect(mockTopicService.streamRefreshProgress).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
      expect(observable).toBeDefined();
    });

    it("should throw UnauthorizedException when streaming without user", () => {
      const reqNoUser = createMockRequest(undefined);
      expect(() =>
        controller.streamRefreshProgress(reqNoUser as never, "topic-1"),
      ).toThrow(UnauthorizedException);
    });

    it("should cancel refresh", async () => {
      const dto = { reason: "User cancelled" } as never;
      await controller.cancelRefresh(mockReq as never, "topic-1", dto);
      expect(mockTopicService.cancelRefresh).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        dto,
      );
    });
  });

  describe("Dimension operations", () => {
    it("should list dimensions", async () => {
      await controller.listDimensions(mockReq as never, "topic-1");
      expect(mockTopicService.listDimensions).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });

    it("should add dimension", async () => {
      const dto = { name: "Market Analysis" } as never;
      await controller.addDimension(mockReq as never, "topic-1", dto);
      expect(mockTopicService.addDimension).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        dto,
      );
    });

    it("should update dimension", async () => {
      const dto = { name: "Updated Dimension" } as never;
      await controller.updateDimension(
        mockReq as never,
        "topic-1",
        "dim-1",
        dto,
      );
      expect(mockTopicService.updateDimension).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        "dim-1",
        dto,
      );
    });

    it("should delete dimension", async () => {
      await controller.deleteDimension(mockReq as never, "topic-1", "dim-1");
      expect(mockTopicService.deleteDimension).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        "dim-1",
      );
    });

    it("should refresh dimension", async () => {
      const dto = { mode: "full" } as never;
      await controller.refreshDimension(
        mockReq as never,
        "topic-1",
        "dim-1",
        dto,
      );
      expect(mockTopicService.refreshDimension).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        "dim-1",
        dto,
      );
    });

    it("should reorder dimensions", async () => {
      const dto = { order: ["dim-2", "dim-1"] } as never;
      await controller.reorderDimensions(mockReq as never, "topic-1", dto);
      expect(mockTopicService.reorderDimensions).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        dto,
      );
    });
  });

  describe("Templates", () => {
    it("should get templates", async () => {
      const query = { type: "MARKET" } as never;
      await controller.getTemplates(mockReq as never, query);
      expect(mockTopicService.getTemplates).toHaveBeenCalledWith(query);
    });

    it("should create from template", async () => {
      const dto = { templateId: "tpl-1", name: "New Topic" } as never;
      await controller.createFromTemplate(mockReq as never, dto);
      expect(mockTopicService.createFromTemplate).toHaveBeenCalledWith(
        "user-xyz",
        dto,
      );
    });
  });

  describe("Schedule", () => {
    it("should get schedule", async () => {
      await controller.getSchedule(mockReq as never, "topic-1");
      expect(mockTopicService.getSchedule).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });

    it("should update schedule", async () => {
      const dto = { frequency: "WEEKLY" } as never;
      await controller.updateSchedule(mockReq as never, "topic-1", dto);
      expect(mockTopicService.updateSchedule).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        dto,
      );
    });
  });

  describe("Unauthorized branches", () => {
    it("getTopic should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getTopic(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("updateTopic should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.updateTopic(reqNoUser as never, "topic-1", {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("deleteTopic should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.deleteTopic(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("triggerRefresh should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.triggerRefresh(reqNoUser as never, "topic-1", {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("getResearchStrategy should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getResearchStrategy(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("quickCheckResearchStatus should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.quickCheckResearchStatus(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("smartStartResearch should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.smartStartResearch(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("getRefreshStatus should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getRefreshStatus(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("cancelRefresh should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.cancelRefresh(reqNoUser as never, "topic-1", {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("listDimensions should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.listDimensions(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("addDimension should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.addDimension(reqNoUser as never, "topic-1", {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("updateDimension should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.updateDimension(
          reqNoUser as never,
          "topic-1",
          "dim-1",
          {} as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("deleteDimension should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.deleteDimension(reqNoUser as never, "topic-1", "dim-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("refreshDimension should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.refreshDimension(
          reqNoUser as never,
          "topic-1",
          "dim-1",
          {} as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("reorderDimensions should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.reorderDimensions(
          reqNoUser as never,
          "topic-1",
          {} as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("getTemplates should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getTemplates(reqNoUser as never, {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("createFromTemplate should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.createFromTemplate(reqNoUser as never, {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("getSchedule should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getSchedule(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("updateSchedule should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.updateSchedule(reqNoUser as never, "topic-1", {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("getLogs should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getLogs(reqNoUser as never, "topic-1", {} as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("getStats should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getStats(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("recalculateTopicStats should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.recalculateTopicStats(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("getResearchHistory should throw UnauthorizedException when user is missing", async () => {
      const reqNoUser = createMockRequest(undefined);
      await expect(
        controller.getResearchHistory(reqNoUser as never, "topic-1"),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("Logs and Stats", () => {
    it("should get logs", async () => {
      const query = { limit: 10 } as never;
      await controller.getLogs(mockReq as never, "topic-1", query);
      expect(mockTopicService.getLogs).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        query,
      );
    });

    it("should get stats", async () => {
      await controller.getStats(mockReq as never, "topic-1");
      expect(mockTopicService.getStats).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });

    it("should recalculate topic stats", async () => {
      await controller.recalculateTopicStats(mockReq as never, "topic-1");
      expect(mockTopicService.recalculateTopicStats).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
      );
    });

    it("should get research history", async () => {
      await controller.getResearchHistory(mockReq as never, "topic-1", "5");
      expect(mockTopicService.getResearchHistory).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        5,
      );
    });

    it("should get research history without limit", async () => {
      await controller.getResearchHistory(mockReq as never, "topic-1");
      expect(mockTopicService.getResearchHistory).toHaveBeenCalledWith(
        "user-xyz",
        "topic-1",
        undefined,
      );
    });
  });
});

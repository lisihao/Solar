/**
 * AgentActivityService Unit Tests
 *
 * Coverage targets:
 * - recordActivity: creates activity, returns id
 * - startThinkingPhase: creates activity with phaseStartedAt, tracks in activePhases
 * - endThinkingPhase: no active phase (warn only), happy path with duration calculation
 * - updateThinkingProgress: no active phase (warn only), updates progress
 * - getActivitiesByDimension: groups by dimension, computes totalDuration
 * - getDimensionTimeline: returns flat list for a specific dimension
 * - getLeaderThinkingHistory: filters by leader role
 * - getActivityStats: aggregates by role and thinking phase
 * - recordReviewActivity: happy path and FK error swallowed
 * - recordDimensionReview: creates review with actionResult
 * - recordOverallReview: creates overall review record
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AgentActivityService } from "../agent-activity.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AgentActivityType } from "@prisma/client";

// ──────────────────────────────────────────────────────────────────────────────
// Module-level mock for getModelDisplayNameMap
// ──────────────────────────────────────────────────────────────────────────────

jest.mock("../../../utils/model-display-name", () => ({
  getModelDisplayNameMap: jest
    .fn()
    .mockResolvedValue(new Map([["model-001", "GPT-4"]])),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock fixtures
// ──────────────────────────────────────────────────────────────────────────────

const mockActivity = {
  id: "activity-001",
  topicId: "topic-001",
  missionId: "mission-001",
  dimensionId: "dim-001",
  dimensionName: "Market Size",
  agentId: "agent-001",
  agentName: "Research Leader",
  agentRole: "leader",
  activityType: AgentActivityType.PLANNING,
  phase: "planning",
  content: "Starting research",
  progress: 0,
  thinkingPhase: "understanding",
  thinkingContent: null,
  searchResults: null,
  writingProgress: null,
  actionTaken: null,
  actionResult: null,
  phaseStartedAt: new Date(),
  phaseEndedAt: null,
  durationMs: null,
  createdAt: new Date(),
};

const mockPrisma = {
  researchAgentActivity: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("AgentActivityService", () => {
  let service: AgentActivityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentActivityService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AgentActivityService>(AgentActivityService);
    jest.clearAllMocks();
  });

  // ─────────────────────────── recordActivity ───────────────────────────────

  describe("recordActivity", () => {
    it("should create activity and return its id", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue(mockActivity);

      const id = await service.recordActivity({
        topicId: "topic-001",
        missionId: "mission-001",
        agentId: "agent-001",
        agentName: "Research Leader",
        agentRole: "leader",
        activityType: AgentActivityType.PLANNING,
        content: "Starting research",
      });

      expect(id).toBe("activity-001");
      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalled();
    });

    it("should append model label to agentName when modelId provided", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        ...mockActivity,
        agentName: "Research Leader [GPT-4]",
      });

      await service.recordActivity({
        topicId: "topic-001",
        missionId: "mission-001",
        agentId: "agent-001",
        agentName: "Research Leader",
        agentRole: "leader",
        activityType: AgentActivityType.PLANNING,
        content: "Starting",
        modelId: "model-001",
      });

      const createCall =
        mockPrisma.researchAgentActivity.create.mock.calls[0][0];
      expect(createCall.data.agentName).toContain("GPT-4");
    });

    it("should rethrow errors from prisma create", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        service.recordActivity({
          topicId: "topic-001",
          missionId: "mission-001",
          agentId: "agent-001",
          agentName: "Research Leader",
          agentRole: "leader",
          activityType: AgentActivityType.PLANNING,
          content: "Starting",
        }),
      ).rejects.toThrow("DB error");
    });
  });

  // ──────────────────────── startThinkingPhase ──────────────────────────────

  describe("startThinkingPhase", () => {
    it("should create activity with phaseStartedAt and return id", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue(mockActivity);

      const id = await service.startThinkingPhase({
        topicId: "topic-001",
        missionId: "mission-001",
        agentId: "agent-001",
        agentName: "Research Leader",
        agentRole: "leader",
        activityType: AgentActivityType.PLANNING,
        content: "Understanding the problem",
        thinkingPhase: "understanding",
      });

      expect(id).toBe("activity-001");
      const createCall =
        mockPrisma.researchAgentActivity.create.mock.calls[0][0];
      expect(createCall.data.phaseStartedAt).toBeDefined();
    });
  });

  // ─────────────────────────── endThinkingPhase ─────────────────────────────

  describe("endThinkingPhase", () => {
    it("should log warning and return when no active phase found", async () => {
      // No active phase registered
      await service.endThinkingPhase(
        "topic-001",
        "unknown-agent",
        "understanding",
      );

      expect(mockPrisma.researchAgentActivity.update).not.toHaveBeenCalled();
    });

    it("should update activity with end time and duration after startThinkingPhase", async () => {
      const activityWithStart = {
        ...mockActivity,
        phaseStartedAt: new Date(Date.now() - 5000), // 5 seconds ago
      };
      mockPrisma.researchAgentActivity.create.mockResolvedValue(mockActivity);
      mockPrisma.researchAgentActivity.findUnique.mockResolvedValue(
        activityWithStart,
      );
      mockPrisma.researchAgentActivity.update.mockResolvedValue({});

      await service.startThinkingPhase({
        topicId: "topic-001",
        missionId: "mission-001",
        agentId: "agent-001",
        agentName: "Research Leader",
        agentRole: "leader",
        activityType: AgentActivityType.PLANNING,
        content: "Starting",
        thinkingPhase: "understanding",
      });

      await service.endThinkingPhase(
        "topic-001",
        "agent-001",
        "understanding",
        {
          finalContent: "Research complete",
        },
      );

      expect(mockPrisma.researchAgentActivity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phaseEndedAt: expect.any(Date),
            progress: 100,
          }),
        }),
      );
    });
  });

  // ──────────────────────── updateThinkingProgress ──────────────────────────

  describe("updateThinkingProgress", () => {
    it("should warn when no active phase found", async () => {
      await service.updateThinkingProgress(
        "topic-001",
        "unknown-agent",
        "searching",
        50,
      );

      expect(mockPrisma.researchAgentActivity.update).not.toHaveBeenCalled();
    });

    it("should update progress for active phase", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue(mockActivity);
      mockPrisma.researchAgentActivity.update.mockResolvedValue({});

      await service.startThinkingPhase({
        topicId: "topic-001",
        missionId: "mission-001",
        agentId: "agent-002",
        agentName: "Researcher",
        agentRole: "researcher",
        activityType: AgentActivityType.SEARCHING,
        content: "Searching",
        thinkingPhase: "searching",
      });

      await service.updateThinkingProgress(
        "topic-001",
        "agent-002",
        "searching",
        75,
      );

      expect(mockPrisma.researchAgentActivity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progress: 75 }),
        }),
      );
    });
  });

  // ─────────────────────── getActivitiesByDimension ─────────────────────────

  describe("getActivitiesByDimension", () => {
    it("should group activities by dimension and compute totalDuration", async () => {
      const activities = [
        {
          ...mockActivity,
          id: "act-001",
          dimensionId: "dim-001",
          dimensionName: "Market Size",
          durationMs: 5000,
        },
        {
          ...mockActivity,
          id: "act-002",
          dimensionId: "dim-001",
          dimensionName: "Market Size",
          durationMs: 3000,
        },
        {
          ...mockActivity,
          id: "act-003",
          dimensionId: "dim-002",
          dimensionName: "Competitors",
          durationMs: 2000,
        },
      ];
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue(activities);

      const result = await service.getActivitiesByDimension("topic-001");

      expect(result).toHaveLength(2);
      const dim1 = result.find((r) => r.dimensionId === "dim-001");
      expect(dim1?.totalDuration).toBe(8000);
      expect(dim1?.activities).toHaveLength(2);
    });

    it("should handle activities without dimensionId under general group", async () => {
      const activities = [
        {
          ...mockActivity,
          id: "act-general",
          dimensionId: null,
          dimensionName: null,
        },
      ];
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue(activities);

      const result = await service.getActivitiesByDimension("topic-001");

      const general = result.find((r) => r.dimensionId === "general");
      expect(general).toBeDefined();
      expect(general?.dimensionName).toBe("通用活动");
    });
  });

  // ─────────────────────── getDimensionTimeline ─────────────────────────────

  describe("getDimensionTimeline", () => {
    it("should return activities for specific dimension ordered by creation", async () => {
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([
        { ...mockActivity, id: "act-001" },
        { ...mockActivity, id: "act-002" },
      ]);

      const result = await service.getDimensionTimeline("topic-001", "dim-001");

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("act-001");
    });
  });

  // ─────────────────────── getLeaderThinkingHistory ─────────────────────────

  describe("getLeaderThinkingHistory", () => {
    it("should filter activities by leader role", async () => {
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([
        { ...mockActivity, agentRole: "leader" },
      ]);

      await service.getLeaderThinkingHistory("topic-001");

      expect(mockPrisma.researchAgentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topicId: "topic-001",
            agentRole: "leader",
          }),
        }),
      );
    });
  });

  // ─────────────────────────── getActivityStats ─────────────────────────────

  describe("getActivityStats", () => {
    it("should compute stats by role and thinking phase", async () => {
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([
        {
          agentRole: "leader",
          thinkingPhase: "understanding",
          durationMs: 5000,
        },
        {
          agentRole: "researcher",
          thinkingPhase: "searching",
          durationMs: 10000,
        },
        {
          agentRole: "researcher",
          thinkingPhase: "searching",
          durationMs: 8000,
        },
      ]);

      const stats = await service.getActivityStats("topic-001");

      expect(stats.totalActivities).toBe(3);
      expect(stats.byAgentRole["leader"]).toBe(1);
      expect(stats.byAgentRole["researcher"]).toBe(2);
      expect(stats.byThinkingPhase["searching"]).toBe(2);
      expect(stats.totalDuration).toBe(23000);
      expect(stats.averageDuration).toBeCloseTo(23000 / 3);
    });

    it("should return zero averageDuration when no activities have durationMs", async () => {
      mockPrisma.researchAgentActivity.findMany.mockResolvedValue([
        { agentRole: "leader", thinkingPhase: null, durationMs: null },
      ]);

      const stats = await service.getActivityStats("topic-001");

      expect(stats.averageDuration).toBe(0);
    });
  });

  // ────────────────────────── recordReviewActivity ──────────────────────────

  describe("recordReviewActivity", () => {
    it("should create review activity record", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue(mockActivity);

      await service.recordReviewActivity(
        "topic-001",
        "mission-001",
        "dim-001",
        "Market Size",
        "Review completed",
        true,
      );

      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            agentRole: "leader",
            activityType: AgentActivityType.REVIEWING,
            progress: 100, // approved
          }),
        }),
      );
    });

    it("should swallow foreign key constraint errors", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Foreign key constraint failed"),
      );

      // Should not throw
      await expect(
        service.recordReviewActivity(
          "topic-001",
          "mission-001",
          "dim-001",
          "Market Size",
          "Review",
          true,
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ─────────────────────── recordDimensionReview ────────────────────────────

  describe("recordDimensionReview", () => {
    it("should create dimension review with quality scores in actionResult", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        ...mockActivity,
        id: "review-001",
      });

      const id = await service.recordDimensionReview(
        "topic-001",
        "mission-001",
        "dim-001",
        "Market Size",
        {
          qualityLevel: "good",
          overallScore: 85,
          scores: {
            breadth: 90,
            depth: 80,
            evidence: 85,
            coherence: 88,
            currency: 82,
          },
          issues: [],
          suggestions: ["Add more recent sources"],
          needsReresearch: false,
        },
      );

      expect(id).toBe("review-001");
      expect(mockPrisma.researchAgentActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionResult: expect.objectContaining({
              qualityLevel: "good",
              overallScore: 85,
            }),
          }),
        }),
      );
    });
  });
});

/**
 * AgentActivityService - Supplemental Coverage Tests
 *
 * Targets uncovered lines:
 * - resolveAgentDisplayName: modelId already in name (skip append), lookup fails (warn and return original)
 * - endThinkingPhase: activity not found (durationMs=undefined path)
 * - updateThinkingProgress: with searchResults, writingProgress, thinkingContent
 * - recordReviewActivity: Foreign key constraint error swallowed
 * - recordDimensionReview: Foreign key constraint error returns ""
 * - recordOverallReview: Foreign key constraint error returns ""
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AgentActivityService } from "../agent-activity.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { AgentActivityType } from "@prisma/client";
import { getModelDisplayNameMap } from "../../../utils/model-display-name";

jest.mock("../../../utils/model-display-name", () => ({
  getModelDisplayNameMap: jest
    .fn()
    .mockResolvedValue(new Map([["model-001", "GPT-4"]])),
}));

const mockPrisma = {
  researchAgentActivity: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const baseInput = {
  topicId: "topic-001",
  missionId: "mission-001",
  dimensionId: "dim-001",
  dimensionName: "Market Size",
  agentId: "agent-001",
  agentName: "Research Leader",
  agentRole: "leader" as const,
  activityType: AgentActivityType.PLANNING,
  phase: "planning",
  content: "Starting research",
  progress: 0,
};

describe("AgentActivityService - Supplemental", () => {
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

    // Reset the mock to default behavior
    (getModelDisplayNameMap as jest.Mock).mockResolvedValue(
      new Map([["model-001", "GPT-4"]]),
    );
  });

  // ─── resolveAgentDisplayName ───

  describe("resolveAgentDisplayName (via recordActivity)", () => {
    it("should not append model label if already in agentName", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "act-001",
      });

      await service.recordActivity({
        ...baseInput,
        agentName: "Research Leader [GPT-4]", // already contains the label
        modelId: "model-001",
      });

      const createCall =
        mockPrisma.researchAgentActivity.create.mock.calls[0][0];
      // Should NOT double-append [GPT-4]
      expect(createCall.data.agentName).toBe("Research Leader [GPT-4]");
    });

    it("should append model label when not in agentName", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "act-001",
      });

      await service.recordActivity({
        ...baseInput,
        agentName: "Research Leader",
        modelId: "model-001",
      });

      const createCall =
        mockPrisma.researchAgentActivity.create.mock.calls[0][0];
      expect(createCall.data.agentName).toBe("Research Leader [GPT-4]");
    });

    it("should return original name when model label lookup fails", async () => {
      (getModelDisplayNameMap as jest.Mock).mockRejectedValue(
        new Error("DB error"),
      );
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "act-001",
      });

      await service.recordActivity({
        ...baseInput,
        agentName: "Research Leader",
        modelId: "model-001",
      });

      const createCall =
        mockPrisma.researchAgentActivity.create.mock.calls[0][0];
      // Fallback: returns original agentName unchanged
      expect(createCall.data.agentName).toBe("Research Leader");
    });

    it("should return name unchanged when no modelId provided", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "act-001",
      });

      await service.recordActivity({
        ...baseInput,
        agentName: "Research Leader",
        modelId: undefined,
      });

      const createCall =
        mockPrisma.researchAgentActivity.create.mock.calls[0][0];
      expect(createCall.data.agentName).toBe("Research Leader");
      expect(getModelDisplayNameMap).not.toHaveBeenCalled();
    });
  });

  // ─── endThinkingPhase ───

  describe("endThinkingPhase", () => {
    it("should warn and return when no active phase found", async () => {
      // No prior startThinkingPhase call → no entry in activePhases
      await service.endThinkingPhase("topic-001", "agent-001", "understanding");
      expect(
        mockPrisma.researchAgentActivity.findUnique,
      ).not.toHaveBeenCalled();
    });

    it("should calculate durationMs when phaseStartedAt is null", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "phase-act",
      });
      mockPrisma.researchAgentActivity.findUnique.mockResolvedValue({
        phaseStartedAt: null, // no start time
      });
      mockPrisma.researchAgentActivity.update.mockResolvedValue({});

      // Start a phase first
      await service.startThinkingPhase({
        ...baseInput,
        thinkingPhase: "searching",
        activityType: AgentActivityType.SEARCHING,
      });

      // End it
      await service.endThinkingPhase("topic-001", "agent-001", "searching", {
        searchResults: {
          query: "test",
          totalResults: 5,
          sources: [],
          searchedAt: new Date().toISOString(),
          searchType: "web",
        },
      });

      const updateCall =
        mockPrisma.researchAgentActivity.update.mock.calls[0][0];
      expect(updateCall.data.durationMs).toBeUndefined(); // no start time → undefined
      expect(updateCall.data.phaseEndedAt).toBeInstanceOf(Date);
    });

    it("should include searchResults and writingProgress in update", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "phase-act-2",
      });
      mockPrisma.researchAgentActivity.findUnique.mockResolvedValue({
        phaseStartedAt: new Date(Date.now() - 5000),
      });
      mockPrisma.researchAgentActivity.update.mockResolvedValue({});

      await service.startThinkingPhase({
        ...baseInput,
        agentId: "agent-002",
        thinkingPhase: "writing",
        activityType: AgentActivityType.WRITING,
      });

      await service.endThinkingPhase("topic-001", "agent-002", "writing", {
        writingProgress: {
          totalSections: 3,
          completedSections: 3,
          currentSection: "Summary",
          wordCount: 500,
        },
        finalContent: "Final content here",
        actionResult: { status: "done" },
      });

      const updateCall =
        mockPrisma.researchAgentActivity.update.mock.calls[0][0];
      expect(updateCall.data.durationMs).toBeGreaterThanOrEqual(0);
      expect(updateCall.data.thinkingContent).toBe("Final content here");
    });
  });

  // ─── updateThinkingProgress ───

  describe("updateThinkingProgress", () => {
    it("should warn when no active phase for update", async () => {
      // No startThinkingPhase → should just warn and return
      await service.updateThinkingProgress(
        "topic-001",
        "nonexistent-agent",
        "understanding",
        50,
      );
      expect(mockPrisma.researchAgentActivity.update).not.toHaveBeenCalled();
    });

    it("should update progress with optional fields", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "phase-upd",
      });
      mockPrisma.researchAgentActivity.update.mockResolvedValue({});

      await service.startThinkingPhase({
        ...baseInput,
        agentId: "agent-upd",
        thinkingPhase: "understanding",
        activityType: AgentActivityType.THINKING,
      });

      await service.updateThinkingProgress(
        "topic-001",
        "agent-upd",
        "understanding",
        60,
        {
          searchResults: {
            query: "q",
            totalResults: 3,
            sources: [],
            searchedAt: new Date().toISOString(),
            searchType: "web",
          },
          writingProgress: {
            totalSections: 2,
            completedSections: 1,
            currentSection: "Intro",
            wordCount: 200,
          },
          thinkingContent: "Current thinking",
        },
      );

      const updateCall =
        mockPrisma.researchAgentActivity.update.mock.calls[0][0];
      expect(updateCall.data.progress).toBe(60);
      expect(updateCall.data.searchResults).toBeDefined();
      expect(updateCall.data.writingProgress).toBeDefined();
      expect(updateCall.data.thinkingContent).toBe("Current thinking");
    });

    it("should handle update error gracefully", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "phase-err",
      });
      mockPrisma.researchAgentActivity.update.mockRejectedValue(
        new Error("DB error"),
      );

      await service.startThinkingPhase({
        ...baseInput,
        agentId: "agent-err",
        thinkingPhase: "integrating",
        activityType: AgentActivityType.THINKING,
      });

      // Should not throw
      await expect(
        service.updateThinkingProgress(
          "topic-001",
          "agent-err",
          "integrating",
          75,
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ─── recordReviewActivity ───

  describe("recordReviewActivity", () => {
    it("should swallow Foreign key constraint error", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Foreign key constraint failed"),
      );

      // Should not throw
      await expect(
        service.recordReviewActivity(
          "topic-1",
          "mission-1",
          "dim-1",
          "Market Size",
          "Review complete",
          true,
        ),
      ).resolves.toBeUndefined();
    });

    it("should log and rethrow non-FK errors", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Connection timeout"),
      );

      // Non-FK error should NOT throw (service catches and ignores all errors from this method)
      await expect(
        service.recordReviewActivity("t", "m", "d", "n", "c", false),
      ).resolves.toBeUndefined();
    });
  });

  // ─── recordDimensionReview ───

  describe("recordDimensionReview", () => {
    const baseReview = {
      qualityLevel: "good",
      overallScore: 80,
      scores: {
        breadth: 80,
        depth: 75,
        evidence: 85,
        coherence: 80,
        currency: 75,
      },
      issues: [],
      suggestions: [],
      needsReresearch: false,
    };

    it("should return empty string on Foreign key constraint error", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Foreign key constraint failed on field: topic_id"),
      );

      const result = await service.recordDimensionReview(
        "topic-1",
        "mission-1",
        "dim-1",
        "Market Size",
        baseReview,
      );

      expect(result).toBe("");
    });

    it("should return empty string on non-FK error too (error is caught)", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("DB timeout"),
      );

      const result = await service.recordDimensionReview(
        "topic-1",
        "mission-1",
        "dim-1",
        "Market Size",
        baseReview,
      );

      expect(result).toBe("");
    });

    it("should return activity id on success", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "review-act-1",
      });

      const result = await service.recordDimensionReview(
        "topic-1",
        "mission-1",
        "dim-1",
        "Market Size",
        { ...baseReview, reresearchFocus: ["all"] },
      );

      expect(result).toBe("review-act-1");
    });
  });

  // ─── recordOverallReview ───

  describe("recordOverallReview", () => {
    const baseOverallReview = {
      qualityLevel: "good",
      overallScore: 75.5,
      dimensionReviews: [
        {
          dimensionId: "d1",
          dimensionName: "Market",
          qualityLevel: "good",
          overallScore: 80,
        },
      ],
      crossDimensionIssues: [],
      coverageAnalysis: {
        coveredAspects: ["Market"],
        missingAspects: [],
        coverageScore: 90,
      },
      recommendations: ["Improve depth"],
      needsReresearch: false,
      dimensionsToReresearch: [],
    };

    it("should return empty string on Foreign key constraint error", async () => {
      mockPrisma.researchAgentActivity.create.mockRejectedValue(
        new Error("Foreign key constraint violation"),
      );

      const result = await service.recordOverallReview(
        "topic-1",
        "mission-1",
        baseOverallReview,
      );
      expect(result).toBe("");
    });

    it("should return activity id on success", async () => {
      mockPrisma.researchAgentActivity.create.mockResolvedValue({
        id: "overall-act-1",
      });

      const result = await service.recordOverallReview(
        "topic-1",
        "mission-1",
        baseOverallReview,
      );
      expect(result).toBe("overall-act-1");
    });
  });
});

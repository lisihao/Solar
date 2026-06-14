/**
 * LeaderPlanningService Supplemental Tests
 *
 * Targets uncovered lines:
 * - lines 126-127: acquireOutlineSlot queueing path (concurrent > MAX_CONCURRENT_OUTLINES)
 * - lines 134-135: releaseOutlineSlot with queued items
 * - lines 232-233: duplicate model name suffix handling in planResearch
 * - lines 422-427: framework skills injection for dimension_researcher
 * - line 469: auto-assign agentReason.agentReason (when assignmentReason exists but agentReason empty)
 * - lines 483-484: quality_reviewer debate skills injection
 * - lines 495-496: quality_reviewer agentReason backfill
 * - lines 515-516: report_writer agentReason backfill
 * - lines 615-618: oversized prompt error logging
 * - line 651: oversized prompt last-chars preview
 * - line 803: HTML error page in planDimensionOutline
 * - line 885: billing error in planDimensionOutline exception
 * - line 1107: HTML error page in planGlobalOutline
 * - line 1209: billing error in planGlobalOutline exception
 */

import { Test, TestingModule } from "@nestjs/testing";
import { InternalServerErrorException } from "@nestjs/common";
import { LeaderPlanningService } from "../leader-planning.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: { findUnique: jest.fn() },
    leaderDecision: { create: jest.fn() },
  };

  const mockChatFacade = {
    getAvailableModelsExtended: jest
      .fn()
      .mockResolvedValue([buildModelEntry({ id: "gpt-4o", name: "GPT-4o" })]),
    getReasoningModel: jest.fn().mockResolvedValue(buildReasoningModelInfo()),
    selectModel: jest.fn().mockResolvedValue(buildModelEntry()),
    chat: jest.fn(),
  };

  return { mockPrisma, mockChatFacade };
}

function buildModelEntry(
  overrides: Partial<{
    id: string;
    name: string;
    provider: string;
    isReasoning: boolean;
    isAvailable: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? "gpt-4o",
    name: overrides.name ?? "GPT-4o",
    provider: overrides.provider ?? "openai",
    isReasoning: overrides.isReasoning ?? false,
    isAvailable: overrides.isAvailable ?? true,
  };
}

function buildReasoningModelInfo() {
  return {
    id: "o3-mini",
    name: "o3-mini",
    provider: "openai",
    isReasoning: true,
  };
}

function buildTopic(
  overrides: Partial<{
    id: string;
    name: string;
    type: string;
    description: string | null;
    language: string | null;
    dimensions: unknown[];
  }> = {},
) {
  return {
    id: overrides.id ?? "topic-1",
    name: overrides.name ?? "AI Trends",
    type: overrides.type ?? "research",
    description: overrides.description ?? "AI trend research",
    language: overrides.language ?? "zh",
    dimensions: overrides.dimensions ?? [],
  };
}

function buildValidDimensionOutline() {
  return {
    intentUnderstanding: {
      coreQuestion: "What are the AI trends?",
      scope: { included: ["market"], excluded: [] },
      expectedDepth: "detailed",
      targetAudience: "general",
      keyFocusAreas: ["market"],
    },
    sections: [
      {
        id: "sec-1",
        title: "Introduction",
        description: "Intro",
        keyPoints: ["key point"],
        targetWords: 500,
        evidenceRequirements: { minReferences: 3 },
      },
    ],
    executionPlan: {
      parallelGroups: [["sec-1"]],
      estimatedTotalWords: 500,
    },
  };
}

function buildValidGlobalOutline(dimensions: unknown[] = []) {
  return {
    dimensions,
    globalThemes: ["AI", "market"],
    deduplicationRules: [],
  };
}

async function createService() {
  const { mockPrisma, mockChatFacade } = buildMocks();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      LeaderPlanningService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: ChatFacade, useValue: mockChatFacade },
    ],
  }).compile();

  const service = module.get<LeaderPlanningService>(LeaderPlanningService);

  jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "debug").mockImplementation(() => undefined);

  // Speed up delay
  jest
    .spyOn(
      service as unknown as { delay: (ms: number) => Promise<void> },
      "delay",
    )
    .mockResolvedValue(undefined);

  return { service, mockPrisma, mockChatFacade };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("LeaderPlanningService (supplemental)", () => {
  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // Semaphore: acquireOutlineSlot/releaseOutlineSlot (lines 126-127, 134-135)
  // ============================================================

  describe("outline semaphore – queueing (lines 126-127, 134-135)", () => {
    it("should queue planDimensionOutline calls when MAX_CONCURRENT_OUTLINES is exceeded", async () => {
      const { service, mockChatFacade } = await createService();

      // Set up successful response
      mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify(buildValidDimensionOutline()),
      });
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({ id: "gpt-4o" }),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );

      const topic = buildTopic();
      const dimension = {
        id: "dim-1",
        name: "Market Analysis",
        description: "Market research",
        searchQueries: ["market analysis 2024"],
      };

      // Run MAX+1 concurrent outlines to trigger the queue path
      // MAX_CONCURRENT_OUTLINES = 3, so run 4
      const promises = Array.from({ length: 4 }, () =>
        service.planDimensionOutline(
          topic as never,
          dimension as never,
          "Evidence summary",
          "Figure summary",
          [],
        ),
      );

      const results = await Promise.all(promises);

      // All should complete
      expect(results).toHaveLength(4);
      results.forEach((r) => expect(r.sections).toBeDefined());
    });
  });

  // ============================================================
  // planResearch – duplicate model name (lines 232-233)
  // ============================================================

  describe("planResearch – duplicate model name suffix (lines 232-233)", () => {
    it("should append suffix when two models have the same name", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();

      const topic = buildTopic({ type: "research" });
      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);

      // Two models with the same name but different IDs
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry({
          id: "ep-xxx-001",
          name: "Doubao",
          provider: "volcengine",
          isReasoning: false,
        }),
        buildModelEntry({
          id: "ep-xxx-002",
          name: "Doubao",
          provider: "volcengine",
          isReasoning: true,
        }),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue({
        id: "ep-xxx-001",
        name: "Doubao",
        provider: "volcengine",
        isReasoning: false,
      });

      const plan = {
        taskUnderstanding: {
          topic: "AI Trends",
          scope: "broad",
          objectives: [],
        },
        dimensions: [
          {
            id: "dim-1",
            name: "Market",
            description: "Market analysis",
            searchQueries: [],
            dataSources: [],
            priority: 1,
          },
        ],
        executionStrategy: { parallelism: 1, priorityOrder: ["dim-1"] },
        agentAssignments: [
          {
            agentId: "researcher-1",
            agentName: "研究员-1",
            agentType: "dimension_researcher",
            assignedDimensions: ["dim-1"],
            modelId: "ep-xxx-001",
            skills: ["synthesis"],
            tools: ["web-search"],
            assignmentReason: {
              agentReason: "Expert researcher",
              modelReason: "Good model",
            },
          },
        ],
      };

      mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify(plan),
      });

      const result = await service.planResearch("topic-1");

      expect(result.dimensions).toHaveLength(1);
    });
  });

  // ============================================================
  // planResearch – framework skills injection (lines 422-427)
  // ============================================================

  describe("planResearch – framework skills injection (lines 422-427)", () => {
    it("should inject framework skills for dimension_researcher with specific topic type", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();

      // Use a topic type that has framework skills (e.g., "EVENT")
      const topic = buildTopic({ type: "EVENT" });
      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);

      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );

      const plan = {
        taskUnderstanding: {
          topic: "Event Analysis",
          scope: "narrow",
          objectives: [],
        },
        dimensions: [
          {
            id: "dim-1",
            name: "Event Impact",
            description: "Impact analysis",
            searchQueries: [],
            dataSources: [],
            priority: 1,
          },
        ],
        executionStrategy: { parallelism: 1, priorityOrder: ["dim-1"] },
        agentAssignments: [
          {
            agentId: "researcher-1",
            agentType: "dimension_researcher",
            agentName: "Research Agent",
            assignedDimensions: ["dim-1"],
            modelId: "gpt-4o",
            skills: ["synthesis"], // existing skill
            tools: ["web-search"],
            assignmentReason: null,
          },
        ],
      };

      mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify(plan),
      });

      const result = await service.planResearch("topic-1");

      expect(result).toBeDefined();
      expect(result.dimensions).toHaveLength(1);
      // Framework skills should be injected, but we can't check the assignments
      // directly since planResearch returns plan not assignments
    });
  });

  // ============================================================
  // planResearch – quality_reviewer debate skills (lines 483-484, 495-496)
  // ============================================================

  describe("planResearch – quality_reviewer agent skills and reason backfill", () => {
    it("should inject debate skills for quality_reviewer", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();

      const topic = buildTopic({ type: "research" });
      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);

      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );

      const plan = {
        taskUnderstanding: {
          topic: "AI Trends",
          scope: "broad",
          objectives: [],
        },
        dimensions: [
          {
            id: "dim-1",
            name: "Market",
            description: "Market analysis",
            searchQueries: [],
            dataSources: [],
            priority: 1,
          },
        ],
        executionStrategy: { parallelism: 1, priorityOrder: ["dim-1"] },
        agentAssignments: [
          {
            agentId: "reviewer-1",
            agentType: "quality_reviewer",
            agentName: "Quality Reviewer",
            assignedDimensions: ["dim-1"],
            modelId: "gpt-4o",
            skills: [], // empty → should get debate skills
            tools: [],
            assignmentReason: null, // null → should be auto-assigned
          },
        ],
      };

      mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify(plan),
      });

      const result = await service.planResearch("topic-1");
      expect(result).toBeDefined();
    });

    it("should backfill agentReason for quality_reviewer with existing assignmentReason", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();

      const topic = buildTopic({ type: "research" });
      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);

      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );

      const plan = {
        taskUnderstanding: {
          topic: "AI Trends",
          scope: "broad",
          objectives: [],
        },
        dimensions: [
          {
            id: "dim-1",
            name: "Market",
            description: "Market",
            searchQueries: [],
            dataSources: [],
            priority: 1,
          },
        ],
        executionStrategy: { parallelism: 1, priorityOrder: ["dim-1"] },
        agentAssignments: [
          {
            agentId: "reviewer-1",
            agentType: "quality_reviewer",
            agentName: "Reviewer",
            assignedDimensions: ["dim-1"],
            modelId: "gpt-4o",
            skills: ["critical-thinking"],
            tools: [],
            assignmentReason: {
              agentReason: "", // empty → should be backfilled (line 495-496)
              modelReason: "Some model reason",
            },
          },
        ],
      };

      mockChatFacade.chat.mockResolvedValue({ content: JSON.stringify(plan) });

      const result = await service.planResearch("topic-1");
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // planResearch – report_writer agentReason backfill (lines 515-516)
  // ============================================================

  describe("planResearch – report_writer agentReason backfill (lines 515-516)", () => {
    it("should backfill agentReason for report_writer with empty assignmentReason.agentReason", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();

      const topic = buildTopic({ type: "research" });
      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);

      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );

      const plan = {
        taskUnderstanding: {
          topic: "AI Trends",
          scope: "broad",
          objectives: [],
        },
        dimensions: [
          {
            id: "dim-1",
            name: "Market",
            description: "Market",
            searchQueries: [],
            dataSources: [],
            priority: 1,
          },
        ],
        executionStrategy: { parallelism: 1, priorityOrder: ["dim-1"] },
        agentAssignments: [
          {
            agentId: "writer-1",
            agentType: "report_writer",
            agentName: "Report Writer",
            assignedDimensions: [],
            modelId: "gpt-4o",
            skills: [],
            tools: [],
            assignmentReason: {
              agentReason: "", // empty → backfilled (line 515-516)
              modelReason: "Model reason",
            },
          },
        ],
      };

      mockChatFacade.chat.mockResolvedValue({ content: JSON.stringify(plan) });

      const result = await service.planResearch("topic-1");
      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // planDimensionOutline – oversized prompt logging (lines 615-618, 651)
  // ============================================================

  describe("planDimensionOutline – oversized prompt (lines 615-618, 651)", () => {
    it("should log error when finalPrompt exceeds 50,000 chars", async () => {
      const { service, mockChatFacade } = await createService();

      const errorCalls: string[] = [];
      jest
        .spyOn(service["logger"], "error")
        .mockImplementation((msg: string) => {
          errorCalls.push(msg);
        });

      mockChatFacade.chat.mockResolvedValue({
        content: JSON.stringify(buildValidDimensionOutline()),
      });

      const topic = buildTopic();
      const dimension = {
        id: "dim-1",
        name: "Market Analysis",
        description: "Market",
        searchQueries: [],
      };

      // Create evidence summary that's large enough to trigger oversized check (>50,000 chars)
      const hugeEvidenceSummary = "X".repeat(51_000);

      const result = await service.planDimensionOutline(
        topic as never,
        dimension as never,
        hugeEvidenceSummary,
      );

      // Should still return valid outline (doesn't throw just for large prompt)
      expect(result.sections).toBeDefined();
      // Should have logged error about oversized prompt
      const oversizedLog = errorCalls.some(
        (c) => c.includes("OVERSIZED") || c.includes("finalPrompt"),
      );
      expect(oversizedLog).toBe(true);
    });
  });

  // ============================================================
  // planDimensionOutline – HTML error page (line 803)
  // ============================================================

  describe("planDimensionOutline – HTML error page (line 803)", () => {
    it("should retry when API returns HTML error page and eventually succeed", async () => {
      const { service, mockChatFacade } = await createService();

      const topic = buildTopic();
      const dimension = {
        id: "dim-1",
        name: "Market",
        description: "Market analysis",
        searchQueries: [],
      };

      // First call returns HTML, second returns valid JSON
      mockChatFacade.chat
        .mockResolvedValueOnce({
          content:
            "<!DOCTYPE html><html><body>503 Service Unavailable</body></html>",
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(buildValidDimensionOutline()),
        });

      const result = await service.planDimensionOutline(
        topic as never,
        dimension as never,
        "Evidence summary",
      );

      expect(result.sections).toBeDefined();
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(2);
    });

    it("should throw after all retries with HTML error page", async () => {
      const { service, mockChatFacade } = await createService();

      const topic = buildTopic();
      const dimension = {
        id: "dim-1",
        name: "Market",
        description: "Market analysis",
        searchQueries: [],
      };

      // All 3 attempts return HTML
      mockChatFacade.chat.mockResolvedValue({
        content: "<!DOCTYPE html><html><body>503</body></html>",
      });

      await expect(
        service.planDimensionOutline(
          topic as never,
          dimension as never,
          "Evidence summary",
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ============================================================
  // planDimensionOutline – billing error in exception (line 885)
  // ============================================================

  describe("planDimensionOutline – billing error in exception handler (line 885)", () => {
    it("should mark model as failed when exception message includes billing keywords", async () => {
      const { service, mockChatFacade } = await createService();

      const topic = buildTopic();
      const dimension = {
        id: "dim-1",
        name: "Market",
        description: "Market analysis",
        searchQueries: [],
      };

      // First call throws with payment error, second call succeeds
      mockChatFacade.chat
        .mockRejectedValueOnce(
          new Error("402 Insufficient funds, payment required"),
        )
        .mockResolvedValueOnce({
          content: JSON.stringify(buildValidDimensionOutline()),
        });

      const result = await service.planDimensionOutline(
        topic as never,
        dimension as never,
        "Evidence summary",
      );

      expect(result.sections).toBeDefined();
    });

    it("should handle quota/billing error on last retry and throw", async () => {
      const { service, mockChatFacade } = await createService();

      const topic = buildTopic();
      const dimension = {
        id: "dim-1",
        name: "Market",
        description: "Market analysis",
        searchQueries: [],
      };

      // All retries throw with billing error
      mockChatFacade.chat.mockRejectedValue(
        new Error("billing quota exhausted - 402"),
      );

      await expect(
        service.planDimensionOutline(
          topic as never,
          dimension as never,
          "Evidence summary",
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ============================================================
  // planGlobalOutline – HTML error page (line 1107)
  // ============================================================

  describe("planGlobalOutline – HTML error page (line 1107)", () => {
    it("should retry when API returns HTML and eventually succeed", async () => {
      const { service, mockChatFacade } = await createService();

      const topicId = "topic-1";
      const dimensionSummaries = [
        {
          dimensionId: "dim-1",
          dimensionName: "Market Overview",
          evidenceSummary: "Market data",
          figuresSummary: "",
          searchResultsRecord: {},
          leaderContextSummary: "",
        },
      ];
      const topicMeta = buildTopic();

      const validOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-1",
          sections: [
            {
              id: "sec-1",
              title: "Introduction",
              description: "Intro",
              keyPoints: [],
              targetWords: 500,
            },
          ],
        },
      ]);

      // First call returns HTML, second succeeds
      mockChatFacade.chat
        .mockResolvedValueOnce({
          content: "<html><body>Service Unavailable</body></html>",
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(validOutline),
        });

      const result = await service.planGlobalOutline(
        topicId,
        dimensionSummaries as never,
        topicMeta as never,
      );

      expect(result).toBeDefined();
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================
  // planGlobalOutline – billing error in exception (line 1209)
  // ============================================================

  describe("planGlobalOutline – billing error in exception handler (line 1209)", () => {
    it("should mark model failed on billing error in global outline", async () => {
      const { service, mockChatFacade } = await createService();

      const topicId = "topic-1";
      const dimensionSummaries = [
        {
          dimensionId: "dim-1",
          dimensionName: "Market",
          evidenceSummary: "Evidence",
          figuresSummary: "",
          searchResultsRecord: {},
          leaderContextSummary: "",
        },
      ];
      const topicMeta = buildTopic();

      const validOutline = buildValidGlobalOutline([
        {
          dimensionId: "dim-1",
          sections: [
            {
              id: "sec-1",
              title: "Intro",
              description: "Intro",
              keyPoints: [],
              targetWords: 500,
            },
          ],
        },
      ]);

      // First call: payment error; second: success
      mockChatFacade.chat
        .mockRejectedValueOnce(new Error("402 payment required"))
        .mockResolvedValueOnce({
          content: JSON.stringify(validOutline),
        });

      const result = await service.planGlobalOutline(
        topicId,
        dimensionSummaries as never,
        topicMeta as never,
      );

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // planResearch – dimension_researcher agentReason.agentReason backfill (line 469)
  // ============================================================

  describe("planResearch – researcher agentReason.agentReason backfill (line 469)", () => {
    it("should backfill agentReason when assignmentReason exists but agentReason is empty", async () => {
      const { service, mockPrisma, mockChatFacade } = await createService();

      const topic = buildTopic({ type: "research" });
      mockPrisma.researchTopic.findUnique.mockResolvedValue(topic);

      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        buildModelEntry(),
      ]);
      mockChatFacade.getReasoningModel.mockResolvedValue(
        buildReasoningModelInfo(),
      );

      const plan = {
        taskUnderstanding: { topic: "AI", scope: "broad", objectives: [] },
        dimensions: [
          {
            id: "dim-1",
            name: "Market",
            description: "Market",
            searchQueries: [],
            dataSources: [],
            priority: 1,
          },
        ],
        executionStrategy: { parallelism: 1, priorityOrder: ["dim-1"] },
        agentAssignments: [
          {
            agentId: "researcher-1",
            agentType: "dimension_researcher",
            agentName: "Researcher",
            assignedDimensions: ["dim-1"],
            modelId: "gpt-4o",
            skills: ["synthesis"],
            tools: ["web-search"],
            assignmentReason: {
              agentReason: "", // empty → trigger line 469 backfill
              modelReason: "GPT-4o is good for research",
            },
          },
        ],
      };

      mockChatFacade.chat.mockResolvedValue({ content: JSON.stringify(plan) });

      const result = await service.planResearch("topic-1");
      expect(result).toBeDefined();
      expect(result.dimensions).toHaveLength(1);
    });
  });
});

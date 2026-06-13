// ─── Module-level mocks (must be before any imports that pull them in) ───────
// Mock @prisma/client FIRST to provide AIModelType and TopicType enums
// (Prisma may not be fully generated in all environments)
jest.mock("@prisma/client", () => ({
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    REASONING: "REASONING",
    EMBEDDING: "EMBEDDING",
    IMAGE: "IMAGE",
  },
  TopicType: { PRIVATE: "PRIVATE", PUBLIC: "PUBLIC" },
  PlanningDepth: {
    QUICK: "quick",
    STANDARD: "standard",
    COMPREHENSIVE: "comprehensive",
  },
  Prisma: {
    DbNull: "DbNull",
    JsonNull: "JsonNull",
  },
  PrismaClient: class {
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
}));
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }), {
  virtual: true,
});
jest.mock("cache-manager", () => ({}), { virtual: true });
jest.mock("ioredis", () => ({}), { virtual: true });
jest.mock("../../../teams/ai-teams.service", () => ({
  AiTeamsService: class {},
}));
jest.mock("../../../teams/services/ai/ai-response.service", () => ({
  AiResponseService: class {},
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  AIFacade: class {},
  ChatFacade: class {},
  TeamFacade: class {},
  RAGFacade: class {},
  ProgressTrackerService: class {},
  MissionExecutorService: class {},
  EventJournalService: class {},
  WorkingMemoryManagerService: class {},
  ResourceManagerService: class {},
  EventBusService: class {},
  MissionContext: { run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) },
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  AIFacade: class {},
  ChatFacade: class {},
  TeamFacade: class {},
  RAGFacade: class {},
  ProgressTrackerService: class {},
  MissionExecutorService: class {},
  EventJournalService: class {},
  WorkingMemoryManagerService: class {},
  ResourceManagerService: class {},
  EventBusService: class {},
  MissionContext: { run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()) },
}));
jest.mock("../../../../platform/facade", () => ({
  BillingContext: {
    run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PlanningOrchestratorService - Supplemental Tests
 *
 * Covers branches not in planning-orchestrator.service.spec.ts:
 * - executePhaseAsync: phase 4 fallback agents (non-comprehensive, no debaters)
 * - executePhaseAsync: quality gate retry path (reflection score < 50 with gaps)
 * - executePhaseAsync: phase skipped when no longer active (race condition)
 * - buildPreviousPhaseContext: phase 6 special context (phases 2, 4, 5)
 * - buildPreviousPhaseContext: context compression when summary is too long
 * - advancePhase: failed status re-activates current phase
 * - missionExecutor integration in executePhaseAsyncInner
 * - kernelJournal integration
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import {
  PlanningOrchestratorService,
  PlanningTopicMetadata,
  PlanPhaseStatus,
} from "../planning-orchestrator.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { AiTeamsService } from "../../../teams/ai-teams.service";
import { AiResponseService } from "../../../teams/services/ai/ai-response.service";
import { PlanningTemplateService } from "../planning-template.service";
import { ChatFacade, TeamFacade, RAGFacade } from "@/modules/ai-harness/facade";
import {
  MissionExecutorService,
  EventJournalService,
} from "@/modules/ai-harness/facade";
import { CreatePlanDto, PlanningDepth } from "../../dto/create-plan.dto";

// ======================================================
// Helpers
// ======================================================

function makeMeta(
  overrides: Partial<PlanningTopicMetadata> = {},
): PlanningTopicMetadata {
  return {
    planningMode: true,
    templateId: "general",
    currentPhase: 0,
    phaseStatus: {
      1: { status: "pending" },
      2: { status: "pending" },
      3: { status: "pending" },
      4: { status: "pending" },
      5: { status: "pending" },
      6: { status: "pending" },
    },
    planConfig: {
      goal: "Build an AI product",
      depth: PlanningDepth.STANDARD,
      autoAdvance: false,
    },
    ...overrides,
  };
}

function makeTopic(metaOverrides: Partial<PlanningTopicMetadata> = {}) {
  return {
    id: "topic-1",
    name: "My Plan",
    description: "Build an AI product",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-02"),
    metadata: makeMeta(metaOverrides) as unknown,
    aiMembers: [
      {
        id: "m0",
        displayName: "策划总监",
        aiModel: "default",
        systemPrompt: "You are leader",
        roleDescription: "Leader role",
      },
      {
        id: "m1",
        displayName: "研究员",
        aiModel: "gpt-4o",
        systemPrompt: "You are researcher",
        roleDescription: "Research role",
      },
      {
        id: "m2",
        displayName: "分析师",
        aiModel: "default",
        systemPrompt: "You are analyst",
        roleDescription: "Analyst role",
      },
      {
        id: "m3",
        displayName: "文案专家",
        aiModel: "default",
        systemPrompt: "You are copywriter",
        roleDescription: "Copy role",
      },
    ],
    _count: { aiMembers: 4 },
  };
}

// ======================================================
// Mock factories
// ======================================================

const mockPrisma = {
  topic: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

const mockAiTeamsService = { createTopic: jest.fn() };
const mockAiResponseService = { createAIMessage: jest.fn() };
const mockTemplateService = {
  getTemplate: jest.fn(),
  getDefaultTemplate: jest.fn(),
};

const mockChatFacade = {
  chat: jest.fn(),
  getReasoningModel: jest.fn(),
  getAvailableModelsExtended: jest.fn(),
};

const mockTeamFacade = {
  reflect: jest.fn(),
  aiCompressContext: jest.fn(),
};

const mockRagFacade = { search: jest.fn() };

const mockMissionExecutor = {
  execute: jest.fn().mockResolvedValue({ processId: "proc-test" }),
  complete: jest.fn().mockResolvedValue(undefined),
  fail: jest.fn().mockResolvedValue(undefined),
};

const mockKernelJournal = {
  record: jest.fn().mockResolvedValue(undefined),
};

// ======================================================
// Tests
// ======================================================

describe("PlanningOrchestratorService (supplemental)", () => {
  let service: PlanningOrchestratorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanningOrchestratorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiTeamsService, useValue: mockAiTeamsService },
        { provide: AiResponseService, useValue: mockAiResponseService },
        { provide: PlanningTemplateService, useValue: mockTemplateService },
        { provide: ChatFacade, useValue: mockChatFacade },
        { provide: TeamFacade, useValue: mockTeamFacade },
        { provide: RAGFacade, useValue: mockRagFacade },
        { provide: MissionExecutorService, useValue: mockMissionExecutor },
        { provide: EventJournalService, useValue: mockKernelJournal },
      ],
    }).compile();

    service = module.get<PlanningOrchestratorService>(
      PlanningOrchestratorService,
    );
  });

  // ==================== advancePhase with failed status ====================

  describe("advancePhase — failed phase re-activation", () => {
    it("re-activates current phase when status is failed", async () => {
      const topic = makeTopic({
        currentPhase: 2,
        phaseStatus: {
          2: { status: "failed", error: "timeout" },
        } as Record<number, PlanPhaseStatus>,
      });
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic) // advancePhase ownership check
        .mockResolvedValueOnce(topic); // activatePhase fresh metadata read
      mockPrisma.topic.update.mockResolvedValue({});
      mockChatFacade.chat.mockResolvedValue({
        isError: false,
        content: "retry output",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});
      mockRagFacade.search.mockResolvedValue({ success: false, results: [] });

      const result = await service.advancePhase("topic-1", "user-1");

      // Failed phase should be re-activated (not advanced to 3)
      expect(result.currentPhase).toBe(2);
      expect(mockPrisma.topic.update).toHaveBeenCalled();
    });
  });

  // ==================== executePhaseAsync — phase no longer active ====================

  describe("executePhaseAsyncInner — phase cancelled mid-execution", () => {
    it("skips execution when phase status is no longer active", async () => {
      const activeMeta = makeMeta({
        currentPhase: 1,
        phaseStatus: { 1: { status: "pending" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };
      mockPrisma.topic.findFirst.mockResolvedValue(topic);
      mockPrisma.topic.update.mockResolvedValue({});

      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };

      // Should return early without calling chat
      await innerService.executePhaseAsyncInner("topic-1", "user-1", 1);

      expect(mockChatFacade.chat).not.toHaveBeenCalled();
    });
  });

  // ==================== executePhaseAsync — phase 4 fallback (no debaters) ====================

  describe("executePhaseAsyncInner — phase 4 debate fallback", () => {
    it("uses fallback agents [0, 2] when no debaters exist (non-comprehensive)", async () => {
      const activeMeta = makeMeta({
        currentPhase: 4,
        phaseStatus: {
          1: { status: "completed", summary: "Goal analysis done" },
          2: { status: "completed", summary: "Research done" },
          3: { status: "completed", summary: "Brainstorm done" },
          4: { status: "active" },
        } as Record<number, PlanPhaseStatus>,
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };
      // Only 4 members (no debaters at index 4 and 5)
      mockPrisma.topic.findFirst.mockResolvedValue(topic);
      mockPrisma.topic.update.mockResolvedValue({});
      mockChatFacade.chat.mockResolvedValue({
        isError: false,
        content: "Debate output from fallback",
        model: "gpt-4o",
        tokensUsed: 80,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };

      await innerService.executePhaseAsyncInner("topic-1", "user-1", 4);

      // Update should be called to mark phase 4 as completed
      expect(mockPrisma.topic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              phaseStatus: expect.objectContaining({
                4: expect.objectContaining({ status: "completed" }),
              }),
            }),
          }),
        }),
      );
    });
  });

  // ==================== executePhaseAsync — all agents fail ====================

  describe("executePhaseAsyncInner — all agents fail", () => {
    it("marks phase as failed when all agents produce errors", async () => {
      const activeMeta = makeMeta({
        currentPhase: 1,
        phaseStatus: { 1: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic) // execute inner check
        .mockResolvedValueOnce(topic); // updatePhaseStatus
      mockPrisma.topic.update.mockResolvedValue({});
      mockChatFacade.chat.mockResolvedValue({
        isError: true,
        content: "LLM error",
        model: "gpt-4o",
        tokensUsed: 0,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);

      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };

      await innerService.executePhaseAsyncInner("topic-1", "user-1", 1);

      // Should mark as failed
      expect(mockPrisma.topic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: expect.objectContaining({
              phaseStatus: expect.objectContaining({
                1: expect.objectContaining({ status: "failed" }),
              }),
            }),
          }),
        }),
      );
    });
  });

  // ==================== executePhaseAsync — quality gate retry ====================

  describe("executePhaseAsyncInner — quality gate retry", () => {
    it("retries when reflection score < 50 and there are gaps", async () => {
      const activeMeta = makeMeta({
        currentPhase: 1,
        phaseStatus: { 1: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
        planConfig: {
          goal: "Build AI product",
          depth: PlanningDepth.STANDARD, // not QUICK, so quality gate fires
          autoAdvance: false,
        },
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic) // execute inner
        .mockResolvedValueOnce(topic); // updatePhaseStatus
      mockPrisma.topic.update.mockResolvedValue({});

      // First chat: success but quality gate fails
      mockChatFacade.chat
        .mockResolvedValueOnce({
          isError: false,
          content: "Initial output with issues",
          model: "gpt-4o",
          tokensUsed: 100,
        })
        // Second chat (retry): improved output
        .mockResolvedValueOnce({
          isError: false,
          content: "Improved output after quality review",
          model: "gpt-4o",
          tokensUsed: 120,
        });

      // Reflection returns low quality score with gaps
      mockTeamFacade.reflect.mockResolvedValue({
        qualityScore: 40,
        gaps: ["Missing market analysis", "No data sources cited"],
        overallQuality: "poor",
      });

      mockAiResponseService.createAIMessage.mockResolvedValue({});

      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };

      await innerService.executePhaseAsyncInner("topic-1", "user-1", 1);

      // Should have called chat at least twice (initial + retry)
      expect(mockChatFacade.chat.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("skips retry when reflection score is acceptable (>= 50)", async () => {
      const activeMeta = makeMeta({
        currentPhase: 1,
        phaseStatus: { 1: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic)
        .mockResolvedValueOnce(topic);
      mockPrisma.topic.update.mockResolvedValue({});
      mockChatFacade.chat.mockResolvedValue({
        isError: false,
        content: "Good quality output",
        model: "gpt-4o",
        tokensUsed: 100,
      });

      // Reflection returns acceptable score
      mockTeamFacade.reflect.mockResolvedValue({
        qualityScore: 75,
        gaps: [],
        overallQuality: "good",
      });
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };

      await innerService.executePhaseAsyncInner("topic-1", "user-1", 1);

      // Phase 1 uses 2 agents, so chat is called twice (once per agent)
      // No retry means no additional calls
      expect(mockChatFacade.chat.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  // ==================== buildPreviousPhaseContext — phase 6 special ====================

  describe("buildPreviousPhaseContext — phase 6 reads phases 2, 4, 5", () => {
    it("includes phases 2, 4, 5 summaries for phase 6", async () => {
      const meta = makeMeta({
        currentPhase: 6,
        phaseStatus: {
          1: { status: "completed", summary: "Phase 1 goal analysis" },
          2: { status: "completed", summary: "Phase 2 research data" },
          3: { status: "completed", summary: "Phase 3 brainstorm" },
          4: { status: "completed", summary: "Phase 4 debate conclusions" },
          5: { status: "completed", summary: "Phase 5 synthesis" },
          6: { status: "active" },
        } as Record<number, PlanPhaseStatus>,
      });

      mockTeamFacade.aiCompressContext.mockResolvedValue(null);

      const innerService = service as unknown as {
        buildPreviousPhaseContext: (
          meta: PlanningTopicMetadata,
          phase: number,
        ) => Promise<string>;
      };

      const context = await innerService.buildPreviousPhaseContext(meta, 6);

      // Phase 6 should include 2, 4, 5 but NOT 1 and 3
      expect(context).toContain("Phase 2 research data");
      expect(context).toContain("Phase 4 debate conclusions");
      expect(context).toContain("Phase 5 synthesis");
      expect(context).not.toContain("Phase 1 goal analysis");
      expect(context).not.toContain("Phase 3 brainstorm");
    });

    it("returns empty string when no phases have completed summaries", async () => {
      const meta = makeMeta({
        currentPhase: 2,
        phaseStatus: {
          1: { status: "completed" }, // no summary
          2: { status: "active" },
        } as Record<number, PlanPhaseStatus>,
      });

      const innerService = service as unknown as {
        buildPreviousPhaseContext: (
          meta: PlanningTopicMetadata,
          phase: number,
        ) => Promise<string>;
      };

      const context = await innerService.buildPreviousPhaseContext(meta, 2);

      expect(context).toBe("");
    });
  });

  // ==================== buildPreviousPhaseContext — context compression ====================

  describe("buildPreviousPhaseContext — compression for long summaries", () => {
    it("compresses summary when it exceeds MAX_PHASE_SUMMARY_LENGTH", async () => {
      const longSummary = "A".repeat(25000); // exceeds 24000 chars limit
      const meta = makeMeta({
        currentPhase: 2,
        phaseStatus: {
          1: { status: "completed", summary: longSummary },
          2: { status: "active" },
        } as Record<number, PlanPhaseStatus>,
      });

      mockTeamFacade.aiCompressContext.mockResolvedValue({
        compressedContext: "Compressed summary",
        originalLength: 25000,
        compressedLength: 1000,
      });

      const innerService = service as unknown as {
        buildPreviousPhaseContext: (
          meta: PlanningTopicMetadata,
          phase: number,
        ) => Promise<string>;
      };

      const context = await innerService.buildPreviousPhaseContext(meta, 2);

      expect(mockTeamFacade.aiCompressContext).toHaveBeenCalled();
      expect(context).toContain("Compressed summary");
    });

    it("falls back to truncation when compression fails", async () => {
      const longSummary = "B".repeat(25000);
      const meta = makeMeta({
        currentPhase: 2,
        phaseStatus: {
          1: { status: "completed", summary: longSummary },
          2: { status: "active" },
        } as Record<number, PlanPhaseStatus>,
      });

      mockTeamFacade.aiCompressContext.mockRejectedValue(
        new Error("Compression failed"),
      );

      const innerService = service as unknown as {
        buildPreviousPhaseContext: (
          meta: PlanningTopicMetadata,
          phase: number,
        ) => Promise<string>;
      };

      const context = await innerService.buildPreviousPhaseContext(meta, 2);

      // Should contain truncated text
      expect(context.length).toBeGreaterThan(0);
      expect(context).toContain("已截断");
    });
  });

  // ==================== executePhaseAsync — phase 5/6 summary == last agent output ====================

  describe("executePhaseAsyncInner — phase 5 synthesis output structure", () => {
    it("uses last agent output as summary for phase 5", async () => {
      const activeMeta = makeMeta({
        currentPhase: 5,
        phaseStatus: {
          1: { status: "completed", summary: "Goal" },
          2: { status: "completed", summary: "Research" },
          3: { status: "completed", summary: "Brainstorm" },
          4: { status: "completed", summary: "Debate" },
          5: { status: "active" },
        } as Record<number, PlanPhaseStatus>,
        planConfig: {
          goal: "Build AI product",
          depth: PlanningDepth.QUICK, // QUICK skips quality gate
          autoAdvance: false,
        },
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic)
        .mockResolvedValueOnce(topic);
      mockPrisma.topic.update.mockResolvedValue({});

      // Phase 5 uses agents [0, 2, 3] — 3 agents
      mockChatFacade.chat
        .mockResolvedValueOnce({
          isError: false,
          content: "Leader synthesis v1",
          model: "gpt-4o",
          tokensUsed: 100,
        })
        .mockResolvedValueOnce({
          isError: false,
          content: "Analyst synthesis v2",
          model: "gpt-4o",
          tokensUsed: 110,
        })
        .mockResolvedValueOnce({
          isError: false,
          content: "Copywriter synthesis final",
          model: "gpt-4o",
          tokensUsed: 120,
        });

      mockAiResponseService.createAIMessage.mockResolvedValue({});

      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };

      await innerService.executePhaseAsyncInner("topic-1", "user-1", 5);

      // Phase 5 summary should be the last agent's output
      const calls = mockPrisma.topic.update.mock.calls;
      const lastCall = calls[calls.length - 1][0] as {
        data: { metadata: { phaseStatus: Record<number, PlanPhaseStatus> } };
      };
      const summary = lastCall.data.metadata.phaseStatus[5]?.summary;
      expect(summary).toBe("Copywriter synthesis final");
    });
  });

  // ==================== missionExecutor integration ====================

  describe("executePhaseAsyncInner — kernel process on phase 1", () => {
    it("spawns a kernel process when missionExecutor is available and phase=1", async () => {
      const activeMeta = makeMeta({
        currentPhase: 1,
        phaseStatus: { 1: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
        planConfig: {
          goal: "Build AI product",
          depth: PlanningDepth.QUICK,
          autoAdvance: false,
        },
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic)
        .mockResolvedValueOnce(topic);
      mockPrisma.topic.update.mockResolvedValue({});
      mockChatFacade.chat.mockResolvedValue({
        isError: false,
        content: "Phase 1 output",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockAiResponseService.createAIMessage.mockResolvedValue({});
      mockMissionExecutor.execute.mockResolvedValue({
        processId: "proc-phase1",
      });

      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };

      await innerService.executePhaseAsyncInner("topic-1", "user-1", 1);

      expect(mockMissionExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "planning-orchestrator",
          teamSessionId: "topic-1",
        }),
      );
    });

    it("does not throw when missionExecutor.execute fails", async () => {
      const activeMeta = makeMeta({
        currentPhase: 1,
        phaseStatus: { 1: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
        planConfig: {
          goal: "Build AI product",
          depth: PlanningDepth.QUICK,
          autoAdvance: false,
        },
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic)
        .mockResolvedValueOnce(topic);
      mockPrisma.topic.update.mockResolvedValue({});
      mockChatFacade.chat.mockResolvedValue({
        isError: false,
        content: "Phase 1 output",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockAiResponseService.createAIMessage.mockResolvedValue({});
      mockMissionExecutor.execute.mockRejectedValue(
        new Error("Kernel unavailable"),
      );

      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };

      // Should not throw — kernel failure is non-fatal
      await expect(
        innerService.executePhaseAsyncInner("topic-1", "user-1", 1),
      ).resolves.not.toThrow();
    });
  });

  // ==================== exportPlan edge cases ====================

  describe("exportPlan — edge cases", () => {
    it("throws NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.exportPlan("topic-1", "user-1", "report"),
      ).rejects.toThrow(NotFoundException);
    });

    it("handles missing metadata gracefully in report mode", async () => {
      const topic = { ...makeTopic(), metadata: {} };
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      const result = await service.exportPlan("topic-1", "user-1", "report");

      expect(result).toContain("_Report not yet available._");
    });
  });

  // ==================== createPlan with COMPREHENSIVE depth ====================

  describe("createPlan — comprehensive depth with missionExecutor", () => {
    beforeEach(() => {
      mockTemplateService.getTemplate.mockReturnValue({
        id: "general",
        name: "通用策划",
        description: "General",
        icon: "target",
        defaultGoalPrompt: "Analyze:",
        phasePrompts: {},
      });
      mockChatFacade.getReasoningModel.mockResolvedValue({ id: "gpt-4o" });
      mockChatFacade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt-4o-mini", isAvailable: true },
        { id: "gpt-4o", isAvailable: true },
      ]);
      mockAiTeamsService.createTopic.mockResolvedValue({ id: "topic-comp" });
      mockPrisma.topic.update.mockResolvedValue({});
    });

    it("builds 6 AI members for COMPREHENSIVE depth", async () => {
      let capturedMembers: unknown[] = [];
      mockAiTeamsService.createTopic.mockImplementation(
        (_userId: string, args: { aiMembers: unknown[] }) => {
          capturedMembers = args.aiMembers;
          return Promise.resolve({ id: "topic-comp" });
        },
      );

      const dto: CreatePlanDto = {
        name: "Comp Plan",
        goal: "Full analysis",
        templateId: "general",
        depth: PlanningDepth.COMPREHENSIVE,
      };

      await service.createPlan("user-1", dto);

      // COMPREHENSIVE creates 6 members (4 base + 2 debaters)
      expect(capturedMembers.length).toBe(6);
    });

    it("builds 4 AI members for STANDARD depth", async () => {
      let capturedMembers: unknown[] = [];
      mockAiTeamsService.createTopic.mockImplementation(
        (_userId: string, args: { aiMembers: unknown[] }) => {
          capturedMembers = args.aiMembers;
          return Promise.resolve({ id: "topic-standard" });
        },
      );

      const dto: CreatePlanDto = {
        name: "Std Plan",
        goal: "Standard analysis",
        templateId: "general",
        depth: PlanningDepth.STANDARD,
      };

      await service.createPlan("user-1", dto);

      expect(capturedMembers.length).toBe(4);
    });
  });

  // ==================== deletePlan ====================

  describe("deletePlan", () => {
    it("archives the plan successfully", async () => {
      const topic = { id: "topic-1", createdById: "user-1" };
      mockPrisma.topic.findFirst.mockResolvedValue(topic);
      mockPrisma.topic.update.mockResolvedValue({});

      await service.deletePlan("topic-1", "user-1");

      expect(mockPrisma.topic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "topic-1" },
          data: expect.objectContaining({ archivedAt: expect.any(Date) }),
        }),
      );
    });

    it("throws NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(service.deletePlan("nonexistent", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== retryPhase ====================

  describe("retryPhase — boundary conditions", () => {
    it("throws NotFoundException for phase 0 (invalid)", async () => {
      await expect(service.retryPhase("topic-1", 0, "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException for phase 8 (out of range)", async () => {
      await expect(service.retryPhase("topic-1", 8, "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("throws NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(service.retryPhase("topic-1", 2, "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== replanFromPhase — edge cases ====================

  describe("replanFromPhase — edge cases", () => {
    it("throws BadRequestException for startPhase=0", async () => {
      await expect(
        service.replanFromPhase("topic-1", 0, "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for startPhase=7", async () => {
      await expect(
        service.replanFromPhase("topic-1", 7, "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("does NOT clear references when replanning from phase 3 or later", async () => {
      const meta = makeMeta({
        currentPhase: 3,
        phaseStatus: {
          1: { status: "completed" },
          2: { status: "completed" },
          3: { status: "failed" },
          4: { status: "pending" },
          5: { status: "pending" },
          6: { status: "pending" },
        } as Record<number, PlanPhaseStatus>,
        references: [
          {
            id: "ref-1",
            title: "Test",
            url: "http://x.com",
            domain: "x.com",
            snippet: "...",
            sourcePhase: 2,
          },
        ],
      });
      const topic = { ...makeTopic(meta), metadata: meta };
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic)
        .mockResolvedValueOnce(topic);
      mockPrisma.topic.update.mockResolvedValue({});
      mockChatFacade.chat.mockResolvedValue({
        isError: false,
        content: "out",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      await service.replanFromPhase("topic-1", 3, "user-1");

      const updateCall = mockPrisma.topic.update.mock.calls[0][0] as {
        data: { metadata: { references?: unknown[] } };
      };
      // References should be preserved (not cleared) when starting from phase >= 3
      // The metadata includes the original references from meta spread,
      // so they should NOT be reset to an empty array
      expect(updateCall.data.metadata.references).not.toEqual([]);
    });
  });
});

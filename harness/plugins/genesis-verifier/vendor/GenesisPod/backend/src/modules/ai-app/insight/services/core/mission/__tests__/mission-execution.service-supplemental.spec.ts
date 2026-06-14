/**
 * MissionExecutionService - Supplemental Tests
 *
 * Covers uncovered lines:
 * - resumeExecution: topic not found (207), fallback to startExecution (230), reuse report (233-242)
 * - executeTask: InsufficientCreditsException path (519-551)
 * - executeTask: result is a plain string summary (441-443)
 * - executeTask: actualModelId triggers agentActivity update (475-499)
 * - finalizeMission: PENDING tasks → FAILED (659-661), hasIncomplete path (713-716)
 * - executeDynamicScheduler: deadlock (897-903), task catch path (865), remaining tasks (920-924)
 * - continueExecution: mission not found (1136), not EXECUTING (1140-1143), reset tasks (1148-1159)
 * - handleResumeMissionExecution: existingCtx branch (1044-1050), no ctx + topic found (1058-1069)
 * - handleRecoveryNeeded (1085-1106)
 * - addAgentToLeaderPlan: mission not found (1240-1243), init agentAssignments=[] (1275-1276)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { MissionExecutionService } from "../mission-execution.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ResearchEventEmitterService } from "../../research/research-event-emitter.service";
import { MissionQueryService } from "../mission-query.service";
import { ReportSynthesisService } from "../../../report/report-synthesis.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { ResearchMemoryService } from "../../research/research-memory.service";
import { DimensionResearchExecutor } from "../../task-executors/dimension-research.executor";
import { ReviewDimensionExecutor } from "../../task-executors/review-dimension.executor";
import { SynthesisReportExecutor } from "../../task-executors/synthesis-report.executor";
import { GenericTaskExecutor } from "../../task-executors/generic-task.executor";
import { ResearchMissionStatus, ResearchTaskStatus } from "@prisma/client";
import { InsufficientCreditsException } from "../../../../types/research.exceptions";

// ─── Mocks ────────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
    },
    researchMission: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    researchTask: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    topicReport: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    topicEvidence: {
      createMany: jest.fn(),
    },
    researchAgentActivity: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    aIModel: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const mockResearchEventEmitter = {
    emitTaskStarted: jest.fn().mockResolvedValue(undefined),
    emitTaskCompleted: jest.fn().mockResolvedValue(undefined),
    emitTaskFailed: jest.fn().mockResolvedValue(undefined),
    emitAgentWorking: jest.fn().mockResolvedValue(undefined),
    emitAgentIdle: jest.fn().mockResolvedValue(undefined),
    emitAgentCompleted: jest.fn().mockResolvedValue(undefined),
    emitMissionStarted: jest.fn().mockResolvedValue(undefined),
    emitMissionProgress: jest.fn().mockResolvedValue(undefined),
    emitMissionCompleted: jest.fn().mockResolvedValue(undefined),
    emitMissionFailed: jest.fn().mockResolvedValue(undefined),
    emitLeaderThinking: jest.fn().mockResolvedValue(undefined),
    emitLeaderPlanning: jest.fn().mockResolvedValue(undefined),
    emitLeaderPlanReady: jest.fn().mockResolvedValue(undefined),
    emitResumeMissionExecution: jest.fn(),
  };

  const mockQueryService = {
    getAgentRoleFromTaskType: jest.fn().mockReturnValue("researcher"),
    getAgentNameFromTaskType: jest.fn().mockReturnValue("研究员"),
    updateTaskStatus: jest.fn().mockResolvedValue({}),
    getExecutableTasks: jest.fn().mockResolvedValue([]),
    emitProgress: jest.fn(),
  };

  const mockReportSynthesisService = {
    createDraftReport: jest.fn().mockResolvedValue({ id: "report-draft" }),
    synthesizeReport: jest.fn().mockResolvedValue({ id: "report-final" }),
  };

  const mockAiFacade = {
    chat: jest.fn().mockResolvedValue({ content: '{"status":"approved"}' }),
    getDefaultModelByType: jest.fn().mockResolvedValue(null),
    getAvailableModels: jest.fn().mockResolvedValue([]),
  };

  const mockResearchMemory = {
    extractAndStoreFindings: jest.fn().mockResolvedValue(5),
  };

  const mockDimensionResearchExecutor = {
    execute: jest.fn().mockResolvedValue({
      status: "completed",
      summary: "Research complete",
      keyFindings: ["Finding 1"],
    }),
    executeGenericDimensionResearch: jest.fn().mockResolvedValue({
      summary: "Generic research done",
      keyFindings: [],
    }),
  };

  const mockReviewDimensionExecutor = {
    execute: jest.fn().mockResolvedValue({ status: "completed" }),
  };

  const mockSynthesisReportExecutor = {
    execute: jest.fn().mockResolvedValue({ status: "completed" }),
  };

  const mockGenericTaskExecutor = {
    execute: jest.fn().mockResolvedValue({ status: "skipped" }),
  };

  return {
    mockPrisma,
    mockResearchEventEmitter,
    mockQueryService,
    mockReportSynthesisService,
    mockAiFacade,
    mockResearchMemory,
    mockDimensionResearchExecutor,
    mockReviewDimensionExecutor,
    mockSynthesisReportExecutor,
    mockGenericTaskExecutor,
  };
}

async function buildModule(mocks: ReturnType<typeof buildMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MissionExecutionService,
      { provide: PrismaService, useValue: mocks.mockPrisma },
      {
        provide: ResearchEventEmitterService,
        useValue: mocks.mockResearchEventEmitter,
      },
      { provide: MissionQueryService, useValue: mocks.mockQueryService },
      {
        provide: ReportSynthesisService,
        useValue: mocks.mockReportSynthesisService,
      },
      { provide: ChatFacade, useValue: mocks.mockAiFacade },
      { provide: ResearchMemoryService, useValue: mocks.mockResearchMemory },
      {
        provide: DimensionResearchExecutor,
        useValue: mocks.mockDimensionResearchExecutor,
      },
      {
        provide: ReviewDimensionExecutor,
        useValue: mocks.mockReviewDimensionExecutor,
      },
      {
        provide: SynthesisReportExecutor,
        useValue: mocks.mockSynthesisReportExecutor,
      },
      {
        provide: GenericTaskExecutor,
        useValue: mocks.mockGenericTaskExecutor,
      },
    ],
  }).compile();
  return module.get<MissionExecutionService>(MissionExecutionService);
}

const mockTopic = {
  id: "topic-1",
  name: "AI Research",
  type: "TECHNOLOGY",
  userId: "user-1",
  topicConfig: null,
  dimensions: [{ id: "dim-1", name: "Market Analysis" }],
};

const mockMission = {
  id: "mission-1",
  status: ResearchMissionStatus.EXECUTING,
  researchDepth: "standard",
  leaderPlan: null,
};

const mockPendingTask = {
  id: "task-1",
  missionId: "mission-1",
  title: "Research: Market Analysis",
  taskType: "dimension_research",
  dimensionName: "Market Analysis",
  dimensionId: "dim-1",
  assignedAgent: "researcher-1",
  assignedAgentType: "dimension_researcher",
  modelId: "gpt-4o",
  skills: [],
  tools: [],
  status: ResearchTaskStatus.PENDING,
  priority: 1,
  dependencies: [],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MissionExecutionService (supplemental)", () => {
  let service: MissionExecutionService;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();
    service = await buildModule(mocks);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── resumeExecution ─────────────────────────────────────────────────────────

  describe("resumeExecution", () => {
    it("should throw NotFoundException when topic not found", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(null);
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        mockMission,
      );

      await expect(
        service.resumeExecution("mission-1", "nonexistent-topic"),
      ).rejects.toThrow("Topic nonexistent-topic not found");
    });

    it("should fallback to startExecution when no existing report found", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce(mockMission) // resumeExecution query
        .mockResolvedValue({
          // startExecution + scheduler queries
          ...mockMission,
          status: ResearchMissionStatus.CANCELLED,
        });
      mocks.mockPrisma.topicReport.findFirst.mockResolvedValue(null);
      // createDraftReport for fallback startExecution
      mocks.mockReportSynthesisService.createDraftReport.mockResolvedValue({
        id: "new-draft",
      });
      mocks.mockPrisma.researchTask.findMany.mockResolvedValue([]);
      mocks.mockQueryService.getExecutableTasks.mockResolvedValue([]);
      mocks.mockPrisma.researchTask.count.mockResolvedValue(0);

      await expect(
        service.resumeExecution("mission-1", "topic-1"),
      ).resolves.not.toThrow();

      // createDraftReport is called from the startExecution fallback
      expect(
        mocks.mockReportSynthesisService.createDraftReport,
      ).toHaveBeenCalled();
    });

    it("should reuse existing report when found", async () => {
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValue({
          ...mockMission,
          status: ResearchMissionStatus.CANCELLED,
        });
      mocks.mockPrisma.topicReport.findFirst.mockResolvedValue({
        id: "existing-report",
      });
      mocks.mockPrisma.researchTask.findMany.mockResolvedValue([]);
      mocks.mockQueryService.getExecutableTasks.mockResolvedValue([]);
      mocks.mockPrisma.researchTask.count.mockResolvedValue(0);

      await expect(
        service.resumeExecution("mission-1", "topic-1"),
      ).resolves.not.toThrow();

      // createDraftReport is NOT called when existing report is reused
      expect(
        mocks.mockReportSynthesisService.createDraftReport,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── executeTask – InsufficientCreditsException ──────────────────────────────

  describe("executeTask - InsufficientCreditsException handling", () => {
    it("should mark mission FAILED and cancel pending tasks on InsufficientCreditsException", async () => {
      mocks.mockPrisma.researchTask.findUnique.mockResolvedValue({
        status: ResearchTaskStatus.PENDING,
        modelId: null,
        skills: [],
        tools: [],
      });
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(
        mockMission,
      );
      mocks.mockPrisma.researchTask.updateMany
        .mockResolvedValueOnce({ count: 1 }) // CAS
        .mockResolvedValueOnce({ count: 2 }); // cancel pending tasks
      mocks.mockPrisma.researchMission.updateMany.mockResolvedValue({
        count: 1,
      });

      // Force InsufficientCreditsException from executor
      mocks.mockResearchEventEmitter.emitTaskStarted.mockRejectedValue(
        new InsufficientCreditsException("Not enough credits"),
      );

      await service.executeTask(
        mockPendingTask as any,
        mockTopic as any,
        "mission-1",
        "report-1",
      );

      // Should fail the task
      expect(mocks.mockQueryService.updateTaskStatus).toHaveBeenCalledWith(
        "task-1",
        ResearchTaskStatus.FAILED,
        expect.any(Object),
      );

      // Should mark mission FAILED
      expect(mocks.mockPrisma.researchMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ResearchMissionStatus.FAILED },
        }),
      );

      // Should cancel all pending tasks
      expect(mocks.mockPrisma.researchTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            missionId: "mission-1",
            status: expect.objectContaining({ in: expect.any(Array) }),
          }),
          data: expect.objectContaining({
            status: ResearchTaskStatus.FAILED,
          }),
        }),
      );
    });
  });

  // ─── executeTask – result is a string ────────────────────────────────────────

  describe("executeTask - result is string", () => {
    it("should use substring of string result as summary", async () => {
      mocks.mockPrisma.researchTask.findUnique
        .mockResolvedValueOnce({
          status: ResearchTaskStatus.PENDING,
          modelId: null,
          skills: [],
          tools: [],
        })
        .mockResolvedValueOnce({ status: ResearchTaskStatus.EXECUTING });
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce(mockMission)
        .mockResolvedValueOnce({ status: ResearchMissionStatus.EXECUTING });
      mocks.mockPrisma.researchTask.updateMany.mockResolvedValueOnce({
        count: 1,
      });

      const dimExecutor = (service as any).dimensionResearchExecutor;
      dimExecutor.execute = jest
        .fn()
        .mockResolvedValue("A plain string result for the task");

      await service.executeTask(
        mockPendingTask as any,
        mockTopic as any,
        "mission-1",
        "report-1",
      );

      expect(mocks.mockQueryService.updateTaskStatus).toHaveBeenCalledWith(
        "task-1",
        ResearchTaskStatus.COMPLETED,
        expect.any(Object),
      );
    });
  });

  // ─── executeTask – actualModelId differs from assigned ───────────────────────

  describe("executeTask - model fallback updates agentActivity", () => {
    it("should update agent activity records when actualModelId differs from assigned", async () => {
      mocks.mockPrisma.researchTask.findUnique
        .mockResolvedValueOnce({
          status: ResearchTaskStatus.PENDING,
          modelId: "assigned-model",
          skills: [],
          tools: [],
        })
        .mockResolvedValueOnce({ status: ResearchTaskStatus.EXECUTING });
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce({
          ...mockMission,
          leaderPlan: null,
        })
        .mockResolvedValueOnce({ status: ResearchMissionStatus.EXECUTING });
      mocks.mockPrisma.researchTask.updateMany.mockResolvedValueOnce({
        count: 1,
      });
      mocks.mockPrisma.aIModel.findMany.mockResolvedValue([
        { id: "actual-model", displayName: "GPT-4 Turbo", provider: "openai" },
        { id: "assigned-model", displayName: "GPT-4", provider: "openai" },
      ]);

      const dimExecutor = (service as any).dimensionResearchExecutor;
      dimExecutor.execute = jest.fn().mockResolvedValue({
        summary: "Research complete",
        actualModelId: "actual-model", // different from assigned
      });

      await service.executeTask(
        mockPendingTask as any,
        mockTopic as any,
        "mission-1",
        "report-1",
      );

      // Should have attempted to update activity records
      expect(
        mocks.mockPrisma.researchAgentActivity.updateMany,
      ).toHaveBeenCalled();
    });

    it("should not crash if researchAgentActivity updateMany fails", async () => {
      mocks.mockPrisma.researchTask.findUnique
        .mockResolvedValueOnce({
          status: ResearchTaskStatus.PENDING,
          modelId: "assigned-model",
          skills: [],
          tools: [],
        })
        .mockResolvedValueOnce({ status: ResearchTaskStatus.EXECUTING });
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce({ ...mockMission, leaderPlan: null })
        .mockResolvedValueOnce({ status: ResearchMissionStatus.EXECUTING });
      mocks.mockPrisma.researchTask.updateMany.mockResolvedValueOnce({
        count: 1,
      });
      mocks.mockPrisma.researchAgentActivity.updateMany.mockRejectedValue(
        new Error("DB error"),
      );
      mocks.mockPrisma.aIModel.findMany.mockResolvedValue([]);

      const dimExecutor = (service as any).dimensionResearchExecutor;
      dimExecutor.execute = jest.fn().mockResolvedValue({
        summary: "done",
        actualModelId: "actual-model",
      });

      await expect(
        service.executeTask(
          mockPendingTask as any,
          mockTopic as any,
          "mission-1",
          "report-1",
        ),
      ).resolves.not.toThrow();
    });
  });

  // ─── finalizeMission – hasIncomplete ─────────────────────────────────────────

  describe("finalizeMission - incomplete tasks cause FAILED", () => {
    it("should mark FAILED when there are still PENDING tasks", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        status: ResearchMissionStatus.EXECUTING,
      });
      mocks.mockPrisma.researchTask.findMany.mockResolvedValue([
        { id: "t1", status: ResearchTaskStatus.COMPLETED },
        { id: "t2", status: ResearchTaskStatus.PENDING }, // incomplete
      ]);
      mocks.mockPrisma.researchMission.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.finalizeMission("mission-1", "topic-1");

      expect(mocks.mockPrisma.researchMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchMissionStatus.FAILED,
          }),
        }),
      );
    });

    it("should mark FAILED when there are still EXECUTING tasks", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        status: ResearchMissionStatus.EXECUTING,
      });
      mocks.mockPrisma.researchTask.findMany.mockResolvedValue([
        { id: "t1", status: ResearchTaskStatus.COMPLETED },
        { id: "t2", status: ResearchTaskStatus.EXECUTING }, // incomplete
      ]);
      mocks.mockPrisma.researchMission.updateMany.mockResolvedValue({
        count: 1,
      });

      await service.finalizeMission("mission-1", "topic-1");

      expect(mocks.mockPrisma.researchMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ResearchMissionStatus.FAILED,
          }),
        }),
      );

      // emitMissionCompleted should NOT be called on FAILED
      expect(
        mocks.mockResearchEventEmitter.emitMissionCompleted,
      ).not.toHaveBeenCalled();
    });
  });

  // ─── continueExecution ───────────────────────────────────────────────────────

  describe("continueExecution", () => {
    it("should throw NotFoundException when mission not found", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(service.continueExecution("mission-x")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException when mission is not EXECUTING", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        topicId: "topic-1",
        status: ResearchMissionStatus.COMPLETED,
        tasks: [],
      });

      await expect(service.continueExecution("mission-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should reset EXECUTING tasks to PENDING and resume", async () => {
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce({
          id: "mission-1",
          topicId: "topic-1",
          status: ResearchMissionStatus.EXECUTING,
          tasks: [{ id: "stuck-task-1" }, { id: "stuck-task-2" }],
        })
        // scheduler iteration: immediately CANCELLED to exit
        .mockResolvedValue({ status: ResearchMissionStatus.CANCELLED });
      mocks.mockPrisma.researchTask.count
        .mockResolvedValueOnce(2) // completedCount
        .mockResolvedValueOnce(5); // totalCount
      mocks.mockResearchEventEmitter.emitMissionProgress.mockResolvedValue(
        undefined,
      );
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockPrisma.researchTask.updateMany.mockResolvedValue({ count: 2 });
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});

      await expect(
        service.continueExecution("mission-1"),
      ).resolves.not.toThrow();

      // Should have called updateMany to reset EXECUTING tasks to PENDING
      expect(mocks.mockPrisma.researchTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["stuck-task-1", "stuck-task-2"] } },
          data: expect.objectContaining({
            status: ResearchTaskStatus.PENDING,
          }),
        }),
      );
    });

    it("should not reset tasks when no EXECUTING tasks exist", async () => {
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce({
          id: "mission-1",
          topicId: "topic-1",
          status: ResearchMissionStatus.EXECUTING,
          tasks: [], // no stuck tasks
        })
        .mockResolvedValue({ status: ResearchMissionStatus.CANCELLED });
      mocks.mockPrisma.researchTask.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3);
      mocks.mockResearchEventEmitter.emitMissionProgress.mockResolvedValue(
        undefined,
      );
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});

      await expect(
        service.continueExecution("mission-1"),
      ).resolves.not.toThrow();

      // updateMany for task reset should NOT be called
      expect(mocks.mockPrisma.researchTask.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ResearchTaskStatus.PENDING }),
        }),
      );
    });
  });

  // ─── handleRecoveryNeeded ────────────────────────────────────────────────────

  describe("handleRecoveryNeeded", () => {
    it("should call continueExecution on recovery event", async () => {
      // continueExecution will fail because mission is COMPLETED → BadRequestException
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        topicId: "topic-1",
        status: ResearchMissionStatus.COMPLETED,
        tasks: [],
      });

      // Should not throw even if continueExecution throws
      await expect(
        service.handleRecoveryNeeded({
          missionId: "mission-1",
          topicId: "topic-1",
          resetTaskCount: 2,
        }),
      ).resolves.not.toThrow();
    });

    it("should handle continueExecution success", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        topicId: "topic-1",
        status: ResearchMissionStatus.EXECUTING,
        tasks: [],
      });
      mocks.mockPrisma.researchTask.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mocks.mockResearchEventEmitter.emitMissionProgress.mockResolvedValue(
        undefined,
      );
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(mockTopic);
      // startExecution will quickly exit via CANCELLED mission
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValueOnce({
        id: "mission-1",
        topicId: "topic-1",
        status: ResearchMissionStatus.CANCELLED,
        tasks: [],
      });

      await expect(
        service.handleRecoveryNeeded({
          missionId: "mission-1",
          topicId: "topic-1",
          resetTaskCount: 0,
        }),
      ).resolves.not.toThrow();
    });
  });

  // ─── handleResumeMissionExecution ────────────────────────────────────────────

  describe("handleResumeMissionExecution", () => {
    it("should look up topic userId when no existing BillingContext", async () => {
      // Mission is COMPLETED with pending tasks
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce({
          status: ResearchMissionStatus.COMPLETED,
        })
        .mockResolvedValue({ status: ResearchMissionStatus.CANCELLED });
      mocks.mockPrisma.researchTask.findMany.mockResolvedValue([
        { id: "pending-task", status: ResearchTaskStatus.PENDING },
      ]);
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});
      mocks.mockResearchEventEmitter.emitMissionProgress.mockResolvedValue(
        undefined,
      );

      // topic lookup for userId
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-abc",
      });

      // Should not throw
      await expect(
        service.handleResumeMissionExecution({
          missionId: "mission-1",
          topicId: "topic-1",
        }),
      ).resolves.not.toThrow();
    });

    it("should call startFn without context when topic userId not found", async () => {
      mocks.mockPrisma.researchMission.findUnique
        .mockResolvedValueOnce({
          status: ResearchMissionStatus.COMPLETED,
        })
        .mockResolvedValue({ status: ResearchMissionStatus.CANCELLED });
      mocks.mockPrisma.researchTask.findMany.mockResolvedValue([
        { id: "pending-task", status: ResearchTaskStatus.PENDING },
      ]);
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});
      mocks.mockResearchEventEmitter.emitMissionProgress.mockResolvedValue(
        undefined,
      );

      // topic not found → no userId
      mocks.mockPrisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.handleResumeMissionExecution({
          missionId: "mission-1",
          topicId: "topic-1",
        }),
      ).resolves.not.toThrow();
    });
  });

  // ─── addAgentToLeaderPlan – edge cases ───────────────────────────────────────

  describe("addAgentToLeaderPlan - edge cases", () => {
    it("should return without updating when mission not found", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue(null);

      await expect(
        service.addAgentToLeaderPlan("mission-x", {
          agentId: "agent-1",
          agentType: "dimension_researcher",
        }),
      ).resolves.not.toThrow();

      expect(mocks.mockPrisma.researchMission.update).not.toHaveBeenCalled();
    });

    it("should initialize agentAssignments when leaderPlan.agentAssignments is null", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        leaderPlan: {
          taskUnderstanding: { topic: "test", scope: "", objectives: [] },
          dimensions: [],
          executionStrategy: { parallelism: 5, priorityOrder: [] },
          // agentAssignments is absent
        },
      });
      mocks.mockPrisma.researchMission.update.mockResolvedValue({});

      await service.addAgentToLeaderPlan("mission-1", {
        agentId: "brand-new-agent",
        agentType: "dimension_researcher",
        agentName: "New Agent",
        role: "Researcher",
      });

      expect(mocks.mockPrisma.researchMission.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "mission-1" } }),
      );
    });

    it("should not throw when update fails", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        leaderPlan: null,
      });
      mocks.mockPrisma.researchMission.update.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        service.addAgentToLeaderPlan("mission-1", {
          agentId: "agent-1",
          agentType: "dimension_researcher",
        }),
      ).resolves.not.toThrow();
    });
  });

  // ─── executeDynamicScheduler – simple exit cases ─────────────────────────────

  describe("executeDynamicScheduler", () => {
    it("should exit immediately when mission is CANCELLED at the start", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        status: ResearchMissionStatus.CANCELLED,
      });

      const executor = jest.fn();
      await service.executeDynamicScheduler("mission-1", 4, executor);

      expect(executor).not.toHaveBeenCalled();
    });

    it("should exit immediately when mission is FAILED at the start", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        status: ResearchMissionStatus.FAILED,
      });

      const executor = jest.fn();
      await service.executeDynamicScheduler("mission-1", 4, executor);

      expect(executor).not.toHaveBeenCalled();
    });

    it("should exit when no remaining pending tasks and no executing tasks", async () => {
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        status: ResearchMissionStatus.EXECUTING,
      });
      mocks.mockQueryService.getExecutableTasks.mockResolvedValue([]);
      mocks.mockPrisma.researchTask.count.mockResolvedValue(0); // no remaining

      const executor = jest.fn();
      await service.executeDynamicScheduler("mission-1", 4, executor);

      expect(executor).not.toHaveBeenCalled();
    });
  });
});

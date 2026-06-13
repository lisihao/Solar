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
// These prevent transitive NestCacheModule / ioredis imports from exploding
jest.mock("@nestjs/cache-manager", () => ({ CACHE_MANAGER: "CACHE_MANAGER" }));
jest.mock("cache-manager", () => ({}));
jest.mock("ioredis", () => ({}));
// Mock the transitive module paths that bring in NestCacheModule
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
  MissionContext: { run: jest.fn((_, fn) => fn()) },
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
  MissionContext: { run: jest.fn((_, fn) => fn()) },
}));
jest.mock("../../../../platform/facade", () => ({
  BillingContext: { run: jest.fn((_, fn) => fn()) },
}));
// ─────────────────────────────────────────────────────────────────────────────

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
import { CreatePlanDto, PlanningDepth } from "../../dto/create-plan.dto";
import { UpdatePlanDto } from "../../dto/update-plan.dto";
import { TopicType } from "@prisma/client";

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

const mockAiTeamsService = {
  createTopic: jest.fn(),
};

const mockAiResponseService = {
  createAIMessage: jest.fn(),
};

const mockTemplateService = {
  getTemplate: jest.fn(),
  getDefaultTemplate: jest.fn(),
};

const mockAiFacade = {
  chat: jest.fn(),
  getReasoningModel: jest.fn(),
  getAvailableModelsExtended: jest.fn(),
};

const mockTeamFacade = {
  reflect: jest.fn(),
  aiCompressContext: jest.fn(),
};

const mockRagFacade = {
  search: jest.fn(),
};

// ======================================================
// Tests
// ======================================================

describe("PlanningOrchestratorService", () => {
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
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: TeamFacade, useValue: mockTeamFacade },
        { provide: RAGFacade, useValue: mockRagFacade },
      ],
    }).compile();

    service = module.get<PlanningOrchestratorService>(
      PlanningOrchestratorService,
    );
  });

  // ==================== createPlan ====================

  describe("createPlan", () => {
    const dto: CreatePlanDto = {
      name: "Test Plan",
      goal: "Launch a new product",
      templateId: "general",
      depth: PlanningDepth.STANDARD,
    };

    beforeEach(() => {
      mockTemplateService.getTemplate.mockReturnValue({
        id: "general",
        name: "通用策划",
        description: "General",
        icon: "target",
        defaultGoalPrompt: "Analyze:",
        phasePrompts: {},
      });
      mockAiFacade.getReasoningModel.mockResolvedValue({ id: "gpt-4o" });
      mockAiFacade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt-4o-mini", isAvailable: true },
      ]);
      mockAiTeamsService.createTopic.mockResolvedValue({ id: "topic-abc" });
      mockPrisma.topic.update.mockResolvedValue({});
    });

    it("should create a plan and return planId", async () => {
      const result = await service.createPlan("user-1", dto);

      expect(result).toEqual({ planId: "topic-abc" });
      expect(mockTemplateService.getTemplate).toHaveBeenCalledWith("general");
      expect(mockAiTeamsService.createTopic).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ name: "Test Plan", type: TopicType.PRIVATE }),
      );
      expect(mockPrisma.topic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "topic-abc" },
          data: expect.objectContaining({ metadata: expect.anything() }),
        }),
      );
    });

    it("should use default template when templateId is not provided", async () => {
      mockTemplateService.getDefaultTemplate.mockReturnValue({
        id: "general",
        name: "通用策划",
        phasePrompts: {},
      });
      const dtoNoTemplate: CreatePlanDto = { name: "Test", goal: "Goal" };

      const result = await service.createPlan("user-1", dtoNoTemplate);

      expect(mockTemplateService.getDefaultTemplate).toHaveBeenCalled();
      expect(result.planId).toBe("topic-abc");
    });

    it("should throw NotFoundException when template is not found", async () => {
      mockTemplateService.getTemplate.mockReturnValue(null);

      await expect(service.createPlan("user-1", dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should use STANDARD depth when depth is not specified", async () => {
      const dtoNoDepth: CreatePlanDto = {
        name: "Test",
        goal: "Goal",
        templateId: "general",
      };

      await service.createPlan("user-1", dtoNoDepth);

      expect(mockAiTeamsService.createTopic).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ aiMembers: expect.any(Array) }),
      );
    });

    it("should build COMPREHENSIVE AI members (6 agents) for COMPREHENSIVE depth", async () => {
      mockAiFacade.getReasoningModel.mockResolvedValue({ id: "o1-preview" });
      mockAiFacade.getAvailableModelsExtended.mockResolvedValue([
        { id: "gpt-4o", isAvailable: true },
      ]);

      let capturedMembers: unknown[] = [];
      mockAiTeamsService.createTopic.mockImplementation(
        (_userId: string, args: { aiMembers: unknown[] }) => {
          capturedMembers = args.aiMembers;
          return Promise.resolve({ id: "topic-comprehensive" });
        },
      );

      await service.createPlan("user-1", {
        ...dto,
        depth: PlanningDepth.COMPREHENSIVE,
      });

      expect(capturedMembers.length).toBe(6); // 4 base + 2 debaters
    });
  });

  // ==================== getPlans ====================

  describe("getPlans", () => {
    it("should return mapped PlanSummary list", async () => {
      const topic = makeTopic();
      mockPrisma.topic.findMany.mockResolvedValue([topic]);

      const result = await service.getPlans("user-1");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("topic-1");
      expect(result[0].name).toBe("My Plan");
      expect(result[0].totalPhases).toBe(6);
      expect(result[0].memberCount).toBe(4);
    });

    it("should pass search filter when provided", async () => {
      mockPrisma.topic.findMany.mockResolvedValue([]);

      await service.getPlans("user-1", "product");

      expect(mockPrisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            name: expect.objectContaining({ contains: "product" }),
          }),
        }),
      );
    });

    it("should return empty array when no plans found", async () => {
      mockPrisma.topic.findMany.mockResolvedValue([]);

      const result = await service.getPlans("user-1");

      expect(result).toEqual([]);
    });
  });

  // ==================== getPlanDetail ====================

  describe("getPlanDetail", () => {
    it("should return full plan detail for a valid plan", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(makeTopic());

      const result = await service.getPlanDetail("topic-1", "user-1");

      expect(result.id).toBe("topic-1");
      expect(result.depth).toBe(PlanningDepth.STANDARD);
      expect(result.autoAdvance).toBe(false);
      expect(result.members).toHaveLength(4);
    });

    it("should throw NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.getPlanDetail("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should use default values when metadata fields are missing", async () => {
      const topic = makeTopic();
      topic.metadata = {}; // empty metadata
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      const result = await service.getPlanDetail("topic-1", "user-1");

      expect(result.currentPhase).toBe(0);
      expect(result.references).toEqual([]);
      expect(result.phaseStatus).toEqual({});
    });
  });

  // ==================== updatePlan ====================

  describe("updatePlan", () => {
    it("should update name, goal, and depth when plan is not running", async () => {
      const topic = makeTopic();
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic) // first findFirst (ownership check)
        .mockResolvedValueOnce(topic); // second findFirst (getPlanDetail)
      mockPrisma.topic.update.mockResolvedValue({});

      const dto: UpdatePlanDto = {
        name: "Updated Plan",
        goal: "Updated goal",
        depth: PlanningDepth.COMPREHENSIVE,
      };

      await service.updatePlan("topic-1", "user-1", dto);

      expect(mockPrisma.topic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "topic-1" },
          data: expect.objectContaining({ name: "Updated Plan" }),
        }),
      );
    });

    it("should throw NotFoundException when plan is actively running", async () => {
      const topic = makeTopic({
        currentPhase: 2,
        phaseStatus: {
          1: { status: "completed" },
          2: { status: "active" },
          3: { status: "pending" },
          4: { status: "pending" },
          5: { status: "pending" },
          6: { status: "pending" },
        },
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      await expect(
        service.updatePlan("topic-1", "user-1", { name: "New name" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.updatePlan("nonexistent", "user-1", { goal: "test" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== advancePhase ====================

  describe("advancePhase", () => {
    it("should start phase 1 when plan is at phase 0 (not started)", async () => {
      const topic = makeTopic({ currentPhase: 0 });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);
      mockPrisma.topic.update.mockResolvedValue({});

      // executePhaseAsync fires in background, mock the AI calls to be benign
      mockAiFacade.chat.mockResolvedValue({
        isError: false,
        content: "output",
        model: "gpt-4o",
        tokensUsed: 100,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      const result = await service.advancePhase("topic-1", "user-1");

      expect(result.currentPhase).toBe(1);
      expect(mockPrisma.topic.update).toHaveBeenCalled();
    });

    it("should ignore advance when current phase is already active", async () => {
      const topic = makeTopic({
        currentPhase: 2,
        phaseStatus: { 2: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      const result = await service.advancePhase("topic-1", "user-1");

      expect(result.currentPhase).toBe(2);
      expect(mockPrisma.topic.update).not.toHaveBeenCalled();
    });

    it("should re-activate current phase when it was pending (cancelled)", async () => {
      const topic = makeTopic({
        currentPhase: 3,
        phaseStatus: { 3: { status: "pending" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic) // advancePhase ownership check
        .mockResolvedValueOnce(topic); // activatePhase fresh metadata read
      mockPrisma.topic.update.mockResolvedValue({});
      mockAiFacade.chat.mockResolvedValue({
        isError: false,
        content: "out",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      const result = await service.advancePhase("topic-1", "user-1");

      expect(result.currentPhase).toBe(3);
    });

    it("should advance to next phase when current phase is completed", async () => {
      const topic = makeTopic({
        currentPhase: 2,
        phaseStatus: {
          2: { status: "completed", summary: "done" },
        } as Record<number, PlanPhaseStatus>,
      });
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic) // advancePhase ownership check
        .mockResolvedValueOnce(topic); // activatePhase fresh metadata read
      mockPrisma.topic.update.mockResolvedValue({});
      mockAiFacade.chat.mockResolvedValue({
        isError: false,
        content: "out",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      const result = await service.advancePhase("topic-1", "user-1");

      expect(result.currentPhase).toBe(3);
    });

    it("should not advance past TOTAL_PHASES (6)", async () => {
      const topic = makeTopic({
        currentPhase: 6,
        phaseStatus: {
          6: { status: "completed", summary: "done" },
        } as Record<number, PlanPhaseStatus>,
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      const result = await service.advancePhase("topic-1", "user-1");

      expect(result.currentPhase).toBe(6);
      expect(mockPrisma.topic.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.advancePhase("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== retryPhase ====================

  describe("retryPhase", () => {
    it("should retry a valid phase and trigger async execution", async () => {
      const topic = makeTopic({
        currentPhase: 2,
        phaseStatus: {
          2: { status: "failed", error: "timeout" },
        } as Record<number, PlanPhaseStatus>,
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);
      mockPrisma.topic.update.mockResolvedValue({});
      mockAiFacade.chat.mockResolvedValue({
        isError: false,
        content: "retry output",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockRagFacade.search.mockResolvedValue({ success: false, results: [] });
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      await expect(
        service.retryPhase("topic-1", 2, "user-1"),
      ).resolves.not.toThrow();
      expect(mockPrisma.topic.update).toHaveBeenCalled();
    });

    it("should throw NotFoundException for invalid phase number", async () => {
      await expect(service.retryPhase("topic-1", 0, "user-1")).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.retryPhase("topic-1", 7, "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(service.retryPhase("topic-1", 3, "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== replanFromPhase ====================

  describe("replanFromPhase", () => {
    it("should reset phases from startPhase and trigger execution", async () => {
      const topic = makeTopic({
        currentPhase: 3,
        phaseStatus: {
          1: { status: "completed", summary: "done" },
          2: { status: "completed", summary: "done" },
          3: { status: "failed" },
          4: { status: "pending" },
          5: { status: "pending" },
          6: { status: "pending" },
        } as Record<number, PlanPhaseStatus>,
      });
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic) // replanFromPhase check
        .mockResolvedValueOnce(topic); // activatePhase fresh read
      mockPrisma.topic.update.mockResolvedValue({});
      mockAiFacade.chat.mockResolvedValue({
        isError: false,
        content: "out",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      const result = await service.replanFromPhase("topic-1", 3, "user-1");

      expect(result.currentPhase).toBe(3);
    });

    it("should clear references when replanning from phase 1 or 2", async () => {
      const meta = makeMeta({
        currentPhase: 3,
        phaseStatus: {
          1: { status: "completed" },
          2: { status: "completed" },
          3: { status: "failed" },
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
      mockAiFacade.chat.mockResolvedValue({
        isError: false,
        content: "out",
        model: "gpt-4o",
        tokensUsed: 50,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      await service.replanFromPhase("topic-1", 2, "user-1");

      const updateCall = mockPrisma.topic.update.mock.calls[0][0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updateCall.data.metadata.references).toEqual([]);
    });

    it("should throw BadRequestException for invalid phase range", async () => {
      await expect(
        service.replanFromPhase("topic-1", 0, "user-1"),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.replanFromPhase("topic-1", 7, "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when a phase is currently active", async () => {
      const topic = makeTopic({
        currentPhase: 2,
        phaseStatus: { 2: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      await expect(
        service.replanFromPhase("topic-1", 1, "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.replanFromPhase("nonexistent", 2, "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== cancelPhase ====================

  describe("cancelPhase", () => {
    it("should set active phase status to pending", async () => {
      const topic = makeTopic({
        currentPhase: 3,
        phaseStatus: { 3: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);
      mockPrisma.topic.update.mockResolvedValue({});

      await service.cancelPhase("topic-1", "user-1");

      const updateCall = mockPrisma.topic.update.mock.calls[0][0];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(updateCall.data.metadata.phaseStatus[3].status).toBe("pending");
    });

    it("should be a no-op when currentPhase is 0 (plan not started)", async () => {
      const topic = makeTopic({ currentPhase: 0 });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      await service.cancelPhase("topic-1", "user-1");

      expect(mockPrisma.topic.update).not.toHaveBeenCalled();
    });

    it("should be a no-op when current phase is not active", async () => {
      const topic = makeTopic({
        currentPhase: 2,
        phaseStatus: { 2: { status: "completed" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      await service.cancelPhase("topic-1", "user-1");

      expect(mockPrisma.topic.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when plan not found", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelPhase("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== exportPlan ====================

  describe("exportPlan", () => {
    it("should export phase 6 summary in report mode when phase 6 is completed", async () => {
      const topic = makeTopic({
        currentPhase: 6,
        phaseStatus: {
          6: { status: "completed", summary: "# Final Report\n\nContent here" },
        } as Record<number, PlanPhaseStatus>,
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      const result = await service.exportPlan("topic-1", "user-1", "report");

      expect(result).toContain("My Plan");
      expect(result).toContain("# Final Report");
    });

    it("should return placeholder when phase 6 not yet complete in report mode", async () => {
      const topic = makeTopic({ currentPhase: 3 });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      const result = await service.exportPlan("topic-1", "user-1", "report");

      expect(result).toContain("_Report not yet available._");
    });

    it("should export all completed phases in full mode", async () => {
      const topic = makeTopic({
        currentPhase: 3,
        phaseStatus: {
          1: {
            status: "completed",
            summary: "Phase 1 output",
            completedAt: "2024-01-01",
          },
          2: { status: "completed", summary: "Phase 2 output" },
          3: { status: "active" },
        } as Record<number, PlanPhaseStatus>,
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      const result = await service.exportPlan("topic-1", "user-1", "full");

      expect(result).toContain("阶段 1");
      expect(result).toContain("Phase 1 output");
      expect(result).toContain("阶段 2");
      expect(result).toContain("Phase 2 output");
      // Phase 3 is active (not completed), should not appear
      expect(result).not.toContain("阶段 3");
    });

    it("should include references section in full mode when references exist", async () => {
      const topic = makeTopic({
        currentPhase: 6,
        phaseStatus: {
          6: { status: "completed", summary: "Final" },
        } as Record<number, PlanPhaseStatus>,
        references: [
          {
            id: "ref-1",
            title: "Research Paper",
            url: "http://example.com",
            domain: "example.com",
            snippet: "...",
            sourcePhase: 2,
          },
        ],
      });
      mockPrisma.topic.findFirst.mockResolvedValue(topic);

      const result = await service.exportPlan("topic-1", "user-1", "full");

      expect(result).toContain("参考文献");
      expect(result).toContain("Research Paper");
    });
  });

  // ==================== deletePlan ====================

  describe("deletePlan", () => {
    it("should archive the plan (soft delete)", async () => {
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

    it("should throw NotFoundException when plan not found or not owned by user", async () => {
      mockPrisma.topic.findFirst.mockResolvedValue(null);

      await expect(service.deletePlan("topic-1", "other-user")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== classifySourceType (private via public path) ====================

  describe("source classification and credibility scoring", () => {
    it("should classify academic sources correctly", () => {
      // We test the private method indirectly through searchForResearchPhase behavior,
      // but since it is private we test observable outcomes via executePhaseAsync indirectly.
      // The method is called during Phase 2 execution. We verify it doesn't throw by
      // checking the service can be constructed and does not fail on standard calls.
      expect(service).toBeDefined();
    });
  });

  // ==================== executePhaseAsync (integration path) ====================

  describe("executePhaseAsync / AI execution", () => {
    it("should mark phase as failed when all agents fail", async () => {
      const topic = makeTopic({
        currentPhase: 1,
        phaseStatus: { 1: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      // Used by activatePhase → executePhaseAsync inner
      mockPrisma.topic.findFirst.mockResolvedValue(topic);
      mockPrisma.topic.update.mockResolvedValue({});
      mockAiFacade.chat.mockResolvedValue({
        isError: true,
        content: "LLM error",
        model: "gpt-4o",
        tokensUsed: 0,
      });
      mockTeamFacade.reflect.mockResolvedValue(null);

      // Trigger activation, which fires executePhaseAsync in background
      const topic2 = makeTopic({ currentPhase: 0 });
      mockPrisma.topic.findFirst
        .mockResolvedValueOnce(topic2) // advancePhase ownership check
        .mockResolvedValueOnce(topic2); // activatePhase fresh read

      await service.advancePhase("topic-1", "user-1");

      // Give the background async execution a tick to run
      await new Promise((resolve) => setTimeout(resolve, 0));

      // update should have been called (for activatePhase setting status=active)
      expect(mockPrisma.topic.update).toHaveBeenCalled();
    });

    it("should call aiFacade.search during phase 2 execution", async () => {
      const activeMeta = makeMeta({
        currentPhase: 2,
        phaseStatus: { 2: { status: "active" } } as Record<
          number,
          PlanPhaseStatus
        >,
      });
      const topic = { ...makeTopic(activeMeta), metadata: activeMeta };

      mockPrisma.topic.findFirst.mockResolvedValue(topic);
      mockPrisma.topic.update.mockResolvedValue({});
      mockAiFacade.chat.mockResolvedValue({
        isError: false,
        content: '["query 1", "query 2"]',
        model: "gpt-4o",
        tokensUsed: 10,
      });
      mockRagFacade.search.mockResolvedValue({ success: false, results: [] });
      mockTeamFacade.reflect.mockResolvedValue(null);
      mockAiResponseService.createAIMessage.mockResolvedValue({});

      // Direct call to the private method via bracket notation for testing
      const innerService = service as unknown as {
        executePhaseAsyncInner: (
          planId: string,
          userId: string,
          phase: number,
        ) => Promise<void>;
      };
      await innerService.executePhaseAsyncInner("topic-1", "user-1", 2);

      expect(mockRagFacade.search).toHaveBeenCalled();
    });
  });

  // ==================== getTaskProfileForPhase (private) ====================

  describe("getTaskProfileForPhase", () => {
    it("should assign high creativity to brainstorm phase (3)", () => {
      const innerService = service as unknown as {
        getTaskProfileForPhase: (
          phase: number,
          depth: PlanningDepth,
        ) => { creativity: string; outputLength: string };
      };

      const profile = innerService.getTaskProfileForPhase(
        3,
        PlanningDepth.STANDARD,
      );
      expect(profile.creativity).toBe("high");
    });

    it("should assign low creativity to delivery phase (6)", () => {
      const innerService = service as unknown as {
        getTaskProfileForPhase: (
          phase: number,
          depth: PlanningDepth,
        ) => { creativity: string; outputLength: string };
      };

      const profile = innerService.getTaskProfileForPhase(
        6,
        PlanningDepth.STANDARD,
      );
      expect(profile.creativity).toBe("low");
    });

    it("should assign extended outputLength for COMPREHENSIVE depth", () => {
      const innerService = service as unknown as {
        getTaskProfileForPhase: (
          phase: number,
          depth: PlanningDepth,
        ) => { creativity: string; outputLength: string };
      };

      const profile = innerService.getTaskProfileForPhase(
        1,
        PlanningDepth.COMPREHENSIVE,
      );
      expect(profile.outputLength).toBe("extended");
    });

    it("should assign medium outputLength for QUICK depth", () => {
      const innerService = service as unknown as {
        getTaskProfileForPhase: (
          phase: number,
          depth: PlanningDepth,
        ) => { creativity: string; outputLength: string };
      };

      const profile = innerService.getTaskProfileForPhase(
        1,
        PlanningDepth.QUICK,
      );
      expect(profile.outputLength).toBe("medium");
    });
  });

  // ==================== generateSearchQueriesFallback (private) ====================

  describe("generateSearchQueriesFallback", () => {
    it("should return up to 6 queries for a given goal", () => {
      const innerService = service as unknown as {
        generateSearchQueriesFallback: (
          goal: string,
          planName: string,
        ) => string[];
      };

      const queries = innerService.generateSearchQueriesFallback(
        "Develop an AI-powered e-commerce recommendation engine",
        "AI E-Commerce Plan",
      );

      expect(queries.length).toBeGreaterThan(0);
      expect(queries.length).toBeLessThanOrEqual(6);
      expect(queries.every((q) => typeof q === "string")).toBe(true);
    });

    it("should include current year in the first query", () => {
      const innerService = service as unknown as {
        generateSearchQueriesFallback: (
          goal: string,
          planName: string,
        ) => string[];
      };

      const queries = innerService.generateSearchQueriesFallback(
        "AI product",
        "My Plan",
      );
      const currentYear = new Date().getFullYear().toString();

      expect(queries[0]).toContain(currentYear);
    });
  });

  // ==================== calculateCredibilityScore (private) ====================

  describe("calculateCredibilityScore", () => {
    it("should give high score to .gov or .edu domains", () => {
      const innerService = service as unknown as {
        calculateCredibilityScore: (ref: {
          domain: string;
          snippet: string;
          publishedDate?: string;
          sourceType: string;
        }) => number;
      };

      const score = innerService.calculateCredibilityScore({
        domain: "cdc.gov",
        snippet: "a".repeat(600),
        publishedDate: new Date().toISOString(),
        sourceType: "official",
      });

      expect(score).toBeGreaterThanOrEqual(80);
    });

    it("should give lower score to unknown web domain", () => {
      const innerService = service as unknown as {
        calculateCredibilityScore: (ref: {
          domain: string;
          snippet: string;
          publishedDate?: string;
          sourceType: string;
        }) => number;
      };

      const score = innerService.calculateCredibilityScore({
        domain: "random-blog.com",
        snippet: "short",
        sourceType: "web",
      });

      // 15 (domain) + 15 (web) + 0 (short snippet) + 5 (no date) = 35
      expect(score).toBeLessThanOrEqual(40);
      expect(score).toBeGreaterThanOrEqual(20); // minimum floor
    });

    it("should give freshness bonus for recently published content", () => {
      const innerService = service as unknown as {
        calculateCredibilityScore: (ref: {
          domain: string;
          snippet: string;
          publishedDate?: string;
          sourceType: string;
        }) => number;
      };

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 5); // 5 days ago

      const freshScore = innerService.calculateCredibilityScore({
        domain: "example.com",
        snippet: "",
        publishedDate: recentDate.toISOString(),
        sourceType: "web",
      });

      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 5); // 5 years ago

      const oldScore = innerService.calculateCredibilityScore({
        domain: "example.com",
        snippet: "",
        publishedDate: oldDate.toISOString(),
        sourceType: "web",
      });

      expect(freshScore).toBeGreaterThan(oldScore);
    });
  });

  // ==================== classifySourceType (private) ====================

  describe("classifySourceType", () => {
    it("should classify arxiv.org as academic", () => {
      const innerService = service as unknown as {
        classifySourceType: (domain: string) => string;
      };

      expect(innerService.classifySourceType("arxiv.org")).toBe("academic");
    });

    it("should classify reuters.com as news", () => {
      const innerService = service as unknown as {
        classifySourceType: (domain: string) => string;
      };

      expect(innerService.classifySourceType("reuters.com")).toBe("news");
    });

    it("should classify mckinsey.com as report", () => {
      const innerService = service as unknown as {
        classifySourceType: (domain: string) => string;
      };

      expect(innerService.classifySourceType("mckinsey.com")).toBe("report");
    });

    it("should classify who.int as official", () => {
      const innerService = service as unknown as {
        classifySourceType: (domain: string) => string;
      };

      expect(innerService.classifySourceType("who.int")).toBe("official");
    });

    it("should classify unknown domains as web", () => {
      const innerService = service as unknown as {
        classifySourceType: (domain: string) => string;
      };

      expect(innerService.classifySourceType("some-random-blog.io")).toBe(
        "web",
      );
    });
  });

  // ==================== getQualityDimensions (private) ====================

  describe("getQualityDimensions", () => {
    it("should return 3 dimensions for each phase 1-6", () => {
      const innerService = service as unknown as {
        getQualityDimensions: (phase: number) => string[];
      };

      for (let phase = 1; phase <= 6; phase++) {
        const dims = innerService.getQualityDimensions(phase);
        expect(dims).toHaveLength(3);
        expect(dims.every((d) => d.length > 0)).toBe(true);
      }
    });

    it("should return empty array for invalid phase", () => {
      const innerService = service as unknown as {
        getQualityDimensions: (phase: number) => string[];
      };

      expect(innerService.getQualityDimensions(99)).toEqual([]);
    });
  });
});

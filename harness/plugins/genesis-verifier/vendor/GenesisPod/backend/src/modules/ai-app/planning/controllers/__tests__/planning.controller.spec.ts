// Mock deep dependency chains before imports
jest.mock("../../../teams/ai-teams.service", () => ({
  AiTeamsService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../../../teams/services/ai/ai-response.service", () => ({
  AiResponseService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("../../../../platform/credits/billing-context.store", () => ({
  BillingContext: { run: jest.fn() },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { PlanningController } from "../planning.controller";
import { PlanningOrchestratorService } from "../../services/planning-orchestrator.service";
import { PlanningTemplateService } from "../../services/planning-template.service";
import { PlanningDepth } from "../../dto/create-plan.dto";

const mockResponse = {
  setHeader: jest.fn(),
  send: jest.fn(),
} as any;

describe("PlanningController", () => {
  let controller: PlanningController;
  let orchestrator: jest.Mocked<PlanningOrchestratorService>;
  let templateService: jest.Mocked<PlanningTemplateService>;

  const mockUser = { id: "user-1", email: "test@example.com" };
  const mockRequest = { user: mockUser } as any;

  const mockPlanSummary = {
    id: "plan-123",
    name: "Test Plan",
    goal: "Test goal",
    templateId: "general",
    currentPhase: 1,
    totalPhases: 6,
    phaseStatus: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    memberCount: 2,
  };

  const mockTemplate = {
    id: "general",
    name: "通用策划",
    description: "通用模板",
    icon: "target",
    defaultGoalPrompt: "prompt",
    phasePrompts: {},
  };

  beforeEach(async () => {
    const mockOrchestrator = {
      createPlan: jest.fn().mockResolvedValue({ planId: "plan-123" }),
      getPlans: jest.fn().mockResolvedValue([mockPlanSummary]),
      getPlanDetail: jest.fn().mockResolvedValue({
        ...mockPlanSummary,
        description: null,
        depth: PlanningDepth.STANDARD,
        autoAdvance: true,
        members: [],
        references: [],
      }),
      updatePlan: jest.fn().mockResolvedValue(mockPlanSummary),
      advancePhase: jest.fn().mockResolvedValue({ currentPhase: 2 }),
      retryPhase: jest.fn().mockResolvedValue({ currentPhase: 2 }),
      replanFromPhase: jest.fn().mockResolvedValue({ currentPhase: 2 }),
      cancelPhase: jest.fn().mockResolvedValue(undefined),
      exportPlan: jest.fn().mockResolvedValue("# Plan Markdown"),
      deletePlan: jest.fn().mockResolvedValue(undefined),
    };

    const mockTemplateService = {
      getTemplates: jest.fn().mockReturnValue([mockTemplate]),
      getTemplate: jest.fn().mockReturnValue(mockTemplate),
      getDefaultTemplate: jest.fn().mockReturnValue(mockTemplate),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlanningController],
      providers: [
        { provide: PlanningOrchestratorService, useValue: mockOrchestrator },
        { provide: PlanningTemplateService, useValue: mockTemplateService },
      ],
    }).compile();

    controller = module.get<PlanningController>(PlanningController);
    orchestrator = module.get(PlanningOrchestratorService);
    templateService = module.get(PlanningTemplateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockResponse.setHeader.mockClear();
    mockResponse.send.mockClear();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("createPlan", () => {
    it("should call orchestrator.createPlan with user id and dto", async () => {
      const dto = { name: "Test Plan", goal: "Test goal" };
      const result = await controller.createPlan(mockRequest, dto);

      expect(orchestrator.createPlan).toHaveBeenCalledWith("user-1", dto);
      expect(result).toEqual({ planId: "plan-123" });
    });
  });

  describe("getPlans", () => {
    it("should return list of plans", async () => {
      const result = await controller.getPlans(mockRequest, undefined);

      expect(orchestrator.getPlans).toHaveBeenCalledWith("user-1", undefined);
      expect(Array.isArray(result)).toBe(true);
    });

    it("should pass search query to orchestrator", async () => {
      await controller.getPlans(mockRequest, "test search");

      expect(orchestrator.getPlans).toHaveBeenCalledWith(
        "user-1",
        "test search",
      );
    });
  });

  describe("getTemplates", () => {
    it("should return list of templates", async () => {
      const result = await controller.getTemplates();

      expect(templateService.getTemplates).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("getPlanDetail", () => {
    it("should return plan detail", async () => {
      const result = await controller.getPlanDetail(mockRequest, "plan-123");

      expect(orchestrator.getPlanDetail).toHaveBeenCalledWith(
        "plan-123",
        "user-1",
      );
      expect(result).toHaveProperty("id");
    });
  });

  describe("updatePlan", () => {
    it("should update plan", async () => {
      const dto = { name: "Updated Name" };
      await controller.updatePlan(mockRequest, "plan-123", dto);

      expect(orchestrator.updatePlan).toHaveBeenCalledWith(
        "plan-123",
        "user-1",
        dto,
      );
    });
  });

  describe("advancePhase", () => {
    it("should advance to next phase", async () => {
      const result = await controller.advancePhase(mockRequest, "plan-123");

      expect(orchestrator.advancePhase).toHaveBeenCalledWith(
        "plan-123",
        "user-1",
      );
      expect(result).toEqual({ currentPhase: 2 });
    });
  });

  describe("retryPhase", () => {
    it("should retry specified phase", async () => {
      const _result = await controller.retryPhase(mockRequest, "plan-123", "3");

      expect(orchestrator.retryPhase).toHaveBeenCalledWith(
        "plan-123",
        3,
        "user-1",
      );
    });
  });

  describe("replanFromPhase", () => {
    it("should replan from specified phase", async () => {
      const dto = { startPhase: 2 };
      await controller.replanFromPhase(mockRequest, "plan-123", dto);

      expect(orchestrator.replanFromPhase).toHaveBeenCalledWith(
        "plan-123",
        2,
        "user-1",
      );
    });
  });

  describe("cancelPhase", () => {
    it("should cancel current phase", async () => {
      const result = await controller.cancelPhase(mockRequest, "plan-123");

      expect(orchestrator.cancelPhase).toHaveBeenCalledWith(
        "plan-123",
        "user-1",
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe("exportPlan", () => {
    it("should export plan as markdown", async () => {
      await controller.exportPlan(
        mockRequest,
        "plan-123",
        "report",
        mockResponse,
      );

      expect(orchestrator.exportPlan).toHaveBeenCalledWith(
        "plan-123",
        "user-1",
        "report",
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        "text/markdown; charset=utf-8",
      );
      expect(mockResponse.send).toHaveBeenCalledWith("# Plan Markdown");
    });

    it("should use full mode when mode is full", async () => {
      await controller.exportPlan(
        mockRequest,
        "plan-123",
        "full",
        mockResponse,
      );

      expect(orchestrator.exportPlan).toHaveBeenCalledWith(
        "plan-123",
        "user-1",
        "full",
      );
    });

    it("should default to report mode for unknown mode", async () => {
      await controller.exportPlan(
        mockRequest,
        "plan-123",
        "unknown",
        mockResponse,
      );

      expect(orchestrator.exportPlan).toHaveBeenCalledWith(
        "plan-123",
        "user-1",
        "report",
      );
    });
  });

  describe("deletePlan", () => {
    it("should delete plan and return success", async () => {
      const result = await controller.deletePlan(mockRequest, "plan-123");

      expect(orchestrator.deletePlan).toHaveBeenCalledWith(
        "plan-123",
        "user-1",
      );
      expect(result).toEqual({ success: true });
    });
  });
});

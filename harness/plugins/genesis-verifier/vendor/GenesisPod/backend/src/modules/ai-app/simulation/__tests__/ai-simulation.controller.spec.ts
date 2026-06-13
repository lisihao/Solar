jest.mock("../../../platform/credits/billing-context.store", () => ({
  BillingContext: {
    run: jest
      .fn()
      .mockImplementation((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { AiSimulationController } from "../ai-simulation.controller";
import { AiSimulationService } from "../ai-simulation.service";
import { ExternalDataService } from "../external-data.service";
import { AIAssistService } from "../ai-assist.service";

describe("AiSimulationController", () => {
  let controller: AiSimulationController;
  let simulationService: jest.Mocked<AiSimulationService>;
  let externalData: jest.Mocked<ExternalDataService>;
  let aiAssist: jest.Mocked<AIAssistService>;

  const mockScenario = {
    id: "scenario-1",
    name: "Test Scenario",
    industry: "technology",
    region: "US",
    companies: [],
    agents: [],
  };

  const mockRun = {
    id: "run-1",
    scenarioId: "scenario-1",
    status: "RUNNING",
    rounds: 2,
    submissions: [],
  };

  beforeEach(async () => {
    const mockSimulationService = {
      createScenario: jest.fn().mockResolvedValue(mockScenario),
      listScenarios: jest.fn().mockResolvedValue([mockScenario]),
      getScenarioById: jest.fn().mockResolvedValue(mockScenario),
      updateScenario: jest.fn().mockResolvedValue(mockScenario),
      deleteScenario: jest.fn().mockResolvedValue({ success: true }),
      startRun: jest.fn().mockResolvedValue(mockRun),
      getRunById: jest.fn().mockResolvedValue(mockRun),
      deleteRun: jest.fn().mockResolvedValue({ success: true }),
      resumeRun: jest.fn().mockResolvedValue({ ...mockRun, status: "RUNNING" }),
      pauseRun: jest.fn().mockResolvedValue({ ...mockRun, status: "PAUSED" }),
      interveneRun: jest.fn().mockResolvedValue({ success: true }),
    };

    const mockExternalData = {
      getSnapshot: jest
        .fn()
        .mockResolvedValue({ data: {}, timestamp: Date.now() }),
      testProvider: jest
        .fn()
        .mockResolvedValue({ success: true, latency: 150 }),
    };

    const mockAiAssist = {
      analyzeIndustry: jest.fn().mockResolvedValue({
        companies: [],
        roles: [],
        marketStructure: "oligopoly",
      }),
      suggestAgents: jest.fn().mockResolvedValue([
        { role: "CEO", team: "BLUE", persona: {} },
        { role: "CFO", team: "BLUE", persona: {} },
      ]),
      generateScenarioSuggestions: jest.fn().mockResolvedValue({
        scenarios: [],
        rounds: 3,
      }),
      generateCompanyMetrics: jest.fn().mockResolvedValue({
        revenue: "$1B",
        marketShare: "20%",
      }),
      suggestParams: jest.fn().mockResolvedValue({
        rounds: 3,
        eventEnabled: false,
        agentCount: 8,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiSimulationController],
      providers: [
        { provide: AiSimulationService, useValue: mockSimulationService },
        { provide: ExternalDataService, useValue: mockExternalData },
        { provide: AIAssistService, useValue: mockAiAssist },
      ],
    }).compile();

    controller = module.get<AiSimulationController>(AiSimulationController);
    simulationService = module.get(AiSimulationService);
    externalData = module.get(ExternalDataService);
    aiAssist = module.get(AIAssistService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  // ==================== Scenario Management ====================

  describe("createScenario", () => {
    it("should create scenario with required fields", async () => {
      const body = {
        name: "Tech War",
        industry: "technology",
        region: "Global",
      };
      const result = await controller.createScenario(body);

      expect(simulationService.createScenario).toHaveBeenCalledWith(body);
      expect(result).toEqual(mockScenario);
    });

    it("should create scenario with companies and agents", async () => {
      const body = {
        name: "Market Simulation",
        industry: "retail",
        companies: [{ name: "Company A", type: "leader", market: "domestic" }],
        agents: [
          { companyName: "Company A", team: "BLUE" as any, role: "CEO" },
        ],
      };
      await controller.createScenario(body);

      expect(simulationService.createScenario).toHaveBeenCalledWith(body);
    });
  });

  describe("listScenarios", () => {
    it("should return list of scenarios", async () => {
      const result = await controller.listScenarios();

      expect(simulationService.listScenarios).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toEqual(mockScenario);
    });
  });

  describe("getScenario", () => {
    it("should return scenario by id", async () => {
      const result = await controller.getScenario("scenario-1");

      expect(simulationService.getScenarioById).toHaveBeenCalledWith(
        "scenario-1",
      );
      expect(result).toEqual(mockScenario);
    });
  });

  describe("updateScenario", () => {
    it("should update scenario", async () => {
      const body = { name: "Updated Scenario", industry: "finance" };
      const result = await controller.updateScenario("scenario-1", body);

      expect(simulationService.updateScenario).toHaveBeenCalledWith(
        "scenario-1",
        body,
      );
      expect(result).toEqual(mockScenario);
    });

    it("should update scenario companies and agents", async () => {
      const body = {
        companies: [{ name: "New Corp", type: "challenger" }],
        agents: [{ companyName: "New Corp", team: "RED" as any, role: "CEO" }],
      };
      await controller.updateScenario("scenario-1", body);

      expect(simulationService.updateScenario).toHaveBeenCalledWith(
        "scenario-1",
        body,
      );
    });
  });

  describe("deleteScenario", () => {
    it("should delete scenario", async () => {
      const result = await controller.deleteScenario("scenario-1");

      expect(simulationService.deleteScenario).toHaveBeenCalledWith(
        "scenario-1",
      );
      expect(result).toEqual({ success: true });
    });
  });

  // ==================== Run Management ====================

  describe("startRun", () => {
    it("should start run with scenarioId", async () => {
      const body = { scenarioId: "scenario-1", rounds: 3 };
      const result = await controller.startRun(body);

      expect(simulationService.startRun).toHaveBeenCalledWith({
        scenarioId: "scenario-1",
        rounds: 3,
        params: undefined,
      });
      expect(result).toEqual(mockRun);
    });

    it("should start run with default rounds", async () => {
      const body = { scenarioId: "scenario-1" };
      await controller.startRun(body);

      expect(simulationService.startRun).toHaveBeenCalledWith({
        scenarioId: "scenario-1",
        rounds: undefined,
        params: undefined,
      });
    });

    it("should pass params when provided", async () => {
      const body = {
        scenarioId: "scenario-1",
        rounds: 2,
        params: { eventEnabled: true },
      };
      await controller.startRun(body as any);

      expect(simulationService.startRun).toHaveBeenCalledWith({
        scenarioId: "scenario-1",
        rounds: 2,
        params: { eventEnabled: true },
      });
    });
  });

  describe("getRun", () => {
    it("should get run without perspective filter", async () => {
      const result = await controller.getRun("run-1");

      expect(simulationService.getRunById).toHaveBeenCalledWith(
        "run-1",
        undefined,
      );
      expect(result).toEqual(mockRun);
    });

    it("should get run with GOD perspective", async () => {
      await controller.getRun("run-1", "GOD");

      expect(simulationService.getRunById).toHaveBeenCalledWith("run-1", "GOD");
    });

    it("should get run with BLUE perspective", async () => {
      await controller.getRun("run-1", "BLUE");

      expect(simulationService.getRunById).toHaveBeenCalledWith(
        "run-1",
        "BLUE",
      );
    });

    it("should reject invalid perspective", async () => {
      await controller.getRun("run-1", "INVALID" as any);

      // Invalid perspective should be ignored (treated as undefined)
      expect(simulationService.getRunById).toHaveBeenCalledWith(
        "run-1",
        undefined,
      );
    });

    it("should accept all valid perspectives", async () => {
      const perspectives = ["GOD", "BLUE", "RED", "GREEN", "WHITE"] as const;
      for (const p of perspectives) {
        await controller.getRun("run-1", p);
        expect(simulationService.getRunById).toHaveBeenCalledWith("run-1", p);
      }
    });
  });

  describe("deleteRun", () => {
    it("should delete run", async () => {
      const result = await controller.deleteRun("run-1");

      expect(simulationService.deleteRun).toHaveBeenCalledWith("run-1");
      expect(result).toEqual({ success: true });
    });
  });

  describe("resumeRun", () => {
    it("should resume run", async () => {
      const result = await controller.resumeRun("run-1");

      expect(simulationService.resumeRun).toHaveBeenCalledWith("run-1");
      expect(result.status).toBe("RUNNING");
    });
  });

  describe("pauseRun", () => {
    it("should pause run", async () => {
      const result = await controller.pauseRun("run-1");

      expect(simulationService.pauseRun).toHaveBeenCalledWith("run-1");
      expect(result.status).toBe("PAUSED");
    });
  });

  describe("interveneRun", () => {
    it("should intervene in run with message", async () => {
      const body = { message: "Market crash event" };
      const result = await controller.interveneRun("run-1", body);

      expect(simulationService.interveneRun).toHaveBeenCalledWith(
        "run-1",
        body,
      );
      expect(result).toEqual({ success: true });
    });

    it("should intervene with event injection", async () => {
      const body = {
        message: "Regulation change",
        injectEvent: { type: "regulatory", severity: "high" },
      };
      await controller.interveneRun("run-1", body);

      expect(simulationService.interveneRun).toHaveBeenCalledWith(
        "run-1",
        body,
      );
    });
  });

  // ==================== External Data ====================

  describe("getExternalSnapshot", () => {
    it("should return external data snapshot", async () => {
      const result = await controller.getExternalSnapshot();

      expect(externalData.getSnapshot).toHaveBeenCalled();
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("timestamp");
    });
  });

  describe("testExternalProvider", () => {
    it("should test external provider configuration", async () => {
      const body = {
        id: "provider-1",
        name: "Test Provider",
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
      };
      const result = await controller.testExternalProvider(body);

      expect(externalData.testProvider).toHaveBeenCalledWith(body);
      expect(result).toEqual({ success: true, latency: 150 });
    });
  });

  // ==================== AI Assist ====================

  describe("analyzeIndustry", () => {
    it("should analyze industry and return recommendations", async () => {
      const body = {
        industry: "technology",
        region: "US",
        existingCompanies: ["TechCorp"],
      };
      const result = await controller.analyzeIndustry(body);

      expect(aiAssist.analyzeIndustry).toHaveBeenCalledWith(body);
      expect(result).toHaveProperty("marketStructure", "oligopoly");
    });
  });

  describe("suggestAgents", () => {
    it("should suggest agents and wrap in { agents } object", async () => {
      const body = {
        industry: "technology",
        companies: [{ name: "TechCorp", type: "leader" }],
      };
      const result = await controller.suggestAgents(body);

      expect(aiAssist.suggestAgents).toHaveBeenCalledWith(body);
      expect(result).toHaveProperty("agents");
      expect(Array.isArray(result.agents)).toBe(true);
      expect(result.agents).toHaveLength(2);
    });
  });

  describe("suggestScenario", () => {
    it("should generate scenario suggestions", async () => {
      const body = {
        industry: "finance",
        region: "Asia",
        goals: "Market expansion",
      };
      const result = await controller.suggestScenario(body);

      expect(aiAssist.generateScenarioSuggestions).toHaveBeenCalledWith(body);
      expect(result).toHaveProperty("rounds", 3);
    });
  });

  describe("generateCompanyMetrics", () => {
    it("should generate company metrics", async () => {
      const body = {
        companyName: "TechCorp",
        companyType: "leader",
        industry: "technology",
        market: "global",
      };
      const result = await controller.generateCompanyMetrics(body);

      expect(aiAssist.generateCompanyMetrics).toHaveBeenCalledWith(body);
      expect(result).toHaveProperty("revenue");
      expect(result).toHaveProperty("marketShare");
    });
  });

  describe("suggestParams", () => {
    it("should suggest simulation parameters", async () => {
      const body = {
        industry: "retail",
        region: "China",
        companyCount: 4,
        agentCount: 12,
        goals: { risk: "high" },
      };
      const result = await controller.suggestParams(body);

      expect(aiAssist.suggestParams).toHaveBeenCalledWith(body);
      expect(result).toHaveProperty("rounds", 3);
      expect(result).toHaveProperty("agentCount", 8);
    });
  });

  // ==================== Run Report ====================

  describe("getRunReport", () => {
    it("should return error when run not found", async () => {
      (simulationService.getRunById as jest.Mock).mockResolvedValueOnce(null);

      const result = await controller.getRunReport("missing-run");

      expect(result).toEqual({ error: "Report not available" });
    });

    it("should return error when run has no summary", async () => {
      (simulationService.getRunById as jest.Mock).mockResolvedValueOnce({
        ...mockRun,
        summary: null,
      });

      const result = await controller.getRunReport("run-1");

      expect(result).toEqual({ error: "Report not available" });
    });

    it("should return full summary by default", async () => {
      const summary = {
        overview: "Summary content",
        publicReport: { public: true },
        internalReport: { internal: true },
      };
      (simulationService.getRunById as jest.Mock).mockResolvedValueOnce({
        ...mockRun,
        summary,
      });

      const result = await controller.getRunReport("run-1");

      // No version specified - returns full summary
      expect(result).toEqual(summary);
    });

    it("should return public report when version is public", async () => {
      const summary = {
        overview: "Summary",
        publicReport: { highlights: "Public data" },
        internalReport: { secrets: "Internal data" },
      };
      (simulationService.getRunById as jest.Mock).mockResolvedValueOnce({
        ...mockRun,
        summary,
      });

      const result = await controller.getRunReport("run-1", "public");

      expect(result).toEqual({ highlights: "Public data" });
    });

    it("should return internal report when version is internal", async () => {
      const summary = {
        publicReport: { pub: true },
        internalReport: { internal: "classified" },
      };
      (simulationService.getRunById as jest.Mock).mockResolvedValueOnce({
        ...mockRun,
        summary,
      });

      const result = await controller.getRunReport("run-1", "internal");

      expect(result).toEqual({ internal: "classified" });
    });
  });

  // ==================== SSE Events ====================

  describe("runEvents", () => {
    it("should return an Observable for SSE events", () => {
      // The runEvents method returns an Observable - verify it's defined
      const result = controller.runEvents("run-1");
      expect(result).toBeDefined();
      // Should be an Observable (has subscribe method)
      expect(typeof result.subscribe).toBe("function");
    });

    it("should return Observable for valid perspectives", () => {
      const result = controller.runEvents("run-1", "GOD");
      expect(result).toBeDefined();
      expect(typeof result.subscribe).toBe("function");
    });

    it("should reject invalid perspective in SSE (returns undefined perspective)", () => {
      const result = controller.runEvents("run-1", "INVALID" as any);
      // Still returns an Observable (with undefined perspective)
      expect(result).toBeDefined();
      expect(typeof result.subscribe).toBe("function");
    });
  });
});

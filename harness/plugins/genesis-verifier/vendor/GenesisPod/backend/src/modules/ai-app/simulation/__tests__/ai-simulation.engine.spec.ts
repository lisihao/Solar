import { Test, TestingModule } from "@nestjs/testing";
import { AiSimulationEngineService } from "../ai-simulation.engine";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ExternalDataService } from "../external-data.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { SimulationRunStatus, SimulationTeam } from "@prisma/client";

describe("AiSimulationEngineService", () => {
  let service: AiSimulationEngineService;
  let prisma: jest.Mocked<PrismaService>;
  let externalData: jest.Mocked<ExternalDataService>;
  let aiFacade: jest.Mocked<ChatFacade>;

  const mockAgent = {
    id: "agent-1",
    role: "CEO",
    team: SimulationTeam.BLUE,
    persona: { style: "aggressive" },
    memoryPublic: { round1: "We attacked" },
    tools: { plannedCost: 100 },
    companyId: "company-1",
    scenarioId: "scenario-1",
  };

  const mockScenario = {
    id: "scenario-1",
    name: "Market Battle",
    industry: "SaaS",
    companies: [
      { id: "company-1", metrics: { cash: 10000 }, scenarioId: "scenario-1" },
    ],
    agents: [mockAgent],
  };

  const mockRun = {
    id: "run-1",
    rounds: 2,
    currentRound: 0,
    status: SimulationRunStatus.RUNNING,
    worldState: {},
    evidenceTrail: {},
    summary: null,
    params: { humanBreakEvery: 0, irrationalProb: 0.2, chaosProb: 0.0 },
    scenario: mockScenario,
    turns: [],
  };

  const mockTurn = {
    id: "turn-1",
    runId: "run-1",
    roundNumber: 1,
    submissions: [],
    adjudication: { ruling: "proceed", notes: "all good" },
    evidence: [],
    worldState: {},
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrisma = {
      simulationRun: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      simulationTurn: {
        create: jest.fn(),
      },
    };

    const mockExternalData = {
      getSnapshot: jest.fn(),
    };

    const mockAiFacade = {
      getAvailableModelsExtended: jest.fn(),
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiSimulationEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ExternalDataService, useValue: mockExternalData },
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<AiSimulationEngineService>(AiSimulationEngineService);
    prisma = module.get(PrismaService);
    externalData = module.get(ExternalDataService);
    aiFacade = module.get(ChatFacade);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("executeRun", () => {
    it("should return early when run is not found", async () => {
      (prisma.simulationRun.findUnique as jest.Mock).mockResolvedValue(null);

      await service.executeRun("non-existent-run");

      expect(prisma.simulationRun.update).not.toHaveBeenCalled();
    });

    it("should initialize state and complete a 2-round run", async () => {
      const snapshot = { market: { price: 100 }, finance: { cash: 5000 } };
      const evidence = [{ category: "market", ok: true }];

      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot,
        evidence,
      });

      // First findUnique call - the run itself
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: mockScenario,
          turns: [],
        }) // executeRun initial
        .mockResolvedValueOnce({ ...mockRun, scenario: mockScenario }) // processRound round 1
        .mockResolvedValueOnce({
          ...mockRun,
          currentRound: 1,
          scenario: mockScenario,
        }) // processRound round 2
        .mockResolvedValueOnce({
          // computeDebrief
          ...mockRun,
          currentRound: 2,
          turns: [{ ...mockTurn, submissions: [] }],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      await service.executeRun("run-1");

      expect(prisma.simulationRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "run-1" },
          data: expect.objectContaining({
            status: SimulationRunStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should pause run at humanBreakEvery interval", async () => {
      const runWithBreak = {
        ...mockRun,
        rounds: 4,
        params: { humanBreakEvery: 2, irrationalProb: 0.2, chaosProb: 0.0 },
        scenario: mockScenario,
        turns: [],
      };

      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce(runWithBreak) // executeRun initial load
        .mockResolvedValueOnce({ ...runWithBreak, scenario: mockScenario }) // round 1
        .mockResolvedValueOnce({ ...runWithBreak, scenario: mockScenario }); // round 2

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      await service.executeRun("run-1");

      // Should have paused at round 2
      const updateCalls = (prisma.simulationRun.update as jest.Mock).mock.calls;
      const pauseCall = updateCalls.find(
        (call) => call[0]?.data?.status === SimulationRunStatus.PAUSED,
      );
      expect(pauseCall).toBeDefined();
    });

    it("should resume from a specific round when resume=true", async () => {
      const resumeRun = {
        ...mockRun,
        rounds: 2,
        currentRound: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };

      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...resumeRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...resumeRun, scenario: mockScenario }) // round 2
        .mockResolvedValueOnce({
          // computeDebrief
          ...resumeRun,
          turns: [],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      await service.executeRun("run-1", { resume: true });

      expect(prisma.simulationRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SimulationRunStatus.COMPLETED,
          }),
        }),
      );
    });
  });

  describe("generateAgentDecision (via executeRun)", () => {
    it("should use template decision when no AI models are available", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      const agentWithPersona = {
        ...mockAgent,
        persona: { name: "Aggressive CEO" },
        memoryPublic: null,
      };

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: { ...mockScenario, agents: [agentWithPersona] },
          turns: [],
        })
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: { ...mockScenario, agents: [agentWithPersona] },
        })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      // Turn was created, meaning the template decision fallback worked
      expect(prisma.simulationTurn.create).toHaveBeenCalled();
    });

    it("should skip unavailable AI models and try the next one", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      const unavailableModel = {
        id: "model-bad",
        name: "bad-model",
        isAvailable: false,
      };
      const availableModel = {
        id: "model-ok",
        name: "ok-model",
        isAvailable: true,
      };

      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        unavailableModel,
        availableModel,
      ]);
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        isError: false,
        content: '{"innerMonologue":"thinking...","publicAction":"moving"}',
      });

      // 1-round run so chat is called exactly once (for the one agent)
      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...oneRoundRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      // Chat was called only for the available model (not the unavailable one)
      expect(aiFacade.chat).toHaveBeenCalledTimes(1);
    });

    it("should fallback to template when AI returns error", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      const model = { id: "model-1", name: "model-1", isAvailable: true };
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        model,
      ]);
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        isError: true,
        content: "Error occurred",
      });

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...mockRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      expect(prisma.simulationTurn.create).toHaveBeenCalled();
    });

    it("should fallback to template when AI throws quota error", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      const model = { id: "model-1", name: "model-1", isAvailable: true };
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        model,
      ]);
      (aiFacade.chat as jest.Mock).mockRejectedValue(
        new Error("quota exceeded 429"),
      );

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...mockRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      expect(prisma.simulationTurn.create).toHaveBeenCalled();
    });

    it("should fallback to template when AI throws token limit error", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      const model = { id: "model-1", name: "model-1", isAvailable: true };
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        model,
      ]);
      (aiFacade.chat as jest.Mock).mockRejectedValue(
        new Error("MAX_TOKENS exceeded"),
      );

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...mockRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      expect(prisma.simulationTurn.create).toHaveBeenCalled();
    });

    it("should fallback to template when AI throws empty response error", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      const model = { id: "model-1", name: "model-1", isAvailable: true };
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        model,
      ]);
      (aiFacade.chat as jest.Mock).mockRejectedValue(
        new Error("Empty response from API"),
      );

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...mockRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      expect(prisma.simulationTurn.create).toHaveBeenCalled();
    });

    it("should use irrational creativity when irrationalBias is high", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      const model = { id: "model-1", name: "model-1", isAvailable: true };
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        model,
      ]);
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        isError: false,
        content:
          '{"innerMonologue":"irrational thought","publicAction":"chaos action"}',
      });

      // Force irrationalProb = 1.0 so it always triggers
      const runWithHighIrrational = {
        ...mockRun,
        params: { humanBreakEvery: 0, irrationalProb: 1.0, chaosProb: 0.0 },
      };

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...runWithHighIrrational,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({
          ...runWithHighIrrational,
          scenario: mockScenario,
        })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      // Chat was called with high creativity
      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "high" }),
        }),
      );
    });
  });

  describe("processRound", () => {
    it("should throw error when run not found during processRound", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });

      // First call returns run, second (inside processRound) returns null
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce(null);

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      await expect(service.executeRun("run-1")).rejects.toThrow(
        "not found when processing round",
      );
    });

    it("should mark chaosInjected=true for CHAOS team agents when chaos is triggered", async () => {
      const chaosAgent = {
        ...mockAgent,
        id: "chaos-agent-1",
        team: SimulationTeam.CHAOS,
      };

      const runWithChaos = {
        ...mockRun,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 1.0 },
      };

      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...runWithChaos,
          scenario: { ...mockScenario, agents: [chaosAgent] },
          turns: [],
        })
        .mockResolvedValueOnce({
          ...runWithChaos,
          scenario: { ...mockScenario, agents: [chaosAgent] },
        })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: { ...mockScenario, agents: [chaosAgent] },
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      // The turn was created
      expect(prisma.simulationTurn.create).toHaveBeenCalled();
    });

    it("should set visibility to global for ARBITER team agents", async () => {
      const arbiterAgent = {
        ...mockAgent,
        id: "arbiter-1",
        team: SimulationTeam.ARBITER,
      };

      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: { ...mockScenario, agents: [arbiterAgent] },
          turns: [],
        })
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: { ...mockScenario, agents: [arbiterAgent] },
        })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      const submissions = createCall.data.submissions as Array<{
        team: string;
        visibility: string;
      }>;
      const arbiterSubmission = submissions.find(
        (s) => s.team === SimulationTeam.ARBITER,
      );
      expect(arbiterSubmission?.visibility).toBe("global");
    });
  });

  describe("simpleAdjudication", () => {
    it("should reject when agent cost exceeds company cash", async () => {
      const expensiveAgent = {
        ...mockAgent,
        tools: { plannedCost: 99999 }, // exceeds cash of 10000
        companyId: "company-1",
      };

      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: { ...mockScenario, agents: [expensiveAgent] },
          turns: [],
        })
        .mockResolvedValueOnce({
          ...mockRun,
          scenario: { ...mockScenario, agents: [expensiveAgent] },
        })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue({
        ...mockTurn,
        adjudication: { ruling: "rejected_insufficient_funds" },
      });

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.adjudication.ruling).toBe(
        "rejected_insufficient_funds",
      );
    });

    it("should mark missing data providers in evidence", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      const runWithNoWorldState = {
        ...mockRun,
        worldState: {}, // No market/finance/news/regulation
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...runWithNoWorldState,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({
          ...runWithNoWorldState,
          scenario: mockScenario,
        })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      const evidenceRefs = createCall.data.adjudication.evidenceRefs as Array<{
        provider: string;
        status: string;
      }>;
      const missingRefs = evidenceRefs.filter((e) => e.status === "missing");
      expect(missingRefs.length).toBeGreaterThan(0);
    });

    it("should trigger black_swan ruling when chaosProb=1", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      // Force chaos to always trigger
      const runWithMaxChaos = {
        ...mockRun,
        worldState: {
          market: true,
          finance: true,
          news: true,
          regulation: true,
        },
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 1.0 },
      };

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...runWithMaxChaos,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...runWithMaxChaos, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: { blackSwan: { name: "Test Event" } },
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.adjudication.ruling).toBe("black_swan");
    });

    it("should proceed with full world state data", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      const runWithFullState = {
        ...mockRun,
        worldState: {
          market: { price: 100 },
          finance: { cash: 5000 },
          news: { headline: "good news" },
          regulation: { policy: "open" },
        },
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };

      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...runWithFullState,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...runWithFullState, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...mockRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: runWithFullState.worldState,
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      expect(createCall.data.adjudication.ruling).toBe("proceed");
    });
  });

  describe("parseAgentResponse (via AI response)", () => {
    const setupRunWithModel = (chatResponse: string) => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      const model = { id: "m1", name: "m1", isAvailable: true };
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        model,
      ]);
      (aiFacade.chat as jest.Mock).mockResolvedValue({
        isError: false,
        content: chatResponse,
      });

      // 1-round run: executeRun(1) + processRound(2) + computeDebrief(3)
      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...oneRoundRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);
    };

    it("should parse valid JSON response", async () => {
      const validJson =
        '{"innerMonologue":"thinking","publicAction":"attacking"}';
      setupRunWithModel(validJson);

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      const submissions = createCall.data.submissions as Array<{
        innerMonologue: string;
        publicAction: string;
      }>;
      expect(submissions[0].innerMonologue).toBe("thinking");
      expect(submissions[0].publicAction).toBe("attacking");
    });

    it("should parse JSON wrapped in markdown code block", async () => {
      const markdownJson =
        '```json\n{"innerMonologue":"code block thought","publicAction":"code block action"}\n```';
      setupRunWithModel(markdownJson);

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      const submissions = createCall.data.submissions as Array<{
        innerMonologue: string;
        publicAction: string;
      }>;
      expect(submissions[0].innerMonologue).toBe("code block thought");
    });

    it("should extract fields from partial JSON", async () => {
      const partialJson =
        '{"innerMonologue":"partial thought","publicAction":"partial action"';
      setupRunWithModel(partialJson);

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      const submissions = createCall.data.submissions as Array<{
        innerMonologue: string;
        publicAction: string;
      }>;
      // It should have tried to extract fields from partial JSON
      expect(submissions[0]).toBeDefined();
    });

    it("should use plain text as fallback when no JSON structure present", async () => {
      const plainText =
        "I will attack the market by lowering prices significantly";
      setupRunWithModel(plainText);

      await service.executeRun("run-1");

      const createCall = (prisma.simulationTurn.create as jest.Mock).mock
        .calls[0][0];
      const submissions = createCall.data.submissions as Array<{
        innerMonologue: string;
        publicAction: string;
      }>;
      expect(submissions[0].innerMonologue).toBe(plainText);
    });
  });

  describe("computeDebrief", () => {
    it("should return empty object when run not found", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      // rounds=1 means: call 1=executeRun, call 2=processRound(1), call 3=computeDebrief
      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...oneRoundRun, scenario: mockScenario })
        .mockResolvedValueOnce(null); // computeDebrief finds nothing → returns {}

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      // Should have updated status to COMPLETED with empty summary
      const updateCalls = (prisma.simulationRun.update as jest.Mock).mock.calls;
      const completionCall = updateCalls.find(
        (call) => call[0]?.data?.status === SimulationRunStatus.COMPLETED,
      );
      expect(completionCall).toBeDefined();
    });

    it("should detect black swan events in debrief", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      const turnWithBlackSwan = {
        ...mockTurn,
        adjudication: {
          ruling: "black_swan",
          notes: "event occurred",
          blackSwanEvent: { name: "Market Crash", affectedTeams: ["BLUE"] },
        },
        worldState: {
          blackSwan: {
            name: "Market Crash",
            description: "Prices crashed",
            impact: "high",
            affectedTeams: ["BLUE"],
            probability: 0.1,
            triggered: true,
          },
          blackSwanHistory: [],
        },
        submissions: [
          {
            agentId: "agent-1",
            team: "BLUE",
            role: "CEO",
            publicAction: "defend",
            innerMonologue: "worried",
            irrational: false,
            companyId: "company-1",
            visibility: "team",
            timestamp: new Date().toISOString(),
            chaosInjected: false,
          },
        ],
        createdAt: new Date(),
      };

      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...oneRoundRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          turns: [turnWithBlackSwan],
          scenario: mockScenario,
          worldState: {
            blackSwan: { name: "Market Crash", description: "Prices crashed" },
            blackSwanHistory: [{ name: "Market Crash" }],
          },
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const updateCalls = (prisma.simulationRun.update as jest.Mock).mock.calls;
      const completionCall = updateCalls.find(
        (call) => call[0]?.data?.status === SimulationRunStatus.COMPLETED,
      );
      const summary = completionCall?.[0]?.data?.summary as {
        publicReport?: { keyFindings?: string[] };
      };
      expect(
        summary?.publicReport?.keyFindings?.some((f: string) =>
          f.includes("Market Crash"),
        ),
      ).toBe(true);
    });

    it("should detect rejected_insufficient_funds in debrief", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      const turnWithRejection = {
        ...mockTurn,
        roundNumber: 1,
        adjudication: {
          ruling: "rejected_insufficient_funds",
          notes: "Not enough cash",
        },
        worldState: {},
        submissions: [],
        createdAt: new Date(),
      };

      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...oneRoundRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          turns: [turnWithRejection],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const updateCalls = (prisma.simulationRun.update as jest.Mock).mock.calls;
      const completionCall = updateCalls.find(
        (call) => call[0]?.data?.status === SimulationRunStatus.COMPLETED,
      );
      const summary = completionCall?.[0]?.data?.summary as {
        internalReport?: { biasesDetected?: Array<{ type: string }> };
      };
      expect(
        summary?.internalReport?.biasesDetected?.some(
          (b) => b.type === "overconfidence",
        ),
      ).toBe(true);
    });

    it("should detect irrational submissions in debrief", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      const turnWithIrrational = {
        ...mockTurn,
        roundNumber: 1,
        adjudication: { ruling: "proceed" },
        worldState: { irrationalBias: "irrational_spike" },
        submissions: [
          {
            agentId: "agent-1",
            team: "BLUE",
            role: "CEO",
            publicAction: "panic sell",
            innerMonologue: "panicking",
            irrational: true,
            companyId: "company-1",
            visibility: "team",
            timestamp: new Date().toISOString(),
            chaosInjected: false,
          },
        ],
        createdAt: new Date(),
      };

      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...oneRoundRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          turns: [turnWithIrrational],
          scenario: mockScenario,
          worldState: { irrationalBias: "irrational_spike" },
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const updateCalls = (prisma.simulationRun.update as jest.Mock).mock.calls;
      const completionCall = updateCalls.find(
        (call) => call[0]?.data?.status === SimulationRunStatus.COMPLETED,
      );
      const summary = completionCall?.[0]?.data?.summary as {
        internalReport?: { biasesDetected?: Array<{ type: string }> };
      };
      expect(
        summary?.internalReport?.biasesDetected?.some(
          (b) => b.type === "irrational_spike",
        ),
      ).toBe(true);
    });

    it("should report missing data in debrief when world state is empty", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({ ...oneRoundRun, scenario: mockScenario })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          turns: [],
          scenario: mockScenario,
          worldState: {}, // no market/finance/news/regulation
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const updateCalls = (prisma.simulationRun.update as jest.Mock).mock.calls;
      const completionCall = updateCalls.find(
        (call) => call[0]?.data?.status === SimulationRunStatus.COMPLETED,
      );
      const summary = completionCall?.[0]?.data?.summary as {
        internalReport?: { blindspots?: Array<{ type: string }> };
      };
      expect(
        summary?.internalReport?.blindspots?.some((b) => b.type === "data_gap"),
      ).toBe(true);
    });
  });

  describe("detectStateChange (tested via debrief)", () => {
    it("should detect new black swan in state change", async () => {
      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([]);

      const turn1 = {
        ...mockTurn,
        roundNumber: 1,
        adjudication: { ruling: "proceed" },
        worldState: {},
        submissions: [],
        createdAt: new Date(),
      };
      const turn2 = {
        ...mockTurn,
        id: "turn-2",
        roundNumber: 2,
        adjudication: {
          ruling: "black_swan",
          blackSwanEvent: { name: "Storm", affectedTeams: ["BLUE", "RED"] },
        },
        worldState: { blackSwan: { name: "Storm", description: "Big storm" } },
        submissions: [],
        createdAt: new Date(),
      };

      // 2-round run: executeRun(1) + processRound(2) + processRound(3) + computeDebrief(4)
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...mockRun,
          rounds: 2,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({
          ...mockRun,
          rounds: 2,
          scenario: mockScenario,
        }) // round 1
        .mockResolvedValueOnce({
          ...mockRun,
          rounds: 2,
          scenario: mockScenario,
        }) // round 2
        .mockResolvedValueOnce({
          ...mockRun,
          rounds: 2,
          turns: [turn1, turn2],
          scenario: mockScenario,
          worldState: { blackSwan: { name: "Storm" } },
        }); // computeDebrief

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const updateCalls = (prisma.simulationRun.update as jest.Mock).mock.calls;
      const completionCall = updateCalls.find(
        (call) => call[0]?.data?.status === SimulationRunStatus.COMPLETED,
      );
      const summary = completionCall?.[0]?.data?.summary as {
        internalReport?: { causalChain?: Array<{ cause: string }> };
      };
      expect(
        summary?.internalReport?.causalChain?.some((c) =>
          c.cause.includes("回合"),
        ),
      ).toBe(true);
    });
  });

  describe("buildAgentSystemPrompt", () => {
    it("should include correct team role descriptions for different teams", async () => {
      const teams = [
        SimulationTeam.BLUE,
        SimulationTeam.RED,
        SimulationTeam.GREEN,
        SimulationTeam.WHITE,
        SimulationTeam.CHAOS,
      ];

      // Use 1-round run to simplify mock setup: executeRun(1) + processRound(2) + computeDebrief(3)
      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };

      for (const team of teams) {
        const teamAgent = { ...mockAgent, team };

        (externalData.getSnapshot as jest.Mock).mockResolvedValue({
          snapshot: {},
          evidence: [],
        });
        const model = { id: "m1", name: "m1", isAvailable: true };
        (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
          model,
        ]);

        let capturedMessages: Array<{ role: string; content: string }> = [];
        (aiFacade.chat as jest.Mock).mockImplementation(({ messages }) => {
          capturedMessages = messages;
          return Promise.resolve({
            isError: false,
            content: '{"innerMonologue":"t","publicAction":"a"}',
          });
        });

        (prisma.simulationRun.findUnique as jest.Mock)
          .mockResolvedValueOnce({
            ...oneRoundRun,
            scenario: { ...mockScenario, agents: [teamAgent] },
            turns: [],
          })
          .mockResolvedValueOnce({
            ...oneRoundRun,
            scenario: { ...mockScenario, agents: [teamAgent] },
          })
          .mockResolvedValueOnce({
            ...oneRoundRun,
            turns: [mockTurn],
            scenario: mockScenario,
            worldState: {},
          });

        (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
        (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

        await service.executeRun("run-1");

        const systemMsg = capturedMessages.find((m) => m.role === "system");
        expect(systemMsg?.content).toContain(mockScenario.name);

        jest.clearAllMocks();
      }
    });
  });

  describe("buildAgentUserPrompt", () => {
    it("should include black swan information in user prompt", async () => {
      const worldStateWithBlackSwan = {
        market: true,
        blackSwan: {
          name: "Supply Chain Disruption",
          description: "Major disruption",
        },
      };

      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      const model = { id: "m1", name: "m1", isAvailable: true };
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        model,
      ]);

      let capturedMessages: Array<{ role: string; content: string }> = [];
      (aiFacade.chat as jest.Mock).mockImplementation(({ messages }) => {
        capturedMessages = messages;
        return Promise.resolve({
          isError: false,
          content: '{"innerMonologue":"t","publicAction":"a"}',
        });
      });

      // 1-round run: executeRun(1) + processRound(2) + computeDebrief(3)
      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          turns: [],
        })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: mockScenario,
          worldState: worldStateWithBlackSwan,
        })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: worldStateWithBlackSwan,
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const userMsg = capturedMessages.find((m) => m.role === "user");
      expect(userMsg?.content).toContain("Supply Chain Disruption");
    });

    it("should include public memory when available", async () => {
      const agentWithMemory = {
        ...mockAgent,
        memoryPublic: { prevRound: "We attacked the northern market" },
      };

      (externalData.getSnapshot as jest.Mock).mockResolvedValue({
        snapshot: {},
        evidence: [],
      });
      const model = { id: "m1", name: "m1", isAvailable: true };
      (aiFacade.getAvailableModelsExtended as jest.Mock).mockResolvedValue([
        model,
      ]);

      let capturedMessages: Array<{ role: string; content: string }> = [];
      (aiFacade.chat as jest.Mock).mockImplementation(({ messages }) => {
        capturedMessages = messages;
        return Promise.resolve({
          isError: false,
          content: '{"innerMonologue":"t","publicAction":"a"}',
        });
      });

      // 1-round run: executeRun(1) + processRound(2) + computeDebrief(3)
      const oneRoundRun = {
        ...mockRun,
        rounds: 1,
        params: { humanBreakEvery: 0, irrationalProb: 0, chaosProb: 0 },
      };
      (prisma.simulationRun.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: { ...mockScenario, agents: [agentWithMemory] },
          turns: [],
        })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          scenario: { ...mockScenario, agents: [agentWithMemory] },
        })
        .mockResolvedValueOnce({
          ...oneRoundRun,
          turns: [mockTurn],
          scenario: mockScenario,
          worldState: {},
        });

      (prisma.simulationRun.update as jest.Mock).mockResolvedValue({});
      (prisma.simulationTurn.create as jest.Mock).mockResolvedValue(mockTurn);

      await service.executeRun("run-1");

      const userMsg = capturedMessages.find((m) => m.role === "user");
      expect(userMsg?.content).toContain("公共记忆");
    });
  });
});

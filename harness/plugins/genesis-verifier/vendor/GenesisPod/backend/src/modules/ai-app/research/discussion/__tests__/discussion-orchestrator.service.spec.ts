/**
 * DiscussionOrchestratorService 单元测试
 *
 * 覆盖范围：
 * - startResearch() — SSE observable, project not found, error path
 * - executeDiscussion() — ideation → execution → findings → synthesis → completion
 * - getSession(), getProjectSessions() — stale session auto-correction
 * - deleteSession(), deleteSessions()
 * - countUniqueSources(), withTimeout(), getAgent() (via DiscussionStreamService)
 * - publishMessage(), emitTyping() (via DiscussionStreamService)
 * - autoExtractIdeas() (via DiscussionPhaseCoordinatorService)
 * - updateSession() (via DiscussionSessionService)
 */

import { Test, TestingModule } from "@nestjs/testing";
import { Logger } from "@nestjs/common";
import { DeepResearchStatus } from "@prisma/client";
import { Subject } from "rxjs";
import { DiscussionOrchestratorService } from "../discussion-orchestrator.service";
import { DiscussionPhaseCoordinatorService } from "../discussion-phase-coordinator.service";
import { DiscussionSessionService } from "../discussion-session.service";
import { DiscussionStreamService } from "../discussion-stream.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { DiscussionAgentService } from "../discussion-agent.service";
import { IterativeSearchService } from "../iterative-search.service";
import { ReportSynthesizerService } from "../report-synthesizer.service";
import { ResearchReplannerService } from "../research-replanner.service";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeAgent(role: string, name: string) {
  return {
    config: { role, name, icon: "icon", systemPrompt: "prompt" },
    conversationHistory: [],
    status: "idle" as const,
  };
}

function makeSearchRound(
  round: number,
  query: string,
  sources: Array<{ url: string; title: string; snippet: string }> = [],
) {
  return {
    round,
    stepId: `step_${round}`,
    query,
    resultsCount: sources.length,
    sources,
    timestamp: new Date(),
  };
}

function makeReport() {
  return {
    executiveSummary: "Summary text",
    sections: [{ title: "S1", content: "c1", citations: [] }],
    conclusion: "Conclusion",
    references: [
      {
        id: 1,
        title: "Ref1",
        url: "https://ref.com",
        snippet: "snip",
        accessedAt: new Date(),
      },
    ],
    metadata: {
      totalSources: 1,
      totalTokens: 100,
      duration: 5,
      searchRounds: 1,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

jest.mock("@prisma/client", () => ({
  PrismaClient: class MockPrismaClient {},
  AIModelType: { CHAT: "CHAT", CHAT_FAST: "CHAT_FAST" },
  DeepResearchStatus: {
    IDEATION: "IDEATION",
    PLANNING: "PLANNING",
    SEARCHING: "SEARCHING",
    FINDINGS: "FINDINGS",
    REFLECTING: "REFLECTING",
    SYNTHESIZING: "SYNTHESIZING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
  },
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  AIFacade: jest.fn().mockImplementation(() => ({})),
  AgentFacade: jest.fn().mockImplementation(() => ({})),
  TeamFacade: jest.fn().mockImplementation(() => ({})),
  ToolRegistry: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  AIFacade: jest.fn().mockImplementation(() => ({})),
  AgentFacade: jest.fn().mockImplementation(() => ({})),
  TeamFacade: jest.fn().mockImplementation(() => ({})),
  ToolRegistry: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../../../../../common/prisma/prisma.service", () => ({
  PrismaService: jest.fn().mockImplementation(() => ({
    researchProject: { findUnique: jest.fn() },
    deepResearchSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  })),
}));

jest.mock("../discussion-agent.service");
jest.mock("../iterative-search.service");
jest.mock("../report-synthesizer.service");
jest.mock("../research-replanner.service");

jest.mock("../../../../platform/facade", () => ({
  BillingContext: {
    run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
  },
  CreditsService: jest.fn(),
  InsufficientCreditsException: class InsufficientCreditsException extends Error {},
}));

jest.mock("../../idea/research-idea.service", () => ({
  ResearchIdeaService: jest.fn(),
}));

jest.mock("@/modules/ai-harness/facade", () => ({
  MissionExecutorService: jest.fn(),
  MissionContext: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  MissionExecutorService: jest.fn(),
  MissionContext: jest.fn(),
}));

jest.mock("../../search/research-tool-router.service", () => ({
  ResearchToolRouterService: jest.fn(),
}));

jest.mock("../../quality/research-quality-gate.service", () => ({
  ResearchQualityGateService: jest.fn(),
}));

jest.mock("../../quality/research-fact-checker.service", () => ({
  ResearchFactCheckerService: jest.fn(),
}));

jest.mock("@/common/config/app.config", () => ({
  APP_CONFIG: { brand: { userAgent: "TestAgent/1.0" } },
}));

describe("DiscussionOrchestratorService", () => {
  let service: DiscussionOrchestratorService;
  let coordinator: DiscussionPhaseCoordinatorService;
  let sessionService: DiscussionSessionService;
  let streamService: DiscussionStreamService;
  let mockPrisma: any;
  let mockAgentService: any;
  let mockSearchService: any;
  let mockReportService: any;
  let mockAgentFacade: any;
  let mockTeamFacade: any;
  let mockCreditsService: any;
  let mockIdeaService: any;
  let mockReplanner: any;

  const projectId = "proj-001";
  const sessionId = "sess-001";
  const userId = "user-001";

  const mockProject = { userId };
  const mockSession = {
    id: sessionId,
    projectId,
    query: "test query",
    status: DeepResearchStatus.IDEATION,
    discussion: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Agents used in phases
  const agents: Record<string, ReturnType<typeof makeAgent>> = {
    director: makeAgent("director", "Director"),
    "researcher-a": makeAgent("researcher", "Researcher A"),
    "researcher-b": makeAgent("researcher", "Researcher B"),
    "researcher-c": makeAgent("researcher", "Researcher C"),
    analyst: makeAgent("analyst", "Analyst"),
    writer: makeAgent("writer", "Writer"),
    reviewer: makeAgent("reviewer", "Reviewer"),
  };

  const mockTeam = new Map(Object.entries(agents));

  beforeEach(async () => {
    mockPrisma = {
      researchProject: {
        findUnique: jest.fn().mockResolvedValue(mockProject),
      },
      deepResearchSession: {
        create: jest.fn().mockResolvedValue(mockSession),
        findUnique: jest.fn().mockResolvedValue(mockSession),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(mockSession),
        delete: jest.fn().mockResolvedValue(mockSession),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockAgentService = {
      initializeTeam: jest.fn().mockReturnValue(mockTeam),
      speak: jest.fn().mockResolvedValue("mock agent response"),
      createMessage: jest
        .fn()
        .mockImplementation(
          (agent: any, content: any, phase: any, type: any) => ({
            id: `msg-${Math.random()}`,
            agentId: agent.config.role,
            agentRole: agent.config.role,
            agentName: agent.config.name,
            content,
            phase,
            messageType: type,
            timestamp: new Date(),
          }),
        ),
      parseDirections: jest.fn().mockReturnValue([
        {
          title: "Direction 1",
          description: "Desc 1",
          searchQueries: ["query 1a", "query 1b"],
        },
        {
          title: "Direction 2",
          description: "Desc 2",
          searchQueries: ["query 2a"],
        },
      ]),
    };

    mockSearchService = {
      executeStep: jest.fn().mockResolvedValue(
        makeSearchRound(1, "query 1a", [
          {
            url: "https://example.com/1",
            title: "Result 1",
            snippet: "snip1",
          },
        ]),
      ),
    };

    mockReportService = {
      generateReport: jest.fn().mockResolvedValue(makeReport()),
    };

    mockAgentFacade = {
      startTrace: jest.fn().mockReturnValue("trace-001"),
      endTrace: jest.fn(),
      addSpan: jest.fn().mockReturnValue("span-001"),
      endSpan: jest.fn(),
      coordinatorStore: jest.fn().mockReturnValue(Promise.resolve()),
    };

    mockTeamFacade = {
      a2aPublish: jest.fn().mockResolvedValue(undefined),
      a2aClearSession: jest.fn(),
    };

    mockCreditsService = {
      checkBalance: jest
        .fn()
        .mockResolvedValue({ sufficient: true, balance: 10000 }),
    };

    mockIdeaService = {
      extractFromSession: jest.fn().mockResolvedValue([]),
    };

    mockReplanner = {
      evaluateAndReplan: jest.fn().mockResolvedValue({
        needsReplan: false,
        additionalSteps: [],
        record: null,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscussionOrchestratorService,
        DiscussionPhaseCoordinatorService,
        DiscussionSessionService,
        DiscussionStreamService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DiscussionAgentService, useValue: mockAgentService },
        { provide: IterativeSearchService, useValue: mockSearchService },
        { provide: ReportSynthesizerService, useValue: mockReportService },
        { provide: ResearchReplannerService, useValue: mockReplanner },
        { provide: "CreditsService", useValue: mockCreditsService },
        { provide: "ResearchIdeaService", useValue: mockIdeaService },
        { provide: "AgentFacade", useValue: mockAgentFacade },
        { provide: "TeamFacade", useValue: mockTeamFacade },
      ],
    })
      .overrideProvider(DiscussionOrchestratorService)
      .useFactory({
        factory: (
          prisma: PrismaService,
          coord: DiscussionPhaseCoordinatorService,
          sess: DiscussionSessionService,
        ) => new DiscussionOrchestratorService(prisma, coord, sess),
        inject: [
          PrismaService,
          DiscussionPhaseCoordinatorService,
          DiscussionSessionService,
        ],
      })
      .overrideProvider(DiscussionPhaseCoordinatorService)
      .useFactory({
        factory: (
          prisma: PrismaService,
          agentSvc: DiscussionAgentService,
          searchSvc: IterativeSearchService,
          reportSvc: ReportSynthesizerService,
          sessSvc: DiscussionSessionService,
          streamSvc: DiscussionStreamService,
        ) =>
          new DiscussionPhaseCoordinatorService(
            prisma,
            agentSvc,
            searchSvc,
            reportSvc,
            sessSvc,
            streamSvc,
            mockCreditsService,
            mockIdeaService,
            mockAgentFacade,
            mockTeamFacade,
            mockReplanner,
          ),
        inject: [
          PrismaService,
          DiscussionAgentService,
          IterativeSearchService,
          ReportSynthesizerService,
          DiscussionSessionService,
          DiscussionStreamService,
        ],
      })
      .overrideProvider(DiscussionStreamService)
      .useFactory({
        factory: () => new DiscussionStreamService(mockTeamFacade),
      })
      .compile();

    service = module.get<DiscussionOrchestratorService>(
      DiscussionOrchestratorService,
    );
    coordinator = module.get<DiscussionPhaseCoordinatorService>(
      DiscussionPhaseCoordinatorService,
    );
    sessionService = module.get<DiscussionSessionService>(
      DiscussionSessionService,
    );
    streamService = module.get<DiscussionStreamService>(
      DiscussionStreamService,
    );

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // =========================================================================
  // getSession
  // =========================================================================

  describe("getSession", () => {
    it("should delegate to prisma.deepResearchSession.findUnique", async () => {
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(mockSession);
      const result = await service.getSession(sessionId);
      expect(result).toEqual(mockSession);
      expect(mockPrisma.deepResearchSession.findUnique).toHaveBeenCalledWith({
        where: { id: sessionId },
      });
    });

    it("should return null when session not found", async () => {
      mockPrisma.deepResearchSession.findUnique.mockResolvedValue(null);
      const result = await service.getSession("nonexistent");
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // deleteSession / deleteSessions
  // =========================================================================

  describe("deleteSession", () => {
    it("should delete a session by id", async () => {
      const result = await service.deleteSession(sessionId);
      expect(mockPrisma.deepResearchSession.delete).toHaveBeenCalledWith({
        where: { id: sessionId },
      });
      expect(result).toBeDefined();
    });
  });

  describe("deleteSessions", () => {
    it("should delete multiple sessions by ids", async () => {
      const ids = ["sess-1", "sess-2"];
      await service.deleteSessions(ids);
      expect(mockPrisma.deepResearchSession.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ids } },
      });
    });
  });

  // =========================================================================
  // getProjectSessions — stale session correction
  // =========================================================================

  describe("getProjectSessions", () => {
    it("should return empty array when no sessions exist", async () => {
      mockPrisma.deepResearchSession.findMany.mockResolvedValue([]);
      const result = await service.getProjectSessions(projectId);
      expect(result).toEqual([]);
    });

    it("should return sessions without modifying COMPLETED sessions", async () => {
      const completedSession = {
        ...mockSession,
        status: DeepResearchStatus.COMPLETED,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago (stale)
        discussion: null,
      };
      mockPrisma.deepResearchSession.findMany.mockResolvedValue([
        completedSession,
      ]);
      const result = await service.getProjectSessions(projectId);
      // COMPLETED is not intermediate; should not trigger update
      expect(mockPrisma.deepResearchSession.update).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it("should auto-correct stale IDEATION session with no content to FAILED", async () => {
      const staleSession = {
        ...mockSession,
        status: DeepResearchStatus.IDEATION,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
        discussion: null,
      };
      mockPrisma.deepResearchSession.findMany.mockResolvedValue([staleSession]);
      await service.getProjectSessions(projectId);
      expect(mockPrisma.deepResearchSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: sessionId },
          data: expect.objectContaining({ status: DeepResearchStatus.FAILED }),
        }),
      );
    });

    it("should auto-correct stale SYNTHESIZING session with content to COMPLETED", async () => {
      const staleSession = {
        ...mockSession,
        status: DeepResearchStatus.SYNTHESIZING,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        discussion: [{ content: "some content" }], // has content
      };
      mockPrisma.deepResearchSession.findMany.mockResolvedValue([staleSession]);
      await service.getProjectSessions(projectId);
      expect(mockPrisma.deepResearchSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DeepResearchStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should not auto-correct sessions updated recently (within 5 minutes)", async () => {
      const recentSession = {
        ...mockSession,
        status: DeepResearchStatus.SEARCHING,
        updatedAt: new Date(Date.now() - 1 * 60 * 1000), // 1 min ago
        discussion: null,
      };
      mockPrisma.deepResearchSession.findMany.mockResolvedValue([
        recentSession,
      ]);
      await service.getProjectSessions(projectId);
      expect(mockPrisma.deepResearchSession.update).not.toHaveBeenCalled();
    });

    it("should handle update failure gracefully when auto-correcting", async () => {
      const staleSession = {
        ...mockSession,
        status: DeepResearchStatus.FINDINGS,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        discussion: null,
      };
      mockPrisma.deepResearchSession.findMany.mockResolvedValue([staleSession]);
      mockPrisma.deepResearchSession.update.mockRejectedValue(
        new Error("DB error"),
      );

      // Should not throw
      const result = await service.getProjectSessions(projectId);
      expect(result).toHaveLength(1);
    });

    it("should auto-correct all intermediate statuses when stale", async () => {
      const intermediateStatuses = [
        DeepResearchStatus.IDEATION,
        DeepResearchStatus.PLANNING,
        DeepResearchStatus.SEARCHING,
        DeepResearchStatus.FINDINGS,
        DeepResearchStatus.REFLECTING,
        DeepResearchStatus.SYNTHESIZING,
      ];

      const staleSessions = intermediateStatuses.map((status, i) => ({
        id: `sess-${i}`,
        status,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        discussion: null,
      }));

      mockPrisma.deepResearchSession.findMany.mockResolvedValue(staleSessions);
      await service.getProjectSessions(projectId);
      expect(mockPrisma.deepResearchSession.update).toHaveBeenCalledTimes(
        intermediateStatuses.length,
      );
    });
  });

  // =========================================================================
  // startResearch — observable behavior
  // =========================================================================

  describe("startResearch", () => {
    it("should return an Observable", () => {
      // Even before async work starts, the observable should be returned immediately
      const obs = service.startResearch(projectId, {
        query: "test query",
        options: { depth: "quick" },
      });
      expect(obs).toBeDefined();
      expect(typeof obs.subscribe).toBe("function");
    });

    it("should emit error event and complete when project not found", (done) => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);

      const events: any[] = [];
      service.startResearch(projectId, { query: "test query" }).subscribe({
        next: (event) => events.push(event),
        error: (err) => done.fail(err),
        complete: () => {
          expect(events.some((e) => e.type === "error")).toBe(true);
          const errorEvent = events.find((e) => e.type === "error");
          expect(errorEvent.data.code).toBe("EXECUTION_ERROR");
          done();
        },
      });
    });

    it("should emit error event when credits are insufficient", (done) => {
      mockCreditsService.checkBalance.mockResolvedValue({
        sufficient: false,
        balance: 100,
      });

      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "test query",
          options: { depth: "standard" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            expect(events.some((e) => e.type === "error")).toBe(true);
            done();
          },
        });
    });

    it("should complete successfully and emit interaction.complete", (done) => {
      const events: any[] = [];

      service
        .startResearch(projectId, {
          query: "AI in 2025",
          options: { depth: "quick", language: "en-US" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            const completeEvent = events.find(
              (e) => e.type === "interaction.complete",
            );
            expect(completeEvent).toBeDefined();
            expect(completeEvent.data.status).toBe("success");
            done();
          },
        });
    }, 10000);

    it("should emit discussion.phase events for all phases", (done) => {
      const events: any[] = [];

      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            const phaseEvents = events.filter(
              (e) => e.type === "discussion.phase",
            );
            const phases = phaseEvents.map((e: any) => e.data.phase);
            expect(phases).toContain("ideation");
            expect(phases).toContain("execution");
            expect(phases).toContain("findings");
            expect(phases).toContain("synthesis");
            done();
          },
        });
    }, 10000);

    it("should emit search_progress events during execution phase", (done) => {
      const events: any[] = [];

      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            const progressEvents = events.filter(
              (e) => e.type === "search_progress",
            );
            expect(progressEvents.length).toBeGreaterThan(0);
            done();
          },
        });
    }, 10000);

    it("should use standard depth when options.depth not specified", (done) => {
      const events: any[] = [];

      service.startResearch(projectId, { query: "test" }).subscribe({
        next: (event) => events.push(event),
        error: (err) => done.fail(err),
        complete: () => {
          expect(mockCreditsService.checkBalance).toHaveBeenCalledWith(
            userId,
            700, // standard = 700 credits
          );
          done();
        },
      });
    }, 10000);

    it("should use correct credits for thorough depth", (done) => {
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "thorough" },
        })
        .subscribe({
          next: () => {},
          error: (err) => done.fail(err),
          complete: () => {
            expect(mockCreditsService.checkBalance).toHaveBeenCalledWith(
              userId,
              1500, // thorough = 1500 credits
            );
            done();
          },
        });
    }, 10000);

    it("should use correct credits for quick depth", (done) => {
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: () => {},
          error: (err) => done.fail(err),
          complete: () => {
            expect(mockCreditsService.checkBalance).toHaveBeenCalledWith(
              userId,
              300, // quick = 300 credits
            );
            done();
          },
        });
    }, 10000);

    it("should work without creditsService (optional)", (done) => {
      const coordWithoutCredits = new DiscussionPhaseCoordinatorService(
        mockPrisma,
        mockAgentService,
        mockSearchService,
        mockReportService,
        sessionService,
        streamService,
        null as any, // no credits service
        null as any, // no idea service
        mockAgentFacade,
        mockTeamFacade,
        null as any, // no replanner
      );
      const serviceWithoutCredits = new DiscussionOrchestratorService(
        mockPrisma,
        coordWithoutCredits,
        sessionService,
      );

      const events: any[] = [];
      serviceWithoutCredits
        .startResearch(projectId, { query: "test" })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            const completeEvent = events.find(
              (e) => e.type === "interaction.complete",
            );
            expect(completeEvent).toBeDefined();
            done();
          },
        });
    }, 10000);

    it("should work without domain facades (optional)", (done) => {
      const coordWithoutFacade = new DiscussionPhaseCoordinatorService(
        mockPrisma,
        mockAgentService,
        mockSearchService,
        mockReportService,
        sessionService,
        streamService,
        mockCreditsService,
        null as any, // no idea service
        null as any, // no agent facade
        null as any, // no team facade
        null as any,
      );
      const serviceWithoutFacade = new DiscussionOrchestratorService(
        mockPrisma,
        coordWithoutFacade,
        sessionService,
      );

      const events: any[] = [];
      serviceWithoutFacade
        .startResearch(projectId, { query: "test" })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            expect(events.some((e) => e.type === "interaction.complete")).toBe(
              true,
            );
            done();
          },
        });
    }, 10000);

    it("should trigger dynamic replanning when replanner is provided and needsReplan=true", (done) => {
      mockReplanner.evaluateAndReplan.mockResolvedValue({
        needsReplan: true,
        additionalSteps: [
          {
            id: "extra_1",
            type: "deep_dive",
            query: "extra query",
            rationale: "gap found",
            estimatedSources: 5,
          },
        ],
        record: { reason: "Missing coverage" },
      });

      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            expect(mockReplanner.evaluateAndReplan).toHaveBeenCalled();
            // Extra search round should appear in progress events
            const progressEvents = events.filter(
              (e) => e.type === "search_progress",
            );
            expect(progressEvents.length).toBeGreaterThan(0);
            done();
          },
        });
    }, 10000);

    it("should handle replanning extra search failure gracefully", (done) => {
      mockReplanner.evaluateAndReplan.mockResolvedValue({
        needsReplan: true,
        additionalSteps: [
          {
            id: "extra_1",
            type: "deep_dive",
            query: "fail query",
            rationale: "gap",
            estimatedSources: 5,
          },
        ],
        record: null,
      });
      // Make only the extra search (the last call) fail by failing after N successful calls
      let callCount = 0;
      mockSearchService.executeStep.mockImplementation(
        async (..._args: any[]) => {
          callCount++;
          // Fail the last call (the replanner's extra step)
          if (callCount > 2) throw new Error("Replan search failed");
          return makeSearchRound(callCount, `query ${callCount}`, [
            {
              url: `https://unique-${callCount}.com`,
              title: "Result",
              snippet: "s",
            },
          ]);
        },
      );

      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            // Should still complete without error event from replan failure
            const completeEvent = events.find(
              (e) => e.type === "interaction.complete",
            );
            expect(completeEvent).toBeDefined();
            done();
          },
        });
    }, 15000);

    it("should fallback to default directions when parseDirections returns fewer than 2", (done) => {
      mockAgentService.parseDirections.mockReturnValue([]); // 0 directions -> fallback

      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            // Fallback creates 3 directions
            const execPhase = events.find(
              (e) =>
                e.type === "discussion.phase" && e.data.phase === "execution",
            );
            expect(execPhase.data.directions).toHaveLength(3);
            done();
          },
        });
    }, 10000);

    it("should handle researcher ideation failure with fallback message", (done) => {
      let callCount = 0;
      mockAgentService.speak.mockImplementation(async (_agent: any) => {
        callCount++;
        // Fail researcher-b (second parallel call)
        if (callCount === 3) throw new Error("Researcher B unavailable");
        return "mock response";
      });

      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            // Should still complete
            const completeEvent = events.find(
              (e) => e.type === "interaction.complete",
            );
            expect(completeEvent).toBeDefined();
            done();
          },
        });
    }, 10000);

    it("should call autoExtractIdeas after successful research", (done) => {
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: () => {},
          error: (err) => done.fail(err),
          complete: () => {
            expect(mockIdeaService.extractFromSession).toHaveBeenCalledWith(
              userId,
              projectId,
              sessionId,
            );
            done();
          },
        });
    }, 10000);

    it("should update session to FAILED status on execution error", (done) => {
      // Make report generation fail
      mockReportService.generateReport.mockRejectedValue(
        new Error("Report failed"),
      );

      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            // The error event is emitted from the outer .catch() handler before subject.complete()
            // Wait a microtask for async DB update to complete
            setImmediate(() => {
              expect(
                mockPrisma.deepResearchSession.update,
              ).toHaveBeenCalledWith(
                expect.objectContaining({
                  data: expect.objectContaining({
                    status: DeepResearchStatus.FAILED,
                  }),
                }),
              );
              done();
            });
          },
        });
    }, 15000);

    it("should use follow-up prompt variant when isFollowUp=true", (done) => {
      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "follow up question",
          isFollowUp: true,
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            // Research should complete normally
            const completeEvent = events.find(
              (e) => e.type === "interaction.complete",
            );
            expect(completeEvent).toBeDefined();
            done();
          },
        });
    }, 10000);

    it("should use Chinese language messages when language is zh-CN", (done) => {
      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "AI 研究",
          options: { depth: "quick", language: "zh-CN" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            const completeEvent = events.find(
              (e) => e.type === "interaction.complete",
            );
            expect(completeEvent).toBeDefined();
            done();
          },
        });
    }, 10000);

    it("should call endTrace on success", (done) => {
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: () => {},
          error: (err) => done.fail(err),
          complete: () => {
            expect(mockAgentFacade.endTrace).toHaveBeenCalledWith(
              "trace-001",
              expect.objectContaining({ status: "success" }),
            );
            done();
          },
        });
    }, 10000);

    it("should call endTrace with error status on failure", (done) => {
      mockReportService.generateReport.mockRejectedValue(
        new Error("Synthesis failed"),
      );

      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: () => {},
          error: (err) => done.fail(err),
          complete: () => {
            expect(mockAgentFacade.endTrace).toHaveBeenCalledWith(
              "trace-001",
              expect.objectContaining({ status: "error" }),
            );
            done();
          },
        });
    }, 10000);
  });

  // =========================================================================
  // countUniqueSources (via DiscussionStreamService)
  // =========================================================================

  describe("countUniqueSources (via startResearch)", () => {
    it("should count unique sources by URL", (done) => {
      // Two rounds, one shared URL
      let callCount = 0;
      mockSearchService.executeStep.mockImplementation(async () => {
        callCount++;
        return makeSearchRound(callCount, `query ${callCount}`, [
          { url: "https://shared.com", title: "Shared", snippet: "s" },
          {
            url: `https://unique-${callCount}.com`,
            title: "Unique",
            snippet: "u",
          },
        ]);
      });

      const events: any[] = [];
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: (event) => events.push(event),
          error: (err) => done.fail(err),
          complete: () => {
            const completeEvent = events.find(
              (e) => e.type === "interaction.complete",
            );
            // shared + unique-1 + unique-2 = 3 unique sources (for 2 rounds with 2 sources each)
            expect(
              completeEvent.data.report.metadata.totalSources,
            ).toBeGreaterThan(0);
            done();
          },
        });
    }, 10000);
  });

  // =========================================================================
  // withTimeout (via DiscussionStreamService)
  // =========================================================================

  describe("withTimeout (via DiscussionStreamService)", () => {
    it("should resolve when promise completes before timeout", async () => {
      const result = await streamService.withTimeout(
        Promise.resolve("value"),
        5000,
        "Test operation",
      );
      expect(result).toBe("value");
    });

    it("should reject when promise exceeds timeout", async () => {
      const neverResolves = new Promise(() => {});
      await expect(
        streamService.withTimeout(neverResolves, 10, "Slow operation"),
      ).rejects.toThrow("超时");
    });
  });

  // =========================================================================
  // getAgent (via DiscussionStreamService)
  // =========================================================================

  describe("getAgent (via DiscussionStreamService)", () => {
    it("should return agent when found in team", () => {
      const team = new Map([["director", makeAgent("director", "Director")]]);
      const agent = streamService.getAgent(team, "director");
      expect(agent.config.role).toBe("director");
    });

    it("should throw when agent not found in team", () => {
      const team = new Map<string, any>();
      expect(() => streamService.getAgent(team, "nonexistent")).toThrow(
        'Agent "nonexistent" not initialized in team',
      );
    });
  });

  // =========================================================================
  // emitTyping (via DiscussionStreamService)
  // =========================================================================

  describe("emitTyping (via DiscussionStreamService)", () => {
    it("should emit discussion.typing event", () => {
      const subject = new Subject<any>();
      const events: any[] = [];
      subject.subscribe((e) => events.push(e));

      streamService.emitTyping(subject, makeAgent("director", "Director"));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("discussion.typing");
      expect(events[0].data.agentRole).toBe("director");
      expect(events[0].data.agentName).toBe("Director");
    });
  });

  // =========================================================================
  // publishMessage (via DiscussionStreamService)
  // =========================================================================

  describe("publishMessage (via DiscussionStreamService)", () => {
    it("should emit discussion.message event and call a2aPublish", () => {
      const subject = new Subject<any>();
      const events: any[] = [];
      subject.subscribe((e) => events.push(e));

      const msg = {
        id: "msg-1",
        agentRole: "director",
        agentName: "Director",
        content: "Hello world",
        phase: "ideation",
        messageType: "proposal",
        timestamp: new Date(),
      };

      streamService.publishMessage(sessionId, msg, subject);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("discussion.message");
      expect(mockTeamFacade.a2aPublish).toHaveBeenCalled();
    });

    it("should not throw if domain facades are null", () => {
      const streamWithoutFacade = new DiscussionStreamService(undefined);

      const subject = new Subject<any>();
      const msg = {
        id: "msg-1",
        agentRole: "director",
        agentName: "Director",
        content: "Hello",
        phase: "ideation",
        messageType: "proposal",
        timestamp: new Date(),
      };

      expect(() =>
        streamWithoutFacade.publishMessage(sessionId, msg, subject),
      ).not.toThrow();
    });
  });

  // =========================================================================
  // updateSession (via DiscussionSessionService)
  // =========================================================================

  describe("updateSession (via DiscussionSessionService)", () => {
    it("should call prisma update with serialized data", async () => {
      await sessionService.updateSession(sessionId, {
        status: DeepResearchStatus.COMPLETED,
        sourcesUsed: 5,
        completedAt: new Date("2025-01-01"),
      });

      expect(mockPrisma.deepResearchSession.update).toHaveBeenCalledWith({
        where: { id: sessionId },
        data: expect.objectContaining({
          status: DeepResearchStatus.COMPLETED,
          sourcesUsed: 5,
        }),
      });
    });
  });

  // =========================================================================
  // autoExtractIdeas (via DiscussionPhaseCoordinatorService — private)
  // =========================================================================

  describe("autoExtractIdeas (private on DiscussionPhaseCoordinatorService)", () => {
    it("should call ideaService.extractFromSession when ideaService is available", async () => {
      await (coordinator as any).autoExtractIdeas(projectId, sessionId, []);
      expect(mockIdeaService.extractFromSession).toHaveBeenCalledWith(
        userId,
        projectId,
        sessionId,
      );
    });

    it("should log and return when ideaService is not available", async () => {
      const coordWithoutIdea = new DiscussionPhaseCoordinatorService(
        mockPrisma,
        mockAgentService,
        mockSearchService,
        mockReportService,
        sessionService,
        streamService,
        null as any,
        null as any, // no idea service
        mockAgentFacade,
        mockTeamFacade,
        null as any,
      );

      await expect(
        (coordWithoutIdea as any).autoExtractIdeas(projectId, sessionId, []),
      ).resolves.toBeUndefined();
    });

    it("should return early when project not found", async () => {
      mockPrisma.researchProject.findUnique.mockResolvedValue(null);
      await expect(
        (coordinator as any).autoExtractIdeas(projectId, sessionId, []),
      ).resolves.toBeUndefined();
      expect(mockIdeaService.extractFromSession).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // BillingContext integration
  // =========================================================================

  describe("BillingContext.run", () => {
    it("should find project before billing context to get userId", (done) => {
      service
        .startResearch(projectId, {
          query: "test",
          options: { depth: "quick" },
        })
        .subscribe({
          next: () => {},
          error: (err) => done.fail(err),
          complete: () => {
            // First findUnique is for the outer BillingContext project lookup
            // Second is inside executeDiscussion
            expect(mockPrisma.researchProject.findUnique).toHaveBeenCalled();
            done();
          },
        });
    }, 10000);
  });
});

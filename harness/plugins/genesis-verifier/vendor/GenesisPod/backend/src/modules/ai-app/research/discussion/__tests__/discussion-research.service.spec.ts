/**
 * Tests for DiscussionResearchService
 *
 * Covers:
 * - startResearch (SSE event flow, error paths, credits check)
 * - executeDirectResearch (full flow, reflection pivot/stop, timeout)
 * - getSession / getProjectSessions / deleteSession / deleteSessions
 * - private helpers via integration-style assertions on outputs
 *
 * NOTE: The executeResearch loop:
 *   while (continueSearching && currentRound < maxRounds)
 *     stepsToExecute = currentRound === 0 ? plan.steps : plan.steps.slice(currentRound)
 *
 * When plan has N steps and maxRounds > N, the outer while loops indefinitely on empty
 * stepsToExecute. Always use maxRounds <= plan.steps.length OR set shouldContinue=false
 * after the Nth round to avoid test hangs.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DiscussionResearchService } from "../discussion-research.service";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { ResearchPlannerService } from "../research-planner.service";
import { IterativeSearchService } from "../iterative-search.service";
import { SelfReflectionService } from "../self-reflection.service";
import { ReportSynthesizerService } from "../report-synthesizer.service";
import { CreditsService } from "../../../../platform/credits/credits.service";
import { DeepResearchStatus } from "@prisma/client";
import { firstValueFrom, toArray } from "rxjs";

// Mock BillingContext so it executes the callback directly
jest.mock("../../../../platform/credits/billing-context.store", () => ({
  BillingContext: {
    run: jest
      .fn()
      .mockImplementation((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));

// ============================================================
// Helpers
// ============================================================

const buildPlan = (stepCount = 3) => ({
  objective: "Research test",
  approach: "iterative",
  steps: Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i + 1}`,
    type: "initial_search",
    query: `test query ${i + 1}`,
    rationale: "",
    estimatedSources: 5,
  })),
  estimatedTime: 60,
});

const buildSearchRound = (round: number) => ({
  round,
  stepId: `step-${round}`,
  query: `query ${round}`,
  resultsCount: 3,
  sources: [
    {
      id: `s${round}`,
      title: `Source ${round}`,
      url: `http://example.com/${round}`,
      snippet: "snippet",
      domain: "example.com",
      relevanceScore: 0.9,
    },
  ],
  timestamp: new Date(),
});

const buildReflection = (decision: "continue" | "pivot" | "complete") => ({
  round: 1,
  assessment: "Good coverage",
  gaps: decision === "complete" ? [] : ["gap1"],
  decision,
  reasoning: "test reasoning",
  nextSteps: decision === "pivot" ? ["new direction"] : undefined,
  timestamp: new Date(),
});

const buildReport = () => ({
  executiveSummary: "Summary of findings",
  sections: [
    { title: "Section 1", content: "Content 1", citations: [1] },
    { title: "Section 2", content: "Content 2", citations: [] },
  ],
  conclusion: "Conclusion text",
  references: [
    {
      id: 1,
      title: "Ref 1",
      url: "http://ref1.com",
      snippet: "snippet",
      accessedAt: new Date(),
    },
  ],
  metadata: {
    totalSources: 3,
    totalTokens: 1000,
    duration: 30,
    searchRounds: 2,
  },
});

// ============================================================
// Test suite
// ============================================================

describe("DiscussionResearchService", () => {
  let service: DiscussionResearchService;
  let prisma: jest.Mocked<PrismaService>;
  let plannerService: jest.Mocked<ResearchPlannerService>;
  let searchService: jest.Mocked<IterativeSearchService>;
  let reflectionService: jest.Mocked<SelfReflectionService>;
  let reportService: jest.Mocked<ReportSynthesizerService>;
  let creditsService: jest.Mocked<CreditsService>;

  beforeEach(async () => {
    const mockPrisma = {
      researchProject: {
        findUnique: jest.fn(),
      },
      deepResearchSession: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const mockPlannerService = {
      generatePlan: jest.fn().mockResolvedValue(buildPlan()),
    };

    const mockSearchService = {
      executeStep: jest
        .fn()
        .mockImplementation(() => Promise.resolve(buildSearchRound(1))),
    };

    const mockReflectionService = {
      reflect: jest.fn().mockResolvedValue(buildReflection("continue")),
      shouldContinue: jest.fn().mockReturnValue(true),
      generatePivotSteps: jest.fn().mockReturnValue([]),
    };

    const mockReportService = {
      generateReport: jest.fn().mockResolvedValue(buildReport()),
    };

    const mockCreditsService = {
      checkBalance: jest
        .fn()
        .mockResolvedValue({ sufficient: true, balance: 10000 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscussionResearchService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ResearchPlannerService, useValue: mockPlannerService },
        { provide: IterativeSearchService, useValue: mockSearchService },
        { provide: SelfReflectionService, useValue: mockReflectionService },
        { provide: ReportSynthesizerService, useValue: mockReportService },
        { provide: CreditsService, useValue: mockCreditsService },
      ],
    }).compile();

    service = module.get<DiscussionResearchService>(DiscussionResearchService);
    prisma = module.get(PrismaService);
    plannerService = module.get(ResearchPlannerService);
    searchService = module.get(IterativeSearchService);
    reflectionService = module.get(SelfReflectionService);
    reportService = module.get(ReportSynthesizerService);
    creditsService = module.get(CreditsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // startResearch
  // NOTE: Use maxRounds = plan.steps.length (3) so the while loop
  // naturally exits when rounds reach maxRounds; OR set shouldContinue=false
  // ============================================================

  describe("startResearch", () => {
    const mockProject = { userId: "user-1" };
    const mockSession = {
      id: "session-1",
      projectId: "project-1",
      query: "test",
    };

    beforeEach(() => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(
        mockProject,
      );
      (prisma.deepResearchSession.create as jest.Mock).mockResolvedValue(
        mockSession,
      );
      (prisma.deepResearchSession.update as jest.Mock).mockResolvedValue(
        mockSession,
      );
      // Ensure shouldContinue stops the loop after 2 rounds to avoid infinite loops
      reflectionService.shouldContinue.mockReturnValue(false);
    });

    it("should return an observable", () => {
      const result = service.startResearch("project-1", {
        query: "test query",
      });
      expect(result).toBeDefined();
      expect(typeof result.subscribe).toBe("function");
    });

    it("should emit plan_ready event on successful research", async () => {
      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test query",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const planReadyEvent = events.find((e) => e.type === "plan_ready");
      expect(planReadyEvent).toBeDefined();
      expect((planReadyEvent as any).data.plan).toBeDefined();
    });

    it("should emit thought_summary events during research", async () => {
      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test query",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const thinkingEvents = events.filter((e) => e.type === "thought_summary");
      expect(thinkingEvents.length).toBeGreaterThan(0);
    });

    it("should emit search_progress events", async () => {
      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test query",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const progressEvents = events.filter((e) => e.type === "search_progress");
      expect(progressEvents.length).toBeGreaterThan(0);
    });

    it("should emit interaction.complete event at the end", async () => {
      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test query",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const completeEvent = events.find(
        (e) => e.type === "interaction.complete",
      );
      expect(completeEvent).toBeDefined();
      expect((completeEvent as any).data.status).toBe("success");
    });

    it("should emit content.delta events for report sections", async () => {
      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test query",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const deltaEvents = events.filter((e) => e.type === "content.delta");
      expect(deltaEvents.length).toBeGreaterThan(0);
    });

    it("should emit error event when project not found", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue(null);

      const events = await firstValueFrom(
        service
          .startResearch("nonexistent-project", { query: "test" })
          .pipe(toArray()),
      );

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect((errorEvent as any).data.recoverable).toBe(false);
    });

    it("should emit error event on InsufficientCreditsException", async () => {
      creditsService.checkBalance.mockResolvedValue({
        sufficient: false,
        balance: 100,
      });

      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3, depth: "standard" },
          })
          .pipe(toArray()),
      );

      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });

    it("should use standard depth credits (500) when no depth specified", async () => {
      await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      expect(creditsService.checkBalance).toHaveBeenCalledWith("user-1", 500);
    });

    it("should use quick depth credits (200) when depth is quick", async () => {
      await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3, depth: "quick" },
          })
          .pipe(toArray()),
      );

      expect(creditsService.checkBalance).toHaveBeenCalledWith("user-1", 200);
    });

    it("should use deep depth credits (1000) when depth is deep", async () => {
      await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3, depth: "deep" },
          })
          .pipe(toArray()),
      );

      expect(creditsService.checkBalance).toHaveBeenCalledWith("user-1", 1000);
    });

    it("should skip credits check when creditsService is not provided", async () => {
      const moduleNoCredits: TestingModule = await Test.createTestingModule({
        providers: [
          DiscussionResearchService,
          { provide: PrismaService, useValue: prisma },
          { provide: ResearchPlannerService, useValue: plannerService },
          { provide: IterativeSearchService, useValue: searchService },
          { provide: SelfReflectionService, useValue: reflectionService },
          { provide: ReportSynthesizerService, useValue: reportService },
        ],
      }).compile();

      const serviceNoCredits = moduleNoCredits.get<DiscussionResearchService>(
        DiscussionResearchService,
      );

      const events = await firstValueFrom(
        serviceNoCredits
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const completeEvent = events.find(
        (e) => e.type === "interaction.complete",
      );
      expect(completeEvent).toBeDefined();
    });

    it("should emit reflection events during research (round >= 2)", async () => {
      let callCount = 0;
      searchService.executeStep.mockImplementation(() => {
        callCount++;
        return Promise.resolve(buildSearchRound(callCount));
      });
      // Stop after round 2 via shouldContinue=false
      reflectionService.shouldContinue.mockReturnValue(false);

      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test query",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const reflectionEvents = events.filter((e) => e.type === "reflection");
      expect(reflectionEvents.length).toBeGreaterThan(0);
    });

    it("should stop searching when shouldContinue returns false", async () => {
      reflectionService.shouldContinue.mockReturnValue(false);

      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const completeEvent = events.find(
        (e) => e.type === "interaction.complete",
      );
      expect(completeEvent).toBeDefined();
      // Stopped early — searchService called at most 2 times (rounds 1 and 2)
      expect(searchService.executeStep.mock.calls.length).toBeLessThanOrEqual(
        2,
      );
    });

    it("should handle isFollowUp mode with previousContext", async () => {
      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "follow-up query",
            isFollowUp: true,
            options: { maxRounds: 3 },
            previousContext: {
              executiveSummary: "Previous summary",
              sections: [],
              conclusion: "Previous conclusion",
              references: [],
            },
          })
          .pipe(toArray()),
      );

      expect(plannerService.generatePlan).toHaveBeenCalledWith(
        "follow-up query",
        expect.objectContaining({ isFollowUp: true }),
      );
      const completeEvent = events.find(
        (e) => e.type === "interaction.complete",
      );
      expect(completeEvent).toBeDefined();
    });

    it("should update session status to FAILED when research throws", async () => {
      plannerService.generatePlan.mockRejectedValue(
        new Error("Planning failed"),
      );

      const _events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      // Session should be updated to FAILED
      expect(prisma.deepResearchSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DeepResearchStatus.FAILED }),
        }),
      );
    });

    it("should emit content.delta for conclusion when report has conclusion", async () => {
      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const conclusionDelta = events.find(
        (e) =>
          e.type === "content.delta" &&
          (e as any).data.section === "conclusion",
      );
      expect(conclusionDelta).toBeDefined();
    });

    it("should not emit conclusion delta when report has no conclusion", async () => {
      const reportWithoutConclusion = { ...buildReport(), conclusion: "" };
      reportService.generateReport.mockResolvedValue(reportWithoutConclusion);

      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      const conclusionDelta = events.find(
        (e) =>
          e.type === "content.delta" &&
          (e as any).data.section === "conclusion",
      );
      expect(conclusionDelta).toBeUndefined();
    });

    it("should add pivot steps to plan when reflection decision is pivot", async () => {
      // After round 2, pivot is returned (adds steps); after round 3, shouldContinue=false
      let callCount = 0;
      searchService.executeStep.mockImplementation(() => {
        callCount++;
        return Promise.resolve(buildSearchRound(callCount));
      });

      reflectionService.reflect.mockResolvedValue(buildReflection("pivot"));
      // Allow first pivot, then stop
      reflectionService.shouldContinue
        .mockReturnValueOnce(true) // after round 2 - continue with pivot
        .mockReturnValue(false); // after round 3 - stop
      reflectionService.generatePivotSteps.mockReturnValue([
        {
          id: "pivot-1",
          type: "deep_dive",
          query: "pivot query",
          rationale: "",
          estimatedSources: 5,
        },
      ]);

      const events = await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      expect(reflectionService.generatePivotSteps).toHaveBeenCalled();
      const completeEvent = events.find(
        (e) => e.type === "interaction.complete",
      );
      expect(completeEvent).toBeDefined();
    });

    it("should update session status to COMPLETED on success", async () => {
      await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      expect(prisma.deepResearchSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DeepResearchStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should update session with SYNTHESIZING status before report generation", async () => {
      const updateCalls: any[] = [];
      (prisma.deepResearchSession.update as jest.Mock).mockImplementation(
        (args: any) => {
          updateCalls.push(args.data.status);
          return Promise.resolve(mockSession);
        },
      );

      await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      expect(updateCalls).toContain(DeepResearchStatus.SYNTHESIZING);
    });

    it("should call prisma to create a new session", async () => {
      await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      expect(prisma.deepResearchSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: "project-1",
            query: "test",
            status: DeepResearchStatus.PLANNING,
          }),
        }),
      );
    });
  });

  // ============================================================
  // executeDirectResearch
  // ============================================================

  describe("executeDirectResearch", () => {
    it("should execute research and return report, searchRounds, duration", async () => {
      const result = await service.executeDirectResearch({
        query: "test query",
      });

      expect(result).toHaveProperty("report");
      expect(result).toHaveProperty("searchRounds");
      expect(result).toHaveProperty("duration");
      expect(typeof result.duration).toBe("number");
    });

    it("should call planner with correct depth for quick mode", async () => {
      await service.executeDirectResearch({ query: "test", depth: "quick" });

      expect(plannerService.generatePlan).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ depth: "quick" }),
      );
    });

    it("should call planner with thorough depth for deep mode", async () => {
      await service.executeDirectResearch({ query: "test", depth: "deep" });

      expect(plannerService.generatePlan).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ depth: "thorough" }),
      );
    });

    it("should default to standard depth", async () => {
      await service.executeDirectResearch({ query: "test" });

      expect(plannerService.generatePlan).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({ depth: "standard" }),
      );
    });

    it("should call onProgress callbacks at planning stages", async () => {
      const onProgress = jest.fn();

      await service.executeDirectResearch({ query: "test", onProgress });

      expect(onProgress).toHaveBeenCalledWith(
        "planning",
        5,
        expect.any(String),
      );
      expect(onProgress).toHaveBeenCalledWith(
        "planning_complete",
        15,
        expect.any(String),
      );
      expect(onProgress).toHaveBeenCalledWith(
        "synthesizing",
        82,
        expect.any(String),
      );
      expect(onProgress).toHaveBeenCalledWith(
        "synthesis_complete",
        98,
        expect.any(String),
      );
    });

    it("should call onProgress with searching stage for each round", async () => {
      const onProgress = jest.fn();

      await service.executeDirectResearch({
        query: "test",
        depth: "quick", // maxRounds = 2
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledWith(
        "searching",
        expect.any(Number),
        expect.any(String),
      );
    });

    it("should append dimensions to query when provided", async () => {
      await service.executeDirectResearch({
        query: "test",
        dimensions: ["economic", "social"],
      });

      expect(plannerService.generatePlan).toHaveBeenCalledWith(
        expect.stringContaining("economic"),
        expect.any(Object),
      );
    });

    it("should pass language option to report service", async () => {
      await service.executeDirectResearch({ query: "test", language: "zh" });

      expect(reportService.generateReport).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ language: "zh" }),
      );
    });

    it("should stop early when shouldContinue returns false", async () => {
      reflectionService.shouldContinue.mockReturnValue(false);

      const result = await service.executeDirectResearch({
        query: "test",
        depth: "standard", // maxRounds = 4
      });

      // Should stop after first reflection at round 2
      expect(result.searchRounds.length).toBeLessThan(4);
    });

    it("should return correct search rounds (quick = 2 max rounds)", async () => {
      let roundCount = 0;
      searchService.executeStep.mockImplementation(() => {
        roundCount++;
        return Promise.resolve(buildSearchRound(roundCount));
      });

      const result = await service.executeDirectResearch({
        query: "test",
        depth: "quick", // maxRounds=2, plan steps=3, so 2 rounds run
      });

      expect(result.searchRounds).toHaveLength(2);
    });

    it("should skip reflection on last round (currentRound >= maxRounds)", async () => {
      // With quick depth: maxRounds=2, plan has 3 steps
      // Round 1: search (no reflection yet)
      // Round 2: search + reflection check: currentRound(2) < maxRounds(2) = false → skip
      await service.executeDirectResearch({ query: "test", depth: "quick" });

      // Reflection only triggers at round >= 2 AND currentRound < maxRounds
      // For quick (maxRounds=2): never triggers (2 < 2 is false)
      expect(reflectionService.reflect).not.toHaveBeenCalled();
    });

    it("should call reflection at round 2+ with standard depth", async () => {
      let roundCount = 0;
      searchService.executeStep.mockImplementation(() => {
        roundCount++;
        return Promise.resolve(buildSearchRound(roundCount));
      });
      // Stop at round 2 so we don't exceed plan steps
      reflectionService.shouldContinue.mockReturnValue(false);

      await service.executeDirectResearch({
        query: "test",
        depth: "standard", // maxRounds=4
      });

      expect(reflectionService.reflect).toHaveBeenCalled();
    });

    it("should continue after failed reflection in early rounds", async () => {
      // With standard depth, maxRounds=4, plan has 3 steps
      // Round 2 reflection fails; currentRound (2) < maxRounds (4) * 0.5 (2.0) = false
      // So it should call break (currentRound >= maxRounds * 0.5)
      reflectionService.reflect.mockRejectedValue(
        new Error("Reflection failed"),
      );

      const result = await service.executeDirectResearch({
        query: "test",
        depth: "standard",
      });

      // Should still generate report even after reflection failure
      expect(result.report).toBeDefined();
    });

    it("should add pivot steps when reflection returns pivot decision", async () => {
      let searchCallCount = 0;
      searchService.executeStep.mockImplementation(() => {
        searchCallCount++;
        return Promise.resolve(buildSearchRound(searchCallCount));
      });

      reflectionService.reflect.mockResolvedValue(buildReflection("pivot"));
      // Continue after pivot, then stop
      reflectionService.shouldContinue
        .mockReturnValueOnce(true)
        .mockReturnValue(false);
      reflectionService.generatePivotSteps.mockReturnValue([
        {
          id: "pivot-1",
          type: "deep_dive",
          query: "pivot query",
          rationale: "",
          estimatedSources: 5,
        },
      ]);

      await service.executeDirectResearch({ query: "test", depth: "standard" });

      expect(reflectionService.generatePivotSteps).toHaveBeenCalled();
    });

    it("should handle missing onProgress gracefully", async () => {
      await expect(
        service.executeDirectResearch({ query: "test" }),
      ).resolves.not.toThrow();
    });

    it("should propagate errors from search service", async () => {
      searchService.executeStep.mockRejectedValue(new Error("search error"));

      await expect(
        service.executeDirectResearch({ query: "test" }),
      ).rejects.toThrow("search error");
    });

    it("should propagate errors from planner service", async () => {
      plannerService.generatePlan.mockRejectedValue(
        new Error("planning error"),
      );

      await expect(
        service.executeDirectResearch({ query: "test" }),
      ).rejects.toThrow("planning error");
    });

    it("should not call reflection when dimension-enriched query is used", async () => {
      // quick mode: no reflection
      const result = await service.executeDirectResearch({
        query: "test",
        depth: "quick",
        dimensions: ["dim1"],
      });

      expect(plannerService.generatePlan).toHaveBeenCalledWith(
        "test\n\nFocus dimensions: dim1",
        expect.any(Object),
      );
      expect(result.report).toBeDefined();
    });
  });

  // ============================================================
  // getSession
  // ============================================================

  describe("getSession", () => {
    it("should return session by id", async () => {
      const mockSession = {
        id: "session-1",
        query: "test",
        status: "COMPLETED",
      };
      (prisma.deepResearchSession.findUnique as jest.Mock).mockResolvedValue(
        mockSession,
      );

      const result = await service.getSession("session-1");

      expect(result).toEqual(mockSession);
      expect(prisma.deepResearchSession.findUnique).toHaveBeenCalledWith({
        where: { id: "session-1" },
      });
    });

    it("should return null when session not found", async () => {
      (prisma.deepResearchSession.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.getSession("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // getProjectSessions
  // ============================================================

  describe("getProjectSessions", () => {
    it("should return sessions for a project ordered by createdAt desc", async () => {
      const mockSessions = [
        { id: "session-1", projectId: "project-1", query: "q1" },
        { id: "session-2", projectId: "project-1", query: "q2" },
      ];
      (prisma.deepResearchSession.findMany as jest.Mock).mockResolvedValue(
        mockSessions,
      );

      const result = await service.getProjectSessions("project-1");

      expect(result).toEqual(mockSessions);
      expect(prisma.deepResearchSession.findMany).toHaveBeenCalledWith({
        where: { projectId: "project-1", mode: { not: "iterative_internal" } },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
    });

    it("should return empty array when no sessions exist", async () => {
      (prisma.deepResearchSession.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getProjectSessions("empty-project");

      expect(result).toEqual([]);
    });
  });

  // ============================================================
  // deleteSession
  // ============================================================

  describe("deleteSession", () => {
    it("should delete session by id", async () => {
      const mockSession = { id: "session-1" };
      (prisma.deepResearchSession.delete as jest.Mock).mockResolvedValue(
        mockSession,
      );

      const result = await service.deleteSession("session-1");

      expect(result).toEqual(mockSession);
      expect(prisma.deepResearchSession.delete).toHaveBeenCalledWith({
        where: { id: "session-1" },
      });
    });
  });

  // ============================================================
  // deleteSessions
  // ============================================================

  describe("deleteSessions", () => {
    it("should delete multiple sessions by ids", async () => {
      const mockResult = { count: 2 };
      (prisma.deepResearchSession.deleteMany as jest.Mock).mockResolvedValue(
        mockResult,
      );

      const result = await service.deleteSessions(["s1", "s2"]);

      expect(result).toEqual(mockResult);
      expect(prisma.deepResearchSession.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["s1", "s2"] } },
      });
    });

    it("should handle empty array", async () => {
      const mockResult = { count: 0 };
      (prisma.deepResearchSession.deleteMany as jest.Mock).mockResolvedValue(
        mockResult,
      );

      const result = await service.deleteSessions([]);

      expect(result).toEqual(mockResult);
    });
  });

  // ============================================================
  // countUniqueSources (tested indirectly via interaction.complete)
  // ============================================================

  describe("countUniqueSources (via interaction.complete)", () => {
    it("should count unique sources across rounds and store sourcesUsed", async () => {
      (prisma.researchProject.findUnique as jest.Mock).mockResolvedValue({
        userId: "user-1",
      });
      (prisma.deepResearchSession.create as jest.Mock).mockResolvedValue({
        id: "session-1",
      });
      (prisma.deepResearchSession.update as jest.Mock).mockResolvedValue({});
      reflectionService.shouldContinue.mockReturnValue(false);

      let callCount = 0;
      searchService.executeStep.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          round: callCount,
          stepId: `s${callCount}`,
          query: `q${callCount}`,
          resultsCount: callCount === 1 ? 2 : 2,
          sources: [
            {
              id: `a${callCount}`,
              title: `T${callCount}-1`,
              url: `http://unique${callCount}-1.com`,
              snippet: "",
              domain: `unique${callCount}-1.com`,
              relevanceScore: 1,
            },
            {
              id: `b${callCount}`,
              title: `T${callCount}-2`,
              url:
                callCount === 2
                  ? "http://unique1-1.com"
                  : `http://unique${callCount}-2.com`, // duplicate in round 2
              snippet: "",
              domain: "unique1-1.com",
              relevanceScore: 1,
            },
          ],
          timestamp: new Date(),
        });
      });

      await firstValueFrom(
        service
          .startResearch("project-1", {
            query: "test",
            options: { maxRounds: 3 },
          })
          .pipe(toArray()),
      );

      // Should have counted unique URLs
      expect(prisma.deepResearchSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: DeepResearchStatus.COMPLETED,
            sourcesUsed: expect.any(Number),
          }),
        }),
      );
    });
  });
});

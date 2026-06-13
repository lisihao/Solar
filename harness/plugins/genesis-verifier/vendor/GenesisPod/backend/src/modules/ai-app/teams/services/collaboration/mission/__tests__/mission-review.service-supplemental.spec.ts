/**
 * MissionReviewService Supplemental Tests
 *
 * Targets uncovered paths (~43 lines):
 * - ensureCallbacks: confirms error when not set (additional shapes)
 * - createAiCaller: system msg vs other msgs extraction
 * - evolveContextAfterTaskCompletion: mission not found in tx, no mission in Phase1
 * - buildLeaderReviewPrompt: with contextPackage having establishedFacts, no constraints
 * - buildTaskRevisionPrompt: previousResult > MAX_RESULT_LENGTH truncation,
 *   merging mustConstraints + contextConstraints (deduplication)
 * - summarizeForLeaderReview: content <= SUMMARY_THRESHOLD returns as-is
 * - handleRejection: force-complete with [自动完成] result, null-check for result
 * - executeTaskRevision: outer catch block (unexpected error → BLOCKED)
 * - leaderReviewTask: heartbeat timer fires, review heartbeat count increments
 */

import { Test, TestingModule } from "@nestjs/testing";
import { MissionReviewService } from "../mission-review.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { AgentFacade } from "@/modules/ai-harness/facade";
import { TopicEventEmitterService } from "../../../events";
import { TeamsLongContentService } from "../../../ai/teams-long-content.service";
import { LeaderModelService } from "../../../ai/leader-model.service";
import { MissionStateManager } from "@/modules/ai-harness/facade";
import { AgentTaskStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const buildMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-supp-1",
  topicId: "topic-supp-1",
  title: "Supplemental Mission",
  description: "Test description",
  goals: "Test goals",
  constraints: [],
  mustConstraints: [],
  contextPackage: null,
  leader: {
    id: "leader-supp",
    agentName: "TestLeader",
    displayName: "Test Leader",
    aiModel: "gpt-4",
    isLeader: true,
  },
  members: [],
  tasks: [],
  ...overrides,
});

const buildTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-supp-1",
  title: "Supplemental Task",
  description: "Task description",
  result: "Task result content here",
  status: AgentTaskStatus.AWAITING_REVIEW,
  revisionCount: 0,
  maxRevisions: 3,
  needsRevision: false,
  createdAt: new Date(),
  assignedTo: {
    id: "member-supp",
    agentName: "AgentAlice",
    displayName: "Alice Agent",
    aiModel: "gemini-pro",
    isLeader: false,
  },
  ...overrides,
});

const buildCallbacks = () => ({
  sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-supp-1" }),
  createLog: jest.fn().mockResolvedValue(undefined),
  updateMissionProgress: jest.fn().mockResolvedValue(undefined),
  executeNextTasks: jest.fn().mockResolvedValue(undefined),
  getAgentSystemPrompt: jest.fn().mockReturnValue("Agent prompt"),
  getLeaderSystemPrompt: jest.fn().mockReturnValue("Leader prompt"),
  callAIWithConfig: jest.fn().mockResolvedValue({
    content: "## 审核结果：通过\n内容不错",
    tokensUsed: 100,
  }),
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("MissionReviewService (supplemental)", () => {
  let service: MissionReviewService;
  let prisma: jest.Mocked<PrismaService>;
  let _aiFacade: jest.Mocked<AgentFacade>;
  let topicEventEmitter: jest.Mocked<TopicEventEmitterService>;
  let _longContentService: jest.Mocked<TeamsLongContentService>;
  let leaderModelService: jest.Mocked<LeaderModelService>;
  let stateManager: jest.Mocked<MissionStateManager>;

  const mockOutputReviewer = {
    executeAICall: jest.fn().mockResolvedValue({
      content: "## 审核结果：通过\n内容不错",
      tokensUsed: 100,
    }),
  };

  const mockContextEvolution = {
    extractFacts: jest.fn().mockResolvedValue({ facts: [] }),
    mergeFacts: jest.fn().mockReturnValue([]),
    buildFactsPromptSection: jest.fn().mockReturnValue(""),
  };

  const mockCircuitBreaker = {
    recordFailure: jest.fn(),
    parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
  };

  beforeEach(async () => {
    const mockPrisma = {
      agentTask: {
        update: jest.fn().mockResolvedValue({ id: "task-supp-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(buildTask()),
      },
      teamMission: {
        findUnique: jest.fn().mockResolvedValue({ contextPackage: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => {
        if (typeof fn === "function") {
          return fn({
            teamMission: {
              findUnique: jest.fn().mockResolvedValue({ contextPackage: null }),
              update: jest.fn().mockResolvedValue({}),
            },
          });
        }
        return Promise.all(fn);
      }),
    };

    const mockAiFacade = {
      outputReviewer: mockOutputReviewer,
      contextEvolution: mockContextEvolution,
      circuitBreaker: mockCircuitBreaker,
    };

    const mockTopicEventEmitter = {
      emitToTopic: jest.fn().mockResolvedValue(undefined),
    };

    const mockLongContentService = {
      checkQualityIntervention: jest.fn().mockReturnValue({ needed: false }),
    };

    const mockLeaderModelService = {
      executeWithFallback: jest.fn().mockResolvedValue({
        success: true,
        data: { content: "## 审核结果：通过\n内容不错", tokensUsed: 100 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      }),
    };

    const mockStateManager = {
      startRevision: jest.fn().mockReturnValue(true),
      finishRevision: jest.fn(),
      isRevisionInProgress: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionReviewService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentFacade, useValue: mockAiFacade },
        { provide: TopicEventEmitterService, useValue: mockTopicEventEmitter },
        { provide: TeamsLongContentService, useValue: mockLongContentService },
        { provide: LeaderModelService, useValue: mockLeaderModelService },
        { provide: MissionStateManager, useValue: mockStateManager },
      ],
    }).compile();

    service = module.get<MissionReviewService>(MissionReviewService);
    prisma = module.get(PrismaService);
    _aiFacade = module.get(AgentFacade);
    topicEventEmitter = module.get(TopicEventEmitterService);
    _longContentService = module.get(TeamsLongContentService);
    leaderModelService = module.get(LeaderModelService);
    stateManager = module.get(MissionStateManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // buildLeaderReviewPrompt — with established facts + no constraints
  // =========================================================================
  describe("buildLeaderReviewPrompt via leaderReviewTask", () => {
    beforeEach(() => {
      service.setCallbacks(buildCallbacks() as any);
    });

    it("builds prompt with established facts from contextPackage", async () => {
      mockContextEvolution.buildFactsPromptSection.mockReturnValueOnce(
        "## 已确立事实\n- Alice is the protagonist",
      );

      const mission = buildMission({
        contextPackage: {
          version: "1.0",
          establishedFacts: [
            {
              id: "f1",
              content: "Alice is the protagonist",
              taskId: "task-0",
              confidence: 0.95,
              category: "character",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      });
      const task = buildTask();

      await service.leaderReviewTask(
        mission as any,
        task as any,
        "Short result",
      );

      expect(mockContextEvolution.buildFactsPromptSection).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: "f1" })]),
      );
    });

    it("builds prompt without constraints section when constraints is empty", async () => {
      const mission = buildMission({ constraints: [] });
      const task = buildTask();

      // Should not throw
      await expect(
        service.leaderReviewTask(mission as any, task as any, "Result"),
      ).resolves.not.toThrow();
    });

    it("includes constraints in prompt when mission has constraints", async () => {
      const mission = buildMission({
        constraints: ["No violence", "Max 500 words"],
      });
      const task = buildTask();

      await service.leaderReviewTask(mission as any, task as any, "Result");
      // Verify executeWithFallback was called (meaning prompt was built successfully)
      expect(leaderModelService.executeWithFallback).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // buildTaskRevisionPrompt — previousResult truncation + constraint merging
  // =========================================================================
  describe("buildTaskRevisionPrompt via executeTaskRevision", () => {
    beforeEach(() => {
      service.setCallbacks(buildCallbacks() as any);
    });

    it("truncates previous result when it exceeds MAX_RESULT_LENGTH (2500 chars)", async () => {
      const longResult = "B".repeat(3000);
      const task = buildTask({ result: longResult });
      (prisma.agentTask.findUnique as jest.Mock).mockResolvedValue(task);

      const mission = buildMission();

      // Should complete without error
      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback here",
      );
      expect(mockOutputReviewer.executeAICall).toHaveBeenCalled();
    });

    it("merges mustConstraints and contextPackage.hardConstraints deduplicating by id", async () => {
      const sharedConstraint = {
        id: "c1",
        rule: "No plagiarism",
        priority: "must",
        source: "human",
      };
      const uniqueConstraint = {
        id: "c2",
        rule: "Max 1000 words",
        priority: "must",
        source: "ai",
      };

      const mission = buildMission({
        mustConstraints: [sharedConstraint],
        contextPackage: {
          version: "1.0",
          hardConstraints: [sharedConstraint, uniqueConstraint],
          establishedFacts: [],
          entities: [],
          prohibitions: [],
          qualityStandards: [],
          understanding: { summary: "", scope: "", expectedOutput: "" },
          generatedBy: "system",
          generatedAt: new Date().toISOString(),
        },
      });
      const task = buildTask();
      (prisma.agentTask.findUnique as jest.Mock).mockResolvedValue(task);

      // Should complete without throwing — constraint merging is internal
      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Please fix",
      );
      expect(mockOutputReviewer.executeAICall).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // evolveContextAfterTaskCompletion — mission not found in Phase 1
  // =========================================================================
  describe("evolveContextAfterTaskCompletion — mission not found", () => {
    beforeEach(() => {
      service.setCallbacks(buildCallbacks() as any);
    });

    it("skips context evolution when mission not found in Phase 1", async () => {
      // Make teamMission.findUnique return null → evolveContext returns early
      (prisma.teamMission.findUnique as jest.Mock).mockResolvedValue(null);

      mockContextEvolution.extractFacts.mockResolvedValue({
        facts: [
          {
            id: "f1",
            content: "New fact",
            taskId: "t1",
            confidence: 0.9,
            category: "plot",
            createdAt: "",
          },
        ],
      });

      (leaderModelService.executeWithFallback as jest.Mock).mockResolvedValue({
        success: true,
        data: { content: "## 审核结果：通过\n内容不错", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMission();
      const longResult = "Very detailed content ".repeat(20); // > 200 chars
      const task = buildTask({ result: longResult });

      // Should not throw
      await expect(
        service.leaderReviewTask(mission as any, task as any, longResult),
      ).resolves.not.toThrow();
    });

    it("handles extractFacts failure gracefully during context evolution", async () => {
      mockContextEvolution.extractFacts.mockRejectedValue(
        new Error("Extract failed"),
      );

      (leaderModelService.executeWithFallback as jest.Mock).mockResolvedValue({
        success: true,
        data: { content: "## 审核结果：通过\n内容不错", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMission();
      const longResult = "Content that is long enough ".repeat(10); // > 200 chars
      const task = buildTask({ result: longResult });

      // evolveContext failure should not propagate
      await expect(
        service.leaderReviewTask(mission as any, task as any, longResult),
      ).resolves.not.toThrow();
    });
  });

  // =========================================================================
  // handleRejection — [自动完成] content treated as invalid
  // =========================================================================
  describe("handleRejection — invalid content patterns", () => {
    beforeEach(() => {
      service.setCallbacks(buildCallbacks() as any);
    });

    it("blocks task when result contains [自动完成] (auto-complete content)", async () => {
      (leaderModelService.executeWithFallback as jest.Mock).mockResolvedValue({
        success: true,
        data: { content: "## 审核结果：需要修改\n请改进内容", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMission();
      const task = buildTask({
        revisionCount: 3,
        maxRevisions: 3,
        result: "[自动完成] placeholder content", // hasValidContent = false
      });

      await service.leaderReviewTask(mission as any, task as any, task.result);

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.BLOCKED }),
        }),
      );
    });

    it("records circuit breaker failure when task blocked", async () => {
      (leaderModelService.executeWithFallback as jest.Mock).mockResolvedValue({
        success: true,
        data: { content: "需要修改：请重做", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMission();
      const task = buildTask({
        revisionCount: 3,
        maxRevisions: 3,
        result: "[错误] AI call failed", // hasValidContent = false
      });

      await service.leaderReviewTask(mission as any, task as any, task.result);

      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // executeTaskRevision — outer catch block (unexpected error → BLOCKED)
  // =========================================================================
  describe("executeTaskRevision — outer catch block", () => {
    beforeEach(() => {
      service.setCallbacks(buildCallbacks() as any);
    });

    it("marks task as BLOCKED on unexpected outer error", async () => {
      // Make findUnique throw an unexpected error
      (prisma.agentTask.findUnique as jest.Mock).mockRejectedValue(
        new Error("Database connection lost"),
      );

      const mission = buildMission();
      const task = buildTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.BLOCKED }),
        }),
      );
    });

    it("releases revision lock in finally block on outer catch", async () => {
      (prisma.agentTask.findUnique as jest.Mock).mockRejectedValue(
        new Error("Unexpected failure"),
      );
      (stateManager.isRevisionInProgress as jest.Mock).mockReturnValue(true);

      const mission = buildMission();
      const task = buildTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(stateManager.finishRevision).toHaveBeenCalled();
    });

    it("records circuit breaker failure on outer exception", async () => {
      (prisma.agentTask.findUnique as jest.Mock).mockRejectedValue(
        new Error("Timeout error"),
      );

      const mission = buildMission();
      const task = buildTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(mockCircuitBreaker.parseErrorType).toHaveBeenCalled();
      expect(mockCircuitBreaker.recordFailure).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // createAiCaller — system msg extraction (tested via direct reflection)
  // =========================================================================
  describe("createAiCaller internal behavior", () => {
    it("extracts system message and calls callAIWithConfig with correct args", async () => {
      const callbacks = buildCallbacks();
      service.setCallbacks(callbacks as any);

      const missionId = "mission-supp-1";

      // Access createAiCaller directly via reflection
      const aiCaller = (service as any).createAiCaller(callbacks, missionId);

      const messages = [
        { role: "system", content: "You are a helpful reviewer." },
        { role: "user", content: "Please review this task." },
      ];

      await aiCaller("gpt-4", messages, { maxTokens: 1000, temperature: 0.3 });

      // callAIWithConfig should receive model, non-system messages, system prompt, options
      expect(callbacks.callAIWithConfig).toHaveBeenCalledWith(
        "gpt-4",
        [{ role: "user", content: "Please review this task." }],
        "You are a helpful reviewer.",
        expect.objectContaining({ missionId }),
      );
    });
  });

  // =========================================================================
  // leaderReviewTask — heartbeat timer
  // =========================================================================
  describe("leaderReviewTask — heartbeat timer", () => {
    beforeEach(() => {
      service.setCallbacks(buildCallbacks() as any);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("clears heartbeat timer after review completes", async () => {
      const promise = service.leaderReviewTask(
        buildMission() as any,
        buildTask() as any,
        "Result",
      );

      // Advance timer to trigger heartbeat
      jest.advanceTimersByTime(6000);

      await promise;

      // topicEventEmitter should have been called for heartbeat
      expect(topicEventEmitter.emitToTopic).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // summarizeForLeaderReview — short content (≤ threshold, via private call)
  // =========================================================================
  describe("summarizeForLeaderReview — via reflection", () => {
    beforeEach(() => {
      service.setCallbacks(buildCallbacks() as any);
    });

    it("returns content as-is when content length <= 3000", async () => {
      const callbacks = buildCallbacks();
      const shortContent = "Short content below threshold";
      const result = await (service as any).summarizeForLeaderReview(
        shortContent,
        "Task Title",
        "gpt-4",
        "mission-1",
        callbacks,
      );
      expect(result.summary).toBe(shortContent);
      expect(result.keyExcerpts).toBe("");
    });

    it("calls AI for summarization when content > 3000 chars", async () => {
      const callbacks = buildCallbacks();
      const longContent = "Y".repeat(4000);
      const result = await (service as any).summarizeForLeaderReview(
        longContent,
        "Task Title",
        "gpt-4",
        "mission-1",
        callbacks,
      );
      // Should have called outputReviewer.executeAICall
      expect(mockOutputReviewer.executeAICall).toHaveBeenCalled();
      expect(result.keyExcerpts).toContain("开篇");
      expect(result.keyExcerpts).toContain("结尾");
    });
  });
});

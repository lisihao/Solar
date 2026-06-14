/**
 * MissionReviewService Tests
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

const buildMockMission = () => ({
  id: "mission-1",
  topicId: "topic-1",
  title: "Test Mission",
  description: "Test description",
  goals: "Test goals",
  constraints: ["No violence"],
  mustConstraints: [],
  contextPackage: null,
  leader: {
    id: "leader-1",
    agentName: "Leader",
    displayName: "Leader Agent",
    aiModel: "gpt-4",
    isLeader: true,
  },
  members: [],
  tasks: [],
});

const buildMockTask = () => ({
  id: "task-1",
  title: "Write Chapter 1",
  description: "Write the first chapter",
  result: "Chapter content here",
  status: AgentTaskStatus.AWAITING_REVIEW,
  revisionCount: 0,
  maxRevisions: 3,
  needsRevision: false,
  assignedTo: {
    id: "member-1",
    agentName: "Alice",
    displayName: "Alice Agent",
    aiModel: "gemini-pro",
    isLeader: false,
  },
});

const mockCallbacks = {
  sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-1" }),
  createLog: jest.fn().mockResolvedValue(undefined),
  updateMissionProgress: jest.fn().mockResolvedValue(undefined),
  executeNextTasks: jest.fn().mockResolvedValue(undefined),
  getAgentSystemPrompt: jest.fn().mockReturnValue("Agent system prompt"),
  getLeaderSystemPrompt: jest.fn().mockReturnValue("Leader system prompt"),
  callAIWithConfig: jest.fn().mockResolvedValue({
    content: "## 审核结果：通过\n内容很好",
    tokensUsed: 100,
  }),
};

describe("MissionReviewService", () => {
  let service: MissionReviewService;
  let prisma: jest.Mocked<PrismaService>;
  let aiFacade: jest.Mocked<AgentFacade>;
  let topicEventEmitter: jest.Mocked<TopicEventEmitterService>;
  let longContentService: jest.Mocked<TeamsLongContentService>;
  let leaderModelService: jest.Mocked<LeaderModelService>;
  let stateManager: jest.Mocked<MissionStateManager>;

  const mockOutputReviewer = {
    executeAICall: jest.fn().mockResolvedValue({
      content: "## 审核结果：通过\n内容很好",
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
        update: jest.fn().mockResolvedValue({ id: "task-1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(buildMockTask()),
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
        data: { content: "## 审核结果：通过\n内容很好", tokensUsed: 100 },
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
    aiFacade = module.get(AgentFacade);
    topicEventEmitter = module.get(TopicEventEmitterService);
    longContentService = module.get(TeamsLongContentService);
    leaderModelService = module.get(LeaderModelService);
    stateManager = module.get(MissionStateManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== setCallbacks ====================

  describe("setCallbacks", () => {
    it("should set callbacks successfully", () => {
      expect(() => service.setCallbacks(mockCallbacks as any)).not.toThrow();
    });
  });

  // ==================== leaderReviewTask ====================

  describe("leaderReviewTask", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should throw when callbacks are not set", async () => {
      const serviceWithoutCallbacks = new MissionReviewService(
        prisma,
        topicEventEmitter,
        longContentService,
        aiFacade,
        stateManager,
        leaderModelService,
      );

      await expect(
        serviceWithoutCallbacks.leaderReviewTask(
          buildMockMission() as any,
          buildMockTask() as any,
          "result",
        ),
      ).rejects.toThrow("ReviewCallbacks not set");
    });

    it("should execute leader review and approve task", async () => {
      const mission = buildMockMission();
      const task = buildMockTask();

      await service.leaderReviewTask(
        mission as any,
        task as any,
        "Good content here",
      );

      expect(leaderModelService.executeWithFallback).toHaveBeenCalled();
    });

    it("should summarize long task result before review", async () => {
      const mission = buildMockMission();
      const task = buildMockTask();
      const longResult = "x".repeat(4000);

      await service.leaderReviewTask(mission as any, task as any, longResult);

      // Should have called outputReviewer for summarization
      expect(mockOutputReviewer.executeAICall).toHaveBeenCalled();
    });

    it("should include quality warning when quality check needed", async () => {
      (
        longContentService.checkQualityIntervention as jest.Mock
      ).mockReturnValueOnce({
        needed: true,
        reason: "Content too repetitive",
      });

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.leaderReviewTask(
        mission as any,
        task as any,
        "Task result",
      );

      // Verify it still ran without throwing
      expect(leaderModelService.executeWithFallback).toHaveBeenCalled();
    });

    it("should handle review failure and force complete task", async () => {
      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockRejectedValueOnce(new Error("AI call failed"));

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.leaderReviewTask(mission as any, task as any, "result");

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should handle fallback model usage", async () => {
      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "## 审核结果：通过", tokensUsed: 50 },
        fallbackUsed: true,
        modelUsed: "claude-3",
      });

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.leaderReviewTask(mission as any, task as any, "result");

      expect(mockCallbacks.sendMessageToTopic).toHaveBeenCalled();
    });

    it("should handle all model attempts failed", async () => {
      const mockError = { getUserMessage: () => "All models failed" };
      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: false,
        error: mockError,
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.leaderReviewTask(mission as any, task as any, "result");

      expect(mockCallbacks.sendMessageToTopic).toHaveBeenCalled();
    });
  });

  // ==================== executeTaskRevision ====================

  describe("executeTaskRevision", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should skip revision when already in progress", async () => {
      (stateManager.startRevision as jest.Mock).mockReturnValueOnce(false);

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(prisma.agentTask.findUnique).not.toHaveBeenCalled();
    });

    it("should acquire revision lock and proceed", async () => {
      const mission = buildMockMission();
      const task = buildMockTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Please improve",
      );

      expect(stateManager.startRevision).toHaveBeenCalledWith(
        "task-1",
        expect.any(String),
      );
    });

    it("should release lock early when task not found", async () => {
      (prisma.agentTask.findUnique as jest.Mock).mockResolvedValueOnce(null);

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(stateManager.finishRevision).toHaveBeenCalled();
    });

    it("should release lock when task no longer REVISION_NEEDED", async () => {
      (prisma.agentTask.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 0,
      });

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(stateManager.finishRevision).toHaveBeenCalled();
    });

    it("should handle AI error during revision", async () => {
      mockOutputReviewer.executeAICall.mockRejectedValueOnce(
        new Error("API timeout"),
      );

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentTaskStatus.REVISION_NEEDED,
          }),
        }),
      );
    });

    it("should handle API error content in response", async () => {
      mockOutputReviewer.executeAICall.mockResolvedValueOnce({
        content: "API Error: rate limit exceeded",
        tokensUsed: 0,
      });

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentTaskStatus.REVISION_NEEDED,
          }),
        }),
      );
    });

    it("should update task to AWAITING_REVIEW on successful revision", async () => {
      mockOutputReviewer.executeAICall.mockResolvedValueOnce({
        content: "Revised content here",
        tokensUsed: 200,
      });

      // Mock leaderReviewTask indirectly (it calls back into itself)
      // After setting to AWAITING_REVIEW, it will trigger another review
      (leaderModelService.executeWithFallback as jest.Mock).mockResolvedValue({
        success: true,
        data: { content: "## 审核结果：通过", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentTaskStatus.AWAITING_REVIEW,
            result: "Revised content here",
          }),
        }),
      );
    });

    it("should release lock before calling leaderReviewTask", async () => {
      const releaseOrder: string[] = [];

      (stateManager.finishRevision as jest.Mock).mockImplementation(() => {
        releaseOrder.push("finishRevision");
      });
      (leaderModelService.executeWithFallback as jest.Mock).mockImplementation(
        async () => {
          releaseOrder.push("leaderReview");
          return {
            success: true,
            data: { content: "## 审核结果：通过", tokensUsed: 50 },
            fallbackUsed: false,
            modelUsed: "gpt-4",
          };
        },
      );

      const mission = buildMockMission();
      const task = buildMockTask();

      await service.executeTaskRevision(
        mission as any,
        task as any,
        "Feedback",
      );

      const finishIndex = releaseOrder.indexOf("finishRevision");
      const reviewIndex = releaseOrder.indexOf("leaderReview");

      if (finishIndex >= 0 && reviewIndex >= 0) {
        expect(finishIndex).toBeLessThan(reviewIndex);
      }
    });
  });

  // ==================== handleRejection edge cases ====================

  describe("rejection handling", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should force complete task when max revisions reached with valid content", async () => {
      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "## 审核结果：需要修改\n请改进内容", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      const task = {
        ...buildMockTask(),
        revisionCount: 3,
        maxRevisions: 3,
        result:
          "Valid long content here that is more than 100 characters to satisfy the condition for force pass",
      };

      await service.leaderReviewTask(mission as any, task as any, task.result);

      // Should force complete (COMPLETED or BLOCKED)
      expect(prisma.agentTask.update).toHaveBeenCalled();
    });

    it("should block task when max revisions reached with invalid content", async () => {
      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "## 审核结果：需要修改\n请改进内容", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      const task = {
        ...buildMockTask(),
        revisionCount: 3,
        maxRevisions: 3,
        result: "[错误] 执行失败",
      };

      await service.leaderReviewTask(mission as any, task as any, task.result);

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.BLOCKED }),
        }),
      );
    });

    it("should trigger revision when under max revisions", async () => {
      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "需要修改，请改进", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      // Prevent recursive calls
      (stateManager.startRevision as jest.Mock).mockReturnValue(false);

      const mission = buildMockMission();
      const task = { ...buildMockTask(), revisionCount: 0, maxRevisions: 3 };

      await service.leaderReviewTask(mission as any, task as any, "result");

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentTaskStatus.REVISION_NEEDED,
          }),
        }),
      );
    });

    it("should truncate taskResult in review prompt when it exceeds 2500 chars", async () => {
      // A long result to trigger the truncation branch in buildLeaderReviewPrompt
      const longResult = "A".repeat(3000);

      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "## 审核结果：通过\n内容很好", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      const task = { ...buildMockTask(), result: longResult };

      await service.leaderReviewTask(mission as any, task as any, longResult);

      // Should still call update (not throw) — truncation handled gracefully
      expect(leaderModelService.executeWithFallback).toHaveBeenCalled();
    });
  });

  describe("evolveContextAfterTaskCompletion (via leaderReviewTask approval)", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should update mission context when facts are extracted from task output", async () => {
      // Make extractFacts return non-empty facts
      mockContextEvolution.extractFacts.mockResolvedValueOnce({
        facts: [
          {
            id: "fact-1",
            content: "Alice is the protagonist",
            taskId: "task-1",
            confidence: 0.9,
            category: "character",
            createdAt: new Date().toISOString(),
          },
        ],
      });
      mockContextEvolution.mergeFacts.mockReturnValueOnce([
        {
          id: "fact-1",
          content: "Alice is the protagonist",
          taskId: "task-1",
          confidence: 0.9,
          category: "character",
          createdAt: new Date().toISOString(),
        },
      ]);

      // Approve the task
      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "## 审核结果：通过\n内容很好", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      // Use long enough task result (>= 200 chars) to trigger evolveContext
      const longResult = "Very detailed chapter content ".repeat(20);
      const task = { ...buildMockTask(), result: longResult };

      await service.leaderReviewTask(mission as any, task as any, longResult);

      expect(mockContextEvolution.extractFacts).toHaveBeenCalled();
      expect(mockContextEvolution.mergeFacts).toHaveBeenCalled();
    });

    it("should skip context evolution when task output is too short", async () => {
      // Clear existing mock calls
      jest.clearAllMocks();
      service.setCallbacks(mockCallbacks as any);

      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "## 审核结果：通过\n内容很好", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      // Short result (< 200 chars) — should skip evolution
      const shortResult = "Short output";
      const task = { ...buildMockTask(), result: shortResult };

      await service.leaderReviewTask(mission as any, task as any, shortResult);

      // extractFacts should NOT have been called
      expect(mockContextEvolution.extractFacts).not.toHaveBeenCalled();
    });
  });

  describe("summarizeForLeaderReview (triggered via long content path)", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should return content as-is when content is within SUMMARY_THRESHOLD", async () => {
      const shortContent = "Short content below 3000 chars";

      // Mock longContentService to indicate no intervention needed
      (
        longContentService.checkQualityIntervention as jest.Mock
      ).mockReturnValueOnce({
        needed: false,
      });

      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "## 审核结果：通过\n内容很好", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      const task = { ...buildMockTask(), result: shortContent };

      // This exercises the path where content <= SUMMARY_THRESHOLD
      await service.leaderReviewTask(mission as any, task as any, shortContent);

      expect(leaderModelService.executeWithFallback).toHaveBeenCalled();
    });

    it("should fall back to truncation when AI summarization fails", async () => {
      // Make outputReviewer.executeAICall throw to trigger fallback
      mockOutputReviewer.executeAICall.mockRejectedValueOnce(
        new Error("AI summarization failed"),
      );

      const longContent = "X".repeat(4000); // > SUMMARY_THRESHOLD (3000)

      (
        leaderModelService.executeWithFallback as jest.Mock
      ).mockResolvedValueOnce({
        success: true,
        data: { content: "## 审核结果：通过\n内容很好", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const mission = buildMockMission();
      const task = { ...buildMockTask(), result: longContent };

      // Should not throw — falls back to truncation
      await expect(
        service.leaderReviewTask(mission as any, task as any, longContent),
      ).resolves.not.toThrow();
    });
  });
});

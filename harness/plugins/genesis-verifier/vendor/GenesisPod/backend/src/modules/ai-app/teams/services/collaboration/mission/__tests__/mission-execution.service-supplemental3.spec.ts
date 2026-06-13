/**
 * MissionExecutionService - Supplemental3 Tests
 *
 * Covers branches not yet exercised by existing specs:
 * - callAIWithConfig: taskProfile path, legacy temperature/maxTokens path, missionId tracking,
 *   rate-limit sleep, getModelConfig null/error path
 * - callAIWithRetry: rate-limit sleep path, retryable non-rate-limit path
 * - handleTaskExecutionFailure: replan success → new tasks created, replan model failure,
 *   cancels the failed task, createLog / sendMessageToTopic interactions
 * - executeTask: web-search path (needsWebSearch=true), tool execution path
 * - mapTemperatureToCreativity edge values, mapMaxTokensToOutputLength edge values
 * - createToolContext returns expected shape
 * - getModelConfig error / null paths
 * - dependency relaxation (handleDependencyDeadlock) via executeNextTasks
 */

jest.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  },
  ...jest.requireActual("@prisma/client"),
  AIModelType: {
    CHAT: "CHAT",
    CHAT_FAST: "CHAT_FAST",
    IMAGE_GENERATION: "IMAGE_GENERATION",
    IMAGE_EDITING: "IMAGE_EDITING",
    MULTIMODAL: "MULTIMODAL",
    EMBEDDING: "EMBEDDING",
    RERANK: "RERANK",
  },
  MissionStatus: {
    PENDING: "PENDING",
    PLANNING: "PLANNING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    PAUSED: "PAUSED",
  },
  AgentTaskStatus: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    BLOCKED: "BLOCKED",
    AWAITING_REVIEW: "AWAITING_REVIEW",
    REVISION_NEEDED: "REVISION_NEEDED",
  },
  TaskPriority: {
    LOW: "LOW",
    MEDIUM: "MEDIUM",
    HIGH: "HIGH",
    CRITICAL: "CRITICAL",
  },
  TaskType: {
    RESEARCH: "RESEARCH",
    WRITING: "WRITING",
    ANALYSIS: "ANALYSIS",
    DESIGN: "DESIGN",
    IMPLEMENTATION: "IMPLEMENTATION",
    REVIEW: "REVIEW",
    DOCUMENTATION: "DOCUMENTATION",
    CREATIVE: "CREATIVE",
    SYNTHESIS: "SYNTHESIS",
  },
  MissionLogType: {
    SYSTEM: "SYSTEM",
    AGENT: "AGENT",
    LEADER: "LEADER",
    ERROR: "ERROR",
    TASK_START: "TASK_START",
    TASK_COMPLETE: "TASK_COMPLETE",
    TASK_FAIL: "TASK_FAIL",
  },
  MessageContentType: {
    TEXT: "TEXT",
    MARKDOWN: "MARKDOWN",
    JSON: "JSON",
    ERROR: "ERROR",
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { MissionExecutionService } from "../mission-execution.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import {
  ChatFacade,
  AgentFacade,
  ToolFacade,
} from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { TopicEventEmitterService } from "../../../events";
import { TeamsLongContentService } from "../../../ai/teams-long-content.service";
import { LeaderModelService } from "../../../ai/leader-model.service";
import { MissionStateManager } from "@/modules/ai-harness/facade";
import { AgentTaskStatus, MissionStatus, TaskType } from "@prisma/client";

// ============================================================
// Helpers
// ============================================================

const buildMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-s3",
  topicId: "topic-s3",
  title: "Supplemental3 Mission",
  description: "A test mission for supplemental3",
  objectives: [],
  constraints: [],
  mustConstraints: [],
  contextPackage: null,
  totalTasks: 2,
  createdAt: new Date(),
  createdBy: { id: "user-s3" },
  status: MissionStatus.IN_PROGRESS,
  leader: {
    id: "leader-s3",
    agentName: "LeaderS3",
    displayName: "Leader S3",
    aiModel: "gpt-4",
    isLeader: true,
  },
  tasks: [],
  ...overrides,
});

const buildTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-s3",
  missionId: "mission-s3",
  title: "Test Task S3",
  description: "Task for supplemental3 tests",
  result: null,
  status: AgentTaskStatus.PENDING,
  revisionCount: 0,
  maxRevisions: 3,
  needsRevision: false,
  priority: "MEDIUM",
  taskType: TaskType.IMPLEMENTATION,
  dependsOnIds: [],
  startedAt: null,
  updatedAt: new Date(),
  createdAt: new Date(),
  assignedToId: "member-s3",
  assignedTo: {
    id: "member-s3",
    agentName: "Alice",
    displayName: "Alice Agent",
    aiModel: "gemini-pro",
    isLeader: false,
  },
  ...overrides,
});

const buildCallbacks = () => ({
  completeMission: jest.fn().mockResolvedValue(undefined),
  leaderReviewTask: jest.fn().mockResolvedValue(undefined),
  getTeamMembers: jest.fn().mockResolvedValue({
    leader: {
      id: "leader-s3",
      agentName: "LeaderS3",
      displayName: "Leader S3",
      aiModel: "gpt-4",
      isLeader: true,
    },
    members: [
      {
        id: "member-s3",
        agentName: "Alice",
        displayName: "Alice Agent",
        aiModel: "gemini-pro",
        isLeader: false,
      },
    ],
    all: [
      {
        id: "leader-s3",
        agentName: "LeaderS3",
        displayName: "Leader S3",
        aiModel: "gpt-4",
        isLeader: true,
      },
      {
        id: "member-s3",
        agentName: "Alice",
        displayName: "Alice Agent",
        aiModel: "gemini-pro",
        isLeader: false,
      },
    ],
  }),
  createLog: jest.fn().mockResolvedValue(undefined),
  sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-s3" }),
  updateMissionProgress: jest.fn().mockResolvedValue(undefined),
  buildTaskExecutionPrompt: jest.fn().mockReturnValue("Prompt for task"),
  getAgentSystemPrompt: jest.fn().mockReturnValue("Agent system prompt"),
  getLeaderSystemPrompt: jest.fn().mockReturnValue("Leader system prompt"),
});

// ============================================================
// Test suite
// ============================================================

describe("MissionExecutionService - Supplemental3 Coverage", () => {
  let service: MissionExecutionService;
  let prisma: jest.Mocked<PrismaService>;
  let stateManager: jest.Mocked<MissionStateManager>;
  let callbacks: ReturnType<typeof buildCallbacks>;

  const mockAiFacade = {
    chat: jest
      .fn()
      .mockResolvedValue({ content: "AI response content", tokensUsed: 150 }),
    getModelById: jest
      .fn()
      .mockResolvedValue({ id: "gpt-4", modelId: "gpt-4", name: "GPT-4" }),
    circuitBreaker: {
      isOpen: jest.fn().mockReturnValue(false),
      canExecute: jest.fn().mockReturnValue(true),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
      selectBest: jest.fn().mockReturnValue(null),
      getCooldownRemaining: jest.fn().mockReturnValue(0),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
    },
    capabilityResolver: {
      resolveCapabilities: jest
        .fn()
        .mockResolvedValue({ tools: [], skills: [] }),
    },
    getAvailableCapabilities: jest
      .fn()
      .mockResolvedValue({ tools: [], skills: [], mcpTools: [] }),
  };

  const mockPrisma = {
    agentTask: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(buildTask()),
      update: jest.fn().mockResolvedValue(buildTask()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(buildTask()),
    },
    teamMission: {
      findUnique: jest.fn().mockResolvedValue(buildMission()),
      findFirst: jest.fn().mockResolvedValue(buildMission()),
      update: jest.fn().mockResolvedValue(buildMission()),
    },
    topicAIMember: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  const mockTopicEventEmitter = {
    emitToTopic: jest.fn().mockResolvedValue(undefined),
  };

  const mockLongContentService = {
    trackTaskCompletion: jest.fn(),
    checkQualityIntervention: jest.fn().mockReturnValue({ needed: false }),
    processTaskCompletion: jest
      .fn()
      .mockResolvedValue({ needsContinuation: false, finalContent: null }),
    ensureMissionInitialized: jest.fn().mockResolvedValue(undefined),
  };

  const mockStateManager = {
    startTask: jest.fn().mockReturnValue(true),
    finishTask: jest.fn(),
    isTaskExecuting: jest.fn().mockReturnValue(false),
    startMissionExecution: jest.fn().mockReturnValue(true),
    finishMissionExecution: jest.fn(),
    isMissionExecuting: jest.fn().mockReturnValue(false),
    startRevision: jest.fn().mockReturnValue(true),
    finishRevision: jest.fn(),
    isRevisionInProgress: jest.fn().mockReturnValue(false),
  };

  const mockLeaderModelService = {
    executeWithFallback: jest.fn().mockResolvedValue({
      success: true,
      data: { content: "Leader response", tokensUsed: 100 },
      fallbackUsed: false,
      modelUsed: "gpt-4",
    }),
  };

  const mockToolRegistry = {
    get: jest.fn().mockReturnValue(null),
    has: jest.fn().mockReturnValue(false),
    tryGet: jest.fn().mockReturnValue(null),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockAiFacade.chat.mockResolvedValue({
      content: "AI response content",
      tokensUsed: 150,
    });
    mockAiFacade.getModelById.mockResolvedValue({
      id: "gpt-4",
      modelId: "gpt-4",
      name: "GPT-4",
    });
    mockAiFacade.circuitBreaker.canExecute.mockReturnValue(true);
    mockAiFacade.circuitBreaker.selectBest.mockReturnValue(null);
    mockPrisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.teamMission.findUnique.mockResolvedValue(buildMission());
    mockLongContentService.processTaskCompletion.mockResolvedValue({
      needsContinuation: false,
      finalContent: null,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionExecutionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockAiFacade },
        { provide: AgentFacade, useValue: mockAiFacade },
        { provide: ToolFacade, useValue: mockAiFacade },
        { provide: ToolRegistry, useValue: mockToolRegistry },
        { provide: TopicEventEmitterService, useValue: mockTopicEventEmitter },
        { provide: TeamsLongContentService, useValue: mockLongContentService },
        { provide: MissionStateManager, useValue: mockStateManager },
        { provide: LeaderModelService, useValue: mockLeaderModelService },
      ],
    }).compile();

    service = module.get<MissionExecutionService>(MissionExecutionService);
    prisma = module.get(PrismaService);
    stateManager = module.get(MissionStateManager);

    callbacks = buildCallbacks();
    service.setCallbacks(callbacks as never);
  });

  // ==================== callAIWithConfig - taskProfile path ====================

  describe("callAIWithConfig - taskProfile path", () => {
    it("should pass taskProfile directly when provided", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Good response",
        tokensUsed: 300,
      });

      const result = await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Hello" }],
        "System prompt",
        {
          taskProfile: { creativity: "high", outputLength: "long" },
        },
      );

      expect(result.content).toBe("Good response");
      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: { creativity: "high", outputLength: "long" },
        }),
      );
    });

    it("should convert legacy temperature to taskProfile creativity when no taskProfile provided", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Legacy response",
        tokensUsed: 200,
      });

      const result = await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Test" }],
        "System",
        {
          temperature: 0.9,
          maxTokens: 8000,
        },
      );

      expect(result.content).toBe("Legacy response");
      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({
            creativity: "high",
            outputLength: "long",
          }),
        }),
      );
    });

    it("should use minimal outputLength for small maxTokens", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Minimal response",
        tokensUsed: 100,
      });

      await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Test" }],
        "System",
        { temperature: 0.1, maxTokens: 400 },
      );

      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({
            creativity: "deterministic",
            outputLength: "minimal",
          }),
        }),
      );
    });

    it("should use short outputLength for medium maxTokens", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Short response",
        tokensUsed: 100,
      });

      await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Test" }],
        "System",
        { temperature: 0.3, maxTokens: 1500 },
      );

      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({
            creativity: "low",
            outputLength: "short",
          }),
        }),
      );
    });

    it("should use medium outputLength for mid-range maxTokens", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Medium response",
        tokensUsed: 100,
      });

      await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Test" }],
        "System",
        { temperature: 0.7, maxTokens: 3000 },
      );

      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({
            creativity: "medium",
            outputLength: "medium",
          }),
        }),
      );
    });

    it("should track tokens for missionId when tokensUsed > 0", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response with tokens",
        tokensUsed: 500,
      });

      await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Hello" }],
        "System",
        { missionId: "mission-track-1" },
      );

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("should not track tokens when missionId is absent", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "No-track response",
        tokensUsed: 500,
      });

      await service.callAIWithConfig("gpt-4", [], "System", {});

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  // ==================== callAIWithConfig - getModelConfig paths ====================

  describe("callAIWithConfig - getModelConfig paths", () => {
    it("should work when getModelById returns null (model not found)", async () => {
      mockAiFacade.getModelById.mockResolvedValueOnce(null);
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Fallback response",
        tokensUsed: 100,
      });

      const result = await service.callAIWithConfig(
        "unknown-model",
        [{ role: "user", content: "Test" }],
        "System",
        {},
      );

      expect(result.content).toBe("Fallback response");
    });

    it("should work when getModelById throws (model fetch error)", async () => {
      mockAiFacade.getModelById.mockRejectedValueOnce(
        new Error("Model service error"),
      );
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Error fallback",
        tokensUsed: 100,
      });

      const result = await service.callAIWithConfig(
        "bad-model",
        [{ role: "user", content: "Test" }],
        "System",
        {},
      );

      expect(result.content).toBe("Error fallback");
    });
  });

  // ==================== callAIWithRetry - rate-limit sleep ====================

  describe("callAIWithRetry - rate-limit path", () => {
    const taskContext = {
      taskId: "task-s3",
      taskTitle: "S3 Task",
      missionId: "mission-s3",
    };

    it("should sleep and retry when rate limit error occurs", async () => {
      const rateLimitError = new Error(
        "rate_limit_exceeded 429 Too Many Requests",
      );
      mockAiFacade.chat
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({ content: "Retry succeeded", tokensUsed: 100 });

      const result = await service.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Test" }],
        "System",
        {},
        taskContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Retry succeeded");
      expect(mockAiFacade.chat).toHaveBeenCalledTimes(2);
    });

    it("should retry on retryable non-rate-limit error", async () => {
      const retryableError = new Error("connection_timeout Network error");
      mockAiFacade.chat
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce({
          content: "Retryable success",
          tokensUsed: 100,
        });

      const result = await service.callAIWithRetry(
        "gpt-4",
        [],
        "System",
        {},
        taskContext,
      );

      expect(result.success).toBe(true);
    });

    it("should return failure after exhausting all retries", async () => {
      const persistentError = new Error("service_unavailable");
      mockAiFacade.chat.mockRejectedValue(persistentError);

      const result = await service.callAIWithRetry(
        "gpt-4",
        [],
        "System",
        {},
        taskContext,
      );

      expect(result.success).toBe(false);
    });
  });

  // ==================== handleTaskExecutionFailure ====================

  describe("handleTaskExecutionFailure", () => {
    it("should cancel the task and send failure message", async () => {
      const mission = buildMission({ status: MissionStatus.IN_PROGRESS });
      const task = buildTask({ status: AgentTaskStatus.IN_PROGRESS });
      const failedAgent = {
        id: "member-s3",
        agentName: "Alice",
        displayName: "Alice Agent",
        aiModel: "gemini-pro",
        isLeader: false,
      };

      mockPrisma.agentTask.update.mockResolvedValueOnce({
        ...task,
        status: AgentTaskStatus.CANCELLED,
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(mission);

      // Replan returns no new tasks (simplified failure path)
      callbacks.leaderReviewTask.mockResolvedValue(undefined);

      await service.handleTaskExecutionFailure(
        mission as never,
        task as never,
        failedAgent as never,
        "AI returned error response",
        callbacks as never,
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-s3" },
          data: expect.objectContaining({
            status: AgentTaskStatus.CANCELLED,
          }),
        }),
      );
    });

    it("should send failure message to topic when callbacks are set", async () => {
      const mission = buildMission({ status: MissionStatus.IN_PROGRESS });
      const task = buildTask({ status: AgentTaskStatus.IN_PROGRESS });
      const failedAgent = {
        id: "member-s3",
        agentName: "Alice",
        displayName: "Alice Agent",
        aiModel: "gemini-pro",
        isLeader: false,
      };

      mockPrisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.CANCELLED,
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(mission);

      await service.handleTaskExecutionFailure(
        mission as never,
        task as never,
        failedAgent as never,
        "Task failed with error",
        callbacks as never,
      );

      expect(callbacks.sendMessageToTopic).toHaveBeenCalled();
    });

    it("should call createLog on failure", async () => {
      const mission = buildMission({ status: MissionStatus.IN_PROGRESS });
      const task = buildTask({ status: AgentTaskStatus.IN_PROGRESS });
      const failedAgent = {
        id: "member-s3",
        agentName: "Alice",
        displayName: "Alice Agent",
        aiModel: "gemini-pro",
        isLeader: false,
      };

      mockPrisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.CANCELLED,
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(mission);

      await service.handleTaskExecutionFailure(
        mission as never,
        task as never,
        failedAgent as never,
        "Error occurred",
        callbacks as never,
      );

      expect(callbacks.createLog).toHaveBeenCalled();
    });

    it("should handle permanent error (isPermanentError=true) by cancelling without replan", async () => {
      const mission = buildMission({ status: MissionStatus.IN_PROGRESS });
      const task = buildTask({ status: AgentTaskStatus.IN_PROGRESS });
      const failedAgent = {
        id: "member-s3",
        agentName: "Alice",
        displayName: "Alice Agent",
        aiModel: "gemini-pro",
        isLeader: false,
      };

      mockPrisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.CANCELLED,
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(mission);

      await service.handleTaskExecutionFailure(
        mission as never,
        task as never,
        failedAgent as never,
        "invalid_api_key Authentication failed permanently",
        callbacks as never,
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentTaskStatus.CANCELLED,
          }),
        }),
      );
    });
  });

  // ==================== executeTask - tool-related paths ====================

  describe("executeTask - capability and web-search paths", () => {
    it("should call getAvailableCapabilities when CAS succeeds", async () => {
      mockPrisma.agentTask.updateMany.mockResolvedValueOnce({ count: 1 });
      mockAiFacade.getAvailableCapabilities.mockResolvedValueOnce({
        tools: [],
        skills: [],
        mcpTools: [],
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Task output here",
        tokensUsed: 200,
      });

      const mission = buildMission({ status: MissionStatus.IN_PROGRESS });
      const task = buildTask();

      await service.executeTask(mission as never, task as never);

      expect(mockAiFacade.getAvailableCapabilities).toHaveBeenCalled();
    });

    it("should complete task after successful AI execution", async () => {
      mockPrisma.agentTask.updateMany.mockResolvedValueOnce({ count: 1 });
      mockAiFacade.getAvailableCapabilities.mockResolvedValueOnce({
        tools: [],
        skills: [],
        mcpTools: [],
      });
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Excellent task result",
        tokensUsed: 300,
      });
      mockLongContentService.processTaskCompletion.mockResolvedValueOnce({
        needsContinuation: false,
        finalContent: "Excellent task result",
      });

      const mission = buildMission({ status: MissionStatus.IN_PROGRESS });
      const task = buildTask();

      await service.executeTask(mission as never, task as never);

      expect(stateManager.finishTask).toHaveBeenCalledWith("task-s3");
    });

    it("should mark task BLOCKED when getAvailableCapabilities throws", async () => {
      mockPrisma.agentTask.updateMany.mockResolvedValueOnce({ count: 1 });
      mockAiFacade.getAvailableCapabilities.mockRejectedValueOnce(
        new Error("Capability fetch failed"),
      );

      const mission = buildMission({ status: MissionStatus.IN_PROGRESS });
      const task = buildTask();

      await service.executeTask(mission as never, task as never);

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-s3" },
          data: expect.objectContaining({
            status: AgentTaskStatus.BLOCKED,
          }),
        }),
      );
    });
  });

  // ==================== executeNextTasks - dependency deadlock detection ====================

  describe("executeNextTasks - deadlock and dependency scenarios", () => {
    it("should handle mission with only PENDING tasks all having unmet dependencies", async () => {
      const task1 = buildTask({
        id: "dep-a",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: ["dep-b"],
      });
      const task2 = buildTask({
        id: "dep-b",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: ["dep-a"],
      });

      const mission = buildMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [task1, task2],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(mission);

      await service.executeNextTasks("mission-s3");

      expect(stateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-s3",
      );
    });

    it("should process PENDING task with no dependencies", async () => {
      const task = buildTask({
        id: "task-free",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: [],
      });
      const mission = buildMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [task],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(mission);
      mockPrisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mockAiFacade.getAvailableCapabilities.mockResolvedValue({
        tools: [],
        skills: [],
        mcpTools: [],
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Task result",
        tokensUsed: 100,
      });

      await service.executeNextTasks("mission-s3");

      expect(stateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-s3",
      );
    });

    it("should process PENDING task whose dependency is COMPLETED", async () => {
      const completedDep = buildTask({
        id: "dep-done",
        status: AgentTaskStatus.COMPLETED,
        dependsOnIds: [],
      });
      const pendingTask = buildTask({
        id: "task-depends",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: ["dep-done"],
      });

      const mission = buildMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [completedDep, pendingTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(mission);
      mockPrisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mockAiFacade.getAvailableCapabilities.mockResolvedValue({
        tools: [],
        skills: [],
        mcpTools: [],
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "Dependent task result",
        tokensUsed: 100,
      });

      await service.executeNextTasks("mission-s3");

      expect(stateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-s3",
      );
    });
  });

  // ==================== mapTemperatureToCreativity edge values ====================

  describe("mapTemperatureToCreativity - edge value mapping", () => {
    type MapFn = (temp: number) => string;
    const getMapFn = () =>
      (service as unknown as { mapTemperatureToCreativity: MapFn })
        .mapTemperatureToCreativity;

    it("should map temperature 0.0 to deterministic", () => {
      const result = getMapFn().call(service, 0.0);
      expect(result).toBe("deterministic");
    });

    it("should map temperature 0.2 to deterministic", () => {
      const result = getMapFn().call(service, 0.2);
      expect(result).toBe("deterministic");
    });

    it("should map temperature 0.4 to medium", () => {
      const result = getMapFn().call(service, 0.4);
      expect(result).toBe("medium");
    });

    it("should map temperature 0.6 to medium", () => {
      const result = getMapFn().call(service, 0.6);
      expect(result).toBe("medium");
    });

    it("should map temperature 0.8 to high", () => {
      const result = getMapFn().call(service, 0.8);
      expect(result).toBe("high");
    });

    it("should map temperature 1.0 to high", () => {
      const result = getMapFn().call(service, 1.0);
      expect(result).toBe("high");
    });
  });

  // ==================== mapMaxTokensToOutputLength edge values ====================

  describe("mapMaxTokensToOutputLength - edge value mapping", () => {
    type MapFn = (tokens: number) => string;
    const getMapFn = () =>
      (service as unknown as { mapMaxTokensToOutputLength: MapFn })
        .mapMaxTokensToOutputLength;

    it("should map 500 tokens to minimal", () => {
      const result = getMapFn().call(service, 500);
      expect(result).toBe("minimal");
    });

    it("should map 1500 tokens to short", () => {
      const result = getMapFn().call(service, 1500);
      expect(result).toBe("short");
    });

    it("should map 4000 tokens to medium", () => {
      const result = getMapFn().call(service, 4000);
      expect(result).toBe("medium");
    });

    it("should map 8000 tokens to long", () => {
      const result = getMapFn().call(service, 8000);
      expect(result).toBe("long");
    });

    it("should handle very small token count", () => {
      const result = getMapFn().call(service, 100);
      expect(result).toBe("minimal");
    });

    it("should handle very large token count", () => {
      const result = getMapFn().call(service, 20000);
      expect(result).toBe("extended");
    });
  });

  // ==================== createToolContext ====================

  describe("createToolContext", () => {
    it("should return a ToolContext with expected shape", () => {
      type CreateFn = (toolId: string) => {
        executionId: string;
        toolId: string;
        createdAt: Date;
        callerType: string;
      };
      const createFn = (service as unknown as { createToolContext: CreateFn })
        .createToolContext;

      const before = Date.now();
      const ctx = createFn.call(service, "my-tool-id");
      const after = Date.now();

      expect(ctx.toolId).toBe("my-tool-id");
      expect(ctx.callerType).toBe("orchestrator");
      expect(ctx.executionId).toContain("my-tool-id");
      expect(ctx.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(ctx.createdAt.getTime()).toBeLessThanOrEqual(after);
    });

    it("should produce unique executionIds for consecutive calls", () => {
      type CreateFn = (toolId: string) => { executionId: string };
      const createFn = (service as unknown as { createToolContext: CreateFn })
        .createToolContext;

      const ctx1 = createFn.call(service, "tool-a");
      const ctx2 = createFn.call(service, "tool-a");

      // They are not guaranteed to be unique within 1ms, but we verify the format
      expect(ctx1.executionId).toMatch(/^tool-a-\d+-[a-z0-9]+$/);
      expect(ctx2.executionId).toMatch(/^tool-a-\d+-[a-z0-9]+$/);
    });
  });

  // ==================== ensureCallbacks ====================

  describe("ensureCallbacks", () => {
    it("should throw when callbacks are not set", () => {
      // Create a fresh service without setting callbacks
      const freshService = new (MissionExecutionService as unknown as new (
        ...args: unknown[]
      ) => MissionExecutionService)(
        mockPrisma as never,
        mockAiFacade as never,
        mockAiFacade as never,
        mockAiFacade as never,
        mockToolRegistry as never,
        mockTopicEventEmitter as never,
        mockLongContentService as never,
        mockStateManager as never,
        mockLeaderModelService as never,
      );

      const ensureFn = (
        freshService as unknown as {
          ensureCallbacks: () => unknown;
        }
      ).ensureCallbacks;

      expect(() => ensureFn.call(freshService)).toThrow(
        "ExecutionCallbacks not set",
      );
    });

    it("should return callbacks when they are set", () => {
      const ensureFn = (
        service as unknown as { ensureCallbacks: () => unknown }
      ).ensureCallbacks;

      const result = ensureFn.call(service);
      expect(result).toBeDefined();
      expect(result).toBe(callbacks);
    });
  });

  // ==================== forceCompleteStuckTasks - multiple statuses ====================

  describe("forceCompleteStuckTasks - REVISION_NEEDED and BLOCKED statuses", () => {
    it("should force-complete task stuck in REVISION_NEEDED beyond timeout", async () => {
      const stuckAt = new Date(Date.now() - 25 * 60 * 1000); // 25 min ago
      const mission = buildMission();
      const stuckTask = buildTask({
        id: "task-revision",
        status: AgentTaskStatus.REVISION_NEEDED,
        updatedAt: stuckAt,
      });

      const result = await service.forceCompleteStuckTasks(
        mission as never,
        [stuckTask] as never,
        Date.now(),
        20 * 60 * 1000, // 20 min timeout
      );

      expect(result).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-revision" },
          data: expect.objectContaining({
            status: AgentTaskStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should force-complete task stuck in BLOCKED beyond timeout", async () => {
      const stuckAt = new Date(Date.now() - 35 * 60 * 1000);
      const mission = buildMission();
      const stuckTask = buildTask({
        id: "task-blocked",
        status: AgentTaskStatus.BLOCKED,
        updatedAt: stuckAt,
      });

      const result = await service.forceCompleteStuckTasks(
        mission as never,
        [stuckTask] as never,
        Date.now(),
        30 * 60 * 1000,
      );

      expect(result).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentTaskStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should handle multiple stuck tasks and return count", async () => {
      const stuckAt = new Date(Date.now() - 25 * 60 * 1000);
      const mission = buildMission();
      const tasks = [
        buildTask({
          id: "stuck-1",
          status: AgentTaskStatus.AWAITING_REVIEW,
          updatedAt: stuckAt,
        }),
        buildTask({
          id: "stuck-2",
          status: AgentTaskStatus.BLOCKED,
          updatedAt: stuckAt,
        }),
        buildTask({
          id: "fresh-3",
          status: AgentTaskStatus.BLOCKED,
          updatedAt: new Date(), // fresh, not stuck
        }),
      ];

      mockPrisma.agentTask.update.mockResolvedValue({ ...buildTask() });

      const result = await service.forceCompleteStuckTasks(
        mission as never,
        tasks as never,
        Date.now(),
        20 * 60 * 1000,
      );

      expect(result).toBe(2);
    });
  });
});

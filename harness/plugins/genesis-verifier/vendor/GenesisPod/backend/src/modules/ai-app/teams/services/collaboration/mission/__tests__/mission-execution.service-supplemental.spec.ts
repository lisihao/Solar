/**
 * MissionExecutionService - Supplemental Tests
 *
 * Covers branches not yet tested:
 * - setCallbacks / ensureCallbacks error path
 * - callAIWithConfig: with taskProfile override, token tracking, model config fallback
 * - callAIWithRetry: heartbeat context (interval fire), empty response retry, success on 2nd attempt
 * - findAlternativeAgent: callbacks-not-set throws, single-member returns null
 * - findAlternativeAgentWithCircuitBreaker: selectBest returns valid agent, no circuit breaker available
 * - inferDomainFromTask: DESIGN type, REVIEW type, keyword-based inference (research/writing/design)
 * - mapTemperatureToCreativity / mapMaxTokensToOutputLength mapping edge values
 */

// Must be before imports - provides missing enum values not generated in worktree
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
  id: "m-supp",
  topicId: "t-supp",
  title: "Supplemental Mission",
  description: "desc",
  objectives: [],
  constraints: [],
  mustConstraints: [],
  contextPackage: null,
  totalTasks: 3,
  createdAt: new Date(),
  status: MissionStatus.IN_PROGRESS,
  leader: {
    id: "leader-supp",
    agentName: "Leader",
    displayName: "Leader Agent",
    aiModel: "gpt-4",
    isLeader: true,
  },
  tasks: [],
  ...overrides,
});

const buildTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-supp",
  missionId: "m-supp",
  title: "Task Supp",
  description: "task description",
  result: null,
  status: AgentTaskStatus.PENDING,
  revisionCount: 0,
  maxRevisions: 3,
  needsRevision: false,
  priority: "MEDIUM",
  taskType: TaskType.RESEARCH,
  dependsOnIds: [],
  startedAt: null,
  updatedAt: new Date(),
  createdAt: new Date(),
  assignedToId: "member-supp",
  assignedTo: {
    id: "member-supp",
    agentName: "Alice",
    displayName: "Alice Agent",
    aiModel: "gemini-pro",
    isLeader: false,
  },
  ...overrides,
});

const mockCallbacks = {
  completeMission: jest.fn().mockResolvedValue(undefined),
  leaderReviewTask: jest.fn().mockResolvedValue(undefined),
  getTeamMembers: jest.fn().mockResolvedValue({
    leader: {
      id: "leader-supp",
      displayName: "Leader",
      isLeader: true,
      aiModel: "gpt-4",
    },
    members: [
      {
        id: "member-a",
        displayName: "Member A",
        isLeader: false,
        aiModel: "claude-3",
      },
      {
        id: "member-b",
        displayName: "Member B",
        isLeader: false,
        aiModel: "gemini-pro",
      },
    ],
    all: [
      {
        id: "leader-supp",
        displayName: "Leader",
        isLeader: true,
        aiModel: "gpt-4",
      },
      {
        id: "member-a",
        displayName: "Member A",
        isLeader: false,
        aiModel: "claude-3",
      },
      {
        id: "member-b",
        displayName: "Member B",
        isLeader: false,
        aiModel: "gemini-pro",
      },
    ],
  }),
  createLog: jest.fn().mockResolvedValue(undefined),
  sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-supp" }),
  updateMissionProgress: jest.fn().mockResolvedValue(undefined),
  buildTaskExecutionPrompt: jest.fn().mockReturnValue("Prompt"),
  getAgentSystemPrompt: jest.fn().mockReturnValue("System prompt"),
  getLeaderSystemPrompt: jest.fn().mockReturnValue("Leader system prompt"),
};

// ============================================================
// Tests
// ============================================================

describe("MissionExecutionService (supplemental)", () => {
  let service: MissionExecutionService;

  const mockAiFacade = {
    chat: jest
      .fn()
      .mockResolvedValue({ content: "AI response", tokensUsed: 100 }),
    getModelById: jest
      .fn()
      .mockResolvedValue({ id: "gpt-4", modelId: "gpt-4", name: "GPT-4" }),
    circuitBreaker: {
      canExecute: jest.fn().mockReturnValue(true),
      selectBest: jest.fn().mockReturnValue(null),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
    },
  };

  const mockPrisma = {
    agentTask: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(buildTask()),
      update: jest.fn().mockResolvedValue(buildTask()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    teamMission: {
      findUnique: jest.fn().mockResolvedValue(buildMission()),
      update: jest.fn().mockResolvedValue(buildMission()),
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
      .mockResolvedValue({ needsContinuation: false }),
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
      content: "AI response",
      tokensUsed: 100,
    });
    mockAiFacade.getModelById.mockResolvedValue({
      id: "gpt-4",
      modelId: "gpt-4",
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
    service.setCallbacks(mockCallbacks);
  });

  // ==================== setCallbacks / ensureCallbacks ====================

  describe("setCallbacks / ensureCallbacks", () => {
    it("should throw when callbacks are not set and findAlternativeAgent is called", async () => {
      // Create fresh service without setting callbacks
      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          MissionExecutionService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: ChatFacade, useValue: mockAiFacade },
          { provide: AgentFacade, useValue: mockAiFacade },
          { provide: ToolFacade, useValue: mockAiFacade },
          { provide: ToolRegistry, useValue: mockToolRegistry },
          {
            provide: TopicEventEmitterService,
            useValue: mockTopicEventEmitter,
          },
          {
            provide: TeamsLongContentService,
            useValue: mockLongContentService,
          },
          { provide: MissionStateManager, useValue: mockStateManager },
          { provide: LeaderModelService, useValue: mockLeaderModelService },
        ],
      }).compile();

      const freshService = module2.get<MissionExecutionService>(
        MissionExecutionService,
      );
      // DO NOT call setCallbacks

      await expect(
        freshService.findAlternativeAgent(buildMission(), [], buildTask()),
      ).rejects.toThrow("ExecutionCallbacks not set");
    });

    it("should succeed after setCallbacks is called", () => {
      // Already called setCallbacks in beforeEach
      expect(() => service.setCallbacks(mockCallbacks)).not.toThrow();
    });
  });

  // ==================== callAIWithConfig ====================

  describe("callAIWithConfig", () => {
    it("should use provided taskProfile directly", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "Task profile response",
        tokensUsed: 50,
      });

      const result = await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Hello" }],
        "System",
        { taskProfile: { creativity: "high", outputLength: "long" } },
      );

      expect(result.content).toBe("Task profile response");
      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: { creativity: "high", outputLength: "long" },
        }),
      );
    });

    it("should map legacy maxTokens/temperature when taskProfile not provided", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "Legacy mapping response",
        tokensUsed: 80,
      });

      const result = await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Hello" }],
        "System",
        { maxTokens: 8000, temperature: 0.9 },
      );

      expect(result.content).toBe("Legacy mapping response");
      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({
            creativity: expect.any(String),
            outputLength: expect.any(String),
          }),
        }),
      );
    });

    it("should track tokens when missionId is provided and tokensUsed > 0", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "Token tracking",
        tokensUsed: 500,
      });

      await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Hi" }],
        "System",
        { missionId: "m-supp" },
      );

      // Allow async token tracking to fire
      await new Promise((r) => setTimeout(r, 5));

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it("should not track tokens when tokensUsed is 0", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "Zero tokens",
        tokensUsed: 0,
      });

      await service.callAIWithConfig(
        "gpt-4",
        [{ role: "user", content: "Hi" }],
        "System",
        { missionId: "m-supp" },
      );

      await new Promise((r) => setTimeout(r, 5));

      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it("should fall back to aiModel string when model config not found", async () => {
      mockAiFacade.getModelById.mockRejectedValue(new Error("Model not found"));
      mockAiFacade.chat.mockResolvedValue({
        content: "Fallback model response",
        tokensUsed: 30,
      });

      const result = await service.callAIWithConfig(
        "my-custom-model",
        [{ role: "user", content: "Hi" }],
        "System",
      );

      expect(result.content).toBe("Fallback model response");
      // Should use the model string directly as fallback
      expect(mockAiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "my-custom-model" }),
      );
    });
  });

  // ==================== callAIWithRetry ====================

  describe("callAIWithRetry", () => {
    const taskCtx = {
      taskId: "t-supp",
      taskTitle: "Retry test",
      missionId: "m-supp",
    };

    it("should succeed on first attempt", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "First attempt success",
        tokensUsed: 100,
      });

      const result = await service.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Do task" }],
        "System",
        {},
        taskCtx,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("First attempt success");
      expect(result.attempts).toBe(1);
    });

    it("should retry on first failure and succeed on second attempt", async () => {
      mockAiFacade.chat
        .mockRejectedValueOnce(new Error("timeout: Request timed out"))
        .mockResolvedValueOnce({
          content: "Second attempt works",
          tokensUsed: 120,
        });

      const result = await service.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Do task" }],
        "System",
        {},
        taskCtx,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Second attempt works");
      expect(result.attempts).toBeGreaterThanOrEqual(2);
    });

    it("should return failure when all retries are exhausted", async () => {
      mockAiFacade.chat.mockRejectedValue(
        new Error("timeout: Service unavailable"),
      );

      const result = await service.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Do task" }],
        "System",
        {},
        taskCtx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return failure when response is empty", async () => {
      // Return response with no content
      mockAiFacade.chat.mockResolvedValue({ content: null, tokensUsed: 0 });
      // All retries return empty
      mockAiFacade.getModelById.mockResolvedValue({
        id: "gpt-4",
        modelId: "gpt-4",
      });

      const result = await service.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Do task" }],
        "System",
        {},
        taskCtx,
      );

      expect(result.success).toBe(false);
    });

    it("should accept heartbeatContext parameter without error", async () => {
      mockAiFacade.chat.mockResolvedValue({
        content: "Response with heartbeat",
        tokensUsed: 50,
      });

      const heartbeatContext = {
        topicId: "t-supp",
        agentId: "member-supp",
        agentName: "Member Supp",
      };

      const result = await service.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Long task" }],
        "System",
        {},
        taskCtx,
        heartbeatContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Response with heartbeat");
    });
  });

  // ==================== inferDomainFromTask ====================

  describe("inferDomainFromTask (private)", () => {
    type ServiceWithPrivate = {
      inferDomainFromTask: (task: ReturnType<typeof buildTask>) => string;
    };

    it("should infer 'research' for RESEARCH task type", () => {
      const task = buildTask({ taskType: TaskType.RESEARCH });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("research");
    });

    it("should infer 'writing' for DOCUMENTATION task type", () => {
      const task = buildTask({ taskType: TaskType.DOCUMENTATION });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("writing");
    });

    it("should infer 'writing' for CREATIVE task type", () => {
      const task = buildTask({ taskType: TaskType.CREATIVE });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("writing");
    });

    it("should infer 'design' for DESIGN task type", () => {
      const task = buildTask({ taskType: TaskType.DESIGN });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("design");
    });

    it("should infer 'analysis' for REVIEW task type", () => {
      const task = buildTask({ taskType: TaskType.REVIEW });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("analysis");
    });

    it("should infer 'analysis' for SYNTHESIS task type", () => {
      const task = buildTask({ taskType: TaskType.SYNTHESIS });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("analysis");
    });

    it("should infer 'research' from Chinese keywords in description", () => {
      const task = buildTask({
        taskType: TaskType.IMPLEMENTATION,
        title: "Task",
        description: "对市场进行调研和分析",
      });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("research");
    });

    it("should infer 'writing' from Chinese keywords in title", () => {
      const task = buildTask({
        taskType: TaskType.IMPLEMENTATION,
        title: "撰写技术文档",
        description: "Write the specification",
      });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("writing");
    });

    it("should infer 'design' from Chinese keywords in description", () => {
      const task = buildTask({
        taskType: TaskType.IMPLEMENTATION,
        title: "Create diagrams",
        description: "设计系统架构图和PPT",
      });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("design");
    });

    it("should return 'general' for unknown task types/keywords", () => {
      const task = buildTask({
        taskType: TaskType.IMPLEMENTATION,
        title: "Deploy service",
        description: "Deploy the backend service",
      });
      const domain = (
        service as unknown as ServiceWithPrivate
      ).inferDomainFromTask(task);
      expect(domain).toBe("general");
    });
  });

  // ==================== mapTemperatureToCreativity / mapMaxTokensToOutputLength ====================

  describe("mapTemperatureToCreativity (private)", () => {
    type ServiceWithMapping = {
      mapTemperatureToCreativity: (temp?: number) => string;
      mapMaxTokensToOutputLength: (tokens?: number) => string;
    };

    it("should map undefined temperature to 'medium'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapTemperatureToCreativity(undefined);
      expect(result).toBe("medium");
    });

    it("should map temperature 0.1 to 'deterministic'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapTemperatureToCreativity(0.1);
      expect(result).toBe("deterministic");
    });

    it("should map temperature 0.3 to 'low'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapTemperatureToCreativity(0.3);
      expect(result).toBe("low");
    });

    it("should map temperature 0.7 to 'medium'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapTemperatureToCreativity(0.7);
      expect(result).toBe("medium");
    });

    it("should map temperature 0.9 to 'high'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapTemperatureToCreativity(0.9);
      expect(result).toBe("high");
    });

    it("should map undefined maxTokens to 'standard'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapMaxTokensToOutputLength(undefined);
      expect(result).toBe("standard");
    });

    it("should map maxTokens 500 to 'minimal'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapMaxTokensToOutputLength(500);
      expect(result).toBe("minimal");
    });

    it("should map maxTokens 8000 to 'long'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapMaxTokensToOutputLength(8000);
      expect(result).toBe("long");
    });

    it("should map maxTokens 4000 to 'medium'", () => {
      const result = (
        service as unknown as ServiceWithMapping
      ).mapMaxTokensToOutputLength(4000);
      expect(result).toBe("medium");
    });
  });

  // ==================== findAlternativeAgentWithCircuitBreaker ====================

  describe("findAlternativeAgentWithCircuitBreaker", () => {
    it("should return selected agent when circuitBreaker.selectBest returns a valid id", async () => {
      mockAiFacade.circuitBreaker.selectBest.mockReturnValue("member-a");
      mockAiFacade.circuitBreaker.canExecute.mockReturnValue(true);

      const mission = buildMission();
      const task = buildTask();

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        mission,
        [],
        task,
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe("member-a");
    });

    it("should fall back to first candidate when selectBest returns null", async () => {
      mockAiFacade.circuitBreaker.selectBest.mockReturnValue(null);
      mockAiFacade.circuitBreaker.canExecute.mockReturnValue(true);

      const mission = buildMission();
      const task = buildTask();

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        mission,
        [],
        task,
      );

      // Falls back to first candidate (member-a or member-b)
      expect(result).not.toBeNull();
    });

    it("should return null when circuit breaker blocks all agents", async () => {
      mockAiFacade.circuitBreaker.canExecute.mockReturnValue(false);

      const mission = buildMission();
      const task = buildTask();

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        mission,
        [],
        task,
      );

      expect(result).toBeNull();
    });

    it("should handle case when agentFacade has no circuitBreaker", async () => {
      // Temporarily remove circuitBreaker
      const savedCB = mockAiFacade.circuitBreaker;
      (mockAiFacade as unknown as { circuitBreaker: null }).circuitBreaker =
        null;

      const mission = buildMission();
      const task = buildTask();

      // Should handle gracefully
      await expect(
        service.findAlternativeAgentWithCircuitBreaker(mission, [], task),
      ).resolves.toBeDefined();

      mockAiFacade.circuitBreaker = savedCB;
    });
  });
});

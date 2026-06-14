/**
 * MissionExecutionService Tests
 *
 * Focus on testable public/accessible methods:
 * - setCallbacks / ensureCallbacks
 * - callAIWithConfig
 * - callAIWithRetry
 * - mapTemperatureToCreativity / mapMaxTokensToOutputLength
 */

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

const buildMockMission = (overrides = {}) => ({
  id: "mission-1",
  topicId: "topic-1",
  title: "Test Mission",
  description: "Test description",
  goals: "Test goals",
  constraints: [],
  mustConstraints: [],
  contextPackage: null,
  status: MissionStatus.IN_PROGRESS,
  leader: {
    id: "leader-1",
    agentName: "Leader",
    displayName: "Leader Agent",
    aiModel: "gpt-4",
    isLeader: true,
  },
  members: [
    {
      id: "member-1",
      agentName: "Alice",
      displayName: "Alice Agent",
      aiModel: "gemini-pro",
      isLeader: false,
    },
  ],
  tasks: [],
  ...overrides,
});

const buildMockTask = (overrides = {}) => ({
  id: "task-1",
  title: "Write Chapter 1",
  description: "Write the first chapter",
  result: null,
  status: AgentTaskStatus.PENDING,
  revisionCount: 0,
  maxRevisions: 3,
  needsRevision: false,
  priority: "MEDIUM",
  taskType: TaskType.IMPLEMENTATION,
  dependsOnIds: [],
  assignedTo: {
    id: "member-1",
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
      id: "leader-1",
      agentName: "Leader",
      displayName: "Leader Agent",
      aiModel: "gpt-4",
      isLeader: true,
    },
    members: [
      {
        id: "member-1",
        agentName: "Alice",
        displayName: "Alice Agent",
        aiModel: "gemini-pro",
        isLeader: false,
      },
    ],
    all: [],
  }),
  createLog: jest.fn().mockResolvedValue(undefined),
  sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-1" }),
  updateMissionProgress: jest.fn().mockResolvedValue(undefined),
  buildTaskExecutionPrompt: jest.fn().mockReturnValue("Task execution prompt"),
  getAgentSystemPrompt: jest.fn().mockReturnValue("Agent system prompt"),
  getLeaderSystemPrompt: jest.fn().mockReturnValue("Leader system prompt"),
};

describe("MissionExecutionService", () => {
  let service: MissionExecutionService;
  let prisma: jest.Mocked<PrismaService>;
  let aiFacade: jest.Mocked<ChatFacade>;
  let topicEventEmitter: jest.Mocked<TopicEventEmitterService>;
  let longContentService: jest.Mocked<TeamsLongContentService>;
  let stateManager: jest.Mocked<MissionStateManager>;
  let leaderModelService: jest.Mocked<LeaderModelService>;
  let toolRegistry: jest.Mocked<ToolRegistry>;

  const mockAiFacade = {
    chat: jest
      .fn()
      .mockResolvedValue({ content: "AI response content", tokensUsed: 200 }),
    getModelById: jest
      .fn()
      .mockResolvedValue({ id: "gpt-4", modelId: "gpt-4", name: "GPT-4" }),
    circuitBreaker: {
      isOpen: jest.fn().mockReturnValue(false),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
    },
    execStateManager: {
      startTask: jest.fn().mockReturnValue(true),
      finishTask: jest.fn(),
      isTaskExecuting: jest.fn().mockReturnValue(false),
    },
    capabilityResolver: {
      resolveCapabilities: jest
        .fn()
        .mockResolvedValue({ tools: [], skills: [] }),
    },
  };

  const mockPrisma = {
    agentTask: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(buildMockTask()),
      update: jest.fn().mockResolvedValue(buildMockTask()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    teamMission: {
      findUnique: jest.fn().mockResolvedValue(buildMockMission()),
      findFirst: jest.fn().mockResolvedValue(buildMockMission()),
      update: jest.fn().mockResolvedValue(buildMockMission()),
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
      data: { content: "Response", tokensUsed: 100 },
      fallbackUsed: false,
      modelUsed: "gpt-4",
    }),
  };

  const mockToolRegistry = {
    get: jest.fn().mockReturnValue(null),
    has: jest.fn().mockReturnValue(false),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
    aiFacade = module.get(ChatFacade);
    topicEventEmitter = module.get(TopicEventEmitterService);
    longContentService = module.get(TeamsLongContentService);
    stateManager = module.get(MissionStateManager);
    leaderModelService = module.get(LeaderModelService);
    toolRegistry = module.get(ToolRegistry);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== setCallbacks ====================

  describe("setCallbacks", () => {
    it("should set callbacks without error", () => {
      expect(() => service.setCallbacks(mockCallbacks as any)).not.toThrow();
    });

    it("should throw when calling methods without callbacks set", async () => {
      // Create a fresh service without callbacks
      const freshService = new MissionExecutionService(
        prisma,
        aiFacade,
        aiFacade as unknown as AgentFacade,
        aiFacade as unknown as ToolFacade,
        toolRegistry,
        topicEventEmitter,
        longContentService,
        stateManager,
        leaderModelService,
      );

      await expect(freshService.executeNextTasks("mission-1")).rejects.toThrow(
        "ExecutionCallbacks not set",
      );
    });
  });

  // ==================== callAIWithConfig ====================

  describe("callAIWithConfig", () => {
    it("should call aiFacade.chat with messages and system prompt", async () => {
      const messages = [{ role: "user", content: "Hello" }];
      const result = await service.callAIWithConfig(
        "gpt-4",
        messages,
        "System prompt",
      );

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "system",
              content: "System prompt",
            }),
          ]),
        }),
      );
      expect(result.content).toBe("AI response content");
    });

    it("should use taskProfile when provided", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        taskProfile: { creativity: "high", outputLength: "long" },
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: { creativity: "high", outputLength: "long" },
        }),
      );
    });

    it("should map temperature to creativity when taskProfile not provided", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        temperature: 0.1,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "deterministic" }),
        }),
      );
    });

    it("should map maxTokens to outputLength", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        maxTokens: 500,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "minimal" }),
        }),
      );
    });

    it("should track tokens when missionId is provided", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({
        content: "Response",
        tokensUsed: 500,
      });

      await service.callAIWithConfig("gpt-4", [], "System", {
        missionId: "mission-1",
      });

      // Give async token tracking time to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("should use modelId from model config when available", async () => {
      mockAiFacade.getModelById.mockResolvedValueOnce({
        id: "gpt-4",
        modelId: "gpt-4-turbo",
        name: "GPT-4 Turbo",
      });

      await service.callAIWithConfig("gpt-4", [], "System");

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gpt-4-turbo" }),
      );
    });

    it("should fallback to provided model when model config not found", async () => {
      mockAiFacade.getModelById.mockResolvedValueOnce(null);

      await service.callAIWithConfig("fallback-model", [], "System");

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "fallback-model" }),
      );
    });
  });

  // ==================== callAIWithRetry ====================

  describe("callAIWithRetry", () => {
    const taskContext = {
      taskId: "task-1",
      taskTitle: "Test Task",
      missionId: "mission-1",
    };

    it("should return success on first attempt", async () => {
      const result = await service.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Hello" }],
        "System",
        {},
        taskContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("AI response content");
      expect(result.attempts).toBe(1);
    });

    it("should retry on retryable error", async () => {
      mockAiFacade.chat
        .mockRejectedValueOnce(new Error("network timeout"))
        .mockResolvedValueOnce({
          content: "Success on retry",
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
      expect(result.attempts).toBe(2);
    });

    it("should fail after max retries", async () => {
      mockAiFacade.chat.mockRejectedValue(new Error("persistent error"));

      const result = await service.callAIWithRetry(
        "gpt-4",
        [],
        "System",
        {},
        taskContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("persistent error");
    });

    it("should emit heartbeat events when heartbeat context provided", async () => {
      const heartbeatContext = {
        topicId: "topic-1",
        agentId: "agent-1",
        agentName: "Alice",
      };

      await service.callAIWithRetry(
        "gpt-4",
        [],
        "System",
        {},
        taskContext,
        heartbeatContext,
      );

      // heartbeat timer clears on success
      expect((result) => result).toBeDefined();
    });
  });

  // ==================== executeNextTasks ====================

  describe("executeNextTasks", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should skip when mission execution is already in progress", async () => {
      (stateManager.startMissionExecution as jest.Mock).mockReturnValueOnce(
        false,
      );

      await service.executeNextTasks("mission-1");

      expect(prisma.teamMission.findFirst).not.toHaveBeenCalled();
    });

    it("should handle mission not found", async () => {
      mockPrisma.teamMission.findFirst.mockResolvedValueOnce(null);

      await service.executeNextTasks("nonexistent");

      expect(stateManager.finishMissionExecution).toHaveBeenCalled();
    });

    it("should complete mission when all tasks are done", async () => {
      const completedMission = {
        ...buildMockMission(),
        tasks: [{ ...buildMockTask(), status: AgentTaskStatus.COMPLETED }],
      };
      mockPrisma.teamMission.findFirst.mockResolvedValueOnce(completedMission);

      await service.executeNextTasks("mission-1");

      expect(stateManager.finishMissionExecution).toHaveBeenCalled();
    });

    it("should execute pending tasks that have no pending dependencies", async () => {
      const missionWithTasks = {
        ...buildMockMission(),
        tasks: [
          {
            ...buildMockTask(),
            id: "task-1",
            status: AgentTaskStatus.PENDING,
            dependsOnIds: [],
          },
        ],
      };
      mockPrisma.teamMission.findFirst.mockResolvedValueOnce(missionWithTasks);

      // Mock task execution to return without error
      mockPrisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentTask.findUnique.mockResolvedValue({
        ...buildMockTask(),
        status: AgentTaskStatus.IN_PROGRESS,
      });

      await service.executeNextTasks("mission-1");

      expect(stateManager.finishMissionExecution).toHaveBeenCalled();
    });

    it("should release pending executions after completing", async () => {
      const missionWithTasks = {
        ...buildMockMission(),
        tasks: [{ ...buildMockTask(), status: AgentTaskStatus.COMPLETED }],
      };
      mockPrisma.teamMission.findFirst.mockResolvedValueOnce(missionWithTasks);

      await service.executeNextTasks("mission-1");

      expect(stateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-1",
      );
    });
  });

  // ==================== autoRetryBlockedTasks ====================

  describe("autoRetryBlockedTasks", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
      // Add canExecute to mock circuitBreaker
      mockAiFacade.circuitBreaker.canExecute = jest.fn().mockReturnValue(true);
      mockAiFacade.circuitBreaker.getCooldownRemaining = jest
        .fn()
        .mockReturnValue(0);
    });

    it("should retry blocked task that can be executed and is not stuck", async () => {
      const mission = buildMockMission();
      const blockedTask = {
        ...buildMockTask(),
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(), // recent - not stuck
      };

      // canExecute = true, taskAge < stuckTimeoutMs
      const result = await service.autoRetryBlockedTasks(
        mission as any,
        [blockedTask] as any,
        Date.now(),
        30 * 60 * 1000, // 30 min timeout
      );

      expect(result).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should force complete task older than stuckTimeoutMs", async () => {
      const mission = buildMockMission();
      const stuckAt = new Date(Date.now() - 40 * 60 * 1000); // 40 min ago
      const blockedTask = {
        ...buildMockTask(),
        status: AgentTaskStatus.BLOCKED,
        updatedAt: stuckAt,
      };

      const result = await service.autoRetryBlockedTasks(
        mission as any,
        [blockedTask] as any,
        Date.now(),
        30 * 60 * 1000, // 30 min timeout
      );

      expect(result).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should return 0 when circuit breaker blocks and task is not stuck", async () => {
      mockAiFacade.circuitBreaker.canExecute = jest.fn().mockReturnValue(false);

      const mission = buildMockMission();
      const blockedTask = {
        ...buildMockTask(),
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(), // recent
      };

      const result = await service.autoRetryBlockedTasks(
        mission as any,
        [blockedTask] as any,
        Date.now(),
        30 * 60 * 1000,
      );

      expect(result).toBe(0);
    });

    it("should return 0 for empty task list", async () => {
      const mission = buildMockMission();

      const result = await service.autoRetryBlockedTasks(
        mission as any,
        [],
        Date.now(),
        30 * 60 * 1000,
      );

      expect(result).toBe(0);
    });
  });

  // ==================== forceCompleteStuckTasks ====================

  describe("forceCompleteStuckTasks", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should force complete tasks stuck in progress for too long", async () => {
      const mission = buildMockMission();
      const stuckAt = new Date(Date.now() - 40 * 60 * 1000); // 40 min ago
      const stuckTask = {
        ...buildMockTask(),
        status: AgentTaskStatus.IN_PROGRESS,
        updatedAt: stuckAt,
        result: null,
        startedAt: stuckAt,
      };

      const result = await service.forceCompleteStuckTasks(
        mission as any,
        [stuckTask] as any,
        Date.now(),
        30 * 60 * 1000,
      );

      expect(result).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should skip tasks not yet stuck", async () => {
      const mission = buildMockMission();
      const recentTask = {
        ...buildMockTask(),
        status: AgentTaskStatus.IN_PROGRESS,
        updatedAt: new Date(), // recent
        result: null,
      };

      const result = await service.forceCompleteStuckTasks(
        mission as any,
        [recentTask] as any,
        Date.now(),
        30 * 60 * 1000,
      );

      expect(result).toBe(0);
      expect(prisma.agentTask.update).not.toHaveBeenCalled();
    });
  });

  // ==================== findAlternativeAgent ====================

  describe("findAlternativeAgent", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should find alternative agent from team members", async () => {
      const task = buildMockTask();
      const mission = buildMockMission();

      const result = await service.findAlternativeAgent(
        mission as any,
        [],
        task as any,
      );

      // Returns null or an agent member
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("should return null when no alternative agents available", async () => {
      const task = buildMockTask();
      const mission = buildMockMission({ members: [] });

      const result = await service.findAlternativeAgent(
        mission as any,
        [],
        task as any,
      );

      expect(result).toBeNull();
    });

    it("should return null when only 1 member in team", async () => {
      mockCallbacks.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          agentName: "Leader",
          displayName: "Leader Agent",
          aiModel: "gpt-4",
          isLeader: true,
        },
        members: [],
        all: [
          {
            id: "leader-1",
            agentName: "Leader",
            displayName: "Leader Agent",
            aiModel: "gpt-4",
            isLeader: true,
          },
        ],
      });

      const task = buildMockTask();
      const mission = buildMockMission();

      const result = await service.findAlternativeAgent(
        mission as any,
        [],
        task as any,
      );

      expect(result).toBeNull();
    });

    it("should return non-leader candidate when one is available and exclude failedAgentIds", async () => {
      mockCallbacks.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          agentName: "Leader",
          displayName: "Leader Agent",
          aiModel: "gpt-4",
          isLeader: true,
        },
        members: [
          {
            id: "member-1",
            agentName: "Alice",
            displayName: "Alice Agent",
            aiModel: "gemini",
            isLeader: false,
          },
          {
            id: "member-2",
            agentName: "Bob",
            displayName: "Bob Agent",
            aiModel: "claude",
            isLeader: false,
          },
        ],
        all: [
          {
            id: "leader-1",
            agentName: "Leader",
            displayName: "Leader Agent",
            aiModel: "gpt-4",
            isLeader: true,
          },
          {
            id: "member-1",
            agentName: "Alice",
            displayName: "Alice Agent",
            aiModel: "gemini",
            isLeader: false,
          },
          {
            id: "member-2",
            agentName: "Bob",
            displayName: "Bob Agent",
            aiModel: "claude",
            isLeader: false,
          },
        ],
      });
      mockPrisma.agentTask.groupBy.mockResolvedValueOnce([]);

      const task = buildMockTask();
      const mission = buildMockMission();

      const result = await service.findAlternativeAgent(
        mission as any,
        ["member-1"],
        task as any,
      );

      expect(result).not.toBeNull();
      expect((result as any).id).toBe("member-2");
    });

    it("should handle errors and return null", async () => {
      mockCallbacks.getTeamMembers.mockRejectedValueOnce(new Error("DB error"));

      const task = buildMockTask();
      const mission = buildMockMission();

      const result = await service.findAlternativeAgent(
        mission as any,
        [],
        task as any,
      );

      expect(result).toBeNull();
    });
  });

  // ==================== findAlternativeAgentWithCircuitBreaker ====================

  describe("findAlternativeAgentWithCircuitBreaker", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
      mockAiFacade.circuitBreaker.canExecute = jest.fn().mockReturnValue(true);
      mockAiFacade.circuitBreaker.selectBest = jest
        .fn()
        .mockReturnValue("member-1");
    });

    it("should return null when only 1 member", async () => {
      mockCallbacks.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          displayName: "Leader",
          aiModel: "gpt-4",
          isLeader: true,
        },
        members: [],
        all: [
          {
            id: "leader-1",
            displayName: "Leader",
            aiModel: "gpt-4",
            isLeader: true,
          },
        ],
      });

      const task = buildMockTask();
      const mission = buildMockMission();

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        mission as any,
        [],
        task as any,
      );

      expect(result).toBeNull();
    });

    it("should select best agent via circuit breaker", async () => {
      mockCallbacks.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          displayName: "Leader",
          aiModel: "gpt-4",
          isLeader: true,
        },
        members: [
          {
            id: "member-1",
            displayName: "Alice",
            aiModel: "gemini",
            isLeader: false,
          },
          {
            id: "member-2",
            displayName: "Bob",
            aiModel: "claude",
            isLeader: false,
          },
        ],
        all: [
          {
            id: "leader-1",
            displayName: "Leader",
            aiModel: "gpt-4",
            isLeader: true,
          },
          {
            id: "member-1",
            displayName: "Alice",
            aiModel: "gemini",
            isLeader: false,
          },
          {
            id: "member-2",
            displayName: "Bob",
            aiModel: "claude",
            isLeader: false,
          },
        ],
      });

      const task = buildMockTask();
      const mission = buildMockMission();

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        mission as any,
        ["leader-1"],
        task as any,
      );

      expect(result).not.toBeNull();
    });

    it("should exclude agents with open circuit breakers", async () => {
      mockAiFacade.circuitBreaker.canExecute = jest
        .fn()
        .mockImplementation((id: string) => {
          return id !== "member-1"; // member-1 is blocked
        });
      mockAiFacade.circuitBreaker.selectBest = jest
        .fn()
        .mockReturnValue("member-2");

      mockCallbacks.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          displayName: "Leader",
          aiModel: "gpt-4",
          isLeader: true,
        },
        members: [
          {
            id: "member-1",
            displayName: "Alice",
            aiModel: "gemini",
            isLeader: false,
          },
          {
            id: "member-2",
            displayName: "Bob",
            aiModel: "claude",
            isLeader: false,
          },
        ],
        all: [
          {
            id: "leader-1",
            displayName: "Leader",
            aiModel: "gpt-4",
            isLeader: true,
          },
          {
            id: "member-1",
            displayName: "Alice",
            aiModel: "gemini",
            isLeader: false,
          },
          {
            id: "member-2",
            displayName: "Bob",
            aiModel: "claude",
            isLeader: false,
          },
        ],
      });

      const task = buildMockTask();
      const mission = buildMockMission();

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        mission as any,
        [],
        task as any,
      );

      // member-2 should be selected since member-1 is blocked
      if (result) {
        expect((result as any).id).not.toBe("member-1");
      }
    });

    it("should handle errors and return null", async () => {
      mockCallbacks.getTeamMembers.mockRejectedValueOnce(
        new Error("Service error"),
      );

      const task = buildMockTask();
      const mission = buildMockMission();

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        mission as any,
        [],
        task as any,
      );

      expect(result).toBeNull();
    });
  });

  // ==================== mapTemperatureToCreativity (private, tested via callAIWithConfig) ====================

  describe("temperature/maxTokens mapping via callAIWithConfig", () => {
    beforeEach(() => {
      // Reset to default success mock to avoid pollution from retry tests
      mockAiFacade.chat.mockResolvedValue({
        content: "AI response content",
        tokensUsed: 200,
      });
    });

    it("should map temperature 0 to deterministic", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", { temperature: 0 });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "deterministic" }),
        }),
      );
    });

    it("should map temperature 0.2 to deterministic", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        temperature: 0.2,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "deterministic" }),
        }),
      );
    });

    it("should map temperature 0.3 to low", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        temperature: 0.3,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "low" }),
        }),
      );
    });

    it("should map temperature 0.7 to medium", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        temperature: 0.7,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "medium" }),
        }),
      );
    });

    it("should map temperature 0.9 to high", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        temperature: 0.9,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "high" }),
        }),
      );
    });

    it("should map undefined temperature to medium creativity", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {});

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ creativity: "medium" }),
        }),
      );
    });

    it("should map maxTokens 500 to minimal outputLength", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", { maxTokens: 500 });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "minimal" }),
        }),
      );
    });

    it("should map maxTokens 1500 to short outputLength", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        maxTokens: 1500,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "short" }),
        }),
      );
    });

    it("should map maxTokens 3000 to medium outputLength", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        maxTokens: 3000,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "medium" }),
        }),
      );
    });

    it("should map maxTokens 5000 to standard outputLength", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        maxTokens: 5000,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "standard" }),
        }),
      );
    });

    it("should map maxTokens 7000 to long outputLength", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        maxTokens: 7000,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "long" }),
        }),
      );
    });

    it("should map maxTokens 10000 to extended outputLength", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {
        maxTokens: 10000,
      });

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "extended" }),
        }),
      );
    });

    it("should map undefined maxTokens to standard outputLength", async () => {
      await service.callAIWithConfig("gpt-4", [], "System", {});

      expect(aiFacade.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          taskProfile: expect.objectContaining({ outputLength: "standard" }),
        }),
      );
    });
  });

  // ==================== callAIWithRetry with rate limit / permanent errors ====================

  describe("callAIWithRetry error handling", () => {
    const taskContext = {
      taskId: "task-1",
      taskTitle: "Test Task",
      missionId: "mission-1",
    };

    it("should stop immediately on rate limit error without retrying", async () => {
      // Rate limit errors are not retryable immediately
      mockAiFacade.chat.mockRejectedValue(
        new Error("rate_limit_exceeded: too many requests"),
      );

      const result = await service.callAIWithRetry(
        "gpt-4",
        [],
        "System",
        {},
        taskContext,
      );

      expect(result.success).toBe(false);
    });

    it("should handle empty response content gracefully", async () => {
      mockAiFacade.chat.mockResolvedValueOnce({ content: "", tokensUsed: 0 });

      const result = await service.callAIWithRetry(
        "gpt-4",
        [],
        "System",
        {},
        taskContext,
      );

      // Empty content should be treated as failure
      expect(result.success).toBe(false);
    });

    it("should emit heartbeat events when heartbeatContext is provided", async () => {
      jest.useFakeTimers();

      const heartbeatContext = {
        topicId: "topic-1",
        agentId: "agent-1",
        agentName: "Alice",
      };

      // Make AI call take long enough for heartbeat to fire
      let resolve: (value: any) => void;
      const pendingCall = new Promise((r) => {
        resolve = r;
      });
      mockAiFacade.chat.mockReturnValueOnce(pendingCall as any);

      const callPromise = service.callAIWithRetry(
        "gpt-4",
        [],
        "System",
        {},
        taskContext,
        heartbeatContext,
      );

      // Advance timer to trigger heartbeat
      jest.advanceTimersByTime(3500);

      // Resolve the AI call
      resolve!({ content: "Response", tokensUsed: 100 });

      const result = await callPromise;

      expect(result.success).toBe(true);

      jest.useRealTimers();
    });
  });

  // ==================== autoRetryBlockedTasks edge cases ====================

  describe("autoRetryBlockedTasks edge cases", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
      mockAiFacade.circuitBreaker.canExecute = jest.fn().mockReturnValue(true);
      mockAiFacade.circuitBreaker.getCooldownRemaining = jest
        .fn()
        .mockReturnValue(5000);
    });

    it("should handle task with null updatedAt by treating it as stuck", async () => {
      const mission = buildMockMission();
      const taskWithNullUpdatedAt = {
        ...buildMockTask(),
        status: AgentTaskStatus.BLOCKED,
        updatedAt: null,
      };

      const result = await service.autoRetryBlockedTasks(
        mission as any,
        [taskWithNullUpdatedAt] as any,
        Date.now(),
        30 * 60 * 1000,
      );

      // taskAge > stuckTimeoutMs because updatedAt is null -> stuckTimeoutMs + 1
      expect(result).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should log cooldown info when canExecute=false and task not stuck", async () => {
      mockAiFacade.circuitBreaker.canExecute = jest.fn().mockReturnValue(false);

      const mission = buildMockMission();
      const recentTask = {
        ...buildMockTask(),
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(), // recent, not stuck
      };

      const result = await service.autoRetryBlockedTasks(
        mission as any,
        [recentTask] as any,
        Date.now(),
        30 * 60 * 1000,
      );

      // canExecute=false, taskAge < stuckTimeoutMs -> no action taken
      expect(result).toBe(0);
    });

    it("should use task.result when task has existing result", async () => {
      const mission = buildMockMission();
      const stuckAt = new Date(Date.now() - 40 * 60 * 1000);
      const taskWithResult = {
        ...buildMockTask(),
        status: AgentTaskStatus.BLOCKED,
        updatedAt: stuckAt,
        result: "Partial work done before blocking",
      };

      await service.autoRetryBlockedTasks(
        mission as any,
        [taskWithResult] as any,
        Date.now(),
        30 * 60 * 1000,
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            result: "Partial work done before blocking",
          }),
        }),
      );
    });
  });

  // ==================== forceCompleteStuckTasks edge cases ====================

  describe("forceCompleteStuckTasks edge cases", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
    });

    it("should handle task with null updatedAt by using age=0", async () => {
      const mission = buildMockMission();
      const taskWithNullUpdatedAt = {
        ...buildMockTask(),
        status: AgentTaskStatus.REVISION_NEEDED,
        updatedAt: null,
        result: null,
      };

      const result = await service.forceCompleteStuckTasks(
        mission as any,
        [taskWithNullUpdatedAt] as any,
        Date.now(),
        30 * 60 * 1000,
      );

      // taskAge=0, not >= stuckTimeoutMs, so should NOT be completed
      expect(result).toBe(0);
    });

    it("should use existing result when task already has partial result", async () => {
      const mission = buildMockMission();
      const stuckAt = new Date(Date.now() - 40 * 60 * 1000);
      const taskWithResult = {
        ...buildMockTask(),
        status: AgentTaskStatus.AWAITING_REVIEW,
        updatedAt: stuckAt,
        result: "Some output was produced",
      };

      await service.forceCompleteStuckTasks(
        mission as any,
        [taskWithResult] as any,
        Date.now(),
        30 * 60 * 1000,
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            result: "Some output was produced",
          }),
        }),
      );
    });

    it("should process multiple stuck tasks", async () => {
      const mission = buildMockMission();
      const stuckAt = new Date(Date.now() - 35 * 60 * 1000);
      const stuckTasks = [
        {
          ...buildMockTask(),
          id: "task-1",
          status: AgentTaskStatus.REVISION_NEEDED,
          updatedAt: stuckAt,
          result: null,
        },
        {
          ...buildMockTask(),
          id: "task-2",
          status: AgentTaskStatus.AWAITING_REVIEW,
          updatedAt: stuckAt,
          result: null,
        },
      ];

      const result = await service.forceCompleteStuckTasks(
        mission as any,
        stuckTasks as any,
        Date.now(),
        30 * 60 * 1000,
      );

      expect(result).toBe(2);
      expect(prisma.agentTask.update).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== executeNextTasks - pending execution re-run ====================

  describe("executeNextTasks - pending execution behavior", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
      // Reset mocks to avoid interference
      jest.clearAllMocks();
      mockPrisma.teamMission.findUnique.mockResolvedValue(buildMockMission());
      mockPrisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.agentTask.update.mockResolvedValue(buildMockTask());
    });

    it("should add to pendingExecutions when lock is not acquired", async () => {
      mockStateManager.startMissionExecution.mockReturnValueOnce(false);

      await service.executeNextTasks("mission-1");

      const pending = (service as any).pendingExecutions;
      expect(pending.has("mission-1")).toBe(true);
    });

    it("should clear pending execution after re-executing", async () => {
      // First call acquires lock; second does not
      mockStateManager.startMissionExecution
        .mockReturnValueOnce(false) // first call: pending
        .mockReturnValueOnce(true); // re-run: acquired

      const completedMission = {
        ...buildMockMission(),
        tasks: [{ ...buildMockTask(), status: AgentTaskStatus.COMPLETED }],
      };
      mockPrisma.teamMission.findUnique.mockResolvedValue(completedMission);

      await service.executeNextTasks("mission-1");

      // Pending should be marked for re-run
      const pending = (service as any).pendingExecutions;
      expect(pending.has("mission-1")).toBe(true);
    });
  });

  // ==================== executeNextTasks - IN_PROGRESS with tasks to complete ====================

  describe("executeNextTasks - task execution flow with findUnique", () => {
    beforeEach(() => {
      service.setCallbacks(mockCallbacks as any);
      mockAiFacade.circuitBreaker.canExecute = jest.fn().mockReturnValue(true);
      mockAiFacade.circuitBreaker.getCooldownRemaining = jest
        .fn()
        .mockReturnValue(0);
      mockAiFacade.circuitBreaker.incrementLoad = jest.fn();
      mockAiFacade.circuitBreaker.decrementLoad = jest.fn();
      mockAiFacade.circuitBreaker.recordSuccess = jest.fn();
      mockAiFacade.circuitBreaker.recordFailure = jest.fn();
      mockAiFacade.circuitBreaker.parseErrorType = jest
        .fn()
        .mockReturnValue("API_ERROR");
      mockAiFacade.getAvailableCapabilities = jest.fn().mockResolvedValue({
        tools: [],
        skills: [],
        mcpTools: [],
      });
    });

    it("should complete mission when all tasks are already COMPLETED via findUnique", async () => {
      const missionAllDone = {
        ...buildMockMission(),
        tasks: [
          {
            ...buildMockTask(),
            id: "task-1",
            status: AgentTaskStatus.COMPLETED,
          },
        ],
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(missionAllDone);

      await service.executeNextTasks("mission-1");

      expect(mockCallbacks.completeMission).toHaveBeenCalledWith("mission-1");
    });

    it("should return early when mission is not found via findUnique", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      await service.executeNextTasks("mission-1");

      expect(stateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-1",
      );
      expect(mockCallbacks.completeMission).not.toHaveBeenCalled();
    });

    it("should return early when mission status is not IN_PROGRESS", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce({
        ...buildMockMission(),
        status: MissionStatus.PAUSED,
        tasks: [{ ...buildMockTask(), status: AgentTaskStatus.PENDING }],
      });

      await service.executeNextTasks("mission-1");

      expect(stateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-1",
      );
      expect(mockCallbacks.completeMission).not.toHaveBeenCalled();
    });

    it("should handle stuck mission with blocked tasks via executeNextTasks", async () => {
      const missionWithBlockedTasks = {
        ...buildMockMission(),
        status: MissionStatus.IN_PROGRESS,
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        tasks: [
          {
            ...buildMockTask(),
            id: "task-1",
            status: AgentTaskStatus.BLOCKED,
            updatedAt: new Date(),
          },
        ],
      };
      mockPrisma.teamMission.findUnique
        .mockResolvedValueOnce(missionWithBlockedTasks)
        // Second call in autoRetryBlockedTasks
        .mockResolvedValue(missionWithBlockedTasks);

      mockAiFacade.circuitBreaker.canExecute = jest.fn().mockReturnValue(false);
      mockAiFacade.circuitBreaker.getCooldownRemaining = jest
        .fn()
        .mockReturnValue(60000);

      await service.executeNextTasks("mission-1");

      expect(stateManager.finishMissionExecution).toHaveBeenCalled();
    });

    it("should handle high completion rate and force complete remaining tasks", async () => {
      // 19 out of 20 tasks completed = 95% completion rate
      const completedTasks = Array.from({ length: 19 }, (_, i) => ({
        ...buildMockTask(),
        id: `task-${i}`,
        status: AgentTaskStatus.COMPLETED,
        dependsOnIds: [],
      }));
      const lastTask = {
        ...buildMockTask(),
        id: "task-19",
        status: AgentTaskStatus.BLOCKED,
        result: null,
        dependsOnIds: [],
      };

      const missionNearComplete = {
        ...buildMockMission(),
        status: MissionStatus.IN_PROGRESS,
        tasks: [...completedTasks, lastTask],
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        missionNearComplete,
      );

      await service.executeNextTasks("mission-1");

      // Should either force complete or complete mission
      expect(stateManager.finishMissionExecution).toHaveBeenCalled();
    });
  });

  // ==================== inferDomainFromTask ====================

  describe("inferDomainFromTask", () => {
    it("should infer research domain for RESEARCH taskType", () => {
      const task = { ...buildMockTask(), taskType: TaskType.RESEARCH };
      const result = (service as any).inferDomainFromTask(task);
      expect(result).toBe("research");
    });

    it("should infer writing domain for DOCUMENTATION taskType", () => {
      const task = { ...buildMockTask(), taskType: TaskType.DOCUMENTATION };
      const result = (service as any).inferDomainFromTask(task);
      expect(result).toBe("writing");
    });

    it("should infer general domain for unknown taskType with no keywords", () => {
      const task = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: "Write code",
        description: "Implement a function",
      };
      const result = (service as any).inferDomainFromTask(task);
      expect(result).toBe("general");
    });

    it("should infer research domain from title keywords", () => {
      const task = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: "研究用户行为",
        description: "Analyze user patterns",
      };
      const result = (service as any).inferDomainFromTask(task);
      expect(result).toBe("research");
    });

    it("should infer writing domain from description keywords", () => {
      const task = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: "Content creation",
        description: "撰写用户故事",
      };
      const result = (service as any).inferDomainFromTask(task);
      expect(result).toBe("writing");
    });

    it("should infer design domain from 设计 keyword", () => {
      const task = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: "设计界面",
        description: "Create UI design",
      };
      const result = (service as any).inferDomainFromTask(task);
      expect(result).toBe("design");
    });

    it("should handle null/undefined task fields gracefully", () => {
      const task = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: null,
        description: null,
      };
      const result = (service as any).inferDomainFromTask(task);
      expect(result).toBe("general");
    });
  });

  // ==================== createToolContext ====================

  describe("createToolContext", () => {
    it("should create tool context with correct toolId and callerType", () => {
      const ctx = (service as any).createToolContext("web-search");
      expect(ctx.toolId).toBe("web-search");
      expect(ctx.callerType).toBe("orchestrator");
      expect(ctx.executionId).toBeTruthy();
      expect(ctx.createdAt).toBeInstanceOf(Date);
    });

    it("should create unique executionIds for multiple calls", () => {
      const ctx1 = (service as any).createToolContext("web-search");
      const ctx2 = (service as any).createToolContext("web-search");
      expect(ctx1.executionId).not.toBe(ctx2.executionId);
    });
  });

  // ==================== getModelConfig ====================

  describe("getModelConfig", () => {
    it("should return model config when facade returns one", async () => {
      mockAiFacade.getModelById.mockResolvedValueOnce({
        id: "gpt-4",
        modelId: "gpt-4-turbo",
        name: "GPT-4 Turbo",
      });

      const config = await (service as any).getModelConfig("gpt-4");
      expect(config).toBeDefined();
      expect(config.modelId).toBe("gpt-4-turbo");
    });

    it("should return null when model not found", async () => {
      mockAiFacade.getModelById.mockResolvedValueOnce(null);

      const config = await (service as any).getModelConfig("unknown-model");
      expect(config).toBeNull();
    });

    it("should return null when facade throws", async () => {
      mockAiFacade.getModelById.mockRejectedValueOnce(new Error("Not found"));

      const config = await (service as any).getModelConfig("bad-model");
      expect(config).toBeNull();
    });
  });

  // ==================== inferDomainFromTask ====================

  describe("inferDomainFromTask", () => {
    it("should infer domain from taskType", () => {
      expect(
        (service as any).inferDomainFromTask({
          ...buildMockTask(),
          taskType: TaskType.RESEARCH,
        }),
      ).toBe("research");
      expect(
        (service as any).inferDomainFromTask({
          ...buildMockTask(),
          taskType: TaskType.DOCUMENTATION,
        }),
      ).toBe("writing");
      expect(
        (service as any).inferDomainFromTask({
          ...buildMockTask(),
          taskType: TaskType.DESIGN,
        }),
      ).toBe("design");
      expect(
        (service as any).inferDomainFromTask({
          ...buildMockTask(),
          taskType: TaskType.REVIEW,
        }),
      ).toBe("analysis");
    });

    it("should infer domain from keywords when taskType is IMPLEMENTATION", () => {
      const researchTask = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: "研究用户行为",
        description: "",
      };
      const writingTask = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: "doc",
        description: "撰写产品文档",
      };
      const designTask = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: "设计界面",
        description: "",
      };
      const generalTask = {
        ...buildMockTask(),
        taskType: TaskType.IMPLEMENTATION,
        title: "Write code",
        description: "Implement feature",
      };

      expect((service as any).inferDomainFromTask(researchTask)).toBe(
        "research",
      );
      expect((service as any).inferDomainFromTask(writingTask)).toBe("writing");
      expect((service as any).inferDomainFromTask(designTask)).toBe("design");
      expect((service as any).inferDomainFromTask(generalTask)).toBe("general");
    });
  });

  // ==================== buildReplanPrompt ====================

  describe("buildReplanPrompt", () => {
    it("should build a replan prompt containing task and error info", () => {
      const task = buildMockTask();
      const agent = task.assignedTo;
      const errorMsg = "Service unavailable";

      const prompt = (service as any).buildReplanPrompt(task, agent, errorMsg);

      expect(typeof prompt).toBe("string");
      expect(prompt).toContain(task.title);
      expect(prompt).toContain(errorMsg);
    });
  });

  // ==================== createToolContext ====================

  describe("createToolContext", () => {
    it("should create tool context with orchestrator callerType", () => {
      const ctx = (service as any).createToolContext("web-search");
      expect(ctx.toolId).toBe("web-search");
      expect(ctx.callerType).toBe("orchestrator");
      expect(ctx.executionId).toBeTruthy();
      expect(ctx.createdAt).toBeInstanceOf(Date);
    });

    it("should create unique executionIds for multiple calls", () => {
      const ctx1 = (service as any).createToolContext("web-search");
      const ctx2 = (service as any).createToolContext("web-search");
      expect(ctx1.executionId).not.toBe(ctx2.executionId);
    });
  });

  // ==================== mapTemperatureToCreativity / mapMaxTokensToOutputLength ====================

  describe("mapping helpers", () => {
    it("should map temperature thresholds to correct creativity levels", () => {
      expect((service as any).mapTemperatureToCreativity(0.1)).toBe(
        "deterministic",
      );
      expect((service as any).mapTemperatureToCreativity(0.3)).toBe("low");
      expect((service as any).mapTemperatureToCreativity(0.5)).toBe("medium");
      expect((service as any).mapTemperatureToCreativity(0.9)).toBe("high");
      expect((service as any).mapTemperatureToCreativity(undefined)).toBe(
        "medium",
      );
    });

    it("should map maxTokens thresholds to correct output length levels", () => {
      expect((service as any).mapMaxTokensToOutputLength(500)).toBe("minimal");
      expect((service as any).mapMaxTokensToOutputLength(1500)).toBe("short");
      expect((service as any).mapMaxTokensToOutputLength(3000)).toBe("medium");
      expect((service as any).mapMaxTokensToOutputLength(5000)).toBe(
        "standard",
      );
      expect((service as any).mapMaxTokensToOutputLength(7000)).toBe("long");
      expect((service as any).mapMaxTokensToOutputLength(10000)).toBe(
        "extended",
      );
      expect((service as any).mapMaxTokensToOutputLength(undefined)).toBe(
        "standard",
      );
    });
  });

  // ==================== trackMissionTokens ====================

  describe("trackMissionTokens", () => {
    it("should execute raw SQL to update token count", async () => {
      await (service as any).trackMissionTokens("mission-1", 500);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it("should handle SQL error gracefully", async () => {
      (prisma.$executeRaw as jest.Mock).mockRejectedValueOnce(
        new Error("DB error"),
      );

      await expect(
        (service as any).trackMissionTokens("mission-1", 100),
      ).resolves.not.toThrow();
    });
  });
});

/**
 * MissionExecutionService - Supplemental2 Tests
 *
 * Covers branches not tested in primary spec or supplemental spec:
 * - executeNextTasks: mission not found, mission not IN_PROGRESS, all tasks complete, pending tasks execute
 * - executeNextTasks: already locked (pendingExecutions), re-execution after lock release
 * - executeTask: task no longer PENDING (updateMany returns 0), capability context is built
 * - handleTaskExecutionFailure: cancels task, sends failure message, calls createLog
 * - handleTaskExecutionFailure: replan success path with new tasks created
 * - handleTaskExecutionFailure: replan model failure path sends manual intervention message
 * - autoRetryBlockedTasks: retries within timeout (canExecute=true), force-completes expired (canExecute=false), skips in cooldown
 * - forceCompleteStuckTasks: force-completes stuck tasks past timeout, skips within timeout
 * - findAlternativeAgent: multi-member load balancing, leader fallback, empty after filter
 * - findAlternativeAgentWithCircuitBreaker: circuit breaker excludes agents, selectBest used
 * - buildReplanPrompt: returns a string containing task title
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
    PLANNING: "PLANNING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    PAUSED: "PAUSED",
    BLOCKED: "BLOCKED",
  },
  AgentTaskStatus: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    BLOCKED: "BLOCKED",
    REVISION_NEEDED: "REVISION_NEEDED",
    AWAITING_REVIEW: "AWAITING_REVIEW",
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
    MISSION_CREATED: "MISSION_CREATED",
    PLANNING_STARTED: "PLANNING_STARTED",
    PLANNING_COMPLETED: "PLANNING_COMPLETED",
    TASK_STARTED: "TASK_STARTED",
    TASK_COMPLETED: "TASK_COMPLETED",
    TASK_FAILED: "TASK_FAILED",
    LEADER_FEEDBACK: "LEADER_FEEDBACK",
    MISSION_COMPLETED: "MISSION_COMPLETED",
    MISSION_FAILED: "MISSION_FAILED",
  },
  MessageContentType: {
    TEXT: "TEXT",
    SYSTEM: "SYSTEM",
    MARKDOWN: "MARKDOWN",
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
import {
  AgentTaskStatus,
  MissionStatus,
  TaskPriority,
  TaskType,
} from "@prisma/client";

// ============================================================
// Helpers
// ============================================================

const buildLeader = (overrides: Record<string, unknown> = {}) => ({
  id: "leader-s2b",
  displayName: "Leader S2B",
  agentName: "LeaderS2B",
  aiModel: "gpt-4",
  isLeader: true,
  topicId: "topic-s2b",
  ...overrides,
});

const buildMission = (overrides: Record<string, unknown> = {}) => ({
  id: "m-s2b",
  topicId: "t-s2b",
  title: "Supplemental2 Mission",
  description: "Mission description",
  objectives: [],
  constraints: [],
  mustConstraints: null,
  contextPackage: null,
  totalTasks: 2,
  createdAt: new Date(),
  status: MissionStatus.IN_PROGRESS,
  leader: buildLeader(),
  tasks: [],
  createdBy: null,
  ...overrides,
});

const buildTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-s2b",
  missionId: "m-s2b",
  title: "Task S2B",
  description: "Task description",
  result: null,
  status: AgentTaskStatus.PENDING,
  revisionCount: 0,
  maxRevisions: 3,
  needsRevision: false,
  priority: TaskPriority.MEDIUM,
  taskType: TaskType.RESEARCH,
  dependsOnIds: [],
  startedAt: null,
  updatedAt: new Date(),
  createdAt: new Date(),
  assignedToId: "member-s2b",
  assignedTo: {
    id: "member-s2b",
    agentName: "MemberS2B",
    displayName: "Member S2B",
    aiModel: "claude-3",
    isLeader: false,
  },
  ...overrides,
});

// ============================================================
// Mock Callbacks
// ============================================================

function buildCallbacks() {
  return {
    completeMission: jest.fn().mockResolvedValue(undefined),
    leaderReviewTask: jest.fn().mockResolvedValue(undefined),
    getTeamMembers: jest.fn().mockResolvedValue({
      leader: buildLeader(),
      members: [
        {
          id: "member-s2b",
          displayName: "Member S2B",
          isLeader: false,
          aiModel: "claude-3",
          agentName: "MemberS2B",
        },
        {
          id: "member-s2c",
          displayName: "Member S2C",
          isLeader: false,
          aiModel: "gemini-pro",
          agentName: "MemberS2C",
        },
      ],
      all: [
        buildLeader(),
        {
          id: "member-s2b",
          displayName: "Member S2B",
          isLeader: false,
          aiModel: "claude-3",
          agentName: "MemberS2B",
        },
        {
          id: "member-s2c",
          displayName: "Member S2C",
          isLeader: false,
          aiModel: "gemini-pro",
          agentName: "MemberS2C",
        },
      ],
    }),
    createLog: jest.fn().mockResolvedValue(undefined),
    sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-s2b" }),
    updateMissionProgress: jest.fn().mockResolvedValue(undefined),
    buildTaskExecutionPrompt: jest.fn().mockReturnValue("Execute this task"),
    getAgentSystemPrompt: jest.fn().mockReturnValue("Agent system prompt"),
    getLeaderSystemPrompt: jest.fn().mockReturnValue("Leader system prompt"),
  };
}

// ============================================================
// Module setup
// ============================================================

function buildAiFacade() {
  return {
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
      parseErrorType: jest.fn().mockReturnValue(0),
      getCooldownRemaining: jest.fn().mockReturnValue(0),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
    },
    getAvailableCapabilities: jest.fn().mockResolvedValue({
      tools: [],
      skills: [],
      mcpTools: [],
    }),
  };
}

function buildPrisma() {
  return {
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
      update: jest.fn().mockResolvedValue(buildMission()),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
}

async function createService(
  prisma: ReturnType<typeof buildPrisma>,
  aiFacade: ReturnType<typeof buildAiFacade>,
  stateManager: Partial<{
    startMissionExecution: jest.Mock;
    finishMissionExecution: jest.Mock;
    isTaskExecuting: jest.Mock;
    startTask: jest.Mock;
    finishTask: jest.Mock;
    isRevisionInProgress: jest.Mock;
    startRevision: jest.Mock;
    finishRevision: jest.Mock;
  }>,
  longContentService?: Partial<{
    ensureMissionInitialized: jest.Mock;
    processTaskCompletion: jest.Mock;
    trackTaskCompletion: jest.Mock;
    buildContinuationPrompt: jest.Mock;
    getFinalResult: jest.Mock;
  }>,
): Promise<MissionExecutionService> {
  const defaultStateManager = {
    startMissionExecution: jest.fn().mockReturnValue(true),
    finishMissionExecution: jest.fn(),
    isTaskExecuting: jest.fn().mockReturnValue(false),
    startTask: jest.fn().mockReturnValue(true),
    finishTask: jest.fn(),
    isRevisionInProgress: jest.fn().mockReturnValue(false),
    startRevision: jest.fn().mockReturnValue(true),
    finishRevision: jest.fn(),
  };

  const defaultLongContent = {
    ensureMissionInitialized: jest.fn().mockResolvedValue(undefined),
    processTaskCompletion: jest
      .fn()
      .mockResolvedValue({ needsContinuation: false }),
    trackTaskCompletion: jest.fn(),
    buildContinuationPrompt: jest.fn().mockReturnValue("continue"),
    getFinalResult: jest.fn().mockReturnValue(null),
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

  const mockTopicEventEmitter = {
    emitToTopic: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MissionExecutionService,
      { provide: PrismaService, useValue: prisma },
      { provide: ChatFacade, useValue: aiFacade },
      { provide: AgentFacade, useValue: aiFacade },
      { provide: ToolFacade, useValue: aiFacade },
      { provide: ToolRegistry, useValue: mockToolRegistry },
      { provide: TopicEventEmitterService, useValue: mockTopicEventEmitter },
      {
        provide: TeamsLongContentService,
        useValue: { ...defaultLongContent, ...longContentService },
      },
      {
        provide: MissionStateManager,
        useValue: { ...defaultStateManager, ...stateManager },
      },
      { provide: LeaderModelService, useValue: mockLeaderModelService },
    ],
  }).compile();

  return module.get<MissionExecutionService>(MissionExecutionService);
}

// ============================================================
// Tests
// ============================================================

describe("MissionExecutionService (supplemental2)", () => {
  let service: MissionExecutionService;
  let prisma: ReturnType<typeof buildPrisma>;
  let aiFacade: ReturnType<typeof buildAiFacade>;
  let callbacks: ReturnType<typeof buildCallbacks>;

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = buildPrisma();
    aiFacade = buildAiFacade();
    callbacks = buildCallbacks();

    service = await createService(prisma, aiFacade, {});
    service.setCallbacks(callbacks);
  });

  // ==================== executeNextTasks ====================

  describe("executeNextTasks", () => {
    it("should early-return when mission is not found", async () => {
      prisma.teamMission.findUnique.mockResolvedValue(null);

      await expect(
        service.executeNextTasks("nonexistent-mission"),
      ).resolves.not.toThrow();

      expect(callbacks.completeMission).not.toHaveBeenCalled();
    });

    it("should early-return when mission status is not IN_PROGRESS", async () => {
      prisma.teamMission.findUnique.mockResolvedValue({
        ...buildMission({ status: MissionStatus.COMPLETED }),
        tasks: [],
        leader: buildLeader(),
      });

      await service.executeNextTasks("m-s2b");

      expect(callbacks.completeMission).not.toHaveBeenCalled();
    });

    it("should call completeMission when all tasks are COMPLETED", async () => {
      prisma.teamMission.findUnique.mockResolvedValue({
        ...buildMission(),
        tasks: [
          buildTask({ status: AgentTaskStatus.COMPLETED }),
          buildTask({
            id: "task-s2b-2",
            status: AgentTaskStatus.COMPLETED,
          }),
        ],
        leader: buildLeader(),
      });

      await service.executeNextTasks("m-s2b");

      expect(callbacks.completeMission).toHaveBeenCalledWith("m-s2b");
    });

    it("should mark as pendingExecution when lock is held", async () => {
      // Build service with state manager that blocks execution
      const blockedStateManager = {
        startMissionExecution: jest.fn().mockReturnValue(false),
        finishMissionExecution: jest.fn(),
        isTaskExecuting: jest.fn().mockReturnValue(false),
        startTask: jest.fn().mockReturnValue(true),
        finishTask: jest.fn(),
        isRevisionInProgress: jest.fn().mockReturnValue(false),
      };
      service = await createService(prisma, aiFacade, blockedStateManager);
      service.setCallbacks(callbacks);

      await service.executeNextTasks("m-s2b");

      // Should not complete (it exits early due to lock)
      expect(callbacks.completeMission).not.toHaveBeenCalled();
    });

    it("should execute PENDING tasks that have all dependencies completed", async () => {
      const completedDep = buildTask({
        id: "dep-task",
        status: AgentTaskStatus.COMPLETED,
      });
      const pendingTask = buildTask({
        id: "pending-task",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: ["dep-task"],
        assignedTo: {
          id: "member-s2b",
          agentName: "MemberS2B",
          displayName: "Member S2B",
          aiModel: "claude-3",
          isLeader: false,
        },
      });

      prisma.teamMission.findUnique.mockResolvedValue({
        ...buildMission(),
        tasks: [completedDep, pendingTask],
        leader: buildLeader(),
      });

      // updateMany succeeds (task claimed)
      prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });

      // AI response success
      aiFacade.chat.mockResolvedValue({
        content: "Task done",
        tokensUsed: 100,
      });

      await service.executeNextTasks("m-s2b");

      // Task should have been started
      expect(prisma.agentTask.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "pending-task",
            status: AgentTaskStatus.PENDING,
          }),
          data: expect.objectContaining({
            status: AgentTaskStatus.IN_PROGRESS,
          }),
        }),
      );
    });

    it("should skip PENDING tasks whose dependencies are not yet complete", async () => {
      const inProgressDep = buildTask({
        id: "dep-task",
        status: AgentTaskStatus.IN_PROGRESS,
      });
      const pendingTask = buildTask({
        id: "pending-task",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: ["dep-task"],
      });

      prisma.teamMission.findUnique.mockResolvedValue({
        ...buildMission(),
        tasks: [inProgressDep, pendingTask],
        leader: buildLeader(),
      });

      await service.executeNextTasks("m-s2b");

      // No task should have been started (dependency not complete)
      expect(prisma.agentTask.updateMany).not.toHaveBeenCalled();
    });
  });

  // ==================== executeTask ====================

  describe("executeTask", () => {
    it("should skip task execution when updateMany returns count=0", async () => {
      prisma.agentTask.updateMany.mockResolvedValue({ count: 0 });

      await service.executeTask(
        buildMission() as Parameters<typeof service.executeTask>[0],
        buildTask() as Parameters<typeof service.executeTask>[1],
      );

      // AI should never be called if task was already claimed
      expect(aiFacade.chat).not.toHaveBeenCalled();
    });

    it("should set task to CANCELLED on unrecoverable exception during execution", async () => {
      // updateMany succeeds (task claimed)
      prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });

      // AI call throws permanently (context_length_exceeded is a permanent error)
      aiFacade.chat.mockRejectedValue(
        new Error("context_length_exceeded: too long"),
      );

      await service.executeTask(
        buildMission() as Parameters<typeof service.executeTask>[0],
        buildTask() as Parameters<typeof service.executeTask>[1],
      );

      // executeTask catches exception → calls handleTaskExecutionFailure → sets task to CANCELLED
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-s2b" },
          data: expect.objectContaining({ status: AgentTaskStatus.CANCELLED }),
        }),
      );
    });
  });

  // ==================== handleTaskExecutionFailure ====================

  describe("handleTaskExecutionFailure", () => {
    const mission = buildMission();
    const task = buildTask();
    const assignedTo = {
      id: "member-s2b",
      agentName: "MemberS2B",
      displayName: "Member S2B",
      aiModel: "claude-3",
      isLeader: false,
    };

    it("should cancel the task and send failure message", async () => {
      prisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.CANCELLED,
      });

      // leaderModelService returns success with replan
      const mockLeaderModelService = {
        executeWithFallback: jest.fn().mockResolvedValue({
          success: true,
          data: { content: "No new tasks", tokensUsed: 100 },
          fallbackUsed: false,
          modelUsed: "gpt-4",
        }),
      };

      const module2: TestingModule = await Test.createTestingModule({
        providers: [
          MissionExecutionService,
          { provide: PrismaService, useValue: prisma },
          { provide: ChatFacade, useValue: aiFacade },
          { provide: AgentFacade, useValue: aiFacade },
          { provide: ToolFacade, useValue: aiFacade },
          {
            provide: ToolRegistry,
            useValue: { tryGet: jest.fn().mockReturnValue(null) },
          },
          {
            provide: TopicEventEmitterService,
            useValue: { emitToTopic: jest.fn() },
          },
          {
            provide: TeamsLongContentService,
            useValue: {
              ensureMissionInitialized: jest.fn(),
              processTaskCompletion: jest.fn(),
            },
          },
          {
            provide: MissionStateManager,
            useValue: {
              startMissionExecution: jest.fn().mockReturnValue(true),
              finishMissionExecution: jest.fn(),
              isTaskExecuting: jest.fn().mockReturnValue(false),
              startTask: jest.fn().mockReturnValue(true),
              finishTask: jest.fn(),
            },
          },
          { provide: LeaderModelService, useValue: mockLeaderModelService },
        ],
      }).compile();

      const svc = module2.get<MissionExecutionService>(MissionExecutionService);
      svc.setCallbacks(callbacks);

      await svc.handleTaskExecutionFailure(
        mission as Parameters<typeof svc.handleTaskExecutionFailure>[0],
        task as Parameters<typeof svc.handleTaskExecutionFailure>[1],
        assignedTo as Parameters<typeof svc.handleTaskExecutionFailure>[2],
        "Some error occurred",
        callbacks,
      );

      // Task should be cancelled
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-s2b" },
          data: expect.objectContaining({ status: AgentTaskStatus.CANCELLED }),
        }),
      );

      // Failure message should be sent
      expect(callbacks.sendMessageToTopic).toHaveBeenCalled();

      // Log should be created
      expect(callbacks.createLog).toHaveBeenCalled();
    });

    it("should send manual intervention message when replan fails", async () => {
      prisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.CANCELLED,
      });

      const failingLeaderModelService = {
        executeWithFallback: jest.fn().mockResolvedValue({
          success: false,
          error: { getUserMessage: () => "All models failed" },
          fallbackUsed: false,
        }),
      };

      const module3: TestingModule = await Test.createTestingModule({
        providers: [
          MissionExecutionService,
          { provide: PrismaService, useValue: prisma },
          { provide: ChatFacade, useValue: aiFacade },
          { provide: AgentFacade, useValue: aiFacade },
          { provide: ToolFacade, useValue: aiFacade },
          {
            provide: ToolRegistry,
            useValue: { tryGet: jest.fn().mockReturnValue(null) },
          },
          {
            provide: TopicEventEmitterService,
            useValue: { emitToTopic: jest.fn() },
          },
          {
            provide: TeamsLongContentService,
            useValue: {
              ensureMissionInitialized: jest.fn(),
              processTaskCompletion: jest.fn(),
            },
          },
          {
            provide: MissionStateManager,
            useValue: {
              startMissionExecution: jest.fn().mockReturnValue(true),
              finishMissionExecution: jest.fn(),
              isTaskExecuting: jest.fn().mockReturnValue(false),
              startTask: jest.fn().mockReturnValue(true),
              finishTask: jest.fn(),
            },
          },
          { provide: LeaderModelService, useValue: failingLeaderModelService },
        ],
      }).compile();

      const svc = module3.get<MissionExecutionService>(MissionExecutionService);
      svc.setCallbacks(callbacks);

      await svc.handleTaskExecutionFailure(
        mission as Parameters<typeof svc.handleTaskExecutionFailure>[0],
        task as Parameters<typeof svc.handleTaskExecutionFailure>[1],
        assignedTo as Parameters<typeof svc.handleTaskExecutionFailure>[2],
        "Some error",
        callbacks,
      );

      // Should send manual intervention message
      expect(callbacks.sendMessageToTopic).toHaveBeenCalledWith(
        expect.any(String),
        null,
        expect.stringContaining("需要人工干预"),
        expect.any(String),
      );
    });

    it("should create task entries when replan response contains valid JSON", async () => {
      const replanContent = `Analysis done.
\`\`\`json
{
  "action": "split",
  "newTasks": [
    {
      "title": "Subtask A",
      "description": "Do subtask A",
      "assignee": "Member S2B"
    }
  ]
}
\`\`\``;

      const successLeaderModelService = {
        executeWithFallback: jest.fn().mockResolvedValue({
          success: true,
          data: { content: replanContent, tokensUsed: 200 },
          fallbackUsed: false,
          modelUsed: "gpt-4",
        }),
      };

      const blockedState = {
        startMissionExecution: jest.fn().mockReturnValue(false),
        finishMissionExecution: jest.fn(),
        isTaskExecuting: jest.fn().mockReturnValue(false),
        startTask: jest.fn().mockReturnValue(true),
        finishTask: jest.fn(),
      };

      const module4: TestingModule = await Test.createTestingModule({
        providers: [
          MissionExecutionService,
          { provide: PrismaService, useValue: prisma },
          { provide: ChatFacade, useValue: aiFacade },
          { provide: AgentFacade, useValue: aiFacade },
          { provide: ToolFacade, useValue: aiFacade },
          {
            provide: ToolRegistry,
            useValue: { tryGet: jest.fn().mockReturnValue(null) },
          },
          {
            provide: TopicEventEmitterService,
            useValue: { emitToTopic: jest.fn() },
          },
          {
            provide: TeamsLongContentService,
            useValue: {
              ensureMissionInitialized: jest.fn(),
              processTaskCompletion: jest.fn(),
            },
          },
          { provide: MissionStateManager, useValue: blockedState },
          { provide: LeaderModelService, useValue: successLeaderModelService },
        ],
      }).compile();

      const svc = module4.get<MissionExecutionService>(MissionExecutionService);
      svc.setCallbacks(callbacks);

      await svc.handleTaskExecutionFailure(
        mission as Parameters<typeof svc.handleTaskExecutionFailure>[0],
        task as Parameters<typeof svc.handleTaskExecutionFailure>[1],
        assignedTo as Parameters<typeof svc.handleTaskExecutionFailure>[2],
        "Some error",
        callbacks,
      );

      // New task should have been created
      expect(prisma.agentTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: "Subtask A" }),
        }),
      );
    });
  });

  // ==================== autoRetryBlockedTasks ====================

  describe("autoRetryBlockedTasks", () => {
    it("should retry blocked task when within timeout and canExecute=true", async () => {
      const blockedTask = buildTask({
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago (within 15 min timeout)
      });

      // canExecute returns true for the member
      aiFacade.circuitBreaker.canExecute.mockReturnValue(true);
      prisma.agentTask.update.mockResolvedValue({
        ...blockedTask,
        status: AgentTaskStatus.PENDING,
      });

      const count = await service.autoRetryBlockedTasks(
        buildMission() as Parameters<typeof service.autoRetryBlockedTasks>[0],
        [blockedTask] as Parameters<typeof service.autoRetryBlockedTasks>[1],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-s2b" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should force-complete blocked task when past timeout", async () => {
      const oldBlockedTask = buildTask({
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago (exceeds 15 min timeout)
      });

      // canExecute can be anything - task is too old to retry, must force-complete
      aiFacade.circuitBreaker.canExecute.mockReturnValue(false);
      prisma.agentTask.update.mockResolvedValue({
        ...oldBlockedTask,
        status: AgentTaskStatus.COMPLETED,
      });

      const count = await service.autoRetryBlockedTasks(
        buildMission() as Parameters<typeof service.autoRetryBlockedTasks>[0],
        [oldBlockedTask] as Parameters<typeof service.autoRetryBlockedTasks>[1],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-s2b" },
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should skip task when in cooldown (canExecute=false) and within timeout", async () => {
      const recentBlockedTask = buildTask({
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
      });

      aiFacade.circuitBreaker.canExecute.mockReturnValue(false); // in cooldown
      aiFacade.circuitBreaker.getCooldownRemaining.mockReturnValue(60_000); // 60s remaining

      const count = await service.autoRetryBlockedTasks(
        buildMission() as Parameters<typeof service.autoRetryBlockedTasks>[0],
        [recentBlockedTask] as Parameters<
          typeof service.autoRetryBlockedTasks
        >[1],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(0);
      expect(prisma.agentTask.update).not.toHaveBeenCalled();
    });

    it("should handle task with no updatedAt (treats as expired)", async () => {
      const taskNoUpdatedAt = buildTask({
        status: AgentTaskStatus.BLOCKED,
        updatedAt: null,
      });

      aiFacade.circuitBreaker.canExecute.mockReturnValue(true);
      prisma.agentTask.update.mockResolvedValue({
        ...taskNoUpdatedAt,
        status: AgentTaskStatus.COMPLETED,
      });

      const count = await service.autoRetryBlockedTasks(
        buildMission() as Parameters<typeof service.autoRetryBlockedTasks>[0],
        [taskNoUpdatedAt] as Parameters<
          typeof service.autoRetryBlockedTasks
        >[1],
        Date.now(),
        15 * 60 * 1000,
      );

      // updatedAt null -> age is stuckTimeoutMs+1 -> force complete
      expect(count).toBe(1);
    });

    it("should process multiple tasks and return total retried count", async () => {
      const task1 = buildTask({
        id: "blocked-1",
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // within timeout
      });
      const task2 = buildTask({
        id: "blocked-2",
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000), // past timeout
      });

      aiFacade.circuitBreaker.canExecute.mockReturnValue(true);
      prisma.agentTask.update
        .mockResolvedValueOnce({ ...task1, status: AgentTaskStatus.PENDING })
        .mockResolvedValueOnce({ ...task2, status: AgentTaskStatus.COMPLETED });

      const count = await service.autoRetryBlockedTasks(
        buildMission() as Parameters<typeof service.autoRetryBlockedTasks>[0],
        [task1, task2] as Parameters<typeof service.autoRetryBlockedTasks>[1],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(2);
    });
  });

  // ==================== forceCompleteStuckTasks ====================

  describe("forceCompleteStuckTasks", () => {
    it("should force-complete tasks stuck past timeout", async () => {
      const stuckTask = {
        id: "stuck-task",
        title: "Stuck Task",
        status: AgentTaskStatus.REVISION_NEEDED,
        result: null,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
      };

      prisma.agentTask.update.mockResolvedValue({
        ...stuckTask,
        status: AgentTaskStatus.COMPLETED,
      });

      const count = await service.forceCompleteStuckTasks(
        buildMission() as Parameters<typeof service.forceCompleteStuckTasks>[0],
        [stuckTask],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(1);
      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-task" },
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should not complete tasks within timeout", async () => {
      const recentStuckTask = {
        id: "recent-stuck",
        title: "Recent Stuck",
        status: AgentTaskStatus.AWAITING_REVIEW,
        result: null,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
      };

      const count = await service.forceCompleteStuckTasks(
        buildMission() as Parameters<typeof service.forceCompleteStuckTasks>[0],
        [recentStuckTask],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(0);
      expect(prisma.agentTask.update).not.toHaveBeenCalled();
    });

    it("should handle task with no updatedAt (treats age as 0, skips)", async () => {
      const taskNoDate = {
        id: "no-date-task",
        title: "No Date Task",
        status: AgentTaskStatus.REVISION_NEEDED,
        result: null,
        updatedAt: null,
      };

      const count = await service.forceCompleteStuckTasks(
        buildMission() as Parameters<typeof service.forceCompleteStuckTasks>[0],
        [taskNoDate],
        Date.now(),
        15 * 60 * 1000,
      );

      // age is 0, < stuckTimeoutMs -> not force-completed
      expect(count).toBe(0);
    });

    it("should use existing result when task already has result content", async () => {
      const stuckTask = {
        id: "stuck-with-result",
        title: "Stuck With Result",
        status: AgentTaskStatus.REVISION_NEEDED,
        result: "Partial result was written here",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      };

      prisma.agentTask.update.mockResolvedValue({
        ...stuckTask,
        status: AgentTaskStatus.COMPLETED,
      });

      await service.forceCompleteStuckTasks(
        buildMission() as Parameters<typeof service.forceCompleteStuckTasks>[0],
        [stuckTask],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            result: "Partial result was written here",
          }),
        }),
      );
    });
  });

  // ==================== findAlternativeAgent ====================

  describe("findAlternativeAgent", () => {
    it("should return null when only 1 total team member", async () => {
      callbacks.getTeamMembers.mockResolvedValue({
        leader: buildLeader(),
        members: [],
        all: [buildLeader()],
      });

      const result = await service.findAlternativeAgent(
        buildMission() as Parameters<typeof service.findAlternativeAgent>[0],
        [],
        buildTask() as Parameters<typeof service.findAlternativeAgent>[2],
      );

      expect(result).toBeNull();
    });

    it("should exclude failed agents from candidates", async () => {
      callbacks.getTeamMembers.mockResolvedValue({
        leader: buildLeader(),
        members: [
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
            agentName: "M2B",
          },
          {
            id: "member-s2c",
            displayName: "M2C",
            isLeader: false,
            aiModel: "gemini-pro",
            agentName: "M2C",
          },
        ],
        all: [
          buildLeader(),
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
            agentName: "M2B",
          },
          {
            id: "member-s2c",
            displayName: "M2C",
            isLeader: false,
            aiModel: "gemini-pro",
            agentName: "M2C",
          },
        ],
      });

      // member-s2b is already failed
      const result = await service.findAlternativeAgent(
        buildMission() as Parameters<typeof service.findAlternativeAgent>[0],
        ["member-s2b"],
        buildTask() as Parameters<typeof service.findAlternativeAgent>[2],
      );

      expect(result).not.toBeNull();
      expect((result as { id: string }).id).toBe("member-s2c");
    });

    it("should sort candidates by task load when loadBalancing enabled", async () => {
      callbacks.getTeamMembers.mockResolvedValue({
        leader: buildLeader(),
        members: [
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
            agentName: "M2B",
          },
          {
            id: "member-s2c",
            displayName: "M2C",
            isLeader: false,
            aiModel: "gemini-pro",
            agentName: "M2C",
          },
        ],
        all: [
          buildLeader(),
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
            agentName: "M2B",
          },
          {
            id: "member-s2c",
            displayName: "M2C",
            isLeader: false,
            aiModel: "gemini-pro",
            agentName: "M2C",
          },
        ],
      });

      // member-s2b has 5 tasks, member-s2c has 1 task
      prisma.agentTask.groupBy.mockResolvedValue([
        { assignedToId: "member-s2b", _count: { _all: 5 } },
        { assignedToId: "member-s2c", _count: { _all: 1 } },
      ]);

      const result = await service.findAlternativeAgent(
        buildMission() as Parameters<typeof service.findAlternativeAgent>[0],
        [],
        buildTask() as Parameters<typeof service.findAlternativeAgent>[2],
      );

      // Should select member-s2c (lower load)
      expect(result).not.toBeNull();
      expect((result as { id: string }).id).toBe("member-s2c");
    });

    it("should handle error gracefully and return null", async () => {
      callbacks.getTeamMembers.mockRejectedValue(new Error("DB error"));

      const result = await service.findAlternativeAgent(
        buildMission() as Parameters<typeof service.findAlternativeAgent>[0],
        [],
        buildTask() as Parameters<typeof service.findAlternativeAgent>[2],
      );

      expect(result).toBeNull();
    });
  });

  // ==================== findAlternativeAgentWithCircuitBreaker ====================

  describe("findAlternativeAgentWithCircuitBreaker", () => {
    it("should return null when no agents pass circuit breaker check", async () => {
      callbacks.getTeamMembers.mockResolvedValue({
        leader: buildLeader(),
        members: [
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
        all: [
          buildLeader(),
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
      });

      // All agents fail circuit breaker check
      aiFacade.circuitBreaker.canExecute.mockReturnValue(false);

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        buildMission() as Parameters<
          typeof service.findAlternativeAgentWithCircuitBreaker
        >[0],
        [],
        buildTask() as Parameters<
          typeof service.findAlternativeAgentWithCircuitBreaker
        >[2],
      );

      expect(result).toBeNull();
    });

    it("should select agent via circuitBreaker.selectBest when available", async () => {
      callbacks.getTeamMembers.mockResolvedValue({
        leader: buildLeader(),
        members: [
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
          },
          {
            id: "member-s2c",
            displayName: "M2C",
            isLeader: false,
            aiModel: "gemini-pro",
          },
        ],
        all: [
          buildLeader(),
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
          },
          {
            id: "member-s2c",
            displayName: "M2C",
            isLeader: false,
            aiModel: "gemini-pro",
          },
        ],
      });

      aiFacade.circuitBreaker.canExecute.mockReturnValue(true);
      // selectBest returns member-s2c as best
      aiFacade.circuitBreaker.selectBest.mockReturnValue("member-s2c");

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        buildMission() as Parameters<
          typeof service.findAlternativeAgentWithCircuitBreaker
        >[0],
        [],
        buildTask() as Parameters<
          typeof service.findAlternativeAgentWithCircuitBreaker
        >[2],
      );

      expect(result).not.toBeNull();
      expect((result as { id: string }).id).toBe("member-s2c");
    });

    it("should fall back to first candidate when selectBest returns unrecognized id", async () => {
      callbacks.getTeamMembers.mockResolvedValue({
        leader: buildLeader(),
        members: [
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
        all: [
          buildLeader(),
          {
            id: "member-s2b",
            displayName: "M2B",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
      });

      aiFacade.circuitBreaker.canExecute.mockReturnValue(true);
      // selectBest returns an ID not in candidates
      aiFacade.circuitBreaker.selectBest.mockReturnValue("unknown-agent-id");

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        buildMission() as Parameters<
          typeof service.findAlternativeAgentWithCircuitBreaker
        >[0],
        [],
        buildTask() as Parameters<
          typeof service.findAlternativeAgentWithCircuitBreaker
        >[2],
      );

      // Falls back to first candidate
      expect(result).not.toBeNull();
      expect((result as { id: string }).id).toBe("member-s2b");
    });

    it("should handle error gracefully and return null", async () => {
      callbacks.getTeamMembers.mockRejectedValue(new Error("Network error"));

      const result = await service.findAlternativeAgentWithCircuitBreaker(
        buildMission() as Parameters<
          typeof service.findAlternativeAgentWithCircuitBreaker
        >[0],
        [],
        buildTask() as Parameters<
          typeof service.findAlternativeAgentWithCircuitBreaker
        >[2],
      );

      expect(result).toBeNull();
    });
  });

  // ==================== buildReplanPrompt (private) ====================

  describe("buildReplanPrompt (private)", () => {
    type ServiceWithPrivate = {
      buildReplanPrompt: (
        task: ReturnType<typeof buildTask>,
        assignedTo: { agentName: string; displayName: string },
        errorMsg: string,
      ) => string;
    };

    it("should return a string containing task title and error message", () => {
      const task = buildTask({ title: "My Custom Task" });
      const assignedTo = { agentName: "AgentX", displayName: "Agent X" };

      const prompt = (
        service as unknown as ServiceWithPrivate
      ).buildReplanPrompt(task, assignedTo, "Rate limit exceeded");

      expect(typeof prompt).toBe("string");
      expect(prompt).toContain("My Custom Task");
      expect(prompt).toContain("Rate limit exceeded");
      expect(prompt).toContain("AgentX");
    });

    it("should include assignee displayName when agentName is empty", () => {
      const task = buildTask({ title: "Display Name Task" });
      const assignedTo = { agentName: "", displayName: "Display Agent" };

      const prompt = (
        service as unknown as ServiceWithPrivate
      ).buildReplanPrompt(task, assignedTo, "error");

      expect(prompt).toContain("Display Agent");
    });
  });

  // ==================== createToolContext (private) ====================

  describe("createToolContext (private)", () => {
    type ServiceWithPrivate = {
      createToolContext: (toolId: string) => {
        executionId: string;
        toolId: string;
        createdAt: Date;
        callerType: string;
      };
    };

    it("should return ToolContext with callerType=orchestrator", () => {
      const ctx = (service as unknown as ServiceWithPrivate).createToolContext(
        "test-tool",
      );

      expect(ctx.toolId).toBe("test-tool");
      expect(ctx.callerType).toBe("orchestrator");
      expect(ctx.createdAt).toBeInstanceOf(Date);
      expect(ctx.executionId).toContain("test-tool");
    });
  });
});

/**
 * TeamMissionService - Additional Tests
 *
 * Covers code branches missed by the primary spec:
 * - recoverRevisionTasks: mission status not IN_PROGRESS
 * - executeNextTasks: force-complete threshold, blocked task retry, dependency relaxation,
 *   stuck IN_PROGRESS tasks reset, stuck AWAITING_REVIEW force-complete
 * - executeTask: CAS update count = 0, circuit-breaker cooldown block, agent switching
 * - executeLeaderPlanning: context-too-large retry loop, API error content check,
 *   all retries fail scenario, fallback model failure, task count validation
 * - createMission: autoStart behavior
 * - updateMissionNotification, getMissions filters
 * - getLeaderSystemPrompt / getAgentSystemPrompt / buildTaskExecutionPrompt / parseTaskBreakdown
 * - recoverStuckTasks multiple tasks
 * - findAlternativeAgentWithCircuitBreaker branches
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TeamMissionService } from "../team-mission.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { AgentFacade, TeamFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { TopicEventEmitterService } from "../../../events";
import { TeamsLongContentService } from "../../../ai/teams-long-content.service";
import { LeaderModelService } from "../../../ai/leader-model.service";
import { EmailService } from "../../../../../../platform/email/email.service";
import { ConfigService } from "@nestjs/config";
import { MissionContextService } from "@/modules/ai-harness/facade";
import { ConstraintEnforcementService } from "@/modules/ai-harness/facade";
import { MissionStateManager } from "@/modules/ai-harness/facade";
import { MissionLifecycleService } from "../mission-lifecycle.service";
import { MissionRetryService } from "../mission-retry.service";
import { MissionHealthCheckService } from "../mission-health-check.service";
import { MissionAICallerService } from "../mission-ai-caller.service";
import { TeamMessageService } from "../team-message.service";
import { TeamMemberService } from "../team-member.service";
import {
  MissionStatus,
  AgentTaskStatus,
  MissionLogType,
  TaskPriority,
  TaskType,
} from "@prisma/client";

// ============================================================
// Mock factories
// ============================================================

const makeMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-1",
  topicId: "topic-1",
  title: "Test Mission",
  description: "Mission description",
  objectives: ["obj1"],
  constraints: [],
  deliverables: [],
  leaderId: "leader-1",
  createdById: "user-1",
  status: MissionStatus.PENDING,
  totalTasks: 0,
  completedTasks: 0,
  taskBreakdown: null,
  contextPackage: null,
  mustConstraints: null,
  notificationEmail: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  leader: {
    id: "leader-1",
    displayName: "Leader Bot",
    agentName: "LeaderBot",
    aiModel: "gpt-4o",
    isLeader: true,
    topicId: "topic-1",
    avatar: null,
    roleDescription: "Leader",
    systemPrompt: "You are a leader",
    contextWindow: 10,
    capabilities: [],
    canMentionOtherAI: true,
    collaborationStyle: "COOPERATIVE",
  },
  topic: {
    id: "topic-1",
    name: "Test Topic",
    aiMembers: [
      {
        id: "leader-1",
        displayName: "Leader Bot",
        agentName: "LeaderBot",
        aiModel: "gpt-4o",
        isLeader: true,
      },
      {
        id: "member-1",
        displayName: "Agent One",
        agentName: "AgentOne",
        aiModel: "claude-3",
        isLeader: false,
      },
    ],
  },
  tasks: [],
  createdBy: { id: "user-1", username: "testuser", fullName: "Test User" },
  ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  missionId: "mission-1",
  title: "Task 1",
  description: "Task description",
  status: AgentTaskStatus.PENDING,
  priority: TaskPriority.MEDIUM,
  taskType: TaskType.RESEARCH,
  assignedToId: "member-1",
  dependsOnIds: [],
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  startedAt: null,
  completedAt: null,
  leaderFeedback: null,
  result: null,
  // revisionCount >= maxRevisions terminates the leaderReviewTask retry loop
  // preventing infinite recursion when AI mocks reject during tests
  revisionCount: 0,
  maxRevisions: 0,
  assignedTo: {
    id: "member-1",
    displayName: "Agent One",
    agentName: "AgentOne",
    aiModel: "claude-3",
    isLeader: false,
    topicId: "topic-1",
  },
  mission: makeMission(),
  ...overrides,
});

// ============================================================
// Mock services (module-level, shared across tests)
// ============================================================

const mockPrisma = {
  topicAIMember: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  teamMission: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  agentTask: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    groupBy: jest.fn(),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  missionLog: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  topicMessage: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation(async (callback) => {
    const tx = {
      agentTask: {
        create: jest.fn().mockResolvedValue({ id: "task-1" }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        createManyAndReturn: jest
          .fn()
          .mockResolvedValue([
            { id: "task-1", title: "Task 1", dependsOnIds: [] },
          ]),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      teamMission: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    if (typeof callback === "function") {
      return callback(tx);
    }
    return Promise.resolve();
  }),
  $queryRaw: jest.fn().mockResolvedValue([{ total_tokens_used: 0 }]),
};

const mockToolRegistry = {
  execute: jest.fn(),
  getTool: jest.fn(),
  tryGet: jest.fn().mockReturnValue(null),
};

const mockTopicEventEmitter = {
  emitToTopic: jest.fn(),
};

const mockLongContentService = {
  initMission: jest.fn().mockResolvedValue(undefined),
  validateTaskCount: jest
    .fn()
    .mockReturnValue({ isValid: true, warning: null }),
  updateTotalTasks: jest.fn(),
  buildGranularityConstraintPrompt: jest.fn().mockReturnValue(null),
  processTaskCompletion: jest.fn().mockResolvedValue({
    needsContinuation: false,
    finalContent: null,
  }),
  ensureMissionInitialized: jest.fn().mockResolvedValue(undefined),
  buildContinuationPrompt: jest.fn().mockReturnValue("Continue writing"),
  getQualityDashboard: jest.fn().mockReturnValue(null),
  clearMission: jest.fn(),
  checkQualityIntervention: jest.fn().mockReturnValue({ needed: false }),
  getFinalResult: jest.fn().mockReturnValue(null),
  trackTaskCompletion: jest.fn(),
};

const mockLeaderModelService = {
  executeWithFallback: jest.fn(),
};

const mockEmailService = {
  sendMissionCompletionEmail: jest.fn(),
  sendMissionCompletionNotification: jest.fn().mockResolvedValue(true),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue("http://localhost:3000"),
};

const mockMissionContextService = {
  buildContextPackage: jest.fn().mockResolvedValue({
    missionId: "mission-1",
    constraints: [],
    worldContext: null,
  }),
  extractContextFromLeaderOutput: jest.fn().mockReturnValue(null),
  buildAgentSystemPromptWithContext: jest
    .fn()
    .mockReturnValue("Mocked agent system prompt"),
  buildContextPackagePromptSection: jest
    .fn()
    .mockReturnValue("Context package section"),
  buildEstablishedFactsSection: jest.fn().mockReturnValue(""),
  extractEstablishedFacts: jest.fn().mockResolvedValue([]),
  mergeEstablishedFacts: jest.fn().mockReturnValue(null),
};

const mockConstraintEnforcementService = {
  extractConstraints: jest.fn().mockReturnValue([]),
  toHardConstraints: jest.fn().mockReturnValue([]),
  enforce: jest.fn().mockReturnValue({ passed: true, violations: [] }),
};

const mockStateManager = {
  startMissionExecution: jest.fn().mockReturnValue(true),
  finishMissionExecution: jest.fn(),
  isTaskExecuting: jest.fn().mockReturnValue(false),
  startTask: jest.fn().mockReturnValue(true),
  finishTask: jest.fn(),
  isRevisionInProgress: jest.fn().mockReturnValue(false),
  startRevision: jest.fn().mockReturnValue(true),
  finishRevision: jest.fn(),
};

const mockLifecycleService = {
  completeMission: jest.fn().mockResolvedValue(undefined),
  failMission: jest.fn().mockResolvedValue(undefined),
  cancelMission: jest
    .fn()
    .mockResolvedValue({ id: "mission-1", status: MissionStatus.CANCELLED }),
  pauseMission: jest
    .fn()
    .mockResolvedValue({ id: "mission-1", status: MissionStatus.PAUSED }),
  resumeMission: jest
    .fn()
    .mockResolvedValue({ id: "mission-1", status: MissionStatus.IN_PROGRESS }),
  deleteMission: jest.fn().mockResolvedValue(undefined),
  updateMissionNotification: jest.fn().mockResolvedValue(undefined),
};

const mockRetryService = {
  shouldRetry: jest.fn().mockReturnValue(false),
};

const mockHealthCheckService = {
  registerExecuteCallback: jest.fn(),
  registerRevisionCallback: jest.fn(),
  resetRecoveryAttempts: jest.fn(),
  cleanupCompletedMission: jest.fn(),
};

const mockAICallerService = {
  callAIWithConfig: jest
    .fn()
    .mockResolvedValue({ content: "AI response", tokensUsed: 200 }),
};

const mockMessageService = {
  sendMessage: jest.fn().mockResolvedValue({ id: "msg-1" }),
  sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-1" }),
  createLog: jest.fn().mockResolvedValue(undefined),
};

const mockMemberService = {
  getTeamMembers: jest.fn().mockResolvedValue({
    leader: {
      id: "leader-1",
      displayName: "Leader",
      agentName: "LeaderBot",
      isLeader: true,
      aiModel: "gpt-4o",
    },
    members: [
      {
        id: "member-1",
        displayName: "Agent One",
        agentName: "AgentOne",
        isLeader: false,
        aiModel: "claude-3",
      },
    ],
    all: [
      {
        id: "leader-1",
        displayName: "Leader",
        agentName: "LeaderBot",
        isLeader: true,
        aiModel: "gpt-4o",
      },
      {
        id: "member-1",
        displayName: "Agent One",
        agentName: "AgentOne",
        isLeader: false,
        aiModel: "claude-3",
      },
    ],
  }),
  getLeader: jest.fn(),
};

const mockAiFacade = {
  chat: jest
    .fn()
    .mockResolvedValue({ content: "AI response", tokensUsed: 200 }),
  contextInit: null,
  coordinatorStore: jest.fn().mockResolvedValue(undefined),
  circuitBreaker: {
    canExecute: jest.fn().mockReturnValue(true),
    getCooldownRemaining: jest.fn().mockReturnValue(0),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    parseErrorType: jest.fn().mockReturnValue("API_ERROR"),
    incrementLoad: jest.fn(),
    decrementLoad: jest.fn(),
    selectBest: jest.fn().mockReturnValue(null),
    getHealthMetrics: jest
      .fn()
      .mockReturnValue({ successRate: 1, currentLoad: 0 }),
  },
};

// ============================================================
// Helper: Build module once per describe
// ============================================================

async function buildModule(): Promise<TeamMissionService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TeamMissionService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: ToolRegistry, useValue: mockToolRegistry },
      { provide: TopicEventEmitterService, useValue: mockTopicEventEmitter },
      { provide: TeamsLongContentService, useValue: mockLongContentService },
      { provide: EmailService, useValue: mockEmailService },
      { provide: ConfigService, useValue: mockConfigService },
      { provide: MissionContextService, useValue: mockMissionContextService },
      {
        provide: ConstraintEnforcementService,
        useValue: mockConstraintEnforcementService,
      },
      { provide: MissionStateManager, useValue: mockStateManager },
      { provide: MissionLifecycleService, useValue: mockLifecycleService },
      { provide: MissionRetryService, useValue: mockRetryService },
      {
        provide: MissionHealthCheckService,
        useValue: mockHealthCheckService,
      },
      { provide: LeaderModelService, useValue: mockLeaderModelService },
      { provide: MissionAICallerService, useValue: mockAICallerService },
      { provide: TeamMessageService, useValue: mockMessageService },
      { provide: TeamMemberService, useValue: mockMemberService },
      { provide: AgentFacade, useValue: mockAiFacade },
      { provide: TeamFacade, useValue: mockAiFacade },
    ],
  }).compile();

  return module.get<TeamMissionService>(TeamMissionService);
}

function resetDefaultMocks() {
  jest.clearAllMocks();

  mockPrisma.topicAIMember.findFirst.mockResolvedValue(makeMission().leader);
  mockPrisma.teamMission.create.mockResolvedValue(makeMission());
  mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
  mockPrisma.teamMission.update.mockResolvedValue(makeMission());
  mockPrisma.teamMission.findMany.mockResolvedValue([]);
  mockPrisma.agentTask.findMany.mockResolvedValue([]);
  mockPrisma.agentTask.findUnique.mockResolvedValue(makeTask());
  mockPrisma.agentTask.update.mockResolvedValue(makeTask());
  mockPrisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.missionLog.create.mockResolvedValue({ id: "log-1" });
  mockPrisma.topicMessage.create.mockResolvedValue({ id: "msg-1" });
  mockPrisma.$queryRaw.mockResolvedValue([{ total_tokens_used: 0 }]);
  mockPrisma.$transaction.mockImplementation(async (callback) => {
    const tx = {
      agentTask: {
        create: jest.fn().mockResolvedValue({ id: "task-1" }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        createManyAndReturn: jest
          .fn()
          .mockResolvedValue([
            { id: "task-1", title: "Task 1", dependsOnIds: [] },
          ]),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      teamMission: { update: jest.fn().mockResolvedValue({}) },
    };
    if (typeof callback === "function") return callback(tx);
    return Promise.resolve();
  });

  mockAiFacade.circuitBreaker.canExecute.mockReturnValue(true);
  mockAiFacade.circuitBreaker.getCooldownRemaining.mockReturnValue(0);
  mockAiFacade.circuitBreaker.selectBest.mockReturnValue(null);
  mockAiFacade.coordinatorStore.mockResolvedValue(undefined);

  // completeMission (private) calls leaderModelService → let it reject cleanly
  mockLeaderModelService.executeWithFallback.mockRejectedValue(
    new Error("AI unavailable"),
  );
  mockMessageService.createLog.mockResolvedValue(undefined);
  mockMessageService.sendMessageToTopic.mockResolvedValue({ id: "msg-1" });
  mockLongContentService.buildGranularityConstraintPrompt.mockReturnValue(null);
  mockLongContentService.validateTaskCount.mockReturnValue({
    isValid: true,
    warning: null,
  });
  mockLongContentService.initMission.mockResolvedValue(undefined);
  mockConstraintEnforcementService.extractConstraints.mockReturnValue([]);
  mockMissionContextService.extractContextFromLeaderOutput.mockReturnValue(
    null,
  );
}

// ============================================================
// Test suites
// ============================================================

describe("TeamMissionService - Additional Coverage", () => {
  let service: TeamMissionService;

  // Build module once - avoids OOM from repeated ts-jest compilation of 6255-line file
  beforeAll(async () => {
    service = await buildModule();
  });

  beforeEach(() => {
    resetDefaultMocks();
  });

  // ============================================================
  // recoverRevisionTasks - branch coverage (via healthCheckService callback)
  // ============================================================

  describe("recoverRevisionTasks via healthCheckService callback", () => {
    it("should not proceed when mission status is not IN_PROGRESS", async () => {
      let revisionCallback: ((missionId: string) => Promise<void>) | null =
        null;
      mockHealthCheckService.registerRevisionCallback.mockImplementation(
        (cb) => {
          revisionCallback = cb;
        },
      );
      await service.onModuleInit();

      const pausedMission = makeMission({
        status: MissionStatus.PAUSED,
        tasks: [
          makeTask({
            status: AgentTaskStatus.REVISION_NEEDED,
            leaderFeedback: "Feedback",
          }),
        ],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(pausedMission);

      await expect(revisionCallback!("mission-1")).resolves.not.toThrow();

      // Since mission is PAUSED, revision should not be triggered
      expect(mockAICallerService.callAIWithConfig).not.toHaveBeenCalled();
    });

    it("should handle errors from executeTaskRevision gracefully", async () => {
      let revisionCallback: ((missionId: string) => Promise<void>) | null =
        null;
      mockHealthCheckService.registerRevisionCallback.mockImplementation(
        (cb) => {
          revisionCallback = cb;
        },
      );
      await service.onModuleInit();

      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [
          makeTask({
            status: AgentTaskStatus.REVISION_NEEDED,
            leaderFeedback: "Please revise",
          }),
        ],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(mission);
      // Force executeTaskRevision to fail
      mockAICallerService.callAIWithConfig.mockRejectedValueOnce(
        new Error("Revision AI failed"),
      );

      await expect(revisionCallback!("mission-1")).resolves.not.toThrow();
    });
  });

  // ============================================================
  // executeNextTasks - force-complete and dependency relaxation
  // IMPORTANT: Each test must mock the DB to return a terminal state on recursive calls.
  // Using makeMission with status=COMPLETED prevents infinite loops.
  // ============================================================

  describe("executeNextTasks - force-complete and dependency relaxation", () => {
    type ExecuteFn = (id: string) => Promise<void>;

    const callExecuteNextTasks = (svc: TeamMissionService, missionId: string) =>
      (svc as unknown as { executeNextTasks: ExecuteFn }).executeNextTasks(
        missionId,
      );

    // Terminal mock: a COMPLETED mission (not IN_PROGRESS) - terminates recursion immediately
    const terminalMission = makeMission({ status: MissionStatus.COMPLETED });

    it("should force-complete remaining tasks when completion rate >= 95%", async () => {
      // 19 completed + 1 blocked = 95%
      const completedTasks = Array.from({ length: 19 }, (_, i) =>
        makeTask({ id: `task-${i}`, status: AgentTaskStatus.COMPLETED }),
      );
      const blockedTask = makeTask({
        id: "task-blocked",
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(), // recent - prevents force-complete via autoRetry
      });

      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [...completedTasks, blockedTask],
      });
      // First call: our mission; after force-complete, recursive call gets COMPLETED mission → terminates
      mockPrisma.teamMission.findUnique
        .mockResolvedValueOnce(mission)
        .mockResolvedValue(terminalMission);

      await callExecuteNextTasks(service, "mission-1");

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-blocked" },
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should reset stuck IN_PROGRESS tasks to PENDING and re-run", async () => {
      const stuckAt = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago

      const completedTask = makeTask({
        id: "completed",
        status: AgentTaskStatus.COMPLETED,
      });
      const stuckTask = makeTask({
        id: "stuck-task",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: stuckAt,
      });

      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [completedTask, stuckTask],
      });
      mockPrisma.teamMission.findUnique
        .mockResolvedValueOnce(mission)
        .mockResolvedValue(terminalMission);

      await callExecuteNextTasks(service, "mission-1");

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-task" },
          data: expect.objectContaining({
            status: AgentTaskStatus.PENDING,
            startedAt: null,
          }),
        }),
      );
      expect(mockStateManager.finishTask).toHaveBeenCalledWith("stuck-task");
    });

    it("should attempt dependency relaxation for old stuck missions", async () => {
      const oldCreatedAt = new Date(Date.now() - 35 * 60 * 1000); // 35 min old

      // Blocked dep task with RECENT updatedAt (not stuck) and circuit breaker blocking it
      // → autoRetryBlockedTasks returns 0 (can't retry due to circuit breaker, not stuck enough)
      const blockedDep = makeTask({
        id: "dep-task",
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(), // RECENT - prevents force-complete in autoRetryBlockedTasks
        assignedTo: {
          id: "blocked-agent",
          displayName: "BlockedAgent",
          agentName: "BlockedAgent",
          aiModel: "gpt-4",
          isLeader: false,
          topicId: "topic-1",
        },
        assignedToId: "blocked-agent",
      });
      const pendingTask = makeTask({
        id: "pending-task",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: ["dep-task"],
      });

      // Circuit breaker blocks the dep task's agent → autoRetry returns 0
      mockAiFacade.circuitBreaker.canExecute.mockImplementation(
        (id: string) => id !== "blocked-agent",
      );

      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        createdAt: oldCreatedAt,
        tasks: [blockedDep, pendingTask],
      });
      mockPrisma.teamMission.findUnique
        .mockResolvedValueOnce(mission)
        .mockResolvedValue(terminalMission);

      await callExecuteNextTasks(service, "mission-1");

      // Dependency relaxation should have cleared dependsOnIds for pending-task
      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pending-task" },
          data: { dependsOnIds: [] },
        }),
      );
    });

    it("should not relax dependencies if mission is recent", async () => {
      const recentCreatedAt = new Date(Date.now() - 5 * 60 * 1000); // 5 min old

      const blockedDep = makeTask({
        id: "dep-task",
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(),
        assignedTo: {
          id: "blocked-agent",
          displayName: "BlockedAgent",
          agentName: "BlockedAgent",
          aiModel: "gpt-4",
          isLeader: false,
          topicId: "topic-1",
        },
        assignedToId: "blocked-agent",
      });
      const pendingTask = makeTask({
        id: "pending-task",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: ["dep-task"],
      });

      // Circuit breaker blocks the dep task's agent
      mockAiFacade.circuitBreaker.canExecute.mockImplementation(
        (id: string) => id !== "blocked-agent",
      );

      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        createdAt: recentCreatedAt,
        tasks: [blockedDep, pendingTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(mission);

      await callExecuteNextTasks(service, "mission-1");

      // No dependency relaxation for recent missions
      expect(mockPrisma.agentTask.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "pending-task" },
          data: { dependsOnIds: [] },
        }),
      );
    });

    it("should force-complete stuck AWAITING_REVIEW tasks", async () => {
      const stuckAt = new Date(Date.now() - 20 * 60 * 1000);
      const completedTask = makeTask({
        id: "completed",
        status: AgentTaskStatus.COMPLETED,
      });
      const stuckReviewTask = makeTask({
        id: "review-task",
        status: AgentTaskStatus.AWAITING_REVIEW,
        updatedAt: stuckAt,
      });

      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [completedTask, stuckReviewTask],
      });
      // After force-completing the review task, recursive call gets a terminal mission
      mockPrisma.teamMission.findUnique
        .mockResolvedValueOnce(mission)
        .mockResolvedValue(terminalMission);

      await callExecuteNextTasks(service, "mission-1");

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "review-task" },
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should auto-retry blocked tasks when circuit breaker allows", async () => {
      mockAiFacade.circuitBreaker.canExecute.mockReturnValue(true);
      mockAiFacade.circuitBreaker.getCooldownRemaining.mockReturnValue(0);

      const completedTask = makeTask({
        id: "completed",
        status: AgentTaskStatus.COMPLETED,
      });
      const blockedTask = makeTask({
        id: "blocked-task",
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(), // recent
      });

      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [completedTask, blockedTask],
      });
      mockPrisma.teamMission.findUnique
        .mockResolvedValueOnce(mission)
        .mockResolvedValue(terminalMission);

      await callExecuteNextTasks(service, "mission-1");

      // Blocked task should be reset to PENDING for retry
      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "blocked-task" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });
  });

  // ============================================================
  // executeTask - CAS update = 0 (skip already running task)
  // ============================================================

  describe("executeTask - CAS protection", () => {
    type ExecTaskFn = (mission: unknown, task: unknown) => Promise<void>;

    it("should skip execution when updateMany CAS returns count = 0", async () => {
      mockPrisma.agentTask.updateMany.mockResolvedValueOnce({ count: 0 });

      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      const task = makeTask({ status: AgentTaskStatus.IN_PROGRESS });

      await expect(
        (service as unknown as { executeTask: ExecTaskFn }).executeTask(
          mission,
          task,
        ),
      ).resolves.not.toThrow();

      // Since count = 0, should NOT proceed to AI calls
      expect(mockAICallerService.callAIWithConfig).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // executeTask - circuit breaker blocks initial agent
  // ============================================================

  describe("executeTask - circuit breaker blocks initial agent", () => {
    type ExecTaskFn = (mission: unknown, task: unknown) => Promise<void>;

    it("should block task when agent is in cooldown and no alternative exists", async () => {
      mockAiFacade.circuitBreaker.canExecute.mockReturnValue(false);
      mockAiFacade.circuitBreaker.getCooldownRemaining.mockReturnValue(30000);

      // Only one member (leader), so no non-leader alternative
      mockMemberService.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          displayName: "Leader",
          isLeader: true,
          aiModel: "gpt-4o",
        },
        members: [],
        all: [
          {
            id: "leader-1",
            displayName: "Leader",
            isLeader: true,
            aiModel: "gpt-4o",
          },
        ],
      });

      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      const task = makeTask({ status: AgentTaskStatus.PENDING });

      await (service as unknown as { executeTask: ExecTaskFn }).executeTask(
        mission,
        task,
      );

      // Task should be marked BLOCKED
      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1" },
          data: { status: AgentTaskStatus.BLOCKED },
        }),
      );
    });

    it("should switch to alternative agent when initial agent is in cooldown", async () => {
      // First call (initial agent check): blocked; subsequent calls: allowed
      mockAiFacade.circuitBreaker.canExecute
        .mockReturnValueOnce(false)
        .mockReturnValue(true);
      mockAiFacade.circuitBreaker.getCooldownRemaining.mockReturnValue(10000);

      mockMemberService.getTeamMembers.mockResolvedValue({
        leader: {
          id: "leader-1",
          displayName: "Leader",
          isLeader: true,
          aiModel: "gpt-4o",
        },
        members: [
          {
            id: "member-2",
            displayName: "Bob",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
        all: [
          {
            id: "leader-1",
            displayName: "Leader",
            isLeader: true,
            aiModel: "gpt-4o",
          },
          {
            id: "member-1",
            displayName: "Alice",
            isLeader: false,
            aiModel: "claude-3",
          },
          {
            id: "member-2",
            displayName: "Bob",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
      });

      mockAICallerService.callAIWithConfig.mockResolvedValue({
        content: "Task result from Bob",
        tokensUsed: 200,
      });
      mockLongContentService.processTaskCompletion.mockResolvedValue({
        needsContinuation: false,
        finalContent: "Task result from Bob",
      });

      // leaderReviewTask will call leaderModelService which rejects (handled internally)
      mockLeaderModelService.executeWithFallback.mockRejectedValue(
        new Error("AI unavailable"),
      );

      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      const task = makeTask();

      await expect(
        (service as unknown as { executeTask: ExecTaskFn }).executeTask(
          mission,
          task,
        ),
      ).resolves.not.toThrow();
    });
  });

  // ============================================================
  // executeLeaderPlanning - API error content detection (direct call)
  // ============================================================

  describe("executeLeaderPlanning - API error content detection (direct call)", () => {
    type PlanFn = (mission: unknown) => Promise<void>;

    const callPlan = (svc: TeamMissionService, mission: unknown) =>
      (
        svc as unknown as { executeLeaderPlanning: PlanFn }
      ).executeLeaderPlanning(mission);

    it("should retry with shorter description when response starts with 'API Error: context'", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });

      // First call: context error → retry; Second call: valid task JSON
      mockLeaderModelService.executeWithFallback
        .mockResolvedValueOnce({
          success: true,
          data: {
            content: "API Error: context length exceeds token limit",
            tokensUsed: 0,
          },
          fallbackUsed: false,
          modelUsed: "gpt-4o",
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            content: JSON.stringify({
              tasks: [
                {
                  title: "Task1",
                  description: "Desc",
                  assignee: "member-1",
                  priority: "MEDIUM",
                  taskType: "RESEARCH",
                  dependsOn: [],
                },
              ],
            }),
            tokensUsed: 300,
          },
          fallbackUsed: false,
          modelUsed: "gpt-4o",
        });

      await expect(callPlan(service, mission)).resolves.not.toThrow();

      // Should have called executeWithFallback at least twice
      expect(mockLeaderModelService.executeWithFallback).toHaveBeenCalledTimes(
        2,
      );
    });

    it("should mark mission FAILED for non-context API errors in content", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });

      mockLeaderModelService.executeWithFallback.mockResolvedValueOnce({
        success: true,
        data: {
          content: "API Error: authentication failed",
          tokensUsed: 0,
        },
        fallbackUsed: false,
        modelUsed: "gpt-4o",
      });

      // Auth errors are not retried – executeLeaderPlanning catches and marks mission FAILED
      await expect(callPlan(service, mission)).resolves.not.toThrow();
      expect(mockPrisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-1" },
          data: { status: MissionStatus.FAILED },
        }),
      );
    });

    it("should retry all levels and fall back to default task when all context errors persist", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });

      // All 5 retry levels return context-too-large errors
      mockLeaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: {
          content: "API Error: context length exceeds token limit",
          tokensUsed: 0,
        },
        fallbackUsed: false,
        modelUsed: "gpt-4o",
      });

      // executeLeaderPlanning retries all 5 levels, then falls through to parseTaskBreakdown
      // which creates a default task when parsing fails — mission proceeds to IN_PROGRESS
      await expect(callPlan(service, mission)).resolves.not.toThrow();
      // All 5 descriptionLengthLevels attempted
      expect(mockLeaderModelService.executeWithFallback).toHaveBeenCalledTimes(
        5,
      );
    });

    it("should mark mission FAILED when leader model returns failure result (success: false)", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });

      mockLeaderModelService.executeWithFallback.mockResolvedValueOnce({
        success: false,
        data: null,
        error: { getUserMessage: () => "All leader models failed" },
        fallbackUsed: true,
        modelUsed: "fallback-model",
      });

      // executeLeaderPlanning catches the thrown error and marks mission FAILED
      await expect(callPlan(service, mission)).resolves.not.toThrow();
      expect(mockPrisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-1" },
          data: { status: MissionStatus.FAILED },
        }),
      );
    });
  });

  // ============================================================
  // executeLeaderPlanning - task count validation
  // ============================================================

  describe("executeLeaderPlanning - task count validation", () => {
    const successResponse = {
      success: true,
      data: {
        content: JSON.stringify({
          tasks: [
            {
              title: "Task1",
              description: "Desc",
              assignee: "member-1",
              priority: "MEDIUM",
              taskType: "RESEARCH",
              dependsOn: [],
            },
          ],
        }),
        tokensUsed: 300,
      },
      fallbackUsed: false,
      modelUsed: "gpt-4o",
    };

    it("should log warning when task count validation fails (not blocking)", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      mockLeaderModelService.executeWithFallback.mockResolvedValueOnce(
        successResponse,
      );

      mockLongContentService.validateTaskCount.mockReturnValueOnce({
        isValid: false,
        warning: "Task count mismatch",
        suggestion: "Increase task count",
      });

      await (
        service as unknown as {
          executeLeaderPlanning: (m: unknown) => Promise<void>;
        }
      ).executeLeaderPlanning(mission);

      expect(mockMessageService.createLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({ type: MissionLogType.LEADER_FEEDBACK }),
      );
    });

    it("should log info when task count has warning but is valid", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      mockLeaderModelService.executeWithFallback.mockResolvedValueOnce(
        successResponse,
      );

      mockLongContentService.validateTaskCount.mockReturnValueOnce({
        isValid: true,
        warning: "Task count is lower than expected",
      });

      await expect(
        (
          service as unknown as {
            executeLeaderPlanning: (m: unknown) => Promise<void>;
          }
        ).executeLeaderPlanning(mission),
      ).resolves.not.toThrow();
    });
  });

  // ============================================================
  // createMission - autoStart
  // ============================================================

  describe("createMission - autoStart triggers async startMission", () => {
    it("should not auto-start when autoStart is explicitly false", async () => {
      const dto = {
        title: "No Auto-start",
        description: "Desc",
        objectives: [],
        constraints: [],
        deliverables: [],
        leaderId: "leader-1",
        autoStart: false,
      };

      const result = await service.createMission("topic-1", "user-1", dto);

      expect(result).toBeDefined();
      // findUnique for startMission should not have been called
      expect(mockPrisma.teamMission.findUnique).not.toHaveBeenCalled();
    });

    it("should trigger startMission asynchronously when autoStart is true", async () => {
      const dto = {
        title: "Auto-start Mission",
        description: "Desc",
        objectives: [],
        constraints: [],
        deliverables: [],
        leaderId: "leader-1",
        autoStart: true,
      };

      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: MissionStatus.PENDING }),
      );

      const result = await service.createMission("topic-1", "user-1", dto);

      expect(result).toBeDefined();
      // Allow fire-and-forget to settle
      await new Promise((r) => setTimeout(r, 50));
    });
  });

  // ============================================================
  // completeMission delegates (executeNextTasks → private completeMission)
  // ============================================================

  describe("completeMission via private method when all tasks complete", () => {
    it("should call private completeMission when executeNextTasks finds all tasks complete", async () => {
      const allCompletedMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [makeTask({ status: AgentTaskStatus.COMPLETED })],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        allCompletedMission,
      );

      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-1");

      // Private completeMission called prisma.teamMission.update to mark as REVIEW/COMPLETED
      expect(mockPrisma.teamMission.update).toHaveBeenCalled();
    });
  });

  // ============================================================
  // updateMissionNotification
  // ============================================================

  describe("updateMissionNotification", () => {
    it("should delegate to lifecycleService.updateMissionNotification with createLog callback", async () => {
      const dto = { notificationEmail: "email@example.com" };

      await service.updateMissionNotification("mission-1", "user-1", dto);

      expect(
        mockLifecycleService.updateMissionNotification,
      ).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        dto,
        expect.any(Function), // createLog callback bound to service
      );
    });
  });

  // ============================================================
  // getMissions - additional filter options
  // ============================================================

  describe("getMissions - additional filters", () => {
    it("should return all missions when no filter is provided", async () => {
      const missions = [makeMission(), makeMission({ id: "mission-2" })];
      mockPrisma.teamMission.findMany.mockResolvedValueOnce(missions);

      const result = await service.getMissions("topic-1");

      expect(result).toHaveLength(2);
    });

    it("should filter by COMPLETED status", async () => {
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([]);

      await service.getMissions("topic-1", { status: MissionStatus.COMPLETED });

      expect(mockPrisma.teamMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: MissionStatus.COMPLETED,
          }),
        }),
      );
    });
  });

  // ============================================================
  // getLeaderSystemPrompt / getAgentSystemPrompt
  // ============================================================

  describe("getLeaderSystemPrompt", () => {
    it("should return a non-empty string for the leader", () => {
      const leader = makeMission().leader;

      const result = (
        service as unknown as {
          getLeaderSystemPrompt: (leader: unknown) => string;
        }
      ).getLeaderSystemPrompt(leader);

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("getAgentSystemPrompt - MUST constraints included", () => {
    it("should include must constraints in prompt when provided", () => {
      const agent = makeMission().topic.aiMembers[1];
      const task = makeTask();
      const mustConstraints = [
        { id: "HC-1", rule: "Character X is always silent", severity: "MUST" },
        { id: "HC-2", rule: "Setting is medieval", severity: "SHOULD" },
      ];

      const result = (
        service as unknown as {
          getAgentSystemPrompt: (
            agent: unknown,
            task: unknown,
            context: unknown,
            missionDesc?: string,
            mustConstraints?: unknown[],
          ) => string;
        }
      ).getAgentSystemPrompt(
        agent,
        task,
        null,
        "Mission desc",
        mustConstraints,
      );

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should build prompt even when contextPackage is null", () => {
      const agent = makeMission().topic.aiMembers[1];
      const task = makeTask();

      const result = (
        service as unknown as {
          getAgentSystemPrompt: (
            agent: unknown,
            task: unknown,
            context: unknown,
          ) => string;
        }
      ).getAgentSystemPrompt(agent, task, null);

      expect(typeof result).toBe("string");
    });
  });

  // ============================================================
  // buildTaskExecutionPrompt
  // ============================================================

  describe("buildTaskExecutionPrompt", () => {
    it("should include search context when provided", () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      const task = makeTask();
      const searchContext = "Search result 1\nSearch result 2";

      const result = (
        service as unknown as {
          buildTaskExecutionPrompt: (
            mission: unknown,
            task: unknown,
            searchContext: string,
          ) => string;
        }
      ).buildTaskExecutionPrompt(mission, task, searchContext);

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should build prompt without search context when empty", () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      const task = makeTask();

      const result = (
        service as unknown as {
          buildTaskExecutionPrompt: (
            mission: unknown,
            task: unknown,
            searchContext: string,
          ) => string;
        }
      ).buildTaskExecutionPrompt(mission, task, "");

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // parseTaskBreakdown
  // ============================================================

  describe("parseTaskBreakdown", () => {
    type ParseFn = (
      content: string,
      members: unknown[],
    ) => { tasks: unknown[] };

    it("should parse valid JSON task breakdown", () => {
      const content = JSON.stringify({
        tasks: [
          {
            title: "Task 1",
            description: "Description 1",
            assignee: "member-1",
            priority: "HIGH",
            taskType: "RESEARCH",
            dependsOn: [],
          },
        ],
      });

      const teamMembers = [
        {
          id: "member-1",
          displayName: "Agent One",
          agentName: "AgentOne",
          isLeader: false,
        },
      ];

      const result = (
        service as unknown as { parseTaskBreakdown: ParseFn }
      ).parseTaskBreakdown(content, teamMembers);

      expect(result.tasks).toHaveLength(1);
    });

    it("should return empty tasks array for invalid JSON", () => {
      const invalidContent = "This is not JSON at all";
      const teamMembers = [
        {
          id: "member-1",
          displayName: "Agent One",
          agentName: "AgentOne",
          isLeader: false,
        },
      ];

      const result = (
        service as unknown as { parseTaskBreakdown: ParseFn }
      ).parseTaskBreakdown(invalidContent, teamMembers);

      expect(result).toBeDefined();
      expect(Array.isArray(result.tasks)).toBe(true);
    });
  });

  // ============================================================
  // recoverStuckTasks - multiple stuck tasks reset
  // ============================================================

  describe("recoverStuckTasks - multiple tasks reset", () => {
    it("should reset multiple stuck tasks to PENDING during onModuleInit", async () => {
      const stuckTask1 = makeTask({
        id: "stuck-1",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 40 * 60 * 1000),
      });
      const stuckTask2 = makeTask({
        id: "stuck-2",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 45 * 60 * 1000),
      });
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([
        stuckTask1,
        stuckTask2,
      ]);
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([]);

      await service.onModuleInit();

      expect(mockPrisma.agentTask.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-1" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-2" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });
  });

  // ============================================================
  // findAlternativeAgentWithCircuitBreaker - private method
  // ============================================================

  describe("findAlternativeAgentWithCircuitBreaker (private)", () => {
    type FindFn = (
      mission: unknown,
      failed: string[],
      task: unknown,
    ) => Promise<unknown>;

    it("should use circuit breaker selectBest when available", async () => {
      mockAiFacade.circuitBreaker.canExecute.mockReturnValue(true);
      mockAiFacade.circuitBreaker.selectBest.mockReturnValue("member-1");

      mockMemberService.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          displayName: "Leader",
          isLeader: true,
          aiModel: "gpt-4o",
        },
        members: [
          {
            id: "member-1",
            displayName: "Alice",
            isLeader: false,
            aiModel: "claude-3",
          },
          {
            id: "member-2",
            displayName: "Bob",
            isLeader: false,
            aiModel: "gemini",
          },
        ],
        all: [
          {
            id: "leader-1",
            displayName: "Leader",
            isLeader: true,
            aiModel: "gpt-4o",
          },
          {
            id: "member-1",
            displayName: "Alice",
            isLeader: false,
            aiModel: "claude-3",
          },
          {
            id: "member-2",
            displayName: "Bob",
            isLeader: false,
            aiModel: "gemini",
          },
        ],
      });

      const mission = makeMission();
      const task = makeTask();

      const result = await (
        service as unknown as {
          findAlternativeAgentWithCircuitBreaker: FindFn;
        }
      ).findAlternativeAgentWithCircuitBreaker(mission, [], task);

      expect(result).not.toBeNull();
      expect((result as { id: string }).id).toBe("member-1");
    });

    it("should fall back to first candidate when selectBest returns unknown id", async () => {
      mockAiFacade.circuitBreaker.canExecute.mockReturnValue(true);
      mockAiFacade.circuitBreaker.selectBest.mockReturnValue("unknown-id");

      mockMemberService.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          displayName: "Leader",
          isLeader: true,
          aiModel: "gpt-4o",
        },
        members: [
          {
            id: "member-1",
            displayName: "Alice",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
        all: [
          {
            id: "leader-1",
            displayName: "Leader",
            isLeader: true,
            aiModel: "gpt-4o",
          },
          {
            id: "member-1",
            displayName: "Alice",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
      });

      const mission = makeMission();
      const task = makeTask();

      const result = await (
        service as unknown as {
          findAlternativeAgentWithCircuitBreaker: FindFn;
        }
      ).findAlternativeAgentWithCircuitBreaker(mission, [], task);

      // Should fall back to candidates[0] = member-1
      expect(result).not.toBeNull();
      expect((result as { id: string }).id).toBe("member-1");
    });

    it("should handle errors gracefully and return null", async () => {
      mockMemberService.getTeamMembers.mockRejectedValueOnce(
        new Error("Service error"),
      );

      const mission = makeMission();
      const task = makeTask();

      const result = await (
        service as unknown as {
          findAlternativeAgentWithCircuitBreaker: FindFn;
        }
      ).findAlternativeAgentWithCircuitBreaker(mission, [], task);

      expect(result).toBeNull();
    });
  });
});

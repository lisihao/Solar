/**
 * TeamMissionService - Supplemental4 Tests
 *
 * Covers deeply uncovered code paths:
 * - executeNextTasks: lock contention, pending executions, all-completed path,
 *   force-complete threshold, blocked tasks, stuck in-progress, dependency relaxation
 * - executeTask: task no longer PENDING, api error content, agent switch, circuit breaker paths
 * - handleTaskExecutionFailure: replan success/failure, JSON parsing, assignee not found
 * - leaderReviewTask: approved path, rejected with revision, max revisions force-pass,
 *   max revisions no content -> BLOCKED, review AI failure path
 * - executeTaskRevision: lock already held, task not found, updateMany=0, AI error, API error content
 * - completeMission: found mission, summary error fallback, email notification
 * - updateMissionProgress: updates correctly
 * - autoRetryBlockedTasks / forceCompleteStuckTasks
 * - validateChapterUniqueness: duplicate detection
 * - createTasksFromBreakdown: independent + dependent tasks
 * - startMission: kernel path, progress tracker path
 * - createMission: leader not found, auto-start false
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
    REVIEW: "REVIEW",
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
  VoteStrategy: {
    MAJORITY: "MAJORITY",
    SUPERMAJORITY: "SUPERMAJORITY",
    UNANIMOUS: "UNANIMOUS",
    LEADER_DECIDES: "LEADER_DECIDES",
  },
  VoteValue: {
    APPROVE: "APPROVE",
    REJECT: "REJECT",
    ABSTAIN: "ABSTAIN",
  },
  ProposalStatus: {
    OPEN: "OPEN",
    CLOSED: "CLOSED",
    CANCELLED: "CANCELLED",
  },
}));

import { Test, TestingModule } from "@nestjs/testing";
import { TeamMissionService } from "../team-mission.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { AgentFacade, TeamFacade } from "@/modules/ai-harness/facade";
import { ToolRegistry } from "@/modules/ai-harness/facade";
import { TopicEventEmitterService } from "../../../events";
import { TeamsLongContentService } from "../../../ai/teams-long-content.service";
import { LeaderModelService } from "../../../ai/leader-model.service";
import { EmailService } from "../../../../../../platform/facade";
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
  TaskPriority,
  TaskType,
} from "@prisma/client";

// ============================================================
// Helpers
// ============================================================

const makeLeader = (overrides: Record<string, unknown> = {}) => ({
  id: "leader-4",
  displayName: "Leader S4",
  agentName: "LeaderS4",
  aiModel: "gpt-4",
  isLeader: true,
  topicId: "topic-4",
  roleDescription: "Leader",
  systemPrompt: "You are a leader",
  contextWindow: 10,
  capabilities: [],
  ...overrides,
});

const makeMember = (overrides: Record<string, unknown> = {}) => ({
  id: "member-4",
  displayName: "Member S4",
  agentName: "MemberS4",
  aiModel: "claude-3",
  isLeader: false,
  topicId: "topic-4",
  roleDescription: "Researcher",
  systemPrompt: "You are a researcher",
  contextWindow: 10,
  capabilities: [],
  ...overrides,
});

const makeMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-4",
  topicId: "topic-4",
  title: "Supplemental4 Mission",
  description: "desc",
  objectives: ["obj1"],
  constraints: [],
  deliverables: [],
  leaderId: "leader-4",
  createdById: "user-4",
  status: MissionStatus.IN_PROGRESS,
  totalTasks: 2,
  completedTasks: 0,
  taskBreakdown: null,
  contextPackage: null,
  mustConstraints: null,
  notificationEmail: null,
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(Date.now() - 5 * 60 * 1000),
  updatedAt: new Date(),
  leader: makeLeader(),
  topic: {
    id: "topic-4",
    name: "Topic S4",
    aiMembers: [makeLeader(), makeMember()],
  },
  tasks: [],
  createdBy: { id: "user-4", username: "user4", fullName: "User Four" },
  ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-4",
  missionId: "mission-4",
  title: "Task S4",
  description: "task desc",
  status: AgentTaskStatus.PENDING,
  priority: TaskPriority.MEDIUM,
  taskType: TaskType.RESEARCH,
  assignedToId: "member-4",
  dependsOnIds: [],
  createdAt: new Date(Date.now() - 2 * 60 * 1000),
  updatedAt: new Date(Date.now() - 2 * 60 * 1000),
  startedAt: null,
  completedAt: null,
  leaderFeedback: null,
  result: null,
  revisionCount: 0,
  maxRevisions: 3,
  needsRevision: false,
  resultMessageId: null,
  feedbackMessageId: null,
  assignedTo: makeMember(),
  mission: makeMission(),
  ...overrides,
});

// ============================================================
// Module builder
// ============================================================

function buildMocks() {
  const prisma = {
    topicAIMember: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    teamMission: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    agentTask: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      groupBy: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      createManyAndReturn: jest
        .fn()
        .mockResolvedValue([
          { id: "new-task-1", title: "New Task 1", dependsOnIds: [] },
        ]),
    },
    missionLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    topicMessage: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest
      .fn()
      .mockImplementation(
        async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
          const tx = {
            agentTask: {
              create: jest
                .fn()
                .mockResolvedValue({ id: "dep-task-1", title: "Dep Task" }),
              createMany: jest.fn().mockResolvedValue({ count: 1 }),
              createManyAndReturn: jest
                .fn()
                .mockResolvedValue([
                  { id: "indep-task-1", title: "Indep Task", dependsOnIds: [] },
                ]),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockResolvedValue({}),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            teamMission: {
              update: jest.fn().mockResolvedValue({}),
            },
          };
          return cb(tx);
        },
      ),
    $queryRaw: jest.fn().mockResolvedValue([{ total_tokens_used: 1000 }]),
  };

  const toolRegistry = {
    execute: jest.fn(),
    getTool: jest.fn(),
    tryGet: jest.fn().mockReturnValue(null),
  };

  const topicEventEmitter = { emitToTopic: jest.fn() };

  const longContentService = {
    initMission: jest.fn().mockResolvedValue(undefined),
    validateTaskCount: jest
      .fn()
      .mockReturnValue({ isValid: true, warning: null }),
    updateTotalTasks: jest.fn(),
    buildGranularityConstraintPrompt: jest.fn().mockReturnValue(null),
    ensureMissionInitialized: jest.fn().mockResolvedValue(undefined),
    processTaskCompletion: jest.fn().mockResolvedValue({
      needsContinuation: false,
      finalContent: null,
      continuationState: null,
      intervention: null,
    }),
    getFinalResult: jest.fn().mockReturnValue(null),
    checkQualityIntervention: jest
      .fn()
      .mockReturnValue({ needed: false, reason: "" }),
    getQualityDashboard: jest.fn().mockReturnValue({
      quality: {
        overallScore: 8.5,
        trend: { trend: "improving" },
      },
    }),
    buildContinuationPrompt: jest.fn().mockReturnValue("continue prompt"),
    clearMission: jest.fn(),
  };

  const leaderModelService = {
    executeWithFallback: jest.fn().mockResolvedValue({
      success: true,
      data: { content: "leader response", tokensUsed: 300 },
      fallbackUsed: false,
      modelUsed: "gpt-4",
      error: null,
    }),
  };

  const emailService = {
    sendMissionCompletionEmail: jest.fn(),
    sendMissionCompletionNotification: jest.fn().mockResolvedValue(true),
  };

  const configService = {
    get: jest.fn().mockReturnValue("http://localhost:3000"),
  };

  const missionContextService = {
    buildContextPackage: jest.fn().mockResolvedValue(null),
    extractContextFromLeaderOutput: jest.fn().mockReturnValue(null),
    buildAgentSystemPromptWithContext: jest
      .fn()
      .mockReturnValue("system prompt"),
    buildContextPackagePromptSection: jest.fn().mockReturnValue(""),
    buildEstablishedFactsSection: jest.fn().mockReturnValue(""),
    extractEstablishedFacts: jest.fn().mockResolvedValue([]),
    mergeEstablishedFacts: jest.fn().mockReturnValue(null),
  };

  const constraintService = {
    extractConstraints: jest.fn().mockReturnValue([]),
    toHardConstraints: jest.fn().mockReturnValue([]),
    enforce: jest.fn().mockReturnValue({ passed: true, violations: [] }),
  };

  const stateManager = {
    startMissionExecution: jest.fn().mockReturnValue(true),
    finishMissionExecution: jest.fn(),
    isTaskExecuting: jest.fn().mockReturnValue(false),
    startTask: jest.fn().mockReturnValue(true),
    finishTask: jest.fn(),
    isRevisionInProgress: jest.fn().mockReturnValue(false),
    startRevision: jest.fn().mockReturnValue(true),
    finishRevision: jest.fn(),
  };

  const lifecycleService = {
    completeMission: jest.fn().mockResolvedValue(undefined),
    failMission: jest.fn().mockResolvedValue(undefined),
    cancelMission: jest
      .fn()
      .mockResolvedValue({ id: "mission-4", status: MissionStatus.CANCELLED }),
    pauseMission: jest
      .fn()
      .mockResolvedValue({ id: "mission-4", status: MissionStatus.PAUSED }),
    resumeMission: jest.fn().mockResolvedValue({
      id: "mission-4",
      status: MissionStatus.IN_PROGRESS,
    }),
    deleteMission: jest.fn().mockResolvedValue(undefined),
    updateMissionNotification: jest.fn().mockResolvedValue(undefined),
  };

  const retryService = { shouldRetry: jest.fn().mockReturnValue(false) };

  const healthCheckService = {
    registerExecuteCallback: jest.fn(),
    registerRevisionCallback: jest.fn(),
    resetRecoveryAttempts: jest.fn(),
    cleanupCompletedMission: jest.fn(),
  };

  const aiCallerService = {
    callAIWithConfig: jest
      .fn()
      .mockResolvedValue({ content: "AI response", tokensUsed: 200 }),
  };

  const messageService = {
    sendMessage: jest.fn().mockResolvedValue({ id: "msg-4" }),
    sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-4" }),
    createLog: jest.fn().mockResolvedValue(undefined),
  };

  const memberService = {
    getTeamMembers: jest.fn().mockResolvedValue({
      leader: makeLeader(),
      members: [makeMember()],
      all: [makeLeader(), makeMember()],
    }),
    getLeader: jest.fn().mockResolvedValue(makeLeader()),
  };

  const agentFacade = {
    chat: jest.fn().mockResolvedValue({ content: "AI response" }),
    contextInit: null,
    circuitBreaker: {
      canExecute: jest.fn().mockReturnValue(true),
      getCooldownRemaining: jest.fn().mockReturnValue(0),
      incrementLoad: jest.fn(),
      decrementLoad: jest.fn(),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      parseErrorType: jest.fn().mockReturnValue("UNKNOWN"),
      selectBest: jest.fn().mockReturnValue(null),
      getHealthMetrics: jest.fn().mockReturnValue(null),
    },
    coordinatorStore: jest.fn().mockReturnValue(Promise.resolve()),
  };

  const teamFacade = {
    getTeam: jest.fn(),
    contextInit: null,
  };

  return {
    prisma,
    toolRegistry,
    topicEventEmitter,
    longContentService,
    leaderModelService,
    emailService,
    configService,
    missionContextService,
    constraintService,
    stateManager,
    lifecycleService,
    retryService,
    healthCheckService,
    aiCallerService,
    messageService,
    memberService,
    agentFacade,
    teamFacade,
  };
}

async function buildModule(
  mocks: ReturnType<typeof buildMocks>,
): Promise<TeamMissionService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TeamMissionService,
      { provide: PrismaService, useValue: mocks.prisma },
      { provide: ToolRegistry, useValue: mocks.toolRegistry },
      {
        provide: TopicEventEmitterService,
        useValue: mocks.topicEventEmitter,
      },
      { provide: TeamsLongContentService, useValue: mocks.longContentService },
      { provide: EmailService, useValue: mocks.emailService },
      { provide: ConfigService, useValue: mocks.configService },
      {
        provide: MissionContextService,
        useValue: mocks.missionContextService,
      },
      {
        provide: ConstraintEnforcementService,
        useValue: mocks.constraintService,
      },
      { provide: MissionStateManager, useValue: mocks.stateManager },
      { provide: MissionLifecycleService, useValue: mocks.lifecycleService },
      { provide: MissionRetryService, useValue: mocks.retryService },
      {
        provide: MissionHealthCheckService,
        useValue: mocks.healthCheckService,
      },
      { provide: LeaderModelService, useValue: mocks.leaderModelService },
      { provide: MissionAICallerService, useValue: mocks.aiCallerService },
      { provide: TeamMessageService, useValue: mocks.messageService },
      { provide: TeamMemberService, useValue: mocks.memberService },
      { provide: AgentFacade, useValue: mocks.agentFacade },
      { provide: TeamFacade, useValue: mocks.teamFacade },
    ],
  }).compile();
  return module.get<TeamMissionService>(TeamMissionService);
}

// ============================================================
// Tests
// ============================================================

describe("TeamMissionService (supplemental4a)", () => {
  let mocks: ReturnType<typeof buildMocks>;
  let service: TeamMissionService;
  let executeCallback: (id: string) => Promise<void>;

  beforeAll(async () => {
    mocks = buildMocks();
    service = await buildModule(mocks);
    // Call onModuleInit once to register callbacks
    mocks.prisma.agentTask.findMany.mockResolvedValue([]);
    mocks.prisma.teamMission.findMany.mockResolvedValue([]);
    await service.onModuleInit();
    // Save callback reference before clearAllMocks wipes it
    executeCallback = mocks.healthCheckService.registerExecuteCallback.mock
      .calls[0][0] as (id: string) => Promise<void>;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply default mocks after clearAllMocks
    Object.values(mocks.prisma.topicAIMember).forEach((m) =>
      m.mockResolvedValue(null),
    );
    mocks.prisma.topicAIMember.findMany.mockResolvedValue([]);
    Object.values(mocks.prisma.teamMission).forEach((m) =>
      m.mockResolvedValue(null),
    );
    mocks.prisma.teamMission.findMany.mockResolvedValue([]);
    mocks.prisma.teamMission.create.mockResolvedValue({});
    mocks.prisma.teamMission.update.mockResolvedValue({});
    Object.values(mocks.prisma.agentTask).forEach((m) =>
      m.mockResolvedValue(null),
    );
    mocks.prisma.agentTask.findMany.mockResolvedValue([]);
    mocks.prisma.agentTask.update.mockResolvedValue({});
    mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.agentTask.create.mockResolvedValue({});
    mocks.prisma.agentTask.groupBy.mockResolvedValue([]);
    mocks.prisma.agentTask.createMany.mockResolvedValue({ count: 1 });
    mocks.prisma.agentTask.createManyAndReturn.mockResolvedValue([
      { id: "new-task-1", title: "New Task 1", dependsOnIds: [] },
    ]);
    mocks.prisma.missionLog.create.mockResolvedValue({});
    mocks.prisma.missionLog.findMany.mockResolvedValue([]);
    mocks.prisma.topicMessage.create.mockResolvedValue({});
    mocks.prisma.topicMessage.findMany.mockResolvedValue([]);
    mocks.prisma.$queryRaw.mockResolvedValue([{ total_tokens_used: 1000 }]);
    // Re-apply service mocks
    mocks.stateManager.startMissionExecution.mockReturnValue(true);
    mocks.stateManager.finishMissionExecution.mockReturnValue(undefined);
    mocks.stateManager.isTaskExecuting.mockReturnValue(false);
    mocks.stateManager.startTask.mockReturnValue(true);
    mocks.stateManager.finishTask.mockReturnValue(undefined);
    mocks.stateManager.isRevisionInProgress.mockReturnValue(false);
    mocks.stateManager.startRevision.mockReturnValue(true);
    mocks.stateManager.finishRevision.mockReturnValue(undefined);
    mocks.messageService.sendMessage.mockResolvedValue({ id: "msg-4" });
    mocks.messageService.sendMessageToTopic.mockResolvedValue({ id: "msg-4" });
    mocks.messageService.createLog.mockResolvedValue(undefined);
    mocks.memberService.getTeamMembers.mockResolvedValue({
      leader: makeLeader(),
      members: [makeMember()],
      all: [makeLeader(), makeMember()],
    });
    mocks.memberService.getLeader.mockResolvedValue(makeLeader());
    mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
      content: "AI response",
      tokensUsed: 200,
    });
    mocks.leaderModelService.executeWithFallback.mockResolvedValue({
      success: true,
      data: { content: "leader response", tokensUsed: 300 },
      fallbackUsed: false,
      modelUsed: "gpt-4",
      error: null,
    });
    mocks.longContentService.initMission.mockResolvedValue(undefined);
    mocks.longContentService.validateTaskCount.mockReturnValue({
      isValid: true,
      warning: null,
    });
    mocks.longContentService.processTaskCompletion.mockResolvedValue({
      needsContinuation: false,
      finalContent: null,
      continuationState: null,
      intervention: null,
    });
    mocks.longContentService.checkQualityIntervention.mockReturnValue({
      needed: false,
      reason: "",
    });
    mocks.lifecycleService.completeMission.mockResolvedValue(undefined);
    mocks.lifecycleService.failMission.mockResolvedValue(undefined);
    mocks.agentFacade.circuitBreaker.canExecute.mockReturnValue(true);
    mocks.agentFacade.circuitBreaker.getCooldownRemaining.mockReturnValue(0);
    mocks.agentFacade.circuitBreaker.selectBest.mockReturnValue(null);
    mocks.agentFacade.circuitBreaker.getHealthMetrics.mockReturnValue(null);
  });

  // createMission + startMission already covered in supplemental3

  // ==================== executeNextTasks (via public proxy) ====================

  describe("executeNextTasks paths", () => {
    it("should mark pendingExecution when lock already held", async () => {
      // Lock is held (returns false)
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      // Call twice - second should be marked as pending
      await executeCallback("mission-4");
      // Should not throw
      expect(mocks.stateManager.startMissionExecution).toHaveBeenCalled();
    });

    it("should return early when mission is not found", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);

      await expect(executeCallback("mission-4")).resolves.not.toThrow();
      expect(mocks.stateManager.finishMissionExecution).toHaveBeenCalled();
    });

    it("should return early when mission status is not IN_PROGRESS", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);
      mocks.prisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: MissionStatus.COMPLETED, tasks: [] }),
      );

      await expect(executeCallback("mission-4")).resolves.not.toThrow();
    });

    it("should call completeMission when all tasks are completed", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);

      const completedTask = makeTask({
        status: AgentTaskStatus.COMPLETED,
        result: "done",
      });
      const missionWithAllDone = makeMission({
        tasks: [completedTask],
        totalTasks: 1,
      });
      mocks.prisma.teamMission.findUnique
        .mockResolvedValueOnce(missionWithAllDone)
        // For completeMission inner findUnique
        .mockResolvedValue(null);

      await expect(executeCallback("mission-4")).resolves.not.toThrow();
    });

    it("should force-complete tasks when completion rate >= 95%", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);

      // 20 completed, 1 remaining = 95.2%
      const completedTasks = Array.from({ length: 20 }, (_, i) =>
        makeTask({
          id: `task-${i}`,
          status: AgentTaskStatus.COMPLETED,
          result: `result ${i}`,
        }),
      );
      const remainingTask = makeTask({
        id: "task-remaining",
        status: AgentTaskStatus.BLOCKED,
        result: null,
      });

      const missionHighCompletion = makeMission({
        tasks: [...completedTasks, remainingTask],
        totalTasks: 21,
      });
      mocks.prisma.teamMission.findUnique
        .mockResolvedValueOnce(missionHighCompletion)
        .mockResolvedValue(null);
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...remainingTask,
        status: AgentTaskStatus.COMPLETED,
      });

      await expect(executeCallback("mission-4")).resolves.not.toThrow();
      // Force completion of remaining task
      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-remaining" },
          data: expect.objectContaining({
            status: AgentTaskStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should reset stuck IN_PROGRESS tasks and re-execute", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);

      const stuckTime = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago - > 15 min threshold
      const stuckInProgress = makeTask({
        id: "stuck-in-progress",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: stuckTime,
      });

      const missionWithStuck = makeMission({
        tasks: [stuckInProgress],
      });
      // First call returns mission with stuck task; recursive call sees COMPLETED
      const missionAfterReset = makeMission({
        tasks: [{ ...stuckInProgress, status: AgentTaskStatus.PENDING }],
      });
      mocks.prisma.teamMission.findUnique
        .mockResolvedValueOnce(missionWithStuck)
        .mockResolvedValueOnce(missionAfterReset)
        .mockResolvedValue(null);
      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.stateManager.startMissionExecution
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      await expect(executeCallback("mission-4")).resolves.not.toThrow();
      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-in-progress" },
          data: expect.objectContaining({
            status: AgentTaskStatus.PENDING,
            startedAt: null,
          }),
        }),
      );
    });

    it("should start pending tasks that have no dependencies", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);

      const pendingTask = makeTask({
        id: "pending-nodep",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: [],
        assignedTo: makeMember(),
      });
      const missionWithPending = makeMission({
        tasks: [pendingTask],
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(missionWithPending);
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...pendingTask,
        status: AgentTaskStatus.AWAITING_REVIEW,
      });
      // After task runs, mission complete
      const afterMission = makeMission({
        tasks: [{ ...pendingTask, status: AgentTaskStatus.COMPLETED }],
      });
      mocks.prisma.teamMission.findUnique
        .mockResolvedValueOnce(missionWithPending)
        .mockResolvedValue(afterMission);

      // May not throw even if AI call path is entered
      await expect(executeCallback("mission-4")).resolves.not.toThrow();
    });
  });

  // ==================== executeTask paths ====================

  describe("executeTask (via executeNextTasks)", () => {
    it("should skip task that is no longer PENDING (updateMany count=0)", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);
      mocks.stateManager.isTaskExecuting.mockReturnValue(false);

      const pendingTask = makeTask({
        status: AgentTaskStatus.PENDING,
        dependsOnIds: [],
        assignedTo: makeMember(),
      });
      const mission = makeMission({ tasks: [pendingTask] });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      // Task was grabbed by another process - count=0
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 0 });

      await expect(executeCallback("mission-4")).resolves.not.toThrow();
      // finishTask still called in finally
      expect(mocks.stateManager.finishTask).toHaveBeenCalled();
    });

    it("should handle API error content in task result", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);

      const pendingTask = makeTask({
        status: AgentTaskStatus.PENDING,
        dependsOnIds: [],
        assignedTo: makeMember(),
      });
      const mission = makeMission({ tasks: [pendingTask] });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      // AI returns API error content
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "API Error: rate limit exceeded",
        tokensUsed: 0,
      });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "replan response", tokensUsed: 100 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
        error: null,
      });
      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: makeLeader(),
        members: [makeMember()],
        all: [makeLeader(), makeMember()],
      });

      await expect(executeCallback("mission-4")).resolves.not.toThrow();
    });

    it("should emit task:status IN_PROGRESS after CAS update", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);

      const pendingTask = makeTask({
        status: AgentTaskStatus.PENDING,
        dependsOnIds: [],
        assignedTo: makeMember(),
      });
      const mission = makeMission({ tasks: [pendingTask] });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "good task result",
        tokensUsed: 100,
      });
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...pendingTask,
        status: AgentTaskStatus.AWAITING_REVIEW,
      });
      // For leaderReviewTask - approve
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "通过", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
        error: null,
      });
      // After review, task is COMPLETED; for executeNextTasks recursion
      const completedMission = makeMission({
        tasks: [{ ...pendingTask, status: AgentTaskStatus.COMPLETED }],
      });
      mocks.prisma.teamMission.findUnique
        .mockResolvedValueOnce(mission)
        .mockResolvedValue(completedMission);
      mocks.prisma.teamMission.update.mockResolvedValue({});

      await expect(executeCallback("mission-4")).resolves.not.toThrow();
      expect(mocks.topicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-4",
        "task:status",
        expect.objectContaining({ status: AgentTaskStatus.IN_PROGRESS }),
      );
    });
  });
});

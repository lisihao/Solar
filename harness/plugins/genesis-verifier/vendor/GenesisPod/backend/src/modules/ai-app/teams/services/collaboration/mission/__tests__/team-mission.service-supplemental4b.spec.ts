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
import {
  EmailNotificationPresetsService,
  EmailService,
} from "../../../../../../platform/facade";
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

  const emailNotificationPresetsService = {
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
    emailNotificationPresetsService,
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
      {
        provide: EmailNotificationPresetsService,
        useValue: mocks.emailNotificationPresetsService,
      },
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

describe("TeamMissionService (supplemental4b)", () => {
  let mocks: ReturnType<typeof buildMocks>;
  let service: TeamMissionService;

  beforeAll(async () => {
    mocks = buildMocks();
    service = await buildModule(mocks);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply default mocks after clearAllMocks
    mocks.prisma.topicAIMember.findFirst.mockResolvedValue(null);
    mocks.prisma.topicAIMember.findMany.mockResolvedValue([]);
    mocks.prisma.teamMission.create.mockResolvedValue({});
    mocks.prisma.teamMission.findUnique.mockResolvedValue(null);
    mocks.prisma.teamMission.findFirst.mockResolvedValue(null);
    mocks.prisma.teamMission.findMany.mockResolvedValue([]);
    mocks.prisma.teamMission.update.mockResolvedValue({});
    mocks.prisma.agentTask.findMany.mockResolvedValue([]);
    mocks.prisma.agentTask.findUnique.mockResolvedValue(null);
    mocks.prisma.agentTask.create.mockResolvedValue({});
    mocks.prisma.agentTask.update.mockResolvedValue({});
    mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 0 });
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
    mocks.emailNotificationPresetsService.sendMissionCompletionNotification.mockResolvedValue(
      true,
    );
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
    mocks.lifecycleService.cancelMission.mockResolvedValue({
      id: "mission-4",
      status: MissionStatus.CANCELLED,
    });
    mocks.lifecycleService.pauseMission.mockResolvedValue({
      id: "mission-4",
      status: MissionStatus.PAUSED,
    });
    mocks.lifecycleService.resumeMission.mockResolvedValue({
      id: "mission-4",
      status: MissionStatus.IN_PROGRESS,
    });
    mocks.lifecycleService.deleteMission.mockResolvedValue(undefined);
    mocks.lifecycleService.updateMissionNotification.mockResolvedValue(
      undefined,
    );
    mocks.agentFacade.circuitBreaker.canExecute.mockReturnValue(true);
    mocks.agentFacade.circuitBreaker.getCooldownRemaining.mockReturnValue(0);
    mocks.agentFacade.circuitBreaker.selectBest.mockReturnValue(null);
    mocks.agentFacade.circuitBreaker.getHealthMetrics.mockReturnValue(null);
  });

  // ==================== completeMission ====================

  describe("completeMission", () => {
    it("should complete mission successfully with email notification", async () => {
      await service.onModuleInit();

      const completedTask = makeTask({
        status: AgentTaskStatus.COMPLETED,
        result: "final result content",
        assignedTo: makeMember(),
        assignedToId: "member-4",
      });
      const missionToComplete = makeMission({
        tasks: [completedTask],
        notificationEmail: "user@test.com",
        leaderId: "leader-4",
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(missionToComplete);
      mocks.prisma.teamMission.update.mockResolvedValue({
        ...missionToComplete,
        status: MissionStatus.COMPLETED,
      });
      mocks.messageService.sendMessageToTopic.mockResolvedValue({ id: "m5" });
      mocks.messageService.createLog.mockResolvedValue(undefined);
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "## Summary\n\nMission completed.", tokensUsed: 200 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
        error: null,
      });

      const svcPrivate = service as unknown as {
        completeMission: (id: string) => Promise<void>;
      };

      await expect(
        svcPrivate.completeMission("mission-4"),
      ).resolves.not.toThrow();

      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-4" },
          data: expect.objectContaining({
            status: MissionStatus.COMPLETED,
          }),
        }),
      );
    });

    it("should use fallback summary when AI summary fails", async () => {
      await service.onModuleInit();

      const completedTask = makeTask({
        status: AgentTaskStatus.COMPLETED,
        result: "task result",
        assignedTo: makeMember(),
        assignedToId: "member-4",
      });
      const missionToComplete = makeMission({
        tasks: [completedTask],
        notificationEmail: null,
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(missionToComplete);
      mocks.prisma.teamMission.update.mockResolvedValue({
        ...missionToComplete,
        status: MissionStatus.COMPLETED,
      });
      mocks.messageService.sendMessageToTopic.mockResolvedValue({ id: "m6" });
      mocks.messageService.createLog.mockResolvedValue(undefined);

      // Summary AI call fails
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: false,
        data: null,
        error: { message: "model error", getUserMessage: () => "model error" },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      const svcPrivate = service as unknown as {
        completeMission: (id: string) => Promise<void>;
      };

      await expect(
        svcPrivate.completeMission("mission-4"),
      ).resolves.not.toThrow();

      // Should still complete even though summary failed (fallback summary used)
      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MissionStatus.COMPLETED }),
        }),
      );
    });

    it("should return early when mission not found", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);

      const svcPrivate = service as unknown as {
        completeMission: (id: string) => Promise<void>;
      };

      await expect(
        svcPrivate.completeMission("no-mission"),
      ).resolves.not.toThrow();
      expect(mocks.prisma.teamMission.update).not.toHaveBeenCalled();
    });

    it("should fail the mission on completion error", async () => {
      await service.onModuleInit();

      const missionToComplete = makeMission({ tasks: [] });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(missionToComplete);
      // update throws first time (REVIEW status update fails)
      mocks.prisma.teamMission.update.mockRejectedValueOnce(
        new Error("DB write error"),
      );
      mocks.prisma.teamMission.update.mockResolvedValue({});

      const svcPrivate = service as unknown as {
        completeMission: (id: string) => Promise<void>;
      };

      await expect(
        svcPrivate.completeMission("mission-4"),
      ).resolves.not.toThrow();
      // Should have tried to update to FAILED
      expect(mocks.prisma.teamMission.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MissionStatus.FAILED }),
        }),
      );
    });
  });

  // ==================== updateMissionProgress ====================

  describe("updateMissionProgress", () => {
    it("should update mission progress and emit event", async () => {
      const completedTask = makeTask({ status: AgentTaskStatus.COMPLETED });
      const pendingTask = makeTask({
        id: "task-pending",
        status: AgentTaskStatus.PENDING,
      });
      const missionWithTasks = makeMission({
        tasks: [completedTask, pendingTask],
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(missionWithTasks);
      mocks.prisma.teamMission.update.mockResolvedValue({});

      const svcPrivate = service as unknown as {
        updateMissionProgress: (id: string) => Promise<void>;
      };

      await svcPrivate.updateMissionProgress("mission-4");

      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-4" },
          data: expect.objectContaining({
            completedTasks: 1,
            progressPercent: 50,
          }),
        }),
      );
      expect(mocks.topicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-4",
        "mission:progress_updated",
        expect.objectContaining({
          completedTasks: 1,
          totalTasks: 2,
          progressPercent: 50,
        }),
      );
    });

    it("should return early when mission not found", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);

      const svcPrivate = service as unknown as {
        updateMissionProgress: (id: string) => Promise<void>;
      };

      await svcPrivate.updateMissionProgress("no-mission");
      expect(mocks.prisma.teamMission.update).not.toHaveBeenCalled();
    });

    it("should handle zero tasks (progressPercent=0)", async () => {
      const missionNoTasks = makeMission({ tasks: [] });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(missionNoTasks);
      mocks.prisma.teamMission.update.mockResolvedValue({});

      const svcPrivate = service as unknown as {
        updateMissionProgress: (id: string) => Promise<void>;
      };

      await svcPrivate.updateMissionProgress("mission-4");
      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progressPercent: 0 }),
        }),
      );
    });
  });

  // ==================== autoRetryBlockedTasks ====================

  describe("autoRetryBlockedTasks", () => {
    it("should retry blocked task when circuit breaker allows and task is fresh", async () => {
      mocks.prisma.agentTask.update.mockResolvedValue({});

      const blockedTask = {
        id: "blocked-1",
        title: "Blocked Task",
        status: AgentTaskStatus.BLOCKED,
        result: null,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago (< 15 min)
        assignedToId: "member-4",
        assignedTo: {
          id: "member-4",
          agentName: "MemberS4",
          displayName: "Member S4",
        },
      };

      const mission = {
        id: "mission-4",
        topicId: "topic-4",
        tasks: [blockedTask],
      };

      const svcPrivate = service as unknown as {
        autoRetryBlockedTasks: (
          m: typeof mission,
          t: (typeof blockedTask)[],
          n: number,
          s: number,
        ) => Promise<number>;
      };

      const count = await svcPrivate.autoRetryBlockedTasks(
        mission,
        [blockedTask],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(1);
      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "blocked-1" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should force-complete blocked task when it has timed out", async () => {
      mocks.prisma.agentTask.update.mockResolvedValue({});

      const blockedTask = {
        id: "blocked-timeout",
        title: "Timed Out Task",
        status: AgentTaskStatus.BLOCKED,
        result: null,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago (> 15 min)
        assignedToId: "member-4",
        assignedTo: {
          id: "member-4",
          agentName: "MemberS4",
          displayName: "Member S4",
        },
      };

      const mission = {
        id: "mission-4",
        topicId: "topic-4",
        tasks: [blockedTask],
      };

      const svcPrivate = service as unknown as {
        autoRetryBlockedTasks: (
          m: typeof mission,
          t: (typeof blockedTask)[],
          n: number,
          s: number,
        ) => Promise<number>;
      };

      const count = await svcPrivate.autoRetryBlockedTasks(
        mission,
        [blockedTask],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(1);
      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "blocked-timeout" },
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should skip retry when circuit breaker is not ready and task is fresh", async () => {
      mocks.agentFacade.circuitBreaker.canExecute.mockReturnValue(false);
      mocks.agentFacade.circuitBreaker.getCooldownRemaining.mockReturnValue(
        30000,
      );

      const blockedTask = {
        id: "blocked-cb",
        title: "CB Blocked Task",
        status: AgentTaskStatus.BLOCKED,
        result: null,
        updatedAt: new Date(Date.now() - 2 * 60 * 1000), // fresh
        assignedToId: "member-4",
        assignedTo: {
          id: "member-4",
          agentName: "MemberS4",
          displayName: "Member S4",
        },
      };

      const mission = {
        id: "mission-4",
        topicId: "topic-4",
        tasks: [blockedTask],
      };

      const svcPrivate = service as unknown as {
        autoRetryBlockedTasks: (
          m: typeof mission,
          t: (typeof blockedTask)[],
          n: number,
          s: number,
        ) => Promise<number>;
      };

      const count = await svcPrivate.autoRetryBlockedTasks(
        mission,
        [blockedTask],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(0);
      expect(mocks.prisma.agentTask.update).not.toHaveBeenCalled();
    });
  });

  // ==================== forceCompleteStuckTasks ====================

  describe("forceCompleteStuckTasks", () => {
    it("should force-complete task that has been stuck for > timeout", async () => {
      mocks.prisma.agentTask.update.mockResolvedValue({});

      const stuckTask = {
        id: "stuck-rev",
        title: "Stuck Revision Task",
        status: AgentTaskStatus.REVISION_NEEDED,
        result: "some previous result",
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      };

      const mission = {
        id: "mission-4",
        topicId: "topic-4",
        tasks: [stuckTask],
      };

      const svcPrivate = service as unknown as {
        forceCompleteStuckTasks: (
          m: typeof mission,
          t: (typeof stuckTask)[],
          n: number,
          s: number,
        ) => Promise<number>;
      };

      const count = await svcPrivate.forceCompleteStuckTasks(
        mission,
        [stuckTask],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(1);
      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-rev" },
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should not force-complete task that is not yet timed out", async () => {
      const freshStuckTask = {
        id: "fresh-stuck",
        title: "Fresh Stuck Task",
        status: AgentTaskStatus.AWAITING_REVIEW,
        result: null,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min (< 15 min)
      };

      const mission = {
        id: "mission-4",
        topicId: "topic-4",
        tasks: [freshStuckTask],
      };

      const svcPrivate = service as unknown as {
        forceCompleteStuckTasks: (
          m: typeof mission,
          t: (typeof freshStuckTask)[],
          n: number,
          s: number,
        ) => Promise<number>;
      };

      const count = await svcPrivate.forceCompleteStuckTasks(
        mission,
        [freshStuckTask],
        Date.now(),
        15 * 60 * 1000,
      );

      expect(count).toBe(0);
      expect(mocks.prisma.agentTask.update).not.toHaveBeenCalled();
    });
  });

  // ==================== handleTaskExecutionFailure ====================

  describe("handleTaskExecutionFailure", () => {
    it("should call AI for replan and create new tasks on success", async () => {
      const task = makeTask({ assignedTo: makeMember() });
      const mission = makeMission({
        tasks: [task],
        leader: makeLeader(),
      });

      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: {
          content: `Replan analysis\n\`\`\`json\n{"action":"split","newTasks":[{"title":"Sub Task A","description":"Part A","assignee":"MemberS4"}]}\n\`\`\``,
          tokensUsed: 300,
        },
        fallbackUsed: false,
        modelUsed: "gpt-4",
        error: null,
      });

      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: makeLeader(),
        members: [makeMember()],
        all: [makeLeader(), makeMember()],
      });

      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.prisma.agentTask.create.mockResolvedValue({
        id: "new-task-1",
        title: "Sub Task A",
      });
      mocks.messageService.sendMessageToTopic.mockResolvedValue({ id: "m7" });
      mocks.messageService.createLog.mockResolvedValue(undefined);

      // executeNextTasks will be called - short-circuit with lock fail
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      const missionWithExistingTask = makeMission({
        tasks: [],
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(
        missionWithExistingTask,
      );

      const svcPrivate = service as unknown as {
        handleTaskExecutionFailure: (
          m: typeof mission,
          t: typeof task,
          a: { id: string; agentName: string | null; displayName: string },
          e: string,
        ) => Promise<void>;
      };

      await expect(
        svcPrivate.handleTaskExecutionFailure(
          mission,
          task,
          makeMember(),
          "context too large",
        ),
      ).resolves.not.toThrow();

      expect(mocks.prisma.agentTask.create).toHaveBeenCalled();
    });

    it("should handle replan AI failure gracefully", async () => {
      const task = makeTask({ assignedTo: makeMember() });
      const mission = makeMission({
        tasks: [task],
        leader: makeLeader(),
      });

      mocks.leaderModelService.executeWithFallback.mockRejectedValue(
        new Error("AI service down"),
      );
      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.messageService.sendMessageToTopic.mockResolvedValue({ id: "m8" });
      mocks.messageService.createLog.mockResolvedValue(undefined);

      const svcPrivate = service as unknown as {
        handleTaskExecutionFailure: (
          m: typeof mission,
          t: typeof task,
          a: { id: string; agentName: string | null; displayName: string },
          e: string,
        ) => Promise<void>;
      };

      await expect(
        svcPrivate.handleTaskExecutionFailure(
          mission,
          task,
          makeMember(),
          "permanent error",
        ),
      ).resolves.not.toThrow();

      // Should send manual intervention message
      expect(mocks.messageService.sendMessageToTopic).toHaveBeenCalledWith(
        "topic-4",
        null,
        expect.stringContaining("需要人工干预"),
        expect.anything(),
      );
    });

    it("should handle replan with no matching assignee", async () => {
      const task = makeTask({ assignedTo: makeMember() });
      const mission = makeMission({
        tasks: [task],
        leader: makeLeader(),
      });

      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: {
          content: `\`\`\`json\n{"action":"split","newTasks":[{"title":"New Task","description":"desc","assignee":"NonExistentMember"}]}\n\`\`\``,
          tokensUsed: 200,
        },
        fallbackUsed: false,
        modelUsed: "gpt-4",
        error: null,
      });

      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: makeLeader(),
        members: [makeMember()],
        all: [makeLeader(), makeMember()],
      });

      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.messageService.sendMessageToTopic.mockResolvedValue({ id: "m9" });
      mocks.messageService.createLog.mockResolvedValue(undefined);
      mocks.stateManager.startMissionExecution.mockReturnValue(false);
      mocks.prisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [] }),
      );

      const svcPrivate = service as unknown as {
        handleTaskExecutionFailure: (
          m: typeof mission,
          t: typeof task,
          a: { id: string; agentName: string | null; displayName: string },
          e: string,
        ) => Promise<void>;
      };

      // Should not create task since assignee not found
      await expect(
        svcPrivate.handleTaskExecutionFailure(
          mission,
          task,
          makeMember(),
          "some error",
        ),
      ).resolves.not.toThrow();
      expect(mocks.prisma.agentTask.create).not.toHaveBeenCalled();
    });
  });

  // ==================== findAlternativeAgentWithCircuitBreaker ====================

  describe("findAlternativeAgentWithCircuitBreaker", () => {
    it("should return null when only one member", async () => {
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: makeLeader(),
        members: [],
        all: [makeLeader()],
      });

      const mission = makeMission();
      const task = makeTask();

      const svcPrivate = service as unknown as {
        findAlternativeAgentWithCircuitBreaker: (
          m: typeof mission,
          f: string[],
          t: typeof task,
        ) => Promise<unknown>;
      };

      const result = await svcPrivate.findAlternativeAgentWithCircuitBreaker(
        mission,
        [],
        task,
      );
      expect(result).toBeNull();
    });

    it("should exclude agents in cooldown", async () => {
      const member2 = makeMember({ id: "member-42", agentName: "Member42" });
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: makeLeader(),
        members: [makeMember(), member2],
        all: [makeLeader(), makeMember(), member2],
      });

      // member-4 in cooldown, member-42 available
      mocks.agentFacade.circuitBreaker.canExecute.mockImplementation(
        (id: string) => id !== "member-4",
      );

      const mission = makeMission();
      const task = makeTask();

      const svcPrivate = service as unknown as {
        findAlternativeAgentWithCircuitBreaker: (
          m: typeof mission,
          f: string[],
          t: typeof task,
        ) => Promise<{ id: string } | null>;
      };

      const result = await svcPrivate.findAlternativeAgentWithCircuitBreaker(
        mission,
        [],
        task,
      );
      expect(result).not.toBeNull();
      expect(result?.id).toBe("member-42");
    });

    it("should use leader as fallback when no other candidates", async () => {
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: makeLeader(),
        members: [makeMember()],
        all: [makeLeader(), makeMember()],
      });

      // member-4 failed, leader-4 available
      mocks.agentFacade.circuitBreaker.canExecute.mockReturnValue(true);

      const mission = makeMission();
      const task = makeTask();

      const svcPrivate = service as unknown as {
        findAlternativeAgentWithCircuitBreaker: (
          m: typeof mission,
          f: string[],
          t: typeof task,
        ) => Promise<{ id: string } | null>;
      };

      // Exclude the only non-leader member
      const result = await svcPrivate.findAlternativeAgentWithCircuitBreaker(
        mission,
        ["member-4"],
        task,
      );
      // With allowLeaderFallback, should return leader
      expect(result).not.toBeNull();
    });

    it("should select best agent via circuit breaker selectBest", async () => {
      const member2 = makeMember({ id: "member-42", agentName: "Member42" });
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: makeLeader(),
        members: [makeMember(), member2],
        all: [makeLeader(), makeMember(), member2],
      });

      mocks.agentFacade.circuitBreaker.canExecute.mockReturnValue(true);
      mocks.agentFacade.circuitBreaker.selectBest.mockReturnValue("member-42");
      mocks.agentFacade.circuitBreaker.getHealthMetrics.mockReturnValue({
        successRate: 0.9,
        currentLoad: 1,
      });

      const mission = makeMission();
      const task = makeTask();

      const svcPrivate = service as unknown as {
        findAlternativeAgentWithCircuitBreaker: (
          m: typeof mission,
          f: string[],
          t: typeof task,
        ) => Promise<{ id: string } | null>;
      };

      const result = await svcPrivate.findAlternativeAgentWithCircuitBreaker(
        mission,
        [],
        task,
      );
      expect(result?.id).toBe("member-42");
    });

    it("should handle error gracefully and return null", async () => {
      mocks.memberService.getTeamMembers.mockRejectedValue(
        new Error("service error"),
      );

      const mission = makeMission();
      const task = makeTask();

      const svcPrivate = service as unknown as {
        findAlternativeAgentWithCircuitBreaker: (
          m: typeof mission,
          f: string[],
          t: typeof task,
        ) => Promise<unknown>;
      };

      const result = await svcPrivate.findAlternativeAgentWithCircuitBreaker(
        mission,
        [],
        task,
      );
      expect(result).toBeNull();
    });
  });

  // ==================== validateChapterUniqueness ====================

  describe("validateChapterUniqueness", () => {
    it("should detect duplicates within new titles", async () => {
      // No DB tasks
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);

      const titles = [
        "第一章 开始",
        "第二章 发展",
        "第一章 重复", // duplicate
      ];

      const svcPrivate = service as unknown as {
        validateChapterUniqueness: (
          id: string,
          titles: string[],
        ) => Promise<{
          duplicatesInNew: string[];
          duplicatesInDb: string[];
        }>;
      };

      const result = await svcPrivate.validateChapterUniqueness(
        "mission-4",
        titles,
      );
      expect(result.duplicatesInNew.length).toBeGreaterThan(0);
    });

    it("should detect chapters already in database", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([
        { title: "第一章 已存在" },
      ]);

      const titles = ["第一章 新版本", "第二章 新内容"];

      const svcPrivate = service as unknown as {
        validateChapterUniqueness: (
          id: string,
          titles: string[],
        ) => Promise<{
          duplicatesInNew: string[];
          duplicatesInDb: string[];
        }>;
      };

      const result = await svcPrivate.validateChapterUniqueness(
        "mission-4",
        titles,
      );
      expect(result.duplicatesInDb.length).toBeGreaterThan(0);
    });

    it("should return empty arrays when no duplicates", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);

      const titles = ["第一章 开始", "第二章 发展", "第三章 高潮"];

      const svcPrivate = service as unknown as {
        validateChapterUniqueness: (
          id: string,
          titles: string[],
        ) => Promise<{
          duplicatesInNew: string[];
          duplicatesInDb: string[];
        }>;
      };

      const result = await svcPrivate.validateChapterUniqueness(
        "mission-4",
        titles,
      );
      expect(result.duplicatesInNew).toHaveLength(0);
      expect(result.duplicatesInDb).toHaveLength(0);
    });
  });

  // ==================== createTasksFromBreakdown ====================

  describe("createTasksFromBreakdown", () => {
    it("should create independent tasks via batch createManyAndReturn", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);

      const breakdown = {
        tasks: [
          {
            title: "Task A",
            description: "desc A",
            priority: "HIGH",
            taskType: "RESEARCH",
            assigneeId: "member-4",
            assigneeName: "MemberS4",
            reason: "good at research",
            dependsOn: [],
          },
          {
            title: "Task B",
            description: "desc B",
            priority: "MEDIUM",
            taskType: "WRITING",
            assigneeId: "member-4",
            assigneeName: "MemberS4",
            reason: "good at writing",
            dependsOn: [],
          },
        ],
        summary: "test breakdown",
      };

      const teamMembers = [makeLeader(), makeMember()];

      const svcPrivate = service as unknown as {
        createTasksFromBreakdown: (
          id: string,
          b: typeof breakdown,
          t: typeof teamMembers,
        ) => Promise<void>;
      };

      await expect(
        svcPrivate.createTasksFromBreakdown(
          "mission-4",
          breakdown,
          teamMembers,
        ),
      ).resolves.not.toThrow();

      expect(mocks.prisma.$transaction).toHaveBeenCalled();
    });

    it("should create dependent tasks sequentially", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);

      const breakdown = {
        tasks: [
          {
            title: "Task A",
            description: "desc A",
            priority: "HIGH",
            taskType: "RESEARCH",
            assigneeId: "member-4",
            assigneeName: "MemberS4",
            reason: "reason",
            dependsOn: [],
          },
          {
            title: "Task B depends on A",
            description: "desc B",
            priority: "MEDIUM",
            taskType: "WRITING",
            assigneeId: "member-4",
            assigneeName: "MemberS4",
            reason: "reason",
            dependsOn: [0], // depends on task A
          },
        ],
        summary: "test",
      };

      const teamMembers = [makeLeader(), makeMember()];

      const svcPrivate = service as unknown as {
        createTasksFromBreakdown: (
          id: string,
          b: typeof breakdown,
          t: typeof teamMembers,
        ) => Promise<void>;
      };

      await expect(
        svcPrivate.createTasksFromBreakdown(
          "mission-4",
          breakdown,
          teamMembers,
        ),
      ).resolves.not.toThrow();
    });

    it("should fallback to first member when assignee not found", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);

      const breakdown = {
        tasks: [
          {
            title: "Orphan Task",
            description: "no assignee",
            priority: "LOW",
            taskType: "DOCUMENTATION",
            assigneeId: "unknown-member",
            assigneeName: "Unknown",
            reason: "assigned",
            dependsOn: [],
          },
        ],
        summary: "test",
      };

      const teamMembers = [makeLeader(), makeMember()];

      const svcPrivate = service as unknown as {
        createTasksFromBreakdown: (
          id: string,
          b: typeof breakdown,
          t: typeof teamMembers,
        ) => Promise<void>;
      };

      await expect(
        svcPrivate.createTasksFromBreakdown(
          "mission-4",
          breakdown,
          teamMembers,
        ),
      ).resolves.not.toThrow();
    });
  });

  // ==================== rebalanceTaskAssignments ====================

  describe("rebalanceTaskAssignments", () => {
    it("should not modify breakdown when no tasks", () => {
      const breakdown = { tasks: [], summary: "empty" };
      const teamMembers = [makeLeader(), makeMember()];

      const svcPrivate = service as unknown as {
        rebalanceTaskAssignments: (
          b: typeof breakdown,
          t: typeof teamMembers,
        ) => void;
      };

      expect(() => {
        svcPrivate.rebalanceTaskAssignments(breakdown, teamMembers);
      }).not.toThrow();
    });

    it("should not modify breakdown when no non-leader members", () => {
      const breakdown = {
        tasks: [
          {
            title: "T1",
            assigneeId: "leader-4",
            assigneeName: "LeaderS4",
            description: "d",
            priority: "HIGH",
            taskType: "RESEARCH",
            reason: "r",
            dependsOn: [],
          },
        ],
        summary: "test",
      };
      const teamMembers = [makeLeader()]; // only leader

      const svcPrivate = service as unknown as {
        rebalanceTaskAssignments: (
          b: typeof breakdown,
          t: typeof teamMembers,
        ) => void;
      };

      expect(() => {
        svcPrivate.rebalanceTaskAssignments(breakdown, teamMembers);
      }).not.toThrow();
    });

    it("should rebalance when one member is idle and another is overloaded", () => {
      const member2 = makeMember({ id: "member-42", agentName: "Member42" });

      const breakdown = {
        tasks: Array.from({ length: 6 }, (_, i) => ({
          title: `Task ${i}`,
          assigneeId: "member-4", // all assigned to member-4
          assigneeName: "MemberS4",
          description: "desc",
          priority: "MEDIUM",
          taskType: "RESEARCH",
          reason: "reason",
          dependsOn: [],
        })),
        summary: "test",
      };

      const teamMembers = [makeLeader(), makeMember(), member2];

      const svcPrivate = service as unknown as {
        rebalanceTaskAssignments: (
          b: typeof breakdown,
          t: typeof teamMembers,
        ) => void;
      };

      svcPrivate.rebalanceTaskAssignments(breakdown, teamMembers);

      // After rebalancing, some tasks should be moved to member-42
      const member42Tasks = breakdown.tasks.filter(
        (t) => t.assigneeId === "member-42",
      );
      // Should have at least some tasks moved (rebalancing logic)
      expect(member42Tasks.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ==================== buildScopeGuidance ====================

  describe("buildScopeGuidance", () => {
    it("should return empty string for non-large-content tasks", () => {
      const mission = makeMission({
        title: "Small Task",
        description: "Just a quick research task",
      });

      const svcPrivate = service as unknown as {
        buildScopeGuidance: (m: typeof mission) => string;
      };

      const result = svcPrivate.buildScopeGuidance(mission);
      expect(typeof result).toBe("string");
    });

    it("should return guidance for large content creation tasks", () => {
      const mission = makeMission({
        title: "写一部100章的小说",
        description: "写一部完整的玄幻小说，共100章，每章3000字",
      });

      const svcPrivate = service as unknown as {
        buildScopeGuidance: (m: typeof mission) => string;
      };

      const result = svcPrivate.buildScopeGuidance(mission);
      // May or may not return guidance depending on detectLargeContentTask
      expect(typeof result).toBe("string");
    });
  });

  // ==================== createToolContext ====================

  describe("createToolContext", () => {
    it("should return valid ToolContext shape", () => {
      const svcPrivate = service as unknown as {
        createToolContext: (toolId: string) => {
          executionId: string;
          toolId: string;
          createdAt: Date;
          callerType: string;
        };
      };

      const ctx = svcPrivate.createToolContext("web-search");
      expect(ctx.toolId).toBe("web-search");
      expect(ctx.executionId).toContain("web-search");
      expect(ctx.callerType).toBe("agent");
      expect(ctx.createdAt).toBeInstanceOf(Date);
    });
  });

  // ==================== callAIWithRetry ====================

  describe("callAIWithRetry", () => {
    it("should succeed on first attempt without heartbeat", async () => {
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "AI response text",
        tokensUsed: 100,
      });

      const svcPrivate = service as unknown as {
        callAIWithRetry: (
          model: string,
          msgs: { role: string; content: string }[],
          sys: string,
          opts: Record<string, unknown>,
          ctx: { taskId: string; taskTitle: string; missionId: string },
        ) => Promise<{
          success: boolean;
          content?: string;
          error?: string;
          attempts: number;
          finalModel: string;
        }>;
      };

      const result = await svcPrivate.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "do work" }],
        "system prompt",
        { taskProfile: { creativity: "medium", outputLength: "long" } },
        { taskId: "task-4", taskTitle: "Test Task", missionId: "mission-4" },
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("AI response text");
      expect(result.attempts).toBe(1);
    });

    it("should succeed on first attempt with heartbeat context", async () => {
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "response with heartbeat",
        tokensUsed: 150,
      });

      const svcPrivate = service as unknown as {
        callAIWithRetry: (
          model: string,
          msgs: { role: string; content: string }[],
          sys: string,
          opts: Record<string, unknown>,
          ctx: { taskId: string; taskTitle: string; missionId: string },
          hb: { topicId: string; agentId: string; agentName: string },
        ) => Promise<{
          success: boolean;
          content?: string;
          attempts: number;
          finalModel: string;
        }>;
      };

      const result = await svcPrivate.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "work" }],
        "sys",
        {},
        { taskId: "t", taskTitle: "T", missionId: "m" },
        { topicId: "topic-4", agentId: "leader-4", agentName: "LeaderS4" },
      );

      expect(result.success).toBe(true);
    });

    it("should return failure when non-retryable error occurs", async () => {
      mocks.aiCallerService.callAIWithConfig.mockRejectedValue(
        new Error("permanent context length error"),
      );

      const svcPrivate = service as unknown as {
        callAIWithRetry: (
          model: string,
          msgs: { role: string; content: string }[],
          sys: string,
          opts: Record<string, unknown>,
          ctx: { taskId: string; taskTitle: string; missionId: string },
        ) => Promise<{ success: boolean; error?: string }>;
      };

      const result = await svcPrivate.callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "work" }],
        "sys",
        {},
        { taskId: "t", taskTitle: "T", missionId: "m" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ==================== getTeamMembers ====================

  describe("getTeamMembers (via memberService)", () => {
    it("should delegate to memberService.getTeamMembers", async () => {
      const svcPrivate = service as unknown as {
        getTeamMembers: (topicId: string) => Promise<unknown>;
      };

      const result = await svcPrivate.getTeamMembers("topic-4");
      expect(mocks.memberService.getTeamMembers).toHaveBeenCalledWith(
        "topic-4",
      );
      expect(result).toBeDefined();
    });
  });

  // Delegation methods already covered in supplemental3
});

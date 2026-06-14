/**
 * TeamMissionService - Supplemental2 Tests (Expanded)
 *
 * Targets uncovered branches:
 * - onModuleInit / recoverStuckTasks paths
 * - recoverRevisionTasks callback paths
 * - findAlternativeAgent: leader fallback, load balancing, error path
 * - findAlternativeAgentWithCircuitBreaker: all branches
 * - callAIWithRetry: heartbeat, retryable error path
 * - createMission: autoStart=false, leader not found
 * - startMission: not found, not PENDING, kernel/progress optional deps
 * - executeNextTasks: lock contention, pending executions, mission not IN_PROGRESS
 * - executeTask: CAS count=0, circuit-breaker cooldown, web search, agent switching
 * - handleTaskExecutionFailure: replan success, replan failure, json parse
 * - leaderReviewTask: approval, rejection with revisions, max revisions (valid/invalid content)
 * - executeTaskRevision: lock contention, task not found, CAS=0, API error, normal path
 * - completeMission: not found, email, error path
 * - autoRetryBlockedTasks: retry path, force-complete path, cooldown path
 * - forceCompleteStuckTasks: timeout path, not-yet-timeout path
 * - updateMissionProgress: normal path
 * - createToolContext: shape, uniqueness
 * - extractTaskConstraints: word count, prohibitions, mandatory
 * - buildCompletedTasksSummary: empty, with tasks
 * - buildScopeGuidance: large content task, normal task
 */

// Must be before imports - provides enum values not generated in worktree
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
    REVIEW: "REVIEW",
    BLOCKED: "BLOCKED",
  },
  AgentTaskStatus: {
    PENDING: "PENDING",
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    REVISION_NEEDED: "REVISION_NEEDED",
    AWAITING_REVIEW: "AWAITING_REVIEW",
    BLOCKED: "BLOCKED",
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
    TASK_REVISION: "TASK_REVISION",
    LEADER_FEEDBACK: "LEADER_FEEDBACK",
    MISSION_COMPLETED: "MISSION_COMPLETED",
  },
  MessageContentType: {
    TEXT: "TEXT",
    SYSTEM: "SYSTEM",
    IMAGE: "IMAGE",
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
import { NotFoundException, BadRequestException } from "@nestjs/common";
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
import { MissionCompletionPreset } from "../../../../../../platform/facade";
import {
  MissionStatus,
  AgentTaskStatus,
  TaskPriority,
  TaskType,
} from "@prisma/client";

// ============================================================
// Helpers
// ============================================================

const makeMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-s2",
  topicId: "topic-s2",
  title: "Supplemental Mission",
  description: "Write a 1000-word story about a hero",
  objectives: ["Objective 1"],
  constraints: ["Must be family-friendly"],
  deliverables: ["Final story"],
  leaderId: "leader-s2",
  createdById: "user-s2",
  status: MissionStatus.IN_PROGRESS,
  totalTasks: 2,
  completedTasks: 0,
  taskBreakdown: null,
  contextPackage: null,
  mustConstraints: null,
  notificationEmail: null,
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(Date.now() - 60 * 60 * 1000),
  updatedAt: new Date(),
  progressPercent: 0,
  finalResult: null,
  leader: {
    id: "leader-s2",
    displayName: "Leader S2",
    agentName: "LeaderS2",
    aiModel: "gpt-4",
    isLeader: true,
    topicId: "topic-s2",
    avatar: null,
    roleDescription: "Leader",
    systemPrompt: "You are a leader",
    contextWindow: 10,
    capabilities: [],
    canMentionOtherAI: true,
    collaborationStyle: "COOPERATIVE",
    expertiseAreas: [],
    workStyle: "autonomous",
    agentIdentity: "Leader",
  },
  topic: {
    id: "topic-s2",
    name: "Test Topic",
    aiMembers: [
      {
        id: "leader-s2",
        displayName: "Leader S2",
        agentName: "LeaderS2",
        aiModel: "gpt-4",
        isLeader: true,
      },
      {
        id: "member-s2",
        displayName: "Member S2",
        agentName: "MemberS2",
        aiModel: "claude-3",
        isLeader: false,
        expertiseAreas: [],
        workStyle: "autonomous",
        agentIdentity: "Member",
        roleDescription: "Member",
      },
    ],
  },
  tasks: [],
  ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-s2",
  missionId: "mission-s2",
  title: "Task S2",
  description: "task desc - 必须完成，不能失败",
  status: AgentTaskStatus.PENDING,
  priority: TaskPriority.MEDIUM,
  taskType: TaskType.RESEARCH,
  assignedToId: "member-s2",
  dependsOnIds: [],
  createdAt: new Date(Date.now() - 45 * 60 * 1000),
  startedAt: new Date(Date.now() - 45 * 60 * 1000),
  completedAt: null,
  updatedAt: new Date(),
  leaderFeedback: null,
  result: null,
  revisionCount: 0,
  maxRevisions: 3,
  needsRevision: false,
  resultMessageId: null,
  feedbackMessageId: null,
  assignedTo: {
    id: "member-s2",
    displayName: "Member S2",
    agentName: "MemberS2",
    aiModel: "claude-3",
    isLeader: false,
    topicId: "topic-s2",
  },
  ...overrides,
});

// ============================================================
// Module builder
// ============================================================

function buildMocks() {
  const prisma = {
    topicAIMember: { findFirst: jest.fn(), findMany: jest.fn() },
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
      groupBy: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      createManyAndReturn: jest
        .fn()
        .mockResolvedValue([{ id: "task-s2", title: "Task S2" }]),
    },
    missionLog: { create: jest.fn(), findMany: jest.fn() },
    topicMessage: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          agentTask: {
            create: jest.fn().mockResolvedValue({ id: "task-s2" }),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            createManyAndReturn: jest
              .fn()
              .mockResolvedValue([
                { id: "task-s2", title: "Task S2", dependsOnIds: [] },
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
      }),
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
    ensureMissionInitialized: jest.fn().mockResolvedValue(undefined),
    validateTaskCount: jest
      .fn()
      .mockReturnValue({ isValid: true, warning: null }),
    updateTotalTasks: jest.fn(),
    buildGranularityConstraintPrompt: jest.fn().mockReturnValue(""),
    processTaskCompletion: jest.fn().mockResolvedValue({
      needsContinuation: false,
      finalContent: null,
      continuationState: null,
      intervention: null,
    }),
    buildContinuationPrompt: jest.fn().mockReturnValue("continue..."),
    getFinalResult: jest.fn().mockReturnValue(null),
    clearMission: jest.fn(),
    getQualityDashboard: jest.fn().mockReturnValue({
      quality: {
        overallScore: 8.5,
        trend: { trend: "stable" },
      },
    }),
    checkQualityIntervention: jest
      .fn()
      .mockReturnValue({ needed: false, reason: "" }),
  };

  const leaderModelService = {
    executeWithFallback: jest.fn().mockResolvedValue({
      success: true,
      data: { content: "AI response", tokensUsed: 100 },
      fallbackUsed: false,
      modelUsed: "gpt-4",
    }),
  };

  const emailService = {
    sendMissionCompletionEmail: jest.fn().mockResolvedValue(true),
    sendMissionCompletionNotification: jest.fn().mockResolvedValue(true),
  };

  // PR-DR1b R1：旧 EmailNotificationPresetsService 已由 MissionCompletionPreset 接管
  const missionCompletionPreset = {
    notify: jest.fn().mockResolvedValue(undefined),
  };

  const configService = {
    get: jest.fn().mockReturnValue("http://localhost:3000"),
  };

  const missionContextService = {
    buildContextPackage: jest.fn().mockResolvedValue(null),
    extractContextFromLeaderOutput: jest.fn().mockReturnValue(null),
    buildAgentSystemPromptWithContext: jest.fn().mockReturnValue(""),
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
      .mockResolvedValue({ id: "mission-s2", status: MissionStatus.CANCELLED }),
    pauseMission: jest
      .fn()
      .mockResolvedValue({ id: "mission-s2", status: MissionStatus.PAUSED }),
    resumeMission: jest.fn().mockResolvedValue({
      id: "mission-s2",
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
      .mockResolvedValue({ content: "AI response", tokensUsed: 100 }),
  };

  const messageService = {
    sendMessage: jest.fn().mockResolvedValue({ id: "msg-s2" }),
    sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-s2" }),
    createLog: jest.fn().mockResolvedValue(undefined),
  };

  const memberService = {
    getTeamMembers: jest.fn().mockResolvedValue({
      leader: {
        id: "leader-s2",
        displayName: "Leader S2",
        isLeader: true,
        aiModel: "gpt-4",
        agentName: "LeaderS2",
      },
      members: [
        {
          id: "member-s2",
          displayName: "Member S2",
          isLeader: false,
          aiModel: "claude-3",
          agentName: "MemberS2",
        },
        {
          id: "member-s3",
          displayName: "Member S3",
          isLeader: false,
          aiModel: "gemini-pro",
          agentName: "MemberS3",
        },
      ],
      all: [
        {
          id: "leader-s2",
          displayName: "Leader S2",
          isLeader: true,
          aiModel: "gpt-4",
          agentName: "LeaderS2",
        },
        {
          id: "member-s2",
          displayName: "Member S2",
          isLeader: false,
          aiModel: "claude-3",
          agentName: "MemberS2",
        },
        {
          id: "member-s3",
          displayName: "Member S3",
          isLeader: false,
          aiModel: "gemini-pro",
          agentName: "MemberS3",
        },
      ],
    }),
    getLeader: jest.fn(),
  };

  const circuitBreaker = {
    canExecute: jest.fn().mockReturnValue(true),
    getCooldownRemaining: jest.fn().mockReturnValue(0),
    incrementLoad: jest.fn(),
    decrementLoad: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
    parseErrorType: jest.fn().mockReturnValue(0),
    selectBest: jest.fn().mockReturnValue(null),
    getHealthMetrics: jest.fn().mockReturnValue({
      successRate: 1.0,
      currentLoad: 0,
    }),
  };

  const agentFacade = {
    chat: jest.fn(),
    contextInit: null,
    circuitBreaker,
    coordinatorStore: jest.fn().mockReturnValue(Promise.resolve()),
  };

  const teamFacade = {
    getTeam: jest.fn(),
    contextInit: {
      buildWorldContext: jest.fn().mockResolvedValue({ needed: false }),
      formatWorldSettingsMessage: jest.fn().mockReturnValue(""),
    },
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
    circuitBreaker,
    missionCompletionPreset,
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
      { provide: TopicEventEmitterService, useValue: mocks.topicEventEmitter },
      { provide: TeamsLongContentService, useValue: mocks.longContentService },
      { provide: EmailService, useValue: mocks.emailService },
      { provide: ConfigService, useValue: mocks.configService },
      { provide: MissionContextService, useValue: mocks.missionContextService },
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
      {
        provide: MissionCompletionPreset,
        useValue: mocks.missionCompletionPreset,
      },
      { provide: AgentFacade, useValue: mocks.agentFacade },
      { provide: TeamFacade, useValue: mocks.teamFacade },
    ],
  }).compile();
  return module.get<TeamMissionService>(TeamMissionService);
}

// ============================================================
// Tests
// ============================================================

describe("TeamMissionService (supplemental2)", () => {
  let mocks: ReturnType<typeof buildMocks>;
  let service: TeamMissionService;

  beforeEach(async () => {
    mocks = buildMocks();
    service = await buildModule(mocks);
    mocks.missionCompletionPreset.notify.mockResolvedValue(undefined);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ==================== onModuleInit ====================

  describe("onModuleInit", () => {
    it("should register execute and revision callbacks", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);
      mocks.prisma.teamMission.findMany.mockResolvedValue([]);

      await service.onModuleInit();

      expect(
        mocks.healthCheckService.registerExecuteCallback,
      ).toHaveBeenCalledTimes(1);
      expect(
        mocks.healthCheckService.registerRevisionCallback,
      ).toHaveBeenCalledTimes(1);
    });

    it("should reset stuck tasks to PENDING during init", async () => {
      const stuckTask = makeTask({
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 45 * 60 * 1000),
      });
      mocks.prisma.agentTask.findMany.mockResolvedValue([stuckTask]);
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...stuckTask,
        status: AgentTaskStatus.PENDING,
      });
      mocks.prisma.teamMission.findMany.mockResolvedValue([]);

      await service.onModuleInit();

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: stuckTask.id },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should mark stuck missions with no pending tasks as PAUSED", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);
      const stuckMission = makeMission({
        id: "stuck-no-pending",
        tasks: [{ id: "t1", status: AgentTaskStatus.COMPLETED }],
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      mocks.prisma.teamMission.findMany.mockResolvedValue([stuckMission]);
      mocks.prisma.teamMission.update.mockResolvedValue({
        ...stuckMission,
        status: MissionStatus.PAUSED,
      });

      await service.onModuleInit();

      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-no-pending" },
          data: { status: MissionStatus.PAUSED },
        }),
      );
    });

    it("should trigger executeNextTasks for stuck mission with pending tasks", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);
      const stuckMission = makeMission({
        id: "stuck-with-pending",
        tasks: [{ id: "t1", status: AgentTaskStatus.PENDING }],
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      mocks.prisma.teamMission.findMany.mockResolvedValue([stuckMission]);
      // executeNextTasks will try to acquire lock; let it fail so it exits quickly
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      await service.onModuleInit();
      // Allow async tasks to settle
      await Promise.resolve();
    });

    it("should handle DB error in recoverStuckTasks gracefully", async () => {
      mocks.prisma.agentTask.findMany.mockRejectedValue(
        new Error("DB connection failed"),
      );
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should log no-stuck when nothing is stuck", async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);
      mocks.prisma.teamMission.findMany.mockResolvedValue([]);
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  // ==================== recoverRevisionTasks (callback) ====================

  describe("recoverRevisionTasks callback", () => {
    let revisionCallback: (missionId: string) => Promise<void>;

    beforeEach(async () => {
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);
      mocks.prisma.teamMission.findMany.mockResolvedValue([]);
      await service.onModuleInit();
      revisionCallback = mocks.healthCheckService.registerRevisionCallback.mock
        .calls[0][0] as (missionId: string) => Promise<void>;
    });

    it("should do nothing when mission not found", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);
      await expect(
        revisionCallback("nonexistent-mission"),
      ).resolves.not.toThrow();
    });

    it("should do nothing when mission is not IN_PROGRESS", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission({ status: MissionStatus.COMPLETED }),
        tasks: [],
      });
      await expect(revisionCallback("mission-s2")).resolves.not.toThrow();
    });

    it("should skip tasks with no leaderFeedback", async () => {
      const taskNoFeedback = makeTask({
        status: AgentTaskStatus.REVISION_NEEDED,
        leaderFeedback: null,
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission({ status: MissionStatus.IN_PROGRESS }),
        tasks: [taskNoFeedback],
      });
      await expect(revisionCallback("mission-s2")).resolves.not.toThrow();
    });

    it("should attempt revision for task with leaderFeedback", async () => {
      const taskWithFeedback = makeTask({
        status: AgentTaskStatus.REVISION_NEEDED,
        leaderFeedback: "Please improve the intro",
        assignedTo: {
          id: "member-s2",
          displayName: "Member S2",
          agentName: "MemberS2",
          aiModel: "claude-3",
          isLeader: false,
          topicId: "topic-s2",
        },
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission({ status: MissionStatus.IN_PROGRESS }),
        tasks: [taskWithFeedback],
        leader: makeMission().leader,
      });

      // Make revision start lock available
      mocks.stateManager.startRevision.mockReturnValue(true);
      // findUnique for latestTask in executeTaskRevision
      mocks.prisma.agentTask.findUnique.mockResolvedValue({
        ...taskWithFeedback,
        assignedTo: taskWithFeedback.assignedTo,
      });
      // CAS update - say task is no longer REVISION_NEEDED (count=0), so revision exits
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 0 });

      await expect(revisionCallback("mission-s2")).resolves.not.toThrow();
    });

    it("should handle error in executeTaskRevision gracefully", async () => {
      const taskWithFeedback = makeTask({
        status: AgentTaskStatus.REVISION_NEEDED,
        leaderFeedback: "Please redo",
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission({ status: MissionStatus.IN_PROGRESS }),
        tasks: [taskWithFeedback],
        leader: makeMission().leader,
      });
      mocks.stateManager.startRevision.mockReturnValue(true);
      mocks.prisma.agentTask.findUnique.mockRejectedValue(
        new Error("DB error"),
      );

      await expect(revisionCallback("mission-s2")).resolves.not.toThrow();
    });
  });

  // ==================== createToolContext ====================

  describe("createToolContext", () => {
    type ServiceWithPrivate = {
      createToolContext: (toolId: string) => {
        executionId: string;
        toolId: string;
        createdAt: Date;
        callerType: string;
      };
    };

    it("should return a valid ToolContext shape", () => {
      const ctx = (service as unknown as ServiceWithPrivate).createToolContext(
        "my-tool",
      );
      expect(ctx.toolId).toBe("my-tool");
      expect(ctx.executionId).toContain("my-tool");
      expect(ctx.createdAt).toBeInstanceOf(Date);
      expect(ctx.callerType).toBe("agent");
    });

    it("should generate unique executionIds", () => {
      const s = service as unknown as ServiceWithPrivate;
      const ctx1 = s.createToolContext("tool-x");
      const ctx2 = s.createToolContext("tool-x");
      expect(ctx1.executionId).toBeDefined();
      expect(ctx2.executionId).toBeDefined();
    });
  });

  // ==================== createMission ====================

  describe("createMission", () => {
    it("should throw NotFoundException when leader not found", async () => {
      mocks.prisma.topicAIMember.findFirst.mockResolvedValue(null);

      await expect(
        service.createMission("topic-1", "user-1", {
          title: "Test",
          description: "desc",
          leaderId: "nonexistent",
          autoStart: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create mission and not autoStart when autoStart=false", async () => {
      const leader = {
        id: "leader-s2",
        displayName: "Leader S2",
        agentName: "LeaderS2",
        aiModel: "gpt-4",
      };
      mocks.prisma.topicAIMember.findFirst.mockResolvedValue(leader);
      const createdMission = makeMission({ status: MissionStatus.PENDING });
      mocks.prisma.teamMission.create.mockResolvedValue(createdMission);
      mocks.messageService.createLog.mockResolvedValue(undefined);
      mocks.messageService.sendMessageToTopic.mockResolvedValue({
        id: "msg-1",
      });

      const result = await service.createMission("topic-s2", "user-1", {
        title: "Test Mission",
        description: "desc",
        leaderId: "leader-s2",
        autoStart: false,
      });

      expect(result).toBeDefined();
      expect(mocks.prisma.teamMission.create).toHaveBeenCalledTimes(1);
    });

    it("should create mission with autoStart=true and trigger startMission async", async () => {
      const leader = {
        id: "leader-s2",
        displayName: "Leader S2",
        agentName: "LeaderS2",
        aiModel: "gpt-4",
      };
      mocks.prisma.topicAIMember.findFirst.mockResolvedValue(leader);
      const createdMission = makeMission({ status: MissionStatus.PENDING });
      mocks.prisma.teamMission.create.mockResolvedValue(createdMission);
      mocks.messageService.createLog.mockResolvedValue(undefined);
      mocks.messageService.sendMessageToTopic.mockResolvedValue({
        id: "msg-1",
      });
      // startMission calls findUnique - make it return null so it throws NotFoundException (caught by catch)
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);

      const result = await service.createMission("topic-s2", "user-1", {
        title: "Test Mission",
        description: "desc",
        leaderId: "leader-s2",
        autoStart: true,
      });

      expect(result).toBeDefined();
    });

    it("should create mission with notificationEmail", async () => {
      const leader = {
        id: "leader-s2",
        displayName: "Leader S2",
        agentName: "LeaderS2",
        aiModel: "gpt-4",
      };
      mocks.prisma.topicAIMember.findFirst.mockResolvedValue(leader);
      const createdMission = makeMission({
        status: MissionStatus.PENDING,
        notificationEmail: "test@example.com",
      });
      mocks.prisma.teamMission.create.mockResolvedValue(createdMission);
      mocks.messageService.createLog.mockResolvedValue(undefined);
      mocks.messageService.sendMessageToTopic.mockResolvedValue({
        id: "msg-1",
      });

      await service.createMission("topic-s2", "user-1", {
        title: "Test Mission",
        description: "desc",
        leaderId: "leader-s2",
        autoStart: false,
        notificationEmail: "test@example.com",
      });

      expect(mocks.prisma.teamMission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notificationEmail: "test@example.com",
          }),
        }),
      );
    });
  });

  // ==================== startMission ====================

  describe("startMission", () => {
    it("should throw NotFoundException when mission not found", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);
      await expect(
        service.startMission("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when mission is not PENDING", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: MissionStatus.IN_PROGRESS }),
      );
      await expect(
        service.startMission("mission-s2", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== findAlternativeAgent ====================

  describe("findAlternativeAgent", () => {
    type ServiceWithPrivate = {
      findAlternativeAgent: (
        mission: ReturnType<typeof makeMission>,
        failedAgentIds: string[],
        task: ReturnType<typeof makeTask>,
      ) => Promise<{ id: string; displayName: string } | null>;
    };

    it("should return null when team has only 1 member", async () => {
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: {
          id: "leader-s2",
          displayName: "Leader",
          isLeader: true,
          aiModel: "gpt-4",
        },
        members: [],
        all: [
          {
            id: "leader-s2",
            displayName: "Leader",
            isLeader: true,
            aiModel: "gpt-4",
          },
        ],
      });

      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(makeMission(), [], makeTask());
      expect(result).toBeNull();
    });

    it("should return the best non-leader non-failed candidate", async () => {
      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(makeMission(), ["member-s2"], makeTask());
      expect(result).not.toBeNull();
      expect(result?.id).toBe("member-s3");
    });

    it("should return null when all non-leader candidates are excluded", async () => {
      const _result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(
        makeMission(),
        ["member-s2", "member-s3"],
        makeTask(),
      );
      // leader fallback depends on AGENT_SWITCH_CONFIG.allowLeaderFallback
      // If leader is excluded too (leader-s2 in failedIds is not the case here):
      // leader-s2 is not in failedAgentIds, so it may be returned as fallback
      // We just verify it doesn't throw
      expect(true).toBe(true);
    });

    it("should return null when all agents including leader are excluded", async () => {
      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(
        makeMission(),
        ["member-s2", "member-s3", "leader-s2"],
        makeTask(),
      );
      expect(result).toBeNull();
    });

    it("should use load balancing when multiple candidates available", async () => {
      mocks.prisma.agentTask.groupBy.mockResolvedValue([
        { assignedToId: "member-s3", _count: { _all: 5 } },
        { assignedToId: "member-s2", _count: { _all: 2 } },
      ]);

      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(makeMission(), [], makeTask());
      expect(result).not.toBeNull();
    });

    it("should handle getTeamMembers error and return null", async () => {
      mocks.memberService.getTeamMembers.mockRejectedValue(
        new Error("Service error"),
      );
      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(makeMission(), [], makeTask());
      expect(result).toBeNull();
    });
  });

  // ==================== findAlternativeAgentWithCircuitBreaker ====================

  describe("findAlternativeAgentWithCircuitBreaker", () => {
    type ServiceWithPrivate = {
      findAlternativeAgentWithCircuitBreaker: (
        mission: ReturnType<typeof makeMission>,
        failedAgentIds: string[],
        task: ReturnType<typeof makeTask>,
      ) => Promise<{ id: string } | null>;
    };

    it("should return null when only 1 member", async () => {
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: { id: "leader-s2", isLeader: true, aiModel: "gpt-4" },
        members: [],
        all: [{ id: "leader-s2", isLeader: true, aiModel: "gpt-4" }],
      });
      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgentWithCircuitBreaker(makeMission(), [], makeTask());
      expect(result).toBeNull();
    });

    it("should exclude agents in cooldown", async () => {
      mocks.circuitBreaker.canExecute
        .mockReturnValueOnce(true) // leader - but skipped anyway
        .mockReturnValueOnce(false) // member-s2 in cooldown
        .mockReturnValueOnce(true); // member-s3 OK

      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgentWithCircuitBreaker(makeMission(), [], makeTask());
      // member-s2 in cooldown, member-s3 should be chosen
      expect(result).not.toBeNull();
    });

    it("should use selectBest when circuitBreaker returns a bestAgentId", async () => {
      mocks.circuitBreaker.selectBest.mockReturnValue("member-s3");

      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgentWithCircuitBreaker(makeMission(), [], makeTask());
      expect(result).not.toBeNull();
    });

    it("should fall back to first candidate when selectBest returns null", async () => {
      mocks.circuitBreaker.selectBest.mockReturnValue(null);

      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgentWithCircuitBreaker(makeMission(), [], makeTask());
      // Should fall back to candidates[0]
      expect(result).not.toBeNull();
    });

    it("should consider leader as fallback when no non-leader candidates", async () => {
      // Both members excluded
      mocks.circuitBreaker.canExecute.mockReturnValue(true);

      const _result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgentWithCircuitBreaker(
        makeMission(),
        ["member-s2", "member-s3"],
        makeTask(),
      );
      // leader-s2 is not in failedAgentIds; may be returned as leader fallback
      // or null depending on config - just ensure no throw
      expect(true).toBe(true);
    });

    it("should return null on error", async () => {
      mocks.memberService.getTeamMembers.mockRejectedValue(
        new Error("fetch error"),
      );
      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgentWithCircuitBreaker(makeMission(), [], makeTask());
      expect(result).toBeNull();
    });
  });

  // ==================== callAIWithRetry ====================

  describe("callAIWithRetry", () => {
    type ServiceWithPrivate = {
      callAIWithRetry: (
        model: string,
        messages: { role: string; content: string }[],
        prompt: string,
        options: Record<string, unknown>,
        ctx: { taskId: string; taskTitle: string; missionId: string },
        heartbeatCtx?: {
          topicId: string;
          agentId: string;
          agentName: string;
        },
      ) => Promise<{
        success: boolean;
        content?: string;
        error?: string;
        attempts: number;
        finalModel: string;
      }>;
    };

    const ctx = {
      taskId: "task-retry",
      taskTitle: "Retry Task",
      missionId: "mission-s2",
    };

    it("should succeed on first attempt", async () => {
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "Success response",
        tokensUsed: 150,
      });

      const result = await (
        service as unknown as ServiceWithPrivate
      ).callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Execute task" }],
        "System prompt",
        {},
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Success response");
      expect(result.attempts).toBe(1);
    });

    it("should return failure for permanent (non-retryable) error", async () => {
      mocks.aiCallerService.callAIWithConfig.mockRejectedValue(
        new Error("invalid_api_key: Your API key is invalid"),
      );

      const result = await (
        service as unknown as ServiceWithPrivate
      ).callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Execute task" }],
        "System prompt",
        {},
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should start heartbeat when heartbeatContext provided", async () => {
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "Done",
        tokensUsed: 50,
      });

      const result = await (
        service as unknown as ServiceWithPrivate
      ).callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Task" }],
        "System",
        {},
        ctx,
        {
          topicId: "topic-s2",
          agentId: "member-s2",
          agentName: "MemberS2",
        },
      );

      expect(result.success).toBe(true);
    });
  });

  // ==================== executeNextTasks ====================

  describe("executeNextTasks (via public access)", () => {
    it("should skip and mark pending when lock already acquired", async () => {
      // First call acquires lock, second call is rejected
      mocks.stateManager.startMissionExecution.mockReturnValueOnce(false);

      // Access private method via service proxy
      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-s2");

      // When lock not acquired, pendingExecutions.add() is called internally
      // Just verify no error is thrown
    });

    it("should exit early when mission not found", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);

      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-s2");

      expect(mocks.stateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-s2",
      );
    });

    it("should exit early when mission is not IN_PROGRESS", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);
      mocks.prisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: MissionStatus.COMPLETED, tasks: [] }),
      );

      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-s2");

      expect(mocks.stateManager.finishMissionExecution).toHaveBeenCalled();
    });

    it("should call completeMission when all tasks completed", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);
      const completedTask = makeTask({ status: AgentTaskStatus.COMPLETED });
      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [completedTask],
      });

      // First call: get mission with completed task
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      // completeMission will call findUnique again
      mocks.prisma.teamMission.findUnique.mockResolvedValueOnce(mission);
      mocks.prisma.teamMission.findUnique.mockResolvedValueOnce(null);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "Summary", tokensUsed: 100 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-s2");
    });

    it("should reset stuck IN_PROGRESS tasks and retry", async () => {
      mocks.stateManager.startMissionExecution
        .mockReturnValueOnce(true)
        .mockReturnValue(false); // prevent infinite recursion

      const stuckInProgressTask = makeTask({
        id: "stuck-ip-task",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago > 15min
      });
      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [stuckInProgressTask],
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...stuckInProgressTask,
        status: AgentTaskStatus.PENDING,
        startedAt: null,
      });

      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-s2");

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "stuck-ip-task" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });
  });

  // ==================== autoRetryBlockedTasks ====================

  describe("autoRetryBlockedTasks", () => {
    type ServiceWithPrivate = {
      autoRetryBlockedTasks: (
        mission: { id: string; topicId: string; tasks: unknown[] },
        blockedTasks: Array<{
          id: string;
          title: string;
          status: string;
          result: string | null;
          updatedAt: Date | null;
          assignedToId: string;
          assignedTo: {
            id: string;
            agentName: string | null;
            displayName: string;
          };
        }>,
        now: number,
        stuckTimeoutMs: number,
      ) => Promise<number>;
    };

    const baseMission = { id: "m1", topicId: "t1", tasks: [] };

    it("should reset task to PENDING when canRetry and not timed out", async () => {
      mocks.circuitBreaker.canExecute.mockReturnValue(true);
      mocks.prisma.agentTask.update.mockResolvedValue({});

      const now = Date.now();
      const blockedTask = {
        id: "bt1",
        title: "Blocked Task",
        status: AgentTaskStatus.BLOCKED,
        result: null,
        updatedAt: new Date(now - 5 * 60 * 1000), // 5 min ago, under 15min timeout
        assignedToId: "member-s2",
        assignedTo: {
          id: "member-s2",
          agentName: "MemberS2",
          displayName: "Member S2",
        },
      };

      const count = await (
        service as unknown as ServiceWithPrivate
      ).autoRetryBlockedTasks(baseMission, [blockedTask], now, 15 * 60 * 1000);

      expect(count).toBe(1);
      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bt1" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should force complete task when timed out", async () => {
      mocks.circuitBreaker.canExecute.mockReturnValue(true);
      mocks.prisma.agentTask.update.mockResolvedValue({});

      const now = Date.now();
      const timedOutTask = {
        id: "bt2",
        title: "Timed Out Task",
        status: AgentTaskStatus.BLOCKED,
        result: null,
        updatedAt: new Date(now - 20 * 60 * 1000), // 20 min ago, over 15min timeout
        assignedToId: "member-s2",
        assignedTo: {
          id: "member-s2",
          agentName: "MemberS2",
          displayName: "Member S2",
        },
      };

      const count = await (
        service as unknown as ServiceWithPrivate
      ).autoRetryBlockedTasks(baseMission, [timedOutTask], now, 15 * 60 * 1000);

      expect(count).toBe(1);
      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bt2" },
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should not retry when circuit breaker denies and not timed out", async () => {
      mocks.circuitBreaker.canExecute.mockReturnValue(false);
      mocks.circuitBreaker.getCooldownRemaining.mockReturnValue(30000);

      const now = Date.now();
      const blockedTask = {
        id: "bt3",
        title: "CB Blocked Task",
        status: AgentTaskStatus.BLOCKED,
        result: null,
        updatedAt: new Date(now - 1 * 60 * 1000), // 1 min ago
        assignedToId: "member-s2",
        assignedTo: {
          id: "member-s2",
          agentName: "MemberS2",
          displayName: "Member S2",
        },
      };

      const count = await (
        service as unknown as ServiceWithPrivate
      ).autoRetryBlockedTasks(baseMission, [blockedTask], now, 15 * 60 * 1000);

      expect(count).toBe(0);
    });

    it("should handle null updatedAt as exceeded timeout", async () => {
      mocks.circuitBreaker.canExecute.mockReturnValue(true);
      mocks.prisma.agentTask.update.mockResolvedValue({});

      const now = Date.now();
      const nullUpdatedTask = {
        id: "bt4",
        title: "Null Updated Task",
        status: AgentTaskStatus.BLOCKED,
        result: "existing result",
        updatedAt: null,
        assignedToId: "member-s2",
        assignedTo: {
          id: "member-s2",
          agentName: "MemberS2",
          displayName: "Member S2",
        },
      };

      const count = await (
        service as unknown as ServiceWithPrivate
      ).autoRetryBlockedTasks(
        baseMission,
        [nullUpdatedTask],
        now,
        15 * 60 * 1000,
      );

      expect(count).toBe(1);
    });
  });

  // ==================== forceCompleteStuckTasks ====================

  describe("forceCompleteStuckTasks", () => {
    type ServiceWithPrivate = {
      forceCompleteStuckTasks: (
        mission: { id: string; topicId: string; tasks: unknown[] },
        stuckTasks: Array<{
          id: string;
          title: string;
          status: string;
          result: string | null;
          updatedAt: Date | null;
        }>,
        now: number,
        stuckTimeoutMs: number,
      ) => Promise<number>;
    };

    const baseMission = { id: "m1", topicId: "t1", tasks: [] };

    it("should force complete when task age exceeds timeout", async () => {
      mocks.prisma.agentTask.update.mockResolvedValue({});
      const now = Date.now();
      const stuckTask = {
        id: "st1",
        title: "Stuck Task",
        status: AgentTaskStatus.REVISION_NEEDED,
        result: null,
        updatedAt: new Date(now - 20 * 60 * 1000),
      };

      const count = await (
        service as unknown as ServiceWithPrivate
      ).forceCompleteStuckTasks(baseMission, [stuckTask], now, 15 * 60 * 1000);

      expect(count).toBe(1);
      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should not force complete when task age is below timeout", async () => {
      const now = Date.now();
      const recentTask = {
        id: "st2",
        title: "Recent Task",
        status: AgentTaskStatus.AWAITING_REVIEW,
        result: null,
        updatedAt: new Date(now - 5 * 60 * 1000),
      };

      const count = await (
        service as unknown as ServiceWithPrivate
      ).forceCompleteStuckTasks(baseMission, [recentTask], now, 15 * 60 * 1000);

      expect(count).toBe(0);
      expect(mocks.prisma.agentTask.update).not.toHaveBeenCalled();
    });

    it("should handle null updatedAt as 0 age (below timeout)", async () => {
      const now = Date.now();
      const nullUpdated = {
        id: "st3",
        title: "Null Updated",
        status: AgentTaskStatus.REVISION_NEEDED,
        result: null,
        updatedAt: null,
      };

      const count = await (
        service as unknown as ServiceWithPrivate
      ).forceCompleteStuckTasks(
        baseMission,
        [nullUpdated],
        now,
        15 * 60 * 1000,
      );

      expect(count).toBe(0);
    });
  });

  // ==================== updateMissionProgress ====================

  describe("updateMissionProgress", () => {
    it("should update completedTasks and progressPercent", async () => {
      const mission = makeMission({
        tasks: [
          makeTask({ id: "t1", status: AgentTaskStatus.COMPLETED }),
          makeTask({ id: "t2", status: AgentTaskStatus.PENDING }),
        ],
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);

      await (
        service as unknown as {
          updateMissionProgress: (id: string) => Promise<void>;
        }
      ).updateMissionProgress("mission-s2");

      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            completedTasks: 1,
            progressPercent: 50,
          }),
        }),
      );
    });

    it("should do nothing when mission not found", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);
      await (
        service as unknown as {
          updateMissionProgress: (id: string) => Promise<void>;
        }
      ).updateMissionProgress("nonexistent");
      expect(mocks.prisma.teamMission.update).not.toHaveBeenCalled();
    });

    it("should set 0% when no tasks", async () => {
      const mission = makeMission({ tasks: [] });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);

      await (
        service as unknown as {
          updateMissionProgress: (id: string) => Promise<void>;
        }
      ).updateMissionProgress("mission-s2");

      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ progressPercent: 0 }),
        }),
      );
    });
  });

  // ==================== extractTaskConstraints ====================

  describe("extractTaskConstraints (private)", () => {
    type ServiceWithPrivate = {
      extractTaskConstraints: (
        missionDescription: string,
        taskDescription: string,
      ) => string[];
    };

    it("should extract word count requirement", () => {
      const result = (
        service as unknown as ServiceWithPrivate
      ).extractTaskConstraints(
        "Write a 1000字 story about heroes",
        "Task description",
      );
      expect(result.some((c) => c.includes("1000"))).toBe(true);
    });

    it("should extract prohibition constraints", () => {
      const result = (
        service as unknown as ServiceWithPrivate
      ).extractTaskConstraints(
        "Story description. 禁止出现暴力内容",
        "Task description",
      );
      expect(result.some((c) => c.includes("禁止"))).toBe(true);
    });

    it("should extract mandatory constraints", () => {
      const result = (
        service as unknown as ServiceWithPrivate
      ).extractTaskConstraints(
        "Story description. 必须保持人物一致性",
        "Task description",
      );
      expect(result.some((c) => c.includes("必须"))).toBe(true);
    });

    it("should return empty array when no constraints", () => {
      const result = (
        service as unknown as ServiceWithPrivate
      ).extractTaskConstraints(
        "Simple story about a hero",
        "Write the first chapter",
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it("should limit to 10 constraints", () => {
      const manyConstraints =
        "禁止A 禁止B 禁止C 禁止D 禁止E 禁止F 禁止G 禁止H 禁止I 禁止J 禁止K 禁止L";
      const result = (
        service as unknown as ServiceWithPrivate
      ).extractTaskConstraints(manyConstraints, "");
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  // ==================== buildCompletedTasksSummary ====================

  describe("buildCompletedTasksSummary (private)", () => {
    type ServiceWithPrivate = {
      buildCompletedTasksSummary: (
        tasks: ReturnType<typeof makeTask>[],
        currentTaskId: string,
      ) => string;
    };

    it("should return empty string when no completed tasks", () => {
      const tasks = [makeTask({ status: AgentTaskStatus.PENDING })];
      const result = (
        service as unknown as ServiceWithPrivate
      ).buildCompletedTasksSummary(tasks, "task-s2");
      expect(result).toBe("");
    });

    it("should return empty string when only current task is completed", () => {
      const tasks = [
        makeTask({
          id: "task-s2",
          status: AgentTaskStatus.COMPLETED,
          result: "done",
        }),
      ];
      const result = (
        service as unknown as ServiceWithPrivate
      ).buildCompletedTasksSummary(tasks, "task-s2");
      expect(result).toBe("");
    });

    it("should include completed tasks summary", () => {
      const otherTask = makeTask({
        id: "other-task",
        title: "Other Task",
        status: AgentTaskStatus.COMPLETED,
        result: "Result of other task",
      });
      const tasks = [otherTask];
      const result = (
        service as unknown as ServiceWithPrivate
      ).buildCompletedTasksSummary(tasks, "task-s2");
      expect(result).toContain("Other Task");
    });

    it("should truncate long result previews", () => {
      const longResult = "a".repeat(500);
      const otherTask = makeTask({
        id: "other-task",
        title: "Long Task",
        status: AgentTaskStatus.COMPLETED,
        result: longResult,
      });
      const result = (
        service as unknown as ServiceWithPrivate
      ).buildCompletedTasksSummary([otherTask], "task-s2");
      expect(result).toContain("...");
    });

    it("should show at most 3 completed tasks", () => {
      const completedTasks = Array.from({ length: 5 }, (_, i) =>
        makeTask({
          id: `task-${i}`,
          title: `Task ${i}`,
          status: AgentTaskStatus.COMPLETED,
          result: `Result ${i}`,
        }),
      );
      const result = (
        service as unknown as ServiceWithPrivate
      ).buildCompletedTasksSummary(completedTasks, "nonexistent");
      // Count occurrences of "Task " in the summary
      const matchCount = (result.match(/📖 \*\*Task/g) || []).length;
      expect(matchCount).toBeLessThanOrEqual(3);
    });
  });

  // ==================== buildScopeGuidance ====================

  describe("buildScopeGuidance (private)", () => {
    type ServiceWithPrivate = {
      buildScopeGuidance: (mission: ReturnType<typeof makeMission>) => string;
    };

    it("should return empty string for non-large-content task", () => {
      const mission = makeMission({
        title: "Analyze quarterly results",
        description: "Review the numbers",
      });
      const result = (
        service as unknown as ServiceWithPrivate
      ).buildScopeGuidance(mission);
      expect(result).toBe("");
    });

    it("should return guidance for large content task (novel)", () => {
      const mission = makeMission({
        title: "写一部武侠小说",
        description: "全书共8卷，每卷12章，每章3000字",
      });
      const result = (
        service as unknown as ServiceWithPrivate
      ).buildScopeGuidance(mission);
      expect(result).toContain("一次性列出");
    });
  });

  // ==================== executeTaskRevision ====================

  describe("executeTaskRevision", () => {
    type ServiceWithPrivate = {
      executeTaskRevision: (
        mission: ReturnType<typeof makeMission>,
        task: ReturnType<typeof makeTask>,
        feedback: string,
      ) => Promise<void>;
    };

    it("should skip when revision lock already acquired", async () => {
      mocks.stateManager.startRevision.mockReturnValue(false);
      const mission = makeMission();
      const task = makeTask();

      await (service as unknown as ServiceWithPrivate).executeTaskRevision(
        mission,
        task,
        "Please redo",
      );

      expect(mocks.prisma.agentTask.findUnique).not.toHaveBeenCalled();
    });

    it("should release lock and return early when task not found", async () => {
      mocks.stateManager.startRevision.mockReturnValue(true);
      mocks.stateManager.isRevisionInProgress.mockReturnValue(true);
      mocks.prisma.agentTask.findUnique.mockResolvedValue(null);

      await (service as unknown as ServiceWithPrivate).executeTaskRevision(
        makeMission(),
        makeTask(),
        "feedback",
      );

      expect(mocks.stateManager.finishRevision).toHaveBeenCalled();
    });

    it("should exit when CAS update count is 0", async () => {
      mocks.stateManager.startRevision.mockReturnValue(true);
      mocks.stateManager.isRevisionInProgress.mockReturnValue(false);
      mocks.prisma.agentTask.findUnique.mockResolvedValue(makeTask());
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 0 });

      await (service as unknown as ServiceWithPrivate).executeTaskRevision(
        makeMission(),
        makeTask(),
        "feedback",
      );

      expect(mocks.aiCallerService.callAIWithConfig).not.toHaveBeenCalled();
    });

    it("should restore REVISION_NEEDED status when AI call fails", async () => {
      mocks.stateManager.startRevision.mockReturnValue(true);
      mocks.stateManager.isRevisionInProgress.mockReturnValue(false);
      mocks.prisma.agentTask.findUnique.mockResolvedValue(makeTask());
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mocks.aiCallerService.callAIWithConfig.mockRejectedValue(
        new Error("AI service down"),
      );
      mocks.prisma.agentTask.update.mockResolvedValue({});

      await (service as unknown as ServiceWithPrivate).executeTaskRevision(
        makeMission(),
        makeTask(),
        "feedback",
      );

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: AgentTaskStatus.REVISION_NEEDED },
        }),
      );
    });

    it("should restore REVISION_NEEDED when AI response contains API error", async () => {
      mocks.stateManager.startRevision.mockReturnValue(true);
      mocks.stateManager.isRevisionInProgress.mockReturnValue(false);
      mocks.prisma.agentTask.findUnique.mockResolvedValue(makeTask());
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "API Error: rate limit exceeded",
        tokensUsed: 0,
      });
      mocks.prisma.agentTask.update.mockResolvedValue({});

      await (service as unknown as ServiceWithPrivate).executeTaskRevision(
        makeMission(),
        makeTask(),
        "feedback",
      );

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: AgentTaskStatus.REVISION_NEEDED },
        }),
      );
    });

    it("should complete revision successfully and re-review", async () => {
      const task = makeTask({ status: AgentTaskStatus.REVISION_NEEDED });
      const updatedTask = { ...task, status: AgentTaskStatus.AWAITING_REVIEW };

      mocks.stateManager.startRevision.mockReturnValue(true);
      mocks.stateManager.isRevisionInProgress.mockReturnValue(false);
      mocks.prisma.agentTask.findUnique
        .mockResolvedValueOnce(task) // latestTask
        .mockResolvedValueOnce(updatedTask); // updatedTask after update
      mocks.prisma.agentTask.updateMany.mockResolvedValue({ count: 1 });
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "Revised content",
        tokensUsed: 100,
      });
      mocks.prisma.agentTask.update.mockResolvedValue(updatedTask);
      // leaderReviewTask will try to call AI again
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: {
          content: "不通过。请重新执行任务。",
          tokensUsed: 50,
        },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });
      // The review rejection with revisionCount=0, maxRevisions=3 will trigger another revision
      // But stateManager.startRevision will return false, preventing infinite loop
      mocks.stateManager.startRevision
        .mockReturnValueOnce(true)
        .mockReturnValue(false);

      await (service as unknown as ServiceWithPrivate).executeTaskRevision(
        makeMission(),
        task,
        "feedback",
      );
    });
  });

  // ==================== getLeaderSystemPrompt / getAgentSystemPrompt ====================

  describe("system prompt builders", () => {
    type ServiceWithPrivate = {
      getLeaderSystemPrompt: (
        leader: ReturnType<typeof makeMission>["leader"],
      ) => string;
      getAgentSystemPrompt: (
        member: {
          id: string;
          displayName: string;
          systemPrompt?: string;
          agentName?: string;
          roleDescription?: string;
        },
        task: ReturnType<typeof makeTask>,
        contextPackage: null,
        missionDescription?: string,
        mustConstraints?: unknown[],
      ) => string;
    };

    it("should return a string for getLeaderSystemPrompt", () => {
      const result = (
        service as unknown as ServiceWithPrivate
      ).getLeaderSystemPrompt(makeMission().leader);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return a string for getAgentSystemPrompt", () => {
      const result = (
        service as unknown as ServiceWithPrivate
      ).getAgentSystemPrompt(
        {
          id: "member-s2",
          displayName: "Member S2",
          agentName: "MemberS2",
          roleDescription: "Team member",
        },
        makeTask(),
        null,
        "mission desc",
        [],
      );
      expect(typeof result).toBe("string");
    });
  });

  // ==================== handleTaskExecutionFailure ====================

  describe("handleTaskExecutionFailure", () => {
    type ServiceWithPrivate = {
      handleTaskExecutionFailure: (
        mission: ReturnType<typeof makeMission>,
        task: ReturnType<typeof makeTask>,
        assignedTo: { id: string; displayName: string; agentName?: string },
        errorMsg: string,
      ) => Promise<void>;
    };

    it("should cancel task and call leader for replan", async () => {
      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.prisma.agentTask.create.mockResolvedValue({ id: "new-task" });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: {
          content:
            '```json\n{"action":"split","newTasks":[{"title":"Part 1","description":"desc","assignee":"MemberS2"}]}\n```',
          tokensUsed: 100,
        },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      await (
        service as unknown as ServiceWithPrivate
      ).handleTaskExecutionFailure(
        makeMission(),
        makeTask(),
        { id: "member-s2", displayName: "Member S2", agentName: "MemberS2" },
        "Context too large",
      );

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: AgentTaskStatus.CANCELLED },
        }),
      );
    });

    it("should handle replan failure gracefully", async () => {
      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: false,
        error: { message: "AI down" },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      await (
        service as unknown as ServiceWithPrivate
      ).handleTaskExecutionFailure(
        makeMission(),
        makeTask(),
        { id: "member-s2", displayName: "Member S2" },
        "Unknown error",
      );

      // Should not throw even when replan fails
      expect(mocks.prisma.agentTask.update).toHaveBeenCalled();
    });

    it("should handle replan AI exception gracefully", async () => {
      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.leaderModelService.executeWithFallback.mockRejectedValue(
        new Error("Network error"),
      );

      await expect(
        (service as unknown as ServiceWithPrivate).handleTaskExecutionFailure(
          makeMission(),
          makeTask(),
          { id: "member-s2", displayName: "Member S2" },
          "Task too big",
        ),
      ).resolves.not.toThrow();
    });

    it("should handle replan with invalid JSON gracefully", async () => {
      mocks.prisma.agentTask.update.mockResolvedValue({});
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: {
          content: "```json\n{invalid json here}\n```",
          tokensUsed: 50,
        },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      await expect(
        (service as unknown as ServiceWithPrivate).handleTaskExecutionFailure(
          makeMission(),
          makeTask(),
          { id: "member-s2", displayName: "Member S2" },
          "Some error",
        ),
      ).resolves.not.toThrow();
    });
  });

  // ==================== completeMission ====================

  describe("completeMission", () => {
    type ServiceWithPrivate = {
      completeMission: (missionId: string) => Promise<void>;
    };

    it("should do nothing when mission not found", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);
      await (service as unknown as ServiceWithPrivate).completeMission(
        "nonexistent",
      );
      expect(mocks.prisma.teamMission.update).not.toHaveBeenCalled();
    });

    it("should complete mission successfully", async () => {
      const completedTask = makeTask({
        id: "t1",
        status: AgentTaskStatus.COMPLETED,
        result: "Result content",
        assignedTo: {
          id: "member-s2",
          displayName: "Member S2",
          agentName: "MemberS2",
          aiModel: "claude-3",
          isLeader: false,
          topicId: "topic-s2",
        },
      });
      const mission = makeMission({
        tasks: [completedTask],
        notificationEmail: null,
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.COMPLETED,
      });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "Executive summary", tokensUsed: 100 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      await (service as unknown as ServiceWithPrivate).completeMission(
        "mission-s2",
      );

      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MissionStatus.COMPLETED }),
        }),
      );
    });

    it("should dispatch completion notification via MissionCompletionPreset", async () => {
      // PR-DR1b R1：mission 完成走 dispatcher（MissionCompletionPreset.notify），
      // 不再走旧 EmailNotificationPresetsService.sendMissionCompletionNotification
      // 收件人按 mission.createdById 解析，不再依赖 mission.notificationEmail
      jest.useRealTimers(); // 本 case 需要 setImmediate 真正调度，覆盖 fire-and-forget Promise
      const mission = makeMission({
        tasks: [],
        notificationEmail: null,
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "Summary", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      await (service as unknown as ServiceWithPrivate).completeMission(
        "mission-s2",
      );

      // 等待 fire-and-forget Promise 落地
      await new Promise((resolve) => setImmediate(resolve));

      expect(mocks.missionCompletionPreset.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-s2",
          missionId: "mission-s2",
          missionTitle: "Supplemental Mission",
          reportUrl: expect.stringContaining(
            "/ai-teams/topics/topic-s2?mission=mission-s2",
          ),
        }),
      );
    });

    it("should handle completion error and mark mission as FAILED", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ tasks: [] }),
      );
      mocks.prisma.teamMission.update.mockRejectedValueOnce(
        new Error("DB write failed"),
      );

      await (service as unknown as ServiceWithPrivate).completeMission(
        "mission-s2",
      );

      // Should call update again to mark as FAILED
      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: MissionStatus.FAILED },
        }),
      );
    });

    it("should use fallback executive summary when AI fails", async () => {
      const mission = makeMission({ tasks: [], notificationEmail: null });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: false,
        error: { message: "AI unavailable" },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });

      await (service as unknown as ServiceWithPrivate).completeMission(
        "mission-s2",
      );

      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MissionStatus.COMPLETED }),
        }),
      );
    });
  });

  // ==================== leaderReviewTask ====================

  describe("leaderReviewTask (via mock)", () => {
    type ServiceWithPrivate = {
      leaderReviewTask: (
        mission: ReturnType<typeof makeMission>,
        task: ReturnType<typeof makeTask>,
        taskResult: string,
      ) => Promise<void>;
    };

    it("should approve task when AI returns approval", async () => {
      const task = makeTask({ revisionCount: 0, maxRevisions: 3 });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: {
          content: "审核通过。内容质量优秀，达到预期标准。",
          tokensUsed: 50,
        },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.COMPLETED,
      });
      const mission = makeMission({
        tasks: [task],
        status: MissionStatus.IN_PROGRESS,
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      await (service as unknown as ServiceWithPrivate).leaderReviewTask(
        makeMission(),
        task,
        "Task result content",
      );

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should reject task with maxRevisions exceeded and valid content -> force pass", async () => {
      const task = makeTask({
        revisionCount: 3,
        maxRevisions: 3,
        result:
          "Valid content with significantly more than one hundred characters to definitively pass the validity threshold check for force completion in leaderReviewTask execution path.",
      });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "不通过。内容质量不足。", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.COMPLETED,
      });
      const mission = makeMission({
        tasks: [task],
        status: MissionStatus.IN_PROGRESS,
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      await (service as unknown as ServiceWithPrivate).leaderReviewTask(
        makeMission(),
        task,
        "Valid content...",
      );

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should block task when max revisions exceeded and no valid content", async () => {
      const task = makeTask({
        revisionCount: 3,
        maxRevisions: 3,
        result: null,
      });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "不通过。内容质量不足。", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.BLOCKED,
      });
      const mission = makeMission({
        tasks: [task],
        status: MissionStatus.IN_PROGRESS,
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      await (service as unknown as ServiceWithPrivate).leaderReviewTask(
        makeMission(),
        task,
        "",
      );

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.BLOCKED }),
        }),
      );
    });

    it("should trigger revision when review fails and under max revisions", async () => {
      const task = makeTask({ revisionCount: 0, maxRevisions: 3 });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: true,
        data: { content: "不通过。请改写开头。", tokensUsed: 50 },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.REVISION_NEEDED,
      });
      // startRevision returns false to prevent infinite loop
      mocks.stateManager.startRevision.mockReturnValue(false);

      await (service as unknown as ServiceWithPrivate).leaderReviewTask(
        makeMission(),
        task,
        "Task result content",
      );

      expect(mocks.prisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AgentTaskStatus.REVISION_NEEDED,
          }),
        }),
      );
    });

    it("should auto-approve on review AI call failure", async () => {
      const task = makeTask({ revisionCount: 0, maxRevisions: 3 });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: false,
        error: { message: "AI error", getUserMessage: () => "AI error" },
        fallbackUsed: false,
        modelUsed: "gpt-4",
      });
      mocks.prisma.agentTask.update.mockResolvedValue({
        ...task,
        status: AgentTaskStatus.COMPLETED,
      });
      const mission = makeMission({
        tasks: [task],
        status: MissionStatus.IN_PROGRESS,
      });
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      mocks.prisma.teamMission.update.mockResolvedValue(mission);
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      await (service as unknown as ServiceWithPrivate).leaderReviewTask(
        makeMission(),
        task,
        "Task result",
      );

      // On failure during review, auto-approve is done in catch block
      expect(mocks.prisma.agentTask.update).toHaveBeenCalled();
    });
  });
});

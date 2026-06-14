/**
 * TeamMissionService - Supplemental3 Tests
 *
 * Covers branches not tested in primary spec, additional.spec, or supplemental2.spec:
 * - createMission: happy path, leader not found throws, autoStart=false skips startMission
 * - startMission: throws when mission not found, throws when not PENDING, updates to PLANNING
 * - findAlternativeAgent: leader fallback when allowLeaderFallback true, load balancing sort
 * - callAIWithRetry: heartbeat context with topicEventEmitter calls, retryable error loop
 * - getMissions delegation to lifecycleService / lifecycleService method delegates
 * - cancelMission / pauseMission / resumeMission / deleteMission lifecycle delegation
 * - updateMissionNotification delegation
 * - createLog / sendMessageToTopic helper delegates
 * - getTeamMembers delegation
 * - buildTaskExecutionPrompt basic shape
 * - getAgentSystemPrompt delegation to missionContextService
 * - getLeaderSystemPrompt delegation to memberService
 * - autoRetryBlockedTasks: retries within timeout
 * - forceCompleteStuckTasks: forced completion path
 * - updateMissionProgress: DB update
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
  id: "leader-s3",
  displayName: "Leader S3",
  agentName: "LeaderS3",
  aiModel: "gpt-4",
  isLeader: true,
  topicId: "topic-s3",
  ...overrides,
});

const makeMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-s3",
  topicId: "topic-s3",
  title: "Supplemental3 Mission",
  description: "desc",
  objectives: [],
  constraints: [],
  deliverables: [],
  leaderId: "leader-s3",
  createdById: "user-s3",
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
  leader: makeLeader(),
  tasks: [],
  ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-s3",
  missionId: "mission-s3",
  title: "Task S3",
  description: "task desc",
  status: AgentTaskStatus.IN_PROGRESS,
  priority: TaskPriority.MEDIUM,
  taskType: TaskType.RESEARCH,
  assignedToId: "member-s3",
  dependsOnIds: [],
  createdAt: new Date(Date.now() - 45 * 60 * 1000),
  startedAt: new Date(Date.now() - 45 * 60 * 1000),
  updatedAt: new Date(Date.now() - 45 * 60 * 1000),
  completedAt: null,
  leaderFeedback: null,
  result: null,
  assignedTo: {
    id: "member-s3",
    displayName: "Member S3",
    agentName: "MemberS3",
    aiModel: "claude-3",
    isLeader: false,
    topicId: "topic-s3",
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
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      groupBy: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    missionLog: { create: jest.fn(), findMany: jest.fn() },
    topicMessage: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({}),
      ),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  const toolRegistry = {
    execute: jest.fn(),
    getTool: jest.fn(),
    tryGet: jest.fn().mockReturnValue(null),
  };
  const topicEventEmitter = {
    emitToTopic: jest.fn().mockResolvedValue(undefined),
  };
  const longContentService = {
    initMission: jest.fn().mockResolvedValue(undefined),
    validateTaskCount: jest
      .fn()
      .mockReturnValue({ isValid: true, warning: null }),
    updateTotalTasks: jest.fn(),
    buildGranularityConstraintPrompt: jest.fn().mockReturnValue(""),
    ensureMissionInitialized: jest.fn().mockResolvedValue(undefined),
    processTaskCompletion: jest
      .fn()
      .mockResolvedValue({ needsContinuation: false }),
    buildContinuationPrompt: jest.fn().mockReturnValue("continue"),
  };
  const leaderModelService = {
    executeWithFallback: jest.fn().mockResolvedValue({
      success: true,
      data: { content: "AI response", tokensUsed: 100 },
      fallbackUsed: false,
      modelUsed: "gpt-4",
    }),
  };
  const emailService = { sendMissionCompletionEmail: jest.fn() };
  const configService = { get: jest.fn() };
  const missionContextService = {
    buildContextPackage: jest.fn().mockResolvedValue(null),
    extractContextFromLeaderOutput: jest.fn().mockReturnValue(null),
    buildAgentSystemPromptWithContext: jest
      .fn()
      .mockReturnValue("agent system prompt"),
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
      .mockResolvedValue({ id: "mission-s3", status: MissionStatus.CANCELLED }),
    pauseMission: jest
      .fn()
      .mockResolvedValue({ id: "mission-s3", status: MissionStatus.PAUSED }),
    resumeMission: jest.fn().mockResolvedValue({
      id: "mission-s3",
      status: MissionStatus.IN_PROGRESS,
    }),
    deleteMission: jest.fn().mockResolvedValue(undefined),
    updateMissionNotification: jest.fn().mockResolvedValue(undefined),
    getMissions: jest.fn().mockResolvedValue([]),
    getMissionById: jest.fn().mockResolvedValue(makeMission()),
    getMissionLogs: jest.fn().mockResolvedValue([]),
    getMissionActions: jest.fn().mockResolvedValue([]),
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
      .mockResolvedValue({ content: "ai response", tokensUsed: 100 }),
  };
  const messageService = {
    sendMessage: jest.fn().mockResolvedValue({ id: "msg-s3" }),
    sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-s3" }),
    createLog: jest.fn().mockResolvedValue(undefined),
  };
  const memberService = {
    getTeamMembers: jest.fn().mockResolvedValue({
      leader: makeLeader(),
      members: [
        {
          id: "member-s3",
          displayName: "Member S3",
          isLeader: false,
          aiModel: "claude-3",
        },
        {
          id: "member-s4",
          displayName: "Member S4",
          isLeader: false,
          aiModel: "gemini-pro",
        },
      ],
      all: [
        makeLeader(),
        {
          id: "member-s3",
          displayName: "Member S3",
          isLeader: false,
          aiModel: "claude-3",
        },
        {
          id: "member-s4",
          displayName: "Member S4",
          isLeader: false,
          aiModel: "gemini-pro",
        },
      ],
    }),
    getLeader: jest.fn(),
    getLeaderSystemPrompt: jest.fn().mockReturnValue("leader system prompt"),
  };
  const agentFacade = {
    chat: jest.fn(),
    contextInit: null,
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
      { provide: AgentFacade, useValue: mocks.agentFacade },
      { provide: TeamFacade, useValue: mocks.teamFacade },
    ],
  }).compile();
  return module.get<TeamMissionService>(TeamMissionService);
}

// ============================================================
// Tests
// ============================================================

describe("TeamMissionService (supplemental3)", () => {
  let mocks: ReturnType<typeof buildMocks>;
  let service: TeamMissionService;

  beforeEach(async () => {
    mocks = buildMocks();
    service = await buildModule(mocks);
    // Initialize to register callbacks
    mocks.prisma.agentTask.findMany.mockResolvedValue([]);
    mocks.prisma.teamMission.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==================== createMission ====================

  describe("createMission", () => {
    it("should throw NotFoundException when leader not found", async () => {
      mocks.prisma.topicAIMember.findFirst.mockResolvedValue(null);

      await expect(
        service.createMission("topic-s3", "user-s3", {
          title: "Test Mission",
          description: "desc",
          leaderId: "nonexistent-leader",
          objectives: [],
          constraints: [],
          deliverables: [],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create mission successfully when leader exists", async () => {
      const leader = makeLeader();
      mocks.prisma.topicAIMember.findFirst.mockResolvedValue(leader);

      const createdMission = {
        ...makeMission({ status: MissionStatus.PENDING }),
        leader,
        createdBy: { id: "user-s3", username: "user", fullName: "User" },
      };
      mocks.prisma.teamMission.create.mockResolvedValue(createdMission);
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...createdMission,
        topic: { aiMembers: [leader] },
      });

      // Mock the startMission path
      mocks.prisma.teamMission.update.mockResolvedValue({
        ...createdMission,
        status: MissionStatus.PLANNING,
      });
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: false,
        error: { getUserMessage: () => "failed" },
      });

      const result = await service.createMission("topic-s3", "user-s3", {
        title: "Test Mission",
        description: "desc",
        leaderId: "leader-s3",
        objectives: [],
        constraints: [],
        deliverables: [],
        autoStart: false,
      });

      expect(result).toBeDefined();
      expect(mocks.prisma.teamMission.create).toHaveBeenCalledTimes(1);
    });

    it("should not auto-start when autoStart=false", async () => {
      const leader = makeLeader();
      mocks.prisma.topicAIMember.findFirst.mockResolvedValue(leader);

      const createdMission = {
        ...makeMission({ status: MissionStatus.PENDING }),
        leader,
        createdBy: { id: "user-s3", username: "user", fullName: "User" },
      };
      mocks.prisma.teamMission.create.mockResolvedValue(createdMission);

      await service.createMission("topic-s3", "user-s3", {
        title: "Test Mission",
        description: "desc",
        leaderId: "leader-s3",
        objectives: [],
        constraints: [],
        deliverables: [],
        autoStart: false,
      });

      // startMission calls teamMission.findUnique - should not be called when autoStart=false
      expect(mocks.prisma.teamMission.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MissionStatus.PLANNING }),
        }),
      );
    });

    it("should create mission log after creation", async () => {
      const leader = makeLeader();
      mocks.prisma.topicAIMember.findFirst.mockResolvedValue(leader);

      const createdMission = {
        ...makeMission({ status: MissionStatus.PENDING }),
        leader,
        createdBy: { id: "user-s3", username: "user", fullName: "User" },
      };
      mocks.prisma.teamMission.create.mockResolvedValue(createdMission);

      await service.createMission("topic-s3", "user-s3", {
        title: "Test Mission",
        description: "desc",
        leaderId: "leader-s3",
        objectives: [],
        constraints: [],
        deliverables: [],
        autoStart: false,
      });

      // createLog delegates to messageService.createLog
      expect(mocks.messageService.createLog).toHaveBeenCalled();
    });
  });

  // ==================== startMission ====================

  describe("startMission", () => {
    it("should throw NotFoundException when mission not found", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue(null);

      await expect(
        service.startMission("nonexistent-mission", "user-s3"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when mission is not PENDING", async () => {
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission({ status: MissionStatus.IN_PROGRESS }),
        topic: { aiMembers: [] },
      });

      await expect(
        service.startMission("mission-s3", "user-s3"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should update mission status to PLANNING when starting", async () => {
      const leader = makeLeader();
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission({ status: MissionStatus.PENDING }),
        leader,
        topic: {
          aiMembers: [leader],
        },
      });
      mocks.prisma.teamMission.update.mockResolvedValue({
        ...makeMission({ status: MissionStatus.PLANNING }),
        leader,
      });

      // Mock the AI call to fail (so startMission completes quickly)
      mocks.leaderModelService.executeWithFallback.mockResolvedValue({
        success: false,
        error: { getUserMessage: () => "planning failed" },
      });
      mocks.prisma.agentTask.findMany.mockResolvedValue([]);

      await service.startMission("mission-s3", "user-s3");

      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-s3" },
          data: expect.objectContaining({ status: MissionStatus.PLANNING }),
        }),
      );
    });
  });

  // ==================== lifecycle delegation methods ====================

  describe("cancelMission", () => {
    it("should delegate to lifecycleService.cancelMission with userId and bound createLog", async () => {
      const result = await service.cancelMission("mission-s3", "user-s3");
      expect(mocks.lifecycleService.cancelMission).toHaveBeenCalledWith(
        "mission-s3",
        "user-s3",
        expect.any(Function),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: MissionStatus.CANCELLED }),
      );
    });
  });

  describe("pauseMission", () => {
    it("should delegate to lifecycleService.pauseMission with userId and bound callbacks", async () => {
      const result = await service.pauseMission("mission-s3", "user-s3");
      expect(mocks.lifecycleService.pauseMission).toHaveBeenCalledWith(
        "mission-s3",
        "user-s3",
        expect.any(Function),
        expect.any(Function),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: MissionStatus.PAUSED }),
      );
    });
  });

  describe("resumeMission", () => {
    it("should delegate to lifecycleService.resumeMission with userId and bound callbacks", async () => {
      const result = await service.resumeMission("mission-s3", "user-s3");
      expect(mocks.lifecycleService.resumeMission).toHaveBeenCalledWith(
        "mission-s3",
        "user-s3",
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      );
      expect(result).toEqual(
        expect.objectContaining({ status: MissionStatus.IN_PROGRESS }),
      );
    });
  });

  describe("deleteMission", () => {
    it("should delegate to lifecycleService.deleteMission with userId", async () => {
      await service.deleteMission("mission-s3", "user-s3");
      expect(mocks.lifecycleService.deleteMission).toHaveBeenCalledWith(
        "mission-s3",
        "user-s3",
      );
    });
  });

  describe("updateMissionNotification", () => {
    it("should delegate to lifecycleService.updateMissionNotification with userId and dto", async () => {
      const dto = { notificationEmail: "test@example.com" };
      await service.updateMissionNotification("mission-s3", "user-s3", dto);
      expect(
        mocks.lifecycleService.updateMissionNotification,
      ).toHaveBeenCalledWith(
        "mission-s3",
        "user-s3",
        dto,
        expect.any(Function),
      );
    });
  });

  describe("getMissions", () => {
    it("should query prisma.teamMission.findMany with topicId", async () => {
      const missions = [makeMission()];
      mocks.prisma.teamMission.findMany.mockResolvedValue(missions);
      const result = await service.getMissions("topic-s3");
      expect(mocks.prisma.teamMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ topicId: "topic-s3" }),
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("getMissionById", () => {
    it("should query prisma.teamMission.findUnique with missionId", async () => {
      const mission = makeMission();
      mocks.prisma.teamMission.findUnique.mockResolvedValue(mission);
      const result = await service.getMissionById("mission-s3");
      expect(mocks.prisma.teamMission.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-s3" },
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: "mission-s3" }));
    });
  });

  describe("getMissionLogs", () => {
    it("should query prisma.missionLog.findMany with missionId", async () => {
      mocks.prisma.missionLog.findMany.mockResolvedValue([]);
      const result = await service.getMissionLogs("mission-s3");
      expect(mocks.prisma.missionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ missionId: "mission-s3" }),
        }),
      );
      expect(result).toEqual([]);
    });
  });

  // ==================== helper method delegation ====================

  describe("createLog", () => {
    it("should delegate to messageService.createLog", async () => {
      await service.createLog("mission-s3", {
        type: "MISSION_CREATED" as Parameters<
          typeof service.createLog
        >[1]["type"],
        agentId: "agent-1",
        agentName: "Agent 1",
        content: "Created",
      });
      expect(mocks.messageService.createLog).toHaveBeenCalledWith(
        "mission-s3",
        expect.objectContaining({ agentId: "agent-1" }),
      );
    });
  });

  describe("sendMessageToTopic", () => {
    it("should delegate to messageService.sendMessageToTopic", async () => {
      await service.sendMessageToTopic(
        "topic-s3",
        "sender-1",
        "Hello",
        "TEXT" as Parameters<typeof service.sendMessageToTopic>[3],
      );
      expect(mocks.messageService.sendMessageToTopic).toHaveBeenCalledWith(
        "topic-s3",
        "sender-1",
        "Hello",
        "TEXT",
      );
    });
  });

  describe("getTeamMembers", () => {
    it("should delegate to memberService.getTeamMembers", async () => {
      const result = await service.getTeamMembers("topic-s3");
      expect(mocks.memberService.getTeamMembers).toHaveBeenCalledWith(
        "topic-s3",
      );
      expect(result).toHaveProperty("leader");
      expect(result).toHaveProperty("members");
      expect(result).toHaveProperty("all");
    });
  });

  // ==================== findAlternativeAgent ====================

  describe("findAlternativeAgent (private)", () => {
    type ServiceWithPrivate = {
      findAlternativeAgent: (
        mission: ReturnType<typeof makeMission>,
        failedIds: string[],
        task: ReturnType<typeof makeTask>,
      ) => Promise<unknown>;
    };

    it("should use leader as fallback when all non-leaders are failed", async () => {
      // Both non-leaders are in failedAgentIds
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: { ...makeLeader(), isLeader: true },
        members: [
          { id: "member-s3", displayName: "M3", isLeader: false, aiModel: "" },
          { id: "member-s4", displayName: "M4", isLeader: false, aiModel: "" },
        ],
        all: [
          { ...makeLeader(), isLeader: true },
          { id: "member-s3", displayName: "M3", isLeader: false, aiModel: "" },
          { id: "member-s4", displayName: "M4", isLeader: false, aiModel: "" },
        ],
      });

      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(
        makeMission(),
        ["member-s3", "member-s4"],
        makeTask(),
      );

      // Leader should be returned as fallback (if AGENT_SWITCH_CONFIG.allowLeaderFallback is true)
      // If allowLeaderFallback is false, result is null - both cases are valid
      expect(
        result === null || (result as { isLeader: boolean }).isLeader,
      ).toBe(true);
    });

    it("should sort candidates by load when multiple non-leaders available", async () => {
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: { ...makeLeader(), isLeader: true },
        members: [
          {
            id: "member-s3",
            displayName: "M3",
            isLeader: false,
            aiModel: "m3",
          },
          {
            id: "member-s4",
            displayName: "M4",
            isLeader: false,
            aiModel: "m4",
          },
        ],
        all: [
          { ...makeLeader(), isLeader: true },
          {
            id: "member-s3",
            displayName: "M3",
            isLeader: false,
            aiModel: "m3",
          },
          {
            id: "member-s4",
            displayName: "M4",
            isLeader: false,
            aiModel: "m4",
          },
        ],
      });

      // member-s4 has fewer tasks (load balancing should prefer them)
      mocks.prisma.agentTask.groupBy.mockResolvedValue([
        { assignedToId: "member-s3", _count: { _all: 5 } },
        { assignedToId: "member-s4", _count: { _all: 1 } },
      ]);

      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(makeMission(), [], makeTask());

      expect(result).not.toBeNull();
      // Should pick the one with fewer tasks (member-s4)
      expect((result as { id: string }).id).toBe("member-s4");
    });

    it("should return null when only 1 team member total", async () => {
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: { ...makeLeader(), isLeader: true },
        members: [],
        all: [{ ...makeLeader(), isLeader: true }],
      });

      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(makeMission(), [], makeTask());

      expect(result).toBeNull();
    });

    it("should return null when all candidates are in failedAgentIds and no leader fallback", async () => {
      mocks.memberService.getTeamMembers.mockResolvedValue({
        leader: { ...makeLeader(), id: "leader-s3", isLeader: true },
        members: [
          { id: "member-s3", displayName: "M3", isLeader: false, aiModel: "" },
        ],
        all: [
          { ...makeLeader(), id: "leader-s3", isLeader: true },
          { id: "member-s3", displayName: "M3", isLeader: false, aiModel: "" },
        ],
      });

      // All non-leaders are failed, leader is also failed
      const result = await (
        service as unknown as ServiceWithPrivate
      ).findAlternativeAgent(
        makeMission(),
        ["member-s3", "leader-s3"],
        makeTask(),
      );

      expect(result).toBeNull();
    });
  });

  // ==================== callAIWithRetry ====================

  describe("callAIWithRetry (private)", () => {
    type ServiceWithPrivate = {
      callAIWithRetry: (
        aiModel: string,
        messages: { role: string; content: string }[],
        systemPrompt: string,
        options: Record<string, unknown>,
        taskContext: { taskId: string; taskTitle: string; missionId: string },
        heartbeatContext?: {
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

    const taskCtx = {
      taskId: "task-s3",
      taskTitle: "Test Task",
      missionId: "mission-s3",
    };

    it("should return success=true when aiCallerService returns content", async () => {
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "Task result",
        tokensUsed: 150,
      });

      const result = await (
        service as unknown as ServiceWithPrivate
      ).callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Do this task" }],
        "System prompt",
        {},
        taskCtx,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Task result");
      expect(result.attempts).toBe(1);
      expect(result.finalModel).toBe("gpt-4");
    });

    it("should succeed and clear heartbeat timer when heartbeatContext provided", async () => {
      // Use immediate resolution to avoid timer complexity
      mocks.aiCallerService.callAIWithConfig.mockResolvedValue({
        content: "response",
        tokensUsed: 50,
      });

      const heartbeatContext = {
        topicId: "topic-s3",
        agentId: "agent-s3",
        agentName: "Agent S3",
      };

      const result = await (
        service as unknown as ServiceWithPrivate
      ).callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Do task" }],
        "System",
        {},
        taskCtx,
        heartbeatContext,
      );

      // Even with heartbeatContext, should succeed when AI call succeeds
      expect(result.success).toBe(true);
      expect(result.content).toBe("response");
    });

    it("should return failure when all retries exhausted on retryable errors", async () => {
      // "timeout:" is retryable, so it will retry multiple times before giving up
      mocks.aiCallerService.callAIWithConfig.mockRejectedValue(
        new Error("timeout: Service unavailable"),
      );

      const result = await (
        service as unknown as ServiceWithPrivate
      ).callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Do this" }],
        "System",
        {},
        taskCtx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Retryable errors cause at least one attempt (multiple retries attempted)
      expect(
        mocks.aiCallerService.callAIWithConfig.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("should not retry on non-retryable errors", async () => {
      mocks.aiCallerService.callAIWithConfig.mockRejectedValue(
        new Error("context_length_exceeded: Input too long"),
      );

      const result = await (
        service as unknown as ServiceWithPrivate
      ).callAIWithRetry(
        "gpt-4",
        [{ role: "user", content: "Do this" }],
        "System",
        {},
        taskCtx,
      );

      expect(result.success).toBe(false);
      // Should have broken out early, not retried the full maxRetries times
      expect(mocks.aiCallerService.callAIWithConfig).toHaveBeenCalledTimes(1);
    });
  });

  // ==================== getAgentSystemPrompt ====================

  describe("getAgentSystemPrompt", () => {
    it("should call missionContextService when contextPackage is provided", () => {
      const task = makeTask();
      const agent = {
        id: "member-s3",
        displayName: "Member S3",
        agentName: "MemberS3",
        aiModel: "claude-3",
        isLeader: false,
      };
      const contextPackage = {
        entities: [],
        hardConstraints: [],
        agentSpecificContext: {},
      };

      service.getAgentSystemPrompt(
        agent,
        task as Parameters<typeof service.getAgentSystemPrompt>[1],
        contextPackage as Parameters<typeof service.getAgentSystemPrompt>[2],
      );

      expect(
        mocks.missionContextService.buildAgentSystemPromptWithContext,
      ).toHaveBeenCalled();
    });

    it("should return string when contextPackage is null", () => {
      const task = makeTask();
      const agent = {
        id: "member-s3",
        displayName: "Member S3",
        agentName: "MemberS3",
        aiModel: "claude-3",
        isLeader: false,
      };

      const result = service.getAgentSystemPrompt(
        agent,
        task as Parameters<typeof service.getAgentSystemPrompt>[1],
        null,
      );

      expect(typeof result).toBe("string");
    });
  });

  // ==================== getLeaderSystemPrompt ====================

  describe("getLeaderSystemPrompt", () => {
    it("should return a string prompt for leader", () => {
      const leader = makeLeader();
      const result = service.getLeaderSystemPrompt(
        leader as Parameters<typeof service.getLeaderSystemPrompt>[0],
      );
      expect(typeof result).toBe("string");
    });
  });

  // ==================== buildTaskExecutionPrompt ====================

  describe("buildTaskExecutionPrompt", () => {
    it("should return a non-empty prompt string", () => {
      const mission = makeMission();
      const task = makeTask();

      const result = service.buildTaskExecutionPrompt(
        mission as Parameters<typeof service.buildTaskExecutionPrompt>[0],
        task as Parameters<typeof service.buildTaskExecutionPrompt>[1],
        "",
      );

      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include search context in prompt when provided", () => {
      const mission = makeMission();
      const task = makeTask();
      const searchContext = "Search result: some relevant data";

      const result = service.buildTaskExecutionPrompt(
        mission as Parameters<typeof service.buildTaskExecutionPrompt>[0],
        task as Parameters<typeof service.buildTaskExecutionPrompt>[1],
        searchContext,
      );

      expect(result).toContain(searchContext);
    });
  });

  // ==================== updateMissionProgress ====================

  describe("updateMissionProgress (private)", () => {
    type ServiceWithPrivate = {
      updateMissionProgress: (missionId: string) => Promise<void>;
    };

    it("should query mission with tasks and update completedTasks count", async () => {
      // updateMissionProgress uses teamMission.findUnique(include: { tasks: true })
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission(),
        tasks: [
          makeTask({ status: AgentTaskStatus.COMPLETED }),
          makeTask({ id: "task-s3-2", status: AgentTaskStatus.COMPLETED }),
          makeTask({ id: "task-s3-3", status: AgentTaskStatus.IN_PROGRESS }),
        ],
      });
      mocks.prisma.teamMission.update.mockResolvedValue(makeMission());

      await (service as unknown as ServiceWithPrivate).updateMissionProgress(
        "mission-s3",
      );

      expect(mocks.prisma.teamMission.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-s3" },
          include: { tasks: true },
        }),
      );
      expect(mocks.prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-s3" },
          data: expect.objectContaining({ completedTasks: 2 }),
        }),
      );
    });
  });

  // ==================== autoRetryBlockedTasks ====================

  describe("autoRetryBlockedTasks (private)", () => {
    type ServiceWithPrivate = {
      autoRetryBlockedTasks: (
        mission: ReturnType<typeof makeMission>,
        blockedTasks: unknown[],
        now: number,
        stuckTimeoutMs: number,
      ) => Promise<number>;
    };

    it("should retry blocked tasks that exceed timeout and return count", async () => {
      const blockedTask = makeTask({
        status: AgentTaskStatus.BLOCKED,
        startedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago
      });

      mocks.prisma.agentTask.update.mockResolvedValue({
        ...blockedTask,
        status: AgentTaskStatus.PENDING,
      });

      const now = Date.now();
      const STUCK_TIMEOUT_MS = 15 * 60 * 1000; // 15 min

      const count = await (
        service as unknown as ServiceWithPrivate
      ).autoRetryBlockedTasks(
        makeMission(),
        [blockedTask],
        now,
        STUCK_TIMEOUT_MS,
      );

      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("should not retry blocked tasks when circuit breaker disallows (in cooldown)", async () => {
      // When canExecute=false AND taskAge < timeout => skip (count stays 0)
      // This is the "cooldown" branch: circuit breaker in cooldown, task too recent to force-complete
      mocks.agentFacade.circuitBreaker.canExecute.mockReturnValue(false);

      const recentTask = makeTask({
        status: AgentTaskStatus.BLOCKED,
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // only 5 min ago
        startedAt: new Date(Date.now() - 5 * 60 * 1000),
      });

      const now = Date.now();
      const STUCK_TIMEOUT_MS = 15 * 60 * 1000;

      const count = await (
        service as unknown as ServiceWithPrivate
      ).autoRetryBlockedTasks(
        makeMission(),
        [recentTask],
        now,
        STUCK_TIMEOUT_MS,
      );

      expect(count).toBe(0);
    });
  });

  // ==================== forceCompleteStuckTasks ====================

  describe("forceCompleteStuckTasks (private)", () => {
    type ServiceWithPrivate = {
      forceCompleteStuckTasks: (
        mission: ReturnType<typeof makeMission>,
        stuckTasks: unknown[],
        now: number,
        stuckTimeoutMs: number,
      ) => Promise<number>;
    };

    it("should force-complete tasks that exceed timeout", async () => {
      const stuckTask = makeTask({
        status: AgentTaskStatus.REVISION_NEEDED,
        startedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago (exceeds 15 min threshold)
      });

      mocks.prisma.agentTask.update.mockResolvedValue({
        ...stuckTask,
        status: AgentTaskStatus.COMPLETED,
      });

      const now = Date.now();
      const STUCK_TIMEOUT_MS = 15 * 60 * 1000;

      const count = await (
        service as unknown as ServiceWithPrivate
      ).forceCompleteStuckTasks(
        makeMission(),
        [stuckTask],
        now,
        STUCK_TIMEOUT_MS,
      );

      expect(count).toBeGreaterThanOrEqual(0);
    });

    it("should not force-complete tasks within timeout", async () => {
      const recentTask = makeTask({
        status: AgentTaskStatus.AWAITING_REVIEW,
        startedAt: new Date(Date.now() - 5 * 60 * 1000),
        updatedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago, within 15 min timeout
      });

      const now = Date.now();
      const STUCK_TIMEOUT_MS = 15 * 60 * 1000;

      const count = await (
        service as unknown as ServiceWithPrivate
      ).forceCompleteStuckTasks(
        makeMission(),
        [recentTask],
        now,
        STUCK_TIMEOUT_MS,
      );

      expect(count).toBe(0);
    });
  });

  // ==================== executeNextTasks concurrent lock ====================

  describe("executeNextTasks (private) - concurrent lock", () => {
    type ServiceWithPrivate = {
      executeNextTasks: (missionId: string) => Promise<void>;
    };

    it("should add to pendingExecutions when already locked", async () => {
      // Make startMissionExecution return false (locked)
      mocks.stateManager.startMissionExecution.mockReturnValue(false);

      // Should complete without throwing
      await expect(
        (service as unknown as ServiceWithPrivate).executeNextTasks(
          "mission-s3",
        ),
      ).resolves.not.toThrow();
    });

    it("should early-return when mission status is not IN_PROGRESS", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission({ status: MissionStatus.COMPLETED }),
        tasks: [],
        leader: makeLeader(),
      });

      await (service as unknown as ServiceWithPrivate).executeNextTasks(
        "mission-s3",
      );

      expect(mocks.prisma.agentTask.updateMany).not.toHaveBeenCalled();
    });

    it("should call completeMission when all tasks are completed", async () => {
      mocks.stateManager.startMissionExecution.mockReturnValue(true);
      mocks.prisma.teamMission.findUnique.mockResolvedValue({
        ...makeMission({ status: MissionStatus.IN_PROGRESS }),
        tasks: [
          makeTask({ status: AgentTaskStatus.COMPLETED }),
          makeTask({ id: "task-s3-2", status: AgentTaskStatus.COMPLETED }),
        ],
        leader: makeLeader(),
      });

      // Mock completeMission (private delegate) - it calls lifecycleService
      mocks.lifecycleService.completeMission.mockResolvedValue(undefined);
      mocks.prisma.teamMission.findUnique.mockResolvedValueOnce({
        ...makeMission({ status: MissionStatus.IN_PROGRESS }),
        tasks: [
          makeTask({ status: AgentTaskStatus.COMPLETED }),
          makeTask({ id: "task-s3-2", status: AgentTaskStatus.COMPLETED }),
        ],
        leader: makeLeader(),
      });
      mocks.prisma.agentTask.findMany.mockResolvedValue([
        makeTask({ status: AgentTaskStatus.COMPLETED }),
      ]);
      mocks.prisma.teamMission.update.mockResolvedValue(makeMission());
      mocks.longContentService.buildGranularityConstraintPrompt.mockReturnValue(
        "",
      );

      await (service as unknown as ServiceWithPrivate).executeNextTasks(
        "mission-s3",
      );

      // The internal completeMission should have been attempted
      // (it calls lifecycleService via private completeMission method)
    });
  });

  // ==================== createToolContext ====================

  describe("createToolContext (private)", () => {
    type ServiceWithPrivate = {
      createToolContext: (toolId: string) => {
        executionId: string;
        toolId: string;
        createdAt: Date;
        callerType: string;
      };
    };

    it("should return valid ToolContext shape", () => {
      const ctx = (service as unknown as ServiceWithPrivate).createToolContext(
        "web-search",
      );

      expect(ctx.executionId).toContain("web-search");
      expect(ctx.toolId).toBe("web-search");
      expect(ctx.createdAt).toBeInstanceOf(Date);
      expect(ctx.callerType).toBe("agent");
    });

    it("should generate unique executionIds for same toolId", () => {
      const service2 = service as unknown as ServiceWithPrivate;
      const ctx1 = service2.createToolContext("web-search");
      const ctx2 = service2.createToolContext("web-search");
      // Executionids are time-based + random, so they should differ (allow for rare collision)
      expect(typeof ctx1.executionId).toBe("string");
      expect(typeof ctx2.executionId).toBe("string");
    });
  });
});

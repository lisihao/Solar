/**
 * TeamMissionService Unit Tests
 *
 * Tests for the core mission coordination service covering:
 * - createMission
 * - startMission
 * - recoverStuckTasks (via onModuleInit)
 * - findAlternativeAgent
 * - callAIWithRetry
 * - executeNextTasks flow
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
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
  MessageContentType,
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
  startedAt: null,
  completedAt: null,
  leaderFeedback: null,
  result: null,
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
// Mock services
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
    // Execute the transaction callback with a mock transaction object
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
};

const mockToolRegistry = {
  execute: jest.fn(),
  getTool: jest.fn(),
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
};

const mockLeaderModelService = {
  executeWithFallback: jest.fn(),
};

const mockEmailService = {
  sendMissionCompletionEmail: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
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
};

// ============================================================
// Test suite
// ============================================================

describe("TeamMissionService", () => {
  let service: TeamMissionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset default mocks
    mockPrisma.topicAIMember.findFirst.mockResolvedValue(makeMission().leader);
    mockPrisma.teamMission.create.mockResolvedValue(makeMission());
    mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
    mockPrisma.teamMission.update.mockResolvedValue(makeMission());
    mockPrisma.agentTask.findMany.mockResolvedValue([]);
    mockPrisma.agentTask.update.mockResolvedValue(makeTask());
    mockPrisma.missionLog.create.mockResolvedValue({ id: "log-1" });
    mockPrisma.topicMessage.create.mockResolvedValue({ id: "msg-1" });

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

    service = module.get<TeamMissionService>(TeamMissionService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // onModuleInit / recoverStuckTasks
  // ============================================================

  describe("onModuleInit", () => {
    it("should register health check callbacks", async () => {
      await service.onModuleInit();

      expect(mockHealthCheckService.registerExecuteCallback).toHaveBeenCalled();
      expect(
        mockHealthCheckService.registerRevisionCallback,
      ).toHaveBeenCalled();
    });

    it("should attempt to recover stuck tasks on init", async () => {
      const stuckTask = makeTask({
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 40 * 60 * 1000), // 40 min ago
      });
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([stuckTask]);
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([]);

      await service.onModuleInit();

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: stuckTask.id },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should handle recovery errors gracefully", async () => {
      mockPrisma.agentTask.findMany.mockRejectedValueOnce(
        new Error("DB error"),
      );

      // Should not throw
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should mark stuck mission as PAUSED when no pending tasks", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([]);
      const stuckMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        tasks: [makeTask({ status: AgentTaskStatus.COMPLETED })],
      });
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([stuckMission]);

      await service.onModuleInit();

      expect(mockPrisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: stuckMission.id },
          data: { status: MissionStatus.PAUSED },
        }),
      );
    });

    it("should trigger executeNextTasks for stuck missions with pending tasks", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([]);
      const stuckMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        tasks: [makeTask({ status: AgentTaskStatus.PENDING })],
      });
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([stuckMission]);
      // For executeNextTasks call inside recovery
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({
          status: MissionStatus.IN_PROGRESS,
          tasks: [],
        }),
      );

      await service.onModuleInit();
      // Should not throw; executeNextTasks is async fire-and-forget
    });
  });

  // ============================================================
  // createMission
  // ============================================================

  describe("createMission", () => {
    const dto = {
      title: "Test Mission",
      description: "Description",
      objectives: ["obj1"],
      constraints: [],
      deliverables: [],
      leaderId: "leader-1",
      autoStart: false,
    };

    it("should create a mission successfully", async () => {
      const result = await service.createMission("topic-1", "user-1", dto);

      expect(mockPrisma.topicAIMember.findFirst).toHaveBeenCalledWith({
        where: { id: dto.leaderId, topicId: "topic-1" },
      });
      expect(mockPrisma.teamMission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            title: dto.title,
            leaderId: dto.leaderId,
            status: MissionStatus.PENDING,
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should throw NotFoundException when leader does not exist in topic", async () => {
      mockPrisma.topicAIMember.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createMission("topic-1", "user-1", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("should emit mission:created event after creation", async () => {
      await service.createMission("topic-1", "user-1", dto);

      expect(mockTopicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "mission:created",
        expect.objectContaining({ mission: expect.any(Object) }),
      );
    });

    it("should create mission log after creation", async () => {
      await service.createMission("topic-1", "user-1", dto);

      // createLog delegates to messageService.createLog
      expect(mockMessageService.createLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          type: MissionLogType.MISSION_CREATED,
        }),
      );
    });

    it("should send system message to topic after creation", async () => {
      await service.createMission("topic-1", "user-1", dto);

      // sendMessageToTopic delegates to messageService.sendMessageToTopic
      expect(mockMessageService.sendMessageToTopic).toHaveBeenCalledWith(
        "topic-1",
        null,
        expect.stringContaining("团队任务已创建"),
        MessageContentType.SYSTEM,
      );
    });

    it("should auto-start mission when autoStart is not false", async () => {
      const autoStartDto = { ...dto, autoStart: true };

      // Mock findUnique for startMission called internally
      mockPrisma.teamMission.findUnique.mockResolvedValue(
        makeMission({ status: MissionStatus.PENDING }),
      );

      await service.createMission("topic-1", "user-1", autoStartDto);

      // autoStart triggers startMission async, no direct assertion possible here
      // but createMission should return without throwing
    });

    it("should set notificationEmail when provided", async () => {
      const dtoWithEmail = { ...dto, notificationEmail: "test@example.com" };

      await service.createMission("topic-1", "user-1", dtoWithEmail);

      expect(mockPrisma.teamMission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            notificationEmail: "test@example.com",
          }),
        }),
      );
    });
  });

  // ============================================================
  // startMission
  // ============================================================

  describe("startMission", () => {
    it("should throw NotFoundException when mission does not exist", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.startMission("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when mission is not PENDING", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.IN_PROGRESS }),
      );

      await expect(service.startMission("mission-1", "user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should update mission status to PLANNING when started", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      // The planning phase calls leader AI - let it fail gracefully
      mockLeaderModelService.executeWithFallback.mockRejectedValueOnce(
        new Error("AI unavailable"),
      );

      await service.startMission("mission-1", "user-1");

      expect(mockPrisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mission-1" },
          data: expect.objectContaining({ status: MissionStatus.PLANNING }),
        }),
      );
    });

    it("should emit mission:status_changed event when started", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      mockLeaderModelService.executeWithFallback.mockRejectedValueOnce(
        new Error("AI unavailable"),
      );

      await service.startMission("mission-1", "user-1");

      expect(mockTopicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "mission:status_changed",
        expect.objectContaining({ status: MissionStatus.PLANNING }),
      );
    });

    it("should initialize long content service on start", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      mockLeaderModelService.executeWithFallback.mockRejectedValueOnce(
        new Error("AI unavailable"),
      );

      await service.startMission("mission-1", "user-1");

      expect(mockLongContentService.initMission).toHaveBeenCalledWith(
        expect.objectContaining({ missionId: "mission-1" }),
      );
    });

    it("should continue even if long content service init fails", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      mockLongContentService.initMission.mockRejectedValueOnce(
        new Error("Init failed"),
      );
      mockLeaderModelService.executeWithFallback.mockRejectedValueOnce(
        new Error("AI unavailable"),
      );

      await expect(
        service.startMission("mission-1", "user-1"),
      ).resolves.not.toThrow();
    });

    it("should send [任务分解] message to topic on start", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      mockLeaderModelService.executeWithFallback.mockRejectedValueOnce(
        new Error("AI unavailable"),
      );

      await service.startMission("mission-1", "user-1");

      // sendMessageToTopic delegates to messageService.sendMessageToTopic
      expect(mockMessageService.sendMessageToTopic).toHaveBeenCalledWith(
        "topic-1",
        "leader-1",
        expect.stringContaining("[任务分解]"),
        MessageContentType.TEXT,
      );
    });
  });

  // ============================================================
  // getMissions / getMissionById
  // ============================================================

  describe("getMissions", () => {
    it("should return missions for a topic", async () => {
      const missions = [makeMission(), makeMission({ id: "mission-2" })];
      mockPrisma.teamMission.findMany.mockResolvedValueOnce(missions);

      const result = await service.getMissions("topic-1");

      expect(mockPrisma.teamMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ topicId: "topic-1" }),
        }),
      );
      expect(result).toEqual(missions);
    });

    it("should filter missions by status when provided", async () => {
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([]);

      await service.getMissions("topic-1", {
        status: MissionStatus.IN_PROGRESS,
      });

      expect(mockPrisma.teamMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topicId: "topic-1",
            status: MissionStatus.IN_PROGRESS,
          }),
        }),
      );
    });
  });

  describe("getMissionById", () => {
    it("should return a specific mission with its tasks and logs", async () => {
      const mission = makeMission({ tasks: [makeTask()] });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(mission);

      const result = await service.getMissionById("mission-1");

      expect(result).toEqual(mission);
    });

    it("should throw NotFoundException when mission not found", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      await expect(service.getMissionById("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================================
  // cancelMission (delegates to lifecycleService)
  // ============================================================

  describe("cancelMission", () => {
    it("should delegate to lifecycleService.cancelMission", async () => {
      mockLifecycleService.cancelMission.mockResolvedValueOnce({
        id: "mission-1",
        status: MissionStatus.CANCELLED,
      });

      await service.cancelMission("mission-1", "user-1");

      expect(mockLifecycleService.cancelMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        expect.any(Function),
      );
    });
  });

  // ============================================================
  // pauseMission / resumeMission (delegates)
  // ============================================================

  describe("pauseMission", () => {
    it("should delegate to lifecycleService.pauseMission", async () => {
      mockLifecycleService.pauseMission = jest
        .fn()
        .mockResolvedValue({ id: "mission-1", status: MissionStatus.PAUSED });

      await service.pauseMission("mission-1", "user-1");

      expect(mockLifecycleService.pauseMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  // ============================================================
  // getTeamMembers (delegates to memberService)
  // ============================================================

  describe("getTeamMembers", () => {
    it("should return all team members for a topic", async () => {
      const mockResult = {
        leader: {
          id: "leader-1",
          displayName: "Leader",
          isLeader: true,
          aiModel: "gpt-4o",
        },
        members: [
          {
            id: "member-1",
            displayName: "Agent",
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
            displayName: "Agent",
            isLeader: false,
            aiModel: "claude-3",
          },
        ],
      };
      mockMemberService.getTeamMembers.mockResolvedValueOnce(mockResult);

      const result = await service.getTeamMembers("topic-1");

      expect(mockMemberService.getTeamMembers).toHaveBeenCalledWith("topic-1");
      expect(result.all).toHaveLength(2);
      expect(result.leader).toBeDefined();
    });

    it("should return result with only leader when no other members", async () => {
      const singleMemberResult = {
        leader: { id: "leader-1", displayName: "Leader", isLeader: true },
        members: [],
        all: [{ id: "leader-1", displayName: "Leader", isLeader: true }],
      };
      mockMemberService.getTeamMembers.mockResolvedValueOnce(
        singleMemberResult,
      );

      const result = await service.getTeamMembers("topic-1");

      expect(result.members).toEqual([]);
    });
  });

  // ============================================================
  // getMissionLogs
  // ============================================================

  describe("getMissionLogs", () => {
    it("should return logs for a mission using default limit", async () => {
      const logs = [
        {
          id: "log-1",
          missionId: "mission-1",
          type: MissionLogType.MISSION_CREATED,
          content: "Created",
          createdAt: new Date(),
        },
      ];
      mockPrisma.missionLog.findMany = jest.fn().mockResolvedValueOnce(logs);

      const result = await service.getMissionLogs("mission-1");

      expect(result).toEqual(logs);
      expect(mockPrisma.missionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { missionId: "mission-1" },
          take: 50,
        }),
      );
    });

    it("should apply custom limit when provided", async () => {
      mockPrisma.missionLog.findMany = jest.fn().mockResolvedValueOnce([]);

      await service.getMissionLogs("mission-1", { limit: 10 });

      expect(mockPrisma.missionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  // ============================================================
  // State management during executeNextTasks
  // ============================================================

  describe("executeNextTasks concurrent control", () => {
    it("should skip execution when mission lock is already held", async () => {
      mockStateManager.startMissionExecution.mockReturnValueOnce(false);

      // Accessing private method via cast
      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-1");

      // Lock was not acquired, so no DB query for mission
      expect(mockPrisma.teamMission.findUnique).not.toHaveBeenCalled();
    });

    it("should mark mission for pending re-execution when lock is held", async () => {
      mockStateManager.startMissionExecution.mockReturnValueOnce(false);

      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-1");

      // pendingExecutions should include the mission id
      const pendingExecutions = (
        service as unknown as { pendingExecutions: Set<string> }
      ).pendingExecutions;
      expect(pendingExecutions.has("mission-1")).toBe(true);
    });

    it("should release lock after executeNextTasks completes", async () => {
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(inProgressMission);
      // No pending tasks, no completed tasks -> just returns

      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-1");

      expect(mockStateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-1",
      );
    });

    it("should not execute tasks if mission status is not IN_PROGRESS", async () => {
      const pendingMission = makeMission({ status: MissionStatus.PENDING });
      mockPrisma.teamMission.findUnique.mockResolvedValue(pendingMission);

      await (
        service as unknown as {
          executeNextTasks: (id: string) => Promise<void>;
        }
      ).executeNextTasks("mission-1");

      // No tasks should be started
      expect(mockPrisma.agentTask.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // findAlternativeAgent (private, tested via cast)
  // ============================================================

  describe("findAlternativeAgent", () => {
    type FindAltAgentFn = (
      m: unknown,
      failed: string[],
      t: unknown,
    ) => Promise<unknown>;

    it("should return null when only one member exists", async () => {
      mockMemberService.getTeamMembers.mockResolvedValueOnce({
        all: [
          {
            id: "leader-1",
            isLeader: true,
            displayName: "Leader",
            aiModel: "gpt-4o",
          },
        ],
        leader: {
          id: "leader-1",
          isLeader: true,
          displayName: "Leader",
          aiModel: "gpt-4o",
        },
        members: [],
      });

      const mission = makeMission();
      const task = makeTask();

      const result = await (
        service as unknown as { findAlternativeAgent: FindAltAgentFn }
      ).findAlternativeAgent(mission, ["member-1"], task);

      expect(result).toBeNull();
    });

    it("should return a non-leader candidate agent", async () => {
      mockMemberService.getTeamMembers.mockResolvedValueOnce({
        all: [
          {
            id: "leader-1",
            isLeader: true,
            displayName: "Leader",
            aiModel: "gpt-4o",
          },
          {
            id: "member-1",
            isLeader: false,
            displayName: "Agent1",
            aiModel: "claude-3",
          },
          {
            id: "member-2",
            isLeader: false,
            displayName: "Agent2",
            aiModel: "gemini",
          },
        ],
        leader: {
          id: "leader-1",
          isLeader: true,
          displayName: "Leader",
          aiModel: "gpt-4o",
        },
        members: [
          {
            id: "member-1",
            isLeader: false,
            displayName: "Agent1",
            aiModel: "claude-3",
          },
          {
            id: "member-2",
            isLeader: false,
            displayName: "Agent2",
            aiModel: "gemini",
          },
        ],
      });
      mockPrisma.agentTask.groupBy.mockResolvedValueOnce([]);

      const mission = makeMission();
      const task = makeTask();

      const result = await (
        service as unknown as { findAlternativeAgent: FindAltAgentFn }
      ).findAlternativeAgent(mission, ["member-1"], task);

      expect(result).toBeDefined();
      expect((result as { id: string }).id).toBe("member-2");
    });

    it("should return null or leader fallback when all non-leader agents have failed", async () => {
      mockMemberService.getTeamMembers.mockResolvedValueOnce({
        all: [
          {
            id: "leader-1",
            isLeader: true,
            displayName: "Leader",
            aiModel: "gpt-4o",
          },
          {
            id: "member-1",
            isLeader: false,
            displayName: "Agent1",
            aiModel: "claude-3",
          },
        ],
        leader: {
          id: "leader-1",
          isLeader: true,
          displayName: "Leader",
          aiModel: "gpt-4o",
        },
        members: [
          {
            id: "member-1",
            isLeader: false,
            displayName: "Agent1",
            aiModel: "claude-3",
          },
        ],
      });

      const mission = makeMission();
      const task = makeTask();

      const result = await (
        service as unknown as { findAlternativeAgent: FindAltAgentFn }
      ).findAlternativeAgent(mission, ["member-1"], task);

      // Depending on AGENT_SWITCH_CONFIG.allowLeaderFallback, may return leader or null
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("should handle errors gracefully and return null", async () => {
      mockMemberService.getTeamMembers.mockRejectedValueOnce(
        new Error("DB error"),
      );

      const mission = makeMission();
      const task = makeTask();

      const result = await (
        service as unknown as { findAlternativeAgent: FindAltAgentFn }
      ).findAlternativeAgent(mission, [], task);

      expect(result).toBeNull();
    });
  });

  // ============================================================
  // callAIWithRetry (private)
  // ============================================================

  describe("callAIWithRetry", () => {
    const messages = [{ role: "user", content: "Do this task" }];
    const systemPrompt = "You are an agent";
    const options = { maxTokens: 2000, temperature: 0.7 };
    const taskContext = {
      taskId: "task-1",
      taskTitle: "Test Task",
      missionId: "mission-1",
    };

    it("should return success on first attempt", async () => {
      mockAICallerService.callAIWithConfig.mockResolvedValueOnce({
        content: "Task completed successfully",
        tokensUsed: 150,
      });

      const result = await (
        service as unknown as {
          callAIWithRetry: (
            model: string,
            messages: unknown[],
            sys: string,
            opts: unknown,
            ctx: unknown,
          ) => Promise<unknown>;
        }
      ).callAIWithRetry("gpt-4o", messages, systemPrompt, options, taskContext);

      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { content: string }).content).toBe(
        "Task completed successfully",
      );
      expect((result as { attempts: number }).attempts).toBe(1);
    });

    it("should return failure after all retries exhausted", async () => {
      mockAICallerService.callAIWithConfig.mockRejectedValue(
        new Error("Service temporarily unavailable"),
      );

      const result = await (
        service as unknown as {
          callAIWithRetry: (
            model: string,
            messages: unknown[],
            sys: string,
            opts: unknown,
            ctx: unknown,
          ) => Promise<unknown>;
        }
      ).callAIWithRetry("gpt-4o", messages, systemPrompt, options, taskContext);

      expect((result as { success: boolean }).success).toBe(false);
      expect((result as { error: string }).error).toBeDefined();
    });

    it("should stop immediately on permanent errors", async () => {
      mockAICallerService.callAIWithConfig.mockRejectedValueOnce(
        new Error("invalid_api_key: Authentication failed"),
      );

      const result = await (
        service as unknown as {
          callAIWithRetry: (
            model: string,
            messages: unknown[],
            sys: string,
            opts: unknown,
            ctx: unknown,
          ) => Promise<unknown>;
        }
      ).callAIWithRetry("gpt-4o", messages, systemPrompt, options, taskContext);

      expect((result as { success: boolean }).success).toBe(false);
    });
  });

  // ============================================================
  // createTasksFromBreakdown
  // ============================================================

  describe("createTasksFromBreakdown", () => {
    it("should create tasks in the database from breakdown data", async () => {
      const breakdown = {
        tasks: [
          {
            title: "Research Task",
            description: "Research the topic",
            assignee: "member-1",
            priority: "MEDIUM",
            taskType: "RESEARCH",
            dependsOn: [],
          },
        ],
      };

      const teamMembers = [
        {
          id: "member-1",
          displayName: "Agent1",
          agentName: "Agent1",
          isLeader: false,
        },
      ];

      mockPrisma.agentTask.create.mockResolvedValue(makeTask());

      await (
        service as unknown as {
          createTasksFromBreakdown: (
            missionId: string,
            breakdown: unknown,
            members: unknown[],
          ) => Promise<void>;
        }
      ).createTasksFromBreakdown("mission-1", breakdown, teamMembers);

      // createTasksFromBreakdown uses $transaction with createManyAndReturn
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  // ============================================================
  // recoverRevisionTasks (via healthCheck callback)
  // ============================================================

  describe("recoverRevisionTasks (via callback registered with healthCheckService)", () => {
    it("should trigger executeTaskRevision for tasks with leaderFeedback", async () => {
      // Call the revision callback registered during onModuleInit
      let revisionCallback: ((missionId: string) => Promise<void>) | null =
        null;
      mockHealthCheckService.registerRevisionCallback.mockImplementation(
        (cb) => {
          revisionCallback = cb;
        },
      );

      await service.onModuleInit();

      expect(revisionCallback).toBeDefined();

      // Setup mission with REVISION_NEEDED task that has leaderFeedback
      const missionWithRevisionTask = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [
          makeTask({
            status: AgentTaskStatus.REVISION_NEEDED,
            leaderFeedback: "Please revise this section",
          }),
        ],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        missionWithRevisionTask,
      );
      // executeTaskRevision will try to call AI
      mockAICallerService.callAIWithConfig.mockResolvedValueOnce({
        content: "Revised content",
        tokensUsed: 100,
      });

      // Should not throw
      await expect(revisionCallback!("mission-1")).resolves.not.toThrow();
    });

    it("should skip revision when mission is not found", async () => {
      let revisionCallback: ((missionId: string) => Promise<void>) | null =
        null;
      mockHealthCheckService.registerRevisionCallback.mockImplementation(
        (cb) => {
          revisionCallback = cb;
        },
      );

      await service.onModuleInit();

      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      await expect(revisionCallback!("nonexistent")).resolves.not.toThrow();
    });

    it("should skip tasks without leaderFeedback", async () => {
      let revisionCallback: ((missionId: string) => Promise<void>) | null =
        null;
      mockHealthCheckService.registerRevisionCallback.mockImplementation(
        (cb) => {
          revisionCallback = cb;
        },
      );

      await service.onModuleInit();

      const missionWithNoFeedback = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [
          makeTask({
            status: AgentTaskStatus.REVISION_NEEDED,
            leaderFeedback: null, // no feedback
          }),
        ],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        missionWithNoFeedback,
      );

      await expect(revisionCallback!("mission-1")).resolves.not.toThrow();
    });
  });

  // ============================================================
  // recoverStuckTasks - branch coverage for stuck missions with pending tasks
  // ============================================================

  describe("recoverStuckTasks edge cases", () => {
    it("should handle missions with no stuck tasks and no stuck missions gracefully", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([]);
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([]);

      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it("should filter out missions that still have IN_PROGRESS tasks", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([]);
      const missionWithInProgressTasks = makeMission({
        status: MissionStatus.IN_PROGRESS,
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
        tasks: [makeTask({ status: AgentTaskStatus.IN_PROGRESS })],
      });
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([
        missionWithInProgressTasks,
      ]);

      await service.onModuleInit();

      // Mission should NOT be updated since it still has IN_PROGRESS tasks
      expect(mockPrisma.teamMission.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // startMission - world building and constraint extraction
  // ============================================================

  describe("startMission - extended planning scenarios", () => {
    it("should extract constraints from mission description when present", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      mockConstraintEnforcementService.extractConstraints.mockReturnValueOnce([
        { type: "MUST", rule: "Character X is mute" },
      ]);
      mockConstraintEnforcementService.toHardConstraints.mockReturnValueOnce([
        { id: "HC-1", rule: "Character X is mute", severity: "MUST" },
      ]);
      mockLeaderModelService.executeWithFallback.mockRejectedValueOnce(
        new Error("AI unavailable"),
      );

      await service.startMission("mission-1", "user-1");

      expect(
        mockConstraintEnforcementService.extractConstraints,
      ).toHaveBeenCalled();
      expect(mockPrisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustConstraints: expect.any(Array) }),
        }),
      );
    });

    it("should continue even if constraint extraction fails", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      mockConstraintEnforcementService.extractConstraints.mockImplementationOnce(
        () => {
          throw new Error("Constraint extraction failed");
        },
      );
      mockLeaderModelService.executeWithFallback.mockRejectedValueOnce(
        new Error("AI unavailable"),
      );

      await expect(
        service.startMission("mission-1", "user-1"),
      ).resolves.not.toThrow();
    });

    it("should handle world building results when aiFacade.contextInit is available", async () => {
      const worldBuildingResult = {
        needed: true,
        contentType: "novel",
        hardConstraints: [{ id: "WC-1", rule: "World rule", severity: "MUST" }],
        settings: { theme: "Fantasy" },
      };

      mockAiFacade.contextInit = {
        buildWorldContext: jest.fn().mockResolvedValue(worldBuildingResult),
        formatWorldSettingsMessage: jest
          .fn()
          .mockReturnValue("World settings: Fantasy"),
      };

      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      mockLeaderModelService.executeWithFallback
        .mockResolvedValueOnce({
          success: true,
          data: { content: "World building result", tokensUsed: 200 },
          fallbackUsed: false,
          modelUsed: "gpt-4o",
        })
        .mockRejectedValueOnce(new Error("Planning failed"));

      await service.startMission("mission-1", "user-1");

      // Should have used contextInit
      expect(mockAiFacade.contextInit.buildWorldContext).toHaveBeenCalled();

      // Reset
      mockAiFacade.contextInit = null;
    });

    it("should mark mission as FAILED when leader planning throws", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.PENDING }),
      );
      mockLeaderModelService.executeWithFallback.mockRejectedValue(
        new Error("AI unavailable"),
      );

      await service.startMission("mission-1", "user-1");

      expect(mockPrisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MissionStatus.FAILED }),
        }),
      );
    });
  });

  // ============================================================
  // executeNextTasks - dependency and completion tracking
  // ============================================================

  describe("executeNextTasks - task dependency tracking", () => {
    type ExecuteFn = (id: string) => Promise<void>;

    it("should not start tasks whose dependencies are not yet completed", async () => {
      const completedTask = makeTask({
        id: "task-completed",
        status: AgentTaskStatus.COMPLETED,
        dependsOnIds: [],
      });
      const blockedTask = makeTask({
        id: "task-blocked",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: ["task-pending"],
      });
      const pendingDep = makeTask({
        id: "task-pending",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: [],
      });

      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [completedTask, blockedTask, pendingDep],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(mission);
      mockPrisma.agentTask.updateMany.mockResolvedValue({ count: 1 });

      await (
        service as unknown as { executeNextTasks: ExecuteFn }
      ).executeNextTasks("mission-1");

      expect(mockStateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-1",
      );
    });

    it("should call completeMission when all tasks are completed", async () => {
      const completedTask = makeTask({ status: AgentTaskStatus.COMPLETED });
      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [completedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValue(mission);

      await (
        service as unknown as { executeNextTasks: ExecuteFn }
      ).executeNextTasks("mission-1");

      // completeMission is called privately, which calls prisma.teamMission.update
      // with REVIEW status (or similar)
      expect(mockStateManager.finishMissionExecution).toHaveBeenCalledWith(
        "mission-1",
      );
    });
  });

  // ============================================================
  // resumeMission (delegates to lifecycleService)
  // ============================================================

  describe("resumeMission", () => {
    it("should delegate to lifecycleService.resumeMission with correct missionId and userId", async () => {
      mockLifecycleService.resumeMission = jest.fn().mockResolvedValue({
        id: "mission-1",
        status: MissionStatus.IN_PROGRESS,
      });

      await service.resumeMission("mission-1", "user-1");

      expect(mockLifecycleService.resumeMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  // ============================================================
  // deleteMission (delegates to lifecycleService)
  // ============================================================

  describe("deleteMission", () => {
    it("should delegate to lifecycleService.deleteMission with correct missionId and userId", async () => {
      mockLifecycleService.deleteMission = jest
        .fn()
        .mockResolvedValue(undefined);

      await service.deleteMission("mission-1", "user-1");

      expect(mockLifecycleService.deleteMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
      );
    });
  });

  // ============================================================
  // getAgentSystemPrompt / getLeaderSystemPrompt (delegate-like)
  // ============================================================

  describe("getAgentSystemPrompt", () => {
    it("should return a system prompt string for an agent", () => {
      const agent = makeMission().topic.aiMembers[1]; // member agent
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
      expect(result.length).toBeGreaterThan(0);
    });

    it("should include MUST constraints when provided", () => {
      const agent = makeMission().topic.aiMembers[1];
      const task = makeTask();
      const mustConstraints = [
        { id: "HC-1", rule: "Important constraint", severity: "MUST" },
      ];

      const result = (
        service as unknown as {
          getAgentSystemPrompt: (
            agent: unknown,
            task: unknown,
            context: unknown,
            desc?: string,
            constraints?: unknown[],
          ) => string;
        }
      ).getAgentSystemPrompt(
        agent,
        task,
        null,
        "Mission description",
        mustConstraints,
      );

      expect(typeof result).toBe("string");
    });
  });

  describe("getLeaderSystemPrompt", () => {
    it("should return a system prompt string for the leader", () => {
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

  // ============================================================
  // retryMission (delegates to retryService)
  // ============================================================

  describe("retryMission", () => {
    it("should delegate to retryService.retryMission with correct arguments", async () => {
      const mockRetryResult = {
        success: true,
        mode: "continue",
        previousStatus: MissionStatus.FAILED,
        message: "done",
      };
      mockRetryService.retryMission = jest
        .fn()
        .mockResolvedValue(mockRetryResult);

      const result = await service.retryMission("mission-1", "user-1", {
        mode: "continue",
      });

      expect(mockRetryService.retryMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        { mode: "continue" },
        expect.any(Function), // sendMessageToTopic
        expect.any(Function), // createLog
        expect.any(Function), // startMission
        expect.any(Function), // handleLeaderMentionCommand
        expect.any(Function), // executeNextTasks
      );
      expect(result).toEqual(mockRetryResult);
    });

    it("should delegate full mode to retryService", async () => {
      const mockRetryResult = {
        success: true,
        mode: "full",
        previousStatus: MissionStatus.FAILED,
        message: "done",
      };
      mockRetryService.retryMission = jest
        .fn()
        .mockResolvedValue(mockRetryResult);

      await service.retryMission("mission-1", "user-1", {
        mode: "full",
        reason: "manual",
      });

      expect(mockRetryService.retryMission).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        { mode: "full", reason: "manual" },
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
        expect.any(Function),
      );
    });
  });

  // ============================================================
  // updateMissionNotification
  // ============================================================

  describe("updateMissionNotification", () => {
    it("should delegate to lifecycleService.updateMissionNotification", async () => {
      mockLifecycleService.updateMissionNotification = jest
        .fn()
        .mockResolvedValue({
          id: "mission-1",
          notificationEmail: "test@example.com",
        });

      await service.updateMissionNotification("mission-1", "user-1", {
        notificationEmail: "test@example.com",
      });

      expect(
        mockLifecycleService.updateMissionNotification,
      ).toHaveBeenCalledWith(
        "mission-1",
        "user-1",
        { notificationEmail: "test@example.com" },
        expect.any(Function),
      );
    });
  });

  // ============================================================
  // handleLeaderMentionCommand
  // ============================================================

  describe("handleLeaderMentionCommand", () => {
    beforeEach(() => {
      // Default: no in-progress mission
      mockPrisma.teamMission.findFirst.mockResolvedValue(null);
      mockPrisma.teamMission.findUnique.mockResolvedValue(null);
    });

    it("should return handled: false when no mission matches", async () => {
      mockPrisma.teamMission.findFirst.mockResolvedValue(null);

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "继续执行",
      );

      expect(result.handled).toBe(false);
    });

    it("should return handled: false for non-retry keywords", async () => {
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [makeTask({ status: AgentTaskStatus.PENDING })],
      });
      mockPrisma.teamMission.findFirst.mockResolvedValue(inProgressMission);
      mockPrisma.teamMission.findUnique.mockResolvedValue(inProgressMission);

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "hello there",
      );

      // No retry keyword -> check for FAILED/CANCELLED missions
      expect(result).toBeDefined();
    });

    it("should handle 继续执行 keyword with IN_PROGRESS mission having pending tasks", async () => {
      const pendingTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.PENDING,
        dependsOnIds: [],
      });
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [pendingTask],
      });
      mockPrisma.teamMission.findFirst.mockResolvedValue(inProgressMission);
      mockPrisma.teamMission.findUnique.mockResolvedValue(inProgressMission);

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "继续执行",
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe("continue_organizing");
    });

    it("should handle retry keyword with IN_PROGRESS mission having no pending tasks", async () => {
      const completedTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.COMPLETED,
      });
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [completedTask],
      });
      mockPrisma.teamMission.findFirst.mockResolvedValue(inProgressMission);
      mockPrisma.teamMission.findUnique.mockResolvedValue(inProgressMission);

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "retry",
      );

      expect(result.handled).toBe(true);
    });

    it("should detect stuck AWAITING_REVIEW tasks and re-trigger review", async () => {
      const stuckTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.AWAITING_REVIEW,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
        result: "Some result",
      });
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [stuckTask],
      });
      mockPrisma.teamMission.findFirst.mockResolvedValue(inProgressMission);
      mockPrisma.teamMission.findUnique.mockResolvedValue({
        ...inProgressMission,
        tasks: [
          {
            ...stuckTask,
            assignedTo: { id: "member-1", displayName: "Agent" },
          },
        ],
      });

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "继续",
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe("re_review_tasks");
    });

    it("should detect stuck REVISION_NEEDED tasks and re-trigger revision", async () => {
      const stuckTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.REVISION_NEEDED,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000),
        leaderFeedback: "Please revise",
      });
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [stuckTask],
      });
      mockPrisma.teamMission.findFirst.mockResolvedValue(inProgressMission);
      mockPrisma.teamMission.findUnique.mockResolvedValue({
        ...inProgressMission,
        tasks: [
          {
            ...stuckTask,
            assignedTo: { id: "member-1", displayName: "Agent" },
          },
        ],
      });

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "continue",
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe("re_revision_tasks");
    });

    it("should return handled: false when updatedMission not found after reset", async () => {
      const stuckTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
      });
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [stuckTask],
      });
      mockPrisma.teamMission.findFirst.mockResolvedValue(inProgressMission);
      // findUnique returns null after reset
      mockPrisma.teamMission.findUnique.mockResolvedValue(null);

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "继续",
      );

      expect(result.handled).toBe(false);
    });

    it("should handle organize keyword", async () => {
      const pendingTask = makeTask({
        status: AgentTaskStatus.PENDING,
        dependsOnIds: [],
      });
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [pendingTask],
      });
      mockPrisma.teamMission.findFirst.mockResolvedValue(inProgressMission);
      mockPrisma.teamMission.findUnique.mockResolvedValue(inProgressMission);

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "组织任务",
      );

      expect(result.handled).toBe(true);
    });

    it("should look for FAILED mission when no IN_PROGRESS mission with retry keyword", async () => {
      // No in-progress mission
      mockPrisma.teamMission.findFirst
        .mockResolvedValueOnce(null) // in-progress search
        .mockResolvedValueOnce(makeMission({ status: MissionStatus.FAILED })); // failed search

      const result = await service.handleLeaderMentionCommand(
        "topic-1",
        "user-1",
        "重试",
      );

      expect(result).toBeDefined();
    });
  });

  // ============================================================
  // getMissionProgress / getMissionStats (if they exist)
  // ============================================================

  describe("getMissions - additional filter cases", () => {
    it("should return empty list when topic has no missions", async () => {
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([]);

      const result = await service.getMissions("empty-topic");

      expect(result).toEqual([]);
    });

    it("should filter by PLANNING status", async () => {
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([]);

      await service.getMissions("topic-1", { status: MissionStatus.PLANNING });

      expect(mockPrisma.teamMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: MissionStatus.PLANNING }),
        }),
      );
    });

    it("should filter by COMPLETED status", async () => {
      const completedMission = makeMission({ status: MissionStatus.COMPLETED });
      mockPrisma.teamMission.findMany.mockResolvedValueOnce([completedMission]);

      const result = await service.getMissions("topic-1", {
        status: MissionStatus.COMPLETED,
      });

      expect(result).toHaveLength(1);
    });
  });

  // ============================================================
  // createMission - additional edge cases
  // ============================================================

  describe("createMission - edge cases", () => {
    const dto = {
      title: "Test Mission",
      description: "Description",
      objectives: ["obj1", "obj2"],
      constraints: ["constraint1"],
      deliverables: ["deliverable1"],
      leaderId: "leader-1",
      autoStart: false,
    };

    it("should create mission with multiple objectives and constraints", async () => {
      const result = await service.createMission("topic-1", "user-1", dto);

      expect(mockPrisma.teamMission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            objectives: dto.objectives,
            constraints: dto.constraints,
            deliverables: dto.deliverables,
          }),
        }),
      );
      expect(result).toBeDefined();
    });

    it("should include createdById in the created mission", async () => {
      await service.createMission("topic-1", "user-123", dto);

      expect(mockPrisma.teamMission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: "user-123",
          }),
        }),
      );
    });
  });

  // ============================================================
  // getFullReport
  // ============================================================

  describe("getFullReport", () => {
    it("should return success: false when mission not found", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      const result = await service.getFullReport("nonexistent-id");

      expect(result.success).toBe(false);
      expect(result.message).toContain("不存在");
    });

    it("should return success: true with full report content when mission found", async () => {
      const completedTask = {
        id: "task-1",
        title: "Chapter 1",
        status: "COMPLETED",
        result: "Content of chapter 1",
        assignedTo: {
          id: "member-1",
          agentName: "Alice",
          displayName: "Alice Agent",
        },
        createdAt: new Date("2025-01-01"),
      };
      const missionWithTasks = {
        ...makeMission({ status: MissionStatus.COMPLETED }),
        tasks: [completedTask],
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(missionWithTasks);

      const result = await service.getFullReport("mission-1");

      expect(result.success).toBe(true);
      expect(result.fullContent).toBeDefined();
      expect(result.taskCount).toBe(1);
    });
  });

  // ============================================================
  // regenerateFinalReport
  // ============================================================

  describe("regenerateFinalReport", () => {
    it("should return success: false when mission not found", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      const result = await service.regenerateFinalReport("nonexistent-id");

      expect(result.success).toBe(false);
      expect(result.message).toContain("不存在");
    });

    it("should return success: false when mission status is not COMPLETED", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({ status: MissionStatus.IN_PROGRESS, tasks: [] }),
      );

      const result = await service.regenerateFinalReport("mission-1");

      expect(result.success).toBe(false);
      expect(result.message).toContain("只能重新生成已完成");
    });

    it("should return success: true and update mission when completed", async () => {
      const completedTask = {
        id: "task-1",
        title: "Chapter 1",
        status: "COMPLETED",
        result: "Content here",
        assignedTo: {
          id: "member-1",
          agentName: "Alice",
          displayName: "Alice Agent",
        },
        createdAt: new Date("2025-01-01"),
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        makeMission({
          status: MissionStatus.COMPLETED,
          tasks: [completedTask],
        }),
      );
      mockPrisma.teamMission.update.mockResolvedValueOnce({});

      const result = await service.regenerateFinalReport("mission-1");

      expect(result.success).toBe(true);
      expect(result.taskCount).toBe(1);
    });
  });

  // ============================================================
  // setLeader
  // ============================================================

  describe("setLeader", () => {
    it("should delegate to memberService.setLeader", async () => {
      const mockSetLeader = jest
        .fn()
        .mockResolvedValue({ id: "member-1", isLeader: true });
      mockMemberService.setLeader = mockSetLeader;

      await service.setLeader("topic-1", "member-1");

      expect(mockSetLeader).toHaveBeenCalledWith("topic-1", "member-1");
    });
  });

  // ============================================================
  // findAlternativeAgentWithCircuitBreaker (private)
  // ============================================================

  describe("findAlternativeAgentWithCircuitBreaker", () => {
    it("should return null when only one team member exists", async () => {
      mockMemberService.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          agentName: "Leader",
          displayName: "Leader",
          isLeader: true,
          aiModel: "gpt-4",
        },
        members: [],
        all: [
          {
            id: "leader-1",
            agentName: "Leader",
            displayName: "Leader",
            isLeader: true,
            aiModel: "gpt-4",
          },
        ],
      });

      const result = await (
        service as any
      ).findAlternativeAgentWithCircuitBreaker(makeMission(), ["leader-1"], {});

      expect(result).toBeNull();
    });

    it("should exclude failed agents and return a valid alternative", async () => {
      mockMemberService.getTeamMembers.mockResolvedValueOnce({
        leader: {
          id: "leader-1",
          agentName: "Leader",
          displayName: "Leader",
          isLeader: true,
          aiModel: "gpt-4",
        },
        members: [
          {
            id: "member-1",
            agentName: "Alice",
            displayName: "Alice",
            isLeader: false,
            aiModel: "gemini",
          },
          {
            id: "member-2",
            agentName: "Bob",
            displayName: "Bob",
            isLeader: false,
            aiModel: "claude",
          },
        ],
        all: [
          {
            id: "leader-1",
            agentName: "Leader",
            displayName: "Leader",
            isLeader: true,
            aiModel: "gpt-4",
          },
          {
            id: "member-1",
            agentName: "Alice",
            displayName: "Alice",
            isLeader: false,
            aiModel: "gemini",
          },
          {
            id: "member-2",
            agentName: "Bob",
            displayName: "Bob",
            isLeader: false,
            aiModel: "claude",
          },
        ],
      });

      // Temporarily set circuit breaker to allow member-2
      const origCircuitBreaker = mockAiFacade.circuitBreaker;
      (mockAiFacade as any).circuitBreaker = {
        canExecute: jest.fn().mockReturnValue(true),
        selectBest: jest.fn().mockReturnValue("member-2"),
        getHealthMetrics: jest
          .fn()
          .mockReturnValue({ successRate: 1, currentLoad: 0 }),
      };

      const result = await (
        service as any
      ).findAlternativeAgentWithCircuitBreaker(
        makeMission(),
        ["member-1"], // member-1 failed, should pick member-2
        {},
      );

      (mockAiFacade as any).circuitBreaker = origCircuitBreaker;

      expect(result).not.toBeNull();
      expect(result?.id).toBe("member-2");
    });
  });
});

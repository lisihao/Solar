/**
 * MissionRetryService Unit Tests
 *
 * Comprehensive coverage of:
 * - isMissionStuck: detection with various timeout scenarios
 * - retryMission: full mode, continue mode, stuck detection, error paths
 * - handleInProgressMission: pending tasks, completion, force complete, retry execution
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { MissionRetryService } from "../mission-retry.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { TopicEventEmitterService } from "../../../events";
import {
  MissionStatus,
  AgentTaskStatus,
  MissionLogType,
  MessageContentType,
} from "@prisma/client";

// ============================================================
// Mock factories
// ============================================================

const makeLeader = (overrides: Record<string, unknown> = {}) => ({
  id: "leader-1",
  displayName: "Leader Bot",
  agentName: "LeaderBot",
  ...overrides,
});

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  status: AgentTaskStatus.PENDING,
  startedAt: null,
  updatedAt: new Date(),
  result: null,
  leaderFeedback: null,
  dependsOnIds: [],
  assignedTo: {
    id: "member-1",
    displayName: "Agent One",
    agentName: "AgentOne",
  },
  ...overrides,
});

const makeMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-1",
  topicId: "topic-1",
  title: "Test Mission",
  status: MissionStatus.FAILED,
  leader: makeLeader(),
  tasks: [],
  topic: { id: "topic-1", name: "Test Topic" },
  updatedAt: new Date(),
  ...overrides,
});

// ============================================================
// Mock services
// ============================================================

const mockPrisma = {
  teamMission: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  agentTask: {
    deleteMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockTopicEventEmitter = {
  emitToTopic: jest.fn(),
};

// ============================================================
// Callback mocks
// ============================================================

const mockSendMessageToTopic = jest.fn().mockResolvedValue({ id: "msg-1" });
const mockCreateLog = jest.fn().mockResolvedValue(undefined);
const mockStartMission = jest.fn().mockResolvedValue(undefined);
const mockHandleLeaderMentionCommand = jest.fn().mockResolvedValue({
  handled: true,
  action: "continue",
  missionId: "mission-1",
});
const mockExecuteNextTasks = jest.fn().mockResolvedValue(undefined);

// ============================================================
// Test suite
// ============================================================

describe("MissionRetryService", () => {
  let service: MissionRetryService;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockPrisma.teamMission.findUnique.mockResolvedValue(makeMission());
    mockPrisma.teamMission.update.mockResolvedValue(makeMission());
    mockPrisma.agentTask.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.agentTask.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionRetryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TopicEventEmitterService, useValue: mockTopicEventEmitter },
      ],
    }).compile();

    service = module.get<MissionRetryService>(MissionRetryService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ============================================================
  // isMissionStuck
  // ============================================================

  describe("isMissionStuck", () => {
    it("should return false for mission with no tasks", () => {
      const mission = { tasks: [] };
      expect(service.isMissionStuck(mission)).toBe(false);
    });

    it("should return false for mission with undefined tasks", () => {
      const mission = {};
      expect(service.isMissionStuck(mission)).toBe(false);
    });

    it("should return false when tasks are not IN_PROGRESS", () => {
      const mission = {
        tasks: [
          {
            status: AgentTaskStatus.COMPLETED,
            startedAt: new Date(Date.now() - 60 * 60 * 1000),
          },
          { status: AgentTaskStatus.PENDING, startedAt: null },
          {
            status: AgentTaskStatus.BLOCKED,
            startedAt: new Date(Date.now() - 60 * 60 * 1000),
          },
        ],
      };
      expect(service.isMissionStuck(mission)).toBe(false);
    });

    it("should return false when IN_PROGRESS task started recently", () => {
      const mission = {
        tasks: [
          {
            status: "IN_PROGRESS",
            startedAt: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
          },
        ],
      };
      const thresholdMs = 30 * 60 * 1000; // 30 minutes
      expect(service.isMissionStuck(mission, thresholdMs)).toBe(false);
    });

    it("should return true when IN_PROGRESS task exceeded threshold via startedAt", () => {
      const mission = {
        tasks: [
          {
            status: "IN_PROGRESS",
            startedAt: new Date(Date.now() - 40 * 60 * 1000), // 40 minutes ago
          },
        ],
      };
      const thresholdMs = 30 * 60 * 1000; // 30 minutes
      expect(service.isMissionStuck(mission, thresholdMs)).toBe(true);
    });

    it("should use updatedAt when startedAt is null", () => {
      const mission = {
        tasks: [
          {
            status: "IN_PROGRESS",
            startedAt: null,
            updatedAt: new Date(Date.now() - 40 * 60 * 1000), // 40 minutes ago
          },
        ],
      };
      const thresholdMs = 30 * 60 * 1000;
      expect(service.isMissionStuck(mission, thresholdMs)).toBe(true);
    });

    it("should return false when IN_PROGRESS task has no startedAt or updatedAt", () => {
      const mission = {
        tasks: [
          {
            status: "IN_PROGRESS",
            startedAt: null,
            updatedAt: undefined,
          },
        ],
      };
      expect(service.isMissionStuck(mission)).toBe(false);
    });

    it("should use default threshold when no threshold provided", () => {
      // Default TASK_TIMEOUT_CONFIG.missionStuckTimeoutMs is typically long enough
      // that a task started 1 minute ago would not be stuck
      const mission = {
        tasks: [
          {
            status: "IN_PROGRESS",
            startedAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
          },
        ],
      };
      expect(service.isMissionStuck(mission)).toBe(false);
    });

    it("should return true if any one task is stuck even if others are not", () => {
      const mission = {
        tasks: [
          {
            status: "IN_PROGRESS",
            startedAt: new Date(Date.now() - 2 * 60 * 1000), // recent
          },
          {
            status: "IN_PROGRESS",
            startedAt: new Date(Date.now() - 40 * 60 * 1000), // 40 min ago
          },
        ],
      };
      expect(service.isMissionStuck(mission, 30 * 60 * 1000)).toBe(true);
    });
  });

  // ============================================================
  // retryMission - error paths
  // ============================================================

  describe("retryMission - error paths", () => {
    it("should throw NotFoundException when mission does not exist", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.retryMission(
          "nonexistent",
          "user-1",
          {},
          mockSendMessageToTopic,
          mockCreateLog,
          mockStartMission,
          mockHandleLeaderMentionCommand,
          mockExecuteNextTasks,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when mission is IN_PROGRESS and not stuck", async () => {
      const inProgressMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [
          makeTask({
            status: AgentTaskStatus.IN_PROGRESS,
            startedAt: new Date(),
          }),
        ],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(
        inProgressMission,
      );

      await expect(
        service.retryMission(
          "mission-1",
          "user-1",
          {},
          mockSendMessageToTopic,
          mockCreateLog,
          mockStartMission,
          mockHandleLeaderMentionCommand,
          mockExecuteNextTasks,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when mission status is COMPLETED", async () => {
      const completedMission = makeMission({ status: MissionStatus.COMPLETED });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(completedMission);

      await expect(
        service.retryMission(
          "mission-1",
          "user-1",
          {},
          mockSendMessageToTopic,
          mockCreateLog,
          mockStartMission,
          mockHandleLeaderMentionCommand,
          mockExecuteNextTasks,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when mission is PLANNING", async () => {
      const planningMission = makeMission({ status: MissionStatus.PLANNING });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(planningMission);

      await expect(
        service.retryMission(
          "mission-1",
          "user-1",
          {},
          mockSendMessageToTopic,
          mockCreateLog,
          mockStartMission,
          mockHandleLeaderMentionCommand,
          mockExecuteNextTasks,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================================
  // retryMission - full mode
  // ============================================================

  describe("retryMission - full mode", () => {
    it("should delete all tasks and reset mission status to PENDING in full mode", async () => {
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [makeTask({ id: "task-1", status: AgentTaskStatus.BLOCKED })],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);
      mockPrisma.teamMission.update.mockResolvedValueOnce({
        ...failedMission,
        status: MissionStatus.PENDING,
      });

      const result = await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "full" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockPrisma.agentTask.deleteMany).toHaveBeenCalledWith({
        where: { missionId: "mission-1" },
      });
      expect(mockPrisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MissionStatus.PENDING }),
        }),
      );
      expect(result.mode).toBe("full");
      expect(result.success).toBe(true);
    });

    it("should create a log entry in full mode", async () => {
      const failedMission = makeMission({ status: MissionStatus.FAILED });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "full" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockCreateLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          type: MissionLogType.MISSION_CREATED,
        }),
      );
    });

    it("should include reason in log when provided in full mode", async () => {
      const failedMission = makeMission({ status: MissionStatus.FAILED });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "full", reason: "Too many errors" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockCreateLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          content: expect.stringContaining("Too many errors"),
        }),
      );
    });

    it("should emit mission:retried event in full mode", async () => {
      const failedMission = makeMission({ status: MissionStatus.FAILED });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "full" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockTopicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "mission:retried",
        expect.objectContaining({ missionId: "mission-1", mode: "full" }),
      );
    });

    it("should call startMission async in full mode", async () => {
      const failedMission = makeMission({ status: MissionStatus.FAILED });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "full" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      // startMission is called async (fire-and-forget), give it a tick
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockStartMission).toHaveBeenCalledWith("mission-1", "user-1");
    });

    it("should handle startMission failure gracefully in full mode", async () => {
      const failedMission = makeMission({ status: MissionStatus.FAILED });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);
      mockStartMission.mockRejectedValueOnce(new Error("Start failed"));

      // Should not throw even if startMission fails
      await expect(
        service.retryMission(
          "mission-1",
          "user-1",
          { mode: "full" },
          mockSendMessageToTopic,
          mockCreateLog,
          mockStartMission,
          mockHandleLeaderMentionCommand,
          mockExecuteNextTasks,
        ),
      ).resolves.not.toThrow();
    });

    it("should retry CANCELLED mission in full mode", async () => {
      const cancelledMission = makeMission({ status: MissionStatus.CANCELLED });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(cancelledMission);

      const result = await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "full" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(result.previousStatus).toBe(MissionStatus.CANCELLED);
      expect(result.success).toBe(true);
    });

    it("should retry PAUSED mission in full mode", async () => {
      const pausedMission = makeMission({ status: MissionStatus.PAUSED });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(pausedMission);

      const result = await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "full" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(result.previousStatus).toBe(MissionStatus.PAUSED);
    });
  });

  // ============================================================
  // retryMission - continue mode
  // ============================================================

  describe("retryMission - continue mode", () => {
    it("should default to continue mode when mode not specified", async () => {
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [makeTask({ status: AgentTaskStatus.BLOCKED })],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      const result = await service.retryMission(
        "mission-1",
        "user-1",
        undefined,
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(result.mode).toBe("continue");
    });

    it("should reset BLOCKED tasks to PENDING in continue mode", async () => {
      const blockedTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.BLOCKED,
      });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [blockedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should reset CANCELLED tasks to PENDING in continue mode", async () => {
      const cancelledTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.CANCELLED,
      });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [cancelledTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should reset stuck IN_PROGRESS tasks to PENDING in continue mode", async () => {
      const stuckTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 40 * 60 * 1000), // 40 minutes ago
      });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [stuckTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-1" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should throw BadRequestException when no tasks to retry or continue", async () => {
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [makeTask({ status: AgentTaskStatus.COMPLETED })],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await expect(
        service.retryMission(
          "mission-1",
          "user-1",
          { mode: "continue" },
          mockSendMessageToTopic,
          mockCreateLog,
          mockStartMission,
          mockHandleLeaderMentionCommand,
          mockExecuteNextTasks,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should not throw when there are only PENDING tasks but no BLOCKED ones", async () => {
      const pendingTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.PENDING,
      });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [pendingTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      const result = await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      // No tasks to reset, but pending tasks exist so it should continue
      expect(result.success).toBe(true);
    });

    it("should update mission status to IN_PROGRESS in continue mode", async () => {
      const blockedTask = makeTask({ status: AgentTaskStatus.BLOCKED });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [blockedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockPrisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: MissionStatus.IN_PROGRESS }),
        }),
      );
    });

    it("should emit mission:retried event in continue mode", async () => {
      const blockedTask = makeTask({ status: AgentTaskStatus.BLOCKED });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [blockedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockTopicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "mission:retried",
        expect.objectContaining({ missionId: "mission-1", mode: "continue" }),
      );
    });

    it("should call handleLeaderMentionCommand in continue mode", async () => {
      const blockedTask = makeTask({ status: AgentTaskStatus.BLOCKED });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [blockedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      // handleLeaderMentionCommand is called async, give it a tick
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockHandleLeaderMentionCommand).toHaveBeenCalledWith(
        "topic-1",
        "user-1",
        expect.stringContaining("LeaderBot"),
      );
    });

    it("should fallback to executeNextTasks when handleLeaderMentionCommand fails", async () => {
      const blockedTask = makeTask({ status: AgentTaskStatus.BLOCKED });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [blockedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);
      mockHandleLeaderMentionCommand.mockRejectedValueOnce(
        new Error("Leader command failed"),
      );

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      // Wait for the async fallback to kick in
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockExecuteNextTasks).toHaveBeenCalledWith("mission-1");
    });

    it("should include reason in log when provided in continue mode", async () => {
      const blockedTask = makeTask({ status: AgentTaskStatus.BLOCKED });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [blockedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue", reason: "Manual retry" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockCreateLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          content: expect.stringContaining("Manual retry"),
        }),
      );
    });

    it("should return previousStatus correctly in continue mode", async () => {
      const blockedTask = makeTask({ status: AgentTaskStatus.BLOCKED });
      const pausedMission = makeMission({
        status: MissionStatus.PAUSED,
        tasks: [blockedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(pausedMission);

      const result = await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(result.previousStatus).toBe(MissionStatus.PAUSED);
    });
  });

  // ============================================================
  // retryMission - stuck IN_PROGRESS
  // ============================================================

  describe("retryMission - stuck IN_PROGRESS mission", () => {
    it("should allow retry of stuck IN_PROGRESS mission", async () => {
      const stuckTask = makeTask({
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      });
      const stuckMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [stuckTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(stuckMission);

      const result = await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(result.success).toBe(true);
    });

    it("should allow full retry of stuck IN_PROGRESS mission", async () => {
      const stuckTask = makeTask({
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      const stuckMission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        tasks: [stuckTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(stuckMission);

      const result = await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "full" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe("full");
    });
  });

  // ============================================================
  // handleInProgressMission
  // ============================================================

  describe("handleInProgressMission", () => {
    const buildInProgressMission = (
      taskOverrides: Record<string, unknown>[] = [],
    ) => ({
      id: "mission-1",
      topicId: "topic-1",
      title: "Test Mission",
      status: MissionStatus.IN_PROGRESS,
      tasks: taskOverrides.map((t, i) => ({
        id: `task-${i + 1}`,
        status: AgentTaskStatus.PENDING,
        startedAt: null,
        updatedAt: new Date(),
        result: null,
        leaderFeedback: null,
        dependsOnIds: [],
        assignedTo: {
          id: "member-1",
          displayName: "Agent One",
          agentName: "AgentOne",
        },
        ...t,
      })),
      leader: makeLeader(),
    });

    const buildCallbacks = (overrides: Record<string, unknown> = {}) => ({
      sendMessageToTopic: jest.fn().mockResolvedValue({ id: "msg-1" }),
      leaderReviewTask: jest.fn().mockResolvedValue(undefined),
      executeTaskRevision: jest.fn().mockResolvedValue(undefined),
      executeNextTasks: jest.fn().mockResolvedValue(undefined),
      completeMission: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it("should return handled: false when mission not found after reset", async () => {
      const mission = buildInProgressMission([
        {
          status: AgentTaskStatus.IN_PROGRESS,
          startedAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      ]);
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      const callbacks = buildCallbacks();
      const result = await service.handleInProgressMission(
        mission as any,
        "topic-1",
        callbacks,
      );

      expect(result.handled).toBe(false);
    });

    it("should execute next tasks when pending tasks can start", async () => {
      const mission = buildInProgressMission([
        { status: AgentTaskStatus.PENDING, dependsOnIds: [] },
      ]);

      const updatedMission = {
        ...mission,
        tasks: mission.tasks,
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(updatedMission);

      const callbacks = buildCallbacks();
      const result = await service.handleInProgressMission(
        mission as any,
        "topic-1",
        callbacks,
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe("continue_organizing");
      expect(callbacks.executeNextTasks).toHaveBeenCalledWith("mission-1");
    });

    it("should complete mission when all tasks are completed", async () => {
      const mission = buildInProgressMission([
        { status: AgentTaskStatus.COMPLETED },
        { status: AgentTaskStatus.COMPLETED },
      ]);

      const updatedMission = {
        ...mission,
        tasks: mission.tasks,
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(updatedMission);

      const callbacks = buildCallbacks();
      const result = await service.handleInProgressMission(
        mission as any,
        "topic-1",
        callbacks,
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe("completing_mission");
      expect(callbacks.completeMission).toHaveBeenCalledWith("mission-1");
    });

    it("should force complete when completion rate >= threshold", async () => {
      // Create many tasks, almost all completed
      const completedTasks = Array.from({ length: 9 }, (_, i) => ({
        id: `task-${i + 1}`,
        status: AgentTaskStatus.COMPLETED,
      }));
      const blockedTask = {
        id: "task-10",
        status: AgentTaskStatus.BLOCKED,
        result: null,
      };

      const mission = {
        id: "mission-1",
        topicId: "topic-1",
        title: "Test Mission",
        status: MissionStatus.IN_PROGRESS,
        tasks: [...completedTasks, blockedTask],
        leader: makeLeader(),
      };

      const updatedMission = { ...mission, tasks: mission.tasks };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(updatedMission);

      const callbacks = buildCallbacks();
      const result = await service.handleInProgressMission(
        mission as any,
        "topic-1",
        callbacks,
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe("force_completing_mission");
      // Should update blocked task to COMPLETED
      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: AgentTaskStatus.COMPLETED }),
        }),
      );
    });

    it("should reset stuck IN_PROGRESS tasks to PENDING", async () => {
      const stuckTask = {
        id: "task-stuck",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
      };
      const mission = {
        id: "mission-1",
        topicId: "topic-1",
        title: "Test Mission",
        status: MissionStatus.IN_PROGRESS,
        tasks: [stuckTask],
        leader: makeLeader(),
      };

      // After reset, return mission with PENDING task
      const updatedMission = {
        ...mission,
        tasks: [{ ...stuckTask, status: AgentTaskStatus.PENDING }],
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(updatedMission);

      const callbacks = buildCallbacks();
      await service.handleInProgressMission(
        mission as any,
        "topic-1",
        callbacks,
      );

      expect(mockPrisma.agentTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "task-stuck" },
          data: expect.objectContaining({ status: AgentTaskStatus.PENDING }),
        }),
      );
    });

    it("should trigger retry_execution when no tasks can start and not near completion", async () => {
      // Blocked tasks: one BLOCKED, one PENDING with unmet dependency
      const blockedTask = {
        id: "task-1",
        status: AgentTaskStatus.BLOCKED,
        dependsOnIds: [],
      };
      const mission = {
        id: "mission-1",
        topicId: "topic-1",
        title: "Test Mission",
        status: MissionStatus.IN_PROGRESS,
        tasks: [blockedTask],
        leader: makeLeader(),
      };

      const updatedMission = { ...mission, tasks: [blockedTask] };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(updatedMission);

      const callbacks = buildCallbacks();
      const result = await service.handleInProgressMission(
        mission as any,
        "topic-1",
        callbacks,
      );

      expect(result.handled).toBe(true);
      expect(result.action).toBe("retry_execution");
    });

    it("should send message when forcing completion due to high completion rate", async () => {
      const completedTasks = Array.from({ length: 9 }, (_, i) => ({
        id: `task-${i + 1}`,
        status: AgentTaskStatus.COMPLETED,
      }));
      const remainingTask = {
        id: "task-10",
        status: AgentTaskStatus.REVISION_NEEDED,
        result: "some result",
      };

      const mission = {
        id: "mission-1",
        topicId: "topic-1",
        title: "Test Mission",
        status: MissionStatus.IN_PROGRESS,
        tasks: [...completedTasks, remainingTask],
        leader: makeLeader(),
      };

      const updatedMission = { ...mission, tasks: mission.tasks };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(updatedMission);

      const callbacks = buildCallbacks();
      await service.handleInProgressMission(
        mission as any,
        "topic-1",
        callbacks,
      );

      expect(callbacks.sendMessageToTopic).toHaveBeenCalledWith(
        "topic-1",
        expect.anything(),
        expect.stringContaining("完成率"),
        MessageContentType.TEXT,
      );
    });
  });

  // ============================================================
  // retryMission - log message generation
  // ============================================================

  describe("retryMission - log message generation with mixed task types", () => {
    it("should generate correct log message with only stuck IN_PROGRESS tasks", async () => {
      const stuckTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 40 * 60 * 1000),
      });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [stuckTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      expect(mockCreateLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          content: expect.stringContaining("卡住"),
        }),
      );
    });

    it("should generate mixed log message when both stuck and failed tasks present", async () => {
      const stuckTask = makeTask({
        id: "task-1",
        status: AgentTaskStatus.IN_PROGRESS,
        startedAt: new Date(Date.now() - 40 * 60 * 1000),
      });
      const blockedTask = makeTask({
        id: "task-2",
        status: AgentTaskStatus.BLOCKED,
      });
      const failedMission = makeMission({
        status: MissionStatus.FAILED,
        tasks: [stuckTask, blockedTask],
      });
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(failedMission);

      await service.retryMission(
        "mission-1",
        "user-1",
        { mode: "continue" },
        mockSendMessageToTopic,
        mockCreateLog,
        mockStartMission,
        mockHandleLeaderMentionCommand,
        mockExecuteNextTasks,
      );

      // Both stuck and failed tasks should be in the log message
      expect(mockCreateLog).toHaveBeenCalled();
    });
  });
});

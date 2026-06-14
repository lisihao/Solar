/**
 * MissionLifecycleService Unit Tests
 *
 * Coverage targets:
 * - cancelMission: success, not found, already completed/cancelled
 * - deleteMission: success (transaction), not found, invalid status
 * - updateMissionNotification: success with email, success clearing email, not found
 * - pauseMission: success from IN_PROGRESS, success from PLANNING, not found, invalid status
 * - resumeMission: success resuming to IN_PROGRESS, success resuming to PLANNING, not found, not paused
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import {
  MissionStatus,
  AgentTaskStatus,
  MissionLogType,
  MessageContentType,
} from "@prisma/client";

import { MissionLifecycleService } from "../mission-lifecycle.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { TopicEventEmitterService } from "../../../events";

// ============================================================================
// Helpers
// ============================================================================

function makeMission(overrides: Record<string, unknown> = {}) {
  return {
    id: "mission-1",
    topicId: "topic-1",
    title: "Test Mission",
    status: MissionStatus.IN_PROGRESS,
    taskBreakdown: null,
    leader: {
      id: "leader-1",
      displayName: "Leader Agent",
      agentName: "Aria",
    },
    tasks: [],
    ...overrides,
  };
}

// ============================================================================
// Mock setup
// ============================================================================

function buildPrismaMock() {
  return {
    teamMission: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    agentTask: {
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    missionLog: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function buildEventEmitterMock() {
  return {
    emitToTopic: jest.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("MissionLifecycleService", () => {
  let service: MissionLifecycleService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let topicEventEmitter: ReturnType<typeof buildEventEmitterMock>;

  // Callback stubs
  const createLog = jest.fn().mockResolvedValue(undefined);
  const sendMessageToTopic = jest.fn().mockResolvedValue(undefined);
  const executeNextTasks = jest.fn().mockResolvedValue(undefined);
  const startMission = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    prisma = buildPrismaMock();
    topicEventEmitter = buildEventEmitterMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionLifecycleService,
        { provide: PrismaService, useValue: prisma },
        { provide: TopicEventEmitterService, useValue: topicEventEmitter },
      ],
    }).compile();

    service = module.get<MissionLifecycleService>(MissionLifecycleService);

    // Reset all callback mocks between tests
    createLog.mockClear();
    sendMessageToTopic.mockClear();
    executeNextTasks.mockClear();
    startMission.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // cancelMission
  // ==========================================================================

  describe("cancelMission()", () => {
    it("should cancel an in-progress mission and update subtasks", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.CANCELLED,
      });
      prisma.agentTask.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.cancelMission(
        "mission-1",
        "user-1",
        createLog,
      );

      expect(prisma.teamMission.update).toHaveBeenCalledWith({
        where: { id: "mission-1" },
        data: { status: MissionStatus.CANCELLED },
      });
      expect(prisma.agentTask.updateMany).toHaveBeenCalledWith({
        where: {
          missionId: "mission-1",
          status: {
            in: [AgentTaskStatus.PENDING, AgentTaskStatus.IN_PROGRESS],
          },
        },
        data: { status: AgentTaskStatus.CANCELLED },
      });
      expect(createLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          type: MissionLogType.MISSION_FAILED,
          content: expect.stringContaining("取消"),
        }),
      );
      expect(topicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "mission:cancelled",
        { missionId: "mission-1" },
      );
      expect(result).toEqual({ success: true, message: "任务已取消" });
    });

    it("should cancel a PENDING mission", async () => {
      const mission = makeMission({ status: MissionStatus.PENDING });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.CANCELLED,
      });
      prisma.agentTask.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.cancelMission(
        "mission-1",
        "user-1",
        createLog,
      );

      expect(result.success).toBe(true);
    });

    it("should throw NotFoundException when mission does not exist", async () => {
      prisma.teamMission.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelMission("non-existent", "user-1", createLog),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when mission is already COMPLETED", async () => {
      const mission = makeMission({ status: MissionStatus.COMPLETED });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.cancelMission("mission-1", "user-1", createLog),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when mission is already CANCELLED", async () => {
      const mission = makeMission({ status: MissionStatus.CANCELLED });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.cancelMission("mission-1", "user-1", createLog),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================================================
  // deleteMission
  // ==========================================================================

  describe("deleteMission()", () => {
    it("should delete a COMPLETED mission using a transaction", async () => {
      const mission = makeMission({ status: MissionStatus.COMPLETED });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.missionLog.deleteMany.mockReturnValue({
        where: { missionId: "mission-1" },
      });
      prisma.agentTask.deleteMany.mockReturnValue({
        where: { missionId: "mission-1" },
      });
      prisma.teamMission.delete.mockReturnValue({ where: { id: "mission-1" } });
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      const result = await service.deleteMission("mission-1", "user-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(topicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "mission:deleted",
        { missionId: "mission-1" },
      );
      expect(result).toEqual({ success: true, message: "任务已删除" });
    });

    it("should delete a FAILED mission", async () => {
      const mission = makeMission({ status: MissionStatus.FAILED });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      const result = await service.deleteMission("mission-1", "user-1");

      expect(result.success).toBe(true);
    });

    it("should delete a CANCELLED mission", async () => {
      const mission = makeMission({ status: MissionStatus.CANCELLED });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.$transaction.mockResolvedValue([{}, {}, {}]);

      const result = await service.deleteMission("mission-1", "user-1");

      expect(result.success).toBe(true);
    });

    it("should throw NotFoundException when mission does not exist", async () => {
      prisma.teamMission.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteMission("non-existent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when mission is IN_PROGRESS", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.deleteMission("mission-1", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when mission is PENDING", async () => {
      const mission = makeMission({ status: MissionStatus.PENDING });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.deleteMission("mission-1", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when mission is PLANNING", async () => {
      const mission = makeMission({ status: MissionStatus.PLANNING });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.deleteMission("mission-1", "user-1"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================================================
  // updateMissionNotification
  // ==========================================================================

  describe("updateMissionNotification()", () => {
    it("should update notification email and create a log entry", async () => {
      const mission = makeMission();
      const updatedRecord = {
        id: "mission-1",
        notificationEmail: "test@example.com",
      };

      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue(updatedRecord);

      const result = await service.updateMissionNotification(
        "mission-1",
        "user-1",
        { notificationEmail: "test@example.com" },
        createLog,
      );

      expect(prisma.teamMission.update).toHaveBeenCalledWith({
        where: { id: "mission-1" },
        data: { notificationEmail: "test@example.com" },
        select: { id: true, notificationEmail: true },
      });
      expect(createLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          type: MissionLogType.TASK_PROGRESS,
          content: expect.stringContaining("test@example.com"),
        }),
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe("通知配置已更新");
      expect(result.notificationEmail).toBe("test@example.com");
    });

    it("should clear notification email when null is provided", async () => {
      const mission = makeMission();
      const updatedRecord = { id: "mission-1", notificationEmail: null };

      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue(updatedRecord);

      const result = await service.updateMissionNotification(
        "mission-1",
        "user-1",
        { notificationEmail: null },
        createLog,
      );

      expect(prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { notificationEmail: null },
        }),
      );
      expect(createLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          content: expect.stringContaining("清除"),
        }),
      );
      expect(result.message).toBe("通知配置已清除");
      expect(result.notificationEmail).toBeNull();
    });

    it("should throw NotFoundException when mission does not exist", async () => {
      prisma.teamMission.findUnique.mockResolvedValue(null);

      await expect(
        service.updateMissionNotification(
          "non-existent",
          "user-1",
          { notificationEmail: "test@example.com" },
          createLog,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==========================================================================
  // pauseMission
  // ==========================================================================

  describe("pauseMission()", () => {
    it("should pause an IN_PROGRESS mission and save previous status", async () => {
      const mission = makeMission({
        status: MissionStatus.IN_PROGRESS,
        taskBreakdown: { existingField: "value" },
      });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.PAUSED,
      });

      const result = await service.pauseMission(
        "mission-1",
        "user-1",
        sendMessageToTopic,
        createLog,
      );

      expect(prisma.teamMission.update).toHaveBeenCalledWith({
        where: { id: "mission-1" },
        data: {
          status: MissionStatus.PAUSED,
          taskBreakdown: expect.objectContaining({
            _pausedFromStatus: MissionStatus.IN_PROGRESS,
          }),
        },
      });
      expect(createLog).toHaveBeenCalled();
      expect(sendMessageToTopic).toHaveBeenCalledWith(
        "topic-1",
        null,
        expect.stringContaining("暂停"),
        MessageContentType.SYSTEM,
      );
      expect(topicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "mission:paused",
        { missionId: "mission-1", previousStatus: MissionStatus.IN_PROGRESS },
      );
      expect(result).toEqual({
        success: true,
        message: "任务已暂停",
        previousStatus: MissionStatus.IN_PROGRESS,
      });
    });

    it("should pause a PLANNING mission", async () => {
      const mission = makeMission({
        status: MissionStatus.PLANNING,
        taskBreakdown: null,
      });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.PAUSED,
      });

      const result = await service.pauseMission(
        "mission-1",
        "user-1",
        sendMessageToTopic,
        createLog,
      );

      expect(result.previousStatus).toBe(MissionStatus.PLANNING);
      expect(prisma.teamMission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskBreakdown: expect.objectContaining({
              _pausedFromStatus: MissionStatus.PLANNING,
            }),
          }),
        }),
      );
    });

    it("should throw NotFoundException when mission does not exist", async () => {
      prisma.teamMission.findUnique.mockResolvedValue(null);

      await expect(
        service.pauseMission(
          "non-existent",
          "user-1",
          sendMessageToTopic,
          createLog,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when mission is COMPLETED", async () => {
      const mission = makeMission({ status: MissionStatus.COMPLETED });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.pauseMission(
          "mission-1",
          "user-1",
          sendMessageToTopic,
          createLog,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when mission is PENDING", async () => {
      const mission = makeMission({ status: MissionStatus.PENDING });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.pauseMission(
          "mission-1",
          "user-1",
          sendMessageToTopic,
          createLog,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when mission is already PAUSED", async () => {
      const mission = makeMission({ status: MissionStatus.PAUSED });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.pauseMission(
          "mission-1",
          "user-1",
          sendMessageToTopic,
          createLog,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==========================================================================
  // resumeMission
  // ==========================================================================

  describe("resumeMission()", () => {
    it("should resume a paused mission to IN_PROGRESS and execute next tasks", async () => {
      const mission = makeMission({
        status: MissionStatus.PAUSED,
        taskBreakdown: { _pausedFromStatus: MissionStatus.IN_PROGRESS },
      });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.IN_PROGRESS,
      });

      const result = await service.resumeMission(
        "mission-1",
        "user-1",
        sendMessageToTopic,
        createLog,
        executeNextTasks,
        startMission,
      );

      expect(prisma.teamMission.update).toHaveBeenCalledWith({
        where: { id: "mission-1" },
        data: {
          status: MissionStatus.IN_PROGRESS,
          taskBreakdown: {},
        },
      });
      expect(createLog).toHaveBeenCalledWith(
        "mission-1",
        expect.objectContaining({
          type: MissionLogType.TASK_STARTED,
          content: expect.stringContaining("恢复"),
        }),
      );
      expect(sendMessageToTopic).toHaveBeenCalledWith(
        "topic-1",
        null,
        expect.stringContaining("恢复"),
        MessageContentType.SYSTEM,
      );
      expect(topicEventEmitter.emitToTopic).toHaveBeenCalledWith(
        "topic-1",
        "mission:resumed",
        { missionId: "mission-1", status: MissionStatus.IN_PROGRESS },
      );
      expect(result).toEqual({
        success: true,
        message: "任务已恢复",
        status: MissionStatus.IN_PROGRESS,
      });

      // Allow the async executeNextTasks to settle
      await new Promise(process.nextTick);
      expect(executeNextTasks).toHaveBeenCalledWith("mission-1");
    });

    it("should resume a paused mission to PLANNING and restart planning", async () => {
      const mission = makeMission({
        status: MissionStatus.PAUSED,
        taskBreakdown: { _pausedFromStatus: MissionStatus.PLANNING },
      });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.PLANNING,
      });

      const result = await service.resumeMission(
        "mission-1",
        "user-1",
        sendMessageToTopic,
        createLog,
        executeNextTasks,
        startMission,
      );

      expect(result.status).toBe(MissionStatus.PLANNING);

      // Allow the async startMission to settle
      await new Promise(process.nextTick);
      expect(startMission).toHaveBeenCalledWith("mission-1", "user-1");
      expect(executeNextTasks).not.toHaveBeenCalled();
    });

    it("should default to IN_PROGRESS when _pausedFromStatus is missing", async () => {
      const mission = makeMission({
        status: MissionStatus.PAUSED,
        taskBreakdown: null,
      });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.IN_PROGRESS,
      });

      const result = await service.resumeMission(
        "mission-1",
        "user-1",
        sendMessageToTopic,
        createLog,
        executeNextTasks,
        startMission,
      );

      expect(result.status).toBe(MissionStatus.IN_PROGRESS);

      await new Promise(process.nextTick);
      expect(executeNextTasks).toHaveBeenCalled();
    });

    it("should throw NotFoundException when mission does not exist", async () => {
      prisma.teamMission.findUnique.mockResolvedValue(null);

      await expect(
        service.resumeMission(
          "non-existent",
          "user-1",
          sendMessageToTopic,
          createLog,
          executeNextTasks,
          startMission,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when mission is not PAUSED", async () => {
      const mission = makeMission({ status: MissionStatus.IN_PROGRESS });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.resumeMission(
          "mission-1",
          "user-1",
          sendMessageToTopic,
          createLog,
          executeNextTasks,
          startMission,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when mission is COMPLETED", async () => {
      const mission = makeMission({ status: MissionStatus.COMPLETED });
      prisma.teamMission.findUnique.mockResolvedValue(mission);

      await expect(
        service.resumeMission(
          "mission-1",
          "user-1",
          sendMessageToTopic,
          createLog,
          executeNextTasks,
          startMission,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should not block on executeNextTasks failure (fire and forget)", async () => {
      const mission = makeMission({
        status: MissionStatus.PAUSED,
        taskBreakdown: { _pausedFromStatus: MissionStatus.IN_PROGRESS },
      });
      prisma.teamMission.findUnique.mockResolvedValue(mission);
      prisma.teamMission.update.mockResolvedValue({
        ...mission,
        status: MissionStatus.IN_PROGRESS,
      });
      executeNextTasks.mockRejectedValueOnce(new Error("Execution error"));

      // Should NOT throw even if executeNextTasks fails
      const result = await service.resumeMission(
        "mission-1",
        "user-1",
        sendMessageToTopic,
        createLog,
        executeNextTasks,
        startMission,
      );

      expect(result.success).toBe(true);

      // Let the background promise settle without throwing
      await new Promise(process.nextTick);
    });
  });
});

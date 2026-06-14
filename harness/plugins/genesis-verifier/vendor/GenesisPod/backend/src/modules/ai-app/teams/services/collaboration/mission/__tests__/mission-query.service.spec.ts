/**
 * MissionQueryService Tests
 *
 * Covers:
 * - getMissions: list missions for a topic
 * - getMissionById: get by ID, throw NotFoundException if missing
 * - getMissionLogs: with pagination cursor
 * - missionExists: count-based existence check
 * - getMissionBasic: lightweight select
 * - getMissionTasks: task list with assignee
 * - getMissionStats: status count, word count, completion rate
 * - getInProgressMission: filter by IN_PROGRESS status
 * - getLatestMission: most recent mission
 * - getMissionFull: full include
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { MissionQueryService } from "../mission-query.service";
import { PrismaService } from "../../../../../../../common/prisma/prisma.service";
import { MissionStatus } from "@prisma/client";

// ============================================================
// Test Fixtures
// ============================================================

const mockLeader = {
  id: "leader-1",
  displayName: "Team Leader",
  agentName: "leader",
  avatar: null,
  aiModel: "gpt-4",
};

const mockCreatedBy = {
  id: "user-1",
  username: "creator",
  fullName: "Creator User",
};

const mockTask = {
  id: "task-1",
  missionId: "mission-1",
  title: "Chapter 1",
  status: "COMPLETED",
  result: "Some result text",
  createdAt: new Date("2024-01-01"),
  assignedTo: {
    id: "member-1",
    displayName: "Writer",
    agentName: "writer",
    avatar: null,
    aiModel: "gpt-4",
  },
};

const mockMission = {
  id: "mission-1",
  topicId: "topic-1",
  title: "Test Mission",
  status: MissionStatus.IN_PROGRESS,
  leaderId: "leader-1",
  progressPercent: 50,
  completedTasks: 1,
  totalTasks: 2,
  createdAt: new Date("2024-01-01"),
  leader: mockLeader,
  createdBy: mockCreatedBy,
  tasks: [mockTask],
  logs: [],
  _count: { tasks: 2, logs: 3 },
};

const mockLog = {
  id: "log-1",
  missionId: "mission-1",
  message: "Task started",
  createdAt: new Date("2024-01-01"),
};

// ============================================================
// Mock PrismaService
// ============================================================

const mockPrisma = {
  teamMission: {
    findMany: jest.fn().mockResolvedValue([mockMission]),
    findUnique: jest.fn().mockResolvedValue(mockMission),
    findFirst: jest.fn().mockResolvedValue(mockMission),
    count: jest.fn().mockResolvedValue(1),
  },
  agentTask: {
    findMany: jest.fn().mockResolvedValue([mockTask]),
  },
  missionLog: {
    findMany: jest.fn().mockResolvedValue([mockLog]),
  },
};

// ============================================================
// Test Suite
// ============================================================

describe("MissionQueryService", () => {
  let service: MissionQueryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissionQueryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MissionQueryService>(MissionQueryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== getMissions ====================

  describe("getMissions", () => {
    it("should return missions for a topic", async () => {
      const result = await service.getMissions("topic-1");

      expect(mockPrisma.teamMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "topic-1" },
        }),
      );
      expect(result).toEqual([mockMission]);
    });

    it("should filter by status when provided", async () => {
      await service.getMissions("topic-1", {
        status: MissionStatus.IN_PROGRESS,
      });

      expect(mockPrisma.teamMission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "topic-1", status: MissionStatus.IN_PROGRESS },
        }),
      );
    });

    it("should not include status filter when not provided", async () => {
      await service.getMissions("topic-1");

      const callArgs = mockPrisma.teamMission.findMany.mock.calls[0][0];
      expect(callArgs.where).not.toHaveProperty("status");
    });

    it("should include leader, createdBy, tasks and _count in result", async () => {
      await service.getMissions("topic-1");

      const callArgs = mockPrisma.teamMission.findMany.mock.calls[0][0];
      expect(callArgs.include).toHaveProperty("leader");
      expect(callArgs.include).toHaveProperty("createdBy");
      expect(callArgs.include).toHaveProperty("tasks");
      expect(callArgs.include).toHaveProperty("_count");
    });

    it("should order missions by createdAt desc", async () => {
      await service.getMissions("topic-1");

      const callArgs = mockPrisma.teamMission.findMany.mock.calls[0][0];
      expect(callArgs.orderBy).toEqual({ createdAt: "desc" });
    });
  });

  // ==================== getMissionById ====================

  describe("getMissionById", () => {
    it("should return mission when found", async () => {
      const result = await service.getMissionById("mission-1");

      expect(mockPrisma.teamMission.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "mission-1" } }),
      );
      expect(result).toEqual(mockMission);
    });

    it("should throw NotFoundException when mission not found", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      await expect(service.getMissionById("nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should include logs with recent 50 records", async () => {
      await service.getMissionById("mission-1");

      const callArgs = mockPrisma.teamMission.findUnique.mock.calls[0][0];
      expect(callArgs.include.logs.take).toBe(50);
      expect(callArgs.include.logs.orderBy).toEqual({ createdAt: "desc" });
    });

    it("should include tasks ordered by createdAt asc", async () => {
      await service.getMissionById("mission-1");

      const callArgs = mockPrisma.teamMission.findUnique.mock.calls[0][0];
      expect(callArgs.include.tasks.orderBy).toEqual({ createdAt: "asc" });
    });
  });

  // ==================== getMissionLogs ====================

  describe("getMissionLogs", () => {
    it("should return logs for a mission", async () => {
      const result = await service.getMissionLogs("mission-1");

      expect(mockPrisma.missionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { missionId: "mission-1" },
          take: 50,
          orderBy: { createdAt: "desc" },
        }),
      );
      expect(result).toEqual([mockLog]);
    });

    it("should use custom limit when provided", async () => {
      await service.getMissionLogs("mission-1", { limit: 100 });

      const callArgs = mockPrisma.missionLog.findMany.mock.calls[0][0];
      expect(callArgs.take).toBe(100);
    });

    it("should use cursor pagination when cursor is provided", async () => {
      await service.getMissionLogs("mission-1", { cursor: "log-5" });

      const callArgs = mockPrisma.missionLog.findMany.mock.calls[0][0];
      expect(callArgs.cursor).toEqual({ id: "log-5" });
      expect(callArgs.skip).toBe(1);
    });

    it("should not include cursor when not provided", async () => {
      await service.getMissionLogs("mission-1");

      const callArgs = mockPrisma.missionLog.findMany.mock.calls[0][0];
      expect(callArgs.cursor).toBeUndefined();
      expect(callArgs.skip).toBeUndefined();
    });

    it("should default to limit 50", async () => {
      await service.getMissionLogs("mission-1", {});

      const callArgs = mockPrisma.missionLog.findMany.mock.calls[0][0];
      expect(callArgs.take).toBe(50);
    });
  });

  // ==================== missionExists ====================

  describe("missionExists", () => {
    it("should return true when mission exists", async () => {
      mockPrisma.teamMission.count.mockResolvedValueOnce(1);

      const result = await service.missionExists("mission-1");

      expect(result).toBe(true);
    });

    it("should return false when mission does not exist", async () => {
      mockPrisma.teamMission.count.mockResolvedValueOnce(0);

      const result = await service.missionExists("nonexistent");

      expect(result).toBe(false);
    });

    it("should query count by mission ID", async () => {
      await service.missionExists("mission-abc");

      expect(mockPrisma.teamMission.count).toHaveBeenCalledWith({
        where: { id: "mission-abc" },
      });
    });
  });

  // ==================== getMissionBasic ====================

  describe("getMissionBasic", () => {
    it("should return basic mission info", async () => {
      const basicMission = {
        id: "mission-1",
        title: "Test",
        status: MissionStatus.PENDING,
        topicId: "topic-1",
        leaderId: "leader-1",
        progressPercent: 0,
        completedTasks: 0,
        totalTasks: 3,
        createdAt: new Date(),
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(basicMission);

      const result = await service.getMissionBasic("mission-1");

      expect(result).toEqual(basicMission);
    });

    it("should query only selected fields", async () => {
      await service.getMissionBasic("mission-1");

      const callArgs = mockPrisma.teamMission.findUnique.mock.calls[0][0];
      expect(callArgs.select).toBeDefined();
      expect(callArgs.select.id).toBe(true);
      expect(callArgs.select.title).toBe(true);
      expect(callArgs.select.status).toBe(true);
    });

    it("should return null when mission not found", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      const result = await service.getMissionBasic("nonexistent");

      expect(result).toBeNull();
    });
  });

  // ==================== getMissionTasks ====================

  describe("getMissionTasks", () => {
    it("should return tasks for a mission", async () => {
      const result = await service.getMissionTasks("mission-1");

      expect(mockPrisma.agentTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { missionId: "mission-1" },
          orderBy: { createdAt: "asc" },
        }),
      );
      expect(result).toEqual([mockTask]);
    });

    it("should include assignedTo details", async () => {
      await service.getMissionTasks("mission-1");

      const callArgs = mockPrisma.agentTask.findMany.mock.calls[0][0];
      expect(callArgs.include.assignedTo).toBeDefined();
      expect(callArgs.include.assignedTo.select.id).toBe(true);
      expect(callArgs.include.assignedTo.select.displayName).toBe(true);
    });
  });

  // ==================== getMissionStats ====================

  describe("getMissionStats", () => {
    it("should return stats with status counts", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([
        { status: "COMPLETED", result: "text result here" },
        { status: "COMPLETED", result: "more text" },
        { status: "PENDING", result: null },
      ]);

      const result = await service.getMissionStats("mission-1");

      expect(result.total).toBe(3);
      expect(result.statusCounts["COMPLETED"]).toBe(2);
      expect(result.statusCounts["PENDING"]).toBe(1);
    });

    it("should calculate completion rate correctly", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([
        { status: "COMPLETED", result: "done" },
        { status: "PENDING", result: null },
      ]);

      const result = await service.getMissionStats("mission-1");

      expect(result.completionRate).toBe(50);
    });

    it("should return 0 completion rate when no tasks", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([]);

      const result = await service.getMissionStats("mission-1");

      expect(result.total).toBe(0);
      expect(result.completionRate).toBe(0);
    });

    it("should compute totalWords from result lengths", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([
        { status: "COMPLETED", result: "hello" },
        { status: "COMPLETED", result: "world!" },
        { status: "PENDING", result: null },
      ]);

      const result = await service.getMissionStats("mission-1");

      expect(result.totalWords).toBe(5 + 6);
    });

    it("should handle tasks with null result gracefully", async () => {
      mockPrisma.agentTask.findMany.mockResolvedValueOnce([
        { status: "PENDING", result: null },
      ]);

      const result = await service.getMissionStats("mission-1");

      expect(result.totalWords).toBe(0);
    });
  });

  // ==================== getInProgressMission ====================

  describe("getInProgressMission", () => {
    it("should return in-progress mission for topic", async () => {
      const result = await service.getInProgressMission("topic-1");

      expect(mockPrisma.teamMission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "topic-1", status: MissionStatus.IN_PROGRESS },
        }),
      );
      expect(result).toEqual(mockMission);
    });

    it("should return null when no in-progress mission", async () => {
      mockPrisma.teamMission.findFirst.mockResolvedValueOnce(null);

      const result = await service.getInProgressMission("topic-empty");

      expect(result).toBeNull();
    });

    it("should include leader and tasks in result", async () => {
      await service.getInProgressMission("topic-1");

      const callArgs = mockPrisma.teamMission.findFirst.mock.calls[0][0];
      expect(callArgs.include.leader).toBe(true);
      expect(callArgs.include.tasks).toBeDefined();
    });
  });

  // ==================== getLatestMission ====================

  describe("getLatestMission", () => {
    it("should return latest mission for topic", async () => {
      const result = await service.getLatestMission("topic-1");

      expect(mockPrisma.teamMission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "topic-1" },
          orderBy: { createdAt: "desc" },
        }),
      );
      expect(result).toEqual(mockMission);
    });

    it("should return null when topic has no missions", async () => {
      mockPrisma.teamMission.findFirst.mockResolvedValueOnce(null);

      const result = await service.getLatestMission("empty-topic");

      expect(result).toBeNull();
    });

    it("should NOT filter by status (returns any status)", async () => {
      await service.getLatestMission("topic-1");

      const callArgs = mockPrisma.teamMission.findFirst.mock.calls[0][0];
      expect(callArgs.where).not.toHaveProperty("status");
    });
  });

  // ==================== getMissionFull ====================

  describe("getMissionFull", () => {
    it("should return full mission details", async () => {
      const fullMission = {
        ...mockMission,
        topic: { id: "topic-1", name: "Test Topic" },
        createdBy: mockCreatedBy,
      };
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(fullMission);

      const result = await service.getMissionFull("mission-1");

      expect(mockPrisma.teamMission.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "mission-1" } }),
      );
      expect(result).toEqual(fullMission);
    });

    it("should return null when mission not found", async () => {
      mockPrisma.teamMission.findUnique.mockResolvedValueOnce(null);

      const result = await service.getMissionFull("nonexistent");

      expect(result).toBeNull();
    });

    it("should include topic info", async () => {
      await service.getMissionFull("mission-1");

      const callArgs = mockPrisma.teamMission.findUnique.mock.calls[0][0];
      expect(callArgs.include.topic).toBeDefined();
      expect(callArgs.include.topic.select.id).toBe(true);
      expect(callArgs.include.topic.select.name).toBe(true);
    });

    it("should include last 100 logs", async () => {
      await service.getMissionFull("mission-1");

      const callArgs = mockPrisma.teamMission.findUnique.mock.calls[0][0];
      expect(callArgs.include.logs.take).toBe(100);
    });
  });
});

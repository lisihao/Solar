/**
 * Unit tests for SlidesRepository
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SlidesRepository } from "../slides-repository";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  SlidesTask,
  SlidesMissionEvent,
  SlidesTeamOrchestratorInput,
} from "../types";

const buildCreateInput = (
  overrides: Partial<SlidesTeamOrchestratorInput> = {},
): SlidesTeamOrchestratorInput => ({
  userId: "user-001",
  sessionId: "session-abc",
  sourceText: "This is the source text for the presentation.",
  userRequirement: "Create a comprehensive report",
  targetPages: 8,
  stylePreference: "dark",
  themeId: "genspark-dark",
  ...overrides,
});

const buildDbMission = (overrides: Record<string, unknown> = {}) => ({
  id: "mission-db-001",
  userId: "user-001",
  sessionId: "session-abc",
  sourceText: "Source text",
  userRequirement: "User requirement",
  targetPages: 8,
  stylePreference: "dark",
  themeId: "genspark-dark",
  status: "PENDING",
  currentPhase: "PLANNING",
  taskBreakdown: null,
  outline: null,
  pages: [],
  qualityAudit: null,
  totalTasks: 0,
  completedTasks: 0,
  metadata: {},
  createdAt: new Date("2024-01-01"),
  startedAt: null,
  completedAt: null,
  tasks: [],
  ...overrides,
});

describe("SlidesRepository", () => {
  let repository: SlidesRepository;

  const mockPrisma = {
    slidesMission: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    slidesTask: {
      createMany: jest.fn(),
      update: jest.fn(),
    },
    slidesMissionEvent: {
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlidesRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get<SlidesRepository>(SlidesRepository);
  });

  it("should be defined", () => {
    expect(repository).toBeDefined();
  });

  describe("createMission", () => {
    it("should create a mission and return mapped SlidesMission", async () => {
      const dbMission = buildDbMission();
      mockPrisma.slidesMission.create.mockResolvedValue(dbMission);

      const result = await repository.createMission(buildCreateInput());

      expect(result).toBeDefined();
      expect(result.userId).toBe("user-001");
      expect(result.sessionId).toBe("session-abc");
      expect(result.status).toBe("pending");
      expect(mockPrisma.slidesMission.create).toHaveBeenCalledTimes(1);
    });

    it("should handle sourceSubscription in create", async () => {
      const dbMission = buildDbMission();
      mockPrisma.slidesMission.create.mockResolvedValue(dbMission);

      const input = buildCreateInput({
        sourceSubscription: {
          type: "topic-insights",
          sourceId: "topic-123",
          sourceName: "AI Market",
          subscribedAt: new Date().toISOString(),
          lastSourceUpdatedAt: new Date().toISOString(),
          isStale: false,
        },
      });

      await repository.createMission(input);

      const createCall = mockPrisma.slidesMission.create.mock.calls[0][0];
      expect(createCall.data.sourceSubscription).toBeDefined();
    });
  });

  describe("getMission", () => {
    it("should return null when mission does not exist", async () => {
      mockPrisma.slidesMission.findUnique.mockResolvedValue(null);

      const result = await repository.getMission("nonexistent-id");

      expect(result).toBeNull();
    });

    it("should return a SlidesMission when found", async () => {
      const dbMission = buildDbMission({ tasks: [] });
      mockPrisma.slidesMission.findUnique.mockResolvedValue(dbMission);

      const result = await repository.getMission("mission-db-001");

      expect(result).not.toBeNull();
      expect(result!.id).toBe("mission-db-001");
      expect(result!.tasks).toEqual([]);
    });
  });

  describe("updateMissionStatus", () => {
    it("should update mission status with phase", async () => {
      mockPrisma.slidesMission.update.mockResolvedValue({});

      await repository.updateMissionStatus(
        "mission-001",
        "in_progress",
        "executing",
      );

      const updateCall = mockPrisma.slidesMission.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe("EXECUTING");
      expect(updateCall.data.currentPhase).toBe("EXECUTING");
      expect(updateCall.data.startedAt).toBeInstanceOf(Date);
    });

    it("should set completedAt when status is completed", async () => {
      mockPrisma.slidesMission.update.mockResolvedValue({});

      await repository.updateMissionStatus("mission-001", "completed");

      const updateCall = mockPrisma.slidesMission.update.mock.calls[0][0];
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("recordEvent", () => {
    it("should record a known event type", async () => {
      mockPrisma.slidesMissionEvent.create.mockResolvedValue({});

      const event: SlidesMissionEvent = {
        type: "mission:created",
        missionId: "mission-001",
        timestamp: new Date(),
        data: { userId: "user-1" },
      };

      await repository.recordEvent(event);

      expect(mockPrisma.slidesMissionEvent.create).toHaveBeenCalledTimes(1);
      const createArg = mockPrisma.slidesMissionEvent.create.mock.calls[0][0];
      expect(createArg.data.type).toBe("MISSION_CREATED");
    });

    it("should skip unknown event types without throwing", async () => {
      const event: SlidesMissionEvent = {
        type: "unknown:event" as any,
        missionId: "mission-001",
        timestamp: new Date(),
        data: {},
      };

      await expect(repository.recordEvent(event)).resolves.not.toThrow();
      expect(mockPrisma.slidesMissionEvent.create).not.toHaveBeenCalled();
    });
  });

  describe("getMissionEvents", () => {
    it("should return mapped events", async () => {
      const dbEvents = [
        {
          missionId: "mission-001",
          type: "MISSION_CREATED",
          data: { userId: "user-1" },
          timestamp: new Date(),
          taskId: null,
          memberId: null,
        },
        {
          missionId: "mission-001",
          type: "TASK_COMPLETED",
          data: { taskId: "task-1" },
          timestamp: new Date(),
          taskId: "task-1",
          memberId: null,
        },
      ];
      mockPrisma.slidesMissionEvent.findMany.mockResolvedValue(dbEvents);

      const events = await repository.getMissionEvents("mission-001", 10);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("mission:created");
      expect(events[1].type).toBe("task:completed");
    });
  });

  describe("getUserMissions", () => {
    it("should return filtered missions for a user", async () => {
      const dbMissions = [
        buildDbMission(),
        buildDbMission({ id: "mission-db-002" }),
      ];
      mockPrisma.slidesMission.findMany.mockResolvedValue(dbMissions);

      const results = await repository.getUserMissions("user-001");

      expect(results).toHaveLength(2);
    });

    it("should apply status filter when provided", async () => {
      mockPrisma.slidesMission.findMany.mockResolvedValue([]);

      await repository.getUserMissions("user-001", { status: "completed" });

      const findArgs = mockPrisma.slidesMission.findMany.mock.calls[0][0];
      expect(findArgs.where.status).toBe("COMPLETED");
    });
  });

  describe("completeMission", () => {
    it("should update mission to COMPLETED with pages and duration", async () => {
      mockPrisma.slidesMission.update.mockResolvedValue({});

      const pages = [
        {
          pageNumber: 1,
          html: "<html></html>",
          templateId: "cover",
          title: "Cover",
        },
      ] as any;
      await repository.completeMission("mission-001", pages, 12345);

      const updateCall = mockPrisma.slidesMission.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe("COMPLETED");
      expect(updateCall.data.duration).toBe(12345);
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("createTasks", () => {
    it("should create multiple tasks in batch", async () => {
      mockPrisma.slidesTask.createMany.mockResolvedValue({ count: 2 });

      const tasks = [
        {
          id: "t1",
          title: "Task 1",
          description: "Desc",
          assignee: "analyst" as const,
          skillId: "slides-task-decomposition",
          input: {},
          dependencies: [],
          status: "pending" as const,
          priority: "high" as const,
          revisionCount: 0,
          maxRevisions: 3,
          createdAt: new Date(),
        },
        {
          id: "t2",
          title: "Task 2",
          description: "Desc",
          assignee: "writer" as const,
          skillId: "slides-page-pipeline",
          input: {},
          dependencies: ["t1"],
          status: "pending" as const,
          priority: "medium" as const,
          revisionCount: 0,
          maxRevisions: 3,
          createdAt: new Date(),
        },
      ] as SlidesTask[];

      await repository.createTasks("mission-001", tasks);

      expect(mockPrisma.slidesTask.createMany).toHaveBeenCalledTimes(1);
      const createArg = mockPrisma.slidesTask.createMany.mock.calls[0][0];
      expect(createArg.data).toHaveLength(2);
    });
  });
});

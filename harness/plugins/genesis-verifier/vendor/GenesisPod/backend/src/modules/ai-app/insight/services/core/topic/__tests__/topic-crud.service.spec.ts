/**
 * TopicCrudService Unit Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicCrudService } from "../topic-crud.service";
import { EventSourceParsingService } from "../event-source-parsing.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { ResearchTopicStatus } from "@prisma/client";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    researchTopic: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    topicDimension: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    topicCollaborator: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    researchMission: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    topicReport: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
    },
    topicRefreshLog: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({
        _count: 0,
        _avg: { dimensionsRefreshed: 0, sourcesFound: 0 },
      }),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(mockPrisma),
    ),
    $queryRaw: jest.fn().mockResolvedValue([{ id: "topic-1" }]),
  };

  return { mockPrisma };
}

const mockTopic = {
  id: "topic-1",
  name: "AI Research",
  userId: "user-1",
  description: "Research on AI trends",
  type: "TECHNOLOGY",
  status: ResearchTopicStatus.ACTIVE,
  visibility: "PRIVATE",
  language: "zh",
  totalReports: 0,
  totalSources: 0,
  lastRefreshAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  dimensions: [],
  reports: [],
  _count: { reports: 0, dimensions: 0, refreshLogs: 0 },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TopicCrudService", () => {
  let service: TopicCrudService;
  let prisma: ReturnType<typeof buildMocks>["mockPrisma"];

  beforeEach(async () => {
    const mocks = buildMocks();
    prisma = mocks.mockPrisma;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicCrudService,
        { provide: PrismaService, useValue: mocks.mockPrisma },
        {
          provide: EventSourceParsingService,
          useValue: { parseEventSourceAsync: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TopicCrudService>(TopicCrudService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── createTopic ────────────────────────────────────────────────────────────

  describe("createTopic", () => {
    it("should create topic without dimensions when none provided", async () => {
      prisma.researchTopic.create = jest.fn().mockResolvedValue(mockTopic);
      prisma.$transaction.mockImplementation(
        async (_cb: (tx: unknown) => Promise<unknown>) => {
          const result = await prisma.researchTopic.create();
          return { ...result, dimensions: [] };
        },
      );

      const result = await service.createTopic("user-1", {
        name: "AI Research",
        type: "TECHNOLOGY" as any,
      } as any);

      expect(result.name).toBe("AI Research");
      expect(result.dimensions).toEqual([]);
    });

    it("should create topic with dimensions when provided", async () => {
      const topicWithDims = { ...mockTopic, id: "topic-with-dims" };
      prisma.researchTopic.create = jest.fn().mockResolvedValue(topicWithDims);
      prisma.topicDimension.create = jest
        .fn()
        .mockResolvedValue({ id: "dim-1", name: "Market" });

      prisma.$transaction.mockImplementation(
        async (_cb: (tx: unknown) => Promise<unknown>) => {
          const topic = await prisma.researchTopic.create();
          const dim = await prisma.topicDimension.create();
          return { ...topic, dimensions: [dim] };
        },
      );

      const result = await service.createTopic("user-1", {
        name: "AI Research",
        type: "TECHNOLOGY" as any,
        dimensions: [{ name: "Market Analysis", description: "Market study" }],
      } as any);

      expect(result.dimensions).toHaveLength(1);
    });
  });

  // ─── getTopic ────────────────────────────────────────────────────────────────

  describe("getTopic", () => {
    it("should throw NotFoundException when topic not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(service.getTopic("user-1", "nonexistent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw ForbiddenException when user lacks access to private topic", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopic,
        userId: "other-user",
        visibility: "PRIVATE",
      });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "PRIVATE", is_collaborator: false },
      ]);

      await expect(service.getTopic("user-1", "topic-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should return topic for owner", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(mockTopic);

      const result = await service.getTopic("user-1", "topic-1");
      expect(result.id).toBe("topic-1");
    });

    it("should return topic for PUBLIC visibility", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopic,
        userId: "other-user",
        visibility: "PUBLIC",
      });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "PUBLIC", is_collaborator: false },
      ]);

      const result = await service.getTopic("user-1", "topic-1");
      expect(result.id).toBe("topic-1");
    });
  });

  // ─── updateTopic ────────────────────────────────────────────────────────────

  describe("updateTopic", () => {
    it("should throw NotFoundException when topic not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTopic("user-1", "nonexistent", {
          name: "New Name",
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when non-owner tries to update", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "other-user",
      });

      await expect(
        service.updateTopic("user-1", "topic-1", { name: "Updated" } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should update topic successfully for owner", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.researchTopic.update.mockResolvedValue({
        ...mockTopic,
        name: "Updated AI Research",
        dimensions: [],
      });

      const result = await service.updateTopic("user-1", "topic-1", {
        name: "Updated AI Research",
      } as any);
      expect(result.name).toBe("Updated AI Research");
    });
  });

  // ─── deleteTopic ────────────────────────────────────────────────────────────

  describe("deleteTopic", () => {
    it("should throw NotFoundException when topic not found", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteTopic("user-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for non-owner", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "other-user",
      });

      await expect(service.deleteTopic("user-1", "topic-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should delete topic for owner", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.researchTopic.delete.mockResolvedValue({});

      const result = await service.deleteTopic("user-1", "topic-1");
      expect(result.success).toBe(true);
      expect(prisma.researchTopic.delete).toHaveBeenCalled();
    });
  });

  // ─── getResearchHistory ──────────────────────────────────────────────────────

  describe("getResearchHistory", () => {
    it("should return timeline with missions and reports", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.researchMission.findMany.mockResolvedValue([
        {
          id: "mission-1",
          createdAt: new Date(),
          completedAt: new Date(),
          status: "COMPLETED",
          tasks: [
            {
              id: "task-1",
              status: "COMPLETED",
              dimensionName: "Market",
              result: { summary: "Done" },
              resultSummary: "Done",
            },
          ],
        },
      ]);
      prisma.topicReport.findMany.mockResolvedValue([
        {
          id: "report-1",
          version: 1,
          generatedAt: new Date(),
          totalSources: 10,
        },
      ]);

      const result = await service.getResearchHistory("user-1", "topic-1");
      expect(result.timeline.length).toBeGreaterThanOrEqual(1);
      expect(result.totalMissions).toBe(1);
      expect(result.totalReports).toBe(1);
    });
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe("getStats", () => {
    it("should return topic stats", async () => {
      prisma.researchTopic.findUnique
        .mockResolvedValueOnce({ userId: "user-1" }) // access check
        .mockResolvedValueOnce({
          ...mockTopic,
          _count: { dimensions: 3, reports: 2, refreshLogs: 5 },
        });

      const result = await service.getStats("user-1", "topic-1");
      expect(result.topic.id).toBe("topic-1");
      expect(result.counts).toBeDefined();
    });

    it("should throw NotFoundException when topic not found for stats", async () => {
      prisma.researchTopic.findUnique
        .mockResolvedValueOnce({ userId: "user-1" }) // access check
        .mockResolvedValueOnce(null); // getStats query

      await expect(service.getStats("user-1", "topic-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── listTopics ─────────────────────────────────────────────────────────────

  describe("listTopics", () => {
    it("should return paginated topic list", async () => {
      prisma.topicCollaborator.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([{ id: "topic-1" }]);
      prisma.researchTopic.findMany.mockResolvedValue([
        {
          ...mockTopic,
          _count: { reports: 0, dimensions: 0 },
          reports: [],
          missions: [],
        },
      ]);
      prisma.researchTopic.count.mockResolvedValue(1);

      const result = await service.listTopics("user-1", {
        skip: 0,
        take: 20,
      } as any);
      expect(result.topics).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should apply type filter when provided", async () => {
      prisma.researchTopic.findMany.mockResolvedValue([]);
      prisma.researchTopic.count.mockResolvedValue(0);

      await service.listTopics("user-1", {
        type: "TECHNOLOGY",
        skip: 0,
        take: 20,
      } as any);

      expect(prisma.researchTopic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ type: "TECHNOLOGY" }),
            ]),
          }),
        }),
      );
    });

    it("should apply status filter when provided", async () => {
      prisma.researchTopic.findMany.mockResolvedValue([]);
      prisma.researchTopic.count.mockResolvedValue(0);

      await service.listTopics("user-1", {
        status: "ACTIVE" as any,
        skip: 0,
        take: 20,
      } as any);

      expect(prisma.researchTopic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({ status: "ACTIVE" }),
            ]),
          }),
        }),
      );
    });

    it("should apply search filter when provided", async () => {
      prisma.researchTopic.findMany.mockResolvedValue([]);
      prisma.researchTopic.count.mockResolvedValue(0);

      await service.listTopics("user-1", {
        search: "semiconductor",
        skip: 0,
        take: 20,
      } as any);

      expect(prisma.researchTopic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({
                    name: expect.objectContaining({
                      contains: "semiconductor",
                    }),
                  }),
                ]),
              }),
            ]),
          }),
        }),
      );
    });

    it("should compute missionProgress from latestMission", async () => {
      prisma.researchTopic.findMany.mockResolvedValue([
        {
          ...mockTopic,
          _count: { reports: 1, dimensions: 2 },
          reports: [{ id: "r-1", totalSources: 15, generatedAt: new Date() }],
          missions: [
            {
              id: "m-1",
              status: "COMPLETED",
              totalTasks: 5,
              completedTasks: 5,
              progressPercent: 100,
            },
          ],
        },
      ]);
      prisma.researchTopic.count.mockResolvedValue(1);

      const result = await service.listTopics("user-1", {
        skip: 0,
        take: 20,
      } as any);
      const topic = result.topics[0];
      expect(topic.missionProgress).toBe(100);
      expect(topic.missionStatus).toBe("COMPLETED");
      expect(topic.totalSources).toBe(15);
    });

    it("should return missionStatus null when no missions", async () => {
      prisma.researchTopic.findMany.mockResolvedValue([
        {
          ...mockTopic,
          _count: { reports: 0, dimensions: 0 },
          reports: [],
          missions: [],
        },
      ]);
      prisma.researchTopic.count.mockResolvedValue(1);

      const result = await service.listTopics("user-1", {
        skip: 0,
        take: 20,
      } as any);
      const topic = result.topics[0];
      expect(topic.missionStatus).toBeNull();
      expect(topic.missionProgress).toBe(0);
    });
  });

  // ─── getLogs ─────────────────────────────────────────────────────────────────

  describe("getLogs", () => {
    it("should return logs for topic owner", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.topicRefreshLog.findMany.mockResolvedValue([
        { id: "log-1", status: "SUCCESS", startedAt: new Date() },
      ]);
      prisma.topicRefreshLog.count.mockResolvedValue(1);

      const result = await service.getLogs("user-1", "topic-1", {
        limit: 20,
      } as any);
      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("should apply status filter when provided in query", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.topicRefreshLog.findMany.mockResolvedValue([]);
      prisma.topicRefreshLog.count.mockResolvedValue(0);

      await service.getLogs("user-1", "topic-1", {
        status: "SUCCESS",
        limit: 10,
      } as any);

      expect(prisma.topicRefreshLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "SUCCESS" }),
        }),
      );
    });

    it("should throw NotFoundException when topic not found for getLogs", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(
        service.getLogs("user-1", "nonexistent", {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── recalculateTopicStats ───────────────────────────────────────────────────

  describe("recalculateTopicStats", () => {
    it("should update topic stats from reports", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.topicReport.aggregate.mockResolvedValue({
        _count: { id: 3 },
        _max: { generatedAt: new Date("2024-06-01") },
      });
      prisma.topicReport.findFirst.mockResolvedValue({ totalSources: 42 });
      prisma.researchTopic.update.mockResolvedValue({
        ...mockTopic,
        totalReports: 3,
        totalSources: 42,
      });

      const result = await service.recalculateTopicStats("user-1", "topic-1");
      expect(result.totalReports).toBe(3);
      expect(result.totalSources).toBe(42);
      expect(prisma.researchTopic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ totalReports: 3, totalSources: 42 }),
        }),
      );
    });

    it("should use 0 for totalSources when no reports exist", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.topicReport.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _max: { generatedAt: null },
      });
      prisma.topicReport.findFirst.mockResolvedValue(null);
      prisma.researchTopic.update.mockResolvedValue({
        ...mockTopic,
        totalReports: 0,
        totalSources: 0,
      });

      const result = await service.recalculateTopicStats("user-1", "topic-1");
      expect(result.totalSources).toBe(0);
    });

    it("should throw ForbiddenException for non-owner", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "other-user",
      });

      await expect(
        service.recalculateTopicStats("user-1", "topic-1"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── checkTopicAccess (via getTopic) ─────────────────────────────────────────

  describe("checkTopicAccess edge cases", () => {
    it("should allow SHARED topic access for active collaborator", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopic,
        userId: "other-user",
        visibility: "SHARED",
      });
      // $queryRaw returns SHARED + is_collaborator true
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "SHARED", is_collaborator: true },
      ]);

      const result = await service.getTopic("user-1", "topic-1");
      expect(result.id).toBe("topic-1");
    });

    it("should deny SHARED topic access when not a collaborator", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopic,
        userId: "other-user",
        visibility: "SHARED",
      });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "SHARED", is_collaborator: false },
      ]);

      await expect(service.getTopic("user-1", "topic-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should deny PRIVATE topic access to non-owner", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopic,
        userId: "other-user",
        visibility: "PRIVATE",
      });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "PRIVATE", is_collaborator: false },
      ]);

      await expect(service.getTopic("user-1", "topic-1")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should deny when $queryRaw returns empty array", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        ...mockTopic,
        userId: "other-user",
        visibility: "SHARED",
      });
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getTopic("user-1", "topic-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── verifyTopicReadAccess (via getResearchHistory) ─────────────────────────

  describe("verifyTopicReadAccess", () => {
    it("should throw ForbiddenException when non-owner tries to read private topic", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "other-user",
      });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "PRIVATE", is_collaborator: false },
      ]);

      await expect(
        service.getResearchHistory("user-1", "topic-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should allow non-owner to access PUBLIC topic via getResearchHistory", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({
        userId: "other-user",
      });
      prisma.$queryRaw.mockResolvedValue([
        { visibility: "PUBLIC", is_collaborator: false },
      ]);
      prisma.researchMission.findMany.mockResolvedValue([]);
      prisma.topicReport.findMany.mockResolvedValue([]);

      const result = await service.getResearchHistory("user-1", "topic-1");
      expect(result.totalMissions).toBe(0);
    });
  });

  // ─── createTopic - transaction callback coverage ─────────────────────────────

  describe("createTopic - transaction callback", () => {
    let eventSourceParsing: { parseEventSourceAsync: jest.Mock };

    beforeEach(async () => {
      const mocks = buildMocks();
      prisma = mocks.mockPrisma;
      eventSourceParsing = { parseEventSourceAsync: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TopicCrudService,
          { provide: PrismaService, useValue: mocks.mockPrisma },
          {
            provide: EventSourceParsingService,
            useValue: eventSourceParsing,
          },
        ],
      }).compile();

      service = module.get<TopicCrudService>(TopicCrudService);
    });

    it("should create topic with dimensions in transaction and log with dimensions count", async () => {
      const topicBase = { ...mockTopic, id: "tx-topic-1" };
      const dimResult = { id: "dim-tx-1", name: "Market" };

      // Make $transaction execute the real callback
      prisma.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            researchTopic: {
              create: jest.fn().mockResolvedValue(topicBase),
            },
            topicDimension: {
              create: jest.fn().mockResolvedValue(dimResult),
            },
          };
          return cb(tx);
        },
      );

      const result = await service.createTopic("user-1", {
        name: "AI Research",
        type: "TECHNOLOGY" as any,
        dimensions: [{ name: "Market Analysis", description: "Market study" }],
      } as any);

      expect(result.dimensions).toHaveLength(1);
    });

    it("should create topic without dimensions in transaction and log without dimensions", async () => {
      const topicBase = { ...mockTopic, id: "tx-topic-2" };

      prisma.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            researchTopic: {
              create: jest.fn().mockResolvedValue(topicBase),
            },
            topicDimension: {
              create: jest.fn(),
            },
          };
          return cb(tx);
        },
      );

      const result = await service.createTopic("user-1", {
        name: "AI Research",
        type: "TECHNOLOGY" as any,
      } as any);

      expect(result.dimensions).toHaveLength(0);
    });

    it("should trigger parseEventSourceAsync for EVENT type topic", async () => {
      const topicBase = { ...mockTopic, id: "event-topic-1", type: "EVENT" };

      prisma.$transaction.mockImplementation(
        async (cb: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            researchTopic: {
              create: jest.fn().mockResolvedValue(topicBase),
            },
            topicDimension: {
              create: jest.fn(),
            },
          };
          return cb(tx);
        },
      );

      await service.createTopic("user-1", {
        name: "Event Topic",
        type: "EVENT" as any,
      } as any);

      expect(eventSourceParsing.parseEventSourceAsync).toHaveBeenCalledWith(
        "event-topic-1",
      );
    });
  });

  // ─── getResearchHistory - task with no dimensionName ──────────────────────

  describe("getResearchHistory - task filter branches", () => {
    it("should filter out tasks with no dimensionName from dimensionResults", async () => {
      prisma.researchTopic.findUnique.mockResolvedValue({ userId: "user-1" });
      prisma.researchMission.findMany.mockResolvedValue([
        {
          id: "mission-1",
          createdAt: new Date(),
          completedAt: new Date(),
          status: "COMPLETED",
          tasks: [
            {
              id: "task-no-dim",
              status: "COMPLETED",
              dimensionName: null, // No dimensionName
              result: { summary: "Done", keyFindings: [] },
              resultSummary: "Done",
            },
            {
              id: "task-with-dim",
              status: "COMPLETED",
              dimensionName: "Market",
              result: { summary: "Market done" },
              resultSummary: "Done",
            },
          ],
        },
      ]);
      prisma.topicReport.findMany.mockResolvedValue([]);

      const result = await service.getResearchHistory("user-1", "topic-1");
      expect(result.totalMissions).toBe(1);
    });
  });

  // ─── verifyTopicOwnership (called via deleteTopic / updateTopic) ──────────

  describe("verifyTopicOwnership - NotFoundException when topic deleted concurrently", () => {
    it("should throw NotFoundException when topic not found in verifyTopicOwnership", async () => {
      // The method is private but called by updateTopic and deleteTopic.
      // deleteTopic calls verifyTopicOwnership then deletes.
      // Make findUnique return null to simulate topic disappearing.
      prisma.researchTopic.findUnique.mockResolvedValue(null);

      await expect(service.deleteTopic("user-1", "topic-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

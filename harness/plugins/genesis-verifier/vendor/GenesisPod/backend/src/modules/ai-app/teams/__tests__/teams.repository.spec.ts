/**
 * TeamsRepository 单元测试
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TeamsRepository } from "../teams.repository";
import { PrismaService } from "../../../../common/prisma/prisma.service";

// ==================== Mock ====================

const mockPrisma = {
  topic: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  topicMember: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  topicAIMember: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicMessage: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicResource: {
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  topicSummary: {
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};

// ==================== Tests ====================

describe("TeamsRepository", () => {
  let repo: TeamsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsRepository,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    repo = module.get<TeamsRepository>(TeamsRepository);
  });

  // ==================== Topic ====================

  describe("findTopicsByUserId", () => {
    it("should query topics by userId with members filter", async () => {
      const topics = [{ id: "t1", title: "话题1" }];
      mockPrisma.topic.findMany.mockResolvedValue(topics);

      const result = await repo.findTopicsByUserId("user-001");
      expect(result).toEqual(topics);
      expect(mockPrisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            members: { some: { userId: "user-001" } },
          }),
          orderBy: { updatedAt: "desc" },
        }),
      );
    });

    it("should merge additional where conditions", async () => {
      mockPrisma.topic.findMany.mockResolvedValue([]);
      await repo.findTopicsByUserId("user-001", { isArchived: false });
      expect(mockPrisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isArchived: false }),
        }),
      );
    });
  });

  describe("findTopicById", () => {
    it("should find topic by id", async () => {
      const topic = { id: "t1", title: "话题1" };
      mockPrisma.topic.findUnique.mockResolvedValue(topic);

      const result = await repo.findTopicById("t1");
      expect(result).toEqual(topic);
      expect(mockPrisma.topic.findUnique).toHaveBeenCalledWith({
        where: { id: "t1" },
        include: undefined,
      });
    });

    it("should return null when not found", async () => {
      mockPrisma.topic.findUnique.mockResolvedValue(null);
      const result = await repo.findTopicById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("createTopic", () => {
    it("should create a topic", async () => {
      const data = { title: "新话题" } as never;
      const created = { id: "t1", title: "新话题" };
      mockPrisma.topic.create.mockResolvedValue(created);

      const result = await repo.createTopic(data);
      expect(result).toEqual(created);
      expect(mockPrisma.topic.create).toHaveBeenCalledWith({
        data,
        include: undefined,
      });
    });
  });

  describe("updateTopic", () => {
    it("should update a topic", async () => {
      const updated = { id: "t1", title: "更新标题" };
      mockPrisma.topic.update.mockResolvedValue(updated);

      const result = await repo.updateTopic("t1", { title: "更新标题" });
      expect(result).toEqual(updated);
      expect(mockPrisma.topic.update).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { title: "更新标题" },
        include: undefined,
      });
    });
  });

  describe("deleteTopic", () => {
    it("should delete a topic", async () => {
      const deleted = { id: "t1" };
      mockPrisma.topic.delete.mockResolvedValue(deleted);

      const result = await repo.deleteTopic("t1");
      expect(result).toEqual(deleted);
      expect(mockPrisma.topic.delete).toHaveBeenCalledWith({
        where: { id: "t1" },
      });
    });
  });

  describe("countTopics", () => {
    it("should count topics matching where clause", async () => {
      mockPrisma.topic.count.mockResolvedValue(5);
      const result = await repo.countTopics({ userId: "u1" } as never);
      expect(result).toBe(5);
    });
  });

  // ==================== TopicMember ====================

  describe("findMembersByTopicId", () => {
    it("should find members ordered by role and joinedAt", async () => {
      mockPrisma.topicMember.findMany.mockResolvedValue([]);
      await repo.findMembersByTopicId("t1");
      expect(mockPrisma.topicMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { topicId: "t1" },
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        }),
      );
    });
  });

  describe("findMemberByTopicAndUser", () => {
    it("should find member by composite key", async () => {
      const member = { id: "m1" };
      mockPrisma.topicMember.findUnique.mockResolvedValue(member);

      const result = await repo.findMemberByTopicAndUser("t1", "u1");
      expect(result).toEqual(member);
      expect(mockPrisma.topicMember.findUnique).toHaveBeenCalledWith({
        where: { topicId_userId: { topicId: "t1", userId: "u1" } },
      });
    });
  });

  describe("createMember", () => {
    it("should create a member", async () => {
      const data = { topicId: "t1", userId: "u1" } as never;
      mockPrisma.topicMember.create.mockResolvedValue({ id: "m1", ...data });
      await repo.createMember(data);
      expect(mockPrisma.topicMember.create).toHaveBeenCalledWith({ data });
    });
  });

  describe("createManyMembers", () => {
    it("should bulk create members with skipDuplicates", async () => {
      mockPrisma.topicMember.createMany.mockResolvedValue({ count: 2 });
      const data = [{ topicId: "t1", userId: "u1" }] as never[];
      const result = await repo.createManyMembers(data);
      expect(result.count).toBe(2);
      expect(mockPrisma.topicMember.createMany).toHaveBeenCalledWith({
        data,
        skipDuplicates: true,
      });
    });
  });

  describe("deleteMember / deleteManyMembers", () => {
    it("should delete a single member", async () => {
      mockPrisma.topicMember.delete.mockResolvedValue({ id: "m1" });
      await repo.deleteMember("m1");
      expect(mockPrisma.topicMember.delete).toHaveBeenCalledWith({
        where: { id: "m1" },
      });
    });

    it("should bulk delete members", async () => {
      mockPrisma.topicMember.deleteMany.mockResolvedValue({ count: 3 });
      const result = await repo.deleteManyMembers({ topicId: "t1" } as never);
      expect(result.count).toBe(3);
    });
  });

  // ==================== TopicAIMember ====================

  describe("findAIMembersByTopicId", () => {
    it("should find AI members ordered by createdAt", async () => {
      mockPrisma.topicAIMember.findMany.mockResolvedValue([]);
      await repo.findAIMembersByTopicId("t1");
      expect(mockPrisma.topicAIMember.findMany).toHaveBeenCalledWith({
        where: { topicId: "t1" },
        orderBy: { createdAt: "asc" },
      });
    });
  });

  describe("createAIMember", () => {
    it("should create AI member", async () => {
      const data = { topicId: "t1", agentName: "AI-测试" } as never;
      mockPrisma.topicAIMember.create.mockResolvedValue({ id: "ai1", ...data });
      await repo.createAIMember(data);
      expect(mockPrisma.topicAIMember.create).toHaveBeenCalledWith({ data });
    });
  });

  describe("createManyAIMembers", () => {
    it("should bulk create AI members", async () => {
      mockPrisma.topicAIMember.createMany.mockResolvedValue({ count: 2 });
      await repo.createManyAIMembers([]);
      expect(mockPrisma.topicAIMember.createMany).toHaveBeenCalled();
    });
  });

  // ==================== TopicMessage ====================

  describe("findMessages", () => {
    it("should delegate params directly to prisma", async () => {
      mockPrisma.topicMessage.findMany.mockResolvedValue([]);
      const params = { where: { topicId: "t1" }, take: 20 };
      await repo.findMessages(params);
      expect(mockPrisma.topicMessage.findMany).toHaveBeenCalledWith(params);
    });
  });

  describe("createMessage", () => {
    it("should create message", async () => {
      const data = { topicId: "t1", content: "消息" } as never;
      mockPrisma.topicMessage.create.mockResolvedValue({ id: "msg1" });
      await repo.createMessage(data);
      expect(mockPrisma.topicMessage.create).toHaveBeenCalledWith({
        data,
        include: undefined,
      });
    });
  });

  describe("softDeleteMessage", () => {
    it("should set deletedAt instead of hard delete", async () => {
      mockPrisma.topicMessage.update.mockResolvedValue({ id: "msg1" });
      await repo.softDeleteMessage("msg1");
      expect(mockPrisma.topicMessage.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "msg1" },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe("countMessages", () => {
    it("should count messages", async () => {
      mockPrisma.topicMessage.count.mockResolvedValue(10);
      const result = await repo.countMessages({ topicId: "t1" } as never);
      expect(result).toBe(10);
    });
  });

  // ==================== getPrismaClient ====================

  describe("getPrismaClient", () => {
    it("should return the prisma service", () => {
      expect(repo.getPrismaClient()).toBe(mockPrisma);
    });
  });
});

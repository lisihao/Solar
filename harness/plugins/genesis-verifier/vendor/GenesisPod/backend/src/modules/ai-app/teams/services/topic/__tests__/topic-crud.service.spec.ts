/**
 * TopicCrudService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, ForbiddenException } from "@nestjs/common";
import { TopicCrudService } from "../topic-crud.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { TopicType, TopicRole } from "@prisma/client";

const mockTopic = {
  id: "topic-1",
  name: "Test Topic",
  description: "A test topic",
  type: TopicType.PRIVATE,
  createdById: "user-1",
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: {
    id: "user-1",
    username: "user1",
    fullName: "User One",
    avatarUrl: null,
  },
  members: [
    {
      id: "membership-1",
      topicId: "topic-1",
      userId: "user-1",
      role: TopicRole.OWNER,
      lastReadAt: null,
      user: {
        id: "user-1",
        username: "user1",
        fullName: "User One",
        avatarUrl: null,
      },
    },
  ],
  aiMembers: [],
  _count: { messages: 5, resources: 2 },
};

const mockMembership = {
  id: "membership-1",
  topicId: "topic-1",
  userId: "user-1",
  role: TopicRole.OWNER,
};

describe("TopicCrudService", () => {
  let service: TopicCrudService;
  let prisma: {
    topic: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    topicMember: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      createMany: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
    };
    topicAIMember: { createMany: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
    missionLog: { deleteMany: jest.Mock };
    agentTask: { deleteMany: jest.Mock };
    teamMission: { deleteMany: jest.Mock };
    topicMessageReaction: { deleteMany: jest.Mock };
    topicMessageMention: { deleteMany: jest.Mock };
    topicMessageAttachment: { deleteMany: jest.Mock };
    topicMessage: { findMany: jest.Mock; deleteMany: jest.Mock };
    topicMessageBookmark: { deleteMany: jest.Mock };
    topicMessageForward: { deleteMany: jest.Mock };
    topicSummary: { deleteMany: jest.Mock };
    topicResource: { deleteMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      topic: {
        create: jest.fn().mockResolvedValue(mockTopic),
        findMany: jest.fn().mockResolvedValue([mockTopic]),
        findUnique: jest.fn().mockResolvedValue(mockTopic),
        update: jest.fn().mockResolvedValue(mockTopic),
        delete: jest.fn().mockResolvedValue(mockTopic),
      },
      topicMember: {
        findUnique: jest.fn().mockResolvedValue(mockMembership),
        findMany: jest.fn().mockResolvedValue([mockMembership]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(mockMembership),
        count: jest.fn().mockResolvedValue(0),
      },
      topicAIMember: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn().mockImplementation(async (fn) => {
        const tx = {
          topic: {
            create: jest.fn().mockResolvedValue({ id: "topic-1" }),
            delete: jest.fn().mockResolvedValue(mockTopic),
          },
          topicMember: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicAIMember: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          missionLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
          agentTask: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
          teamMission: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicMessageReaction: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicMessageMention: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicMessageAttachment: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicMessage: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicMessageBookmark: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicMessageForward: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicSummary: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicResource: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        };
        return fn(tx);
      }),
      missionLog: { deleteMany: jest.fn() },
      agentTask: { deleteMany: jest.fn() },
      teamMission: { deleteMany: jest.fn() },
      topicMessageReaction: { deleteMany: jest.fn() },
      topicMessageMention: { deleteMany: jest.fn() },
      topicMessageAttachment: { deleteMany: jest.fn() },
      topicMessage: { findMany: jest.fn(), deleteMany: jest.fn() },
      topicMessageBookmark: { deleteMany: jest.fn() },
      topicMessageForward: { deleteMany: jest.fn() },
      topicSummary: { deleteMany: jest.fn() },
      topicResource: { deleteMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicCrudService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TopicCrudService>(TopicCrudService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createTopic", () => {
    it("should create a topic and return it", async () => {
      prisma.topic.findUnique.mockResolvedValue(mockTopic);

      const result = await service.createTopic("user-1", {
        name: "Test Topic",
        type: TopicType.PRIVATE,
      });

      expect(result).toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should add member IDs when provided", async () => {
      prisma.topic.findUnique.mockResolvedValue(mockTopic);

      await service.createTopic("user-1", {
        name: "Test Topic",
        type: TopicType.PRIVATE,
        memberIds: ["user-2", "user-3"],
      });

      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe("getTopicById", () => {
    it("should return topic when found and user is member", async () => {
      prisma.topic.findUnique.mockResolvedValue(mockTopic);

      const result = await service.getTopicById("topic-1", "user-1");

      expect(result).toBeDefined();
      expect(result.id).toBe("topic-1");
      expect(result.currentUserRole).toBe(TopicRole.OWNER);
    });

    it("should throw NotFoundException when topic not found", async () => {
      prisma.topic.findUnique.mockResolvedValue(null);

      await expect(
        service.getTopicById("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for PRIVATE topic when user not member", async () => {
      prisma.topic.findUnique.mockResolvedValue({
        ...mockTopic,
        type: TopicType.PRIVATE,
        members: [], // No members
      });

      await expect(
        service.getTopicById("topic-1", "user-nonmember"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should allow access to PUBLIC topic for non-members", async () => {
      prisma.topic.findUnique.mockResolvedValue({
        ...mockTopic,
        type: TopicType.PUBLIC,
        members: [],
      });

      const result = await service.getTopicById("topic-1", "user-nonmember");

      expect(result).toBeDefined();
      expect(result.currentUserRole).toBeUndefined();
    });
  });

  describe("getTopics", () => {
    it("should return list of topics", async () => {
      prisma.topic.findMany.mockResolvedValue([mockTopic]);
      prisma.$queryRaw.mockResolvedValue([]);

      const results = await service.getTopics("user-1");

      expect(Array.isArray(results)).toBe(true);
    });

    it("should filter by type when provided", async () => {
      prisma.topic.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getTopics("user-1", { type: TopicType.PRIVATE });

      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: TopicType.PRIVATE }),
        }),
      );
    });

    it("should use cache on repeated calls without search", async () => {
      prisma.topic.findMany.mockResolvedValue([mockTopic]);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getTopics("user-1");
      await service.getTopics("user-1");

      // Second call should use cache, findMany called only once
      expect(prisma.topic.findMany).toHaveBeenCalledTimes(1);
    });

    it("should bypass cache when search is provided", async () => {
      prisma.topic.findMany.mockResolvedValue([mockTopic]);
      prisma.$queryRaw.mockResolvedValue([]);

      await service.getTopics("user-1", { search: "test" });
      await service.getTopics("user-1", { search: "test" });

      // No cache for search queries
      expect(prisma.topic.findMany).toHaveBeenCalledTimes(2);
    });

    it("should compute unread count based on lastReadAt", async () => {
      const topicWithLastRead = {
        ...mockTopic,
        members: [
          { ...mockTopic.members[0], lastReadAt: new Date("2024-01-01") },
        ],
      };
      prisma.topic.findMany.mockResolvedValue([topicWithLastRead]);
      prisma.$queryRaw.mockResolvedValue([
        { topic_id: "topic-1", unread_count: BigInt(3) },
      ]);

      const results = await service.getTopics("user-1-new");

      expect(results[0]).toHaveProperty("unreadCount");
    });
  });

  describe("updateTopic", () => {
    it("should update topic when user has OWNER role", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(mockMembership);
      prisma.topic.update.mockResolvedValue({ ...mockTopic, name: "Updated" });

      const result = await service.updateTopic("topic-1", "user-1", {
        name: "Updated",
      });

      expect(result).toBeDefined();
    });

    it("should throw ForbiddenException when user is not a member", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTopic("topic-1", "user-nonmember", { name: "Updated" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when user has MEMBER role", async () => {
      prisma.topicMember.findUnique.mockResolvedValue({
        ...mockMembership,
        role: TopicRole.MEMBER,
      });

      await expect(
        service.updateTopic("topic-1", "user-1", { name: "Updated" }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("archiveTopic", () => {
    it("should archive topic when user is OWNER", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(mockMembership);
      prisma.topic.update.mockResolvedValue({
        ...mockTopic,
        type: TopicType.ARCHIVED,
        archivedAt: new Date(),
      });

      await service.archiveTopic("topic-1", "user-1");

      expect(prisma.topic.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: TopicType.ARCHIVED }),
        }),
      );
    });

    it("should throw ForbiddenException when user is not OWNER", async () => {
      prisma.topicMember.findUnique.mockResolvedValue({
        ...mockMembership,
        role: TopicRole.ADMIN,
      });

      await expect(service.archiveTopic("topic-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("deleteTopic", () => {
    it("should delete topic and all related data when user is OWNER", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(mockMembership);

      const result = await service.deleteTopic("topic-1", "user-1");

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw ForbiddenException when user is not OWNER", async () => {
      prisma.topicMember.findUnique.mockResolvedValue({
        ...mockMembership,
        role: TopicRole.MEMBER,
      });

      await expect(service.deleteTopic("topic-1", "user-1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("checkTopicPermission", () => {
    it("should return membership when user has allowed role", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(mockMembership);

      const result = await service.checkTopicPermission("topic-1", "user-1", [
        TopicRole.OWNER,
      ]);

      expect(result).toEqual(mockMembership);
    });

    it("should throw ForbiddenException when user not a member", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(null);

      await expect(
        service.checkTopicPermission("topic-1", "user-x", [TopicRole.OWNER]),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when role not in allowed list", async () => {
      prisma.topicMember.findUnique.mockResolvedValue({
        ...mockMembership,
        role: TopicRole.MEMBER,
      });

      await expect(
        service.checkTopicPermission("topic-1", "user-1", [TopicRole.OWNER]),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("checkTopicMembership", () => {
    it("should return membership when topic and user found", async () => {
      prisma.topic.findUnique.mockResolvedValue({
        ...mockTopic,
        members: [mockMembership],
      });

      const result = await service.checkTopicMembership("topic-1", "user-1");

      expect(result).toEqual(mockMembership);
    });

    it("should throw NotFoundException when topic not found", async () => {
      prisma.topic.findUnique.mockResolvedValue(null);

      await expect(
        service.checkTopicMembership("nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for PRIVATE topic when user not member", async () => {
      prisma.topic.findUnique.mockResolvedValue({
        ...mockTopic,
        type: TopicType.PRIVATE,
        members: [],
      });

      await expect(
        service.checkTopicMembership("topic-1", "user-nonmember"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("clearUserTopicsCache", () => {
    it("should clear cache entries for a specific user", async () => {
      prisma.topic.findMany.mockResolvedValue([mockTopic]);
      prisma.$queryRaw.mockResolvedValue([]);

      // Populate cache
      await service.getTopics("user-cache-test");

      // Clear cache
      service.clearUserTopicsCache("user-cache-test");

      // Should re-fetch from DB
      await service.getTopics("user-cache-test");

      expect(prisma.topic.findMany).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * TopicPublicService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicPublicService } from "../topic-public.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { TopicType, TopicRole } from "@prisma/client";

const mockPublicTopic = {
  id: "topic-1",
  name: "Public Team",
  description: "A public team",
  type: TopicType.PUBLIC,
  archivedAt: null,
  members: [],
  joinRequests: [],
  createdBy: {
    id: "user-1",
    username: "creator",
    fullName: "Creator",
    avatarUrl: null,
  },
  _count: { members: 5, aiMembers: 2, messages: 100 },
};

const mockJoinRequest = {
  id: "req-1",
  topicId: "topic-1",
  userId: "user-2",
  requestMessage: "Want to join",
  status: "PENDING",
  user: {
    id: "user-2",
    email: "user2@example.com",
    username: "user2",
    fullName: "User Two",
    avatarUrl: null,
  },
  topic: { id: "topic-1", name: "Public Team" },
};

const mockAdminMembership = {
  id: "membership-1",
  topicId: "topic-1",
  userId: "admin-1",
  role: TopicRole.ADMIN,
};

describe("TopicPublicService", () => {
  let service: TopicPublicService;
  let prisma: jest.Mocked<PrismaService>;

  const mockPrisma = {
    topic: {
      findUnique: jest.fn().mockResolvedValue(mockPublicTopic),
      findMany: jest.fn().mockResolvedValue([mockPublicTopic]),
    },
    topicMember: {
      findUnique: jest.fn().mockResolvedValue(mockAdminMembership),
      create: jest.fn().mockResolvedValue({ id: "member-1" }),
    },
    topicJoinRequest: {
      create: jest.fn().mockResolvedValue(mockJoinRequest),
      findMany: jest.fn().mockResolvedValue([mockJoinRequest]),
      findUnique: jest.fn().mockResolvedValue({
        ...mockJoinRequest,
        topic: { id: "topic-1", name: "Public Team" },
        user: {
          id: "user-2",
          email: "user2@example.com",
          username: "user2",
          fullName: "User Two",
        },
      }),
      update: jest
        .fn()
        .mockResolvedValue({ ...mockJoinRequest, status: "APPROVED" }),
    },
    $transaction: jest.fn().mockImplementation(async (fn) => {
      return fn({
        topicJoinRequest: {
          update: jest.fn().mockResolvedValue({ status: "APPROVED" }),
        },
        topicMember: {
          create: jest.fn().mockResolvedValue({ id: "member-1" }),
        },
      });
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicPublicService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TopicPublicService>(TopicPublicService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== getPublicTopics ====================

  describe("getPublicTopics", () => {
    it("should return list of public topics", async () => {
      const result = await service.getPublicTopics();

      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: TopicType.PUBLIC }),
        }),
      );
      expect(result.length).toBe(1);
    });

    it("should include member and message counts", async () => {
      const result = await service.getPublicTopics();

      expect(result[0].memberCount).toBe(5);
      expect(result[0].aiMemberCount).toBe(2);
      expect(result[0].messageCount).toBe(100);
    });

    it("should filter by search term", async () => {
      await service.getPublicTopics({ search: "AI", limit: 10 });

      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                name: expect.objectContaining({ contains: "AI" }),
              }),
            ]),
          }),
          take: 10,
        }),
      );
    });

    it("should use default limit of 50 when not specified", async () => {
      await service.getPublicTopics();

      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it("should only return non-archived topics", async () => {
      await service.getPublicTopics();

      expect(prisma.topic.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ archivedAt: null }),
        }),
      );
    });
  });

  // ==================== requestToJoinTopic ====================

  describe("requestToJoinTopic", () => {
    it("should create join request for public topic", async () => {
      await service.requestToJoinTopic("topic-1", "user-2", "Please join");

      expect(prisma.topicJoinRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            userId: "user-2",
            requestMessage: "Please join",
            status: "PENDING",
          }),
        }),
      );
    });

    it("should throw NotFoundException when topic not found", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.requestToJoinTopic("nonexistent", "user-2"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for non-public topic", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce({
        ...mockPublicTopic,
        type: TopicType.PRIVATE,
      });

      await expect(
        service.requestToJoinTopic("topic-1", "user-2"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw BadRequestException when already a member", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce({
        ...mockPublicTopic,
        members: [{ userId: "user-2" }],
      });

      await expect(
        service.requestToJoinTopic("topic-1", "user-2"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when pending request exists", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce({
        ...mockPublicTopic,
        joinRequests: [{ id: "existing-req" }],
      });

      await expect(
        service.requestToJoinTopic("topic-1", "user-2"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== getJoinRequests ====================

  describe("getJoinRequests", () => {
    it("should return pending join requests for admin", async () => {
      const result = await service.getJoinRequests("topic-1", "admin-1");

      expect(prisma.topicJoinRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            topicId: "topic-1",
            status: "PENDING",
          }),
        }),
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it("should throw ForbiddenException for non-admin", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce({
        ...mockAdminMembership,
        role: TopicRole.MEMBER,
      });

      await expect(
        service.getJoinRequests("topic-1", "non-admin"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when not a member", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.getJoinRequests("topic-1", "non-member"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== getMyJoinRequests ====================

  describe("getMyJoinRequests", () => {
    it("should return user own join requests with topic info", async () => {
      await service.getMyJoinRequests("user-2");

      expect(prisma.topicJoinRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-2" },
          include: expect.objectContaining({ topic: expect.any(Object) }),
        }),
      );
    });
  });

  // ==================== reviewJoinRequest ====================

  describe("reviewJoinRequest", () => {
    it("should approve join request and add member", async () => {
      await service.reviewJoinRequest("req-1", "admin-1", true);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should reject join request", async () => {
      await service.reviewJoinRequest(
        "req-1",
        "admin-1",
        false,
        "Not qualified",
      );

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should throw NotFoundException when request not found", async () => {
      mockPrisma.topicJoinRequest.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.reviewJoinRequest("nonexistent", "admin-1", true),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when request already processed", async () => {
      mockPrisma.topicJoinRequest.findUnique.mockResolvedValueOnce({
        ...mockJoinRequest,
        status: "APPROVED",
      });

      await expect(
        service.reviewJoinRequest("req-1", "admin-1", true),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw ForbiddenException for non-admin reviewer", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce({
        ...mockAdminMembership,
        role: TopicRole.MEMBER,
      });

      await expect(
        service.reviewJoinRequest("req-1", "non-admin", true),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== cancelJoinRequest ====================

  describe("cancelJoinRequest", () => {
    it("should cancel own join request", async () => {
      await service.cancelJoinRequest("req-1", "user-2");

      expect(prisma.topicJoinRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "CANCELLED" } }),
      );
    });

    it("should throw NotFoundException when request not found", async () => {
      mockPrisma.topicJoinRequest.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.cancelJoinRequest("nonexistent", "user-2"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when cancelling another user request", async () => {
      mockPrisma.topicJoinRequest.findUnique.mockResolvedValueOnce({
        ...mockJoinRequest,
        userId: "different-user",
      });

      await expect(
        service.cancelJoinRequest("req-1", "user-2"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw BadRequestException when request already processed", async () => {
      mockPrisma.topicJoinRequest.findUnique.mockResolvedValueOnce({
        ...mockJoinRequest,
        status: "APPROVED",
      });

      await expect(
        service.cancelJoinRequest("req-1", "user-2"),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

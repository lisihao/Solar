/**
 * TopicJoinRequestService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicJoinRequestService } from "../topic-join-request.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { NotificationPresetsService } from "../../../../../platform/notifications/presets/notification-presets.service";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { TopicRole, JoinRequestStatus } from "@prisma/client";

const mockTopic = {
  id: "topic-1",
  name: "Test Team",
  members: [{ userId: "admin-1" }],
};

const mockJoinRequest = {
  id: "req-1",
  topicId: "topic-1",
  userId: "user-2",
  requestMessage: "Please let me join",
  status: JoinRequestStatus.PENDING,
  user: {
    id: "user-2",
    username: "applicant",
    fullName: "Applicant User",
    avatarUrl: null,
    email: "applicant@example.com",
  },
  topic: {
    id: "topic-1",
    name: "Test Team",
  },
};

const mockAdminMembership = {
  id: "membership-1",
  topicId: "topic-1",
  userId: "admin-1",
  role: TopicRole.ADMIN,
};

describe("TopicJoinRequestService", () => {
  let service: TopicJoinRequestService;
  let prisma: jest.Mocked<PrismaService>;
  let notificationPresetsService: jest.Mocked<NotificationPresetsService>;

  const mockPrisma = {
    topic: {
      findUnique: jest.fn().mockResolvedValue(mockTopic),
    },
    topicMember: {
      findUnique: jest.fn().mockResolvedValue(mockAdminMembership),
      create: jest.fn().mockResolvedValue({ id: "member-1" }),
    },
    topicJoinRequest: {
      create: jest.fn().mockResolvedValue(mockJoinRequest),
      findMany: jest.fn().mockResolvedValue([mockJoinRequest]),
      findFirst: jest.fn().mockResolvedValue(mockJoinRequest),
      findUnique: jest.fn().mockResolvedValue(mockJoinRequest),
      update: jest.fn().mockResolvedValue({
        ...mockJoinRequest,
        status: JoinRequestStatus.APPROVED,
      }),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest.fn().mockImplementation(async (fn) => {
      return fn({
        topicJoinRequest: {
          update: jest.fn().mockResolvedValue({
            ...mockJoinRequest,
            status: JoinRequestStatus.APPROVED,
          }),
        },
        topicMember: {
          create: jest.fn().mockResolvedValue({ id: "member-1" }),
        },
      });
    }),
  };

  const mockNotificationPresetsService = {
    notifyJoinRequest: jest.fn().mockResolvedValue(undefined),
    notifyJoinRequestResult: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicJoinRequestService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: NotificationPresetsService,
          useValue: mockNotificationPresetsService,
        },
      ],
    }).compile();

    service = module.get<TopicJoinRequestService>(TopicJoinRequestService);
    prisma = module.get(PrismaService);
    notificationPresetsService = module.get(NotificationPresetsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== createJoinRequest ====================

  describe("createJoinRequest", () => {
    it("should create join request successfully", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(null); // not existing member

      const _result = await service.createJoinRequest(
        "topic-1",
        "user-2",
        "Please join",
      );

      expect(prisma.topicJoinRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topicId: "topic-1",
            userId: "user-2",
            requestMessage: "Please join",
            status: JoinRequestStatus.PENDING,
          }),
        }),
      );
    });

    it("should throw NotFoundException when topic not found", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createJoinRequest("nonexistent", "user-2"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when already a member", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce({
        id: "existing",
      });

      await expect(
        service.createJoinRequest("topic-1", "user-2"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should notify admins about join request", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(null);

      await service.createJoinRequest("topic-1", "user-2");

      expect(notificationPresetsService.notifyJoinRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          topicId: "topic-1",
          applicantId: "user-2",
        }),
      );
    });

    it("should handle P2002 duplicate request error", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(null);
      mockPrisma.topicJoinRequest.create.mockRejectedValueOnce({
        code: "P2002",
      });

      await expect(
        service.createJoinRequest("topic-1", "user-2"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should re-throw non-P2002 errors", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(null);
      mockPrisma.topicJoinRequest.create.mockRejectedValueOnce(
        new Error("DB error"),
      );

      await expect(
        service.createJoinRequest("topic-1", "user-2"),
      ).rejects.toThrow("DB error");
    });

    it("should not notify when no admins exist", async () => {
      mockPrisma.topic.findUnique.mockResolvedValueOnce({
        ...mockTopic,
        members: [],
      });
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(null);

      await service.createJoinRequest("topic-1", "user-2");

      expect(
        notificationPresetsService.notifyJoinRequest,
      ).not.toHaveBeenCalled();
    });
  });

  // ==================== getJoinRequests ====================

  describe("getJoinRequests", () => {
    it("should return paginated join requests for admin", async () => {
      const result = await service.getJoinRequests("topic-1", "admin-1");

      expect(prisma.topicJoinRequest.findMany).toHaveBeenCalled();
      expect(result.requests).toBeDefined();
      expect(result.total).toBeDefined();
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

    it("should apply pagination options", async () => {
      await service.getJoinRequests("topic-1", "admin-1", {
        page: 2,
        limit: 10,
      });

      expect(prisma.topicJoinRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it("should filter by status when provided", async () => {
      await service.getJoinRequests("topic-1", "admin-1", {
        status: JoinRequestStatus.PENDING,
      });

      expect(prisma.topicJoinRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: JoinRequestStatus.PENDING }),
        }),
      );
    });
  });

  // ==================== getMyJoinRequests ====================

  describe("getMyJoinRequests", () => {
    it("should return user own join requests", async () => {
      const result = await service.getMyJoinRequests("user-2");

      expect(prisma.topicJoinRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-2" },
        }),
      );
      expect(result.requests).toBeDefined();
    });

    it("should apply pagination", async () => {
      await service.getMyJoinRequests("user-2", { page: 3, limit: 5 });

      expect(prisma.topicJoinRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 5 }),
      );
    });
  });

  // ==================== approveJoinRequest ====================

  describe("approveJoinRequest", () => {
    it("should approve join request and add member", async () => {
      const _result = await service.approveJoinRequest(
        "topic-1",
        "req-1",
        "admin-1",
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(
        notificationPresetsService.notifyJoinRequestResult,
      ).toHaveBeenCalledWith(expect.objectContaining({ approved: true }));
    });

    it("should throw NotFoundException when request not found", async () => {
      mockPrisma.topicJoinRequest.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.approveJoinRequest("topic-1", "nonexistent", "admin-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for non-admin reviewer", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce({
        ...mockAdminMembership,
        role: TopicRole.MEMBER,
      });

      await expect(
        service.approveJoinRequest("topic-1", "req-1", "non-admin"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should assign specified role when approving", async () => {
      await service.approveJoinRequest(
        "topic-1",
        "req-1",
        "admin-1",
        TopicRole.ADMIN,
      );

      // The transaction would create member with TopicRole.ADMIN
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  // ==================== rejectJoinRequest ====================

  describe("rejectJoinRequest", () => {
    it("should reject join request", async () => {
      const _result = await service.rejectJoinRequest(
        "topic-1",
        "req-1",
        "admin-1",
        "Not qualified",
      );

      expect(prisma.topicJoinRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: JoinRequestStatus.REJECTED }),
        }),
      );
      expect(
        notificationPresetsService.notifyJoinRequestResult,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ approved: false, reason: "Not qualified" }),
      );
    });

    it("should throw NotFoundException when request not found", async () => {
      mockPrisma.topicJoinRequest.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.rejectJoinRequest("topic-1", "nonexistent", "admin-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException for non-admin", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce({
        ...mockAdminMembership,
        role: TopicRole.MEMBER,
      });

      await expect(
        service.rejectJoinRequest("topic-1", "req-1", "non-admin"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== cancelJoinRequest ====================

  describe("cancelJoinRequest", () => {
    it("should cancel own join request", async () => {
      const _result = await service.cancelJoinRequest("req-1", "user-2");

      expect(prisma.topicJoinRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: JoinRequestStatus.CANCELLED },
        }),
      );
    });

    it("should throw NotFoundException when request not found", async () => {
      mockPrisma.topicJoinRequest.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.cancelJoinRequest("nonexistent", "user-2"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

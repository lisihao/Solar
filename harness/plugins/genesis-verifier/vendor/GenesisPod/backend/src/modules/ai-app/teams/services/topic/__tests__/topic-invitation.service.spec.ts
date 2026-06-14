/**
 * TopicInvitationService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TopicInvitationService } from "../topic-invitation.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { NotificationPresetsService } from "../../../../../platform/notifications/presets/notification-presets.service";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { TopicRole } from "@prisma/client";

const mockTopic = { id: "topic-1", name: "Test Team" };
const mockInviter = {
  id: "user-1",
  username: "inviter",
  fullName: "Inviter User",
};
const _mockInvitee = { id: "user-2", email: "invitee@example.com" };

const mockInvitationRecord = {
  id: "inv-1",
  topic_id: "topic-1",
  inviter_id: "user-1",
  invitee_id: "user-2",
  invitee_email: "invitee@example.com",
  invite_code: "abc123code456",
  role: "MEMBER",
  message: "Please join",
  status: "PENDING",
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  responded_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockAdminMembership = {
  id: "membership-1",
  topicId: "topic-1",
  userId: "user-1",
  role: TopicRole.ADMIN,
};

describe("TopicInvitationService", () => {
  let service: TopicInvitationService;
  let prisma: jest.Mocked<PrismaService>;
  let notificationPresetsService: jest.Mocked<NotificationPresetsService>;

  const mockPrisma = {
    topic: {
      findUnique: jest.fn().mockResolvedValue(mockTopic),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(mockInviter),
    },
    topicMember: {
      findUnique: jest.fn().mockResolvedValue(mockAdminMembership),
      create: jest.fn().mockResolvedValue({ id: "member-1" }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: "inv-1" }]),
    $transaction: jest.fn().mockImplementation(async (fn) => {
      return fn({
        $queryRaw: jest.fn().mockResolvedValue([]),
        topicMember: {
          create: jest.fn().mockResolvedValue({ id: "member-1" }),
        },
      });
    }),
  };

  const mockNotificationPresetsService = {
    notifyInvitation: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset default mocks
    mockPrisma.topic.findUnique.mockResolvedValue(mockTopic);
    mockPrisma.user.findUnique.mockResolvedValue(mockInviter);
    mockPrisma.topicMember.findUnique.mockResolvedValue(mockAdminMembership);
    mockPrisma.topicMember.create.mockResolvedValue({ id: "member-1" });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: "inv-1" }]);
    mockPrisma.$transaction.mockImplementation(async (fn) => {
      return fn({
        $queryRaw: jest.fn().mockResolvedValue([]),
        topicMember: {
          create: jest.fn().mockResolvedValue({ id: "member-1" }),
        },
      });
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicInvitationService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: NotificationPresetsService,
          useValue: mockNotificationPresetsService,
        },
      ],
    }).compile();

    service = module.get<TopicInvitationService>(TopicInvitationService);
    prisma = module.get(PrismaService);
    notificationPresetsService = module.get(NotificationPresetsService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== createInvitation ====================

  describe("createInvitation", () => {
    it("should create invitation with invitee ID", async () => {
      mockPrisma.topicMember.findUnique
        .mockResolvedValueOnce(mockAdminMembership) // admin check
        .mockResolvedValueOnce(null); // existing membership check

      const result = await service.createInvitation("topic-1", "user-1", {
        inviteeId: "user-2",
        role: TopicRole.MEMBER,
      });

      expect(result.invitationId).toBe("inv-1");
      expect(result.inviteCode).toBeDefined();
      expect(result.inviteLink).toContain("/invitations/");
    });

    it("should throw NotFoundException when topic not found", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(
        mockAdminMembership,
      );
      mockPrisma.topic.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createInvitation("nonexistent", "user-1", {
          inviteeId: "user-2",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user is not admin", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce({
        ...mockAdminMembership,
        role: TopicRole.MEMBER,
      });

      await expect(
        service.createInvitation("topic-1", "user-1", { inviteeId: "user-2" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when user is not a member", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.createInvitation("topic-1", "user-1", { inviteeId: "user-2" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw BadRequestException when invitee is already a member", async () => {
      mockPrisma.topicMember.findUnique
        .mockResolvedValueOnce(mockAdminMembership) // admin check
        .mockResolvedValueOnce({ id: "existing-member" }); // existing membership

      await expect(
        service.createInvitation("topic-1", "user-1", { inviteeId: "user-2" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should look up user by email when inviteeEmail provided", async () => {
      mockPrisma.topicMember.findUnique
        .mockResolvedValueOnce(mockAdminMembership)
        .mockResolvedValueOnce(null); // no existing membership
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(mockInviter) // inviter
        .mockResolvedValueOnce({ id: "user-from-email" }); // found by email

      const result = await service.createInvitation("topic-1", "user-1", {
        inviteeEmail: "invitee@example.com",
      });

      expect(result.inviteCode).toBeDefined();
    });

    it("should notify invitee when they are a registered user", async () => {
      mockPrisma.topicMember.findUnique
        .mockResolvedValueOnce(mockAdminMembership)
        .mockResolvedValueOnce(null);

      await service.createInvitation("topic-1", "user-1", {
        inviteeId: "user-2",
      });

      expect(notificationPresetsService.notifyInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-2",
          topicId: "topic-1",
        }),
      );
    });

    it("should handle P2002 duplicate invitation error", async () => {
      mockPrisma.topicMember.findUnique
        .mockResolvedValueOnce(mockAdminMembership)
        .mockResolvedValueOnce(null);
      mockPrisma.$queryRaw.mockRejectedValueOnce({ code: "P2002" });

      await expect(
        service.createInvitation("topic-1", "user-1", { inviteeId: "user-2" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should re-throw non-P2002 errors", async () => {
      mockPrisma.topicMember.findUnique
        .mockResolvedValueOnce(mockAdminMembership)
        .mockResolvedValueOnce(null);
      mockPrisma.$queryRaw.mockRejectedValueOnce(
        new Error("DB connection failed"),
      );

      await expect(
        service.createInvitation("topic-1", "user-1", { inviteeId: "user-2" }),
      ).rejects.toThrow("DB connection failed");
    });
  });

  // ==================== getInvitationByCode ====================

  describe("getInvitationByCode", () => {
    it("should return invitation details for valid code", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([mockInvitationRecord]);

      const result = await service.getInvitationByCode("abc123code456");

      expect(result.id).toBe("inv-1");
      expect(result.topicId).toBe("topic-1");
    });

    it("should throw NotFoundException for unknown invite code", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.getInvitationByCode("invalid-code")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException for expired invitation", async () => {
      const expiredRecord = {
        ...mockInvitationRecord,
        expires_at: new Date(Date.now() - 1000),
      };
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([expiredRecord])
        .mockResolvedValueOnce([]); // update to EXPIRED

      await expect(
        service.getInvitationByCode("abc123code456"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for already-processed invitation", async () => {
      const acceptedRecord = { ...mockInvitationRecord, status: "ACCEPTED" };
      mockPrisma.$queryRaw.mockResolvedValueOnce([acceptedRecord]);

      await expect(
        service.getInvitationByCode("abc123code456"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== acceptInvitation ====================

  describe("acceptInvitation", () => {
    beforeEach(() => {
      // Setup default getInvitationByCode mock
      mockPrisma.$queryRaw.mockResolvedValueOnce([mockInvitationRecord]);
      mockPrisma.topic.findUnique.mockResolvedValue(mockTopic);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
      });
    });

    it("should accept invitation and add member", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(null); // not existing member

      const _result = await service.acceptInvitation("abc123code456", "user-2");

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should throw BadRequestException when already a member", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce({
        id: "existing-member",
      });

      await expect(
        service.acceptInvitation("abc123code456", "user-2"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw ForbiddenException when invitation is for different user", async () => {
      const specificUserInvitation = {
        ...mockInvitationRecord,
        invitee_id: "user-99",
        invitee_email: null,
      };
      // Override the $queryRaw for this test
      mockPrisma.$queryRaw.mockReset();
      mockPrisma.$queryRaw.mockResolvedValueOnce([specificUserInvitation]);
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user-3",
        email: "other@example.com",
      });

      await expect(
        service.acceptInvitation("abc123code456", "user-3"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== declineInvitation ====================

  describe("declineInvitation", () => {
    it("should decline invitation successfully", async () => {
      // getInvitationByCode calls: 1) query invitation, 2) query topic, 3) query inviter
      // then decline update
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([mockInvitationRecord]) // invitation lookup
        .mockResolvedValueOnce([]); // decline update

      const result = await service.declineInvitation("abc123code456", "user-2");

      expect(result.success).toBe(true);
    });

    it("should throw ForbiddenException when invitation is for different user", async () => {
      const specificUserInvitation = {
        ...mockInvitationRecord,
        invitee_id: "user-99",
        invitee_email: null,
      };
      mockPrisma.$queryRaw.mockResolvedValueOnce([specificUserInvitation]); // invitation lookup
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(mockInviter) // inviter lookup in getInvitationByCode
        .mockResolvedValueOnce({ id: "user-3", email: "other@example.com" }); // user email check

      await expect(
        service.declineInvitation("abc123code456", "user-3"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ==================== cancelInvitation ====================

  describe("cancelInvitation", () => {
    it("should cancel invitation successfully", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(
        mockAdminMembership,
      );
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: "inv-1" }]);

      const result = await service.cancelInvitation(
        "topic-1",
        "inv-1",
        "user-1",
      );

      expect(result.success).toBe(true);
    });

    it("should throw NotFoundException when invitation not found or already processed", async () => {
      mockPrisma.topicMember.findUnique.mockResolvedValueOnce(
        mockAdminMembership,
      );
      mockPrisma.$queryRaw.mockResolvedValueOnce([]); // empty result

      await expect(
        service.cancelInvitation("topic-1", "inv-1", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== cleanupExpiredInvitations ====================

  describe("cleanupExpiredInvitations", () => {
    it("should return count of expired invitations", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(5) }]);

      const result = await service.cleanupExpiredInvitations();

      expect(result).toBe(5);
    });

    it("should return 0 when no expired invitations", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: BigInt(0) }]);

      const result = await service.cleanupExpiredInvitations();

      expect(result).toBe(0);
    });

    it("should handle empty result", async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.cleanupExpiredInvitations();

      expect(result).toBe(0);
    });
  });
});

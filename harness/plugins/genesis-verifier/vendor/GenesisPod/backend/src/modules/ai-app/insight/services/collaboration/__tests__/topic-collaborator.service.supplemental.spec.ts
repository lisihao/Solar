/**
 * TopicCollaboratorService - Supplemental Coverage Tests
 *
 * Targets uncovered lines:
 * - addCollaborator: existing INACTIVE collaborator reactivation
 * - removeCollaborator: not found throws NotFoundException
 * - hasAccess: PUBLIC topic with EDITOR role required returns false, PRIVATE returns false
 * - hasAccess: SHARED with collaborator and requiredRole checking hierarchy
 * - requestToJoin: topic is PRIVATE throws ForbiddenException, existing PENDING throws
 * - reviewApplication: reject flow with notification
 * - getMyApplicationStatus: no collaborator returns null status
 * - getPendingApplications: returns list
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { TopicCollaboratorService } from "../topic-collaborator.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { NotificationService } from "@/modules/platform/notifications/notification.service";
import { CollaboratorRole } from "../../../dto/collaborator.dto";

const mockPrisma = {
  researchTopic: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  topicCollaborator: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

const mockNotificationService = {
  createNotification: jest.fn(),
};

const baseTopic = {
  id: "topic-1",
  userId: "user-1",
  name: "AI Research Topic",
  visibility: "SHARED",
};

const baseCollaborator = {
  id: "collab-1",
  userId: "user-2",
  topicId: "topic-1",
  role: "VIEWER",
  status: "ACCEPTED",
  invitedAt: new Date(),
  requestedAt: null,
  acceptedAt: new Date(),
  reviewedAt: new Date(),
  rejectReason: null,
  isActive: true,
  invitedById: "user-1",
  user: {
    id: "user-2",
    email: "user2@example.com",
    username: "user2",
    avatarUrl: null,
  },
};

describe("TopicCollaboratorService - Supplemental", () => {
  let service: TopicCollaboratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicCollaboratorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<TopicCollaboratorService>(TopicCollaboratorService);
    jest.clearAllMocks();
  });

  // ─── addCollaborator ───

  describe("addCollaborator", () => {
    it("should reactivate existing INACTIVE collaborator", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-2",
        email: "user2@example.com",
        username: "user2",
        avatarUrl: null,
      });
      // Existing collaborator that was previously deactivated
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        ...baseCollaborator,
        isActive: false,
        status: "ACCEPTED",
      });
      mockPrisma.topicCollaborator.update.mockResolvedValue(baseCollaborator);

      const result = await service.addCollaborator(
        "topic-1",
        "user-1",
        "user2@example.com",
        CollaboratorRole.EDITOR,
      );

      expect(result.userId).toBe("user-2");
      expect(mockPrisma.topicCollaborator.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: baseCollaborator.id },
          data: expect.objectContaining({ isActive: true, status: "ACCEPTED" }),
        }),
      );
    });

    it("should reactivate previously-rejected collaborator", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-2",
        email: "user2@example.com",
        username: "user2",
        avatarUrl: null,
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        ...baseCollaborator,
        status: "REJECTED",
        isActive: false,
      });
      mockPrisma.topicCollaborator.update.mockResolvedValue(baseCollaborator);

      await service.addCollaborator("topic-1", "user-1", "user2@example.com");

      expect(mockPrisma.topicCollaborator.update).toHaveBeenCalled();
    });
  });

  // ─── removeCollaborator ───

  describe("removeCollaborator", () => {
    it("should throw NotFoundException when collaborator not found", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.topicCollaborator.findFirst.mockResolvedValue(null);

      await expect(
        service.removeCollaborator("topic-1", "collab-nonexistent", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when user has no permission", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.removeCollaborator("topic-1", "collab-1", "user-3"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── hasAccess ───

  describe("hasAccess", () => {
    it("should return false when topic not found", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      const result = await service.hasAccess("nonexistent", "user-1");
      expect(result).toBe(false);
    });

    it("should return true for owner", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        collaborators: [],
      });

      const result = await service.hasAccess("topic-1", "user-1");
      expect(result).toBe(true);
    });

    it("should return true for PUBLIC topic with no requiredRole", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        userId: "owner",
        visibility: "PUBLIC",
        collaborators: [],
      });

      const result = await service.hasAccess("topic-1", "other-user");
      expect(result).toBe(true);
    });

    it("should return false for PUBLIC topic when EDITOR role required", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        userId: "owner",
        visibility: "PUBLIC",
        collaborators: [],
      });

      const result = await service.hasAccess(
        "topic-1",
        "other-user",
        CollaboratorRole.EDITOR,
      );
      expect(result).toBe(false);
    });

    it("should return false for PRIVATE topic for non-owner", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        userId: "owner",
        visibility: "PRIVATE",
        collaborators: [],
      });

      const result = await service.hasAccess("topic-1", "other-user");
      expect(result).toBe(false);
    });

    it("should return false for SHARED topic when user is not a collaborator", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        userId: "owner",
        visibility: "SHARED",
        collaborators: [], // no collaborators
      });

      const result = await service.hasAccess("topic-1", "other-user");
      expect(result).toBe(false);
    });

    it("should return true for SHARED topic when collaborator with sufficient role", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        userId: "owner",
        visibility: "SHARED",
        collaborators: [{ role: "ADMIN" }],
      });

      const result = await service.hasAccess(
        "topic-1",
        "collab-user",
        CollaboratorRole.EDITOR,
      );
      expect(result).toBe(true);
    });

    it("should return false for SHARED topic when collaborator role is insufficient", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        userId: "owner",
        visibility: "SHARED",
        collaborators: [{ role: "VIEWER" }],
      });

      const result = await service.hasAccess(
        "topic-1",
        "collab-user",
        CollaboratorRole.EDITOR,
      );
      expect(result).toBe(false);
    });

    it("should return true for SHARED topic when no requiredRole and collaborator exists", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        userId: "owner",
        visibility: "SHARED",
        collaborators: [{ role: "VIEWER" }],
      });

      const result = await service.hasAccess("topic-1", "collab-user");
      expect(result).toBe(true);
    });
  });

  // ─── requestToJoin ───

  describe("requestToJoin", () => {
    it("should throw ForbiddenException for PRIVATE topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "owner",
        visibility: "PRIVATE",
        name: "Private Topic",
      });

      await expect(service.requestToJoin("topic-1", "user-2")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("should throw BadRequestException when joining own topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "user-2",
        visibility: "PUBLIC",
        name: "Public Topic",
      });

      await expect(service.requestToJoin("topic-1", "user-2")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when already a collaborator (ACCEPTED)", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "owner",
        visibility: "PUBLIC",
        name: "Public Topic",
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        isActive: true,
        status: "ACCEPTED",
      });

      await expect(service.requestToJoin("topic-1", "user-2")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException when application is already PENDING", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "owner",
        visibility: "PUBLIC",
        name: "Public Topic",
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        isActive: true,
        status: "PENDING",
      });

      await expect(service.requestToJoin("topic-1", "user-2")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should send notification and handle failure gracefully", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        userId: "owner",
        visibility: "PUBLIC",
        name: "Public Topic",
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(null);
      mockPrisma.topicCollaborator.upsert.mockResolvedValue({
        ...baseCollaborator,
        status: "PENDING",
        user: {
          ...baseCollaborator.user,
          username: null,
          email: "user@test.com",
        },
      });
      mockNotificationService.createNotification.mockRejectedValue(
        new Error("Notification failed"),
      );

      const result = await service.requestToJoin("topic-1", "user-2");

      expect(result.status).toBe("PENDING");
    });
  });

  // ─── reviewApplication ───

  describe("reviewApplication", () => {
    it("should reject application and send rejection notification", async () => {
      // canManageCollaborators
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);

      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        ...baseCollaborator,
        topicId: "topic-1",
        status: "PENDING",
        userId: "user-2",
      });

      const updatedCollaborator = {
        ...baseCollaborator,
        status: "REJECTED",
        rejectReason: "Not relevant",
      };
      mockPrisma.topicCollaborator.update.mockResolvedValue(
        updatedCollaborator,
      );

      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        name: "My Topic",
      });
      mockNotificationService.createNotification.mockResolvedValue(undefined);

      const result = await service.reviewApplication(
        "topic-1",
        "collab-1",
        "user-1",
        "REJECTED",
        "Not relevant",
      );

      expect(result.status).toBe("REJECTED");
      expect(mockNotificationService.createNotification).toHaveBeenCalled();
    });

    it("should accept application and send approval notification", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);

      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        ...baseCollaborator,
        topicId: "topic-1",
        status: "PENDING",
        userId: "user-2",
      });

      mockPrisma.topicCollaborator.update.mockResolvedValue({
        ...baseCollaborator,
        status: "ACCEPTED",
      });

      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        name: "My Topic",
      });
      mockNotificationService.createNotification.mockResolvedValue(undefined);

      const result = await service.reviewApplication(
        "topic-1",
        "collab-1",
        "user-1",
        "ACCEPTED",
      );

      expect(result.status).toBe("ACCEPTED");
    });

    it("should throw BadRequestException when application already processed", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        ...baseCollaborator,
        topicId: "topic-1",
        status: "ACCEPTED", // already processed
        userId: "user-2",
      });
      mockPrisma.researchTopic.findUnique.mockResolvedValue({ name: "Topic" });

      await expect(
        service.reviewApplication("topic-1", "collab-1", "user-1", "ACCEPTED"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when application not found", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(null);
      mockPrisma.researchTopic.findUnique.mockResolvedValue({ name: "Topic" });

      await expect(
        service.reviewApplication(
          "topic-1",
          "collab-nonexistent",
          "user-1",
          "ACCEPTED",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when reviewer lacks permission", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null); // canManageCollaborators fails

      await expect(
        service.reviewApplication("topic-1", "collab-1", "user-3", "ACCEPTED"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should handle notification failure gracefully in accept", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        ...baseCollaborator,
        topicId: "topic-1",
        status: "PENDING",
        userId: "user-2",
      });
      mockPrisma.topicCollaborator.update.mockResolvedValue({
        ...baseCollaborator,
        status: "ACCEPTED",
      });
      mockPrisma.researchTopic.findUnique.mockResolvedValue({ name: "Topic" });
      mockNotificationService.createNotification.mockRejectedValue(
        new Error("Notification failed"),
      );

      // Should not throw even if notification fails
      const result = await service.reviewApplication(
        "topic-1",
        "collab-1",
        "user-1",
        "ACCEPTED",
      );
      expect(result.status).toBe("ACCEPTED");
    });
  });

  // ─── getMyApplicationStatus ───

  describe("getMyApplicationStatus", () => {
    it("should return null status when no collaborator record found", async () => {
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(null);

      const result = await service.getMyApplicationStatus("topic-1", "user-2");

      expect(result.status).toBeNull();
    });

    it("should return null status when collaborator is inactive", async () => {
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        status: "ACCEPTED",
        isActive: false,
        requestedAt: null,
        rejectReason: null,
      });

      const result = await service.getMyApplicationStatus("topic-1", "user-2");

      expect(result.status).toBeNull();
    });

    it("should return PENDING status with requestedAt", async () => {
      const requestedAt = new Date();
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        status: "PENDING",
        isActive: true,
        requestedAt,
        rejectReason: null,
      });

      const result = await service.getMyApplicationStatus("topic-1", "user-2");

      expect(result.status).toBe("PENDING");
      expect(result.requestedAt).toEqual(requestedAt);
    });

    it("should return REJECTED status with rejectReason", async () => {
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        status: "REJECTED",
        isActive: true,
        requestedAt: null,
        rejectReason: "Not eligible",
      });

      const result = await service.getMyApplicationStatus("topic-1", "user-2");

      expect(result.status).toBe("REJECTED");
      expect(result.rejectReason).toBe("Not eligible");
    });
  });

  // ─── getPendingApplications ───

  describe("getPendingApplications", () => {
    it("should return pending applications list", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.topicCollaborator.findMany.mockResolvedValue([
        { ...baseCollaborator, status: "PENDING" },
      ]);

      const result = await service.getPendingApplications("topic-1", "user-1");

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("PENDING");
    });

    it("should throw ForbiddenException when user cannot manage collaborators", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.getPendingApplications("topic-1", "unauthorized-user"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── updateCollaboratorRole ───

  describe("updateCollaboratorRole", () => {
    it("should throw NotFoundException when collaborator not found", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);
      mockPrisma.topicCollaborator.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCollaboratorRole(
          "topic-1",
          "nonexistent",
          "user-1",
          CollaboratorRole.EDITOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

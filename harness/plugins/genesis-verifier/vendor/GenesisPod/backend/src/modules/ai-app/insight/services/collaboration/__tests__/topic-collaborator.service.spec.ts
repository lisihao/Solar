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

const baseTopic = {
  id: "topic-1",
  userId: "user-1",
  name: "AI Research Topic",
  visibility: "SHARED",
  user: {
    id: "user-1",
    email: "owner@example.com",
    username: "owner",
    avatarUrl: null,
  },
  collaborators: [baseCollaborator],
};

describe("TopicCollaboratorService", () => {
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

  describe("getCollaborators", () => {
    it("should return collaborators for authorized user", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);

      const result = await service.getCollaborators("topic-1", "user-1");

      expect(result.topicId).toBe("topic-1");
      expect(result.collaborators).toHaveLength(1);
      expect(result.totalCount).toBe(1);
      expect(result.owner.id).toBe("user-1");
    });

    it("should throw NotFoundException when topic not found or no access", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.getCollaborators("bad-topic", "user-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should map collaborator DTO correctly", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(baseTopic);

      const result = await service.getCollaborators("topic-1", "user-1");

      expect(result.collaborators[0]).toMatchObject({
        id: "collab-1",
        userId: "user-2",
        email: "user2@example.com",
        role: "VIEWER",
        status: "ACCEPTED",
        isActive: true,
      });
    });
  });

  describe("addCollaborator", () => {
    it("should create a new collaborator when inviting a valid user", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-3",
        email: "user3@example.com",
        username: "user3",
        avatarUrl: null,
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(null);
      mockPrisma.topicCollaborator.create.mockResolvedValue({
        ...baseCollaborator,
        userId: "user-3",
        user: {
          id: "user-3",
          email: "user3@example.com",
          username: "user3",
          avatarUrl: null,
        },
      });

      const result = await service.addCollaborator(
        "topic-1",
        "user-1",
        "user3@example.com",
        CollaboratorRole.VIEWER,
      );

      expect(result.email).toBe("user3@example.com");
      expect(mockPrisma.topicCollaborator.create).toHaveBeenCalledTimes(1);
    });

    it("should throw ForbiddenException when inviter is not owner/admin", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.addCollaborator("topic-1", "user-x", "user3@example.com"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when invited user does not exist", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addCollaborator("topic-1", "user-1", "nonexistent@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when adding the owner as collaborator", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "owner@example.com",
        username: "owner",
        avatarUrl: null,
      });

      await expect(
        service.addCollaborator("topic-1", "user-1", "owner@example.com"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when user is already an active collaborator", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        id: "user-2",
        email: "user2@example.com",
        username: "user2",
        avatarUrl: null,
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        id: "collab-1",
        isActive: true,
        status: "ACCEPTED",
      });

      await expect(
        service.addCollaborator("topic-1", "user-1", "user2@example.com"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateCollaboratorRole", () => {
    it("should update role successfully", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.topicCollaborator.findFirst.mockResolvedValue({
        ...baseCollaborator,
        user: baseCollaborator.user,
      });
      mockPrisma.topicCollaborator.update.mockResolvedValue({
        ...baseCollaborator,
        role: "EDITOR",
        user: baseCollaborator.user,
      });

      const result = await service.updateCollaboratorRole(
        "topic-1",
        "collab-1",
        "user-1",
        CollaboratorRole.EDITOR,
      );

      expect(result.role).toBe("EDITOR");
    });

    it("should throw ForbiddenException when user lacks permission", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCollaboratorRole(
          "topic-1",
          "collab-1",
          "user-x",
          CollaboratorRole.ADMIN,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException when collaborator not found", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.topicCollaborator.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCollaboratorRole(
          "topic-1",
          "bad-id",
          "user-1",
          CollaboratorRole.VIEWER,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("removeCollaborator", () => {
    it("should soft-delete collaborator", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.topicCollaborator.findFirst.mockResolvedValue(
        baseCollaborator,
      );
      mockPrisma.topicCollaborator.update.mockResolvedValue({
        ...baseCollaborator,
        isActive: false,
      });

      await service.removeCollaborator("topic-1", "collab-1", "user-1");

      expect(mockPrisma.topicCollaborator.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false },
        }),
      );
    });

    it("should throw ForbiddenException for unauthorized user", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.removeCollaborator("topic-1", "collab-1", "intruder"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("leaveProject", () => {
    it("should deactivate user's collaborator record", async () => {
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(
        baseCollaborator,
      );
      mockPrisma.topicCollaborator.update.mockResolvedValue({
        ...baseCollaborator,
        isActive: false,
      });

      await service.leaveProject("topic-1", "user-2");

      expect(mockPrisma.topicCollaborator.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it("should throw NotFoundException if user is not a collaborator", async () => {
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(null);

      await expect(service.leaveProject("topic-1", "user-x")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("hasAccess", () => {
    it("should return true for topic owner", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        ...baseTopic,
        collaborators: [],
      });

      const result = await service.hasAccess("topic-1", "user-1");

      expect(result).toBe(true);
    });

    it("should return true for PUBLIC topic without required role", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-owner",
        visibility: "PUBLIC",
        collaborators: [],
      });

      const result = await service.hasAccess("topic-1", "user-2");

      expect(result).toBe(true);
    });

    it("should return false for PRIVATE topic for non-owner", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-owner",
        visibility: "PRIVATE",
        collaborators: [],
      });

      const result = await service.hasAccess("topic-1", "user-2");

      expect(result).toBe(false);
    });

    it("should return false when topic not found", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      const result = await service.hasAccess("bad-topic", "user-1");

      expect(result).toBe(false);
    });
  });

  describe("requestToJoin", () => {
    it("should create PENDING application for SHARED topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        userId: "owner",
        visibility: "SHARED",
        name: "Test Topic",
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(null);
      mockPrisma.topicCollaborator.upsert.mockResolvedValue({
        ...baseCollaborator,
        status: "PENDING",
        user: baseCollaborator.user,
      });
      mockNotificationService.createNotification.mockResolvedValue({});

      const result = await service.requestToJoin("topic-1", "user-2");

      expect(result.status).toBe("PENDING");
      expect(mockPrisma.topicCollaborator.upsert).toHaveBeenCalledTimes(1);
    });

    it("should throw ForbiddenException for PRIVATE topic", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
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
        id: "topic-1",
        userId: "user-1",
        visibility: "SHARED",
        name: "My Topic",
      });

      await expect(service.requestToJoin("topic-1", "user-1")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should not block when notification fails", async () => {
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        id: "topic-1",
        userId: "owner",
        visibility: "PUBLIC",
        name: "Public Topic",
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(null);
      mockPrisma.topicCollaborator.upsert.mockResolvedValue({
        ...baseCollaborator,
        status: "PENDING",
        user: baseCollaborator.user,
      });
      mockNotificationService.createNotification.mockRejectedValue(
        new Error("Notification failed"),
      );

      const result = await service.requestToJoin("topic-1", "user-2");

      expect(result.status).toBe("PENDING");
    });
  });

  describe("reviewApplication", () => {
    it("should accept pending application and send notification", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValueOnce({
        id: "app-1",
        topicId: "topic-1",
        userId: "user-2",
        status: "PENDING",
      });
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        name: "AI Research",
      });
      mockPrisma.topicCollaborator.update.mockResolvedValue({
        ...baseCollaborator,
        status: "ACCEPTED",
        user: baseCollaborator.user,
      });
      mockNotificationService.createNotification.mockResolvedValue({});

      const result = await service.reviewApplication(
        "topic-1",
        "app-1",
        "user-1",
        "ACCEPTED",
      );

      expect(result.status).toBe("ACCEPTED");
      expect(mockNotificationService.createNotification).toHaveBeenCalledTimes(
        1,
      );
    });

    it("should reject application with reason", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue({
        id: "topic-1",
        userId: "user-1",
      });
      mockPrisma.topicCollaborator.findUnique.mockResolvedValueOnce({
        id: "app-1",
        topicId: "topic-1",
        userId: "user-2",
        status: "PENDING",
      });
      mockPrisma.researchTopic.findUnique.mockResolvedValue({
        name: "AI Research",
      });
      mockPrisma.topicCollaborator.update.mockResolvedValue({
        ...baseCollaborator,
        status: "REJECTED",
        rejectReason: "Not relevant",
        user: baseCollaborator.user,
      });
      mockNotificationService.createNotification.mockResolvedValue({});

      const result = await service.reviewApplication(
        "topic-1",
        "app-1",
        "user-1",
        "REJECTED",
        "Not relevant",
      );

      expect(result.status).toBe("REJECTED");
    });

    it("should throw ForbiddenException for non-admin reviewer", async () => {
      mockPrisma.researchTopic.findFirst.mockResolvedValue(null);

      await expect(
        service.reviewApplication("topic-1", "app-1", "outsider", "ACCEPTED"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("getMyApplicationStatus", () => {
    it("should return null status when no record found", async () => {
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue(null);

      const result = await service.getMyApplicationStatus("topic-1", "user-1");

      expect(result.status).toBeNull();
    });

    it("should return PENDING status when application is in review", async () => {
      mockPrisma.topicCollaborator.findUnique.mockResolvedValue({
        status: "PENDING",
        isActive: true,
        requestedAt: new Date(),
        rejectReason: null,
      });

      const result = await service.getMyApplicationStatus("topic-1", "user-1");

      expect(result.status).toBe("PENDING");
    });
  });
});

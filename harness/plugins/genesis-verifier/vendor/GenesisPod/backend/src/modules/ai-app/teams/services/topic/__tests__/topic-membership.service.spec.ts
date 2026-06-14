/**
 * TopicMembershipService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { TopicMembershipService } from "../topic-membership.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";
import { TopicRole } from "@prisma/client";

const mockOwnerMembership = {
  id: "mem-owner",
  topicId: "topic-1",
  userId: "user-owner",
  role: TopicRole.OWNER,
};

const mockAdminMembership = {
  id: "mem-admin",
  topicId: "topic-1",
  userId: "user-admin",
  role: TopicRole.ADMIN,
};

const mockRegularMembership = {
  id: "mem-user",
  topicId: "topic-1",
  userId: "user-regular",
  role: TopicRole.MEMBER,
};

const mockUser = {
  id: "user-new",
  username: "newuser",
  fullName: "New User",
  email: "new@example.com",
  avatarUrl: null,
};

const mockAIMember = {
  id: "ai-member-1",
  topicId: "topic-1",
  aiModel: "gemini-pro",
  displayName: "AI Assistant",
  addedById: "user-owner",
};

describe("TopicMembershipService", () => {
  let service: TopicMembershipService;
  let prisma: {
    topicMember: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
      updateMany: jest.Mock;
    };
    topicAIMember: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    topic: { delete: jest.Mock };
    agentTask: { deleteMany: jest.Mock };
    teamMission: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      topicMember: {
        findUnique: jest.fn().mockResolvedValue(mockOwnerMembership),
        findFirst: jest.fn().mockResolvedValue(mockRegularMembership),
        create: jest.fn().mockResolvedValue({
          ...mockRegularMembership,
          user: mockUser,
        }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        update: jest.fn().mockResolvedValue({
          ...mockRegularMembership,
          user: mockUser,
        }),
        delete: jest.fn().mockResolvedValue(mockRegularMembership),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      topicAIMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(mockAIMember),
        create: jest.fn().mockResolvedValue(mockAIMember),
        update: jest.fn().mockResolvedValue(mockAIMember),
        delete: jest.fn().mockResolvedValue(mockAIMember),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(mockUser),
      },
      topic: {
        delete: jest.fn().mockResolvedValue({ id: "topic-1" }),
      },
      agentTask: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      teamMission: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn().mockImplementation(async (fn) => {
        return fn({
          agentTask: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
          teamMission: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          topicAIMember: { delete: jest.fn().mockResolvedValue(mockAIMember) },
        });
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TopicMembershipService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TopicMembershipService>(TopicMembershipService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("addMember", () => {
    it("should add a new member when requester is OWNER", async () => {
      prisma.topicMember.findUnique
        .mockResolvedValueOnce(mockOwnerMembership) // permission check
        .mockResolvedValueOnce(null); // existing check

      const result = await service.addMember("topic-1", "user-owner", {
        userId: "user-new",
        role: TopicRole.MEMBER,
      });

      expect(result).toBeDefined();
      expect(prisma.topicMember.create).toHaveBeenCalled();
    });

    it("should throw NotFoundException when target user not found", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addMember("topic-1", "user-owner", { userId: "ghost-user" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when user is already a member", async () => {
      prisma.topicMember.findUnique
        .mockResolvedValueOnce(mockOwnerMembership) // permission check
        .mockResolvedValueOnce(mockRegularMembership); // existing check - already member

      await expect(
        service.addMember("topic-1", "user-owner", { userId: "user-regular" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw ForbiddenException when requester lacks permission", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(
        mockRegularMembership,
      );

      await expect(
        service.addMember("topic-1", "user-regular", { userId: "user-new" }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("addMemberByEmail", () => {
    it("should add member by email when requester is ADMIN", async () => {
      prisma.topicMember.findUnique
        .mockResolvedValueOnce(mockAdminMembership) // permission check
        .mockResolvedValueOnce(null); // existing check
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.addMemberByEmail(
        "topic-1",
        "user-admin",
        "new@example.com",
      );

      expect(result).toBeDefined();
      expect(prisma.topicMember.create).toHaveBeenCalled();
    });

    it("should throw NotFoundException when email not found", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockAdminMembership);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addMemberByEmail("topic-1", "user-admin", "ghost@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when user already a member", async () => {
      prisma.topicMember.findUnique
        .mockResolvedValueOnce(mockAdminMembership) // permission check
        .mockResolvedValueOnce(mockRegularMembership); // already member

      await expect(
        service.addMemberByEmail(
          "topic-1",
          "user-admin",
          "existing@example.com",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("addMembers", () => {
    it("should bulk add members", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(mockOwnerMembership);

      const result = await service.addMembers("topic-1", "user-owner", {
        userIds: ["user-a", "user-b"],
      });

      expect(result).toEqual({ added: 2 });
      expect(prisma.topicMember.createMany).toHaveBeenCalled();
    });
  });

  describe("updateMember", () => {
    it("should update member role when requester is OWNER", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicMember.findFirst.mockResolvedValue({
        ...mockRegularMembership,
        role: TopicRole.MEMBER,
      });

      await service.updateMember("topic-1", "user-owner", "user-regular", {
        role: TopicRole.ADMIN,
      });

      expect(prisma.topicMember.update).toHaveBeenCalled();
    });

    it("should throw NotFoundException when target member not found", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicMember.findFirst.mockResolvedValue(null);

      await expect(
        service.updateMember("topic-1", "user-owner", "nonexistent", {
          role: TopicRole.ADMIN,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when ADMIN tries to modify OWNER", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockAdminMembership);
      prisma.topicMember.findFirst.mockResolvedValue(mockOwnerMembership);

      await expect(
        service.updateMember("topic-1", "user-admin", "user-owner", {
          role: TopicRole.MEMBER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException when ADMIN tries to promote to OWNER", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockAdminMembership);
      prisma.topicMember.findFirst.mockResolvedValue(mockRegularMembership);

      await expect(
        service.updateMember("topic-1", "user-admin", "user-regular", {
          role: TopicRole.OWNER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("removeMember", () => {
    it("should remove member when requester has permission", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicMember.findFirst.mockResolvedValue(mockRegularMembership);

      await service.removeMember("topic-1", "user-owner", "user-regular");

      expect(prisma.topicMember.delete).toHaveBeenCalled();
    });

    it("should throw NotFoundException when target member not found", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicMember.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember("topic-1", "user-owner", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException when trying to remove OWNER", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockAdminMembership);
      prisma.topicMember.findFirst.mockResolvedValue(mockOwnerMembership);

      await expect(
        service.removeMember("topic-1", "user-admin", "user-owner"),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("leaveTopic", () => {
    it("should allow non-owner to leave", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(mockRegularMembership);

      await service.leaveTopic("topic-1", "user-regular");

      expect(prisma.topicMember.delete).toHaveBeenCalled();
    });

    it("should throw NotFoundException when not a member", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(null);

      await expect(
        service.leaveTopic("topic-1", "user-nonmember"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when owner tries to leave with other members", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(mockOwnerMembership);
      prisma.topicMember.count.mockResolvedValue(3);

      await expect(service.leaveTopic("topic-1", "user-owner")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should delete topic when owner is the last member", async () => {
      prisma.topicMember.findUnique.mockResolvedValue(mockOwnerMembership);
      prisma.topicMember.count.mockResolvedValue(0);

      await service.leaveTopic("topic-1", "user-owner");

      expect(prisma.topic.delete).toHaveBeenCalledWith({
        where: { id: "topic-1" },
      });
    });
  });

  describe("addAIMember", () => {
    it("should create AI member when not already existing", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findUnique.mockResolvedValue(null);

      const result = await service.addAIMember("topic-1", "user-owner", {
        aiModel: "gemini-pro",
        displayName: "New AI",
      });

      expect(result).toBeDefined();
      expect(prisma.topicAIMember.create).toHaveBeenCalled();
    });

    it("should throw BadRequestException when AI member already exists", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findUnique.mockResolvedValue(mockAIMember);

      await expect(
        service.addAIMember("topic-1", "user-owner", {
          aiModel: "gemini-pro",
          displayName: "AI Assistant",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("updateAIMember", () => {
    it("should update AI member", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findFirst.mockResolvedValue(mockAIMember);

      await service.updateAIMember("topic-1", "user-owner", "ai-member-1", {
        displayName: "Updated AI",
      });

      expect(prisma.topicAIMember.update).toHaveBeenCalled();
    });

    it("should throw NotFoundException when AI member not found", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAIMember("topic-1", "user-owner", "nonexistent", {
          displayName: "Updated",
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("removeAIMember", () => {
    it("should remove AI member in transaction", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findFirst.mockResolvedValue(mockAIMember);

      await service.removeAIMember("topic-1", "user-owner", "ai-member-1");

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it("should throw NotFoundException when AI member not found", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findFirst.mockResolvedValue(null);

      await expect(
        service.removeAIMember("topic-1", "user-owner", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateAIMemberTeamRole", () => {
    it("should update AI member team role", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findFirst.mockResolvedValue(mockAIMember);

      await service.updateAIMemberTeamRole(
        "topic-1",
        "user-owner",
        "ai-member-1",
        {
          isLeader: true,
        },
      );

      expect(prisma.topicAIMember.update).toHaveBeenCalled();
    });

    it("should demote other leaders when setting a new leader", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findFirst.mockResolvedValue(mockAIMember);

      await service.updateAIMemberTeamRole(
        "topic-1",
        "user-owner",
        "ai-member-1",
        {
          isLeader: true,
        },
      );

      expect(prisma.topicAIMember.updateMany).toHaveBeenCalledWith({
        where: {
          topicId: "topic-1",
          isLeader: true,
          id: { not: "ai-member-1" },
        },
        data: { isLeader: false },
      });
    });

    it("should not call updateMany when isLeader is not true", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findFirst.mockResolvedValue(mockAIMember);

      await service.updateAIMemberTeamRole(
        "topic-1",
        "user-owner",
        "ai-member-1",
        {
          isLeader: false,
        },
      );

      expect(prisma.topicAIMember.updateMany).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when AI member not found", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.findFirst.mockResolvedValue(null);

      await expect(
        service.updateAIMemberTeamRole(
          "topic-1",
          "user-owner",
          "nonexistent",
          {},
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("setupDebateAIs", () => {
    it("should create red and blue AI members", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.create
        .mockResolvedValueOnce({
          id: "red-ai",
          displayName: "红方",
          aiModel: "gemini-pro",
        })
        .mockResolvedValueOnce({
          id: "blue-ai",
          displayName: "蓝方",
          aiModel: "gpt-4",
        });

      const result = await service.setupDebateAIs(
        "topic-1",
        "user-owner",
        "gemini-pro",
        "gpt-4",
        "AI vs Human",
      );

      expect(result).toHaveProperty("redAI");
      expect(result).toHaveProperty("blueAI");
      expect(result.redAI.displayName).toBe("红方");
      expect(result.blueAI.displayName).toBe("蓝方");
      expect(prisma.topicAIMember.create).toHaveBeenCalledTimes(2);
    });

    it("should include debate topic in prompts when provided", async () => {
      prisma.topicMember.findUnique.mockResolvedValueOnce(mockOwnerMembership);
      prisma.topicAIMember.create
        .mockResolvedValueOnce({
          id: "red-ai",
          displayName: "红方",
          aiModel: "gpt-4",
        })
        .mockResolvedValueOnce({
          id: "blue-ai",
          displayName: "蓝方",
          aiModel: "gpt-4",
        });

      await service.setupDebateAIs(
        "topic-1",
        "user-owner",
        "gpt-4",
        "gpt-4",
        "AI is better than humans",
      );

      const createCall = prisma.topicAIMember.create.mock.calls[0][0];
      expect(createCall.data.systemPrompt).toContain(
        "AI is better than humans",
      );
    });
  });
});

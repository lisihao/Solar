// Mock the ai-engine facade before any imports to avoid pulling in
// @nestjs/cache-manager / ioredis that are not installed in the test env.
// The paths below match what Node sees with rootDir=src in jest.config.js.
jest.mock("../../../ai-harness/facade/ai.facade", () => {
  return {
    AIFacade: class MockAIFacade {},
  };
});
jest.mock("../../../ai-harness/facade", () => {
  return {
    ChatFacade: class MockChatFacade {},
    TaskProfile: {},
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { AITeamsAdminService } from "../ai-teams-admin.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "../../../ai-harness/facade";
import { AITeamTemplateStatus } from "@prisma/client";

describe("AITeamsAdminService", () => {
  let service: AITeamsAdminService;
  let mockPrisma: {
    aITeamTemplate: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    aITeamMemberTemplate: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let mockAiFacade: {
    getDefaultTextModel: jest.Mock;
    chat: jest.Mock;
  };

  const buildTeam = (
    id: string,
    isSystem = false,
    status = AITeamTemplateStatus.ACTIVE,
  ) => ({
    id,
    name: `team_${id}`,
    displayName: `Team ${id}`,
    description: "Test team",
    icon: null,
    color: null,
    category: "research",
    status,
    isSystem,
    sortOrder: 0,
    workflowConfig: null,
    constraintProfile: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    members: [],
  });

  const buildMember = (id: string, teamId: string, sortOrder = 0) => ({
    id,
    teamId,
    name: `member_${id}`,
    displayName: `Member ${id}`,
    avatar: null,
    roleId: "researcher",
    isLeader: false,
    sortOrder,
    capabilities: [],
    mcpTools: [],
    workStyle: null,
    expertiseAreas: [],
    systemPrompt: null,
    roleDescription: null,
    personality: null,
    defaultModel: null,
    minCount: 1,
    maxCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    mockPrisma = {
      aITeamTemplate: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      aITeamMemberTemplate: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest
        .fn()
        .mockImplementation((ops: unknown[]) => Promise.all(ops)),
    };

    mockAiFacade = {
      getDefaultTextModel: jest.fn(),
      chat: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AITeamsAdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ChatFacade, useValue: mockAiFacade },
      ],
    }).compile();

    service = module.get<AITeamsAdminService>(AITeamsAdminService);

    jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ==================== createTeam ====================

  describe("createTeam", () => {
    it("should create a team and return it with members", async () => {
      // Arrange
      const team = buildTeam("t1");
      mockPrisma.aITeamTemplate.create.mockResolvedValue(team);

      // Act
      const result = await service.createTeam({
        name: "team_t1",
        displayName: "Team t1",
      });

      // Assert
      expect(result).toEqual(team);
      expect(mockPrisma.aITeamTemplate.create).toHaveBeenCalled();
    });

    it("should pass members to create when provided", async () => {
      // Arrange
      const team = { ...buildTeam("t2"), members: [buildMember("m1", "t2")] };
      mockPrisma.aITeamTemplate.create.mockResolvedValue(team);

      // Act
      await service.createTeam({
        name: "team_t2",
        displayName: "Team T2",
        members: [
          {
            name: "researcher",
            displayName: "Researcher",
            roleId: "researcher",
          },
        ],
      });

      // Assert
      const createCall = mockPrisma.aITeamTemplate.create.mock.calls[0][0];
      expect(createCall.data.members.create).toHaveLength(1);
    });

    it("should assign auto sortOrder=0 to the first member when sortOrder not provided", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.create.mockResolvedValue(buildTeam("t3"));

      // Act
      await service.createTeam({
        name: "t3",
        displayName: "T3",
        members: [
          { name: "m1", displayName: "M1", roleId: "r1" },
          { name: "m2", displayName: "M2", roleId: "r2" },
        ],
      });

      // Assert
      const createCall = mockPrisma.aITeamTemplate.create.mock.calls[0][0];
      const createdMembers = createCall.data.members.create;
      expect(createdMembers[0].sortOrder).toBe(0);
      expect(createdMembers[1].sortOrder).toBe(1);
    });

    it("should not include members key in create data when members is undefined", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.create.mockResolvedValue(buildTeam("t4"));

      // Act
      await service.createTeam({ name: "t4", displayName: "T4" });

      // Assert
      const createCall = mockPrisma.aITeamTemplate.create.mock.calls[0][0];
      expect(createCall.data.members).toBeUndefined();
    });
  });

  // ==================== getAllTeams ====================

  describe("getAllTeams", () => {
    it("should return all teams with total count", async () => {
      // Arrange
      const teams = [buildTeam("t1"), buildTeam("t2")];
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue(teams);

      // Act
      const result = await service.getAllTeams();

      // Assert
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should apply status filter when provided", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      // Act
      await service.getAllTeams({ status: AITeamTemplateStatus.ACTIVE });

      // Assert
      const findManyCall = mockPrisma.aITeamTemplate.findMany.mock.calls[0][0];
      expect(findManyCall.where.status).toBe(AITeamTemplateStatus.ACTIVE);
    });

    it("should apply category filter when provided", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      // Act
      await service.getAllTeams({ category: "research" });

      // Assert
      const findManyCall = mockPrisma.aITeamTemplate.findMany.mock.calls[0][0];
      expect(findManyCall.where.category).toBe("research");
    });

    it("should not include members when includeMembers=false", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      // Act
      await service.getAllTeams({ includeMembers: false });

      // Assert
      const findManyCall = mockPrisma.aITeamTemplate.findMany.mock.calls[0][0];
      expect(findManyCall.include).toBeUndefined();
    });

    it("should return empty items and total=0 when no teams exist", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getAllTeams();

      // Assert
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ==================== getTeamById ====================

  describe("getTeamById", () => {
    it("should return the team when found", async () => {
      // Arrange
      const team = buildTeam("t1");
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(team);

      // Act
      const result = await service.getTeamById("t1");

      // Assert
      expect(result).toEqual(team);
    });

    it("should throw NotFoundException when team does not exist", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getTeamById("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== updateTeam ====================

  describe("updateTeam", () => {
    it("should update and return the team", async () => {
      // Arrange
      const existing = buildTeam("t1", false);
      const updated = { ...existing, displayName: "Updated" };
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(existing);
      mockPrisma.aITeamTemplate.update.mockResolvedValue(updated);

      // Act
      const result = await service.updateTeam("t1", {
        displayName: "Updated",
      });

      // Assert
      expect(result.displayName).toBe("Updated");
    });

    it("should throw NotFoundException when team does not exist", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateTeam("ghost", { displayName: "X" }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException when unsetting isSystem flag on system team", async () => {
      // Arrange
      const systemTeam = buildTeam("t1", true); // isSystem=true
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(systemTeam);

      // Act & Assert
      await expect(
        service.updateTeam("t1", { isSystem: false }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== deleteTeam ====================

  describe("deleteTeam", () => {
    it("should delete a non-system team successfully", async () => {
      // Arrange
      const team = buildTeam("t1", false);
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(team);
      mockPrisma.aITeamTemplate.delete.mockResolvedValue(team);

      // Act
      const result = await service.deleteTeam("t1");

      // Assert
      expect(result.success).toBe(true);
      expect(mockPrisma.aITeamTemplate.delete).toHaveBeenCalledWith({
        where: { id: "t1" },
      });
    });

    it("should throw NotFoundException for non-existent team", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.deleteTeam("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException when trying to delete a system team", async () => {
      // Arrange
      const systemTeam = buildTeam("t1", true);
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(systemTeam);

      // Act & Assert
      await expect(service.deleteTeam("t1")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ==================== addMember ====================

  describe("addMember", () => {
    it("should add a member to an existing team", async () => {
      // Arrange
      const team = { ...buildTeam("t1"), members: [] };
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(team);
      const member = buildMember("m1", "t1");
      mockPrisma.aITeamMemberTemplate.create.mockResolvedValue(member);

      // Act
      const result = await service.addMember("t1", {
        name: "researcher",
        displayName: "Researcher",
        roleId: "researcher",
      });

      // Assert
      expect(result).toEqual(member);
    });

    it("should throw NotFoundException when team does not exist", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.addMember("ghost", {
          name: "m",
          displayName: "M",
          roleId: "r",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should auto-assign sortOrder = maxExistingSortOrder + 1", async () => {
      // Arrange
      const team = {
        ...buildTeam("t1"),
        members: [buildMember("m1", "t1", 0), buildMember("m2", "t1", 1)],
      };
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(team);
      mockPrisma.aITeamMemberTemplate.create.mockResolvedValue(
        buildMember("m3", "t1", 2),
      );

      // Act
      await service.addMember("t1", {
        name: "new",
        displayName: "New",
        roleId: "r",
      });

      // Assert: sortOrder = maxSortOrder+1 = 1+1 = 2
      const createCall =
        mockPrisma.aITeamMemberTemplate.create.mock.calls[0][0];
      expect(createCall.data.sortOrder).toBe(2);
    });
  });

  // ==================== updateMember ====================

  describe("updateMember", () => {
    it("should update an existing member", async () => {
      // Arrange
      const existing = buildMember("m1", "t1");
      const updated = { ...existing, displayName: "Updated Member" };
      mockPrisma.aITeamMemberTemplate.findUnique.mockResolvedValue(existing);
      mockPrisma.aITeamMemberTemplate.update.mockResolvedValue(updated);

      // Act
      const result = await service.updateMember("m1", {
        displayName: "Updated Member",
      });

      // Assert
      expect(result.displayName).toBe("Updated Member");
    });

    it("should throw NotFoundException when member does not exist", async () => {
      // Arrange
      mockPrisma.aITeamMemberTemplate.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.updateMember("ghost", { displayName: "X" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== deleteMember ====================

  describe("deleteMember", () => {
    it("should delete an existing member successfully", async () => {
      // Arrange
      mockPrisma.aITeamMemberTemplate.findUnique.mockResolvedValue(
        buildMember("m1", "t1"),
      );
      mockPrisma.aITeamMemberTemplate.delete.mockResolvedValue({});

      // Act
      const result = await service.deleteMember("m1");

      // Assert
      expect(result.success).toBe(true);
    });

    it("should throw NotFoundException when member does not exist", async () => {
      // Arrange
      mockPrisma.aITeamMemberTemplate.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.deleteMember("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ==================== getAvailableTools ====================

  describe("getAvailableTools", () => {
    it("should return built-in tools list with id, name, description", async () => {
      // Act
      const result = await service.getAvailableTools();

      // Assert
      expect(result.builtIn).toBeDefined();
      expect(Array.isArray(result.builtIn)).toBe(true);
      expect(result.builtIn.length).toBeGreaterThan(0);
      const first = result.builtIn[0];
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("description");
    });
  });

  // ==================== getActiveTeamTemplates ====================

  describe("getActiveTeamTemplates", () => {
    it("should return only ACTIVE teams", async () => {
      // Arrange
      const activeTeams = [buildTeam("t1"), buildTeam("t2")];
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue(activeTeams);

      // Act
      const result = await service.getActiveTeamTemplates();

      // Assert
      expect(result).toHaveLength(2);
      const findManyCall = mockPrisma.aITeamTemplate.findMany.mock.calls[0][0];
      expect(findManyCall.where.status).toBe(AITeamTemplateStatus.ACTIVE);
    });

    it("should apply category filter when provided", async () => {
      // Arrange
      mockPrisma.aITeamTemplate.findMany.mockResolvedValue([]);

      // Act
      await service.getActiveTeamTemplates("debate");

      // Assert
      const findManyCall = mockPrisma.aITeamTemplate.findMany.mock.calls[0][0];
      expect(findManyCall.where.category).toBe("debate");
    });
  });
});

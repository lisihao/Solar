// Mock the ai-engine facade before any imports to avoid pulling in
// @nestjs/cache-manager / ioredis that are not installed in the test env.
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
// Mock @prisma/client to provide PrismaClient (extended by PrismaService)
// and AITeamTemplateStatus enum used in tests.
jest.mock("@prisma/client", () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
    $queryRaw = jest.fn();
    $executeRaw = jest.fn();
    $transaction = jest.fn();
  }
  return {
    PrismaClient: MockPrismaClient,
    AITeamTemplateStatus: {
      ACTIVE: "ACTIVE",
      INACTIVE: "INACTIVE",
      DRAFT: "DRAFT",
    },
    Prisma: {
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
        sql: strings.join("?"),
        values,
      }),
      empty: { sql: "", values: [] },
    },
  };
});

import { Test, TestingModule } from "@nestjs/testing";
import { Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { AITeamsAdminService } from "../ai-teams-admin.service";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { ChatFacade } from "../../../ai-harness/facade";
import { AITeamTemplateStatus } from "@prisma/client";

describe("AITeamsAdminService (supplemental)", () => {
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

  beforeAll(async () => {
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

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== reorderMembers (lines 244-267) ====================

  describe("reorderMembers", () => {
    it("should update sortOrder for each member in order", async () => {
      const team = buildTeam("t1");
      mockPrisma.aITeamTemplate.findUnique
        .mockResolvedValueOnce(team) // reorderMembers check
        .mockResolvedValueOnce({ ...team, members: [] }); // getTeamById
      mockPrisma.aITeamMemberTemplate.update.mockResolvedValue(
        buildMember("m1", "t1"),
      );

      await service.reorderMembers("t1", ["m1", "m2", "m3"]);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // Verify 3 update calls were prepared
      const transactionArg = mockPrisma.$transaction.mock.calls[0][0];
      expect(transactionArg).toHaveLength(3);
    });

    it("should assign sortOrder index 0 to first member", async () => {
      const team = buildTeam("t1");
      mockPrisma.aITeamTemplate.findUnique
        .mockResolvedValueOnce(team)
        .mockResolvedValueOnce({ ...team, members: [] });
      mockPrisma.aITeamMemberTemplate.update.mockResolvedValue(
        buildMember("m1", "t1"),
      );

      await service.reorderMembers("t1", ["m1", "m2"]);

      // First update call should have sortOrder 0
      const firstUpdateCall =
        mockPrisma.aITeamMemberTemplate.update.mock.calls[0][0];
      expect(firstUpdateCall.data.sortOrder).toBe(0);
      // Second update call should have sortOrder 1
      const secondUpdateCall =
        mockPrisma.aITeamMemberTemplate.update.mock.calls[1][0];
      expect(secondUpdateCall.data.sortOrder).toBe(1);
    });

    it("should throw NotFoundException when team not found", async () => {
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(null);

      await expect(service.reorderMembers("ghost", ["m1"])).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should call getTeamById after reordering to return updated team", async () => {
      const team = { ...buildTeam("t1"), members: [buildMember("m1", "t1")] };
      mockPrisma.aITeamTemplate.findUnique
        .mockResolvedValueOnce(team) // initial existence check
        .mockResolvedValueOnce(team); // getTeamById call
      mockPrisma.aITeamMemberTemplate.update.mockResolvedValue(
        buildMember("m1", "t1"),
      );

      const result = await service.reorderMembers("t1", ["m1"]);

      // Should return the team from getTeamById
      expect(result).toBeDefined();
      // findUnique called twice: once for reorderMembers check, once for getTeamById
      expect(mockPrisma.aITeamTemplate.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // ==================== getTeamTemplateById (lines 292-308) ====================

  describe("getTeamTemplateById", () => {
    it("should return an active team template by ID", async () => {
      const team = buildTeam("t1", false, AITeamTemplateStatus.ACTIVE);
      mockPrisma.aITeamTemplate.findFirst.mockResolvedValue(team);

      const result = await service.getTeamTemplateById("t1");

      expect(result).toEqual(team);
      expect(mockPrisma.aITeamTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "t1",
            status: AITeamTemplateStatus.ACTIVE,
          },
        }),
      );
    });

    it("should throw NotFoundException when no active team found", async () => {
      mockPrisma.aITeamTemplate.findFirst.mockResolvedValue(null);

      await expect(service.getTeamTemplateById("ghost")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should include members sorted by sortOrder", async () => {
      const team = buildTeam("t1");
      mockPrisma.aITeamTemplate.findFirst.mockResolvedValue(team);

      await service.getTeamTemplateById("t1");

      const call = mockPrisma.aITeamTemplate.findFirst.mock.calls[0][0];
      expect(call.include?.members?.orderBy?.sortOrder).toBe("asc");
    });
  });

  // ==================== getAvailableSkills (lines 341-375) ====================

  describe("getAvailableSkills", () => {
    it("should return skills organized by category", async () => {
      const result = await service.getAvailableSkills();

      expect(result.research).toBeDefined();
      expect(result.analysis).toBeDefined();
      expect(result.content).toBeDefined();
      expect(result.technical).toBeDefined();
      expect(result.collaboration).toBeDefined();
    });

    it("should return skill arrays with id and name", async () => {
      const result = await service.getAvailableSkills();

      expect(Array.isArray(result.research)).toBe(true);
      const firstSkill = result.research[0];
      expect(firstSkill).toHaveProperty("id");
      expect(firstSkill).toHaveProperty("name");
    });

    it("should return non-empty skill lists for all categories", async () => {
      const result = await service.getAvailableSkills();

      expect(result.research.length).toBeGreaterThan(0);
      expect(result.analysis.length).toBeGreaterThan(0);
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.technical.length).toBeGreaterThan(0);
      expect(result.collaboration.length).toBeGreaterThan(0);
    });
  });

  // ==================== getBuiltInRoles (lines 377-395) ====================

  describe("getBuiltInRoles", () => {
    it("should return leaders and members role categories", async () => {
      const result = await service.getBuiltInRoles();

      expect(result.leaders).toBeDefined();
      expect(result.members).toBeDefined();
    });

    it("should return role objects with id, name, description", async () => {
      const result = await service.getBuiltInRoles();

      const leader = result.leaders[0];
      expect(leader).toHaveProperty("id");
      expect(leader).toHaveProperty("name");
      expect(leader).toHaveProperty("description");

      const member = result.members[0];
      expect(member).toHaveProperty("id");
      expect(member).toHaveProperty("name");
      expect(member).toHaveProperty("description");
    });
  });

  // ==================== getWorkStyles (lines 397-413) ====================

  describe("getWorkStyles", () => {
    it("should return a list of work styles", async () => {
      const result = await service.getWorkStyles();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return work style objects with id, name, description", async () => {
      const result = await service.getWorkStyles();

      const first = result[0];
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("description");
    });

    it("should include AUTONOMOUS work style", async () => {
      const result = await service.getWorkStyles();

      const ids = result.map((ws) => ws.id);
      expect(ids).toContain("AUTONOMOUS");
    });
  });

  // ==================== generateTeamConfig (lines 423-565) ====================

  describe("generateTeamConfig", () => {
    const validMembersJson = JSON.stringify({
      members: [
        {
          name: "researcher",
          displayName: "研究员",
          avatar: "—",
          roleId: "researcher",
          isLeader: false,
          roleDescription: "执行研究任务",
          personality: "—",
          workStyle: "AUTONOMOUS",
          capabilities: ["WEB_SEARCH"],
          expertiseAreas: ["research-planning"],
          systemPrompt: "You are a researcher.",
        },
      ],
    });

    it("should generate team config using AI and return parsed members", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue({
        modelId: "gpt-4o",
        displayName: "GPT-4o",
      });
      mockAiFacade.chat.mockResolvedValue({ content: validMembersJson });

      const result = await service.generateTeamConfig({
        teamName: "Research Team",
        teamDescription: "AI research team",
        category: "research",
      });

      expect(result.members).toHaveLength(1);
      expect(result.members[0].name).toBe("researcher");
    });

    it("should handle JSON wrapped in markdown code blocks", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue({
        modelId: "gpt-4o",
        displayName: "GPT-4o",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "```json\n" + validMembersJson + "\n```",
      });

      const result = await service.generateTeamConfig({
        teamName: "Test Team",
      });

      expect(result.members).toBeDefined();
      expect(Array.isArray(result.members)).toBe(true);
    });

    it("should throw BadRequestException when no AI model available", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue(null);

      await expect(
        service.generateTeamConfig({ teamName: "Test" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when AI returns invalid JSON", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue({
        modelId: "gpt-4o",
        displayName: "GPT-4o",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: "This is not JSON at all",
      });

      await expect(
        service.generateTeamConfig({ teamName: "Test" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when AI returns JSON without members array", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue({
        modelId: "gpt-4o",
        displayName: "GPT-4o",
      });
      mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({ config: "no members here" }),
      });

      await expect(
        service.generateTeamConfig({ teamName: "Test" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle extracting JSON from mixed content via regex", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue({
        modelId: "gpt-4o",
        displayName: "GPT-4o",
      });
      mockAiFacade.chat.mockResolvedValue({
        content:
          "Here is your team:\n" + validMembersJson + "\nHope this helps!",
      });

      const result = await service.generateTeamConfig({
        teamName: "Team",
      });

      expect(result.members).toBeDefined();
    });

    it("should throw BadRequestException when chat throws", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue({
        modelId: "gpt-4o",
        displayName: "GPT-4o",
      });
      mockAiFacade.chat.mockRejectedValue(new Error("LLM error"));

      await expect(
        service.generateTeamConfig({ teamName: "Test" }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should work without teamDescription and category", async () => {
      mockAiFacade.getDefaultTextModel.mockResolvedValue({
        modelId: "gpt-4o",
        displayName: "GPT-4o",
      });
      mockAiFacade.chat.mockResolvedValue({ content: validMembersJson });

      const result = await service.generateTeamConfig({
        teamName: "Simple Team",
      });

      expect(result.members).toBeDefined();
    });
  });

  // ==================== updateTeam with JSON fields ====================

  describe("updateTeam with JSON config fields", () => {
    it("should include workflowConfig in update when provided", async () => {
      const existing = buildTeam("t1", false);
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(existing);
      mockPrisma.aITeamTemplate.update.mockResolvedValue(existing);

      const workflowConfig = { type: "sequential", steps: [] };
      await service.updateTeam("t1", { workflowConfig });

      const updateCall = mockPrisma.aITeamTemplate.update.mock.calls[0][0];
      expect(updateCall.data.workflowConfig).toEqual(workflowConfig);
    });

    it("should include constraintProfile in update when provided", async () => {
      const existing = buildTeam("t1", false);
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(existing);
      mockPrisma.aITeamTemplate.update.mockResolvedValue(existing);

      const constraintProfile = { maxRounds: 5 };
      await service.updateTeam("t1", { constraintProfile });

      const updateCall = mockPrisma.aITeamTemplate.update.mock.calls[0][0];
      expect(updateCall.data.constraintProfile).toEqual(constraintProfile);
    });

    it("should include metadata in update when provided", async () => {
      const existing = buildTeam("t1", false);
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(existing);
      mockPrisma.aITeamTemplate.update.mockResolvedValue(existing);

      const metadata = { tags: ["ai", "research"] };
      await service.updateTeam("t1", { metadata });

      const updateCall = mockPrisma.aITeamTemplate.update.mock.calls[0][0];
      expect(updateCall.data.metadata).toEqual(metadata);
    });

    it("should not include workflowConfig in update when undefined", async () => {
      const existing = buildTeam("t1", false);
      mockPrisma.aITeamTemplate.findUnique.mockResolvedValue(existing);
      mockPrisma.aITeamTemplate.update.mockResolvedValue(existing);

      await service.updateTeam("t1", { displayName: "Updated" });

      const updateCall = mockPrisma.aITeamTemplate.update.mock.calls[0][0];
      expect(updateCall.data.workflowConfig).toBeUndefined();
    });
  });
});

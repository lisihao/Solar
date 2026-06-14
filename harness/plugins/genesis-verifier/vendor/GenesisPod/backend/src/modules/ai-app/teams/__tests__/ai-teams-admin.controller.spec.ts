// Mock the ai-engine facade before any imports to avoid pulling in heavy deps
jest.mock("../../../ai-harness/facade/ai.facade", () => ({
  AIFacade: class MockAIFacade {},
}));
jest.mock("../../../ai-harness/facade", () => ({
  ChatFacade: class MockChatFacade {},
}));

import { Test, TestingModule } from "@nestjs/testing";
import {
  AITeamsAdminController,
  AITeamsTemplatesController,
} from "../controllers/ai-teams-admin.controller";
import { AITeamsAdminService } from "../ai-teams-admin.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { AITeamTemplateStatus } from "@prisma/client";
import {
  CreateTeamDto,
  UpdateTeamDto,
  CreateTeamMemberDto,
  UpdateTeamMemberDto,
  ReorderMembersDto,
} from "../dto/ai-team.dto";

jest.mock("../ai-teams-admin.service");

describe("AITeamsAdminController", () => {
  let controller: AITeamsAdminController;
  let service: jest.Mocked<AITeamsAdminService>;

  const mockTeam = {
    id: "team-1",
    name: "research_team",
    displayName: "Research Team",
    description: "Research team",
    icon: null,
    color: null,
    category: "research",
    status: AITeamTemplateStatus.ACTIVE,
    isSystem: false,
    sortOrder: 0,
    members: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMember = {
    id: "member-1",
    teamId: "team-1",
    name: "researcher",
    displayName: "Researcher",
    roleId: "researcher",
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockService = {
    createTeam: jest.fn(),
    getAllTeams: jest.fn(),
    getAvailableTools: jest.fn(),
    getAvailableSkills: jest.fn(),
    getBuiltInRoles: jest.fn(),
    getWorkStyles: jest.fn(),
    generateTeamConfig: jest.fn(),
    getTeamById: jest.fn(),
    updateTeam: jest.fn(),
    deleteTeam: jest.fn(),
    addMember: jest.fn(),
    reorderMembers: jest.fn(),
    updateMember: jest.fn(),
    deleteMember: jest.fn(),
    getActiveTeamTemplates: jest.fn(),
    getTeamTemplateById: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AITeamsAdminController],
      providers: [{ provide: AITeamsAdminService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AITeamsAdminController);
    service = module.get(AITeamsAdminService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createTeam", () => {
    it("should call service.createTeam and return result", async () => {
      const dto: CreateTeamDto = {
        name: "research_team",
        displayName: "Research Team",
      };
      mockService.createTeam.mockResolvedValue(mockTeam);

      const result = await controller.createTeam(dto);

      expect(service.createTeam).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockTeam);
    });

    it("should propagate errors from service", async () => {
      mockService.createTeam.mockRejectedValue(new Error("Create failed"));

      await expect(
        controller.createTeam({ name: "x", displayName: "X" }),
      ).rejects.toThrow("Create failed");
    });
  });

  describe("getAllTeams", () => {
    it("should return all teams with no query params", async () => {
      const response = { items: [mockTeam], total: 1 };
      mockService.getAllTeams.mockResolvedValue(response);

      const result = await controller.getAllTeams();

      expect(service.getAllTeams).toHaveBeenCalledWith(
        expect.objectContaining({ includeMembers: true }),
      );
      expect(result).toEqual(response);
    });

    it("should pass status filter when provided", async () => {
      mockService.getAllTeams.mockResolvedValue({ items: [], total: 0 });

      await controller.getAllTeams(AITeamTemplateStatus.ACTIVE);

      const call = mockService.getAllTeams.mock.calls[0][0];
      expect(call.status).toBe(AITeamTemplateStatus.ACTIVE);
    });

    it("should pass category filter when provided", async () => {
      mockService.getAllTeams.mockResolvedValue({ items: [], total: 0 });

      await controller.getAllTeams(undefined, "research");

      const call = mockService.getAllTeams.mock.calls[0][0];
      expect(call.category).toBe("research");
    });

    it('should set includeMembers=false when includeMembers="false"', async () => {
      mockService.getAllTeams.mockResolvedValue({ items: [], total: 0 });

      await controller.getAllTeams(undefined, undefined, "false");

      const call = mockService.getAllTeams.mock.calls[0][0];
      expect(call.includeMembers).toBe(false);
    });

    it('should set includeMembers=true when includeMembers is not "false"', async () => {
      mockService.getAllTeams.mockResolvedValue({ items: [], total: 0 });

      await controller.getAllTeams(undefined, undefined, "true");

      const call = mockService.getAllTeams.mock.calls[0][0];
      expect(call.includeMembers).toBe(true);
    });
  });

  describe("getAvailableTools", () => {
    it("should return available tools from service", async () => {
      const tools = {
        builtIn: [
          { id: "web_search", name: "Web Search", description: "Search" },
        ],
      };
      mockService.getAvailableTools.mockResolvedValue(tools);

      const result = await controller.getAvailableTools();

      expect(service.getAvailableTools).toHaveBeenCalledTimes(1);
      expect(result).toEqual(tools);
    });
  });

  describe("getAvailableSkills", () => {
    it("should return available skills from service", async () => {
      const skills = [{ id: "skill-1", name: "Skill 1" }];
      mockService.getAvailableSkills.mockResolvedValue(skills);

      const result = await controller.getAvailableSkills();

      expect(service.getAvailableSkills).toHaveBeenCalledTimes(1);
      expect(result).toEqual(skills);
    });
  });

  describe("getBuiltInRoles", () => {
    it("should return built-in roles from service", async () => {
      const roles = [{ id: "researcher", name: "Researcher" }];
      mockService.getBuiltInRoles.mockResolvedValue(roles);

      const result = await controller.getBuiltInRoles();

      expect(service.getBuiltInRoles).toHaveBeenCalledTimes(1);
      expect(result).toEqual(roles);
    });
  });

  describe("getWorkStyles", () => {
    it("should return work styles from service", async () => {
      const styles = ["COLLABORATIVE", "INDEPENDENT"];
      mockService.getWorkStyles.mockResolvedValue(styles);

      const result = await controller.getWorkStyles();

      expect(service.getWorkStyles).toHaveBeenCalledTimes(1);
      expect(result).toEqual(styles);
    });
  });

  describe("generateTeamConfig", () => {
    it("should generate team config and return result", async () => {
      const body = {
        teamName: "Research Team",
        teamDescription: "A research team",
        category: "research",
      };
      const config = { members: [], workflowConfig: {} };
      mockService.generateTeamConfig.mockResolvedValue(config);

      const result = await controller.generateTeamConfig(body);

      expect(service.generateTeamConfig).toHaveBeenCalledWith(body);
      expect(result).toEqual(config);
    });
  });

  describe("getTeamById", () => {
    it("should return team by id", async () => {
      mockService.getTeamById.mockResolvedValue(mockTeam);

      const result = await controller.getTeamById("team-1");

      expect(service.getTeamById).toHaveBeenCalledWith("team-1");
      expect(result).toEqual(mockTeam);
    });

    it("should propagate NotFoundException from service", async () => {
      mockService.getTeamById.mockRejectedValue(new Error("Not found"));

      await expect(controller.getTeamById("ghost")).rejects.toThrow(
        "Not found",
      );
    });
  });

  describe("updateTeam", () => {
    it("should call service.updateTeam and return result", async () => {
      const dto: UpdateTeamDto = { displayName: "Updated Team" };
      const updated = { ...mockTeam, displayName: "Updated Team" };
      mockService.updateTeam.mockResolvedValue(updated);

      const result = await controller.updateTeam("team-1", dto);

      expect(service.updateTeam).toHaveBeenCalledWith("team-1", dto);
      expect(result.displayName).toBe("Updated Team");
    });
  });

  describe("deleteTeam", () => {
    it("should call service.deleteTeam and return result", async () => {
      mockService.deleteTeam.mockResolvedValue({ success: true });

      const result = await controller.deleteTeam("team-1");

      expect(service.deleteTeam).toHaveBeenCalledWith("team-1");
      expect(result).toEqual({ success: true });
    });
  });

  describe("addMember", () => {
    it("should call service.addMember and return result", async () => {
      const dto: CreateTeamMemberDto = {
        name: "researcher",
        displayName: "Researcher",
        roleId: "researcher",
      };
      mockService.addMember.mockResolvedValue(mockMember);

      const result = await controller.addMember("team-1", dto);

      expect(service.addMember).toHaveBeenCalledWith("team-1", dto);
      expect(result).toEqual(mockMember);
    });
  });

  describe("reorderMembers", () => {
    it("should call service.reorderMembers with memberIds array", async () => {
      const dto: ReorderMembersDto = { memberIds: ["member-2", "member-1"] };
      mockService.reorderMembers.mockResolvedValue([mockMember]);

      const result = await controller.reorderMembers("team-1", dto);

      expect(service.reorderMembers).toHaveBeenCalledWith("team-1", [
        "member-2",
        "member-1",
      ]);
      expect(result).toEqual([mockMember]);
    });
  });

  describe("updateMember", () => {
    it("should call service.updateMember and return result", async () => {
      const dto: UpdateTeamMemberDto = { displayName: "Updated Member" };
      const updated = { ...mockMember, displayName: "Updated Member" };
      mockService.updateMember.mockResolvedValue(updated);

      const result = await controller.updateMember("member-1", dto);

      expect(service.updateMember).toHaveBeenCalledWith("member-1", dto);
      expect(result.displayName).toBe("Updated Member");
    });
  });

  describe("deleteMember", () => {
    it("should call service.deleteMember and return result", async () => {
      mockService.deleteMember.mockResolvedValue({ success: true });

      const result = await controller.deleteMember("member-1");

      expect(service.deleteMember).toHaveBeenCalledWith("member-1");
      expect(result).toEqual({ success: true });
    });
  });
});

describe("AITeamsTemplatesController", () => {
  let controller: AITeamsTemplatesController;
  let service: jest.Mocked<AITeamsAdminService>;

  const mockTemplate = {
    id: "team-1",
    name: "research_team",
    displayName: "Research Team",
    status: AITeamTemplateStatus.ACTIVE,
    members: [],
  };

  const mockService = {
    createTeam: jest.fn(),
    getAllTeams: jest.fn(),
    getAvailableTools: jest.fn(),
    getAvailableSkills: jest.fn(),
    getBuiltInRoles: jest.fn(),
    getWorkStyles: jest.fn(),
    generateTeamConfig: jest.fn(),
    getTeamById: jest.fn(),
    updateTeam: jest.fn(),
    deleteTeam: jest.fn(),
    addMember: jest.fn(),
    reorderMembers: jest.fn(),
    updateMember: jest.fn(),
    deleteMember: jest.fn(),
    getActiveTeamTemplates: jest.fn(),
    getTeamTemplateById: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AITeamsTemplatesController],
      providers: [{ provide: AITeamsAdminService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AITeamsTemplatesController);
    service = module.get(AITeamsAdminService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getActiveTemplates", () => {
    it("should return active templates with no category filter", async () => {
      mockService.getActiveTeamTemplates.mockResolvedValue([mockTemplate]);

      const result = await controller.getActiveTemplates();

      expect(service.getActiveTeamTemplates).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([mockTemplate]);
    });

    it("should pass category filter to service", async () => {
      mockService.getActiveTeamTemplates.mockResolvedValue([]);

      await controller.getActiveTemplates("research");

      expect(service.getActiveTeamTemplates).toHaveBeenCalledWith("research");
    });
  });

  describe("getTemplateById", () => {
    it("should return template by id", async () => {
      mockService.getTeamTemplateById.mockResolvedValue(mockTemplate);

      const result = await controller.getTemplateById("team-1");

      expect(service.getTeamTemplateById).toHaveBeenCalledWith("team-1");
      expect(result).toEqual(mockTemplate);
    });
  });

  describe("getAvailableTools", () => {
    it("should return available tools", async () => {
      const tools = { builtIn: [] };
      mockService.getAvailableTools.mockResolvedValue(tools);

      const result = await controller.getAvailableTools();

      expect(service.getAvailableTools).toHaveBeenCalledTimes(1);
      expect(result).toEqual(tools);
    });
  });

  describe("getAvailableSkills", () => {
    it("should return available skills", async () => {
      const skills: unknown[] = [];
      mockService.getAvailableSkills.mockResolvedValue(skills);

      const result = await controller.getAvailableSkills();

      expect(service.getAvailableSkills).toHaveBeenCalledTimes(1);
      expect(result).toEqual(skills);
    });
  });
});

/**
 * AiTeamsIntegrationService Tests
 */

import { Test, TestingModule } from "@nestjs/testing";
import { AiTeamsIntegrationService } from "../ai-teams-integration.service";
import { TeamFacade, TeamRegistry, RoleRegistry } from "@/modules/ai-harness/facade";

const mockTeamInfo = {
  id: "custom-123",
  name: "Custom Research Team",
  description: "A custom team",
  type: "custom",
  leaderRoleId: "researcher",
  memberRoles: [
    { roleId: "analyst", minCount: 1, maxCount: 3, required: true },
  ],
};

const mockRole = {
  id: "researcher",
  name: "Researcher",
  type: "leader",
  description: "Research lead",
};

const mockAnalystRole = {
  id: "analyst",
  name: "Analyst",
  type: "member",
  description: "Data analyst",
};

const mockTeamConfig = {
  id: "custom-123",
  name: "Custom Research Team",
  description: "A custom team",
  type: "custom" as const,
  leaderRoleId: "researcher",
  memberRoles: [
    { roleId: "analyst", minCount: 1, maxCount: 3, required: true },
  ],
  workflow: {
    id: "custom-123-workflow",
    name: "Default Workflow",
    type: "sequential" as const,
    steps: [],
  },
  availableSkills: [],
  availableTools: [],
  constraintProfile: {
    cost: {
      budget: 10,
      modelPreference: "balanced" as const,
      allowOverBudget: false,
      warningThreshold: 0.8,
    },
    quality: {
      depth: "standard" as const,
      accuracy: "prefer_evidence" as const,
      reviewRequired: true,
      minReviewScore: 7,
      maxReworks: 2,
    },
    efficiency: {
      maxDuration: 300000,
      priority: "normal" as const,
      allowParallel: true,
      maxParallelism: 3,
    },
  },
  deliverableTypes: ["report", "analysis"],
};

describe("AiTeamsIntegrationService", () => {
  let service: AiTeamsIntegrationService;
  let _aiFacade: jest.Mocked<TeamFacade>;
  let teamRegistry: jest.Mocked<TeamRegistry>;
  let _roleRegistry: jest.Mocked<RoleRegistry>;

  const mockTeamsService = {
    listTeams: jest.fn().mockReturnValue([mockTeamInfo]),
    getTeam: jest.fn().mockReturnValue(mockTeamInfo),
  };

  const mockAiFacade = {
    teams: mockTeamsService,
  };

  const mockTeamRegistry = {
    registerConfig: jest.fn(),
    getConfig: jest.fn().mockReturnValue(mockTeamConfig),
    has: jest.fn().mockReturnValue(true),
    unregister: jest.fn(),
  };

  const mockRoleRegistry = {
    has: jest.fn().mockReturnValue(true),
    getAll: jest.fn().mockReturnValue([mockRole, mockAnalystRole]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiTeamsIntegrationService,
        { provide: TeamFacade, useValue: mockAiFacade },
        { provide: TeamRegistry, useValue: mockTeamRegistry },
        { provide: RoleRegistry, useValue: mockRoleRegistry },
      ],
    }).compile();

    service = module.get<AiTeamsIntegrationService>(AiTeamsIntegrationService);
    _aiFacade = module.get(TeamFacade);
    teamRegistry = module.get(TeamRegistry);
    _roleRegistry = module.get(RoleRegistry);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ==================== listAllTeams ====================

  describe("listAllTeams", () => {
    it("should return all teams from facade", () => {
      const result = service.listAllTeams();

      expect(mockTeamsService.listTeams).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Custom Research Team");
    });

    it("should return empty array when teams service unavailable", () => {
      const serviceWithoutFacade = new AiTeamsIntegrationService(
        undefined,
        mockTeamRegistry as any,
        mockRoleRegistry as any,
      );

      const result = serviceWithoutFacade.listAllTeams();

      expect(result).toEqual([]);
    });

    it("should return empty array when facade has no teams service", () => {
      const facadeWithoutTeams = { teams: null };
      const serviceWithoutTeams = new AiTeamsIntegrationService(
        facadeWithoutTeams as any,
        mockTeamRegistry as any,
        mockRoleRegistry as any,
      );

      const result = serviceWithoutTeams.listAllTeams();

      expect(result).toEqual([]);
    });
  });

  // ==================== listAvailableRoles ====================

  describe("listAvailableRoles", () => {
    it("should return all roles from registry", () => {
      const result = service.listAvailableRoles();

      expect(mockRoleRegistry.getAll).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("researcher");
      expect(result[0].name).toBe("Researcher");
    });

    it("should return empty array when role registry unavailable", () => {
      const serviceWithoutRegistry = new AiTeamsIntegrationService(
        mockAiFacade as any,
        mockTeamRegistry as any,
        undefined,
      );

      const result = serviceWithoutRegistry.listAvailableRoles();

      expect(result).toEqual([]);
    });
  });

  // ==================== createCustomTeam ====================

  describe("createCustomTeam", () => {
    const createDto = {
      name: "My Research Team",
      description: "A custom research team",
      leaderRoleId: "researcher",
      memberRoles: [
        { roleId: "analyst", minCount: 1, maxCount: 2, required: true },
      ],
    };

    it("should create a custom team", () => {
      const _result = service.createCustomTeam(createDto as any);

      expect(teamRegistry.registerConfig).toHaveBeenCalled();
      expect(mockTeamsService.getTeam).toHaveBeenCalled();
    });

    it("should throw when teams service unavailable", () => {
      const serviceWithoutFacade = new AiTeamsIntegrationService(
        undefined,
        mockTeamRegistry as any,
        mockRoleRegistry as any,
      );

      expect(() =>
        serviceWithoutFacade.createCustomTeam(createDto as any),
      ).toThrow("TeamsService not available");
    });

    it("should throw when leader role not found", () => {
      mockRoleRegistry.has.mockReturnValueOnce(false); // leader role not found

      expect(() => service.createCustomTeam(createDto as any)).toThrow(
        'Leader role "researcher" not found',
      );
    });

    it("should throw when member role not found", () => {
      mockRoleRegistry.has
        .mockReturnValueOnce(true) // leader found
        .mockReturnValueOnce(false); // member role not found

      expect(() => service.createCustomTeam(createDto as any)).toThrow(
        'Member role "analyst" not found',
      );
    });

    it("should create team with custom workflow when provided", () => {
      const dtoWithWorkflow = {
        ...createDto,
        workflow: {
          id: "my-workflow",
          name: "My Workflow",
          type: "sequential" as const,
          steps: [
            {
              id: "step-1",
              name: "Analyze",
              type: "task",
              executorRoles: ["analyst"],
            },
          ],
        },
      };

      service.createCustomTeam(dtoWithWorkflow as any);

      expect(teamRegistry.registerConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow: expect.objectContaining({
            id: "my-workflow",
            name: "My Workflow",
          }),
        }),
      );
    });

    it("should create default workflow when not provided", () => {
      service.createCustomTeam(createDto as any);

      expect(teamRegistry.registerConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow: expect.objectContaining({
            type: "sequential",
            steps: expect.arrayContaining([
              expect.objectContaining({ id: "analyze" }),
            ]),
          }),
        }),
      );
    });

    it("should build constraint profile from dto", () => {
      const dtoWithConstraints = {
        ...createDto,
        constraints: {
          budget: 50,
          modelPreference: "premium" as const,
          reviewRequired: false,
          maxReworks: 5,
          depth: "comprehensive" as const,
        },
      };

      service.createCustomTeam(dtoWithConstraints as any);

      expect(teamRegistry.registerConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          constraintProfile: expect.objectContaining({
            cost: expect.objectContaining({
              budget: 50,
              modelPreference: "premium",
            }),
            quality: expect.objectContaining({
              depth: "comprehensive",
              maxReworks: 5,
            }),
          }),
        }),
      );
    });
  });

  // ==================== updateCustomTeam ====================

  describe("updateCustomTeam", () => {
    const updateDto = {
      name: "Updated Team Name",
      description: "Updated description",
    };

    it("should update custom team", () => {
      const _result = service.updateCustomTeam("custom-123", updateDto as any);

      expect(teamRegistry.unregister).toHaveBeenCalledWith("custom-123");
      expect(teamRegistry.registerConfig).toHaveBeenCalled();
      expect(mockTeamsService.getTeam).toHaveBeenCalledWith("custom-123");
    });

    it("should throw when teams service unavailable", () => {
      const serviceWithoutTeams = new AiTeamsIntegrationService(
        { teams: null } as any,
        mockTeamRegistry as any,
        mockRoleRegistry as any,
      );

      expect(() =>
        serviceWithoutTeams.updateCustomTeam("custom-123", updateDto as any),
      ).toThrow("TeamsService not available");
    });

    it("should throw when trying to update predefined team", () => {
      expect(() =>
        service.updateCustomTeam("predefined-team", updateDto as any),
      ).toThrow("Cannot update predefined teams");
    });

    it("should throw when team not found", () => {
      mockTeamRegistry.getConfig.mockReturnValueOnce(null);

      expect(() =>
        service.updateCustomTeam("custom-nonexistent", updateDto as any),
      ).toThrow('Team "custom-nonexistent" not found');
    });

    it("should merge existing config with updates", () => {
      service.updateCustomTeam("custom-123", { name: "New Name" } as any);

      expect(teamRegistry.registerConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "custom-123",
          name: "New Name",
          description: mockTeamConfig.description, // kept from existing
        }),
      );
    });
  });

  // ==================== deleteCustomTeam ====================

  describe("deleteCustomTeam", () => {
    it("should delete custom team", () => {
      const result = service.deleteCustomTeam("custom-123");

      expect(teamRegistry.unregister).toHaveBeenCalledWith("custom-123");
      expect(result).toBe(true);
    });

    it("should throw when teams registry unavailable", () => {
      const serviceWithoutRegistry = new AiTeamsIntegrationService(
        mockAiFacade as any,
        undefined,
        mockRoleRegistry as any,
      );

      expect(() =>
        serviceWithoutRegistry.deleteCustomTeam("custom-123"),
      ).toThrow("TeamsService not available");
    });

    it("should throw when trying to delete predefined team", () => {
      expect(() => service.deleteCustomTeam("predefined-team")).toThrow(
        "Cannot delete predefined teams",
      );
    });

    it("should throw when team not found", () => {
      mockTeamRegistry.has.mockReturnValueOnce(false);

      expect(() => service.deleteCustomTeam("custom-nonexistent")).toThrow(
        'Team "custom-nonexistent" not found',
      );
    });
  });

  // ==================== listCustomTeams ====================

  describe("listCustomTeams", () => {
    it("should return only custom teams", () => {
      const mixedTeams = [
        { ...mockTeamInfo, type: "custom" },
        { id: "predefined-1", name: "Research", type: "research" },
      ];
      mockTeamsService.listTeams.mockReturnValueOnce(mixedTeams);

      const result = service.listCustomTeams();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("custom");
    });

    it("should return empty array when facade unavailable", () => {
      const serviceWithoutFacade = new AiTeamsIntegrationService(
        undefined,
        mockTeamRegistry as any,
        mockRoleRegistry as any,
      );

      const result = serviceWithoutFacade.listCustomTeams();

      expect(result).toEqual([]);
    });
  });

  // ==================== getTeamById ====================

  describe("getTeamById", () => {
    it("should return team by ID", () => {
      const result = service.getTeamById("custom-123");

      expect(mockTeamsService.getTeam).toHaveBeenCalledWith("custom-123");
      expect(result).toEqual(mockTeamInfo);
    });

    it("should return null when facade unavailable", () => {
      const serviceWithoutFacade = new AiTeamsIntegrationService(
        undefined,
        mockTeamRegistry as any,
        mockRoleRegistry as any,
      );

      const result = serviceWithoutFacade.getTeamById("custom-123");

      expect(result).toBeNull();
    });

    it("should return null when team throws error", () => {
      mockTeamsService.getTeam.mockImplementationOnce(() => {
        throw new Error("Team not found");
      });

      const result = service.getTeamById("nonexistent");

      expect(result).toBeNull();
    });
  });
});

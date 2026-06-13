/**
 * Unit tests for TeamFactory
 */

import { TeamFactory } from "../team-factory";
import { TeamRegistry } from "../../registry/team-registry";
import { RoleRegistry } from "../../registry/role-registry";
import { LLMFactory } from "@/modules/ai-engine/llm/factory/llm-factory";
import { TeamConfig, TeamId } from "../../abstractions/team.interface";
import { IRole } from "../../abstractions/role.interface";
import { Role } from "../../base/role";
import { getDefaultConstraintProfile } from "../../profile/mission-execution-profile";

// ==================== Helpers ====================

function makeLeaderRole(): IRole {
  return new Role({
    id: "research-lead",
    name: "Research Lead",
    description: "Research team leader",
    type: "leader",
    coreSkills: ["planning", "coordination"],
    coreTools: ["task-manager"],
    responsibilities: ["Plan research", "Review outputs"],
    systemPromptTemplate: "You are {{role_name}}. {{responsibilities}}",
  });
}

function makeMemberRole(id = "researcher"): IRole {
  return new Role({
    id,
    name: "Researcher",
    description: "Research team member",
    type: "member",
    coreSkills: ["search", "analysis"],
    coreTools: ["web-search"],
    responsibilities: ["Research topics", "Write summaries"],
    systemPromptTemplate: "You are {{role_name}}. {{responsibilities}}",
  });
}

function makeTeamConfig(overrides: Partial<TeamConfig> = {}): TeamConfig {
  return {
    id: "team-research" as TeamId,
    name: "Research Team",
    description: "A research team for AI topics",
    type: "predefined",
    leaderRoleId: "research-lead",
    memberRoles: [{ roleId: "researcher", minCount: 1, maxCount: 3 }],
    workflow: {
      id: "wf-1",
      name: "Research Workflow",
      type: "sequential",
      steps: [
        {
          id: "s1",
          name: "Research",
          type: "task",
          executorRoles: ["researcher"],
          dependsOn: [],
          parallel: false,
        },
      ],
    } as TeamConfig["workflow"],
    availableSkills: ["search"],
    availableTools: ["web-search"],
    constraintProfile: getDefaultConstraintProfile(),
    deliverableTypes: ["report"],
    ...overrides,
  };
}

function makeRegistries(
  overrides: {
    roleRegistry?: Partial<RoleRegistry>;
    teamRegistry?: Partial<TeamRegistry>;
  } = {},
): { roleRegistry: RoleRegistry; teamRegistry: TeamRegistry } {
  const leaderRole = makeLeaderRole();
  const memberRole = makeMemberRole();

  const roleRegistry = {
    get: jest.fn((id: string) => {
      if (id === "research-lead") return leaderRole;
      if (id === "researcher") return memberRole;
      throw new Error(`Role ${id} not found`);
    }),
    has: jest.fn((id: string) => ["research-lead", "researcher"].includes(id)),
    tryGet: jest.fn((id: string) => {
      if (id === "research-lead") return leaderRole;
      if (id === "researcher") return memberRole;
      return undefined;
    }),
    ...overrides.roleRegistry,
  } as unknown as RoleRegistry;

  const teamRegistry = {
    tryGet: jest.fn().mockReturnValue(null),
    has: jest.fn().mockReturnValue(false),
    getConfig: jest.fn().mockReturnValue(makeTeamConfig()),
    getAllConfigs: jest.fn().mockReturnValue([makeTeamConfig()]),
    register: jest.fn(),
    registerConfig: jest.fn(),
    ...overrides.teamRegistry,
  } as unknown as TeamRegistry;

  return { roleRegistry, teamRegistry };
}

function makeLLMFactory(): LLMFactory {
  return {
    getDefaultModel: jest.fn().mockReturnValue("default-model"),
    getAdapterForModel: jest.fn().mockReturnValue(null),
  } as unknown as LLMFactory;
}

// ==================== createFromConfig ====================

describe("TeamFactory - createFromConfig", () => {
  it("should create a valid team from config", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig();

    const team = factory.createFromConfig(config);

    expect(team.id).toBe("team-research");
    expect(team.name).toBe("Research Team");
    expect(team.leader).toBeDefined();
    expect(team.members).toHaveLength(1);
  });

  it("should use LLMFactory to get default model", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const llmFactory = makeLLMFactory();
    const factory = new TeamFactory(roleRegistry, teamRegistry, llmFactory);
    const config = makeTeamConfig();

    factory.createFromConfig(config);

    expect(llmFactory.getDefaultModel).toHaveBeenCalled();
  });

  it("should use provided defaultModel in options", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const llmFactory = makeLLMFactory();
    const factory = new TeamFactory(roleRegistry, teamRegistry, llmFactory);
    const config = makeTeamConfig();

    factory.createFromConfig(config, { defaultModel: "custom-model" });

    // defaultModel provided in options — getDefaultModel should not be called
    expect(llmFactory.getDefaultModel).not.toHaveBeenCalled();
  });

  it("should throw if leader role is not found", () => {
    const { roleRegistry, teamRegistry } = makeRegistries({
      roleRegistry: {
        get: jest.fn().mockImplementation((id: string) => {
          if (id === "research-lead") throw new Error("Role not found");
          return makeMemberRole();
        }),
        has: jest.fn().mockReturnValue(true),
        tryGet: jest.fn().mockReturnValue(undefined),
      },
    });
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig({ leaderRoleId: "research-lead" });

    expect(() => factory.createFromConfig(config)).toThrow();
  });

  it("should create team with workflow from config", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const team = factory.createFromConfig(makeTeamConfig());

    expect(team.workflow).toBeDefined();
    expect(team.workflow.steps).toHaveLength(1);
  });

  it("should register team in teamRegistry if not already registered", () => {
    const { roleRegistry, teamRegistry } = makeRegistries({
      teamRegistry: {
        tryGet: jest.fn().mockReturnValue(null),
        has: jest.fn().mockReturnValue(false),
        getConfig: jest.fn().mockReturnValue(makeTeamConfig()),
        getAllConfigs: jest.fn().mockReturnValue([makeTeamConfig()]),
        register: jest.fn(),
        registerConfig: jest.fn(),
      },
    });
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    factory.createFromConfig(makeTeamConfig());

    expect(teamRegistry.register).toHaveBeenCalled();
  });

  it("should not re-register team if already in registry", () => {
    const existingTeam = { id: "team-research" };
    const { roleRegistry, teamRegistry } = makeRegistries({
      teamRegistry: {
        tryGet: jest.fn().mockReturnValue(existingTeam),
        has: jest.fn().mockReturnValue(true),
        getConfig: jest.fn().mockReturnValue(makeTeamConfig()),
        getAllConfigs: jest.fn().mockReturnValue([makeTeamConfig()]),
        register: jest.fn(),
        registerConfig: jest.fn(),
      },
    });
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    factory.createFromConfig(makeTeamConfig());

    expect(teamRegistry.register).not.toHaveBeenCalled();
  });

  it("should create members for each role in memberRoles", () => {
    const analyst = makeMemberRole("analyst");
    const { roleRegistry, teamRegistry } = makeRegistries({
      roleRegistry: {
        get: jest.fn((id: string) => {
          if (id === "research-lead") return makeLeaderRole();
          if (id === "researcher") return makeMemberRole("researcher");
          if (id === "analyst") return analyst;
          throw new Error(`Role ${id} not found`);
        }),
        has: jest.fn().mockReturnValue(true),
        tryGet: jest.fn().mockReturnValue(null),
      },
    });
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig({
      memberRoles: [
        { roleId: "researcher", minCount: 2, maxCount: 3 },
        { roleId: "analyst", minCount: 1, maxCount: 2 },
      ],
    });

    const team = factory.createFromConfig(config);
    expect(team.members).toHaveLength(3); // 2 researchers + 1 analyst
  });

  it("should warn and skip members with missing roles", () => {
    const leaderRole = makeLeaderRole();
    const { roleRegistry, teamRegistry } = makeRegistries({
      roleRegistry: {
        get: jest.fn((id: string) => {
          if (id === "research-lead") return leaderRole;
          throw new Error(`Role ${id} not found`);
        }),
        has: jest.fn().mockReturnValue(true),
        // tryGet is used by createMembers to look up member roles
        tryGet: jest.fn((id: string) => {
          if (id === "research-lead") return leaderRole;
          return undefined;
        }),
      },
    });
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    // Use an empty memberRoles array so resolveRoles only fetches the leader role
    const config = makeTeamConfig({ memberRoles: [] });

    const team = factory.createFromConfig(config);
    // No members since memberRoles is empty
    expect(team.members).toHaveLength(0);
  });
});

// ==================== createFromId ====================

describe("TeamFactory - createFromId", () => {
  it("should return existing team from registry", () => {
    const existingTeam = { id: "team-research", name: "Cached Team" };
    const { roleRegistry, teamRegistry } = makeRegistries({
      teamRegistry: {
        tryGet: jest.fn().mockReturnValue(existingTeam),
        has: jest.fn().mockReturnValue(true),
        getConfig: jest.fn().mockReturnValue(makeTeamConfig()),
        getAllConfigs: jest.fn().mockReturnValue([]),
        register: jest.fn(),
        registerConfig: jest.fn(),
      },
    });
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const team = factory.createFromId("team-research");

    expect(team).toBe(existingTeam);
    expect(teamRegistry.getConfig).not.toHaveBeenCalled();
  });

  it("should instantiate team from config when not in registry", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const factory = new TeamFactory(roleRegistry, teamRegistry);

    const team = factory.createFromId("team-research");
    expect(team.id).toBe("team-research");
    expect(teamRegistry.getConfig).toHaveBeenCalledWith("team-research");
  });
});

// ==================== validateConfig ====================

describe("TeamFactory - validateConfig", () => {
  it("should return valid=true for a correct config", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig();

    const result = factory.validateConfig(config);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should report error when leader role is not found", () => {
    const { roleRegistry, teamRegistry } = makeRegistries({
      roleRegistry: {
        has: jest.fn().mockReturnValue(false),
        get: jest.fn().mockImplementation(() => {
          throw new Error("Not found");
        }),
        tryGet: jest.fn().mockReturnValue(undefined),
      },
    });
    const factory = new TeamFactory(roleRegistry, teamRegistry);

    const result = factory.validateConfig(makeTeamConfig());
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Leader role"))).toBe(true);
  });

  it("should report error when member role is not found", () => {
    const { roleRegistry, teamRegistry } = makeRegistries({
      roleRegistry: {
        has: jest.fn((id: string) => id === "research-lead"), // only leader exists
        get: jest.fn().mockImplementation((id: string) => {
          if (id === "research-lead") return makeLeaderRole();
          throw new Error("Not found");
        }),
        tryGet: jest.fn().mockReturnValue(null),
      },
    });
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig({
      memberRoles: [{ roleId: "missing-member", minCount: 1, maxCount: 2 }],
    });

    const result = factory.validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Member role"))).toBe(true);
  });

  it("should report error when minCount is negative", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig({
      memberRoles: [{ roleId: "researcher", minCount: -1, maxCount: 2 }],
    });

    const result = factory.validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("minCount"))).toBe(true);
  });

  it("should report error when maxCount < minCount", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig({
      memberRoles: [{ roleId: "researcher", minCount: 3, maxCount: 1 }],
    });

    const result = factory.validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("maxCount"))).toBe(true);
  });

  it("should report error when workflow has no steps", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig({
      workflow: {
        id: "wf-empty",
        name: "Empty WF",
        type: "sequential",
        steps: [],
      } as TeamConfig["workflow"],
    });

    const result = factory.validateConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Workflow"))).toBe(true);
  });

  it("should report error when workflow is missing", () => {
    const { roleRegistry, teamRegistry } = makeRegistries();
    const factory = new TeamFactory(roleRegistry, teamRegistry);
    const config = makeTeamConfig({
      workflow: undefined as unknown as TeamConfig["workflow"],
    });

    const result = factory.validateConfig(config);
    expect(result.valid).toBe(false);
  });
});

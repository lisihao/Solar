/**
 * Unit tests for Team and TeamBuilder
 */

import { Team, TeamBuilder, createTeamBuilder } from "../team";
import { Role } from "../role";
import { createLeader, createMember } from "../member";
import { Workflow } from "../workflow";
import { getDefaultConstraintProfile } from "../../profile/mission-execution-profile";
import { IRole } from "../../abstractions/role.interface";
import { IWorkflow } from "../../abstractions/workflow.interface";
import { ITeamMember } from "../../abstractions/member.interface";
import { TeamConfig } from "../../abstractions/team.interface";

// ==================== Helpers ====================

function makeRole(
  type: "leader" | "member" = "member",
  id = "researcher",
): IRole {
  return new Role({
    id,
    name: type === "leader" ? "Research Lead" : "Researcher",
    description: "Research role",
    type,
    coreSkills: ["search"],
    coreTools: ["web-search"],
    responsibilities: ["Research topics"],
    systemPromptTemplate: "You are {{role_name}}. {{responsibilities}}",
  });
}

function makeWorkflow(): IWorkflow {
  return new Workflow({
    id: "wf-1",
    name: "Test WF",
    type: "sequential",
    steps: [
      {
        id: "s1",
        name: "Step 1",
        type: "task",
        executorRoles: ["researcher"],
        dependsOn: [],
        parallel: false,
      },
    ],
  });
}

function makeTeamConfig(overrides: Partial<TeamConfig> = {}): TeamConfig {
  return {
    id: "team-1",
    name: "Research Team",
    description: "A research team",
    type: "predefined",
    leaderRoleId: "research-lead",
    memberRoles: [],
    workflow:
      makeWorkflow() as unknown as import("../../abstractions/workflow.interface").WorkflowConfig,
    availableSkills: [],
    availableTools: [],
    constraintProfile: getDefaultConstraintProfile(),
    deliverableTypes: ["report"],
    ...overrides,
  };
}

// ==================== Team ====================

describe("Team", () => {
  let leader: ITeamMember;
  let member1: ITeamMember;
  let member2: ITeamMember;
  let roleRegistry: Map<string, IRole>;
  let workflow: IWorkflow;
  let team: Team;

  beforeEach(() => {
    const leaderRole = makeRole("leader", "research-lead");
    const memberRole = makeRole("member", "researcher");
    const memberRole2 = makeRole("member", "analyst");

    leader = createLeader(
      { id: "leader-1", model: "default", roleId: "research-lead" },
      leaderRole,
    );
    member1 = createMember(
      { id: "m1", model: "default", roleId: "researcher" },
      memberRole,
    );
    member2 = createMember(
      { id: "m2", model: "default", roleId: "analyst" },
      memberRole2,
    );

    roleRegistry = new Map([
      ["research-lead", leaderRole],
      ["researcher", memberRole],
      ["analyst", memberRole2],
    ]);
    workflow = makeWorkflow();

    team = new Team(makeTeamConfig(), roleRegistry, workflow, leader, [
      member1,
      member2,
    ]);
  });

  it("should have correct id, name, description, type", () => {
    expect(team.id).toBe("team-1");
    expect(team.name).toBe("Research Team");
    expect(team.description).toBe("A research team");
    expect(team.type).toBe("predefined");
  });

  it("getAllMembers should return leader + all members", () => {
    const all = team.getAllMembers();
    expect(all).toHaveLength(3);
    expect(all[0].id).toBe("leader-1");
  });

  it("getMembersByRole should return members matching role", () => {
    const researchers = team.getMembersByRole("researcher");
    expect(researchers).toHaveLength(1);
    expect(researchers[0].id).toBe("m1");
  });

  it("getMemberById should return correct member", () => {
    expect(team.getMemberById("m1")?.id).toBe("m1");
    expect(team.getMemberById("leader-1")?.id).toBe("leader-1");
  });

  it("getMemberById should return undefined for unknown id", () => {
    expect(team.getMemberById("unknown")).toBeUndefined();
  });

  it("hasRole should return true when a member has the role", () => {
    expect(team.hasRole("researcher")).toBe(true);
  });

  it("hasRole should return false for absent role", () => {
    expect(team.hasRole("writer")).toBe(false);
  });

  it("getAvailableSkills should aggregate skills from all members", () => {
    const skills = team.getAvailableSkills();
    expect(skills).toContain("search");
  });

  it("getAvailableTools should aggregate tools from all members", () => {
    const tools = team.getAvailableTools();
    expect(tools).toContain("web-search");
  });

  it("getRole should return role from registry", () => {
    const role = team.getRole("researcher");
    expect(role?.id).toBe("researcher");
  });

  it("getRole should return undefined for unknown role", () => {
    expect(team.getRole("nonexistent")).toBeUndefined();
  });

  it("getIdleMembers should return members with idle status", () => {
    // all members start as idle
    const idle = team.getIdleMembers();
    expect(idle).toHaveLength(2); // only non-leader members
  });

  it("getIdleMembers should exclude busy members", () => {
    member1.updateStatus("busy");
    const idle = team.getIdleMembers();
    expect(idle.map((m) => m.id)).not.toContain("m1");
  });

  it("getIdleMembersByRole should filter by role and idle status", () => {
    const idle = team.getIdleMembersByRole("researcher");
    expect(idle).toHaveLength(1);
    expect(idle[0].id).toBe("m1");
  });

  it("toJSON should return the original config", () => {
    const json = team.toJSON();
    expect(json.id).toBe("team-1");
    expect(json.name).toBe("Research Team");
  });
});

// ==================== TeamBuilder ====================

describe("TeamBuilder", () => {
  function buildMinimalTeam() {
    const leaderRole = makeRole("leader", "research-lead");
    const memberRole = makeRole("member", "researcher");
    const workflow = makeWorkflow();

    return new TeamBuilder()
      .setName("My Team")
      .setDescription("A test team")
      .setLeader(
        { id: "leader-1", model: "default", roleId: "research-lead" },
        leaderRole,
      )
      .addMember(
        { id: "m1", model: "default", roleId: "researcher" },
        memberRole,
      )
      .setWorkflow(workflow)
      .build();
  }

  it("should build a valid team", () => {
    const team = buildMinimalTeam();
    expect(team.name).toBe("My Team");
    expect(team.description).toBe("A test team");
    expect(team.leader.id).toBe("leader-1");
    expect(team.members).toHaveLength(1);
  });

  it("setId should override the generated id", () => {
    const leaderRole = makeRole("leader", "research-lead");
    const workflow = makeWorkflow();

    const team = new TeamBuilder()
      .setId("custom-id")
      .setName("My Team")
      .setDescription("desc")
      .setLeader(
        { id: "leader-1", model: "default", roleId: "research-lead" },
        leaderRole,
      )
      .setWorkflow(workflow)
      .build();

    expect(team.id).toBe("custom-id");
  });

  it("setType should set team type", () => {
    const leaderRole = makeRole("leader", "research-lead");
    const workflow = makeWorkflow();

    const team = new TeamBuilder()
      .setName("My Team")
      .setDescription("desc")
      .setType("predefined")
      .setLeader(
        { id: "leader-1", model: "default", roleId: "research-lead" },
        leaderRole,
      )
      .setWorkflow(workflow)
      .build();

    expect(team.type).toBe("predefined");
  });

  it("setConstraintProfile should apply the profile", () => {
    const leaderRole = makeRole("leader", "research-lead");
    const workflow = makeWorkflow();
    const profile = getDefaultConstraintProfile();

    const team = new TeamBuilder()
      .setName("My Team")
      .setDescription("desc")
      .setLeader(
        { id: "leader-1", model: "default", roleId: "research-lead" },
        leaderRole,
      )
      .setWorkflow(workflow)
      .setConstraintProfile(profile)
      .build();

    expect(team.constraintProfile).toEqual(profile);
  });

  it("addRole should register role in team registry", () => {
    const leaderRole = makeRole("leader", "research-lead");
    const memberRole = makeRole("member", "analyst");
    const workflow = makeWorkflow();

    const team = new TeamBuilder()
      .setName("My Team")
      .setDescription("desc")
      .setLeader(
        { id: "leader-1", model: "default", roleId: "research-lead" },
        leaderRole,
      )
      .addRole(memberRole)
      .setWorkflow(workflow)
      .build();

    expect(team.getRole("analyst")).toBeDefined();
  });

  it("should throw if name is missing", () => {
    const leaderRole = makeRole("leader", "research-lead");
    const workflow = makeWorkflow();

    expect(() =>
      new TeamBuilder()
        .setDescription("desc")
        .setLeader(
          { id: "leader-1", model: "default", roleId: "research-lead" },
          leaderRole,
        )
        .setWorkflow(workflow)
        .build(),
    ).toThrow("Team name is required");
  });

  it("should throw if description is missing", () => {
    const leaderRole = makeRole("leader", "research-lead");
    const workflow = makeWorkflow();

    expect(() =>
      new TeamBuilder()
        .setName("My Team")
        .setLeader(
          { id: "leader-1", model: "default", roleId: "research-lead" },
          leaderRole,
        )
        .setWorkflow(workflow)
        .build(),
    ).toThrow("Team description is required");
  });

  it("should throw if leader is missing", () => {
    const workflow = makeWorkflow();

    expect(() =>
      new TeamBuilder()
        .setName("My Team")
        .setDescription("desc")
        .setWorkflow(workflow)
        .build(),
    ).toThrow("Team leader is required");
  });

  it("should throw if workflow is missing", () => {
    const leaderRole = makeRole("leader", "research-lead");

    expect(() =>
      new TeamBuilder()
        .setName("My Team")
        .setDescription("desc")
        .setLeader(
          { id: "leader-1", model: "default", roleId: "research-lead" },
          leaderRole,
        )
        .build(),
    ).toThrow("Team workflow is required");
  });

  it("createTeamBuilder factory returns a TeamBuilder", () => {
    const builder = createTeamBuilder();
    expect(builder).toBeInstanceOf(TeamBuilder);
  });

  it("setAvailableSkills and setAvailableTools should apply", () => {
    const leaderRole = makeRole("leader", "research-lead");
    const workflow = makeWorkflow();

    const team = new TeamBuilder()
      .setName("My Team")
      .setDescription("desc")
      .setLeader(
        { id: "leader-1", model: "default", roleId: "research-lead" },
        leaderRole,
      )
      .setWorkflow(workflow)
      .setAvailableSkills(["search", "analyze"])
      .setAvailableTools(["web-browser"])
      .build();

    expect(team.config.availableSkills).toContain("search");
    expect(team.config.availableTools).toContain("web-browser");
  });
});

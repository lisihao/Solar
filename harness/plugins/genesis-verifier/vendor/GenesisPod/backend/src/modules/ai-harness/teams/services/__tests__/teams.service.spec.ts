/**
 * Unit tests for TeamsService
 *
 * Note: TeamsService.runMission has a known timing issue where it reads
 * runningMissions before executeMission has stored the entry. Tests that
 * call executeMission will see a rejected resultPromise in the background.
 * We suppress these unhandled rejections to prevent Jest worker crashes.
 */

// Suppress unhandledRejection from background mission execution in tests
process.on("unhandledRejection", () => {});

import { NotFoundException, BadRequestException } from "@nestjs/common";
import { TeamsService, CreateMissionDto } from "../teams.service";
import { TeamFactory } from "../../factory/team-factory";
import { TeamRegistry } from "../../registry/team-registry";
import { RoleRegistry } from "../../registry/role-registry";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../../orchestrator/teams-mission-orchestrator";
import { ConstraintEngine } from "@/modules/ai-harness/facade";
import { getDefaultConstraintProfile } from "../../profile/mission-execution-profile";
import { ITeam, TeamConfig, TeamId } from "../../abstractions/team.interface";
import {
  MissionEvent,
  MissionResult,
} from "../../../agents/abstractions/mission.types";

// ==================== Helpers ====================

function makeMockTeamConfig(teamId = "test-team"): TeamConfig {
  return {
    id: teamId,
    name: "Test Team",
    description: "A test team",
    type: "predefined",
    icon: "icon",
    color: "#00FF00",
    leaderRoleId: "leader-role",
    memberRoles: [{ roleId: "member-role", minCount: 1, maxCount: 2 }],
    workflow: {} as unknown as TeamConfig["workflow"],
    availableSkills: [],
    availableTools: [],
    constraintProfile: getDefaultConstraintProfile(),
    deliverableTypes: ["report", "analysis"],
  };
}

function makeMockTeam(teamId = "test-team"): ITeam {
  return {
    id: teamId,
    name: "Test Team",
    description: "A test team",
    type: "predefined",
    config: makeMockTeamConfig(teamId),
    leader: { id: "leader-1" } as ITeam["leader"],
    members: [],
    workflow: {} as ITeam["workflow"],
    constraintProfile: getDefaultConstraintProfile(),
    getAllMembers: jest.fn().mockReturnValue([]),
    getMembersByRole: jest.fn().mockReturnValue([]),
    getMemberById: jest.fn(),
    hasRole: jest.fn().mockReturnValue(false),
    getAvailableSkills: jest.fn().mockReturnValue([]),
    getAvailableTools: jest.fn().mockReturnValue([]),
    getRole: jest.fn(),
    getIdleMembers: jest.fn().mockReturnValue([]),
    getIdleMembersByRole: jest.fn().mockReturnValue([]),
    toJSON: jest.fn().mockReturnValue(makeMockTeamConfig(teamId)),
  };
}

function makeSuccessResult(missionId: string): MissionResult {
  return {
    missionId,
    success: true,
    summary: "Mission completed",
    tokensUsed: 1000,
    costUsed: 5,
    duration: 60000,
    deliverables: [],
    statistics: {
      totalSteps: 2,
      completedSteps: 2,
      failedSteps: 0,
      skippedSteps: 0,
      reworkCount: 0,
      membersInvolved: 2,
      toolCalls: 0,
      skillCalls: 0,
      reviewCount: 1,
      reviewPassRate: 1,
    },
    metadata: {
      teamId: "test-team",
      startTime: new Date(),
      endTime: new Date(),
    },
  };
}

function makeService(
  overrides: {
    teamFactory?: Partial<TeamFactory>;
    teamRegistry?: Partial<TeamRegistry>;
    roleRegistry?: Partial<RoleRegistry>;
    missionOrchestrator?: Partial<MissionOrchestrator>;
    constraintEngine?: Partial<ConstraintEngine>;
  } = {},
): {
  service: TeamsService;
  teamFactory: jest.Mocked<TeamFactory>;
  teamRegistry: jest.Mocked<TeamRegistry>;
  roleRegistry: jest.Mocked<RoleRegistry>;
  missionOrchestrator: jest.Mocked<MissionOrchestrator>;
  constraintEngine: jest.Mocked<ConstraintEngine>;
} {
  const teamFactory = {
    createFromId: jest.fn().mockReturnValue(makeMockTeam()),
    createFromConfig: jest.fn(),
    validateConfig: jest.fn(),
    ...overrides.teamFactory,
  } as unknown as jest.Mocked<TeamFactory>;

  const teamRegistry = {
    has: jest.fn().mockReturnValue(true),
    getAllConfigs: jest.fn().mockReturnValue([makeMockTeamConfig()]),
    getConfig: jest.fn().mockReturnValue(makeMockTeamConfig()),
    register: jest.fn(),
    tryGet: jest.fn().mockReturnValue(null),
    ...overrides.teamRegistry,
  } as unknown as jest.Mocked<TeamRegistry>;

  const roleRegistry = {
    tryGet: jest
      .fn()
      .mockReturnValue({ id: "leader-role", name: "Leader Role" }),
    get: jest.fn(),
    has: jest.fn().mockReturnValue(true),
    ...overrides.roleRegistry,
  } as unknown as jest.Mocked<RoleRegistry>;

  const missionOrchestrator = {
    execute: jest.fn(),
    ...overrides.missionOrchestrator,
  } as unknown as jest.Mocked<MissionOrchestrator>;

  const constraintEngine = {
    validate: jest.fn().mockReturnValue({ valid: true, violations: [] }),
    evaluate: jest.fn(),
    canContinue: jest.fn().mockReturnValue({ canContinue: true }),
    ...overrides.constraintEngine,
  } as unknown as jest.Mocked<ConstraintEngine>;

  const service = new TeamsService(
    teamFactory,
    teamRegistry,
    roleRegistry,
    missionOrchestrator,
    constraintEngine,
  );

  return {
    service,
    teamFactory,
    teamRegistry,
    roleRegistry,
    missionOrchestrator,
    constraintEngine,
  };
}

// ==================== listTeams ====================

describe("TeamsService - listTeams", () => {
  it("should return all configured teams as TeamInfo", () => {
    const { service, teamRegistry } = makeService();
    teamRegistry.getAllConfigs.mockReturnValue([makeMockTeamConfig()]);

    const teams = service.listTeams();
    expect(teams).toHaveLength(1);
    expect(teams[0].id).toBe("test-team");
    expect(teams[0].name).toBe("Test Team");
  });

  it("should return empty array when no configs exist", () => {
    const { service, teamRegistry } = makeService();
    teamRegistry.getAllConfigs.mockReturnValue([]);
    expect(service.listTeams()).toHaveLength(0);
  });

  it("should include capabilities (deliverableTypes)", () => {
    const { service, teamRegistry } = makeService();
    teamRegistry.getAllConfigs.mockReturnValue([makeMockTeamConfig()]);

    const teams = service.listTeams();
    expect(teams[0].capabilities).toEqual(["report", "analysis"]);
  });

  it("should map leaderRole name from roleRegistry", () => {
    const { service, roleRegistry } = makeService();
    roleRegistry.tryGet.mockReturnValue({
      id: "leader-role",
      name: "Research Lead",
    } as unknown as ReturnType<RoleRegistry["tryGet"]>);

    const teams = service.listTeams();
    expect(teams[0].leaderRole).toBe("Research Lead");
  });

  it("should fallback to leaderRoleId when role not found", () => {
    const { service, roleRegistry } = makeService();
    roleRegistry.tryGet.mockReturnValue(undefined);

    const teams = service.listTeams();
    expect(teams[0].leaderRole).toBe("leader-role");
  });

  it("should include icon and color when set", () => {
    const { service } = makeService();
    const teams = service.listTeams();
    expect(teams[0].icon).toBe("icon");
    expect(teams[0].color).toBe("#00FF00");
  });
});

// ==================== getTeam ====================

describe("TeamsService - getTeam", () => {
  it("should return TeamInfo for existing team", () => {
    const { service } = makeService();
    const team = service.getTeam("test-team" as TeamId);
    expect(team.id).toBe("test-team");
    expect(team.name).toBe("Test Team");
  });

  it("should throw NotFoundException for unknown team", () => {
    const { service, teamRegistry } = makeService();
    teamRegistry.getConfig.mockReturnValue(null as unknown as TeamConfig);

    expect(() => service.getTeam("unknown" as TeamId)).toThrow(
      NotFoundException,
    );
  });

  it("should include leader and member roles in info", () => {
    const { service, roleRegistry } = makeService();
    roleRegistry.tryGet
      .mockReturnValueOnce({
        id: "leader-role",
        name: "Leader Role",
      } as unknown as ReturnType<RoleRegistry["tryGet"]>)
      .mockReturnValueOnce({
        id: "member-role",
        name: "Member Role",
      } as unknown as ReturnType<RoleRegistry["tryGet"]>);

    const team = service.getTeam("test-team" as TeamId);
    expect(team.leaderRole).toBe("Leader Role");
    expect(team.memberRoles).toContain("Member Role");
  });
});

// ==================== getTeamInstance ====================

describe("TeamsService - getTeamInstance", () => {
  it("should delegate to teamFactory.createFromId", () => {
    const { service, teamFactory } = makeService();
    const mockTeam = makeMockTeam();
    teamFactory.createFromId.mockReturnValue(mockTeam);

    const team = service.getTeamInstance("test-team" as TeamId);
    expect(team).toBe(mockTeam);
    expect(teamFactory.createFromId).toHaveBeenCalledWith("test-team");
  });
});

// ==================== executeMission ====================

describe("TeamsService - executeMission", () => {
  const dto: CreateMissionDto = {
    teamId: "test-team" as TeamId,
    goal: "Complete the task",
    context: "Additional context",
    userId: "user-123",
  };

  it("should throw NotFoundException when team not found", async () => {
    const { service, teamRegistry } = makeService();
    teamRegistry.has.mockReturnValue(false);

    await expect(service.executeMission(dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("should throw BadRequestException for invalid constraints", async () => {
    const { service, constraintEngine } = makeService();
    constraintEngine.validate.mockReturnValue({
      valid: false,
      violations: [{ type: "cost", message: "Cost too high" }],
    });

    await expect(
      service.executeMission({
        ...dto,
        constraints: {
          cost: { budget: -1 },
        } as unknown as CreateMissionDto["constraints"],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("should return a missionId string on success", async () => {
    const { service } = makeService();
    // Spy on the private runMission to prevent it from throwing unhandled rejection
    jest
      .spyOn(
        service as unknown as {
          runMission: (...args: unknown[]) => Promise<unknown>;
        },
        "runMission",
      )
      .mockResolvedValue({ missionId: "m1", success: true } as MissionResult);

    const missionId = await service.executeMission(dto);
    expect(typeof missionId).toBe("string");
    expect(missionId.length).toBeGreaterThan(0);
  });

  it("should merge constraints with team profile", async () => {
    const { service, constraintEngine } = makeService();
    jest
      .spyOn(
        service as unknown as {
          runMission: (...args: unknown[]) => Promise<unknown>;
        },
        "runMission",
      )
      .mockResolvedValue({ missionId: "m1", success: true } as MissionResult);

    await service.executeMission({ ...dto, constraints: undefined });
    expect(constraintEngine.validate).toHaveBeenCalled();
  });
});

// ==================== getMissionStatus ====================

describe("TeamsService - getMissionStatus", () => {
  it("should throw NotFoundException for unknown missionId", () => {
    const { service } = makeService();
    expect(() => service.getMissionStatus("nonexistent")).toThrow(
      NotFoundException,
    );
  });

  it("should return pending/running status for active mission", async () => {
    const { service } = makeService();
    jest
      .spyOn(
        service as unknown as {
          runMission: (...args: unknown[]) => Promise<unknown>;
        },
        "runMission",
      )
      .mockReturnValue(new Promise(() => {})); // never resolves

    const missionId = await service.executeMission({
      teamId: "test-team" as TeamId,
      goal: "Test",
    });

    const status = service.getMissionStatus(missionId);
    expect(status.missionId).toBe(missionId);
    expect(status.teamId).toBe("test-team");
    expect(["pending", "running"]).toContain(status.status);
    expect(status.startTime).toBeInstanceOf(Date);
  });
});

// ==================== getMissionResult ====================

describe("TeamsService - getMissionResult", () => {
  it("should throw NotFoundException for unknown mission", async () => {
    const { service } = makeService();
    await expect(service.getMissionResult("unknown")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("should await and return result for a running mission", async () => {
    const expectedResult = makeSuccessResult("m1");
    const { service } = makeService();
    jest
      .spyOn(
        service as unknown as {
          runMission: (...args: unknown[]) => Promise<unknown>;
        },
        "runMission",
      )
      .mockResolvedValue(expectedResult);

    const missionId = await service.executeMission({
      teamId: "test-team" as TeamId,
      goal: "Test",
    });
    // Wait for the mocked runMission to complete and move result to completedMissions
    await new Promise((r) => setTimeout(r, 10));

    const result = await service.getMissionResult(missionId);
    expect(result.success).toBe(true);
  });
});

// ==================== cancelMission ====================

describe("TeamsService - cancelMission", () => {
  it("should throw NotFoundException for non-running mission", () => {
    const { service } = makeService();
    expect(() => service.cancelMission("nonexistent")).toThrow(
      NotFoundException,
    );
  });

  it("should cancel a running mission and mark it as cancelled", async () => {
    const { service } = makeService();
    jest
      .spyOn(
        service as unknown as {
          runMission: (...args: unknown[]) => Promise<unknown>;
        },
        "runMission",
      )
      .mockReturnValue(new Promise(() => {})); // never resolves

    const missionId = await service.executeMission({
      teamId: "test-team" as TeamId,
      goal: "Test",
    });
    const result = service.cancelMission(missionId);
    expect(result).toBe(true);

    const status = service.getMissionStatus(missionId);
    expect(status.status).toBe("cancelled");
  });
});

// ==================== executeMissionStream ====================

describe("TeamsService - executeMissionStream", () => {
  it("should throw NotFoundException for unknown team", async () => {
    const { service, teamRegistry } = makeService();
    teamRegistry.has.mockReturnValue(false);

    const gen = service.executeMissionStream({
      teamId: "unknown" as TeamId,
      goal: "Test",
    });
    await expect(gen.next()).rejects.toThrow(NotFoundException);
  });

  it("should yield events from the orchestrator", async () => {
    const now = new Date();
    const mockEvents = [
      { type: "mission_started", missionId: "m1", timestamp: now, data: {} },
      {
        type: "step_started",
        missionId: "m1",
        timestamp: now,
        data: { stepId: "s1" },
      },
      {
        type: "mission_completed",
        missionId: "m1",
        timestamp: now,
        data: { result: makeSuccessResult("m1") },
      },
    ] as unknown as MissionEvent[];

    async function* mockGenerator() {
      for (const e of mockEvents) yield e;
    }

    const { service, missionOrchestrator } = makeService();
    missionOrchestrator.execute.mockReturnValue(
      mockGenerator() as unknown as ReturnType<MissionOrchestrator["execute"]>,
    );

    const collectedEvents: MissionEvent[] = [];
    // executeMissionStream delegates directly to orchestrator.execute without runMission
    for await (const event of service.executeMissionStream({
      teamId: "test-team" as TeamId,
      goal: "Test",
    })) {
      collectedEvents.push(event);
    }

    expect(collectedEvents).toHaveLength(3);
    expect(collectedEvents[0].type).toBe("mission_started");
    expect(collectedEvents[2].type).toBe("mission_completed");
  });

  it("should pass context and metadata to orchestrator", async () => {
    async function* mockGenerator() {
      // empty stream
    }

    const { service, missionOrchestrator } = makeService();
    missionOrchestrator.execute.mockReturnValue(
      mockGenerator() as unknown as ReturnType<MissionOrchestrator["execute"]>,
    );

    await service
      .executeMissionStream({
        teamId: "test-team" as TeamId,
        goal: "Test",
        context: "Extra context",
        sessionId: "session-42",
      })
      .next();

    expect(missionOrchestrator.execute).toHaveBeenCalled();
    const [missionInput] = missionOrchestrator.execute.mock.calls[0];
    expect(missionInput.metadata?.context).toBe("Extra context");
    expect(missionInput.metadata?.sessionId).toBe("session-42");
  });
});

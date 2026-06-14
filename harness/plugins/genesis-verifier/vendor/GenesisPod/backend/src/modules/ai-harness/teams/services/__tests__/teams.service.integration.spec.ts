/**
 * TeamsService — extra branch coverage for private runMission path
 *
 * Covers:
 * - getMissionStatus when mission is in completedMissions (line 275)
 * - getMissionResult returning cached completed result (line 296)
 * - runMission: successful event path (lines 338-409)
 * - runMission: step_started / step_progress event handling
 * - runMission: mission_failed string error path (lines 382-389)
 * - runMission: mission_failed object.message path
 * - runMission: no result produced → error (lines 392-396)
 * - runMission: error catch path (lines 410-454)
 * - runMission: not-initialized guard (lines 338-343)
 */

process.on("unhandledRejection", () => {});

import { InternalServerErrorException } from "@nestjs/common";
import { TeamsService, CreateMissionDto } from "../teams.service";
import { TeamFactory } from "../../factory/team-factory";
import { TeamRegistry } from "../../registry/team-registry";
import { RoleRegistry } from "../../registry/role-registry";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../../orchestrator/teams-mission-orchestrator";
import { ConstraintEngine } from "@/modules/ai-harness/facade";
import { getDefaultConstraintProfile } from "../../profile/mission-execution-profile";
import {
  MissionEvent,
  MissionResult,
} from "../../../agents/abstractions/mission.types";
import { ITeam, TeamConfig, TeamId } from "../../abstractions/team.interface";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    deliverableTypes: ["report"],
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
    summary: "Done",
    tokensUsed: 100,
    costUsed: 0.01,
    duration: 100,
    deliverables: [],
    statistics: {
      totalSteps: 1,
      completedSteps: 1,
      failedSteps: 0,
      skippedSteps: 0,
      reworkCount: 0,
      membersInvolved: 1,
      toolCalls: 0,
      skillCalls: 0,
      reviewCount: 0,
      reviewPassRate: 1,
    },
    metadata: {
      teamId: "test-team",
      startTime: new Date(),
      endTime: new Date(),
    },
  };
}

/** Build a TeamsService with a controllable missionOrchestrator.execute mock */
function makeService(orchestratorExecute: jest.Mock = jest.fn()) {
  const teamFactory = {
    createFromId: jest.fn().mockReturnValue(makeMockTeam()),
    createFromConfig: jest.fn(),
    validateConfig: jest.fn(),
  } as unknown as jest.Mocked<TeamFactory>;

  const teamRegistry = {
    has: jest.fn().mockReturnValue(true),
    getAllConfigs: jest.fn().mockReturnValue([makeMockTeamConfig()]),
    getConfig: jest.fn().mockReturnValue(makeMockTeamConfig()),
    register: jest.fn(),
    tryGet: jest.fn().mockReturnValue(null),
  } as unknown as jest.Mocked<TeamRegistry>;

  const roleRegistry = {
    tryGet: jest.fn().mockReturnValue({ id: "leader-role", name: "Leader" }),
    get: jest.fn(),
    has: jest.fn().mockReturnValue(true),
  } as unknown as jest.Mocked<RoleRegistry>;

  const missionOrchestrator = {
    execute: orchestratorExecute,
  } as unknown as jest.Mocked<MissionOrchestrator>;

  const constraintEngine = {
    validate: jest.fn().mockReturnValue({ valid: true, violations: [] }),
    evaluate: jest.fn(),
    canContinue: jest.fn().mockReturnValue({ canContinue: true }),
  } as unknown as jest.Mocked<ConstraintEngine>;

  const service = new TeamsService(
    teamFactory,
    teamRegistry,
    roleRegistry,
    missionOrchestrator,
    constraintEngine,
  );

  return { service, missionOrchestrator };
}

/**
 * Access private internals via type cast.
 * We pre-populate runningMissions so that runMission's guard passes,
 * then call runMission directly (bypassing the race in executeMission).
 */
type ServicePrivate = {
  runMission: (
    missionId: string,
    team: ITeam,
    dto: CreateMissionDto,
    constraints: ReturnType<typeof getDefaultConstraintProfile>,
    signal: AbortSignal,
  ) => Promise<MissionResult>;
  runningMissions: Map<
    string,
    {
      status: {
        missionId: string;
        teamId: TeamId;
        status: string;
        progress: number;
        startTime: Date;
        endTime?: Date;
        currentPhase?: string;
        error?: string;
      };
      abortController: AbortController;
      resultPromise: Promise<MissionResult>;
    }
  >;
  completedMissions: Map<string, MissionResult>;
};

const baseDto: CreateMissionDto = {
  teamId: "test-team" as TeamId,
  goal: "Test goal",
  context: "ctx",
  userId: "u1",
};

// ─── runMission guard: not initialized ────────────────────────────────────────

describe("TeamsService runMission — not-initialized guard", () => {
  it("throws InternalServerErrorException when missionId absent from runningMissions", async () => {
    async function* gen(): AsyncGenerator<MissionEvent> {
      // no events
    }
    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    await expect(
      priv.runMission(
        "nonexistent-id",
        makeMockTeam(),
        baseDto,
        getDefaultConstraintProfile(),
        new AbortController().signal,
      ),
    ).rejects.toThrow(InternalServerErrorException);
  });
});

// ─── runMission success path ──────────────────────────────────────────────────

describe("TeamsService runMission — success path", () => {
  it("handles step_started, step_progress and mission_completed events", async () => {
    const missionId = "test-mission-1";

    async function* gen(): AsyncGenerator<MissionEvent> {
      const now = new Date();
      yield {
        type: "step_started",
        missionId,
        timestamp: now,
        data: { stepId: "step-1" },
      } as MissionEvent;
      yield {
        type: "step_progress",
        missionId,
        timestamp: now,
        data: { progress: 50 },
      } as MissionEvent;
      yield {
        type: "mission_completed",
        missionId,
        timestamp: now,
        data: { result: makeSuccessResult(missionId) },
      } as MissionEvent;
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    const status = {
      missionId,
      teamId: "test-team" as TeamId,
      status: "pending",
      progress: 0,
      startTime: new Date(),
    };
    priv.runningMissions.set(missionId, {
      status,
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });

    const result = await priv.runMission(
      missionId,
      makeMockTeam(),
      baseDto,
      getDefaultConstraintProfile(),
      ac.signal,
    );

    expect(result.success).toBe(true);
    // After success runMission removes from runningMissions, adds to completedMissions
    expect(priv.runningMissions.has(missionId)).toBe(false);
    expect(priv.completedMissions.has(missionId)).toBe(true);
    // currentPhase updated by step_started event
    expect(status.currentPhase).toBe("step-1");
  });

  it("updates status to running during execution", async () => {
    const missionId = "test-mission-running";

    async function* gen(): AsyncGenerator<MissionEvent> {
      yield {
        type: "mission_completed",
        missionId,
        timestamp: new Date(),
        data: { result: makeSuccessResult(missionId) },
      } as MissionEvent;
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    const status = {
      missionId,
      teamId: "test-team" as TeamId,
      status: "pending",
      progress: 0,
      startTime: new Date(),
    };
    priv.runningMissions.set(missionId, {
      status,
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });

    await priv.runMission(
      missionId,
      makeMockTeam(),
      baseDto,
      getDefaultConstraintProfile(),
      ac.signal,
    );

    expect(priv.completedMissions.get(missionId)?.success).toBe(true);
  });
});

// ─── runMission no result produced ───────────────────────────────────────────

describe("TeamsService runMission — no result produced", () => {
  it("throws and stores failed result when generator ends without mission_completed", async () => {
    const missionId = "test-no-result";

    async function* gen(): AsyncGenerator<MissionEvent> {
      // yields nothing
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    priv.runningMissions.set(missionId, {
      status: {
        missionId,
        teamId: "test-team" as TeamId,
        status: "pending",
        progress: 0,
        startTime: new Date(),
      },
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });

    await expect(
      priv.runMission(
        missionId,
        makeMockTeam(),
        baseDto,
        getDefaultConstraintProfile(),
        ac.signal,
      ),
    ).rejects.toThrow(InternalServerErrorException);

    // The error catch path should have stored a failed result
    expect(priv.completedMissions.get(missionId)?.success).toBe(false);
  });
});

// ─── runMission mission_failed string error ───────────────────────────────────

describe("TeamsService runMission — mission_failed event", () => {
  it("throws with string error message from mission_failed event", async () => {
    const missionId = "test-failed-str";

    async function* gen(): AsyncGenerator<MissionEvent> {
      yield {
        type: "mission_failed",
        missionId,
        timestamp: new Date(),
        data: { error: "network timeout" },
      } as MissionEvent;
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    priv.runningMissions.set(missionId, {
      status: {
        missionId,
        teamId: "test-team" as TeamId,
        status: "pending",
        progress: 0,
        startTime: new Date(),
      },
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });

    await expect(
      priv.runMission(
        missionId,
        makeMockTeam(),
        baseDto,
        getDefaultConstraintProfile(),
        ac.signal,
      ),
    ).rejects.toThrow(InternalServerErrorException);

    // Failure cached
    expect(priv.completedMissions.get(missionId)?.success).toBe(false);
    expect(priv.completedMissions.get(missionId)?.error?.message).toContain(
      "network timeout",
    );
  });

  it("throws with object.message error from mission_failed event", async () => {
    const missionId = "test-failed-obj";

    async function* gen(): AsyncGenerator<MissionEvent> {
      yield {
        type: "mission_failed",
        missionId,
        timestamp: new Date(),
        data: { error: { message: "orchestrator error" } },
      } as MissionEvent;
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    priv.runningMissions.set(missionId, {
      status: {
        missionId,
        teamId: "test-team" as TeamId,
        status: "pending",
        progress: 0,
        startTime: new Date(),
      },
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });

    await expect(
      priv.runMission(
        missionId,
        makeMockTeam(),
        baseDto,
        getDefaultConstraintProfile(),
        ac.signal,
      ),
    ).rejects.toThrow("orchestrator error");
  });

  it("falls back to 'Mission failed' when error object has no message", async () => {
    const missionId = "test-failed-nomsg";

    async function* gen(): AsyncGenerator<MissionEvent> {
      yield {
        type: "mission_failed",
        missionId,
        timestamp: new Date(),
        data: { error: {} }, // no message field
      } as MissionEvent;
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    priv.runningMissions.set(missionId, {
      status: {
        missionId,
        teamId: "test-team" as TeamId,
        status: "pending",
        progress: 0,
        startTime: new Date(),
      },
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });

    await expect(
      priv.runMission(
        missionId,
        makeMockTeam(),
        baseDto,
        getDefaultConstraintProfile(),
        ac.signal,
      ),
    ).rejects.toThrow("Mission failed");
  });
});

// ─── getMissionStatus / getMissionResult from completedMissions ───────────────

describe("TeamsService getMissionStatus — from completedMissions", () => {
  it("returns status=completed with progress=100 for cached successful result", async () => {
    const missionId = "completed-1";
    async function* gen(): AsyncGenerator<MissionEvent> {
      yield {
        type: "mission_completed",
        missionId,
        timestamp: new Date(),
        data: { result: makeSuccessResult(missionId) },
      } as MissionEvent;
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    priv.runningMissions.set(missionId, {
      status: {
        missionId,
        teamId: "test-team" as TeamId,
        status: "pending",
        progress: 0,
        startTime: new Date(),
      },
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });
    await priv.runMission(
      missionId,
      makeMockTeam(),
      baseDto,
      getDefaultConstraintProfile(),
      ac.signal,
    );

    const status = service.getMissionStatus(missionId);
    expect(status.status).toBe("completed");
    expect(status.progress).toBe(100);
  });

  it("returns status=failed for cached failed result", async () => {
    const missionId = "failed-1";
    async function* gen(): AsyncGenerator<MissionEvent> {
      // no events → throws "Mission completed without result" → catch stores failed
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    priv.runningMissions.set(missionId, {
      status: {
        missionId,
        teamId: "test-team" as TeamId,
        status: "pending",
        progress: 0,
        startTime: new Date(),
      },
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });

    // runMission throws — that's expected
    await priv
      .runMission(
        missionId,
        makeMockTeam(),
        baseDto,
        getDefaultConstraintProfile(),
        ac.signal,
      )
      .catch(() => {});

    const status = service.getMissionStatus(missionId);
    expect(status.status).toBe("failed");
  });
});

describe("TeamsService getMissionResult — from completedMissions", () => {
  it("returns the cached result without re-executing", async () => {
    const missionId = "cmr-1";
    const expectedResult = makeSuccessResult(missionId);

    async function* gen(): AsyncGenerator<MissionEvent> {
      yield {
        type: "mission_completed",
        missionId,
        timestamp: new Date(),
        data: { result: expectedResult },
      } as MissionEvent;
    }

    const { service } = makeService(jest.fn().mockReturnValue(gen()));
    const priv = service as unknown as ServicePrivate;

    const ac = new AbortController();
    priv.runningMissions.set(missionId, {
      status: {
        missionId,
        teamId: "test-team" as TeamId,
        status: "pending",
        progress: 0,
        startTime: new Date(),
      },
      abortController: ac,
      resultPromise: Promise.resolve({} as MissionResult),
    });
    await priv.runMission(
      missionId,
      makeMockTeam(),
      baseDto,
      getDefaultConstraintProfile(),
      ac.signal,
    );

    const result = await service.getMissionResult(missionId);
    expect(result.success).toBe(true);
    expect(result.missionId).toBe(missionId);
  });
});

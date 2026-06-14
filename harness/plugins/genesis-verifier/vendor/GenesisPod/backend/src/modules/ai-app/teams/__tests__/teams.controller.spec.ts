/**
 * Unit tests for TeamsController
 */

import { NotFoundException, BadRequestException } from "@nestjs/common";
import { TeamsController } from "../controllers/teams.controller";
import {
  TeamsService,
  TeamInfo,
  MissionStatus,
} from "../../../ai-harness/teams/services/teams.service";
import { MissionResult } from "../../../ai-harness/agents/abstractions/mission.types";
import { TeamId } from "../../../ai-harness/teams/abstractions/team.interface";

// ==================== Helpers ====================

function makeTeamInfo(id = "team-1"): TeamInfo {
  return {
    id: id,
    name: "Test Team",
    description: "A test team",
    type: "predefined",
    leaderRole: "Research Lead",
    memberRoles: ["Researcher"],
    capabilities: ["report"],
  };
}

function makeMissionStatus(
  missionId: string,
  status: MissionStatus["status"] = "running",
): MissionStatus {
  return {
    missionId,
    teamId: "team-1" as TeamId,
    status,
    progress: 50,
    startTime: new Date(),
  };
}

function makeMissionResult(missionId: string): MissionResult {
  return {
    missionId,
    success: true,
    summary: "Done",
    tokensUsed: 500,
    costUsed: 2,
    duration: 30000,
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
    metadata: {},
  };
}

function makeMockTeamsService(): jest.Mocked<TeamsService> {
  return {
    listTeams: jest.fn(),
    getTeam: jest.fn(),
    getTeamInstance: jest.fn(),
    executeMission: jest.fn(),
    executeMissionStream: jest.fn(),
    getMissionStatus: jest.fn(),
    getMissionResult: jest.fn(),
    cancelMission: jest.fn(),
  } as unknown as jest.Mocked<TeamsService>;
}

function makeMockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    write: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
  return res;
}

// ==================== listTeams ====================

describe("TeamsController - listTeams", () => {
  it("should return all teams with total count", () => {
    const service = makeMockTeamsService();
    service.listTeams.mockReturnValue([makeTeamInfo("t1"), makeTeamInfo("t2")]);
    const controller = new TeamsController(service);

    const result = controller.listTeams();
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(service.listTeams).toHaveBeenCalled();
  });

  it("should return empty data when no teams", () => {
    const service = makeMockTeamsService();
    service.listTeams.mockReturnValue([]);
    const controller = new TeamsController(service);

    const result = controller.listTeams();
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ==================== getTeam ====================

describe("TeamsController - getTeam", () => {
  it("should return team info for existing team", () => {
    const service = makeMockTeamsService();
    service.getTeam.mockReturnValue(makeTeamInfo("team-1"));
    const controller = new TeamsController(service);

    const result = controller.getTeam("team-1");
    expect(result.id).toBe("team-1");
    expect(service.getTeam).toHaveBeenCalledWith("team-1");
  });

  it("should throw NotFoundException when team not found", () => {
    const service = makeMockTeamsService();
    service.getTeam.mockImplementation(() => {
      throw new NotFoundException("Team not found");
    });
    const controller = new TeamsController(service);

    expect(() => controller.getTeam("missing")).toThrow(NotFoundException);
  });
});

// ==================== createMission ====================

describe("TeamsController - createMission", () => {
  it("should create a mission and return missionId", async () => {
    const service = makeMockTeamsService();
    service.executeMission.mockResolvedValue("mission-xyz");
    const controller = new TeamsController(service);

    const result = await controller.createMission({
      teamId: "team-1",
      goal: "Research AI",
    });
    expect(result.missionId).toBe("mission-xyz");
    expect(result.message).toContain("mission-xyz");
  });

  it("should throw BadRequestException when teamId is missing", async () => {
    const service = makeMockTeamsService();
    const controller = new TeamsController(service);

    await expect(
      controller.createMission({ teamId: "", goal: "Research AI" }),
    ).rejects.toThrow(BadRequestException);
    expect(service.executeMission).not.toHaveBeenCalled();
  });

  it("should throw BadRequestException when goal is missing", async () => {
    const service = makeMockTeamsService();
    const controller = new TeamsController(service);

    await expect(
      controller.createMission({ teamId: "team-1", goal: "" }),
    ).rejects.toThrow(BadRequestException);
    expect(service.executeMission).not.toHaveBeenCalled();
  });

  it("should pass context and metadata to service", async () => {
    const service = makeMockTeamsService();
    service.executeMission.mockResolvedValue("mission-1");
    const controller = new TeamsController(service);

    await controller.createMission({
      teamId: "team-1",
      goal: "Research",
      context: "Some context",
      metadata: { key: "value" },
    });

    expect(service.executeMission).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        goal: "Research",
        context: "Some context",
        metadata: { key: "value" },
      }),
    );
  });
});

// ==================== streamMission ====================

describe("TeamsController - streamMission", () => {
  it("should set SSE headers and stream events", async () => {
    const service = makeMockTeamsService();

    async function* mockStream() {
      yield { type: "step_started", data: { stepId: "s1" } };
      yield { type: "mission_completed", data: { result: { success: true } } };
    }

    service.executeMissionStream.mockReturnValue(
      mockStream() as unknown as ReturnType<
        TeamsService["executeMissionStream"]
      >,
    );

    const controller = new TeamsController(service);
    const res = makeMockResponse();

    await controller.streamMission(
      { teamId: "team-1", goal: "Research" },
      res as unknown as import("express").Response,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/event-stream",
    );
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-cache");
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  it("should return 400 when teamId is missing", async () => {
    const service = makeMockTeamsService();
    const controller = new TeamsController(service);
    const res = makeMockResponse();

    await controller.streamMission(
      { teamId: "", goal: "Research" },
      res as unknown as import("express").Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it("should return 400 when goal is missing", async () => {
    const service = makeMockTeamsService();
    const controller = new TeamsController(service);
    const res = makeMockResponse();

    await controller.streamMission(
      { teamId: "team-1", goal: "" },
      res as unknown as import("express").Response,
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should handle streaming error and write error event", async () => {
    const service = makeMockTeamsService();

    async function* failingStream() {
      yield { type: "step_started", data: {} };
      throw new Error("Stream failure");
    }

    service.executeMissionStream.mockReturnValue(
      failingStream() as unknown as ReturnType<
        TeamsService["executeMissionStream"]
      >,
    );

    const controller = new TeamsController(service);
    const res = makeMockResponse();

    await controller.streamMission(
      { teamId: "team-1", goal: "Research" },
      res as unknown as import("express").Response,
    );

    const writeCalls = res.write.mock.calls.map((c) => String(c[0]));
    const hasErrorEvent = writeCalls.some((c) => c.includes("error"));
    expect(hasErrorEvent).toBe(true);
    expect(res.end).toHaveBeenCalled();
  });

  it("should break stream loop after mission_completed event", async () => {
    const service = makeMockTeamsService();

    async function* mockStream() {
      yield { type: "mission_completed", data: { result: { success: true } } };
      yield { type: "should_not_emit", data: {} }; // should not be reached
    }

    service.executeMissionStream.mockReturnValue(
      mockStream() as unknown as ReturnType<
        TeamsService["executeMissionStream"]
      >,
    );

    const controller = new TeamsController(service);
    const res = makeMockResponse();

    await controller.streamMission(
      { teamId: "team-1", goal: "Research" },
      res as unknown as import("express").Response,
    );

    const writeCalls = res.write.mock.calls.map((c) => String(c[0]));
    expect(writeCalls.some((c) => c.includes("should_not_emit"))).toBe(false);
    expect(writeCalls.some((c) => c.includes("done"))).toBe(true);
  });
});

// ==================== getMissionStatus ====================

describe("TeamsController - getMissionStatus", () => {
  it("should return mission status", () => {
    const service = makeMockTeamsService();
    service.getMissionStatus.mockReturnValue(makeMissionStatus("m1"));
    const controller = new TeamsController(service);

    const result = controller.getMissionStatus("m1");
    expect(result.missionId).toBe("m1");
    expect(result.status).toBe("running");
    expect(service.getMissionStatus).toHaveBeenCalledWith("m1");
  });

  it("should throw NotFoundException for unknown mission", () => {
    const service = makeMockTeamsService();
    service.getMissionStatus.mockImplementation(() => {
      throw new NotFoundException("Mission not found");
    });
    const controller = new TeamsController(service);

    expect(() => controller.getMissionStatus("unknown")).toThrow(
      NotFoundException,
    );
  });
});

// ==================== getMissionResult ====================

describe("TeamsController - getMissionResult", () => {
  it("should return mission result", async () => {
    const service = makeMockTeamsService();
    service.getMissionResult.mockResolvedValue(makeMissionResult("m1"));
    const controller = new TeamsController(service);

    const result = await controller.getMissionResult("m1");
    expect(result.missionId).toBe("m1");
    expect(result.success).toBe(true);
    expect(service.getMissionResult).toHaveBeenCalledWith("m1");
  });

  it("should propagate NotFoundException for unknown mission", async () => {
    const service = makeMockTeamsService();
    service.getMissionResult.mockRejectedValue(
      new NotFoundException("Not found"),
    );
    const controller = new TeamsController(service);

    await expect(controller.getMissionResult("unknown")).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ==================== cancelMission ====================

describe("TeamsController - cancelMission", () => {
  it("should cancel a mission and return message", () => {
    const service = makeMockTeamsService();
    service.cancelMission.mockReturnValue(true);
    const controller = new TeamsController(service);

    const result = controller.cancelMission("m1");
    expect(result.message).toContain("m1");
    expect(service.cancelMission).toHaveBeenCalledWith("m1");
  });

  it("should throw BadRequestException when cancel fails", () => {
    const service = makeMockTeamsService();
    service.cancelMission.mockReturnValue(false as unknown as true); // false simulates failure
    const controller = new TeamsController(service);

    expect(() => controller.cancelMission("m1")).toThrow(BadRequestException);
  });

  it("should propagate NotFoundException from service", () => {
    const service = makeMockTeamsService();
    service.cancelMission.mockImplementation(() => {
      throw new NotFoundException("Mission not found");
    });
    const controller = new TeamsController(service);

    expect(() => controller.cancelMission("unknown")).toThrow(
      NotFoundException,
    );
  });
});

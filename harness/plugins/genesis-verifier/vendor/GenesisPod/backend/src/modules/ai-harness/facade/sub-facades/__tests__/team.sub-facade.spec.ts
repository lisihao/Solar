/**
 * TeamSubFacade Unit Tests
 */

import { TeamSubFacade } from "../team.sub-facade";

// ============================================================================
// Mocks
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockTeamsService: any;

function createFacade(withService = true): TeamSubFacade {
  return new TeamSubFacade(withService ? mockTeamsService : undefined);
}

// ============================================================================
// Test suite
// ============================================================================

describe("TeamSubFacade", () => {
  beforeEach(() => {
    mockTeamsService = {
      executeMission: jest.fn(),
      executeMissionStream: jest.fn(),
      cancelMission: jest.fn(),
      getMissionStatus: jest.fn(),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // startTeamMission — service not available
  // --------------------------------------------------------------------------

  describe("startTeamMission — without service", () => {
    it("should return failure result when teamsService is not available", async () => {
      const facade = createFacade(false);
      const result = await facade.startTeamMission({
        teamType: "research",
        missionInput: { goal: "research AI", userId: "user-1" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("TeamsService not available");
    });
  });

  // --------------------------------------------------------------------------
  // startTeamMission — success path
  // --------------------------------------------------------------------------

  describe("startTeamMission — success", () => {
    it("should complete mission and return success", async () => {
      mockTeamsService.executeMission.mockResolvedValue("mission-001");
      mockTeamsService.getMissionStatus.mockReturnValueOnce({
        status: "completed",
        progress: 100,
        currentPhase: "done",
      });

      const facade = createFacade();
      const result = await facade.startTeamMission({
        teamType: "research",
        missionInput: {
          goal: "Do research",
          userId: "user-1",
          sessionId: "sess-1",
        },
      });

      expect(result.success).toBe(true);
      expect(result.output).toEqual({
        missionId: "mission-001",
        status: "completed",
      });
      expect(result.summary).toContain("Mission completed successfully");
    });

    it("should call progressCallback during polling", async () => {
      mockTeamsService.executeMission.mockResolvedValue("mission-002");
      mockTeamsService.getMissionStatus
        .mockReturnValueOnce({
          status: "running",
          progress: 50,
          currentPhase: "research",
        })
        .mockReturnValueOnce({
          status: "completed",
          progress: 100,
          currentPhase: "done",
        });

      const progressCallback = jest.fn();
      const facade = createFacade();

      // Use fake timers to prevent real delays
      jest.useFakeTimers();
      const promise = facade.startTeamMission({
        teamType: "debate",
        missionInput: { goal: "Debate topic", userId: "user-2" },
        progressCallback,
      });

      await jest.runAllTimersAsync();
      const result = await promise;
      jest.useRealTimers();

      expect(result.success).toBe(true);
      expect(progressCallback).toHaveBeenCalled();
      const firstCall = progressCallback.mock.calls[0][0];
      expect(firstCall.missionId).toBe("mission-002");
      expect(firstCall.phase).toBe("research");
    });

    it("should return failure when mission status is 'failed'", async () => {
      mockTeamsService.executeMission.mockResolvedValue("mission-003");
      mockTeamsService.getMissionStatus.mockReturnValue({
        status: "failed",
        error: "Out of memory",
        progress: 0,
      });

      const facade = createFacade();
      const result = await facade.startTeamMission({
        teamType: "review",
        missionInput: { goal: "Review code" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Out of memory");
    });

    it("should return generic error when failed mission has no error message", async () => {
      mockTeamsService.executeMission.mockResolvedValue("mission-004");
      mockTeamsService.getMissionStatus.mockReturnValue({
        status: "failed",
        progress: 0,
        error: undefined,
      });

      const facade = createFacade();
      const result = await facade.startTeamMission({
        teamType: "research",
        missionInput: { goal: "Research" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Mission failed");
    });

    it("should return failure when mission is 'cancelled'", async () => {
      mockTeamsService.executeMission.mockResolvedValue("mission-005");
      mockTeamsService.getMissionStatus.mockReturnValue({
        status: "cancelled",
        progress: 0,
      });

      const facade = createFacade();
      const result = await facade.startTeamMission({
        teamType: "research",
        missionInput: { goal: "Research" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Mission was cancelled");
    });

    it("should return failure when mission status not found (null)", async () => {
      mockTeamsService.executeMission.mockResolvedValue("mission-ghost");
      mockTeamsService.getMissionStatus.mockReturnValue(null);

      const facade = createFacade();
      const result = await facade.startTeamMission({
        teamType: "research",
        missionInput: { goal: "Ghost mission" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return timeout error when mission poll loop times out", async () => {
      // Simulate timeout by making getMissionStatus continuously return running
      // and using fake timers to skip ahead past the timeout
      mockTeamsService.executeMission.mockResolvedValue("mission-timeout");
      mockTeamsService.getMissionStatus.mockReturnValue({
        status: "running",
        progress: 10,
        currentPhase: "init",
      });

      jest.useFakeTimers();

      const facade = createFacade();
      const executePromise = facade.startTeamMission({
        teamType: "research",
        missionInput: { goal: "Timeout test" },
      });

      // Advance time well past the 300s timeout
      await jest.advanceTimersByTimeAsync(310000);

      const result = await executePromise;
      jest.useRealTimers();

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");
    }, 15000);
  });

  // --------------------------------------------------------------------------
  // startTeamMission — executeMission throws
  // --------------------------------------------------------------------------

  describe("startTeamMission — error handling", () => {
    it("should catch executeMission error and return failure", async () => {
      mockTeamsService.executeMission.mockRejectedValue(
        new Error("Service unavailable"),
      );

      const facade = createFacade();
      const result = await facade.startTeamMission({
        teamType: "research",
        missionInput: { goal: "Research" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Service unavailable");
    });

    it("should handle non-Error exceptions", async () => {
      mockTeamsService.executeMission.mockRejectedValue("string error");

      const facade = createFacade();
      const result = await facade.startTeamMission({
        teamType: "research",
        missionInput: { goal: "Research" },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("string error");
    });
  });

  // --------------------------------------------------------------------------
  // mapTeamTypeToId (indirectly via startTeamMission)
  // --------------------------------------------------------------------------

  describe("team type mapping", () => {
    const teamTypeMappings: Array<[string, string]> = [
      ["research", "research-team"],
      ["debate", "debate-team"],
      ["review", "review-team"],
      ["report", "report-team"],
    ];

    it.each(teamTypeMappings)(
      "should map teamType '%s' to teamId '%s'",
      async (teamType, expectedTeamId) => {
        mockTeamsService.executeMission.mockResolvedValue("mission-x");
        mockTeamsService.getMissionStatus.mockReturnValue({
          status: "completed",
          progress: 100,
        });

        const facade = createFacade();
        await facade.startTeamMission({
          teamType,
          missionInput: { goal: "Test" },
        });

        expect(mockTeamsService.executeMission).toHaveBeenCalledWith(
          expect.objectContaining({ teamId: expectedTeamId }),
        );
      },
    );

    it("should use teamType as-is when not in mapping", async () => {
      mockTeamsService.executeMission.mockResolvedValue("mission-x");
      mockTeamsService.getMissionStatus.mockReturnValue({
        status: "completed",
        progress: 100,
      });

      const facade = createFacade();
      await facade.startTeamMission({
        teamType: "custom-team-type",
        missionInput: { goal: "Custom" },
      });

      expect(mockTeamsService.executeMission).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: "custom-team-type" }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // executeMissionStream
  // --------------------------------------------------------------------------

  describe("executeMissionStream", () => {
    it("should yield nothing when teamsService is not available", async () => {
      const facade = createFacade(false);
      const events: unknown[] = [];

      for await (const event of facade.executeMissionStream({
        teamId: "research-team",
        goal: "Research",
        userId: "user-1",
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(0);
    });

    it("should yield events from teamsService when available", async () => {
      const fakeEvents = [
        { type: "progress", data: { progress: 50 } },
        { type: "complete", data: { result: "done" } },
      ];

      async function* eventGenerator() {
        for (const e of fakeEvents) yield e;
      }

      mockTeamsService.executeMissionStream.mockReturnValue(eventGenerator());

      const facade = createFacade();
      const events: unknown[] = [];

      for await (const event of facade.executeMissionStream({
        teamId: "research-team",
        goal: "Stream test",
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(fakeEvents[0]);
      expect(events[1]).toEqual(fakeEvents[1]);
    });
  });

  // --------------------------------------------------------------------------
  // cancelMission
  // --------------------------------------------------------------------------

  describe("cancelMission", () => {
    it("should return false when teamsService not available", () => {
      const facade = createFacade(false);
      const result = facade.cancelMission("mission-001");

      expect(result).toBe(false);
    });

    it("should delegate to teamsService.cancelMission", () => {
      mockTeamsService.cancelMission.mockReturnValue(true);

      const facade = createFacade();
      const result = facade.cancelMission("mission-001");

      expect(result).toBe(true);
      expect(mockTeamsService.cancelMission).toHaveBeenCalledWith(
        "mission-001",
      );
    });

    it("should return false when teamsService fails to cancel", () => {
      mockTeamsService.cancelMission.mockReturnValue(false);

      const facade = createFacade();
      const result = facade.cancelMission("mission-notfound");

      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getMissionStatus
  // --------------------------------------------------------------------------

  describe("getMissionStatus", () => {
    it("should return null when teamsService not available", () => {
      const facade = createFacade(false);
      const result = facade.getMissionStatus("mission-001");

      expect(result).toBeNull();
    });

    it("should return mission status from teamsService", () => {
      const status = {
        status: "running",
        progress: 60,
        currentPhase: "analysis",
      };
      mockTeamsService.getMissionStatus.mockReturnValue(status);

      const facade = createFacade();
      const result = facade.getMissionStatus("mission-001");

      expect(result).toBe(status);
      expect(mockTeamsService.getMissionStatus).toHaveBeenCalledWith(
        "mission-001",
      );
    });

    it("should return null when mission not found", () => {
      mockTeamsService.getMissionStatus.mockReturnValue(null);

      const facade = createFacade();
      const result = facade.getMissionStatus("unknown-mission");

      expect(result).toBeNull();
    });
  });
});

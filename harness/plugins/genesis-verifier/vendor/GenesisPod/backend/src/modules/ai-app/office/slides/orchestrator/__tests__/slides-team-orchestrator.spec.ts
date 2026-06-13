/**
 * SlidesTeamOrchestrator Unit Tests
 *
 * Tests for orchestrator coordination: mission lifecycle, planning phase,
 * task execution phase, review, audit, synthesis and error handling.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { SlidesTeamOrchestrator } from "../slides-team-orchestrator";
import { SlidesLeader } from "../slides-leader";
import { SlidesTeamMember } from "../slides-team-member";
import { SlidesRepository } from "../slides-repository";
import { AgentFacade } from "@/modules/ai-harness/facade";
import type {
  SlidesTeamOrchestratorInput,
  SlidesMissionEvent,
  SlidesTask,
  TaskBreakdown,
} from "../types";

// ============================================================================
// Helpers
// ============================================================================

function makeInput(
  overrides?: Partial<SlidesTeamOrchestratorInput>,
): SlidesTeamOrchestratorInput {
  return {
    userId: "user-1",
    sessionId: "session-1",
    sourceText: "This is test source text for slide generation.",
    userRequirement: "Focus on key metrics",
    targetPages: 5,
    stylePreference: "dark",
    themeId: "genspark-dark",
    ...overrides,
  };
}

function makeTask(overrides?: Partial<SlidesTask>): SlidesTask {
  return {
    id: "task-1",
    title: "Task Decomposition",
    description: "Analyze source and decompose tasks",
    assignee: "analyst",
    skillId: "task-decomposition",
    input: {},
    dependencies: [],
    status: "pending",
    priority: "high",
    revisionCount: 0,
    maxRevisions: 2,
    ...overrides,
  };
}

function makeDefaultTasks(): SlidesTask[] {
  return [
    makeTask({
      id: "task-decomp",
      skillId: "task-decomposition",
      dependencies: [],
    }),
    makeTask({
      id: "task-outline",
      skillId: "outline-planning",
      dependencies: ["task-decomp"],
    }),
    makeTask({
      id: "task-pages",
      skillId: "page-pipeline",
      dependencies: ["task-outline"],
    }),
  ];
}

function makeTaskBreakdown(): TaskBreakdown {
  return {
    understanding: "Test breakdown",
    tasks: [
      { skillId: "task-decomposition", assignee: "analyst", priority: "high" },
      {
        skillId: "outline-planning",
        assignee: "strategist",
        priority: "high",
        dependsOn: ["task-decomposition"],
      },
      {
        skillId: "page-pipeline",
        assignee: "writer",
        priority: "medium",
        dependsOn: ["outline-planning"],
      },
    ],
    executionPlan: "Sequential",
    risks: "",
  };
}

// ============================================================================
// Mocks
// ============================================================================

function makeMockLeader(): jest.Mocked<SlidesLeader> {
  const tasks = makeDefaultTasks();
  return {
    planTasks: jest.fn().mockResolvedValue(makeTaskBreakdown()),
    createDefaultTasks: jest.fn().mockReturnValue([
      { skillId: "task-decomposition", assignee: "analyst", priority: "high" },
      {
        skillId: "outline-planning",
        assignee: "strategist",
        priority: "high",
      },
      { skillId: "page-pipeline", assignee: "writer", priority: "medium" },
    ]),
    createTasksFromBreakdown: jest.fn().mockReturnValue(tasks),
    reviewTask: jest.fn().mockResolvedValue({
      decision: "approved",
      feedback: "Looks good",
      score: 8,
    }),
    auditQuality: jest.fn().mockResolvedValue({
      passed: true,
      overallScore: 85,
      issues: [],
      suggestions: [],
    }),
    synthesizeResults: jest.fn().mockResolvedValue({
      pages: [
        {
          pageNumber: 1,
          html: "<div>Page 1</div>",
          title: "Introduction",
        },
      ],
      outline: { title: "Test PPT", pages: [] },
      summary: "Generated 1 page",
    }),
  } as unknown as jest.Mocked<SlidesLeader>;
}

function makeMockTeamMember(): jest.Mocked<SlidesTeamMember> {
  return {
    executeTask: jest.fn().mockResolvedValue({
      success: true,
      result: { pages: [{ pageNumber: 1, html: "<div>Page</div>" }] },
      duration: 100,
    }),
  } as unknown as jest.Mocked<SlidesTeamMember>;
}

function makeMockRepository(): jest.Mocked<SlidesRepository> {
  return {
    createMission: jest.fn().mockResolvedValue({
      id: "mission-persisted",
      userId: "user-1",
      sessionId: "session-1",
      sourceText: "Source",
      tasks: [],
      currentPhase: "planning",
      status: "pending",
      pages: [],
      createdAt: new Date(),
      totalTasks: 0,
      completedTasks: 0,
      metadata: {},
    }),
    updateMissionStatus: jest.fn().mockResolvedValue(undefined),
    updateMissionTaskBreakdown: jest.fn().mockResolvedValue(undefined),
    createTasks: jest.fn().mockResolvedValue(undefined),
    updateTaskStatus: jest.fn().mockResolvedValue(undefined),
    updateTaskResult: jest.fn().mockResolvedValue(undefined),
    updateTaskReview: jest.fn().mockResolvedValue(undefined),
    updateMissionProgress: jest.fn().mockResolvedValue(undefined),
    updateMissionQualityAudit: jest.fn().mockResolvedValue(undefined),
    updateMissionPages: jest.fn().mockResolvedValue(undefined),
    updateMissionOutline: jest.fn().mockResolvedValue(undefined),
    completeMission: jest.fn().mockResolvedValue(undefined),
    updateMissionError: jest.fn().mockResolvedValue(undefined),
    recordEvent: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SlidesRepository>;
}

function makeMockFacade(): jest.Mocked<AgentFacade> {
  return {
    startTrace: jest.fn().mockReturnValue("trace-001"),
    endTrace: jest.fn(),
    addSpan: jest.fn().mockReturnValue("span-001"),
    endSpan: jest.fn(),
  } as unknown as jest.Mocked<AgentFacade>;
}

// Collect all events from async generator
async function collectEvents(
  gen: AsyncGenerator<SlidesMissionEvent>,
): Promise<SlidesMissionEvent[]> {
  const events: SlidesMissionEvent[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

// ============================================================================
// Tests
// ============================================================================

describe("SlidesTeamOrchestrator", () => {
  let orchestrator: SlidesTeamOrchestrator;
  let mockLeader: jest.Mocked<SlidesLeader>;
  let mockTeamMember: jest.Mocked<SlidesTeamMember>;
  let mockFacade: jest.Mocked<AgentFacade>;

  beforeEach(() => {
    mockLeader = makeMockLeader();
    mockTeamMember = makeMockTeamMember();
    mockFacade = makeMockFacade();

    orchestrator = new SlidesTeamOrchestrator(
      mockLeader,
      mockTeamMember,
      undefined, // no persistence
      mockFacade,
    );
  });

  // --------------------------------------------------------------------------
  // Constructor & persistence
  // --------------------------------------------------------------------------

  describe("constructor", () => {
    it("should disable persistence when no repository provided", () => {
      const orch = new SlidesTeamOrchestrator(
        mockLeader,
        mockTeamMember,
        undefined,
        undefined,
      );
      // No direct access to private field; verifying no throws
      expect(orch).toBeDefined();
    });

    it("should enable persistence when repository provided", async () => {
      const mockRepo = makeMockRepository();
      const orch = new SlidesTeamOrchestrator(
        mockLeader,
        mockTeamMember,
        mockRepo,
        mockFacade,
      );

      const events = await collectEvents(orch.executeMission(makeInput()));

      expect(mockRepo.createMission).toHaveBeenCalled();
      expect(events.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // executeMission - happy path
  // --------------------------------------------------------------------------

  describe("executeMission() - happy path", () => {
    it("should yield mission:created event first", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      expect(events[0].type).toBe("mission:created");
    });

    it("should yield planning:started event", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      expect(events.some((e) => e.type === "planning:started")).toBe(true);
    });

    it("should yield planning:completed event", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      expect(events.some((e) => e.type === "planning:completed")).toBe(true);
    });

    it("should yield task:created events", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      expect(events.some((e) => e.type === "task:created")).toBe(true);
    });

    it("should yield mission:phase_changed for executing phase", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      const phaseChangedToExecuting = events.find(
        (e) =>
          e.type === "mission:phase_changed" &&
          (e.data as { phase?: string }).phase === "executing",
      );

      expect(phaseChangedToExecuting).toBeDefined();
    });

    it("should yield mission:completed as final event on success", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      const lastEvent = events[events.length - 1];
      expect(lastEvent.type).toBe("mission:completed");
    });

    it("should call leader.createDefaultTasks during planning", async () => {
      await collectEvents(orchestrator.executeMission(makeInput()));

      expect(mockLeader.createDefaultTasks).toHaveBeenCalled();
    });

    it("should call teamMember.executeTask for each task", async () => {
      await collectEvents(orchestrator.executeMission(makeInput()));

      expect(mockTeamMember.executeTask).toHaveBeenCalled();
    });

    it("should call leader.reviewTask after execution", async () => {
      await collectEvents(orchestrator.executeMission(makeInput()));

      expect(mockLeader.reviewTask).toHaveBeenCalled();
    });

    it("should yield audit:started and audit:completed events during audit phase", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      expect(events.some((e) => e.type === "audit:started")).toBe(true);
      expect(events.some((e) => e.type === "audit:completed")).toBe(true);
    });

    it("should call leader.synthesizeResults during synthesis phase", async () => {
      await collectEvents(orchestrator.executeMission(makeInput()));

      expect(mockLeader.synthesizeResults).toHaveBeenCalled();
    });

    it("should include pages in mission:completed data", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      const completedEvent = events.find((e) => e.type === "mission:completed");
      expect(completedEvent).toBeDefined();
      expect(
        (completedEvent!.data as { pages?: unknown[] }).pages,
      ).toBeInstanceOf(Array);
    });

    it("should start and end traces via aiFacade", async () => {
      await collectEvents(orchestrator.executeMission(makeInput()));

      expect(mockFacade.startTrace).toHaveBeenCalled();
      expect(mockFacade.endTrace).toHaveBeenCalledWith(
        "trace-001",
        expect.objectContaining({ status: "success" }),
      );
    });

    it("should add spans for planning, executing, reviewing, auditing, synthesis phases", async () => {
      await collectEvents(orchestrator.executeMission(makeInput()));

      // At least 5 spans for 5 phases
      expect(mockFacade.addSpan).toHaveBeenCalledTimes(5);
    });

    it("should set mission.status to completed on success", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      const completedEvent = events.find((e) => e.type === "mission:completed");
      const mission = (
        completedEvent!.data as { mission?: { status?: string } }
      ).mission;

      expect(mission?.status).toBe("completed");
    });
  });

  // --------------------------------------------------------------------------
  // executeMission - without aiFacade (no tracing)
  // --------------------------------------------------------------------------

  describe("executeMission() - without aiFacade", () => {
    it("should complete successfully without tracing", async () => {
      const orchNoFacade = new SlidesTeamOrchestrator(
        mockLeader,
        mockTeamMember,
        undefined,
        undefined,
      );

      const events = await collectEvents(
        orchNoFacade.executeMission(makeInput()),
      );

      expect(events.some((e) => e.type === "mission:completed")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // executeMission - failure path
  // --------------------------------------------------------------------------

  describe("executeMission() - failure path", () => {
    it("should yield mission:failed when planning throws", async () => {
      mockLeader.createDefaultTasks.mockImplementation(() => {
        throw new Error("Planning failure");
      });

      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      expect(events.some((e) => e.type === "mission:failed")).toBe(true);
    });

    it("should include error message in mission:failed data", async () => {
      mockLeader.synthesizeResults.mockRejectedValue(
        new Error("Synthesis catastrophically failed"),
      );

      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      const failedEvent = events.find((e) => e.type === "mission:failed");
      expect(failedEvent).toBeDefined();
      expect((failedEvent!.data as { error?: string }).error).toContain(
        "Synthesis catastrophically failed",
      );
    });

    it("should end trace with error status on failure", async () => {
      mockLeader.synthesizeResults.mockRejectedValue(
        new Error("Synthesis failed"),
      );

      await collectEvents(orchestrator.executeMission(makeInput()));

      expect(mockFacade.endTrace).toHaveBeenCalledWith(
        "trace-001",
        expect.objectContaining({ status: "error" }),
      );
    });

    it("should persist error state when repository available", async () => {
      const mockRepo = makeMockRepository();
      const orch = new SlidesTeamOrchestrator(
        mockLeader,
        mockTeamMember,
        mockRepo,
        undefined,
      );

      mockLeader.synthesizeResults.mockRejectedValue(
        new Error("Fatal synthesis error"),
      );

      await collectEvents(orch.executeMission(makeInput()));

      expect(mockRepo.updateMissionError).toHaveBeenCalled();
    });

    it("should continue when a task fails (skip dependent tasks)", async () => {
      // Make team member fail for first task
      mockTeamMember.executeTask.mockResolvedValue({
        success: false,
        error: "Task execution failed",
        duration: 50,
      });

      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      // Should still complete the mission lifecycle
      expect(events.length).toBeGreaterThan(0);
      const lastEvent = events[events.length - 1];
      expect(
        lastEvent.type === "mission:completed" ||
          lastEvent.type === "mission:failed",
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // execute() - non-streaming wrapper
  // --------------------------------------------------------------------------

  describe("execute() - non-streaming wrapper", () => {
    it("should return success result with pages on completion", async () => {
      const result = await orchestrator.execute(makeInput());

      expect(result.success).toBe(true);
      expect(result.pages).toBeInstanceOf(Array);
      expect(result.missionId).toBeTruthy();
      expect(typeof result.duration).toBe("number");
    });

    it("should return failure result when mission fails", async () => {
      mockLeader.synthesizeResults.mockRejectedValue(
        new Error("Synthesis error"),
      );

      const result = await orchestrator.execute(makeInput());

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should return sessionId from input", async () => {
      const result = await orchestrator.execute(
        makeInput({ sessionId: "my-session" }),
      );

      expect(result.sessionId).toBe("my-session");
    });

    it("should return error when no events received (empty generator)", async () => {
      // Mock a generator that immediately ends
      async function* emptyGen(): AsyncGenerator<SlidesMissionEvent> {
        // yields nothing
      }

      jest.spyOn(orchestrator, "executeMission").mockReturnValue(emptyGen());

      const result = await orchestrator.execute(makeInput());

      expect(result.success).toBe(false);
      expect(result.error).toBe("No events received");
    });
  });

  // --------------------------------------------------------------------------
  // Persistence integration
  // --------------------------------------------------------------------------

  describe("persistence - with repository", () => {
    let mockRepo: jest.Mocked<SlidesRepository>;
    let orchWithPersistence: SlidesTeamOrchestrator;

    beforeEach(() => {
      mockRepo = makeMockRepository();
      orchWithPersistence = new SlidesTeamOrchestrator(
        mockLeader,
        mockTeamMember,
        mockRepo,
        mockFacade,
      );
    });

    it("should persist mission:created event", async () => {
      await collectEvents(orchWithPersistence.executeMission(makeInput()));

      expect(mockRepo.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "mission:created" }),
      );
    });

    it("should call completeMission on success", async () => {
      await collectEvents(orchWithPersistence.executeMission(makeInput()));

      expect(mockRepo.completeMission).toHaveBeenCalled();
    });

    it("should call updateMissionStatus during planning", async () => {
      await collectEvents(orchWithPersistence.executeMission(makeInput()));

      expect(mockRepo.updateMissionStatus).toHaveBeenCalledWith(
        expect.any(String),
        "planning",
        "planning",
      );
    });

    it("should not throw when recordEvent fails - just warns and continues", async () => {
      mockRepo.recordEvent.mockRejectedValue(new Error("DB write failed"));
      // completeMission might also throw since repository errors are expected
      mockRepo.completeMission.mockRejectedValue(new Error("DB write failed"));

      // Should not propagate the error - just warn and still yield events
      const collectPromise = collectEvents(
        orchWithPersistence.executeMission(makeInput()),
      );

      // Should resolve without throwing
      await expect(collectPromise).resolves.toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Event structure validation
  // --------------------------------------------------------------------------

  describe("event structure", () => {
    it("should have missionId on every event", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      events.forEach((event) => {
        expect(event.missionId).toBeTruthy();
        expect(typeof event.missionId).toBe("string");
      });
    });

    it("should have timestamp on every event", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      events.forEach((event) => {
        expect(event.timestamp).toBeInstanceOf(Date);
      });
    });

    it("should have type on every event", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput()),
      );

      events.forEach((event) => {
        expect(typeof event.type).toBe("string");
        expect(event.type.length).toBeGreaterThan(0);
      });
    });
  });

  // --------------------------------------------------------------------------
  // Input handling
  // --------------------------------------------------------------------------

  describe("input handling", () => {
    it("should create mission with correct userId", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput({ userId: "special-user" })),
      );

      const createdEvent = events.find((e) => e.type === "mission:created");
      const mission = (createdEvent!.data as { mission?: { userId?: string } })
        .mission;

      expect(mission?.userId).toBe("special-user");
    });

    it("should handle optional targetPages", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(makeInput({ targetPages: undefined })),
      );

      expect(events.some((e) => e.type === "mission:completed")).toBe(true);
    });

    it("should pass targetAudience to mission metadata", async () => {
      const events = await collectEvents(
        orchestrator.executeMission(
          makeInput({ targetAudience: "C-suite executives" }),
        ),
      );

      const createdEvent = events.find((e) => e.type === "mission:created");
      const mission = (
        createdEvent!.data as {
          mission?: { metadata?: { targetAudience?: string } };
        }
      ).mission;

      expect(mission?.metadata?.targetAudience).toBe("C-suite executives");
    });
  });
});

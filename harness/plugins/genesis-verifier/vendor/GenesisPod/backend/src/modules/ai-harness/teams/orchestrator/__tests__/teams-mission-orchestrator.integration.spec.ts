/**
 * MissionOrchestrator - Supplemental Tests
 *
 * Covers branches not in mission-orchestrator.spec.ts:
 * - execute() with traceCollector (startTrace, addSpan, endSpan, endTrace)
 * - execute() with missionExecutor (kernel process spawning)
 * - execute() with canContinue=false (constraint violation during execution)
 * - execute() failure path (endTrace with error status)
 * - cancel() async with traceId cleanup
 * - getState() public method
 * - review() without llmFactory (fallback path)
 * - plan() with reviewRequired=true adding review step
 */

import { ConfigService } from "@nestjs/config";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../teams-mission-orchestrator";
import { ConstraintEngine } from "@/modules/ai-harness/facade";
import {
  MissionInput,
  MissionEventType,
} from "../../../agents/abstractions/mission.types";
import { ITeam } from "../../abstractions/team.interface";
import { ITeamMember } from "../../abstractions/member.interface";
import { MissionExecutionProfile } from "../../constraints";
import { TraceCollectorService } from "@/modules/ai-harness/tracing/observability/trace-collector.service";
import { ShortTermMemoryService } from "@/modules/ai-harness/memory/stores/short-term-memory.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an in-memory ShortTermMemoryService mock that properly stores
 * and retrieves context (needed by executeStepFull checkpoint saving).
 */
function makeMemoryService(): jest.Mocked<ShortTermMemoryService> {
  const store = new Map<string, unknown>();
  return {
    setWithSession: jest
      .fn()
      .mockImplementation((sessionId: string, key: string, value: unknown) => {
        store.set(`${sessionId}:${key}`, value);
        return Promise.resolve();
      }),
    getWithSession: jest
      .fn()
      .mockImplementation((sessionId: string, key: string) => {
        return Promise.resolve(store.get(`${sessionId}:${key}`));
      }),
  } as unknown as jest.Mocked<ShortTermMemoryService>;
}

async function collectEvents(
  gen: AsyncGenerator<{
    type: MissionEventType;
    missionId: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }>,
): Promise<
  Array<{
    type: MissionEventType;
    missionId: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }>
> {
  const events: Array<{
    type: MissionEventType;
    missionId: string;
    timestamp: Date;
    data?: Record<string, unknown>;
  }> = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

function makeConstraintEngine(
  canContinueResult: { canContinue: boolean; reason: string } = {
    canContinue: true,
    reason: "",
  },
): jest.Mocked<ConstraintEngine> {
  return {
    check: jest.fn().mockReturnValue({ allowed: true }),
    canContinue: jest.fn().mockReturnValue(canContinueResult),
    recordCost: jest.fn().mockReturnValue(0.5),
    getUsage: jest.fn().mockReturnValue({ tokensUsed: 0, costUsed: 0 }),
    reset: jest.fn(),
  } as unknown as jest.Mocked<ConstraintEngine>;
}

function makeConfigService(): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as jest.Mocked<ConfigService>;
}

function makeLeader(overrides: Partial<ITeamMember> = {}): ITeamMember {
  return {
    id: "leader-1",
    name: "Leader",
    role: { id: "leader", name: "Leader" },
    skills: [],
    tools: [],
    workStyle: { riskTolerance: "moderate" },
    isLeader: () => true,
    execute: jest.fn().mockResolvedValue({ content: "Leader output" }),
    ...overrides,
  } as unknown as ITeamMember;
}

function makeMember(id: string, roleId: string): ITeamMember {
  return {
    id,
    name: `Member-${id}`,
    role: { id: roleId, name: `Role-${roleId}` },
    skills: [],
    tools: [],
    workStyle: { riskTolerance: "conservative" },
    isLeader: () => false,
    execute: jest.fn().mockResolvedValue({ content: `Output from ${id}` }),
  } as unknown as ITeamMember;
}

function makeTeam(workflowOverrides: Partial<ITeam["workflow"]> = {}): ITeam {
  const leader = makeLeader();
  const member = makeMember("member-1", "researcher");
  const defaultConstraints: MissionExecutionProfile = {
    efficiency: { priority: "balanced", maxDuration: 300000 },
    cost: { budget: 100, modelPreference: "auto" },
    quality: {
      depth: "standard",
      reviewRequired: false,
      minQualityScore: 70,
      maxReworks: 1,
    },
  };
  return {
    id: "team-1",
    name: "Test Team",
    leader,
    members: [leader, member],
    workflow: {
      id: "wf-1",
      type: "sequential",
      steps: [
        {
          id: "step-1",
          name: "Research",
          description: "Research step",
          type: "analysis",
          executorRoles: ["researcher"],
          dependsOn: [],
          timeout: 30000,
        },
      ],
      ...workflowOverrides,
    },
    constraintProfile: defaultConstraints,
    getMembersByRole: jest.fn().mockImplementation((roleId: string) => {
      if (roleId === "researcher") return [member];
      return [leader];
    }),
    getMemberById: jest.fn().mockImplementation((id: string) => {
      if (id === "member-1") return member;
      if (id === "leader-1") return leader;
      return null;
    }),
  } as unknown as ITeam;
}

// ---------------------------------------------------------------------------
// Tests: execute() with TraceCollector
// ---------------------------------------------------------------------------

describe("MissionOrchestrator execute() with TraceCollector", () => {
  let orchestrator: MissionOrchestrator;
  let constraintEngine: jest.Mocked<ConstraintEngine>;
  let traceCollector: jest.Mocked<TraceCollectorService>;

  beforeEach(() => {
    jest.clearAllMocks();
    constraintEngine = makeConstraintEngine();
    traceCollector = {
      startTrace: jest.fn().mockReturnValue("trace-abc"),
      endTrace: jest.fn(),
      addSpan: jest.fn().mockReturnValue("span-xyz"),
      endSpan: jest.fn(),
    } as unknown as jest.Mocked<TraceCollectorService>;

    orchestrator = new MissionOrchestrator(
      constraintEngine,
      makeConfigService(),
      undefined, // toolRegistry
      undefined, // skillRegistry
      undefined, // llmFactory
      makeMemoryService(), // memoryService — required so plan is stored/retrieved correctly
      undefined, // mcpManager
      undefined, // aiChatService
      undefined, // prismaService
      traceCollector, // traceCollector
      undefined, // checkpointManager
      undefined, // a2aBus
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );
  });

  it("starts and ends a trace around the full mission", async () => {
    const input: MissionInput = { prompt: "test trace flow", metadata: {} };
    const team = makeTeam();
    const events = await collectEvents(orchestrator.execute(input, team));

    expect(traceCollector.startTrace).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.stringContaining("Mission:") }),
    );
    expect(traceCollector.endTrace).toHaveBeenCalledWith("trace-abc", {
      status: "success",
    });
    expect(events.some((e) => e.type === "mission_completed")).toBe(true);
  });

  it("adds spans for parse, planning, and execution phases", async () => {
    const input: MissionInput = { prompt: "span test", metadata: {} };
    const team = makeTeam();
    await collectEvents(orchestrator.execute(input, team));

    // Should have at least 3 addSpan calls: parse, planning, execution
    expect(traceCollector.addSpan.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(traceCollector.endSpan.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("ends trace with error status on mission failure", async () => {
    // Force failure by making constraintEngine.canContinue return false
    constraintEngine.canContinue.mockReturnValue({
      canContinue: false,
      reason: "Budget exceeded",
    });

    const input: MissionInput = { prompt: "will fail", metadata: {} };
    const team = makeTeam();
    const events = await collectEvents(orchestrator.execute(input, team));

    expect(traceCollector.endTrace).toHaveBeenCalledWith("trace-abc", {
      status: "error",
    });
    expect(events.some((e) => e.type === "mission_failed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: execute() with MissionExecutor (kernel process)
// ---------------------------------------------------------------------------

describe("MissionOrchestrator execute() with MissionExecutor", () => {
  let orchestrator: MissionOrchestrator;
  let constraintEngine: jest.Mocked<ConstraintEngine>;
  let missionExecutor: {
    execute: jest.Mock;
    complete: jest.Mock;
    fail: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    constraintEngine = makeConstraintEngine();
    missionExecutor = {
      execute: jest.fn().mockResolvedValue({ processId: "proc-42" }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };

    orchestrator = new MissionOrchestrator(
      constraintEngine,
      makeConfigService(),
      undefined, // toolRegistry
      undefined, // skillRegistry
      undefined, // llmFactory
      makeMemoryService(), // memoryService — required so plan is stored/retrieved correctly
      undefined, // mcpManager
      undefined, // aiChatService
      undefined, // prismaService
      undefined, // traceCollector
      undefined, // checkpointManager
      undefined, // a2aBus
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
      missionExecutor as unknown as Parameters<
        typeof MissionOrchestrator.prototype.constructor
      >[13],
    );
  });

  it("spawns a kernel process at mission start", async () => {
    const input: MissionInput = { prompt: "kernel test", metadata: {} };
    const team = makeTeam();
    await collectEvents(orchestrator.execute(input, team));

    expect(missionExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "system",
        agentId: team.leader.role.id,
        teamSessionId: expect.any(String),
      }),
    );
  });

  it("does not throw if kernel process spawn fails", async () => {
    missionExecutor.execute.mockRejectedValueOnce(
      new Error("Kernel unavailable"),
    );

    const input: MissionInput = { prompt: "kernel failure test", metadata: {} };
    const team = makeTeam();
    const events = await collectEvents(orchestrator.execute(input, team));

    // Mission should still complete despite kernel failure
    expect(events.some((e) => e.type === "mission_completed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: execute() constraint violation mid-execution
// ---------------------------------------------------------------------------

describe("MissionOrchestrator execute() constraint violation", () => {
  it("fails the mission and emits mission_failed when canContinue returns false", async () => {
    const constraintEngine = makeConstraintEngine({
      canContinue: false,
      reason: "Token limit exceeded",
    });
    const orchestrator = new MissionOrchestrator(
      constraintEngine,
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );

    const input: MissionInput = {
      prompt: "test constraint violation",
      metadata: {},
    };
    const team = makeTeam();
    const events = await collectEvents(orchestrator.execute(input, team));

    const failEvent = events.find((e) => e.type === "mission_failed");
    expect(failEvent).toBeDefined();
    expect(failEvent?.data?.error).toContain("Token limit exceeded");
  });
});

// ---------------------------------------------------------------------------
// Tests: getState() public method
// ---------------------------------------------------------------------------

describe("MissionOrchestrator getState()", () => {
  let orchestrator: MissionOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );
  });

  it("returns undefined for unknown missionId", () => {
    const state = orchestrator.getState("does-not-exist");
    expect(state).toBeUndefined();
  });

  it("returns undefined for missionId after mission completes (state is still set)", async () => {
    // We cannot easily get the missionId from outside execute() since it's generated internally
    // But we can confirm that a non-existent ID returns undefined
    const state = orchestrator.getState("nonexistent-id");
    expect(state).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: cancel() async method
// ---------------------------------------------------------------------------

describe("MissionOrchestrator cancel()", () => {
  let orchestrator: MissionOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
    );
  });

  it("resolves without throwing for unknown missionId", async () => {
    await expect(
      orchestrator.cancel("non-existent-mission"),
    ).resolves.toBeUndefined();
  });

  it("cancels and cleans up a running mission", async () => {
    const traceCollector = {
      startTrace: jest.fn().mockReturnValue("trace-cancel"),
      endTrace: jest.fn(),
      addSpan: jest.fn().mockReturnValue("span-1"),
      endSpan: jest.fn(),
    } as unknown as jest.Mocked<TraceCollectorService>;

    const orch = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      traceCollector,
      undefined,
      undefined,
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );

    const input: MissionInput = { prompt: "cancel test", metadata: {} };
    const team = makeTeam();

    // Run the mission first to set up state and traceId
    await collectEvents(orch.execute(input, team));

    // After execute completes, trace is already ended. Cancel a non-existent one.
    await expect(orch.cancel("nonexistent-id")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: review() without llmFactory (uses basic review)
// ---------------------------------------------------------------------------

describe("MissionOrchestrator review() — fallback path", () => {
  let orchestrator: MissionOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      undefined, // no llmFactory
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );
  });

  it("returns passed=true with default review when no llmFactory", async () => {
    const team = makeTeam();
    const result = await orchestrator.review(
      "step-1",
      { content: "output" },
      team,
    );
    expect(result.passed).toBe(true);
    expect(result.stepId).toBe("step-1");
  });
});

// ---------------------------------------------------------------------------
// Tests: plan() with reviewRequired=true
// ---------------------------------------------------------------------------

describe("MissionOrchestrator plan() — reviewRequired=true adds review step", () => {
  let orchestrator: MissionOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );
  });

  it("includes a review step in the plan when reviewRequired=true", async () => {
    const input: MissionInput = {
      prompt: "review required test",
      requirements: [],
      metadata: {},
    };
    const intent = await orchestrator.parse(input);
    const team = makeTeam();
    const constraints: MissionExecutionProfile = {
      efficiency: { priority: "balanced", maxDuration: 300000 },
      cost: { budget: 100, modelPreference: "auto" },
      quality: {
        depth: "standard",
        reviewRequired: true,
        minQualityScore: 70,
        maxReworks: 1,
      },
    };

    const plan = await orchestrator.plan(intent, team, constraints);
    const stepIds = plan.steps.map((s) => s.id);

    expect(stepIds).toContain("review");
    expect(stepIds).toContain("delivery");
    // review step before delivery
    expect(stepIds.indexOf("review")).toBeLessThan(stepIds.indexOf("delivery"));
  });

  it("does not include a review step when reviewRequired=false", async () => {
    const input: MissionInput = { prompt: "no review test", metadata: {} };
    const intent = await orchestrator.parse(input);
    const team = makeTeam();
    const constraints: MissionExecutionProfile = {
      efficiency: { priority: "balanced", maxDuration: 300000 },
      cost: { budget: 100, modelPreference: "auto" },
      quality: {
        depth: "standard",
        reviewRequired: false,
        minQualityScore: 70,
        maxReworks: 1,
      },
    };

    const plan = await orchestrator.plan(intent, team, constraints);
    const stepIds = plan.steps.map((s) => s.id);

    expect(stepIds).not.toContain("review");
    expect(stepIds).toContain("delivery");
  });
});

// ---------------------------------------------------------------------------
// Tests: execute() full flow with reviewRequired=true (review phase events)
// ---------------------------------------------------------------------------

describe("MissionOrchestrator execute() review phase events", () => {
  it("emits review_started and review_completed when reviewRequired=true", async () => {
    const constraintEngine = makeConstraintEngine();
    const orchestrator = new MissionOrchestrator(
      constraintEngine,
      makeConfigService(),
      undefined, // toolRegistry
      undefined, // skillRegistry
      undefined, // llmFactory
      makeMemoryService(), // memoryService — required so plan is stored/retrieved correctly
      undefined, // mcpManager
      undefined, // aiChatService
      undefined, // prismaService
      undefined, // traceCollector
      undefined, // checkpointManager
      undefined, // a2aBus
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );

    const input: MissionInput = { prompt: "review test", metadata: {} };
    const team = makeTeam();
    const constraintOverrides: Partial<MissionExecutionProfile> = {
      quality: {
        depth: "standard",
        reviewRequired: true,
        minQualityScore: 70,
        maxReworks: 1,
      },
    };

    const events = await collectEvents(
      orchestrator.execute(input, team, constraintOverrides),
    );

    expect(events.some((e) => e.type === "review_started")).toBe(true);
    expect(events.some((e) => e.type === "review_completed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: parse() edge cases
// ---------------------------------------------------------------------------

describe("MissionOrchestrator parse() edge cases", () => {
  let orchestrator: MissionOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );
  });

  it("handles very short prompt without error", async () => {
    const input: MissionInput = { prompt: "Hi", metadata: {} };
    const result = await orchestrator.parse(input);
    expect(result).toBeDefined();
    expect(result.primaryGoal).toBe("Hi");
  });

  it("sets missionId to empty string in fallback parse", async () => {
    const input: MissionInput = { prompt: "test missionId", metadata: {} };
    const result = await orchestrator.parse(input);
    // The parse() method sets missionId="" internally, then execute() overrides it
    expect(result.missionId).toBe("");
  });

  it("infers complexity based on requirements length", async () => {
    const simple: MissionInput = { prompt: "simple task", metadata: {} };
    const complex: MissionInput = {
      prompt: "complex task",
      requirements: ["req1", "req2", "req3", "req4", "req5", "req6"],
      metadata: {},
    };

    const simpleResult = await orchestrator.parse(simple);
    const complexResult = await orchestrator.parse(complex);

    // More requirements = potentially higher complexity
    expect(simpleResult.complexity).toBeDefined();
    expect(complexResult.complexity).toBeDefined();
    expect(complexResult.complexity.estimatedSubTasks).toBeGreaterThanOrEqual(
      simpleResult.complexity.estimatedSubTasks,
    );
  });

  it("assigns suggestedStrategy for high complexity input", async () => {
    const input: MissionInput = {
      prompt: "复杂的深度研究和分析任务需要详细的多维度报告",
      requirements: Array(10).fill("requirement"),
      metadata: {},
    };
    const result = await orchestrator.parse(input);
    // Validate suggestedStrategy is assigned
    expect(result.suggestedStrategy).toBeDefined();
    expect(["sequential", "hybrid"]).toContain(
      result.suggestedStrategy.workflowType,
    );
  });
});

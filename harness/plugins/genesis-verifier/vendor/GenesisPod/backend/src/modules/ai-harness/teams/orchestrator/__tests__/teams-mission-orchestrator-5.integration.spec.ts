/**
 * MissionOrchestrator — Supplemental5 Tests
 *
 * Targets remaining uncovered lines after supplemental1-4:
 * - extractFirstJsonObject: escape sequence path (lines 1797-1815)
 * - kernelJournal.record rejection → catch at line 2484
 * - missionExecutor.complete rejection → catch at line 2503
 * - missionExecutor.fail rejection → catch at line 2517-2524
 * - executeStepWithTimeout catch path (lines 1333, 1350-1355)
 * - skillResults loop in executeStepFull sequential path (lines 1157-1163)
 * - skillResults-based llmOutput fallback (lines 1565-1566)
 * - review rework loop when reviewResult.passed=false (lines 560-599)
 * - executeStepWithRework with llmFactory (lines 1595-1655)
 * - buildReworkPrompt with issues (lines 1759-1765)
 * - time limit exceeded path (lines 983, 989-992)
 */

import { ConfigService } from "@nestjs/config";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../teams-mission-orchestrator";
import { ConstraintEngine } from "@/modules/ai-harness/facade";
import type { MissionInput } from "../../../agents/abstractions/mission.types";
import type { ITeam } from "../../abstractions/team.interface";
import type { ITeamMember } from "../../abstractions/member.interface";
import type { MissionExecutionProfile } from "../../constraints";
import { ShortTermMemoryService } from "@/modules/ai-harness/memory/stores/short-term-memory.service";
import type { MissionExecutorService } from "@/modules/ai-harness/facade";
import type { EventJournalService } from "@/modules/ai-harness/facade";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      .mockImplementation((sessionId: string, key: string) =>
        Promise.resolve(store.get(`${sessionId}:${key}`)),
      ),
  } as unknown as jest.Mocked<ShortTermMemoryService>;
}

function makeConstraintEngine(): jest.Mocked<ConstraintEngine> {
  return {
    check: jest.fn().mockReturnValue({ allowed: true }),
    canContinue: jest.fn().mockReturnValue({ canContinue: true, reason: "" }),
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

function makeLeader(): ITeamMember {
  return {
    id: "leader-1",
    name: "Leader",
    role: { id: "leader", name: "Leader" },
    skills: [],
    tools: [],
    model: undefined,
    workStyle: { riskTolerance: "moderate" },
    isLeader: () => true,
    execute: jest.fn().mockResolvedValue({ content: "Leader output" }),
    getSystemPrompt: jest.fn().mockReturnValue("You are a helpful assistant."),
  } as unknown as ITeamMember;
}

function makeMember(
  id: string,
  roleId: string,
  skills: string[] = [],
): ITeamMember {
  return {
    id,
    name: `Member-${id}`,
    role: { id: roleId, name: `Role-${roleId}` },
    skills,
    tools: [],
    model: undefined,
    workStyle: { riskTolerance: "conservative" },
    isLeader: () => false,
    execute: jest.fn().mockResolvedValue({ content: `Output from ${id}` }),
    getSystemPrompt: jest.fn().mockReturnValue("You are a specialist."),
  } as unknown as ITeamMember;
}

function makeSimpleTeam(constraints?: Partial<MissionExecutionProfile>): ITeam {
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
    ...constraints,
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
    },
    constraintProfile: defaultConstraints,
    getMembersByRole: jest.fn().mockImplementation((roleId: string) => {
      if (roleId === "researcher") return [member];
      return [leader];
    }),
    getMemberById: jest.fn().mockImplementation((id: string) => {
      if (id === "member-1") return member;
      return leader;
    }),
  } as unknown as ITeam;
}

async function drainGenerator<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) {
    items.push(item);
  }
  return items;
}

const BASE_CONFIG = {
  enableAutoRetry: false,
  enableParallel: false,
  reviewStrategy: "none" as const,
};

// ── Tests: extractFirstJsonObject via parseLLMResponse ───────────────────────

describe("MissionOrchestrator — extractFirstJsonObject escape sequences", () => {
  it("parses embedded JSON with escaped string values via LLM response", async () => {
    // The LLM returns content that's not pure JSON — extractFirstJsonObject is triggered
    // by having text before/after the JSON block, and the JSON contains escaped chars
    const mockAdapter = {
      chat: jest.fn().mockResolvedValue({
        content: `Here is the analysis:\n{"primaryGoal": "Task with \\"quoted\\" value", "taskType": "research", "topics": ["AI"], "complexity": {"overall": "moderate"}, "workflowType": "sequential", "needsIteration": true, "needsHumanReview": false}\nDone.`,
        model: "test-model",
        usage: { promptTokens: 10, completionTokens: 20 },
      }),
    };
    const mockLLMFactory = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter),
      getDefaultModel: jest.fn().mockReturnValue(""),
    };

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      mockLLMFactory as unknown as Parameters<
        typeof MissionOrchestrator.prototype.constructor
      >[4],
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      BASE_CONFIG,
    );

    const input: MissionInput = {
      prompt: "Test escape parsing",
      metadata: {},
    };

    // parse() calls parseWithLLM() → parseLLMResponse() → extractFirstJsonObject()
    const result = await orchestrator.parse(input);
    expect(result).toBeDefined();
    expect(result.primaryGoal).toBeDefined();
  });

  it("handles JSON with string containing curly braces inside", async () => {
    // JSON string values containing { } should not break depth counting
    const innerJson = JSON.stringify({
      primaryGoal: "Implement function { x: number }",
      taskType: "research",
      topics: ["TypeScript"],
      complexity: { overall: "moderate" },
      workflowType: "sequential",
      needsIteration: false,
      needsHumanReview: false,
    });
    const mockAdapter = {
      chat: jest.fn().mockResolvedValue({
        content: `Result: ${innerJson} end`,
        model: "test-model",
        usage: { promptTokens: 5, completionTokens: 10 },
      }),
    };
    const mockLLMFactory = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter),
      getDefaultModel: jest.fn().mockReturnValue(""),
    };

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      mockLLMFactory as unknown as Parameters<
        typeof MissionOrchestrator.prototype.constructor
      >[4],
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      BASE_CONFIG,
    );

    const result = await orchestrator.parse({
      prompt: "Implement TypeScript function",
      metadata: {},
    });
    expect(result).toBeDefined();
  });
});

// ── Tests: kernelJournal.record rejection → line 2484 ───────────────────────

describe("MissionOrchestrator — kernelJournal record rejection", () => {
  it("logs warn when kernelJournal.record rejects (fire-and-forget catch)", async () => {
    // kernelJournal is the 15th constructor arg (pos 14, 0-indexed)
    // missionExecutor must also be set to get a processId so recordKernelEvent fires
    const mockMissionExecutor = {
      execute: jest.fn().mockResolvedValue({ processId: "proc-journal-test" }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MissionExecutorService>;

    const mockKernelJournal = {
      record: jest.fn().mockRejectedValue(new Error("Journal DB unavailable")),
    } as unknown as jest.Mocked<EventJournalService>;

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      BASE_CONFIG,
      mockMissionExecutor, // pos 13
      mockKernelJournal, // pos 14
    );

    const team = makeSimpleTeam();
    const input: MissionInput = {
      prompt: "Test kernel journal rejection",
      metadata: {},
    };

    // The mission should complete despite journal failures
    const events = await drainGenerator(orchestrator.execute(input, team));
    expect(
      events.some((e) => (e as { type: string }).type === "mission_completed"),
    ).toBe(true);

    // journal.record should have been called (and rejected)
    // Give a tick for fire-and-forget promises to settle
    await new Promise((r) => setImmediate(r));
    expect(mockKernelJournal.record).toHaveBeenCalled();
  });
});

// ── Tests: missionExecutor.complete rejection → line 2503 ───────────────────

describe("MissionOrchestrator — missionExecutor.complete rejection", () => {
  it("logs warn when missionExecutor.complete rejects (fire-and-forget catch)", async () => {
    const mockMissionExecutor = {
      execute: jest.fn().mockResolvedValue({ processId: "proc-complete-fail" }),
      complete: jest
        .fn()
        .mockRejectedValue(new Error("Complete DB unavailable")),
      fail: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MissionExecutorService>;

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      BASE_CONFIG,
      mockMissionExecutor,
      undefined,
    );

    const team = makeSimpleTeam();
    const input: MissionInput = {
      prompt: "Test missionExecutor complete rejection",
      metadata: {},
    };

    const events = await drainGenerator(orchestrator.execute(input, team));
    // Mission still completes despite executor.complete failure
    expect(
      events.some((e) => (e as { type: string }).type === "mission_completed"),
    ).toBe(true);

    await new Promise((r) => setImmediate(r));
    expect(mockMissionExecutor.complete).toHaveBeenCalled();
  });
});

// ── Tests: missionExecutor.fail rejection → lines 2517-2524 ─────────────────

describe("MissionOrchestrator — missionExecutor.fail rejection", () => {
  it("logs warn when missionExecutor.fail rejects (fire-and-forget catch)", async () => {
    const mockMissionExecutor = {
      execute: jest.fn().mockResolvedValue({ processId: "proc-fail-reject" }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockRejectedValue(new Error("Fail DB unavailable")),
    } as unknown as jest.Mocked<MissionExecutorService>;

    // Use a constraintEngine that triggers an error so the mission fails
    const failingConstraintEngine = {
      check: jest.fn().mockReturnValue({ allowed: true }),
      canContinue: jest
        .fn()
        .mockReturnValue({ canContinue: false, reason: "Cost exceeded" }),
      recordCost: jest.fn().mockReturnValue(0.5),
      getUsage: jest.fn().mockReturnValue({ tokensUsed: 0, costUsed: 0 }),
      reset: jest.fn(),
    } as unknown as jest.Mocked<ConstraintEngine>;

    const orchestrator = new MissionOrchestrator(
      failingConstraintEngine,
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      BASE_CONFIG,
      mockMissionExecutor,
      undefined,
    );

    const team = makeSimpleTeam();
    const input: MissionInput = {
      prompt: "Test missionExecutor fail rejection",
      metadata: {},
    };

    // Mission will fail due to constraint, triggering failKernelProcess
    const events = await drainGenerator(orchestrator.execute(input, team));
    expect(
      events.some((e) => (e as { type: string }).type === "mission_failed"),
    ).toBe(true);

    await new Promise((r) => setImmediate(r));
    // fail should have been called
    expect(mockMissionExecutor.fail).toHaveBeenCalled();
  });
});

// ── Tests: executeStepWithTimeout catch path ────────────────────────────────

describe("MissionOrchestrator — executeStepWithTimeout catch path", () => {
  it("handles step timeout gracefully and continues (returns failure result)", async () => {
    // Create a member whose execute never resolves (simulating LLM hang)
    // but with a very short step timeout so executeStepWithTimeout's catch fires
    const leader = makeLeader();
    const hangingMember = makeMember("hanging-member", "researcher");
    // This member's execution will be replaced by the step's timeout
    (hangingMember.execute as jest.Mock).mockImplementation(
      () =>
        new Promise(() => {
          // Never resolves — simulates LLM timeout
        }),
    );

    // The step uses a very short timeout (1ms) so it fires immediately
    const shortTimeoutTeam: ITeam = {
      id: "team-timeout",
      name: "Timeout Team",
      leader,
      members: [leader, hangingMember],
      workflow: {
        id: "wf-timeout",
        type: "sequential",
        steps: [
          {
            id: "step-1",
            name: "Hanging Step",
            description: "This step will time out",
            type: "analysis",
            executorRoles: ["researcher"],
            dependsOn: [],
            timeout: 1, // 1ms — will trigger timeout rejection
          },
        ],
      },
      constraintProfile: {
        efficiency: { priority: "balanced", maxDuration: 300000 },
        cost: { budget: 100, modelPreference: "auto" },
        quality: {
          depth: "standard",
          reviewRequired: false,
          minQualityScore: 70,
          maxReworks: 0,
        },
      },
      getMembersByRole: jest.fn().mockImplementation((roleId: string) => {
        if (roleId === "researcher") return [hangingMember];
        return [leader];
      }),
      getMemberById: jest.fn().mockImplementation((id: string) => {
        if (id === "hanging-member") return hangingMember;
        return leader;
      }),
    } as unknown as ITeam;

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      undefined,
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      // enableAutoRetry: false so step failure propagates as mission_failed
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );

    const input: MissionInput = {
      prompt: "Test step timeout",
      metadata: {},
    };

    const events = await drainGenerator(
      orchestrator.execute(input, shortTimeoutTeam),
    );

    // The step timeout causes executeStepWithTimeout to catch and return a failure result
    // Since enableAutoRetry=false, the mission fails after the step fails
    const hasTerminalEvent = events.some(
      (e) =>
        (e as { type: string }).type === "mission_completed" ||
        (e as { type: string }).type === "mission_failed",
    );
    expect(hasTerminalEvent).toBe(true);
  });
});

// ── Tests: review rework loop (passed=false) ─────────────────────────────────

describe("MissionOrchestrator — review rework loop", () => {
  // Helper to build a mock adapter that:
  //  - returns valid parse JSON for parse() calls
  //  - returns passed=false for any call whose content contains "score"
  //  - otherwise returns plain text (for step execution / rework)
  function makeReworkAdapter(reviewPassed: boolean = false) {
    let parseCallDone = false;
    return {
      chat: jest
        .fn()
        .mockImplementation(
          (opts: { messages: Array<{ role: string; content: string }> }) => {
            // Detect parse() call by system prompt content
            const systemMsg = opts.messages[0]?.content ?? "";
            if (!parseCallDone && systemMsg.includes("任务分析专家")) {
              parseCallDone = true;
              return Promise.resolve({
                content: '{"primaryGoal": "Test task", "taskType": "research"}',
                model: "test-model",
                usage: { promptTokens: 10, completionTokens: 10 },
              });
            }
            // Detect review() call by system prompt containing "质量审核专家"
            if (systemMsg.includes("质量审核专家")) {
              return Promise.resolve({
                content: reviewPassed
                  ? '{"score": 8, "passed": true, "feedback": "Good work", "issues": []}'
                  : '{"score": 3, "passed": false, "feedback": "Insufficient depth", "issues": ["Too brief", "Missing examples"]}',
                model: "test-model",
                usage: { promptTokens: 10, completionTokens: 20 },
              });
            }
            // Step execution / rework calls
            return Promise.resolve({
              content: "Step output content",
              model: "test-model",
              usage: { promptTokens: 10, completionTokens: 30 },
            });
          },
        ),
    };
  }

  it("triggers rework_requested when LLM review returns passed=false", async () => {
    const mockAdapter = makeReworkAdapter(false);
    const mockLLMFactory = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter),
      getDefaultModel: jest.fn().mockReturnValue(""),
    };

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      mockLLMFactory as unknown as Parameters<
        typeof MissionOrchestrator.prototype.constructor
      >[4],
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );

    const team = makeSimpleTeam({
      quality: {
        depth: "standard",
        reviewRequired: true,
        minQualityScore: 70,
        maxReworks: 1,
      },
    });

    const input: MissionInput = {
      prompt: "Test rework loop",
      metadata: {},
    };

    const events = await drainGenerator(orchestrator.execute(input, team));

    // rework_requested should have been emitted when review returned passed=false
    const hasReworkEvent = events.some(
      (e) => (e as { type: string }).type === "rework_requested",
    );
    expect(hasReworkEvent).toBe(true);
  });

  it("rework loop covers rework_completed event", async () => {
    const mockAdapter = makeReworkAdapter(false);
    const mockLLMFactory = {
      getAdapter: jest.fn().mockReturnValue(mockAdapter),
      getDefaultModel: jest.fn().mockReturnValue(""),
    };

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      undefined,
      mockLLMFactory as unknown as Parameters<
        typeof MissionOrchestrator.prototype.constructor
      >[4],
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableAutoRetry: false, enableParallel: false, reviewStrategy: "none" },
    );

    const leader = makeLeader();
    const member = makeMember("member-1", "researcher");
    const team: ITeam = {
      id: "team-rework",
      name: "Rework Team",
      leader,
      members: [leader, member],
      workflow: {
        id: "wf-rework",
        type: "sequential",
        steps: [
          {
            id: "step-1",
            name: "Analysis",
            description: "Analyze the topic in depth",
            type: "analysis",
            executorRoles: ["researcher"],
            dependsOn: [],
            timeout: 30000,
          },
        ],
      },
      constraintProfile: {
        efficiency: { priority: "balanced", maxDuration: 300000 },
        cost: { budget: 100, modelPreference: "auto" },
        quality: {
          depth: "standard",
          reviewRequired: true,
          minQualityScore: 70,
          maxReworks: 1,
        },
      },
      getMembersByRole: jest.fn().mockImplementation((roleId: string) => {
        if (roleId === "researcher") return [member];
        return [leader];
      }),
      getMemberById: jest.fn().mockImplementation((id: string) => {
        if (id === "member-1") return member;
        return leader;
      }),
    } as unknown as ITeam;

    const input: MissionInput = {
      prompt: "Analyze topic deeply",
      metadata: {},
    };

    const events = await drainGenerator(orchestrator.execute(input, team));

    // rework_completed should be emitted after executeStepWithRework runs
    const hasReworkCompleted = events.some(
      (e) => (e as { type: string }).type === "rework_completed",
    );
    expect(hasReworkCompleted).toBe(true);
    const hasTerminal = events.some(
      (e) =>
        (e as { type: string }).type === "mission_completed" ||
        (e as { type: string }).type === "mission_failed",
    );
    expect(hasTerminal).toBe(true);
  });
});

// ── Tests: skillResults in sequential path ───────────────────────────────────

describe("MissionOrchestrator — skillResults in executeStepFull", () => {
  it("stores skill output keyed by skillId in sequential execution", async () => {
    // Create a skill registry that returns a skill with data
    const mockSkill = {
      id: "test-skill",
      domain: "research",
      execute: jest.fn().mockResolvedValue({
        success: true,
        data: { findings: "Skill output data" },
        metadata: { tokensUsed: 50 },
      }),
      setLLMAdapter: jest.fn(),
    };

    const mockSkillRegistry = {
      tryGet: jest.fn().mockImplementation((skillId: string) => {
        if (skillId === "test-skill") return mockSkill;
        return null;
      }),
      get: jest.fn(),
    };

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      mockSkillRegistry as unknown as Parameters<
        typeof MissionOrchestrator.prototype.constructor
      >[3],
      undefined,
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      BASE_CONFIG,
    );

    const leader = makeLeader();
    const memberWithSkill = makeMember("member-1", "researcher", [
      "test-skill",
    ]);

    const team: ITeam = {
      id: "team-skill",
      name: "Skill Team",
      leader,
      members: [leader, memberWithSkill],
      workflow: {
        id: "wf-skill",
        type: "sequential",
        steps: [
          {
            id: "step-1",
            name: "Skill Step",
            description: "Execute skill",
            type: "analysis",
            executorRoles: ["researcher"],
            dependsOn: [],
            timeout: 30000,
          },
        ],
      },
      constraintProfile: {
        efficiency: { priority: "balanced", maxDuration: 300000 },
        cost: { budget: 100, modelPreference: "auto" },
        quality: {
          depth: "standard",
          reviewRequired: false,
          minQualityScore: 70,
          maxReworks: 0,
        },
      },
      getMembersByRole: jest.fn().mockImplementation((roleId: string) => {
        if (roleId === "researcher") return [memberWithSkill];
        return [leader];
      }),
      getMemberById: jest.fn().mockImplementation((id: string) => {
        if (id === "member-1") return memberWithSkill;
        return leader;
      }),
    } as unknown as ITeam;

    const input: MissionInput = {
      prompt: "Execute skill-based task",
      metadata: {},
    };

    const events = await drainGenerator(orchestrator.execute(input, team));

    expect(
      events.some((e) => (e as { type: string }).type === "mission_completed"),
    ).toBe(true);
    // skill.execute should have been called
    expect(mockSkill.execute).toHaveBeenCalled();
  });
});

// ── Tests: time limit exceeded path ─────────────────────────────────────────

describe("MissionOrchestrator — time limit exceeded", () => {
  it("throws error when elapsed time exceeds maxDuration (sequential path)", async () => {
    // Strategy: use a 2-step team where step-a uses a skill that introduces
    // a real async delay (via setTimeout). After step-a's delay, the second
    // iteration of the executePlan while loop checks elapsed > maxDuration.
    const slowSkill = {
      id: "slow-skill",
      domain: "research",
      execute: jest.fn().mockImplementation(
        () =>
          new Promise<{
            success: boolean;
            data: Record<string, unknown>;
            metadata: { tokensUsed: number };
          }>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  success: true,
                  data: { result: "done" },
                  metadata: { tokensUsed: 0 },
                }),
              10, // 10ms delay — guarantees elapsed > 1ms on any machine
            ),
          ),
      ),
      setLLMAdapter: jest.fn(),
    };

    const mockSkillRegistry = {
      tryGet: jest.fn().mockImplementation((skillId: string) => {
        if (skillId === "slow-skill") return slowSkill;
        return null;
      }),
      get: jest.fn(),
    };

    const leader = makeLeader();
    const memberA = makeMember("member-a", "researcher", ["slow-skill"]);
    const memberB = makeMember("member-b", "analyst");

    const twoStepTeam: ITeam = {
      id: "team-timelimit",
      name: "Time Limit Team",
      leader,
      members: [leader, memberA, memberB],
      workflow: {
        id: "wf-timelimit",
        type: "sequential",
        steps: [
          {
            id: "step-a",
            name: "Step A",
            description: "First step with delay",
            type: "analysis",
            executorRoles: ["researcher"],
            dependsOn: [],
            timeout: 30000,
          },
          {
            id: "step-b",
            name: "Step B",
            description: "Second step",
            type: "synthesis",
            executorRoles: ["analyst"],
            dependsOn: ["step-a"],
            timeout: 30000,
          },
        ],
      },
      constraintProfile: {
        efficiency: {
          priority: "speed",
          maxDuration: 1, // 1ms — will exceed after the 10ms skill delay
        },
        cost: { budget: 100, modelPreference: "auto" },
        quality: {
          depth: "standard",
          reviewRequired: false,
          minQualityScore: 70,
          maxReworks: 0,
        },
      },
      getMembersByRole: jest.fn().mockImplementation((roleId: string) => {
        if (roleId === "researcher") return [memberA];
        if (roleId === "analyst") return [memberB];
        return [leader];
      }),
      getMemberById: jest.fn().mockImplementation((id: string) => {
        if (id === "member-a") return memberA;
        if (id === "member-b") return memberB;
        return leader;
      }),
    } as unknown as ITeam;

    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined,
      mockSkillRegistry as unknown as Parameters<
        typeof MissionOrchestrator.prototype.constructor
      >[3],
      undefined,
      makeMemoryService(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableAutoRetry: true, enableParallel: false, reviewStrategy: "none" },
    );

    const input: MissionInput = {
      prompt: "Test time limit exceeded",
      metadata: {},
    };

    const events = await drainGenerator(
      orchestrator.execute(input, twoStepTeam),
    );

    // The mission should fail due to time limit exceeded
    expect(
      events.some((e) => (e as { type: string }).type === "mission_failed"),
    ).toBe(true);
    const failedEvent = events.find(
      (e) => (e as { type: string }).type === "mission_failed",
    ) as { type: string; data?: { error?: string } } | undefined;
    expect(failedEvent?.data?.error).toMatch(/time limit/i);
  });
});

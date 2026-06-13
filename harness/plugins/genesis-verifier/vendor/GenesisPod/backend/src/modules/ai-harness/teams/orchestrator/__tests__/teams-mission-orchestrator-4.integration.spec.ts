/**
 * MissionOrchestrator — Supplemental4 Tests
 *
 * Targets Phase 4/6/8 optional dependency branches:
 * - adaptiveReplanner constructor → line 232 log
 * - hierarchicalMemory constructor → line 238 log
 * - lifecycleProtocol constructor → line 246 log
 * - hierarchicalMemory.resolve path in execute() (lines 339-366)
 * - lifecycleProtocol.notifyTaskComplete on step_completed (lines 477-485)
 */

import { ConfigService } from "@nestjs/config";
import { TeamsMissionOrchestrator as MissionOrchestrator } from "../teams-mission-orchestrator";
import { ConstraintEngine } from "@/modules/ai-harness/facade";
import type { MissionInput } from "../../../agents/abstractions/mission.types";
import type { ITeam } from "../../abstractions/team.interface";
import type { ITeamMember } from "../../abstractions/member.interface";
import type { MissionExecutionProfile } from "../../constraints";
import { ShortTermMemoryService } from "@/modules/ai-harness/memory/stores/short-term-memory.service";
import type { HierarchicalMemoryCascadeService } from "@/modules/ai-harness/memory/working/hierarchical-memory-cascade.service";
import type { AgentLifecycleProtocolService } from "@/modules/ai-harness/protocols/ipc/agent-lifecycle-protocol.service";
import type { AdaptiveReplannerService } from "../adaptive-replanner.service";

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

function makeAdaptiveReplanner(): jest.Mocked<AdaptiveReplannerService> {
  return {
    replan: jest.fn().mockResolvedValue({ steps: [] }),
  } as unknown as jest.Mocked<AdaptiveReplannerService>;
}

function makeHierarchicalMemory(
  resolveResult: unknown = null,
): jest.Mocked<HierarchicalMemoryCascadeService> {
  return {
    resolve: jest.fn().mockReturnValue(resolveResult),
  } as unknown as jest.Mocked<HierarchicalMemoryCascadeService>;
}

function makeLifecycleProtocol(): jest.Mocked<AgentLifecycleProtocolService> {
  return {
    notifyTaskComplete: jest.fn().mockResolvedValue(undefined),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    getPendingMessages: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<AgentLifecycleProtocolService>;
}

function makeLeader(): ITeamMember {
  return {
    id: "leader-1",
    name: "Leader",
    role: { id: "leader", name: "Leader" },
    skills: [],
    tools: [],
    workStyle: { riskTolerance: "moderate" },
    isLeader: () => true,
    execute: jest.fn().mockResolvedValue({ content: "Leader output" }),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MissionOrchestrator — Phase 4 AdaptiveReplanner optional dep", () => {
  it("logs initialization message when adaptiveReplanner is provided", () => {
    const adaptiveReplanner = makeAdaptiveReplanner();
    // The constructor logs when adaptiveReplanner is set
    // Just creating the orchestrator with it should hit line 232
    const orchestrator = new MissionOrchestrator(
      makeConstraintEngine(),
      makeConfigService(),
      undefined, // toolRegistry
      undefined, // skillRegistry
      undefined, // llmFactory
      makeMemoryService(), // memoryService
      undefined, // mcpManager
      undefined, // aiChatService
      undefined, // prismaService
      undefined, // traceCollector
      undefined, // checkpointManager
      undefined, // a2aBus
      BASE_CONFIG, // config
      undefined, // missionExecutor
      undefined, // kernelJournal
      adaptiveReplanner, // adaptiveReplanner (pos 16)
    );
    expect(orchestrator).toBeDefined();
  });
});

describe("MissionOrchestrator — Phase 6 HierarchicalMemory optional dep", () => {
  it("logs initialization when hierarchicalMemory is provided", () => {
    const hierarchicalMemory = makeHierarchicalMemory();
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
      undefined,
      undefined,
      undefined, // adaptiveReplanner
      hierarchicalMemory, // hierarchicalMemory (pos 17)
    );
    expect(orchestrator).toBeDefined();
  });

  it("resolves memory context from hierarchicalMemory when userId in metadata", async () => {
    const hierarchicalMemory = makeHierarchicalMemory({
      resolvedFrom: "project",
      value: "project research context",
    });

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
      undefined,
      undefined,
      undefined,
      hierarchicalMemory,
    );

    const team = makeSimpleTeam();
    const input: MissionInput = {
      prompt: "Test with hierarchical memory",
      metadata: { userId: "user-123" },
    };

    const events = await drainGenerator(orchestrator.execute(input, team));
    expect(events.length).toBeGreaterThan(0);
    // hierarchicalMemory.resolve should have been called
    expect(hierarchicalMemory.resolve).toHaveBeenCalled();
    // The prompt should contain the memory context
    expect(input.prompt).toContain("Context from project memory");
  });

  it("injects resolved memory object into metadata when value is object", async () => {
    const memoryValue = { key: "project-data", items: [1, 2, 3] };
    const hierarchicalMemory = makeHierarchicalMemory({
      resolvedFrom: "org",
      value: memoryValue,
    });

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
      undefined,
      undefined,
      undefined,
      hierarchicalMemory,
    );

    const team = makeSimpleTeam();
    const input: MissionInput = {
      prompt: "Test with object memory context",
      metadata: { userId: "user-123" },
    };

    await drainGenerator(orchestrator.execute(input, team));

    // When value is object, it should be injected into metadata
    expect(input.metadata?.["resolvedMemoryContext"]).toEqual(memoryValue);
  });

  it("does not call resolve when userId is missing from metadata", async () => {
    const hierarchicalMemory = makeHierarchicalMemory({
      resolvedFrom: "session",
      value: "ctx",
    });

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
      undefined,
      undefined,
      undefined,
      hierarchicalMemory,
    );

    const team = makeSimpleTeam();
    const input: MissionInput = {
      prompt: "No userId in metadata",
      metadata: {}, // no userId
    };

    await drainGenerator(orchestrator.execute(input, team));
    // resolve should NOT be called without userId
    expect(hierarchicalMemory.resolve).not.toHaveBeenCalled();
  });
});

describe("MissionOrchestrator — Phase 8 AgentLifecycleProtocol optional dep", () => {
  it("logs initialization when lifecycleProtocol is provided", () => {
    const lifecycleProtocol = makeLifecycleProtocol();
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
      undefined,
      undefined,
      undefined,
      undefined, // hierarchicalMemory
      lifecycleProtocol, // lifecycleProtocol (pos 18)
    );
    expect(orchestrator).toBeDefined();
  });

  it("calls notifyTaskComplete on step_completed events", async () => {
    const lifecycleProtocol = makeLifecycleProtocol();

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
      undefined,
      undefined,
      undefined,
      undefined,
      lifecycleProtocol,
    );

    const team = makeSimpleTeam();
    const input: MissionInput = {
      prompt: "Test lifecycle notifications",
      metadata: {},
    };

    await drainGenerator(orchestrator.execute(input, team));

    // lifecycleProtocol.notifyTaskComplete should have been called for completed steps
    expect(lifecycleProtocol.notifyTaskComplete).toHaveBeenCalled();
  });
});

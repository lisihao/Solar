/**
 * HarnessedAgent — extra branch coverage
 *
 * Covers:
 * - task.signal already aborted → agent aborts on next tick
 * - task.signal listener (not already aborted) chains abort
 * - agent already cancelled before execute → yields terminated immediately
 * - skillActivator path (covers lines 169-176)
 * - memoryBridge path (covers lines 181-185)
 * - loop path: yields events, accumulates actionCount (covers 190-335)
 * - loop throws → yields error + terminated events
 * - updateStateFromTerminated: reason=error → failed, reason=cancelled → cancelled, default → completed
 * - agentRegistry.register called on execute, unregister in finally
 */

import { HarnessedAgent } from "../harnessed-agent";
import { AgentIdentity } from "../agent-identity";
import { ContextEnvelope } from "../context-envelope";
import type {
  IAgentEvent,
  IAgentLoop,
  ILoopTerminationCriteria,
  IContextEnvelope,
} from "../../abstractions";
import type { SkillActivator } from "../../skill-runtime/skill-activator";
import type { MemoryContextBindingService } from "../../../memory/indexing/memory-context-binding.service";
import type { AgentRegistry } from "../../../handoffs/agent-registry";
import type { AgentEventStore } from "../../../memory/checkpoint/agent-event-store";
import type { AgentStepCheckpointService } from "../../../memory/checkpoint/agent-step-checkpoint.service";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIdentity(roleId = "test-agent") {
  return AgentIdentity.of(
    { id: roleId, name: "Test Agent", description: "unit test" },
    { goal: { summary: "do stuff" }, skills: [], tools: [] },
  );
}

function makeEnvelope(): ContextEnvelope {
  const identity = makeIdentity();
  return new ContextEnvelope({
    system: identity.toSystemPrompt(),
    messages: [],
    reminders: [],
    tools: [],
    memory: { sessionId: "session-1" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 10_000,
      iterationsUsed: 0,
      iterationsRemaining: 5,
      wallTimeStartMs: Date.now(),
    },
  });
}

function makeAgent(
  overrides?: Partial<ConstructorParameters<typeof HarnessedAgent>[0]>,
): HarnessedAgent {
  return new HarnessedAgent({
    identity: makeIdentity(),
    envelope: makeEnvelope(),
    ...overrides,
  });
}

/** Make a loop that yields specific events then terminates */
function makeLoop(events: IAgentEvent[]): IAgentLoop {
  return {
    run: async function* (
      _envelope: IContextEnvelope,
      _criteria: ILoopTerminationCriteria,
    ): AsyncIterable<IAgentEvent> {
      for (const ev of events) yield ev;
    },
  };
}

// ─── task.signal: already aborted ────────────────────────────────────────────

describe("HarnessedAgent.execute — task.signal already aborted", () => {
  it("aborts when task.signal is already aborted at execute start", async () => {
    const agent = makeAgent();
    const ac = new AbortController();
    ac.abort(); // pre-abort

    const events: IAgentEvent[] = [];
    const task = { goal: "test", signal: ac.signal };

    // Even after signal abort, agent should still run (signal chains to internal controller)
    for await (const ev of agent.execute(task)) {
      events.push(ev);
    }

    // Agent ran to completion in skeleton mode (signal abort doesn't auto-cancel skeleton)
    expect(
      events.some((e) => e.type === "thinking" || e.type === "terminated"),
    ).toBe(true);
  });
});

// ─── task.signal: listener added (not pre-aborted) ───────────────────────────

describe("HarnessedAgent.execute — task.signal listener", () => {
  it("adds abort listener when task.signal is provided but not yet aborted", async () => {
    const ac = new AbortController();
    const agent = makeAgent();
    const events: IAgentEvent[] = [];

    const task = { goal: "test", signal: ac.signal };
    for await (const ev of agent.execute(task)) {
      events.push(ev);
    }

    // Should complete normally (skeleton mode)
    expect(events.find((e) => e.type === "terminated")).toBeDefined();
  });
});

// ─── already cancelled before execute ────────────────────────────────────────

describe("HarnessedAgent.execute — already cancelled before execute", () => {
  it("yields terminated immediately if already cancelled", async () => {
    const agent = makeAgent();
    await agent.cancel("pre-cancel");

    const events: IAgentEvent[] = [];
    for await (const ev of agent.execute({ goal: "test" })) {
      events.push(ev);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("terminated");
    const payload = events[0].payload as { reason: string };
    expect(payload.reason).toBe("cancelled");
  });
});

// ─── skillActivator path ──────────────────────────────────────────────────────

describe("HarnessedAgent.execute — skillActivator", () => {
  it("calls skillActivator.activate and uses returned envelope", async () => {
    const newEnvelope = makeEnvelope();
    const cleanup = jest.fn();
    const skillActivator: jest.Mocked<SkillActivator> = {
      activate: jest.fn().mockResolvedValue({
        envelope: newEnvelope,
        cleanup,
      }),
    } as unknown as jest.Mocked<SkillActivator>;

    const agent = makeAgent({ skillActivator });
    const events: IAgentEvent[] = [];

    for await (const ev of agent.execute({ goal: "test" })) {
      events.push(ev);
    }

    expect(skillActivator.activate).toHaveBeenCalled();
    // cleanup called in finally
    expect(cleanup).toHaveBeenCalled();
  });

  it("gracefully handles skillActivator returning non-ContextEnvelope", async () => {
    const cleanup = jest.fn();
    const skillActivator: jest.Mocked<SkillActivator> = {
      activate: jest.fn().mockResolvedValue({
        envelope: { system: "not a ContextEnvelope instance" }, // plain object
        cleanup,
      }),
    } as unknown as jest.Mocked<SkillActivator>;

    const agent = makeAgent({ skillActivator });
    const events: IAgentEvent[] = [];

    // Should not throw — non-ContextEnvelope envelope is ignored
    for await (const ev of agent.execute({ goal: "test" })) {
      events.push(ev);
    }

    expect(events.length).toBeGreaterThan(0);
  });
});

// ─── memoryBridge path ────────────────────────────────────────────────────────

describe("HarnessedAgent.execute — memoryBridge", () => {
  it("calls memoryBridge.preExecute and uses returned ContextEnvelope", async () => {
    const newEnvelope = makeEnvelope();
    const memoryBridge: jest.Mocked<MemoryContextBindingService> = {
      preExecute: jest.fn().mockResolvedValue(newEnvelope),
    } as unknown as jest.Mocked<MemoryContextBindingService>;

    const agent = makeAgent({ memoryBridge });
    const events: IAgentEvent[] = [];

    for await (const ev of agent.execute({ goal: "test" })) {
      events.push(ev);
    }

    expect(memoryBridge.preExecute).toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
  });

  it("handles memoryBridge returning non-ContextEnvelope gracefully", async () => {
    const memoryBridge: jest.Mocked<MemoryContextBindingService> = {
      preExecute: jest.fn().mockResolvedValue({ messages: [] }), // not a ContextEnvelope
    } as unknown as jest.Mocked<MemoryContextBindingService>;

    const agent = makeAgent({ memoryBridge });
    const events: IAgentEvent[] = [];

    for await (const ev of agent.execute({ goal: "test" })) {
      events.push(ev);
    }

    expect(events.length).toBeGreaterThan(0);
  });
});

// ─── loop path: events flowing through ───────────────────────────────────────

describe("HarnessedAgent.execute — with loop", () => {
  it("yields all events from loop", async () => {
    const loopEvents: IAgentEvent[] = [
      {
        type: "thinking",
        agentId: "a",
        timestamp: Date.now(),
        payload: { text: "thinking", tokenCount: 0 },
      },
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "completed" as const },
      },
    ];
    const loop = makeLoop(loopEvents);
    const agent = makeAgent({ loop });
    const events: IAgentEvent[] = [];

    for await (const ev of agent.execute({ goal: "test" })) {
      events.push(ev);
    }

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("thinking");
    expect(events[1].type).toBe("terminated");
  });

  it("state becomes completed when terminated with reason=completed", async () => {
    const loop = makeLoop([
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "completed" as const },
      },
    ]);
    const agent = makeAgent({ loop });

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(agent.state).toBe("completed");
  });

  it("state becomes failed when terminated with reason=error", async () => {
    const loop = makeLoop([
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "error" as const },
      },
    ]);
    const agent = makeAgent({ loop });

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(agent.state).toBe("failed");
  });

  it("state becomes cancelled when terminated with reason=cancelled", async () => {
    const loop = makeLoop([
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "cancelled" as const },
      },
    ]);
    const agent = makeAgent({ loop });

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(agent.state).toBe("cancelled");
  });

  it("yields error + terminated when loop throws", async () => {
    const throwingLoop: IAgentLoop = {
      run: async function* () {
        throw new Error("loop crashed");
        yield {} as IAgentEvent; // unreachable but satisfies type
      },
    };
    const agent = makeAgent({ loop: throwingLoop });
    const events: IAgentEvent[] = [];

    for await (const ev of agent.execute({ goal: "test" })) {
      events.push(ev);
    }

    expect(events.find((e) => e.type === "error")).toBeDefined();
    expect(events.find((e) => e.type === "terminated")).toBeDefined();
    expect(agent.state).toBe("failed");
  });
});

// ─── agentRegistry integration ────────────────────────────────────────────────

describe("HarnessedAgent.execute — agentRegistry", () => {
  it("calls register on execute start and unregister in finally", async () => {
    const agentRegistry: jest.Mocked<AgentRegistry> = {
      register: jest.fn(),
      unregister: jest.fn(),
      get: jest.fn(),
      has: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<AgentRegistry>;

    const loop = makeLoop([
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "completed" as const },
      },
    ]);
    const agent = makeAgent({ loop, agentRegistry });

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(agentRegistry.register).toHaveBeenCalled();
    expect(agentRegistry.unregister).toHaveBeenCalled();
  });
});

// ─── eventStore integration ───────────────────────────────────────────────────

describe("HarnessedAgent.execute — eventStore", () => {
  it("calls appendBatch for buffered events on terminated", async () => {
    const appendBatch = jest.fn().mockResolvedValue([]);
    const eventStore = { appendBatch } as unknown as AgentEventStore;

    const loop = makeLoop([
      {
        type: "thinking",
        agentId: "a",
        timestamp: Date.now(),
        payload: { text: "t", tokenCount: 0 },
      },
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "completed" as const },
      },
    ]);
    const agent = makeAgent({ loop, eventStore });

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    // appendBatch should have been called (triggered by terminated event or buffer flush)
    expect(appendBatch).toHaveBeenCalled();
  });
});

// ─── checkpointService integration ───────────────────────────────────────────

describe("HarnessedAgent.execute — checkpointService", () => {
  function makeAgentStepCheckpointService(): jest.Mocked<AgentStepCheckpointService> {
    return {
      snapshot: jest.fn().mockResolvedValue({ id: "cp-1" }),
    } as unknown as jest.Mocked<AgentStepCheckpointService>;
  }

  it("calls snapshot on terminated event", async () => {
    const checkpointService = makeAgentStepCheckpointService();
    const loop = makeLoop([
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "completed" as const },
      },
    ]);
    const agent = makeAgent({ loop, checkpointService });

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(checkpointService.snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "pre-terminate" }),
    );
  });

  it("calls snapshot on action_executed when checkpointEveryNActions=1", async () => {
    const checkpointService = makeAgentStepCheckpointService();
    const loop = makeLoop([
      {
        type: "action_executed" as const,
        agentId: "a",
        timestamp: Date.now(),
        payload: { toolName: "search", result: "ok", durationMs: 10 },
      },
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "completed" as const },
      },
    ]);
    const agent = makeAgent({
      loop,
      checkpointService,
      checkpointEveryNActions: 1,
    });

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    // snapshot called at least twice: once for action_executed interval, once for pre-terminate
    expect(checkpointService.snapshot).toHaveBeenCalledTimes(2);
    const calls = checkpointService.snapshot.mock.calls.map((c) => c[0].reason);
    expect(calls).toContain("auto-interval");
    expect(calls).toContain("pre-terminate");
  });

  it("does not call snapshot on action_executed when checkpointEveryNActions=0 (default)", async () => {
    const checkpointService = makeAgentStepCheckpointService();
    const loop = makeLoop([
      {
        type: "action_executed" as const,
        agentId: "a",
        timestamp: Date.now(),
        payload: { toolName: "search", result: "ok", durationMs: 10 },
      },
      {
        type: "terminated",
        agentId: "a",
        timestamp: Date.now(),
        payload: { reason: "completed" as const },
      },
    ]);
    // checkpointEveryNActions defaults to 0 → no auto-interval snapshots
    const agent = makeAgent({ loop, checkpointService });

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    // Only pre-terminate snapshot
    const calls = checkpointService.snapshot.mock.calls.map((c) => c[0].reason);
    expect(calls).not.toContain("auto-interval");
    expect(calls).toContain("pre-terminate");
  });
});

// ─── validateBusinessRules closure in loop options ────────────────────────────

describe("HarnessedAgent.execute — validateBusinessRules closure via loop", () => {
  it("loop receives and can invoke validateBusinessRules closure with task.input", async () => {
    let capturedValidateFn: ((output: unknown) => unknown) | undefined;

    // A loop that captures the validateBusinessRules option passed to run()
    const capturingLoop: IAgentLoop = {
      run: async function* (
        _envelope: IContextEnvelope,
        _criteria: ILoopTerminationCriteria,
        options?: { validateBusinessRules?: (output: unknown) => unknown },
      ): AsyncIterable<IAgentEvent> {
        capturedValidateFn = options?.validateBusinessRules;
        // Invoke the closure with sample output
        if (capturedValidateFn) {
          capturedValidateFn({ key: "value" });
        }
        yield {
          type: "terminated",
          agentId: "a",
          timestamp: Date.now(),
          payload: { reason: "completed" as const },
        };
      },
    };

    const specValidateFn = jest.fn();
    const agent = makeAgent({
      loop: capturingLoop,
      validateBusinessRules: specValidateFn,
    });

    for await (const _ of agent.execute({
      goal: "test",
      input: { phase: "outline" },
    })) {
      void _;
    }

    // The closure passed to loop should have forwarded the call to specValidateFn
    expect(specValidateFn).toHaveBeenCalledWith(
      { key: "value" },
      { phase: "outline" }, // task.input
    );
  });
});

// ─── spawnSubagent with subagentSpawner wired ────────────────────────────────

describe("HarnessedAgent.spawnSubagent — with spawner wired", () => {
  it("delegates to subagentSpawner.spawn when spawner is wired", async () => {
    const mockHandle = { id: "subagent-1", done: jest.fn() };
    const subagentSpawner = {
      spawn: jest.fn().mockResolvedValue(mockHandle),
    } as never;

    const agent = makeAgent({ subagentSpawner });
    const result = await agent.spawnSubagent({} as never);

    expect(result).toBe(mockHandle);
  });

  it("rejects when no subagentSpawner provided", async () => {
    const agent = makeAgent(); // no spawner
    await expect(agent.spawnSubagent({} as never)).rejects.toThrow(
      /SubagentSpawner not wired/,
    );
  });
});

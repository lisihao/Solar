/**
 * AgentFactory — extra branch coverage
 *
 * Covers:
 * - pickLoop: loopRegistry.has(kind) → returns it (lines 82-88)
 * - pickLoop: loopRegistry.has(kind) false, has("react") → react fallback
 * - setElectionService (line 96)
 * - createSpecAgent: success path (lines 106-130)
 * - createSpecAgent: throws when llmExecutor not available (line 110-113)
 * - setSubagentSpawner (line 136-138)
 * - create: outputSchema validator closure (lines 180-202)
 * - create: validateBusinessRulesWrapper closure (lines 205-249)
 * - createWithEnvelope: with ContextEnvelope (lines 276-308)
 * - createWithEnvelope: with plain IContextEnvelope (converts to ContextEnvelope)
 * - createFromCheckpoint (lines 314-327)
 */

import { z } from "zod";
import { AgentFactory } from "../agent-factory";
import { AgentIdentity } from "../agent-identity";
import { ContextEnvelope } from "../context-envelope";
import type {
  IAgentSpec,
  IAgentLoop,
  IContextEnvelope,
  IAgentEvent,
} from "../../abstractions";
import type {
  LlmExecutor,
  LlmExecutorResult,
} from "../../../runner/executor/llm-executor";
import { LoopRegistry } from "../../../runner/loop/loop-registry";
import { MissionElectionTracker } from "../../../guardrails/runtime/mission-election-tracker.service";
import { MissionContext } from "../../../../../common/context/mission-context";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIdentity(roleId = "test-agent") {
  return AgentIdentity.of(
    { id: roleId, name: "Test", description: "unit test" },
    { goal: { summary: "do stuff" }, skills: [], tools: [] },
  );
}

function makeSpec(overrides?: Partial<IAgentSpec>): IAgentSpec {
  return {
    identity: makeIdentity(),
    sessionId: "session-1",
    userId: "user-1",
    ...overrides,
  };
}

function makeLlmExecutor(): jest.Mocked<LlmExecutor> {
  return {
    execute: jest.fn().mockResolvedValue({
      output: "result",
      tokensUsed: 10,
      inputTokens: 5,
      outputTokens: 5,
      model: "gpt-4o",
      costUsd: 0.001,
      retries: 0,
    } satisfies LlmExecutorResult<string>),
  } as unknown as jest.Mocked<LlmExecutor>;
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

// ─── createSpecAgent ──────────────────────────────────────────────────────────

describe("AgentFactory.createSpecAgent", () => {
  it("throws when llmExecutor is not available", () => {
    const factory = new AgentFactory(); // no llmExecutor passed
    expect(() => factory.createSpecAgent(makeSpec())).toThrow(
      /LlmExecutor not available/,
    );
  });

  it("creates a SpecBasedAgent when llmExecutor is available", () => {
    const executor = makeLlmExecutor();
    const factory = new AgentFactory(
      undefined, // reactLoop
      undefined, // memoryBridge
      undefined, // skillActivator
      undefined, // checkpointService
      executor, // llmExecutor
    );

    const agent = factory.createSpecAgent(makeSpec());
    expect(agent).toBeDefined();
    expect(agent.id).toBe("test-agent");
  });

  it("passes envSnapshot to SpecBasedAgent", () => {
    const executor = makeLlmExecutor();
    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      executor,
    );
    const envSnapshot = {
      models: { CHAT: [], REASONING: [], EMBEDDING: [] },
    } as never;

    const agent = factory.createSpecAgent(makeSpec(), envSnapshot);
    expect(agent).toBeDefined();
  });
});

// ─── setElectionService ───────────────────────────────────────────────────────

describe("AgentFactory.setElectionService", () => {
  it("wires the election service without throwing", () => {
    const factory = new AgentFactory();
    const mockElection = { elect: jest.fn() } as never;
    expect(() => factory.setElectionService(mockElection)).not.toThrow();
  });

  it("serializes same-mission elections and maps research role to researcher", async () => {
    const factory = new AgentFactory();
    const tracker = new MissionElectionTracker();
    const histories: string[][] = [];
    const roles: string[] = [];
    factory.setElectionTracker(tracker);
    factory.setElectionService({
      elect: jest
        .fn()
        .mockImplementation(async ({ previouslyElected, role }) => {
          histories.push([...previouslyElected]);
          roles.push(role);
          await new Promise((resolve) => setTimeout(resolve, 5));
          return {
            elected: {
              modelId:
                previouslyElected.length === 0
                  ? "grok-4-1-fast-reasoning"
                  : "deepseek-v4-pro",
            },
            scores: [],
            reason: "test",
          };
        }),
    } as never);

    const run = () =>
      MissionContext.run(
        {
          missionId: "mission-serialized",
          userId: "user-1",
        },
        () =>
          Promise.all([
            factory.electPreferredModel({ roleId: "researcher#0" }),
            factory.electPreferredModel({ roleId: "researcher#1" }),
          ]),
      );

    const models = await run();

    expect(models).toEqual(["grok-4-1-fast-reasoning", "deepseek-v4-pro"]);
    expect(histories).toEqual([[], ["grok-4-1-fast-reasoning"]]);
    expect(roles).toEqual(["researcher", "researcher"]);
  });

  // 2026-05-12 BYOK fix: 有 userId 上下文时 election 必须整体跳过，避免
  //   候选池跨 modelType (CHAT∪REASONING) 把 deepseek-reasoner 评分压过用户
  //   isDefault 的 grok。详细原因见 agent-factory.ts:148 注释。
  it("skips election when args.userId is set (BYOK path)", async () => {
    const factory = new AgentFactory();
    const electMock = jest.fn();
    factory.setElectionService({ elect: electMock } as never);

    const result = await factory.electPreferredModelSelection({
      roleId: "researcher#0",
      userId: "user-1",
    });

    expect(electMock).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it("still runs election when no userId (cron / system task)", async () => {
    const factory = new AgentFactory();
    const electMock = jest.fn().mockResolvedValue({
      elected: { modelId: "admin-tier-default" },
      scores: [],
      reason: "test",
    });
    factory.setElectionService({ elect: electMock } as never);

    const result = await factory.electPreferredModelSelection({
      roleId: "researcher#0",
      // no userId
    });

    expect(electMock).toHaveBeenCalled();
    expect(result.modelId).toBe("admin-tier-default");
  });
});

// ─── setSubagentSpawner ───────────────────────────────────────────────────────

describe("AgentFactory.setSubagentSpawner", () => {
  it("wires the spawner without throwing", () => {
    const factory = new AgentFactory();
    const mockSpawner = { spawn: jest.fn() } as never;
    expect(() => factory.setSubagentSpawner(mockSpawner)).not.toThrow();
  });
});

// ─── pickLoop: loopRegistry ───────────────────────────────────────────────────

describe("AgentFactory — pickLoop via loopRegistry", () => {
  it("returns loop from registry when spec.loop matches", () => {
    const mockLoop: IAgentLoop = {
      run: async function* () {},
    };
    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(mockLoop),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined, // reactLoop
      undefined, // memoryBridge
      undefined, // skillActivator
      undefined, // checkpointService
      undefined, // llmExecutor
      registry, // loopRegistry
    );

    const spec = makeSpec({ loop: "react" });
    const agent = factory.create(spec);
    expect(agent).toBeDefined();
    expect(registry.get).toHaveBeenCalled();
  });

  it("falls back to react when spec.loop not found but react is registered", () => {
    const reactLoop: IAgentLoop = {
      run: async function* () {},
    };
    const registry = {
      has: jest.fn().mockImplementation((kind: string) => kind === "react"),
      get: jest.fn().mockReturnValue(reactLoop),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );

    const spec = makeSpec({ loop: "plan-act" }); // not registered
    const agent = factory.create(spec);
    expect(agent).toBeDefined();
    expect(registry.get).toHaveBeenCalledWith("react");
  });

  it("falls back to defaultLoop when neither spec.loop nor react is in registry", () => {
    const registry = {
      has: jest.fn().mockReturnValue(false),
      get: jest.fn(),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );

    const agent = factory.create(makeSpec());
    expect(agent).toBeDefined();
    expect(registry.get).not.toHaveBeenCalled();
  });
});

// ─── create: outputSchema validator closure ───────────────────────────────────

describe("AgentFactory.create — outputSchema validator closure (exercised via loop)", () => {
  function makeCapturingLoop(
    onRun: (opts: {
      outputSchemaValidator?: (output: unknown) => {
        ok: boolean;
        issues?: string;
      };
      validateBusinessRules?: (
        output: unknown,
        input?: unknown,
      ) => string | null | undefined;
    }) => void,
  ): IAgentLoop {
    return {
      run: async function* (
        _envelope,
        _criteria,
        options?: {
          outputSchemaValidator?: (output: unknown) => {
            ok: boolean;
            issues?: string;
          };
          validateBusinessRules?: (
            output: unknown,
            input?: unknown,
          ) => string | null | undefined;
        },
      ): AsyncIterable<IAgentEvent> {
        onRun(options ?? {});
        yield {
          type: "terminated",
          agentId: "a",
          timestamp: Date.now(),
          payload: { reason: "completed" as const },
        };
      },
    };
  }

  it("outputSchemaValidator rejects non-matching output and returns issues", async () => {
    const schema = z.object({ name: z.string() });
    let capturedValidator:
      | ((output: unknown) => { ok: boolean; issues?: string })
      | undefined;

    const loop = makeCapturingLoop((opts) => {
      capturedValidator = opts.outputSchemaValidator;
    });

    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(loop),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );
    const spec = makeSpec({ outputSchema: schema as never, loop: "react" });
    const agent = factory.create(spec);

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(capturedValidator).toBeDefined();
    // Test: valid input passes
    expect(capturedValidator!({ name: "Alice" })).toEqual({ ok: true });
    // Test: invalid input fails with issues
    const fail = capturedValidator!({ name: 123 });
    expect(fail.ok).toBe(false);
    expect((fail as { ok: false; issues: string }).issues).toContain("name");
  });

  it("outputSchemaValidator parses JSON string before schema validation", async () => {
    const schema = z.object({ key: z.string() });
    let capturedValidator:
      | ((output: unknown) => { ok: boolean; issues?: string })
      | undefined;

    const loop = makeCapturingLoop((opts) => {
      capturedValidator = opts.outputSchemaValidator;
    });

    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(loop),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );
    const spec = makeSpec({ outputSchema: schema as never, loop: "react" });
    const agent = factory.create(spec);

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(capturedValidator).toBeDefined();
    // Valid JSON string → parsed → valid schema
    expect(capturedValidator!('{"key":"value"}')).toEqual({ ok: true });
    // Invalid JSON string (starts with { but doesn't parse) → kept as string → schema fails
    const r = capturedValidator!("{not valid json}");
    expect(r.ok).toBe(false);
  });

  // ★ 2026-05-13: regression for reasoning-model RUNNER_OUTPUT_SCHEMA_MISMATCH
  //   Nemotron-3-Nano / DeepSeek-R1 etc. routinely wrap their finalize JSON
  //   in surrounding prose ("Here is the JSON: {…}\n\nLet me know…") or in
  //   <think>…</think> blocks. The prior `startsWith('{')` recovery shim
  //   failed those cases → MAX_FINALIZE_REJECTS → RUNNER_OUTPUT_SCHEMA_MISMATCH.
  it("outputSchemaValidator robustly extracts JSON from prose-wrapped strings", async () => {
    const schema = z.object({ dimension: z.string(), score: z.number() });
    let capturedValidator:
      | ((output: unknown) => { ok: boolean; issues?: string })
      | undefined;

    const loop = makeCapturingLoop((opts) => {
      capturedValidator = opts.outputSchemaValidator;
    });

    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(loop),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );
    const spec = makeSpec({ outputSchema: schema as never, loop: "react" });
    const agent = factory.create(spec);

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(capturedValidator).toBeDefined();
    // Leading prose
    expect(
      capturedValidator!('Here is the JSON: {"dimension":"d","score":7}'),
    ).toEqual({ ok: true });
    // Trailing prose
    expect(
      capturedValidator!(
        '{"dimension":"d","score":7}\n\nLet me know if you need adjustments.',
      ),
    ).toEqual({ ok: true });
    // Fenced code block
    expect(
      capturedValidator!('```json\n{"dimension":"d","score":7}\n```'),
    ).toEqual({ ok: true });
    // <think> reasoning leak before the answer (Nemotron / DeepSeek-R1)
    expect(
      capturedValidator!(
        '<think>The user asked me to score this dimension...</think>\n{"dimension":"d","score":7}',
      ),
    ).toEqual({ ok: true });
    // Plain prose with no extractable JSON → still rejects
    const r = capturedValidator!("I think this dimension scored about a 7.");
    expect(r.ok).toBe(false);
  });
});

// ─── create: validateBusinessRulesWrapper closure ────────────────────────────

describe("AgentFactory.create — validateBusinessRulesWrapper closure (exercised via loop)", () => {
  function makeCapturingLoop(
    onRun: (opts: {
      validateBusinessRules?: (
        output: unknown,
        input?: unknown,
      ) => string | null | undefined;
    }) => void,
  ): IAgentLoop {
    return {
      run: async function* (
        _envelope,
        _criteria,
        options?: {
          validateBusinessRules?: (
            output: unknown,
            input?: unknown,
          ) => string | null | undefined;
        },
      ): AsyncIterable<IAgentEvent> {
        onRun(options ?? {});
        yield {
          type: "terminated",
          agentId: "a",
          timestamp: Date.now(),
          payload: { reason: "completed" as const },
        };
      },
    };
  }

  it("validateBusinessRulesWrapper invokes spec.validateBusinessRules with typed value", async () => {
    const specValidate = jest.fn().mockImplementation((output: unknown) => {
      if (typeof output !== "object") throw new Error("not-an-object");
    });

    let capturedWrapper:
      | ((output: unknown, input?: unknown) => string | null | undefined)
      | undefined;

    const loop = makeCapturingLoop((opts) => {
      capturedWrapper = opts.validateBusinessRules;
    });

    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(loop),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );
    const spec = makeSpec({
      validateBusinessRules: specValidate as never,
      loop: "react",
    });
    const agent = factory.create(spec);

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(capturedWrapper).toBeDefined();
    // Valid input → null return (pass)
    expect(capturedWrapper!({ data: "ok" })).toBeNull();
    // Invalid input → error message string
    const result = capturedWrapper!("not-an-object");
    expect(typeof result).toBe("string");
    expect(result).toContain("not-an-object");
  });

  it("validateBusinessRulesWrapper: when outputSchema exists, schema-parses before business check", async () => {
    const specValidate = jest.fn();
    let capturedWrapper:
      | ((output: unknown, input?: unknown) => string | null | undefined)
      | undefined;

    const loop = makeCapturingLoop((opts) => {
      capturedWrapper = opts.validateBusinessRules;
    });

    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(loop),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );
    const schema = z.object({ count: z.number() });
    const spec = makeSpec({
      outputSchema: schema as never,
      validateBusinessRules: specValidate as never,
      loop: "react",
    });
    const agent = factory.create(spec);

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(capturedWrapper).toBeDefined();
    // Output fails schema → wrapper returns null (schema guard already rejected it)
    const nullResult = capturedWrapper!({ count: "not-a-number" });
    expect(nullResult).toBeNull();
    expect(specValidate).not.toHaveBeenCalled(); // not called when schema fails

    // Output passes schema → business rules invoked
    capturedWrapper!({ count: 5 });
    expect(specValidate).toHaveBeenCalled();
  });

  it("validateBusinessRulesWrapper: JSON string that fails to parse returns null immediately", async () => {
    const specValidate = jest.fn();
    let capturedWrapper:
      | ((output: unknown, input?: unknown) => string | null | undefined)
      | undefined;

    const loop = makeCapturingLoop((opts) => {
      capturedWrapper = opts.validateBusinessRules;
    });

    const registry = {
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue(loop),
    } as unknown as LoopRegistry;

    const factory = new AgentFactory(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry,
    );
    const schema = z.object({ count: z.number() });
    const spec = makeSpec({
      outputSchema: schema as never,
      validateBusinessRules: specValidate as never,
      loop: "react",
    });
    const agent = factory.create(spec);

    for await (const _ of agent.execute({ goal: "test" })) {
      void _;
    }

    expect(capturedWrapper).toBeDefined();
    // String that starts with { but is invalid JSON → returns null (JSON.parse throws)
    const result = capturedWrapper!("{this is not valid json}");
    expect(result).toBeNull();
    expect(specValidate).not.toHaveBeenCalled();
  });
});

// ─── createWithEnvelope ───────────────────────────────────────────────────────

describe("AgentFactory.createWithEnvelope", () => {
  it("creates HarnessedAgent using provided ContextEnvelope instance", () => {
    const factory = new AgentFactory();
    const env = makeEnvelope();
    const agent = factory.createWithEnvelope(makeSpec(), env);
    expect(agent).toBeDefined();
    expect(agent.getEnvelope().system).toBeDefined();
  });

  it("creates HarnessedAgent wrapping plain IContextEnvelope into ContextEnvelope", () => {
    const factory = new AgentFactory();
    const plainEnv: IContextEnvelope = {
      system: "test system prompt",
      messages: [],
      reminders: [],
      tools: ["tool-1"],
      memory: { sessionId: "s1" },
      budget: {
        tokensUsed: 0,
        tokensRemaining: 5000,
        iterationsUsed: 0,
        iterationsRemaining: 3,
        wallTimeStartMs: Date.now(),
      },
    };

    const agent = factory.createWithEnvelope(makeSpec(), plainEnv);
    expect(agent).toBeDefined();
    expect(agent.getEnvelope().system).toBe("test system prompt");
  });
});

// ─── createFromCheckpoint ─────────────────────────────────────────────────────

describe("AgentFactory.createFromCheckpoint", () => {
  it("creates an agent from a checkpoint with identity and envelope", () => {
    const factory = new AgentFactory();
    const env = makeEnvelope();

    const agent = factory.createFromCheckpoint({
      identity: makeIdentity(),
      envelope: env,
      sessionId: "checkpoint-session",
    });

    expect(agent).toBeDefined();
    expect(agent.state).toBe("idle");
  });

  it("creates from checkpoint without sessionId", () => {
    const factory = new AgentFactory();
    const env = makeEnvelope();

    const agent = factory.createFromCheckpoint({
      identity: makeIdentity(),
      envelope: env,
    });

    expect(agent).toBeDefined();
  });
});

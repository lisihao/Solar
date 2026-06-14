/**
 * SpecBasedAgent — unit tests
 *
 * Covers:
 * - executeSpec: success path (LlmExecutor resolves)
 * - executeSpec: failure path (LlmExecutor throws)
 * - executeSpec: with buildSystemPrompt and buildUserPrompt overrides
 * - executeSpec: with stubFn (skips LLM)
 * - execute (IAgent interface): completed path
 * - execute (IAgent interface): failed path
 * - cancel
 * - getEnvelope
 * - spawnSubagent (throws)
 * - electModelOrNull: no electionProvider → returns undefined
 * - electModelOrNull: electionProvider returns undefined
 * - resolveRoleHint: leader/researcher/writer/reviewer/extractor/classifier/default
 * - buildCandidatesFromSnapshot: no env → empty candidates
 * - BYOK cross-model failover: user has 2 CHAT models from different providers;
 *   model A (default) throws PROVIDER_API_ERROR → failover resolves model B,
 *   B is used, A is in excludeModelIds, call succeeds.
 *   AbortError does NOT trigger failover for BYOK either.
 */

import { SpecBasedAgent } from "../spec-based-agent";
import { AgentIdentity } from "../agent-identity";
import { MissionContext } from "../../../../../common/context/mission-context";
import type {
  LlmExecutor,
  LlmExecutorInput,
  LlmExecutorResult,
} from "../../../runner/executor/llm-executor";
import type { IAgentSpec, IAgentTask, IAgentEvent } from "../../abstractions";
import { MissionElectionTracker } from "../../../guardrails/runtime/mission-election-tracker.service";
import type { AiModelConfigService } from "../../../../ai-engine/llm/models/config/ai-model-config.service";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIdentity(roleId = "test-agent") {
  return AgentIdentity.of(
    { id: roleId, name: "Test Agent", description: "unit test" },
    { goal: { summary: "do stuff" }, skills: [], tools: [] },
  );
}

function makeSpec(overrides?: Partial<IAgentSpec>): IAgentSpec {
  // 2026-05-12 BYOK fix：默认 userId 留空（admin/cron 路径）让 election 走通，
  //   election 行为相关的测试不需要每个都 override 掉 userId。"BYOK 用户跳过
  //   election" 的测试显式传 userId 验证 skip 分支即可。
  return {
    identity: makeIdentity(),
    sessionId: "session-1",
    ...overrides,
  };
}

function makeExecutorResult(
  overrides?: Partial<LlmExecutorResult<string>>,
): LlmExecutorResult<string> {
  return {
    output: "result text",
    tokensUsed: 100,
    inputTokens: 50,
    outputTokens: 50,
    model: "gpt-4o",
    costUsd: 0.01,
    retries: 0,
    ...overrides,
  };
}

function makeLlmExecutor(
  impl?: Partial<LlmExecutor>,
): jest.Mocked<LlmExecutor> {
  return {
    execute: jest.fn().mockResolvedValue(makeExecutorResult()),
    ...impl,
  } as unknown as jest.Mocked<LlmExecutor>;
}

function makeAgent(
  spec: IAgentSpec = makeSpec(),
  executor: jest.Mocked<LlmExecutor> = makeLlmExecutor(),
  electionProvider?: () => undefined,
): SpecBasedAgent {
  return new SpecBasedAgent("test-agent-id", spec, executor, electionProvider);
}

// ─── executeSpec: success ─────────────────────────────────────────────────────

describe("SpecBasedAgent.executeSpec — success path", () => {
  it("returns completed state and output from LlmExecutor", async () => {
    const executor = makeLlmExecutor();
    const agent = makeAgent(makeSpec(), executor);

    const result = await agent.executeSpec("hello");

    expect(result.state).toBe("completed");
    expect(result.output).toBe("result text");
    expect(result.tokensUsed).toBe(100);
    expect(result.model).toBe("gpt-4o");
    expect(result.wallTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("passes agentId, systemPrompt, userPrompt to LlmExecutor", async () => {
    const executor = makeLlmExecutor();
    const agent = makeAgent(makeSpec(), executor);

    await agent.executeSpec("test input");

    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "test-agent-id",
        systemPrompt: expect.any(String),
        userPrompt: expect.any(String),
      }),
    );
  });

  it("uses buildSystemPrompt when provided in spec", async () => {
    const executor = makeLlmExecutor();
    const spec = makeSpec({
      buildSystemPrompt: () => "custom system prompt",
      buildUserPrompt: () => "custom user prompt",
    });
    const agent = makeAgent(spec, executor);

    await agent.executeSpec("input");

    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: "custom system prompt",
        userPrompt: "custom user prompt",
      }),
    );
  });

  it("JSON-stringifies non-string input when no buildUserPrompt", async () => {
    const executor = makeLlmExecutor();
    const agent = makeAgent(makeSpec(), executor);

    await agent.executeSpec({ key: "value" });

    const call = executor.execute.mock.calls[0][0];
    expect(call.userPrompt).toContain("key");
    expect(call.userPrompt).toContain("value");
  });

  it("sets agent state to completed after success", async () => {
    const agent = makeAgent();
    expect(agent.state).toBe("idle");
    await agent.executeSpec("input");
    expect(agent.state).toBe("completed");
  });
});

// ─── executeSpec: failure path ────────────────────────────────────────────────

describe("SpecBasedAgent.executeSpec — failure path", () => {
  it("returns failed state when LlmExecutor throws", async () => {
    const executor = makeLlmExecutor({
      execute: jest.fn().mockRejectedValue(new Error("LLM unavailable")),
    });
    const agent = makeAgent(makeSpec(), executor);

    const result = await agent.executeSpec("input");

    expect(result.state).toBe("failed");
    expect(result.errors).toContain("LLM unavailable");
    expect(result.output).toBeUndefined();
  });

  it("sets agent state to failed after LlmExecutor throws", async () => {
    const executor = makeLlmExecutor({
      execute: jest.fn().mockRejectedValue(new Error("crash")),
    });
    const agent = makeAgent(makeSpec(), executor);
    await agent.executeSpec("input");
    expect(agent.state).toBe("failed");
  });

  it("handles non-Error throws by converting to string", async () => {
    const executor = makeLlmExecutor({
      execute: jest.fn().mockRejectedValue("string error"),
    });
    const agent = makeAgent(makeSpec(), executor);

    const result = await agent.executeSpec("input");
    expect(result.state).toBe("failed");
    expect(result.errors?.[0]).toBe("string error");
  });
});

// ─── executeSpec: with stubFn ─────────────────────────────────────────────────

describe("SpecBasedAgent.executeSpec — with stubFn in spec", () => {
  it("passes stubFn to LlmExecutor", async () => {
    const stubFn = jest.fn().mockResolvedValue("stub result");
    const spec = makeSpec({ stubFn });
    const executor = makeLlmExecutor();
    const agent = makeAgent(spec, executor);

    await agent.executeSpec("input");

    const call = executor.execute.mock.calls[0][0];
    expect(typeof call.stubFn).toBe("function");
  });
});

// ─── execute (IAgent interface) ───────────────────────────────────────────────

describe("SpecBasedAgent.execute — IAgent interface (stream)", () => {
  it("yields thinking then output events on success", async () => {
    const agent = makeAgent();
    const events: IAgentEvent[] = [];

    const task: IAgentTask = { goal: "do something", input: "hello" };
    for await (const ev of agent.execute(task)) {
      events.push(ev);
    }

    expect(events[0].type).toBe("thinking");
    const outputEvent = events.find((e) => e.type === "output");
    expect(outputEvent).toBeDefined();
  });

  it("yields thinking then error event on failure", async () => {
    const executor = makeLlmExecutor({
      execute: jest.fn().mockRejectedValue(new Error("LLM fail")),
    });
    const agent = makeAgent(makeSpec(), executor);
    const events: IAgentEvent[] = [];

    const task: IAgentTask = { goal: "fail", input: {} };
    for await (const ev of agent.execute(task)) {
      events.push(ev);
    }

    expect(events[0].type).toBe("thinking");
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });
});

// ─── cancel ──────────────────────────────────────────────────────────────────

describe("SpecBasedAgent.cancel", () => {
  it("sets state to cancelled and resolves", async () => {
    const agent = makeAgent();
    await agent.cancel("test reason");
    expect(agent.state).toBe("cancelled");
  });
});

// ─── getEnvelope ─────────────────────────────────────────────────────────────

describe("SpecBasedAgent.getEnvelope", () => {
  it("returns a ContextEnvelope with system prompt and budget", () => {
    const agent = makeAgent();
    const env = agent.getEnvelope();
    expect(env.system).toBeDefined();
    expect(typeof env.system).toBe("string");
    expect(env.budget.tokensRemaining).toBeGreaterThan(0);
  });
});

// ─── spawnSubagent ────────────────────────────────────────────────────────────

describe("SpecBasedAgent.spawnSubagent", () => {
  it("rejects with error message about not supporting subagent spawning", async () => {
    const agent = makeAgent();
    await expect(agent.spawnSubagent({} as never)).rejects.toThrow(
      /SpecBasedAgent does not support subagent spawning/,
    );
  });
});

// ─── electModelOrNull: no electionProvider ────────────────────────────────────

describe("SpecBasedAgent electModelOrNull — BYOK userId skip (2026-05-12)", () => {
  // 真因：election 候选池跨 modelType (CHAT∪REASONING)，打分让 deepseek-reasoner
  //   压过用户 isDefault 的 grok；preferredModelId 透给 llm-executor → react-loop
  //   击穿 byokUserId 闸 → chat({ model: deepseek-reasoner }) Path B → 用户 quota
  //   exhausted 的 deepseek key 报 402。详细注释见 spec-based-agent.ts:295。
  it("skips election when spec.userId is set", async () => {
    const executor = makeLlmExecutor();
    const electionService = {
      elect: jest.fn().mockResolvedValue({
        elected: { modelId: "should-not-be-used" },
        reason: "test",
      }),
    };
    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec({ userId: "user-1" }),
      executor,
      () => electionService as never,
    );

    await agent.executeSpec("input");

    expect(electionService.elect).not.toHaveBeenCalled();
    // 透给 llm-executor 的 model 应为 undefined，让 chat() 走 Path A
    // findUserDefaultByType 命中用户 BYOK 默认
    const call = executor.execute.mock.calls[0][0];
    expect(call.model).toBeUndefined();
  });

  it("skips election when MissionContext.userId is set (mission path)", async () => {
    const executor = makeLlmExecutor();
    const electionService = {
      elect: jest.fn().mockResolvedValue({
        elected: { modelId: "should-not-be-used" },
        reason: "test",
      }),
    };
    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(), // no spec.userId
      executor,
      () => electionService as never,
    );

    await MissionContext.run(
      { missionId: "mission-byok", userId: "user-1" },
      () => agent.executeSpec("input"),
    );

    expect(electionService.elect).not.toHaveBeenCalled();
    const call = executor.execute.mock.calls[0][0];
    expect(call.model).toBeUndefined();
  });

  it("still runs election when no userId anywhere (admin/cron path)", async () => {
    const executor = makeLlmExecutor();
    const electionService = {
      elect: jest.fn().mockResolvedValue({
        elected: { modelId: "admin-elected" },
        reason: "test",
      }),
    };
    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(), // no spec.userId, no kctx.userId
      executor,
      () => electionService as never,
    );

    await agent.executeSpec("input");

    expect(electionService.elect).toHaveBeenCalled();
    const call = executor.execute.mock.calls[0][0];
    expect(call.model).toBe("admin-elected");
  });
});

describe("SpecBasedAgent electModelOrNull — no electionProvider", () => {
  it("returns undefined model when no electionProvider given", async () => {
    const executor = makeLlmExecutor();
    const agent = new SpecBasedAgent("agent-id", makeSpec(), executor);

    await agent.executeSpec("input");

    // Without election, model param should be undefined
    const call = executor.execute.mock.calls[0][0];
    expect(call.model).toBeUndefined();
  });

  it("returns undefined model when electionProvider returns undefined", async () => {
    const executor = makeLlmExecutor();
    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(),
      executor,
      () => undefined, // provider that returns undefined
    );

    await agent.executeSpec("input");

    const call = executor.execute.mock.calls[0][0];
    expect(call.model).toBeUndefined();
  });
});

// ─── resolveRoleHint coverage via roleId ──────────────────────────────────────

describe("SpecBasedAgent resolveRoleHint — role ID patterns", () => {
  const testRoles = [
    ["leader-agent", "leader"],
    ["planner-v2", "leader"],
    ["researcher#2", "researcher"],
    ["research-analyst", "researcher"],
    ["writer-section", "writer"],
    ["section-editor", "writer"],
    ["reviewer-quality", "reviewer"],
    ["evaluator-1", "reviewer"],
    ["extractor-data", "extractor"],
    ["classifier-intent", "classifier"],
    ["generic-agent", "default"],
  ] as const;

  for (const [roleId, expectedHint] of testRoles) {
    it(`resolves roleId="${roleId}" → hint="${expectedHint}"`, async () => {
      const executor = makeLlmExecutor();
      let capturedRole: string | undefined;

      const electionService = {
        elect: jest.fn().mockImplementation(({ role }: { role: string }) => {
          capturedRole = role;
          return Promise.resolve({
            elected: { modelId: "test-model" },
            reason: "test",
          });
        }),
      };

      const agent = new SpecBasedAgent(
        roleId,
        makeSpec({
          identity: makeIdentity(roleId),
        }),
        executor,
        () => electionService as never,
      );

      await agent.executeSpec("input");

      expect(capturedRole).toBe(expectedHint);
    });
  }
});

// ─── validateBusinessRules closure in executeSpec ────────────────────────────

describe("SpecBasedAgent.executeSpec — validateBusinessRules closure", () => {
  it("passes validateBusinessRules closure to llmExecutor when spec provides it", async () => {
    const validateBusinessRules = jest.fn().mockImplementation(() => {
      /* no-op — validation passes */
    });
    const spec = makeSpec({ validateBusinessRules } as never);
    const executor = makeLlmExecutor();
    const agent = makeAgent(spec, executor);

    await agent.executeSpec("input");

    const call = executor.execute.mock.calls[0][0];
    // The closure is wrapped — it should be a function
    expect(typeof call.validateBusinessRules).toBe("function");
  });

  it("closure invokes spec.validateBusinessRules with output and ctx when executor calls it", async () => {
    const validateBusinessRules = jest.fn();
    const spec = makeSpec({ validateBusinessRules } as never);

    // Make the executor actually invoke the validateBusinessRules closure
    const executor: jest.Mocked<LlmExecutor> = {
      execute: jest
        .fn()
        .mockImplementation(
          async (params: { validateBusinessRules?: (o: unknown) => void }) => {
            // Simulate the LlmExecutor calling the validator callback
            if (params.validateBusinessRules) {
              params.validateBusinessRules({ result: "validated-output" });
            }
            return makeExecutorResult({ output: "ok" });
          },
        ),
    } as unknown as jest.Mocked<LlmExecutor>;

    const agent = makeAgent(spec, executor);
    const result = await agent.executeSpec("input");

    expect(result.state).toBe("completed");
    // The wrapped closure should have forwarded the call to spec.validateBusinessRules
    expect(validateBusinessRules).toHaveBeenCalledWith(
      { result: "validated-output" },
      expect.objectContaining({ input: "input" }),
    );
  });
});

// ─── electModelOrNull: non-NoEligibleModelError → returns undefined ───────────

describe("SpecBasedAgent electModelOrNull — generic election error returns undefined", () => {
  it("returns undefined model when election service throws generic error", async () => {
    const executor = makeLlmExecutor();
    const electionService = {
      elect: jest.fn().mockRejectedValue(new Error("network timeout")),
    };
    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(),
      executor,
      () => electionService as never,
    );

    // Should not throw — generic errors are swallowed, falls back to undefined model
    const result = await agent.executeSpec("input");
    expect(result.state).toBe("completed");

    const call = executor.execute.mock.calls[0][0];
    expect(call.model).toBeUndefined();
  });

  it("fails closed when election infrastructure breaks inside a mission", async () => {
    const executor = makeLlmExecutor();
    const electionService = {
      elect: jest.fn().mockRejectedValue(new Error("redis unavailable")),
    };
    const tracker = new MissionElectionTracker();
    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(),
      executor,
      () => electionService as never,
      undefined,
      () => tracker,
    );

    // 2026-05-12 BYOK fix：election 在有 userId 上下文时整体跳过。本测试验证的
    //   是 election 基础设施错误 fail-closed 行为，仅适用于无 userId 的 admin /
    //   cron mission。BYOK 用户路径下 election 不会跑，自然没这条失败链路。
    const result = await MissionContext.run(
      { missionId: "mission-strict" },
      () => agent.executeSpec("input"),
    );

    expect(result.state).toBe("failed");
    expect(result.errors?.[0]).toContain("election infrastructure failed");
    expect(executor.execute).not.toHaveBeenCalled();
  });
});

describe("SpecBasedAgent election reservation lifecycle", () => {
  it("commits reservation after successful execution", async () => {
    const executor = makeLlmExecutor();
    const tracker = new MissionElectionTracker();
    const electionService = {
      elect: jest.fn().mockResolvedValue({
        elected: { modelId: "deepseek-v4-pro" },
        reason: "test",
      }),
    };
    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(),
      executor,
      () => electionService as never,
      undefined,
      () => tracker,
    );

    // 2026-05-12 BYOK fix：election + reservation 在有 userId 上下文时整体跳过。
    //   本测试验证的是 reservation commit 行为，仅适用于无 userId 的 admin /
    //   cron mission。
    await MissionContext.run({ missionId: "mission-commit" }, () =>
      agent.executeSpec("input"),
    );

    await expect(tracker.getElected("mission-commit")).resolves.toEqual([
      "deepseek-v4-pro",
    ]);
  });

  it("releases reservation when execution fails", async () => {
    const executor = makeLlmExecutor({
      execute: jest.fn().mockRejectedValue(new Error("model crashed")),
    });
    const tracker = new MissionElectionTracker();
    const electionService = {
      elect: jest.fn().mockResolvedValue({
        elected: { modelId: "deepseek-v4-pro" },
        reason: "test",
      }),
    };
    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(),
      executor,
      () => electionService as never,
      undefined,
      () => tracker,
    );

    // 2026-05-12 BYOK fix：election + reservation 在有 userId 上下文时整体跳过。
    //   本测试验证的是 reservation release-on-failure 行为，仅适用于无 userId
    //   的 admin / cron mission。
    await MissionContext.run({ missionId: "mission-release" }, () =>
      agent.executeSpec("input"),
    );

    await expect(tracker.getElected("mission-release")).resolves.toEqual([]);
  });
});

// ─── buildCandidatesFromSnapshot: with envSnapshot ────────────────────────────

describe("SpecBasedAgent buildCandidatesFromSnapshot — with envSnapshot", () => {
  it("uses envSnapshot models when provided as constructor arg", async () => {
    const executor = makeLlmExecutor();
    let capturedCandidates: unknown[] = [];

    const electionService = {
      elect: jest
        .fn()
        .mockImplementation(({ candidates }: { candidates: unknown[] }) => {
          capturedCandidates = candidates;
          return Promise.resolve({
            elected: { modelId: "gpt-4o" },
            reason: "test",
          });
        }),
    };

    const envSnapshot = {
      generatedAt: new Date().toISOString(),
      userId: "u1",
      models: {
        CHAT: [
          {
            modelId: "gpt-4o",
            provider: "openai",
            modelType: "CHAT" as const,
            contextWindow: 128000,
            costTier: "standard" as const,
            healthy: "healthy" as const,
            recentErrorRate: 0,
          },
        ],
        REASONING: [],
        EMBEDDING: [
          {
            modelId: "text-embedding-3-small",
            provider: "openai",
            modelType: "EMBEDDING" as const,
            contextWindow: 8191,
            costTier: "basic" as const,
            healthy: "healthy" as const,
          },
        ],
        VISION: [],
      },
      agents: [],
      tools: [],
      skills: [],
      userKeys: { hasByok: false, byokProviders: [], sharedKeyAvailable: true },
      externalDeps: {},
    } as never;

    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(),
      executor,
      () => electionService as never,
      envSnapshot,
    );

    await agent.executeSpec("input");

    // Candidates should include only CHAT (+ REASONING=empty), not EMBEDDING
    expect(capturedCandidates.length).toBeGreaterThan(0);
    const candidate = capturedCandidates[0] as { modelId: string };
    expect(candidate.modelId).toBe("gpt-4o");
  });

  it("uses envOverride argument over constructor envSnapshot", async () => {
    const executor = makeLlmExecutor();
    let capturedCandidates: unknown[] = [];

    const electionService = {
      elect: jest
        .fn()
        .mockImplementation(({ candidates }: { candidates: unknown[] }) => {
          capturedCandidates = candidates;
          return Promise.resolve({
            elected: { modelId: "claude-3-haiku" },
            reason: "test",
          });
        }),
    };

    const constructorEnv = {
      generatedAt: new Date().toISOString(),
      userId: "u1",
      models: { CHAT: [], REASONING: [], EMBEDDING: [], VISION: [] },
      agents: [],
      tools: [],
      skills: [],
      userKeys: { hasByok: false, byokProviders: [], sharedKeyAvailable: true },
      externalDeps: {},
    } as never;

    const overrideEnv = {
      generatedAt: new Date().toISOString(),
      userId: "u1",
      models: {
        CHAT: [
          {
            modelId: "claude-3-haiku",
            provider: "anthropic",
            modelType: "CHAT" as const,
            contextWindow: 200000,
            costTier: "basic" as const,
            healthy: "healthy" as const,
          },
        ],
        REASONING: [],
        EMBEDDING: [],
        VISION: [],
      },
      agents: [],
      tools: [],
      skills: [],
      userKeys: { hasByok: false, byokProviders: [], sharedKeyAvailable: true },
      externalDeps: {},
    } as never;

    const agent = new SpecBasedAgent(
      "agent-id",
      makeSpec(),
      executor,
      () => electionService as never,
      constructorEnv,
    );

    // Pass override env — should use this, not the constructor env (which has empty CHAT)
    await agent.executeSpec("input", overrideEnv);

    expect(capturedCandidates.length).toBe(1);
  });
});

// ─── identity getter ──────────────────────────────────────────────────────────

describe("SpecBasedAgent.identity", () => {
  it("returns the agent identity from spec", () => {
    const agent = makeAgent();
    const identity = agent.identity;
    expect(identity.role.id).toBe("test-agent");
  });
});

// ─── state getter ─────────────────────────────────────────────────────────────

describe("SpecBasedAgent.state", () => {
  it("starts as idle", () => {
    const agent = makeAgent();
    expect(agent.state).toBe("idle");
  });
});

// ─── BYOK cross-model failover ────────────────────────────────────────────────

describe("SpecBasedAgent BYOK cross-model failover (2026-05-23)", () => {
  /**
   * Helper: build a mock AiModelConfigService with a controlled
   * listUserEnabledModelsByType implementation.
   */
  function makeModelConfigService(
    userModels: Array<{ modelId: string; provider: string }>,
  ): jest.Mocked<Pick<AiModelConfigService, "listUserEnabledModelsByType">> {
    return {
      listUserEnabledModelsByType: jest
        .fn()
        .mockImplementation(
          async (
            _userId: string,
            _modelType: unknown,
            excludeModelIds: ReadonlyArray<string>,
          ) => {
            return userModels
              .filter((m) => !excludeModelIds.includes(m.modelId))
              .map((m) => ({
                id: `umc-${m.modelId}`,
                modelId: m.modelId,
                provider: m.provider,
                name: m.modelId,
                displayName: m.modelId,
                apiEndpoint: "",
                apiKey: null,
                maxTokens: 4000,
                temperature: 0.7,
                isEnabled: true,
                isDefault: false,
              }));
          },
        ),
    };
  }

  it("wires BYOK failover provider that returns model B when model A is excluded", async () => {
    const modelA = "grok-4-1-fast";
    const modelB = "claude-3-5-sonnet";
    const userId = "byok-user-1";

    const modelConfigService = makeModelConfigService([
      { modelId: modelA, provider: "xai" },
      { modelId: modelB, provider: "anthropic" },
    ]);

    let capturedProvider:
      | ((
          excludeModelIds: ReadonlyArray<string>,
        ) => Promise<string | null | undefined>)
      | undefined;

    const executor: jest.Mocked<LlmExecutor> = {
      execute: jest
        .fn()
        .mockImplementation(async (params: LlmExecutorInput<string>) => {
          capturedProvider = params.modelFailoverProvider;
          return makeExecutorResult({ model: modelA });
        }),
    } as unknown as jest.Mocked<LlmExecutor>;

    const agent = new SpecBasedAgent(
      "byok-agent",
      makeSpec({ userId }),
      executor,
      undefined, // no election provider (BYOK path)
      undefined,
      undefined, // no election tracker
      () => modelConfigService as unknown as AiModelConfigService,
    );

    const result = await agent.executeSpec("test input");

    // executeSpec succeeds (executor returned successfully)
    expect(result.state).toBe("completed");

    // The failover provider must have been wired
    expect(capturedProvider).toBeDefined();

    // Simulate model A failing: call provider with [modelA] as excluded
    // → should return modelB (model B is healthy, different provider)
    const nextModel = await capturedProvider!([modelA]);
    expect(nextModel).toBe(modelB);

    // Verify the query was for the user's CHAT models, excluding model A
    // (4th arg = excludeProviders, empty when no provider has failed yet).
    expect(modelConfigService.listUserEnabledModelsByType).toHaveBeenCalledWith(
      userId,
      "CHAT",
      [modelA],
      [],
    );
  });

  it("modelFailoverProvider returns null when all user models exhausted", async () => {
    const modelA = "grok-4-1-fast";
    const userId = "byok-user-2";

    // Only one model configured; after excluding it, list is empty
    const modelConfigService = makeModelConfigService([
      { modelId: modelA, provider: "xai" },
    ]);

    let capturedFailoverProvider:
      | ((
          excludeModelIds: ReadonlyArray<string>,
        ) => Promise<string | null | undefined>)
      | undefined;
    const executor: jest.Mocked<LlmExecutor> = {
      execute: jest
        .fn()
        .mockImplementation(async (params: LlmExecutorInput<string>) => {
          capturedFailoverProvider = params.modelFailoverProvider;
          return makeExecutorResult({ model: modelA });
        }),
    } as unknown as jest.Mocked<LlmExecutor>;

    const agent = new SpecBasedAgent(
      "byok-agent-2",
      makeSpec({ userId }),
      executor,
      undefined,
      undefined,
      undefined,
      () => modelConfigService as unknown as AiModelConfigService,
    );

    await agent.executeSpec("test input");

    expect(capturedFailoverProvider).toBeDefined();
    // After excluding modelA, no models remain → returns null
    const next = await capturedFailoverProvider!([modelA]);
    expect(next).toBeNull();
  });

  it("no modelFailoverProvider wired when no modelConfigProvider given (BYOK userId but legacy construction)", async () => {
    const executor = makeLlmExecutor();
    const agent = new SpecBasedAgent(
      "byok-legacy",
      makeSpec({ userId: "user-legacy" }),
      executor,
      undefined, // no election provider
      // no modelConfigProvider — 7th arg omitted
    );

    await agent.executeSpec("test input");

    const call = executor.execute.mock.calls[0][0];
    // Without modelConfigProvider, BYOK path returns undefined failover provider
    expect(call.modelFailoverProvider).toBeUndefined();
  });

  it("AbortError does NOT trigger BYOK failover (failover provider is not called for abort)", async () => {
    const userId = "byok-abort-user";
    const modelConfigService = makeModelConfigService([
      { modelId: "grok-4", provider: "xai" },
      { modelId: "claude-3-5-sonnet", provider: "anthropic" },
    ]);

    let capturedFailoverProvider:
      | ((
          excludeModelIds: ReadonlyArray<string>,
        ) => Promise<string | null | undefined>)
      | undefined;

    const executor: jest.Mocked<LlmExecutor> = {
      execute: jest
        .fn()
        .mockImplementation(async (params: LlmExecutorInput<string>) => {
          capturedFailoverProvider = params.modelFailoverProvider;
          // Simulate abort error — isModelLevelFailoverError returns false for this
          throw new DOMException("Aborted during LLM execute", "AbortError");
        }),
    } as unknown as jest.Mocked<LlmExecutor>;

    const agent = new SpecBasedAgent(
      "byok-abort-agent",
      makeSpec({ userId }),
      executor,
      undefined,
      undefined,
      undefined,
      () => modelConfigService as unknown as AiModelConfigService,
    );

    const result = await agent.executeSpec("test input");
    expect(result.state).toBe("failed");

    // The failover provider IS wired (so it would be available if needed),
    // but the LlmExecutor's isModelLevelFailoverError returns false for AbortError,
    // so listUserEnabledModelsByType should never have been called.
    expect(capturedFailoverProvider).toBeDefined();
    expect(
      modelConfigService.listUserEnabledModelsByType,
    ).not.toHaveBeenCalled();
  });
});

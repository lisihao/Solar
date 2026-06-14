/**
 * AgentRunner + @DefineAgent 单元测试 (PR-H)
 *
 * 验证 AI App DX 闭环：
 *   - @DefineAgent 装饰器把 spec 挂到 class
 *   - AgentRunner.run(Spec, input) 执行并返回强类型 output
 *   - 输入 schema 校验失败 → InputValidationError
 *   - 缺装饰器 → DefineAgentMissingError
 *   - stubFn 模式（无 LLM 也能跑）
 */

import { z } from "zod";
import { AgentFactory } from "../../core/agent-factory";
import {
  AgentRunner,
  ByokRequiredError,
  DefineAgentMissingError,
  InputValidationError,
  type RunOptions,
} from "../agent-runner.service";
import { AgentSpec, DefineAgent } from "../agent-spec.base";
import type {
  ByokStatus,
  ICreditState,
  IModelAvailability,
  IRuntimeEnvironment,
} from "../../abstractions";
import { BillingContext } from "../../../../platform/credits/billing-context.store";

const Input = z.object({ topic: z.string().min(1) });
const Output = z.object({
  subTopics: z.array(z.string()).min(1),
});

@DefineAgent({
  id: "topic-extractor",
  identity: { role: "research-analyst", description: "Extracts sub-topics" },
  loop: "react",
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 1000, maxIterations: 3 },
})
class TopicExtractorAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return `Extract sub-topics for: ${input.topic}`;
  }

  // Use stubFn so we don't need LLM for this test
  async stubFn({ input }: { input: z.infer<typeof Input> }) {
    return { subTopics: [`a-${input.topic}`, `b-${input.topic}`] };
  }
}

@DefineAgent({
  id: "no-input-schema",
  identity: { role: "x", description: "" },
  loop: "react",
})
class NoSchemaAgent extends AgentSpec {}

class UndecoratedAgent extends AgentSpec {}

describe("AgentRunner + @DefineAgent (PR-H)", () => {
  beforeAll(() => {
    process.env.AI_ENGINE_AGENT_STUB = "1";
  });
  afterAll(() => {
    delete process.env.AI_ENGINE_AGENT_STUB;
  });

  it("runs decorated spec end-to-end (skeleton path, no loop)", async () => {
    // Without injected loop, HarnessedAgent goes into skeleton fallback —
    // returns the stub structure. Sufficient for DX wiring assertion.
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);

    const result = await runner.run(TopicExtractorAgent, { topic: "RAG" });
    // skeleton fallback emits a stub output object containing { ok, stub, agent, goal, ... }
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.find((e) => e.type === "output")).toBeDefined();
    expect(result.agent.identity.role.id).toBe("research-analyst");
  });

  it("rejects invalid input via InputValidationError", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    await expect(
      runner.run(TopicExtractorAgent, { topic: "" }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("throws DefineAgentMissingError if class is undecorated", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    await expect(runner.run(UndecoratedAgent, {})).rejects.toBeInstanceOf(
      DefineAgentMissingError,
    );
  });

  it("agent without inputSchema accepts any input", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    const result = await runner.run(NoSchemaAgent, { anything: 1 });
    expect(result.state).toBe("completed");
  });

  it("stream() yields events", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    const events = [];
    for await (const ev of runner.stream(TopicExtractorAgent, { topic: "x" })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].type).toBe("terminated");
  });

  // ────────────────────────────────────────────────────────────
  // RunOptions（Harness 自闭包：环境感知 / BYOK / BillingContext）
  // ────────────────────────────────────────────────────────────

  function buildEnv(
    overrides: Partial<IRuntimeEnvironment> = {},
  ): IRuntimeEnvironment {
    return {
      userId: "u1",
      workspaceId: "ws1",
      getByokStatus: jest.fn().mockResolvedValue("personal" as ByokStatus),
      getCreditState: jest.fn().mockResolvedValue({
        balance: 1000,
        softLimit: 100,
        hardLimit: 10,
        currency: "credit",
      } as ICreditState),
      getModelAvailability: jest.fn(),
      listAvailableModels: jest.fn().mockResolvedValue([
        { modelId: "gpt-4o", available: true },
        { modelId: "claude-3", available: true },
        { modelId: "broken", available: false },
      ] as IModelAvailability[]),
      getEnvironmentSnapshot: jest.fn().mockResolvedValue({
        generatedAt: new Date().toISOString(),
        userId: "u1",
        models: {
          CHAT: [
            {
              modelId: "gpt-4o",
              provider: "openai",
              modelType: "CHAT",
              contextWindow: 128000,
              costTier: "strong",
              healthy: "healthy",
            },
          ],
          REASONING: [],
          EMBEDDING: [],
          VISION: [],
        },
        agents: [],
        tools: [],
        skills: [],
        userKeys: {
          hasByok: true,
          byokProviders: ["openai"],
          sharedKeyAvailable: false,
        },
        externalDeps: {},
      }),
      getQuotaSnapshot: jest.fn().mockResolvedValue({}),
      suggestFallback: jest.fn(),
      ...overrides,
    };
  }

  it("BYOK fail-fast: throws ByokRequiredError when status=platform and policy=fail", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    const env = buildEnv({
      getByokStatus: jest.fn().mockResolvedValue("platform"),
    });
    const opts: RunOptions = {
      userId: "u1",
      environment: env,
      onMissingByok: "fail",
    };
    await expect(
      runner.run(TopicExtractorAgent, { topic: "x" }, opts),
    ).rejects.toBeInstanceOf(ByokRequiredError);
  });

  it("BYOK warn: status=platform with policy=warn does NOT throw, run completes", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    const env = buildEnv({
      getByokStatus: jest.fn().mockResolvedValue("platform"),
    });
    const result = await runner.run(
      TopicExtractorAgent,
      { topic: "x" },
      { userId: "u1", environment: env, onMissingByok: "warn" },
    );
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("environment block injected into systemPrompt (byok / credit / models)", async () => {
    const factory = new AgentFactory();
    const createSpy = jest.spyOn(factory, "create");
    const runner = new AgentRunner(factory);
    const env = buildEnv();

    await runner.run(
      TopicExtractorAgent,
      { topic: "x" },
      { userId: "u1", environment: env },
    );

    const passedSpec = createSpy.mock.calls[0][0];
    const sp = passedSpec.systemPrompt as string;
    expect(sp).toContain("<environment>");
    expect(sp).toContain("byok: personal");
    expect(sp).toContain("balance=1000");
    expect(sp).toContain("gpt-4o");
    // unhealthy model 不应出现在 sample 列表
    expect(sp).not.toContain("broken");
    createSpy.mockRestore();
  });

  it("passes elected preferred model into factory.create for ReAct agents", async () => {
    const factory = new AgentFactory();
    // ★ Round 4 (2026-05-11): AgentRunner 改走 electPreferredModelSelection
    //   返回 { modelId, missionId?, reservation? }，旧 electPreferredModel 仅 wrapper。
    const electSpy = jest
      .spyOn(factory, "electPreferredModelSelection")
      .mockResolvedValue({ modelId: "gpt-4o" });
    const createSpy = jest.spyOn(factory, "create");
    const runner = new AgentRunner(factory);

    await runner.run(
      TopicExtractorAgent,
      { topic: "x" },
      { userId: "u1", environment: buildEnv() },
    );

    expect(electSpy).toHaveBeenCalled();
    expect(createSpy.mock.calls[0][1]).toBe("gpt-4o");
  });

  it("catalog block injected with declared tools + skills (when registries injected)", async () => {
    const factory = new AgentFactory();
    const fakeToolReg = {
      tryGet: jest.fn((id: string) => ({
        id,
        name: id,
        description: `desc-${id}`,
      })),
      isAvailable: jest.fn(() => true),
      listByCategory: jest.fn(() => []),
    };
    const fakeSkillReg = {
      get: jest.fn((id: string) => ({
        frontmatter: { name: id, description: `skill-desc-${id}` },
      })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = new AgentRunner(
      factory,
      fakeToolReg as never,
      fakeSkillReg as never,
    );
    const createSpy = jest.spyOn(factory, "create");

    @DefineAgent({
      id: "with-tools",
      identity: { role: "x", description: "" },
      loop: "react",
      tools: ["web-search", "web-scraper"],
      skills: ["critical-review"],
    })
    class WithToolsAgent extends AgentSpec {}

    await runner.run(WithToolsAgent, {});
    const sp = createSpy.mock.calls[0][0].systemPrompt as string;
    expect(sp).toContain("<available_tools>");
    expect(sp).toContain("- web-search: desc-web-search");
    expect(sp).toContain("- web-scraper: desc-web-scraper");
    expect(sp).toContain("<available_skills>");
    expect(sp).toContain("- critical-review: skill-desc-critical-review");
    createSpy.mockRestore();
  });

  it("BillingContext: outer context preserved (inner runner does NOT overwrite moduleType/operationType)", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    let observedInside: ReturnType<typeof BillingContext.get> = undefined;

    await BillingContext.run(
      {
        userId: "u1",
        moduleType: "outer-module",
        operationType: "outer-op",
        referenceId: "outer-ref",
      },
      async () => {
        await runner.run(
          TopicExtractorAgent,
          { topic: "x" },
          {
            userId: "u1",
            billingMeta: {
              moduleType: "harness",
              operationType: "topic-extractor",
            },
            onEvent: () => {
              observedInside = BillingContext.get();
            },
          },
        );
      },
    );

    // 关键断言：inside the agent execution, BillingContext is the OUTER one
    expect(observedInside).toBeDefined();
    expect(observedInside!.moduleType).toBe("outer-module");
    expect(observedInside!.operationType).toBe("outer-op");
    expect(observedInside!.referenceId).toBe("outer-ref");
  });

  it("BillingContext: when no outer, runner wraps with billingMeta defaults", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    let observedInside: ReturnType<typeof BillingContext.get> = undefined;

    // 没有外层 BillingContext
    await runner.run(
      TopicExtractorAgent,
      { topic: "x" },
      {
        userId: "u1",
        billingMeta: {
          moduleType: "playground",
          operationType: "leader",
          referenceId: "mission-1",
        },
        onEvent: () => {
          observedInside = BillingContext.get();
        },
      },
    );

    expect(observedInside).toBeDefined();
    expect(observedInside!.userId).toBe("u1");
    expect(observedInside!.moduleType).toBe("playground");
    expect(observedInside!.operationType).toBe("leader");
  });

  it("backward compat: 3rd arg as function still works as onEvent", async () => {
    const factory = new AgentFactory();
    const runner = new AgentRunner(factory);
    const events: string[] = [];
    await runner.run(TopicExtractorAgent, { topic: "x" }, (ev) => {
      events.push(ev.type);
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events).toContain("terminated");
  });
});

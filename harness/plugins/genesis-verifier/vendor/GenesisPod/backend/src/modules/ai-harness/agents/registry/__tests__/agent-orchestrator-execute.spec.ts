/**
 * AgentOrchestrator — execute() and applyRuntimeConfig() tests
 *
 * The existing agent-orchestrator.spec.ts covers selectAgent() scoring.
 * This file covers the execute() generator and guardrails/config paths
 * which were previously at 38.9% coverage.
 */

import { AgentOrchestrator } from "../agent-orchestrator";
import { PlanBasedAgentRegistry } from "../plan-based-agent-registry";
import { AgentConfigService } from "../../config/agent-config.service";
import { GuardrailsPipelineService } from "../../../safety/guardrails/guardrails-pipeline.service";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makePlanBasedAgent(id: string) {
  const planEvents = [
    { type: "plan_ready" as const, plan: { steps: ["step1"] } },
    { type: "complete" as const, result: { success: true, output: "Done" } },
  ];

  let sysPromptOverride: string | null = null;
  let modelTypeOverride: string | null = null;
  let taskProfileOverride: Record<string, unknown> | null = null;

  return {
    id,
    name: `Agent ${id}`,
    description: `Plan-based agent ${id}`,
    capabilities: [],
    requiredTools: [],
    getConfig: jest.fn().mockReturnValue({
      id,
      name: `Agent ${id}`,
      description: "",
      icon: "",
      color: "",
      capabilities: [],
      templates: [],
      selectionKeywords: ["代码", "code"],
    }),
    plan: jest.fn().mockResolvedValue({ steps: ["step1"] }),
    execute: jest.fn().mockImplementation(async function* () {
      for (const e of planEvents) yield e;
    }),
    setSystemPromptOverride: jest.fn((p: string) => {
      sysPromptOverride = p;
    }),
    setModelTypeOverride: jest.fn((m: string) => {
      modelTypeOverride = m;
    }),
    setTaskProfileOverride: jest.fn((p: Record<string, unknown>) => {
      taskProfileOverride = p;
    }),
    clearRuntimeOverrides: jest.fn(),
    _sysPromptOverride: () => sysPromptOverride,
    _modelTypeOverride: () => modelTypeOverride,
    _taskProfileOverride: () => taskProfileOverride,
  };
}

async function collectEvents(gen: AsyncGenerator<any>): Promise<any[]> {
  const events: any[] = [];
  for await (const e of gen) {
    events.push(e);
  }
  return events;
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("AgentOrchestrator — execute()", () => {
  let registry: PlanBasedAgentRegistry;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    registry = new PlanBasedAgentRegistry();
    orchestrator = new AgentOrchestrator(registry);
  });

  it("should execute a registered agent and yield events", async () => {
    const agent = makePlanBasedAgent("code-agent");
    registry.register(agent as any);

    const events = await collectEvents(
      orchestrator.execute({ prompt: "帮我写代码" }, "code-agent", "user-1"),
    );

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("plan_ready");
    expect(events[1].type).toBe("complete");
  });

  it("should yield error event when agentId not found", async () => {
    const events = await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "nonexistent-agent"),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].error).toContain("Agent not found");
  });

  it("should yield error event when no agents registered and no agentId", async () => {
    const events = await collectEvents(
      orchestrator.execute({ prompt: "任意内容" }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].error).toContain("No suitable agent");
  });

  it("should auto-select agent when no agentId given", async () => {
    const agent = makePlanBasedAgent("slides-agent");
    agent.getConfig.mockReturnValue({
      id: "slides-agent",
      name: "Slides Agent",
      description: "",
      icon: "",
      color: "",
      capabilities: [],
      templates: [],
      selectionKeywords: ["slides", "presentation"],
    });
    registry.register(agent as any);

    const events = await collectEvents(
      orchestrator.execute({ prompt: "make me a slides presentation" }),
    );

    expect(events.some((e) => e.type === "complete")).toBe(true);
    expect(agent.plan).toHaveBeenCalled();
  });

  it("should record successful execution in registry", async () => {
    const agent = makePlanBasedAgent("success-agent");
    registry.register(agent as any);

    const recordSpy = jest.spyOn(registry, "recordExecution");
    await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "success-agent"),
    );

    expect(recordSpy).toHaveBeenCalledWith("success-agent", true);
  });

  it("should record failed execution when agent.plan throws", async () => {
    const agent = makePlanBasedAgent("failing-agent");
    agent.plan.mockRejectedValueOnce(new Error("Planning failed"));
    registry.register(agent as any);

    const recordSpy = jest.spyOn(registry, "recordExecution");
    const events = await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "failing-agent"),
    );

    expect(events[events.length - 1].type).toBe("error");
    expect(recordSpy).toHaveBeenCalledWith("failing-agent", false);
  });

  it("should record failed execution on error event", async () => {
    const agent = makePlanBasedAgent("error-agent");
    agent.execute.mockImplementation(async function* () {
      yield { type: "error" as const, error: "Tool failed" };
    });
    registry.register(agent as any);

    const recordSpy = jest.spyOn(registry, "recordExecution");
    const events = await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "error-agent"),
    );

    expect(events[0].type).toBe("error");
    expect(recordSpy).toHaveBeenCalledWith("error-agent", false);
  });

  it("should call clearRuntimeOverrides in finally block", async () => {
    const agent = makePlanBasedAgent("cleanup-agent");
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "cleanup-agent"),
    );

    expect(agent.clearRuntimeOverrides).toHaveBeenCalled();
  });

  it("should call clearRuntimeOverrides even on error", async () => {
    const agent = makePlanBasedAgent("error-cleanup-agent");
    agent.plan.mockRejectedValueOnce(new Error("Crash"));
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute({ prompt: "crash" }, "error-cleanup-agent"),
    );

    expect(agent.clearRuntimeOverrides).toHaveBeenCalled();
  });

  it("should wrap agent error message in error event", async () => {
    const agent = makePlanBasedAgent("msg-agent");
    agent.plan.mockRejectedValueOnce(new Error("Specific error message"));
    registry.register(agent as any);

    const events = await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "msg-agent"),
    );

    expect(events[0].error).toBe("Specific error message");
  });

  it("should handle non-Error thrown objects", async () => {
    const agent = makePlanBasedAgent("nonError-agent");
    agent.plan.mockRejectedValueOnce("string error");
    registry.register(agent as any);

    const events = await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "nonError-agent"),
    );

    expect(events[0].type).toBe("error");
    expect(events[0].error).toBe("Agent execution failed");
  });
});

// ------------------------------------------------------------------
// Guardrails integration
// ------------------------------------------------------------------

describe("AgentOrchestrator — with guardrails", () => {
  let registry: PlanBasedAgentRegistry;
  let mockGuardrails: any;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    registry = new PlanBasedAgentRegistry();
    mockGuardrails = {
      processInput: jest.fn().mockResolvedValue({ passed: true }),
      processOutput: jest.fn().mockResolvedValue({ passed: true }),
    };
    orchestrator = new AgentOrchestrator(
      registry,
      undefined,
      mockGuardrails as GuardrailsPipelineService,
      { get: jest.fn().mockReturnValue(undefined) } as any,
    );
  });

  it("should call processInput before execution", async () => {
    const agent = makePlanBasedAgent("guarded-agent");
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute(
        { prompt: "safe content" },
        "guarded-agent",
        "user-1",
      ),
    );

    expect(mockGuardrails.processInput).toHaveBeenCalledWith(
      expect.objectContaining({ content: "safe content", userId: "user-1" }),
    );
  });

  it("should block execution when input guardrail fails", async () => {
    const agent = makePlanBasedAgent("blocked-agent");
    registry.register(agent as any);

    mockGuardrails.processInput.mockResolvedValueOnce({
      passed: false,
      blockedBy: "content_filter",
    });

    const events = await collectEvents(
      orchestrator.execute({ prompt: "dangerous content" }, "blocked-agent"),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].error).toContain("blocked by security policy");
    expect(agent.plan).not.toHaveBeenCalled();
  });

  it("M3: applies redacted transformedContent to the agent prompt (PII redact-not-block)", async () => {
    const agent = makePlanBasedAgent("redact-agent");
    registry.register(agent as any);

    mockGuardrails.processInput.mockResolvedValueOnce({
      passed: true,
      transformedContent: "my email is [EMAIL]",
    });

    await collectEvents(
      orchestrator.execute(
        { prompt: "my email is john@x.com" },
        "redact-agent",
        "user-1",
      ),
    );

    // agent 必须收到脱敏后的 prompt，而非原始含 PII 的
    const planArg = agent.plan.mock.calls[0]?.[0];
    expect(planArg.prompt).toBe("my email is [EMAIL]");
  });

  it("should call processOutput for complete events", async () => {
    const agent = makePlanBasedAgent("output-guarded");
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "output-guarded"),
    );

    expect(mockGuardrails.processOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ agentId: "output-guarded" }),
      }),
    );
  });

  it("should block output when output guardrail fails", async () => {
    const agent = makePlanBasedAgent("output-blocked");
    registry.register(agent as any);

    mockGuardrails.processOutput.mockResolvedValueOnce({
      passed: false,
      blockedBy: "output_filter",
    });

    const events = await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "output-blocked"),
    );

    expect(events[events.length - 1].type).toBe("error");
    expect(events[events.length - 1].error).toContain(
      "blocked by security policy",
    );
  });

  it("should continue when guardrails error and failClosed=false (default)", async () => {
    const agent = makePlanBasedAgent("guardrail-error-agent");
    registry.register(agent as any);

    // failClosed is not set (default), so errors should be swallowed
    mockGuardrails.processInput.mockRejectedValueOnce(
      new Error("Guardrails service down"),
    );

    const events = await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "guardrail-error-agent"),
    );

    // Should continue to execute despite guardrail error
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });

  it("should block when guardrails error and failClosed=true", async () => {
    registry = new PlanBasedAgentRegistry();
    mockGuardrails = {
      processInput: jest
        .fn()
        .mockRejectedValue(new Error("Guardrails service down")),
      processOutput: jest.fn().mockResolvedValue({ passed: true }),
    };
    // Create orchestrator with GUARDRAILS_FAIL_CLOSED=true
    const failClosedOrchestrator = new AgentOrchestrator(
      registry,
      undefined,
      mockGuardrails as GuardrailsPipelineService,
      {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === "GUARDRAILS_FAIL_CLOSED") return "true";
          return undefined;
        }),
      } as any,
    );

    const agent = makePlanBasedAgent("failclosed-agent");
    registry.register(agent as any);

    const events = await collectEvents(
      failClosedOrchestrator.execute({ prompt: "任务" }, "failclosed-agent"),
    );

    expect(events[0].type).toBe("error");
    expect(events[0].error).toContain("Security validation unavailable");
    expect(agent.plan).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// applyRuntimeConfig
// ------------------------------------------------------------------

describe("AgentOrchestrator — applyRuntimeConfig", () => {
  let registry: PlanBasedAgentRegistry;
  let mockAgentConfig: any;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    registry = new PlanBasedAgentRegistry();
    mockAgentConfig = {
      getEffectiveConfig: jest.fn(),
    };
    orchestrator = new AgentOrchestrator(
      registry,
      mockAgentConfig as AgentConfigService,
    );
  });

  it("should apply systemPrompt override from DB config", async () => {
    mockAgentConfig.getEffectiveConfig.mockResolvedValueOnce({
      enabled: true,
      systemPrompt: "You are a specialized agent.",
      modelType: null,
      taskProfile: null,
    });

    const agent = makePlanBasedAgent("prompt-override-agent");
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "prompt-override-agent"),
    );

    expect(agent.setSystemPromptOverride).toHaveBeenCalledWith(
      "You are a specialized agent.",
    );
  });

  it("should apply modelType override from DB config", async () => {
    mockAgentConfig.getEffectiveConfig.mockResolvedValueOnce({
      enabled: true,
      systemPrompt: null,
      modelType: "REASONING",
      taskProfile: null,
    });

    const agent = makePlanBasedAgent("model-override-agent");
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "model-override-agent"),
    );

    expect(agent.setModelTypeOverride).toHaveBeenCalledWith("REASONING");
  });

  it("should apply taskProfile override from DB config", async () => {
    const profile = { creativity: "high", outputLength: "long" };
    mockAgentConfig.getEffectiveConfig.mockResolvedValueOnce({
      enabled: true,
      systemPrompt: null,
      modelType: null,
      taskProfile: profile,
    });

    const agent = makePlanBasedAgent("profile-override-agent");
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "profile-override-agent"),
    );

    expect(agent.setTaskProfileOverride).toHaveBeenCalledWith(profile);
  });

  it("should skip config application when DB config is null", async () => {
    mockAgentConfig.getEffectiveConfig.mockResolvedValueOnce(null);

    const agent = makePlanBasedAgent("null-config-agent");
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "null-config-agent"),
    );

    expect(agent.setSystemPromptOverride).not.toHaveBeenCalled();
  });

  it("should skip config application when enabled=false", async () => {
    mockAgentConfig.getEffectiveConfig.mockResolvedValueOnce({
      enabled: false,
      systemPrompt: "Should not be applied",
      modelType: null,
      taskProfile: null,
    });

    const agent = makePlanBasedAgent("disabled-config-agent");
    registry.register(agent as any);

    await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "disabled-config-agent"),
    );

    expect(agent.setSystemPromptOverride).not.toHaveBeenCalled();
  });

  it("should continue execution when getEffectiveConfig throws", async () => {
    mockAgentConfig.getEffectiveConfig.mockRejectedValueOnce(
      new Error("DB unavailable"),
    );

    const agent = makePlanBasedAgent("config-error-agent");
    registry.register(agent as any);

    const events = await collectEvents(
      orchestrator.execute({ prompt: "任务" }, "config-error-agent"),
    );

    // Should still complete execution despite config error
    expect(events.some((e) => e.type === "complete")).toBe(true);
  });
});

// ------------------------------------------------------------------
// getStatusReport
// ------------------------------------------------------------------

describe("AgentOrchestrator — getStatusReport()", () => {
  it("should return status for all registered agents", () => {
    const registry = new PlanBasedAgentRegistry();
    const orchestrator = new AgentOrchestrator(registry);

    const agent1 = makePlanBasedAgent("agent-x");
    const agent2 = makePlanBasedAgent("agent-y");
    registry.register(agent1 as any);
    registry.register(agent2 as any);

    // Simulate some executions
    registry.recordExecution("agent-x", true);
    registry.recordExecution("agent-x", false);

    const report = orchestrator.getStatusReport();

    expect(report).toHaveLength(2);
    const agentX = report.find((r) => r.agentId === "agent-x");
    expect(agentX).toBeDefined();
    expect(agentX!.available).toBe(true);
    expect(agentX!.executions).toBeGreaterThanOrEqual(2);
  });
});

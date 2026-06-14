/**
 * HarnessedAgent 冒烟测试（Phase 1）
 *
 * 目的：证明 Harness 抽象 + core + facade 的管道可跑通；
 *      真实 loop / tool / memory 在后续 phase 验证。
 */

import { AgentFactory } from "../agent-factory";
import { AgentIdentity } from "../agent-identity";
import { ContextEnvelope } from "../context-envelope";
import { HarnessedAgent } from "../harnessed-agent";
import type { IAgentEvent, IAgentLoop, IAgentSpec } from "../../abstractions";

describe("HarnessedAgent (Phase 1 skeleton)", () => {
  const factory = new AgentFactory();

  function makeSpec(): IAgentSpec {
    return {
      identity: AgentIdentity.of(
        { id: "test-agent", name: "Test Agent", description: "unit test" },
        {
          goal: { summary: "test goal" },
          skills: ["skill-a"],
          tools: ["tool-a"],
        },
      ),
      sessionId: "session-1",
      userId: "user-1",
    };
  }

  function makeLoop(events: IAgentEvent[], shouldThrow = false): IAgentLoop {
    return {
      run: async function* () {
        for (const ev of events) yield ev;
        if (shouldThrow) {
          throw new Error("loop failed");
        }
      },
    };
  }

  it("creates an agent with identity + empty envelope", () => {
    const agent = factory.create(makeSpec());
    expect(agent.id).toBeDefined();
    expect(agent.state).toBe("idle");
    expect(agent.identity.role.id).toBe("test-agent");

    const env = agent.getEnvelope();
    expect(env.system).toContain("Role");
    expect(env.messages).toHaveLength(0);
    expect(env.tools).toEqual(["tool-a"]);
    expect(env.memory.sessionId).toBe("session-1");
    expect(env.budget.tokensRemaining).toBeGreaterThan(0);
  });

  it("emits thinking → output → terminated events and completes", async () => {
    const agent = factory.create(makeSpec());
    const events: IAgentEvent[] = [];

    for await (const ev of agent.execute({ goal: "hello" })) {
      events.push(ev);
    }

    expect(events.map((e) => e.type)).toEqual([
      "thinking",
      "output",
      "terminated",
    ]);
    expect(agent.state).toBe("completed");

    const output = events.find((e) => e.type === "output");
    expect(output?.payload).toMatchObject({
      output: expect.objectContaining({ stub: true, goal: "hello" }),
    });
  });

  it("appends user task to envelope on execute", async () => {
    const agent = factory.create(makeSpec());
    const iter = agent.execute({ goal: "investigate X", input: "details" });
    // Drain events
    for await (const _ of iter) {
      void _;
    }
    const env = agent.getEnvelope();
    expect(env.messages).toHaveLength(1);
    expect(env.messages[0].role).toBe("user");
    expect(env.messages[0].content).toContain("investigate X");
    expect(env.messages[0].content).toContain("details");
  });

  it("spawnSubagent without spawner wired rejects with clear error", async () => {
    // Factory without SubagentSpawner injected
    const agent = factory.create(makeSpec());
    await expect(
      agent.spawnSubagent({
        name: "child",
        identity: AgentIdentity.of({
          id: "child",
          name: "Child",
          description: "",
        }),
        prompt: "do something",
      }),
    ).rejects.toThrow(/SubagentSpawner not wired/i);
  });

  it("cancel() sets state to cancelled", async () => {
    const agent = factory.create(makeSpec());
    await agent.cancel("user aborted");
    expect(agent.state).toBe("cancelled");
  });

  it("commits preferred model reservation after successful completion", async () => {
    const onCommit = jest.fn().mockResolvedValue(undefined);
    const onRelease = jest.fn().mockResolvedValue(undefined);
    const identity = makeSpec().identity as AgentIdentity;
    const agent = new HarnessedAgent({
      identity,
      envelope: new ContextEnvelope({
        system: identity.toSystemPrompt(),
        messages: [],
        reminders: [],
        tools: [...identity.tools],
        memory: { sessionId: "session-1" },
        budget: {
          tokensUsed: 0,
          tokensRemaining: 1000,
          iterationsUsed: 0,
          iterationsRemaining: 5,
          wallTimeStartMs: Date.now(),
        },
      }),
      preferredModelId: "deepseek-v4-pro",
      preferredModelMissionId: "mission-1",
      preferredModelReservation: {
        token: "reservation-1",
        modelId: "deepseek-v4-pro",
        createdAt: Date.now(),
      },
      onCommitPreferredModelReservation: onCommit,
      onReleasePreferredModelReservation: onRelease,
    });

    for await (const _ of agent.execute({ goal: "hello" })) {
      void _;
    }

    expect(onCommit).toHaveBeenCalledWith("mission-1", "reservation-1");
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("releases preferred model reservation when loop terminates via max_iterations", async () => {
    const onCommit = jest.fn().mockResolvedValue(undefined);
    const onRelease = jest.fn().mockResolvedValue(undefined);
    const identity = makeSpec().identity as AgentIdentity;
    const agent = new HarnessedAgent({
      identity,
      envelope: new ContextEnvelope({
        system: identity.toSystemPrompt(),
        messages: [],
        reminders: [],
        tools: [...identity.tools],
        memory: { sessionId: "session-1" },
        budget: {
          tokensUsed: 0,
          tokensRemaining: 1000,
          iterationsUsed: 0,
          iterationsRemaining: 5,
          wallTimeStartMs: Date.now(),
        },
      }),
      loop: makeLoop([
        {
          type: "terminated",
          agentId: "agent-1",
          timestamp: Date.now(),
          payload: { reason: "max_iterations" },
        },
      ]),
      preferredModelId: "deepseek-v4-pro",
      preferredModelMissionId: "mission-1",
      preferredModelReservation: {
        token: "reservation-1",
        modelId: "deepseek-v4-pro",
        createdAt: Date.now(),
      },
      onCommitPreferredModelReservation: onCommit,
      onReleasePreferredModelReservation: onRelease,
    });

    for await (const _ of agent.execute({ goal: "hello" })) {
      void _;
    }

    expect(onCommit).not.toHaveBeenCalled();
    expect(onRelease).toHaveBeenCalledWith("mission-1", "reservation-1");
  });

  it("releases preferred model reservation when loop execution fails", async () => {
    const onCommit = jest.fn().mockResolvedValue(undefined);
    const onRelease = jest.fn().mockResolvedValue(undefined);
    const identity = makeSpec().identity as AgentIdentity;
    const agent = new HarnessedAgent({
      identity,
      envelope: new ContextEnvelope({
        system: identity.toSystemPrompt(),
        messages: [],
        reminders: [],
        tools: [...identity.tools],
        memory: { sessionId: "session-1" },
        budget: {
          tokensUsed: 0,
          tokensRemaining: 1000,
          iterationsUsed: 0,
          iterationsRemaining: 5,
          wallTimeStartMs: Date.now(),
        },
      }),
      loop: makeLoop([], true),
      preferredModelId: "deepseek-v4-pro",
      preferredModelMissionId: "mission-1",
      preferredModelReservation: {
        token: "reservation-2",
        modelId: "deepseek-v4-pro",
        createdAt: Date.now(),
      },
      onCommitPreferredModelReservation: onCommit,
      onReleasePreferredModelReservation: onRelease,
    });

    for await (const _ of agent.execute({ goal: "hello" })) {
      void _;
    }

    expect(onCommit).not.toHaveBeenCalled();
    expect(onRelease).toHaveBeenCalledWith("mission-1", "reservation-2");
  });

  it("releases preferred model reservation when already cancelled before execute", async () => {
    const onCommit = jest.fn().mockResolvedValue(undefined);
    const onRelease = jest.fn().mockResolvedValue(undefined);
    const identity = makeSpec().identity as AgentIdentity;
    const agent = new HarnessedAgent({
      identity,
      envelope: new ContextEnvelope({
        system: identity.toSystemPrompt(),
        messages: [],
        reminders: [],
        tools: [...identity.tools],
        memory: { sessionId: "session-1" },
        budget: {
          tokensUsed: 0,
          tokensRemaining: 1000,
          iterationsUsed: 0,
          iterationsRemaining: 5,
          wallTimeStartMs: Date.now(),
        },
      }),
      preferredModelId: "deepseek-v4-pro",
      preferredModelMissionId: "mission-1",
      preferredModelReservation: {
        token: "reservation-3",
        modelId: "deepseek-v4-pro",
        createdAt: Date.now(),
      },
      onCommitPreferredModelReservation: onCommit,
      onReleasePreferredModelReservation: onRelease,
    });
    await agent.cancel("user aborted");

    for await (const _ of agent.execute({ goal: "hello" })) {
      void _;
    }

    expect(onCommit).not.toHaveBeenCalled();
    expect(onRelease).toHaveBeenCalledWith("mission-1", "reservation-3");
  });
});

/**
 * LeaderWorkerLoop — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - budget.exhausted() → budget warning + terminated
 *   - runWorker() catch path when selectWorker throws → failed WorkerResult
 *   - revise decision with no retryTaskIds (empty/missing) → falls through
 *   - expand decision with no newTasks → falls through
 *   - action_executed event with worker error (r.error truthy)
 *   - LeaderFeedbackChannel.askLeader
 *   - isStubImplementation = false (custom subclass)
 *   - default agentId when options.agentId not provided
 */

import {
  LeaderWorkerLoop,
  LeaderFeedbackChannel,
  type ILeaderBrain,
  type LeaderTask,
} from "../leader-worker-loop";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../agents/abstractions";
import { Logger } from "@nestjs/common";

jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "log").mockImplementation();

function makeEnvelope(): ContextEnvelope {
  return new ContextEnvelope({
    system: "You are a team leader.",
    messages: [
      { role: "user", content: "Orchestrate the research.", timestamp: 0 },
    ],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1", userId: "u1" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 100_000,
      iterationsUsed: 0,
      iterationsRemaining: 20,
      wallTimeStartMs: Date.now(),
    },
  });
}

const criteria: ILoopTerminationCriteria = {
  maxIterations: 10,
  maxTokens: 100_000,
  timeoutMs: 60_000,
};

async function collectEvents(
  gen: AsyncIterable<IAgentEvent>,
): Promise<IAgentEvent[]> {
  const events: IAgentEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

function makeBrain(overrides: Partial<ILeaderBrain> = {}): ILeaderBrain {
  return {
    intent: jest.fn(async () => ({ goal: "Research AI trends" })),
    plan: jest.fn(async () => [
      { id: "t1", type: "research", input: { topic: "AI" } } as LeaderTask,
    ]),
    selectWorker: jest.fn(async (task: LeaderTask) => ({
      workerName: `worker-${task.type}`,
      workerInput: task.input,
    })),
    review: jest.fn(async () => ({ decision: "accept_all" as const })),
    answerClarification: jest.fn(async () => "Clarification answer"),
    ...overrides,
  };
}

// ─── budget.exhausted() path ──────────────────────────────────────────────────

describe("LeaderWorkerLoop supplement — budget exhausted", () => {
  it("emits budget_warning and terminates when budget is exhausted", async () => {
    const brain = makeBrain();
    const loop = new LeaderWorkerLoop();
    const budgetMock = {
      exhausted: jest.fn().mockReturnValue(true),
    };

    const events = await collectEvents(
      loop.run(makeEnvelope(), criteria, {
        leaderWorker: { leader: brain },
        budget: budgetMock as never,
      }),
    );

    const budgetWarning = events.find((e) => e.type === "budget_warning");
    const terminated = events.find((e) => e.type === "terminated");

    expect(budgetWarning).toBeDefined();
    expect((budgetWarning!.payload as { severity: string }).severity).toBe(
      "exhausted",
    );
    expect(terminated).toBeDefined();
    expect((terminated!.payload as { reason: string }).reason).toBe("budget");
  });
});

// ─── runWorker() catch path ───────────────────────────────────────────────────

describe("LeaderWorkerLoop supplement — runWorker selectWorker throws", () => {
  it("returns failed WorkerResult when selectWorker throws", async () => {
    const brain = makeBrain({
      selectWorker: jest.fn(async () => {
        throw new Error("worker selection failed");
      }),
      review: jest.fn(async () => ({ decision: "accept_all" as const })),
    });
    const loop = new LeaderWorkerLoop();

    const events = await collectEvents(
      loop.run(makeEnvelope(), criteria, {
        leaderWorker: { leader: brain, maxReviewRounds: 2 },
      }),
    );

    // Even when selectWorker throws, the loop produces action_executed events
    const executed = events.filter((e) => e.type === "action_executed");
    expect(executed.length).toBeGreaterThan(0);
    // The loop should still terminate
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated).toBeDefined();
  });

  it("action_executed event has error output when worker fails", async () => {
    const brain = makeBrain({
      selectWorker: jest.fn(async () => {
        throw new Error("selector error");
      }),
      review: jest.fn(async () => ({ decision: "accept_all" as const })),
    });
    const loop = new LeaderWorkerLoop();

    const events = await collectEvents(
      loop.run(makeEnvelope(), criteria, {
        leaderWorker: { leader: brain, maxReviewRounds: 1 },
      }),
    );

    const actionExecuted = events.find((e) => e.type === "action_executed");
    expect(actionExecuted).toBeDefined();
    const payload = actionExecuted!.payload as {
      output: { error: string };
      error?: Error;
    };
    // When worker fails, output contains { error: "..." }
    expect(payload.output.error).toBeDefined();
  });
});

// ─── revise decision without retryTaskIds ─────────────────────────────────────

describe("LeaderWorkerLoop supplement — revise with no retryTaskIds", () => {
  it("handles revise decision with empty retryTaskIds gracefully", async () => {
    let reviewCount = 0;
    const brain = makeBrain({
      review: jest.fn(async () => {
        reviewCount++;
        if (reviewCount === 1) {
          // revise but no retryTaskIds → the retryTaskIds?.length check is falsy
          return {
            decision: "revise" as const,
            // retryTaskIds omitted intentionally
          };
        }
        return { decision: "accept_all" as const };
      }),
    });
    const loop = new LeaderWorkerLoop();

    const events = await collectEvents(
      loop.run(makeEnvelope(), criteria, {
        leaderWorker: { leader: brain, maxReviewRounds: 5 },
      }),
    );

    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated).toBeDefined();
    expect(reviewCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── expand decision without newTasks ─────────────────────────────────────────

describe("LeaderWorkerLoop supplement — expand with no newTasks", () => {
  it("handles expand decision with missing newTasks gracefully", async () => {
    let reviewCount = 0;
    const brain = makeBrain({
      review: jest.fn(async () => {
        reviewCount++;
        if (reviewCount === 1) {
          // expand with no newTasks → newTasks?.length is falsy
          return { decision: "expand" as const };
        }
        return { decision: "accept_all" as const };
      }),
    });
    const loop = new LeaderWorkerLoop();

    const events = await collectEvents(
      loop.run(makeEnvelope(), criteria, {
        leaderWorker: { leader: brain, maxReviewRounds: 5 },
      }),
    );

    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated).toBeDefined();
  });
});

// ─── LeaderFeedbackChannel ────────────────────────────────────────────────────

describe("LeaderFeedbackChannel", () => {
  it("forwards question to leader.answerClarification", async () => {
    const brain = makeBrain();
    const channel = new LeaderFeedbackChannel(brain);
    const answer = await channel.askLeader("What topic should I focus on?");
    expect(brain.answerClarification).toHaveBeenCalledWith(
      "What topic should I focus on?",
    );
    expect(answer).toBe("Clarification answer");
  });
});

// ─── isStubImplementation = false path ───────────────────────────────────────

describe("LeaderWorkerLoop supplement — custom subclass", () => {
  it("runs successfully when isStubImplementation=false", async () => {
    class CustomLoop extends LeaderWorkerLoop {
      protected readonly isStubImplementation = false;
    }

    const brain = makeBrain();
    const loop = new CustomLoop();

    const events = await collectEvents(
      loop.run(makeEnvelope(), criteria, {
        leaderWorker: { leader: brain },
      }),
    );

    // Should still complete successfully
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated).toBeDefined();
    expect((terminated!.payload as { reason: string }).reason).toMatch(
      /completed|budget/,
    );
  });

  it("uses default agentId leader-worker when not provided in options", async () => {
    const brain = makeBrain();
    const loop = new LeaderWorkerLoop();

    const events = await collectEvents(
      loop.run(makeEnvelope(), criteria, {
        leaderWorker: { leader: brain },
        // agentId omitted → defaults to "leader-worker"
      }),
    );

    const hasDefaultAgentId = events.some((e) => e.agentId === "leader-worker");
    expect(hasDefaultAgentId).toBe(true);
  });
});

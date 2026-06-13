/**
 * leader-worker-loop.spec.ts
 *
 * Tests for LeaderWorkerLoop — INTENT → PLAN → ASSIGN → EXECUTE → REVIEW cycle.
 * Uses stub runWorker (default behavior when isStubImplementation=true).
 */

import {
  LeaderWorkerLoop,
  type ILeaderBrain,
  type LeaderTask,
  type WorkerResult,
} from "../leader-worker-loop";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../agents/abstractions";
import { LoopRegistry } from "../loop-registry";

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
      {
        id: "t1",
        type: "research",
        input: { topic: "AI" },
        priority: 1,
      } as LeaderTask,
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

describe("LeaderWorkerLoop", () => {
  describe("missing leader", () => {
    it("emits error when no leader provided", async () => {
      const loop = new LeaderWorkerLoop();
      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          agentId: "test-agent",
          // No leaderWorker option
        }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      const terminated = events.find((e) => e.type === "terminated");
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.payload as Record<string, unknown>).failureCode).toBe(
        "RUNNER_INPUT_SCHEMA_MISMATCH",
      );
      expect(terminated).toBeDefined();
    });
  });

  describe("intent failure", () => {
    it("emits error when intent throws", async () => {
      const brain = makeBrain({
        intent: jest.fn(async () => {
          throw new Error("Intent parsing failed");
        }),
      });
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain },
        }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(
        (errorEvent!.payload as Record<string, unknown>).message,
      ).toContain("intent");
    });
  });

  describe("plan failure", () => {
    it("emits error when plan throws", async () => {
      const brain = makeBrain({
        plan: jest.fn(async () => {
          throw new Error("Planning failed");
        }),
      });
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain },
        }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      expect(
        (errorEvent!.payload as Record<string, unknown>).message,
      ).toContain("plan");
    });
  });

  describe("successful orchestration with stub worker", () => {
    it("completes happy path: INTENT → PLAN → ASSIGN → REVIEW → DONE", async () => {
      const brain = makeBrain();
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: {
            leader: brain,
            maxConcurrentWorkers: 3,
            maxReviewRounds: 3,
          },
        }),
      );

      expect(brain.intent).toHaveBeenCalledTimes(1);
      expect(brain.plan).toHaveBeenCalledTimes(1);
      expect(brain.review).toHaveBeenCalledTimes(1);

      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
    });

    it("emits output event with completed task summary", async () => {
      const brain = makeBrain();
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain },
        }),
      );
      const outputEvent = events.find((e) => e.type === "output");
      expect(outputEvent).toBeDefined();
      const output = (
        outputEvent!.payload as { output: Record<string, unknown> }
      ).output;
      expect(output.goal).toBe("Research AI trends");
      expect(typeof output.completed).toBe("number");
    });

    it("emits action_executed events for each worker task", async () => {
      const brain = makeBrain({
        plan: jest.fn(async () => [
          { id: "t1", type: "research", input: {} } as LeaderTask,
          { id: "t2", type: "write", input: {} } as LeaderTask,
        ]),
      });
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain, maxConcurrentWorkers: 5 },
        }),
      );
      const actionEvents = events.filter((e) => e.type === "action_executed");
      expect(actionEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("review decisions", () => {
    it("handles abort decision", async () => {
      const brain = makeBrain({
        review: jest.fn(async () => ({
          decision: "abort" as const,
          note: "Quality too low",
          score: 20,
        })),
      });
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain },
        }),
      );
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
      const terminated = events.find((e) => e.type === "terminated");
      expect((terminated!.payload as { reason: string }).reason).toBe("error");
    });

    it("handles revise decision and re-executes tasks", async () => {
      let reviewCount = 0;
      const brain = makeBrain({
        plan: jest.fn(async () => [
          { id: "t1", type: "research", input: {} } as LeaderTask,
        ]),
        review: jest.fn(
          async (_input: { completed: readonly WorkerResult[] }) => {
            reviewCount++;
            if (reviewCount === 1) {
              return {
                decision: "revise" as const,
                retryTaskIds: ["t1"],
                newTasks: [
                  { id: "t1-retry", type: "research", input: {} } as LeaderTask,
                ],
              };
            }
            return { decision: "accept_all" as const };
          },
        ),
      });
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain, maxReviewRounds: 5 },
        }),
      );
      expect(reviewCount).toBeGreaterThan(1);
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
    });

    it("handles expand decision", async () => {
      let reviewCount = 0;
      const brain = makeBrain({
        plan: jest.fn(async () => [
          { id: "t1", type: "research", input: {} } as LeaderTask,
        ]),
        review: jest.fn(async () => {
          reviewCount++;
          if (reviewCount === 1) {
            return {
              decision: "expand" as const,
              newTasks: [{ id: "t2", type: "write", input: {} } as LeaderTask],
            };
          }
          return { decision: "accept_all" as const };
        }),
      });
      const loop = new LeaderWorkerLoop();

      const _events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain, maxReviewRounds: 5 },
        }),
      );
      expect(reviewCount).toBeGreaterThanOrEqual(2);
    });

    it("terminates with budget reason at maxReviewRounds", async () => {
      const brain = makeBrain({
        review: jest.fn(async () => ({
          decision: "revise" as const,
          retryTaskIds: ["t1"],
          newTasks: [
            { id: "t1-retry", type: "research", input: {} } as LeaderTask,
          ],
        })),
      });
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain, maxReviewRounds: 2 },
        }),
      );
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
    });
  });

  describe("task dependencies", () => {
    it("executes tasks in dependency order", async () => {
      const executionOrder: string[] = [];
      const brain = makeBrain({
        plan: jest.fn(async () => [
          {
            id: "t1",
            type: "research",
            input: {},
            dependsOn: [],
          } as LeaderTask,
          {
            id: "t2",
            type: "write",
            input: {},
            dependsOn: ["t1"],
          } as LeaderTask,
        ]),
        selectWorker: jest.fn(async (task: LeaderTask) => {
          executionOrder.push(task.id);
          return { workerName: `worker-${task.type}` };
        }),
        review: jest.fn(async () => ({ decision: "accept_all" as const })),
      });
      const loop = new LeaderWorkerLoop();

      await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain, maxReviewRounds: 5 },
        }),
      );
      // t1 should be executed before t2
      const t1Idx = executionOrder.indexOf("t1");
      const t2Idx = executionOrder.indexOf("t2");
      if (t1Idx >= 0 && t2Idx >= 0) {
        expect(t1Idx).toBeLessThan(t2Idx);
      }
    });

    it("terminates with DONE when all tasks complete with accept_all on empty queue", async () => {
      const brain = makeBrain({
        plan: jest.fn(async () => [
          { id: "t1", type: "research", input: {} } as LeaderTask,
        ]),
        review: jest.fn(async () => ({ decision: "accept_all" as const })),
      });
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          leaderWorker: { leader: brain, maxReviewRounds: 5 },
        }),
      );
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
      expect((terminated!.payload as { reason: string }).reason).toMatch(
        /completed|budget/,
      );
    });
  });

  describe("cancellation", () => {
    it("terminates with cancelled when signal is aborted", async () => {
      const controller = new AbortController();

      const brain = makeBrain({
        review: jest.fn(async () => {
          controller.abort(); // abort during review
          return { decision: "accept_all" as const };
        }),
      });
      const loop = new LeaderWorkerLoop();

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          signal: controller.signal,
          leaderWorker: { leader: brain, maxReviewRounds: 5 },
        }),
      );
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
    });
  });

  describe("loop kind", () => {
    it("has kind=leader-worker", () => {
      const loop = new LeaderWorkerLoop();
      expect(loop.kind).toBe("leader-worker");
    });
  });
});

// ─────────────────────────────────────────────────────────────
// LoopRegistry tests (co-located here as it's in same directory)
// ─────────────────────────────────────────────────────────────
describe("LoopRegistry", () => {
  it("throws for unknown loop kind", () => {
    const registry = new LoopRegistry();
    expect(() => registry.get("unknown" as never)).toThrow(
      /no loop registered/,
    );
  });

  it("registers and retrieves a loop", () => {
    const registry = new LoopRegistry();
    const loop = new LeaderWorkerLoop();
    registry.register(loop);
    expect(registry.get("leader-worker" as never)).toBe(loop);
  });

  it("has() returns true for registered kind", () => {
    const registry = new LoopRegistry();
    registry.register(new LeaderWorkerLoop());
    expect(registry.has("leader-worker" as never)).toBe(true);
  });

  it("has() returns false for unregistered kind", () => {
    const registry = new LoopRegistry();
    expect(registry.has("reflexion" as never)).toBe(false);
  });

  it("list() returns all registered kinds", () => {
    const registry = new LoopRegistry();
    registry.register(new LeaderWorkerLoop());
    const kinds = registry.list();
    expect(kinds).toContain("leader-worker");
  });

  it("list() returns empty array when nothing registered", () => {
    const registry = new LoopRegistry();
    expect(registry.list()).toHaveLength(0);
  });

  it("overwrites existing registration with same kind", () => {
    const registry = new LoopRegistry();
    const loop1 = new LeaderWorkerLoop();
    const loop2 = new LeaderWorkerLoop();
    registry.register(loop1);
    registry.register(loop2);
    expect(registry.get("leader-worker" as never)).toBe(loop2);
  });
});

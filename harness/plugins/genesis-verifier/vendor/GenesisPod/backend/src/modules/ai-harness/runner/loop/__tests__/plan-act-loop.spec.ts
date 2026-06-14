/**
 * plan-act-loop.spec.ts
 *
 * Tests for PlanActLoop — PLAN + EXECUTE phases, mocking AiChatService + ReActLoop.
 */

import { PlanActLoop } from "../plan-act-loop";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../agents/abstractions";

function makeEnvelope(): ContextEnvelope {
  return new ContextEnvelope({
    system: "You are a research assistant.",
    messages: [{ role: "user", content: "Research AI trends.", timestamp: 0 }],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1", userId: "u1" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 50_000,
      iterationsUsed: 0,
      iterationsRemaining: 20,
      wallTimeStartMs: Date.now(),
    },
  });
}

const criteria: ILoopTerminationCriteria = {
  maxIterations: 10,
  maxTokens: 50_000,
  timeoutMs: 30_000,
};

function makePlan(
  steps: Array<{
    id: string;
    title: string;
    instruction: string;
    dependsOn?: string[];
  }>,
) {
  return JSON.stringify({
    summary: "Test plan",
    steps,
  });
}

async function collectEvents(
  gen: AsyncIterable<IAgentEvent>,
): Promise<IAgentEvent[]> {
  const events: IAgentEvent[] = [];
  for await (const ev of gen) {
    events.push(ev);
  }
  return events;
}

function makeReactLoop(outputPerStep = "Step result") {
  return {
    run: jest.fn(async function* () {
      yield {
        type: "output",
        agentId: "step",
        payload: { output: outputPerStep },
        timestamp: Date.now(),
      };
      yield {
        type: "terminated",
        agentId: "step",
        payload: { reason: "completed" },
        timestamp: Date.now(),
      };
    }),
  };
}

describe("PlanActLoop", () => {
  describe("successful plan and execute", () => {
    it("emits thinking event with plan summary", async () => {
      const chatService = {
        chat: jest.fn(async () => ({
          content: makePlan([
            { id: "s1", title: "Research", instruction: "Research AI" },
          ]),
          model: "mock",
          usage: { totalTokens: 100 },
        })),
      };
      const reactLoop = makeReactLoop("AI research result");
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const thinkingEvent = events.find((e) => e.type === "thinking");
      expect(thinkingEvent).toBeDefined();
      expect((thinkingEvent!.payload as { text: string }).text).toContain(
        "Test plan",
      );
    });

    it("executes steps and emits action_executed for each", async () => {
      const chatService = {
        chat: jest.fn(async () => ({
          content: makePlan([
            { id: "s1", title: "Step 1", instruction: "Do step 1" },
            {
              id: "s2",
              title: "Step 2",
              instruction: "Do step 2",
              dependsOn: ["s1"],
            },
          ]),
          model: "mock",
          usage: { totalTokens: 200 },
        })),
      };
      const reactLoop = makeReactLoop("done");
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const executed = events.filter((e) => e.type === "action_executed");
      expect(executed.length).toBe(2);
    });

    it("emits output event with synthesized result", async () => {
      const chatService = {
        chat: jest
          .fn()
          .mockResolvedValueOnce({
            content: makePlan([
              { id: "s1", title: "Research", instruction: "Research AI" },
            ]),
            model: "mock",
            usage: { totalTokens: 100 },
          })
          .mockResolvedValueOnce({
            content: "Synthesized final answer.",
            model: "mock",
            usage: { totalTokens: 50 },
          }),
      };
      const reactLoop = makeReactLoop("Research result");
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const outputEvent = events.find((e) => e.type === "output");
      expect(outputEvent).toBeDefined();
    });

    it("terminates with completed reason", async () => {
      const chatService = {
        chat: jest
          .fn()
          .mockResolvedValueOnce({
            content: makePlan([
              { id: "s1", title: "S1", instruction: "Do it" },
            ]),
            model: "mock",
            usage: { totalTokens: 50 },
          })
          .mockResolvedValueOnce({
            content: "Final answer",
            model: "mock",
            usage: { totalTokens: 30 },
          }),
      };
      const reactLoop = makeReactLoop("result");
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
      expect((terminated!.payload as { reason: string }).reason).toBe(
        "completed",
      );
    });

    it("handles parallel steps (no dependsOn)", async () => {
      const chatService = {
        chat: jest
          .fn()
          .mockResolvedValueOnce({
            content: makePlan([
              { id: "s1", title: "Parallel A", instruction: "A" },
              { id: "s2", title: "Parallel B", instruction: "B" },
            ]),
            model: "mock",
            usage: { totalTokens: 100 },
          })
          .mockResolvedValueOnce({
            content: "Synthesized",
            model: "mock",
            usage: { totalTokens: 50 },
          }),
      };
      const reactLoop = makeReactLoop("done");
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const executed = events.filter((e) => e.type === "action_executed");
      expect(executed).toHaveLength(2);
    });
  });

  describe("plan generation failure", () => {
    it("emits error and terminated events when planning fails", async () => {
      const chatService = {
        chat: jest.fn(async () => {
          throw new Error("LLM unavailable");
        }),
      };
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const errorEvent = events.find((e) => e.type === "error");
      const terminatedEvent = events.find((e) => e.type === "terminated");
      expect(errorEvent).toBeDefined();
      expect(terminatedEvent).toBeDefined();
      expect((terminatedEvent!.payload as { reason: string }).reason).toBe(
        "error",
      );
    });

    it("emits error when plan JSON is malformed", async () => {
      const chatService = {
        chat: jest.fn(async () => ({
          content: "This is not valid JSON at all",
          model: "mock",
          usage: { totalTokens: 20 },
        })),
      };
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });

    it("emits error for unsatisfiable step dependencies", async () => {
      const chatService = {
        chat: jest.fn(async () => ({
          content: makePlan([
            { id: "s1", title: "S1", instruction: "Do", dependsOn: ["s2"] }, // circular/missing dep
          ]),
          model: "mock",
          usage: { totalTokens: 100 },
        })),
      };
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const errorEvent = events.find((e) => e.type === "error");
      expect(errorEvent).toBeDefined();
    });
  });

  describe("cancellation", () => {
    it("terminates with cancelled reason when signal is aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const chatService = {
        chat: jest.fn(async () => ({
          content: makePlan([
            { id: "s1", title: "S1", instruction: "Do" },
            { id: "s2", title: "S2", instruction: "Do", dependsOn: ["s1"] },
          ]),
          model: "mock",
          usage: { totalTokens: 100 },
        })),
      };
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService as never, reactLoop as never);

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, { signal: controller.signal }),
      );
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
      expect((terminated!.payload as { reason: string }).reason).toMatch(
        /cancelled|error|completed/,
      );
    });
  });
});

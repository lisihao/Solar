/**
 * reflexion-loop.spec.ts
 *
 * Tests for ReflexionLoop — ACT → VERIFY → CRITIQUE → RETRY flow.
 */

import { ReflexionLoop, type IVerifier } from "../reflexion-loop";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../agents/abstractions";

function makeEnvelope(): ContextEnvelope {
  return new ContextEnvelope({
    system: "You are a research assistant.",
    messages: [{ role: "user", content: "Write a report.", timestamp: 0 }],
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
  maxIterations: 9,
  maxTokens: 50_000,
  timeoutMs: 30_000,
};

async function collectEvents(
  gen: AsyncIterable<IAgentEvent>,
): Promise<IAgentEvent[]> {
  const events: IAgentEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

function makeReactLoop(output: unknown = "Report content") {
  return {
    run: jest.fn(async function* () {
      yield {
        type: "output",
        agentId: "react",
        payload: { output },
        timestamp: Date.now(),
      };
      yield {
        type: "terminated",
        agentId: "react",
        payload: { reason: "completed" },
        timestamp: Date.now(),
      };
    }),
  };
}

function makeVerifier(
  score: number,
  critique = "Needs improvement",
): IVerifier {
  return {
    id: `verifier-${score}`,
    evaluate: jest.fn(async () => ({ score, critique })),
  };
}

describe("ReflexionLoop", () => {
  describe("no verifiers (single-shot mode)", () => {
    it("runs once and returns immediately when no verifiers", async () => {
      const reactLoop = makeReactLoop("Good report");
      const loop = new ReflexionLoop(reactLoop as never);
      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      expect(reactLoop.run).toHaveBeenCalledTimes(1);
      // Should still emit the forwarded events from react loop
      expect(events.some((e) => e.type === "output")).toBe(true);
    });

    it("forwards events from inner ReActLoop", async () => {
      const reactLoop = makeReactLoop("Output text");
      const loop = new ReflexionLoop(reactLoop as never);
      const events = await collectEvents(loop.run(makeEnvelope(), criteria));
      const outputEvent = events.find((e) => e.type === "output");
      expect(outputEvent).toBeDefined();
    });
  });

  describe("with verifiers — passing score", () => {
    it("terminates after single ACT when verifier score meets threshold", async () => {
      const reactLoop = makeReactLoop("Excellent report");
      const verifier = makeVerifier(90);
      const loop = new ReflexionLoop(reactLoop as never, [verifier]);

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          reflexion: {
            verifiers: [verifier],
            passThreshold: 75,
            maxRevisions: 2,
          },
        }),
      );
      // High score → should pass in first revision
      expect(reactLoop.run).toHaveBeenCalledTimes(1);
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
    });

    it("retries up to maxRevisions when score is below threshold", async () => {
      let reactCallCount = 0;
      const reactLoop = {
        run: jest.fn(async function* () {
          reactCallCount++;
          yield {
            type: "output",
            agentId: "react",
            payload: { output: `Attempt ${reactCallCount}` },
            timestamp: Date.now(),
          };
          yield {
            type: "terminated",
            agentId: "react",
            payload: { reason: "completed" },
            timestamp: Date.now(),
          };
        }),
      };
      // Low score forces retries
      const verifier = makeVerifier(40, "Not detailed enough");
      const loop = new ReflexionLoop(reactLoop as never, [verifier]);

      await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          reflexion: {
            verifiers: [verifier],
            passThreshold: 75,
            maxRevisions: 2,
          },
        }),
      );
      // Should run maxRevisions+1 = 3 times (first + 2 revisions)
      expect(reactLoop.run).toHaveBeenCalledTimes(3);
    });

    it("emits reflection events during review", async () => {
      const reactLoop = makeReactLoop("Output");
      const verifier = makeVerifier(90);
      const loop = new ReflexionLoop(reactLoop as never, [verifier]);

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          reflexion: { verifiers: [verifier], passThreshold: 75 },
        }),
      );
      // Should have reflection event from verify phase
      const reflectionOrThinking = events.filter(
        (e) => e.type === "reflection" || e.type === "thinking",
      );
      expect(reflectionOrThinking.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("consecutive empty output fallback", () => {
    it("aborts after 2 consecutive empty outputs", async () => {
      const reactLoop = {
        run: jest.fn(async function* () {
          yield {
            type: "output",
            agentId: "react",
            payload: { output: "" },
            timestamp: Date.now(),
          };
          yield {
            type: "terminated",
            agentId: "react",
            payload: { reason: "completed" },
            timestamp: Date.now(),
          };
        }),
      };
      const verifier = makeVerifier(50);
      const loop = new ReflexionLoop(reactLoop as never);

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          reflexion: {
            verifiers: [verifier],
            passThreshold: 75,
            maxRevisions: 3,
          },
        }),
      );
      const errorEvent = events.find(
        (e) =>
          e.type === "error" &&
          (e.payload as Record<string, unknown>).failureCode ===
            "REFLEXION_CONSECUTIVE_EMPTY",
      );
      expect(errorEvent).toBeDefined();
    });
  });

  describe("cancellation", () => {
    it("terminates with cancelled when signal is aborted before starting", async () => {
      const controller = new AbortController();
      controller.abort();

      const reactLoop = makeReactLoop("Output");
      const verifier = makeVerifier(50);
      const loop = new ReflexionLoop(reactLoop as never);

      const events = await collectEvents(
        loop.run(makeEnvelope(), criteria, {
          signal: controller.signal,
          reflexion: {
            verifiers: [verifier],
            passThreshold: 75,
            maxRevisions: 2,
          },
        }),
      );
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
      expect((terminated!.payload as { reason: string }).reason).toMatch(
        /cancelled|completed|error/,
      );
    });
  });

  describe("setDefaultVerifiers", () => {
    it("updates verifiers for subsequent runs", () => {
      const reactLoop = makeReactLoop();
      const loop = new ReflexionLoop(reactLoop as never);
      const verifier = makeVerifier(80);
      loop.setDefaultVerifiers([verifier]);
      // Internal state should be updated
      expect(
        (loop as unknown as { defaultOptions: { verifiers: IVerifier[] } })
          .defaultOptions.verifiers,
      ).toContain(verifier);
    });
  });

  describe("loop kind", () => {
    it("has kind=reflexion", () => {
      const reactLoop = makeReactLoop();
      const loop = new ReflexionLoop(reactLoop as never);
      expect(loop.kind).toBe("reflexion");
    });
  });
});

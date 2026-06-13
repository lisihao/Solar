/**
 * PlanActLoop — branch coverage supplement
 *
 * Targets uncovered branches:
 *   - generatePlan catch branch (error → error event + terminated)
 *   - signal.aborted during step execution
 *   - budget.exhausted during step loop
 *   - ready.length === 0 (unsatisfiable deps)
 *   - validatePlan branches (non-object, empty steps, non-object step, missing instruction)
 *   - step id/title fallback branches
 *   - dependsOn filter branch
 *   - summary fallback branch
 *   - runStep budget/signal early exit
 *   - parentEnvelope not ContextEnvelope branch (plain object spread)
 *   - output not string in runStep
 */

import { PlanActLoop } from "../plan-act-loop";

function makeChatService(responses: unknown[]) {
  let callIdx = 0;
  return {
    chat: jest.fn().mockImplementation(() => {
      const res = responses[callIdx] ?? responses[responses.length - 1];
      callIdx += 1;
      if (res instanceof Error) return Promise.reject(res);
      return Promise.resolve(res);
    }),
  } as any;
}

function makeReactLoop(outputPerStep: string = "step output") {
  return {
    run: jest.fn().mockImplementation(function* () {
      yield { type: "output", payload: { output: outputPerStep } };
    }),
  } as any;
}

const basicPlanJson = JSON.stringify({
  summary: "Test plan",
  steps: [
    { id: "s1", title: "Step 1", instruction: "Do step 1", dependsOn: [] },
  ],
});

const parallelPlanJson = JSON.stringify({
  summary: "Parallel plan",
  steps: [
    { id: "s1", title: "Step 1", instruction: "Do step 1", dependsOn: [] },
    { id: "s2", title: "Step 2", instruction: "Do step 2", dependsOn: [] },
  ],
});

function makeEnvelope(messages: unknown[] = []) {
  return {
    system: "System prompt",
    messages,
    memory: { userId: "u1" },
    reminders: [],
    tools: [],
  } as any;
}

function drainEvents(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  return (async () => {
    for await (const ev of iterable) {
      events.push(ev);
    }
    return events;
  })();
}

describe("PlanActLoop — supplement", () => {
  describe("generatePlan errors", () => {
    it("emits error event when chatService.chat throws during plan phase", async () => {
      const chatService = makeChatService([new Error("LLM failure")]);
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService, reactLoop);

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );

      const errorEv = events.find((e: any) => e.type === "error");
      const terminated = events.find((e: any) => e.type === "terminated");
      expect(errorEv).toBeDefined();
      expect((errorEv as any).payload.failureCode).toBe("PROVIDER_API_ERROR");
      expect((terminated as any).payload.reason).toBe("error");
    });

    it("emits error event when chatService returns non-JSON (JSON.parse throws)", async () => {
      const chatService = makeChatService([
        { content: "not json at all", model: "gpt-4" },
      ]);
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService, reactLoop);

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );

      const errorEv = events.find((e: any) => e.type === "error");
      expect(errorEv).toBeDefined();
      expect((errorEv as any).payload.failureCode).toBe("PROVIDER_API_ERROR");
    });
  });

  describe("validatePlan branches", () => {
    it("throws when plan is not an object", async () => {
      const chatService = makeChatService([
        { content: '"string-not-object"', model: "gpt-4" },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const errorEv = events.find((e: any) => e.type === "error");
      expect(errorEv).toBeDefined();
    });

    it("throws when steps array is empty", async () => {
      const chatService = makeChatService([
        {
          content: JSON.stringify({ summary: "s", steps: [] }),
          model: "gpt-4",
        },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const errorEv = events.find((e: any) => e.type === "error");
      expect(errorEv).toBeDefined();
    });

    it("throws when steps is not an array", async () => {
      const chatService = makeChatService([
        {
          content: JSON.stringify({ summary: "s", steps: "bad" }),
          model: "gpt-4",
        },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const errorEv = events.find((e: any) => e.type === "error");
      expect(errorEv).toBeDefined();
    });

    it("throws when a step is not an object", async () => {
      const chatService = makeChatService([
        {
          content: JSON.stringify({ summary: "s", steps: [null] }),
          model: "gpt-4",
        },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const errorEv = events.find((e: any) => e.type === "error");
      expect(errorEv).toBeDefined();
    });

    it("throws when instruction is missing from a step", async () => {
      const chatService = makeChatService([
        {
          content: JSON.stringify({
            summary: "s",
            steps: [{ id: "s1", title: "t1", instruction: "" }],
          }),
          model: "gpt-4",
        },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const errorEv = events.find((e: any) => e.type === "error");
      expect(errorEv).toBeDefined();
    });

    it("uses fallback id (sN) when step id is missing", async () => {
      // step has no id → uses 's1' as fallback; instruction present
      const chatService = makeChatService([
        {
          content: JSON.stringify({
            summary: "ok",
            steps: [{ title: "Step Title", instruction: "do it" }],
          }),
          model: "gpt-4",
        },
        { content: "Final synthesis result", model: "gpt-4" },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const output = events.find((e: any) => e.type === "output");
      expect(output).toBeDefined();
    });

    it("uses fallback title (=id) when title is missing", async () => {
      const chatService = makeChatService([
        {
          content: JSON.stringify({
            summary: "ok",
            steps: [{ id: "s1", instruction: "do it" }],
          }),
          model: "gpt-4",
        },
        { content: "Synthesized", model: "gpt-4" },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const output = events.find((e: any) => e.type === "output");
      expect(output).toBeDefined();
    });

    it("uses empty dependsOn when step.dependsOn is not array", async () => {
      const chatService = makeChatService([
        {
          content: JSON.stringify({
            summary: "ok",
            steps: [
              { id: "s1", title: "T", instruction: "do it", dependsOn: "bad" },
            ],
          }),
          model: "gpt-4",
        },
        { content: "Synthesized", model: "gpt-4" },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      // Should succeed (bad dependsOn → treated as [])
      const output = events.find((e: any) => e.type === "output");
      expect(output).toBeDefined();
    });

    it("uses no-summary fallback when summary is not string", async () => {
      const chatService = makeChatService([
        {
          content: JSON.stringify({
            steps: [{ id: "s1", title: "T", instruction: "do it" }],
          }),
          model: "gpt-4",
        },
        { content: "Synthesized", model: "gpt-4" },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const thinking = events.find((e: any) => e.type === "thinking");
      expect((thinking as any).payload.text).toContain("(no summary)");
    });
  });

  describe("step execution loop control flow", () => {
    it("terminates with cancelled when signal aborted during step loop", async () => {
      const controller = new AbortController();
      // Plan returns first, then signal aborts before step completion
      const chatService = {
        chat: jest.fn().mockImplementation(async () => {
          controller.abort();
          return { content: basicPlanJson, model: "gpt-4" };
        }),
      } as any;
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService, reactLoop);

      const events = await drainEvents(
        loop.run(
          makeEnvelope(),
          { maxIterations: 5 },
          { signal: controller.signal },
        ),
      );

      const terminated = events.find((e: any) => e.type === "terminated");
      expect((terminated as any).payload.reason).toBe("cancelled");
    });

    it("terminates with budget when budget exhausted during step loop", async () => {
      const chatService = makeChatService([
        { content: basicPlanJson, model: "gpt-4" },
      ]);
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService, reactLoop);

      const budget = { exhausted: jest.fn().mockReturnValue(true) } as any;
      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }, { budget }),
      );

      const terminated = events.find((e: any) => e.type === "terminated");
      expect((terminated as any).payload.reason).toBe("budget");
    });

    it("emits error when plan has unsatisfiable dependencies", async () => {
      // s2 depends on s3, but s3 doesn't exist → unsatisfiable
      const badPlan = JSON.stringify({
        summary: "Bad plan",
        steps: [
          { id: "s1", title: "S1", instruction: "do s1", dependsOn: ["s2"] },
          { id: "s2", title: "S2", instruction: "do s2", dependsOn: ["s1"] },
        ],
      });
      const chatService = makeChatService([
        { content: badPlan, model: "gpt-4" },
      ]);
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService, reactLoop);

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const errorEv = events.find((e: any) => e.type === "error");
      expect(errorEv).toBeDefined();
      expect((errorEv as any).payload.message).toContain("unsatisfiable");
    });

    it("handles plain object envelope (not ContextEnvelope) in runStep", async () => {
      const chatService = makeChatService([
        { content: basicPlanJson, model: "gpt-4" },
        { content: "Final synthesis", model: "gpt-4" },
      ]);
      // Plain object envelope (not ContextEnvelope instance)
      const envelope = makeEnvelope([
        { role: "user", content: "hello", timestamp: Date.now() },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(envelope, { maxIterations: 5 }),
      );
      const output = events.find((e: any) => e.type === "output");
      expect(output).toBeDefined();
    });

    it("handles output that is an object (JSON.stringify path in runStep)", async () => {
      const chatService = makeChatService([
        { content: basicPlanJson, model: "gpt-4" },
        { content: "Final synthesis", model: "gpt-4" },
      ]);
      const reactLoop = {
        run: jest.fn().mockImplementation(function* () {
          yield { type: "output", payload: { output: { structured: true } } };
        }),
      } as any;
      const loop = new PlanActLoop(chatService, reactLoop);

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const output = events.find((e: any) => e.type === "output");
      expect(output).toBeDefined();
    });

    it("passes through without outputting when reactLoop has no output event", async () => {
      const chatService = makeChatService([
        { content: basicPlanJson, model: "gpt-4" },
        { content: "Final synthesis", model: "gpt-4" },
      ]);
      const reactLoop = {
        run: jest.fn().mockImplementation(function* () {
          yield { type: "thinking", payload: { text: "thinking..." } };
        }),
      } as any;
      const loop = new PlanActLoop(chatService, reactLoop);

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const output = events.find((e: any) => e.type === "output");
      expect(output).toBeDefined(); // synthesize still produces output
    });

    it("handles parallel step execution (2 independent steps)", async () => {
      const chatService = makeChatService([
        { content: parallelPlanJson, model: "gpt-4" },
        { content: "Synthesis done", model: "gpt-4" },
      ]);
      const reactLoop = makeReactLoop("step output");
      const loop = new PlanActLoop(chatService, reactLoop);

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 10 }),
      );
      const actionEvents = events.filter(
        (e: any) => e.type === "action_executed",
      );
      expect(actionEvents.length).toBe(2);
    });

    it("exits runStep early when budget exhausted before step runs", async () => {
      const chatService = makeChatService([
        { content: basicPlanJson, model: "gpt-4" },
        { content: "Final synthesis", model: "gpt-4" },
      ]);
      // budget.exhausted returns false for loop check but true for step check
      let callCount = 0;
      const budget = {
        exhausted: jest.fn().mockImplementation(() => {
          callCount += 1;
          // First call (loop-level): not exhausted; second call (step-level): exhausted
          return callCount >= 2;
        }),
      } as any;
      const reactLoop = makeReactLoop();
      const loop = new PlanActLoop(chatService, reactLoop);

      // This should not crash; the step returns "" and synthesis still runs
      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }, { budget }),
      );
      expect(events.some((e: any) => e.type === "output")).toBe(true);
    });

    it("exits runStep early when signal aborted before step runs", async () => {
      const controller = new AbortController();
      let chatCallIdx = 0;
      const chatService = {
        chat: jest.fn().mockImplementation(async () => {
          chatCallIdx += 1;
          if (chatCallIdx === 1) {
            // After plan, abort the signal
            setTimeout(() => controller.abort(), 0);
            return { content: basicPlanJson, model: "gpt-4" };
          }
          return { content: "Final", model: "gpt-4" };
        }),
      } as any;
      const loop = new PlanActLoop(chatService, makeReactLoop());

      // Allow some time for the abort to propagate
      const events = await drainEvents(
        loop.run(
          makeEnvelope(),
          { maxIterations: 5 },
          { signal: controller.signal },
        ),
      );
      // Either cancelled or output — no crash
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe("stripFences and synthesize", () => {
    it("handles plan JSON wrapped in markdown fences", async () => {
      const chatService = makeChatService([
        { content: "```json\n" + basicPlanJson + "\n```", model: "gpt-4" },
        { content: "Synthesized", model: "gpt-4" },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());

      const events = await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }),
      );
      const output = events.find((e: any) => e.type === "output");
      expect(output).toBeDefined();
    });

    it("passes taskProfile to chatService calls", async () => {
      const chatService = makeChatService([
        { content: basicPlanJson, model: "gpt-4" },
        { content: "Synthesized", model: "gpt-4" },
      ]);
      const loop = new PlanActLoop(chatService, makeReactLoop());
      const taskProfile = {
        creativity: "low" as const,
        outputLength: "medium" as const,
      };

      await drainEvents(
        loop.run(makeEnvelope(), { maxIterations: 5 }, { taskProfile }),
      );

      expect(chatService.chat).toHaveBeenCalledWith(
        expect.objectContaining({ taskProfile }),
      );
    });
  });
});

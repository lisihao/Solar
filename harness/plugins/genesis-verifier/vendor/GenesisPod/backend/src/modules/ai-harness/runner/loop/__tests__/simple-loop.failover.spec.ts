/**
 * SimpleLoop — model-level failover integration tests
 *
 * SimpleLoop powers all single-shot judge/review/verify agents (dimension-quality-
 * judge, reviewers, verifier). Before this fix it had NO model failover, so a dead
 * default model killed those stages even when the user had other working models.
 *
 * Covers: throw path (provider error + BYOK key exhaustion), isError-return path,
 * and the no-provider passthrough (unchanged legacy behavior).
 */

import { Logger } from "@nestjs/common";
import { SimpleLoop } from "../simple-loop";
import type {
  IAgentEvent,
  IContextEnvelope,
} from "../../../agents/abstractions";

jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

const DEFAULT_CRITERIA = { maxIterations: 1 };

function makeEnvelope(userId = "u1"): IContextEnvelope {
  return {
    system: "you are a judge",
    messages: [{ role: "user", content: "grade this" }],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1", userId },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 1000,
      iterationsUsed: 0,
      iterationsRemaining: 1,
      wallTimeStartMs: Date.now(),
    },
  } as unknown as IContextEnvelope;
}

async function drain(it: AsyncIterable<IAgentEvent>): Promise<IAgentEvent[]> {
  const evs: IAgentEvent[] = [];
  for await (const e of it) evs.push(e);
  return evs;
}

const success = (model: string) => ({
  content: '{"score":5}',
  isError: false,
  model,
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
});

const byokErr = (code: string, message: string): Error => {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
};

describe("SimpleLoop — model-level failover", () => {
  it("THROW provider error on default model → fails over → output", async () => {
    const chat = jest.fn(async (opts: { model?: string }) => {
      if (!opts.model) throw new Error("503 service unavailable");
      return success(opts.model);
    });
    const loop = new SimpleLoop({ chat } as never);
    const provider = jest.fn(async () => "model-b");

    const events = await drain(
      loop.run(makeEnvelope(), DEFAULT_CRITERIA, {
        agentId: "judge",
        modelFailoverProvider: provider,
      }),
    );

    const output = events.find((e) => e.type === "output");
    const terminated = events.find((e) => e.type === "terminated");
    expect(output).toBeDefined();
    expect((terminated?.payload as { reason: string }).reason).toBe(
      "completed",
    );
    expect(provider).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("THROW BYOK NO_AVAILABLE_KEY → fails over to a model with a key", async () => {
    const chat = jest.fn(async (opts: { model?: string }) => {
      if (!opts.model)
        throw byokErr(
          "NO_AVAILABLE_KEY",
          'No API Key available for provider "deepseek"',
        );
      return success(opts.model);
    });
    const loop = new SimpleLoop({ chat } as never);
    const provider = jest.fn(async () => "grok-4");

    const events = await drain(
      loop.run(makeEnvelope(), DEFAULT_CRITERIA, {
        agentId: "judge",
        modelFailoverProvider: provider,
      }),
    );

    expect(events.find((e) => e.type === "output")).toBeDefined();
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("isError-RETURN provider error → fails over → output", async () => {
    let call = 0;
    const chat = jest.fn(async (opts: { model?: string }) => {
      call += 1;
      if (call === 1)
        return {
          content: "PROVIDER_API_ERROR: upstream 500",
          isError: true,
          model: "model-a",
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
        };
      return success(opts.model ?? "model-b");
    });
    const loop = new SimpleLoop({ chat } as never);
    const provider = jest.fn(async () => "model-b");

    const events = await drain(
      loop.run(makeEnvelope(), DEFAULT_CRITERIA, {
        agentId: "judge",
        modelFailoverProvider: provider,
      }),
    );

    expect(events.find((e) => e.type === "output")).toBeDefined();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("no provider → provider error surfaces as error+terminated (legacy)", async () => {
    const chat = jest.fn(async () => {
      throw new Error("503 service unavailable");
    });
    const loop = new SimpleLoop({ chat } as never);

    const events = await drain(
      loop.run(makeEnvelope(), DEFAULT_CRITERIA, { agentId: "judge" }),
    );

    expect(events.some((e) => e.type === "error")).toBe(true);
    const terminated = events.find((e) => e.type === "terminated");
    expect((terminated?.payload as { reason: string }).reason).toBe("error");
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

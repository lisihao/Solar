/**
 * ReActLoop — model-level failover tests
 *
 * Verifies:
 *   1. When reason() throws PROVIDER_API_ERROR and modelFailoverProvider returns
 *      model-B, the loop retries reason() with model-B and proceeds to finalize.
 *   2. AbortError does NOT trigger model-level failover.
 *   3. When modelFailoverProvider returns null (no more candidates) the loop
 *      falls through to the existing error/terminated path.
 */

import { ReActLoop } from "../react-loop";
import { HookRegistry } from "../../../agents/core/hook-registry";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import { ToolInvoker } from "../../tool-invoker/tool-invoker";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../agents/abstractions";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeEnvelope(userId?: string): ContextEnvelope {
  return new ContextEnvelope({
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Hello", timestamp: 0 }],
    reminders: [],
    tools: [],
    memory: { sessionId: "s1", userId },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 10_000,
      iterationsUsed: 0,
      iterationsRemaining: 10,
      wallTimeStartMs: Date.now(),
    },
  });
}

async function drain(iter: AsyncIterable<IAgentEvent>): Promise<IAgentEvent[]> {
  const out: IAgentEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

const criteria: ILoopTerminationCriteria = {
  maxIterations: 5,
  terminateOn: ["finalize"],
};

const finalizeResponse = JSON.stringify({
  thinking: "done",
  action: { kind: "finalize", output: "ok" },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeLoopWithChat(chatFn: (args: any) => Promise<any>): ReActLoop {
  const chatService = { chat: jest.fn(chatFn) };
  const toolRegistry = {
    has: jest.fn(() => false),
    get: jest.fn(() => undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoker = new ToolInvoker(toolRegistry as any);
  const hooks = new HookRegistry();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ReActLoop(chatService as any, invoker, hooks);
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("ReActLoop — model-level failover", () => {
  it("retries reason() with model-B when first model throws PROVIDER_API_ERROR", async () => {
    const calledWithModels: (string | undefined)[] = [];

    const loop = makeLoopWithChat(async (args) => {
      calledWithModels.push(args.model as string | undefined);
      const model: string | undefined = args.model as string | undefined;
      if (!model || model === "model-a") {
        throw new Error("PROVIDER_API_ERROR: model-a is down");
      }
      // model-b succeeds
      return {
        content: finalizeResponse,
        model: model,
        usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
      };
    });

    const failoverProvider = jest.fn(
      async (
        excludeModelIds: ReadonlyArray<string>,
      ): Promise<string | null> => {
        if (!excludeModelIds.includes("model-b")) return "model-b";
        return null;
      },
    );

    const events = await drain(
      loop.run(makeEnvelope("user-1"), criteria, {
        agentId: "test-agent",
        preferredModelId: "model-a",
        modelFailoverProvider: failoverProvider,
      }),
    );

    // failoverProvider must have been called once (model-a failed)
    expect(failoverProvider).toHaveBeenCalledTimes(1);
    // Called with (excludeModelIds, excludeProviders) — model-a in the excludes.
    expect(failoverProvider).toHaveBeenCalledWith(
      expect.arrayContaining(["model-a"]),
      expect.anything(),
    );

    // The second chat call must use model-b
    const modelBCallIndex = calledWithModels.findIndex((m) => m === "model-b");
    expect(modelBCallIndex).toBeGreaterThan(-1);

    // The loop must complete successfully
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "completed" });

    const output = events.find((e) => e.type === "output");
    expect(output?.payload).toMatchObject({ output: "ok" });
  });

  it("extracts failed provider from error → passes excludeProviders (live xai-out-of-credits case)", async () => {
    // Reproduces the live failure: default model on xai fails ("provider xai"),
    // failover must skip ALL xai models and jump to a different provider.
    const loop = makeLoopWithChat(async (args) => {
      const model = args.model as string | undefined;
      if (model === "gemini-2.5-flash") {
        return {
          content: finalizeResponse,
          model,
          usage: { totalTokens: 10, inputTokens: 5, outputTokens: 5 },
        };
      }
      throw new Error('All 1 API key(s) for provider "xai" failed');
    });

    const failoverProvider = jest.fn(
      async (
        _excludeModelIds: ReadonlyArray<string>,
        excludeProviders?: ReadonlyArray<string>,
      ): Promise<string | null> =>
        excludeProviders?.includes("xai") ? "gemini-2.5-flash" : "grok-other",
    );

    const events = await drain(
      loop.run(makeEnvelope("user-1"), criteria, {
        agentId: "test-agent",
        modelFailoverProvider: failoverProvider,
      }),
    );

    // provider "xai" extracted from the error and passed as excludeProviders
    expect(failoverProvider).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining(["xai"]),
    );
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "completed" });
  });

  it("does NOT trigger failover on AbortError", async () => {
    const loop = makeLoopWithChat(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    const failoverProvider = jest.fn(async (): Promise<string | null> => {
      return "model-b";
    });

    const events = await drain(
      loop.run(makeEnvelope(), criteria, {
        agentId: "test-agent",
        modelFailoverProvider: failoverProvider,
      }),
    );

    // failoverProvider must NOT have been called
    expect(failoverProvider).not.toHaveBeenCalled();

    // Loop should terminate with cancelled or error (not completed)
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated).toBeDefined();
    expect((terminated?.payload as { reason?: string })?.reason).not.toBe(
      "completed",
    );
  });

  it("falls through to error/terminated when failoverProvider returns null", async () => {
    const loop = makeLoopWithChat(async () => {
      throw new Error("PROVIDER_API_ERROR: all providers down");
    });

    const failoverProvider = jest.fn(async (): Promise<string | null> => null);

    const events = await drain(
      loop.run(makeEnvelope("user-1"), criteria, {
        agentId: "test-agent",
        preferredModelId: "model-a",
        modelFailoverProvider: failoverProvider,
      }),
    );

    // failoverProvider was called (failover attempted but no candidate returned)
    expect(failoverProvider).toHaveBeenCalled();

    // Loop must terminate with error
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "error" });

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });
});

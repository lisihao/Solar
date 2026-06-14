/**
 * R2-#35 — native structured output call-site assertions
 *
 * Verifies that:
 *   1. SimpleLoop passes structuredOutputStrategy:"json_schema" + outputJsonSchema
 *      on every chat() call.
 *   2. ReActLoop non-FC branch passes the same params (gated on !useNativeFCThisCall).
 *   3. ReActLoop native-FC branch does NOT pass structuredOutputStrategy /
 *      outputJsonSchema (to avoid injecting response_format alongside tools).
 *
 * These are unit tests — chatService.chat is mocked; no real LLM calls.
 */

import { SimpleLoop } from "../simple-loop";
import { ReActLoop } from "../react-loop";
import { HookRegistry } from "../../../agents/core/hook-registry";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import { ToolInvoker } from "../../tool-invoker/tool-invoker";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../agents/abstractions";
import {
  SIMPLE_LOOP_OUTPUT_JSON_SCHEMA,
  REACT_LOOP_DECISION_JSON_SCHEMA,
} from "../loop-output-schemas";

// ── helpers ──────────────────────────────────────────────────────────────────

async function drain(iter: AsyncIterable<IAgentEvent>): Promise<IAgentEvent[]> {
  const out: IAgentEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

function makeEnvelope(tools: string[] = []): ContextEnvelope {
  return new ContextEnvelope({
    system: "system",
    messages: [{ role: "user", content: "go", timestamp: 0 }],
    reminders: [],
    tools,
    memory: { sessionId: "s1", userId: "u1" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 10_000,
      iterationsUsed: 0,
      iterationsRemaining: 10,
      wallTimeStartMs: Date.now(),
    },
  });
}

const criteria: ILoopTerminationCriteria = {
  maxIterations: 3,
  terminateOn: ["finalize"],
};

function mkToolRegistry(
  tools: Record<string, { success: boolean; data?: unknown }> = {},
) {
  return {
    has: jest.fn((id: string) => id in tools),
    get: jest.fn((id: string) => ({
      id,
      execute: jest.fn(async () => ({
        success: tools[id]?.success ?? true,
        data: tools[id]?.data,
        metadata: {
          executionId: "x",
          startTime: new Date(),
          endTime: new Date(),
        },
      })),
    })),
    // AgentToolRegistry.getSchemas — used by buildFunctionDefinitions (FC path)
    getSchemas: jest.fn((ids: readonly string[]) =>
      ids
        .filter((id) => id in tools)
        .map((id) => ({
          type: "function" as const,
          function: {
            name: id,
            description: `mock tool ${id}`,
            parameters: { type: "object", properties: {}, required: [] },
          },
        })),
    ),
  };
}

// ── SimpleLoop tests ──────────────────────────────────────────────────────────

describe("SimpleLoop — native structured output (R2-#35)", () => {
  it("passes structuredOutputStrategy:json_schema and outputJsonSchema on every chat() call", async () => {
    const chatMock = jest.fn(async () => ({
      content: JSON.stringify({ score: 9 }),
      model: "mock",
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new SimpleLoop({ chat: chatMock } as any);

    await drain(loop.run(makeEnvelope(), criteria, { agentId: "a1" }));

    expect(chatMock).toHaveBeenCalledTimes(1);
    const callArgs = chatMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.structuredOutputStrategy).toBe("json_schema");
    expect(callArgs.outputJsonSchema).toBe(SIMPLE_LOOP_OUTPUT_JSON_SCHEMA);
  });

  it("still yields output even when outputJsonSchema is present (fallback path also works)", async () => {
    // Response is a raw object — no fencing — same path the fallback handles.
    const chatMock = jest.fn(async () => ({
      content: JSON.stringify({ value: "hello" }),
      model: "mock",
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new SimpleLoop({ chat: chatMock } as any);

    const events = await drain(
      loop.run(makeEnvelope(), criteria, { agentId: "a1" }),
    );
    const output = events.find((e) => e.type === "output");
    expect(output).toBeDefined();
    expect(output?.payload).toMatchObject({ output: { value: "hello" } });
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "completed" });
  });
});

// ── ReActLoop non-FC branch tests ─────────────────────────────────────────────

describe("ReActLoop — native structured output non-FC branch (R2-#35)", () => {
  it("passes structuredOutputStrategy:json_schema + outputJsonSchema when no tools registered (non-FC)", async () => {
    const innerChatFn = jest.fn(async () => ({
      content: JSON.stringify({
        thinking: "done",
        action: { kind: "finalize", output: "result" },
      }),
      model: "mock",
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    }));
    const chatService = { chat: innerChatFn };
    const reg = mkToolRegistry();
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chatService as any, invoker, hooks);

    // envelope with no tools → fcDefs empty → useNativeFCThisCall=false → non-FC path
    await drain(loop.run(makeEnvelope([]), criteria, { agentId: "a1" }));

    expect(innerChatFn).toHaveBeenCalledTimes(1);
    const callArgs = innerChatFn.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.structuredOutputStrategy).toBe("json_schema");
    expect(callArgs.outputJsonSchema).toBe(REACT_LOOP_DECISION_JSON_SCHEMA);
    // responseFormat is still "json" on non-FC branch (secondary safety net)
    expect(callArgs.responseFormat).toBe("json");
  });

  it("does NOT pass structuredOutputStrategy when native-FC is active (tools present)", async () => {
    // Enable native-FC via env flag so buildFunctionDefinitions returns non-empty.
    const origEnv = process.env.HARNESS_REACT_NATIVE_FC;
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    try {
      const finalizeContent = JSON.stringify({
        thinking: "done",
        action: { kind: "finalize", output: "result" },
      });
      const innerChatFn = jest.fn(async () => ({
        content: finalizeContent,
        toolCalls: [{ id: "tc1", name: "myTool", arguments: {} }],
        model: "mock",
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      }));
      const chatService = { chat: innerChatFn };
      const reg = mkToolRegistry({ myTool: { success: true, data: "ok" } });
      const hooks = new HookRegistry();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoker = new ToolInvoker(reg as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loop = new ReActLoop(
        chatService as any,
        invoker,
        hooks,
        undefined, // contextManager
        undefined, // pricingRegistry
        undefined, // cachePlanner
        undefined, // pluginHookBus
        reg as any, // agentToolRegistry — needed for buildFunctionDefinitions
      );

      // envelope WITH tools — fcDefs non-empty → useNativeFCThisCall=true → FC path
      await drain(
        loop.run(makeEnvelope(["myTool"]), criteria, { agentId: "a1" }),
      );

      expect(innerChatFn).toHaveBeenCalled();
      const callArgs = innerChatFn.mock.calls[0][0] as Record<string, unknown>;
      // FC path: structuredOutputStrategy / outputJsonSchema must NOT be present
      expect(callArgs.structuredOutputStrategy).toBeUndefined();
      expect(callArgs.outputJsonSchema).toBeUndefined();
      // responseFormat is undefined on FC path
      expect(callArgs.responseFormat).toBeUndefined();
    } finally {
      if (origEnv === undefined) {
        delete process.env.HARNESS_REACT_NATIVE_FC;
      } else {
        process.env.HARNESS_REACT_NATIVE_FC = origEnv;
      }
    }
  });
});

// ── Schema shape smoke-tests ──────────────────────────────────────────────────

describe("loop-output-schemas shape", () => {
  it("SIMPLE_LOOP_OUTPUT_JSON_SCHEMA is a permissive schema (object or array)", () => {
    // P2 fix: removed top-level type:"object" constraint so arrays are not rejected
    // by strict providers before the manual fallback can handle them.
    expect(SIMPLE_LOOP_OUTPUT_JSON_SCHEMA).not.toHaveProperty("type");
    expect(SIMPLE_LOOP_OUTPUT_JSON_SCHEMA).toHaveProperty("oneOf");
    const oneOf = (SIMPLE_LOOP_OUTPUT_JSON_SCHEMA as { oneOf: unknown[] })
      .oneOf;
    expect(oneOf).toContainEqual({
      type: "object",
      additionalProperties: true,
    });
    expect(oneOf).toContainEqual({ type: "array" });
  });

  it("REACT_LOOP_DECISION_JSON_SCHEMA covers thinking + action.kind", () => {
    expect(REACT_LOOP_DECISION_JSON_SCHEMA).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        thinking: { type: "string" },
        action: expect.objectContaining({
          type: "object",
          properties: expect.objectContaining({ kind: { type: "string" } }),
        }),
      }),
      additionalProperties: true,
    });
  });
});

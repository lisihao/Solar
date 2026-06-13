/**
 * R3-#35 — Researcher finalize output schema critical-guard tests
 *
 * CRITICAL REQUIREMENT (from spec): a strict schema that doesn't EXACTLY match
 * real output will REJECT valid findings → MORE failures (worse than before).
 * These tests are the safety net — they MUST stay green.
 *
 * Assertions:
 *   1. A realistic valid researcher output PASSES RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA
 *      (not rejected by the schema — the "valid not rejected" test).
 *   2. An output missing required fields is caught (schema rejects invalid output).
 *   3. Optional fields absent = still valid (optional fields are truly optional).
 *   4. figureCandidates absent = still valid (.default([]) → not in required).
 *   5. The ReActLoop passes the strict finalize decision schema on final iterations
 *      (approachingLimit=true) when finalizeOutputJsonSchema is supplied.
 *   6. The ReActLoop falls back to permissive schema when not on final iterations.
 */

import { ReActLoop } from "../../../../../../ai-harness/runner/loop/react-loop";
import { HookRegistry } from "../../../../../../ai-harness/agents/core/hook-registry";
import { ContextEnvelope } from "../../../../../../ai-harness/agents/core/context-envelope";
import { ToolInvoker } from "../../../../../../ai-harness/runner/tool-invoker/tool-invoker";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../../../../ai-harness/agents/abstractions";
import {
  RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA,
  REACT_LOOP_DECISION_JSON_SCHEMA,
} from "../../../../../../ai-harness/runner/loop/loop-output-schemas";

// ── helpers ──────────────────────────────────────────────────────────────────

async function drain(iter: AsyncIterable<IAgentEvent>): Promise<IAgentEvent[]> {
  const out: IAgentEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

function makeEnvelope(tools: string[] = []): ContextEnvelope {
  return new ContextEnvelope({
    system: "system",
    messages: [{ role: "user", content: "research AI", timestamp: 0 }],
    reminders: [],
    tools,
    memory: { sessionId: "s1", userId: "u1" },
    budget: {
      tokensUsed: 0,
      tokensRemaining: 30_000,
      iterationsUsed: 0,
      iterationsRemaining: 10,
      wallTimeStartMs: Date.now(),
    },
  });
}

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
    getSchemas: jest.fn((_ids: readonly string[]) => []),
  };
}

/**
 * Minimal JSON-schema validator (subset used by the loop/provider).
 * Validates required[], type, and additionalProperties:false constraints.
 * This simulates what a strict JSON-schema provider would enforce.
 */
function validateAgainstSchema(
  data: unknown,
  schema: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (schema.type === "object") {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { valid: false, errors: ["expected object"] };
    }
    const obj = data as Record<string, unknown>;

    // required check
    const required = (schema.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!(key in obj)) {
        errors.push(`missing required field: ${key}`);
      }
    }

    // additionalProperties:false check
    if (schema.additionalProperties === false) {
      const props = schema.properties as Record<string, unknown> | undefined;
      const allowedKeys = new Set(Object.keys(props ?? {}));
      for (const key of Object.keys(obj)) {
        if (!allowedKeys.has(key)) {
          errors.push(`additional property not allowed: ${key}`);
        }
      }
    }

    // recurse into properties
    const props = schema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (props) {
      for (const [key, subSchema] of Object.entries(props)) {
        if (key in obj) {
          if (subSchema.type === "array" && Array.isArray(obj[key])) {
            const itemSchema = subSchema.items as
              | Record<string, unknown>
              | undefined;
            if (itemSchema) {
              for (let i = 0; i < (obj[key] as unknown[]).length; i++) {
                const r = validateAgainstSchema(
                  (obj[key] as unknown[])[i],
                  itemSchema,
                );
                if (!r.valid) {
                  errors.push(...r.errors.map((e) => `${key}[${i}].${e}`));
                }
              }
            }
          } else if (subSchema.type === "object") {
            const r = validateAgainstSchema(obj[key], subSchema);
            if (!r.valid) {
              errors.push(...r.errors.map((e) => `${key}.${e}`));
            }
          }
        }
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(data)) {
      return { valid: false, errors: ["expected array"] };
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Schema shape tests ────────────────────────────────────────────────────────

describe("RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA shape", () => {
  it("has additionalProperties:false at root (strict shape)", () => {
    expect(RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });

  it("requires dimension, findings, summary", () => {
    expect(RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA.required).toEqual(
      expect.arrayContaining(["dimension", "findings", "summary"]),
    );
    // figureCandidates has .default([]) → must NOT be required
    const required =
      RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA.required as string[];
    expect(required).not.toContain("figureCandidates");
  });

  it("findings items require claim, evidence, source", () => {
    const findings = (
      RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA.properties as Record<
        string,
        { items?: { required?: string[] } }
      >
    ).findings;
    expect(findings.items?.required).toEqual(
      expect.arrayContaining(["claim", "evidence", "source"]),
    );
  });

  it("findings items optional fields NOT in required", () => {
    const findings = (
      RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA.properties as Record<
        string,
        { items?: { required?: string[] } }
      >
    ).findings;
    const req = findings.items?.required ?? [];
    expect(req).not.toContain("sourceTitle");
    expect(req).not.toContain("sourceSnippet");
    expect(req).not.toContain("sourcePublishedAt");
  });

  it("figureCandidates has maxItems:5", () => {
    const fc = (
      RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA.properties as Record<
        string,
        { maxItems?: number }
      >
    ).figureCandidates;
    expect(fc.maxItems).toBe(5);
  });
});

// ── Critical Guard: valid output PASSES schema ────────────────────────────────

describe("RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA — valid output PASSES (critical guard)", () => {
  const SCHEMA = RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA;

  it("[critical] full valid output with all optional fields passes", () => {
    const validOutput = {
      dimension: "Market Landscape",
      findings: [
        {
          claim: "AI chip market grew 40% in 2024",
          evidence:
            "NVIDIA reported $47B revenue in Q4 2024, up 40% YoY per earnings release",
          source: "https://investor.nvidia.com/news-details/2024/q4-earnings",
          sourceTitle: "NVIDIA Q4 2024 Earnings Release",
          sourceSnippet: "Revenue grew 40% year-over-year",
          sourcePublishedAt: "2024-02-21",
        },
        {
          claim: "AMD gained market share in data center segment",
          evidence:
            "AMD data center revenue reached $2.3B in Q4 2024, up 69% YoY",
          source: "https://ir.amd.com/news-releases/2024/q4",
          // no optional fields — should still pass
        },
      ],
      summary:
        "The AI chip market is experiencing unprecedented growth driven by LLM training and inference demand.",
      figureCandidates: [
        {
          sourceUrl: "https://example.com/chart",
          caption: "AI chip market share 2024",
          imageUrl: "https://example.com/chart.png",
          sourcePageOrSection: "Figure 3",
          relevanceHint: "high" as const,
        },
      ],
    };

    const result = validateAgainstSchema(validOutput, SCHEMA);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("[critical] output without figureCandidates passes (it has .default([]))", () => {
    const validOutput = {
      dimension: "Technology Stack",
      findings: [
        {
          claim: "Transformer architecture dominates",
          evidence:
            "95% of top-10 LLMs use transformer architecture as of 2024",
          source: "https://papers.arxiv.org/abs/2305.12345",
        },
      ],
      summary: "Transformer remains the dominant architecture.",
      // figureCandidates intentionally absent — has .default([]) in zod
    };

    const result = validateAgainstSchema(validOutput, SCHEMA);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("[critical] output with empty figureCandidates array passes", () => {
    const validOutput = {
      dimension: "Regulatory Environment",
      findings: [
        {
          claim: "EU AI Act passed in 2024",
          evidence: "European Parliament voted 523-46 for the EU AI Act",
          source: "https://www.europarl.europa.eu/ai-act-2024",
        },
      ],
      summary: "Regulatory framework is tightening globally.",
      figureCandidates: [],
    };

    const result = validateAgainstSchema(validOutput, SCHEMA);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("[critical] figureCandidates without optional fields passes", () => {
    const validOutput = {
      dimension: "Investment Trends",
      findings: [
        {
          claim: "VC investment in AI reached $100B in 2024",
          evidence: "PitchBook data shows $100B VC investment in AI startups",
          source: "https://pitchbook.com/ai-investment-2024",
        },
      ],
      summary: "AI investment hit record highs.",
      figureCandidates: [
        {
          // only required fields — imageUrl, sourcePageOrSection, relevanceHint absent
          sourceUrl: "https://example.com/chart",
          caption: "VC investment in AI 2024",
        },
      ],
    };

    const result = validateAgainstSchema(validOutput, SCHEMA);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

// ── Schema catches invalid output ─────────────────────────────────────────────

describe("RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA — invalid output is caught", () => {
  const SCHEMA = RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA;

  it("rejects output missing required 'dimension'", () => {
    const invalidOutput = {
      // dimension absent
      findings: [{ claim: "x", evidence: "y", source: "https://example.com" }],
      summary: "summary",
    };

    const result = validateAgainstSchema(invalidOutput, SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing required field: dimension");
  });

  it("rejects output missing required 'summary'", () => {
    const invalidOutput = {
      dimension: "some dim",
      findings: [{ claim: "x", evidence: "y", source: "https://example.com" }],
      // summary absent
    };

    const result = validateAgainstSchema(invalidOutput, SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing required field: summary");
  });

  it("rejects finding missing required 'source'", () => {
    const invalidOutput = {
      dimension: "dim",
      findings: [{ claim: "x", evidence: "y" /* source missing */ }],
      summary: "summary",
    };

    const result = validateAgainstSchema(invalidOutput, SCHEMA);
    expect(result.valid).toBe(false);
    // Should flag the missing source in the nested finding
    expect(result.errors.some((e) => e.includes("source"))).toBe(true);
  });

  it("rejects object with additionalProperties at root when strict", () => {
    const invalidOutput = {
      dimension: "dim",
      findings: [{ claim: "c", evidence: "e", source: "https://x.com" }],
      summary: "s",
      unexpectedField: "this should not be here",
    };

    const result = validateAgainstSchema(invalidOutput, SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unexpectedField"))).toBe(true);
  });
});

// ── ReActLoop: strict finalize schema wiring ──────────────────────────────────

describe("ReActLoop — finalizeOutputJsonSchema wiring (R3-#35)", () => {
  /**
   * Helper: run a loop where the LLM does N-1 tool calls before finalizing.
   * Returns all chat() call args in order.
   *
   * approachingLimit condition: maxIterations - iteration <= 2 && maxIterations > 3
   * So for maxIterations=5: iter=3→ 5-3=2 ≤2 ✓ and 5>3 ✓ → approachingLimit=true
   *                          iter=1→ 5-1=4 >2 → approachingLimit=false
   */
  async function runLoopCapturingChatArgs(opts: {
    maxIterations: number;
    finalizeOutputJsonSchema?: Record<string, unknown>;
    /** tool ids that the registry recognizes (triggers tool_call on first iters) */
    toolIds?: string[];
    /** How many tool_call iterations before the LLM finalizes */
    toolCallsBeforeFinalize?: number;
  }): Promise<Array<Record<string, unknown>>> {
    const chatCalls: Array<Record<string, unknown>> = [];
    const toolCallsBeforeFinalize = opts.toolCallsBeforeFinalize ?? 0;
    let callCount = 0;

    const innerChatFn = jest.fn(async (args: Record<string, unknown>) => {
      chatCalls.push({ ...args });
      callCount++;
      if (callCount <= toolCallsBeforeFinalize) {
        // Emit a tool_call for the first N iterations
        return {
          content: JSON.stringify({
            thinking: `searching iter ${callCount}`,
            action: {
              kind: "tool_call",
              toolId: opts.toolIds?.[0] ?? "web-search",
              input: { query: "test" },
            },
          }),
          model: "mock",
          usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
        };
      }
      return {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { result: "ok" } },
        }),
        model: "mock",
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      };
    });

    const toolEntries: Record<string, { success: boolean; data: string }> = {};
    for (const id of opts.toolIds ?? []) {
      toolEntries[id] = { success: true, data: "search result" };
    }
    const reg = mkToolRegistry(toolEntries);
    const chatService = { chat: innerChatFn };
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chatService as any, invoker, hooks);

    const loopCriteria: ILoopTerminationCriteria = {
      maxIterations: opts.maxIterations,
      terminateOn: ["finalize"],
    };

    await drain(
      loop.run(makeEnvelope(opts.toolIds ?? []), loopCriteria, {
        agentId: "test-researcher",
        finalizeOutputJsonSchema: opts.finalizeOutputJsonSchema,
      }),
    );

    return chatCalls;
  }

  it("uses strict finalize decision schema on approaching-limit iteration", async () => {
    // maxIterations=5, toolCallsBeforeFinalize=2:
    //   iter=1 (chat call 1): tool_call, 5-1=4>2 → approachingLimit=false
    //   iter=2 (chat call 2): tool_call, 5-2=3>2 → approachingLimit=false
    //   iter=3 (chat call 3): finalize,  5-3=2 ≤2 and 5>3 → approachingLimit=TRUE
    const calls = await runLoopCapturingChatArgs({
      maxIterations: 5,
      finalizeOutputJsonSchema: RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA,
      toolIds: ["web-search"],
      toolCallsBeforeFinalize: 2,
    });

    expect(calls.length).toBeGreaterThanOrEqual(3);
    const finalCall = calls[2]; // iter=3, approachingLimit=true

    // On approaching-limit iteration, should use strict decision wrapper schema
    expect(finalCall.structuredOutputStrategy).toBe("json_schema");
    expect(finalCall.outputJsonSchema).not.toBe(
      REACT_LOOP_DECISION_JSON_SCHEMA,
    );

    // The schema should be the buildFinalizeDecisionSchema wrapper
    const schema = finalCall.outputJsonSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    // The wrapper embeds action.output with the strict schema
    const properties = schema.properties as Record<
      string,
      { properties?: Record<string, unknown> }
    >;
    expect(properties.action).toBeDefined();
    expect(properties.action.properties?.output).toBeDefined();
    // output property should be the researcher finalize schema itself
    expect(properties.action.properties?.output).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: expect.arrayContaining(["dimension", "findings", "summary"]),
    });
  });

  it("uses permissive schema on non-approaching-limit iterations", async () => {
    // maxIterations=5, iter=1: 5-1=4>2 → approachingLimit=false
    const calls = await runLoopCapturingChatArgs({
      maxIterations: 5,
      finalizeOutputJsonSchema: RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA,
      toolIds: ["web-search"],
      toolCallsBeforeFinalize: 2,
    });

    const firstCall = calls[0]; // iter=1, approachingLimit=false
    expect(firstCall.structuredOutputStrategy).toBe("json_schema");
    expect(firstCall.outputJsonSchema).toBe(REACT_LOOP_DECISION_JSON_SCHEMA);
  });

  it("uses permissive REACT_LOOP_DECISION_JSON_SCHEMA on all iterations when no finalizeOutputJsonSchema", async () => {
    // Without finalizeOutputJsonSchema → always use permissive schema (even on final iter)
    const calls = await runLoopCapturingChatArgs({
      maxIterations: 5,
      finalizeOutputJsonSchema: undefined,
      toolIds: ["web-search"],
      toolCallsBeforeFinalize: 2,
    });

    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      expect(call.structuredOutputStrategy).toBe("json_schema");
      expect(call.outputJsonSchema).toBe(REACT_LOOP_DECISION_JSON_SCHEMA);
    }
  });

  it("uses permissive schema when maxIterations ≤ 3 (guard: maxIterations > 3 condition)", async () => {
    // approachingLimit condition requires maxIterations > 3, so with maxIterations=3
    // approachingLimit is ALWAYS false → always use permissive schema
    const calls = await runLoopCapturingChatArgs({
      maxIterations: 3,
      finalizeOutputJsonSchema: RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA,
    });

    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    expect(firstCall.structuredOutputStrategy).toBe("json_schema");
    // maxIterations=3: 3 > 3 is false → approachingLimit never true → permissive
    expect(firstCall.outputJsonSchema).toBe(REACT_LOOP_DECISION_JSON_SCHEMA);
  });
});

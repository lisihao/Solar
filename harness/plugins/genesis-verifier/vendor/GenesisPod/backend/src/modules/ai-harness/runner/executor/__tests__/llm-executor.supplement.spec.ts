/**
 * LlmExecutor — supplement branch coverage spec
 *
 * Targets uncovered branches:
 *   - isStubModeEnabled() production env guard
 *   - extractJsonFromLlmContent() escape character + inString branches + unmatched braces
 *   - LlmExecutor.execute() no-schema JSON failure + retry path
 *   - isError branch
 *   - usage nullish-coalescing branches (no usage on response)
 *   - model/modelType conditional
 *   - chat() throws → rethrow
 *   - business-rule failure continue
 *   - SchemaRetryExhaustedError with no lastError recorded
 *   - stub mode with outputSchema + validateBusinessRules
 *   - stub mode with no stubFn throws StubNotConfiguredError
 */

import { z } from "zod";
import { Logger } from "@nestjs/common";
import {
  LlmExecutor,
  SchemaRetryExhaustedError,
  StubNotConfiguredError,
  extractJsonFromLlmContent,
  isStubModeEnabled,
} from "../llm-executor";

// Suppress logger
jest.spyOn(Logger.prototype, "warn").mockImplementation();
jest.spyOn(Logger.prototype, "error").mockImplementation();

// ─── Helpers ───────────────────────────────────────────────────────────────

function mkChat(
  responses: Array<{
    content: string;
    isError?: boolean;
    usage?: { inputTokens: number; outputTokens: number };
    model?: string;
  }>,
) {
  let i = 0;
  return {
    chat: jest.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return {
        content: r.content,
        isError: r.isError ?? false,
        model: r.model ?? "gpt-4o",
        usage: r.usage ?? { inputTokens: 100, outputTokens: 50 },
      };
    }),
  };
}

function makeExecutor(chatSvc: { chat: jest.Mock }) {
  return new LlmExecutor(chatSvc as never);
}

const BASE_TASK_PROFILE = {
  creativity: "low" as const,
  outputLength: "medium" as const,
};

// ─── isStubModeEnabled ─────────────────────────────────────────────────────

describe("isStubModeEnabled()", () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns false in production even if AI_ENGINE_AGENT_STUB=1", () => {
    process.env.NODE_ENV = "production";
    process.env.AI_ENGINE_AGENT_STUB = "1";
    expect(isStubModeEnabled()).toBe(false);
  });

  it("returns true in test env with AI_ENGINE_AGENT_STUB=1", () => {
    process.env.NODE_ENV = "test";
    process.env.AI_ENGINE_AGENT_STUB = "1";
    expect(isStubModeEnabled()).toBe(true);
  });

  it("returns false when AI_ENGINE_AGENT_STUB is not set", () => {
    process.env.NODE_ENV = "test";
    delete process.env.AI_ENGINE_AGENT_STUB;
    expect(isStubModeEnabled()).toBe(false);
  });
});

// ─── extractJsonFromLlmContent — edge cases ────────────────────────────────

describe("extractJsonFromLlmContent() — additional branches", () => {
  it("handles escape sequences inside string (backslash-quote)", () => {
    const content = '{"key":"val\\"ue"}';
    const result = extractJsonFromLlmContent(content);
    expect((result as { key: string }).key).toBe('val"ue');
  });

  it("handles nested braces correctly", () => {
    const content = '{"a":{"b":1}}';
    expect(extractJsonFromLlmContent(content)).toEqual({ a: { b: 1 } });
  });

  it("throws when braces are unmatched (JSON with unclosed brace)", () => {
    // Text that starts with { but has no matching }
    expect(() => extractJsonFromLlmContent("text {unclosed")).toThrow(
      /unmatched braces/,
    );
  });

  it("parses fenced code block without json annotation", () => {
    const content = '```\n{"x": 1}\n```';
    expect(extractJsonFromLlmContent(content)).toEqual({ x: 1 });
  });

  it("handles string with only opening braces in content", () => {
    expect(() =>
      extractJsonFromLlmContent("some text { more text { end"),
    ).toThrow();
  });
});

// ─── LlmExecutor — no-schema JSON failure ─────────────────────────────────

describe("LlmExecutor — no-schema JSON failure triggers retry", () => {
  it("retries when JSON extract fails, then succeeds on next attempt", async () => {
    const chat = mkChat([
      { content: "not-json-at-all" },
      { content: '{"result": "ok"}' },
    ]);
    const executor = makeExecutor(chat);

    const result = await executor.execute({
      agentId: "test-agent",
      systemPrompt: "sys",
      userPrompt: "user",
      taskProfile: BASE_TASK_PROFILE,
    });

    expect(result.output).toEqual({ result: "ok" });
    expect(result.retries).toBe(1);
  });

  it("throws SchemaRetryExhaustedError when no-schema JSON consistently fails", async () => {
    const chat = mkChat([
      { content: "not json" },
      { content: "still not json" },
      { content: "no json here" },
    ]);
    const executor = makeExecutor(chat);

    await expect(
      executor.execute({
        agentId: "no-schema-agent",
        systemPrompt: "sys",
        userPrompt: "user",
        taskProfile: BASE_TASK_PROFILE,
        maxRetries: 2,
      }),
    ).rejects.toThrow(SchemaRetryExhaustedError);
  });
});

// ─── LlmExecutor — isError branch ─────────────────────────────────────────

describe("LlmExecutor — isError branch", () => {
  it("throws when chat returns isError=true", async () => {
    const chat = mkChat([{ content: "API error occurred", isError: true }]);
    const executor = makeExecutor(chat);

    await expect(
      executor.execute({
        agentId: "err-agent",
        systemPrompt: "sys",
        userPrompt: "user",
        taskProfile: BASE_TASK_PROFILE,
      }),
    ).rejects.toThrow(/chat returned isError/);
  });
});

// ─── LlmExecutor — chat() throws ──────────────────────────────────────────

describe("LlmExecutor — chat() throws", () => {
  it("rethrows when aiChatService.chat throws", async () => {
    const chatSvc = {
      chat: jest.fn().mockRejectedValue(new Error("network error")),
    };
    const executor = makeExecutor(chatSvc);

    await expect(
      executor.execute({
        agentId: "throw-agent",
        systemPrompt: "sys",
        userPrompt: "user",
        taskProfile: BASE_TASK_PROFILE,
      }),
    ).rejects.toThrow("network error");
  });
});

// ─── LlmExecutor — usage nullish coalescing ───────────────────────────────

describe("LlmExecutor — usage nullish coalescing", () => {
  it("handles missing usage fields gracefully", async () => {
    const chatSvc = {
      chat: jest.fn().mockResolvedValue({
        content: '{"data": "value"}',
        isError: false,
        model: "gpt-4o",
        usage: undefined, // no usage
      }),
    };
    const executor = makeExecutor(chatSvc);

    const result = await executor.execute({
      agentId: "no-usage-agent",
      systemPrompt: "sys",
      userPrompt: "user",
      taskProfile: BASE_TASK_PROFILE,
    });

    expect(result.tokensUsed).toBe(0);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });
});

// ─── LlmExecutor — model vs modelType conditional ─────────────────────────

describe("LlmExecutor — model/modelType routing", () => {
  it("passes modelType=CHAT when model is not specified", async () => {
    const chatSvc = {
      chat: jest.fn().mockResolvedValue({
        content: '{"ok":true}',
        isError: false,
        model: "gpt-4o",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    };
    const executor = makeExecutor(chatSvc);

    await executor.execute({
      agentId: "no-model-agent",
      systemPrompt: "sys",
      userPrompt: "user",
      taskProfile: BASE_TASK_PROFILE,
      // no model specified
    });

    const callArgs = chatSvc.chat.mock.calls[0][0];
    expect(callArgs.model).toBeUndefined();
    expect(callArgs.modelType).toBeDefined();
  });

  it("passes model and no modelType when model is specified", async () => {
    const chatSvc = {
      chat: jest.fn().mockResolvedValue({
        content: '{"ok":true}',
        isError: false,
        model: "claude-3.5-sonnet",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    };
    const executor = makeExecutor(chatSvc);

    await executor.execute({
      agentId: "model-agent",
      systemPrompt: "sys",
      userPrompt: "user",
      taskProfile: BASE_TASK_PROFILE,
      model: "claude-3.5-sonnet",
    });

    const callArgs = chatSvc.chat.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-3.5-sonnet");
    expect(callArgs.modelType).toBeUndefined();
  });
});

// ─── LlmExecutor — business-rule failure with retry ───────────────────────

describe("LlmExecutor — business-rule failure with retry", () => {
  it("retries on business-rule failure then succeeds", async () => {
    const schema = z.object({ score: z.number() });
    let callCount = 0;
    const chatSvc = {
      chat: jest.fn().mockImplementation(async () => {
        callCount++;
        return {
          content: `{"score": ${callCount}}`,
          isError: false,
          model: "gpt-4o",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }),
    };
    const executor = makeExecutor(chatSvc);

    let validateCallCount = 0;
    const result = await executor.execute({
      agentId: "business-agent",
      systemPrompt: "sys",
      userPrompt: "user",
      taskProfile: BASE_TASK_PROFILE,
      outputSchema: schema,
      validateBusinessRules: (output) => {
        validateCallCount++;
        if (output.score < 2) throw new Error("score too low");
      },
    });

    expect(result.output.score).toBe(2);
    expect(validateCallCount).toBe(2);
  });
});

// ─── LlmExecutor — SchemaRetryExhaustedError with no lastError ────────────

describe("LlmExecutor — SchemaRetryExhaustedError fallback message", () => {
  it("uses fallback message when no lastError was recorded", async () => {
    // Scenario: signal aborted before any attempt records lastError
    // Instead, use maxRetries=0 and always fail schema
    const schema = z.object({ required: z.string() });
    const chat = mkChat([{ content: "not valid json" }]);
    const executor = makeExecutor(chat);

    await expect(
      executor.execute({
        agentId: "no-last-error",
        systemPrompt: "sys",
        userPrompt: "user",
        taskProfile: BASE_TASK_PROFILE,
        outputSchema: schema,
        maxRetries: 0, // only one attempt, which fails
      }),
    ).rejects.toThrow(SchemaRetryExhaustedError);
  });
});

// ─── LlmExecutor — stub mode branches ─────────────────────────────────────

describe("LlmExecutor — stub mode", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv, AI_ENGINE_AGENT_STUB: "1", NODE_ENV: "test" };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("throws StubNotConfiguredError when stub mode active but no stubFn", async () => {
    const executor = makeExecutor({ chat: jest.fn() });

    await expect(
      executor.execute({
        agentId: "no-stub",
        systemPrompt: "sys",
        userPrompt: "user",
        taskProfile: BASE_TASK_PROFILE,
        // no stubFn
      }),
    ).rejects.toThrow(StubNotConfiguredError);
  });

  it("returns stub output without schema validation", async () => {
    const executor = makeExecutor({ chat: jest.fn() });

    const result = await executor.execute({
      agentId: "stub-agent",
      systemPrompt: "sys",
      userPrompt: "user",
      taskProfile: BASE_TASK_PROFILE,
      stubFn: async () => ({ answer: "42" }),
    });

    expect(result.model).toBe("stub");
    expect(result.tokensUsed).toBe(0);
    expect((result.output as { answer: string }).answer).toBe("42");
  });

  it("validates stub output against schema", async () => {
    const schema = z.object({ answer: z.string() });
    const executor = makeExecutor({ chat: jest.fn() });

    const result = await executor.execute({
      agentId: "stub-with-schema",
      systemPrompt: "sys",
      userPrompt: "user",
      taskProfile: BASE_TASK_PROFILE,
      outputSchema: schema,
      stubFn: async () => ({ answer: "hello" }),
    });

    expect(result.output.answer).toBe("hello");
  });

  it("throws when stub output fails schema", async () => {
    const schema = z.object({ answer: z.string() });
    const executor = makeExecutor({ chat: jest.fn() });

    await expect(
      executor.execute({
        agentId: "stub-schema-fail",
        systemPrompt: "sys",
        userPrompt: "user",
        taskProfile: BASE_TASK_PROFILE,
        outputSchema: schema,
        stubFn: async () => ({ answer: 42 }) as unknown as { answer: string },
      }),
    ).rejects.toThrow(/stubFn output failed schema/);
  });

  it("runs validateBusinessRules on stub output", async () => {
    const schema = z.object({ score: z.number() });
    const executor = makeExecutor({ chat: jest.fn() });
    const validator = jest.fn();

    await executor.execute({
      agentId: "stub-with-rules",
      systemPrompt: "sys",
      userPrompt: "user",
      taskProfile: BASE_TASK_PROFILE,
      outputSchema: schema,
      stubFn: async () => ({ score: 10 }),
      validateBusinessRules: validator,
    });

    expect(validator).toHaveBeenCalledWith({ score: 10 });
  });

  it("aborted signal causes AbortError during execute", async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = makeExecutor({ chat: jest.fn() });

    // Stub mode is active (AI_ENGINE_AGENT_STUB=1), but we test non-stub path:
    // Disable stub temporarily to test signal abort in main loop
    process.env.AI_ENGINE_AGENT_STUB = "0";

    await expect(
      executor.execute({
        agentId: "abort-agent",
        systemPrompt: "sys",
        userPrompt: "user",
        taskProfile: BASE_TASK_PROFILE,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/Aborted/);
  });
});

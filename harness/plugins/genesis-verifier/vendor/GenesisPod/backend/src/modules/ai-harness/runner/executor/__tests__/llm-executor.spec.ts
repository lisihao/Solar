/**
 * LlmExecutor 单元测试 (P1-2)
 *
 * 覆盖：
 *  - 无 schema → raw JSON 直接返回
 *  - Zod 成功一次过
 *  - Zod 失败 → error-fed retry 成功
 *  - Zod 连续失败 → SchemaRetryExhaustedError
 *  - validateBusinessRules 失败触发 retry
 *  - AbortSignal 传递
 */

import { z } from "zod";
import {
  LlmExecutor,
  SchemaRetryExhaustedError,
  StubNotConfiguredError,
  extractJsonFromLlmContent,
} from "../llm-executor";

describe("extractJsonFromLlmContent", () => {
  it("parses pure JSON", () => {
    expect(extractJsonFromLlmContent('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced code block", () => {
    expect(extractJsonFromLlmContent('```json\n{"a":1}\n```')).toEqual({
      a: 1,
    });
  });

  it("parses mixed text containing JSON", () => {
    expect(
      extractJsonFromLlmContent('Here is the result: {"a":1,"b":"x"} done.'),
    ).toEqual({ a: 1, b: "x" });
  });

  it("throws on no JSON", () => {
    expect(() => extractJsonFromLlmContent("nothing here")).toThrow(
      /no JSON object/,
    );
  });
});

describe("LlmExecutor", () => {
  function mkChat(responses: Array<{ content: string; isError?: boolean }>) {
    let i = 0;
    return {
      chat: jest.fn(async () => {
        const r = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return {
          content: r.content,
          isError: r.isError ?? false,
          model: "test-model",
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      }),
    };
  }

  const Schema = z.object({ a: z.number(), b: z.string() });

  it("returns Zod-validated output on first success", async () => {
    const chat = mkChat([{ content: '{"a":1,"b":"x"}' }]);
    const exec = new LlmExecutor(chat as any);
    const res = await exec.execute({
      agentId: "TEST",
      systemPrompt: "sys",
      userPrompt: "usr",
      outputSchema: Schema,
      taskProfile: { creativity: "low", outputLength: "medium" },
    });
    expect(res.output).toEqual({ a: 1, b: "x" });
    expect(res.retries).toBe(0);
    expect(chat.chat).toHaveBeenCalledTimes(1);
  });

  it("retries on Zod failure then succeeds", async () => {
    const chat = mkChat([
      { content: '{"a":"not a number","b":"x"}' },
      { content: '{"a":2,"b":"y"}' },
    ]);
    const exec = new LlmExecutor(chat as any);
    const res = await exec.execute({
      agentId: "TEST",
      systemPrompt: "sys",
      userPrompt: "usr",
      outputSchema: Schema,
      taskProfile: { creativity: "low", outputLength: "medium" },
    });
    expect(res.output).toEqual({ a: 2, b: "y" });
    expect(res.retries).toBe(1);
    expect(chat.chat).toHaveBeenCalledTimes(2);
    const secondCall = chat.chat.mock.calls[1][0];
    expect(secondCall.messages[0].content).toContain("failed validation");
  });

  it("throws SchemaRetryExhaustedError after exhausting retries", async () => {
    const chat = mkChat([
      { content: '{"bad":1}' },
      { content: '{"still bad":2}' },
      { content: '{"stillbad":3}' },
    ]);
    const exec = new LlmExecutor(chat as any);
    await expect(
      exec.execute({
        agentId: "TEST",
        systemPrompt: "sys",
        userPrompt: "usr",
        outputSchema: Schema,
        taskProfile: { creativity: "low", outputLength: "medium" },
        maxRetries: 2,
      }),
    ).rejects.toBeInstanceOf(SchemaRetryExhaustedError);
    expect(chat.chat).toHaveBeenCalledTimes(3);
  });

  it("business-rule error triggers retry", async () => {
    const chat = mkChat([
      { content: '{"a":1,"b":"x"}' }, // zod OK, business 拒
      { content: '{"a":2,"b":"x"}' }, // 通过
    ]);
    const exec = new LlmExecutor(chat as any);
    const res = await exec.execute({
      agentId: "TEST",
      systemPrompt: "sys",
      userPrompt: "usr",
      outputSchema: Schema,
      validateBusinessRules: (o) => {
        if (o.a === 1) throw new Error("a must not be 1");
      },
      taskProfile: { creativity: "low", outputLength: "medium" },
    });
    expect(res.output.a).toBe(2);
    expect(res.retries).toBe(1);
  });

  it("no schema → returns raw JSON as unknown", async () => {
    const chat = mkChat([{ content: '{"whatever":123}' }]);
    const exec = new LlmExecutor(chat as any);
    const res = await exec.execute({
      agentId: "TEST",
      systemPrompt: "sys",
      userPrompt: "usr",
      taskProfile: { creativity: "low", outputLength: "medium" },
    });
    expect(res.output).toEqual({ whatever: 123 });
  });

  it("respects signal.aborted before first call", async () => {
    const chat = mkChat([{ content: "{}" }]);
    const exec = new LlmExecutor(chat as any);
    const ac = new AbortController();
    ac.abort();
    await expect(
      exec.execute({
        agentId: "TEST",
        systemPrompt: "sys",
        userPrompt: "usr",
        taskProfile: { creativity: "low", outputLength: "medium" },
        signal: ac.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(chat.chat).not.toHaveBeenCalled();
  });

  it("accumulates tokens/cost across retries", async () => {
    const chat = mkChat([
      { content: '{"a":"bad"}' },
      { content: '{"a":1,"b":"ok"}' },
    ]);
    const exec = new LlmExecutor(chat as any);
    const res = await exec.execute({
      agentId: "TEST",
      systemPrompt: "sys",
      userPrompt: "usr",
      outputSchema: Schema,
      taskProfile: { creativity: "low", outputLength: "medium" },
    });
    expect(res.inputTokens).toBe(20);
    expect(res.outputTokens).toBe(40);
  });

  describe("stub mode (AI_ENGINE_AGENT_STUB=1)", () => {
    let origEnv: string | undefined;
    beforeEach(() => {
      origEnv = process.env.AI_ENGINE_AGENT_STUB;
      process.env.AI_ENGINE_AGENT_STUB = "1";
    });
    afterEach(() => {
      if (origEnv === undefined) delete process.env.AI_ENGINE_AGENT_STUB;
      else process.env.AI_ENGINE_AGENT_STUB = origEnv;
    });

    it("bypasses LLM and calls stubFn when env=1 + stubFn provided", async () => {
      const chat = { chat: jest.fn() };
      const exec = new LlmExecutor(chat as any);
      const res = await exec.execute({
        agentId: "TEST",
        systemPrompt: "sys",
        userPrompt: "usr",
        outputSchema: Schema,
        taskProfile: { creativity: "low", outputLength: "medium" },
        stubFn: async () => ({ a: 42, b: "stub" }),
      });
      expect(res.output).toEqual({ a: 42, b: "stub" });
      expect(res.model).toBe("stub");
      expect(res.tokensUsed).toBe(0);
      expect(res.costUsd).toBe(0);
      expect(chat.chat).not.toHaveBeenCalled();
    });

    it("stub output still goes through Zod schema validation", async () => {
      const chat = { chat: jest.fn() };
      const exec = new LlmExecutor(chat as any);
      await expect(
        exec.execute({
          agentId: "TEST",
          systemPrompt: "sys",
          userPrompt: "usr",
          outputSchema: Schema,
          taskProfile: { creativity: "low", outputLength: "medium" },
          stubFn: async () => ({ a: "not a number" }) as any,
        }),
      ).rejects.toThrow(/stubFn output failed schema/);
    });

    it("stub output goes through validateBusinessRules", async () => {
      const chat = { chat: jest.fn() };
      const exec = new LlmExecutor(chat as any);
      await expect(
        exec.execute({
          agentId: "TEST",
          systemPrompt: "sys",
          userPrompt: "usr",
          outputSchema: Schema,
          validateBusinessRules: (o) => {
            if (o.a === 1) throw new Error("a must not be 1");
          },
          taskProfile: { creativity: "low", outputLength: "medium" },
          stubFn: async () => ({ a: 1, b: "x" }),
        }),
      ).rejects.toThrow(/a must not be 1/);
    });

    it("throws StubNotConfiguredError when env=1 but no stubFn", async () => {
      const chat = { chat: jest.fn() };
      const exec = new LlmExecutor(chat as any);
      await expect(
        exec.execute({
          agentId: "TEST",
          systemPrompt: "sys",
          userPrompt: "usr",
          taskProfile: { creativity: "low", outputLength: "medium" },
        }),
      ).rejects.toBeInstanceOf(StubNotConfiguredError);
      expect(chat.chat).not.toHaveBeenCalled();
    });
  });

  describe("stub disabled (env != 1)", () => {
    let origEnv: string | undefined;
    beforeEach(() => {
      origEnv = process.env.AI_ENGINE_AGENT_STUB;
      delete process.env.AI_ENGINE_AGENT_STUB;
    });
    afterEach(() => {
      if (origEnv !== undefined) process.env.AI_ENGINE_AGENT_STUB = origEnv;
    });

    it("ignores stubFn and goes through LLM path", async () => {
      const stubFn = jest.fn();
      const chat = mkChat([{ content: '{"a":1,"b":"x"}' }]);
      const exec = new LlmExecutor(chat as any);
      const res = await exec.execute({
        agentId: "TEST",
        systemPrompt: "sys",
        userPrompt: "usr",
        outputSchema: Schema,
        taskProfile: { creativity: "low", outputLength: "medium" },
        stubFn: stubFn as any,
      });
      expect(stubFn).not.toHaveBeenCalled();
      expect(chat.chat).toHaveBeenCalledTimes(1);
      expect(res.model).toBe("test-model");
    });
  });
});

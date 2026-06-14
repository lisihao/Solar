/**
 * ReActLoop 单元测试（Phase 2）
 *
 * 验证：
 *   - 一个 tool_call 后跟一个 finalize → 正确的事件流
 *   - LLM 输出无法解析 → 回退 finalize
 *   - Tool not found → 错误事件，可恢复继续
 *   - PreToolUse hook block → 工具被跳过，action 返回 error
 *   - maxIterations 超限 → 触发 terminated with reason budget
 */

import { ReActLoop } from "../react-loop";
import { HookRegistry } from "../../../agents/core/hook-registry";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import { ToolInvoker } from "../../tool-invoker/tool-invoker";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../agents/abstractions";

function makeEnvelope(tools: string[] = []): ContextEnvelope {
  return new ContextEnvelope({
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Solve 2+2.", timestamp: 0 }],
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

function mkChat(responses: string[]) {
  let i = 0;
  return {
    chat: jest.fn(async () => {
      const content = responses[i++] ?? responses[responses.length - 1];
      return { content, model: "mock", usage: { totalTokens: 10 } };
    }),
  };
}

function mkToolRegistry(
  tools: Record<string, { success: boolean; data?: unknown; error?: string }>,
) {
  return {
    has: jest.fn((id: string) => id in tools),
    get: jest.fn((id: string) => ({
      id,
      execute: jest.fn(async () => {
        const t = tools[id];
        return {
          success: t.success,
          data: t.data,
          error: t.error ? { code: "E", message: t.error } : undefined,
          metadata: {
            executionId: "x",
            startTime: new Date(),
            endTime: new Date(),
          },
        };
      }),
    })),
  };
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

describe("ReActLoop (Phase 2)", () => {
  it("executes tool_call then finalize", async () => {
    const chat = mkChat([
      JSON.stringify({
        thinking: "I should use calculator",
        action: { kind: "tool_call", toolId: "calc", input: { expr: "2+2" } },
      }),
      JSON.stringify({
        thinking: "The answer is 4",
        action: { kind: "finalize", output: "4" },
      }),
    ]);
    const reg = mkToolRegistry({ calc: { success: true, data: 4 } });
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(["calc"]), criteria, { agentId: "a1" }),
    );

    const types = events.map((e) => e.type);
    // ★ Phase P1 fix (2026-04-29 mission 8c7b4358)：每轮 ReAct 入口都 emit
    // iteration_progress 事件，让上层 UI / 监控看到进度，避免 silent 长循环看起来像死掉。
    expect(types).toEqual([
      "iteration_progress",
      "thinking",
      "action_planned",
      "action_executed",
      "iteration_progress",
      "thinking",
      "action_planned",
      "action_executed",
      "output",
      "terminated",
    ]);
    const progressEvents = events.filter(
      (e) => e.type === "iteration_progress",
    );
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0].payload).toMatchObject({
      iteration: 1,
      maxIterations: 5,
      approachingLimit: false,
    });
    expect(progressEvents[1].payload).toMatchObject({
      iteration: 2,
      maxIterations: 5,
      approachingLimit: false,
      lastActionKind: "tool_call",
    });
    const output = events.find((e) => e.type === "output");
    expect(output?.payload).toEqual({ output: "4" });
  });

  // ★ 2026-05-13: reasoning models (Nemotron / DeepSeek-R1 / QwQ) wrap their
  //   chain-of-thought in <think>…</think> tags, often inside the parsed
  //   `thinking` field itself. Strip these at the parse boundary so the
  //   trace UI and assistant context replay don't surface raw reasoning leak.
  it("strips <think>…</think> blocks from the thinking field before emitting trace", async () => {
    const chat = mkChat([
      JSON.stringify({
        thinking:
          "<think>Let me reason about this problem step by step. The user wants…</think>\nThe answer is 4",
        action: { kind: "finalize", output: "4" },
      }),
    ]);
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(), criteria, { agentId: "a1" }),
    );
    const thinking = events.find((e) => e.type === "thinking");
    expect(thinking).toBeDefined();
    const text = (thinking!.payload as { text: string }).text;
    expect(text).not.toContain("<think>");
    expect(text).not.toContain("step by step");
    expect(text).toContain("The answer is 4");
  });

  it("falls back to finalize when LLM output is not JSON", async () => {
    const chat = mkChat(["definitely not json"]);
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(), criteria, { agentId: "a1" }),
    );
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toEqual({ reason: "completed" });
    const output = events.find((e) => e.type === "output");
    expect(output).toBeDefined();
  });

  it("honors preferredModelId when provided by the caller", async () => {
    const chat = mkChat([
      JSON.stringify({
        thinking: "done",
        action: { kind: "finalize", output: "ok" },
      }),
    ]);
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    await drain(
      loop.run(makeEnvelope(), criteria, {
        agentId: "a1",
        preferredModelId: "preferred-model",
      }),
    );

    expect(chat.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: "preferred-model" }),
    );
  });

  // 2026-05-12 BYOK regression: ReAct loop 之前会先把 admin pricingRegistry 的
  // cheap-tier 首选模型注入到 chat(model=...)，绕过 ChatService 的
  // findUserDefaultByType → 用户选了 grok 也会被覆盖成 admin 默认 deepseek →
  // resolveKey 找不到用户的 deepseek key → PROVIDER_API_ERROR。
  // 修复（react-loop.ts:568 byokUserId 闸）后：
  //   - 有 userId 的业务调用：跳过 tier pick，让 chat() 走 BYOK 路径
  //   - 无 userId 的 cron / 系统任务：仍走 tier pick（admin downgrade 不受影响）
  describe("BYOK tier-bypass guard (2026-05-12)", () => {
    function mkPricingRegistry(tierModelId: string) {
      return {
        pickModelForTier: jest.fn(() => tierModelId),
        estimateCost: jest.fn(() => null),
      };
    }
    function mkBudget() {
      return {
        snapshot: jest.fn(() => ({ currentTier: "basic" as const })),
        exhausted: jest.fn(() => false),
        accountLLM: jest.fn(),
        warnAt70: jest.fn(),
        shouldDowngrade: jest.fn(() => false),
        canDowngrade: jest.fn(() => false),
        downgrade: jest.fn(),
      };
    }

    it("skips admin tier pick when envelope has userId (BYOK path)", async () => {
      const chat = mkChat([
        JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: "ok" },
        }),
      ]);
      const reg = mkToolRegistry({});
      const hooks = new HookRegistry();
      const pricingRegistry = mkPricingRegistry("admin-tier-deepseek");
      const budget = mkBudget();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoker = new ToolInvoker(reg as any);
      const loop = new ReActLoop(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chat as any,
        invoker,
        hooks,
        undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pricingRegistry as any,
      );

      // makeEnvelope() 默认 userId="u1" —— BYOK 路径
      await drain(
        loop.run(makeEnvelope(), criteria, {
          agentId: "a1",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          budget: budget as any,
        }),
      );

      // 关键：tier pick 完全不应被调用，因为 byokUserId 存在
      expect(pricingRegistry.pickModelForTier).not.toHaveBeenCalled();
      // chat() 收到 model=undefined → 走 modelType=CHAT 路径 → ChatService Path A
      // 的 findUserDefaultByType 命中用户 BYOK 默认模型
      expect(chat.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: undefined }),
      );
    });

    it("uses admin tier pick when envelope has no userId (cron / system task)", async () => {
      const chat = mkChat([
        JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: "ok" },
        }),
      ]);
      const reg = mkToolRegistry({});
      const hooks = new HookRegistry();
      const pricingRegistry = mkPricingRegistry("admin-tier-deepseek");
      const budget = mkBudget();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoker = new ToolInvoker(reg as any);
      const loop = new ReActLoop(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chat as any,
        invoker,
        hooks,
        undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pricingRegistry as any,
      );

      // 自建无 userId 的 envelope（系统任务）
      const noUserEnv = new ContextEnvelope({
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "Solve 2+2.", timestamp: 0 }],
        reminders: [],
        tools: [],
        memory: { sessionId: "s1" }, // ★ 无 userId
        budget: {
          tokensUsed: 0,
          tokensRemaining: 10_000,
          iterationsUsed: 0,
          iterationsRemaining: 10,
          wallTimeStartMs: Date.now(),
        },
      });

      await drain(
        loop.run(noUserEnv, criteria, {
          agentId: "a1",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          budget: budget as any,
        }),
      );

      // 无 userId → tier pick 应被调用，admin downgrade 行为保留
      expect(pricingRegistry.pickModelForTier).toHaveBeenCalled();
      expect(chat.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "admin-tier-deepseek" }),
      );
    });

    it("preferredModelId always wins over both BYOK guard and tier pick", async () => {
      const chat = mkChat([
        JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: "ok" },
        }),
      ]);
      const reg = mkToolRegistry({});
      const hooks = new HookRegistry();
      const pricingRegistry = mkPricingRegistry("admin-tier-deepseek");
      const budget = mkBudget();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoker = new ToolInvoker(reg as any);
      const loop = new ReActLoop(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chat as any,
        invoker,
        hooks,
        undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pricingRegistry as any,
      );

      // userId 存在 + caller 显式给 preferredModelId
      await drain(
        loop.run(makeEnvelope(), criteria, {
          agentId: "a1",
          preferredModelId: "election-grok",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          budget: budget as any,
        }),
      );

      // tier pick 不应被调用（preferredModelId 短路在前）
      expect(pricingRegistry.pickModelForTier).not.toHaveBeenCalled();
      expect(chat.chat).toHaveBeenCalledWith(
        expect.objectContaining({ model: "election-grok" }),
      );
    });
  });

  it("returns tool error as recoverable; loop continues to next iteration", async () => {
    const chat = mkChat([
      JSON.stringify({
        thinking: "try unknown tool",
        action: { kind: "tool_call", toolId: "missing", input: {} },
      }),
      JSON.stringify({
        thinking: "give up",
        action: { kind: "finalize", output: "gave up" },
      }),
    ]);
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(["missing"]), criteria, { agentId: "a1" }),
    );

    const actionExecuted = events.filter((e) => e.type === "action_executed");
    expect(actionExecuted[0].payload).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining("Tool not found"),
      }),
    });
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toEqual({ reason: "completed" });
  });

  it("PreToolUse hook can block tool execution", async () => {
    const chat = mkChat([
      JSON.stringify({
        thinking: "use calc",
        action: { kind: "tool_call", toolId: "calc", input: { expr: "2+2" } },
      }),
      JSON.stringify({
        thinking: "abandon",
        action: { kind: "finalize", output: "blocked" },
      }),
    ]);
    const reg = mkToolRegistry({ calc: { success: true, data: 4 } });
    const hooks = new HookRegistry();
    hooks.register({
      event: "PreToolUse",
      scope: "global",
      handler: () => ({ block: true, reason: "test-policy" }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(["calc"]), criteria, { agentId: "a1" }),
    );
    const firstAction = events.find((e) => e.type === "action_executed");
    expect(firstAction?.payload).toMatchObject({
      error: expect.objectContaining({
        message: expect.stringContaining("blocked: test-policy"),
      }),
    });
    // Registry get should NOT be called (tool skipped)
    expect(reg.get).not.toHaveBeenCalled();
  });

  it("terminates with reason budget after maxIterations", async () => {
    // Always respond with a tool_call (never finalize)
    const chat = mkChat([
      JSON.stringify({
        thinking: "call again",
        action: { kind: "tool_call", toolId: "noop", input: {} },
      }),
    ]);
    const reg = mkToolRegistry({ noop: { success: true, data: "ok" } });
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(
        makeEnvelope(["noop"]),
        { maxIterations: 2, terminateOn: ["finalize"] },
        {
          agentId: "a1",
        },
      ),
    );
    const terminated = events.find((e) => e.type === "terminated");
    // ★ P0-LIVE-MAX-ITER (2026-04-30): maxIterations 命中改 reason="error"
    //   让 runner 落到 legacyState="failed"，stage 才能走 dimension:degraded
    //   兜底（旧的 reason="budget" 会被推断成 completed + 垃圾 output）。
    expect(terminated?.payload).toEqual({ reason: "error" });
    const actionExecs = events.filter((e) => e.type === "action_executed");
    expect(actionExecs).toHaveLength(2);
  });

  // ── v2: Parallel tool calls ──
  it("executes multiple tools in parallel via parallel_tool_call", async () => {
    const chat = mkChat([
      JSON.stringify({
        thinking: "fan out",
        action: {
          kind: "parallel_tool_call",
          calls: [
            { kind: "tool_call", toolId: "a", input: {} },
            { kind: "tool_call", toolId: "b", input: {} },
            { kind: "tool_call", toolId: "c", input: {} },
          ],
        },
      }),
      JSON.stringify({
        thinking: "merge",
        action: { kind: "finalize", output: "merged" },
      }),
    ]);
    const reg = mkToolRegistry({
      a: { success: true, data: "A" },
      b: { success: true, data: "B" },
      c: { success: true, data: "C" },
    });
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(["a", "b", "c"]), criteria, { agentId: "p1" }),
    );
    const exec = events.find((e) => e.type === "action_executed");
    expect(exec?.payload).toMatchObject({
      action: { kind: "parallel_tool_call" },
      subResults: expect.arrayContaining([
        expect.objectContaining({ output: "A" }),
        expect.objectContaining({ output: "B" }),
        expect.objectContaining({ output: "C" }),
      ]),
    });
    expect(reg.get).toHaveBeenCalledTimes(3);
  });

  it("treats top-level 'actions' shorthand as parallel_tool_call", async () => {
    const chat = mkChat([
      JSON.stringify({
        thinking: "fan out shorthand",
        actions: [
          { toolId: "a", input: {} },
          { toolId: "b", input: {} },
        ],
      }),
      JSON.stringify({
        thinking: "done",
        action: { kind: "finalize", output: "done" },
      }),
    ]);
    const reg = mkToolRegistry({
      a: { success: true, data: 1 },
      b: { success: true, data: 2 },
    });
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(["a", "b"]), criteria, { agentId: "s1" }),
    );
    const exec = events.find((e) => e.type === "action_executed");
    expect(exec?.payload).toMatchObject({
      action: { kind: "parallel_tool_call" },
    });
    expect(reg.get).toHaveBeenCalledTimes(2);
  });

  // ── v2: BudgetAccountant integration ──
  it("aborts loop when BudgetAccountant.exhausted() returns true", async () => {
    const { BudgetAccountant } =
      await import("../../../guardrails/budget/budget-accountant");
    const budget = new BudgetAccountant({ maxTokens: 100, maxCostUsd: 0.01 });
    // Pre-exhaust
    budget.accountLLM(150, 0, 0);

    const chat = mkChat([
      JSON.stringify({
        thinking: "shouldn't be called",
        action: { kind: "finalize", output: "x" },
      }),
    ]);
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(), criteria, { agentId: "b1", budget }),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("budget_warning");
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toEqual({ reason: "budget" });
    // chat must NOT have been called — exhausted before reasoning
    expect(chat.chat).not.toHaveBeenCalled();
  });

  // ── P0-6: skipOnApiError stop hook guard ──────────────────────────────────
  it("P0-6: does NOT invoke skipOnApiError=true Stop hook when LLM throws API error", async () => {
    // chat always throws a provider API error
    const chat = {
      chat: jest.fn().mockRejectedValue(new Error("rate limit exceeded (429)")),
    };
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    const stopCalls: string[] = [];

    // Stop hook marked skipOnApiError=true — must be skipped
    hooks.register({
      event: "Stop",
      scope: "global",
      skipOnApiError: true,
      handler: () => {
        stopCalls.push("skip-on-api-error");
      },
    });
    // Stop hook without skipOnApiError — must still run
    hooks.register({
      event: "Stop",
      scope: "global",
      handler: () => {
        stopCalls.push("always-run");
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(
        makeEnvelope(),
        { maxIterations: 1, terminateOn: ["finalize"] },
        {
          agentId: "api-err-test",
        },
      ),
    );

    // Loop should have emitted error + terminated
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "error" });

    // skipOnApiError=true hook must NOT have been called
    expect(stopCalls).not.toContain("skip-on-api-error");
    // regular stop hook must have been called
    expect(stopCalls).toContain("always-run");
  });

  // ── P0 (2026-05-22): 可恢复错误有界退避重试 ──────────────────────────────
  it("retries a recoverable rate-limit error (action=retry) then succeeds", async () => {
    let calls = 0;
    const chat = {
      chat: jest.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error("rate limit exceeded (429)");
        return {
          content: JSON.stringify({
            thinking: "ok now",
            action: { kind: "finalize", output: "4" },
          }),
          model: "mock",
          usage: { totalTokens: 10 },
        };
      }),
    };
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const runtimeEnv = {
      suggestFallback: jest
        .fn()
        .mockResolvedValue({ action: "retry", retryAfterMs: 0 }),
    };
    const env = new ContextEnvelope({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Solve 2+2.", timestamp: 0 }],
      reminders: [],
      tools: [],
      memory: { sessionId: "s1", userId: "u1" },
      budget: {
        tokensUsed: 0,
        tokensRemaining: 10_000,
        iterationsUsed: 0,
        iterationsRemaining: 10,
        wallTimeStartMs: Date.now(),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runtimeEnv: runtimeEnv as any,
    });

    const events = await drain(
      loop.run(env, criteria, { agentId: "retry-ok" }),
    );

    // 重试了一次：chat 被调用 2 次
    expect(chat.chat).toHaveBeenCalledTimes(2);
    // 中途发出一个 recoverable error 事件（retryAttempt=1）
    const recoverableErr = events.find(
      (e) =>
        e.type === "error" &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e.payload as any)?.recoverable === true,
    );
    expect(recoverableErr).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((recoverableErr!.payload as any).diagnostic?.retryAttempt).toBe(1);
    // 最终正常 finalize，而不是终态 error
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "completed" });
  });

  it("caps consecutive recoverable retries (circuit breaker) then terminates", async () => {
    // chat 一直 429；应在 MAX_RECOVERABLE_RETRIES(默认 3) 次重试后终止
    const chat = {
      chat: jest.fn().mockRejectedValue(new Error("429 too many requests")),
    };
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const runtimeEnv = {
      suggestFallback: jest
        .fn()
        .mockResolvedValue({ action: "retry", retryAfterMs: 0 }),
    };
    const env = new ContextEnvelope({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Solve 2+2.", timestamp: 0 }],
      reminders: [],
      tools: [],
      memory: { sessionId: "s1", userId: "u1" },
      budget: {
        tokensUsed: 0,
        tokensRemaining: 10_000,
        iterationsUsed: 0,
        iterationsRemaining: 10,
        wallTimeStartMs: Date.now(),
      },
      // maxIterations=10 远大于重试上限，确保是 breaker 而非 iteration 触顶
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runtimeEnv: runtimeEnv as any,
    });

    const events = await drain(
      loop.run(
        env,
        { maxIterations: 10, terminateOn: ["finalize"] },
        {
          agentId: "retry-cap",
        },
      ),
    );

    // 3 次重试 + 第 4 次不再重试 → chat 调用 4 次
    expect(chat.chat).toHaveBeenCalledTimes(4);
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "error" });
  });

  // ── P0 (2026-05-22): provider cooldown 按 remainingMs 退避重试 ──────────────
  function makeRetryEnv(): ContextEnvelope {
    const runtimeEnv = {
      suggestFallback: jest
        .fn()
        .mockResolvedValue({ action: "retry", retryAfterMs: 0 }),
    };
    return new ContextEnvelope({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Solve 2+2.", timestamp: 0 }],
      reminders: [],
      tools: [],
      memory: { sessionId: "s1", userId: "u1" },
      budget: {
        tokensUsed: 0,
        tokensRemaining: 10_000,
        iterationsUsed: 0,
        iterationsRemaining: 10,
        wallTimeStartMs: Date.now(),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runtimeEnv: runtimeEnv as any,
    });
  }

  it("retries a provider cooldown error (short remainingMs) then succeeds", async () => {
    let calls = 0;
    const chat = {
      chat: jest.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(
            new Error(
              'Provider "openai" is temporarily unavailable (cooldown). Please try again later.',
            ),
            { remainingMs: 5 },
          );
        }
        return {
          content: JSON.stringify({
            thinking: "ok now",
            action: { kind: "finalize", output: "4" },
          }),
          model: "mock",
          usage: { totalTokens: 10 },
        };
      }),
    };
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeRetryEnv(), criteria, { agentId: "cooldown-retry" }),
    );

    expect(chat.chat).toHaveBeenCalledTimes(2);
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "completed" });
  });

  it("does NOT retry a cooldown longer than the in-loop wait cap; terminates", async () => {
    const chat = {
      chat: jest
        .fn()
        .mockRejectedValue(
          Object.assign(
            new Error(
              'Provider "openai" is temporarily unavailable (cooldown).',
            ),
            { remainingMs: 300_000 },
          ),
        ),
    };
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeRetryEnv(), criteria, { agentId: "cooldown-long" }),
    );

    // remainingMs 300s > 30s 上限 → 不在循环内死等 → 只调用一次后终止
    expect(chat.chat).toHaveBeenCalledTimes(1);
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "error" });
  });

  // ── P0-2: hasUnexecutedToolUse — 防回归测试 ──────────────────────────────
  it("P0-2: continues loop when LLM returns stop_reason=end_turn but content contains tool_call intent (parse failed)", async () => {
    // Scenario: LLM first returns truncated/broken JSON with a tool_call inside
    // (simulating stop_reason='end_turn' but content has unexecuted tool intent).
    // parseDecision will fall back to finalize-raw, but the loop should detect
    // the tool_call intent and retry instead of terminating prematurely.
    const brokenToolCall =
      '{"thinking":"I should search","action":{"kind":"tool_call","toolId":"calc","input":';
    // Second response: proper finalize after retry nudge
    const properFinalize = JSON.stringify({
      thinking: "Now I finalize",
      action: { kind: "finalize", output: "42" },
    });
    const chat = mkChat([brokenToolCall, properFinalize]);
    const reg = mkToolRegistry({ calc: { success: true, data: 42 } });
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(["calc"]), criteria, { agentId: "p02-test" }),
    );

    // Loop must NOT have terminated on the first (broken) response
    // Instead it should have continued and eventually finalized with "42"
    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "completed" });

    const output = events.find((e) => e.type === "output");
    expect(output?.payload).toEqual({ output: "42" });

    // chat.chat must have been called twice (once for broken, once for retry)
    expect(chat.chat).toHaveBeenCalledTimes(2);
  });

  it("P0-2: does NOT inject retry nudge when parse succeeded cleanly (no false positive)", async () => {
    // Normal scenario: LLM outputs valid finalize JSON (no parseError)
    // The loop should terminate normally without injecting a retry nudge
    const chat = mkChat([
      JSON.stringify({
        thinking: "I have the answer",
        action: { kind: "finalize", output: "clean answer" },
      }),
    ]);
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(), criteria, { agentId: "p02-no-false-pos" }),
    );

    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "completed" });

    const output = events.find((e) => e.type === "output");
    expect(output?.payload).toEqual({ output: "clean answer" });

    // chat.chat must have been called exactly once (no retry)
    expect(chat.chat).toHaveBeenCalledTimes(1);
  });

  it("P0-6: invokes all Stop hooks (including skipOnApiError=true) on normal completion", async () => {
    const chat = mkChat([
      JSON.stringify({
        thinking: "done",
        action: { kind: "finalize", output: "result" },
      }),
    ]);
    const reg = mkToolRegistry({});
    const hooks = new HookRegistry();
    const stopCalls: string[] = [];

    hooks.register({
      event: "Stop",
      scope: "global",
      skipOnApiError: true,
      handler: () => {
        stopCalls.push("skip-on-api-error-hook");
      },
    });
    hooks.register({
      event: "Stop",
      scope: "global",
      handler: () => {
        stopCalls.push("always-run-hook");
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);

    const events = await drain(
      loop.run(makeEnvelope(), criteria, { agentId: "normal-stop-test" }),
    );

    const terminated = events.find((e) => e.type === "terminated");
    expect(terminated?.payload).toMatchObject({ reason: "completed" });

    // On normal completion, both hooks run
    expect(stopCalls).toContain("skip-on-api-error-hook");
    expect(stopCalls).toContain("always-run-hook");
  });

  // Security R1 P1 (2026-05-07): 协议保留 kind 必须被 normalizeAction 拒绝。
  // skill_invoke / subagent_spawn / llm_generate 不在 DECISION_SYSTEM_SUFFIX 协议里，
  // 即使 LLM 吐出（含 input），也不能走 toolId-as-kind 容错路径（绕过 ToolRegistry
  // 注册检查），必须抛 InvalidActionError(unknown_kind) → fallback finalize-raw。
  describe("normalizeAction reserved-kind rejection", () => {
    for (const reserved of ["skill_invoke", "subagent_spawn", "llm_generate"]) {
      it(`rejects kind="${reserved}" (with input) → no tool dispatch`, async () => {
        const chat = mkChat([
          JSON.stringify({
            thinking: "trying reserved kind",
            action: {
              kind: reserved,
              // 关键：带 input 字段触发 toolId-as-kind 容错路径，
              // 但 RESERVED_ACTION_KINDS 必须把它排除掉，否则就被当 toolId 路由
              input: { evil: "payload" },
            },
          }),
          // 第二轮：fallback 后 LLM 主动 finalize 收尾（这里不会走到，
          // 因为第一轮 normalizeAction 抛错会 fallback finalize-raw 直接终止）
          JSON.stringify({
            thinking: "done",
            action: { kind: "finalize", output: "ok" },
          }),
        ]);
        // 关键：reg 必须能 has() 这个 reserved 名，否则即使路由到 tool_call
        // 也会被 ToolNotFound 挡 —— 我们要测的是更前一道：normalizeAction 不放过
        const reg = mkToolRegistry({
          [reserved]: { success: true, data: "PWNED" },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoker = new ToolInvoker(reg as any);
        const invokeSpy = jest.spyOn(invoker, "invoke");
        const hooks = new HookRegistry();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const loop = new ReActLoop(chat as any, invoker, hooks);
        const events = await drain(
          loop.run(makeEnvelope([reserved]), criteria, {
            agentId: "reserved-kind-test",
          }),
        );
        // 1) 没有 tool 被真正 invoke —— 即使 reg 注册了同名 entry
        expect(invokeSpy).not.toHaveBeenCalled();
        // 2) action_executed 只有 finalize（fallback），没有 tool_call
        const executed = events.filter((e) => e.type === "action_executed");
        for (const ev of executed) {
          const action = (ev.payload as { action: { kind: string } }).action;
          expect(action.kind).not.toBe("tool_call");
          expect(action.kind).not.toBe(reserved);
        }
        // 3) terminated 必须达到（不会 hang，不会 InvalidActionError 冒泡到 caller）
        const terminated = events.find((e) => e.type === "terminated");
        expect(terminated).toBeDefined();
      });
    }
  });

  // ★ P1a/P1b (2026-05-25): delimited finalize transport (env-gated).
  describe("delimited finalize transport (ENABLE_DELIMITED_FINALIZE)", () => {
    const prev = process.env.ENABLE_DELIMITED_FINALIZE;
    afterEach(() => {
      if (prev === undefined) delete process.env.ENABLE_DELIMITED_FINALIZE;
      else process.env.ENABLE_DELIMITED_FINALIZE = prev;
    });

    it("reconstructs finalize body from delimited blocks (immune to unescaped quotes)", async () => {
      process.env.ENABLE_DELIMITED_FINALIZE = "true";
      // model emits short envelope + a <<<FIELD:body>>> block whose prose contains
      // unescaped ASCII quotes that would have broken a single JSON object.
      const chat = mkChat([
        [
          '{"thinking":"done","action":{"kind":"finalize","output":{"index":4,"heading":"未来"}}}',
          "<<<FIELD:body>>>",
          '不再只是"跑得快"的引擎，更需成为"可信任"的基座[1]。',
          "<<<END:body>>>",
        ].join("\n"),
      ]);
      const reg = mkToolRegistry({});
      const hooks = new HookRegistry();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoker = new ToolInvoker(reg as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loop = new ReActLoop(chat as any, invoker, hooks);

      const events = await drain(
        loop.run(makeEnvelope([]), criteria, {
          agentId: "writer",
          finalizeProseFields: ["body"],
        }),
      );

      const output = events.find((e) => e.type === "output");
      const payload = output?.payload as { output: { body: string } };
      expect(payload.output.body).toContain('"跑得快"');
      expect(payload.output.body).toContain('"可信任"');
      // appended delimited instructions reached the model prompt
      const sys = (chat.chat as jest.Mock).mock.calls[0][0].systemPrompt;
      expect(sys).toContain("<<<FIELD:body>>>");
    });

    it("is OFF by default: delimited markers NOT instructed, normal JSON path used", async () => {
      delete process.env.ENABLE_DELIMITED_FINALIZE;
      const chat = mkChat([
        JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { body: "plain" } },
        }),
      ]);
      const reg = mkToolRegistry({});
      const hooks = new HookRegistry();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoker = new ToolInvoker(reg as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loop = new ReActLoop(chat as any, invoker, hooks);

      await drain(
        loop.run(makeEnvelope([]), criteria, {
          agentId: "writer",
          finalizeProseFields: ["body"],
        }),
      );
      const sys = (chat.chat as jest.Mock).mock.calls[0][0].systemPrompt;
      expect(sys).not.toContain("<<<FIELD:body>>>");
    });
  });
});

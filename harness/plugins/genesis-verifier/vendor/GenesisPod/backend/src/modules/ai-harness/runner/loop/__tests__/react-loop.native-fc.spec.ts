/**
 * ReActLoop — PR-1 native function-calling 路径单测
 *
 * 验证：
 *   1. flag ON + LLM 返回 toolCalls → 跳过 JSON parse，直接 dispatch tool。
 *   2. flag ON + LLM 返回多个 toolCalls → 合并成 parallel_tool_call 一并并发。
 *   3. flag ON + LLM 返回空 toolCalls + content 是 toolId-as-kind dialect
 *      → 回退 parseDecision 路径，方言容错把 kind="web-search" 当 toolId 用。
 *   4. flag OFF（默认）+ LLM 返回 toolCalls → 走旧 prompt-driven 路径，
 *      toolCalls 被忽略，parseDecision 处理 content。验证默认行为不变。
 *   A. flag ON + envelope.tools=[] → 不走 native FC（fcDefs 空），chat 收 tools=undefined。
 *   B. flag ON + 没注 AgentToolRegistry → 不走 native FC，照常 prompt-driven。
 *   C. flag ON + response.toolCalls=[]（空数组而非 undefined）→ 回退 parseDecision。
 */

import { ReActLoop } from "../react-loop";
import { HookRegistry } from "../../../agents/core/hook-registry";
import { ContextEnvelope } from "../../../agents/core/context-envelope";
import { ToolInvoker } from "../../tool-invoker/tool-invoker";
import type {
  IAgentEvent,
  ILoopTerminationCriteria,
} from "../../../agents/abstractions";

type ChatStubResponse = {
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
};

function makeEnvelope(tools: string[] = []): ContextEnvelope {
  return new ContextEnvelope({
    system: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Find docs.", timestamp: 0 }],
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

function mkChat(responses: ChatStubResponse[]) {
  let i = 0;
  return {
    chat: jest.fn(async () => {
      const r = responses[i++] ?? responses[responses.length - 1];
      return {
        content: r.content ?? "",
        toolCalls: r.toolCalls,
        model: "mock",
        usage: { totalTokens: 10 },
      };
    }),
  };
}

function mkToolRegistry(
  tools: Record<string, { success: boolean; data?: unknown }>,
) {
  return {
    has: jest.fn((id: string) => id in tools),
    get: jest.fn((id: string) => ({
      id,
      execute: jest.fn(async () => ({
        success: tools[id].success,
        data: tools[id].data,
        metadata: {
          executionId: "x",
          startTime: new Date(),
          endTime: new Date(),
        },
      })),
    })),
  };
}

// 最小 AgentToolRegistry stub —— 只用 getSchemas()。
function mkAgentToolRegistry(tools: string[]) {
  return {
    getSchemas: jest.fn((ids: readonly string[]) =>
      ids
        .filter((id) => tools.includes(id))
        .map((id) => ({
          type: "function" as const,
          function: {
            name: id,
            description: `Tool ${id}`,
            parameters: { type: "object", properties: {} },
          },
        })),
    ),
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

describe("ReActLoop · PR-1 native function-calling", () => {
  const ORIGINAL_FLAG = process.env.HARNESS_REACT_NATIVE_FC;
  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.HARNESS_REACT_NATIVE_FC;
    else process.env.HARNESS_REACT_NATIVE_FC = ORIGINAL_FLAG;
  });

  it("1. flag ON: consumes response.toolCalls and dispatches tool", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        toolCalls: [
          { id: "c1", name: "web-search", arguments: { query: "react" } },
        ],
      },
      {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({ "web-search": { success: true, data: "ok" } });
    const atr = mkAgentToolRegistry(["web-search"]);
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    const loop = new ReActLoop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat as any,
      invoker,
      hooks,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atr as any,
    );
    const events = await drain(
      loop.run(makeEnvelope(["web-search"]), criteria, { agentId: "a1" }),
    );
    // action_executed = 1 (tool) + 1 (finalize) = 2
    const executed = events.filter((e) => e.type === "action_executed");
    expect(executed.length).toBe(2);
    // tool invocation 真实发生（reg.get 至少一次命中 web-search）
    expect(reg.get).toHaveBeenCalledWith("web-search");
    // FC wiring: getSchemas 被以 envelope.tools 调用，chat 收到 tools 字段
    expect(atr.getSchemas).toHaveBeenCalledWith(["web-search"]);
    const firstChatArg = (chat.chat as jest.Mock).mock.calls[0][0];
    expect(firstChatArg.tools).toBeDefined();
    expect(firstChatArg.tools.length).toBe(1);
    expect(firstChatArg.tools[0].name).toBe("web-search");
    // 与 prompt-driven 路径关键差异：responseFormat 没设
    expect(firstChatArg.responseFormat).toBeUndefined();
    // ★ 2026-05-07 layer 6 修法：FC 路径也保留完整 envelope 协议描述
    //   （让 vLLM tool parser 失效时 fallback parseDecision 真兜底有效）
    //   prompt 描述对 native tool_calls 路径无害 — LLM parser 装对仍走 toolCalls
    expect(firstChatArg.systemPrompt).toMatch(/DO NOT put the action content/);
    // reserved internals 警告也仍在（原 SYSTEM_SUFFIX 字面）
    expect(firstChatArg.systemPrompt).toMatch(/skill_invoke/);
  });

  it("1b. T2: forbidden tools are filtered out of the LLM-visible tool list", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        toolCalls: [
          { id: "c1", name: "web-search", arguments: { query: "react" } },
        ],
      },
      {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({ "web-search": { success: true, data: "ok" } });
    const atr = mkAgentToolRegistry(["web-search", "rag-search"]);
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    const loop = new ReActLoop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat as any,
      invoker,
      hooks,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atr as any,
    );
    const events = await drain(
      loop.run(makeEnvelope(["web-search", "rag-search"]), criteria, {
        agentId: "a1",
        forbiddenTools: ["rag-search"],
      }),
    );
    expect(events.filter((e) => e.type === "terminated").length).toBe(1);
    // T2: the forbidden tool must never be built into FunctionDefinitions, so
    // getSchemas is called with the filtered list and chat() only sees web-search.
    expect(atr.getSchemas).toHaveBeenCalledWith(["web-search"]);
    const firstChatArg = (chat.chat as jest.Mock).mock.calls[0][0];
    expect(firstChatArg.tools.map((t: { name: string }) => t.name)).toEqual([
      "web-search",
    ]);
  });

  it("2. flag ON: multiple toolCalls become parallel_tool_call", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        toolCalls: [
          { id: "c1", name: "web-search", arguments: { q: "a" } },
          { id: "c2", name: "rag-search", arguments: { q: "b" } },
        ],
      },
      {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({
      "web-search": { success: true, data: "x" },
      "rag-search": { success: true, data: "y" },
    });
    const atr = mkAgentToolRegistry(["web-search", "rag-search"]);
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    const loop = new ReActLoop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat as any,
      invoker,
      hooks,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atr as any,
    );
    const events = await drain(
      loop.run(makeEnvelope(["web-search", "rag-search"]), criteria, {
        agentId: "a1",
      }),
    );
    // parallel_tool_call → 1 个 action_executed（聚合）+ 1 finalize = 2
    expect(events.filter((e) => e.type === "action_executed").length).toBe(2);
    // 但两个 tool 都被实际调用（registry get 命中两次）
    expect(reg.get).toHaveBeenCalledWith("web-search");
    expect(reg.get).toHaveBeenCalledWith("rag-search");
    const planned = events.find(
      (e) =>
        e.type === "action_planned" &&
        (e.payload as { kind?: string }).kind === "parallel_tool_call",
    );
    expect(planned).toBeDefined();
    expect((planned!.payload as { calls?: unknown[] }).calls!.length).toBe(2);
  });

  it("3. flag ON + empty toolCalls + toolId-as-kind content: falls back to parseDecision dialect tolerance", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        content: JSON.stringify({
          thinking: "search",
          action: { kind: "web-search", input: { query: "react" } },
        }),
      },
      {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({ "web-search": { success: true, data: "ok" } });
    const atr = mkAgentToolRegistry(["web-search"]);
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    const loop = new ReActLoop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat as any,
      invoker,
      hooks,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atr as any,
    );
    const events = await drain(
      loop.run(makeEnvelope(["web-search"]), criteria, { agentId: "a1" }),
    );
    expect(events.filter((e) => e.type === "action_executed").length).toBe(2);
    expect(reg.get).toHaveBeenCalledWith("web-search");
  });

  it("4. flag OFF (default): toolCalls ignored, parseDecision drives dispatch", async () => {
    delete process.env.HARNESS_REACT_NATIVE_FC;
    const chat = mkChat([
      {
        toolCalls: [
          { id: "c1", name: "web-search", arguments: { q: "ignored" } },
        ],
        content: JSON.stringify({
          thinking: "use canonical envelope",
          action: {
            kind: "tool_call",
            toolId: "web-search",
            input: { q: "from-content" },
          },
        }),
      },
      {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({ "web-search": { success: true, data: "ok" } });
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // 不传 AgentToolRegistry —— 模拟旧 wiring
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);
    const events = await drain(
      loop.run(makeEnvelope(["web-search"]), criteria, { agentId: "a1" }),
    );
    expect(events.filter((e) => e.type === "action_executed").length).toBe(2);
    expect(reg.get).toHaveBeenCalledWith("web-search");
    const firstChatArg = (chat.chat as jest.Mock).mock.calls[0][0];
    // flag OFF：tools 不应该被透给 chat()
    expect(firstChatArg.tools).toBeUndefined();
    // 旧路径 responseFormat 仍然 "json"
    expect(firstChatArg.responseFormat).toBe("json");
  });

  // ───── 补充覆盖（review 反馈：A/B/C MUST-ADD） ─────

  it("A. flag ON + envelope.tools=[]: native FC short-circuits, no tools field on chat()", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        content: JSON.stringify({
          thinking: "no tools available",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({});
    const atr = mkAgentToolRegistry([]);
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    const loop = new ReActLoop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat as any,
      invoker,
      hooks,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atr as any,
    );
    const events = await drain(
      loop.run(makeEnvelope([]), criteria, { agentId: "a1" }),
    );
    // 至少有 finalize 的 action_executed，loop 不挂
    expect(
      events.filter((e) => e.type === "action_executed").length,
    ).toBeGreaterThanOrEqual(1);
    const firstChatArg = (chat.chat as jest.Mock).mock.calls[0][0];
    expect(firstChatArg.tools).toBeUndefined();
    expect(firstChatArg.responseFormat).toBe("json");
  });

  it("B. flag ON without AgentToolRegistry injection: falls back to prompt-driven cleanly", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        content: JSON.stringify({
          thinking: "ok",
          action: {
            kind: "tool_call",
            toolId: "web-search",
            input: { q: "x" },
          },
        }),
      },
      {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({ "web-search": { success: true, data: "ok" } });
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    // 故意不传 AgentToolRegistry（旧 wiring / 测试环境少注 provider）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop = new ReActLoop(chat as any, invoker, hooks);
    const events = await drain(
      loop.run(makeEnvelope(["web-search"]), criteria, { agentId: "a1" }),
    );
    expect(events.filter((e) => e.type === "action_executed").length).toBe(2);
    expect(reg.get).toHaveBeenCalledWith("web-search");
    const firstChatArg = (chat.chat as jest.Mock).mock.calls[0][0];
    // ATR 没注 → buildFunctionDefinitions 返 [] → 走老路径
    expect(firstChatArg.tools).toBeUndefined();
    expect(firstChatArg.responseFormat).toBe("json");
  });

  it("C. flag ON + response.toolCalls=[] (empty array, not undefined): falls back to parseDecision", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        // 显式空数组 —— 验证 .length > 0 守卫真生效（vs 偷懒 truthy check）
        toolCalls: [],
        content: JSON.stringify({
          thinking: "fallback",
          action: {
            kind: "tool_call",
            toolId: "web-search",
            input: { q: "x" },
          },
        }),
      },
      {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({ "web-search": { success: true, data: "ok" } });
    const atr = mkAgentToolRegistry(["web-search"]);
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    const loop = new ReActLoop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat as any,
      invoker,
      hooks,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atr as any,
    );
    const events = await drain(
      loop.run(makeEnvelope(["web-search"]), criteria, { agentId: "a1" }),
    );
    expect(events.filter((e) => e.type === "action_executed").length).toBe(2);
    expect(reg.get).toHaveBeenCalledWith("web-search");
  });

  // Layer 4/5 (2026-05-07): native FC callId 全链透传 —— LLM tool_use_id 必须到
  // ToolInvoker.action.callId + envelope role:"tool".toolCallId + 下轮 ChatMessage
  // role:"tool" + toolCallId 字段（buildMessages 不再 user 降级，wire 字段权威）。
  it("D. callId E2E: tool_use_id 透到 invoker + envelope + 下轮 ChatMessage role:tool/toolCallId", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        toolCalls: [
          { id: "call_abc123", name: "web-search", arguments: { q: "x" } },
        ],
      },
      {
        content: JSON.stringify({
          thinking: "done",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({ "web-search": { success: true, data: "ok" } });
    const atr = mkAgentToolRegistry(["web-search"]);
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    const invokeSpy = jest.spyOn(invoker, "invoke");
    const loop = new ReActLoop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat as any,
      invoker,
      hooks,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atr as any,
    );
    await drain(
      loop.run(makeEnvelope(["web-search"]), criteria, { agentId: "a1" }),
    );
    // 1. ToolInvoker 收到的 action 必须带 callId（来自 LLM tc.id）
    const invokedAction = invokeSpy.mock.calls[0][0];
    expect((invokedAction as { callId?: string }).callId).toBe("call_abc123");
    // 2. 第二轮 chat 收到的 messages 里：role:"tool" + toolCallId 字段直接出现
    //    （之前是降级 user + content prefix [tool_result ... call_id=Y]，layer 4/5 拿掉占位）
    const secondChatArg = (chat.chat as jest.Mock).mock.calls[1][0];
    const toolMsgs = (
      secondChatArg.messages as Array<{
        role: string;
        toolCallId?: string;
        content: string;
      }>
    ).filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBe(1);
    expect(toolMsgs[0].toolCallId).toBe("call_abc123");
    // 3. 不应再有 [tool_result ... call_id=...] 这种 prompt prefix 占位
    const allContent = (secondChatArg.messages as Array<{ content: string }>)
      .map((m) => m.content)
      .join("\n");
    expect(allContent).not.toMatch(/\[tool_result.*call_id=/);
  });

  // Layer 6 (2026-05-07): vLLM tool parser 失效场景下双层网兜底真生效 ——
  // 即"FC 模式 prompt 必须包含 envelope 协议描述，让 LLM 即使没 native tool 通道
  // 也能按 prompt 引导吐 envelope JSON，由 parseDecision 兜底执行"。
  //
  // 业务不变量（这条 spec 的语义命名）：
  //   FC SUFFIX 与 prompt-driven SUFFIX 字节一致 → 切 flag 不掉 cache、双层网真兜底
  it("E. layer 6 invariant: FC SUFFIX 含完整 envelope 协议（与 prompt-driven 字节一致）", async () => {
    process.env.HARNESS_REACT_NATIVE_FC = "true";
    const chat = mkChat([
      {
        // LLM 没吐 toolCalls（模拟 vLLM 无 --tool-call-parser），
        // 但按 prompt 引导吐 envelope JSON content
        content: JSON.stringify({
          thinking: "parser missing fallback",
          action: { kind: "finalize", output: { ok: true } },
        }),
      },
    ]);
    const reg = mkToolRegistry({});
    const atr = mkAgentToolRegistry(["web-search"]);
    const hooks = new HookRegistry();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoker = new ToolInvoker(reg as any);
    const loop = new ReActLoop(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chat as any,
      invoker,
      hooks,
      undefined,
      undefined,
      undefined,
      undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      atr as any,
    );
    const events = await drain(
      loop.run(makeEnvelope(["web-search"]), criteria, { agentId: "a1" }),
    );
    // 没 native tool_calls，但 parseDecision 兜底真把 finalize 跑通
    expect(events.some((e) => e.type === "action_executed")).toBe(true);
    const firstChatArg = (chat.chat as jest.Mock).mock.calls[0][0];
    // 关键不变量 1：FC 路径仍 push tools 字段（native FC 通道开启）
    expect(firstChatArg.tools).toBeDefined();
    expect(firstChatArg.tools.length).toBe(1);
    // 关键不变量 2：FC SUFFIX 必含 envelope 协议描述的多个字面签名 ——
    //   这是 Layer 6 兜底的唯一语义保证，丢了就退化成 commit f50b50d36a 之前的
    //   "运营段独占"半残状态（vLLM parser 失效 → tool call 全无）
    expect(firstChatArg.systemPrompt).toContain("## Decision Protocol");
    expect(firstChatArg.systemPrompt).toContain(
      "EXACTLY this two-level wrapper",
    );
    expect(firstChatArg.systemPrompt).toContain('"thinking"');
    expect(firstChatArg.systemPrompt).toContain('"action"');
    expect(firstChatArg.systemPrompt).toContain("parallel_tool_call");
    // 关键不变量 3：reserved internals 警告也在 FC SUFFIX 里 ——
    //   防止 LLM 即使在 FC 模式也吐 skill_invoke / subagent_spawn 这种保留 kind
    expect(firstChatArg.systemPrompt).toContain("skill_invoke");
    expect(firstChatArg.systemPrompt).toContain("subagent_spawn");
    expect(firstChatArg.systemPrompt).toContain("llm_generate");
  });

  // Security R2 P0 (2026-05-07): FC 路径与 prompt-driven 路径对称防御 ——
  //   prompt-driven 走 normalizeAction 时 RESERVED_ACTION_KINDS 拦保留 kind；
  //   FC 路径之前完全绕过这层防御，仅靠 ToolRegistry.has() 兜底（如未来有人
  //   误注册同名 tool 就穿透）。decisionFromToolCalls 现在做对称拒绝。
  //
  // 攻击场景：LLM 在 FC 模式吐 toolCalls=[{name:"skill_invoke", arguments:...}]
  //   → 命中 RESERVED_ACTION_KINDS 抛 InvalidActionError → finalize-raw 兜底
  //   → ToolInvoker.invoke 永不被调用（即使 reg 注册了同名 entry）
  for (const reservedName of [
    "skill_invoke",
    "subagent_spawn",
    "llm_generate",
  ]) {
    it(`F. FC path: toolCalls.name="${reservedName}" → rejected before invoke (no PWNED)`, async () => {
      process.env.HARNESS_REACT_NATIVE_FC = "true";
      const chat = mkChat([
        {
          // LLM 在 FC 模式直接吐 reserved name 作为 tool name
          toolCalls: [
            { id: "evil_call_1", name: reservedName, arguments: { evil: "x" } },
          ],
        },
      ]);
      // 故意注册同名 tool entry —— 模拟"如果 RESERVED 检查漏掉，ToolRegistry
      // 二层防御 has() 返回 true，tool 真被执行返回 PWNED"的最坏场景
      const reg = mkToolRegistry({
        [reservedName]: { success: true, data: "PWNED" },
      });
      const atr = mkAgentToolRegistry([reservedName]);
      const hooks = new HookRegistry();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invoker = new ToolInvoker(reg as any);
      const invokeSpy = jest.spyOn(invoker, "invoke");
      const loop = new ReActLoop(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chat as any,
        invoker,
        hooks,
        undefined,
        undefined,
        undefined,
        undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        atr as any,
      );
      const events = await drain(
        loop.run(makeEnvelope([reservedName]), criteria, { agentId: "fc-sec" }),
      );
      // 1) ToolInvoker.invoke 永不被调用 —— 这是核心安全保证（与 prompt-driven
      //    spec 对称）。即使 ToolRegistry 注册了同名 entry，decisionFromToolCalls
      //    早一步拒绝。
      expect(invokeSpy).not.toHaveBeenCalled();
      expect(reg.get).not.toHaveBeenCalled();
      // 2) action_executed 不含 tool_call 也不含 reserved kind ——
      //    保留 kind 不会作为 toolId 路由
      const executed = events.filter((e) => e.type === "action_executed");
      for (const ev of executed) {
        const action = (ev.payload as { action: { kind: string } }).action;
        expect(action.kind).not.toBe("tool_call");
        expect(action.kind).not.toBe(reservedName);
      }
      // 3) loop terminated（不冒泡 InvalidActionError 到 caller）
      const terminated = events.find((e) => e.type === "terminated");
      expect(terminated).toBeDefined();
    });
  }
});

/**
 * ReActLoop — Reason + Act 循环（SOTA v2）
 *
 * 每轮：
 *   1. perceive: 把 envelope 组装成 LLM input
 *   2. reason:   调用 AiChatService 产出 { thinking, action(s) }
 *   3. act:      执行 action（单 tool / parallel tool / finalize / skill / subagent）
 *   4. reflect:  把 action result 写回 envelope
 *
 * 终止条件：
 *   - finalize action
 *   - 达到 maxIterations
 *   - BudgetAccountant.exhausted() === true（v2 新增：Loop 内强制）
 *   - signal.aborted
 *   - 不可恢复错误
 *
 * v2 升级：
 *   - LLM 可输出 action.kind === "parallel_tool_call"，并行调用多个 tool
 *   - LLM 可使用简写 "actions" 数组，Loop 自动包装为 parallel_tool_call
 *   - 集成 BudgetAccountant：每轮 LLM 调用后扣预算；70% 触发 budget_warning；100% abort
 *   - subagent_spawn 接通 SubagentSpawner（可选注入；Phase D）
 *   - 错误自愈：tool 错误注入下轮 prompt，LLM 可调整策略
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type {
  AgentEventPayload,
  AgentLoopKind,
  HarnessFailureCode,
  IAgentEvent,
  IAgentLoop,
  IAction,
  IActionResult,
  IContextEnvelope,
  IContextMessage,
  ILoopTerminationCriteria,
  IParallelToolCallAction,
  IToolCallAction,
} from "../../agents/abstractions";
import { ContextEnvelope } from "../../agents/core/context-envelope";
import {
  extractJsonFromAIResponse,
  stripReasoningBlocks,
} from "../../../../common/utils/json-extraction.utils";
import { parsePositiveIntEnv } from "../../../../common/utils/schema-coercion.utils";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import {
  type DelimitedFinalizeShape,
  buildDelimitedFinalizeInstructions,
  hasDelimitedFinalizeMarkers,
  parseDelimitedFinalize,
} from "../../../ai-engine/llm/output/structured/delimited-finalize.transport";
import type { ChatMessage } from "../../../ai-engine/llm/types";
import { AIModelType } from "@prisma/client";
import { ToolInvoker } from "../tool-invoker/tool-invoker";
import { AgentToolSchemaRegistry } from "../env/agent-tool-schema-registry";
import type { FunctionDefinition } from "@/modules/ai-engine/tools/abstractions/tool.interface";
import { ContextManager } from "../context/context-manager";
import { CacheControlPlanner } from "../context/cache-control-planner";
import { HookRegistry } from "../../agents/core/hook-registry";
import { BudgetAccountant } from "../../guardrails/budget/budget-accountant";
import { ModelPricingRegistry } from "@/modules/ai-engine/llm/models/pricing/model-pricing.registry";
import { wrapToolObservation } from "./external-observation.util";
import {
  MAX_TOOL_GATE_NUDGES,
  shouldBlockFinalizeForToolGate,
  buildToolGateCritique,
} from "./tool-gate.util";
import type { IAgent, ISubagentSpawner } from "../../agents/abstractions";
import {
  rawContentHasUnexecutedToolIntent,
  envelopeHasUnexecutedToolUse,
} from "./utils/follow-up-detector";
import { REACT_LOOP_DECISION_JSON_SCHEMA } from "./loop-output-schemas";
import {
  isModelLevelFailoverError,
  MAX_MODEL_FAILOVERS,
} from "../executor/llm-executor";

/**
 * #35 — Build a decision-wrapper schema that embeds the strict business-agent
 * finalize output schema inside the `action.output` field.
 *
 * Used on final iterations (approachingLimit=true) when the LLM is directed
 * to emit `finalize`. Wrapping the business schema inside the decision keeps
 * `thinking` + `action.kind` visible to the provider while enforcing the
 * payload shape under `action.output`.
 *
 * The outer wrapper stays permissive (additionalProperties:true) so dialect
 * variants (e.g. top-level `actions` shorthand) are never rejected.
 * Only `action.output` is strict (additionalProperties:false on its inner
 * object as declared in the business schema).
 *
 * Returns null if finalizeOutputJsonSchema is not provided (caller uses the
 * permissive REACT_LOOP_DECISION_JSON_SCHEMA as before).
 */
function buildFinalizeDecisionSchema(
  finalizeOutputJsonSchema: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!finalizeOutputJsonSchema) return null;
  return {
    type: "object",
    properties: {
      thinking: { type: "string" },
      action: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["finalize"] },
          output: finalizeOutputJsonSchema,
        },
        required: ["kind", "output"],
        additionalProperties: false,
      },
    },
    additionalProperties: true,
  };
}

interface ParsedDecision {
  thinking: string;
  action: IAction;
}

/**
 * 标记 LLM JSON 响应里的 action 字段无法规范化成合法 IAction。
 *
 * subCode 细分：
 *   - missing_action       缺 action 字段或非对象
 *   - unknown_kind         kind 不在合法集合里
 *   - empty_parallel_calls parallel_tool_call.calls 没合法 tool
 *   - empty_actions_array  shorthand actions[] 没合法 tool
 *
 * 由 parseDecision 的 catch 分支接住，转成
 * `thinking="(unparseable LLM output, finalizing with raw text)"` + 把 raw
 * 当 finalize.output。这样：
 *   - thinking 非空 → 不会触发 react-loop 的 empty-finalize 熔断
 *   - loop 走正常 finalize 终止 → ReflexionLoop 看到空/退化 output 后
 *     按"空 output → critique → revise"链路重试，而不是被立即 abort。
 */
class InvalidActionError extends Error {
  readonly subCode:
    | "missing_action"
    | "unknown_kind"
    | "empty_parallel_calls"
    | "empty_actions_array";
  constructor(
    message: string,
    subCode: InvalidActionError["subCode"] = "missing_action",
  ) {
    super(message);
    this.name = "InvalidActionError";
    this.subCode = subCode;
  }
}

// flag-off / prompt-driven 路径用 SUFFIX —— 字节字面与 commit f50b50d36a 之前的
// 原版完全等价（保 prompt cache prefix 命中率，避免切 flag 触发 cache miss）。
const DECISION_SYSTEM_SUFFIX = `

## Decision Protocol

You MUST reply with a single JSON object that has EXACTLY this two-level wrapper:
{
  "thinking": "<short reasoning string>",
  "action": { "kind": "...", ... }
}

DO NOT put the action content at the top level. WRONG:
  {"kind":"tool_call","toolId":"...","input":{...}}     ← missing wrapper
  {"kind":"parallel_tool_call","calls":[...]}           ← missing wrapper
RIGHT:
  {"thinking":"I will search","action":{"kind":"tool_call","toolId":"...","input":{...}}}
  {"thinking":"I will run two searches","action":{"kind":"parallel_tool_call","calls":[...]}}

The "action" field must be EXACTLY one of these 3 kinds:

  1. Single tool call (refer to <available_tools> for real toolId + input shape;
     each tool entry shows an "example:" line — copy that wrapping verbatim):
     { "kind": "tool_call", "toolId": "<exact toolId from available_tools>", "input": { ... } }

  2. Multiple tools in one turn (independent, no result feeds another — much faster):
     { "kind": "parallel_tool_call", "calls": [
         { "toolId": "<id-from-available_tools>", "input": { ... } },
         { "toolId": "<another-id>", "input": { ... } }
       ] }

  3. Finalize with the final answer (use this when no more tool calls are needed):
     { "kind": "finalize", "output": <final answer matching the required output schema> }

Shorthand: you may also send "actions": [<tool_call>, <tool_call>, ...] at the
top level — it will be auto-wrapped to parallel_tool_call.

Rules:
- Respond with raw JSON only, no markdown fences, no prose outside the JSON.
- If all information is sufficient, use "finalize".
- Do not invent tool ids; only use ones listed in <available_tools>. Each
  catalog entry has an "example:" line — copy that shape literally and replace
  placeholders with real values.
- If a tool failed previously, choose a different tool or finalize gracefully.
- Only the 3 action kinds above are supported. Do NOT emit "skill_invoke",
  "subagent_spawn", or "llm_generate" — these are reserved internals.
`;

// 协议保留 action kind 集合 —— 用于 normalizeAction toolId-as-kind 容错判定。
// 提到模块级避免 normalizeAction 每轮调用 new Set([...])（高频 agent loop 的小 GC 压力）。
const RESERVED_ACTION_KINDS = new Set([
  "tool_call",
  "parallel_tool_call",
  "finalize",
  "subagent_spawn",
  "skill_invoke",
  "llm_generate",
]);

// flag-on / native FC 路径用 SUFFIX —— 真等于 DECISION_SYSTEM_SUFFIX（同字面）。
//
// 历史踩坑（2026-05-07 用户 prod 卡死复盘）：曾经只保留运营段（删 envelope 协议
// 结构段），假设 vLLM tool parser 接管 wire 格式，prompt 重复描述会噪音。但实际上
// **vLLM 没装 --tool-call-parser <name>** 时（用户最常见 setup 失败模式），LLM 没
// 任何指引怎么吐 tool call —— content 不吐 envelope JSON，toolCalls 也空，**双层网
// 第二层 parseDecision 真兜底拿不到 JSON 来 parse**。Layer 6 等于失效，工具调用全无。
//
// 修法：FC 模式也保留完整 envelope 协议描述。三个考量：
//   1. parser 装对（Nemotron parser → response.toolCalls 直接拿到）：prompt 里多
//      一份 envelope 描述无害（LLM 自然走 native tool_calls 而不复述 envelope）
//   2. parser 没装/装错：prompt 引导 LLM 走 envelope JSON content，fallback
//      parseDecision 真生效（Layer 6 双层网兜底真有效）
//   3. 字节与 DECISION_SYSTEM_SUFFIX 一致：prompt cache prefix 对 flag-on/off
//      切换稳定，无 cache miss
const DECISION_FC_SUFFIX = DECISION_SYSTEM_SUFFIX;

@Injectable()
export class ReActLoop implements IAgentLoop {
  readonly kind: AgentLoopKind = "react";
  private readonly logger = new Logger(ReActLoop.name);

  constructor(
    private readonly chatService: AiChatService,
    private readonly toolInvoker: ToolInvoker,
    private readonly hookRegistry: HookRegistry,
    @Optional() private readonly contextManager?: ContextManager,
    @Optional() private readonly pricingRegistry?: ModelPricingRegistry,
    @Optional() private readonly cachePlanner?: CacheControlPlanner,
    /** B (2026-05-05): AGENT_STEP_BEFORE/AFTER plugin hook seam（plugins/core
     *  HookBus；与 harness 内置 hookRegistry 不同，plugin 这条是 onion 链） */
    @Optional()
    private readonly pluginHookBus?: import("@/plugins/core/hook-bus").HookBus,
    /** PR-1 native-FC: optional —— 启用 native function-calling 路径所需。
     *  缺省（旧测试 / 旧 wiring）走 prompt-driven JSON 路径，行为不变。 */
    @Optional() private readonly agentToolRegistry?: AgentToolSchemaRegistry,
  ) {}

  /**
   * PR-1 native-FC: 全局 flag 开关（默认 OFF）。
   *
   * ON 时，reason() 用 OpenAI 原生 function-calling 路径：
   *   - 把 envelope.tools → FunctionDefinition[] 透给 chatService.chat()
   *   - 不再附加 DECISION_SYSTEM_SUFFIX 强制 JSON 协议
   *   - 不再 responseFormat="json"
   *   - 优先消费 response.toolCalls；为空才回退 parseDecision JSON 路径
   *
   * 回退保留：当 LLM 不支持 native FC（vLLM 没配 tool parser / 模型自家忽略 tools）
   * → response.toolCalls 为空 → 走 parseDecision，里面已有方言容错（含本批次的
   * toolId-as-kind 兜底），双层网安全。
   */
  private get useNativeFunctionCalling(): boolean {
    return process.env.HARNESS_REACT_NATIVE_FC === "true";
  }

  /** envelope.tools (string[]) → FunctionDefinition[]（剥 ToolSchema 外层 type/function 包装）。 */
  private buildFunctionDefinitions(
    toolIds: readonly string[],
  ): FunctionDefinition[] {
    if (!this.agentToolRegistry || toolIds.length === 0) return [];
    return this.agentToolRegistry.getSchemas(toolIds).map((s) => ({
      name: s.function.name,
      description: s.function.description,
      parameters: s.function.parameters as FunctionDefinition["parameters"],
    }));
  }

  /** native FC: 把 chat response.toolCalls → ParsedDecision (action 形态)。 */
  private decisionFromToolCalls(
    toolCalls: NonNullable<
      Awaited<ReturnType<AiChatService["chat"]>>["toolCalls"]
    >,
  ): ParsedDecision {
    // ★ Security R2 修法（2026-05-07）：FC 路径与 prompt-driven 路径必须对称防御 ——
    //   prompt-driven 走 normalizeAction 时 RESERVED_ACTION_KINDS 把 skill_invoke /
    //   subagent_spawn / llm_generate 拦在 toolId-as-kind 容错路径之前；FC 路径之前
    //   完全绕过这层，仅靠 ToolRegistry.has(toolId) 兜底（如果未来有人注册同名 tool
    //   或 registry 被污染就穿透）。这里加一道镜像 RESERVED 检查关闭非对称缺口。
    //   命中即抛 InvalidActionError → 由 reason() 的 catch 走 finalize-raw fallback，
    //   与 prompt-driven 路径行为一致。
    for (const tc of toolCalls) {
      if (RESERVED_ACTION_KINDS.has(tc.name)) {
        throw new InvalidActionError(
          `LLM returned native tool_call with reserved internal name: ` +
            `${JSON.stringify(tc.name)}. ` +
            `Reserved kinds (skill_invoke / subagent_spawn / llm_generate) ` +
            `cannot be invoked as tools.`,
          "unknown_kind",
        );
      }
    }
    const toCall = (tc: (typeof toolCalls)[number]): IToolCallAction => ({
      kind: "tool_call",
      toolId: tc.name,
      input:
        tc.arguments && typeof tc.arguments === "object" ? tc.arguments : {},
      // 透传 LLM 给的 tool_use_id —— IToolCallAction.callId 字段就是为 native FC
      // 配套设计的（见 action.interface.ts:19）。多轮 FC 时 assistant/tool 配对靠这个 id。
      callId: tc.id,
    });
    if (toolCalls.length === 1) {
      return { thinking: "", action: toCall(toolCalls[0]) };
    }
    const calls = toolCalls.map(toCall);
    const action: IParallelToolCallAction = {
      kind: "parallel_tool_call",
      calls,
    };
    return { thinking: "", action };
  }

  async *run(
    envelope: IContextEnvelope,
    criteria: ILoopTerminationCriteria,
    options?: {
      agentId?: string;
      signal?: AbortSignal;
      allowedTools?: readonly string[];
      forbiddenTools?: readonly string[];
      /** v2: 注入 BudgetAccountant 启用 Loop 内预算强制 */
      budget?: BudgetAccountant;
      /** PR-D: 父 Agent + Spawner，启用 subagent_spawn action */
      parent?: IAgent;
      spawner?: ISubagentSpawner;
      /** Spec 声明的 TaskProfile —— reason() 内 chat() 用 agent 真实意图 */
      taskProfile?: import("../../../ai-engine/llm/types/task-profile.types").TaskProfile;
      /** 上层已完成环境感知选举时，强制本次 agent 运行使用该模型 */
      preferredModelId?: string;
      /**
       * ★ 内容驱动的退出闸：finalize 时框架先用 outputSchema 校验，
       * 失败则注入 critique reminder 让 LLM 直接补缺（continue loop）。
       * 通过才真正退出。Spec 通过 agent-runner 透传。
       */
      outputSchemaValidator?: (
        output: unknown,
      ) => { ok: true } | { ok: false; issues: string };
      /**
       * 业务级 sanity check（可选，比 schema 更严的语义校验，如 source 必须含 http、
       * findings 数量下限等）。返回非空 issues 字符串就 reject。
       */
      validateBusinessRules?: (output: unknown) => string | null | undefined;
      /**
       * ★ 2026-05-13: human-readable JSON skeleton of the outputSchema,
       * generated via describeOutputSchemaForLlm() at agent-factory layer.
       * Injected into the finalize-rejection critique so local / quantized
       * reasoning models have a concrete target shape to copy. The system
       * prompt already shows the schema once; repeating it at rejection
       * time meaningfully improves Nemotron-Reasoning convergence (its
       * post-<think> output mechanism often "forgets" the exact field set).
       */
      outputSchemaDescription?: string;
      /**
       * #35 — Strict JSON schema for the business-agent finalize output payload
       * (e.g. ResearcherAgent findings/summary shape). When set, the loop
       * switches to a tighter decision schema on final iterations
       * (approachingLimit=true), embedding this schema under action.output so
       * strict providers enforce the payload shape at the provider level.
       *
       * Only used on the non-FC branch (native function-calling already has
       * explicit tool schemas). The permissive REACT_LOOP_DECISION_JSON_SCHEMA
       * is used for all other iterations so normal tool-call turns are not
       * over-constrained.
       */
      finalizeOutputJsonSchema?: Record<string, unknown>;
      /**
       * P1a/P1b (2026-05-25) — delimited finalize transport hints.
       *
       * Names of finalize-output fields that hold LONG free-text (e.g. ["body"]
       * / ["summary"]) and an optional array field to emit as NDJSON (e.g.
       * "findings"). When `ENABLE_DELIMITED_FINALIZE=true` AND these are set, the
       * loop instructs the model to emit those fields OUTSIDE the JSON envelope
       * (delimited blocks / one-object-per-line) so unescaped quotes / long prose
       * cannot break the whole finalize. Best-effort models (DeepSeek json_object
       * etc.) benefit most; the env gate keeps it opt-in until validated.
       * Declared by the agent spec; threaded via agent-factory / harnessed-agent.
       */
      finalizeProseFields?: string[];
      finalizeNdjsonArrayField?: string;
      /**
       * Model-level failover provider (optional).
       *
       * Mirrors LlmExecutor.modelFailoverProvider: when reason() throws a
       * provider-level error (5xx / model-not-found / timeout / AllKeysFailed /
       * rate-limit) and isModelLevelFailoverError returns true, the loop calls
       * this callback instead of terminating immediately.  The callback receives
       * the set of modelIds that have already failed so it can exclude them and
       * return a different model.  Returns null/undefined when no further
       * candidates are available (in which case the loop falls through to its
       * existing error/terminated path).
       *
       * BYOK path: caller supplies a closure over AiModelConfigService that
       * queries the user's same-modelType UserModelConfig rows, excluding
       * already-failed models.
       * Admin/cron path: caller supplies a closure over ModelElectionService.
       */
      modelFailoverProvider?: (
        excludeModelIds: ReadonlyArray<string>,
        excludeProviders?: ReadonlyArray<string>,
      ) => Promise<string | null | undefined>;
    },
  ): AsyncIterable<IAgentEvent> {
    const agentId = options?.agentId ?? "unknown-agent";
    const allowedTools = options?.allowedTools;
    const forbiddenTools = options?.forbiddenTools;
    const budget = options?.budget;
    const specTaskProfile = options?.taskProfile;
    const outputSchemaValidator = options?.outputSchemaValidator;
    const validateBusinessRules = options?.validateBusinessRules;
    const outputSchemaDescription = options?.outputSchemaDescription;
    const finalizeOutputJsonSchema = options?.finalizeOutputJsonSchema;
    // P1a/P1b: delimited finalize transport shape (env-gated, opt-in).
    const delimitedFinalizeShape: DelimitedFinalizeShape | undefined =
      process.env.ENABLE_DELIMITED_FINALIZE === "true" &&
      ((options?.finalizeProseFields?.length ?? 0) > 0 ||
        !!options?.finalizeNdjsonArrayField)
        ? {
            proseFields: options?.finalizeProseFields,
            ndjsonArrayField: options?.finalizeNdjsonArrayField,
          }
        : undefined;
    const modelFailoverProvider = options?.modelFailoverProvider;
    // Model-level failover state: tracks models that failed with a
    // provider-level error so they can be excluded from re-election.
    const failedModelIds: string[] = [];
    // Providers whose key/credits failed — once a provider fails (out of credits
    // / no key), ALL its models are excluded so failover jumps to a DIFFERENT
    // provider instead of burning the cap on sibling dead-provider models.
    const failedProviders: string[] = [];
    // When failover succeeds, the elected model is kept here so the next
    // reason() call uses it instead of re-computing from budget tier / BYOK.
    let failoverModelId: string | undefined;
    let currentEnvelope = envelope;
    let iteration = 0;
    let budgetWarned = false;
    /**
     * ★ 防死循环：LLM 反复 finalize 但 schema 总不通过的次数。
     * ≥ MAX_FINALIZE_REJECTS 时强制退出，避免 LLM "我又改了" 死循环。
     */
    let finalizeRejectCount = 0;
    // ★ 2026-05-13 (root-fix): threshold reads from env. Frontier models
    // converge in 1-2 finalize attempts; production default stays at 3.
    // Local reasoning models (Nemotron / DeepSeek-R1) sometimes need 5-10
    // attempts to converge on the exact schema shape — REACT_MAX_FINALIZE_REJECTS
    // lets ops widen the budget. Hardcoded 3 was the same class of bug as
    // min-findings — defined in PlaygroundRuntimeConfig but never wired here.
    const MAX_FINALIZE_REJECTS = parsePositiveIntEnv(
      process.env.REACT_MAX_FINALIZE_REJECTS,
      3,
    );
    // ★ 工具前置闸（requireToolBeforeFinalize）计数器，逻辑见 tool-gate.util.ts。
    let successfulToolCalls = 0;
    let toolGateNudges = 0;
    /**
     * 连续空 LLM 响应计数器 —— 检测 "model 不存在 / API 拒绝 / 输出被过滤" 场景：
     * LLM 每次返回 completion="" + 立即 finalize 空结果。连续 2 次后 abort。
     */
    let consecutiveEmptyLLM = 0;
    let lastModelId: string | undefined;

    // ★ 2026-05-22 P0：可恢复错误（rate-limit/429）的有界退避重试。
    //   只对 recoveryHint.action==="retry" 生效；连续重试有上限（断路器，
    //   对齐 Claude Code 反向洞察 #5 的 MAX_CONSECUTIVE_FAILURES=3），且每次
    //   reason() 成功即清零（只数"连续"失败）。retry 走 continue 不触发 stop
    //   hook，叠加 maxIterations 双重夹逼，杜绝反向洞察 #4 的 retry 死循环。
    let consecutiveRecoverableRetries = 0;
    const MAX_RECOVERABLE_RETRIES = parsePositiveIntEnv(
      process.env.REACT_MAX_RECOVERABLE_RETRIES,
      3,
    );
    const RECOVERABLE_RETRY_BASE_MS = 1000;
    const RECOVERABLE_RETRY_CAP_MS = 10_000;
    // ★ 2026-05-22：provider cooldown 类错误按"实际剩余 cooldown 时长"退避等待，
    //   而非固定 retryAfterMs（否则 2s 退避撑不过 30s cooldown，重试必然再撞）。
    //   超过此上限的 cooldown（如多 key 的 5min）不在循环内死等，直接走终态。
    const COOLDOWN_MAX_WAIT_MS = 30_000;
    const COOLDOWN_RETRY_JITTER_MS = 250;

    // ─── Phase P0-2: 多重出口闸 ─────────────────────────────────
    /** Wall-time 监控（mission-pipeline-exit-policy.md D9）—— 默认 180s/stage */
    const wallTimeStart = Date.now();
    // ★ 默认 300s（5 min）—— 研究类 agent 需多次 tool_call（每次 web-search/scrape 5-30s），
    //   180s 在 quick+low 档下经常擦边。spec 可显式覆盖 maxWallTimeMs。
    const wallTimeLimitMs = criteria.maxWallTimeMs ?? 300_000;
    /** 同 toolId 连续失败计数（mission-pipeline-tool-failure-circuit.md D7=3）*/
    const TOOL_CIRCUIT_THRESHOLD = 3;
    const toolFailureCounters = new Map<string, number>();

    /**
     * ★ Phase P1 fix (2026-04-29)：记录上一轮 action kind 给 iteration_progress 事件
     * 用，让前端 UI 可视化"researcher 正在第 12/15 轮，还在 search"。
     */
    let lastActionKind: string | undefined;
    /**
     * ★ Claude Code P0-2 借鉴：记录本轮 reason() 的 rawContent + parseError 状态，
     * 供终止判定块检查是否是 parseDecision fallback 造成的假 finalize。
     * 参考 query.ts:553-557："stop_reason === 'tool_use' is unreliable"。
     */
    let lastIterRawContent = "";
    let lastIterHadParseError = false;

    // ─── Anthropic P0-3 fix (2026-05-05): SessionStart / UserPromptSubmit fire ───
    //   Hook 类型早就定义但全库 0 dispatch site，导致 SDK 上 hook 注册者收不到事件。
    //   会话级 hook 在每次 ReAct.run() 入口 fire 一次 SessionStart + UserPromptSubmit。
    //   Stop 在 try/finally 出口 fire（覆盖所有 termination 路径）。
    const sessionId = `${agentId}-${Date.now()}`;
    const sessionUserId = currentEnvelope.memory?.userId;
    let stopReason: "completed" | "error" | "budget" | "cancelled" =
      "completed";
    /** P0-6: true = 因 provider API error 退出（Stop hook 中 skipOnApiError=true 的 binding 会被跳过） */
    let stopCausedByApiError = false;
    try {
      await this.hookRegistry
        .dispatch(
          "SessionStart",
          { sessionId, userId: sessionUserId },
          { agentId, envelope: currentEnvelope },
        )
        .catch(() => undefined);
      // UserPromptSubmit：把 envelope 里 user-role 最后一条消息当 prompt
      const userPrompt = this.extractLatestUserPrompt(currentEnvelope);
      if (userPrompt) {
        const userPromptResult = await this.hookRegistry
          .dispatch(
            "UserPromptSubmit",
            { prompt: userPrompt, envelope: currentEnvelope },
            { agentId, envelope: currentEnvelope },
          )
          .catch(() => undefined);
        if (userPromptResult?.block) {
          stopReason = "cancelled";
          yield this.makeEvent(agentId, "terminated", {
            reason: "cancelled",
            error: `user-prompt-blocked: ${userPromptResult.reason ?? "policy"}`,
          });
          return;
        }
      }

      while (iteration < criteria.maxIterations) {
        iteration += 1;

        // 0a. signal check
        if (options?.signal?.aborted) {
          stopReason = "cancelled";
          yield this.makeEvent(agentId, "terminated", { reason: "cancelled" });
          return;
        }

        // ─── Phase P1 fix (2026-04-29 mission 8c7b4358)：iteration_progress emit ───
        // 让上层（mission 事件流 / 前端 UI）每轮都能感知 ReAct 进度，避免 ReAct 长时间
        // 内部 search 时外部看起来像死掉。approachingLimit=true 时同时在 envelope 里
        // 注入 system reminder 强力提示 LLM finalize（见下方 0d）。
        const approachingLimit =
          criteria.maxIterations - iteration <= 2 && criteria.maxIterations > 3;
        yield this.makeEvent(agentId, "iteration_progress", {
          iteration,
          maxIterations: criteria.maxIterations,
          progress:
            criteria.maxIterations > 0 ? iteration / criteria.maxIterations : 0,
          approachingLimit,
          lastActionKind,
        });

        // B (2026-05-05): AGENT_STEP_BEFORE — plugin 收到每轮 step 通知（fire-and-forget）
        if (this.pluginHookBus) {
          const stepStartMs = Date.now();
          void this.pluginHookBus
            .fire(
              "harness.agent.step.before",
              {
                agentId,
                iteration,
                maxIterations: criteria.maxIterations,
                envelope: currentEnvelope,
              },
              async () => undefined,
            )
            .catch(() => undefined);
          // 用 setImmediate 在本轮结束后 fire AFTER（不阻塞 LLM 调用）
          setImmediate(() => {
            this.pluginHookBus
              ?.fire(
                "harness.agent.step.after",
                {
                  agentId,
                  iteration,
                  actionKind: lastActionKind,
                  latencyMs: Date.now() - stepStartMs,
                },
                async () => undefined,
              )
              .catch(() => undefined);
          });
        }

        // 0d. ★ Phase P1 fix：逼近 maxIterations 时强力 nudge LLM finalize
        //   原 case (mission 8c7b4358)：researcher#0 在 retry 阶段跑 60+ ReAct 拍
        //   始终 parallel_tool_call 不 finalize。原因：leader critique 太刚性 + LLM
        //   没拿到"剩余轮数"信号。这里在 envelope 里临时注入 reminder，让 LLM
        //   在剩 ≤ 2 轮时**必须**选 finalize。
        if (approachingLimit && currentEnvelope instanceof ContextEnvelope) {
          const remaining = criteria.maxIterations - iteration + 1;
          const nudge =
            `[ITERATION BUDGET WARNING] You have ${remaining} iteration(s) left out of ${criteria.maxIterations}. ` +
            `On THIS turn, you MUST emit { "kind": "finalize", "output": {...} } using whatever tool results you ` +
            `already have. Do NOT start a new tool_call or parallel_tool_call. ` +
            `If your output is incomplete, finalize anyway and note the gap in the summary field — ` +
            `the framework will accept partial results rather than letting you exhaust the budget.`;
          currentEnvelope = currentEnvelope.append([
            {
              role: "user",
              content: nudge,
              timestamp: Date.now(),
            },
          ]).envelope;
        }

        // 0a'. wall-time check（exit-policy.md ExitReason='wall_time_exceeded'）
        if (wallTimeLimitMs && Date.now() - wallTimeStart >= wallTimeLimitMs) {
          yield this.makeEvent(agentId, "error", {
            message: `ReActLoop wall-time exceeded (${Date.now() - wallTimeStart}ms >= ${wallTimeLimitMs}ms)`,
            recoverable: false,
            failureCode: "RUNNER_WALL_TIME_EXCEEDED",
            diagnostic: {
              elapsedMs: Date.now() - wallTimeStart,
              wallTimeLimitMs,
              iteration,
              modelId: lastModelId,
            },
          });
          yield this.makeEvent(agentId, "output", {
            output: this.extractLastAssistantMessage(currentEnvelope) ?? "",
          });
          stopReason = "budget";
          yield this.makeEvent(agentId, "terminated", { reason: "budget" });
          return;
        }

        // 0b. budget exhausted check (v2)
        if (budget?.exhausted()) {
          // PR-J: 在 abort 前问 RuntimeEnvironment "能不能降级或重试"
          const hint = await currentEnvelope.runtimeEnv
            ?.suggestFallback({
              reason: "no_credit",
            })
            .catch(() => null);

          yield this.makeEvent(agentId, "budget_warning", {
            tokensUsed: budget.snapshot().tokensUsed,
            costUsd: budget.snapshot().costUsd,
            severity: "exhausted",
            fallbackHint: hint,
          });

          // hint=retry → 等待后继续（建议修 #6: 0ms retry 也合法，用 != null 而非 truthy）
          if (hint?.action === "retry" && hint.retryAfterMs != null) {
            await new Promise((r) =>
              setTimeout(r, Math.min(hint.retryAfterMs!, 10_000)),
            );
            continue;
          }
          // TODO 建议修 #7: hint=downgrade 当前未真正承接 —— 下游 tier 选择只看
          // budget.currentTier，而 budget 已 exhausted 不会改变。需要：
          //   1) 用 hint.fallbackModelId 强制覆盖下一轮 reason() 的 modelOverride
          //   2) BudgetAccountant 提供 reset 或 extend 接口
          // 当前简单策略：downgrade 等同 abort（保守，不假装能恢复）
          // ★ emit 结构化 error event：trace 看到 LOOP_BUDGET_EXHAUSTED 而不是
          // 只有终态 reason="budget"，便于跨层因果链统计。
          yield this.makeEvent(agentId, "error", {
            message: `ReActLoop budget exhausted (${budget.snapshot().tokensUsed} tokens used)`,
            recoverable:
              hint?.action === "retry" || hint?.action === "downgrade",
            failureCode: "LOOP_BUDGET_EXHAUSTED",
            diagnostic: {
              tokensUsed: budget.snapshot().tokensUsed,
              costUsd: budget.snapshot().costUsd,
              currentTier: budget.snapshot().currentTier,
              iteration,
            },
            recoveryHint: hint
              ? {
                  action:
                    hint.action === "downgrade"
                      ? "switch_model"
                      : hint.action === "notify_user"
                        ? "abort"
                        : hint.action,
                  reason: hint.reason,
                  fallbackModelId: hint.fallbackModelId,
                  retryAfterMs: hint.retryAfterMs,
                }
              : undefined,
          });
          yield this.makeEvent(agentId, "output", {
            output: this.extractLastAssistantMessage(currentEnvelope) ?? "",
          });
          stopReason = "budget";
          yield this.makeEvent(agentId, "terminated", { reason: "budget" });
          return;
        }

        // 0c. context engineering
        if (this.contextManager) {
          const result =
            await this.contextManager.ensureBudget(currentEnvelope);
          if (result.compacted || result.pruned) {
            currentEnvelope = result.envelope;
          }
        }

        // 1. perceive
        const messages = this.buildMessages(currentEnvelope);

        // 2. reason — PR-I: 把 budget tier 转成具体 modelId 注入
        // PR-J: 选 model 后再问 runtimeEnv "能用吗"，不可用则按 fallbackTo 切换
        let decision: ParsedDecision;
        let usage: {
          promptTokens: number;
          completionTokens: number;
          /** null = 模型未在 ModelPricingRegistry 注册（DB 缺 costTier/价格），无法计算 */
          costUsd: number | null;
          cacheReadTokens: number;
          modelId?: string;
        };
        // Track the model we attempt this iteration so failover can exclude it
        // even when reason() throws before usage.modelId is available.
        let attemptedModelId: string | undefined;
        try {
          // 2026-05-12 BYOK fix: 有 userId 上下文时跳过 admin pricing tier 选型——
          // tier pick 是 admin BudgetAccountant 的 cost downgrade 机制，预设池 = 管
          // 理员 ai_models（如 cheap tier 首位常被 seed 成 deepseek-chat）。BYOK
          // 用户付的是自己 provider 的钱，admin tier 完全不相干。一旦把 tierModelId
          // 透给 chat() 的 model 参数，ChatService Path A (ai-chat.service.ts:1631)
          // 就跳过 findUserDefaultByType，直接按 admin model.provider 解 key →
          // resolveKey(userId, "deepseek") → NoAvailableKeyError → ReAct iter=1
          // PROVIDER_API_ERROR "No API Key available for provider deepseek"（哪怕
          // 用户其实选的是 grok）。
          //
          // 修法：BYOK 路径下 tierModelId=null，让 chat() 收到 model=undefined +
          // modelType=CHAT + userId → 走 Path A 的 findUserDefaultByType 命中用户
          // UserModelConfig 的 isDefault。无 userId 的 cron / 系统任务仍走 pricing
          // tier（admin downgrade 行为不变）。
          //
          // options.preferredModelId 显式压制本逻辑（caller 已做 election，应尊重）。
          const byokUserId = currentEnvelope.memory.userId;
          let tierModelId =
            // Model-level failover: if a previous round failed and we elected
            // a replacement model, use it instead of the original selection.
            failoverModelId ??
            options?.preferredModelId ??
            (byokUserId
              ? null
              : budget && this.pricingRegistry
                ? this.pricingRegistry.pickModelForTier(
                    budget.snapshot().currentTier,
                  )
                : null);
          // PR-J: 环境感知 model 可用性
          if (tierModelId && currentEnvelope.runtimeEnv) {
            const avail = await currentEnvelope.runtimeEnv
              .getModelAvailability(tierModelId)
              .catch(() => null);
            if (avail && !avail.available) {
              const fallback = avail.fallbackTo?.[0];
              if (fallback) {
                this.logger.log(
                  `[${agentId}] model=${tierModelId} unavailable (${avail.unavailableReason}), falling back to ${fallback}`,
                );
                tierModelId = fallback;
              }
            }
          }
          // ★ 全覆盖审计修 (2026-05-06): LLM call 发起前再检查一次 wall-time，
          //   防止 context-engineering / model-availability 等前置逻辑消耗大量时间
          //   后仍进入高延迟 LLM call（P1 修复）。
          if (
            wallTimeLimitMs &&
            Date.now() - wallTimeStart >= wallTimeLimitMs
          ) {
            yield this.makeEvent(agentId, "error", {
              message: `ReActLoop wall-time exceeded before reason() (${Date.now() - wallTimeStart}ms >= ${wallTimeLimitMs}ms)`,
              recoverable: false,
              failureCode: "RUNNER_WALL_TIME_EXCEEDED",
              diagnostic: {
                elapsedMs: Date.now() - wallTimeStart,
                wallTimeLimitMs,
                iteration,
                phase: "pre-reason",
                modelId: lastModelId,
              },
            });
            yield this.makeEvent(agentId, "output", {
              output: this.extractLastAssistantMessage(currentEnvelope) ?? "",
            });
            stopReason = "budget";
            // ★ 2026-05-13: terminated.reason 与 stopReason 对齐为 "budget"
            //   (与 L480/L543 其他 budget 退出路径一致)；具体 wall-time 细节
            //   已在上面 budget-exceeded 事件 diagnostic.phase="pre-reason"
            //   + wallTimeLimitMs 字段携带。
            yield this.makeEvent(agentId, "terminated", { reason: "budget" });
            return;
          }
          // PR-Q: 自动 prompt-cache 规划 —— 重复 prefix 享受 1/10 价
          const cachePrefix = this.cachePlanner?.plan(currentEnvelope) ?? null;
          // Track the model we are about to call so failover can exclude it even
          // when reason() throws before usage.modelId is available.
          attemptedModelId = tierModelId ?? undefined;
          // T2 (least-privilege tool scoping): filter the LLM-visible tool list
          // by the agent's allow/forbid policy BEFORE building FunctionDefinitions,
          // so the model never sees — and therefore cannot choose — a tool it is
          // not permitted to call. ToolInvoker still enforces at invocation time
          // as defense-in-depth (see executeAction), but pre-filtering avoids the
          // wasted reason() turn + fail-then-loop when the model picks a denied tool.
          const visibleToolIds = this.filterVisibleTools(
            currentEnvelope.tools,
            allowedTools,
            forbiddenTools,
          );
          const reasoned = await this.reason(
            messages,
            currentEnvelope.system,
            options?.signal,
            tierModelId ?? undefined,
            cachePrefix,
            // BYOK 关键：把 envelope.memory.userId 透给 chat()，让
            // findUserDefaultByType(userId, "chat") 命中用户自己的 BYOK 默认模型
            currentEnvelope.memory.userId,
            // Spec 声明的 TaskProfile（如 researcher='long' / leader='medium'）
            specTaskProfile,
            // PR-1 native-FC: envelope.tools 是上游 performToolRecall 召回的工具 id
            // 列表，传下去让 reason() 在 flag-on 时构造 FunctionDefinition[]。
            // T2: 已按 allow/forbid 策略前置过滤（见上方 visibleToolIds）。
            visibleToolIds,
            // #35: on final iterations switch to the strict finalize schema so
            // strict providers enforce the business payload shape.
            approachingLimit,
            finalizeOutputJsonSchema,
            delimitedFinalizeShape,
          );
          decision = reasoned.decision;
          usage = reasoned.usage;
          if (usage.modelId) lastModelId = usage.modelId;
          // reason() 成功返回 → 清零连续可恢复重试计数（只数"连续"失败）
          consecutiveRecoverableRetries = 0;
          // ★ Claude Code P0-2: 保存原始 content + parse 状态，供后段终止判定使用
          lastIterRawContent = reasoned.rawContent;
          lastIterHadParseError = !!reasoned.parseError;

          // ★ 诊断：解析层兜底抛错（正常情况 parseDecision 会 catch JSON.parse /
          // InvalidActionError 自己包装。如果走到这条说明 catch 之外的异常）
          if (reasoned.parseError) {
            // parseError.message 自带 "… Preview: <raw 前缀>"；下方已单独打印
            // rawContent，去掉内嵌 Preview 避免同一段内容被打印两遍（误判"重复"）。
            const reasonNoPreview =
              reasoned.parseError.message.split(" Preview:")[0];
            this.logger.error(
              `[${agentId}] iter=${iteration} parseDecision threw: ` +
                `${reasoned.parseError.name}: ${reasonNoPreview}; ` +
                `rawContent=${reasoned.rawContent.slice(0, 500)}`,
            );
          }

          // 熔断：检测「LLM 立即 finalize 空结果 + thinking 也空」——
          //   (a) BYOK model id 不存在 / API 拒绝 → 返回最简 fallback JSON
          //   (b) reasoning model 内部 CoT 吃光 max_completion_tokens
          //   (c) response_format=json_object 强制下，model 憋出最简空 JSON 假装完成
          //
          // 防 false-positive：thinking 非空说明 LLM 在思考，可能合理 finalize；
          // 只在 thinking="" + output 空时判定为空响应。
          // T5 (2026-06-01)：第 1 次空响应即终止（不是"连续 2 次"）。失败已按子码
          //   分类——LOOP_EMPTY_RESPONSE_IMMEDIATE（API 拒绝/模型死）与
          //   PROVIDER_QUOTA_EXCEEDED 是确定性失败，同模型重试必然还空；reasoning
          //   CoT 撞墙交由下方 suggestFallback 切非 reasoning 模型恢复（换模型才是正确
          //   修法，不是同模型重试）。故 consecutiveEmptyLLM 仅进诊断 payload，不作终止
          //   阈值。若日后遥测出现 reasoning-exhaustion 误杀，再针对该单一子类加 nudge-retry。
          let isEmptyResponse = false;
          if (
            decision.action.kind === "finalize" &&
            decision.thinking.trim() === ""
          ) {
            const out = decision.action.output;
            isEmptyResponse =
              !out ||
              (typeof out === "string" && out.trim() === "") ||
              (typeof out === "object" && Object.keys(out).length === 0);
          }
          if (isEmptyResponse) {
            consecutiveEmptyLLM += 1;

            // ★ 诊断关键：把 LLM 实际吐回的 raw content 写到日志和 error payload，
            // 让上层 / DB / 前端都能看到根因证据，不再靠"应该是 (a)/(b)/(c)"猜。
            const rawSnippet = reasoned.rawContent.slice(0, 1000);

            // ★ 失败码分类（按 completion tokens + parseError 区分子类）
            const TINY_COMPLETION_THRESHOLD = 100;
            let failureCode: HarnessFailureCode;
            let fallbackReason:
              | "empty_response"
              | "reasoning_exhaustion"
              | "safety_refusal"
              | "parse_failure";
            if (usage.completionTokens < TINY_COMPLETION_THRESHOLD) {
              // completion≈0 → API 拒绝/model 死了
              failureCode = "LOOP_EMPTY_RESPONSE_IMMEDIATE";
              fallbackReason = "empty_response";
            } else if (reasoned.parseError) {
              // completion≫0 + parser 抛错 → 解析失败
              // InvalidActionError 自带 subCode 4 类细分，对齐 4 个 PARSE_* 码
              if (reasoned.parseError.name === "InvalidActionError") {
                const sub = (reasoned.parseError as { subCode?: string })
                  .subCode;
                failureCode =
                  sub === "unknown_kind"
                    ? "PARSE_UNKNOWN_ACTION_KIND"
                    : sub === "empty_parallel_calls" ||
                        sub === "empty_actions_array"
                      ? "PARSE_EMPTY_ACTIONS_ARRAY"
                      : "PARSE_MISSING_ACTION";
              } else {
                failureCode = "PARSE_MALFORMED_JSON";
              }
              fallbackReason = "parse_failure";
            } else {
              // completion≫0 且 parse 成功但 visible 空 → reasoning CoT 撞墙 / safety
              // 优先按 reasoning_exhaustion 处理，让 adapter 切到非 reasoning 模型
              failureCode = "LOOP_REASONING_COT_EXHAUSTION";
              fallbackReason = "reasoning_exhaustion";
            }

            this.logger.error(
              `[${agentId}] iter=${iteration} ${failureCode} — ` +
                `model=${lastModelId ?? "unknown"} ` +
                `completion=${usage.completionTokens}tk prompt=${usage.promptTokens}tk ` +
                `parseErr=${reasoned.parseError ? `${reasoned.parseError.name}:${reasoned.parseError.message}` : "none"} ` +
                `rawContent=${JSON.stringify(rawSnippet)}`,
            );

            // ★ 接通 model fallback：问 runtimeEnv 拿恢复建议
            const recoveryHint = await currentEnvelope.runtimeEnv
              ?.suggestFallback({
                failedModelId: lastModelId,
                reason: fallbackReason,
              })
              .catch(() => null);

            yield this.makeEvent(agentId, "error", {
              message:
                `LLM "${lastModelId ?? "unknown"}" finalize 空结果 [${failureCode}] ` +
                `(completion=${usage.completionTokens}tk, thinking="")。` +
                `证据：rawContent=${JSON.stringify(rawSnippet)}` +
                (reasoned.parseError
                  ? ` parseError=${reasoned.parseError.name}:${reasoned.parseError.message}`
                  : "") +
                (recoveryHint
                  ? `。恢复建议：${recoveryHint.action} (${recoveryHint.reason})`
                  : ""),
              recoverable:
                recoveryHint?.action === "retry" ||
                recoveryHint?.action === "downgrade",
              failureCode,
              diagnostic: {
                modelId: lastModelId,
                completionTokens: usage.completionTokens,
                promptTokens: usage.promptTokens,
                rawContent: rawSnippet,
                parseError: reasoned.parseError,
                consecutiveEmptyLLM,
                iteration,
              },
              recoveryHint: recoveryHint
                ? {
                    action:
                      recoveryHint.action === "downgrade"
                        ? "switch_model"
                        : recoveryHint.action === "notify_user"
                          ? "abort"
                          : recoveryHint.action,
                    reason: recoveryHint.reason,
                    fallbackModelId: recoveryHint.fallbackModelId,
                    retryAfterMs: recoveryHint.retryAfterMs,
                  }
                : undefined,
            });
            stopReason = "error"; // empty_llm_response 归类为 error 用于 Stop hook
            yield this.makeEvent(agentId, "terminated", {
              reason: "empty_llm_response",
            });
            return;
          } else {
            // 重置空响应计数（仅供诊断 payload；见上方 T5 说明，不作终止阈值）
            consecutiveEmptyLLM = 0;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const aborted = /aborted/i.test(message);
          // ★ provider cooldown 错误携带剩余时长（ProviderCooldownError.remainingMs），
          //   用于按实际 cooldown 退避等待。duck-type 读取，避免 ai-harness 反向依赖 platform。
          const cooldownRemainingMs =
            err &&
            typeof err === "object" &&
            "remainingMs" in err &&
            typeof (err as { remainingMs?: unknown }).remainingMs === "number"
              ? (err as { remainingMs: number }).remainingMs
              : undefined;

          // ★ 失败码归类：从异常消息推断 provider 错误类型
          let failureCode: HarnessFailureCode = "PROVIDER_API_ERROR";
          let fallbackReason:
            | "rate_limit"
            | "model_not_found"
            | "context_too_long"
            | "outage"
            | "byok_quota_exceeded" = "outage";
          // ★ 2026-05-01 (mission b791054e 真因)：quota/billing 错误必须独立编码 —
          //   OpenAI insufficient_quota 文案是"You exceeded your current quota,
          //   please check your plan and billing details" — 不含 "rate limit" / "429"，
          //   原本兜底成 PROVIDER_API_ERROR + "Agent 内部错误"，掩盖了"账户余额耗尽"
          //   这一关键真因。优先级最高（先于 rate_limit 判断）。
          if (
            /(insufficient[_\s-]?quota|exceeded[_\s\w]*quota|quota[_\s\w]*exceed|billing[_\s\w]*details|insufficient[_\s\w]*credit|insufficient[_\s\w]*balance|payment\s+required)/i.test(
              message,
            )
          ) {
            failureCode = "PROVIDER_QUOTA_EXCEEDED";
            // ★ BYOK 单源原则：不自动跨 provider 切换，让用户去续费或申请 admin
            //   批 KeyAssignment（也属 BYOK）。
            fallbackReason = "byok_quota_exceeded";
          } else if (/rate.?limit|429|too many requests/i.test(message)) {
            failureCode = "PROVIDER_RATE_LIMIT";
            fallbackReason = "rate_limit";
          } else if (
            // ★ 2026-05-22：provider cooldown 短路（ProviderCooldownError）是瞬态，
            //   归为 rate_limit 让 suggestFallback 返回 retry → 走有界退避重试。
            /cooldown|temporarily unavailable/i.test(message)
          ) {
            failureCode = "PROVIDER_RATE_LIMIT";
            fallbackReason = "rate_limit";
          } else if (
            // ★ 2026-05-01 (mission 9a3144fc 实证)：xAI grok 模型 ID 错误返回
            //   "The requested resource was not found"，不含 "model" / "invalid model"，
            //   原 regex 漏判。补 INVALID_MODEL / requested resource / docs\.x\.ai / openai 404 等。
            /model.*not.*found|invalid[_\s-]?model|model_not_found|requested\s+resource\s+(was\s+)?not\s+found|docs\.x\.ai|model.*does.*not.*exist|404\b/i.test(
              message,
            )
          ) {
            failureCode = "PROVIDER_BYOK_MODEL_NOT_FOUND";
            fallbackReason = "model_not_found";
          } else if (
            /context.*length|too long|maximum context/i.test(message)
          ) {
            failureCode = "PROVIDER_TRUNCATED";
            fallbackReason = "context_too_long";
          }

          // ★ 2026-05-12: QUOTA_EXCEEDED 必须先失效 snapshot 缓存，否则
          //   suggestFallback 拿到的还是"deepseek 健康"的旧快照，根本不知道
          //   它已经欠费 → findSiblingModel 不会切。
          if (
            !aborted &&
            failureCode === "PROVIDER_QUOTA_EXCEEDED" &&
            currentEnvelope.runtimeEnv?.invalidate
          ) {
            try {
              currentEnvelope.runtimeEnv.invalidate();
            } catch {
              // ignore
            }
          }

          const recoveryHint =
            !aborted && currentEnvelope.runtimeEnv
              ? await currentEnvelope.runtimeEnv
                  .suggestFallback({
                    failedModelId: lastModelId,
                    reason: fallbackReason,
                  })
                  .catch(() => null)
              : null;

          // 2026-05-13: log 必须反映真实失败码，aborted 时分类是 "UNKNOWN"，不要
          // 误写 "PROVIDER_API_ERROR"。曾让运维以为是 provider 故障，实际是 mission
          // 早就被 abortRegistry.abort 了（如 budget_exhausted 级联）。
          const loggedCode = aborted ? "CANCELLED" : failureCode;
          this.logger.error(
            `[${agentId}] iter=${iteration} ${loggedCode} — ${message}`,
          );

          // Model-level failover: on provider-API errors (5xx, model-not-found,
          // timeout, AllKeysFailed, rate-limit) try to elect a different model
          // instead of terminating immediately.  AbortError and budget/credit
          // exhaustion are NOT failover candidates (isModelLevelFailoverError
          // returns false for those).  Cap at MAX_MODEL_FAILOVERS distinct models.
          if (
            !aborted &&
            modelFailoverProvider &&
            isModelLevelFailoverError(err) &&
            failedModelIds.length < MAX_MODEL_FAILOVERS
          ) {
            // Use the model we actually attempted this iteration.
            // lastModelId is only updated after a successful reason() call, so on
            // the first failure it may still be undefined.
            const failedId = attemptedModelId ?? lastModelId ?? "";
            if (failedId && !failedModelIds.includes(failedId)) {
              failedModelIds.push(failedId);
            }
            // Extract the failed provider from the error so the whole provider
            // (out of credits / no key) is skipped, not just one model.
            const provMatch = /provider\s+"?([a-z0-9_-]+)"?/i.exec(message);
            if (provMatch?.[1] && !failedProviders.includes(provMatch[1])) {
              failedProviders.push(provMatch[1]);
            }
            try {
              const nextModelId = await modelFailoverProvider(
                failedModelIds,
                failedProviders,
              );
              if (nextModelId) {
                this.logger.warn(
                  `[${agentId}] iter=${iteration} model-failover: ` +
                    `${failedId || "(default)"} → ${nextModelId} ` +
                    `(failed=${failedModelIds.length}/${MAX_MODEL_FAILOVERS}, reason: ${message.slice(0, 120)})`,
                );
                failoverModelId = nextModelId;
                lastModelId = nextModelId;
                consecutiveRecoverableRetries = 0;
                // ★ Model switch is NOT a reasoning iteration — give the new
                //   model the agent's full iteration budget (decrement cancels
                //   the `iteration += 1` at the top of the loop). Bounded by the
                //   failover cap so it cannot loop forever.
                iteration -= 1;
                continue;
              }
            } catch (electionErr) {
              this.logger.warn(
                `[${agentId}] iter=${iteration} model-failover election threw: ` +
                  `${electionErr instanceof Error ? electionErr.message : String(electionErr)}`,
              );
            }
          }

          // ★ 2026-05-22 P0：可恢复错误（rate-limit/429）有界退避重试，而非直接终止。
          //   单模型/单 key 部署下 429 几乎必现，以前这里直接 return 终态把整段 mission
          //   判废。仅 action==="retry" 生效（quota→notify_user、model_not_found、
          //   context_too_long 等仍走下面的终态）；连续重试上限 + 退避上限 + 仍有迭代
          //   预算才重试；continue 不触发 finally 的 stop hook（区别于终态 return）。
          if (
            !aborted &&
            recoveryHint?.action === "retry" &&
            consecutiveRecoverableRetries < MAX_RECOVERABLE_RETRIES &&
            iteration < criteria.maxIterations &&
            // cooldown 超过上限（如多 key 5min）不在循环内死等 → 走终态
            (cooldownRemainingMs == null ||
              cooldownRemainingMs <= COOLDOWN_MAX_WAIT_MS)
          ) {
            consecutiveRecoverableRetries += 1;
            // cooldown 类：按实际剩余时长 + 抖动退避（撑过 cooldown 再重试）；
            // 其余 rate-limit 类：用 hint.retryAfterMs 或指数退避。
            const backoffMs =
              cooldownRemainingMs != null
                ? Math.min(
                    cooldownRemainingMs + COOLDOWN_RETRY_JITTER_MS,
                    COOLDOWN_MAX_WAIT_MS,
                  )
                : Math.min(
                    recoveryHint.retryAfterMs ??
                      RECOVERABLE_RETRY_BASE_MS *
                        2 ** (consecutiveRecoverableRetries - 1),
                    RECOVERABLE_RETRY_CAP_MS,
                  );
            this.logger.warn(
              `[${agentId}] iter=${iteration} ${failureCode} — recoverable, ` +
                `retry ${consecutiveRecoverableRetries}/${MAX_RECOVERABLE_RETRIES} after ${backoffMs}ms`,
            );
            yield this.makeEvent(agentId, "error", {
              message,
              recoverable: true,
              failureCode,
              diagnostic: {
                modelId: lastModelId,
                iteration,
                retryAttempt: consecutiveRecoverableRetries,
                backoffMs,
              },
            });
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }

          yield this.makeEvent(agentId, "error", {
            message,
            recoverable:
              !aborted &&
              (recoveryHint?.action === "retry" ||
                recoveryHint?.action === "downgrade"),
            failureCode: aborted ? "UNKNOWN" : failureCode,
            diagnostic: {
              modelId: lastModelId,
              iteration,
              errorMessage: message,
              errorStack: err instanceof Error ? err.stack : undefined,
            },
            recoveryHint: recoveryHint
              ? {
                  action:
                    recoveryHint.action === "downgrade"
                      ? "switch_model"
                      : recoveryHint.action === "notify_user"
                        ? "abort"
                        : recoveryHint.action,
                  reason: recoveryHint.reason,
                  fallbackModelId: recoveryHint.fallbackModelId,
                  retryAfterMs: recoveryHint.retryAfterMs,
                  // notify_user 的提示文案要透传给上层 UI（BYOK quota 之类）
                  userMessage: recoveryHint.userMessage,
                }
              : undefined,
          });
          stopReason = "error"; // ternary fallback
          // P0-6: 标记 API error 路径，让 finally 中 dispatchStop 跳过 skipOnApiError=true 的 hook
          if (!aborted) stopCausedByApiError = true;
          yield this.makeEvent(agentId, "terminated", {
            reason: aborted ? "cancelled" : "error",
          });
          return;
        }

        // v2: account budget for the LLM call
        // PR-I 必修 #4: cacheReadTokens 也要计入 tokensUsed（虽然便宜但占 context window）
        if (budget) {
          budget.accountLLM(
            usage.promptTokens,
            usage.completionTokens,
            usage.costUsd,
            usage.cacheReadTokens,
          );
          if (!budgetWarned && budget.shouldDowngrade()) {
            budgetWarned = true;
            // try to downgrade tier silently for the next iteration
            if (budget.canDowngrade()) {
              const newTier = budget.downgrade();
              this.logger.log(
                `[${agentId}] budget pressure → downgraded to tier=${newTier}`,
              );
            }
            yield this.makeEvent(agentId, "budget_warning", {
              tokensUsed: budget.snapshot().tokensUsed,
              costUsd: budget.snapshot().costUsd,
              severity: "pressure",
              tier: budget.snapshot().currentTier,
            });
          }
        }

        yield this.makeEvent(agentId, "thinking", {
          text: decision.thinking,
          // 真实 completion token 数（旧值用 thinking 字符串长度，推理模型下偏差 4-10x）
          tokenCount: usage.completionTokens,
          // 暴露 LLM 调用的真实用量给上游（DX runner / 业务 orchestrator 用来算成本）
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          cacheReadTokens: usage.cacheReadTokens,
          costUsd: usage.costUsd,
          // 真实模型 id（供 UI 展示「这个 agent 在用什么模型」）
          modelId: usage.modelId,
        });
        yield this.makeEvent(agentId, "action_planned", decision.action);
        // 记录 action kind 给下一轮 iteration_progress 事件用
        lastActionKind = decision.action.kind;

        // 3. act
        const actionResult = await this.executeAction(
          decision.action,
          currentEnvelope,
          agentId,
          options?.signal,
          allowedTools,
          forbiddenTools,
          options?.parent,
          options?.spawner,
        );
        // 把 LLM reasoning tokens 累加到本轮 action 的 tokensUsed —— 让上游 extractTokenSpend
        // 拿到完整用量；action 自身 tokensUsed（如 tool 运行）也保留累计
        const enrichedActionResult = {
          ...actionResult,
          tokensUsed:
            (actionResult.tokensUsed ?? 0) +
            usage.promptTokens +
            usage.completionTokens,
        };
        yield this.makeEvent(agentId, "action_executed", enrichedActionResult);

        // ─── Phase P0-2: failed_tool 熔断（D7=3）──
        // tool_call / parallel_tool_call 中任一同 toolId 连续失败 N 次 → exit
        const toolIdsTouched: string[] = [];
        if (decision.action.kind === "tool_call") {
          toolIdsTouched.push(decision.action.toolId);
        } else if (decision.action.kind === "parallel_tool_call") {
          for (const c of decision.action.calls) {
            toolIdsTouched.push(c.toolId);
          }
        }
        if (toolIdsTouched.length > 0) {
          const hasError = !!actionResult.error;
          for (const tid of toolIdsTouched) {
            if (hasError) {
              const c = (toolFailureCounters.get(tid) ?? 0) + 1;
              toolFailureCounters.set(tid, c);
              if (c >= TOOL_CIRCUIT_THRESHOLD) {
                yield this.makeEvent(agentId, "error", {
                  message: `Tool '${tid}' failed ${c} times consecutively (circuit broken)`,
                  recoverable: false,
                  failureCode: "TOOL_RUNTIME_ERROR",
                  diagnostic: {
                    toolId: tid,
                    consecutiveFailures: c,
                    iteration,
                    lastError: actionResult.error?.message,
                  },
                  recoveryHint: {
                    action: "switch_model",
                    reason:
                      "Tool service unavailable; try alternative model or skip this tool",
                  },
                });
                yield this.makeEvent(agentId, "output", {
                  output:
                    this.extractLastAssistantMessage(currentEnvelope) ?? "",
                });
                stopReason = "error";
                yield this.makeEvent(agentId, "terminated", {
                  reason: "error",
                });
                return;
              }
            } else {
              toolFailureCounters.set(tid, 0);
              // ★ 工具前置闸：累计成功的真实工具调用（toolIdsTouched 不含 finalize）
              successfulToolCalls += 1;
            }
          }
        }

        // 4. reflect
        currentEnvelope = this.updateEnvelope(
          currentEnvelope,
          decision,
          actionResult,
        );

        // ★ Claude Code P0-2 借鉴：hasUnexecutedToolUse 检查
        //
        // 场景：LLM 本意是 tool_call，但 parseDecision 因 JSON 截断 / 围栏嵌套
        // 失败，catch 分支把 rawContent 塞进 finalize.output → 假终止。
        // 同时检查 envelope messages 里是否有原生 tool_use blocks 尚未执行。
        //
        // 对应 Claude Code query.ts:553-557:
        //   "stop_reason === 'tool_use' is unreliable — check content for
        //    unexecuted tool_use blocks instead."
        //
        // 只在 finalize 路径触发（tool_call / parallel_tool_call 已在下方 continue）。
        if (
          decision.action.kind === "finalize" &&
          !criteria.terminateOn?.includes("finalize")
        ) {
          // 1) ReAct JSON 协议：parseError + rawContent 含工具调用意图
          const hasRawToolIntent = rawContentHasUnexecutedToolIntent(
            lastIterRawContent,
            lastIterHadParseError,
          );
          // 2) 原生 tool_use blocks（function-calling adapter 路径）
          const hasNativeToolUse = envelopeHasUnexecutedToolUse(
            currentEnvelope.messages,
          );

          if (hasRawToolIntent || hasNativeToolUse) {
            // 假终止 → 注入纠错提示，继续 loop
            this.logger.warn(
              `[${agentId}] iter=${iteration} ★ P0-2 hasUnexecutedToolUse detected — ` +
                `parseError=${lastIterHadParseError} rawToolIntent=${hasRawToolIntent} ` +
                `nativeToolUse=${hasNativeToolUse}. Injecting retry nudge instead of finalizing.`,
            );
            if (currentEnvelope instanceof ContextEnvelope) {
              currentEnvelope = currentEnvelope.append([
                {
                  role: "user",
                  content:
                    `[P0-2 TOOL_USE_DETECTED] Your previous response contained a tool call ` +
                    `that was not executed because the JSON could not be parsed. ` +
                    `Please re-emit the tool call as valid JSON using the Decision Protocol format: ` +
                    `{"thinking":"...","action":{"kind":"tool_call","toolId":"...","input":{...}}}`,
                  timestamp: Date.now(),
                },
              ]).envelope;
            }
            lastIterRawContent = "";
            lastIterHadParseError = false;
            lastActionKind = undefined;
            continue;
          }
        }

        // termination
        if (
          decision.action.kind === "finalize" ||
          (criteria.terminateOn?.includes(decision.action.kind) ?? false)
        ) {
          // ★ 工具前置闸（requireToolBeforeFinalize）—— 详见 tool-gate.util.ts。
          if (
            decision.action.kind === "finalize" &&
            shouldBlockFinalizeForToolGate({
              requireToolBeforeFinalize: criteria.requireToolBeforeFinalize,
              successfulToolCalls,
              toolGateNudges,
              iteration,
              maxIterations: criteria.maxIterations,
            })
          ) {
            toolGateNudges += 1;
            this.logger.warn(
              `[${agentId}] iter=${iteration} ★ tool-gate: finalize blocked — ` +
                `0 successful tool calls (nudge ${toolGateNudges}/${MAX_TOOL_GATE_NUDGES})`,
            );
            yield this.makeEvent(agentId, "validation_failed", {
              rejectCount: toolGateNudges,
              maxRejects: MAX_TOOL_GATE_NUDGES,
              issues:
                "tool-gate: must call at least one research tool before finalize",
            });
            if (currentEnvelope instanceof ContextEnvelope) {
              currentEnvelope = currentEnvelope.append([
                {
                  role: "user",
                  content: buildToolGateCritique(
                    toolGateNudges,
                    MAX_TOOL_GATE_NUDGES,
                  ),
                  timestamp: Date.now(),
                },
              ]).envelope;
            }
            lastActionKind = undefined;
            continue;
          }

          const output =
            decision.action.kind === "finalize"
              ? decision.action.output
              : actionResult.output;

          // ★ 2026-05-29 (screenshot_22 根因)：模型在 finalize 槽位塞了 tool-call 信封
          //   （{kind:"tool_call", calls:[...]}）——它没数据、还想搜，而非 finalize 字段缺失。
          //   普通 schema critique（"dimension/findings/summary Required"）会让它继续吐
          //   tool_call 死循环：3 次空转烧满 30K budget，最后强吐 tool_call 垃圾当 output。
          //   下面给一条专门硬提醒，并在 force-accept 时吐空串而非 tool_call 垃圾。
          const finalizeIsToolCallEnvelope =
            decision.action.kind === "finalize" &&
            this.isToolCallEnvelopeOutput(output);

          // ★ 内容驱动的退出闸：finalize 时框架先校验 outputSchema +
          //   validateBusinessRules，不达标就注入精准 critique reminder 让 LLM
          //   "原地补缺"（不重启 ReActLoop，复用已有 envelope 的工具结果）。
          //   这是替代"机械限轮次"的退出机制：让"内容是否符合要求"成为唯一退出
          //   标准，避免 LLM 反复瞎搜或瞎 finalize。
          const issuesParts: string[] = [];
          if (outputSchemaValidator) {
            const schemaResult = outputSchemaValidator(output);
            if (!schemaResult.ok)
              issuesParts.push(`Schema: ${schemaResult.issues}`);
          }
          if (validateBusinessRules) {
            const businessIssue = validateBusinessRules(output);
            if (businessIssue) issuesParts.push(`Business: ${businessIssue}`);
          }
          // tool-call 信封必然 schema 不达标；确保至少有一条明确 issue（不依赖 validator）
          if (finalizeIsToolCallEnvelope && issuesParts.length === 0) {
            issuesParts.push(
              "Schema: emitted a tool_call in the finalize slot (no findings produced)",
            );
          }
          if (issuesParts.length > 0) {
            finalizeRejectCount += 1;
            // ★ Phase P0-10: emit validation_failed 事件（baseline §1.3）
            yield this.makeEvent(agentId, "validation_failed", {
              rejectCount: finalizeRejectCount,
              maxRejects: MAX_FINALIZE_REJECTS,
              issues: issuesParts.join("; "),
              candidateOutput: output,
            });
            // 防死循环：连续 N 次 finalize 不达标 → 强制退出，不再让 LLM 改
            if (finalizeRejectCount >= MAX_FINALIZE_REJECTS) {
              this.logger.warn(
                `[${agentId}] finalize rejected ${finalizeRejectCount} times in a row, ` +
                  `accepting current candidate to avoid infinite loop. issues=${issuesParts.join("; ")}`,
              );
              // ★ Phase P0-2: 标记为 validation_rejected_max（exit-policy.md）
              yield this.makeEvent(agentId, "error", {
                message: `finalize 校验闸 reject 达上限 ${MAX_FINALIZE_REJECTS}，强制接受次优产物`,
                recoverable: false,
                failureCode: "RUNNER_OUTPUT_SCHEMA_MISMATCH",
                diagnostic: {
                  rejectCount: finalizeRejectCount,
                  lastIssues: issuesParts.join("; "),
                  toolCallInFinalizeSlot: finalizeIsToolCallEnvelope,
                },
              });
              // tool-call 信封不是合法产物 → 吐空串，避免下游把 {kind:tool_call} 当 findings
              yield this.makeEvent(agentId, "output", {
                output: finalizeIsToolCallEnvelope ? "" : (output ?? ""),
              });
              stopReason = "completed";
              yield this.makeEvent(agentId, "terminated", {
                reason: "completed",
              });
              return;
            }
            // 注入精准 critique reminder：告诉 LLM 缺什么，要它**直接补缺**而非重新搜。
            // ★ 2026-05-13: 当 outputSchemaDescription 可用时，把目标 JSON 形状
            //   原文贴入 critique。本地推理模型 (Nemotron / DeepSeek-R1) 在长
            //   <think> 之后经常"忘记"字段集，给它一个可直接 copy 的具体模板能
            //   把 finalize 收敛攻击成功率从 ~30% 提到 ~90%。
            const skeletonBlock = outputSchemaDescription
              ? `\n\n${outputSchemaDescription}\n` +
                `Emit your next finalize.output as JSON matching the shape above.`
              : "";
            const critique = finalizeIsToolCallEnvelope
              ? // 专门处理 tool-call-in-finalize：明确"别再吐 tool_call"，给出空结果出口
                `[FINALIZE REQUIRED ${finalizeRejectCount}/${MAX_FINALIZE_REJECTS}] You emitted a tool_call where the FINAL ANSWER is required. ` +
                `You are out of search budget — do NOT emit any tool_call. ` +
                `Produce finalize.output from the tool results already in this conversation. ` +
                `If you genuinely found no usable sources, emit a schema-valid result with an EMPTY findings array ([]) ` +
                `and a summary stating that no usable sources were found for this dimension.` +
                skeletonBlock
              : `[FINALIZE REJECTED ${finalizeRejectCount}/${MAX_FINALIZE_REJECTS}] Your finalize.output failed validation:\n` +
                issuesParts.map((p) => `  - ${p}`).join("\n") +
                `\n\nDO NOT rerun tools. Use the tool results already in this conversation to ` +
                `produce a corrected finalize that addresses the issues above. ` +
                `If the existing tool results genuinely don't have the needed information, ` +
                `you may emit ONE focused tool_call to fill the specific gap (do not search broadly).` +
                skeletonBlock;
            this.logger.log(
              `[${agentId}] finalize rejected (${finalizeRejectCount}/${MAX_FINALIZE_REJECTS}): ${issuesParts.join("; ").slice(0, 200)}`,
            );
            if (currentEnvelope instanceof ContextEnvelope) {
              currentEnvelope = currentEnvelope.append([
                {
                  role: "user",
                  content: critique,
                  timestamp: Date.now(),
                },
              ]).envelope;
            }
            // ★ 全覆盖审计修 (2026-05-06): critique inject 后重置 lastActionKind，
            //   防止上一轮 finalize 状态污染下一轮 LLM decision（P1 修复）。
            lastActionKind = undefined;
            // 不退出，继续 loop —— LLM 看到 critique 后下一轮直接补
            continue;
          }

          // 通过校验 → 真正退出
          yield this.makeEvent(agentId, "output", { output: output ?? "" });
          stopReason = "completed";
          yield this.makeEvent(agentId, "terminated", { reason: "completed" });
          return;
        }

        if (actionResult.error && !this.isRecoverable(actionResult.error)) {
          const errMsg = actionResult.error.message;
          // ★ 优先用 ToolInvoker 在 IActionResult 上贴的 failureCode；缺省再做文本推断
          const failureCode: HarnessFailureCode =
            (actionResult.failureCode as HarnessFailureCode | undefined) ??
            (/timeout|timed out/i.test(errMsg)
              ? "TOOL_TIMEOUT"
              : /not found|unknown tool/i.test(errMsg)
                ? "TOOL_NOT_FOUND"
                : /invalid input|validation/i.test(errMsg)
                  ? "TOOL_INPUT_VALIDATION_FAILED"
                  : "TOOL_RUNTIME_ERROR");

          const toolId =
            decision.action.kind === "tool_call"
              ? decision.action.toolId
              : undefined;

          this.logger.error(
            `[${agentId}] iter=${iteration} ${failureCode} ` +
              `tool=${toolId ?? "?"} err=${errMsg}`,
          );

          // ★ 接通 fallback：tool 失败可由 runtimeEnv 给恢复建议
          const recoveryHint = await currentEnvelope.runtimeEnv
            ?.suggestFallback({ reason: "tool_failure" })
            .catch(() => null);

          yield this.makeEvent(agentId, "error", {
            message: errMsg,
            recoverable: recoveryHint?.action === "retry",
            failureCode,
            diagnostic: {
              toolId,
              toolError: errMsg,
              iteration,
              // ★ 把 ToolInvoker 在 IActionResult.diagnostic 上贴的字段冒泡
              ...(actionResult.diagnostic ?? {}),
            },
            recoveryHint: recoveryHint
              ? {
                  action:
                    recoveryHint.action === "downgrade"
                      ? "switch_model"
                      : recoveryHint.action === "notify_user"
                        ? "abort"
                        : recoveryHint.action,
                  reason: recoveryHint.reason,
                  fallbackModelId: recoveryHint.fallbackModelId,
                  retryAfterMs: recoveryHint.retryAfterMs,
                  // notify_user 的提示文案要透传给上层 UI（BYOK quota 之类）
                  userMessage: recoveryHint.userMessage,
                }
              : undefined,
          });
          stopReason = "error";
          yield this.makeEvent(agentId, "terminated", { reason: "error" });
          return;
        }
      }

      // 走到这里 = 跑完 maxIterations 没 finalize；保险起见 emit 一个 LOOP_MAX_ITERATIONS
      // 错误事件，让上层 trace 能看到为什么以 "error" reason 退出。
      //
      // ★ P0-LIVE-MAX-ITER (2026-04-30): 旧版 emit output=lastAssistantMessage 然后
      //   terminated:budget → runner extractLegacyMetrics 把 reason="budget" 推断成
      //   legacyState="completed" → 上游 stage 看到 state="completed" + output=空字符串
      //   或最后一条 tool_call decision JSON → schema 校验已经过了才发现是垃圾。
      //   实测 mission 79b7de75 researcher#0 run=9 iter 永不 finalize，最后 output 是
      //   parallel_tool_call 的 raw decision JSON 不是 finding[]。
      //   修复：terminated reason="error" 让 runner 落到 legacyState="failed"，
      //   stage 才能正确走 dimension:degraded 兜底而不是把垃圾当 finding。
      this.logger.warn(
        `[${agentId}] reached maxIterations=${criteria.maxIterations} without finalize`,
      );
      yield this.makeEvent(agentId, "error", {
        message: `reached maxIterations=${criteria.maxIterations} without finalize`,
        recoverable: false,
        failureCode: "LOOP_MAX_ITERATIONS",
        diagnostic: {
          modelId: lastModelId,
          iteration,
        },
      });
      stopReason = "error";
      yield this.makeEvent(agentId, "terminated", { reason: "error" });
      stopReason = "error";
    } finally {
      // P0-3: Stop hook fire — 所有 termination 路径都会 finally
      // P0-6: API error 路径走 dispatchStop(isApiError=true)，跳过 skipOnApiError=true 的 hook
      //   防止 hook 注入新 token → PTL → retry storm（借鉴 Claude Code query.ts:1262-1264）
      await this.hookRegistry
        .dispatchStop(
          { reason: stopReason },
          { agentId, envelope: currentEnvelope },
          stopCausedByApiError,
        )
        .catch(() => undefined);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  /**
   * 从 envelope 提取最近一条 user 消息文本，作为 UserPromptSubmit hook 的 prompt
   * payload。若无 user 消息（如内部 agent-to-agent 调用），返回 null。
   */
  private extractLatestUserPrompt(env: IContextEnvelope): string | null {
    // ContextEnvelope 通常有 .messages 数组；走容错路径避免类型耦合
    const candidate = (
      env as unknown as {
        messages?: ReadonlyArray<{ role?: string; content?: string }>;
      }
    ).messages;
    if (Array.isArray(candidate)) {
      for (let i = candidate.length - 1; i >= 0; i--) {
        const m = candidate[i];
        if (m?.role === "user" && typeof m.content === "string") {
          return m.content;
        }
      }
    }
    return null;
  }

  private buildMessages(envelope: IContextEnvelope): ChatMessage[] {
    const msgs: ChatMessage[] = [];
    for (const r of envelope.reminders) {
      msgs.push({
        role: "system",
        content: `[reminder:${r.priority}] ${r.content}`,
      });
    }
    for (const m of envelope.messages) {
      // Layer 4/5 native FC（2026-05-07）：role:"tool" + toolCallId 直接透传到 ChatMessage。
      // ai-api-caller.callOpenAICompatibleAPI 用 tool_call_id 字段透 OpenAI/vLLM；
      // callAnthropicAPI 把 role:"tool" 转 user + content:[{type:"tool_result",tool_use_id,...}] 形态。
      // 旧 content prefix [tool_result ... call_id=Y] 兜底已删，wire 字段是单一权威源。
      msgs.push({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      });
    }
    // ★ 删除 envelope.tools 追加的降级版工具列表。
    // catalog block（在 envelope.system 里）已经有完整 <available_tools> 含
    // description + input schema + invocation example。这里再追加只有 id 的
    // 第二份会让 LLM 看到工具列表 2 遍 → 困惑"哪份准？"，可能引用降级版的
    // 不完整信息生成错误 action。
    return msgs;
  }

  /**
   * T2 (least-privilege): scope a recalled tool-id list to the agent's
   * allow/forbid policy. forbidden wins over allowed; an empty/undefined
   * allowlist means "all non-forbidden tools are visible". Used to build the
   * LLM-visible tool surface before FunctionDefinitions are constructed.
   */
  private filterVisibleTools(
    toolIds: readonly string[],
    allowed?: readonly string[],
    forbidden?: readonly string[],
  ): readonly string[] {
    if (
      (!forbidden || forbidden.length === 0) &&
      (!allowed || allowed.length === 0)
    ) {
      return toolIds;
    }
    return toolIds.filter((id) => {
      if (forbidden?.includes(id)) return false;
      if (allowed && allowed.length > 0) return allowed.includes(id);
      return true;
    });
  }

  private async reason(
    messages: ChatMessage[],
    baseSystem: string,
    signal?: AbortSignal,
    modelOverride?: string,
    cachePrefix?:
      | import("../context/cache-control-planner").SharedCachePrefix
      | null,
    /** BYOK：从 envelope.memory.userId 透传，让 chat() 走 user-default 查找链 */
    userId?: string,
    /** Spec 声明的 TaskProfile —— 优先用 agent 真实意图，缺省走 medium */
    specTaskProfile?: import("../../../ai-engine/llm/types/task-profile.types").TaskProfile,
    /** PR-1 native-FC: 当前 envelope 召回的工具 id 列表（envelope.tools） */
    recalledToolIds?: readonly string[],
    /**
     * #35: true when ≤2 iterations remain — triggers strict finalize schema
     * on non-FC branch so the provider enforces the business payload shape.
     */
    approachingLimit?: boolean,
    /**
     * #35: strict JSON schema for the business finalize output (e.g.
     * RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA). Only used when approachingLimit
     * is true and the FC branch is not active.
     */
    finalizeOutputJsonSchema?: Record<string, unknown>,
    /**
     * P1a/P1b: delimited finalize transport shape (undefined = disabled). When
     * set, reason() appends delimited-emit instructions to the system prompt and
     * parses delimited finalize output back into the decision.
     */
    delimitedFinalizeShape?: DelimitedFinalizeShape,
  ): Promise<{
    decision: ParsedDecision;
    /** ★ LLM 实际吐回的 raw content（response.content），诊断关键 */
    rawContent: string;
    /** parseDecision 兜底层抛错时的诊断信息（正常 catch 转 finalize 时为 undefined） */
    parseError?: { name: string; message: string };
    usage: {
      promptTokens: number;
      completionTokens: number;
      /** null = 模型未在 ModelPricingRegistry 注册（DB 缺 costTier/价格） */
      costUsd: number | null;
      cacheReadTokens: number;
      modelId?: string;
    };
  }> {
    if (signal?.aborted) {
      throw new Error("ReAct loop aborted by signal");
    }
    // PR-1 native-FC: flag-on 时换走 OpenAI 原生 tools 路径，跳过 DECISION_SYSTEM_SUFFIX
    // 与 responseFormat="json"。响应优先吃 toolCalls；为空回退 parseDecision JSON 路径
    // （含 toolId-as-kind 容错）—— 双层网，模型不支持 native FC 也不挂。
    const fcDefs = this.useNativeFunctionCalling
      ? this.buildFunctionDefinitions(recalledToolIds ?? [])
      : [];
    const useNativeFCThisCall = fcDefs.length > 0;
    // FC 路径与 prompt-driven 路径都拼 DECISION_SYSTEM_SUFFIX（DECISION_FC_SUFFIX
    // 当前是它的别名，字节字面一致 —— 保 cache 命中 + 双层网第二层 parseDecision
    // 真有 envelope JSON 可解。详见 DECISION_FC_SUFFIX 定义处的"vLLM parser 失效"
    // 历史踩坑注释。
    // P1a/P1b: only meaningful on the prompt-driven (non-FC) branch — native FC
    // emits structured tool_calls, not a finalize JSON envelope.
    const useDelimitedFinalize =
      !useNativeFCThisCall && !!delimitedFinalizeShape;
    const systemPrompt =
      (useNativeFCThisCall
        ? baseSystem + DECISION_FC_SUFFIX
        : baseSystem + DECISION_SYSTEM_SUFFIX) +
      (useDelimitedFinalize
        ? buildDelimitedFinalizeInstructions(delimitedFinalizeShape)
        : "");
    const response = await this.chatService.chat({
      messages,
      systemPrompt,
      tools: useNativeFCThisCall ? fcDefs : undefined,
      // PR-I 修复 #1: 让 BudgetAccountant.downgrade() 真正生效——
      // 把 tier 选出的 modelId 透给 ChatService（缺省走 election）。
      model: modelOverride,
      // 没有 elected/tier model 时 fallback 走系统配置的默认 CHAT 模型
      modelType: modelOverride ? undefined : AIModelType.CHAT,
      // PR-Q: prompt-cache 自动化 —— 重复 prefix 1/10 价
      cachePolicy: "auto",
      sharedCachePrefix: cachePrefix
        ? {
            systemPromptText: cachePrefix.systemPromptText,
            toolDefinitions: cachePrefix.toolDefinitions,
          }
        : undefined,
      // 优先用 agent spec 声明的 TaskProfile —— researcher="long" / leader="medium"
      // 等都按业务方意图走，不再被 Loop 硬编码覆盖。
      // 缺省走 medium（≥16k tokens），避免 reasoning 模型 CoT 撑爆 visible output。
      taskProfile: specTaskProfile ?? {
        creativity: "low",
        outputLength: "medium",
      },
      // ★ Harness 调用必须 strict —— LLM 出错就抛 exception，让 ReActLoop catch
      // 后明确发 error 事件 + terminated reason="error"。
      // 否则 AiChatService 会把 throw 转成 "**API 调用失败**..." fake content，
      // ReActLoop 收到非空 content 误以为成功，进 parseDecision 失败 → finalize
      // raw text → 误导 trace。
      strictMode: true,
      // PR-1 native-FC: native FC on 时不强制 JSON —— 模型应该走 tool_calls。
      // 强制 JSON 会让 vLLM tool parser 失效（content 必须是 JSON），fallback 路径
      // 反而拿不到自然 tool_calls。
      responseFormat: useNativeFCThisCall ? undefined : "json",
      // R2-#35: native structured output for non-FC branch only.
      // FC branch must NOT receive structuredOutputStrategy/outputJsonSchema —
      // the adapter would inject response_format on top of tools, breaking
      // providers that disallow both simultaneously.
      // parseDecision remains the fallback for providers that ignore json_schema.
      //
      // #35 strict finalize: on final iterations (approachingLimit=true) use the
      // strict decision-wrapper schema that embeds the business agent's finalize
      // output schema under action.output. This lets strict providers (json_schema
      // strict mode) enforce the payload shape at the provider level.
      // Falls back to permissive REACT_LOOP_DECISION_JSON_SCHEMA when not on
      // final iterations or when no business schema was provided.
      ...(useNativeFCThisCall
        ? {}
        : {
            structuredOutputStrategy: "json_schema" as const,
            outputJsonSchema:
              approachingLimit && finalizeOutputJsonSchema
                ? (buildFinalizeDecisionSchema(finalizeOutputJsonSchema) ??
                  REACT_LOOP_DECISION_JSON_SCHEMA)
                : REACT_LOOP_DECISION_JSON_SCHEMA,
          }),
      // ★ Harness 内部 agent-to-agent 编排，不是用户原始输入；guardrails
      // 对内部系统 prompt 进行内容审查会误杀（特别是含 BUILTIN_TOOL 描述、
      // 评审 prompt 等可能触发敏感词检测的合法系统内容）。
      // TI 在所有 chatFacade.chat 内部调用都加 skipGuardrails: true，对照实践。
      skipGuardrails: true,
      // ★ 让 BillingContext 的 operationName 反映真正业务（不是默认 "llm_call"）
      // 失败 trace 能直接定位 harness 内部调用，区别于业务侧 chat。
      operationName: "harness:react-loop:reason",
      // BYOK 环境感知：userId 透给 chat() → 用户的 UserModelConfig 默认值优先
      userId,
      signal,
    });
    if (signal?.aborted) {
      throw new Error("ReAct loop aborted by signal");
    }
    const promptTokens = response.usage?.inputTokens ?? 0;
    const completionTokens = response.usage?.outputTokens ?? 0;
    // PR-I 修复 #5: cacheReadTokens 由 LLM 提供商返回（Anthropic / OpenAI 都支持）
    const cacheReadTokens = response.usage?.cacheReadTokens ?? 0;
    // PR-R3 P0: cacheCreationTokens (Anthropic prompt-cache WRITE fee) must be costed
    const cacheWriteTokens = response.usage?.cacheCreationTokens ?? 0;
    // estimateCost 未注册 modelId 返回 null —— 不假装 0（会让 BudgetAccountant 假账）
    // null 透给 caller，BudgetAccountant.accountLLM 内部决定如何处理（仍计 token，cost 不增）
    const costUsd =
      this.pricingRegistry?.estimateCost(
        response.model,
        promptTokens,
        completionTokens,
        cacheReadTokens,
        cacheWriteTokens,
      ) ?? null;
    // ★ 诊断关键：把 LLM 原始 content 一并返回，让上层在所有 error / empty 路径
    // 都能把 "LLM 实际吐了啥" 带进 event payload 和日志，避免再靠代码反推。
    const rawContent = response.content ?? "";
    // PR-1 native-FC: 如果模型走了 native tool_calls（vLLM parser 已规范化为
    // {id, name, arguments}），直接构造 decision，跳过文本 JSON 解析。
    // toolCalls 为空才回退 parseDecision —— 旧 prompt-driven 路径 + 方言容错继续兜底。
    let decision: ParsedDecision;
    let parseError:
      | { name: string; message: string; subCode?: string }
      | undefined;
    if (
      useNativeFCThisCall &&
      response.toolCalls &&
      response.toolCalls.length > 0
    ) {
      try {
        decision = this.decisionFromToolCalls(response.toolCalls);
        parseError = undefined;
        // Canary observability: native FC engaged successfully.
        this.logger.debug(
          `[react-loop:native-fc] path=tool_calls count=${response.toolCalls.length} ` +
            `model=${response.model ?? "?"}`,
        );
      } catch (err) {
        // ★ Security R2 修法（2026-05-07）：decisionFromToolCalls 现在会拒绝 LLM
        //   在 native FC 路径里给出 reserved kind 名（skill_invoke / subagent_spawn /
        //   llm_generate）。命中即抛 InvalidActionError，与 prompt-driven 路径
        //   normalizeAction 抛 InvalidActionError 行为对称。这里 catch 后走
        //   finalize-raw 兜底，rawContent 给 caller 做诊断（reflexion critique 重试）。
        const errName = err instanceof Error ? err.name : "Unknown";
        const errMsg = err instanceof Error ? err.message : String(err);
        const subCode =
          err instanceof InvalidActionError ? err.subCode : undefined;
        this.logger.warn(
          `[react-loop:native-fc] toolCalls rejected (${errName}: ${errMsg}); ` +
            `falling back to finalize-raw.`,
        );
        decision = {
          thinking: "",
          action: { kind: "finalize", output: rawContent },
        };
        parseError = { name: errName, message: errMsg, subCode };
      }
    } else if (
      useDelimitedFinalize &&
      hasDelimitedFinalizeMarkers(rawContent, delimitedFinalizeShape)
    ) {
      // P1a/P1b: model emitted finalize via the delimited transport (long prose /
      // NDJSON outside the JSON envelope). Reconstruct the finalize output from
      // the blocks — immune to unescaped inner quotes that would break JSON.
      // Defensive: any failure falls back to the normal parseDecision path.
      try {
        const reconstructed = parseDelimitedFinalize(
          rawContent,
          delimitedFinalizeShape,
        );
        if (reconstructed) {
          decision = {
            thinking: reconstructed.thinking ?? "",
            action: { kind: "finalize", output: reconstructed.output },
          };
          parseError = undefined;
          this.logger.debug(
            `[react-loop:delimited-finalize] reconstructed finalize output ` +
              `(prose=${(delimitedFinalizeShape.proseFields ?? []).join(",") || "-"}, ` +
              `ndjson=${delimitedFinalizeShape.ndjsonArrayField ?? "-"})`,
          );
        } else {
          const parsed = this.parseDecision(rawContent);
          decision = parsed.decision;
          parseError = parsed.parseError;
        }
      } catch (err) {
        this.logger.warn(
          `[react-loop:delimited-finalize] parse failed, falling back: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        const parsed = this.parseDecision(rawContent);
        decision = parsed.decision;
        parseError = parsed.parseError;
      }
    } else {
      // parseDecision 内部 try/catch 自己处理不抛；返回 decision + 可选 parseError
      const parsed = this.parseDecision(rawContent);
      decision = parsed.decision;
      parseError = parsed.parseError;
      if (useNativeFCThisCall) {
        // Canary observability: native FC requested but model didn't return
        // tool_calls. Distinguishes "fell back to JSON parse" (有 action 的结构化
        // content) vs "finalized raw" (parseDecision 兜底把 raw text 当 finalize)。
        const path =
          decision.action.kind === "finalize" &&
          typeof decision.action.output === "string"
            ? "finalized_raw"
            : "fellback_json";
        this.logger.debug(
          `[react-loop:native-fc] path=${path} content_len=${rawContent.length} ` +
            `model=${response.model ?? "?"}` +
            (parseError ? ` parse_error=${parseError.name}` : ""),
        );
      }
    }
    // ★ 2026-06-07：推理模型（DeepSeek-V4-Flash 等）把 CoT 放在 reasoning_content
    //   独立通道（response.reasoning），content 只放动作 JSON 且常无 thinking 字段 →
    //   decision.thinking 空 → 前端「思考」永远空。thinking 空且有 reasoning 时用
    //   reasoning 回填（去 <think> 标签 + 截断），让用户看到模型真实推理。
    if (
      (!decision.thinking || decision.thinking.trim() === "") &&
      typeof response.reasoning === "string" &&
      response.reasoning.trim()
    ) {
      const r = stripReasoningBlocks(response.reasoning).trim();
      if (r) {
        decision = {
          ...decision,
          thinking: r.length > 2000 ? `${r.slice(0, 2000)}…` : r,
        };
      }
    }
    return {
      decision,
      rawContent,
      parseError,
      usage: {
        promptTokens,
        completionTokens,
        costUsd,
        cacheReadTokens,
        modelId: response.model,
      },
    };
  }

  /**
   * 2026-05-29: 判定 finalize.output 是否其实是个"工具调用信封"——模型没数据、
   * 还想继续搜（即便被 approachingLimit 强制 finalize），就把 {kind:"tool_call"|
   * "parallel_tool_call", calls:[...]} 塞进 finalize 槽位。这不是"字段缺失"型 schema
   * 不达标，需专门处理（否则普通 critique 让模型继续吐 tool_call 死循环烧预算）。
   */
  private isToolCallEnvelopeOutput(output: unknown): boolean {
    if (!output || typeof output !== "object") return false;
    const o = output as Record<string, unknown>;
    return (
      o.kind === "tool_call" ||
      o.kind === "parallel_tool_call" ||
      Array.isArray(o.calls) ||
      (typeof o.toolId === "string" && "input" in o)
    );
  }

  private parseDecision(raw: string): {
    decision: ParsedDecision;
    parseError?: { name: string; message: string; subCode?: string };
  } {
    // ★ 用 TI 已 battle-tested 的 extractJsonFromAIResponse 替代手写
    //   JSON.parse + extractFirstJsonObject。该工具支持：
    //   - markdown 围栏 ```json ... ``` 自动剥离
    //   - 截断 JSON 修复（reasoning 模型常见）
    //   - NDJSON-like 多对象只取首个
    //   - JSON 内嵌闲聊文本时也能找到首个完整对象
    //   原手写逻辑只覆盖部分场景，导致 reasoning 模型的退化输出常被误判。
    const extracted = extractJsonFromAIResponse<{
      thinking?: unknown;
      action?: unknown;
      actions?: unknown;
      // ★ LLM 常见协议偏差：把 action 内容直接放顶层（漏掉 thinking+action 双层包装）
      // e.g. LLM 吐 {"kind":"parallel_tool_call","calls":[...]}
      //      而不是 {"thinking":"...","action":{"kind":"parallel_tool_call","calls":[...]}}
      // 我们容错识别这种情况
      kind?: unknown;
      calls?: unknown;
      toolId?: unknown;
      input?: unknown;
      output?: unknown;
      skillId?: unknown;
      name?: unknown;
      prompt?: unknown;
    }>(raw);

    if (!extracted.success || !extracted.data) {
      const errName = "JsonExtractFailed";
      const errMsg = extracted.error ?? "no JSON found in response";
      // extracted.error 自带 "… Preview: <raw 前缀>"；下方已单独打印 raw(first 1000)，
      // 去掉内嵌 Preview 避免同一段内容被打印两遍（误判"重复"）。
      const errMsgNoPreview = errMsg.split(" Preview:")[0];
      this.logger.warn(
        `Failed to extract JSON from LLM decision (${errName}: ${errMsgNoPreview}); ` +
          `falling back to finalize-raw. ` +
          `raw(first 1000)=${JSON.stringify(raw.slice(0, 1000))}`,
      );
      return {
        decision: {
          // ★ JSON 抽取失败 — parser 已把 raw text 当作 finalize.output，
          //   不在 trace 里展示解析器异常 / 中文系统提示。
          thinking: "",
          action: { kind: "finalize", output: raw },
        },
        parseError: { name: errName, message: errMsg },
      };
    }

    try {
      const obj = extracted.data;
      // ★ 2026-05-13: reasoning models (Nemotron / DeepSeek-R1 / QwQ) often
      //   emit their chain-of-thought *inside* the `thinking` field wrapped
      //   in <think>…</think> or <reasoning>…</reasoning> tags. Strip these
      //   once at the parse boundary so every downstream consumer (trace
      //   event, assistant context replay, empty-finalize circuit breaker)
      //   sees a clean text summary instead of raw reasoning leakage.
      const thinking =
        typeof obj.thinking === "string"
          ? stripReasoningBlocks(obj.thinking)
          : "";

      // ★ LLM 协议容错：检测 action 内容裸放顶层（缺 {thinking, action} 包装）。
      // 生产 trace 显示 reasoning model 经常吐：
      //   {"kind":"parallel_tool_call","calls":[...]}
      //   {"kind":"tool_call","toolId":"web-search","input":{...}}
      //   {"kind":"finalize","output":{...}}
      // 而不是 {"thinking":"...","action":{...}}。这是 LLM 行为偏差，
      // 不是我们 prompt 错了 —— 容错认它。
      if (
        typeof obj.kind === "string" &&
        obj.action === undefined &&
        obj.actions === undefined
      ) {
        // 把整个 obj 当 action（剥掉非 action 字段不需要，normalizeAction 自己挑）
        const action = this.normalizeAction(obj);
        return { decision: { thinking, action } };
      }

      // Shorthand: top-level "actions" array → auto-wrap parallel_tool_call
      if (Array.isArray(obj.actions) && obj.actions.length > 0) {
        const calls = obj.actions
          .map((a) => this.normalizeToolCall(a))
          .filter((a): a is IToolCallAction => a !== null);
        if (calls.length === 0) {
          throw new InvalidActionError(
            "LLM returned 'actions' array with no valid tool calls",
            "empty_actions_array",
          );
        }
        if (calls.length === 1) {
          return { decision: { thinking, action: calls[0] } };
        }
        const action: IParallelToolCallAction = {
          kind: "parallel_tool_call",
          calls,
        };
        return { decision: { thinking, action } };
      }

      // ★ 2026-04-30 容错：LLM 返回了合法 object 但完全没 envelope（无 action /
      // 无 actions / 无顶层 kind）—— 这种情况以前 normalizeAction 会抛
      // InvalidActionError + ERROR log + fallback 把整段 raw text 当 finalize
      // output（导致下游拿到 string 而非结构化对象）。
      //
      // 实际产线 chapter-writer / dimension-integrator / dimension-quality-judge
      // 等 agent 大量触发 —— 它们的 system prompt 只说了"输出 JSON shape: {...}"
      // 没强制要求 envelope，reasoning model 直接吐 output 顶层。
      //
      // 改为：把整个 obj 当 finalize.output（保留结构化对象，不再退化字符串），
      // log 仅 debug 提示 envelope 缺失，不再污染错误流。
      if (obj.action === undefined) {
        this.logger.debug(
          `LLM emitted finalize output without envelope; auto-wrapping. ` +
            `keys=[${Object.keys(obj as Record<string, unknown>).join(",")}]`,
        );
        return {
          decision: {
            thinking,
            action: {
              kind: "finalize",
              output: obj as Record<string, unknown>,
            },
          },
        };
      }

      const action = this.normalizeAction(obj.action);
      return { decision: { thinking, action } };
    } catch (err) {
      // normalizeAction / normalizeToolCall 抛 InvalidActionError 走这里
      const errName = err instanceof Error ? err.name : "Unknown";
      const errMsg = err instanceof Error ? err.message : String(err);
      const subCode =
        err instanceof InvalidActionError ? err.subCode : undefined;
      this.logger.warn(
        `LLM JSON parsed but action invalid (${errName}: ${errMsg}); ` +
          `via=${extracted.method ?? "?"}; falling back to finalize-raw.`,
      );
      return {
        decision: {
          // ★ 这是 parser fallback 情况：LLM 把结果直接当顶级返回（漏写 envelope）。
          //   parser 已自动 fallback，不显示给用户「驳回 / 异常」字样，让 trace
          //   保持干净 —— action 直接显示 finalize、result 显示结构化产出。
          thinking: "",
          action: { kind: "finalize", output: raw },
        },
        parseError: { name: errName, message: errMsg, subCode },
      };
    }
  }

  private normalizeToolCall(action: unknown): IToolCallAction | null {
    if (!action || typeof action !== "object") return null;
    const a = action as Record<string, unknown>;
    if (typeof a.toolId === "string") {
      return {
        kind: "tool_call",
        toolId: a.toolId,
        input: (a.input as Record<string, unknown>) ?? {},
      };
    }
    // toolId-as-kind 容错：parallel_tool_call.calls[] 同样可能吐
    // {"kind":"web-search","input":{...}} 形态。和 normalizeAction 保持对称。
    if (
      typeof a.kind === "string" &&
      a.kind.trim().length > 0 &&
      a.kind !== "tool_call" &&
      a.input !== undefined
    ) {
      return {
        kind: "tool_call",
        toolId: a.kind,
        input: (a.input as Record<string, unknown>) ?? {},
      };
    }
    return null;
  }

  /**
   * 把 LLM JSON 里的 action 字段规范化为 IAction。
   *
   * ★ 设计原则：**只接受 LLM 主动声明的合法 action**（kind = tool_call /
   * parallel_tool_call / finalize）。所有"格式不对 / 缺字段 / kind 不识别"
   * 的退化情况一律抛 InvalidActionError，由 parseDecision 的 catch 分支接住。
   *
   * 不再把退化情况偷偷合成 `{kind:"finalize", output:""}` —— 那样会让
   * react-loop 的 empty-finalize 熔断把"LLM 一次 safety refusal / 截断"
   * 误判成"LLM 主动选 finalize 空"，立即 abort，绕过 ReflexionLoop 重试链。
   */
  private normalizeAction(action: unknown): IAction {
    if (!action || typeof action !== "object") {
      throw new InvalidActionError(
        `LLM response missing valid 'action' field (got ${typeof action})`,
        "missing_action",
      );
    }
    const a = action as Record<string, unknown>;

    // ── tool_call ──────────────────────────────────────
    if (a.kind === "tool_call") {
      if (typeof a.toolId !== "string" || !a.toolId.trim()) {
        // ★ 精准错误：kind 对但 toolId 缺/非 string，之前掉到 unknown_kind 误导
        throw new InvalidActionError(
          `tool_call action requires "toolId" (string), got ${typeof a.toolId}`,
          "missing_action",
        );
      }
      return {
        kind: "tool_call",
        toolId: a.toolId,
        input: (a.input as Record<string, unknown>) ?? {},
      };
    }

    // ── parallel_tool_call ────────────────────────────
    if (a.kind === "parallel_tool_call") {
      if (!Array.isArray(a.calls)) {
        throw new InvalidActionError(
          `parallel_tool_call action requires "calls" (array), got ${typeof a.calls}`,
          "empty_parallel_calls",
        );
      }
      const calls = a.calls
        .map((c) => this.normalizeToolCall(c))
        .filter((c): c is IToolCallAction => c !== null);
      if (calls.length === 0) {
        throw new InvalidActionError(
          "LLM returned parallel_tool_call with no valid tool calls",
          "empty_parallel_calls",
        );
      }
      const max =
        typeof a.maxConcurrency === "number" ? a.maxConcurrency : undefined;
      return { kind: "parallel_tool_call", calls, maxConcurrency: max };
    }

    // ── finalize ──────────────────────────────────────
    if (a.kind === "finalize") {
      // 仅当 LLM 显式声明 kind="finalize" 时才认为是主动 finalize；
      // 此时 output="" 是 LLM 自己的合法决定（少见但允许）。
      return {
        kind: "finalize",
        output: (a.output as string | Record<string, unknown>) ?? "",
      };
    }

    // ── toolId-as-kind 容错（reasoning model 退化形态）─────────────────
    // Nemotron / Qwen-class reasoning models trained on native OpenAI tool_calls
    // 经常把 toolId 直接放进 kind，吐 {"kind":"web-search","input":{...}}
    // 而不是 {"kind":"tool_call","toolId":"web-search","input":{...}}。
    // 协议里两个字段编码同一信息（tool 名）冗余，模型自然合并。
    // 触发条件：kind 是非空字符串、不是协议保留 kind、且带 input 字段
    // （input 存在是"这是 tool call 形状"的强信号；纯无效 kind 不会带 input）。
    // 兜底转 tool_call 后由 ToolRegistry 校验 toolId 是否已注册：未注册照样报
    // ToolNotFound（合理错误），不会把无效 kind 偷偷塞给随便一个 tool。
    if (
      typeof a.kind === "string" &&
      a.kind.trim().length > 0 &&
      !RESERVED_ACTION_KINDS.has(a.kind) &&
      a.input !== undefined
    ) {
      return {
        kind: "tool_call",
        toolId: a.kind,
        input: (a.input as Record<string, unknown>) ?? {},
      };
    }

    // ── 协议外 kind（subagent_spawn / skill_invoke / llm_generate）─────
    // 这些 kind 不在 DECISION_SYSTEM_SUFFIX 协议里，理论上 LLM 不该吐。
    // 真要支持得在 executeAction 里完整实现 + 在协议里宣传。当前抛错让
    // ReflexionLoop 走 critique 重试，不要让 LLM 用未支持的 action。
    throw new InvalidActionError(
      `LLM returned unsupported action kind: ${JSON.stringify(a.kind)}. ` +
        `Only "tool_call", "parallel_tool_call", "finalize" are accepted.`,
      "unknown_kind",
    );
  }

  private async executeAction(
    action: IAction,
    envelope: IContextEnvelope,
    agentId: string,
    signal?: AbortSignal,
    allowedTools?: readonly string[],
    forbiddenTools?: readonly string[],
    parent?: IAgent,
    spawner?: ISubagentSpawner,
  ): Promise<IActionResult> {
    if (action.kind === "tool_call") {
      const pre = await this.hookRegistry.dispatch(
        "PreToolUse",
        { action },
        { agentId, envelope },
      );
      if (pre.block) {
        return {
          action,
          output: undefined,
          error: new Error(`blocked: ${pre.reason ?? "policy"}`),
          latencyMs: 0,
        };
      }
      const result = await this.toolInvoker.invoke(action, envelope, {
        agentId,
        signal,
        allowedTools,
        forbiddenTools,
      });
      await this.hookRegistry.dispatch(
        "PostToolUse",
        { action, result },
        { agentId, envelope },
      );
      return result;
    }

    if (action.kind === "parallel_tool_call") {
      // PreToolUse fires per-call so policies can block individually
      const filteredCalls: IToolCallAction[] = [];
      for (const call of action.calls) {
        const pre = await this.hookRegistry.dispatch(
          "PreToolUse",
          { action: call },
          { agentId, envelope },
        );
        if (!pre.block) filteredCalls.push(call);
      }
      const filtered: IParallelToolCallAction = {
        kind: "parallel_tool_call",
        calls: filteredCalls,
        maxConcurrency: action.maxConcurrency,
      };
      const result = await this.toolInvoker.invokeMany(filtered, envelope, {
        agentId,
        signal,
        allowedTools,
        forbiddenTools,
      });
      // PostToolUse per sub-result for symmetric observability
      for (const sub of result.subResults ?? []) {
        await this.hookRegistry.dispatch(
          "PostToolUse",
          { action: sub.action, result: sub },
          { agentId, envelope },
        );
      }
      return result;
    }

    if (action.kind === "finalize") {
      // ★ 把 finalize.output 归一化为结构化对象（如果是 JSON 字符串就 parse）。
      //   force-finalize fallback 给的是 raw text；不解析的话下游 trace 会拿到一个
      //   超长字符串而非对象，前端结构化卡片渲染就走不进去（fallback 到 raw JSON）。
      let normalizedOutput: unknown = action.output;
      if (typeof normalizedOutput === "string") {
        const trimmed = normalizedOutput.trim();
        if (
          (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
          (trimmed.startsWith("[") && trimmed.endsWith("]"))
        ) {
          try {
            normalizedOutput = JSON.parse(trimmed);
          } catch {
            /* parse 失败保持 string，后续 schema gate 会处理 */
          }
        }
      }
      return { action, output: normalizedOutput, latencyMs: 0 };
    }

    if (action.kind === "subagent_spawn") {
      const startMs = Date.now();
      if (!parent || !spawner) {
        return {
          action,
          output: undefined,
          error: new Error(
            "subagent_spawn: parent agent + spawner not wired into Loop options",
          ),
          latencyMs: 0,
        };
      }
      try {
        // Compose minimal ISubagentSpec from action fields. The child inherits
        // parent's identity except role.id is suffixed with the spawn name.
        const childIdentity = {
          ...parent.identity,
          role: {
            ...parent.identity.role,
            id: `${parent.identity.role.id}.${action.name}`,
          },
        };
        const handle = await spawner.spawn(parent, {
          name: action.name,
          identity: childIdentity,
          prompt: action.prompt,
          isolation: action.isolation,
          budget: action.budget
            ? {
                maxTokens: action.budget.tokens,
                maxIterations: action.budget.iterations,
              }
            : undefined,
        });
        // Drain handle.events so the child runs; collect final output.
        // Forwarding events to parent stream would change the loop contract,
        // so we just await result (parent sees subagent_spawn as a single
        // action_executed event with the aggregated output).
        const output = await handle.waitForResult();
        return {
          action,
          output,
          latencyMs: Date.now() - startMs,
        };
      } catch (err) {
        return {
          action,
          output: undefined,
          error: err instanceof Error ? err : new Error(String(err)),
          latencyMs: Date.now() - startMs,
        };
      }
    }

    return {
      action,
      output: undefined,
      error: new Error(`Action kind '${action.kind}' not yet supported`),
      latencyMs: 0,
    };
  }

  private updateEnvelope(
    envelope: IContextEnvelope,
    decision: ParsedDecision,
    result: IActionResult,
  ): IContextEnvelope {
    const assistantMsg: IContextMessage = {
      role: "assistant",
      content: JSON.stringify({
        thinking: decision.thinking,
        action: decision.action,
      }),
      timestamp: Date.now(),
    };

    const observations: IContextMessage[] = [];

    if (result.action.kind === "tool_call") {
      observations.push({
        role: "tool",
        // R2-#42: 外部不可信工具输出做 <external_source> 隔离 + sanitize（间接注入防御）
        content: wrapToolObservation(
          this.stringifyObservation(result),
          result.action.toolId,
        ),
        name: result.action.toolId,
        // PR-1 native-FC P1#2: 透传 callId（来自 LLM tool_use_id）让 IContextMessage 不丢；
        // buildMessages 当前会把 role:"tool" 降级成 user（ChatMessage 不支持 tool role），
        // 严格 native 配对需要后续 PR 扩 ChatMessage —— 但 envelope 这层数据完整性先保住。
        toolCallId: result.action.callId,
        timestamp: Date.now(),
      });
    } else if (result.action.kind === "parallel_tool_call") {
      // 每个子结果各自写回，模型下一轮可看到独立的 tool 输出
      for (const sub of result.subResults ?? []) {
        if (sub.action.kind === "tool_call") {
          observations.push({
            role: "tool",
            // R2-#42: 同上 —— 子结果也走外部内容隔离
            content: wrapToolObservation(
              this.stringifyObservation(sub),
              sub.action.toolId,
            ),
            name: sub.action.toolId,
            // 同上 — 透传 callId，每个 sub 的 callId 独立（parallel_tool_call.calls[i].callId）
            toolCallId: sub.action.callId,
            timestamp: Date.now(),
          });
        }
      }
    }

    if (envelope instanceof ContextEnvelope) {
      let next = envelope.append([assistantMsg]).envelope;
      if (observations.length > 0 && next instanceof ContextEnvelope) {
        next = next.append(observations).envelope;
      }
      return next;
    }

    const nextMessages = [...envelope.messages, assistantMsg, ...observations];
    return { ...envelope, messages: nextMessages };
  }

  private stringifyObservation(result: IActionResult): string {
    if (result.error) return `[tool error] ${result.error.message}`;
    if (typeof result.output === "string") return result.output;
    try {
      return JSON.stringify(result.output);
    } catch {
      return String(result.output);
    }
  }

  private extractLastAssistantMessage(
    envelope: IContextEnvelope,
  ): string | null {
    for (let i = envelope.messages.length - 1; i >= 0; i -= 1) {
      const m = envelope.messages[i];
      if (m.role === "assistant") return m.content;
    }
    return null;
  }

  private isRecoverable(err: Error): boolean {
    return !/aborted/i.test(err.message);
  }

  private makeEvent(
    agentId: string,
    type: IAgentEvent["type"],
    payload: AgentEventPayload,
  ): IAgentEvent {
    return { type, agentId, timestamp: Date.now(), payload };
  }
}

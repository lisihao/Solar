/**
 * AgentRunner — DX 层的统一运行入口
 *
 * 业务方写：
 *   const result = await this.runner.run(MyAgent, input);
 *   for await (const ev of this.runner.stream(MyAgent, input)) { ... }
 *
 * 内部：
 *   1. readDefineAgentMeta(ctor) → 取 spec 元数据
 *   2. instantiate ctor → 拿 buildSystemPrompt / validateBusinessRules / stubFn
 *   3. 组装 IAgentSpec → factory.create → agent.execute
 *   4. 流模式：直接 yield agent 事件
 *      Run 模式：drain 事件流，提取最后 output；用 outputSchema parse
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type { z } from "zod";
import { AgentFactory } from "../core/agent-factory";
import { AgentIdentity } from "../core/agent-identity";
import type {
  IAgent,
  IAgentEvent,
  IAgentIdentity,
  IAgentSpec,
  IRuntimeEnvironment,
} from "../abstractions";
import type { MissionElectionReservation } from "../../guardrails/runtime/mission-election-tracker.service";
import { ToolRegistry } from "../../../ai-engine/tools/registry/tool.registry";
import { BuiltinSkillCatalog } from "../skill-runtime";
import { BillingContext } from "../../../platform/credits/billing-context.store";
import {
  readDefineAgentMeta,
  AgentSpec,
  type DefineAgentOptions,
} from "./agent-spec.base";
import { describeOutputSchemaForLlm } from "./zod-schema-prompt";
import { isSearchTimeRange } from "@/common/search/search-time-range";
import { extractJsonFromAIResponse } from "@/common/utils/json-extraction.utils";
import { extractRealCostUsd } from "../../tracing/observability/token-spend.utils";

/**
 * 2026-05-13: 把 agent input 上的 mission-scoped 字段（searchTimeRange / language /
 * missionId / dimensionId）抽到 envelope.metadata。tool-invoker 会透传给 ToolContext
 * → search 类 tool 的 `resolveEffectiveTimeRange()` 把它作为 LLM 漏传时的兜底。
 *
 * 留意：仅抽取已知白名单字段，避免把整个 input 写进 envelope（input 可能包含 KB
 * dump、巨型上下文等，envelope.metadata 是只读快照传给所有 tool）。
 */
function buildEnvelopeMetadataFromInput(
  parsedInput: unknown,
): Record<string, unknown> | undefined {
  if (!parsedInput || typeof parsedInput !== "object") return undefined;
  const src = parsedInput as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (isSearchTimeRange(src.searchTimeRange)) {
    out.searchTimeRange = src.searchTimeRange;
  }
  if (typeof src.language === "string") out.language = src.language;
  if (typeof src.missionId === "string") out.missionId = src.missionId;
  if (typeof src.dimensionId === "string") out.dimensionId = src.dimensionId;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * ★ 迭代出口标准枚举（mission-pipeline-exit-policy.md / baseline §1.4）
 *
 * 优先级：cancelled > failed_* > budget_exhausted > wall_time_exceeded
 *           > max_iterations > validation_rejected_max > completed
 */
export type ExitReason =
  // ─── 成功类 ────────────────────────────
  | "completed"
  // ─── 质量类（output 仍可用，但低于期望）─
  | "validation_rejected_max"
  // ─── 资源类 ────────────────────────────
  | "budget_exhausted"
  | "max_iterations"
  | "wall_time_exceeded"
  // ─── 错误类 ────────────────────────────
  | "failed_parse"
  | "failed_tool"
  | "failed_model"
  | "empty_response"
  // ─── 主动类 ────────────────────────────
  | "cancelled";

/**
 * 三段式 RunResult（mission-pipeline-runresult-schema.md / baseline §1.2）
 *
 *  段 1 业务产物：output / partialOutput
 *  段 2 终态：state / exitReason / failureCode / diagnostic / recoveryHint
 *  段 3 运行元信息：iterations / wallTimeMs / tokensUsed / costCents / modelTrail / events
 *  段 4 工具使用：toolsUsed / toolsCatalogSnapshot
 *  段 5 元数据：meta
 *
 * 老字段 output / state / events / iterations / wallTimeMs / agent 保留（向后兼容）。
 * 新代码请用 段 2-5 字段。
 */
export interface RunResult<TOutput = unknown> {
  // ─── 段 1：业务产物 ─────────────────────────────
  readonly output?: TOutput;
  readonly partialOutput?: unknown;

  // ─── 段 2：终态 ─────────────────────────────────
  readonly state: "completed" | "failed" | "cancelled" | "degraded";
  readonly exitReason: ExitReason;
  readonly failureCode?: import("../abstractions/agent-event.interface").HarnessFailureCode;
  readonly diagnostic?: Record<string, unknown>;
  readonly recoveryHint?: {
    action: "retry" | "switch_model" | "downgrade_tier" | "abort";
    reason?: string;
    fallbackModelId?: string;
    retryAfterMs?: number;
  };

  // ─── 段 3：运行元信息 ──────────────────────────
  readonly iterations: number;
  readonly wallTimeMs: number;
  readonly tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  readonly costCents: number;
  readonly modelTrail: readonly {
    iter: number;
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
  }[];
  readonly events: readonly IAgentEvent[];

  // ─── 段 4：工具使用快照 ────────────────────────
  readonly toolsUsed: readonly {
    toolId: string;
    calls: number;
    totalLatencyMs: number;
    failures: number;
  }[];
  readonly toolsCatalogSnapshot: readonly string[];

  // ─── 段 5：元信息 ──────────────────────────────
  readonly meta: {
    agentId: string;
    specVersion?: string;
    sessionId?: string;
    startedAt: number;
    finishedAt: number;
  };

  // ─── 兼容字段（旧 caller） ─────────────────────
  readonly agent: IAgent;
}

/**
 * Harness 自闭包运行选项 —— Agent 不感知环境/账单/能力发现，全由 Runner 负责。
 *
 *  - userId         → 自动包 BillingContext.run({userId, ...})，下游 LLM 调用走该用户 BYOK
 *  - workspaceId    → 同上，BillingContext metadata
 *  - environment    → 自动调 getByokStatus / getCreditState / listAvailableModels
 *                     拼成 <environment> block 注入 systemPrompt
 *  - exposeCatalog  → 默认 true：把 @DefineAgent({tools, skills}) 声明的能力 + 描述
 *                     拼成 <available_tools> / <available_skills> block 注入 systemPrompt
 *  - onMissingByok  → 'fail' = BYOK 缺失立刻 throw；'warn' = 记录但继续；'allow'(默认) = 走平台 key
 *  - onEvent        → per-iteration 事件回调（实时 relay 用）
 *  - billingMeta    → BillingContext 元数据（moduleType / operationType / referenceId）
 */
export interface RunOptions {
  readonly userId?: string;
  readonly workspaceId?: string;
  readonly environment?: IRuntimeEnvironment;
  readonly preferredModelId?: string;
  readonly exposeCatalog?: boolean;
  readonly onMissingByok?: "fail" | "warn" | "allow";
  readonly onEvent?: (ev: IAgentEvent) => void | Promise<void>;
  readonly billingMeta?: {
    moduleType?: string;
    operationType?: string;
    referenceId?: string;
  };
  /**
   * 缩放 @DefineAgent.budget.maxTokens / maxIterations 的倍率（默认 1.0）。
   * 业务方传入即可让 mission 级 "low/medium/high/unlimited" 档位生效，
   * 不需要改 spec class。Harness 在 buildIdentity 时套用倍率。
   */
  readonly budgetMultiplier?: number;
  /**
   * ★ Tool Recall hint —— 上层（如 Leader 阶段）给本次任务的工具收窄/偏好。
   *
   * 设计：mission-pipeline-baseline.md §1.1 / §3.4 / §10 Q1 Q2
   *
   * - 上层声明意图（如 dim 性质 = 'academic'），AgentRunner 据此从 ToolRegistry
   *   实时召回工具子集
   * - hint 缺失时按 spec.toolCategories（+ 兼容 spec.tools）召回
   * - 五步流程：基础召回 → hint 收窄 → 黑名单减去 → ToolACL 过滤 → preferIds 标 ★
   * - 召回结果同时驱动 (a) identity.tools (b) <available_tools> catalog block
   *
   * 安全约束（materialize() 内强制）：
   *   - hint.categories 必须 ⊆ spec.toolCategories ∪ spec.tools categories（越界静默丢弃）
   *   - hint.preferIds 必须 ∈ recalled 集（越界静默丢弃）
   *   - recalled 为空 → InsufficientToolsError fail-fast
   */
  readonly toolRecallHint?: {
    categories?: readonly string[];
    excludeIds?: readonly string[];
    preferIds?: readonly string[];
  };
  /**
   * ★ Loop 覆盖（mission-pipeline-audit-layers.md L1 Reflexion 启用机制）
   *
   * 上层（如 thorough/paranoid 档位）可指定本次运行用 reflexion 而非 spec.loop 默认值。
   * 同时透传 reflexion 配置（verifiers / passThreshold / maxRevisions）。
   */
  readonly loopOverride?: import("../abstractions").AgentLoopKind;
  readonly reflexion?: {
    passThreshold?: number;
    maxRevisions?: number;
  };
  /**
   * ★ Phase P12-1: AbortSignal 透传（mission-pipeline-baseline.md §9.4 / Q11）
   * 上层（如 orchestrator）传 mission 级 controller.signal，所有子 runner 共享
   * 取消信号；ReActLoop 已检查 options?.signal?.aborted。
   */
  readonly signal?: AbortSignal;
}

export class DefineAgentMissingError extends Error {
  constructor(name: string) {
    super(
      `[${name}] @DefineAgent metadata not found — class must be decorated with @DefineAgent({...})`,
    );
    this.name = "DefineAgentMissingError";
  }
}

export class InputValidationError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly issues: string,
  ) {
    super(`[${agentId}] input failed schema validation: ${issues}`);
    this.name = "InputValidationError";
  }
}

export class ByokRequiredError extends Error {
  readonly code = "BYOK_REQUIRED";
  constructor(
    public readonly userId: string,
    public readonly agentId: string,
  ) {
    super(
      `[${agentId}] BYOK key required for user ${userId} — set onMissingByok:'allow' to use platform key, or have user configure a personal key.`,
    );
    this.name = "ByokRequiredError";
  }
}

/**
 * Tool Recall 五步走完后召回为空时抛出 —— 早 fail，不进 ReActLoop 避免空 catalog
 * 让 LLM 抓瞎。
 */
export class InsufficientToolsError extends Error {
  readonly code = "INSUFFICIENT_TOOLS";
  constructor(
    public readonly agentId: string,
    public readonly diagnostic: {
      declaredCategories: readonly string[];
      declaredIds: readonly string[];
      hint?: RunOptions["toolRecallHint"];
    },
  ) {
    super(
      `[${agentId}] Tool Recall yielded empty pool. Spec declared categories=[${diagnostic.declaredCategories.join(",")}] / ids=[${diagnostic.declaredIds.join(",")}]; hint=${JSON.stringify(diagnostic.hint ?? null)}.`,
    );
    this.name = "InsufficientToolsError";
  }
}

@Injectable()
export class AgentRunner {
  private readonly logger = new Logger(AgentRunner.name);

  constructor(
    private readonly factory: AgentFactory,
    @Optional() private readonly toolRegistry?: ToolRegistry,
    @Optional() private readonly skillRegistry?: BuiltinSkillCatalog,
  ) {}

  /**
   * 一次性执行：drain 事件流并返回最后输出（强类型）。
   *
   * 第三参数支持两种形态（向后兼容）：
   *   - function: 视为 onEvent 回调（旧调用方式）
   *   - RunOptions 对象: 完整环境感知（推荐 — 自动 BYOK 预检 + env block + BillingContext）
   */
  async run<T extends new () => AgentSpec<z.ZodType, z.ZodType>>(
    Spec: T,
    input: z.input<NonNullable<DefineAgentOptions["inputSchema"]>>,
    optsOrOnEvent?: RunOptions | ((ev: IAgentEvent) => void | Promise<void>),
  ): Promise<RunResult<unknown>> {
    const opts: RunOptions =
      typeof optsOrOnEvent === "function"
        ? { onEvent: optsOrOnEvent }
        : (optsOrOnEvent ?? {});

    const startMs = Date.now();
    const meta = readDefineAgentMeta(Spec);
    if (!meta) throw new DefineAgentMissingError(Spec.name);

    // ── BYOK 预检（fail-fast，免得跑到第一次 chat 才 503）──
    await this.precheckByok(opts, meta.id);

    // ── Tool Recall 五步流程 —— 决定 catalog 渲染 + identity.tools ──
    const recall = await this.performToolRecall(meta, opts);
    // emit tools_recalled 事件（baseline §1.3）—— 让上层 trace 可视化
    if (opts.onEvent) {
      try {
        await opts.onEvent({
          type: "tools_recalled",
          agentId: meta.id,
          timestamp: Date.now(),
          payload: {
            recalledIds: recall.recalledIds,
            categories:
              opts.toolRecallHint?.categories ?? meta.toolCategories ?? [],
            source: recall.source,
            preferIds: recall.effectivePreferIds,
          },
        });
      } catch {
        // 不让回调异常拖垮启动
      }
    }

    // ── 装配增强 systemPrompt blocks（环境 + 能力目录）──
    const augmentBlocks = await this.collectAugmentBlocks(
      meta,
      opts,
      recall.recalledIds,
      recall.effectivePreferIds,
    );
    const preferredModelSelection = await this.resolvePreferredModel(
      meta,
      opts,
    );

    const { agent, instance, parsedInput } = this.materialize(
      Spec,
      input,
      meta,
      augmentBlocks,
      recall.recalledIds,
      opts.budgetMultiplier,
      opts.userId,
      opts.workspaceId,
      opts.environment,
      opts.loopOverride,
      preferredModelSelection.modelId,
      preferredModelSelection,
    );

    // ── 自动包 BillingContext（如果 userId 已知）──
    const work = async () =>
      this.drainEvents(
        agent,
        instance,
        parsedInput,
        meta,
        opts.onEvent,
        opts.signal,
      );

    // BillingContext 嵌套规则：
    //   - 外层（业务方 controller / interceptor / orchestrator）已包了 → 不动，沿用
    //   - 没有外层 → 用 RunOptions 给的 billingMeta 自行包一层
    // 否则内层会覆盖外层的 moduleType/operationType, credits.consumeCredits()
    // 找不到对应 CreditRule，导致计费走 ADJUSTMENT fallback。
    const existingBilling = BillingContext.get();
    const billingMeta = opts.billingMeta ?? {};
    const needsWrap = opts.userId && !existingBilling;
    const { events, state, lastOutput, iterations } = needsWrap
      ? await BillingContext.run(
          {
            userId: opts.userId,
            moduleType: billingMeta.moduleType ?? "harness",
            operationType: billingMeta.operationType ?? meta.id,
            referenceId: billingMeta.referenceId,
          },
          work,
        )
      : await work();

    // outputSchema 校验（DX 层兜底；LlmExecutor 已在内部 self-heal —— 这里是最终断言）
    let finalOutput: unknown = lastOutput;
    let finalState = state;
    if (meta.outputSchema) {
      // ReActLoop.finalize 经常把 LLM 输出原样塞回 output 字段；当 LLM 把
      // 对象 stringify 后传出（{"output": "{\"key\":..."}"}），此处 safeParse
      // 会因为类型是 string 而失败。
      //
      // ★ 2026-05-13: 旧逻辑仅在 trimmed.startsWith("{")/("[") 时尝试 parse，
      // 本地推理模型（Nemotron-3-Nano / DeepSeek-R1 等）频繁吐 "Here is
      // the JSON: {…}\n\nLet me know…" 这种带前后散文的输出，旧判断 miss。
      // 改走 extractJsonFromAIResponse 的 7 策略抽取器（含 <think> 剥离、
      // 任意位置 brace counting、truncated JSON repair）。
      let candidate = finalOutput;
      if (typeof candidate === "string") {
        const extracted = extractJsonFromAIResponse(candidate);
        if (extracted.success) {
          candidate = extracted.data;
        }
        // failed extraction → 保留 string，schema 自己 reject (state=failed)
      }
      const parsed = meta.outputSchema.safeParse(candidate);
      if (!parsed.success) {
        // Don't throw — preserve partial output for diagnosis; mark failed
        finalState = "failed";
        // ★ 关键：检查是否已有更内层的结构化 error event。
        // 内层 ReActLoop / ReflexionLoop 已 emit 真根因（PARSE_* /
        // LOOP_REASONING_COT_EXHAUSTION / LOOP_BUDGET_EXHAUSTED 等），那里才是
        // 真因 —— output 是 null/undefined/"" 是它的**症状**，不是另一个独立故障。
        // 倒序扫到 origin error 就跳过 RUNNER_OUTPUT_SCHEMA_MISMATCH 的 push，
        // 否则 orchestrator.extractAgentFailureDiagnostic 倒序取的是 schema diff
        // 这条**派生错误**，把真因（empty LLM / parse / budget）淹没掉。
        const hasUpstreamFailure = events.some(
          (ev) =>
            ev.type === "error" &&
            !!(ev.payload as { failureCode?: string } | null)?.failureCode,
        );
        // 只有 candidate 是真值（非 null/undefined/空字符串）时，schema mismatch
        // 才是独立失败；null/undefined/"" 一定是上层 loop 没产 output 引起的派生。
        const candidateIsMeaningful =
          candidate != null &&
          !(typeof candidate === "string" && candidate.trim() === "");

        if (hasUpstreamFailure && !candidateIsMeaningful) {
          this.logger.debug(
            `[${meta.id}] suppressing RUNNER_OUTPUT_SCHEMA_MISMATCH ` +
              `(candidate=${candidate === null ? "null" : typeof candidate}, ` +
              `upstream error already emitted)`,
          );
        } else {
          // ★ 全链路诊断：把 zod schema diff 注入 events 流，让 trace 可见
          // outputSchema 期望 vs 实际 output 的差异。
          const schemaError = parsed.error.issues
            .map(
              (iss) =>
                `${iss.path.join(".") || "<root>"}: ${iss.message} (code=${iss.code})`,
            )
            .join("; ");
          const candidateSnippet =
            typeof candidate === "string"
              ? candidate.slice(0, 500)
              : JSON.stringify(candidate).slice(0, 500);
          events.push({
            type: "error",
            agentId: agent.id,
            timestamp: Date.now(),
            payload: {
              message: `Output schema validation failed: ${schemaError}`,
              recoverable: false,
              failureCode: "RUNNER_OUTPUT_SCHEMA_MISMATCH",
              diagnostic: {
                schemaError,
                actualOutputSnippet: candidateSnippet,
                actualOutputType: typeof candidate,
                specId: meta.id,
                hasUpstreamFailure,
              },
            },
          });
        }
      } else {
        finalOutput = parsed.data;
      }
    }

    const wallTimeMs = Date.now() - startMs;
    const finishedAt = Date.now();
    const hasOutput = meta.outputSchema
      ? finalState === "completed" && finalOutput != null
      : finalOutput != null && finalOutput !== "";
    // finalState 是 drainEvents legacy 三态（不会 emit 'degraded'，那是 metrics 派生）
    const legacyState = finalState as "completed" | "failed" | "cancelled";
    const metrics = this.computeRunMetrics(events, legacyState, hasOutput);

    return {
      // 段 1
      output: hasOutput ? finalOutput : undefined,
      partialOutput: metrics.partialOutput,
      // 段 2
      state: metrics.state,
      exitReason: metrics.exitReason,
      failureCode: metrics.failureCode,
      diagnostic: metrics.diagnostic,
      recoveryHint: metrics.recoveryHint,
      // 段 3
      iterations,
      wallTimeMs,
      tokensUsed: metrics.tokensUsed,
      costCents: metrics.costCents,
      modelTrail: metrics.modelTrail,
      events,
      // 段 4
      toolsUsed: metrics.toolsUsed,
      toolsCatalogSnapshot: metrics.toolsCatalogSnapshot,
      // 段 5
      meta: {
        agentId: meta.id,
        specVersion: meta.version ?? "1.0.0",
        startedAt: startMs,
        finishedAt,
      },
      // 兼容字段
      agent,
    };
  }

  /**
   * 流模式：直接 yield agent 事件。
   * 业务 Controller 直接 SSE/WebSocket 转发。
   *
   * 与 run() 一致地接受 RunOptions：BYOK 预检 / BillingContext 包装 /
   * environment block 注入 / catalog block 注入 全部生效。
   * onEvent 会在每个事件 yield 之前被调用（保持向后兼容的回调时序）。
   */
  async *stream<T extends new () => AgentSpec<z.ZodType, z.ZodType>>(
    Spec: T,
    input: z.input<NonNullable<DefineAgentOptions["inputSchema"]>>,
    opts: RunOptions = {},
  ): AsyncIterable<IAgentEvent> {
    const meta = readDefineAgentMeta(Spec);
    if (!meta) throw new DefineAgentMissingError(Spec.name);

    // ── BYOK 预检（与 run() 同逻辑）──
    await this.precheckByok(opts, meta.id);

    // ── Tool Recall（与 run() 同逻辑） ──
    const recall = await this.performToolRecall(meta, opts);
    if (opts.onEvent) {
      try {
        await opts.onEvent({
          type: "tools_recalled",
          agentId: meta.id,
          timestamp: Date.now(),
          payload: {
            recalledIds: recall.recalledIds,
            categories:
              opts.toolRecallHint?.categories ?? meta.toolCategories ?? [],
            source: recall.source,
            preferIds: recall.effectivePreferIds,
          },
        });
      } catch {
        // ignore
      }
    }

    // ── 装配 systemPrompt 增强 block（环境 + 能力目录）──
    const augmentBlocks = await this.collectAugmentBlocks(
      meta,
      opts,
      recall.recalledIds,
      recall.effectivePreferIds,
    );
    const preferredModelSelection = await this.resolvePreferredModel(
      meta,
      opts,
    );

    const { agent, instance, parsedInput } = this.materialize(
      Spec,
      input,
      meta,
      augmentBlocks,
      recall.recalledIds,
      opts.budgetMultiplier,
      opts.userId,
      opts.workspaceId,
      opts.environment,
      opts.loopOverride,
      preferredModelSelection.modelId,
      preferredModelSelection,
    );

    const inputForExec: Record<string, unknown> | string = parsedInput as
      | Record<string, unknown>
      | string;
    const goal =
      instance.buildUserPrompt?.({
        input: parsedInput,
        identity: agent.identity,
      }) ??
      (typeof parsedInput === "string"
        ? parsedInput
        : JSON.stringify(parsedInput));

    // ── BillingContext 包装（嵌套规则同 run()）──
    const existingBilling = BillingContext.get();
    const needsWrap = opts.userId && !existingBilling;

    if (!needsWrap) {
      // 直接 yield —— 外层已经包了 BillingContext 或 不需要
      for await (const ev of agent.execute({
        goal,
        input: inputForExec,
        signal: opts.signal,
      })) {
        if (opts.onEvent) {
          try {
            await opts.onEvent(ev);
          } catch {
            // swallow — 不能拖死 stream
          }
        }
        yield ev;
      }
      return;
    }

    // 需要包 BillingContext —— 用 generator runner 模式
    // ALS.run 不能直接包 async generator，所以把 ALS 上下文绑到一个内部
    // 中转 Promise + Channel 模式过于复杂；这里采用更直接的方案：
    // 用 BillingContext.run 包一个 collector 把所有事件先 push 到 buffer，
    // 然后 yield。但这就退化成了 run() 行为，失去 streaming。
    //
    // 折中：当业务方用 stream() 且需要包 BillingContext 时，建议用 run()。
    // 这里 fallback 为：runner 不包，让 caller 自己包外层。
    this.logger.warn(
      `[${meta.id}] stream() with userId but no outer BillingContext — caller should wrap BillingContext.run() manually for accurate billing`,
    );
    for await (const ev of agent.execute({ goal, input: inputForExec })) {
      if (opts.onEvent) {
        try {
          await opts.onEvent(ev);
        } catch {
          // swallow
        }
      }
      yield ev;
    }
  }

  // ─── private ────────────────────────────────────────────

  /** 跑 agent 事件循环，per-iteration 触发 onEvent，返回汇总。 */
  /**
   * 从 events + state 算出 RunResult 段 2-4 的派生字段。
   *
   * mission-pipeline-runresult-schema.md §3 字段填充时机
   */
  private computeRunMetrics(
    events: readonly IAgentEvent[],
    legacyState: "completed" | "failed" | "cancelled",
    hasOutput: boolean,
  ): {
    exitReason: ExitReason;
    failureCode?: import("../abstractions/agent-event.interface").HarnessFailureCode;
    diagnostic?: Record<string, unknown>;
    recoveryHint?: RunResult["recoveryHint"];
    tokensUsed: { prompt: number; completion: number; total: number };
    costCents: number;
    modelTrail: NonNullable<RunResult["modelTrail"]>;
    toolsUsed: NonNullable<RunResult["toolsUsed"]>;
    toolsCatalogSnapshot: readonly string[];
    state: "completed" | "failed" | "cancelled" | "degraded";
    partialOutput?: unknown;
  } {
    let promptTokens = 0;
    let completionTokens = 0;
    const modelTrail: {
      iter: number;
      modelId: string;
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
    }[] = [];
    const toolsAcc = new Map<
      string,
      { calls: number; totalLatencyMs: number; failures: number }
    >();
    let toolsCatalogSnapshot: readonly string[] = [];
    let lastErrorEvent: IAgentEvent | null = null;
    let lastTerminatedReason: string | null = null;
    let bestPartialOutput: unknown = null;
    let lastValidationCandidate: unknown = null;
    let consecutiveToolFailures: { toolId: string; count: number } | null =
      null;
    let iter = 0;

    for (const ev of events) {
      if (ev.type === "thinking") {
        const p = ev.payload as {
          tokenCount?: number;
          promptTokens?: number;
          completionTokens?: number;
          modelId?: string;
        };
        const explicitPromptTokens =
          typeof p?.promptTokens === "number" ? p.promptTokens : 0;
        const explicitCompletionTokens =
          typeof p?.completionTokens === "number"
            ? p.completionTokens
            : typeof p?.tokenCount === "number"
              ? p.tokenCount
              : 0;
        if (explicitPromptTokens || explicitCompletionTokens) {
          promptTokens += explicitPromptTokens;
          completionTokens += explicitCompletionTokens;
        }
        // modelTrail 不以 token 数为前提：部分 provider 不回 usage（token 全 0），
        // 但 modelId 是前端"模型列"的唯一来源——只要 LLM 跑过就记录。
        if (p?.modelId) {
          modelTrail.push({
            iter,
            modelId: p.modelId,
            promptTokens: explicitPromptTokens,
            completionTokens: explicitCompletionTokens,
            latencyMs: 0,
          });
        }
      } else if (ev.type === "action_executed") {
        iter += 1;
        const r = ev.payload as {
          action?: { kind?: string; toolId?: string };
          subResults?: readonly {
            action?: { toolId?: string };
            error?: { message: string };
            latencyMs?: number;
          }[];
          error?: { message: string };
          latencyMs?: number;
          tokensUsed?: number;
        };
        if (r?.tokensUsed) completionTokens += r.tokensUsed;
        // ★ 2026-06-07 修：parallel_tool_call 的动作无顶层 toolId（只有 calls[]/
        //   subResults[]），原逻辑 `r.action.toolId` 取不到 → 并发搜索全漏计 →
        //   toolsUsed 空 → toolCallCount=0 → 前端"工具调用 0 / Drawer 空"假象
        //   （prod mission 7ddaad2f 实证：researcher 跑了 2-5 次 parallel_tool_call
        //   仍报 tcc=0）。先把本次 action 涉及的工具展开成统一列表，再逐个计数。
        const touched: {
          toolId: string;
          latencyMs: number;
          hasError: boolean;
        }[] = [];
        if (Array.isArray(r?.subResults) && r.subResults.length > 0) {
          for (const sub of r.subResults) {
            const tid = sub?.action?.toolId;
            if (tid)
              touched.push({
                toolId: tid,
                latencyMs: sub?.latencyMs ?? 0,
                hasError: !!sub?.error,
              });
          }
        } else if (r?.action?.toolId) {
          touched.push({
            toolId: r.action.toolId,
            latencyMs: r?.latencyMs ?? 0,
            hasError: !!r?.error,
          });
        }
        // 注意：consecutiveToolFailures 必须在本（非闭包）作用域内赋值，否则
        //   闭包捕获会破坏后续 exitReason 处的类型收窄。
        for (const t of touched) {
          const cur = toolsAcc.get(t.toolId) ?? {
            calls: 0,
            totalLatencyMs: 0,
            failures: 0,
          };
          cur.calls += 1;
          cur.totalLatencyMs += t.latencyMs;
          if (t.hasError) {
            cur.failures += 1;
            // 跟踪连续同 toolId 失败（用于 failed_tool exitReason 推断）
            if (
              consecutiveToolFailures &&
              consecutiveToolFailures.toolId === t.toolId
            ) {
              consecutiveToolFailures.count += 1;
            } else {
              consecutiveToolFailures = { toolId: t.toolId, count: 1 };
            }
          } else if (
            consecutiveToolFailures &&
            consecutiveToolFailures.toolId === t.toolId
          ) {
            // 成功 → 重置该 toolId 计数器
            consecutiveToolFailures = null;
          }
          toolsAcc.set(t.toolId, cur);
        }
      } else if (ev.type === "tools_recalled") {
        const p = ev.payload as { recalledIds?: readonly string[] };
        if (p?.recalledIds) toolsCatalogSnapshot = p.recalledIds;
      } else if (ev.type === "validation_failed") {
        const p = ev.payload as { candidateOutput?: unknown };
        if (p?.candidateOutput !== undefined)
          lastValidationCandidate = p.candidateOutput;
      } else if (ev.type === "output") {
        bestPartialOutput = (ev.payload as { output: unknown }).output;
      } else if (ev.type === "error") {
        lastErrorEvent = ev;
      } else if (ev.type === "terminated") {
        const r = (ev.payload as { reason?: string })?.reason;
        if (r) lastTerminatedReason = r;
      }
    }

    const errPayload =
      (lastErrorEvent?.payload as
        | import("../abstractions/agent-event.interface").IHarnessErrorPayload
        | undefined) ?? undefined;
    const failureCode = errPayload?.failureCode;
    const diagnostic = errPayload?.diagnostic as
      | Record<string, unknown>
      | undefined;
    const recoveryHint = errPayload?.recoveryHint;

    // ─── 推断 ExitReason（mission-pipeline-exit-policy.md §7 映射表）──
    let exitReason: ExitReason = "completed";
    if (legacyState === "cancelled" || lastTerminatedReason === "cancelled") {
      exitReason = "cancelled";
    } else if (failureCode === "LOOP_BUDGET_EXHAUSTED") {
      exitReason = "budget_exhausted";
    } else if (failureCode === "RUNNER_WALL_TIME_EXCEEDED") {
      exitReason = "wall_time_exceeded";
    } else if (failureCode === "LOOP_MAX_ITERATIONS") {
      exitReason = "max_iterations";
    } else if (
      failureCode === "PARSE_MALFORMED_JSON" ||
      failureCode === "PARSE_MISSING_ACTION" ||
      failureCode === "PARSE_UNKNOWN_ACTION_KIND" ||
      failureCode === "PARSE_EMPTY_ACTIONS_ARRAY" ||
      failureCode === "LOOP_REASONING_COT_EXHAUSTION"
    ) {
      exitReason = "failed_parse";
    } else if (
      failureCode === "TOOL_NOT_FOUND" ||
      failureCode === "TOOL_TIMEOUT" ||
      failureCode === "TOOL_RUNTIME_ERROR" ||
      failureCode === "TOOL_INPUT_VALIDATION_FAILED" ||
      (consecutiveToolFailures && consecutiveToolFailures.count >= 3)
    ) {
      exitReason = "failed_tool";
    } else if (
      failureCode === "PROVIDER_API_ERROR" ||
      failureCode === "PROVIDER_BYOK_MODEL_NOT_FOUND" ||
      failureCode === "PROVIDER_RATE_LIMIT"
    ) {
      exitReason = "failed_model";
    } else if (
      failureCode === "LOOP_EMPTY_RESPONSE_IMMEDIATE" ||
      failureCode === "REFLEXION_CONSECUTIVE_EMPTY"
    ) {
      exitReason = "empty_response";
    } else if (
      failureCode === "RUNNER_OUTPUT_SCHEMA_MISMATCH" ||
      failureCode === "REFLEXION_VERIFIER_LOW_SCORE"
    ) {
      exitReason = "validation_rejected_max";
    } else if (legacyState === "failed") {
      exitReason = "failed_parse"; // 兜底，未带 failureCode 时
    }

    // ─── 推断 state（degraded：有 partial 但不算 completed）──
    let state: "completed" | "failed" | "cancelled" | "degraded" = legacyState;
    if (
      legacyState === "completed" &&
      exitReason === "validation_rejected_max"
    ) {
      // 强制接受次优产物 → degraded（仍可用）
      state = "degraded";
    } else if (
      legacyState === "failed" &&
      (bestPartialOutput || lastValidationCandidate) &&
      exitReason !== "cancelled"
    ) {
      // 有 partial 但 finalize 失败：保留 failed 状态但 partialOutput 可用
      // state 不改成 degraded（避免假装"成功"）
    }

    // ★ When the loop exits via max-iterations or budget-exhausted, prefer
    //   lastValidationCandidate (a PARSED finalize object rejected by business
    //   rules) over bestPartialOutput.  For budget-exhausted the loop emits
    //   output{rawAssistantMessage} which would otherwise shadow the candidate.
    //   CRITICAL: do NOT change the priority for any other exit (completed /
    //   wall_time / tool_fail) where bestPartialOutput may be meaningful output.
    const budgetOrMaxIterExit =
      failureCode === "LOOP_BUDGET_EXHAUSTED" ||
      failureCode === "LOOP_MAX_ITERATIONS";
    const partialOutput = !hasOutput
      ? budgetOrMaxIterExit
        ? (lastValidationCandidate ?? bestPartialOutput ?? undefined)
        : (bestPartialOutput ?? lastValidationCandidate ?? undefined)
      : undefined;

    const toolsUsed = Array.from(toolsAcc.entries()).map(([toolId, v]) => ({
      toolId,
      calls: v.calls,
      totalLatencyMs: v.totalLatencyMs,
      failures: v.failures,
    }));

    // ★ P1-1（成本恒 $0 修复）：从 thinking 事件累加真实 costUsd（react-loop 每轮
    //   调用 ModelPricingRegistry.estimateCost 后写入 thinking.payload.costUsd）。
    //   fail-open：未注册模型返回 0，不破坏运行。
    const costUsd = extractRealCostUsd(events);
    const costCents = Math.round(costUsd * 100);

    return {
      exitReason,
      failureCode,
      diagnostic,
      recoveryHint,
      tokensUsed: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      costCents,
      modelTrail,
      toolsUsed,
      toolsCatalogSnapshot,
      state,
      partialOutput,
    };
  }

  private async drainEvents(
    agent: IAgent,
    instance: AgentSpec<z.ZodType, z.ZodType>,
    parsedInput: unknown,
    _meta: DefineAgentOptions,
    onEvent?: (ev: IAgentEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<{
    events: IAgentEvent[];
    state: "completed" | "failed" | "cancelled";
    lastOutput: unknown;
    iterations: number;
  }> {
    const events: IAgentEvent[] = [];
    let state: "completed" | "failed" | "cancelled" = "completed";
    let lastOutput: unknown = null;
    let iterations = 0;

    // ★ 修复 input 序列化双重追加：
    // HarnessedAgent.execute 内部对 task.input 还会做 `${goal}\n\n${stringify(input)}` 拼接。
    // 如果没有 buildUserPrompt，goal 已经是 JSON.stringify(parsedInput)，再传 input 就
    // 会让 LLM 看到同一个 JSON 重复两遍。这里只在有 buildUserPrompt 时才传 input
    // （让 LLM 同时看到业务渲染文本 + 原始结构化数据，有意义）。
    const hasUserPromptBuilder = !!instance.buildUserPrompt;
    const goalText =
      instance.buildUserPrompt?.({
        input: parsedInput,
        identity: agent.identity,
      }) ??
      (typeof parsedInput === "string"
        ? parsedInput
        : JSON.stringify(parsedInput));
    for await (const ev of agent.execute({
      goal: goalText,
      input: hasUserPromptBuilder
        ? (parsedInput as Record<string, unknown> | string)
        : undefined,
      signal,
    })) {
      events.push(ev);
      if (ev.type === "action_executed") iterations += 1;
      if (ev.type === "output") {
        lastOutput = (ev.payload as { output: unknown }).output;
      }
      if (ev.type === "terminated") {
        const reason = (ev.payload as { reason?: string }).reason;
        if (reason === "error") state = "failed";
        else if (reason === "cancelled") state = "cancelled";
      }
      if (onEvent) {
        try {
          await onEvent(ev);
        } catch {
          // swallow — relay 失败不能拖死主流程
        }
      }
    }

    return { events, state, lastOutput, iterations };
  }

  /** BYOK 预检：onMissingByok 策略下检查并 throw / warn / 放行 */
  private async precheckByok(opts: RunOptions, agentId: string): Promise<void> {
    if (!opts.userId || !opts.environment) return;
    const policy = opts.onMissingByok ?? "allow";
    if (policy === "allow") return;
    try {
      const byok = await opts.environment.getByokStatus();
      if (byok === "platform") {
        if (policy === "fail") {
          throw new ByokRequiredError(opts.userId, agentId);
        }
        this.logger.warn(
          `[${agentId}] BYOK missing for user ${opts.userId}; running with platform key (onMissingByok=warn)`,
        );
      }
    } catch (e) {
      if (e instanceof ByokRequiredError) throw e;
      this.logger.warn(
        `[${agentId}] BYOK precheck failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** 收集要追加到 systemPrompt 的 augment block：environment + tool/skill catalog */
  private async collectAugmentBlocks(
    meta: DefineAgentOptions,
    opts: RunOptions,
    recalledToolIds: readonly string[],
    preferIds: readonly string[],
  ): Promise<string[]> {
    const blocks: string[] = [];
    if (opts.environment) {
      const envBlock = await this.buildEnvironmentBlock(opts.environment);
      if (envBlock) blocks.push(envBlock);
    }
    if (opts.exposeCatalog !== false) {
      const catalogBlock = this.buildCatalogBlock(
        recalledToolIds,
        meta.skills,
        preferIds,
      );
      if (catalogBlock) blocks.push(catalogBlock);
    }
    return blocks;
  }

  /**
   * ★ Tool Recall 五步流程（mission-pipeline-tool-recall.md §4）
   *
   *   Step 1. 基础召回：spec.toolCategories ∪ spec.tools（兼容旧 spec.tools 写法）
   *   Step 2. hint.categories 收窄：超出 spec 池的 category 静默丢弃
   *   Step 3. excludeIds 黑名单减去
   *   Step 4. ToolACL 过滤（D13 P1 — 暂留接口，未实现时跳过）
   *   Step 5. preferIds 标 ★（不收窄，仅在 catalog 渲染加注释）
   *
   * 返回 recalledIds（去重）+ effectivePreferIds（裁剪到 recalled 子集）。
   *
   * 任一步骤后召回为空 → 抛 InsufficientToolsError（fail-fast，不进 ReActLoop）。
   */
  private async performToolRecall(
    meta: DefineAgentOptions,
    opts: RunOptions,
  ): Promise<{
    recalledIds: readonly string[];
    effectivePreferIds: readonly string[];
    source: "spec" | "hint" | "spec+hint";
  }> {
    if (!this.toolRegistry) {
      return { recalledIds: [], effectivePreferIds: [], source: "spec" };
    }

    const declaredCategories = meta.toolCategories ?? [];
    const declaredIds = meta.tools ?? [];
    const hint = opts.toolRecallHint;

    // Step 1. 基础召回
    const baseSet = new Set<string>();
    if (declaredCategories.length > 0) {
      const tools = this.toolRegistry.listByCategory(declaredCategories);
      for (const t of tools) baseSet.add(t.id);
    }
    for (const id of declaredIds) {
      if (this.toolRegistry.isAvailable(id)) baseSet.add(id);
    }

    // Step 2. hint.categories 收窄
    //   实践中 spec.toolCategories 通常是粗粒度（如 ['information']），
    //   而 Leader 的 hint.categories 倾向用细粒度（如 ['academic', 'community']）。
    //   先按 ToolCategory 匹配；匹配不上时回退用 tool.tags 来匹配，让 Leader 提示
    //   能真正起到收窄作用而不是静默失效。
    let pool = Array.from(baseSet);
    if (hint?.categories && hint.categories.length > 0) {
      const allowedCats = new Set<string>(declaredCategories);
      const hintCatsValid = hint.categories.filter((c) => allowedCats.has(c));
      if (hintCatsValid.length > 0) {
        // ─ 路径 A：hint.categories 命中 spec.toolCategories ─
        const hintRecall = this.toolRegistry.listByCategory(hintCatsValid);
        const hintIds = new Set(hintRecall.map((t) => t.id));
        pool = pool.filter((id) => hintIds.has(id) || declaredIds.includes(id));
      } else {
        // ─ 路径 B：fallback 用 tool.tags 做 sub-category 匹配 ─
        // 规则：
        //   ① tool 声明了 tags 且与 hint 相交 → 入选（明确匹配）
        //   ② tool 没声明 tags → 入选（视为 "通用工具"，如 web-search 类不应因
        //      Leader 给了 academic hint 就被踢出）
        //   ③ tool 声明了 tags 但与 hint 不相交 → 排除（明确不匹配）
        const hintTagSet = new Set(hint.categories.map((c) => c.toLowerCase()));
        const refinedPool: string[] = [];
        for (const id of pool) {
          const t = this.toolRegistry.tryGet(id);
          const tags = t?.tags;
          if (!tags || tags.length === 0) {
            refinedPool.push(id); // 通用工具兜底
          } else if (tags.some((tg) => hintTagSet.has(tg.toLowerCase()))) {
            refinedPool.push(id); // 明确匹配
          }
          // 否则：明确不匹配，排除
        }
        // 不要让收窄后比 declaredIds 还少 —— 至少保 declaredIds 兜底
        const refined = new Set(refinedPool);
        for (const id of declaredIds) refined.add(id);
        const refinedArr = Array.from(refined);
        // 至少保留 1 个工具，避免误删整池
        if (refinedArr.length > 0) {
          pool = refinedArr;
        }
        // 标签也匹配不上 → 静默放弃 hint 收窄（保持基础池）
      }
    }

    // Step 3. excludeIds
    if (hint?.excludeIds && hint.excludeIds.length > 0) {
      const exclude = new Set<string>(hint.excludeIds);
      pool = pool.filter((id) => !exclude.has(id));
    }

    // Step 4. ToolACL（D13）—— 用户 entitlements 过滤
    //
    // ★ 双重防御策略（PR2，2026-05-01）：
    //   - 召回阶段（这里）= UI/上下文过滤：让 LLM 看不到无权限工具，避免幻觉调用
    //   - 运行时拦截 = PermissionMiddleware.before() 的 entitlement check：
    //     即便 LLM 选了无权工具，pipeline 也会 fail-closed 拒绝
    //   保留这一层是因为：
    //     1. 让 LLM tool list 干净（不暴露用户买不到的能力）
    //     2. agent-runner 之外的调用路径（直接 toolRegistry.tryGet().execute()）
    //        不一定都进 ToolPipeline，召回阶段是兜底
    //   单一真相源仍是 PermissionMiddleware；本层仅作 UX/防御加固
    if (opts.environment && pool.length > 0) {
      try {
        const ents = (await (
          opts.environment as unknown as {
            getUserEntitlements?: () => Promise<{ keys: string[] }>;
          }
        ).getUserEntitlements?.()) ?? { keys: [] };
        const allowed: string[] = [];
        for (const id of pool) {
          const tool = this.toolRegistry.tryGet(id);
          const required = tool?.requiredEntitlements;
          if (!required || required.length === 0) {
            allowed.push(id);
            continue;
          }
          if (required.every((req) => ents.keys.includes(req))) {
            allowed.push(id);
          }
        }
        pool = allowed;
      } catch {
        // entitlement 查询失败 → fail-closed：删掉所有需要 entitlement 的工具
        pool = pool.filter((id) => {
          const tool = this.toolRegistry!.tryGet(id);
          return !tool?.requiredEntitlements?.length;
        });
      }
    }

    // Step 5. preferIds 裁剪到 recalled 子集
    const recalledSet = new Set(pool);
    const effectivePreferIds = (hint?.preferIds ?? []).filter((id) =>
      recalledSet.has(id),
    );

    // ★ Phase P18-2: 降级策略 — pool 空时尝试 fallback 到 spec 全集（不要 fail-fast）
    if (
      pool.length === 0 &&
      (declaredCategories.length > 0 || declaredIds.length > 0)
    ) {
      // 1) 尝试丢掉 hint 收窄，用 baseSet
      if (baseSet.size > 0) {
        this.logger.warn(
          `[${meta.id}] hint 收窄后池为空，回退到 spec 全集（baseSet=${baseSet.size}）`,
        );
        pool = Array.from(baseSet);
      } else {
        throw new InsufficientToolsError(meta.id, {
          declaredCategories,
          declaredIds,
          hint,
        });
      }
    }

    // Step 6. least-privilege（M1 fix）—— spec.forbiddenTools（agent 级 denylist）过滤。
    //   放在 P18-2 fallback 之后，确保 fallback 也不会把禁用工具放回召回池。
    //   召回池同时驱动 <available_tools> catalog + identity.tools，故 prompt-driven
    //   路径（默认，HARNESS_REACT_NATIVE_FC OFF）的 LLM 也看不到、选不到禁用工具。
    //   （react-loop.filterVisibleTools 只在 native-FC 分支前置过滤，覆盖不到这条路径。）
    //   注：subagent 的 allowedTools 白名单已由 spawner 的 filterInheritedTools 反映进
    //   meta.tools（= 召回 declaredIds），故此处只需再应用 forbiddenTools。
    const forbiddenTools = meta.forbiddenTools;
    if (forbiddenTools && forbiddenTools.length > 0) {
      pool = pool.filter((id) => !forbiddenTools.includes(id));
    }
    const finalSet = new Set(pool);
    const finalPreferIds = effectivePreferIds.filter((id) => finalSet.has(id));

    const source: "spec" | "hint" | "spec+hint" = hint
      ? declaredCategories.length > 0 || declaredIds.length > 0
        ? "spec+hint"
        : "hint"
      : "spec";

    return { recalledIds: pool, effectivePreferIds: finalPreferIds, source };
  }

  /**
   * <environment> block — Harness 自动注入到 systemPrompt。
   * Agent 不需要自己查 BYOK / 余额 / 模型池。
   */
  private async buildEnvironmentBlock(
    env: IRuntimeEnvironment,
  ): Promise<string | null> {
    try {
      const [byok, credit, models] = await Promise.all([
        env.getByokStatus().catch(() => null),
        env.getCreditState().catch(() => null),
        env.listAvailableModels().catch(() => null),
      ]);
      const lines: string[] = ["<environment>"];
      if (byok) {
        lines.push(
          `- byok: ${byok}  (personal=user-key / assigned=admin-assigned / platform=fallback)`,
        );
      }
      if (credit) {
        lines.push(
          `- credits: balance=${credit.balance} soft=${credit.softLimit ?? "—"} hard=${credit.hardLimit ?? "—"}${credit.currency ? ` ${credit.currency}` : ""}`,
        );
      }
      if (models && models.length > 0) {
        const healthy = models.filter((m) => m.available);
        const sample = healthy
          .slice(0, 8)
          .map((m) => m.modelId)
          .join(", ");
        lines.push(
          `- models: ${healthy.length}/${models.length} available — ${sample}${healthy.length > 8 ? ", …" : ""}`,
        );
      }
      lines.push("</environment>");
      return lines.length > 2 ? lines.join("\n") : null;
    } catch (e) {
      this.logger.warn(
        `buildEnvironmentBlock failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * <available_tools> + <available_skills> block —
   *
   *  - tools 来自 Tool Recall 五步流程（performToolRecall），不再读 spec.tools
   *  - preferIds 在条目末尾追加 ★ recommended 标注，弱引导 LLM 但不强制
   */
  private buildCatalogBlock(
    recalledToolIds: readonly string[],
    declaredSkills?: readonly string[],
    preferIds: readonly string[] = [],
  ): string | null {
    const blocks: string[] = [];
    if (recalledToolIds.length > 0 && this.toolRegistry) {
      const lines: string[] = ["<available_tools>"];
      const preferred = new Set(preferIds);
      for (const id of recalledToolIds) {
        const def = this.toolRegistry.tryGet(id);
        const desc = def?.description?.trim();
        const star = preferred.has(id) ? " ★ recommended" : "";
        lines.push(`- ${id}${star}${desc ? `: ${desc}` : ""}`);
        if (def?.inputSchema) {
          const summary = this.summarizeJsonSchemaForLlm(def.inputSchema);
          if (summary) {
            lines.push(`  input: ${summary}`);
            // ★ 关键：给一个**完整 action 包装**示例。
            //
            // 历史 bug：之前只暴露 input shape，LLM 知道字段名/类型，但**不知道
            // 怎么把 input 包装到 ReAct action 协议里**。生产 trace 显示 LLM
            // 把多个 tool input **裸列**为 NDJSON 输出（没 toolId / 没 kind 包装）：
            //   {"query":"...","numResults":10}
            //   {"url":"...","extractMainContent":true}
            // 上层 parseDecision 拿到首个对象 → 没 action 字段 →
            // InvalidActionError → schema mismatch → mission 失败。
            //
            // 现在给一个具象的 invocation example，让 LLM 一眼看出 action 协议：
            //   {"kind":"tool_call","toolId":"web-search","input":{...}}
            const exampleInput = this.buildExampleInputForSchema(
              def.inputSchema,
            );
            lines.push(
              `  example: {"kind":"tool_call","toolId":"${id}","input":${exampleInput}}`,
            );
          }
        }
      }
      lines.push(
        '  // To call multiple tools in one turn, wrap them: {"kind":"parallel_tool_call","calls":[{"toolId":"...","input":{...}},...]}',
      );
      lines.push("</available_tools>");
      blocks.push(lines.join("\n"));
    }
    if (declaredSkills && declaredSkills.length > 0 && this.skillRegistry) {
      const lines: string[] = ["<available_skills>"];
      for (const id of declaredSkills) {
        const def = this.skillRegistry.get(id);
        const desc = def?.frontmatter?.description?.trim();
        lines.push(`- ${id}${desc ? `: ${desc}` : ""}`);
        // ★ 同 tool catalog 的修复：给完整 invocation example，让 LLM 看到
        // skill_invoke action 协议长啥样，不再误以为只能写 finalize。
        // skill 没有强类型 inputSchema（markdown 模板，input 是自由 K-V），
        // example 用 task-specific 占位，让 LLM 按业务情境填。
        lines.push(
          `  example: {"kind":"skill_invoke","skillId":"${id}","input":{"task":"<task-specific data>"}}`,
        );
      }
      lines.push("</available_skills>");
      blocks.push(lines.join("\n"));
    }
    return blocks.length > 0 ? blocks.join("\n\n") : null;
  }

  /**
   * 为 tool inputSchema 生成一个 LLM 可直接照搬的具象 example input。
   *
   * 仅生成必填字段，每个字段填一个**类型相符的占位值**：
   *   { "query": "<your search query>", "numResults": 5 }
   *
   * 让 LLM 看到完整 action 包装："{"kind":"tool_call","toolId":"web-search","input":{...}}"
   * 后能直接照样替换占位值，不再裸列 input。
   */
  private buildExampleInputForSchema(
    schema: import("../../../ai-engine/tools/abstractions/tool.interface").JSONSchema,
  ): string {
    if (!schema || schema.type !== "object" || !schema.properties) return "{}";
    const required = new Set(schema.required ?? []);
    const parts: string[] = [];
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (!sub || typeof sub !== "object") continue;
      if (!required.has(key)) continue; // example 只填必填
      const subType = sub.type ?? "string";
      let placeholder: string;
      if (
        Array.isArray(subType)
          ? subType.includes("string")
          : subType === "string"
      ) {
        placeholder = `"<${key}>"`;
      } else if (subType === "number" || subType === "integer") {
        placeholder = "0";
      } else if (subType === "boolean") {
        placeholder = "false";
      } else if (subType === "array") {
        placeholder = "[]";
      } else if (subType === "object") {
        placeholder = "{}";
      } else {
        placeholder = "null";
      }
      parts.push(`"${key}":${placeholder}`);
    }
    return parts.length === 0 ? "{}" : `{${parts.join(",")}}`;
  }

  /**
   * 把 tool 的 JSONSchema 浓缩成 LLM 可读的一行摘要：
   *
   * 输入 schema: { type:"object", properties: {query: {type:"string", description:"搜索查询词"}, maxResults: {type:"number", description:"返回数量，默认 5"}}, required:["query"] }
   * 输出: '{"query": "string (搜索查询词)", "maxResults?": "number (返回数量，默认 5)"}'
   *
   * 设计原则：
   * - 只输出 top-level properties（嵌套 schema 太大会撑爆 system prompt）
   * - 必填字段不带 ?，可选字段 key 后加 ?
   * - 类型 + description 拼在一起，让 LLM 一眼能填
   */
  private summarizeJsonSchemaForLlm(
    schema: import("../../../ai-engine/tools/abstractions/tool.interface").JSONSchema,
  ): string | null {
    if (!schema || schema.type !== "object" || !schema.properties) return null;
    const required = new Set(schema.required ?? []);
    const parts: string[] = [];
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (!sub || typeof sub !== "object") continue;
      const isRequired = required.has(key);
      const keyLabel = isRequired ? key : `${key}?`;
      const subType = sub.type ?? "any";
      const desc = (sub.description ?? "").trim();
      const typeStr = Array.isArray(subType) ? subType.join("|") : subType;
      const valueStr = desc ? `${typeStr} (${desc})` : typeStr;
      parts.push(`"${keyLabel}": "${valueStr}"`);
    }
    if (parts.length === 0) return null;
    return `{${parts.join(", ")}}`;
  }

  private materialize<T extends new () => AgentSpec<z.ZodType, z.ZodType>>(
    Spec: T,
    input: unknown,
    meta: DefineAgentOptions,
    augmentBlocks: readonly string[],
    /** ★ Tool Recall 五步流程的产物，用作 identity.tools；不再读 meta.tools */
    recalledToolIds: readonly string[],
    budgetMultiplier?: number,
    /** ★ Critical: 这三个是从 RunOptions 透传到 envelope 的运行时环境信息。
     *  缺失会导致 envelope.memory.userId=undefined（BYOK 解析断链）+
     *  envelope.runtimeEnv=undefined（ReActLoop 的 model 可用性环境感知永远跳过）。 */
    userId?: string,
    workspaceId?: string,
    runtimeEnv?: IRuntimeEnvironment,
    /** ★ Phase P1-3: loop 覆盖（thorough+ 档位切 reflexion） */
    loopOverride?: import("../abstractions").AgentLoopKind,
    preferredModelId?: string,
    preferredModelSelection?: {
      missionId?: string;
      reservation?: MissionElectionReservation;
    },
  ): {
    agent: IAgent;
    instance: AgentSpec<z.ZodType, z.ZodType>;
    parsedInput: unknown;
  } {
    const instance = new Spec();

    // 1. Validate input
    let parsedInput: unknown = input;
    if (meta.inputSchema) {
      const parsed = meta.inputSchema.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new InputValidationError(meta.id, issues);
      }
      parsedInput = parsed.data;
    }

    // 2. Build identity（按 budgetMultiplier 缩放 budget.maxTokens / maxIterations）
    const identity = this.buildIdentity(
      meta,
      recalledToolIds,
      budgetMultiplier,
    );

    // 3. Compose IAgentSpec for factory
    // 自动把 outputSchema 形状 + Harness 自动注入的环境/能力 block 拼到 systemPrompt
    const schemaBlock = describeOutputSchemaForLlm(meta.outputSchema);
    const augmentTail =
      augmentBlocks.length > 0 ? augmentBlocks.join("\n\n") : null;
    const appendBlocks = (base: string | undefined): string | undefined => {
      const b = (base ?? "").trim();
      const parts: string[] = [];
      if (b) parts.push(b);
      if (schemaBlock) parts.push(schemaBlock);
      if (augmentTail) parts.push(augmentTail);
      return parts.length > 0 ? parts.join("\n\n") : base;
    };
    // ★ double-append fix: buildSystemPromptFn 只返回业务 prompt 原文，不在内部
    // append schema/augmentTail。agentSpec.systemPrompt 那一处统一 append 一次。
    // 之前两处都调 appendBlocks 导致 schemaBlock + augmentTail 在 envelope.system
    // 里出现 2 遍 → LLM 看到协议/catalog 重复，reasoning model 易 confused。
    const buildSystemPromptFn = instance.buildSystemPrompt
      ? (ctx: { input: unknown; identity: IAgentIdentity }) =>
          instance.buildSystemPrompt!({
            input: ctx.input as never,
            identity: ctx.identity,
          })
      : undefined;
    const buildUserPromptFn = instance.buildUserPrompt
      ? (ctx: { input: unknown; identity: IAgentIdentity }) =>
          instance.buildUserPrompt!({
            input: ctx.input as never,
            identity: ctx.identity,
          })
      : undefined;
    const validateFn = instance.validateBusinessRules
      ? (output: unknown, ctx: { input: unknown; identity: IAgentIdentity }) =>
          instance.validateBusinessRules!(output as never, {
            input: ctx.input as never,
            identity: ctx.identity,
          })
      : undefined;
    const stubFn = instance.stubFn
      ? (ctx: { input: unknown; identity: IAgentIdentity }) =>
          instance.stubFn!({
            input: ctx.input as never,
            identity: ctx.identity,
          }) as Promise<unknown>
      : undefined;

    // 2026-05-13: 把 parsedInput 中的 mission-scoped 字段（searchTimeRange / language / missionId）
    // 抽到 spec.metadata，agent-factory 注入 envelope.metadata → tool-invoker 透传到
    // ToolContext.metadata。search 类 tool 的 resolveEffectiveTimeRange() 就有 mission 兜底。
    const envelopeMetadata = buildEnvelopeMetadataFromInput(parsedInput);

    const agentSpec: IAgentSpec = {
      identity,
      loop: loopOverride ?? meta.loop,
      systemPrompt: appendBlocks(
        meta.systemPrompt ??
          (buildSystemPromptFn
            ? buildSystemPromptFn({ input: parsedInput, identity })
            : undefined),
      ),
      taskProfile: meta.taskProfile,
      outputSchema: meta.outputSchema,
      outputJsonSchema: meta.outputJsonSchema,
      // P1a/P1b: delimited finalize transport hints (env-gated).
      finalizeProseFields: meta.finalizeProseFields,
      finalizeNdjsonArrayField: meta.finalizeNdjsonArrayField,
      validateBusinessRules: validateFn,
      stubFn,
      buildSystemPrompt: buildSystemPromptFn,
      buildUserPrompt: buildUserPromptFn,
      // ★ 关键透传 —— factory 用这些 build envelope.memory + envelope.runtimeEnv，
      //   ReActLoop 才能：
      //   (a) chat({ userId }) 命中用户 BYOK 默认模型 / API key
      //   (b) 调 envelope.runtimeEnv.getModelAvailability() 做环境感知 fallback
      //   (c) 调 envelope.runtimeEnv.suggestFallback() 做 budget 耗尽时的降级建议
      userId,
      workspaceId,
      runtimeEnv,
      metadata: envelopeMetadata,
    };

    const agent = this.factory.create(
      agentSpec,
      preferredModelId,
      preferredModelSelection,
    );
    return { agent, instance, parsedInput };
  }

  private async resolvePreferredModel(
    meta: DefineAgentOptions,
    opts: RunOptions,
  ): Promise<{
    modelId?: string;
    missionId?: string;
    reservation?: { token: string; modelId: string; createdAt: number };
  }> {
    if (opts.preferredModelId) return { modelId: opts.preferredModelId };
    const envSnapshot = await opts.environment?.getEnvironmentSnapshot?.();
    if (typeof this.factory.electPreferredModelSelection !== "function") {
      return {};
    }
    return this.factory.electPreferredModelSelection({
      roleId:
        typeof meta.identity.role === "string"
          ? meta.identity.role
          : meta.identity.role.id,
      taskProfile: meta.taskProfile,
      userId: opts.userId,
      envSnapshot,
    });
  }

  private buildIdentity(
    meta: DefineAgentOptions,
    recalledToolIds: readonly string[],
    budgetMultiplier = 1.0,
  ): IAgentIdentity {
    const mult = Math.max(0.1, budgetMultiplier);
    const scale = (n: number | undefined): number | undefined =>
      n == null ? undefined : Math.round(n * mult);
    // ReAct loop 实践中 prompt 通常有 search → scrape → finalize 多步工作流，
    // 仅 3 次迭代时 LLM 还在 gather 阶段就 RUNNER_LOOP_LIMIT。所以下限是
    // 结构最小 (3)，但不要超过 spec 声明的 base —— 即低成本档 ≈ base，
    // 高成本档不再额外加（已经满足）。
    //
    // ★ Phase P1 fix (2026-04-29 mission 8c7b4358 case)：maxIterationsHardCap 是
    //   spec 声明的"决策边界绝对硬上限"，不被 multiplier 放大。
    //   budgetMultiplier 7.28× 把 base 5 轮变 36 轮 → LLM 拥有过多 round 永远不 finalize。
    //   spec 显式声明 maxIterationsHardCap 后，scaleIters 把缩放后的值再 clamp 到上限。
    const hardCap = meta.budget?.maxIterationsHardCap;
    const scaleIters = (n: number | undefined): number | undefined => {
      if (n == null) return undefined;
      const structuralMin = Math.min(n, 5);
      const scaled = Math.max(structuralMin, Math.round(n * mult));
      return hardCap != null ? Math.min(scaled, hardCap) : scaled;
    };
    const id = meta.identity;
    // Detect already-complete IAgentIdentity (has .role.id with name)
    const isFull =
      typeof (id as IAgentIdentity).role === "object" &&
      typeof ((id as IAgentIdentity).role as { id?: string }).id === "string";
    // ★ identity.tools = recalledToolIds（Tool Recall 五步流程的产物）。
    //   recalledToolIds 为空时不写入（让 full.tools 兜底，老 spec 兼容）。
    const toolsForIdentity =
      recalledToolIds.length > 0 ? Array.from(recalledToolIds) : undefined;
    if (isFull) {
      const full = id as IAgentIdentity;
      return new AgentIdentity({
        ...full,
        tools: toolsForIdentity ?? full.tools,
        forbiddenTools: meta.forbiddenTools ?? full.forbiddenTools,
        skills: meta.skills ?? full.skills,
        constraints: {
          ...full.constraints,
          maxTokens:
            scale(meta.budget?.maxTokens) ?? full.constraints?.maxTokens,
          maxIterations:
            scaleIters(meta.budget?.maxIterations) ??
            full.constraints?.maxIterations,
          maxWallTimeMs:
            scale(meta.budget?.maxWallTimeMs) ??
            full.constraints?.maxWallTimeMs,
          requireToolBeforeFinalize:
            meta.requireToolBeforeFinalize ??
            full.constraints?.requireToolBeforeFinalize,
        },
      });
    }
    // Shorthand path
    const sh = id as {
      role: string | { id: string; name: string; description?: string };
      persona?: IAgentIdentity["persona"];
      description?: string;
    };
    const role =
      typeof sh.role === "string"
        ? {
            id: sh.role,
            name: sh.role,
            description: sh.description ?? "",
          }
        : { ...sh.role, description: sh.role.description ?? "" };
    return new AgentIdentity({
      role,
      persona: sh.persona,
      tools: toolsForIdentity,
      forbiddenTools: meta.forbiddenTools,
      skills: meta.skills,
      constraints: {
        maxTokens: scale(meta.budget?.maxTokens),
        maxIterations: scaleIters(meta.budget?.maxIterations),
        maxWallTimeMs: scale(meta.budget?.maxWallTimeMs),
        requireToolBeforeFinalize: meta.requireToolBeforeFinalize,
      },
    });
  }
}

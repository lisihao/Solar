/**
 * LlmExecutor — L2 Agent 运行时的 LLM 调用原语
 *
 * 职责：
 * - 调 AiChatService 获取 LLM 原始输出
 * - 若 spec 提供 outputSchema，走 Zod safeParse；失败则 error-fed retry（最多 N 轮）
 * - 若 spec 提供 validateBusinessRules，Zod 成功后调用；抛错同 Zod 失败处理
 * - 返回强类型 TOutput + tokens/cost/model/retries
 *
 * 目标架构定位（docs/architecture/ai-harness/redesign/11-target-architecture.md）：
 * 本类是 L2 Agent 运行时的一等公民，所有 AI App 通过 AgentFactory 创建 Agent 时共用。
 * 原 L3 ai-app/{app}/harness/llm/LlmInvokerService 将在 P3 删除（能力全部上提至此）。
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type { z } from "zod";
import { ModelPricingRegistry } from "../../../ai-engine/llm/models/pricing/model-pricing.registry";
import { StructuredOutputRouter } from "../../../ai-engine/llm/output/structured/structured-output-router.service";
import type { StructuredOutputStrategy } from "../../../ai-engine/llm/output/structured/structured-output-strategy.types";
import { AiModelConfigService } from "../../../ai-engine/llm/models/config/ai-model-config.service";
// ★ 直接相对路径导入，绕开 facade barrel。
// 原因：facade/index.ts 是 L3 AI App 的单向入口；L2 harness 内部代码
// 若也从 facade 导入，会触发 barrel → 众多子模块 → harness 的回环加载，
// 导致 TypeScript 在 module evaluation 阶段产生 `undefined` 类 reference，
// Nest DI 随后报 "LlmExecutor dependency at index [0]"。
// 参考 8ac343b98（agent-factory / spec-based-agent 已同此修复）。
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { MissionContext } from "../../../../common/context/mission-context";
import type { TaskProfile } from "../../../ai-engine/llm/types/task-profile.types";
import { AIModelType } from "@prisma/client";
// 分类器源头已下沉到 L2 ai-engine（model-failover.classifier.ts），让 L2
// AiChatService.chat() 与 L2.5 runner 共用同一份判定逻辑。本文件内部仍使用这两个
// 符号，故 import 进来；同时 re-export 保持既有 `from "../executor/llm-executor"`
// 的 import 不破坏（react-loop.ts / runner/loop/model-failover.util.ts / 测试 等）。
import {
  isModelLevelFailoverError,
  MAX_MODEL_FAILOVERS,
} from "../../../ai-engine/llm/models/selection/model-failover.classifier";

// ============ Model-level failover ============

export { isModelLevelFailoverError, MAX_MODEL_FAILOVERS };

// ============ 契约 ============

export interface LlmExecutorInput<TOutput> {
  /** Agent id / operation 名，用于日志和 observability */
  readonly agentId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;

  /** Zod schema；未提供则跳过校验，直接 JSON parse 后返回 unknown */
  readonly outputSchema?: z.ZodType<TOutput>;
  /** 业务规则校验钩子，在 Zod 成功后调用；throw 触发 retry */
  readonly validateBusinessRules?: (output: TOutput) => void;

  readonly taskProfile: TaskProfile;

  /**
   * 显式指定 modelId 覆盖环境感知选举。
   * 正常路径：SpecBasedAgent 调用 ModelElectionService.elect() 拿到 modelId
   * 后从这里传进来；LlmExecutor 再原样透给 AiChatService.chat({ model })。
   *
   * 为空时：AiChatService 走它自己的 modelType → DB 默认链路（单元测试兼容）。
   */
  readonly model?: string;

  /** Schema 失败最大重试次数，默认 2（首次 + 2 次修正 = 3 轮） */
  readonly maxRetries?: number;

  readonly signal?: AbortSignal;
  readonly userId?: string;
  /** MissionContext 自动透传；若显式提供覆盖 */
  readonly processId?: string;
  readonly operationName?: string;

  /**
   * ★ v2 stub 模式（P1-4）：
   * 设置时**绕过 LLM 调用**，直接同步产出占位数据走 Zod + business-rule 校验。
   * 结合环境变量 AI_ENGINE_AGENT_STUB=1 激活：
   *   - env 设为 "1" + spec 提供 stubFn → 绕过 LLM，调 stubFn
   *   - env 设为 "1" + 无 stubFn → 抛 StubNotConfiguredError
   *   - env 未设/= "0" → 正常 LLM 流程（stubFn 被忽略）
   * 用途：测试环境零 LLM 成本跑完整 pipeline；CI 不 flaky。
   */
  readonly stubFn?: () => Promise<TOutput>;

  /**
   * Model-level failover provider (optional).
   *
   * When provided, a provider-API error (5xx / model-not-found / timeout /
   * AllKeysFailed) triggers re-election via this callback instead of
   * propagating the error immediately.  The callback receives the set of
   * modelIds that have already failed so the election service can exclude them
   * and pick a different model.  Returns the new modelId, or null/undefined
   * if no further candidates are available (in which case the last error is
   * re-thrown).
   *
   * SpecBasedAgent supplies this closure when it has an electionProvider wired.
   * When absent (tests, legacy callers) the behaviour is unchanged: provider
   * errors propagate as before.
   */
  readonly modelFailoverProvider?: (
    excludeModelIds: ReadonlyArray<string>,
    excludeProviders?: ReadonlyArray<string>,
  ) => Promise<string | null | undefined>;
}

export interface LlmExecutorResult<TOutput> {
  readonly output: TOutput;
  readonly tokensUsed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
  readonly costUsd: number;
  readonly retries: number;
}

export class SchemaRetryExhaustedError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly attempts: number,
    public readonly lastError: string,
  ) {
    super(
      `[${agentId}] LLM output failed schema validation after ${attempts} attempts. Last error: ${lastError}`,
    );
    this.name = "SchemaRetryExhaustedError";
  }
}

export class StubNotConfiguredError extends Error {
  constructor(agentId: string) {
    super(
      `[${agentId}] AI_ENGINE_AGENT_STUB=1 set but spec has no stubFn — cannot stub`,
    );
    this.name = "StubNotConfiguredError";
  }
}

/**
 * 全局 stub 模式开关：env 变量 AI_ENGINE_AGENT_STUB=1 时所有 spec 带 stubFn 的 agent
 * 绕过 LLM，直接走 stub。测试友好；禁止用于生产。
 *
 * 生产防护：NODE_ENV === "production" 时强制禁用，防止运维误设该变量后
 * 所有 agent 静默返回 stub 数据而报警盲区。
 */
export function isStubModeEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.AI_ENGINE_AGENT_STUB === "1";
}

// ============ 工具：Zod → JSON Schema 转换（最小实现，不依赖 zod-to-json-schema） ============

/**
 * 把常用 Zod schema 转成 JSON Schema 对象（供 native structured output API 使用）。
 * 覆盖：ZodObject / ZodArray / ZodString / ZodNumber / ZodBoolean / ZodEnum /
 *       ZodOptional / ZodNullable / ZodDefault / ZodUnion / ZodLiteral / ZodAny.
 * 复杂 schema（ZodDiscriminatedUnion / ZodIntersection 等）退化为 { type: "object" }。
 */
export function zodToJsonSchema(
  schema: import("zod").ZodTypeAny,
  depth = 0,
): Record<string, unknown> {
  if (depth > 8) return {};
  const def = schema._def as { typeName?: string };
  const typeName = def.typeName;

  // Strip wrappers
  if (typeName === "ZodOptional") {
    return zodToJsonSchema(
      (schema as import("zod").ZodOptional<import("zod").ZodTypeAny>).unwrap(),
      depth,
    );
  }
  if (typeName === "ZodNullable") {
    const inner = zodToJsonSchema(
      (schema as import("zod").ZodNullable<import("zod").ZodTypeAny>).unwrap(),
      depth,
    );
    const t = inner.type;
    return { ...inner, type: t ? [t, "null"] : ["null"] };
  }
  if (typeName === "ZodDefault") {
    return zodToJsonSchema(
      (
        schema as import("zod").ZodDefault<import("zod").ZodTypeAny>
      ).removeDefault(),
      depth,
    );
  }

  if (typeName === "ZodString") return { type: "string" };
  if (typeName === "ZodNumber") return { type: "number" };
  if (typeName === "ZodBoolean") return { type: "boolean" };
  if (typeName === "ZodNull") return { type: "null" };
  if (typeName === "ZodAny" || typeName === "ZodUnknown") return {};
  if (typeName === "ZodLiteral") {
    const v = (schema as import("zod").ZodLiteral<unknown>)._def.value;
    return { const: v };
  }
  if (typeName === "ZodEnum") {
    const values = (schema as import("zod").ZodEnum<[string, ...string[]]>)
      .options;
    return { type: "string", enum: values };
  }
  if (typeName === "ZodUnion") {
    const opts = (
      schema as import("zod").ZodUnion<
        [import("zod").ZodTypeAny, ...import("zod").ZodTypeAny[]]
      >
    ).options;
    return {
      anyOf: opts.map((o: import("zod").ZodTypeAny) =>
        zodToJsonSchema(o, depth + 1),
      ),
    };
  }
  if (typeName === "ZodArray") {
    const el = (schema as import("zod").ZodArray<import("zod").ZodTypeAny>)
      .element;
    return { type: "array", items: zodToJsonSchema(el, depth + 1) };
  }
  if (typeName === "ZodObject") {
    const shape = (schema as import("zod").ZodObject<import("zod").ZodRawShape>)
      .shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(shape)) {
      const childDef = child._def as {
        typeName?: string;
      };
      properties[key] = zodToJsonSchema(child, depth + 1);
      if (
        childDef.typeName !== "ZodOptional" &&
        childDef.typeName !== "ZodDefault"
      ) {
        required.push(key);
      }
    }
    const result: Record<string, unknown> = { type: "object", properties };
    if (required.length > 0) result.required = required;
    result.additionalProperties = false;
    return result;
  }
  if (typeName === "ZodRecord") {
    return { type: "object", additionalProperties: true };
  }
  // Fallback for unsupported types
  return {};
}

// ============ 工具：JSON 提取 ============

/**
 * 从 LLM 原始 content 提取 JSON object。支持：
 * - 纯 JSON `{...}`
 * - 带 ```json fence 的代码块
 * - 前后有解释文字的混合输出（按第一个 `{...}` 的平衡括号提取）
 */
export function extractJsonFromLlmContent(content: string): unknown {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return JSON.parse(fenceMatch[1].trim());
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  const start = trimmed.indexOf("{");
  if (start === -1) {
    throw new Error(
      `LLM output contains no JSON object (preview: ${trimmed.slice(0, 200)})`,
    );
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error(
    `LLM output has unmatched braces (preview: ${trimmed.slice(0, 200)})`,
  );
}

// ============ æœåŠ¡ ============

@Injectable()
export class LlmExecutor {
  private readonly logger = new Logger(LlmExecutor.name);

  constructor(
    private readonly aiChatService: AiChatService,
    @Optional() private readonly pricingRegistry?: ModelPricingRegistry,
    @Optional() private readonly outputRouter?: StructuredOutputRouter,
    @Optional() private readonly modelConfigService?: AiModelConfigService,
  ) {}

  /**
   * 解析 model 应使用的 structured-output strategy 链。
   * 缺 router/modelConfigService 时返 ['prompt']（最低兜底）。
   */
  private async resolveOutputStrategyChain(
    modelId: string | undefined,
  ): Promise<readonly StructuredOutputStrategy[]> {
    if (!modelId || !this.outputRouter) return ["prompt"];
    try {
      const cfg = this.modelConfigService
        ? await this.modelConfigService.getModelConfig(modelId)
        : null;
      return this.outputRouter.resolveChain({
        provider: cfg?.provider ?? modelId,
        modelId: cfg?.modelId ?? modelId,
        structuredOutputStrategy: cfg?.structuredOutputStrategy ?? null,
        fallbackStrategies: cfg?.fallbackStrategies ?? [],
      });
    } catch (err) {
      this.logger.warn(
        `[resolveOutputStrategyChain] modelId="${modelId}" failed: ${
          err instanceof Error ? err.message : String(err)
        } — falling back to ['prompt']`,
      );
      return ["prompt"];
    }
  }

  /**
   * 把 strategy 对应的"格式约束 hint" 注入 system prompt（最小侵入接入）。
   * 后续 PR 把 strategy 真正推到 chat options 让 OpenAI/Anthropic native API 生效。
   */
  private buildStrategySystemAddon(
    strategy: StructuredOutputStrategy,
    hasSchema: boolean,
  ): string {
    if (!hasSchema) return "";
    switch (strategy) {
      case "prompt":
        return "\n\n[CRITICAL OUTPUT FORMAT] You MUST output ONLY a valid JSON object that matches the schema described above. No prose, no markdown wrapper. Return the JSON object directly.";
      case "json_mode":
        return "\n\nReturn ONLY a valid JSON object. No prose, no markdown.";
      case "tool_use":
        return "\n\nIMPORTANT: Return your output as a JSON object only. No prose.";
      case "gbnf_grammar":
        return "\n\nOutput a JSON object only. No prose, no markdown.";
      case "json_schema_strict":
      case "json_schema":
      case "gemini_response_schema":
      case "none":
      default:
        return "";
    }
  }

  /**
   * 执行一次"prompt → LLM → JSON → Zod → business-rule 校验 → 产出 TOutput"。
   * schema 或 business-rule 失败时自动 retry：把失败原因注入下一轮 prompt 作为 system note。
   */
  async execute<TOutput>(
    input: LlmExecutorInput<TOutput>,
  ): Promise<LlmExecutorResult<TOutput>> {
    // ★ Stub 模式：env + spec.stubFn 同时存在才生效
    if (isStubModeEnabled()) {
      if (!input.stubFn) {
        throw new StubNotConfiguredError(input.agentId);
      }
      const output = await input.stubFn();
      // 仍然走 schema + business-rule 校验（保证 stub 契约）
      if (input.outputSchema) {
        const parsed = input.outputSchema.safeParse(output);
        if (!parsed.success) {
          const issues = parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw new Error(
            `[${input.agentId}] stubFn output failed schema: ${issues}`,
          );
        }
        if (input.validateBusinessRules) {
          input.validateBusinessRules(parsed.data);
        }
        return {
          output: parsed.data,
          tokensUsed: 0,
          inputTokens: 0,
          outputTokens: 0,
          model: "stub",
          costUsd: 0,
          retries: 0,
        };
      }
      return {
        output,
        tokensUsed: 0,
        inputTokens: 0,
        outputTokens: 0,
        model: "stub",
        costUsd: 0,
        retries: 0,
      };
    }

    const maxRetries = input.maxRetries ?? 2;

    // MissionContext 自动带出 agentProcessId / userId（若 caller 未显式传）。
    //   2026-05-11: slot renamed processId → agentProcessId（见 mission-context.ts header）。
    const kctx = MissionContext.get();
    const processId = input.processId ?? kctx?.agentProcessId;
    const userId = input.userId ?? kctx?.userId;

    let lastError: string | undefined;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let lastModel = "";

    // ── Model-level failover state ──────────────────────────────────────────
    // Tracks models that have already produced a provider-level error so they
    // are excluded from re-election.  The active model may change across the
    // schema-retry loop when a provider error is encountered.
    const failedModelIds: string[] = [];
    // Providers whose key/credits failed — failover excludes ALL their models.
    const failedProviders: string[] = [];
    // The currently elected model (may be updated after failover).
    let activeModel: string | undefined = input.model;
    // The outgoing user-turn message(s). Rebuilt per attempt with the retry hint.
    let outgoingMessages: Array<{ role: "user"; content: string }> = [];

    // ★ 2026-05-06 接入 StructuredOutputRouter：按 model capability 拿 strategy
    //   chain；每次 retry 切下一个 strategy，注入对应 system-prompt hint。
    //   Re-resolve when the active model changes after a failover.
    let strategyChain = await this.resolveOutputStrategyChain(activeModel);

    // ★ 2026-05-06 native structured output: convert Zod schema → JSON Schema once
    const outputJsonSchema: Record<string, unknown> | undefined =
      input.outputSchema ? zodToJsonSchema(input.outputSchema) : undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (input.signal?.aborted) {
        throw new DOMException(
          `[${input.agentId}] Aborted during LLM execute`,
          "AbortError",
        );
      }

      const currentStrategy: StructuredOutputStrategy =
        strategyChain[Math.min(attempt, strategyChain.length - 1)];
      const strategyAddon = this.buildStrategySystemAddon(
        currentStrategy,
        Boolean(input.outputSchema),
      );

      const userPrompt =
        attempt === 0
          ? input.userPrompt
          : [
              input.userPrompt,
              "",
              "âš ï¸ Your previous response failed validation. Output strict JSON exactly matching the requested schema.",
              `Error: ${lastError ?? "(unknown)"}`,
              "",
              "Return complete JSON only, no extra explanation.",
            ].join("\n");

      outgoingMessages = [{ role: "user", content: userPrompt }];

      let res;
      try {
        res = await this.aiChatService.chat({
          systemPrompt: input.systemPrompt + strategyAddon,
          messages: outgoingMessages,
          // Election 选出的 modelId（SpecBasedAgent 已完成环境感知选举）
          // activeModel may differ from input.model after a model-level failover.
          model: activeModel,
          // 没有 elected model 时 fallback 走系统配置的默认 CHAT 模型
          // （AiChatService 优先用 model，model 空时走 modelType → DB 默认）
          modelType: activeModel ? undefined : AIModelType.CHAT,
          taskProfile: input.taskProfile,
          responseFormat: "json",
          userId,
          processId,
          operationName: input.operationName ?? input.agentId,
          signal: input.signal,
          // ★ 2026-05-28 内部 agent 推理调用绕过 guardrails。
          //   prompt-injection-detector 会把 agent 自身的合成/finalize system
          //   prompt（"act as…/ignore incomplete findings" 等合法措辞）误判为
          //   "Jailbreak Attempt" 并拦截，导致 mission 推理步白跑。守护应作用于
          //   mission 入口的用户输入，而非每一轮内部推理。见 ChatOptions.skipGuardrails。
          skipGuardrails: true,
          // ★ 2026-05-06 native structured output fields
          // Pass strategy + JSON Schema so AiApiCallerService uses native API path.
          // strategyAddon covers prompt-only strategies; native strategies use requestBodyPatch.
          structuredOutputStrategy: outputJsonSchema
            ? currentStrategy
            : undefined,
          outputJsonSchema,
          schemaName: input.agentId,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[${input.agentId}] attempt ${attempt + 1}/${maxRetries + 1} chat failed: ${errMsg}`,
        );

        // ── Model-level failover ───────────────────────────────────────────
        // On provider-level errors (5xx, model-not-found, timeout,
        // AllKeysFailed, rate-limit) try to re-elect a different model
        // rather than propagating the error immediately.
        // AbortError and budget/credit exhaustion are NOT failover candidates
        // (isModelLevelFailoverError returns false for those).
        if (
          input.modelFailoverProvider &&
          isModelLevelFailoverError(err) &&
          failedModelIds.length < MAX_MODEL_FAILOVERS
        ) {
          const failedModelId = activeModel ?? "";
          if (failedModelId) failedModelIds.push(failedModelId);
          // Skip the whole failed provider (out of credits / no key), not just
          // one model, so failover jumps to a different provider.
          const provMatch = /provider\s+"?([a-z0-9_-]+)"?/i.exec(errMsg);
          if (provMatch?.[1] && !failedProviders.includes(provMatch[1])) {
            failedProviders.push(provMatch[1]);
          }

          try {
            const nextModelId = await input.modelFailoverProvider(
              failedModelIds,
              failedProviders,
            );
            if (nextModelId) {
              this.logger.warn(
                `[${input.agentId}] model-failover: ${failedModelId || "(default)"} → ${nextModelId} ` +
                  `(failed=${failedModelIds.length}/${MAX_MODEL_FAILOVERS}, reason: ${errMsg.slice(0, 120)})`,
              );
              activeModel = nextModelId;
              // Re-resolve strategy chain for the new model
              strategyChain =
                await this.resolveOutputStrategyChain(activeModel);
              // Reset attempt counter so the new model gets full schema-retry budget
              attempt = -1; // will be incremented to 0 by the for-loop
              lastError = undefined;
              continue;
            }
          } catch (electionErr) {
            this.logger.warn(
              `[${input.agentId}] model-failover election failed: ${electionErr instanceof Error ? electionErr.message : String(electionErr)}`,
            );
          }
        }

        throw err;
      }

      totalInput += res.usage?.inputTokens ?? 0;
      totalOutput += res.usage?.outputTokens ?? 0;
      lastModel = res.model;
      totalCost +=
        this.pricingRegistry?.estimateCost(
          res.model ?? "",
          res.usage?.inputTokens ?? 0,
          res.usage?.outputTokens ?? 0,
        ) ?? 0;

      if (res.isError) {
        throw new Error(
          `[${input.agentId}] chat returned isError: ${res.content.slice(0, 200)}`,
        );
      }

      // 无 schema：一次成功返回 unknown（caller 保证类型安全）
      if (!input.outputSchema) {
        let parsed: unknown;
        try {
          parsed = extractJsonFromLlmContent(res.content);
        } catch (err) {
          // 无 schema 时依然可能 JSON 失败；走一次 retry
          lastError = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[${input.agentId}] attempt ${attempt + 1}: JSON extract failed: ${lastError}`,
          );
          continue;
        }
        return {
          output: parsed as TOutput,
          tokensUsed: totalInput + totalOutput,
          inputTokens: totalInput,
          outputTokens: totalOutput,
          model: lastModel,
          costUsd: totalCost,
          retries: attempt,
        };
      }

      // 有 schema：JSON extract → Zod safeParse → business-rule
      let jsonObj: unknown;
      try {
        jsonObj = extractJsonFromLlmContent(res.content);
      } catch (err) {
        lastError = `JSON extract failed: ${err instanceof Error ? err.message : String(err)}`;
        this.logger.warn(
          `[${input.agentId}] attempt ${attempt + 1}: ${lastError}`,
        );
        continue;
      }

      const parseResult = input.outputSchema.safeParse(jsonObj);
      if (!parseResult.success) {
        const issues = parseResult.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        lastError = `Zod validation failed: ${issues}`;
        this.logger.warn(
          `[${input.agentId}] attempt ${attempt + 1}: ${lastError}`,
        );
        continue;
      }

      if (input.validateBusinessRules) {
        try {
          input.validateBusinessRules(parseResult.data);
        } catch (err) {
          lastError = `Business-rule failed: ${err instanceof Error ? err.message : String(err)}`;
          this.logger.warn(
            `[${input.agentId}] attempt ${attempt + 1}: ${lastError}`,
          );
          continue;
        }
      }

      return {
        output: parseResult.data,
        tokensUsed: totalInput + totalOutput,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        model: lastModel,
        costUsd: totalCost,
        retries: attempt,
      };
    }

    throw new SchemaRetryExhaustedError(
      input.agentId,
      maxRetries + 1,
      lastError ?? "(no error recorded)",
    );
  }
}

import { Injectable, Logger, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import type { ChatMessage } from "../types/task-profile.types";
import type { FunctionDefinition } from "../../tools/abstractions/tool.interface";
import {
  reasoningDepthToEffort,
  safeReasoningEffort,
} from "../types/task-profile.types";
import { getKnownModelLimit } from "../types/model.utils";
import {
  ensureChatCompletionsPath,
  ensureOpenAIEmbeddingsPath,
} from "../types/endpoint.utils";
import type { StructuredOutputStrategy } from "../output/structured/structured-output-strategy.types";
import { ModelCapabilityService } from "../models/capability/model-capability.service";
import { CapabilitySelfHealService } from "../models/capability/capability-self-heal.service";
import { ApiCallerSelfHealTriggerService } from "./api-caller-self-heal-trigger.service";
import {
  BaseHttpCaller,
  wrapEmbeddingError,
  type ChatCompletionResult,
  type EmbeddingApiResult,
} from "./base-http-caller";

/** 粗略的字符-to-token 换算比（英文 ~4 chars/token，中文 ~2） */
const CHARS_TO_TOKENS_RATIO = 4;

/**
 * OpenAI 兼容 provider 的 HTTP caller。
 *
 * 从原 `AiApiCallerService` 抽出，公共方法 / 私有 helper 行为完全一致；
 * 跨 provider 复用的 helper 来自 `BaseHttpCaller`（protected 继承）。
 */
@Injectable()
export class OpenaiCaller extends BaseHttpCaller {
  protected readonly logger = new Logger(OpenaiCaller.name);

  constructor(
    httpService: HttpService,
    @Optional()
    capabilityService?: ModelCapabilityService,
    @Optional()
    legacySelfHealService?: CapabilitySelfHealService,
    @Optional()
    selfHealTrigger?: ApiCallerSelfHealTriggerService,
  ) {
    super(
      httpService,
      capabilityService,
      legacySelfHealService,
      selfHealTrigger,
    );
  }

  /**
   * 调用 OpenAI 兼容格式的 API（OpenAI, Azure, 各种代理服务）
   * ★ 数据库驱动：使用 tokenParamName 配置决定 token 参数名
   */
  async callOpenAICompatibleAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    tokenParamName: string = "max_tokens",
    responseFormat?: string,
    reasoningDepth?: string,
    outputSchema?: { type: string; schema: Record<string, unknown> },
    schemaStrict?: boolean,
    isReasoning: boolean = false,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    tools?: FunctionDefinition[],
    /**
     * v3.1 §A：provider slug（与 AIModelConfig.provider 同语义）。
     * 用于通过 ModelCapabilityService.resolveCapabilities 判定模型是否拒绝
     * response_format（替代删除的 isDeepseekReasoner substring 反模式）。
     * 缺省 = "" → 保留 response_format（向后兼容旧调用方）。
     */
    provider: string = "",
    /** v3.1 §B+.3：BYOK userModelConfigId，catch 触发 self-heal；缺省 = 不触发。 */
    userModelConfigId?: string,
  ): Promise<ChatCompletionResult> {
    // 2026-05-10 §2/§4：单源归一化（base URL → /chat/completions），与
    // streamOpenAICompatible / connection-test 共用 ensureChatCompletionsPath。
    const effectiveEndpoint =
      ensureChatCompletionsPath(apiEndpoint) ||
      "https://api.openai.com/v1/chat/completions";

    // ★ 数据库驱动：使用配置的 tokenParamName，无需硬编码判断
    const tokenParam = { [tokenParamName]: maxTokens };

    // ★ 数据库驱动：是否传 reasoning_effort 由 AIModelConfig.isReasoning 决定
    // 不再用模型名 startsWith 字符串匹配（模型每月新增，硬编码必然过时）
    // 新接 BYOK 的推理模型（gpt-5/6/o5/...），管理员在 DB 把 isReasoning 设为 true 即可
    let reasoningParam: { reasoning_effort?: string } = {};
    if (isReasoning) {
      const effort = safeReasoningEffort(reasoningDepth, modelId);
      const origEffort = reasoningDepthToEffort(reasoningDepth);
      if (origEffort !== effort) {
        this.logger.warn(
          `[callOpenAICompatibleAPI] minimal effort not supported by ${modelId}, downgrading to ${effort}`,
        );
      }
      reasoningParam = { reasoning_effort: effort };
      this.logger.debug(
        `[callOpenAICompatibleAPI] reasoning model (${modelId}), reasoning_effort=${effort}`,
      );
    }

    // ★ 构建请求体 - 只包含有效的参数（支持多模态 contentParts）
    // Layer 4/5 (2026-05-07): role:"tool" + toolCallId 透到 OpenAI native tool_call_id 字段，
    // 让 vLLM / OpenAI 支持 native tool_use_id 配对（多轮 FC 场景必需）。
    // role:"tool" 不带 toolCallId 时（回退路径）OpenAI 会拒绝 — 此场景实际不发生：
    // updateEnvelope 写 role:"tool" 时 callId 来自 LLM tool_calls[].id，必然存在。
    const resolvedMessages = this.buildOpenAICompatibleMessages(messages);

    // ★ 安全阀：检测异常大请求并记录诊断信息
    const estimatedChars = resolvedMessages.reduce((sum, m) => {
      if (typeof m.content === "string") return sum + m.content.length;
      if (Array.isArray(m.content))
        return (
          sum +
          m.content.reduce(
            (s, p) => s + (p.text?.length || p.image_url?.url?.length || 0),
            0,
          )
        );
      return sum;
    }, 0);
    this.logOversizedRequest(
      "callOpenAICompatibleAPI",
      modelId,
      Math.ceil(estimatedChars / CHARS_TO_TOKENS_RATIO),
      estimatedChars,
      resolvedMessages,
    );

    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: resolvedMessages,
      ...tokenParam,
      ...reasoningParam,
    };
    const requestTools = this.buildOpenAICompatibleTools(tools);
    if (requestTools) {
      requestBody.tools = requestTools;
    }

    // ★ 只有当 temperature 有值时才包含，避免发送 null/undefined
    if (temperature !== undefined && temperature !== null) {
      requestBody.temperature = temperature;
    }

    // FIX 1: Resolve the effective nativeMode from capability catalog (provider + modelId).
    // When known, the ACTUAL response_format put on the wire is derived from nativeMode,
    // overriding whatever strategy/outputSchema the caller passed — so no caller can put
    // an unsupported response_format on the wire.
    //   null (unknown)    → existing caller-driven behavior (fail-open BC)
    //   none              → NO response_format; inject JSON system-prompt constraint
    //   json_mode         → { type: "json_object" }  (downgrade json_schema requests)
    //   json_schema       → { type: "json_schema", json_schema: { ..., strict: false } }
    //   json_schema_strict→ json_schema with strict: true
    //   tool_use / gemini_response_schema / gbnf_grammar
    //                     → per-provider adapter path (not raw OpenAI response_format)
    const effectiveNativeMode = this.resolveEffectiveNativeMode(
      provider,
      modelId,
    );
    // Derived convenience flags (backward-compat aliases for the original binary gate)
    const noResponseFormat =
      effectiveNativeMode === "none" ||
      (!effectiveNativeMode && this.rejectsResponseFormat(provider, modelId));

    // JSON system-prompt constraint injector — shared between nativeMode==='none' and
    // the legacy rejectsResponseFormat path.
    const injectJsonConstraint = () => {
      const jsonConstraint =
        "\n\n[CRITICAL OUTPUT FORMAT] You MUST output ONLY a valid JSON object. " +
        "Do NOT wrap it in ```json code blocks. Do NOT add any text before or after the JSON. " +
        "The response must start with { and end with }. No markdown, no explanations.";
      const msgs = requestBody["messages"] as Array<{
        role: string;
        content: unknown;
      }>;
      const systemMsg = msgs.find((m) => m.role === "system");
      if (systemMsg && typeof systemMsg.content === "string") {
        systemMsg.content += jsonConstraint;
      } else {
        msgs.unshift({ role: "system", content: jsonConstraint.trim() });
      }
    };

    if (
      effectiveNativeMode !== null &&
      effectiveNativeMode !== "tool_use" &&
      effectiveNativeMode !== "gemini_response_schema" &&
      effectiveNativeMode !== "gbnf_grammar"
    ) {
      // Capability-driven branch: nativeMode is known → enforce on the wire.
      const wantsJson =
        outputSchema || responseFormat === "json" || outputJsonSchema;

      if (effectiveNativeMode === "none") {
        // nativeMode=none: never send response_format; inject prompt constraint instead.
        if (wantsJson) {
          injectJsonConstraint();
        }
      } else if (effectiveNativeMode === "json_mode") {
        // json_mode: downgrade any json_schema request to json_object.
        if (wantsJson) {
          requestBody["response_format"] = { type: "json_object" };
        }
      } else if (
        effectiveNativeMode === "json_schema" ||
        effectiveNativeMode === "json_schema_strict"
      ) {
        const isStrict = effectiveNativeMode === "json_schema_strict";
        if (structuredOutputStrategy && outputJsonSchema) {
          // New adapter path: use the adapter (may emit json_schema or json_schema_strict).
          const adapter = this.getStructuredOutputAdapter(
            structuredOutputStrategy,
          );
          const adaptOut = adapter.adapt({
            jsonSchema: outputJsonSchema,
            schemaName: schemaName ?? "structured_output",
            modelId,
          });
          Object.assign(requestBody, adaptOut.requestBodyPatch);
          if (adaptOut.systemPromptAddon) {
            const msgs = requestBody["messages"] as Array<{
              role: string;
              content: unknown;
            }>;
            const systemMsg = msgs.find((m) => m.role === "system");
            if (systemMsg && typeof systemMsg.content === "string") {
              systemMsg.content += adaptOut.systemPromptAddon;
            } else {
              msgs.unshift({
                role: "system",
                content: adaptOut.systemPromptAddon.trim(),
              });
            }
          }
        } else if (outputSchema) {
          // Legacy ad-hoc path: build response_format from nativeMode.
          requestBody["response_format"] = {
            type: "json_schema",
            json_schema: {
              name: "structured_output",
              schema: outputSchema.schema,
              strict: isStrict ? true : (schemaStrict ?? false),
            },
          };
        } else if (responseFormat === "json") {
          requestBody["response_format"] = { type: "json_object" };
        }
      } else if (effectiveNativeMode === "prompt") {
        // prompt-only: inject system constraint, never send response_format.
        if (wantsJson) {
          injectJsonConstraint();
        }
      }
      // other known modes (e.g. future extensions) → no response_format set
    } else {
      // effectiveNativeMode is null (unknown) OR is a per-provider adapter mode
      // (tool_use / gemini_response_schema / gbnf_grammar) → preserve existing behavior.
      // ★ 2026-05-06 native structured output path: prefer StructuredOutputRouter adapter
      // over the legacy ad-hoc outputSchema path. When structuredOutputStrategy +
      // outputJsonSchema are provided, apply the adapter's requestBodyPatch and
      // any systemPromptAddon — replacing the old manual response_format wiring.
      if (structuredOutputStrategy && outputJsonSchema && !noResponseFormat) {
        const adapter = this.getStructuredOutputAdapter(
          structuredOutputStrategy,
        );
        const adaptOut = adapter.adapt({
          jsonSchema: outputJsonSchema,
          schemaName: schemaName ?? "structured_output",
          modelId,
        });
        Object.assign(requestBody, adaptOut.requestBodyPatch);
        if (adaptOut.systemPromptAddon) {
          const msgs = requestBody["messages"] as Array<{
            role: string;
            content: unknown;
          }>;
          const systemMsg = msgs.find((m) => m.role === "system");
          if (systemMsg && typeof systemMsg.content === "string") {
            systemMsg.content += adaptOut.systemPromptAddon;
          } else {
            msgs.unshift({
              role: "system",
              content: adaptOut.systemPromptAddon.trim(),
            });
          }
        }
      } else if (!noResponseFormat && outputSchema) {
        // ★ Legacy ad-hoc path (fallback when new fields not provided)
        requestBody["response_format"] = {
          type: "json_schema",
          json_schema: {
            name: "structured_output",
            schema: outputSchema.schema,
            strict: schemaStrict ?? false,
          },
        };
      } else if (!noResponseFormat && responseFormat === "json") {
        requestBody["response_format"] = { type: "json_object" };
      } else if (
        noResponseFormat &&
        (outputSchema || responseFormat === "json" || outputJsonSchema)
      ) {
        // 模型拒绝 response_format（DeepSeek-reasoner / Cohere / 任意 catalog
        // nativeMode==='none'）：在 system message 注入 JSON 约束作为替代约束。
        injectJsonConstraint();
      }
    }

    this.logger.debug(
      `[callOpenAICompatibleAPI] model=${modelId}, endpoint=${effectiveEndpoint.substring(0, 50)}..., ` +
        `tokens=${maxTokens}, temp=${temperature}, msgs=${messages.length}, ~${Math.ceil(estimatedChars / CHARS_TO_TOKENS_RATIO)} input tokens`,
    );

    // ── Shared request + in-request degrade helpers ──────────────────────────
    // Both "4xx format rejection" and "200 OK but degenerate output" use the
    // SAME downgrade mechanics (drop / step-down response_format, re-POST once).
    const doPost = () =>
      firstValueFrom(
        this.httpService.post(effectiveEndpoint, requestBody, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout,
        }),
      );
    const wantsJson =
      !!outputSchema || responseFormat === "json" || !!outputJsonSchema;
    // Apply a degraded structured-output mode onto requestBody in place
    // (json_schema(_strict) → json_mode → none/prompt).
    const applyDegradeToBody = (mode: string) => {
      delete requestBody["response_format"];
      if (mode === "json_mode") {
        requestBody["response_format"] = { type: "json_object" };
      } else if (
        (mode === "json_schema" || mode === "json_schema_strict") &&
        outputJsonSchema
      ) {
        requestBody["response_format"] = {
          type: "json_schema",
          json_schema: {
            name: schemaName ?? "output",
            schema: outputJsonSchema,
            strict: mode === "json_schema_strict",
          },
        };
      } else {
        // none / prompt：撤掉 response_format + 注入 JSON 约束到 system msg
        injectJsonConstraint();
      }
    };
    // Single in-request degrade attempt budget — a 4xx-degrade and a
    // degenerate-output-degrade must not double-retry.
    let degradeUsed = false;
    // ★ 2026-06-12 推理耗尽自愈：单次 token-bump 重试预算（防止死循环）。
    let tokenBumpUsed = false;

    let response;
    try {
      response = await doPost();
    } catch (err) {
      // v3.1 §B+.3 / D.1: fire-and-forget self-heal trigger
      // R1 (2026-05-25): chain-aware 降级目标（json_schema→json_mode→none），
      //   替代旧一刀切 json_schema→none。effectiveNativeMode 是当前真实上线值，
      //   故多步降级天然成立（override 回写后下次再降下一档）。
      const degrade = this.computeSelfHealDegrade(
        provider,
        modelId,
        effectiveNativeMode,
      );
      this.selfHealTrigger?.triggerSelfHealAsync(err, {
        modelId,
        userModelConfigId,
        ...(degrade
          ? { fromValue: degrade.fromValue, toValue: degrade.toValue }
          : {}),
      });

      // ★ F3 (2026-05-25): in-request 当次降级 —— 仅错误路径，成功路径完全不动。
      //   结构化输出被拒(4xx 格式错) + 有下一档 strategy + 调用方确实要 JSON →
      //   当次用降级后的 response_format 重试一次（json_schema→json_mode→none）。
      //   解决"catalog 漂移导致首个 mission 直接崩"（self-heal 只救下次）。
      if (
        degrade &&
        wantsJson &&
        !degradeUsed &&
        this.isStructuredOutputRejection(err)
      ) {
        degradeUsed = true;
        applyDegradeToBody(degrade.toValue);
        try {
          response = await doPost();
          this.logger.warn(
            `[in-request-degrade] ${modelId}: ${degrade.fromValue}→${degrade.toValue} 重试成功（首次格式被拒）`,
          );
          // 成功 → 不抛，落到下方解析
        } catch {
          throw err; // 降级仍失败 → 抛原始错误
        }
      } else {
        throw err;
      }
    }

    const data = response.data;
    const messageObj = data.choices?.[0]?.message;
    const toolCalls = this.extractOpenAICompatibleToolCalls(messageObj);
    const content =
      messageObj?.content ||
      messageObj?.text ||
      messageObj?.output ||
      (typeof messageObj === "string" ? messageObj : null);
    // ★ 推理模型（DeepSeek-R1/V4-Flash thinking、o系列）把 CoT 放在 reasoning_content
    //   独立字段，content 只放可见输出。不接此字段 → harness 的「思考」永远空。
    const reasoning =
      (typeof messageObj?.reasoning_content === "string" &&
      messageObj.reasoning_content.trim()
        ? messageObj.reasoning_content
        : typeof messageObj?.reasoning === "string" &&
            messageObj.reasoning.trim()
          ? messageObj.reasoning
          : undefined) || undefined;

    // ★ 检查 OpenAI 拒绝响应
    if (messageObj?.refusal) {
      this.logger.error(
        `[${modelId}] API refused to respond: ${messageObj.refusal}`,
      );
      throw new Error(`AI 拒绝响应: ${messageObj.refusal}`);
    }

    // ★ 空内容检查
    if (!content && (!toolCalls || toolCalls.length === 0)) {
      const usage = data.usage || {};
      const completionDetails = usage.completion_tokens_details || {};
      const reasoningTokens = completionDetails.reasoning_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;
      const finishReason = data.choices?.[0]?.finish_reason;

      this.logger.warn(
        `[${modelId}] API returned empty content! ` +
          `finish_reason=${finishReason}, ` +
          `prompt_tokens=${usage.prompt_tokens || "?"}, ` +
          `completion_tokens=${completionTokens || "?"}, ` +
          `reasoning_tokens=${reasoningTokens || "?"}, ` +
          `message structure: ${JSON.stringify(messageObj || {}).substring(0, 500)}`,
      );

      // 检测 reasoning 模型用完了推理 token
      const isReasoningModelExhausted =
        reasoningTokens > 0 && reasoningTokens >= completionTokens * 0.9;

      // ★ 2026-06-10：部分推理模型（日志实测 deepseek-v4-flash）finish_reason=stop
      //   时把最终 JSON 写进 reasoning_content、content 留空。这不是预算耗尽——
      //   直接走降级重试会白烧一轮长调用。先从 reasoning_content 提取可解析的
      //   JSON 作为正式输出返回；提取失败才落到下方 in-request-degrade 重试。
      if (wantsJson && finishReason === "stop" && reasoning) {
        const salvaged = this.extractJsonCandidate(reasoning);
        if (salvaged) {
          this.logger.warn(
            `[${modelId}] salvaged JSON output from reasoning_content ` +
              `(finish=stop, content empty) — skipping degrade retry`,
          );
          return {
            content: salvaged,
            model: modelId,
            tokensUsed: usage.total_tokens || 0,
            inputTokens: usage.prompt_tokens || 0,
            outputTokens: completionTokens || 0,
            cacheReadTokens: usage.prompt_tokens_details?.cached_tokens || 0,
            finishReason,
            reasoning,
            toolCalls,
          };
        }
      }

      // ★ 2026-05-25 degenerate-success in-request degrade（机制级，无模型硬编码）：
      //   200 OK 但 content 空（且非纯 tool_call）—— 某些模型（如推理模型在被强制
      //   json_object 时）会"接受 response_format 却吐空/畸形输出"，4xx 降级网兜不到。
      //   当确实要 JSON + capability chain 还有下一档 + 本次未降级过 → 用 chain 派生的
      //   下一档（response_format 降级 / 撤销）重试一次；同时 fire 退化信号 self-heal
      //   把这一档持久化（下次直接用低档，不再空转）。整条路径由 capability 链驱动，
      //   不含任何 provider/modelId 字符串判断。
      if (wantsJson && !degradeUsed) {
        const degrade = this.computeSelfHealDegrade(
          provider,
          modelId,
          effectiveNativeMode,
        );
        if (degrade) {
          degradeUsed = true;
          this.selfHealTrigger?.triggerDegenerateSelfHealAsync?.({
            modelId,
            userModelConfigId,
            fromValue: degrade.fromValue,
            toValue: degrade.toValue,
            bodySnippet:
              `degenerate_output finish_reason=${finishReason ?? "?"} ` +
              `reasoning_tokens=${reasoningTokens} nativeMode=${degrade.fromValue}`,
          });
          applyDegradeToBody(degrade.toValue);
          this.logger.warn(
            `[in-request-degrade] ${modelId}: degenerate 200(empty,finish=${finishReason ?? "?"}) ` +
              `${degrade.fromValue}→${degrade.toValue} 重试`,
          );
          try {
            const retryResp = await doPost();
            const retryData = retryResp.data;
            const retryMsg = retryData.choices?.[0]?.message;
            const retryToolCalls =
              this.extractOpenAICompatibleToolCalls(retryMsg);
            const retryContent =
              retryMsg?.content ||
              retryMsg?.text ||
              retryMsg?.output ||
              (typeof retryMsg === "string" ? retryMsg : null);
            if (retryContent || (retryToolCalls && retryToolCalls.length > 0)) {
              this.logger.warn(
                `[in-request-degrade] ${modelId}: degenerate 重试成功`,
              );
              const ru = retryData.usage || {};
              return {
                content: retryContent || "",
                model: modelId,
                tokensUsed: ru.total_tokens || 0,
                inputTokens: ru.prompt_tokens || 0,
                outputTokens: ru.completion_tokens || 0,
                cacheReadTokens: ru.prompt_tokens_details?.cached_tokens || 0,
                finishReason:
                  retryData.choices?.[0]?.finish_reason || undefined,
                toolCalls: retryToolCalls,
              };
            }
            // 重试仍退化 → 落到下方抛错（交给 model-failover 切模型）
          } catch {
            // 降级重试失败 → 落到下方抛错
          }
        }
      }

      // ★ 2026-06-12 推理耗尽自愈：推理模型把 token 全花在 CoT、可见输出为空时，
      //   不直接判废（旧行为：抛 Non-retryable 错 → 无 failover 时整调用废）。先把
      //   max_tokens 顶到该模型已知上限重试一次，给足输出空间。只有真耗尽才多花这一
      //   轮（常规调用零成本），且单次封顶、受 getKnownModelLimit 约束（不会越 API 限）。
      if (
        isReasoningModelExhausted &&
        (finishReason === "length" || finishReason === "stop") &&
        !tokenBumpUsed
      ) {
        const ceiling = getKnownModelLimit(modelId) ?? 25000;
        const bumped = Math.min(ceiling, Math.max(maxTokens * 3, 25000));
        if (bumped > maxTokens) {
          tokenBumpUsed = true;
          requestBody[tokenParamName] = bumped;
          this.logger.warn(
            `[reasoning-token-bump] ${modelId}: 推理耗尽（visible 空, finish=${finishReason}, ` +
              `reasoning_tokens=${reasoningTokens}）→ max_tokens ${maxTokens}→${bumped} 重试一次`,
          );
          try {
            const retryResp = await doPost();
            const retryData = retryResp.data;
            const retryMsg = retryData.choices?.[0]?.message;
            const retryToolCalls =
              this.extractOpenAICompatibleToolCalls(retryMsg);
            const retryContent =
              retryMsg?.content ||
              retryMsg?.text ||
              retryMsg?.output ||
              (typeof retryMsg === "string" ? retryMsg : null);
            const retryReasoning =
              (typeof retryMsg?.reasoning_content === "string" &&
              retryMsg.reasoning_content.trim()
                ? retryMsg.reasoning_content
                : typeof retryMsg?.reasoning === "string" &&
                    retryMsg.reasoning.trim()
                  ? retryMsg.reasoning
                  : undefined) || undefined;
            const ru = retryData.usage || {};
            // 重试拿到可见输出 / tool_call → 成功返回
            if (retryContent || (retryToolCalls && retryToolCalls.length > 0)) {
              this.logger.warn(`[reasoning-token-bump] ${modelId}: 重试成功`);
              return {
                content: retryContent || "",
                model: modelId,
                tokensUsed: ru.total_tokens || 0,
                inputTokens: ru.prompt_tokens || 0,
                outputTokens: ru.completion_tokens || 0,
                cacheReadTokens:
                  ru.prompt_tokens_details?.cached_tokens || 0,
                finishReason:
                  retryData.choices?.[0]?.finish_reason || undefined,
                reasoning: retryReasoning,
                toolCalls: retryToolCalls,
              };
            }
            // content 仍空但 JSON 落在 reasoning_content → 复用 salvage 路径
            if (wantsJson && retryReasoning) {
              const salvaged = this.extractJsonCandidate(retryReasoning);
              if (salvaged) {
                this.logger.warn(
                  `[reasoning-token-bump] ${modelId}: 重试后从 reasoning_content 抢救 JSON`,
                );
                return {
                  content: salvaged,
                  model: modelId,
                  tokensUsed: ru.total_tokens || 0,
                  inputTokens: ru.prompt_tokens || 0,
                  outputTokens: ru.completion_tokens || 0,
                  cacheReadTokens:
                    ru.prompt_tokens_details?.cached_tokens || 0,
                  finishReason:
                    retryData.choices?.[0]?.finish_reason || undefined,
                  reasoning: retryReasoning,
                  toolCalls: retryToolCalls,
                };
              }
            }
            // 重试仍空 → 落到下方抛错
          } catch {
            // 重试请求本身失败 → 落到下方抛错
          }
        }
      }

      // ★ 推理模型把 token 全花在思考、没有可见输出 —— finish_reason 既可能是
      //   length（截断）也可能是 stop（DeepSeek thinking 等返回 stop）。两种都按
      //   "推理耗尽"处理，抛出可被 model-failover 识别的错误。
      if (
        isReasoningModelExhausted &&
        (finishReason === "length" || finishReason === "stop")
      ) {
        throw new Error(
          `AI 推理模型的 token 全部用于内部思考，没有空间输出结果。` +
            `当前 max_tokens=${maxTokens}，建议增加到 25000+ 以确保有足够空间输出内容。` +
            `（推理模型会使用大部分 tokens 进行 Chain of Thought）`,
        );
      }
      if (finishReason === "length") {
        throw new Error(
          `AI 响应被完全截断（上下文可能过大）。prompt_tokens=${usage.prompt_tokens || "?"}`,
        );
      }

      throw new Error(`AI 返回空响应 (原因: ${finishReason || "unknown"})`);
    }

    const openaiUsage = data.usage || {};
    const promptTokensDetails = openaiUsage.prompt_tokens_details || {};
    return {
      content: content || "",
      model: modelId,
      tokensUsed: openaiUsage.total_tokens || 0,
      inputTokens: openaiUsage.prompt_tokens || 0,
      outputTokens: openaiUsage.completion_tokens || 0,
      cacheReadTokens: promptTokensDetails.cached_tokens || 0,
      finishReason: data.choices?.[0]?.finish_reason || undefined,
      reasoning,
      toolCalls,
    };
  }

  /**
   * 从 reasoning_content 文本中提取可 JSON.parse 的完整 JSON 串。
   *
   * 仅用于 content 空 + finish_reason=stop 的 salvage 路径。提取语义与
   * output/structured/adapters.ts 的 extractJson 一致（剥 ```json fence、
   * 取最早开括号到最晚闭括号的候选段），但返回原始子串而非解析对象——
   * 下游按 string content 消费，保形透传。
   */
  private extractJsonCandidate(text: string): string | null {
    let t = text.trim();
    if (!t) return null;
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence) t = fence[1].trim();
    const firstBrace = t.indexOf("{");
    const lastBrace = t.lastIndexOf("}");
    const firstBracket = t.indexOf("[");
    const lastBracket = t.lastIndexOf("]");
    const arrayRootEarlier =
      firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace);
    let candidate: string | null = null;
    if (arrayRootEarlier && lastBracket > firstBracket) {
      candidate = t.slice(firstBracket, lastBracket + 1);
    } else if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidate = t.slice(firstBrace, lastBrace + 1);
    }
    if (!candidate) return null;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  /**
   * 调用 OpenAI 兼容格式的 Embedding API（OpenAI, xAI, DeepSeek 等）
   * POST {endpoint}/embeddings, Bearer auth
   *
   * ★ 2026-05-12: 加 options.dimensions —— OpenAI text-embedding-3-* 的
   *   Matryoshka 维度截断。其他兼容 provider 不支持的字段会被忽略。
   * ★ 2026-05-12: 429 时读 Retry-After header，包装到 error message 让外层
   *   节流用更精确的 cooldown（fallback 60s 是粗估）。
   */
  async callOpenAICompatibleEmbeddingAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    inputs: string[],
    timeout: number = 60000,
    options?: { dimensions?: number },
  ): Promise<EmbeddingApiResult> {
    // 2026-05-10 §2/§4：单源归一化。
    const embeddingsUrl =
      ensureOpenAIEmbeddingsPath(apiEndpoint) ||
      "https://api.openai.com/v1/embeddings";

    this.logger.debug(
      `[callOpenAICompatibleEmbeddingAPI] model=${modelId}, inputs=${inputs.length}, endpoint=${embeddingsUrl.substring(0, 60)}...`,
    );

    const body: Record<string, unknown> = { model: modelId, input: inputs };
    if (options?.dimensions && options.dimensions > 0) {
      body.dimensions = options.dimensions;
    }

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(embeddingsUrl, body, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout,
        }),
      );
    } catch (error) {
      throw wrapEmbeddingError(error);
    }

    const data = response.data;
    const embeddings = (data.data || []).map(
      (item: { embedding: number[] }) => item.embedding,
    );
    return {
      embeddings,
      totalTokens: data.usage?.total_tokens || 0,
      model: modelId,
    };
  }
}

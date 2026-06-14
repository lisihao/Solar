import { Injectable, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import type { ChatMessage } from "../types/task-profile.types";
import type { FunctionDefinition } from "../../tools/abstractions/tool.interface";
import { ensureChatCompletionsPath } from "../types/endpoint.utils";
import type { StructuredOutputStrategy } from "../output/structured/structured-output-strategy.types";
import { ModelCapabilityService } from "../models/capability/model-capability.service";
import { CapabilitySelfHealService } from "../models/capability/capability-self-heal.service";
import { ApiCallerSelfHealTriggerService } from "./api-caller-self-heal-trigger.service";
import { BaseHttpCaller, type ChatCompletionResult } from "./base-http-caller";

/** 粗略的字符-to-token 换算比（英文 ~4 chars/token，中文 ~2） */
const CHARS_TO_TOKENS_RATIO = 4;

@Injectable()
export class XaiCaller extends BaseHttpCaller {
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

  async callXAIAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    tokenParamName: string = "max_tokens",
    responseFormat?: string,
    _reasoningDepth?: string,
    outputSchema?: { type: string; schema: Record<string, unknown> },
    schemaStrict?: boolean,
    isReasoning: boolean = false,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    tools?: FunctionDefinition[],
    /** v3.1 §B.5：BYOK 路径传 user_model_config.id；catch 触发 self-heal。缺省 → 不触发。 */
    userModelConfigId?: string,
  ): Promise<ChatCompletionResult> {
    // 2026-05-10 §2/§4：单源归一化。
    const effectiveEndpoint =
      ensureChatCompletionsPath(apiEndpoint) ||
      "https://api.x.ai/v1/chat/completions";

    // ★ 数据库驱动：是否走 reasoning 路径由 AIModelConfig.isReasoning 决定
    // 不再用模型名 includes("reasoning") 启发式判断
    // xAI reasoning models use max_tokens (not max_completion_tokens like OpenAI o-series)
    const isReasoningModel = isReasoning;
    const effectiveTokenParam = isReasoningModel
      ? "max_tokens"
      : tokenParamName;

    // ★ 数据库驱动：使用配置的 tokenParamName（支持多模态 contentParts）
    // Layer 4/5 (2026-05-07): xAI 走 OpenAI 兼容协议，role:"tool" + toolCallId
    // 直接透 tool_call_id 字段。
    const resolvedXaiMessages = this.buildOpenAICompatibleMessages(messages);

    // ★ 安全阀：检测异常大请求并记录诊断信息
    const xaiEstimatedChars = resolvedXaiMessages.reduce((sum, m) => {
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
      "callXAIAPI",
      modelId,
      Math.ceil(xaiEstimatedChars / CHARS_TO_TOKENS_RATIO),
      xaiEstimatedChars,
      resolvedXaiMessages,
    );

    const requestBody: Record<string, unknown> = {
      model: modelId,
      messages: resolvedXaiMessages,
      [effectiveTokenParam]: maxTokens,
    };
    const requestTools = this.buildOpenAICompatibleTools(tools);
    if (requestTools) {
      requestBody.tools = requestTools;
    }
    if (
      temperature !== undefined &&
      temperature !== null &&
      !isReasoningModel
    ) {
      requestBody.temperature = temperature;
    }

    // FIX 1 (xAI path): same capability-driven response_format reconciliation as
    // callOpenAICompatibleAPI.  xAI always has provider="xai" which maps to
    // json_schema_strict in the catalog, so the legacy path below is preserved as the
    // effective branch for all current xAI models.  If a future xAI model gets a
    // different nativeMode the catalog enforces it automatically.
    const xaiEffectiveNativeMode = this.resolveEffectiveNativeMode(
      "xai",
      modelId,
    );
    const injectXaiJsonConstraint = () => {
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
      xaiEffectiveNativeMode !== null &&
      xaiEffectiveNativeMode !== "tool_use" &&
      xaiEffectiveNativeMode !== "gemini_response_schema" &&
      xaiEffectiveNativeMode !== "gbnf_grammar"
    ) {
      const wantsJson =
        outputSchema || responseFormat === "json" || outputJsonSchema;
      if (
        xaiEffectiveNativeMode === "none" ||
        xaiEffectiveNativeMode === "prompt"
      ) {
        if (wantsJson) injectXaiJsonConstraint();
      } else if (xaiEffectiveNativeMode === "json_mode") {
        if (wantsJson) requestBody["response_format"] = { type: "json_object" };
      } else if (
        xaiEffectiveNativeMode === "json_schema" ||
        xaiEffectiveNativeMode === "json_schema_strict"
      ) {
        const isStrict = xaiEffectiveNativeMode === "json_schema_strict";
        if (structuredOutputStrategy && outputJsonSchema) {
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
      }
    } else {
      // ★ 2026-05-06 native structured output path for xAI (same OpenAI compat)
      if (structuredOutputStrategy && outputJsonSchema) {
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
        // ★ Legacy ad-hoc path
        // xAI reasoning models DO support response_format (unlike temperature)
        // Without it, reasoning models produce interleaved/malformed JSON output
        requestBody["response_format"] = {
          type: "json_schema",
          json_schema: {
            name: "structured_output",
            schema: outputSchema.schema,
            strict: schemaStrict ?? false,
          },
        };
      } else if (responseFormat === "json") {
        requestBody["response_format"] = { type: "json_object" };
      }
    }

    this.logger.log(
      `[callXAIAPI] model=${modelId}, tokenParam=${effectiveTokenParam}=${maxTokens}, reasoning=${isReasoningModel}, temp=${temperature}, responseFormat=${responseFormat}, msgs=${messages.length}, ~${Math.ceil(xaiEstimatedChars / CHARS_TO_TOKENS_RATIO)} input tokens`,
    );

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(effectiveEndpoint, requestBody, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout,
        }),
      );
    } catch (err) {
      // 2026-05-13 (#31 diag): xAI 4xx 反复 INVALID_MODEL 但原 axios error message
      //   只剩 "Request failed with status code N"，body 内容被丢。展开 response.data
      //   + 关键 request shape 让 admin 看到真正触发因子（model / response_format /
      //   max_tokens / messages 大小 / endpoint）。
      const axiosErr = err as {
        response?: {
          status?: number;
          statusText?: string;
          data?: unknown;
        };
        message?: string;
      };
      const status = axiosErr.response?.status;
      if (status !== undefined && status >= 400) {
        const bodyPreview = (() => {
          try {
            return JSON.stringify(axiosErr.response?.data).slice(0, 800);
          } catch {
            return String(axiosErr.response?.data ?? "").slice(0, 800);
          }
        })();
        this.logger.warn(
          `[callXAIAPI] ${status} ${axiosErr.response?.statusText ?? ""} ` +
            `endpoint=${effectiveEndpoint} model=${modelId} ` +
            `hasResponseFormat=${"response_format" in requestBody} ` +
            `responseFormatType=${
              (requestBody.response_format as { type?: string } | undefined)
                ?.type ?? "(none)"
            } ` +
            `${effectiveTokenParam}=${maxTokens} reasoning=${isReasoningModel} ` +
            `msgs=${messages.length} body=${bodyPreview}`,
        );
      }
      // v3.1 §B.5 / D.1：异步触发 self-heal（fire-and-forget，不阻断 throw）
      // F4 (2026-05-25): xAI 也走 chain-aware 降级（json_schema_strict→json_schema
      //   →json_mode→none），替代旧一刀切。xaiEffectiveNativeMode 是当前真实上线值。
      const degrade = this.computeSelfHealDegrade(
        "xai",
        modelId,
        xaiEffectiveNativeMode,
      );
      this.selfHealTrigger?.triggerSelfHealAsync(err, {
        modelId,
        userModelConfigId,
        ...(degrade
          ? { fromValue: degrade.fromValue, toValue: degrade.toValue }
          : {}),
      });
      throw err;
    }

    const data = response.data;
    const messageObj = data.choices?.[0]?.message;
    const toolCalls = this.extractOpenAICompatibleToolCalls(messageObj);
    const content = messageObj?.content || "";
    if (!content && (!toolCalls || toolCalls.length === 0)) {
      throw new Error(
        `AI 返回空响应 (原因: ${data.choices?.[0]?.finish_reason || "unknown"})`,
      );
    }
    // ★ 2026-05-05 fix: 必须返回 inputTokens / outputTokens 才能让 ReactLoop
    //   thinking 事件携带正确 promptTokens / completionTokens，进而被
    //   extractTokenSpend 累计到 mission pool。否则 UI 显示 tokens 永远 0。
    return {
      content,
      model: modelId,
      tokensUsed: data.usage?.total_tokens || 0,
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      finishReason: data.choices?.[0]?.finish_reason || undefined,
      toolCalls,
    };
  }
}

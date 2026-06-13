import { Injectable, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import type { ChatMessage } from "../types/task-profile.types";
import {
  ensureGeminiGenerateContentPath,
  ensureGeminiBatchEmbedContentsPath,
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

/**
 * 解析 ChatMessage 的有效内容：Google Gemini 格式
 *
 * ★ 限制：Gemini 原生 API 不支持外部 HTTP URL 图片（fileData 仅接受 GCS URI，
 * inlineData 需要 base64）。当 contentParts 包含 image_url 时，图片部分会被
 * 跳过，只保留文本。如需 Gemini Vision，需在上层先将图片下载转为 base64。
 */
function resolveGeminiParts(msg: ChatMessage): Array<{ text?: string }> {
  if (!msg.contentParts || msg.contentParts.length === 0) {
    return [{ text: msg.content }];
  }

  const hasImages = msg.contentParts.some((p) => p.type === "image_url");
  if (hasImages) {
    // Gemini 原生 API 不支持外部 URL 图片，降级为纯文本
    // 将图片的 caption/alt 信息保留为文本描述
    const textParts = msg.contentParts
      .filter((p) => p.type === "text")
      .map((p) => ({ text: (p as { type: "text"; text: string }).text }));
    if (textParts.length === 0) {
      return [{ text: msg.content }];
    }
    return textParts;
  }

  return msg.contentParts
    .filter((p) => p.type === "text")
    .map((p) => ({ text: (p as { type: "text"; text: string }).text }));
}

/**
 * EmbeddingTaskType → Google task_type 映射
 * https://ai.google.dev/api/embeddings#TaskType
 */
function googleTaskType(taskType?: string): string {
  switch (taskType) {
    case "query":
      return "RETRIEVAL_QUERY";
    case "similarity":
      return "SEMANTIC_SIMILARITY";
    case "classification":
      return "CLASSIFICATION";
    case "clustering":
      return "CLUSTERING";
    case "document":
    default:
      return "RETRIEVAL_DOCUMENT";
  }
}

@Injectable()
export class GoogleCaller extends BaseHttpCaller {
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

  async callGoogleAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    responseFormat?: string,
    _reasoningDepth?: string,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    /** v3.1 §B+.3：BYOK userModelConfigId，catch 触发 self-heal；缺省 = 不触发。 */
    userModelConfigId?: string,
  ): Promise<ChatCompletionResult> {
    // 直接使用数据库配置的模型 ID，不做额外验证
    const effectiveModelId = modelId;

    // 2026-05-10 §2/§4：单源归一化（容忍 base / 含 /models / 完整 URL 三种形态）
    const apiUrl = `${ensureGeminiGenerateContentPath(apiEndpoint, effectiveModelId)}?key=${apiKey}`;

    // Extract system message
    const systemMessage = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    // Convert to Gemini format（支持多模态 contentParts）
    // Layer 4/5 (2026-05-07): role:"tool" + toolCallId 转 Gemini native functionResponse part。
    // Gemini wire 形态：role:"function" + parts:[{functionResponse:{name,response:{content}}}]
    // （Gemini 没 tool_use_id 概念，靠 name 配对；toolCallId 暂保留进 functionResponse.id 字段）
    const contents = otherMessages.map((m) => {
      if (m.role === "tool" && m.toolCallId) {
        return {
          role: "function",
          parts: [
            {
              functionResponse: {
                name: m.name ?? "tool",
                response: {
                  id: m.toolCallId,
                  content:
                    typeof m.content === "string"
                      ? m.content
                      : JSON.stringify(m.content),
                },
              },
            },
          ],
        };
      }
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: resolveGeminiParts(m),
      };
    });

    // ★ 构建请求体 - 不硬编码 topP/topK。
    // 之前硬编码 topP=0.95/topK=40 会覆盖 Gemini 各模型的服务端默认值，
    // 导致 Gemini 2.5 Pro / thinking 系列（这类模型官方推荐 topP=1.0）
    // 采样分布被错误收紧。采样参数应由 TaskProfile / DB 配置驱动，
    // 调用方不传就让服务端用模型自己的默认值。
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: maxTokens,
    };

    // 只有当 temperature 有值时才包含
    if (temperature !== undefined && temperature !== null) {
      generationConfig.temperature = temperature;
    }

    // ★ 2026-05-06 native structured output path for Gemini (gemini_response_schema)
    // adapter merges responseMimeType + responseSchema into generationConfig
    if (structuredOutputStrategy && outputJsonSchema) {
      const adapter = this.getStructuredOutputAdapter(structuredOutputStrategy);
      const adaptOut = adapter.adapt({
        jsonSchema: outputJsonSchema,
        schemaName: schemaName ?? "structured_output",
        modelId,
      });
      // The Gemini adapter patches { generationConfig: { responseMimeType, responseSchema } }
      const gcPatch = adaptOut.requestBodyPatch.generationConfig as
        | Record<string, unknown>
        | undefined;
      if (gcPatch) {
        Object.assign(generationConfig, gcPatch);
      }
      // Other patches (e.g. non-generationConfig fields) applied to requestBody later
    } else if (responseFormat === "json") {
      generationConfig["responseMimeType"] = "application/json";
    }

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (systemMessage) {
      requestBody.systemInstruction = {
        parts: [{ text: systemMessage.content }],
      };
    }

    this.logger.debug(
      `[callGoogleAPI] model=${modelId}, maxTokens=${maxTokens}`,
    );

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(apiUrl, requestBody, {
          headers: {
            "Content-Type": "application/json",
          },
          timeout,
        }),
      );
    } catch (err) {
      // v3.1 §B+.3 / D.1: fire-and-forget self-heal trigger
      this.selfHealTrigger?.triggerSelfHealAsync(err, {
        modelId,
        userModelConfigId,
      });
      // ★ A (2026-05-25): in-request 降级 (Gemini) —— 仅错误路径。responseSchema 被拒
      //   → 沿链降 (gemini_response_schema→json_mode→prompt)。json_mode=只留
      //   responseMimeType;prompt=全删 + 注入约束到 systemInstruction。当次重试一次。
      const gWantsJson = !!outputJsonSchema || responseFormat === "json";
      const gCurrent =
        structuredOutputStrategy && outputJsonSchema
          ? "gemini_response_schema"
          : responseFormat === "json"
            ? "json_mode"
            : "none";
      const gDegrade = this.computeSelfHealDegrade("google", modelId, gCurrent);
      if (gDegrade && gWantsJson && this.isStructuredOutputRejection(err)) {
        const gc = requestBody.generationConfig as Record<string, unknown>;
        delete gc["responseSchema"];
        if (gDegrade.toValue === "json_mode") {
          gc["responseMimeType"] = "application/json";
        } else {
          // none / prompt：去掉 mime 约束 + 注入 JSON 提示到 systemInstruction
          delete gc["responseMimeType"];
          const constraint =
            "\n\n[CRITICAL OUTPUT FORMAT] Output ONLY a valid JSON object, no markdown, no prose.";
          const si = requestBody.systemInstruction as
            | { parts: Array<{ text: string }> }
            | undefined;
          if (si?.parts?.[0]) si.parts[0].text += constraint;
          else
            requestBody.systemInstruction = {
              parts: [{ text: constraint.trim() }],
            };
        }
        try {
          response = await firstValueFrom(
            this.httpService.post(apiUrl, requestBody, {
              headers: { "Content-Type": "application/json" },
              timeout,
            }),
          );
          this.logger.warn(
            `[in-request-degrade] ${modelId}: gemini ${gCurrent}→${gDegrade.toValue} 重试成功(首次结构化被拒)`,
          );
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const data = response.data;

    // Check for blocked content
    if (data.candidates?.[0]?.finishReason === "SAFETY") {
      return {
        content:
          "I apologize, but I cannot provide a response to that request due to content safety guidelines.",
        model: effectiveModelId,
        tokensUsed: 0,
      };
    }

    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
      model: effectiveModelId,
      tokensUsed:
        (data.usageMetadata?.promptTokenCount || 0) +
        (data.usageMetadata?.candidatesTokenCount || 0),
    };
  }

  async callGoogleEmbeddingAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    inputs: string[],
    timeout: number = 60000,
    options?: { taskType?: string; dimensions?: number },
  ): Promise<EmbeddingApiResult> {
    // 2026-05-10 §2/§4：单源归一化。
    const apiUrl = ensureGeminiBatchEmbedContentsPath(apiEndpoint, modelId);

    const taskType = googleTaskType(options?.taskType);
    const outputDimensionality =
      options?.dimensions && options.dimensions > 0
        ? options.dimensions
        : undefined;

    this.logger.debug(
      `[callGoogleEmbeddingAPI] model=${modelId}, inputs=${inputs.length}, task=${taskType} (google format)`,
    );

    const requests = inputs.map((text) => ({
      model: `models/${modelId}`,
      content: { parts: [{ text }] },
      taskType,
      ...(outputDimensionality ? { outputDimensionality } : {}),
    }));

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(
          apiUrl,
          { requests },
          {
            headers: {
              "x-goog-api-key": apiKey,
              "Content-Type": "application/json",
            },
            timeout,
          },
        ),
      );
    } catch (error) {
      throw wrapEmbeddingError(error);
    }

    const data = response.data;
    const embeddings = (data.embeddings || []).map(
      (item: { values: number[] }) => item.values,
    );
    return {
      embeddings,
      totalTokens: 0, // Google does not return token counts for embeddings
      model: modelId,
    };
  }
}

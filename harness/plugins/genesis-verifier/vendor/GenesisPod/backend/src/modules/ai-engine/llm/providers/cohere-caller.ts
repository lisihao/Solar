import { Injectable, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import type { ChatMessage } from "../types/task-profile.types";
import {
  ensureCohereChatPath,
  ensureCohereEmbedPath,
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

@Injectable()
export class CohereCaller extends BaseHttpCaller {
  constructor(
    httpService: HttpService,
    @Optional() capabilityService?: ModelCapabilityService,
    @Optional() legacySelfHealService?: CapabilitySelfHealService,
    @Optional() selfHealTrigger?: ApiCallerSelfHealTriggerService,
  ) {
    super(
      httpService,
      capabilityService,
      legacySelfHealService,
      selfHealTrigger,
    );
  }

  async callCohereAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    responseFormat?: string,
    // L2 fix：之前只转发 responseFormat，丢了 structuredOutputStrategy/schema →
    // schema/strategy 结构化请求在 Cohere 上变成无约束自由文本。下面接 prompt 兜底。
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
  ): Promise<ChatCompletionResult> {
    const effectiveEndpoint =
      ensureCohereChatPath(apiEndpoint) || "https://api.cohere.com/v2/chat";

    // Cohere v2 messages：role 直通（system/user/assistant/tool），content 转纯文本。
    // 多模态 contentParts 暂以 JSON 字符串兜底（首版不处理 vision block）。
    const cohereMessages = messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    }));

    // L2 fix：结构化输出兜底。Cohere v2 chat 无 callOpenAICompatibleAPI 的
    // injectJsonConstraint 链，故这里：① 需要 JSON 时强制 response_format=json_object；
    // ② 有 schema 时把 schema 作为 system 指令注入做 prompt-constraint（不依赖
    // Cohere 端 schema 强约束，至少保证 JSON 形状而非自由文本）。
    const wantsJson =
      responseFormat === "json" ||
      structuredOutputStrategy === "json_mode" ||
      structuredOutputStrategy === "json_schema" ||
      structuredOutputStrategy === "json_schema_strict" ||
      !!outputJsonSchema;
    if (wantsJson && outputJsonSchema) {
      cohereMessages.unshift({
        role: "system",
        content: `You MUST respond with a single valid JSON object${
          schemaName ? ` named "${schemaName}"` : ""
        } conforming to this JSON schema. Output ONLY the JSON, no prose or markdown fences:\n${JSON.stringify(
          outputJsonSchema,
        )}`,
      });
    }

    const requestBody: Record<string, unknown> = {
      model: modelId,
      max_tokens: maxTokens,
      messages: cohereMessages,
    };

    if (temperature !== undefined && temperature !== null) {
      requestBody.temperature = temperature;
    }

    // Cohere v2 原生支持 response_format: { type: "json_object" }
    if (wantsJson) {
      requestBody.response_format = { type: "json_object" };
    }

    this.logger.debug(
      `[callCohereAPI] model=${modelId}, maxTokens=${maxTokens}`,
    );

    const response = await firstValueFrom(
      this.httpService.post(effectiveEndpoint, requestBody, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout,
      }),
    );

    const data = response.data ?? {};
    // 响应 message.content 是 block 数组，拼接所有 text block。
    const contentBlocks: Array<{ type?: string; text?: string }> =
      data.message?.content ?? [];
    const textContent = contentBlocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");

    const tokens = data.usage?.tokens ?? {};
    const inputTokens = tokens.input_tokens || 0;
    const outputTokens = tokens.output_tokens || 0;
    const finishRaw = (data.finish_reason || "").toString().toLowerCase();

    return {
      content: textContent,
      model: modelId,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      finishReason:
        finishRaw === "max_tokens"
          ? "length"
          : finishRaw === "complete"
            ? "stop"
            : finishRaw || undefined,
    };
  }

  async callCohereEmbeddingAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    inputs: string[],
    inputType: string = "search_document",
    timeout: number = 60000,
  ): Promise<EmbeddingApiResult> {
    // 2026-05-10 §2/§4：单源归一化。
    const embedUrl =
      ensureCohereEmbedPath(apiEndpoint) || "https://api.cohere.com/v1/embed";

    this.logger.debug(
      `[callCohereEmbeddingAPI] model=${modelId}, inputs=${inputs.length}, input_type=${inputType} (cohere format)`,
    );

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(
          embedUrl,
          {
            model: modelId,
            texts: inputs,
            input_type: inputType,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
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
    const embeddings: number[][] = data.embeddings || [];
    return {
      embeddings,
      totalTokens: data.meta?.billed_units?.input_tokens || 0,
      model: modelId,
    };
  }
}

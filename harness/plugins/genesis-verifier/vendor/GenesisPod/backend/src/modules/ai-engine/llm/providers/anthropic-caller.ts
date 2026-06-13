import { Injectable, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import type { ChatMessage } from "../types/task-profile.types";
import type { StructuredOutputStrategy } from "../output/structured/structured-output-strategy.types";
import { ModelCapabilityService } from "../models/capability/model-capability.service";
import { CapabilitySelfHealService } from "../models/capability/capability-self-heal.service";
import { ApiCallerSelfHealTriggerService } from "./api-caller-self-heal-trigger.service";
import { ensureMessagesPath } from "../types/endpoint.utils";
import { BaseHttpCaller, type ChatCompletionResult } from "./base-http-caller";

function resolveAnthropicContent(msg: ChatMessage):
  | string
  | Array<{
      type: string;
      text?: string;
      source?: { type: string; url: string };
    }> {
  if (!msg.contentParts || msg.contentParts.length === 0) return msg.content;
  return msg.contentParts.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text };
    return {
      type: "image" as const,
      source: { type: "url", url: part.image_url.url },
    };
  });
}

@Injectable()
export class AnthropicCaller extends BaseHttpCaller {
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
   * 调用 Anthropic Claude API
   */
  async callAnthropicAPI(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    timeout: number = 120000,
    responseFormat?: string,
    _reasoningDepth?: string,
    cachePolicy?: string,
    structuredOutputStrategy?: StructuredOutputStrategy,
    outputJsonSchema?: Record<string, unknown>,
    schemaName?: string,
    /** v3.1 §B+.3：BYOK userModelConfigId，catch 触发 self-heal；缺省 = 不触发。 */
    userModelConfigId?: string,
  ): Promise<ChatCompletionResult> {
    if (responseFormat === "json") {
      this.logger.warn(
        `[callAnthropicAPI] responseFormat="json" requested but Anthropic does not support json_object mode natively. ` +
          `Relying on system prompt constraint only.`,
      );
    }
    // 2026-05-10 §2/§4：单源归一化（base URL → /messages）。
    const effectiveEndpoint =
      ensureMessagesPath(apiEndpoint) ||
      "https://api.anthropic.com/v1/messages";

    // Extract system message
    const systemMessage = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    // ★ 构建请求体 - 只包含有效的参数（支持多模态 contentParts）
    // Layer 4/5 (2026-05-07): role:"tool" + toolCallId 转 Anthropic native tool_result block。
    // Anthropic wire 形态：role:"user" + content:[{type:"tool_result",tool_use_id,content}]
    // 不带 toolCallId 的 tool 消息（数据缺失/旧路径）退到 plain text user 兜底。
    const requestBody: Record<string, unknown> = {
      model: modelId,
      max_tokens: maxTokens,
      messages: otherMessages.map((m) => {
        if (m.role === "tool" && m.toolCallId) {
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: m.toolCallId,
                content:
                  typeof m.content === "string"
                    ? m.content
                    : JSON.stringify(m.content),
              },
            ],
          };
        }
        return {
          role: m.role === "assistant" ? "assistant" : "user",
          content: resolveAnthropicContent(m),
        };
      }),
    };

    // 只有当 system 有内容时才包含（system 仅支持纯文本）
    if (systemMessage?.content) {
      if (cachePolicy === "auto") {
        requestBody.system = [
          {
            type: "text",
            text: systemMessage.content,
            cache_control: { type: "ephemeral" },
          },
        ];
      } else {
        requestBody.system = systemMessage.content;
      }
    }

    // 只有当 temperature 有值时才包含
    if (temperature !== undefined && temperature !== null) {
      requestBody.temperature = temperature;
    }

    // 把 structured-output 的 systemPromptAddon 追加到 Anthropic system 字段
    // （兼容 string / cache_control 数组 / 未设三种形态）。初次 adapt + 降级共用。
    const appendAnthropicSystem = (addon: string): void => {
      if (typeof requestBody.system === "string") {
        requestBody.system = requestBody.system + addon;
      } else if (
        Array.isArray(requestBody.system) &&
        requestBody.system.length > 0
      ) {
        const sys = requestBody.system as Array<{
          type: string;
          text: string;
          cache_control?: unknown;
        }>;
        sys[sys.length - 1].text += addon;
      } else {
        requestBody.system = addon.trim();
      }
    };

    // ★ 2026-05-06 native structured output path for Anthropic.
    // anthropic_output_config → output_config.format（native GA）；tool_use → tools/tool_choice。
    let anthropicStructuredStrategy: StructuredOutputStrategy | undefined;
    if (structuredOutputStrategy && outputJsonSchema) {
      const adapter = this.getStructuredOutputAdapter(structuredOutputStrategy);
      const adaptOut = adapter.adapt({
        jsonSchema: outputJsonSchema,
        schemaName: schemaName ?? "structured_output",
        modelId,
      });
      Object.assign(requestBody, adaptOut.requestBodyPatch);
      if (adaptOut.systemPromptAddon) {
        appendAnthropicSystem(adaptOut.systemPromptAddon);
      }
      anthropicStructuredStrategy = structuredOutputStrategy;
    }

    this.logger.debug(
      `[callAnthropicAPI] model=${modelId}, maxTokens=${maxTokens}`,
    );

    let response;
    try {
      response = await firstValueFrom(
        this.httpService.post(effectiveEndpoint, requestBody, {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          timeout,
        }),
      );
    } catch (err) {
      // v3.1 §B+.3 / D.1 + R1(2026-05-25): chain-aware self-heal trigger。
      //   anthropic 链 = [anthropic_output_config, tool_use, prompt]，effective
      //   native mode 即当前 anthropicStructuredStrategy，多步降级天然成立。
      const anthropicDegrade = this.computeSelfHealDegrade(
        "anthropic",
        modelId,
        anthropicStructuredStrategy ?? null,
      );
      this.selfHealTrigger?.triggerSelfHealAsync(err, {
        modelId,
        userModelConfigId,
        ...(anthropicDegrade
          ? {
              fromValue: anthropicDegrade.fromValue,
              toValue: anthropicDegrade.toValue,
            }
          : {}),
      });
      // ★ A+F7 (2026-05-25): in-request 当次降级 (Anthropic) —— 仅错误路径。结构化
      //   输出被拒(catalog 漂移 / native output_config 不被某模型支持)→ 沿链降一档
      //   重试：native→tool_use（带 schema，质量高）；tool_use→prompt（schema 注入
      //   system，避免裸文本无指引）。解决"首个 mission 直接崩"（self-heal 只救下次）。
      if (
        anthropicStructuredStrategy &&
        this.isStructuredOutputRejection(err)
      ) {
        // 撤掉当前 strategy 写入的所有结构化字段
        delete requestBody["output_config"];
        delete requestBody["tools"];
        delete requestBody["tool_choice"];
        const nextMode = anthropicDegrade?.toValue;
        let degradeLabel: string;
        if (nextMode === "tool_use" && outputJsonSchema) {
          const toolPatch = this.getStructuredOutputAdapter("tool_use").adapt({
            jsonSchema: outputJsonSchema,
            schemaName: schemaName ?? "structured_output",
            modelId,
          }).requestBodyPatch;
          Object.assign(requestBody, toolPatch);
          anthropicStructuredStrategy = "tool_use";
          degradeLabel = "→tool_use";
        } else {
          // 降到 prompt：注入 schema 约束到 system，再走 plain-text 解析
          if (outputJsonSchema) {
            const addon = this.getStructuredOutputAdapter("prompt").adapt({
              jsonSchema: outputJsonSchema,
              schemaName: schemaName ?? "structured_output",
              modelId,
            }).systemPromptAddon;
            if (addon) appendAnthropicSystem(addon);
          }
          anthropicStructuredStrategy = undefined;
          degradeLabel = "→prompt";
        }
        try {
          response = await firstValueFrom(
            this.httpService.post(effectiveEndpoint, requestBody, {
              headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              timeout,
            }),
          );
          this.logger.warn(
            `[in-request-degrade] ${modelId}: anthropic ${anthropicDegrade?.fromValue ?? "structured"}${degradeLabel} 重试成功(首次结构化被拒)`,
          );
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }

    const data = response.data;
    const anthropicUsage = data.usage || {};

    // ★ postParse: for tool_use strategy, extract JSON from the tool_use content block
    let textContent = data.content?.[0]?.text || "";
    if (anthropicStructuredStrategy === "tool_use") {
      const toolUseBlock = data.content?.find(
        (b: { type: string }) => b.type === "tool_use",
      ) as { type: string; name?: string; input?: unknown } | undefined;
      if (toolUseBlock?.input != null) {
        textContent = JSON.stringify(toolUseBlock.input);
      } else if (!textContent) {
        // fallback: check if any text block present
        textContent =
          data.content?.find(
            (b: { type: string; text?: string }) => b.type === "text",
          )?.text || "";
      }
    }

    return {
      content: textContent,
      model: modelId,
      tokensUsed:
        (anthropicUsage.input_tokens || 0) +
        (anthropicUsage.output_tokens || 0),
      inputTokens: anthropicUsage.input_tokens || 0,
      outputTokens: anthropicUsage.output_tokens || 0,
      cacheCreationTokens: anthropicUsage.cache_creation_input_tokens || 0,
      cacheReadTokens: anthropicUsage.cache_read_input_tokens || 0,
      finishReason:
        data.stop_reason === "max_tokens"
          ? "length"
          : data.stop_reason || undefined,
    };
  }
}

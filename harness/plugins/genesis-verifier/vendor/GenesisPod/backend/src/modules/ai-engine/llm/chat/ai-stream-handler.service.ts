import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import {
  ChatMessage,
  ensureChatCompletionsPath,
  ensureMessagesPath,
  reasoningDepthToEffort,
} from "../types";

export interface StreamChunk {
  content: string;
  done: boolean;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** 时延指标（仅在 done=true 的最终 chunk 中填充） */
  timing?: StreamTiming;
}

/** 流式调用时延指标 */
export interface StreamTiming {
  /** Time To First Token (ms) — 从请求发出到首个内容 chunk 到达 */
  ttftMs: number;
  /** Time To Last Token (ms) — 从请求发出到最后一个内容 chunk 到达 */
  ttltMs: number;
  /** 流式开始时间 (Date.now()) */
  streamStartTime: number;
}

/**
 * AI 流式处理服务
 * 负责：SSE 流式响应处理（OpenAI、Anthropic）
 */
@Injectable()
export class AiStreamHandlerService {
  private readonly logger = new Logger(AiStreamHandlerService.name);

  constructor(private readonly httpService: HttpService) {}

  /** 构建流式时延指标 */
  private buildTiming(
    streamStartTime: number,
    firstContentTime: number | undefined,
    lastContentTime: number | undefined,
  ): StreamTiming | undefined {
    if (firstContentTime === undefined) return undefined;
    return {
      ttftMs: firstContentTime - streamStartTime,
      ttltMs: (lastContentTime ?? firstContentTime) - streamStartTime,
      streamStartTime,
    };
  }

  /**
   * OpenAI 兼容格式的流式调用
   */
  async *streamOpenAICompatible(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
    tokenParamName: string = "max_tokens",
    isReasoning: boolean = false,
    reasoningDepth?: string,
  ): AsyncGenerator<StreamChunk, void> {
    // ★ 数据库驱动：使用配置的 tokenParamName，无需硬编码判断
    const tokenParam = { [tokenParamName]: maxTokens };

    // ★ DB 驱动 isReasoning + task profile reasoningDepth → reasoning_effort
    //   不再 hardcode "low"。caller 传 deep → high effort（多步推理任务）；
    //   不传 → 缺省 low（最省 token，避免 CoT 吃光 max_completion_tokens）。
    const reasoningParam = isReasoning
      ? { reasoning_effort: reasoningDepthToEffort(reasoningDepth) }
      : {};

    // 2026-05-10 §2/§4：单源归一化。BYOK 兜底 endpoint（如 deepseek 默认
    // `https://api.deepseek.com/v1`）不含 `/chat/completions`，直接 POST 必 404。
    const chatUrl = ensureChatCompletionsPath(apiEndpoint);
    if (!chatUrl) {
      yield {
        content: "",
        done: true,
        error:
          "Empty chat-completions endpoint — provider 未在 ai_providers / AIModel.apiEndpoint 配置",
      };
      return;
    }

    try {
      // ★ TTFT: 在发出请求前记录时间，以准确测量从请求发起到首个 token 的延迟
      const streamStartTime = Date.now();
      const response = await firstValueFrom(
        this.httpService.post(
          chatUrl,
          {
            model: modelId,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            ...tokenParam,
            ...reasoningParam,
            temperature,
            stream: true,
            stream_options: { include_usage: true }, // ★ 启用流式 usage 统计
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            responseType: "stream",
            timeout: 300000, // 5 分钟超时
          },
        ),
      );

      const stream = response.data;
      let buffer = "";
      let firstContentTime: number | undefined;
      let lastContentTime: number | undefined;

      for await (const chunk of stream) {
        buffer += chunk.toString();

        // 解析 SSE 事件
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              const timing = this.buildTiming(
                streamStartTime,
                firstContentTime,
                lastContentTime,
              );
              yield { content: "", done: true, timing };
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                const now = Date.now();
                if (firstContentTime === undefined) {
                  firstContentTime = now;
                }
                lastContentTime = now;
                yield { content: delta, done: false };
              }

              // ★ 提取 usage 信息（在最后的 chunk 中）
              if (parsed.usage) {
                const usage = {
                  promptTokens: parsed.usage.prompt_tokens || 0,
                  completionTokens: parsed.usage.completion_tokens || 0,
                  totalTokens: parsed.usage.total_tokens || 0,
                };
                this.logger.debug(
                  `[streamOpenAICompatible] Usage received: ${usage.totalTokens} tokens`,
                );
                const timing = this.buildTiming(
                  streamStartTime,
                  firstContentTime,
                  lastContentTime,
                );
                yield { content: "", done: true, usage, timing };
                return;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      const timing = this.buildTiming(
        streamStartTime,
        firstContentTime,
        lastContentTime,
      );
      yield { content: "", done: true, timing };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[streamOpenAICompatible] Error: ${errorMsg}`);
      yield { content: "", done: true, error: errorMsg };
    }
  }

  /**
   * Anthropic Claude 的 SSE 流式调用
   */
  async *streamAnthropic(
    apiEndpoint: string,
    apiKey: string,
    modelId: string,
    messages: ChatMessage[],
    maxTokens: number,
    temperature?: number,
  ): AsyncGenerator<StreamChunk, void> {
    const systemMessage = messages.find((m) => m.role === "system");
    const otherMessages = messages.filter((m) => m.role !== "system");

    const messagesUrl = ensureMessagesPath(apiEndpoint);
    if (!messagesUrl) {
      yield {
        content: "",
        done: true,
        error:
          "Empty Anthropic messages endpoint — provider 未在 ai_providers / AIModel.apiEndpoint 配置",
      };
      return;
    }

    try {
      // ★ TTFT: 在发出请求前记录时间
      const streamStartTime = Date.now();
      const response = await firstValueFrom(
        this.httpService.post(
          messagesUrl,
          {
            model: modelId,
            max_tokens: maxTokens,
            temperature,
            system: systemMessage?.content,
            messages: otherMessages.map((m) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            })),
            stream: true,
          },
          {
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            responseType: "stream",
            timeout: 300000,
          },
        ),
      );

      const stream = response.data;
      let buffer = "";
      let firstContentTime: number | undefined;
      let lastContentTime: number | undefined;

      for await (const chunk of stream) {
        buffer += chunk.toString();

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const parsed = JSON.parse(data);
              // Anthropic 的流式格式
              if (parsed.type === "content_block_delta") {
                const text = parsed.delta?.text;
                if (text) {
                  const now = Date.now();
                  if (firstContentTime === undefined) {
                    firstContentTime = now;
                  }
                  lastContentTime = now;
                  yield { content: text, done: false };
                }
              } else if (parsed.type === "message_stop") {
                const timing = this.buildTiming(
                  streamStartTime,
                  firstContentTime,
                  lastContentTime,
                );
                yield { content: "", done: true, timing };
                return;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      const timing = this.buildTiming(
        streamStartTime,
        firstContentTime,
        lastContentTime,
      );
      yield { content: "", done: true, timing };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[streamAnthropic] Error: ${errorMsg}`);
      yield { content: "", done: true, error: errorMsg };
    }
  }
}

import { Injectable, Logger, Optional } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import type { ChatMessage } from "../types/task-profile.types";
import type { FunctionDefinition } from "../../tools/abstractions/tool.interface";
import {
  JsonSchemaStrictAdapter,
  JsonSchemaAdapter,
  JsonModeAdapter,
  AnthropicToolUseAdapter,
  AnthropicOutputConfigAdapter,
  GeminiResponseSchemaAdapter,
  GbnfGrammarAdapter,
  PromptOnlyAdapter,
} from "../output/structured/adapters";
import type { StructuredOutputStrategy } from "../output/structured/structured-output-strategy.types";
import { ModelCapabilityService } from "../models/capability/model-capability.service";
import { CapabilitySelfHealService } from "../models/capability/capability-self-heal.service";
import { extractErrorSignal } from "../models/capability/error-signal.types";
import { ApiCallerSelfHealTriggerService } from "./api-caller-self-heal-trigger.service";
import type { AIModelConfig } from "../types/model-config.types";
import type {
  ChatCompletionResult,
  EmbeddingApiResult,
} from "./provider-caller.interface";

// Re-export the shared result shapes so existing imports from this layer keep
// resolving without change.
export type { ChatCompletionResult, EmbeddingApiResult };

/**
 * 解析 ChatMessage 的有效内容：优先使用 contentParts（多模态），回退到 content（纯文本）
 * 返回 OpenAI/xAI 兼容格式
 */
export function resolveOpenAIContent(msg: ChatMessage):
  | string
  | Array<{
      type: string;
      text?: string;
      image_url?: { url: string; detail?: string };
    }> {
  if (!msg.contentParts || msg.contentParts.length === 0) return msg.content;
  return msg.contentParts.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text };
    return {
      type: "image_url" as const,
      image_url: {
        url: part.image_url.url,
        detail: part.image_url.detail || "auto",
      },
    };
  });
}

/** 超过此 token 阈值的请求被视为异常（用于安全阀日志） */
const OVERSIZED_REQUEST_TOKEN_THRESHOLD = 100_000;
/** 错误诊断日志中堆栈帧数量 */
const STACK_CONTEXT_LINES = 5;
// reasoningDepth → reasoning_effort 映射统一在 types/task-profile.types.ts，
// 所有 path（Path A / Path B / Stream）共享，不得在 callsite hardcode。

/**
 * 各 provider HTTP caller 的共享基类。
 *
 * 持有构造依赖（HttpService / 可选 capability + self-heal）与所有跨 provider 复用的
 * helper（消息/工具构建、结构化输出适配器、self-heal 降级判定、超大请求日志等）。
 * helper 以 protected 暴露给子类调用，行为与原 `AiApiCallerService` 完全一致。
 */
@Injectable()
export abstract class BaseHttpCaller {
  protected readonly logger = new Logger(BaseHttpCaller.name);

  /**
   * v3.1 §A review (2026-05-24)：fail-open 观测信号去重 Set。
   * 同 (provider, modelId, reason) 仅 warn 一次，防日志风暴。
   * key 格式：`${reason}|${provider}|${modelId}`
   */
  protected readonly _capabilityFailOpenWarned = new Set<string>();

  /**
   * v3.1 §D.1 (2026-05-24)：BC 适配字段——旧测试用第 3 构造位注入
   * `CapabilitySelfHealService` 时本字段被自动 wrap 为 selfHealTrigger。
   * 新代码请用第 4 构造位的 ApiCallerSelfHealTriggerService。
   */
  protected selfHealTrigger?: ApiCallerSelfHealTriggerService;

  constructor(
    protected readonly httpService: HttpService,
    // v3.1 §A: 替代原 isDeepseekReasoner 反模式；caps.structuredOutput.nativeMode
    // === 'none' 决定是否注入 response_format。Optional 保留 BC（旧单测可不注入）。
    @Optional()
    protected readonly capabilityService?: ModelCapabilityService,
    // v3.1 §B.5 / D.1 (2026-05-24)：catch 触发 self-heal 已抽到
    // ApiCallerSelfHealTriggerService。第 3 位保留 @Optional CapabilitySelfHealService
    // 旧测试 BC——构造里包装为 selfHealTrigger；新代码请用第 4 位直接注入 trigger。
    @Optional()
    legacySelfHealService?: CapabilitySelfHealService,
    @Optional()
    selfHealTrigger?: ApiCallerSelfHealTriggerService,
  ) {
    this.selfHealTrigger =
      selfHealTrigger ??
      (legacySelfHealService
        ? new ApiCallerSelfHealTriggerService(legacySelfHealService)
        : undefined);
  }

  /**
   * v3.1 §A：判断指定 (provider, modelId) 的模型是否拒绝 response_format 字段。
   *
   * 实现：调用 ModelCapabilityService.resolveCapabilities() 后看
   *      caps.structuredOutput.nativeMode === 'none'。
   *
   * 替代删除的 `modelLower.includes("deepseek-reasoner")` 反模式。
   *
   * 安全设计：
   *   - provider 缺失（旧调用方未传） → 退回 false（**保留 response_format 字段**，
   *     与重构前行为一致；不会因 catalog SAFE_DEFAULTS 误判全平台关 response_format）
   *   - capability service 未注入（旧单测） → 同样退回 false
   *   - provider 已知 + catalog 明确 nativeMode='none' → 返回 true（跳 response_format）
   *
   * v3.1 §A review (2026-05-24) fail-open 观测：
   *   - 当 capability gate 被绕过（service 缺 / provider 空）时记一次 warn，
   *     让运维能在日志里追到"为什么这条没走 catalog"。
   *   - 同 (reason, provider, modelId) 只 warn 一次（_capabilityFailOpenWarned 去重），
   *     防止热路径日志风暴。
   */
  protected rejectsResponseFormat(provider: string, modelId: string): boolean {
    if (!this.capabilityService || !provider?.trim()) {
      const reason = !this.capabilityService
        ? "missing-service"
        : "empty-provider";
      const dedupeKey = `${reason}|${provider}|${modelId}`;
      if (!this._capabilityFailOpenWarned.has(dedupeKey)) {
        this._capabilityFailOpenWarned.add(dedupeKey);
        this.logger.warn(
          `[capability-gate] bypassed, fail-open: reason=${reason}, ` +
            `provider="${provider}", modelId="${modelId}" ` +
            `(response_format 将按重构前行为保留；后续重复同源不再 warn)`,
        );
      }
      return false;
    }
    const projection: AIModelConfig = {
      id: "",
      name: "",
      displayName: "",
      provider,
      modelId,
      apiEndpoint: "",
      apiKey: null,
      maxTokens: 0,
      temperature: 0,
      isEnabled: true,
      isDefault: false,
    };
    const caps = this.capabilityService.resolveCapabilities(projection);
    return caps.structuredOutput.nativeMode === "none";
  }

  /**
   * FIX 1: Resolve the EFFECTIVE native structured-output mode for (provider, modelId)
   * from the capability catalog. Returns null when the catalog cannot be consulted
   * (service missing or provider empty) — in that case callers preserve existing
   * behavior (fail-open BC).
   *
   * nativeMode → wire response_format contract (enforced at the HTTP choke point):
   *   none              → NO response_format; inject JSON system-prompt constraint
   *   json_mode         → { type: "json_object" }  (downgrade json_schema requests)
   *   json_schema       → { type: "json_schema", json_schema: { ..., strict: false } }
   *   json_schema_strict→ { type: "json_schema", json_schema: { ..., strict: true } }
   *   tool_use /
   *   gemini_response_schema /
   *   gbnf_grammar      → handled by per-provider adapter path (not raw response_format)
   *   null (unknown)    → existing caller-driven behavior unchanged
   */
  protected resolveEffectiveNativeMode(
    provider: string,
    modelId: string,
  ):
    | import("../models/capability/model-capability.types").NativeStructuredOutputMode
    | null {
    if (!this.capabilityService || !provider?.trim()) {
      return null; // fail-open: preserve caller-driven behavior
    }
    const projection: AIModelConfig = {
      id: "",
      name: "",
      displayName: "",
      provider,
      modelId,
      apiEndpoint: "",
      apiKey: null,
      maxTokens: 0,
      temperature: 0,
      isEnabled: true,
      isDefault: false,
    };
    const caps = this.capabilityService.resolveCapabilities(projection);
    return caps.structuredOutput.nativeMode;
  }

  /**
   * 2026-05-25 (R1 自适应降级): 计算 self-heal 应把 nativeMode 降到哪一档。
   *
   * 旧 self-heal 把 json_schema **一刀切降到 none**（直接 prompt），浪费了多数
   * provider 支持的 json_mode。本 helper 改成**沿派生链走下一档**：
   *   json_schema_strict → json_schema → json_mode → prompt(映射为 none)
   * `current` 传 effectiveNativeMode（当前真实上线值，可能已被上次 self-heal
   * override 改过）→ 多步降级天然成立：下次失败时 current 已是 json_mode，
   * 再降到 prompt→none。
   *
   * @returns { fromValue, toValue } 给 trigger；无法判定（未知模型 / 已到链尾）返 null
   */
  protected computeSelfHealDegrade(
    provider: string,
    modelId: string,
    current:
      | import("../models/capability/model-capability.types").NativeStructuredOutputMode
      | null,
  ): { fromValue: string; toValue: string } | null {
    if (!this.capabilityService || !provider?.trim() || !current) return null;
    const projection: AIModelConfig = {
      id: "",
      name: "",
      displayName: "",
      provider,
      modelId,
      apiEndpoint: "",
      apiKey: null,
      maxTokens: 0,
      temperature: 0,
      isEnabled: true,
      isDefault: false,
    };
    const caps = this.capabilityService.resolveCapabilities(projection);
    const chain = this.capabilityService.deriveStructuredOutputChain(caps);
    const idx = chain.indexOf(current);
    if (idx < 0 || idx >= chain.length - 1) return null; // 未知 / 已到链尾
    const next = chain[idx + 1];
    // 链尾 prompt 不是合法 nativeMode → 映射为 none（同义：不发 response_format）
    return { fromValue: current, toValue: next === "prompt" ? "none" : next };
  }

  /**
   * F3 (2026-05-25): 判断错误是否为"结构化输出格式被拒"（4xx + 提到
   * response_format / json_schema / format）。用于 in-request 当次降级判定 ——
   * 只对真·格式错误重试，避免对 context-too-long / auth 等其它 4xx 浪费重试。
   */
  protected isStructuredOutputRejection(err: unknown): boolean {
    const sig = extractErrorSignal(err);
    if (!sig || (sig.httpStatus !== 400 && sig.httpStatus !== 422))
      return false;
    const hay = `${sig.errorCode} ${sig.bodySnippet}`.toLowerCase();
    return /response_format|json_schema|json schema|structured|format.*(unavailable|not.*support|unsupported)/.test(
      hay,
    );
  }

  /**
   * OpenAI-compatible providers only accept role:"tool" when paired with a
   * native tool_call_id. Prompt-driven ReAct observations do not have that id,
   * so they must be downgraded to plain user messages instead of emitting an
   * invalid tool protocol payload that strict providers reject.
   */
  protected buildOpenAICompatibleMessages(messages: ChatMessage[]) {
    return messages.map((m) => {
      const isNativeToolResult = m.role === "tool" && !!m.toolCallId;
      const openAIContent = resolveOpenAIContent(m);
      const role = isNativeToolResult
        ? "tool"
        : m.role === "tool"
          ? "user"
          : m.role;
      const content =
        m.role === "tool" && !m.toolCallId
          ? `[tool_result${m.name ? `:${m.name}` : ""}]\n${
              typeof openAIContent === "string"
                ? openAIContent
                : JSON.stringify(openAIContent)
            }`
          : openAIContent;
      const base: Record<string, unknown> = { role, content };
      if (isNativeToolResult) {
        base.tool_call_id = m.toolCallId;
      }
      if (m.name && role !== "user") {
        base.name = m.name;
      }
      return base;
    });
  }

  protected buildOpenAICompatibleTools(tools?: FunctionDefinition[]) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
      },
    }));
  }

  protected extractOpenAICompatibleToolCalls(
    messageObj: Record<string, unknown> | undefined,
  ): ChatCompletionResult["toolCalls"] {
    const raw = messageObj?.tool_calls;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw
      .map((call) => {
        if (!call || typeof call !== "object") return null;
        const c = call as {
          id?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        };
        const id = typeof c.id === "string" ? c.id : undefined;
        const name =
          typeof c.function?.name === "string" ? c.function.name : undefined;
        const rawArgs = c.function?.arguments;
        let args: Record<string, unknown> = {};
        if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
          args = rawArgs as Record<string, unknown>;
        } else if (typeof rawArgs === "string" && rawArgs.trim().length > 0) {
          try {
            const parsed = JSON.parse(rawArgs);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            return null;
          }
        }
        if (!id || !name) return null;
        return { id, name, arguments: args };
      })
      .filter(
        (
          call,
        ): call is {
          id: string;
          name: string;
          arguments: Record<string, unknown>;
        } => call !== null,
      );
  }

  /**
   * 检测并记录异常大请求（>100K tokens），帮助快速定位 prompt 膨胀来源
   */
  protected logOversizedRequest(
    provider: string,
    modelId: string,
    estimatedTokens: number,
    estimatedChars: number,
    messages: ReadonlyArray<Record<string, unknown>>,
  ): void {
    if (estimatedTokens <= OVERSIZED_REQUEST_TOKEN_THRESHOLD) return;
    const messageSizes = messages.map((m, i) => {
      const size =
        typeof m.content === "string"
          ? m.content.length
          : JSON.stringify(m.content).length;
      return `msg[${i}](${m.role}): ${size} chars`;
    });
    this.logger.error(
      `[${provider}] ⚠ OVERSIZED REQUEST detected: model=${modelId}, ` +
        `estimatedTokens=${estimatedTokens}, totalChars=${estimatedChars}, ` +
        `msgs=${messages.length}, breakdown=[${messageSizes.join(", ")}]. ` +
        `Stack: ${new Error().stack
          ?.split("\n")
          .slice(1, 1 + STACK_CONTEXT_LINES)
          .join(" → ")}`,
    );
  }

  // ==================== Structured Output Adapter Helper ====================

  /**
   * Returns the IStructuredOutputAdapter instance for the given strategy.
   * Uses simple lazy-init singleton map — no DI needed (adapters are stateless).
   */
  protected readonly _soAdapters = new Map<
    StructuredOutputStrategy,
    {
      adapt: (input: {
        jsonSchema: Record<string, unknown>;
        schemaName: string;
        modelId: string;
      }) => {
        requestBodyPatch: Record<string, unknown>;
        systemPromptAddon?: string;
      };
    }
  >([
    ["json_schema_strict", new JsonSchemaStrictAdapter()],
    ["json_schema", new JsonSchemaAdapter()],
    ["json_mode", new JsonModeAdapter()],
    ["tool_use", new AnthropicToolUseAdapter()],
    ["anthropic_output_config", new AnthropicOutputConfigAdapter()],
    ["gemini_response_schema", new GeminiResponseSchemaAdapter()],
    ["gbnf_grammar", new GbnfGrammarAdapter()],
    ["prompt", new PromptOnlyAdapter()],
  ]);

  protected getStructuredOutputAdapter(strategy: StructuredOutputStrategy): {
    adapt: (input: {
      jsonSchema: Record<string, unknown>;
      schemaName: string;
      modelId: string;
    }) => {
      requestBodyPatch: Record<string, unknown>;
      systemPromptAddon?: string;
    };
  } {
    return this._soAdapters.get(strategy) ?? new PromptOnlyAdapter();
  }
}

/**
 * Embedding 调用失败时包装错误：
 *   - 把 429 响应里的 Retry-After header 提到 message 里（[retry-after=Ns]）
 *     让外层节流读到精确秒数，否则只能粗估 60s。
 *   - 保留原始 message + status，便于上游分类。
 */
export function wrapEmbeddingError(error: unknown): Error {
  if (!error || typeof error !== "object") {
    return error instanceof Error ? error : new Error(String(error));
  }
  const err = error as {
    response?: {
      status?: number;
      headers?: Record<string, string | string[] | undefined>;
      data?: unknown;
    };
    message?: string;
  };
  const status = err.response?.status;
  const headers = err.response?.headers ?? {};
  // 大小写都查，axios/got 不一致
  const retryAfterRaw =
    headers["retry-after"] ?? headers["Retry-After"] ?? undefined;
  const retryAfter = Array.isArray(retryAfterRaw)
    ? retryAfterRaw[0]
    : retryAfterRaw;

  let suffix = "";
  if (status === 429 && retryAfter) {
    // Retry-After 可以是秒数（"17"）或 HTTP date；秒数最常见
    const secs = Number.parseInt(String(retryAfter), 10);
    if (Number.isFinite(secs) && secs > 0 && secs < 3600) {
      suffix = ` [retry-after=${secs}s]`;
    }
  }

  // ★ 2026-05-13: 提取 OpenAI / Cohere / Google 400/422 错误 body 里的真实
  //   message（"model does not exist" / "Input must be non-empty" / 维度错），
  //   原版只透传 axios "Request failed with status code 400" 没有 actionable 信息
  //   → 运维看到一片 400 不知道改哪。
  let bodyMsg = "";
  const data = err.response?.data as Record<string, unknown> | undefined;
  if (data && typeof data === "object") {
    const errField = data.error;
    if (typeof errField === "string") {
      bodyMsg = errField;
    } else if (errField && typeof errField === "object") {
      const m = (errField as { message?: unknown }).message;
      if (typeof m === "string") bodyMsg = m;
    } else if (typeof data.message === "string") {
      bodyMsg = data.message;
    }
  }
  if (bodyMsg) {
    suffix += ` [body=${bodyMsg.slice(0, 200)}]`;
  }

  const baseMsg = err.message ?? String(err);
  const wrapped = new Error(`${baseMsg}${suffix}`);
  // 保留 axios shape 让上游 isRateLimitError 仍能识别 429
  (wrapped as unknown as { response: unknown }).response = err.response;
  return wrapped;
}

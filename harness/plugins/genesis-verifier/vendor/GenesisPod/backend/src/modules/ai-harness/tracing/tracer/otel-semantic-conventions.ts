/**
 * OTel GenAI Semantic Conventions 适配器 (PR-U)
 *
 * 基于 https://github.com/open-telemetry/semantic-conventions/blob/main/docs/gen-ai/
 * 把 GenesisPod 内部 span attributes 映射到标准 OTel GenAI 字段，让 DataDog / Honeycomb /
 * Jaeger / Grafana Tempo 等工具能直接消费。
 *
 * 关键标准字段：
 *   - gen_ai.system            (anthropic / openai / google / ...)
 *   - gen_ai.request.model
 *   - gen_ai.request.temperature
 *   - gen_ai.request.max_tokens
 *   - gen_ai.usage.input_tokens
 *   - gen_ai.usage.output_tokens
 *   - gen_ai.usage.cache_read_input_tokens   (Anthropic 扩展)
 *   - gen_ai.response.finish_reasons
 *   - gen_ai.operation.name    (chat / tool_call / embedding / ...)
 *
 * 业务自定义字段保留 'genesis.*' 前缀，与标准字段共存。
 */

export interface RawSpanAttributes {
  agentId?: string;
  loopKind?: string;
  modelId?: string;
  toolName?: string;
  toolId?: string;
  callId?: string;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  costUsd?: number;
  finishReason?: string;
  temperature?: number;
  maxTokens?: number;
  truncated?: boolean;
  success?: boolean;
  durationMs?: number;
  /** provider 返回的 response id（OTel gen_ai.response.id） */
  responseId?: string;
  /** 输入 / 输出（脱敏后才传，OTel 不强制） */
  input?: unknown;
  output?: unknown;
  /** 业务任意补充 */
  [key: string]: unknown;
}

/**
 * 推断 GenAI system —— 业界 OTel GenAI 标准要求 system 字段。
 * 通过 modelId 启发式判断（'claude-*' → anthropic, 'gpt-*' → openai 等）。
 */
function detectSystem(modelId?: string): string {
  if (!modelId) return "unknown";
  const m = modelId.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  // o-series 用正则覆盖未来型号 (o4/o5/o6...)，不用每次新模型改代码
  if (m.startsWith("gpt") || /^o\d/.test(m)) return "openai";
  if (m.startsWith("gemini") || m.startsWith("text-bison")) return "google";
  if (m.startsWith("grok")) return "xai";
  if (m.startsWith("mistral") || m.startsWith("mixtral")) return "mistral";
  if (m.startsWith("llama")) return "meta";
  return "unknown";
}

/**
 * 推断 operation name —— 优先用 caller 显式 loopKind（权威信号），再退回 spanName 启发式。
 * 修复评估 G8「heuristic 把一切塌成 chat」：agent loop 迭代映射为 OTel 标准 invoke_agent，
 * 工具执行 execute_tool，嵌入 embeddings；其余才 chat。
 */
function detectOperation(spanName: string, raw: RawSpanAttributes): string {
  const lower = spanName.toLowerCase();
  // 工具执行优先（span 名或 raw.tool* 任一命中）
  if (lower.startsWith("tool.") || raw.toolName || raw.toolId) {
    return "execute_tool";
  }
  if (lower.includes("embed")) return "embeddings";
  // loopKind 是 runner 显式传入的权威信号（react / reflexion / plan-act /
  // leader-worker / simple）→ 这是 agent 调用而非裸 chat completion。
  if (raw.loopKind) return "invoke_agent";
  return "chat";
}

/**
 * 把 GenesisPod raw attributes 转成 OTel GenAI semantic conventions 兼容的属性集。
 * 标准字段优先；业务字段保留前缀。
 */
export function toOtelGenAiAttributes(
  spanName: string,
  raw: RawSpanAttributes,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "gen_ai.operation.name": detectOperation(spanName, raw),
  };

  if (raw.modelId) {
    out["gen_ai.system"] = detectSystem(raw.modelId);
    out["gen_ai.request.model"] = raw.modelId;
    out["gen_ai.response.model"] = raw.modelId;
  }
  if (raw.responseId) out["gen_ai.response.id"] = raw.responseId;
  // 失败时按 OTel 语义补 error.type（让后端能按错误类型聚合 span）
  if (raw.success === false) {
    out["error.type"] = raw.finishReason ?? "agent_error";
  }
  if (typeof raw.temperature === "number")
    out["gen_ai.request.temperature"] = raw.temperature;
  if (typeof raw.maxTokens === "number")
    out["gen_ai.request.max_tokens"] = raw.maxTokens;

  if (typeof raw.promptTokens === "number")
    out["gen_ai.usage.input_tokens"] = raw.promptTokens;
  if (typeof raw.completionTokens === "number")
    out["gen_ai.usage.output_tokens"] = raw.completionTokens;
  if (typeof raw.cacheReadTokens === "number" && raw.cacheReadTokens > 0)
    out["gen_ai.usage.cache_read_input_tokens"] = raw.cacheReadTokens;

  if (raw.finishReason) {
    out["gen_ai.response.finish_reasons"] = [raw.finishReason];
  }

  // Tool 调用专属字段（OTel GenAI gen_ai.tool.*）
  if (raw.toolName || raw.toolId) {
    out["gen_ai.tool.name"] = raw.toolName ?? raw.toolId;
    if (raw.callId) out["gen_ai.tool.call.id"] = raw.callId;
  }

  // GenesisPod 自定义字段 —— 'genesis.*' 前缀，与标准并存
  if (raw.agentId) out["genesis.agent.id"] = raw.agentId;
  if (raw.loopKind) out["genesis.loop.kind"] = raw.loopKind;
  if (typeof raw.costUsd === "number") out["genesis.cost.usd"] = raw.costUsd;
  if (typeof raw.truncated === "boolean")
    out["genesis.tool.truncated"] = raw.truncated;
  if (typeof raw.success === "boolean") out["genesis.success"] = raw.success;
  if (typeof raw.durationMs === "number")
    out["genesis.duration.ms"] = raw.durationMs;

  // 透传未识别字段（保留 caller 自定义）
  for (const [k, v] of Object.entries(raw)) {
    if (k in out) continue;
    if (
      [
        "agentId",
        "loopKind",
        "modelId",
        "toolName",
        "toolId",
        "callId",
        "promptTokens",
        "completionTokens",
        "cacheReadTokens",
        "costUsd",
        "finishReason",
        "temperature",
        "maxTokens",
        "truncated",
        "success",
        "durationMs",
        "responseId",
        "input",
        "output",
      ].includes(k)
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

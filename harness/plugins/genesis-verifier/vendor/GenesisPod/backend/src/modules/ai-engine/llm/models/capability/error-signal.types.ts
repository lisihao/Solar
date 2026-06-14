/**
 * v3.1 §B.5 错误信号契约 + 严格解析 —— self-heal 的输入面
 *
 * 4 重严校（§4.3）由 capability-self-heal.service 实现，本文件仅负责：
 *   1. 从原始 axios/fetch 错误对象 **严格** 抽取 (httpStatus, errorCode, bodySnippet, provider?)
 *   2. 分 provider 形态（OpenAI/Anthropic/Google/xAI/unknown）解析 error code
 *   3. body 脱敏（API key / token / Authorization 头）
 *   4. fail-open：任何解析异常返 null（self-heal 后台路径，不能因解析失败阻断业务）
 *
 * 严格性原则（v3.1 §4.3 D7）：
 *   - httpStatus 只接受 `e.status` 或 `e.response.status`（数字），不接受 message 推断
 *   - errorCode 按 provider 形态从特定 body 字段取（不接受 message 关键字嗅探）
 *   - 任一关键字段缺失 → 返 null（拒绝弱信号触发 self-heal）
 */

export type SignalProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "unknown";

export interface ErrorSignal {
  /** HTTP status code（4xx 范围才会被 self-heal 接受） */
  httpStatus: number;
  /** provider error code（如 'invalid_request_error', 'INVALID_ARGUMENT', 'unsupported_response_format'） */
  errorCode: string;
  /** 响应体片段（截断 200 字符 + 已脱敏 API key / token / Authorization） */
  bodySnippet: string;
  /** provider 形态分类（self-heal 可选用于精细判断；解析失败回退 'unknown'） */
  provider?: SignalProvider;
}

/**
 * 退化输出（degenerate-success）合成信号常量。
 *
 * 部分模型对被强制的 response_format **接受**（HTTP 200）却吐空/畸形输出，
 * 没有 4xx 可供 {@link extractErrorSignal} 解析。此时 caller 用本常量构造一个
 * 合成 ErrorSignal 走同一条 self-heal 路径 —— httpStatus=200 + 这个独有 errorCode
 * 是"退化输出"的唯一标记（真实 provider 响应永不产生该 code），self-heal 据此
 * 把 nativeMode 持久化降档。
 */
export const DEGENERATE_OUTPUT_ERROR_CODE = "degenerate_output";

/**
 * 构造"退化输出"合成 ErrorSignal（供 self-heal 持久化能力降档）。
 * bodySnippet 由 caller 提供（应含 fromValue / 'nativeMode' 以通过 self-heal 的
 * body 证据校验），此处统一脱敏 + 截断。
 */
export function buildDegenerateOutputSignal(bodySnippet: string): ErrorSignal {
  return {
    httpStatus: 200,
    errorCode: DEGENERATE_OUTPUT_ERROR_CODE,
    bodySnippet: sanitizeBody(bodySnippet ?? "").slice(0, 200),
    provider: "unknown",
  };
}

// ──────────── 脱敏工具 ────────────

/**
 * body 脱敏：替换可能泄露的 API key / token / Authorization 值。
 *
 * 覆盖：
 *   - "api_key": "sk-XXXX"        → "api_key": "***REDACTED***"
 *   - "authorization": "Bearer X" → "authorization": "***REDACTED***"
 *   - "token": "xxx"              → "token": "***REDACTED***"
 *   - sk-... / xai-... / sk-ant-... 等明显前缀的裸串
 */
function sanitizeBody(s: string): string {
  if (!s) return s;
  return s
    .replace(
      /("?(?:api[_-]?key|authorization|bearer|token|secret)"?\s*[:=]\s*")[^"]+(")/gi,
      "$1***REDACTED***$2",
    )
    .replace(/\b(sk-(?:proj-)?[A-Za-z0-9_-]{10,})\b/g, "***REDACTED***")
    .replace(/\b(sk-ant-[A-Za-z0-9_-]{10,})\b/g, "***REDACTED***")
    .replace(/\b(xai-[A-Za-z0-9_-]{10,})\b/g, "***REDACTED***");
}

// ──────────── provider 形态分类 ────────────

/**
 * 通过 endpoint host / response 形状嗅探 provider 形态。
 *
 * 优先级：
 *   1. e.config.url host 包含 anthropic / openai / google / xai / x.ai
 *   2. response.data 形状（OpenAI: error.{code,type,message}；Anthropic: error.{type,message}；
 *      Google: error.{code,status,message}）
 *   3. 都没 → 'unknown'
 */
function detectProvider(e: {
  config?: { url?: string };
  response?: { data?: unknown };
}): SignalProvider {
  const url = (e.config?.url ?? "").toLowerCase();
  if (url.includes("anthropic")) return "anthropic";
  if (url.includes("googleapis") || url.includes("generativelanguage"))
    return "google";
  if (url.includes("x.ai") || url.includes("xai")) return "xai";
  if (url.includes("openai")) return "openai";

  // 形状嗅探（fallback）
  const data = e.response?.data;
  if (data && typeof data === "object") {
    const d = data as { error?: unknown };
    if (d.error && typeof d.error === "object") {
      const err = d.error as {
        type?: unknown;
        code?: unknown;
        status?: unknown;
        message?: unknown;
      };
      // Google 形态：含 status (string) 字段
      if (typeof err.status === "string") return "google";
      // OpenAI 形态：含 type + code
      if (typeof err.type === "string" && typeof err.code === "string")
        return "openai";
      // Anthropic 形态：含 type 但无 code（or only type）
      if (typeof err.type === "string") return "anthropic";
    }
  }
  return "unknown";
}

// ──────────── 严格解析 ────────────

/**
 * 严格抽取 errorCode（不接受 message 关键字嗅探）。
 *
 * - OpenAI: `error.code` 优先，回退 `error.type`
 * - Anthropic: `error.type`
 * - Google: `error.status`（如 'INVALID_ARGUMENT'）优先，回退 `error.code` 转字符串
 * - xAI: 同 OpenAI（OpenAI-compatible API）
 * - unknown: 尝试 error.code / error.type / error.status 任一
 *
 * 解析不到 → "unknown"（不抛错）
 */
function extractErrorCode(provider: SignalProvider, data: unknown): string {
  if (!data || typeof data !== "object") return "unknown";
  const root = data as { error?: unknown };
  const err = root.error;
  if (!err || typeof err !== "object") return "unknown";
  const e = err as {
    code?: unknown;
    type?: unknown;
    status?: unknown;
  };

  if (provider === "openai" || provider === "xai") {
    if (typeof e.code === "string" && e.code.length > 0) return e.code;
    if (typeof e.type === "string" && e.type.length > 0) return e.type;
    return "unknown";
  }
  if (provider === "anthropic") {
    if (typeof e.type === "string" && e.type.length > 0) return e.type;
    return "unknown";
  }
  if (provider === "google") {
    if (typeof e.status === "string" && e.status.length > 0) return e.status;
    if (typeof e.code === "number") return String(e.code);
    if (typeof e.code === "string" && e.code.length > 0) return e.code;
    return "unknown";
  }
  // unknown provider
  if (typeof e.code === "string" && e.code.length > 0) return e.code;
  if (typeof e.type === "string" && e.type.length > 0) return e.type;
  if (typeof e.status === "string" && e.status.length > 0) return e.status;
  return "unknown";
}

/**
 * 从原始错误对象严格抽取 ErrorSignal。
 *
 * 严格规则（与 stub 版相比）：
 *   - httpStatus 必须从 `e.status` 或 `e.response.status` 取（数字），不接受 message 推断
 *   - errorCode 按 provider 形态从特定字段取（OpenAI: error.code/type；Anthropic: error.type；
 *     Google: error.status/code；xAI: 同 OpenAI；unknown 尽力而为）
 *   - bodySnippet 来自 `e.response.data`（JSON.stringify slice 200），脱敏后返回
 *   - httpStatus 缺失 / 非数字 → 返 null（拒绝弱信号触发 self-heal）
 *   - 解析异常 → 返 null（fail-open，self-heal 后台路径不能因此挂业务）
 */
export function extractErrorSignal(rawError: unknown): ErrorSignal | null {
  if (rawError === null || rawError === undefined) return null;

  try {
    const e = rawError as {
      status?: number;
      response?: { status?: number; data?: unknown };
      config?: { url?: string };
    };

    // 1. httpStatus 严格：必须是数字
    const httpStatus =
      typeof e.status === "number"
        ? e.status
        : typeof e.response?.status === "number"
          ? e.response.status
          : null;
    if (httpStatus === null) return null;

    // 2. provider 形态分类
    const provider = detectProvider(e);

    // 3. errorCode 严格：按 provider 形态取
    const errorCode = extractErrorCode(provider, e.response?.data);

    // 4. bodySnippet 脱敏
    let bodyRaw = "";
    const data = e.response?.data;
    if (typeof data === "string") {
      bodyRaw = data;
    } else if (data !== undefined) {
      try {
        bodyRaw = JSON.stringify(data);
      } catch {
        bodyRaw = "";
      }
    }
    const bodySnippet = sanitizeBody(bodyRaw).slice(0, 200);

    return { httpStatus, errorCode, bodySnippet, provider };
  } catch {
    // fail-open: 任何解析异常返 null
    return null;
  }
}

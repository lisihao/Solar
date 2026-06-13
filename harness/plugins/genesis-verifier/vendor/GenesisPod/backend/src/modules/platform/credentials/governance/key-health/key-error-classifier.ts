import { Injectable } from "@nestjs/common";
import { KEY_COOLDOWN_MS } from "./key-cooldown-policy";

/**
 * KeyErrorClassifier — 把 raw error 映射为统一的失效响应决策。
 *
 * 设计目标（2026-05-05 立项）：
 * - chat / embedding / rerank / 工具 key 全部走同一分类逻辑，避免每处自写 if-else
 * - 区分 key-级故障（401/429/quota）vs provider-级故障（5xx/connection refused）
 * - 决策输出由 KeyExecutor 直接消费：action/cooldownMs/markDead/shouldStopChain
 */

export type KeyErrorAction =
  | "NEXT_KEY" // 切下一把 key 继续
  | "RETHROW"; // 直接抛错，不切换（链路终止）

export type KeyErrorReason =
  | "AUTH_FAILED" // 401/403 → key 失效，标 DEAD
  | "RATE_LIMIT_KEY" // 429 单 key 限流（短 cooldown）
  | "RATE_LIMIT_PROVIDER" // 429 provider 级（长 cooldown + stopChain）
  | "QUOTA_EXCEEDED" // 402 / 用户配额耗尽（长 cooldown，不标 dead）
  | "REQUEST_TOO_LARGE" // 413 / 单请求体积超 model/provider 上限（如 Groq TPM）→ 换 model 而非换 key
  | "TIMEOUT" // 请求超时（短 cooldown）
  | "PROVIDER_DOWN" // 5xx / connection refused（provider 级 cooldown + stopChain）
  | "UNKNOWN"; // 未知错误，保守 RETHROW，不重试避免 cascading

export interface ClassifiedError {
  readonly action: KeyErrorAction;
  readonly reason: KeyErrorReason;
  /**
   * key 自身的 cooldown 时长（ms）。Number.POSITIVE_INFINITY = 永久 cooldown 直到手动 reset。
   * action=RETHROW 时此字段对 key 无意义，但 shouldStopChain=true 会用它做 provider 级 cooldown。
   */
  readonly cooldownMs: number;
  /** 是否标 DEAD（永久不可用直到 user 手动 re-test） */
  readonly markDead: boolean;
  /** 是否终止整个 chain（provider-级故障，所有 key 都不会成功） */
  readonly shouldStopChain: boolean;
  /** 原 error message（log + UI 用） */
  readonly originalMessage: string;
  /** HTTP status（如有） */
  readonly httpStatus?: number;
}

// W1 (2026-05-29)：cooldown 时长统一引用共享策略 key-cooldown-policy（单一真源）。值不变。
const COOLDOWN_60S = KEY_COOLDOWN_MS.RATE_LIMIT;
const COOLDOWN_30S = KEY_COOLDOWN_MS.SHORT;
const COOLDOWN_5MIN = KEY_COOLDOWN_MS.PROVIDER_OR_UNKNOWN;
const COOLDOWN_INF = KEY_COOLDOWN_MS.INFINITE;
// A 429 whose retry-after exceeds this is quota/daily-cap exhaustion, not a
// transient burst limit → escalate to a permanent (quota) cooldown.
const ONE_HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class KeyErrorClassifier {
  classify(err: unknown): ClassifiedError {
    const message = this.extractMessage(err);
    const status = this.extractStatus(err);
    const lowerMsg = message.toLowerCase();

    // 1. AUTH_FAILED — 401 / 403 / "invalid api key" / "unauthorized"
    if (
      status === 401 ||
      status === 403 ||
      /unauthorized|invalid[\s_-]?api[\s_-]?key|invalid[\s_-]?authentication|api[\s_-]?key[\s_-]?(?:not[\s_-]?valid|invalid|expired|revoked)|forbidden/i.test(
        message,
      )
    ) {
      return this.build({
        action: "NEXT_KEY",
        reason: "AUTH_FAILED",
        cooldownMs: COOLDOWN_INF,
        markDead: true,
        shouldStopChain: false,
        message,
        status,
      });
    }

    // 1.5 REQUEST_TOO_LARGE — 413 / "request too large" / "reduce message size"
    //   单请求体积超过该 model/provider 的上限（典型：Groq 对大模型的 TPM 上限，
    //   55k token 单请求被拒）。换 key 没用（同 org 共享 TPM，每把都会同样被拒），
    //   只有换 model 才有用 → RETHROW 把原始错误抛给上层 model-failover 接管；
    //   provider 仅给短 cooldown（TPM 分钟级自动恢复），绝不像 quota 那样 ∞ cooldown。
    //   ★ 必须排在 QUOTA / RATE_LIMIT 之前：避免 "Request too large ... tokens per
    //   minute" 这类带 "rate" 字样的 TPM 文案被误归为可重试的限流 / quota（→ 关掉 failover）。
    if (
      status === 413 ||
      /request[\s_-]?too[\s_-]?large|too[\s_-]?large[\s_-]?for[\s_-]?model|reduce[\s_-]?your[\s_-]?(?:message|prompt)[\s_-]?size|payload[\s_-]?too[\s_-]?large/i.test(
        message,
      )
    ) {
      return this.build({
        action: "RETHROW", // 换 key 无用 → 直接抛原始错误，让 model-failover 换模型
        reason: "REQUEST_TOO_LARGE",
        cooldownMs: COOLDOWN_60S, // 短冷却（单 key 会被 SINGLE_KEY_COOLDOWN_CAP 进一步压到 30s）
        markDead: false,
        shouldStopChain: true, // model/provider 级体积上限，其余 key 同样会拒
        message,
        status,
      });
    }

    // 2. QUOTA / PAYMENT — 402 / "insufficient quota" / "billing" / daily-limit
    // NB: a "daily request limit / unpaid / add credits" failure usually arrives
    // as HTTP 429, but it is QUOTA exhaustion (won't recover for hours, needs
    // billing), NOT a transient rate-limit. It must land here (COOLDOWN_INF) so
    // KeyHealthStore.filterUsable EXCLUDES it — otherwise the single-key degraded
    // fallback re-serves the dead key and the caller retries it in a tight loop.
    if (
      status === 402 ||
      /insufficient[\s_-]?quota|quota[\s_-]?exceeded|billing|insufficient[\s_-]?(?:credits|balance)|exceeded[\s_-]?your[\s_-]?current[\s_-]?quota|daily[\s_-]?(?:request[\s_-]?)?limit|requests?[\s_-]?per[\s_-]?day|unpaid|add[\s_-]?credits|remove[\s_-]?this[\s_-]?daily[\s_-]?limit/i.test(
        message,
      )
    ) {
      return this.build({
        action: "NEXT_KEY",
        reason: "QUOTA_EXCEEDED",
        cooldownMs: COOLDOWN_INF, // 等账单恢复才能用，但不标 dead（key 本身没坏）
        markDead: false,
        shouldStopChain: false,
        message,
        status,
      });
    }

    // 3. RATE_LIMIT — 429
    if (
      status === 429 ||
      /rate[\s_-]?limit|too[\s_-]?many[\s_-]?requests/i.test(message)
    ) {
      const retryAfter = this.extractRetryAfter(err);
      // A 429 with an hours-long retry-after is a quota/daily-cap exhaustion in
      // disguise, not a transient burst limit. Treat it as QUOTA (permanent
      // cooldown, excluded from the single-key degraded fallback) so we stop
      // re-serving and retrying a key that won't recover for hours.
      if (retryAfter != null && retryAfter > ONE_HOUR_MS) {
        return this.build({
          action: "NEXT_KEY",
          reason: "QUOTA_EXCEEDED",
          cooldownMs: COOLDOWN_INF,
          markDead: false,
          shouldStopChain: false,
          message,
          status,
        });
      }
      return this.build({
        action: "NEXT_KEY",
        reason: "RATE_LIMIT_KEY",
        cooldownMs: retryAfter ?? COOLDOWN_60S,
        markDead: false,
        shouldStopChain: false, // KeyHealthStore 启发式（30s 内 ≥2 key 429）会升级为 provider-级
        message,
        status,
      });
    }

    // 4. PROVIDER_DOWN — 5xx / connection refused / ENOTFOUND
    if (
      (typeof status === "number" && status >= 500 && status < 600) ||
      /econnrefused|econnreset|enotfound|socket[\s_-]?hang[\s_-]?up|network[\s_-]?error|service[\s_-]?unavailable|bad[\s_-]?gateway|gateway[\s_-]?timeout/i.test(
        lowerMsg,
      )
    ) {
      return this.build({
        action: "RETHROW",
        reason: "PROVIDER_DOWN",
        cooldownMs: COOLDOWN_5MIN,
        markDead: false,
        shouldStopChain: true,
        message,
        status,
      });
    }

    // 5. TIMEOUT — ETIMEDOUT / "timeout"
    if (/etimedout|timeout|timed[\s_-]?out|aborted/i.test(lowerMsg)) {
      return this.build({
        action: "NEXT_KEY",
        reason: "TIMEOUT",
        cooldownMs: COOLDOWN_30S,
        markDead: false,
        shouldStopChain: false,
        message,
        status,
      });
    }

    // 6. UNKNOWN — 不重试避免 cascading
    return this.build({
      action: "RETHROW",
      reason: "UNKNOWN",
      cooldownMs: 0,
      markDead: false,
      shouldStopChain: true,
      message,
      status,
    });
  }

  private build(args: {
    action: KeyErrorAction;
    reason: KeyErrorReason;
    cooldownMs: number;
    markDead: boolean;
    shouldStopChain: boolean;
    message: string;
    status?: number;
  }): ClassifiedError {
    return {
      action: args.action,
      reason: args.reason,
      cooldownMs: args.cooldownMs,
      markDead: args.markDead,
      shouldStopChain: args.shouldStopChain,
      originalMessage: args.message,
      httpStatus: args.status,
    };
  }

  private extractMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
    return String(err);
  }

  private extractStatus(err: unknown): number | undefined {
    if (!err || typeof err !== "object") {
      // String errors can still carry the status in their text.
      return this.statusFromMessage(typeof err === "string" ? err : "");
    }
    const e = err as Record<string, unknown>;
    // axios style
    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
    // openai sdk style: err.status / err.response.status
    const response = e.response as Record<string, unknown> | undefined;
    if (response && typeof response.status === "number") return response.status;
    // Fallback: streaming / re-wrapped provider errors often lose the structured
    // status and only keep axios' default text ("Request failed with status code
    // 402"). Parse it so the classifier still distinguishes 402/429/5xx — without
    // this a quota 402 on the streaming path falls through to UNKNOWN (no
    // cooldown), so the quota-dead key is never marked and keeps being elected.
    return this.statusFromMessage(this.extractMessage(err));
  }

  /** Best-effort HTTP status recovery from an error's text. */
  private statusFromMessage(message: string): number | undefined {
    const m = message.match(/status(?:\s*code)?[:\s]+(\d{3})\b/i);
    if (m) {
      const n = Number(m[1]);
      if (n >= 100 && n < 600) return n;
    }
    return undefined;
  }

  private extractRetryAfter(err: unknown): number | null {
    if (!err || typeof err !== "object") return null;
    const e = err as Record<string, unknown>;
    const headers =
      ((e.response as Record<string, unknown> | undefined)?.headers as
        | Record<string, unknown>
        | undefined) || (e.headers as Record<string, unknown> | undefined);
    if (!headers) return null;
    const rawRetryAfter =
      headers["retry-after"] ??
      headers["Retry-After"] ??
      headers["RETRY-AFTER"];
    if (rawRetryAfter === undefined || rawRetryAfter === null) return null;
    const seconds = Number(rawRetryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    return null;
  }
}

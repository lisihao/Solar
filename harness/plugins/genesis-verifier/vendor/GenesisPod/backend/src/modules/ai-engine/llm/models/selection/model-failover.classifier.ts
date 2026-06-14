/**
 * Model-level failover classifier (L2 ai-engine).
 *
 * Single source of truth for "should this thrown error trigger model-level
 * failover (re-elect a DIFFERENT model) vs. propagate as-is?". Lives in
 * ai-engine so both the L2 AiChatService (chat() single entry-point failover)
 * and the L2.5 ai-harness runner can share it — ai-harness may import from
 * ai-engine, but not the reverse.
 *
 * The L2.5 LlmExecutor re-exports `isModelLevelFailoverError` and
 * `MAX_MODEL_FAILOVERS` from here for backward-compatible imports.
 */

/**
 * BYOK error codes (raised by platform key-resolver as `BYOKError.code`) that
 * mean ALL keys for a model's provider failed — or none is configured. Each is
 * a PER-PROVIDER key problem, so the right recovery is switching to a DIFFERENT
 * model (a provider the user has a working key for), not terminating.
 *
 * Duck-typed by `.code` so this classifier does not import BYOKError across
 * layers. NO_MODEL_CONFIGURED is intentionally excluded: the account has no
 * models of this type at all, so failover cannot help (user must configure one
 * first).
 */
const BYOK_FAILOVER_CODES: ReadonlySet<string> = new Set([
  "NO_AVAILABLE_KEY",
  "INVALID_API_KEY",
  "QUOTA_EXCEEDED",
  "KEY_EXPIRED",
  "NO_SYSTEM_KEY",
]);

/**
 * Classify whether a thrown error should trigger model-level failover
 * (i.e. re-elect a different model) vs. being propagated as-is.
 *
 * Failover on:
 *   - BYOK key exhaustion (NO_AVAILABLE_KEY / INVALID_API_KEY / QUOTA_EXCEEDED /
 *     KEY_EXPIRED / NO_SYSTEM_KEY) — all keys for THIS model's provider failed,
 *     so a different model (different provider) may still work
 *   - PROVIDER_API_ERROR (5xx, generic provider failure)
 *   - model-not-found / unsupported (404, INVALID_MODEL)
 *   - request timeout
 *   - AllKeysFailedError / quota exhausted for all keys of that provider
 *
 * Do NOT failover on:
 *   - AbortError / user cancellation
 *   - account-level budget / credit exhausted (user needs to top up)
 *   - NO_MODEL_CONFIGURED (no models of this type → nothing to fail over to)
 *   - schema / input validation errors (wrong input, not a provider issue)
 */
export function isModelLevelFailoverError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);

  // Never failover on abort (user/signal cancellation)
  if (err instanceof DOMException && err.name === "AbortError") return false;
  // Match "aborted" only as a standalone word / phrase typical of signal abort,
  // NOT "ECONNABORTED" (that's a connection timeout, not a user abort).
  if (/\baborted\b/i.test(msg) && !/ECONNABORTED/i.test(msg)) return false;

  // ── BYOK key-exhaustion → model-level failover ──────────────────────────
  // Checked BEFORE the budget-message guard below: QuotaExceededError's message
  // ("Quota exceeded for provider X") would otherwise be misread as account-
  // level budget exhaustion and wrongly suppress failover. The `.code` is the
  // authoritative signal — a per-provider key problem, not an account problem.
  const byokCode = (err as { code?: unknown })?.code;
  if (typeof byokCode === "string" && BYOK_FAILOVER_CODES.has(byokCode)) {
    return true;
  }
  // Message-level safety net for BYOK key problems whose wording does NOT
  // collide with the account-budget guard below (no-key / invalid / revoked /
  // expired). Covers paths where the original BYOKError got re-wrapped and lost
  // its `.code`. QuotaExceededError is deliberately left to the `.code` path —
  // its message ("Quota exceeded ...") is indistinguishable from account budget.
  if (
    /no api key available|api key .*\b(invalid|revoked|expired)\b/i.test(msg)
  ) {
    return true;
  }

  // Request-too-large / payload-too-large (per-model/provider size cap — e.g.
  // Groq's tokens-per-minute limit rejecting a 55k-token research request). The
  // model's context window may be fine; it's the provider/tier request ceiling.
  // Switching to a higher-capacity model is the correct recovery → DO failover.
  // Checked BEFORE the budget guard so a size error whose wording happens to
  // carry a "quota"/"rate" token is never mistaken for billing exhaustion (which
  // would suppress failover and leave the mission dead).
  if (
    /request\s+too\s+large|too\s+large\s+for\s+model|reduce\s+your\s+(?:message|prompt)\s+size|payload\s+too\s+large|\b413\b/i.test(
      msg,
    )
  )
    return true;

  // Empty / degenerate model output: 200 OK but no usable content, or a
  // reasoning model that burned its whole budget on internal thinking and left
  // an empty content channel. The in-request degrade (ai-api-caller) already
  // tried dropping/stepping-down response_format; reaching here means the
  // current model+params reliably produce nothing usable, so switching to a
  // DIFFERENT model is the correct recovery. Checked BEFORE the budget guard so
  // these messages are never mistaken for billing exhaustion.
  if (
    /返回空响应|返回了空响应|empty\s+response|推理模型的\s*token\s*全部用于内部思考|响应被完全截断|degenerate[_\s]?output/i.test(
      msg,
    )
  )
    return true;

  // Provider free-tier DAILY request cap (e.g. tokenmix "Daily request limit
  // exceeded: 10 requests per day for unpaid users. Add credits..."). This is a
  // PER-PROVIDER cap, NOT an account-wide budget — a DIFFERENT provider/model may
  // still work, so DO failover. Placed BEFORE the budget guard so the "add
  // credits"/"limit exceeded" wording isn't misread as account exhaustion. Note
  // the message says "request limit" (not "rate limit") and carries no "quota"
  // token, so without this it would fall through to `return false` and the
  // mission would die on the first model instead of trying the others.
  if (
    /daily[\s_-]?(?:request[\s_-]?)?limit|requests?[\s_-]?per[\s_-]?day|remove[\s_-]?this[\s_-]?daily[\s_-]?limit/i.test(
      msg,
    )
  )
    return true;

  // Never failover on budget / billing exhaustion (user must act)
  if (
    /(insufficient[_\s-]?quota|exceeded[_\s\w]*quota|quota[_\s\w]*exceed|billing[_\s\w]*details|insufficient[_\s\w]*credit|insufficient[_\s\w]*balance|payment\s+required)/i.test(
      msg,
    )
  )
    return false;

  // Do failover on: provider 5xx / generic API error
  if (
    /5\d{2}|internal server error|service unavailable|bad gateway|gateway timeout/i.test(
      msg,
    )
  )
    return true;

  // Do failover on: model not found / unsupported
  if (
    /model.*not.*found|invalid[_\s-]?model|model_not_found|requested\s+resource\s+(was\s+)?not\s+found|docs\.x\.ai|model.*does.*not.*exist|404\b/i.test(
      msg,
    )
  )
    return true;

  // Do failover on: request timeout
  if (/timeout|timed?\s*out|ECONNABORTED/i.test(msg)) return true;

  // Do failover on: all keys for THIS provider exhausted (key-level failover
  // already tried all keys). Covers both the synthesized "AllKeysFailed" and the
  // real KeyExecutor wording "All N API key(s) for provider \"x\" failed".
  if (/AllKeysFailed|all\s+keys\s+failed|all\s+\d+\s+api\s+key/i.test(msg))
    return true;

  // Do failover on: rate limit / 429 (same-model key exhaustion)
  if (/rate.?limit|429|too many requests/i.test(msg)) return true;

  // Do failover on: PROVIDER_API_ERROR string (used by our own error wrappers)
  if (/PROVIDER_API_ERROR|provider.*error/i.test(msg)) return true;

  return false;
}

/**
 * Maximum number of distinct models to try before giving up.
 *
 * Sized for "many models, few usable" BYOK rosters: a user may have 10+ models
 * configured but only ONE with credits/a working key, and it may sit late in the
 * priority order. The real terminator is the failover provider returning null
 * (all candidates exhausted) — this cap is only an anti-runaway ceiling. With
 * provider-level exclusion (a failed provider skips ALL its models in one hop)
 * and failover NOT consuming the agent's iteration budget, a generous ceiling is
 * safe: each hop is a fast-failing call (per-key retry already exhausted).
 */
export const MAX_MODEL_FAILOVERS = 12;

/**
 * Schema Coercion Helpers
 *
 * Shared Zod fragments that absorb the most common drift between
 * frontier-model output (strict JSON, integers, enum-perfect) and
 * local / quantized / reasoning-model output (strings-for-numbers,
 * 60.0 for ints, novel enum tokens, etc.).
 *
 * Design goals:
 *   - Single source of truth — callers do not reinvent `.preprocess` chains
 *   - Fail-CLOSED: enum fallback defaults to the most conservative branch
 *     (e.g. "revise" / "fail"), never silently widens acceptance
 *   - Negative-value safe: numeric coercion clamps NaN / -∞, not falsy
 *   - Deterministic: same input → same output across runs
 */

import { z } from "zod";

/**
 * Coerce score-like fields (e.g. 0–100) where the model may emit:
 *   - "85" instead of 85
 *   - 85.0 instead of 85
 *   - " 85 " with whitespace
 *
 * Out-of-range values are clamped (not rejected), so a runaway 150 becomes
 * the configured max rather than aborting the whole pipeline.
 */
export const coercedScore = (
  min: number = 0,
  max: number = 100,
): z.ZodEffects<z.ZodNumber, number, unknown> =>
  z.preprocess(
    (v) => {
      if (typeof v === "number") return clampNumeric(v, min, max);
      if (typeof v === "string") {
        const n = Number(v.trim());
        if (Number.isFinite(n)) return clampNumeric(n, min, max);
      }
      // Let Zod's number() reject — surface explicit failure for null/undefined
      return v;
    },
    z.number().min(min).max(max),
  );

/**
 * Coerce integer-like fields where the model may emit "5" or 5.0.
 * Floats are floored (5.7 → 5) to keep counts intuitive.
 */
export const coercedInt = (
  min: number = 0,
  max: number = Number.MAX_SAFE_INTEGER,
): z.ZodEffects<z.ZodNumber, number, unknown> =>
  z.preprocess(
    (v) => {
      if (typeof v === "number" && Number.isFinite(v)) {
        return clampNumeric(Math.floor(v), min, max);
      }
      if (typeof v === "string") {
        const n = Number(v.trim());
        if (Number.isFinite(n)) {
          return clampNumeric(Math.floor(n), min, max);
        }
      }
      return v;
    },
    z.number().int().min(min).max(max),
  );

/**
 * Coerce an enum field with a **fail-CLOSED fallback**.
 *
 * When the model emits a value outside the allowed set (or null/undefined),
 * the resulting parse falls back to `defaultValue` — which MUST be the
 * conservative branch of the decision (e.g. "revise" for reviewer decisions,
 * "fail" for quality gates). NEVER pass the permissive branch ("pass") here
 * unless you have explicitly decided to fail-open.
 *
 * Case-insensitive matching: "Revise" / "REVISE" → "revise".
 */
export function coercedEnum<T extends readonly [string, ...string[]]>(
  values: T,
  defaultValue: T[number],
): z.ZodEffects<z.ZodEnum<[string, ...string[]]>, T[number], unknown> {
  if (!values.includes(defaultValue)) {
    throw new Error(
      `coercedEnum: defaultValue "${defaultValue}" must be one of [${values.join(", ")}]`,
    );
  }
  const lowered = new Map(values.map((v) => [v.toLowerCase(), v]));
  // Cast: zod v3 `z.enum` expects a mutable tuple, but our public API takes a
  // readonly tuple for safety. The runtime values are identical.
  const mutableValues = [...values] as [string, ...string[]];
  return z.preprocess((v) => {
    if (typeof v !== "string") return defaultValue;
    const matched = lowered.get(v.trim().toLowerCase());
    return matched ?? defaultValue;
  }, z.enum(mutableValues)) as z.ZodEffects<
    z.ZodEnum<[string, ...string[]]>,
    T[number],
    unknown
  >;
}

/**
 * Clamp a numeric value to [min, max], preserving NaN-resistance.
 * Negative-safe: clamping `-5` against `[0, 100]` returns `0`, not falsy.
 */
function clampNumeric(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Parse a non-negative integer env var with a default. Distinct from
 * `Number(env) || default` because:
 *   - rejects negative values (clamp to 0 if `allowZero`, else fall back)
 *   - "0" is preserved (not coerced to default)
 *   - whitespace-tolerant
 */
export function parseNonNegativeIntEnv(
  raw: string | undefined,
  defaultValue: number,
  { allowZero = true }: { allowZero?: boolean } = {},
): number {
  if (raw === undefined || raw === null) return defaultValue;
  const trimmed = String(raw).trim();
  if (trimmed === "") return defaultValue;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return defaultValue;
  if (n < 0) return defaultValue;
  if (n === 0 && !allowZero) return defaultValue;
  return n;
}

/**
 * Parse a positive (>= 1) integer env var with a default.
 * Convenience wrapper — common case for timeouts, retry counts, etc.
 */
export function parsePositiveIntEnv(
  raw: string | undefined,
  defaultValue: number,
): number {
  return parseNonNegativeIntEnv(raw, defaultValue, { allowZero: false });
}

/**
 * Parse a boolean-ish env flag. Treats "1", "true", "yes", "on" as true;
 * everything else (including unset) as false. Useful for opt-in toggles
 * where the default should be the production-safe behaviour.
 */
export function parseBooleanEnv(raw: string | undefined): boolean {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

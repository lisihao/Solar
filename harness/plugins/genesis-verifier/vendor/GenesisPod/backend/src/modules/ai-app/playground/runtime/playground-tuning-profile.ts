/**
 * playground-tuning-profile.ts —— Named tuning profiles for the
 * playground runtime config.
 *
 * Three deployment shapes share most of the playground pipeline but
 * differ in how much latitude they need:
 *
 *   1. `frontier` — GPT-5 / Claude / Gemini-class. Sharp JSON, integer
 *      scores, short turnaround. The current production tuning.
 *
 *   2. `local-quantized` — Nemotron-3-Nano-NVFP4, Llama-3-Q4, etc.
 *      Slower TTFT, occasionally drift JSON, sometimes float scores.
 *      Needs more iteration latitude and looser chapter tolerance.
 *
 *   3. `local-reasoning` — DeepSeek-R1, QwQ, o1-preview-class.
 *      Same as local-quantized but with longer wall-times (the
 *      <think>…</think> phase can take minutes per call) and the
 *      budget-abort cascade disabled (a single slow call shouldn't
 *      kill outstanding sub-agents).
 *
 * The profile is selected by env var `PLAYGROUND_TUNING_PROFILE`
 * (default: "frontier"). Individual env vars still take precedence —
 * profiles set defaults, env vars override.
 *
 * Why first-class enums instead of free-form env vars:
 *   - Deployment configs become self-documenting: one knob declares the
 *     entire posture instead of 13 individually-tuned numbers.
 *   - Per-knob overrides become "deviation from profile baseline", which
 *     is much easier to review.
 *   - Adding a new model class (e.g. when GPT-6 ships and shifts the
 *     frontier baseline) means adding ONE profile, not patching 13
 *     defaults everywhere.
 */

import type { PlaygroundRuntimeConfig } from "./playground-runtime.config";

/**
 * Valid tuning-profile names. Add new entries here when adopting a new
 * deployment shape (e.g. "edge-cpu", "datacenter-h100", "research-cluster").
 */
export const PLAYGROUND_TUNING_PROFILES = [
  "frontier",
  "local-quantized",
  "local-reasoning",
] as const;

export type PlaygroundTuningProfile =
  (typeof PLAYGROUND_TUNING_PROFILES)[number];

/**
 * Profile-specific defaults. Anything not declared in a profile inherits
 * from the FRONTIER_DEFAULTS constant in `playground-runtime.config.ts`.
 */
const PROFILE_OVERRIDES: Record<
  PlaygroundTuningProfile,
  Partial<PlaygroundRuntimeConfig>
> = {
  frontier: {
    // No overrides — frontier is the baseline.
  },
  // ★ 2026-05-22 follow-up：原 loop-control / disableBudgetAbort 覆盖已删——这些 key
  //   生产代码零消费(详见 playground-runtime.config.ts 注释),profile 设了也无效。
  //   现存覆盖只保留真正生效的:findings 下限 / 章节容忍 / liveness 阈值。
  "local-quantized": {
    minFindingsThreshold: 5, // local 采集力弱，低于 frontier 的 10，但仍高于旧 3
    chapterToleranceRatio: 0.4, // 40% missing tolerated (vs 30% frontier)
    staleThresholdMin: 30,
    softWarnThresholdMin: 40,
  },
  "local-reasoning": {
    minFindingsThreshold: 5,
    chapterToleranceRatio: 0.4,
    staleThresholdMin: 60,
    softWarnThresholdMin: 75,
  },
};

/**
 * Parse the profile name from env, falling back to "frontier" for unknown
 * or missing values. Case-insensitive; tolerant of common alternates like
 * "local_reasoning" / "Local-Reasoning".
 */
export function parsePlaygroundTuningProfile(
  raw: string | undefined,
): PlaygroundTuningProfile {
  if (!raw) return "frontier";
  const normalized = String(raw).trim().toLowerCase().replace(/_/g, "-");
  if ((PLAYGROUND_TUNING_PROFILES as readonly string[]).includes(normalized)) {
    return normalized as PlaygroundTuningProfile;
  }
  return "frontier";
}

/**
 * Look up the override map for a given profile. Returns an empty object
 * (no overrides) for the frontier baseline.
 */
export function getProfileOverrides(
  profile: PlaygroundTuningProfile,
): Partial<PlaygroundRuntimeConfig> {
  return PROFILE_OVERRIDES[profile] ?? {};
}

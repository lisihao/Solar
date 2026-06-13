/**
 * Slides Skill Resolver - Types
 */

import type { SlidesSlotId } from "./slot-ids";

/**
 * Source type hint — mirrors the subset of SlidesSourceType that the
 * resolver cares about for policy matching.
 *
 * Kept open at the string level so external callers can pass future
 * source types without a union edit; the `(string & {})` trick preserves
 * IDE autocomplete for the listed literals.
 */
export type SlidesSourceHint =
  | "topic-insights"
  | "research-project"
  | "writing"
  | "teams"
  | "library"
  | "upload"
  | "prompt"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export type SlidesAudience =
  | "executive"
  | "engineer"
  | "investor"
  | "academic"
  | "general"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export type SlidesIntent =
  | "brief" // 简报
  | "pitch" // 路演
  | "tutorial" // 教程
  | "report" // 深度报告
  | "summary" // 摘要
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export interface SkillConditions {
  sourceType?: SlidesSourceHint;
  audience?: SlidesAudience;
  intent?: SlidesIntent;
  language?: string;
}

/**
 * A declarative mapping: "when conditions match, fill this slot with this skill".
 */
export interface SkillPolicy {
  slot: SlidesSlotId;
  match: SkillConditions;
  skillId: string;
  priority: number;
}

/**
 * User-side override — highest priority, bypasses all policies.
 * Partial map: slot → skillId. Unset slots fall through to preset / default.
 */
export type SkillOverrides = Partial<Record<SlidesSlotId, string>>;

/**
 * A named bundle of slot→skill bindings, loaded from JSON.
 */
export interface Preset {
  id: string; // e.g. "topic-insights.executive-brief"
  description?: string;
  appliesTo?: SkillConditions; // optional — for LLM router auto-selection (Phase B)
  bindings: Partial<Record<SlidesSlotId, string>>;
}

/**
 * Output of the resolver — flat map of slot → chosen skillId,
 * plus provenance for audit/logging.
 */
export interface ResolvedSkills {
  bindings: Record<SlidesSlotId, string>;
  provenance: Record<SlidesSlotId, ResolutionSource>;
  presetId?: string;
}

export type ResolutionSource = "override" | "preset" | "policy" | "default";

/**
 * Context passed to the resolver. Combines controller input with
 * any detected context (source type, language, audience hint).
 */
export interface ResolveContext {
  conditions: SkillConditions;
  presetId?: string;
  overrides?: SkillOverrides;
}

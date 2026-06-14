/**
 * Slides Pipeline - Slot IDs
 *
 * The 5-stage trunk pipeline exposes fixed "slots". Each slot may be filled
 * by a different Skill implementation, selected by {@link SkillResolver}
 * from presets / user overrides / defaults.
 *
 * Design goal: trunk (stage set + slot set) is stable; skill choice per
 * slot is flexible via SkillPolicy / Preset / UI override.
 */

export const SlidesSlot = {
  // ---- Stage 1: Ingest (source data → SlidesSourceData) ----
  // Source type is determined by controller input; not a resolver slot.

  // ---- Stage 2: Plan (source → PPTOutline) ----
  PLAN_OUTLINE: "plan.outline",
  PLAN_AUDIENCE: "plan.audience",

  // ---- Stage 3: Compose (per-slide content build) ----
  COMPOSE_PAGE_TYPE: "compose.pageType",
  COMPOSE_TEMPLATE_MATCH: "compose.templateMatch",
  COMPOSE_CONTENT_BUILD: "compose.contentBuild",
  COMPOSE_CHART_RENDER: "compose.chartRender",
  COMPOSE_IMAGE_FETCH: "compose.imageFetch",

  // ---- Stage 4: Polish ----
  POLISH_LAYOUT_FIX: "polish.layoutFix",
  POLISH_CONSISTENCY: "polish.consistency",
  POLISH_FACT_CHECK: "polish.factCheck",
  POLISH_TERMINOLOGY: "polish.terminology",

  // ---- Stage 5: Render ----
  RENDER_TEMPLATE: "render.template",
} as const;

export type SlidesSlotId = (typeof SlidesSlot)[keyof typeof SlidesSlot];

export const ALL_SLOT_IDS: readonly SlidesSlotId[] = Object.values(
  SlidesSlot,
) as SlidesSlotId[];

/**
 * Default skill bound to each slot.
 * Preserves current orchestrator behavior when no preset / override is given.
 * Keep in sync with `slides/skills/index.ts` registrations.
 */
export const DEFAULT_SKILL_BY_SLOT: Record<SlidesSlotId, string> = {
  [SlidesSlot.PLAN_OUTLINE]: "outline-planning",
  [SlidesSlot.PLAN_AUDIENCE]: "",
  [SlidesSlot.COMPOSE_PAGE_TYPE]: "page-type-selection",
  [SlidesSlot.COMPOSE_TEMPLATE_MATCH]: "template-matcher",
  [SlidesSlot.COMPOSE_CONTENT_BUILD]: "four-step-design",
  [SlidesSlot.COMPOSE_CHART_RENDER]: "chart-renderer",
  [SlidesSlot.COMPOSE_IMAGE_FETCH]: "image-fetcher",
  [SlidesSlot.POLISH_LAYOUT_FIX]: "layout-fixer",
  [SlidesSlot.POLISH_CONSISTENCY]: "deck-consistency-auditor",
  [SlidesSlot.POLISH_FACT_CHECK]: "fact-checker",
  [SlidesSlot.POLISH_TERMINOLOGY]: "terminology-unifier",
  [SlidesSlot.RENDER_TEMPLATE]: "template-rendering",
};

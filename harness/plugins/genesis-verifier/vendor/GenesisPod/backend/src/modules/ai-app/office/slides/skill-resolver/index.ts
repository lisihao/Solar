export { SlidesSlot, ALL_SLOT_IDS, DEFAULT_SKILL_BY_SLOT } from "./slot-ids";
export type { SlidesSlotId } from "./slot-ids";
export { SkillResolver } from "./skill-resolver.service";
export { PresetLoader } from "./preset-loader.service";
export { SkillPolicyRegistry } from "./skill-policy.registry";
export { resolveEffectiveSkillId } from "./effective-skill";
export type { EffectiveSkillResolution } from "./effective-skill";
export { SlidesAutoRouterService } from "./auto-router.service";
export type { RoutingSuggestion } from "./auto-router.service";
export type {
  SkillPolicy,
  SkillConditions,
  SkillOverrides,
  Preset,
  ResolvedSkills,
  ResolutionSource,
  ResolveContext,
  SlidesSourceHint,
  SlidesAudience,
  SlidesIntent,
} from "./skill-policy.types";

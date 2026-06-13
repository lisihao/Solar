import { DEFAULT_SKILL_BY_SLOT, type SlidesSlotId } from "./slot-ids";
import type { ResolvedSkills } from "./skill-policy.types";

/**
 * Reverse lookup: default skillId → slot. Built from {@link DEFAULT_SKILL_BY_SLOT}.
 *
 * Only default skills have a known slot. A skill bound by a preset/override
 * (e.g. `outline-exec-brief`) is NOT in this map — the substitution chain
 * maps the *Leader's chosen default* (`outline-planning`) to its slot, and
 * looks up the actual binding from {@link ResolvedSkills.bindings}.
 */
const DEFAULT_SKILL_TO_SLOT: Readonly<Record<string, SlidesSlotId>> =
  Object.freeze(
    Object.entries(DEFAULT_SKILL_BY_SLOT).reduce<Record<string, SlidesSlotId>>(
      (acc, [slot, skill]) => {
        if (skill) {
          acc[skill] = slot as SlidesSlotId;
        }
        return acc;
      },
      {},
    ),
  );

const SLIDES_PREFIX = "slides-";

export interface EffectiveSkillResolution {
  /** The skillId to dispatch to. Same as input when no substitution happens. */
  effectiveSkillId: string;
  /** Matched slot (populated whenever the input maps to a default skill). */
  slot?: SlidesSlotId;
  /** True iff effectiveSkillId differs from the caller-provided skillId. */
  substituted: boolean;
}

/**
 * Compute the skillId that should actually execute for a task.
 *
 * Behavior:
 * 1. If no {@link ResolvedSkills} is provided, return the input unchanged.
 * 2. Strip the optional `slides-` prefix and look up the input in the default→slot map.
 * 3. If it does not map to any slot, return the input unchanged.
 * 4. If the slot has a binding equal to the normalized input, also return unchanged.
 * 5. Otherwise, return the bound skillId as the substitution.
 *
 * This helper is pure — it does not verify that the substituted skillId is
 * actually registered. Callers should guard with a registry lookup and fall
 * back to the original skillId when the substitution cannot be dispatched.
 */
export function resolveEffectiveSkillId(
  inputSkillId: string,
  resolvedSkills?: ResolvedSkills,
): EffectiveSkillResolution {
  if (!resolvedSkills) {
    return { effectiveSkillId: inputSkillId, substituted: false };
  }

  const normalized = inputSkillId.startsWith(SLIDES_PREFIX)
    ? inputSkillId.slice(SLIDES_PREFIX.length)
    : inputSkillId;

  const slot = DEFAULT_SKILL_TO_SLOT[normalized];
  if (!slot) {
    return { effectiveSkillId: inputSkillId, substituted: false };
  }

  const bound = resolvedSkills.bindings[slot];
  if (!bound || bound === normalized) {
    return { effectiveSkillId: inputSkillId, slot, substituted: false };
  }

  return {
    effectiveSkillId: bound,
    slot,
    substituted: true,
  };
}

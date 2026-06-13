import {
  resolveEffectiveSkillId,
  type EffectiveSkillResolution,
} from "../effective-skill";
import { SlidesSlot, DEFAULT_SKILL_BY_SLOT } from "../slot-ids";
import type { ResolvedSkills, ResolutionSource } from "../skill-policy.types";

/**
 * Covers:
 * - no resolvedSkills → identity
 * - unknown skillId (not a default) → identity
 * - `slides-` prefix normalization
 * - binding equals normalized input → no substitution
 * - binding differs → substitution with slot
 * - binding empty → no substitution
 */
function makeResolved(
  bindings: Partial<Record<string, string>>,
): ResolvedSkills {
  const full = { ...DEFAULT_SKILL_BY_SLOT } as Record<string, string>;
  const provenance: Record<string, ResolutionSource> = {};
  for (const slot of Object.values(SlidesSlot)) {
    provenance[slot] = "default";
  }
  for (const [slot, skill] of Object.entries(bindings)) {
    if (skill) {
      full[slot] = skill;
      provenance[slot] = "preset";
    }
  }
  return {
    bindings: full as ResolvedSkills["bindings"],
    provenance: provenance as ResolvedSkills["provenance"],
  };
}

describe("resolveEffectiveSkillId", () => {
  it("returns identity when resolvedSkills is undefined", () => {
    const r: EffectiveSkillResolution =
      resolveEffectiveSkillId("outline-planning");
    expect(r.effectiveSkillId).toBe("outline-planning");
    expect(r.substituted).toBe(false);
    expect(r.slot).toBeUndefined();
  });

  it("returns identity when skillId is not a known default", () => {
    const resolved = makeResolved({});
    const r = resolveEffectiveSkillId("some-unknown-skill", resolved);
    expect(r.effectiveSkillId).toBe("some-unknown-skill");
    expect(r.substituted).toBe(false);
    expect(r.slot).toBeUndefined();
  });

  it("substitutes when slot has a different binding", () => {
    const resolved = makeResolved({
      [SlidesSlot.PLAN_OUTLINE]: "outline-exec-brief",
    });
    const r = resolveEffectiveSkillId("outline-planning", resolved);
    expect(r.effectiveSkillId).toBe("outline-exec-brief");
    expect(r.slot).toBe(SlidesSlot.PLAN_OUTLINE);
    expect(r.substituted).toBe(true);
  });

  it("does not substitute when binding equals normalized input", () => {
    // bindings explicitly equal the default — no-op substitution
    const resolved = makeResolved({
      [SlidesSlot.PLAN_OUTLINE]: "outline-planning",
    });
    const r = resolveEffectiveSkillId("outline-planning", resolved);
    expect(r.effectiveSkillId).toBe("outline-planning");
    expect(r.slot).toBe(SlidesSlot.PLAN_OUTLINE);
    expect(r.substituted).toBe(false);
  });

  it("normalizes 'slides-' prefix during lookup", () => {
    const resolved = makeResolved({
      [SlidesSlot.PLAN_OUTLINE]: "outline-exec-brief",
    });
    const r = resolveEffectiveSkillId("slides-outline-planning", resolved);
    expect(r.effectiveSkillId).toBe("outline-exec-brief");
    expect(r.slot).toBe(SlidesSlot.PLAN_OUTLINE);
    expect(r.substituted).toBe(true);
  });

  it("empty slot binding keeps original (no substitution)", () => {
    // Emulate a resolvedSkills where a slot has empty string (shouldn't happen
    // post-resolver, but guard the helper defensively)
    const base = makeResolved({});
    (base.bindings as Record<string, string>)[SlidesSlot.PLAN_OUTLINE] = "";
    const r = resolveEffectiveSkillId("outline-planning", base);
    expect(r.effectiveSkillId).toBe("outline-planning");
    expect(r.substituted).toBe(false);
  });

  it("handles all built-in defaults (smoke: every default resolves its own slot)", () => {
    for (const [slot, defaultId] of Object.entries(DEFAULT_SKILL_BY_SLOT)) {
      if (!defaultId) continue;
      const resolved = makeResolved({ [slot]: `${defaultId}-variant` });
      const r = resolveEffectiveSkillId(defaultId, resolved);
      expect(r.substituted).toBe(true);
      expect(r.slot).toBe(slot);
      expect(r.effectiveSkillId).toBe(`${defaultId}-variant`);
    }
  });
});

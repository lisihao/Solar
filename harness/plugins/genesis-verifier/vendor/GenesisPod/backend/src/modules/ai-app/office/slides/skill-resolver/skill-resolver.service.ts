import { Injectable, Logger } from "@nestjs/common";
import { PresetLoader } from "./preset-loader.service";
import { SkillPolicyRegistry } from "./skill-policy.registry";
import {
  ALL_SLOT_IDS,
  DEFAULT_SKILL_BY_SLOT,
  type SlidesSlotId,
} from "./slot-ids";
import type {
  ResolveContext,
  ResolvedSkills,
  ResolutionSource,
} from "./skill-policy.types";

/**
 * Core resolver: for every slot, choose the skill via the following precedence
 * (highest first):
 *
 *   1. User override      (controller-level `skillOverrides`)
 *   2. Named preset       (controller-level `preset`)
 *   3. Matching policy    (rule registry, by `conditions`)
 *   4. Built-in default   ({@link DEFAULT_SKILL_BY_SLOT})
 *
 * The resolver is pure — no LLM calls, no DB hits. It produces a flat
 * slot→skill map plus provenance, to be placed into the orchestrator's
 * globalContext.
 *
 * Back-compat: when no override / preset / policy matches, defaults equal
 * the current hard-coded skill IDs, so orchestrator behavior is unchanged.
 */
@Injectable()
export class SkillResolver {
  private readonly logger = new Logger(SkillResolver.name);

  constructor(
    private readonly presetLoader: PresetLoader,
    private readonly policyRegistry: SkillPolicyRegistry,
  ) {}

  resolve(ctx: ResolveContext): ResolvedSkills {
    const bindings: Record<SlidesSlotId, string> = {
      ...DEFAULT_SKILL_BY_SLOT,
    } as Record<SlidesSlotId, string>;
    const provenance: Record<SlidesSlotId, ResolutionSource> = {} as Record<
      SlidesSlotId,
      ResolutionSource
    >;
    for (const slot of ALL_SLOT_IDS) {
      provenance[slot] = "default";
    }

    // 3. Policy rules (lowest non-default priority)
    for (const slot of ALL_SLOT_IDS) {
      const policy = this.policyRegistry.findMatch(slot, ctx.conditions);
      if (policy?.skillId) {
        bindings[slot] = policy.skillId;
        provenance[slot] = "policy";
      }
    }

    // 2. Preset (overrides policy + default)
    let resolvedPresetId: string | undefined;
    if (ctx.presetId) {
      const preset = this.presetLoader.get(ctx.presetId);
      if (!preset) {
        this.logger.warn(
          `Preset not found: '${ctx.presetId}' — falling through to policy/default`,
        );
      } else {
        resolvedPresetId = preset.id;
        for (const [slot, skill] of Object.entries(preset.bindings)) {
          if (skill) {
            bindings[slot as SlidesSlotId] = skill;
            provenance[slot as SlidesSlotId] = "preset";
          }
        }
      }
    }

    // 1. User override (highest)
    if (ctx.overrides) {
      for (const [slot, skill] of Object.entries(ctx.overrides)) {
        if (!ALL_SLOT_IDS.includes(slot as SlidesSlotId)) {
          this.logger.warn(
            `Override references unknown slot '${slot}' — ignored`,
          );
          continue;
        }
        if (typeof skill === "string" && skill.length > 0) {
          bindings[slot as SlidesSlotId] = skill;
          provenance[slot as SlidesSlotId] = "override";
        }
      }
    }

    return {
      bindings,
      provenance,
      presetId: resolvedPresetId,
    };
  }
}

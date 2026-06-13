import { Injectable, Logger } from "@nestjs/common";
import type { SkillPolicy, SkillConditions } from "./skill-policy.types";
import type { SlidesSlotId } from "./slot-ids";

/**
 * In-memory registry of SkillPolicy rules.
 *
 * Policies are declarative "when conditions match, bind this skill".
 * The registry does not evaluate them; it stores and queries.
 * {@link SkillResolver} consumes these during resolution (Phase B).
 *
 * Phase A: registry is populated at module init from built-in rules.
 * Phase B: will accept dynamic registration (e.g. from presets metadata).
 */
@Injectable()
export class SkillPolicyRegistry {
  private readonly logger = new Logger(SkillPolicyRegistry.name);
  private readonly policies: SkillPolicy[] = [];

  register(policy: SkillPolicy): void {
    this.policies.push(policy);
  }

  registerAll(policies: SkillPolicy[]): void {
    for (const p of policies) {
      this.register(p);
    }
    this.logger.log(
      `Registered ${policies.length} policies (total: ${this.policies.length})`,
    );
  }

  /**
   * Find the highest-priority matching policy for a slot.
   * Returns undefined when no policy matches.
   */
  findMatch(
    slot: SlidesSlotId,
    conditions: SkillConditions,
  ): SkillPolicy | undefined {
    const candidates = this.policies.filter(
      (p) => p.slot === slot && this.matches(p.match, conditions),
    );
    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => b.priority - a.priority);
    return candidates[0];
  }

  getAll(): readonly SkillPolicy[] {
    return this.policies;
  }

  /**
   * Match semantics: every key present on `rule` must equal the corresponding
   * key on `ctx`. Unset rule keys are wildcards.
   */
  private matches(rule: SkillConditions, ctx: SkillConditions): boolean {
    const keys: (keyof SkillConditions)[] = [
      "sourceType",
      "audience",
      "intent",
      "language",
    ];
    for (const k of keys) {
      if (rule[k] !== undefined && rule[k] !== ctx[k]) {
        return false;
      }
    }
    return true;
  }
}

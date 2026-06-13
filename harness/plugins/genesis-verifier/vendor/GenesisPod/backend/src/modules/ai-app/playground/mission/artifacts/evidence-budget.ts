/**
 * evidence-budget.ts — playground binding shim over harness supply-budget framework
 *
 * Wave-1 P4 (2026-05-24): The supply-budget mechanism (supply-key count →
 * demand-slot cap, with per-slot minimum-item floor) was generic enough to be
 * extracted to ai-harness. The playground-specific terminology ("evidence
 * findings", "unique sources", "chapters", "citation floor") maps onto the
 * framework's neutral terms ("supply items", "uniqueKeys", "demand slots",
 * "minPerSlot") via this shim:
 *
 *   findings.source       → keyOf(item)
 *   domain hostname       → groupOf(item) via extractGroupFromUrlOrText
 *   uniqueSources         → uniqueKeys
 *   uniqueDomains         → uniqueGroups (informational only)
 *   maxChapters           → maxDemandSlots
 *   citationFloor         → minPerSlot
 *
 * Public surface unchanged so all 4 callers (per-dim-pipeline, s4-leader-assess,
 * s7-writer-plan-outline, s8-writer-draft-report) keep working.
 */

import {
  computeSupplyBudget,
  deriveMaxDemandSlots,
  deriveMinPerSlot,
  extractGroupFromUrlOrText,
  type BusinessTeamSupplyBudget,
} from "@/modules/ai-harness/facade";

/** Evidence supply contract — typed view onto harness BusinessTeamSupplyBudget. */
export interface EvidenceBudget {
  /** De-duplicated unique source-string count — chapter cap derives from this. */
  uniqueSources: number;
  /**
   * De-duplicated unique-domain count (URL hostname; non-URL → fallback string).
   * ★ Informational only: used for logs / degraded-mode narrative; chapter cap
   *   uses uniqueSources, NOT this field.
   */
  uniqueDomains: number;
  /** Raw finding count (including duplicates). */
  totalFindings: number;
}

/** URL → hostname (strip www., lowercase); non-URL → lowercased text fallback. */
export function extractDomain(source: string): string {
  return extractGroupFromUrlOrText(source);
}

/** Compute the evidence supply contract once per dimension after collection. */
export function computeEvidenceBudget(
  findings: ReadonlyArray<{ source: string }>,
): EvidenceBudget {
  const b: BusinessTeamSupplyBudget = computeSupplyBudget(
    findings,
    (f) => f.source,
    (f) => extractGroupFromUrlOrText(f.source),
  );
  return {
    uniqueSources: b.uniqueKeys,
    uniqueDomains: b.uniqueGroups,
    totalFindings: b.totalItems,
  };
}

/**
 * Derive chapter-count cap from supply: each chapter targets ≥2 unique sources.
 * Forwards to {@link deriveMaxDemandSlots} with playground term remapping.
 */
export function deriveMaxChapters(
  budget: EvidenceBudget,
  idealChapters: number,
  minChapters = 1,
): number {
  return deriveMaxDemandSlots(
    {
      uniqueKeys: budget.uniqueSources,
      uniqueGroups: budget.uniqueDomains,
      totalItems: budget.totalFindings,
    },
    idealChapters,
    minChapters,
  );
}

/**
 * Derive per-chapter citation floor (≥2 sources → 2, 1 → 1, 0 → 0).
 * Forwards to {@link deriveMinPerSlot}.
 */
export function deriveCitationFloor(sourcesInChapter: number): number {
  return deriveMinPerSlot(sourcesInChapter);
}

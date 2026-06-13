/**
 * BusinessAgentTeam — Supply Budget Framework (P4 generic helper)
 *
 * "Supply budget" mechanism = "compute how much supply we have, then derive
 * how many demand slots we can fill so that quality gates stay satisfiable".
 *
 * @migrated-from ai-app evidence-budget.ts
 * The research use-case is *evidence-from-collection*: researcher findings →
 * unique-source + unique-domain count → max chapters that can each cite ≥2
 * sources. But the algorithm is *agnostic*: any team that collects N supply
 * items and needs to size a downstream demand slot count under a quality floor
 * can reuse it (radar collectors→briefing items, social platform feeds→batch
 * publish slots, etc.).
 *
 * Domain terms ("evidence", "chapter") are renamed to neutral terms:
 *   - evidence findings  → supply items (with `key` extractor)
 *   - unique sources     → uniqueKeys
 *   - unique domains     → uniqueGroups (via optional `groupBy` extractor)
 *   - max chapters       → maxDemandSlots
 *   - citation floor     → minPerSlot floor
 *
 * Pure functions, 0 DI, 0 LLM. Easy to test and guard.
 */

/**
 * Result of computing supply from a list of items.
 */
export interface BusinessTeamSupplyBudget {
  /** De-duplicated unique-key count (e.g. unique source URLs). Demand slot cap is derived from this. */
  uniqueKeys: number;
  /** De-duplicated unique-group count (e.g. unique domains). Informational — used for logs / narrative only. */
  uniqueGroups: number;
  /** Raw item count (including duplicates). */
  totalItems: number;
}

/**
 * Normalize a free-form source string into a domain-like group token. Used by
 * the evidence-pipeline binding shim; exported so callers needing the same
 * domain extraction algorithm can reuse it.
 */
export function extractGroupFromUrlOrText(source: string): string {
  const s = (source ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    // non-URL text after `https://` prefix would yield a hostname slice with
    // no dot — only accept tokens containing a dot as a real domain.
    if (host.includes(".")) return host;
  } catch {
    /* non-URL: fall through to text fallback */
  }
  return s.toLowerCase().slice(0, 80);
}

/**
 * Compute the supply budget from a flat list of items.
 *
 * @param items   - Items to count (may contain duplicates).
 * @param keyOf   - Extracts the unique-key for de-dup (e.g. `f.source.toLowerCase()`).
 * @param groupOf - Extracts the unique-group token (e.g. URL hostname).
 *                  If returned value is empty / falsy, the item is skipped from
 *                  both uniqueKeys and uniqueGroups counts (matches the original
 *                  the original "blank source" skip behaviour).
 */
export function computeSupplyBudget<TItem>(
  items: ReadonlyArray<TItem>,
  keyOf: (item: TItem) => string,
  groupOf: (item: TItem) => string,
): BusinessTeamSupplyBudget {
  const keys = new Set<string>();
  const groups = new Set<string>();
  for (const it of items) {
    const k = (keyOf(it) ?? "").trim().toLowerCase();
    if (!k) continue;
    keys.add(k);
    const g = (groupOf(it) ?? "").trim();
    if (g) groups.add(g);
  }
  return {
    uniqueKeys: keys.size,
    uniqueGroups: groups.size,
    totalItems: items.length,
  };
}

/**
 * Derive max demand-slot count from supply: each slot wants ≥2 unique items.
 * 5 unique items → at most 2 slots (not 7). Rich supply → return idealSlots
 * unchanged (no inflation beyond ideal).
 *
 * `minSlots` is a quality floor: even with thin supply, return at least this
 * many slots so the result does not collapse to 1 section. Dual-sided clamp:
 *   - never above idealSlots (do not invent)
 *   - never above uniqueKeys (do not create 0-supply slots)
 * Default 1 preserves legacy behaviour.
 */
export function deriveMaxDemandSlots(
  budget: BusinessTeamSupplyBudget,
  idealSlots: number,
  minSlots = 1,
): number {
  const byKeys = Math.floor(budget.uniqueKeys / 2);
  const natural = Math.max(1, Math.min(idealSlots, byKeys));
  const floor = Math.min(
    Math.max(1, minSlots),
    idealSlots,
    Math.max(1, budget.uniqueKeys),
  );
  return Math.max(natural, floor);
}

/**
 * Per-slot minimum-item floor: standard 2 when slot has ≥2 items; drop to 1
 * if it only has 1 item; require 0 when it has none (no items → no citation
 * requirement). Prevents the "asked for more than supplied" deadlock that
 * triggered the original evidence-contract redesign.
 */
export function deriveMinPerSlot(itemsInSlot: number): number {
  return Math.min(2, Math.max(0, Math.floor(itemsInSlot)));
}

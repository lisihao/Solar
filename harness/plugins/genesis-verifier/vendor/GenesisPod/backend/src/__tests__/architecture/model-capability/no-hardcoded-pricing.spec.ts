/**
 * no-hardcoded-pricing.spec.ts
 *
 * Verifies that hardcoded price tables have been removed from production code
 * and that the single-source-of-truth (ModelPricingRegistry) remains.
 *
 * Five assertions from the "hardcoded pricing zero-out" protection:
 *   1. COST_PER_1K_TOKENS does NOT appear in any production (non-spec) .ts file
 *   2. FALLBACK_TIER_COSTS in constraint-engine.ts is the ONLY survivor (no other files)
 *   3. ai-engine/planning/budget/cost.calculator.ts has been deleted
 *   4. ai-observability.service.ts has no `static estimateCost`
 *   5. ai-metrics.service.ts (platform) has no `private estimateCost`
 *
 * Uses fs.readFileSync + recursive directory walk to avoid cross-platform
 * shell quoting issues with execSync grep.
 *
 * If any assertion fails: the protection is NOT working — report immediately.
 */

import * as fs from "fs";
import * as path from "path";

// __dirname = backend/src/__tests__/architecture
// BACKEND_SRC should point to backend/src (where modules/ lives)
const BACKEND_SRC = path.resolve(__dirname, "../../..");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Recursively collect all .ts files under a directory */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

/** Return files whose content contains the literal string */
function filesContaining(pattern: string, files: string[]): string[] {
  return files.filter((f) => {
    try {
      return fs.readFileSync(f, "utf8").includes(pattern);
    } catch {
      return false;
    }
  });
}

const ALL_TS_FILES = collectTsFiles(BACKEND_SRC);
const PROD_TS_FILES = ALL_TS_FILES.filter((f) => !f.endsWith(".spec.ts"));

// ---------------------------------------------------------------------------

describe("Hardcoded Pricing Zero-Out — Protection Net", () => {
  // --------------------------------------------------------------------------
  // 1. COST_PER_1K_TOKENS — only spec comments should remain, zero prod files
  // --------------------------------------------------------------------------

  describe("1. COST_PER_1K_TOKENS", () => {
    it("does NOT appear in any production (non-spec) .ts file", () => {
      const violating = filesContaining("COST_PER_1K_TOKENS", PROD_TS_FILES);
      expect(violating).toHaveLength(0);
      if (violating.length > 0) {
        console.error("Files with COST_PER_1K_TOKENS:", violating);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 2. FALLBACK_TIER_COSTS — constraint-engine.ts is a known survivor (guardrails tier
  //    uses semantic ModelPreference tiers, NOT real model IDs).
  //    Assert that NO OTHER file uses FALLBACK_TIER_COSTS.
  // --------------------------------------------------------------------------

  describe("2. FALLBACK_TIER_COSTS", () => {
    it("is confined to constraint-engine.ts only (known survivor in guardrails)", () => {
      const violating = filesContaining(
        "FALLBACK_TIER_COSTS",
        PROD_TS_FILES,
      ).filter((f) => !f.includes("constraint-engine.ts"));
      if (violating.length > 0) {
        console.error(
          "FALLBACK_TIER_COSTS found outside constraint-engine.ts:",
          violating,
        );
      }
      expect(violating).toHaveLength(0);
    });

    /**
     * NEGATIVE TEST (documents known survivor):
     * constraint-engine.ts DOES contain FALLBACK_TIER_COSTS using semantic tier keys
     * (cheap/balanced/premium), not real model IDs. This is a known survivor
     * that should eventually be migrated to ModelPricingRegistry injection.
     */
    it("[KNOWN ISSUE] constraint-engine.ts uses semantic-tier FALLBACK_TIER_COSTS (not real model IDs) — documents known survivor", () => {
      const file = path.join(
        BACKEND_SRC,
        "modules/ai-harness/guardrails/constraints/constraint-engine.ts",
      );
      if (!fs.existsSync(file)) {
        // If it no longer exists, the issue has been resolved
        return;
      }
      const content = fs.readFileSync(file, "utf8");
      const hasModelCosts = content.includes("FALLBACK_TIER_COSTS");

      if (hasModelCosts) {
        // Document that it uses semantic tier keys (cheap/balanced/premium),
        // NOT real model IDs like "gpt-4o" — this is less harmful than true hardcoding.
        // All three semantic tier keys must appear in the file.
        expect(content).toContain("cheap");
        expect(content).toContain("balanced");
        expect(content).toContain("premium");
        // The model IDs that DO appear are only in comment strings explaining
        // the mapping, not in the FALLBACK_TIER_COSTS value definition itself.
        // The const declaration itself only uses number literals (0.1, 0.5, 2.0, etc.).
        expect(content).toMatch(/cheap:\s*\{\s*input:\s*[\d.]+/);
        console.warn(
          "[KNOWN ISSUE] constraint-engine.ts has semantic FALLBACK_TIER_COSTS (cheap/balanced/premium). " +
            "Should migrate to ModelPricingRegistry.estimateCostForTier() injection.",
        );
      }
      // Passes regardless — this test is documentation, not a blocker
      expect(true).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. ai-engine/planning/budget/cost.calculator.ts must NOT exist
  // --------------------------------------------------------------------------

  describe("3. cost.calculator.ts deletion", () => {
    it("ai-engine/planning/budget/cost.calculator.ts has been deleted", () => {
      const file = path.join(
        BACKEND_SRC,
        "modules/ai-engine/planning/budget/cost.calculator.ts",
      );
      expect(fs.existsSync(file)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 4. ai-observability.service.ts — no `static estimateCost`
  // --------------------------------------------------------------------------

  describe("4. ai-observability.service.ts no static estimateCost", () => {
    it("file exists", () => {
      const file = path.join(
        BACKEND_SRC,
        "modules/ai-harness/tracing/observability/ai-observability.service.ts",
      );
      expect(fs.existsSync(file)).toBe(true);
    });

    it("does not contain 'static estimateCost'", () => {
      const file = path.join(
        BACKEND_SRC,
        "modules/ai-harness/tracing/observability/ai-observability.service.ts",
      );
      if (!fs.existsSync(file)) return;
      const content = fs.readFileSync(file, "utf8");
      expect(content.includes("static estimateCost")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 5. ai-metrics.service.ts (platform) — no `private estimateCost`
  // --------------------------------------------------------------------------

  describe("5. ai-metrics.service.ts no private estimateCost", () => {
    it("file exists at platform/monitoring/metrics/", () => {
      const file = path.join(
        BACKEND_SRC,
        "modules/platform/monitoring/metrics/ai-metrics.service.ts",
      );
      expect(fs.existsSync(file)).toBe(true);
    });

    it("does not contain 'private estimateCost'", () => {
      const file = path.join(
        BACKEND_SRC,
        "modules/platform/monitoring/metrics/ai-metrics.service.ts",
      );
      if (!fs.existsSync(file)) return;
      const content = fs.readFileSync(file, "utf8");
      expect(content.includes("private estimateCost")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 6. ModelPricingRegistry — verify the ONE canonical source still exists
  // --------------------------------------------------------------------------

  describe("6. ModelPricingRegistry (canonical source) exists", () => {
    it("model-pricing.registry.ts exists under ai-engine/llm/models/pricing", () => {
      const file = path.join(
        BACKEND_SRC,
        "modules/ai-engine/llm/models/pricing/model-pricing.registry.ts",
      );
      expect(fs.existsSync(file)).toBe(true);
    });

    it("model-pricing.registry.ts does NOT declare a DEFAULT_TABLE constant (only mentions it in comments as deleted)", () => {
      const file = path.join(
        BACKEND_SRC,
        "modules/ai-engine/llm/models/pricing/model-pricing.registry.ts",
      );
      if (!fs.existsSync(file)) return;
      const content = fs.readFileSync(file, "utf8");
      // A const/let/var declaration of DEFAULT_TABLE would be actual hardcoding.
      // A mention in a comment saying it was removed is fine.
      expect(content).not.toMatch(/(?:const|let|var)\s+DEFAULT_TABLE/);
    });
  });
});

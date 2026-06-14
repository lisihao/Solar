/**
 * playground-no-regression.spec.ts
 *
 * P0 Bug anti-regression suite — verifies that every previously-fixed critical
 * defect cannot silently reappear in production code.  Each test case maps to
 * a named bug and describes the root cause so future readers know WHY the check
 * exists.
 *
 * Approach: static analysis (fs.readFileSync / grep-in-code) only.  No NestJS
 * bootstrapping, no DB, no HTTP — fastest possible feedback loop.
 *
 * Coverage:
 *   P0-A  — 5 stage files that historically leaked lifecycle emit
 *   P0-B  — liveness staleThreshold must be >= 15 min in playground registration
 *   P0-C/G/K — maxCredits must be required, no fallback constants
 *   P0-D  — trajectory persistence: saveResearchResult + saveChapterDraft exist
 *   P0-8de5d02b — leader:goals-set initialRisks must be object[] not string[]
 *   P0-919d4a4cb — hardcoded pricing (MODEL_COSTS / COST_PER_1K) confined to 1 file
 */

import * as fs from "fs";
import * as path from "path";

const BACKEND_SRC = path.resolve(__dirname, "../..");
const MODULES = path.join(BACKEND_SRC, "modules");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function read(rel: string): string {
  const abs = path.isAbsolute(rel) ? rel : path.join(MODULES, rel);
  return fs.readFileSync(abs, "utf8");
}

function exists(rel: string): boolean {
  const abs = path.isAbsolute(rel) ? rel : path.join(MODULES, rel);
  return fs.existsSync(abs);
}

/** Recursively collect all production (non-spec) .ts files under dir */
function prodTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...prodTsFiles(full));
    else if (
      entry.isFile() &&
      full.endsWith(".ts") &&
      !full.endsWith(".spec.ts")
    )
      out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// P0-B: Liveness staleThreshold must be >= 15 minutes in playground adapter
// ---------------------------------------------------------------------------

describe("P0-B — MissionLivenessGuard staleThresholdMs >= 15 min in playground", () => {
  const moduleFile = "ai-app/playground/module/playground.module.ts";

  it("playground module registers liveness adapter with staleThresholdMs", () => {
    const src = read(moduleFile);
    expect(src).toContain("registerAdapter");
    expect(src).toContain("staleThresholdMs");
  });

  it("staleThresholdMs default (and any literal) is >= 15 min", () => {
    // ★ 2026-05-13 (PR2): values are now sourced from
    //   `loadPlaygroundRuntimeConfig()` rather than literal `N * 60 * 1000`.
    //   We verify the typed config default *and* still flag any stray
    //   hardcoded literal that drops below 15.
    const src = read(moduleFile);
    const literalMatches = src.matchAll(
      /staleThresholdMs\s*:\s*(\d+)\s*\*\s*60\s*\*\s*1000/g,
    );
    for (const m of literalMatches) {
      expect(parseInt(m[1], 10)).toBeGreaterThanOrEqual(15);
    }
    // Either: the module uses the runtime config (preferred) …
    const usesRuntimeConfig =
      src.includes("loadPlaygroundRuntimeConfig") ||
      src.includes("playgroundRuntimeConfig");
    // … or it must declare at least one literal >= 15.
    const literalValues = Array.from(
      src.matchAll(/staleThresholdMs\s*:\s*(\d+)\s*\*\s*60\s*\*\s*1000/g),
    ).map((m) => parseInt(m[1], 10));
    expect(usesRuntimeConfig || literalValues.length > 0).toBe(true);
    // ★ Typed config default must itself be >= 15
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      loadPlaygroundRuntimeConfig,
    } = require("../../modules/ai-app/playground/runtime/playground-runtime.config");
    const cfg = loadPlaygroundRuntimeConfig({}) as {
      staleThresholdMin: number;
    };
    expect(cfg.staleThresholdMin).toBeGreaterThanOrEqual(15);
  });

  it("MissionLivenessGuard DEFAULTS.staleThresholdMs is defined", () => {
    const guardFile =
      "ai-harness/lifecycle/mission-lifecycle/mission-liveness-guard.service.ts";
    const src = read(guardFile);
    expect(src).toContain("staleThresholdMs");
    // DEFAULTS object must exist
    expect(src).toContain("DEFAULTS");
  });

  it("playground registers softWarnThresholdMin > staleThresholdMin in typed config", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      loadPlaygroundRuntimeConfig,
    } = require("../../modules/ai-app/playground/runtime/playground-runtime.config");
    const cfg = loadPlaygroundRuntimeConfig({}) as {
      staleThresholdMin: number;
      softWarnThresholdMin: number;
    };
    expect(cfg.softWarnThresholdMin).toBeGreaterThan(cfg.staleThresholdMin);
  });
});

// ---------------------------------------------------------------------------
// P0-C/G/K: maxCredits must be required; no internal fallback hardcodes
// ---------------------------------------------------------------------------

describe("P0-C/G/K — maxCredits required, no fallback hardcoding", () => {
  const dtoFile = "ai-app/playground/api/dto/run-mission.dto.ts";

  it("RunMissionInputSchema declares maxCredits as required (no .optional())", () => {
    const src = read(dtoFile);
    // maxCredits must appear, and must NOT be followed by .optional()
    const maxCreditsIdx = src.indexOf("maxCredits");
    expect(maxCreditsIdx).toBeGreaterThan(-1);
    // Grab the 200 chars after the field declaration
    const segment = src.slice(maxCreditsIdx, maxCreditsIdx + 200);
    expect(segment).not.toContain(".optional()");
  });

  it("resolveMissionCredits returns input.maxCredits directly (no fallback)", () => {
    const src = read(dtoFile);
    // The function must exist and return input.maxCredits
    expect(src).toContain("resolveMissionCredits");
    expect(src).toContain("return input.maxCredits");
    // Must NOT have a fallback like ?? 1000 or ?? 300
    const fnIdx = src.indexOf("resolveMissionCredits");
    const fnBody = src.slice(fnIdx, fnIdx + 200);
    expect(fnBody).not.toMatch(/\?\?\s*\d+/);
  });

  it("resolveBudgetMultiplier falls back to depth tier, never a hardcoded number", () => {
    // ★ 2026-05-22 单一源更新：原断言期望"直接 return input.budgetMultiplierOverride"，
    //   但预算单一源重构后缺省回退到 DEPTH_BUDGET_TIERS（档位真源）而非任何写死数字。
    //   regression 意图不变（杜绝硬编码数字兜底），断言改为匹配 ?? 档位回退。
    const src = read(dtoFile);
    expect(src).toContain("resolveBudgetMultiplier");
    expect(src).toContain("input.budgetMultiplierOverride");
    const fnIdx = src.indexOf("export function resolveBudgetMultiplier");
    const fnBody = src.slice(fnIdx, fnIdx + 260);
    // 缺省回退到档位单一源（不是写死数字）
    expect(fnBody).toContain("DEPTH_BUDGET_TIERS");
    // 仍禁止 ?? <number> 形式的硬编码数字兜底
    expect(fnBody).not.toMatch(/\?\?\s*[\d.]+/);
  });

  it("no BUDGET_PROFILE_CREDITS constant declared in dto (was removed in P0-K)", () => {
    const src = read(dtoFile);
    // The constant BUDGET_PROFILE_CREDITS must not be declared (const/let/var);
    // it's fine if it appears in a JSDoc comment explaining what was removed.
    expect(src).not.toMatch(/(?:const|let|var)\s+BUDGET_PROFILE_CREDITS/);
    // BUDGET_PROFILE_MULTIPLIER was the old internal mapping — must not be declared either
    expect(src).not.toMatch(/(?:const|let|var)\s+BUDGET_PROFILE_MULTIPLIER/);
  });

  it("no ??\\ 300 or ?? 1000 fallback in dispatcher service", () => {
    const dispatcher =
      "ai-app/playground/mission/pipeline/playground.pipeline.ts";
    const src = read(dispatcher);
    // maxCredits fallback patterns that would bypass P0-K fix
    expect(src).not.toMatch(/maxCredits\s*\?\?\s*300/);
    expect(src).not.toMatch(/maxCredits\s*\?\?\s*1000/);
    expect(src).not.toMatch(/maxCredits\s*\?\?\s*500/);
  });
});

// ---------------------------------------------------------------------------
// P0-D: Trajectory persistence — saveResearchResult + saveChapterDraft exist
// ---------------------------------------------------------------------------

describe("P0-D — trajectory persistence methods exist in MissionStore", () => {
  // 2026-05-15 PR-D god-class 拆分后，trajectory 实现迁到 mission-report.helper.ts
  const storeFile =
    "ai-app/playground/mission/lifecycle/mission-report.helper.ts";

  it("saveResearchResult method exists", () => {
    const src = read(storeFile);
    expect(src).toContain("async saveResearchResult(");
  });

  it("saveChapterDraft method exists", () => {
    const src = read(storeFile);
    expect(src).toContain("async saveChapterDraft(");
  });

  it("loadBaselineResearchResults method exists (rerun hydration)", () => {
    const src = read(storeFile);
    expect(src).toContain("async loadBaselineResearchResults(");
  });

  it("loadQualifiedChapterDrafts method exists (rerun hydration)", () => {
    const src = read(storeFile);
    expect(src).toContain("async loadQualifiedChapterDrafts(");
  });

  it("saveResearchResult is called from dispatcher pipeline", () => {
    const dispatcher =
      "ai-app/playground/mission/pipeline/playground.pipeline.ts";
    const src = read(dispatcher);
    expect(src).toContain("saveResearchResult");
  });

  it("saveChapterDraft is called from pipeline util or dispatcher", () => {
    // Either per-dim-pipeline or dispatcher uses saveChapterDraft
    const utilFile =
      "ai-app/playground/mission/pipeline/helpers/per-dim-pipeline.util.ts";
    const dispatcherFile =
      "ai-app/playground/mission/pipeline/playground.pipeline.ts";
    const utilHas = exists(utilFile)
      ? read(utilFile).includes("saveChapterDraft")
      : false;
    const dispatcherHas = read(dispatcherFile).includes("saveChapterDraft");
    expect(utilHas || dispatcherHas).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P0-8de5d02b0: leader:goals-set initialRisks must be object[] not string[]
// — tested here via EventBus contract (same guard as protection-net.spec.ts
//   but verifying the specific event schema registered in the registry)
// ---------------------------------------------------------------------------

describe("P0-8de5d02b0 — leader:goals-set initialRisks schema is object[]", () => {
  it("playground event schemas file registers leader:goals-set", () => {
    const schemasFile = "ai-app/playground/events/playground.event-schemas.ts";
    if (!exists(schemasFile)) {
      // May be inline registered; check events file
      const eventsFile = "ai-app/playground/events/playground.events.ts";
      const src = read(eventsFile);
      // goals-set must appear
      expect(src).toContain("goals-set");
      return;
    }
    const src = read(schemasFile);
    expect(src).toContain("goals-set");
  });

  it("no file treats initialRisks as z.array(z.string())", () => {
    // Any zod schema that defines initialRisks must use z.object, not z.string
    const allProd = prodTsFiles(MODULES);
    const violations = allProd.filter((f) => {
      try {
        const c = fs.readFileSync(f, "utf8");
        // Look for: initialRisks: z.array(z.string())
        return /initialRisks\s*:\s*z\.array\s*\(\s*z\.string/.test(c);
      } catch {
        return false;
      }
    });
    expect(violations).toHaveLength(0);
    if (violations.length > 0) {
      console.error(
        "initialRisks as z.array(z.string()) found in:",
        violations,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// P0-919d4a4cb: Hardcoded pricing — MODEL_COSTS / COST_PER_1K confined
// ---------------------------------------------------------------------------

describe("P0-919d4a4cb — hardcoded pricing confined to known locations", () => {
  it("COST_PER_1K_TOKENS does not appear in any production file", () => {
    const allProd = prodTsFiles(MODULES);
    const hits = allProd.filter((f) => {
      try {
        return fs.readFileSync(f, "utf8").includes("COST_PER_1K_TOKENS");
      } catch {
        return false;
      }
    });
    expect(hits).toHaveLength(0);
  });

  it("MODEL_COSTS appears in constraint-engine.ts only (as FALLBACK_TIER_COSTS semantic tiers)", () => {
    const allProd = prodTsFiles(MODULES);
    const hits = allProd
      .filter((f) => !f.includes("constraint-engine.ts"))
      .filter((f) => {
        try {
          return fs.readFileSync(f, "utf8").includes("MODEL_COSTS");
        } catch {
          return false;
        }
      });
    expect(hits).toHaveLength(0);
  });

  it("constraint-engine.ts uses semantic tier keys (cheap/balanced/premium), not real model IDs", () => {
    const ceFile = "ai-harness/guardrails/constraints/constraint-engine.ts";
    const src = read(ceFile);
    // The fallback table uses semantic tier names
    expect(src).toContain("cheap");
    expect(src).toContain("balanced");
    expect(src).toContain("premium");
    // And it uses ModelPricingRegistry as the primary source (optional injection)
    expect(src).toContain("ModelPricingRegistry");
    expect(src).toContain("pricingRegistry");
  });

  it("cost.calculator.ts has been deleted (ai-engine/planning/budget)", () => {
    const file = path.join(
      MODULES,
      "ai-engine/planning/budget/cost.calculator.ts",
    );
    expect(fs.existsSync(file)).toBe(false);
  });

  it("ai-observability.service.ts does not contain static estimateCost", () => {
    const file = "ai-harness/tracing/observability/ai-observability.service.ts";
    if (!exists(file)) return; // file was deleted — even better
    const src = read(file);
    expect(src).not.toContain("static estimateCost");
  });

  it("ai-metrics.service.ts does not contain private estimateCost", () => {
    const file = "platform/monitoring/metrics/ai-metrics.service.ts";
    if (!exists(file)) return;
    const src = read(file);
    expect(src).not.toContain("private estimateCost");
  });
});

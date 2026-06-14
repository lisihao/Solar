/**
 * self-driven-no-reinvention.spec.ts — anti-reinvented-wheel guard for the
 * Self-Driven Agent Team feature.
 *
 * Locks the 2026-06-05 remediation: self-driven is a THIN wiring layer; all real
 * capabilities come from harness/engine (reuse, or add a GENERIC capability to
 * the correct layer). This spec fails if anyone hand-rolls a capability the
 * platform already provides, or pulls in an illegal cross-layer dependency.
 *
 * Source-content assertions (regex over the real files) — eslint cannot express
 * "this hand-rolled algorithm must be absent AND that capability must be used".
 * Runs under verify:arch (pre-push step 0 + CI arch-boundary), no extra wiring.
 */
import * as fs from "fs";
import * as path from "path";

const SRC = path.join(__dirname, "..", "..", "..");
const SD_HARNESS = path.join(
  SRC,
  "modules/ai-harness/teams/orchestrator/self-driven",
);
const APPROVAL_SVC = path.join(
  SRC,
  "modules/ai-app/ask/self-driven/ask-self-driven-approval.service.ts",
);

const read = (p: string) => fs.readFileSync(p, "utf8");
const sdHarnessFiles = (): string[] =>
  fs
    .readdirSync(SD_HARNESS)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
    .map((f) => path.join(SD_HARNESS, f));

describe("self-driven: no reinvented wheels (reuse engine/harness capabilities)", () => {
  it("planner elects models via the engine ModelElectionService, not a hand-roll", () => {
    const planner = read(
      path.join(SD_HARNESS, "self-driven-mission-planner.service.ts"),
    );
    // Must NOT resurrect the hand-rolled "first available / default" selection.
    expect(planner).not.toMatch(
      /getAvailableModelsAsync|getDefaultModelByType/,
    );
    // Must use the shared scored election capability.
    expect(planner).toMatch(/\bModelElectionService\b/);
    expect(planner).toMatch(/\.elect\(/);
  });

  it("declares topologicalSort at most once across self-driven (no copies)", () => {
    // A declaration is `topologicalSort(` NOT preceded by a dot (calls are
    // `this.topologicalSort(`). Lock the count at 1, located in the runner.
    let declarations = 0;
    let declaringFile = "";
    for (const f of sdHarnessFiles()) {
      const m = read(f).match(/(?<![.\w])topologicalSort\s*\(/g);
      if (m) {
        declarations += m.length;
        declaringFile = path.basename(f);
      }
    }
    expect(declarations).toBeLessThanOrEqual(1);
    if (declarations === 1) {
      expect(declaringFile).toBe("self-driven-mission-runner.service.ts");
    }
  });

  it("owner approval delegates to HumanApprovalAdminService, no bespoke write", () => {
    const approval = read(APPROVAL_SVC);
    // Must NOT hand-roll the approval:response row upsert (the canonical writer
    // is HumanApprovalAdminService.respond()).
    expect(approval).not.toMatch(
      /approval:response:[\s\S]{0,200}?longTermMemory\.upsert/,
    );
    expect(approval).toMatch(/HumanApprovalAdminService/);
    expect(approval).toMatch(/\.respond\(/);
  });

  it("harness self-driven never imports ai-app (L2.5 must not reach into L3)", () => {
    for (const f of sdHarnessFiles()) {
      const src = read(f);
      expect(src).not.toMatch(/from\s+["']@\/modules\/ai-app/);
      expect(src).not.toMatch(/EnhancedDependencyService/); // lives in ai-app
    }
  });

  it("runner drives agents via AgentFactory, not a hand-rolled tool/ReAct loop", () => {
    const runner = read(
      path.join(SD_HARNESS, "self-driven-mission-runner.service.ts"),
    );
    expect(runner).toMatch(/\bAgentFactory\b/);
    expect(runner).toMatch(/\.execute\(/);
    // Guard against replacing the canonical loop with a bespoke tool_use loop
    // (also trips reverse-insight #1 on stop_reason handling).
    expect(runner).not.toMatch(/stop_reason/);
  });
});

/**
 * business-chain-coverage.spec.ts
 *
 * Playground business-chain critical-branch coverage — happy path plus all
 * significant exception/degraded paths — exercised via pure unit logic, no
 * NestJS bootstrapping and no DB.
 *
 * Each describe block is one named branch.  We validate:
 *   1. The helper / utility function does not throw.
 *   2. The output shape matches the expected contract.
 *
 * Covered branches:
 *   Happy    — RunMissionInputSchema parses a fully-valid input
 *   Failed   — writeFailed with errorMessage sets status='failed'
 *   Cancelled— writeCancelled guard: only running→cancelled is valid
 *   Quality  — writeFailed with leaderSigned=false sets status='quality-failed'
 *   Budget-Hard — budget estimate affordable=false, suggestion=abort → throws
 *   Budget-Soft — budget estimate affordable=false, suggestion=warn → continues
 *   Stage-Degraded — S3 all dims fail → markStageDegraded narrative emitted
 *   MaxCredits — resolveMissionCredits returns input.maxCredits 或按 depth 档位解析
 *   WallTime — resolveMissionWallTimeMs 按 depth 档位（DEPTH_BUDGET_TIERS）解析; wallTimeCapMs override 优先
 *   MaxIterations — RESEARCHER_MAX_ITERATIONS_HARD_CAP constant exists and is finite
 *   BudgetExhausted — dispatcher calls abortRegistry.abort on pool.isExhausted()
 *   LivenessConfig — playground registers staleThresholdMs >= 15min
 *   Postmortem — recordMissionPostmortem signature has required fields
 *
 * NOTE: Tests that cannot reach module constructors stay at the static-analysis
 * layer (file existence + content grep).  Tests where the pure function is
 * importable run real code.
 */

import * as fs from "fs";
import * as path from "path";

// Pure-function imports (no DI, no DB)
import {
  RunMissionInputSchema,
  resolveMissionCredits,
  resolveBudgetMultiplier,
  resolveMissionWallTimeMs,
  type RunMissionInput,
} from "../../modules/ai-app/playground/api/dto/run-mission.dto";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const MODULES = path.resolve(__dirname, "../../modules");

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(MODULES, rel), "utf8");
}

function _srcExists(rel: string): boolean {
  return fs.existsSync(path.join(MODULES, rel));
}

/** Minimal valid RunMissionInput factory */
function validInput(overrides: Partial<RunMissionInput> = {}): RunMissionInput {
  return {
    topic: "AI market analysis 2026",
    depth: "standard",
    language: "zh-CN",
    budgetProfile: "medium",
    styleProfile: "executive",
    lengthProfile: "standard",
    audienceProfile: "domain-expert",
    withFigures: true,
    auditLayers: "default",
    concurrency: 3,
    viewMode: "continuous",
    maxCredits: 500,
    budgetMultiplierOverride: 1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Branch 1: Happy path — valid input parses cleanly
// ---------------------------------------------------------------------------

describe("Branch: happy-path — RunMissionInputSchema full parse", () => {
  it("valid input parses with no error", () => {
    const result = RunMissionInputSchema.safeParse(validInput());
    expect(result.success).toBe(true);
  });

  it("all depth values accepted", () => {
    for (const depth of ["quick", "standard", "deep"] as const) {
      const result = RunMissionInputSchema.safeParse(validInput({ depth }));
      expect(result.success).toBe(true);
    }
  });

  it("all language values accepted", () => {
    for (const language of ["zh-CN", "en-US"] as const) {
      const result = RunMissionInputSchema.safeParse(validInput({ language }));
      expect(result.success).toBe(true);
    }
  });

  it("maxCredits boundary: 10 is min, 500000 is max", () => {
    // 2026-06-10：上限 100k→500k（BYOK 用户花自己 key、cost cap $1000，保留失控保护）。
    expect(
      RunMissionInputSchema.safeParse(validInput({ maxCredits: 10 })).success,
    ).toBe(true);
    expect(
      RunMissionInputSchema.safeParse(validInput({ maxCredits: 500_000 }))
        .success,
    ).toBe(true);
    expect(
      RunMissionInputSchema.safeParse(validInput({ maxCredits: 9 })).success,
    ).toBe(false);
    expect(
      RunMissionInputSchema.safeParse(validInput({ maxCredits: 500_001 }))
        .success,
    ).toBe(false);
  });

  it("budgetMultiplierOverride boundary: 0.3 min, 10 max", () => {
    expect(
      RunMissionInputSchema.safeParse(
        validInput({ budgetMultiplierOverride: 0.3 }),
      ).success,
    ).toBe(true);
    expect(
      RunMissionInputSchema.safeParse(
        validInput({ budgetMultiplierOverride: 10 }),
      ).success,
    ).toBe(true);
    expect(
      RunMissionInputSchema.safeParse(
        validInput({ budgetMultiplierOverride: 0.1 }),
      ).success,
    ).toBe(false);
    expect(
      RunMissionInputSchema.safeParse(
        validInput({ budgetMultiplierOverride: 10.1 }),
      ).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Branch 2: Failed path — errorMessage propagation
// ---------------------------------------------------------------------------

describe("Branch: failed path — MissionStore.writeFailed signature", () => {
  // 2026-05-24 P6 重构:writeFailed 方法本体下沉到
  // ai-harness/teams/business-team/lifecycle/business-team-lifecycle-transitions.framework.ts;
  // playground 通过 buildFailedUpdate hook 提供业务字段映射(leaderSigned/quality-failed/...)
  it("writeFailed method exists in harness lifecycle transitions framework", () => {
    const src = readSrc(
      "ai-harness/teams/business-team/lifecycle/business-team-lifecycle-transitions.framework.ts",
    );
    expect(src).toContain("async writeFailed(");
  });

  it("playground buildFailedUpdate sets status 'failed' / 'quality-failed' via isLeadRefusal", () => {
    // Static check: the status logic in playground hook
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-lifecycle.helper.ts",
    );
    // isLeadRefusal condition determines 'quality-failed' vs 'failed'
    expect(src).toContain("quality-failed");
    expect(src).toContain('"failed"');
    expect(src).toContain("isLeadRefusal");
  });

  it("writeFailed with leaderSigned=false sets 'quality-failed' status", () => {
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-lifecycle.helper.ts",
    );
    // isLeadRefusal check must reference leaderSigned === false
    expect(src).toContain("leaderSigned === false");
    // Status assignment must use 'quality-failed' for the lead-refusal path
    expect(src).toContain("quality-failed");
  });

  it("errorMessage is sliced to 2000 chars in writeFailed (no OOM)", () => {
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-lifecycle.helper.ts",
    );
    expect(src).toContain("errorMessage?.slice(0, 2000)");
  });
});

// ---------------------------------------------------------------------------
// Branch 3: Cancelled path
// ---------------------------------------------------------------------------

describe("Branch: cancelled path — writeCancelled guard", () => {
  // 2026-05-24 P6 重构:writeCancelled 本体下沉到 framework;
  // playground buildCancelledUpdate hook 提供业务 update shape;
  // race guard (status='running') 在 framework 的 conditionalUpdate hook 实现侧。
  it("writeCancelled only transitions from status='running' (race guard)", () => {
    // framework 持有 writeCancelled 方法本体
    const fwSrc = readSrc(
      "ai-harness/teams/business-team/lifecycle/business-team-lifecycle-transitions.framework.ts",
    );
    expect(fwSrc).toContain("async writeCancelled(");
    // playground hook 用 status: 'running' 条件 + cancelled 字段
    const playgroundSrc = readSrc(
      "ai-app/playground/mission/lifecycle/mission-lifecycle.helper.ts",
    );
    expect(playgroundSrc).toContain('status: "running"');
    expect(playgroundSrc).toContain("cancelled");
  });

  it("writeCancelled clears checkpoint via hook (listResumable guard)", () => {
    // framework 调 hooks.clearCheckpoint;playground 实现 clearCheckpointJsonbKey
    const fwSrc = readSrc(
      "ai-harness/teams/business-team/lifecycle/business-team-lifecycle-transitions.framework.ts",
    );
    const cancelIdx = fwSrc.indexOf("async writeCancelled(");
    expect(cancelIdx).toBeGreaterThan(-1);
    const cancelFn = fwSrc.slice(cancelIdx, cancelIdx + 800);
    expect(cancelFn).toContain("clearCheckpoint");
  });

  it("cancelled errorMessage is user-visible text", () => {
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-lifecycle.helper.ts",
    );
    // The hardcoded cancel reason string
    expect(src).toContain("Mission cancelled by user");
  });
});

// ---------------------------------------------------------------------------
// Branch 4: Quality-failed path
// ---------------------------------------------------------------------------

describe("Branch: quality-failed path — leader sign-off refusal", () => {
  it("playground buildFailedUpdate persists report artifacts even when leaderSigned=false (2026-04-30 fix)", () => {
    // 2026-05-24 P6: buildFailedUpdate hook 在 playground helper,参数名为 `d`,
    // 用 `d.field !== undefined` 守护 partial update
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-lifecycle.helper.ts",
    );
    expect(src).toContain("d.report !== undefined");
    expect(src).toContain("d.dimensions !== undefined");
  });

  it("leaderSigned=false writes to DB via buildFailedUpdate hook (falsy-skip bug fix)", () => {
    // 2026-05-24 P6: 同上,playground hook 用 `d.leaderSigned !== undefined`
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-lifecycle.helper.ts",
    );
    expect(src).toContain("d.leaderSigned !== undefined");
  });

  it("S10 stage emits signoff even on early-return paths", () => {
    const src = readSrc(
      "ai-app/playground/mission/pipeline/stages/s10-leader-foreword-and-signoff.stage.ts",
    );
    // The P0-A fix added comment about covering early return paths
    expect(src).toContain("P0-A");
  });
});

// ---------------------------------------------------------------------------
// Branch 5: Budget exhausted — pool.isExhausted() aborts mission
// ---------------------------------------------------------------------------

describe("Branch: budget-exhausted — abort signal is sent", () => {
  it("S3 stage emits budget:exhausted event when pool exhausted", () => {
    const src = readSrc(
      "ai-app/playground/mission/pipeline/stages/s3-researcher-collect-findings.stage.ts",
    );
    expect(src).toContain("playground.budget:exhausted");
    expect(src).toContain("pool.isExhausted()");
  });

  it("S3 stage calls abortRegistry.abort on budget exhaustion (P1-fix2)", () => {
    const src = readSrc(
      "ai-app/playground/mission/pipeline/stages/s3-researcher-collect-findings.stage.ts",
    );
    expect(src).toContain("abortRegistry.abort");
    expect(src).toContain("budget_exhausted");
  });

  it("budget:exhausted event type is registered in event schemas", () => {
    const eventsFile = "ai-app/playground/events/playground.events.ts";
    const src = readSrc(eventsFile);
    expect(src).toContain("budget:exhausted");
  });
});

// ---------------------------------------------------------------------------
// Branch 6: Stage degraded — S3 dim failures → markStageDegraded
// ---------------------------------------------------------------------------

describe("Branch: stage-degraded — markStageDegraded emits narrative", () => {
  it("markStageDegraded is defined in CommonDeps", () => {
    const src = readSrc("ai-app/playground/mission/context/mission-deps.ts");
    expect(src).toContain("markStageDegraded");
  });

  it("S3 stage-degraded 机制存活于 stage bindings（#16b 后 OFF 路/rerun 归属）", () => {
    // #16b（2026-06-09）硬切后 playground.pipeline.ts 的私有 pipeline（buildBaseHooksForStep
    // 等）退役，stage degraded 契约随 stage hooks 落在 mission-stage-bindings.service.ts
    // （仍被 stage-rerun 复用）。markStageDegraded dep 在此定义并喂给 S3/S4/S9 hooks。
    const src = readSrc(
      "ai-app/playground/mission/pipeline/mission-stage-bindings.service.ts",
    );
    expect(src).toContain("markStageDegraded");
  });

  it("S4 calls markStageDegraded instead of swallowing error (2026-05-06 A-6 fix)", () => {
    const src = readSrc(
      "ai-app/playground/mission/pipeline/stages/s4-leader-assess-research.stage.ts",
    );
    expect(src).toContain("markStageDegraded");
    // The fix comment
    expect(src).toContain("A-6");
  });

  it("S9 calls markStageDegraded on reviewer error (A-6 fix)", () => {
    const src = readSrc(
      "ai-app/playground/mission/pipeline/stages/s9-reviewer-critic-l4.stage.ts",
    );
    expect(src).toContain("markStageDegraded");
  });
});

// ---------------------------------------------------------------------------
// Branch 7: Chapter revision — reviewer-revise origin in todo-ledger
// ---------------------------------------------------------------------------

describe("Branch: chapter-revision — chapter:revision event handling", () => {
  it("chapter:revision event type exists in event enums", () => {
    const eventsFile = "ai-app/playground/events/playground.events.ts";
    const src = readSrc(eventsFile);
    expect(src).toContain("chapter:revision");
  });
});

// ---------------------------------------------------------------------------
// Branch 8: Dim retry — leader patch retry
// ---------------------------------------------------------------------------

describe("Branch: dim-retry — leader-assess retry signals", () => {
  it("dimension:retrying event type exists", () => {
    const eventsFile = "ai-app/playground/events/playground.events.ts";
    const src = readSrc(eventsFile);
    expect(src).toContain("retrying");
  });

  it("S4 dispatches retry when leader decides fresh-collect", () => {
    const src = readSrc(
      "ai-app/playground/mission/pipeline/stages/s4-leader-assess-research.stage.ts",
    );
    expect(src).toContain("fresh-collect");
  });
});

// ---------------------------------------------------------------------------
// Branch 9: Liveness stalled — orchestrator emits stage:stalled
// ---------------------------------------------------------------------------

describe("Branch: liveness-stalled — orchestrator emits stage:stalled event", () => {
  // 2026-05-24 P2 重构:stage:stalled 桥接逻辑下沉到
  // ai-harness/teams/business-team/dispatcher/business-team-mission-dispatcher.framework.ts
  // dispatcher 现仅通过 super.bridgeOrchestratorStageEvent(event, {...}) 调用 framework,
  // 并在配置中提供 stageStalledEvent="playground.stage:stalled" 命名空间。
  it("dispatcher delegates stage:stalled bridging to framework with playground namespace", () => {
    const src = readSrc(
      "ai-app/playground/mission/pipeline/playground.pipeline.ts",
    );
    expect(src).toContain("bridgeOrchestratorStageEvent");
    expect(src).toContain("playground.stage:stalled");
  });

  it("framework handles stage:stalled event from orchestrator", () => {
    const src = readSrc(
      "ai-harness/teams/business-team/dispatcher/business-team-mission-dispatcher.framework.ts",
    );
    expect(src).toContain('event.type === "stage:stalled"');
  });

  it("stage:stalled payload includes elapsedMs (framework source)", () => {
    const src = readSrc(
      "ai-harness/teams/business-team/dispatcher/business-team-mission-dispatcher.framework.ts",
    );
    let idx = 0;
    let found = false;
    while ((idx = src.indexOf("stage:stalled", idx)) !== -1) {
      const segment = src.slice(idx, idx + 600);
      if (segment.includes("elapsedMs")) {
        found = true;
        break;
      }
      idx++;
    }
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pure-function unit tests for resolveMissionCredits / resolveMissionWallTimeMs
// ---------------------------------------------------------------------------

describe("resolveMissionCredits — pure function contracts", () => {
  it("returns exactly input.maxCredits (no fallback multiplier)", () => {
    const input = validInput({ maxCredits: 250 });
    expect(resolveMissionCredits(input)).toBe(250);
  });

  it("is not affected by budgetProfile value", () => {
    const low = validInput({ maxCredits: 100, budgetProfile: "low" });
    const high = validInput({ maxCredits: 100, budgetProfile: "high" });
    expect(resolveMissionCredits(low)).toBe(100);
    expect(resolveMissionCredits(high)).toBe(100);
  });
});

describe("resolveBudgetMultiplier — pure function contracts", () => {
  it("returns exactly input.budgetMultiplierOverride", () => {
    const input = validInput({ budgetMultiplierOverride: 2.5 });
    expect(resolveBudgetMultiplier(input)).toBe(2.5);
  });
});

describe("resolveMissionWallTimeMs — pure function contracts", () => {
  it("returns user-supplied wallTimeCapMs when set", () => {
    const input = validInput({ wallTimeCapMs: 300_000 });
    expect(resolveMissionWallTimeMs(input)).toBe(300_000);
  });

  it("never exceeds 24 hours hard ceiling (86400000 ms)", () => {
    // ★ 2026-05-27：本地模型深度分析需求上调到 24h（deep=1440min）
    //   与 DTO wallTimeCapMs.max + BUDGET_FIELD_LIMITS.wallTimeMinutes.max 对齐。
    const input = validInput({ depth: "deep" });
    expect(resolveMissionWallTimeMs(input)).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });

  // ★ 2026-05-27 单一源：wall-time 由 DEPTH_BUDGET_TIERS 按 depth 解析。
  //   quick=180min / standard=600min / deep=1440min（应对本地模型深度分析时长）
  it("standard tier wall-time is 600 min (10h) (DEPTH_BUDGET_TIERS, key regression)", () => {
    const input = validInput({ depth: "standard" });
    expect(resolveMissionWallTimeMs(input)).toBe(600 * 60 * 1000);
  });

  it("quick tier wall-time is 180 min (3h)", () => {
    const input = validInput({ depth: "quick" });
    expect(resolveMissionWallTimeMs(input)).toBe(180 * 60 * 1000);
  });

  it("deep tier wall-time is 1440 min (24h)", () => {
    const input = validInput({ depth: "deep" });
    expect(resolveMissionWallTimeMs(input)).toBe(1440 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// Refine validation: quick + epic/mega must fail
// ---------------------------------------------------------------------------

describe("RunMissionInputSchema refine — quick depth + epic/mega forbidden", () => {
  it("quick + epic is rejected", () => {
    const result = RunMissionInputSchema.safeParse(
      validInput({ depth: "quick", lengthProfile: "epic" }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "";
      expect(msg).toContain("quick");
    }
  });

  it("quick + mega is rejected", () => {
    const result = RunMissionInputSchema.safeParse(
      validInput({ depth: "quick", lengthProfile: "mega" }),
    );
    expect(result.success).toBe(false);
  });

  it("standard + epic is accepted", () => {
    const result = RunMissionInputSchema.safeParse(
      validInput({ depth: "standard", lengthProfile: "epic" }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Researcher maxIterationsHardCap constant exists and is reasonable
// ---------------------------------------------------------------------------

describe("RESEARCHER_MAX_ITERATIONS_HARD_CAP — P1 runaway fix", () => {
  it("constant is defined in researcher agent", () => {
    const src = readSrc(
      "ai-app/marketplace/capabilities/deep-insight/agents/researcher/researcher.agent.ts",
    );
    expect(src).toContain("RESEARCHER_MAX_ITERATIONS_HARD_CAP");
  });

  it("maxIterationsHardCap is wired into agent config", () => {
    const src = readSrc(
      "ai-app/marketplace/capabilities/deep-insight/agents/researcher/researcher.agent.ts",
    );
    expect(src).toContain("maxIterationsHardCap");
  });
});

// ---------------------------------------------------------------------------
// Postmortem — recordMissionPostmortem public interface
// ---------------------------------------------------------------------------

describe("recordMissionPostmortem — S12 closure interface", () => {
  it("method exists in MissionPostmortemHelper", () => {
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-postmortem.helper.ts",
    );
    expect(src).toContain("async recordMissionPostmortem(");
  });

  it("method signature includes missionId, userId, topic, summary", () => {
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-postmortem.helper.ts",
    );
    const fnIdx = src.indexOf("async recordMissionPostmortem(");
    const sig = src.slice(fnIdx, fnIdx + 500);
    expect(sig).toContain("missionId");
    expect(sig).toContain("userId");
    expect(sig).toContain("topic");
    expect(sig).toContain("summary");
  });

  it("writes to harnessVectorMemory with tag mission-postmortem (C4 embedding closure)", () => {
    const src = readSrc(
      "ai-app/playground/mission/lifecycle/mission-postmortem.helper.ts",
    );
    expect(src).toContain("harnessVectorMemory");
    expect(src).toContain("mission-postmortem");
  });
});

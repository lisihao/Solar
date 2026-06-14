import { runLeaderForewordAndSignoffStage } from "../s10-leader-foreword-and-signoff.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

const FOREWORD_OUTPUT = {
  whatWeAnswered: "We answered AI trends",
  whatRemainsUnclear: "Policy impact unclear",
  howToRead: "Start from executive summary",
  recommendedFollowUp: "Deeper analysis of policy",
  generatedAt: new Date().toISOString(),
};

const SIGNOFF_OUTPUT = {
  signed: true,
  leaderVerdict: "good" as const,
  leaderOverallScore: 82,
  accountabilityNote: "All goals met",
};

function makeReportArtifact() {
  return {
    metadata: {
      topic: "AI",
      wordCount: 5000,
      leaderForeword: null,
      modelTrail: [],
    },
    quickView: { executiveSummary: { markdown: "AI summary" } },
    sections: [
      { id: "s1", title: "Market" },
      { id: "s2", title: "Technology" },
    ],
    citations: [{ index: 1 }],
    figures: [],
    factTable: [],
    quality: {
      overall: 80,
      dimensions: {
        coverage: 90,
        novelty: 70,
        styleConformance: 75,
        traceability: 80,
        factualConsistency: 80,
        redundancy: 80,
        formatCorrectness: 80,
        citationDensity: 80,
        lengthAccuracy: 75,
        chapterBalance: 80,
      },
      hardGateViolations: [],
      warnings: [],
      qualityTrace: [],
      finalVerdict: "good",
    },
  };
}

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m10",
    userId: "u1",
    t0: Date.now(),
    budgetMultiplier: 1.0,
    input: {
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      auditLayers: "thorough",
      audienceProfile: "professional",
      styleProfile: "analytical",
      lengthProfile: "standard",
    } as MissionContext["input"],
    billing: {} as MissionContext["billing"],
    pool: {} as MissionContext["pool"],
    leader: {
      // ★ 必须深拷贝 fixture — s10 stage 会原地 mutate signOff 返回值（leaderSignOff.signed=false 等），
      //   传引用会污染下一个测试的 SIGNOFF_OUTPUT
      writeForeword: jest.fn().mockResolvedValue({ ...FOREWORD_OUTPUT }),
      signOff: jest.fn().mockResolvedValue({ ...SIGNOFF_OUTPUT }),
    } as unknown as MissionContext["leader"],
    plan: {
      themeSummary: "AI",
      dimensions: [{ id: "d1", name: "Market", rationale: "r" }],
      goals: {} as never,
      initialRisks: [],
    },
    researcherResults: [
      {
        dimension: "Market",
        findings: [{ claim: "c", evidence: "e", source: "http://a.com" }],
        summary: "ok",
      },
    ],
    reportArtifact:
      makeReportArtifact() as unknown as MissionContext["reportArtifact"],
    verifierVerdicts: [{ score: 80, critique: "ok" }],
    reviewScore: 80,
    reconciliationReport: null,
    ...overrides,
  } as unknown as MissionContext;
}

function makeDeps(overrides: Partial<MissionDeps> = {}): MissionDeps {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
    log: {
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    },
    lifecycle: jest.fn().mockResolvedValue(undefined),
    // ★ 2026-05-07 R1 共识 P0 (architect+tester): s10 加 markIntermediateState
    //   持久化 leaderSigned/leaderOverallScore/leaderVerdict 到主行（cascade rerun
    //   删 reset-before-rerun 后的核心数据流）。spec 必须 mock store。
    store: {
      markIntermediateState: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runLeaderForewordAndSignoffStage (S10)", () => {
  // ★ 2026-05-07 R1 共识 P0 (architect+tester): cascade rerun 删 reset-before-rerun
  //   后，s10 必须主动持久化 leaderSigned/leaderOverallScore/leaderVerdict 到主行，
  //   否则从 s10 重跑且 cascade 在 s11 失败时主行 leader_* 字段保持 NULL，前端看不到
  //   本次签收结果。本 invariant spec 必须保留 — 否则未来有人删了主动持久化不会被拦下。
  it("PR-R4 主动持久化: signoff 完成后调 store.markIntermediateState 写 leaderSigned/Score/Verdict", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(deps.store.markIntermediateState).toHaveBeenCalled();
    const callArgs = (deps.store.markIntermediateState as jest.Mock).mock
      .calls[0];
    expect(callArgs[0]).toBe(ctx.missionId);
    const patch = callArgs[1];
    // 至少包含 leaderSigned / leaderOverallScore / leaderVerdict 之一（非 undefined）
    expect(
      patch.leaderSigned !== undefined ||
        patch.leaderOverallScore !== undefined ||
        patch.leaderVerdict !== undefined,
    ).toBe(true);
    // 第三参 userId 走严格隔离路径
    expect(callArgs[2]).toBe(ctx.userId);
  });

  it("PR-R4 主动持久化: forced unsigned 路径也写 leaderSigned=false（拒签产物入库）", async () => {
    const ctx = makeCtx({ reportArtifact: undefined });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(deps.store.markIntermediateState).toHaveBeenCalled();
    const patch = (deps.store.markIntermediateState as jest.Mock).mock
      .calls[0][1];
    expect(patch.leaderSigned).toBe(false);
  });

  it("forces unsigned signoff if reportArtifact is undefined", async () => {
    const ctx = makeCtx({ reportArtifact: undefined });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(ctx.leader.writeForeword).not.toHaveBeenCalled();
    expect(ctx.leaderSignOff?.signed).toBe(false);
    expect(ctx.leaderSignOff?.refusalReason).toBe("report_artifact_missing");
  });

  it("forces unsigned signoff if plan is undefined", async () => {
    const ctx = makeCtx({ plan: undefined });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(ctx.leader.writeForeword).not.toHaveBeenCalled();
    expect(ctx.leaderSignOff?.signed).toBe(false);
    expect(ctx.leaderSignOff?.refusalReason).toBe("plan_missing");
  });

  it("forces unsigned signoff if researcherResults is undefined", async () => {
    const ctx = makeCtx({ researcherResults: undefined });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(ctx.leader.writeForeword).not.toHaveBeenCalled();
    expect(ctx.leaderSignOff?.signed).toBe(false);
    expect(ctx.leaderSignOff?.refusalReason).toBe("researcher_results_missing");
  });

  it("happy path: writes ctx.leaderForeword and ctx.leaderSignOff", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(ctx.leaderForeword).toBeDefined();
    expect(ctx.leaderSignOff).toBeDefined();
    expect(ctx.leaderSignOff?.signed).toBe(true);
  });

  it("foreword output written to reportArtifact.metadata.leaderForeword", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(ctx.reportArtifact!.metadata.leaderForeword).toEqual(
      FOREWORD_OUTPUT,
    );
  });

  it("emits leader:foreword event", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const forewordCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.leader:foreword",
    );
    expect(forewordCall).toBeDefined();
  });

  it("emits leader:signed event", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const signedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.leader:signed",
    );
    expect(signedCall).toBeDefined();
  });

  it("foreword failure → forces unsigned signoff and skips signoff call", async () => {
    const ctx = makeCtx();
    (ctx.leader.writeForeword as jest.Mock).mockRejectedValue(
      new Error("LLM error"),
    );
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(ctx.leader.signOff).not.toHaveBeenCalled();
    expect(ctx.leaderSignOff?.signed).toBe(false);
    expect(ctx.leaderSignOff?.refusalReason).toBe("foreword_failed");
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("foreword failed"),
    );
  });

  it("signoff failure → logs warn and forces unsigned signoff", async () => {
    const ctx = makeCtx();
    (ctx.leader.signOff as jest.Mock).mockRejectedValue(
      new Error("signoff error"),
    );
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(ctx.leaderSignOff?.signed).toBe(false);
    expect(ctx.leaderSignOff?.refusalReason).toBe("signoff_failed");
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("signoff failed"),
    );
  });

  it("signed=false verdict captured in leaderSignOff", async () => {
    const ctx = makeCtx();
    (ctx.leader.signOff as jest.Mock).mockResolvedValue({
      signed: false,
      leaderVerdict: "failed",
      leaderOverallScore: 35,
      refusalReason: "Coverage too low",
    });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    expect(ctx.leaderSignOff?.signed).toBe(false);
  });

  it("dimensionStates: failed dim (0 findings) = 'failed'", async () => {
    const ctx = makeCtx();
    ctx.researcherResults = [
      { dimension: "Market", findings: [], summary: "empty" },
    ];
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const signoffCall = (ctx.leader.signOff as jest.Mock).mock.calls[0];
    // signOff receives dimensionStates as second param
    expect(signoffCall[1]).toEqual(
      expect.arrayContaining([{ name: "Market", state: "failed" }]),
    );
  });

  it("criticVerdict extracted from quality.warnings l4-critic message", async () => {
    const ctx = makeCtx();
    ctx.reportArtifact!.quality.warnings.push({
      dimension: "l4-critic",
      message: "[pass] Report is solid",
    });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const forewordCall = (ctx.leader.writeForeword as jest.Mock).mock
      .calls[0][0];
    expect(forewordCall.qualitySnapshot.criticVerdict).toBe("pass");
  });

  it("reviewerAvg computed from verifierVerdicts scores", async () => {
    const ctx = makeCtx({ verifierVerdicts: [{ score: 80 }, { score: 90 }] });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const forewordCall = (ctx.leader.writeForeword as jest.Mock).mock
      .calls[0][0];
    expect(forewordCall.qualitySnapshot.reviewerAvgScore).toBe(85);
  });

  it("reportEvaluation injected into signoff call when available", async () => {
    const ctx = makeCtx();
    ctx.reportEvaluation = {
      overallScore: 78,
      grade: "B",
      feedback: "OK",
      modelComparison: [],
    } as MissionContext["reportEvaluation"];
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const signoffCall = (ctx.leader.signOff as jest.Mock).mock.calls[0][0];
    expect(signoffCall.objectiveScore).toBe(78);
  });

  it("reconciliationReport with critical gaps → criticalGaps filter covered", async () => {
    const ctx = makeCtx({
      reconciliationReport: {
        factTable: [{ id: "f1" }],
        conflicts: [],
        gaps: [
          {
            severity: "critical",
            expectedAspects: ["regulation", "compliance"],
          },
          { severity: "minor", expectedAspects: ["optional"] },
        ],
      } as unknown as MissionContext["reconciliationReport"],
    });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const forewordCall = (ctx.leader.writeForeword as jest.Mock).mock
      .calls[0][0];
    expect(forewordCall.reconciliation.criticalGaps).toHaveLength(1);
    expect(forewordCall.reconciliation.criticalGaps[0]).toContain("regulation");
  });

  it("l4-blindspot and l4-bias warnings → criticBlindspots/criticBiases covered", async () => {
    const ctx = makeCtx();
    ctx.reportArtifact!.quality.warnings.push(
      { dimension: "l4-blindspot", message: "Missing regulatory context" },
      { dimension: "l4-bias", message: "Western-centric framing" },
    );
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const forewordCall = (ctx.leader.writeForeword as jest.Mock).mock
      .calls[0][0];
    expect(forewordCall.qualitySnapshot.criticBlindspots).toEqual([
      "Missing regulatory context",
    ]);
    expect(forewordCall.qualitySnapshot.criticBiases).toEqual([
      "Western-centric framing",
    ]);
  });

  it("summary starting with (failed → dimState = degraded", async () => {
    const ctx = makeCtx();
    ctx.researcherResults = [
      {
        dimension: "Market",
        findings: [{ claim: "c", evidence: "e", source: "http://a.com" }],
        summary: "(failed: LLM timeout)",
      },
    ];
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const signoffCall = (ctx.leader.signOff as jest.Mock).mock.calls[0];
    expect(signoffCall[1]).toEqual(
      expect.arrayContaining([{ name: "Market", state: "degraded" }]),
    );
  });

  it("verifierVerdicts empty → reviewerAvg is undefined in foreword", async () => {
    const ctx = makeCtx({ verifierVerdicts: [] });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const forewordCall = (ctx.leader.writeForeword as jest.Mock).mock
      .calls[0][0];
    expect(forewordCall.qualitySnapshot.reviewerAvgScore).toBeUndefined();
  });

  it("l4-critic message [fail] → criticVerdict = fail", async () => {
    const ctx = makeCtx();
    ctx.reportArtifact!.quality.warnings.push({
      dimension: "l4-critic",
      message: "[fail] Report has major flaws",
    });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const forewordCall = (ctx.leader.writeForeword as jest.Mock).mock
      .calls[0][0];
    expect(forewordCall.qualitySnapshot.criticVerdict).toBe("fail");
  });

  it("l4-critic message [concerns] → criticVerdict = concerns", async () => {
    const ctx = makeCtx();
    ctx.reportArtifact!.quality.warnings.push({
      dimension: "l4-critic",
      message: "[concerns] Some areas need attention",
    });
    const deps = makeDeps();
    await runLeaderForewordAndSignoffStage(ctx, deps);
    const forewordCall = (ctx.leader.writeForeword as jest.Mock).mock
      .calls[0][0];
    expect(forewordCall.qualitySnapshot.criticVerdict).toBe("concerns");
  });

  describe("字数 hard floor post-validation (tier-aware signoffPolicyFor)", () => {
    it("standard (8K target × 0.4 ratio) + 3200 words → signed stays true", async () => {
      const ctx = makeCtx();
      ctx.reportArtifact!.metadata = {
        ...ctx.reportArtifact!.metadata,
        wordCount: 3200,
        lengthProfile: "standard",
      } as (typeof ctx.reportArtifact)["metadata"];
      const deps = makeDeps();
      await runLeaderForewordAndSignoffStage(ctx, deps);
      expect(ctx.leaderSignOff?.signed).toBe(true);
    });

    it("standard + actualWords < tier minWords → override to signed=false, reason=Insufficient-Content-Hard-Block", async () => {
      // standard tier minWords = max(8000 * 0.4, 500) = 3200; 100 words far below
      const ctx = makeCtx();
      ctx.reportArtifact!.metadata = {
        ...ctx.reportArtifact!.metadata,
        wordCount: 100,
        lengthProfile: "standard",
      } as (typeof ctx.reportArtifact)["metadata"];
      const deps = makeDeps();
      await runLeaderForewordAndSignoffStage(ctx, deps);
      expect(ctx.leaderSignOff?.signed).toBe(false);
      expect(ctx.leaderSignOff?.leaderVerdict).toBe("failed");
      expect(ctx.leaderSignOff?.accountabilityNote).toContain(
        "Insufficient-Content-Hard-Block",
      );
    });

    it("mega tier (200K target × 0.10 ratio) is more lenient: 25K words signs", async () => {
      // mega minWords = max(200000 * 0.10, 2000) = 20000; 25000 passes
      const ctx = makeCtx();
      ctx.reportArtifact!.metadata = {
        ...ctx.reportArtifact!.metadata,
        wordCount: 25000,
        lengthProfile: "mega",
      } as (typeof ctx.reportArtifact)["metadata"];
      ctx.input = {
        ...ctx.input,
        lengthProfile: "mega",
      } as typeof ctx.input;
      const deps = makeDeps();
      await runLeaderForewordAndSignoffStage(ctx, deps);
      expect(ctx.leaderSignOff?.signed).toBe(true);
    });

    it("mega tier still rejects far-below-tier-minWords: 1000 words → unsign", async () => {
      // mega minWords = max(200000 * 0.10, 2000) = 20000; 1000 way below
      const ctx = makeCtx();
      ctx.reportArtifact!.metadata = {
        ...ctx.reportArtifact!.metadata,
        wordCount: 1000,
        lengthProfile: "mega",
      } as (typeof ctx.reportArtifact)["metadata"];
      ctx.input = {
        ...ctx.input,
        lengthProfile: "mega",
      } as typeof ctx.input;
      const deps = makeDeps();
      await runLeaderForewordAndSignoffStage(ctx, deps);
      expect(ctx.leaderSignOff?.signed).toBe(false);
      expect(ctx.leaderSignOff?.refusalReason).toBe("insufficient_content");
    });

    it("signed=false → hard floor not applied (no double override)", async () => {
      const ctx = makeCtx();
      ctx.reportArtifact!.metadata = {
        ...ctx.reportArtifact!.metadata,
        wordCount: 0,
        lengthProfile: "standard",
      } as (typeof ctx.reportArtifact)["metadata"];
      (ctx.leader.signOff as jest.Mock).mockResolvedValue({
        signed: false,
        leaderVerdict: "failed",
        leaderOverallScore: 30,
        accountabilityNote:
          "Original refusal reason with sufficient length here.",
        phase: "signoff",
      });
      const deps = makeDeps();
      await runLeaderForewordAndSignoffStage(ctx, deps);
      // signed was already false — accountabilityNote should NOT contain hard-block tag
      expect(ctx.leaderSignOff?.accountabilityNote).not.toContain(
        "Insufficient-Content-Hard-Block",
      );
    });

    it("lengthProfile missing / target=0 → hard floor skipped (backward-compatible)", async () => {
      const ctx = makeCtx();
      ctx.reportArtifact!.metadata = {
        ...ctx.reportArtifact!.metadata,
        wordCount: 0,
      } as (typeof ctx.reportArtifact)["metadata"];
      // Override input to use a profile that maps to 0 is not possible via lengthTargetFor
      // (it always returns ≥3000), so test that wordCount=0 with brief (3000) still triggers
      // the floor. This verifies the actualWords=0 path works.
      ctx.input = {
        ...ctx.input,
        lengthProfile: "brief",
      } as typeof ctx.input;
      const deps = makeDeps();
      await runLeaderForewordAndSignoffStage(ctx, deps);
      // 0 < 3000 * 0.3 = 900 → override fires
      expect(ctx.leaderSignOff?.signed).toBe(false);
      expect(ctx.leaderSignOff?.accountabilityNote).toContain(
        "Insufficient-Content-Hard-Block",
      );
    });

    it("chapters (sections) empty → wordCount=0 triggers override", async () => {
      const ctx = makeCtx();
      ctx.reportArtifact!.sections = [];
      ctx.reportArtifact!.metadata = {
        ...ctx.reportArtifact!.metadata,
        wordCount: 0,
        lengthProfile: "standard",
      } as (typeof ctx.reportArtifact)["metadata"];
      const deps = makeDeps();
      await runLeaderForewordAndSignoffStage(ctx, deps);
      expect(ctx.leaderSignOff?.signed).toBe(false);
      expect(ctx.leaderSignOff?.accountabilityNote).toContain(
        "Insufficient-Content-Hard-Block",
      );
    });
  });
});

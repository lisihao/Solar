import { runCriticStage } from "../s9-reviewer-critic-l4.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

function makeReportArtifact(overrides = {}) {
  return {
    metadata: { topic: "AI", modelTrail: ["gpt-4"], wordCount: 5000 },
    quickView: {
      executiveSummary: { markdown: "AI is transforming industry" },
    },
    sections: [{ id: "s1", title: "Market", citations: [], figureIds: [] }],
    citations: [{ index: 1 }],
    figures: [],
    factTable: [],
    quality: {
      overall: 80,
      dimensions: {
        novelty: 70,
        styleConformance: 75,
        traceability: 80,
        factualConsistency: 80,
        coverage: 90,
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
    ...overrides,
  };
}

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m9",
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
    pool: {
      snapshot: jest
        .fn()
        .mockReturnValue({ poolCostUsd: 0, poolTokensUsed: 0 }),
    } as unknown as MissionContext["pool"],
    leader: {} as MissionContext["leader"],
    reportArtifact:
      makeReportArtifact() as unknown as MissionContext["reportArtifact"],
    verifierVerdicts: [{ score: 80, critique: "ok" }],
    reviewScore: 80,
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
    markStageDegraded: jest.fn().mockResolvedValue(undefined),
    reviewer: {
      criticL4: jest.fn().mockResolvedValue({
        state: "completed",
        output: {
          overallVerdict: "pass",
          blindspots: [],
          biasFlags: [],
          suggestions: ["Add more examples"],
          rationale: "Report is solid",
        },
        events: [],
        wallTimeMs: 1000,
        iterations: 2,
      }),
    },
    invoker: {
      tickCost: jest.fn().mockResolvedValue(undefined),
      preDisableKnownFailingModels: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runCriticStage (S9)", () => {
  it("skips if reportArtifact is undefined", async () => {
    const ctx = makeCtx({ reportArtifact: undefined });
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.reviewer.criticL4).not.toHaveBeenCalled();
  });

  it("skips when auditLayers is 'standard' and audience not executive", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        auditLayers: "standard",
        audienceProfile: "professional",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.reviewer.criticL4).not.toHaveBeenCalled();
  });

  it("runs when auditLayers is thorough", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.reviewer.criticL4).toHaveBeenCalled();
  });

  it("runs when auditLayers is paranoid", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        auditLayers: "thorough+",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.reviewer.criticL4).toHaveBeenCalled();
  });

  it("runs when audience=executive regardless of auditLayers (non-minimal)", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        auditLayers: "standard",
        audienceProfile: "executive",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.reviewer.criticL4).toHaveBeenCalled();
  });

  it("does not run when auditLayers=minimal even for executive", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        auditLayers: "minimal",
        audienceProfile: "executive",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.reviewer.criticL4).not.toHaveBeenCalled();
  });

  it("pass verdict → pushes warnings + qualityTrace but no hardGateViolations", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    const { quality } = ctx.reportArtifact!;
    expect(quality.qualityTrace.some((t) => t.stage === "critic")).toBe(true);
    expect(quality.hardGateViolations).toHaveLength(0);
  });

  it("fail verdict → lowers overall + adds hardGateViolation", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reviewer.criticL4 as jest.Mock).mockResolvedValue({
      state: "completed",
      output: {
        overallVerdict: "fail",
        blindspots: ["missed climate"],
        biasFlags: ["optimism bias"],
        suggestions: [],
        rationale: "Report is weak",
      },
      events: [],
      wallTimeMs: 1000,
      iterations: 2,
    });
    const originalOverall = ctx.reportArtifact!.quality.overall;
    await runCriticStage(ctx, deps);
    expect(ctx.reportArtifact!.quality.overall).toBeLessThan(originalOverall);
    expect(
      ctx.reportArtifact!.quality.hardGateViolations.length,
    ).toBeGreaterThan(0);
  });

  it("concerns verdict → lowers overall moderately (0.9 factor)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reviewer.criticL4 as jest.Mock).mockResolvedValue({
      state: "completed",
      output: {
        overallVerdict: "concerns",
        blindspots: ["limited scope"],
        biasFlags: [],
        suggestions: ["expand"],
        rationale: "Some concerns",
      },
      events: [],
      wallTimeMs: 1000,
      iterations: 2,
    });
    const originalOverall = ctx.reportArtifact!.quality.overall;
    await runCriticStage(ctx, deps);
    expect(ctx.reportArtifact!.quality.overall).toBeLessThan(originalOverall);
    expect(ctx.reportArtifact!.quality.hardGateViolations).toHaveLength(0);
  });

  it("criticL4 throws → logs warn and continues (non-fatal)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reviewer.criticL4 as jest.Mock).mockRejectedValue(
      new Error("critic failed"),
    );
    await expect(runCriticStage(ctx, deps)).resolves.toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("L4 critic failed"),
    );
  });

  it("emits critic:verdict event on success", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    const verdictCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.critic:verdict",
    );
    expect(verdictCall).toBeDefined();
    expect(verdictCall[0].payload.verdict).toBe("pass");
  });

  it("fail verdict with biasFlags → reduces styleConformance", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reviewer.criticL4 as jest.Mock).mockResolvedValue({
      state: "completed",
      output: {
        overallVerdict: "fail",
        blindspots: [],
        biasFlags: ["optimism bias", "selection bias"],
        suggestions: [],
        rationale: "Biased report",
      },
      events: [],
      wallTimeMs: 1000,
      iterations: 2,
    });
    const originalStyle =
      ctx.reportArtifact!.quality.dimensions.styleConformance;
    await runCriticStage(ctx, deps);
    expect(
      ctx.reportArtifact!.quality.dimensions.styleConformance,
    ).toBeLessThan(originalStyle);
  });

  it("tickCost called after critic run", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.invoker.tickCost).toHaveBeenCalled();
  });

  it("verifierVerdicts undefined → defaults to [] (upstreamReviewerVerdict falsy branch)", async () => {
    const ctx = makeCtx({ verifierVerdicts: undefined });
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.reviewer.criticL4).toHaveBeenCalled();
    const callArg = (deps.reviewer.criticL4 as jest.Mock).mock.calls[0][0];
    expect(callArg.upstreamReviewerVerdict).toBeUndefined();
  });

  it("reviewScore undefined → defaults to 0", async () => {
    const ctx = makeCtx({ reviewScore: undefined });
    const deps = makeDeps();
    await runCriticStage(ctx, deps);
    expect(deps.reviewer.criticL4).toHaveBeenCalled();
  });

  it("LLM output with invalid/non-array fields → uses fallback empty arrays", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reviewer.criticL4 as jest.Mock).mockResolvedValue({
      state: "completed",
      output: {
        overallVerdict: "unknown-verdict",
        blindspots: "not an array",
        biasFlags: null,
        suggestions: 42,
        rationale: 99,
      },
      events: [],
      wallTimeMs: 500,
      iterations: 1,
    });
    await runCriticStage(ctx, deps);
    const verdictCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.critic:verdict",
    );
    expect(verdictCall).toBeDefined();
    expect(verdictCall[0].payload.verdict).toBe("concerns");
    expect(verdictCall[0].payload.blindspotCount).toBe(0);
    expect(verdictCall[0].payload.biasCount).toBe(0);
  });

  it("criticL4 throws non-Error → String(err) branch covered", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reviewer.criticL4 as jest.Mock).mockRejectedValue("string error");
    await expect(runCriticStage(ctx, deps)).resolves.toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("L4 critic failed"),
    );
  });
});

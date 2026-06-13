import { runReportObjectiveEvaluationStage } from "../s9b-report-objective-evaluation.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

const LONG_BODY = "This is content for evaluation purposes ".repeat(20);

function makeSection(id: string, offset: number, title: string) {
  const body = LONG_BODY;
  const start = offset;
  const end = offset + body.length;
  return {
    id,
    title,
    startOffset: start,
    endOffset: end,
    citations: [],
    figureIds: [],
    factIds: [],
    type: "dimension" as const,
    level: 2,
    anchor: title.toLowerCase(),
    wordCount: 100,
    readingTimeMinutes: 1,
  };
}

function _buildMd(sections: ReturnType<typeof makeSection>[]) {
  let md = "# Report\n\n";
  for (const _s of sections) {
    // The section offsets need to be real positions in the markdown
    md += LONG_BODY;
  }
  return md;
}

function makeReportArtifact() {
  const sec1 = makeSection("s1", 0, "Market");
  const sec2 = makeSection("s2", LONG_BODY.length, "Technology");
  const fullMarkdown = LONG_BODY + LONG_BODY;
  sec1.startOffset = 0;
  sec1.endOffset = LONG_BODY.length;
  sec2.startOffset = LONG_BODY.length;
  sec2.endOffset = fullMarkdown.length;

  return {
    sections: [sec1, sec2],
    content: { fullMarkdown, fullReportSize: Buffer.byteLength(fullMarkdown) },
    citations: [],
    figures: [],
    quality: {
      overall: 80,
      dimensions: {},
      hardGateViolations: [],
      warnings: [],
      qualityTrace: [],
      finalVerdict: "good",
    },
    metadata: { topic: "AI", modelTrail: ["gpt-4"] },
    quickView: {},
    factTable: [],
  };
}

const EVAL_RESULT = {
  overallScore: 82,
  grade: "B",
  feedback: "Good depth with some gaps",
  modelComparison: [{ model: "gpt-4", avgScore: 82 }],
};

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m9b",
    userId: "u1",
    t0: Date.now(),
    budgetMultiplier: 1.0,
    input: {
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      auditLayers: "thorough",
      audienceProfile: "professional",
    } as MissionContext["input"],
    billing: {} as MissionContext["billing"],
    pool: {} as MissionContext["pool"],
    leader: {} as MissionContext["leader"],
    reportArtifact:
      makeReportArtifact() as unknown as MissionContext["reportArtifact"],
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
    reportEvaluation: {
      evaluateReport: jest.fn().mockResolvedValue(EVAL_RESULT),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runReportObjectiveEvaluationStage (S9B)", () => {
  it("skips if reportArtifact is undefined", async () => {
    const ctx = makeCtx({ reportArtifact: undefined });
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    expect(deps.reportEvaluation.evaluateReport).not.toHaveBeenCalled();
  });

  it("skips if sections is empty", async () => {
    const art = makeReportArtifact();
    art.sections = [];
    const ctx = makeCtx({
      reportArtifact: art as unknown as MissionContext["reportArtifact"],
    });
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    expect(deps.reportEvaluation.evaluateReport).not.toHaveBeenCalled();
  });

  it("skips when auditLayers=minimal", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        auditLayers: "minimal",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    expect(deps.reportEvaluation.evaluateReport).not.toHaveBeenCalled();
  });

  it("skips when depth=quick and audience not executive", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        depth: "quick",
        audienceProfile: "professional",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    expect(deps.reportEvaluation.evaluateReport).not.toHaveBeenCalled();
  });

  it("runs when depth=quick and audience=executive", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        depth: "quick",
        audienceProfile: "executive",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    expect(deps.reportEvaluation.evaluateReport).toHaveBeenCalled();
  });

  it("happy path: writes ctx.reportEvaluation and artifact.metadata.pipelineEvaluation", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    expect(ctx.reportEvaluation).toEqual(EVAL_RESULT);
    expect(ctx.reportArtifact!.metadata.pipelineEvaluation).toEqual(
      EVAL_RESULT,
    );
  });

  it("adds objective_evaluation warning to quality.warnings", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    const warning = ctx.reportArtifact!.quality.warnings.find(
      (w) => w.dimension === "objective_evaluation",
    );
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("82/100");
  });

  it("evaluateReport throws → logs warn and continues (non-fatal)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reportEvaluation.evaluateReport as jest.Mock).mockRejectedValue(
      new Error("eval error"),
    );
    await expect(
      runReportObjectiveEvaluationStage(ctx, deps),
    ).resolves.toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("Objective evaluation failed"),
    );
  });

  it("evaluateReport called with language=en for en-US input", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        language: "en-US",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    const callArg = (deps.reportEvaluation.evaluateReport as jest.Mock).mock
      .calls[0][0];
    expect(callArg.language).toBe("en");
  });

  it("filters sections with body < 200 chars", async () => {
    const art = makeReportArtifact();
    // Make first section very short
    art.sections[0].endOffset = art.sections[0].startOffset + 10;
    const ctx = makeCtx({
      reportArtifact: art as unknown as MissionContext["reportArtifact"],
    });
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    // Only the long second section should be included
    const callArg = (deps.reportEvaluation.evaluateReport as jest.Mock).mock
      .calls[0][0];
    expect(callArg.chapters.length).toBeLessThan(2);
  });

  it("topicType defaults to GENERIC if not in input", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    const callArg = (deps.reportEvaluation.evaluateReport as jest.Mock).mock
      .calls[0][0];
    expect(callArg.topicType).toBe("GENERIC");
  });

  it("writerModel uses modelTrail[0] from metadata", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    const callArg = (deps.reportEvaluation.evaluateReport as jest.Mock).mock
      .calls[0][0];
    expect(callArg.chapters[0].writerModel).toBe("gpt-4");
  });

  it("skips if all sections are too short → no evaluateReport call", async () => {
    const art = makeReportArtifact();
    art.sections[0].endOffset = art.sections[0].startOffset + 5;
    art.sections[1].endOffset = art.sections[1].startOffset + 5;
    const ctx = makeCtx({
      reportArtifact: art as unknown as MissionContext["reportArtifact"],
    });
    const deps = makeDeps();
    await runReportObjectiveEvaluationStage(ctx, deps);
    expect(deps.reportEvaluation.evaluateReport).not.toHaveBeenCalled();
  });
});

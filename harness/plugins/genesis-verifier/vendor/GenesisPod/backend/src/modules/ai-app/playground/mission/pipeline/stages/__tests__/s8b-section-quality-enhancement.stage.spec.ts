import { runSectionQualityEnhancementStage } from "../s8b-section-quality-enhancement.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

function makeSection(
  id: string,
  startOffset: number,
  endOffset: number,
  title: string,
) {
  return {
    id,
    type: "dimension" as const,
    level: 2,
    title,
    anchor: title.toLowerCase(),
    startOffset,
    endOffset,
    wordCount: 500,
    readingTimeMinutes: 2,
    citations: [],
    figureIds: [],
    factIds: [],
  };
}

const FULL_MD =
  "# Report\n\n## Market\n\n" +
  "Market analysis content ".repeat(20) +
  "\n\n## Technology\n\n" +
  "Technology content ".repeat(20);

const sec1Start = FULL_MD.indexOf("## Market\n\n");
const sec1End = FULL_MD.indexOf("## Technology\n\n");
const sec2Start = sec1End;
const sec2End = FULL_MD.length;

function makeReportArtifact(
  sections = [
    makeSection("s1", sec1Start, sec1End, "Market"),
    makeSection("s2", sec2Start, sec2End, "Technology"),
  ],
) {
  return {
    sections,
    content: {
      fullMarkdown: FULL_MD,
      fullReportSize: Buffer.byteLength(FULL_MD),
    },
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
    metadata: {},
    quickView: {},
    factTable: [],
  };
}

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m8b",
    userId: "u1",
    t0: Date.now(),
    budgetMultiplier: 1.0,
    input: {
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      auditLayers: "thorough",
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
    sectionSelfEval: {
      evaluateSection: jest.fn().mockResolvedValue({
        overallOk: false,
        weakAreas: ["analytical_depth"],
        scores: {
          analytical_depth: 5,
          evidence_coverage: 8,
          actionability: 7,
          writing_quality: 7,
        },
      }),
    },
    sectionRemediation: {
      remediate: jest.fn().mockResolvedValue({
        content: "Improved content " + "x".repeat(300),
        skipped: false,
        skipReason: undefined,
      }),
    },
    qualityTraceCompute: {
      recordDimensionRemediationLoop: jest.fn(),
    },
    // ★ PR-R4 (2026-05-07): MissionStore 注入，stage 主动持久化中间产物
    store: {
      markIntermediateState: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runSectionQualityEnhancementStage (S8B)", () => {
  it("skips if reportArtifact is undefined", async () => {
    const ctx = makeCtx({ reportArtifact: undefined });
    const deps = makeDeps();
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(deps.sectionSelfEval.evaluateSection).not.toHaveBeenCalled();
  });

  it("skips if sections is empty", async () => {
    const ctx = makeCtx({
      reportArtifact: makeReportArtifact(
        [],
      ) as unknown as MissionContext["reportArtifact"],
    });
    const deps = makeDeps();
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(deps.sectionSelfEval.evaluateSection).not.toHaveBeenCalled();
  });

  it("skips if auditLayers is minimal", async () => {
    const ctx = makeCtx({
      input: {
        ...makeCtx().input,
        auditLayers: "minimal",
      } as MissionContext["input"],
    });
    const deps = makeDeps();
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(deps.sectionSelfEval.evaluateSection).not.toHaveBeenCalled();
  });

  it("happy path: evaluates all sections and remediates weak ones", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(deps.sectionSelfEval.evaluateSection).toHaveBeenCalled();
    expect(deps.sectionRemediation.remediate).toHaveBeenCalled();
  });

  it("overallOk=true → skips remediation", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.sectionSelfEval.evaluateSection as jest.Mock).mockResolvedValue({
      overallOk: true,
      weakAreas: [],
      scores: {
        analytical_depth: 9,
        evidence_coverage: 9,
        actionability: 9,
        writing_quality: 9,
      },
    });
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(deps.sectionRemediation.remediate).not.toHaveBeenCalled();
  });

  it("remediation.skipped=true → no content replacement", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const originalMd = ctx.reportArtifact!.content.fullMarkdown;
    (deps.sectionRemediation.remediate as jest.Mock).mockResolvedValue({
      skipped: true,
      skipReason: "content too short",
      content: "",
    });
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(ctx.reportArtifact!.content.fullMarkdown).toBe(originalMd);
  });

  it("delta < -0.3 → remediation rejected, original content kept", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.sectionSelfEval.evaluateSection as jest.Mock)
      .mockResolvedValueOnce({
        overallOk: false,
        weakAreas: ["analytical_depth"],
        scores: {
          analytical_depth: 8,
          evidence_coverage: 8,
          actionability: 8,
          writing_quality: 8,
        },
      })
      .mockResolvedValue({
        overallOk: false,
        weakAreas: ["analytical_depth"],
        scores: {
          analytical_depth: 3,
          evidence_coverage: 3,
          actionability: 3,
          writing_quality: 3,
        },
      });
    const _originalMd = ctx.reportArtifact!.content.fullMarkdown;
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("remediation regressed"),
    );
  });

  it("delta >= -0.3 → content replaced in fullMarkdown", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.sectionSelfEval.evaluateSection as jest.Mock)
      .mockResolvedValueOnce({
        overallOk: false,
        weakAreas: ["analytical_depth"],
        scores: {
          analytical_depth: 5,
          evidence_coverage: 7,
          actionability: 7,
          writing_quality: 7,
        },
      })
      .mockResolvedValue({
        overallOk: true,
        weakAreas: [],
        scores: {
          analytical_depth: 8,
          evidence_coverage: 8,
          actionability: 8,
          writing_quality: 8,
        },
      });
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(ctx.reportArtifact!.content.fullMarkdown).toContain(
      "Improved content",
    );
    expect(ctx.reportArtifact!.content.fullMarkdown).toContain("## Market");
    expect(ctx.reportArtifact!.sections[0].startOffset).toBeGreaterThanOrEqual(
      0,
    );
  });

  it("remediation that drops the heading is normalized back to canonical H2", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.sectionSelfEval.evaluateSection as jest.Mock)
      .mockResolvedValueOnce({
        overallOk: false,
        weakAreas: ["analytical_depth"],
        scores: {
          analytical_depth: 5,
          evidence_coverage: 7,
          actionability: 7,
          writing_quality: 7,
        },
      })
      .mockResolvedValue({
        overallOk: true,
        weakAreas: [],
        scores: {
          analytical_depth: 8,
          evidence_coverage: 8,
          actionability: 8,
          writing_quality: 8,
        },
      });
    (deps.sectionRemediation.remediate as jest.Mock).mockResolvedValue({
      content: "补救正文".repeat(120),
      skipped: false,
      skipReason: undefined,
    });

    await runSectionQualityEnhancementStage(ctx, deps);

    expect(ctx.reportArtifact!.content.fullMarkdown).toContain(
      "## Technology\n\n补救正文",
    );
    expect(ctx.reportArtifact!.sections[1].startOffset).toBeGreaterThanOrEqual(
      0,
    );
    expect(ctx.reportArtifact!.sections[1].wordCount).toBeGreaterThan(0);
  });

  it("remediation that rewrites the heading is canonicalized to the original title", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.sectionSelfEval.evaluateSection as jest.Mock)
      .mockResolvedValueOnce({
        overallOk: false,
        weakAreas: ["analytical_depth"],
        scores: {
          analytical_depth: 5,
          evidence_coverage: 7,
          actionability: 7,
          writing_quality: 7,
        },
      })
      .mockResolvedValue({
        overallOk: true,
        weakAreas: [],
        scores: {
          analytical_depth: 8,
          evidence_coverage: 8,
          actionability: 8,
          writing_quality: 8,
        },
      });
    (deps.sectionRemediation.remediate as jest.Mock).mockResolvedValue({
      content: `## Renamed Market\n\n${"更新内容".repeat(120)}`,
      skipped: false,
      skipReason: undefined,
    });

    await runSectionQualityEnhancementStage(ctx, deps);

    expect(ctx.reportArtifact!.content.fullMarkdown).toContain(
      "## Technology\n\n更新内容",
    );
    expect(ctx.reportArtifact!.content.fullMarkdown).not.toContain(
      "## Renamed Market",
    );
  });

  it("section self-eval throws → single section failure is non-fatal", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.sectionSelfEval.evaluateSection as jest.Mock).mockRejectedValue(
      new Error("eval error"),
    );
    await expect(
      runSectionQualityEnhancementStage(ctx, deps),
    ).resolves.toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("enhancement failed"),
    );
  });

  it("qualityTraceCtx available → recordDimensionRemediationLoop called", async () => {
    const ctx = makeCtx();
    ctx.qualityTraceCtx = {} as MissionContext["qualityTraceCtx"];
    const deps = makeDeps();
    (deps.sectionSelfEval.evaluateSection as jest.Mock)
      .mockResolvedValueOnce({
        overallOk: false,
        weakAreas: ["analytical_depth"],
        scores: {
          analytical_depth: 5,
          evidence_coverage: 7,
          actionability: 7,
          writing_quality: 7,
        },
      })
      .mockResolvedValue({
        overallOk: true,
        weakAreas: [],
        scores: {
          analytical_depth: 8,
          evidence_coverage: 8,
          actionability: 8,
          writing_quality: 8,
        },
      });
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(
      deps.qualityTraceCompute.recordDimensionRemediationLoop,
    ).toHaveBeenCalled();
  });

  it("fullReportSize updated after remediation", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.sectionSelfEval.evaluateSection as jest.Mock)
      .mockResolvedValueOnce({
        overallOk: false,
        weakAreas: ["analytical_depth"],
        scores: {
          analytical_depth: 5,
          evidence_coverage: 7,
          actionability: 7,
          writing_quality: 7,
        },
      })
      .mockResolvedValue({
        overallOk: true,
        weakAreas: [],
        scores: {
          analytical_depth: 9,
          evidence_coverage: 9,
          actionability: 9,
          writing_quality: 9,
        },
      });
    await runSectionQualityEnhancementStage(ctx, deps);
    // fullReportSize should be updated after remediation
    expect(ctx.reportArtifact!.content.fullReportSize).toBeGreaterThan(0);
  });

  it("sections below 200 chars are skipped", async () => {
    const shortSection = {
      ...makeSection("sshort", 0, 50, "Short"),
      startOffset: 0,
      endOffset: 10,
    };
    const art = makeReportArtifact([shortSection]);
    const ctx = makeCtx({
      reportArtifact: art as unknown as MissionContext["reportArtifact"],
    });
    const deps = makeDeps();
    await runSectionQualityEnhancementStage(ctx, deps);
    expect(deps.sectionSelfEval.evaluateSection).not.toHaveBeenCalled();
  });

  // ★ PR-R4 (2026-05-07): stage 主动持久化反向证据
  describe("PR-R4 markIntermediateState", () => {
    it("有 remediation 时持久化 reportArtifact + version=2 + userId 严格隔离", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      // 默认 mock 让两个 section 都弱 → 触发 remediate → 写回 fullMarkdown → markIntermediateState
      await runSectionQualityEnhancementStage(ctx, deps);
      const calls = (deps.store.markIntermediateState as jest.Mock).mock.calls;
      // ★ 收尾评审 P0-R3 (2026-05-07): 改条件断言为硬断言，防"删实现也通过"
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0][1]).toMatchObject({
        reportFull: expect.any(Object),
        reportArtifactVersion: 2,
      });
      // ★ 收尾评审第三轮 P0-S: 必传 userId 走严格隔离
      expect(calls[0][2]).toBe("u1");
    });

    it("零 remediation 时不持久化（避免空写）", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      (deps.sectionSelfEval.evaluateSection as jest.Mock).mockResolvedValue({
        overallOk: true,
        weakAreas: [],
        scores: {
          analytical_depth: 9,
          evidence_coverage: 9,
          actionability: 9,
          writing_quality: 9,
        },
      });
      await runSectionQualityEnhancementStage(ctx, deps);
      expect(deps.store.markIntermediateState).not.toHaveBeenCalled();
    });
  });
});

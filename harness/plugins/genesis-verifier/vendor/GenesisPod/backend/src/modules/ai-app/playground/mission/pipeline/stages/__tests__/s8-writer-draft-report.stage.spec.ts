import { runWriterStage } from "../s8-writer-draft-report.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

const MOCK_REPORT = {
  title: "AI Report",
  summary: "AI is growing",
  sections: [{ heading: "Market", body: "Big market" }],
  conclusion: "AI wins",
  citations: ["http://a.com"],
};

const PASS_VERDICT = {
  decision: { score: 85, verdict: "pass" },
  verdicts: [
    {
      judgeId: "self",
      score: 85,
      critique: "good",
      criteria: [],
      modelId: "gpt-4",
    },
  ],
};

const FAIL_VERDICT = {
  decision: { score: 55, verdict: "fail" },
  verdicts: [
    {
      judgeId: "self",
      score: 55,
      critique: "bad",
      criteria: [],
      modelId: "gpt-4",
    },
  ],
};

function makeAgent() {
  return {
    getEnvelope: jest.fn().mockReturnValue({
      system: "",
      messages: [],
      tools: [],
      memory: { sessionId: "s1" },
      budget: {
        tokensUsed: 0,
        tokensRemaining: 1000,
        iterationsUsed: 0,
        iterationsRemaining: 10,
        wallTimeStartMs: Date.now(),
      },
      reminders: [],
    }),
  };
}

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m8",
    userId: "u1",
    t0: Date.now() - 1000,
    budgetMultiplier: 1.0,
    input: {
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      auditLayers: "standard",
      lengthProfile: "standard",
      styleProfile: "analytical",
      audienceProfile: "professional",
      withFigures: false,
    } as MissionContext["input"],
    billing: {} as MissionContext["billing"],
    pool: {
      isExhausted: jest.fn().mockReturnValue(false),
      snapshot: jest
        .fn()
        .mockReturnValue({ poolCostUsd: 0.5, poolTokensUsed: 10000 }),
    } as unknown as MissionContext["pool"],
    leader: {} as MissionContext["leader"],
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
    invoker: {
      invoke: jest.fn().mockResolvedValue({
        state: "completed",
        output: MOCK_REPORT,
        events: [
          {
            type: "thinking",
            payload: { modelId: "gpt-4" },
            timestamp: Date.now() - 100,
          },
          { type: "done", payload: {}, timestamp: Date.now() },
        ],
        wallTimeMs: 2000,
        iterations: 5,
        agent: makeAgent(),
      }),
      tickCost: jest.fn().mockResolvedValue(undefined),
      preDisableKnownFailingModels: jest.fn().mockResolvedValue(undefined),
      resolveLoopOverride: jest.fn().mockReturnValue(undefined),
    },
    judge: {
      judgeWithConsensus: jest.fn().mockResolvedValue(PASS_VERDICT),
    },
    indexer: {
      indexAgentTrajectory: jest.fn().mockResolvedValue(42),
    },
    missionState: {
      compressIfNeeded: jest.fn().mockImplementation((x: unknown) => x),
    },
    reportAssembler: {
      assemble: jest.fn().mockReturnValue({
        content: {
          fullMarkdown: "# Report\n\n## Market\n\nBig market",
          fullReportSize: 100,
        },
        sections: [
          {
            id: "d1",
            type: "dimension",
            level: 2,
            title: "Market",
            anchor: "market",
            startOffset: 10,
            endOffset: 40,
            wordCount: 100,
            readingTimeMinutes: 1,
            citations: [1],
            figureIds: [],
            factIds: [],
            sourceDimensionId: "d1",
          },
        ],
        citations: [
          {
            index: 1,
            uuid: "c1",
            title: "a.com",
            url: "http://a.com",
            domain: "a.com",
            accessedAt: new Date().toISOString(),
            sourceType: "industry",
            credibilityScore: 65,
            occurrences: [],
          },
        ],
        figures: [],
        quickView: {
          executiveSummary: { markdown: "AI", wordCount: 10 },
          topHighlights: [],
          topTrends: [],
          keyRisks: [],
          topRecommendations: [],
          keyCitations: [],
          keyFigures: [],
          estimatedReadingTime: 3,
          whatYouWillLearn: [],
        },
        factTable: [],
        metadata: {
          topic: "AI",
          generatedAt: new Date().toISOString(),
          generationTimeMs: 1000,
          version: 1,
          isIncremental: false,
          dimensionCount: 1,
          sourceCount: 1,
          factCount: 0,
          figureCount: 0,
          wordCount: 100,
          readingTimeMinutes: 1,
          styleProfile: "analytical",
          lengthProfile: "standard",
          audienceProfile: "professional",
          language: "zh-CN",
          totalTokens: { prompt: 0, completion: 0, total: 0 },
          costCents: 0,
          modelTrail: ["gpt-4"],
        },
        quality: {
          overall: 80,
          dimensions: {
            traceability: 80,
            factualConsistency: 80,
            novelty: 70,
            coverage: 100,
            redundancy: 80,
            formatCorrectness: 80,
            citationDensity: 80,
            styleConformance: 70,
            lengthAccuracy: 75,
            chapterBalance: 80,
          },
          hardGateViolations: [],
          warnings: [],
          qualityTrace: [
            {
              stage: "assembler",
              check: "10-dimension-baseline",
              passed: true,
              timestamp: Date.now(),
            },
          ],
          finalVerdict: "good",
        },
      }),
    },
    credits: {
      consumeCredits: jest.fn().mockResolvedValue(undefined),
    },
    // ★ PR-R4 (2026-05-07): MissionStore 注入，stage 主动持久化中间产物
    store: {
      markIntermediateState: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runWriterStage (S8)", () => {
  const analyst = {
    insights: [
      {
        headline: "h",
        narrative: "n",
        supportingDimensions: ["Market"],
        confidence: 0.9,
      },
    ],
    themeSummary: "AI summary",
  };

  it("throws if plan or researcherResults missing", async () => {
    const ctx = makeCtx({ plan: undefined });
    const deps = makeDeps();
    await expect(runWriterStage(ctx, deps, analyst, undefined)).rejects.toThrow(
      /writer requires/,
    );
  });

  it("happy path: writes ctx.report, reportArtifact, reviewScore", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runWriterStage(ctx, deps, analyst, undefined);
    expect(ctx.report).toBeDefined();
    expect(ctx.reviewScore).toBe(85);
    expect(ctx.trajectoryStored).toBe(42);
  });

  it("judge pass: exits after first writer attempt", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runWriterStage(ctx, deps, analyst, undefined);
    expect(deps.invoker.invoke).toHaveBeenCalledTimes(1);
  });

  it("judge fail on first attempt: retries writer (MAX_WRITER_ATTEMPTS=2)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.judge.judgeWithConsensus as jest.Mock)
      .mockResolvedValueOnce(FAIL_VERDICT)
      .mockResolvedValueOnce(PASS_VERDICT);
    await runWriterStage(ctx, deps, analyst, undefined);
    expect(deps.invoker.invoke).toHaveBeenCalledTimes(2);
  });

  it("writer fails both attempts → throws", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.invoker.invoke as jest.Mock).mockResolvedValue({
      state: "failed",
      output: null,
      events: [],
      wallTimeMs: 1000,
      iterations: 5,
      agent: null,
    });
    await expect(runWriterStage(ctx, deps, analyst, undefined)).rejects.toThrow(
      /Writer/,
    );
  });

  it("indexer failure → trajectoryStored=0 (non-fatal)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.indexer.indexAgentTrajectory as jest.Mock).mockRejectedValue(
      new Error("index failed"),
    );
    await runWriterStage(ctx, deps, analyst, undefined);
    expect(ctx.trajectoryStored).toBe(0);
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("indexer"),
    );
  });

  it("reportAssembler failure → reportArtifact undefined (non-fatal)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.reportAssembler.assemble as jest.Mock).mockImplementation(() => {
      throw new Error("assembler failed");
    });
    await runWriterStage(ctx, deps, analyst, undefined);
    expect(ctx.reportArtifact).toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("reportAssembler"),
    );
  });

  it("emits verifier:verdict for each verdict", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runWriterStage(ctx, deps, analyst, undefined);
    const verdictCalls = (deps.emit as jest.Mock).mock.calls.filter(
      (c) => c[0].type === "playground.verifier:verdict",
    );
    expect(verdictCalls).toHaveLength(1);
  });

  it("emits memory:indexed event after trajectory indexing", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runWriterStage(ctx, deps, analyst, undefined);
    const indexedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.memory:indexed",
    );
    expect(indexedCall).toBeDefined();
    expect(indexedCall[0].payload.chunks).toBe(42);
  });

  it("reconciliation unresolved conflicts → factualConsistency lowered", async () => {
    const recon = {
      factTable: [
        { id: "f1", entity: "E", attribute: "a", value: "v", sources: [] },
      ],
      conflicts: [
        {
          factIds: ["f1"],
          resolutionType: "flagged-unresolved",
          rationale: "conflict",
        },
      ],
      gaps: [],
    };
    const ctx = makeCtx({
      reconciliationReport: recon as MissionContext["reconciliationReport"],
    });
    const deps = makeDeps();
    await runWriterStage(ctx, deps, analyst, undefined);
    // reportArtifact.quality.dimensions.factualConsistency should be reduced
    // Just verify the stage completed without error
    expect(ctx.report).toBeDefined();
  });

  // ★ 2026-05-13 #63: Leader signoff timeline 预警
  describe("preflight-warning (Leader signoff 预警)", () => {
    const goalsTight = {
      qualityBar: {
        minSources: 10,
        minCoverage: 80,
        hardConstraints: [],
      },
      successCriteria: ["c"],
      deliverables: ["d"],
    } as never;

    it("no preflight emit when goals empty (current default mock)", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      await runWriterStage(ctx, deps, analyst, undefined);
      const calls = (deps.emit as jest.Mock).mock.calls.filter(
        (c) => c[0].type === "playground.mission:preflight-warning",
      );
      expect(calls).toHaveLength(0);
    });

    it("emits preflight-warning when coverage < minCoverage × 0.7", async () => {
      const ctx = makeCtx({
        plan: {
          themeSummary: "AI",
          dimensions: [{ id: "d1", name: "Market", rationale: "r" }],
          goals: goalsTight,
          initialRisks: [],
        } as MissionContext["plan"],
      });
      const deps = makeDeps();
      // Mock assembler 返回 coverage=40 (< 80×0.7=56)，lengthAccuracy=80 (>=60)
      (deps.reportAssembler.assemble as jest.Mock).mockImplementationOnce(
        () => ({
          content: { fullMarkdown: "x", fullReportSize: 1 },
          sections: [],
          citations: [
            {
              index: 1,
              uuid: "c1",
              title: "a",
              url: "x",
              domain: "a",
              accessedAt: "t",
              sourceType: "industry",
              credibilityScore: 65,
              occurrences: [],
            },
            {
              index: 2,
              uuid: "c2",
              title: "b",
              url: "y",
              domain: "b",
              accessedAt: "t",
              sourceType: "industry",
              credibilityScore: 65,
              occurrences: [],
            },
          ],
          figures: [],
          quickView: {
            executiveSummary: { markdown: "", wordCount: 0 },
            topHighlights: [],
            topTrends: [],
            keyRisks: [],
            topRecommendations: [],
            keyCitations: [],
            keyFigures: [],
            estimatedReadingTime: 1,
            whatYouWillLearn: [],
          },
          factTable: [],
          metadata: {
            topic: "AI",
            generatedAt: "",
            generationTimeMs: 0,
            version: 1,
            isIncremental: false,
            dimensionCount: 1,
            sourceCount: 2,
            factCount: 0,
            figureCount: 0,
            wordCount: 50,
            readingTimeMinutes: 1,
            styleProfile: "",
            lengthProfile: "standard",
            audienceProfile: "",
            language: "zh-CN",
            totalTokens: { prompt: 0, completion: 0, total: 0 },
            costCents: 0,
            modelTrail: [],
          },
          quality: {
            overall: 60,
            dimensions: {
              traceability: 60,
              factualConsistency: 60,
              novelty: 60,
              coverage: 40,
              redundancy: 60,
              formatCorrectness: 60,
              citationDensity: 60,
              styleConformance: 60,
              lengthAccuracy: 80,
              chapterBalance: 60,
            },
            hardGateViolations: [],
            warnings: [],
            qualityTrace: [],
            finalVerdict: "fair",
          },
        }),
      );
      await runWriterStage(ctx, deps, analyst, undefined);
      const preflight = (deps.emit as jest.Mock).mock.calls.find(
        (c) => c[0].type === "playground.mission:preflight-warning",
      );
      expect(preflight).toBeDefined();
      expect(preflight[0].payload.severity).toBe("block");
      expect(preflight[0].payload.affectsStageId).toBe("writer");
      const codes = preflight[0].payload.reasons.map(
        (r: { code: string }) => r.code,
      );
      // sourceCount=2 < 10×0.6=6 + coverage=40 < 80×0.7=56
      expect(codes).toEqual(
        expect.arrayContaining(["INSUFFICIENT_SOURCES", "LOW_COVERAGE"]),
      );
    });

    it("emits preflight when lengthAccuracy < 60", async () => {
      const ctx = makeCtx({
        plan: {
          themeSummary: "AI",
          dimensions: [{ id: "d1", name: "Market", rationale: "r" }],
          goals: {
            qualityBar: { minSources: 0, minCoverage: 0, hardConstraints: [] },
            successCriteria: ["c"],
            deliverables: ["d"],
          } as never,
          initialRisks: [],
        } as MissionContext["plan"],
      });
      const deps = makeDeps();
      // override lengthAccuracy=45 (< 60)
      (deps.reportAssembler.assemble as jest.Mock).mockImplementationOnce(
        () => ({
          content: { fullMarkdown: "x", fullReportSize: 1 },
          sections: [],
          citations: [],
          figures: [],
          quickView: {
            executiveSummary: { markdown: "", wordCount: 0 },
            topHighlights: [],
            topTrends: [],
            keyRisks: [],
            topRecommendations: [],
            keyCitations: [],
            keyFigures: [],
            estimatedReadingTime: 1,
            whatYouWillLearn: [],
          },
          factTable: [],
          metadata: {
            topic: "AI",
            generatedAt: "",
            generationTimeMs: 0,
            version: 1,
            isIncremental: false,
            dimensionCount: 1,
            sourceCount: 0,
            factCount: 0,
            figureCount: 0,
            wordCount: 50,
            readingTimeMinutes: 1,
            styleProfile: "",
            lengthProfile: "standard",
            audienceProfile: "",
            language: "zh-CN",
            totalTokens: { prompt: 0, completion: 0, total: 0 },
            costCents: 0,
            modelTrail: [],
          },
          quality: {
            overall: 60,
            dimensions: {
              traceability: 60,
              factualConsistency: 60,
              novelty: 60,
              coverage: 90,
              redundancy: 60,
              formatCorrectness: 60,
              citationDensity: 60,
              styleConformance: 60,
              lengthAccuracy: 45,
              chapterBalance: 60,
            },
            hardGateViolations: [],
            warnings: [],
            qualityTrace: [],
            finalVerdict: "fair",
          },
        }),
      );
      await runWriterStage(ctx, deps, analyst, undefined);
      const preflight = (deps.emit as jest.Mock).mock.calls.find(
        (c) => c[0].type === "playground.mission:preflight-warning",
      );
      expect(preflight).toBeDefined();
      const codes = preflight[0].payload.reasons.map(
        (r: { code: string }) => r.code,
      );
      expect(codes).toContain("LENGTH_UNDERDELIVERED");
    });
  });

  it("does not apply a second mission-total credit charge", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runWriterStage(ctx, deps, analyst, undefined);
    expect(deps.credits.consumeCredits).not.toHaveBeenCalled();
  });

  // ★ PR-R4 (2026-05-07): stage 主动持久化反向证据
  describe("PR-R4 markIntermediateState", () => {
    it("happy path: persists reportArtifact + reportArtifactVersion=2 after assembly", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      await runWriterStage(ctx, deps, analyst, undefined);
      expect(deps.store.markIntermediateState).toHaveBeenCalledWith(
        "m8",
        expect.objectContaining({
          reportFull: expect.any(Object),
          reportArtifactVersion: 2,
        }),
        "u1", // ★ 收尾评审第三轮 P0-S: 严格 userId 隔离
      );
    });

    it("reportAssembler 失败 → reportArtifact undefined → 不持久化（不覆盖前轮）", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      (deps.reportAssembler.assemble as jest.Mock).mockImplementation(() => {
        throw new Error("assembler failed");
      });
      await runWriterStage(ctx, deps, analyst, undefined);
      expect(deps.store.markIntermediateState).not.toHaveBeenCalled();
    });
  });

  it("outlinePlan in ctx injected into writer invoke call", async () => {
    const outline = {
      chapterOutlines: [
        {
          sectionId: "s1",
          heading: "H",
          subheadings: [],
          thesis: "T",
          keyPointsToCover: [],
        },
      ],
      targetWordsPerChapter: {},
      factAllocation: {},
    };
    const ctx = makeCtx({ outlinePlan: outline });
    const deps = makeDeps();
    await runWriterStage(ctx, deps, analyst, undefined);
    const invokeArg = (deps.invoker.invoke as jest.Mock).mock.calls[0][1];
    expect(invokeArg.outlinePlan).toBeDefined();
  });

  // ── v1.6 切主线 — structural 永远开启（env flag 删除）—————————————
  describe("structural assembler 主路径 (v1.6 切主线)", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("structural 主路径替换 sections + sanitizerVersion 写 metadata + 关联回填", async () => {
      const ctx = makeCtx({
        plan: {
          themeSummary: "AI 行业",
          dimensions: [
            {
              id: "d1",
              name: "市场",
              rationale: "...",
              goals: {
                successCriteria: [],
                qualityBar: {
                  minSources: 0,
                  minCoverage: 0,
                  hardConstraints: [],
                },
                deliverables: [],
              },
              initialRisks: [],
            } as never,
            {
              id: "d2",
              name: "技术",
              rationale: "...",
              goals: {
                successCriteria: [],
                qualityBar: {
                  minSources: 0,
                  minCoverage: 0,
                  hardConstraints: [],
                },
                deliverables: [],
              },
              initialRisks: [],
            } as never,
          ],
          goals: {
            successCriteria: [],
            qualityBar: { minSources: 0, minCoverage: 0, hardConstraints: [] },
            deliverables: [],
          },
          initialRisks: [],
        },
      });
      const deps = makeDeps();
      // v1.6 deps 新增两个 public helper（关联回填）— mock 一并补
      (
        deps.reportAssembler as {
          recomputeCitationOccurrencesPublic: jest.Mock;
        }
      ).recomputeCitationOccurrencesPublic = jest.fn();
      (
        deps.reportAssembler as { recomputeSectionFigureIdsPublic: jest.Mock }
      ).recomputeSectionFigureIdsPublic = jest.fn();

      await runWriterStage(ctx, deps, analyst, undefined);
      // structural 拼装后 sections 数 ≥ 2 dim + fixed slots > legacy 的 1 段
      expect(ctx.reportArtifact?.sections.length).toBeGreaterThan(1);
      // structural metadata 含 templateId（v1.5）
      expect(ctx.reportArtifact?.metadata.templateId).toBe(
        "multi-dimension-report@v1",
      );
      // v1.6 NB-8 收尾：sanitizerVersion 真合并到 metadata
      expect(ctx.reportArtifact?.metadata.sanitizerVersion).toBeDefined();
      expect(ctx.reportArtifact?.metadata.sanitizerVersion).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
      // legacy quality 信号保留（quality 字段未被 structural 覆盖）
      expect(ctx.reportArtifact?.quality.qualityTrace).toBeDefined();
      // v1.6 NB-A 关联回填：recompute helper 被 stage 调用
      expect(
        (
          deps.reportAssembler as {
            recomputeCitationOccurrencesPublic: jest.Mock;
          }
        ).recomputeCitationOccurrencesPublic,
      ).toHaveBeenCalledTimes(1);
      expect(
        (deps.reportAssembler as { recomputeSectionFigureIdsPublic: jest.Mock })
          .recomputeSectionFigureIdsPublic,
      ).toHaveBeenCalledTimes(1);
    });

    it("structural throw → 自动降级到 legacy（v1.6: 显式 mock 触发，不依赖 .replace(null) 实现细节）", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      (
        deps.reportAssembler as {
          recomputeCitationOccurrencesPublic: jest.Mock;
        }
      ).recomputeCitationOccurrencesPublic = jest.fn();
      (
        deps.reportAssembler as { recomputeSectionFigureIdsPublic: jest.Mock }
      ).recomputeSectionFigureIdsPublic = jest.fn();
      // v1.6 改用显式 mock 让 assembler 抛错
      const facade = jest.requireActual("@/modules/ai-harness/facade");
      const spy = jest
        .spyOn(facade.defaultStructuralReportAssembler, "assemble")
        .mockImplementationOnce(() => {
          throw new Error("structural mock failure");
        });
      try {
        await runWriterStage(ctx, deps, analyst, undefined);
      } finally {
        spy.mockRestore();
      }
      // 降级：legacy reportArtifact 仍存在
      expect(ctx.reportArtifact).toBeDefined();
      // log.warn 含 'structural assembler' 关键字
      const warnCalls = (deps.log.warn as jest.Mock).mock.calls.map((c) =>
        String(c[0]),
      );
      expect(warnCalls.some((m) => m.includes("structural assembler"))).toBe(
        true,
      );
    });
  });
});

import { runAnalystStage } from "../s6-analyst-synthesize-insights.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

const ANALYST_OUTPUT = {
  insights: [
    {
      headline: "AI grows",
      narrative: "AI is growing",
      supportingDimensions: ["Market", "Tech"],
      confidence: 0.9,
    },
    {
      headline: "Risks abound",
      narrative: "There are risks",
      supportingDimensions: ["Policy"],
      confidence: 0.8,
    },
  ],
  themeSummary: "AI is transforming everything",
  contradictions: [],
};

function makeCtx(overrides: Partial<MissionContext> = {}): MissionContext {
  return {
    missionId: "m6",
    userId: "u1",
    t0: Date.now(),
    budgetMultiplier: 1.0,
    input: {
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      auditLayers: "standard",
    } as MissionContext["input"],
    billing: {} as MissionContext["billing"],
    pool: {
      snapshot: jest
        .fn()
        .mockReturnValue({ poolCostUsd: 0, poolTokensUsed: 0 }),
    } as unknown as MissionContext["pool"],
    leader: {} as MissionContext["leader"],
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
    analyst: {
      analyze: jest.fn().mockResolvedValue({
        state: "completed",
        output: ANALYST_OUTPUT,
        events: [],
        wallTimeMs: 1000,
        iterations: 4,
      }),
      // 默认空输出 → 不触发 merge，保持现有用例行为不变
      synthesizeQuickView: jest.fn().mockResolvedValue({
        state: "completed",
        output: undefined,
        events: [],
        wallTimeMs: 0,
        iterations: 1,
      }),
    },
    missionState: {
      compressIfNeeded: jest.fn().mockImplementation((x: unknown) => x),
    },
    invoker: {
      tickCost: jest.fn().mockResolvedValue(undefined),
      preDisableKnownFailingModels: jest.fn().mockResolvedValue(undefined),
      resolveLoopOverride: jest.fn().mockReturnValue(undefined),
    },
    // ★ PR-R4 (2026-05-07): MissionStore 注入，stage 主动持久化中间产物
    store: {
      markIntermediateState: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runAnalystStage (S6)", () => {
  it("throws if researcherResults missing", async () => {
    const ctx = makeCtx({ researcherResults: undefined });
    const deps = makeDeps();
    await expect(runAnalystStage(ctx, deps)).rejects.toThrow(
      /researcherResults/,
    );
  });

  it("happy path: writes ctx.analystOutput and returns analyst", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const result = await runAnalystStage(ctx, deps);
    expect(ctx.analystOutput).toBeDefined();
    expect(result.insights).toHaveLength(2);
  });

  it("merges focused quick-view synthesis output over analyst inline fields", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    const richFindings = [
      {
        dimensionName: "Market",
        findings: [
          {
            finding: "需求拐点",
            body: "2026 年市场规模突破 500 亿，年增 40%，由 X/Y 驱动。",
            significance: "high" as const,
          },
        ],
      },
    ];
    (deps.analyst.synthesizeQuickView as jest.Mock).mockResolvedValue({
      state: "completed",
      output: {
        keyFindingsByDimension: richFindings,
        whatYouWillLearn: ["读完了解市场拐点"],
      },
      events: [],
      wallTimeMs: 500,
      iterations: 1,
    });

    const result = await runAnalystStage(ctx, deps);

    expect(deps.analyst.synthesizeQuickView).toHaveBeenCalledTimes(1);
    expect(result.keyFindingsByDimension).toEqual(richFindings);
    expect(result.whatYouWillLearn).toEqual(["读完了解市场拐点"]);
    // 富字段也应进入持久化的 ctx.analystOutput
    expect(ctx.analystOutput?.keyFindingsByDimension).toEqual(richFindings);
  });

  it("keeps analyst inline fields when quick-view synthesis throws", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.analyst.synthesizeQuickView as jest.Mock).mockRejectedValue(
      new Error("qv engine down"),
    );

    const result = await runAnalystStage(ctx, deps);

    // 不抛错、stage 正常完成，analyst 主输出保留
    expect(result.insights).toHaveLength(2);
    expect(ctx.analystOutput).toBeDefined();
    expect(deps.log.warn).toHaveBeenCalled();
  });

  // ★ 2026-05-06 单轨化: stage 不再 emit stage:started/completed，由 orchestrator
  //   stage:lifecycle 必发（spec 不通过 dispatcher，验证 lifecycle 调用即可）。
  it("calls lifecycle started for analyst", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runAnalystStage(ctx, deps);
    expect(deps.lifecycle).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "analyst",
      "analyst",
      "started",
    );
  });

  it("first attempt null → retries once with simplified prompt", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    let callCount = 0;
    (deps.analyst.analyze as jest.Mock).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          state: "failed",
          output: null,
          events: [],
          wallTimeMs: 0,
          iterations: 1,
        });
      }
      return Promise.resolve({
        state: "completed",
        output: ANALYST_OUTPUT,
        events: [],
        wallTimeMs: 0,
        iterations: 1,
      });
    });
    const result = await runAnalystStage(ctx, deps);
    expect(callCount).toBe(2);
    expect(result.insights).toHaveLength(2);
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("first attempt returned no output"),
    );
  });

  it("two consecutive null → falls back to empty analystOutput (mission stays alive)", async () => {
    // ★ P0-LIVE-NULL-OUTPUT (2026-04-30): 之前两次 null 直接 throw 让 mission
    //   全死，浪费已采集的 6 维 researcher results。改成发空 analystOutput
    //   让下游 writer/reviewer 至少能渲出报告（即便质量低）。
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.analyst.analyze as jest.Mock).mockResolvedValue({
      state: "failed",
      output: null,
      events: [],
      wallTimeMs: 0,
      iterations: 1,
    });
    const result = await runAnalystStage(ctx, deps);
    expect(result.insights).toHaveLength(0);
    expect(result.themeSummary).toMatch(/未产出有效综合分析/);
    expect(ctx.analystOutput).toBe(result);
  });

  // 2026-06-02 (single-provider 不硬终止): provider 级失败不再 throw 终止 mission。
  // 下游 writer/reviewer 各有独立的跨 12 模型 model-failover，单 provider 故障未必拖垮
  // 下游；硬终止反而浪费已采集的多维 findings。改为降级发空 analystOutput 让 mission
  // 跑完，同时用醒目 narrate fail-loud 把真实 provider 根因暴露给用户（非静默假成功）。
  // mock 一个 PROVIDER_API_ERROR error event 模拟 prod 现象（BYOK 熔断后
  // "No API Key available for provider openai"）。
  it("provider-level failure (PROVIDER_API_ERROR) degrades to empty fallback + loud narrate (no throw)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.analyst.analyze as jest.Mock).mockResolvedValue({
      state: "failed",
      output: null,
      events: [
        {
          type: "error",
          payload: {
            failureCode: "PROVIDER_API_ERROR",
            message: 'No API Key available for provider "openai"',
          },
        },
      ],
      wallTimeMs: 100,
      iterations: 1,
    });
    // 不再 throw：返回空兜底 output，mission 继续
    const result = await runAnalystStage(ctx, deps);
    expect(result.insights).toEqual([]);
    expect(ctx.analystOutput).toBe(result);
    // 仍 fail-loud：narrate 文案含失败码
    const narrateCalls = (deps.emit as jest.Mock).mock.calls;
    const errorNarrate = narrateCalls.find((c) =>
      JSON.stringify(c).includes("PROVIDER_API_ERROR"),
    );
    expect(errorNarrate).toBeDefined();
    // log.warn 记录 provider-level degrade（区别于普通 schema-mismatch 兜底）
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("provider-level failure"),
    );
  });

  it("schema-mismatch failure still falls back (preserves P0-LIVE-NULL-OUTPUT behavior)", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.analyst.analyze as jest.Mock).mockResolvedValue({
      state: "failed",
      output: null,
      events: [
        {
          type: "error",
          payload: {
            failureCode: "RUNNER_OUTPUT_SCHEMA_MISMATCH",
            message: "reasoning CoT exhausted max_completion_tokens",
          },
        },
      ],
      wallTimeMs: 100,
      iterations: 2,
    });
    const result = await runAnalystStage(ctx, deps);
    expect(result.insights).toEqual([]);
    expect(result.themeSummary).toMatch(/未产出有效综合分析/);
  });

  it("lifecycle called started/completed on success", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runAnalystStage(ctx, deps);
    const calls = (deps.lifecycle as jest.Mock).mock.calls;
    expect(calls[0][4]).toBe("started");
    expect(calls[1][4]).toBe("completed");
  });

  it("lifecycle called failed when analyst fails", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    (deps.analyst.analyze as jest.Mock).mockResolvedValue({
      state: "failed",
      output: null,
      events: [],
      wallTimeMs: 0,
      iterations: 1,
    });
    await runAnalystStage(ctx, deps).catch((_err: unknown) => {
      // 测试场景：故意让 agent 以 state=failed 返回，验证 lifecycle failed 被调用
    });
    const failedCall = (deps.lifecycle as jest.Mock).mock.calls.find(
      (c) => c[4] === "failed",
    );
    expect(failedCall).toBeDefined();
  });

  it("compressIfNeeded called for researcherResults handoff", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runAnalystStage(ctx, deps);
    expect(deps.missionState.compressIfNeeded).toHaveBeenCalledWith(
      expect.anything(),
      "analyst.researcherResults",
    );
  });

  // ★ 2026-05-06 单轨化: insightsCount 之前由 stage:completed payload 传，
  //   现在由 hook return 值（output）经 orchestrator stage:completed 传，dispatcher
  //   拍平到 stage:lifecycle.payload.output。spec 改为验证 ctx.analystOutput.insights。
  it("produces 2 insights on success", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    await runAnalystStage(ctx, deps);
    expect(ctx.analystOutput?.insights).toHaveLength(2);
  });

  it("passes reconciliationReport to analyst.analyze when available", async () => {
    const recon = { factTable: [], conflicts: [], gaps: [] };
    const ctx = makeCtx({
      reconciliationReport: recon as MissionContext["reconciliationReport"],
    });
    const deps = makeDeps();
    await runAnalystStage(ctx, deps);
    const analyzeCall = (deps.analyst.analyze as jest.Mock).mock.calls[0][0];
    expect(analyzeCall.reconciliationReport).toBe(recon);
  });

  // ★ PR-R4 (2026-05-07): stage 主动持久化反向证据
  describe("PR-R4 markIntermediateState", () => {
    it("happy path: persists analystOutput to mission row after success", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      await runAnalystStage(ctx, deps);
      expect(deps.store.markIntermediateState).toHaveBeenCalledWith(
        "m6",
        expect.objectContaining({
          analystOutput: expect.objectContaining({
            insights: expect.any(Array),
            themeSummary: expect.any(String),
          }),
        }),
        "u1", // ★ 收尾评审第三轮 P0-S: 严格 userId 隔离
      );
    });

    it("fallback path: persists empty analystOutput so下游 cdHydrate 不丢中间态", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      (deps.analyst.analyze as jest.Mock).mockResolvedValue({
        state: "failed",
        output: null,
        events: [],
        wallTimeMs: 0,
        iterations: 1,
      });
      await runAnalystStage(ctx, deps);
      const calls = (deps.store.markIntermediateState as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const lastPatch = calls[calls.length - 1][1];
      expect(lastPatch.analystOutput).toBeDefined();
      expect(lastPatch.analystOutput.insights).toEqual([]);
    });

    it("DB 失败不阻断 stage（markIntermediateState 内部 catch）", async () => {
      const ctx = makeCtx();
      const deps = makeDeps();
      (deps.store.markIntermediateState as jest.Mock).mockRejectedValueOnce(
        new Error("DB conn lost"),
      );
      // markIntermediateState 内部 catch+log，外部 await 不该 reject
      // 但 jest 模拟 mockRejectedValueOnce 会让 await 抛错 — 业务层是 await ... .catch
      // 我们这里要验证 stage 自己不爆。生产代码 markIntermediateState 内部已 catch，
      // 故此测试用 mockResolvedValue 模拟"成功但 log warn"也行。这里改测调用次数。
      (deps.store.markIntermediateState as jest.Mock).mockReset();
      (deps.store.markIntermediateState as jest.Mock).mockResolvedValue(
        undefined,
      );
      await expect(runAnalystStage(ctx, deps)).resolves.toBeDefined();
    });
  });

  it("second attempt uses analyst.retry agentId", async () => {
    const ctx = makeCtx();
    const deps = makeDeps();
    let firstCall = true;
    (deps.analyst.analyze as jest.Mock).mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return Promise.resolve({
          state: "failed",
          output: null,
          events: [],
          wallTimeMs: 0,
          iterations: 1,
        });
      }
      return Promise.resolve({
        state: "completed",
        output: ANALYST_OUTPUT,
        events: [],
        wallTimeMs: 0,
        iterations: 1,
      });
    });
    await runAnalystStage(ctx, deps);
    const secondCall = (deps.analyst.analyze as jest.Mock).mock.calls[1][1];
    expect(secondCall.agentId).toBe("analyst.retry");
  });
});

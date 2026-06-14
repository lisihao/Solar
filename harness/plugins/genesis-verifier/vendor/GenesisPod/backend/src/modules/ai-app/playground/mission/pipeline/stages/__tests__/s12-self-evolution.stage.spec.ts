import { runSelfEvolutionStage } from "../s12-self-evolution.stage";
import type { MissionDeps } from "../../../context/mission-deps";

function makePool(tokensUsed = 10000, costUsd = 0.5) {
  return {
    snapshot: jest
      .fn()
      .mockReturnValue({ poolTokensUsed: tokensUsed, poolCostUsd: costUsd }),
  };
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
    store: {
      recordMissionPostmortem: jest.fn().mockResolvedValue(undefined),
    },
    failureLearner: {
      recordFailure: jest.fn().mockResolvedValue(undefined),
    },
    postmortemClassifier: {
      classify: jest.fn().mockReturnValue({
        mode: "success",
        signals: [],
        confidence: 1,
      }),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

const BASE_INPUT = {
  missionId: "m12",
  userId: "u1",
  t0: Date.now() - 30000,
  topic: "AI Trends",
  plan: {
    dimensions: [{ id: "d1" }, { id: "d2" }],
    goals: { qualityBar: { minCoverage: 80 } },
  },
  researcherResults: [
    {
      dimension: "Market",
      findings: [{ claim: "c", evidence: "e", source: "http://a.com" }],
    },
    {
      dimension: "Tech",
      findings: [{ claim: "c2", evidence: "e2", source: "http://b.com" }],
    },
  ],
  reportArtifact: { quality: { overall: 85 }, sections: [{}, {}] },
  leaderSignOff: { signed: true },
  pool: makePool(10000, 0.5),
};

describe("runSelfEvolutionStage (S12)", () => {
  it("happy path: emits mission:evolved event", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(BASE_INPUT, deps);
    const evolvedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.mission:evolved",
    );
    expect(evolvedCall).toBeDefined();
  });

  it("calls recordMissionPostmortem with missionId, userId, topic", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(BASE_INPUT, deps);
    expect(deps.store.recordMissionPostmortem).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "m12",
        userId: "u1",
        topic: "AI Trends",
      }),
    );
  });

  it("leader signed → failureLearner.recordFailure NOT called", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(BASE_INPUT, deps);
    expect(deps.failureLearner.recordFailure).not.toHaveBeenCalled();
  });

  it("leader refused (signed=false) → failureLearner.recordFailure called", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(
      { ...BASE_INPUT, leaderSignOff: { signed: false } },
      deps,
    );
    expect(deps.failureLearner.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({ failureCode: "LEADER_REFUSED_SIGN" }),
      }),
    );
  });

  it("leader refused → recommendation about regenerate included", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(
      {
        ...BASE_INPUT,
        leaderSignOff: { signed: false },
        reportArtifact: { quality: { overall: 30 }, sections: [] },
      },
      deps,
    );
    const postmortemCall = (deps.store.recordMissionPostmortem as jest.Mock)
      .mock.calls[0][0];
    expect(
      postmortemCall.recommendations.some((r: string) => r.includes("拒签")),
    ).toBe(true);
  });

  it("quality < 85% of bar → recommendation about quality included", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(
      {
        ...BASE_INPUT,
        reportArtifact: { quality: { overall: 50 }, sections: [] },
        plan: {
          dimensions: [{ id: "d1" }],
          goals: { qualityBar: { minCoverage: 80 } },
        },
      },
      deps,
    );
    const postmortemCall = (deps.store.recordMissionPostmortem as jest.Mock)
      .mock.calls[0][0];
    expect(
      postmortemCall.recommendations.some((r: string) => r.includes("命中率")),
    ).toBe(true);
  });

  it("costUsd > $3 → recommendation about cost included", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(
      { ...BASE_INPUT, pool: makePool(100000, 5.0) },
      deps,
    );
    const postmortemCall = (deps.store.recordMissionPostmortem as jest.Mock)
      .mock.calls[0][0];
    expect(
      postmortemCall.recommendations.some((r: string) => r.includes("成本")),
    ).toBe(true);
  });

  it("healthy mission → baseline recommendation included", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(BASE_INPUT, deps);
    const postmortemCall = (deps.store.recordMissionPostmortem as jest.Mock)
      .mock.calls[0][0];
    expect(
      postmortemCall.recommendations.some((r: string) => r.includes("健康")),
    ).toBe(true);
  });

  it("all errors are swallowed (best-effort)", async () => {
    const deps = makeDeps();
    (deps.store.recordMissionPostmortem as jest.Mock).mockRejectedValue(
      new Error("DB down"),
    );
    (deps.emit as jest.Mock).mockRejectedValue(new Error("emit failed"));
    await expect(
      runSelfEvolutionStage(BASE_INPUT, deps),
    ).resolves.toBeUndefined();
  });

  it("exception in stage body → logs warn and continues", async () => {
    const deps = makeDeps();
    // Make pool.snapshot throw to simulate internal error
    const badInput = {
      ...BASE_INPUT,
      pool: {
        snapshot: jest.fn().mockImplementation(() => {
          throw new Error("snap error");
        }),
      },
    };
    await runSelfEvolutionStage(badInput, deps);
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("S12 self-evolution failed"),
    );
  });

  it("logs S12 sediment recorded message", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(BASE_INPUT, deps);
    expect(deps.log.log as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("S12 sediment recorded"),
    );
  });

  it("mission:evolved payload includes qualityHitRate", async () => {
    const deps = makeDeps();
    await runSelfEvolutionStage(BASE_INPUT, deps);
    const evolvedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.mission:evolved",
    );
    // qualityHitRate = 85 / 80 = 1.06 → clamped to 1
    expect(evolvedCall[0].payload.qualityHitRate).toBeDefined();
  });

  it("retryTotal computed from dim count vs result count", async () => {
    const deps = makeDeps();
    // plan has 3 dims but researcherResults has 2
    await runSelfEvolutionStage(
      {
        ...BASE_INPUT,
        plan: {
          dimensions: [{ id: "d1" }, { id: "d2" }, { id: "d3" }],
          goals: { qualityBar: { minCoverage: 80 } },
        },
        researcherResults: [{ dimension: "Market", findings: [] }],
      },
      deps,
    );
    const evolvedCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.mission:evolved",
    );
    expect(evolvedCall[0].payload.retryTotal).toBe(2); // 3 - 1
  });

  it("recordMissionPostmortem failure is swallowed (best-effort)", async () => {
    const deps = makeDeps();
    (deps.store.recordMissionPostmortem as jest.Mock).mockRejectedValue(
      new Error("DB error"),
    );
    await expect(
      runSelfEvolutionStage(BASE_INPUT, deps),
    ).resolves.toBeUndefined();
  });

  it("wallTimeMs > 1h → wall-time recommendation included", async () => {
    const deps = makeDeps();
    const longRunInput = {
      ...BASE_INPUT,
      t0: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
    };
    await runSelfEvolutionStage(longRunInput, deps);
    const postmortemCall = (deps.store.recordMissionPostmortem as jest.Mock)
      .mock.calls[0][0];
    expect(
      postmortemCall.recommendations.some((r: string) => r.includes("墙时")),
    ).toBe(true);
  });
});

/**
 * leader.service.spec.ts
 *
 * Tests for LeaderService (factory) and SupervisedMission (container).
 */

import { Logger } from "@nestjs/common";
import { LeaderService, SupervisedMission } from "../leader.service";
import type {
  LeaderTask,
  LeaderRunFn,
  LeaderFinalQuality,
  LeaderStageOutcomes,
  LeaderResearcherOutcome,
} from "../leader.service";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeStore() {
  return {
    appendLeaderJournal: jest.fn().mockResolvedValue(undefined),
  };
}

function makeLog() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  } as unknown as Logger;
}

const baseTask: LeaderTask = {
  topic: "AI Trends 2026",
  depth: "standard",
  language: "zh-CN",
};

function makePlanOutput(minCoverage = 70) {
  return {
    phase: "plan" as const,
    themeSummary: "AI is transforming everything",
    dimensions: [
      // ★ 2026-05-22 矩阵配置：dim 含 facet + toolHint（与 Leader 输出 schema 一致）
      {
        id: "d1",
        name: "Technology",
        rationale: "core",
        minFindings: 5,
        facet: "scientific" as const,
        toolHint: { categories: ["academic"] },
      },
      {
        id: "d2",
        name: "Economy",
        rationale: "impact",
        minFindings: 5,
        facet: "market" as const,
        toolHint: { categories: ["web"] },
      },
    ],
    goals: {
      qualityBar: {
        minCoverage,
        minSourceCount: 10,
        preferredDepth: "thorough",
      },
    },
    initialRisks: ["data freshness"],
  };
}

function makeAssessOutput() {
  return {
    phase: "assess-research" as const,
    decision: "proceed",
    rationale: "Research quality looks good",
    perDimension: [
      { dimensionId: "d1", action: "proceed" },
      { dimensionId: "d2", action: "proceed" },
    ],
  };
}

function makeForewordOutput() {
  return {
    phase: "foreword" as const,
    executiveSummary: "This is a summary",
    whatWeAnswered: [
      { question: "What is AI?", addressed: "yes" as const },
      { question: "Limitations?", addressed: "partial" as const },
    ],
    whatRemainsUnclear: ["Future trajectory"],
    howToRead: "Read sequentially",
  };
}

function makeSignoffOutput(signed = true) {
  return {
    phase: "signoff" as const,
    signed,
    verdict: signed ? "approved" : "rejected",
    rationale: "Quality meets bar",
    score: signed ? 82 : 45,
  };
}

function _makeRunFn(responses: unknown[]): LeaderRunFn {
  let idx = 0;
  return jest.fn().mockImplementation(async () => {
    const resp = responses[Math.min(idx, responses.length - 1)];
    idx++;
    return resp;
  });
}

function _makeSuccessRunFn(planMinCoverage = 70): LeaderRunFn {
  return jest
    .fn()
    .mockResolvedValueOnce({
      state: "completed",
      output: makePlanOutput(planMinCoverage),
      events: [],
    })
    .mockResolvedValueOnce({
      state: "completed",
      output: makeAssessOutput(),
      events: [],
    })
    .mockResolvedValueOnce({
      state: "completed",
      output: makeForewordOutput(),
      events: [],
    })
    .mockResolvedValueOnce({
      state: "completed",
      output: makeSignoffOutput(),
      events: [],
    });
}

// ─── LeaderService (factory) ─────────────────────────────────────────────────

describe("LeaderService.create", () => {
  it("returns a SupervisedMission instance", () => {
    const store = makeStore();
    const svc = new LeaderService(store as never);
    const runFn = jest.fn() as unknown as LeaderRunFn;
    const mission = svc.create("m1", "u1", baseTask, runFn);
    expect(mission).toBeInstanceOf(SupervisedMission);
  });

  it("creates separate SupervisedMission instances for different missions", () => {
    const store = makeStore();
    const svc = new LeaderService(store as never);
    const runFn = jest.fn() as unknown as LeaderRunFn;
    const m1 = svc.create("m1", "u1", baseTask, runFn);
    const m2 = svc.create("m2", "u2", baseTask, runFn);
    expect(m1).not.toBe(m2);
  });
});

// ─── SupervisedMission.plan ───────────────────────────────────────────────────

describe("SupervisedMission.plan", () => {
  it("returns plan output on success", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(),
      events: [],
    });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    const plan = await mission.plan();
    expect(plan.phase).toBe("plan");
    expect(plan.dimensions).toHaveLength(2);
  });

  it("stores plan in context (accessible via getContext)", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(),
      events: [],
    });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    expect(mission.getContext().plan).toBeDefined();
  });

  it("clamps minCoverage from > 80 to 80", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(95),
      events: [],
    });
    const log = makeLog();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      log,
    );
    const plan = await mission.plan();
    expect(plan.goals.qualityBar.minCoverage).toBe(80);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("clamped minCoverage 95→80"),
    );
  });

  it("does NOT clamp minCoverage when already ≤ 80", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(75),
      events: [],
    });
    const log = makeLog();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      log,
    );
    const plan = await mission.plan();
    expect(plan.goals.qualityBar.minCoverage).toBe(75);
    expect(log.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("clamped"),
    );
  });

  it("throws when plan call fails with non-recoverable code", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "failed",
      output: undefined,
      events: [
        {
          type: "error",
          payload: { failureCode: "PROVIDER_API_ERROR", message: "down" },
          timestamp: 0,
        },
      ],
    });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await expect(mission.plan()).rejects.toThrow("Leader.plan failed");
  });

  it("retries once on recoverable failure code, then succeeds", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "failed",
        output: undefined,
        events: [
          {
            type: "error",
            payload: {
              failureCode: "PARSE_MALFORMED_JSON",
              message: "bad json",
            },
            timestamp: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      });
    const log = makeLog();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      log,
    );
    const plan = await mission.plan();
    expect(plan.phase).toBe("plan");
    expect(runFn).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("retrying once"),
    );
  });

  it("throws after retry also fails (recoverable → retry → fail)", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "failed",
        output: undefined,
        events: [
          {
            type: "error",
            payload: { failureCode: "RUNNER_LOOP_LIMIT", message: "loop" },
            timestamp: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        state: "failed",
        output: undefined,
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await expect(mission.plan()).rejects.toThrow("Leader.plan failed");
  });

  it("writes journal after successful plan", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(),
      events: [],
    });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    expect(store.appendLeaderJournal).toHaveBeenCalledTimes(1);
  });

  it("does not throw when journal write fails (best-effort)", async () => {
    const store = makeStore();
    store.appendLeaderJournal.mockRejectedValue(new Error("DB down"));
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(),
      events: [],
    });
    const log = makeLog();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      log,
    );
    await expect(mission.plan()).resolves.toBeDefined();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("journal write failed"),
    );
  });

  it("passes priorPostmortems to runFn input", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(),
      events: [],
    });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    const postmortems = [
      {
        missionId: "old-m",
        topic: "Old Topic",
        summary: "It failed because...",
        recommendations: ["use better model"],
        leaderSigned: false,
        qualityScore: 40,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];
    await mission.plan({ priorPostmortems: postmortems });
    const passedInput = runFn.mock.calls[0][0].input;
    expect(passedInput.priorPostmortems).toBe(postmortems);
  });

  it("passes empty array when priorPostmortems not provided", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(),
      events: [],
    });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    const passedInput = runFn.mock.calls[0][0].input;
    expect(passedInput.priorPostmortems).toEqual([]);
  });
});

// ─── SupervisedMission.assessResearchers ─────────────────────────────────────

describe("SupervisedMission.assessResearchers", () => {
  const outcomes: LeaderResearcherOutcome[] = [
    {
      dimensionId: "d1",
      dimensionName: "Technology",
      state: "completed",
      findingsCount: 8,
      sources: ["arxiv.org"],
      summary: "AI growing",
    },
  ];

  it("throws if plan() was not called first", async () => {
    const store = makeStore();
    const runFn = jest.fn();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await expect(mission.assessResearchers(outcomes)).rejects.toThrow(
      "must call plan() before assessResearchers()",
    );
  });

  it("hydratePlan() unblocks assessResearchers WITHOUT an LLM plan call (single-dim rerun, Screenshot_28 regression)", async () => {
    // 重跑 cascade 从 s3 起、s2-leader-plan 不重跑：leader.plan() 永不调用。
    // hydratePlan 用持久化 plan 回灌 context.plan，使 assessResearchers 不再撞
    // "must call plan() before assessResearchers()"，且不消耗一次 LLM 规划调用。
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValueOnce({
      state: "completed",
      output: makeAssessOutput(),
      events: [],
    });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    mission.hydratePlan(makePlanOutput() as never);
    const result = await mission.assessResearchers(outcomes);
    expect(result.phase).toBe("assess-research");
    // 仅 1 次 runFn（assess），plan 没有走 LLM
    expect(runFn).toHaveBeenCalledTimes(1);
    // 回灌时种入了一条 plan 决策（供 M7 signOff 问责引用）
    expect(mission.getContext().decisions.some((d) => d.phase === "plan")).toBe(
      true,
    );
  });

  it("returns assessResearch output after plan()", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeAssessOutput(),
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    const result = await mission.assessResearchers(outcomes);
    expect(result.phase).toBe("assess-research");
    expect(result.decision).toBe("proceed");
  });

  it("throws on failed assessment", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "failed",
        output: undefined,
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    await expect(mission.assessResearchers(outcomes)).rejects.toThrow(
      "Leader.assessResearchers failed",
    );
  });

  it("writes journal after successful assessment", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeAssessOutput(),
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    await mission.assessResearchers(outcomes);
    // plan journal + assess journal = 2 calls
    expect(store.appendLeaderJournal).toHaveBeenCalledTimes(2);
  });

  it("does not throw when journal write fails", async () => {
    const store = makeStore();
    store.appendLeaderJournal
      .mockResolvedValueOnce(undefined) // plan journal succeeds
      .mockRejectedValueOnce(new Error("DB")); // assess journal fails
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeAssessOutput(),
        events: [],
      });
    const log = makeLog();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      log,
    );
    await mission.plan();
    await expect(mission.assessResearchers(outcomes)).resolves.toBeDefined();
  });
});

// ─── SupervisedMission.writeForeword ─────────────────────────────────────────

describe("SupervisedMission.writeForeword", () => {
  const stageOutcomes: LeaderStageOutcomes = {
    researcherStates: [{ name: "Technology", state: "completed" }],
    writerSections: ["Introduction", "Body"],
    qualitySnapshot: {
      sourceCount: 15,
      coverageScore: 0.85,
      overall: 82,
      finalVerdict: "pass",
      criticBlindspots: [],
      criticBiases: [],
    },
  };

  it("throws if plan() was not called first", async () => {
    const store = makeStore();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      jest.fn() as unknown as LeaderRunFn,
      store as never,
      makeLog(),
    );
    await expect(mission.writeForeword(stageOutcomes)).rejects.toThrow(
      "must call plan() before writeForeword()",
    );
  });

  it("returns foreword output with generatedAt", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeForewordOutput(),
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    const result = await mission.writeForeword(stageOutcomes);
    expect(result.phase).toBe("foreword");
    expect(result.generatedAt).toBeDefined();
    expect(new Date(result.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("throws when foreword call fails", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "failed",
        output: undefined,
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    await expect(mission.writeForeword(stageOutcomes)).rejects.toThrow(
      "Leader.writeForeword failed",
    );
  });

  it("adds decision for foreword to context", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeForewordOutput(),
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    await mission.writeForeword(stageOutcomes);
    const ctx = mission.getContext();
    expect(ctx.decisions.some((d) => d.phase === "foreword")).toBe(true);
  });
});

// ─── SupervisedMission.signOff ────────────────────────────────────────────────

describe("SupervisedMission.signOff", () => {
  const finalQuality: LeaderFinalQuality = {
    sourceCount: 20,
    coverageScore: 0.88,
    overall: 85,
    finalVerdict: "pass",
    wordCount: 15000,
  };
  const dimensionStates = [{ name: "Technology", state: "completed" as const }];

  it("throws if plan() and writeForeword() were not called first", async () => {
    const store = makeStore();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      jest.fn() as unknown as LeaderRunFn,
      store as never,
      makeLog(),
    );
    await expect(
      mission.signOff(finalQuality, dimensionStates),
    ).rejects.toThrow("must call plan() and writeForeword() before signOff()");
  });

  it("throws if only plan() was called (no foreword)", async () => {
    const store = makeStore();
    const runFn = jest.fn().mockResolvedValue({
      state: "completed",
      output: makePlanOutput(),
      events: [],
    });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    await expect(
      mission.signOff(finalQuality, dimensionStates),
    ).rejects.toThrow("must call plan() and writeForeword() before signOff()");
  });

  it("returns signoff output after plan+foreword", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeForewordOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeSignoffOutput(),
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    await mission.writeForeword({
      researcherStates: [],
      writerSections: [],
      qualitySnapshot: {
        sourceCount: 10,
        coverageScore: 0.8,
        overall: 80,
        finalVerdict: "pass",
        criticBlindspots: [],
        criticBiases: [],
      },
    });
    const result = await mission.signOff(finalQuality, dimensionStates);
    expect(result.phase).toBe("signoff");
    expect(result.signed).toBe(true);
  });

  it("returns unsigned signoff when quality is below bar", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeForewordOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeSignoffOutput(false),
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    await mission.writeForeword({
      researcherStates: [],
      writerSections: [],
      qualitySnapshot: {
        sourceCount: 5,
        coverageScore: 0.3,
        overall: 40,
        finalVerdict: "fail",
        criticBlindspots: [],
        criticBiases: [],
      },
    });
    const result = await mission.signOff(finalQuality, dimensionStates);
    expect(result.signed).toBe(false);
  });

  it("throws when signoff call fails", async () => {
    const store = makeStore();
    const runFn = jest
      .fn()
      .mockResolvedValueOnce({
        state: "completed",
        output: makePlanOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "completed",
        output: makeForewordOutput(),
        events: [],
      })
      .mockResolvedValueOnce({
        state: "failed",
        output: undefined,
        events: [],
      });
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      runFn,
      store as never,
      makeLog(),
    );
    await mission.plan();
    await mission.writeForeword({
      researcherStates: [],
      writerSections: [],
      qualitySnapshot: {
        sourceCount: 10,
        coverageScore: 0.8,
        overall: 80,
        finalVerdict: "pass",
        criticBlindspots: [],
        criticBiases: [],
      },
    });
    await expect(
      mission.signOff(finalQuality, dimensionStates),
    ).rejects.toThrow("Leader.signOff failed");
  });
});

// ─── getContext ────────────────────────────────────────────────────────────────

describe("SupervisedMission.getContext", () => {
  it("exposes missionId and userId", () => {
    const store = makeStore();
    const mission = new SupervisedMission(
      "mission-xyz",
      "user-abc",
      baseTask,
      jest.fn() as unknown as LeaderRunFn,
      store as never,
      makeLog(),
    );
    const ctx = mission.getContext();
    expect(ctx.missionId).toBe("mission-xyz");
    expect(ctx.userId).toBe("user-abc");
  });

  it("exposes empty decisions array initially", () => {
    const store = makeStore();
    const mission = new SupervisedMission(
      "m1",
      "u1",
      baseTask,
      jest.fn() as unknown as LeaderRunFn,
      store as never,
      makeLog(),
    );
    expect(mission.getContext().decisions).toEqual([]);
  });
});

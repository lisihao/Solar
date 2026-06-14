import { runWriterOutlineStage } from "../s7-writer-plan-outline.stage";
import type { MissionContext } from "../../../context/mission-context";
import type { MissionDeps } from "../../../context/mission-deps";

const OUTLINE_OUTPUT = {
  chapterOutlines: [
    {
      sectionId: "s1",
      heading: "Market Analysis",
      subheadings: ["Size", "Growth"],
      thesis: "AI market grows",
      keyPointsToCover: ["revenue"],
    },
    {
      sectionId: "s2",
      heading: "Technology",
      subheadings: [],
      thesis: "Tech advances",
      keyPointsToCover: ["models"],
    },
  ],
  targetWordsPerChapter: { s1: 3000, s2: 3000 },
  factAllocation: { s1: ["f1"], s2: ["f2"] },
};

function makeCtx(
  auditLayers = "thorough",
  overrides: Partial<MissionContext> = {},
): MissionContext {
  return {
    missionId: "m7",
    userId: "u1",
    t0: Date.now(),
    budgetMultiplier: 1.0,
    input: {
      topic: "AI",
      depth: "deep",
      language: "zh-CN",
      auditLayers,
      lengthProfile: "standard",
      withFigures: false,
    } as MissionContext["input"],
    billing: {} as MissionContext["billing"],
    pool: {
      snapshot: jest
        .fn()
        .mockReturnValue({ poolCostUsd: 0, poolTokensUsed: 0 }),
    } as unknown as MissionContext["pool"],
    leader: {} as MissionContext["leader"],
    plan: {
      themeSummary: "AI",
      dimensions: [{ id: "d1", name: "Market", rationale: "r" }],
      goals: {} as never,
      initialRisks: [],
    },
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
    writer: {
      planMissionOutline: jest.fn().mockResolvedValue({
        state: "completed",
        output: OUTLINE_OUTPUT,
        events: [],
        wallTimeMs: 1000,
        iterations: 2,
      }),
    },
    invoker: {
      tickCost: jest.fn().mockResolvedValue(undefined),
    },
    // ★ PR-R4 (2026-05-07): MissionStore 注入
    store: {
      markIntermediateState: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  } as unknown as MissionDeps;
}

describe("runWriterOutlineStage (S7)", () => {
  it("skips when auditLayers is 'standard' (not thorough/paranoid)", async () => {
    const ctx = makeCtx("standard");
    const deps = makeDeps();
    await runWriterOutlineStage(ctx, deps);
    expect(ctx.outlinePlan).toBeUndefined();
    expect(deps.writer.planMissionOutline).not.toHaveBeenCalled();
  });

  it("skips when auditLayers is 'minimal'", async () => {
    const ctx = makeCtx("minimal");
    const deps = makeDeps();
    await runWriterOutlineStage(ctx, deps);
    expect(deps.writer.planMissionOutline).not.toHaveBeenCalled();
  });

  it("skips if ctx.plan is falsy", async () => {
    const ctx = makeCtx("thorough", { plan: undefined });
    const deps = makeDeps();
    await runWriterOutlineStage(ctx, deps);
    expect(deps.writer.planMissionOutline).not.toHaveBeenCalled();
  });

  it("thorough: runs planMissionOutline and writes ctx.outlinePlan", async () => {
    const ctx = makeCtx("thorough");
    const deps = makeDeps();
    await runWriterOutlineStage(ctx, deps);
    expect(ctx.outlinePlan).toBeDefined();
    expect(ctx.outlinePlan?.chapterOutlines).toHaveLength(2);
  });

  it("paranoid: runs planMissionOutline and writes ctx.outlinePlan", async () => {
    const ctx = makeCtx("thorough+");
    const deps = makeDeps();
    await runWriterOutlineStage(ctx, deps);
    expect(ctx.outlinePlan).toBeDefined();
  });

  it("outline output with empty chapterOutlines → ctx.outlinePlan remains undefined", async () => {
    const ctx = makeCtx("thorough");
    const deps = makeDeps();
    (deps.writer.planMissionOutline as jest.Mock).mockResolvedValue({
      state: "completed",
      output: {
        chapterOutlines: [],
        targetWordsPerChapter: {},
        factAllocation: {},
      },
      events: [],
      wallTimeMs: 500,
      iterations: 1,
    });
    await runWriterOutlineStage(ctx, deps);
    expect(ctx.outlinePlan).toBeUndefined();
  });

  it("planMissionOutline throws → logs warn and continues (non-fatal)", async () => {
    const ctx = makeCtx("thorough");
    const deps = makeDeps();
    (deps.writer.planMissionOutline as jest.Mock).mockRejectedValue(
      new Error("LLM error"),
    );
    await expect(runWriterOutlineStage(ctx, deps)).resolves.toBeUndefined();
    expect(deps.log.warn as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining("outline-planner failed"),
    );
  });

  it("emits dimension:outline:planned event on success", async () => {
    const ctx = makeCtx("thorough");
    const deps = makeDeps();
    await runWriterOutlineStage(ctx, deps);
    const emitCall = (deps.emit as jest.Mock).mock.calls.find(
      (c) => c[0].type === "playground.dimension:outline:planned",
    );
    expect(emitCall[0].payload.chapterCount).toBe(2);
  });

  it("state != completed → ctx.outlinePlan not set", async () => {
    const ctx = makeCtx("thorough");
    const deps = makeDeps();
    (deps.writer.planMissionOutline as jest.Mock).mockResolvedValue({
      state: "failed",
      output: null,
      events: [],
      wallTimeMs: 500,
      iterations: 1,
    });
    await runWriterOutlineStage(ctx, deps);
    expect(ctx.outlinePlan).toBeUndefined();
  });

  it("tickCost called after outline run", async () => {
    const ctx = makeCtx("thorough");
    const deps = makeDeps();
    await runWriterOutlineStage(ctx, deps);
    expect(deps.invoker.tickCost).toHaveBeenCalled();
  });

  it("outlinePlan.subheadings defaults to [] when not provided", async () => {
    const ctx = makeCtx("thorough");
    const deps = makeDeps();
    (deps.writer.planMissionOutline as jest.Mock).mockResolvedValue({
      state: "completed",
      output: {
        chapterOutlines: [
          {
            sectionId: "s1",
            heading: "Sec",
            thesis: "t",
            keyPointsToCover: [],
          },
        ],
        targetWordsPerChapter: {},
        factAllocation: {},
      },
      events: [],
      wallTimeMs: 500,
      iterations: 1,
    });
    await runWriterOutlineStage(ctx, deps);
    expect(ctx.outlinePlan?.chapterOutlines[0].subheadings).toEqual([]);
  });

  // ★ PR-R4 (2026-05-07): stage 主动持久化反向证据
  describe("PR-R4 markIntermediateState", () => {
    it("happy path: persists outlinePlan to mission row after success", async () => {
      const ctx = makeCtx("thorough");
      const deps = makeDeps();
      await runWriterOutlineStage(ctx, deps);
      expect(deps.store.markIntermediateState).toHaveBeenCalledWith(
        "m7",
        expect.objectContaining({
          outlinePlan: expect.objectContaining({
            chapterOutlines: expect.any(Array),
          }),
        }),
        "u1", // ★ 收尾评审第三轮 P0-S: 严格 userId 隔离
      );
    });

    it("skip path: standard auditLayers 不持久化（不调 markIntermediateState）", async () => {
      const ctx = makeCtx("standard");
      const deps = makeDeps();
      await runWriterOutlineStage(ctx, deps);
      expect(deps.store.markIntermediateState).not.toHaveBeenCalled();
    });

    it("empty chapterOutlines 不持久化（避免覆盖前一轮 outline）", async () => {
      const ctx = makeCtx("thorough");
      const deps = makeDeps();
      (deps.writer.planMissionOutline as jest.Mock).mockResolvedValue({
        state: "completed",
        output: {
          chapterOutlines: [],
          targetWordsPerChapter: {},
          factAllocation: {},
        },
        events: [],
        wallTimeMs: 500,
        iterations: 1,
      });
      await runWriterOutlineStage(ctx, deps);
      expect(deps.store.markIntermediateState).not.toHaveBeenCalled();
    });
  });

  it("reconciliationReport factTable passed to planMissionOutline", async () => {
    const recon = {
      factTable: [{ id: "f1", entity: "E", attribute: "a", value: "v" }],
    };
    const ctx = makeCtx("thorough", {
      reconciliationReport: recon as MissionContext["reconciliationReport"],
    });
    const deps = makeDeps();
    await runWriterOutlineStage(ctx, deps);
    const callArg = (deps.writer.planMissionOutline as jest.Mock).mock
      .calls[0][0];
    expect(callArg.factTable).toHaveLength(1);
  });
});

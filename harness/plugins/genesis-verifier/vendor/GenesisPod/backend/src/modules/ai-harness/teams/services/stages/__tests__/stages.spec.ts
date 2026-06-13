/**
 * Stage primitives + CrossStageState spec (v5.1 R1-A)
 */
import {
  CrossStageState,
  StageAbortError,
  ALL_STAGE_PRIMITIVES,
  PLAN_PRIMITIVE,
  RESEARCH_PRIMITIVE,
  ASSESS_PRIMITIVE,
  SYNTHESIZE_PRIMITIVE,
  DRAFT_PRIMITIVE,
  REVIEW_PRIMITIVE,
  SIGNOFF_PRIMITIVE,
  PERSIST_PRIMITIVE,
  LEARN_PRIMITIVE,
} from "../index";

function makeArgs(overrides = {}) {
  return {
    ctx: {
      missionId: "m1",
      input: {},
      statefulRoleStates: {},
    },
    role: {
      id: "leader",
      stateful: false,
      skillSpec: {
        id: "leader",
        systemPrompt: "be a leader",
        allowedToolIds: [],
        allowedModels: [],
        outputSchema: { safeParse: () => ({ success: true }) },
        meta: {},
      },
    },
    config: { id: "plan" },
    hooks: {},
    crossStageState: new CrossStageState(),
    previousOutputs: {},
    ...overrides,
  } as Parameters<typeof PLAN_PRIMITIVE.run>[0];
}

describe("CrossStageState (v5.1 R1-A §3.4)", () => {
  it("set / get / has / delete", () => {
    const s = new CrossStageState();
    s.set("k", { x: 1 });
    expect(s.has("k")).toBe(true);
    expect(s.get("k")).toEqual({ x: 1 });
    expect(s.delete("k")).toBe(true);
    expect(s.has("k")).toBe(false);
  });

  it("append accumulator", () => {
    const s = new CrossStageState();
    s.append("playground.s4PatchFailures", { dim: "a" });
    s.append("playground.s4PatchFailures", { dim: "b" });
    expect(s.get("playground.s4PatchFailures")).toEqual([
      { dim: "a" },
      { dim: "b" },
    ]);
  });

  it("incr counter", () => {
    const s = new CrossStageState();
    expect(s.incr("playground.s4PatchRound")).toBe(1);
    expect(s.incr("playground.s4PatchRound")).toBe(2);
    expect(s.incr("playground.s4PatchRound", 5)).toBe(7);
  });

  it("toJSON / fromJSON 持久化往返", () => {
    const s = new CrossStageState();
    s.set("a", 1);
    s.append("list", "x");
    s.append("list", "y");
    const json = s.toJSON();
    const restored = CrossStageState.fromJSON(json);
    expect(restored.get("a")).toBe(1);
    expect(restored.get("list")).toEqual(["x", "y"]);
  });

  it("clone 浅拷贝", () => {
    const s = new CrossStageState({ a: 1 });
    const c = s.clone();
    c.set("b", 2);
    expect(s.has("b")).toBe(false);
    expect(c.has("a")).toBe(true);
  });

  it("keys 字典序", () => {
    const s = new CrossStageState({ c: 3, a: 1, b: 2 });
    expect(s.keys()).toEqual(["a", "b", "c"]);
  });
});

describe("ALL_STAGE_PRIMITIVES (v5.1 R1-A §3.2)", () => {
  it("9 primitive (7 core + 2 noop) all exported", () => {
    expect(ALL_STAGE_PRIMITIVES).toHaveLength(9);
    const ids = ALL_STAGE_PRIMITIVES.map((p) => p.id).sort();
    expect(ids).toEqual([
      "assess",
      "draft",
      "learn",
      "persist",
      "plan",
      "research",
      "review",
      "signoff",
      "synthesize",
    ]);
  });
});

describe("plan primitive", () => {
  it("调 hooks.runRole 并返回 raw + extracted fields", async () => {
    const out = await PLAN_PRIMITIVE.run(
      makeArgs({
        hooks: {
          runRole: async () => ({ dimensions: ["d1", "d2"], goals: ["g1"] }),
          extractPlanFields: (raw) => ({
            dimensions: (raw as { dimensions: unknown[] }).dimensions,
            goals: (raw as { goals: unknown[] }).goals,
          }),
        },
      }),
    );
    expect(out.dimensions).toEqual(["d1", "d2"]);
    expect(out.goals).toEqual(["g1"]);
  });

  it("stateful role 自动 append decision 到 crossStageState", async () => {
    const css = new CrossStageState();
    await PLAN_PRIMITIVE.run(
      makeArgs({
        crossStageState: css,
        role: {
          id: "leader",
          stateful: true,
          skillSpec: {
            id: "leader",
            systemPrompt: "x",
            allowedToolIds: [],
            allowedModels: [],
            outputSchema: {},
            meta: {},
          },
        },
        hooks: {
          runRole: async () => ({ raw: 1 }),
          extractDecision: () => ({
            phase: "plan",
            decision: "ok",
            timestamp: 0,
          }),
        },
      }),
    );
    expect(css.get("role:leader:decisions")).toHaveLength(1);
  });

  it("缺 hooks.runRole 抛错", async () => {
    await expect(PLAN_PRIMITIVE.run(makeArgs({ hooks: {} }))).rejects.toThrow(
      /requires hooks.runRole/,
    );
  });
});

describe("research primitive", () => {
  it("fanOut + perItemPipeline 并发处理，settled 部分失败时累计 failureCount", async () => {
    const css = new CrossStageState();
    const failures = [];
    const out = await RESEARCH_PRIMITIVE.run(
      makeArgs({
        config: { id: "research", params: { concurrency: 2 } },
        crossStageState: css,
        hooks: {
          fanOut: () => ["a", "b", "c"],
          perItemPipeline: async ({ item }) => {
            if (item === "b") throw new Error("fail");
            return { item, ok: true };
          },
          onPatchFailure: ({ item }) => {
            failures.push(item);
            css.append("playground.s4PatchFailures", item);
          },
        },
      }),
    );
    expect(out.results).toHaveLength(2);
    expect(out.failureCount).toBe(1);
    expect(failures).toEqual(["b"]);
    expect(css.get("playground.s4PatchFailures")).toEqual(["b"]);
  });
});

describe("assess primitive", () => {
  it("decision='continue' 正常返回", async () => {
    const out = await ASSESS_PRIMITIVE.run(
      makeArgs({
        hooks: {
          runRole: async () => ({ d: "continue" }),
          parseDecision: () => "continue",
        },
      }),
    );
    expect(out.decision).toBe("continue");
  });

  it("decision='abort-mission' 抛 StageAbortError", async () => {
    await expect(
      ASSESS_PRIMITIVE.run(
        makeArgs({
          hooks: {
            runRole: async () => ({}),
            parseDecision: () => "abort-mission",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(StageAbortError);
  });

  it("dispatchAssessActions 触发副作用", async () => {
    const css = new CrossStageState();
    await ASSESS_PRIMITIVE.run(
      makeArgs({
        crossStageState: css,
        hooks: {
          runRole: async () => ({}),
          parseDecision: () => "patch-then-retry",
          dispatchAssessActions: ({ crossStageState }) => {
            crossStageState.incr("playground.s4PatchRound");
          },
        },
      }),
    );
    expect(css.get("playground.s4PatchRound")).toBe(1);
  });
});

describe("synthesize primitive", () => {
  it("singleDimensionShortCircuit 命中 → shortCircuited=true", async () => {
    const out = await SYNTHESIZE_PRIMITIVE.run(
      makeArgs({
        hooks: {
          singleDimensionShortCircuit: () => ({ shortcut: true }),
          synthesize: async () => {
            throw new Error("should not be called");
          },
        },
      }),
    );
    expect(out.shortCircuited).toBe(true);
    expect(out.result).toEqual({ shortcut: true });
  });

  it("retryOnceOnNullOutput：第一次返回 null → 第二次返回 ok", async () => {
    let calls = 0;
    const out = await SYNTHESIZE_PRIMITIVE.run(
      makeArgs({
        hooks: {
          retryOnceOnNullOutput: true,
          synthesize: async () => {
            calls++;
            return calls === 1 ? null : { ok: true };
          },
        },
      }),
    );
    expect(out.result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("retry 后仍 null → 抛 StageAbortError", async () => {
    await expect(
      SYNTHESIZE_PRIMITIVE.run(
        makeArgs({
          hooks: {
            retryOnceOnNullOutput: true,
            synthesize: async () => null,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(StageAbortError);
  });
});

describe("draft primitive", () => {
  it("draftOnce → judgeConsensusRetry → reportArtifactAssembler chain", async () => {
    let memoryIndexed = false;
    const out = await DRAFT_PRIMITIVE.run(
      makeArgs({
        hooks: {
          draftOnce: async () => "draft1",
          judgeConsensusRetry: async ({ artifact }) => ({
            artifact: artifact + "→retry",
            verdict: "ok",
          }),
          reportArtifactAssembler: async ({ artifact }) =>
            artifact + "→assembled",
          memoryIndexer: async () => {
            memoryIndexed = true;
          },
        },
      }),
    );
    expect(out.artifact).toBe("draft1→retry→assembled");
    expect(out.reviewVerdict).toBe("ok");
    // memoryIndexer fire-and-forget；await 一下
    await new Promise((r) => setTimeout(r, 5));
    expect(memoryIndexed).toBe(true);
  });
});

describe("review primitive", () => {
  it("review + scoreScaling + objectiveEvalInjection", async () => {
    const out = await REVIEW_PRIMITIVE.run(
      makeArgs({
        hooks: {
          review: async () => ({ verdict: "raw-v", score: 0.8, passed: true }),
          scoreScaling: (raw) => raw * 100,
          objectiveEvalInjection: async ({ verdict }) => verdict + "+obj",
          afterReview: async () => undefined,
        },
      }),
    );
    expect(out.verdict).toBe("raw-v+obj");
    expect(out.score).toBe(80);
    expect(out.passed).toBe(true);
  });
});

describe("signoff primitive", () => {
  it("accountability 引用 crossStageState 的 patchFailures 强制 degraded", async () => {
    const css = new CrossStageState();
    css.append("playground.s4PatchFailures", "x");
    const out = await SIGNOFF_PRIMITIVE.run(
      makeArgs({
        crossStageState: css,
        hooks: {
          runRole: async () => ({ raw: 1 }),
          accountability: async ({ crossStageState }) => ({
            forcedDegraded:
              (
                (crossStageState.get(
                  "playground.s4PatchFailures",
                ) as unknown[]) ?? []
              ).length > 0,
            signoff: { result: "approved" },
          }),
        },
      }),
    );
    expect(out.forcedDegraded).toBe(true);
  });
});

describe("persist primitive", () => {
  it("调 hooks.persist 后返回 persisted=true", async () => {
    let called = false;
    const out = await PERSIST_PRIMITIVE.run(
      makeArgs({
        hooks: {
          persist: async () => {
            called = true;
          },
        },
      }),
    );
    expect(called).toBe(true);
    expect(out.persisted).toBe(true);
  });

  it("缺 hooks.persist 抛错", async () => {
    await expect(
      PERSIST_PRIMITIVE.run(makeArgs({ hooks: {} })),
    ).rejects.toThrow(/requires hooks.persist/);
  });
});

describe("learn primitive", () => {
  it("fire-and-forget 不阻塞 mission（即使 hooks 抛错）", async () => {
    const out = await LEARN_PRIMITIVE.run(
      makeArgs({
        hooks: {
          postmortemClassifier: async () => {
            throw new Error("fail-in-learn");
          },
          memoryConsolidation: async () => undefined,
        },
      }),
    );
    expect(out.enqueued).toBe(true);
  });
});
